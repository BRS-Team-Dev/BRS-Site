<?php
declare(strict_types=1);

use BRS\Auth;
use BRS\Db;
use BRS\Json;
use BRS\Mailer;

return function (string $method, array $segs): void {
    // /api/auth/login
    if ($method === 'POST' && ($segs[1] ?? '') === 'login') {
        $body = Json::readBody();
        $email = trim((string)($body['email'] ?? ''));
        $pass  = (string)($body['password'] ?? '');
        if ($email === '' || $pass === '') Json::fail('Email and password required', 400);

        $user = Auth::login($email, $pass);
        if (!$user) Json::fail('Invalid credentials', 401);

        // Bake tenant_id + super into the JWT so every authenticated
        // request after this can read them without re-querying the
        // registry. Auth::login() resolved the tenant via the email
        // domain; we just pass that through.
        $token = Auth::issueToken(
            (int)$user['id'],
            $user['email'],
            (int)$user['tenant_id'],
            !empty($user['super'])
        );
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

    // /api/auth/forgot-password — public; always returns { ok: true } so we
    // don't leak whether an email exists.
    if ($method === 'POST' && ($segs[1] ?? '') === 'forgot-password') {
        $body  = Json::readBody();
        $email = trim((string)($body['email'] ?? ''));
        if ($email === '') Json::fail('Email required', 400);

        $cfg = $GLOBALS['BRS_CONFIG'] ?? [];

        $u = Db::pdo()->prepare('SELECT id, email, display_name FROM admin_users WHERE email = ? AND is_active = 1');
        $u->execute([$email]);
        $user = $u->fetch();

        if ($user) {
            // Invalidate any outstanding reset requests for this user (defense in depth).
            $inv = Db::pdo()->prepare('UPDATE password_resets SET used_at = NOW() WHERE admin_user_id = ? AND used_at IS NULL AND expires_at > NOW()');
            $inv->execute([$user['id']]);

            // Plaintext token in the URL; we only ever store sha256(token) in DB.
            $token = bin2hex(random_bytes(32));   // 64 hex chars
            $hash  = hash('sha256', $token);

            $ins = Db::pdo()->prepare('INSERT INTO password_resets (admin_user_id, token_hash, expires_at, created_ip) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 60 MINUTE), ?)');
            $ins->execute([$user['id'], $hash, $_SERVER['REMOTE_ADDR'] ?? null]);

            $base = rtrim((string)($cfg['base_url'] ?? ''), '/');
            $url  = $base . '/reset-password?token=' . $token;

            $name    = $user['display_name'] ?: 'there';
            $subject = 'Reset your BuiltRightStudio CMS password';
            $html    = '<p>Hi ' . htmlspecialchars($name, ENT_QUOTES) . ',</p>'
                     . '<p>We received a request to reset your password. The link below is valid for 60 minutes:</p>'
                     . '<p><a href="' . htmlspecialchars($url, ENT_QUOTES) . '">Set a new password</a></p>'
                     . '<p>If you didn\'t request this, ignore this email — your password will not be changed.</p>';

            // Best-effort send. If SMTP isn't configured, the request still
            // succeeds silently to avoid leaking system state. Log for diag.
            if (Mailer::isConfigured()) {
                [$ok, $err] = Mailer::send($user['email'], $subject, $html);
                if (!$ok) error_log('[forgot-password] mail failed for ' . $user['email'] . ': ' . (string)$err);
            } else {
                error_log('[forgot-password] SMTP not configured; would send reset URL: ' . $url);
            }
        }

        Json::send(['ok' => true]);
    }

    // /api/auth/reset-password — public; redeems a token + sets the new password.
    if ($method === 'POST' && ($segs[1] ?? '') === 'reset-password') {
        $body  = Json::readBody();
        $token = (string)($body['token'] ?? '');
        $new   = (string)($body['new_password'] ?? '');

        if ($token === '' || !preg_match('/^[a-f0-9]{64}$/', $token)) Json::fail('Invalid or expired link', 400);
        if (strlen($new) < 8) Json::fail('New password must be at least 8 chars', 400);

        $hash = hash('sha256', $token);
        $sel  = Db::pdo()->prepare('SELECT id, admin_user_id FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()');
        $sel->execute([$hash]);
        $row = $sel->fetch();
        if (!$row) Json::fail('Invalid or expired link', 400);

        $pdo = Db::pdo();
        $pdo->beginTransaction();
        try {
            $upd1 = $pdo->prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?');
            $upd1->execute([password_hash($new, PASSWORD_BCRYPT), $row['admin_user_id']]);

            $upd2 = $pdo->prepare('UPDATE password_resets SET used_at = NOW() WHERE id = ?');
            $upd2->execute([$row['id']]);

            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            error_log('[reset-password] ' . $e->getMessage());
            Json::fail('Could not reset password', 500);
        }

        Json::send(['ok' => true]);
    }

    Json::fail('Not found', 404);
};
