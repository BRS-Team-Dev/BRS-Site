<?php
declare(strict_types=1);

namespace BRS;

use PDO;

/**
 * Cross-system glue for the Recruitment service.
 *
 * The "Recruitment" service_offerings row is special: when it's attached to a
 * client the client becomes part of the Recruitment system, and a recruitment
 * "role" (opening) is spawned for them. The link works both ways:
 *
 *   - CRM attaches the Recruitment service  → a blank role is created.
 *   - Recruitment creates a role for a client → the service is attached.
 *
 * These helpers live in a shared lib (not a route file) because the API loads
 * only one route file per request, yet both `routes/clients.php` and
 * `routes/recruitment.php` need them. Autoloaded as BRS\Recruitment.
 */
final class Recruitment
{
    /** id of the active "Recruitment" service offering, or null if not seeded. */
    public static function offeringId(PDO|\BRS\TenantPdo $pdo): ?int
    {
        $id = $pdo->query("SELECT id FROM service_offerings WHERE LOWER(name) = 'recruitment' AND is_active = 1 LIMIT 1")
                  ->fetchColumn();
        return $id ? (int)$id : null;
    }

    public static function isAttached(PDO|\BRS\TenantPdo $pdo, int $clientId): bool
    {
        $sid = self::offeringId($pdo);
        if (!$sid) return false;
        $chk = $pdo->prepare('SELECT 1 FROM client_service_offerings WHERE client_id = ? AND service_offering_id = ? LIMIT 1');
        $chk->execute([$clientId, $sid]);
        return (bool)$chk->fetchColumn();
    }

    /**
     * Attach the Recruitment service to a client (singleton — a second call is
     * a no-op). Snapshots the offering's name/pricing onto
     * client_service_offerings. Returns true ONLY when it newly attached, so
     * callers can spawn a role exactly once.
     */
    public static function attachToClient(PDO|\BRS\TenantPdo $pdo, int $clientId): bool
    {
        $sid = self::offeringId($pdo);
        if (!$sid) return false;
        if (self::isAttached($pdo, $clientId)) return false;
        $ofr = $pdo->prepare('SELECT name, price, payment_type, repeat_duration FROM service_offerings WHERE id = ?');
        $ofr->execute([$sid]);
        $row = $ofr->fetch();
        if (!$row) return false;
        $ins = $pdo->prepare('INSERT INTO client_service_offerings
            (client_id, service_offering_id, name, price, payment_type, repeat_duration)
            VALUES (?,?,?,?,?,?)');
        $ins->execute([$clientId, $sid, $row['name'], $row['price'], $row['payment_type'], $row['repeat_duration']]);
        return true;
    }

    /**
     * Unlink the Recruitment service from a client AND drop the in-flight
     * pipeline data they take with them. Completed engagements (filled
     * roles + placed/ended candidate placements) are preserved so the
     * historical work record stays intact.
     */
    public static function detachFromClient(PDO|\BRS\TenantPdo $pdo, int $clientId): void
    {
        $sid = self::offeringId($pdo);
        if ($sid) {
            $pdo->prepare('DELETE FROM client_service_offerings WHERE client_id = ? AND service_offering_id = ?')
                ->execute([$clientId, $sid]);
        }
        // Run the cleanup unconditionally — recruitment data shouldn't
        // outlive the relationship even when the offering itself was
        // deleted from the catalogue.
        self::cleanupClientData($pdo, $clientId);
    }

    /**
     * When a client leaves Recruitment, drop:
     *   - placements where status IN ('screening','rejected') — in-flight
     *     pitches + rejections tied to an active relationship;
     *   - roles where status != 'filled' — openings that didn't complete.
     *
     * Kept: filled roles + placed/ended placements. The FK on
     * `recruitment_placements.role_id` is ON DELETE SET NULL, so surviving
     * placements lose the role pointer but stay intact — the candidate's
     * profile still shows the historical engagement at this client.
     */
    public static function cleanupClientData(PDO|\BRS\TenantPdo $pdo, int $clientId): void
    {
        $pdo->prepare(
            "DELETE FROM recruitment_placements
             WHERE client_id = ? AND status IN ('screening', 'rejected')"
        )->execute([$clientId]);
        $pdo->prepare(
            "DELETE FROM recruitment_roles
             WHERE client_id = ? AND status <> 'filled'"
        )->execute([$clientId]);
    }

    /**
     * Mirror a recruitment role as a "Recruitment" service row on the client's
     * CRM Services tab (1:1 — every role gets its own row). Idempotent per
     * role. Snapshots the offering name; the GET handler overlays the live
     * role title + commission. No-op if the Recruitment offering isn't seeded.
     */
    public static function createServiceRowForRole(PDO|\BRS\TenantPdo $pdo, int $clientId, int $roleId): void
    {
        $sid = self::offeringId($pdo);
        if (!$sid) return;
        $chk = $pdo->prepare('SELECT 1 FROM client_service_offerings WHERE role_id = ? LIMIT 1');
        $chk->execute([$roleId]);
        if ($chk->fetchColumn()) return;
        $ins = $pdo->prepare('INSERT INTO client_service_offerings
            (client_id, service_offering_id, role_id, name, price, payment_type, repeat_duration)
            VALUES (?,?,?,?,?,?,?)');
        $ins->execute([$clientId, $sid, $roleId, 'Recruitment', null, 'one_off', null]);
    }

    /**
     * Spawn a blank recruitment role (opening) for a client AND its mirror
     * service row. Generic placeholder values — the user fills in the real
     * brief in the Recruitment section afterwards. Returns the new role id.
     */
    public static function createDefaultRole(PDO|\BRS\TenantPdo $pdo, int $clientId): int
    {
        $ins = $pdo->prepare('INSERT INTO recruitment_roles (client_id, title, status, currency) VALUES (?,?,?,?)');
        $ins->execute([$clientId, 'New role', 'open', 'GBP']);
        $roleId = (int)$pdo->lastInsertId();
        self::createServiceRowForRole($pdo, $clientId, $roleId);
        return $roleId;
    }

    /**
     * Make sure a client is part of Recruitment: if they have no recruitment
     * role/service yet, spawn one. Used when the is_recruitment_client flag is
     * turned on (which shouldn't pile up extra roles on every save).
     */
    public static function ensureRecruitmentClient(PDO|\BRS\TenantPdo $pdo, int $clientId): void
    {
        if (!self::isAttached($pdo, $clientId)) {
            self::createDefaultRole($pdo, $clientId);
        }
    }
}
