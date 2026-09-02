-- Migration 152: phone column on company_lead_contacts.
--
-- Pipeline contacts (directors + LinkedIn staff) get a `phone` slot alongside
-- email + linkedin_url, so the detail card shows a consistent field set and a
-- future enrichment stage has somewhere to write a per-person number.
-- Companies House itself never returns officer phone numbers, so it stays NULL
-- until a people-data stage populates it. On promote it carries into a
-- lead_contact_numbers row.

USE `builtrightstudio_cms`;

ALTER TABLE `company_lead_contacts`
  ADD COLUMN `phone` VARCHAR(80) NULL AFTER `email`;
