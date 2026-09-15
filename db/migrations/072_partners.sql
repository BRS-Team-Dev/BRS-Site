-- Migration 072: Partners — B2B partnership relationships tracked under
-- Operations at /operations/partners.
--
-- Each partner row holds the core relationship metadata (type, status,
-- contract value, term, primary contact, identifiers). Multi-stakeholder
-- relationships warrant a dedicated `partner_contacts` sub-table (each
-- partner often has procurement / legal / technical / executive contacts).
-- Rich notes go in `partner_notes` (title + body, same shape as
-- client_notes / tender_notes).

CREATE TABLE IF NOT EXISTS `partners` (
  `id`                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `legal_name`          VARCHAR(255) NOT NULL,
  `trading_name`        VARCHAR(255) NULL,
  `partnership_type`    ENUM('strategic','reseller','technology','channel','referral','other')
                          NOT NULL DEFAULT 'strategic',
  `tier`                ENUM('preferred','standard','prospective')
                          NOT NULL DEFAULT 'standard',
  `status`              ENUM('prospective','active','paused','terminated')
                          NOT NULL DEFAULT 'prospective',
  `start_date`          DATE NULL,
  `renewal_date`        DATE NULL,
  `auto_renew`          TINYINT(1) NOT NULL DEFAULT 0,
  `contract_value`      DECIMAL(14,2) NULL,
  `currency`            CHAR(3) NOT NULL DEFAULT 'GBP',
  `primary_email`       VARCHAR(190) NULL,
  `primary_phone`       VARCHAR(80) NULL,
  `website`             VARCHAR(500) NULL,
  `address`             TEXT NULL,
  `registration_number` VARCHAR(80) NULL,
  `vat_number`          VARCHAR(80) NULL,
  `scope`               TEXT NULL,
  `relationship_owner_id` INT UNSIGNED NULL,
  `created_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_status_renewal` (`status`, `renewal_date`),
  KEY `idx_owner` (`relationship_owner_id`),
  CONSTRAINT `fk_partner_owner`
    FOREIGN KEY (`relationship_owner_id`) REFERENCES `admin_users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `partner_contacts` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `partner_id` INT UNSIGNED NOT NULL,
  `first_name` VARCHAR(120) NOT NULL,
  `last_name`  VARCHAR(120) NULL,
  `position`   VARCHAR(160) NULL,
  `email`      VARCHAR(190) NULL,
  `phone`      VARCHAR(80) NULL,
  `is_primary` TINYINT(1) NOT NULL DEFAULT 0,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_partner` (`partner_id`),
  CONSTRAINT `fk_pcontact_partner` FOREIGN KEY (`partner_id`) REFERENCES `partners`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `partner_notes` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `partner_id` INT UNSIGNED NOT NULL,
  `title`      VARCHAR(255) NOT NULL,
  `body`       TEXT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_partner` (`partner_id`),
  CONSTRAINT `fk_pnote_partner` FOREIGN KEY (`partner_id`) REFERENCES `partners`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
