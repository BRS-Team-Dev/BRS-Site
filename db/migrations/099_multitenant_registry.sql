-- Migration 099: Multi-tenant foundations.
--
-- Introduces the four registry tables that make tenant-per-row routing
-- work, seeds them with the BRS tenant + its two email domains + Bobby
-- as the super-admin, then cleans up the legacy Gmail admin account
-- that wouldn't fit the new email-domain → tenant resolution model.
--
-- The actual `tenant_id` column rollout across the 110 user-data tables
-- happens in migrations 100-106. Migration 107 then tightens the unique
-- indexes that need to be per-tenant. This migration is intentionally
-- self-contained so it can be applied without touching any existing
-- query path — the app keeps working unchanged after 099 because no
-- code reads from these tables yet.
--
-- Registry tables (NOT tenant-scoped — they ARE the tenancy registry):
--   tenants               One row per company on this codebase.
--                         Holds display info + soft-delete status.
--   tenant_email_domains  N:1 → tenants. Email-domain → tenant lookup
--                         driven at login from the part after '@'.
--   super_admins          Cross-tenant accounts. Currently only Bobby.
--                         These emails see the tenant-switcher UI +
--                         can impersonate any tenant.
--   super_action_log      Append-only audit of every super-admin
--                         impersonation + sensitive action. Retained
--                         indefinitely per ops decision.

CREATE TABLE IF NOT EXISTS `tenants` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `slug`       VARCHAR(60)  NOT NULL,
  `brand_name` VARCHAR(160) NOT NULL,
  -- 'provisioning' = being set up, login refused
  -- 'active'       = normal
  -- 'suspended'    = login refused, existing tokens killed instantly
  --                  via the APCu killset (see lib/Tenants.php once
  --                  Phase 2 lands)
  -- 'deleted'      = soft delete; data retained for restoration.
  --                  Same access semantics as suspended.
  `status`     ENUM('provisioning','active','suspended','deleted')
                            NOT NULL DEFAULT 'provisioning',
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME     NULL,
  UNIQUE KEY `uk_tenant_slug` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tenant_email_domains` (
  -- The email domain IS the lookup key — login extracts the part after
  -- '@' and finds the tenant via this row. Domain uniqueness is global
  -- across all tenants by design: a user with email a@brs.com can only
  -- belong to one tenant (BRS). If a company owns multiple domains they
  -- add multiple rows pointing at the same tenant_id.
  `domain`     VARCHAR(190) NOT NULL,
  `tenant_id`  INT UNSIGNED NOT NULL,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`domain`),
  KEY `idx_tenant` (`tenant_id`),
  CONSTRAINT `fk_ted_tenant`
    FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `super_admins` (
  `email`          VARCHAR(190) NOT NULL,
  -- Where the actual admin_users row + password live. Super-admin
  -- accounts are real users in their home tenant; "super" is a
  -- promotion, not a parallel identity.
  `home_tenant_id` INT UNSIGNED NOT NULL,
  `created_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`email`),
  KEY `idx_home_tenant` (`home_tenant_id`),
  CONSTRAINT `fk_super_home_tenant`
    FOREIGN KEY (`home_tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `super_action_log` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `super_email`   VARCHAR(190) NOT NULL,
  `action`        VARCHAR(60)  NOT NULL,    -- 'impersonate','suspend','activate','provision','restore',…
  `target_tenant` INT UNSIGNED NULL,
  `from_tenant`   INT UNSIGNED NULL,        -- previous tenant when impersonating
  `ip`            VARCHAR(45)  NULL,
  `user_agent`    VARCHAR(255) NULL,
  `detail`        TEXT         NULL,        -- free-form JSON for action-specific extras
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_super_email`   (`super_email`),
  KEY `idx_action`        (`action`),
  KEY `idx_target_tenant` (`target_tenant`),
  KEY `idx_created_at`    (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Seed BRS as tenant id 1 ──────────────────────────────────────
-- Migrations 100-106 will backfill every existing user-data row with
-- this tenant_id. Hardcoding 1 makes the rest of the migration sequence
-- deterministic — schema_migrations is fresh and tenants is empty, so
-- AUTO_INCREMENT starts at 1.
INSERT INTO `tenants` (id, slug, brand_name, status)
VALUES (1, 'brs', 'BuiltRightStudio', 'active');

INSERT INTO `tenant_email_domains` (domain, tenant_id) VALUES
  ('brs.com',              1),
  ('builtrightstudio.com', 1);

INSERT INTO `super_admins` (email, home_tenant_id) VALUES
  ('bobby.jackson@builtrightstudio.com', 1);

-- ── Remove the legacy Gmail admin ────────────────────────────────
-- uwana89@gmail.com is the project owner's personal account. It
-- doesn't fit the email-domain → tenant model (gmail.com would route
-- every Gmail address into BRS, which is wrong), so it gets removed
-- as part of the cutover. The leads.added_by_user_id FK we added in
-- migration 098 is ON DELETE SET NULL, so any historical rows attributed
-- to this user are preserved with NULL author + the system flag
-- already covers them.
DELETE FROM `admin_users` WHERE email = 'uwana89@gmail.com';
