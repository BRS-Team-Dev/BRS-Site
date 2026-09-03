<?php
declare(strict_types=1);

use BRS\Auth;
use BRS\Db;
use BRS\Ddl;
use BRS\Json;

return function (string $method, array $segs): void {
    Auth::require();
    $pdo = Db::tpdo();

    // /api/forms/:id/submissions  (segs = ['forms', id, 'submissions', maybeRowId])
    if (($segs[0] ?? '') !== 'forms' || ($segs[2] ?? '') !== 'submissions') {
        Json::fail('Not found', 404);
    }
    $id = (int)($segs[1] ?? 0);
    if ($id <= 0) Json::fail('Invalid form id', 400);

    $form = $pdo->prepare('SELECT slug FROM forms WHERE id = ?');
    $form->execute([$id]);
    $form = $form->fetch();
    if (!$form) Json::fail('Form not found', 404);

    $table = Ddl::tableName($form['slug']);

    if (!isset($segs[3])) {
        if ($method === 'GET') {
            $page = max(1, (int)($_GET['page'] ?? 1));
            $per  = min(200, max(1, (int)($_GET['per'] ?? 50)));
            $off  = ($page - 1) * $per;
            $rows = $pdo->query("SELECT * FROM `$table` ORDER BY id DESC LIMIT $per OFFSET $off")->fetchAll();
            $total = (int)$pdo->query("SELECT COUNT(*) FROM `$table`")->fetchColumn();
            Json::send(['rows' => $rows, 'total' => $total, 'page' => $page, 'per' => $per]);
        }
        Json::fail('Method not allowed', 405);
    }

    $rowId = (int)$segs[3];
    if ($method === 'GET') {
        $st = $pdo->prepare("SELECT * FROM `$table` WHERE id = ?");
        $st->execute([$rowId]);
        $row = $st->fetch();
        if (!$row) Json::fail('Not found', 404);
        Json::send(['row' => $row]);
    }
    if ($method === 'DELETE') {
        $pdo->prepare("DELETE FROM `$table` WHERE id = ?")->execute([$rowId]);
        Json::send(['ok' => true]);
    }
    Json::fail('Method not allowed', 405);
};
