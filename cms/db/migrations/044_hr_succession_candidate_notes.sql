-- Migration 044: timestamped notes thread per succession candidate, mirroring
-- the plan-level notes pattern.

USE `builtrightstudio_cms`;

CREATE TABLE IF NOT EXISTS `hr_succession_candidate_notes` (
    `id`           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `candidate_id` INT UNSIGNED NOT NULL,
    `user_id`      INT UNSIGNED NULL,
    `body`         TEXT NOT NULL,
    `created_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_succcand_note_cand` FOREIGN KEY (`candidate_id`)
        REFERENCES `hr_succession_candidates`(`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_succcand_note_user` FOREIGN KEY (`user_id`)
        REFERENCES `admin_users`(`id`) ON DELETE SET NULL,
    INDEX `idx_succcand_note_cand` (`candidate_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
