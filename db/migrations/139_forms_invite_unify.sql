-- Migration 139: rip out the wrong-pattern `default_attach_*` pins on
-- forms (added in migration 138 — reversed here) and instead extend
-- the existing invite/token pattern that already powers multipart
-- onboarding so it works for standard forms + leads too.
--
-- Established pattern (unchanged): admin invites a specific person to
-- fill out a form. Backend creates an `onboarding_clients` row with a
-- random client_token; recipient uses the tokenised URL to submit;
-- submission auto-links to the client (parent_client_id) on save.
--
-- What this migration changes:
--   1. Drop `forms.default_attach_client_id` + `default_attach_lead_id`
--      (permanent form-level pins don't make sense — a form is a
--      reusable template).
--   2. Add `onboarding_clients.parent_lead_id` so leads join the same
--      invite pattern that clients already use.
--   3. Existing `form_type = 'onboarding'` check inside the invite/
--      submit flow is deliberately NOT removed here — that's an
--      application-layer decision handled in the routes so the schema
--      stays symmetrical.

ALTER TABLE `forms`
  DROP FOREIGN KEY `fk_forms_default_client`,
  DROP FOREIGN KEY `fk_forms_default_lead`;

ALTER TABLE `forms`
  DROP KEY `idx_forms_default_client`,
  DROP KEY `idx_forms_default_lead`,
  DROP COLUMN `default_attach_client_id`,
  DROP COLUMN `default_attach_lead_id`;

ALTER TABLE `onboarding_clients`
  ADD COLUMN `parent_lead_id` INT UNSIGNED NULL AFTER `parent_client_id`,
  ADD KEY `idx_oc_parent_lead` (`parent_lead_id`),
  ADD CONSTRAINT `fk_oc_parent_lead`
    FOREIGN KEY (`parent_lead_id`) REFERENCES `leads` (`id`) ON DELETE SET NULL;
