<?php
declare(strict_types=1);

namespace BRS;

/**
 * Newsletter helpers — recipient resolution + send loop. Sends through the
 * existing PHPMailer-backed Mailer (one SMTP connection per recipient — fine
 * for the low-volume admin-tool use case; if volume grows we'd batch or
 * switch to a transactional service).
 *
 * Recipient resolution covers the three audiences a campaign can opt into:
 *   - clients:  the primary contact email of every client (or the legacy
 *               `clients.email` fallback when a client has no primary contact)
 *   - leads:    every `leads.email` that's set
 *   - custom:   pasted/typed list (newline or comma-separated)
 *
 * De-duplication is by email (case-insensitive). Suppressed addresses
 * (`newsletter_suppressions`) are filtered out so unsubscribed recipients
 * stay unsubscribed across all future sends.
 */
final class Newsletter
{
    /**
     * Resolve a campaign's audience selectors into a flat de-duped recipient
     * list. Caller decides whether to materialise this into the
     * `newsletter_recipients` table or use it for a preview count.
     *
     * @return array<int, array{email:string, name:?string, source:string, source_id:?int}>
     */
    public static function resolveRecipients(
        bool $audienceClients,
        bool $audienceLeads,
        ?string $customEmails
    ): array {
        $pdo = Db::tpdo();
        /** @var array<string, array{email:string, name:?string, source:string, source_id:?int}> */
        $byEmail = [];

        if ($audienceClients) {
            // Prefer the primary contact's email; fall back to the legacy
            // clients.email column when no primary contact is flagged or the
            // primary contact has no email of its own.
            $sql = '
                SELECT c.id AS client_id,
                       c.name AS client_name,
                       COALESCE(NULLIF(pc.email, ""), c.email) AS resolved_email,
                       COALESCE(
                           NULLIF(CONCAT_WS(" ", pc.first_name, pc.last_name), " "),
                           c.name
                       ) AS resolved_name
                FROM clients c
                LEFT JOIN client_contacts pc
                    ON pc.client_id = c.id AND pc.is_primary = 1
            ';
            foreach ($pdo->query($sql) as $r) {
                $email = strtolower(trim((string)($r['resolved_email'] ?? '')));
                if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) continue;
                if (isset($byEmail[$email])) continue;
                $byEmail[$email] = [
                    'email'     => $email,
                    'name'      => trim((string)($r['resolved_name'] ?? '')) ?: null,
                    'source'    => 'client',
                    'source_id' => (int)$r['client_id'],
                ];
            }
        }

        if ($audienceLeads) {
            $sql = 'SELECT id, name, email FROM leads WHERE email IS NOT NULL AND email <> ""';
            foreach ($pdo->query($sql) as $r) {
                $email = strtolower(trim((string)$r['email']));
                if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) continue;
                if (isset($byEmail[$email])) continue;
                $byEmail[$email] = [
                    'email'     => $email,
                    'name'      => trim((string)($r['name'] ?? '')) ?: null,
                    'source'    => 'lead',
                    'source_id' => (int)$r['id'],
                ];
            }
        }

        if ($customEmails !== null && $customEmails !== '') {
            // Accept comma, semicolon, or newline-separated lists.
            $parts = preg_split('/[\s,;]+/', $customEmails) ?: [];
            foreach ($parts as $raw) {
                $email = strtolower(trim($raw));
                if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) continue;
                if (isset($byEmail[$email])) continue;
                $byEmail[$email] = [
                    'email'     => $email,
                    'name'      => null,
                    'source'    => 'custom',
                    'source_id' => null,
                ];
            }
        }

        if (count($byEmail) === 0) return [];

        // Filter out suppressed addresses in one go.
        $emails = array_keys($byEmail);
        $place  = implode(',', array_fill(0, count($emails), '?'));
        $stmt   = $pdo->prepare("SELECT email FROM newsletter_suppressions WHERE email IN ($place)");
        $stmt->execute($emails);
        foreach ($stmt->fetchAll() as $r) {
            $e = strtolower((string)$r['email']);
            unset($byEmail[$e]);
        }

        return array_values($byEmail);
    }

    /**
     * Send a campaign. Materialises recipient rows, transitions status
     * draft|scheduled → sending → sent|failed, sends one email per recipient
     * with an unsubscribe footer, updates per-row + campaign counts.
     *
     * Returns ['sent' => int, 'failed' => int, 'recipients' => int, 'last_error' => ?string].
     */
    public static function send(int $campaignId): array
    {
        $pdo = Db::tpdo();

        $stmt = $pdo->prepare('SELECT * FROM newsletter_campaigns WHERE id = ?');
        $stmt->execute([$campaignId]);
        $c = $stmt->fetch();
        if (!$c) throw new \RuntimeException('Campaign not found');

        if (in_array($c['status'], ['sending', 'sent'], true)) {
            throw new \RuntimeException('Campaign already ' . $c['status']);
        }
        if (!Mailer::isConfigured()) {
            throw new \RuntimeException('SMTP is not configured. Set it up in Settings before sending.');
        }

        // Resolve audience now (at send time) so the recipient list reflects
        // current data — a draft saved a week ago picks up new clients/leads.
        $recipients = self::resolveRecipients(
            (bool)$c['audience_clients'],
            (bool)$c['audience_leads'],
            $c['audience_custom_emails'] ?: null
        );

        $pdo->prepare('UPDATE newsletter_campaigns SET status = "sending", recipient_count = ? WHERE id = ?')
            ->execute([count($recipients), $campaignId]);

        // Wipe any prior recipient rows from a re-send attempt.
        $pdo->prepare('DELETE FROM newsletter_recipients WHERE campaign_id = ?')->execute([$campaignId]);

        $insRecipient = $pdo->prepare(
            'INSERT INTO newsletter_recipients (campaign_id, email, name, source, source_id, unsubscribe_token, status, sent_at, error_msg)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );

        $sentCount   = 0;
        $failedCount = 0;
        $lastError   = null;

        foreach ($recipients as $r) {
            $token = bin2hex(random_bytes(24));
            $personalizedBody = self::renderBody((string)$c['body_html'], $r, $token);
            [$ok, $err] = Mailer::send($r['email'], (string)$c['subject'], $personalizedBody);

            $status = $ok ? 'sent' : 'failed';
            $sentAt = $ok ? date('Y-m-d H:i:s') : null;
            $insRecipient->execute([
                $campaignId, $r['email'], $r['name'], $r['source'], $r['source_id'],
                $token, $status, $sentAt, $err,
            ]);

            if ($ok) $sentCount++;
            else { $failedCount++; $lastError = $err; }
        }

        $finalStatus = ($sentCount === 0 && $failedCount > 0) ? 'failed' : 'sent';
        $pdo->prepare(
            'UPDATE newsletter_campaigns
             SET status = ?, sent_at = NOW(), sent_count = ?, failed_count = ?, last_error = ?
             WHERE id = ?'
        )->execute([$finalStatus, $sentCount, $failedCount, $lastError, $campaignId]);

        return [
            'sent'       => $sentCount,
            'failed'     => $failedCount,
            'recipients' => count($recipients),
            'last_error' => $lastError,
        ];
    }

    /** Append an unsubscribe footer + simple {{name}} substitution. */
    private static function renderBody(string $bodyHtml, array $recipient, string $unsubToken): string
    {
        $name  = $recipient['name'] ?? '';
        $body  = preg_replace_callback('/\{\{\s*name\s*\}\}/i', static function () use ($name) {
            return htmlspecialchars($name, ENT_QUOTES, 'UTF-8');
        }, $bodyHtml) ?? $bodyHtml;

        $base   = (string)($GLOBALS['BRS_CONFIG']['base_url'] ?? '');
        $unsub  = $base . '/api/public/newsletter/unsubscribe?token=' . urlencode($unsubToken);
        $footer = '<hr style="margin:32px 0 12px 0;border:none;border-top:1px solid #ddd;">'
                . '<p style="font-size:11px;color:#888;text-align:center;">'
                . 'You\'re receiving this because you\'re on our contact list. '
                . '<a href="' . htmlspecialchars($unsub, ENT_QUOTES, 'UTF-8') . '" style="color:#888;">Unsubscribe</a>.'
                . '</p>';
        return $body . $footer;
    }
}
