-- Migration 004: Allow built-in groups (forms, onboarding) as sidenav parents.
-- Replaces the integer FK with a string key so values can be 'forms',
-- 'onboarding', or a numeric form id (as a string).

USE `builtrightstudio_cms`;

ALTER TABLE `forms` DROP FOREIGN KEY `fk_form_sidenav_parent`;
ALTER TABLE `forms`
  CHANGE COLUMN `sidenav_parent_id` `sidenav_parent_key` VARCHAR(40) NULL;
