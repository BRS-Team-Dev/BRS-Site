-- Migration 047: timestamped notes thread per employee, replacing the single
-- `notes` text column on hr_employees. The legacy column stays in place so old
-- data isn't lost; new entries flow into this thread table.

USE `builtrightstudio_cms`;

CREATE TABLE IF NOT EXISTS `hr_employee_notes` (
    `id`          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `employee_id` INT UNSIGNED NOT NULL,
    `user_id`     INT UNSIGNED NULL,
    `body`        TEXT NOT NULL,
    `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_emp_note_emp`  FOREIGN KEY (`employee_id`) REFERENCES `hr_employees`(`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_emp_note_user` FOREIGN KEY (`user_id`)     REFERENCES `admin_users`(`id`)  ON DELETE SET NULL,
    INDEX `idx_emp_note_emp` (`employee_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
