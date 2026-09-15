-- Migration 033: track *how* a course assignment was created so the UI can
-- group department / company-wide bulk assigns under a single row instead of
-- listing every employee.

USE `builtrightstudio_cms`;

ALTER TABLE `hr_course_assignments`
    ADD COLUMN `assign_scope`       ENUM('individual','department','company') NOT NULL DEFAULT 'individual' AFTER `assigned_at`,
    ADD COLUMN `assign_scope_value` VARCHAR(190) NULL AFTER `assign_scope`;
