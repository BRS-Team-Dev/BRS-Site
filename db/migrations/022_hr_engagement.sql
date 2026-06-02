-- Migration 022: Engagement / pulse surveys + open feedback channel.

USE `builtrightstudio_cms`;

CREATE TABLE IF NOT EXISTS `hr_pulse_surveys` (
    `id`             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `title`          VARCHAR(190) NOT NULL,
    `description`    TEXT NULL,
    `is_anonymous`   TINYINT(1) NOT NULL DEFAULT 1,
    `questions_json` JSON NOT NULL,
    `status`         ENUM('draft','open','closed') NOT NULL DEFAULT 'draft',
    `opens_at`       DATETIME NULL,
    `closes_at`      DATETIME NULL,
    `created_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `hr_pulse_responses` (
    `id`            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `survey_id`     INT UNSIGNED NOT NULL,
    `employee_id`   INT UNSIGNED NULL,
    `answers_json`  JSON NOT NULL,
    `submitted_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_resp_survey` FOREIGN KEY (`survey_id`)   REFERENCES `hr_pulse_surveys`(`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_resp_emp`    FOREIGN KEY (`employee_id`) REFERENCES `hr_employees`(`id`)    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `hr_feedback` (
    `id`            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `employee_id`   INT UNSIGNED NULL,
    `category`      VARCHAR(60) NOT NULL DEFAULT 'general',
    `message`       TEXT NOT NULL,
    `status`        ENUM('new','reviewed','actioned','archived') NOT NULL DEFAULT 'new',
    `reviewed_by`   INT UNSIGNED NULL,
    `reviewed_at`   DATETIME NULL,
    `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_fb_emp`      FOREIGN KEY (`employee_id`) REFERENCES `hr_employees`(`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_fb_reviewer` FOREIGN KEY (`reviewed_by`) REFERENCES `admin_users`(`id`)  ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
