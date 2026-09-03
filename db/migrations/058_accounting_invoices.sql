-- Migration 058: Invoicing — first piece of the Accounting system.
--
-- Two tables:
--   `invoices`        — invoice header (one row per invoice)
--   `invoice_lines`   — line items (many per invoice)
--
-- Invoices link to canonical `clients` (the recipient) and optionally to an
-- `onboarding_clients` row (the qualified service that the invoice covers,
-- so we can later auto-draft from `GET /api/clients/:id/services`). Both
-- references are nullable so manual one-off invoices are still possible.
--
-- Numbers are namespaced per financial year via `invoice_number` — generated
-- by the backend on insert. Status workflow: draft → sent → paid (or void).

USE `builtrightstudio_cms`;

CREATE TABLE IF NOT EXISTS `invoices` (
  `id`                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `invoice_number`      VARCHAR(40) NOT NULL,
  `client_id`           INT UNSIGNED NULL,
  `onboarding_client_id` INT UNSIGNED NULL,

  -- Captured at create time so editing a client's name later doesn't
  -- mutate historical invoices.
  `bill_to_name`        VARCHAR(190) NOT NULL,
  `bill_to_email`       VARCHAR(190) NULL,
  `bill_to_address`     TEXT NULL,

  `currency`            CHAR(3) NOT NULL DEFAULT 'GBP',
  `issue_date`          DATE NOT NULL,
  `due_date`            DATE NULL,
  `status`              ENUM('draft','sent','paid','void') NOT NULL DEFAULT 'draft',

  -- Totals are stored on the header so reports don't have to re-aggregate
  -- lines on every read. Backend keeps them in sync on line insert/update.
  `subtotal`            DECIMAL(12,2) NOT NULL DEFAULT 0,
  `tax_total`           DECIMAL(12,2) NOT NULL DEFAULT 0,
  `total`               DECIMAL(12,2) NOT NULL DEFAULT 0,

  `notes`               TEXT NULL,
  `sent_at`             DATETIME NULL,
  `paid_at`             DATETIME NULL,
  `created_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY `uniq_invoice_number` (`invoice_number`),
  KEY `idx_invoices_client` (`client_id`),
  KEY `idx_invoices_onboarding` (`onboarding_client_id`),
  KEY `idx_invoices_status` (`status`),
  CONSTRAINT `fk_invoices_client`
    FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_invoices_onboarding`
    FOREIGN KEY (`onboarding_client_id`) REFERENCES `onboarding_clients`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `invoice_lines` (
  `id`            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `invoice_id`    INT UNSIGNED NOT NULL,
  `description`   VARCHAR(500) NOT NULL,
  `quantity`      DECIMAL(10,2) NOT NULL DEFAULT 1,
  `unit_price`    DECIMAL(12,2) NOT NULL DEFAULT 0,
  -- VAT rate applied to this line, in percent (e.g. 20.00). Zero by
  -- default — VAT engine ships in a later phase. Total per line is
  -- (quantity * unit_price) gross of tax; the backend computes
  -- line_total + line_tax on update.
  `tax_rate`      DECIMAL(5,2) NOT NULL DEFAULT 0,
  `line_total`    DECIMAL(12,2) NOT NULL DEFAULT 0,
  `line_tax`      DECIMAL(12,2) NOT NULL DEFAULT 0,
  `sort_order`    INT NOT NULL DEFAULT 0,
  `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_invoice_lines_invoice` (`invoice_id`, `sort_order`),
  CONSTRAINT `fk_invoice_lines_invoice`
    FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
