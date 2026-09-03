<?php
declare(strict_types=1);

use BRS\Auth;
use BRS\Db;
use BRS\Json;

/*
 * Notifications inbox + event catalogue endpoints.
 *
 *   GET  /api/notifications                      current user's inbox (grouped by section)
 *   GET  /api/notifications/unread-count         { total: N, by_section: {crm: 3, hr: 1, ...} }
 *   PUT  /api/notifications/:id/read             mark one read
 *   POST /api/notifications/read-all             mark all mine read (optional ?section=crm)
 *
 *   GET  /api/notifications/events               full catalogue (for the rules-config UI)
 *   GET  /api/notifications/rules                tenant's rule overrides (empty means using defaults)
 *   PUT  /api/notifications/rules/:event_key     upsert one rule
 */
return function (string $method, array $segs): void {
    $claims = Auth::require();
    $pdo    = Db::tpdo();
    $uid    = (int)$claims['sub'];

    // Static sub-route dispatch — order matters (specific before :id).
    $seg1 = $segs[1] ?? '';

    // ── /api/notifications/unread-count ──────────────────────────
    if ($seg1 === 'unread-count' && $method === 'GET') {
        $rows = $pdo->prepare(
            'SELECT section, COUNT(*) AS c
               FROM notifications
              WHERE user_id = ? AND read_at IS NULL
           GROUP BY section'
        );
        $rows->execute([$uid]);
        $bySection = [];
        $total = 0;
        foreach ($rows->fetchAll() as $r) {
            $c = (int)$r['c'];
            $bySection[$r['section']] = $c;
            $total += $c;
        }
        Json::send(['total' => $total, 'by_section' => (object)$bySection]);
    }

    // ── /api/notifications/read-all ──────────────────────────────
    if ($seg1 === 'read-all' && $method === 'POST') {
        $section = trim((string)($_GET['section'] ?? ''));
        if ($section !== '') {
            $pdo->prepare('UPDATE notifications SET read_at = NOW() WHERE user_id = ? AND read_at IS NULL AND section = ?')
                ->execute([$uid, $section]);
        } else {
            $pdo->prepare('UPDATE notifications SET read_at = NOW() WHERE user_id = ? AND read_at IS NULL')
                ->execute([$uid]);
        }
        Json::send(['ok' => true]);
    }

    // ── /api/notifications/events ────────────────────────────────
    if ($seg1 === 'events' && $method === 'GET') {
        // @global-scope: notification_events_catalog is a global catalogue
        // (no tenant_id column) — same catalogue served to every tenant.
        $rows = Db::pdo()->query('SELECT * FROM notification_events_catalog ORDER BY section, event_key')->fetchAll();
        Json::send(['events' => $rows]);
    }

    // ── /api/notifications/rules[/:event_key] ────────────────────
    if ($seg1 === 'rules') {
        $key = $segs[2] ?? '';
        if ($key === '' && $method === 'GET') {
            $rows = $pdo->query('SELECT * FROM notification_rules ORDER BY event_key')->fetchAll();
            Json::send(['rules' => $rows]);
        }
        if ($key !== '' && $method === 'PUT') {
            $body = Json::readBody();
            $stmt = Db::pdo()->prepare(
                'INSERT INTO notification_rules
                   (tenant_id, event_key, enabled, recipient_scope, recipient_ref,
                    supervisor_user_id, supervisor_role, creates_task,
                    escalate_after_minutes, escalate_to_user_id, escalate_to_role)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?)
                 ON DUPLICATE KEY UPDATE
                   enabled = VALUES(enabled),
                   recipient_scope = VALUES(recipient_scope),
                   recipient_ref = VALUES(recipient_ref),
                   supervisor_user_id = VALUES(supervisor_user_id),
                   supervisor_role = VALUES(supervisor_role),
                   creates_task = VALUES(creates_task),
                   escalate_after_minutes = VALUES(escalate_after_minutes),
                   escalate_to_user_id = VALUES(escalate_to_user_id),
                   escalate_to_role = VALUES(escalate_to_role)'
            );
            $scope = in_array(($body['recipient_scope'] ?? ''), ['user','team','role','tenant','none'], true)
                ? $body['recipient_scope'] : 'role';
            $stmt->execute([
                \BRS\Tenant::id(),
                $key,
                !empty($body['enabled']) ? 1 : 0,
                $scope,
                trim((string)($body['recipient_ref'] ?? '')) ?: null,
                !empty($body['supervisor_user_id']) ? (int)$body['supervisor_user_id'] : null,
                trim((string)($body['supervisor_role'] ?? '')) ?: null,
                !empty($body['creates_task']) ? 1 : 0,
                !empty($body['escalate_after_minutes']) ? (int)$body['escalate_after_minutes'] : null,
                !empty($body['escalate_to_user_id']) ? (int)$body['escalate_to_user_id'] : null,
                trim((string)($body['escalate_to_role'] ?? '')) ?: null,
            ]);
            Json::send(['ok' => true]);
        }
        Json::fail('Method not allowed', 405);
    }

    // ── /api/notifications/:id/read ──────────────────────────────
    if ($seg1 !== '' && ctype_digit($seg1) && ($segs[2] ?? '') === 'read' && $method === 'PUT') {
        $pdo->prepare('UPDATE notifications SET read_at = COALESCE(read_at, NOW()) WHERE id = ? AND user_id = ?')
            ->execute([(int)$seg1, $uid]);
        Json::send(['ok' => true]);
    }

    // ── /api/notifications  (list, optional ?section=) ───────────
    if ($seg1 === '' && $method === 'GET') {
        $section = trim((string)($_GET['section'] ?? ''));
        $limit   = min(200, max(10, (int)($_GET['limit'] ?? 50)));
        $where   = 'user_id = ?';
        $params  = [$uid];
        if ($section !== '') { $where .= ' AND section = ?'; $params[] = $section; }
        $stmt = $pdo->prepare(
            "SELECT id, event_key, section, title, body, link_url, read_at, escalated_at, created_at
               FROM notifications
              WHERE $where
           ORDER BY created_at DESC, id DESC
              LIMIT $limit"
        );
        $stmt->execute($params);
        Json::send(['notifications' => $stmt->fetchAll()]);
    }

    Json::fail('Not found', 404);
};
