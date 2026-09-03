-- Migration 128: user management + subscription tier + user cap.
--
-- Adds:
--   admin_users.deleted_at  — separates soft-delete (hard remove from
--     lists, preserves FKs) from is_active=0 (deactivate — still in
--     the user list, greyed out, easily reinstated)
--
--   tenants.subscription_tier — enum matching the memory-noted GTM
--     ladder: trial → starter → growth → scale → enterprise.
--     Growth (5-10 users) is the primary offer per project notes.
--
-- User-cap enforcement lives in the backend (routes/users.php) and
-- reads the tier ↔ max_active_users map from a constant in Config.
-- Enterprise is unlimited.

ALTER TABLE `admin_users`
  ADD COLUMN `deleted_at` DATETIME NULL AFTER `is_active`;

ALTER TABLE `tenants`
  ADD COLUMN `subscription_tier`
    ENUM('trial','starter','growth','scale','enterprise')
    NOT NULL DEFAULT 'trial' AFTER `status`;

-- Grandfather all existing tenants — a fresh tenant starts on trial,
-- but existing ones during rollout get bumped to 'growth' so we don't
-- immediately break sign-in for active teams.
UPDATE `tenants` SET `subscription_tier` = 'growth' WHERE `subscription_tier` = 'trial';
