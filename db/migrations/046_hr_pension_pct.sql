-- Migration 046: per-employee pension contribution rates so each person can
-- choose their own % (between 0 and 14) above the auto-enrolment minimums.
-- Defaults stay at the UK auto-enrolment minimum: 5% employee, 3% employer.

USE `builtrightstudio_cms`;

ALTER TABLE `hr_employees`
    ADD COLUMN `pension_employee_pct` DECIMAL(4, 2) NOT NULL DEFAULT 5.00 AFTER `pension_opt_in`,
    ADD COLUMN `pension_employer_pct` DECIMAL(4, 2) NOT NULL DEFAULT 3.00 AFTER `pension_employee_pct`;
