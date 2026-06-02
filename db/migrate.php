<?php
declare(strict_types=1);

/**
 * BuiltRightStudio CMS — migration runner.
 *
 * Reads database credentials from the project's .env (via ../api/config.php).
 * Tracks applied migrations in a `schema_migrations` table; idempotent — only
 * runs migrations whose version has not been recorded as applied.
 *
 * Usage:
 *   php db/migrate.php             # apply pending migrations
 *   php db/migrate.php --status    # show applied vs pending
 *   php db/migrate.php --bootstrap # first-time setup: load schema.sql if DB is
 *                                  # empty, then mark every existing migration
 *                                  # file as applied (no re-run). Safe to run
 *                                  # against a populated DB — it will not load
 *                                  # schema.sql but will mark migrations applied.
 *
 * Conventions enforced:
 *  - Migration filenames: NNN_description.sql  (3+ digits, underscore, words)
 *  - The full filename (minus .sql) is the canonical "version" stored in
 *    schema_migrations — numeric prefixes are NOT unique (historical: 056_,
 *    057_, 059_ each have two files).
 *  - `USE \`...\`` and `CREATE DATABASE` statements in migrations / schema.sql
 *    are silently skipped — connection is already scoped to the env-configured
 *    DB via DSN, so they're meaningless and historically encode the wrong
 *    name (`builtrightstudio_cms`).
 *  - Each migration runs in a transaction. Mid-migration failure rolls back
 *    the partial change so the same migration can be re-attempted cleanly.
 *  - A SHA-256 checksum of the file content is recorded; subsequent runs that
 *    detect a changed checksum on an already-applied migration ABORT with an
 *    explicit error — migrations are append-only by policy.
 */

if (PHP_SAPI !== 'cli') { fwrite(STDERR, "Run from CLI only.\n"); exit(1); }

$args = array_slice($argv, 1);
$flagStatus    = in_array('--status', $args, true);
$flagBootstrap = in_array('--bootstrap', $args, true);

$config = require __DIR__ . '/../api/config.php';
$db = $config['db'];
$envName = $config['env'] ?? 'unknown';

$dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=%s',
    $db['host'], $db['port'], $db['name'], $db['charset']);

try {
    $pdo = new PDO($dsn, $db['user'], $db['password'], [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ]);
} catch (PDOException $e) {
    fwrite(STDERR, "DB connect failed [{$envName}]: " . $e->getMessage() . "\n");
    exit(2);
}

println("[migrate] env={$envName} db={$db['name']}@{$db['host']}");

// Ensure tracking table exists.
$pdo->exec("
    CREATE TABLE IF NOT EXISTS schema_migrations (
        version    VARCHAR(191) NOT NULL PRIMARY KEY,
        filename   VARCHAR(255) NOT NULL,
        checksum   CHAR(64)     NOT NULL,
        applied_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        applied_by VARCHAR(64)  NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
");

// --- Discover migration files ---
$migrationsDir = __DIR__ . '/migrations';
$files = glob($migrationsDir . '/*.sql') ?: [];
sort($files, SORT_NATURAL);

$migrations = [];
foreach ($files as $path) {
    $name = basename($path);
    if (!preg_match('/^\d{3,}_.+\.sql$/', $name)) {
        fwrite(STDERR, "Skipping non-conforming filename: {$name}\n");
        continue;
    }
    $migrations[] = [
        'version'  => substr($name, 0, -4),   // strip .sql; full name is unique
        'filename' => $name,
        'path'     => $path,
        'checksum' => hash_file('sha256', $path),
    ];
}

// --- Load applied set ---
$applied = [];
$rows = $pdo->query("SELECT version, checksum FROM schema_migrations")->fetchAll();
foreach ($rows as $r) { $applied[$r['version']] = $r['checksum']; }

// --- Integrity check: applied checksum must not have changed ---
$mutated = [];
foreach ($migrations as $m) {
    if (isset($applied[$m['version']]) && $applied[$m['version']] !== $m['checksum']) {
        $mutated[] = $m;
    }
}
if (!empty($mutated)) {
    fwrite(STDERR, "ABORT: applied migration(s) have been modified — migrations are append-only:\n");
    foreach ($mutated as $m) { fwrite(STDERR, "  - {$m['filename']}\n"); }
    fwrite(STDERR, "Revert the file or add a NEW migration to undo/extend it.\n");
    exit(3);
}

// --- --status mode ---
if ($flagStatus) {
    $pending = array_filter($migrations, fn($m) => !isset($applied[$m['version']]));
    println("Applied: " . count($applied));
    println("Pending: " . count($pending));
    foreach ($pending as $m) { println("  - {$m['filename']}"); }
    exit(0);
}

// --- --bootstrap mode ---
if ($flagBootstrap) {
    $tableCount = (int) $pdo->query("SELECT COUNT(*) c FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name <> 'schema_migrations'")->fetch()['c'];

    if ($tableCount === 0) {
        println("[bootstrap] DB is empty — loading schema.sql ...");
        $schemaPath = __DIR__ . '/schema.sql';
        if (!is_file($schemaPath)) { fwrite(STDERR, "Missing {$schemaPath}\n"); exit(4); }
        $schemaSql = file_get_contents($schemaPath);
        runStatements($pdo, $schemaSql, $db['name']);
        println("[bootstrap] schema.sql loaded.");
    } else {
        println("[bootstrap] DB already has {$tableCount} tables — skipping schema.sql load.");
    }

    $marked = 0;
    $stmt = $pdo->prepare("INSERT IGNORE INTO schema_migrations (version, filename, checksum, applied_by) VALUES (?, ?, ?, ?)");
    foreach ($migrations as $m) {
        if (isset($applied[$m['version']])) continue;
        $stmt->execute([$m['version'], $m['filename'], $m['checksum'], 'bootstrap']);
        $marked++;
    }
    println("[bootstrap] Marked {$marked} migration(s) as applied without running.");
    exit(0);
}

// --- Normal apply mode ---
$pending = array_values(array_filter($migrations, fn($m) => !isset($applied[$m['version']])));
if (empty($pending)) { println("Nothing to apply. (applied=" . count($applied) . ")"); exit(0); }

println("Applying " . count($pending) . " migration(s)...");

$insert = $pdo->prepare("INSERT INTO schema_migrations (version, filename, checksum, applied_by) VALUES (?, ?, ?, ?)");
$appliedBy = (getenv('CI') === 'true') ? 'ci' : 'manual';

foreach ($pending as $m) {
    println("→ {$m['filename']}");
    $sql = file_get_contents($m['path']);
    $pdo->beginTransaction();
    try {
        runStatements($pdo, $sql, $db['name']);
        $insert->execute([$m['version'], $m['filename'], $m['checksum'], $appliedBy]);
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        fwrite(STDERR, "FAILED {$m['filename']}: " . $e->getMessage() . "\n");
        exit(5);
    }
}

println("Done. (now applied=" . (count($applied) + count($pending)) . ")");
exit(0);

// ----------------------------------------------------------------------

function runStatements(PDO $pdo, string $sql, string $expectedDb): void {
    // Strip regular block comments and line comments. PRESERVE /*! ... */ — those
    // are MySQL conditional-execute comments (e.g. `/*!40014 SET FOREIGN_KEY_CHECKS=0 */;`)
    // that the dump uses to bracket the schema load. Stripping them breaks FK ordering.
    $sql = preg_replace('#/\*(?!!).*?\*/#s', '', $sql);
    $sql = preg_replace('/^--.*$/m', '', $sql);

    // Split on `;` at end of line. Naive but adequate for our schema (no stored
    // procs with embedded semicolons; if we ever add one, use DELIMITER blocks
    // and parse those explicitly).
    $statements = array_filter(array_map('trim', preg_split('/;\s*[\r\n]+/', $sql)), fn($s) => $s !== '' && $s !== ';');

    foreach ($statements as $stmt) {
        // Skip USE — connection is already DB-scoped via DSN, and historical
        // migrations all hardcode `USE builtrightstudio_cms` which won't match
        // our env-specific DB names.
        if (preg_match('/^\s*USE\s+`?[A-Za-z0-9_]+`?\s*$/i', $stmt)) continue;
        // Skip CREATE DATABASE — handled out-of-band by hosting panel.
        if (preg_match('/^\s*CREATE\s+DATABASE/i', $stmt)) continue;

        $pdo->exec($stmt);
    }
}

function println(string $msg): void { fwrite(STDOUT, $msg . PHP_EOL); }
