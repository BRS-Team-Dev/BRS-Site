<?php
declare(strict_types=1);

error_reporting(E_ALL);
ini_set('display_errors', '0');           // never leak to clients
ini_set('log_errors', '1');
// Fatals (memory, redeclare, etc.) bypass index.php's JSON catch and come
// out as an empty 500. Hostinger's default error_log is a relative path
// that nothing ever writes, so point it at storage/, which post-pull keeps
// writable and rsync preserves across deploys. Read with:
//   tail -50 cc/storage/php-errors.log
$__logDir = dirname(__DIR__) . '/storage';
if (!is_dir($__logDir)) @mkdir($__logDir, 0775, true);
if (is_dir($__logDir)) ini_set('error_log', $__logDir . '/php-errors.log');
unset($__logDir);

date_default_timezone_set('UTC');

// Simple PSR-4-ish autoload for our lib/ classes
spl_autoload_register(function (string $class): void {
    if (strpos($class, 'BRS\\') !== 0) return;
    $rel = str_replace('\\', '/', substr($class, 4)) . '.php';
    $path = __DIR__ . '/lib/' . $rel;
    if (is_file($path)) require $path;
});

// Composer autoloader (PHPMailer)
if (is_file(__DIR__ . '/vendor/autoload.php')) {
    require __DIR__ . '/vendor/autoload.php';
}

$GLOBALS['BRS_CONFIG'] = require __DIR__ . '/config.php';
