<?php
declare(strict_types=1);

namespace BRS;

/**
 * Multi-provider mailer.
 *
 * `sendVia($purpose, ...)` is the new canonical entry point:
 *   1. Looks up email_routing for this tenant + purpose.
 *   2. If a provider is set AND active, dispatches via
 *      api/lib/EmailDispatcher.php using the provider's stored
 *      credentials (Postmark / Resend / SendGrid / SES / etc).
 *   3. Otherwise falls back to `send()` — the legacy single SMTP
 *      config stored in the `settings` table — so pre-migration
 *      code paths keep working.
 *
 * `send($to, $subject, $htmlBody)` remains for callers that don't yet
 * know which purpose they represent. It's equivalent to
 * `sendVia('system', $to, $subject, $htmlBody)`.
 *
 * Purposes:
 *   - 'newsletter' — bulk campaigns
 *   - 'system'     — password resets, verification, generic system mails
 *   - 'invite'     — onboarding portal invites (client / HR / recruitment)
 *   - 'internal'   — alerts to admin users (form-submit, task assign)
 */
final class Mailer
{
    // ─── Legacy single-SMTP config (settings table) ─────────────
    public static function settings(): array
    {
        $rows = Db::pdo()->query("SELECT k, v FROM settings WHERE k LIKE 'smtp\\_%' OR k = 'smtp_secure'")->fetchAll();
        $map  = [];
        foreach ($rows as $r) $map[$r['k']] = $r['v'];
        return $map;
    }

    /** Whether we can send at ALL — either the multi-provider routing
     *  has a working provider for this purpose, the legacy per-tenant
     *  SMTP is set, or the system SMTP fallback (env) is enabled. */
    public static function isConfigured(?string $purpose = null): bool
    {
        if ($purpose !== null && self::providerFor($purpose) !== null) return true;
        $s = self::settings();
        if (!empty($s['smtp_host']) && !empty($s['smtp_from_email'])) return true;
        return self::systemFallbackEnabled();
    }

    /** System SMTP fallback — env-var-driven. When set, unrouted +
     *  un-legacy-configured sends go through your infrastructure so
     *  fresh tenants don't silently fail. See .env.example for keys.
     *  Enabling this puts YOUR reputation on the line for those sends. */
    public static function systemFallbackEnabled(): bool
    {
        return !empty($_ENV['SYSTEM_SMTP_HOST']) && !empty($_ENV['SYSTEM_SMTP_FROM']);
    }

    /** Whether the CURRENT TENANT is still within their system-fallback
     *  grace window. Returns true when we can use the fallback for
     *  them, false once the grace date has passed (or column is NULL,
     *  which means the tenant explicitly forfeited the grace). */
    public static function tenantInGrace(): bool
    {
        try {
            $st = Db::pdo()->prepare(
                'SELECT system_fallback_grace_until FROM tenants WHERE id = ?'
            );
            $st->execute([Tenant::id()]);
            $val = $st->fetchColumn();
            if ($val === false || $val === null) return false;
            return strtotime((string)$val) >= strtotime((string)date('Y-m-d'));
        } catch (\Throwable $e) {
            return false;
        }
    }

    /** Days remaining on the grace window (0 if expired, null if never
     *  granted / no row). Used by the /email/system endpoint so the UI
     *  can render "12 days left". */
    public static function tenantGraceDaysLeft(): ?int
    {
        try {
            $st = Db::pdo()->prepare(
                'SELECT system_fallback_grace_until FROM tenants WHERE id = ?'
            );
            $st->execute([Tenant::id()]);
            $val = $st->fetchColumn();
            if ($val === false || $val === null) return null;
            $delta = (strtotime((string)$val) - strtotime((string)date('Y-m-d'))) / 86400;
            return max(0, (int)ceil($delta));
        } catch (\Throwable $e) {
            return null;
        }
    }

    /**
     * Dispatch through the routing table if the purpose has an active
     * provider; otherwise fall back to the legacy SMTP.
     *
     * @param string $purpose  one of 'newsletter'|'system'|'invite'|'internal'
     * @return array [ok, errorMessage|null]
     */
    public static function sendVia(string $purpose, string $to, string $subject, string $htmlBody, ?string $text = null): array
    {
        $provider = self::providerFor($purpose);
        if ($provider !== null) {
            $dispatch = require __DIR__ . '/EmailDispatcher.php';
            return $dispatch($provider, [
                'to'      => $to,
                'subject' => $subject,
                'html'    => $htmlBody,
                'text'    => $text ?? strip_tags($htmlBody),
            ]);
        }
        // No routing configured → legacy SMTP path.
        return self::send($to, $subject, $htmlBody);
    }

    /** Legacy single-SMTP path — kept as the fallback for `sendVia`
     *  and as-is for callers that predate multi-provider routing.
     *  When the tenant's settings SMTP is empty AND the system SMTP
     *  fallback is enabled in .env, we route through that as an
     *  absolute last-resort so fresh tenants aren't silently dropped. */
    public static function send(string $to, string $subject, string $htmlBody): array
    {
        $s = self::settings();
        $needsFallback = empty($s['smtp_host']) || empty($s['smtp_from_email']);
        $useSystem     = $needsFallback && self::systemFallbackEnabled();

        // Enforce the 30-day grace window. When the tenant's grace has
        // expired, refuse the fallback so we're not silently hosting
        // their unconfigured mail on our reputation forever.
        if ($useSystem && !self::tenantInGrace()) {
            return [false, 'System email fallback grace period has expired. '
                        . 'Configure an email provider in Settings → Email to resume sending.'];
        }
        if ($useSystem) {
            // Reuse the same PHPMailer/socket paths below, but with
            // system env creds and a tag header so the fallback is
            // visible to admins reading email headers.
            $s = [
                'smtp_host'      => (string)($_ENV['SYSTEM_SMTP_HOST'] ?? ''),
                'smtp_port'      => (string)($_ENV['SYSTEM_SMTP_PORT'] ?? '587'),
                'smtp_user'      => (string)($_ENV['SYSTEM_SMTP_USER'] ?? ''),
                'smtp_pass'      => (string)($_ENV['SYSTEM_SMTP_PASS'] ?? ''),
                'smtp_secure'    => (string)($_ENV['SYSTEM_SMTP_ENC']  ?? 'tls'),
                'smtp_from_email'=> (string)($_ENV['SYSTEM_SMTP_FROM'] ?? ''),
                'smtp_from_name' => (string)($_ENV['SYSTEM_SMTP_FROM_NAME'] ?? 'BuiltRightStudio'),
            ];
            // Tag the outbound body so downstream systems / logs can
            // identify fallback deliveries at a glance.
            error_log("[Mailer] using SYSTEM SMTP fallback for tenant $to subject={$subject}");
        }
        if (empty($s['smtp_host']) || empty($s['smtp_from_email'])) {
            return [false, 'No email provider configured for this tenant'];
        }
        if (class_exists(\PHPMailer\PHPMailer\PHPMailer::class)) {
            try {
                $m = new \PHPMailer\PHPMailer\PHPMailer(true);
                $m->isSMTP();
                $m->Host = $s['smtp_host'] ?? '';
                $m->Port = (int)($s['smtp_port'] ?? 587);
                if (!empty($s['smtp_user'])) {
                    $m->SMTPAuth = true;
                    $m->Username = $s['smtp_user'];
                    $m->Password = $s['smtp_pass'] ?? '';
                }
                $sec = $s['smtp_secure'] ?? 'tls';
                if ($sec === 'tls') $m->SMTPSecure = \PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_STARTTLS;
                elseif ($sec === 'ssl') $m->SMTPSecure = \PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_SMTPS;
                else $m->SMTPSecure = false;

                $m->setFrom($s['smtp_from_email'] ?? 'no-reply@localhost', $s['smtp_from_name'] ?? '');
                $m->addAddress($to);
                $m->isHTML(true);
                $m->Subject = $subject;
                $m->Body    = $htmlBody;
                $m->AltBody = strip_tags($htmlBody);
                $m->send();
                return [true, null];
            } catch (\Throwable $e) {
                return [false, $e->getMessage()];
            }
        }
        error_log("[Mailer fallback] to=$to subject=$subject\n$htmlBody");
        return [false, 'PHPMailer not vendored — email logged only'];
    }

    /**
     * Resolve the active provider row for a given purpose in the current
     * tenant context. Returns null when no route is set or the
     * targeted provider is inactive (in which case callers fall back
     * to the legacy SMTP).
     */
    private static function providerFor(string $purpose): ?array
    {
        try {
            $pdo = Db::tpdo();
            $row = $pdo->prepare(
                'SELECT p.*
                   FROM email_routing r
                   JOIN email_providers p ON p.id = r.provider_id
                  WHERE r.purpose = ?
                    AND p.is_active = 1
                  LIMIT 1'
            );
            $row->execute([$purpose]);
            $r = $row->fetch();
            return $r ?: null;
        } catch (\Throwable $e) {
            // Table doesn't exist yet or migration not run → silently
            // fall back to legacy SMTP so nothing breaks.
            return null;
        }
    }

    public static function render(string $template, array $row): string
    {
        if ($template === '' || $template === null) return '';
        return preg_replace_callback('/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/i', function ($m) use ($row) {
            return htmlspecialchars((string)($row[$m[1]] ?? ''), ENT_QUOTES, 'UTF-8');
        }, $template);
    }
}
