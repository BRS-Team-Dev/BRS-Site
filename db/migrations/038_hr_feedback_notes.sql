-- Migration 038: continuous-feedback / 1:1 notes thread per employee.
-- Authored by managers (or HR), optionally shared with the employee.

USE `builtrightstudio_cms`;

CREATE TABLE IF NOT EXISTS `hr_feedback_notes` (
    `id`           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `employee_id`  INT UNSIGNED NOT NULL,
    `author_id`    INT UNSIGNED NULL,
    `kind`         ENUM('feedback','one_on_one','coaching','recognition') NOT NULL DEFAULT 'one_on_one',
    `body`         TEXT NOT NULL,
    `meeting_date` DATE NULL,
    `visibility`   ENUM('private','shared') NOT NULL DEFAULT 'shared',
    `created_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_fbnote_emp`  FOREIGN KEY (`employee_id`) REFERENCES `hr_employees`(`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_fbnote_user` FOREIGN KEY (`author_id`)   REFERENCES `admin_users`(`id`)  ON DELETE SET NULL,
    INDEX `idx_fbnote_emp` (`employee_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
