<?php
declare(strict_types=1);

use BRS\Db;
use BRS\Json;
use BRS\Tenant;

/*
 * Public page-view counter for tracked email links. No auth.
 *
 *   POST /api/public-page-view     (JSON)
 *        { page: "preview.html", id_type: "lead" | "client", id: 2 }
 *        -> { ok: true }
 *
 * Fired by main-website/js/page-view.js when a marketing page is opened with
 * ?id=<n>&id_type=lead|client in its URL - the links the Mailer's {{id}}
 * placeholder produces. Upserts `page_views`: first visit inserts a row with
 * view_count = 1, every later visit adds 1 and moves last_viewed_at.
 *
 * Two deliberate choices, both because this endpoint is public:
 *
 *  1. It only counts ids that belong to a real lead / client. Otherwise anyone
 *     could hit it with arbitrary ids and fill the table with junk rows.
 *
 *  2. It answers { ok: true } whether or not the id exists. Returning 404 for
 *     unknown ids would let a caller enumerate which lead and client ids are
 *     real just by probing. Malformed input still gets a 400 - that says
 *     nothing about what is on file.
 *
 * Counts are page LOADS, as specified: a refresh counts again.
 */

return function (string $method, array $segs): void {
    Tenant::setForPublic();
    if ($method !== 'POST') Json::fail('Method not allowed', 405);
    $pdo = Db::tpdo();

    $b      = Json::readBody();
    $idType = strtolower(trim((string)($b['id_type'] ?? '')));
    $rawId  = trim((string)($b['id'] ?? ''));
    $page   = strtolower(trim((string)($b['page'] ?? '')));

    if (!in_array($idType, ['lead', 'client'], true)) Json::fail('id_type must be lead or client', 400);
    if (!ctype_digit($rawId) || (int)$rawId <= 0)     Json::fail('id must be a positive whole number', 400);
    // A plain page file name only - no paths, no query strings, nothing that
    // could be used to plant arbitrary text in the table.
    if (!preg_match('/^[a-z0-9][a-z0-9._-]{0,114}\.html$/', $page)) Json::fail('page must be a .html file name', 400);

    $recordId = (int)$rawId;

    // Tenant-scoped existence check (TenantPdo adds tenant_id).
    $table  = $idType === 'lead' ? 'leads' : 'clients';
    $exists = $pdo->prepare("SELECT id FROM $table WHERE id = ? LIMIT 1");
    $exists->execute([$recordId]);
    if (!$exists->fetch()) {
        // See note 2 above: identical response to a real hit.
        Json::send(['ok' => true]);
    }

    // One atomic statement, so two simultaneous opens can't both insert.
    // VALUES holds placeholders and a literal only - see the migration.
    $pdo->prepare(
        'INSERT INTO page_views (page, id_type, record_id, view_count)
         VALUES (?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE view_count = view_count + 1,
                                 last_viewed_at = CURRENT_TIMESTAMP'
    )->execute([$page, $idType, $recordId]);

    Json::send(['ok' => true]);
};
