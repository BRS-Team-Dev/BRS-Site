-- Migration 050: Leads table.
-- Potential clients captured before they become first-class clients.
-- Fields mirror `clients` exactly so promotion can copy values 1:1, plus
-- a status workflow and a back-reference to the resulting client row when
-- a lead is promoted.

USE `builtrightstudio_cms`;

CREATE TABLE IF NOT EXISTS `leads` (
  `id`                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `name`                VARCHAR(190) NOT NULL,
  `email`               VARCHAR(190) NULL,
  `phone`               VARCHAR(80)  NULL,
  `company`             VARCHAR(190) NULL,
  `notes`               TEXT NULL,
  `status`              ENUM('new','contacted','qualified','converted','rejected')
                          NOT NULL DEFAULT 'new',
  `source`              VARCHAR(120) NULL,
  `promoted_client_id`  INT UNSIGNED NULL,
  `promoted_at`         DATETIME NULL,
  `created_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_leads_email`  (`email`),
  INDEX `idx_leads_status` (`status`),
  CONSTRAINT `fk_leads_client`
    FOREIGN KEY (`promoted_client_id`) REFERENCES `clients`(`id`)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
