<?php
declare(strict_types=1);

use BRS\Auth;
use BRS\Db;
use BRS\Json;
use BRS\Mailer;
use BRS\Tenant;

return function (string $method, array $segs): void {
    Auth::require();
    $pdo = Db::tpdo();

    // GET /api/settings/logo-fetch?url=<encoded>
    // Server-side proxy for logo bytes. The PDF drawer converts the
    // logo to a base64 data URL client-side; when the logo lives on a
    // different origin (dev on :4200 vs prod on the same host as an
    // externally-hosted brand asset) the browser CORS check blocks
    // that fetch. Routing it through the API is same-origin from the
    // frontend, so the fetch always succeeds. Auth-gated to keep this
    // from becoming a general-purpose open URL proxy.
    if (($segs[1] ?? '') === 'logo-fetch' && $method === 'GET') {
        $url = (string)($_GET['url'] ?? '');
        if (!filter_var($url, FILTER_VALIDATE_URL) || !preg_match('#^https?://#i', $url)) {
            Json::fail('Invalid url', 400);
        }
        $ctx = stream_context_create([
            'http'  => ['timeout' => 5, 'follow_location' => 1, 'max_redirects' => 3, 'user_agent' => 'BRS-Logo/1.0'],
            'https' => ['timeout' => 5, 'follow_location' => 1, 'max_redirects' => 3, 'user_agent' => 'BRS-Logo/1.0'],
        ]);
        $bytes = @file_get_contents($url, false, $ctx);
        if ($bytes === false) Json::fail('Fetch failed', 502);
        if (strlen($bytes) > 5 * 1024 * 1024) Json::fail('Image too large', 413);
        // Sniff the content type from response headers; default to
        // PNG for anything the origin doesn't label (still valid for
        // jsPDF's addImage, which reads the data URL prefix).
        $ct = 'image/png';
        foreach ($http_response_header ?? [] as $h) {
            if (preg_match('#^content-type:\s*([^;\s]+)#i', $h, $m)) { $ct = strtolower($m[1]); break; }
        }
        header('Content-Type: ' . $ct);
        header('Cache-Control: private, max-age=3600');
        echo $bytes;
        exit;
    }

    // /api/settings/logo — upload a brand logo image. Multipart POST
    // with a single `file` field. Stores under uploads/branding/{tenant_id}/
    // and returns the public URL. The frontend writes the URL into
    // the `brand_logo_url` settings key via the standard PUT.
    if (($segs[1] ?? '') === 'logo' && $method === 'POST') {
        $f = $_FILES['file'] ?? null;
        if (!$f || ($f['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
            Json::fail('No file uploaded', 400);
        }
        // Basic MIME + size validation — 5MB cap, images only.
        $mime = strtolower((string)($f['type'] ?? ''));
        $ok = ['image/png' => 'png', 'image/jpeg' => 'jpg', 'image/svg+xml' => 'svg', 'image/webp' => 'webp'];
        if (!isset($ok[$mime])) Json::fail('Unsupported file type — use PNG, JPG, SVG or WEBP', 400);
        if ((int)$f['size'] > 5 * 1024 * 1024) Json::fail('File exceeds 5MB', 400);
        $ext = $ok[$mime];

        $tid = Tenant::id();
        $dir = __DIR__ . '/../../uploads/branding/' . $tid;
        if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
            Json::fail('Failed to create upload directory', 500);
        }
        // Salt the filename so a cache-buster comes for free.
        $name = 'logo-' . bin2hex(random_bytes(6)) . '.' . $ext;
        $dest = "$dir/$name";
        if (!move_uploaded_file($f['tmp_name'], $dest)) Json::fail('Failed to save file', 500);

        // Public URL served from the same /cms/uploads path other
        // uploads use. Frontend appends this to whatever basePath its
        // environment is on when rendering the <img>.
        $url = '/cms/uploads/branding/' . $tid . '/' . $name;
        Json::send(['url' => $url], 201);
    }

    // /api/settings/test-mail
    if (($segs[1] ?? '') === 'test-mail' && $method === 'POST') {
        $body = Json::readBody();
        $to = trim((string)($body['to'] ?? ''));
        if (!filter_var($to, FILTER_VALIDATE_EMAIL)) Json::fail('Valid recipient email required', 400);
        [$ok, $err] = Mailer::send($to, 'BuiltRightStudio test email', '<p>Hello from BuiltRightStudio CMS — SMTP works.</p>');
        Json::send(['ok' => $ok, 'error' => $err]);
    }

    // /api/settings/theme — tenant-level brand colour theme.
    //
    // Writes the slug onto the REGISTRY row (tenants.color_theme), not
    // the per-tenant `settings` table — because the slug needs to be
    // readable BEFORE we've established tenant context (it travels in
    // the /auth/login + /auth/me response). After write, we flush the
    // APCu row cache so a refresh anywhere in the cluster sees the new
    // theme on the very next /auth/me hit.
    if (($segs[1] ?? '') === 'theme' && $method === 'PUT') {
        $body = Json::readBody();
        $slug = trim((string)($body['color_theme'] ?? ''));
        $allowed = ['midnight-gold','frosted-mint','sunrise-coral','indigo-pulse','graphite-rose','forest-amber'];
        $isPreset = in_array($slug, $allowed, true);
        // Custom slugs (migration 126) must exist in tenant_themes for
        // this tenant before we let them land on tenants.color_theme.
        $isKnownCustom = false;
        if (!$isPreset && strpos($slug, 'custom-') === 0) {
            $chk = Db::tpdo()->prepare('SELECT id FROM tenant_themes WHERE slug = ? LIMIT 1');
            $chk->execute([$slug]);
            $isKnownCustom = (bool)$chk->fetchColumn();
        }
        if (!$isPreset && !$isKnownCustom) Json::fail('Unknown theme', 400);

        // @global-scope: registry write — tenants is global, scoped by id.
        $upd = Db::pdo()->prepare('UPDATE tenants SET color_theme = ? WHERE id = ?');
        $upd->execute([$slug, Tenant::id()]);

        if (function_exists('apcu_delete')) {
            apcu_delete('brs.tenant.row.' . Tenant::id());
        }
        Json::send(['ok' => true, 'color_theme' => $slug]);
    }

    // Settings keys treated as secrets — masked on read, ignored on write
    // when the caller sends back the masked placeholder unchanged.
    $isSecret = static fn(string $k): bool =>
        $k === 'smtp_pass' || $k === 'linkedin_li_at' || $k === 'linkedin_csrf'
        || str_ends_with($k, '_api_key') || str_ends_with($k, '_secret');
    $maskedPlaceholder = '••••••••';

    if (!isset($segs[1])) {
        if ($method === 'GET') {
            $rows = $pdo->query('SELECT k, v FROM settings')->fetchAll();
            $out = [];
            foreach ($rows as $r) {
                $out[$r['k']] = $isSecret($r['k']) && $r['v'] !== '' ? $maskedPlaceholder : $r['v'];
            }
            Json::send(['settings' => $out]);
        }
        if ($method === 'PUT') {
            $body = Json::readBody();
            if (!is_array($body)) Json::fail('Invalid body', 400);
            $up = $pdo->prepare('INSERT INTO settings (k,v) VALUES (?,?) ON DUPLICATE KEY UPDATE v = VALUES(v)');
            foreach ($body as $k => $v) {
                // Allow dot-namespaced keys (e.g. `invoice.bank_name`) so
                // grouped settings don't collide with the flat keys we
                // shipped earlier. Still guards against SQL / control chars.
                if (!is_string($k) || !preg_match('/^[a-z_][a-z0-9_.]{0,79}$/', $k)) continue;
                // Don't overwrite secrets with the masked placeholder
                if ($isSecret($k) && $v === $maskedPlaceholder) continue;
                $up->execute([$k, is_scalar($v) ? (string)$v : json_encode($v)]);
            }
            Json::send(['ok' => true]);
        }
        Json::fail('Method not allowed', 405);
    }
    Json::fail('Not found', 404);
};
