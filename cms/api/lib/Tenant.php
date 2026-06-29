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
