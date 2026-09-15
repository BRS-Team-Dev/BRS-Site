-- Mailer: targeted one-off messages to leads and clients.
--
-- Distinct from Newsletter (065), which is a broadcast to everyone with a
-- block-built body and an unsubscribe footer. Mailer is for a written
-- message sent to a filtered slice of the CRM (by audience and industry),
-- with per-recipient placeholder substitution and reusable templates.
--
-- It deliberately REUSES two pieces of the newsletter plumbing rather than
-- duplicating them: BRS\Mailer::send for delivery, and the global
-- `newsletter_suppressions` table, so an address that unsubscribed once is
-- never mailed again by either feature.

-- ---------------------------------------------------------------------
-- Clients gain an industry, so the same filter works for both audiences.
-- `leads.industry` already exists (Companies House SIC description, or a
-- hand-typed value); clients had no equivalent, which meant the Mailer's
-- industry filter would silently match zero clients.
-- ---------------------------------------------------------------------
ALTER TABLE `clients`
  ADD COLUMN `industry` VARCHAR(120) NULL AFTER `company`;

ALTER TABLE `clients`
  ADD INDEX `idx_clients_industry` (`tenant_id`, `industry`);

-- Backfill from the lead each client was promoted from, where we still
-- have that link. Clients created directly stay NULL until someone sets one.
UPDATE `clients` c
  JOIN `leads` l
    ON l.promoted_client_id = c.id
   AND l.tenant_id = c.tenant_id
   SET c.industry = l.industry
 WHERE c.industry IS NULL
   AND l.industry IS NOT NULL
   AND l.industry <> '';

-- ---------------------------------------------------------------------
-- Reusable message templates.
-- ---------------------------------------------------------------------
CREATE TABLE `mailer_templates` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`   INT UNSIGNED NOT NULL,
  `name`        VARCHAR(190) NOT NULL,
  `subject`     VARCHAR(255) NOT NULL DEFAULT '',
  -- Body as authored, placeholders left un-substituted ({{first_name}} etc).
  -- Substitution happens per recipient at send time, never at save time.
  `body_html`   MEDIUMTEXT NULL,
  `created_by_user_id` INT UNSIGNED NULL,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_mailer_templates_tenant` (`tenant_id`, `name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- One row per send, so a message that went out can be found again.
-- ---------------------------------------------------------------------
CREATE TABLE `mailer_sends` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`     INT UNSIGNED NOT NULL,
  `subject`       VARCHAR(255) NOT NULL,
  `body_html`     MEDIUMTEXT NULL,
  -- What was targeted, recorded for the audit trail. The recipient rows
  -- below are the authoritative record of who actually got it.
  `audience`      VARCHAR(20) NOT NULL DEFAULT 'both',
  `industry`      VARCHAR(120) NULL,
  `template_id`   INT UNSIGNED NULL,
  `total`         INT UNSIGNED NOT NULL DEFAULT 0,
  `sent_count`    INT UNSIGNED NOT NULL DEFAULT 0,
  `failed_count`  INT UNSIGNED NOT NULL DEFAULT 0,
  `skipped_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `sent_by_user_id` INT UNSIGNED NULL,
  `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_mailer_sends_tenant` (`tenant_id`, `created_at`),
  CONSTRAINT `fk_mailer_send_template` FOREIGN KEY (`template_id`)
    REFERENCES `mailer_templates`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Per-recipient outcome for each send.
-- ---------------------------------------------------------------------
CREATE TABLE `mailer_send_recipients` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`   INT UNSIGNED NOT NULL,
  `send_id`     INT UNSIGNED NOT NULL,
  -- 'lead' or 'client'. Not an FK: the record may be deleted later and the
  -- send log should still say who was mailed.
  `entity_type` VARCHAR(10) NOT NULL,
  `entity_id`   INT UNSIGNED NULL,
  `email`       VARCHAR(190) NOT NULL,
  `name`        VARCHAR(190) NULL,
  -- sent | failed | skipped (suppressed / no email address)
  `status`      VARCHAR(20) NOT NULL DEFAULT 'sent',
  `error`       VARCHAR(500) NULL,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_mailer_recip_send` (`tenant_id`, `send_id`),
  CONSTRAINT `fk_mailer_recip_send` FOREIGN KEY (`send_id`)
    REFERENCES `mailer_sends`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
