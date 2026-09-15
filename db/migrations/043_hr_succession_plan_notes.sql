-- Migration 043: timestamped notes thread per succession plan, mirroring the
-- compliance-task notes pattern so HR can record discussions over time.

USE `builtrightstudio_cms`;

CREATE TABLE IF NOT EXISTS `hr_succession_plan_notes` (
    `id`         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `plan_id`    INT UNSIGNED NOT NULL,
    `user_id`    INT UNSIGNED NULL,
    `body`       TEXT NOT NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_succplan_note_plan` FOREIGN KEY (`plan_id`)
        REFERENCES `hr_succession_plans`(`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_succplan_note_user` FOREIGN KEY (`user_id`)
        REFERENCES `admin_users`(`id`) ON DELETE SET NULL,
    INDEX `idx_succplan_note_plan` (`plan_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
