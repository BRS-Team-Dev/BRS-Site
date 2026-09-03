<?php
declare(strict_types=1);

namespace BRS;

use PDO;

final class Db
{
    private static ?PDO $pdo = null;
    private static ?TenantPdo $tpdo = null;

    public static function pdo(): PDO
    {
        if (self::$pdo) return self::$pdo;

        $cfg = $GLOBALS['BRS_CONFIG']['db'];
        $dsn = sprintf(
            'mysql:host=%s;port=%d;dbname=%s;charset=%s',
            $cfg['host'], $cfg['port'], $cfg['name'], $cfg['charset']
        );

        self::$pdo = new PDO($dsn, $cfg['user'], $cfg['password'], [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
        return self::$pdo;
    }

    /** Tenant-aware PDO. Returns a TenantPdo wrapper that auto-injects
     *  `tenant_id` scoping on every prepare/query/exec via
     *  {@see TenantSqlRewriter}. Routes that switch from pdo() to tpdo()
     *  become automatically tenant-isolated without changing any of
     *  their query bodies.
     *
     *  Singleton per request — the wrapper is stateless so reusing the
     *  same instance across the whole request is safe and avoids the
     *  per-call allocation cost. */
    public static function tpdo(): TenantPdo
    {
        return self::$tpdo ??= new TenantPdo(self::pdo());
    }

    /** Test-only — wipes the cached PDO + TenantPdo so the isolation
     *  test harness can simulate a fresh request. */
    public static function resetForTest(): void
    {
        self::$pdo  = null;
        self::$tpdo = null;
    }
}
