<?php
declare(strict_types=1);

use BRS\Auth;
use BRS\Db;
use BRS\Json;

/*
 * Taskboard route — handles all /api/tasks/* paths.
 *
 *   GET/POST   /api/tasks/teams
 *   GET/PUT/DELETE /api/tasks/teams/:id
 *
 *   GET/POST   /api/tasks/projects
 *   GET/PUT/DELETE /api/tasks/projects/:id
 *
 *   GET/POST   /api/tasks/types
 *   GET/PUT/DELETE /api/tasks/types/:id
 *
 *   GET/POST   /api/tasks/states
 *   GET/PUT/DELETE /api/tasks/states/:id
 *
 *   GET/POST   /api/tasks/items                  (?project_id, ?iteration_id)
 *   GET/PUT/DELETE /api/tasks/items/:id
 *
 *   GET/POST   /api/tasks/iterations             (?project_id)
 *   GET/PUT/DELETE /api/tasks/iterations/:id
 */

return function (string $method, array $segs): void {
    Auth::require();
    $pdo = Db::pdo();
    $sub = (string)($segs[1] ?? '');

    if ($sub === 'teams')          { handleTeams($pdo, $method, $segs);      return; }
    if ($sub === 'projects')       { handleProjects($pdo, $method, $segs);   return; }
    if ($sub === 'types')          { handleTypes($pdo, $method, $segs);      return; }
    if ($sub === 'states')         { handleStates($pdo, $method, $segs);     return; }
    if ($sub === 'items')          { handleItems($pdo, $method, $segs);      return; }
    if ($sub === 'iterations')     { handleIterations($pdo, $method, $segs); return; }
    if ($sub === 'services-pool')  { handleServicesPool($pdo, $method);      return; }
    Json::fail('Not found', 404);
};

/**
 * GET /api/tasks/services-pool — qualified onboarding entries (= "services")
 * suitable for linking to a task project. Includes form pricing/terms so the
 * picker can show enough detail to identify the right one. The endpoint
 * marks entries already linked to a project so the UI can grey them out.
 */
function handleServicesPool(\PDO $pdo, string $method): void {
    if ($method !== 'GET') Json::fail('Method not allowed', 405);
    $rows = $pdo->query("
        SELECT oc.id              AS onboarding_client_id,
               oc.client_email,
               oc.client_name,
               oc.qualified_at,
               oc.submitted_at,
               oc.started_at,
               f.id                AS form_id,
               f.title             AS form_title,
               f.slug              AS form_slug,
               f.has_price,
               f.price,
               f.payment_type,
               f.repeat_duration,
               f.contract_length_months,
               f.is_indefinite,
               c.id                AS client_id,
               c.name              AS client_canonical_name,
               c.company           AS client_company,
               tp.id               AS linked_project_id,
               tp.name             AS linked_project_name
        FROM onboarding_clients oc
        JOIN forms f ON f.id = oc.form_id
        LEFT JOIN clients c ON LOWER(c.email) = LOWER(oc.client_email)
        LEFT JOIN task_projects tp ON tp.onboarding_client_id = oc.id
        WHERE oc.qualified_at IS NOT NULL
        ORDER BY oc.qualified_at DESC, oc.id DESC
    ")->fetchAll();
    Json::send(['services' => $rows]);
}

function handleTeams(\PDO $pdo, string $method, array $segs): void {
    if (!isset($segs[2])) {
        if ($method === 'GET') {
            $rows = $pdo->query('
                SELECT t.*, (SELECT COUNT(*) FROM task_projects p WHERE p.team_id = t.id) AS project_count
                FROM task_teams t ORDER BY t.sort_order, t.id
            ')->fetchAll();
            Json::send(['teams' => $rows]);
        }
        if ($method === 'POST') {
            $b = Json::readBody();
            $slug = strtolower(trim((string)($b['slug'] ?? '')));
            $name = trim((string)($b['name'] ?? ''));
            if (!preg_match('/^[a-z][a-z0-9_-]{0,59}$/', $slug)) Json::fail('Invalid slug', 400);
            if ($name === '') Json::fail('Name required', 400);
            $ins = $pdo->prepare('INSERT INTO task_teams (slug, name, description, icon, color, sort_order) VALUES (?,?,?,?,?,?)');
            $ins->execute([$slug, $name, $b['description'] ?? null, $b['icon'] ?? null, $b['color'] ?? null, (int)($b['sort_order'] ?? 0)]);
            Json::send(['id' => (int)$pdo->lastInsertId()], 201);
        }
        Json::fail('Method not allowed', 405);
    }
    $id = (int)$segs[2];
    $row = $pdo->prepare('SELECT * FROM task_teams WHERE id = ?'); $row->execute([$id]);
    $team = $row->fetch();
    if (!$team) Json::fail('Team not found', 404);

    // /api/tasks/teams/:id/members[/:userId] — roster CRUD (057).
    if (($segs[3] ?? '') === 'members') {
        $userId = isset($segs[4]) ? (int)$segs[4] : null;
        if ($userId === null) {
            if ($method === 'GET') {
                $stmt = $pdo->prepare("
                    SELECT u.id, u.email, u.display_name, u.role, u.is_active, m.created_at
                    FROM task_team_members m
                    JOIN admin_users u ON u.id = m.user_id
                    WHERE m.team_id = ?
                    ORDER BY u.display_name, u.email
                ");
                $stmt->execute([$id]);
                Json::send(['members' => $stmt->fetchAll()]);
            }
            if ($method === 'POST') {
                $b = Json::readBody();
                $uid = !empty($b['user_id']) ? (int)$b['user_id'] : 0;
                if ($uid <= 0) Json::fail('user_id required', 400);
                $check = $pdo->prepare('SELECT id FROM admin_users WHERE id = ?');
                $check->execute([$uid]);
                if (!$check->fetch()) Json::fail('User not found', 404);
                $pdo->prepare('INSERT IGNORE INTO task_team_members (team_id, user_id) VALUES (?,?)')
                    ->execute([$id, $uid]);
                Json::send(['ok' => true]);
            }
            Json::fail('Method not allowed', 405);
        }
        if ($method === 'DELETE') {
            $pdo->prepare('DELETE FROM task_team_members WHERE team_id = ? AND user_id = ?')
                ->execute([$id, $userId]);
            Json::send(['ok' => true]);
        }
        Json::fail('Method not allowed', 405);
    }

    if ($method === 'GET') Json::send(['team' => $team]);
    if ($method === 'PUT') {
        $b = Json::readBody();
        $upd = $pdo->prepare('UPDATE task_teams SET name=?, description=?, icon=?, color=?, sort_order=? WHERE id = ?');
        $upd->execute([
            trim((string)($b['name'] ?? $team['name'])) ?: $team['name'],
            $b['description'] ?? $team['description'],
            $b['icon']  ?? $team['icon'],
            $b['color'] ?? $team['color'],
            (int)($b['sort_order'] ?? $team['sort_order']),
            $id,
        ]);
        Json::send(['ok' => true]);
    }
    if ($method === 'DELETE') {
        $pdo->prepare('DELETE FROM task_teams WHERE id = ?')->execute([$id]);
        Json::send(['ok' => true]);
    }
    Json::fail('Method not allowed', 405);
}

function handleProjects(\PDO $pdo, string $method, array $segs): void {
    if (!isset($segs[2])) {
        if ($method === 'GET') {
            $where = '';
            $params = [];
            if (!empty($_GET['team_id'])) { $where = 'WHERE p.team_id = ?'; $params[] = (int)$_GET['team_id']; }
            $stmt = $pdo->prepare("
                SELECT p.*,
                       t.slug AS team_slug, t.name AS team_name, t.color AS team_color,
                       (SELECT COUNT(*) FROM task_items i WHERE i.project_id = p.id) AS item_count,
                       c.name AS client_name
                FROM task_projects p
                JOIN task_teams t ON t.id = p.team_id
                LEFT JOIN clients c ON c.id = p.client_id
                $where
                ORDER BY p.sort_order, p.id DESC
            ");
            $stmt->execute($params);
            Json::send(['projects' => $stmt->fetchAll()]);
        }
        if ($method === 'POST') {
            $b = Json::readBody();
            $team = (int)($b['team_id'] ?? 0);
            $slug = strtolower(trim((string)($b['slug'] ?? '')));
            $name = trim((string)($b['name'] ?? ''));
            if ($team <= 0) Json::fail('Team required', 400);
            if (!preg_match('/^[a-z][a-z0-9_-]{0,79}$/', $slug)) Json::fail('Invalid slug', 400);
            if ($name === '') Json::fail('Name required', 400);
            $allowedStatuses = ['new','ongoing','testing','blocked','complete'];
            $status = in_array($b['status'] ?? '', $allowedStatuses, true) ? $b['status'] : 'new';

            // Service-first linking: when onboarding_client_id is provided we
            // derive client_id from the matching `clients` row by email.
            // Caller can still pass client_id directly for manual projects.
            $onboardingClientId = !empty($b['onboarding_client_id']) ? (int)$b['onboarding_client_id'] : null;
            $clientId = !empty($b['client_id']) ? (int)$b['client_id'] : null;
            if ($onboardingClientId && !$clientId) {
                $em = $pdo->prepare('SELECT c.id FROM onboarding_clients oc
                                     LEFT JOIN clients c ON LOWER(c.email) = LOWER(oc.client_email)
                                     WHERE oc.id = ? LIMIT 1');
                $em->execute([$onboardingClientId]);
                $row = $em->fetch();
                if ($row && !empty($row['id'])) $clientId = (int)$row['id'];
            }

            $ins = $pdo->prepare('INSERT INTO task_projects (team_id, slug, name, description, client_id, status, onboarding_client_id, sort_order) VALUES (?,?,?,?,?,?,?,?)');
            $ins->execute([$team, $slug, $name, $b['description'] ?? null, $clientId, $status, $onboardingClientId, (int)($b['sort_order'] ?? 0)]);
            Json::send(['id' => (int)$pdo->lastInsertId()], 201);
        }
        Json::fail('Method not allowed', 405);
    }
    $id = (int)$segs[2];
    $row = $pdo->prepare('
        SELECT p.*, t.slug AS team_slug, t.name AS team_name, t.color AS team_color, c.name AS client_name
        FROM task_projects p
        JOIN task_teams t ON t.id = p.team_id
        LEFT JOIN clients c ON c.id = p.client_id
        WHERE p.id = ?');
    $row->execute([$id]);
    $project = $row->fetch();
    if (!$project) Json::fail('Project not found', 404);
    if ($method === 'GET') Json::send(['project' => $project]);
    if ($method === 'PUT') {
        $b = Json::readBody();
        $allowedStatuses = ['new','ongoing','testing','blocked','complete'];
        $status = array_key_exists('status', $b) && in_array($b['status'], $allowedStatuses, true)
            ? $b['status'] : $project['status'];

        // Service-first linking. If onboarding_client_id is in the body we
        // re-derive client_id from the email match; otherwise keep whatever
        // the caller passed (or the existing value).
        $hasOcid = array_key_exists('onboarding_client_id', $b);
        $onboardingClientId = $hasOcid
            ? (!empty($b['onboarding_client_id']) ? (int)$b['onboarding_client_id'] : null)
            : $project['onboarding_client_id'];
        $clientId = array_key_exists('client_id', $b)
            ? (!empty($b['client_id']) ? (int)$b['client_id'] : null)
            : $project['client_id'];
        if ($hasOcid) {
            // Re-derive client_id from the new service link unless caller also
            // explicitly passed client_id (caller wins).
            if (!array_key_exists('client_id', $b)) {
                $clientId = null;
                if ($onboardingClientId) {
                    $em = $pdo->prepare('SELECT c.id FROM onboarding_clients oc
                                         LEFT JOIN clients c ON LOWER(c.email) = LOWER(oc.client_email)
                                         WHERE oc.id = ? LIMIT 1');
                    $em->execute([$onboardingClientId]);
                    $row = $em->fetch();
                    if ($row && !empty($row['id'])) $clientId = (int)$row['id'];
                }
            }
        }

        $upd = $pdo->prepare('UPDATE task_projects SET name=?, description=?, client_id=?, onboarding_client_id=?, status=?, sort_order=? WHERE id = ?');
        $upd->execute([
            trim((string)($b['name'] ?? $project['name'])) ?: $project['name'],
            $b['description'] ?? $project['description'],
            $clientId,
            $onboardingClientId,
            $status,
            (int)($b['sort_order'] ?? $project['sort_order']),
            $id,
        ]);
        Json::send(['ok' => true]);
    }
    if ($method === 'DELETE') {
        $pdo->prepare('DELETE FROM task_projects WHERE id = ?')->execute([$id]);
        Json::send(['ok' => true]);
    }
    Json::fail('Method not allowed', 405);
}

function handleTypes(\PDO $pdo, string $method, array $segs): void {
    if (!isset($segs[2])) {
        if ($method === 'GET') {
            Json::send(['types' => $pdo->query('SELECT * FROM task_item_types ORDER BY sort_order, id')->fetchAll()]);
        }
        if ($method === 'POST') {
            $b = Json::readBody();
            $slug = strtolower(trim((string)($b['slug'] ?? '')));
            $name = trim((string)($b['name'] ?? ''));
            if (!preg_match('/^[a-z][a-z0-9_-]{0,39}$/', $slug)) Json::fail('Invalid slug', 400);
            if ($name === '') Json::fail('Name required', 400);
            $ins = $pdo->prepare('INSERT INTO task_item_types (slug, name, color, icon, sort_order, is_default) VALUES (?,?,?,?,?,?)');
            $ins->execute([$slug, $name, $b['color'] ?? null, $b['icon'] ?? null, (int)($b['sort_order'] ?? 0), !empty($b['is_default']) ? 1 : 0]);
            Json::send(['id' => (int)$pdo->lastInsertId()], 201);
        }
        Json::fail('Method not allowed', 405);
    }
    $id = (int)$segs[2];
    $row = $pdo->prepare('SELECT * FROM task_item_types WHERE id = ?'); $row->execute([$id]);
    $type = $row->fetch();
    if (!$type) Json::fail('Type not found', 404);
    if ($method === 'PUT') {
        $b = Json::readBody();
        $pdo->prepare('UPDATE task_item_types SET name=?, color=?, icon=?, sort_order=?, is_default=? WHERE id = ?')->execute([
            trim((string)($b['name'] ?? $type['name'])) ?: $type['name'],
            $b['color'] ?? $type['color'],
            $b['icon']  ?? $type['icon'],
            (int)($b['sort_order'] ?? $type['sort_order']),
            !empty($b['is_default']) ? 1 : 0,
            $id,
        ]);
        Json::send(['ok' => true]);
    }
    if ($method === 'DELETE') {
        $pdo->prepare('DELETE FROM task_item_types WHERE id = ?')->execute([$id]);
        Json::send(['ok' => true]);
    }
    Json::fail('Method not allowed', 405);
}

function handleStates(\PDO $pdo, string $method, array $segs): void {
    if (!isset($segs[2])) {
        if ($method === 'GET') {
            Json::send(['states' => $pdo->query('SELECT * FROM task_item_states ORDER BY sort_order, id')->fetchAll()]);
        }
        if ($method === 'POST') {
            $b = Json::readBody();
            $slug = strtolower(trim((string)($b['slug'] ?? '')));
            $name = trim((string)($b['name'] ?? ''));
            if (!preg_match('/^[a-z][a-z0-9_-]{0,39}$/', $slug)) Json::fail('Invalid slug', 400);
            if ($name === '') Json::fail('Name required', 400);
            $ins = $pdo->prepare('INSERT INTO task_item_states (slug, name, color, sort_order, is_terminal, is_default_new) VALUES (?,?,?,?,?,?)');
            $ins->execute([$slug, $name, $b['color'] ?? null, (int)($b['sort_order'] ?? 0), !empty($b['is_terminal']) ? 1 : 0, !empty($b['is_default_new']) ? 1 : 0]);
            Json::send(['id' => (int)$pdo->lastInsertId()], 201);
        }
        Json::fail('Method not allowed', 405);
    }
    $id = (int)$segs[2];
    $row = $pdo->prepare('SELECT * FROM task_item_states WHERE id = ?'); $row->execute([$id]);
    $state = $row->fetch();
    if (!$state) Json::fail('State not found', 404);
    if ($method === 'PUT') {
        $b = Json::readBody();
        $pdo->prepare('UPDATE task_item_states SET name=?, color=?, sort_order=?, is_terminal=?, is_default_new=? WHERE id = ?')->execute([
            trim((string)($b['name'] ?? $state['name'])) ?: $state['name'],
            $b['color'] ?? $state['color'],
            (int)($b['sort_order'] ?? $state['sort_order']),
            !empty($b['is_terminal']) ? 1 : 0,
            !empty($b['is_default_new']) ? 1 : 0,
            $id,
        ]);
        Json::send(['ok' => true]);
    }
    if ($method === 'DELETE') {
        $pdo->prepare('DELETE FROM task_item_states WHERE id = ?')->execute([$id]);
        Json::send(['ok' => true]);
    }
    Json::fail('Method not allowed', 405);
}

function handleItems(\PDO $pdo, string $method, array $segs): void {
    if (!isset($segs[2])) {
        if ($method === 'GET') {
            $where = []; $params = [];
            if (!empty($_GET['project_id']))   { $where[] = 'i.project_id = ?';   $params[] = (int)$_GET['project_id']; }
            if (isset($_GET['iteration_id']))  {
                if ($_GET['iteration_id'] === 'null' || $_GET['iteration_id'] === '') {
                    $where[] = 'i.iteration_id IS NULL';
                } else {
                    $where[] = 'i.iteration_id = ?'; $params[] = (int)$_GET['iteration_id'];
                }
            }
            $sql = '
                SELECT i.*,
                       t.slug AS type_slug, t.name AS type_name, t.color AS type_color, t.icon AS type_icon,
                       s.slug AS state_slug, s.name AS state_name, s.color AS state_color, s.is_terminal AS state_is_terminal,
                       u.display_name AS assignee_name, u.email AS assignee_email
                FROM task_items i
                JOIN task_item_types  t ON t.id = i.type_id
                JOIN task_item_states s ON s.id = i.state_id
                LEFT JOIN admin_users u ON u.id = i.assigned_to'
                . ($where ? ' WHERE ' . implode(' AND ', $where) : '')
                . ' ORDER BY i.sort_order, i.id DESC';
            $stmt = $pdo->prepare($sql); $stmt->execute($params);
            Json::send(['items' => $stmt->fetchAll()]);
        }
        if ($method === 'POST') {
            $b = Json::readBody();
            $project = (int)($b['project_id'] ?? 0);
            $title   = trim((string)($b['title'] ?? ''));
            if ($project <= 0) Json::fail('project_id required', 400);
            if ($title === '') Json::fail('title required', 400);

            // Resolve type and state — fall back to defaults if not provided
            $typeId  = !empty($b['type_id'])  ? (int)$b['type_id']  : null;
            if (!$typeId) $typeId = (int)($pdo->query('SELECT id FROM task_item_types WHERE is_default = 1 ORDER BY sort_order LIMIT 1')->fetchColumn() ?: $pdo->query('SELECT id FROM task_item_types ORDER BY sort_order LIMIT 1')->fetchColumn());
            $stateId = !empty($b['state_id']) ? (int)$b['state_id'] : null;
            if (!$stateId) $stateId = (int)($pdo->query('SELECT id FROM task_item_states WHERE is_default_new = 1 ORDER BY sort_order LIMIT 1')->fetchColumn() ?: $pdo->query('SELECT id FROM task_item_states ORDER BY sort_order LIMIT 1')->fetchColumn());

            $ins = $pdo->prepare('INSERT INTO task_items
                (project_id, parent_id, type_id, state_id, iteration_id, assigned_to,
                 title, description, acceptance_criteria, priority,
                 effort_mode, story_points, effort_days, remaining_days, completed_days,
                 board_column, sort_order)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
            $ins->execute([
                $project,
                !empty($b['parent_id'])    ? (int)$b['parent_id']    : null,
                $typeId,
                $stateId,
                !empty($b['iteration_id']) ? (int)$b['iteration_id'] : null,
                !empty($b['assigned_to'])  ? (int)$b['assigned_to']  : null,
                $title,
                $b['description']         ?? null,
                $b['acceptance_criteria'] ?? null,
                (int)($b['priority'] ?? 2),
                in_array($b['effort_mode'] ?? '', ['points','days'], true) ? $b['effort_mode'] : null,
                isset($b['story_points'])   ? (float)$b['story_points']   : null,
                isset($b['effort_days'])    ? (float)$b['effort_days']    : null,
                isset($b['remaining_days']) ? (float)$b['remaining_days'] : null,
                isset($b['completed_days']) ? (float)$b['completed_days'] : null,
                trim((string)($b['board_column'] ?? 'todo')) ?: 'todo',
                (int)($b['sort_order'] ?? 0),
            ]);
            Json::send(['id' => (int)$pdo->lastInsertId()], 201);
        }
        Json::fail('Method not allowed', 405);
    }
    $id = (int)$segs[2];
    $row = $pdo->prepare('
        SELECT i.*,
               t.slug AS type_slug, t.name AS type_name, t.color AS type_color, t.icon AS type_icon,
               s.slug AS state_slug, s.name AS state_name, s.color AS state_color, s.is_terminal AS state_is_terminal,
               u.display_name AS assignee_name, u.email AS assignee_email
        FROM task_items i
        JOIN task_item_types  t ON t.id = i.type_id
        JOIN task_item_states s ON s.id = i.state_id
        LEFT JOIN admin_users u ON u.id = i.assigned_to
        WHERE i.id = ?');
    $row->execute([$id]);
    $item = $row->fetch();
    if (!$item) Json::fail('Item not found', 404);
    if ($method === 'GET') Json::send(['item' => $item]);
    if ($method === 'PUT') {
        $b = Json::readBody();
        $closed = null;
        if (isset($b['state_id'])) {
            $st = $pdo->prepare('SELECT is_terminal FROM task_item_states WHERE id = ?');
            $st->execute([(int)$b['state_id']]);
            $term = (int)$st->fetchColumn();
            $closed = $term ? date('Y-m-d H:i:s') : null;
        }
        $upd = $pdo->prepare('UPDATE task_items SET
            type_id=?, state_id=?, parent_id=?, iteration_id=?, assigned_to=?,
            title=?, description=?, acceptance_criteria=?, priority=?,
            effort_mode=?, story_points=?, effort_days=?, remaining_days=?, completed_days=?,
            board_column=?, sort_order=?, closed_at=?
            WHERE id = ?');
        $upd->execute([
            isset($b['type_id'])     ? (int)$b['type_id']     : $item['type_id'],
            isset($b['state_id'])    ? (int)$b['state_id']    : $item['state_id'],
            array_key_exists('parent_id',    $b) ? (!empty($b['parent_id'])    ? (int)$b['parent_id']    : null) : $item['parent_id'],
            array_key_exists('iteration_id', $b) ? (!empty($b['iteration_id']) ? (int)$b['iteration_id'] : null) : $item['iteration_id'],
            array_key_exists('assigned_to',  $b) ? (!empty($b['assigned_to'])  ? (int)$b['assigned_to']  : null) : $item['assigned_to'],
            isset($b['title'])               ? trim((string)$b['title'])      : $item['title'],
            array_key_exists('description', $b)         ? $b['description']         : $item['description'],
            array_key_exists('acceptance_criteria', $b) ? $b['acceptance_criteria'] : $item['acceptance_criteria'],
            isset($b['priority']) ? (int)$b['priority'] : $item['priority'],
            isset($b['effort_mode']) ? (in_array($b['effort_mode'], ['points','days'], true) ? $b['effort_mode'] : null) : $item['effort_mode'],
            isset($b['story_points'])   ? (float)$b['story_points']   : $item['story_points'],
            isset($b['effort_days'])    ? (float)$b['effort_days']    : $item['effort_days'],
            isset($b['remaining_days']) ? (float)$b['remaining_days'] : $item['remaining_days'],
            isset($b['completed_days']) ? (float)$b['completed_days'] : $item['completed_days'],
            isset($b['board_column']) ? trim((string)$b['board_column']) : $item['board_column'],
            isset($b['sort_order'])   ? (int)$b['sort_order'] : $item['sort_order'],
            $closed !== null ? $closed : $item['closed_at'],
            $id,
        ]);
        Json::send(['ok' => true]);
    }
    if ($method === 'DELETE') {
        $pdo->prepare('DELETE FROM task_items WHERE id = ?')->execute([$id]);
        Json::send(['ok' => true]);
    }
    Json::fail('Method not allowed', 405);
}

function handleIterations(\PDO $pdo, string $method, array $segs): void {
    if (!isset($segs[2])) {
        if ($method === 'GET') {
            $where = []; $params = [];
            if (!empty($_GET['project_id'])) {
                $where[] = 'project_id = ?'; $params[] = (int)$_GET['project_id'];
            }
            $sql = 'SELECT * FROM task_iterations'
                . ($where ? ' WHERE ' . implode(' AND ', $where) : '')
                . ' ORDER BY sort_order DESC, id DESC';
            $stmt = $pdo->prepare($sql); $stmt->execute($params);
            Json::send(['iterations' => $stmt->fetchAll()]);
        }
        if ($method === 'POST') {
            $b = Json::readBody();
            $project = (int)($b['project_id'] ?? 0);
            $name    = trim((string)($b['name'] ?? ''));
            if ($project <= 0) Json::fail('project_id required', 400);
            if ($name === '')   Json::fail('name required', 400);
            // Resolve the value first, THEN validate. The previous form
            // (`in_array($b['x'] ?? 'default', …) ? $b['x'] : 'default'`) had
            // a bug: when the key is missing, the in_array fallback makes
            // the check pass, but the consequence returns the missing $b['x']
            // (= null), which then violates the NOT NULL column constraint.
            $state  = $b['state']       ?? 'planning';
            if (!in_array($state, ['planning','active','closed'], true))  $state  = 'planning';
            $effort = $b['effort_mode'] ?? 'days';
            if (!in_array($effort, ['points','days'], true))              $effort = 'days';
            $ins = $pdo->prepare('INSERT INTO task_iterations
                (project_id, name, start_date, end_date, goal, state, effort_mode, sort_order)
                VALUES (?,?,?,?,?,?,?,?)');
            $ins->execute([
                $project, $name,
                $b['start_date'] ?: null,
                $b['end_date']   ?: null,
                $b['goal']       ?: null,
                $state,
                $effort,
                (int)($b['sort_order'] ?? 0),
            ]);
            Json::send(['id' => (int)$pdo->lastInsertId()], 201);
        }
        Json::fail('Method not allowed', 405);
    }
    $id  = (int)$segs[2];
    $row = $pdo->prepare('SELECT * FROM task_iterations WHERE id = ?'); $row->execute([$id]);
    $itn = $row->fetch();
    if (!$itn) Json::fail('Iteration not found', 404);
    if ($method === 'GET') Json::send(['iteration' => $itn]);
    if ($method === 'PUT') {
        $b = Json::readBody();
        $state = isset($b['state']) && in_array($b['state'], ['planning','active','closed'], true) ? $b['state'] : $itn['state'];
        $effort = isset($b['effort_mode']) && in_array($b['effort_mode'], ['points','days'], true) ? $b['effort_mode'] : $itn['effort_mode'];
        $pdo->prepare('UPDATE task_iterations
            SET name=?, start_date=?, end_date=?, goal=?, state=?, effort_mode=?, sort_order=? WHERE id = ?')->execute([
            trim((string)($b['name'] ?? $itn['name'])) ?: $itn['name'],
            array_key_exists('start_date', $b) ? ($b['start_date'] ?: null) : $itn['start_date'],
            array_key_exists('end_date',   $b) ? ($b['end_date']   ?: null) : $itn['end_date'],
            array_key_exists('goal',       $b) ? ($b['goal']       ?: null) : $itn['goal'],
            $state,
            $effort,
            isset($b['sort_order']) ? (int)$b['sort_order'] : (int)$itn['sort_order'],
            $id,
        ]);
        Json::send(['ok' => true]);
    }
    if ($method === 'DELETE') {
        $pdo->prepare('UPDATE task_items SET iteration_id = NULL WHERE iteration_id = ?')->execute([$id]);
        $pdo->prepare('DELETE FROM task_iterations WHERE id = ?')->execute([$id]);
        Json::send(['ok' => true]);
    }
    Json::fail('Method not allowed', 405);
}
