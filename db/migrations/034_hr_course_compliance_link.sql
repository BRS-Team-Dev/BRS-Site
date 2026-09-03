-- Migration 034: courses can be linked to a compliance task. Useful for
-- regulatory training (e.g. GDPR refresher) where evidence of training is
-- the compliance deliverable.

USE `builtrightstudio_cms`;

ALTER TABLE `hr_courses`
    ADD COLUMN `compliance_task_id` INT UNSIGNED NULL AFTER `is_required`,
    ADD CONSTRAINT `fk_course_compliance`
        FOREIGN KEY (`compliance_task_id`) REFERENCES `hr_compliance_tasks`(`id`)
        ON DELETE SET NULL;
