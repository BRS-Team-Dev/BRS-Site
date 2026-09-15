<?php
declare(strict_types=1);

use BRS\Auth;
use BRS\Db;
use BRS\Json;
use BRS\Tenant;

/*
 * Email provider config + purpose routing per tenant.
 *
 *   GET    /api/email/providers                list configured providers (secrets masked)
 *   POST   /api/email/providers                create
 *   GET    /api/email/providers/:id            read (secrets masked)
 *   PUT    /api/email/providers/:id            update (only fields sent are touched;
 *                                              blank credential fields keep their prior value)
 *   DELETE /api/email/providers/:id            delete
 *   POST   /api/email/providers/:id/test       send a test email and record the result
 *
 *   GET    /api/email/routing                  purpose → provider map
 *   PUT    /api/email/routing                  { newsletter?: id, system?: id, invite?: id, internal?: id }
 *
 * Secrets (api_key / api_secret / smtp_password) are NEVER returned to the
 * frontend. Each response includes {has_api_key: bool, has_smtp_password: bool, …}
 * so the UI can render "•••• (set)" vs "not set". To update a credential,
 * send the new value; to leave it alone, omit the field or send an empty string.
 */

return function (string $method, array $segs): void {
    Auth::require();
    $pdo    = Db::tpdo();
    $tenant = Tenant::id();

    $allowedProviders = ['postmark','resend','sendgrid','ses','mailgun','brevo','smtp'];
    $allowedPurposes  = ['newsletter','system','invite','internal'];

    // Mask secrets on the way out — replace stored value with a boolean
    // flag so the frontend can render "set" vs "not set" without ever
    // seeing the raw credential.
    $mask = static function (array $row): array {
        $row['has_api_key']       = !empty($row['api_key']);
        $row['has_api_secret']    = !empty($row['api_secret']);
        $row['has_smtp_password'] = !empty($row['smtp_password']);
        unset($row['api_key'], $row['api_secret'], $row['smtp_password']);
        return $row;
    };

    // ── /api/email/providers[/:id] ─────────────────────────────
    if (($segs[1] ?? '') === 'providers') {
        $id = isset($segs[2]) ? (int)$segs[2] : 0;

        // /providers (collection)
        if ($id === 0) {
            if ($method === 'GET') {
                $rows = $pdo->query('SELECT * FROM email_providers ORDER BY id')->fetchAll();
                Json::send(['providers' => array_map($mask, $rows)]);
            }
            if ($method === 'POST') {
                $body = Json::readBody();
                $prov = (string)($body['provider'] ?? '');
                if (!in_array($prov, $allowedProviders, true)) Json::fail('Invalid provider', 400);
                $name = trim((string)($body['name'] ?? ''));
                if ($name === '') Json::fail('Name is required', 400);
                $fromEmail = trim((string)($body['from_email'] ?? ''));
                if (!filter_var($fromEmail, FILTER_VALIDATE_EMAIL)) Json::fail('Valid from_email required', 400);

                $ins = Db::pdo()->prepare(
                    'INSERT INTO email_providers
                        (tenant_id, provider, name, is_active,
                         from_email, from_name, reply_to,
                         api_key, api_secret, aws_region, mailgun_domain,
                         smtp_host, smtp_port, smtp_user, smtp_password, smtp_encryption)
                     VALUES (?,?,?,?, ?,?,?, ?,?,?,?, ?,?,?,?,?)'
                );
                $ins->execute([
                    $tenant, $prov, $name,
                    !empty($body['is_active']) ? 1 : 0,
                    $fromEmail,
                    trim((string)($body['from_name'] ?? '')) ?: null,
                    trim((string)($body['reply_to'] ?? '')) ?: null,
                    !empty($body['api_key'])    ? (string)$body['api_key']    : null,
                    !empty($body['api_secret']) ? (string)$body['api_secret'] : null,
                    trim((string)($body['aws_region'] ?? '')) ?: null,
                    trim((string)($body['mailgun_domain'] ?? '')) ?: null,
                    trim((string)($body['smtp_host'] ?? '')) ?: null,
                    !empty($body['smtp_port']) ? (int)$body['smtp_port'] : null,
                    trim((string)($body['smtp_user'] ?? '')) ?: null,
                    !empty($body['smtp_password']) ? (string)$body['smtp_password'] : null,
                    in_array(($body['smtp_encryption'] ?? 'tls'), ['none','tls','ssl'], true)
                        ? $body['smtp_encryption'] : 'tls',
                ]);
                Json::send(['id' => (int)Db::pdo()->lastInsertId()], 201);
            }
            Json::fail('Method not allowed', 405);
        }

        // /providers/:id[/test]
        $sel = $pdo->prepare('SELECT * FROM email_providers WHERE id = ?');
        $sel->execute([$id]);
        $row = $sel->fetch();
        if (!$row) Json::fail('Provider not found', 404);

        // Test-send endpoint — attempts a real send using the stored
        // credentials and records the outcome on the provider row so
        // the UI can show a status pill.
        if (($segs[3] ?? '') === 'test' && $method === 'POST') {
            $body = Json::readBody();
            $to   = trim((string)($body['to'] ?? ''));
            if (!filter_var($to, FILTER_VALIDATE_EMAIL)) Json::fail('Valid "to" address required', 400);

            [$ok, $errMsg] = (require __DIR__ . '/../lib/EmailDispatcher.php')($row, [
                'to'      => $to,
                'subject' => 'BuiltRightStudio — test email (' . $row['name'] . ')',
                'html'    => '<p>This is a test email sent from the <strong>' . htmlspecialchars((string)$row['name']) . '</strong> provider config.</p>'
                           . '<p>If you\'re seeing this, your credentials are working.</p>',
                'text'    => "This is a test email sent from the " . $row['name'] . " provider config.\n\nIf you're seeing this, your credentials are working.",
            ]);
            $pdo->prepare('UPDATE email_providers SET last_test_at = NOW(), last_test_ok = ?, last_test_error = ? WHERE id = ?')
                ->execute([$ok ? 1 : 0, $ok ? null : $errMsg, $id]);
            if ($ok) Json::send(['ok' => true, 'sent_to' => $to]);
            Json::fail($errMsg ?: 'Test send failed', 500);
        }

        if ($method === 'GET') Json::send(['provider' => $mask($row)]);

        if ($method === 'PUT') {
            $body = Json::readBody();
            $fields = []; $params = [];
            $set = static function (string $col, $val) use (&$fields, &$params) {
                $fields[] = "$col = ?"; $params[] = $val;
            };
            if (array_key_exists('name', $body)) {
                $n = trim((string)$body['name']);
                if ($n === '') Json::fail('Name cannot be empty', 400);
                $set('name', $n);
            }
            if (array_key_exists('is_active', $body))    $set('is_active', !empty($body['is_active']) ? 1 : 0);
            if (array_key_exists('from_email', $body)) {
                $fe = trim((string)$body['from_email']);
                if (!filter_var($fe, FILTER_VALIDATE_EMAIL)) Json::fail('Invalid from_email', 400);
                $set('from_email', $fe);
            }
            if (array_key_exists('from_name', $body))       $set('from_name',       trim((string)$body['from_name']) ?: null);
            if (array_key_exists('reply_to', $body))        $set('reply_to',        trim((string)$body['reply_to']) ?: null);
            // Credential fields — only overwrite if a non-empty value came in.
            // Empty string keeps the stored value. Explicit null clears it.
            if (array_key_exists('api_key',    $body)) {
                if ($body['api_key']    === null)     $set('api_key',    null);
                elseif ($body['api_key']    !== '')   $set('api_key',    (string)$body['api_key']);
            }
            if (array_key_exists('api_secret', $body)) {
                if ($body['api_secret'] === null)     $set('api_secret', null);
                elseif ($body['api_secret'] !== '')   $set('api_secret', (string)$body['api_secret']);
            }
            if (array_key_exists('aws_region', $body))      $set('aws_region',      trim((string)$body['aws_region']) ?: null);
            if (array_key_exists('mailgun_domain', $body))  $set('mailgun_domain',  trim((string)$body['mailgun_domain']) ?: null);
            if (array_key_exists('smtp_host', $body))       $set('smtp_host',       trim((string)$body['smtp_host']) ?: null);
            if (array_key_exists('smtp_port', $body))       $set('smtp_port',       !empty($body['smtp_port']) ? (int)$body['smtp_port'] : null);
            if (array_key_exists('smtp_user', $body))       $set('smtp_user',       trim((string)$body['smtp_user']) ?: null);
            if (array_key_exists('smtp_password', $body)) {
                if ($body['smtp_password'] === null)  $set('smtp_password', null);
                elseif ($body['smtp_password'] !== '') $set('smtp_password', (string)$body['smtp_password']);
            }
            if (array_key_exists('smtp_encryption', $body) && in_array($body['smtp_encryption'], ['none','tls','ssl'], true)) {
                $set('smtp_encryption', $body['smtp_encryption']);
            }

            if ($fields) {
                $params[] = $id;
                $pdo->prepare('UPDATE email_providers SET ' . implode(', ', $fields) . ' WHERE id = ?')
                    ->execute($params);
            }
            Json::send(['ok' => true]);
        }

        if ($method === 'DELETE') {
            $pdo->prepare('DELETE FROM email_providers WHERE id = ?')->execute([$id]);
            Json::send(['ok' => true]);
        }

        Json::fail('Method not allowed', 405);
    }

    // ── /api/email/system ──────────────────────────────────────
    // Returns whether the server-level SMTP fallback is enabled AND
    // the current tenant's grace-window state. The frontend uses
    // these together to render an escalating banner in Settings →
    // Email so tenants know when they must configure their own
    // provider before deliveries stop.
    if (($segs[1] ?? '') === 'system' && $method === 'GET') {
        $enabled   = \BRS\Mailer::systemFallbackEnabled();
        $daysLeft  = $enabled ? \BRS\Mailer::tenantGraceDaysLeft() : null;
        $inGrace   = $enabled && \BRS\Mailer::tenantInGrace();
        Json::send([
            'system_fallback_enabled' => $enabled,
            'grace_days_left'         => $daysLeft,
            'in_grace'                => $inGrace,
            'expired'                 => $enabled && !$inGrace,
        ]);
    }

    // ── /api/email/routing ─────────────────────────────────────
    if (($segs[1] ?? '') === 'routing') {
        if ($method === 'GET') {
            $rows = $pdo->query('SELECT purpose, provider_id FROM email_routing')->fetchAll();
            $map  = ['newsletter' => null, 'system' => null, 'invite' => null, 'internal' => null];
            foreach ($rows as $r) { $map[$r['purpose']] = $r['provider_id'] !== null ? (int)$r['provider_id'] : null; }
            Json::send(['routing' => $map]);
        }
        if ($method === 'PUT') {
            $body = Json::readBody();
            foreach ($allowedPurposes as $p) {
                if (!array_key_exists($p, $body)) continue;
                $pid = $body[$p] !== null && $body[$p] !== '' ? (int)$body[$p] : null;
                // Validate the provider belongs to this tenant.
                if ($pid !== null) {
                    $ok = $pdo->prepare('SELECT id FROM email_providers WHERE id = ?');
                    $ok->execute([$pid]);
                    if (!$ok->fetch()) Json::fail("Provider $pid not found for purpose '$p'", 400);
                }
                Db::pdo()->prepare(
                    'INSERT INTO email_routing (tenant_id, purpose, provider_id)
                          VALUES (?, ?, ?)
                     ON DUPLICATE KEY UPDATE provider_id = VALUES(provider_id)'
                )->execute([$tenant, $p, $pid]);
            }
            Json::send(['ok' => true]);
        }
        Json::fail('Method not allowed', 405);
    }

    Json::fail('Not found', 404);
};
