-- Migration 073: Contractors — external/internal contractors at
-- /operations/contractors.
--
-- Captures the legal/payment shape needed for UK contractor management
-- (IR35 status, VAT, company number) plus the operational metadata
-- (discipline, rate, engagement_type) used to filter who's available
-- for a given piece of work. Notes live in `contractor_notes`.

CREATE TABLE IF NOT EXISTS `contractors` (
  `id`              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`            VARCHAR(255) NOT NULL,
  `contractor_type` ENUM('individual','agency','freelancer','consultant')
                      NOT NULL DEFAULT 'freelancer',
  `internal_external` ENUM('internal','external') NOT NULL DEFAULT 'external',
  `discipline`      VARCHAR(120) NULL,
  `status`          ENUM('active','inactive','on_break','ended')
                      NOT NULL DEFAULT 'active',
  `engagement_type` ENUM('hourly','daily','project','retainer','full_time','part_time')
                      NOT NULL DEFAULT 'hourly',
  `rate`            DECIMAL(10,2) NULL,
  `currency`        CHAR(3) NOT NULL DEFAULT 'GBP',
  `start_date`      DATE NULL,
  `end_date`        DATE NULL,
  `primary_email`   VARCHAR(190) NULL,
  `primary_phone`   VARCHAR(80) NULL,
  `website`         VARCHAR(500) NULL,
  `address`         TEXT NULL,
  `tax_id`          VARCHAR(80) NULL,
  `vat_number`      VARCHAR(80) NULL,
  `company_number`  VARCHAR(80) NULL,
  `ir35_status`     ENUM('inside','outside','not_applicable','unknown')
                      NOT NULL DEFAULT 'unknown',
  `notes`           TEXT NULL,
  `project_manager_id` INT UNSIGNED NULL,
  `created_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_status_discipline` (`status`, `discipline`),
  KEY `idx_manager` (`project_manager_id`),
  CONSTRAINT `fk_contractor_manager`
    FOREIGN KEY (`project_manager_id`) REFERENCES `admin_users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `contractor_notes` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `contractor_id` INT UNSIGNED NOT NULL,
  `title`         VARCHAR(255) NOT NULL,
  `body`          TEXT NULL,
  `sort_order`    INT NOT NULL DEFAULT 0,
  `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_contractor` (`contractor_id`),
  CONSTRAINT `fk_cnote_contractor` FOREIGN KEY (`contractor_id`) REFERENCES `contractors`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
