-- Migration 031: allow images on course modules. Stored as a JSON array of
-- { url, position: 'above'|'below', alt? } entries. Files live under
-- uploads/courses/<course_id>/.

USE `builtrightstudio_cms`;

ALTER TABLE `hr_course_modules`
    ADD COLUMN `images_json` JSON NULL AFTER `quiz_json`;
