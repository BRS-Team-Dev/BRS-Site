<?php
declare(strict_types=1);

namespace BRS;

final class Json
{
    public static function send($payload, int $status = 200): void
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        // Disable HTTP caching for every API response. Without this the browser
        // caches *error* responses (notably 404 / 410, which the spec marks as
        // cacheable) and keeps serving them even after the underlying state has
        // changed — e.g. the public-survey 410 sticking after a draft → open
        // flip. `no-store` is the strongest opt-out.
        header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
        header('Pragma: no-cache');
        header('Expires: 0');
        header('Access-Control-Allow-Origin: *');
        header('Access-Control-Allow-Headers: Content-Type, Authorization');
        header('Access-Control-Allow-Methods: GET,POST,PUT,DELETE,OPTIONS');
        echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        exit;
    }

    public static function fail(string $message, int $status = 400, array $extra = []): void
    {
        self::send(array_merge(['error' => $message], $extra), $status);
    }

    /** Decode JSON body, or fall back to $_POST for multipart. */
    public static function readBody(): array
    {
        $ctype = $_SERVER['CONTENT_TYPE'] ?? '';
        if (stripos($ctype, 'application/json') !== false) {
            $raw = file_get_contents('php://input') ?: '';
            $j = json_decode($raw, true);
            return is_array($j) ? $j : [];
        }
        return $_POST;
    }
}
