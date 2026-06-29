<?php
declare(strict_types=1);

use BRS\AI;
use BRS\Auth;
use BRS\Db;
use BRS\Json;

/*
 * Leads CRUD — admin-only. Mirrors clients fields so promotion copies 1:1.
 *
 *   GET    /api/leads
 *   POST   /api/leads
 *   GET    /api/leads/:id
 *   PUT    /api/leads/:id
 *   DELETE /api/leads/:id
 *   POST   /api/leads/:id/promote   → creates a clients row and links it
 */

return function (string $method, array $segs): void {
    $claims = Auth::require();
    $pdo = Db::pdo();
    // JWT 'sub' is the admin_users.id of the calling user. Used to stamp
    // `added_by_user_id` on UI-driven lead creates so the list view can
    // show who added each row.
    $currentUserId = isset($claims['sub']) ? (int)$claims['sub'] : null;

    // Statuses surfaced through the API. `converted` is system-set by
    // /api/leads/:id/promote (and reset to 'new' by the inverse
    // /api/clients/:id/relegate-to-lead). The other three are the user-
    // pickable values surfaced in the leads-admin dropdown. Migration 096
    // narrowed the ENUM to exactly this set.
    $allowedStatuses = ['new', 'prospect', 'dead', 'converted'];

    // Shared SELECT for both list + single endpoints. Joins service_offerings
    // and admin_users so the frontend can render the human-readable labels
    // without two extra round-trips per row.
    $leadSelect = 'SELECT l.*,
                          so.name         AS service_name,
                          au.display_name AS added_by_name
                     FROM leads l
                LEFT JOIN service_offerings so ON so.id = l.service_offering_id
                LEFT JOIN admin_users      au ON au.id = l.added_by_user_id';

    if (!isset($segs[1])) {
        if ($method === 'GET') {
            // Hard upper bound — see clients.php for rationale. Real
            // pagination is a follow-up when the lead funnel actually
            // exceeds this cap.
            $rows = $pdo->query($leadSelect . ' ORDER BY l.id DESC LIMIT 1000')->fetchAll();
            Json::send(['leads' => $rows]);
        }
        if ($method === 'POST') {
            $body = Json::readBody();
            $name = trim((string)($body['name'] ?? ''));
            if ($name === '') Json::fail('Name is required', 400);
            $email = trim((string)($body['email'] ?? ''));
            if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) Json::fail('Invalid email', 400);

            $status = (string)($body['status'] ?? 'new');
            if (!in_array($status, $allowedStatuses, true)) $status = 'new';

            // service_offering_id must reference a real row when set. Null
            // is fine (lead may be sector-only with no service decided yet).
            $serviceId = null;
            if (!empty($body['service_offering_id'])) {
                $serviceId = (int)$body['service_offering_id'];
                $check = $pdo->prepare('SELECT 1 FROM service_offerings WHERE id = ?');
                $check->execute([$serviceId]);
                if (!$check->fetchColumn()) Json::fail('Invalid service_offering_id', 400);
            }

            // contacted_at: caller can send a timestamp string OR a truthy
            // boolean (in which case we stamp NOW). Empty/false = clear.
            $contactedAt = null;
            if (array_key_exists('contacted_at', $body) && $body['contacted_at']) {
                $contactedAt = is_string($body['contacted_at'])
                    ? $body['contacted_at']
                    : date('Y-m-d H:i:s');
            } elseif (!empty($body['contacted'])) {
                $contactedAt = date('Y-m-d H:i:s');
            }

            $ins = $pdo->prepare('INSERT INTO leads
                (name, email, phone, address, company, url, notes, status, source,
                 industry, service_offering_id, contacted_at,
                 added_by_user_id, added_by_system)
                VALUES (?,?,?,?,?,?,?,?,?, ?,?,?, ?,?)');
            $ins->execute([
                $name,
                $email !== '' ? $email : null,
                trim((string)($body['phone']   ?? '')) ?: null,
                $body['address']                       ?? null,
                trim((string)($body['company'] ?? '')) ?: null,
                trim((string)($body['url']     ?? '')) ?: null,
                $body['notes'] ?? null,
                $status,
                trim((string)($body['source']  ?? '')) ?: null,
                trim((string)($body['industry'] ?? '')) ?: null,
                $serviceId,
                $contactedAt,
                // UI-driven creates are stamped with the calling admin's
                // user id. Bulk/AI imports go through the dedicated
                // endpoints below which set added_by_system instead.
                $currentUserId,
                0,
            ]);
            $newLeadId = (int)$pdo->lastInsertId();
            // Replay every audience='lead' contract template as a pending
            // lead_documents row (076 multi-audience contracts).
            \BRS\Contracts::fanOutToNewEntity($pdo, 'lead', $newLeadId);
            Json::send(['id' => $newLeadId], 201);
        }
        Json::fail('Method not allowed', 405);
    }

    // GET /api/leads/industries → distinct non-empty industry values used
    // by at least one lead. Powers the dynamic Leads sub-menu in the
    // sidenav and the industry filter dropdown on the list page.
    if ($segs[1] === 'industries') {
        if ($method !== 'GET') Json::fail('Method not allowed', 405);
        $rows = $pdo->query(
            "SELECT industry AS name, COUNT(*) AS lead_count
               FROM leads
              WHERE industry IS NOT NULL AND industry <> ''
              GROUP BY industry
              ORDER BY industry"
        )->fetchAll();
        Json::send(['industries' => $rows]);
    }

    // /api/leads/ai-generate — call an LLM to research + format a lead list.
    // Body: { search_model, format_model?, prompt }. Response: { leads: [...] }
    // matching the same shape that /bulk accepts, so the frontend can route the
    // result straight into the existing preview/import flow.
    if ($segs[1] === 'ai-generate') {
        if ($method !== 'POST') Json::fail('Method not allowed', 405);
        $body         = Json::readBody();
        $searchModel  = trim((string)($body['search_model'] ?? ''));
        $formatModel  = trim((string)($body['format_model'] ?? ''));
        $userPrompt   = trim((string)($body['prompt'] ?? ''));
        if ($searchModel === '') Json::fail('search_model is required', 400);
        if ($userPrompt === '')  Json::fail('prompt is required', 400);
        try {
            $leads = AI::generate($searchModel, $formatModel ?: null, $userPrompt);
        } catch (\Throwable $e) {
            Json::fail($e->getMessage(), 502);
        }
        Json::send(['leads' => $leads]);
    }

    // /api/leads/bulk — batch import. Body: { leads: [{ name, email?, phone?,
    // address?, company?, url?, notes?, source?, status? }, ...] }. Each row
    // is validated independently; rows that fail validation are skipped and
    // reported in `errors`. Whole import is wrapped in a transaction so a
    // mid-batch DB failure rolls everything back.
    if ($segs[1] === 'bulk') {
        if ($method !== 'POST') Json::fail('Method not allowed', 405);

        $body  = Json::readBody();
        $leads = $body['leads'] ?? null;
        if (!is_array($leads) || count($leads) === 0) Json::fail('No leads provided', 400);

        $inserted = 0;
        $errors   = [];

        // Optional batch-wide defaults: caller (e.g. the AI / leadgen flow)
        // can pass `industry` once at the top level instead of repeating it
        // on every row; per-row industry still wins when present.
        $batchIndustry = trim((string)($body['industry'] ?? '')) ?: null;
        $batchServiceId = null;
        if (!empty($body['service_offering_id'])) {
            $batchServiceId = (int)$body['service_offering_id'];
            $check = $pdo->prepare('SELECT 1 FROM service_offerings WHERE id = ?');
            $check->execute([$batchServiceId]);
            if (!$check->fetchColumn()) Json::fail('Invalid service_offering_id', 400);
        }

        $pdo->beginTransaction();
        try {
            $ins = $pdo->prepare('INSERT INTO leads
                (name, email, phone, address, company, url, notes, status, source,
                 industry, service_offering_id,
                 added_by_user_id, added_by_system)
                VALUES (?,?,?,?,?,?,?,?,?, ?,?, ?,?)');

            foreach ($leads as $i => $row) {
                $rowNum = $i + 1;
                if (!is_array($row)) {
                    $errors[] = ['row' => $rowNum, 'error' => 'Row is not an object'];
                    continue;
                }
                $name = trim((string)($row['name'] ?? ''));
                if ($name === '') {
                    $errors[] = ['row' => $rowNum, 'error' => 'Name missing'];
                    continue;
                }
                $email = trim((string)($row['email'] ?? ''));
                if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
                    $errors[] = ['row' => $rowNum, 'error' => 'Invalid email'];
                    continue;
                }
                $status = strtolower(trim((string)($row['status'] ?? 'new')));
                if (!in_array($status, $allowedStatuses, true)) $status = 'new';

                $rowIndustry  = trim((string)($row['industry'] ?? ''));
                $rowServiceId = !empty($row['service_offering_id']) ? (int)$row['service_offering_id'] : null;

                $ins->execute([
                    $name,
                    $email !== '' ? $email : null,
                    trim((string)($row['phone']   ?? '')) ?: null,
                    $row['address']                       ?? null,
                    trim((string)($row['company'] ?? '')) ?: null,
                    trim((string)($row['url']     ?? '')) ?: null,
                    $row['notes'] ?? null,
                    $status,
                    trim((string)($row['source']  ?? '')) ?: null,
                    $rowIndustry !== '' ? $rowIndustry : $batchIndustry,
                    $rowServiceId !== null ? $rowServiceId : $batchServiceId,
                    // Bulk imports record BOTH the triggering admin AND the
                    // system flag — the admin trail is preserved while the
                    // list view still tags the row as automated rather
                    // than hand-keyed.
                    $currentUserId,
                    1,
                ]);
                $inserted++;
            }

            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }

        Json::send(['inserted' => $inserted, 'errors' => $errors], 201);
    }

    $id = (int)$segs[1];
    if ($id <= 0) Json::fail('Invalid id', 400);

    // Single-row fetch uses the same enriched SELECT as the list so the
    // detail view has service_name + added_by_name without a 2nd round-trip.
    $stmt = $pdo->prepare($leadSelect . ' WHERE l.id = ?');
    $stmt->execute([$id]);
    $lead = $stmt->fetch();
    if (!$lead) Json::fail('Lead not found', 404);

    // /api/leads/:id/contacts[/:cid][/primary]
    //
    // Mirrors the client_contacts sub-route on clients.php so a lead can
    // already track multiple people pre-promotion. Same shape: list +
    // POST on the collection; PUT/DELETE on items; POST /primary to flip
    // which contact carries is_primary=1.
    if (($segs[2] ?? '') === 'contacts') {
        $cid = isset($segs[3]) ? (int)$segs[3] : null;

        $loadAll = function () use ($pdo, $id) {
            $rows = $pdo->prepare('SELECT * FROM lead_contacts WHERE lead_id = ? ORDER BY sort_order, id');
            $rows->execute([$id]);
            $contacts = $rows->fetchAll();
            if (!$contacts) return [];
            $ids   = array_map(fn($c) => (int)$c['id'], $contacts);
            $place = implode(',', array_fill(0, count($ids), '?'));
            $nums  = $pdo->prepare("SELECT * FROM lead_contact_numbers WHERE contact_id IN ($place) ORDER BY sort_order, id");
            $nums->execute($ids);
            $byContact = [];
            foreach ($nums->fetchAll() as $n) { $byContact[(int)$n['contact_id']][] = $n; }
            foreach ($contacts as &$c) { $c['numbers'] = $byContact[(int)$c['id']] ?? []; }
            unset($c);
            return $contacts;
        };

        $writeNumbers = function (int $contactId, array $numbers) use ($pdo) {
            $pdo->prepare('DELETE FROM lead_contact_numbers WHERE contact_id = ?')->execute([$contactId]);
            $ins = $pdo->prepare('INSERT INTO lead_contact_numbers (contact_id, number, label, sort_order) VALUES (?,?,?,?)');
            $sort = 0;
            foreach ($numbers as $n) {
                if (!is_array($n)) continue;
                $num = trim((string)($n['number'] ?? ''));
                if ($num === '') continue;
                $ins->execute([$contactId, $num, trim((string)($n['label'] ?? '')) ?: null, $sort++]);
            }
        };

        $setPrimary = function (int $leadId, int $contactId) use ($pdo) {
            $pdo->beginTransaction();
            try {
                $pdo->prepare('UPDATE lead_contacts SET is_primary = 0 WHERE lead_id = ? AND id <> ?')
                    ->execute([$leadId, $contactId]);
                $pdo->prepare('UPDATE lead_contacts SET is_primary = 1 WHERE lead_id = ? AND id = ?')
                    ->execute([$leadId, $contactId]);
                $pdo->commit();
            } catch (\Throwable $e) { $pdo->rollBack(); throw $e; }
        };

        $hasPrimary = function (int $leadId) use ($pdo): bool {
            $stmt = $pdo->prepare('SELECT 1 FROM lead_contacts WHERE lead_id = ? AND is_primary = 1 LIMIT 1');
            $stmt->execute([$leadId]);
            return (bool)$stmt->fetchColumn();
        };

        if ($cid === null) {
            if ($method === 'GET')  Json::send(['contacts' => $loadAll()]);

            if ($method === 'POST') {
                $body  = Json::readBody();
                $first = trim((string)($body['first_name'] ?? ''));
                if ($first === '') Json::fail('First name is required', 400);
                $email = trim((string)($body['email'] ?? ''));
                if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) Json::fail('Invalid email', 400);

                $wantPrimary = !empty($body['is_primary']) || !$hasPrimary($id);

                $ins = $pdo->prepare('INSERT INTO lead_contacts
                    (lead_id, first_name, last_name, position, email, verified, is_primary, sort_order)
                    VALUES (?,?,?,?,?,?,?,?)');
                $ins->execute([
                    $id,
                    $first,
                    trim((string)($body['last_name'] ?? '')) ?: null,
                    trim((string)($body['position']  ?? '')) ?: null,
                    $email !== '' ? $email : null,
                    !empty($body['verified']) ? 1 : 0,
                    $wantPrimary ? 1 : 0,
                    (int)($body['sort_order'] ?? 0),
                ]);
                $newId = (int)$pdo->lastInsertId();
                if (is_array($body['numbers'] ?? null)) $writeNumbers($newId, $body['numbers']);
                if ($wantPrimary) $setPrimary($id, $newId);
                Json::send(['id' => $newId], 201);
            }
            Json::fail('Method not allowed', 405);
        }

        $cstmt = $pdo->prepare('SELECT * FROM lead_contacts WHERE id = ? AND lead_id = ?');
        $cstmt->execute([$cid, $id]);
        $contact = $cstmt->fetch();
        if (!$contact) Json::fail('Contact not found', 404);

        if (($segs[4] ?? '') === 'primary' && $method === 'POST') {
            $setPrimary($id, $cid);
            Json::send(['ok' => true]);
        }

        if ($method === 'PUT') {
            $body  = Json::readBody();
            $first = trim((string)($body['first_name'] ?? $contact['first_name']));
            if ($first === '') Json::fail('First name is required', 400);
            $email = trim((string)($body['email'] ?? $contact['email'] ?? ''));
            if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) Json::fail('Invalid email', 400);

            $upd = $pdo->prepare('UPDATE lead_contacts
                SET first_name=?, last_name=?, position=?, email=?, verified=?, sort_order=?
                WHERE id = ?');
            $upd->execute([
                $first,
                trim((string)($body['last_name'] ?? $contact['last_name'] ?? '')) ?: null,
                trim((string)($body['position']  ?? $contact['position']  ?? '')) ?: null,
                $email !== '' ? $email : null,
                !empty($body['verified']) ? 1 : 0,
                (int)($body['sort_order'] ?? $contact['sort_order']),
                $cid,
            ]);
            if (isset($body['numbers']) && is_array($body['numbers'])) $writeNumbers($cid, $body['numbers']);
            if (!empty($body['is_primary']) && (int)$contact['is_primary'] !== 1) $setPrimary($id, $cid);
            Json::send(['ok' => true]);
        }

        if ($method === 'DELETE') {
            $wasPrimary = (int)($contact['is_primary'] ?? 0) === 1;
            $pdo->prepare('DELETE FROM lead_contacts WHERE id = ?')->execute([$cid]);
            if ($wasPrimary) {
                $next = $pdo->prepare('SELECT id FROM lead_contacts WHERE lead_id = ? ORDER BY id LIMIT 1');
                $next->execute([$id]);
                $row = $next->fetch();
                if ($row) $setPrimary($id, (int)$row['id']);
            }
            Json::send(['ok' => true]);
        }

        Json::fail('Method not allowed', 405);
    }

    // /api/leads/:id/info[/:iid]
    if (($segs[2] ?? '') === 'info') {
        $iid = isset($segs[3]) ? (int)$segs[3] : null;

        if ($iid === null) {
            if ($method === 'GET') {
                $rows = $pdo->prepare('SELECT * FROM lead_info WHERE lead_id = ? ORDER BY sort_order, id');
                $rows->execute([$id]);
                Json::send(['info' => $rows->fetchAll()]);
            }
            if ($method === 'POST') {
                $body = Json::readBody();
                $name = trim((string)($body['name'] ?? ''));
                if ($name === '') Json::fail('Name is required', 400);
                $ins = $pdo->prepare('INSERT INTO lead_info (lead_id, name, value, sort_order) VALUES (?,?,?,?)');
                $ins->execute([$id, $name, $body['value'] ?? null, (int)($body['sort_order'] ?? 0)]);
                Json::send(['id' => (int)$pdo->lastInsertId()], 201);
            }
            Json::fail('Method not allowed', 405);
        }

        $istmt = $pdo->prepare('SELECT * FROM lead_info WHERE id = ? AND lead_id = ?');
        $istmt->execute([$iid, $id]);
        $entry = $istmt->fetch();
        if (!$entry) Json::fail('Info entry not found', 404);

        if ($method === 'PUT') {
            $body = Json::readBody();
            $name = trim((string)($body['name'] ?? $entry['name']));
            if ($name === '') Json::fail('Name is required', 400);
            $upd = $pdo->prepare('UPDATE lead_info SET name=?, value=?, sort_order=? WHERE id = ?');
            $upd->execute([
                $name,
                array_key_exists('value', $body) ? $body['value'] : $entry['value'],
                (int)($body['sort_order'] ?? $entry['sort_order']),
                $iid,
            ]);
            Json::send(['ok' => true]);
        }
        if ($method === 'DELETE') {
            $pdo->prepare('DELETE FROM lead_info WHERE id = ?')->execute([$iid]);
            Json::send(['ok' => true]);
        }
        Json::fail('Method not allowed', 405);
    }

    // /api/leads/:id/notes[/:nid]
    if (($segs[2] ?? '') === 'notes') {
        $nid = isset($segs[3]) ? (int)$segs[3] : null;

        if ($nid === null) {
            if ($method === 'GET') {
                $rows = $pdo->prepare('SELECT * FROM lead_notes WHERE lead_id = ? ORDER BY sort_order, id DESC');
                $rows->execute([$id]);
                Json::send(['notes' => $rows->fetchAll()]);
            }
            if ($method === 'POST') {
                $body  = Json::readBody();
                $title = trim((string)($body['title'] ?? ''));
                if ($title === '') Json::fail('Title is required', 400);
                $ins = $pdo->prepare('INSERT INTO lead_notes (lead_id, title, body, sort_order) VALUES (?,?,?,?)');
                $ins->execute([$id, $title, $body['body'] ?? null, (int)($body['sort_order'] ?? 0)]);
                Json::send(['id' => (int)$pdo->lastInsertId()], 201);
            }
            Json::fail('Method not allowed', 405);
        }

        $nstmt = $pdo->prepare('SELECT * FROM lead_notes WHERE id = ? AND lead_id = ?');
        $nstmt->execute([$nid, $id]);
        $note = $nstmt->fetch();
        if (!$note) Json::fail('Note not found', 404);

        if ($method === 'PUT') {
            $body  = Json::readBody();
            $title = trim((string)($body['title'] ?? $note['title']));
            if ($title === '') Json::fail('Title is required', 400);
            $upd = $pdo->prepare('UPDATE lead_notes SET title=?, body=?, sort_order=? WHERE id = ?');
            $upd->execute([
                $title,
                array_key_exists('body', $body) ? $body['body'] : $note['body'],
                (int)($body['sort_order'] ?? $note['sort_order']),
                $nid,
            ]);
            Json::send(['ok' => true]);
        }
        if ($method === 'DELETE') {
            $pdo->prepare('DELETE FROM lead_notes WHERE id = ?')->execute([$nid]);
            Json::send(['ok' => true]);
        }
        Json::fail('Method not allowed', 405);
    }

    // /api/leads/:id/promote → create a clients row from this lead, then
    // delete the lead (a promoted lead is no longer a lead). Re-promotion
    // attempts hit the early "Lead not found" 404 above.
    if (($segs[2] ?? '') === 'promote') {
        if ($method !== 'POST') Json::fail('Method not allowed', 405);

        $pdo->beginTransaction();
        try {
            $insClient = $pdo->prepare('INSERT INTO clients
                (name, email, phone, address, company, url, notes)
                VALUES (?,?,?,?,?,?,?)');
            $insClient->execute([
                $lead['name'],
                $lead['email'],
                $lead['phone'],
                $lead['address'] ?? null,
                $lead['company'],
                $lead['url']     ?? null,
                $lead['notes'],
            ]);
            $newClientId = (int)$pdo->lastInsertId();

            // ── Carry the lead's contacts forward ──────────────────
            // Migration 097 added lead_contacts. Each row maps 1:1 to a
            // client_contacts row + its lead_contact_numbers map 1:1 to
            // client_contact_numbers. is_primary + sort_order preserved
            // verbatim so the post-promotion client renders identically.
            $lcStmt = $pdo->prepare('SELECT * FROM lead_contacts WHERE lead_id = ? ORDER BY sort_order, id');
            $lcStmt->execute([$id]);
            $leadContacts = $lcStmt->fetchAll();

            $insContact = $pdo->prepare('INSERT INTO client_contacts
                (client_id, first_name, last_name, position, email, verified, is_primary, sort_order)
                VALUES (?,?,?,?,?,?,?,?)');
            $insNum = $pdo->prepare('INSERT INTO client_contact_numbers
                (contact_id, number, label, sort_order) VALUES (?,?,?,?)');
            $numLookup = $pdo->prepare('SELECT * FROM lead_contact_numbers WHERE contact_id = ? ORDER BY sort_order, id');

            $sawPrimary = false;
            foreach ($leadContacts as $lc) {
                $insContact->execute([
                    $newClientId,
                    $lc['first_name'],
                    $lc['last_name'],
                    $lc['position'],
                    $lc['email'],
                    (int)$lc['verified'],
                    (int)$lc['is_primary'],
                    (int)$lc['sort_order'],
                ]);
                $newContactId = (int)$pdo->lastInsertId();
                if ((int)$lc['is_primary'] === 1) $sawPrimary = true;
                $numLookup->execute([$lc['id']]);
                foreach ($numLookup->fetchAll() as $n) {
                    $insNum->execute([$newContactId, $n['number'], $n['label'], (int)$n['sort_order']]);
                }
            }

            // Legacy fallback: leads created before migration 097 only
            // carry their headline name/email/phone — no lead_contacts
            // rows. Synthesise a primary contact from those so the basic-
            // info card on the new client still renders.
            if (!$leadContacts) {
                $leadName  = trim((string)($lead['name'] ?? ''));
                $space     = strpos($leadName, ' ');
                $firstName = $space === false ? ($leadName ?: 'Primary') : substr($leadName, 0, $space);
                $lastName  = $space === false ? null : (trim(substr($leadName, $space + 1)) ?: null);
                $insContact->execute([
                    $newClientId, $firstName, $lastName, null,
                    $lead['email'] ?: null, 0, 1, 0,
                ]);
                $newContactId = (int)$pdo->lastInsertId();
                if (!empty($lead['phone'])) {
                    $insNum->execute([$newContactId, (string)$lead['phone'], 'mobile', 0]);
                }
                $sawPrimary = true;
            }

            // Failsafe — if no copied row was flagged primary (would only
            // happen on bad data), promote the earliest-inserted contact
            // so the basic-info card still has a row to read from.
            if (!$sawPrimary) {
                $first = $pdo->prepare('SELECT id FROM client_contacts WHERE client_id = ? ORDER BY id LIMIT 1');
                $first->execute([$newClientId]);
                $firstId = (int)($first->fetchColumn() ?: 0);
                if ($firstId) {
                    $pdo->prepare('UPDATE client_contacts SET is_primary = 1 WHERE id = ?')->execute([$firstId]);
                }
            }

            // ── Carry the lead's notes forward ─────────────────────
            // lead_notes → client_notes. Same schema (title/body/
            // sort_order); we preserve created_at so the timeline on the
            // client matches the timeline that was on the lead.
            $pdo->prepare(
                'INSERT INTO client_notes (client_id, title, body, sort_order, created_at, updated_at)
                 SELECT ?, title, body, sort_order, created_at, updated_at
                 FROM lead_notes WHERE lead_id = ?'
            )->execute([$newClientId, $id]);

            $pdo->prepare('DELETE FROM leads WHERE id = ?')->execute([$id]);

            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }

        Json::send(['ok' => true, 'client_id' => $newClientId], 201);
    }

    if ($method === 'GET') Json::send(['lead' => $lead]);

    if ($method === 'PUT') {
        $body = Json::readBody();
        $name = trim((string)($body['name'] ?? $lead['name']));
        if ($name === '') Json::fail('Name is required', 400);
        $email = trim((string)($body['email'] ?? $lead['email'] ?? ''));
        if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) Json::fail('Invalid email', 400);

        $status = array_key_exists('status', $body) ? (string)$body['status'] : (string)$lead['status'];
        if (!in_array($status, $allowedStatuses, true)) Json::fail('Invalid status', 400);

        // Resolve the new fields with the existing-row value as the default
        // so partial-update PUTs (e.g. the inline status toggle on the
        // list) don't accidentally null fields out.
        $industry = array_key_exists('industry', $body)
            ? (trim((string)$body['industry']) ?: null)
            : ($lead['industry'] ?? null);

        $serviceId = $lead['service_offering_id'] ?? null;
        if (array_key_exists('service_offering_id', $body)) {
            $raw = $body['service_offering_id'];
            if ($raw === null || $raw === '' || $raw === 0 || $raw === '0') {
                $serviceId = null;
            } else {
                $serviceId = (int)$raw;
                $check = $pdo->prepare('SELECT 1 FROM service_offerings WHERE id = ?');
                $check->execute([$serviceId]);
                if (!$check->fetchColumn()) Json::fail('Invalid service_offering_id', 400);
            }
        }

        // contacted_at can be sent as a `contacted` boolean (true ⇒ NOW(),
        // false ⇒ clear) or a literal timestamp string. Falling through to
        // the existing column value when neither key is present.
        $contactedAt = $lead['contacted_at'] ?? null;
        if (array_key_exists('contacted_at', $body)) {
            $contactedAt = $body['contacted_at'] ?: null;
        } elseif (array_key_exists('contacted', $body)) {
            $contactedAt = !empty($body['contacted'])
                ? ($lead['contacted_at'] ?: date('Y-m-d H:i:s'))
                : null;
        }

        $upd = $pdo->prepare('UPDATE leads
            SET name=?, email=?, phone=?, address=?, company=?, url=?, notes=?, status=?, source=?,
                industry=?, service_offering_id=?, contacted_at=?
            WHERE id = ?');
        $upd->execute([
            $name,
            $email !== '' ? $email : null,
            trim((string)($body['phone']   ?? $lead['phone']   ?? '')) ?: null,
            array_key_exists('address', $body) ? ($body['address'] ?: null) : ($lead['address'] ?? null),
            trim((string)($body['company'] ?? $lead['company'] ?? '')) ?: null,
            trim((string)($body['url']     ?? $lead['url']     ?? '')) ?: null,
            array_key_exists('notes', $body) ? $body['notes'] : $lead['notes'],
            $status,
            trim((string)($body['source']  ?? $lead['source']  ?? '')) ?: null,
            $industry,
            $serviceId,
            $contactedAt,
            $id,
        ]);
        Json::send(['ok' => true]);
    }

    if ($method === 'DELETE') {
        $pdo->prepare('DELETE FROM leads WHERE id = ?')->execute([$id]);
        Json::send(['ok' => true]);
    }

    Json::fail('Method not allowed', 405);
};
