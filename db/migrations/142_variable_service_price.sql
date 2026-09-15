-- Migration 142: variable / per-attach service pricing.
--
-- 1. service_offerings.is_variable_price — when set, the catalogue
--    price is null and every attach (to a client OR lead) must supply
--    its own price. Used for bespoke work (e.g. website builds where
--    the price depends on scope).
--
-- 2. lead_services gains the same snapshot columns client_service_offerings
--    already has (price, payment_type, repeat_duration, notes), so
--    leads can hold a per-service quote without a full CSO row.
--
-- All new columns are nullable / defaulted so this migration is safe
-- to apply on live data with existing rows.

ALTER TABLE `service_offerings`
  ADD COLUMN `is_variable_price` TINYINT(1) NOT NULL DEFAULT 0 AFTER `price`;

ALTER TABLE `lead_services`
  ADD COLUMN `price`           DECIMAL(10,2) NULL AFTER `service_offering_id`,
  ADD COLUMN `payment_type`    ENUM('one_off','recurring') NOT NULL DEFAULT 'one_off' AFTER `price`,
  ADD COLUMN `repeat_duration` ENUM('weekly','monthly','quarterly','yearly') NULL AFTER `payment_type`,
  ADD COLUMN `notes`           VARCHAR(500) NULL AFTER `repeat_duration`;
