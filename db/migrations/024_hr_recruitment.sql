-- Migration 024: Recruitment / ATS.

USE `builtrightstudio_cms`;

CREATE TABLE IF NOT EXISTS `hr_jobs` (
    `id`              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `title`           VARCHAR(190) NOT NULL,
    `slug`            VARCHAR(120) NOT NULL UNIQUE,
    `department`      VARCHAR(120) NULL,
    `location`        VARCHAR(120) NULL,
    `employment_type` ENUM('full_time','part_time','contractor','intern') NOT NULL DEFAULT 'full_time',
    `salary_min`      DECIMAL(10,2) NULL,
    `salary_max`      DECIMAL(10,2) NULL,
    `salary_currency` VARCHAR(8) NOT NULL DEFAULT 'GBP',
    `description`     TEXT NULL,
    `status`          ENUM('draft','open','closed') NOT NULL DEFAULT 'draft',
    `posted_at`       DATETIME NULL,
    `closed_at`       DATETIME NULL,
    `created_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `hr_candidates` (
    `id`              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `first_name`      VARCHAR(80) NOT NULL,
    `last_name`       VARCHAR(80) NOT NULL,
    `email`           VARCHAR(190) NOT NULL,
    `phone`           VARCHAR(40) NULL,
    `cv_path`         VARCHAR(500) NULL,
    `linkedin_url`    VARCHAR(300) NULL,
    `source`          VARCHAR(60) NULL,
    `notes`           TEXT NULL,
    `created_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY `uniq_cand_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `hr_applications` (
    `id`            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `job_id`        INT UNSIGNED NOT NULL,
    `candidate_id`  INT UNSIGNED NOT NULL,
    `stage`         ENUM('applied','screening','interview','offer','hired','rejected') NOT NULL DEFAULT 'applied',
    `rating`        TINYINT NULL,
    `recruiter_notes` TEXT NULL,
    `applied_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `decided_at`    DATETIME NULL,
    `sort_order`    INT NOT NULL DEFAULT 0,
    UNIQUE KEY `uniq_job_cand` (`job_id`, `candidate_id`),
    CONSTRAINT `fk_app_job`  FOREIGN KEY (`job_id`)       REFERENCES `hr_jobs`(`id`)       ON DELETE CASCADE,
    CONSTRAINT `fk_app_cand` FOREIGN KEY (`candidate_id`) REFERENCES `hr_candidates`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `hr_interviews` (
    `id`              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `application_id`  INT UNSIGNED NOT NULL,
    `scheduled_at`    DATETIME NOT NULL,
    `kind`            ENUM('phone','video','onsite','technical','culture','panel','other') NOT NULL DEFAULT 'video',
    `interviewer_id`  INT UNSIGNED NULL,
    `feedback`        TEXT NULL,
    `rating`          TINYINT NULL,
    `created_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_int_app` FOREIGN KEY (`application_id`) REFERENCES `hr_applications`(`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_int_user` FOREIGN KEY (`interviewer_id`) REFERENCES `admin_users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
