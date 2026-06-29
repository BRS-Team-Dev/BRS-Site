<?php
declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

use BRS\Json;

// CORS preflight
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    Json::send(['ok' => true]);
}

// Determine path AFTER /api/. The script's directory (auto-detected from
// SCRIPT_NAME) is the URL prefix — works for any deployment path:
//   local  /builtrightstudio/cms/api/index.php → base /builtrightstudio/cms/api
//   server /cc/api/index.php                   → base /cc/api
$uri  = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?? '/';
$base = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/api/index.php')), '/');
if ($base !== '' && strpos($uri, $base) === 0) {
    $path = trim(substr($uri, strlen($base)), '/');
} else {
    // Fallback: explicit __route override
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
        case 'tenders':
            (require __DIR__ . '/routes/tenders.php')($method, $segs);
            break;
        case 'operations':
            (require __DIR__ . '/routes/operations.php')($method, $segs);
            break;
        case 'services':
            (require __DIR__ . '/routes/services.php')($method, $segs);
            break;
        case 'contracts':
            (require __DIR__ . '/routes/contracts.php')($method, $segs);
            break;
        case 'partners':
            (require __DIR__ . '/routes/partners.php')($method, $segs);
            break;
        case 'contractors':
            (require __DIR__ . '/routes/contractors.php')($method, $segs);
            break;
        case 'affiliates':
            (require __DIR__ . '/routes/affiliates.php')($method, $segs);
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
        case 'recruitment':
            (require __DIR__ . '/routes/recruitment.php')($method, $segs);
            break;
        case 'public-hr-onboarding':
            (require __DIR__ . '/routes/public_hr_onboarding.php')($method, $segs);
            break;
        case 'public-recruitment-onboarding':
            (require __DIR__ . '/routes/public_recruitment_onboarding.php')($method, $segs);
            break;
        case 'public-recruitment-apply':
            (require __DIR__ . '/routes/public_recruitment_apply.php')($method, $segs);
            break;
        case 'public-recruitment-client':
            (require __DIR__ . '/routes/public_recruitment_client.php')($method, $segs);
            break;
        case 'public-recruitment-contact':
            (require __DIR__ . '/routes/public_recruitment_contact.php')($method, $segs);
            break;
        case 'public-survey':
            (require __DIR__ . '/routes/public_survey.php')($method, $segs);
            break;
        case 'public-tenant-signup':
            (require __DIR__ . '/routes/public_tenant_signup.php')($method, $segs);
            break;
        case 'super-admin':
            (require __DIR__ . '/routes/super_admin.php')($method, $segs);
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
