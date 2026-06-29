<?php
declare(strict_types=1);

use BRS\Db;
use BRS\Ddl;
use BRS\Json;
use BRS\Mailer;

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
            Mailer::send($form['notify_email'], $subj, $body);
        }

        Json::send(['ok' => true, 'completed_sections' => $completed]);
    }

    // ---- POST submit ----
    if ($method === 'POST' && ($segs[4] ?? '') === 'submit') {
        if (!$client['submission_id']) Json::fail('Nothing to submit yet', 400);

        $alreadySubmitted = !empty($client['submitted_at']);
        if (!$alreadySubmitted) {
            $pdo->prepare('UPDATE onboarding_clients SET submitted_at = NOW(), last_edited_at = NOW() WHERE id = ?')
                ->execute([$clientId]);
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
            Mailer::send($form['notify_email'], $subj, $body);
        }

        Json::send([
            'ok' => true,
            'thank_you_message' => $form['thank_you_message'] ?: 'Thanks — your onboarding has been received.',
        ]);
    }

    Json::fail('Not found', 404);
};
