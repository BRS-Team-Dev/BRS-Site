<?php
declare(strict_types=1);

namespace BRS;

/**
 * SQL rewriter for the {@see TenantPdo} runtime auto-scope wrapper.
 *
 * Takes the SQL given to $pdo->prepare(), detects whether the target
 * table is tenant-scoped, and (if so) injects `AND tenant_id = ?` into
 * the WHERE clause (for SELECT/UPDATE/DELETE) or `, tenant_id` /
 * `, ?` into the column list + VALUES (for INSERT).
 *
 * Returns the rewritten SQL plus the positional index at which
 * `Tenant::id()` needs to be spliced into the execute() params array.
 * That index is computed as "number of ? placeholders before my
 * injected ?" — works correctly for any SQL whose placeholders sit
 * entirely in WHERE conditions and INSERT VALUES (true for this
 * codebase; the rare placeholder in HAVING / LIMIT would still work
 * because we insert BEFORE those clauses).
 *
 * Queries against global tables (schema_migrations, tenants,
 * tenant_email_domains, super_admins, super_action_log) pass through
 * untouched. Queries that already reference `tenant_id` (already-
 * scoped, or super-admin cross-tenant reads) also pass through —
 * preventing accidental double-scoping.
 */
final class TenantSqlRewriter
{
    /** Tables that the rewriter MUST NOT scope. Matches the static
     *  scanner's list — the two definitions should always agree. */
    private const GLOBAL_TABLES = [
        'schema_migrations',
        'tenants',
        'tenant_email_domains',
        'super_admins',
        'super_action_log',
    ];

    /** Sentinel used by callers to flag that no injection is needed. */
    public const NO_INJECTION = -1;

    /** Rewrite a prepared SQL string for tenant scoping.
     *
     *  @return array{sql:string, inject_at:int}
     *          inject_at = NO_INJECTION (-1) means caller passes params
     *          through unchanged. Otherwise splice Tenant::id() into
     *          the params array at that position.
     */
    public static function rewrite(string $sql): array
    {
        $trimmed = ltrim($sql);
        if ($trimmed === '') return ['sql' => $sql, 'inject_at' => self::NO_INJECTION];

        // Detect operation
        if (!preg_match('/^\s*(SELECT|UPDATE|DELETE|INSERT|REPLACE)\b/i', $trimmed, $m)) {
            return ['sql' => $sql, 'inject_at' => self::NO_INJECTION];
        }
        $op = strtoupper($m[1]);

        // Detect the main (driving) table for the operation.
        $table = self::detectMainTable($sql, $op);
        if ($table === null || in_array(strtolower($table), self::GLOBAL_TABLES, true)) {
            return ['sql' => $sql, 'inject_at' => self::NO_INJECTION];
        }

        // Double-scope guard — if the SQL already mentions tenant_id
        // anywhere (e.g. an already-migrated route or an explicit
        // super-admin cross-tenant read), pass through.
        if (preg_match('/\btenant_id\b/i', $sql)) {
            return ['sql' => $sql, 'inject_at' => self::NO_INJECTION];
        }

        return match ($op) {
            'SELECT', 'UPDATE', 'DELETE' => self::scopeWhere($sql, $table),
            'INSERT', 'REPLACE'          => self::scopeInsert($sql, $table),
            default                       => ['sql' => $sql, 'inject_at' => self::NO_INJECTION],
        };
    }

    // ──────────────────────────────────────────────────────────────────
    // Implementation
    // ──────────────────────────────────────────────────────────────────

    /** Find the operation's main table. Naïve regex sufficient for the
     *  codebase's patterns:
     *    SELECT … FROM `table`             (first FROM hit)
     *    UPDATE `table` SET …
     *    DELETE FROM `table` WHERE …
     *    INSERT INTO `table` (cols) …
     *
     *  Backticks optional, schema-qualified names rejected (we never
     *  query cross-database). Returns null on no match — caller treats
     *  as a no-rewrite case. */
    private static function detectMainTable(string $sql, string $op): ?string
    {
        $pattern = match ($op) {
            'SELECT'          => '/\bfrom\s+`?([a-z0-9_]+)`?/i',
            'UPDATE'          => '/^\s*update\s+`?([a-z0-9_]+)`?/i',
            'DELETE'          => '/\bdelete\s+from\s+`?([a-z0-9_]+)`?/i',
            'INSERT','REPLACE'=> '/\b(?:insert|replace)\s+(?:ignore\s+)?into\s+`?([a-z0-9_]+)`?/i',
            default           => null,
        };
        if (!$pattern || !preg_match($pattern, $sql, $m)) return null;
        return $m[1];
    }

    /** For SELECT/UPDATE/DELETE: locate the WHERE clause (or the position
     *  to add one) and append `AND <table>.tenant_id = ?`. */
    private static function scopeWhere(string $sql, string $table): array
    {
        // Find boundary keywords that mark the END of the WHERE clause —
        // GROUP BY / HAVING / ORDER BY / LIMIT / OFFSET / FOR UPDATE /
        // INTO OUTFILE. The injection point sits just before whichever
        // appears first; if none appears, it's at end-of-string.
        $endRe = '/\b(group\s+by|having|order\s+by|limit\s+|offset\s+|for\s+update|for\s+share|into\s+outfile)\b/i';
        $endPos = strlen($sql);
        if (preg_match($endRe, $sql, $m, PREG_OFFSET_CAPTURE)) {
            $endPos = $m[0][1];
        }

        // Does a WHERE clause exist already?
        $hasWhere = preg_match('/\bwhere\b/i', substr($sql, 0, $endPos));

        $tenantClause = $hasWhere
            ? " AND `{$table}`.`tenant_id` = ?"
            : " WHERE `{$table}`.`tenant_id` = ?";

        // Count existing ? placeholders BEFORE the injection point — that
        // tells the statement wrapper where to splice Tenant::id() in
        // the params array.
        $injectAt = self::countPlaceholders(substr($sql, 0, $endPos));

        // Compose the new SQL: head + clause + tail
        $head = rtrim(substr($sql, 0, $endPos));
        $tail = substr($sql, $endPos);
        if ($tail !== '' && !str_starts_with($tail, ' ')) $tail = ' ' . ltrim($tail);

        return [
            'sql'       => $head . $tenantClause . $tail,
            'inject_at' => $injectAt,
        ];
    }

    /** For INSERT / REPLACE: find the column list + matching VALUES list,
     *  append `, tenant_id` / `, ?` respectively. The Tenant::id() goes
     *  at the END of the execute() params array. */
    private static function scopeInsert(string $sql, string $table): array
    {
        // Locate the column list `(col1, col2, ...)` after INTO <table>
        if (!preg_match('/(\binsert|\breplace)\s+(?:ignore\s+)?into\s+`?[a-z0-9_]+`?\s*\(([^)]*)\)/i', $sql, $colsM, PREG_OFFSET_CAPTURE)) {
            // No explicit column list — positional INSERT. Skip; scanner
            // flags these as suspicious so they'll get hand-fixed.
            return ['sql' => $sql, 'inject_at' => self::NO_INJECTION];
        }

        $colsListStart = $colsM[2][1];
        $colsListEnd   = $colsListStart + strlen($colsM[2][0]) - 1;
        $colCloseParen = $colsListEnd + 1;   // index of the ')' after the cols

        // The trailing `)` we want to replace with `, `tenant_id`)`
        // Compute SQL after column injection
        $beforeCloseCols = substr($sql, 0, $colCloseParen);
        $afterCloseCols  = substr($sql, $colCloseParen);
        $sqlWithCol = rtrim($beforeCloseCols) . ', `tenant_id`' . $afterCloseCols;

        // Now find the matching VALUES (…) clause. We do simple
        // matching: the FIRST VALUES (…) after the column list.
        if (!preg_match('/\bvalues\s*\((.*?)\)/is', $sqlWithCol, $valsM, PREG_OFFSET_CAPTURE)) {
            return ['sql' => $sql, 'inject_at' => self::NO_INJECTION];
        }
        $valsListStart = $valsM[1][1];
        $valsListEnd   = $valsListStart + strlen($valsM[1][0]) - 1;
        $valsCloseParen = $valsListEnd + 1;

        $beforeCloseVals = substr($sqlWithCol, 0, $valsCloseParen);
        $afterCloseVals  = substr($sqlWithCol, $valsCloseParen);
        $finalSql = rtrim($beforeCloseVals) . ', ?' . $afterCloseVals;

        // Tenant::id() goes at the END of the execute() params array
        // because the new `?` is the LAST placeholder in the SQL.
        return [
            'sql'       => $finalSql,
            'inject_at' => self::countPlaceholders($finalSql) - 1,
        ];
    }

    /** Count unbacktracked `?` placeholders. Assumes (true for this
     *  codebase) that no SQL string literal contains a literal '?'. */
    private static function countPlaceholders(string $sql): int
    {
        // Strip backtick-quoted identifiers (no ? possible inside) — safe
        // shortcut. Single-quoted string literals could theoretically
        // contain a '?' but they don't in this codebase.
        return substr_count($sql, '?');
    }
}
