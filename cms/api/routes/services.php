<?php
declare(strict_types=1);

use BRS\Auth;
use BRS\Db;
use BRS\Json;

/*
 * Service offerings CRUD — the company's catalogue of sellable services,
 * surfaced on the CRM Services page (/admin/services).
 *
 *   GET    /api/services            list (newest active first)
 *   POST   /api/services            create
 *   GET    /api/services/:id        read one
 *   PUT    /api/services/:id        update
 *   DELETE /api/services/:id        delete
 *
 * NB: this is distinct from GET /api/clients/:id/services (a client's
 * qualified onboarding services) — that lives in clients.php.
 */

return function (string $method, array $segs): void {
    Auth::require();
    $pdo = Db::pdo();

    $payTypes = ['one_off', 'recurring'];
    $cadences = ['weekly', 'monthly', 'quarterly', 'yearly'];

    if (!isset($segs[1])) {
        if ($method === 'GET') {
            $rows = $pdo->query(
                'SELECT * FROM service_offerings ORDER BY is_active DESC, sort_order, id DESC'
            )->fetchAll();
            Json::send(['services' => $rows]);
        }
        if ($method === 'POST') {
            $body = Json::readBody();
            $name = trim((string)($body['name'] ?? ''));
            if ($name === '') Json::fail('Name is required', 400);

            $payType = $body['payment_type'] ?? 'one_off';
            if (!in_array($payType, $payTypes, true)) $payType = 'one_off';
            // Cadence only applies to recurring; null otherwise.
            $cadence = null;
            if ($payType === 'recurring') {
                $cadence = $body['repeat_duration'] ?? null;
                if (!in_array($cadence, $cadences, true)) $cadence = null;
            }
            $currency = strtoupper(trim((string)($body['currency'] ?? 'GBP')));
            if (strlen($currency) !== 3) $currency = 'GBP';

            $ins = $pdo->prepare(
                'INSERT INTO service_offerings
                 (name, description, price, currency, payment_type, repeat_duration, is_active, sort_order)
                 VALUES (?,?,?,?,?,?,?,?)'
            );
            $ins->execute([
                $name,
                trim((string)($body['description'] ?? '')) ?: null,
                isset($body['price']) && $body['price'] !== '' && $body['price'] !== null ? (float)$body['price'] : null,
                $currency,
                $payType,
                $cadence,
                array_key_exists('is_active', $body) ? (!empty($body['is_active']) ? 1 : 0) : 1,
                (int)($body['sort_order'] ?? 0),
            ]);
            Json::send(['id' => (int)$pdo->lastInsertId()], 201);
        }
        Json::fail('Method not allowed', 405);
    }

    $id = (int)$segs[1];
    if ($id <= 0) Json::fail('Invalid id', 400);

    $stmt = $pdo->prepare('SELECT * FROM service_offerings WHERE id = ?');
    $stmt->execute([$id]);
    $service = $stmt->fetch();
    if (!$service) Json::fail('Service not found', 404);

    if ($method === 'GET') Json::send(['service' => $service]);

    if ($method === 'PUT') {
        $body = Json::readBody();
        $name = trim((string)($body['name'] ?? $service['name']));
        if ($name === '') Json::fail('Name is required', 400);

        $payType = array_key_exists('payment_type', $body) ? (string)$body['payment_type'] : (string)$service['payment_type'];
        if (!in_array($payType, $payTypes, true)) $payType = 'one_off';
        $cadence = null;
        if ($payType === 'recurring') {
            $cadence = array_key_exists('repeat_duration', $body) ? ($body['repeat_duration'] ?? null) : $service['repeat_duration'];
            if (!in_array($cadence, $cadences, true)) $cadence = null;
        }
        $currency = strtoupper(trim((string)($body['currency'] ?? $service['currency'])));
        if (strlen($currency) !== 3) $currency = (string)$service['currency'];

        $pdo->prepare(
            'UPDATE service_offerings
             SET name=?, description=?, price=?, currency=?, payment_type=?, repeat_duration=?, is_active=?, sort_order=?
             WHERE id = ?'
        )->execute([
            $name,
            array_key_exists('description', $body) ? (trim((string)$body['description']) ?: null) : $service['description'],
            array_key_exists('price', $body)
                ? ($body['price'] === '' || $body['price'] === null ? null : (float)$body['price'])
                : $service['price'],
            $currency,
            $payType,
            $cadence,
            array_key_exists('is_active', $body) ? (!empty($body['is_active']) ? 1 : 0) : (int)$service['is_active'],
            (int)($body['sort_order'] ?? $service['sort_order']),
            $id,
        ]);
        Json::send(['ok' => true]);
    }

    if ($method === 'DELETE') {
        $pdo->prepare('DELETE FROM service_offerings WHERE id = ?')->execute([$id]);
        Json::send(['ok' => true]);
    }

    Json::fail('Method not allowed', 405);
};
