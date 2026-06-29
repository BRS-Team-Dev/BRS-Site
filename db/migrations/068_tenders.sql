-- Migration 068: Tenders — track bids/RFPs we're planning to apply for,
-- drafting, submitted, or have heard back on. Lives under the Operations
-- system at /operations/tenders.
--
-- Status flow:
--   planning   — identified, deciding whether to bid
--   drafting   — actively writing the response
--   submitted  — sent in, awaiting decision
--   awarded    — won
--   rejected   — lost
--   withdrawn  — we backed out before submitting / after submitting
--
-- value/currency are nullable since not every tender has a quoted budget
-- up front. URL is for the source listing (the buyer's portal page).

CREATE TABLE IF NOT EXISTS `tenders` (
  `id`                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `title`               VARCHAR(255) NOT NULL,
  `buyer`               VARCHAR(255) NULL,
  `reference`           VARCHAR(120) NULL,
  `value`               DECIMAL(14,2) NULL,
  `currency`            CHAR(3) NOT NULL DEFAULT 'GBP',
  `category`            VARCHAR(120) NULL,
  `source_url`          VARCHAR(500) NULL,
  `submission_deadline` DATETIME NULL,
  `decision_date`       DATE NULL,
  `status`              ENUM('planning','drafting','submitted','awarded','rejected','withdrawn') NOT NULL DEFAULT 'planning',
  `notes`               TEXT NULL,
  `created_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_status_deadline` (`status`, `submission_deadline`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
