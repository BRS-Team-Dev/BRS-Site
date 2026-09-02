<?php
declare(strict_types=1);

use BRS\Auth;
use BRS\Db;
use BRS\Json;
use BRS\LeadBookingNotifier;
use BRS\Tenant;

// Notifier is used inside POST/PUT/resend below. `require_once` must be
// ABOVE the `return function` — once that closure runs PHP stops executing
// top-level statements in this file (see memory.md → route-file gotcha).
require_once __DIR__ . '/../lib/LeadBookingNotifier.php';

/*
 * Consultation-call bookings — CRUD sitting under CRM → Leads → Bookings.
 *
 *   GET    /api/lead-bookings                     → list (optionally filtered by ?status=&lead_id=&from=&to=)
 *   POST   /api/lead-bookings                     → create
 *   GET    /api/lead-bookings/:id                 → single
 *   PUT    /api/lead-bookings/:id                 → update
 *   DELETE /api/lead-bookings/:id                 → remove
 *   POST   /api/lead-bookings/:id/resend          → force-resend notifications
 */

return function (string $method, array $segs): void {
    Auth::require();
    $pdo = Db::tpdo();

    $statuses = ['requested','confirmed','completed','cancelled','no_show'];

    $decorate = function (array $r): array {
        $r['id']               = (int)$r['id'];
        $r['lead_id']          = $r['lead_id'] !== null ? (int)$r['lead_id'] : null;
        $r['duration_minutes'] = (int)$r['duration_minutes'];
        return $r;
    };

    // ── People typeahead for the picker ─────────────────────────────
    // GET /api/lead-bookings/people?q=xxx  →  unified list of leads +
    // client contacts matching the query. The picker uses this to let
    // the admin pick an existing lead, or select a contact (which the
    // save flow converts to a new lead with source='call booking').
    // ── Recipient chip options ─────────────────────────────────────
    // GET /api/lead-bookings/recipient-options
    // Returns every active admin user in the tenant + which of them are
    // in the tenant default recipient list, so the booking overlay can
    // render pre-checked chips without shipping ObjectId lookups to the
    // browser.
    if (($segs[1] ?? '') === 'recipient-options' && $method === 'GET') {
        $q = $pdo->prepare(
            "SELECT email, display_name FROM admin_users
             WHERE is_active = 1 AND email <> ''
             ORDER BY display_name"
        );
        $q->execute();
        $people = array_map(fn($r) => [
            'email'        => (string)$r['email'],
            'display_name' => (string)$r['display_name'],
        ], $q->fetchAll(\PDO::FETCH_ASSOC));

        // Tenant default recipient list (JSON array). Empty = fallback
        // to admin users applies at send time.
        $s = $pdo->prepare('SELECT v FROM settings WHERE k = ? LIMIT 1');
        $s->execute(['booking_notify_default_recipients']);
        $raw = (string)($s->fetchColumn() ?: '');
        $defaults = [];
        if ($raw !== '') {
            $decoded = json_decode($raw, true);
            if (is_array($decoded)) $defaults = array_values(array_filter(array_map('trim', $decoded)));
        }

        Json::send(['people' => $people, 'defaults' => $defaults]);
    }

    if (($segs[1] ?? '') === 'people' && $method === 'GET') {
        $q = trim((string)($_GET['q'] ?? ''));
        $like = '%' . $q . '%';
        $out = [];

        $lq = $pdo->prepare(
            'SELECT id, name, company, email, phone
             FROM leads
             WHERE (? = "" OR name LIKE ? OR email LIKE ? OR company LIKE ? OR phone LIKE ?)
             ORDER BY updated_at DESC LIMIT 50'
        );
        $lq->execute([$q, $like, $like, $like, $like]);
        foreach ($lq->fetchAll() as $r) {
            $out[] = ['type' => 'lead', 'id' => (int)$r['id'],
                      'name' => $r['name'], 'company' => $r['company'],
                      'email' => $r['email'], 'phone' => $r['phone']];
        }

        $cq = $pdo->prepare(
            'SELECT cc.id, cc.first_name, cc.last_name, cc.email,
                    c.name AS client_name, c.company AS client_company
             FROM client_contacts cc
             JOIN clients c ON c.id = cc.client_id
             WHERE (? = "" OR cc.first_name LIKE ? OR cc.last_name LIKE ? OR cc.email LIKE ? OR c.name LIKE ? OR c.company LIKE ?)
             ORDER BY cc.updated_at DESC LIMIT 50'
        );
        $cq->execute([$q, $like, $like, $like, $like, $like]);
        foreach ($cq->fetchAll() as $r) {
            $fullName = trim(($r['first_name'] ?? '') . ' ' . ($r['last_name'] ?? ''));
            $out[] = ['type' => 'contact', 'id' => (int)$r['id'],
                      'name' => $fullName, 'company' => $r['client_company'] ?: $r['client_name'],
                      'email' => $r['email'], 'phone' => null];
        }
        Json::send(['people' => $out]);
    }

    if (!isset($segs[1])) {
        if ($method === 'GET') {
            $where = []; $args = [];
            if (!empty($_GET['status']) && in_array($_GET['status'], $statuses, true)) {
                $where[] = 'b.status = ?';
                $args[]  = $_GET['status'];
            }
            if (!empty($_GET['lead_id'])) {
                $where[] = 'b.lead_id = ?';
                $args[]  = (int)$_GET['lead_id'];
            }
            // Half-open date range: from inclusive, to exclusive so month
            // boundaries don't double-count. Drives the Bookings calendar.
            // NULL scheduled_at rows are excluded automatically by the range
            // — they can't sit on a calendar anyway.
            $isYmd = static fn(string $s): bool => (bool)preg_match('/^\d{4}-\d{2}-\d{2}$/', $s);
            $ranged = false;
            if (!empty($_GET['from']) && $isYmd((string)$_GET['from'])) {
                $where[] = 'b.scheduled_at >= ?';
                $args[]  = $_GET['from'] . ' 00:00:00';
                $ranged = true;
            }
            if (!empty($_GET['to']) && $isYmd((string)$_GET['to'])) {
                $where[] = 'b.scheduled_at < ?';
                $args[]  = $_GET['to'] . ' 00:00:00';
                $ranged = true;
            }
            $sql = 'SELECT b.*, l.name AS lead_name, u.display_name AS assignee_name
                    FROM lead_bookings b
                    LEFT JOIN leads l       ON l.id = b.lead_id
                    LEFT JOIN admin_users u ON u.id = b.assignee_user_id';
            if ($where) $sql .= ' WHERE ' . implode(' AND ', $where);
            $sql .= ' ORDER BY COALESCE(b.scheduled_at, b.created_at) DESC';
            $sql .= $ranged ? ' LIMIT 2000' : ' LIMIT 500';
            $q = $pdo->prepare($sql);
            $q->execute($args);
            Json::send(['bookings' => array_map($decorate, $q->fetchAll())]);
        }
        if ($method === 'POST') {
            $b = Json::readBody();
            $name = trim((string)($b['name'] ?? ''));
            if ($name === '') Json::fail('Name is required', 400);
            $status   = in_array($b['status'] ?? '', $statuses, true) ? $b['status'] : 'requested';
            $callerId = (int)(Tenant::userId() ?? 0) ?: null;

            // Every booking must link to a lead. Either pick an existing one
            // (lead_id) or auto-create one from `new_lead: {...}`. The public
            // website booking flow will use new_lead with source='website
            // booking'; the CMS admin uses 'call booking'.
            $leadId = !empty($b['lead_id']) ? (int)$b['lead_id'] : null;
            if (!$leadId) {
                $nl = is_array($b['new_lead'] ?? null) ? $b['new_lead'] : null;
                if (!$nl) Json::fail('Either lead_id or new_lead is required', 400);
                $leadName = trim((string)($nl['name'] ?? $name));
                if ($leadName === '') Json::fail('new_lead.name required', 400);
                $sourceLabel = trim((string)($nl['source'] ?? 'call booking')) ?: 'call booking';
                $insLead = $pdo->prepare(
                    'INSERT INTO leads (name, email, phone, company, source)
                     VALUES (?,?,?,?,?)'
                );
                $insLead->execute([
                    $leadName,
                    trim((string)($nl['email']   ?? '')) ?: null,
                    trim((string)($nl['phone']   ?? '')) ?: null,
                    trim((string)($nl['company'] ?? '')) ?: null,
                    $sourceLabel,
                ]);
                $leadId = (int)$pdo->lastInsertId();
            }

            // Per-booking recipient override (JSON array of emails) — NULL
            // means fall back to the tenant default from settings.
            //
            // ★ SECURITY: only read this field from Auth::require()-guarded
            // handlers. NEVER accept `notification_recipients` from the
            // request body in an unauthenticated route (public marketing
            // form etc.) — a caller-supplied recipient list turns SMTP
            // into an open relay to arbitrary addresses from our domain,
            // and gets our sending IP blacklisted fast.
            $notiRecipients = null;
            if (isset($b['notification_recipients']) && is_array($b['notification_recipients'])) {
                $notiRecipients = json_encode(array_values($b['notification_recipients']));
            }

            $ins = $pdo->prepare(
                'INSERT INTO lead_bookings
                 (lead_id, name, email, phone, company, topic, notes,
                  scheduled_at, duration_minutes, status, meeting_url, source,
                  assignee_user_id, created_by_user_id, notification_recipients)
                 VALUES (?,?,?,?,?,?,?, ?,?,?,?,?, ?,?,?)'
            );
            $ins->execute([
                $leadId,
                $name,
                trim((string)($b['email'] ?? '')) ?: null,
                trim((string)($b['phone'] ?? '')) ?: null,
                trim((string)($b['company'] ?? '')) ?: null,
                trim((string)($b['topic'] ?? '')) ?: null,
                $b['notes'] ?? null,
                trim((string)($b['scheduled_at'] ?? '')) ?: null,
                max(5, min(240, (int)($b['duration_minutes'] ?? 15))),
                $status,
                trim((string)($b['meeting_url'] ?? '')) ?: null,
                trim((string)($b['source'] ?? '')) ?: null,
                !empty($b['assignee_user_id']) ? (int)$b['assignee_user_id'] : null,
                $callerId,
                $notiRecipients,
            ]);
            $newId = (int)$pdo->lastInsertId();

            // Fire the notification pipeline (emails + Teams meeting when
            // configured). MUST be before Json::send — that call exits.
            LeadBookingNotifier::onScheduled($newId);

            Json::send(['id' => $newId, 'lead_id' => $leadId], 201);
        }
        Json::fail('Method not allowed', 405);
    }

    $id = (int)$segs[1];
    if ($id <= 0) Json::fail('Invalid id', 400);

    $q = $pdo->prepare(
        'SELECT b.*, l.name AS lead_name, u.display_name AS assignee_name
         FROM lead_bookings b
         LEFT JOIN leads l       ON l.id = b.lead_id
         LEFT JOIN admin_users u ON u.id = b.assignee_user_id
         WHERE b.id = ? LIMIT 1'
    );
    $q->execute([$id]);
    $row = $q->fetch();
    if (!$row) Json::fail('Booking not found', 404);

    if ($method === 'GET') Json::send(['booking' => $decorate($row)]);

    // POST /:id/resend — force-resend notifications regardless of
    // notification_sent_at. Wired to the "Resend" button in the overlay.
    if (($segs[2] ?? '') === 'resend' && $method === 'POST') {
        [$ok, $msg] = LeadBookingNotifier::resend($id);
        if (!$ok) Json::fail($msg, 500);
        Json::send(['ok' => true, 'message' => $msg]);
    }

    if ($method === 'PUT') {
        $b = Json::readBody();
        $name = trim((string)($b['name'] ?? $row['name']));
        if ($name === '') Json::fail('Name is required', 400);
        $status = in_array($b['status'] ?? '', $statuses, true) ? $b['status'] : $row['status'];

        $nextScheduled = array_key_exists('scheduled_at', $b)
            ? (trim((string)$b['scheduled_at']) ?: null)
            : $row['scheduled_at'];
        $scheduledChanged = ($nextScheduled !== $row['scheduled_at']);

        // Per-booking recipient override. NULL restores tenant default.
        $notiRecipients = $row['notification_recipients'];
        if (array_key_exists('notification_recipients', $b)) {
            $notiRecipients = is_array($b['notification_recipients'])
                ? json_encode(array_values($b['notification_recipients']))
                : null;
        }

        $pdo->prepare(
            'UPDATE lead_bookings SET
               lead_id = ?, name = ?, email = ?, phone = ?, company = ?, topic = ?, notes = ?,
               scheduled_at = ?, duration_minutes = ?, status = ?, meeting_url = ?, source = ?,
               assignee_user_id = ?, notification_recipients = ?
             WHERE id = ?'
        )->execute([
            array_key_exists('lead_id', $b) ? (!empty($b['lead_id']) ? (int)$b['lead_id'] : null) : $row['lead_id'],
            $name,
            array_key_exists('email',        $b) ? (trim((string)$b['email'])        ?: null) : $row['email'],
            array_key_exists('phone',        $b) ? (trim((string)$b['phone'])        ?: null) : $row['phone'],
            array_key_exists('company',      $b) ? (trim((string)$b['company'])      ?: null) : $row['company'],
            array_key_exists('topic',        $b) ? (trim((string)$b['topic'])        ?: null) : $row['topic'],
            array_key_exists('notes',        $b) ? $b['notes']                                : $row['notes'],
            $nextScheduled,
            array_key_exists('duration_minutes', $b) ? max(5, min(240, (int)$b['duration_minutes'])) : (int)$row['duration_minutes'],
            $status,
            array_key_exists('meeting_url',  $b) ? (trim((string)$b['meeting_url'])  ?: null) : $row['meeting_url'],
            array_key_exists('source',       $b) ? (trim((string)$b['source'])       ?: null) : $row['source'],
            array_key_exists('assignee_user_id', $b) ? (!empty($b['assignee_user_id']) ? (int)$b['assignee_user_id'] : null) : $row['assignee_user_id'],
            $notiRecipients,
            $id,
        ]);

        // Rescheduling a booking re-arms the notification pipeline so the
        // recipients get an updated invite.
        if ($scheduledChanged) {
            $pdo->prepare('UPDATE lead_bookings SET notification_sent_at = NULL WHERE id = ?')->execute([$id]);
            LeadBookingNotifier::onScheduled($id);
        }
        Json::send(['ok' => true]);
    }

    if ($method === 'DELETE') {
        $pdo->prepare('DELETE FROM lead_bookings WHERE id = ?')->execute([$id]);
        Json::send(['ok' => true]);
    }

    Json::fail('Method not allowed', 405);
};
