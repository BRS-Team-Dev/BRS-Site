<?php
declare(strict_types=1);

/**
 * Returns the runtime config array. Reads from a .env file at the project root.
 *
 * .env precedence:
 *   1. BRS_ENV_FILE env var (used by CI / migrate.php for explicit override)
 *   2. <project-root>/.env
 *
 * No fallbacks — a missing .env is a hard error. This forces every environment
 * (local, dev, prod) to be configured explicitly and prevents the historical
 * "committed dev secrets into prod" footgun.
 */

$envFile = getenv('BRS_ENV_FILE') ?: (dirname(__DIR__) . '/.env');

if (!is_file($envFile) || !is_readable($envFile)) {
    $msg = "Config error: .env not found or unreadable at {$envFile}";
    if (PHP_SAPI === 'cli') { fwrite(STDERR, $msg . PHP_EOL); }
    else { http_response_code(500); header('Content-Type: application/json'); echo json_encode(['error' => 'server misconfigured']); }
    exit(1);
}

$env = [];
foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
    $line = trim($line);
    if ($line === '' || $line[0] === '#') continue;
    $eq = strpos($line, '=');
    if ($eq === false) continue;
    $key = trim(substr($line, 0, $eq));
    $val = trim(substr($line, $eq + 1));
    // Strip surrounding matching quotes if present
    if (strlen($val) >= 2 && (($val[0] === '"' && substr($val, -1) === '"') || ($val[0] === "'" && substr($val, -1) === "'"))) {
        $val = substr($val, 1, -1);
    }
    $env[$key] = $val;
}

return [
    'env'         => $env['BRS_ENV'] ?? 'local',
    'db' => [
        'host'     => $env['DB_HOST'] ?? '127.0.0.1',
        'port'     => (int)($env['DB_PORT'] ?? 3306),
        'name'     => $env['DB_NAME'] ?? '',
        'user'     => $env['DB_USER'] ?? '',
        'password' => $env['DB_PASS'] ?? '',
        'charset'  => 'utf8mb4',
    ],
    'jwt_secret'  => $env['JWT_SECRET'] ?? '',
    'jwt_ttl'     => (int)($env['JWT_TTL'] ?? 28800),
    'base_url'    => rtrim($env['BASE_URL'] ?? '', '/'),
    'storage_dir' => __DIR__ . '/../storage',
    'upload_max_mb_default' => (int)($env['UPLOAD_MAX_MB'] ?? 10),
];
