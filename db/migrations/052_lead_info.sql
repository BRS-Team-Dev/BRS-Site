-- Migration 052: Lead info entries.
-- Free-form name/value pairs attached to a lead, displayed in the Info tab
-- of the lead detail view. Cascades on lead deletion.

USE `builtrightstudio_cms`;

CREATE TABLE IF NOT EXISTS `lead_info` (
  `id`         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `lead_id`    INT UNSIGNED NOT NULL,
  `name`       VARCHAR(190) NOT NULL,
  `value`      TEXT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `idx_lead_info_lead` (`lead_id`),
  CONSTRAINT `fk_lead_info_lead`
    FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
