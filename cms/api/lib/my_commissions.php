<?php
declare(strict_types=1);

use BRS\Json;
use BRS\TenantPdo;

/**
 * Shared helpers powering "My accounts & commissions" on both employee
 * (/api/hr/me) and contractor (/api/contractor/me) portals. Also exposes
 * the admin CRUD entrypoints for the Commissions tab on client detail.
 */

/**
 * Portal read: everything a logged-in user cares about for their
 * commissions page. One round-trip returns:
 *
 *   - accounts:   clients they're currently the active assignee on,
 *                 with the roles they hold, since date, and any
 *                 standing commission rule they have on that client.
 *   - rules:      all their active/paused standing rules (for a section
 *                 the portal can display separately if the client has
 *                 no active assignment yet — rare but possible).
 *   - ledger:     every user_commissions row for them, most recent first.
 *   - totals:     earned / paid / pending / this-year rollups.
 */
function my_commissions_for_user(PDO|TenantPdo $pdo, int $userId): array
{
    // ── Accounts I'm assigned to (from the unified assignments table)
    $accts = $pdo->prepare(
        "SELECT c.id AS client_id, c.name AS client_name, c.company,
                GROUP_CONCAT(DISTINCT a.role ORDER BY a.role SEPARATOR ', ') AS roles,
                MIN(a.assigned_at) AS assigned_since
         FROM assignments a
         JOIN clients c ON c.id = a.entity_id
         JOIN hr_employees e ON e.admin_user_id = ?
         WHERE a.entity_type = 'client'
           AND a.ended_at IS NULL
           AND a.assignee_type = 'employee'
           AND a.assignee_id = e.id
         GROUP BY c.id, c.name, c.company

         UNION ALL

         SELECT c.id, c.name, c.company,
                GROUP_CONCAT(DISTINCT a.role ORDER BY a.role SEPARATOR ', ') AS roles,
                MIN(a.assigned_at) AS assigned_since
         FROM assignments a
         JOIN clients c ON c.id = a.entity_id
         JOIN contractors ctr ON ctr.admin_user_id = ?
         WHERE a.entity_type = 'client'
           AND a.ended_at IS NULL
           AND a.assignee_type = 'contractor'
           AND a.assignee_id = ctr.id
         GROUP BY c.id, c.name, c.company

         ORDER BY assigned_since DESC"
    );
    $accts->execute([$userId, $userId]);
    $accounts = $accts->fetchAll();

    // ── Standing commission rules for this user, joined to the client name.
    $rQ = $pdo->prepare(
        "SELECT r.*, c.name AS client_name
         FROM user_commission_rules r
         LEFT JOIN clients c ON c.id = r.client_id
         WHERE r.admin_user_id = ?
         ORDER BY r.status, c.name"
    );
    $rQ->execute([$userId]);
    $rules = $rQ->fetchAll();

    // ── Attach the active rule (if any) onto each account row for the UI.
    $rulesByClient = [];
    foreach ($rules as $r) {
        if ($r['status'] !== 'active') continue;
        $rulesByClient[(int)$r['client_id']][] = $r;
    }
    foreach ($accounts as &$a) {
        $a['rules'] = $rulesByClient[(int)$a['client_id']] ?? [];
        // Total earned/paid/pending PER account so the row can show it.
        $t = $pdo->prepare(
            "SELECT
               COALESCE(SUM(CASE WHEN status IN ('earned','paid') THEN amount END), 0) AS earned,
               COALESCE(SUM(CASE WHEN status = 'paid'                 THEN amount END), 0) AS paid,
               COALESCE(SUM(CASE WHEN status = 'pending'              THEN amount END), 0) AS pending,
               COUNT(*) AS entry_count
             FROM user_commissions
             WHERE admin_user_id = ? AND client_id = ?"
        );
        $t->execute([$userId, (int)$a['client_id']]);
        $a['totals'] = $t->fetch();
    }
    unset($a);

    // ── Full ledger for this user.
    $lQ = $pdo->prepare(
        "SELECT uc.*, c.name AS client_name, u.display_name AS created_by_name
         FROM user_commissions uc
         LEFT JOIN clients c ON c.id = uc.client_id
         LEFT JOIN admin_users u ON u.id = uc.created_by_user_id
         WHERE uc.admin_user_id = ?
         ORDER BY uc.earned_on DESC, uc.id DESC
         LIMIT 500"
    );
    $lQ->execute([$userId]);
    $ledger = $lQ->fetchAll();

    // ── Totals rollup — global for the KPI cards.
    $tQ = $pdo->prepare(
        "SELECT
           COALESCE(SUM(CASE WHEN status IN ('earned','paid') THEN amount END), 0) AS earned_total,
           COALESCE(SUM(CASE WHEN status = 'paid'    THEN amount END), 0)          AS paid_total,
           COALESCE(SUM(CASE WHEN status = 'pending' THEN amount END), 0)          AS pending_total,
           COALESCE(SUM(CASE WHEN status IN ('earned','paid') AND YEAR(earned_on) = YEAR(CURDATE()) THEN amount END), 0) AS earned_ytd,
           COUNT(*) AS ledger_count
         FROM user_commissions
         WHERE admin_user_id = ?"
    );
    $tQ->execute([$userId]);
    $totals = $tQ->fetch();

    return [
        'accounts' => $accounts,
        'rules'    => $rules,
        'ledger'   => $ledger,
        'totals'   => $totals,
    ];
}

/**
 * Admin CRUD on a client's commissions/rules. Delegated to from
 * clients.php when the URL matches /clients/:id/commissions[/:cid]
 * or /clients/:id/commission-rules[/:rid].
 */
function client_commissions_route(PDO|TenantPdo $pdo, int $clientId, string $method, array $segs): void
{
    $sub = (string)($segs[2] ?? '');
    $callerId = (int)(\BRS\Tenant::userId() ?? 0) ?: null;

    if ($sub === 'commissions') {
        $cid = isset($segs[3]) ? (int)$segs[3] : null;
        if ($cid === null) {
            if ($method === 'GET') {
                $rows = $pdo->prepare(
                    "SELECT uc.*, u.display_name AS user_name, u.email AS user_email,
                            cby.display_name AS created_by_name
                     FROM user_commissions uc
                     LEFT JOIN admin_users u   ON u.id = uc.admin_user_id
                     LEFT JOIN admin_users cby ON cby.id = uc.created_by_user_id
                     WHERE uc.client_id = ?
                     ORDER BY uc.earned_on DESC, uc.id DESC"
                );
                $rows->execute([$clientId]);
                Json::send(['commissions' => $rows->fetchAll()]);
            }
            if ($method === 'POST') {
                $b = Json::readBody();
                $uid = (int)($b['admin_user_id'] ?? 0);
                if ($uid <= 0) Json::fail('admin_user_id required', 400);
                $amount = (float)($b['amount'] ?? 0);
                if ($amount == 0) Json::fail('amount required and non-zero', 400);
                $ins = $pdo->prepare(
                    'INSERT INTO user_commissions
                     (admin_user_id, client_id, rule_id, invoice_id, kind, amount, currency,
                      status, earned_on, paid_on, description, created_by_user_id)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
                );
                $ins->execute([
                    $uid, $clientId,
                    !empty($b['rule_id'])    ? (int)$b['rule_id']    : null,
                    !empty($b['invoice_id']) ? (int)$b['invoice_id'] : null,
                    _enum($b['kind'] ?? null, ['accrual','bonus','adjustment','payout'], 'accrual'),
                    $amount,
                    strtoupper(trim((string)($b['currency'] ?? 'GBP'))) ?: 'GBP',
                    _enum($b['status'] ?? null, ['pending','earned','paid','cancelled'], 'earned'),
                    trim((string)($b['earned_on'] ?? '')) ?: date('Y-m-d'),
                    trim((string)($b['paid_on']   ?? '')) ?: null,
                    trim((string)($b['description'] ?? '')) ?: null,
                    $callerId,
                ]);
                Json::send(['id' => (int)$pdo->lastInsertId()], 201);
            }
            Json::fail('Method not allowed', 405);
        }

        if ($method === 'PUT') {
            $b = Json::readBody();
            $existing = $pdo->prepare('SELECT * FROM user_commissions WHERE id = ? AND client_id = ?');
            $existing->execute([$cid, $clientId]);
            $row = $existing->fetch();
            if (!$row) Json::fail('Commission entry not found', 404);
            $pdo->prepare(
                'UPDATE user_commissions
                 SET kind = ?, amount = ?, currency = ?, status = ?, earned_on = ?, paid_on = ?, description = ?
                 WHERE id = ?'
            )->execute([
                _enum($b['kind']   ?? $row['kind'],   ['accrual','bonus','adjustment','payout'], (string)$row['kind']),
                array_key_exists('amount', $b)   ? (float)$b['amount']   : $row['amount'],
                array_key_exists('currency', $b) ? strtoupper((string)$b['currency']) : $row['currency'],
                _enum($b['status'] ?? $row['status'], ['pending','earned','paid','cancelled'], (string)$row['status']),
                array_key_exists('earned_on', $b) ? (trim((string)$b['earned_on']) ?: null) : $row['earned_on'],
                array_key_exists('paid_on',   $b) ? (trim((string)$b['paid_on'])   ?: null) : $row['paid_on'],
                array_key_exists('description', $b) ? (trim((string)$b['description']) ?: null) : $row['description'],
                $cid,
            ]);
            Json::send(['ok' => true]);
        }
        if ($method === 'DELETE') {
            $pdo->prepare('DELETE FROM user_commissions WHERE id = ? AND client_id = ?')->execute([$cid, $clientId]);
            Json::send(['ok' => true]);
        }
        Json::fail('Method not allowed', 405);
    }

    if ($sub === 'commission-rules') {
        $rid = isset($segs[3]) ? (int)$segs[3] : null;
        if ($rid === null) {
            if ($method === 'GET') {
                $rows = $pdo->prepare(
                    "SELECT r.*, u.display_name AS user_name, u.email AS user_email
                     FROM user_commission_rules r
                     LEFT JOIN admin_users u ON u.id = r.admin_user_id
                     WHERE r.client_id = ?
                     ORDER BY r.status, r.created_at DESC"
                );
                $rows->execute([$clientId]);
                Json::send(['rules' => $rows->fetchAll()]);
            }
            if ($method === 'POST') {
                $b = Json::readBody();
                $uid = (int)($b['admin_user_id'] ?? 0);
                if ($uid <= 0) Json::fail('admin_user_id required', 400);
                if (!isset($b['rate'])) Json::fail('rate required', 400);
                $ins = $pdo->prepare(
                    'INSERT INTO user_commission_rules
                     (admin_user_id, client_id, service_client_link_id, rate_type, rate,
                      applies_to, cadence, currency, status, starts_on, ends_on, notes, created_by_user_id)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)'
                );
                $ins->execute([
                    $uid, $clientId,
                    !empty($b['service_client_link_id']) ? (int)$b['service_client_link_id'] : null,
                    _enum($b['rate_type']  ?? null, ['percentage','flat'], 'percentage'),
                    (float)$b['rate'],
                    _enum($b['applies_to'] ?? null, ['all','recurring','one_off'], 'all'),
                    _enum($b['cadence']    ?? null, ['per_invoice','monthly','one_time'], 'per_invoice'),
                    strtoupper(trim((string)($b['currency'] ?? 'GBP'))) ?: 'GBP',
                    _enum($b['status']     ?? null, ['active','paused','ended'], 'active'),
                    trim((string)($b['starts_on'] ?? '')) ?: null,
                    trim((string)($b['ends_on']   ?? '')) ?: null,
                    trim((string)($b['notes'] ?? '')) ?: null,
                    $callerId,
                ]);
                Json::send(['id' => (int)$pdo->lastInsertId()], 201);
            }
            Json::fail('Method not allowed', 405);
        }
        if ($method === 'PUT') {
            $b = Json::readBody();
            $existing = $pdo->prepare('SELECT * FROM user_commission_rules WHERE id = ? AND client_id = ?');
            $existing->execute([$rid, $clientId]);
            $row = $existing->fetch();
            if (!$row) Json::fail('Rule not found', 404);
            $pdo->prepare(
                'UPDATE user_commission_rules
                 SET rate_type = ?, rate = ?, applies_to = ?, cadence = ?, currency = ?,
                     status = ?, starts_on = ?, ends_on = ?, notes = ?
                 WHERE id = ?'
            )->execute([
                _enum($b['rate_type']  ?? $row['rate_type'],  ['percentage','flat'], (string)$row['rate_type']),
                array_key_exists('rate', $b) ? (float)$b['rate'] : $row['rate'],
                _enum($b['applies_to'] ?? $row['applies_to'], ['all','recurring','one_off'], (string)$row['applies_to']),
                _enum($b['cadence']    ?? $row['cadence'],    ['per_invoice','monthly','one_time'], (string)$row['cadence']),
                array_key_exists('currency', $b) ? strtoupper((string)$b['currency']) : $row['currency'],
                _enum($b['status']     ?? $row['status'],     ['active','paused','ended'], (string)$row['status']),
                array_key_exists('starts_on', $b) ? (trim((string)$b['starts_on']) ?: null) : $row['starts_on'],
                array_key_exists('ends_on',   $b) ? (trim((string)$b['ends_on'])   ?: null) : $row['ends_on'],
                array_key_exists('notes',     $b) ? (trim((string)$b['notes'])     ?: null) : $row['notes'],
                $rid,
            ]);
            Json::send(['ok' => true]);
        }
        if ($method === 'DELETE') {
            $pdo->prepare('DELETE FROM user_commission_rules WHERE id = ? AND client_id = ?')->execute([$rid, $clientId]);
            Json::send(['ok' => true]);
        }
        Json::fail('Method not allowed', 405);
    }

    Json::fail('Not found', 404);
}

function _enum(?string $value, array $allowed, string $fallback): string
{
    return ($value !== null && in_array($value, $allowed, true)) ? $value : $fallback;
}
