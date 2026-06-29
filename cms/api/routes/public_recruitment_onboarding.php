<?php
declare(strict_types=1);

use BRS\Db;
use BRS\Json;

/*
 * Public Recruitment onboarding endpoint — token-driven, NO auth.
 *
 *   GET    /api/public-recruitment-onboarding/:token
 *     → candidate profile + checklist of doc-types added to onboarding,
 *       grouped by their recruitment_doc_groups.
 *
 *   PUT    /api/public-recruitment-onboarding/:token/general
 *     → candidate-editable subset of the profile (general info stage).
 *
 *   POST   /api/public-recruitment-onboarding/:token/sign-contract
 *     → marks contract_signed_at = now. Stores `signed_name` for display.
 *
 *   POST   /api/public-recruitment-onboarding/:token/cv          (multipart)
 *   POST   /api/public-recruitment-onboarding/:token/documents   (multipart)
 *     → forward to the same paths as the admin upload endpoints, but
 *       scoped to the candidate looked up via the token (no Auth::require).
 *
 * Token comes from `recruitment_candidates.onboarding_token` (migration
 * 087). High-entropy hex string, unique per candidate.
 *
 * Editable profile fields are intentionally restricted to what a candidate
 * would reasonably self-serve — internal taxonomy (status, candidate_type,
 * source, etc.) stays admin-only.
 */

use BRS\Tenant;

return function (string $method, array $segs): void {
    // Public routes have no JWT — bootstrap the tenant context.
    // Hardcoded to BRS (tenant 1) until per-tenant public routing
    // lands in Phase 5 (subdomain detection / per-tenant API key).
    Tenant::setForPublic();
    $pdo = Db::tpdo();

    $token = (string)($segs[1] ?? '');
    if ($token === '') Json::fail('Token required', 400);

    $stmt = $pdo->prepare('SELECT * FROM recruitment_candidates WHERE onboarding_token = ?');
    $stmt->execute([$token]);
    $cand = $stmt->fetch();
    if (!$cand) Json::fail('Invalid onboarding link', 404);
    $id = (int)$cand['id'];

    $sub = $segs[2] ?? '';

    // ─── GET /…/:token  → snapshot for the portal ────────────────────
    if ($sub === '' && $method === 'GET') {
        $types = $pdo->query(
            "SELECT t.id, t.name, t.description, t.is_required, t.submission_type,
                    t.needs_reference, t.needs_issuing_body, t.needs_issue_date, t.needs_expiry_date,
                    g.id AS group_id, g.name AS group_name, g.sort_order AS group_sort
             FROM recruitment_doc_types t
             LEFT JOIN recruitment_doc_groups g ON g.id = t.group_id
             WHERE t.add_to_onboarding = 1
             ORDER BY g.sort_order, g.name, t.sort_order, t.id"
        )->fetchAll();

        $docsStmt = $pdo->prepare(
            'SELECT * FROM recruitment_candidate_documents WHERE candidate_id = ?'
        );
        $docsStmt->execute([$id]);
        $submitted = [];
        foreach ($docsStmt->fetchAll() as $d) {
            if ($d['doc_type_id'] !== null) {
                $submitted[(int)$d['doc_type_id']] = $d;
            }
        }

        // Bucket types under their groups (plus "Other" for ungrouped).
        $groups = [];
        $idx = [];
        foreach ($types as $t) {
            $gid   = $t['group_id'] !== null ? (int)$t['group_id'] : 0;
            $gname = $t['group_name'] ?? 'Other';
            if (!isset($idx[$gid])) {
                $idx[$gid] = count($groups);
                $groups[] = ['id' => $gid, 'name' => $gname, 'items' => []];
            }
            $row = [
                'doc_type_id'        => (int)$t['id'],
                'name'               => $t['name'],
                'description'        => $t['description'],
                'is_required'        => (int)$t['is_required'],
                'submission_type'    => $t['submission_type'] ?? 'file',
                'needs_reference'    => (int)$t['needs_reference'],
                'needs_issuing_body' => (int)$t['needs_issuing_body'],
                'needs_issue_date'   => (int)$t['needs_issue_date'],
                'needs_expiry_date'  => (int)$t['needs_expiry_date'],
                'submitted'          => $submitted[(int)$t['id']] ?? null,
            ];
            $groups[$idx[$gid]]['items'][] = $row;
        }

        Json::send([
            'candidate' => [
                'id'                 => $id,
                'first_name'         => $cand['first_name'],
                'last_name'          => $cand['last_name'],
                'email'              => $cand['email'],
                'phone'              => $cand['phone'],
                'dob'                => $cand['dob'],
                'gender'             => $cand['gender'],
                'nationality'        => $cand['nationality'],
                'address_line1'      => $cand['address_line1'],
                'address_line2'      => $cand['address_line2'],
                'city'               => $cand['city'],
                'region'             => $cand['region'],
                'postcode'           => $cand['postcode'],
                'country'            => $cand['country'],
                'has_driving_license'=> (int)$cand['has_driving_license'],
                'willing_to_drive'   => (int)$cand['willing_to_drive'],
                'role'               => $cand['role'],
                'discipline'         => $cand['discipline'],
                'experience_level'   => $cand['experience_level'],
                'experience_years'   => $cand['experience_years'],
                'skills'             => $cand['skills'],
                'availability'       => $cand['availability'],
                'cv_file_path'       => $cand['cv_file_path'],
                'contract_signed_at' => $cand['contract_signed_at'],
            ],
            'doc_groups' => $groups,
        ]);
    }

    // ─── PUT /…/:token/general → editable profile subset ─────────────
    if ($sub === 'general' && $method === 'PUT') {
        $b = Json::readBody();
        $allowed = [
            'first_name', 'last_name', 'email', 'phone', 'dob', 'gender', 'nationality',
            'address_line1', 'address_line2', 'city', 'region', 'postcode', 'country',
            'has_driving_license', 'willing_to_drive',
            'role', 'discipline', 'experience_level', 'experience_years', 'skills',
            'availability',
        ];
        $sets = []; $params = [];
        foreach ($allowed as $f) {
            if (!array_key_exists($f, $b)) continue;
            $val = $b[$f];
            if (is_string($val)) $val = trim($val);
            if ($val === '') $val = null;
            if ($f === 'gender' && $val !== null && !in_array($val, ['male','female','other','prefer_not_to_say'], true)) {
                $val = null;
            }
            if ($f === 'has_driving_license' || $f === 'willing_to_drive') {
                $val = $val ? 1 : 0;
            }
            $sets[] = "`$f` = ?";
            $params[] = $val;
        }
        if (!$sets) Json::send(['ok' => true, 'changed' => 0]);
        $params[] = $id;
        $pdo->prepare('UPDATE recruitment_candidates SET ' . implode(', ', $sets) . ' WHERE id = ?')->execute($params);
        Json::send(['ok' => true, 'changed' => count($sets)]);
    }

    // ─── POST /…/:token/sign-contract → mark signed + capture name ───
    if ($sub === 'sign-contract' && $method === 'POST') {
        $b = Json::readBody();
        $signedName = trim((string)($b['signed_name'] ?? ''));
        if ($signedName === '') Json::fail('Please type your full name to sign.', 400);
        // Best-effort: only update if not already signed so we don't lose
        // the original signed_at on a re-submit.
        $pdo->prepare(
            'UPDATE recruitment_candidates
             SET contract_signed_at = COALESCE(contract_signed_at, NOW())
             WHERE id = ?'
        )->execute([$id]);
        // Append the typed name to notes so the agency has a record of what
        // the candidate typed when signing. Not a legal signature substitute;
        // a future migration can carry a dedicated signature blob if needed.
        $pdo->prepare(
            "UPDATE recruitment_candidates
             SET notes = TRIM(CONCAT(COALESCE(notes, ''),
                              CASE WHEN notes IS NULL OR notes = '' THEN '' ELSE '\n\n' END,
                              ?))
             WHERE id = ?"
        )->execute(['[Contract signed by ' . $signedName . ' on ' . date('Y-m-d H:i') . ']', $id]);

        $cur = $pdo->prepare('SELECT contract_signed_at FROM recruitment_candidates WHERE id = ?');
        $cur->execute([$id]);
        Json::send(['ok' => true, 'contract_signed_at' => $cur->fetchColumn()]);
    }

    // ─── POST /…/:token/cv → multipart upload, same layout as admin path ─
    if ($sub === 'cv' && $method === 'POST') {
        if (empty($_FILES['file'])) Json::fail('file required', 400);
        $f = $_FILES['file'];
        if ($f['error'] !== UPLOAD_ERR_OK) Json::fail('upload failed (code ' . $f['error'] . ')', 400);

        // Mirrors the admin CV upload — uploads/recruitment/candidates/<id> - <name>/CV/CV.<ext>
        $folder = candidatePortalFolderSlug($pdo, $id);
        $dir = __DIR__ . '/../../uploads/recruitment/candidates/' . $folder . '/CV';
        if (!is_dir($dir)) @mkdir($dir, 0775, true);
        $ext = strtolower((string)pathinfo((string)$f['name'], PATHINFO_EXTENSION));
        $fname = 'CV' . ($ext !== '' ? '.' . $ext : '');
        $rel = 'uploads/recruitment/candidates/' . $folder . '/CV/' . $fname;
        $oldCv = (string)($cand['cv_file_path'] ?? '');
        if ($oldCv !== '' && $oldCv !== $rel) {
            $abs = __DIR__ . '/../../' . $oldCv;
            if (is_file($abs)) @unlink($abs);
        }
        if (!move_uploaded_file($f['tmp_name'], $dir . '/' . $fname)) Json::fail('failed to save file', 500);
        $pdo->prepare('UPDATE recruitment_candidates SET cv_file_path = ?, cv_file_size = ?, cv_mime_type = ? WHERE id = ?')
            ->execute([$rel, (int)$f['size'], $f['type'] ?? null, $id]);
        Json::send(['ok' => true, 'file_path' => $rel], 201);
    }

    // ─── POST /…/:token/documents → multipart, one row per doc-type ──
    if ($sub === 'documents' && $method === 'POST') {
        $title       = trim((string)($_POST['title'] ?? ''));
        $docTypeId   = isset($_POST['doc_type_id']) && $_POST['doc_type_id'] !== '' ? (int)$_POST['doc_type_id'] : null;
        $reference   = trim((string)($_POST['reference_number'] ?? '')) ?: null;
        $issuingBody = trim((string)($_POST['issuing_body'] ?? '')) ?: null;
        $issuedAt    = trim((string)($_POST['issued_at']  ?? '')) ?: null;
        $expiresAt   = trim((string)($_POST['expires_at'] ?? '')) ?: null;

        // Look up the doc-type to drive the filename rename + auto title.
        $typeName = null;
        if ($docTypeId) {
            $nm = $pdo->prepare('SELECT name FROM recruitment_doc_types WHERE id = ? AND add_to_onboarding = 1');
            $nm->execute([$docTypeId]);
            $typeName = (string)($nm->fetchColumn() ?: '');
            if ($typeName === '') Json::fail('Document type not in onboarding', 400);
        }

        // ONE-PER-TYPE: drop any existing rows + their files first.
        $existingPaths = [];
        if ($docTypeId) {
            $exist = $pdo->prepare('SELECT file_path FROM recruitment_candidate_documents WHERE candidate_id = ? AND doc_type_id = ?');
            $exist->execute([$id, $docTypeId]);
            foreach ($exist->fetchAll() as $r) {
                if (!empty($r['file_path'])) $existingPaths[] = (string)$r['file_path'];
            }
            $pdo->prepare('DELETE FROM recruitment_candidate_documents WHERE candidate_id = ? AND doc_type_id = ?')
                ->execute([$id, $docTypeId]);
        }

        $rel = null; $size = null; $mime = null;
        if (!empty($_FILES['file'])) {
            $f = $_FILES['file'];
            if ($f['error'] !== UPLOAD_ERR_OK) Json::fail('upload failed (code ' . $f['error'] . ')', 400);
            if ($title === '') $title = $typeName ?: (string)$f['name'];
            $folder = candidatePortalFolderSlug($pdo, $id);
            $group  = candidatePortalGroupSlug($pdo, $docTypeId);
            $dir = __DIR__ . '/../../uploads/recruitment/candidates/' . $folder . '/' . $group;
            if (!is_dir($dir)) @mkdir($dir, 0775, true);
            $ext = strtolower((string)pathinfo((string)$f['name'], PATHINFO_EXTENSION));
            if ($docTypeId && $typeName) {
                $safeBase = preg_replace('/[^A-Za-z0-9._ -]+/', '_', $typeName) ?? 'document';
                $safeBase = rtrim($safeBase, ". \t\n\r\0\x0B");
                if ($safeBase === '') $safeBase = 'document';
                $fname = $safeBase . ($ext !== '' ? '.' . $ext : '');
            } else {
                $safe  = preg_replace('/[^A-Za-z0-9._-]+/', '_', basename((string)$f['name']));
                $fname = time() . '_' . $safe;
            }
            foreach ($existingPaths as $old) {
                $abs = __DIR__ . '/../../' . $old;
                if (is_file($abs)) @unlink($abs);
            }
            if (!move_uploaded_file($f['tmp_name'], $dir . '/' . $fname)) Json::fail('failed to save file', 500);
            $rel  = 'uploads/recruitment/candidates/' . $folder . '/' . $group . '/' . $fname;
            $size = (int)$f['size'];
            $mime = $f['type'] ?? null;
        } else {
            if ($title === '' && $typeName) $title = $typeName;
            if ($title === '') Json::fail('title or doc_type_id required for info-only entries', 400);
        }

        $pdo->prepare(
            'INSERT INTO recruitment_candidate_documents
             (candidate_id, doc_type_id, title, file_path, file_size, mime_type,
              reference_number, issuing_body, issued_at, expires_at, status, uploaded_by)
             VALUES (?,?,?,?,?,?, ?,?,?,?, ?,?)'
        )->execute([
            $id, $docTypeId, $title, $rel, $size, $mime,
            $reference, $issuingBody, $issuedAt, $expiresAt,
            'pending', null,
        ]);
        Json::send(['id' => (int)$pdo->lastInsertId()], 201);
    }

    Json::fail('Not found', 404);
};

/** Candidate folder slug — duplicates the admin route helper because the
 *  API router only loads one route file per request. Same algorithm:
 *  whitelist + control-char trim + safe fallback. */
function candidatePortalFolderSlug(\PDO $pdo, int $candidateId): string {
    $stmt = $pdo->prepare('SELECT first_name, last_name FROM recruitment_candidates WHERE id = ?');
    $stmt->execute([$candidateId]);
    $row = $stmt->fetch() ?: ['first_name' => '', 'last_name' => ''];
    $name = trim((string)$row['first_name'] . ' ' . (string)$row['last_name']);
    $safe = preg_replace('/[^A-Za-z0-9._ -]+/', '_', $name) ?? '';
    $safe = rtrim($safe, ". \t\n\r\0\x0B");
    if ($safe === '') $safe = 'unnamed';
    return $candidateId . ' - ' . $safe;
}

/** Group folder slug — duplicates candidateDocGroupSlug. */
function candidatePortalGroupSlug(\PDO $pdo, ?int $docTypeId): string {
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
