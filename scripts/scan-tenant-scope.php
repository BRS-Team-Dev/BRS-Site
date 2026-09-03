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

    // Skip files that don't initiate DB access themselves.
    //   - Lib helpers receive $pdo from the caller; their type hints
    //     enforce the contract.
    //   - Files using Db::pdo() OR Db::tpdo() get inspected per-call
    //     (see below — variable-aware mode).
    $usesPdo  = preg_match('/\bDb::pdo\(\)/', $src) === 1;
    $usesTpdo = strpos($src, 'Db::tpdo()') !== false;
    if (!$usesPdo && !$usesTpdo) return;

    // Strip /* … */ block comments before scanning so SQL inside
    // docblock examples doesn't trip the parser.
    $src = preg_replace('/\/\*.*?\*\//s', '', $src);
    $lines = explode("\n", $src);

    // Build a per-variable map of how the receiver was assigned. The
    // scanner tracks the LATEST assignment seen above a call site so
    // mixed-use files work: $pdo = Db::tpdo() / $rawPdo = Db::pdo()
    // give different treatment to calls on $pdo vs $rawPdo.
    //
    // Map shape: var-name → 'tpdo' | 'pdo' | 'unknown'.
    // The unknown bucket covers $pdo coming in as a parameter (lib helpers,
    // closures with `use ($pdo)`) — caller is responsible there.
    $varScope = [];
    foreach ($lines as $line) {
        if (preg_match('/\$([A-Za-z_][A-Za-z0-9_]*)\s*=\s*Db::tpdo\(\)/', $line, $m)) {
            $varScope[$m[1]] = 'tpdo';
        } elseif (preg_match('/\$([A-Za-z_][A-Za-z0-9_]*)\s*=\s*Db::pdo\(\)/', $line, $m)) {
            $varScope[$m[1]] = 'pdo';
        }
    }
    // Files using ONLY Db::tpdo() at the top can skip the per-call walk
    // entirely — every query is auto-scoped by the wrapper.
    if (!$usesPdo) return;

    // Walk each line; when we see a $var->prepare/query/exec(...), look
    // at $var's scope marker to decide whether to inspect. tpdo-scoped
    // calls are skipped (TenantPdo handles them); pdo-scoped or
    // unknown-receiver calls get full SQL analysis.
    $callRe = '/\$([A-Za-z_][A-Za-z0-9_]*)->(prepare|query|exec)\s*\(/';

    foreach ($lines as $i => $line) {
        if (!preg_match_all($callRe, $line, $m, PREG_OFFSET_CAPTURE)) continue;

        $recvNames = $m[1];
        foreach ($m[2] as $idx => $callMatch) {
            $verb     = $callMatch[0];
            $callPos  = $callMatch[1];
            $recvName = $recvNames[$idx][0];
            // Skip when the receiver is tracked as a tenant-aware
            // wrapper — TenantPdo rewrites the SQL at runtime.
            if (($varScope[$recvName] ?? null) === 'tpdo') continue;
            // Grab everything from this position to a closing paren or
            // semicolon over the next ~30 lines (covers multi-line
            // string concatenation queries).
            $window   = implode("\n", array_slice($lines, $i, 30));
            $offset   = strpos($window, $line) === false ? 0 : $callPos;
            $sql      = extractSqlArg($window, $offset);
            if ($sql === null) continue;

            // Skip explicitly-annotated calls. Look back up to 5 lines
            // for an @global-scope marker — covers the common pattern
            // where the comment sits above the assignment ($rawPdo =
            // Db::pdo()) which sits above the prepare() call.
            $annotated = false;
            for ($k = 1; $k <= 5 && $i - $k >= 0; $k++) {
                if (strpos($lines[$i - $k], '@global-scope') !== false) {
                    $annotated = true; break;
                }
                // Stop scanning back if we cross a blank line — that
                // signals the annotation, if it were there, belonged to
                // a different block.
                if (trim($lines[$i - $k]) === '') break;
            }
            if ($annotated) continue;

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
