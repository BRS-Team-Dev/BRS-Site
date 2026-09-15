<?php
declare(strict_types=1);

use BRS\Auth;
use BRS\Db;
use BRS\Json;
use BRS\StripeClient;
use BRS\Tenant;

/*
 * Subscription billing for the tenant.
 *
 *   GET  /api/billing                            summary — profile + default payment + recent invoices
 *   PUT  /api/billing/profile                    { billing_email, billing_address, vat_number }
 *
 *   GET  /api/billing/payment-methods            list saved payment methods
 *   POST /api/billing/payment-methods            add — { type, brand, last4, holder_name, expires_month, expires_year, is_default? }
 *   PUT  /api/billing/payment-methods/:id        edit — same shape
 *   POST /api/billing/payment-methods/:id/default  make default (clears default on others)
 *   DELETE /api/billing/payment-methods/:id      remove
 *
 *   GET  /api/billing/invoices                   list subscription_invoices for the tenant
 *
 * NOTE: payment_methods stores CARD METADATA ONLY (last4, brand, expiry).
 * No PAN, no CVC, no full card number is ever accepted. Real PCI-scoped
 * capture happens through Stripe Elements / SetupIntent, which returns
 * a `pm_…` token stored in `external_id` — the fields we do store here
 * are safe to persist per Level-2 PCI SAQ-A.
 */

return function (string $method, array $segs): void {
    Auth::require();
    $pdo = Db::tpdo();

    $seg1 = $segs[1] ?? '';

    // ── /api/billing (summary) ───────────────────────────────────
    if ($seg1 === '' && $method === 'GET') {
        $tenant = Db::pdo()->prepare(
            'SELECT id, brand_name, subscription_tier, billing_email, billing_address, vat_number,
                    pending_tier, pending_cadence, pending_effective_at
               FROM tenants WHERE id = ?'
        );
        $tenant->execute([Tenant::id()]);
        $profile = $tenant->fetch() ?: [];

        $pmStmt = $pdo->query('SELECT * FROM payment_methods ORDER BY is_default DESC, id DESC');
        $methods = $pmStmt->fetchAll();

        $invStmt = $pdo->query(
            'SELECT id, invoice_number, description, amount_cents, currency, status,
                    issued_at, due_at, paid_at, pdf_url, created_at
               FROM subscription_invoices
              ORDER BY COALESCE(issued_at, created_at) DESC, id DESC
              LIMIT 24'
        );
        $invoices = $invStmt->fetchAll();

        Json::send([
            'profile'         => $profile,
            'payment_methods' => $methods,
            'invoices'        => $invoices,
        ]);
    }

    // ── /api/billing/profile ─────────────────────────────────────
    if ($seg1 === 'profile' && $method === 'PUT') {
        $b = Json::readBody();
        $email = trim((string)($b['billing_email'] ?? ''));
        if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) Json::fail('Invalid billing email', 400);
        Db::pdo()->prepare(
            'UPDATE tenants SET billing_email = ?, billing_address = ?, vat_number = ? WHERE id = ?'
        )->execute([
            $email !== '' ? $email : null,
            trim((string)($b['billing_address'] ?? '')) ?: null,
            trim((string)($b['vat_number'] ?? '')) ?: null,
            Tenant::id(),
        ]);
        Json::send(['ok' => true]);
    }

    // ── /api/billing/payment-methods[/:id[/default]] ─────────────
    if ($seg1 === 'payment-methods') {
        $id = isset($segs[2]) ? (int)$segs[2] : 0;

        if ($id === 0) {
            if ($method === 'GET') {
                $rows = $pdo->query('SELECT * FROM payment_methods ORDER BY is_default DESC, id DESC')->fetchAll();
                Json::send(['payment_methods' => $rows]);
            }
            if ($method === 'POST') {
                $newId = _brs_upsert_pm($pdo, null, Json::readBody());
                Json::send(['id' => $newId], 201);
            }
            Json::fail('Method not allowed', 405);
        }

        // /:id  — read, edit, delete
        $sel = $pdo->prepare('SELECT * FROM payment_methods WHERE id = ?');
        $sel->execute([$id]);
        $row = $sel->fetch();
        if (!$row) Json::fail('Payment method not found', 404);

        if (($segs[3] ?? '') === 'default' && $method === 'POST') {
            $pdo->beginTransaction();
            try {
                $pdo->prepare('UPDATE payment_methods SET is_default = 0')->execute();
                $pdo->prepare('UPDATE payment_methods SET is_default = 1 WHERE id = ?')->execute([$id]);
                $pdo->commit();
            } catch (\Throwable $e) { $pdo->rollBack(); throw $e; }
            Json::send(['ok' => true]);
        }

        if ($method === 'GET')    Json::send(['payment_method' => $row]);
        if ($method === 'PUT')  { _brs_upsert_pm($pdo, $id, Json::readBody()); Json::send(['ok' => true]); }
        if ($method === 'DELETE'){ $pdo->prepare('DELETE FROM payment_methods WHERE id = ?')->execute([$id]); Json::send(['ok' => true]); }
        Json::fail('Method not allowed', 405);
    }

    // ── /api/billing/stripe/* ────────────────────────────────────
    // Stripe integration. All endpoints require Stripe to be configured
    // in .env; otherwise the frontend degrades to the manual card form.
    if ($seg1 === 'stripe') {
        $sub = $segs[2] ?? '';

        // Config for the frontend (publishable key, price ids, current
        // customer id). Callable regardless of whether Stripe is
        // configured — the frontend uses this to decide which UI to show.
        if ($sub === 'config' && $method === 'GET') {
            $tCfg = Db::pdo()->prepare(
                'SELECT stripe_customer_id, stripe_subscription_id, stripe_status,
                        stripe_current_period_end, stripe_default_pm_id
                   FROM tenants WHERE id = ?'
            );
            $tCfg->execute([Tenant::id()]);
            $tRow = $tCfg->fetch() ?: [];
            Json::send([
                'configured'      => StripeClient::isConfigured(),
                'publishable_key' => StripeClient::publishableKey(),
                'price_ids'       => $GLOBALS['BRS_CONFIG']['stripe']['price_ids'] ?? [],
                'tenant'          => $tRow,
            ]);
        }

        if (!StripeClient::isConfigured()) Json::fail('Stripe not configured', 400);

        $sdk = StripeClient::client();
        $customerId = StripeClient::getOrCreateCustomer(Tenant::id());

        // SetupIntent for saving a payment method (card, BACS, SEPA, etc.).
        //   POST { payment_method_types: ['card'|'bacs_debit'|'sepa_debit'] }
        // Returns { client_secret } which the frontend passes to Stripe.js.
        if ($sub === 'setup-intent' && $method === 'POST') {
            $b = Json::readBody();
            $types = is_array($b['payment_method_types'] ?? null) ? $b['payment_method_types'] : ['card'];
            $intent = $sdk->setupIntents->create([
                'customer'             => $customerId,
                'payment_method_types' => $types,
                'usage'                => 'off_session',
                'metadata'             => ['tenant_id' => (string)Tenant::id()],
            ]);
            Json::send([
                'client_secret' => $intent->client_secret,
                'setup_intent_id' => $intent->id,
                'customer_id'   => $customerId,
            ]);
        }

        // After the frontend confirms the SetupIntent, sync the resulting
        // PaymentMethod into our local table so the list refreshes without
        // waiting for the webhook.
        //   POST { payment_method_id: 'pm_...', make_default: true }
        if ($sub === 'sync-payment-method' && $method === 'POST') {
            $b = Json::readBody();
            $pmId = trim((string)($b['payment_method_id'] ?? ''));
            if ($pmId === '') Json::fail('payment_method_id required', 400);

            $pm = $sdk->paymentMethods->retrieve($pmId, []);
            StripeClient::upsertPaymentMethod(Tenant::id(), $pm);

            if (!empty($b['make_default'])) {
                $sdk->customers->update($customerId, [
                    'invoice_settings' => ['default_payment_method' => $pmId],
                ]);
                Db::pdo()->prepare(
                    'UPDATE tenants SET stripe_default_pm_id = ? WHERE id = ?'
                )->execute([$pmId, Tenant::id()]);
                // Mirror onto our local column too so the UI's "Default"
                // pill flips immediately without another round-trip.
                $ourId = Db::pdo()->prepare(
                    'SELECT id FROM payment_methods WHERE tenant_id = ? AND external_id = ?'
                );
                $ourId->execute([Tenant::id(), $pmId]);
                $row = $ourId->fetch();
                if ($row) {
                    Db::pdo()->prepare('UPDATE payment_methods SET is_default = 0 WHERE tenant_id = ?')
                        ->execute([Tenant::id()]);
                    Db::pdo()->prepare('UPDATE payment_methods SET is_default = 1 WHERE id = ?')
                        ->execute([(int)$row['id']]);
                }
            }
            Json::send(['ok' => true]);
        }

        // Subscribe / change plan.
        //   POST { tier: 'starter'|'growth'|..., cadence: 'monthly'|'yearly' }
        //
        // Guards, in order:
        //   1. Contact-sales tiers refused
        //   2. Downgrade-cap check (active users must fit new plan)
        //   3. Rate limit (max 3 changes / 30d)
        //   4. Direction detection - upgrades charge delta immediately;
        //      downgrades scheduled to period end via subscription_schedules
        // Every accepted change writes to plan_change_log for the audit
        // trail + rate-limit counter.
        if ($sub === 'subscribe' && $method === 'POST') {
            $b = Json::readBody();
            $tier = (string)($b['tier'] ?? '');
            $cadence = ($b['cadence'] ?? 'monthly') === 'yearly' ? 'yearly' : 'monthly';

            // (1) Look up new plan
            $planStmt = Db::pdo()->prepare(
                'SELECT stripe_price_monthly, stripe_price_yearly, is_contact_sales, max_users,
                        price_monthly_cents, price_yearly_cents
                   FROM subscription_plans WHERE tier = ? AND is_active = 1'
            );
            $planStmt->execute([$tier]);
            $plan = $planStmt->fetch();
            if ($plan && ($plan['is_contact_sales'] ?? 0)) {
                Json::fail("Enterprise tier is contact-sales only. Reach out to us to configure.", 400);
            }
            $price = $plan
                ? ($cadence === 'yearly' ? $plan['stripe_price_yearly'] : $plan['stripe_price_monthly'])
                : null;
            if (!$price) $price = StripeClient::priceIdForTier($tier); // env fallback
            if (!$price) Json::fail("No Stripe Price id configured for tier '{$tier}' / {$cadence}", 400);

            // (2) Downgrade cap check - block if current active_users
            // exceed the target plan's cap. Prevents "load Scale with
            // 25 users, downgrade to Growth to keep them cheap".
            if ($plan && $plan['max_users'] !== null) {
                $active = (int)Db::tpdo()->query(
                    'SELECT COUNT(*) FROM admin_users
                      WHERE is_active = 1 AND deleted_at IS NULL'
                )->fetchColumn();
                if ($active > (int)$plan['max_users']) {
                    Json::fail(sprintf(
                        'You have %d active users but this plan allows %d. Deactivate %d user(s) first, then change plan.',
                        $active, (int)$plan['max_users'], $active - (int)$plan['max_users']
                    ), 402);
                }
            }

            // (3) Rate limit - 3 plan changes per rolling 30 days.
            // Prevents cycling tiers to exploit proration edge cases
            // or confuse invoicing. Counts anything except 'initial'.
            $rl = Db::pdo()->prepare(
                'SELECT COUNT(*) FROM plan_change_log
                  WHERE tenant_id = ?
                    AND direction <> "initial"
                    AND created_at >= (NOW() - INTERVAL 30 DAY)'
            );
            $rl->execute([Tenant::id()]);
            $recentCount = (int)$rl->fetchColumn();
            if ($recentCount >= 3) {
                Json::fail(
                    'Plan-change limit reached (3 per 30 days). Contact support if this is unexpected.',
                    429
                );
            }

            // (4) Direction detection - fetch current tier + plan for
            // comparison. Same-tier requests are no-ops.
            $curStmt = Db::pdo()->prepare(
                'SELECT t.subscription_tier AS tier,
                        p.price_monthly_cents AS cur_month,
                        p.price_yearly_cents  AS cur_year
                   FROM tenants t
                   LEFT JOIN subscription_plans p ON p.tier = t.subscription_tier
                  WHERE t.id = ?'
            );
            $curStmt->execute([Tenant::id()]);
            $cur = $curStmt->fetch() ?: [];
            $curTier = (string)($cur['tier'] ?? 'trial');
            $curPrice = $cadence === 'yearly'
                ? (int)($cur['cur_year']  ?? 0)
                : (int)($cur['cur_month'] ?? 0);
            $newPrice = $cadence === 'yearly'
                ? (int)($plan['price_yearly_cents']  ?? 0)
                : (int)($plan['price_monthly_cents'] ?? 0);

            if ($curTier === $tier) {
                Json::fail("You're already on the {$tier} plan.", 400);
            }
            $direction = $newPrice > $curPrice ? 'upgrade'
                       : ($newPrice < $curPrice ? 'downgrade' : 'same');

            // Check the tenant's existing subscription — reuse if present,
            // otherwise create fresh. Switching plans updates in place.
            $t = Db::pdo()->prepare('SELECT stripe_subscription_id FROM tenants WHERE id = ?');
            $t->execute([Tenant::id()]);
            $tRow = $t->fetch() ?: [];
            $existing = $tRow['stripe_subscription_id'] ?? null;

            $isDeferred = false;
            $effectiveAt = null;

            if ($existing && $direction === 'downgrade') {
                // Downgrade -> defer to end of current period via
                // subscription_schedules. Customer stays on the current
                // tier until the anniversary, then Stripe auto-switches
                // to the new plan. No proration credit accrues (which
                // is what prevents credit-farming abuse).
                $existingSub = $sdk->subscriptions->retrieve($existing, ['expand' => ['items']]);
                $itemId = $existingSub->items->data[0]->id ?? null;
                $curStripePrice = $existingSub->items->data[0]->price->id ?? null;
                $periodStart = (int)($existingSub->current_period_start ?? time());
                $periodEnd   = (int)($existingSub->current_period_end ?? time());

                // If a schedule already exists (previous pending change),
                // release it first so we can attach a fresh one.
                $t = Db::pdo()->prepare('SELECT stripe_schedule_id FROM tenants WHERE id = ?');
                $t->execute([Tenant::id()]);
                if ($existingScheduleId = $t->fetch()['stripe_schedule_id'] ?? null) {
                    try { $sdk->subscriptionSchedules->release($existingScheduleId); } catch (\Throwable $e) {}
                }

                $schedule = $sdk->subscriptionSchedules->create([
                    'from_subscription' => $existing,
                ]);
                $sdk->subscriptionSchedules->update($schedule->id, [
                    'end_behavior' => 'release',
                    'phases' => [
                        [
                            'items'      => [['price' => $curStripePrice, 'quantity' => 1]],
                            'start_date' => $periodStart,
                            'end_date'   => $periodEnd,
                        ],
                        [
                            'items' => [['price' => $price, 'quantity' => 1]],
                            'metadata' => ['tenant_id' => (string)Tenant::id(), 'tier' => $tier, 'cadence' => $cadence],
                        ],
                    ],
                    'metadata' => ['tenant_id' => (string)Tenant::id(), 'pending_tier' => $tier],
                ]);

                $effectiveAt = gmdate('Y-m-d H:i:s', $periodEnd);
                $isDeferred = true;

                Db::pdo()->prepare(
                    'UPDATE tenants
                        SET stripe_schedule_id = ?, pending_tier = ?, pending_cadence = ?, pending_effective_at = ?
                      WHERE id = ?'
                )->execute([$schedule->id, $tier, $cadence, $effectiveAt, Tenant::id()]);

                _brs_log_plan_change($curTier, $tier, $cadence, 'downgrade', true, $effectiveAt);

                Json::send([
                    'deferred'     => true,
                    'effective_at' => $effectiveAt,
                    'message'      => "Downgrade to {$tier} scheduled for the end of your current billing period.",
                ]);
            }

            if ($existing) {
                // Upgrade or same-price cadence flip.
                // `always_invoice` charges the pro-rated difference
                // immediately on upgrade. Billing anniversary preserved.
                $existingSub = $sdk->subscriptions->retrieve($existing, ['expand' => ['items']]);
                $itemId = $existingSub->items->data[0]->id ?? null;
                if (!$itemId) Json::fail('Existing subscription has no items. Contact support.', 500);
                $subObj = $sdk->subscriptions->update($existing, [
                    'items' => [['id' => $itemId, 'price' => $price]],
                    'proration_behavior' => 'always_invoice',
                    'metadata' => ['tenant_id' => (string)Tenant::id(), 'tier' => $tier],
                ]);
            } else {
                $subObj = $sdk->subscriptions->create([
                    'customer' => $customerId,
                    'items'    => [['price' => $price]],
                    'payment_behavior' => 'default_incomplete',
                    'payment_settings' => ['save_default_payment_method' => 'on_subscription'],
                    'expand'   => ['latest_invoice.payment_intent'],
                    'metadata' => ['tenant_id' => (string)Tenant::id(), 'tier' => $tier],
                ]);
            }

            // Persist immediately - webhook confirms/corrects later.
            Db::pdo()->prepare(
                'UPDATE tenants
                    SET stripe_subscription_id = ?, stripe_status = ?, subscription_tier = ?,
                        pending_tier = NULL, pending_cadence = NULL, pending_effective_at = NULL
                  WHERE id = ?'
            )->execute([$subObj->id, $subObj->status, $tier, Tenant::id()]);

            _brs_log_plan_change($curTier, $tier, $cadence,
                $existing ? $direction : 'initial', false, null);

            $pi = $subObj->latest_invoice->payment_intent ?? null;
            Json::send([
                'subscription_id'    => $subObj->id,
                'status'             => $subObj->status,
                'client_secret'      => $pi->client_secret ?? null,
                'requires_action'    => in_array($subObj->status, ['incomplete', 'incomplete_expired'], true),
            ]);
        }

        // Cancel a pending downgrade (release the Stripe schedule).
        if ($sub === 'cancel-pending' && $method === 'POST') {
            $t = Db::pdo()->prepare('SELECT stripe_schedule_id FROM tenants WHERE id = ?');
            $t->execute([Tenant::id()]);
            $schedId = $t->fetch()['stripe_schedule_id'] ?? null;
            if (!$schedId) Json::fail('No pending change to cancel', 400);

            try {
                $sdk->subscriptionSchedules->release($schedId);
            } catch (\Throwable $e) {
                error_log('[billing] release schedule failed: ' . $e->getMessage());
            }
            Db::pdo()->prepare(
                'UPDATE tenants
                    SET stripe_schedule_id = NULL, pending_tier = NULL,
                        pending_cadence = NULL, pending_effective_at = NULL
                  WHERE id = ?'
            )->execute([Tenant::id()]);
            Json::send(['ok' => true]);
        }

        // Cancel subscription — at period end so the tenant keeps
        // access until they stop paying for. Immediate cancel is not
        // exposed; support can do it via Stripe dashboard.
        if ($sub === 'cancel' && $method === 'POST') {
            $t = Db::pdo()->prepare('SELECT stripe_subscription_id FROM tenants WHERE id = ?');
            $t->execute([Tenant::id()]);
            $subId = $t->fetch()['stripe_subscription_id'] ?? null;
            if (!$subId) Json::fail('No active subscription', 400);
            $sdk->subscriptions->update($subId, ['cancel_at_period_end' => true]);
            Json::send(['ok' => true]);
        }

        // Customer Portal — Stripe-hosted self-service. Give the tenant
        // a session URL and they can manage everything from Stripe's UI
        // (invoices, payment methods, cancellation, tax ids).
        if ($sub === 'portal' && $method === 'POST') {
            $baseUrl = rtrim((string)($GLOBALS['BRS_CONFIG']['base_url'] ?? ''), '/');
            $returnUrl = $baseUrl . '/cms/frontend/#/admin/settings';
            $session = $sdk->billingPortal->sessions->create([
                'customer'   => $customerId,
                'return_url' => $returnUrl,
            ]);
            Json::send(['url' => $session->url]);
        }

        Json::fail('Not found', 404);
    }

    // ── /api/billing/plans ───────────────────────────────────────
    // Public list — used by the plan picker on the Billing tab and any
    // marketing-side plan-cards. Super-admin PUT edits price + features.
    if ($seg1 === 'plans') {
        if ($method === 'GET') {
            $rows = Db::pdo()->query(
                'SELECT id, tier, name, tagline, user_range_label, max_users,
                        price_monthly_cents, price_yearly_cents, currency,
                        is_contact_sales, is_highlight, is_active,
                        features_json, stripe_price_monthly, stripe_price_yearly, sort_order
                   FROM subscription_plans
                  WHERE is_active = 1
                  ORDER BY sort_order, id'
            )->fetchAll();
            // Decode features JSON server-side so the frontend gets a
            // typed array of strings instead of a raw string that would
            // need parsing at every render.
            foreach ($rows as &$r) {
                $r['features'] = $r['features_json'] ? json_decode($r['features_json'], true) : [];
                unset($r['features_json']);
            }
            Json::send(['plans' => $rows]);
        }
        // Any edit requires super-admin. Individual admins on a tenant
        // MUST NOT be able to fiddle with the price catalogue.
        if ($method === 'PUT') {
            if (!Tenant::isSuper()) Json::fail('Super-admin only', 403);
            $id = (int)($segs[2] ?? 0);
            if ($id === 0) Json::fail('Plan id required', 400);
            $b = Json::readBody();
            $fields = ['name','tagline','user_range_label','max_users',
                       'price_monthly_cents','price_yearly_cents','currency',
                       'is_contact_sales','is_highlight','is_active',
                       'stripe_price_monthly','stripe_price_yearly','sort_order'];
            $set = []; $params = [];
            foreach ($fields as $f) if (array_key_exists($f, $b)) {
                $set[] = "`{$f}` = ?";
                $params[] = $b[$f];
            }
            if (array_key_exists('features', $b) && is_array($b['features'])) {
                $set[] = '`features_json` = ?';
                $params[] = json_encode(array_values($b['features']));
            }
            if (!$set) Json::fail('No fields to update', 400);
            $params[] = $id;
            Db::pdo()->prepare(
                'UPDATE subscription_plans SET ' . implode(', ', $set) . ' WHERE id = ?'
            )->execute($params);
            Json::send(['ok' => true]);
        }
        Json::fail('Method not allowed', 405);
    }

    // ── /api/billing/invoices ────────────────────────────────────
    if ($seg1 === 'invoices' && $method === 'GET') {
        $rows = $pdo->query(
            'SELECT id, invoice_number, description, amount_cents, currency, status,
                    issued_at, due_at, paid_at, pdf_url, provider, created_at
               FROM subscription_invoices
              ORDER BY COALESCE(issued_at, created_at) DESC, id DESC
              LIMIT 100'
        )->fetchAll();
        Json::send(['invoices' => $rows]);
    }

    Json::fail('Not found', 404);
};

/** Append-only plan-change audit trail. Fuels both the rate limit
 *  (count last 30d) and any billing dispute lookup. Never fails the
 *  request path - a logging error is logged, not propagated. */
function _brs_log_plan_change(
    string $fromTier,
    string $toTier,
    string $cadence,
    string $direction,
    bool $isDeferred,
    ?string $effectiveAt
): void {
    try {
        Db::pdo()->prepare(
            'INSERT INTO plan_change_log
                (tenant_id, changed_by, from_tier, to_tier, cadence, direction, is_deferred, effective_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        )->execute([
            \BRS\Tenant::id(),
            \BRS\Tenant::userId() ?: null,
            $fromTier ?: null,
            $toTier,
            $cadence,
            $direction,
            $isDeferred ? 1 : 0,
            $effectiveAt,
        ]);
    } catch (\Throwable $e) {
        error_log('[billing] plan_change_log failed: ' . $e->getMessage());
    }
}

/**
 * Upsert a payment method row from the request body. Field validation
 * is deliberately loose - the frontend UI is a placeholder for real
 * Stripe capture. The one hard rule: NEVER persist a full PAN or CVC.
 * We enforce that at the API layer by only writing the fields listed
 * below (last4, brand, expiry, holder_name).
 */
function _brs_upsert_pm(\PDO $pdo, ?int $id, array $b): int
{
    $type = in_array($b['type'] ?? '', ['card','bank','other'], true) ? $b['type'] : 'card';
    $last4 = preg_replace('/\D+/', '', (string)($b['last4'] ?? ''));
    if ($last4 !== null && strlen($last4) > 4) $last4 = substr($last4, -4);
    $params = [
        'type'          => $type,
        'brand'         => trim((string)($b['brand'] ?? '')) ?: null,
        'last4'         => $last4 ?: null,
        'holder_name'   => trim((string)($b['holder_name'] ?? '')) ?: null,
        'expires_month' => !empty($b['expires_month']) ? min(12, max(1, (int)$b['expires_month'])) : null,
        'expires_year'  => !empty($b['expires_year'])  ? (int)$b['expires_year'] : null,
        'is_default'    => !empty($b['is_default']) ? 1 : 0,
        'provider'      => trim((string)($b['provider'] ?? '')) ?: null,
    ];

    if ($id === null) {
        $ins = Db::pdo()->prepare(
            'INSERT INTO payment_methods
                (tenant_id, type, brand, last4, holder_name, expires_month, expires_year, is_default, provider)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $ins->execute([
            \BRS\Tenant::id(),
            $params['type'], $params['brand'], $params['last4'], $params['holder_name'],
            $params['expires_month'], $params['expires_year'], $params['is_default'], $params['provider'],
        ]);
        $newId = (int)Db::pdo()->lastInsertId();
        if ($params['is_default']) _brs_promote_default($pdo, $newId);
        return $newId;
    }

    $pdo->prepare(
        'UPDATE payment_methods
            SET type = ?, brand = ?, last4 = ?, holder_name = ?, expires_month = ?, expires_year = ?, is_default = ?, provider = ?
          WHERE id = ?'
    )->execute([
        $params['type'], $params['brand'], $params['last4'], $params['holder_name'],
        $params['expires_month'], $params['expires_year'], $params['is_default'], $params['provider'],
        $id,
    ]);
    if ($params['is_default']) _brs_promote_default($pdo, $id);
    return $id;
}

/** Only one payment method can be default per tenant. */
function _brs_promote_default(\PDO $pdo, int $id): void
{
    $pdo->prepare('UPDATE payment_methods SET is_default = 0 WHERE id <> ?')->execute([$id]);
}
