<?php
/**
 * Companies House - newly registered UK companies (JSON endpoint)
 * ---------------------------------------------------------------
 * Call it like an API:
 *
 *   GET companies_house_api.php?days=7
 *   GET companies_house_api.php?days=0
 *   GET companies_house_api.php?days=30&sector=62012
 *   GET companies_house_api.php?days=14&sector=62012,62020&directors=1
 *
 * Query parameters
 *   days      integer 0..30  How many days back to look. 0 = today only,
 *                            7 = the last 7 days, etc. (default 1)
 *   sector    string (opt.)  One or more Companies House SIC codes,
 *                            comma-separated. Filters by industry.
 *   directors 0 | 1          Include director names (extra API call per
 *                            company, slower). Default 1.
 *   status    string (opt.)  Company status filter (default "active").
 *                            Pass "" via &status= to include all.
 *   limit     integer        Max companies to return (default 100 with
 *                            directors, 1000 without).
 *   start     integer        Pagination offset into the result set
 *                            (0, 100, 200, ...). Default 0.
 *
 * Response: a JSON array of objects, each shaped like:
 *   {
 *     "first_name":         "Jane",               // one row per director
 *     "middle_name":        "A",
 *     "last_name":          "Smith",
 *     "name":               "Jane A Smith",        // full name
 *     "company_name":       "ACME TRADING LTD",
 *     "registered_address": "1 High St, London, EC1A 1AA, England",
 *     "company_number":     "12345678",
 *     "sector_code":        "62012, 62020",        // raw SIC codes
 *     "sector":             "Business and domestic software development; ...",
 *     "sector_group":       "Information and communication",  // broad SIC section
 *     "registered":         "2026-07-07"           // date of incorporation
 *   }
 *
 * Sector names come from the bundled sic_codes.php lookup (must sit in the
 * same folder as this file).
 *
 * NOTE: Companies House does not publish email/phone, so those are not
 * available from this data source and are omitted.
 *
 * SETUP: register a free REST API key at
 *   https://developer.company-information.service.gov.uk/
 * then set it in $CH_API_KEY below (or the CH_API_KEY env var).
 *
 * Requires the cURL PHP extension (on by default in XAMPP).
 */

// ---------------------------------------------------------------------
// CONFIG
// ---------------------------------------------------------------------

// Companies House REST API key — MUST come from the env (never hardcode).
// Set CH_API_KEY in cms/.env locally and in cc/.env on the server.
$CH_API_KEY = (string)(getenv('CH_API_KEY') ?: ($_ENV['CH_API_KEY'] ?? ''));

// Environment must match how your application was registered on the
// Companies House developer hub:
//   'live' -> real data, use a LIVE Public Data API key
//   'test' -> sandbox, fake data only, use a TEST key
// A live key against the sandbox (or vice versa) returns 401.
$CH_ENV = getenv('CH_ENV') ?: 'live';

const CH_BASE_LIVE = 'https://api.company-information.service.gov.uk';
const CH_BASE_TEST = 'https://api-sandbox.company-information.service.gov.uk';
define('CH_BASE', $CH_ENV === 'test' ? CH_BASE_TEST : CH_BASE_LIVE);
const THROTTLE  = 0.6;   // seconds between calls (600 req / 5 min limit)
const PAGE_SIZE = 100;   // advanced-search page size (max 100)

// ---------------------------------------------------------------------
// OUTPUT AS JSON
// ---------------------------------------------------------------------

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');   // relax/remove if you don't want CORS

// This job makes many upstream calls; don't let PHP kill it at 120s.
set_time_limit(0);
ignore_user_abort(true);

function respond($data, $httpCode = 200) {
    http_response_code($httpCode);
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit;
}

function fail($msg, $httpCode = 400) {
    respond(['error' => $msg], $httpCode);
}

// ---------------------------------------------------------------------
// READ & VALIDATE INPUT
// ---------------------------------------------------------------------

if ($CH_API_KEY === 'PUT-YOUR-API-KEY-HERE' || $CH_API_KEY === '') {
    fail('Server not configured: no Companies House API key set.', 500);
}

// days: 0..30
$days = isset($_GET['days']) ? (int)$_GET['days'] : 1;
if ($days < 0)  $days = 0;
if ($days > 30) $days = 30;

// sector: comma-separated SIC codes (optional)
$sector = isset($_GET['sector']) ? trim($_GET['sector']) : '';
$sicCodes = [];
if ($sector !== '') {
    foreach (explode(',', $sector) as $c) {
        $c = preg_replace('/\D/', '', $c); // keep digits only
        if ($c !== '') $sicCodes[] = $c;
    }
}

$includeDirectors = isset($_GET['directors']) ? ($_GET['directors'] !== '0') : true;
$status = isset($_GET['status']) ? trim($_GET['status']) : 'active';

// How many companies to return in one call. Directors mode is rate-limited
// by Companies House, so keep the default modest and paginate with &start=.
$defaultLimit = $includeDirectors ? 100 : 1000;
$limit  = isset($_GET['limit']) ? max(1, (int)$_GET['limit']) : $defaultLimit;

// Pagination: where in the result set to begin (0, 100, 200, ...).
$start  = isset($_GET['start']) ? max(0, (int)$_GET['start']) : 0;

// mode: which phase to run. Splitting the two phases lets the CRM trigger
// them from separate buttons — a fast company pull first (Stage 1), then a
// slower per-company officer enrichment pass over stored numbers (Stage 2).
//   mode=companies -> Phase 1 only (company rows, no per-company calls)
//   mode=officers  -> Phase 2 only, over &numbers=12345678,SC098765
//   (no mode)      -> legacy combined behaviour (Phase 1 + optional Phase 2)
$mode = isset($_GET['mode']) ? strtolower(trim($_GET['mode'])) : '';

// numbers: company numbers to enrich in officers mode (comma-separated).
// CH numbers are alphanumeric (e.g. 12345678, SC123456), so keep alnum only.
$numbers = [];
if (isset($_GET['numbers'])) {
    foreach (explode(',', $_GET['numbers']) as $n) {
        $n = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $n));
        if ($n !== '') $numbers[] = $n;
    }
}

// mode=companies is a pure Stage 1 pull — never make per-company officer
// calls even if &directors=1 was passed.
if ($mode === 'companies') $includeDirectors = false;

$incorporatedFrom = date('Y-m-d', strtotime("-{$days} day"));
$incorporatedTo   = date('Y-m-d'); // today

// Parallel officer fetches per batch. 10 concurrent, paced below to stay
// under the Companies House limit of 600 requests / 5 minutes (2/sec).
const CONCURRENCY = 10;
const BATCH_PAUSE = 4.5; // seconds to wait after each batch of CONCURRENCY

// SIC code -> description/section lookup (sits next to this file).
$SIC_MAP = @include __DIR__ . '/sic_codes.php';
if (!is_array($SIC_MAP)) $SIC_MAP = [];

// SIC 2007 top-level sections (broad industry groups).
$SIC_SECTIONS = [
    'A' => 'Agriculture, Forestry and Fishing',
    'B' => 'Mining and Quarrying',
    'C' => 'Manufacturing',
    'D' => 'Electricity, gas, steam and air conditioning supply',
    'E' => 'Water supply, sewerage, waste management and remediation activities',
    'F' => 'Construction',
    'G' => 'Wholesale and retail trade; repair of motor vehicles and motorcycles',
    'H' => 'Transportation and storage',
    'I' => 'Accommodation and food service activities',
    'J' => 'Information and communication',
    'K' => 'Financial and insurance activities',
    'L' => 'Real estate activities',
    'M' => 'Professional, scientific and technical activities',
    'N' => 'Administrative and support service activities',
    'O' => 'Public administration and defence; compulsory social security',
    'P' => 'Education',
    'Q' => 'Human health and social work activities',
    'R' => 'Arts, entertainment and recreation',
    'S' => 'Other service activities',
    'T' => 'Activities of households as employers',
    'U' => 'Activities of extraterritorial organisations and bodies',
];

// ---------------------------------------------------------------------
// COMPANIES HOUSE HTTP HELPER
// ---------------------------------------------------------------------

function ch_get($path, $query = []) {
    global $CH_API_KEY;
    $url = CH_BASE . $path . ($query ? '?' . http_build_query($query) : '');

    $attempts = 0;
    while (true) {
        $attempts++;
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_USERPWD        => $CH_API_KEY . ':',  // key = username, no password
            CURLOPT_HTTPAUTH       => CURLAUTH_BASIC,
            CURLOPT_TIMEOUT        => 30,
            CURLOPT_HTTPHEADER     => ['Accept: application/json'],
        ]);
        $body   = curl_exec($ch);
        $code   = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err    = curl_error($ch);
        curl_close($ch);

        if ($body === false) {
            if ($attempts < 3) { sleep(2); continue; }
            fail("Upstream request failed: $err", 502);
        }
        if ($code === 429) {                      // rate limited
            if ($attempts < 5) { sleep(30); continue; }
            fail('Rate limited by Companies House (429).', 429);
        }
        if ($code === 401) fail('Invalid Companies House API key.', 500);
        if ($code === 404) return null;
        if ($code >= 400)  fail("Companies House returned HTTP $code.", 502);

        return json_decode($body, true);
    }
}

/**
 * Fetch several API paths in parallel with curl_multi.
 * $paths is an associative array [key => path]. Returns [key => decoded|null].
 */
function ch_get_parallel(array $paths) {
    global $CH_API_KEY;
    if (empty($paths)) return [];

    $mh = curl_multi_init();
    $handles = [];
    foreach ($paths as $key => $path) {
        $ch = curl_init(CH_BASE . $path);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_USERPWD        => $CH_API_KEY . ':',
            CURLOPT_HTTPAUTH       => CURLAUTH_BASIC,
            CURLOPT_TIMEOUT        => 30,
            CURLOPT_HTTPHEADER     => ['Accept: application/json'],
        ]);
        curl_multi_add_handle($mh, $ch);
        $handles[$key] = $ch;
    }

    do {
        $status = curl_multi_exec($mh, $running);
        if ($running) curl_multi_select($mh, 1.0);
    } while ($running && $status === CURLM_OK);

    $out = [];
    foreach ($handles as $key => $ch) {
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $body = curl_multi_getcontent($ch);
        $out[$key] = ($code >= 200 && $code < 300) ? json_decode($body, true) : null;
        curl_multi_remove_handle($mh, $ch);
        curl_close($ch);
    }
    curl_multi_close($mh);
    return $out;
}

// ---------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------

function format_address($addr) {
    if (!is_array($addr)) return '';
    $bits = [];
    foreach (['premises','address_line_1','address_line_2','locality',
              'region','postal_code','country'] as $k) {
        if (!empty($addr[$k])) $bits[] = $addr[$k];
    }
    return implode(', ', $bits);
}

// Map an array of SIC codes to their descriptions, joined for output.
function sic_names(array $codes, array $map) {
    $names = [];
    foreach ($codes as $code) {
        $code = str_pad(trim((string)$code), 5, '0', STR_PAD_LEFT);
        $names[] = $map[$code]['n'] ?? 'Unknown';
    }
    return implode('; ', $names);
}

// Map SIC codes to their broad SIC section names (deduped).
function sic_group(array $codes, array $map, array $sections) {
    $groups = [];
    foreach ($codes as $code) {
        $code = str_pad(trim((string)$code), 5, '0', STR_PAD_LEFT);
        $letter = $map[$code]['s'] ?? '';
        $name = $sections[$letter] ?? '';
        if ($name !== '' && !in_array($name, $groups, true)) $groups[] = $name;
    }
    return implode('; ', $groups);
}

/**
 * Split an officer record into first / middle / last name.
 * Companies House lists officers as "SURNAME, Forename Middle...".
 * Returns ['first'=>, 'middle'=>, 'last'=>, 'full'=>].
 */
function officer_name_parts($officer) {
    $raw = trim($officer['name'] ?? '');
    $first = $middle = $last = '';

    if ($raw === '') {
        return ['first' => '', 'middle' => '', 'last' => '', 'full' => ''];
    }

    if (strpos($raw, ',') !== false) {
        list($last, $fore) = array_map('trim', explode(',', $raw, 2));
    } else {
        // No comma: assume "Forename ... Surname".
        $parts = preg_split('/\s+/', $raw);
        $last  = array_pop($parts);
        $fore  = implode(' ', $parts);
    }

    $foreParts = $fore === '' ? [] : preg_split('/\s+/', $fore);
    if (!empty($foreParts)) {
        $first  = array_shift($foreParts);
        $middle = implode(' ', $foreParts);
    }

    $full = trim(trim("$first $middle") . " $last");
    return ['first' => $first, 'middle' => $middle, 'last' => $last, 'full' => $full];
}

/**
 * Fetch active directors for a set of company numbers, in parallel batches
 * paced under the Companies House rate limit. Shared by officers mode and
 * the legacy combined path so there is a single officer-fetch code path.
 *
 * Returns [ companyNumber => [ [first,middle,last,full,role,appointed_on,
 * occupation,nationality,address], ... ] ] — one entry per company number
 * given (empty array when a company has no listed active directors).
 */
function fetch_officers(array $numbers) {
    $result = [];
    foreach (array_chunk(array_values(array_unique($numbers)), CONCURRENCY) as $chunk) {
        $paths = [];
        foreach ($chunk as $num) {
            $paths[$num] = "/company/{$num}/officers?items_per_page=100";
        }
        $responses = ch_get_parallel($paths);

        foreach ($chunk as $num) {
            $people = [];
            foreach (($responses[$num]['items'] ?? []) as $officer) {
                $role = strtolower($officer['officer_role'] ?? '');
                if (strpos($role, 'director') === false) continue; // directors only
                if (!empty($officer['resigned_on']))  continue;    // active only
                $parts = officer_name_parts($officer);
                $people[] = [
                    'first'        => $parts['first'],
                    'middle'       => $parts['middle'],
                    'last'         => $parts['last'],
                    'full'         => $parts['full'],
                    'role'         => $officer['officer_role']          ?? '',
                    'appointed_on' => $officer['appointed_on']          ?? '',
                    'occupation'   => $officer['occupation']            ?? '',
                    'nationality'  => $officer['nationality']           ?? '',
                    'address'      => format_address($officer['address'] ?? []),
                ];
            }
            $result[$num] = $people;
        }

        // Pace batches to respect the 600-requests / 5-minute rate limit.
        usleep((int)(BATCH_PAUSE * 1_000_000));
    }
    return $result;
}

// ---------------------------------------------------------------------
// MODE=OFFICERS — Stage 2 standalone: officers for the given &numbers,
// keyed by company number. Runs no company search, so the CRM can enrich
// a chunk of already-stored companies per click.
// ---------------------------------------------------------------------
if ($mode === 'officers') {
    if (empty($numbers)) {
        fail('officers mode requires &numbers=comma,separated,company,numbers', 400);
    }
    respond(fetch_officers($numbers));
}

// mode=match — find the Companies House company that best matches a name we
// already have (e.g. from LinkedIn), so we can backfill the number, registered
// address, SIC codes and (via a follow-up officers call) directors.
//   ?mode=match&name=ACME+LTD&location=London
if ($mode === 'match') {
    $q = trim((string)($_GET['name'] ?? $_GET['q'] ?? ''));
    if ($q === '') fail('match mode requires &name=', 400);
    $loc = strtolower(trim((string)($_GET['location'] ?? '')));

    // Normalise a name for comparison: upper-case, strip punctuation and the
    // common legal-form suffixes so "Storm2" ~ "STORM2 LIMITED".
    $norm = function ($s) {
        $s = strtoupper((string)$s);
        $s = preg_replace('/[^A-Z0-9 ]+/', ' ', $s);
        $s = preg_replace('/\b(LIMITED|LTD|PLC|LLP|LLC|THE|CO)\b/', ' ', $s);
        return trim(preg_replace('/\s+/', ' ', $s));
    };
    $qn = $norm($q);

    $res = ch_get('/search/companies', ['q' => $q, 'items_per_page' => 20]);
    $items = $res['items'] ?? [];
    $best = null; $bestScore = 0;
    foreach ($items as $it) {
        $tn = $norm($it['title'] ?? '');
        $score = 0;
        if ($qn !== '' && $tn === $qn) $score = 100;
        elseif ($qn !== '' && $tn !== '' && (strpos($tn, $qn) !== false || strpos($qn, $tn) !== false)) $score = 78;
        else {
            $qt = array_filter(explode(' ', $qn)); $tt = array_filter(explode(' ', $tn));
            if ($qt && $tt) $score = (int)round(100 * count(array_intersect($qt, $tt)) / max(count($qt), count($tt)));
        }
        if (($it['company_status'] ?? '') === 'active') $score += 8;
        $snip = strtolower($it['address_snippet'] ?? '');
        if ($loc !== '' && $snip !== '' && strpos($snip, $loc) !== false) $score += 10;
        if ($score > $bestScore) { $bestScore = $score; $best = $it; }
    }

    // Require a confident match — never attach the wrong company.
    if (!$best || $bestScore < 65) respond(['matched' => false, 'score' => $bestScore, 'query' => $q]);

    $num  = $best['company_number'] ?? '';
    $prof = $num !== '' ? ch_get('/company/' . rawurlencode($num)) : null;
    $codes = $prof['sic_codes'] ?? [];
    respond([
        'matched'            => true,
        'score'              => $bestScore,
        'company_number'     => $num,
        'company_name'       => $best['title'] ?? ($prof['company_name'] ?? ''),
        'registered_address' => $prof ? format_address($prof['registered_office_address'] ?? []) : ($best['address_snippet'] ?? ''),
        'sector_code'        => implode(', ', $codes),
        'sector'             => sic_names($codes, $SIC_MAP),
        'sector_group'       => sic_group($codes, $SIC_MAP, $SIC_SECTIONS),
        'registered'         => $prof['date_of_creation'] ?? ($best['date_of_creation'] ?? ''),
        'company_status'     => $prof['company_status'] ?? ($best['company_status'] ?? ''),
        'company_type'       => $prof['type'] ?? ($best['company_type'] ?? ''),
    ]);
}

// ---------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------

// ---- Phase 1: collect matching companies (fast; no per-company calls) ----
$companies  = [];
$startIndex = $start;
$total      = 0;

while (count($companies) < $limit) {
    $params = [
        'incorporated_from' => $incorporatedFrom,
        'incorporated_to'   => $incorporatedTo,
        'size'              => PAGE_SIZE,
        'start_index'       => $startIndex,
    ];
    if ($status !== '')    $params['company_status'] = $status;
    if (!empty($sicCodes)) $params['sic_codes']      = implode(',', $sicCodes);

    $result = ch_get('/advanced-search/companies', $params);
    $items  = $result['items'] ?? [];
    $total  = $result['hits']  ?? 0;

    if (empty($items)) break;

    foreach ($items as $co) {
        if (count($companies) >= $limit) break;
        $codes = $co['sic_codes'] ?? [];
        $companies[] = [
            'first_name'         => '',
            'middle_name'        => '',
            'last_name'          => '',
            'name'               => '',
            'company_name'       => $co['company_name']   ?? '',
            'registered_address' => format_address($co['registered_office_address'] ?? []),
            'company_number'     => $co['company_number'] ?? '',
            'sector_code'        => implode(', ', $codes),
            'sector'             => sic_names($codes, $SIC_MAP),
            'sector_group'       => sic_group($codes, $SIC_MAP, $SIC_SECTIONS),
            'registered'         => $co['date_of_creation'] ?? '',
        ];
    }

    $startIndex += PAGE_SIZE;
    if ($startIndex >= $total) break;
    usleep((int)(THROTTLE * 1_000_000));
}

// ---- Phase 2: fetch directors in parallel batches (optional) ----
$out = [];

if (!$includeDirectors) {
    $out = $companies; // company-only rows, "name" left blank
} else {
    // Index companies by number so we can attach officer results.
    $byNumber = [];
    foreach ($companies as $c) {
        if ($c['company_number'] !== '') $byNumber[$c['company_number']] = $c;
    }

    $officersByNum = fetch_officers(array_keys($byNumber));

    foreach ($byNumber as $num => $base) {
        $people = $officersByNum[$num] ?? [];
        if (empty($people)) {
            $people = [['first' => '', 'middle' => '', 'last' => '', 'full' => '']];
        }
        foreach ($people as $p) {
            $row = $base;
            $row['first_name']  = $p['first'];
            $row['middle_name'] = $p['middle'];
            $row['last_name']   = $p['last'];
            $row['name']        = $p['full'];
            $out[] = $row;
        }
    }
}

respond($out);
