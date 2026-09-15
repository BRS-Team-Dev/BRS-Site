-- Migration 059: Add address + url to clients.
-- Both nullable so existing rows don't need backfill. Address is TEXT
-- so multi-line postal addresses paste in cleanly; url is a varchar
-- since they tend to be single-line.

USE `builtrightstudio_cms`;

ALTER TABLE `clients`
  ADD COLUMN `address` TEXT          NULL AFTER `phone`,
  ADD COLUMN `url`     VARCHAR(500)  NULL AFTER `company`;
