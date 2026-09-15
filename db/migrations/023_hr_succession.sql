-- Migration 023: Succession planning — track key roles and ready successors.

USE `builtrightstudio_cms`;

CREATE TABLE IF NOT EXISTS `hr_succession_plans` (
    `id`              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `key_role`        VARCHAR(190) NOT NULL,
    `current_holder_id` INT UNSIGNED NULL,
    `risk_level`      ENUM('low','medium','high') NOT NULL DEFAULT 'medium',
    `notes`           TEXT NULL,
    `created_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT `fk_sp_holder` FOREIGN KEY (`current_holder_id`) REFERENCES `hr_employees`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `hr_succession_candidates` (
    `id`            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `plan_id`       INT UNSIGNED NOT NULL,
    `employee_id`   INT UNSIGNED NOT NULL,
    `readiness`     ENUM('now','1-2y','3-5y') NOT NULL DEFAULT '1-2y',
    `notes`         TEXT NULL,
    `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY `uniq_plan_emp` (`plan_id`, `employee_id`),
    CONSTRAINT `fk_sc_plan` FOREIGN KEY (`plan_id`)     REFERENCES `hr_succession_plans`(`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_sc_emp`  FOREIGN KEY (`employee_id`) REFERENCES `hr_employees`(`id`)       ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
