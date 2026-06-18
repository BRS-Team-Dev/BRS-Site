<?php
declare(strict_types=1);

use BRS\Db;
use BRS\Json;

/*
 * Public candidate application from the standalone Built Right Recruitment
 * marketing site (recruitment/). No auth — it's a public lead form.
 *
 *   POST /api/public-recruitment-apply   (multipart/form-data)
 *     name   (required)   — split into first/last
 *     email              — validated if present
 *     phone
 *     role               — current role → recruitment_candidates.role
 *     cv     (file)       — pdf/doc/docx, ≤12MB, saved like the admin CV upload
 *     company (honeypot)  — must stay empty; bots fill it, humans don't
 *
 * Creates a recruitment_candidates row (source='Website', status='new') so the
 * applicant shows up in the CMS Recruitment → Candidates list, and replays the
 * candidate-audience contract templates as pending docs.
 */
return function (string $method, array $segs): void {
    if ($method !== 'POST') Json::fail('Method not allowed', 405);
    $pdo = Db::pdo();

    // Honeypot: silently accept-and-drop obvious bot submissions.
    if (trim((string)($_POST['company'] ?? '')) !== '') { Json::send(['ok' => true]); return; }

    $name  = trim((string)($_POST['name']  ?? ''));
    $email = trim((string)($_POST['email'] ?? ''));
    $phone = trim((string)($_POST['phone'] ?? ''));
    $role  = trim((string)($_POST['role']  ?? ''));
    if ($name === '') Json::fail('Name is required', 400);
    if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) Json::fail('Please enter a valid email address', 400);

    // Single "name" field → first / last.
    $parts = preg_split('/\s+/', $name, 2) ?: [$name];
    $first = $parts[0];
    $last  = $parts[1] ?? '';

    $token = bin2hex(random_bytes(16));
    $ins = $pdo->prepare(
        'INSERT INTO recruitment_candidates
         (first_name, last_name, email, phone, role, source, status, notes, onboarding_token)
         VALUES (?,?,?,?,?,?,?,?,?)'
    );
    $ins->execute([
        $first, $last,
        $email !== '' ? $email : null,
        $phone !== '' ? $phone : null,
        $role  !== '' ? $role  : null,
        'Website', 'new', 'Applied via website CV form.', $token,
    ]);
    $id = (int)$pdo->lastInsertId();

    // Replay candidate-audience contract templates as pending docs (076/093).
    if (class_exists('\\BRS\\Contracts')) {
        \BRS\Contracts::fanOutToNewEntity($pdo, 'candidate', $id);
    }

    // Optional CV upload — mirrors the admin path: uploads/recruitment/
    // candidates/<id> - <name>/CV/CV.<ext>.
    if (!empty($_FILES['cv']) && (int)$_FILES['cv']['error'] === UPLOAD_ERR_OK) {
        $f   = $_FILES['cv'];
        $ext = strtolower((string)pathinfo((string)$f['name'], PATHINFO_EXTENSION));
        if (in_array($ext, ['pdf', 'doc', 'docx'], true) && (int)$f['size'] <= 12 * 1024 * 1024) {
            $safe = preg_replace('/[^A-Za-z0-9._ -]+/', '_', trim($first . ' ' . $last)) ?? '';
            $safe = rtrim($safe, ". \t\n\r\0\x0B");
            if ($safe === '') $safe = 'unnamed';
            $folder = $id . ' - ' . $safe;
            $dir = __DIR__ . '/../../uploads/recruitment/candidates/' . $folder . '/CV';
            if (!is_dir($dir)) @mkdir($dir, 0775, true);
            $fname = 'CV.' . $ext;
            $rel   = 'uploads/recruitment/candidates/' . $folder . '/CV/' . $fname;
            if (move_uploaded_file($f['tmp_name'], $dir . '/' . $fname)) {
                $pdo->prepare('UPDATE recruitment_candidates SET cv_file_path=?, cv_file_size=?, cv_mime_type=? WHERE id=?')
                    ->execute([$rel, (int)$f['size'], $f['type'] ?? null, $id]);
            }
        }
    }

    Json::send(['ok' => true, 'id' => $id], 201);
};
