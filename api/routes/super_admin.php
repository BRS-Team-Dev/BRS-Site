<?php
declare(strict_types=1);

use BRS\Auth;
use BRS\Db;
use BRS\Json;
use BRS\Tenant;
use BRS\Tenants;

/*
 * Super-admin endpoints — cross-tenant operations only available to
 * accounts whose email is registered in the `super_admins` registry
 * table.
 *
 *   GET    /api/super-admin/tenants                   list every tenant
 *   POST   /api/super-admin/tenants/:id/suspend       kill-set on
 *   POST   /api/super-admin/tenants/:id/activate      kill-set off
 *   GET    /api/super-admin/audit?limit=…             super_action_log feed
 *
 * Every mutation writes a super_action_log row for the compliance
 * trail. The kill-set is invalidated synchronously so suspension is
 * effective on the next request across any PHP-FPM worker.
 */

return function (string $method, array $segs): void {
    Auth::require();
    if (!Tenant::isSuper()) Json::fail('Forbidden', 403);

    $resource = $segs[1] ?? '';

    if ($resource === 'tenants') {
        $tid = isset($segs[2]) ? (int)$segs[2] : null;

        // GET /api/super-admin/tenants — list all
        if ($tid === null && $method === 'GET') {
            // @global-scope: registry-wide read; super-admin sees everything
            $pdo = Db::pdo();
            $rows = $pdo->query(
                'SELECT id, slug, brand_name, status, created_at, deleted_at
                   FROM tenants ORDER BY id'
            )->fetchAll();
            Json::send(['tenants' => $rows]);
        }

        // Mutations require a tenant id
        if ($tid !== null && $method === 'POST') {
            $action = $segs[3] ?? '';
            $row = Tenants::get($tid);
            if (!$row) Json::fail('Tenant not found', 404);

            if ($action === 'suspend') {
                Tenants::suspendTenant($tid);
                Tenants::logSuperAction(
                    (string)(Tenant::email() ?? ''),
                    'suspend',
                    $tid,
                    Tenant::id(),
                    null
                );
                Json::send(['ok' => true, 'tenant_id' => $tid, 'status' => 'suspended']);
            }
            if ($action === 'activate') {
                Tenants::activateTenant($tid);
                Tenants::logSuperAction(
                    (string)(Tenant::email() ?? ''),
                    'activate',
                    $tid,
                    Tenant::id(),
                    null
                );
                Json::send(['ok' => true, 'tenant_id' => $tid, 'status' => 'active']);
            }
            if ($action === 'soft-delete') {
                Tenants::softDeleteTenant($tid);
                Tenants::logSuperAction(
                    (string)(Tenant::email() ?? ''),
                    'soft-delete',
                    $tid,
                    Tenant::id(),
                    null
                );
                Json::send(['ok' => true, 'tenant_id' => $tid, 'status' => 'deleted']);
            }
            Json::fail('Unknown action', 400);
        }

        Json::fail('Method not allowed', 405);
    }

    // GET /api/super-admin/audit — latest super-admin actions
    if ($resource === 'audit' && $method === 'GET') {
        $limit = max(1, min((int)($_GET['limit'] ?? 100), 500));
        // @global-scope: registry audit log — cross-tenant by design
        $stmt = Db::pdo()->prepare(
            'SELECT id, super_email, action, target_tenant, from_tenant,
                    ip, created_at, detail
               FROM super_action_log
              ORDER BY id DESC
              LIMIT ?'
        );
        $stmt->bindValue(1, $limit, PDO::PARAM_INT);
        $stmt->execute();
        Json::send(['entries' => $stmt->fetchAll()]);
    }

    Json::fail('Not found', 404);
};
