-- Migration 111: lead_services junction.
--
-- Leads can now be tagged with one or more services from the
-- service_offerings catalogue. This is a thin junction — no price /
-- payment-type snapshot — because at the lead stage we're only
-- expressing "what is this prospect interested in?" The full
-- snapshot-and-bill pattern stays on `client_service_offerings`,
-- which gets populated when the lead is promoted to a client.
--
-- The legacy single-FK `leads.service_offering_id` column is retained
-- for now: the promote handler reads it as "primary service of
-- interest." A future migration may collapse it once every promote
-- path reads from `lead_services` instead.
--
-- UNIQUE (lead_id, service_offering_id) enforces "no duplicates" so
-- the UI's de-dup logic is a friendly bonus, not a correctness
-- requirement. Cascades on both sides so deletes don't leak.

CREATE TABLE IF NOT EXISTS `lead_services` (
  `id`                  INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `tenant_id`           INT UNSIGNED NOT NULL,
  `lead_id`             INT UNSIGNED NOT NULL,
  `service_offering_id` INT UNSIGNED NOT NULL,
  `created_at`          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_lead_service` (`lead_id`, `service_offering_id`),
  KEY `idx_lead`    (`lead_id`),
  KEY `idx_service` (`service_offering_id`),
  KEY `idx_lead_services_tenant` (`tenant_id`),
  CONSTRAINT `fk_lead_services_lead`
    FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_lead_services_offering`
    FOREIGN KEY (`service_offering_id`) REFERENCES `service_offerings`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_lead_services_tenant`
    FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
