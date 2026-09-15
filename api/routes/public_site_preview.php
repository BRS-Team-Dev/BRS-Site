<?php
declare(strict_types=1);

use BRS\Db;
use BRS\Json;
use BRS\Tenant;

/*
 * Public, unauthenticated read of a site_previews row.
 * Called by the marketing site's site-view.html:
 *   GET /api/public-site-preview/:slug
 *
 * Only published rows are returned. Tenant is resolved via
 * Tenant::setForPublic() (BRS by default until per-tenant public
 * routing lands).
 */

// Permissive CORS so the marketing site's browser can fetch this
// from a different origin if the two ever land on different hosts.
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') { http_response_code(204); exit; }

return function (string $method, array $segs): void {
    if ($method !== 'GET') Json::fail('Method not allowed', 405);

    Tenant::setForPublic();
    $pdo  = Db::tpdo();
    $slug = strtolower(trim((string)($segs[1] ?? '')));
    if ($slug === '' || !preg_match('/^[a-z0-9-]+$/', $slug)) Json::fail('slug required', 400);

    $q = $pdo->prepare(
        'SELECT slug, name, category, feature_json, mockup_json,
                fullvideo, fullimage
         FROM site_previews
         WHERE slug = ? AND is_published = 1 LIMIT 1'
    );
    $q->execute([$slug]);
    $row = $q->fetch();
    if (!$row) Json::fail('Not found', 404);

    Json::send([
        'slug'      => $row['slug'],
        'name'      => $row['name'],
        'category'  => $row['category'],
        'feature'   => json_decode((string)$row['feature_json'], true) ?: (object)[],
        'mockup'    => json_decode((string)$row['mockup_json'],  true) ?: (object)[],
        'fullvideo' => $row['fullvideo'],
        'fullimage' => $row['fullimage'],
    ]);
};
