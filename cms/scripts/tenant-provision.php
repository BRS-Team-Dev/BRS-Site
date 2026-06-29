<?php
declare(strict_types=1);

/**
 * Onboard a new tenant in one command.
 *
 *   php cms/scripts/tenant-provision.php \
 *       --slug=acme \
 *       --brand-name="Acme Corp" \
 *       --domain=acme.com \
 *       --admin-email=ceo@acme.com \
 *       [--admin-name="Acme Owner"]   default: derived from email local part
 *       [--temp-password=…]            default: 20-char random
 *
 * What it does (in one transaction):
 *   1. INSERT tenants row (status='active')
 *   2. INSERT tenant_email_domains row → the tenant
 *   3. INSERT admin_users row scoped to the new tenant, with a bcrypt
 *      of the temp password
 *
 * Prints the temp password ONCE to stdout — capture it and hand it to
 * the customer. They log in at /cc/login and change it via the existing
 * change-password endpoint.
 *
 * Run from CLI only. Safe to re-run with a different slug; the UNIQUE
 * constraints on tenants.slug + tenant_email_domains.domain reject
 * collisions.
 *
 * Super-admins are NOT created here — those are added to super_admins
 * directly via SQL in the registry. Tenants own their own admin_users
 * exclusively.
 */

if (PHP_SAPI !== 'cli') { fwrite(STDERR, "CLI only.\n"); exit(1); }

require __DIR__ . '/../api/bootstrap.php';

use BRS\Db;

// ── Parse args ──────────────────────────────────────────────────────
$args = [];
foreach (array_slice($argv, 1) as $a) {
    if (!preg_match('/^--([a-z][a-z0-9-]+)(?:=(.*))?$/', $a, $m)) {
        fwrite(STDERR, "Unknown arg: $a\n"); exit(2);
    }
    $args[$m[1]] = $m[2] ?? true;
}
$slug        = trim((string)($args['slug']         ?? ''));
$brand       = trim((string)($args['brand-name']   ?? ''));
$domain      = strtolower(trim((string)($args['domain']        ?? '')));
$adminEmail  = strtolower(trim((string)($args['admin-email']    ?? '')));
$adminName   = trim((string)($args['admin-name']   ?? ''));
$tempPass    = trim((string)($args['temp-password'] ?? ''));

if ($slug === '' || $brand === '' || $domain === '' || $adminEmail === '') {
    fwrite(STDERR, "Required: --slug, --brand-name, --domain, --admin-email\n");
    exit(2);
}
if (!preg_match('/^[a-z][a-z0-9-]{1,58}$/', $slug)) {
    fwrite(STDERR, "Bad slug — lowercase a-z, 0-9, hyphens; start with a letter; ≤60 chars.\n");
    exit(2);
}
if (!filter_var($adminEmail, FILTER_VALIDATE_EMAIL)) {
    fwrite(STDERR, "Bad admin email.\n"); exit(2);
}
$emailDomain = substr($adminEmail, strrpos($adminEmail, '@') + 1);
if ($emailDomain !== $domain) {
    fwrite(STDERR, "Admin email domain ($emailDomain) must match --domain ($domain).\n");
    exit(2);
}
if ($adminName === '') {
    // Sensible default: capitalised local part
    $adminName = ucfirst(substr($adminEmail, 0, strrpos($adminEmail, '@')));
}
if ($tempPass === '') {
    // 15 random bytes → ~20 char URL-safe base64
    $tempPass = rtrim(strtr(base64_encode(random_bytes(15)), '+/', '-_'), '=');
}
if (strlen($tempPass) < 8) {
    fwrite(STDERR, "Temp password must be ≥8 chars.\n"); exit(2);
}

$pdo = Db::pdo();
$pdo->beginTransaction();
try {
    // 1) Tenant row
    $ins = $pdo->prepare(
        'INSERT INTO tenants (slug, brand_name, status, created_at)
         VALUES (?, ?, "active", NOW())'
    );
    $ins->execute([$slug, $brand]);
    $tenantId = (int)$pdo->lastInsertId();

    // 2) Domain → tenant mapping
    $pdo->prepare(
        'INSERT INTO tenant_email_domains (domain, tenant_id) VALUES (?, ?)'
    )->execute([$domain, $tenantId]);

    // 3) First admin user for the tenant
    $hash = password_hash($tempPass, PASSWORD_BCRYPT);
    $pdo->prepare(
        'INSERT INTO admin_users (tenant_id, email, password_hash, display_name, role, is_active)
         VALUES (?, ?, ?, ?, "admin", 1)'
    )->execute([$tenantId, $adminEmail, $hash, $adminName]);
    $adminId = (int)$pdo->lastInsertId();

    $pdo->commit();
} catch (\Throwable $e) {
    $pdo->rollBack();
    fwrite(STDERR, "FAILED: " . $e->getMessage() . "\n");
    exit(3);
}

// Best-effort APCu cache invalidation so the new tenant is reachable
// immediately on the same FPM worker pool (otherwise next 1h cycle).
if (function_exists('apcu_delete')) {
    apcu_delete('brs.tenant.domains');
    apcu_delete('brs.tenant.killset');
}

// ── Summary ─────────────────────────────────────────────────────────
echo "
─── Tenant provisioned ──────────────────────────────────────────────
  Tenant ID     : $tenantId
  Slug          : $slug
  Brand name    : $brand
  Email domain  : $domain  → tenant $tenantId

  First admin
    Email       : $adminEmail
    Display     : $adminName
    Role        : admin
    Admin ID    : $adminId

  Temp password : $tempPass
                  (give this to the admin — they should log in then
                  change it via /me → password)

  Login URL     : (base)/cc/login
─────────────────────────────────────────────────────────────────────
";
