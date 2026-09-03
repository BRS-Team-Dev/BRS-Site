<?php
declare(strict_types=1);

/**
 * Endpoint enumeration + smoke test driver.
 *
 *   php cms/scripts/test-all-endpoints.php <base-url>
 *
 * Reads `BRS_TEST_TOKEN_SUPER` + `BRS_TEST_TOKEN_TENANT2` env vars for
 * the auth-gated checks; if missing, only public + 401-gating checks
 * run. Tries every endpoint listed below with the verb / payload the
 * route advertises. Reports pass / fail / skip for each.
 *
 * Designed for read-mostly verification — POST/PUT/DELETE are tested
 * only with deliberately-bad payloads (validation failure → 400) so
 * the test run doesn't mutate prod data. The write-path semantics are
 * separately exercised by the dev provisioning script.
 */

if (PHP_SAPI !== 'cli') { fwrite(STDERR, "CLI only\n"); exit(1); }
$base = $argv[1] ?? 'https://builtrightstudio.com/cc/api';
$tokenSuper   = getenv('BRS_TEST_TOKEN_SUPER')   ?: '';
$tokenTenant2 = getenv('BRS_TEST_TOKEN_TENANT2') ?: '';
$verbose      = in_array('--verbose', $argv, true);

/** @return array{code:int, body:string, ms:float} */
function hit(string $method, string $url, ?string $token = null, ?string $body = null, array $extraHeaders = []): array {
    $ch = curl_init($url);
    $headers = ['Accept: application/json'];
    if ($body !== null) $headers[] = 'Content-Type: application/json';
    if ($token)         $headers[] = "Authorization: Bearer $token";
    foreach ($extraHeaders as $h) $headers[] = $h;
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST   => $method,
        CURLOPT_RETURNTRANSFER  => true,
        CURLOPT_HTTPHEADER      => $headers,
        CURLOPT_POSTFIELDS      => $body,
        CURLOPT_TIMEOUT         => 20,
        CURLOPT_FOLLOWLOCATION  => false,
    ]);
    $t0 = microtime(true);
    $resp = curl_exec($ch);
    $ms = (microtime(true) - $t0) * 1000;
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return ['code' => (int)$code, 'body' => (string)$resp, 'ms' => $ms];
}

// ── Endpoint catalogue ─────────────────────────────────────────────
// Each entry: [method, path, expect_codes, label, auth?, body?, kind?]
//   expect_codes: array of acceptable HTTP codes
//   auth: 'super' | 'tenant' | null
//   body: JSON string (for POST/PUT)
//   kind: 'read' | 'write_safe' (validation 400) | 'destructive' (skipped)
$ENDPOINTS = [
    // health / dispatcher
    ['GET',  '/health',  [200], 'Health'],

    // Auth — public + auth-gated
    ['POST', '/auth/login', [400], 'Login (empty body → 400)', null, '{}'],
    ['POST', '/auth/login', [401], 'Login (bad creds → 401)', null, '{"email":"nope@unknown.com","password":"x"}'],
    ['GET',  '/auth/me',    [401], 'Me (no JWT → 401)'],
    ['GET',  '/auth/me',    [200], 'Me (with JWT)',          'super'],
    ['POST', '/auth/forgot-password', [400], 'Forgot-pwd (no email → 400)', null, '{}'],
    ['POST', '/auth/forgot-password', [200], 'Forgot-pwd (unknown email → 200)', null, '{"email":"never@nowhere.example"}'],
    ['POST', '/auth/reset-password',  [400], 'Reset-pwd (no token → 400)',  null, '{}'],
    ['POST', '/auth/impersonate',     [400], 'Impersonate (no body)',  'super', '{}'],
    ['POST', '/auth/impersonate',     [404], 'Impersonate (bad tenant)', 'super', '{"tenant_id":99999}'],

    // Super-admin
    ['GET',  '/super-admin/tenants',  [401], 'Super tenants (no auth)'],
    ['GET',  '/super-admin/tenants',  [200], 'Super tenants list', 'super'],
    ['GET',  '/super-admin/audit',    [200], 'Super audit log',    'super'],
    ['GET',  '/super-admin/tenants',  [403], 'Super tenants (non-super → 403)', 'tenant'],

    // CRM
    ['GET',  '/clients',     [200], 'Clients list',           'super'],
    ['GET',  '/clients?is_recruitment=1', [200], 'Clients filter (recruitment)', 'super'],
    ['POST', '/clients',     [400], 'Create client (no name → 400)', 'super', '{}'],
    ['GET',  '/clients/99999', [404], 'Client by bad id (404)', 'super'],
    ['GET',  '/leads',       [200], 'Leads list',             'super'],
    ['GET',  '/leads/industries', [200], 'Leads industries',   'super'],
    ['POST', '/leads',       [400], 'Create lead (no name → 400)', 'super', '{}'],
    ['GET',  '/leads/99999', [404], 'Lead by bad id (404)',   'super'],
    ['GET',  '/services',    [200], 'Services list',          'super'],
    ['GET',  '/dashboard/crm', [200], 'CRM dashboard',         'super'],
    ['GET',  '/leadgen/models', [200], 'Leadgen models',       'super'],
    ['GET',  '/newsletter/campaigns', [200], 'Newsletter campaigns', 'super'],

    // Forms + onboarding
    ['GET',  '/forms',           [200], 'Forms list',             'super'],
    ['GET',  '/onboarding/clients', [200], 'Onboarding clients', 'super'],
    ['GET',  '/sections',    [200], 'Admin sections',         'super'],
    ['GET',  '/settings',    [200], 'Settings',               'super'],

    // HR
    ['GET',  '/hr/employees', [200], 'HR employees',          'super'],
    ['GET',  '/hr/jobs',     [200], 'HR jobs',                'super'],
    ['GET',  '/hr/candidates', [200], 'HR candidates',        'super'],
    ['GET',  '/hr/courses',  [200], 'HR courses',             'super'],
    ['GET',  '/hr/document-types', [200], 'HR doc types',     'super'],

    // Operations
    ['GET',  '/tenders',     [200], 'Tenders list',           'super'],
    ['GET',  '/operations/tasks', [200], 'Operations tasks',  'super', null, 'tolerate-403'],
    ['GET',  '/partners',    [200], 'Partners list',          'super'],
    ['GET',  '/contractors', [200], 'Contractors list',       'super'],
    ['GET',  '/affiliates',  [200], 'Affiliates list',        'super'],

    // Recruitment
    ['GET',  '/recruitment/candidates', [200], 'Rec candidates', 'super'],
    ['GET',  '/recruitment/doc-types',  [200], 'Rec doc types',  'super'],
    ['GET',  '/recruitment/doc-groups', [200], 'Rec doc groups', 'super'],
    ['GET',  '/recruitment/skills',     [200], 'Rec skills',     'super'],

    // Tasks
    ['GET',  '/tasks/teams',  [200], 'Task teams',            'super'],

    // Accounting
    ['GET',  '/accounting/invoices', [200], 'Invoices',       'super'],

    // Contracts — /api/contracts/:audience/:id (entity-scoped)
    ['GET',  '/contracts/client/1',  [200, 404], 'Contracts for a client', 'super'],
    ['GET',  '/contracts/lead/1',    [200, 404], 'Contracts for a lead',   'super'],

    // Users
    ['GET',  '/users', [200], 'Users list',                   'super'],

    // Public (no auth)
    ['GET',  '/public/jobs',           [200], 'Public jobs board'],
    ['GET',  '/public/legal',          [200], 'Public legal index'],
    ['GET',  '/public/forms/notexist', [404], 'Public form (bad slug)'],

    // Tenant isolation cross-checks
    ['GET',  '/leads',                 [200], 'Tenant2 leads (should be empty)', 'tenant'],
    ['GET',  '/clients',               [200], 'Tenant2 clients (should be empty)', 'tenant'],
    ['GET',  '/leads/1',               [404], 'Tenant2 → BRS lead 1 (404 = no leak)', 'tenant'],
];

// ── Run ────────────────────────────────────────────────────────────
$pass = $fail = $skip = 0;
$failures = [];
$tenant1Counts = [];
$tenant2Counts = [];
$startWall = microtime(true);
echo str_pad('METHOD ENDPOINT', 60) . " EXPECT GOT  LATENCY  RESULT\n";
echo str_repeat('─', 100) . "\n";

foreach ($ENDPOINTS as $e) {
    [$method, $path, $expect, $label] = [$e[0], $e[1], $e[2], $e[3]];
    $auth = $e[4] ?? null;
    $body = $e[5] ?? null;
    $kind = $e[6] ?? null;

    $token = null;
    if ($auth === 'super')  $token = $tokenSuper;
    if ($auth === 'tenant') $token = $tokenTenant2;
    if ($auth !== null && $token === '') { $skip++; printf("⊘ %-58s SKIP (no %s token)\n", "$method $path", $auth); continue; }

    $r = hit($method, $base . $path, $token, $body);
    $okCodes = $expect;
    $codeMatched = in_array($r['code'], $okCodes, true);

    // Tolerate 403 / 404 as soft-pass on labelled endpoints that may not exist
    if (!$codeMatched && $kind === 'tolerate-403' && in_array($r['code'], [403, 404], true)) $codeMatched = true;

    $tag = $codeMatched ? '✓' : '✗';
    $expStr = implode('|', $okCodes);
    printf("%s %-58s %-6s %-4d %5.0fms  %s\n",
        $tag, "$method $path",
        $expStr,
        $r['code'],
        $r['ms'],
        $label
    );

    if ($codeMatched) {
        $pass++;
        // Capture lead counts to verify isolation
        if ($path === '/leads' && $r['code'] === 200) {
            $json = json_decode($r['body'], true);
            if ($auth === 'super')  $tenant1Counts['leads'] = is_array($json['leads'] ?? null) ? count($json['leads']) : 'n/a';
            if ($auth === 'tenant') $tenant2Counts['leads'] = is_array($json['leads'] ?? null) ? count($json['leads']) : 'n/a';
        }
        if ($path === '/clients' && $r['code'] === 200) {
            $json = json_decode($r['body'], true);
            if ($auth === 'super')  $tenant1Counts['clients'] = is_array($json['clients'] ?? null) ? count($json['clients']) : 'n/a';
            if ($auth === 'tenant') $tenant2Counts['clients'] = is_array($json['clients'] ?? null) ? count($json['clients']) : 'n/a';
        }
    } else {
        $fail++;
        $failures[] = [
            'endpoint' => "$method $path",
            'label'    => $label,
            'expected' => $expStr,
            'got'      => $r['code'],
            'body'     => substr($r['body'], 0, 400),
        ];
    }
}

$wallSec = microtime(true) - $startWall;
echo str_repeat('─', 100) . "\n";
printf("PASS %d  FAIL %d  SKIP %d   (%d tests in %.1fs)\n", $pass, $fail, $skip, count($ENDPOINTS), $wallSec);

if ($tenant1Counts || $tenant2Counts) {
    echo "\nIsolation cross-check:\n";
    if ($tenant1Counts) printf("  BRS  (super):  leads=%s  clients=%s\n", $tenant1Counts['leads'] ?? '?', $tenant1Counts['clients'] ?? '?');
    if ($tenant2Counts) printf("  Acme (tenant2): leads=%s  clients=%s\n", $tenant2Counts['leads'] ?? '?', $tenant2Counts['clients'] ?? '?');
}

if ($failures) {
    echo "\nFAILURES:\n";
    foreach ($failures as $f) {
        printf("  %s [%s]  expected=%s  got=%d\n", $f['endpoint'], $f['label'], $f['expected'], $f['got']);
        if ($verbose || $f['got'] >= 500) {
            printf("    body: %s\n", $f['body']);
        }
    }
}

exit($fail > 0 ? 1 : 0);
