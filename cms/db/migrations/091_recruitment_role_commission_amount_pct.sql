-- Migration 091: richer commission tracking on recruitment roles.
--
--   commission_part_amount — when only PART of the commission has been paid,
--     how much. Defaults to half of commission_value in the UI but stored
--     explicitly so it can be any figure. Feeds "to date" on the CRM service.
--   commission_percent     — the agency's cut as a % of contract value
--     (default 12 in the UI). The "Our commission" amount is derived as
--     contract_value * percent / 100; the percent is persisted so the slider
--     reloads to where the user left it.

USE `builtrightstudio_cms`;

ALTER TABLE `recruitment_roles`
  ADD COLUMN `commission_part_amount` DECIMAL(12,2) NULL AFTER `commission_value`,
  ADD COLUMN `commission_percent`     DECIMAL(5,2)  NULL AFTER `commission_part_amount`;
