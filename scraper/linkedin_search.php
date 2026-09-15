<?php
/**
 * linkedin_search.php — best-effort LinkedIn COMPANY search → a source list.
 *
 * LinkedIn blocks unauthenticated search (HTTP 999), but DuckDuckGo's *lite*
 * endpoint has indexed LinkedIn's public /company/ pages, so we search there
 * for `<keyword> <location> site:linkedin.com/company` and read the company
 * pages out of the results. Names are derived from the company slug.
 *
 * This is the LinkedIn equivalent of the Companies House "company pull": it
 * captures a raw list of companies to seed the pipeline; the shared Qualify
 * flow then enriches each one (website, phone, email, staff, …).
 *
 *   GET linkedin_search.php?keyword=plumber&location=London&limit=25
 * Output:
 *   { "found": 12, "ratelimited": false,
 *     "companies": [ { "name": "Acme Plumbing", "linkedin_url": "https://uk.linkedin.com/company/acme-plumbing", "slug": "acme-plumbing" }, … ] }
 */

ini_set('display_errors', '0');
header('Content-Type: application/json; charset=utf-8');
set_time_limit(90);

function out($d, $c = 200) {
    http_response_code($c);
    echo json_encode($d, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

$keyword  = trim((string)($_GET['keyword'] ?? $_GET['q'] ?? ''));
$location = trim((string)($_GET['location'] ?? ''));
$limit    = max(1, min(100, (int)($_GET['limit'] ?? 25)));
if ($keyword === '') out(['error' => 'keyword is required'], 400);

// DuckDuckGo lite serves a bot-challenge page when throttled.
$is_challenge = fn(string $h) => stripos($h, 'anomaly.js') !== false || stripos($h, 'challenge-form') !== false;

// POST a query to DuckDuckGo lite; raw HTML ('' on transport error).
$ddg_lite = function (string $query): string {
    $ch = curl_init('https://lite.duckduckgo.com/lite/');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_TIMEOUT => 20, CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_ENCODING => '', CURLOPT_POST => true, CURLOPT_POSTFIELDS => 'q=' . urlencode($query) . '&kl=uk-en',
        CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        CURLOPT_HTTPHEADER => ['Accept-Language: en-GB,en;q=0.9'],
    ]);
    $b = curl_exec($ch);
    curl_close($ch);
    return (string)$b;
};

// Company slug → readable name: "acme-plumbing-ltd" → "Acme Plumbing Ltd".
$humanize = function (string $slug): string {
    $slug = preg_replace('/-[0-9a-f]{6,}$/i', '', $slug);       // drop trailing hash ids
    $slug = str_replace(['-', '_'], ' ', rawurldecode($slug));
    $slug = trim(preg_replace('/\s+/', ' ', $slug));
    return $slug === '' ? '' : ucwords($slug);
};

$query = trim($keyword . ' ' . $location) . ' site:linkedin.com/company';
$html  = $ddg_lite($query);
if ($html === '' || $is_challenge($html)) {
    out(['found' => 0, 'ratelimited' => $html !== '', 'companies' => [],
         'note' => $html === '' ? 'Search request failed.' : 'DuckDuckGo rate-limited the search — wait a minute and try again.']);
}

// Pull every public linkedin.com/company/<slug> out of the results. The
// scheme is optional — DDG lite often prints the result URL as bare text
// (uk.linkedin.com/company/…) rather than a full https:// link.
preg_match_all('#(?:https?://)?([a-z]{0,4}\.?)linkedin\.com/company/([A-Za-z0-9\-_%\.]+)#i', $html, $m, PREG_SET_ORDER);
$companies = []; $seen = [];
foreach ($m as $r) {
    $slug = rtrim($r[2], '/.');
    if ($slug === '' || isset($seen[$slug])) continue;
    $seen[$slug] = true;
    $name = $humanize($slug);
    if ($name === '') continue;
    $companies[] = [
        'name'         => $name,
        'linkedin_url' => 'https://' . ($r[1] !== '' ? $r[1] : 'www.') . 'linkedin.com/company/' . $slug,
        'slug'         => $slug,
    ];
    if (count($companies) >= $limit) break;
}

out(['found' => count($companies), 'ratelimited' => false, 'companies' => $companies]);
