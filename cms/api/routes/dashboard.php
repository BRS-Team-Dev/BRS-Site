<?php
declare(strict_types=1);

use BRS\Auth;
use BRS\Db;
use BRS\Json;

/*
 * Dashboard aggregations.
 *
 *   GET /api/dashboard/crm
 *     Returns headline KPIs + status breakdowns + recent activity for
 *     the CRM dashboard page (`/admin/dashboard`).
 *
 * Designed as one-shot aggregator endpoints so the frontend only does
 * one fetch per dashboard view. Keeps the queries server-side where
 * indexed lookups are cheap.
 */

return function (string $method, array $segs): void {
    Auth::require();
    $pdo = Db::pdo();

    $sub = (string)($segs[1] ?? '');

    if ($sub === 'crm' && $method === 'GET') {
        $periodsPerMonth = function (?string $rd): float {
            return match ($rd) {
                'weekly'    => 52.0 / 12.0,
                'monthly'   => 1.0,
                'quarterly' => 1.0 / 3.0,
                'yearly'    => 1.0 / 12.0,
                default     => 0.0,
            };
        };

        // ── Totals ────────────────────────────────────────────────────────
        $clientCount = (int)$pdo->query('SELECT COUNT(*) FROM clients')->fetchColumn();
        $leadCount   = (int)$pdo->query('SELECT COUNT(*) FROM leads')->fetchColumn();
        $formCount   = (int)$pdo->query("SELECT COUNT(*) FROM forms WHERE form_type = 'standard'")->fetchColumn();
        $onboardingTemplateCount = (int)$pdo->query("SELECT COUNT(*) FROM forms WHERE form_type = 'onboarding'")->fetchColumn();
        // Form submissions live in per-form dynamically-named `form_<slug>` tables,
        // not a single submissions table — so skip the cross-form count here. Each
        // form's individual submission count can still be fetched via /api/forms.

        // ── Lead breakdown by status (matches LeadStatus union on the frontend)
        $leadStatuses = ['new','contacted','qualified','converted','rejected'];
        $stmt = $pdo->query('SELECT status, COUNT(*) c FROM leads GROUP BY status');
        $leadsByStatusRaw = [];
        foreach ($stmt->fetchAll() as $r) $leadsByStatusRaw[(string)$r['status']] = (int)$r['c'];
        $leadsByStatus = [];
        foreach ($leadStatuses as $s) $leadsByStatus[$s] = $leadsByStatusRaw[$s] ?? 0;

        $promoted = $pdo->query('SELECT COUNT(*) FROM leads WHERE promoted_client_id IS NOT NULL')->fetchColumn();
        $promotedCount = (int)$promoted;

        // ── Services (qualified onboarding entries on Services-attached forms)
        $servicesQuery = $pdo->query("
            SELECT oc.qualified_at,
                   f.has_price, f.price, f.payment_type, f.repeat_duration,
                   f.contract_length_months, f.is_indefinite,
                   tp.id   AS project_id,
                   tp.status AS project_status
            FROM onboarding_clients oc
            JOIN forms f ON f.id = oc.form_id
            LEFT JOIN task_projects tp ON tp.onboarding_client_id = oc.id
            WHERE f.sidenav_placement = 'child'
              AND f.sidenav_parent_key = 'services'
              AND oc.qualified_at IS NOT NULL
        ");
        $now = new \DateTimeImmutable();
        $servicesActive = 0;
        $servicesEnded  = 0;
        $mrr = 0.0;
        $totalContractValue = 0.0;
        $hasIndefinite = false;
        $projectStatusCounts = [
            'new' => 0, 'ongoing' => 0, 'testing' => 0, 'blocked' => 0, 'complete' => 0, 'none' => 0,
        ];
        foreach ($servicesQuery->fetchAll() as $r) {
            $hasPrice = (int)($r['has_price'] ?? 0) === 1 && (float)($r['price'] ?? 0) > 0;
            $price    = $hasPrice ? (float)$r['price'] : 0.0;
            $rd       = $r['repeat_duration'];
            $indef    = (int)($r['is_indefinite'] ?? 0) === 1;
            $months   = $r['contract_length_months'] !== null ? (int)$r['contract_length_months'] : null;

            // Determine if service has rolled off (active vs ended)
            $ended = false;
            if (!$indef && $months && $r['payment_type'] === 'recurring' && $r['qualified_at']) {
                $start = new \DateTimeImmutable($r['qualified_at']);
                $end   = $start->modify("+{$months} months");
                if ($now > $end) $ended = true;
            }
            if ($ended) $servicesEnded++; else $servicesActive++;

            // Aggregate revenue
            if ($hasPrice) {
                if ($r['payment_type'] === 'one_off') {
                    $totalContractValue += $price;
                } else {
                    $perMonth = $periodsPerMonth($rd);
                    $monthly  = $price * $perMonth;
                    $mrr     += $monthly;
                    if ($indef || !$months) {
                        $hasIndefinite = true; // total can't be sized
                    } else {
                        $totalContractValue += $monthly * $months;
                    }
                }
            }

            // Project status mix
            $ps = $r['project_status'] ?? null;
            if ($ps && isset($projectStatusCounts[$ps])) $projectStatusCounts[$ps]++;
            else $projectStatusCounts['none']++;
        }

        // ── Recent activity (last 5 of each)
        $recentClients = $pdo->query('
            SELECT id, name, email, company, created_at
            FROM clients ORDER BY id DESC LIMIT 5
        ')->fetchAll();
        $recentLeads = $pdo->query("
            SELECT id, name, email, company, status, created_at
            FROM leads ORDER BY id DESC LIMIT 5
        ")->fetchAll();
        $recentQualifications = $pdo->query("
            SELECT oc.id AS onboarding_client_id,
                   oc.client_name, oc.client_email, oc.qualified_at,
                   f.id AS form_id, f.title AS form_title
            FROM onboarding_clients oc
            JOIN forms f ON f.id = oc.form_id
            WHERE oc.qualified_at IS NOT NULL
            ORDER BY oc.qualified_at DESC LIMIT 5
        ")->fetchAll();

        Json::send([
            'totals' => [
                'clients'              => $clientCount,
                'leads'                => $leadCount,
                'leads_promoted'       => $promotedCount,
                'forms'                => $formCount,
                'onboarding_templates' => $onboardingTemplateCount,
                'services_active'      => $servicesActive,
                'services_ended'       => $servicesEnded,
                'mrr'                  => round($mrr, 2),
                'total_contract_value' => round($totalContractValue, 2),
                'has_indefinite'       => $hasIndefinite,
            ],
            'leads_by_status'        => $leadsByStatus,
            'services_by_status'     => $projectStatusCounts,
            'recent_clients'         => $recentClients,
            'recent_leads'           => $recentLeads,
            'recent_qualifications'  => $recentQualifications,
        ]);
    }

    Json::fail('Not found', 404);
};
