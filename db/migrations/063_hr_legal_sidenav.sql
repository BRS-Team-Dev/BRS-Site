-- Migration 063: Sidenav placement + parent for legal documents.
--
-- New columns on hr_legal_documents:
--   show_in_sidenav  — toggle whether the doc appears in the public /legal
--                      sidenav. Defaults to 1 so existing rows show up.
--   parent_id        — self-FK; sub-policies live under a parent in the
--                      sidenav tree (e.g. "Cookie Policy" under
--                      "Other Policies"). ON DELETE SET NULL so deleting
--                      a parent flattens its children rather than wiping
--                      them.
--
-- Cycle prevention is enforced on the frontend (parent dropdown excludes
-- the doc itself + its descendants).

USE `builtrightstudio_cms`;

ALTER TABLE `hr_legal_documents`
    ADD COLUMN `show_in_sidenav` TINYINT(1) NOT NULL DEFAULT 1 AFTER `is_published`,
    ADD COLUMN `parent_id`       INT UNSIGNED NULL              AFTER `show_in_sidenav`,
    ADD KEY `idx_legal_parent` (`parent_id`),
    ADD CONSTRAINT `fk_legal_parent`
        FOREIGN KEY (`parent_id`) REFERENCES `hr_legal_documents`(`id`) ON DELETE SET NULL;
