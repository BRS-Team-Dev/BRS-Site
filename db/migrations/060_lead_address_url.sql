-- Migration 060: Add address + url to leads.
-- Mirrors the columns added to `clients` in 059 so the lead → client
-- promotion handler can copy fields verbatim.

USE `builtrightstudio_cms`;

ALTER TABLE `leads`
  ADD COLUMN `address` TEXT          NULL AFTER `phone`,
  ADD COLUMN `url`     VARCHAR(500)  NULL AFTER `company`;
