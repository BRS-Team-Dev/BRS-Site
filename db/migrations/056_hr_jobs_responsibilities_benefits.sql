-- Migration 056: Job postings — split free-form description into responsibilities + benefits.
--   • description stays as the high-level role overview (existing column).
--   • responsibilities = "what you'll do" — bullet list as plain text.
--   • benefits         = "what's in it for you" — bullet list as plain text.

USE `builtrightstudio_cms`;

ALTER TABLE `hr_jobs`
    ADD COLUMN `responsibilities` TEXT NULL AFTER `description`,
    ADD COLUMN `benefits`         TEXT NULL AFTER `responsibilities`;
