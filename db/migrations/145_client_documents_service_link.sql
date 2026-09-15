-- Migration 145: link a client contract to a specific service.
--
-- When admin attaches a contract from Settings → Contracts to a client,
-- they can now say "this NDA applies to the Website build service"
-- instead of just "this NDA applies to the client". The service row on
-- the Services tab then surfaces a contract chip and the client's
-- Contracts tab shows which service each contract is bound to.
--
-- Column is nullable — most contracts are still client-wide, and
-- ON DELETE SET NULL means removing a service leaves the contract in
-- place (just detached) rather than cascading it away.

ALTER TABLE `client_documents`
  ADD COLUMN `client_service_offering_id` INT UNSIGNED NULL AFTER `client_id`,
  ADD KEY `idx_cd_cso` (`client_service_offering_id`),
  ADD CONSTRAINT `fk_cd_cso`
    FOREIGN KEY (`client_service_offering_id`) REFERENCES `client_service_offerings` (`id`)
    ON DELETE SET NULL;
