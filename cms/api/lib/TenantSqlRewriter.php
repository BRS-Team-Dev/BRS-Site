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
        $info = self::detectMainTable($sql, $op);
        if ($info === null || in_array(strtolower($info['table']), self::GLOBAL_TABLES, true)) {
            return ['sql' => $sql, 'inject_at' => self::NO_INJECTION];
        }

        // Double-scope guard — if the SQL already mentions tenant_id
        // anywhere (e.g. an already-migrated route or an explicit
        // super-admin cross-tenant read), pass through.
        if (preg_match('/\btenant_id\b/i', $sql)) {
            return ['sql' => $sql, 'inject_at' => self::NO_INJECTION];
        }

        // The column-qualifier MySQL accepts must use the alias when
        // one is present (otherwise SELECT with a `FROM leads l` aliased
        // FROM clause errors with "Unknown column leads.tenant_id").
        // Backticks are safe even for plain identifiers.
        $qualifier = $info['alias'] !== '' ? $info['alias'] : $info['table'];

        return match ($op) {
            'SELECT', 'UPDATE', 'DELETE' => self::scopeWhere($sql, $qualifier),
            'INSERT', 'REPLACE'          => self::scopeInsert($sql, $info['table']),
            default                       => ['sql' => $sql, 'inject_at' => self::NO_INJECTION],
        };
    }

    // ──────────────────────────────────────────────────────────────────
    // Implementation
    // ──────────────────────────────────────────────────────────────────

    /** Find the operation's main table AND its alias (if any).
     *
     *  Returned shape: `['table' => 'leads', 'alias' => 'l']` — alias is
     *  empty when the table is referenced without one. The scoping
     *  clause uses the alias to qualify `tenant_id` so that aliased FROM
     *  clauses (`FROM leads l`) and JOIN aliases don't trip MySQL with
     *  "Unknown column leads.tenant_id".
     *
     *  Patterns recognised (backticks optional, AS optional):
     *    SELECT … FROM `table` `alias`?  (first FROM hit)
     *    UPDATE `table` `alias`? SET …
     *    DELETE FROM `table` `alias`? WHERE …
     *    INSERT INTO `table` (cols) …    (no alias — INSERT has no alias)
     *
     *  Returns null when the SQL doesn't match — caller treats as
     *  no-rewrite. */
    private static function detectMainTable(string $sql, string $op): ?array
    {
        // Table-and-alias regex: name (group 1), optional alias (group 2).
        $tableAlias = '`?([a-z0-9_]+)`?(?:\s+(?:as\s+)?`?([a-z][a-z0-9_]*)`?)?';

        // Find the OUTERMOST occurrence of the operation's anchor (FROM,
        // UPDATE, etc.) — preg_match would otherwise grab the first FROM
        // anywhere in the string, including inside a subquery like
        // `(SELECT … FROM form_fields ff …)` — which would lead the
        // rewriter to qualify the WHERE clause against an inner alias
        // that's not visible at the outer level.
        $outerOffset = self::findOutermostAnchor($sql, $op);
        if ($outerOffset === null) return null;
        $tail = substr($sql, $outerOffset);

        $pattern = match ($op) {
            'SELECT'          => '/^\bfrom\s+' . $tableAlias . '/i',
            'UPDATE'          => '/^\s*update\s+' . $tableAlias . '/i',
            'DELETE'          => '/^\bdelete\s+from\s+' . $tableAlias . '/i',
            'INSERT','REPLACE'=> '/^\b(?:insert|replace)\s+(?:ignore\s+)?into\s+`?([a-z0-9_]+)`?/i',
            default           => null,
        };
        if (!$pattern || !preg_match($pattern, $tail, $m)) return null;

        $alias = $m[2] ?? '';
        // Suppress aliases that are actually keywords introducing the
        // next clause — most commonly SET (for UPDATE) and WHERE/JOIN
        // (for SELECT/DELETE). The regex's optional alias group will
        // gladly eat 'set' in `UPDATE leads SET name = ?`.
        $reservedAfterTable = ['set','where','join','inner','left','right','outer','cross','order','group','having','limit','for','straight_join','use','force','ignore','on','using','natural'];
        if ($alias !== '' && in_array(strtolower($alias), $reservedAfterTable, true)) {
            $alias = '';
        }
        return [
            'table' => $m[1],
            'alias' => $alias,
        ];
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

    /** Locate the byte offset of the outermost FROM / UPDATE / DELETE
     *  FROM / INSERT INTO anchor for the given operation — i.e. the one
     *  at parenthesis depth 0. Returns null if no anchor is found.
     *
     *  Critical for SELECTs whose column list contains a subquery: a
     *  bare preg_match would grab `FROM` from inside the subquery and
     *  the rewriter would qualify the WHERE against the wrong alias. */
    private static function findOutermostAnchor(string $sql, string $op): ?int
    {
        // Anchor token(s) to look for at depth 0.
        $anchors = match ($op) {
            'SELECT'            => ['/\bfrom\b/i'],
            'UPDATE'            => ['/\bupdate\b/i'],
            'DELETE'            => ['/\bdelete\s+from\b/i'],
            'INSERT', 'REPLACE' => ['/\b(?:insert|replace)\s+(?:ignore\s+)?into\b/i'],
            default             => [],
        };
        if (!$anchors) return null;

        $depth = 0;
        $len   = strlen($sql);
        $inSingle = false;
        $inDouble = false;
        $inBacktick = false;
        for ($i = 0; $i < $len; $i++) {
            $c = $sql[$i];
            // String-literal awareness so a `(` inside a string can't
            // skew depth.
            if (!$inDouble && !$inBacktick && $c === "'") {
                if (!$inSingle) { $inSingle = true; continue; }
                // Escaped single quote inside single-quoted string?
                if ($i + 1 < $len && $sql[$i + 1] === "'") { $i++; continue; }
                $inSingle = false; continue;
            }
            if (!$inSingle && !$inBacktick && $c === '"') {
                $inDouble = !$inDouble; continue;
            }
            if (!$inSingle && !$inDouble && $c === '`') {
                $inBacktick = !$inBacktick; continue;
            }
            if ($inSingle || $inDouble || $inBacktick) continue;

            if ($c === '(') { $depth++; continue; }
            if ($c === ')') { if ($depth > 0) $depth--; continue; }

            // Only consider anchors at depth 0
            if ($depth !== 0) continue;
            foreach ($anchors as $anchorRe) {
                if (preg_match($anchorRe, $sql, $m, PREG_OFFSET_CAPTURE, $i) && $m[0][1] === $i) {
                    return $i;
                }
            }
        }
        return null;
    }
}
