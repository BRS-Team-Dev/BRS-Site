-- Migration 130: subscription invoices (us → tenant, distinct from the
-- Accounting module's `invoices` table which is tenant → their clients).
-- 129 originally tried to create this as `invoices` but that name was
-- already taken; we use a dedicated table to keep the two billing
-- surfaces cleanly separated in queries + FK relations.

CREATE TABLE IF NOT EXISTS `subscription_invoices` (
  `id`             INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `tenant_id`      INT UNSIGNED NOT NULL,
  `invoice_number` VARCHAR(40)  NOT NULL,
  `description`    VARCHAR(255) NOT NULL,
  `amount_cents`   INT NOT NULL DEFAULT 0,
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
  KEY `idx_si_tenant_status` (`tenant_id`, `status`, `issued_at`),
  UNIQUE KEY `uq_si_tenant_number` (`tenant_id`, `invoice_number`),
  CONSTRAINT `fk_si_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`)        ON DELETE CASCADE,
  CONSTRAINT `fk_si_pm`     FOREIGN KEY (`payment_method_id`) REFERENCES `payment_methods` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
