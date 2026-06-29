-- Migration 101: tenant_id on forms + submission tables.
-- Same three-step pattern as migration 100. See the header comment there
-- for the rationale.

ALTER TABLE `forms`                 ADD COLUMN `tenant_id` INT UNSIGNED NULL AFTER `id`;
UPDATE      `forms`                 SET    `tenant_id` = 1;
ALTER TABLE `forms`                 MODIFY `tenant_id` INT UNSIGNED NOT NULL,
                                    ADD KEY `idx_forms_tenant` (`tenant_id`),
                                    ADD CONSTRAINT `fk_forms_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`);

ALTER TABLE `form_sections`         ADD COLUMN `tenant_id` INT UNSIGNED NULL AFTER `id`;
UPDATE      `form_sections`         SET    `tenant_id` = 1;
ALTER TABLE `form_sections`         MODIFY `tenant_id` INT UNSIGNED NOT NULL,
                                    ADD KEY `idx_form_sections_tenant` (`tenant_id`),
                                    ADD CONSTRAINT `fk_form_sections_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`);

ALTER TABLE `form_fields`           ADD COLUMN `tenant_id` INT UNSIGNED NULL AFTER `id`;
UPDATE      `form_fields`           SET    `tenant_id` = 1;
ALTER TABLE `form_fields`           MODIFY `tenant_id` INT UNSIGNED NOT NULL,
                                    ADD KEY `idx_form_fields_tenant` (`tenant_id`),
                                    ADD CONSTRAINT `fk_form_fields_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`);

ALTER TABLE `form_contact_us`       ADD COLUMN `tenant_id` INT UNSIGNED NULL AFTER `id`;
UPDATE      `form_contact_us`       SET    `tenant_id` = 1;
ALTER TABLE `form_contact_us`       MODIFY `tenant_id` INT UNSIGNED NOT NULL,
                                    ADD KEY `idx_form_contact_us_tenant` (`tenant_id`),
                                    ADD CONSTRAINT `fk_form_contact_us_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`);

ALTER TABLE `form_newsletter_signup` ADD COLUMN `tenant_id` INT UNSIGNED NULL AFTER `id`;
UPDATE      `form_newsletter_signup` SET    `tenant_id` = 1;
ALTER TABLE `form_newsletter_signup` MODIFY `tenant_id` INT UNSIGNED NOT NULL,
                                     ADD KEY `idx_form_newsletter_signup_tenant` (`tenant_id`),
                                     ADD CONSTRAINT `fk_form_newsletter_signup_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`);

ALTER TABLE `form_test`             ADD COLUMN `tenant_id` INT UNSIGNED NULL AFTER `id`;
UPDATE      `form_test`             SET    `tenant_id` = 1;
ALTER TABLE `form_test`             MODIFY `tenant_id` INT UNSIGNED NOT NULL,
                                    ADD KEY `idx_form_test_tenant` (`tenant_id`),
                                    ADD CONSTRAINT `fk_form_test_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`);
