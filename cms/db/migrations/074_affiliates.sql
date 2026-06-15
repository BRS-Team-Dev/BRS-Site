-- Migration 074: Affiliates — marketing partners on commission at
-- /operations/affiliates.
--
-- The affiliate_code is the unique handle marketers append to their
-- referral URLs and is what we reconcile conversions against — hence
-- UNIQUE. Commission shape supports both percentage and flat-rate
-- programs; tier + marketing_channel let us segment our affiliate
-- portfolio for reporting and tier-based commission rates.

CREATE TABLE IF NOT EXISTS `affiliates` (
  `id`                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`               VARCHAR(255) NOT NULL,
  `affiliate_type`     ENUM('individual','company') NOT NULL DEFAULT 'individual',
  `status`             ENUM('pending','active','paused','suspended','terminated')
                         NOT NULL DEFAULT 'pending',
  `tier`               ENUM('bronze','silver','gold','platinum')
                         NOT NULL DEFAULT 'bronze',
  `affiliate_code`     VARCHAR(60)  NOT NULL,
  `referral_link`      VARCHAR(500) NULL,
  `commission_rate`    DECIMAL(7,2) NULL,
  `commission_type`    ENUM('percentage','flat') NOT NULL DEFAULT 'percentage',
  `currency`           CHAR(3) NOT NULL DEFAULT 'GBP',
  `payout_method`      ENUM('bank_transfer','paypal','stripe','other')
                         NOT NULL DEFAULT 'bank_transfer',
  `payout_threshold`   DECIMAL(10,2) NULL,
  `payment_terms`      VARCHAR(40) NULL,
  `marketing_channel`  VARCHAR(120) NULL,
  `joined_date`        DATE NULL,
  `end_date`           DATE NULL,
  `primary_email`      VARCHAR(190) NULL,
  `primary_phone`      VARCHAR(80) NULL,
  `website`            VARCHAR(500) NULL,
  `social_handles`     TEXT NULL,
  `notes`              TEXT NULL,
  `created_at`         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_affiliate_code` (`affiliate_code`),
  KEY `idx_status_tier` (`status`, `tier`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `affiliate_notes` (
  `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `affiliate_id` INT UNSIGNED NOT NULL,
  `title`        VARCHAR(255) NOT NULL,
  `body`         TEXT NULL,
  `sort_order`   INT NOT NULL DEFAULT 0,
  `created_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_affiliate` (`affiliate_id`),
  CONSTRAINT `fk_anote_affiliate` FOREIGN KEY (`affiliate_id`) REFERENCES `affiliates`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
