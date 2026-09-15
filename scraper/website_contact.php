<?php
/**
 * website_contact.php — best-effort contact EMAIL + PHONE for a company from
 * its own site. Google's Places API never returns an email and its SERP can't
 * be scraped server-side, but nearly everything those "site:example.com contact
 * / impressum / privacy" dork queries would surface actually lives on the
 * company's own domain — so we crawl it directly (no SERP, ToS-clean).
 *
 * We fetch the homepage plus the pages that conventionally carry contact
 * details (contact, about, get-in-touch, support and the legal/footer pages —
 * impressum, terms, privacy, legal), scrape mailto:/tel: links and inline
 * addresses/numbers, score the candidates, and return the best of each. Company
 * mailboxes (info@ / contact@ / sales@ ...) on the site's own domain win; asset
 * and tracking noise is filtered out.
 *
 * A random human-like stagger (default 1-15s, request-overridable) is inserted
 * BETWEEN page fetches so a multi-page crawl doesn't hammer the target. We stop
 * as soon as we have both a strong email and a phone, so most sites resolve in
 * one or two fetches with a single short delay.
 *
 * Usage:  GET website_contact.php?website=https://acme.co.uk[&stagger_min=1&stagger_max=15]
 * Output: { "found": true,
 *           "email": "info@acme.co.uk",  "email_source": "https://acme.co.uk/contact",
 *           "phone": "+44 20 7946 0958", "phone_source": "https://acme.co.uk" }
 *         { "found": false }
 */

header('Content-Type: application/json');
set_time_limit(0);

function out(array $data, int $code = 200): void {
    http_response_code($code);
    echo json_encode($data);
    exit;
}

$website = trim((string)($_GET['website'] ?? ''));
if ($website === '') out(['error' => 'website is required'], 400);
if (!preg_match('#^https?://#i', $website)) $website = 'https://' . $website;

$sMin = isset($_GET['stagger_min']) ? max(0.0, (float)$_GET['stagger_min']) : 1.0;
$sMax = isset($_GET['stagger_max']) ? max($sMin, (float)$_GET['stagger_max']) : 15.0;
$maxPages = 6; // hard cap so a no-result crawl can't run unbounded

$parts = parse_url($website);
if (empty($parts['host'])) out(['found' => false]);
$scheme = $parts['scheme'] ?? 'https';
$host   = $parts['host'];
$root   = $scheme . '://' . $host;
$domain = preg_replace('#^www\.#i', '', strtolower($host)); // acme.co.uk

// Ordered by yield: homepage + contact pages first, legal/footer pages last.
$paths = ['', '/contact', '/contact-us', '/about', '/get-in-touch', '/support',
          '/privacy', '/privacy-policy', '/terms', '/legal', '/impressum'];

$fetch = function (string $url): string {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS      => 4,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_USERAGENT      => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
        CURLOPT_HTTPHEADER     => ['Accept-Language: en-GB,en;q=0.9'],
    ]);
    $body = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return ($body !== false && $code >= 200 && $code < 400) ? (string)$body : '';
};

// ---- EMAIL scoring ---------------------------------------------------------
$emailJunk = function (string $email): bool {
    $email = strtolower($email);
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) return true;
    if (preg_match('#\.(png|jpe?g|gif|svg|webp|css|js|ico)$#i', $email)) return true;
    if (preg_match('#(example|sentry|wixpress|wix|godaddy|domain|yourcompany|email|user)\.(com|net|org|io)$#i', $email)) return true;
    if (preg_match('#@(2x|3x|sentry|localhost)#i', $email)) return true;
    return false;
};
$emailScore = function (string $email) use ($domain): int {
    $email = strtolower($email);
    [$local, $emailHost] = array_pad(explode('@', $email, 2), 2, '');
    $emailHost = preg_replace('#^www\.#i', '', $emailHost);
    $sameDomain = ($emailHost === $domain || str_ends_with($emailHost, '.' . $domain) || str_ends_with($domain, $emailHost));
    $roleLocal  = in_array($local, ['info', 'contact', 'hello', 'enquiries', 'enquiry', 'sales', 'support', 'admin', 'office', 'mail'], true);
    $s = 0;
    if ($sameDomain) $s += 100;
    if ($roleLocal)  $s += 40;
    if (!$sameDomain && preg_match('#@(gmail|outlook|hotmail|yahoo|icloud)\.#i', $email)) $s -= 20;
    return $s;
};

// ---- PHONE extraction ------------------------------------------------------
// Inline HTML is full of numbers that aren't phones — SVG path coords, CSS
// transforms, version strings, prices, dates. So we (a) prefer explicit tel:
// links, (b) strip script/style/svg before scanning text, (c) match only
// well-formed UK/intl groupings (space/hyphen separated, NO dots — dots are the
// telltale of coords/versions), and (d) validate the digit count.
$normPhone = function (string $raw): string {
    $raw = trim($raw);
    $plus = str_starts_with(ltrim(str_replace(['(', ' '], '', $raw)), '+');
    $digits = preg_replace('#\D+#', '', $raw);
    if ($digits === '') return '';
    if ($plus) {
        // strip a leading 00/ +: country-coded, 11-15 digits total.
        return (strlen($digits) >= 11 && strlen($digits) <= 15) ? '+' . $digits : '';
    }
    if (str_starts_with($digits, '00')) {
        return (strlen($digits) >= 13 && strlen($digits) <= 17) ? '+' . substr($digits, 2) : '';
    }
    // Bare UK number: leading 0, 10-11 digits total (020…, 0161…, 079…).
    if ($digits[0] === '0' && strlen($digits) >= 10 && strlen($digits) <= 11) return $digits;
    return '';
};
$phoneJunk = function (string $norm): bool {
    $d = ltrim($norm, '+');
    if (preg_match('#^(\d)\1+$#', $d)) return true;          // all one digit
    if (in_array($d, ['01234567890', '1234567890', '00000000000'], true)) return true;
    return false;
};
// A UK/intl phone as authors actually write it: optional +44/0 prefix, then
// 2-6 digit groups joined by a single space or hyphen (never a dot).
$phoneRe = '#(?<![\w.>])(\+44(?:\s?\(0\))?[\s-]?\d{2,4}(?:[\s-]\d{2,6}){1,3}|0\d{1,4}(?:[\s-]\d{2,6}){1,3})(?![\w.])#';

$bestEmail = ''; $bestEmailScore = -999; $bestEmailSrc = '';
$bestPhone = ''; $bestPhoneScore = -999; $bestPhoneSrc = '';
$seen = [];
$fetched = 0;

foreach ($paths as $idx => $p) {
    if ($fetched >= $maxPages) break;
    $url = $root . $p;
    if (isset($seen[$url])) continue;
    $seen[$url] = true;

    // Human-like stagger BETWEEN page requests (not before the first).
    if ($fetched > 0 && $sMax > 0) {
        usleep((int)(($sMin + (mt_rand(0, 1000) / 1000) * ($sMax - $sMin)) * 1_000_000));
    }

    $html = $fetch($url);
    $fetched++;
    if ($html === '') continue;

    // Decode \uXXXX escapes and HTML entities so '<' '>' '&' don't glue onto a
    // captured address/number (e.g. >help@x.com).
    $html = preg_replace_callback('/\\\\u([0-9a-fA-F]{4})/', static fn($m) => mb_convert_encoding(pack('H*', $m[1]), 'UTF-8', 'UTF-16BE'), $html);
    $html = html_entity_decode($html, ENT_QUOTES | ENT_HTML5, 'UTF-8');

    // -- emails --
    $emails = [];
    if (preg_match_all('#mailto:([^"\'?\s>]+)#i', $html, $m)) foreach ($m[1] as $e) $emails[] = rawurldecode($e);
    if (preg_match_all('#[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}#i', $html, $m2)) foreach ($m2[0] as $e) $emails[] = $e;
    foreach ($emails as $e) {
        $e = trim(rtrim($e, '.'));
        if ($emailJunk($e)) continue;
        $sc = $emailScore($e);
        if ($sc > $bestEmailScore) { $bestEmailScore = $sc; $bestEmail = strtolower($e); $bestEmailSrc = $url; }
    }

    // -- phones -- tel: links are highest confidence; inline is scanned only
    //    after stripping script/style/svg (the big sources of number noise).
    $phones = []; // [normalised, display, score]
    if (preg_match_all('#href=["\']?tel:([+0-9()\s.\-]{7,})#i', $html, $mt)) {
        foreach ($mt[1] as $raw) { $n = $normPhone($raw); if ($n !== '') $phones[] = [$n, trim(preg_replace('#\s+#', ' ', $raw)), 50]; }
    }
    $text = preg_replace('#<(script|style|svg|path|noscript)\b[^>]*>.*?</\1>#is', ' ', $html);
    $text = preg_replace('#<[^>]+>#', ' ', (string)$text); // drop remaining tags/attrs
    if (preg_match_all($phoneRe, (string)$text, $mi)) {
        foreach ($mi[1] as $raw) { $n = $normPhone($raw); if ($n !== '') $phones[] = [$n, trim(preg_replace('#\s+#', ' ', $raw)), 10]; }
    }
    foreach ($phones as [$norm, $disp, $score]) {
        if ($phoneJunk($norm)) continue;
        if ($score > $bestPhoneScore) { $bestPhoneScore = $score; $bestPhone = $disp !== '' ? $disp : $norm; $bestPhoneSrc = $url; }
    }

    // Got a same-domain mailbox AND a phone → nothing better to find, stop.
    if ($bestEmail !== '' && $bestEmailScore >= 100 && $bestPhone !== '') break;
}

if ($bestEmail === '' && $bestPhone === '') out(['found' => false]);
out([
    'found'        => true,
    'email'        => $bestEmail,
    'email_source' => $bestEmail !== '' ? $bestEmailSrc : '',
    'phone'        => $bestPhone,
    'phone_source' => $bestPhone !== '' ? $bestPhoneSrc : '',
]);
