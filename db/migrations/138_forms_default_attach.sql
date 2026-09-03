-- Migration 138: forms can pin a default client or lead the way they
-- already pin a service via service_offering_id.
--
-- When set, every submission to the form auto-links to that record
-- (client_id or lead_id) unless the public URL carries an explicit
-- attach_client_id / attach_lead_id override. Same shape as the
-- service_offering_id linkage added in migration 132.

ALTER TABLE `forms`
  ADD COLUMN `default_attach_client_id` INT UNSIGNED NULL AFTER `service_offering_id`,
  ADD COLUMN `default_attach_lead_id`   INT UNSIGNED NULL AFTER `default_attach_client_id`,
  ADD KEY `idx_forms_default_client` (`default_attach_client_id`),
  ADD KEY `idx_forms_default_lead`   (`default_attach_lead_id`),
  ADD CONSTRAINT `fk_forms_default_client`
    FOREIGN KEY (`default_attach_client_id`) REFERENCES `clients` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_forms_default_lead`
    FOREIGN KEY (`default_attach_lead_id`)   REFERENCES `leads`   (`id`) ON DELETE SET NULL;
