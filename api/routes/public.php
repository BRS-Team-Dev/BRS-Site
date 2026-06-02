<?php
declare(strict_types=1);

use BRS\Db;
use BRS\Ddl;
use BRS\Json;
use BRS\Mailer;
use BRS\Validator;

if (!function_exists('brs_default_notify_body')) {
    function brs_default_notify_body(array $fields, array $row): string
    {
        $html = '<h2>New form submission</h2><table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;font-family:sans-serif">';
        foreach ($fields as $f) {
            $val = $row[$f['name']] ?? '';
            $html .= '<tr><td><strong>' . htmlspecialchars($f['label']) . '</strong></td><td>' . htmlspecialchars((string)$val) . '</td></tr>';
        }
        $html .= '</table>';
        return $html;
    }
}

return function (string $method, array $segs): void {
    // /api/public/forms/:slug                  → GET form schema
    // /api/public/forms/:slug/submit           → POST submission
    // /api/public/onboarding/:formId/:token    → GET / PUT / submit
    // /api/public/jobs[/:slug]                 → GET (anonymous postings)
    if (($segs[1] ?? '') === 'onboarding') {
        (require __DIR__ . '/public_onboarding.php')($method, $segs);
        return;
    }
    if (($segs[1] ?? '') === 'jobs') {
        (require __DIR__ . '/public_jobs.php')($method, $segs);
        return;
    }
    if (($segs[1] ?? '') === 'legal') {
        (require __DIR__ . '/public_legal.php')($method, $segs);
        return;
    }
    // /api/public/newsletter/unsubscribe?token=… — public, no auth.
    // Records the email in `newsletter_suppressions` so future campaigns skip
    // it, marks the corresponding recipient row, and returns a tiny HTML
    // confirmation page.
    if (($segs[1] ?? '') === 'newsletter' && ($segs[2] ?? '') === 'unsubscribe') {
        $token = trim((string)($_GET['token'] ?? ''));
        if ($token === '') {
            http_response_code(400);
            header('Content-Type: text/html; charset=utf-8');
            echo '<!doctype html><meta charset="utf-8"><title>Unsubscribe</title>'
               . '<body style="font-family:sans-serif;padding:40px;text-align:center"><h2>Missing token</h2></body>';
            return;
        }
        $pdo  = Db::pdo();
        $stmt = $pdo->prepare('SELECT email FROM newsletter_recipients WHERE unsubscribe_token = ?');
        $stmt->execute([$token]);
        $email = $stmt->fetchColumn();
        if ($email) {
            $pdo->prepare(
                'INSERT INTO newsletter_suppressions (email, reason)
                 VALUES (?, "user_unsubscribe")
                 ON DUPLICATE KEY UPDATE unsubscribed_at = CURRENT_TIMESTAMP'
            )->execute([$email]);
            $pdo->prepare(
                'UPDATE newsletter_recipients SET status = "suppressed"
                 WHERE email = ? AND status <> "sent"'
            )->execute([$email]);
        }
        header('Content-Type: text/html; charset=utf-8');
        $msg = $email
            ? 'You\'ve been unsubscribed. <strong>' . htmlspecialchars((string)$email, ENT_QUOTES, 'UTF-8') . '</strong> will no longer receive newsletters from us.'
            : 'This unsubscribe link is invalid or already processed.';
        echo '<!doctype html><meta charset="utf-8"><title>Unsubscribed</title>'
           . '<body style="font-family:sans-serif;padding:60px 20px;text-align:center;color:#333">'
           . '<h2 style="font-weight:600">Unsubscribed</h2>'
           . '<p style="max-width:480px;margin:12px auto;line-height:1.5">' . $msg . '</p>'
           . '</body>';
        return;
    }

    if (($segs[1] ?? '') !== 'forms') Json::fail('Not found', 404);
    $slug = strtolower((string)($segs[2] ?? ''));
    if (!preg_match(Ddl::IDENT_RE, $slug)) Json::fail('Invalid form', 400);

    $pdo = Db::pdo();
    $f = $pdo->prepare('SELECT * FROM forms WHERE slug = ? AND is_published = 1');
    $f->execute([$slug]);
    $form = $f->fetch();
    if (!$form) Json::fail('Form not found', 404);

    $ff = $pdo->prepare('SELECT id, name, label, type, is_required, options_json, placeholder, help_text, sort_order
                         FROM form_fields WHERE form_id = ? ORDER BY sort_order, id');
    $ff->execute([$form['id']]);
    $fields = $ff->fetchAll();
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

    if ($method === 'GET' && !isset($segs[3])) {
        $brandRows = $pdo->query("SELECT k, v FROM settings WHERE k IN ('public_form_bg_color','brand_name','brand_logo_url')")->fetchAll();
        $brand = ['public_form_bg_color' => '', 'brand_name' => '', 'brand_logo_url' => ''];
        foreach ($brandRows as $r) { $brand[$r['k']] = (string)$r['v']; }
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
            'fields' => $fields,
            'branding' => [
                'bg_color'  => $brand['public_form_bg_color'],
                'name'      => $brand['brand_name'],
                'logo_url'  => $brand['brand_logo_url'],
            ],
        ]);
    }

    if ($method === 'POST' && ($segs[3] ?? '') === 'submit') {
        $isJson  = stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== false;
        $input   = $isJson ? Json::readBody() : $_POST;
        $files   = $_FILES ?? [];

        [$row, $errors] = Validator::validate($fields, $input, $files);
        if ($errors) Json::fail('Validation failed', 422, ['fields' => $errors]);

        $row['ip_address'] = $_SERVER['REMOTE_ADDR'] ?? null;
        $table = Ddl::tableName($slug);

        $cols  = ['`ip_address`'];
        $marks = ['?'];
        $vals  = [$row['ip_address']];
        foreach ($fields as $field) {
            if ($field['type'] === 'file') continue;
            $cols[]  = "`{$field['name']}`";
            $marks[] = '?';
            $vals[]  = $row[$field['name']] ?? null;
        }

        $sql  = "INSERT INTO `$table` (" . implode(',', $cols) . ") VALUES (" . implode(',', $marks) . ")";
        $pdo->prepare($sql)->execute($vals);
        $rowId = (int)$pdo->lastInsertId();

        // Move uploaded files
        $cfg = $GLOBALS['BRS_CONFIG'];
        $uploadRoot = $cfg['storage_dir'] . "/uploads/$slug/$rowId";
        $maxBytes = ((int)($pdo->query("SELECT v FROM settings WHERE k='upload_max_mb'")->fetchColumn() ?: 10)) * 1024 * 1024;

        foreach ($fields as $field) {
            $fname = $field['name'];

            if ($field['type'] === 'file') {
                if (empty($files[$fname]) || ($files[$fname]['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) continue;
                if ($files[$fname]['size'] > $maxBytes) {
                    $pdo->prepare("DELETE FROM `$table` WHERE id = ?")->execute([$rowId]);
                    Json::fail("File '$fname' exceeds max size", 422);
                }
                if (!is_dir($uploadRoot)) mkdir($uploadRoot, 0755, true);
                $safe = preg_replace('/[^a-zA-Z0-9._-]/', '_', $files[$fname]['name'] ?: 'upload.bin');
                $dest = "$uploadRoot/$safe";
                move_uploaded_file($files[$fname]['tmp_name'], $dest);
                $relative = "uploads/$slug/$rowId/$safe";
                $pdo->prepare("UPDATE `$table` SET `$fname` = ? WHERE id = ?")->execute([$relative, $rowId]);
                continue;
            }

            if ($field['type'] === 'multi_file') {
                if (empty($files[$fname]) || !is_array($files[$fname]['name'] ?? null)) continue;
                if (!is_dir($uploadRoot)) mkdir($uploadRoot, 0755, true);
                $paths = [];
                $count = count($files[$fname]['name']);
                for ($i = 0; $i < $count; $i++) {
                    if (($files[$fname]['error'][$i] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) continue;
                    if ($files[$fname]['size'][$i] > $maxBytes) {
                        $pdo->prepare("DELETE FROM `$table` WHERE id = ?")->execute([$rowId]);
                        Json::fail("File '$fname' exceeds max size", 422);
                    }
                    $safe = preg_replace('/[^a-zA-Z0-9._-]/', '_', $files[$fname]['name'][$i] ?: 'upload.bin');
                    // Disambiguate identical filenames within the same field
                    $dest = "$uploadRoot/{$fname}_{$i}_{$safe}";
                    move_uploaded_file($files[$fname]['tmp_name'][$i], $dest);
                    $paths[] = "uploads/$slug/$rowId/{$fname}_{$i}_{$safe}";
                }
                $pdo->prepare("UPDATE `$table` SET `$fname` = ? WHERE id = ?")
                    ->execute([json_encode($paths, JSON_UNESCAPED_UNICODE), $rowId]);
            }
        }

        // Re-read row with file paths so templates can render them
        $rowFull = $pdo->prepare("SELECT * FROM `$table` WHERE id = ?");
        $rowFull->execute([$rowId]);
        $rowFull = $rowFull->fetch() ?: $row;

        if (!empty($form['notify_email']) && Mailer::isConfigured()) {
            $subj = (string)($form['notify_subject'] ?: "New submission: {$form['title']}");
            $body = (string)($form['notify_template'] ?? '');
            $body = $body !== '' ? Mailer::render($body, $rowFull) : brs_default_notify_body($fields, $rowFull);
            Mailer::send($form['notify_email'], $subj, $body);
        }
        if (!empty($form['reply_from_field']) && !empty($rowFull[$form['reply_from_field']]) && Mailer::isConfigured()) {
            $to = (string)$rowFull[$form['reply_from_field']];
            if (filter_var($to, FILTER_VALIDATE_EMAIL)) {
                $subj = (string)($form['reply_subject'] ?: 'Thanks for your submission');
                $body = Mailer::render((string)($form['reply_template'] ?: '<p>Thank you for your submission.</p>'), $rowFull);
                Mailer::send($to, $subj, $body);
            }
        }

        Json::send([
            'ok' => true,
            'thank_you_message' => $form['thank_you_message'] ?: 'Thanks — your submission was received.',
        ]);
    }

    Json::fail('Not found', 404);
};
