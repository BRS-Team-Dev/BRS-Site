<?php
declare(strict_types=1);

use BRS\Auth;
use BRS\Db;
use BRS\Json;

/*
 * GET /api/assignees — flat, cheap feed powering the "assign a person" picker
 * on clients + leads. Returns the three sources (employees / contractors /
 * partners) as one array. Filter client-side by type + typeahead.
 *
 * Each row has a stable id shape:  { type: 'employee'|'contractor'|'partner',
 *                                    id, name, subtitle, email? }
 */

return function (string $method, array $segs): void {
    Auth::require();
    if ($method !== 'GET') Json::fail('Method not allowed', 405);
    $pdo = Db::tpdo();

    $out = [];

    $emp = $pdo->query(
        "SELECT id, CONCAT(first_name, ' ', last_name) AS name,
                position AS subtitle
         FROM hr_employees
         WHERE status IN ('onboarding','active')
         ORDER BY first_name, last_name"
    )->fetchAll();
    foreach ($emp as $e) {
        $out[] = ['type' => 'employee', 'id' => (int)$e['id'], 'name' => $e['name'], 'subtitle' => $e['subtitle']];
    }

    $ctr = $pdo->query(
        "SELECT id, name, discipline AS subtitle
         FROM contractors
         WHERE status IN ('active','on_break')
         ORDER BY name"
    )->fetchAll();
    foreach ($ctr as $c) {
        $out[] = ['type' => 'contractor', 'id' => (int)$c['id'], 'name' => $c['name'], 'subtitle' => $c['subtitle']];
    }

    $prt = $pdo->query(
        "SELECT id, COALESCE(trading_name, legal_name) AS name,
                partnership_type AS subtitle
         FROM partners
         WHERE status IN ('prospective','active')
         ORDER BY name"
    )->fetchAll();
    foreach ($prt as $p) {
        $out[] = ['type' => 'partner', 'id' => (int)$p['id'], 'name' => $p['name'], 'subtitle' => $p['subtitle']];
    }

    Json::send(['assignees' => $out]);
};
