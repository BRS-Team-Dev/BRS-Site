-- Migration 097: Lead contacts.
--
-- Mirrors `client_contacts` / `client_contact_numbers` but scoped to leads
-- so a pre-conversion record can already track multiple people (e.g. the
-- decision maker plus a procurement contact).
--
-- Promote-to-client and relegate-back-to-lead now carry the full contact
-- list in both directions (see /api/leads/:id/promote and
-- /api/clients/:id/relegate-to-lead in routes/leads.php + clients.php).
-- A lead without any contacts is still valid — the existing top-level
-- name/email/phone columns on `leads` stay as the fallback shown on the
-- list view.

CREATE TABLE IF NOT EXISTS `lead_contacts` (
  `id`         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `lead_id`    INT UNSIGNED NOT NULL,
  `first_name` VARCHAR(120) NOT NULL,
  `last_name`  VARCHAR(120) NULL,
  `position`   VARCHAR(190) NULL,
  `email`      VARCHAR(190) NULL,
  `verified`   TINYINT(1)   NOT NULL DEFAULT 0,
  -- Exactly one row per lead carries is_primary=1 (relaxed: zero is OK
  -- for a brand-new lead with no contacts yet). The relegate flow uses
  -- this to know which client contact mapped to the lead's headline
  -- name/email/phone fields.
  `is_primary` TINYINT(1)   NOT NULL DEFAULT 0,
  `sort_order` INT          NOT NULL DEFAULT 0,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `idx_lead` (`lead_id`),
  CONSTRAINT `fk_lead_contact_lead`
    FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `lead_contact_numbers` (
  `id`         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `contact_id` INT UNSIGNED NOT NULL,
  `number`     VARCHAR(80)  NOT NULL,
  `label`      VARCHAR(60)  NULL,
  `sort_order` INT          NOT NULL DEFAULT 0,
  KEY `idx_contact` (`contact_id`),
  CONSTRAINT `fk_lead_number_contact`
    FOREIGN KEY (`contact_id`) REFERENCES `lead_contacts`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
