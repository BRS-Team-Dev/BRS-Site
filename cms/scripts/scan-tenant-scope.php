<?php
declare(strict_types=1);

/**
 * Static SQL analyzer — ensures every query against a tenant-scoped
 * table is scoped via WHERE tenant_id = … (for SELECT/UPDATE/DELETE) or
 * stamps tenant_id on INSERT.
 *
 * Runs in CI (cms/.github/workflows/deploy.yml). Initially emits
 * findings as warnings; once every route file is migrated (Phase 4)
 * it flips to blocking.
 *
 * Usage:
 *   php cms/scripts/scan-tenant-scope.php             # default: warnings
 *   php cms/scripts/scan-tenant-scope.php --strict    # fail on any finding
 *   php cms/scripts/scan-tenant-scope.php --paths cms/api/routes/leads.php
 *
 * Escape hatch — annotate a deliberately-global query with a comment on
 * the line ABOVE the prepare/query/exec call:
 *
 *     // @global-scope: registry lookup (tenants table is global)
 *     $stmt = $pdo->query('SELECT * FROM tenants WHERE status = "active"');
 *
 * Findings printed as GitHub Actions error annotations so CI surfaces
 * them inline on the relevant file + line in the PR view.
 */

$strict = in_array('--strict', $argv, true);

// Tables that DO NOT need tenant_id scoping. Anything else is assumed
// tenant-scoped (matches the Phase 1 migration coverage).
$GLOBAL_TABLES = [
    'schema_migrations',
    'tenants',
    'tenant_email_domains',
    'super_admins',
    'super_action_log',
    // information_schema tables (used by migrations + the scanner itself).
    'information_schema.columns',
    'information_schema.tables',
    'information_schema.statistics',
    'information_schema.key_column_usage',
];

// Resolve paths to scan — default to api routes + lib + scripts.
$paths = [];
for ($i = 1; $i < count($argv); $i++) {
    if ($argv[$i] === '--paths' && isset($argv[$i + 1])) { $paths[] = $argv[++$i]; }
}
if (!$paths) {
    $paths = [
        __DIR__ . '/../api/routes',
        __DIR__ . '/../api/lib',
    ];
}

$findings = [];

foreach ($paths as $path) {
    if (is_file($path)) { scanFile($path, $findings, $GLOBAL_TABLES); continue; }
    if (!is_dir($path)) continue;
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($path));
    foreach ($it as $f) {
        if (!$f->isFile() || $f->getExtension() !== 'php') continue;
        scanFile($f->getPathname(), $findings, $GLOBAL_TABLES);
    }
}

// Emit findings — GitHub Actions annotation format if running on CI,
// human-readable lines otherwise.
$onCi = getenv('GITHUB_ACTIONS') === 'true';
foreach ($findings as $f) {
    $rel  = relativise($f['file']);
    $kind = $strict ? 'error' : 'warning';
    if ($onCi) {
        printf("::%s file=%s,line=%d::%s\n", $kind, $rel, $f['line'], $f['msg']);
    } else {
        printf("%s:%d  %s  %s\n", $rel, $f['line'], strtoupper($kind), $f['msg']);
    }
}

$summary = sprintf(
    "scan-tenant-scope: %d %s in %d file(s)\n",
    count($findings),
    count($findings) === 1 ? 'finding' : 'findings',
    countAffectedFiles($findings)
);
fwrite(STDERR, $summary);

exit($strict && $findings ? 1 : 0);

// ──────────────────────────────────────────────────────────────────
// Implementation
// ──────────────────────────────────────────────────────────────────

function scanFile(string $file, array &$findings, array $globalTables): void
{
    $src = file_get_contents($file);
    if ($src === false) return;
    $lines = explode("\n", $src);

    // Walk each line; when we see a $pdo->prepare/query/exec(...), find
    // the SQL string argument that follows (possibly spans multiple
    // lines until matching '`)`'). Keep it simple — regex grabs the
    // first string literal after the opening paren.
    //
    // We tolerate any variable name preceding `->prepare/query/exec` —
    // the codebase consistently uses $pdo but defensive scanning helps.
    $callRe = '/\b\$?(?:[A-Za-z_][A-Za-z0-9_]*->|::)(prepare|query|exec)\s*\(/';

    foreach ($lines as $i => $line) {
        if (!preg_match_all($callRe, $line, $m, PREG_OFFSET_CAPTURE)) continue;

        foreach ($m[1] as $callMatch) {
            $verb     = $callMatch[0];
            $callPos  = $callMatch[1];
            // Grab everything from this position to a closing paren or
            // semicolon over the next ~30 lines (covers multi-line
            // string concatenation queries).
            $window   = implode("\n", array_slice($lines, $i, 30));
            $offset   = strpos($window, $line) === false ? 0 : $callPos;
            $sql      = extractSqlArg($window, $offset);
            if ($sql === null) continue;

            // Skip explicitly-annotated calls. We look at the line ABOVE
            // for the @global-scope marker.
            $aboveLine = $i > 0 ? $lines[$i - 1] : '';
            if (strpos($aboveLine, '@global-scope') !== false) continue;

            $issues = analyseSql($sql, $verb, $globalTables);
            foreach ($issues as $issue) {
                $findings[] = [
                    'file' => $file,
                    'line' => $i + 1,
                    'msg'  => $issue,
                ];
            }
        }
    }
}

/** Read the first PHP string literal inside the parens that start at
 *  $start in $src. Handles single + double quotes + the common
 *  concatenation pattern ('...' . '...'). Heredocs are skipped — those
 *  rarely appear in this codebase and skipping is safer than parsing
 *  badly. */
function extractSqlArg(string $src, int $start): ?string
{
    $len = strlen($src);
    $i   = $start;
    // Skip to first quote
    while ($i < $len && $src[$i] !== "'" && $src[$i] !== '"') {
        if ($src[$i] === ')') return null;
        $i++;
    }
    if ($i >= $len) return null;

    $out = '';
    while ($i < $len) {
        $q = $src[$i] ?? '';
        if ($q !== "'" && $q !== '"') break;

        // Walk the string
        $i++;                                       // past opening quote
        while ($i < $len) {
            if ($src[$i] === '\\' && $i + 1 < $len) { $out .= $src[$i + 1]; $i += 2; continue; }
            if ($src[$i] === $q) { $i++; break; }
            $out .= $src[$i];
            $i++;
        }

        // Detect ' . ' concatenation and slurp the next string literal
        // too. Anything else terminates the SQL arg.
        $j = $i;
        while ($j < $len && ctype_space($src[$j])) $j++;
        if ($j < $len && $src[$j] === '.') {
            $j++;
            while ($j < $len && ctype_space($src[$j])) $j++;
            if ($j < $len && ($src[$j] === "'" || $src[$j] === '"')) { $i = $j; continue; }
        }
        break;
    }
    return $out !== '' ? $out : null;
}

/** Return zero or more violation messages for a single SQL string. */
function analyseSql(string $sql, string $verb, array $globalTables): array
{
    $issues = [];
    $sqlNorm = preg_replace('/\s+/', ' ', strtolower(trim($sql)));
    if ($sqlNorm === '') return $issues;

    // Classify the operation
    if (preg_match('/^select\b/', $sqlNorm))      { $op = 'select'; }
    elseif (preg_match('/^update\b/', $sqlNorm))  { $op = 'update'; }
    elseif (preg_match('/^delete\b/', $sqlNorm))  { $op = 'delete'; }
    elseif (preg_match('/^insert\b/', $sqlNorm))  { $op = 'insert'; }
    else return $issues;

    // Extract target table(s). Naïve but works for the codebase's
    // typical "INSERT INTO `table`", "FROM `table`", "UPDATE `table`",
    // "DELETE FROM `table`" patterns.
    $tables = extractTables($sqlNorm);
    if (!$tables) return $issues;

    $allGlobal = true;
    foreach ($tables as $t) {
        if (!in_array($t, $globalTables, true)) { $allGlobal = false; break; }
    }
    if ($allGlobal) return $issues;

    // For SELECT/UPDATE/DELETE: require tenant_id mentioned in WHERE/JOIN-ON
    if ($op !== 'insert') {
        if (!preg_match('/\btenant_id\b/', $sqlNorm)) {
            $issues[] = sprintf(
                'tenant-scoped %s on %s but no tenant_id in WHERE/JOIN — add `AND tenant_id = ?` and pass Tenant::id()',
                strtoupper($op),
                implode(', ', $tables)
            );
        }
        return $issues;
    }

    // INSERT: require tenant_id in the column list. Look at the
    // parenthesised columns immediately after the table name.
    if (!preg_match('/insert\s+into\s+`?\w+`?\s*\(([^)]+)\)/i', $sql, $colsM)) {
        // No column list at all — that's its own footgun (positional
        // INSERT). Still flag.
        $issues[] = sprintf(
            'tenant-scoped INSERT on %s without an explicit column list — add tenant_id explicitly',
            implode(', ', $tables)
        );
        return $issues;
    }
    if (!preg_match('/\btenant_id\b/i', $colsM[1])) {
        $issues[] = sprintf(
            'tenant-scoped INSERT on %s missing tenant_id column — append `, tenant_id` and Tenant::id() to the values',
            implode(', ', $tables)
        );
    }
    return $issues;
}

/** Return all table identifiers referenced by a SELECT/UPDATE/DELETE/
 *  INSERT. Lower-cased, backticks stripped. */
function extractTables(string $sqlLower): array
{
    $tables = [];
    // FROM `t`, FROM t, FROM schema.t
    if (preg_match_all('/\b(?:from|join|into|update)\s+`?([a-z0-9_.]+)`?/i', $sqlLower, $m)) {
        foreach ($m[1] as $t) { $tables[] = $t; }
    }
    return array_values(array_unique($tables));
}

function relativise(string $abs): string
{
    $root = realpath(__DIR__ . '/../..') ?: '';
    if ($root && str_starts_with($abs, $root)) {
        return ltrim(substr($abs, strlen($root)), '/\\');
    }
    return $abs;
}

function countAffectedFiles(array $findings): int
{
    $seen = [];
    foreach ($findings as $f) { $seen[$f['file']] = true; }
    return count($seen);
}
