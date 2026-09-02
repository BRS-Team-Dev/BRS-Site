-- 154_contractors_login.sql
--
-- Give contractors the ability to log in and see their own self-service portal.
-- Mirrors the hr_employees <-> admin_users pattern:
--   * contractors.admin_user_id -> admin_users.id (UNIQUE, NULL until login enabled)
--   * a new role 'contractor' on admin_users.role
--   * onboarding_token for a public-portal flow later (parallel to hr_employees)

-- 1. Extend admin_users.role ENUM with 'contractor'
ALTER TABLE `admin_users`
  MODIFY COLUMN `role` ENUM('admin','member','viewer','contractor') NOT NULL DEFAULT 'admin';

-- 2. Link column on contractors + onboarding token
ALTER TABLE `contractors`
  ADD COLUMN `admin_user_id`     INT UNSIGNED NULL UNIQUE AFTER `id`,
  ADD COLUMN `onboarding_token`  VARCHAR(48) NULL UNIQUE  AFTER `admin_user_id`,
  ADD CONSTRAINT `fk_contractor_user` FOREIGN KEY (`admin_user_id`)
    REFERENCES `admin_users`(`id`) ON DELETE SET NULL;
