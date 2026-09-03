<?php
declare(strict_types=1);

use BRS\Auth;
use BRS\Db;
use BRS\Json;
use BRS\Contracts;

/*
 * Per-entity contract documents — the Contracts tab shown on each entity's
 * detail page (client / lead / partner / affiliate / contractor / candidate /
 * applicant / employee). Backed by the audience's `*_documents` table; the
 * "required" status is read live from the linked `hr_document_types` row, so
 * ticking "Mandatory for every <class>" on a template is reflected here.
 *
 *   GET  /api/contracts/:audience/:id                 → { documents, summary }
 *   POST /api/contracts/:audience/:id/:docId/sign     → mark signed (admin-side)
 *   POST /api/contracts/:audience/:id/:docId/unsign   → clear signed
 *
 * Audiences with no entity table (supplier / investor) are rejected.
 */

return function (string $method, array $segs): void {
    $claims = Auth::require();
    $pdo = Db::tpdo();

    $audience = (string)($segs[1] ?? '');
    // Only audiences with a real entity table are addressable here.
    $hasTable = ['employee','client','lead','partner','affiliate','contractor','candidate','applicant'];
    if (!in_array($audience, $hasTable, true)) Json::fail('Unknown audience', 404);

    $entityId = (int)($segs[2] ?? 0);
    if ($entityId <= 0) Json::fail('Invalid id', 400);

    $table = Contracts::docsTable($audience);
    $owner = Contracts::ownerColumn($audience);

    // GET /api/contracts/:audience/:id — list this entity's contracts + summary.
    if (!isset($segs[3]) && $method === 'GET') {
        // For clients, the service link (migration 145) is surfaced so
        // the Services tab can render a "contract attached" chip per row.
        $svcCols = $audience === 'client'
            ? ', d.client_service_offering_id, cso.name AS service_name'
            : ', NULL AS client_service_offering_id, NULL AS service_name';
        $svcJoin = $audience === 'client'
            ? 'LEFT JOIN client_service_offerings cso ON cso.id = d.client_service_offering_id'
            : '';
        $stmt = $pdo->prepare(
            "SELECT d.id, d.doc_type_id, d.category, d.title, d.file_path, d.mime_type,
                    d.requires_signature, d.signed_at, d.uploaded_at,
                    COALESCE(t.is_required, 0) AS is_required,
                    t.name AS type_name $svcCols
             FROM `$table` d
             LEFT JOIN hr_document_types t ON t.id = d.doc_type_id
             $svcJoin
             WHERE d.`$owner` = ? AND d.category IN ('contract','signed')
             ORDER BY COALESCE(t.is_required,0) DESC, d.id"
        );
        $stmt->execute([$entityId]);
        $rows = $stmt->fetchAll();

        $required = 0; $requiredSigned = 0; $signed = 0;
        foreach ($rows as &$r) {
            $r['is_required']        = (int)$r['is_required'];
            $r['requires_signature'] = (int)$r['requires_signature'];
            $isSigned = $r['signed_at'] !== null;
            if ($isSigned) $signed++;
            if ($r['is_required'] === 1) {
                $required++;
                if ($isSigned) $requiredSigned++;
            }
        }
        unset($r);

        Json::send([
            'documents' => $rows,
            'summary'   => [
                'total'           => count($rows),
                'signed'          => $signed,
                'required'        => $required,
                'required_signed' => $requiredSigned,
                'required_outstanding' => $required - $requiredSigned,
            ],
        ]);
    }

    // GET /api/contracts/:audience/:id/templates — list templates
    // (hr_document_types) that can be attached to this entity. Any
    // contract/signed-kind template shows up; the audience column is
    // intentionally ignored because tenants often keep a single generic
    // template pool rather than one-per-audience. Templates flagged
    // for the current audience sort first for quick pick.
    if (($segs[3] ?? '') === 'templates' && $method === 'GET') {
        $tstmt = $pdo->prepare(
            "SELECT id, name, description, kind, audience, contract_type_id, template_path,
                    template_mime, is_required,
                    CASE WHEN audience = ? THEN 1 ELSE 0 END AS audience_match
               FROM hr_document_types
              WHERE kind IN ('contract','signed')
              ORDER BY audience_match DESC, is_required DESC, sort_order, name"
        );
        $tstmt->execute([$audience]);
        Json::send(['templates' => $tstmt->fetchAll()]);
    }

    // POST /api/contracts/:audience/:id/attach — clone one hr_document_types
    // template into this entity's docs table. Body: { doc_type_id, client_service_offering_id? }
    // Reuses the template's file_path as the new row's file_path — admin
    // can upload a filled / signed copy later via the standard docs UI.
    if (($segs[3] ?? '') === 'attach' && $method === 'POST') {
        $body = Json::readBody();
        $typeId = (int)($body['doc_type_id'] ?? 0);
        if ($typeId <= 0) Json::fail('doc_type_id required', 400);

        $t = $pdo->prepare(
            'SELECT id, name, kind, template_path, template_mime, audience
               FROM hr_document_types WHERE id = ?'
        );
        $t->execute([$typeId]);
        $tpl = $t->fetch();
        if (!$tpl) Json::fail('Template not found', 404);
        // No audience match check — tenants often keep a shared template
        // pool. The attach still writes a client_documents / employee_documents
        // row for THIS audience, so the on-disk model stays consistent.

        // Service link is client-only. Silently ignored for other
        // audiences so a bad payload isn't disruptive.
        $csoId = null;
        if ($audience === 'client' && isset($body['client_service_offering_id'])
            && $body['client_service_offering_id'] !== null && $body['client_service_offering_id'] !== '') {
            $csoId = (int)$body['client_service_offering_id'];
            // Guard: the CSO must belong to this client.
            $chk = $pdo->prepare('SELECT 1 FROM client_service_offerings WHERE id = ? AND client_id = ?');
            $chk->execute([$csoId, $entityId]);
            if (!$chk->fetchColumn()) Json::fail('Service does not belong to this client', 400);
        }

        // For the client audience the docs table has an extra column
        // (client_service_offering_id). Split the two INSERT shapes so
        // we don't add the column to every audience's INSERT.
        $filePath = (string)($tpl['template_path'] ?? '');
        if ($filePath === '') Json::fail('Template has no file — cannot attach', 400);
        $mime = (string)($tpl['template_mime'] ?? 'application/octet-stream');
        $title = (string)$tpl['name'];

        if ($audience === 'client') {
            $ins = $pdo->prepare(
                "INSERT INTO `$table` (`$owner`, client_service_offering_id, doc_type_id,
                                       category, title, file_path, mime_type,
                                       requires_signature, uploaded_by)
                 VALUES (?, ?, ?, 'contract', ?, ?, ?, 1, ?)"
            );
            $ins->execute([$entityId, $csoId, $typeId, $title, $filePath, $mime, (int)($claims['sub'] ?? 0) ?: null]);
        } else {
            $ins = $pdo->prepare(
                "INSERT INTO `$table` (`$owner`, doc_type_id, category, title,
                                       file_path, mime_type, requires_signature, uploaded_by)
                 VALUES (?, ?, 'contract', ?, ?, ?, 1, ?)"
            );
            $ins->execute([$entityId, $typeId, $title, $filePath, $mime, (int)($claims['sub'] ?? 0) ?: null]);
        }
        Json::send(['ok' => true, 'id' => (int)$pdo->lastInsertId()], 201);
    }

    // PUT /api/contracts/client/:id/:docId/service — rewire an existing
    // contract to a different client_service_offering_id (or null to
    // detach). Client-only since only client_documents has the column.
    if ($audience === 'client' && isset($segs[3]) && ($segs[4] ?? '') === 'service' && $method === 'PUT') {
        $docId = (int)$segs[3];
        if ($docId <= 0) Json::fail('Invalid document id', 400);
        $body  = Json::readBody();
        $csoId = null;
        if (isset($body['client_service_offering_id']) && $body['client_service_offering_id'] !== null && $body['client_service_offering_id'] !== '') {
            $csoId = (int)$body['client_service_offering_id'];
            $chk = $pdo->prepare('SELECT 1 FROM client_service_offerings WHERE id = ? AND client_id = ?');
            $chk->execute([$csoId, $entityId]);
            if (!$chk->fetchColumn()) Json::fail('Service does not belong to this client', 400);
        }
        $upd = $pdo->prepare('UPDATE client_documents SET client_service_offering_id = ? WHERE id = ? AND client_id = ?');
        $upd->execute([$csoId, $docId, $entityId]);
        Json::send(['ok' => true]);
    }

    // POST /api/contracts/:audience/:id/:docId/(sign|unsign)
    if (isset($segs[3]) && isset($segs[4]) && $method === 'POST') {
        $docId  = (int)$segs[3];
        $action = (string)$segs[4];
        if ($docId <= 0) Json::fail('Invalid document id', 400);

        // Confirm the doc belongs to this entity.
        $chk = $pdo->prepare("SELECT id FROM `$table` WHERE id = ? AND `$owner` = ?");
        $chk->execute([$docId, $entityId]);
        if (!$chk->fetchColumn()) Json::fail('Document not found', 404);

        if ($action === 'sign') {
            $uid = (int)($claims['sub'] ?? 0) ?: null;
            $pdo->prepare("UPDATE `$table` SET signed_at = NOW(), signed_by = ? WHERE id = ?")
                ->execute([$uid, $docId]);
            Json::send(['ok' => true]);
        }
        if ($action === 'unsign') {
            $pdo->prepare("UPDATE `$table` SET signed_at = NULL, signed_by = NULL WHERE id = ?")
                ->execute([$docId]);
            Json::send(['ok' => true]);
        }
        Json::fail('Unknown action', 404);
    }

    Json::fail('Method not allowed', 405);
};
