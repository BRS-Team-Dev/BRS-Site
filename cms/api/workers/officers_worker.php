<?php
/**
 * Background worker — enriches directors for a list of company_leads.
 *
 * Invoked by routes/company_leads.php's fetch handler via `exec()` with a
 * fully-detached shell command so it survives past the parent HTTP request.
 * Reads a JSON file of {company_number: lead_id} pairs, calls the CH
 * officers scraper in chunks of 40 (each fits under nginx's 60s cap),
 * writes contact rows, and deletes the input file.
 *
 * Runs on CLI (no HTTP), so there's no nginx timeout on the parent
 * process, and can happily take 2+ minutes for a 200-company batch.
 *
 *   php officers_worker.php <tenant_id> <path/to/pending.json>
 *
 * pending.json shape:
 *   { "site_base": "https://builtrightstudio.com/cc",
 *     "insertedMap": { "SC123456": 1234, "12345678": 1235, ... } }
 */

declare(strict_types=1);

$tid  = (int)($argv[1] ?? 0);
$path = (string)($argv[2] ?? '');
if ($tid <= 0 || $path === '' || !is_file($path)) {
    fwrite(STDERR, "usage: officers_worker.php <tenant_id> <pending.json>\n");
    exit(2);
}

require __DIR__ . '/../bootstrap.php';

$payload = json_decode((string)file_get_contents($path), true);
if (!is_array($payload) || empty($payload['insertedMap']) || empty($payload['site_base'])) {
    fwrite(STDERR, "[officers_worker] bad payload at {$path}\n");
    @unlink($path);
    exit(3);
}

$siteBase    = (string)$payload['site_base'];
$insertedMap = (array)$payload['insertedMap'];
$total       = count($insertedMap);

error_log("[officers_worker] starting: tenant={$tid} companies={$total}");

$pdo = \BRS\Db::pdo();
$pdo->setAttribute(\PDO::ATTR_ERRMODE, \PDO::ERRMODE_EXCEPTION);
$insContact = $pdo->prepare('INSERT INTO company_lead_contacts
    (tenant_id, company_lead_id, first_name, last_name, position, email, verified, is_primary, sort_order)
    VALUES (?,?,?,?,?,?,?,?,?)');
$advance = $pdo->prepare('UPDATE company_leads SET stage = 2, stage_updated_at = NOW()
    WHERE id = ? AND tenant_id = ?');

$fetchOfficers = static function (string $q) use ($siteBase): array {
    $ch = curl_init($siteBase . '/scraper/ch_api.php?' . $q);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 55,   // stay under nginx's 60s cap
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_SSL_VERIFYPEER => false,
    ]);
    $body   = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($body === false || $status !== 200) {
        throw new \RuntimeException("officers HTTP {$status}");
    }
    $r = json_decode((string)$body, true);
    if (!is_array($r)) throw new \RuntimeException('officers non-JSON response');
    if (isset($r['error'])) throw new \RuntimeException('officers: ' . $r['error']);
    return $r;
};

$CHUNK    = 40;
$nums     = array_keys($insertedMap);
$inserted = 0;
$errors   = 0;

for ($k = 0; $k < count($nums); $k += $CHUNK) {
    $slice = array_slice($nums, $k, $CHUNK);
    try {
        $off = $fetchOfficers('mode=officers&numbers=' . urlencode(implode(',', $slice)));
    } catch (\Throwable $e) {
        error_log('[officers_worker] chunk ' . ($k / $CHUNK + 1) . ' failed: ' . $e->getMessage());
        $errors++;
        continue;
    }
    foreach ($slice as $num) {
        $lid    = (int)$insertedMap[$num];
        $people = $off[$num] ?? [];
        if (!$people) continue;
        foreach ($people as $i => $p) {
            $first = ($p['first'] ?? '') !== '' ? $p['first'] : (($p['last'] ?? '') !== '' ? $p['last'] : 'Director');
            try {
                $insContact->execute([
                    $tid,
                    $lid,
                    $first,
                    ($p['last'] ?? '') !== '' ? $p['last'] : null,
                    ($p['role'] ?? '') !== '' ? $p['role'] : 'director',
                    null, 0,
                    $i === 0 ? 1 : 0,
                    $i,
                ]);
                $inserted++;
            } catch (\Throwable $e) {
                error_log('[officers_worker] insert failed lid=' . $lid . ': ' . $e->getMessage());
                $errors++;
            }
        }
        $advance->execute([$lid, $tid]);
    }
    error_log('[officers_worker] chunk ' . ($k / $CHUNK + 1) . '/' . (int)ceil(count($nums) / $CHUNK) . ' done — inserted=' . $inserted);
}

@unlink($path);

// Mark the job as done so the pipeline endpoint stops reporting "running"
// and the dashboard's progress bar clears on the next poll. Best-effort —
// if this write fails, worst case the frontend keeps polling and eventually
// notices the director count stopped moving.
try {
    $existing = $pdo->query("SELECT v FROM settings WHERE k = 'ch_director_job'")->fetchColumn();
    $state = is_string($existing) ? (json_decode($existing, true) ?: []) : [];
    $state['status']   = $errors > 0 && $inserted === 0 ? 'error' : 'done';
    $state['done_at']  = date('c');
    $state['inserted'] = $inserted;
    $state['errors']   = $errors;
    $pdo->prepare("INSERT INTO settings (k, v) VALUES ('ch_director_job', ?)
        ON DUPLICATE KEY UPDATE v = VALUES(v)")->execute([json_encode($state)]);
} catch (\Throwable $e) {
    error_log('[officers_worker] job state update failed: ' . $e->getMessage());
}

error_log("[officers_worker] finished: inserted={$inserted} errors={$errors}");
