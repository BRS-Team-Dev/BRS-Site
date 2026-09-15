<?php
/**
 * LinkedIn lookup (best-effort) — company page + staff (name + profile link).
 *
 *   GET linkedin.php?name=ACME+LTD&location=London&first=Jane&last=Smith&method=scrape
 *
 * LinkedIn blocks unauthenticated server requests outright (HTTP 999 on the
 * /pub/dir people search, a JS auth-wall on /company pages), so:
 *
 *   method=scrape  (default, no cookie) — finds ONLY the company's LinkedIn
 *                  URL, via a search engine (DuckDuckGo). Staff need auth, so
 *                  they come back empty with blocked=true. This is the honest
 *                  ceiling of the free path.
 *   method=cookie  — uses a LinkedIn li_at session cookie (+ JSESSIONID as the
 *                  csrf-token) to fetch authenticated pages and extract the
 *                  company + staff (name + /in/ profile link).
 *                  WARNING: this drives YOUR logged-in session. LinkedIn's ToS
 *                  forbids scraping; heavy use can get the account restricted
 *                  or banned. Keep the 1-15s stagger and low volume.
 *
 * Params: name (company), location, first, last (a director to match against),
 *         method, li_at, csrf, company_url (optional cached URL to skip search).
 * Response: { found, company_url, director_url, staff:[{name,url}], blocked, note }
 *           { error: "..." }
 */

ini_set('display_errors', '0');
error_reporting(E_ALL);
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
set_time_limit(90);

function out($d, $c = 200) {
    http_response_code($c);
    echo json_encode($d, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

$name       = trim((string)($_GET['name'] ?? ''));
$location   = trim((string)($_GET['location'] ?? ''));
$first      = trim((string)($_GET['first'] ?? ''));
$last       = trim((string)($_GET['last'] ?? ''));
$method     = strtolower(trim((string)($_GET['method'] ?? 'scrape')));
if ($method !== 'cookie') $method = 'scrape';
$liAt       = trim((string)($_GET['li_at'] ?? ''));
$csrf       = trim((string)($_GET['csrf'] ?? ''));
$companyUrl = trim((string)($_GET['company_url'] ?? ''));

if ($name === '') out(['error' => 'name is required'], 400);

// Find the company page + staff via DuckDuckGo's *lite* endpoint, which has
// indexed LinkedIn's public company + profile URLs. LinkedIn itself blocks
// direct server access (HTTP 999 / JS wall), but the search engine already
// crawled the public pages, so we read them from there. Names come from the
// profile slug (…/in/jane-smith-1a2b → "Jane Smith").
$ddg = ddg_lite_linkedin($name, $location, $companyUrl);
$companyUrl = $ddg['company_url'];

// ---- Free path: company URL + staff (name + link) from search -----------
if ($method === 'scrape') {
    out([
        'found'       => ($companyUrl !== '' || !empty($ddg['staff'])),
        'company_url' => $companyUrl,
        'director_url'=> '',
        'staff'       => $ddg['staff'],
        'blocked'     => false,
        'ratelimited' => $ddg['ratelimited'],
        'note'        => $ddg['ratelimited']
            ? 'DuckDuckGo rate-limited this lookup — wait a minute and retry.'
            : ((empty($ddg['staff']) && $companyUrl === '') ? 'No LinkedIn results indexed for this company.' : ''),
    ]);
}

// ---- Cookie path: authenticated fetch -----------------------------------
if ($liAt === '') {
    out(['error' => 'The cookie method needs a LinkedIn li_at cookie. Add it in Lead Gen -> Settings.'], 400);
}

// Director profile (best-effort match on name; the caller passes the director
// we already hold from Companies House so we can verify the right company).
$directorUrl = '';
if ($first !== '' || $last !== '') {
    [$dc, $dbody] = li_fetch('https://www.linkedin.com/pub/dir?firstName=' . urlencode($first) . '&lastName=' . urlencode($last), $liAt, $csrf);
    $directorUrl = first_profile_matching($dbody, $location, $name);
}

// Staff: the authenticated company "people" page embeds profile records.
$staff = [];
if ($companyUrl !== '') {
    $peopleUrl = rtrim($companyUrl, '/') . '/people/';
    [$pc, $pbody] = li_fetch($peopleUrl, $liAt, $csrf);
    if ($pc === 999 || $pc === 403 || stripos($pbody, 'authwall') !== false) {
        out(['error' => 'LinkedIn rejected the session cookie (HTTP ' . $pc . '). The li_at cookie may be expired — refresh it in Settings.'], 502);
    }
    $staff = extract_staff($pbody);
}
// Fall back to the search-engine staff if the authenticated page yielded none.
if (empty($staff)) $staff = $ddg['staff'];

out([
    'found'        => ($companyUrl !== '' || !empty($staff)),
    'company_url'  => $companyUrl,
    'director_url' => $directorUrl,
    'staff'        => $staff,
    'blocked'      => false,
    'note'         => empty($staff) ? 'No staff extracted (page structure may have changed, or the company has no public people list).' : '',
]);

// -------------------------------------------------------------------------

/**
 * DuckDuckGo *lite* lookup: returns the company LinkedIn URL + staff profiles
 * (name + /in/ link) surfaced for "<name> <location> LinkedIn". The lite
 * endpoint is more scrape-tolerant than html/ and exposes the target URLs as
 * visible text. Returns ['company_url'=>, 'staff'=>[{name,url}], 'ratelimited'].
 */
function ddg_lite_linkedin($name, $location, $known = '') {
    $html = ddg_lite(trim($name . ' ' . $location) . ' LinkedIn');
    if ($html === '' || is_challenge($html)) {
        return ['company_url' => $known, 'staff' => [], 'ratelimited' => ($html !== '')];
    }
    preg_match_all('#https?://[a-z]{0,4}\.?linkedin\.com/(company|in)/[A-Za-z0-9\-_%\.]+#i', $html, $m, PREG_SET_ORDER);
    $tokens = name_tokens($name);
    $company = $known; $staff = []; $seen = [];
    foreach ($m as $r) {
        $url  = rtrim($r[0], '/');
        $type = strtolower($r[1]);
        if (isset($seen[$url])) continue;
        $seen[$url] = true;
        if ($type === 'company') {
            if ($company === '') {
                $low = strtolower($url);
                $match = empty($tokens);
                foreach ($tokens as $t) if (strpos($low, $t) !== false) { $match = true; break; }
                if ($match) $company = $url . '/';
            }
        } else { // /in/ profile
            $slug = basename((string)parse_url($url, PHP_URL_PATH));
            $staff[] = ['name' => humanize_slug($slug), 'url' => $url . '/'];
        }
    }
    // No name-matched company page but one was present → take the first.
    if ($company === '') {
        foreach ($m as $r) if (strtolower($r[1]) === 'company') { $company = rtrim($r[0], '/') . '/'; break; }
    }
    return ['company_url' => $company, 'staff' => array_slice($staff, 0, 25), 'ratelimited' => false];
}

/** POST a query to DuckDuckGo lite; returns raw HTML ('' on transport error). */
function ddg_lite($query) {
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
}

/** DuckDuckGo serves a bot-challenge page when it throttles us. */
function is_challenge($html) {
    return stripos($html, 'anomaly.js') !== false || stripos($html, 'challenge-form') !== false;
}

/** Distinctive lowercase tokens from a company name (for matching a company slug). */
function name_tokens($name) {
    $stop = ['ltd','limited','plc','llp','llc','group','holdings','uk','the','and',
             'company','services','service','trading','international','associates','partners'];
    $t = [];
    foreach (preg_split('/[^a-z0-9]+/', strtolower($name)) as $x) {
        if (strlen($x) >= 4 && !in_array($x, $stop, true)) $t[] = $x;
    }
    return $t;
}

/** Authenticated GET with the li_at session cookie (+ JSESSIONID csrf). */
function li_fetch($url, $liAt, $csrf) {
    $csrf = trim($csrf, '"');
    $cookie = 'li_at=' . $liAt . ($csrf !== '' ? '; JSESSIONID="' . $csrf . '"' : '');
    $hdr = [
        'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language: en-GB,en;q=0.9',
        'Cookie: ' . $cookie,
    ];
    if ($csrf !== '') $hdr[] = 'csrf-token: ' . $csrf;
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_TIMEOUT => 30, CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
        CURLOPT_HTTPHEADER => $hdr,
    ]);
    $b = curl_exec($ch);
    $c = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [$c, (string)$b];
}

/**
 * Pull staff (name + /in/ URL) out of an authenticated company people page.
 * LinkedIn embeds profile records as JSON; we pair publicIdentifier with the
 * nearest first/last name, falling back to a humanised slug. Best-effort — the
 * embedded shape shifts, so this is the part most likely to need tuning once a
 * real cookie is available.
 */
function extract_staff($html) {
    $staff = [];
    $seen = [];
    // Grab each profile object that carries a publicIdentifier + names.
    if (preg_match_all('/"firstName":"([^"]*)","lastName":"([^"]*)"[^}]*?"publicIdentifier":"([^"]+)"/', $html, $m, PREG_SET_ORDER)) {
        foreach ($m as $r) {
            $id = $r[3];
            if ($id === '' || isset($seen[$id]) || stripos($id, 'unknown') !== false) continue;
            $seen[$id] = true;
            $nm = trim($r[1] . ' ' . $r[2]);
            $staff[] = ['name' => $nm !== '' ? $nm : humanize_slug($id), 'url' => 'https://www.linkedin.com/in/' . $id . '/'];
        }
    }
    // Fallback: any /in/ slugs present, humanised.
    if (empty($staff) && preg_match_all('#/in/([A-Za-z0-9\-_%]{3,})#', $html, $mm)) {
        foreach (array_unique($mm[1]) as $id) {
            if (isset($seen[$id])) continue;
            $seen[$id] = true;
            $staff[] = ['name' => humanize_slug($id), 'url' => 'https://www.linkedin.com/in/' . $id . '/'];
        }
    }
    return array_slice($staff, 0, 50);
}

/** Best profile URL from a pub/dir page whose row mentions the location/company. */
function first_profile_matching($html, $location, $company) {
    if (!preg_match_all('#/in/([A-Za-z0-9\-_%]{3,})#', (string)$html, $m)) return '';
    // Without auth this page is HTTP 999; with auth, take the first /in/ link.
    $id = $m[1][0] ?? '';
    return $id !== '' ? 'https://www.linkedin.com/in/' . $id . '/' : '';
}

/** "jane-smith-1a2b3c" -> "Jane Smith" — drops LinkedIn's trailing id segment
 *  (the last hyphen part when it's a hex-ish token containing a digit). */
function humanize_slug($slug) {
    $parts = explode('-', $slug);
    $lastIdx = count($parts) - 1;
    if ($lastIdx > 0 && preg_match('/[0-9]/', $parts[$lastIdx]) && preg_match('/^[a-f0-9]{4,}$/i', $parts[$lastIdx])) {
        array_pop($parts);
    }
    return ucwords(trim(str_replace('-', ' ', implode('-', $parts))));
}
