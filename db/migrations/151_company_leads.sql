-- Migration 151: Companies House pipeline gets its own staging tables.
--
-- The CH enrichment pipeline (Stages 1-5) previously wrote straight into
-- `leads`, which flooded the sales funnel with hundreds of half-built
-- records and leaked them into every consumer of `leads` (newsletter
-- audience, dashboard counts, exports). It now lives in its own
-- `company_leads` staging area, isolated from `leads` until a finished
-- record is explicitly promoted (see POST /api/company-leads/:id/promote,
-- which mirrors the tender_leads -> tenders promote pattern).
--
-- The three tables mirror `leads` / `lead_info` / `lead_contacts` (incl. the
-- `linkedin_url` column from migration 150) so promotion is a 1:1 row copy
-- and the Stage 1-5 handlers move over with only table-name changes.

USE `builtrightstudio_cms`;

CREATE TABLE IF NOT EXISTS `company_leads` (
  `id`               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `tenant_id`        INT UNSIGNED NOT NULL,
  `name`             VARCHAR(190) NOT NULL,
  `email`            VARCHAR(190) NULL,
  `phone`            VARCHAR(80)  NULL,
  `address`          TEXT NULL,
  `company`          VARCHAR(190) NULL,
  `company_number`   VARCHAR(20)  NULL,
  `url`              VARCHAR(500) NULL,
  `notes`            TEXT NULL,
  `status`           VARCHAR(40)  NOT NULL DEFAULT 'new',
  `source`           VARCHAR(120) NULL,
  `stage`            TINYINT UNSIGNED NULL,
  `stage_updated_at` DATETIME NULL,
  `industry`         VARCHAR(120) NULL,
  `added_by_user_id` INT UNSIGNED NULL,
  `added_by_system`  TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_company_leads_tenant_number` (`tenant_id`, `company_number`),
  KEY `idx_company_leads_tenant_stage` (`tenant_id`, `stage`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `company_lead_info` (
  `id`              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `tenant_id`       INT UNSIGNED NOT NULL,
  `company_lead_id` INT UNSIGNED NOT NULL,
  `name`            VARCHAR(190) NOT NULL,
  `value`           TEXT NULL,
  `sort_order`      INT NOT NULL DEFAULT 0,
  `created_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `idx_cli_lead` (`company_lead_id`),
  CONSTRAINT `fk_cli_lead` FOREIGN KEY (`company_lead_id`) REFERENCES `company_leads`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `company_lead_contacts` (
  `id`              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `tenant_id`       INT UNSIGNED NOT NULL,
  `company_lead_id` INT UNSIGNED NOT NULL,
  `first_name`      VARCHAR(120) NOT NULL,
  `last_name`       VARCHAR(120) NULL,
  `position`        VARCHAR(190) NULL,
  `email`           VARCHAR(190) NULL,
  `linkedin_url`    VARCHAR(500) NULL,
  `verified`        TINYINT(1)   NOT NULL DEFAULT 0,
  `is_primary`      TINYINT(1)   NOT NULL DEFAULT 0,
  `sort_order`      INT NOT NULL DEFAULT 0,
  `created_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `idx_clc_lead` (`company_lead_id`),
  CONSTRAINT `fk_clc_lead` FOREIGN KEY (`company_lead_id`) REFERENCES `company_leads`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
