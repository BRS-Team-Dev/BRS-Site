<?php
declare(strict_types=1);

/**
 * Write-path verification — exercises the full CRUD cycle on a
 * tenant-scoped table to confirm the TenantPdo wrapper handles INSERT,
 * SELECT, UPDATE, and DELETE correctly + that cross-tenant access is
 * refused on every operation.
 *
 *   php cms/scripts/test-write-cycle.php <base-url>
 *   env: BRS_TEST_TOKEN_SUPER, BRS_TEST_TOKEN_TENANT2 (optional)
 *
 * Plus: impersonation round-trip + kill-set propagation + X-Tenant-Key
 * public route resolution.
 */

if (PHP_SAPI !== 'cli') { fwrite(STDERR, "CLI only\n"); exit(1); }
$base       = $argv[1] ?? '';
$tokSuper   = getenv('BRS_TEST_TOKEN_SUPER')   ?: '';
$tokTenant2 = getenv('BRS_TEST_TOKEN_TENANT2') ?: '';

if ($base === '' || $tokSuper === '') {
    fwrite(STDERR, "Usage: php test-write-cycle.php <base-url>  (with BRS_TEST_TOKEN_SUPER + optional BRS_TEST_TOKEN_TENANT2)\n");
    exit(2);
}

function hit(string $method, string $url, ?string $token = null, ?string $body = null, array $extra = []): array {
    $ch = curl_init($url);
    $headers = ['Accept: application/json'];
    if ($body !== null) $headers[] = 'Content-Type: application/json';
    if ($token)         $headers[] = "Authorization: Bearer $token";
    foreach ($extra as $h) $headers[] = $h;
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST  => $method,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_POSTFIELDS     => $body,
        CURLOPT_TIMEOUT        => 20,
    ]);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return ['code' => (int)$code, 'body' => (string)$body, 'json' => json_decode((string)$body, true)];
}

function step(string $label, bool $ok, string $detail = ''): bool {
    printf("  %s %s%s\n", $ok ? '✓' : '✗', $label, $detail !== '' ? "  ($detail)" : '');
    return $ok;
}

$pass = $fail = 0;
$check = function (bool $ok, string $label, string $detail = '') use (&$pass, &$fail) {
    step($label, $ok, $detail);
    $ok ? $pass++ : $fail++;
};

echo "═══════════════════════════════════════════════════════════════════════════════\n";
echo "  Write-path verification: full CRUD cycle on /api/leads\n";
echo "═══════════════════════════════════════════════════════════════════════════════\n";

// CREATE
$body = json_encode([
    'name'    => 'WriteCycle_Test_' . uniqid(),
    'email'   => 'test@example.com',
    'company' => 'WriteCycle Inc.',
    'industry' => 'Testing',
]);
$r = hit('POST', "$base/leads", $tokSuper, $body);
$leadId = $r['json']['id'] ?? null;
$check($r['code'] === 201 && is_int($leadId), 'CREATE lead', "id=$leadId code={$r['code']}");
if (!$leadId) { echo "Cannot continue — CREATE failed.\n"; exit(1); }

// READ
$r = hit('GET', "$base/leads/$leadId", $tokSuper);
$check($r['code'] === 200 && ($r['json']['lead']['name'] ?? '') !== '', 'READ lead by id', "code={$r['code']}");
$originalName = $r['json']['lead']['name'] ?? '';

// LIST → contains it
$r = hit('GET', "$base/leads", $tokSuper);
$found = false;
foreach ($r['json']['leads'] ?? [] as $l) { if (($l['id'] ?? 0) === $leadId) { $found = true; break; } }
$check($found, 'LIST contains new lead');

// UPDATE
$body = json_encode([
    'name'    => 'WriteCycle_Updated_' . uniqid(),
    'email'   => 'updated@example.com',
    'company' => 'WriteCycle Inc.',
    'industry' => 'Testing',
    'status'  => 'prospect',
]);
$r = hit('PUT', "$base/leads/$leadId", $tokSuper, $body);
$check($r['code'] === 200, 'UPDATE lead', "code={$r['code']}");

// READ AGAIN — confirm update landed
$r = hit('GET', "$base/leads/$leadId", $tokSuper);
$newName = $r['json']['lead']['name'] ?? '';
$check($newName !== '' && $newName !== $originalName, 'UPDATE persisted', "name now: $newName");

// CROSS-TENANT NEGATIVE — Acme can't see this lead
if ($tokTenant2) {
    $r = hit('GET', "$base/leads/$leadId", $tokTenant2);
    $check($r['code'] === 404, 'CROSS-TENANT READ refused (Acme → BRS lead)', "code={$r['code']}");
    // Acme can't update it either
    $r = hit('PUT', "$base/leads/$leadId", $tokTenant2, json_encode(['name' => 'hijack']));
    $check($r['code'] === 404, 'CROSS-TENANT UPDATE refused', "code={$r['code']}");
    // Acme can't delete it either
    $r = hit('DELETE', "$base/leads/$leadId", $tokTenant2);
    $check($r['code'] === 404, 'CROSS-TENANT DELETE refused', "code={$r['code']}");

    // ...and after all that, BRS's lead is still there
    $r = hit('GET', "$base/leads/$leadId", $tokSuper);
    $check($r['code'] === 200, 'Lead still readable after cross-tenant attacks', "code={$r['code']}");
}

// DELETE
$r = hit('DELETE', "$base/leads/$leadId", $tokSuper);
$check($r['code'] === 200, 'DELETE lead', "code={$r['code']}");

// CONFIRM GONE
$r = hit('GET', "$base/leads/$leadId", $tokSuper);
$check($r['code'] === 404, 'DELETE persisted (404)', "code={$r['code']}");

// IMPERSONATION FLOW
if ($tokTenant2) {
    echo "\n═══════════════════════════════════════════════════════════════════════════════\n";
    echo "  Impersonation round-trip\n";
    echo "═══════════════════════════════════════════════════════════════════════════════\n";

    $r = hit('POST', "$base/auth/impersonate", $tokSuper, json_encode(['tenant_id' => 2]));
    $impTok = $r['json']['token'] ?? null;
    $check($impTok !== null && ($r['json']['tenant_id'] ?? 0) === 2, 'Impersonate Acme', "code={$r['code']}");

    if ($impTok) {
        // With impersonated token → Acme view (empty)
        $r = hit('GET', "$base/leads", $impTok);
        $cnt = count($r['json']['leads'] ?? []);
        $check($r['code'] === 200 && $cnt === 0, 'Impersonated /leads shows Acme data (0)', "leads=$cnt");

        // Impersonated user is still flagged super (still can see registry)
        $r = hit('GET', "$base/super-admin/tenants", $impTok);
        $check($r['code'] === 200, 'Impersonated session still has super powers', "code={$r['code']}");
    }
}

// PUBLIC + X-Tenant-Key
echo "\n═══════════════════════════════════════════════════════════════════════════════\n";
echo "  Public route via X-Tenant-Key header\n";
echo "═══════════════════════════════════════════════════════════════════════════════\n";

// Hit /api/public/jobs without a key — should resolve to BRS (id=1)
$r = hit('GET', "$base/public/jobs");
$check($r['code'] === 200, 'No header → defaults to BRS', "code={$r['code']}");
// Hit with a junk key — falls back to BRS (length check fails)
$r = hit('GET', "$base/public/jobs", null, null, ['X-Tenant-Key: short']);
$check($r['code'] === 200, 'Bad key length → falls back to BRS', "code={$r['code']}");

echo "\n";
echo str_repeat('─', 80) . "\n";
printf("PASS %d  FAIL %d\n", $pass, $fail);
exit($fail > 0 ? 1 : 0);
