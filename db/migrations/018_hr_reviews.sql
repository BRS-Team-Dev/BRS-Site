-- Migration 018: Performance reviews
--   • hr_review_cycles  — the period + question template + status
--   • hr_reviews        — one per (cycle, employee), holds both self and manager input

USE `builtrightstudio_cms`;

CREATE TABLE IF NOT EXISTS `hr_review_cycles` (
    `id`            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `name`          VARCHAR(120) NOT NULL,
    `period_start`  DATE NOT NULL,
    `period_end`    DATE NOT NULL,
    `due_date`      DATE NULL,
    `status`        ENUM('draft','active','closed') NOT NULL DEFAULT 'draft',
    `questions_json` JSON NOT NULL,
    `notes`         TEXT NULL,
    `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `hr_reviews` (
    `id`                     INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `cycle_id`               INT UNSIGNED NOT NULL,
    `employee_id`            INT UNSIGNED NOT NULL,
    `manager_id`             INT UNSIGNED NULL,
    `status`                 ENUM('not_started','self_review','manager_review','completed','closed') NOT NULL DEFAULT 'not_started',
    `employee_responses_json` JSON NULL,
    `manager_responses_json`  JSON NULL,
    `employee_overall`       DECIMAL(3,1) NULL,
    `manager_overall`        DECIMAL(3,1) NULL,
    `employee_signed_at`     DATETIME NULL,
    `manager_signed_at`      DATETIME NULL,
    `goals_next_period`      TEXT NULL,
    `created_at`             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY `uniq_cycle_emp` (`cycle_id`, `employee_id`),
    CONSTRAINT `fk_review_cycle`   FOREIGN KEY (`cycle_id`)    REFERENCES `hr_review_cycles`(`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_review_emp`     FOREIGN KEY (`employee_id`) REFERENCES `hr_employees`(`id`)    ON DELETE CASCADE,
    CONSTRAINT `fk_review_manager` FOREIGN KEY (`manager_id`)  REFERENCES `hr_employees`(`id`)    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
