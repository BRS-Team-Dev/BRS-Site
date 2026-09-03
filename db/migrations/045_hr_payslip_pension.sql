-- Migration 045: separate pension contribution column on payslips so it can
-- be displayed and reported separately from "other deductions". Net pay is
-- (re)computed by the API on upsert as gross + bonus − tax − ni − other − pension.

USE `builtrightstudio_cms`;

ALTER TABLE `hr_payslips`
    ADD COLUMN `pension_amount`         DECIMAL(10, 2) NOT NULL DEFAULT 0 AFTER `other_deduct`,
    ADD COLUMN `employer_pension_amount` DECIMAL(10, 2) NOT NULL DEFAULT 0 AFTER `pension_amount`;
