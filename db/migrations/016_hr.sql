-- Migration 016: HR system foundation.
--   • hr_employees           — extends admin_users with HR-specific data
--   • hr_employment_history  — title/salary changes
--   • hr_onboarding_tasks    — checklist per employee
--   • hr_documents           — uploaded files (contracts, IDs, etc.)
--   • hr_payroll_periods     — pay periods (e.g., monthly cycles)
--   • hr_payslips            — payslip per employee per period
--   • hr_time_off_balances   — accruals
--   • hr_time_off_requests   — leave requests

USE `builtrightstudio_cms`;

CREATE TABLE IF NOT EXISTS `hr_employees` (
    `id`               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `admin_user_id`    INT UNSIGNED NOT NULL UNIQUE,
    `first_name`       VARCHAR(80)  NOT NULL,
    `last_name`        VARCHAR(80)  NOT NULL,
    `preferred_name`   VARCHAR(80)  NULL,
    `dob`              DATE NULL,
    `phone`            VARCHAR(40)  NULL,
    `address_line1`    VARCHAR(190) NULL,
    `address_line2`    VARCHAR(190) NULL,
    `city`             VARCHAR(80)  NULL,
    `region`           VARCHAR(80)  NULL,
    `postcode`         VARCHAR(20)  NULL,
    `country`          VARCHAR(80)  NULL,
    `emergency_name`   VARCHAR(120) NULL,
    `emergency_phone`  VARCHAR(40)  NULL,
    `emergency_rel`    VARCHAR(60)  NULL,
    `position`         VARCHAR(120) NULL,
    `department`       VARCHAR(120) NULL,
    `employment_type`  ENUM('full_time','part_time','contractor','intern') NOT NULL DEFAULT 'full_time',
    `manager_id`       INT UNSIGNED NULL,
    `hire_date`        DATE NULL,
    `end_date`         DATE NULL,
    `status`           ENUM('onboarding','active','on_leave','terminated') NOT NULL DEFAULT 'onboarding',
    `salary_amount`    DECIMAL(10,2) NULL,
    `salary_currency`  VARCHAR(8)   NOT NULL DEFAULT 'GBP',
    `salary_period`    ENUM('hourly','monthly','annual') NOT NULL DEFAULT 'annual',
    `pto_days_year`    DECIMAL(5,1) NOT NULL DEFAULT 25,
    `notes`            TEXT NULL,
    `created_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT `fk_emp_user`    FOREIGN KEY (`admin_user_id`) REFERENCES `admin_users`(`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_emp_manager` FOREIGN KEY (`manager_id`)    REFERENCES `hr_employees`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `hr_employment_history` (
    `id`              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `employee_id`     INT UNSIGNED NOT NULL,
    `effective_date`  DATE NOT NULL,
    `event_type`      ENUM('hired','promotion','title_change','salary_change','team_change','status_change','terminated') NOT NULL,
    `old_value`       VARCHAR(255) NULL,
    `new_value`       VARCHAR(255) NULL,
    `notes`           TEXT NULL,
    `created_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_emphist_emp` FOREIGN KEY (`employee_id`) REFERENCES `hr_employees`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `hr_onboarding_tasks` (
    `id`           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `employee_id`  INT UNSIGNED NOT NULL,
    `title`        VARCHAR(190) NOT NULL,
    `description`  TEXT NULL,
    `category`     VARCHAR(60) NULL,
    `due_date`     DATE NULL,
    `is_done`      TINYINT(1) NOT NULL DEFAULT 0,
    `done_at`      DATETIME NULL,
    `sort_order`   INT NOT NULL DEFAULT 0,
    `created_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_onboarding_emp` FOREIGN KEY (`employee_id`) REFERENCES `hr_employees`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `hr_documents` (
    `id`           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `employee_id`  INT UNSIGNED NOT NULL,
    `category`     VARCHAR(60)  NOT NULL DEFAULT 'general',
    `title`        VARCHAR(190) NOT NULL,
    `file_path`    VARCHAR(500) NOT NULL,
    `file_size`    INT UNSIGNED NULL,
    `mime_type`    VARCHAR(120) NULL,
    `uploaded_by`  INT UNSIGNED NULL,
    `uploaded_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_doc_emp`  FOREIGN KEY (`employee_id`) REFERENCES `hr_employees`(`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_doc_user` FOREIGN KEY (`uploaded_by`) REFERENCES `admin_users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `hr_payroll_periods` (
    `id`         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `name`       VARCHAR(80)  NOT NULL,
    `start_date` DATE NOT NULL,
    `end_date`   DATE NOT NULL,
    `pay_date`   DATE NULL,
    `status`     ENUM('draft','approved','paid') NOT NULL DEFAULT 'draft',
    `notes`      TEXT NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `hr_payslips` (
    `id`             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `period_id`      INT UNSIGNED NOT NULL,
    `employee_id`    INT UNSIGNED NOT NULL,
    `gross_amount`   DECIMAL(10,2) NOT NULL DEFAULT 0,
    `tax_amount`     DECIMAL(10,2) NOT NULL DEFAULT 0,
    `ni_amount`      DECIMAL(10,2) NOT NULL DEFAULT 0,
    `other_deduct`   DECIMAL(10,2) NOT NULL DEFAULT 0,
    `bonus_amount`   DECIMAL(10,2) NOT NULL DEFAULT 0,
    `net_amount`     DECIMAL(10,2) NOT NULL DEFAULT 0,
    `currency`       VARCHAR(8)   NOT NULL DEFAULT 'GBP',
    `notes`          TEXT NULL,
    `created_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY `uniq_period_emp` (`period_id`, `employee_id`),
    CONSTRAINT `fk_slip_period` FOREIGN KEY (`period_id`)   REFERENCES `hr_payroll_periods`(`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_slip_emp`    FOREIGN KEY (`employee_id`) REFERENCES `hr_employees`(`id`)      ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `hr_time_off_requests` (
    `id`            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `employee_id`   INT UNSIGNED NOT NULL,
    `kind`          ENUM('vacation','sick','personal','unpaid','other') NOT NULL DEFAULT 'vacation',
    `start_date`    DATE NOT NULL,
    `end_date`      DATE NOT NULL,
    `days`          DECIMAL(5,1) NOT NULL DEFAULT 0,
    `notes`         TEXT NULL,
    `status`        ENUM('pending','approved','denied','cancelled') NOT NULL DEFAULT 'pending',
    `reviewed_by`   INT UNSIGNED NULL,
    `reviewed_at`   DATETIME NULL,
    `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_to_emp`      FOREIGN KEY (`employee_id`) REFERENCES `hr_employees`(`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_to_reviewer` FOREIGN KEY (`reviewed_by`) REFERENCES `admin_users`(`id`)  ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
