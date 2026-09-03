-- Migration 032: slide modules become an ordered list of mixed-type blocks
-- (image / copy / video). Replaces the fixed images_above + body + images_below
-- shape from migration 031 for `text` (slide) modules. Old data stays in
-- `images_json` / `body` until rewritten by the editor.

USE `builtrightstudio_cms`;

ALTER TABLE `hr_course_modules`
    ADD COLUMN `blocks_json` JSON NULL AFTER `images_json`;
