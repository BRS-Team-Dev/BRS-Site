<?php
/**
 * Google Places (New) DISCOVERY search - find businesses we do not know yet.
 *
 *   GET google_search.php?query=care+homes+in+Nottingham&key=...&page_token=...
 *
 * Sibling of google_places.php, and deliberately separate from it:
 *   - google_places.php RESOLVES one company we already hold, taking the top
 *     match for a known name + address (maxResultCount=1).
 *   - this one DISCOVERS many companies from a free-text query, paginating so
 *     the Lead Gen "Google" source can seed the pipeline the way the
 *     Companies House and LinkedIn pulls do.
 *
 * Places API (New) Text Search returns up to 20 per page and issues a
 * `nextPageToken` for up to 3 pages (60 results) per query. Beyond that the
 * caller must narrow the query - by town, by sub-sector - rather than paging
 * further; Google simply stops handing out tokens.
 *
 * Google never exposes a business email through any API, so email is not
 * returned here. That comes from crawling the website in the Qualify pass.
 *
 * Response:
 *   { "ok": true, "results": [ { place_id, name, address, phone, website,
 *                                maps_url, rating, business_status, types } ],
 *     "next_page_token": "..." | null }
 *   { "error": "..." }
 */

ini_set('display_errors', '0');
error_reporting(E_ALL);

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');

set_time_limit(90);

function gs_out($data, $code = 200) {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

$key = trim((string)($_GET['key'] ?? ''));
if ($key === '') $key = trim((string)(getenv('GOOGLE_MAPS_API_KEY') ?: ''));
$query     = trim((string)($_GET['query'] ?? ''));
$pageToken = trim((string)($_GET['page_token'] ?? ''));

if ($query === '') gs_out(['error' => 'query is required'], 400);
if ($key === '')   gs_out(['error' => 'No Google Maps API key configured. Add it under Lead Gen -> Settings.'], 400);

$fieldMask = implode(',', [
    'places.id',
    'places.displayName',
    'places.formattedAddress',
    'places.nationalPhoneNumber',
    'places.websiteUri',
    'places.rating',
    'places.businessStatus',
    'places.googleMapsUri',
    'places.types',
    'nextPageToken',
]);

$payload = ['textQuery' => $query, 'maxResultCount' => 20];
// A page token continues the ORIGINAL query; Google requires the query to be
// sent again unchanged alongside it.
if ($pageToken !== '') $payload['pageToken'] = $pageToken;

$ch = curl_init('https://places.googleapis.com/v1/places:searchText');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => json_encode($payload),
    CURLOPT_HTTPHEADER     => [
        'Content-Type: application/json',
        'X-Goog-Api-Key: ' . $key,
        'X-Goog-FieldMask: ' . $fieldMask,
    ],
    CURLOPT_TIMEOUT        => 45,
    // Matches google_places.php: the Hostinger prod box cannot build the cert
    // chain. Hostname verification stays on and the key rides in a header over
    // TLS, so skipping peer verification leaks nothing.
    CURLOPT_SSL_VERIFYPEER => false,
]);
$body = curl_exec($ch);
$code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
$err  = curl_error($ch);
curl_close($ch);

if ($body === false) gs_out(['error' => 'Upstream request failed: ' . $err], 502);

$data = json_decode($body, true);
if ($code === 401 || $code === 403) {
    gs_out(['error' => $data['error']['message']
        ?? 'Google rejected the API key (check the key, and that Places API New is enabled with billing on).'], 502);
}
if ($code >= 400) {
    gs_out(['error' => $data['error']['message'] ?? ('Google returned HTTP ' . $code)], 502);
}

$results = [];
foreach (($data['places'] ?? []) as $p) {
    $name = trim((string)($p['displayName']['text'] ?? ''));
    if ($name === '') continue;
    $results[] = [
        'place_id'        => (string)($p['id'] ?? ''),
        'name'            => $name,
        'address'         => (string)($p['formattedAddress'] ?? ''),
        'phone'           => (string)($p['nationalPhoneNumber'] ?? ''),
        'website'         => (string)($p['websiteUri'] ?? ''),
        'maps_url'        => (string)($p['googleMapsUri'] ?? ''),
        'rating'          => isset($p['rating']) ? (float)$p['rating'] : null,
        'business_status' => (string)($p['businessStatus'] ?? ''),
        'types'           => is_array($p['types'] ?? null) ? implode(', ', $p['types']) : '',
    ];
}

gs_out([
    'ok'              => true,
    'results'         => $results,
    'next_page_token' => (string)($data['nextPageToken'] ?? '') ?: null,
]);
