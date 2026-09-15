-- 156_admin_users_must_change_password.sql
--
-- Force a password change on next login. Set to 1 by any path that
-- hands out a temp password (contractor enable / reset, employee
-- create, admin-issued reset). Cleared when the user picks their own
-- password via /auth/change-password or /auth/reset-password.

ALTER TABLE `admin_users`
  ADD COLUMN `must_change_password` TINYINT(1) NOT NULL DEFAULT 0 AFTER `is_active`;
