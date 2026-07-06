<?php
declare(strict_types=1);

use BRS\Auth;
use BRS\Db;
use BRS\Json;

/*
 * Operations routes — manual tasks + cross-system documents view.
 *
 *   GET    /api/operations/tasks                  → list (filterable by ?status=)
 *   POST   /api/operations/tasks                  → create
 *   GET    /api/operations/tasks/:id              → fetch
 *   PUT    /api/operations/tasks/:id              → update
 *   DELETE /api/operations/tasks/:id              → delete
 *   POST   /api/operations/tasks/:id/status       → transition status
 *
 *   GET    /api/operations/documents              → aggregated docs across
 *                                                    hr_documents + tender_documents
 *   GET    /api/operations/documents/browse[?path=…] → filesystem walker rooted
 *                                                       at cms/uploads/
 */

return function (string $method, array $segs): void {
    Auth::require();
    $pdo = Db::tpdo();

    $resource = $segs[1] ?? '';

    // Tender leads — persisted feed of UK tender opportunities.
    //   GET  /api/operations/tender-leads          → read stored rows (fast)
    //   POST /api/operations/tender-leads/import    → pull last 24h from the
    //          standalone aggregator (cms/scraper/tenders.php) and upsert.
    if ($resource === 'tender-leads') {
        $sub = $segs[2] ?? '';
        if ($sub === 'import'  && $method === 'POST') { handleTenderLeadImport($pdo); return; }
        if ($sub === 'promote' && $method === 'POST') { handleTenderLeadPromote($pdo); return; }
        if ($sub === 'types'   && $method === 'GET')  { handleTenderLeadTypeCounts($pdo); return; }
        if ($sub === '' && $method === 'GET')         { handleTenderLeadList($pdo); return; }
        Json::fail('Not found', 404);
    }

    if ($resource === 'documents') {
        if (($segs[2] ?? '') === 'browse') { handleOperationsDocumentsBrowse($method); return; }
        handleOperationsDocuments($pdo, $method);
        return;
    }
    if ($resource !== 'tasks') Json::fail('Not found', 404);

    $allowedStatuses   = ['to_do', 'in_progress', 'done'];
    $allowedPriorities = ['low', 'medium', 'high'];

    $id = (isset($segs[2]) && ctype_digit((string)$segs[2])) ? (int)$segs[2] : null;

    // ───── /api/operations/tasks ─────────────────────────────────────
    if ($id === null) {
        if ($method === 'GET') {
            // Optional ?status= filter; default is everything.
            $sql = 'SELECT t.*, e.title AS tender_title FROM operation_tasks t
                    LEFT JOIN tenders e ON e.id = t.tender_id';
            $params = [];
            if (!empty($_GET['status']) && in_array($_GET['status'], $allowedStatuses, true)) {
                $sql .= ' WHERE t.status = ?';
                $params[] = $_GET['status'];
            }
            // Open tasks first (to_do, in_progress), then done. Within each
            // bucket, due-date ascending with nulls last, then newest.
            $sql .= "
              ORDER BY FIELD(t.status, 'to_do','in_progress','done'),
                       t.due_date IS NULL, t.due_date ASC, t.id DESC";
            $stmt = $pdo->prepare($sql);
            $stmt->execute($params);
            Json::send(['tasks' => $stmt->fetchAll()]);
        }
        if ($method === 'POST') {
            $body  = Json::readBody();
            $title = trim((string)($body['title'] ?? ''));
            if ($title === '') Json::fail('Title is required', 400);

            $status   = (string)($body['status']   ?? 'to_do');
            if (!in_array($status, $allowedStatuses, true)) $status = 'to_do';
            $priority = (string)($body['priority'] ?? 'medium');
            if (!in_array($priority, $allowedPriorities, true)) $priority = 'medium';

            $tenderId = null;
            if (isset($body['tender_id']) && $body['tender_id'] !== '' && $body['tender_id'] !== null) {
                $tenderId = (int)$body['tender_id'];
                $check = $pdo->prepare('SELECT 1 FROM tenders WHERE id = ?');
                $check->execute([$tenderId]);
                if (!$check->fetchColumn()) Json::fail('Linked tender not found', 400);
            }

            $completedAt = $status === 'done' ? date('Y-m-d H:i:s') : null;

            $ins = $pdo->prepare(
                'INSERT INTO operation_tasks
                 (title, description, category, status, priority, due_date, tender_id, completed_at)
                 VALUES (?,?,?,?,?,?,?,?)'
            );
            $ins->execute([
                $title,
                trim((string)($body['description'] ?? '')) ?: null,
                trim((string)($body['category']    ?? '')) ?: null,
                $status, $priority,
                trim((string)($body['due_date'] ?? '')) ?: null,
                $tenderId,
                $completedAt,
            ]);
            Json::send(['id' => (int)$pdo->lastInsertId()], 201);
        }
        Json::fail('Method not allowed', 405);
    }

    // ───── /api/operations/tasks/:id[/status] ────────────────────────
    if ($id <= 0) Json::fail('Invalid id', 400);

    $stmt = $pdo->prepare('SELECT * FROM operation_tasks WHERE id = ?');
    $stmt->execute([$id]);
    $task = $stmt->fetch();
    if (!$task) Json::fail('Task not found', 404);

    // POST /:id/status — explicit transition. Keeps the simpler PUT path
    // for general edits without forcing the caller to send every field.
    if (($segs[3] ?? '') === 'status') {
        if ($method !== 'POST') Json::fail('Method not allowed', 405);
        $body   = Json::readBody();
        $status = (string)($body['status'] ?? '');
        if (!in_array($status, $allowedStatuses, true)) Json::fail('Invalid status', 400);
        $completedAt = $status === 'done'
            ? ($task['completed_at'] ?: date('Y-m-d H:i:s'))
            : null;
        $pdo->prepare('UPDATE operation_tasks SET status = ?, completed_at = ? WHERE id = ?')
            ->execute([$status, $completedAt, $id]);
        Json::send(['ok' => true, 'status' => $status, 'completed_at' => $completedAt]);
    }

    if ($method === 'GET') Json::send(['task' => $task]);

    if ($method === 'PUT') {
        $body  = Json::readBody();
        $title = trim((string)($body['title'] ?? $task['title']));
        if ($title === '') Json::fail('Title is required', 400);

        $status = $task['status'];
        if (array_key_exists('status', $body)) {
            $status = (string)$body['status'];
            if (!in_array($status, $allowedStatuses, true)) Json::fail('Invalid status', 400);
        }
        $priority = $task['priority'];
        if (array_key_exists('priority', $body)) {
            $priority = (string)$body['priority'];
            if (!in_array($priority, $allowedPriorities, true)) Json::fail('Invalid priority', 400);
        }
        // completed_at follows status into/out of 'done'
        $completedAt = $status === 'done'
            ? ($task['completed_at'] ?: date('Y-m-d H:i:s'))
            : null;

        $tenderId = $task['tender_id'];
        if (array_key_exists('tender_id', $body)) {
            if ($body['tender_id'] === '' || $body['tender_id'] === null) {
                $tenderId = null;
            } else {
                $tenderId = (int)$body['tender_id'];
                $check = $pdo->prepare('SELECT 1 FROM tenders WHERE id = ?');
                $check->execute([$tenderId]);
                if (!$check->fetchColumn()) Json::fail('Linked tender not found', 400);
            }
        }

        $pdo->prepare(
            'UPDATE operation_tasks
             SET title=?, description=?, category=?, status=?, priority=?,
                 due_date=?, tender_id=?, completed_at=?
             WHERE id = ?'
        )->execute([
            $title,
            array_key_exists('description', $body) ? (trim((string)$body['description']) ?: null) : $task['description'],
            array_key_exists('category',    $body) ? (trim((string)$body['category'])    ?: null) : $task['category'],
            $status, $priority,
            array_key_exists('due_date', $body) ? (trim((string)$body['due_date']) ?: null) : $task['due_date'],
            $tenderId,
            $completedAt,
            $id,
        ]);
        Json::send(['ok' => true]);
    }

    if ($method === 'DELETE') {
        $pdo->prepare('DELETE FROM operation_tasks WHERE id = ?')->execute([$id]);
        Json::send(['ok' => true]);
    }

    Json::fail('Method not allowed', 405);
};

/**
 * GET /api/operations/documents — flat union of every uploaded file across
 * HR (hr_documents) and Tenders (tender_documents), normalized into a single
 * row shape so the Operations Documents page can show them in one table.
 *
 * Status is computed:
 *   - HR row needing a signature without `signed_at`  → 'pending'
 *   - HR row with `expires_at` < today                 → 'expired'
 *   - Everything else                                  → 'valid'
 *
 * `file_path` is the cms-relative path (e.g. 'uploads/hr/12/1234_file.pdf')
 * — the frontend prefixes `basePath` to build a real URL.
 */
function handleOperationsDocuments(\PDO|\BRS\TenantPdo $pdo, string $method): void {
    if ($method !== 'GET') Json::fail('Method not allowed', 405);

    $hr = $pdo->query(
        "SELECT d.id, d.title, d.file_path, d.file_size, d.mime_type,
                d.reference_number, d.issued_at, d.expires_at, d.uploaded_at,
                d.requires_signature, d.signed_at, d.category,
                d.employee_id AS owner_id,
                TRIM(CONCAT(COALESCE(e.first_name,''), ' ', COALESCE(e.last_name,''))) AS owner_name,
                COALESCE(t.name, d.category) AS doc_type
         FROM hr_documents d
         LEFT JOIN hr_employees e ON e.id = d.employee_id
         LEFT JOIN hr_document_types t ON t.id = d.doc_type_id
         WHERE d.file_path IS NOT NULL AND d.file_path <> ''"
    )->fetchAll();

    $td = $pdo->query(
        "SELECT td.id, td.title, td.file_path, td.file_size, td.mime_type,
                td.created_at AS uploaded_at, td.kind,
                td.tender_id AS owner_id, ten.title AS owner_name
         FROM tender_documents td
         LEFT JOIN tenders ten ON ten.id = td.tender_id
         WHERE td.file_path IS NOT NULL AND td.file_path <> ''"
    )->fetchAll();

    $today = date('Y-m-d');
    $rows = [];

    foreach ($hr as $r) {
        $status = 'valid';
        if ((int)$r['requires_signature'] === 1 && empty($r['signed_at'])) $status = 'pending';
        elseif (!empty($r['expires_at']) && $r['expires_at'] < $today)    $status = 'expired';
        $owner = trim((string)$r['owner_name']);
        $rows[] = [
            'uid'         => 'hr_' . $r['id'],
            'system'      => 'hr',
            'owner_type'  => 'Employee',
            'owner_id'    => (int)$r['owner_id'],
            'owner_name'  => $owner !== '' ? $owner : '—',
            'doc_type'    => $r['doc_type'] ?: 'general',
            'title'       => $r['title'],
            'reference'   => $r['reference_number'],
            'status'      => $status,
            'uploaded_at' => $r['uploaded_at'],
            'expires_at'  => $r['expires_at'],
            'issued_at'   => $r['issued_at'],
            'file_path'   => $r['file_path'],
            'file_size'   => $r['file_size'] !== null ? (int)$r['file_size'] : null,
            'mime_type'   => $r['mime_type'],
        ];
    }

    $kindLabel = [
        'application' => 'Application',
        'proposal'    => 'Proposal',
        'pitch_deck'  => 'Pitch deck',
    ];
    foreach ($td as $r) {
        $rows[] = [
            'uid'         => 'tender_' . $r['id'],
            'system'      => 'tender',
            'owner_type'  => 'Tender',
            'owner_id'    => (int)$r['owner_id'],
            'owner_name'  => $r['owner_name'] ?: '—',
            'doc_type'    => $kindLabel[$r['kind']] ?? ($r['kind'] ?: 'Tender document'),
            'title'       => $r['title'],
            'reference'   => null,
            'status'      => 'valid',
            'uploaded_at' => $r['uploaded_at'],
            'expires_at'  => null,
            'issued_at'   => null,
            'file_path'   => $r['file_path'],
            'file_size'   => $r['file_size'] !== null ? (int)$r['file_size'] : null,
            'mime_type'   => $r['mime_type'],
        ];
    }

    // Recruitment candidate documents — same normalized row shape, gated
    // to entries that have a file on disk (info-only metadata-only rows
    // skip this aggregate view; they're visible per-candidate). Surfaced
    // here so Operations → Documents reads as the whole-CMS document
    // index, not just HR + Tenders.
    $rcStmt = $pdo->query(
        "SELECT d.id, d.title, d.file_path, d.file_size, d.mime_type,
                d.reference_number, d.issued_at, d.expires_at, d.uploaded_at, d.status,
                d.candidate_id AS owner_id,
                TRIM(CONCAT(COALESCE(c.first_name,''), ' ', COALESCE(c.last_name,''))) AS owner_name,
                COALESCE(t.name, 'general') AS doc_type
         FROM recruitment_candidate_documents d
         LEFT JOIN recruitment_candidates c ON c.id = d.candidate_id
         LEFT JOIN recruitment_doc_types t ON t.id = d.doc_type_id
         WHERE d.file_path IS NOT NULL AND d.file_path <> ''"
    );
    foreach ($rcStmt->fetchAll() as $r) {
        // The recruitment table already carries a `status` column; trust it
        // rather than re-deriving from dates so the Documentation page +
        // Operations page agree on the same value.
        $status = (string)($r['status'] ?? 'valid');
        if (!in_array($status, ['valid','pending','expired','rejected'], true)) $status = 'valid';
        $owner = trim((string)$r['owner_name']);
        $rows[] = [
            'uid'         => 'rec_' . $r['id'],
            'system'      => 'recruitment',
            'owner_type'  => 'Candidate',
            'owner_id'    => (int)$r['owner_id'],
            'owner_name'  => $owner !== '' ? $owner : '—',
            'doc_type'    => $r['doc_type'] ?: 'general',
            'title'       => $r['title'],
            'reference'   => $r['reference_number'],
            'status'      => $status,
            'uploaded_at' => $r['uploaded_at'],
            'expires_at'  => $r['expires_at'],
            'issued_at'   => $r['issued_at'],
            'file_path'   => $r['file_path'],
            'file_size'   => $r['file_size'] !== null ? (int)$r['file_size'] : null,
            'mime_type'   => $r['mime_type'],
        ];
    }

    usort($rows, fn($a, $b) => strcmp((string)$b['uploaded_at'], (string)$a['uploaded_at']));
    Json::send(['documents' => $rows]);
}

/**
 * GET /api/operations/documents/browse?path=… — filesystem walker scoped to
 * cms/uploads/. Used by the Documents page's Browse tab.
 *
 * Path safety: any '..' segment is rejected up-front, then realpath() must
 * resolve under the uploads root. Anything else returns 400/404 rather than
 * leaking the host filesystem.
 */
function handleOperationsDocumentsBrowse(string $method): void {
    if ($method !== 'GET') Json::fail('Method not allowed', 405);

    $uploadsRoot = realpath(__DIR__ . '/../../uploads');
    if (!$uploadsRoot) Json::fail('Uploads directory missing', 500);

    $rel = (string)($_GET['path'] ?? '');
    $rel = ltrim(str_replace('\\', '/', $rel), '/');
    $parts = array_values(array_filter(explode('/', $rel), fn($p) => $p !== '' && $p !== '.'));
    foreach ($parts as $p) {
        if ($p === '..') Json::fail('Invalid path', 400);
    }
    $rel = implode('/', $parts);

    $target = $uploadsRoot . ($rel !== '' ? DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $rel) : '');
    $resolved = realpath($target);
    if (!$resolved || strpos($resolved, $uploadsRoot) !== 0 || !is_dir($resolved)) {
        Json::fail('Path not found', 404);
    }

    $entries = [];
    foreach (new DirectoryIterator($resolved) as $f) {
        if ($f->isDot()) continue;
        $name = $f->getFilename();
        $entries[] = [
            'name'     => $name,
            'type'     => $f->isDir() ? 'dir' : 'file',
            'size'     => $f->isFile() ? (int)$f->getSize() : null,
            'modified' => date('c', $f->getMTime()),
            'path'     => ($rel === '' ? '' : $rel . '/') . $name,
        ];
    }
    usort($entries, function ($a, $b) {
        if ($a['type'] !== $b['type']) return $a['type'] === 'dir' ? -1 : 1;
        return strcasecmp($a['name'], $b['name']);
    });

    $parent = $rel === '' ? null : implode('/', array_slice($parts, 0, -1));
    Json::send([
        'path'    => $rel,
        'parent'  => $parent,
        'entries' => $entries,
    ]);
}

/* ============================================================
 * TENDER LEADS — persisted aggregator feed
 * ============================================================ */

/** GET /api/operations/tender-leads — read stored leads (tenant-scoped by the
 *  rewriter), filtered by ?days (published window), ?type (friendly CPV group,
 *  filtered in PHP against the stored types array) and ?q (keyword). */
function handleTenderLeadList(\PDO|\BRS\TenantPdo $pdo): void {
    $days = isset($_GET['days']) ? max(1, min(365, (int)$_GET['days'])) : 7;
    $type = isset($_GET['type']) ? trim((string)$_GET['type']) : '';
    $q    = isset($_GET['q'])    ? trim((string)$_GET['q'])    : '';

    $cutoff = (new DateTime('now'))->modify('-' . $days . ' day')->format('Y-m-d H:i:s');

    $sql = 'SELECT * FROM tender_leads WHERE (published_date IS NULL OR published_date >= ?)';
    $params = [$cutoff];
    if ($q !== '') {
        $sql .= ' AND (title LIKE ? OR description LIKE ? OR buyer_name LIKE ?)';
        $like = '%' . $q . '%';
        array_push($params, $like, $like, $like);
    }
    $sql .= ' ORDER BY (published_date IS NULL), published_date DESC, imported_at DESC LIMIT 1000';

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll(\PDO::FETCH_ASSOC);

    $leads = [];
    foreach ($rows as $r) {
        $lead = tenderLeadRowToJson($r);
        if ($type !== '' && !in_array($type, $lead['types'], true)) continue;
        $leads[] = $lead;
    }

    $to = (new DateTime('now'))->format(DATE_ATOM);
    Json::send([
        'meta' => [
            'generatedAt' => $to,
            'window'      => ['from' => (new DateTime($cutoff))->format(DATE_ATOM), 'to' => $to],
            'count'       => count($leads),
            'sources'     => ['stored'],
            'stored'      => true,
            'filters'     => ['type' => $type !== '' ? [$type] : [], 'q' => $q],
            'errors'      => [],
        ],
        'tenders' => $leads,
    ]);
}

/** GET /api/operations/tender-leads/types — distinct friendly types held by
 *  at least one stored lead, with counts, sorted by count desc. */
function handleTenderLeadTypeCounts(\PDO|\BRS\TenantPdo $pdo): void {
    $stmt = $pdo->prepare('SELECT types FROM tender_leads');
    $stmt->execute();
    $counts = [];
    foreach ($stmt->fetchAll(\PDO::FETCH_COLUMN) as $tj) {
        $arr = json_decode((string)($tj ?? '[]'), true);
        if (is_array($arr)) {
            foreach ($arr as $t) {
                if ($t === null || $t === '') continue;
                $counts[$t] = ($counts[$t] ?? 0) + 1;
            }
        }
    }
    arsort($counts);
    $out = [];
    foreach ($counts as $type => $c) { $out[] = ['type' => $type, 'count' => $c]; }
    Json::send(['types' => $out]);
}

/** POST /api/operations/tender-leads/import — pull the last 24h from the
 *  standalone aggregator and upsert into tender_leads (dedup on ocid). The
 *  aggregator echoes+exits so it can't be require()d for data; we fetch it
 *  over HTTP from the same host. */
function handleTenderLeadImport(\PDO|\BRS\TenantPdo $pdo): void {
    // Window to pull. mode=since → from the most recent stored published_date
    // (incremental catch-up); otherwise ?days=N (capped at the scraper's 30).
    $mode = $_GET['mode'] ?? '';
    if ($mode === 'since') {
        $stmt = $pdo->prepare('SELECT MAX(published_date) FROM tender_leads');
        $stmt->execute();
        $maxDate = $stmt->fetchColumn();
        if ($maxDate) {
            $secs = (new DateTime('now'))->getTimestamp() - (new DateTime($maxDate))->getTimestamp();
            $days = max(1, (int)ceil($secs / 86400));
        } else {
            $days = 30; // nothing stored yet — treat as a first backfill
        }
    } else {
        $days = isset($_GET['days']) ? (int)$_GET['days'] : 1;
    }
    $days = max(1, min(30, $days)); // the aggregator caps at 30 days

    // Derive the aggregator URL: <scheme>://<host><basePath>/scraper/tenders.php
    $script = $_SERVER['SCRIPT_NAME'] ?? '';
    $base   = str_replace('/api/index.php', '', $script);
    if ($base === $script) { // fallback if SCRIPT_NAME wasn't the front controller
        $base = preg_replace('#/api(/.*)?$#', '', $_SERVER['REQUEST_URI'] ?? '') ?? '';
    }
    $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $host   = $_SERVER['HTTP_HOST'] ?? '127.0.0.1';
    $url    = $scheme . '://' . $host . $base . '/scraper/tenders.php?days=' . $days;

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 120,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_SSL_VERIFYPEER => false,
    ]);
    $body = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $cerr = curl_error($ch);
    curl_close($ch);

    if ($body === false || $code >= 400) {
        Json::fail('Could not reach the tender aggregator (' . ($cerr !== '' ? $cerr : ('HTTP ' . $code)) . ')', 502);
    }
    $data = json_decode($body, true);
    if (!is_array($data) || !isset($data['tenders']) || !is_array($data['tenders'])) {
        $snippet = trim(substr(strip_tags((string)$body), 0, 200));
        Json::fail('The tender aggregator returned an unexpected response: ' . ($snippet !== '' ? $snippet : 'empty body'), 502);
    }

    $tenantId = \BRS\Tenant::id();
    $inserted = 0; $skipped = 0;
    $tenders = $data['tenders'];

    if ($tenders) {
        // Which ocids are already stored (tenant-scoped by the rewriter) — we
        // skip those so an import only brings in genuinely NEW leads and never
        // rewrites rows already in the table.
        $existing = [];
        $exStmt = $pdo->prepare('SELECT ocid FROM tender_leads');
        $exStmt->execute();
        foreach ($exStmt->fetchAll(\PDO::FETCH_COLUMN) as $oc) { $existing[$oc] = true; }

        // INSERT IGNORE — tenant_id is included explicitly so the rewriter
        // passes the statement through; IGNORE guards against a duplicate ocid
        // appearing twice within a single fetch.
        $sampleRow = tenderLeadToRow($tenders[0]);
        $cols = array_merge(['tenant_id'], array_keys($sampleRow));
        $placeholders = implode(', ', array_fill(0, count($cols), '?'));
        $sql = 'INSERT IGNORE INTO `tender_leads` (`' . implode('`, `', $cols) . "`) VALUES ($placeholders)";
        $stmt = $pdo->prepare($sql);

        $pdo->beginTransaction();
        foreach ($tenders as $t) {
            if (empty($t['id'])) continue;
            if (isset($existing[$t['id']])) { $skipped++; continue; } // already in table
            $vals = array_merge([$tenantId], array_values(tenderLeadToRow($t)));
            $stmt->execute($vals);
            $inserted++;
            $existing[$t['id']] = true; // guard against a dup later in this batch
        }
        $pdo->commit();
    }

    Json::send([
        'imported' => $inserted,
        'skipped'  => $skipped,
        'updated'  => 0,
        'fetched'  => count($tenders),
        'days'     => $days,
        'window'   => $data['meta']['window'] ?? null,
        'errors'   => $data['meta']['errors'] ?? [],
    ]);
}

/** POST /api/operations/tender-leads/promote — create a tracked Tender from a
 *  stored lead (body {ocid}) and copy ALL of the lead's information into the
 *  tender's Info tab (tender_info) as individual name/value entries. */
function handleTenderLeadPromote(\PDO|\BRS\TenantPdo $pdo): void {
    $body = Json::readBody();
    $ocid = trim((string)($body['ocid'] ?? ''));
    if ($ocid === '') Json::fail('Missing lead id', 422);

    $stmt = $pdo->prepare('SELECT * FROM tender_leads WHERE ocid = ? LIMIT 1');
    $stmt->execute([$ocid]);
    $row = $stmt->fetch(\PDO::FETCH_ASSOC);
    if (!$row) Json::fail('Lead not found', 404);

    $lead = tenderLeadRowToJson($row);

    $title    = ($lead['title'] ?? '') !== '' ? $lead['title'] : 'Untitled tender';
    $buyer    = $lead['buyer']['name'] ?? null;
    $reference= $lead['noticeId'] ?? null;
    $value    = ($lead['value']['amount'] ?? null);
    $currency = $lead['value']['currency'] ?? 'GBP';
    $category = $lead['types'][0] ?? ($lead['mainCategory'] ?? null);
    $sourceUrl= $lead['link'] ?? null;
    $deadline = $row['deadline'] ?: null; // already 'Y-m-d H:i:s'
    $notes    = 'Imported from Lead Gen (' . tenderLeadSourceLabel((string)($lead['source'] ?? '')) . ').';

    $pdo->beginTransaction();
    try {
        $ins = $pdo->prepare(
            'INSERT INTO tenders
             (title, buyer, reference, value, currency, category, source_url,
              submission_deadline, decision_date, status, notes)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)'
        );
        $ins->execute([$title, $buyer, $reference, $value, $currency, $category, $sourceUrl, $deadline, null, 'planning', $notes]);
        $tenderId = (int)$pdo->lastInsertId();

        $infoIns = $pdo->prepare('INSERT INTO tender_info (tender_id, name, value, sort_order) VALUES (?,?,?,?)');
        $so = 0;
        foreach (tenderLeadInfoEntries($lead) as $entry) {
            [$name, $val] = $entry;
            if ($val === null || $val === '') continue;
            $infoIns->execute([$tenderId, $name, $val, $so++]);
        }
        $pdo->commit();
    } catch (\Throwable $ex) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        Json::fail('Could not promote lead: ' . $ex->getMessage(), 500);
    }

    Json::send(['tender_id' => $tenderId], 201);
}

function tenderLeadSourceLabel(string $src): string {
    if ($src === 'find-a-tender') return 'Find a Tender';
    if ($src === 'contracts-finder') return 'Contracts Finder';
    return $src !== '' ? $src : 'Lead Gen';
}

/** Build the individual Info-tab entries [ [name, value], ... ] from a lead.
 *  Null/empty values are dropped at insert time. */
function tenderLeadInfoEntries(array $l): array {
    $money = function ($v) {
        if (!is_array($v) || ($v['amount'] ?? null) === null) return null;
        $n = number_format((float)$v['amount'], 0);
        $cur = $v['currency'] ?? 'GBP';
        return $cur === 'GBP' ? ('£' . $n) : ($n . ' ' . $cur);
    };
    $fdate = function ($iso) {
        if (!$iso) return null;
        try { return (new DateTime($iso))->format('d M Y'); } catch (\Throwable $x) { return $iso; }
    };
    $yn = fn ($v) => $v === null ? null : ($v ? 'Yes' : 'No');
    $join = function ($a) {
        if (is_string($a)) return $a;
        if (is_array($a)) { $f = array_filter($a, fn ($x) => $x !== null && $x !== ''); return $f ? implode(', ', $f) : null; }
        return null;
    };

    $e = [];
    $e[] = ['Description', $l['description'] ?? null];
    $e[] = ['Buyer', $l['buyer']['name'] ?? null];
    $e[] = ['Buyer type', $l['buyer']['buyerType'] ?? null];
    $e[] = ['Estimated value', $money($l['value'] ?? null)];
    $e[] = ['Status', $l['status'] ?? null];
    $e[] = ['Published', $fdate($l['publishedDate'] ?? null)];
    $e[] = ['Submission deadline', $fdate($l['deadline'] ?? null)];
    $e[] = ['Enquiry deadline', $fdate($l['enquiryDeadline'] ?? null)];
    $e[] = ['Region', $l['buyer']['address']['region'] ?? ($l['regions'][0] ?? null)];
    $e[] = ['Source', tenderLeadSourceLabel((string)($l['source'] ?? ''))];
    $e[] = ['Notice type', $l['noticeType'] ?? null];
    $e[] = ['Procedure', $l['procedureType'] ?? null];
    $e[] = ['Main category', $l['mainCategory'] ?? null];
    $e[] = ['Legal basis', $l['legalBasis'] ?? null];
    $e[] = ['Language', $l['language'] ?? null];
    $e[] = ['Suitable for SME', $yn($l['suitableForSME'] ?? null)];
    $e[] = ['Suitable for VCSE', $yn($l['suitableForVCSE'] ?? null)];
    $e[] = ['Covered by GPA', $yn($l['coveredByGPA'] ?? null)];
    $e[] = ['Notice reference', $l['noticeId'] ?? null];
    $e[] = ['Types', $join($l['types'] ?? null)];
    $e[] = ['CPV codes', $join($l['cpvCodes'] ?? null)];
    $e[] = ['Contract start', $fdate($l['contractStart'] ?? null)];
    $e[] = ['Contract end', $fdate($l['contractEnd'] ?? null)];
    if ($l['contractDays'] ?? null) $e[] = ['Contract duration', $l['contractDays'] . ' days'];

    $fw = $l['framework'] ?? null;
    if (is_array($fw) && ($fw['isFramework'] ?? false)) {
        $e[] = ['Framework method', $fw['method'] ?? null];
        $e[] = ['Framework period end', $fdate($fw['periodEnd'] ?? null)];
        if ($fw['maxParticipants'] ?? null) $e[] = ['Framework max participants', (string)$fw['maxParticipants']];
    }

    foreach (($l['lots'] ?? []) as $i => $lot) {
        if (!is_array($lot)) continue;
        $bits = [];
        if ($money($lot['value'] ?? null)) $bits[] = $money($lot['value'] ?? null);
        $cp = $lot['contractPeriod'] ?? null;
        if (is_array($cp) && (($cp['start'] ?? null) || ($cp['end'] ?? null))) {
            $bits[] = $fdate($cp['start'] ?? null) . ' to ' . $fdate($cp['end'] ?? null);
        }
        $label = $lot['title'] ?? ('Lot ' . ($lot['id'] ?? ($i + 1)));
        $e[] = ['Lot ' . ($i + 1), $label . ($bits ? ' (' . implode(', ', $bits) . ')' : '')];
    }

    foreach (($l['milestones'] ?? []) as $m) {
        if (!is_array($m)) continue;
        $name = $m['title'] ?? ($m['type'] ?? 'Milestone');
        $e[] = ['Key date: ' . $name, $fdate($m['dueDate'] ?? null)];
    }

    $s = $l['submission'] ?? null;
    if (is_array($s)) {
        $e[] = ['Submission method', $join($s['methods'] ?? null)];
        $e[] = ['Submission portal', $s['url'] ?? null];
        if (($s['electronicAuction'] ?? null) !== null) $e[] = ['Electronic auction', $yn($s['electronicAuction'])];
        $e[] = ['Submission languages', $join($s['languages'] ?? null)];
        $e[] = ['Variant policy', $s['variantPolicy'] ?? null];
    }

    $p = $l['participation'] ?? null;
    if (is_array($p)) {
        if (($p['minimumCandidates'] ?? null) !== null) $e[] = ['Minimum candidates', (string)$p['minimumCandidates']];
        $e[] = ['Reserved participation', $join($p['reservedParticipation'] ?? null)];
    }

    $c = $l['buyer']['contact'] ?? null;
    if (is_array($c)) {
        $e[] = ['Contact name', $c['name'] ?? null];
        $e[] = ['Contact email', $c['email'] ?? null];
        $e[] = ['Contact phone', $c['phone'] ?? null];
    }
    $a = $l['buyer']['address'] ?? null;
    if (is_array($a)) {
        $addr = implode(', ', array_filter([$a['street'] ?? null, $a['locality'] ?? null, $a['region'] ?? null, $a['postcode'] ?? null, $a['country'] ?? null]));
        $e[] = ['Buyer address', $addr !== '' ? $addr : null];
    }

    foreach (($l['deliveryAddresses'] ?? []) as $i => $d) {
        if (!is_array($d)) continue;
        $txt = $d['description'] ?? implode(', ', array_filter([$d['street'] ?? null, $d['locality'] ?? null, $d['region'] ?? null, $d['postcode'] ?? null]));
        if ($txt !== '' && $txt !== null) $e[] = ['Delivery location ' . ($i + 1), $txt];
    }

    foreach (($l['documents'] ?? []) as $i => $d) {
        if (!is_array($d)) continue;
        $label = $d['title'] ?? ($d['type'] ?? ('Document ' . ($i + 1)));
        $e[] = ['Document: ' . $label, $d['url'] ?? null];
    }

    $e[] = ['Notice link', $l['link'] ?? null];
    return $e;
}

/** Map one aggregator tender object → an ordered assoc of DB column ⇒ value
 *  (scalars typed, nested structures JSON-encoded, full payload in raw_json). */
function tenderLeadToRow(array $t): array {
    $val = is_array($t['value'] ?? null) ? $t['value'] : [];
    $bool = fn($v) => $v === null ? null : (int)!!$v;
    $j = fn($v) => json_encode($v, JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    return [
        'ocid'               => (string)($t['id'] ?? ''),
        'notice_id'          => $t['noticeId'] ?? null,
        'source'             => $t['source'] ?? null,
        'notice_type'        => $t['noticeType'] ?? null,
        'language'           => $t['language'] ?? null,
        'title'              => $t['title'] ?? null,
        'description'        => $t['description'] ?? null,
        'status'             => $t['status'] ?? null,
        'buyer_name'         => $t['buyer']['name'] ?? null,
        'value_amount'       => isset($val['amount']) && is_numeric($val['amount']) ? $val['amount'] : null,
        'value_currency'     => $val['currency'] ?? null,
        'main_category'      => $t['mainCategory'] ?? null,
        'published_date'     => tenderLeadDt($t['publishedDate'] ?? null),
        'deadline'           => tenderLeadDt($t['deadline'] ?? null),
        'enquiry_deadline'   => tenderLeadDt($t['enquiryDeadline'] ?? null),
        'contract_start'     => tenderLeadDate($t['contractStart'] ?? null),
        'contract_end'       => tenderLeadDate($t['contractEnd'] ?? null),
        'contract_days'      => isset($t['contractDays']) && is_numeric($t['contractDays']) ? (int)$t['contractDays'] : null,
        'procedure_type'     => $t['procedureType'] ?? null,
        'legal_basis'        => $t['legalBasis'] ?? null,
        'covered_by_gpa'     => $bool($t['coveredByGPA'] ?? null),
        'suitable_for_sme'   => $bool($t['suitableForSME'] ?? null),
        'suitable_for_vcse'  => $bool($t['suitableForVCSE'] ?? null),
        'lot_count'          => isset($t['lotCount']) ? (int)$t['lotCount'] : null,
        'link'               => $t['link'] ?? null,
        'types'              => $j($t['types'] ?? []),
        'buyer'              => $j($t['buyer'] ?? null),
        'parties'            => $j($t['parties'] ?? []),
        'cpv_codes'          => $j($t['cpvCodes'] ?? []),
        'regions'            => $j($t['regions'] ?? []),
        'delivery_addresses' => $j($t['deliveryAddresses'] ?? []),
        'framework'          => $j($t['framework'] ?? null),
        'lots'               => $j($t['lots'] ?? []),
        'milestones'         => $j($t['milestones'] ?? []),
        'selection_criteria' => $j($t['selectionCriteria'] ?? []),
        'award_criteria'     => $j($t['awardCriteria'] ?? []),
        'submission'         => $j($t['submission'] ?? null),
        'participation'      => $j($t['participation'] ?? null),
        'documents'          => $j($t['documents'] ?? []),
        'raw_json'           => $j($t),
    ];
}

/** DB row → the JSON shape the frontend expects (decodes JSON columns). */
function tenderLeadRowToJson(array $r): array {
    $dec = fn($s) => ($s === null || $s === '') ? null : json_decode($s, true);
    return [
        'id'                => $r['ocid'],
        'noticeId'          => $r['notice_id'],
        'source'            => $r['source'],
        'noticeType'        => $r['notice_type'],
        'language'          => $r['language'],
        'title'             => $r['title'] ?? '',
        'description'       => $r['description'] ?? '',
        'status'            => $r['status'],
        'types'             => $dec($r['types']) ?? [],
        'buyer'             => $dec($r['buyer']),
        'parties'           => $dec($r['parties']) ?? [],
        'value'             => ['amount' => isset($r['value_amount']) ? (float)$r['value_amount'] : null, 'currency' => $r['value_currency'] ?? 'GBP'],
        'cpvCodes'          => $dec($r['cpv_codes']) ?? [],
        'mainCategory'      => $r['main_category'],
        'regions'           => $dec($r['regions']) ?? [],
        'deliveryAddresses' => $dec($r['delivery_addresses']) ?? [],
        'publishedDate'     => tenderLeadIso($r['published_date']),
        'deadline'          => tenderLeadIso($r['deadline']),
        'enquiryDeadline'   => tenderLeadIso($r['enquiry_deadline']),
        'contractStart'     => $r['contract_start'],
        'contractEnd'       => $r['contract_end'],
        'contractDays'      => isset($r['contract_days']) ? (int)$r['contract_days'] : null,
        'procedureType'     => $r['procedure_type'],
        'legalBasis'        => $r['legal_basis'],
        'coveredByGPA'      => isset($r['covered_by_gpa']) ? (bool)$r['covered_by_gpa'] : null,
        'suitableForSME'    => isset($r['suitable_for_sme']) ? (bool)$r['suitable_for_sme'] : null,
        'suitableForVCSE'   => isset($r['suitable_for_vcse']) ? (bool)$r['suitable_for_vcse'] : null,
        'framework'         => $dec($r['framework']),
        'lots'              => $dec($r['lots']) ?? [],
        'lotCount'          => isset($r['lot_count']) ? (int)$r['lot_count'] : 0,
        'milestones'        => $dec($r['milestones']) ?? [],
        'selectionCriteria' => $dec($r['selection_criteria']) ?? [],
        'awardCriteria'     => $dec($r['award_criteria']) ?? [],
        'submission'        => $dec($r['submission']),
        'participation'     => $dec($r['participation']),
        'link'              => $r['link'],
        'documents'         => $dec($r['documents']) ?? [],
        'importedAt'        => tenderLeadIso($r['imported_at']),
    ];
}

/** ISO datetime → 'Y-m-d H:i:s' (or null). */
function tenderLeadDt(?string $iso): ?string {
    if ($iso === null || $iso === '') return null;
    try { return (new DateTime($iso))->format('Y-m-d H:i:s'); } catch (\Throwable $e) { return null; }
}
/** ISO date → 'Y-m-d' (or null). */
function tenderLeadDate(?string $iso): ?string {
    if ($iso === null || $iso === '') return null;
    try { return (new DateTime($iso))->format('Y-m-d'); } catch (\Throwable $e) { return null; }
}
/** DB datetime → ISO 8601 (or null). */
function tenderLeadIso(?string $dt): ?string {
    if ($dt === null || $dt === '') return null;
    try { return (new DateTime($dt))->format(DATE_ATOM); } catch (\Throwable $e) { return $dt; }
}
