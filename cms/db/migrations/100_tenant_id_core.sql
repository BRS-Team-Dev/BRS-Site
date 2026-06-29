-- Migration 100: tenant_id on the core CRM entities.
--
-- Adds `tenant_id INT UNSIGNED` to admin, settings, leads, clients,
-- service offerings, and the onboarding catalogue. Three-step pattern
-- per table so we never violate NOT NULL constraints mid-migration:
--
--   1. ADD COLUMN tenant_id NULL                  -- column exists, no values yet
--   2. UPDATE … SET tenant_id = 1                 -- backfill all existing rows to BRS
--   3. MODIFY tenant_id NOT NULL + FK + index     -- lock it down going forward
--
-- The FK to tenants.id intentionally uses ON DELETE RESTRICT (default
-- when no clause given) since we soft-delete tenants via status='deleted'
-- — a hard cascade here would be catastrophic if the registry row got
-- removed by mistake.
--
-- Run inside the runner's automatic per-migration transaction, so a
-- failure anywhere in this file rolls everything back atomically.

-- ── admin / settings ─────────────────────────────────────────────
ALTER TABLE `admin_users`   ADD COLUMN `tenant_id` INT UNSIGNED NULL AFTER `id`;
UPDATE      `admin_users`   SET    `tenant_id` = 1;
ALTER TABLE `admin_users`   MODIFY `tenant_id` INT UNSIGNED NOT NULL,
                            ADD KEY `idx_admin_users_tenant` (`tenant_id`),
                            ADD CONSTRAINT `fk_admin_users_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`);

ALTER TABLE `admin_sections` ADD COLUMN `tenant_id` INT UNSIGNED NULL AFTER `id`;
UPDATE      `admin_sections` SET    `tenant_id` = 1;
ALTER TABLE `admin_sections` MODIFY `tenant_id` INT UNSIGNED NOT NULL,
                             ADD KEY `idx_admin_sections_tenant` (`tenant_id`),
                             ADD CONSTRAINT `fk_admin_sections_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`);

ALTER TABLE `settings`      ADD COLUMN `tenant_id` INT UNSIGNED NULL FIRST;
UPDATE      `settings`      SET    `tenant_id` = 1;
ALTER TABLE `settings`      MODIFY `tenant_id` INT UNSIGNED NOT NULL,
                            ADD KEY `idx_settings_tenant` (`tenant_id`),
                            ADD CONSTRAINT `fk_settings_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`);

ALTER TABLE `password_resets` ADD COLUMN `tenant_id` INT UNSIGNED NULL AFTER `id`;
UPDATE      `password_resets` SET    `tenant_id` = 1;
ALTER TABLE `password_resets` MODIFY `tenant_id` INT UNSIGNED NOT NULL,
                              ADD KEY `idx_password_resets_tenant` (`tenant_id`),
                              ADD CONSTRAINT `fk_password_resets_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`);

-- ── leads cluster ────────────────────────────────────────────────
ALTER TABLE `leads`              ADD COLUMN `tenant_id` INT UNSIGNED NULL AFTER `id`;
UPDATE      `leads`              SET    `tenant_id` = 1;
ALTER TABLE `leads`              MODIFY `tenant_id` INT UNSIGNED NOT NULL,
                                 ADD KEY `idx_leads_tenant` (`tenant_id`),
                                 ADD CONSTRAINT `fk_leads_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`);

ALTER TABLE `lead_contacts`      ADD COLUMN `tenant_id` INT UNSIGNED NULL AFTER `id`;
UPDATE      `lead_contacts`      SET    `tenant_id` = 1;
ALTER TABLE `lead_contacts`      MODIFY `tenant_id` INT UNSIGNED NOT NULL,
                                 ADD KEY `idx_lead_contacts_tenant` (`tenant_id`),
                                 ADD CONSTRAINT `fk_lead_contacts_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`);

ALTER TABLE `lead_contact_numbers` ADD COLUMN `tenant_id` INT UNSIGNED NULL AFTER `id`;
UPDATE      `lead_contact_numbers` SET    `tenant_id` = 1;
ALTER TABLE `lead_contact_numbers` MODIFY `tenant_id` INT UNSIGNED NOT NULL,
                                   ADD KEY `idx_lead_contact_numbers_tenant` (`tenant_id`),
                                   ADD CONSTRAINT `fk_lead_contact_numbers_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`);

ALTER TABLE `lead_notes`         ADD COLUMN `tenant_id` INT UNSIGNED NULL AFTER `id`;
UPDATE      `lead_notes`         SET    `tenant_id` = 1;
ALTER TABLE `lead_notes`         MODIFY `tenant_id` INT UNSIGNED NOT NULL,
                                 ADD KEY `idx_lead_notes_tenant` (`tenant_id`),
                                 ADD CONSTRAINT `fk_lead_notes_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`);

ALTER TABLE `lead_info`          ADD COLUMN `tenant_id` INT UNSIGNED NULL AFTER `id`;
UPDATE      `lead_info`          SET    `tenant_id` = 1;
ALTER TABLE `lead_info`          MODIFY `tenant_id` INT UNSIGNED NOT NULL,
                                 ADD KEY `idx_lead_info_tenant` (`tenant_id`),
                                 ADD CONSTRAINT `fk_lead_info_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`);

ALTER TABLE `lead_documents`     ADD COLUMN `tenant_id` INT UNSIGNED NULL AFTER `id`;
UPDATE      `lead_documents`     SET    `tenant_id` = 1;
ALTER TABLE `lead_documents`     MODIFY `tenant_id` INT UNSIGNED NOT NULL,
                                 ADD KEY `idx_lead_documents_tenant` (`tenant_id`),
                                 ADD CONSTRAINT `fk_lead_documents_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`);

-- ── clients cluster ──────────────────────────────────────────────
ALTER TABLE `clients`            ADD COLUMN `tenant_id` INT UNSIGNED NULL AFTER `id`;
UPDATE      `clients`            SET    `tenant_id` = 1;
ALTER TABLE `clients`            MODIFY `tenant_id` INT UNSIGNED NOT NULL,
                                 ADD KEY `idx_clients_tenant` (`tenant_id`),
                                 ADD CONSTRAINT `fk_clients_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`);

ALTER TABLE `client_contacts`    ADD COLUMN `tenant_id` INT UNSIGNED NULL AFTER `id`;
UPDATE      `client_contacts`    SET    `tenant_id` = 1;
ALTER TABLE `client_contacts`    MODIFY `tenant_id` INT UNSIGNED NOT NULL,
                                 ADD KEY `idx_client_contacts_tenant` (`tenant_id`),
                                 ADD CONSTRAINT `fk_client_contacts_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`);

ALTER TABLE `client_contact_numbers` ADD COLUMN `tenant_id` INT UNSIGNED NULL AFTER `id`;
UPDATE      `client_contact_numbers` SET    `tenant_id` = 1;
ALTER TABLE `client_contact_numbers` MODIFY `tenant_id` INT UNSIGNED NOT NULL,
                                     ADD KEY `idx_client_contact_numbers_tenant` (`tenant_id`),
                                     ADD CONSTRAINT `fk_client_contact_numbers_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`);

ALTER TABLE `client_accounts`    ADD COLUMN `tenant_id` INT UNSIGNED NULL AFTER `id`;
UPDATE      `client_accounts`    SET    `tenant_id` = 1;
ALTER TABLE `client_accounts`    MODIFY `tenant_id` INT UNSIGNED NOT NULL,
                                 ADD KEY `idx_client_accounts_tenant` (`tenant_id`),
                                 ADD CONSTRAINT `fk_client_accounts_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`);

ALTER TABLE `client_notes`       ADD COLUMN `tenant_id` INT UNSIGNED NULL AFTER `id`;
UPDATE      `client_notes`       SET    `tenant_id` = 1;
ALTER TABLE `client_notes`       MODIFY `tenant_id` INT UNSIGNED NOT NULL,
                                 ADD KEY `idx_client_notes_tenant` (`tenant_id`),
                                 ADD CONSTRAINT `fk_client_notes_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`);

ALTER TABLE `client_info`        ADD COLUMN `tenant_id` INT UNSIGNED NULL AFTER `id`;
UPDATE      `client_info`        SET    `tenant_id` = 1;
ALTER TABLE `client_info`        MODIFY `tenant_id` INT UNSIGNED NOT NULL,
                                 ADD KEY `idx_client_info_tenant` (`tenant_id`),
                                 ADD CONSTRAINT `fk_client_info_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`);

ALTER TABLE `client_documents`   ADD COLUMN `tenant_id` INT UNSIGNED NULL AFTER `id`;
UPDATE      `client_documents`   SET    `tenant_id` = 1;
ALTER TABLE `client_documents`   MODIFY `tenant_id` INT UNSIGNED NOT NULL,
                                 ADD KEY `idx_client_documents_tenant` (`tenant_id`),
                                 ADD CONSTRAINT `fk_client_documents_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`);

ALTER TABLE `client_service_offerings` ADD COLUMN `tenant_id` INT UNSIGNED NULL AFTER `id`;
UPDATE      `client_service_offerings` SET    `tenant_id` = 1;
ALTER TABLE `client_service_offerings` MODIFY `tenant_id` INT UNSIGNED NOT NULL,
                                       ADD KEY `idx_client_service_offerings_tenant` (`tenant_id`),
                                       ADD CONSTRAINT `fk_client_service_offerings_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`);

-- ── service catalogue + onboarding ───────────────────────────────
ALTER TABLE `service_offerings`  ADD COLUMN `tenant_id` INT UNSIGNED NULL AFTER `id`;
UPDATE      `service_offerings`  SET    `tenant_id` = 1;
ALTER TABLE `service_offerings`  MODIFY `tenant_id` INT UNSIGNED NOT NULL,
                                 ADD KEY `idx_service_offerings_tenant` (`tenant_id`),
                                 ADD CONSTRAINT `fk_service_offerings_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`);

ALTER TABLE `onboarding_clients` ADD COLUMN `tenant_id` INT UNSIGNED NULL AFTER `id`;
UPDATE      `onboarding_clients` SET    `tenant_id` = 1;
ALTER TABLE `onboarding_clients` MODIFY `tenant_id` INT UNSIGNED NOT NULL,
                                 ADD KEY `idx_onboarding_clients_tenant` (`tenant_id`),
                                 ADD CONSTRAINT `fk_onboarding_clients_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`);
