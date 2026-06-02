<?php
declare(strict_types=1);

error_reporting(E_ALL);
ini_set('display_errors', '0');           // never leak to clients
ini_set('log_errors', '1');

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
