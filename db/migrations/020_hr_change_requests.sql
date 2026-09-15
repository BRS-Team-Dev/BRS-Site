-- Migration 020: Self-service profile change requests.
-- Employees propose updates to fields HR controls (address, phone, emergency contact, etc.).

USE `builtrightstudio_cms`;

CREATE TABLE IF NOT EXISTS `hr_change_requests` (
    `id`            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `employee_id`   INT UNSIGNED NOT NULL,
    `field`         VARCHAR(60)  NOT NULL,
    `old_value`     TEXT NULL,
    `new_value`     TEXT NULL,
    `note`          TEXT NULL,
    `status`        ENUM('pending','approved','denied','cancelled') NOT NULL DEFAULT 'pending',
    `reviewed_by`   INT UNSIGNED NULL,
    `reviewed_at`   DATETIME NULL,
    `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_chreq_emp`      FOREIGN KEY (`employee_id`) REFERENCES `hr_employees`(`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_chreq_reviewer` FOREIGN KEY (`reviewed_by`) REFERENCES `admin_users`(`id`)  ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
