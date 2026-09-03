-- Migration 113: link onboarding forms to a catalogue service.
--
-- Until now the onboarding builder asked admins to RE-DEFINE pricing
-- (`forms.has_price`, `forms.price`, `forms.payment_type`,
-- `forms.repeat_duration`, `forms.contract_length_months`,
-- `forms.is_indefinite` — added in migrations 054 + 055) for every
-- onboarding form, which duplicates whatever already lives in the
-- service catalogue and forces double-maintenance whenever pricing
-- changes.
--
-- This column replaces that pattern: pick an existing
-- `service_offerings` row, and the qualify-to-client flow snapshots
-- name/price/payment_type/repeat_duration onto `client_service_offerings`
-- from the catalogue source of truth. The legacy `has_price`/`price`/...
-- columns stay in place for now so historical rows keep rendering;
-- nothing new writes to them via the builder.
--
-- ON DELETE SET NULL means a deleted catalogue entry orphans (rather
-- than cascades to delete) the onboarding form — same policy we use
-- on `task_projects.onboarding_client_id`.

ALTER TABLE `forms`
  ADD COLUMN `service_offering_id` INT UNSIGNED NULL AFTER `team_id`,
  ADD KEY `idx_forms_service_offering` (`service_offering_id`),
  ADD CONSTRAINT `fk_forms_service_offering`
    FOREIGN KEY (`service_offering_id`) REFERENCES `service_offerings`(`id`) ON DELETE SET NULL;
