<?php
declare(strict_types=1);

use BRS\Auth;
use BRS\Db;
use BRS\Json;

/*
 * Recruitment routes — agency placing candidates with external clients.
 *
 *   GET    /api/recruitment/candidates                       → list (filter ?status=)
 *   POST   /api/recruitment/candidates                       → create
 *   GET    /api/recruitment/candidates/:id                   → fetch (with onboarding progress)
 *   PUT    /api/recruitment/candidates/:id                   → update
 *   DELETE /api/recruitment/candidates/:id                   → delete
 *   POST   /api/recruitment/candidates/:id/cv                → upload CV (multipart)
 *
 *   GET    /api/recruitment/candidates/:id/documents         → list
 *   POST   /api/recruitment/candidates/:id/documents         → upload (multipart)
 *   PUT    /api/recruitment/candidates/:id/documents/:did    → patch metadata / status
 *   DELETE /api/recruitment/candidates/:id/documents/:did    → delete
 *
 *   GET    /api/recruitment/candidates/:id/notes             → list
 *   POST   /api/recruitment/candidates/:id/notes             → create
 *   PUT    /api/recruitment/candidates/:id/notes/:nid        → update
 *   DELETE /api/recruitment/candidates/:id/notes/:nid        → delete
 *
 *   GET    /api/recruitment/doc-types                        → list (settings)
 *   POST   /api/recruitment/doc-types                        → create
 *   PUT    /api/recruitment/doc-types/:id                    → update
 *   DELETE /api/recruitment/doc-types/:id                    → delete
 *
 *   GET    /api/recruitment/documents                        → aggregated docs across all candidates
 */

return function (string $method, array $segs): void {
    Auth::require();
    $pdo = Db::tpdo();

    $resource = $segs[1] ?? '';
    switch ($resource) {
        case 'candidates':  handleRecruitmentCandidates($pdo, $method, $segs); return;
        case 'doc-types':   handleRecruitmentDocTypes($pdo, $method, $segs);   return;
        case 'doc-groups':  handleRecruitmentDocGroups($pdo, $method, $segs);  return;
        case 'documents':
            if (($segs[2] ?? '') === 'browse') { handleRecruitmentDocumentsBrowse($pdo, $method); return; }
            handleRecruitmentDocuments($pdo, $method);
            return;
        case 'skills':      handleRecruitmentSkills($pdo, $method, $segs);     return;
        case 'clients':
            // Client CRUD itself stays on /api/clients (same record backs
            // CRM + Recruitment via the is_recruitment_client flag).
            // Sub-routes here:
            //   /:id/placements  → list every placement for the client
            //   /:id/roles[/:rid] → CRUD for client-level role openings
            if (isset($segs[2]) && ctype_digit((string)$segs[2]) && ($segs[3] ?? '') === 'placements') {
                handleRecruitmentClientPlacements($pdo, $method, (int)$segs[2]);
                return;
            }
            if (isset($segs[2]) && ctype_digit((string)$segs[2]) && ($segs[3] ?? '') === 'roles') {
                handleRecruitmentRoles($pdo, $method, $segs, (int)$segs[2]);
                return;
            }
            Json::fail('Not found', 404);
    }
    Json::fail('Not found', 404);
};

/**
 * Build the `<id> - <full name>` candidate folder slug. Sanitises the
 * name so it's safe across Windows + POSIX filesystems (no slashes, no
 * control chars, trimmed trailing dots/spaces).
 */
function candidateFolderSlug(\PDO|\BRS\TenantPdo $pdo, int $candidateId): string {
    $stmt = $pdo->prepare('SELECT first_name, last_name FROM recruitment_candidates WHERE id = ?');
    $stmt->execute([$candidateId]);
    $row = $stmt->fetch() ?: ['first_name' => '', 'last_name' => ''];
    $name = trim((string)$row['first_name'] . ' ' . (string)$row['last_name']);
    // Whitelist alnum + space + dash + dot + underscore; collapse runs of
    // anything else to '_'. Strip trailing dots/spaces (Windows refuses).
    $safe = preg_replace('/[^A-Za-z0-9._ -]+/', '_', $name) ?? '';
    $safe = rtrim($safe, ". \t\n\r\0\x0B");
    if ($safe === '') $safe = 'unnamed';
    return $candidateId . ' - ' . $safe;
}

/**
 * Resolve the group folder a candidate doc-type sits under. Doc-types
 * without a group fall under "Ungrouped"; null doc-type-id (an untyped
 * upload) also falls under "Ungrouped".
 */
function candidateDocGroupSlug(\PDO|\BRS\TenantPdo $pdo, ?int $docTypeId): string {
    if (!$docTypeId) return 'Ungrouped';
    $stmt = $pdo->prepare(
        'SELECT g.name FROM recruitment_doc_types t
         LEFT JOIN recruitment_doc_groups g ON g.id = t.group_id
         WHERE t.id = ?'
    );
    $stmt->execute([$docTypeId]);
    $name = (string)($stmt->fetchColumn() ?: '');
    if ($name === '') $name = 'Ungrouped';
    $safe = preg_replace('/[^A-Za-z0-9._ -]+/', '_', $name) ?? '';
    $safe = rtrim($safe, ". \t\n\r\0\x0B");
    return $safe !== '' ? $safe : 'Ungrouped';
}

// ────────── Candidates ──────────────────────────────────────────────────
function handleRecruitmentCandidates(\PDO|\BRS\TenantPdo $pdo, string $method, array $segs): void {
    $statuses = ['new','interviewing','processing','compliant','client_screening','placed','rejected_by_us'];

    // /api/recruitment/candidates
    if (!isset($segs[2])) {
        if ($method === 'GET') {
            $sql = 'SELECT * FROM recruitment_candidates';
            $params = [];
            if (!empty($_GET['status']) && in_array($_GET['status'], $statuses, true)) {
                $sql .= ' WHERE status = ?';
                $params[] = $_GET['status'];
            }
            $sql .= ' ORDER BY id DESC LIMIT 1000';
            $stmt = $pdo->prepare($sql);
            $stmt->execute($params);
            Json::send(['candidates' => $stmt->fetchAll()]);
        }
        if ($method === 'POST') {
            $b = Json::readBody();
            $first = trim((string)($b['first_name'] ?? ''));
            $last  = trim((string)($b['last_name']  ?? ''));
            if ($first === '' || $last === '') Json::fail('First and last name are required', 400);
            $status = (string)($b['status'] ?? 'new');
            if (!in_array($status, $statuses, true)) $status = 'new';

            $gender = trim((string)($b['gender'] ?? ''));
            if (!in_array($gender, ['male','female','other','prefer_not_to_say'], true)) $gender = null;
            // Generate the onboarding token now so every new candidate has
            // a working /recruitment-onboarding/<token> link the moment
            // they're created. random_bytes(16) gives 128 bits of entropy;
            // bin2hex() flattens to 32 hex chars (matches migration 087's
            // UUID-hex backfill format).
            $onboardingToken = bin2hex(random_bytes(16));
            $stmt = $pdo->prepare(
                'INSERT INTO recruitment_candidates
                 (first_name, last_name, email, phone, dob, nationality, gender,
                  address_line1, address_line2, city, region, postcode, country,
                  has_driving_license, willing_to_drive,
                  role, candidate_type, discipline, experience_level, experience_years, skills,
                  day_rate, currency, availability, source, status, notes, onboarding_token)
                 VALUES (?,?,?,?,?,?,?, ?,?,?,?,?,?, ?,?, ?,?,?,?,?,?, ?,?,?,?,?,?, ?)'
            );
            $stmt->execute([
                $first, $last,
                trim((string)($b['email'] ?? '')) ?: null,
                trim((string)($b['phone'] ?? '')) ?: null,
                trim((string)($b['dob']   ?? '')) ?: null,
                trim((string)($b['nationality'] ?? '')) ?: null,
                $gender,
                trim((string)($b['address_line1'] ?? '')) ?: null,
                trim((string)($b['address_line2'] ?? '')) ?: null,
                trim((string)($b['city']     ?? '')) ?: null,
                trim((string)($b['region']   ?? '')) ?: null,
                trim((string)($b['postcode'] ?? '')) ?: null,
                trim((string)($b['country']  ?? '')) ?: null,
                !empty($b['has_driving_license']) ? 1 : 0,
                !empty($b['willing_to_drive'])    ? 1 : 0,
                trim((string)($b['role']           ?? '')) ?: null,
                trim((string)($b['candidate_type'] ?? '')) ?: null,
                trim((string)($b['discipline']     ?? '')) ?: null,
                trim((string)($b['experience_level'] ?? '')) ?: null,
                isset($b['experience_years']) && $b['experience_years'] !== '' ? (int)$b['experience_years'] : null,
                trim((string)($b['skills']         ?? '')) ?: null,
                isset($b['day_rate']) && $b['day_rate'] !== '' ? (float)$b['day_rate'] : null,
                strtoupper(trim((string)($b['currency'] ?? 'GBP'))) ?: 'GBP',
                trim((string)($b['availability'] ?? '')) ?: null,
                trim((string)($b['source'] ?? '')) ?: null,
                $status,
                $b['notes'] ?? null,
                $onboardingToken,
            ]);
            $newCandidateId = (int)$pdo->lastInsertId();
            // Replay every audience='candidate' contract template as a pending
            // candidate_documents row (076 multi-audience contracts).
            \BRS\Contracts::fanOutToNewEntity($pdo, 'candidate', $newCandidateId);
            Json::send(['id' => $newCandidateId], 201);
        }
        Json::fail('Method not allowed', 405);
    }

    $id = (int)$segs[2];
    if ($id <= 0) Json::fail('Invalid id', 400);
    $stmt = $pdo->prepare('SELECT * FROM recruitment_candidates WHERE id = ?');
    $stmt->execute([$id]);
    $candidate = $stmt->fetch();
    if (!$candidate) Json::fail('Candidate not found', 404);

    $sub = $segs[3] ?? '';

    // /api/recruitment/candidates/:id/cv  — multipart upload, replaces CV pointer.
    // Files land at uploads/recruitment/candidates/<id> - <name>/CV/CV.<ext>.
    // Only one CV per candidate: any previous file is unlinked before the new
    // one is written so a .docx → .pdf swap doesn't leave the old one behind.
    if ($sub === 'cv') {
        if ($method !== 'POST') Json::fail('Method not allowed', 405);
        if (empty($_FILES['file'])) Json::fail('file required', 400);
        $f = $_FILES['file'];
        if ($f['error'] !== UPLOAD_ERR_OK) Json::fail('upload failed (code ' . $f['error'] . ')', 400);
        $folder = candidateFolderSlug($pdo, $id);
        $dir = __DIR__ . '/../../uploads/recruitment/candidates/' . $folder . '/CV';
        if (!is_dir($dir)) @mkdir($dir, 0775, true);
        // Fixed filename = "CV.<ext>". Lower-cased so the disk stays
        // predictable across uploads. New ext → wipe old file; same
        // ext → move_uploaded_file overwrites it in place.
        $ext = strtolower((string)pathinfo((string)$f['name'], PATHINFO_EXTENSION));
        $fname = 'CV' . ($ext !== '' ? '.' . $ext : '');
        $rel = 'uploads/recruitment/candidates/' . $folder . '/CV/' . $fname;
        $oldCv = (string)($candidate['cv_file_path'] ?? '');
        if ($oldCv !== '' && $oldCv !== $rel) {
            $abs = __DIR__ . '/../../' . $oldCv;
            if (is_file($abs)) @unlink($abs);
        }
        if (!move_uploaded_file($f['tmp_name'], $dir . '/' . $fname)) Json::fail('failed to save file', 500);
        $pdo->prepare('UPDATE recruitment_candidates SET cv_file_path=?, cv_file_size=?, cv_mime_type=? WHERE id=?')
            ->execute([$rel, (int)$f['size'], $f['type'] ?? null, $id]);
        Json::send(['ok' => true, 'file_path' => $rel], 201);
    }

    // /api/recruitment/candidates/:id/documents[/:did]
    if ($sub === 'documents') {
        handleRecruitmentCandidateDocuments($pdo, $method, $segs, $id);
        return;
    }
    // /api/recruitment/candidates/:id/notes[/:nid]
    if ($sub === 'notes') {
        handleRecruitmentCandidateNotes($pdo, $method, $segs, $id);
        return;
    }
    // /api/recruitment/candidates/:id/placements[/:pid]
    if ($sub === 'placements') {
        handleRecruitmentPlacements($pdo, $method, $segs, $id);
        return;
    }

    // GET /api/recruitment/candidates/:id  — includes onboarding progress
    if ($method === 'GET') {
        // Build the onboarding checklist: every doc-type flagged
        // `add_to_onboarding` (independent of `is_required` — optional
        // items still appear on the checklist, just not as blockers).
        $onTypes = $pdo->query(
            'SELECT id, name, is_required, submission_type, needs_issuing_body,
                    needs_reference, needs_issue_date, needs_expiry_date
             FROM recruitment_doc_types
             WHERE add_to_onboarding = 1
             ORDER BY sort_order, id'
        )->fetchAll();
        $stmt = $pdo->prepare('SELECT doc_type_id, status FROM recruitment_candidate_documents WHERE candidate_id = ? AND doc_type_id IS NOT NULL');
        $stmt->execute([$id]);
        $submitted = [];
        foreach ($stmt->fetchAll() as $r) {
            $submitted[(int)$r['doc_type_id']] = $r['status'];
        }
        $checklist = [];
        $onIds = [];
        foreach ($onTypes as $t) {
            $tid = (int)$t['id'];
            $onIds[] = $tid;
            $checklist[] = [
                'doc_type_id'     => $tid,
                'name'            => $t['name'],
                'is_required'     => (int)$t['is_required'],
                'submission_type' => $t['submission_type'] ?? 'file',
                'status'          => $submitted[$tid] ?? null,
            ];
        }
        // Progress counts: span the WHOLE checklist (every doc-type with
        // add_to_onboarding=1), not just `is_required=1`. The user expects
        // the "X / Y valid" badge to match the number of rows they can
        // see. Previously the denominator filtered to required-only,
        // which read as a bug when optional rows like CSCS were visible.
        // The `is_required` flag still drives per-row "Required / Optional"
        // pills in the UI, just not the progress denominator.
        $onSubmitted = array_intersect_key($submitted, array_flip($onIds));
        $progress = [
            'contract_signed' => !empty($candidate['contract_signed_at']),
            'docs_required'   => count($onTypes),
            'docs_valid'      => count(array_filter($onSubmitted, fn($s) => $s === 'valid')),
            'docs_pending'    => count(array_filter($onSubmitted, fn($s) => $s === 'pending')),
        ];
        Json::send([
            'candidate' => $candidate,
            'onboarding' => [
                'checklist' => $checklist,
                'progress'  => $progress,
            ],
        ]);
    }

    if ($method === 'PUT') {
        $b = Json::readBody();
        // Patch-style: only update fields the client explicitly sent.
        $fields = [
            'first_name','last_name','email','phone','dob','nationality','gender',
            'address_line1','address_line2','city','region','postcode','country',
            'has_driving_license','willing_to_drive',
            'role','candidate_type','discipline','experience_level','experience_years','skills',
            'day_rate','currency','availability','source','status','notes',
            'contract_signed_at',
        ];
        $sets = []; $params = [];
        foreach ($fields as $f) {
            if (array_key_exists($f, $b)) {
                $val = $b[$f];
                if (is_string($val)) $val = trim($val);
                if ($val === '') $val = null;
                if ($f === 'status' && $val !== null && !in_array($val, ['new','interviewing','processing','compliant','client_screening','placed','rejected_by_us'], true)) {
                    Json::fail('Invalid status', 400);
                }
                if ($f === 'gender' && $val !== null && !in_array($val, ['male','female','other','prefer_not_to_say'], true)) {
                    Json::fail('Invalid gender', 400);
                }
                if ($f === 'has_driving_license' || $f === 'willing_to_drive') {
                    $val = $val ? 1 : 0;
                }
                $sets[] = "`$f` = ?";
                $params[] = $val;
            }
        }
        if (!$sets) Json::send(['ok' => true, 'changed' => 0]);
        $params[] = $id;
        $pdo->prepare('UPDATE recruitment_candidates SET ' . implode(', ', $sets) . ' WHERE id = ?')->execute($params);
        Json::send(['ok' => true, 'changed' => count($sets)]);
    }

    if ($method === 'DELETE') {
        $pdo->prepare('DELETE FROM recruitment_candidates WHERE id = ?')->execute([$id]);
        Json::send(['ok' => true]);
    }

    Json::fail('Method not allowed', 405);
}

// ────────── Candidate documents (sub-resource) ─────────────────────────
function handleRecruitmentCandidateDocuments(\PDO|\BRS\TenantPdo $pdo, string $method, array $segs, int $candidateId): void {
    // /api/recruitment/candidates/:id/documents
    if (!isset($segs[4])) {
        if ($method === 'GET') {
            $stmt = $pdo->prepare(
                'SELECT d.*, t.name AS doc_type_name
                 FROM recruitment_candidate_documents d
                 LEFT JOIN recruitment_doc_types t ON t.id = d.doc_type_id
                 WHERE d.candidate_id = ?
                 ORDER BY d.uploaded_at DESC'
            );
            $stmt->execute([$candidateId]);
            Json::send(['documents' => $stmt->fetchAll()]);
        }
        if ($method === 'POST') {
            // Two submission flavours:
            //   - file upload (multipart, has $_FILES['file'])
            //   - info-only (no file, just metadata — multipart or JSON)
            // Switch based on whether a file was sent; doc-type's
            // submission_type is advisory (frontend hides the picker for
            // info-only types) but the backend stays permissive so an
            // admin can attach a file ad-hoc.
            $isMultipart = !empty($_FILES) || !empty($_POST);
            $body = $isMultipart ? $_POST : Json::readBody();

            $title     = trim((string)($body['title'] ?? ''));
            $docTypeId = isset($body['doc_type_id']) && $body['doc_type_id'] !== '' ? (int)$body['doc_type_id'] : null;
            $reference = trim((string)($body['reference_number'] ?? '')) ?: null;
            $issuingBody = trim((string)($body['issuing_body'] ?? '')) ?: null;
            $issuedAt  = trim((string)($body['issued_at']  ?? '')) ?: null;
            $expiresAt = trim((string)($body['expires_at'] ?? '')) ?: null;

            // Resolve the doc-type's display name now — we use it both
            // as the filename (so a 12345_ugly-id.pdf upload lands as
            // "Passport_National_ID.pdf") AND as the row title when the
            // caller didn't supply one. Falls back to a sensible default
            // for untyped uploads.
            $typeName = null;
            if ($docTypeId) {
                $nm = $pdo->prepare('SELECT name FROM recruitment_doc_types WHERE id = ?');
                $nm->execute([$docTypeId]);
                $typeName = (string)($nm->fetchColumn() ?: '');
            }

            // ONE-PER-TYPE rule: if a row already exists for this
            // (candidate, doc-type), it represents the same compliance
            // item. New upload OVERWRITES it — old file unlinked, old
            // row deleted, new row inserted below. Untyped uploads (no
            // doc_type_id) skip this and stack normally.
            $existingFilePaths = [];
            if ($docTypeId) {
                $existing = $pdo->prepare(
                    'SELECT id, file_path FROM recruitment_candidate_documents
                     WHERE candidate_id = ? AND doc_type_id = ?'
                );
                $existing->execute([$candidateId, $docTypeId]);
                $existingRows = $existing->fetchAll();
                foreach ($existingRows as $row) {
                    if (!empty($row['file_path'])) $existingFilePaths[] = (string)$row['file_path'];
                }
                if ($existingRows) {
                    $delRows = $pdo->prepare('DELETE FROM recruitment_candidate_documents WHERE candidate_id = ? AND doc_type_id = ?');
                    $delRows->execute([$candidateId, $docTypeId]);
                }
            }

            $rel = null; $size = null; $mime = null;
            if (!empty($_FILES['file'])) {
                $f = $_FILES['file'];
                if ($f['error'] !== UPLOAD_ERR_OK) Json::fail('upload failed (code ' . $f['error'] . ')', 400);
                if ($title === '') $title = $typeName !== null && $typeName !== '' ? $typeName : $f['name'];
                // Layout: uploads/recruitment/candidates/<id> - <name>/<group>/<file>
                $folder = candidateFolderSlug($pdo, $candidateId);
                $group  = candidateDocGroupSlug($pdo, $docTypeId);
                $dir = __DIR__ . '/../../uploads/recruitment/candidates/' . $folder . '/' . $group;
                if (!is_dir($dir)) @mkdir($dir, 0775, true);

                // Filename strategy: typed uploads get renamed to the
                // doc-type's name + the original extension (so
                // "my-passport-2024.pdf" lands as "Passport_National_ID.pdf"
                // under the Identity group). Untyped uploads keep the
                // original basename with a timestamp prefix.
                $ext = strtolower((string)pathinfo($f['name'], PATHINFO_EXTENSION));
                if ($docTypeId && $typeName) {
                    $safeBase = preg_replace('/[^A-Za-z0-9._ -]+/', '_', $typeName) ?? 'document';
                    $safeBase = rtrim($safeBase, ". \t\n\r\0\x0B");
                    if ($safeBase === '') $safeBase = 'document';
                    $fname = $safeBase . ($ext !== '' ? '.' . $ext : '');
                } else {
                    $safe = preg_replace('/[^A-Za-z0-9._-]+/', '_', basename($f['name']));
                    $fname = time() . '_' . $safe;
                }

                // Best-effort cleanup of any leftover files from prior
                // rows for the same doc-type (including when the previous
                // upload had a different extension and would otherwise
                // linger on disk).
                foreach ($existingFilePaths as $old) {
                    $abs = __DIR__ . '/../../' . $old;
                    if (is_file($abs)) @unlink($abs);
                }

                if (!move_uploaded_file($f['tmp_name'], $dir . '/' . $fname)) Json::fail('failed to save file', 500);
                $rel = 'uploads/recruitment/candidates/' . $folder . '/' . $group . '/' . $fname;
                $size = (int)$f['size'];
                $mime = $f['type'] ?? null;
            } else {
                // Info-only — derive title from doc-type if not supplied.
                if ($title === '' && $typeName) $title = $typeName;
                if ($title === '') Json::fail('title or doc_type_id required for info-only entries', 400);
            }

            $claims = Auth::require();
            $stmt = $pdo->prepare(
                'INSERT INTO recruitment_candidate_documents
                 (candidate_id, doc_type_id, title, file_path, file_size, mime_type,
                  reference_number, issuing_body, issued_at, expires_at, status, uploaded_by)
                 VALUES (?,?,?,?,?,?, ?,?,?,?, ?,?)'
            );
            $status = 'pending';   // admin/reviewer changes to valid/rejected via PUT
            $stmt->execute([
                $candidateId, $docTypeId, $title, $rel, $size, $mime,
                $reference, $issuingBody, $issuedAt, $expiresAt,
                $status, (int)($claims['sub'] ?? 0) ?: null,
            ]);
            Json::send(['id' => (int)$pdo->lastInsertId()], 201);
        }
        Json::fail('Method not allowed', 405);
    }

    $did = (int)$segs[4];
    if ($did <= 0) Json::fail('Invalid document id', 400);
    $stmt = $pdo->prepare('SELECT * FROM recruitment_candidate_documents WHERE id = ? AND candidate_id = ?');
    $stmt->execute([$did, $candidateId]);
    $doc = $stmt->fetch();
    if (!$doc) Json::fail('Document not found', 404);

    if ($method === 'PUT') {
        $b = Json::readBody();
        $allowed = ['title','reference_number','issuing_body','issued_at','expires_at','status'];
        $sets = []; $params = [];
        foreach ($allowed as $f) {
            if (array_key_exists($f, $b)) {
                $val = $b[$f];
                if (is_string($val)) $val = trim($val);
                if ($val === '') $val = null;
                if ($f === 'status' && $val !== null && !in_array($val, ['pending','valid','expired','rejected'], true)) {
                    Json::fail('Invalid status', 400);
                }
                $sets[] = "`$f` = ?";
                $params[] = $val;
            }
        }
        if (!$sets) Json::send(['ok' => true]);
        $params[] = $did;
        $pdo->prepare('UPDATE recruitment_candidate_documents SET ' . implode(', ', $sets) . ' WHERE id = ?')->execute($params);
        Json::send(['ok' => true]);
    }

    if ($method === 'DELETE') {
        // Best-effort cleanup of the file on disk.
        if (!empty($doc['file_path'])) {
            $abs = __DIR__ . '/../../' . $doc['file_path'];
            if (is_file($abs)) @unlink($abs);
        }
        $pdo->prepare('DELETE FROM recruitment_candidate_documents WHERE id = ?')->execute([$did]);
        Json::send(['ok' => true]);
    }

    Json::fail('Method not allowed', 405);
}

// ────────── Candidate notes (sub-resource) ─────────────────────────────
function handleRecruitmentCandidateNotes(\PDO|\BRS\TenantPdo $pdo, string $method, array $segs, int $candidateId): void {
    if (!isset($segs[4])) {
        if ($method === 'GET') {
            $stmt = $pdo->prepare('SELECT * FROM recruitment_candidate_notes WHERE candidate_id = ? ORDER BY sort_order, id DESC');
            $stmt->execute([$candidateId]);
            Json::send(['notes' => $stmt->fetchAll()]);
        }
        if ($method === 'POST') {
            $b = Json::readBody();
            $title = trim((string)($b['title'] ?? ''));
            if ($title === '') Json::fail('title required', 400);
            // Auto-tag the note with the candidate's current pipeline status
            // (snapshot at write time). Override via explicit `status` in body
            // if the caller knows better.
            $statusEnum = ['new','interviewing','processing','compliant','client_screening','placed','rejected_by_us'];
            $noteStatus = null;
            if (array_key_exists('status', $b) && in_array($b['status'], $statusEnum, true)) {
                $noteStatus = $b['status'];
            } else {
                $cs = $pdo->prepare('SELECT status FROM recruitment_candidates WHERE id = ?');
                $cs->execute([$candidateId]);
                $cur = (string)($cs->fetchColumn() ?: 'new');
                if (in_array($cur, $statusEnum, true)) $noteStatus = $cur;
            }
            $stmt = $pdo->prepare('INSERT INTO recruitment_candidate_notes (candidate_id, title, body, status, sort_order) VALUES (?,?,?,?,?)');
            $stmt->execute([$candidateId, $title, $b['body'] ?? null, $noteStatus, (int)($b['sort_order'] ?? 0)]);
            Json::send(['id' => (int)$pdo->lastInsertId(), 'status' => $noteStatus], 201);
        }
        Json::fail('Method not allowed', 405);
    }
    $nid = (int)$segs[4];
    if ($nid <= 0) Json::fail('Invalid note id', 400);
    if ($method === 'PUT') {
        $b = Json::readBody();
        $statusEnum = ['new','interviewing','processing','compliant','client_screening','placed','rejected_by_us'];
        // Pull current status to fall back to if the caller didn't send one.
        $cur = $pdo->prepare('SELECT status FROM recruitment_candidate_notes WHERE id = ? AND candidate_id = ?');
        $cur->execute([$nid, $candidateId]);
        $curStatus = (string)($cur->fetchColumn() ?: '');
        $status = $curStatus !== '' ? $curStatus : null;
        if (array_key_exists('status', $b)) {
            $status = (in_array($b['status'], $statusEnum, true)) ? $b['status'] : null;
        }
        $pdo->prepare('UPDATE recruitment_candidate_notes SET title=?, body=?, status=?, sort_order=? WHERE id=? AND candidate_id=?')
            ->execute([
                trim((string)($b['title'] ?? '')) ?: 'Note',
                $b['body'] ?? null,
                $status,
                (int)($b['sort_order'] ?? 0),
                $nid, $candidateId,
            ]);
        Json::send(['ok' => true]);
    }
    if ($method === 'DELETE') {
        $pdo->prepare('DELETE FROM recruitment_candidate_notes WHERE id = ? AND candidate_id = ?')->execute([$nid, $candidateId]);
        Json::send(['ok' => true]);
    }
    Json::fail('Method not allowed', 405);
}

// ────────── Doc-type catalogue (settings) ──────────────────────────────
function handleRecruitmentDocTypes(\PDO|\BRS\TenantPdo $pdo, string $method, array $segs): void {
    if (!isset($segs[2])) {
        if ($method === 'GET') {
            // `add_as_skill` is derived from the existence of a linked
            // recruitment_skills row — see lib doc on migration 081.
            $rows = $pdo->query(
                "SELECT t.*,
                        (CASE WHEN EXISTS(SELECT 1 FROM recruitment_skills s WHERE s.doc_type_id = t.id)
                              THEN 1 ELSE 0 END) AS add_as_skill
                 FROM recruitment_doc_types t
                 ORDER BY t.sort_order, t.id"
            )->fetchAll();
            Json::send(['types' => $rows]);
        }
        if ($method === 'POST') {
            $b = Json::readBody();
            $name = trim((string)($b['name'] ?? ''));
            if ($name === '') Json::fail('name required', 400);
            $sub = (string)($b['submission_type'] ?? 'file');
            if (!in_array($sub, ['file','info_only'], true)) $sub = 'file';
            $groupId = (isset($b['group_id']) && $b['group_id'] !== '' && $b['group_id'] !== null)
                ? (int)$b['group_id'] : null;
            $stmt = $pdo->prepare(
                'INSERT INTO recruitment_doc_types
                 (name, description, group_id, is_required, add_to_onboarding, submission_type,
                  needs_reference, needs_issue_date, needs_expiry_date, needs_issuing_body, sort_order)
                 VALUES (?,?,?,?,?,?, ?,?,?,?,?)'
            );
            $stmt->execute([
                $name,
                $b['description'] ?? null,
                $groupId,
                !empty($b['is_required'])        ? 1 : 0,
                !empty($b['add_to_onboarding'])  ? 1 : 0,
                $sub,
                !empty($b['needs_reference'])    ? 1 : 0,
                !empty($b['needs_issue_date'])   ? 1 : 0,
                !empty($b['needs_expiry_date'])  ? 1 : 0,
                !empty($b['needs_issuing_body']) ? 1 : 0,
                isset($b['sort_order']) ? (int)$b['sort_order']
                    : ((int)$pdo->query('SELECT COALESCE(MAX(sort_order),0)+10 FROM recruitment_doc_types')->fetchColumn()),
            ]);
            $newId = (int)$pdo->lastInsertId();
            // Sync the "Add as skill" toggle — see syncDocTypeSkillLink().
            if (array_key_exists('add_as_skill', $b)) {
                syncDocTypeSkillLink($pdo, $newId, $name, !empty($b['add_as_skill']));
            }
            Json::send(['id' => $newId], 201);
        }
        Json::fail('Method not allowed', 405);
    }
    $id = (int)$segs[2];
    if ($id <= 0) Json::fail('Invalid id', 400);
    $row = $pdo->prepare('SELECT * FROM recruitment_doc_types WHERE id = ?');
    $row->execute([$id]);
    $cur = $row->fetch();
    if (!$cur) Json::fail('Doc type not found', 404);

    if ($method === 'PUT') {
        $b = Json::readBody();
        $sub = isset($b['submission_type']) && in_array($b['submission_type'], ['file','info_only'], true)
            ? $b['submission_type']
            : ($cur['submission_type'] ?? 'file');
        $groupId = array_key_exists('group_id', $b)
            ? (($b['group_id'] === '' || $b['group_id'] === null) ? null : (int)$b['group_id'])
            : ($cur['group_id'] !== null ? (int)$cur['group_id'] : null);
        $pdo->prepare(
            'UPDATE recruitment_doc_types
             SET name=?, description=?, group_id=?,
                 is_required=?, add_to_onboarding=?, submission_type=?,
                 needs_reference=?, needs_issue_date=?, needs_expiry_date=?, needs_issuing_body=?,
                 sort_order=?
             WHERE id=?'
        )->execute([
            trim((string)($b['name'] ?? $cur['name'])) ?: $cur['name'],
            array_key_exists('description', $b) ? $b['description'] : $cur['description'],
            $groupId,
            isset($b['is_required'])        ? (int)!!$b['is_required']        : (int)$cur['is_required'],
            isset($b['add_to_onboarding'])  ? (int)!!$b['add_to_onboarding']  : (int)($cur['add_to_onboarding'] ?? 1),
            $sub,
            isset($b['needs_reference'])    ? (int)!!$b['needs_reference']    : (int)$cur['needs_reference'],
            isset($b['needs_issue_date'])   ? (int)!!$b['needs_issue_date']   : (int)$cur['needs_issue_date'],
            isset($b['needs_expiry_date'])  ? (int)!!$b['needs_expiry_date']  : (int)$cur['needs_expiry_date'],
            isset($b['needs_issuing_body']) ? (int)!!$b['needs_issuing_body'] : (int)($cur['needs_issuing_body'] ?? 0),
            isset($b['sort_order']) ? (int)$b['sort_order'] : (int)$cur['sort_order'],
            $id,
        ]);
        // Sync the "Add as skill" toggle. If the doc-type was renamed,
        // the linked skill's name follows so the catalogue + skills list
        // stay aligned.
        $newName = trim((string)($b['name'] ?? $cur['name'])) ?: $cur['name'];
        if (array_key_exists('add_as_skill', $b)) {
            syncDocTypeSkillLink($pdo, $id, $newName, !empty($b['add_as_skill']));
        } elseif ($newName !== $cur['name']) {
            // Name changed but the toggle wasn't sent — keep the link in sync.
            $pdo->prepare('UPDATE recruitment_skills SET name = ? WHERE doc_type_id = ?')
                ->execute([$newName, $id]);
        }
        Json::send(['ok' => true]);
    }
    if ($method === 'DELETE') {
        $pdo->prepare('DELETE FROM recruitment_doc_types WHERE id = ?')->execute([$id]);
        Json::send(['ok' => true]);
    }
    Json::fail('Method not allowed', 405);
}

// ────────── Aggregated documents view ──────────────────────────────────
function handleRecruitmentDocuments(\PDO|\BRS\TenantPdo $pdo, string $method): void {
    if ($method !== 'GET') Json::fail('Method not allowed', 405);
    $rows = $pdo->query(
        "SELECT d.id, d.candidate_id, d.title, d.file_path, d.file_size, d.mime_type,
                d.reference_number, d.issued_at, d.expires_at, d.uploaded_at, d.status,
                t.name AS doc_type_name,
                TRIM(CONCAT(c.first_name, ' ', c.last_name)) AS candidate_name
         FROM recruitment_candidate_documents d
         LEFT JOIN recruitment_doc_types t ON t.id = d.doc_type_id
         LEFT JOIN recruitment_candidates c ON c.id = d.candidate_id
         WHERE d.file_path IS NOT NULL AND d.file_path <> ''
         ORDER BY d.uploaded_at DESC"
    )->fetchAll();
    Json::send(['documents' => $rows]);
}

// ────────── Doc-type groups (settings) ─────────────────────────────────
function handleRecruitmentDocGroups(\PDO|\BRS\TenantPdo $pdo, string $method, array $segs): void {
    if (!isset($segs[2])) {
        if ($method === 'GET') {
            $rows = $pdo->query('SELECT id, name, sort_order FROM recruitment_doc_groups ORDER BY sort_order, id')->fetchAll();
            Json::send(['groups' => $rows]);
        }
        if ($method === 'POST') {
            $b = Json::readBody();
            $name = trim((string)($b['name'] ?? ''));
            if ($name === '') Json::fail('name required', 400);
            $sort = isset($b['sort_order']) ? (int)$b['sort_order']
                : ((int)$pdo->query('SELECT COALESCE(MAX(sort_order),0)+10 FROM recruitment_doc_groups')->fetchColumn());
            $pdo->prepare('INSERT INTO recruitment_doc_groups (name, sort_order) VALUES (?,?)')->execute([$name, $sort]);
            Json::send(['id' => (int)$pdo->lastInsertId()], 201);
        }
        Json::fail('Method not allowed', 405);
    }
    $id = (int)$segs[2];
    if ($id <= 0) Json::fail('Invalid id', 400);
    $row = $pdo->prepare('SELECT * FROM recruitment_doc_groups WHERE id = ?');
    $row->execute([$id]);
    $cur = $row->fetch();
    if (!$cur) Json::fail('Group not found', 404);

    if ($method === 'PUT') {
        $b = Json::readBody();
        $pdo->prepare('UPDATE recruitment_doc_groups SET name = ?, sort_order = ? WHERE id = ?')
            ->execute([
                trim((string)($b['name'] ?? $cur['name'])) ?: $cur['name'],
                isset($b['sort_order']) ? (int)$b['sort_order'] : (int)$cur['sort_order'],
                $id,
            ]);
        Json::send(['ok' => true]);
    }
    if ($method === 'DELETE') {
        // FK on `recruitment_doc_types.group_id` is ON DELETE SET NULL, so
        // existing types just become "Ungrouped" — they are NOT deleted.
        $pdo->prepare('DELETE FROM recruitment_doc_groups WHERE id = ?')->execute([$id]);
        Json::send(['ok' => true]);
    }
    Json::fail('Method not allowed', 405);
}

// ────────── Skills + doc-type linkage ──────────────────────────────────
/**
 * Sync the "Add as skill" toggle for a doc-type. Called from the doc-type
 * POST/PUT handlers — keeps the recruitment_skills table aligned with the
 * checkbox state on the Settings form.
 *
 *   $on === true  → ensure a skill row with this doc_type_id exists and
 *                    has the given name (renames it if necessary).
 *   $on === false → delete any skill row linked to this doc-type. Other
 *                    skills with the same name (unlinked or linked to a
 *                    different doc-type) stay intact.
 *
 * Race condition: if a standalone skill already exists with the same
 * `name` (unique index), we adopt it instead of failing — its
 * `doc_type_id` flips to point at this doc-type.
 */
function syncDocTypeSkillLink(\PDO|\BRS\TenantPdo $pdo, int $docTypeId, string $name, bool $on): void {
    $existing = $pdo->prepare('SELECT id, doc_type_id FROM recruitment_skills WHERE doc_type_id = ?');
    $existing->execute([$docTypeId]);
    $linked = $existing->fetch();

    if ($on) {
        if ($linked) {
            // Already linked — rename if needed.
            $pdo->prepare('UPDATE recruitment_skills SET name = ? WHERE id = ?')->execute([$name, (int)$linked['id']]);
            return;
        }
        // Look for an unlinked skill with the same name to adopt.
        $byName = $pdo->prepare('SELECT id FROM recruitment_skills WHERE name = ?');
        $byName->execute([$name]);
        if ($sid = (int)($byName->fetchColumn() ?: 0)) {
            $pdo->prepare('UPDATE recruitment_skills SET doc_type_id = ? WHERE id = ?')->execute([$docTypeId, $sid]);
            return;
        }
        $nextOrder = (int)$pdo->query('SELECT COALESCE(MAX(sort_order),0)+10 FROM recruitment_skills')->fetchColumn();
        $pdo->prepare('INSERT INTO recruitment_skills (name, doc_type_id, sort_order) VALUES (?,?,?)')
            ->execute([$name, $docTypeId, $nextOrder]);
        return;
    }

    // Turning the toggle OFF — remove the linked skill row.
    if ($linked) {
        $pdo->prepare('DELETE FROM recruitment_skills WHERE id = ?')->execute([(int)$linked['id']]);
    }
}

/**
 * /api/recruitment/skills — standalone skill catalogue. Some rows may be
 * mirrored from a recruitment_doc_types entry (`doc_type_id` set); those
 * are still freely editable but deleting them un-ticks the doc-type's
 * "Add as skill" checkbox automatically (the link IS the flag).
 *
 *   GET    /api/recruitment/skills          → { skills: [...] }
 *   POST   /api/recruitment/skills          → { id }
 *   PUT    /api/recruitment/skills/:id      → { ok }
 *   DELETE /api/recruitment/skills/:id      → { ok }
 */
function handleRecruitmentSkills(\PDO|\BRS\TenantPdo $pdo, string $method, array $segs): void {
    if (!isset($segs[2])) {
        if ($method === 'GET') {
            $rows = $pdo->query(
                'SELECT id, name, doc_type_id, sort_order
                 FROM recruitment_skills
                 ORDER BY sort_order, name'
            )->fetchAll();
            Json::send(['skills' => $rows]);
        }
        if ($method === 'POST') {
            $b = Json::readBody();
            $name = trim((string)($b['name'] ?? ''));
            if ($name === '') Json::fail('name required', 400);
            $sort = isset($b['sort_order']) ? (int)$b['sort_order']
                : ((int)$pdo->query('SELECT COALESCE(MAX(sort_order),0)+10 FROM recruitment_skills')->fetchColumn());
            try {
                $pdo->prepare('INSERT INTO recruitment_skills (name, sort_order) VALUES (?,?)')->execute([$name, $sort]);
            } catch (\PDOException $e) {
                if ((int)$e->errorInfo[1] === 1062) Json::fail('A skill with that name already exists.', 409);
                throw $e;
            }
            Json::send(['id' => (int)$pdo->lastInsertId()], 201);
        }
        Json::fail('Method not allowed', 405);
    }
    $id = (int)$segs[2];
    if ($id <= 0) Json::fail('Invalid id', 400);
    $row = $pdo->prepare('SELECT * FROM recruitment_skills WHERE id = ?');
    $row->execute([$id]);
    $cur = $row->fetch();
    if (!$cur) Json::fail('Skill not found', 404);

    if ($method === 'PUT') {
        $b = Json::readBody();
        $name = trim((string)($b['name'] ?? $cur['name'])) ?: $cur['name'];
        $sort = isset($b['sort_order']) ? (int)$b['sort_order'] : (int)$cur['sort_order'];
        try {
            $pdo->prepare('UPDATE recruitment_skills SET name = ?, sort_order = ? WHERE id = ?')
                ->execute([$name, $sort, $id]);
        } catch (\PDOException $e) {
            if ((int)$e->errorInfo[1] === 1062) Json::fail('A skill with that name already exists.', 409);
            throw $e;
        }
        Json::send(['ok' => true]);
    }
    if ($method === 'DELETE') {
        // The FK link auto-unsets the doc-type's "Add as skill" flag
        // because the flag is derived from EXISTS(skill linked to type).
        $pdo->prepare('DELETE FROM recruitment_skills WHERE id = ?')->execute([$id]);
        Json::send(['ok' => true]);
    }
    Json::fail('Method not allowed', 405);
}


/**
 * /api/recruitment/documents/browse[?path=…] — filesystem walker scoped
 * to cms/uploads/recruitment/. Mirrors the operations browse endpoint.
 *   GET    — list a directory (default action).
 *   DELETE — delete the file or folder at `path`. Recursive on folders.
 *            DB rows (recruitment_candidate_documents.file_path,
 *            recruitment_candidates.cv_file_path) referencing anything
 *            inside the deleted path are cleared so the Documents tab
 *            doesn't keep showing rows pointing at vanished files.
 *
 * Path-safety contract: any '..' segment is rejected up-front; realpath()
 * must resolve under the recruitment uploads root. The root itself is
 * never deletable.
 */
function handleRecruitmentDocumentsBrowse(\PDO|\BRS\TenantPdo $pdo, string $method): void {
    if (!in_array($method, ['GET', 'DELETE'], true)) Json::fail('Method not allowed', 405);

    $root = realpath(__DIR__ . '/../../uploads/recruitment');
    if (!$root) {
        if ($method === 'DELETE') Json::fail('Uploads root missing', 404);
        Json::send(['path' => '', 'parent' => null, 'entries' => []]);
    }

    $rel = (string)($_GET['path'] ?? '');
    $rel = ltrim(str_replace('\\', '/', $rel), '/');
    $parts = array_values(array_filter(explode('/', $rel), fn($p) => $p !== '' && $p !== '.'));
    foreach ($parts as $p) {
        if ($p === '..') Json::fail('Invalid path', 400);
    }
    $rel = implode('/', $parts);

    $target = $root . ($rel !== '' ? DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $rel) : '');
    $resolved = realpath($target);

    if ($method === 'DELETE') {
        if ($rel === '') Json::fail('Cannot delete the recruitment root', 400);
        if (!$resolved || strpos($resolved, $root) !== 0) Json::fail('Path not found', 404);

        // Clean up any DB rows that reference paths under the target so
        // the Documents tab / aggregated views don't keep showing
        // ghost entries.
        $dbPrefix = 'uploads/recruitment/' . $rel;
        if (is_dir($resolved)) {
            $like = $dbPrefix . '/%';
            $pdo->prepare('DELETE FROM recruitment_candidate_documents WHERE file_path = ? OR file_path LIKE ?')
                ->execute([$dbPrefix, $like]);
            $pdo->prepare('UPDATE recruitment_candidates
                           SET cv_file_path = NULL, cv_file_size = NULL, cv_mime_type = NULL
                           WHERE cv_file_path = ? OR cv_file_path LIKE ?')
                ->execute([$dbPrefix, $like]);
            rrmdir($resolved);
        } else {
            $pdo->prepare('DELETE FROM recruitment_candidate_documents WHERE file_path = ?')->execute([$dbPrefix]);
            $pdo->prepare('UPDATE recruitment_candidates
                           SET cv_file_path = NULL, cv_file_size = NULL, cv_mime_type = NULL
                           WHERE cv_file_path = ?')->execute([$dbPrefix]);
            @unlink($resolved);
        }
        Json::send(['ok' => true]);
    }

    // GET
    if (!$resolved || strpos($resolved, $root) !== 0 || !is_dir($resolved)) {
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

/** Recursive rmdir helper. Safe inside the path-safety contract because
 *  the caller has already verified the target resolves under the
 *  recruitment uploads root. */
function rrmdir(string $path): void {
    if (!is_dir($path)) return;
    foreach (new DirectoryIterator($path) as $f) {
        if ($f->isDot()) continue;
        $child = $f->getPathname();
        if ($f->isDir()) rrmdir($child);
        else @unlink($child);
    }
    @rmdir($path);
}

// ────────── Placements (candidate × client) ────────────────────────────
/**
 * /api/recruitment/candidates/:id/placements[/:pid]
 *   GET    — list every placement for this candidate, plus the linked
 *            client's name (LEFT JOIN — clients deleted via cascade
 *            would never appear here, but the join is defensive).
 *   POST   — create.
 *   PUT    — patch (whitelist below).
 *   DELETE — delete.
 *
 * Status semantics:
 *   screening / placed / ended → "Placements" tab on the frontend.
 *   rejected                   → "Rejected" tab.
 * Frontend filters by status; backend just stores + returns all.
 */
function handleRecruitmentPlacements(\PDO|\BRS\TenantPdo $pdo, string $method, array $segs, int $candidateId): void {
    $statuses = ['screening', 'placed', 'ended', 'rejected'];

    if (!isset($segs[4])) {
        if ($method === 'GET') {
            $stmt = $pdo->prepare(
                'SELECT p.*, c.name AS client_name,
                        r.title AS role_title
                 FROM recruitment_placements p
                 LEFT JOIN clients c ON c.id = p.client_id
                 LEFT JOIN recruitment_roles r ON r.id = p.role_id
                 WHERE p.candidate_id = ?
                 ORDER BY p.created_at DESC'
            );
            $stmt->execute([$candidateId]);
            Json::send(['placements' => $stmt->fetchAll()]);
        }
        if ($method === 'POST') {
            $b = Json::readBody();
            $clientId = isset($b['client_id']) && $b['client_id'] !== '' ? (int)$b['client_id'] : 0;
            if ($clientId <= 0) Json::fail('client_id required', 400);
            // Validate the client exists; reject silently otherwise so
            // callers don't end up with orphan FK references.
            $chk = $pdo->prepare('SELECT 1 FROM clients WHERE id = ?');
            $chk->execute([$clientId]);
            if (!$chk->fetchColumn()) Json::fail('Client not found', 400);

            $status = (string)($b['status'] ?? 'screening');
            if (!in_array($status, $statuses, true)) $status = 'screening';
            $currency = strtoupper(trim((string)($b['currency'] ?? 'GBP')));
            if (strlen($currency) !== 3) $currency = 'GBP';

            // Optional role_id — validates that the role exists and is
            // attached to the SAME client this placement targets, so a
            // candidate can't be accidentally tied to a role at a
            // different client.
            $roleId = null;
            if (isset($b['role_id']) && $b['role_id'] !== '' && $b['role_id'] !== null) {
                $roleId = (int)$b['role_id'];
                $rchk = $pdo->prepare('SELECT client_id FROM recruitment_roles WHERE id = ?');
                $rchk->execute([$roleId]);
                $rclient = (int)($rchk->fetchColumn() ?: 0);
                if ($rclient === 0)                 Json::fail('Role not found', 400);
                if ($rclient !== $clientId)         Json::fail('Role belongs to a different client', 400);
            }
            $ins = $pdo->prepare(
                'INSERT INTO recruitment_placements
                 (candidate_id, client_id, role_id, role, status, start_date, end_date,
                  contract_value, commission_value, currency,
                  commission_paid_part, commission_paid_full,
                  commission_due_part, commission_due_full,
                  contract_notes, rejection_reason)
                 VALUES (?,?,?,?,?,?,?, ?,?,?, ?,?, ?,?, ?,?)'
            );
            $ins->execute([
                $candidateId, $clientId, $roleId,
                trim((string)($b['role'] ?? '')) ?: null,
                $status,
                trim((string)($b['start_date'] ?? '')) ?: null,
                trim((string)($b['end_date']   ?? '')) ?: null,
                isset($b['contract_value'])   && $b['contract_value']   !== '' ? (float)$b['contract_value']   : null,
                isset($b['commission_value']) && $b['commission_value'] !== '' ? (float)$b['commission_value'] : null,
                $currency,
                !empty($b['commission_paid_part']) ? 1 : 0,
                !empty($b['commission_paid_full']) ? 1 : 0,
                trim((string)($b['commission_due_part'] ?? '')) ?: null,
                trim((string)($b['commission_due_full'] ?? '')) ?: null,
                $b['contract_notes']   ?? null,
                $b['rejection_reason'] ?? null,
            ]);
            Json::send(['id' => (int)$pdo->lastInsertId()], 201);
        }
        Json::fail('Method not allowed', 405);
    }

    $pid = (int)$segs[4];
    if ($pid <= 0) Json::fail('Invalid placement id', 400);
    $row = $pdo->prepare('SELECT * FROM recruitment_placements WHERE id = ? AND candidate_id = ?');
    $row->execute([$pid, $candidateId]);
    $cur = $row->fetch();
    if (!$cur) Json::fail('Placement not found', 404);

    if ($method === 'PUT') {
        $b = Json::readBody();
        $fields = [
            'client_id', 'role_id', 'role', 'status', 'start_date', 'end_date',
            'contract_value', 'commission_value', 'currency',
            'commission_paid_part', 'commission_paid_full',
            'commission_due_part', 'commission_due_full',
            'contract_notes', 'rejection_reason',
        ];
        $sets = []; $params = [];
        foreach ($fields as $f) {
            if (!array_key_exists($f, $b)) continue;
            $val = $b[$f];
            if (is_string($val)) $val = trim($val);
            if ($val === '') $val = null;
            if ($f === 'status' && $val !== null && !in_array($val, $statuses, true)) {
                Json::fail('Invalid status', 400);
            }
            if ($f === 'currency' && $val !== null) {
                $val = strtoupper((string)$val);
                if (strlen($val) !== 3) $val = 'GBP';
            }
            if ($f === 'commission_paid_part' || $f === 'commission_paid_full') {
                $val = $val ? 1 : 0;
            }
            if ($f === 'client_id' && $val !== null) {
                $val = (int)$val;
                if ($val <= 0) Json::fail('Invalid client_id', 400);
                $chk = $pdo->prepare('SELECT 1 FROM clients WHERE id = ?');
                $chk->execute([$val]);
                if (!$chk->fetchColumn()) Json::fail('Client not found', 400);
            }
            if ($f === 'role_id' && $val !== null) {
                $val = (int)$val;
                if ($val <= 0) { $val = null; }
                else {
                    $rchk = $pdo->prepare('SELECT 1 FROM recruitment_roles WHERE id = ?');
                    $rchk->execute([$val]);
                    if (!$rchk->fetchColumn()) Json::fail('Role not found', 400);
                }
            }
            if (in_array($f, ['contract_value', 'commission_value'], true) && $val !== null) {
                $val = (float)$val;
            }
            $sets[] = "`$f` = ?";
            $params[] = $val;
        }
        if (!$sets) Json::send(['ok' => true, 'changed' => 0]);
        $params[] = $pid;
        $pdo->prepare('UPDATE recruitment_placements SET ' . implode(', ', $sets) . ' WHERE id = ?')->execute($params);
        Json::send(['ok' => true, 'changed' => count($sets)]);
    }

    if ($method === 'DELETE') {
        $pdo->prepare('DELETE FROM recruitment_placements WHERE id = ?')->execute([$pid]);
        Json::send(['ok' => true]);
    }

    Json::fail('Method not allowed', 405);
}

/**
 * GET /api/recruitment/clients/:id/placements — every placement that
 * touched this client, with candidate name + candidate's overall pipeline
 * status joined in so the Recruitment client detail page can render the
 * full who-have-we-pitched view without a fan-out to candidate fetches.
 */
function handleRecruitmentClientPlacements(\PDO|\BRS\TenantPdo $pdo, string $method, int $clientId): void {
    if ($method !== 'GET') Json::fail('Method not allowed', 405);
    $stmt = $pdo->prepare(
        "SELECT p.*,
                c.name AS client_name,
                r.title AS role_title,
                TRIM(CONCAT(can.first_name, ' ', can.last_name)) AS candidate_name,
                can.role AS candidate_role,
                can.status AS candidate_status
         FROM recruitment_placements p
         LEFT JOIN clients c ON c.id = p.client_id
         LEFT JOIN recruitment_roles r ON r.id = p.role_id
         LEFT JOIN recruitment_candidates can ON can.id = p.candidate_id
         WHERE p.client_id = ?
         ORDER BY p.created_at DESC"
    );
    $stmt->execute([$clientId]);
    Json::send(['placements' => $stmt->fetchAll()]);
}

// ────────── Roles (client openings) ────────────────────────────────────
/**
 * /api/recruitment/clients/:id/roles[/:rid]
 *   GET    — list openings for this client.
 *   POST   — create.
 *   PUT    — patch (whitelist below).
 *   DELETE — delete (existing placements lose their role_id via ON DELETE SET NULL).
 *
 * Roles are agency-side "openings" — created when a client briefs an
 * opportunity. Candidates get added later via the placement endpoint
 * with the role's id attached.
 */
function handleRecruitmentRoles(\PDO|\BRS\TenantPdo $pdo, string $method, array $segs, int $clientId): void {
    $statuses = ['open', 'filled', 'cancelled'];

    if (!isset($segs[4])) {
        if ($method === 'GET') {
            // Pull per-role aggregate counts so the UI can show "3 vetting,
            // 1 placed" badges without a per-row fan-out from the frontend.
            $stmt = $pdo->prepare(
                'SELECT r.*,
                        (SELECT COUNT(*) FROM recruitment_placements p WHERE p.role_id = r.id) AS total_candidates,
                        (SELECT COUNT(*) FROM recruitment_placements p WHERE p.role_id = r.id AND p.status = "screening") AS vetting_count,
                        (SELECT COUNT(*) FROM recruitment_placements p WHERE p.role_id = r.id AND p.status = "placed")    AS placed_count,
                        (SELECT COUNT(*) FROM recruitment_placements p WHERE p.role_id = r.id AND p.status = "rejected")  AS rejected_count
                 FROM recruitment_roles r
                 WHERE r.client_id = ?
                 ORDER BY FIELD(r.status, "open","filled","cancelled"), r.created_at DESC'
            );
            $stmt->execute([$clientId]);
            Json::send(['roles' => $stmt->fetchAll()]);
        }
        if ($method === 'POST') {
            $b = Json::readBody();
            $title = trim((string)($b['title'] ?? ''));
            if ($title === '') Json::fail('title required', 400);
            $status = (string)($b['status'] ?? 'open');
            if (!in_array($status, $statuses, true)) $status = 'open';
            $currency = strtoupper(trim((string)($b['currency'] ?? 'GBP')));
            if (strlen($currency) !== 3) $currency = 'GBP';
            // Confirm the client exists — same defensive check as elsewhere.
            $chk = $pdo->prepare('SELECT 1 FROM clients WHERE id = ?');
            $chk->execute([$clientId]);
            if (!$chk->fetchColumn()) Json::fail('Client not found', 400);

            $ins = $pdo->prepare(
                'INSERT INTO recruitment_roles
                 (client_id, title, description,
                  target_start_date, target_end_date,
                  contract_value, commission_value, commission_part_amount, commission_percent, currency,
                  commission_paid_part, commission_paid_full,
                  commission_due_part, commission_due_full,
                  status, notes)
                 VALUES (?,?,?, ?,?, ?,?,?,?,?, ?,?, ?,?, ?,?)'
            );
            $ins->execute([
                $clientId,
                $title,
                $b['description'] ?? null,
                trim((string)($b['target_start_date'] ?? '')) ?: null,
                trim((string)($b['target_end_date']   ?? '')) ?: null,
                isset($b['contract_value'])         && $b['contract_value']         !== '' ? (float)$b['contract_value']         : null,
                isset($b['commission_value'])       && $b['commission_value']       !== '' ? (float)$b['commission_value']       : null,
                isset($b['commission_part_amount']) && $b['commission_part_amount'] !== '' ? (float)$b['commission_part_amount'] : null,
                isset($b['commission_percent'])     && $b['commission_percent']     !== '' ? (float)$b['commission_percent']     : null,
                $currency,
                !empty($b['commission_paid_part']) ? 1 : 0,
                !empty($b['commission_paid_full']) ? 1 : 0,
                trim((string)($b['commission_due_part'] ?? '')) ?: null,
                trim((string)($b['commission_due_full'] ?? '')) ?: null,
                $status,
                $b['notes'] ?? null,
            ]);
            $newRoleId = (int)$pdo->lastInsertId();
            // Mirror this role as a Recruitment service row on the client's CRM
            // Services tab (1:1). Adding a role here = adding the service there.
            \BRS\Recruitment::createServiceRowForRole($pdo, $clientId, $newRoleId);
            Json::send(['id' => $newRoleId], 201);
        }
        Json::fail('Method not allowed', 405);
    }

    $rid = (int)$segs[4];
    if ($rid <= 0) Json::fail('Invalid role id', 400);
    $row = $pdo->prepare('SELECT * FROM recruitment_roles WHERE id = ? AND client_id = ?');
    $row->execute([$rid, $clientId]);
    $cur = $row->fetch();
    if (!$cur) Json::fail('Role not found', 404);

    if ($method === 'PUT') {
        $b = Json::readBody();
        $fields = [
            'title', 'description',
            'target_start_date', 'target_end_date',
            'contract_value', 'commission_value', 'commission_part_amount', 'commission_percent', 'currency',
            'commission_paid_part', 'commission_paid_full',
            'commission_due_part',  'commission_due_full',
            'status', 'notes',
        ];
        $sets = []; $params = [];
        foreach ($fields as $f) {
            if (!array_key_exists($f, $b)) continue;
            $val = $b[$f];
            if (is_string($val)) $val = trim($val);
            if ($val === '') $val = null;
            if ($f === 'status' && $val !== null && !in_array($val, $statuses, true)) {
                Json::fail('Invalid status', 400);
            }
            if ($f === 'currency' && $val !== null) {
                $val = strtoupper((string)$val);
                if (strlen($val) !== 3) $val = 'GBP';
            }
            if (in_array($f, ['contract_value', 'commission_value', 'commission_part_amount', 'commission_percent'], true) && $val !== null) {
                $val = (float)$val;
            }
            if ($f === 'commission_paid_part' || $f === 'commission_paid_full') {
                $val = $val ? 1 : 0;
            }
            $sets[] = "`$f` = ?";
            $params[] = $val;
        }
        if (!$sets) Json::send(['ok' => true, 'changed' => 0]);
        $params[] = $rid;
        $pdo->prepare('UPDATE recruitment_roles SET ' . implode(', ', $sets) . ' WHERE id = ?')->execute($params);
        Json::send(['ok' => true, 'changed' => count($sets)]);
    }

    if ($method === 'DELETE') {
        // ON DELETE SET NULL on placements.role_id — existing placements
        // stay; they just become role-less.
        $pdo->prepare('DELETE FROM recruitment_roles WHERE id = ?')->execute([$rid]);
        Json::send(['ok' => true]);
    }

    Json::fail('Method not allowed', 405);
}
