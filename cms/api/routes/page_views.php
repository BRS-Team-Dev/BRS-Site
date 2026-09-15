<?php
declare(strict_types=1);

use BRS\Auth;
use BRS\Db;
use BRS\Json;
use BRS\Tenant;

/*
 * Page-view history for one lead or client — read side of migration 164.
 *
 *   GET /api/page-views?id_type=lead|client&record_id=N
 *     -> { views: [{ page, view_count, first_viewed_at, last_viewed_at }],
 *          total_views, pages }
 *
 * Feeds the Activity tab on the lead / client detail pages. Writes happen
 * only through the public beacon (routes/public_page_view.php); this route is
 * authenticated and read-only. Newest activity first.
 */
return function (string $method, array $segs): void {
    Auth::require();
    if ($method !== 'GET') Json::fail('Method not allowed', 405);

    $idType   = strtolower(trim((string)($_GET['id_type'] ?? '')));
    $recordId = (int)($_GET['record_id'] ?? 0);
    if (!in_array($idType, ['lead', 'client'], true)) Json::fail('id_type must be lead or client', 400);
    if ($recordId <= 0) Json::fail('record_id required', 400);

    // Explicit tenant_id keeps the static tenant-scope scanner happy; the
    // TenantPdo rewriter would inject it at runtime anyway.
    $q = Db::tpdo()->prepare(
        'SELECT page, view_count, first_viewed_at, last_viewed_at
           FROM page_views
          WHERE tenant_id = ? AND id_type = ? AND record_id = ?
          ORDER BY last_viewed_at DESC, page'
    );
    $q->execute([Tenant::id(), $idType, $recordId]);

    $views = [];
    $total = 0;
    foreach ($q->fetchAll() as $r) {
        $count  = (int)$r['view_count'];
        $total += $count;
        $views[] = [
            'page'            => (string)$r['page'],
            'view_count'      => $count,
            'first_viewed_at' => (string)$r['first_viewed_at'],
            'last_viewed_at'  => (string)$r['last_viewed_at'],
        ];
    }

    Json::send(['views' => $views, 'total_views' => $total, 'pages' => count($views)]);
};
