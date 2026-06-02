<?php
declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

use BRS\Json;

// CORS preflight
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    Json::send(['ok' => true]);
}

// Determine path AFTER /api/
$uri  = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?? '/';
$base = '/builtrightstudio/api';
if (strpos($uri, $base) === 0) {
    $path = trim(substr($uri, strlen($base)), '/');
} else {
    // Fallback: if rewrites set PATH_INFO or QUERY_STRING route, use those
    $path = trim((string)($_GET['__route'] ?? ''), '/');
}

$segs   = $path === '' ? [] : explode('/', $path);
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$first  = $segs[0] ?? '';

try {
    switch ($first) {
        case 'auth':
            (require __DIR__ . '/routes/auth.php')($method, $segs);
            break;
        case 'forms':
            // /api/forms              → forms.php
            // /api/forms/:id          → forms.php
            // /api/forms/:id/submissions[/...] → submissions.php
            if (($segs[2] ?? '') === 'submissions') {
                (require __DIR__ . '/routes/submissions.php')($method, $segs);
            } else {
                (require __DIR__ . '/routes/forms.php')($method, $segs);
            }
            break;
        case 'settings':
            (require __DIR__ . '/routes/settings.php')($method, $segs);
            break;
        case 'onboarding':
            (require __DIR__ . '/routes/onboarding.php')($method, $segs);
            break;
        case 'sections':
            (require __DIR__ . '/routes/sections.php')($method, $segs);
            break;
        case 'clients':
            (require __DIR__ . '/routes/clients.php')($method, $segs);
            break;
        case 'leads':
            (require __DIR__ . '/routes/leads.php')($method, $segs);
            break;
        case 'leadgen':
            (require __DIR__ . '/routes/leadgen.php')($method, $segs);
            break;
        case 'newsletter':
            (require __DIR__ . '/routes/newsletter.php')($method, $segs);
            break;
        case 'dashboard':
            (require __DIR__ . '/routes/dashboard.php')($method, $segs);
            break;
        case 'tasks':
            (require __DIR__ . '/routes/tasks.php')($method, $segs);
            break;
        case 'hr':
            (require __DIR__ . '/routes/hr.php')($method, $segs);
            break;
        case 'accounting':
            (require __DIR__ . '/routes/accounting.php')($method, $segs);
            break;
        case 'public-hr-onboarding':
            (require __DIR__ . '/routes/public_hr_onboarding.php')($method, $segs);
            break;
        case 'public-survey':
            (require __DIR__ . '/routes/public_survey.php')($method, $segs);
            break;
        case 'users':
            (require __DIR__ . '/routes/users.php')($method, $segs);
            break;
        case 'public':
            (require __DIR__ . '/routes/public.php')($method, $segs);
            break;
        case '':
        case 'health':
            Json::send(['ok' => true, 'service' => 'builtrightstudio-cms']);
        default:
            Json::fail('Not found', 404);
    }
} catch (\Throwable $e) {
    error_log('[API] ' . $e->getMessage() . "\n" . $e->getTraceAsString());
    Json::fail('Server error: ' . $e->getMessage(), 500);
}
