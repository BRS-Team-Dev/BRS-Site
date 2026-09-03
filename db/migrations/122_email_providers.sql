-- Migration 122: per-tenant email provider config + purpose routing.
--
-- Each tenant can register multiple email providers (Postmark, Resend,
-- SendGrid, Amazon SES, Mailgun, Brevo, or raw SMTP) with their own
-- credentials and from-address. The routing table then picks which
-- provider handles each of the four purpose buckets:
--
--   newsletter  → bulk campaigns from the newsletter module
--   system      → password resets, email verification, generic system
--                 mails to end-users
--   invite      → onboarding portal invites (client / HR / recruitment)
--   internal    → notifications to admin users (form-submit alerts,
--                 task assignment, deadline reminders, etc.)
--
-- A single provider can be pointed at multiple purposes. Purposes with
-- no provider set fall back to the legacy Mailer defaults so the switch
-- is non-breaking.

CREATE TABLE IF NOT EXISTS `email_providers` (
  `id`               INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `tenant_id`        INT UNSIGNED NOT NULL,
  `provider`         ENUM('postmark','resend','sendgrid','ses','mailgun','brevo','smtp') NOT NULL,
  `name`             VARCHAR(120) NOT NULL,
  `is_active`        TINYINT(1) NOT NULL DEFAULT 1,
  `from_email`       VARCHAR(191) NOT NULL,
  `from_name`        VARCHAR(120) NULL,
  `reply_to`         VARCHAR(191) NULL,
  -- API-key style providers (postmark / resend / sendgrid / brevo)
  `api_key`          TEXT NULL,
  -- Mailgun uses api_key + a domain; SES uses aws_key + aws_secret + region
  `api_secret`       TEXT NULL,
  `aws_region`       VARCHAR(30) NULL,
  `mailgun_domain`   VARCHAR(191) NULL,
  -- Raw SMTP fallback
  `smtp_host`        VARCHAR(191) NULL,
  `smtp_port`        INT UNSIGNED NULL,
  `smtp_user`        VARCHAR(191) NULL,
  `smtp_password`    TEXT NULL,
  `smtp_encryption`  ENUM('none','tls','ssl') NOT NULL DEFAULT 'tls',
  -- Test-send diagnostics (populated by /api/email/providers/:id/test)
  `last_test_at`     DATETIME NULL,
  `last_test_ok`     TINYINT(1) NULL,
  `last_test_error`  TEXT NULL,
  `created_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_ep_tenant_name` (`tenant_id`, `name`),
  KEY `idx_ep_tenant` (`tenant_id`),
  CONSTRAINT `fk_ep_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `email_routing` (
  `tenant_id`   INT UNSIGNED NOT NULL,
  `purpose`     ENUM('newsletter','system','invite','internal') NOT NULL,
  `provider_id` INT UNSIGNED NULL,
  `updated_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`tenant_id`, `purpose`),
  KEY `idx_er_provider` (`provider_id`),
  CONSTRAINT `fk_er_tenant`   FOREIGN KEY (`tenant_id`)   REFERENCES `tenants` (`id`)         ON DELETE CASCADE,
  CONSTRAINT `fk_er_provider` FOREIGN KEY (`provider_id`) REFERENCES `email_providers` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
