-- Migration 095: "Add to onboarding" flag for contract templates.
--
-- Mirrors recruitment_doc_types.add_to_onboarding (078): when set, the contract
-- is surfaced in its class's onboarding flow. Currently wired for the EMPLOYEE
-- class — flagged employee contracts appear in the new-hire HR onboarding
-- portal's "Documents to sign" step (they were previously only in the
-- employee's Documents tab). Default 0 (opt-in) so existing contracts don't
-- suddenly appear mid-onboarding.

USE `builtrightstudio_cms`;

ALTER TABLE `hr_document_types`
  ADD COLUMN `add_to_onboarding` TINYINT(1) NOT NULL DEFAULT 0 AFTER `group_id`;
