-- Migration 082: New candidate pipeline statuses.
--
-- Replaces the original 7-state enum with an 8-state set that distinguishes
-- WHO rejected (us vs the client) and adds a "client_screening" stage for
-- the period between us marking the candidate compliant and the client
-- making a hire decision.
--
-- Old → new mapping (data is preserved, not dropped):
--   screening  → interviewing
--   onboarding → processing
--   available  → compliant
--   rejected   → rejected_by_us  (the agency rejected them)
--   inactive   → rejected_by_us  (also our decision; merged with rejected)
--   new        → new             (unchanged)
--   placed     → placed          (unchanged)
--
-- The mapping is opinionated — these were the closest fits to the new
-- vocabulary. If a row was sitting in "available" but had already been
-- pitched to a client, it lands in "compliant" rather than the new
-- "client_screening" state; that's a manual cleanup after the migration.
--
-- We hop through a VARCHAR temporarily because MySQL refuses to UPDATE
-- a column to a value not in the current ENUM, and refuses to ALTER the
-- ENUM if existing rows hold values not in the new set. Round-trip via
-- VARCHAR sidesteps both checks.

USE `builtrightstudio_cms`;

ALTER TABLE `recruitment_candidates`
  MODIFY COLUMN `status` VARCHAR(40) NOT NULL DEFAULT 'new';

UPDATE `recruitment_candidates` SET `status` = 'interviewing'   WHERE `status` = 'screening';
UPDATE `recruitment_candidates` SET `status` = 'processing'     WHERE `status` = 'onboarding';
UPDATE `recruitment_candidates` SET `status` = 'compliant'      WHERE `status` = 'available';
UPDATE `recruitment_candidates` SET `status` = 'rejected_by_us' WHERE `status` IN ('rejected','inactive');

ALTER TABLE `recruitment_candidates`
  MODIFY COLUMN `status` ENUM(
    'new',
    'interviewing',
    'processing',
    'compliant',
    'client_screening',
    'placed',
    'rejected_by_client',
    'rejected_by_us'
  ) NOT NULL DEFAULT 'new';
