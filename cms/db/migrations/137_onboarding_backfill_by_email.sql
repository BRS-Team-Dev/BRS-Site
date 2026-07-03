-- Migration 137: back-resolve onboarding_clients.parent_client_id
-- from email match, and re-run the form_submission_links backfill.
--
-- Migration 136 only linked onboarding rows that already had
-- parent_client_id set explicitly. In practice most existing rows
-- came in via the public token flow without a parent_client_id even
-- when the email matches a real client. This migration matches on
-- (tenant_id, client_email) -> clients.email so historical data
-- surfaces on the client's Onboarding tab.
--
-- We match tenant-scoped and email-lowercased for safety.

UPDATE `onboarding_clients` oc
JOIN `clients` c
  ON c.tenant_id = oc.tenant_id
 AND LOWER(c.email) = LOWER(oc.client_email)
   SET oc.parent_client_id = c.id
 WHERE oc.parent_client_id IS NULL
   AND c.email IS NOT NULL AND c.email <> '';

-- Now re-run the form_submission_links backfill for the newly-linked
-- rows. Also inherit the form's service_offering_id so submissions
-- to a service-scoped form show up on that service's Onboarding tab
-- without needing a separate link. INSERT IGNORE so any pre-existing
-- (form_id, submission_table, submission_id) row is skipped.
INSERT IGNORE INTO `form_submission_links`
  (tenant_id, form_id, submission_table, submission_id,
   client_id, service_offering_id, attach_source, linked_at)
SELECT
  oc.tenant_id, oc.form_id, 'onboarding_clients', oc.id,
  oc.parent_client_id,
  f.service_offering_id,
  'auto', COALESCE(oc.submitted_at, oc.started_at)
FROM `onboarding_clients` oc
JOIN `forms` f ON f.id = oc.form_id
WHERE oc.parent_client_id IS NOT NULL;

-- Repair any existing form_submission_links rows that were created
-- without the form's service_offering_id back before this migration.
UPDATE `form_submission_links` l
JOIN `forms` f ON f.id = l.form_id
   SET l.service_offering_id = f.service_offering_id
 WHERE l.service_offering_id IS NULL
   AND f.service_offering_id IS NOT NULL;
