-- Migration 054: Onboarding form pricing.
-- Adds an optional price tag to a form. `has_price` toggles whether the
-- form should be treated as paid; `price` carries the monetary amount.
-- Lives on the shared `forms` table; the onboarding builder is the only
-- UI surface that exposes it for now.

USE `builtrightstudio_cms`;

ALTER TABLE `forms`
  ADD COLUMN `has_price` TINYINT(1)    NOT NULL DEFAULT 0 AFTER `is_published`,
  ADD COLUMN `price`     DECIMAL(10,2)     NULL           AFTER `has_price`;
