-- Migration 053: Client info entries.
-- Free-form name/value pairs attached to a client, displayed in the Info tab
-- of the client detail view. Mirrors `lead_info` exactly so a future
-- promotion-with-info-copy is a 1:1 row copy. Cascades on client deletion.

USE `builtrightstudio_cms`;

CREATE TABLE IF NOT EXISTS `client_info` (
  `id`         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `client_id`  INT UNSIGNED NOT NULL,
  `name`       VARCHAR(190) NOT NULL,
  `value`      TEXT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `idx_client_info_client` (`client_id`),
  CONSTRAINT `fk_client_info_client`
    FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
