-- Migration 030: course authoring — multi-module courses with text / video / quiz
-- modules and per-module progress tracking.

USE `builtrightstudio_cms`;

CREATE TABLE IF NOT EXISTS `hr_course_modules` (
    `id`         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `course_id`  INT UNSIGNED NOT NULL,
    `title`      VARCHAR(190) NOT NULL,
    `kind`       ENUM('text','video','quiz') NOT NULL DEFAULT 'text',
    `body`       MEDIUMTEXT NULL,             -- markdown / plain text
    `video_url`  VARCHAR(500) NULL,           -- youtube / vimeo / mp4
    `quiz_json`  JSON NULL,                   -- [{ id, prompt, options: [...], correct: [indices] }]
    `pass_score` TINYINT NOT NULL DEFAULT 100,-- quizzes default to 100 % required
    `sort_order` INT NOT NULL DEFAULT 0,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT `fk_mod_course` FOREIGN KEY (`course_id`) REFERENCES `hr_courses`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `hr_course_module_progress` (
    `id`             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `assignment_id`  INT UNSIGNED NOT NULL,
    `module_id`      INT UNSIGNED NOT NULL,
    `completed_at`   DATETIME NULL,
    `quiz_score`     TINYINT NULL,            -- 0..100
    `quiz_attempts`  INT NOT NULL DEFAULT 0,
    UNIQUE KEY `uniq_assign_mod` (`assignment_id`, `module_id`),
    CONSTRAINT `fk_modprog_assign` FOREIGN KEY (`assignment_id`) REFERENCES `hr_course_assignments`(`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_modprog_mod`    FOREIGN KEY (`module_id`)     REFERENCES `hr_course_modules`(`id`)    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
