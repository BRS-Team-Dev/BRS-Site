<?php
declare(strict_types=1);

namespace BRS;

/**
 * Microsoft Graph client — narrow surface, just what LeadBookingNotifier
 * needs to auto-create a Teams meeting per booking.
 *
 * Configured via `settings.teams_*`:
 *   - teams_tenant_id
 *   - teams_client_id
 *   - teams_client_secret
 *   - teams_organizer_email
 *
 * Auth: OAuth 2.0 client-credentials flow — the app authenticates as
 * ITSELF (not on behalf of a user), which is why the Azure permission
 * MUST be `OnlineMeetings.ReadWrite.All` at *Application* level with
 * admin consent granted. See docs/teams-meeting-setup.md.
 *
 * ★ TEAMS APPLICATION ACCESS POLICY: even after the app has the Graph
 * permission, Teams itself refuses meeting creation on a user's behalf
 * until an Application Access Policy is assigned. If Graph returns 403
 * on the first meeting create, that is the almost-certain cause — the
 * error string here is preserved end-to-end so the operator sees it.
 * See the setup doc for the Teams PowerShell one-liner.
 */
final class MsGraph
{
    /** In-memory token cache for this request. Multiple bookings in the
     *  same request (rare) share one token. Not persisted across requests
     *  yet — worth adding if we start creating dozens of meetings a day. */
    private static ?array $token = null;

    /** Cache email → ObjectId resolutions for this request. Graph's
     *  /users/{id}/onlineMeetings endpoint requires the user's ObjectId
     *  GUID, not the UPN — a UPN there returns "not a valid GUID". */
    private static array $userIdCache = [];

    /**
     * True when all four settings are present. Callers use this as a
     * feature flag to know whether to attempt meeting creation.
     */
    public static function isConfigured(): bool
    {
        $c = self::config();
        return $c['tenant_id'] !== ''
            && $c['client_id'] !== ''
            && $c['client_secret'] !== ''
            && $c['organizer_email'] !== '';
    }

    /**
     * Send an email via `POST /users/{sender}/sendMail`. Sender is the
     * configured Teams organiser mailbox — reusing that mailbox keeps the
     * Azure app to a single "acts as this one user" surface rather than
     * spreading across the tenant.
     *
     * Requires the Azure app to have Application permission
     * `Mail.Send` (admin-consented). Returns void on success, throws
     * on failure. The notifier catches and logs so an email failure
     * cannot fail the booking.
     */
    public static function sendMail(string $to, string $subject, string $htmlBody): void
    {
        $c = self::config();
        if (!self::isConfigured()) throw new \RuntimeException('Teams integration not configured');

        $token  = self::getToken($c);
        $sender = rawurlencode($c['organizer_email']);
        $url    = "https://graph.microsoft.com/v1.0/users/{$sender}/sendMail";

        $body = [
            'message' => [
                'subject' => $subject,
                'body'    => [ 'contentType' => 'HTML', 'content' => $htmlBody ],
                'toRecipients' => [
                    [ 'emailAddress' => [ 'address' => $to ] ],
                ],
            ],
            'saveToSentItems' => true,
        ];

        [$status, $resp] = self::httpJson('POST', $url, $body, [
            'Authorization: Bearer ' . $token,
            'Content-Type: application/json',
        ]);
        // sendMail returns 202 Accepted (empty body) on success.
        if ($status !== 202 && $status !== 200) {
            $err = is_array($resp) && isset($resp['error']['message'])
                ? $resp['error']['message']
                : 'HTTP ' . $status;
            $code = is_array($resp) && isset($resp['error']['code'])
                ? $resp['error']['code']
                : null;
            $hint = '';
            if ($status === 403) {
                $hint = ' — probable cause: the Azure app is missing the Mail.Send application permission (or admin consent has not been granted). See docs/teams-meeting-setup.md.';
            }
            throw new \RuntimeException('Graph sendMail failed: ' . $err . ($code ? " ({$code})" : '') . $hint);
        }
    }

    /**
     * Create a Teams online meeting on the configured organiser's
     * calendar. Returns [id, joinUrl] on success, or throws on failure.
     * Callers (the notifier) should try/catch and swallow — a missing
     * Teams meeting must not fail the booking.
     */
    public static function createOnlineMeeting(string $subject, \DateTimeImmutable $start, int $durationMinutes): array
    {
        $c = self::config();
        if (!self::isConfigured()) throw new \RuntimeException('Teams integration not configured');

        $token = self::getToken($c);
        $end   = $start->modify('+' . max(5, $durationMinutes) . ' minutes');

        $body = [
            'subject'       => $subject,
            'startDateTime' => $start->format('c'),
            'endDateTime'   => $end->format('c'),
        ];

        // /users/{id}/onlineMeetings needs the ObjectId GUID, not the UPN
        // (unlike /users/{upn}/sendMail which accepts either).
        $organizerId = self::resolveUserId($c['organizer_email'], $token);
        $url = "https://graph.microsoft.com/v1.0/users/{$organizerId}/onlineMeetings";

        [$status, $resp] = self::httpJson('POST', $url, $body, [
            'Authorization: Bearer ' . $token,
            'Content-Type: application/json',
        ]);

        if ($status !== 201 && $status !== 200) {
            $err = is_array($resp) && isset($resp['error']['message'])
                ? $resp['error']['message']
                : 'HTTP ' . $status;
            $code = is_array($resp) && isset($resp['error']['code'])
                ? $resp['error']['code']
                : null;
            $hint = '';
            if ($status === 403) {
                $hint = ' — probable cause: no Application Access Policy in Teams. '
                      . 'Run Grant-CsApplicationAccessPolicy for the organiser (see docs/teams-meeting-setup.md).';
            }
            throw new \RuntimeException('Graph createOnlineMeeting failed: ' . $err . ($code ? " ({$code})" : '') . $hint);
        }

        $joinUrl = (string)($resp['joinUrl'] ?? $resp['joinWebUrl'] ?? '');
        $id      = (string)($resp['id'] ?? '');
        if ($joinUrl === '') throw new \RuntimeException('Graph returned no joinUrl in response');
        return [$id, $joinUrl];
    }

    // ── internals ────────────────────────────────────────────────────

    private static function config(): array
    {
        $pdo = Db::tpdo();
        $q = $pdo->prepare("SELECT k, v FROM settings WHERE k IN
            ('teams_tenant_id','teams_client_id','teams_client_secret','teams_organizer_email')");
        $q->execute();
        $out = ['tenant_id' => '', 'client_id' => '', 'client_secret' => '', 'organizer_email' => ''];
        foreach ($q->fetchAll(\PDO::FETCH_ASSOC) as $r) {
            switch ($r['k']) {
                case 'teams_tenant_id':       $out['tenant_id']       = trim((string)$r['v']); break;
                case 'teams_client_id':       $out['client_id']       = trim((string)$r['v']); break;
                case 'teams_client_secret':   $out['client_secret']   = trim((string)$r['v']); break;
                case 'teams_organizer_email': $out['organizer_email'] = trim((string)$r['v']); break;
            }
        }
        return $out;
    }

    /**
     * Resolve a user's UPN / email to their ObjectId (a GUID). The
     * organizer setting accepts either — if it already looks like a
     * GUID, use it directly and skip the lookup (which needs the extra
     * User.Read.All Graph permission we don't necessarily want to ask
     * for). Cached per-request.
     */
    private static function resolveUserId(string $upnOrId, string $token): string
    {
        if (preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $upnOrId)) {
            return $upnOrId;
        }
        if (isset(self::$userIdCache[$upnOrId])) return self::$userIdCache[$upnOrId];

        $url = 'https://graph.microsoft.com/v1.0/users/' . rawurlencode($upnOrId) . '?$select=id';
        [$status, $resp] = self::curl('GET', $url, '', [
            'Authorization: Bearer ' . $token,
            'Accept: application/json',
        ], /*json*/ true);

        if ($status !== 200 || empty($resp['id'])) {
            $err = is_array($resp) && isset($resp['error']['message'])
                ? $resp['error']['message']
                : ('HTTP ' . $status);
            $hint = ($status === 403)
                ? ' — paste the organiser\'s Object ID (GUID) into the Teams settings instead of the email address, OR add the User.Read.All Graph application permission with admin consent so this lookup can run.'
                : '';
            throw new \RuntimeException("Graph user lookup failed for {$upnOrId}: {$err}{$hint}");
        }
        return self::$userIdCache[$upnOrId] = (string)$resp['id'];
    }

    private static function getToken(array $c): string
    {
        if (self::$token !== null && (self::$token['expires_at'] ?? 0) > time() + 30) {
            return self::$token['access_token'];
        }
        $url = 'https://login.microsoftonline.com/' . rawurlencode($c['tenant_id']) . '/oauth2/v2.0/token';
        $form = http_build_query([
            'grant_type'    => 'client_credentials',
            'client_id'     => $c['client_id'],
            'client_secret' => $c['client_secret'],
            'scope'         => 'https://graph.microsoft.com/.default',
        ]);
        [$status, $resp] = self::httpForm($url, $form);
        if ($status !== 200 || !isset($resp['access_token'])) {
            $err = is_array($resp) && isset($resp['error_description'])
                ? $resp['error_description']
                : ('HTTP ' . $status);
            throw new \RuntimeException('Graph token exchange failed: ' . $err);
        }
        self::$token = [
            'access_token' => (string)$resp['access_token'],
            'expires_at'   => time() + (int)($resp['expires_in'] ?? 3600),
        ];
        return self::$token['access_token'];
    }

    private static function httpJson(string $method, string $url, array $body, array $headers): array
    {
        return self::curl($method, $url, json_encode($body), $headers, /*json*/ true);
    }

    private static function httpForm(string $url, string $body): array
    {
        return self::curl('POST', $url, $body, ['Content-Type: application/x-www-form-urlencoded'], /*json*/ true);
    }

    private static function curl(string $method, string $url, string $body, array $headers, bool $expectJson): array
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST  => $method,
            CURLOPT_POSTFIELDS     => $body,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_TIMEOUT        => 20,
            CURLOPT_CONNECTTIMEOUT => 8,
        ]);
        $raw    = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $cerr   = curl_error($ch);
        curl_close($ch);
        if ($raw === false) {
            throw new \RuntimeException('cURL: ' . $cerr);
        }
        $resp = $expectJson ? json_decode((string)$raw, true) : $raw;
        return [$status, $resp];
    }
}
