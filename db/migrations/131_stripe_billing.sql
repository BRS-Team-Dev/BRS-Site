-- Migration 131: Stripe billing columns.
--
-- Adds the Stripe customer + subscription linkage to `tenants`, plus
-- Stripe payment method + invoice references. Presence of
-- `stripe_customer_id` on a tenant is the signal that they've been
-- onboarded to Stripe; before that we only have manual payment methods.

ALTER TABLE `tenants`
  ADD COLUMN `stripe_customer_id`       VARCHAR(60) NULL AFTER `vat_number`,
  ADD COLUMN `stripe_subscription_id`   VARCHAR(60) NULL AFTER `stripe_customer_id`,
  ADD COLUMN `stripe_status`            VARCHAR(30) NULL AFTER `stripe_subscription_id`,
  ADD COLUMN `stripe_current_period_end` DATETIME NULL AFTER `stripe_status`,
  ADD COLUMN `stripe_default_pm_id`     VARCHAR(60) NULL AFTER `stripe_current_period_end`,
  ADD UNIQUE KEY `uq_tenants_stripe_customer` (`stripe_customer_id`);

-- payment_methods already has `external_id` (from migration 129) which
-- holds the Stripe `pm_...` id when Stripe is the source. Add an index
-- so webhook lookups by pm id are O(log n).
ALTER TABLE `payment_methods`
  ADD KEY `idx_pm_external` (`external_id`);

-- subscription_invoices links to Stripe via provider_ref (invoice `in_...`).
-- Add a unique-when-present index so webhook replay is idempotent.
ALTER TABLE `subscription_invoices`
  ADD UNIQUE KEY `uq_si_provider_ref` (`provider`, `provider_ref`);
