<?php
declare(strict_types=1);

use BRS\Db;
use BRS\Json;

/**
 * Public job postings — token-less, anonymous read access for the
 * `/jobs` and `/jobs/:slug` views on the frontend.
 *
 *   GET /api/public/jobs            → list all status='open' postings
 *   GET /api/public/jobs/:slug      → single open posting
 *
 * No application submission yet — that ships with the candidate-apply flow.
 */

use BRS\Tenant;

return function (string $method, array $segs): void {
    // Public routes have no JWT — bootstrap the tenant context.
    // Hardcoded to BRS (tenant 1) until per-tenant public routing
    // lands in Phase 5 (subdomain detection / per-tenant API key).
    Tenant::setForPublic();
    $pdo = Db::tpdo();

    // Public-safe column whitelist — never leak hiring_manager_id, internal status
    // history, or any joined manager identity here.
    $cols = '
        id, title, slug, department, location, employment_type,
        salary_min, salary_max, salary_currency,
        description, responsibilities, benefits,
        posted_at
    ';

    // GET /api/public/jobs — list all open roles, freshest posting first.
    if ($method === 'GET' && !isset($segs[2])) {
        $stmt = $pdo->query("SELECT $cols FROM hr_jobs WHERE status = 'open'
                             ORDER BY posted_at IS NULL, posted_at DESC, id DESC");
        Json::send(['jobs' => $stmt->fetchAll()]);
    }

    $slug = (string)($segs[2] ?? '');
    if ($slug === '') Json::fail('slug required', 400);
    $action = (string)($segs[3] ?? '');

    // GET /api/public/jobs/:slug — single open posting.
    if ($method === 'GET' && $action === '') {
        $stmt = $pdo->prepare("SELECT $cols FROM hr_jobs WHERE slug = ? AND status = 'open' LIMIT 1");
        $stmt->execute([$slug]);
        $job = $stmt->fetch();
        if (!$job) Json::fail('Job not found', 404);
        Json::send(['job' => $job]);
    }

    // POST /api/public/jobs/:slug/apply — anonymous application submission.
    // Multipart so candidates can attach a CV. Upserts hr_candidates by email
    // (so reapplying / applying to multiple roles reuses one candidate row)
    // and inserts an hr_applications row in stage='applied'.
    if ($method === 'POST' && $action === 'apply') {
        // Resolve the job and verify it's still open (don't accept apps on draft/closed roles).
        $row = $pdo->prepare("SELECT id, title FROM hr_jobs WHERE slug = ? AND status = 'open' LIMIT 1");
        $row->execute([$slug]);
        $job = $row->fetch();
        if (!$job) Json::fail('Job not found or no longer accepting applications', 404);

        $first   = trim((string)($_POST['first_name'] ?? ''));
        $last    = trim((string)($_POST['last_name']  ?? ''));
        $email   = trim((string)($_POST['email']      ?? ''));
        $phone   = trim((string)($_POST['phone']      ?? '')) ?: null;
        $linked  = trim((string)($_POST['linkedin_url'] ?? '')) ?: null;
        $source  = trim((string)($_POST['source']     ?? 'public_apply'));
        $notes   = trim((string)($_POST['notes']      ?? '')) ?: null;
        if ($first === '' || $last === '' || $email === '') {
            Json::fail('first_name, last_name and email are required', 400);
        }
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) Json::fail('Invalid email', 400);

        // Optional CV upload — saved to uploads/hr/cvs/.
        $cvPath = null;
        if (!empty($_FILES['cv']) && is_uploaded_file($_FILES['cv']['tmp_name'] ?? '')) {
            $f = $_FILES['cv'];
            if ($f['error'] !== UPLOAD_ERR_OK) Json::fail('CV upload failed (code ' . $f['error'] . ')', 400);
            $dir = __DIR__ . '/../../uploads/hr/cvs';
            if (!is_dir($dir)) @mkdir($dir, 0775, true);
            $safe = preg_replace('/[^A-Za-z0-9._-]+/', '_', basename($f['name']));
            $name = time() . '_' . bin2hex(random_bytes(3)) . '_' . $safe;
            $dest = $dir . '/' . $name;
            if (!move_uploaded_file($f['tmp_name'], $dest)) Json::fail('Failed to save CV', 500);
            $cvPath = 'uploads/hr/cvs/' . $name;
        }

        // Upsert candidate by email.
        $look = $pdo->prepare('SELECT id FROM hr_candidates WHERE email = ? LIMIT 1');
        $look->execute([$email]);
        $cid = (int)($look->fetchColumn() ?: 0);
        if ($cid === 0) {
            $ins = $pdo->prepare('INSERT INTO hr_candidates
                (first_name, last_name, email, phone, cv_path, linkedin_url, source, notes)
                VALUES (?,?,?,?,?,?,?,?)');
            $ins->execute([$first, $last, $email, $phone, $cvPath, $linked, $source, $notes]);
            $cid = (int)$pdo->lastInsertId();
        } else {
            // Refresh known fields without overwriting non-empty values with empty input.
            $pdo->prepare('UPDATE hr_candidates SET
                first_name = ?, last_name = ?,
                phone        = COALESCE(?, phone),
                cv_path      = COALESCE(?, cv_path),
                linkedin_url = COALESCE(?, linkedin_url)
                WHERE id = ?')
                ->execute([$first, $last, $phone, $cvPath, $linked, $cid]);
        }

        // Block exact duplicates (same job + candidate, still active).
        $dup = $pdo->prepare("SELECT id FROM hr_applications
                              WHERE job_id = ? AND candidate_id = ? AND stage NOT IN ('rejected') LIMIT 1");
        $dup->execute([(int)$job['id'], $cid]);
        if ($dup->fetchColumn()) {
            Json::send(['ok' => true, 'duplicate' => true, 'message' => "You've already applied to this role."]);
        }

        $appIns = $pdo->prepare("INSERT INTO hr_applications
            (job_id, candidate_id, stage, recruiter_notes, applied_at)
            VALUES (?,?, 'applied', ?, NOW())");
        $appIns->execute([(int)$job['id'], $cid, $notes]);

        Json::send(['ok' => true, 'application_id' => (int)$pdo->lastInsertId()]);
    }

    Json::fail('Not found', 404);
};
