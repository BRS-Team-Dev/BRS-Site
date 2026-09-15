-- Migration 126: per-tenant custom themes.
--
-- The Settings → Appearance tab ships 6 built-in presets (Midnight Gold,
-- Frosted Mint, Sunrise Coral, Indigo Pulse, Graphite Rose, Forest
-- Amber). This table lets tenants create their own by populating the
-- same CSS variables the presets use.
--
-- `vars_json` stores the full variable map as JSON — e.g.
--   { "--bg":"#0a0a0a", "--primary":"#d4a93a", "--fg":"#ffffff", ... }
-- The frontend applier injects a <style> element setting the vars on
-- :root when the active theme is a custom slug (theme name starts with
-- 'custom-'). Frontend also caches the list in localStorage keyed by
-- `updated_at` so we don't hit the API on every page load.

CREATE TABLE IF NOT EXISTS `tenant_themes` (
  `id`                 INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `tenant_id`          INT UNSIGNED NOT NULL,
  `slug`               VARCHAR(64)  NOT NULL COMMENT 'Unique per tenant. UI enforces `custom-` prefix.',
  `label`              VARCHAR(120) NOT NULL,
  `mood`               VARCHAR(60)  NULL COMMENT 'e.g. "Dark · Bold" — shown under the label on the picker card.',
  `vars_json`          TEXT NOT NULL COMMENT 'JSON object mapping CSS variable name to hex/color value.',
  `created_by_user_id` INT UNSIGNED NULL,
  `created_at`         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_tt_slug` (`tenant_id`, `slug`),
  KEY `idx_tt_tenant` (`tenant_id`),
  CONSTRAINT `fk_tt_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
