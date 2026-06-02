-- Migration 026: HR-managed required document types + supporting metadata on uploads.

USE `builtrightstudio_cms`;

-- Catalogue of document types HR expects from new hires.
CREATE TABLE IF NOT EXISTS `hr_document_types` (
    `id`                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `name`                  VARCHAR(120) NOT NULL,
    `description`           TEXT NULL,
    `is_required`           TINYINT(1) NOT NULL DEFAULT 1,
    `needs_reference`       TINYINT(1) NOT NULL DEFAULT 0,
    `needs_issue_date`      TINYINT(1) NOT NULL DEFAULT 0,
    `needs_expiry_date`     TINYINT(1) NOT NULL DEFAULT 0,
    `sort_order`            INT NOT NULL DEFAULT 0,
    `created_at`            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `hr_document_types`
  (name, description, is_required, needs_reference, needs_issue_date, needs_expiry_date, sort_order) VALUES
  ('Passport / National ID',       'A clear photo or scan of your government-issued photo ID.',                            1, 1, 1, 1, 10),
  ('Right to work',                'Visa, share code, or other proof you can legally work in the UK.',                    1, 1, 0, 1, 20),
  ('Signed employment contract',   'Upload the version you signed and dated.',                                            1, 0, 1, 0, 30),
  ('P45 / new starter checklist',  'P45 from your previous employer, or HMRC starter checklist if it''s your first job.', 1, 0, 1, 0, 40),
  ('Bank details',                 'Account name, sort code, and account number for payroll.',                            1, 0, 0, 0, 50),
  ('Emergency contact verification', 'Optional — only if HR has asked for it.',                                           0, 0, 0, 0, 60);

-- Per-upload metadata so HR can see what each file represents.
ALTER TABLE `hr_documents`
    ADD COLUMN `doc_type_id`      INT UNSIGNED NULL AFTER `category`,
    ADD COLUMN `reference_number` VARCHAR(120) NULL AFTER `doc_type_id`,
    ADD COLUMN `issued_at`        DATE NULL AFTER `reference_number`,
    ADD COLUMN `expires_at`       DATE NULL AFTER `issued_at`,
    ADD CONSTRAINT `fk_doc_type` FOREIGN KEY (`doc_type_id`) REFERENCES `hr_document_types`(`id`) ON DELETE SET NULL;

-- Default onboarding checklist applied to each new hire so the portal always has something.
CREATE TABLE IF NOT EXISTS `hr_default_onboarding_tasks` (
    `id`          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `title`       VARCHAR(190) NOT NULL,
    `description` TEXT NULL,
    `category`    VARCHAR(60) NULL,
    `sort_order`  INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `hr_default_onboarding_tasks` (title, description, category, sort_order) VALUES
  ('Read the employee handbook',          NULL, 'admin', 10),
  ('Set up your workstation and software', NULL, 'tech',  20),
  ('Meet your direct manager',            NULL, 'people', 30),
  ('Complete tax + payroll setup',        NULL, 'admin',  40),
  ('Book a 1:1 with HR for first-week check-in', NULL, 'people', 50);
