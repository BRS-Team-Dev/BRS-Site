<?php
declare(strict_types=1);

use BRS\Auth;
use BRS\Db;
use BRS\Json;

/*
 * Contractors CRUD — Operations system at /operations/contractors.
 *
 *   GET    /api/contractors
 *   POST   /api/contractors
 *   GET    /api/contractors/:id
 *   PUT    /api/contractors/:id
 *   DELETE /api/contractors/:id
 *   /api/contractors/:id/notes[/:nid]
 */

return function (string $method, array $segs): void {
    Auth::require();
    $pdo = Db::tpdo();

    $statuses   = ['active', 'inactive', 'on_break', 'ended'];
    $types      = ['individual', 'agency', 'freelancer', 'consultant'];
    $sourceKind = ['internal', 'external'];
    $engKinds   = ['hourly', 'daily', 'project', 'retainer', 'full_time', 'part_time'];
    $ir35Kinds  = ['inside', 'outside', 'not_applicable', 'unknown'];

    if (!isset($segs[1])) {
        if ($method === 'GET') {
            $rows = $pdo->query(
                'SELECT c.*, u.email AS manager_email,
                        au.email AS account_email, au.is_active AS account_active
                 FROM contractors c
                 LEFT JOIN admin_users u  ON u.id = c.project_manager_id
                 LEFT JOIN admin_users au ON au.id = c.admin_user_id
                 ORDER BY c.id DESC LIMIT 1000'
            )->fetchAll();
            Json::send(['contractors' => $rows]);
        }
        if ($method === 'POST') {
            $body = Json::readBody();
            $name = trim((string)($body['name'] ?? ''));
            if ($name === '') Json::fail('Name is required', 400);

            $status = (string)($body['status'] ?? 'active');
            if (!in_array($status, $statuses, true)) $status = 'active';
            $type   = (string)($body['contractor_type'] ?? 'freelancer');
            if (!in_array($type, $types, true)) $type = 'freelancer';
            $kind   = (string)($body['internal_external'] ?? 'external');
            if (!in_array($kind, $sourceKind, true)) $kind = 'external';
            $eng    = (string)($body['engagement_type'] ?? 'hourly');
            if (!in_array($eng, $engKinds, true)) $eng = 'hourly';
            $ir35   = (string)($body['ir35_status'] ?? 'unknown');
            if (!in_array($ir35, $ir35Kinds, true)) $ir35 = 'unknown';
            $currency = strtoupper(trim((string)($body['currency'] ?? 'GBP')));
            if (strlen($currency) !== 3) $currency = 'GBP';

            $ins = $pdo->prepare(
                'INSERT INTO contractors
                 (name, contractor_type, internal_external, discipline, status, engagement_type,
                  rate, currency, start_date, end_date,
                  primary_email, primary_phone, website, address,
                  tax_id, vat_number, company_number, ir35_status, notes, project_manager_id)
                 VALUES (?,?,?,?,?,?, ?,?,?,?, ?,?,?,?, ?,?,?,?,?,?)'
            );
            $ins->execute([
                $name, $type, $kind,
                trim((string)($body['discipline'] ?? '')) ?: null,
                $status, $eng,
                isset($body['rate']) && $body['rate'] !== '' ? (float)$body['rate'] : null,
                $currency,
                trim((string)($body['start_date'] ?? '')) ?: null,
                trim((string)($body['end_date'] ?? '')) ?: null,
                trim((string)($body['primary_email'] ?? '')) ?: null,
                trim((string)($body['primary_phone'] ?? '')) ?: null,
                trim((string)($body['website'] ?? '')) ?: null,
                $body['address'] ?? null,
                trim((string)($body['tax_id'] ?? '')) ?: null,
                trim((string)($body['vat_number'] ?? '')) ?: null,
                trim((string)($body['company_number'] ?? '')) ?: null,
                $ir35,
                $body['notes'] ?? null,
                isset($body['project_manager_id']) && $body['project_manager_id'] !== ''
                    ? (int)$body['project_manager_id'] : null,
            ]);
            $newId = (int)$pdo->lastInsertId();
            \BRS\Contracts::fanOutToNewEntity($pdo, 'contractor', $newId);
            Json::send(['id' => $newId], 201);
        }
        Json::fail('Method not allowed', 405);
    }

    $id = (int)$segs[1];
    if ($id <= 0) Json::fail('Invalid id', 400);

    $stmt = $pdo->prepare(
        'SELECT c.*, u.email AS manager_email,
                au.email AS account_email, au.is_active AS account_active,
                au.display_name AS account_display_name
         FROM contractors c
         LEFT JOIN admin_users u  ON u.id = c.project_manager_id
         LEFT JOIN admin_users au ON au.id = c.admin_user_id
         WHERE c.id = ?'
    );
    $stmt->execute([$id]);
    $contractor = $stmt->fetch();
    if (!$contractor) Json::fail('Contractor not found', 404);

    // ───── /api/contractors/:id/clients[/:linkId] ───────────────────
    // Assigned clients for this contractor (read-only from the contractor's
    // side — attach/detach is done from the client page).
    if (($segs[2] ?? '') === 'clients') {
        if ($method === 'GET') {
            $rows = $pdo->prepare(
                'SELECT cc.id AS link_id, cc.role, cc.added_at,
                        c.id AS client_id, c.name AS client_name
                 FROM client_contractors cc
                 JOIN clients c ON c.id = cc.client_id
                 WHERE cc.contractor_id = ?
                 ORDER BY cc.added_at DESC'
            );
            $rows->execute([$id]);
            Json::send(['clients' => $rows->fetchAll()]);
        }
        Json::fail('Method not allowed', 405);
    }

    // ───── /api/contractors/:id/security ────────────────────────────
    if (($segs[2] ?? '') === 'security') {
        if ($method === 'GET') {
            Json::send(['permissions' => [
                'view_clients'     => (bool)$contractor['perm_view_clients'],
                'view_tasks'       => (bool)$contractor['perm_view_tasks'],
                'view_invoices'    => (bool)$contractor['perm_view_invoices'],
                'upload_documents' => (bool)$contractor['perm_upload_documents'],
                'edit_profile'     => (bool)$contractor['perm_edit_profile'],
            ]]);
        }
        if ($method === 'PUT') {
            $b = Json::readBody();
            $p = (array)($b['permissions'] ?? []);
            $pdo->prepare(
                'UPDATE contractors
                 SET perm_view_clients     = ?,
                     perm_view_tasks       = ?,
                     perm_view_invoices    = ?,
                     perm_upload_documents = ?,
                     perm_edit_profile     = ?
                 WHERE id = ?'
            )->execute([
                !empty($p['view_clients'])     ? 1 : 0,
                !empty($p['view_tasks'])       ? 1 : 0,
                !empty($p['view_invoices'])    ? 1 : 0,
                !empty($p['upload_documents']) ? 1 : 0,
                !empty($p['edit_profile'])     ? 1 : 0,
                $id,
            ]);
            Json::send(['ok' => true]);
        }
        Json::fail('Method not allowed', 405);
    }

    // ───── /api/contractors/:id/account ─────────────────────────────
    // Manage the contractor's login: enable (create admin_user + link),
    // disable (deactivate the admin_user), or reset-password (issue a
    // new temp password). Mirrors the hr_employees <-> admin_users flow.
    if (($segs[2] ?? '') === 'account') {
        $action = (string)($segs[3] ?? '');
        $userId = (int)$contractor['admin_user_id'];

        if ($action === 'enable' && $method === 'POST') {
            $body  = Json::readBody();
            $email = trim((string)($body['email'] ?? $contractor['primary_email'] ?? ''));
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) Json::fail('Valid email required', 400);
            if ($userId > 0) Json::fail('Login is already enabled for this contractor', 409);

            $exists = $pdo->prepare('SELECT id FROM admin_users WHERE email = ?');
            $exists->execute([$email]);
            $existingId = (int)$exists->fetchColumn();
            if ($existingId) Json::fail('That email is already used by another user', 409);

            $tempPassword = bin2hex(random_bytes(6));
            $hash         = password_hash($tempPassword, PASSWORD_DEFAULT);
            $ins = $pdo->prepare('INSERT INTO admin_users (email, display_name, password_hash, role, is_active, must_change_password)
                                  VALUES (?, ?, ?, "contractor", 1, 1)');
            $ins->execute([$email, $contractor['name'], $hash]);
            $newUserId = (int)$pdo->lastInsertId();

            $onboardingToken = bin2hex(random_bytes(16));
            $pdo->prepare('UPDATE contractors SET admin_user_id = ?, onboarding_token = ? WHERE id = ?')
                ->execute([$newUserId, $onboardingToken, $id]);

            Json::send([
                'ok'             => true,
                'admin_user_id'  => $newUserId,
                'email'          => $email,
                'temp_password'  => $tempPassword,
                'onboarding_token' => $onboardingToken,
            ]);
        }

        if ($action === 'disable' && $method === 'POST') {
            if ($userId <= 0) Json::fail('No login to disable', 404);
            $pdo->prepare('UPDATE admin_users SET is_active = 0 WHERE id = ?')->execute([$userId]);
            Json::send(['ok' => true]);
        }

        if ($action === 'reactivate' && $method === 'POST') {
            if ($userId <= 0) Json::fail('No login to reactivate', 404);
            $pdo->prepare('UPDATE admin_users SET is_active = 1 WHERE id = ?')->execute([$userId]);
            Json::send(['ok' => true]);
        }

        if ($action === 'reset-password' && $method === 'POST') {
            if ($userId <= 0) Json::fail('No login to reset', 404);
            $tempPassword = bin2hex(random_bytes(6));
            $hash         = password_hash($tempPassword, PASSWORD_DEFAULT);
            $pdo->prepare('UPDATE admin_users SET password_hash = ?, is_active = 1, must_change_password = 1 WHERE id = ?')
                ->execute([$hash, $userId]);
            Json::send(['ok' => true, 'temp_password' => $tempPassword]);
        }

        Json::fail('Unknown account action', 404);
    }

    // ───── /api/contractors/:id/notes[/:nid] ────────────────────────
    if (($segs[2] ?? '') === 'notes') {
        $nid = isset($segs[3]) ? (int)$segs[3] : null;
        if ($nid === null) {
            if ($method === 'GET') {
                $rows = $pdo->prepare('SELECT * FROM contractor_notes WHERE contractor_id = ? ORDER BY sort_order, id DESC');
                $rows->execute([$id]);
                Json::send(['notes' => $rows->fetchAll()]);
            }
            if ($method === 'POST') {
                $body  = Json::readBody();
                $title = trim((string)($body['title'] ?? ''));
                if ($title === '') Json::fail('Title is required', 400);
                $ins = $pdo->prepare('INSERT INTO contractor_notes (contractor_id, title, body, sort_order) VALUES (?,?,?,?)');
                $ins->execute([$id, $title, $body['body'] ?? null, (int)($body['sort_order'] ?? 0)]);
                Json::send(['id' => (int)$pdo->lastInsertId()], 201);
            }
            Json::fail('Method not allowed', 405);
        }
        $nstmt = $pdo->prepare('SELECT * FROM contractor_notes WHERE id = ? AND contractor_id = ?');
        $nstmt->execute([$nid, $id]);
        $note = $nstmt->fetch();
        if (!$note) Json::fail('Note not found', 404);
        if ($method === 'PUT') {
            $body  = Json::readBody();
            $title = trim((string)($body['title'] ?? $note['title']));
            if ($title === '') Json::fail('Title is required', 400);
            $pdo->prepare('UPDATE contractor_notes SET title=?, body=?, sort_order=? WHERE id = ?')->execute([
                $title,
                array_key_exists('body', $body) ? $body['body'] : $note['body'],
                (int)($body['sort_order'] ?? $note['sort_order']),
                $nid,
            ]);
            Json::send(['ok' => true]);
        }
        if ($method === 'DELETE') {
            $pdo->prepare('DELETE FROM contractor_notes WHERE id = ?')->execute([$nid]);
            Json::send(['ok' => true]);
        }
        Json::fail('Method not allowed', 405);
    }

    if ($method === 'GET') Json::send(['contractor' => $contractor]);

    if ($method === 'PUT') {
        $body = Json::readBody();
        $name = trim((string)($body['name'] ?? $contractor['name']));
        if ($name === '') Json::fail('Name is required', 400);

        $status = array_key_exists('status', $body) ? (string)$body['status'] : (string)$contractor['status'];
        if (!in_array($status, $statuses, true)) Json::fail('Invalid status', 400);
        $type = array_key_exists('contractor_type', $body) ? (string)$body['contractor_type'] : (string)$contractor['contractor_type'];
        if (!in_array($type, $types, true)) Json::fail('Invalid contractor_type', 400);
        $kind = array_key_exists('internal_external', $body) ? (string)$body['internal_external'] : (string)$contractor['internal_external'];
        if (!in_array($kind, $sourceKind, true)) Json::fail('Invalid internal_external', 400);
        $eng = array_key_exists('engagement_type', $body) ? (string)$body['engagement_type'] : (string)$contractor['engagement_type'];
        if (!in_array($eng, $engKinds, true)) Json::fail('Invalid engagement_type', 400);
        $ir35 = array_key_exists('ir35_status', $body) ? (string)$body['ir35_status'] : (string)$contractor['ir35_status'];
        if (!in_array($ir35, $ir35Kinds, true)) Json::fail('Invalid ir35_status', 400);

        $currency = strtoupper(trim((string)($body['currency'] ?? $contractor['currency'])));
        if (strlen($currency) !== 3) $currency = (string)$contractor['currency'];

        $pdo->prepare(
            'UPDATE contractors
             SET name=?, contractor_type=?, internal_external=?, discipline=?, status=?, engagement_type=?,
                 rate=?, currency=?, start_date=?, end_date=?,
                 primary_email=?, primary_phone=?, website=?, address=?,
                 tax_id=?, vat_number=?, company_number=?, ir35_status=?, notes=?, project_manager_id=?
             WHERE id = ?'
        )->execute([
            $name, $type, $kind,
            array_key_exists('discipline', $body) ? (trim((string)$body['discipline']) ?: null) : $contractor['discipline'],
            $status, $eng,
            array_key_exists('rate', $body)
                ? ($body['rate'] === '' || $body['rate'] === null ? null : (float)$body['rate'])
                : $contractor['rate'],
            $currency,
            array_key_exists('start_date', $body) ? (trim((string)$body['start_date']) ?: null) : $contractor['start_date'],
            array_key_exists('end_date',   $body) ? (trim((string)$body['end_date'])   ?: null) : $contractor['end_date'],
            array_key_exists('primary_email', $body) ? (trim((string)$body['primary_email']) ?: null) : $contractor['primary_email'],
            array_key_exists('primary_phone', $body) ? (trim((string)$body['primary_phone']) ?: null) : $contractor['primary_phone'],
            array_key_exists('website', $body) ? (trim((string)$body['website']) ?: null) : $contractor['website'],
            array_key_exists('address', $body) ? ($body['address'] ?: null) : $contractor['address'],
            array_key_exists('tax_id', $body) ? (trim((string)$body['tax_id']) ?: null) : $contractor['tax_id'],
            array_key_exists('vat_number', $body) ? (trim((string)$body['vat_number']) ?: null) : $contractor['vat_number'],
            array_key_exists('company_number', $body) ? (trim((string)$body['company_number']) ?: null) : $contractor['company_number'],
            $ir35,
            array_key_exists('notes', $body) ? $body['notes'] : $contractor['notes'],
            array_key_exists('project_manager_id', $body)
                ? ($body['project_manager_id'] === '' || $body['project_manager_id'] === null
                    ? null : (int)$body['project_manager_id'])
                : $contractor['project_manager_id'],
            $id,
        ]);
        Json::send(['ok' => true]);
    }

    if ($method === 'DELETE') {
        $pdo->prepare('DELETE FROM contractors WHERE id = ?')->execute([$id]);
        Json::send(['ok' => true]);
    }

    Json::fail('Method not allowed', 405);
};
