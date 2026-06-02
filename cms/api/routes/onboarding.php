<?php
declare(strict_types=1);

use BRS\Auth;
use BRS\Db;
use BRS\Ddl;
use BRS\Json;

/*
 * Onboarding form templates.
 *
 *   GET    /api/onboarding/forms
 *   POST   /api/onboarding/forms
 *   GET    /api/onboarding/forms/:id
 *   PUT    /api/onboarding/forms/:id
 *   DELETE /api/onboarding/forms/:id
 *
 * An onboarding form is just a row in `forms` with form_type='onboarding'. Its
 * fields live in `form_fields` (same table as standard forms) but are grouped
 * by `section_id` referencing `form_sections`.
 *
 * The per-form data table (`form_<slug>`) is created the same way as standard
 * forms via Ddl, with one column per field across all sections.
 */

return function (string $method, array $segs): void {
    Auth::require();
    $pdo = Db::pdo();

    // /api/onboarding/clients — cross-form clients list.
    //   default          → only NOT-yet-qualified
    //   ?qualified=1     → only qualified
    if (($segs[1] ?? '') === 'clients' && $method === 'GET' && !isset($segs[2])) {
        $wantQualified = ($_GET['qualified'] ?? '') === '1';
        $where = $wantQualified ? 'c.qualified_at IS NOT NULL' : 'c.qualified_at IS NULL';
        $rows = $pdo->query("
            SELECT c.id, c.form_id, c.submission_id, c.client_email, c.client_name, c.client_token,
                   c.completed_sections, c.started_at, c.last_edited_at, c.submitted_at,
                   c.qualified_at, c.edited_after_submit,
                   f.title AS form_title, f.slug AS form_slug,
                   (SELECT COUNT(*) FROM form_sections fs WHERE fs.form_id = f.id) AS total_sections
            FROM onboarding_clients c
            JOIN forms f ON f.id = c.form_id
            WHERE $where
            ORDER BY c.id DESC
        ")->fetchAll();

        // Required-field progress per client. Group by form so we read each
        // form's required-field list and per-form data table only once.
        $byForm = [];
        foreach ($rows as $idx => $r) { $byForm[(int)$r['form_id']][] = $idx; }
        foreach ($byForm as $fid => $idxs) {
            $slug = $rows[$idxs[0]]['form_slug'];
            $reqStmt = $pdo->prepare('SELECT name FROM form_fields WHERE form_id = ? AND is_required = 1');
            $reqStmt->execute([$fid]);
            $required = array_column($reqStmt->fetchAll(), 'name');
            $totalReq = count($required);

            foreach ($idxs as $i) {
                $rows[$i]['total_required']  = $totalReq;
                $rows[$i]['filled_required'] = 0;
            }
            if ($totalReq === 0) continue;

            try {
                $table = Ddl::tableName($slug);
                $cols  = implode(',', array_map(fn($n) => "`$n`", $required));
                foreach ($idxs as $i) {
                    if (empty($rows[$i]['submission_id'])) continue;
                    $rs = $pdo->prepare("SELECT $cols FROM `$table` WHERE id = ?");
                    $rs->execute([$rows[$i]['submission_id']]);
                    $row = $rs->fetch();
                    if (!$row) continue;
                    foreach ($required as $name) {
                        $val = $row[$name] ?? null;
                        $str = is_string($val) ? trim($val) : (string)$val;
                        if ($str === '' || $str === '[]') continue;
                        $rows[$i]['filled_required']++;
                    }
                }
            } catch (\Throwable $e) {
                // Per-form table missing — leave counts at 0
            }
        }

        Json::send(['clients' => $rows]);
    }

    // Sub-route is /api/onboarding/forms[/:id[/clients[/:cid]]]
    if (($segs[1] ?? '') !== 'forms') Json::fail('Not found', 404);

    // Collection: /api/onboarding/forms
    if (!isset($segs[2])) {
        if ($method === 'GET') {
            $rows = $pdo->query("
                SELECT f.*,
                       (SELECT COUNT(*) FROM form_sections fs WHERE fs.form_id = f.id) AS section_count,
                       (SELECT COUNT(*) FROM form_fields   ff WHERE ff.form_id = f.id) AS field_count,
                       (SELECT COUNT(*) FROM onboarding_clients oc WHERE oc.form_id = f.id AND oc.qualified_at IS NULL) AS client_count,
                       (SELECT COUNT(*) FROM onboarding_clients oc WHERE oc.form_id = f.id AND oc.qualified_at IS NOT NULL) AS qualified_count
                FROM forms f
                WHERE f.form_type = 'onboarding'
                ORDER BY f.id DESC
            ")->fetchAll();
            Json::send(['forms' => $rows]);
        }

        if ($method === 'POST') {
            $body     = Json::readBody();
            $slug     = strtolower(trim((string)($body['slug'] ?? '')));
            $title    = trim((string)($body['title'] ?? ''));
            $sections = is_array($body['sections'] ?? null) ? $body['sections'] : [];

            if (!preg_match(Ddl::IDENT_RE, $slug)) {
                Json::fail('Invalid slug (lowercase letters/digits/underscore, must start with a letter)', 400);
            }
            if ($title === '') Json::fail('Title required', 400);
            if (empty($sections)) Json::fail('At least one section is required', 400);

            // Validate all sections + fields up-front so we don't half-write.
            $cleanSections = [];
            $allFields     = [];
            $seenSecSlugs  = [];
            foreach ($sections as $sIdx => $s) {
                $secSlug  = strtolower(trim((string)($s['slug']  ?? '')));
                $secTitle = trim((string)($s['title'] ?? ''));
                if (!preg_match(Ddl::IDENT_RE, $secSlug)) Json::fail("Invalid section slug at #{$sIdx}", 400);
                if ($secTitle === '') Json::fail("Section title required at #{$sIdx}", 400);
                if (isset($seenSecSlugs[$secSlug])) Json::fail("Duplicate section slug: {$secSlug}", 400);
                $seenSecSlugs[$secSlug] = true;

                $secFields = is_array($s['fields'] ?? null) ? $s['fields'] : [];
                $cleanFields = [];
                foreach ($secFields as $fIdx => $f) {
                    $f['name'] = strtolower(trim((string)($f['name'] ?? '')));
                    Ddl::assertField($f);
                    if (!isset($f['type'])) Json::fail("Field type required for {$f['name']}", 400);
                    $cleanFields[] = $f;
                    $allFields[]   = $f;
                }
                $cleanSections[] = [
                    'slug'        => $secSlug,
                    'title'       => $secTitle,
                    'description' => $s['description'] ?? null,
                    'sort_order'  => (int)($s['sort_order'] ?? $sIdx),
                    'fields'      => $cleanFields,
                ];
            }

            $placement = ($body['sidenav_placement'] ?? 'top') === 'child' ? 'child' : 'top';
            $parentKey = $placement === 'child' && !empty($body['sidenav_parent_key'])
                ? substr((string)$body['sidenav_parent_key'], 0, 40) : null;
            $parentProcessId = !empty($body['parent_process_form_id']) ? (int)$body['parent_process_form_id'] : null;
            $showRoot = !empty($body['show_in_sidenav_root']) ? 1 : 0;

            // 1) Insert form
            $hasPrice = !empty($body['has_price']) ? 1 : 0;
            $price = ($hasPrice && isset($body['price']) && $body['price'] !== '' && $body['price'] !== null)
                ? (float)$body['price'] : null;
            $paymentType = ($body['payment_type'] ?? 'one_off') === 'recurring' ? 'recurring' : 'one_off';
            $repeatDuration = null;
            if ($paymentType === 'recurring' && in_array($body['repeat_duration'] ?? '', ['weekly','monthly','quarterly','yearly'], true)) {
                $repeatDuration = $body['repeat_duration'];
            }
            $isIndefinite = !empty($body['is_indefinite']) ? 1 : 0;
            $contractLength = ($paymentType === 'recurring' && !$isIndefinite && isset($body['contract_length_months']) && $body['contract_length_months'] !== '' && $body['contract_length_months'] !== null)
                ? (int)$body['contract_length_months'] : null;
            $teamId = !empty($body['team_id']) ? (int)$body['team_id'] : null;

            $ins = $pdo->prepare("INSERT INTO forms (slug, form_type, main_section_label, sidenav_placement, sidenav_parent_key,
                parent_process_form_id, team_id, show_in_sidenav_root, title, description, intro_html, submit_label,
                thank_you_message, notify_email, notify_subject, notify_template,
                reply_subject, reply_template, reply_from_field, is_published,
                has_price, price, payment_type, repeat_duration, contract_length_months, is_indefinite)
                VALUES (?,'onboarding',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
            $ins->execute([
                $slug,
                $body['main_section_label'] ?? null,
                $placement,
                $parentKey,
                $parentProcessId,
                $teamId,
                $showRoot,
                $title,
                $body['description']       ?? null,
                $body['intro_html']        ?? null,
                $body['submit_label']      ?? 'Submit',
                $body['thank_you_message'] ?? null,
                $body['notify_email']      ?? null,
                $body['notify_subject']    ?? null,
                $body['notify_template']   ?? null,
                $body['reply_subject']     ?? null,
                $body['reply_template']    ?? null,
                $body['reply_from_field']  ?? null,
                !empty($body['is_published']) ? 1 : 0,
                $hasPrice,
                $price,
                $paymentType,
                $repeatDuration,
                $contractLength,
                $isIndefinite,
            ]);
            $formId = (int)$pdo->lastInsertId();

            // 2) Insert sections + fields
            $insSection = $pdo->prepare("INSERT INTO form_sections (form_id, slug, title, description, sort_order)
                                         VALUES (?,?,?,?,?)");
            $insField   = $pdo->prepare("INSERT INTO form_fields
                (form_id, section_id, name, label, type, is_required, options_json, placeholder, help_text, sort_order)
                VALUES (?,?,?,?,?,?,?,?,?,?)");

            $globalSort = 0;
            foreach ($cleanSections as $sec) {
                $insSection->execute([$formId, $sec['slug'], $sec['title'], $sec['description'], $sec['sort_order']]);
                $sectionId = (int)$pdo->lastInsertId();
                foreach ($sec['fields'] as $f) {
                    $insField->execute([
                        $formId,
                        $sectionId,
                        $f['name'],
                        (string)($f['label'] ?? $f['name']),
                        (string)$f['type'],
                        !empty($f['is_required']) ? 1 : 0,
                        isset($f['options_json']) ? (is_string($f['options_json']) ? $f['options_json'] : json_encode($f['options_json'])) : null,
                        $f['placeholder'] ?? null,
                        $f['help_text']   ?? null,
                        $globalSort++,
                    ]);
                }
            }

            // 3) DDL — single per-form table containing all fields across sections
            try {
                Ddl::createTable($slug, $allFields);
            } catch (\Throwable $e) {
                $pdo->prepare('DELETE FROM forms WHERE id = ?')->execute([$formId]);
                Json::fail('Failed to create table: ' . $e->getMessage(), 400);
            }

            Json::send(['id' => $formId, 'slug' => $slug], 201);
        }

        Json::fail('Method not allowed', 405);
    }

    // Item: /api/onboarding/forms/:id
    $id = (int)$segs[2];
    if ($id <= 0) Json::fail('Invalid form id', 400);

    $form = $pdo->prepare("SELECT * FROM forms WHERE id = ? AND form_type = 'onboarding'");
    $form->execute([$id]);
    $form = $form->fetch();
    if (!$form) Json::fail('Onboarding form not found', 404);

    if (!isset($segs[3])) {
        if ($method === 'GET') {
            $secStmt = $pdo->prepare('SELECT * FROM form_sections WHERE form_id = ? ORDER BY sort_order, id');
            $secStmt->execute([$id]);
            $sections = $secStmt->fetchAll();

            $fieldStmt = $pdo->prepare('SELECT * FROM form_fields WHERE form_id = ? ORDER BY sort_order, id');
            $fieldStmt->execute([$id]);
            $fields = $fieldStmt->fetchAll();

            // Group fields under their section
            $fieldsBySection = [];
            foreach ($fields as $f) {
                $sid = $f['section_id'] !== null ? (int)$f['section_id'] : 0;
                $fieldsBySection[$sid][] = $f;
            }
            foreach ($sections as &$s) {
                $s['fields'] = $fieldsBySection[(int)$s['id']] ?? [];
            }
            unset($s);

            Json::send(['form' => $form, 'sections' => $sections]);
        }

        if ($method === 'PUT') {
            $body     = Json::readBody();
            $newSlug  = strtolower(trim((string)($body['slug'] ?? $form['slug'])));
            $sections = is_array($body['sections'] ?? null) ? $body['sections'] : [];

            if (!preg_match(Ddl::IDENT_RE, $newSlug)) Json::fail('Invalid slug', 400);
            if (empty($sections)) Json::fail('At least one section is required', 400);

            // Validate everything up-front
            $cleanSections = [];
            $cleanNewFields = [];
            foreach ($sections as $sIdx => $s) {
                $secSlug = strtolower(trim((string)($s['slug'] ?? '')));
                if (!preg_match(Ddl::IDENT_RE, $secSlug)) Json::fail("Invalid section slug at #{$sIdx}", 400);
                $secFields = is_array($s['fields'] ?? null) ? $s['fields'] : [];
                $cleanFields = [];
                foreach ($secFields as $f) {
                    $f['name'] = strtolower(trim((string)($f['name'] ?? '')));
                    Ddl::assertField($f);
                    if (!isset($f['type'])) Json::fail("Field type required for {$f['name']}", 400);
                    $cleanFields[]    = $f;
                    $cleanNewFields[] = $f;
                }
                $cleanSections[] = [
                    'id'          => isset($s['id']) ? (int)$s['id'] : null,
                    'slug'        => $secSlug,
                    'title'       => trim((string)($s['title'] ?? '')),
                    'description' => $s['description'] ?? null,
                    'sort_order'  => (int)($s['sort_order'] ?? $sIdx),
                    'fields'      => $cleanFields,
                ];
            }

            $oldFieldsStmt = $pdo->prepare('SELECT * FROM form_fields WHERE form_id = ? ORDER BY sort_order, id');
            $oldFieldsStmt->execute([$id]);
            $oldFields = $oldFieldsStmt->fetchAll();

            $placement = ($body['sidenav_placement'] ?? $form['sidenav_placement']) === 'child' ? 'child' : 'top';
            $parentKey = $placement === 'child' && !empty($body['sidenav_parent_key'])
                ? substr((string)$body['sidenav_parent_key'], 0, 40) : null;
            // Don't let a form parent itself
            if ($parentKey === (string)$id) $parentKey = null;

            $parentProcessId = !empty($body['parent_process_form_id']) ? (int)$body['parent_process_form_id'] : null;
            if ($parentProcessId === $id) $parentProcessId = null;
            $showRoot = !empty($body['show_in_sidenav_root']) ? 1 : 0;

            $hasPrice = !empty($body['has_price']) ? 1 : 0;
            $price = ($hasPrice && isset($body['price']) && $body['price'] !== '' && $body['price'] !== null)
                ? (float)$body['price'] : null;
            $paymentType = ($body['payment_type'] ?? 'one_off') === 'recurring' ? 'recurring' : 'one_off';
            $repeatDuration = null;
            if ($paymentType === 'recurring' && in_array($body['repeat_duration'] ?? '', ['weekly','monthly','quarterly','yearly'], true)) {
                $repeatDuration = $body['repeat_duration'];
            }
            $isIndefinite = !empty($body['is_indefinite']) ? 1 : 0;
            $contractLength = ($paymentType === 'recurring' && !$isIndefinite && isset($body['contract_length_months']) && $body['contract_length_months'] !== '' && $body['contract_length_months'] !== null)
                ? (int)$body['contract_length_months'] : null;
            $teamId = !empty($body['team_id']) ? (int)$body['team_id'] : null;

            // 1) Update form metadata
            $upd = $pdo->prepare("UPDATE forms SET
                slug=?, main_section_label=?, sidenav_placement=?, sidenav_parent_key=?,
                parent_process_form_id=?, team_id=?, show_in_sidenav_root=?,
                title=?, description=?, intro_html=?, submit_label=?,
                thank_you_message=?, notify_email=?, notify_subject=?, notify_template=?,
                reply_subject=?, reply_template=?, reply_from_field=?, is_published=?,
                has_price=?, price=?, payment_type=?, repeat_duration=?, contract_length_months=?, is_indefinite=?
                WHERE id = ?");
            $upd->execute([
                $newSlug,
                $body['main_section_label'] ?? null,
                $placement,
                $parentKey,
                $parentProcessId,
                $teamId,
                $showRoot,
                (string)($body['title'] ?? $form['title']),
                $body['description']       ?? null,
                $body['intro_html']        ?? null,
                $body['submit_label']      ?? 'Submit',
                $body['thank_you_message'] ?? null,
                $body['notify_email']      ?? null,
                $body['notify_subject']    ?? null,
                $body['notify_template']   ?? null,
                $body['reply_subject']     ?? null,
                $body['reply_template']    ?? null,
                $body['reply_from_field']  ?? null,
                !empty($body['is_published']) ? 1 : 0,
                $hasPrice,
                $price,
                $paymentType,
                $repeatDuration,
                $contractLength,
                $isIndefinite,
                $id,
            ]);

            // 2) DDL diff (creates/drops/renames columns + renames table if slug changed)
            try {
                Ddl::syncTable($form['slug'], $newSlug, $oldFields, $cleanNewFields);
            } catch (\Throwable $e) {
                Json::fail('Failed to sync table: ' . $e->getMessage(), 400);
            }

            // 3) Diff sections — delete sections that vanished
            $newSectionIds = array_filter(array_map(fn($s) => (int)($s['id'] ?? 0), $cleanSections));
            $delSql = 'DELETE FROM form_sections WHERE form_id = ?';
            if ($newSectionIds) $delSql .= ' AND id NOT IN (' . implode(',', array_map('intval', $newSectionIds)) . ')';
            $pdo->prepare($delSql)->execute([$id]);

            // 4) Upsert sections (insert when no id, update when id present)
            $insSection = $pdo->prepare("INSERT INTO form_sections (form_id, slug, title, description, sort_order)
                                         VALUES (?,?,?,?,?)");
            $updSection = $pdo->prepare("UPDATE form_sections SET slug=?, title=?, description=?, sort_order=?
                                         WHERE id = ? AND form_id = ?");
            $resolvedSectionIds = []; // keyed by slug -> id
            foreach ($cleanSections as $sec) {
                if ($sec['id']) {
                    $updSection->execute([$sec['slug'], $sec['title'], $sec['description'], $sec['sort_order'], $sec['id'], $id]);
                    $resolvedSectionIds[$sec['slug']] = (int)$sec['id'];
                } else {
                    $insSection->execute([$id, $sec['slug'], $sec['title'], $sec['description'], $sec['sort_order']]);
                    $resolvedSectionIds[$sec['slug']] = (int)$pdo->lastInsertId();
                }
            }

            // 5) Diff fields (analogous to sections)
            $newFieldIds = array_filter(array_map(fn($f) => (int)($f['id'] ?? 0), $cleanNewFields));
            $delF = "DELETE FROM form_fields WHERE form_id = ?";
            if ($newFieldIds) $delF .= " AND id NOT IN (" . implode(',', array_map('intval', $newFieldIds)) . ")";
            $pdo->prepare($delF)->execute([$id]);

            $insField = $pdo->prepare("INSERT INTO form_fields
                (form_id, section_id, name, label, type, is_required, options_json, placeholder, help_text, sort_order)
                VALUES (?,?,?,?,?,?,?,?,?,?)");
            $updField = $pdo->prepare("UPDATE form_fields SET
                section_id=?, name=?, label=?, type=?, is_required=?, options_json=?, placeholder=?, help_text=?, sort_order=?
                WHERE id = ? AND form_id = ?");

            $globalSort = 0;
            foreach ($cleanSections as $sec) {
                $sectionId = $resolvedSectionIds[$sec['slug']];
                foreach ($sec['fields'] as $f) {
                    $optsJson = isset($f['options_json'])
                        ? (is_string($f['options_json']) ? $f['options_json'] : json_encode($f['options_json']))
                        : null;
                    if (!empty($f['id'])) {
                        $updField->execute([
                            $sectionId,
                            $f['name'],
                            (string)($f['label'] ?? $f['name']),
                            (string)$f['type'],
                            !empty($f['is_required']) ? 1 : 0,
                            $optsJson,
                            $f['placeholder'] ?? null,
                            $f['help_text']   ?? null,
                            $globalSort,
                            (int)$f['id'],
                            $id,
                        ]);
                    } else {
                        $insField->execute([
                            $id,
                            $sectionId,
                            $f['name'],
                            (string)($f['label'] ?? $f['name']),
                            (string)$f['type'],
                            !empty($f['is_required']) ? 1 : 0,
                            $optsJson,
                            $f['placeholder'] ?? null,
                            $f['help_text']   ?? null,
                            $globalSort,
                        ]);
                    }
                    $globalSort++;
                }
            }

            Json::send(['ok' => true, 'slug' => $newSlug]);
        }

        if ($method === 'DELETE') {
            try {
                Ddl::dropTable($form['slug']);
            } catch (\Throwable $e) {
                Json::fail('Failed to drop table: ' . $e->getMessage(), 400);
            }
            $pdo->prepare('DELETE FROM forms WHERE id = ?')->execute([$id]);
            Json::send(['ok' => true]);
        }
    }

    // /api/onboarding/forms/:id/clients[/:cid]
    if (($segs[3] ?? '') === 'clients') {
        $cid = isset($segs[4]) ? (int)$segs[4] : null;

        // Collection: /api/onboarding/forms/:id/clients
        if ($cid === null) {
            if ($method === 'GET') {
                // ?qualified=1 returns only qualified rows; default returns only NOT qualified
                $wantQualified = !empty($_GET['qualified']);
                $where = $wantQualified ? 'qualified_at IS NOT NULL' : 'qualified_at IS NULL';
                $stmt = $pdo->prepare("
                    SELECT id, form_id, submission_id, client_email, client_name, client_token,
                           completed_sections, started_at, last_edited_at, submitted_at, qualified_at, edited_after_submit
                    FROM onboarding_clients
                    WHERE form_id = ? AND $where
                    ORDER BY id DESC
                ");
                $stmt->execute([$id]);
                $clients = $stmt->fetchAll();

                $totalStmt = $pdo->prepare('SELECT COUNT(*) FROM form_sections WHERE form_id = ?');
                $totalStmt->execute([$id]);
                $total = (int)$totalStmt->fetchColumn();

                // Required-field progress: for each client, count how many of the
                // form's required fields are filled in their per-form data row.
                $reqStmt = $pdo->prepare('SELECT name FROM form_fields WHERE form_id = ? AND is_required = 1');
                $reqStmt->execute([$id]);
                $required = array_column($reqStmt->fetchAll(), 'name');
                $totalReq = count($required);

                if ($totalReq > 0 && !empty($clients)) {
                    $table = Ddl::tableName($form['slug']);
                    $cols  = implode(',', array_map(fn($n) => "`$n`", $required));
                    foreach ($clients as &$c) {
                        $c['total_required']  = $totalReq;
                        $c['filled_required'] = 0;
                        if (!empty($c['submission_id'])) {
                            $rs = $pdo->prepare("SELECT $cols FROM `$table` WHERE id = ?");
                            $rs->execute([$c['submission_id']]);
                            $row = $rs->fetch();
                            if ($row) {
                                foreach ($required as $name) {
                                    $val = $row[$name] ?? null;
                                    $str = is_string($val) ? trim($val) : (string)$val;
                                    if ($str === '' || $str === '[]') continue;
                                    $c['filled_required']++;
                                }
                            }
                        }
                    }
                    unset($c);
                } else {
                    foreach ($clients as &$c) {
                        $c['total_required']  = $totalReq;
                        $c['filled_required'] = 0;
                    }
                    unset($c);
                }

                Json::send([
                    'clients' => $clients,
                    'total_sections' => $total,
                    'total_required' => $totalReq,
                ]);
            }

            if ($method === 'POST') {
                $body            = Json::readBody();
                $parentClientId  = !empty($body['parent_client_id']) ? (int)$body['parent_client_id'] : null;

                // If a parent client is supplied, derive email/name from that record
                // so callers don't need to repeat what we already have.
                if ($parentClientId !== null) {
                    $pc = $pdo->prepare('SELECT client_email, client_name FROM onboarding_clients WHERE id = ?');
                    $pc->execute([$parentClientId]);
                    $parent = $pc->fetch();
                    if (!$parent) Json::fail('Parent client not found', 400);
                    $email = trim((string)($body['client_email'] ?? $parent['client_email']));
                    $name  = trim((string)($body['client_name']  ?? ($parent['client_name'] ?? '')));
                } else {
                    $email = trim((string)($body['client_email'] ?? ''));
                    $name  = trim((string)($body['client_name']  ?? ''));
                }
                if (!filter_var($email, FILTER_VALIDATE_EMAIL)) Json::fail('Valid client email required', 400);

                $token = bin2hex(random_bytes(32));
                $ins = $pdo->prepare("INSERT INTO onboarding_clients
                    (form_id, parent_client_id, client_email, client_name, client_token)
                    VALUES (?,?,?,?,?)");
                $ins->execute([$id, $parentClientId, $email, $name ?: null, $token]);
                $clientId = (int)$pdo->lastInsertId();

                $base = rtrim($GLOBALS['BRS_CONFIG']['base_url'] ?? '', '/');
                $url  = "{$base}/onboarding/{$id}/{$token}";
                Json::send(['id' => $clientId, 'token' => $token, 'url' => $url], 201);
            }

            Json::fail('Method not allowed', 405);
        }

        // Item: /api/onboarding/forms/:id/clients/:cid
        $cstmt = $pdo->prepare('SELECT * FROM onboarding_clients WHERE id = ? AND form_id = ?');
        $cstmt->execute([$cid, $id]);
        $client = $cstmt->fetch();
        if (!$client) Json::fail('Client not found', 404);

        if ($method === 'GET') {
            $row = null;
            if ($client['submission_id']) {
                $table = Ddl::tableName($form['slug']);
                $rs = $pdo->prepare("SELECT * FROM `$table` WHERE id = ?");
                $rs->execute([$client['submission_id']]);
                $row = $rs->fetch() ?: null;
            }
            $base = rtrim($GLOBALS['BRS_CONFIG']['base_url'] ?? '', '/');
            $client['url'] = "{$base}/onboarding/{$client['form_id']}/{$client['client_token']}";
            Json::send(['client' => $client, 'submission' => $row]);
        }

        if ($method === 'DELETE') {
            // Drop the per-form row first (if any), then the client record
            if ($client['submission_id']) {
                $table = Ddl::tableName($form['slug']);
                $pdo->prepare("DELETE FROM `$table` WHERE id = ?")->execute([$client['submission_id']]);
            }
            $pdo->prepare('DELETE FROM onboarding_clients WHERE id = ?')->execute([$cid]);
            Json::send(['ok' => true]);
        }

        // /api/onboarding/forms/:id/clients/:cid/acknowledge — clears the "edited after submit"
        // flag so the next post-submit edit re-fires the notification.
        if (($segs[5] ?? '') === 'acknowledge' && $method === 'POST') {
            $pdo->prepare('UPDATE onboarding_clients SET edited_after_submit = 0 WHERE id = ?')->execute([$cid]);
            Json::send(['ok' => true]);
        }

        // /api/onboarding/forms/:id/clients/:cid/qualify — moves the client from
        // the onboarding pipeline into the form's main section. Idempotent:
        // POST with no body sets qualified_at; sending {"unqualify":true} clears it.
        // On qualify, if the form is bound to a task team (forms.team_id), auto-create
        // a task project owned by that team — back-linked via task_projects.onboarding_client_id.
        if (($segs[5] ?? '') === 'qualify' && $method === 'POST') {
            $body = Json::readBody();
            if (!empty($body['unqualify'])) {
                $pdo->prepare('UPDATE onboarding_clients SET qualified_at = NULL WHERE id = ?')->execute([$cid]);
            } else {
                $pdo->prepare('UPDATE onboarding_clients SET qualified_at = COALESCE(qualified_at, NOW()) WHERE id = ?')->execute([$cid]);

                // Look up form team + client info for project creation.
                $info = $pdo->prepare('SELECT f.id AS form_id, f.title AS form_title, f.team_id,
                                              oc.client_email, oc.client_name
                                       FROM onboarding_clients oc
                                       JOIN forms f ON f.id = oc.form_id
                                       WHERE oc.id = ?');
                $info->execute([$cid]);
                $row = $info->fetch();

                if ($row && !empty($row['team_id'])) {
                    $exists = $pdo->prepare('SELECT id FROM task_projects WHERE onboarding_client_id = ?');
                    $exists->execute([$cid]);
                    if (!$exists->fetch()) {
                        $clientLabel = trim((string)($row['client_name'] ?? '')) ?: trim((string)($row['client_email'] ?? '')) ?: 'Client';
                        $projectName = trim((string)$row['form_title']) . ' — ' . $clientLabel;
                        // Slug is unique-per-team per existing schema; salt with the
                        // onboarding_client id so the same template + client combo
                        // never collides with a previous one.
                        $base = preg_replace('/[^a-z0-9]+/', '-', strtolower($projectName));
                        $base = trim($base, '-');
                        if ($base === '') $base = 'project';
                        $slug = substr($base, 0, 60) . '-' . $cid;

                        // Best-effort link to the canonical clients row by email so
                        // the project's client_id is populated immediately, not just
                        // the onboarding back-link.
                        $linkedClientId = null;
                        $email = trim((string)($row['client_email'] ?? ''));
                        if ($email !== '') {
                            $cstmt = $pdo->prepare('SELECT id FROM clients WHERE LOWER(email) = LOWER(?) LIMIT 1');
                            $cstmt->execute([$email]);
                            $cmatch = $cstmt->fetch();
                            if ($cmatch) $linkedClientId = (int)$cmatch['id'];
                        }

                        $insP = $pdo->prepare('INSERT INTO task_projects
                            (team_id, slug, name, description, client_id, status, onboarding_client_id)
                            VALUES (?,?,?,?,?,?,?)');
                        $insP->execute([
                            (int)$row['team_id'],
                            $slug,
                            $projectName,
                            'Auto-created from onboarding qualification.',
                            $linkedClientId,
                            'new',
                            $cid,
                        ]);
                    }
                }
            }
            Json::send(['ok' => true]);
        }

        Json::fail('Method not allowed', 405);
    }

    Json::fail('Not found', 404);
};
