-- Migration 040: jobs gain a hiring manager so the management portal can
-- scope hiring views and roll up candidate progress per manager.

USE `builtrightstudio_cms`;

ALTER TABLE `hr_jobs`
    ADD COLUMN `hiring_manager_id` INT UNSIGNED NULL AFTER `description`,
    ADD CONSTRAINT `fk_jobs_hiring_manager`
        FOREIGN KEY (`hiring_manager_id`) REFERENCES `hr_employees`(`id`)
        ON DELETE SET NULL,
    ADD INDEX `idx_jobs_hiring_manager` (`hiring_manager_id`);
