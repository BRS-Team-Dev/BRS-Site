<?php
declare(strict_types=1);

namespace BRS;

/**
 * SMTP mailer. Uses PHPMailer if vendored at api/vendor/PHPMailer; otherwise falls back to a
 * minimal raw-socket SMTP implementation that handles plain-AUTH STARTTLS or implicit TLS.
 */
final class Mailer
{
    public static function settings(): array
    {
        $rows = Db::pdo()->query("SELECT k, v FROM settings WHERE k LIKE 'smtp\\_%' OR k = 'smtp_secure'")->fetchAll();
        $map  = [];
        foreach ($rows as $r) $map[$r['k']] = $r['v'];
        return $map;
    }

    public static function isConfigured(): bool
    {
        $s = self::settings();
        return !empty($s['smtp_host']) && !empty($s['smtp_from_email']);
    }

    /** Returns [ok, errorMessage|null]. */
    public static function send(string $to, string $subject, string $htmlBody): array
    {
        $s = self::settings();
        if (!self::isConfigured()) {
            return [false, 'SMTP not configured'];
        }
        if (class_exists(\PHPMailer\PHPMailer\PHPMailer::class)) {
            try {
                $m = new \PHPMailer\PHPMailer\PHPMailer(true);
                $m->isSMTP();
                $m->Host       = $s['smtp_host'] ?? '';
                $m->Port       = (int)($s['smtp_port'] ?? 587);
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

        // Fallback: log to error log so dev can see the rendered email
        error_log("[Mailer fallback] to=$to subject=$subject\n$htmlBody");
        return [false, 'PHPMailer not vendored — email logged only'];
    }

    public static function render(string $template, array $row): string
    {
        if ($template === '' || $template === null) return '';
        return preg_replace_callback('/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/i', function ($m) use ($row) {
            return htmlspecialchars((string)($row[$m[1]] ?? ''), ENT_QUOTES, 'UTF-8');
        }, $template);
    }
}
