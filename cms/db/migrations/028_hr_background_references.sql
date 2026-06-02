-- Migration 028: criminal record declaration, current location, references table,
-- and backfill default checklist for existing employees that don't have one.

USE `builtrightstudio_cms`;

ALTER TABLE `hr_employees`
    ADD COLUMN `current_location`         VARCHAR(120) NULL AFTER `country`,
    ADD COLUMN `criminal_record_declared` TINYINT(1) NULL AFTER `tshirt_size`,  -- 0=no, 1=yes, NULL=not answered
    ADD COLUMN `criminal_record_details`  TEXT NULL AFTER `criminal_record_declared`,
    ADD COLUMN `dbs_check_ref`            VARCHAR(80)  NULL AFTER `criminal_record_details`,
    ADD COLUMN `dbs_check_date`           DATE         NULL AFTER `dbs_check_ref`;

CREATE TABLE IF NOT EXISTS `hr_references` (
    `id`            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `employee_id`   INT UNSIGNED NOT NULL,
    `name`          VARCHAR(120) NOT NULL,
    `relationship`  VARCHAR(80)  NULL,
    `email`         VARCHAR(190) NULL,
    `phone`         VARCHAR(40)  NULL,
    `company`       VARCHAR(120) NULL,
    `position`      VARCHAR(120) NULL,
    `notes`         TEXT NULL,
    `sort_order`    INT NOT NULL DEFAULT 0,
    `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_ref_emp` FOREIGN KEY (`employee_id`) REFERENCES `hr_employees`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Backfill default checklist for existing employees without any tasks (e.g. created before migration 026).
INSERT INTO `hr_onboarding_tasks` (employee_id, title, description, category, sort_order)
SELECT e.id, dt.title, dt.description, dt.category, dt.sort_order
FROM `hr_employees` e
CROSS JOIN `hr_default_onboarding_tasks` dt
WHERE NOT EXISTS (SELECT 1 FROM `hr_onboarding_tasks` t WHERE t.employee_id = e.id);
