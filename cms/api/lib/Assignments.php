<?php
declare(strict_types=1);

namespace BRS;

/**
 * Shared implementation of the /:entity/:id/assignments sub-route.
 * Called from clients.php + leads.php with $entityType = 'client'|'lead'.
 *
 * GET    → { assignments: [{role, current, history[]}] } for all four roles
 * POST   → { role, assignee_type, assignee_id, notes? } — replaces the
 *          single-active role's row (auto-ending the previous); for
 *          service_tasks just appends a new active row.
 * DELETE :aid → ends an active assignment (stamp ended_at + ended_by_user_id)
 * PUT    :aid → update notes on an active assignment
 */
class Assignments
{
    /** Every role we support. Order drives display order in the UI. */
    private const ROLES = ['onboarding', 'services', 'service_tasks', 'account_tasks'];

    /** Which roles enforce one-active-at-a-time (auto-end previous on POST). */
    private const SINGLE_ACTIVE = ['onboarding', 'services', 'account_tasks'];

    private const ASSIGNEE_TYPES = ['employee', 'contractor', 'partner'];

    public static function handle(string $entityType, int $entityId, string $method, array $segs): void
    {
        $pdo = Db::tpdo();

        // /:id/assignments (list all roles) or /:id/assignments/:aid (one row)
        $aid = isset($segs[3]) ? (int)$segs[3] : null;

        if ($aid === null) {
            if ($method === 'GET') self::listAll($pdo, $entityType, $entityId);
            if ($method === 'POST') self::assign($pdo, $entityType, $entityId);
            Json::fail('Method not allowed', 405);
        }

        if ($method === 'DELETE') self::endAssignment($pdo, $entityType, $entityId, $aid);
        if ($method === 'PUT')    self::updateNotes($pdo, $entityType, $entityId, $aid);
        Json::fail('Method not allowed', 405);
    }

    private static function listAll(\PDO|TenantPdo $pdo, string $entityType, int $entityId): void
    {
        $rows = $pdo->prepare(
            'SELECT a.*,
                    au.display_name AS assigned_by_name,
                    eu.display_name AS ended_by_name
             FROM assignments a
             LEFT JOIN admin_users au ON au.id = a.assigned_by_user_id
             LEFT JOIN admin_users eu ON eu.id = a.ended_by_user_id
             WHERE a.entity_type = ? AND a.entity_id = ?
             ORDER BY a.assigned_at DESC'
        );
        $rows->execute([$entityType, $entityId]);
        $all = $rows->fetchAll();

        // Enrich each row with the assignee's display name from the correct
        // source table. Two round-trips per source table (one to collect ids,
        // one to fetch names) keeps this O(1) SQL rather than O(N).
        $byType = ['employee' => [], 'contractor' => [], 'partner' => []];
        foreach ($all as $r) $byType[$r['assignee_type']][] = (int)$r['assignee_id'];
        $nameMap = [];
        if ($byType['employee']) {
            $in = implode(',', array_fill(0, count($byType['employee']), '?'));
            $q  = $pdo->prepare("SELECT id, CONCAT(first_name, ' ', last_name) AS name, position
                                 FROM hr_employees WHERE id IN ($in)");
            $q->execute($byType['employee']);
            foreach ($q->fetchAll() as $r) $nameMap["employee:{$r['id']}"] = $r;
        }
        if ($byType['contractor']) {
            $in = implode(',', array_fill(0, count($byType['contractor']), '?'));
            $q  = $pdo->prepare("SELECT id, name, discipline AS position
                                 FROM contractors WHERE id IN ($in)");
            $q->execute($byType['contractor']);
            foreach ($q->fetchAll() as $r) $nameMap["contractor:{$r['id']}"] = $r;
        }
        if ($byType['partner']) {
            $in = implode(',', array_fill(0, count($byType['partner']), '?'));
            $q  = $pdo->prepare("SELECT id, COALESCE(trading_name, legal_name) AS name, partnership_type AS position
                                 FROM partners WHERE id IN ($in)");
            $q->execute($byType['partner']);
            foreach ($q->fetchAll() as $r) $nameMap["partner:{$r['id']}"] = $r;
        }

        // Group by role: current (ended_at IS NULL) + history (ended_at IS NOT NULL).
        $byRole = [];
        foreach (self::ROLES as $r) $byRole[$r] = ['role' => $r, 'current' => [], 'history' => []];
        foreach ($all as $row) {
            $key = "{$row['assignee_type']}:{$row['assignee_id']}";
            $row['assignee_name']     = $nameMap[$key]['name']     ?? '(unknown)';
            $row['assignee_position'] = $nameMap[$key]['position'] ?? null;
            $row['id'] = (int)$row['id'];
            $row['assignee_id'] = (int)$row['assignee_id'];
            if (!isset($byRole[$row['role']])) continue; // legacy / unknown role
            if ($row['ended_at'] === null) $byRole[$row['role']]['current'][] = $row;
            else                            $byRole[$row['role']]['history'][] = $row;
        }
        Json::send(['assignments' => array_values($byRole)]);
    }

    private static function assign(\PDO|TenantPdo $pdo, string $entityType, int $entityId): void
    {
        $body = Json::readBody();
        $role = (string)($body['role'] ?? '');
        if (!in_array($role, self::ROLES, true)) Json::fail('Invalid role', 400);
        $at = (string)($body['assignee_type'] ?? '');
        if (!in_array($at, self::ASSIGNEE_TYPES, true)) Json::fail('Invalid assignee_type', 400);
        $aid = (int)($body['assignee_id'] ?? 0);
        if ($aid <= 0) Json::fail('assignee_id required', 400);

        $callerId = (int)(Tenant::userId() ?? 0) ?: null;

        // For single-active roles, end any currently-active assignment first.
        if (in_array($role, self::SINGLE_ACTIVE, true)) {
            $end = $pdo->prepare(
                'UPDATE assignments
                 SET ended_at = NOW(), ended_by_user_id = ?
                 WHERE entity_type = ? AND entity_id = ? AND role = ? AND ended_at IS NULL'
            );
            $end->execute([$callerId, $entityType, $entityId, $role]);
        } else {
            // service_tasks: refuse duplicate assignment of the same assignee.
            $dup = $pdo->prepare(
                'SELECT id FROM assignments
                 WHERE entity_type = ? AND entity_id = ? AND role = ?
                   AND assignee_type = ? AND assignee_id = ? AND ended_at IS NULL LIMIT 1'
            );
            $dup->execute([$entityType, $entityId, $role, $at, $aid]);
            if ($dup->fetchColumn()) Json::fail('That person is already assigned to this role', 409);
        }

        $ins = $pdo->prepare(
            'INSERT INTO assignments
             (entity_type, entity_id, role, assignee_type, assignee_id, assigned_by_user_id, notes)
             VALUES (?,?,?,?,?,?,?)'
        );
        $ins->execute([
            $entityType, $entityId, $role, $at, $aid, $callerId,
            trim((string)($body['notes'] ?? '')) ?: null,
        ]);
        Json::send(['id' => (int)$pdo->lastInsertId()], 201);
    }

    private static function endAssignment(\PDO|TenantPdo $pdo, string $entityType, int $entityId, int $aid): void
    {
        $callerId = (int)(Tenant::userId() ?? 0) ?: null;
        $upd = $pdo->prepare(
            'UPDATE assignments
             SET ended_at = NOW(), ended_by_user_id = ?
             WHERE id = ? AND entity_type = ? AND entity_id = ? AND ended_at IS NULL'
        );
        $upd->execute([$callerId, $aid, $entityType, $entityId]);
        Json::send(['ok' => true]);
    }

    private static function updateNotes(\PDO|TenantPdo $pdo, string $entityType, int $entityId, int $aid): void
    {
        $body  = Json::readBody();
        $notes = array_key_exists('notes', $body) ? (trim((string)$body['notes']) ?: null) : null;
        $upd = $pdo->prepare(
            'UPDATE assignments SET notes = ?
             WHERE id = ? AND entity_type = ? AND entity_id = ?'
        );
        $upd->execute([$notes, $aid, $entityType, $entityId]);
        Json::send(['ok' => true]);
    }
}
