-- Migration 112: per-user colour-theme override.
--
-- Until now `tenants.color_theme` was the only source of truth — every
-- user on a tenant saw the same palette. This migration adds an
-- optional `admin_users.color_theme` column so individuals can opt
-- out of the org default and pick one of the six palettes for their
-- own login.
--
-- Resolution order (enforced in the frontend ThemeService):
--   1. admin_users.color_theme (per-user)  → preferred when set
--   2. tenants.color_theme    (tenant default) → fallback
--   3. 'midnight-gold' (built-in default) → if neither is set
--
-- NULL means "use the tenant default", so the column is optional.
-- The picker on /admin/settings writes the tenant row; the picker on
-- /me/account writes this column. Same six slugs; same six CSS blocks
-- in styles.scss.

ALTER TABLE `admin_users`
  ADD COLUMN `color_theme` VARCHAR(60) NULL AFTER `is_active`;
