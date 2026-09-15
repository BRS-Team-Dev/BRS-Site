-- Migration 086: Service offerings — a standalone catalogue of the services
-- the company sells, surfaced on the CRM Services page (/admin/services).
--
-- This is deliberately NOT an onboarding template. Onboarding forms attached
-- to the Services sidenav group are a separate concept (an intake process);
-- `service_offerings` is a plain catalogue row — a name, blurb and price — so
-- the team can list what they offer without building a whole form.
--
-- Pricing fields mirror the `forms` pricing model naming (payment_type /
-- repeat_duration) so the two stay consistent if a future change links a
-- catalogue service to an onboarding process.

CREATE TABLE IF NOT EXISTS `service_offerings` (
  `id`              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`            VARCHAR(255) NOT NULL,
  `description`     TEXT NULL,
  `price`           DECIMAL(10,2) NULL,
  `currency`        CHAR(3) NOT NULL DEFAULT 'GBP',
  `payment_type`    ENUM('one_off','recurring') NOT NULL DEFAULT 'one_off',
  `repeat_duration` ENUM('weekly','monthly','quarterly','yearly') NULL,
  `is_active`       TINYINT(1) NOT NULL DEFAULT 1,
  `sort_order`      INT NOT NULL DEFAULT 0,
  `created_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_active_sort` (`is_active`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
