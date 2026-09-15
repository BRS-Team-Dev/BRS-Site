-- Migration 077: Recruitment system — agency placing candidates with
-- external clients.
--
-- The recruitment system reuses the existing `clients` table (a client
-- = a company hiring through us) via a new `is_recruitment_client` flag
-- so the same company can also be a CRM client without duplication.
-- Candidates, their compliance documents, and the agency-side document
-- catalogue all live in new tables.
--
-- Sign flow on the candidate's joining contract reuses the
-- `recruitment_candidate_documents.signed_at` columns, populated either
-- by an admin (HR signs on the candidate's behalf after manual
-- verification) or eventually by a public candidate-portal sign endpoint.
--
-- 1. `clients.is_recruitment_client` — distinguishes recruitment clients
--    from CRM-only ones; filtered via the existing /api/clients endpoint.
-- 2. `recruitment_candidates` — the candidate roster.
-- 3. `recruitment_doc_types` — agency-controlled catalogue of what
--    candidates have to submit (right-to-work, DBS, certs, etc.).
--    Editable from /recruitment/settings.
-- 4. `recruitment_candidate_documents` — per-candidate uploaded files,
--    optionally tied to a doc_type for compliance tracking.
-- 5. `recruitment_candidate_notes` — free-form notes per candidate.

USE `builtrightstudio_cms`;

-- 1. clients flag ---------------------------------------------------------
ALTER TABLE `clients`
  ADD COLUMN `is_recruitment_client` TINYINT(1) NOT NULL DEFAULT 0 AFTER `notes`,
  ADD KEY `idx_recruitment_client` (`is_recruitment_client`);

-- 2. Candidates -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS `recruitment_candidates` (
  `id`                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `first_name`          VARCHAR(80)  NOT NULL,
  `last_name`           VARCHAR(80)  NOT NULL,
  `email`               VARCHAR(190) NULL,
  `phone`               VARCHAR(40)  NULL,
  `dob`                 DATE NULL,
  `nationality`         VARCHAR(80)  NULL,
  `address_line1`       VARCHAR(190) NULL,
  `address_line2`       VARCHAR(190) NULL,
  `city`                VARCHAR(80)  NULL,
  `region`              VARCHAR(80)  NULL,
  `postcode`            VARCHAR(20)  NULL,
  `country`             VARCHAR(80)  NULL,
  -- Profile
  `role`                VARCHAR(120) NULL,                    -- target role (e.g. "Quantity Surveyor")
  `discipline`          VARCHAR(120) NULL,                    -- field (Construction, IT, Finance, …)
  `experience_level`    ENUM('junior','mid','senior','lead','principal') NULL,
  `experience_years`    INT NULL,
  `day_rate`            DECIMAL(10,2) NULL,                   -- preferred rate
  `currency`            CHAR(3) NOT NULL DEFAULT 'GBP',
  `availability`        ENUM('immediate','one_week','two_weeks','one_month','later') NULL,
  `cv_file_path`        VARCHAR(500) NULL,
  `cv_file_size`        INT UNSIGNED NULL,
  `cv_mime_type`        VARCHAR(120) NULL,
  -- Pipeline status
  `status`              ENUM('new','screening','onboarding','available','placed','rejected','inactive')
                         NOT NULL DEFAULT 'new',
  `source`              VARCHAR(80) NULL,                     -- job board / referral / etc.
  -- Agency-side contract (the candidate signs on joining the books)
  `contract_doc_id`     INT UNSIGNED NULL,                    -- FK to recruitment_candidate_documents once issued
  `contract_signed_at`  DATETIME NULL,
  `notes`               TEXT NULL,                            -- short profile blurb (long-form goes in notes table)
  `created_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `idx_status` (`status`),
  KEY `idx_email`  (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Document-type catalogue (settings-controlled) ------------------------
CREATE TABLE IF NOT EXISTS `recruitment_doc_types` (
  `id`                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `name`                VARCHAR(120) NOT NULL,
  `description`         TEXT NULL,
  `is_required`         TINYINT(1) NOT NULL DEFAULT 1,
  `needs_reference`     TINYINT(1) NOT NULL DEFAULT 0,
  `needs_issue_date`    TINYINT(1) NOT NULL DEFAULT 0,
  `needs_expiry_date`   TINYINT(1) NOT NULL DEFAULT 0,
  `sort_order`          INT NOT NULL DEFAULT 0,
  `created_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `recruitment_doc_types`
  (name, description, is_required, needs_reference, needs_issue_date, needs_expiry_date, sort_order) VALUES
  ('Right to work',              'Visa, share code, or other proof of legal right to work in the UK.',     1, 1, 0, 1, 10),
  ('Passport / National ID',     'Government-issued photo ID.',                                            1, 1, 1, 1, 20),
  ('Proof of address',           'Utility bill, bank statement, or council tax — dated within 3 months.', 1, 0, 1, 0, 30),
  ('National Insurance number',  'NI number letter or HMRC document.',                                    1, 1, 0, 0, 40),
  ('Enhanced DBS (if required)', 'For roles that need an enhanced criminal-record check.',                0, 1, 1, 1, 50),
  ('CSCS card',                  'Required for construction site work.',                                  0, 1, 1, 1, 60),
  ('References',                 'Two professional references with contact details.',                     1, 0, 0, 0, 70),
  ('Bank details',               'Sort code + account number for payroll.',                                1, 0, 0, 0, 80);

-- 4. Candidate-uploaded documents ----------------------------------------
CREATE TABLE IF NOT EXISTS `recruitment_candidate_documents` (
  `id`                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `candidate_id`        INT UNSIGNED NOT NULL,
  `doc_type_id`         INT UNSIGNED NULL,
  `title`               VARCHAR(190) NOT NULL,
  `file_path`           VARCHAR(500) NOT NULL,
  `file_size`           INT UNSIGNED NULL,
  `mime_type`           VARCHAR(120) NULL,
  `reference_number`    VARCHAR(120) NULL,
  `issued_at`           DATE NULL,
  `expires_at`          DATE NULL,
  `requires_signature`  TINYINT(1) NOT NULL DEFAULT 0,
  `signed_at`           DATETIME NULL,
  `signed_by`           INT UNSIGNED NULL,                    -- admin who confirmed
  `signature_data`      MEDIUMTEXT NULL,
  `status`              ENUM('pending','valid','expired','rejected') NOT NULL DEFAULT 'pending',
  `uploaded_by`         INT UNSIGNED NULL,
  `uploaded_at`         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_candidate`   (`candidate_id`),
  KEY `idx_doc_type`    (`doc_type_id`),
  KEY `idx_status`      (`status`),
  CONSTRAINT `fk_rcdoc_candidate` FOREIGN KEY (`candidate_id`) REFERENCES `recruitment_candidates`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_rcdoc_type`      FOREIGN KEY (`doc_type_id`)  REFERENCES `recruitment_doc_types`(`id`)  ON DELETE SET NULL,
  CONSTRAINT `fk_rcdoc_signer`    FOREIGN KEY (`signed_by`)    REFERENCES `admin_users`(`id`)            ON DELETE SET NULL,
  CONSTRAINT `fk_rcdoc_uploader`  FOREIGN KEY (`uploaded_by`)  REFERENCES `admin_users`(`id`)            ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Candidate notes ----------------------------------------------------
CREATE TABLE IF NOT EXISTS `recruitment_candidate_notes` (
  `id`                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `candidate_id`        INT UNSIGNED NOT NULL,
  `title`               VARCHAR(190) NOT NULL,
  `body`                TEXT NULL,
  `sort_order`          INT NOT NULL DEFAULT 0,
  `created_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `idx_candidate`   (`candidate_id`),
  CONSTRAINT `fk_rcnote_candidate` FOREIGN KEY (`candidate_id`) REFERENCES `recruitment_candidates`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
