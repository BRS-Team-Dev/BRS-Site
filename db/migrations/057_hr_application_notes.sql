-- Migration 057: Recruiter notes thread on hr_applications.
-- Replaces the single recruiter_notes TEXT column with an append-only log so
-- recruiters can leave multiple dated entries on a candidate. The original
-- column is kept for the seed value the public apply form writes (so the
-- candidate's own cover note isn't lost), but new entries go here.

USE `builtrightstudio_cms`;

CREATE TABLE IF NOT EXISTS `hr_application_notes` (
  `id`             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `application_id` INT UNSIGNED NOT NULL,
  `author_id`      INT UNSIGNED NULL,
  `body`           TEXT NOT NULL,
  `created_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_app_notes_app` (`application_id`, `created_at`),
  CONSTRAINT `fk_app_notes_app`
    FOREIGN KEY (`application_id`) REFERENCES `hr_applications`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_app_notes_author`
    FOREIGN KEY (`author_id`) REFERENCES `admin_users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
