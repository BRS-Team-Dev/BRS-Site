-- Migration 051: Lead notes.
-- Mirrors `client_notes` so the Notes tab on a lead works identically to
-- the one on a client. Cascades on lead deletion.

USE `builtrightstudio_cms`;

CREATE TABLE IF NOT EXISTS `lead_notes` (
  `id`         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `lead_id`    INT UNSIGNED NOT NULL,
  `title`      VARCHAR(190) NOT NULL,
  `body`       TEXT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `idx_lead_notes_lead` (`lead_id`),
  CONSTRAINT `fk_lead_notes_lead`
    FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
