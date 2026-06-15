<?php
declare(strict_types=1);

use BRS\Auth;
use BRS\Db;
use BRS\Json;

/*
 * Partners CRUD — Operations system at /operations/partners.
 *
 *   GET    /api/partners
 *   POST   /api/partners
 *   GET    /api/partners/:id
 *   PUT    /api/partners/:id
 *   DELETE /api/partners/:id
 *   /api/partners/:id/contacts[/:cid]
 *   /api/partners/:id/notes[/:nid]
 */

return function (string $method, array $segs): void {
    Auth::require();
    $pdo = Db::pdo();

    $statuses = ['prospective', 'active', 'paused', 'terminated'];
    $types    = ['strategic', 'reseller', 'technology', 'channel', 'referral', 'other'];
    $tiers    = ['preferred', 'standard', 'prospective'];

    if (!isset($segs[1])) {
        if ($method === 'GET') {
            $rows = $pdo->query(
                'SELECT p.*, u.email AS owner_email
                 FROM partners p
                 LEFT JOIN admin_users u ON u.id = p.relationship_owner_id
                 ORDER BY p.id DESC LIMIT 1000'
            )->fetchAll();
            Json::send(['partners' => $rows]);
        }
        if ($method === 'POST') {
            $body = Json::readBody();
            $name = trim((string)($body['legal_name'] ?? ''));
            if ($name === '') Json::fail('Legal name is required', 400);

            $status = (string)($body['status'] ?? 'prospective');
            if (!in_array($status, $statuses, true)) $status = 'prospective';
            $ptype  = (string)($body['partnership_type'] ?? 'strategic');
            if (!in_array($ptype, $types, true)) $ptype = 'strategic';
            $tier   = (string)($body['tier'] ?? 'standard');
            if (!in_array($tier, $tiers, true)) $tier = 'standard';
            $currency = strtoupper(trim((string)($body['currency'] ?? 'GBP')));
            if (strlen($currency) !== 3) $currency = 'GBP';

            $ins = $pdo->prepare(
                'INSERT INTO partners
                 (legal_name, trading_name, partnership_type, tier, status,
                  start_date, renewal_date, auto_renew, contract_value, currency,
                  primary_email, primary_phone, website, address,
                  registration_number, vat_number, scope, relationship_owner_id)
                 VALUES (?,?,?,?,?, ?,?,?,?,?, ?,?,?,?, ?,?,?,?)'
            );
            $ins->execute([
                $name,
                trim((string)($body['trading_name'] ?? '')) ?: null,
                $ptype, $tier, $status,
                trim((string)($body['start_date']   ?? '')) ?: null,
                trim((string)($body['renewal_date'] ?? '')) ?: null,
                !empty($body['auto_renew']) ? 1 : 0,
                isset($body['contract_value']) && $body['contract_value'] !== '' ? (float)$body['contract_value'] : null,
                $currency,
                trim((string)($body['primary_email'] ?? '')) ?: null,
                trim((string)($body['primary_phone'] ?? '')) ?: null,
                trim((string)($body['website'] ?? '')) ?: null,
                $body['address'] ?? null,
                trim((string)($body['registration_number'] ?? '')) ?: null,
                trim((string)($body['vat_number'] ?? '')) ?: null,
                $body['scope'] ?? null,
                isset($body['relationship_owner_id']) && $body['relationship_owner_id'] !== ''
                    ? (int)$body['relationship_owner_id'] : null,
            ]);
            $newId = (int)$pdo->lastInsertId();
            \BRS\Contracts::fanOutToNewEntity($pdo, 'partner', $newId);
            Json::send(['id' => $newId], 201);
        }
        Json::fail('Method not allowed', 405);
    }

    $id = (int)$segs[1];
    if ($id <= 0) Json::fail('Invalid id', 400);

    $stmt = $pdo->prepare(
        'SELECT p.*, u.email AS owner_email
         FROM partners p
         LEFT JOIN admin_users u ON u.id = p.relationship_owner_id
         WHERE p.id = ?'
    );
    $stmt->execute([$id]);
    $partner = $stmt->fetch();
    if (!$partner) Json::fail('Partner not found', 404);

    // ───── /api/partners/:id/contacts[/:cid] ──────────────────────
    if (($segs[2] ?? '') === 'contacts') {
        $cid = isset($segs[3]) ? (int)$segs[3] : null;
        if ($cid === null) {
            if ($method === 'GET') {
                $rows = $pdo->prepare('SELECT * FROM partner_contacts WHERE partner_id = ? ORDER BY sort_order, id');
                $rows->execute([$id]);
                Json::send(['contacts' => $rows->fetchAll()]);
            }
            if ($method === 'POST') {
                $body  = Json::readBody();
                $first = trim((string)($body['first_name'] ?? ''));
                if ($first === '') Json::fail('First name is required', 400);
                $ins = $pdo->prepare(
                    'INSERT INTO partner_contacts
                     (partner_id, first_name, last_name, position, email, phone, is_primary, sort_order)
                     VALUES (?,?,?,?,?,?,?,?)'
                );
                $ins->execute([
                    $id, $first,
                    trim((string)($body['last_name'] ?? '')) ?: null,
                    trim((string)($body['position']  ?? '')) ?: null,
                    trim((string)($body['email']     ?? '')) ?: null,
                    trim((string)($body['phone']     ?? '')) ?: null,
                    !empty($body['is_primary']) ? 1 : 0,
                    (int)($body['sort_order'] ?? 0),
                ]);
                Json::send(['id' => (int)$pdo->lastInsertId()], 201);
            }
            Json::fail('Method not allowed', 405);
        }
        $cstmt = $pdo->prepare('SELECT * FROM partner_contacts WHERE id = ? AND partner_id = ?');
        $cstmt->execute([$cid, $id]);
        $contact = $cstmt->fetch();
        if (!$contact) Json::fail('Contact not found', 404);
        if ($method === 'PUT') {
            $body  = Json::readBody();
            $first = trim((string)($body['first_name'] ?? $contact['first_name']));
            if ($first === '') Json::fail('First name is required', 400);
            $pdo->prepare(
                'UPDATE partner_contacts SET first_name=?, last_name=?, position=?, email=?, phone=?,
                 is_primary=?, sort_order=? WHERE id = ?'
            )->execute([
                $first,
                array_key_exists('last_name', $body) ? (trim((string)$body['last_name']) ?: null) : $contact['last_name'],
                array_key_exists('position',  $body) ? (trim((string)$body['position'])  ?: null) : $contact['position'],
                array_key_exists('email',     $body) ? (trim((string)$body['email'])     ?: null) : $contact['email'],
                array_key_exists('phone',     $body) ? (trim((string)$body['phone'])     ?: null) : $contact['phone'],
                array_key_exists('is_primary', $body) ? (!empty($body['is_primary']) ? 1 : 0) : (int)$contact['is_primary'],
                (int)($body['sort_order'] ?? $contact['sort_order']),
                $cid,
            ]);
            Json::send(['ok' => true]);
        }
        if ($method === 'DELETE') {
            $pdo->prepare('DELETE FROM partner_contacts WHERE id = ?')->execute([$cid]);
            Json::send(['ok' => true]);
        }
        Json::fail('Method not allowed', 405);
    }

    // ───── /api/partners/:id/accounts[/:aid] ──────────────────────
    if (($segs[2] ?? '') === 'accounts') {
        $aid = isset($segs[3]) ? (int)$segs[3] : null;
        if ($aid === null) {
            if ($method === 'GET') {
                $rows = $pdo->prepare('SELECT * FROM partner_accounts WHERE partner_id = ? ORDER BY sort_order, id');
                $rows->execute([$id]);
                Json::send(['accounts' => $rows->fetchAll()]);
            }
            if ($method === 'POST') {
                $body = Json::readBody();
                $accountName = trim((string)($body['account_name'] ?? ''));
                if ($accountName === '') Json::fail('Account name is required', 400);
                $ins = $pdo->prepare(
                    'INSERT INTO partner_accounts (partner_id, account_name, login_url, username, password, sort_order)
                     VALUES (?,?,?,?,?,?)'
                );
                $ins->execute([
                    $id, $accountName,
                    trim((string)($body['login_url'] ?? '')) ?: null,
                    trim((string)($body['username']  ?? '')) ?: null,
                    trim((string)($body['password']  ?? '')) ?: null,
                    (int)($body['sort_order'] ?? 0),
                ]);
                Json::send(['id' => (int)$pdo->lastInsertId()], 201);
            }
            Json::fail('Method not allowed', 405);
        }
        $astmt = $pdo->prepare('SELECT * FROM partner_accounts WHERE id = ? AND partner_id = ?');
        $astmt->execute([$aid, $id]);
        $account = $astmt->fetch();
        if (!$account) Json::fail('Account not found', 404);
        if ($method === 'PUT') {
            $body = Json::readBody();
            $accountName = trim((string)($body['account_name'] ?? $account['account_name']));
            if ($accountName === '') Json::fail('Account name is required', 400);
            $pdo->prepare(
                'UPDATE partner_accounts SET account_name=?, login_url=?, username=?, password=?, sort_order=? WHERE id = ?'
            )->execute([
                $accountName,
                array_key_exists('login_url', $body) ? (trim((string)$body['login_url']) ?: null) : $account['login_url'],
                array_key_exists('username',  $body) ? (trim((string)$body['username'])  ?: null) : $account['username'],
                array_key_exists('password',  $body) ? (trim((string)$body['password'])  ?: null) : $account['password'],
                (int)($body['sort_order'] ?? $account['sort_order']),
                $aid,
            ]);
            Json::send(['ok' => true]);
        }
        if ($method === 'DELETE') {
            $pdo->prepare('DELETE FROM partner_accounts WHERE id = ?')->execute([$aid]);
            Json::send(['ok' => true]);
        }
        Json::fail('Method not allowed', 405);
    }

    // ───── /api/partners/:id/notes[/:nid] ─────────────────────────
    if (($segs[2] ?? '') === 'notes') {
        $nid = isset($segs[3]) ? (int)$segs[3] : null;
        if ($nid === null) {
            if ($method === 'GET') {
                $rows = $pdo->prepare('SELECT * FROM partner_notes WHERE partner_id = ? ORDER BY sort_order, id DESC');
                $rows->execute([$id]);
                Json::send(['notes' => $rows->fetchAll()]);
            }
            if ($method === 'POST') {
                $body  = Json::readBody();
                $title = trim((string)($body['title'] ?? ''));
                if ($title === '') Json::fail('Title is required', 400);
                $ins = $pdo->prepare('INSERT INTO partner_notes (partner_id, title, body, sort_order) VALUES (?,?,?,?)');
                $ins->execute([$id, $title, $body['body'] ?? null, (int)($body['sort_order'] ?? 0)]);
                Json::send(['id' => (int)$pdo->lastInsertId()], 201);
            }
            Json::fail('Method not allowed', 405);
        }
        $nstmt = $pdo->prepare('SELECT * FROM partner_notes WHERE id = ? AND partner_id = ?');
        $nstmt->execute([$nid, $id]);
        $note = $nstmt->fetch();
        if (!$note) Json::fail('Note not found', 404);
        if ($method === 'PUT') {
            $body  = Json::readBody();
            $title = trim((string)($body['title'] ?? $note['title']));
            if ($title === '') Json::fail('Title is required', 400);
            $pdo->prepare('UPDATE partner_notes SET title=?, body=?, sort_order=? WHERE id = ?')->execute([
                $title,
                array_key_exists('body', $body) ? $body['body'] : $note['body'],
                (int)($body['sort_order'] ?? $note['sort_order']),
                $nid,
            ]);
            Json::send(['ok' => true]);
        }
        if ($method === 'DELETE') {
            $pdo->prepare('DELETE FROM partner_notes WHERE id = ?')->execute([$nid]);
            Json::send(['ok' => true]);
        }
        Json::fail('Method not allowed', 405);
    }

    if ($method === 'GET') Json::send(['partner' => $partner]);

    if ($method === 'PUT') {
        $body = Json::readBody();
        $name = trim((string)($body['legal_name'] ?? $partner['legal_name']));
        if ($name === '') Json::fail('Legal name is required', 400);

        $status = array_key_exists('status', $body) ? (string)$body['status'] : (string)$partner['status'];
        if (!in_array($status, $statuses, true)) Json::fail('Invalid status', 400);
        $ptype = array_key_exists('partnership_type', $body) ? (string)$body['partnership_type'] : (string)$partner['partnership_type'];
        if (!in_array($ptype, $types, true)) Json::fail('Invalid partnership_type', 400);
        $tier = array_key_exists('tier', $body) ? (string)$body['tier'] : (string)$partner['tier'];
        if (!in_array($tier, $tiers, true)) Json::fail('Invalid tier', 400);

        $currency = strtoupper(trim((string)($body['currency'] ?? $partner['currency'])));
        if (strlen($currency) !== 3) $currency = (string)$partner['currency'];

        $pdo->prepare(
            'UPDATE partners
             SET legal_name=?, trading_name=?, partnership_type=?, tier=?, status=?,
                 start_date=?, renewal_date=?, auto_renew=?, contract_value=?, currency=?,
                 primary_email=?, primary_phone=?, website=?, address=?,
                 registration_number=?, vat_number=?, scope=?, relationship_owner_id=?
             WHERE id = ?'
        )->execute([
            $name,
            array_key_exists('trading_name', $body) ? (trim((string)$body['trading_name']) ?: null) : $partner['trading_name'],
            $ptype, $tier, $status,
            array_key_exists('start_date',   $body) ? (trim((string)$body['start_date'])   ?: null) : $partner['start_date'],
            array_key_exists('renewal_date', $body) ? (trim((string)$body['renewal_date']) ?: null) : $partner['renewal_date'],
            array_key_exists('auto_renew',   $body) ? (!empty($body['auto_renew']) ? 1 : 0) : (int)$partner['auto_renew'],
            array_key_exists('contract_value', $body)
                ? ($body['contract_value'] === '' || $body['contract_value'] === null ? null : (float)$body['contract_value'])
                : $partner['contract_value'],
            $currency,
            array_key_exists('primary_email', $body) ? (trim((string)$body['primary_email']) ?: null) : $partner['primary_email'],
            array_key_exists('primary_phone', $body) ? (trim((string)$body['primary_phone']) ?: null) : $partner['primary_phone'],
            array_key_exists('website',       $body) ? (trim((string)$body['website']) ?: null) : $partner['website'],
            array_key_exists('address',       $body) ? ($body['address'] ?: null) : $partner['address'],
            array_key_exists('registration_number', $body) ? (trim((string)$body['registration_number']) ?: null) : $partner['registration_number'],
            array_key_exists('vat_number',    $body) ? (trim((string)$body['vat_number']) ?: null) : $partner['vat_number'],
            array_key_exists('scope',         $body) ? $body['scope'] : $partner['scope'],
            array_key_exists('relationship_owner_id', $body)
                ? ($body['relationship_owner_id'] === '' || $body['relationship_owner_id'] === null
                    ? null : (int)$body['relationship_owner_id'])
                : $partner['relationship_owner_id'],
            $id,
        ]);
        Json::send(['ok' => true]);
    }

    if ($method === 'DELETE') {
        $pdo->prepare('DELETE FROM partners WHERE id = ?')->execute([$id]);
        Json::send(['ok' => true]);
    }

    Json::fail('Method not allowed', 405);
};
