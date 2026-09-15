-- Migration 027: extend hr_employees with full HR-record fields a UK company
-- typically holds — identity, payroll/tax, banking, equality data.

USE `builtrightstudio_cms`;

ALTER TABLE `hr_employees`
    -- Identity / personal
    ADD COLUMN `pronouns`                  VARCHAR(40)  NULL AFTER `preferred_name`,
    ADD COLUMN `gender`                    VARCHAR(40)  NULL AFTER `pronouns`,
    ADD COLUMN `nationality`               VARCHAR(80)  NULL AFTER `gender`,
    ADD COLUMN `national_insurance_number` VARCHAR(20)  NULL AFTER `nationality`,
    ADD COLUMN `linkedin_url`              VARCHAR(300) NULL AFTER `national_insurance_number`,
    -- Tax / payroll
    ADD COLUMN `tax_code`                  VARCHAR(20)  NULL AFTER `linkedin_url`,
    ADD COLUMN `student_loan_plan`         ENUM('none','plan_1','plan_2','plan_4','postgrad') NOT NULL DEFAULT 'none' AFTER `tax_code`,
    ADD COLUMN `pension_opt_in`            TINYINT(1)   NOT NULL DEFAULT 1 AFTER `student_loan_plan`,
    ADD COLUMN `bank_name`                 VARCHAR(120) NULL AFTER `pension_opt_in`,
    ADD COLUMN `bank_account_name`         VARCHAR(120) NULL AFTER `bank_name`,
    ADD COLUMN `sort_code`                 VARCHAR(20)  NULL AFTER `bank_account_name`,
    ADD COLUMN `account_number`            VARCHAR(40)  NULL AFTER `sort_code`,
    -- Equality (all optional)
    ADD COLUMN `ethnicity`                 VARCHAR(80)  NULL AFTER `account_number`,
    ADD COLUMN `disability_status`         VARCHAR(80)  NULL AFTER `ethnicity`,
    ADD COLUMN `accommodations_needed`     TEXT         NULL AFTER `disability_status`,
    ADD COLUMN `dietary_requirements`      TEXT         NULL AFTER `accommodations_needed`,
    ADD COLUMN `tshirt_size`               VARCHAR(10)  NULL AFTER `dietary_requirements`;
