-- Migration 062: Legal documents (policies, T&Cs, privacy, etc.).
--
-- Each row is its own page. HR authors the content as HTML (the same
-- intro_html convention the form builder uses, rendered with [innerHTML]),
-- and a slug drives the per-document URL at /hr/legal/:slug.
--
-- Categories are intentionally a free-form VARCHAR with a soft list in the
-- frontend ('policy', 'terms', 'privacy', 'other') so HR can add new
-- buckets without a schema change.

USE `builtrightstudio_cms`;

CREATE TABLE IF NOT EXISTS `hr_legal_documents` (
  `id`           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `slug`         VARCHAR(190) NOT NULL,
  `title`        VARCHAR(190) NOT NULL,
  `category`     VARCHAR(40)  NOT NULL DEFAULT 'policy',
  `summary`      VARCHAR(500) NULL,
  `body`         LONGTEXT     NULL,
  `is_published` TINYINT(1)   NOT NULL DEFAULT 0,
  `sort_order`   INT          NOT NULL DEFAULT 0,
  `created_by`   INT UNSIGNED NULL,
  `updated_by`   INT UNSIGNED NULL,
  `created_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uniq_legal_slug` (`slug`),
  KEY `idx_legal_category` (`category`),
  CONSTRAINT `fk_legal_created_by`
    FOREIGN KEY (`created_by`) REFERENCES `admin_users`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_legal_updated_by`
    FOREIGN KEY (`updated_by`) REFERENCES `admin_users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
