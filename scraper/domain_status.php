<?php
/**
 * domain_status.php — is a domain a live business site, or parked / for sale /
 * dead? Determined entirely from DNS + HTTP headers + a small body sample — no
 * page rendering, no headless browser.
 *
 * Signals, strongest first:
 *   - Nameservers on a known parking network (sedoparking, parkingcrew, bodis,
 *     dan.com, afternic, hugedomains, cashparking ...) => parked (near-certain).
 *   - Redirect to a marketplace host (dan.com / afternic / sedo) or a ?domain=
 *     landing => for_sale.
 *   - No A record + no response => dead (or unconfigured on registrar-default NS).
 *   - Parking phrases in a small body with no JS bundle => parked/for_sale.
 *   - 2xx/3xx with a real body or a JS bundle => live.
 *
 * Guards for the two classic false positives:
 *   - SPA shell (Angular/React) is a tiny near-empty body — looks like a parking
 *     stub — so a detected <script src="...main-*.js"> bundle forces "live".
 *   - Cloudflare / WAF 403/503 challenge is a live site behind protection, so
 *     those map to "unknown" (never marked dead/red).
 *
 * Usage:  GET domain_status.php?website=https://acme.co.uk   (or ?domain=acme.co.uk)
 * Output: { "status": "live|parked|for_sale|unconfigured|dead|unknown",
 *           "confidence": "high|medium|low", "active": true|false,
 *           "http": 200, "final": "https://www.acme.co.uk/", "signals": [ ... ] }
 */

header('Content-Type: application/json');

function out(array $data, int $code = 200): void {
    http_response_code($code);
    echo json_encode($data);
    exit;
}

$in = trim((string)($_GET['website'] ?? $_GET['domain'] ?? ''));
if ($in === '') out(['error' => 'website/domain is required'], 400);
if (!preg_match('#^https?://#i', $in)) $in = 'https://' . $in;
$host = parse_url($in, PHP_URL_HOST);
if (!$host) out(['status' => 'unknown', 'confidence' => 'low', 'active' => true, 'signals' => ['unparseable host']]);
$reg = preg_replace('#^www\.#i', '', strtolower($host));

$signals = [];

// ---- DNS ------------------------------------------------------------------
$ns = @dns_get_record($reg, DNS_NS) ?: [];
$a  = @dns_get_record($reg, DNS_A)  ?: [];
$mx = @dns_get_record($reg, DNS_MX) ?: [];
$nsHosts = strtolower(implode(' ', array_map(static fn($r) => $r['target'] ?? '', $ns)));

$PARK_NS = ['sedoparking', 'parkingcrew', 'bodis', 'above.com', 'dan.com', 'afternic',
            'hugedomains', 'cashparking', 'sedo.com', 'parklogic', 'fabulous.com',
            'undeveloped', 'domainmarket', 'skenzo', 'voodoo.com', 'name-services',
            'trafficclub', 'parkingpage', 'domain-for-sale'];
$parkNs = false;
foreach ($PARK_NS as $needle) { if ($nsHosts !== '' && strpos($nsHosts, $needle) !== false) { $parkNs = true; $signals[] = "parking nameserver ($needle)"; break; } }
$registrarDefault = ($nsHosts !== '' && (strpos($nsHosts, 'domaincontrol.com') !== false || strpos($nsHosts, 'registrar-servers') !== false));

// ---- HTTP (one GET, follows redirects; body used for phrase/bundle test) ---
$ch = curl_init($in);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS      => 5,
    CURLOPT_TIMEOUT        => 15,
    CURLOPT_CONNECTTIMEOUT => 8,
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_USERAGENT      => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
    CURLOPT_HTTPHEADER     => ['Accept-Language: en-GB,en;q=0.9'],
]);
$body    = curl_exec($ch);
$httpErr = curl_error($ch);
$code    = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
$final   = (string)curl_getinfo($ch, CURLINFO_EFFECTIVE_URL);
curl_close($ch);
$body      = is_string($body) ? $body : '';
$bodyLen   = strlen($body);
$sample    = substr($body, 0, 60000);
$finalHost = strtolower((string)parse_url($final, PHP_URL_HOST));

// Redirect to a domain marketplace, or a ?domain= sales landing.
$FORSALE_HOSTS = ['dan.com', 'afternic.com', 'sedo.com', 'hugedomains.com', 'undeveloped.com', 'buydomains.com', 'domainmarket.com'];
$redirForSale = false;
foreach ($FORSALE_HOSTS as $h) { if ($finalHost !== '' && (str_ends_with($finalHost, $h))) { $redirForSale = true; $signals[] = "redirects to marketplace ($h)"; break; } }
if (!$redirForSale && $final !== '' && preg_match('#[?&]domain=#i', $final)) { $redirForSale = true; $signals[] = 'redirects to ?domain= sales page'; }

// Parking / for-sale copy in the body.
$hasForSale = (bool)preg_match('#(buy this domain|this domain is for sale|domain (name )?is for sale|domain may be for sale|checkout the full page|domain for sale)#i', $sample);
$hasParked  = (bool)preg_match('#(related searches|this domain is parked|parked free|domain parking|is parked|sponsored listings|courtesy of goDaddy)#i', $sample);
if ($hasForSale) $signals[] = 'for-sale copy in body';
if ($hasParked)  $signals[] = 'parking copy in body';

// SPA / real-site markers (guard against tiny-body false positives).
$hasBundle = (bool)preg_match('#<script[^>]+src=["\'][^"\']*(main|runtime|polyfills|vendor|app|bundle|chunk)[^"\']*\.js#i', $sample)
          || (bool)preg_match('#(ng-version=|data-reactroot|__NEXT_DATA__|window\.__NUXT__|id="__next")#i', $sample);
if ($hasBundle) $signals[] = 'JS app bundle present';

// ---- Verdict --------------------------------------------------------------
$status = 'unknown'; $confidence = 'low';

if ($redirForSale) {
    $status = 'for_sale'; $confidence = 'high';
} elseif ($parkNs) {
    // Parking NS is near-conclusive, but a real site could in theory sit on one;
    // downgrade to for_sale if the copy says so.
    $status = $hasForSale ? 'for_sale' : 'parked'; $confidence = 'high';
} elseif ($code === 0 && !$a) {
    $status = $registrarDefault ? 'unconfigured' : 'dead'; $confidence = 'high';
    $signals[] = $registrarDefault ? 'registrar-default NS, no A record' : 'no A record, no HTTP response';
} elseif ($code === 0) {
    $status = 'dead'; $confidence = 'medium'; $signals[] = 'no HTTP response';
} elseif (($hasForSale || $hasParked) && !$hasBundle) {
    $status = $hasForSale ? 'for_sale' : 'parked'; $confidence = 'medium';
} elseif ($code === 403 || $code === 429 || $code === 503) {
    $status = 'unknown'; $confidence = 'low'; $signals[] = "protected/challenge (HTTP $code)"; // Cloudflare/WAF — treat as live-ish
} elseif ($code >= 200 && $code < 400) {
    if ($hasBundle || $bodyLen > 2000) { $status = 'live'; $confidence = 'high'; $signals[] = 'served real content'; }
    else { $status = 'unknown'; $confidence = 'low'; $signals[] = "thin body ($bodyLen bytes), no bundle"; }
} elseif ($code >= 400) {
    $status = 'unknown'; $confidence = 'low'; $signals[] = "HTTP $code";
}

// MX presence is a supporting signal only (brochure sites route mail elsewhere).
if (!$mx && in_array($status, ['unknown', 'dead'], true)) $signals[] = 'no MX record';

$DEAD = ['parked', 'for_sale', 'unconfigured', 'dead'];
out([
    'status'     => $status,
    'confidence' => $confidence,
    'active'     => !in_array($status, $DEAD, true),
    'http'       => $code,
    'final'      => $final,
    'mx'         => count($mx),
    'signals'    => $signals,
]);
