<?php
declare(strict_types=1);

use BRS\Auth;
use BRS\Db;
use BRS\Json;
use BRS\Newsletter;

/**
 * Newsletter routes — CRUD over campaigns + send/preview/process-due triggers.
 *
 *   GET    /api/newsletter/campaigns
 *   POST   /api/newsletter/campaigns
 *   GET    /api/newsletter/campaigns/:id
 *   PUT    /api/newsletter/campaigns/:id
 *   DELETE /api/newsletter/campaigns/:id
 *   POST   /api/newsletter/campaigns/:id/send         — send immediately
 *   POST   /api/newsletter/campaigns/:id/schedule     — body { scheduled_at }
 *   POST   /api/newsletter/campaigns/:id/preview-recipients
 *   GET    /api/newsletter/campaigns/:id/recipients   — per-row send status
 *   POST   /api/newsletter/process-due                — fire any scheduled+due
 *
 * Scheduling note: Campaigns with `status='scheduled'` and `scheduled_at <= NOW()`
 * fire when /process-due is hit. Wire a cron job or Windows scheduled task
 * (every 5 min is reasonable) to keep scheduled sends ticking automatically;
 * the campaigns list also has a manual "Process due now" button for cases
 * where cron isn't set up.
 */

return function (string $method, array $segs): void {
    Auth::require();
    $pdo = Db::tpdo();

    // /api/newsletter/process-due
    if (($segs[1] ?? '') === 'process-due') {
        if ($method !== 'POST') Json::fail('Method not allowed', 405);
        $due = $pdo->query(
            "SELECT id FROM newsletter_campaigns
             WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= NOW()"
        )->fetchAll();
        $processed = [];
        foreach ($due as $row) {
            $cid = (int)$row['id'];
            try {
                $r = Newsletter::send($cid);
                $processed[] = ['id' => $cid] + $r;
            } catch (\Throwable $e) {
                // Mark failed but keep going through the queue.
                $pdo->prepare('UPDATE newsletter_campaigns SET status = "failed", last_error = ? WHERE id = ?')
                    ->execute([$e->getMessage(), $cid]);
                $processed[] = ['id' => $cid, 'error' => $e->getMessage()];
            }
        }
        Json::send(['processed' => $processed]);
    }

    // /api/newsletter/campaigns[/:id[/...]]
    if (($segs[1] ?? '') !== 'campaigns') Json::fail('Not found', 404);

    $id = isset($segs[2]) ? (int)$segs[2] : null;

    if ($id === null) {
        if ($method === 'GET') {
            $rows = $pdo->query(
                'SELECT id, subject, status, scheduled_at, sent_at,
                        recipient_count, sent_count, failed_count,
                        audience_clients, audience_leads,
                        created_at, updated_at
                 FROM newsletter_campaigns
                 ORDER BY id DESC'
            )->fetchAll();
            Json::send(['campaigns' => $rows]);
        }
        if ($method === 'POST') {
            $body = Json::readBody();
            $subject = trim((string)($body['subject'] ?? ''));
            if ($subject === '') Json::fail('Subject is required', 400);
            $bodyHtml   = (string)($body['body_html'] ?? '');
            $blocksJson = array_key_exists('blocks_json', $body) && $body['blocks_json'] !== null
                ? (string)$body['blocks_json'] : null;

            $audClients = !empty($body['audience_clients']) ? 1 : 0;
            $audLeads   = !empty($body['audience_leads']) ? 1 : 0;
            $custom     = trim((string)($body['audience_custom_emails'] ?? '')) ?: null;
            $status     = in_array($body['status'] ?? 'draft', ['draft', 'scheduled'], true)
                ? (string)$body['status'] : 'draft';
            $scheduledAt = trim((string)($body['scheduled_at'] ?? '')) ?: null;
            if ($status === 'scheduled' && $scheduledAt === null) {
                Json::fail('scheduled_at is required when status is "scheduled"', 400);
            }

            $ins = $pdo->prepare(
                'INSERT INTO newsletter_campaigns
                 (subject, body_html, blocks_json, audience_clients, audience_leads, audience_custom_emails, status, scheduled_at)
                 VALUES (?,?,?,?,?,?,?,?)'
            );
            $ins->execute([$subject, $bodyHtml, $blocksJson, $audClients, $audLeads, $custom, $status, $scheduledAt]);
            Json::send(['id' => (int)$pdo->lastInsertId()], 201);
        }
        Json::fail('Method not allowed', 405);
    }

    if ($id <= 0) Json::fail('Invalid id', 400);

    $stmt = $pdo->prepare('SELECT * FROM newsletter_campaigns WHERE id = ?');
    $stmt->execute([$id]);
    $c = $stmt->fetch();
    if (!$c) Json::fail('Campaign not found', 404);

    // /api/newsletter/campaigns/:id/send
    if (($segs[3] ?? '') === 'send') {
        if ($method !== 'POST') Json::fail('Method not allowed', 405);
        try {
            $r = Newsletter::send($id);
            Json::send(['ok' => true] + $r);
        } catch (\Throwable $e) {
            Json::fail($e->getMessage(), 502);
        }
    }

    // /api/newsletter/campaigns/:id/schedule
    if (($segs[3] ?? '') === 'schedule') {
        if ($method !== 'POST') Json::fail('Method not allowed', 405);
        $body = Json::readBody();
        $when = trim((string)($body['scheduled_at'] ?? ''));
        if ($when === '') Json::fail('scheduled_at is required', 400);
        $pdo->prepare(
            'UPDATE newsletter_campaigns
             SET status = "scheduled", scheduled_at = ?
             WHERE id = ?'
        )->execute([$when, $id]);
        Json::send(['ok' => true]);
    }

    // /api/newsletter/campaigns/:id/preview-recipients
    if (($segs[3] ?? '') === 'preview-recipients') {
        if ($method !== 'POST') Json::fail('Method not allowed', 405);
        // Allow callers to override audience selectors for ad-hoc previews
        // before the campaign is saved (compose-screen "preview count" UX).
        $body = Json::readBody();
        $audClients = array_key_exists('audience_clients', $body)
            ? !empty($body['audience_clients']) : (bool)$c['audience_clients'];
        $audLeads = array_key_exists('audience_leads', $body)
            ? !empty($body['audience_leads']) : (bool)$c['audience_leads'];
        $custom = array_key_exists('audience_custom_emails', $body)
            ? (trim((string)$body['audience_custom_emails']) ?: null)
            : ($c['audience_custom_emails'] ?: null);
        $list = Newsletter::resolveRecipients($audClients, $audLeads, $custom);
        Json::send([
            'count'   => count($list),
            'sample'  => array_slice($list, 0, 20),
        ]);
    }

    // /api/newsletter/campaigns/:id/recipients — per-row send status
    if (($segs[3] ?? '') === 'recipients') {
        if ($method !== 'GET') Json::fail('Method not allowed', 405);
        $r = $pdo->prepare(
            'SELECT id, email, name, source, source_id, status, sent_at, error_msg
             FROM newsletter_recipients
             WHERE campaign_id = ?
             ORDER BY status, id'
        );
        $r->execute([$id]);
        Json::send(['recipients' => $r->fetchAll()]);
    }

    if ($method === 'GET') Json::send(['campaign' => $c]);

    if ($method === 'PUT') {
        if (in_array($c['status'], ['sending', 'sent'], true)) {
            Json::fail('Cannot edit a campaign that has already been sent', 409);
        }
        $body = Json::readBody();
        $subject = trim((string)($body['subject'] ?? $c['subject']));
        if ($subject === '') Json::fail('Subject is required', 400);
        $bodyHtml = array_key_exists('body_html', $body) ? (string)$body['body_html'] : (string)$c['body_html'];
        $blocksJson = array_key_exists('blocks_json', $body)
            ? ($body['blocks_json'] !== null ? (string)$body['blocks_json'] : null)
            : ($c['blocks_json'] ?? null);
        $audClients = array_key_exists('audience_clients', $body)
            ? (!empty($body['audience_clients']) ? 1 : 0) : (int)$c['audience_clients'];
        $audLeads = array_key_exists('audience_leads', $body)
            ? (!empty($body['audience_leads']) ? 1 : 0) : (int)$c['audience_leads'];
        $custom = array_key_exists('audience_custom_emails', $body)
            ? (trim((string)$body['audience_custom_emails']) ?: null)
            : ($c['audience_custom_emails']);
        $status = array_key_exists('status', $body)
            ? (in_array($body['status'], ['draft', 'scheduled'], true) ? (string)$body['status'] : (string)$c['status'])
            : (string)$c['status'];
        $scheduledAt = array_key_exists('scheduled_at', $body)
            ? (trim((string)$body['scheduled_at']) ?: null)
            : ($c['scheduled_at']);
        if ($status === 'scheduled' && $scheduledAt === null) {
            Json::fail('scheduled_at is required when status is "scheduled"', 400);
        }
        $pdo->prepare(
            'UPDATE newsletter_campaigns
             SET subject=?, body_html=?, blocks_json=?, audience_clients=?, audience_leads=?,
                 audience_custom_emails=?, status=?, scheduled_at=?
             WHERE id = ?'
        )->execute([$subject, $bodyHtml, $blocksJson, $audClients, $audLeads, $custom, $status, $scheduledAt, $id]);
        Json::send(['ok' => true]);
    }

    if ($method === 'DELETE') {
        $pdo->prepare('DELETE FROM newsletter_campaigns WHERE id = ?')->execute([$id]);
        Json::send(['ok' => true]);
    }

    Json::fail('Method not allowed', 405);
};
