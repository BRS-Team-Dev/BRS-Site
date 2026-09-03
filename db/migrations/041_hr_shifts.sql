-- Migration 041: simple shift assignments for the management Schedule page.
-- Managers create shifts for direct reports; employees see them on /hr/me.

USE `builtrightstudio_cms`;

CREATE TABLE IF NOT EXISTS `hr_shifts` (
    `id`           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `employee_id`  INT UNSIGNED NOT NULL,
    `created_by`   INT UNSIGNED NULL,
    `shift_date`   DATE NOT NULL,
    `start_time`   TIME NOT NULL,
    `end_time`     TIME NOT NULL,
    `role`         VARCHAR(120) NULL,
    `location`     VARCHAR(120) NULL,
    `notes`        TEXT NULL,
    `status`       ENUM('scheduled','swap_requested','swapped','cancelled') NOT NULL DEFAULT 'scheduled',
    `created_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_shift_emp`  FOREIGN KEY (`employee_id`) REFERENCES `hr_employees`(`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_shift_user` FOREIGN KEY (`created_by`)  REFERENCES `admin_users`(`id`)  ON DELETE SET NULL,
    INDEX `idx_shift_date` (`shift_date`, `employee_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
