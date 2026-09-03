-- Migration 057: Task team members.
-- Joins admin_users to task_teams so a team has an explicit roster.
-- The composite PK doubles as a UNIQUE on (team_id, user_id) so the
-- POST endpoint can use INSERT IGNORE for idempotent adds.
-- Cascades on delete from either side.

USE `builtrightstudio_cms`;

CREATE TABLE IF NOT EXISTS `task_team_members` (
  `team_id`     INT UNSIGNED NOT NULL,
  `user_id`     INT UNSIGNED NOT NULL,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`team_id`, `user_id`),
  KEY `idx_ttm_user` (`user_id`),
  CONSTRAINT `fk_ttm_team` FOREIGN KEY (`team_id`) REFERENCES `task_teams`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ttm_user` FOREIGN KEY (`user_id`) REFERENCES `admin_users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
