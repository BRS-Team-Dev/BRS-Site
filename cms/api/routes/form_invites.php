<?php
declare(strict_types=1);

use BRS\Auth;
use BRS\Db;
use BRS\Json;
use BRS\Tenant;

/*
 * Form invitations — unified across standard forms and multipart
 * onboarding. Reuses the existing `onboarding_clients` table (which
 * already has client_token + parent_client_id, and now parent_lead_id
 * via migration 139) so the invite pattern is the single tested mechanism
 * for "send this specific person a form to fill out".
 *
 *   GET  /api/forms/:id/invites               list invites for a form
 *   POST /api/forms/:id/invites               create an invite
 *        body: {
 *          parent_client_id?: number,
 *          parent_lead_id?:   number,
 *          client_email?:     string,   (required if no parent id)
 *          client_name?:      string,
 *        }
 *   DELETE /api/forms/:id/invites/:inviteId    revoke an invite
 *
 * URL for the recipient is returned by both GET + POST:
 *   Standard form:   {base}/forms/{slug}?token={token}
 *   Multipart form:  {base}/onboarding/{formId}/{token}  (existing shape)
 *
 * The submission flow reads the token, resolves parent_client_id +
 * parent_lead_id + service_offering_id, and writes form_submission_links.
 */

return function (string $method, array $segs): void {
    Auth::require();
    $pdo = Db::pdo();

    // /api/forms/:id/invites[/:inviteId]
    if (($segs[0] ?? '') !== 'forms' || ($segs[2] ?? '') !== 'invites') {
        Json::fail('Not found', 404);
    }
    $formId = (int)($segs[1] ?? 0);
    if ($formId <= 0) Json::fail('Invalid form id', 400);

    $f = $pdo->prepare('SELECT id, slug, form_type, title FROM forms WHERE id = ? AND tenant_id = ?');
    $f->execute([$formId, Tenant::id()]);
    $form = $f->fetch();
    if (!$form) Json::fail('Form not found', 404);

    $base = rtrim($GLOBALS['BRS_CONFIG']['base_url'] ?? '', '/');
    $urlFor = function (string $token) use ($form, $base): string {
        if ($form['form_type'] === 'onboarding') {
            return "{$base}/onboarding/{$form['id']}/{$token}";
        }
        return "{$base}/forms/{$form['slug']}?token={$token}";
    };

    // ── /:inviteId  DELETE ──────────────────────────────────
    if (isset($segs[3]) && $method === 'DELETE') {
        $inviteId = (int)$segs[3];
        $pdo->prepare(
            'DELETE FROM onboarding_clients
              WHERE id = ? AND form_id = ? AND tenant_id = ?'
        )->execute([$inviteId, $formId, Tenant::id()]);
        Json::send(['ok' => true]);
    }

    // ── list ─────────────────────────────────────────────────
    if ($method === 'GET') {
        $rows = $pdo->prepare(
            'SELECT oc.id, oc.client_email, oc.client_name, oc.client_token,
                    oc.parent_client_id, oc.parent_lead_id,
                    oc.started_at, oc.submitted_at, oc.submission_id,
                    c.name AS client_name_resolved,
                    l.name AS lead_name_resolved
               FROM onboarding_clients oc
               LEFT JOIN clients c ON c.id = oc.parent_client_id
               LEFT JOIN leads   l ON l.id = oc.parent_lead_id
              WHERE oc.form_id = ? AND oc.tenant_id = ?
              ORDER BY oc.started_at DESC'
        );
        $rows->execute([$formId, Tenant::id()]);
        $invites = [];
        foreach ($rows->fetchAll() as $r) {
            $invites[] = [
                'id'            => (int)$r['id'],
                'client_email'  => $r['client_email'],
                'client_name'   => $r['client_name'],
                'parent_client_id' => $r['parent_client_id'] !== null ? (int)$r['parent_client_id'] : null,
                'parent_lead_id'   => $r['parent_lead_id']   !== null ? (int)$r['parent_lead_id']   : null,
                'client_name_resolved' => $r['client_name_resolved'],
                'lead_name_resolved'   => $r['lead_name_resolved'],
                'token'         => $r['client_token'],
                'url'           => $urlFor($r['client_token']),
                'started_at'    => $r['started_at'],
                'submitted_at'  => $r['submitted_at'],
                'status'        => $r['submitted_at'] ? 'submitted' : 'pending',
            ];
        }
        Json::send(['invites' => $invites]);
    }

    // ── create ───────────────────────────────────────────────
    if ($method === 'POST') {
        $body = Json::readBody();
        $parentClientId = !empty($body['parent_client_id']) ? (int)$body['parent_client_id'] : null;
        $parentLeadId   = !empty($body['parent_lead_id'])   ? (int)$body['parent_lead_id']   : null;

        // Derive email/name from the linked record when possible so
        // the caller doesn't need to repeat what we already have.
        $email = trim((string)($body['client_email'] ?? ''));
        $name  = trim((string)($body['client_name'] ?? ''));

        if ($parentClientId !== null && ($email === '' || $name === '')) {
            $pc = $pdo->prepare('SELECT name, email FROM clients WHERE id = ? AND tenant_id = ?');
            $pc->execute([$parentClientId, Tenant::id()]);
            $parent = $pc->fetch();
            if (!$parent) Json::fail('Parent client not found', 400);
            if ($email === '') $email = (string)($parent['email'] ?? '');
            if ($name  === '') $name  = (string)($parent['name']  ?? '');
        }
        if ($parentLeadId !== null && ($email === '' || $name === '')) {
            $pl = $pdo->prepare('SELECT name, email FROM leads WHERE id = ? AND tenant_id = ?');
            $pl->execute([$parentLeadId, Tenant::id()]);
            $parent = $pl->fetch();
            if (!$parent) Json::fail('Parent lead not found', 400);
            if ($email === '') $email = (string)($parent['email'] ?? '');
            if ($name  === '') $name  = (string)($parent['name']  ?? '');
        }
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            Json::fail('Valid client email required', 400);
        }

        $token = bin2hex(random_bytes(32));
        $pdo->prepare(
            'INSERT INTO onboarding_clients
                (tenant_id, form_id, parent_client_id, parent_lead_id, client_email, client_name, client_token)
             VALUES (?, ?, ?, ?, ?, ?, ?)'
        )->execute([Tenant::id(), $formId, $parentClientId, $parentLeadId, $email, $name ?: null, $token]);
        $inviteId = (int)$pdo->lastInsertId();

        Json::send([
            'id'    => $inviteId,
            'token' => $token,
            'url'   => $urlFor($token),
        ], 201);
    }

    Json::fail('Method not allowed', 405);
};
