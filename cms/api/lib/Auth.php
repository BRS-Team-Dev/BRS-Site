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

    /** Issue a JWT bearing the calling user's identity AND tenant context.
     *
     *  Claims:
     *    sub       — admin_users.id within the tenant
     *    email     — caller's email (used by audit logging)
     *    tenant_id — id of the tenant whose data this token can read/write
     *    super     — true when this caller is a super-admin (set by login
     *                when the email lives in super_admins)
     *    iat / exp — issue + expiry timestamps
     *
     *  When MULTI_TENANT is off (single-tenant legacy mode), tenant_id is
     *  set to 1 (the BRS tenant — backfilled by migration 100) and super
     *  is false. Existing tokens issued before this rollout are still
     *  accepted by verifyToken() but will not carry tenant_id; the
     *  middleware in {@see self::require()} falls back to 1 for those. */
    public static function issueToken(int $userId, string $email, int $tenantId = 1, bool $super = false, ?array $impersonating = null): string
    {
        $cfg     = $GLOBALS['BRS_CONFIG'];
        $secret  = $cfg['jwt_secret'];
        $now     = time();

        $claims = [
            'sub'       => $userId,
            'email'     => $email,
            'tenant_id' => $tenantId,
            'super'     => $super,
            'iat'       => $now,
            'exp'       => $now + (int)$cfg['jwt_ttl'],
        ];
        // Impersonation metadata baked into the JWT so the frontend can
        // detect it from the decoded claims — response body alone isn't
        // enough because a page refresh only has the stored token.
        if ($impersonating) $claims['impersonating'] = $impersonating;

        $header  = self::b64url(json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
        $payload = self::b64url(json_encode($claims));
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

    /** Require a valid JWT in Authorization: Bearer <token>. Sets the
     *  per-request {@see Tenant} context as a side effect so subsequent
     *  query helpers can read Tenant::id().
     *
     *  Returns the claim array (legacy callers that read $claims['sub']
     *  directly keep working). Exits 401 on:
     *    - missing / malformed Authorization header
     *    - signature check failure or expired token
     *    - tenant suspended / soft-deleted (kill-set hit) — propagates
     *      instantly because the kill-set has no TTL, only explicit
     *      invalidation by the super-admin actions in {@see Tenants}.
     */
    /** Refuse the request if the caller is a contractor. Called from every
     *  admin/HR/CRM route — contractors only have access to /api/contractor/*
     *  and /api/auth/*. Cheap DB round-trip; APCu-cached below.
     */
    public static function requireNonContractor(array $claims): void
    {
        $uid = (int)($claims['sub'] ?? 0);
        if ($uid <= 0) return;
        $key = 'brs.role.' . $uid;
        if (function_exists('apcu_fetch')) {
            $hit = apcu_fetch($key, $ok);
            if ($ok) {
                if ($hit === 'contractor') Json::fail('Forbidden', 403);
                return;
            }
        }
        $q = Db::pdo()->prepare('SELECT role FROM admin_users WHERE id = ? LIMIT 1');
        $q->execute([$uid]);
        $role = (string)$q->fetchColumn();
        if (function_exists('apcu_store')) apcu_store($key, $role, 60);
        if ($role === 'contractor') Json::fail('Forbidden', 403);
    }

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

        // Fall back to tenant 1 (BRS) for tokens issued before the
        // multi-tenant rollout. Once everyone has re-logged in, every
        // token carries an explicit tenant_id.
        $tenantId = isset($claims['tenant_id']) ? (int)$claims['tenant_id'] : 1;

        // Kill-set check — the entire reason suspension is instant.
        if (Tenants::isKilled($tenantId)) {
            Json::fail('Tenant suspended', 403);
        }

        Tenant::set(
            $tenantId,
            (int)($claims['sub'] ?? 0),
            (string)($claims['email'] ?? ''),
            !empty($claims['super'])
        );

        return $claims;
    }

    /** Authenticate a user by email + password.
     *
     *  Multi-tenant flow:
     *    1. Extract email domain (the part after '@')
     *    2. Look up tenant_email_domains in the registry → tenant_id
     *    3. Refuse if no domain mapping or tenant is suspended/deleted
     *    4. Query admin_users WHERE email = ? AND tenant_id = ?
     *    5. password_verify; if pass, decorate the return with
     *       tenant_id + super flag so the caller in routes/auth.php
     *       can pass them into issueToken()
     *
     *  Returns null for any failure path (caller surfaces a deliberately
     *  vague 401 — leaking whether the email or domain was wrong helps
     *  enumeration attacks).
     *
     *  Pre-multi-tenant tokens / direct seed-script use without a domain
     *  match fall back to tenant 1. New deployments will eventually
     *  remove this fallback once every admin has rotated their token.
     */
    public static function login(string $email, string $password): ?array
    {
        $email = strtolower(trim($email));
        if ($email === '' || $password === '') return null;

        // Step 1-3: resolve email domain → tenant.
        // Contractors and other externally-invited users won't have an
        // email whose domain matches any tenant_email_domains row. In
        // that case fall back to a direct admin_users lookup: if the
        // email exists in exactly one tenant, use that tenant. Same
        // email registered against two tenants stays ambiguous and we
        // refuse rather than pick one.
        $tenantId = Tenants::resolveByEmail($email);
        if ($tenantId === null) {
            $probe = Db::pdo()->prepare(
                'SELECT tenant_id FROM admin_users WHERE email = ? AND is_active = 1 LIMIT 2'
            );
            $probe->execute([$email]);
            $matches = $probe->fetchAll(\PDO::FETCH_COLUMN, 0);
            if (count($matches) === 1) $tenantId = (int)$matches[0];
        }
        if ($tenantId === null) return null;
        if (Tenants::isKilled($tenantId)) return null;

        // Step 4-5: authenticate against admin_users for that tenant
        $u = Db::pdo()->prepare(
            'SELECT id, email, password_hash, display_name, role, color_theme, must_change_password
               FROM admin_users
              WHERE email = ? AND tenant_id = ?
              LIMIT 1'
        );
        $u->execute([$email, $tenantId]);
        $row = $u->fetch();
        if (!$row || !password_verify($password, $row['password_hash'])) return null;

        return [
            'id'                    => (int)$row['id'],
            'email'                 => $row['email'],
            'display_name'          => $row['display_name'],
            'role'                  => $row['role'],
            'color_theme'           => $row['color_theme'],   // per-user override or NULL → tenant default
            'tenant_id'             => $tenantId,
            'super'                 => Tenants::isSuperAdmin($email),
            'must_change_password'  => (bool)$row['must_change_password'],
        ];
    }
}
