-- Migration 039: skills catalogue + per-employee assessments. Supports skill
-- gap analysis on the management portal: each employee gets a current and
-- target proficiency (1-5) per tracked skill.

USE `builtrightstudio_cms`;

CREATE TABLE IF NOT EXISTS `hr_skills` (
    `id`          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `name`        VARCHAR(190) NOT NULL,
    `category`    VARCHAR(190) NULL,
    `description` TEXT NULL,
    `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY `uniq_skill_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `hr_employee_skills` (
    `id`             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `employee_id`    INT UNSIGNED NOT NULL,
    `skill_id`       INT UNSIGNED NOT NULL,
    `current_level`  TINYINT UNSIGNED NOT NULL DEFAULT 0,   -- 0 = none, 5 = expert
    `target_level`   TINYINT UNSIGNED NOT NULL DEFAULT 0,
    `notes`          TEXT NULL,
    `assessed_at`    DATETIME NULL,
    `created_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY `uniq_emp_skill` (`employee_id`, `skill_id`),
    CONSTRAINT `fk_es_emp`   FOREIGN KEY (`employee_id`) REFERENCES `hr_employees`(`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_es_skill` FOREIGN KEY (`skill_id`)    REFERENCES `hr_skills`(`id`)    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
