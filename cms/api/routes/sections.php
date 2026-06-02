<?php
declare(strict_types=1);

use BRS\Auth;
use BRS\Db;
use BRS\Ddl;
use BRS\Json;

/*
 * Independent admin sections — sidenav entries that aren't tied to a form.
 *
 *   GET    /api/sections
 *   POST   /api/sections
 *   GET    /api/sections/:id
 *   PUT    /api/sections/:id
 *   DELETE /api/sections/:id
 */

return function (string $method, array $segs): void {
    Auth::require();
    $pdo = Db::pdo();

    if (!isset($segs[1])) {
        if ($method === 'GET') {
            $rows = $pdo->query('SELECT * FROM admin_sections ORDER BY sort_order, id')->fetchAll();
            Json::send(['sections' => $rows]);
        }
        if ($method === 'POST') {
            $body  = Json::readBody();
            $slug  = strtolower(trim((string)($body['slug'] ?? '')));
            $title = trim((string)($body['title'] ?? ''));
            if (!preg_match(Ddl::IDENT_RE, $slug)) Json::fail('Invalid slug', 400);
            if ($title === '') Json::fail('Title required', 400);

            $placement = ($body['sidenav_placement'] ?? 'top') === 'child' ? 'child' : 'top';
            $parentKey = $placement === 'child' && !empty($body['sidenav_parent_key'])
                ? substr((string)$body['sidenav_parent_key'], 0, 40) : null;

            $ins = $pdo->prepare('INSERT INTO admin_sections
                (slug, title, description, sidenav_placement, sidenav_parent_key, sort_order)
                VALUES (?,?,?,?,?,?)');
            $ins->execute([
                $slug, $title,
                $body['description'] ?? null,
                $placement, $parentKey,
                (int)($body['sort_order'] ?? 0),
            ]);
            Json::send(['id' => (int)$pdo->lastInsertId(), 'slug' => $slug], 201);
        }
        Json::fail('Method not allowed', 405);
    }

    $id = (int)$segs[1];
    if ($id <= 0) Json::fail('Invalid id', 400);

    $row = $pdo->prepare('SELECT * FROM admin_sections WHERE id = ?');
    $row->execute([$id]);
    $section = $row->fetch();
    if (!$section) Json::fail('Section not found', 404);

    if ($method === 'GET') Json::send(['section' => $section]);

    if ($method === 'PUT') {
        $body  = Json::readBody();
        $slug  = strtolower(trim((string)($body['slug']  ?? $section['slug'])));
        $title = trim((string)($body['title'] ?? $section['title']));
        if (!preg_match(Ddl::IDENT_RE, $slug)) Json::fail('Invalid slug', 400);
        if ($title === '') Json::fail('Title required', 400);

        $placement = ($body['sidenav_placement'] ?? $section['sidenav_placement']) === 'child' ? 'child' : 'top';
        $parentKey = $placement === 'child' && !empty($body['sidenav_parent_key'])
            ? substr((string)$body['sidenav_parent_key'], 0, 40) : null;

        $upd = $pdo->prepare('UPDATE admin_sections
            SET slug=?, title=?, description=?, sidenav_placement=?, sidenav_parent_key=?, sort_order=?
            WHERE id = ?');
        $upd->execute([
            $slug, $title,
            $body['description'] ?? null,
            $placement, $parentKey,
            (int)($body['sort_order'] ?? $section['sort_order']),
            $id,
        ]);
        Json::send(['ok' => true, 'slug' => $slug]);
    }

    if ($method === 'DELETE') {
        $pdo->prepare('DELETE FROM admin_sections WHERE id = ?')->execute([$id]);
        Json::send(['ok' => true]);
    }

    Json::fail('Method not allowed', 405);
};
