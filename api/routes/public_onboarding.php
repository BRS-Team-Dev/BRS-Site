<?php
declare(strict_types=1);

use BRS\Db;
use BRS\Ddl;
use BRS\Json;
use BRS\Mailer;
use BRS\NotificationDispatcher;

/*
 * Public onboarding portal endpoints (no auth — token in URL).
 *
 *   GET  /api/public/onboarding/:formId/:token                   → full state
 *   PUT  /api/public/onboarding/:formId/:token                   → autosave (JSON or multipart)
 *                                                                  optional ?complete=section_slug
 *                                                                  to mark a section complete
 *   POST /api/public/onboarding/:formId/:token/submit            → finalize (sets submitted_at,
 *                                                                  fires admin notify, locks
 *                                                                  edited_after_submit on subsequent
 *                                                                  edits)
 */

use BRS\Tenant;

return function (string $method, array $segs): void {
    // Public routes have no JWT — bootstrap the tenant context.
    // Hardcoded to BRS (tenant 1) until per-tenant public routing
    // lands in Phase 5 (subdomain detection / per-tenant API key).
    Tenant::setForPublic();

    // ── Open-link (token-less) variant ────────────────────────────
    // /api/public/onboarding/slug/:slug           GET  → schema by slug
    // /api/public/onboarding/slug/:slug/submit    POST → anon submit
    //
    // Gated by forms.is_public_open (migration 146). Runs the same
    // auto-provision block as the invite flow, differing in that a
    // fresh onboarding_clients row is minted per submission and the
    // provisioning target (client vs lead) comes from forms.public_target.
    // Anti-spam: honeypot field `_hp` + per-IP rate limit (5/min).
    if (($segs[2] ?? '') === 'slug') {
        handleOpenOnboarding($method, $segs);
        return;
    }

    $formId = (int)($segs[2] ?? 0);
    $token  = (string)($segs[3] ?? '');
    if ($formId <= 0 || strlen($token) !== 64 || !ctype_xdigit($token)) {
        Json::fail('Invalid onboarding link', 400);
    }
    $pdo = Db::tpdo();

    // Resolve form + client (token must match the form_id in the URL — defence in depth).
    // Note: we don't require is_published here because the token itself is the
    // access control — the admin has explicitly invited this client.
    $f = $pdo->prepare("SELECT * FROM forms WHERE id = ? AND form_type = 'onboarding'");
    $f->execute([$formId]);
    $form = $f->fetch();
    if (!$form) Json::fail('Onboarding not found', 404);

    $c = $pdo->prepare('SELECT * FROM onboarding_clients WHERE client_token = ? AND form_id = ?');
    $c->execute([$token, $formId]);
    $client = $c->fetch();
    if (!$client) Json::fail('Invalid token', 404);

    $clientId = (int)$client['id'];
    $table    = Ddl::tableName($form['slug']);

    // Sections + fields (loaded for every request so we can group on response and validate writes)
    $secStmt = $pdo->prepare('SELECT id, slug, title, description, sort_order FROM form_sections WHERE form_id = ? ORDER BY sort_order, id');
    $secStmt->execute([$formId]);
    $sections = $secStmt->fetchAll();

    $fieldStmt = $pdo->prepare('SELECT id, section_id, name, label, type, is_required, options_json, placeholder, help_text, sort_order
                                FROM form_fields WHERE form_id = ? ORDER BY sort_order, id');
    $fieldStmt->execute([$formId]);
    $fields = $fieldStmt->fetchAll();
    foreach ($fields as &$row) {
        if (!empty($row['options_json'])) {
            $decoded = json_decode($row['options_json'], true);
            $row['options'] = is_array($decoded) ? $decoded : [];
        } else {
            $row['options'] = [];
        }
        unset($row['options_json']);
    }
    unset($row);

    $fieldsBySection = [];
    foreach ($fields as $fl) {
        $sid = $fl['section_id'] !== null ? (int)$fl['section_id'] : 0;
        $fieldsBySection[$sid][] = $fl;
    }
    foreach ($sections as &$s) {
        $s['fields'] = $fieldsBySection[(int)$s['id']] ?? [];
    }
    unset($s);

    $fieldsByName = [];
    foreach ($fields as $fl) { $fieldsByName[$fl['name']] = $fl; }

    // ---- GET ----
    if ($method === 'GET' && !isset($segs[4])) {
        // Branding (reuse the same settings the standard public form pulls)
        $brandRows = $pdo->query("SELECT k, v FROM settings WHERE k IN ('public_form_bg_color','brand_name','brand_logo_url')")->fetchAll();
        $brand = ['public_form_bg_color' => '', 'brand_name' => '', 'brand_logo_url' => ''];
        foreach ($brandRows as $r) { $brand[$r['k']] = (string)$r['v']; }

        $values = (object)[];
        if ($client['submission_id']) {
            $rs = $pdo->prepare("SELECT * FROM `$table` WHERE id = ?");
            $rs->execute([$client['submission_id']]);
            $row = $rs->fetch();
            if ($row) {
                unset($row['id'], $row['submitted_at'], $row['ip_address']);
                $values = $row;
            }
        }

        $completed = [];
        if (!empty($client['completed_sections'])) {
            $parsed = json_decode($client['completed_sections'], true);
            if (is_array($parsed)) $completed = $parsed;
        }

        Json::send([
            'form' => [
                'id'                => (int)$form['id'],
                'slug'              => $form['slug'],
                'title'             => $form['title'],
                'description'       => $form['description'],
                'intro_html'        => $form['intro_html'],
                'submit_label'      => $form['submit_label'],
                'thank_you_message' => $form['thank_you_message'],
            ],
            'sections' => $sections,
            'client' => [
                'email'              => $client['client_email'],
                'name'               => $client['client_name'],
                'started_at'         => $client['started_at'],
                'last_edited_at'     => $client['last_edited_at'],
                'submitted_at'       => $client['submitted_at'],
                'completed_sections' => $completed,
                'edited_after_submit'=> (int)$client['edited_after_submit'],
            ],
            'values' => $values,
            'branding' => [
                'bg_color' => $brand['public_form_bg_color'],
                'name'     => $brand['brand_name'],
                'logo_url' => $brand['brand_logo_url'],
            ],
        ]);
    }

    // ---- PUT (autosave) ----
    if ($method === 'PUT' && !isset($segs[4])) {
        $isJson = stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== false;
        $input  = $isJson ? Json::readBody() : $_POST;
        $files  = $_FILES ?? [];
        if (!is_array($input)) $input = [];

        $completeSlug = isset($_GET['complete']) ? (string)$_GET['complete'] : null;

        // Build map of section slugs for validation of complete=
        $sectionSlugs = [];
        foreach ($sections as $s) { $sectionSlugs[$s['slug']] = (int)$s['id']; }
        if ($completeSlug !== null && !isset($sectionSlugs[$completeSlug])) {
            Json::fail('Unknown section', 400);
        }

        // Normalize incoming values for any provided fields. Skip files here — we move them after row exists.
        $sets   = [];
        $params = [];
        foreach ($input as $name => $val) {
            if (!isset($fieldsByName[$name])) continue;
            $f = $fieldsByName[$name];
            if (in_array($f['type'], ['file', 'multi_file'], true)) continue;

            // Light-weight per-type coercion (full validation happens at /submit time).
            switch ($f['type']) {
                case 'checkbox':
                    if (is_array($val)) {
                        $sets[]   = "`{$name}` = ?";
                        $params[] = json_encode(array_values($val), JSON_UNESCAPED_UNICODE);
                    } else if ($val === '' || $val === null) {
                        $sets[]   = "`{$name}` = ?";
                        $params[] = null;
                    }
                    break;
                case 'number':
                    if ($val === '' || $val === null) {
                        $sets[] = "`{$name}` = ?"; $params[] = null;
                    } else if (is_numeric($val)) {
                        $sets[] = "`{$name}` = ?"; $params[] = (string)$val;
                    }
                    break;
                case 'datetime':
                    if ($val === '' || $val === null) { $sets[] = "`{$name}` = ?"; $params[] = null; break; }
                    $v = str_replace('T', ' ', (string)$val);
                    if (strlen($v) === 16) $v .= ':00';
                    $sets[] = "`{$name}` = ?"; $params[] = $v;
                    break;
                case 'color':
                    if ($val === '' || $val === null) { $sets[] = "`{$name}` = ?"; $params[] = null; break; }
                    if (preg_match('/^#[0-9a-fA-F]{6}$/', (string)$val)) {
                        $sets[] = "`{$name}` = ?"; $params[] = strtolower((string)$val);
                    }
                    break;
                default:
                    $sets[]   = "`{$name}` = ?";
                    $params[] = ($val === '' || $val === null) ? null : (string)$val;
                    break;
            }
        }

        // Ensure a row exists in the per-form table; create on first save.
        $rowId = $client['submission_id'];
        if (!$rowId) {
            $pdo->prepare("INSERT INTO `$table` (ip_address) VALUES (?)")
                ->execute([$_SERVER['REMOTE_ADDR'] ?? null]);
            $rowId = (int)$pdo->lastInsertId();
            $pdo->prepare('UPDATE onboarding_clients SET submission_id = ? WHERE id = ?')
                ->execute([$rowId, $clientId]);
        }

        // Apply value updates (if any)
        if ($sets) {
            $sql = "UPDATE `$table` SET " . implode(', ', $sets) . " WHERE id = ?";
            $params[] = $rowId;
            $pdo->prepare($sql)->execute($params);
        }

        // File handling — single + multi
        $cfg        = $GLOBALS['BRS_CONFIG'];
        $maxBytes   = ((int)($pdo->query("SELECT v FROM settings WHERE k='upload_max_mb'")->fetchColumn() ?: 10)) * 1024 * 1024;
        $uploadRoot = $cfg['storage_dir'] . "/uploads/{$form['slug']}/{$rowId}";

        foreach ($fields as $fl) {
            $name = $fl['name'];
            if ($fl['type'] === 'file' && isset($files[$name]) && ($files[$name]['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_OK) {
                if ($files[$name]['size'] > $maxBytes) Json::fail("File '$name' exceeds max size", 422);
                if (!is_dir($uploadRoot)) mkdir($uploadRoot, 0755, true);
                $safe = preg_replace('/[^a-zA-Z0-9._-]/', '_', $files[$name]['name'] ?: 'upload.bin');
                $dest = "$uploadRoot/$safe";
                move_uploaded_file($files[$name]['tmp_name'], $dest);
                $relative = "uploads/{$form['slug']}/{$rowId}/{$safe}";
                $pdo->prepare("UPDATE `$table` SET `$name` = ? WHERE id = ?")->execute([$relative, $rowId]);
            }
            if ($fl['type'] === 'multi_file' && isset($files[$name]) && is_array($files[$name]['name'] ?? null)) {
                if (!is_dir($uploadRoot)) mkdir($uploadRoot, 0755, true);
                // Append to existing list rather than replace.
                $existing = [];
                $rs = $pdo->prepare("SELECT `$name` FROM `$table` WHERE id = ?");
                $rs->execute([$rowId]);
                $cur = $rs->fetchColumn();
                if ($cur) {
                    $parsed = json_decode($cur, true);
                    if (is_array($parsed)) $existing = $parsed;
                }
                $count = count($files[$name]['name']);
                for ($i = 0; $i < $count; $i++) {
                    if (($files[$name]['error'][$i] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) continue;
                    if ($files[$name]['size'][$i] > $maxBytes) Json::fail("File '$name' exceeds max size", 422);
                    $safe   = preg_replace('/[^a-zA-Z0-9._-]/', '_', $files[$name]['name'][$i] ?: 'upload.bin');
                    $unique = $name . '_' . count($existing) . '_' . $i . '_' . $safe;
                    $dest   = "$uploadRoot/$unique";
                    move_uploaded_file($files[$name]['tmp_name'][$i], $dest);
                    $existing[] = "uploads/{$form['slug']}/{$rowId}/{$unique}";
                }
                $pdo->prepare("UPDATE `$table` SET `$name` = ? WHERE id = ?")
                    ->execute([json_encode($existing, JSON_UNESCAPED_UNICODE), $rowId]);
            }
        }

        // Update client tracking
        $wasEdited = (int)$client['edited_after_submit'];
        $editedAfterSubmit = $client['submitted_at'] ? 1 : $wasEdited;
        $completed = [];
        if (!empty($client['completed_sections'])) {
            $parsed = json_decode($client['completed_sections'], true);
            if (is_array($parsed)) $completed = $parsed;
        }
        if ($completeSlug !== null && !in_array($completeSlug, $completed, true)) {
            $completed[] = $completeSlug;
        }

        $pdo->prepare('UPDATE onboarding_clients
                       SET last_edited_at = NOW(),
                           completed_sections = ?,
                           edited_after_submit = GREATEST(edited_after_submit, ?)
                       WHERE id = ?')
            ->execute([json_encode($completed, JSON_UNESCAPED_UNICODE), $editedAfterSubmit, $clientId]);

        // First edit after submit → notify admin (one-shot until reviewed)
        if ($editedAfterSubmit === 1 && $wasEdited === 0
            && !empty($form['notify_email']) && Mailer::isConfigured()) {
            $base     = rtrim($GLOBALS['BRS_CONFIG']['base_url'] ?? '', '/');
            $adminUrl = "{$base}/admin/onboarding/{$formId}/clients/{$clientId}";
            $subj = "Client edited after submitting: {$form['title']}";
            $body  = "<h2>Client edited their onboarding after submitting</h2>";
            $body .= '<p>Client: ' . htmlspecialchars($client['client_email'])
                  . ($client['client_name'] ? ' (' . htmlspecialchars($client['client_name']) . ')' : '')
                  . '</p>';
            $body .= '<p>Form: ' . htmlspecialchars($form['title']) . '</p>';
            $body .= '<p><a href="' . htmlspecialchars($adminUrl) . '">View their submission &rarr;</a></p>';
            Mailer::sendVia('internal', $form['notify_email'], $subj, $body);
        }

        Json::send(['ok' => true, 'completed_sections' => $completed]);
    }

    // ---- POST submit ----
    if ($method === 'POST' && ($segs[4] ?? '') === 'submit') {
        if (!$client['submission_id']) Json::fail('Nothing to submit yet', 400);

        $alreadySubmitted = !empty($client['submitted_at']);
        if (!$alreadySubmitted) {
            // Auto-qualify on submit — the old flow required an admin to
            // click Qualify to advance the pipeline. That created a "No
            // project" gap and made the Services tab show a duplicate
            // row (onboarding-source + catalogue-source) until an admin
            // acted. Submitting the form now qualifies immediately and
            // the task_project is spun up further down.
            $pdo->prepare('UPDATE onboarding_clients
                              SET submitted_at   = NOW(),
                                  last_edited_at = NOW(),
                                  qualified_at   = COALESCE(qualified_at, NOW())
                            WHERE id = ?')
                ->execute([$clientId]);
        }

        // ── Auto-create / attach client to the linked service ───────
        //
        // When the form is bound to a service catalogue row (113) and
        // this is the FIRST submission, find or create the matching
        // clients row by email, then attach the service via
        // client_service_offerings with status='submitted' (form
        // submitted, awaiting admin qualification — migration 117
        // enum).
        //
        // Wrapped in try/catch so any failure here can't break the
        // submitter's experience — the onboarding itself has already
        // been saved at this point.
        if (!$alreadySubmitted && !empty($form['service_offering_id'])) {
            try {
                $svcId = (int)$form['service_offering_id'];

                // Pull the submission row so we can lift company info
                // off the answers (field names follow the convention
                // company_name / company_url / contact_phone / etc.
                // documented on the seeded Management-system form).
                $rs = $pdo->prepare("SELECT * FROM `$table` WHERE id = ?");
                $rs->execute([$client['submission_id']]);
                $rowFull = $rs->fetch() ?: [];

                $email       = strtolower(trim((string)$client['client_email']));
                $companyName = $rowFull['company_name'] ?? $rowFull['company']     ?? null;
                $companyUrl  = $rowFull['company_url']  ?? $rowFull['url']
                                                       ?? $rowFull['website']     ?? null;
                $phone       = $rowFull['contact_phone'] ?? $rowFull['phone']     ?? null;
                $contactName = $rowFull['contact_name']  ?? $rowFull['admin_name']
                                                       ?? $rowFull['name']
                                                       ?? $client['client_name']  ?? null;

                if ($email !== '') {
                    // Find or create the canonical clients row.
                    $cFind = $pdo->prepare('SELECT id FROM clients WHERE LOWER(email) = LOWER(?) LIMIT 1');
                    $cFind->execute([$email]);
                    $clientsId = $cFind->fetchColumn();

                    if (!$clientsId) {
                        $insClient = $pdo->prepare(
                            'INSERT INTO clients (name, email, phone, company, url, notes)
                             VALUES (?, ?, ?, ?, ?, ?)'
                        );
                        $insClient->execute([
                            $contactName ?: ($companyName ?: 'New client'),
                            $email,
                            $phone ?: null,
                            $companyName ?: null,
                            $companyUrl ?: null,
                            'Auto-created from onboarding submission.',
                        ]);
                        $clientsId = (int)$pdo->lastInsertId();
                    } else {
                        $clientsId = (int)$clientsId;
                    }

                    // Backfill parent_client_id on the onboarding row so
                    // subsequent lookups + backfill migrations resolve
                    // this client correctly without another round-trip.
                    if (empty($client['parent_client_id'])) {
                        $pdo->prepare(
                            'UPDATE onboarding_clients SET parent_client_id = ? WHERE id = ?'
                        )->execute([$clientsId, $clientId]);
                    }

                    // Write the polymorphic linkage row so the client's
                    // Onboarding tab AND the service's Onboarding tab
                    // both surface this submission. Idempotent — we
                    // check for an existing row first.
                    try {
                        $chk = \BRS\Db::pdo()->prepare(
                            'SELECT id FROM form_submission_links
                              WHERE tenant_id = ? AND form_id = ?
                                AND submission_table = "onboarding_clients"
                                AND submission_id = ?
                              LIMIT 1'
                        );
                        $chk->execute([Tenant::id(), (int)$form['id'], $clientId]);
                        if (!$chk->fetchColumn()) {
                            \BRS\Db::pdo()->prepare(
                                'INSERT INTO form_submission_links
                                   (tenant_id, form_id, submission_table, submission_id,
                                    client_id, service_offering_id, attach_source)
                                 VALUES (?, ?, "onboarding_clients", ?, ?, ?, "auto")'
                            )->execute([
                                Tenant::id(),
                                (int)$form['id'],
                                $clientId,
                                $clientsId,
                                $svcId,
                            ]);
                        }
                    } catch (\Throwable $e) {
                        error_log('[onboarding submit] fsl insert failed: ' . $e->getMessage());
                    }

                    // Attach the service unless already attached. Snapshot
                    // pricing/cadence off the catalogue so the link row
                    // matches the catalogue at time of attach.
                    // Skip the dupe-check when the service flags
                    // allow_multiple — that's the whole point of the
                    // flag: re-purchasable services spawn a new link
                    // per submission instead of being idempotent.
                    $svcStmt = $pdo->prepare(
                        'SELECT name, price, payment_type, repeat_duration, allow_multiple
                           FROM service_offerings WHERE id = ?'
                    );
                    $svcStmt->execute([$svcId]);
                    $svc = $svcStmt->fetch();
                    $allowMultiple = $svc ? (int)($svc['allow_multiple'] ?? 0) === 1 : false;

                    $existingLink = null;
                    if (!$allowMultiple) {
                        $linkFind = $pdo->prepare(
                            'SELECT id FROM client_service_offerings
                              WHERE client_id = ? AND service_offering_id = ?
                              LIMIT 1'
                        );
                        $linkFind->execute([$clientsId, $svcId]);
                        $existingLink = $linkFind->fetchColumn() ?: null;
                    }

                    if (!$existingLink) {
                        if ($svc) {
                            $payType = in_array(($svc['payment_type'] ?? ''), ['one_off','recurring'], true)
                                ? $svc['payment_type'] : 'one_off';
                            $cadence = $payType === 'recurring' ? ($svc['repeat_duration'] ?? null) : null;
                            // status='qualified' (was 'submitted') — the
                            // auto-qualify above already advanced the
                            // onboarding row, so the CSO enum tracks the
                            // same stage.
                            $pdo->prepare(
                                'INSERT INTO client_service_offerings
                                   (client_id, service_offering_id, name, price, payment_type, repeat_duration, status)
                                 VALUES (?, ?, ?, ?, ?, ?, ?)'
                            )->execute([
                                $clientsId,
                                $svcId,
                                (string)$svc['name'],
                                $svc['price'] !== null && $svc['price'] !== '' ? (float)$svc['price'] : null,
                                $payType,
                                $cadence,
                                'qualified',
                            ]);
                            $newLinkId = (int)$pdo->lastInsertId();

                            // ── Auto-file a CRM task so the admin sees
                            // the new client show up in their queue. The
                            // service_client_link_id back-references the
                            // CSO row we just created, which the
                            // frontend uses to render the "→ client"
                            // link on the task card. Category='client'
                            // (the trigger was a NEW client), priority
                            // reflects that this is a fresh acquisition.
                            $displayName = trim((string)($contactName ?: $companyName ?: $email));
                            $taskTitle   = 'New client — ' . $displayName . ' · ' . (string)$svc['name'];
                            $taskDesc    = 'Auto-created on onboarding submission. '
                                         . 'Contact: ' . ($email ?: 'n/a')
                                         . ($phone ? ' · ' . $phone : '');
                            $pdo->prepare(
                                'INSERT INTO crm_tasks
                                   (title, description, category, priority, status, service_client_link_id)
                                 VALUES (?, ?, ?, ?, ?, ?)'
                            )->execute([
                                $taskTitle,
                                $taskDesc,
                                'client',
                                'high',
                                'to_do',
                                $newLinkId,
                            ]);
                        }
                    }
                }
            } catch (\Throwable $e) {
                // Don't surface to the submitter — the form was saved.
                // Surface to logs so an admin can reconcile later.
                error_log('[onboarding-submit] auto-attach failed for client ' . $clientId . ': ' . $e->getMessage());
            }
        }

        // ── Notify admins that onboarding was submitted ──────────
        if (!$alreadySubmitted) {
            NotificationDispatcher::fire('crm.onboarding.submitted', [
                'title'    => 'Onboarding submitted — ' . ($client['client_name'] ?: $client['client_email']),
                'body'     => 'Form: ' . ($form['title'] ?? 'Onboarding'),
                'link_url' => '/admin/onboarding/' . $formId . '/clients/' . $clientId,
            ]);
        }

        // ── Auto-create task_project on first submit ─────────────────
        // Mirrors the manual qualify handler in onboarding.php: if the
        // form is bound to a task team AND this is a fresh submission,
        // spawn a project owned by that team so admins land on
        // active work rather than an empty pipeline. Idempotent — the
        // WHERE onboarding_client_id check prevents dupes on re-submit.
        if (!$alreadySubmitted && !empty($form['team_id'])) {
            try {
                $exists = $pdo->prepare('SELECT id FROM task_projects WHERE onboarding_client_id = ?');
                $exists->execute([$clientId]);
                if (!$exists->fetch()) {
                    $clientLabel = trim((string)($client['client_name']  ?? ''))
                                ?: trim((string)($client['client_email'] ?? ''))
                                ?: 'Client';
                    $projectName = trim((string)($form['title'] ?? 'Onboarding')) . ' — ' . $clientLabel;
                    // Slug is unique-per-team; salt with client id.
                    $base = preg_replace('/[^a-z0-9]+/', '-', strtolower($projectName));
                    $base = trim((string)$base, '-');
                    if ($base === '') $base = 'project';
                    $slug = substr($base, 0, 60) . '-' . $clientId;

                    // Link the canonical clients row (created above) by
                    // email so the project shows up under the right
                    // person from the moment it's created.
                    $linkedClientId = null;
                    $lookupEmail = trim((string)($client['client_email'] ?? ''));
                    if ($lookupEmail !== '') {
                        $cstmt = $pdo->prepare('SELECT id FROM clients WHERE LOWER(email) = LOWER(?) LIMIT 1');
                        $cstmt->execute([$lookupEmail]);
                        $cmatch = $cstmt->fetch();
                        if ($cmatch) $linkedClientId = (int)$cmatch['id'];
                    }

                    $pdo->prepare('INSERT INTO task_projects
                        (team_id, slug, name, description, client_id, status, onboarding_client_id)
                        VALUES (?,?,?,?,?,?,?)'
                    )->execute([
                        (int)$form['team_id'],
                        $slug,
                        $projectName,
                        'Auto-created on onboarding submission.',
                        $linkedClientId,
                        'new',
                        $clientId,
                    ]);
                }
            } catch (\Throwable $e) {
                error_log('[onboarding-submit] task_project auto-create failed for client ' . $clientId . ': ' . $e->getMessage());
            }
        }

        // Notify admin (best-effort) — only on first submit. Re-submits hit the
        // "edited after submit" flow in the PUT handler instead.
        if (!$alreadySubmitted && !empty($form['notify_email']) && Mailer::isConfigured()) {
            $rs = $pdo->prepare("SELECT * FROM `$table` WHERE id = ?");
            $rs->execute([$client['submission_id']]);
            $rowFull = $rs->fetch() ?: [];

            $subj = (string)($form['notify_subject'] ?: "Onboarding complete: {$form['title']}");
            $body = (string)($form['notify_template'] ?? '');
            if ($body !== '') {
                $body = Mailer::render($body, $rowFull);
            } else {
                $body  = "<h2>Onboarding complete: {$form['title']}</h2>";
                $body .= '<p>Client: ' . htmlspecialchars($client['client_email']) . '</p>';
                $body .= brs_default_notify_body($fields, $rowFull);
            }
            Mailer::sendVia('internal', $form['notify_email'], $subj, $body);
        }

        Json::send([
            'ok' => true,
            'thank_you_message' => $form['thank_you_message'] ?: 'Thanks — your onboarding has been received.',
        ]);
    }

    Json::fail('Not found', 404);
};

/**
 * Token-less "open link" public onboarding handler.
 *
 *   GET  /api/public/onboarding/slug/:slug
 *   POST /api/public/onboarding/slug/:slug/submit  { _hp?, name, email, phone, ...field values }
 *
 * Loads the form by slug (must be form_type='onboarding' AND is_public_open=1
 * AND is_published=1). On submit, guards with a honeypot + per-IP rate limit,
 * creates an on-the-fly onboarding_clients row (client_token minted internally
 * so audit rows still have a stable id), writes all provided values into the
 * per-form table, then branches on forms.public_target:
 *   - client → find-or-create clients row + attach linked service
 *   - lead   → INSERT INTO leads (name, email, phone, company, url, notes)
 *   - none   → submission stored, no CRM record created
 * Notifications + task auto-create mirror the invite flow so the admin
 * experience is identical either way.
 */
function handleOpenOnboarding(string $method, array $segs): void
{
    $pdo  = Db::tpdo();
    $slug = (string)($segs[3] ?? '');
    if ($slug === '' || !preg_match('/^[a-z][a-z0-9_]{0,60}$/', $slug)) {
        Json::fail('Invalid onboarding link', 400);
    }

    // Load form — must be an onboarding form flagged as open + published.
    $fs = $pdo->prepare(
        "SELECT * FROM forms
          WHERE slug = ? AND form_type = 'onboarding' AND is_public_open = 1 AND is_published = 1"
    );
    $fs->execute([$slug]);
    $form = $fs->fetch();
    if (!$form) Json::fail('Onboarding not found', 404);

    $formId = (int)$form['id'];
    $table  = Ddl::tableName($form['slug']);

    // Sections + fields — same shape the invite flow returns so the
    // frontend renderer works unchanged.
    $secStmt = $pdo->prepare('SELECT id, slug, title, description, sort_order FROM form_sections WHERE form_id = ? ORDER BY sort_order, id');
    $secStmt->execute([$formId]);
    $sections = $secStmt->fetchAll();

    $fieldStmt = $pdo->prepare('SELECT id, section_id, name, label, type, is_required, options_json, placeholder, help_text, sort_order
                                FROM form_fields WHERE form_id = ? ORDER BY sort_order, id');
    $fieldStmt->execute([$formId]);
    $fields = $fieldStmt->fetchAll();
    foreach ($fields as &$row) {
        $decoded = !empty($row['options_json']) ? json_decode($row['options_json'], true) : [];
        $row['options'] = is_array($decoded) ? $decoded : [];
        unset($row['options_json']);
    }
    unset($row);

    $fieldsBySection = [];
    foreach ($fields as $fl) {
        $sid = $fl['section_id'] !== null ? (int)$fl['section_id'] : 0;
        $fieldsBySection[$sid][] = $fl;
    }
    foreach ($sections as &$s) {
        $s['fields'] = $fieldsBySection[(int)$s['id']] ?? [];
    }
    unset($s);

    $fieldsByName = [];
    foreach ($fields as $fl) { $fieldsByName[$fl['name']] = $fl; }

    // ── GET → schema + branding ──
    if ($method === 'GET') {
        $brandRows = $pdo->query("SELECT k, v FROM settings WHERE k IN ('public_form_bg_color','brand_name','brand_logo_url')")->fetchAll();
        $brand = ['public_form_bg_color' => '', 'brand_name' => '', 'brand_logo_url' => ''];
        foreach ($brandRows as $r) { $brand[$r['k']] = (string)$r['v']; }

        Json::send([
            'form' => [
                'id'                => $formId,
                'slug'              => $form['slug'],
                'title'             => $form['title'],
                'description'       => $form['description'],
                'intro_html'        => $form['intro_html'],
                'submit_label'      => $form['submit_label'],
                'thank_you_message' => $form['thank_you_message'],
                'public_target'     => $form['public_target'] ?? 'client',
                'post_submit_url'   => $form['post_submit_url'] ?? null,
            ],
            'sections' => $sections,
            'branding' => [
                'bg_color' => $brand['public_form_bg_color'],
                'name'     => $brand['brand_name'],
                'logo_url' => $brand['brand_logo_url'],
            ],
        ]);
    }

    // ── POST submit → create + provision ──
    if ($method === 'POST' && ($segs[4] ?? '') === 'submit') {
        $isJson = stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== false;
        $input  = $isJson ? Json::readBody() : $_POST;
        if (!is_array($input)) $input = [];

        // Honeypot — bots typically fill every field. Real users don't
        // see this input (rendered display:none), so any non-empty value
        // is a bot signal. Return 200 to avoid tipping them off.
        if (!empty($input['_hp'])) {
            Json::send(['ok' => true, 'thank_you_message' => $form['thank_you_message'] ?: 'Thanks — your onboarding has been received.']);
        }

        // Rate limit — 5 hits per 60s per (IP, form).
        $ip = (string)($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
        try {
            // Prune old rows for this IP first so the table doesn't grow
            // unbounded; no cron needed.
            $pdo->prepare('DELETE FROM public_onboarding_rate WHERE ip = ? AND hit_at < (NOW() - INTERVAL 10 MINUTE)')
                ->execute([$ip]);
            $rlChk = $pdo->prepare(
                'SELECT COUNT(*) FROM public_onboarding_rate
                  WHERE ip = ? AND form_id = ? AND hit_at > (NOW() - INTERVAL 60 SECOND)'
            );
            $rlChk->execute([$ip, $formId]);
            if ((int)$rlChk->fetchColumn() >= 5) Json::fail('Too many submissions — try again in a minute.', 429);
            $pdo->prepare('INSERT INTO public_onboarding_rate (ip, form_id) VALUES (?, ?)')
                ->execute([$ip, $formId]);
        } catch (\PDOException $e) {
            // Don't let rate-limit table issues block real submissions.
            error_log('[open-onboarding] rate limit table error: ' . $e->getMessage());
        }

        // Pull the submitter's identity off the form. Field names follow
        // the same convention the invite flow expects.
        $email = strtolower(trim((string)($input['email'] ?? $input['contact_email'] ?? '')));
        if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            Json::fail('A valid email is required', 400);
        }
        $name  = trim((string)($input['name'] ?? $input['contact_name'] ?? $input['admin_name'] ?? ''));

        // Insert the per-form submission row, coercing values field-by-
        // field so bad types get rejected but ordinary ones save clean.
        $cols   = ['ip_address'];
        $vals   = [$ip];
        $ph     = ['?'];
        foreach ($input as $k => $v) {
            if (!isset($fieldsByName[$k])) continue;
            $f = $fieldsByName[$k];
            if (in_array($f['type'], ['file','multi_file'], true)) continue;   // files unsupported on open-link (no session)
            $cols[] = "`$k`";
            $ph[]   = '?';
            switch ($f['type']) {
                case 'checkbox':
                    $vals[] = is_array($v) ? json_encode(array_values($v), JSON_UNESCAPED_UNICODE) : ($v === '' ? null : (string)$v);
                    break;
                case 'number':
                    $vals[] = is_numeric($v) ? (string)$v : null;
                    break;
                case 'datetime':
                    $vals[] = ($v === '' || $v === null) ? null : str_replace('T', ' ', (string)$v);
                    break;
                default:
                    $vals[] = ($v === '' || $v === null) ? null : (string)$v;
            }
        }
        $pdo->prepare("INSERT INTO `$table` (" . implode(',', $cols) . ") VALUES (" . implode(',', $ph) . ")")
            ->execute($vals);
        $submissionId = (int)$pdo->lastInsertId();

        // Mint an internal client_token so downstream code that expects
        // one (audit trails, task deep-links) has a stable value. Not
        // shareable — this row is created + owned by the anonymous
        // submitter and never re-visited.
        //
        // Timestamps are bound as parameters rather than NOW() literals
        // because the multi-tenant SQL rewriter's non-greedy regex
        // splices `, ?` at the FIRST `)` inside `VALUES(...)`, which
        // would tear a bare `NOW()` in half.
        $token = bin2hex(random_bytes(32));
        $now   = date('Y-m-d H:i:s');
        $pdo->prepare("INSERT INTO onboarding_clients
                          (form_id, client_email, client_name, client_token,
                           submission_id, submitted_at, qualified_at, last_edited_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
            ->execute([$formId, $email, $name ?: null, $token, $submissionId, $now, $now, $now]);
        $onbClientId = (int)$pdo->lastInsertId();

        // ── Provision (client or lead) ──
        $target = (string)($form['public_target'] ?? 'client');
        $svcId  = !empty($form['service_offering_id']) ? (int)$form['service_offering_id'] : 0;

        // Company / contact details for downstream inserts.
        $rowFull = [];
        try {
            $rs = $pdo->prepare("SELECT * FROM `$table` WHERE id = ?");
            $rs->execute([$submissionId]);
            $rowFull = $rs->fetch() ?: [];
        } catch (\Throwable $e) { /* ignore */ }
        $companyName = $rowFull['company_name'] ?? $rowFull['company'] ?? null;
        $companyUrl  = $rowFull['company_url']  ?? $rowFull['url'] ?? $rowFull['website'] ?? null;
        $phone       = $rowFull['contact_phone'] ?? $rowFull['phone'] ?? null;
        $contactName = $rowFull['contact_name']  ?? $rowFull['admin_name'] ?? $rowFull['name'] ?? $name ?: null;

        try {
            if ($target === 'client') {
                // Reuse the exact code path the invite flow runs: find
                // or create clients row, attach service, spawn CRM task
                // + task_project when the form has team_id.
                $cFind = $pdo->prepare('SELECT id FROM clients WHERE LOWER(email) = LOWER(?) LIMIT 1');
                $cFind->execute([$email]);
                $clientsId = $cFind->fetchColumn();
                if (!$clientsId) {
                    $pdo->prepare('INSERT INTO clients (name, email, phone, company, url, notes) VALUES (?,?,?,?,?,?)')
                        ->execute([
                            $contactName ?: ($companyName ?: 'New client'),
                            $email, $phone ?: null, $companyName ?: null, $companyUrl ?: null,
                            'Auto-created from open onboarding link.',
                        ]);
                    $clientsId = (int)$pdo->lastInsertId();
                } else {
                    $clientsId = (int)$clientsId;
                }
                // NOTE: We deliberately don't touch parent_client_id.
                // The column's FK actually points at onboarding_clients(id),
                // not clients(id), so setting it here would trip an
                // FK violation whenever the new clients.id doesn't
                // coincidentally exist in onboarding_clients. The
                // invite flow has the same latent bug but works by
                // coincidence; we just skip it here.

                if ($svcId > 0) {
                    // Attach the service unless it's already there and
                    // the service isn't marked allow_multiple.
                    $svcStmt = $pdo->prepare('SELECT name, price, payment_type, repeat_duration, allow_multiple FROM service_offerings WHERE id = ?');
                    $svcStmt->execute([$svcId]);
                    $svc = $svcStmt->fetch();
                    $allowMultiple = $svc ? (int)($svc['allow_multiple'] ?? 0) === 1 : false;
                    $existingLink = null;
                    if (!$allowMultiple) {
                        $lf = $pdo->prepare('SELECT id FROM client_service_offerings WHERE client_id = ? AND service_offering_id = ? LIMIT 1');
                        $lf->execute([$clientsId, $svcId]);
                        $existingLink = $lf->fetchColumn() ?: null;
                    }
                    if (!$existingLink && $svc) {
                        $payType = in_array(($svc['payment_type'] ?? ''), ['one_off','recurring'], true) ? $svc['payment_type'] : 'one_off';
                        $cadence = $payType === 'recurring' ? ($svc['repeat_duration'] ?? null) : null;
                        $pdo->prepare(
                            'INSERT INTO client_service_offerings
                               (client_id, service_offering_id, name, price, payment_type, repeat_duration, status)
                             VALUES (?,?,?,?,?,?,?)'
                        )->execute([
                            $clientsId, $svcId, (string)$svc['name'],
                            $svc['price'] !== null && $svc['price'] !== '' ? (float)$svc['price'] : null,
                            $payType, $cadence, 'qualified',
                        ]);
                        $newLinkId = (int)$pdo->lastInsertId();

                        // CRM task — matches the invite-flow format.
                        $displayName = trim((string)($contactName ?: $companyName ?: $email));
                        $pdo->prepare(
                            'INSERT INTO crm_tasks (title, description, category, priority, status, service_client_link_id)
                             VALUES (?, ?, ?, ?, ?, ?)'
                        )->execute([
                            'New client — ' . $displayName . ' · ' . (string)$svc['name'],
                            'Auto-created from open onboarding link. Contact: ' . $email . ($phone ? ' · ' . $phone : ''),
                            'client', 'high', 'to_do', $newLinkId,
                        ]);
                    }
                }
            } elseif ($target === 'lead') {
                // Leads have a similar shape to clients but live in the
                // separate `leads` table. Dedupe by email so a repeat
                // form submission doesn't spawn N lead rows.
                $lf = $pdo->prepare('SELECT id FROM leads WHERE LOWER(email) = LOWER(?) LIMIT 1');
                $lf->execute([$email]);
                if (!$lf->fetchColumn()) {
                    $pdo->prepare(
                        'INSERT INTO leads (name, email, phone, company, url, notes, source)
                         VALUES (?,?,?,?,?,?,?)'
                    )->execute([
                        $contactName ?: ($companyName ?: 'New lead'),
                        $email, $phone ?: null, $companyName ?: null, $companyUrl ?: null,
                        'Auto-created from open onboarding link.',
                        'onboarding',
                    ]);
                }
            }
            // target === 'none' → submission stored, no CRM row created.
        } catch (\Throwable $e) {
            error_log('[open-onboarding] provision failed for form ' . $formId . ': ' . $e->getMessage());
        }

        // Notify admins — same event as invite flow so notification rules apply uniformly.
        try {
            NotificationDispatcher::fire('crm.onboarding.submitted', [
                'title'    => 'Onboarding submitted (open link) — ' . ($name ?: $email),
                'body'     => 'Form: ' . ($form['title'] ?? 'Onboarding'),
                'link_url' => '/admin/onboarding/' . $formId . '/clients/' . $onbClientId,
            ]);
        } catch (\Throwable $e) { /* best-effort */ }

        Json::send([
            'ok' => true,
            'thank_you_message' => $form['thank_you_message'] ?: 'Thanks — your onboarding has been received.',
        ]);
    }

    Json::fail('Method not allowed', 405);
}
