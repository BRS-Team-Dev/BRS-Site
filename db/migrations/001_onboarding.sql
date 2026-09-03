-- Migration 001: Onboarding forms support
-- Run this against an existing builtrightstudio_cms database.

USE `builtrightstudio_cms`;

-- 1. Tag existing forms as 'standard'; allow 'onboarding' going forward.
ALTER TABLE `forms`
  ADD COLUMN `form_type` ENUM('standard','onboarding') NOT NULL DEFAULT 'standard' AFTER `slug`;

-- 2. Sections group fields into ordered tabs (used only by onboarding forms).
CREATE TABLE IF NOT EXISTS `form_sections` (
  `id`          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `form_id`     INT UNSIGNED NOT NULL,
  `slug`        VARCHAR(80)  NOT NULL,
  `title`       VARCHAR(190) NOT NULL,
  `description` TEXT NULL,
  `sort_order`  INT NOT NULL DEFAULT 0,
  UNIQUE KEY `uniq_form_section_slug` (`form_id`, `slug`),
  CONSTRAINT `fk_section_form` FOREIGN KEY (`form_id`) REFERENCES `forms`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. Allow form_fields to belong to a section (NULL for standard forms).
ALTER TABLE `form_fields`
  ADD COLUMN `section_id` INT UNSIGNED NULL AFTER `form_id`,
  ADD CONSTRAINT `fk_field_section` FOREIGN KEY (`section_id`) REFERENCES `form_sections`(`id`) ON DELETE SET NULL;

-- 4. Per-client tracking for onboarding forms.
--    submission_id points at the row in the per-form `form_<slug>` table once the client first saves.
CREATE TABLE IF NOT EXISTS `onboarding_clients` (
  `id`                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `form_id`             INT UNSIGNED NOT NULL,
  `submission_id`       INT UNSIGNED NULL,
  `client_email`        VARCHAR(190) NOT NULL,
  `client_name`         VARCHAR(190) NULL,
  `client_token`        VARCHAR(64)  NOT NULL UNIQUE,
  `completed_sections`  TEXT NULL,
  `started_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_edited_at`      DATETIME NULL,
  `submitted_at`        DATETIME NULL,
  `edited_after_submit` TINYINT(1) NOT NULL DEFAULT 0,
  INDEX `idx_client_token` (`client_token`),
  CONSTRAINT `fk_client_form` FOREIGN KEY (`form_id`) REFERENCES `forms`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
