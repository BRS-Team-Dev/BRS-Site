<?php
declare(strict_types=1);

use BRS\Auth;
use BRS\Db;
use BRS\Json;

/*
 * Tenders CRUD — admin-only. Lives under the Operations system at
 * /operations/tenders. Mirrors the leads.php pattern (simple resource +
 * standard list-detail-edit flow); no notes/info subtables yet — those
 * can be added when the tender pipeline needs more depth.
 *
 *   GET    /api/tenders
 *   POST   /api/tenders
 *   GET    /api/tenders/:id
 *   PUT    /api/tenders/:id
 *   DELETE /api/tenders/:id
 */

return function (string $method, array $segs): void {
    Auth::require();
    $pdo = Db::tpdo();

    $allowedStatuses = ['planning', 'drafting', 'submitted', 'awarded', 'rejected', 'withdrawn'];

    // ───── /api/tenders/tracker — reminders dashboard ─────────────────
    if (($segs[1] ?? '') === 'tracker') {
        if ($method !== 'GET') Json::fail('Method not allowed', 405);

        $threshold = 7; // "due soon" window in days
        $now       = date('Y-m-d H:i:s');
        $soonAt    = date('Y-m-d H:i:s', strtotime("+{$threshold} days"));

        // 1. Active (still pre-submission) AND overdue
        $overdue = $pdo->prepare(
            "SELECT id, title, buyer, status, submission_deadline
             FROM tenders
             WHERE status IN ('planning','drafting')
               AND submission_deadline IS NOT NULL
               AND submission_deadline < ?
             ORDER BY submission_deadline ASC"
        );
        $overdue->execute([$now]);

        // 2. Active and due in the next N days
        $dueSoon = $pdo->prepare(
            "SELECT id, title, buyer, status, submission_deadline
             FROM tenders
             WHERE status IN ('planning','drafting')
               AND submission_deadline IS NOT NULL
               AND submission_deadline >= ?
               AND submission_deadline <= ?
             ORDER BY submission_deadline ASC"
        );
        $dueSoon->execute([$now, $soonAt]);

        // 3. Submitted, decision date soon or past (follow-up reminder)
        $awaitingDecision = $pdo->prepare(
            "SELECT id, title, buyer, status, decision_date, submission_deadline
             FROM tenders
             WHERE status = 'submitted'
               AND (decision_date IS NULL OR decision_date <= ?)
             ORDER BY decision_date IS NULL, decision_date ASC"
        );
        $awaitingDecision->execute([date('Y-m-d', strtotime("+{$threshold} days"))]);

        // 4. Active tenders that have at least one incomplete required section
        $incomplete = $pdo->query(
            "SELECT t.id, t.title, t.buyer, t.status, t.submission_deadline,
                    SUM(s.is_completed = 0) AS open_sections,
                    COUNT(s.id)             AS total_sections
             FROM tenders t
             JOIN tender_document_sections s ON s.tender_id = t.id
             WHERE t.status IN ('planning','drafting')
             GROUP BY t.id
             HAVING open_sections > 0
             ORDER BY t.submission_deadline IS NULL, t.submission_deadline ASC"
        )->fetchAll();

        // 5. Active tenders that haven't been touched in 14+ days (stale)
        $stale = $pdo->query(
            "SELECT id, title, buyer, status, submission_deadline, updated_at
             FROM tenders
             WHERE status IN ('planning','drafting')
               AND updated_at < DATE_SUB(NOW(), INTERVAL 14 DAY)
             ORDER BY updated_at ASC"
        )->fetchAll();

        Json::send([
            'overdue'           => $overdue->fetchAll(),
            'due_soon'          => $dueSoon->fetchAll(),
            'awaiting_decision' => $awaitingDecision->fetchAll(),
            'incomplete'        => $incomplete,
            'stale'             => $stale,
            'threshold_days'    => $threshold,
        ]);
    }

    // /api/tenders/bulk — batch import (mirrors /api/leads/bulk). Body:
    // { tenders: [{ title, buyer?, reference?, value?, currency?, category?,
    //               source_url?, submission_deadline?, decision_date?,
    //               status?, notes?, sections?: [{slug, label}] }, ...] }.
    // Each row's sections (if provided) are inserted into
    // tender_document_sections in the same transaction. Rows that fail
    // validation are skipped and reported in `errors`. A DB failure on any
    // row rolls the entire batch back.
    if (($segs[1] ?? '') === 'bulk') {
        if ($method !== 'POST') Json::fail('Method not allowed', 405);

        $body    = Json::readBody();
        $tenders = $body['tenders'] ?? null;
        if (!is_array($tenders) || count($tenders) === 0) Json::fail('No tenders provided', 400);

        $inserted = 0;
        $errors   = [];

        $pdo->beginTransaction();
        try {
            $ins = $pdo->prepare(
                'INSERT INTO tenders
                 (title, buyer, reference, value, currency, category, source_url,
                  submission_deadline, decision_date, status, notes)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?)'
            );
            $insSec = $pdo->prepare(
                'INSERT IGNORE INTO tender_document_sections
                 (tender_id, slug, label, sort_order) VALUES (?,?,?,?)'
            );

            foreach ($tenders as $i => $row) {
                $rowNum = $i + 1;
                if (!is_array($row)) {
                    $errors[] = ['row' => $rowNum, 'error' => 'Row is not an object'];
                    continue;
                }
                $title = trim((string)($row['title'] ?? ''));
                if ($title === '') {
                    $errors[] = ['row' => $rowNum, 'error' => 'Title missing'];
                    continue;
                }

                $status = strtolower(trim((string)($row['status'] ?? 'planning')));
                if (!in_array($status, $allowedStatuses, true)) $status = 'planning';

                $currency = strtoupper(trim((string)($row['currency'] ?? 'GBP')));
                if ($currency === '' || strlen($currency) !== 3) $currency = 'GBP';

                $value = $row['value'] ?? null;
                if ($value !== null && $value !== '') {
                    if (!is_numeric($value)) {
                        $errors[] = ['row' => $rowNum, 'error' => 'Value is not numeric'];
                        continue;
                    }
                    $value = (float)$value;
                } else {
                    $value = null;
                }

                $ins->execute([
                    $title,
                    trim((string)($row['buyer']     ?? '')) ?: null,
                    trim((string)($row['reference'] ?? '')) ?: null,
                    $value,
                    $currency,
                    trim((string)($row['category']   ?? '')) ?: null,
                    trim((string)($row['source_url'] ?? '')) ?: null,
                    trim((string)($row['submission_deadline'] ?? '')) ?: null,
                    trim((string)($row['decision_date']       ?? '')) ?: null,
                    $status,
                    $row['notes'] ?? null,
                ]);
                $tenderId = (int)$pdo->lastInsertId();
                $inserted++;

                // Attach required-document sections if provided. Skips silently
                // on dupes (UNIQUE on tender_id+slug) so re-imports are safe.
                $sections = $row['sections'] ?? [];
                if (is_array($sections)) {
                    $sortOrder = 0;
                    foreach ($sections as $s) {
                        if (!is_array($s)) continue;
                        $slug  = trim((string)($s['slug']  ?? ''));
                        $label = trim((string)($s['label'] ?? ''));
                        if ($slug === '' || $label === '') continue;
                        $insSec->execute([$tenderId, $slug, $label, $sortOrder++]);
                    }
                }
            }

            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }

        Json::send(['inserted' => $inserted, 'errors' => $errors], 201);
    }

    if (!isset($segs[1])) {
        if ($method === 'GET') {
            // Order by deadline (soonest first), nulls last, then by id.
            $rows = $pdo->query(
                'SELECT * FROM tenders
                 ORDER BY submission_deadline IS NULL, submission_deadline ASC, id DESC
                 LIMIT 1000'
            )->fetchAll();
            Json::send(['tenders' => $rows]);
        }
        if ($method === 'POST') {
            $body = Json::readBody();
            $title = trim((string)($body['title'] ?? ''));
            if ($title === '') Json::fail('Title is required', 400);

            $status = (string)($body['status'] ?? 'planning');
            if (!in_array($status, $allowedStatuses, true)) $status = 'planning';

            $currency = strtoupper(trim((string)($body['currency'] ?? 'GBP')));
            if ($currency === '' || strlen($currency) !== 3) $currency = 'GBP';

            $value = $body['value'] ?? null;
            if ($value !== null && $value !== '') {
                if (!is_numeric($value)) Json::fail('Value must be a number', 400);
                $value = (float)$value;
            } else {
                $value = null;
            }

            $ins = $pdo->prepare(
                'INSERT INTO tenders
                 (title, buyer, reference, value, currency, category, source_url,
                  submission_deadline, decision_date, status, notes)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?)'
            );
            $ins->execute([
                $title,
                trim((string)($body['buyer']     ?? '')) ?: null,
                trim((string)($body['reference'] ?? '')) ?: null,
                $value,
                $currency,
                trim((string)($body['category']   ?? '')) ?: null,
                trim((string)($body['source_url'] ?? '')) ?: null,
                trim((string)($body['submission_deadline'] ?? '')) ?: null,
                trim((string)($body['decision_date']       ?? '')) ?: null,
                $status,
                $body['notes'] ?? null,
            ]);
            Json::send(['id' => (int)$pdo->lastInsertId()], 201);
        }
        Json::fail('Method not allowed', 405);
    }

    $id = (int)$segs[1];
    if ($id <= 0) Json::fail('Invalid id', 400);

    $stmt = $pdo->prepare('SELECT * FROM tenders WHERE id = ?');
    $stmt->execute([$id]);
    $tender = $stmt->fetch();
    if (!$tender) Json::fail('Tender not found', 404);

    // ───── /api/tenders/:id/sections[/(bulk|:sid[/complete])] ──────
    // Sections drive the Application tab's per-section grouping. Each
    // section can be marked complete; the tracker counts open sections
    // for the "incomplete" reminder bucket.
    if (($segs[2] ?? '') === 'sections') {
        $third = $segs[3] ?? '';

        // Bulk create — used when a new tender is created from the
        // section-picker checkbox list. Body: { sections: [{slug, label}, …] }
        // Skips duplicates silently (unique key on tender_id, slug).
        if ($third === 'bulk') {
            if ($method !== 'POST') Json::fail('Method not allowed', 405);
            $body  = Json::readBody();
            $items = $body['sections'] ?? [];
            if (!is_array($items)) Json::fail('sections must be an array', 400);
            $ins = $pdo->prepare(
                'INSERT IGNORE INTO tender_document_sections (tender_id, slug, label, sort_order)
                 VALUES (?,?,?,?)'
            );
            $created = 0;
            foreach ($items as $i => $s) {
                $slug  = trim((string)($s['slug']  ?? ''));
                $label = trim((string)($s['label'] ?? ''));
                if ($slug === '' || $label === '') continue;
                $ins->execute([$id, $slug, $label, (int)($s['sort_order'] ?? $i)]);
                if ($ins->rowCount() > 0) $created++;
            }
            Json::send(['created' => $created]);
        }

        $sid = (isset($segs[3]) && ctype_digit((string)$segs[3])) ? (int)$segs[3] : null;

        if ($sid === null) {
            if ($method === 'GET') {
                // Sections + their documents, in one round trip. Frontend
                // groups documents by section_id locally.
                $sstmt = $pdo->prepare(
                    'SELECT * FROM tender_document_sections WHERE tender_id = ?
                     ORDER BY sort_order, id'
                );
                $sstmt->execute([$id]);
                $sections = $sstmt->fetchAll();
                $dstmt = $pdo->prepare(
                    'SELECT * FROM tender_documents WHERE tender_id = ?
                     ORDER BY sort_order, id DESC'
                );
                $dstmt->execute([$id]);
                $docs = $dstmt->fetchAll();
                Json::send(['sections' => $sections, 'documents' => $docs]);
            }
            if ($method === 'POST') {
                $body  = Json::readBody();
                $slug  = trim((string)($body['slug']  ?? ''));
                $label = trim((string)($body['label'] ?? ''));
                if ($slug === '' || $label === '') Json::fail('slug and label required', 400);
                try {
                    $ins = $pdo->prepare(
                        'INSERT INTO tender_document_sections (tender_id, slug, label, sort_order)
                         VALUES (?,?,?,?)'
                    );
                    $ins->execute([$id, $slug, $label, (int)($body['sort_order'] ?? 0)]);
                } catch (\PDOException $e) {
                    if ((int)$e->errorInfo[1] === 1062) Json::fail('Section already exists', 409);
                    throw $e;
                }
                Json::send(['id' => (int)$pdo->lastInsertId()], 201);
            }
            Json::fail('Method not allowed', 405);
        }

        // Specific section
        $sstmt = $pdo->prepare('SELECT * FROM tender_document_sections WHERE id = ? AND tender_id = ?');
        $sstmt->execute([$sid, $id]);
        $section = $sstmt->fetch();
        if (!$section) Json::fail('Section not found', 404);

        // /sections/:sid/complete  — toggle / set completion
        if (($segs[4] ?? '') === 'complete') {
            if ($method !== 'POST') Json::fail('Method not allowed', 405);
            $body = Json::readBody();
            $val  = array_key_exists('is_completed', $body)
                ? (!empty($body['is_completed']) ? 1 : 0)
                : ((int)$section['is_completed'] === 1 ? 0 : 1);
            $pdo->prepare('UPDATE tender_document_sections SET is_completed = ? WHERE id = ?')
                ->execute([$val, $sid]);
            Json::send(['ok' => true, 'is_completed' => $val]);
        }

        if ($method === 'PUT') {
            $body  = Json::readBody();
            $label = trim((string)($body['label'] ?? $section['label']));
            if ($label === '') Json::fail('label required', 400);
            $pdo->prepare(
                'UPDATE tender_document_sections
                 SET label = ?, sort_order = ?, is_completed = ?
                 WHERE id = ?'
            )->execute([
                $label,
                (int)($body['sort_order'] ?? $section['sort_order']),
                array_key_exists('is_completed', $body)
                    ? (!empty($body['is_completed']) ? 1 : 0)
                    : (int)$section['is_completed'],
                $sid,
            ]);
            Json::send(['ok' => true]);
        }
        if ($method === 'DELETE') {
            // Documents referencing this section get section_id = NULL via
            // ON DELETE SET NULL; they don't disappear.
            $pdo->prepare('DELETE FROM tender_document_sections WHERE id = ?')->execute([$sid]);
            Json::send(['ok' => true]);
        }
        Json::fail('Method not allowed', 405);
    }

    // ───── /api/tenders/:id/info[/:iid] ─────────────────────────────
    if (($segs[2] ?? '') === 'info') {
        $iid = isset($segs[3]) ? (int)$segs[3] : null;
        if ($iid === null) {
            if ($method === 'GET') {
                $rows = $pdo->prepare('SELECT * FROM tender_info WHERE tender_id = ? ORDER BY sort_order, id');
                $rows->execute([$id]);
                Json::send(['info' => $rows->fetchAll()]);
            }
            if ($method === 'POST') {
                $body = Json::readBody();
                $name = trim((string)($body['name'] ?? ''));
                if ($name === '') Json::fail('Name is required', 400);
                $ins = $pdo->prepare('INSERT INTO tender_info (tender_id, name, value, sort_order) VALUES (?,?,?,?)');
                $ins->execute([$id, $name, $body['value'] ?? null, (int)($body['sort_order'] ?? 0)]);
                Json::send(['id' => (int)$pdo->lastInsertId()], 201);
            }
            Json::fail('Method not allowed', 405);
        }
        $istmt = $pdo->prepare('SELECT * FROM tender_info WHERE id = ? AND tender_id = ?');
        $istmt->execute([$iid, $id]);
        $entry = $istmt->fetch();
        if (!$entry) Json::fail('Info entry not found', 404);
        if ($method === 'PUT') {
            $body = Json::readBody();
            $name = trim((string)($body['name'] ?? $entry['name']));
            if ($name === '') Json::fail('Name is required', 400);
            $pdo->prepare('UPDATE tender_info SET name=?, value=?, sort_order=? WHERE id = ?')->execute([
                $name,
                array_key_exists('value', $body) ? $body['value'] : $entry['value'],
                (int)($body['sort_order'] ?? $entry['sort_order']),
                $iid,
            ]);
            Json::send(['ok' => true]);
        }
        if ($method === 'DELETE') {
            $pdo->prepare('DELETE FROM tender_info WHERE id = ?')->execute([$iid]);
            Json::send(['ok' => true]);
        }
        Json::fail('Method not allowed', 405);
    }

    // ───── /api/tenders/:id/notes[/:nid] ────────────────────────────
    if (($segs[2] ?? '') === 'notes') {
        $nid = isset($segs[3]) ? (int)$segs[3] : null;
        if ($nid === null) {
            if ($method === 'GET') {
                $rows = $pdo->prepare('SELECT * FROM tender_notes WHERE tender_id = ? ORDER BY sort_order, id DESC');
                $rows->execute([$id]);
                Json::send(['notes' => $rows->fetchAll()]);
            }
            if ($method === 'POST') {
                $body  = Json::readBody();
                $title = trim((string)($body['title'] ?? ''));
                if ($title === '') Json::fail('Title is required', 400);
                $ins = $pdo->prepare('INSERT INTO tender_notes (tender_id, title, body, sort_order) VALUES (?,?,?,?)');
                $ins->execute([$id, $title, $body['body'] ?? null, (int)($body['sort_order'] ?? 0)]);
                Json::send(['id' => (int)$pdo->lastInsertId()], 201);
            }
            Json::fail('Method not allowed', 405);
        }
        $nstmt = $pdo->prepare('SELECT * FROM tender_notes WHERE id = ? AND tender_id = ?');
        $nstmt->execute([$nid, $id]);
        $note = $nstmt->fetch();
        if (!$note) Json::fail('Note not found', 404);
        if ($method === 'PUT') {
            $body  = Json::readBody();
            $title = trim((string)($body['title'] ?? $note['title']));
            if ($title === '') Json::fail('Title is required', 400);
            $pdo->prepare('UPDATE tender_notes SET title=?, body=?, sort_order=? WHERE id = ?')->execute([
                $title,
                array_key_exists('body', $body) ? $body['body'] : $note['body'],
                (int)($body['sort_order'] ?? $note['sort_order']),
                $nid,
            ]);
            Json::send(['ok' => true]);
        }
        if ($method === 'DELETE') {
            $pdo->prepare('DELETE FROM tender_notes WHERE id = ?')->execute([$nid]);
            Json::send(['ok' => true]);
        }
        Json::fail('Method not allowed', 405);
    }

    // ───── /api/tenders/:id/contacts[/:cid[/numbers[/:nid]]] ────────
    if (($segs[2] ?? '') === 'contacts') {
        $cid = isset($segs[3]) ? (int)$segs[3] : null;

        if ($cid === null) {
            if ($method === 'GET') {
                $rows = $pdo->prepare('SELECT * FROM tender_contacts WHERE tender_id = ? ORDER BY sort_order, id');
                $rows->execute([$id]);
                $contacts = $rows->fetchAll();
                // Attach numbers per contact in a single batched query.
                if ($contacts) {
                    $ids = array_column($contacts, 'id');
                    $place = implode(',', array_fill(0, count($ids), '?'));
                    $nstmt = $pdo->prepare("SELECT * FROM tender_contact_numbers WHERE contact_id IN ($place) ORDER BY sort_order, id");
                    $nstmt->execute($ids);
                    $byContact = [];
                    foreach ($nstmt->fetchAll() as $n) $byContact[(int)$n['contact_id']][] = $n;
                    foreach ($contacts as &$c) $c['numbers'] = $byContact[(int)$c['id']] ?? [];
                }
                Json::send(['contacts' => $contacts]);
            }
            if ($method === 'POST') {
                $body = Json::readBody();
                $first = trim((string)($body['first_name'] ?? ''));
                if ($first === '') Json::fail('First name is required', 400);
                $ins = $pdo->prepare('INSERT INTO tender_contacts (tender_id, first_name, last_name, position, email, is_primary, sort_order) VALUES (?,?,?,?,?,?,?)');
                $ins->execute([
                    $id, $first,
                    trim((string)($body['last_name'] ?? '')) ?: null,
                    trim((string)($body['position']  ?? '')) ?: null,
                    trim((string)($body['email']     ?? '')) ?: null,
                    !empty($body['is_primary']) ? 1 : 0,
                    (int)($body['sort_order'] ?? 0),
                ]);
                $newId = (int)$pdo->lastInsertId();
                if (!empty($body['numbers']) && is_array($body['numbers'])) {
                    $nins = $pdo->prepare('INSERT INTO tender_contact_numbers (contact_id, number, label, sort_order) VALUES (?,?,?,?)');
                    foreach ($body['numbers'] as $i => $n) {
                        $num = trim((string)($n['number'] ?? ''));
                        if ($num === '') continue;
                        $nins->execute([$newId, $num, trim((string)($n['label'] ?? '')) ?: null, $i]);
                    }
                }
                Json::send(['id' => $newId], 201);
            }
            Json::fail('Method not allowed', 405);
        }

        $cstmt = $pdo->prepare('SELECT * FROM tender_contacts WHERE id = ? AND tender_id = ?');
        $cstmt->execute([$cid, $id]);
        $contact = $cstmt->fetch();
        if (!$contact) Json::fail('Contact not found', 404);

        // /api/tenders/:id/contacts/:cid/numbers[/:nid]
        if (($segs[4] ?? '') === 'numbers') {
            $nid = isset($segs[5]) ? (int)$segs[5] : null;
            if ($nid === null) {
                if ($method === 'POST') {
                    $body = Json::readBody();
                    $num  = trim((string)($body['number'] ?? ''));
                    if ($num === '') Json::fail('Number is required', 400);
                    $ins = $pdo->prepare('INSERT INTO tender_contact_numbers (contact_id, number, label, sort_order) VALUES (?,?,?,?)');
                    $ins->execute([$cid, $num, trim((string)($body['label'] ?? '')) ?: null, (int)($body['sort_order'] ?? 0)]);
                    Json::send(['id' => (int)$pdo->lastInsertId()], 201);
                }
                Json::fail('Method not allowed', 405);
            }
            if ($method === 'DELETE') {
                $pdo->prepare('DELETE FROM tender_contact_numbers WHERE id = ? AND contact_id = ?')->execute([$nid, $cid]);
                Json::send(['ok' => true]);
            }
            Json::fail('Method not allowed', 405);
        }

        if ($method === 'PUT') {
            $body = Json::readBody();
            $first = trim((string)($body['first_name'] ?? $contact['first_name']));
            if ($first === '') Json::fail('First name is required', 400);
            $pdo->prepare('UPDATE tender_contacts SET first_name=?, last_name=?, position=?, email=?, is_primary=?, sort_order=? WHERE id = ?')->execute([
                $first,
                array_key_exists('last_name', $body) ? (trim((string)$body['last_name']) ?: null) : $contact['last_name'],
                array_key_exists('position',  $body) ? (trim((string)$body['position'])  ?: null) : $contact['position'],
                array_key_exists('email',     $body) ? (trim((string)$body['email'])     ?: null) : $contact['email'],
                array_key_exists('is_primary', $body) ? (!empty($body['is_primary']) ? 1 : 0) : (int)$contact['is_primary'],
                (int)($body['sort_order'] ?? $contact['sort_order']),
                $cid,
            ]);
            // Optional bulk numbers replace
            if (array_key_exists('numbers', $body) && is_array($body['numbers'])) {
                $pdo->prepare('DELETE FROM tender_contact_numbers WHERE contact_id = ?')->execute([$cid]);
                $nins = $pdo->prepare('INSERT INTO tender_contact_numbers (contact_id, number, label, sort_order) VALUES (?,?,?,?)');
                foreach ($body['numbers'] as $i => $n) {
                    $num = trim((string)($n['number'] ?? ''));
                    if ($num === '') continue;
                    $nins->execute([$cid, $num, trim((string)($n['label'] ?? '')) ?: null, $i]);
                }
            }
            Json::send(['ok' => true]);
        }
        if ($method === 'DELETE') {
            $pdo->prepare('DELETE FROM tender_contacts WHERE id = ?')->execute([$cid]);
            Json::send(['ok' => true]);
        }
        Json::fail('Method not allowed', 405);
    }

    // ───── /api/tenders/:id/documents[/:did[/upload]] ───────────────
    // Filter by ?kind=application|proposal|pitch_deck on GET.
    if (($segs[2] ?? '') === 'documents') {
        $allowedKinds = ['application', 'proposal', 'pitch_deck'];
        // /documents/upload comes in as $segs[3] === 'upload'; numeric ids
        // (for PUT/DELETE on a specific doc) come in as $segs[3] === '123'.
        $did = (isset($segs[3]) && ctype_digit((string)$segs[3])) ? (int)$segs[3] : null;

        // /documents/upload — multipart file upload (now keyed by section_id)
        if (($segs[3] ?? '') === 'upload') {
            if ($method !== 'POST') Json::fail('Method not allowed', 405);
            if (empty($_FILES['file'])) Json::fail('file required', 400);
            $f = $_FILES['file'];
            if ($f['error'] !== UPLOAD_ERR_OK) Json::fail('upload failed (code ' . $f['error'] . ')', 400);

            // section_id is the new primary grouping; legacy `kind` accepted
            // for backwards compat but no longer required.
            $sectionId = isset($_POST['section_id']) && $_POST['section_id'] !== ''
                ? (int)$_POST['section_id'] : null;
            $kind = isset($_POST['kind']) && in_array($_POST['kind'], $allowedKinds, true)
                ? (string)$_POST['kind'] : null;

            // Validate section belongs to this tender so callers can't smuggle
            // a foreign section id.
            if ($sectionId !== null) {
                $check = $pdo->prepare('SELECT 1 FROM tender_document_sections WHERE id = ? AND tender_id = ?');
                $check->execute([$sectionId, $id]);
                if (!$check->fetchColumn()) Json::fail('Invalid section_id for this tender', 400);
            }

            $title = trim((string)($_POST['title'] ?? $f['name']));
            if ($title === '') $title = $f['name'];
            $description = trim((string)($_POST['description'] ?? '')) ?: null;

            $dir = __DIR__ . '/../../uploads/tenders/' . $id;
            if (!is_dir($dir)) @mkdir($dir, 0775, true);
            $safe = preg_replace('/[^A-Za-z0-9._-]+/', '_', basename($f['name']));
            $name = time() . '_' . $safe;
            $dest = $dir . '/' . $name;
            if (!move_uploaded_file($f['tmp_name'], $dest)) Json::fail('failed to save file', 500);

            $rel = 'uploads/tenders/' . $id . '/' . $name;
            $ins = $pdo->prepare(
                'INSERT INTO tender_documents
                 (tender_id, section_id, kind, title, description, file_path, file_size, mime_type, sort_order)
                 VALUES (?,?,?,?,?,?,?,?,?)'
            );
            $ins->execute([
                $id, $sectionId, $kind, $title, $description,
                $rel, (int)$f['size'], (string)($f['type'] ?? ''),
                (int)($_POST['sort_order'] ?? 0),
            ]);
            Json::send(['id' => (int)$pdo->lastInsertId()], 201);
        }

        if ($did === null) {
            if ($method === 'GET') {
                $kindFilter = isset($_GET['kind']) ? (string)$_GET['kind'] : null;
                if ($kindFilter !== null && !in_array($kindFilter, $allowedKinds, true)) {
                    Json::fail('Invalid kind', 400);
                }
                $sql = 'SELECT * FROM tender_documents WHERE tender_id = ?';
                $params = [$id];
                if ($kindFilter) { $sql .= ' AND kind = ?'; $params[] = $kindFilter; }
                $sql .= ' ORDER BY sort_order, id DESC';
                $rows = $pdo->prepare($sql);
                $rows->execute($params);
                Json::send(['documents' => $rows->fetchAll()]);
            }
            if ($method === 'POST') {
                $body = Json::readBody();
                $title = trim((string)($body['title'] ?? ''));
                if ($title === '') Json::fail('Title is required', 400);

                $sectionId = isset($body['section_id']) && $body['section_id'] !== '' && $body['section_id'] !== null
                    ? (int)$body['section_id'] : null;
                if ($sectionId !== null) {
                    $check = $pdo->prepare('SELECT 1 FROM tender_document_sections WHERE id = ? AND tender_id = ?');
                    $check->execute([$sectionId, $id]);
                    if (!$check->fetchColumn()) Json::fail('Invalid section_id for this tender', 400);
                }
                $kind = isset($body['kind']) && in_array($body['kind'], $allowedKinds, true)
                    ? (string)$body['kind'] : null;

                $ins = $pdo->prepare(
                    'INSERT INTO tender_documents
                     (tender_id, section_id, kind, title, description, external_url, sort_order)
                     VALUES (?,?,?,?,?,?,?)'
                );
                $ins->execute([
                    $id, $sectionId, $kind, $title,
                    trim((string)($body['description']  ?? '')) ?: null,
                    trim((string)($body['external_url'] ?? '')) ?: null,
                    (int)($body['sort_order'] ?? 0),
                ]);
                Json::send(['id' => (int)$pdo->lastInsertId()], 201);
            }
            Json::fail('Method not allowed', 405);
        }

        $dstmt = $pdo->prepare('SELECT * FROM tender_documents WHERE id = ? AND tender_id = ?');
        $dstmt->execute([$did, $id]);
        $doc = $dstmt->fetch();
        if (!$doc) Json::fail('Document not found', 404);

        // /documents/:did/complete — toggle / set per-document completion
        if (($segs[4] ?? '') === 'complete') {
            if ($method !== 'POST') Json::fail('Method not allowed', 405);
            $body = Json::readBody();
            $val  = array_key_exists('is_completed', $body)
                ? (!empty($body['is_completed']) ? 1 : 0)
                : ((int)$doc['is_completed'] === 1 ? 0 : 1);
            $pdo->prepare('UPDATE tender_documents SET is_completed = ? WHERE id = ?')->execute([$val, $did]);
            Json::send(['ok' => true, 'is_completed' => $val]);
        }

        if ($method === 'PUT') {
            $body  = Json::readBody();
            $title = trim((string)($body['title'] ?? $doc['title']));
            if ($title === '') Json::fail('Title is required', 400);

            // section_id can be moved between sections, or explicitly cleared with null
            $sectionId = $doc['section_id'];
            if (array_key_exists('section_id', $body)) {
                $sectionId = ($body['section_id'] === '' || $body['section_id'] === null)
                    ? null : (int)$body['section_id'];
                if ($sectionId !== null) {
                    $check = $pdo->prepare('SELECT 1 FROM tender_document_sections WHERE id = ? AND tender_id = ?');
                    $check->execute([$sectionId, $id]);
                    if (!$check->fetchColumn()) Json::fail('Invalid section_id for this tender', 400);
                }
            }

            $pdo->prepare(
                'UPDATE tender_documents
                 SET title=?, description=?, external_url=?, sort_order=?,
                     section_id=?, is_completed=?
                 WHERE id = ?'
            )->execute([
                $title,
                array_key_exists('description',  $body) ? (trim((string)$body['description'])  ?: null) : $doc['description'],
                array_key_exists('external_url', $body) ? (trim((string)$body['external_url']) ?: null) : $doc['external_url'],
                (int)($body['sort_order'] ?? $doc['sort_order']),
                $sectionId,
                array_key_exists('is_completed', $body)
                    ? (!empty($body['is_completed']) ? 1 : 0)
                    : (int)$doc['is_completed'],
                $did,
            ]);
            Json::send(['ok' => true]);
        }
        if ($method === 'DELETE') {
            // Remove the on-disk file if we stored one
            if (!empty($doc['file_path'])) {
                $abs = __DIR__ . '/../../' . $doc['file_path'];
                if (is_file($abs)) @unlink($abs);
            }
            $pdo->prepare('DELETE FROM tender_documents WHERE id = ?')->execute([$did]);
            Json::send(['ok' => true]);
        }
        Json::fail('Method not allowed', 405);
    }

    if ($method === 'GET') Json::send(['tender' => $tender]);

    if ($method === 'PUT') {
        $body  = Json::readBody();
        $title = trim((string)($body['title'] ?? $tender['title']));
        if ($title === '') Json::fail('Title is required', 400);

        $status = array_key_exists('status', $body) ? (string)$body['status'] : (string)$tender['status'];
        if (!in_array($status, $allowedStatuses, true)) Json::fail('Invalid status', 400);

        $currency = strtoupper(trim((string)($body['currency'] ?? $tender['currency'] ?? 'GBP')));
        if ($currency === '' || strlen($currency) !== 3) $currency = (string)$tender['currency'];

        $value = array_key_exists('value', $body) ? $body['value'] : $tender['value'];
        if ($value === '' || $value === null) {
            $value = null;
        } elseif (!is_numeric($value)) {
            Json::fail('Value must be a number', 400);
        } else {
            $value = (float)$value;
        }

        $upd = $pdo->prepare(
            'UPDATE tenders
             SET title=?, buyer=?, reference=?, value=?, currency=?, category=?, source_url=?,
                 submission_deadline=?, decision_date=?, status=?, notes=?
             WHERE id = ?'
        );
        $upd->execute([
            $title,
            trim((string)($body['buyer']     ?? $tender['buyer']     ?? '')) ?: null,
            trim((string)($body['reference'] ?? $tender['reference'] ?? '')) ?: null,
            $value,
            $currency,
            trim((string)($body['category']   ?? $tender['category']   ?? '')) ?: null,
            trim((string)($body['source_url'] ?? $tender['source_url'] ?? '')) ?: null,
            trim((string)($body['submission_deadline'] ?? $tender['submission_deadline'] ?? '')) ?: null,
            trim((string)($body['decision_date']       ?? $tender['decision_date']       ?? '')) ?: null,
            $status,
            array_key_exists('notes', $body) ? $body['notes'] : $tender['notes'],
            $id,
        ]);
        Json::send(['ok' => true]);
    }

    if ($method === 'DELETE') {
        $pdo->prepare('DELETE FROM tenders WHERE id = ?')->execute([$id]);
        Json::send(['ok' => true]);
    }

    Json::fail('Method not allowed', 405);
};
