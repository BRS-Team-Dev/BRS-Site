<?php
declare(strict_types=1);

use BRS\Auth;
use BRS\Db;
use BRS\Json;

/*
 * Lightweight CRM-level task board.
 *
 *   GET    /api/crm-tasks               list (+ stats payload)
 *   POST   /api/crm-tasks               create
 *   GET    /api/crm-tasks/:id           read
 *   PUT    /api/crm-tasks/:id           update (any field)
 *   DELETE /api/crm-tasks/:id           delete
 *
 * Tenant scoping is handled by Db::tpdo()'s rewriter.
 */

return function (string $method, array $segs): void {
    $claims = Auth::require();
    $pdo    = Db::tpdo();

    $allowedCategories = ['lead','client','service','form','onboarding','other'];
    $allowedPriorities = ['low','medium','high','urgent'];
    $allowedStatuses   = ['to_do','in_progress','done'];

    // Shared SELECT — joins admin_users for assignee + creator display names
    // AND (via service_client_link_id → client_service_offerings) exposes
    // the linked client's id + name so the frontend can render a
    // "→ Jane Tester" link on tasks auto-created from onboarding submits.
    $selectBase = "SELECT t.*,
                          au.display_name AS assignee_name,
                          cu.display_name AS created_by_name,
                          cso.client_id   AS linked_client_id,
                          cl.name         AS linked_client_name
                     FROM crm_tasks t
                LEFT JOIN admin_users au ON au.id = t.assignee_user_id
                LEFT JOIN admin_users cu ON cu.id = t.created_by_user_id
                LEFT JOIN client_service_offerings cso ON cso.id = t.service_client_link_id
                LEFT JOIN clients cl ON cl.id = cso.client_id";

    // /api/crm-tasks  (list + stats)
    if (!isset($segs[1])) {
        if ($method === 'GET') {
            $rows = $pdo->query("$selectBase ORDER BY
                FIELD(t.status,'to_do','in_progress','done'),
                FIELD(t.priority,'urgent','high','medium','low'),
                t.due_at IS NULL,
                t.due_at,
                t.id DESC")->fetchAll();

            // Stats — one round-trip, used by the dashboard cards.
            $stats = $pdo->query("SELECT
                COUNT(*)                                                    AS total,
                SUM(CASE WHEN status = 'to_do'       THEN 1 ELSE 0 END)      AS to_do,
                SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END)      AS in_progress,
                SUM(CASE WHEN status = 'done'        THEN 1 ELSE 0 END)      AS done,
                SUM(CASE WHEN priority = 'urgent' AND status != 'done' THEN 1 ELSE 0 END) AS urgent_open
                FROM crm_tasks")->fetch();

            Json::send([
                'tasks' => $rows,
                'stats' => [
                    'total'       => (int)($stats['total']        ?? 0),
                    'to_do'       => (int)($stats['to_do']        ?? 0),
                    'in_progress' => (int)($stats['in_progress']  ?? 0),
                    'done'        => (int)($stats['done']         ?? 0),
                    'urgent_open' => (int)($stats['urgent_open']  ?? 0),
                ],
            ]);
        }

        if ($method === 'POST') {
            $body  = Json::readBody();
            $title = trim((string)($body['title'] ?? ''));
            if ($title === '') Json::fail('Title is required', 400);

            $category = (string)($body['category'] ?? 'other');
            if (!in_array($category, $allowedCategories, true)) $category = 'other';

            $priority = (string)($body['priority'] ?? 'medium');
            if (!in_array($priority, $allowedPriorities, true)) $priority = 'medium';

            $status = (string)($body['status'] ?? 'to_do');
            if (!in_array($status, $allowedStatuses, true)) $status = 'to_do';

            $assigneeId = !empty($body['assignee_user_id']) ? (int)$body['assignee_user_id'] : null;
            $dueAt      = !empty($body['due_at']) ? (string)$body['due_at'] : null;
            $completed  = $status === 'done' ? date('Y-m-d H:i:s') : null;

            $ins = $pdo->prepare(
                'INSERT INTO crm_tasks
                   (title, description, category, assignee_user_id, priority, status,
                    due_at, completed_at, created_by_user_id)
                 VALUES (?,?,?,?,?,?,?,?,?)'
            );
            $ins->execute([
                $title,
                trim((string)($body['description'] ?? '')) ?: null,
                $category,
                $assigneeId,
                $priority,
                $status,
                $dueAt ?: null,
                $completed,
                (int)$claims['sub'],
            ]);
            Json::send(['id' => (int)$pdo->lastInsertId()], 201);
        }

        Json::fail('Method not allowed', 405);
    }

    // /api/crm-tasks/:id
    $id = (int)$segs[1];
    if ($id <= 0) Json::fail('Invalid id', 400);

    $find = $pdo->prepare('SELECT * FROM crm_tasks WHERE id = ?');
    $find->execute([$id]);
    $task = $find->fetch();
    if (!$task) Json::fail('Task not found', 404);

    // /api/crm-tasks/:id/notes — append-only thread on this task.
    //   GET   list (newest first)
    //   POST  add — user_id stamped from the JWT, body required
    if (($segs[2] ?? '') === 'notes') {
        if ($method === 'GET') {
            $stmt = $pdo->prepare(
                'SELECT n.id, n.task_id, n.user_id, n.body, n.created_at,
                        au.display_name AS user_name, au.email AS user_email
                   FROM crm_task_notes n
              LEFT JOIN admin_users au ON au.id = n.user_id
                  WHERE n.task_id = ?
               ORDER BY n.created_at DESC, n.id DESC'
            );
            $stmt->execute([$id]);
            Json::send(['notes' => $stmt->fetchAll()]);
        }
        if ($method === 'POST') {
            $body = Json::readBody();
            $text = trim((string)($body['body'] ?? ''));
            if ($text === '') Json::fail('Note body is required', 400);
            $ins = $pdo->prepare(
                'INSERT INTO crm_task_notes (task_id, user_id, body)
                 VALUES (?, ?, ?)'
            );
            $ins->execute([$id, (int)$claims['sub'], $text]);
            Json::send(['id' => (int)$pdo->lastInsertId()], 201);
        }
        Json::fail('Method not allowed', 405);
    }

    if ($method === 'GET') Json::send(['task' => $task]);

    if ($method === 'PUT') {
        $body = Json::readBody();

        $fields = [];
        $params = [];

        if (array_key_exists('title', $body)) {
            $title = trim((string)$body['title']);
            if ($title === '') Json::fail('Title is required', 400);
            $fields[] = 'title = ?'; $params[] = $title;
        }
        if (array_key_exists('description', $body)) {
            $fields[] = 'description = ?';
            $params[] = trim((string)$body['description']) ?: null;
        }
        if (array_key_exists('category', $body)) {
            $cat = (string)$body['category'];
            if (!in_array($cat, $allowedCategories, true)) Json::fail('Invalid category', 400);
            $fields[] = 'category = ?'; $params[] = $cat;
        }
        if (array_key_exists('priority', $body)) {
            $pri = (string)$body['priority'];
            if (!in_array($pri, $allowedPriorities, true)) Json::fail('Invalid priority', 400);
            $fields[] = 'priority = ?'; $params[] = $pri;
        }
        if (array_key_exists('assignee_user_id', $body)) {
            $fields[] = 'assignee_user_id = ?';
            $params[] = $body['assignee_user_id'] ? (int)$body['assignee_user_id'] : null;
        }
        if (array_key_exists('due_at', $body)) {
            $fields[] = 'due_at = ?';
            $params[] = $body['due_at'] ? (string)$body['due_at'] : null;
        }
        if (array_key_exists('status', $body)) {
            $stat = (string)$body['status'];
            if (!in_array($stat, $allowedStatuses, true)) Json::fail('Invalid status', 400);
            $fields[] = 'status = ?'; $params[] = $stat;
            // Stamp / clear completed_at to mirror the new status so the
            // dashboard's "Done" KPI stays a column read.
            $fields[] = 'completed_at = ?';
            $params[] = $stat === 'done' ? date('Y-m-d H:i:s') : null;
        }

        if (!$fields) Json::send(['ok' => true]); // no-op

        $params[] = $id;
        $pdo->prepare('UPDATE crm_tasks SET ' . implode(', ', $fields) . ' WHERE id = ?')
            ->execute($params);
        Json::send(['ok' => true]);
    }

    if ($method === 'DELETE') {
        $pdo->prepare('DELETE FROM crm_tasks WHERE id = ?')->execute([$id]);
        Json::send(['ok' => true]);
    }

    Json::fail('Method not allowed', 405);
};
