<?php
declare(strict_types=1);

use BRS\Auth;
use BRS\Db;
use BRS\Json;
use BRS\Tenant;

/*
 * Service offerings CRUD — the company's catalogue of sellable services,
 * surfaced on the CRM Services page (/admin/services).
 *
 *   GET    /api/services            list (newest active first)
 *   POST   /api/services            create
 *   GET    /api/services/:id        read one
 *   PUT    /api/services/:id        update
 *   DELETE /api/services/:id        delete
 *
 * NB: this is distinct from GET /api/clients/:id/services (a client's
 * qualified onboarding services) — that lives in clients.php.
 */

return function (string $method, array $segs): void {
    $claims = Auth::require();
    $pdo = Db::tpdo();

    $payTypes = ['one_off', 'recurring'];
    $cadences = ['weekly', 'monthly', 'quarterly', 'yearly'];

    if (!isset($segs[1])) {
        if ($method === 'GET') {
            $rows = $pdo->query(
                'SELECT * FROM service_offerings ORDER BY is_active DESC, sort_order, id DESC'
            )->fetchAll();
            Json::send(['services' => $rows]);
        }
        if ($method === 'POST') {
            $body = Json::readBody();
            $name = trim((string)($body['name'] ?? ''));
            if ($name === '') Json::fail('Name is required', 400);

            $payType = $body['payment_type'] ?? 'one_off';
            if (!in_array($payType, $payTypes, true)) $payType = 'one_off';
            // Cadence only applies to recurring; null otherwise.
            $cadence = null;
            if ($payType === 'recurring') {
                $cadence = $body['repeat_duration'] ?? null;
                if (!in_array($cadence, $cadences, true)) $cadence = null;
            }
            $currency = strtoupper(trim((string)($body['currency'] ?? 'GBP')));
            if (strlen($currency) !== 3) $currency = 'GBP';

            // Variable-price services still keep the catalogue price —
            // it's the default that pre-fills each attach form. The flag
            // only signals that the attach picker should let staff
            // override it before saving.
            $isVariable = !empty($body['is_variable_price']) ? 1 : 0;
            $priceVal = (isset($body['price']) && $body['price'] !== '' && $body['price'] !== null)
                ? (float)$body['price']
                : null;

            $ins = $pdo->prepare(
                'INSERT INTO service_offerings
                 (name, description, price, is_variable_price, currency, payment_type, repeat_duration, is_active, allow_multiple, sort_order)
                 VALUES (?,?,?,?,?,?,?,?,?,?)'
            );
            $ins->execute([
                $name,
                trim((string)($body['description'] ?? '')) ?: null,
                $priceVal,
                $isVariable,
                $currency,
                $payType,
                $cadence,
                array_key_exists('is_active', $body) ? (!empty($body['is_active']) ? 1 : 0) : 1,
                !empty($body['allow_multiple']) ? 1 : 0,
                (int)($body['sort_order'] ?? 0),
            ]);
            Json::send(['id' => (int)$pdo->lastInsertId()], 201);
        }
        Json::fail('Method not allowed', 405);
    }

    $id = (int)$segs[1];
    if ($id <= 0) Json::fail('Invalid id', 400);

    $stmt = $pdo->prepare('SELECT * FROM service_offerings WHERE id = ?');
    $stmt->execute([$id]);
    $service = $stmt->fetch();
    if (!$service) Json::fail('Service not found', 404);

    // /api/services/:id/clients — distinct list of clients currently
    // tied to this catalogue row + the navigation context needed to
    // drill into their onboarding / task project. Two source paths,
    // merged + ordered by source then name:
    //   1. client_service_offerings rows directly linking a client to
    //      this service (the catalogue-attach pattern from migration 089)
    //   2. onboarding_clients (any state) whose form is linked to this
    //      service via forms.service_offering_id (migration 113)
    //
    // Status (migration 114) is resolved per source:
    //   - catalogue rows expose `cso.status` directly + the link id so
    //     the panel can PUT updates against it.
    //   - onboarding rows compute on the fly:
    //       qualified_at IS NULL                   → 'onboarding'
    //       qualified but no task project          → 'pending'
    //       project status 'new'                   → 'started'
    //       project status 'ongoing'/'testing'/
    //                      'blocked'               → 'ongoing'
    //       project status 'complete'              → 'complete'
    if (($segs[2] ?? '') === 'clients' && $method === 'GET') {
        // @global-scope: the TenantSqlRewriter can't reason about the
        // alias scoping inside a UNION ALL, so we use the raw PDO and
        // add explicit tenant_id filters on every inner SELECT. Same
        // safety guarantee, manually expressed.
        $tid  = Tenant::id();
        $rawPdo = Db::pdo();
        // De-dup rules:
        //  1. Catalogue row is authoritative — every catalogue attach
        //     gets one row no matter how many onboarding invites the
        //     client has (since the catalogue row was auto-created
        //     from the FIRST submission and then tracked through the
        //     workflow).
        //  2. Onboarding-only rows show ONLY when the email doesn't
        //     match an existing catalogue row for this service. They
        //     also collapse to one row per email — newest invite wins.
        $sql = "
            SELECT c.id                AS client_id,
                   c.name              AS name,
                   LOWER(c.email)      AS email,
                   c.company           AS company,
                   'catalogue'         AS source,
                   cso.id              AS link_id,
                   cso.status          AS status,
                   NULL                AS form_id,
                   NULL                AS onboarding_client_id,
                   NULL                AS project_id,
                   NULL                AS project_slug,
                   NULL                AS project_team_id
              FROM client_service_offerings cso
              JOIN clients c ON c.id = cso.client_id
             WHERE cso.service_offering_id = ?
               AND cso.tenant_id = ?
               AND c.tenant_id   = ?

            UNION ALL

            SELECT NULL                          AS client_id,
                   oc.client_name                AS name,
                   LOWER(oc.client_email)        AS email,
                   NULL                          AS company,
                   'onboarding'                  AS source,
                   NULL                          AS link_id,
                   CASE
                     WHEN oc.submitted_at IS NULL  AND oc.qualified_at IS NULL THEN 'onboarding'
                     WHEN oc.qualified_at IS NULL                              THEN 'submitted'
                     WHEN tp.id IS NULL                                        THEN 'qualified'
                     WHEN tp.status = 'new'                                    THEN 'to_do'
                     WHEN tp.status IN ('ongoing','testing','blocked')         THEN 'in_progress'
                     WHEN tp.status = 'complete'                               THEN 'done'
                     ELSE 'qualified'
                   END                            AS status,
                   f.id                           AS form_id,
                   oc.id                          AS onboarding_client_id,
                   tp.id                          AS project_id,
                   tp.slug                        AS project_slug,
                   tp.team_id                     AS project_team_id
              FROM onboarding_clients oc
              JOIN forms f ON f.id = oc.form_id
              LEFT JOIN task_projects tp ON tp.onboarding_client_id = oc.id
             WHERE f.service_offering_id = ?
               AND oc.tenant_id = ?
               AND f.tenant_id  = ?
               -- one row per onboarding-only email: keep newest invite
               AND oc.id = (
                 SELECT MAX(oc2.id) FROM onboarding_clients oc2
                   JOIN forms f2 ON f2.id = oc2.form_id
                  WHERE LOWER(oc2.client_email) = LOWER(oc.client_email)
                    AND f2.service_offering_id  = f.service_offering_id
                    AND oc2.tenant_id = ?
               )
               -- drop onboarding rows that already have a catalogue match
               AND NOT EXISTS (
                 SELECT 1 FROM client_service_offerings cso2
                   JOIN clients c2 ON c2.id = cso2.client_id
                  WHERE cso2.service_offering_id = f.service_offering_id
                    AND LOWER(c2.email)          = LOWER(oc.client_email)
                    AND cso2.tenant_id = ?
                    AND c2.tenant_id   = ?
               )
            ORDER BY source, name, email
            LIMIT 400
        ";
        $stmt = $rawPdo->prepare($sql);
        $stmt->execute([$id, $tid, $tid, $id, $tid, $tid, $tid, $tid, $tid]);
        Json::send(['clients' => $stmt->fetchAll()]);
    }

    // GET /api/services/:id/onboarding — returns the onboarding form
    // (if any) currently linked to this service via
    // forms.service_offering_id. There's only one expected per service
    // in practice; if more exist we return the newest.
    if (($segs[2] ?? '') === 'onboarding' && $method === 'GET') {
        $stmt = $pdo->prepare(
            "SELECT id, slug, title, is_published, created_at
               FROM forms
              WHERE form_type = 'onboarding'
                AND service_offering_id = ?
              ORDER BY id DESC
              LIMIT 1"
        );
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        Json::send(['form' => $row ?: null]);
    }

    // /api/services/:id/client/:key — single-row detail used by the
    // standalone client/service tracking page. `key` encodes the row's
    // origin so we can fetch from the right table:
    //   "cat-<linkId>" → client_service_offerings.id
    //   "onb-<ocId>"   → onboarding_clients.id
    //
    // Same fields as the list endpoint plus the canonical service
    // record (so the page can render service name + price without a
    // second round-trip) and the linked clients row for catalogue.
    if (($segs[2] ?? '') === 'client' && isset($segs[3]) && $method === 'GET') {
        $key = (string)$segs[3];
        $tid    = Tenant::id();
        $rawPdo = Db::pdo();

        if (preg_match('/^cat-(\d+)$/', $key, $m)) {
            // @global-scope: explicit tenant filter on every joined row.
            $sql = 'SELECT cso.id              AS link_id,
                           cso.status          AS status,
                           cso.service_offering_id,
                           c.id                AS client_id,
                           c.name              AS name,
                           LOWER(c.email)      AS email,
                           c.phone             AS phone,
                           c.company           AS company,
                           c.address           AS address,
                           c.url               AS website,
                           c.notes             AS notes,
                           c.created_at        AS client_created_at,
                           NULL                AS form_id,
                           NULL                AS form_title,
                           NULL                AS onboarding_client_id,
                           NULL                AS submitted_at,
                           NULL                AS qualified_at,
                           NULL                AS project_id,
                           NULL                AS project_slug,
                           NULL                AS project_team_id,
                           NULL                AS project_status,
                           "catalogue"        AS source
                      FROM client_service_offerings cso
                      JOIN clients c ON c.id = cso.client_id
                     WHERE cso.id = ?
                       AND cso.service_offering_id = ?
                       AND cso.tenant_id = ?
                       AND c.tenant_id   = ?
                     LIMIT 1';
            $stmt = $rawPdo->prepare($sql);
            $stmt->execute([(int)$m[1], $id, $tid, $tid]);
        } elseif (preg_match('/^onb-(\d+)$/', $key, $m)) {
            $sql = "SELECT NULL                          AS link_id,
                           CASE
                             WHEN oc.submitted_at IS NULL AND oc.qualified_at IS NULL THEN 'onboarding'
                             WHEN oc.qualified_at IS NULL                              THEN 'submitted'
                             WHEN tp.id IS NULL                                        THEN 'qualified'
                             WHEN tp.status = 'new'                                    THEN 'to_do'
                             WHEN tp.status IN ('ongoing','testing','blocked')         THEN 'in_progress'
                             WHEN tp.status = 'complete'                               THEN 'done'
                             ELSE 'qualified'
                           END                            AS status,
                           f.service_offering_id          AS service_offering_id,
                           NULL                           AS client_id,
                           oc.client_name                 AS name,
                           LOWER(oc.client_email)         AS email,
                           NULL                           AS phone,
                           NULL                           AS company,
                           NULL                           AS address,
                           NULL                           AS website,
                           NULL                           AS notes,
                           NULL                           AS client_created_at,
                           f.id                           AS form_id,
                           f.title                        AS form_title,
                           oc.id                          AS onboarding_client_id,
                           oc.submitted_at                AS submitted_at,
                           oc.qualified_at                AS qualified_at,
                           tp.id                          AS project_id,
                           tp.slug                        AS project_slug,
                           tp.team_id                     AS project_team_id,
                           tp.status                      AS project_status,
                           'onboarding'                   AS source
                      FROM onboarding_clients oc
                      JOIN forms f ON f.id = oc.form_id
                      LEFT JOIN task_projects tp ON tp.onboarding_client_id = oc.id
                     WHERE oc.id = ?
                       AND f.service_offering_id = ?
                       AND oc.tenant_id = ?
                       AND f.tenant_id  = ?
                     LIMIT 1";
            $stmt = $rawPdo->prepare($sql);
            $stmt->execute([(int)$m[1], $id, $tid, $tid]);
        } else {
            Json::fail('Invalid key', 400);
        }

        $row = $stmt->fetch();
        if (!$row) Json::fail('Client not found on this service', 404);
        Json::send(['client' => $row, 'service' => $service]);
    }

    // PUT /api/services/:id/clients/:linkId/status — change the
    // workflow status on a catalogue-attached client_service_offerings
    // row. 8-state workflow:
    //   onboarding phase: new → onboarding → submitted → qualified
    //   work phase:       to_do → in_progress → done (+ on_hold)
    //
    // Each onboarding-phase transition auto-creates a CRM task so
    // the admin sees the next action on the task board. Reaching
    // qualified also auto-bumps the row to to_do so the work phase
    // starts immediately (with its own "deliver" task).
    if (($segs[2] ?? '') === 'clients'
        && ($segs[4] ?? '') === 'status'
        && $method === 'PUT'
        && isset($segs[3])) {
        $linkId = (int)$segs[3];
        $body   = Json::readBody();
        $next   = (string)($body['status'] ?? '');
        $allowed = ['new','onboarding','submitted','qualified','to_do','in_progress','done','on_hold'];
        if (!in_array($next, $allowed, true)) Json::fail('Invalid status', 400);

        // Guard: link must reference this service so admins can't flip
        // a row on a different service by guessing ids.
        $sel = $pdo->prepare(
            'SELECT cso.id, cso.client_id, cso.name AS service_name,
                    c.name AS client_name, c.email AS client_email
               FROM client_service_offerings cso
               JOIN clients c ON c.id = cso.client_id
              WHERE cso.id = ? AND cso.service_offering_id = ?'
        );
        $sel->execute([$linkId, $id]);
        $row = $sel->fetch();
        if (!$row) Json::fail('Service link not found', 404);

        // Reaching qualified is two writes: stamp qualified for the
        // audit trail, then immediately bump to to_do so the work
        // phase begins. The user sees to_do as the final state.
        $effective = $next === 'qualified' ? 'to_do' : $next;
        $pdo->prepare('UPDATE client_service_offerings SET status = ? WHERE id = ?')
            ->execute([$effective, $linkId]);

        // Auto-create a CRM task framing the next action for the
        // admin. Catalogue-flavoured title so it's obvious which
        // service+client it relates to from the board.
        $taskMap = [
            'new'        => ['title' => "Send onboarding link",    'category' => 'client',     'priority' => 'medium'],
            'onboarding' => ['title' => "Follow up on onboarding", 'category' => 'onboarding', 'priority' => 'medium'],
            'submitted'  => ['title' => "Approve onboarding",      'category' => 'onboarding', 'priority' => 'high'],
            'qualified'  => ['title' => "Deliver service",         'category' => 'service',    'priority' => 'high'],
        ];
        if (isset($taskMap[$next])) {
            $task    = $taskMap[$next];
            $label   = trim((string)($row['client_name'] ?? '')) ?: trim((string)($row['client_email'] ?? '')) ?: 'client';
            $title   = $task['title'] . ' — ' . $label . ' · ' . $row['service_name'];
            try {
                $pdo->prepare(
                    'INSERT INTO crm_tasks
                       (title, category, priority, status, service_client_link_id, created_by_user_id)
                     VALUES (?, ?, ?, ?, ?, ?)'
                )->execute([
                    $title,
                    $task['category'],
                    $task['priority'],
                    'to_do',
                    $linkId,
                    (int)$claims['sub'],
                ]);
            } catch (\Throwable $e) {
                error_log('[service-status] auto-task failed for link ' . $linkId . ': ' . $e->getMessage());
            }
        }

        Json::send(['ok' => true, 'status' => $effective]);
    }

    if ($method === 'GET') Json::send(['service' => $service]);

    if ($method === 'PUT') {
        $body = Json::readBody();
        $name = trim((string)($body['name'] ?? $service['name']));
        if ($name === '') Json::fail('Name is required', 400);

        $payType = array_key_exists('payment_type', $body) ? (string)$body['payment_type'] : (string)$service['payment_type'];
        if (!in_array($payType, $payTypes, true)) $payType = 'one_off';
        $cadence = null;
        if ($payType === 'recurring') {
            $cadence = array_key_exists('repeat_duration', $body) ? ($body['repeat_duration'] ?? null) : $service['repeat_duration'];
            if (!in_array($cadence, $cadences, true)) $cadence = null;
        }
        $currency = strtoupper(trim((string)($body['currency'] ?? $service['currency'])));
        if (strlen($currency) !== 3) $currency = (string)$service['currency'];

        $isVariable = array_key_exists('is_variable_price', $body)
            ? (!empty($body['is_variable_price']) ? 1 : 0)
            : (int)($service['is_variable_price'] ?? 0);
        // Keep the catalogue price even when is_variable_price=1 — it's
        // the default the attach form pre-fills. Empty/null incoming
        // price clears it; missing key leaves the existing value alone.
        $priceUpd = array_key_exists('price', $body)
            ? ($body['price'] === '' || $body['price'] === null ? null : (float)$body['price'])
            : $service['price'];

        $pdo->prepare(
            'UPDATE service_offerings
             SET name=?, description=?, price=?, is_variable_price=?, currency=?, payment_type=?, repeat_duration=?, is_active=?, allow_multiple=?, sort_order=?
             WHERE id = ?'
        )->execute([
            $name,
            array_key_exists('description', $body) ? (trim((string)$body['description']) ?: null) : $service['description'],
            $priceUpd,
            $isVariable,
            $currency,
            $payType,
            $cadence,
            array_key_exists('is_active', $body) ? (!empty($body['is_active']) ? 1 : 0) : (int)$service['is_active'],
            array_key_exists('allow_multiple', $body) ? (!empty($body['allow_multiple']) ? 1 : 0) : (int)$service['allow_multiple'],
            (int)($body['sort_order'] ?? $service['sort_order']),
            $id,
        ]);
        Json::send(['ok' => true]);
    }

    if ($method === 'DELETE') {
        $pdo->prepare('DELETE FROM service_offerings WHERE id = ?')->execute([$id]);
        Json::send(['ok' => true]);
    }

    Json::fail('Method not allowed', 405);
};
