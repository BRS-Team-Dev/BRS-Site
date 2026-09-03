-- Migration 150: LinkedIn URL on client_contacts + lead_contacts.
--
-- Adds a `linkedin_url` VARCHAR(500) NULL column to both contact tables
-- so the Contacts tab on Clients + Leads can store a per-contact
-- LinkedIn profile URL alongside email / phone / position. Nullable —
-- existing contacts stay untouched.
--
-- 500 chars covers arbitrary LinkedIn URLs including tracking / regional
-- prefixes. No index — we don't query by URL, just read it back on the
-- contact card.

ALTER TABLE `client_contacts`
  ADD COLUMN `linkedin_url` VARCHAR(500) NULL AFTER `email`;

ALTER TABLE `lead_contacts`
  ADD COLUMN `linkedin_url` VARCHAR(500) NULL AFTER `email`;
