<?php
declare(strict_types=1);

use BRS\Auth;
use BRS\Db;
use BRS\Json;

/*
 * Affiliates CRUD — Operations system at /operations/affiliates.
 *
 *   GET    /api/affiliates
 *   POST   /api/affiliates
 *   GET    /api/affiliates/:id
 *   PUT    /api/affiliates/:id
 *   DELETE /api/affiliates/:id
 *   /api/affiliates/:id/notes[/:nid]
 */

return function (string $method, array $segs): void {
    Auth::require();
    $pdo = Db::tpdo();

    $statuses    = ['pending', 'active', 'paused', 'suspended', 'terminated'];
    $tiers       = ['bronze', 'silver', 'gold', 'platinum'];
    $types       = ['individual', 'company'];
    $commTypes   = ['percentage', 'flat'];
    $payoutKinds = ['bank_transfer', 'paypal', 'stripe', 'other'];

    if (!isset($segs[1])) {
        if ($method === 'GET') {
            $rows = $pdo->query('SELECT * FROM affiliates ORDER BY id DESC LIMIT 1000')->fetchAll();
            Json::send(['affiliates' => $rows]);
        }
        if ($method === 'POST') {
            $body = Json::readBody();
            $name = trim((string)($body['name'] ?? ''));
            if ($name === '') Json::fail('Name is required', 400);
            $code = trim((string)($body['affiliate_code'] ?? ''));
            if ($code === '') Json::fail('Affiliate code is required', 400);

            $status   = (string)($body['status']         ?? 'pending');
            if (!in_array($status, $statuses, true))     $status   = 'pending';
            $tier     = (string)($body['tier']           ?? 'bronze');
            if (!in_array($tier, $tiers, true))          $tier     = 'bronze';
            $type     = (string)($body['affiliate_type'] ?? 'individual');
            if (!in_array($type, $types, true))          $type     = 'individual';
            $commType = (string)($body['commission_type'] ?? 'percentage');
            if (!in_array($commType, $commTypes, true))  $commType = 'percentage';
            $payout   = (string)($body['payout_method']   ?? 'bank_transfer');
            if (!in_array($payout, $payoutKinds, true))  $payout   = 'bank_transfer';

            $currency = strtoupper(trim((string)($body['currency'] ?? 'GBP')));
            if (strlen($currency) !== 3) $currency = 'GBP';

            try {
                $ins = $pdo->prepare(
                    'INSERT INTO affiliates
                     (name, affiliate_type, status, tier, affiliate_code, referral_link,
                      commission_rate, commission_type, currency,
                      payout_method, payout_threshold, payment_terms, marketing_channel,
                      joined_date, end_date,
                      primary_email, primary_phone, website, social_handles, notes)
                     VALUES (?,?,?,?,?,?, ?,?,?, ?,?,?,?, ?,?, ?,?,?,?,?)'
                );
                $ins->execute([
                    $name, $type, $status, $tier, $code,
                    trim((string)($body['referral_link'] ?? '')) ?: null,
                    isset($body['commission_rate']) && $body['commission_rate'] !== '' ? (float)$body['commission_rate'] : null,
                    $commType, $currency,
                    $payout,
                    isset($body['payout_threshold']) && $body['payout_threshold'] !== '' ? (float)$body['payout_threshold'] : null,
                    trim((string)($body['payment_terms']     ?? '')) ?: null,
                    trim((string)($body['marketing_channel'] ?? '')) ?: null,
                    trim((string)($body['joined_date'] ?? '')) ?: null,
                    trim((string)($body['end_date']    ?? '')) ?: null,
                    trim((string)($body['primary_email'] ?? '')) ?: null,
                    trim((string)($body['primary_phone'] ?? '')) ?: null,
                    trim((string)($body['website']        ?? '')) ?: null,
                    $body['social_handles'] ?? null,
                    $body['notes'] ?? null,
                ]);
            } catch (\PDOException $e) {
                if ((int)$e->errorInfo[1] === 1062) Json::fail('That affiliate code is already in use.', 409);
                throw $e;
            }
            $newId = (int)$pdo->lastInsertId();
            \BRS\Contracts::fanOutToNewEntity($pdo, 'affiliate', $newId);
            Json::send(['id' => $newId], 201);
        }
        Json::fail('Method not allowed', 405);
    }

    $id = (int)$segs[1];
    if ($id <= 0) Json::fail('Invalid id', 400);

    $stmt = $pdo->prepare('SELECT * FROM affiliates WHERE id = ?');
    $stmt->execute([$id]);
    $affiliate = $stmt->fetch();
    if (!$affiliate) Json::fail('Affiliate not found', 404);

    // ───── /api/affiliates/:id/notes[/:nid] ──────────────────────────
    if (($segs[2] ?? '') === 'notes') {
        $nid = isset($segs[3]) ? (int)$segs[3] : null;
        if ($nid === null) {
            if ($method === 'GET') {
                $rows = $pdo->prepare('SELECT * FROM affiliate_notes WHERE affiliate_id = ? ORDER BY sort_order, id DESC');
                $rows->execute([$id]);
                Json::send(['notes' => $rows->fetchAll()]);
            }
            if ($method === 'POST') {
                $body  = Json::readBody();
                $title = trim((string)($body['title'] ?? ''));
                if ($title === '') Json::fail('Title is required', 400);
                $ins = $pdo->prepare('INSERT INTO affiliate_notes (affiliate_id, title, body, sort_order) VALUES (?,?,?,?)');
                $ins->execute([$id, $title, $body['body'] ?? null, (int)($body['sort_order'] ?? 0)]);
                Json::send(['id' => (int)$pdo->lastInsertId()], 201);
            }
            Json::fail('Method not allowed', 405);
        }
        $nstmt = $pdo->prepare('SELECT * FROM affiliate_notes WHERE id = ? AND affiliate_id = ?');
        $nstmt->execute([$nid, $id]);
        $note = $nstmt->fetch();
        if (!$note) Json::fail('Note not found', 404);
        if ($method === 'PUT') {
            $body  = Json::readBody();
            $title = trim((string)($body['title'] ?? $note['title']));
            if ($title === '') Json::fail('Title is required', 400);
            $pdo->prepare('UPDATE affiliate_notes SET title=?, body=?, sort_order=? WHERE id = ?')->execute([
                $title,
                array_key_exists('body', $body) ? $body['body'] : $note['body'],
                (int)($body['sort_order'] ?? $note['sort_order']),
                $nid,
            ]);
            Json::send(['ok' => true]);
        }
        if ($method === 'DELETE') {
            $pdo->prepare('DELETE FROM affiliate_notes WHERE id = ?')->execute([$nid]);
            Json::send(['ok' => true]);
        }
        Json::fail('Method not allowed', 405);
    }

    if ($method === 'GET') Json::send(['affiliate' => $affiliate]);

    if ($method === 'PUT') {
        $body = Json::readBody();
        $name = trim((string)($body['name'] ?? $affiliate['name']));
        if ($name === '') Json::fail('Name is required', 400);

        $status   = array_key_exists('status', $body)   ? (string)$body['status']   : (string)$affiliate['status'];
        if (!in_array($status, $statuses, true))   Json::fail('Invalid status', 400);
        $tier     = array_key_exists('tier', $body)     ? (string)$body['tier']     : (string)$affiliate['tier'];
        if (!in_array($tier, $tiers, true))        Json::fail('Invalid tier', 400);
        $type     = array_key_exists('affiliate_type', $body) ? (string)$body['affiliate_type'] : (string)$affiliate['affiliate_type'];
        if (!in_array($type, $types, true))        Json::fail('Invalid affiliate_type', 400);
        $commType = array_key_exists('commission_type', $body) ? (string)$body['commission_type'] : (string)$affiliate['commission_type'];
        if (!in_array($commType, $commTypes, true))Json::fail('Invalid commission_type', 400);
        $payout   = array_key_exists('payout_method', $body)   ? (string)$body['payout_method']   : (string)$affiliate['payout_method'];
        if (!in_array($payout, $payoutKinds, true))Json::fail('Invalid payout_method', 400);

        $code = array_key_exists('affiliate_code', $body) ? trim((string)$body['affiliate_code']) : (string)$affiliate['affiliate_code'];
        if ($code === '') Json::fail('Affiliate code required', 400);

        $currency = strtoupper(trim((string)($body['currency'] ?? $affiliate['currency'])));
        if (strlen($currency) !== 3) $currency = (string)$affiliate['currency'];

        try {
            $pdo->prepare(
                'UPDATE affiliates
                 SET name=?, affiliate_type=?, status=?, tier=?, affiliate_code=?, referral_link=?,
                     commission_rate=?, commission_type=?, currency=?,
                     payout_method=?, payout_threshold=?, payment_terms=?, marketing_channel=?,
                     joined_date=?, end_date=?,
                     primary_email=?, primary_phone=?, website=?, social_handles=?, notes=?
                 WHERE id = ?'
            )->execute([
                $name, $type, $status, $tier, $code,
                array_key_exists('referral_link', $body) ? (trim((string)$body['referral_link']) ?: null) : $affiliate['referral_link'],
                array_key_exists('commission_rate', $body)
                    ? ($body['commission_rate'] === '' || $body['commission_rate'] === null ? null : (float)$body['commission_rate'])
                    : $affiliate['commission_rate'],
                $commType, $currency,
                $payout,
                array_key_exists('payout_threshold', $body)
                    ? ($body['payout_threshold'] === '' || $body['payout_threshold'] === null ? null : (float)$body['payout_threshold'])
                    : $affiliate['payout_threshold'],
                array_key_exists('payment_terms',     $body) ? (trim((string)$body['payment_terms'])     ?: null) : $affiliate['payment_terms'],
                array_key_exists('marketing_channel', $body) ? (trim((string)$body['marketing_channel']) ?: null) : $affiliate['marketing_channel'],
                array_key_exists('joined_date',       $body) ? (trim((string)$body['joined_date'])       ?: null) : $affiliate['joined_date'],
                array_key_exists('end_date',          $body) ? (trim((string)$body['end_date'])          ?: null) : $affiliate['end_date'],
                array_key_exists('primary_email',     $body) ? (trim((string)$body['primary_email'])     ?: null) : $affiliate['primary_email'],
                array_key_exists('primary_phone',     $body) ? (trim((string)$body['primary_phone'])     ?: null) : $affiliate['primary_phone'],
                array_key_exists('website',           $body) ? (trim((string)$body['website'])           ?: null) : $affiliate['website'],
                array_key_exists('social_handles',    $body) ? $body['social_handles'] : $affiliate['social_handles'],
                array_key_exists('notes',             $body) ? $body['notes']          : $affiliate['notes'],
                $id,
            ]);
        } catch (\PDOException $e) {
            if ((int)$e->errorInfo[1] === 1062) Json::fail('That affiliate code is already in use.', 409);
            throw $e;
        }
        Json::send(['ok' => true]);
    }

    if ($method === 'DELETE') {
        $pdo->prepare('DELETE FROM affiliates WHERE id = ?')->execute([$id]);
        Json::send(['ok' => true]);
    }

    Json::fail('Method not allowed', 405);
};
