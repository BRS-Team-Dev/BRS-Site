-- Migration 098: add a "seeking" category to leads.
--
-- `leads.source` already exists (050) — tracks WHERE a lead came from (e.g.
-- 'Recruitment Website'). This adds `seeking` — WHAT the lead is after, so
-- enquiries can be triaged (e.g. a provider hiring vs a professional seeking
-- work vs a general enquiry). Free-text VARCHAR so the value set can grow
-- without a schema change.

USE `builtrightstudio_cms`;

ALTER TABLE `leads`
  ADD COLUMN `seeking` VARCHAR(120) NULL AFTER `source`;
