-- Migration 070: Tender Application sections + per-section/per-doc
-- completion tracking. Consolidates the previous three doc tabs
-- (Application / Proposals / Pitch decks) into a single Application tab
-- whose contents are organised into user-picked sections.
--
-- `tender_document_sections` holds the sections selected at tender
-- creation (or added later from the section-picker). Each section has a
-- canonical slug (matches the DEFAULT_SECTIONS constant on the frontend)
-- + a display label that can be customised per-tender. `is_completed`
-- drives the section-level completion toggle and the Tracker reminders.
--
-- `tender_documents` gains `section_id` so each document belongs to a
-- section, and `is_completed` for per-document completion. The legacy
-- `kind` enum (application | proposal | pitch_deck) is made NULLABLE
-- so existing rows aren't broken — the UI ignores it from here on.

CREATE TABLE IF NOT EXISTS `tender_document_sections` (
  `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tender_id`    INT UNSIGNED NOT NULL,
  `slug`         VARCHAR(60)  NOT NULL,
  `label`        VARCHAR(160) NOT NULL,
  `is_completed` TINYINT(1)   NOT NULL DEFAULT 0,
  `sort_order`   INT          NOT NULL DEFAULT 0,
  `created_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tender_slug` (`tender_id`, `slug`),
  CONSTRAINT `fk_tds_tender` FOREIGN KEY (`tender_id`) REFERENCES `tenders`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `tender_documents`
  ADD COLUMN `section_id`   INT UNSIGNED NULL AFTER `tender_id`,
  ADD COLUMN `is_completed` TINYINT(1)   NOT NULL DEFAULT 0 AFTER `sort_order`,
  MODIFY `kind` ENUM('application','proposal','pitch_deck') NULL,
  ADD KEY `idx_section` (`section_id`),
  ADD CONSTRAINT `fk_td_section`
    FOREIGN KEY (`section_id`) REFERENCES `tender_document_sections`(`id`) ON DELETE SET NULL;
