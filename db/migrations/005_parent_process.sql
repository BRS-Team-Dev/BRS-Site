-- Migration 005: Parent process relationship.
-- An onboarding form can declare another onboarding form as its "parent process",
-- expressing that records in this form belong to / are downstream of records in
-- the parent form (e.g. a Service onboarding parented by a Client onboarding).

USE `builtrightstudio_cms`;

ALTER TABLE `forms`
  ADD COLUMN `parent_process_form_id` INT UNSIGNED NULL AFTER `sidenav_parent_key`,
  ADD CONSTRAINT `fk_form_parent_process`
    FOREIGN KEY (`parent_process_form_id`) REFERENCES `forms`(`id`) ON DELETE SET NULL;
