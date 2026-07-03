<?php
declare(strict_types=1);

namespace BRS;

use Stripe\StripeClient as SdkClient;

/**
 * Thin wrapper around stripe/stripe-php.
 *
 * - `client()` returns a configured SdkClient, or null if no secret key
 *   is set (fresh install without Stripe). Callers should degrade gracefully.
 * - `getOrCreateCustomer($tenantId)` returns a Stripe customer id for
 *   the tenant, creating one on first call and persisting it to
 *   `tenants.stripe_customer_id`.
 * - `priceIdForTier($tier)` maps our tier enum to the configured
 *   Stripe Price id.
 *
 * All errors from the Stripe SDK bubble up to the route handler which
 * translates them via Json::fail(). We deliberately don't try/catch
 * here — the SDK's typed exceptions carry the info we need.
 */
final class StripeClient
{
    public static function isConfigured(): bool
    {
        $cfg = $GLOBALS['BRS_CONFIG']['stripe'] ?? [];
        return !empty($cfg['secret']);
    }

    public static function client(): ?SdkClient
    {
        $cfg = $GLOBALS['BRS_CONFIG']['stripe'] ?? [];
        if (empty($cfg['secret'])) return null;
        return new SdkClient([
            'api_key'        => $cfg['secret'],
            'stripe_version' => '2024-06-20',
        ]);
    }

    public static function publishableKey(): ?string
    {
        return $GLOBALS['BRS_CONFIG']['stripe']['publishable'] ?? null;
    }

    public static function webhookSecret(): ?string
    {
        return $GLOBALS['BRS_CONFIG']['stripe']['webhook_secret'] ?? null;
    }

    /** Returns Stripe Price id for a subscription tier, or null if unset. */
    public static function priceIdForTier(string $tier): ?string
    {
        return $GLOBALS['BRS_CONFIG']['stripe']['price_ids'][$tier] ?? null;
    }

    /**
     * Get an existing Stripe customer for a tenant, or create one and
     * persist the id back to `tenants.stripe_customer_id`. Uses the
     * billing_email column as the customer's email — the same email
     * that shows on invoices.
     */
    public static function getOrCreateCustomer(int $tenantId): string
    {
        $stmt = Db::pdo()->prepare(
            'SELECT id, stripe_customer_id, brand_name, billing_email, billing_address, vat_number
               FROM tenants WHERE id = ?'
        );
        $stmt->execute([$tenantId]);
        $t = $stmt->fetch();
        if (!$t) throw new \RuntimeException('Tenant not found');
        if (!empty($t['stripe_customer_id'])) return $t['stripe_customer_id'];

        $sdk = self::client();
        if (!$sdk) throw new \RuntimeException('Stripe not configured');

        $customer = $sdk->customers->create([
            'name'    => $t['brand_name'] ?: null,
            'email'   => $t['billing_email'] ?: null,
            'address' => $t['billing_address']
                ? ['line1' => (string)$t['billing_address']]
                : null,
            'metadata' => [
                'tenant_id'  => (string)$tenantId,
                'brand_name' => (string)$t['brand_name'],
            ],
        ]);

        Db::pdo()->prepare(
            'UPDATE tenants SET stripe_customer_id = ? WHERE id = ?'
        )->execute([$customer->id, $tenantId]);

        return $customer->id;
    }

    /**
     * Persist a Stripe payment method into our local `payment_methods`
     * table so the billing UI can list it without hitting Stripe every
     * page load. Card/BACS branches share the same schema.
     *
     * @param object $pm Stripe PaymentMethod object (from expand/retrieve)
     */
    public static function upsertPaymentMethod(int $tenantId, object $pm): void
    {
        [$type, $brand, $last4, $expMonth, $expYear, $holderName] = self::flattenPm($pm);

        // Webhook context has no auth cookie so we route through the
        // raw PDO and scope by tenant_id explicitly.
        $sel = Db::pdo()->prepare(
            'SELECT id FROM payment_methods WHERE tenant_id = ? AND external_id = ? LIMIT 1'
        );
        $sel->execute([$tenantId, $pm->id]);
        $existing = $sel->fetch();

        $fingerprint = $pm->card->fingerprint ?? null;

        if ($existing) {
            Db::pdo()->prepare(
                'UPDATE payment_methods
                    SET type = ?, brand = ?, last4 = ?, holder_name = ?,
                        expires_month = ?, expires_year = ?, provider = "stripe",
                        card_fingerprint = ?
                  WHERE id = ?'
            )->execute([$type, $brand, $last4, $holderName, $expMonth, $expYear, $fingerprint, (int)$existing['id']]);
            self::recordAbuseSignal($tenantId, $fingerprint);
            return;
        }

        Db::pdo()->prepare(
            'INSERT INTO payment_methods
                (tenant_id, type, brand, last4, holder_name, expires_month, expires_year,
                 is_default, provider, external_id, card_fingerprint)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0, "stripe", ?, ?)'
        )->execute([$tenantId, $type, $brand, $last4, $holderName, $expMonth, $expYear, $pm->id, $fingerprint]);

        self::recordAbuseSignal($tenantId, $fingerprint);
    }

    /**
     * Log a card fingerprint into trial_abuse_signals. Same-tenant
     * duplicates are ignored (the KEY is on (signal_type, signal_value)
     * but not unique - we want the log to show every save). The check
     * side (isCardReused) looks for the fingerprint across DIFFERENT
     * tenants than the caller.
     */
    public static function recordAbuseSignal(int $tenantId, ?string $fingerprint): void
    {
        if (!$fingerprint) return;
        try {
            Db::pdo()->prepare(
                'INSERT INTO trial_abuse_signals (tenant_id, signal_type, signal_value)
                 VALUES (?, "card_fingerprint", ?)'
            )->execute([$tenantId, $fingerprint]);
        } catch (\Throwable $e) {
            error_log('[stripe] trial signal insert failed: ' . $e->getMessage());
        }
    }

    /**
     * True if this card fingerprint has been seen on ANY tenant other
     * than the caller. Used by the signup flow to refuse trial-only
     * onboarding when someone's re-using a card across signups.
     */
    public static function isCardReusedAcrossTenants(string $fingerprint, ?int $excludeTenantId = null): bool
    {
        $sql = 'SELECT 1 FROM trial_abuse_signals
                 WHERE signal_type = "card_fingerprint" AND signal_value = ?';
        $params = [$fingerprint];
        if ($excludeTenantId !== null) {
            $sql .= ' AND (tenant_id IS NULL OR tenant_id <> ?)';
            $params[] = $excludeTenantId;
        }
        $sql .= ' LIMIT 1';
        $stmt = Db::pdo()->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchColumn() !== false;
    }

    /**
     * Extract our schema fields from a Stripe PaymentMethod object.
     * Returns [type, brand, last4, expMonth, expYear, holderName].
     */
    private static function flattenPm(object $pm): array
    {
        $type = 'other';
        $brand = null; $last4 = null; $expMonth = null; $expYear = null;
        $holderName = $pm->billing_details->name ?? null;

        if (($pm->type ?? '') === 'card' && !empty($pm->card)) {
            $type = 'card';
            $brand = ucfirst((string)($pm->card->brand ?? ''));
            $last4 = (string)($pm->card->last4 ?? '');
            $expMonth = (int)($pm->card->exp_month ?? 0) ?: null;
            $expYear  = (int)($pm->card->exp_year  ?? 0) ?: null;
        } elseif (($pm->type ?? '') === 'bacs_debit' && !empty($pm->bacs_debit)) {
            $type = 'bank';
            $brand = 'BACS Direct Debit';
            $last4 = (string)($pm->bacs_debit->last4 ?? '');
        } elseif (($pm->type ?? '') === 'sepa_debit' && !empty($pm->sepa_debit)) {
            $type = 'bank';
            $brand = 'SEPA Direct Debit';
            $last4 = (string)($pm->sepa_debit->last4 ?? '');
        } elseif (($pm->type ?? '') === 'us_bank_account' && !empty($pm->us_bank_account)) {
            $type = 'bank';
            $brand = (string)($pm->us_bank_account->bank_name ?? 'Bank');
            $last4 = (string)($pm->us_bank_account->last4 ?? '');
        }

        return [$type, $brand, $last4, $expMonth, $expYear, $holderName];
    }
}
