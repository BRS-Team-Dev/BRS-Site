<?php
declare(strict_types=1);

use BRS\Auth;
use BRS\Db;
use BRS\Json;

/*
 * Standalone clients CRUD — admin-only.
 *
 *   GET    /api/clients
 *   POST   /api/clients
 *   GET    /api/clients/:id
 *   PUT    /api/clients/:id
 *   DELETE /api/clients/:id
 */

/*
 * Recruitment-service glue now lives in the shared lib BRS\Recruitment so
 * routes/recruitment.php can use it too (the API loads one route file per
 * request). These thin wrappers keep the existing call sites in this file
 * working. attach now returns bool (true = newly attached) so the caller can
 * spawn a recruitment role exactly once.
 */
function getRecruitmentServiceOfferingId(\PDO $pdo): ?int {
    return \BRS\Recruitment::offeringId($pdo);
}
function attachRecruitmentService(\PDO $pdo, int $clientId): bool {
    return \BRS\Recruitment::attachToClient($pdo, $clientId);
}
function detachRecruitmentService(\PDO $pdo, int $clientId): void {
    \BRS\Recruitment::detachFromClient($pdo, $clientId);
}

return function (string $method, array $segs): void {
    Auth::require();
    $pdo = Db::pdo();

    if (!isset($segs[1])) {
        if ($method === 'GET') {
            // Hard upper bound so the unbounded list can't blow up the
            // payload as the company grows. Real pagination is a follow-up.
            // Optional `?is_recruitment=1` — the Recruitment system uses
            // this to fetch only its clients. Source of truth is whether
            // the "Recruitment" service offering is attached on
            // `client_service_offerings`, NOT the legacy
            // `clients.is_recruitment_client` flag column. The flag stays
            // in sync as a side effect of POST/PUT but isn't queried here.
            if (isset($_GET['is_recruitment'])) {
                $sid = getRecruitmentServiceOfferingId($pdo);
                if (!$sid) Json::send(['clients' => []]);
                $want = !empty($_GET['is_recruitment']);
                $sql  = $want
                    ? 'SELECT c.* FROM clients c
                        WHERE EXISTS (SELECT 1 FROM client_service_offerings cso
                                       WHERE cso.client_id = c.id AND cso.service_offering_id = ?)
                        ORDER BY c.id DESC LIMIT 1000'
                    : 'SELECT c.* FROM clients c
                        WHERE NOT EXISTS (SELECT 1 FROM client_service_offerings cso
                                           WHERE cso.client_id = c.id AND cso.service_offering_id = ?)
                        ORDER BY c.id DESC LIMIT 1000';
                $stmt = $pdo->prepare($sql);
                $stmt->execute([$sid]);
                Json::send(['clients' => $stmt->fetchAll()]);
            }
            $stmt = $pdo->query('SELECT * FROM clients ORDER BY id DESC LIMIT 1000');
            Json::send(['clients' => $stmt->fetchAll()]);
        }
        if ($method === 'POST') {
            $body = Json::readBody();
            $name = trim((string)($body['name'] ?? ''));
            if ($name === '') Json::fail('Name is required', 400);
            $email = trim((string)($body['email'] ?? ''));
            if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) Json::fail('Invalid email', 400);

            $ins = $pdo->prepare('INSERT INTO clients (name, email, phone, address, company, url, notes, is_recruitment_client) VALUES (?,?,?,?,?,?,?,?)');
            $ins->execute([
                $name,
                $email !== '' ? $email : null,
                trim((string)($body['phone']   ?? '')) ?: null,
                $body['address']                       ?? null,
                trim((string)($body['company'] ?? '')) ?: null,
                trim((string)($body['url']     ?? '')) ?: null,
                $body['notes'] ?? null,
                !empty($body['is_recruitment_client']) ? 1 : 0,
            ]);
            $newId = (int)$pdo->lastInsertId();
            // Replay every audience='client' contract template as a pending
            // client_documents row so the new client matches the existing
            // cohort. Helper lives in lib/Contracts.php (autoloaded).
            \BRS\Contracts::fanOutToNewEntity($pdo, 'client', $newId);
            // If created from the Recruitment Clients page, the flag is
            // already saved on the row — also attach the Recruitment
            // service offering so the cross-cut driving the
            // Recruitment client list stays consistent.
            if (!empty($body['is_recruitment_client'])) {
                // Newly a recruitment client → spawn a blank role (which mirrors
                // itself as a Recruitment service row) so they appear on both
                // sides immediately.
                \BRS\Recruitment::ensureRecruitmentClient($pdo, $newId);
            }
            Json::send(['id' => $newId], 201);
        }
        Json::fail('Method not allowed', 405);
    }

    $id = (int)$segs[1];
    if ($id <= 0) Json::fail('Invalid id', 400);

    $stmt = $pdo->prepare('SELECT * FROM clients WHERE id = ?');
    $stmt->execute([$id]);
    $client = $stmt->fetch();
    if (!$client) Json::fail('Client not found', 404);

    // /api/clients/:id/contacts[/:cid]
    if (($segs[2] ?? '') === 'contacts') {
        $cid = isset($segs[3]) ? (int)$segs[3] : null;

        // Helper to load all contacts (with their numbers) for this client.
        $loadAll = function () use ($pdo, $id) {
            $rows = $pdo->prepare('SELECT * FROM client_contacts WHERE client_id = ? ORDER BY sort_order, id');
            $rows->execute([$id]);
            $contacts = $rows->fetchAll();
            if (!$contacts) return [];
            $ids   = array_map(fn($c) => (int)$c['id'], $contacts);
            $place = implode(',', array_fill(0, count($ids), '?'));
            $nums  = $pdo->prepare("SELECT * FROM client_contact_numbers WHERE contact_id IN ($place) ORDER BY sort_order, id");
            $nums->execute($ids);
            $byContact = [];
            foreach ($nums->fetchAll() as $n) { $byContact[(int)$n['contact_id']][] = $n; }
            foreach ($contacts as &$c) { $c['numbers'] = $byContact[(int)$c['id']] ?? []; }
            unset($c);
            return $contacts;
        };

        // Replace the numbers list for a contact in place.
        $writeNumbers = function (int $contactId, array $numbers) use ($pdo) {
            $pdo->prepare('DELETE FROM client_contact_numbers WHERE contact_id = ?')->execute([$contactId]);
            $ins = $pdo->prepare('INSERT INTO client_contact_numbers (contact_id, number, label, sort_order) VALUES (?,?,?,?)');
            $sort = 0;
            foreach ($numbers as $n) {
                if (!is_array($n)) continue;
                $num = trim((string)($n['number'] ?? ''));
                if ($num === '') continue;
                $ins->execute([$contactId, $num, trim((string)($n['label'] ?? '')) ?: null, $sort++]);
            }
        };

        // Promote one contact to primary, demoting any other primary contacts
        // for the same client. Run inside a transaction so we never end up
        // with zero or two primaries.
        $setPrimary = function (int $clientId, int $contactId) use ($pdo) {
            $pdo->beginTransaction();
            try {
                $pdo->prepare('UPDATE client_contacts SET is_primary = 0 WHERE client_id = ? AND id <> ?')
                    ->execute([$clientId, $contactId]);
                $pdo->prepare('UPDATE client_contacts SET is_primary = 1 WHERE client_id = ? AND id = ?')
                    ->execute([$clientId, $contactId]);
                $pdo->commit();
            } catch (\Throwable $e) {
                $pdo->rollBack();
                throw $e;
            }
        };

        // Does this client have any primary contact yet?
        $hasPrimary = function (int $clientId) use ($pdo): bool {
            $stmt = $pdo->prepare('SELECT 1 FROM client_contacts WHERE client_id = ? AND is_primary = 1 LIMIT 1');
            $stmt->execute([$clientId]);
            return (bool)$stmt->fetchColumn();
        };

        if ($cid === null) {
            if ($method === 'GET') Json::send(['contacts' => $loadAll()]);

            if ($method === 'POST') {
                $body  = Json::readBody();
                $first = trim((string)($body['first_name'] ?? ''));
                if ($first === '') Json::fail('First name is required', 400);
                $email = trim((string)($body['email'] ?? ''));
                if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) Json::fail('Invalid email', 400);

                // Default to primary when this is the client's first contact, or
                // when caller explicitly asks. Either way we go through setPrimary
                // afterwards so only one is_primary=1 ever lives per client.
                $wantPrimary = !empty($body['is_primary']) || !$hasPrimary($id);

                $ins = $pdo->prepare('INSERT INTO client_contacts
                    (client_id, first_name, last_name, position, email, verified, is_primary, sort_order)
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

        // Item: /api/clients/:id/contacts/:cid
        $cstmt = $pdo->prepare('SELECT * FROM client_contacts WHERE id = ? AND client_id = ?');
        $cstmt->execute([$cid, $id]);
        $contact = $cstmt->fetch();
        if (!$contact) Json::fail('Contact not found', 404);

        // /api/clients/:id/contacts/:cid/primary — set this contact as primary.
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

            $upd = $pdo->prepare('UPDATE client_contacts
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
            // Body explicitly setting is_primary=1 demotes the others.
            if (!empty($body['is_primary']) && (int)$contact['is_primary'] !== 1) {
                $setPrimary($id, $cid);
            }
            Json::send(['ok' => true]);
        }

        if ($method === 'DELETE') {
            $wasPrimary = (int)($contact['is_primary'] ?? 0) === 1;
            $pdo->prepare('DELETE FROM client_contacts WHERE id = ?')->execute([$cid]);
            // If we just removed the primary, promote the earliest-id remaining
            // contact (if any) so the client always has at most one primary
            // and never zero when contacts still exist.
            if ($wasPrimary) {
                $next = $pdo->prepare('SELECT id FROM client_contacts WHERE client_id = ? ORDER BY id LIMIT 1');
                $next->execute([$id]);
                $row = $next->fetch();
                if ($row) $setPrimary($id, (int)$row['id']);
            }
            Json::send(['ok' => true]);
        }

        Json::fail('Method not allowed', 405);
    }

    // /api/clients/:id/accounts[/:aid]
    if (($segs[2] ?? '') === 'accounts') {
        $aid = isset($segs[3]) ? (int)$segs[3] : null;

        if ($aid === null) {
            if ($method === 'GET') {
                $rows = $pdo->prepare('SELECT * FROM client_accounts WHERE client_id = ? ORDER BY sort_order, id');
                $rows->execute([$id]);
                Json::send(['accounts' => $rows->fetchAll()]);
            }
            if ($method === 'POST') {
                $body = Json::readBody();
                $name = trim((string)($body['account_name'] ?? ''));
                if ($name === '') Json::fail('Account name is required', 400);
                $ins = $pdo->prepare('INSERT INTO client_accounts
                    (client_id, account_name, login_url, username, password, sort_order)
                    VALUES (?,?,?,?,?,?)');
                $ins->execute([
                    $id,
                    $name,
                    trim((string)($body['login_url'] ?? '')) ?: null,
                    trim((string)($body['username']  ?? '')) ?: null,
                    (string)($body['password'] ?? '') !== '' ? (string)$body['password'] : null,
                    (int)($body['sort_order'] ?? 0),
                ]);
                Json::send(['id' => (int)$pdo->lastInsertId()], 201);
            }
            Json::fail('Method not allowed', 405);
        }

        $astmt = $pdo->prepare('SELECT * FROM client_accounts WHERE id = ? AND client_id = ?');
        $astmt->execute([$aid, $id]);
        $account = $astmt->fetch();
        if (!$account) Json::fail('Account not found', 404);

        if ($method === 'PUT') {
            $body = Json::readBody();
            $name = trim((string)($body['account_name'] ?? $account['account_name']));
            if ($name === '') Json::fail('Account name is required', 400);
            $upd = $pdo->prepare('UPDATE client_accounts
                SET account_name=?, login_url=?, username=?, password=?, sort_order=?
                WHERE id = ?');
            $upd->execute([
                $name,
                trim((string)($body['login_url'] ?? $account['login_url'] ?? '')) ?: null,
                trim((string)($body['username']  ?? $account['username']  ?? '')) ?: null,
                array_key_exists('password', $body) ? ((string)$body['password'] !== '' ? (string)$body['password'] : null) : $account['password'],
                (int)($body['sort_order'] ?? $account['sort_order']),
                $aid,
            ]);
            Json::send(['ok' => true]);
        }
        if ($method === 'DELETE') {
            $pdo->prepare('DELETE FROM client_accounts WHERE id = ?')->execute([$aid]);
            Json::send(['ok' => true]);
        }
        Json::fail('Method not allowed', 405);
    }

    // POST /api/clients/:id/services — invite + qualify this client to a Services-attached
    // onboarding form in one shot. Body: { form_id }. Idempotent only at the DB level —
    // calling repeatedly creates a new onboarding entry each time, on purpose, so a
    // client can have multiple instances of the same service (e.g. multiple websites).
    if (($segs[2] ?? '') === 'services' && $method === 'POST') {
        $body = Json::readBody();

        // Catalogue service: attach a `service_offerings` row directly to this
        // client (no onboarding / project). Pricing is snapshot at attach time.
        if (!empty($body['service_offering_id'])) {
            $soId = (int)$body['service_offering_id'];
            $so = $pdo->prepare('SELECT * FROM service_offerings WHERE id = ?');
            $so->execute([$soId]);
            $svc = $so->fetch();
            if (!$svc) Json::fail('Service not found', 404);

            // Recruitment is special: each "add" spawns a new recruitment role
            // (1:1 with a service row). The role's mirror service row is created
            // by createDefaultRole, so we don't insert a plain link here.
            if ($soId === \BRS\Recruitment::offeringId($pdo)) {
                $roleId = \BRS\Recruitment::createDefaultRole($pdo, $id);
                Json::send(['ok' => true, 'recruitment' => true, 'role_id' => $roleId], 201);
            }

            $payType = in_array($svc['payment_type'], ['one_off', 'recurring'], true) ? $svc['payment_type'] : 'one_off';
            $cadence = $payType === 'recurring' ? $svc['repeat_duration'] : null;
            $ins = $pdo->prepare('INSERT INTO client_service_offerings
                (client_id, service_offering_id, name, price, payment_type, repeat_duration)
                VALUES (?,?,?,?,?,?)');
            $ins->execute([
                $id, $soId, $svc['name'],
                $svc['price'] !== null && $svc['price'] !== '' ? (float)$svc['price'] : null,
                $payType, $cadence,
            ]);
            Json::send(['ok' => true, 'service_link_id' => (int)$pdo->lastInsertId()], 201);
        }

        $formId = !empty($body['form_id']) ? (int)$body['form_id'] : 0;
        if ($formId <= 0) Json::fail('form_id or service_offering_id required', 400);

        $email = trim((string)($client['email'] ?? ''));
        if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            Json::fail('Client has no valid email — set one before linking services', 400);
        }

        $form = $pdo->prepare("SELECT id, title, team_id, sidenav_placement, sidenav_parent_key
                               FROM forms WHERE id = ? AND form_type = 'onboarding'");
        $form->execute([$formId]);
        $f = $form->fetch();
        if (!$f) Json::fail('Onboarding form not found', 404);
        if ($f['sidenav_placement'] !== 'child' || $f['sidenav_parent_key'] !== 'services') {
            Json::fail('Form is not attached to Services', 400);
        }

        $token = bin2hex(random_bytes(32));
        $ins = $pdo->prepare("INSERT INTO onboarding_clients
            (form_id, client_email, client_name, client_token, qualified_at)
            VALUES (?,?,?,?, NOW())");
        $ins->execute([$formId, $email, $client['name'] ?? null, $token]);
        $ocid = (int)$pdo->lastInsertId();

        // Auto-create the task project, mirroring the qualify handler. Linked to the
        // client by id directly here since we have it; team comes from the form.
        $newProjectId = null;
        if (!empty($f['team_id'])) {
            $clientLabel = trim((string)($client['name'] ?? '')) ?: $email;
            $projectName = trim((string)$f['title']) . ' — ' . $clientLabel;
            $base = preg_replace('/[^a-z0-9]+/', '-', strtolower($projectName));
            $base = trim($base, '-');
            if ($base === '') $base = 'project';
            $slug = substr($base, 0, 60) . '-' . $ocid;
            $insP = $pdo->prepare('INSERT INTO task_projects
                (team_id, slug, name, description, client_id, status, onboarding_client_id)
                VALUES (?,?,?,?,?,?,?)');
            $insP->execute([
                (int)$f['team_id'],
                $slug,
                $projectName,
                'Auto-created from onboarding qualification.',
                $id,
                'new',
                $ocid,
            ]);
            $newProjectId = (int)$pdo->lastInsertId();
        }

        Json::send([
            'ok' => true,
            'onboarding_client_id' => $ocid,
            'project_id'           => $newProjectId,
            'token'                => $token,
        ], 201);
    }

    // DELETE /api/clients/:id/services/offering/:linkId — detach a catalogue
    // service from this client.
    if (($segs[2] ?? '') === 'services' && ($segs[3] ?? '') === 'offering' && $method === 'DELETE') {
        $linkId = isset($segs[4]) ? (int)$segs[4] : 0;
        if ($linkId <= 0) Json::fail('Invalid id', 400);
        // Capture the offering id BEFORE the delete so we can tell whether
        // the user just cut the client's last Recruitment link.
        $look = $pdo->prepare('SELECT role_id, service_offering_id FROM client_service_offerings WHERE id = ? AND client_id = ?');
        $look->execute([$linkId, $id]);
        $row = $look->fetch();
        if (!$row) Json::fail('Service link not found', 404);
        $roleId       = $row['role_id'] ?? null;
        $offeringId   = $row['service_offering_id'] !== null ? (int)$row['service_offering_id'] : null;

        // If this row mirrors a recruitment role, delete the role too (1:1) —
        // the row then cascades away via fk_cso_role. Otherwise just drop the row.
        if ($roleId) {
            $pdo->prepare('DELETE FROM recruitment_roles WHERE id = ?')->execute([(int)$roleId]);
        } else {
            $pdo->prepare('DELETE FROM client_service_offerings WHERE id = ? AND client_id = ?')
                ->execute([$linkId, $id]);
        }

        // If the row we just removed pointed at the Recruitment service AND
        // the client has no Recruitment links left, the client has effectively
        // left Recruitment via the CRM — run the same detach + cleanup that
        // the Recruitment Clients ✕ button uses, so uncompleted roles and
        // in-flight pipeline data get cleared rather than orphaned.
        $recruitSid = \BRS\Recruitment::offeringId($pdo);
        if ($recruitSid && $offeringId === $recruitSid) {
            $chk = $pdo->prepare(
                'SELECT 1 FROM client_service_offerings
                 WHERE client_id = ? AND service_offering_id = ? LIMIT 1'
            );
            $chk->execute([$id, $recruitSid]);
            if (!$chk->fetchColumn()) {
                \BRS\Recruitment::detachFromClient($pdo, $id);
                // Keep the legacy flag column in sync with the link state.
                $pdo->prepare('UPDATE clients SET is_recruitment_client = 0 WHERE id = ?')
                    ->execute([$id]);
            }
        }

        Json::send(['ok' => true]);
    }

    // /api/clients/:id/services — onboarding-form services this client is signed up for.
    // Matches by email between `clients.email` and `onboarding_clients.client_email`,
    // restricted to forms attached to the Services sidenav group (sidenav_parent_key='services').
    // Computes per-service contract figures + aggregates so the frontend just renders.
    if (($segs[2] ?? '') === 'services' && $method === 'GET') {
        $emptyTotals = [
            'total_contract_value' => 0.0,
            'has_indefinite'       => false,
            'total_to_date'        => 0.0,
            'total_incoming'       => 0.0,
            'monthly_value'        => 0.0,
        ];
        $periodsPerMonth = function (?string $rd): float {
            return match ($rd) {
                'weekly'    => 52.0 / 12.0,
                'monthly'   => 1.0,
                'quarterly' => 1.0 / 3.0,
                'yearly'    => 1.0 / 12.0,
                default     => 0.0,
            };
        };
        $monthsBetween = function (\DateTimeImmutable $a, \DateTimeImmutable $b): float {
            $diff = $a->diff($b);
            $months = ($diff->y * 12) + $diff->m + ($diff->d / 30.4375);
            return $diff->invert ? -$months : $months;
        };

        $email = trim((string)($client['email'] ?? ''));

        // Onboarding-based services match this client by email; only qualified
        // onboardings count (an unqualified entry is still mid-onboarding).
        // Skip this query when the client has no email — but DON'T early-return,
        // because catalogue services (below) attach by client_id and must still
        // load for emailless clients.
        $rows = [];
        if ($email !== '') {
            $stmt = $pdo->prepare("
                SELECT oc.id            AS onboarding_client_id,
                       oc.client_email,
                       oc.client_name,
                       oc.started_at,
                       oc.submitted_at,
                       oc.qualified_at,
                       f.id              AS form_id,
                       f.slug            AS form_slug,
                       f.title           AS form_title,
                       f.has_price,
                       f.price,
                       f.payment_type,
                       f.repeat_duration,
                       f.contract_length_months,
                       f.is_indefinite,
                       tp.id             AS project_id,
                       tp.status         AS project_status
                FROM onboarding_clients oc
                JOIN forms f ON f.id = oc.form_id
                LEFT JOIN task_projects tp ON tp.onboarding_client_id = oc.id
                WHERE LOWER(oc.client_email) = LOWER(?)
                  AND f.sidenav_placement = 'child'
                  AND f.sidenav_parent_key = 'services'
                  AND oc.qualified_at IS NOT NULL
                ORDER BY oc.qualified_at DESC, oc.id DESC
            ");
            $stmt->execute([$email]);
            $rows = $stmt->fetchAll();
        }

        // Per-service compute
        $services = [];
        $sumTotal = 0.0;
        $sumToDate = 0.0;
        $sumIncoming = 0.0;
        $sumMonthly = 0.0;
        $hasIndefinite = false;

        $now = new \DateTimeImmutable();

        foreach ($rows as $r) {
            $price = (float)($r['price'] ?? 0);
            $hasPrice = (int)($r['has_price'] ?? 0) === 1 && $price > 0;

            $paymentType = (string)$r['payment_type'];
            $rd = $r['repeat_duration'];
            $contractMonths = $r['contract_length_months'] !== null ? (int)$r['contract_length_months'] : null;
            $indef = (int)($r['is_indefinite'] ?? 0) === 1;

            $startStr = $r['qualified_at'] ?: $r['submitted_at'] ?: $r['started_at'] ?: null;
            $start = $startStr ? new \DateTimeImmutable($startStr) : null;

            $totalValue = null;   // null = indefinite / unbounded
            $toDate = 0.0;
            $incoming = 0.0;
            $monthly = 0.0;
            $contractEnd = null;
            $status = 'active';

            if ($hasPrice) {
                if ($paymentType === 'one_off') {
                    $totalValue = $price;
                    // assume paid at qualification
                    $toDate = $start && $start <= $now ? $price : 0.0;
                    $incoming = $totalValue - $toDate;
                    $monthly = 0.0;
                } else {
                    // recurring
                    $perMonth = $periodsPerMonth($rd);
                    $monthly = $price * $perMonth;

                    if ($indef || !$contractMonths) {
                        $hasIndefinite = true;
                        $totalValue = null;
                        $toDate = $start ? $monthly * max(0.0, $monthsBetween($start, $now)) : 0.0;
                        $incoming = 0.0; // unknown — caller can show "ongoing"
                    } else {
                        $totalValue = $monthly * $contractMonths;
                        if ($start) {
                            $contractEnd = $start->modify("+{$contractMonths} months");
                            $elapsedMonths = min((float)$contractMonths, max(0.0, $monthsBetween($start, $now)));
                            $toDate = $monthly * $elapsedMonths;
                            $incoming = max(0.0, $totalValue - $toDate);
                            if ($now > $contractEnd) $status = 'ended';
                        } else {
                            $toDate = 0.0;
                            $incoming = $totalValue;
                        }
                    }
                }
            }

            $services[] = [
                'kind'                   => 'onboarding',
                'row_key'                => 'ob:' . (int)$r['onboarding_client_id'],
                'service_link_id'        => null,
                'name'                   => $r['form_title'],
                'onboarding_client_id'   => (int)$r['onboarding_client_id'],
                'form_id'                => (int)$r['form_id'],
                'form_slug'              => $r['form_slug'],
                'form_title'             => $r['form_title'],
                'qualified_at'           => $r['qualified_at'],
                'submitted_at'           => $r['submitted_at'],
                'started_at'             => $r['started_at'],
                'has_price'              => (int)($r['has_price'] ?? 0),
                'price'                  => $hasPrice ? $price : null,
                'payment_type'           => $paymentType,
                'repeat_duration'        => $rd,
                'contract_length_months' => $contractMonths,
                'is_indefinite'          => $indef ? 1 : 0,
                'contract_end'           => $contractEnd ? $contractEnd->format('Y-m-d') : null,
                'total_value'            => $totalValue,
                'to_date'                => round($toDate, 2),
                'incoming'               => round($incoming, 2),
                'monthly_value'          => round($monthly, 2),
                'status'                 => $status,
                'project_id'             => $r['project_id'] !== null ? (int)$r['project_id'] : null,
                'project_status'         => $r['project_status'] ?? null,
            ];

            if ($totalValue !== null) $sumTotal += $totalValue;
            $sumToDate += $toDate;
            $sumIncoming += $incoming;
            $sumMonthly += $monthly;
        }

        // Catalogue services attached directly to this client (migration 089).
        // No onboarding/project. Recurring catalogue services have no contract
        // length, so they're treated as indefinite/ongoing; one-off is a single
        // charge at started_at. Recruitment rows are 1:1 with a recruitment role
        // (joined here) and take their contract value from that role's commission.
        $recruitmentOfferingId = \BRS\Recruitment::offeringId($pdo);
        $cat = $pdo->prepare(
            'SELECT cso.*, r.title AS role_title, r.commission_value AS role_commission,
                    r.commission_paid_part AS role_paid_part, r.commission_paid_full AS role_paid_full,
                    r.commission_part_amount AS role_part_amount
             FROM client_service_offerings cso
             LEFT JOIN recruitment_roles r ON r.id = cso.role_id
             WHERE cso.client_id = ? ORDER BY cso.started_at DESC, cso.id DESC'
        );
        $cat->execute([$id]);
        foreach ($cat->fetchAll() as $r) {
            $price = $r['price'] !== null ? (float)$r['price'] : 0.0;
            $hasPrice = $price > 0;
            $paymentType = (string)$r['payment_type'];
            $rd = $r['repeat_duration'];
            $startStr = $r['started_at'] ?: null;
            $start = $startStr ? new \DateTimeImmutable($startStr) : null;

            $totalValue = null; $toDate = 0.0; $incoming = 0.0; $monthly = 0.0; $indef = 0;
            $isRecruitment = $recruitmentOfferingId !== null && (int)$r['service_offering_id'] === $recruitmentOfferingId;

            if ($isRecruitment) {
                // Contract value = this role's agency commission (live). to_date
                // reflects commission already received: full → the whole fee;
                // part → the part amount (defaulting to half when unspecified).
                // incoming = what's still outstanding.
                $commission = $r['role_commission'] !== null ? (float)$r['role_commission'] : 0.0;
                if ((int)($r['role_paid_full'] ?? 0) === 1) {
                    $toDate = $commission;
                } elseif ((int)($r['role_paid_part'] ?? 0) === 1) {
                    $toDate = $r['role_part_amount'] !== null ? min((float)$r['role_part_amount'], $commission) : $commission / 2.0;
                } else {
                    $toDate = 0.0;
                }
                $totalValue = $commission;
                $incoming = max(0.0, $commission - $toDate);
                $price = $commission; // pill reads price; keep it == contract value
                $hasPrice = true;     // show the value column even though snapshot price is null
                $paymentType = 'one_off';
            } elseif ($hasPrice) {
                if ($paymentType === 'one_off') {
                    $totalValue = $price;
                    $toDate = $start && $start <= $now ? $price : 0.0;
                    $incoming = $totalValue - $toDate;
                } else {
                    // recurring → indefinite (catalogue has no contract length)
                    $indef = 1;
                    $hasIndefinite = true;
                    $monthly = $price * $periodsPerMonth($rd);
                    $totalValue = null;
                    $toDate = $start ? $monthly * max(0.0, $monthsBetween($start, $now)) : 0.0;
                }
            }

            // Recruitment rows display the role's title (e.g. "Site Manager"),
            // so each opening reads as its own service. Fall back to the
            // snapshot name for non-recruitment catalogue services.
            $displayName = $isRecruitment ? (trim((string)($r['role_title'] ?? '')) ?: 'Recruitment') : $r['name'];

            $services[] = [
                'kind'                   => 'catalog',
                'row_key'                => 'cs:' . (int)$r['id'],
                'service_link_id'        => (int)$r['id'],
                'name'                   => $displayName,
                'onboarding_client_id'   => null,
                'form_id'                => null,
                'form_slug'              => null,
                'form_title'             => $displayName,
                'qualified_at'           => $r['started_at'],
                'submitted_at'           => null,
                'started_at'             => $r['started_at'],
                'has_price'              => $hasPrice ? 1 : 0,
                'price'                  => $hasPrice ? $price : null,
                'payment_type'           => $paymentType,
                'repeat_duration'        => $rd,
                'contract_length_months' => null,
                'is_indefinite'          => $indef,
                'contract_end'           => null,
                'total_value'            => $totalValue,
                'to_date'                => round($toDate, 2),
                'incoming'               => round($incoming, 2),
                'monthly_value'          => round($monthly, 2),
                'status'                 => 'active',
                'project_id'             => null,
                'project_status'         => null,
            ];

            if ($totalValue !== null) $sumTotal += $totalValue;
            $sumToDate += $toDate;
            $sumIncoming += $incoming;
            $sumMonthly += $monthly;
        }

        Json::send([
            'services' => $services,
            'totals' => [
                'total_contract_value' => round($sumTotal, 2),
                'has_indefinite'       => $hasIndefinite,
                'total_to_date'        => round($sumToDate, 2),
                'total_incoming'       => round($sumIncoming, 2),
                'monthly_value'        => round($sumMonthly, 2),
            ],
        ]);
    }

    // /api/clients/:id/info[/:iid]
    if (($segs[2] ?? '') === 'info') {
        $iid = isset($segs[3]) ? (int)$segs[3] : null;

        if ($iid === null) {
            if ($method === 'GET') {
                $rows = $pdo->prepare('SELECT * FROM client_info WHERE client_id = ? ORDER BY sort_order, id');
                $rows->execute([$id]);
                Json::send(['info' => $rows->fetchAll()]);
            }
            if ($method === 'POST') {
                $body = Json::readBody();
                $name = trim((string)($body['name'] ?? ''));
                if ($name === '') Json::fail('Name is required', 400);
                $ins = $pdo->prepare('INSERT INTO client_info (client_id, name, value, sort_order) VALUES (?,?,?,?)');
                $ins->execute([$id, $name, $body['value'] ?? null, (int)($body['sort_order'] ?? 0)]);
                Json::send(['id' => (int)$pdo->lastInsertId()], 201);
            }
            Json::fail('Method not allowed', 405);
        }

        $istmt = $pdo->prepare('SELECT * FROM client_info WHERE id = ? AND client_id = ?');
        $istmt->execute([$iid, $id]);
        $entry = $istmt->fetch();
        if (!$entry) Json::fail('Info entry not found', 404);

        if ($method === 'PUT') {
            $body = Json::readBody();
            $name = trim((string)($body['name'] ?? $entry['name']));
            if ($name === '') Json::fail('Name is required', 400);
            $upd = $pdo->prepare('UPDATE client_info SET name=?, value=?, sort_order=? WHERE id = ?');
            $upd->execute([
                $name,
                array_key_exists('value', $body) ? $body['value'] : $entry['value'],
                (int)($body['sort_order'] ?? $entry['sort_order']),
                $iid,
            ]);
            Json::send(['ok' => true]);
        }
        if ($method === 'DELETE') {
            $pdo->prepare('DELETE FROM client_info WHERE id = ?')->execute([$iid]);
            Json::send(['ok' => true]);
        }
        Json::fail('Method not allowed', 405);
    }

    // /api/clients/:id/notes[/:nid]
    if (($segs[2] ?? '') === 'notes') {
        $nid = isset($segs[3]) ? (int)$segs[3] : null;

        if ($nid === null) {
            if ($method === 'GET') {
                $rows = $pdo->prepare('SELECT * FROM client_notes WHERE client_id = ? ORDER BY sort_order, id DESC');
                $rows->execute([$id]);
                Json::send(['notes' => $rows->fetchAll()]);
            }
            if ($method === 'POST') {
                $body  = Json::readBody();
                $title = trim((string)($body['title'] ?? ''));
                if ($title === '') Json::fail('Title is required', 400);
                $ins = $pdo->prepare('INSERT INTO client_notes (client_id, title, body, sort_order) VALUES (?,?,?,?)');
                $ins->execute([$id, $title, $body['body'] ?? null, (int)($body['sort_order'] ?? 0)]);
                Json::send(['id' => (int)$pdo->lastInsertId()], 201);
            }
            Json::fail('Method not allowed', 405);
        }

        $nstmt = $pdo->prepare('SELECT * FROM client_notes WHERE id = ? AND client_id = ?');
        $nstmt->execute([$nid, $id]);
        $note = $nstmt->fetch();
        if (!$note) Json::fail('Note not found', 404);

        if ($method === 'PUT') {
            $body  = Json::readBody();
            $title = trim((string)($body['title'] ?? $note['title']));
            if ($title === '') Json::fail('Title is required', 400);
            $upd = $pdo->prepare('UPDATE client_notes SET title=?, body=?, sort_order=? WHERE id = ?');
            $upd->execute([
                $title,
                array_key_exists('body', $body) ? $body['body'] : $note['body'],
                (int)($body['sort_order'] ?? $note['sort_order']),
                $nid,
            ]);
            Json::send(['ok' => true]);
        }
        if ($method === 'DELETE') {
            $pdo->prepare('DELETE FROM client_notes WHERE id = ?')->execute([$nid]);
            Json::send(['ok' => true]);
        }
        Json::fail('Method not allowed', 405);
    }

    if ($method === 'GET') Json::send(['client' => $client]);

    if ($method === 'PUT') {
        $body = Json::readBody();
        $name = trim((string)($body['name'] ?? $client['name']));
        if ($name === '') Json::fail('Name is required', 400);
        $email = trim((string)($body['email'] ?? $client['email'] ?? ''));
        if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) Json::fail('Invalid email', 400);

        $newIsRecruit = array_key_exists('is_recruitment_client', $body)
            ? (!empty($body['is_recruitment_client']) ? 1 : 0)
            : (int)($client['is_recruitment_client'] ?? 0);

        $upd = $pdo->prepare('UPDATE clients SET name=?, email=?, phone=?, address=?, company=?, url=?, notes=?, is_recruitment_client=? WHERE id = ?');
        $upd->execute([
            $name,
            $email !== '' ? $email : null,
            trim((string)($body['phone']   ?? $client['phone']   ?? '')) ?: null,
            array_key_exists('address', $body) ? ($body['address'] ?: null) : ($client['address'] ?? null),
            trim((string)($body['company'] ?? $client['company'] ?? '')) ?: null,
            trim((string)($body['url']     ?? $client['url']     ?? '')) ?: null,
            $body['notes'] ?? $client['notes'],
            $newIsRecruit,
            $id,
        ]);

        // Sync the Recruitment service link to match the caller's intent.
        // Both helpers are idempotent (attach is a no-op if already linked;
        // detach is just a DELETE), so we don't need to compare old vs new
        // — that earlier diff was actually a bug: a request to "set to 0"
        // skipped detach when the flag was already 0 while the link still
        // existed (an out-of-sync state). Now: if the caller said
        // `is_recruitment_client=N`, we make the link match N.
        if (array_key_exists('is_recruitment_client', $body)) {
            if ($newIsRecruit) \BRS\Recruitment::ensureRecruitmentClient($pdo, $id);
            else               detachRecruitmentService($pdo, $id);
        }

        Json::send(['ok' => true]);
    }

    if ($method === 'DELETE') {
        $pdo->prepare('DELETE FROM clients WHERE id = ?')->execute([$id]);
        Json::send(['ok' => true]);
    }

    Json::fail('Method not allowed', 405);
};
