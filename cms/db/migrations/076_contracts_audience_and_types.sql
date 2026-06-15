-- Migration 076: Multi-audience contracts.
--
-- Until now, every contract template (hr_document_types.kind='contract') was
-- fanned out to active employees only — fine while contracts were an
-- HR-only concept. This migration generalises contracts so HR can roll one
-- template out to clients / partners / affiliates / contractors as well.
--
-- 1. `contract_types`        — editable lookup of contract categories
--                              (NDA / MSA / employment / etc.). FK'd from
--                              `hr_document_types.contract_type_id` so the
--                              same metadata can be reused across audiences.
-- 2. `hr_document_types` gains `audience` + `contract_type_id` so a
--                              `kind='contract'` row is now polymorphic
--                              across the five audiences.
-- 3. Four parallel `*_documents` tables that mirror the `hr_documents`
--                              shape. The fan-out in routes/hr.php picks
--                              the right table based on `audience`, and the
--                              create handlers in clients.php / partners.php /
--                              affiliates.php / contractors.php replay
--                              every audience-matched contract for the new
--                              record so existing templates keep being
--                              applied to new entities.
--
-- Sign flow on non-employees is admin-only for now (HR confirms the row
-- on behalf of the counter-party). A public/portal sign flow per entity
-- would build on the same `signed_*` columns.

USE `builtrightstudio_cms`;

-- 1. Lookup table -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS `contract_types` (
  `id`         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `name`       VARCHAR(120) NOT NULL,
  `slug`       VARCHAR(60)  NOT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uniq_slug` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `contract_types` (name, slug, sort_order) VALUES
  ('NDA',                       'nda',         10),
  ('Employment contract',       'employment',  20),
  ('Master services agreement', 'msa',         30),
  ('Statement of work',         'sow',         40),
  ('Consultancy agreement',     'consultancy', 50),
  ('Partnership agreement',     'partnership', 60),
  ('Affiliate agreement',       'affiliate',   70),
  ('Service agreement',         'service',     80),
  ('Reseller agreement',        'reseller',    90),
  ('Other',                     'other',      100);

-- 2. hr_document_types extensions ------------------------------------------
ALTER TABLE `hr_document_types`
  ADD COLUMN `audience` ENUM('employee','client','partner','affiliate','contractor')
    NOT NULL DEFAULT 'employee' AFTER `kind`,
  ADD COLUMN `contract_type_id` INT UNSIGNED NULL AFTER `audience`,
  ADD CONSTRAINT `fk_doc_contract_type` FOREIGN KEY (`contract_type_id`)
    REFERENCES `contract_types`(`id`) ON DELETE SET NULL;

-- 3. Per-audience documents tables (mirror hr_documents) -------------------
CREATE TABLE IF NOT EXISTS `client_documents` (
  `id`                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `client_id`          INT UNSIGNED NOT NULL,
  `doc_type_id`        INT UNSIGNED NULL,
  `category`           VARCHAR(60)  NOT NULL DEFAULT 'contract',
  `title`              VARCHAR(190) NOT NULL,
  `file_path`          VARCHAR(500) NOT NULL,
  `file_size`          INT UNSIGNED NULL,
  `mime_type`          VARCHAR(120) NULL,
  `reference_number`   VARCHAR(120) NULL,
  `issued_at`          DATE NULL,
  `expires_at`         DATE NULL,
  `requires_signature` TINYINT(1) NOT NULL DEFAULT 1,
  `signed_at`          DATETIME NULL,
  `signed_by`          INT UNSIGNED NULL,
  `signature_data`     MEDIUMTEXT NULL,
  `uploaded_by`        INT UNSIGNED NULL,
  `uploaded_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_client`     (`client_id`),
  KEY `idx_doc_type`   (`doc_type_id`),
  CONSTRAINT `fk_cdoc_client`   FOREIGN KEY (`client_id`)   REFERENCES `clients`(`id`)            ON DELETE CASCADE,
  CONSTRAINT `fk_cdoc_type`     FOREIGN KEY (`doc_type_id`) REFERENCES `hr_document_types`(`id`)  ON DELETE SET NULL,
  CONSTRAINT `fk_cdoc_signer`   FOREIGN KEY (`signed_by`)   REFERENCES `admin_users`(`id`)        ON DELETE SET NULL,
  CONSTRAINT `fk_cdoc_uploader` FOREIGN KEY (`uploaded_by`) REFERENCES `admin_users`(`id`)        ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `partner_documents` (
  `id`                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `partner_id`         INT UNSIGNED NOT NULL,
  `doc_type_id`        INT UNSIGNED NULL,
  `category`           VARCHAR(60)  NOT NULL DEFAULT 'contract',
  `title`              VARCHAR(190) NOT NULL,
  `file_path`          VARCHAR(500) NOT NULL,
  `file_size`          INT UNSIGNED NULL,
  `mime_type`          VARCHAR(120) NULL,
  `reference_number`   VARCHAR(120) NULL,
  `issued_at`          DATE NULL,
  `expires_at`         DATE NULL,
  `requires_signature` TINYINT(1) NOT NULL DEFAULT 1,
  `signed_at`          DATETIME NULL,
  `signed_by`          INT UNSIGNED NULL,
  `signature_data`     MEDIUMTEXT NULL,
  `uploaded_by`        INT UNSIGNED NULL,
  `uploaded_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_partner`    (`partner_id`),
  KEY `idx_doc_type`   (`doc_type_id`),
  CONSTRAINT `fk_pdoc_partner`  FOREIGN KEY (`partner_id`)  REFERENCES `partners`(`id`)           ON DELETE CASCADE,
  CONSTRAINT `fk_pdoc_type`     FOREIGN KEY (`doc_type_id`) REFERENCES `hr_document_types`(`id`)  ON DELETE SET NULL,
  CONSTRAINT `fk_pdoc_signer`   FOREIGN KEY (`signed_by`)   REFERENCES `admin_users`(`id`)        ON DELETE SET NULL,
  CONSTRAINT `fk_pdoc_uploader` FOREIGN KEY (`uploaded_by`) REFERENCES `admin_users`(`id`)        ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `affiliate_documents` (
  `id`                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `affiliate_id`       INT UNSIGNED NOT NULL,
  `doc_type_id`        INT UNSIGNED NULL,
  `category`           VARCHAR(60)  NOT NULL DEFAULT 'contract',
  `title`              VARCHAR(190) NOT NULL,
  `file_path`          VARCHAR(500) NOT NULL,
  `file_size`          INT UNSIGNED NULL,
  `mime_type`          VARCHAR(120) NULL,
  `reference_number`   VARCHAR(120) NULL,
  `issued_at`          DATE NULL,
  `expires_at`         DATE NULL,
  `requires_signature` TINYINT(1) NOT NULL DEFAULT 1,
  `signed_at`          DATETIME NULL,
  `signed_by`          INT UNSIGNED NULL,
  `signature_data`     MEDIUMTEXT NULL,
  `uploaded_by`        INT UNSIGNED NULL,
  `uploaded_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_affiliate`  (`affiliate_id`),
  KEY `idx_doc_type`   (`doc_type_id`),
  CONSTRAINT `fk_adoc_affiliate` FOREIGN KEY (`affiliate_id`) REFERENCES `affiliates`(`id`)        ON DELETE CASCADE,
  CONSTRAINT `fk_adoc_type`      FOREIGN KEY (`doc_type_id`)  REFERENCES `hr_document_types`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_adoc_signer`    FOREIGN KEY (`signed_by`)    REFERENCES `admin_users`(`id`)       ON DELETE SET NULL,
  CONSTRAINT `fk_adoc_uploader`  FOREIGN KEY (`uploaded_by`)  REFERENCES `admin_users`(`id`)       ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `contractor_documents` (
  `id`                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `contractor_id`      INT UNSIGNED NOT NULL,
  `doc_type_id`        INT UNSIGNED NULL,
  `category`           VARCHAR(60)  NOT NULL DEFAULT 'contract',
  `title`              VARCHAR(190) NOT NULL,
  `file_path`          VARCHAR(500) NOT NULL,
  `file_size`          INT UNSIGNED NULL,
  `mime_type`          VARCHAR(120) NULL,
  `reference_number`   VARCHAR(120) NULL,
  `issued_at`          DATE NULL,
  `expires_at`         DATE NULL,
  `requires_signature` TINYINT(1) NOT NULL DEFAULT 1,
  `signed_at`          DATETIME NULL,
  `signed_by`          INT UNSIGNED NULL,
  `signature_data`     MEDIUMTEXT NULL,
  `uploaded_by`        INT UNSIGNED NULL,
  `uploaded_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_contractor` (`contractor_id`),
  KEY `idx_doc_type`   (`doc_type_id`),
  CONSTRAINT `fk_xdoc_contractor` FOREIGN KEY (`contractor_id`) REFERENCES `contractors`(`id`)       ON DELETE CASCADE,
  CONSTRAINT `fk_xdoc_type`       FOREIGN KEY (`doc_type_id`)   REFERENCES `hr_document_types`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_xdoc_signer`     FOREIGN KEY (`signed_by`)     REFERENCES `admin_users`(`id`)       ON DELETE SET NULL,
  CONSTRAINT `fk_xdoc_uploader`   FOREIGN KEY (`uploaded_by`)   REFERENCES `admin_users`(`id`)       ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
