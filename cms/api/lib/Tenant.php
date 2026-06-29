<?php
declare(strict_types=1);

namespace BRS;

/**
 * Per-request tenant context.
 *
 * Set once by {@see Auth::require()} after the JWT is verified; read by
 * every route + scoped query helper for the remainder of the request.
 *
 *   Tenant::id()       — the tenant_id every WHERE clause must filter by
 *   Tenant::isSuper()  — true for super-admins (cross-tenant operators)
 *   Tenant::userId()   — the calling user's admin_users.id within the tenant
 *   Tenant::email()    — calling user's email, useful for audit logging
 *
 * Routes use these to scope queries and to gate cross-tenant operations
 * (only super-admins can impersonate, etc.). The values are immutable
 * once set — switching tenants mid-request would be a tenancy-leak
 * waiting to happen.
 */
final class Tenant
{
    private static ?int $tenantId = null;
    private static ?int $userId   = null;
    private static ?string $email = null;
    private static bool $super    = false;

    /** Set the tenant context for this request from JWT claims. Called
     *  exactly once by Auth::require(); subsequent calls are no-ops so
     *  middleware ordering doesn't matter. */
    public static function set(int $tenantId, int $userId, string $email, bool $isSuper): void
    {
        if (self::$tenantId !== null) return;     // already set, ignore
        self::$tenantId = $tenantId;
        self::$userId   = $userId;
        self::$email    = $email;
        self::$super    = $isSuper;
    }

    /** The current tenant id. Throws if nothing is loaded — that's the
     *  scanner's signal that a route forgot to call Auth::require(). */
    public static function id(): int
    {
        if (self::$tenantId === null) {
            throw new \RuntimeException('Tenant::id() called before Auth::require() — request has no tenant context.');
        }
        return self::$tenantId;
    }

    public static function userId(): ?int   { return self::$userId; }
    public static function email(): ?string { return self::$email; }
    public static function isSuper(): bool  { return self::$super; }
    public static function isLoaded(): bool { return self::$tenantId !== null; }

    /** Bootstrap context for public (no-auth) endpoints — onboarding
     *  portals, form intake, surveys, public jobs board, etc. These
     *  routes don't carry a JWT, so they can't derive a tenant from
     *  claims.
     *
     *  Resolution order:
     *    1. X-Tenant-Key header — each tenant's marketing site embeds
     *       its public_api_key (migration 109) and sends it on every
     *       public request. Matching key → that tenant.
     *    2. Explicit $tenantId arg — bypasses the header, used by tests
     *       and a few legacy callers.
     *    3. Fallback: tenant 1 (BRS). Keeps the existing single-tenant
     *       marketing site working unchanged until each tenant ships
     *       their own key.
     *
     *  Suspended / soft-deleted tenants found via header are rejected
     *  silently (falls through to default) so a paused tenant doesn't
     *  see their forms go to BRS instead — the route hits the kill-set
     *  later when Db::tpdo() needs Tenant::id(). For now we simply
     *  refuse via {@see \BRS\Tenants::resolveByApiKey()}.
     */
    public static function setForPublic(?int $tenantId = null): void
    {
        if (self::$tenantId !== null) return;

        if ($tenantId === null) {
            $key = self::headerCaseInsensitive('X-Tenant-Key') ?? '';
            if ($key !== '') {
                $resolved = \BRS\Tenants::resolveByApiKey($key);
                if ($resolved !== null) $tenantId = $resolved;
            }
        }

        self::$tenantId = $tenantId ?? 1;
        self::$userId   = null;
        self::$email    = null;
        self::$super    = false;
    }

    /** Lower-case-fold the header lookup since Apache normalises one
     *  way and PHP-FPM another, and we don't want a header that the
     *  client sent to silently fail because of casing. */
    private static function headerCaseInsensitive(string $name): ?string
    {
        $serverKey = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
        if (isset($_SERVER[$serverKey])) return (string)$_SERVER[$serverKey];
        if (function_exists('apache_request_headers')) {
            $h = apache_request_headers();
            foreach ($h as $k => $v) {
                if (strcasecmp($k, $name) === 0) return (string)$v;
            }
        }
        return null;
    }

    /** Re-target the request to a specific tenant derived from a URL
     *  token. Used by no-auth flows where the URL itself implies the
     *  tenant — e.g. newsletter unsubscribe (token → recipient row →
     *  recipient.tenant_id), HR onboarding portal (token → employee →
     *  employee.tenant_id), recruitment candidate portal, etc.
     *
     *  The caller is expected to have already resolved the tenant_id
     *  via a deliberately-global query (annotated @global-scope) and
     *  is just telling the framework "everything from here is this
     *  tenant's data". Unlike set(), this WILL replace an existing
     *  context — that's the whole point. */
    public static function overrideTo(int $tenantId): void
    {
        self::$tenantId = $tenantId;
        self::$userId   = null;
        self::$email    = null;
        self::$super    = false;
    }

    /** Test-only — wipes context so isolation tests can simulate
     *  consecutive requests as different tenants. Do not call from
     *  production code paths. */
    public static function resetForTest(): void
    {
        self::$tenantId = null;
        self::$userId   = null;
        self::$email    = null;
        self::$super    = false;
    }
}
