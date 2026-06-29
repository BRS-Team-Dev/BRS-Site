-- Migration 090: link a client_service_offerings row to a recruitment role.
--
-- The Recruitment service is 1:1 with a recruitment_roles opening: every role
-- shows as its own "Recruitment" service row on the CRM client Services tab,
-- and adding the service in the CRM spawns a role. `role_id` ties the two.
--
-- ON DELETE CASCADE: deleting a role removes its mirror service row
-- automatically. Non-recruitment catalogue services leave `role_id` NULL.

ALTER TABLE `client_service_offerings`
  ADD COLUMN `role_id` INT UNSIGNED NULL AFTER `service_offering_id`,
  ADD KEY `idx_role` (`role_id`),
  ADD CONSTRAINT `fk_cso_role` FOREIGN KEY (`role_id`)
      REFERENCES `recruitment_roles`(`id`) ON DELETE CASCADE;
