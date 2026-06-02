<?php
declare(strict_types=1);

use BRS\Auth;
use BRS\Db;
use BRS\Json;

/*
 * Admin user management.
 *
 *   GET    /api/users                 — list (active + inactive)
 *   POST   /api/users                 — create (email + display_name + role + initial password)
 *   GET    /api/users/:id
 *   PUT    /api/users/:id              — update profile / role / is_active (and optionally password)
 *   DELETE /api/users/:id              — soft delete by flipping is_active = 0
 */

return function (string $method, array $segs): void {
    Auth::require();
    $pdo = Db::pdo();

    if (!isset($segs[1])) {
        if ($method === 'GET') {
            $rows = $pdo->query('SELECT id, email, display_name, role, is_active, created_at FROM admin_users ORDER BY id')->fetchAll();
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
            try {
                $ins = $pdo->prepare('INSERT INTO admin_users (email, password_hash, display_name, role, is_active) VALUES (?,?,?,?,1)');
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
    $row = $pdo->prepare('SELECT id, email, display_name, role, is_active, created_at FROM admin_users WHERE id = ?');
    $row->execute([$id]);
    $user = $row->fetch();
    if (!$user) Json::fail('User not found', 404);
    if ($method === 'GET') Json::send(['user' => $user]);
    if ($method === 'PUT') {
        $b = Json::readBody();
        $name = trim((string)($b['display_name'] ?? $user['display_name'])) ?: $user['display_name'];
        $role = in_array($b['role'] ?? $user['role'], ['admin','member','viewer'], true) ? ($b['role'] ?? $user['role']) : $user['role'];
        $active = array_key_exists('is_active', $b) ? (!empty($b['is_active']) ? 1 : 0) : (int)$user['is_active'];
        $upd = $pdo->prepare('UPDATE admin_users SET display_name=?, role=?, is_active=? WHERE id = ?');
        $upd->execute([$name, $role, $active, $id]);
        if (!empty($b['password']) && strlen((string)$b['password']) >= 8) {
            $pdo->prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?')
                ->execute([password_hash((string)$b['password'], PASSWORD_BCRYPT), $id]);
        }
        Json::send(['ok' => true]);
    }
    if ($method === 'DELETE') {
        // Soft-delete via is_active = 0; preserves any FKs (assigned_to, comments, etc.)
        $pdo->prepare('UPDATE admin_users SET is_active = 0 WHERE id = ?')->execute([$id]);
        Json::send(['ok' => true]);
    }
    Json::fail('Method not allowed', 405);
};
