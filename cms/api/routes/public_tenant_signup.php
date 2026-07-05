<?php
declare(strict_types=1);

use BRS\Auth;
use BRS\Db;
use BRS\Json;
use BRS\StripeClient;
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
            "An account already exists for $emailDomain. Log in instead, or contact your admin to invite you.",
            409
        );
    }

    // ── Anti-abuse: prior signup on this email domain? ─────────
    // Even if the tenant_email_domains row was removed (deleted tenant),
    // trial_abuse_signals is append-only. Reappearance of the same domain
    // triggers "card required" mode below.
    // @global-scope: cross-tenant lookup by design — the anti-abuse table
    // catches domains reused across ANY tenant.
    $domainSeen = $pdo->prepare(
        'SELECT 1 FROM trial_abuse_signals
          WHERE signal_type = "email_domain" AND signal_value = ? LIMIT 1'
    );
    $domainSeen->execute([$emailDomain]);
    $domainFlagged = $domainSeen->fetchColumn() !== false;

    // ── Anti-abuse: card check + trial-requires-card enforcement ─
    // `payment_method_id` (Stripe pm_...) is optional in general but
    // REQUIRED when:
    //   - env `TRIAL_REQUIRES_CARD=true` is set globally, OR
    //   - the email domain is flagged (previous trial from same domain)
    $paymentMethodId = trim((string)($_POST['payment_method_id'] ?? ''));
    $requireCard = $domainFlagged
        || filter_var($GLOBALS['BRS_CONFIG']['stripe']['trial_requires_card'] ?? false, FILTER_VALIDATE_BOOLEAN);

    if ($requireCard && $paymentMethodId === '') {
        Json::fail(
            $domainFlagged
                ? 'This email domain was used for a previous trial. Please add a card to continue.'
                : 'A payment method is required to start your trial. Your card will not be charged.',
            402
        );
    }

    // If a payment_method_id is present AND Stripe is configured,
    // verify it isn't a fingerprint we've already seen on another
    // tenant. Cheap way to block trial farming with re-used cards.
    $cardFingerprint = null;
    if ($paymentMethodId !== '' && StripeClient::isConfigured()) {
        try {
            $sdk = StripeClient::client();
            $pm = $sdk->paymentMethods->retrieve($paymentMethodId, []);
            $cardFingerprint = $pm->card->fingerprint ?? null;
            if ($cardFingerprint && StripeClient::isCardReusedAcrossTenants($cardFingerprint)) {
                Json::fail(
                    'This card was used to start a previous trial. Please choose a paid plan or contact sales.',
                    402
                );
            }
        } catch (\Throwable $e) {
            error_log('[signup] card check failed: ' . $e->getMessage());
            Json::fail('Could not verify payment method. Please try again.', 400);
        }
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

        // 5) Seed the settings kv table so Settings > General + Settings >
        //    Invoices are pre-populated with what the tenant just typed
        //    on the signup form. Without this, the new admin lands in
        //    Settings and sees empty inputs even though they clearly
        //    provided the same info a minute ago. Keys mirror what the
        //    two settings tabs actually bind to.
        // @global-scope: settings is tenant-scoped but this IS the
        // tenant's first row — pre-Tenant-context provisioning insert.
        $seedRows = [
            ['brand_name',                $companyName],
            ['org_website',               $companyUrl ?: null],
            ['org_contact_email',         $contactEmail],
            ['invoice.business_name',     $companyName],
            ['invoice.business_email',    $contactEmail],
            ['invoice.business_phone',    $contactPhone ?: null],
            ['invoice.business_website',  $companyUrl ?: null],
            ['invoice.signature_name',    $adminName],
            ['invoice.tax_label',         'Tax'],
            ['invoice.show_bank_details', '1'],
        ];
        if ($logoRelPath !== null) {
            // brand_logo_url is a root-relative path here so the
            // frontend's <img [src]="s.brand_logo_url"> renders it
            // without needing a base URL rewrite.
            $seedRows[] = ['brand_logo_url', '/cms/' . $logoRelPath];
            $seedRows[] = ['invoice.logo_url', '/cms/' . $logoRelPath];
        }
        $seedIns = $pdo->prepare(
            'INSERT INTO settings (tenant_id, k, v) VALUES (?, ?, ?)'
        );
        foreach ($seedRows as [$k, $v]) {
            if ($v === null || $v === '') continue;
            $seedIns->execute([$tenantId, $k, $v]);
        }

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

    // ── Post-signup anti-abuse writes ──────────────────────────
    // Log the email domain unconditionally so any future signup on
    // this domain (even after tenant deletion) triggers card-required
    // mode. Log the card fingerprint (if we captured one) so re-use
    // on a different signup is blocked upfront.
    try {
        $pdo->prepare(
            'INSERT INTO trial_abuse_signals (tenant_id, signal_type, signal_value)
             VALUES (?, "email_domain", ?)'
        )->execute([$tenantId, $emailDomain]);

        $clientIp = $_SERVER['HTTP_CF_CONNECTING_IP']
            ?? $_SERVER['HTTP_X_FORWARDED_FOR']
            ?? $_SERVER['REMOTE_ADDR']
            ?? '';
        // Take just the first hop in case of X-Forwarded-For chain.
        $clientIp = trim(explode(',', $clientIp)[0]);
        if ($clientIp !== '' && strlen($clientIp) <= 45) {
            $pdo->prepare(
                'INSERT INTO trial_abuse_signals (tenant_id, signal_type, signal_value)
                 VALUES (?, "ip_address", ?)'
            )->execute([$tenantId, $clientIp]);
        }
    } catch (\Throwable $e) {
        error_log('[signup] trial_abuse_signals insert failed: ' . $e->getMessage());
    }

    // Attach the payment method to a new Stripe customer + save
    // locally. Non-fatal: signup still succeeds if Stripe is
    // temporarily unreachable; the tenant just won't have a card
    // saved until they add one from Settings > Billing.
    if ($paymentMethodId !== '' && StripeClient::isConfigured()) {
        try {
            $sdk = StripeClient::client();
            $customerId = StripeClient::getOrCreateCustomer($tenantId);
            $sdk->paymentMethods->attach($paymentMethodId, ['customer' => $customerId]);
            $sdk->customers->update($customerId, [
                'invoice_settings' => ['default_payment_method' => $paymentMethodId],
            ]);
            $pm = $sdk->paymentMethods->retrieve($paymentMethodId, []);
            StripeClient::upsertPaymentMethod($tenantId, $pm);
            $pdo->prepare('UPDATE tenants SET stripe_default_pm_id = ? WHERE id = ?')
                ->execute([$paymentMethodId, $tenantId]);
        } catch (\Throwable $e) {
            error_log('[signup] Stripe PM attach failed: ' . $e->getMessage());
        }
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
            // Include role explicitly so the frontend's SideNavFooter
            // shows the Settings link on first load — without this
            // field the check `user.role === 'admin'` is undefined and
            // the new tenant can't reach their own configuration.
            'role'         => 'admin',
        ],
        'tenant'  => [
            'id'          => $tenantId,
            'slug'        => $finalSlug,
            'brand_name'  => $companyName,
            'color_theme' => $colorTheme,
            'logo_path'   => $logoRelPath,
        ],
    ], 201);
};
