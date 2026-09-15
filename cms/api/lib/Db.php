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

        $opts = [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ];
        // Hostinger's shared MySQL occasionally refuses a connection outright
        // ("SQLSTATE[HY000] [2002] Operation not permitted") when two requests
        // from the same app connect in the same instant - seen on prod as the
        // second of the Settings page's two GET /settings calls. It is not a
        // credentials or host problem, so one short retry is the right fix;
        // anything else (auth, unknown db) still throws straight away.
        $attempt = 0;
        while (true) {
            try {
                self::$pdo = new PDO($dsn, $cfg['user'], $cfg['password'], $opts);
                return self::$pdo;
            } catch (\PDOException $e) {
                $transient = strpos($e->getMessage(), '[2002]') !== false;
                if (!$transient || ++$attempt >= 3) throw $e;
                usleep($attempt === 1 ? 100_000 : 250_000);
            }
        }
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
