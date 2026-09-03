<?php
declare(strict_types=1);

use BRS\Auth;
use BRS\Db;
use BRS\Ddl;
use BRS\Json;
use BRS\Tenant;

/*
 * Form submission linkage — join between a submission row (in a
 * per-form dynamic table like `form_contact_us`) and a canonical
 * record (client, lead, or service offering).
 *
 *   GET  /api/form-submission-links/for/:type/:id
 *        type = client | lead | service
 *        Returns:
 *          {
 *            groups: [
 *              {
 *                form: { id, title, form_type, tagline_or_slug },
 *                submissions: [
 *                  { link_id, submission_id, submitted_at, data: {...}, link_source }
 *                ],
 *                bucket: 'service' | 'default'   // grouping hint for the UI
 *              }
 *            ]
 *          }
 *
 *   POST /api/form-submission-links            manually attach
 *        body: { form_id, submission_id, client_id?, lead_id?, service_offering_id? }
 *
 *   DELETE /api/form-submission-links/:id      detach
 *
 * All ops are tenant-scoped. Submission data is fetched from the form's
 * dynamic table (Ddl::tableName(form.slug)) so callers can render a
 * "captured info" preview without a second round-trip.
 */

return function (string $method, array $segs): void {
    Auth::require();
    $pdo = Db::pdo();               // raw — we scope explicitly by tenant_id

    $seg1 = $segs[1] ?? '';
    $seg2 = $segs[2] ?? '';

    // ── /for/:type/:id ─────────────────────────────────────
    if ($seg1 === 'for' && $method === 'GET') {
        $type = (string)$seg2;
        $recordId = (int)($segs[3] ?? 0);
        if (!in_array($type, ['client','lead','service'], true) || $recordId <= 0) {
            Json::fail('Invalid path', 400);
        }
        $col = ['client' => 'client_id', 'lead' => 'lead_id', 'service' => 'service_offering_id'][$type];

        // Pull every link + form metadata for the record.
        //
        // `is_compulsory` is computed inline so the frontend can hide
        // the Detach button when the client/lead is actively on the
        // linked service. Two-branch check because clients use
        // client_service_offerings (status-aware) and leads use the
        // simpler lead_services linkage. Active client statuses only:
        // done / on_hold are terminal, so those still permit detach.
        $activeStatuses = "'new','onboarding','submitted','qualified','to_do','in_progress'";
        $sql = "
            SELECT
              l.id AS link_id, l.submission_table, l.submission_id, l.attach_source, l.linked_at,
              f.id AS form_id, f.title AS form_title, f.slug AS form_slug,
              f.form_type, f.service_offering_id,
              CASE
                WHEN l.service_offering_id IS NULL THEN 0
                WHEN l.client_id IS NOT NULL AND EXISTS(
                  SELECT 1 FROM client_service_offerings cso
                   WHERE cso.tenant_id = l.tenant_id
                     AND cso.client_id = l.client_id
                     AND cso.service_offering_id = l.service_offering_id
                     AND cso.status IN ({$activeStatuses})
                ) THEN 1
                WHEN l.lead_id IS NOT NULL AND EXISTS(
                  SELECT 1 FROM lead_services ls
                   WHERE ls.tenant_id = l.tenant_id
                     AND ls.lead_id = l.lead_id
                     AND ls.service_offering_id = l.service_offering_id
                ) THEN 1
                ELSE 0
              END AS is_compulsory
            FROM form_submission_links l
            JOIN forms f ON f.id = l.form_id
            WHERE l.tenant_id = ? AND l.{$col} = ?
            ORDER BY f.id, l.linked_at DESC
        ";
        $st = $pdo->prepare($sql);
        $st->execute([Tenant::id(), $recordId]);
        $rows = $st->fetchAll();

        // Group by form. For each submission, fetch the row from the
        // dynamic per-form table so the UI can render captured fields.
        $groups = [];
        foreach ($rows as $r) {
            $formKey = (int)$r['form_id'];
            if (!isset($groups[$formKey])) {
                $groups[$formKey] = [
                    'form' => [
                        'id'                  => (int)$r['form_id'],
                        'title'               => $r['form_title'],
                        'slug'                => $r['form_slug'],
                        'form_type'           => $r['form_type'],
                        'service_offering_id' => $r['service_offering_id'] !== null
                            ? (int)$r['service_offering_id'] : null,
                    ],
                    'submissions' => [],
                    'bucket' => $r['service_offering_id'] ? 'service' : 'default',
                ];
            }

            // Fetch the row data. Two shapes:
            //  a) `submission_table = 'onboarding_clients'` — the actual
            //     captured fields live in the form's dynamic table
            //     (form_<slug>). onboarding_clients.submission_id points
            //     to that row; hop through it.
            //  b) Anything else — the linkage row IS the dynamic-table
            //     row, so query directly.
            $data = null; $submittedAt = null;
            try {
                $tbl = preg_replace('/[^a-zA-Z0-9_]/', '_', $r['submission_table']);

                if ($tbl === 'onboarding_clients') {
                    // Hop: onboarding_clients row → its form's data table.
                    $oc = $pdo->prepare(
                        'SELECT submission_id, submitted_at, started_at
                           FROM onboarding_clients WHERE id = ? AND tenant_id = ?'
                    );
                    $oc->execute([(int)$r['submission_id'], Tenant::id()]);
                    $ocRow = $oc->fetch() ?: null;
                    $submittedAt = $ocRow['submitted_at'] ?? $ocRow['started_at'] ?? null;

                    if ($ocRow && !empty($ocRow['submission_id'])) {
                        $dataTbl = preg_replace('/[^a-zA-Z0-9_]/', '_', 'form_' . $r['form_slug']);
                        $q = $pdo->prepare("SELECT * FROM `{$dataTbl}` WHERE id = ? AND tenant_id = ?");
                        $q->execute([(int)$ocRow['submission_id'], Tenant::id()]);
                        $data = $q->fetch() ?: null;
                        if ($data) unset($data['id'], $data['tenant_id']);
                    }
                } else {
                    $q = $pdo->prepare("SELECT * FROM `{$tbl}` WHERE id = ? AND tenant_id = ?");
                    $q->execute([(int)$r['submission_id'], Tenant::id()]);
                    $data = $q->fetch() ?: null;
                    if ($data) {
                        $submittedAt = $data['submitted_at'] ?? $data['created_at'] ?? null;
                        unset($data['id'], $data['tenant_id']);
                    }
                }
            } catch (\Throwable $e) {
                error_log('[fsl] fetch submission failed: ' . $e->getMessage());
            }

            $groups[$formKey]['submissions'][] = [
                'link_id'       => (int)$r['link_id'],
                'submission_id' => (int)$r['submission_id'],
                'submitted_at'  => $submittedAt,
                'link_source'   => $r['attach_source'],
                'is_compulsory' => (int)($r['is_compulsory'] ?? 0) === 1,
                'linked_at'     => $r['linked_at'],
                'data'          => $data,
            ];
        }

        // ── Synthesize broadcast groups ────────────────────────
        // Forms flagged broadcast_to_all_clients / broadcast_to_all_leads
        // don't need explicit link rows — every client / lead sees them
        // automatically. We surface them as groups with a `broadcast`
        // bucket + zero submissions (unless the recipient has already
        // submitted, in which case the real link row above wins because
        // this pass runs AFTER and merges).
        if ($type === 'client' || $type === 'lead') {
            $flag = $type === 'client' ? 'broadcast_to_all_clients' : 'broadcast_to_all_leads';
            $bStmt = $pdo->prepare(
                "SELECT id, title, slug, form_type, service_offering_id
                   FROM forms
                  WHERE tenant_id = ? AND {$flag} = 1"
            );
            $bStmt->execute([Tenant::id()]);
            foreach ($bStmt->fetchAll() as $b) {
                $fid = (int)$b['id'];
                if (isset($groups[$fid])) continue;   // real submission wins
                $groups[$fid] = [
                    'form' => [
                        'id'                  => $fid,
                        'title'               => $b['title'],
                        'slug'                => $b['slug'],
                        'form_type'           => $b['form_type'],
                        'service_offering_id' => $b['service_offering_id'] !== null
                            ? (int)$b['service_offering_id'] : null,
                    ],
                    'submissions' => [],       // not yet submitted by this recipient
                    'bucket' => 'broadcast',
                ];
            }
        }

        // For services: also surface any form whose service_offering_id
        // matches the record even when there are no submissions yet, so
        // the admin sees "this form is currently attached to this
        // service" without waiting for a client to submit.
        if ($type === 'service') {
            $sStmt = $pdo->prepare(
                'SELECT id, title, slug, form_type, service_offering_id
                   FROM forms
                  WHERE tenant_id = ? AND service_offering_id = ?'
            );
            $sStmt->execute([Tenant::id(), $recordId]);
            foreach ($sStmt->fetchAll() as $s) {
                $fid = (int)$s['id'];
                if (isset($groups[$fid])) continue;
                $groups[$fid] = [
                    'form' => [
                        'id'                  => $fid,
                        'title'               => $s['title'],
                        'slug'                => $s['slug'],
                        'form_type'           => $s['form_type'],
                        'service_offering_id' => (int)$s['service_offering_id'],
                    ],
                    'submissions' => [],
                    'bucket' => 'service',
                ];
            }
        }

        Json::send(['groups' => array_values($groups)]);
    }

    // ── GET /form-submission-links/candidates?exclude_type=X&exclude_id=Y
    //    Returns every form + its submissions, marking which are
    //    already linked to the given record so the picker can grey
    //    them out. Used by the "+ Attach submission" modal on the
    //    Onboarding tab of a client / lead / service.
    if ($seg1 === 'candidates' && $method === 'GET') {
        $excludeType = (string)($_GET['exclude_type'] ?? '');
        $excludeId   = (int)($_GET['exclude_id']   ?? 0);
        $excludeCol  = ['client'  => 'client_id',
                        'lead'    => 'lead_id',
                        'service' => 'service_offering_id'][$excludeType] ?? null;

        // Every form in the tenant. We list all forms so the caller
        // can attach any submission to any record — the "compulsory"
        // guard runs at DELETE time, not attach time.
        $formsStmt = $pdo->prepare(
            'SELECT id, slug, title, form_type, service_offering_id
               FROM forms WHERE tenant_id = ? ORDER BY title'
        );
        $formsStmt->execute([Tenant::id()]);
        $forms = $formsStmt->fetchAll();

        $out = [];
        foreach ($forms as $f) {
            $formId = (int)$f['id'];
            $tbl = ($f['form_type'] === 'onboarding')
                ? 'onboarding_clients'
                : preg_replace('/[^a-zA-Z0-9_]/', '_', 'form_' . $f['slug']);

            // Onboarding forms: submissions come from onboarding_clients.
            // Standard forms: submissions come from the dynamic form_<slug>
            // table.
            try {
                if ($f['form_type'] === 'onboarding') {
                    $rowsStmt = $pdo->prepare(
                        'SELECT id, submitted_at, client_email, client_name
                           FROM onboarding_clients
                          WHERE tenant_id = ? AND form_id = ?
                          ORDER BY id DESC LIMIT 100'
                    );
                    $rowsStmt->execute([Tenant::id(), $formId]);
                } else {
                    $rowsStmt = $pdo->prepare(
                        "SELECT * FROM `{$tbl}` WHERE tenant_id = ? ORDER BY id DESC LIMIT 100"
                    );
                    $rowsStmt->execute([Tenant::id()]);
                }
                $rows = $rowsStmt->fetchAll();
            } catch (\Throwable $e) {
                $rows = [];
            }

            // Which of these are already linked to the target record?
            $alreadyIds = [];
            if ($excludeCol !== null && $excludeId > 0) {
                $q = $pdo->prepare(
                    "SELECT submission_id FROM form_submission_links
                      WHERE tenant_id = ? AND form_id = ?
                        AND submission_table = ?
                        AND {$excludeCol} = ?"
                );
                $q->execute([Tenant::id(), $formId, $tbl, $excludeId]);
                foreach ($q->fetchAll() as $r) $alreadyIds[(int)$r['submission_id']] = true;
            }

            $submissions = [];
            foreach ($rows as $r) {
                $subId = (int)$r['id'];
                $label = null;
                if ($f['form_type'] === 'onboarding') {
                    $label = trim(($r['client_name'] ?? '') . ' <' . ($r['client_email'] ?? '') . '>', ' <>');
                    $label = $label !== '' ? $label : ('#' . $subId);
                } else {
                    // Pick a friendly-looking column if the form has one.
                    foreach (['full_name','name','email','contact_email','company','company_name'] as $k) {
                        if (!empty($r[$k])) { $label = (string)$r[$k]; break; }
                    }
                    $label = $label ?: ('#' . $subId);
                }
                $submissions[] = [
                    'submission_id' => $subId,
                    'label'         => $label,
                    'submitted_at'  => $r['submitted_at'] ?? null,
                    'already_linked'=> isset($alreadyIds[$subId]),
                ];
            }

            if (!empty($submissions)) {
                $out[] = [
                    'form' => [
                        'id'        => $formId,
                        'title'     => $f['title'],
                        'slug'      => $f['slug'],
                        'form_type' => $f['form_type'],
                        'submission_table' => $tbl,
                    ],
                    'submissions' => $submissions,
                ];
            }
        }
        Json::send(['forms' => $out]);
    }

    // ── POST /form-submission-links  (manual attach) ────────
    if ($method === 'POST' && $seg1 === '') {
        $b = Json::readBody();
        $formId = (int)($b['form_id'] ?? 0);
        $subId  = (int)($b['submission_id'] ?? 0);
        if ($formId <= 0 || $subId <= 0) Json::fail('form_id + submission_id required', 400);

        // Look up the form (must be within tenant) so we can derive the table.
        // Onboarding forms store their submissions in `onboarding_clients`,
        // standard forms in the dynamic `form_<slug>` table.
        $f = $pdo->prepare('SELECT id, slug, form_type FROM forms WHERE id = ? AND tenant_id = ?');
        $f->execute([$formId, Tenant::id()]);
        $form = $f->fetch();
        if (!$form) Json::fail('Form not found', 404);
        $table = ($form['form_type'] === 'onboarding')
            ? 'onboarding_clients'
            : Ddl::tableName($form['slug']);

        // Validate the submission exists (scoped to tenant + form for
        // onboarding rows so an onboarding_clients row can't be attached
        // as if it belonged to a different form).
        if ($form['form_type'] === 'onboarding') {
            $chk = $pdo->prepare("SELECT id FROM `{$table}` WHERE id = ? AND tenant_id = ? AND form_id = ?");
            $chk->execute([$subId, Tenant::id(), $formId]);
        } else {
            $chk = $pdo->prepare("SELECT id FROM `{$table}` WHERE id = ? AND tenant_id = ?");
            $chk->execute([$subId, Tenant::id()]);
        }
        if (!$chk->fetch()) Json::fail('Submission not found', 404);

        $clientId  = !empty($b['client_id'])           ? (int)$b['client_id']           : null;
        $leadId    = !empty($b['lead_id'])             ? (int)$b['lead_id']             : null;
        $serviceId = !empty($b['service_offering_id']) ? (int)$b['service_offering_id'] : null;
        if (!$clientId && !$leadId && !$serviceId) {
            Json::fail('At least one of client_id / lead_id / service_offering_id required', 400);
        }

        $pdo->prepare(
            'INSERT INTO form_submission_links
                (tenant_id, form_id, submission_table, submission_id,
                 client_id, lead_id, service_offering_id, attached_by_user_id, attach_source)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, "manual")'
        )->execute([
            Tenant::id(), $formId, $table, $subId,
            $clientId, $leadId, $serviceId,
            Tenant::userId() ?: null,
        ]);
        Json::send(['id' => (int)$pdo->lastInsertId()], 201);
    }

    // ── DELETE /form-submission-links/:id  (detach) ────────
    //
    // Guard: if this link ties a submission to a service the client is
    // actively on (client_service_offerings row with a non-terminal
    // status), the onboarding is de-facto compulsory - refuse detach
    // and tell the caller what to do. Terminal statuses ('done',
    // 'on_hold') mean the service relationship is closed, so detach
    // is allowed at that point.
    //
    // Force-detach escape hatch: ?force=1 lets a caller bypass the
    // guard (used by the frontend after showing an explicit
    // "cancel the service first?" confirm dialog).
    if ($method === 'DELETE' && ctype_digit((string)$seg1)) {
        $linkId = (int)$seg1;
        $force  = !empty($_GET['force']);

        if (!$force) {
            $chk = $pdo->prepare(
                'SELECT l.client_id, l.service_offering_id, f.title AS form_title, s.name AS service_name
                   FROM form_submission_links l
                   JOIN forms f ON f.id = l.form_id
                   LEFT JOIN service_offerings s ON s.id = l.service_offering_id
                  WHERE l.id = ? AND l.tenant_id = ?'
            );
            $chk->execute([$linkId, Tenant::id()]);
            $link = $chk->fetch();

            if ($link && !empty($link['client_id']) && !empty($link['service_offering_id'])) {
                $activeStatuses = "'new','onboarding','submitted','qualified','to_do','in_progress'";
                $svc = $pdo->prepare(
                    "SELECT id, status FROM client_service_offerings
                      WHERE tenant_id = ? AND client_id = ? AND service_offering_id = ?
                        AND status IN ({$activeStatuses})
                      LIMIT 1"
                );
                $svc->execute([Tenant::id(), (int)$link['client_id'], (int)$link['service_offering_id']]);
                if ($svc->fetch()) {
                    Json::fail(
                        sprintf(
                            'Cannot detach. "%s" onboarding is required for the "%s" service, and this client is currently on that service. Cancel the service first, or pass ?force=1 to detach anyway.',
                            $link['form_title'] ?? 'this',
                            $link['service_name'] ?? 'linked'
                        ),
                        409
                    );
                }
            }
        }

        $pdo->prepare('DELETE FROM form_submission_links WHERE id = ? AND tenant_id = ?')
            ->execute([$linkId, Tenant::id()]);
        Json::send(['ok' => true]);
    }

    Json::fail('Not found', 404);
};
