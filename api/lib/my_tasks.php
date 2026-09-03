<?php
declare(strict_types=1);

use BRS\Json;
use BRS\TenantPdo;

/**
 * Shared helpers powering the "My tasks" tracker + "My account overview"
 * on both the employee (/api/hr/me) and contractor (/api/contractor/me)
 * portals. Both sides end up talking to the same tables (crm_tasks +
 * task_items) so the source of the merged feed is identical — only the
 * caller identity (admin_users.id) differs.
 */

/**
 * Merged feed of every open task assigned to $userId across the two
 * task systems. Shape is the one the shared frontend tracker consumes.
 *
 * @return array<int, array<string, mixed>>
 */
function my_tasks_for_user(PDO|TenantPdo $pdo, int $userId): array
{
    // Heavy-duty task_items (Taskboard system). Priority is an int 1..5;
    // status derives from board_column so the shared tracker can render
    // consistent pills.
    $ti = $pdo->prepare(
        "SELECT ti.id, ti.title, ti.description, ti.priority,
                ti.board_column AS status,
                ti.updated_at, ti.created_at, ti.closed_at,
                tp.id   AS project_id,
                tp.name AS project_name
         FROM task_items ti
         JOIN task_projects tp ON tp.id = ti.project_id
         WHERE ti.assigned_to = ? AND ti.closed_at IS NULL
         ORDER BY ti.updated_at DESC LIMIT 200"
    );
    $ti->execute([$userId]);

    // Generic crm_tasks — status is an enum, priority is a string.
    $crm = $pdo->prepare(
        "SELECT id, title, description, status, priority, due_at, category,
                created_at, updated_at, service_client_link_id
         FROM crm_tasks
         WHERE assignee_user_id = ?
         ORDER BY (status = 'done'), COALESCE(due_at, created_at) ASC
         LIMIT 200"
    );
    $crm->execute([$userId]);

    $out = [];
    foreach ($ti->fetchAll() as $r) {
        $out[] = [
            'id'           => (int)$r['id'],
            'source'       => 'taskboard',
            'title'        => $r['title'],
            'description'  => $r['description'],
            'category'     => null,
            'project_name' => $r['project_name'],
            'status'       => $r['status'] ?? 'todo',
            'priority'     => (string)$r['priority'],
            'due_at'       => null,
            'created_at'   => $r['created_at'],
            'updated_at'   => $r['updated_at'],
            'href'         => '/tasks/taskboard/projects/' . (int)$r['project_id'],
        ];
    }
    foreach ($crm->fetchAll() as $r) {
        $out[] = [
            'id'           => (int)$r['id'],
            'source'       => 'crm',
            'title'        => $r['title'],
            'description'  => $r['description'],
            'category'     => $r['category'],
            'project_name' => null,
            'status'       => $r['status'],
            'priority'     => $r['priority'],
            'due_at'       => $r['due_at'],
            'created_at'   => $r['created_at'],
            'updated_at'   => $r['updated_at'],
            'href'         => null, // deep link handled admin-side; portal is read/status-only
        ];
    }
    return $out;
}

/**
 * PATCH the status of a crm_task that belongs to $userId. Refuses if the
 * task isn't theirs so any portal user can only touch their own rows.
 */
function my_tasks_patch_crm_status(PDO|TenantPdo $pdo, int $taskId, int $userId): void
{
    $b = Json::readBody();
    $next = (string)($b['status'] ?? '');
    $allowed = ['to_do', 'in_progress', 'done', 'on_hold'];
    if (!in_array($next, $allowed, true)) Json::fail('Invalid status', 400);

    $chk = $pdo->prepare('SELECT id FROM crm_tasks WHERE id = ? AND assignee_user_id = ?');
    $chk->execute([$taskId, $userId]);
    if (!$chk->fetchColumn()) Json::fail('Task not found or not assigned to you', 404);

    $completedAt = $next === 'done' ? date('Y-m-d H:i:s') : null;
    $pdo->prepare('UPDATE crm_tasks SET status = ?, completed_at = ? WHERE id = ?')
        ->execute([$next, $completedAt, $taskId]);
    Json::send(['ok' => true]);
}

/**
 * Overview KPIs for the contractor landing page. Cheap COUNT queries —
 * one per KPI — so the whole thing lands in a single round-trip.
 * Permission-gated sections return 0 rather than exposing counts the
 * caller isn't allowed to see.
 */
function my_overview_for_contractor(PDO|TenantPdo $pdo, int $userId, int $contractorId, array $perms): array
{
    $ret = [
        'tasks'      => ['total' => 0, 'to_do' => 0, 'in_progress' => 0, 'overdue' => 0],
        'clients'    => 0,
        'contracts'  => 0,
        'documents'  => 0,
        'upcoming'   => [],
    ];

    if ($perms['view_tasks']) {
        $all = my_tasks_for_user($pdo, $userId);
        $now = time();
        foreach ($all as $t) {
            if ($t['status'] === 'done') continue;
            $ret['tasks']['total']++;
            if ($t['status'] === 'in_progress' || $t['status'] === 'review') $ret['tasks']['in_progress']++;
            else $ret['tasks']['to_do']++;
            if (!empty($t['due_at']) && strtotime((string)$t['due_at']) < $now) $ret['tasks']['overdue']++;
        }
        // Next 5 tasks by due date for the "up next" list.
        usort($all, function ($a, $b) {
            $ad = $a['due_at'] ?? '9999-12-31';
            $bd = $b['due_at'] ?? '9999-12-31';
            return strcmp((string)$ad, (string)$bd);
        });
        $ret['upcoming'] = array_slice(
            array_filter($all, fn($t) => $t['status'] !== 'done'),
            0, 5
        );
        $ret['upcoming'] = array_values($ret['upcoming']);
    }

    if ($perms['view_clients']) {
        $q = $pdo->prepare(
            "SELECT COUNT(DISTINCT a.entity_id)
             FROM assignments a
             WHERE a.entity_type = 'client' AND a.assignee_type = 'contractor'
               AND a.assignee_id = ? AND a.ended_at IS NULL"
        );
        $q->execute([$contractorId]);
        $ret['clients'] = (int)$q->fetchColumn();
    }

    // Contracts + documents always visible in the portal today.
    $q = $pdo->prepare('SELECT COUNT(*) FROM contractor_documents
                        WHERE contractor_id = ? AND category IN ("contract","signed")');
    $q->execute([$contractorId]);
    $ret['contracts'] = (int)$q->fetchColumn();

    $q = $pdo->prepare('SELECT COUNT(*) FROM contractor_documents WHERE contractor_id = ?');
    $q->execute([$contractorId]);
    $ret['documents'] = (int)$q->fetchColumn();

    return $ret;
}

/**
 * Overview KPIs for the employee landing page (/me). Focuses on the
 * sections the ESS portal already exposes: tasks, pending time-off,
 * open reviews, learning progress.
 */
function my_overview_for_employee(PDO|TenantPdo $pdo, int $userId): array
{
    $ret = [
        'tasks'          => ['total' => 0, 'to_do' => 0, 'in_progress' => 0, 'overdue' => 0],
        'pending_timeoff' => 0,
        'open_reviews'   => 0,
        'incomplete_courses' => 0,
        'upcoming'       => [],
    ];

    $all = my_tasks_for_user($pdo, $userId);
    $now = time();
    foreach ($all as $t) {
        if ($t['status'] === 'done') continue;
        $ret['tasks']['total']++;
        if ($t['status'] === 'in_progress' || $t['status'] === 'review') $ret['tasks']['in_progress']++;
        else $ret['tasks']['to_do']++;
        if (!empty($t['due_at']) && strtotime((string)$t['due_at']) < $now) $ret['tasks']['overdue']++;
    }
    usort($all, function ($a, $b) {
        $ad = $a['due_at'] ?? '9999-12-31';
        $bd = $b['due_at'] ?? '9999-12-31';
        return strcmp((string)$ad, (string)$bd);
    });
    $ret['upcoming'] = array_values(array_slice(
        array_filter($all, fn($t) => $t['status'] !== 'done'), 0, 5
    ));

    // Resolve the hr_employees row for this user — most ESS counters
    // are keyed by employee_id, not admin_user_id.
    $emp = $pdo->prepare('SELECT id FROM hr_employees WHERE admin_user_id = ?');
    $emp->execute([$userId]);
    $empId = (int)$emp->fetchColumn();
    if ($empId > 0) {
        $q = $pdo->prepare("SELECT COUNT(*) FROM hr_time_off_requests WHERE employee_id = ? AND status = 'pending'");
        $q->execute([$empId]);
        $ret['pending_timeoff'] = (int)$q->fetchColumn();

        $q = $pdo->prepare("SELECT COUNT(*) FROM hr_reviews WHERE employee_id = ?
                            AND status IN ('self_review','manager_review')");
        $q->execute([$empId]);
        $ret['open_reviews'] = (int)$q->fetchColumn();

        $q = $pdo->prepare("SELECT COUNT(*) FROM hr_course_assignments
                            WHERE employee_id = ? AND status IN ('assigned','in_progress')");
        $q->execute([$empId]);
        $ret['incomplete_courses'] = (int)$q->fetchColumn();
    }

    return $ret;
}
