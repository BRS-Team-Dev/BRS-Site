<?php
declare(strict_types=1);

use BRS\Db;
use BRS\Json;
use BRS\StripeClient;
use Stripe\Webhook;

/*
 * Stripe webhook receiver.
 *
 *   POST /api/stripe-webhook   (public — signature-verified)
 *
 * Handled events:
 *   - customer.subscription.created/updated/deleted → tenants.stripe_*
 *   - invoice.paid / invoice.payment_failed         → subscription_invoices
 *   - setup_intent.succeeded                        → payment_methods sync
 *   - payment_method.detached                       → remove local row
 *
 * Everything is idempotent — Stripe replays events on delivery failure.
 * We upsert by provider_ref (invoices) / external_id (payment methods).
 */

return function (string $method, array $segs): void {
    if ($method !== 'POST') Json::fail('Method not allowed', 405);
    if (!StripeClient::isConfigured()) Json::fail('Stripe not configured', 400);

    $secret = StripeClient::webhookSecret();
    if (!$secret) Json::fail('Webhook secret not configured', 500);

    $payload = file_get_contents('php://input');
    $sigHeader = $_SERVER['HTTP_STRIPE_SIGNATURE'] ?? '';

    try {
        $event = Webhook::constructEvent($payload, $sigHeader, $secret);
    } catch (\Throwable $e) {
        error_log('[stripe-webhook] signature check failed: ' . $e->getMessage());
        Json::fail('Invalid signature', 400);
    }

    $type = $event->type;
    $obj  = $event->data->object;

    // Resolve tenant from customer id (present on almost every event).
    $customerId = $obj->customer ?? ($obj->id ?? null);
    $tenantId = null;
    if ($customerId && strpos((string)$customerId, 'cus_') === 0) {
        $stmt = Db::pdo()->prepare('SELECT id FROM tenants WHERE stripe_customer_id = ? LIMIT 1');
        $stmt->execute([$customerId]);
        $row = $stmt->fetch();
        $tenantId = $row ? (int)$row['id'] : null;
    }

    switch ($type) {
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted':
            if (!$tenantId) break;
            $status = (string)($obj->status ?? '');
            $periodEnd = !empty($obj->current_period_end)
                ? gmdate('Y-m-d H:i:s', (int)$obj->current_period_end)
                : null;
            $tier = $obj->metadata->tier ?? null;

            // On delete, revert to trial (tenant loses paid access).
            if ($type === 'customer.subscription.deleted') {
                Db::pdo()->prepare(
                    'UPDATE tenants
                        SET stripe_subscription_id = NULL,
                            stripe_status = ?, stripe_current_period_end = ?,
                            subscription_tier = "trial"
                      WHERE id = ?'
                )->execute([$status ?: 'canceled', $periodEnd, $tenantId]);
            } else {
                $sql = 'UPDATE tenants
                          SET stripe_subscription_id = ?, stripe_status = ?,
                              stripe_current_period_end = ?';
                $params = [$obj->id, $status, $periodEnd];
                if ($tier && in_array($tier, ['starter','growth','scale','enterprise','trial'], true)) {
                    $sql .= ', subscription_tier = ?';
                    $params[] = $tier;
                }
                $sql .= ' WHERE id = ?';
                $params[] = $tenantId;
                Db::pdo()->prepare($sql)->execute($params);
            }
            break;

        case 'invoice.paid':
        case 'invoice.payment_failed':
        case 'invoice.finalized':
            if (!$tenantId) break;
            $status = $type === 'invoice.paid' ? 'paid'
                    : ($type === 'invoice.payment_failed' ? 'failed' : 'sent');
            $paidAt = ($type === 'invoice.paid' && !empty($obj->status_transitions->paid_at))
                ? gmdate('Y-m-d H:i:s', (int)$obj->status_transitions->paid_at)
                : null;
            $issuedAt = !empty($obj->created)
                ? gmdate('Y-m-d H:i:s', (int)$obj->created)
                : null;
            $dueAt = !empty($obj->due_date)
                ? gmdate('Y-m-d H:i:s', (int)$obj->due_date)
                : null;
            $desc = (string)($obj->lines->data[0]->description ?? $obj->description ?? 'Subscription');

            Db::pdo()->prepare(
                'INSERT INTO subscription_invoices
                    (tenant_id, invoice_number, description, amount_cents, currency,
                     status, issued_at, due_at, paid_at, provider, provider_ref, pdf_url)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, "stripe", ?, ?)
                 ON DUPLICATE KEY UPDATE
                    status = VALUES(status),
                    paid_at = VALUES(paid_at),
                    due_at = VALUES(due_at),
                    pdf_url = VALUES(pdf_url),
                    amount_cents = VALUES(amount_cents)'
            )->execute([
                $tenantId,
                (string)($obj->number ?? $obj->id),
                $desc,
                (int)($obj->amount_paid ?? $obj->amount_due ?? 0),
                strtoupper((string)($obj->currency ?? 'gbp')),
                $status,
                $issuedAt, $dueAt, $paidAt,
                $obj->id,
                (string)($obj->invoice_pdf ?? $obj->hosted_invoice_url ?? ''),
            ]);
            break;

        case 'setup_intent.succeeded':
            if (!$tenantId) break;
            $pmId = $obj->payment_method ?? null;
            if (!$pmId) break;
            $sdk = StripeClient::client();
            $pm = $sdk->paymentMethods->retrieve($pmId, []);
            StripeClient::upsertPaymentMethod($tenantId, $pm);
            break;

        case 'payment_method.detached':
            $pmId = $obj->id ?? null;
            if (!$pmId) break;
            Db::pdo()->prepare(
                'DELETE FROM payment_methods WHERE external_id = ?'
            )->execute([$pmId]);
            break;

        case 'subscription_schedule.released':
        case 'subscription_schedule.completed':
            // Fires when a deferred downgrade takes effect. Clear the
            // pending_* columns; the actual subscription_tier is set
            // by the customer.subscription.updated event that Stripe
            // fires alongside this one (metadata.tier carries the new
            // tier). We just clean up our schedule bookkeeping here.
            $schedId = $obj->id ?? null;
            if (!$schedId) break;
            Db::pdo()->prepare(
                'UPDATE tenants
                    SET stripe_schedule_id = NULL,
                        pending_tier = NULL,
                        pending_cadence = NULL,
                        pending_effective_at = NULL
                  WHERE stripe_schedule_id = ?'
            )->execute([$schedId]);
            break;

        case 'subscription_schedule.canceled':
            // Manual cancel via API (Stripe dashboard). Same cleanup.
            $schedId = $obj->id ?? null;
            if (!$schedId) break;
            Db::pdo()->prepare(
                'UPDATE tenants
                    SET stripe_schedule_id = NULL,
                        pending_tier = NULL,
                        pending_cadence = NULL,
                        pending_effective_at = NULL
                  WHERE stripe_schedule_id = ?'
            )->execute([$schedId]);
            break;

        default:
            // Ignored — Stripe sends a lot of events we don't care about.
            break;
    }

    Json::send(['received' => true]);
};
