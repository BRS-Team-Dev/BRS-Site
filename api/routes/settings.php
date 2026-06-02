<?php
declare(strict_types=1);

use BRS\Auth;
use BRS\Db;
use BRS\Json;
use BRS\Mailer;

return function (string $method, array $segs): void {
    Auth::require();
    $pdo = Db::pdo();

    // /api/settings/test-mail
    if (($segs[1] ?? '') === 'test-mail' && $method === 'POST') {
        $body = Json::readBody();
        $to = trim((string)($body['to'] ?? ''));
        if (!filter_var($to, FILTER_VALIDATE_EMAIL)) Json::fail('Valid recipient email required', 400);
        [$ok, $err] = Mailer::send($to, 'BuiltRightStudio test email', '<p>Hello from BuiltRightStudio CMS — SMTP works.</p>');
        Json::send(['ok' => $ok, 'error' => $err]);
    }

    // Settings keys treated as secrets — masked on read, ignored on write
    // when the caller sends back the masked placeholder unchanged.
    $isSecret = static fn(string $k): bool =>
        $k === 'smtp_pass' || str_ends_with($k, '_api_key') || str_ends_with($k, '_secret');
    $maskedPlaceholder = '••••••••';

    if (!isset($segs[1])) {
        if ($method === 'GET') {
            $rows = $pdo->query('SELECT k, v FROM settings')->fetchAll();
            $out = [];
            foreach ($rows as $r) {
                $out[$r['k']] = $isSecret($r['k']) && $r['v'] !== '' ? $maskedPlaceholder : $r['v'];
            }
            Json::send(['settings' => $out]);
        }
        if ($method === 'PUT') {
            $body = Json::readBody();
            if (!is_array($body)) Json::fail('Invalid body', 400);
            $up = $pdo->prepare('INSERT INTO settings (k,v) VALUES (?,?) ON DUPLICATE KEY UPDATE v = VALUES(v)');
            foreach ($body as $k => $v) {
                if (!is_string($k) || !preg_match('/^[a-z_][a-z0-9_]{0,79}$/', $k)) continue;
                // Don't overwrite secrets with the masked placeholder
                if ($isSecret($k) && $v === $maskedPlaceholder) continue;
                $up->execute([$k, is_scalar($v) ? (string)$v : json_encode($v)]);
            }
            Json::send(['ok' => true]);
        }
        Json::fail('Method not allowed', 405);
    }
    Json::fail('Not found', 404);
};
