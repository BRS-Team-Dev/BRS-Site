<?php
declare(strict_types=1);

use BRS\Db;
use BRS\Json;

/**
 * Public, anonymous legal-document endpoints. Mirrors the public-jobs flow.
 *
 *   GET /api/public/legal              → list all is_published=1 documents
 *   GET /api/public/legal/:slug        → single is_published=1 document
 *
 * Drafts are never visible here. The admin-side `/api/hr/legal` endpoints
 * see everything and require auth.
 */

return function (string $method, array $segs): void {
    $pdo = Db::pdo();

    // GET /api/public/legal — list of published documents.
    // Includes show_in_sidenav + parent_id so the public-facing sidenav can
    // build its tree without a second round-trip.
    if ($method === 'GET' && !isset($segs[2])) {
        $stmt = $pdo->query("SELECT id, slug, title, category, summary,
                                    show_in_sidenav, parent_id, updated_at
                             FROM hr_legal_documents
                             WHERE is_published = 1
                             ORDER BY sort_order, title");
        Json::send(['documents' => $stmt->fetchAll()]);
    }

    $slug = (string)($segs[2] ?? '');
    if ($slug === '') Json::fail('slug required', 400);

    if ($method === 'GET') {
        $stmt = $pdo->prepare("SELECT id, slug, title, category, summary, body, updated_at
                               FROM hr_legal_documents
                               WHERE slug = ? AND is_published = 1
                               LIMIT 1");
        $stmt->execute([$slug]);
        $doc = $stmt->fetch();
        if (!$doc) Json::fail('Document not found', 404);
        Json::send(['document' => $doc]);
    }

    Json::fail('Not found', 404);
};
