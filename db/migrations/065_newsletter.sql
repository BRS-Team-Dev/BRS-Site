-- Migration 065: Newsletter campaigns + per-recipient send tracking +
-- email-level suppression list. CRM-only feature, lives under /admin/newsletter.
--
-- Audience model: each campaign opts into the Clients audience (every
-- distinct primary-contact email across the clients table) and/or the
-- Leads audience (every lead email), and may also include a custom
-- pasted/typed email list. Recipients are de-duped by email at send
-- time and any address in `newsletter_suppressions` is skipped.
--
-- Status flow:
--   draft       — saved but not yet queued
--   scheduled   — has scheduled_at in the future; auto-fires when due
--                 (process-due endpoint, run by cron or manually)
--   sending     — in-flight send; transient guard against concurrent fires
--   sent        — finished; sent_at / counts populated
--   failed      — every recipient failed (e.g. SMTP not configured)
--
-- Recipient rows are materialised at send time so we have a per-row
-- audit + retry handle and a stable per-recipient unsubscribe token.

CREATE TABLE IF NOT EXISTS `newsletter_campaigns` (
  `id`                     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `subject`                VARCHAR(255)   NOT NULL,
  `body_html`              MEDIUMTEXT     NOT NULL,
  `audience_clients`       TINYINT(1)     NOT NULL DEFAULT 0,
  `audience_leads`         TINYINT(1)     NOT NULL DEFAULT 0,
  `audience_custom_emails` TEXT           NULL,
  `status`                 ENUM('draft','scheduled','sending','sent','failed') NOT NULL DEFAULT 'draft',
  `scheduled_at`           DATETIME       NULL,
  `sent_at`                DATETIME       NULL,
  `recipient_count`        INT UNSIGNED   NOT NULL DEFAULT 0,
  `sent_count`             INT UNSIGNED   NOT NULL DEFAULT 0,
  `failed_count`           INT UNSIGNED   NOT NULL DEFAULT 0,
  `last_error`             TEXT           NULL,
  `created_at`             DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`             DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_status_scheduled` (`status`, `scheduled_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `newsletter_recipients` (
  `id`                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `campaign_id`       INT UNSIGNED NOT NULL,
  `email`             VARCHAR(190) NOT NULL,
  `name`              VARCHAR(190) NULL,
  `source`            ENUM('client','lead','custom') NOT NULL,
  `source_id`         INT UNSIGNED NULL,
  `unsubscribe_token` CHAR(48)     NOT NULL,
  `status`            ENUM('pending','sent','failed','suppressed') NOT NULL DEFAULT 'pending',
  `sent_at`           DATETIME     NULL,
  `error_msg`         TEXT         NULL,
  `created_at`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_unsub_token` (`unsubscribe_token`),
  KEY `idx_campaign` (`campaign_id`),
  KEY `idx_email` (`email`),
  CONSTRAINT `fk_nl_campaign` FOREIGN KEY (`campaign_id`) REFERENCES `newsletter_campaigns`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `newsletter_suppressions` (
  `email`           VARCHAR(190) NOT NULL,
  `unsubscribed_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `reason`          VARCHAR(120) NULL,
  PRIMARY KEY (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
