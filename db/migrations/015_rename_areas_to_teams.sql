-- Rename "areas" → "teams" across the taskboard schema.
-- Tasks belong to a team (responsible for the work) and may be assigned to a person within it.

USE `builtrightstudio_cms`;

-- 1. Drop the existing FK + unique key on task_projects so we can rename the column.
ALTER TABLE `task_projects`
  DROP FOREIGN KEY `fk_project_area`,
  DROP INDEX `uniq_area_slug`;

-- 2. Rename column area_id → team_id.
ALTER TABLE `task_projects`
  CHANGE COLUMN `area_id` `team_id` INT UNSIGNED NOT NULL;

-- 3. Rename the table.
RENAME TABLE `task_areas` TO `task_teams`;

-- 4. Re-create the FK + unique key with the new naming.
ALTER TABLE `task_projects`
  ADD CONSTRAINT `fk_project_team` FOREIGN KEY (`team_id`) REFERENCES `task_teams`(`id`) ON DELETE CASCADE,
  ADD UNIQUE KEY `uniq_team_slug` (`team_id`, `slug`);
