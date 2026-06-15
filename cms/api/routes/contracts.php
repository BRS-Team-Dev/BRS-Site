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
    $pdo = Db::pdo();

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
        $stmt = $pdo->prepare(
            "SELECT d.id, d.doc_type_id, d.category, d.title, d.file_path, d.mime_type,
                    d.requires_signature, d.signed_at, d.uploaded_at,
                    COALESCE(t.is_required, 0) AS is_required,
                    t.name AS type_name
             FROM `$table` d
             LEFT JOIN hr_document_types t ON t.id = d.doc_type_id
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
