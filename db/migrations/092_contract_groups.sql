-- Migration 092: groups for contract templates (Operations → Contracts).
--
-- Mirrors the recruitment doc-groups pattern (079): a lookup table + a
-- nullable group_id FK on hr_document_types. Lets HR bucket contract
-- templates (e.g. "Employment", "Client agreements", "NDAs") into collapsible
-- sections. ON DELETE SET NULL — deleting a group leaves its contracts intact
-- (they fall back to the in-memory "Ungrouped" section).
--
-- group_id lives on the shared hr_document_types table but is only surfaced in
-- the Contracts (kind='contract') UI for now.

USE `builtrightstudio_cms`;

CREATE TABLE IF NOT EXISTS `hr_contract_groups` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`       VARCHAR(190) NOT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_sort` (`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `hr_document_types`
  ADD COLUMN `group_id` INT UNSIGNED NULL AFTER `contract_type_id`,
  ADD KEY `idx_group` (`group_id`),
  ADD CONSTRAINT `fk_doctype_group` FOREIGN KEY (`group_id`)
      REFERENCES `hr_contract_groups`(`id`) ON DELETE SET NULL;
