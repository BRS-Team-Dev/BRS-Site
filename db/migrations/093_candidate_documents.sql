-- Migration 093: candidate_documents — contract / signed-document fan-out for
-- recruitment candidates, so the multi-audience contracts system (076) can
-- target the agency's candidate roster too.
--
-- Mirrors client_documents / partner_documents / etc. exactly (same columns,
-- same doc_type_id → hr_document_types link) so BRS\Contracts can treat
-- audience='candidate' identically to the other audiences. Owner FK points at
-- recruitment_candidates (the agency-owned roster), CASCADE on delete.
--
-- NB: distinct from recruitment_candidate_documents (compliance uploads with a
-- pending/valid/expired status) — this table is the contract/signed bucket.

USE `builtrightstudio_cms`;

CREATE TABLE IF NOT EXISTS `candidate_documents` (
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
  CONSTRAINT `fk_canddoc_candidate` FOREIGN KEY (`candidate_id`) REFERENCES `recruitment_candidates`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_canddoc_type`      FOREIGN KEY (`doc_type_id`)  REFERENCES `hr_document_types`(`id`)       ON DELETE SET NULL,
  CONSTRAINT `fk_canddoc_signer`    FOREIGN KEY (`signed_by`)    REFERENCES `admin_users`(`id`)             ON DELETE SET NULL,
  CONSTRAINT `fk_canddoc_uploader`  FOREIGN KEY (`uploaded_by`)  REFERENCES `admin_users`(`id`)             ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add 'candidate' to the contract-template audience enum.
ALTER TABLE `hr_document_types`
  MODIFY COLUMN `audience`
  ENUM('employee','client','partner','affiliate','contractor','candidate')
  NOT NULL DEFAULT 'employee';
