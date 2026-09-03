<?php
declare(strict_types=1);

use BRS\Auth;
use BRS\Db;
use BRS\Json;

/*
 * Company leads — the Companies House enrichment pipeline's own staging area,
 * kept OUT of `leads` until a finished record is explicitly promoted. Stages
 * 1-5 write here; promote copies the record into `leads` (mirrors the
 * tender_leads -> tenders promote pattern) and removes it from the pipeline.
 *
 *   GET    /api/company-leads             list (optional ?stage= &q=)
 *   GET    /api/company-leads/pipeline    per-stage counts
 *   POST   /api/company-leads/fetch       Stage 1 (Companies House pull)
 *   POST   /api/company-leads/officers    Stage 2 (directors)
 *   POST   /api/company-leads/profiles    Stage 3 (Google Business)
 *   POST   /api/company-leads/staff       Stage 5 (LinkedIn)
 *   GET    /api/company-leads/:id         record + info + contacts
 *   POST   /api/company-leads/:id/promote create a leads row, drop the pipeline record
 *   DELETE /api/company-leads/:id         remove one
 *   DELETE /api/company-leads             purge all (tenant-scoped)
 *   POST   /api/company-leads/qualify     bundled pass — runs every step per record
 *   POST   /api/company-leads/:id/officers|google|linkedin|domain|contact
 *                                         one isolated enrichment step on a single
 *                                         record (reusable from any section)
 *   GET    /api/company-leads/all         unified Lead Gen list (consolidated)
 *   POST   /api/company-leads/promote-bulk  promote consolidated groups to leads
 */

/*
 * ---- Lead Gen consolidation helpers ----------------------------------
 *
 * The Lead Gen list unions `company_leads` and `leads`, so the same company
 * can appear more than once: pulled from Companies House, scraped again off
 * LinkedIn, and typed in by hand. These normalise the two fields we group on.
 */

/** Company number reduced to its comparable core (case/space/punctuation-free). */
function brs_lg_norm_number(?string $s): string
{
    $s = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', (string)$s));
    return $s === '' ? '' : $s;
}

/**
 * Company name reduced for comparison: lowercased, punctuation dropped,
 * whitespace collapsed, and the usual UK suffixes removed so
 * "Malik1 Barbers Ltd" and "MALIK1 BARBERS LIMITED" group together.
 */
function brs_lg_norm_name(?string $s): string
{
    $s = strtolower(trim((string)$s));
    if ($s === '') return '';
    $s = preg_replace('/&/', ' and ', $s);
    $s = preg_replace('/[^a-z0-9]+/', ' ', $s);
    $s = trim(preg_replace('/\s+/', ' ', $s));
    // Strip trailing company-type suffixes, repeatedly (e.g. "co ltd").
    $suffixes = ['limited', 'ltd', 'plc', 'llp', 'lp', 'cic', 'cio', 'inc', 'incorporated',
                 'company', 'co', 'holdings', 'group', 'uk', 'the'];
    $changed = true;
    while ($changed) {
        $changed = false;
        foreach ($suffixes as $suf) {
            if (preg_match('/^(.*?)\s+' . preg_quote($suf, '/') . '$/', $s, $m) && trim($m[1]) !== '') {
                $s = trim($m[1]);
                $changed = true;
            }
        }
    }
    return $s;
}

/** Generic text key for supporting signals (address / industry / director). */
function brs_lg_norm_text(?string $s): string
{
    $s = strtolower((string)$s);
    $s = preg_replace('/[^a-z0-9]+/', ' ', $s);
    return trim(preg_replace('/\s+/', ' ', $s));
}

/**
 * `leads.source` values that are NOT lead-gen output, and so are kept off
 * the Lead Gen list. Lead Gen answers "what have our acquisition methods
 * produced", so anything that arrived because the prospect came to US, or
 * reached us through someone else, belongs in Leads but not here.
 *
 *   website booking / call booking - inbound; they booked a call with us
 *   inbound / referral             - they approached us, or someone sent them
 *   web search / cold outreach     - legacy free-text labels the team used
 *                                    before the current capture methods
 *
 * Compared lower-cased and trimmed. Add to this list rather than scattering
 * source checks around the query.
 */
const BRS_LG_NON_LEADGEN_SOURCES = [
    'website booking', 'call booking',
    'inbound', 'referral', 'web search', 'cold outreach',
];

/**
 * SQL for "this lead did not come from an acquisition method".
 *
 * Belt and braces on the booking case, agreed with the session that owns the
 * booking flow: the source strings are the documented contract ('website
 * booking' from routes/public_lead_booking.php, 'call booking' from the admin
 * flow), but `source` is a free-text UX label an admin can edit. The NOT
 * EXISTS is the structural test that survives any relabelling. The other
 * values have no such structural marker, so for those the label is all we have.
 */
function brs_lg_exclude_bookings_sql(string $alias = 'l'): string
{
    $in = implode(',', array_map(
        fn(string $s): string => "'" . str_replace("'", "''", $s) . "'",
        BRS_LG_NON_LEADGEN_SOURCES
    ));
    return "($alias.source IS NULL OR LOWER(TRIM($alias.source)) NOT IN ($in))
            AND NOT EXISTS (SELECT 1 FROM lead_bookings b WHERE b.lead_id = $alias.id)";
}

return function (string $method, array $segs): void {
    $claims = Auth::require();
    $pdo = Db::tpdo();
    $currentUserId = isset($claims['sub']) ? (int)$claims['sub'] : null;

    $sub = $segs[1] ?? '';

    /**
     * Copy one `company_leads` record into `leads` (with its info entries and
     * contacts), then delete the pipeline row. Returns the new lead id.
     *
     * Caller owns the transaction, so this can be used both for the single
     * promote and inside the bulk loop.
     *
     * The new row is stamped `leadgen_promoted_at` immediately: without it the
     * lead would drop off the source page but pop straight back onto the Lead
     * Gen list, since that list unions `leads` too.
     */
    $promoteCompanyLead = function (int $id) use ($pdo, $currentUserId): int {
        $stmt = $pdo->prepare('SELECT * FROM company_leads WHERE id = ?');
        $stmt->execute([$id]);
        $cl = $stmt->fetch();
        if (!$cl) throw new \RuntimeException('Company lead ' . $id . ' not found');

        $insLead = $pdo->prepare('INSERT INTO leads
            (name, email, phone, address, company, company_number, url, notes, status, source,
             industry, added_by_user_id, added_by_system)
            VALUES (?,?,?,?,?,?,?,?, ?,?, ?,?,?)');
        $insLead->execute([
            $cl['name'], $cl['email'], $cl['phone'], $cl['address'], $cl['company'], $cl['company_number'],
            $cl['url'], $cl['notes'], 'new', ($cl['source'] ?: 'companies-house'), $cl['industry'], $currentUserId, 1,
        ]);
        $leadId = (int)$pdo->lastInsertId();

        // Stamped in a follow-up UPDATE rather than inline in the INSERT:
        // TenantPdo rewrites INSERTs to inject tenant_id and a bare NOW()
        // inside the VALUES list breaks its paren matching.
        $pdo->prepare('UPDATE leads SET leadgen_promoted_at = NOW() WHERE id = ?')->execute([$leadId]);

        $srcInfo = $pdo->prepare('SELECT name, value, sort_order FROM company_lead_info WHERE company_lead_id = ? ORDER BY sort_order, id');
        $srcInfo->execute([$id]);
        $dstInfo = $pdo->prepare('INSERT INTO lead_info (lead_id, name, value, sort_order) VALUES (?,?,?,?)');
        foreach ($srcInfo->fetchAll() as $r) $dstInfo->execute([$leadId, $r['name'], $r['value'], (int)$r['sort_order']]);

        $srcCon = $pdo->prepare('SELECT * FROM company_lead_contacts WHERE company_lead_id = ? ORDER BY is_primary DESC, sort_order, id');
        $srcCon->execute([$id]);
        $dstCon = $pdo->prepare('INSERT INTO lead_contacts
            (lead_id, first_name, last_name, position, email, linkedin_url, verified, is_primary, sort_order)
            VALUES (?,?,?,?,?,?,?,?,?)');
        // lead_contacts stores phones in a child table (lead_contact_numbers),
        // so carry any per-contact phone across as a number row.
        $dstNum = $pdo->prepare('INSERT INTO lead_contact_numbers (contact_id, number, label, sort_order) VALUES (?,?,?,?)');
        foreach ($srcCon->fetchAll() as $c) {
            $dstCon->execute([$leadId, $c['first_name'], $c['last_name'], $c['position'], $c['email'], $c['linkedin_url'], (int)$c['verified'], (int)$c['is_primary'], (int)$c['sort_order']]);
            $phone = trim((string)($c['phone'] ?? ''));
            if ($phone !== '') $dstNum->execute([(int)$pdo->lastInsertId(), $phone, 'phone', 0]);
        }

        \BRS\Contracts::fanOutToNewEntity($pdo, 'lead', $leadId);
        $pdo->prepare('DELETE FROM company_leads WHERE id = ?')->execute([$id]);
        return $leadId;
    };

    /**
     * Fold a `company_leads` record INTO an existing `leads` row, then delete
     * the pipeline record.
     *
     * Used when a consolidated Lead Gen group already contains a real lead:
     * promoting must not mint a second lead for the same company, or the
     * Leads list inherits exactly the duplication the Lead Gen list just
     * finished removing. Existing values on the lead always win; the pipeline
     * record only fills gaps and contributes its info entries and contacts.
     */
    $mergeCompanyLeadIntoLead = function (int $clId, int $leadId) use ($pdo): void {
        $stmt = $pdo->prepare('SELECT * FROM company_leads WHERE id = ?');
        $stmt->execute([$clId]);
        $cl = $stmt->fetch();
        if (!$cl) return;

        $lq = $pdo->prepare('SELECT * FROM leads WHERE id = ?');
        $lq->execute([$leadId]);
        $ld = $lq->fetch();
        if (!$ld) throw new \RuntimeException('Lead ' . $leadId . ' not found');

        $fill = [];
        foreach (['name','email','phone','address','company','company_number','url','industry','notes'] as $f) {
            if (trim((string)($ld[$f] ?? '')) === '' && trim((string)($cl[$f] ?? '')) !== '') $fill[$f] = $cl[$f];
        }
        if ($fill) {
            $set = implode(', ', array_map(fn($k) => "`$k` = ?", array_keys($fill)));
            $pdo->prepare("UPDATE leads SET $set WHERE id = ?")->execute([...array_values($fill), $leadId]);
        }

        // Carry enrichment across, skipping info entries the lead already has.
        $have = [];
        $hq = $pdo->prepare('SELECT name FROM lead_info WHERE lead_id = ?');
        $hq->execute([$leadId]);
        foreach ($hq->fetchAll() as $h) $have[strtolower((string)$h['name'])] = true;

        $srcInfo = $pdo->prepare('SELECT name, value, sort_order FROM company_lead_info WHERE company_lead_id = ? ORDER BY sort_order, id');
        $srcInfo->execute([$clId]);
        $dstInfo = $pdo->prepare('INSERT INTO lead_info (lead_id, name, value, sort_order) VALUES (?,?,?,?)');
        foreach ($srcInfo->fetchAll() as $r) {
            if (isset($have[strtolower((string)$r['name'])])) continue;
            $dstInfo->execute([$leadId, $r['name'], $r['value'], (int)$r['sort_order']]);
        }

        // Contacts are de-duplicated on email, falling back to first+last name.
        $seen = [];
        $cq = $pdo->prepare('SELECT first_name, last_name, email FROM lead_contacts WHERE lead_id = ?');
        $cq->execute([$leadId]);
        foreach ($cq->fetchAll() as $c) {
            $k = trim(strtolower((string)$c['email'])) ?: trim(strtolower($c['first_name'] . ' ' . $c['last_name']));
            if ($k !== '') $seen[$k] = true;
        }
        $srcCon = $pdo->prepare('SELECT * FROM company_lead_contacts WHERE company_lead_id = ? ORDER BY is_primary DESC, sort_order, id');
        $srcCon->execute([$clId]);
        $dstCon = $pdo->prepare('INSERT INTO lead_contacts
            (lead_id, first_name, last_name, position, email, linkedin_url, verified, is_primary, sort_order)
            VALUES (?,?,?,?,?,?,?,?,?)');
        $dstNum = $pdo->prepare('INSERT INTO lead_contact_numbers (contact_id, number, label, sort_order) VALUES (?,?,?,?)');
        foreach ($srcCon->fetchAll() as $c) {
            $k = trim(strtolower((string)$c['email'])) ?: trim(strtolower($c['first_name'] . ' ' . $c['last_name']));
            if ($k !== '' && isset($seen[$k])) continue;
            if ($k !== '') $seen[$k] = true;
            // Never demote the lead's existing primary contact.
            $dstCon->execute([$leadId, $c['first_name'], $c['last_name'], $c['position'], $c['email'], $c['linkedin_url'], (int)$c['verified'], 0, (int)$c['sort_order']]);
            $phone = trim((string)($c['phone'] ?? ''));
            if ($phone !== '') $dstNum->execute([(int)$pdo->lastInsertId(), $phone, 'phone', 0]);
        }

        $pdo->prepare('DELETE FROM company_leads WHERE id = ?')->execute([$clId]);
    };

    // ================= Shared enrichment toolkit =======================
    // Each "qualify a lead" step is isolated into its own reusable closure so
    // it can be triggered ONE AT A TIME on any pipeline record — both by the
    // bundled `qualify` pass and by the individual per-lead endpoints
    // (POST /company-leads/:id/{officers|google|linkedin|domain|contact}),
    // which other sections can call directly.
    $script = $_SERVER['SCRIPT_NAME'] ?? '';
    $selfBase = str_replace('/api/index.php', '', $script);
    if ($selfBase === $script) $selfBase = preg_replace('#/api(/.*)?$#', '', $_SERVER['REQUEST_URI'] ?? '') ?? '';
    $selfScheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $selfHost   = $_SERVER['HTTP_HOST'] ?? '127.0.0.1';

    // Self-fetch ch_api.php (Companies House) — decoded JSON or a 502.
    $chApiFetch = function (string $query) use ($selfScheme, $selfHost, $selfBase) {
        $url = $selfScheme . '://' . $selfHost . $selfBase . '/scraper/ch_api.php?' . $query;
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 300, CURLOPT_FOLLOWLOCATION => true, CURLOPT_SSL_VERIFYPEER => false]);
        $body = curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); $cerr = curl_error($ch); curl_close($ch);
        if ($body === false || $code >= 400) Json::fail('Could not reach the Companies House service (' . ($cerr !== '' ? $cerr : ('HTTP ' . $code)) . ')', 502);
        $data = json_decode($body, true);
        if (!is_array($data)) { $snippet = trim(substr(strip_tags((string)$body), 0, 200)); Json::fail('Companies House service returned an unexpected response: ' . ($snippet !== '' ? $snippet : 'empty body'), 502); }
        if (isset($data['error'])) Json::fail('Companies House: ' . $data['error'], 502);
        return $data;
    };

    // Self-GET any scraper endpoint (google_places / linkedin / domain_status / website_contact).
    $selfGet = function (string $path, array $params, int $timeout = 60) use ($selfScheme, $selfHost, $selfBase) {
        $url = $selfScheme . '://' . $selfHost . $selfBase . $path . '?' . http_build_query($params);
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => $timeout, CURLOPT_SSL_VERIFYPEER => false]);
        $b = curl_exec($ch); curl_close($ch);
        $d = json_decode((string)$b, true);
        return is_array($d) ? $d : ['error' => 'bad response'];
    };

    // Build an enrichment $state array from a company_leads row.
    $stateFromRow = function (array $row) use ($pdo) {
        $id = (int)$row['id'];
        $s = [
            'name'       => trim((string)(($row['company'] ?? '') !== '' ? $row['company'] : $row['name'])),
            'num'        => strtoupper(trim((string)($row['company_number'] ?? ''))),
            'addr'       => (string)($row['address'] ?? ''),
            'url'        => (string)($row['url'] ?? ''),
            'url_status' => (string)($row['url_status'] ?? ''),
            'phone'      => (string)($row['phone'] ?? ''),
            'email'      => (string)($row['email'] ?? ''),
            'hasDir'     => (bool)$pdo->query("SELECT 1 FROM company_lead_contacts WHERE company_lead_id = $id LIMIT 1")->fetchColumn(),
            'hasLi'      => (bool)$pdo->query("SELECT 1 FROM company_lead_info WHERE company_lead_id = $id AND name = 'LinkedIn (company)' LIMIT 1")->fetchColumn(),
        ];
        $s['active'] = ($s['url_status'] === '') ? true : !in_array($s['url_status'], ['parked', 'for_sale', 'unconfigured', 'dead'], true);
        return $s;
    };

    // Load a pipeline record → [row, state, nextSortOrder] (or 404).
    $loadLeadState = function (int $id) use ($pdo, $stateFromRow) {
        $stmt = $pdo->prepare("SELECT id, name, company, company_number, address, url, url_status, phone, email FROM company_leads WHERE id = ?");
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        if (!$row) Json::fail('Not found', 404);
        $so = (int)$pdo->query("SELECT COALESCE(MAX(sort_order),-1)+1 FROM company_lead_info WHERE company_lead_id = $id")->fetchColumn();
        return [$row, $stateFromRow($row), $so];
    };

    // Factory: prepares statements + settings once, returns the five single-step
    // enrichers + a persist helper. Each enricher takes (leadId, &$state, &$so),
    // fills ONLY what's missing, writes its info/contact rows, mutates $state,
    // and returns per-type found counts. `persist` writes the merged row.
    $makeEnrichers = function (array $opts = []) use ($pdo, $chApiFetch, $selfGet) {
        $gmethod = (($opts['google_method']   ?? 'api')    === 'scrape') ? 'scrape' : 'api';
        $lmethod = (($opts['linkedin_method'] ?? 'scrape') === 'cookie') ? 'cookie' : 'scrape';
        $gkey   = trim((string)($pdo->query("SELECT v FROM settings WHERE k = 'google_maps_api_key'")->fetchColumn() ?: ''));
        $liAt   = trim((string)($pdo->query("SELECT v FROM settings WHERE k = 'linkedin_li_at'")->fetchColumn() ?: ''));
        $liCsrf = trim((string)($pdo->query("SELECT v FROM settings WHERE k = 'linkedin_csrf'")->fetchColumn() ?: ''));
        if ($gmethod === 'api'    && $gkey === '') $gmethod = 'scrape';
        if ($lmethod === 'cookie' && $liAt === '') $lmethod = 'scrape';

        $insContact = $pdo->prepare('INSERT INTO company_lead_contacts (company_lead_id, first_name, last_name, position, email, verified, is_primary, sort_order) VALUES (?,?,?,?,?,?,?,?)');
        $insInfo    = $pdo->prepare('INSERT INTO company_lead_info (company_lead_id, name, value, sort_order) VALUES (?,?,?,?)');
        $updLead    = $pdo->prepare('UPDATE company_leads SET phone = ?, url = ?, url_status = ?, address = ?, email = ?, stage = 5, stage_updated_at = NOW() WHERE id = ?');
        $dirName    = $pdo->prepare("SELECT first_name, last_name FROM company_lead_contacts WHERE company_lead_id = ? ORDER BY is_primary DESC, sort_order, id LIMIT 1");

        // 0) LinkedIn company profile — for LinkedIn-sourced leads, load the
        //    company's /about/ page (needs the li_at cookie) and pull the basic
        //    overview: website, industry, size, HQ, type, specialties, locations.
        //    Runs first so the website it finds feeds the email/phone crawl below.
        $profile = function (int $lid, array &$s, int &$so) use ($pdo, $insInfo, $liAt, $liCsrf) {
            if ($liAt === '') return ['found' => 0, 'website' => 0, 'address' => 0];
            $liUrl = trim((string)($pdo->query("SELECT value FROM company_lead_info WHERE company_lead_id = $lid AND name = 'LinkedIn (company)' ORDER BY id LIMIT 1")->fetchColumn() ?: ''));
            if ($liUrl === '') return ['found' => 0, 'website' => 0, 'address' => 0];
            // Skip if already loaded once (an 'Industry' row from a prior pass).
            if ((bool)$pdo->query("SELECT 1 FROM company_lead_info WHERE company_lead_id = $lid AND name = 'Industry' LIMIT 1")->fetchColumn()) {
                return ['found' => 0, 'website' => 0, 'address' => 0];
            }
            $tmp = tempnam(sys_get_temp_dir(), 'lic_');
            file_put_contents($tmp, json_encode(['li_at' => $liAt, 'csrf' => $liCsrf, 'url' => $liUrl, 'staggerMin' => 1, 'staggerMax' => 15]));
            $renderer = dirname(__DIR__, 2) . '/scraper/linkedin_company.js';
            $nodeBin  = file_exists('C:\\Program Files\\nodejs\\node.exe') ? 'C:\\Program Files\\nodejs\\node.exe' : 'node';
            $out = ''; $proc = proc_open([$nodeBin, $renderer, $tmp], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
            if (is_resource($proc)) { $out = stream_get_contents($pipes[1]); fclose($pipes[1]); fclose($pipes[2]); proc_close($proc); }
            @unlink($tmp);
            $d = json_decode($out, true);
            if (!is_array($d) || empty($d['ok'])) return ['found' => 0, 'website' => 0, 'address' => 0];
            $res = ['found' => 1, 'website' => 0, 'address' => 0, 'staff' => 0, 'industry' => 0];
            if (trim((string)$s['url']) === '' && trim((string)($d['website'] ?? '')) !== '') { $s['url'] = $d['website']; $res['website'] = 1; }
            // Prefer the primary location's FULL street address over the vague
            // "Headquarters" (city, country); fall back to HQ if no location.
            $locs = array_values(array_filter(array_map('strval', (array)($d['locations'] ?? [])), fn($x) => trim($x) !== ''));
            $primaryAddr = $locs[0] ?? trim((string)($d['headquarters'] ?? ''));
            if (trim((string)$s['addr']) === '' && $primaryAddr !== '') { $s['addr'] = $primaryAddr; $res['address'] = 1; }
            if (trim((string)($d['industry'] ?? '')) !== '') {
                $u = $pdo->prepare("UPDATE company_leads SET industry = ? WHERE id = ? AND (industry IS NULL OR industry = '')");
                $u->execute([$d['industry'], $lid]);
                if ($u->rowCount() > 0) $res['industry'] = 1;
            }
            foreach ([
                ['Industry', $d['industry'] ?? ''], ['Company size', $d['size'] ?? ''],
                ['Type', $d['type'] ?? ''], ['Founded', $d['founded'] ?? ''],
                ['Headquarters', $d['headquarters'] ?? ''],
                ['Specialties', $d['specialties'] ?? ''], ['About', $d['description'] ?? ''],
            ] as $f) {
                if (trim((string)$f[1]) !== '') $insInfo->execute([$lid, $f[0], (string)$f[1], $so++]);
            }
            foreach ($locs as $loc) $insInfo->execute([$lid, 'Location', $loc, $so++]);
            // Employees → staff (name + profile link), matching the LinkedIn step's format.
            $staffN = 0;
            foreach ((array)($d['employees'] ?? []) as $emp) {
                $pn = trim((string)($emp['name'] ?? '')); $pu = trim((string)($emp['url'] ?? ''));
                if ($pn === '' || $pu === '') continue;
                $insInfo->execute([$lid, 'Staff: ' . $pn, $pu, $so++]);
                $staffN++;
            }
            $res['staff'] = $staffN;
            return $res;
        };

        // 0.5) Companies House match — for a lead with a NAME but no company
        //    number (e.g. LinkedIn source), search CH by name and, on a confident
        //    match, backfill the number + registered address + SIC/sector. Sets
        //    the number so the officers step next can pull directors.
        $chmatch = function (int $lid, array &$s, int &$so) use ($selfGet, $insInfo, $pdo) {
            if (trim((string)$s['num']) !== '' || trim((string)$s['name']) === '') return ['found' => 0, 'address' => 0];
            $m = $selfGet('/scraper/ch_api.php', ['mode' => 'match', 'name' => $s['name'], 'location' => (string)$s['addr']], 45);
            if (empty($m['matched'])) return ['found' => 0, 'address' => 0];
            $num = strtoupper(trim((string)($m['company_number'] ?? '')));
            if ($num === '') return ['found' => 0, 'address' => 0];
            $s['num'] = $num;
            $pdo->prepare('UPDATE company_leads SET company_number = ? WHERE id = ?')->execute([$num, $lid]);
            $insInfo->execute([$lid, 'Companies House', 'https://find-and-update.company-information.service.gov.uk/company/' . rawurlencode($num), $so++]);
            $reg = trim((string)($m['registered_address'] ?? ''));
            $addrGain = 0;
            if ($reg !== '') { if (trim((string)$s['addr']) === '') $addrGain = 1; $s['addr'] = $reg; } // registered address is authoritative
            foreach ([
                ['Incorporated',   (string)($m['registered'] ?? '')],
                ['SIC codes',      (string)($m['sector_code'] ?? '')],
                ['Sector',         (string)($m['sector'] ?? '')],
                ['Sector group',   (string)($m['sector_group'] ?? '')],
                ['Company status', (string)($m['company_status'] ?? '')],
            ] as $f) {
                if (trim((string)$f[1]) !== '') $insInfo->execute([$lid, $f[0], (string)$f[1], $so++]);
            }
            return ['found' => 1, 'address' => $addrGain, 'company_number' => $num];
        };

        // 1) Directors (Companies House officers).
        $officers = function (int $lid, array &$s, int &$so) use ($chApiFetch, $insContact, $insInfo) {
            if ($s['hasDir'] || $s['num'] === '') return ['found' => 0, 'directors' => 0];
            $off = $chApiFetch('mode=officers&numbers=' . urlencode($s['num']));
            $people = $off[$s['num']] ?? [];
            foreach ($people as $idx => $p) {
                $first = $p['first'] !== '' ? $p['first'] : ($p['last'] ?: 'Director');
                $insContact->execute([$lid, $first, ($p['last'] !== '' ? $p['last'] : null), ($p['role'] !== '' ? $p['role'] : 'director'), null, 0, $idx === 0 ? 1 : 0, $idx]);
                $bits = [];
                if (($p['appointed_on'] ?? '') !== '') $bits[] = 'Appointed: ' . $p['appointed_on'];
                if (($p['occupation']   ?? '') !== '') $bits[] = 'Occupation: ' . $p['occupation'];
                if (($p['nationality']  ?? '') !== '') $bits[] = 'Nationality: ' . $p['nationality'];
                if (($p['address']      ?? '') !== '') $bits[] = 'Correspondence address: ' . $p['address'];
                if ($bits) $insInfo->execute([$lid, 'Director: ' . ($p['full'] !== '' ? $p['full'] : trim($first . ' ' . $p['last'])), implode('; ', $bits), $so++]);
            }
            if ($people) { $s['hasDir'] = true; return ['found' => 1, 'directors' => count($people)]; }
            return ['found' => 0, 'directors' => 0];
        };

        // 2) Google Business — website + phone + address (only if no website yet).
        $google = function (int $lid, array &$s, int &$so) use ($pdo, $selfGet, $insInfo, $gmethod, $gkey) {
            $hasWeb = trim((string)$s['url']) !== '';
            $hasGB  = (bool)$pdo->query("SELECT 1 FROM company_lead_info WHERE company_lead_id = $lid AND name = 'Google Business' LIMIT 1")->fetchColumn();
            // Already captured the Google Business profile → nothing to do. If we
            // already have a website, only the API can add the Business profile
            // (the free scraper returns just the website), so skip scrape there.
            if ($hasGB) return ['found' => 0, 'website' => 0, 'phone' => 0, 'address' => 0];
            if ($hasWeb && $gmethod !== 'api') return ['found' => 0, 'website' => 0, 'phone' => 0, 'address' => 0];
            $gp = ['name' => $s['name'], 'address' => $s['addr'], 'method' => $gmethod];
            if ($gmethod === 'api') $gp['key'] = $gkey;
            $g = $selfGet('/scraper/google_places.php', $gp);
            if (empty($g['found'])) return ['found' => 0, 'website' => 0, 'phone' => 0, 'address' => 0];
            $out = ['found' => 1, 'website' => 0, 'phone' => 0, 'address' => 0];
            if (trim((string)$s['phone']) === '' && trim((string)($g['phone'] ?? '')) !== '') { $s['phone'] = $g['phone']; $out['phone'] = 1; }
            if (!$hasWeb && trim((string)($g['website'] ?? '')) !== '') { $s['url'] = $g['website']; $out['website'] = 1; }
            if (trim((string)$s['addr']) === '' && trim((string)($g['formatted_address'] ?? '')) !== '') { $s['addr'] = $g['formatted_address']; $out['address'] = 1; }
            foreach ([
                ['Google Business', (string)($g['maps_url'] ?? '')],   // the Google Business / Maps profile link
                ['Google rating', isset($g['rating']) && $g['rating'] !== null ? (string)$g['rating'] : ''],
                ['Business status', (string)($g['business_status'] ?? '')],
                ['Opening hours', (string)($g['opening_hours'] ?? '')],
                ['Google category', (string)($g['types'] ?? '')],
            ] as $f) {
                if (trim((string)$f[1]) !== '') $insInfo->execute([$lid, $f[0], $f[1], $so++]);
            }
            return $out;
        };

        // 3) Domain status — classify the website (live/parked/dead), no rendering.
        $domain = function (int $lid, array &$s, int &$so) use ($selfGet, $insInfo) {
            if (trim((string)$s['url']) === '') { $s['active'] = true; return ['found' => 0, 'status' => '']; }
            if (trim((string)$s['url_status']) !== '') { $s['active'] = !in_array($s['url_status'], ['parked', 'for_sale', 'unconfigured', 'dead'], true); return ['found' => 0, 'status' => $s['url_status'], 'active' => $s['active']]; }
            $ds = $selfGet('/scraper/domain_status.php', ['website' => (string)$s['url']], 30);
            $st = trim((string)($ds['status'] ?? ''));
            if ($st === '') { $s['active'] = true; return ['found' => 0, 'status' => '']; }
            $s['url_status'] = $st;
            $s['active'] = !empty($ds['active']);
            if (!$s['active']) { $why = isset($ds['signals'][0]) ? ' - ' . $ds['signals'][0] : ''; $insInfo->execute([$lid, 'Website status', $st . $why, $so++]); }
            return ['found' => 1, 'status' => $st, 'active' => $s['active']];
        };

        // 4) LinkedIn — company page + staff (only if no company page yet).
        $linkedin = function (int $lid, array &$s, int &$so) use ($selfGet, $insInfo, $dirName, $lmethod, $liAt, $liCsrf) {
            if ($s['hasLi']) return ['found' => 0, 'staff' => 0];
            $companyUrl = ''; $staff = [];
            if ($lmethod === 'cookie') {
                $tmp = tempnam(sys_get_temp_dir(), 'li_');
                file_put_contents($tmp, json_encode(['li_at' => $liAt, 'csrf' => $liCsrf, 'staggerMin' => 0, 'staggerMax' => 0, 'companies' => [['id' => $lid, 'name' => $s['name'], 'location' => $s['addr']]]]));
                $renderer = dirname(__DIR__, 2) . '/scraper/linkedin_render.js';
                $nodeBin  = file_exists('C:\\Program Files\\nodejs\\node.exe') ? 'C:\\Program Files\\nodejs\\node.exe' : 'node';
                $out = ''; $proc = proc_open([$nodeBin, $renderer, $tmp], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
                if (is_resource($proc)) { $out = stream_get_contents($pipes[1]); fclose($pipes[1]); fclose($pipes[2]); proc_close($proc); }
                @unlink($tmp);
                $data = json_decode($out, true);
                $r0 = (is_array($data) && !empty($data['results'])) ? $data['results'][0] : null;
                if ($r0) { $companyUrl = (string)($r0['company_url'] ?? ''); $staff = $r0['staff'] ?? []; }
            } else {
                $dirName->execute([$lid]); $dir = $dirName->fetch() ?: ['first_name' => '', 'last_name' => ''];
                $res = $selfGet('/scraper/linkedin.php', ['name' => $s['name'], 'location' => $s['addr'], 'first' => (string)$dir['first_name'], 'last' => (string)($dir['last_name'] ?? ''), 'method' => 'scrape']);
                $companyUrl = (string)($res['company_url'] ?? ''); $staff = $res['staff'] ?? [];
            }
            $out = ['found' => 0, 'staff' => 0];
            if ($companyUrl !== '') { $insInfo->execute([$lid, 'LinkedIn (company)', $companyUrl, $so++]); $s['hasLi'] = true; $out['found'] = 1; }
            $staffAdded = 0;
            foreach ($staff as $person) {
                $pu = trim((string)($person['url'] ?? '')); if ($pu === '') continue;
                $pn = trim((string)($person['name'] ?? ''));
                $insInfo->execute([$lid, 'Staff: ' . ($pn !== '' ? $pn : 'LinkedIn profile'), $pu, $so++]);
                $staffAdded++;
            }
            $out['staff'] = $staffAdded;
            return $out;
        };

        // 5) Website contact crawl — email + phone from the company's own site.
        $contact = function (int $lid, array &$s, int &$so) use ($selfGet, $insInfo) {
            $needEmail = trim((string)$s['email']) === '';
            $needPhone = trim((string)$s['phone']) === '';
            if (trim((string)$s['url']) === '' || empty($s['active']) || (!$needEmail && !$needPhone)) return ['found' => 0, 'email' => 0, 'phone' => 0];
            $ct = $selfGet('/scraper/website_contact.php', ['website' => (string)$s['url'], 'stagger_min' => 1, 'stagger_max' => 15], 180);
            $out = ['found' => 0, 'email' => 0, 'phone' => 0];
            if (!empty($ct['found'])) {
                if ($needEmail && trim((string)($ct['email'] ?? '')) !== '') { $s['email'] = $ct['email']; $out['email'] = 1; $out['found'] = 1; $insInfo->execute([$lid, 'Email source', (string)($ct['email_source'] ?? $s['url']), $so++]); }
                if ($needPhone && trim((string)($ct['phone'] ?? '')) !== '') { $s['phone'] = $ct['phone']; $out['phone'] = 1; $out['found'] = 1; $insInfo->execute([$lid, 'Phone source', (string)($ct['phone_source'] ?? $s['url']), $so++]); }
            }
            return $out;
        };

        $persist = function (int $lid, array $s) use ($updLead) {
            $updLead->execute([($s['phone'] ?: null), ($s['url'] ?: null), ($s['url_status'] ?: null), ($s['addr'] ?: null), ($s['email'] ?: null), $lid]);
        };

        return compact('profile', 'chmatch', 'officers', 'google', 'domain', 'linkedin', 'contact', 'persist');
    };

    // ---- List (for the pipeline table on the Companies House page) ----
    if ($sub === '' && $method === 'GET') {
        $where = '1=1'; $params = [];
        if (isset($_GET['source']) && $_GET['source'] !== '') { $where .= ' AND source = ?'; $params[] = (string)$_GET['source']; }
        if (isset($_GET['stage']) && $_GET['stage'] !== '') { $where .= ' AND stage = ?'; $params[] = (int)$_GET['stage']; }
        if (isset($_GET['q']) && trim((string)$_GET['q']) !== '') {
            $where .= ' AND (company LIKE ? OR name LIKE ? OR company_number LIKE ?)';
            $like = '%' . trim((string)$_GET['q']) . '%'; $params[] = $like; $params[] = $like; $params[] = $like;
        }
        $stmt = $pdo->prepare("SELECT * FROM company_leads WHERE $where ORDER BY stage DESC, id DESC LIMIT 2000");
        $stmt->execute($params);
        $rows = $stmt->fetchAll();

        // Presence flags for the icon grid on the list. Company address/website/
        // email/phone come straight off the row columns (frontend reads them);
        // these cover company LinkedIn + the people (director/staff) signals,
        // aggregated per record (both queries tenant-scoped by the rewriter).
        $cLi = []; $pAddr = []; $pStaffLi = [];
        $iq = $pdo->prepare("SELECT company_lead_id AS cid, name FROM company_lead_info
                              WHERE name = 'LinkedIn (company)' OR name LIKE 'Director:%' OR name LIKE 'Staff:%'");
        $iq->execute();
        foreach ($iq->fetchAll() as $i) {
            $cid = (int)$i['cid'];
            if ($i['name'] === 'LinkedIn (company)')   $cLi[$cid] = true;
            elseif (stripos($i['name'], 'Director:') === 0) $pAddr[$cid] = true;
            elseif (stripos($i['name'], 'Staff:') === 0)    $pStaffLi[$cid] = true;
        }
        $pFlags = [];
        $cq = $pdo->prepare("SELECT company_lead_id AS cid,
                               MAX(linkedin_url IS NOT NULL AND linkedin_url <> '') AS li,
                               MAX(email IS NOT NULL AND email <> '') AS em,
                               MAX(phone IS NOT NULL AND phone <> '') AS ph
                             FROM company_lead_contacts WHERE 1=1 GROUP BY company_lead_id");
        $cq->execute();
        foreach ($cq->fetchAll() as $c) $pFlags[(int)$c['cid']] = $c;

        foreach ($rows as &$r) {
            $cid = (int)$r['id'];
            $pf = $pFlags[$cid] ?? null;
            $r['c_li']    = isset($cLi[$cid]) ? 1 : 0;
            $r['p_addr']  = isset($pAddr[$cid]) ? 1 : 0;
            $r['p_li']    = (isset($pStaffLi[$cid]) || ($pf && (int)$pf['li'])) ? 1 : 0;
            $r['p_email'] = ($pf && (int)$pf['em']) ? 1 : 0;
            $r['p_phone'] = ($pf && (int)$pf['ph']) ? 1 : 0;
            // Presence-of-info flags for the list filter checkboxes (record has
            // this parameter anywhere — company or its people).
            $r['f_address']   = (trim((string)($r['address'] ?? '')) !== '' || isset($pAddr[$cid])) ? 1 : 0;
            $r['f_directors'] = isset($pFlags[$cid]) ? 1 : 0;
            $r['f_industry']  = (trim((string)($r['industry'] ?? '')) !== '') ? 1 : 0;
            $r['f_website']   = (trim((string)($r['url'] ?? '')) !== '') ? 1 : 0;
            $r['f_phone']     = (trim((string)($r['phone'] ?? '')) !== '' || ($pf && (int)$pf['ph'])) ? 1 : 0;
            $r['f_email']     = (trim((string)($r['email'] ?? '')) !== '' || ($pf && (int)$pf['em'])) ? 1 : 0;
            $r['f_linkedin']  = (isset($cLi[$cid]) || ($pf && (int)$pf['li'])) ? 1 : 0;
            $r['f_staff']     = isset($pStaffLi[$cid]) ? 1 : 0;
        }
        unset($r);
        Json::send(['company_leads' => $rows]);
    }

    // ---- Amalgamated list: every lead across BOTH tables ----------------
    // Powers the unified "Lead Gen" landing page. Unions company_leads
    // (Companies House + LinkedIn pipeline) with the funnel `leads` table
    // (AI-prompt + imported + manual), normalised to one row shape with a
    // `source_label` classifying the acquisition method + the same presence
    // flags the pipeline list uses so the State icon grid renders identically.
    if ($sub === 'all' && $method === 'GET') {
        $q     = trim((string)($_GET['q'] ?? ''));
        $like  = '%' . $q . '%';

        // Friendly labels for the known pipeline source keys; anything else
        // (free-text leads.source) is shown verbatim.
        $labelFor = function (string $key): string {
            switch ($key) {
                case 'companies-house': return 'Companies House';
                case 'linkedin':        return 'LinkedIn';
                case '':                return 'Manual';
                default:                return $key;
            }
        };

        $out = [];

        // --- company_leads (pipeline) — reuse the exact presence-flag logic.
        $clWhere = '1=1'; $clParams = [];
        if ($q !== '') { $clWhere .= ' AND (company LIKE ? OR name LIKE ? OR company_number LIKE ?)'; $clParams[] = $like; $clParams[] = $like; $clParams[] = $like; }
        $stmt = $pdo->prepare("SELECT * FROM company_leads WHERE $clWhere ORDER BY id DESC LIMIT 5000");
        $stmt->execute($clParams);
        $clRows = $stmt->fetchAll();

        $cLi = []; $pAddr = []; $pStaffLi = []; $directors = [];
        $iq = $pdo->query("SELECT company_lead_id AS cid, name, value FROM company_lead_info
                            WHERE name = 'LinkedIn (company)' OR name LIKE 'Director:%' OR name LIKE 'Staff:%'");
        foreach ($iq->fetchAll() as $i) {
            $cid = (int)$i['cid'];
            if ($i['name'] === 'LinkedIn (company)')        $cLi[$cid] = true;
            elseif (stripos($i['name'], 'Director:') === 0) {
                $pAddr[$cid] = true;
                // Director names double as a consolidation signal.
                $dn = brs_lg_norm_text(substr($i['name'], strlen('Director:')) ?: (string)$i['value']);
                if ($dn !== '') $directors[$cid][$dn] = true;
            }
            elseif (stripos($i['name'], 'Staff:') === 0)     $pStaffLi[$cid] = true;
        }
        $pFlags = [];
        foreach ($pdo->query("SELECT company_lead_id AS cid,
                                MAX(linkedin_url IS NOT NULL AND linkedin_url <> '') AS li,
                                MAX(email IS NOT NULL AND email <> '') AS em,
                                MAX(phone IS NOT NULL AND phone <> '') AS ph
                              FROM company_lead_contacts GROUP BY company_lead_id")->fetchAll() as $c) {
            $pFlags[(int)$c['cid']] = $c;
        }

        foreach ($clRows as $r) {
            $key = (string)($r['source'] ?? '');
            $cid = (int)$r['id']; $pf = $pFlags[$cid] ?? null;
            $out[] = [
                'key'          => 'cl-' . $cid,
                'id'           => $cid,
                'origin'       => 'company_lead',
                'source_key'   => $key,
                'source_label' => $labelFor($key),
                'name'         => $r['name'],
                'company'      => $r['company'],
                'company_number' => $r['company_number'],
                'address'      => $r['address'],
                'industry'     => $r['industry'],
                'phone'        => $r['phone'],
                'email'        => $r['email'],
                'url'          => $r['url'],
                'url_status'   => $r['url_status'],
                'notes'        => $r['notes'] ?? null,
                'created_at'   => $r['created_at'],
                'c_li'    => isset($cLi[$cid]) ? 1 : 0,
                'p_addr'  => isset($pAddr[$cid]) ? 1 : 0,
                'p_li'    => (isset($pStaffLi[$cid]) || ($pf && (int)$pf['li'])) ? 1 : 0,
                'p_email' => ($pf && (int)$pf['em']) ? 1 : 0,
                'p_phone' => ($pf && (int)$pf['ph']) ? 1 : 0,
                'directors' => array_keys($directors[$cid] ?? []),
            ];
        }

        // --- leads (funnel) — AI-prompt / imported / manual. No people
        // sub-tables, so people flags are all 0; company flags come off the
        // columns exactly like the pipeline list.
        //
        // Two exclusions, both required for this list to mean what it says:
        //   1. Booking-originated leads. Lead Gen is the acquisition list;
        //      a prospect who booked a call came to US, so they are a lead
        //      but not lead-GEN. See brs_lg_exclude_bookings_sql().
        //   2. Leads already promoted out of Lead Gen. Promoting a
        //      `company_leads` record creates a `leads` row, which without
        //      this filter would immediately reappear here under its source.
        $ldWhere = 'l.leadgen_promoted_at IS NULL AND ' . brs_lg_exclude_bookings_sql('l');
        $ldParams = [];
        if ($q !== '') { $ldWhere .= ' AND (l.company LIKE ? OR l.name LIKE ? OR l.company_number LIKE ?)'; $ldParams[] = $like; $ldParams[] = $like; $ldParams[] = $like; }
        $lstmt = $pdo->prepare("SELECT l.id, l.name, l.company, l.company_number, l.address, l.industry, l.phone, l.email, l.url, l.source, l.notes, l.created_at
                                  FROM leads l WHERE $ldWhere ORDER BY l.id DESC LIMIT 5000");
        $lstmt->execute($ldParams);
        foreach ($lstmt->fetchAll() as $r) {
            $key = (string)($r['source'] ?? '');
            $out[] = [
                'key'          => 'ld-' . (int)$r['id'],
                'id'           => (int)$r['id'],
                'origin'       => 'lead',
                'source_key'   => $key,
                'source_label' => $labelFor($key),
                'name'         => $r['name'],
                'company'      => $r['company'],
                'company_number' => $r['company_number'],
                'address'      => $r['address'],
                'industry'     => $r['industry'],
                'phone'        => $r['phone'],
                'email'        => $r['email'],
                'url'          => $r['url'],
                'url_status'   => null,
                'notes'        => $r['notes'],
                'created_at'   => $r['created_at'],
                'c_li'    => 0, 'p_addr' => 0, 'p_li' => 0, 'p_email' => 0, 'p_phone' => 0,
                'directors' => [],
            ];
        }

        // ---- Consolidate duplicates across sources -------------------
        // The same company reached us more than once (pulled from Companies
        // House, scraped off LinkedIn, typed in by hand). Collapse those into
        // one row that carries every source it came from, so the list is a
        // list of COMPANIES rather than a list of sightings.
        //
        // Union-find over two signals:
        //   - identical company number  (strongest; a registered identity)
        //   - identical normalised name (suffix-insensitive)
        // Guard: two rows that BOTH carry a company number and disagree are
        // never merged, however alike their names. Address, industry and
        // director are carried onto the merged row as evidence and are used
        // to pick which value wins per field, not to force a merge - name
        // alone is already an aggressive enough signal.
        $parent = range(0, max(0, count($out) - 1));
        $find = function (int $x) use (&$parent, &$find): int {
            while ($parent[$x] !== $x) { $parent[$x] = $parent[$parent[$x]]; $x = $parent[$x]; }
            return $x;
        };
        $union = function (int $a, int $b) use (&$parent, $find): void {
            $ra = $find($a); $rb = $find($b);
            if ($ra !== $rb) $parent[max($ra, $rb)] = min($ra, $rb);
        };

        $byNumber = []; $byName = [];
        foreach ($out as $i => $r) {
            $num  = brs_lg_norm_number($r['company_number'] ?? '');
            $name = brs_lg_norm_name($r['company'] ?? '') ?: brs_lg_norm_name($r['name'] ?? '');
            $out[$i]['_num'] = $num;
            $out[$i]['_name'] = $name;
            if ($num !== '') {
                if (isset($byNumber[$num])) $union($byNumber[$num], $i); else $byNumber[$num] = $i;
            }
        }
        foreach ($out as $i => $r) {
            if ($r['_name'] !== '') $byName[$r['_name']][] = $i;
        }
        foreach ($byName as $name => $idxs) {
            if (count($idxs) < 2) continue;
            // Distinct registered identities inside this name bucket.
            $nums = [];
            foreach ($idxs as $i) { if ($out[$i]['_num'] !== '') $nums[$out[$i]['_num']] = true; }

            if (count($nums) <= 1) {
                // One identity (or none) claimed by this name: same company.
                foreach ($idxs as $i) $union($idxs[0], $i);
                continue;
            }
            // Two or more DIFFERENT company numbers share this name, so the
            // name alone no longer identifies anyone. Rows that carry a number
            // were already merged on it above. Rows WITHOUT a number are
            // genuinely ambiguous - they could belong to either company - so
            // leave them standing alone rather than guessing. Guessing here
            // would silently attach a record to whichever row happened to be
            // read first, which is not a decision the data supports.
            foreach ($idxs as $i) {
                if ($out[$i]['_num'] !== '') continue;
                $out[$i]['ambiguous_name'] = 1;
            }
        }

        // Merge each group into one row. Richer sources win per field: a
        // non-empty value beats an empty one, and an enrichment-pipeline row
        // beats a hand-typed one when both have a value.
        $groups = [];
        foreach ($out as $i => $r) {
            $g = $find($i);
            if (!isset($groups[$g])) {
                $groups[$g] = $r;
                $groups[$g]['members'] = [];
                $groups[$g]['source_labels'] = [];
                $groups[$g]['directors'] = [];
            }
            $t = &$groups[$g];
            $preferIncoming = $r['origin'] === 'company_lead' && $t['origin'] !== 'company_lead';
            foreach (['name','company','company_number','address','industry','phone','email','url','url_status','notes'] as $f) {
                $have = trim((string)($t[$f] ?? ''));
                $inc  = trim((string)($r[$f] ?? ''));
                if ($inc !== '' && ($have === '' || $preferIncoming)) $t[$f] = $r[$f];
            }
            // Presence flags are a union: any source that proved a fact counts.
            foreach (['c_li','p_addr','p_li','p_email','p_phone'] as $f) {
                $t[$f] = ((int)$t[$f] || (int)$r[$f]) ? 1 : 0;
            }
            // The row a click opens should be the richest one available.
            if ($preferIncoming) { $t['id'] = $r['id']; $t['origin'] = $r['origin']; $t['key'] = $r['key']; }
            // Oldest first-seen date is when this company actually entered the list.
            if (($r['created_at'] ?? '') > ($t['created_at'] ?? '')) $t['created_at'] = $r['created_at'];

            $t['members'][] = ['origin' => $r['origin'], 'id' => $r['id'], 'source_label' => $r['source_label']];
            if (!in_array($r['source_label'], $t['source_labels'], true)) $t['source_labels'][] = $r['source_label'];
            foreach (($r['directors'] ?? []) as $d) {
                if (!in_array($d, $t['directors'], true)) $t['directors'][] = $d;
            }
            unset($t);
        }

        $out = array_values($groups);
        foreach ($out as $i => $r) {
            unset($out[$i]['_num'], $out[$i]['_name']);
            $out[$i]['member_count'] = count($r['members']);
            // Kept for the existing client-side filter; source_labels is the
            // full set for a row that came from more than one method.
            $out[$i]['source_label'] = $r['source_labels'][0] ?? $r['source_label'];
        }

        // Newest first across both tables (created_at desc, id desc as tie-break).
        usort($out, function ($a, $b) {
            $c = strcmp((string)($b['created_at'] ?? ''), (string)($a['created_at'] ?? ''));
            return $c !== 0 ? $c : ($b['id'] <=> $a['id']);
        });

        // Distinct source LABELS present, with counts, for the filter. Grouped
        // by the friendly label (not the raw key) so a manually-typed "LinkedIn"
        // lead and the LinkedIn pipeline collapse into one "LinkedIn" method
        // rather than showing two identically-named filter entries. The frontend
        // filters rows by source_label to match.
        // A consolidated row counts under EVERY method that found it, so
        // filtering by "LinkedIn" still surfaces a company LinkedIn found
        // even though it merged with the Companies House record.
        $srcCounts = [];
        foreach ($out as $row) {
            foreach (($row['source_labels'] ?? [$row['source_label']]) as $l) {
                if (!isset($srcCounts[$l])) $srcCounts[$l] = ['label' => $l, 'count' => 0];
                $srcCounts[$l]['count']++;
            }
        }
        $sources = array_values($srcCounts);
        usort($sources, fn($a, $b) => $b['count'] <=> $a['count']);

        Json::send(['leads' => $out, 'sources' => $sources]);
    }

    // ---- Promote consolidated Lead Gen rows into real leads ------------
    // POST /api/company-leads/promote-bulk
    //   { groups: [ { members: [ {origin:'company_lead'|'lead', id:N}, ... ] }, ... ] }
    //
    // One group == one company as shown on the Lead Gen list, which may be
    // several records across both tables. Promoting it must leave NOTHING
    // behind on Lead Gen or on the source pages it came from, so per group:
    //   - the first company_lead member is promoted the normal way (copies
    //     info/contacts across, then deletes the pipeline row)
    //   - every other company_lead member is deleted, having been merged
    //   - `leads` members are stamped with leadgen_promoted_at, which is
    //     what removes them from the Lead Gen list without moving tables
    // If a group has no company_lead member at all, its `leads` rows are
    // simply stamped: they are already leads, they just graduate out.
    if ($sub === 'promote-bulk' && $method === 'POST') {
        $body   = Json::readBody();
        $groups = is_array($body['groups'] ?? null) ? $body['groups'] : [];
        if (!$groups) Json::fail('No groups supplied', 400);

        $promoted = 0; $leadIds = []; $errors = [];

        foreach ($groups as $gi => $g) {
            $members = is_array($g['members'] ?? null) ? $g['members'] : [];
            if (!$members) { $errors[] = ['group' => $gi, 'error' => 'No members']; continue; }

            $clIds = []; $ldIds = [];
            foreach ($members as $m) {
                $mid = (int)($m['id'] ?? 0);
                if ($mid <= 0) continue;
                if (($m['origin'] ?? '') === 'company_lead') $clIds[] = $mid; else $ldIds[] = $mid;
            }

            $pdo->beginTransaction();
            try {
                $leadId = null;

                if ($ldIds) {
                    // The group already contains a real lead, so fold the
                    // pipeline records into it rather than minting a second
                    // lead for the same company.
                    $leadId = $ldIds[0];
                    foreach ($clIds as $clId) $mergeCompanyLeadIntoLead($clId, $leadId);

                    $in = implode(',', array_fill(0, count($ldIds), '?'));
                    $pdo->prepare("UPDATE leads SET leadgen_promoted_at = NOW()
                                    WHERE id IN ($in) AND leadgen_promoted_at IS NULL")->execute($ldIds);
                } elseif ($clIds) {
                    $primary = array_shift($clIds);
                    $leadId  = $promoteCompanyLead($primary);
                    // The rest of the group described the same company, and
                    // their detail was merged on the way in.
                    foreach ($clIds as $dup) $mergeCompanyLeadIntoLead($dup, $leadId);
                }

                $pdo->commit();
                if ($leadId !== null) { $leadIds[] = $leadId; $promoted++; }
            } catch (\Throwable $e) {
                $pdo->rollBack();
                $errors[] = ['group' => $gi, 'error' => $e->getMessage()];
            }
        }

        Json::send(['ok' => true, 'promoted' => $promoted, 'lead_ids' => $leadIds, 'errors' => $errors]);
    }

    // ---- Purge all pipeline records (tenant-scoped by the rewriter) ----
    if ($sub === '' && $method === 'DELETE') {
        $del = $pdo->prepare('DELETE FROM company_leads');
        $del->execute();
        Json::send(['ok' => true, 'deleted' => $del->rowCount()]);
    }

    // ---- Single record: detail / promote / delete ----
    if (ctype_digit((string)$sub)) {
        $id  = (int)$sub;
        $act = $segs[2] ?? '';

        if ($act === '' && $method === 'GET') {
            $stmt = $pdo->prepare('SELECT * FROM company_leads WHERE id = ?');
            $stmt->execute([$id]);
            $rec = $stmt->fetch();
            if (!$rec) Json::fail('Not found', 404);
            $info = $pdo->prepare('SELECT * FROM company_lead_info WHERE company_lead_id = ? ORDER BY sort_order, id');
            $info->execute([$id]);
            $con = $pdo->prepare('SELECT * FROM company_lead_contacts WHERE company_lead_id = ? ORDER BY is_primary DESC, sort_order, id');
            $con->execute([$id]);
            Json::send(['company_lead' => $rec, 'info' => $info->fetchAll(), 'contacts' => $con->fetchAll()]);
        }

        // Promote: copy into `leads` (+ lead_info + lead_contacts) 1:1, then
        // delete the pipeline record (its info/contacts cascade away).
        if ($act === 'promote' && $method === 'POST') {
            $pdo->beginTransaction();
            try {
                $leadId = $promoteCompanyLead($id);
                $pdo->commit();
            } catch (\Throwable $e) {
                $pdo->rollBack();
                if (str_contains($e->getMessage(), 'not found')) Json::fail('Not found', 404);
                throw $e;
            }
            Json::send(['ok' => true, 'lead_id' => $leadId], 201);
        }

        if ($act === '' && $method === 'DELETE') {
            $del = $pdo->prepare('DELETE FROM company_leads WHERE id = ?');
            $del->execute([$id]);
            Json::send(['ok' => true, 'deleted' => $del->rowCount()]);
        }

        // Individual enrichment steps — one "get X" per call, reusable from any
        // section: POST /company-leads/:id/{officers|google|linkedin|domain|contact}
        // Body (optional): { google_method: 'api'|'scrape', linkedin_method: 'scrape'|'cookie' }
        if ($method === 'POST' && in_array($act, ['profile', 'chmatch', 'officers', 'google', 'linkedin', 'domain', 'contact'], true)) {
            set_time_limit(0);
            $opts = json_decode((string)file_get_contents('php://input'), true);
            if (!is_array($opts)) $opts = [];
            [$row, $s, $so] = $loadLeadState($id);
            $E = $makeEnrichers($opts);
            $pdo->beginTransaction();
            try {
                $found = $E[$act]($id, $s, $so);
                $E['persist']($id, $s);
                $pdo->commit();
            } catch (\Throwable $e) { $pdo->rollBack(); throw $e; }
            Json::send([
                'ok'    => true,
                'step'  => $act,
                'found' => $found,
                'lead'  => [
                    'id' => $id,
                    'phone' => ($s['phone'] ?: null), 'url' => ($s['url'] ?: null),
                    'url_status' => ($s['url_status'] ?: null), 'address' => ($s['addr'] ?: null),
                    'email' => ($s['email'] ?: null),
                ],
            ]);
        }

        Json::fail('Not found', 404);
    }

    // ----- pipeline counts -----
    if ($sub === 'pipeline') {
        if ($method !== 'GET') Json::fail('Method not allowed', 405);
        // Scope every count to the calling page's source ('companies-house' or
        // 'linkedin'), so each pipeline page reflects only its own leads.
        $source = trim((string)($_GET['source'] ?? ''));
        $srcWhere = $source !== '' ? ' AND source = ?' : '';
        $srcParams = $source !== '' ? [$source] : [];
        // child-table counts scope via a subquery on company_leads.source
        $childScope = $source !== '' ? " AND company_lead_id IN (SELECT id FROM company_leads WHERE source = ?)" : '';
        $runKey = $source === 'linkedin' ? 'li_last_run' : 'ch_last_run';

        // Legacy per-stage counts (kept for anything still reading them).
        $counts = [1 => 0, 2 => 0, 3 => 0, 4 => 0, 5 => 0];
        $cs = $pdo->prepare("SELECT stage, COUNT(*) AS c FROM company_leads WHERE stage IS NOT NULL$srcWhere GROUP BY stage");
        $cs->execute($srcParams);
        foreach ($cs->fetchAll() as $r) $counts[(int)$r['stage']] = (int)$r['c'];
        // Milestone counts — how many records have each piece of info. Drives
        // the simplified dashboard. Column-based signals come from company_leads;
        // director/linkedin/staff come from the child tables (tenant-scoped).
        $colStmt = $pdo->prepare("SELECT COUNT(*) total,
                              SUM(url   IS NOT NULL AND url   <> '') website,
                              SUM(phone IS NOT NULL AND phone <> '') phone,
                              SUM(email IS NOT NULL AND email <> '') email,
                              SUM(industry IS NOT NULL AND industry <> '') industry,
                              SUM(address IS NOT NULL AND address <> '') address
                            FROM company_leads WHERE 1=1$srcWhere");
        $colStmt->execute($srcParams);
        $col = $colStmt->fetch();
        $dStmt = $pdo->prepare("SELECT COUNT(DISTINCT company_lead_id) FROM company_lead_contacts WHERE 1=1$childScope");
        $dStmt->execute($srcParams); $directors = (int)$dStmt->fetchColumn();
        $lStmt = $pdo->prepare("SELECT COUNT(DISTINCT company_lead_id) FROM company_lead_info WHERE name = 'LinkedIn (company)'$childScope");
        $lStmt->execute($srcParams); $companyLi = (int)$lStmt->fetchColumn();
        $sStmt = $pdo->prepare("SELECT COUNT(DISTINCT company_lead_id) FROM company_lead_info WHERE name LIKE 'Staff:%'$childScope");
        $sStmt->execute($srcParams); $staff = (int)$sStmt->fetchColumn();
        // Persisted summary of the most recent Qualify run (survives reloads).
        $lrStmt = $pdo->prepare("SELECT v FROM settings WHERE k = ?");
        $lrStmt->execute([$runKey]);
        $lrRaw = $lrStmt->fetchColumn();
        $lastRun = $lrRaw ? json_decode((string)$lrRaw, true) : null;
        Json::send([
            'stages' => $counts,
            'milestones' => [
                'total'     => (int)$col['total'],
                'address'   => (int)$col['address'],
                'directors' => $directors,
                'industry'  => (int)$col['industry'],
                'website'   => (int)$col['website'],
                'phone'     => (int)$col['phone'],
                'email'     => (int)$col['email'],
                'linkedin'  => $companyLi,
                'staff'     => $staff,
            ],
            'last_run' => is_array($lastRun) ? $lastRun : null,
        ]);
    }

    // ----- Save the most recent Qualify run summary (called by the UI when a
    // run finishes) so the dashboard's "Last run" module persists across loads.
    if ($sub === 'last-run') {
        if ($method !== 'POST') Json::fail('Method not allowed', 405);
        $body = Json::readBody();
        $f = is_array($body['found'] ?? null) ? $body['found'] : [];
        $payload = json_encode([
            'checked'  => (int)($body['checked'] ?? 0),
            'enriched' => (int)($body['enriched'] ?? 0),
            'found'    => [
                'directors' => (int)($f['directors'] ?? 0),
                'industry'  => (int)($f['industry'] ?? 0),
                'address'   => (int)($f['address'] ?? 0),
                'website'   => (int)($f['website'] ?? 0),
                'phone'     => (int)($f['phone'] ?? 0),
                'email'     => (int)($f['email'] ?? 0),
                'linkedin'  => (int)($f['linkedin'] ?? 0),
                'staff'     => (int)($f['staff'] ?? 0),
            ],
            'running'  => false,
            'at'       => date('c'),
        ]);
        // Per-source key so each pipeline page keeps its own last-run summary.
        $runKey = (trim((string)($body['source'] ?? '')) === 'linkedin') ? 'li_last_run' : 'ch_last_run';
        // tenant_id auto-injected by the rewriter (settings is composite PK'd
        // on (tenant_id, k) since migration 148), matching routes/settings.php.
        $pdo->prepare('INSERT INTO settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)')->execute([$runKey, $payload]);
        Json::send(['ok' => true]);
    }

    // ================= Cross-environment sync =========================
    // Local does the headless-heavy work (LinkedIn profiles/search); dev & prod
    // (Hostinger, no browser) receive the finished leads via these endpoints:
    //   GET  /company-leads/export        dump leads (+info +contacts) as JSON
    //   POST /company-leads/import        insert a leads batch (dedup)
    //   POST /company-leads/push          local → run export, ship it to a target
    // Gather leads (+ nested info/contacts) for export/push.
    $collectLeads = function (string $source = '', array $ids = []) use ($pdo) {
        $where = '1=1'; $params = [];
        if ($source !== '') { $where .= ' AND source = ?'; $params[] = $source; }
        if ($ids) { $where .= ' AND id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')'; $params = array_merge($params, $ids); }
        $stmt = $pdo->prepare("SELECT * FROM company_leads WHERE $where ORDER BY id");
        $stmt->execute($params);
        $rows = $stmt->fetchAll();
        $infoStmt = $pdo->prepare("SELECT name, value, sort_order FROM company_lead_info WHERE company_lead_id = ? ORDER BY sort_order, id");
        $conStmt  = $pdo->prepare("SELECT first_name, last_name, position, email, phone, linkedin_url, verified, is_primary, sort_order FROM company_lead_contacts WHERE company_lead_id = ? ORDER BY is_primary DESC, sort_order, id");
        $leads = [];
        foreach ($rows as $r) {
            $id = (int)$r['id']; $infoStmt->execute([$id]); $conStmt->execute([$id]);
            $leads[] = [
                'name' => $r['name'], 'company' => $r['company'], 'company_number' => $r['company_number'],
                'address' => $r['address'], 'phone' => $r['phone'], 'email' => $r['email'], 'url' => $r['url'],
                'url_status' => $r['url_status'], 'industry' => $r['industry'], 'source' => $r['source'], 'notes' => $r['notes'],
                'info' => $infoStmt->fetchAll(\PDO::FETCH_ASSOC), 'contacts' => $conStmt->fetchAll(\PDO::FETCH_ASSOC),
            ];
        }
        return $leads;
    };

    if ($sub === 'export') {
        if ($method !== 'GET') Json::fail('Method not allowed', 405);
        $source = trim((string)($_GET['source'] ?? ''));
        $ids = isset($_GET['ids']) && $_GET['ids'] !== '' ? array_values(array_filter(array_map('intval', explode(',', (string)$_GET['ids'])), fn($x) => $x > 0)) : [];
        $leads = $collectLeads($source, $ids);
        Json::send(['leads' => $leads, 'count' => count($leads)]);
    }

    if ($sub === 'import') {
        if ($method !== 'POST') Json::fail('Method not allowed', 405);
        $body  = Json::readBody();
        $leads = is_array($body['leads'] ?? null) ? $body['leads'] : [];
        // De-dupe against what's already stored: company number, then LinkedIn URL.
        $existNum = []; foreach ($pdo->query("SELECT company_number FROM company_leads WHERE company_number IS NOT NULL AND company_number <> ''")->fetchAll(\PDO::FETCH_COLUMN) as $n) $existNum[strtoupper((string)$n)] = true;
        $existLi = [];  foreach ($pdo->query("SELECT value FROM company_lead_info WHERE name = 'LinkedIn (company)'")->fetchAll(\PDO::FETCH_COLUMN) as $u) $existLi[strtolower(rtrim((string)$u, '/'))] = true;
        $insLead = $pdo->prepare('INSERT INTO company_leads
            (name, company, company_number, address, phone, email, url, url_status, industry, status, source, stage, stage_updated_at, notes, added_by_user_id, added_by_system)
            VALUES (?,?,?,?, ?,?,?,?, ?,?,?,?, ?,?,?,?)');
        $insInfo = $pdo->prepare('INSERT INTO company_lead_info (company_lead_id, name, value, sort_order) VALUES (?,?,?,?)');
        $insCon  = $pdo->prepare('INSERT INTO company_lead_contacts (company_lead_id, first_name, last_name, position, email, phone, linkedin_url, verified, is_primary, sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)');
        $now = date('Y-m-d H:i:s'); $inserted = 0; $skipped = 0;
        $pdo->beginTransaction();
        try {
            foreach ($leads as $L) {
                if (!is_array($L)) { $skipped++; continue; }
                $num = strtoupper(trim((string)($L['company_number'] ?? '')));
                $liUrl = '';
                foreach ((array)($L['info'] ?? []) as $i) if (($i['name'] ?? '') === 'LinkedIn (company)') $liUrl = strtolower(rtrim((string)($i['value'] ?? ''), '/'));
                if (($num !== '' && isset($existNum[$num])) || ($liUrl !== '' && isset($existLi[$liUrl]))) { $skipped++; continue; }
                if ($num !== '')   $existNum[$num] = true;
                if ($liUrl !== '') $existLi[$liUrl] = true;
                $insLead->execute([
                    (string)($L['name'] ?? 'Company'), ($L['company'] ?? null), ($num ?: null), ($L['address'] ?? null),
                    ($L['phone'] ?? null), ($L['email'] ?? null), ($L['url'] ?? null), ($L['url_status'] ?? null),
                    ($L['industry'] ?? null), 'new', (string)($L['source'] ?? 'import'), 1, $now, ($L['notes'] ?? null), $currentUserId, 1,
                ]);
                $lid = (int)$pdo->lastInsertId();
                foreach ((array)($L['info'] ?? []) as $i) $insInfo->execute([$lid, (string)($i['name'] ?? ''), (string)($i['value'] ?? ''), (int)($i['sort_order'] ?? 0)]);
                foreach ((array)($L['contacts'] ?? []) as $c) $insCon->execute([$lid, (string)($c['first_name'] ?? ''), ($c['last_name'] ?? null), ($c['position'] ?? null), ($c['email'] ?? null), ($c['phone'] ?? null), ($c['linkedin_url'] ?? null), (int)($c['verified'] ?? 0), (int)($c['is_primary'] ?? 0), (int)($c['sort_order'] ?? 0)]);
                $inserted++;
            }
            $pdo->commit();
        } catch (\Throwable $e) { $pdo->rollBack(); throw $e; }
        Json::send(['inserted' => $inserted, 'skipped' => $skipped, 'received' => count($leads)]);
    }

    if ($sub === 'push') {
        if ($method !== 'POST') Json::fail('Method not allowed', 405);
        $body   = Json::readBody();
        $target = (($body['target'] ?? '') === 'prod') ? 'prod' : 'dev';
        $source = trim((string)($body['source'] ?? ''));
        $ids    = array_values(array_filter(array_map('intval', (array)($body['ids'] ?? [])), fn($x) => $x > 0));
        $get = fn($k) => trim((string)($pdo->query("SELECT v FROM settings WHERE k = " . $pdo->quote($k))->fetchColumn() ?: ''));
        $url = rtrim($get("sync_{$target}_url"), '/'); $email = $get("sync_{$target}_email"); $pass = $get("sync_{$target}_pass");
        if ($url === '' || $email === '' || $pass === '') Json::fail("Set the {$target} sync target (URL + login) in Lead Gen → Settings.", 400);

        $httpJson = function (string $m, string $u, ?array $b = null, string $tok = '') {
            $ch = curl_init($u);
            $h = ['Content-Type: application/json']; if ($tok !== '') $h[] = 'Authorization: Bearer ' . $tok;
            curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 180, CURLOPT_SSL_VERIFYPEER => false, CURLOPT_CUSTOMREQUEST => $m, CURLOPT_HTTPHEADER => $h]);
            if ($b !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($b));
            $out = curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); $err = curl_error($ch); curl_close($ch);
            $d = json_decode((string)$out, true);
            return ['code' => $code, 'err' => $err, 'data' => is_array($d) ? $d : null];
        };
        $login = $httpJson('POST', $url . '/auth/login', ['email' => $email, 'password' => $pass]);
        $tok = (string)($login['data']['token'] ?? '');
        if ($tok === '') Json::fail("Could not sign in to {$target} ({$url}) — check the sync credentials. " . ($login['err'] ?: ('HTTP ' . $login['code'])), 502);
        $leads = $collectLeads($source, $ids);
        if (!$leads) Json::send(['target' => $target, 'pushed' => 0, 'result' => ['inserted' => 0, 'skipped' => 0]]);
        $imp = $httpJson('POST', $url . '/company-leads/import', ['leads' => $leads], $tok);
        if ($imp['data'] === null) Json::fail("{$target} import failed: " . ($imp['err'] ?: ('HTTP ' . $imp['code'])), 502);
        Json::send(['target' => $target, 'pushed' => count($leads), 'result' => $imp['data']]);
    }

    // ----- Stage 1: fetch companies -----
    if ($sub === 'fetch') {
        if ($method !== 'POST') Json::fail('Method not allowed', 405);
        $body   = Json::readBody();
        $days   = isset($body['days'])  ? max(0, min(30, (int)$body['days']))    : 1;
        $limit  = isset($body['limit']) ? max(1, min(1000, (int)$body['limit'])) : 200;
        $sector = trim((string)($body['sector'] ?? ''));
        // status: default 'active'; pass '' explicitly to include all.
        $status = array_key_exists('status', $body) ? trim((string)$body['status']) : 'active';

        $q = 'mode=companies&days=' . $days . '&limit=' . $limit . '&status=' . urlencode($status);
        if ($sector !== '') $q .= '&sector=' . urlencode($sector);

        $companies = $chApiFetch($q);
        $fetched   = count($companies);

        // Company numbers already stored for this tenant (rewriter scopes
        // the SELECT) — skip so a re-run only brings in genuinely new rows.
        $existing = [];
        foreach ($pdo->query('SELECT company_number FROM company_leads WHERE company_number IS NOT NULL')
                     ->fetchAll(\PDO::FETCH_COLUMN) as $cn) {
            $existing[strtoupper((string)$cn)] = true;
        }

        // tenant_id is auto-injected by the rewriter (leads is auto-scoped),
        // exactly like the create/bulk inserts above — so it is omitted here.
        // All-placeholder VALUES — the tenant rewriter injects tenant_id into
        // leads inserts and cannot parse literal values/functions in VALUES,
        // so stage / stage_updated_at / added_by_system are bound, not inline.
        $insLead = $pdo->prepare('INSERT INTO company_leads
            (name, company, company_number, address, status, source, stage, stage_updated_at,
             industry, added_by_user_id, added_by_system)
            VALUES (?,?,?,?, ?,?,?,?, ?,?,?)');
        $insInfo = $pdo->prepare('INSERT INTO company_lead_info (company_lead_id, name, value, sort_order) VALUES (?,?,?,?)');

        $now = date('Y-m-d H:i:s');
        $inserted = 0; $skipped = 0;
        // Map inserted company_number -> lead_id so we can immediately pull
        // directors for exactly the rows we just added, without a second
        // "click Enrich officers" step. CH's officers endpoint accepts a
        // batch of numbers, so this stays a single follow-up API call.
        $insertedMap = [];
        $pdo->beginTransaction();
        try {
            foreach ($companies as $co) {
                $num = strtoupper(trim((string)($co['company_number'] ?? '')));
                if ($num === '' || isset($existing[$num])) { $skipped++; continue; }
                $existing[$num] = true; // guard against dupes within this fetch

                $companyName = trim((string)($co['company_name'] ?? '')) ?: ('Company ' . $num);
                $insLead->execute([
                    $companyName,                                   // name (headline until a contact exists)
                    $companyName,                                   // company
                    $num,                                           // company_number
                    (trim((string)($co['registered_address'] ?? '')) ?: null), // address
                    'new',                                          // lead status
                    'companies-house',                              // source
                    1,                                              // stage
                    $now,                                           // stage_updated_at
                    (trim((string)($co['sector_group'] ?? '')) ?: null),       // industry
                    $currentUserId,
                    1,                                              // added_by_system
                ]);
                $leadId = (int)$pdo->lastInsertId();
                $insertedMap[$num] = $leadId;

                // Companies House facts -> Info tab entries.
                $facts = [
                    ['Company number', $num],
                    ['Incorporated',   (string)($co['registered']  ?? '')],
                    ['SIC codes',      (string)($co['sector_code']  ?? '')],
                    ['Sector',         (string)($co['sector']       ?? '')],
                    ['Sector group',   (string)($co['sector_group'] ?? '')],
                ];
                $so = 0;
                foreach ($facts as $f) {
                    if (trim((string)$f[1]) === '') continue;
                    $insInfo->execute([$leadId, $f[0], $f[1], $so++]);
                }
                $inserted++;
            }
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }

        // Spawn a detached background worker for officers enrichment.
        //
        // Why detached: Hostinger caps HTTP requests at 60s (nginx). A
        // 200-company officers batch takes ~90s of CH API round-trips,
        // and even the officers self-fetch goes through nginx so it too
        // hits the same 60s wall. `ignore_user_abort(true)` alone did
        // NOT keep PHP-FPM alive past connection close on this host
        // (verified 2026-09-03), and `fastcgi_finish_request()` isn't
        // available. `exec("... &")` fully decouples the worker from
        // the parent request via the OS scheduler, and the worker
        // itself is a CLI PHP process with no HTTP timeout.
        $directorsPending = 0;
        if ($insertedMap) {
            $payload = [
                'site_base'   => $selfScheme . '://' . $selfHost . $selfBase,
                'insertedMap' => $insertedMap,
            ];
            $tmp = tempnam(sys_get_temp_dir(), 'brs_officers_');
            file_put_contents($tmp, json_encode($payload));
            $workerPath = dirname(__DIR__) . '/workers/officers_worker.php';
            $tid = (int)\BRS\Tenant::id();
            // proc_open — `exec()` is disabled on Hostinger; proc_open
            // isn't. The trailing `&` backgrounds the child under a shell,
            // so proc_close returns immediately (waits only on the shell,
            // not the detached PHP worker).
            $cmd = escapeshellcmd(PHP_BINARY) . ' '
                 . escapeshellarg($workerPath) . ' '
                 . (int)$tid . ' '
                 . escapeshellarg($tmp)
                 . ' > /dev/null 2>&1 &';
            $proc = @proc_open($cmd, [
                0 => ['file', '/dev/null', 'r'],
                1 => ['file', '/dev/null', 'w'],
                2 => ['file', '/dev/null', 'w'],
            ], $pipes);
            if (is_resource($proc)) proc_close($proc);
            $directorsPending = count($insertedMap);
        }

        Json::send([
            'inserted' => $inserted, 'skipped' => $skipped, 'fetched' => $fetched,
            'directors_pending' => $directorsPending,
        ]);
    }

    // ----- Stage 1 (LinkedIn source): capture a company list from LinkedIn -----
    // The LinkedIn equivalent of the Companies House pull. Searches LinkedIn's
    // public company pages (via the indexed search) for keyword + location and
    // seeds the pipeline with source='linkedin'; the shared Qualify flow then
    // enriches each one. De-duped by LinkedIn company URL.
    if ($sub === 'fetch-linkedin') {
        if ($method !== 'POST') Json::fail('Method not allowed', 405);
        set_time_limit(0);
        $body     = Json::readBody();
        $keyword  = trim((string)($body['keyword'] ?? ''));
        $location = trim((string)($body['location'] ?? ''));   // free-text (DDG fallback + stored as address)
        $searchUrl = trim((string)($body['search_url'] ?? '')); // a full faceted search URL (region encoded)
        $geo      = preg_replace('/[^0-9]/', '', (string)($body['geo'] ?? '')); // companyHqGeo id
        $sizes    = array_values(array_filter(array_map(fn($s) => strtoupper(trim((string)$s)), (array)($body['sizes'] ?? [])), fn($s) => preg_match('/^[A-I]$/', $s)));
        // Chunked pagination: each call crawls `pages` result pages starting at
        // `start_page`, so the UI can loop and show live progress + the total.
        $startPage = isset($body['start_page']) ? max(1, (int)$body['start_page']) : 1;
        $pages     = isset($body['pages']) ? max(1, min(20, (int)$body['pages'])) : 3;
        if ($keyword === '' && $searchUrl === '' && $geo === '' && !$sizes) Json::fail('Provide a keyword, a region geo id, a company size, or a full LinkedIn search URL.', 400);

        // Authenticated crawl when a li_at cookie is stored — paginates the real
        // faceted results (keyword + region). Falls back to the keyless DDG index.
        $liAt = trim((string)($pdo->query("SELECT v FROM settings WHERE k = 'linkedin_li_at'")->fetchColumn() ?: ''));
        $companies = []; $total = 0; $toPage = $startPage; $done = true;
        if ($liAt !== '') {
            $liCsrf = trim((string)($pdo->query("SELECT v FROM settings WHERE k = 'linkedin_csrf'")->fetchColumn() ?: ''));
            $in = ['li_at' => $liAt, 'csrf' => $liCsrf, 'startPage' => $startPage, 'pages' => $pages, 'staggerMin' => 1, 'staggerMax' => 2];
            if ($searchUrl !== '') $in['url'] = $searchUrl;
            if ($geo !== '')       $in['geo'] = $geo;
            if ($sizes)            $in['sizes'] = $sizes;
            if ($keyword !== '')   $in['keyword'] = $keyword;
            $tmp = tempnam(sys_get_temp_dir(), 'lis_');
            file_put_contents($tmp, json_encode($in));
            $renderer = dirname(__DIR__, 2) . '/scraper/linkedin_company_search.js';
            $nodeBin  = file_exists('C:\\Program Files\\nodejs\\node.exe') ? 'C:\\Program Files\\nodejs\\node.exe' : 'node';
            $out = ''; $proc = proc_open([$nodeBin, $renderer, $tmp], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
            if (is_resource($proc)) { $out = stream_get_contents($pipes[1]); fclose($pipes[1]); fclose($pipes[2]); proc_close($proc); }
            @unlink($tmp);
            $data = json_decode($out, true);
            if (is_array($data) && empty($data['ok']) && ($data['note'] ?? '') !== '') Json::fail((string)$data['note'], 400);
            $companies = (is_array($data) && is_array($data['companies'] ?? null)) ? $data['companies'] : [];
            $total  = (int)($data['total'] ?? 0);
            $toPage = (int)($data['to_page'] ?? $startPage);
            $done   = !empty($data['exhausted']) || empty($companies);
        } else {
            // No cookie → keyless DuckDuckGo index (keyword only, no true region facet, single shot).
            $res = $selfGet('/scraper/linkedin_search.php', ['keyword' => $keyword, 'location' => $location, 'limit' => 100], 90);
            if (!empty($res['ratelimited'])) Json::fail((string)($res['note'] ?? 'LinkedIn search was rate-limited — wait a minute and try again.'), 429);
            $companies = is_array($res['companies'] ?? null) ? $res['companies'] : [];
            $done = true;
        }

        // LinkedIn URLs already stored (any source) — skip so re-runs only add new.
        $existing = [];
        foreach ($pdo->query("SELECT value FROM company_lead_info WHERE name = 'LinkedIn (company)'")->fetchAll(\PDO::FETCH_COLUMN) as $u) {
            $existing[strtolower(rtrim((string)$u, '/'))] = true;
        }

        $insLead = $pdo->prepare('INSERT INTO company_leads
            (name, company, address, status, source, stage, stage_updated_at, added_by_user_id, added_by_system)
            VALUES (?,?,?, ?,?,?,?, ?,?)');
        $insInfo = $pdo->prepare('INSERT INTO company_lead_info (company_lead_id, name, value, sort_order) VALUES (?,?,?,?)');

        $now = date('Y-m-d H:i:s');
        $inserted = 0; $skipped = 0;
        $pdo->beginTransaction();
        try {
            foreach ($companies as $co) {
                // crawler returns `url`; the DDG fallback returns `linkedin_url`.
                $url  = rtrim(trim((string)($co['linkedin_url'] ?? $co['url'] ?? '')), '/');
                $name = trim((string)($co['name'] ?? ''));
                if ($url === '' || $name === '' || isset($existing[strtolower($url)])) { $skipped++; continue; }
                $existing[strtolower($url)] = true;

                $insLead->execute([
                    $name,                 // name
                    $name,                 // company
                    ($location ?: null),   // address (the searched location, best-effort)
                    'new',                 // status
                    'linkedin',            // source
                    1,                     // stage
                    $now,                  // stage_updated_at
                    $currentUserId,
                    1,                     // added_by_system
                ]);
                $leadId = (int)$pdo->lastInsertId();
                // Store the company page so the LinkedIn enrich step treats it as done.
                $insInfo->execute([$leadId, 'LinkedIn (company)', $url, 0]);
                $insInfo->execute([$leadId, 'Search keyword', $keyword . ($location !== '' ? ' · ' . $location : ''), 1]);
                $inserted++;
            }
            $pdo->commit();
        } catch (\Throwable $e) { $pdo->rollBack(); throw $e; }

        Json::send([
            'inserted' => $inserted, 'skipped' => $skipped, 'fetched' => count($companies),
            'total' => $total,          // LinkedIn's reported result count for this search
            'to_page' => $toPage, 'next_page' => $toPage + 1,
            'done' => $done || $toPage >= 100,
        ]);
    }

    // ----- Stage 2: officers/directors (chunked) -----
    if ($sub === 'officers') {
        if ($method !== 'POST') Json::fail('Method not allowed', 405);
        $body  = Json::readBody();
        $chunk = isset($body['limit']) ? max(1, min(50, (int)$body['limit'])) : 20;

        $remainingBefore = (int)$pdo->query(
            "SELECT COUNT(*) FROM company_leads
              WHERE stage=1 AND company_number IS NOT NULL"
        )->fetchColumn();

        $sel = $pdo->query(
            "SELECT id, company_number FROM company_leads
              WHERE stage=1 AND company_number IS NOT NULL
              ORDER BY id LIMIT " . (int)$chunk
        );
        $batch = $sel->fetchAll();
        if (!$batch) Json::send(['processed' => 0, 'remaining' => 0, 'done' => true]);

        $numbers  = array_map(fn($r) => strtoupper($r['company_number']), $batch);
        $officers = $chApiFetch('mode=officers&numbers=' . urlencode(implode(',', $numbers)));

        $insContact = $pdo->prepare('INSERT INTO company_lead_contacts
            (company_lead_id, first_name, last_name, position, email, verified, is_primary, sort_order)
            VALUES (?,?,?,?,?,?,?,?)');
        $insInfo = $pdo->prepare('INSERT INTO company_lead_info (company_lead_id, name, value, sort_order) VALUES (?,?,?,?)');
        $advance = $pdo->prepare('UPDATE company_leads SET stage=2, stage_updated_at=NOW() WHERE id = ?');

        $processed = 0;
        $pdo->beginTransaction();
        try {
            foreach ($batch as $row) {
                $lid = (int)$row['id'];
                $num = strtoupper($row['company_number']);
                $people = $officers[$num] ?? [];

                // Continue Info sort_order after the stage-1 facts.
                $infoBase = (int)$pdo->query('SELECT COALESCE(MAX(sort_order),-1)+1 FROM company_lead_info WHERE company_lead_id = ' . $lid)->fetchColumn();

                $so = 0;
                foreach ($people as $i => $p) {
                    $first = $p['first'] !== '' ? $p['first'] : ($p['last'] ?: 'Director');
                    $insContact->execute([
                        $lid,
                        $first,
                        ($p['last'] !== '' ? $p['last'] : null),
                        ($p['role'] !== '' ? $p['role'] : 'director'),
                        null,                 // email unknown until a later stage
                        0,                    // verified
                        $i === 0 ? 1 : 0,     // first active director is primary
                        $so,
                    ]);

                    // One concise Info line capturing the officer detail CH returned.
                    $bits = [];
                    if ($p['appointed_on'] !== '') $bits[] = 'Appointed: ' . $p['appointed_on'];
                    if ($p['occupation']   !== '') $bits[] = 'Occupation: ' . $p['occupation'];
                    if ($p['nationality']  !== '') $bits[] = 'Nationality: ' . $p['nationality'];
                    // CH files this as the OFFICER's service/correspondence address
                    // (not necessarily the company's registered office) — label it.
                    if ($p['address']      !== '') $bits[] = 'Correspondence address: ' . $p['address'];
                    if ($bits) {
                        $label = 'Director: ' . ($p['full'] !== '' ? $p['full'] : trim($first . ' ' . $p['last']));
                        $insInfo->execute([$lid, $label, implode('; ', $bits), $infoBase + $so]);
                    }
                    $so++;
                }

                $advance->execute([$lid]);
                $processed++;
            }
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }

        $remaining = max(0, $remainingBefore - $processed);
        Json::send(['processed' => $processed, 'remaining' => $remaining, 'done' => $remaining === 0]);
    }

    // ----- Stage 3: Google Business profiles (chunked, staggered) -----
    // Walks stage-2 leads, resolves each against the official Google Places
    // API (via cms/scraper/google_places.php), fills in phone/website we
    // don't already have + records the Maps profile, then advances to
    // stage 3. Google never returns email — that stays a stage-4 job.
    if ($sub === 'profiles') {
        if ($method !== 'POST') Json::fail('Method not allowed', 405);
        set_time_limit(0);
        $body  = Json::readBody();
        // method=api (default, Places API) or method=scrape (free DuckDuckGo
        // fallback, no key — for when the Places credit runs out).
        $gmethod = (($body['method'] ?? 'api') === 'scrape') ? 'scrape' : 'api';

        // The API path needs no stagger (real quota) → 0. The scraper must
        // throttle so search engines don't flag it → random 1..15s. Both
        // are overridable. Chunk is smaller for the (slower) scraper.
        $isScrape = ($gmethod === 'scrape');
        $chunk = isset($body['limit']) ? max(1, min(20, (int)$body['limit'])) : ($isScrape ? 4 : 10);
        $sMin = isset($body['stagger_min']) ? max(0, (float)$body['stagger_min']) : ($isScrape ? 1.0 : 0.0);
        $sMax = isset($body['stagger_max']) ? max($sMin, (float)$body['stagger_max']) : ($isScrape ? 15.0 : 0.0);

        // Tenant's Google key (rewriter scopes the settings read). Only the
        // API path needs it; the scraper runs keyless.
        $gkey = trim((string)($pdo->query("SELECT v FROM settings WHERE k = 'google_maps_api_key'")->fetchColumn() ?: ''));
        if (!$isScrape && $gkey === '') {
            Json::fail('No Google Maps API key set. Add one in Lead Gen → Settings, or run Stage 3 with the no-key scraper.', 400);
        }

        $remainingBefore = (int)$pdo->query(
            "SELECT COUNT(*) FROM company_leads
              WHERE stage=2"
        )->fetchColumn();

        $sel = $pdo->query(
            "SELECT id, name, company, address, phone, url FROM company_leads
              WHERE stage=2
              ORDER BY id LIMIT " . (int)$chunk
        );
        $batch = $sel->fetchAll();
        if (!$batch) Json::send(['processed' => 0, 'remaining' => 0, 'done' => true, 'found' => 0]);

        // Self-fetch the Google crawler for one lead. Returns the decoded
        // array (may carry an 'error' key). Per-lead failures are soft; a
        // key/auth error aborts the whole run so the user fixes the key.
        $script = $_SERVER['SCRIPT_NAME'] ?? '';
        $gbase  = str_replace('/api/index.php', '', $script);
        if ($gbase === $script) $gbase = preg_replace('#/api(/.*)?$#', '', $_SERVER['REQUEST_URI'] ?? '') ?? '';
        $gscheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
        $ghost   = $_SERVER['HTTP_HOST'] ?? '127.0.0.1';
        $googleFetch = function (string $name, string $address) use ($gkey, $gmethod, $gbase, $gscheme, $ghost) {
            $params = ['name' => $name, 'address' => $address, 'method' => $gmethod];
            if ($gmethod === 'api') $params['key'] = $gkey;
            $url = $gscheme . '://' . $ghost . $gbase . '/scraper/google_places.php?' . http_build_query($params);
            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT        => 40,
                CURLOPT_SSL_VERIFYPEER => false,
            ]);
            $b = curl_exec($ch);
            curl_close($ch);
            $d = json_decode((string)$b, true);
            return is_array($d) ? $d : ['error' => 'Bad crawler response'];
        };

        $updLead = $pdo->prepare('UPDATE company_leads
            SET phone = ?, url = ?, stage = 3, stage_updated_at = NOW()
            WHERE id = ?');
        $insInfo = $pdo->prepare('INSERT INTO company_lead_info (company_lead_id, name, value, sort_order) VALUES (?,?,?,?)');

        $processed = 0; $found = 0;
        foreach ($batch as $i => $row) {
            // Polite random stagger between calls (skip before the first).
            if ($i > 0 && $sMax > 0) {
                usleep((int)((($sMin + (mt_rand(0, 1000) / 1000) * ($sMax - $sMin))) * 1_000_000));
            }

            $lid  = (int)$row['id'];
            $name = trim((string)($row['company'] !== '' ? $row['company'] : $row['name']));
            $g = $googleFetch($name, (string)($row['address'] ?? ''));

            // A key/auth problem is fatal for the whole run.
            if (!empty($g['error']) && preg_match('/api key|not valid|permission|billing|enabled/i', $g['error'])) {
                Json::fail('Google: ' . $g['error'], 502);
            }

            $pdo->beginTransaction();
            try {
                $infoBase = (int)$pdo->query('SELECT COALESCE(MAX(sort_order),-1)+1 FROM company_lead_info WHERE company_lead_id = ' . $lid)->fetchColumn();

                if (!empty($g['found'])) {
                    $found++;
                    // Fill phone/website only where we don't already have one.
                    $newPhone = (trim((string)$row['phone']) !== '') ? $row['phone'] : (trim((string)($g['phone'] ?? '')) ?: null);
                    $newUrl   = (trim((string)$row['url'])   !== '') ? $row['url']   : (trim((string)($g['website'] ?? '')) ?: null);
                    $updLead->execute([$newPhone, $newUrl, $lid]);

                    // Record the Google profile detail in the Info tab.
                    $facts = [
                        ['Google Maps',     (string)($g['maps_url'] ?? '')],
                        ['Google rating',   isset($g['rating']) && $g['rating'] !== null ? (string)$g['rating'] : ''],
                        ['Business status', (string)($g['business_status'] ?? '')],
                        ['Opening hours',   (string)($g['opening_hours'] ?? '')],
                        ['Google category', (string)($g['types'] ?? '')],
                    ];
                    $so = 0;
                    foreach ($facts as $f) {
                        if (trim((string)$f[1]) === '') continue;
                        $insInfo->execute([$lid, $f[0], $f[1], $infoBase + $so++]);
                    }
                } else {
                    // No result — advance the stage and flag the miss.
                    $updLead->execute([($row['phone'] ?: null), ($row['url'] ?: null), $lid]);
                    $missLabel = $isScrape ? 'Website search' : 'Google Business';
                    $missValue = $isScrape ? 'No website found' : 'No listing found';
                    $insInfo->execute([$lid, $missLabel, $missValue, $infoBase]);
                }
                $pdo->commit();
            } catch (\Throwable $e) {
                $pdo->rollBack();
                throw $e;
            }
            $processed++;
        }

        $remaining = max(0, $remainingBefore - $processed);
        Json::send(['processed' => $processed, 'remaining' => $remaining, 'done' => $remaining === 0, 'found' => $found]);
    }

    // ----- Stage 5: LinkedIn — company profile + staff (chunked) -------
    // Walks enriched leads (stage 2..4), resolves each company's LinkedIn
    // page and (cookie method only) its staff, storing the company URL +
    // staff (name + profile link) as company_lead_info, then advances to stage 5.
    // method=scrape is keyless best-effort (company URL only — LinkedIn
    // blocks unauthenticated staff access with HTTP 999); method=cookie
    // uses the tenant's stored li_at session.
    if ($sub === 'staff') {
        if ($method !== 'POST') Json::fail('Method not allowed', 405);
        set_time_limit(0);
        $body = Json::readBody();
        $lmethod = (($body['method'] ?? 'scrape') === 'cookie') ? 'cookie' : 'scrape';
        // LinkedIn is scraped in both modes → always throttle 1..15s.
        $chunk = isset($body['limit']) ? max(1, min(10, (int)$body['limit'])) : 3;
        $sMin = isset($body['stagger_min']) ? max(0, (float)$body['stagger_min']) : 1.0;
        $sMax = isset($body['stagger_max']) ? max($sMin, (float)$body['stagger_max']) : 15.0;

        // Cookie method needs the tenant's li_at (+ optional JSESSIONID).
        $liAt = trim((string)($pdo->query("SELECT v FROM settings WHERE k = 'linkedin_li_at'")->fetchColumn() ?: ''));
        $liCsrf = trim((string)($pdo->query("SELECT v FROM settings WHERE k = 'linkedin_csrf'")->fetchColumn() ?: ''));
        if ($lmethod === 'cookie' && $liAt === '') {
            Json::fail('No LinkedIn cookie set. Add your li_at cookie in Lead Gen → Settings, or run with the no-key scraper (company URL only).', 400);
        }

        $remainingBefore = (int)$pdo->query(
            "SELECT COUNT(*) FROM company_leads
              WHERE stage >= 2 AND stage < 5"
        )->fetchColumn();

        $sel = $pdo->query(
            "SELECT id, name, company, address FROM company_leads
              WHERE stage >= 2 AND stage < 5
              ORDER BY id LIMIT " . (int)$chunk
        );
        $batch = $sel->fetchAll();
        if (!$batch) Json::send(['processed' => 0, 'remaining' => 0, 'done' => true, 'found' => 0, 'staff' => 0]);

        // ---- Cookie mode: Node + Playwright renderer --------------------
        // LinkedIn lazy-loads the staff list via JS, so a real browser is
        // needed (curl sees an empty shell). One browser handles the whole
        // chunk; the renderer does the 1..15s stagger between companies.
        // LOCAL/VPS ONLY — needs node + playwright + a chromium binary,
        // which shared hosting lacks; method=scrape is the portable path.
        if ($lmethod === 'cookie') {
            $companies = [];
            foreach ($batch as $row) {
                $companies[] = [
                    'id'       => (int)$row['id'],
                    'name'     => ($row['company'] !== '' ? $row['company'] : $row['name']),
                    'location' => (string)($row['address'] ?? ''),
                ];
            }
            $tmp = tempnam(sys_get_temp_dir(), 'li_');
            file_put_contents($tmp, json_encode([
                'li_at' => $liAt, 'csrf' => $liCsrf,
                'staggerMin' => $sMin, 'staggerMax' => $sMax, 'companies' => $companies,
            ]));

            $renderer = dirname(__DIR__, 2) . '/scraper/linkedin_render.js';
            $nodeBin  = file_exists('C:\\Program Files\\nodejs\\node.exe') ? 'C:\\Program Files\\nodejs\\node.exe' : 'node';
            $out = ''; $err = '';
            $proc = proc_open([$nodeBin, $renderer, $tmp], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
            if (is_resource($proc)) {
                $out = stream_get_contents($pipes[1]); fclose($pipes[1]);
                $err = stream_get_contents($pipes[2]); fclose($pipes[2]);
                proc_close($proc);
            }
            @unlink($tmp);

            $data = json_decode($out, true);
            if (!is_array($data)) {
                Json::fail('LinkedIn renderer did not run. It needs Node + Playwright (local/VPS only). ' . trim(substr((string)$err, -200)), 502);
            }
            if (!empty($data['error']) && preg_match('/cookie_invalid|login|authwall|checkpoint/i', $data['error'])) {
                Json::fail('LinkedIn rejected the session cookie — refresh your li_at in Lead Gen → Settings.', 502);
            }
            if (!empty($data['error'])) Json::fail('LinkedIn renderer: ' . $data['error'], 502);

            $insInfo = $pdo->prepare('INSERT INTO company_lead_info (company_lead_id, name, value, sort_order) VALUES (?,?,?,?)');
            $advance = $pdo->prepare('UPDATE company_leads SET stage = 5, stage_updated_at = NOW() WHERE id = ?');
            $byId = [];
            foreach (($data['results'] ?? []) as $r) $byId[(int)$r['id']] = $r;

            $processed = 0; $found = 0; $staffTotal = 0;
            foreach ($batch as $row) {
                $lid = (int)$row['id'];
                $r = $byId[$lid] ?? ['company_url' => '', 'staff' => []];
                $pdo->beginTransaction();
                try {
                    $infoBase = (int)$pdo->query('SELECT COALESCE(MAX(sort_order),-1)+1 FROM company_lead_info WHERE company_lead_id = ' . $lid)->fetchColumn();
                    $so = $infoBase;
                    $cu = trim((string)($r['company_url'] ?? ''));
                    if ($cu !== '') { $insInfo->execute([$lid, 'LinkedIn (company)', $cu, $so++]); $found++; }
                    foreach (($r['staff'] ?? []) as $person) {
                        $pname = trim((string)($person['name'] ?? ''));
                        $purl  = trim((string)($person['url'] ?? ''));
                        if ($purl === '') continue;
                        $insInfo->execute([$lid, 'Staff: ' . ($pname !== '' ? $pname : 'LinkedIn profile'), $purl, $so++]);
                        $staffTotal++;
                    }
                    if ($cu === '' && empty($r['staff'])) {
                        $insInfo->execute([$lid, 'LinkedIn', 'Nothing found', $so++]);
                    }
                    $advance->execute([$lid]);
                    $pdo->commit();
                } catch (\Throwable $e) { $pdo->rollBack(); throw $e; }
                $processed++;
            }
            $remaining = max(0, $remainingBefore - $processed);
            Json::send(['processed' => $processed, 'remaining' => $remaining, 'done' => $remaining === 0, 'found' => $found, 'staff' => $staffTotal]);
        }

        // ---- Scrape mode (no cookie): per-lead DDG via linkedin.php -----
        // Primary director (from stage 2) to match the company on LinkedIn.
        $dirStmt = $pdo->prepare("SELECT first_name, last_name FROM company_lead_contacts
                                   WHERE company_lead_id = ? ORDER BY is_primary DESC, sort_order, id LIMIT 1");

        $script = $_SERVER['SCRIPT_NAME'] ?? '';
        $lbase  = str_replace('/api/index.php', '', $script);
        if ($lbase === $script) $lbase = preg_replace('#/api(/.*)?$#', '', $_SERVER['REQUEST_URI'] ?? '') ?? '';
        $lscheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
        $lhost   = $_SERVER['HTTP_HOST'] ?? '127.0.0.1';
        $liFetch = function (array $params) use ($lbase, $lscheme, $lhost) {
            $url = $lscheme . '://' . $lhost . $lbase . '/scraper/linkedin.php?' . http_build_query($params);
            $ch = curl_init($url);
            curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 100, CURLOPT_SSL_VERIFYPEER => false]);
            $b = curl_exec($ch);
            curl_close($ch);
            $d = json_decode((string)$b, true);
            return is_array($d) ? $d : ['error' => 'Bad crawler response'];
        };

        $insInfo = $pdo->prepare('INSERT INTO company_lead_info (company_lead_id, name, value, sort_order) VALUES (?,?,?,?)');
        $advance = $pdo->prepare('UPDATE company_leads SET stage = 5, stage_updated_at = NOW() WHERE id = ?');

        $processed = 0; $found = 0; $staffTotal = 0;
        foreach ($batch as $i => $row) {
            if ($i > 0 && $sMax > 0) {
                usleep((int)((($sMin + (mt_rand(0, 1000) / 1000) * ($sMax - $sMin))) * 1_000_000));
            }
            $lid = (int)$row['id'];
            $dirStmt->execute([$lid]);
            $dir = $dirStmt->fetch() ?: ['first_name' => '', 'last_name' => ''];

            $res = $liFetch([
                'name'     => ($row['company'] !== '' ? $row['company'] : $row['name']),
                'location' => (string)($row['address'] ?? ''),
                'first'    => (string)$dir['first_name'],
                'last'     => (string)($dir['last_name'] ?? ''),
                'method'   => $lmethod,
                'li_at'    => $lmethod === 'cookie' ? $liAt : '',
                'csrf'     => $lmethod === 'cookie' ? $liCsrf : '',
            ]);

            // An expired/blocked cookie is fatal for the run.
            if (!empty($res['error']) && preg_match('/cookie|999|expired|session/i', $res['error'])) {
                Json::fail('LinkedIn: ' . $res['error'], 502);
            }
            // Search-engine throttle: stop WITHOUT advancing this lead, so it
            // (and the rest) are retried on the next run rather than wrongly
            // marked done-with-nothing. Return what we already processed.
            if (!empty($res['ratelimited'])) {
                $remaining = max(0, $remainingBefore - $processed);
                Json::send(['processed' => $processed, 'remaining' => $remaining, 'done' => false,
                            'found' => $found, 'staff' => $staffTotal, 'ratelimited' => true]);
            }

            $pdo->beginTransaction();
            try {
                $infoBase = (int)$pdo->query('SELECT COALESCE(MAX(sort_order),-1)+1 FROM company_lead_info WHERE company_lead_id = ' . $lid)->fetchColumn();
                $so = $infoBase;
                if (!empty($res['company_url'])) {
                    $insInfo->execute([$lid, 'LinkedIn (company)', $res['company_url'], $so++]);
                    $found++;
                }
                if (!empty($res['director_url'])) {
                    $insInfo->execute([$lid, 'LinkedIn (director)', $res['director_url'], $so++]);
                }
                foreach (($res['staff'] ?? []) as $person) {
                    $pname = trim((string)($person['name'] ?? ''));
                    $purl  = trim((string)($person['url'] ?? ''));
                    if ($purl === '') continue;
                    $insInfo->execute([$lid, 'Staff: ' . ($pname !== '' ? $pname : 'LinkedIn profile'), $purl, $so++]);
                    $staffTotal++;
                }
                if (empty($res['company_url']) && empty($res['staff'])) {
                    $insInfo->execute([$lid, 'LinkedIn', 'Nothing found', $so++]);
                }
                $advance->execute([$lid]);
                $pdo->commit();
            } catch (\Throwable $e) {
                $pdo->rollBack();
                throw $e;
            }
            $processed++;
        }

        $remaining = max(0, $remainingBefore - $processed);
        Json::send(['processed' => $processed, 'remaining' => $remaining, 'done' => $remaining === 0, 'found' => $found, 'staff' => $staffTotal]);
    }

    // ----- Qualify: one bundled enrichment pass per lead ------------------
    // Walks records in id order (cursor via after_id) and, for each, runs ONLY
    // the searches whose data is still missing — Companies House officers (no
    // directors), Google (no website), LinkedIn (no company page). Re-runnable:
    // start again from after_id=0 to re-check records whose data may since have
    // appeared. `stage` is set to 5 to mark "qualified"; the real completeness
    // signal is the per-field State icons on the list.
    if ($sub === 'qualify') {
        if ($method !== 'POST') Json::fail('Method not allowed', 405);
        set_time_limit(0);
        $body    = Json::readBody();
        $limit   = isset($body['limit']) ? max(1, min(20, (int)$body['limit'])) : 3;
        $afterId = max(0, (int)($body['after_id'] ?? 0));
        // Optional explicit id list — re-qualify one company (info panel) or a
        // bulk selection. When present it overrides the cursor and processes
        // exactly those records in a single pass.
        $ids = array_values(array_filter(array_map('intval', (array)($body['ids'] ?? [])), fn($x) => $x > 0));
        $sMin = isset($body['stagger_min']) ? max(0, (float)$body['stagger_min']) : 1.0;
        $sMax = isset($body['stagger_max']) ? max($sMin, (float)$body['stagger_max']) : 8.0;
        // Cursor pass is scoped to the calling page's source; the ids pass is not.
        $source = trim((string)($body['source'] ?? ''));
        $srcWhere = $source !== '' ? ' AND source = ?' : '';

        // The bundled pass just runs every single-step enricher, in order, per
        // record — the exact same closures the individual /:id/{step} endpoints use.
        $E = $makeEnrichers($body);

        $cols = "id, name, company, company_number, address, url, url_status, phone, email";
        if ($ids) {
            $ph = implode(',', array_fill(0, count($ids), '?'));
            $sel = $pdo->prepare("SELECT $cols FROM company_leads WHERE id IN ($ph) ORDER BY id");
            $sel->execute($ids);
        } else {
            $sel = $pdo->prepare("SELECT $cols FROM company_leads WHERE id > ?$srcWhere ORDER BY id LIMIT " . (int)$limit);
            $sel->execute($source !== '' ? [$afterId, $source] : [$afterId]);
        }
        $batch = $sel->fetchAll();
        if (!$batch) Json::send(['processed' => 0, 'last_id' => $afterId, 'remaining' => 0, 'done' => true, 'enriched' => 0]);

        $processed = 0; $enriched = 0; $lastId = $afterId;
        $found = ['directors' => 0, 'industry' => 0, 'address' => 0, 'website' => 0, 'phone' => 0, 'email' => 0, 'linkedin' => 0, 'staff' => 0];
        foreach ($batch as $i => $row) {
            if ($i > 0 && $sMax > 0) usleep((int)((($sMin + (mt_rand(0, 1000) / 1000) * ($sMax - $sMin))) * 1_000_000));
            $lid = (int)$row['id']; $lastId = $lid;
            $s   = $stateFromRow($row);
            $so  = (int)$pdo->query('SELECT COALESCE(MAX(sort_order),-1)+1 FROM company_lead_info WHERE company_lead_id = ' . $lid)->fetchColumn();
            $did = false;

            $pdo->beginTransaction();
            try {
                // Same single-step enrichers as the individual endpoints, run in order.
                // 0) LinkedIn profile first — fills website/address/industry/staff for LinkedIn leads.
                $r = $E['profile']($lid, $s, $so);   $found['website'] += $r['website']; $found['address'] += $r['address']; $found['industry'] += ($r['industry'] ?? 0); if (($r['staff'] ?? 0) > 0) $found['staff']++; $did = $did || $r['found'] > 0;
                // 0.5) Companies House match — backfills the number so officers can run.
                $r = $E['chmatch']($lid, $s, $so);   $found['address'] += ($r['address'] ?? 0); $did = $did || $r['found'] > 0;
                $r = $E['officers']($lid, $s, $so);  $found['directors'] += $r['found'];  $did = $did || $r['found'] > 0;
                $r = $E['google']($lid, $s, $so);    $found['website'] += $r['website']; $found['phone'] += $r['phone']; $found['address'] += $r['address']; $did = $did || $r['found'] > 0;
                $E['domain']($lid, $s, $so);
                $r = $E['linkedin']($lid, $s, $so);  $found['linkedin'] += $r['found']; if ($r['staff'] > 0) $found['staff']++; $did = $did || $r['found'] > 0 || $r['staff'] > 0;
                $r = $E['contact']($lid, $s, $so);   $found['email'] += $r['email']; $found['phone'] += $r['phone']; $did = $did || $r['found'] > 0;

                $E['persist']($lid, $s);
                $pdo->commit();
            } catch (\Throwable $e) { $pdo->rollBack(); throw $e; }
            $processed++;
            if ($did) $enriched++;
        }

        if ($ids) {
            // Explicit id pass: the batch was the whole job, so it's done.
            Json::send(['processed' => $processed, 'last_id' => $lastId, 'remaining' => 0, 'done' => true, 'enriched' => $enriched, 'found' => $found]);
        }
        $rem = $pdo->prepare("SELECT COUNT(*) FROM company_leads WHERE id > ?$srcWhere");
        $rem->execute($source !== '' ? [$lastId, $source] : [$lastId]);
        $remaining = (int)$rem->fetchColumn();
        Json::send(['processed' => $processed, 'last_id' => $lastId, 'remaining' => $remaining, 'done' => $remaining === 0, 'enriched' => $enriched, 'found' => $found]);
    }

    Json::fail('Not found', 404);
};
