-- Migration 135: anti-abuse infrastructure for billing.
--
-- Five defensive layers wired in one migration:
--   1. plan_change_log         - rate-limit tier switches (max 3 / 30d)
--   2. trial_abuse_signals     - catch trial farmers reusing cards / domains
--   3. tenants.pending_tier    - hold deferred downgrades until period end
--   4. tenants.stripe_schedule_id - link to Stripe subscription_schedules
--   5. payment_methods.card_fingerprint - de-dupe cards across tenants
--
-- Every row here is either a log (append-only) or a nullable field, so
-- this migration is safe to apply on live data without backfill.

-- ── 1. Plan-change log ─────────────────────────────────────
-- Every /stripe/subscribe hit writes a row. Used for the rate-limit
-- check (count last 30d) and as an audit trail for billing disputes.
CREATE TABLE IF NOT EXISTS `plan_change_log` (
  `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `tenant_id`    INT UNSIGNED NOT NULL,
  `changed_by`   INT UNSIGNED NULL,
  `from_tier`    VARCHAR(30) NULL,
  `to_tier`      VARCHAR(30) NOT NULL,
  `cadence`      VARCHAR(10) NOT NULL DEFAULT 'monthly',
  `direction`    ENUM('upgrade','downgrade','same','initial') NOT NULL,
  `is_deferred`  TINYINT(1) NOT NULL DEFAULT 0,
  `effective_at` DATETIME NULL,
  `created_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_pcl_tenant_created` (`tenant_id`, `created_at`),
  CONSTRAINT `fk_pcl_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 2. Trial abuse signals ─────────────────────────────────
-- Append-only log of "we've seen this identifier before". On signup,
-- if any signal matches an existing row (across ANY tenant), the
-- new tenant is denied a trial and forced to enter a card.
--
-- signal_type: card_fingerprint | email_domain | ip_address
-- signal_value: the identifier itself (fingerprint / normalised domain / v4/v6 IP)
CREATE TABLE IF NOT EXISTS `trial_abuse_signals` (
  `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `tenant_id`    INT UNSIGNED NULL,
  `signal_type`  ENUM('card_fingerprint','email_domain','ip_address') NOT NULL,
  `signal_value` VARCHAR(190) NOT NULL,
  `first_seen_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_tas_lookup` (`signal_type`, `signal_value`),
  KEY `idx_tas_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 3. Pending tier + schedule linkage ────────────────────
-- When a downgrade is deferred, the pending target lives here + the
-- Stripe subscription_schedule id that will apply it. On the
-- subscription_schedule.released webhook the pending_* columns clear
-- and the actual subscription_tier flips.
ALTER TABLE `tenants`
  ADD COLUMN `pending_tier`         VARCHAR(30) NULL AFTER `subscription_tier`,
  ADD COLUMN `pending_cadence`      VARCHAR(10) NULL AFTER `pending_tier`,
  ADD COLUMN `pending_effective_at` DATETIME    NULL AFTER `pending_cadence`,
  ADD COLUMN `stripe_schedule_id`   VARCHAR(60) NULL AFTER `stripe_subscription_id`;

-- ── 4. Card fingerprint on payment_methods ────────────────
-- Stripe returns pm.card.fingerprint - same physical card = same
-- fingerprint across any customer, any tenant. Storing it enables
-- the trial abuse check to catch re-use without needing to hit Stripe.
ALTER TABLE `payment_methods`
  ADD COLUMN `card_fingerprint` VARCHAR(60) NULL AFTER `external_id`,
  ADD KEY `idx_pm_fingerprint` (`card_fingerprint`);
