<?php
declare(strict_types=1);

namespace BRS;

use PDO;

/**
 * Cross-route helpers for the multi-audience contracts system (migration 076).
 *
 * Lives under lib/ because both routes/hr.php (the contract-template CRUD)
 * and the entity create handlers (routes/clients.php, partners.php,
 * affiliates.php, contractors.php) need to call into it — and the API
 * router only requires one route file per request, so a procedural helper
 * defined in hr.php would be invisible to the others.
 *
 * Pattern to follow for any future polymorphic sub-table (one master
 * template, fan-out per audience): put the audience → table / owner-col
 * mapping in one place and have callers go through it. Audience strings
 * are validated by callers (pickEnum) before being passed in here, so the
 * un-escaped table names below are safe — but never accept them from
 * untrusted input without re-validating.
 */
final class Contracts {
    // Audiences a contract template can target. Entity-backed ones fan out to
    // a *_documents table (see docsTable); 'supplier'/'investor' are
    // forward-looking labels with no entity yet (no table → distribute is a
    // no-op until their system is built).
    public const AUDIENCES = [
        'employee', 'client', 'lead', 'partner', 'affiliate',
        'contractor', 'candidate', 'applicant', 'supplier', 'investor',
    ];

    /** Docs table for a given audience. Defaults to hr_documents. */
    public static function docsTable(string $audience): string {
        switch ($audience) {
            case 'client':     return 'client_documents';
            case 'lead':       return 'lead_documents';
            case 'partner':    return 'partner_documents';
            case 'affiliate':  return 'affiliate_documents';
            case 'contractor': return 'contractor_documents';
            case 'candidate':  return 'candidate_documents';
            case 'applicant':  return 'applicant_documents';
            case 'employee':
            default:           return 'hr_documents';
        }
    }

    /** Owner FK column name for the docs table of a given audience. */
    public static function ownerColumn(string $audience): string {
        switch ($audience) {
            case 'client':     return 'client_id';
            case 'lead':       return 'lead_id';
            case 'partner':    return 'partner_id';
            case 'affiliate':  return 'affiliate_id';
            case 'contractor': return 'contractor_id';
            case 'candidate':  return 'candidate_id';
            case 'applicant':  return 'candidate_id';
            case 'employee':
            default:           return 'employee_id';
        }
    }

    /**
     * Fan a freshly-created contract / signed-document template out to every
     * active record in the target audience, as a pending row.
     * Signed flow on non-employees is admin-side for now.
     */
    public static function distributeTemplate(
        PDO|\BRS\TenantPdo $pdo, int $typeId, string $name,
        string $templatePath, ?string $templateMime, ?int $templateSize,
        string $kind, string $audience
    ): int {
        $category = ($kind === 'contract') ? 'contract' : 'signed';

        switch ($audience) {
            case 'employee':
                $rows = $pdo->query("SELECT id FROM hr_employees WHERE status IN ('onboarding','active','on_leave')")->fetchAll();
                break;
            case 'client':
                $rows = $pdo->query("SELECT id FROM clients")->fetchAll();
                break;
            case 'partner':
                $rows = $pdo->query("SELECT id FROM partners WHERE status IN ('prospective','active','paused')")->fetchAll();
                break;
            case 'affiliate':
                $rows = $pdo->query("SELECT id FROM affiliates WHERE status IN ('pending','active','paused')")->fetchAll();
                break;
            case 'contractor':
                $rows = $pdo->query("SELECT id FROM contractors WHERE status IN ('active','on_break')")->fetchAll();
                break;
            case 'candidate':
                // Every candidate still in play (exclude only rejected-by-us).
                $rows = $pdo->query("SELECT id FROM recruitment_candidates WHERE status <> 'rejected_by_us'")->fetchAll();
                break;
            case 'lead':
                $rows = $pdo->query("SELECT id FROM leads WHERE status <> 'rejected'")->fetchAll();
                break;
            case 'applicant':
                // hr_candidates has no status column — it's a flat applicant pool.
                $rows = $pdo->query("SELECT id FROM hr_candidates")->fetchAll();
                break;
            default:
                // Forward-looking audiences (supplier / investor) have no entity
                // table yet — nothing to fan out to.
                return 0;
        }
        if (!$rows) return 0;

        $table = self::docsTable($audience);
        $owner = self::ownerColumn($audience);
        $ins = $pdo->prepare(
            "INSERT INTO `$table`
             (`$owner`, doc_type_id, category, title, file_path, file_size, mime_type, requires_signature, uploaded_by)
             VALUES (?,?,?,?,?,?,?,1,NULL)"
        );
        $n = 0;
        foreach ($rows as $r) {
            $ins->execute([(int)$r['id'], $typeId, $category, $name, $templatePath, $templateSize, $templateMime]);
            $n++;
        }
        return $n;
    }

    /**
     * When a new entity (client / partner / etc.) is created, replay every
     * audience-matched template so the new record sees the same pending
     * docs as the rest of the cohort.
     */
    public static function fanOutToNewEntity(PDO|\BRS\TenantPdo $pdo, string $audience, int $ownerId): int {
        $tpls = $pdo->prepare(
            "SELECT id, name, kind, template_path, template_mime, template_size
             FROM hr_document_types
             WHERE kind IN ('signed','contract')
               AND audience = ?
               AND template_path IS NOT NULL"
        );
        $tpls->execute([$audience]);
        $rows = $tpls->fetchAll();
        if (!$rows) return 0;

        $table = self::docsTable($audience);
        $owner = self::ownerColumn($audience);
        $ins = $pdo->prepare(
            "INSERT INTO `$table`
             (`$owner`, doc_type_id, category, title, file_path, file_size, mime_type, requires_signature, uploaded_by)
             VALUES (?,?,?,?,?,?,?,1,NULL)"
        );
        $n = 0;
        foreach ($rows as $t) {
            $cat = ($t['kind'] === 'contract') ? 'contract' : 'signed';
            $ins->execute([
                $ownerId, (int)$t['id'], $cat, $t['name'],
                $t['template_path'],
                $t['template_size'] !== null ? (int)$t['template_size'] : null,
                $t['template_mime'],
            ]);
            $n++;
        }
        return $n;
    }
}
