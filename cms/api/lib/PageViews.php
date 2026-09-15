<?php
declare(strict_types=1);

namespace BRS;

/**
 * Read-side helpers for `page_views` (migration 164), for LIST endpoints.
 *
 * routes/page_views.php serves one record at a time (the Activity tab). A list
 * table needs a total for every row at once, so this runs ONE grouped query per
 * list request - never one request or query per row.
 *
 * Deliberately a separate single-table query merged in PHP, rather than a JOIN
 * on a derived table inside the list SELECT:
 *   - the leads list SELECT ($leadSelect) is shared with the single-lead
 *     endpoint, which does not need it;
 *   - the shape below mirrors routes/page_views.php exactly (explicit
 *     tenant_id = ? for the static tenant-scope scanner; TenantPdo also scopes
 *     it at runtime), so it relies on nothing the SQL rewriter hasn't already
 *     proven it handles.
 */
final class PageViews
{
    /**
     * record_id => total views across every page, for one id_type.
     *
     * $pdo is untyped on purpose: Db::tpdo() returns BRS\TenantPdo, which does
     * not extend \PDO.
     */
    public static function totals($pdo, string $idType): array
    {
        $q = $pdo->prepare(
            'SELECT record_id, SUM(view_count) AS views
               FROM page_views
              WHERE tenant_id = ? AND id_type = ?
              GROUP BY record_id'
        );
        $q->execute([Tenant::id(), $idType]);

        $out = [];
        foreach ($q->fetchAll() as $r) {
            $out[(int)$r['record_id']] = (int)$r['views'];
        }
        return $out;
    }

    /** Add `views` (int; 0 when never viewed) to each row, matched on its `id`. */
    public static function attach($pdo, string $idType, array $rows): array
    {
        if (!$rows) return $rows;
        $totals = self::totals($pdo, $idType);
        foreach ($rows as &$r) {
            $r['views'] = $totals[(int)($r['id'] ?? 0)] ?? 0;
        }
        unset($r);
        return $rows;
    }
}
