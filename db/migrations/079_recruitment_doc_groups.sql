-- Migration 079: Recruitment doc-type groups.
--
-- As the doc-type catalogue grew (right-to-work, ID, financial, compliance,
-- references, …) the flat list became hard to scan. This migration adds an
-- editable `recruitment_doc_groups` table and a nullable `group_id` FK on
-- `recruitment_doc_types` so HR can organise the catalogue into collapsible
-- sections on the settings page.
--
-- `group_id` is nullable so types without a group fall into an "Ungrouped"
-- pseudo-section in the UI. `ON DELETE SET NULL` means deleting a group
-- doesn't cascade-delete its types — they just become Ungrouped.

USE `builtrightstudio_cms`;

CREATE TABLE IF NOT EXISTS `recruitment_doc_groups` (
  `id`         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `name`       VARCHAR(120) NOT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `recruitment_doc_groups` (name, sort_order) VALUES
  ('Identity',     10),
  ('Right to work',20),
  ('Financial',    30),
  ('Compliance',   40),
  ('References',   50);

ALTER TABLE `recruitment_doc_types`
  ADD COLUMN `group_id` INT UNSIGNED NULL AFTER `description`,
  ADD CONSTRAINT `fk_rdt_group` FOREIGN KEY (`group_id`)
    REFERENCES `recruitment_doc_groups`(`id`) ON DELETE SET NULL;

-- Bucket the seed types into their natural groups.
UPDATE `recruitment_doc_types` SET `group_id` = (SELECT id FROM `recruitment_doc_groups` WHERE name = 'Identity')
  WHERE name IN ('Passport / National ID', 'Proof of address');

UPDATE `recruitment_doc_types` SET `group_id` = (SELECT id FROM `recruitment_doc_groups` WHERE name = 'Right to work')
  WHERE name IN ('Right to work');

UPDATE `recruitment_doc_types` SET `group_id` = (SELECT id FROM `recruitment_doc_groups` WHERE name = 'Financial')
  WHERE name IN ('National Insurance number', 'Bank details');

UPDATE `recruitment_doc_types` SET `group_id` = (SELECT id FROM `recruitment_doc_groups` WHERE name = 'Compliance')
  WHERE name IN ('Enhanced DBS (if required)', 'CSCS card');

UPDATE `recruitment_doc_types` SET `group_id` = (SELECT id FROM `recruitment_doc_groups` WHERE name = 'References')
  WHERE name IN ('References');
