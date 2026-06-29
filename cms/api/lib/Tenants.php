<?php
declare(strict_types=1);

namespace BRS;

/**
 * Registry access layer for the tenant-per-row multi-tenant model.
 *
 * Hot path on every authenticated request:
 *
 *   1. Read tenant.killset from APCu   (~10μs — RAM)
 *   2. If current tenant ∈ killset      → 403, kick to login
 *   3. Read tenant.row.<id> from APCu  (~10μs — RAM)
 *      - cache miss → one master-DB SELECT, store, set 1h TTL
 *
 * Master-DB lookups happen at most once per tenant per APCu cache window
 * per PHP-FPM worker. Suspension is propagated INSTANTLY by writing to
 * the killset key in {@see self::suspendTenant()}; on the next request
 * across any worker, the killset is in APCu and the suspended tenant is
 * rejected without ever connecting to its data.
 *
 * If APCu is disabled on the host, every method falls back to direct
 * registry queries — slower but correct. Hostinger's PHP 8.x stack has
 * APCu on by default so the slow path is mostly a CI / first-boot thing.
 */
final class Tenants
{
    public const ROW_TTL_SECONDS    = 3600;   // 1 hour
    public const SUPER_TTL_SECONDS  = 3600;   // 1 hour

    private const CACHE_KEY_ROW     = 'brs.tenant.row.';
    private const CACHE_KEY_KILLSET = 'brs.tenant.killset';
    private const CACHE_KEY_SUPER   = 'brs.super.admins';
    private const CACHE_KEY_DOMAINS = 'brs.tenant.domains';

    /** Resolve an email's domain to a tenant_id, or null if no match.
     *  Used at login. Hits APCu first, falls through to a single registry
     *  query on miss (with a 1h cache TTL so login is sub-millisecond on
     *  warm workers). */
    public static function resolveByEmail(string $email): ?int
    {
        $at = strrpos($email, '@');
        if ($at === false || $at === strlen($email) - 1) return null;
        $domain = strtolower(substr($email, $at + 1));

        $domains = self::loadDomainMap();
        return $domains[$domain] ?? null;
    }

    /** Returns the full tenant row (slug, brand_name, status, …) for a
     *  tenant id, or null if not found. Honours soft-deleted tenants
     *  (status='deleted' rows still load — caller decides whether to
     *  accept them; normal auth refuses). */
    public static function get(int $tenantId): ?array
    {
        $key = self::CACHE_KEY_ROW . $tenantId;
        if (function_exists('apcu_fetch')) {
            $hit = apcu_fetch($key, $ok);
            if ($ok && is_array($hit)) return $hit;
        }
        $stmt = Db::pdo()->prepare('SELECT * FROM tenants WHERE id = ? LIMIT 1');
        $stmt->execute([$tenantId]);
        $row = $stmt->fetch();
        if (!$row) return null;
        if (function_exists('apcu_store')) {
            apcu_store($key, $row, self::ROW_TTL_SECONDS);
        }
        return $row;
    }

    /** True iff the tenant is currently suspended (status='suspended' or
     *  'deleted'). Checked on every authenticated request before any
     *  tenant data is touched. */
    public static function isKilled(int $tenantId): bool
    {
        $set = self::killset();
        return isset($set[$tenantId]);
    }

    /** Returns the current killset — an associative array of suspended
     *  tenant ids keyed for O(1) membership tests. APCu-first, falls
     *  through to a single registry query on miss with NO TTL — the set
     *  is invalidated explicitly by {@see self::suspendTenant()} /
     *  {@see self::activateTenant()}. */
    public static function killset(): array
    {
        if (function_exists('apcu_fetch')) {
            $hit = apcu_fetch(self::CACHE_KEY_KILLSET, $ok);
            if ($ok && is_array($hit)) return $hit;
        }
        $rows = Db::pdo()->query(
            "SELECT id FROM tenants WHERE status IN ('suspended', 'deleted')"
        )->fetchAll();
        $set = [];
        foreach ($rows as $r) { $set[(int)$r['id']] = true; }
        if (function_exists('apcu_store')) {
            // No TTL — the killset lives until an admin mutates a tenant
            // status, at which point we explicitly refresh it.
            apcu_store(self::CACHE_KEY_KILLSET, $set);
        }
        return $set;
    }

    /** Set a tenant to suspended state. Immediately refreshes the
     *  killset so the next request across any FPM worker sees the
     *  suspension without a master-DB hit. */
    public static function suspendTenant(int $tenantId): void
    {
        Db::pdo()->prepare(
            "UPDATE tenants SET status='suspended' WHERE id = ? AND status <> 'deleted'"
        )->execute([$tenantId]);
        self::invalidate($tenantId);
    }

    /** Reverse of suspendTenant — un-kills + refreshes caches. Does not
     *  touch soft-deleted tenants. */
    public static function activateTenant(int $tenantId): void
    {
        Db::pdo()->prepare(
            "UPDATE tenants SET status='active' WHERE id = ? AND status = 'suspended'"
        )->execute([$tenantId]);
        self::invalidate($tenantId);
    }

    /** Mark a tenant as soft-deleted. Killset includes it; status row
     *  retained so audit / restoration stays possible. */
    public static function softDeleteTenant(int $tenantId): void
    {
        Db::pdo()->prepare(
            "UPDATE tenants SET status='deleted', deleted_at = NOW() WHERE id = ?"
        )->execute([$tenantId]);
        self::invalidate($tenantId);
    }

    /** True iff the given email belongs to a registered super-admin.
     *  Super-admins see the tenant-switcher UI + can impersonate any
     *  tenant. APCu-cached for 1h; explicitly invalidated by
     *  {@see self::flushSuperAdmins()} on registry mutations. */
    public static function isSuperAdmin(string $email): bool
    {
        $set = self::loadSuperAdmins();
        return isset($set[strtolower($email)]);
    }

    /** Flush ALL APCu caches the registry maintains. Useful on tenant
     *  provisioning / domain change / super-admin add/remove. */
    public static function flushAll(): void
    {
        if (!function_exists('apcu_delete')) return;
        apcu_delete(self::CACHE_KEY_KILLSET);
        apcu_delete(self::CACHE_KEY_SUPER);
        apcu_delete(self::CACHE_KEY_DOMAINS);
        // Tenant row keys are not enumerable from APCu without iterating;
        // a 1h TTL makes that acceptable in practice.
    }

    public static function flushSuperAdmins(): void
    {
        if (function_exists('apcu_delete')) apcu_delete(self::CACHE_KEY_SUPER);
    }

    public static function flushDomains(): void
    {
        if (function_exists('apcu_delete')) apcu_delete(self::CACHE_KEY_DOMAINS);
    }

    // ──────────────────────────────────────────────────────────────────
    // Internals
    // ──────────────────────────────────────────────────────────────────

    private static function invalidate(int $tenantId): void
    {
        if (function_exists('apcu_delete')) {
            apcu_delete(self::CACHE_KEY_ROW . $tenantId);
            apcu_delete(self::CACHE_KEY_KILLSET);
        }
    }

    /** Email domain → tenant_id. Cached 1h in APCu; falls back to one
     *  query on miss. The whole map is loaded at once because it's tiny
     *  (≤ a few hundred rows even with 100+ tenants). */
    private static function loadDomainMap(): array
    {
        if (function_exists('apcu_fetch')) {
            $hit = apcu_fetch(self::CACHE_KEY_DOMAINS, $ok);
            if ($ok && is_array($hit)) return $hit;
        }
        $rows = Db::pdo()->query(
            'SELECT domain, tenant_id FROM tenant_email_domains'
        )->fetchAll();
        $map = [];
        foreach ($rows as $r) { $map[strtolower($r['domain'])] = (int)$r['tenant_id']; }
        if (function_exists('apcu_store')) {
            apcu_store(self::CACHE_KEY_DOMAINS, $map, self::ROW_TTL_SECONDS);
        }
        return $map;
    }

    /** Email → 1 lookup. Loaded as a set so isSuperAdmin() is O(1). */
    private static function loadSuperAdmins(): array
    {
        if (function_exists('apcu_fetch')) {
            $hit = apcu_fetch(self::CACHE_KEY_SUPER, $ok);
            if ($ok && is_array($hit)) return $hit;
        }
        $rows = Db::pdo()->query('SELECT email FROM super_admins')->fetchAll();
        $set = [];
        foreach ($rows as $r) { $set[strtolower($r['email'])] = true; }
        if (function_exists('apcu_store')) {
            apcu_store(self::CACHE_KEY_SUPER, $set, self::SUPER_TTL_SECONDS);
        }
        return $set;
    }

    /** Log a super-admin action for the audit trail (kept forever). */
    public static function logSuperAction(
        string $superEmail,
        string $action,
        ?int $targetTenant = null,
        ?int $fromTenant = null,
        ?string $detail = null
    ): void {
        Db::pdo()->prepare(
            'INSERT INTO super_action_log
              (super_email, action, target_tenant, from_tenant, ip, user_agent, detail)
             VALUES (?, ?, ?, ?, ?, ?, ?)'
        )->execute([
            $superEmail,
            $action,
            $targetTenant,
            $fromTenant,
            $_SERVER['REMOTE_ADDR']     ?? null,
            $_SERVER['HTTP_USER_AGENT'] ?? null,
            $detail,
        ]);
    }
}
