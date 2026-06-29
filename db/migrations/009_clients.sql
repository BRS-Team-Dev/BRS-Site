-- Migration 009: Standalone clients table.
-- A first-class CMS section for managing client records, completely independent
-- of any form or onboarding template.

USE `builtrightstudio_cms`;

CREATE TABLE IF NOT EXISTS `clients` (
  `id`         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `name`       VARCHAR(190) NOT NULL,
  `email`      VARCHAR(190) NULL,
  `phone`      VARCHAR(80)  NULL,
  `company`    VARCHAR(190) NULL,
  `notes`      TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_clients_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
