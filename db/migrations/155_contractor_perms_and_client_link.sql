-- 155_contractor_perms_and_client_link.sql
--
-- Contractor <-> client many-to-many + per-contractor permission flags.
-- Powers the new admin-side "Security" tab and "Assigned clients" panel,
-- and gates the /contractor/me/* endpoints on the server.

-- 1. client_contractors junction — a contractor can work on many clients,
--    a client can have many contractors. Role captures the working title
--    ("Lead dev", "Photographer", ...) shown next to the row.
CREATE TABLE `client_contractors` (
  `id`             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`      INT UNSIGNED NOT NULL,
  `client_id`      INT UNSIGNED NOT NULL,
  `contractor_id`  INT UNSIGNED NOT NULL,
  `role`           VARCHAR(120) NULL,
  `added_by`       INT UNSIGNED NULL,
  `added_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_client_contractor` (`tenant_id`, `client_id`, `contractor_id`),
  KEY `idx_cc_client`     (`tenant_id`, `client_id`),
  KEY `idx_cc_contractor` (`tenant_id`, `contractor_id`),
  CONSTRAINT `fk_cc_client`     FOREIGN KEY (`client_id`)     REFERENCES `clients`(`id`)     ON DELETE CASCADE,
  CONSTRAINT `fk_cc_contractor` FOREIGN KEY (`contractor_id`) REFERENCES `contractors`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Per-contractor permission flags — checkboxes on the Security tab.
--    Enforced in routes/contractor_me.php on every relevant endpoint.
--    Defaults keep the current MVP behaviour: view own docs/contracts on,
--    everything else off until an admin ticks it.
ALTER TABLE `contractors`
  ADD COLUMN `perm_view_clients`     TINYINT(1) NOT NULL DEFAULT 0 AFTER `notes`,
  ADD COLUMN `perm_view_tasks`       TINYINT(1) NOT NULL DEFAULT 0 AFTER `perm_view_clients`,
  ADD COLUMN `perm_view_invoices`    TINYINT(1) NOT NULL DEFAULT 0 AFTER `perm_view_tasks`,
  ADD COLUMN `perm_upload_documents` TINYINT(1) NOT NULL DEFAULT 0 AFTER `perm_view_invoices`,
  ADD COLUMN `perm_edit_profile`     TINYINT(1) NOT NULL DEFAULT 1 AFTER `perm_upload_documents`;
