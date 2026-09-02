-- Migration 149: Companies House lead-enrichment pipeline columns on `leads`.
--
-- Company leads pulled from Companies House land directly in `leads` and move
-- through a 5-stage enrichment machine, each stage triggered by its own button:
--   1 company data (name / number / address / SIC)   [Companies House]
--   2 officers / directors                            [Companies House]
--   3 LinkedIn / Google Business profiles             [crawler, later]
--   4 main business contact (email / phone)           [crawler, later]
--   5 individual staff contacts                       [crawler, later]
--
-- `stage` is NULL for every non-pipeline lead (manual / bulk / AI imports);
-- a value 1..5 marks a Companies House pipeline lead and how far it has been
-- enriched. `company_number` is the Companies House registration number and
-- the natural dedupe key, unique per tenant so a re-run never re-inserts a
-- company already captured. `stage_updated_at` records when the stage last
-- advanced (drives progress ordering and "last enriched" display).

USE `builtrightstudio_cms`;

ALTER TABLE `leads`
  ADD COLUMN `company_number`   VARCHAR(20)      NULL AFTER `company`,
  ADD COLUMN `stage`            TINYINT UNSIGNED NULL AFTER `status`,
  ADD COLUMN `stage_updated_at` DATETIME         NULL AFTER `stage`;

-- Dedupe key: at most one lead per (tenant, company_number). MySQL allows
-- multiple NULLs in a UNIQUE index, so non-pipeline leads (company_number
-- IS NULL) are unaffected and never collide.
ALTER TABLE `leads`
  ADD UNIQUE KEY `uk_leads_tenant_company_number` (`tenant_id`, `company_number`);

-- Filter the leads list by pipeline stage quickly.
ALTER TABLE `leads`
  ADD KEY `idx_leads_stage` (`stage`);
