-- Extras layered on top of the HR foundation:
--   • PTO balance tracking (taken / accrued + history)
--   • Document e-signing fields
--   • Payroll period CSV/print metadata (just notes, no schema change for export itself)

USE `builtrightstudio_cms`;

-- ---------- PTO ----------
ALTER TABLE `hr_employees`
    ADD COLUMN `pto_taken_days`    DECIMAL(6,1) NOT NULL DEFAULT 0 AFTER `pto_days_year`,
    ADD COLUMN `pto_accrued_days`  DECIMAL(6,1) NOT NULL DEFAULT 0 AFTER `pto_taken_days`;

CREATE TABLE IF NOT EXISTS `hr_pto_ledger` (
    `id`            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `employee_id`   INT UNSIGNED NOT NULL,
    `effective_date` DATE NOT NULL,
    `kind`          ENUM('accrual','adjust','taken','reset') NOT NULL,
    `days`          DECIMAL(5,1) NOT NULL,
    `notes`         VARCHAR(255) NULL,
    `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_ptoled_emp` FOREIGN KEY (`employee_id`) REFERENCES `hr_employees`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- E-sign ----------
ALTER TABLE `hr_documents`
    ADD COLUMN `requires_signature` TINYINT(1) NOT NULL DEFAULT 0 AFTER `mime_type`,
    ADD COLUMN `signed_at`          DATETIME NULL,
    ADD COLUMN `signed_by`          INT UNSIGNED NULL,
    ADD COLUMN `signature_data`     MEDIUMTEXT NULL,
    ADD CONSTRAINT `fk_doc_signer` FOREIGN KEY (`signed_by`) REFERENCES `admin_users`(`id`) ON DELETE SET NULL;
