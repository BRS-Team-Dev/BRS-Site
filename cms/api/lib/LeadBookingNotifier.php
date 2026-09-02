<?php
declare(strict_types=1);

namespace BRS;

/**
 * Fires the "booking scheduled" pipeline: internal + client notification
 * emails, and (once Teams integration is configured) auto-creates the
 * Teams meeting and stashes the join URL on the booking.
 *
 * Called from both the admin CRUD (routes/lead_bookings.php) and the
 * public marketing-site flow (routes/public_lead_booking.php) so a
 * booking made through either surface produces exactly the same emails
 * with exactly the same recipients and payload.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  ★ IMPORTANT for callers: `Json::send()` and `Json::fail()` end with
 *    `exit`. Call the notifier BETWEEN the INSERT/UPDATE and the final
 *    `Json::send([...])` — anything after `Json::send` is dead code.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Idempotency: `onScheduled($id)` only fires when the booking has a
 * `scheduled_at` AND its `notification_sent_at` is NULL. The caller is
 * responsible for resetting `notification_sent_at = NULL` whenever
 * `scheduled_at` is changed (see the PUT handler in lead_bookings.php).
 * Safe to call from any hot path — a no-op when there is nothing to do.
 *
 * Teams meeting creation is deferred to the "teams integration" work
 * once the Azure app registration has produced credentials — see
 * docs/teams-meeting-setup.md. For now the join URL comes from whatever
 * an admin typed into `meeting_url`, or is empty.
 */
final class LeadBookingNotifier
{
    /**
     * Fire the "new / re-scheduled booking" notification pipeline for
     * the given booking. Silent no-op when the booking is unscheduled
     * or when notifications have already been sent for the current
     * `scheduled_at`.
     *
     * Never throws — errors are logged and swallowed so a failing SMTP
     * server or Graph outage cannot fail the request that created /
     * updated the booking. The admin UI has a "Resend notifications"
     * button for the recovery case.
     */
    public static function onScheduled(int $bookingId): void
    {
        try {
            $pdo = Db::tpdo();
            $b = self::loadBooking($pdo, $bookingId);
            if (!$b) return;

            // Nothing to notify about without a time.
            if (empty($b['scheduled_at'])) return;

            // Already sent for the current scheduled_at.
            if (!empty($b['notification_sent_at'])) return;

            $internalTo = self::internalRecipients($pdo, $b);
            $clientTo   = self::clientRecipient($b);

            // Loud log when no internal recipients resolve at all —
            // this only happens when the tenant has: no per-booking
            // override, no default in settings, AND no active admin
            // users. Genuinely broken tenant config; only the client
            // email will attempt.
            if (empty($internalTo)) {
                error_log('[LeadBookingNotifier] booking ' . $bookingId
                        . ': no internal recipients resolved through any layer. '
                        . 'Only the client email will attempt.');
            }

            // Teams meeting auto-create. Runs BEFORE the emails go out so
            // the join URL is in every message. Silently skipped if Teams
            // isn't configured, if the booking already has a meeting_url,
            // or if the Graph call fails — the booking + emails still send
            // with whatever meeting_url is on file (possibly empty).
            $b = self::maybeCreateTeamsMeeting($pdo, $bookingId, $b);

            $sentAny = false;
            foreach ($internalTo as $to) {
                [$ok, $err] = self::sendInternal($to, $b);
                if ($ok) $sentAny = true;
                else error_log("[LeadBookingNotifier] internal to {$to} failed: {$err}");
            }
            if ($clientTo !== null) {
                [$ok, $err] = self::sendClient($clientTo, $b);
                if ($ok) $sentAny = true;
                else error_log("[LeadBookingNotifier] client to {$clientTo} failed: {$err}");
            }

            // Only stamp when at least one message got out. If every send
            // failed (SMTP blip, no provider configured, etc.) we leave
            // notification_sent_at NULL so a later onScheduled() call —
            // or a manual Resend — retries the whole thing naturally,
            // rather than silently converting the failure into a
            // permanent "already notified" state.
            if ($sentAny) self::markSent($pdo, $bookingId);
        } catch (\Throwable $e) {
            // Never let a notification failure poison the caller's response —
            // a booking that saved but didn't email is a better outcome than a
            // 500 that makes the caller think the booking itself failed. But
            // this catch DOES hide programming bugs (see the \PDO-vs-TenantPdo
            // TypeError that caused every send to no-op until 2026-09-02). The
            // full trace is logged so `tail -f error.log` after any change in
            // this file is the way to be sure it's still working; the UI's
            // notification_sent_at column is the visible correctness signal.
            error_log('[LeadBookingNotifier] onScheduled(' . $bookingId . ') FATAL: '
                    . $e->getMessage() . "\n" . $e->getTraceAsString());
        }
    }

    /**
     * Force-resend notifications regardless of `notification_sent_at`.
     * Wired to the "Resend" button in the booking detail overlay.
     *
     * Returns [ok, message] so the caller can surface success/failure.
     */
    public static function resend(int $bookingId): array
    {
        try {
            $pdo = Db::tpdo();
            $b = self::loadBooking($pdo, $bookingId);
            if (!$b) return [false, 'Booking not found'];
            if (empty($b['scheduled_at'])) return [false, 'Cannot notify — booking has no scheduled time'];

            $internalTo = self::internalRecipients($pdo, $b);
            $clientTo   = self::clientRecipient($b);
            $errors = [];
            $sentAny = false;

            // If the booking still has no Teams URL (e.g. the first
            // onScheduled hit ran before Teams was configured, or the
            // organiser GUID was corrected after the fact), try to
            // create it now — otherwise Resend would just re-send the
            // same URL-less emails.
            $b = self::maybeCreateTeamsMeeting($pdo, $bookingId, $b);

            foreach ($internalTo as $to) {
                [$ok, $err] = self::sendInternal($to, $b);
                if ($ok) $sentAny = true;
                else $errors[] = "internal ({$to}): {$err}";
            }
            if ($clientTo !== null) {
                [$ok, $err] = self::sendClient($clientTo, $b);
                if ($ok) $sentAny = true;
                else $errors[] = "client ({$clientTo}): {$err}";
            }

            // Same rule as onScheduled: only stamp when at least one send
            // succeeded, so the next Resend click keeps retrying on a
            // total failure rather than pretending the booking was notified.
            if ($sentAny) self::markSent($pdo, $bookingId);

            if (!$sentAny) return [false, 'All sends failed: ' . implode('; ', $errors)];
            if ($errors)   return [false, 'Sent with errors: ' . implode('; ', $errors)];
            return [true, 'Notifications sent'];
        } catch (\Throwable $e) {
            return [false, $e->getMessage()];
        }
    }

    // ── internals ─────────────────────────────────────────────────────

    private static function loadBooking($pdo, int $id): ?array
    {
        $q = $pdo->prepare(
            'SELECT b.*, l.name AS lead_name
             FROM lead_bookings b
             LEFT JOIN leads l ON l.id = b.lead_id
             WHERE b.id = ? LIMIT 1'
        );
        $q->execute([$id]);
        $row = $q->fetch();
        return $row ?: null;
    }

    /**
     * Resolve internal recipients in this precedence:
     *   1. Per-booking `notification_recipients` (JSON array) — admin override
     *      set from the booking-detail modal. NEVER read from the request
     *      body in unauthenticated routes: it lets any internet visitor
     *      turn our SMTP into an open relay to arbitrary addresses. Only
     *      accept from `Auth::require()`-guarded handlers.
     *   2. Tenant default `settings.booking_notify_default_recipients`
     *      (JSON array), set by an admin in Settings.
     *   3. Last-resort fallback: every active admin_user in the current
     *      tenant with role='admin'. This exists so a freshly-provisioned
     *      tenant that skipped step 2 doesn't silently drop every booking
     *      notification to nobody — that's a worse failure than emailing
     *      too many people. To DELIBERATELY suppress internal emails,
     *      set the setting to `[]` (empty array), which is distinguishable
     *      from "unset" and skips this fallback.
     */
    private static function internalRecipients($pdo, array $b): array
    {
        $override = trim((string)($b['notification_recipients'] ?? ''));
        if ($override !== '') {
            $decoded = json_decode($override, true);
            if (is_array($decoded)) return self::cleanEmails($decoded);
        }
        $q = $pdo->prepare('SELECT v FROM settings WHERE k = ? LIMIT 1');
        $q->execute(['booking_notify_default_recipients']);
        $raw = $q->fetchColumn();
        if ($raw !== false && $raw !== null) {
            $decoded = json_decode((string)$raw, true);
            if (is_array($decoded)) return self::cleanEmails($decoded);
        }
        // Setting is unset — fall back to active tenant admins so a fresh
        // tenant is never silently broken. Logged loud so it's obvious we're
        // in fallback mode; the fix is "set the setting".
        $q = $pdo->prepare(
            "SELECT email FROM admin_users
             WHERE role = 'admin' AND is_active = 1 AND email <> ''"
        );
        $q->execute();
        $fallback = self::cleanEmails(array_column($q->fetchAll(\PDO::FETCH_ASSOC), 'email'));
        if ($fallback) {
            error_log('[LeadBookingNotifier] no tenant default configured; '
                    . 'falling back to ' . count($fallback) . ' active admin(s). '
                    . 'Set settings.booking_notify_default_recipients to override.');
        }
        return $fallback;
    }

    private static function clientRecipient(array $b): ?string
    {
        $email = trim((string)($b['email'] ?? ''));
        if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) return null;
        return $email;
    }

    private static function cleanEmails(array $list): array
    {
        $out = [];
        foreach ($list as $e) {
            $e = trim((string)$e);
            if ($e !== '' && filter_var($e, FILTER_VALIDATE_EMAIL)) $out[] = $e;
        }
        return array_values(array_unique($out));
    }

    private static function sendInternal(string $to, array $b): array
    {
        $when    = self::formatWhen($b['scheduled_at'] ?? null, null);
        $name    = htmlspecialchars((string)($b['name'] ?? 'Unknown'), ENT_QUOTES, 'UTF-8');
        $subject = 'New booking: ' . ($b['name'] ?? 'Unknown') . ' — ' . ($when['short'] ?? 'time TBC');

        $rows = [
            'When'     => $when['long'] ?? 'not scheduled',
            'Duration' => (int)($b['duration_minutes'] ?? 15) . ' min',
            'Name'     => (string)($b['name'] ?? ''),
            'Company'  => (string)($b['company'] ?? ''),
            'Email'    => (string)($b['email'] ?? ''),
            'Phone'    => (string)($b['phone'] ?? ''),
            'Topic'    => (string)($b['topic'] ?? ''),
            'Source'   => (string)($b['source'] ?? ''),
            'Meeting'  => (string)($b['meeting_url'] ?? ''),
            'Notes'    => (string)($b['notes'] ?? ''),
        ];

        $htmlRows = '';
        foreach ($rows as $label => $value) {
            if ($value === '' || $value === null) continue;
            $val = $label === 'Meeting'
                ? '<a href="' . htmlspecialchars($value, ENT_QUOTES, 'UTF-8') . '">' . htmlspecialchars($value, ENT_QUOTES, 'UTF-8') . '</a>'
                : nl2br(htmlspecialchars($value, ENT_QUOTES, 'UTF-8'));
            $htmlRows .= '<tr><td style="padding:6px 12px 6px 0;color:#666;">' . $label . '</td>'
                       . '<td style="padding:6px 0;">' . $val . '</td></tr>';
        }

        $html = '<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;">'
              . '<h2 style="margin:0 0 12px 0;">New consultation booking</h2>'
              . '<p style="margin:0 0 8px 0;color:#555;">' . $name . ' has booked a call.</p>'
              . '<table style="border-collapse:collapse;margin-top:12px;">' . $htmlRows . '</table>'
              . '</div>';

        return self::deliver($to, $subject, $html);
    }

    private static function sendClient(string $to, array $b): array
    {
        $when    = self::formatWhen($b['scheduled_at'] ?? null, (string)($b['customer_timezone'] ?? '') ?: null);
        $subject = 'Your consultation call is booked — ' . ($when['short'] ?? 'confirmed');
        $whoName = htmlspecialchars((string)($b['name'] ?? 'there'), ENT_QUOTES, 'UTF-8');
        $meeting = trim((string)($b['meeting_url'] ?? ''));

        $meetingBlock = '';
        if ($meeting !== '') {
            $safe = htmlspecialchars($meeting, ENT_QUOTES, 'UTF-8');
            $meetingBlock = '<p style="margin:16px 0;"><a href="' . $safe . '"'
                         . ' style="background:#c9a24b;color:#111;padding:10px 18px;text-decoration:none;border-radius:6px;font-weight:600;">'
                         . 'Join the meeting</a></p>'
                         . '<p style="margin:0 0 16px 0;font-size:13px;color:#666;">Or paste this link into your browser: '
                         . $safe . '</p>';
        }

        $html = '<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;color:#111;">'
              . '<p>Hi ' . $whoName . ',</p>'
              . '<p>Your consultation call with the BuiltRightStudio team is booked for:</p>'
              . '<p style="font-weight:600;font-size:16px;">' . htmlspecialchars($when['long'] ?? '', ENT_QUOTES, 'UTF-8') . '</p>'
              . '<p>It will run for around ' . (int)($b['duration_minutes'] ?? 15) . ' minutes.</p>'
              . $meetingBlock
              . '<p>If anything comes up and you need to reschedule or cancel, just reply to this email.</p>'
              . '<p style="margin-top:24px;">Looking forward to it.<br>— BuiltRightStudio</p>'
              . '</div>';

        return self::deliver($to, $subject, $html);
    }

    /**
     * Route a booking email through Microsoft Graph Mail.Send when the
     * Teams integration is configured, otherwise fall back to the
     * per-tenant Mailer. Graph is preferred because it reuses the same
     * OAuth client-credentials flow that already works for meeting
     * creation — no SMTP AUTH, no basic auth, MFA-safe. Every booking
     * email in a Teams-integrated tenant goes from the organiser's
     * mailbox, which is what visitors expect to see when they reply.
     */
    private static function deliver(string $to, string $subject, string $html): array
    {
        require_once __DIR__ . '/MsGraph.php';
        if (MsGraph::isConfigured()) {
            try {
                MsGraph::sendMail($to, $subject, $html);
                return [true, null];
            } catch (\Throwable $e) {
                return [false, 'Graph: ' . $e->getMessage()];
            }
        }
        return \BRS\Mailer::sendVia('internal', $to, $subject, $html);
    }

    private static function markSent($pdo, int $id): void
    {
        $pdo->prepare('UPDATE lead_bookings SET notification_sent_at = NOW() WHERE id = ?')
            ->execute([$id]);
    }

    /**
     * If Teams is configured AND the booking has no meeting_url yet, POST
     * to Graph, store the join URL + meeting id, and return the updated
     * booking row. Never throws — Graph failures are logged and the flow
     * continues with the pre-existing meeting_url (empty or admin-typed).
     *
     * Inline for now — a full-day rush would put ~500ms of Graph latency
     * on every booking response. If that becomes a problem, promote this
     * to a queued job (peer flagged the concern; onScheduled's signature
     * stays stable through that migration).
     */
    private static function maybeCreateTeamsMeeting($pdo, int $bookingId, array $b): array
    {
        if (!empty($b['meeting_url'])) return $b;
        if (!empty($b['teams_meeting_id'])) return $b;

        require_once __DIR__ . '/MsGraph.php';
        if (!MsGraph::isConfigured()) return $b;

        try {
            $start = new \DateTimeImmutable(
                (string)$b['scheduled_at'],
                new \DateTimeZone('Europe/London')
            );
            $subject = trim((string)($b['topic'] ?? '')) !== ''
                ? (string)$b['topic']
                : ('Consultation call — ' . ($b['name'] ?? 'booking'));

            [$meetingId, $joinUrl] = MsGraph::createOnlineMeeting(
                $subject,
                $start,
                (int)($b['duration_minutes'] ?? 15),
            );

            $pdo->prepare('UPDATE lead_bookings SET meeting_url = ?, teams_meeting_id = ? WHERE id = ?')
                ->execute([$joinUrl, $meetingId, $bookingId]);

            $b['meeting_url']      = $joinUrl;
            $b['teams_meeting_id'] = $meetingId;
        } catch (\Throwable $e) {
            error_log('[LeadBookingNotifier] Teams meeting create failed for booking '
                    . $bookingId . ': ' . $e->getMessage());
        }
        return $b;
    }

    /**
     * Render a scheduled_at (stored as UK local wall-clock) for display in
     * an email. When a customer timezone is supplied, ALSO render it in
     * that zone so the client sees their own local time.
     *
     * Returns ['short' => '...', 'long' => '...'].
     */
    private static function formatWhen(?string $scheduledAt, ?string $tz): array
    {
        $scheduledAt = trim((string)$scheduledAt);
        if ($scheduledAt === '') return ['short' => 'time TBC', 'long' => 'not scheduled'];

        try {
            $uk = new \DateTimeImmutable($scheduledAt, new \DateTimeZone('Europe/London'));
        } catch (\Throwable $e) {
            return ['short' => $scheduledAt, 'long' => $scheduledAt];
        }

        $shortUk = $uk->format('D j M \a\t H:i');
        $longUk  = $uk->format('l, j F Y \a\t H:i') . ' (UK time)';

        if ($tz && $tz !== 'Europe/London') {
            try {
                $local = $uk->setTimezone(new \DateTimeZone($tz));
                $shortLocal = $local->format('D j M \a\t H:i');
                $longLocal  = $local->format('l, j F Y \a\t H:i') . ' (' . $tz . ')';
                return [
                    'short' => $shortLocal,
                    'long'  => $longLocal . '  ·  ' . $uk->format('H:i') . ' UK time',
                ];
            } catch (\Throwable $e) {
                // Fall through to UK formatting.
            }
        }
        return ['short' => $shortUk, 'long' => $longUk];
    }
}
