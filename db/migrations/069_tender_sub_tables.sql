-- Migration 069: Tender sub-resources for the tabbed detail view.
--
-- Mirrors the client_* shape (migrations 002, 049, 053, 061) so the tabs
-- behave consistently:
--   Info         — tender_info: free-form name/value pairs
--   Contacts     — tender_contacts (+ tender_contact_numbers): people +
--                  optional phone numbers
--   Application  ┐
--   Proposals    │ — tender_documents: single table with `kind` enum
--   Pitch decks  ┘   ('application' | 'proposal' | 'pitch_deck'), each
--                    entry holds title + description + optional external
--                    URL + optional uploaded file. Leaves room for a
--                    future 'internal' source value when the in-app
--                    document builder lands (planned next iteration).
--   Notes        — tender_notes: title + body
--
-- All sub-tables cascade on tender deletion.

CREATE TABLE IF NOT EXISTS `tender_info` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tender_id`  INT UNSIGNED NOT NULL,
  `name`       VARCHAR(190) NOT NULL,
  `value`      TEXT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tender` (`tender_id`),
  CONSTRAINT `fk_tender_info_tender` FOREIGN KEY (`tender_id`) REFERENCES `tenders`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tender_contacts` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tender_id`  INT UNSIGNED NOT NULL,
  `first_name` VARCHAR(120) NOT NULL,
  `last_name`  VARCHAR(120) NULL,
  `position`   VARCHAR(160) NULL,
  `email`      VARCHAR(190) NULL,
  `is_primary` TINYINT(1) NOT NULL DEFAULT 0,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tender` (`tender_id`),
  CONSTRAINT `fk_tender_contacts_tender` FOREIGN KEY (`tender_id`) REFERENCES `tenders`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tender_contact_numbers` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `contact_id` INT UNSIGNED NOT NULL,
  `number`     VARCHAR(80)  NOT NULL,
  `label`      VARCHAR(40)  NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_contact` (`contact_id`),
  CONSTRAINT `fk_tender_cnums_contact` FOREIGN KEY (`contact_id`) REFERENCES `tender_contacts`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tender_documents` (
  `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tender_id`    INT UNSIGNED NOT NULL,
  `kind`         ENUM('application','proposal','pitch_deck') NOT NULL,
  `title`        VARCHAR(255) NOT NULL,
  `description`  TEXT NULL,
  `external_url` VARCHAR(1000) NULL,
  `file_path`    VARCHAR(500) NULL,
  `file_size`    INT UNSIGNED NULL,
  `mime_type`    VARCHAR(120) NULL,
  `sort_order`   INT NOT NULL DEFAULT 0,
  `created_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tender_kind` (`tender_id`, `kind`),
  CONSTRAINT `fk_tender_docs_tender` FOREIGN KEY (`tender_id`) REFERENCES `tenders`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tender_notes` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tender_id`  INT UNSIGNED NOT NULL,
  `title`      VARCHAR(255) NOT NULL,
  `body`       TEXT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tender` (`tender_id`),
  CONSTRAINT `fk_tender_notes_tender` FOREIGN KEY (`tender_id`) REFERENCES `tenders`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
