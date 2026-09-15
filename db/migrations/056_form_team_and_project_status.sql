-- Migration 056: Onboarding -> task team handoff, project status.
-- Three changes:
--   1. forms.team_id            — onboarding form picks which task team owns it.
--   2. task_projects.status     — workflow status driving the service-card badge.
--   3. task_projects.onboarding_client_id — back-link from auto-created project
--                                  to the onboarding entry that spawned it.
--
-- When an onboarding client is qualified AND the form has team_id set, the
-- /qualify handler creates one task_projects row owned by that team,
-- linked back via onboarding_client_id. The Services tab on the client
-- detail view then surfaces the project's status as the service status.

USE `builtrightstudio_cms`;

ALTER TABLE `forms`
  ADD COLUMN `team_id` INT UNSIGNED NULL AFTER `parent_process_form_id`,
  ADD CONSTRAINT `fk_forms_team` FOREIGN KEY (`team_id`) REFERENCES `task_teams`(`id`) ON DELETE SET NULL;

ALTER TABLE `task_projects`
  ADD COLUMN `status` ENUM('new','ongoing','testing','blocked','complete')
    NOT NULL DEFAULT 'new' AFTER `client_id`,
  ADD COLUMN `onboarding_client_id` INT UNSIGNED NULL AFTER `status`,
  ADD CONSTRAINT `fk_task_projects_onboarding_client`
    FOREIGN KEY (`onboarding_client_id`) REFERENCES `onboarding_clients`(`id`) ON DELETE SET NULL,
  ADD UNIQUE KEY `uniq_task_projects_onboarding_client` (`onboarding_client_id`);
