<?php
declare(strict_types=1);

/**
 * One-shot helper used during Phase 3 of the multi-tenant rollout.
 *
 * For every cms/api/routes/public_*.php:
 *   1. Make sure `use BRS\Tenant;` is imported
 *   2. Inject `Tenant::setForPublic();` at the top of the route closure
 *   3. Swap any remaining `Db::pdo()` to `Db::tpdo()`
 *
 * Idempotent — re-running is a no-op once the route has been bootstrapped.
 * Delete this file after the cutover is verified on prod.
 */

foreach (glob(__DIR__ . '/../api/routes/public_*.php') as $f) {
    $src = file_get_contents($f);
    if ($src === false) { fwrite(STDERR, "could not read $f\n"); continue; }
    if (strpos($src, 'Tenant::setForPublic') !== false) {
        fwrite(STDERR, "skip $f (already bootstrapped)\n");
        continue;
    }

    // 1) Ensure use BRS\Tenant; sits next to the other BRS imports.
    if (strpos($src, 'use BRS\\Tenant;') === false) {
        // Find the last `use BRS\…;` line and insert Tenant after it
        if (preg_match('/(use BRS\\\\[A-Za-z]+;)\n/', $src, $m, PREG_OFFSET_CAPTURE)) {
            // Match the LAST occurrence
            $offset = 0;
            while (preg_match('/(use BRS\\\\[A-Za-z]+;)\n/', $src, $m, PREG_OFFSET_CAPTURE, $offset)) {
                $hit = $m;
                $offset = $m[0][1] + strlen($m[0][0]);
            }
            $insertAt = $hit[0][1] + strlen($hit[0][0]);
            $src = substr($src, 0, $insertAt) . "use BRS\\Tenant;\n" . substr($src, $insertAt);
        } else {
            // No existing BRS use line — append before the first `return function`
            $src = preg_replace(
                '/(\nreturn function )/',
                "\nuse BRS\\Tenant;\n$1",
                $src,
                1
            );
        }
    }

    // 2) Inject Tenant::setForPublic() at the top of the route closure body.
    //    \r?\n matches both LF and CRLF — public_*.php files happen to
    //    have CRLF endings (sed -i tends to preserve them on Windows
    //    checkouts).
    $bootstrap = "    // Public routes have no JWT — bootstrap the tenant context.\n"
               . "    // Hardcoded to BRS (tenant 1) until per-tenant public routing\n"
               . "    // lands in Phase 5 (subdomain detection / per-tenant API key).\n"
               . "    Tenant::setForPublic();\n";
    $src = preg_replace(
        '/(return function \(string \$method, array \$segs\): void \{\r?\n)/',
        '$1' . $bootstrap,
        $src,
        1
    );

    // 3) Swap remaining Db::pdo() → Db::tpdo()
    $src = str_replace('Db::pdo()', 'Db::tpdo()', $src);

    file_put_contents($f, $src);
    fwrite(STDERR, "bootstrapped " . basename($f) . "\n");
}
