-- Migration 118: per-service / per-form "allow multiple" toggle.
--
-- Off (default 0) means a single client can only have ONE live
-- attachment to this service / submission of this form. The auto-
-- attach in public_onboarding skips when an existing row is found.
--
-- On (1) means each onboarding submission spawns a new row — useful
-- for services that are genuinely re-purchasable (e.g. one-off
-- "Website build", "Brand identity") versus subscription-style ones
-- that you only sell once (e.g. "Management system").
--
-- When a form is linked to a service via forms.service_offering_id
-- the service's flag is the source of truth — the form-level flag
-- only matters for standalone (un-linked) onboarding forms.

ALTER TABLE `service_offerings`
  ADD COLUMN `allow_multiple` TINYINT(1) NOT NULL DEFAULT 0 AFTER `is_active`;

ALTER TABLE `forms`
  ADD COLUMN `allow_multiple` TINYINT(1) NOT NULL DEFAULT 0 AFTER `is_published`;
