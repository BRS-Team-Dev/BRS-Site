-- Migration 007: Independent top-level sidenav section.
-- A form can declare itself as a standalone top-level sidenav entry, separate
-- from where it lives within Onboarding/Forms grouping.

USE `builtrightstudio_cms`;

ALTER TABLE `forms`
  ADD COLUMN `show_in_sidenav_root` TINYINT(1) NOT NULL DEFAULT 0
  AFTER `parent_process_form_id`;
