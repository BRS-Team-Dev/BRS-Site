<?php
declare(strict_types=1);

use BRS\Auth;
use BRS\Db;
use BRS\Json;
use BRS\Tenant;

/*
 * Feedback forms — CRM-level questionnaires / feedback / surveys / polls.
 *
 *   GET    /api/feedback-forms                          list (+ filters)
 *   POST   /api/feedback-forms                          create
 *   GET    /api/feedback-forms/:id                      read (+ questions + counts)
 *   PUT    /api/feedback-forms/:id                      update metadata
 *   DELETE /api/feedback-forms/:id                      delete (cascades)
 *
 *   GET    /api/feedback-forms/:id/questions            list
 *   POST   /api/feedback-forms/:id/questions            create
 *   PUT    /api/feedback-forms/:id/questions/:qid       update
 *   DELETE /api/feedback-forms/:id/questions/:qid       delete
 *
 *   GET    /api/feedback-forms/:id/responses            list + answers
 *
 * Filters on the list endpoint:
 *   ?kind=questionnaire|form|survey|poll
 *   ?client=N
 *   ?lead=N
 *   ?service=N
 */
return function (string $method, array $segs): void {
    $claims = Auth::require();
    $pdo    = Db::tpdo();

    $allowedKinds = ['questionnaire','form','survey','poll'];
    $allowedTypes = ['short_text','long_text','rating','yes_no','single_choice','multi_choice'];

    // /api/feedback-forms (collection)
    if (!isset($segs[1])) {
        if ($method === 'GET') {
            $where = ['1 = 1'];
            $params = [];
            if (!empty($_GET['kind']) && in_array($_GET['kind'], $allowedKinds, true)) {
                $where[] = 'f.kind = ?'; $params[] = $_GET['kind'];
            }
            // Client/lead filters surface a form under a client/lead if
            // ANY of three links exist:
            //   1. the legacy single-owner column (pre-migration 120)
            //   2. the feedback_form_clients / _leads junction (explicit attach)
            //   3. a feedback_responses row tagged with this client/lead
            //      (i.e. the person already answered the form via a
            //      ?client=N / ?lead=N link — that counts as "their
            //      feedback" even without a manual attach)
            if (!empty($_GET['client'])) {
                $where[] = '(f.client_id = ?
                             OR EXISTS (SELECT 1 FROM feedback_form_clients ffc
                                         WHERE ffc.form_id = f.id AND ffc.client_id = ?)
                             OR EXISTS (SELECT 1 FROM feedback_responses fr
                                         WHERE fr.form_id = f.id AND fr.client_id = ?)
                             OR f.broadcast_to_all_clients = 1
                             OR (f.service_offering_id IS NOT NULL
                                 AND EXISTS (SELECT 1 FROM client_service_offerings cso
                                              WHERE cso.client_id = ?
                                                AND cso.service_offering_id = f.service_offering_id)))';
                $params[] = (int)$_GET['client'];
                $params[] = (int)$_GET['client'];
                $params[] = (int)$_GET['client'];
                $params[] = (int)$_GET['client'];
            }
            if (!empty($_GET['lead'])) {
                $where[] = '(f.lead_id = ?
                             OR EXISTS (SELECT 1 FROM feedback_form_leads ffl
                                         WHERE ffl.form_id = f.id AND ffl.lead_id = ?)
                             OR EXISTS (SELECT 1 FROM feedback_responses fr
                                         WHERE fr.form_id = f.id AND fr.lead_id = ?)
                             OR f.broadcast_to_all_leads = 1
                             OR (f.service_offering_id IS NOT NULL
                                 AND EXISTS (SELECT 1 FROM lead_services ls
                                              WHERE ls.lead_id = ?
                                                AND ls.service_offering_id = f.service_offering_id)))';
                $params[] = (int)$_GET['lead'];
                $params[] = (int)$_GET['lead'];
                $params[] = (int)$_GET['lead'];
                $params[] = (int)$_GET['lead'];
            }
            if (!empty($_GET['service'])) { $where[] = 'f.service_offering_id = ?';  $params[] = (int)$_GET['service']; }
            if (!empty($_GET['published'])) { $where[] = 'f.is_published = 1'; }

            // Emit a match_source annotation so the client / lead
            // detail tabs can segment the flat result into three buckets:
            //   'client' / 'lead' — explicitly attached (junction, legacy
            //       column, or already responded)
            //   'service' — matched because the client/lead has the
            //       service the form is tied to (match_service_name
            //       carries the service name for the section header)
            //   'broadcast' — broadcast_to_all_* flag set
            // We resolve to a SINGLE most-specific bucket per row so the
            // UI can render three clean sections without deduping.
            $extraSelect = '';
            $extraParams = [];
            $extraJoins  = 'LEFT JOIN admin_users au ON au.id = f.created_by_user_id
                            LEFT JOIN service_offerings so ON so.id = f.service_offering_id';
            if (!empty($_GET['client'])) {
                $cid = (int)$_GET['client'];
                $extraSelect = ",
                    CASE
                      WHEN f.client_id = ?
                        OR EXISTS (SELECT 1 FROM feedback_form_clients ffc
                                    WHERE ffc.form_id = f.id AND ffc.client_id = ?)
                        OR EXISTS (SELECT 1 FROM feedback_responses fr
                                    WHERE fr.form_id = f.id AND fr.client_id = ?)
                        THEN 'client'
                      WHEN f.service_offering_id IS NOT NULL
                        AND EXISTS (SELECT 1 FROM client_service_offerings cso
                                     WHERE cso.client_id = ?
                                       AND cso.service_offering_id = f.service_offering_id)
                        THEN 'service'
                      WHEN f.broadcast_to_all_clients = 1 THEN 'broadcast'
                      ELSE NULL
                    END AS match_source,
                    so.name AS match_service_name";
                $extraParams = [$cid, $cid, $cid, $cid];
            } elseif (!empty($_GET['lead'])) {
                $lid = (int)$_GET['lead'];
                $extraSelect = ",
                    CASE
                      WHEN f.lead_id = ?
                        OR EXISTS (SELECT 1 FROM feedback_form_leads ffl
                                    WHERE ffl.form_id = f.id AND ffl.lead_id = ?)
                        OR EXISTS (SELECT 1 FROM feedback_responses fr
                                    WHERE fr.form_id = f.id AND fr.lead_id = ?)
                        THEN 'lead'
                      WHEN f.service_offering_id IS NOT NULL
                        AND EXISTS (SELECT 1 FROM lead_services ls
                                     WHERE ls.lead_id = ?
                                       AND ls.service_offering_id = f.service_offering_id)
                        THEN 'service'
                      WHEN f.broadcast_to_all_leads = 1 THEN 'broadcast'
                      ELSE NULL
                    END AS match_source,
                    so.name AS match_service_name";
                $extraParams = [$lid, $lid, $lid, $lid];
            }

            $sql = "SELECT f.*,
                           au.display_name AS created_by_name,
                           (SELECT COUNT(*) FROM feedback_questions q WHERE q.form_id = f.id) AS question_count,
                           (SELECT COUNT(*) FROM feedback_responses r WHERE r.form_id = f.id) AS response_count
                           $extraSelect
                      FROM feedback_forms f
                      $extraJoins
                     WHERE " . implode(' AND ', $where) . "
                  ORDER BY f.id DESC
                     LIMIT 500";
            $stmt = $pdo->prepare($sql);
            // CASE parameters come BEFORE the WHERE parameters because
            // the CASE lives in the SELECT clause.
            $stmt->execute(array_merge($extraParams, $params));
            Json::send(['forms' => $stmt->fetchAll()]);
        }

        if ($method === 'POST') {
            $body  = Json::readBody();
            $title = trim((string)($body['title'] ?? ''));
            if ($title === '') Json::fail('Title is required', 400);

            $kind = (string)($body['kind'] ?? 'form');
            if (!in_array($kind, $allowedKinds, true)) $kind = 'form';

            $token = bin2hex(random_bytes(20)); // 40 hex chars

            $ins = $pdo->prepare(
                'INSERT INTO feedback_forms
                   (kind, title, description, intro_html, submit_label, thank_you_message,
                    public_token, is_published,
                    broadcast_to_all_clients, broadcast_to_all_leads,
                    client_id, lead_id, service_offering_id,
                    created_by_user_id)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
            );
            $ins->execute([
                $kind,
                $title,
                trim((string)($body['description'] ?? '')) ?: null,
                $body['intro_html'] ?? null,
                trim((string)($body['submit_label'] ?? 'Submit')) ?: 'Submit',
                $body['thank_you_message'] ?? null,
                $token,
                !empty($body['is_published']) ? 1 : 0,
                !empty($body['broadcast_to_all_clients']) ? 1 : 0,
                !empty($body['broadcast_to_all_leads'])   ? 1 : 0,
                !empty($body['client_id'])  ? (int)$body['client_id']  : null,
                !empty($body['lead_id'])    ? (int)$body['lead_id']    : null,
                !empty($body['service_offering_id']) ? (int)$body['service_offering_id'] : null,
                (int)$claims['sub'],
            ]);
            Json::send(['id' => (int)$pdo->lastInsertId(), 'public_token' => $token], 201);
        }

        Json::fail('Method not allowed', 405);
    }

    // /api/feedback-forms/:id (+ sub-paths)
    $id = (int)$segs[1];
    if ($id <= 0) Json::fail('Invalid id', 400);

    $sel = $pdo->prepare('SELECT * FROM feedback_forms WHERE id = ?');
    $sel->execute([$id]);
    $form = $sel->fetch();
    if (!$form) Json::fail('Form not found', 404);

    // /api/feedback-forms/:id/questions[/:qid]
    if (($segs[2] ?? '') === 'questions') {
        $qid = isset($segs[3]) ? (int)$segs[3] : 0;

        if ($qid === 0) {
            if ($method === 'GET') {
                $q = $pdo->prepare('SELECT * FROM feedback_questions WHERE form_id = ? ORDER BY sort_order, id');
                $q->execute([$id]);
                Json::send(['questions' => $q->fetchAll()]);
            }
            if ($method === 'POST') {
                $body  = Json::readBody();
                $label = trim((string)($body['label'] ?? ''));
                if ($label === '') Json::fail('Label is required', 400);
                $type = (string)($body['type'] ?? 'short_text');
                if (!in_array($type, $allowedTypes, true)) $type = 'short_text';
                $opts = $body['options_json'] ?? null;
                if (is_array($opts)) $opts = json_encode($opts);

                $insQ = $pdo->prepare(
                    'INSERT INTO feedback_questions
                       (form_id, type, label, help_text, options_json, is_required, sort_order)
                     VALUES (?,?,?,?,?,?,?)'
                );
                $insQ->execute([
                    $id,
                    $type,
                    $label,
                    trim((string)($body['help_text'] ?? '')) ?: null,
                    $opts,
                    !empty($body['is_required']) ? 1 : 0,
                    (int)($body['sort_order'] ?? 0),
                ]);
                Json::send(['id' => (int)$pdo->lastInsertId()], 201);
            }
            Json::fail('Method not allowed', 405);
        }

        // Per-question routes
        $qSel = $pdo->prepare('SELECT * FROM feedback_questions WHERE id = ? AND form_id = ?');
        $qSel->execute([$qid, $id]);
        $question = $qSel->fetch();
        if (!$question) Json::fail('Question not found', 404);

        if ($method === 'PUT') {
            $body = Json::readBody();
            $fields = []; $params = [];
            if (array_key_exists('label', $body)) {
                $l = trim((string)$body['label']);
                if ($l === '') Json::fail('Label is required', 400);
                $fields[] = 'label = ?'; $params[] = $l;
            }
            if (array_key_exists('type', $body)) {
                $t = (string)$body['type'];
                if (!in_array($t, $allowedTypes, true)) Json::fail('Invalid type', 400);
                $fields[] = 'type = ?'; $params[] = $t;
            }
            if (array_key_exists('help_text', $body))   { $fields[] = 'help_text = ?';   $params[] = trim((string)$body['help_text']) ?: null; }
            if (array_key_exists('options_json', $body)) {
                $opts = $body['options_json'];
                if (is_array($opts)) $opts = json_encode($opts);
                $fields[] = 'options_json = ?'; $params[] = $opts;
            }
            if (array_key_exists('is_required', $body)) { $fields[] = 'is_required = ?'; $params[] = !empty($body['is_required']) ? 1 : 0; }
            if (array_key_exists('sort_order', $body))  { $fields[] = 'sort_order = ?';  $params[] = (int)$body['sort_order']; }

            if ($fields) {
                $params[] = $qid;
                $pdo->prepare('UPDATE feedback_questions SET ' . implode(', ', $fields) . ' WHERE id = ?')
                    ->execute($params);
            }
            Json::send(['ok' => true]);
        }

        if ($method === 'DELETE') {
            $pdo->prepare('DELETE FROM feedback_questions WHERE id = ?')->execute([$qid]);
            Json::send(['ok' => true]);
        }
        Json::fail('Method not allowed', 405);
    }

    // /api/feedback-forms/:id/responses — list submissions with answers.
    // Accepts optional ?client=N / ?lead=N filters so the client/lead
    // detail tabs can show only THAT person's submissions inline.
    if (($segs[2] ?? '') === 'responses' && $method === 'GET') {
        $where  = ['r.form_id = ?'];
        $bind   = [$id];
        if (!empty($_GET['client'])) { $where[] = 'r.client_id = ?'; $bind[] = (int)$_GET['client']; }
        if (!empty($_GET['lead']))   { $where[] = 'r.lead_id = ?';   $bind[] = (int)$_GET['lead']; }
        $r = $pdo->prepare(
            'SELECT r.*, c.name AS client_name, l.name AS lead_name
               FROM feedback_responses r
          LEFT JOIN clients c ON c.id = r.client_id
          LEFT JOIN leads   l ON l.id = r.lead_id
              WHERE ' . implode(' AND ', $where) . '
           ORDER BY r.submitted_at DESC, r.id DESC
              LIMIT 1000'
        );
        $r->execute($bind);
        $responses = $r->fetchAll();
        if ($responses) {
            $ids = array_column($responses, 'id');
            $placeholders = implode(',', array_fill(0, count($ids), '?'));
            $a = $pdo->prepare("SELECT * FROM feedback_answers WHERE response_id IN ($placeholders)");
            $a->execute($ids);
            $answers = $a->fetchAll();
            $byResp = [];
            foreach ($answers as $row) {
                $byResp[(int)$row['response_id']][] = $row;
            }
            foreach ($responses as &$resp) {
                $resp['answers'] = $byResp[(int)$resp['id']] ?? [];
            }
            unset($resp);
        }
        Json::send(['responses' => $responses]);
    }

    // /api/feedback-forms/:id/clone
    // POST — duplicate the form (metadata + questions) and optionally
    // attach the clone to a service. Body: { service_offering_id?: N,
    // service_name?: string }. Used from the services page when the
    // source form is already broadcasting to all clients/leads (see
    // frontend attach flow) — cloning keeps the broadcast form
    // untouched while giving the service its own dedicated copy.
    if (($segs[2] ?? '') === 'clone' && $method === 'POST') {
        $body    = Json::readBody();
        $svcId   = !empty($body['service_offering_id']) ? (int)$body['service_offering_id'] : null;
        $svcName = trim((string)($body['service_name'] ?? ''));

        // Build the new title. Suffix with the service name if provided
        // so the copy is distinguishable in the list; fall back to
        // "(Copy)" when it's a plain duplicate with no service context.
        $suffix = $svcName !== '' ? " ($svcName)" : ' (Copy)';
        $newTitle = mb_substr((string)$form['title'], 0, 240) . $suffix;
        $token = bin2hex(random_bytes(20));

        $pdo->beginTransaction();
        try {
            $ins = $pdo->prepare(
                'INSERT INTO feedback_forms
                   (kind, title, description, intro_html, submit_label, thank_you_message,
                    public_token, is_published,
                    broadcast_to_all_clients, broadcast_to_all_leads,
                    client_id, lead_id, service_offering_id,
                    created_by_user_id)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
            );
            // Clone strips the broadcast flags — the whole point of the
            // clone-on-attach flow is that the SOURCE keeps broadcasting
            // and the SERVICE-scoped copy stands alone.
            $ins->execute([
                $form['kind'],
                $newTitle,
                $form['description'],
                $form['intro_html'],
                $form['submit_label'],
                $form['thank_you_message'],
                $token,
                (int)$form['is_published'],
                0,
                0,
                null,
                null,
                $svcId,
                (int)$claims['sub'],
            ]);
            $newId = (int)$pdo->lastInsertId();

            // Copy questions 1:1, preserving type/label/help_text/options
            // and sort order so the clone renders identically.
            $pdo->prepare(
                'INSERT INTO feedback_questions
                   (form_id, type, label, help_text, options_json, is_required, sort_order)
                 SELECT ?, type, label, help_text, options_json, is_required, sort_order
                   FROM feedback_questions WHERE form_id = ?'
            )->execute([$newId, $id]);

            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        Json::send(['id' => $newId, 'public_token' => $token], 201);
    }

    // /api/feedback-forms/:id/clients[/:cid]
    // POST  attach client to form   (idempotent — INSERT IGNORE)
    // DELETE detach — fully severs every link between form + client:
    //   1. the explicit feedback_form_clients junction row
    //   2. the legacy feedback_forms.client_id column (if it points here)
    //   3. any feedback_responses tagged to this client — client_id
    //      goes NULL so the row survives (analytics keep counting the
    //      submission, it just becomes anonymous). Wrap in a txn so
    //      partial state can't leak on error.
    if (($segs[2] ?? '') === 'clients') {
        $cid = isset($segs[3]) ? (int)$segs[3] : 0;
        if ($method === 'POST' && $cid === 0) {
            $body = Json::readBody();
            $cid  = (int)($body['client_id'] ?? 0);
            if ($cid <= 0) Json::fail('client_id is required', 400);
            $chk = $pdo->prepare('SELECT id FROM clients WHERE id = ?');
            $chk->execute([$cid]);
            if (!$chk->fetch()) Json::fail('Client not found', 404);
            $ins = Db::pdo()->prepare(
                'INSERT IGNORE INTO feedback_form_clients (tenant_id, form_id, client_id)
                 VALUES (?, ?, ?)'
            );
            $ins->execute([Tenant::id(), $id, $cid]);
            Json::send(['ok' => true]);
        }
        if ($method === 'DELETE' && $cid > 0) {
            $pdo->beginTransaction();
            try {
                $pdo->prepare('DELETE FROM feedback_form_clients WHERE form_id = ? AND client_id = ?')
                    ->execute([$id, $cid]);
                $pdo->prepare('UPDATE feedback_forms SET client_id = NULL WHERE id = ? AND client_id = ?')
                    ->execute([$id, $cid]);
                $pdo->prepare('UPDATE feedback_responses SET client_id = NULL WHERE form_id = ? AND client_id = ?')
                    ->execute([$id, $cid]);
                $pdo->commit();
            } catch (\Throwable $e) {
                $pdo->rollBack();
                throw $e;
            }
            Json::send(['ok' => true]);
        }
        Json::fail('Method not allowed', 405);
    }

    // /api/feedback-forms/:id/leads[/:lid]  — same semantics as clients above.
    if (($segs[2] ?? '') === 'leads') {
        $lid = isset($segs[3]) ? (int)$segs[3] : 0;
        if ($method === 'POST' && $lid === 0) {
            $body = Json::readBody();
            $lid  = (int)($body['lead_id'] ?? 0);
            if ($lid <= 0) Json::fail('lead_id is required', 400);
            $chk = $pdo->prepare('SELECT id FROM leads WHERE id = ?');
            $chk->execute([$lid]);
            if (!$chk->fetch()) Json::fail('Lead not found', 404);
            $ins = Db::pdo()->prepare(
                'INSERT IGNORE INTO feedback_form_leads (tenant_id, form_id, lead_id)
                 VALUES (?, ?, ?)'
            );
            $ins->execute([Tenant::id(), $id, $lid]);
            Json::send(['ok' => true]);
        }
        if ($method === 'DELETE' && $lid > 0) {
            $pdo->beginTransaction();
            try {
                $pdo->prepare('DELETE FROM feedback_form_leads WHERE form_id = ? AND lead_id = ?')
                    ->execute([$id, $lid]);
                $pdo->prepare('UPDATE feedback_forms SET lead_id = NULL WHERE id = ? AND lead_id = ?')
                    ->execute([$id, $lid]);
                $pdo->prepare('UPDATE feedback_responses SET lead_id = NULL WHERE form_id = ? AND lead_id = ?')
                    ->execute([$id, $lid]);
                $pdo->commit();
            } catch (\Throwable $e) {
                $pdo->rollBack();
                throw $e;
            }
            Json::send(['ok' => true]);
        }
        Json::fail('Method not allowed', 405);
    }

    // /api/feedback-forms/:id (single form)
    if ($method === 'GET') {
        $q = $pdo->prepare('SELECT * FROM feedback_questions WHERE form_id = ? ORDER BY sort_order, id');
        $q->execute([$id]);
        $rc = $pdo->prepare('SELECT COUNT(*) FROM feedback_responses WHERE form_id = ?');
        $rc->execute([$id]);
        Json::send([
            'form'           => $form,
            'questions'      => $q->fetchAll(),
            'response_count' => (int)$rc->fetchColumn(),
        ]);
    }

    if ($method === 'PUT') {
        $body = Json::readBody();
        $fields = []; $params = [];
        if (array_key_exists('title', $body)) {
            $t = trim((string)$body['title']);
            if ($t === '') Json::fail('Title is required', 400);
            $fields[] = 'title = ?'; $params[] = $t;
        }
        if (array_key_exists('kind', $body)) {
            $k = (string)$body['kind'];
            if (!in_array($k, $allowedKinds, true)) Json::fail('Invalid kind', 400);
            $fields[] = 'kind = ?'; $params[] = $k;
        }
        if (array_key_exists('description', $body))       { $fields[] = 'description = ?';       $params[] = trim((string)$body['description']) ?: null; }
        if (array_key_exists('intro_html', $body))        { $fields[] = 'intro_html = ?';        $params[] = $body['intro_html'] ?: null; }
        if (array_key_exists('submit_label', $body))      { $fields[] = 'submit_label = ?';      $params[] = trim((string)$body['submit_label']) ?: 'Submit'; }
        if (array_key_exists('thank_you_message', $body)) { $fields[] = 'thank_you_message = ?'; $params[] = $body['thank_you_message'] ?: null; }
        if (array_key_exists('is_published', $body))      { $fields[] = 'is_published = ?';      $params[] = !empty($body['is_published']) ? 1 : 0; }
        if (array_key_exists('broadcast_to_all_clients', $body)) { $fields[] = 'broadcast_to_all_clients = ?'; $params[] = !empty($body['broadcast_to_all_clients']) ? 1 : 0; }
        if (array_key_exists('broadcast_to_all_leads',   $body)) { $fields[] = 'broadcast_to_all_leads = ?';   $params[] = !empty($body['broadcast_to_all_leads'])   ? 1 : 0; }
        if (array_key_exists('client_id', $body))         { $fields[] = 'client_id = ?';         $params[] = !empty($body['client_id']) ? (int)$body['client_id'] : null; }
        if (array_key_exists('lead_id', $body))           { $fields[] = 'lead_id = ?';           $params[] = !empty($body['lead_id']) ? (int)$body['lead_id'] : null; }
        if (array_key_exists('service_offering_id', $body)) { $fields[] = 'service_offering_id = ?'; $params[] = !empty($body['service_offering_id']) ? (int)$body['service_offering_id'] : null; }

        if (!$fields) Json::send(['ok' => true]);
        $params[] = $id;
        $pdo->prepare('UPDATE feedback_forms SET ' . implode(', ', $fields) . ' WHERE id = ?')
            ->execute($params);
        Json::send(['ok' => true]);
    }

    if ($method === 'DELETE') {
        $pdo->prepare('DELETE FROM feedback_forms WHERE id = ?')->execute([$id]);
        Json::send(['ok' => true]);
    }

    Json::fail('Method not allowed', 405);
};
