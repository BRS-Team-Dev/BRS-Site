<?php
declare(strict_types=1);

use BRS\Auth;
use BRS\Db;
use BRS\Json;
use BRS\Mailer;
use BRS\Tenant;

/*
 * Mailer - write one message and send it to a filtered slice of the CRM.
 *
 *   GET    /api/mailer/industries          distinct industries across both audiences
 *   GET    /api/mailer/roles               contact roles present, for role targeting
 *   GET    /api/mailer/sources             lead acquisition sources, for source targeting
 *   GET    /api/mailer/audience            resolve recipients
 *                                          (?audience=&industry=&q=&send_to=&role=&source=)
 *                                          send_to: company | primary | role | all
 *                                          source is leads-only (clients hold none)
 *   GET    /api/mailer/placeholders        the substitution tokens the UI offers
 *   GET    /api/mailer/templates           saved templates
 *   POST   /api/mailer/templates           create
 *   PUT    /api/mailer/templates/:id       update
 *   DELETE /api/mailer/templates/:id       remove
 *   POST   /api/mailer/send                send to an explicit recipient list
 *   GET    /api/mailer/sends               send history
 *   GET    /api/mailer/sends/:id           one send with its per-recipient log
 *
 * Relationship to Newsletter (routes/newsletter.php): Newsletter is a
 * broadcast with a block-built body and an unsubscribe footer. Mailer is a
 * targeted message with per-recipient placeholders. They deliberately SHARE
 * delivery (BRS\Mailer::send) and the global `newsletter_suppressions`
 * table, so unsubscribing once stops mail from both.
 */

/**
 * Placeholder tokens offered in the composer, and how each resolves.
 *
 * The key is the token written as {{key}}. `lead` / `client` name the column
 * each audience reads it from; null means "not available for that audience"
 * and falls back to the empty string rather than leaving a raw {{token}} in
 * someone's inbox.
 */
const BRS_MAILER_PLACEHOLDERS = [
    // Person tokens. These come from the record's CONTACT (a director or
    // named contact), never from the record's own `name` - on a company lead
    // that field holds the company, so deriving a first name from it greets
    // "Ashwood Court (New - Nottingham)" as "Hi Ashwood".
    'first_name'     => ['label' => 'Contact first name', 'person' => true,  'lead' => true,  'client' => true],
    'last_name'      => ['label' => 'Contact last name',  'person' => true,  'lead' => true,  'client' => true],
    'contact_name'   => ['label' => 'Contact full name',  'person' => true,  'lead' => true,  'client' => true],
    'job_title'      => ['label' => 'Contact job title',  'person' => true,  'lead' => true,  'client' => true],
    // Record tokens.
    // `id` is the row's own primary key - the lead id or the client id
    // depending on which the recipient is. Useful as a reference number in
    // the body ("quote ref {{id}}"), and it round-trips back to the record.
    'id'             => ['label' => 'Lead / client ID', 'person' => false, 'lead' => true, 'client' => true],
    // `id_type` is 'lead' or 'client' - exactly the values the page-view
    // endpoint accepts - so a tracked link is written once and is right for a
    // mixed audience: ?id={{id}}&id_type={{id_type}}. A hardcoded
    // id_type=lead records every client as a lead.
    'id_type'        => ['label' => 'Lead / client type', 'person' => false, 'lead' => true, 'client' => true],
    'name'           => ['label' => 'Record name',    'person' => false, 'lead' => true,  'client' => true],
    'company'        => ['label' => 'Company',        'person' => false, 'lead' => true,  'client' => true],
    'email'          => ['label' => 'Email',          'person' => false, 'lead' => true,  'client' => true],
    'phone'          => ['label' => 'Phone',          'person' => false, 'lead' => true,  'client' => true],
    'industry'       => ['label' => 'Industry',       'person' => false, 'lead' => true,  'client' => true],
    'address'        => ['label' => 'Address',        'person' => false, 'lead' => true,  'client' => true],
    'website'        => ['label' => 'Website',        'person' => false, 'lead' => true,  'client' => true],
    'company_number' => ['label' => 'Company number', 'person' => false, 'lead' => true,  'client' => false],
    'status'         => ['label' => 'Lead status',    'person' => false, 'lead' => true,  'client' => false],
    'source'         => ['label' => 'Lead source',    'person' => false, 'lead' => true,  'client' => false],
];

/** Tokens that need a named contact to resolve to anything. */
/**
 * What happened AFTER delivery, set by hand from the Sent emails page (or
 * 'followed_up' automatically when a follow-up goes out to that row).
 * Distinct from `status`, which is the delivery result and never changes.
 * The single source of truth: the UI reads it from GET /api/mailer/outcomes.
 */
const BRS_MAILER_OUTCOMES = [
    'replied'        => 'Replied',
    'interested'     => 'Interested',
    'not_interested' => 'Not interested',
    'meeting_booked' => 'Meeting booked',
    'followed_up'    => 'Followed up',
    'bounced'        => 'Bounced',
    'no_response'    => 'No response',
];

/**
 * Load the full record + contact set for a batch of lead / client ids, the
 * shape every recipient row is rendered from. Shared by the send and the
 * follow-up picker so both resolve placeholders against the same fields.
 * Returns [$records, $contacts], each keyed kind => id => ...
 */
function brs_mailer_load_records($pdo, array $byKind): array
{
    $records = ['lead' => [], 'client' => []];
    $conts   = ['lead' => [], 'client' => []];

    if (!empty($byKind['lead'])) {
        $ids = array_keys($byKind['lead']);
        $in  = implode(',', array_fill(0, count($ids), '?'));
        $st  = $pdo->prepare("SELECT id, name, email, phone, company, industry, address, url,
                                     company_number, status, source
                                FROM leads WHERE id IN ($in)");
        $st->execute($ids);
        foreach ($st->fetchAll() as $r) {
            $r['_kind'] = 'lead';
            $r['website'] = $r['url'];
            $records['lead'][(int)$r['id']] = $r;
        }
        $conts['lead'] = brs_mailer_contacts($pdo, 'lead_contacts', 'lead_id', $ids);
    }
    if (!empty($byKind['client'])) {
        $ids = array_keys($byKind['client']);
        $in  = implode(',', array_fill(0, count($ids), '?'));
        $st  = $pdo->prepare("SELECT c.id, c.name, c.phone, c.company, c.industry, c.address, c.url,
                                     COALESCE(NULLIF(pc.email, ''), c.email) AS email
                                FROM clients c
                                LEFT JOIN client_contacts pc ON pc.client_id = c.id AND pc.is_primary = 1
                               WHERE c.id IN ($in) GROUP BY c.id");
        $st->execute($ids);
        foreach ($st->fetchAll() as $r) {
            $r['_kind'] = 'client';
            $r['website'] = $r['url'];
            $r['company_number'] = null; $r['status'] = null; $r['source'] = null;
            $records['client'][(int)$r['id']] = $r;
        }
        $conts['client'] = brs_mailer_contacts($pdo, 'client_contacts', 'client_id', $ids);
    }
    return [$records, $conts];
}

function brs_mailer_person_tokens(): array
{
    $out = [];
    foreach (BRS_MAILER_PLACEHOLDERS as $k => $d) if (!empty($d['person'])) $out[] = $k;
    return $out;
}

/**
 * Best contact per parent record, keyed by parent id.
 *
 * "Best" is the primary contact if one is flagged, else the first by sort
 * order. Companies House enrichment writes directors into these tables with
 * position='director', so a company lead usually has a real person here even
 * though its own `name` column is the company.
 */
function brs_mailer_contacts($pdo, string $table, string $fk, array $ids): array
{
    if (!$ids) return [];
    $in = implode(',', array_fill(0, count($ids), '?'));
    $st = $pdo->prepare("SELECT id, $fk AS pid, first_name, last_name, position, email
                           FROM $table WHERE $fk IN ($in)
                          ORDER BY $fk, is_primary DESC, sort_order, id");
    $st->execute($ids);
    $out = [];
    foreach ($st->fetchAll() as $r) {
        $pid   = (int)$r['pid'];
        $first = trim((string)$r['first_name']);
        $last  = trim((string)$r['last_name']);
        if ($first === '' && $last === '') continue;
        // Ordering above means index 0 of each list is the "best" contact:
        // the flagged primary, else the lowest sort order.
        $out[$pid][] = [
            'contact_id'   => (int)$r['id'],
            'first_name'   => $first,
            'last_name'    => $last,
            'contact_name' => trim($first . ' ' . $last),
            'job_title'    => trim((string)$r['position']),
            'email'        => trim((string)$r['email']),
        ];
    }
    return $out;
}

/** Roles compare case- and punctuation-insensitively: Companies House emits
 *  'director', 'nominee-director', 'llp-member' and friends. */
function brs_mailer_norm_role(?string $s): string
{
    return trim(preg_replace('/[^a-z0-9]+/', ' ', strtolower((string)$s)));
}

/**
 * Turn ONE record into the recipient rows it should produce, given how the
 * sender chose to target contacts.
 *
 *   company  - one message to the record's own address, no person attached.
 *              For a generic info@ inbox where naming a person is wrong.
 *   primary  - one message to the main contact (default; previous behaviour).
 *   role     - one message per contact holding the chosen role.
 *   all      - one message per contact on the record.
 *
 * In role/all mode a contact with no address of its own falls back to the
 * record's inbox. Several such contacts therefore collapse to one message at
 * the de-dupe step rather than mailing the same inbox repeatedly.
 */
function brs_mailer_expand(array $record, array $contacts, string $sendTo, string $role): array
{
    $recordEmail = trim((string)($record['email'] ?? ''));

    if ($sendTo === 'company') {
        if ($recordEmail === '') return [];
        return [brs_mailer_apply_contact($record, null)];
    }

    if ($sendTo === 'primary') {
        return [brs_mailer_apply_contact($record, $contacts[0] ?? null)];
    }

    $wanted = $contacts;
    if ($sendTo === 'role') {
        $want = brs_mailer_norm_role($role);
        $wanted = array_values(array_filter(
            $contacts,
            fn(array $c): bool => brs_mailer_norm_role($c['job_title']) === $want
        ));
    }

    $out = [];
    foreach ($wanted as $c) {
        $row = brs_mailer_apply_contact($record, $c);
        if (trim((string)$row['email']) === '') continue;   // no personal and no record inbox
        $out[] = $row;
    }
    return $out;
}

/** Merge a resolved contact onto a record row, leaving person tokens blank
 *  when there is no contact rather than inventing one from the company name. */
function brs_mailer_apply_contact(array $row, ?array $contact): array
{
    // {{id_type}}: every recipient row passes through here in BOTH audience
    // resolution and send, so this is the single place it can be set for all
    // of them. `_kind` is 'lead' | 'client' - the values page-view accepts.
    $row['id_type']      = $row['_kind'] ?? '';
    $row['first_name']   = $contact['first_name']   ?? '';
    $row['last_name']    = $contact['last_name']    ?? '';
    $row['contact_name'] = $contact['contact_name'] ?? '';
    $row['job_title']    = $contact['job_title']    ?? '';
    $row['contact_id']   = $contact['contact_id']   ?? null;
    $row['has_person']   = $contact ? 1 : 0;
    // Address the person we are greeting, when we hold their own address.
    // Otherwise we reach them at the record's inbox - flagged so the sender
    // can see they are writing to a shared mailbox, not to that person.
    if (!empty($contact['email'])) {
        $row['email'] = $contact['email'];
        $row['via_company_inbox'] = 0;
    } else {
        $row['via_company_inbox'] = $contact ? 1 : 0;
    }
    return $row;
}

/**
 * Substitute {{tokens}} for one recipient.
 *
 * Values are HTML-escaped: a company called "Smith & Sons" must not break
 * the message body, and a hostile value must not inject markup. Unknown or
 * unavailable tokens collapse to an empty string so nothing raw ever ships.
 */
function brs_mailer_render(string $body, array $row): string
{
    return preg_replace_callback('/\{\{\s*([a-z_]+)\s*\}\}/i', function (array $m) use ($row): string {
        $key = strtolower($m[1]);
        if (!isset(BRS_MAILER_PLACEHOLDERS[$key])) return '';
        return htmlspecialchars((string)($row[$key] ?? ''), ENT_QUOTES, 'UTF-8');
    }, $body);
}

return function (string $method, array $segs): void {
    Auth::require();
    $pdo = Db::tpdo();
    $sub = $segs[1] ?? '';
    $userId = (int)(Tenant::userId() ?? 0) ?: null;

    /**
     * Resolve the recipient set for an audience + industry filter.
     *
     * Clients are mailed at their primary contact's address where one is
     * flagged, falling back to `clients.email` - the same rule the newsletter
     * uses, so the two features agree on where a client's mail goes.
     */
    $resolve = function (string $audience, string $industry, string $q,
                         string $sendTo = 'primary', string $role = '',
                         string $source = '') use ($pdo): array {
        $rows = [];
        $like = '%' . $q . '%';

        if ($audience === 'leads' || $audience === 'both') {
            $where = ["(l.email IS NOT NULL AND l.email <> '')"];
            $args  = [];
            if ($industry !== '') { $where[] = 'l.industry = ?'; $args[] = $industry; }
            // Acquisition source. Compared case-insensitively because the value
            // is part machine-written ('companies-house', 'linkedin', 'google')
            // and part free text typed on an import or by hand.
            if ($source !== '') { $where[] = 'LOWER(TRIM(l.source)) = ?'; $args[] = strtolower(trim($source)); }
            if ($q !== '') {
                $where[] = '(l.name LIKE ? OR l.company LIKE ? OR l.email LIKE ?)';
                array_push($args, $like, $like, $like);
            }
            $sql = 'SELECT l.id, l.name, l.email, l.phone, l.company, l.industry, l.address,
                           l.url, l.company_number, l.status, l.source
                      FROM leads l WHERE ' . implode(' AND ', $where) . ' ORDER BY l.name LIMIT 5000';
            $st = $pdo->prepare($sql);
            $st->execute($args);
            $leadRows = $st->fetchAll();
            $contacts = brs_mailer_contacts($pdo, 'lead_contacts', 'lead_id',
                array_map(fn(array $r): int => (int)$r['id'], $leadRows));
            foreach ($leadRows as $r) {
                $r['_kind'] = 'lead';
                $r['website'] = $r['url'];
                foreach (brs_mailer_expand($r, $contacts[(int)$r['id']] ?? [], $sendTo, $role) as $x) $rows[] = $x;
            }
        }

        // Clients hold no acquisition source - `source` lives on `leads` only,
        // and is not carried across on promote (a converted client's origin is
        // recorded by the lead it came from, not on the client row). So a
        // source filter is inherently leads-only: rather than silently
        // returning clients that ignore the filter, drop them and let the UI
        // say why.
        $skipClients = $source !== '';

        if (!$skipClients && ($audience === 'clients' || $audience === 'both')) {
            $where = ['1=1'];
            $args  = [];
            if ($industry !== '') { $where[] = 'c.industry = ?'; $args[] = $industry; }
            if ($q !== '') {
                $where[] = '(c.name LIKE ? OR c.company LIKE ? OR c.email LIKE ?)';
                array_push($args, $like, $like, $like);
            }
            $sql = 'SELECT c.id, c.name, c.phone, c.company, c.industry, c.address, c.url,
                           COALESCE(NULLIF(pc.email, ""), c.email) AS email
                      FROM clients c
                      LEFT JOIN client_contacts pc
                             ON pc.client_id = c.id AND pc.is_primary = 1
                     WHERE ' . implode(' AND ', $where) . '
                     GROUP BY c.id
                     ORDER BY c.name LIMIT 5000';
            $st = $pdo->prepare($sql);
            $st->execute($args);
            $clientRows = $st->fetchAll();
            $contacts = brs_mailer_contacts($pdo, 'client_contacts', 'client_id',
                array_map(fn(array $r): int => (int)$r['id'], $clientRows));
            foreach ($clientRows as $r) {
                $r['_kind'] = 'client';
                $r['website'] = $r['url'];
                $r['company_number'] = null; $r['status'] = null; $r['source'] = null;
                foreach (brs_mailer_expand($r, $contacts[(int)$r['id']] ?? [], $sendTo, $role) as $x) {
                    if (trim((string)$x['email']) === '') continue;
                    $rows[] = $x;
                }
            }
        }

        // De-dupe on address: one person should get one copy even if they are
        // on file as both a lead and a client.
        $seen = []; $out = [];
        foreach ($rows as $r) {
            $k = strtolower(trim((string)$r['email']));
            if ($k === '' || isset($seen[$k])) continue;
            $seen[$k] = true;
            $out[] = $r;
        }
        return $out;
    };

    // ---- Industries present across both audiences ---------------------
    if ($sub === 'industries' && $method === 'GET') {
        $counts = [];
        foreach ($pdo->query("SELECT industry, COUNT(*) n FROM leads
                               WHERE industry IS NOT NULL AND industry <> ''
                               GROUP BY industry")->fetchAll() as $r) {
            $counts[$r['industry']] = ($counts[$r['industry']] ?? 0) + (int)$r['n'];
        }
        foreach ($pdo->query("SELECT industry, COUNT(*) n FROM clients
                               WHERE industry IS NOT NULL AND industry <> ''
                               GROUP BY industry")->fetchAll() as $r) {
            $counts[$r['industry']] = ($counts[$r['industry']] ?? 0) + (int)$r['n'];
        }
        ksort($counts);
        $out = [];
        foreach ($counts as $label => $n) $out[] = ['label' => $label, 'count' => $n];
        Json::send(['industries' => $out]);
    }

    // ---- Acquisition sources available to target ----------------------
    // Distinct `leads.source` values, counted over MAILABLE leads only (those
    // with an email), so the dropdown never offers a source that resolves to
    // nobody. Grouped case-insensitively; the commonest spelling is shown.
    // Clients are absent by design - see $skipClients in $resolve.
    if ($sub === 'sources' && $method === 'GET') {
        $seen = [];
        foreach ($pdo->query("SELECT source, COUNT(*) n FROM leads
                               WHERE source IS NOT NULL AND TRIM(source) <> ''
                                 AND email IS NOT NULL AND email <> ''
                               GROUP BY source")->fetchAll() as $r) {
            $key = strtolower(trim((string)$r['source']));
            if ($key === '') continue;
            if (!isset($seen[$key])) $seen[$key] = ['label' => trim((string)$r['source']), 'count' => 0];
            $seen[$key]['count'] += (int)$r['n'];
        }
        uasort($seen, fn($a, $b) => $b['count'] <=> $a['count']);
        Json::send(['sources' => array_values($seen)]);
    }

    // ---- Contact roles available to target ----------------------------
    // Whatever is actually on file, so the dropdown can never offer a role
    // that matches nobody. Companies House writes these (director,
    // nominee-director, secretary, llp-member...); hand-added contacts write
    // free text. Grouped case-insensitively, labelled with the commonest
    // spelling found.
    if ($sub === 'roles' && $method === 'GET') {
        $seen = [];
        foreach (['lead_contacts', 'client_contacts'] as $tbl) {
            foreach ($pdo->query("SELECT position, COUNT(*) n FROM $tbl
                                   WHERE position IS NOT NULL AND position <> ''
                                   GROUP BY position")->fetchAll() as $r) {
                $key = brs_mailer_norm_role($r['position']);
                if ($key === '') continue;
                if (!isset($seen[$key])) $seen[$key] = ['label' => $r['position'], 'count' => 0];
                $seen[$key]['count'] += (int)$r['n'];
            }
        }
        uasort($seen, fn($a, $b) => $b['count'] <=> $a['count']);
        Json::send(['roles' => array_values($seen)]);
    }

    // ---- The placeholder vocabulary the composer offers ---------------
    if ($sub === 'placeholders' && $method === 'GET') {
        $out = [];
        foreach (BRS_MAILER_PLACEHOLDERS as $key => $def) {
            $out[] = [
                'token'   => '{{' . $key . '}}',
                'key'     => $key,
                'label'   => $def['label'],
                'leads'   => (bool)$def['lead'],
                'clients' => (bool)$def['client'],
                // Needs a named contact on the record to resolve.
                'person'  => (bool)$def['person'],
            ];
        }
        Json::send(['placeholders' => $out]);
    }

    // ---- Resolve the audience ------------------------------------------
    if ($sub === 'audience' && $method === 'GET') {
        $audience = in_array($_GET['audience'] ?? '', ['leads', 'clients', 'both'], true)
            ? $_GET['audience'] : 'both';
        $industry = trim((string)($_GET['industry'] ?? ''));
        $q        = trim((string)($_GET['q'] ?? ''));
        $sendTo   = in_array($_GET['send_to'] ?? '', ['company', 'primary', 'role', 'all'], true)
            ? $_GET['send_to'] : 'primary';
        $role     = trim((string)($_GET['role'] ?? ''));
        $source   = trim((string)($_GET['source'] ?? ''));

        $rows = $resolve($audience, $industry, $q, $sendTo, $role, $source);

        // Anyone who unsubscribed is shown, but flagged and never selectable:
        // silently dropping them makes the count look wrong for no reason.
        $sup = [];
        foreach ($pdo->query('SELECT email FROM newsletter_suppressions')->fetchAll() as $s) {
            $sup[strtolower(trim((string)$s['email']))] = true;
        }

        $out = [];
        foreach ($rows as $r) {
            $out[] = [
                'kind'         => $r['_kind'],
                'id'           => (int)$r['id'],
                'name'         => $r['name'],
                'email'        => $r['email'],
                'company'      => $r['company'],
                'industry'     => $r['industry'],
                // The person the greeting tokens will resolve to. Empty means
                // {{first_name}} and friends render blank for this recipient.
                'contact_name' => $r['contact_name'],
                'job_title'    => $r['job_title'],
                'contact_id'   => $r['contact_id'],
                'has_person'   => $r['has_person'],
                // Named person, but no address of their own: this message
                // lands in the record's shared inbox, not their mailbox.
                'via_company_inbox' => $r['via_company_inbox'] ?? 0,
                'suppressed'   => isset($sup[strtolower(trim((string)$r['email']))]) ? 1 : 0,
            ];
        }
        Json::send(['recipients' => $out, 'total' => count($out)]);
    }

    // ---- Templates -----------------------------------------------------
    if ($sub === 'templates') {
        $id = isset($segs[2]) && ctype_digit((string)$segs[2]) ? (int)$segs[2] : 0;

        if ($method === 'GET' && !$id) {
            // `uses` / `last_used_at` come from mailer_sends.template_id, which
            // the composer sets when a message was started from a template.
            $q = $pdo->query('SELECT t.id, t.name, t.subject, t.body_html, t.created_at, t.updated_at,
                                     (SELECT COUNT(*)        FROM mailer_sends s WHERE s.template_id = t.id) AS uses,
                                     (SELECT MAX(created_at) FROM mailer_sends s WHERE s.template_id = t.id) AS last_used_at
                                FROM mailer_templates t ORDER BY t.name');
            Json::send(['templates' => array_map(function (array $r): array {
                $r['id']   = (int)$r['id'];
                $r['uses'] = (int)$r['uses'];
                return $r;
            }, $q->fetchAll())]);
        }

        if ($method === 'POST' && !$id) {
            $b = Json::readBody();
            $name = trim((string)($b['name'] ?? ''));
            if ($name === '') Json::fail('Template name is required', 400);
            $pdo->prepare('INSERT INTO mailer_templates (name, subject, body_html, created_by_user_id)
                           VALUES (?,?,?,?)')
                ->execute([$name, trim((string)($b['subject'] ?? '')), (string)($b['body_html'] ?? ''), $userId]);
            Json::send(['ok' => true, 'id' => (int)$pdo->lastInsertId()], 201);
        }

        if ($id && $method === 'PUT') {
            $b = Json::readBody();
            $name = trim((string)($b['name'] ?? ''));
            if ($name === '') Json::fail('Template name is required', 400);
            $pdo->prepare('UPDATE mailer_templates SET name=?, subject=?, body_html=? WHERE id=?')
                ->execute([$name, trim((string)($b['subject'] ?? '')), (string)($b['body_html'] ?? ''), $id]);
            Json::send(['ok' => true]);
        }

        if ($id && $method === 'DELETE') {
            $pdo->prepare('DELETE FROM mailer_templates WHERE id = ?')->execute([$id]);
            Json::send(['ok' => true]);
        }

        Json::fail('Method not allowed', 405);
    }

    // ---- Send ----------------------------------------------------------
    // Takes an EXPLICIT recipient list, the one the composer previewed and
    // the user ticked. Re-resolving the filter here would risk mailing people
    // the sender never saw, if the data moved between preview and send.
    if ($sub === 'send' && $method === 'POST') {
        $b        = Json::readBody();
        $subject  = trim((string)($b['subject'] ?? ''));
        $body     = (string)($b['body_html'] ?? '');
        $audience = in_array($b['audience'] ?? '', ['leads', 'clients', 'both'], true) ? $b['audience'] : 'both';
        $industry = trim((string)($b['industry'] ?? ''));
        $tplId    = !empty($b['template_id']) ? (int)$b['template_id'] : null;
        $wanted   = is_array($b['recipients'] ?? null) ? $b['recipients'] : [];
        // Optional: which team-member mailbox to send FROM. Comes from
        // the Mailer's "Send as" dropdown, populated from /api/graph-users.
        // A UPN or ObjectId — Graph accepts either on the sendMail URL.
        $senderId = trim((string)($b['sender_id'] ?? ''));

        if ($subject === '')      Json::fail('Subject is required', 400);
        if (trim($body) === '')   Json::fail('Message body is required', 400);
        if (!$wanted)             Json::fail('No recipients selected', 400);

        // Pull the full field set for the chosen recipients so placeholders
        // resolve against real data rather than what the browser sent.
        // Keyed by record, carrying the exact contacts that were ticked - a
        // record can appear several times in the list (once per person) and
        // each of those is its own message with its own greeting.
        $byKind  = ['lead' => [], 'client' => []];
        $reqRows = [];
        // One-off recipients typed into the composer: no CRM record behind
        // them, so only the person tokens (from the typed name) and {{email}}
        // resolve; everything else renders blank. Logged with
        // entity_type 'manual' and no entity_id.
        $manual = [];
        foreach ($wanted as $w) {
            if (($w['kind'] ?? '') !== 'manual') continue;
            $em = strtolower(trim((string)($w['email'] ?? '')));
            if (!filter_var($em, FILTER_VALIDATE_EMAIL)) Json::fail("'{$em}' is not a valid email address", 400);
            $nm = trim((string)($w['name'] ?? ''));
            $parts = $nm === '' ? [] : preg_split('/\s+/', $nm);
            $row = [
                '_kind' => 'manual', 'id' => null, 'id_type' => 'manual',
                'name' => ($nm !== '' ? $nm : $em), 'email' => $em, 'company' => '', 'industry' => '',
                'phone' => '', 'address' => '', 'website' => '', 'url' => '',
                'company_number' => '', 'status' => '', 'source' => '',
            ];
            $contact = $nm === '' ? null : [
                'contact_id' => null, 'first_name' => $parts[0], 'last_name' => implode(' ', array_slice($parts, 1)),
                'contact_name' => $nm, 'job_title' => '', 'email' => $em,
            ];
            $p = brs_mailer_apply_contact($row, $contact);
            $p['_reply_to'] = !empty($w['reply_to_recipient_id']) ? (int)$w['reply_to_recipient_id'] : null;
            $manual[] = $p;
        }

        foreach ($wanted as $w) {
            if (($w['kind'] ?? '') === 'manual') continue;
            $k = ($w['kind'] ?? '') === 'client' ? 'client' : 'lead';
            $i = (int)($w['id'] ?? 0);
            if ($i <= 0) continue;
            $byKind[$k][$i] = true;
            $reqRows[] = ['kind' => $k, 'id' => $i,
                          'contact_id' => isset($w['contact_id']) && $w['contact_id'] !== null
                              ? (int)$w['contact_id'] : null,
                          // Follow-up: the log row this message answers. Its
                          // logged address wins over whatever the record now
                          // holds, so a follow-up reaches the SAME inbox.
                          'reply_to' => !empty($w['reply_to_recipient_id'])
                              ? (int)$w['reply_to_recipient_id'] : null];
        }

        // Log rows being followed up. Loaded here (tenant-scoped) rather than
        // trusting an address from the browser: the only inboxes a follow-up
        // can go to are ones this tenant has demonstrably already mailed.
        $replyRows = [];
        $replyIds  = array_values(array_unique(array_filter(array_column($reqRows, 'reply_to'))));
        if ($replyIds) {
            $in = implode(',', array_fill(0, count($replyIds), '?'));
            $st = $pdo->prepare("SELECT id, send_id, email FROM mailer_send_recipients WHERE id IN ($in)");
            $st->execute($replyIds);
            foreach ($st->fetchAll() as $r) $replyRows[(int)$r['id']] = $r;
        }
        // The batch is a follow-up OF one batch only when every picked row
        // came from the same one; a mixed pick has no single parent.
        $parentSendId = null;
        if ($replyRows) {
            $parents = array_unique(array_map(fn(array $r): int => (int)$r['send_id'], $replyRows));
            $parentSendId = count($parents) === 1 ? (int)reset($parents) : null;
        }

        [$records, $conts] = brs_mailer_load_records($pdo, $byKind);

        // Build one message per TICKED ROW, honouring the exact contact chosen.
        // A null contact_id means the row targeted the record's own inbox.
        $people = [];
        foreach ($reqRows as $req) {
            $rec = $records[$req['kind']][$req['id']] ?? null;
            if (!$rec) continue;
            $contact = null;
            if ($req['contact_id'] !== null) {
                foreach ($conts[$req['kind']][$req['id']] ?? [] as $c) {
                    if ((int)$c['contact_id'] === $req['contact_id']) { $contact = $c; break; }
                }
            }
            $p = brs_mailer_apply_contact($rec, $contact);
            $p['_reply_to'] = null;
            if ($req['reply_to'] !== null && isset($replyRows[$req['reply_to']])) {
                $p['_reply_to'] = $req['reply_to'];
                $p['email']     = $replyRows[$req['reply_to']]['email'];
            }
            $people[] = $p;
        }
        foreach ($manual as $p) $people[] = $p;

        $sup = [];
        foreach ($pdo->query('SELECT email FROM newsletter_suppressions')->fetchAll() as $s) {
            $sup[strtolower(trim((string)$s['email']))] = true;
        }

        $pdo->prepare('INSERT INTO mailer_sends (subject, body_html, audience, industry, template_id, parent_send_id, sent_by_user_id)
                       VALUES (?,?,?,?,?,?,?)')
            ->execute([$subject, $body, $audience, ($industry ?: null), $tplId, $parentSendId, $userId]);
        $sendId = (int)$pdo->lastInsertId();

        // rendered_subject / rendered_body hold the exact personalised copy each
        // recipient received (migration 165), so the lead/client Mail tab shows
        // "Hi Sarah" rather than the "Hi {{name}}" template.
        $logRow = $pdo->prepare('INSERT INTO mailer_send_recipients
            (send_id, entity_type, entity_id, email, name, rendered_subject, rendered_body, status, error, follow_up_of_recipient_id)
            VALUES (?,?,?,?,?,?,?,?,?,?)');

        $sent = 0; $failed = 0; $skipped = 0; $seen = []; $followedUp = [];
        foreach ($people as $p) {
            $email = strtolower(trim((string)($p['email'] ?? '')));
            if ($email === '' || isset($seen[$email])) { continue; }
            $seen[$email] = true;
            $who = trim((string)($p['contact_name'] ?? '')) ?: $p['name'];

            if (isset($sup[$email])) {
                $skipped++;
                $logRow->execute([$sendId, $p['_kind'], ($p['id'] === null ? null : (int)$p['id']), $email, $who, null, null, 'skipped', 'Unsubscribed', $p['_reply_to']]);
                continue;
            }

            $html = brs_mailer_render($body, $p);
            $subj = brs_mailer_render($subject, $p);
            try {
                [$ok, $err] = Mailer::send($email, $subj, $html, $senderId !== '' ? $senderId : null);
            } catch (\Throwable $e) {
                $ok = false; $err = $e->getMessage();
            }
            if ($ok) {
                $sent++;
                $logRow->execute([$sendId, $p['_kind'], ($p['id'] === null ? null : (int)$p['id']), $email, $who, mb_substr($subj, 0, 255), $html, 'sent', null, $p['_reply_to']]);
                if ($p['_reply_to'] !== null) $followedUp[] = $p['_reply_to'];
            } else {
                $failed++;
                $logRow->execute([$sendId, $p['_kind'], ($p['id'] === null ? null : (int)$p['id']), $email, $who, mb_substr($subj, 0, 255), $html, 'failed', mb_substr((string)$err, 0, 500), $p['_reply_to']]);
            }
        }

        $total = $sent + $failed + $skipped;
        $pdo->prepare('UPDATE mailer_sends SET total=?, sent_count=?, failed_count=?, skipped_count=? WHERE id=?')
            ->execute([$total, $sent, $failed, $skipped, $sendId]);

        // Originals that were actually followed up (delivered, not failed or
        // skipped) get the automatic outcome - unless someone already recorded
        // a real one, which a follow-up must not overwrite.
        if ($followedUp) {
            $in = implode(',', array_fill(0, count($followedUp), '?'));
            $pdo->prepare("UPDATE mailer_send_recipients SET outcome = 'followed_up', outcome_at = NOW()
                            WHERE outcome IS NULL AND id IN ($in)")->execute($followedUp);
        }

        Json::send([
            'ok' => true, 'send_id' => $sendId,
            'total' => $total, 'sent' => $sent, 'failed' => $failed, 'skipped' => $skipped,
        ], 201);
    }

    // ---- Send history ---------------------------------------------------
    if ($sub === 'sends') {
        $id = isset($segs[2]) && ctype_digit((string)$segs[2]) ? (int)$segs[2] : 0;

        if ($method === 'GET' && !$id) {
            $q = $pdo->query('SELECT s.id, s.subject, s.audience, s.industry, s.total, s.sent_count,
                                     s.failed_count, s.skipped_count, s.created_at,
                                     u.display_name AS sent_by
                                FROM mailer_sends s
                                LEFT JOIN admin_users u ON u.id = s.sent_by_user_id
                               ORDER BY s.id DESC LIMIT 200');
            Json::send(['sends' => $q->fetchAll()]);
        }

        if ($id && $method === 'GET') {
            $s = $pdo->prepare('SELECT * FROM mailer_sends WHERE id = ?');
            $s->execute([$id]);
            $send = $s->fetch();
            if (!$send) Json::fail('Not found', 404);
            $r = $pdo->prepare('SELECT entity_type, entity_id, email, name, status, error
                                  FROM mailer_send_recipients WHERE send_id = ? ORDER BY id');
            $r->execute([$id]);
            Json::send(['send' => $send, 'recipients' => $r->fetchAll()]);
        }

        Json::fail('Method not allowed', 405);
    }

    // ---- Overview ------------------------------------------------------
    // GET /api/mailer/overview - the numbers behind the Mailer landing page.
    //   All-time totals, the last 30 days of activity (one row per day,
    //   gaps filled), the outcome breakdown of delivered mail, the most
    //   recent batches, and how many tracked-link views the page_views
    //   table has recorded. Read-only; every query is tenant-scoped by the
    //   rewriter.
    if ($sub === 'overview' && $method === 'GET') {
        $tot = $pdo->query("SELECT COUNT(*) AS n,
                                   SUM(status = 'sent')    AS sent,
                                   SUM(status = 'failed')  AS failed,
                                   SUM(status = 'skipped') AS skipped,
                                   SUM(follow_up_of_recipient_id IS NOT NULL) AS follow_ups,
                                   SUM(status = 'sent' AND outcome IS NULL)   AS awaiting,
                                   COUNT(DISTINCT email) AS unique_addresses,
                                   MAX(created_at) AS last_sent_at
                              FROM mailer_send_recipients")->fetch() ?: [];
        $sends     = (int)$pdo->query('SELECT COUNT(*) AS n FROM mailer_sends')->fetchColumn();
        $templates = (int)$pdo->query('SELECT COUNT(*) AS n FROM mailer_templates')->fetchColumn();

        // Tracked-link views (164). Optional: an older env without the table
        // still gets an overview, just with zeros here.
        $views = ['views' => 0, 'records' => 0];
        try {
            $v = $pdo->query('SELECT COALESCE(SUM(view_count), 0) AS views, COUNT(*) AS records FROM page_views')->fetch();
            if ($v) $views = ['views' => (int)$v['views'], 'records' => (int)$v['records']];
        } catch (\Throwable $e) { /* table absent */ }

        // Last 30 days, one row per day, today last. Days with nothing sent
        // are present with zeros so the chart's x-axis is continuous.
        $byDay = [];
        $st = $pdo->query("SELECT DATE(created_at) AS d,
                                  SUM(status = 'sent')   AS sent,
                                  SUM(status = 'failed') AS failed
                             FROM mailer_send_recipients
                            WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 29 DAY)
                            GROUP BY DATE(created_at)");
        foreach ($st->fetchAll() as $r) $byDay[$r['d']] = ['sent' => (int)$r['sent'], 'failed' => (int)$r['failed']];
        $days = [];
        $today = new \DateTimeImmutable('today');
        for ($i = 29; $i >= 0; $i--) {
            $d = $today->modify("-{$i} days")->format('Y-m-d');
            $days[] = ['day' => $d, 'sent' => $byDay[$d]['sent'] ?? 0, 'failed' => $byDay[$d]['failed'] ?? 0];
        }
        $last7 = array_sum(array_map(fn($x) => $x['sent'], array_slice($days, 23)));
        $prev7 = array_sum(array_map(fn($x) => $x['sent'], array_slice($days, 16, 7)));

        // Outcomes of delivered mail, in vocabulary order, zeros included.
        $oc = [];
        foreach ($pdo->query("SELECT outcome, COUNT(*) AS n FROM mailer_send_recipients
                               WHERE status = 'sent' AND outcome IS NOT NULL GROUP BY outcome")->fetchAll() as $r) {
            $oc[$r['outcome']] = (int)$r['n'];
        }
        $outcomes = [];
        foreach (BRS_MAILER_OUTCOMES as $k => $label) {
            $outcomes[] = ['key' => $k, 'label' => $label, 'count' => $oc[$k] ?? 0];
        }

        $recent = $pdo->query('SELECT s.id, s.subject, s.audience, s.industry, s.parent_send_id, s.created_at,
                                      s.total, s.sent_count, s.failed_count, s.skipped_count,
                                      u.display_name AS sent_by
                                 FROM mailer_sends s
                            LEFT JOIN admin_users u ON u.id = s.sent_by_user_id
                                ORDER BY s.id DESC LIMIT 6')->fetchAll();
        foreach ($recent as &$r) {
            foreach (['id', 'parent_send_id', 'total', 'sent_count', 'failed_count', 'skipped_count'] as $k) {
                $r[$k] = $r[$k] === null ? null : (int)$r[$k];
            }
        }
        unset($r);

        Json::send([
            'totals' => [
                'emails'           => (int)($tot['n'] ?? 0),
                'sent'             => (int)($tot['sent'] ?? 0),
                'failed'           => (int)($tot['failed'] ?? 0),
                'skipped'          => (int)($tot['skipped'] ?? 0),
                'follow_ups'       => (int)($tot['follow_ups'] ?? 0),
                'awaiting_outcome' => (int)($tot['awaiting'] ?? 0),
                'unique_addresses' => (int)($tot['unique_addresses'] ?? 0),
                'sends'            => $sends,
                'templates'        => $templates,
                'last_sent_at'     => $tot['last_sent_at'] ?? null,
                'last_7_days'      => $last7,
                'previous_7_days'  => $prev7,
            ],
            'link_views' => $views,
            'days'       => $days,
            'outcomes'   => $outcomes,
            'recent'     => $recent,
        ]);
    }

    // ---- Outcome vocabulary -------------------------------------------
    if ($sub === 'outcomes' && $method === 'GET') {
        $out = [];
        foreach (BRS_MAILER_OUTCOMES as $k => $label) $out[] = ['key' => $k, 'label' => $label];
        Json::send(['outcomes' => $out]);
    }

    // ---- Sent emails ---------------------------------------------------
    // Backs the "Sent emails" page. Everything the Mailer produced, GROUPED
    // by batch (one `mailer_sends` row per send) with the individual emails
    // under each, newest batch first. Filters apply to the EMAILS; a batch
    // is listed only while at least one of its emails matches, and shows
    // only the matching ones. Pages are counted in batches, not emails.
    //
    //   GET /api/mailer/sent?q=&status=&kind=&outcome=&page=&per_page=
    //   GET /api/mailer/sent/:id            one email (recipient row id)
    //   PUT /api/mailer/sent/outcome        { ids: [...], outcome: key|null }
    //   PUT /api/mailer/sent/:id/outcome    { outcome: key|null }
    if ($sub === 'sent') {
        $id  = isset($segs[2]) && ctype_digit((string)$segs[2]) ? (int)$segs[2] : 0;
        $op  = $segs[3] ?? ($id ? '' : ($segs[2] ?? ''));

        // Set the after-delivery outcome on one or many rows. Null / '' clears.
        if ($method === 'PUT' && $op === 'outcome') {
            $b   = Json::readBody();
            $ids = $id ? [$id] : array_values(array_filter(array_map('intval', (array)($b['ids'] ?? []))));
            if (!$ids) Json::fail('No emails selected', 400);
            $outcome = trim((string)($b['outcome'] ?? ''));
            if ($outcome !== '' && !isset(BRS_MAILER_OUTCOMES[$outcome])) Json::fail('Unknown outcome', 400);
            $in = implode(',', array_fill(0, count($ids), '?'));
            if ($outcome === '') {
                $st = $pdo->prepare("UPDATE mailer_send_recipients SET outcome = NULL, outcome_at = NULL WHERE id IN ($in)");
                $st->execute($ids);
            } else {
                $st = $pdo->prepare("UPDATE mailer_send_recipients SET outcome = ?, outcome_at = NOW() WHERE id IN ($in)");
                $st->execute(array_merge([$outcome], $ids));
            }
            Json::send(['ok' => true, 'updated' => $st->rowCount(), 'outcome' => $outcome ?: null]);
        }

        if ($method !== 'GET') Json::fail('Method not allowed', 405);

        if ($id) {
            // One email. The rendered per-recipient copy (165) is preferred;
            // rows logged before it, and skipped rows, fall back to the
            // template as authored.
            $st = $pdo->prepare(
                'SELECT r.id, r.send_id, r.entity_type, r.entity_id, r.email, r.name, r.status, r.error,
                        r.outcome, r.outcome_at, r.follow_up_of_recipient_id, r.created_at,
                        COALESCE(r.rendered_subject, s.subject)   AS subject,
                        COALESCE(r.rendered_body,    s.body_html) AS body_html,
                        (r.rendered_body IS NOT NULL)             AS is_rendered,
                        s.audience, s.industry, s.parent_send_id,
                        s.total, s.sent_count, s.failed_count, s.skipped_count,
                        u.display_name AS sent_by,
                        (SELECT COUNT(*) FROM mailer_send_recipients f
                          WHERE f.follow_up_of_recipient_id = r.id) AS follow_ups
                   FROM mailer_send_recipients r
                   JOIN mailer_sends s ON s.id = r.send_id
              LEFT JOIN admin_users u ON u.id = s.sent_by_user_id
                  WHERE r.id = ?'
            );
            $st->execute([$id]);
            $row = $st->fetch();
            if (!$row) Json::fail('Not found', 404);
            foreach (['id', 'send_id', 'entity_id', 'follow_up_of_recipient_id', 'parent_send_id',
                      'total', 'sent_count', 'failed_count', 'skipped_count', 'follow_ups', 'is_rendered'] as $k) {
                $row[$k] = $row[$k] === null ? null : (int)$row[$k];
            }
            Json::send(['email' => $row]);
        }

        $q       = trim((string)($_GET['q'] ?? ''));
        $status  = strtolower(trim((string)($_GET['status'] ?? '')));
        $kind    = strtolower(trim((string)($_GET['kind'] ?? '')));
        $outcome = strtolower(trim((string)($_GET['outcome'] ?? '')));
        $page    = max(1, (int)($_GET['page'] ?? 1));
        $perPage = (int)($_GET['per_page'] ?? 20);
        if ($perPage < 5 || $perPage > 100) $perPage = 20;

        $where = [];
        $args  = [];
        if ($q !== '') {
            $like = '%' . $q . '%';
            $where[] = '(r.email LIKE ? OR r.name LIKE ? OR s.subject LIKE ?)';
            array_push($args, $like, $like, $like);
        }
        if (in_array($status, ['sent', 'failed', 'skipped'], true)) {
            $where[] = 'r.status = ?';
            $args[] = $status;
        }
        if (in_array($kind, ['lead', 'client'], true)) {
            $where[] = 'r.entity_type = ?';
            $args[] = $kind;
        }
        if ($outcome === 'none') {
            $where[] = 'r.outcome IS NULL';
        } elseif ($outcome !== '' && isset(BRS_MAILER_OUTCOMES[$outcome])) {
            $where[] = 'r.outcome = ?';
            $args[] = $outcome;
        }
        $sqlWhere = $where ? ' WHERE ' . implode(' AND ', $where) : '';

        // Rewriter scopes both tables by tenant_id (each carries it independently).
        $from = ' FROM mailer_send_recipients r
                  JOIN mailer_sends s ON s.id = r.send_id' . $sqlWhere;

        $cnt = $pdo->prepare("SELECT COUNT(*) AS n, COUNT(DISTINCT s.id) AS batches,
                                     SUM(r.status = 'sent')    AS sent,
                                     SUM(r.status = 'failed')  AS failed,
                                     SUM(r.status = 'skipped') AS skipped,
                                     SUM(r.outcome = 'replied' OR r.outcome = 'interested' OR r.outcome = 'meeting_booked') AS positive" . $from);
        $cnt->execute($args);
        $tot = $cnt->fetch() ?: [];
        $total   = (int)($tot['n'] ?? 0);
        $batches = (int)($tot['batches'] ?? 0);

        $pages = max(1, (int)ceil($batches / $perPage));
        if ($page > $pages) $page = $pages;
        $offset = ($page - 1) * $perPage;

        // Which batches are on this page: newest first, by matching emails.
        $st = $pdo->prepare('SELECT DISTINCT s.id' . $from .
                            ' ORDER BY s.id DESC LIMIT ' . (int)$perPage . ' OFFSET ' . (int)$offset);
        $st->execute($args);
        $sendIds = array_map(fn(array $r): int => (int)$r['id'], $st->fetchAll());

        $groups = [];
        if ($sendIds) {
            $in = implode(',', array_fill(0, count($sendIds), '?'));
            $st = $pdo->prepare(
                "SELECT s.id, s.subject, s.audience, s.industry, s.parent_send_id, s.created_at,
                        s.total, s.sent_count, s.failed_count, s.skipped_count,
                        u.display_name AS sent_by, p.subject AS parent_subject
                   FROM mailer_sends s
              LEFT JOIN admin_users u ON u.id = s.sent_by_user_id
              LEFT JOIN mailer_sends p ON p.id = s.parent_send_id
                  WHERE s.id IN ($in)
                  ORDER BY s.id DESC"
            );
            $st->execute($sendIds);
            foreach ($st->fetchAll() as $g) {
                foreach (['id', 'parent_send_id', 'total', 'sent_count', 'failed_count', 'skipped_count'] as $k) {
                    $g[$k] = $g[$k] === null ? null : (int)$g[$k];
                }
                $g['emails'] = [];
                $groups[$g['id']] = $g;
            }

            $st = $pdo->prepare(
                'SELECT r.id, r.send_id, r.entity_type, r.entity_id, r.email, r.name, r.status, r.error,
                        r.outcome, r.outcome_at, r.follow_up_of_recipient_id, r.created_at,
                        COALESCE(r.rendered_subject, s.subject) AS subject,
                        (SELECT COUNT(*) FROM mailer_send_recipients f
                          WHERE f.follow_up_of_recipient_id = r.id) AS follow_ups'
                . $from . ($sqlWhere ? ' AND' : ' WHERE') . " r.send_id IN ($in)" .
                ' ORDER BY r.send_id DESC, r.id ASC'
            );
            $st->execute(array_merge($args, $sendIds));
            foreach ($st->fetchAll() as $r) {
                foreach (['id', 'send_id', 'entity_id', 'follow_up_of_recipient_id', 'follow_ups'] as $k) {
                    $r[$k] = $r[$k] === null ? null : (int)$r[$k];
                }
                if (isset($groups[$r['send_id']])) $groups[$r['send_id']]['emails'][] = $r;
            }
        }

        Json::send([
            'groups'   => array_values($groups),
            'total'    => $total,
            'batches'  => $batches,
            'page'     => $page,
            'pages'    => $pages,
            'per_page' => $perPage,
            'summary'  => [
                'sent'     => (int)($tot['sent'] ?? 0),
                'failed'   => (int)($tot['failed'] ?? 0),
                'skipped'  => (int)($tot['skipped'] ?? 0),
                'positive' => (int)($tot['positive'] ?? 0),
            ],
        ]);
    }

    // ---- Follow-up picker ----------------------------------------------
    // GET /api/mailer/followup?ids=1,2,3   (recipient row ids)
    //   Turns earlier log rows into composer recipients, so a follow-up is
    //   an ordinary send with the audience pre-filled. Each row is addressed
    //   to the email it was ORIGINALLY sent to; the greeting resolves from the
    //   contact holding that address, else the record's primary contact, so
    //   person tokens still fill in. Rows whose record has since been deleted
    //   are reported in `missing` rather than silently dropped.
    if ($sub === 'followup' && $method === 'GET') {
        $ids = array_values(array_unique(array_filter(array_map('intval', explode(',', (string)($_GET['ids'] ?? ''))))));
        if (!$ids) Json::fail('ids required', 400);
        if (count($ids) > 500) Json::fail('Too many emails for one follow-up (max 500)', 400);

        $in = implode(',', array_fill(0, count($ids), '?'));
        $st = $pdo->prepare(
            'SELECT r.id, r.send_id, r.entity_type, r.entity_id, r.email, r.name, r.status, r.outcome,
                    s.subject
               FROM mailer_send_recipients r
               JOIN mailer_sends s ON s.id = r.send_id
              WHERE r.id IN (' . $in . ')'
        );
        $st->execute($ids);
        $rows = [];
        foreach ($st->fetchAll() as $r) $rows[(int)$r['id']] = $r;

        $byKind = ['lead' => [], 'client' => []];
        foreach ($rows as $r) {
            if ($r['entity_id'] !== null && in_array($r['entity_type'], ['lead', 'client'], true)) {
                $byKind[$r['entity_type']][(int)$r['entity_id']] = true;
            }
        }
        [$records, $conts] = brs_mailer_load_records($pdo, $byKind);

        $sup = [];
        foreach ($pdo->query('SELECT email FROM newsletter_suppressions')->fetchAll() as $x) {
            $sup[strtolower(trim((string)$x['email']))] = true;
        }

        $out = []; $missing = []; $subjects = [];
        foreach ($ids as $rid) {                       // keep the caller's order
            $r = $rows[$rid] ?? null;
            if (!$r) continue;
            $kind = $r['entity_type'];
            if ($kind === 'manual') {
                $subjects[$r['subject']] = true;
                $nm = trim((string)($r['name'] ?? ''));
                $out[] = [
                    'kind' => 'manual', 'id' => 0, 'name' => $nm ?: $r['email'], 'email' => $r['email'],
                    'company' => null, 'industry' => null,
                    'contact_name' => ($nm !== '' && strcasecmp($nm, (string)$r['email']) !== 0) ? $nm : '',
                    'job_title' => '', 'contact_id' => null, 'has_person' => ($nm !== '' && strcasecmp($nm, (string)$r['email']) !== 0) ? 1 : 0,
                    'via_company_inbox' => 0,
                    'suppressed' => isset($sup[strtolower(trim((string)$r['email']))]) ? 1 : 0,
                    'reply_to_recipient_id' => $rid, 'orig_subject' => $r['subject'],
                    'orig_send_id' => (int)$r['send_id'], 'orig_status' => $r['status'], 'orig_outcome' => $r['outcome'],
                ];
                continue;
            }
            $rec  = $r['entity_id'] !== null ? ($records[$kind][(int)$r['entity_id']] ?? null) : null;
            if (!$rec) {
                $missing[] = ['recipient_id' => $rid, 'email' => $r['email'], 'name' => $r['name']];
                continue;
            }
            $email   = strtolower(trim((string)$r['email']));
            $contact = null;
            foreach ($conts[$kind][(int)$rec['id']] ?? [] as $c) {
                if (strtolower(trim((string)$c['email'])) === $email) { $contact = $c; break; }
            }
            if ($contact === null) $contact = $conts[$kind][(int)$rec['id']][0] ?? null;

            $p = brs_mailer_apply_contact($rec, $contact);
            $p['email'] = $r['email'];                 // the address that was actually mailed
            $subjects[$r['subject']] = true;
            $out[] = [
                'kind'         => $kind,
                'id'           => (int)$rec['id'],
                'name'         => $p['name'],
                'email'        => $p['email'],
                'company'      => $p['company'],
                'industry'     => $p['industry'],
                'contact_name' => $p['contact_name'],
                'job_title'    => $p['job_title'],
                'contact_id'   => $p['contact_id'],
                'has_person'   => $p['has_person'],
                'via_company_inbox' => $p['via_company_inbox'] ?? 0,
                'suppressed'   => isset($sup[$email]) ? 1 : 0,
                'reply_to_recipient_id' => $rid,
                'orig_subject' => $r['subject'],
                'orig_send_id' => (int)$r['send_id'],
                'orig_status'  => $r['status'],
                'orig_outcome' => $r['outcome'],
            ];
        }
        Json::send([
            'recipients' => $out,
            'total'      => count($out),
            'missing'    => $missing,
            // One shared subject when every picked email came from the same
            // message, so the composer can prefill "Re: ...".
            'subject'    => count($subjects) === 1 ? (string)array_key_first($subjects) : null,
        ]);
    }

    // ---- Per-entity mail history ---------------------------------------
    // GET /api/mailer/history?entity_type=lead&entity_id=42
    //   Every message ever sent through the Mailer where the recipient row
    //   was tied to this lead/client. Rendered as a collapsible list on the
    //   record's Mail tab. Rows ordered newest first.
    if ($sub === 'history' && $method === 'GET') {
        $et = strtolower(trim((string)($_GET['entity_type'] ?? '')));
        $eid = (int)($_GET['entity_id'] ?? 0);
        if (!in_array($et, ['lead', 'client'], true)) Json::fail('entity_type must be lead or client', 400);
        if ($eid <= 0) Json::fail('entity_id required', 400);

        // Rewriter scopes both tables by tenant_id (both carry it independently, joined via send_id).
        $q = $pdo->prepare(
            // Prefer the per-recipient rendered copy (what was actually delivered);
            // fall back to the template for rows logged before migration 165.
            'SELECT s.id AS send_id,
                    COALESCE(r.rendered_subject, s.subject)   AS subject,
                    COALESCE(r.rendered_body,    s.body_html) AS body_html,
                    s.created_at,
                    u.display_name AS sent_by,
                    r.email AS to_email, r.name AS to_name, r.status, r.error
               FROM mailer_send_recipients r
               JOIN mailer_sends s ON s.id = r.send_id
          LEFT JOIN admin_users u ON u.id = s.sent_by_user_id
              WHERE r.entity_type = ? AND r.entity_id = ?
              ORDER BY s.created_at DESC, s.id DESC, r.id DESC'
        );
        $q->execute([$et, $eid]);
        Json::send(['messages' => $q->fetchAll()]);
    }

    Json::fail('Not found', 404);
};
