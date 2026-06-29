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
