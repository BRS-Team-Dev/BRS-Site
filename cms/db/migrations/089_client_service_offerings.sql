-- Migration 087: Client ↔ catalogue-service link.
--
-- Lets a client be attached to a `service_offerings` catalogue row directly
-- (no onboarding form / project involved), surfaced on the client detail
-- Services tab alongside the onboarding-based services.
--
-- Pricing fields are SNAPSHOT at attach time (name/price/payment_type/
-- repeat_duration copied from the catalogue) so editing or deleting the
-- catalogue row later doesn't rewrite an existing client's contract. The
-- `service_offering_id` FK is kept for reference but ON DELETE SET NULL —
-- removing a catalogue service leaves the client's attached record intact.
--
-- The catalogue has no contract length, so a recurring catalogue service is
-- treated as indefinite/ongoing by GET /api/clients/:id/services; a one-off
-- is a single charge at `started_at`.

CREATE TABLE IF NOT EXISTS `client_service_offerings` (
  `id`                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id`           INT UNSIGNED NOT NULL,
  `service_offering_id` INT UNSIGNED NULL,
  `name`                VARCHAR(255) NOT NULL,
  `price`               DECIMAL(10,2) NULL,
  `payment_type`        ENUM('one_off','recurring') NOT NULL DEFAULT 'one_off',
  `repeat_duration`     ENUM('weekly','monthly','quarterly','yearly') NULL,
  `started_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_client` (`client_id`),
  KEY `idx_offering` (`service_offering_id`),
  CONSTRAINT `fk_cso_client`   FOREIGN KEY (`client_id`)           REFERENCES `clients`(`id`)           ON DELETE CASCADE,
  CONSTRAINT `fk_cso_offering` FOREIGN KEY (`service_offering_id`) REFERENCES `service_offerings`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
