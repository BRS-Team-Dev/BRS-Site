<?php
declare(strict_types=1);

use BRS\Auth;
use BRS\Db;
use BRS\Ddl;
use BRS\Json;

// NOTE: MySQL DDL (CREATE/ALTER/DROP/RENAME TABLE) causes an *implicit commit* — so we
// cannot wrap DDL inside an explicit transaction. Instead we sequence operations carefully
// and do best-effort cleanup if something fails part-way.

return function (string $method, array $segs): void {
    Auth::require();
    $pdo = Db::tpdo();

    // /api/forms
    if (!isset($segs[1])) {
        if ($method === 'GET') {
            $rows = $pdo->query("
                SELECT f.*,
                       (SELECT COUNT(*) FROM form_fields ff WHERE ff.form_id = f.id) AS field_count
                FROM forms f
                WHERE f.form_type = 'standard'
                ORDER BY f.id DESC
            ")->fetchAll();
            foreach ($rows as &$r) {
                try {
                    $stmt = $pdo->query('SELECT COUNT(*) FROM ' . Ddl::tableName($r['slug']));
                    $r['submission_count'] = (int)$stmt->fetchColumn();
                } catch (\Throwable $e) {
                    $r['submission_count'] = 0;
                }
            }
            unset($r);
            Json::send(['forms' => $rows]);
        }
        if ($method === 'POST') {
            $body   = Json::readBody();
            $slug   = strtolower(trim((string)($body['slug'] ?? '')));
            $title  = trim((string)($body['title'] ?? ''));
            $fields = is_array($body['fields'] ?? null) ? $body['fields'] : [];

            if (!preg_match(Ddl::IDENT_RE, $slug)) Json::fail('Invalid slug (lowercase letters/digits/underscore, must start with a letter)', 400);
            if ($title === '') Json::fail('Title required', 400);

            // Validate fields up-front so we fail before any DB writes
            $cleanFields = [];
            foreach ($fields as $f) {
                $f['name'] = strtolower(trim((string)($f['name'] ?? '')));
                Ddl::assertField($f);
                if (!isset($f['type'])) Json::fail('Field type required for ' . $f['name'], 400);
                $cleanFields[] = $f;
            }

            $placement = ($body['sidenav_placement'] ?? 'top') === 'child' ? 'child' : 'top';
            $parentKey = $placement === 'child' && !empty($body['sidenav_parent_key'])
                ? substr((string)$body['sidenav_parent_key'], 0, 40) : null;
            $parentProcessId = !empty($body['parent_process_form_id']) ? (int)$body['parent_process_form_id'] : null;

            // Insert metadata first
            $ins = $pdo->prepare("INSERT INTO forms (slug, sidenav_placement, sidenav_parent_key, parent_process_form_id,
                title, description, intro_html, submit_label,
                thank_you_message, notify_email, notify_subject, notify_template,
                reply_subject, reply_template, reply_from_field, is_published)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
            $ins->execute([
                $slug, $placement, $parentKey, $parentProcessId,
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
            ]);
            $formId = (int)$pdo->lastInsertId();

            $insField = $pdo->prepare("INSERT INTO form_fields
                (form_id, name, label, type, is_required, options_json, placeholder, help_text, sort_order)
                VALUES (?,?,?,?,?,?,?,?,?)");
            $sortOrder = 0;
            foreach ($cleanFields as $f) {
                $insField->execute([
                    $formId,
                    $f['name'],
                    (string)($f['label'] ?? $f['name']),
                    (string)$f['type'],
                    !empty($f['is_required']) ? 1 : 0,
                    isset($f['options_json']) ? (is_string($f['options_json']) ? $f['options_json'] : json_encode($f['options_json'])) : null,
                    $f['placeholder'] ?? null,
                    $f['help_text']   ?? null,
                    $sortOrder++,
                ]);
            }

            // Now DDL — if this fails, clean up the metadata so user can retry
            try {
                Ddl::createTable($slug, $cleanFields);
            } catch (\Throwable $e) {
                $pdo->prepare('DELETE FROM forms WHERE id = ?')->execute([$formId]);
                Json::fail('Failed to create table: ' . $e->getMessage(), 400);
            }

            Json::send(['id' => $formId, 'slug' => $slug], 201);
        }
        Json::fail('Method not allowed', 405);
    }

    $id = (int)$segs[1];
    if ($id <= 0) Json::fail('Invalid form id', 400);

    $form = $pdo->prepare('SELECT * FROM forms WHERE id = ?');
    $form->execute([$id]);
    $form = $form->fetch();
    if (!$form) Json::fail('Form not found', 404);

    // /api/forms/:id
    if (!isset($segs[2])) {
        if ($method === 'GET') {
            $ff = $pdo->prepare('SELECT * FROM form_fields WHERE form_id = ? ORDER BY sort_order, id');
            $ff->execute([$id]);
            Json::send(['form' => $form, 'fields' => $ff->fetchAll()]);
        }
        if ($method === 'PUT') {
            $body = Json::readBody();
            $newSlug = strtolower(trim((string)($body['slug'] ?? $form['slug'])));
            if (!preg_match(Ddl::IDENT_RE, $newSlug)) Json::fail('Invalid slug', 400);

            $newFields = is_array($body['fields'] ?? null) ? $body['fields'] : [];

            // Validate up-front
            $cleanNew = [];
            foreach ($newFields as $f) {
                $f['name'] = strtolower(trim((string)($f['name'] ?? '')));
                Ddl::assertField($f);
                if (!isset($f['type'])) Json::fail('Field type required for ' . $f['name'], 400);
                $cleanNew[] = $f;
            }

            $oldFieldsStmt = $pdo->prepare('SELECT * FROM form_fields WHERE form_id = ? ORDER BY sort_order, id');
            $oldFieldsStmt->execute([$id]);
            $oldFields = $oldFieldsStmt->fetchAll();

            $placement = ($body['sidenav_placement'] ?? $form['sidenav_placement']) === 'child' ? 'child' : 'top';
            $parentKey = $placement === 'child' && !empty($body['sidenav_parent_key'])
                ? substr((string)$body['sidenav_parent_key'], 0, 40) : null;
            if ($parentKey === (string)$id) $parentKey = null;
            $parentProcessId = !empty($body['parent_process_form_id']) ? (int)$body['parent_process_form_id'] : null;
            if ($parentProcessId === $id) $parentProcessId = null;

            // 1) Update metadata
            $upd = $pdo->prepare("UPDATE forms SET
                slug=?, sidenav_placement=?, sidenav_parent_key=?, parent_process_form_id=?,
                title=?, description=?, intro_html=?, submit_label=?,
                thank_you_message=?, notify_email=?, notify_subject=?, notify_template=?,
                reply_subject=?, reply_template=?, reply_from_field=?, is_published=?
                WHERE id = ?");
            $upd->execute([
                $newSlug, $placement, $parentKey, $parentProcessId,
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
                $id,
            ]);

            // 2) DDL diff
            try {
                Ddl::syncTable($form['slug'], $newSlug, $oldFields, $cleanNew);
            } catch (\Throwable $e) {
                Json::fail('Failed to sync table: ' . $e->getMessage(), 400);
            }

            // 3) Replace form_fields rows: delete those whose ids vanished, upsert the rest
            $newIds = array_filter(array_map(fn($f) => (int)($f['id'] ?? 0), $cleanNew));
            $sql = "DELETE FROM form_fields WHERE form_id = ?";
            if ($newIds) $sql .= " AND id NOT IN (" . implode(',', array_map('intval', $newIds)) . ")";
            $pdo->prepare($sql)->execute([$id]);

            $insField = $pdo->prepare("INSERT INTO form_fields
                (form_id, name, label, type, is_required, options_json, placeholder, help_text, sort_order)
                VALUES (?,?,?,?,?,?,?,?,?)");
            $updField = $pdo->prepare("UPDATE form_fields SET
                name=?, label=?, type=?, is_required=?, options_json=?, placeholder=?, help_text=?, sort_order=?
                WHERE id = ? AND form_id = ?");
            $sortOrder = 0;
            foreach ($cleanNew as $f) {
                $optsJson = isset($f['options_json']) ? (is_string($f['options_json']) ? $f['options_json'] : json_encode($f['options_json'])) : null;
                if (!empty($f['id'])) {
                    $updField->execute([
                        $f['name'],
                        (string)($f['label'] ?? $f['name']),
                        (string)$f['type'],
                        !empty($f['is_required']) ? 1 : 0,
                        $optsJson,
                        $f['placeholder'] ?? null,
                        $f['help_text']   ?? null,
                        $sortOrder,
                        (int)$f['id'],
                        $id,
                    ]);
                } else {
                    $insField->execute([
                        $id,
                        $f['name'],
                        (string)($f['label'] ?? $f['name']),
                        (string)$f['type'],
                        !empty($f['is_required']) ? 1 : 0,
                        $optsJson,
                        $f['placeholder'] ?? null,
                        $f['help_text']   ?? null,
                        $sortOrder,
                    ]);
                }
                $sortOrder++;
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

    Json::fail('Not found', 404);
};
