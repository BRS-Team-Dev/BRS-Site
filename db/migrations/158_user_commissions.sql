-- 158_user_commissions.sql
--
-- Personal commissions: what an admin_user earns from a client account.
-- Two tables:
--
--   * user_commission_rules — standing agreement: "Bobby earns 5% of every
--     invoice we send Star Boy Barbers". Optional service scope. A future
--     job can auto-generate ledger entries from these; for now they're a
--     reference doc admins see on the client + portal user sees on their
--     "My accounts" page.
--
--   * user_commissions — the ledger. Every real earning (accrual, bonus,
--     adjustment, payout). rule_id is optional so entries can be manual
--     OR auto-generated later. Aggregating by admin_user_id + status
--     gives YTD earned / paid / pending totals on the portal.

CREATE TABLE `user_commission_rules` (
  `id`                       INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`                INT UNSIGNED NOT NULL,
  `admin_user_id`            INT UNSIGNED NOT NULL,
  `client_id`                INT UNSIGNED NOT NULL,
  `service_client_link_id`   INT UNSIGNED NULL,
  `rate_type`                ENUM('percentage','flat') NOT NULL DEFAULT 'percentage',
  `rate`                     DECIMAL(10,2) NOT NULL,
  `applies_to`               ENUM('all','recurring','one_off') NOT NULL DEFAULT 'all',
  `cadence`                  ENUM('per_invoice','monthly','one_time') NOT NULL DEFAULT 'per_invoice',
  `currency`                 CHAR(3) NOT NULL DEFAULT 'GBP',
  `status`                   ENUM('active','paused','ended') NOT NULL DEFAULT 'active',
  `starts_on`                DATE NULL,
  `ends_on`                  DATE NULL,
  `notes`                    VARCHAR(500) NULL,
  `created_by_user_id`       INT UNSIGNED NULL,
  `created_at`               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_rules_user_client` (`tenant_id`, `admin_user_id`, `client_id`, `status`),
  KEY `idx_rules_client`      (`tenant_id`, `client_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `user_commissions` (
  `id`                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`           INT UNSIGNED NOT NULL,
  `admin_user_id`       INT UNSIGNED NOT NULL,
  `client_id`           INT UNSIGNED NULL,
  `rule_id`             INT UNSIGNED NULL,
  `invoice_id`          INT UNSIGNED NULL,
  `kind`                ENUM('accrual','bonus','adjustment','payout') NOT NULL DEFAULT 'accrual',
  `amount`              DECIMAL(12,2) NOT NULL,
  `currency`            CHAR(3) NOT NULL DEFAULT 'GBP',
  `status`              ENUM('pending','earned','paid','cancelled') NOT NULL DEFAULT 'earned',
  `earned_on`           DATE NOT NULL,
  `paid_on`             DATE NULL,
  `description`         VARCHAR(500) NULL,
  `created_by_user_id`  INT UNSIGNED NULL,
  `created_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_comm_user`   (`tenant_id`, `admin_user_id`, `status`, `earned_on`),
  KEY `idx_comm_client` (`tenant_id`, `client_id`, `earned_on`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
