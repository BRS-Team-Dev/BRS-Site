<?php
declare(strict_types=1);

use BRS\Auth;
use BRS\Db;
use BRS\Json;

require_once __DIR__ . '/../lib/my_tasks.php';
require_once __DIR__ . '/../lib/my_commissions.php';

/*
 * Contractor self-service portal.
 *
 *   GET   /api/contractor/me                — profile + engagement + account info
 *   PATCH /api/contractor/me                — update editable contact fields
 *   POST  /api/contractor/me/password       — change own password (current + new)
 *   GET   /api/contractor/me/documents      — all contractor_documents (all categories)
 *   GET   /api/contractor/me/contracts      — contractor_documents WHERE category='contract'
 *
 * All endpoints are scoped to the row where contractors.admin_user_id = Auth::user()['id'].
 * The 'contractor' role on admin_users only has access to /api/contractor/* — every
 * other route file still gates on Auth::require() + role/tenant checks so the admin
 * CRUD remains locked down.
 */

return function (string $method, array $segs): void {
    $claims = Auth::require();
    $pdo    = Db::tpdo();
    $uid    = (int)($claims['sub'] ?? 0);
    if ($uid <= 0) Json::fail('Not authenticated', 401);

    // @global-scope: PK lookup by admin_user_id from a verified JWT claim; runs against the untenanted PDO by design (contractor row lives on the shared admin_users table).
    $uRow = Db::pdo()->prepare('SELECT id, email, display_name, role FROM admin_users WHERE id = ? LIMIT 1');
    $uRow->execute([$uid]);
    $user = $uRow->fetch();
    if (!$user) Json::fail('Not authenticated', 401);
    if ($user['role'] !== 'contractor') Json::fail('Not a contractor account', 403);

    // Resolve the contractor row for the logged-in user.
    $q = $pdo->prepare('SELECT * FROM contractors WHERE admin_user_id = ? LIMIT 1');
    $q->execute([$uid]);
    $contractor = $q->fetch();
    if (!$contractor) Json::fail('No contractor profile linked to this account', 404);

    $cid = (int)$contractor['id'];

    // Convenience — expose the permission flags to callers so the frontend
    // can hide tabs that the contractor doesn't have access to.
    $perms = [
        'view_clients'     => (bool)($contractor['perm_view_clients']     ?? 0),
        'view_tasks'       => (bool)($contractor['perm_view_tasks']       ?? 0),
        'view_invoices'    => (bool)($contractor['perm_view_invoices']    ?? 0),
        'upload_documents' => (bool)($contractor['perm_upload_documents'] ?? 0),
        'edit_profile'     => (bool)($contractor['perm_edit_profile']     ?? 1),
    ];

    // ── GET /api/contractor/me ────────────────────────────────────────
    if (!isset($segs[2])) {
        if ($method === 'GET') {
            Json::send([
                'contractor'  => $contractor,
                'permissions' => $perms,
                'account'     => [
                    'email'        => $user['email'] ?? null,
                    'display_name' => $user['display_name'] ?? null,
                ],
            ]);
        }
        if ($method === 'PATCH') {
            if (!$perms['edit_profile']) Json::fail('Profile edits are disabled for your account', 403);
            $b = Json::readBody();
            // Editable-by-self allowlist. Rate / status / contract terms are NOT editable here.
            $pdo->prepare('UPDATE contractors
                SET primary_email = ?, primary_phone = ?, website = ?, address = ?,
                    tax_id = ?, vat_number = ?
                WHERE id = ?')
                ->execute([
                    array_key_exists('primary_email', $b) ? (trim((string)$b['primary_email']) ?: null) : $contractor['primary_email'],
                    array_key_exists('primary_phone', $b) ? (trim((string)$b['primary_phone']) ?: null) : $contractor['primary_phone'],
                    array_key_exists('website',       $b) ? (trim((string)$b['website'])       ?: null) : $contractor['website'],
                    array_key_exists('address',       $b) ? ($b['address'] ?: null)                     : $contractor['address'],
                    array_key_exists('tax_id',        $b) ? (trim((string)$b['tax_id'])        ?: null) : $contractor['tax_id'],
                    array_key_exists('vat_number',    $b) ? (trim((string)$b['vat_number'])    ?: null) : $contractor['vat_number'],
                    $cid,
                ]);
            Json::send(['ok' => true]);
        }
        Json::fail('Method not allowed', 405);
    }

    // ── POST /api/contractor/me/password ──────────────────────────────
    if ($segs[2] === 'password' && $method === 'POST') {
        $b       = Json::readBody();
        $current = (string)($b['current_password'] ?? '');
        $next    = (string)($b['new_password'] ?? '');
        if ($current === '' || $next === '') Json::fail('Both current and new password are required', 400);
        if (strlen($next) < 8)               Json::fail('New password must be at least 8 characters', 400);

        // Use the untenanted PDO — admin_users.password_hash lives on the shared row.
        $rawPdo = Db::pdo();
        // @global-scope: PK lookup by admin_user_id from a verified JWT claim; password_hash lives on the shared row by design.
        $row = $rawPdo->prepare('SELECT password_hash FROM admin_users WHERE id = ?');
        $row->execute([$uid]);
        $hash = (string)$row->fetchColumn();
        if (!$hash || !password_verify($current, $hash)) Json::fail('Current password is incorrect', 400);

        // @global-scope: PK update by admin_user_id from a verified JWT claim; own-password change is deliberately cross-tenant.
        $rawPdo->prepare('UPDATE admin_users SET password_hash = ?, must_change_password = 0 WHERE id = ?')
               ->execute([password_hash($next, PASSWORD_DEFAULT), $uid]);
        Json::send(['ok' => true]);
    }

    // ── GET /api/contractor/me/documents ──────────────────────────────
    if ($segs[2] === 'documents' && $method === 'GET') {
        $rows = $pdo->prepare('SELECT id, category, title, file_path, file_size, mime_type,
                                      reference_number, issued_at, expires_at,
                                      requires_signature, signed_at, uploaded_at
                               FROM contractor_documents
                               WHERE contractor_id = ?
                               ORDER BY uploaded_at DESC');
        $rows->execute([$cid]);
        Json::send(['documents' => $rows->fetchAll()]);
    }

    // ── GET /api/contractor/me/contracts ──────────────────────────────
    if ($segs[2] === 'contracts' && $method === 'GET') {
        $rows = $pdo->prepare('SELECT id, title, file_path, reference_number,
                                      issued_at, expires_at, requires_signature,
                                      signed_at, uploaded_at
                               FROM contractor_documents
                               WHERE contractor_id = ? AND category IN ("contract","signed")
                               ORDER BY uploaded_at DESC');
        $rows->execute([$cid]);
        Json::send(['contracts' => $rows->fetchAll()]);
    }

    // ── GET /api/contractor/me/clients ────────────────────────────────
    // Reads from the unified `assignments` table (any active row where this
    // contractor is the assignee on a client). One client can appear in
    // multiple roles — we DISTINCT on client id and aggregate the roles.
    if ($segs[2] === 'clients' && $method === 'GET') {
        if (!$perms['view_clients']) Json::fail('Not permitted', 403);
        $rows = $pdo->prepare(
            "SELECT c.id, c.name, c.email, c.phone, c.company,
                    GROUP_CONCAT(a.role ORDER BY a.assigned_at SEPARATOR ', ') AS engagement_role,
                    MIN(a.assigned_at) AS added_at
             FROM assignments a
             JOIN clients c ON c.id = a.entity_id
             WHERE a.entity_type = 'client'
               AND a.assignee_type = 'contractor'
               AND a.assignee_id = ?
               AND a.ended_at IS NULL
             GROUP BY c.id, c.name, c.email, c.phone, c.company
             ORDER BY added_at DESC"
        );
        $rows->execute([$cid]);
        Json::send(['clients' => $rows->fetchAll()]);
    }

    // ── GET /api/contractor/me/tasks ──────────────────────────────────
    // Merged feed of everything assigned to the contractor's admin_user:
    // heavy-duty task_items + generic crm_tasks. One shape so the shared
    // frontend tracker can render both.
    if ($segs[2] === 'tasks' && $method === 'GET') {
        if (!$perms['view_tasks']) Json::fail('Not permitted', 403);
        Json::send(['tasks' => my_tasks_for_user($pdo, $uid)]);
    }

    // ── PATCH /api/contractor/me/tasks/crm/:id { status } ─────────────
    if (($segs[2] ?? '') === 'tasks' && ($segs[3] ?? '') === 'crm' && isset($segs[4]) && $method === 'PATCH') {
        if (!$perms['view_tasks']) Json::fail('Not permitted', 403);
        my_tasks_patch_crm_status($pdo, (int)$segs[4], $uid);
    }

    // ── GET /api/contractor/me/commissions ────────────────────────────
    if ($segs[2] === 'commissions' && $method === 'GET') {
        Json::send(my_commissions_for_user($pdo, $uid));
    }

    // ── GET /api/contractor/me/overview ───────────────────────────────
    // Landing-page KPIs — cheap counts across the sections the contractor
    // has access to. Everything permission-gated so denied areas return 0.
    if ($segs[2] === 'overview' && $method === 'GET') {
        Json::send(['overview' => my_overview_for_contractor($pdo, $uid, $cid, $perms)]);
    }

    Json::fail('Not found', 404);
};
