<?php
declare(strict_types=1);

use BRS\Auth;
use BRS\Db;
use BRS\Json;
use BRS\Tenant;

/*
 * Site Previews — admin CRUD.
 *
 *   GET    /api/site-previews            → list all for the current tenant
 *   POST   /api/site-previews            → create
 *   GET    /api/site-previews/:slug      → single
 *   PUT    /api/site-previews/:slug      → replace
 *   DELETE /api/site-previews/:slug      → remove
 *
 * Public (unauthenticated) read lives at /api/public-site-preview/:slug
 * — see routes/public_site_preview.php.
 */

return function (string $method, array $segs): void {
    Auth::require();
    $pdo = Db::tpdo();

    $decode = function (array $row): array {
        $row['feature'] = json_decode((string)($row['feature_json'] ?? '{}'), true) ?: [];
        $row['mockup']  = json_decode((string)($row['mockup_json']  ?? '{}'), true) ?: [];
        unset($row['feature_json'], $row['mockup_json']);
        $row['id']           = (int)$row['id'];
        $row['is_published'] = (bool)$row['is_published'];
        return $row;
    };

    // List / create
    if (!isset($segs[1])) {
        if ($method === 'GET') {
            $rows = $pdo->query(
                'SELECT id, slug, name, category, feature_json, mockup_json,
                        fullvideo, fullimage, is_published, created_at, updated_at
                 FROM site_previews ORDER BY name'
            )->fetchAll();
            Json::send(['site_previews' => array_map($decode, $rows)]);
        }
        if ($method === 'POST') {
            $b = Json::readBody();
            $slug = strtolower(trim((string)($b['slug'] ?? '')));
            if (!preg_match('/^[a-z0-9-]+$/', $slug)) Json::fail('slug must be lower-case letters, digits or hyphens', 400);
            $name = trim((string)($b['name'] ?? ''));
            if ($name === '') Json::fail('name required', 400);
            try {
                $ins = $pdo->prepare(
                    'INSERT INTO site_previews
                     (slug, name, category, feature_json, mockup_json, fullvideo, fullimage,
                      is_published, created_by_user_id)
                     VALUES (?,?,?,?,?,?,?,?,?)'
                );
                $ins->execute([
                    $slug, $name,
                    trim((string)($b['category'] ?? '')) ?: null,
                    json_encode($b['feature'] ?? new stdClass(), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
                    json_encode($b['mockup']  ?? new stdClass(), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
                    trim((string)($b['fullvideo'] ?? '')) ?: null,
                    trim((string)($b['fullimage'] ?? '')) ?: null,
                    !empty($b['is_published']) ? 1 : 0,
                    (int)(Tenant::userId() ?? 0) ?: null,
                ]);
                Json::send(['id' => (int)$pdo->lastInsertId(), 'slug' => $slug], 201);
            } catch (\PDOException $e) {
                if ($e->errorInfo[1] === 1062) Json::fail('That slug is already used', 409);
                throw $e;
            }
        }
        Json::fail('Method not allowed', 405);
    }

    $slug = strtolower(trim($segs[1]));
    $q = $pdo->prepare(
        'SELECT id, slug, name, category, feature_json, mockup_json,
                fullvideo, fullimage, is_published, created_at, updated_at
         FROM site_previews WHERE slug = ? LIMIT 1'
    );
    $q->execute([$slug]);
    $row = $q->fetch();
    if (!$row) Json::fail('Site preview not found', 404);

    if ($method === 'GET') Json::send(['site_preview' => $decode($row)]);

    if ($method === 'PUT') {
        $b = Json::readBody();
        $newSlug = strtolower(trim((string)($b['slug'] ?? $row['slug'])));
        if (!preg_match('/^[a-z0-9-]+$/', $newSlug)) Json::fail('slug must be lower-case letters, digits or hyphens', 400);
        $name = trim((string)($b['name'] ?? $row['name']));
        if ($name === '') Json::fail('name required', 400);
        try {
            $pdo->prepare(
                'UPDATE site_previews
                 SET slug = ?, name = ?, category = ?, feature_json = ?, mockup_json = ?,
                     fullvideo = ?, fullimage = ?, is_published = ?
                 WHERE id = ?'
            )->execute([
                $newSlug, $name,
                array_key_exists('category', $b) ? (trim((string)$b['category']) ?: null) : $row['category'],
                json_encode($b['feature'] ?? json_decode((string)$row['feature_json'], true) ?: new stdClass(),
                            JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
                json_encode($b['mockup']  ?? json_decode((string)$row['mockup_json'], true) ?: new stdClass(),
                            JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
                array_key_exists('fullvideo', $b) ? (trim((string)$b['fullvideo']) ?: null) : $row['fullvideo'],
                array_key_exists('fullimage', $b) ? (trim((string)$b['fullimage']) ?: null) : $row['fullimage'],
                array_key_exists('is_published', $b) ? (!empty($b['is_published']) ? 1 : 0) : (int)$row['is_published'],
                (int)$row['id'],
            ]);
            Json::send(['ok' => true, 'slug' => $newSlug]);
        } catch (\PDOException $e) {
            if ($e->errorInfo[1] === 1062) Json::fail('That slug is already used', 409);
            throw $e;
        }
    }

    if ($method === 'DELETE') {
        $pdo->prepare('DELETE FROM site_previews WHERE id = ?')->execute([(int)$row['id']]);
        Json::send(['ok' => true]);
    }

    Json::fail('Method not allowed', 405);
};
