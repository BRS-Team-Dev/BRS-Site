-- Migration 085: Per-client role openings.
--
-- The original placement model collapsed two concepts into one row:
--   1. The opening at a client ("Site Manager at Sunshine Care")
--   2. The specific candidate placed/pitched for that opening
-- This left no clean way to track a single opening that multiple
-- candidates have been pitched for. Migration 085 splits them.
--
-- `recruitment_roles` represents the OPENING — created by HR once the
-- client has briefed an opportunity. It carries the target dates +
-- value / commission negotiated with the client, plus a `status`
-- workflow (open → filled | cancelled).
--
-- `recruitment_placements` gains a nullable `role_id` FK. Existing rows
-- stay role-less (the column is NULL) — they continue to read as
-- "ad-hoc" pitches that pre-date the roles concept. The frontend treats
-- a missing role_id as belonging to a synthetic "Unassigned" bucket.
--
-- ON DELETE SET NULL: deleting a role doesn't cascade-delete the
-- candidate placements that referenced it — they just become role-less.

USE `builtrightstudio_cms`;

CREATE TABLE IF NOT EXISTS `recruitment_roles` (
  `id`               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `client_id`        INT UNSIGNED NOT NULL,
  `title`            VARCHAR(190) NOT NULL,
  `description`      TEXT NULL,
  `target_start_date` DATE NULL,
  `target_end_date`   DATE NULL,
  `contract_value`   DECIMAL(12,2) NULL,
  `commission_value` DECIMAL(12,2) NULL,
  `currency`         CHAR(3) NOT NULL DEFAULT 'GBP',
  `status`           ENUM('open','filled','cancelled') NOT NULL DEFAULT 'open',
  `notes`            TEXT NULL,
  `created_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `idx_client`   (`client_id`),
  KEY `idx_status`   (`status`),
  CONSTRAINT `fk_role_client` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `recruitment_placements`
  ADD COLUMN `role_id` INT UNSIGNED NULL AFTER `client_id`,
  ADD KEY `idx_role` (`role_id`),
  ADD CONSTRAINT `fk_plc_role` FOREIGN KEY (`role_id`) REFERENCES `recruitment_roles`(`id`) ON DELETE SET NULL;
