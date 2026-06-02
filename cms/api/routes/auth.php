<?php
declare(strict_types=1);

use BRS\Auth;
use BRS\Db;
use BRS\Json;

return function (string $method, array $segs): void {
    // /api/auth/login
    if ($method === 'POST' && ($segs[1] ?? '') === 'login') {
        $body = Json::readBody();
        $email = trim((string)($body['email'] ?? ''));
        $pass  = (string)($body['password'] ?? '');
        if ($email === '' || $pass === '') Json::fail('Email and password required', 400);

        $user = Auth::login($email, $pass);
        if (!$user) Json::fail('Invalid credentials', 401);

        $token = Auth::issueToken($user['id'], $user['email']);
        Json::send(['token' => $token, 'user' => $user]);
    }

    // /api/auth/me
    if ($method === 'GET' && ($segs[1] ?? '') === 'me') {
        $claims = Auth::require();
        $u = Db::pdo()->prepare('SELECT id, email, display_name, created_at FROM admin_users WHERE id = ?');
        $u->execute([$claims['sub']]);
        $row = $u->fetch();
        if (!$row) Json::fail('Unauthorized', 401);
        Json::send(['user' => $row]);
    }

    // /api/auth/change-password
    if ($method === 'POST' && ($segs[1] ?? '') === 'change-password') {
        $claims = Auth::require();
        $body = Json::readBody();
        $current = (string)($body['current_password'] ?? '');
        $new     = (string)($body['new_password'] ?? '');
        if (strlen($new) < 8) Json::fail('New password must be at least 8 chars', 400);

        $u = Db::pdo()->prepare('SELECT password_hash FROM admin_users WHERE id = ?');
        $u->execute([$claims['sub']]);
        $row = $u->fetch();
        if (!$row || !password_verify($current, $row['password_hash'])) Json::fail('Current password incorrect', 400);

        $upd = Db::pdo()->prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?');
        $upd->execute([password_hash($new, PASSWORD_BCRYPT), $claims['sub']]);
        Json::send(['ok' => true]);
    }

    Json::fail('Not found', 404);
};
