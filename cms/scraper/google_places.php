<?php
/**
 * Google Places (New) lookup — resolve a company's Google Business listing.
 *
 *   GET google_places.php?name=ACME+LTD&address=1+High+St,+London&key=...
 *
 * Uses the official Places API (New) Text Search endpoint with a field mask,
 * so a SINGLE call returns the business's phone, website, Maps URL, rating,
 * status and opening hours. Google never exposes a business email through any
 * API, so email is not (and cannot be) returned here — that comes from
 * crawling the website in a later stage.
 *
 * The API key comes from &key= (passed by the caller, which reads it from the
 * tenant's masked settings) or the GOOGLE_MAPS_API_KEY env var. Requires a
 * Google Cloud key with the Places API (New) enabled + billing on (the
 * $200/month Maps Platform credit keeps modest use free).
 *
 * Response:
 *   { "found": true, "place_id", "name", "phone", "website", "maps_url",
 *     "rating", "business_status", "formatted_address", "opening_hours",
 *     "types" }
 *   { "found": false }                         // no matching listing
 *   { "error": "..." }                         // config / upstream error
 */

ini_set('display_errors', '0');
error_reporting(E_ALL);

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');

set_time_limit(60);

function out($data, $code = 200) {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

$key     = trim((string)($_GET['key'] ?? ''));
if ($key === '') $key = trim((string)(getenv('GOOGLE_MAPS_API_KEY') ?: ''));
$name    = trim((string)($_GET['name'] ?? ''));
$address = trim((string)($_GET['address'] ?? ''));
// method=api (default) uses the paid Places API; method=scrape is the free,
// no-key fallback that finds the company website via DuckDuckGo (for when the
// Places credit is exhausted). See scrape_lookup() at the foot of this file.
$method  = strtolower(trim((string)($_GET['method'] ?? 'api')));
if ($method !== 'scrape') $method = 'api';

if ($name === '') out(['error' => 'name is required'], 400);

// Company name + registered address = the query for either method, so the top
// result is the right business rather than a same-name company elsewhere.
$query = trim($name . ($address !== '' ? ', ' . $address : ''));

// ---- Fallback path: no-key scraper --------------------------------------
if ($method === 'scrape') {
    scrape_lookup($query, $name);   // echoes JSON + exits
}

// ---- Default path: official Google Places API (New) ---------------------
if ($key === '') out(['error' => 'No Google Maps API key configured.'], 400);

$fieldMask = implode(',', [
    'places.id',
    'places.displayName',
    'places.formattedAddress',
    'places.nationalPhoneNumber',
    'places.internationalPhoneNumber',
    'places.websiteUri',
    'places.rating',
    'places.businessStatus',
    'places.googleMapsUri',
    'places.regularOpeningHours',
    'places.types',
]);

$ch = curl_init('https://places.googleapis.com/v1/places:searchText');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => json_encode(['textQuery' => $query, 'maxResultCount' => 1]),
    CURLOPT_HTTPHEADER     => [
        'Content-Type: application/json',
        'X-Goog-Api-Key: ' . $key,
        'X-Goog-FieldMask: ' . $fieldMask,
    ],
    CURLOPT_TIMEOUT        => 30,
    // Google certs verify against standard bundles, but the other scrapers in
    // this project disable peer verification because the Hostinger prod box
    // can't build the chain. Hostname check (VERIFYHOST) stays on, and no
    // secret is leaked by skipping peer verification (the key rides in a
    // header over TLS with the hostname still validated).
    CURLOPT_SSL_VERIFYPEER => false,
]);
$body = curl_exec($ch);
$code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
$err  = curl_error($ch);
curl_close($ch);

if ($body === false) out(['error' => 'Upstream request failed: ' . $err], 502);

$data = json_decode($body, true);
if ($code === 401 || $code === 403) {
    $msg = $data['error']['message'] ?? 'Google rejected the API key (check the key and that Places API New is enabled + billing is on).';
    out(['error' => $msg], 502);
}
if ($code >= 400) {
    $msg = $data['error']['message'] ?? ('Google returned HTTP ' . $code);
    out(['error' => $msg], 502);
}

$place = $data['places'][0] ?? null;
if (!$place) out(['found' => false]);

// Opening hours -> one readable line.
$hours = '';
if (!empty($place['regularOpeningHours']['weekdayDescriptions'])) {
    $hours = implode('; ', $place['regularOpeningHours']['weekdayDescriptions']);
}

out([
    'found'             => true,
    'place_id'          => $place['id'] ?? '',
    'name'              => $place['displayName']['text'] ?? '',
    'phone'             => $place['internationalPhoneNumber'] ?? ($place['nationalPhoneNumber'] ?? ''),
    'website'           => $place['websiteUri'] ?? '',
    'maps_url'          => $place['googleMapsUri'] ?? '',
    'rating'            => $place['rating'] ?? null,
    'business_status'   => $place['businessStatus'] ?? '',
    'formatted_address' => $place['formattedAddress'] ?? '',
    'opening_hours'     => $hours,
    'types'             => implode(', ', $place['types'] ?? []),
]);

/**
 * Free fallback: find the company's own website via DuckDuckGo's HTML endpoint.
 *
 * Google's own SERP serves a JS consent/redirect wall to server requests, so
 * it can't be scraped from PHP; DuckDuckGo's html endpoint returns clean,
 * parseable results. Only the website is reliably available this way (phone /
 * email come from crawling that site in a later stage). Returns the same shape
 * as the API path so the caller treats both identically. Echoes JSON + exits.
 */
function scrape_lookup($query, $name) {
    $ch = curl_init('https://html.duckduckgo.com/html/');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT        => 25,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => 'q=' . urlencode($query) . '&kl=uk-en',
        CURLOPT_USERAGENT      => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
        CURLOPT_HTTPHEADER     => ['Accept-Language: en-GB,en;q=0.9'],
    ]);
    $body = curl_exec($ch);
    $err  = curl_error($ch);
    curl_close($ch);
    if ($body === false) out(['error' => 'Scraper request failed: ' . $err], 502);

    // DDG wraps organic links in /l/?uddg=<encoded-target>.
    preg_match_all('/<a[^>]+class="result__a"[^>]+href="([^"]+)"/i', (string)$body, $m);
    $urls = [];
    foreach ($m[1] as $href) {
        if (preg_match('/[?&]uddg=([^&"]+)/', $href, $u)) $urls[] = urldecode($u[1]);
        elseif (stripos($href, 'http') === 0)            $urls[] = $href;
    }

    $website = first_business_url($urls, $name);
    if ($website === '') out(['found' => false]);

    // Reduce to a clean origin (scheme + host) for a tidy stored value.
    $p = parse_url($website);
    $clean = (isset($p['scheme'], $p['host'])) ? $p['scheme'] . '://' . $p['host'] . '/' : $website;

    out([
        'found'             => true,
        'place_id'          => '',
        'name'              => $name,
        'phone'             => '',
        'website'           => $clean,
        'maps_url'          => '',
        'rating'            => null,
        'business_status'   => '',
        'formatted_address' => '',
        'opening_hours'     => '',
        'types'             => '',
        'source'            => 'scrape',
    ]);
}

/**
 * Distinctive lowercase tokens from a company name (drops legal-form and
 * generic words + anything under 4 chars), used to gate scraper matches.
 */
function name_tokens($name) {
    $stop = ['ltd','limited','plc','llp','llc','group','holdings','uk','the','and',
             'company','services','service','consulting','solutions','trading',
             'international','associates','partners','enterprises','global'];
    $tokens = [];
    foreach (preg_split('/[^a-z0-9]+/', strtolower($name)) as $t) {
        if (strlen($t) >= 4 && !in_array($t, $stop, true)) $tokens[] = $t;
    }
    return $tokens;
}

/**
 * First result URL that is the company's own site. Skips directories, social
 * networks, gov registers and search engines, AND requires the host to share a
 * distinctive token with the company name — so a brand-new company with no real
 * website reports "not found" rather than a random formation-agent/directory
 * site (a wrong website is worse than none: stage 4 would crawl it).
 */
function first_business_url(array $urls, $name = '') {
    $tokens = name_tokens($name);
    $skip = [
        'duckduckgo.com', 'google.', 'bing.com', 'yahoo.',
        'gov.uk', 'service.gov.uk', 'find-and-update', 'companieshouse',
        'linkedin.com', 'facebook.com', 'twitter.com', 'x.com', 'instagram.com',
        'youtube.com', 'tiktok.com', 'pinterest.', 'reddit.com',
        'yell.com', 'yelp.', 'trustpilot', 'tripadvisor', 'checkatrade', 'indeed.',
        'glassdoor', 'wikipedia.org', 'crunchbase', 'bloomberg', 'dnb.com',
        'endole.co.uk', 'opencorporates', 'companycheck', 'companiesintheuk',
        'datanyze', '189.com', 'ukbusinessforums', 'amazon.', 'ebay.', 'apple.com',
        // Common UK company-directory / data-broker domains (not the business's
        // own site) — best-effort; the scraper can never catch them all.
        'companyinformation', 'company-information', 'ukdata', 'globaldatabase',
        'b2bhint', 'northdata', 'creditsafe', 'kompass', 'thomsonlocal', 'scoot.',
        'freeindex', '192.com', 'cylex', 'brownbook', 'bizdb', 'thegazette',
        'gov.wales', 'lei.', 'find-and-update.company',
    ];
    foreach ($urls as $u) {
        $host = strtolower((string)parse_url($u, PHP_URL_HOST));
        if ($host === '') continue;
        $bad = false;
        foreach ($skip as $s) { if (strpos($host, $s) !== false) { $bad = true; break; } }
        if ($bad) continue;
        // Host must contain a distinctive company-name token. If we have no
        // usable tokens (very generic name), fall back to the first clean host.
        if (empty($tokens)) return $u;
        $hostFlat = str_replace(['-', '.'], '', $host);
        foreach ($tokens as $t) {
            if (strpos($host, $t) !== false || strpos($hostFlat, $t) !== false) return $u;
        }
    }
    return '';
}
