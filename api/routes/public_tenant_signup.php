<?php
declare(strict_types=1);

use BRS\Auth;
use BRS\Db;
use BRS\Json;
use BRS\Tenant;
use BRS\Tenants;

/*
 * POST /api/public/tenant-signup  (multipart/form-data)
 *
 * One-shot, no-auth tenant onboarding from the /software-solutions
 * marketing page. Creates the registry row + email-domain mapping +
 * first admin in a single transaction and returns a signed JWT so the
 * caller can drop the user straight into /cc/admin/dashboard without a
 * separate login round-trip.
 *
 * Fields (multipart, all required unless noted):
 *   company_name      — display name
 *   company_url       — optional, https URL
 *   contact_email     — first admin's email; its domain becomes the
 *                       tenant_email_domain row
 *   contact_phone     — captured for sales contact
 *   company_size      — one of the migration-110 ENUM values
 *   color_theme       — slug from the 6-panel theme picker
 *   admin_password    — ≥8 chars; bcrypted into admin_users
 *   admin_name        — optional; derived from email local part otherwise
 *   logo              — optional file upload (png/jpg/svg, ≤2MB)
 *
 * Returns 201 + { token, user, tenant }  → frontend redirects to
 *   `${base}/cc/login?token=…` (or directly stores the token and
 *   navigates to /cc/admin/dashboard).
 *
 * Returns 409 if the email domain is already mapped to another tenant
 * — the form should redirect to /cc/login with a friendly hint.
 */

return function (string $method, array $segs): void {
    if ($method !== 'POST') Json::fail('Method not allowed', 405);

    // Parse fields — multipart for the logo upload.
    $field = function (string $k): string {
        return trim((string)($_POST[$k] ?? ''));
    };

    $companyName   = $field('company_name');
    $companyUrl    = $field('company_url');
    $contactEmail  = strtolower($field('contact_email'));
    $contactPhone  = $field('contact_phone');
    $companySize   = $field('company_size');
    $colorTheme    = $field('color_theme') ?: 'midnight-gold';
    $adminPassword = $field('admin_password');
    $adminName     = $field('admin_name');

    // ── Validation ─────────────────────────────────────────────────
    if ($companyName === '')   Json::fail('Company name is required', 400);
    if ($contactEmail === '')  Json::fail('Contact email is required', 400);
    if (!filter_var($contactEmail, FILTER_VALIDATE_EMAIL)) Json::fail('Invalid email', 400);
    if (strlen($adminPassword) < 8) Json::fail('Password must be at least 8 characters', 400);
    $allowedSizes = ['1-5','5-10','10-25','25-50','50-100','100-500','1000+'];
    if ($companySize !== '' && !in_array($companySize, $allowedSizes, true)) {
        Json::fail('Invalid company size', 400);
    }
    if ($companyUrl !== '' && !filter_var($companyUrl, FILTER_VALIDATE_URL)) {
        Json::fail('Invalid company URL', 400);
    }

    $emailDomain = substr($contactEmail, strrpos($contactEmail, '@') + 1);
    if ($emailDomain === '' || strlen($emailDomain) > 190) Json::fail('Invalid email domain', 400);

    // Disallow generic free-mail domains — every tenant must live on a
    // domain it controls so super-admins can trust the email-domain
    // routing model (otherwise gmail.com would route every Gmail user
    // to one tenant).
    $generic = ['gmail.com','googlemail.com','yahoo.com','yahoo.co.uk',
                'outlook.com','hotmail.com','live.com','icloud.com',
                'aol.com','protonmail.com','proton.me','msn.com'];
    if (in_array($emailDomain, $generic, true)) {
        Json::fail('Please use your company email address, not a personal one (' . $emailDomain . ')', 400);
    }

    // ── Slug — from company name, deduped against existing tenants ──
    $slug = preg_replace('/[^a-z0-9-]+/', '-', strtolower($companyName));
    $slug = trim((string)preg_replace('/-+/', '-', (string)$slug), '-');
    if ($slug === '' || strlen($slug) < 2) $slug = 'tenant';
    if (strlen($slug) > 50) $slug = substr($slug, 0, 50);

    // Use Db::pdo() throughout — the tenant context is genuinely
    // pre-creation here, so the wrapper has nothing to scope.
    // @global-scope: registry table queries during tenant provisioning
    $pdo = Db::pdo();

    // Conflict check — refuse before doing any DB work so the user gets
    // a clean message instead of an FK / unique-index error.
    // @global-scope: tenant_email_domains is a registry table
    $check = $pdo->prepare('SELECT tenant_id FROM tenant_email_domains WHERE domain = ?');
    $check->execute([$emailDomain]);
    if ($check->fetchColumn() !== false) {
        Json::fail(
            "An account already exists for $emailDomain — log in instead, or contact your admin to invite you.",
            409
        );
    }

    // Slug dedup — append -2, -3 until unique.
    // @global-scope: tenants registry
    $slugCheck = $pdo->prepare('SELECT 1 FROM tenants WHERE slug = ?');
    $finalSlug = $slug;
    $n = 2;
    while (true) {
        $slugCheck->execute([$finalSlug]);
        if ($slugCheck->fetchColumn() === false) break;
        $finalSlug = $slug . '-' . $n++;
        if ($n > 100) Json::fail('Could not derive a unique slug', 500);
    }

    if ($adminName === '') {
        // Derive a sensible display name from the email local part.
        $adminName = ucfirst(substr($contactEmail, 0, strrpos($contactEmail, '@')));
    }

    // Generate a public API key the same way tenant-provision.php does.
    $publicApiKey = bin2hex(random_bytes(32));

    // Handle optional logo upload BEFORE the DB transaction so a bad
    // upload doesn't leave a half-provisioned tenant.
    $logoRelPath = null;
    $pendingUpload = null;
    if (!empty($_FILES['logo']) && ($_FILES['logo']['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_OK) {
        $size = (int)$_FILES['logo']['size'];
        if ($size > 2 * 1024 * 1024) Json::fail('Logo must be under 2MB', 400);
        $allowedMimes = ['image/png','image/jpeg','image/svg+xml','image/webp'];
        $mime = mime_content_type($_FILES['logo']['tmp_name']) ?: '';
        if (!in_array($mime, $allowedMimes, true)) Json::fail('Logo must be PNG, JPG, SVG, or WEBP', 400);
        $ext = match ($mime) {
            'image/png'      => 'png',
            'image/jpeg'     => 'jpg',
            'image/svg+xml'  => 'svg',
            'image/webp'     => 'webp',
        };
        $pendingUpload = [
            'tmp'  => $_FILES['logo']['tmp_name'],
            'ext'  => $ext,
            'size' => $size,
            'mime' => $mime,
        ];
    }

    // ── Provision in a transaction ─────────────────────────────────
    $pdo->beginTransaction();
    try {
        // 1) Tenant row
        // @global-scope: registry write
        $ins = $pdo->prepare(
            'INSERT INTO tenants
               (slug, brand_name, company_url, contact_phone, company_size,
                color_theme, status, public_api_key, created_at)
             VALUES (?, ?, ?, ?, ?, ?, "active", ?, NOW())'
        );
        $ins->execute([
            $finalSlug,
            $companyName,
            $companyUrl ?: null,
            $contactPhone ?: null,
            $companySize ?: null,
            $colorTheme,
            $publicApiKey,
        ]);
        $tenantId = (int)$pdo->lastInsertId();

        // 2) Move the logo upload into the tenant's storage dir now that
        //    we know the tenant id. If the move fails we abort the txn.
        if ($pendingUpload !== null) {
            $cfg = $GLOBALS['BRS_CONFIG'];
            $dir = $cfg['storage_dir'] . "/uploads/tenants/$tenantId";
            if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
                throw new \RuntimeException('Could not create tenant upload dir');
            }
            $fname = "logo.{$pendingUpload['ext']}";
            $dest = "$dir/$fname";
            if (!move_uploaded_file($pendingUpload['tmp'], $dest)) {
                throw new \RuntimeException('Could not save uploaded logo');
            }
            $logoRelPath = "uploads/tenants/$tenantId/$fname";
            $pdo->prepare('UPDATE tenants SET logo_path = ? WHERE id = ?')
                ->execute([$logoRelPath, $tenantId]);
        }

        // 3) Email-domain mapping
        // @global-scope: registry write
        $pdo->prepare(
            'INSERT INTO tenant_email_domains (domain, tenant_id) VALUES (?, ?)'
        )->execute([$emailDomain, $tenantId]);

        // 4) First admin user, scoped to the new tenant.
        // @global-scope: admin_users is tenant-scoped but the row IS the
        // tenant's first row — pre-Tenant-context provisioning insert.
        $pdo->prepare(
            'INSERT INTO admin_users (tenant_id, email, password_hash, display_name, role, is_active)
             VALUES (?, ?, ?, ?, "admin", 1)'
        )->execute([
            $tenantId,
            $contactEmail,
            password_hash($adminPassword, PASSWORD_BCRYPT),
            $adminName,
        ]);
        $adminId = (int)$pdo->lastInsertId();

        $pdo->commit();
    } catch (\Throwable $e) {
        $pdo->rollBack();
        // Clean up any partial logo file
        if ($logoRelPath !== null) {
            $cfg = $GLOBALS['BRS_CONFIG'];
            $abs = $cfg['storage_dir'] . '/' . $logoRelPath;
            if (is_file($abs)) @unlink($abs);
        }
        error_log('[tenant-signup] ' . $e->getMessage());
        Json::fail('Account creation failed — please try again', 500);
    }

    // Invalidate APCu caches so the new tenant resolves on the very
    // next request anywhere in the cluster.
    if (function_exists('apcu_delete')) {
        apcu_delete('brs.tenant.domains');
        apcu_delete('brs.tenant.apikeys');
    }

    // Issue a JWT so the caller can redirect the new admin straight
    // into the dashboard — no separate login round-trip needed.
    $token = Auth::issueToken($adminId, $contactEmail, $tenantId, false);

    Json::send([
        'ok'      => true,
        'token'   => $token,
        'user'    => [
            'id'           => $adminId,
            'email'        => $contactEmail,
            'display_name' => $adminName,
        ],
        'tenant'  => [
            'id'         => $tenantId,
            'slug'       => $finalSlug,
            'brand_name' => $companyName,
            'logo_path'  => $logoRelPath,
        ],
    ], 201);
};
