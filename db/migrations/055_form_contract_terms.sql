-- Migration 055: Onboarding contract terms.
-- Extends the pricing fields added in 054 with payment cadence and term.
--
--   payment_type           one_off  → price is total contract value, paid once
--                          recurring → price is per-period amount
--   repeat_duration        weekly | monthly | quarterly | yearly
--                          only meaningful when payment_type='recurring'
--   contract_length_months fixed term in months for recurring contracts;
--                          NULL when is_indefinite=1
--   is_indefinite          1 → open-ended recurring contract (no fixed end)
--
-- These drive the client Services tab calculations (contract value, total
-- to date, incoming, monthly value).

USE `builtrightstudio_cms`;

ALTER TABLE `forms`
  ADD COLUMN `payment_type`           ENUM('one_off','recurring')              NOT NULL DEFAULT 'one_off' AFTER `price`,
  ADD COLUMN `repeat_duration`        ENUM('weekly','monthly','quarterly','yearly') NULL  AFTER `payment_type`,
  ADD COLUMN `contract_length_months` INT UNSIGNED                                 NULL  AFTER `repeat_duration`,
  ADD COLUMN `is_indefinite`          TINYINT(1)                            NOT NULL DEFAULT 0 AFTER `contract_length_months`;
