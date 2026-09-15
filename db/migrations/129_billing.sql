-- Migration 129: billing — payment methods + invoices.
--
-- MVP shape. Real payment integration (Stripe, GoCardless, Paddle etc.)
-- lands the actual tokenised references in these rows — the fields
-- below are chosen to fit a Stripe SetupIntent / Charge without further
-- schema change:
--
--   payment_methods.provider     — 'stripe' etc. NULL for the manual
--                                  placeholder rows the UI creates now
--   payment_methods.external_id  — e.g. 'pm_1AbCd…' from Stripe
--   invoices.provider_ref        — external invoice / charge id
--
-- Both tables cascade on tenant delete.

CREATE TABLE IF NOT EXISTS `payment_methods` (
  `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `tenant_id`    INT UNSIGNED NOT NULL,
  `type`         ENUM('card','bank','other') NOT NULL DEFAULT 'card',
  `brand`        VARCHAR(40)  NULL COMMENT 'Visa / Mastercard / …',
  `last4`        VARCHAR(8)   NULL,
  `holder_name`  VARCHAR(120) NULL,
  `expires_month` TINYINT UNSIGNED NULL,
  `expires_year`  SMALLINT UNSIGNED NULL,
  `is_default`   TINYINT(1)   NOT NULL DEFAULT 0,
  `provider`     VARCHAR(40)  NULL COMMENT 'stripe|gocardless|paddle|manual',
  `external_id`  VARCHAR(120) NULL,
  `created_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_pm_tenant` (`tenant_id`),
  CONSTRAINT `fk_pm_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `invoices` (
  `id`             INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `tenant_id`      INT UNSIGNED NOT NULL,
  `invoice_number` VARCHAR(40)  NOT NULL,
  `description`    VARCHAR(255) NOT NULL,
  `amount_cents`   INT NOT NULL DEFAULT 0 COMMENT 'store as integer cents to avoid FP drift',
  `currency`       CHAR(3) NOT NULL DEFAULT 'GBP',
  `status`         ENUM('draft','sent','paid','failed','refunded') NOT NULL DEFAULT 'draft',
  `issued_at`      DATETIME NULL,
  `due_at`         DATETIME NULL,
  `paid_at`        DATETIME NULL,
  `provider`       VARCHAR(40)  NULL,
  `provider_ref`   VARCHAR(120) NULL,
  `pdf_url`        VARCHAR(500) NULL,
  `payment_method_id` INT UNSIGNED NULL,
  `created_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_inv_tenant_status` (`tenant_id`, `status`, `issued_at`),
  UNIQUE KEY `uq_inv_tenant_number` (`tenant_id`, `invoice_number`),
  CONSTRAINT `fk_inv_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_inv_pm`    FOREIGN KEY (`payment_method_id`) REFERENCES `payment_methods` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Billing profile fields on the tenant (used to render invoices, VAT,
-- billing address on the customer copy). Kept optional — tenants can
-- pay without them via saved card and update later.
ALTER TABLE `tenants`
  ADD COLUMN `billing_email`   VARCHAR(191) NULL AFTER `subscription_tier`,
  ADD COLUMN `billing_address` TEXT         NULL AFTER `billing_email`,
  ADD COLUMN `vat_number`      VARCHAR(60)  NULL AFTER `billing_address`;
