-- Migration 037: SMART goals per employee. Owned by the employee, optionally
-- created or co-edited by their manager. Status drives the dashboard counters.

USE `builtrightstudio_cms`;

CREATE TABLE IF NOT EXISTS `hr_goals` (
    `id`           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `employee_id`  INT UNSIGNED NOT NULL,
    `created_by`   INT UNSIGNED NULL,
    `title`        VARCHAR(190) NOT NULL,
    `description`  TEXT NULL,
    `measurable`   VARCHAR(255) NULL,                                    -- "how do we know it's done"
    `due_date`     DATE NULL,
    `status`       ENUM('not_started','in_progress','completed','cancelled') NOT NULL DEFAULT 'not_started',
    `progress_pct` TINYINT NOT NULL DEFAULT 0,
    `created_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT `fk_goal_emp`  FOREIGN KEY (`employee_id`) REFERENCES `hr_employees`(`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_goal_user` FOREIGN KEY (`created_by`)  REFERENCES `admin_users`(`id`)  ON DELETE SET NULL,
    INDEX `idx_goal_emp` (`employee_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
