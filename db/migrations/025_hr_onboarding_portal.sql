-- Migration 025: Employee onboarding portal — unique token + per-section progress.

USE `builtrightstudio_cms`;

ALTER TABLE `hr_employees`
    ADD COLUMN `onboarding_token`         VARCHAR(48) NULL UNIQUE AFTER `admin_user_id`,
    ADD COLUMN `onboarding_progress_json` JSON NULL AFTER `pto_accrued_days`,
    ADD COLUMN `onboarding_completed_at`  DATETIME NULL AFTER `onboarding_progress_json`;

-- Backfill tokens for existing rows so existing employees can use the portal.
UPDATE `hr_employees`
SET `onboarding_token` = SUBSTRING(SHA2(CONCAT(id, UUID(), RAND()), 256), 1, 32)
WHERE `onboarding_token` IS NULL;
