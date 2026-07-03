<?php
/**
 * ============================================================
 * LEAD GEN - UK TENDER AGGREGATOR
 * ------------------------------------------------------------
 * Sources: Find a Tender + Contracts Finder (official OCDS APIs)
 * No caching - fetches fresh and echoes JSON every time.
 *
 * USAGE:
 *   tenders.php                     -> last 1 day
 *   tenders.php?days=7              -> last 7 days
 *   tenders.php?pretty=1            -> pretty JSON
 *   tenders.php?cpv=85,80           -> raw CPV prefix filter
 *   tenders.php?q=council           -> keyword in title/desc/buyer
 *   tenders.php?type=website        -> friendly type filter
 *   tenders.php?type=website,crm    -> multiple types (OR)
 *   tenders.php?types=1             -> list available types + counts
 * ============================================================
 */

// Show errors on screen instead of a blank page (turn off in production)
ini_set('display_errors', '1');
ini_set('display_startup_errors', '1');
error_reporting(E_ALL);

// ---------------- CONFIG ----------------
define('DEFAULT_DAYS', 1);
define('MAX_DAYS',     30);
define('HTTP_TIMEOUT', 30);
define('MAX_PAGES',    20);
define('USER_AGENT',   'BuiltRightStudio-LeadGen/1.0 (tender aggregator)');

/**
 * Friendly type -> CPV prefixes.
 * A tender gets a type if ANY of its CPV codes starts with ANY prefix.
 */
function typeMap()
{
    return array(
        'website'         => array('72413', '72420', '72421', '72422'),
        'ecommerce'       => array('48451', '72416'),
        'crm'             => array('48445', '72212445'),
        'software-dev'    => array('72212', '72230', '72240', '72250'),
        'software'        => array('48'),
        'app-mobile'      => array('48517', '72212517'),
        'it-services'     => array('72'),
        'hosting-cloud'   => array('72415', '72417', '72318', '72300'),
        'data-analytics'  => array('72316', '72320', '48600'),
        'cyber-security'  => array('72212732', '48730', '79714'),
        'seo-marketing'   => array('79340', '79341', '79342', '79413'),
        'design-creative' => array('79822500', '79930', '92312'),
        'media-video'     => array('92100', '92110', '79960'),
        'print'           => array('79800', '79810', '79820'),
        'telecoms'        => array('64200', '32500'),
        'hardware'        => array('30200', '30210', '48820'),
        'training'        => array('80500', '80510', '80533'),
        'consultancy'     => array('79400', '79410', '72220'),
        'construction'    => array('45'),
        'healthcare'      => array('85'),
        'education'       => array('80'),
        'environment'     => array('90'),
        'grounds-fm'      => array('77', '50700', '79993'),
        'transport'       => array('60'),
        'catering'        => array('55'),
        'security-guard'  => array('79710', '79713'),
    );
}

/** Derive friendly types for a set of CPV codes */
function deriveTypes($cpvCodes)
{
    $types = array();
    foreach (typeMap() as $type => $prefixes) {
        $matched = false;
        foreach ($cpvCodes as $code) {
            foreach ($prefixes as $prefix) {
                if (strpos($code, $prefix) === 0) { $matched = true; break 2; }
            }
        }
        if ($matched) $types[] = $type;
    }
    return $types;
}

// ---------------- BOOTSTRAP ----------------
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');

$days       = isset($_GET['days'])  ? max(1, min(MAX_DAYS, (int)$_GET['days'])) : DEFAULT_DAYS;
$pretty     = isset($_GET['pretty']) && $_GET['pretty'] == '1';
$cpvFilter  = isset($_GET['cpv'])  ? array_filter(array_map('trim', explode(',', $_GET['cpv']))) : array();
$typeFilter = isset($_GET['type']) ? array_filter(array_map('trim', explode(',', strtolower($_GET['type'])))) : array();
$keyword    = isset($_GET['q'])    ? trim($_GET['q']) : '';
$listTypes  = isset($_GET['types']) && $_GET['types'] == '1';

$jsonFlags = ($pretty ? JSON_PRETTY_PRINT : 0) | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE;

// ---------------- DATE WINDOW ----------------
$tz   = new DateTimeZone('Europe/London');
$to   = new DateTime('now', $tz);
$from = clone $to;
$from->modify('-' . $days . ' day')->setTime(0, 0, 0);

// ---------------- FETCH ----------------
$errors = array();
$byOcid = array();

foreach (fetchFindATender($from, $to, $errors) as $release) {
    $t = normaliseRelease($release, 'find-a-tender');
    if ($t) $byOcid[$t['id']] = $t;
}
foreach (fetchContractsFinder($from, $to, $errors) as $release) {
    $t = normaliseRelease($release, 'contracts-finder');
    if ($t && !isset($byOcid[$t['id']])) $byOcid[$t['id']] = $t;
}

$tenders = array_values($byOcid);
usort($tenders, function ($a, $b) {
    $pa = isset($a['publishedDate']) ? $a['publishedDate'] : '';
    $pb = isset($b['publishedDate']) ? $b['publishedDate'] : '';
    return strcmp($pb, $pa);
});

// ---------------- ?types=1 : list types with counts ----------------
if ($listTypes) {
    $counts = array_fill_keys(array_keys(typeMap()), 0);
    foreach ($tenders as $t) {
        foreach ($t['types'] as $type) $counts[$type]++;
    }
    arsort($counts);
    echo json_encode(array(
        'meta'  => array(
            'window'       => array('from' => $from->format(DATE_ATOM), 'to' => $to->format(DATE_ATOM)),
            'totalTenders' => count($tenders),
            'errors'       => $errors,
        ),
        'types' => $counts,
    ), $jsonFlags);
    exit;
}

// ---------------- FILTERS ----------------
if ($typeFilter) {
    $tenders = array_values(array_filter($tenders, function ($t) use ($typeFilter) {
        return count(array_intersect($typeFilter, $t['types'])) > 0;
    }));
}
if ($cpvFilter) {
    $tenders = array_values(array_filter($tenders, function ($t) use ($cpvFilter) {
        foreach ($t['cpvCodes'] as $code) {
            foreach ($cpvFilter as $prefix) {
                if (strpos($code, $prefix) === 0) return true;
            }
        }
        return false;
    }));
}
if ($keyword !== '') {
    $kw = mb_strtolower($keyword);
    $tenders = array_values(array_filter($tenders, function ($t) use ($kw) {
        $buyerName = (isset($t['buyer']['name']) && $t['buyer']['name']) ? $t['buyer']['name'] : '';
        $hay = mb_strtolower($t['title'] . ' ' . $t['description'] . ' ' . $buyerName);
        return mb_strpos($hay, $kw) !== false;
    }));
}

// ---------------- OUTPUT ----------------
$out = json_encode(array(
    'meta' => array(
        'generatedAt' => $to->format(DATE_ATOM),
        'window'      => array('from' => $from->format(DATE_ATOM), 'to' => $to->format(DATE_ATOM)),
        'count'       => count($tenders),
        'sources'     => array('find-a-tender', 'contracts-finder'),
        'filters'     => array('type' => $typeFilter, 'cpv' => $cpvFilter, 'q' => $keyword),
        'errors'      => $errors,
    ),
    'tenders' => $tenders,
), $jsonFlags);

if ($out === false) {
    // Never output a blank screen - report why encoding failed
    echo json_encode(array('error' => 'json_encode failed: ' . json_last_error_msg()));
    exit;
}
echo $out;
exit;


/* ============================================================
 * SOURCE 1: FIND A TENDER
 * ============================================================ */
function fetchFindATender($from, $to, &$errors)
{
    $releases = array();
    $url = 'https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?' . http_build_query(array(
        'updatedFrom' => $from->format('Y-m-d\TH:i:s'),
        'updatedTo'   => $to->format('Y-m-d\TH:i:s'),
        'stages'      => 'tender',
        'limit'       => 100,
    ));

    for ($page = 0; $url && $page < MAX_PAGES; $page++) {
        $data = httpGetJson($url, $errors, 'find-a-tender');
        if ($data === null) break;
        if (isset($data['releases']) && is_array($data['releases'])) {
            foreach ($data['releases'] as $r) $releases[] = $r;
        }
        $url = isset($data['links']['next']) ? $data['links']['next'] : null;
    }
    return $releases;
}

/* ============================================================
 * SOURCE 2: CONTRACTS FINDER
 * ============================================================ */
function fetchContractsFinder($from, $to, &$errors)
{
    $releases = array();
    $url = 'https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search?' . http_build_query(array(
        'publishedFrom' => $from->format('Y-m-d\TH:i:s'),
        'publishedTo'   => $to->format('Y-m-d\TH:i:s'),
        'stages'        => 'tender',
        'size'          => 100,
    ));

    for ($page = 0; $url && $page < MAX_PAGES; $page++) {
        $data = httpGetJson($url, $errors, 'contracts-finder');
        if ($data === null) break;
        if (isset($data['results']) && is_array($data['results'])) {
            foreach ($data['results'] as $pkg) {
                if (isset($pkg['releases']) && is_array($pkg['releases'])) {
                    foreach ($pkg['releases'] as $r) $releases[] = $r;
                }
            }
        }
        $url = isset($data['links']['next']) ? $data['links']['next'] : null;
    }
    return $releases;
}

/* ============================================================
 * NORMALISER
 * ============================================================ */
function normaliseRelease($r, $source)
{
    if (!isset($r['tender']) || !is_array($r['tender'])) return null;
    $tender = $r['tender'];

    $status = isset($tender['status']) ? strtolower($tender['status']) : '';
    if (!in_array($status, array('active', 'planned', ''), true)) return null;

    if (empty($r['ocid'])) return null;
    $ocid     = $r['ocid'];
    $noticeId = isset($r['id']) ? $r['id'] : null;

    /* ---------- PARTIES ---------- */
    $buyer   = null;
    $parties = array();
    if (isset($r['parties']) && is_array($r['parties'])) {
        foreach ($r['parties'] as $p) {
            $party = array(
                'name'    => g($p, 'name'),
                'id'      => g($p, 'id'),
                'roles'   => isset($p['roles']) ? $p['roles'] : array(),
                'contact' => array(
                    'name'  => g($p, 'contactPoint', 'name'),
                    'email' => g($p, 'contactPoint', 'email'),
                    'phone' => g($p, 'contactPoint', 'telephone'),
                    'url'   => g($p, 'contactPoint', 'url'),
                ),
                'address' => array(
                    'street'   => g($p, 'address', 'streetAddress'),
                    'locality' => g($p, 'address', 'locality'),
                    'region'   => g($p, 'address', 'region'),
                    'postcode' => g($p, 'address', 'postalCode'),
                    'country'  => g($p, 'address', 'countryName') !== null ? g($p, 'address', 'countryName') : g($p, 'address', 'country'),
                ),
                'website'    => g($p, 'details', 'url'),
                'buyerType'  => g($p, 'details', 'classifications', 0, 'description'),
                'identifier' => array(
                    'scheme' => g($p, 'identifier', 'scheme'),
                    'id'     => g($p, 'identifier', 'id'),
                ),
            );
            $parties[] = $party;
            if (!$buyer && in_array('buyer', $party['roles'], true)) $buyer = $party;
        }
    }
    if (!$buyer && g($r, 'buyer', 'name') !== null) {
        $buyer = array('name' => g($r, 'buyer', 'name'), 'id' => g($r, 'buyer', 'id'),
                       'roles' => array('buyer'), 'contact' => null, 'address' => null,
                       'website' => null, 'buyerType' => null, 'identifier' => null);
    }

    /* ---------- LOTS ---------- */
    $rawLots = (isset($tender['lots']) && is_array($tender['lots'])) ? $tender['lots'] : array();
    $lots = array();
    foreach ($rawLots as $lot) {
        $criteria = array();
        $rawCriteria = g($lot, 'awardCriteria', 'criteria');
        if (is_array($rawCriteria)) {
            foreach ($rawCriteria as $c) {
                $weight = g($c, 'numbers', 0, 'number');
                if ($weight === null) $weight = g($c, 'weight');
                $criteria[] = array(
                    'type'        => g($c, 'type'),
                    'name'        => g($c, 'name'),
                    'weight'      => $weight,
                    'description' => g($c, 'description'),
                );
            }
        }
        $lots[] = array(
            'id'          => g($lot, 'id'),
            'title'       => g($lot, 'title'),
            'description' => g($lot, 'description'),
            'value'       => array(
                'amount'   => g($lot, 'value', 'amount'),
                'currency' => g($lot, 'value', 'currency') !== null ? g($lot, 'value', 'currency') : 'GBP',
            ),
            'contractPeriod' => array(
                'start' => g($lot, 'contractPeriod', 'startDate'),
                'end'   => g($lot, 'contractPeriod', 'endDate'),
                'days'  => g($lot, 'contractPeriod', 'durationInDays'),
            ),
            'suitableForSME'  => g($lot, 'suitability', 'sme'),
            'suitableForVCSE' => g($lot, 'suitability', 'vcse'),
            'awardCriteria'   => $criteria,
            'hasRenewal'      => g($lot, 'hasRenewal'),
            'renewal'         => g($lot, 'renewal', 'description'),
            'hasOptions'      => g($lot, 'hasOptions'),
            'options'         => g($lot, 'options', 'description'),
        );
    }

    /* ---------- AGGREGATES with lot fallback ---------- */
    $deadline      = firstOf(g($tender, 'tenderPeriod', 'endDate'),          firstLotValue($rawLots, array('tenderPeriod', 'endDate')));
    $enquiryEnd    = firstOf(g($tender, 'enquiryPeriod', 'endDate'),         firstLotValue($rawLots, array('enquiryPeriod', 'endDate')));
    $contractStart = firstOf(g($tender, 'contractPeriod', 'startDate'),      firstLotValue($rawLots, array('contractPeriod', 'startDate')));
    $contractEnd   = firstOf(g($tender, 'contractPeriod', 'endDate'),        firstLotValue($rawLots, array('contractPeriod', 'endDate')));
    $contractDays  = firstOf(g($tender, 'contractPeriod', 'durationInDays'), firstLotValue($rawLots, array('contractPeriod', 'durationInDays')));
    $valueAmount   = firstOf(g($tender, 'value', 'amount'),                  firstLotValue($rawLots, array('value', 'amount')));
    $smeSuitable   = firstOf(g($tender, 'suitability', 'sme'),               firstLotValue($rawLots, array('suitability', 'sme')));
    $vcseSuitable  = firstOf(g($tender, 'suitability', 'vcse'),              firstLotValue($rawLots, array('suitability', 'vcse')));

    /* ---------- CPV codes ---------- */
    $cpv = array();
    if (g($tender, 'classification', 'id') !== null) $cpv[] = g($tender, 'classification', 'id');
    if (isset($tender['additionalClassifications']) && is_array($tender['additionalClassifications'])) {
        foreach ($tender['additionalClassifications'] as $c) {
            if (!empty($c['id'])) $cpv[] = $c['id'];
        }
    }
    $items = (isset($tender['items']) && is_array($tender['items'])) ? $tender['items'] : array();
    foreach ($items as $item) {
        if (g($item, 'classification', 'id') !== null) $cpv[] = g($item, 'classification', 'id');
        if (isset($item['additionalClassifications']) && is_array($item['additionalClassifications'])) {
            foreach ($item['additionalClassifications'] as $c) {
                if (!empty($c['id'])) $cpv[] = $c['id'];
            }
        }
    }
    $cpv = array_values(array_unique($cpv));

    /* ---------- Regions & delivery ---------- */
    $regions = array();
    $deliveryAddresses = array();
    foreach ($items as $item) {
        if (isset($item['deliveryAddresses']) && is_array($item['deliveryAddresses'])) {
            foreach ($item['deliveryAddresses'] as $addr) {
                if (!empty($addr['region'])) $regions[] = $addr['region'];
                $entry = array_filter(array(
                    'street'   => g($addr, 'streetAddress'),
                    'locality' => g($addr, 'locality'),
                    'region'   => g($addr, 'region'),
                    'postcode' => g($addr, 'postalCode'),
                ));
                if ($entry) $deliveryAddresses[] = $entry;
            }
        }
        if (isset($item['deliveryLocations']) && is_array($item['deliveryLocations'])) {
            foreach ($item['deliveryLocations'] as $loc) {
                if (!empty($loc['description'])) $deliveryAddresses[] = array('description' => $loc['description']);
            }
        }
    }
    $regions = array_values(array_unique($regions));

    /* ---------- Documents ---------- */
    $documents = array();
    if (isset($tender['documents']) && is_array($tender['documents'])) {
        foreach ($tender['documents'] as $d) {
            if (empty($d['url'])) continue;
            $documents[] = array(
                'title'       => g($d, 'title'),
                'type'        => g($d, 'documentType'),
                'description' => g($d, 'description'),
                'url'         => $d['url'],
                'format'      => g($d, 'format'),
                'language'    => g($d, 'language'),
                'published'   => g($d, 'datePublished'),
            );
        }
    }

    /* ---------- Milestones ---------- */
    $milestones = array();
    if (isset($tender['milestones']) && is_array($tender['milestones'])) {
        foreach ($tender['milestones'] as $m) {
            $milestones[] = array(
                'type'    => g($m, 'type'),
                'title'   => g($m, 'title'),
                'dueDate' => g($m, 'dueDate'),
            );
        }
    }

    /* ---------- Submission & participation ---------- */
    $submission = array(
        'methods'           => g($tender, 'submissionMethod'),
        'url'               => g($tender, 'submissionMethodDetails'),
        'electronicAuction' => g($tender, 'techniques', 'hasElectronicAuction'),
        'languages'         => g($tender, 'submissionTerms', 'languages'),
        'variantPolicy'     => g($tender, 'submissionTerms', 'variantPolicy'),
    );
    $participation = array(
        'fees'                  => g($tender, 'participationFees'),
        'reservedParticipation' => g($tender, 'otherRequirements', 'reservedParticipation'),
        'minimumCandidates'     => g($tender, 'secondStage', 'minimumCandidates'),
    );

    /* ---------- Criteria (top level) ---------- */
    $selectionCriteria = array();
    $rawSel = g($tender, 'selectionCriteria', 'criteria');
    if (is_array($rawSel)) {
        foreach ($rawSel as $c) {
            $selectionCriteria[] = array('type' => g($c, 'type'), 'description' => g($c, 'description'));
        }
    }
    $awardCriteria = array();
    $rawAward = g($tender, 'awardCriteria', 'criteria');
    if (is_array($rawAward)) {
        foreach ($rawAward as $c) {
            $awardCriteria[] = array('type' => g($c, 'type'), 'name' => g($c, 'name'), 'description' => g($c, 'description'));
        }
    }

    /* ---------- Framework ---------- */
    $framework = null;
    if (g($tender, 'techniques', 'hasFrameworkAgreement')) {
        $framework = array(
            'isFramework'     => true,
            'method'          => g($tender, 'techniques', 'frameworkAgreement', 'method'),
            'periodEnd'       => g($tender, 'techniques', 'frameworkAgreement', 'period', 'endDate'),
            'maxParticipants' => g($tender, 'techniques', 'frameworkAgreement', 'maximumParticipants'),
            'description'     => g($tender, 'techniques', 'frameworkAgreement', 'description'),
        );
    }

    /* ---------- Link ---------- */
    if ($source === 'find-a-tender') {
        $link = $noticeId ? 'https://www.find-tender.service.gov.uk/Notice/' . rawurlencode($noticeId) : null;
    } else {
        $link = 'https://www.contractsfinder.service.gov.uk/notice/' . rawurlencode(str_replace('ocds-b5fd17-', '', $ocid));
    }

    return array(
        'id'                => $ocid,
        'noticeId'          => $noticeId,
        'source'            => $source,
        'noticeType'        => isset($r['tag']) ? implode(',', (array)$r['tag']) : '',
        'language'          => g($r, 'language'),
        'title'             => isset($tender['title']) ? $tender['title'] : '',
        'description'       => isset($tender['description']) ? $tender['description'] : '',
        'status'            => $status !== '' ? $status : 'unknown',
        'types'             => deriveTypes($cpv),
        'buyer'             => $buyer,
        'parties'           => $parties,
        'value'             => array(
            'amount'   => $valueAmount,
            'currency' => g($tender, 'value', 'currency') !== null ? g($tender, 'value', 'currency') : 'GBP',
        ),
        'cpvCodes'          => $cpv,
        'mainCategory'      => g($tender, 'mainProcurementCategory'),
        'regions'           => $regions,
        'deliveryAddresses' => $deliveryAddresses,
        'publishedDate'     => g($r, 'date'),
        'deadline'          => $deadline,
        'enquiryDeadline'   => $enquiryEnd,
        'contractStart'     => $contractStart,
        'contractEnd'       => $contractEnd,
        'contractDays'      => $contractDays,
        'procedureType'     => g($tender, 'procurementMethodDetails') !== null ? g($tender, 'procurementMethodDetails') : g($tender, 'procurementMethod'),
        'legalBasis'        => g($tender, 'legalBasis', 'id'),
        'coveredByGPA'      => is_array(g($tender, 'coveredBy')) && in_array('GPA', g($tender, 'coveredBy'), true),
        'suitableForSME'    => $smeSuitable,
        'suitableForVCSE'   => $vcseSuitable,
        'framework'         => $framework,
        'lots'              => $lots,
        'lotCount'          => count($lots),
        'milestones'        => $milestones,
        'selectionCriteria' => $selectionCriteria,
        'awardCriteria'     => $awardCriteria,
        'submission'        => $submission,
        'participation'     => $participation,
        'link'              => $link,
        'documents'         => $documents,
    );
}

/* ---------- helpers ---------- */

/** Safe nested getter: g($arr, 'a', 'b', 0, 'c') -> value or null */
function g($arr)
{
    $keys = func_get_args();
    array_shift($keys);
    $v = $arr;
    foreach ($keys as $key) {
        if (!is_array($v) || !array_key_exists($key, $v)) return null;
        $v = $v[$key];
    }
    return $v;
}

/** First non-null argument */
function firstOf($a, $b)
{
    return $a !== null ? $a : $b;
}

/** First non-null value at $path across all lots */
function firstLotValue($lots, $path)
{
    foreach ($lots as $lot) {
        $v = $lot;
        foreach ($path as $key) {
            if (!is_array($v) || !array_key_exists($key, $v)) { $v = null; break; }
            $v = $v[$key];
        }
        if ($v !== null) return $v;
    }
    return null;
}

/** Recursively replace INF/NaN floats (from malformed source numbers) with null */
function sanitizeNumbers($v)
{
    if (is_array($v)) {
        foreach ($v as $k => $item) {
            $v[$k] = sanitizeNumbers($item);
        }
        return $v;
    }
    if (is_float($v) && !is_finite($v)) {
        return null;
    }
    return $v;
}

/* ============================================================
 * HTTP HELPER
 * ============================================================ */
function httpGetJson($url, &$errors, $label)
{
    $ch = curl_init($url);
    curl_setopt_array($ch, array(
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT        => HTTP_TIMEOUT,
        CURLOPT_USERAGENT      => USER_AGENT,
        CURLOPT_HTTPHEADER     => array('Accept: application/json'),
        CURLOPT_SSL_VERIFYPEER => true,
    ));
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);

    if ($body === false || $code >= 400) {
        $errors[] = array('source' => $label, 'url' => $url, 'httpCode' => $code, 'error' => $err !== '' ? $err : 'HTTP ' . $code);
        return null;
    }
    $data = json_decode($body, true);
    if (!is_array($data)) {
        $errors[] = array('source' => $label, 'url' => $url, 'error' => 'Invalid JSON response');
        return null;
    }
    return sanitizeNumbers($data);
}