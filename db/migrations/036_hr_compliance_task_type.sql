-- Migration 036: classify compliance tasks by type so HR can quickly tell
-- training items apart from document submissions, audits, etc.
-- Training-type tasks pair with linked courses via hr_courses.compliance_task_id.

USE `builtrightstudio_cms`;

ALTER TABLE `hr_compliance_tasks`
    ADD COLUMN `task_type` ENUM('training','document','audit','employee','other')
        NOT NULL DEFAULT 'other'
        AFTER `frequency`;
