-- 159_site_previews.sql
--
-- Backing store for the marketing site's `site-view.html` preview
-- page (main-website/site-view.html). One row per client site the
-- tenant wants to showcase. Slug is the URL id used in
--   /site-view.html?site=<slug>
-- Public read endpoint is /api/public-site-preview/:slug — served
-- with a tenant scope resolved from the marketing site's tenant
-- (BRS by default).
--
-- Fields split across scalar columns (name / slug / category) and
-- JSON blobs for the composed groups (feature, mockup) so we can
-- add fields to each group later without another migration.

CREATE TABLE `site_previews` (
  `id`               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`        INT UNSIGNED NOT NULL,
  `slug`             VARCHAR(80)  NOT NULL,
  `name`             VARCHAR(190) NOT NULL,
  `category`         VARCHAR(120) NULL,
  `feature_json`     JSON NULL,
  `mockup_json`      JSON NULL,
  `fullvideo`        VARCHAR(500) NULL,
  `fullimage`        VARCHAR(500) NULL,
  `is_published`     TINYINT(1) NOT NULL DEFAULT 1,
  `created_by_user_id` INT UNSIGNED NULL,
  `created_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_site_previews_tenant_slug` (`tenant_id`, `slug`),
  KEY `idx_site_previews_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
