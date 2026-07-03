-- Migration 136: unified form-submission -> record linkage.
--
-- Regular forms currently store submissions in per-form dynamic tables
-- (form_contact_us, form_newsletter_signup, etc.). Onboarding forms use
-- onboarding_clients with parent_client_id. Neither system links to
-- leads, and standard forms don't link to clients at all.
--
-- This migration adds `form_submission_links` as a single, polymorphic
-- association table:
--   - `submission_table` names the dynamic per-form table
--   - `submission_id` is the row id inside that table
--   - `client_id` / `lead_id` / `service_offering_id` are optional links
-- Plus `forms.attach_token_client` / `_lead` / `_service` seed a signed
-- token flow: the public form URL can include a token that pre-selects
-- the record on submit (used by "invite this client to fill out form X"
-- style flows).
--
-- Onboarding forms already carry `parent_client_id` on onboarding_clients;
-- we can migrate those into form_submission_links later without breaking
-- anything by cross-inserting on submission finalisation.

CREATE TABLE IF NOT EXISTS `form_submission_links` (
  `id`                    INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `tenant_id`             INT UNSIGNED NOT NULL,
  `form_id`               INT UNSIGNED NOT NULL,
  `submission_table`      VARCHAR(80)  NOT NULL,
  `submission_id`         INT UNSIGNED NOT NULL,
  `client_id`             INT UNSIGNED NULL,
  `lead_id`               INT UNSIGNED NULL,
  `service_offering_id`   INT UNSIGNED NULL,
  `attached_by_user_id`   INT UNSIGNED NULL,
  `attach_source`         ENUM('token','manual','auto') NOT NULL DEFAULT 'manual',
  `linked_at`             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_fsl_form_sub`  (`form_id`, `submission_table`, `submission_id`),
  KEY `idx_fsl_client`    (`client_id`),
  KEY `idx_fsl_lead`      (`lead_id`),
  KEY `idx_fsl_service`   (`service_offering_id`),
  KEY `idx_fsl_tenant`    (`tenant_id`),
  CONSTRAINT `fk_fsl_form`    FOREIGN KEY (`form_id`)     REFERENCES `forms` (`id`)             ON DELETE CASCADE,
  CONSTRAINT `fk_fsl_client`  FOREIGN KEY (`client_id`)   REFERENCES `clients` (`id`)           ON DELETE SET NULL,
  CONSTRAINT `fk_fsl_lead`    FOREIGN KEY (`lead_id`)     REFERENCES `leads` (`id`)             ON DELETE SET NULL,
  CONSTRAINT `fk_fsl_service` FOREIGN KEY (`service_offering_id`) REFERENCES `service_offerings` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Backfill from existing onboarding_clients so the new endpoint returns
-- pre-existing multipart-form onboardings alongside new standard-form
-- submissions from day one.
INSERT IGNORE INTO `form_submission_links`
  (tenant_id, form_id, submission_table, submission_id, client_id, attach_source, linked_at)
SELECT
  oc.tenant_id, oc.form_id, 'onboarding_clients', oc.id,
  oc.parent_client_id, 'auto', COALESCE(oc.submitted_at, oc.started_at)
FROM `onboarding_clients` oc
WHERE oc.parent_client_id IS NOT NULL;
