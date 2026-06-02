-- Migration 003: Lead qualification + sidenav main-section placement.

USE `builtrightstudio_cms`;

-- Onboarding clients can be "qualified" — moves them out of the onboarding list
-- and into the form's "main section" view in the admin.
ALTER TABLE `onboarding_clients`
  ADD COLUMN `qualified_at` DATETIME NULL AFTER `submitted_at`;

-- Each onboarding form can declare:
--   - main_section_label: optional label for the qualified-clients section in
--     the sidenav (defaults to the form title if NULL).
--   - sidenav_placement: where the section appears — top-level, or nested
--     under another form's section.
--   - sidenav_parent_id: the parent form id when placement = 'child'.
ALTER TABLE `forms`
  ADD COLUMN `main_section_label` VARCHAR(190) NULL AFTER `form_type`,
  ADD COLUMN `sidenav_placement`  ENUM('top','child') NOT NULL DEFAULT 'top',
  ADD COLUMN `sidenav_parent_id`  INT UNSIGNED NULL,
  ADD CONSTRAINT `fk_form_sidenav_parent`
    FOREIGN KEY (`sidenav_parent_id`) REFERENCES `forms`(`id`) ON DELETE SET NULL;
