-- Migration 067: password reset tokens
-- Append-only; preserves all existing data.

CREATE TABLE IF NOT EXISTS `password_resets` (
  `id`            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `admin_user_id` INT UNSIGNED NOT NULL,
  -- Store sha256(token) so a DB read can't impersonate. Plaintext token only
  -- exists in the URL we email.
  `token_hash`    CHAR(64) NOT NULL,
  `expires_at`    DATETIME NOT NULL,
  `used_at`       DATETIME NULL,
  `created_ip`    VARCHAR(45) NULL,
  `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uniq_token_hash` (`token_hash`),
  KEY `idx_user_active` (`admin_user_id`, `used_at`, `expires_at`),
  CONSTRAINT `fk_pwreset_user`
    FOREIGN KEY (`admin_user_id`) REFERENCES `admin_users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
