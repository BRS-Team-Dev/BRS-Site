-- Migration 035: timestamped notes thread per compliance task. Replaces the
-- single notes column on `hr_compliance_tasks` so HR can see who said what,
-- when, while reviewing or following up on an obligation.

USE `builtrightstudio_cms`;

CREATE TABLE IF NOT EXISTS `hr_compliance_task_notes` (
    `id`         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `task_id`    INT UNSIGNED NOT NULL,
    `user_id`    INT UNSIGNED NULL,
    `body`       TEXT NOT NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_compl_note_task` FOREIGN KEY (`task_id`)
        REFERENCES `hr_compliance_tasks`(`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_compl_note_user` FOREIGN KEY (`user_id`)
        REFERENCES `admin_users`(`id`) ON DELETE SET NULL,
    INDEX `idx_compl_note_task` (`task_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
