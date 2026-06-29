-- Migration 078: Recruitment doc-type options + info-only submissions.
--
-- Existing settings page had four toggles (required / needs-reference /
-- needs-issue-date / needs-expiry-date) plus an implicit "always upload
-- a file" assumption. This migration generalises both:
--
-- 1. `recruitment_doc_types` gains:
--    - `needs_issuing_body`  — collect WHO issued the document
--                              (Home Office, DVLA, etc.)
--    - `add_to_onboarding`   — split from `is_required`. Was previously
--                              conflated ("required gates onboarding").
--                              Now any doc type can be present in the
--                              onboarding checklist independently of
--                              whether it's required to complete it.
--    - `submission_type`     — 'file' (default) = candidate uploads a
--                              real file; 'info_only' = no file, just
--                              metadata (dates / reference / issuing body).
--
-- 2. `recruitment_candidate_documents`:
--    - `issuing_body`        — captured value
--    - `file_path`           — relaxed to NULL so info-only entries can
--                              be persisted without a file on disk.
--
-- Backfill: every existing doc-type was previously fanned through the
-- "required = on the checklist" UI, so `add_to_onboarding` defaults
-- TRUE on existing rows to preserve behaviour. The new column defaults
-- FALSE for fresh rows so the agency can mark internal-only doc types
-- (e.g. signed agency NDA) without surfacing them in onboarding.

USE `builtrightstudio_cms`;

-- 1. Doc-type options ---------------------------------------------------
ALTER TABLE `recruitment_doc_types`
  ADD COLUMN `needs_issuing_body` TINYINT(1) NOT NULL DEFAULT 0 AFTER `needs_expiry_date`,
  ADD COLUMN `add_to_onboarding`  TINYINT(1) NOT NULL DEFAULT 1 AFTER `is_required`,
  ADD COLUMN `submission_type`    ENUM('file','info_only') NOT NULL DEFAULT 'file' AFTER `add_to_onboarding`;

-- Two of the existing types are usually captured as info-only in agencies
-- (no file uploaded — HR records the value):
UPDATE `recruitment_doc_types` SET `submission_type` = 'info_only'
  WHERE name IN ('National Insurance number','Bank details');

-- 2. Candidate doc rows -------------------------------------------------
ALTER TABLE `recruitment_candidate_documents`
  ADD COLUMN `issuing_body` VARCHAR(190) NULL AFTER `reference_number`,
  MODIFY COLUMN `file_path`  VARCHAR(500) NULL;
