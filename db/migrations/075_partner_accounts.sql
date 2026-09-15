-- Migration 075: Partner accounts — login credentials / portal access /
-- billing accounts associated with a partner relationship. Mirrors the
-- `client_accounts` shape (same field names) so the UX pattern is
-- familiar across the app.

CREATE TABLE IF NOT EXISTS `partner_accounts` (
  `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `partner_id`   INT UNSIGNED NOT NULL,
  `account_name` VARCHAR(190) NOT NULL,
  `login_url`    VARCHAR(500) NULL,
  `username`     VARCHAR(190) NULL,
  `password`     VARCHAR(500) NULL,
  `sort_order`   INT NOT NULL DEFAULT 0,
  `created_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_partner` (`partner_id`),
  CONSTRAINT `fk_paccount_partner` FOREIGN KEY (`partner_id`) REFERENCES `partners`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
