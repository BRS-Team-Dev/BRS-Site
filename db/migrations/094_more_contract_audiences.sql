-- Migration 094: broaden the contract-recipient taxonomy.
--
-- Adds the remaining real entities the company can send a contract to, plus
-- two forward-looking audiences for relationships we anticipate but don't yet
-- have an entity table for:
--
--   lead       → CRM prospects (leads)            — entity-backed, fans out
--   applicant  → in-house job applicants (hr_candidates) — entity-backed, fans out
--   supplier   → suppliers / vendors              — FORWARD-LOOKING (label only;
--                no entity table yet, so contracts authored for it just sit as
--                templates and distribute to nobody until a supplier system exists)
--   investor   → investors / shareholders         — FORWARD-LOOKING (label only)
--
-- The two entity-backed audiences get a `*_documents` table mirroring
-- client_documents (same shape, doc_type_id → hr_document_types). supplier /
-- investor get no table — BRS\Contracts leaves them unmapped, distribute
-- returns 0, so they're inert until wired (drop in the table + a case later).

USE `builtrightstudio_cms`;

CREATE TABLE IF NOT EXISTS `lead_documents` (
  `id`                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `lead_id`            INT UNSIGNED NOT NULL,
  `doc_type_id`        INT UNSIGNED NULL,
  `category`           VARCHAR(60) NOT NULL DEFAULT 'contract',
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
  PRIMARY KEY (`id`),
  KEY `idx_lead` (`lead_id`),
  KEY `idx_doc_type` (`doc_type_id`),
  CONSTRAINT `fk_leaddoc_lead`     FOREIGN KEY (`lead_id`)     REFERENCES `leads`(`id`)              ON DELETE CASCADE,
  CONSTRAINT `fk_leaddoc_type`     FOREIGN KEY (`doc_type_id`) REFERENCES `hr_document_types`(`id`)  ON DELETE SET NULL,
  CONSTRAINT `fk_leaddoc_signer`   FOREIGN KEY (`signed_by`)   REFERENCES `admin_users`(`id`)        ON DELETE SET NULL,
  CONSTRAINT `fk_leaddoc_uploader` FOREIGN KEY (`uploaded_by`) REFERENCES `admin_users`(`id`)        ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `applicant_documents` (
  `id`                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `candidate_id`       INT UNSIGNED NOT NULL,
  `doc_type_id`        INT UNSIGNED NULL,
  `category`           VARCHAR(60) NOT NULL DEFAULT 'contract',
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
  PRIMARY KEY (`id`),
  KEY `idx_candidate` (`candidate_id`),
  KEY `idx_doc_type` (`doc_type_id`),
  CONSTRAINT `fk_appdoc_candidate` FOREIGN KEY (`candidate_id`) REFERENCES `hr_candidates`(`id`)      ON DELETE CASCADE,
  CONSTRAINT `fk_appdoc_type`      FOREIGN KEY (`doc_type_id`)  REFERENCES `hr_document_types`(`id`)  ON DELETE SET NULL,
  CONSTRAINT `fk_appdoc_signer`    FOREIGN KEY (`signed_by`)    REFERENCES `admin_users`(`id`)        ON DELETE SET NULL,
  CONSTRAINT `fk_appdoc_uploader`  FOREIGN KEY (`uploaded_by`)  REFERENCES `admin_users`(`id`)        ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `hr_document_types`
  MODIFY COLUMN `audience`
  ENUM('employee','client','lead','partner','affiliate','contractor','candidate','applicant','supplier','investor')
  NOT NULL DEFAULT 'employee';
