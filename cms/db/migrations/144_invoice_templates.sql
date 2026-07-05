-- Migration 144: user-uploaded HTML invoice templates.
--
-- Each tenant can store any number of custom templates; one is flagged
-- as default and used automatically when the Download / View PDF flow
-- doesn't specify a template. The built-in "Modern" jsPDF layout is
-- still available and used whenever no rows exist for the tenant.
--
-- HTML column is MEDIUMTEXT so a single template can carry inlined
-- styles, base64-encoded images, etc. without hitting the 65KB TEXT cap.
--
-- Variables are substituted with mustache-style placeholders — see
-- templateRender() in accounting.php for the supported keys.

CREATE TABLE IF NOT EXISTS `invoice_templates` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`   INT UNSIGNED NOT NULL,
  `name`        VARCHAR(120) NOT NULL,
  `html`        MEDIUMTEXT NOT NULL,
  `is_default`  TINYINT(1) NOT NULL DEFAULT 0,
  `created_at`  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_it_tenant` (`tenant_id`),
  CONSTRAINT `fk_it_tenant`
    FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
