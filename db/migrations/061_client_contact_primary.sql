-- Migration 061: Primary contact on each client.
-- The client info card now pulls Name/Email/Phone from the primary contact
-- rather than the legacy `clients.name/email/phone` columns. Those legacy
-- columns stay (no breaking changes) but become initial-creation fallbacks.
--
-- Backfill creates primary contacts from existing client rows so no client
-- ends up without one. For clients that already have contacts but no
-- primary flagged, the earliest contact (lowest id) becomes the primary.

USE `builtrightstudio_cms`;

-- 1. New flag column.
ALTER TABLE `client_contacts`
  ADD COLUMN `is_primary` TINYINT(1) NOT NULL DEFAULT 0 AFTER `verified`;

-- 2. For each client with NO contacts, create one from clients.name/email,
--    splitting "John Doe" → first/last name.
INSERT INTO `client_contacts` (client_id, first_name, last_name, email, is_primary, sort_order)
SELECT
  c.id,
  CASE
    WHEN INSTR(c.name, ' ') > 0 THEN TRIM(SUBSTRING_INDEX(c.name, ' ', 1))
    ELSE c.name
  END,
  CASE
    WHEN INSTR(c.name, ' ') > 0 THEN TRIM(SUBSTRING(c.name, INSTR(c.name, ' ') + 1))
    ELSE NULL
  END,
  c.email,
  1,
  0
FROM `clients` c
WHERE NOT EXISTS (SELECT 1 FROM `client_contacts` cc WHERE cc.client_id = c.id);

-- 3. Carry the legacy phone over as a contact_number on the new primary
--    contacts (skip if the contact already has any numbers).
INSERT INTO `client_contact_numbers` (contact_id, number, label, sort_order)
SELECT cc.id, c.phone, 'mobile', 0
FROM `client_contacts` cc
JOIN `clients` c ON c.id = cc.client_id
WHERE cc.is_primary = 1
  AND c.phone IS NOT NULL AND c.phone <> ''
  AND NOT EXISTS (
    SELECT 1 FROM `client_contact_numbers` ccn WHERE ccn.contact_id = cc.id
  );

-- 4. For clients that already had contacts but no primary, promote the
--    earliest-id contact to primary.
UPDATE `client_contacts` cc
JOIN (
  SELECT client_id, MIN(id) AS first_id
  FROM `client_contacts`
  GROUP BY client_id
) firsts ON firsts.first_id = cc.id
LEFT JOIN (
  SELECT DISTINCT client_id FROM `client_contacts` WHERE is_primary = 1
) has_primary ON has_primary.client_id = cc.client_id
SET cc.is_primary = 1
WHERE has_primary.client_id IS NULL;
