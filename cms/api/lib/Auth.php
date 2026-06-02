<?php
declare(strict_types=1);

namespace BRS;

/**
 * Minimal HS256 JWT — no external deps. Token = base64url(header).base64url(payload).base64url(sig).
 */
final class Auth
{
    private static function b64url(string $bin): string
    {
        return rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');
    }

    private static function b64urlDecode(string $s): string
    {
        $pad = strlen($s) % 4;
        if ($pad) $s .= str_repeat('=', 4 - $pad);
        return base64_decode(strtr($s, '-_', '+/')) ?: '';
    }

    public static function issueToken(int $userId, string $email): string
    {
        $cfg     = $GLOBALS['BRS_CONFIG'];
        $secret  = $cfg['jwt_secret'];
        $now     = time();

        $header  = self::b64url(json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
        $payload = self::b64url(json_encode([
            'sub'   => $userId,
            'email' => $email,
            'iat'   => $now,
            'exp'   => $now + (int)$cfg['jwt_ttl'],
        ]));
        $sig     = self::b64url(hash_hmac('sha256', "$header.$payload", $secret, true));
        return "$header.$payload.$sig";
    }

    public static function verifyToken(string $token): ?array
    {
        $parts = explode('.', $token);
        if (count($parts) !== 3) return null;

        [$h, $p, $s] = $parts;
        $secret   = $GLOBALS['BRS_CONFIG']['jwt_secret'];
        $expected = self::b64url(hash_hmac('sha256', "$h.$p", $secret, true));
        if (!hash_equals($expected, $s)) return null;

        $payload = json_decode(self::b64urlDecode($p), true);
        if (!is_array($payload)) return null;
        if (!isset($payload['exp']) || $payload['exp'] < time()) return null;
        return $payload;
    }

    /** Require a valid JWT in Authorization: Bearer <token>. Exits 401 on failure. Returns claims. */
    public static function require(): array
    {
        $hdr = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
        if (!$hdr && function_exists('apache_request_headers')) {
            $h = apache_request_headers();
            $hdr = $h['Authorization'] ?? $h['authorization'] ?? '';
        }
        if (!preg_match('/^Bearer\s+(.+)$/i', $hdr, $m)) {
            Json::fail('Unauthorized', 401);
        }
        $claims = self::verifyToken(trim($m[1]));
        if (!$claims) Json::fail('Unauthorized', 401);
        return $claims;
    }

    public static function login(string $email, string $password): ?array
    {
        $u = Db::pdo()->prepare('SELECT id, email, password_hash, display_name FROM admin_users WHERE email = ? LIMIT 1');
        $u->execute([$email]);
        $row = $u->fetch();
        if (!$row || !password_verify($password, $row['password_hash'])) return null;
        return [
            'id'           => (int)$row['id'],
            'email'        => $row['email'],
            'display_name' => $row['display_name'],
        ];
    }
}
