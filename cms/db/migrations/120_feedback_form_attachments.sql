-- Migration 120: feedback form ↔ client / lead many-to-many junctions.
--
-- 119 added a single-value `client_id` / `lead_id` column on
-- feedback_forms — enough for the "owner" concept but wrong for the
-- "one feedback form reused across many clients" workflow the CRM
-- actually needs. These junction tables let a published form be
-- attached to any number of clients and leads without cloning it.
--
-- The legacy owner columns on feedback_forms are kept for backward
-- compat (the list-filter path falls back to them when a form has
-- no junction row).

CREATE TABLE IF NOT EXISTS `feedback_form_clients` (
  `tenant_id` INT UNSIGNED NOT NULL,
  `form_id`   INT UNSIGNED NOT NULL,
  `client_id` INT UNSIGNED NOT NULL,
  `attached_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`form_id`, `client_id`),
  KEY `idx_ffc_client`  (`client_id`),
  KEY `idx_ffc_tenant`  (`tenant_id`),
  CONSTRAINT `fk_ffc_form`   FOREIGN KEY (`form_id`)   REFERENCES `feedback_forms` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ffc_client` FOREIGN KEY (`client_id`) REFERENCES `clients` (`id`)         ON DELETE CASCADE,
  CONSTRAINT `fk_ffc_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`)         ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `feedback_form_leads` (
  `tenant_id` INT UNSIGNED NOT NULL,
  `form_id`   INT UNSIGNED NOT NULL,
  `lead_id`   INT UNSIGNED NOT NULL,
  `attached_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`form_id`, `lead_id`),
  KEY `idx_ffl_lead`   (`lead_id`),
  KEY `idx_ffl_tenant` (`tenant_id`),
  CONSTRAINT `fk_ffl_form`   FOREIGN KEY (`form_id`) REFERENCES `feedback_forms` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ffl_lead`   FOREIGN KEY (`lead_id`) REFERENCES `leads` (`id`)         ON DELETE CASCADE,
  CONSTRAINT `fk_ffl_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`)     ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
