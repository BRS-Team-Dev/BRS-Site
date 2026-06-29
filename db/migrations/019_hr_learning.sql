-- Migration 019: Learning & development
--   • hr_courses              — course catalog (title, provider, link, required, etc.)
--   • hr_course_assignments   — (employee, course) with status + due date + completion
--   • hr_certifications       — external certs not tied to a tracked course

USE `builtrightstudio_cms`;

CREATE TABLE IF NOT EXISTS `hr_courses` (
    `id`              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `title`           VARCHAR(190) NOT NULL,
    `provider`        VARCHAR(120) NULL,
    `category`        VARCHAR(60)  NULL,
    `description`     TEXT NULL,
    `link`            VARCHAR(500) NULL,
    `duration_hours`  DECIMAL(5,1) NULL,
    `is_required`     TINYINT(1) NOT NULL DEFAULT 0,
    `is_active`       TINYINT(1) NOT NULL DEFAULT 1,
    `created_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `hr_course_assignments` (
    `id`              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `employee_id`     INT UNSIGNED NOT NULL,
    `course_id`       INT UNSIGNED NOT NULL,
    `assigned_by`     INT UNSIGNED NULL,
    `assigned_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `due_date`        DATE NULL,
    `status`          ENUM('not_started','in_progress','completed','expired') NOT NULL DEFAULT 'not_started',
    `completed_at`    DATETIME NULL,
    `score`           DECIMAL(5,1) NULL,
    `certificate_path` VARCHAR(500) NULL,
    `notes`           TEXT NULL,
    UNIQUE KEY `uniq_emp_course` (`employee_id`, `course_id`),
    CONSTRAINT `fk_ca_emp`     FOREIGN KEY (`employee_id`) REFERENCES `hr_employees`(`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_ca_course`  FOREIGN KEY (`course_id`)   REFERENCES `hr_courses`(`id`)   ON DELETE CASCADE,
    CONSTRAINT `fk_ca_user`    FOREIGN KEY (`assigned_by`) REFERENCES `admin_users`(`id`)  ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `hr_certifications` (
    `id`           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `employee_id`  INT UNSIGNED NOT NULL,
    `name`         VARCHAR(190) NOT NULL,
    `issuer`       VARCHAR(120) NULL,
    `issued_at`    DATE NULL,
    `expires_at`   DATE NULL,
    `credential_id` VARCHAR(120) NULL,
    `file_path`    VARCHAR(500) NULL,
    `notes`        TEXT NULL,
    `created_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_cert_emp` FOREIGN KEY (`employee_id`) REFERENCES `hr_employees`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
