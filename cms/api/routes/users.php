<?php
declare(strict_types=1);

use BRS\Auth;
use BRS\Db;
use BRS\Json;
use BRS\Tenant;

/*
 * Admin user management + subscription-tier cap enforcement.
 *
 *   GET    /api/users                       — list active + deactivated (excludes hard-deleted)
 *   POST   /api/users                       — create (blocked when at active-user cap)
 *   GET    /api/users/:id
 *   PUT    /api/users/:id                    — update profile / role / password
 *   POST   /api/users/:id/deactivate          — soft: is_active=0, keeps in list
 *   POST   /api/users/:id/reinstate           — is_active=1 (blocked when at cap)
 *   DELETE /api/users/:id                    — hard: sets deleted_at, excluded from lists
 *
 *   GET    /api/users/subscription           — { tier, max_active_users, active_count, at_cap }
 *   PUT    /api/users/subscription           — { tier: 'growth' } — stub for real payment flow
 */

// Tier → max active users. NULL = unlimited. Read from
// `subscription_plans` at request time so a super-admin edit to a
// plan's user cap takes effect without a code deploy. Cached in a
// static so a single request only hits the DB once.
const TIER_ORDER = ['trial','starter','growth','scale','business','enterprise_lite','enterprise'];

function _brs_tier_caps(): array
{
    static $cache = null;
    if ($cache !== null) return $cache;
    $rows = \BRS\Db::pdo()->query(
        'SELECT tier, max_users FROM subscription_plans WHERE is_active = 1'
    )->fetchAll();
    $out = [];
    foreach ($rows as $r) {
        $out[$r['tier']] = $r['max_users'] === null ? null : (int)$r['max_users'];
    }
    // Guarantee every tier has an entry so ?? null works cleanly.
    foreach (TIER_ORDER as $t) if (!array_key_exists($t, $out)) $out[$t] = null;
    return $cache = $out;
}

return function (string $method, array $segs): void {
    Auth::require();
    $pdo = Db::tpdo();

    // ── /api/users/subscription — GET current tier + usage, PUT to change ──
    if (($segs[1] ?? '') === 'subscription') {
        $tenantRow = Db::pdo()->prepare('SELECT subscription_tier FROM tenants WHERE id = ?');
        $tenantRow->execute([Tenant::id()]);
        $tier = (string)($tenantRow->fetchColumn() ?: 'trial');

        if ($method === 'GET') {
            $activeCount = (int)$pdo->query(
                'SELECT COUNT(*) FROM admin_users WHERE is_active = 1 AND deleted_at IS NULL'
            )->fetchColumn();
            $cap = _brs_tier_caps()[$tier] ?? null;
            Json::send([
                'tier'             => $tier,
                'max_active_users' => $cap,      // null = unlimited
                'active_count'     => $activeCount,
                'at_cap'           => $cap !== null && $activeCount >= $cap,
                'tier_ladder'      => array_map(
                    static fn($k) => ['tier' => $k, 'max_active_users' => _brs_tier_caps()[$k]],
                    TIER_ORDER,
                ),
            ]);
        }
        if ($method === 'PUT') {
            $b = Json::readBody();
            $newTier = (string)($b['tier'] ?? '');
            if (!in_array($newTier, TIER_ORDER, true)) Json::fail('Invalid tier', 400);
            // NOTE: real product hooks up Stripe / payment here. For now
            // we just persist. Any billing side effects are TBD.
            Db::pdo()->prepare('UPDATE tenants SET subscription_tier = ? WHERE id = ?')
                ->execute([$newTier, Tenant::id()]);
            Json::send(['ok' => true, 'tier' => $newTier]);
        }
        Json::fail('Method not allowed', 405);
    }

    if (!isset($segs[1])) {
        if ($method === 'GET') {
            // Exclude hard-deleted rows. Keep deactivated ones so the UI
            // can show a "Reinstate" button.
            $rows = $pdo->query(
                'SELECT id, email, display_name, role, is_active, created_at
                   FROM admin_users
                  WHERE deleted_at IS NULL
                  ORDER BY is_active DESC, id'
            )->fetchAll();
            Json::send(['users' => $rows]);
        }
        if ($method === 'POST') {
            $b = Json::readBody();
            $email = trim((string)($b['email'] ?? ''));
            $name  = trim((string)($b['display_name'] ?? ''));
            $pass  = (string)($b['password'] ?? '');
            $role  = in_array($b['role'] ?? '', ['admin','member','viewer'], true) ? $b['role'] : 'member';
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) Json::fail('Valid email required', 400);
            if ($name === '') Json::fail('Display name required', 400);
            if (strlen($pass) < 8) Json::fail('Password must be at least 8 chars', 400);

            // Cap enforcement — count against current tier BEFORE insert.
            _brs_enforce_cap($pdo);

            try {
                $ins = $pdo->prepare(
                    'INSERT INTO admin_users (email, password_hash, display_name, role, is_active)
                     VALUES (?, ?, ?, ?, 1)'
                );
                $ins->execute([$email, password_hash($pass, PASSWORD_BCRYPT), $name, $role]);
                Json::send(['id' => (int)$pdo->lastInsertId()], 201);
            } catch (\PDOException $e) {
                if ($e->errorInfo[1] === 1062) Json::fail('Email already in use', 400);
                throw $e;
            }
        }
        Json::fail('Method not allowed', 405);
    }

    $id = (int)$segs[1];
    $row = $pdo->prepare(
        'SELECT id, email, display_name, role, is_active, deleted_at, created_at
           FROM admin_users WHERE id = ?'
    );
    $row->execute([$id]);
    $user = $row->fetch();
    if (!$user || $user['deleted_at'] !== null) Json::fail('User not found', 404);

    // ── /api/users/:id/deactivate ──
    if (($segs[2] ?? '') === 'deactivate' && $method === 'POST') {
        $pdo->prepare('UPDATE admin_users SET is_active = 0 WHERE id = ?')->execute([$id]);
        Json::send(['ok' => true]);
    }
    // ── /api/users/:id/reinstate ── (cap check first)
    if (($segs[2] ?? '') === 'reinstate' && $method === 'POST') {
        _brs_enforce_cap($pdo);
        $pdo->prepare('UPDATE admin_users SET is_active = 1 WHERE id = ?')->execute([$id]);
        Json::send(['ok' => true]);
    }

    if ($method === 'GET') Json::send(['user' => $user]);

    if ($method === 'PUT') {
        $b = Json::readBody();
        $name = trim((string)($b['display_name'] ?? $user['display_name'])) ?: $user['display_name'];
        $role = in_array($b['role'] ?? $user['role'], ['admin','member','viewer'], true) ? ($b['role'] ?? $user['role']) : $user['role'];
        $wasActive = (int)$user['is_active'] === 1;
        $active    = array_key_exists('is_active', $b) ? (!empty($b['is_active']) ? 1 : 0) : (int)$user['is_active'];
        // Cap enforcement on reactivation via PUT.
        if (!$wasActive && $active === 1) _brs_enforce_cap($pdo);

        $upd = $pdo->prepare('UPDATE admin_users SET display_name=?, role=?, is_active=? WHERE id = ?');
        $upd->execute([$name, $role, $active, $id]);
        if (!empty($b['password']) && strlen((string)$b['password']) >= 8) {
            $pdo->prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?')
                ->execute([password_hash((string)$b['password'], PASSWORD_BCRYPT), $id]);
        }
        Json::send(['ok' => true]);
    }

    if ($method === 'DELETE') {
        // Hard delete → deleted_at is set; row is excluded from all
        // future SELECTs but FK-referenced data stays intact.
        $pdo->prepare('UPDATE admin_users SET deleted_at = NOW(), is_active = 0 WHERE id = ?')
            ->execute([$id]);
        Json::send(['ok' => true]);
    }
    Json::fail('Method not allowed', 405);
};

/** Enforce subscription-tier active-user cap. Aborts with 402 when hit
 *  so the frontend can distinguish "upgrade to fix" from a 400 input error. */
/** $pdo may be either \PDO or BRS\TenantPdo — both expose ->query(). */
function _brs_enforce_cap($pdo): void
{
    $tenantRow = Db::pdo()->prepare('SELECT subscription_tier FROM tenants WHERE id = ?');
    $tenantRow->execute([Tenant::id()]);
    $tier = (string)($tenantRow->fetchColumn() ?: 'trial');
    $cap = _brs_tier_caps()[$tier] ?? null;
    if ($cap === null) return; // enterprise
    $active = (int)$pdo->query(
        'SELECT COUNT(*) FROM admin_users WHERE is_active = 1 AND deleted_at IS NULL'
    )->fetchColumn();
    if ($active >= $cap) {
        Json::fail(
            "Active-user cap reached ($active / $cap on '$tier' plan). Upgrade to add more.",
            402
        );
    }
}
