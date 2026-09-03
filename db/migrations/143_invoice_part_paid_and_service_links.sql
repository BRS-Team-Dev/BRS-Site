-- Migration 143: multi-service invoices + part-paid status.
--
-- 1. invoices.status gains 'part_paid' so an invoice can sit between
--    'sent' and 'paid' when the client has settled a portion.
--
-- 2. invoices.amount_paid stores the running paid total (NULL until any
--    money is received). For 'paid' rows this equals the total; for
--    'part_paid' it's the deposit / partial payment. The client-side
--    Invoices tab defaults it to half the total when part-paid is
--    picked with no explicit amount.
--
-- 3. invoice_service_links is a junction so one invoice can bill for
--    multiple services on the same client. The Services tab shows the
--    latest invoice per service via this join; the Invoices tab shows
--    every service that's on each invoice. sort_order preserves the
--    order lines were added (matches how invoice_lines is ordered).

ALTER TABLE `invoices`
  MODIFY COLUMN `status` ENUM('draft','sent','part_paid','paid','void') NOT NULL DEFAULT 'draft',
  ADD COLUMN `amount_paid` DECIMAL(10,2) NULL AFTER `total`;

CREATE TABLE IF NOT EXISTS `invoice_service_links` (
  `id`                          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  -- tenant_id is required for the multi-tenant SQL rewriter (see
  -- TenantSqlRewriter::rewrite) - every non-global table must carry it
  -- or INSERTs fail with "Unknown column tenant_id in field list".
  `tenant_id`                   INT UNSIGNED NOT NULL,
  `invoice_id`                  INT UNSIGNED NOT NULL,
  `client_service_offering_id`  INT UNSIGNED NOT NULL,
  `sort_order`                  INT NOT NULL DEFAULT 0,
  `created_at`                  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_invoice_cso` (`invoice_id`, `client_service_offering_id`),
  KEY `idx_isl_cso` (`client_service_offering_id`),
  KEY `idx_isl_tenant` (`tenant_id`),
  CONSTRAINT `fk_isl_invoice`
    FOREIGN KEY (`invoice_id`) REFERENCES `invoices` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_isl_cso`
    FOREIGN KEY (`client_service_offering_id`) REFERENCES `client_service_offerings` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_isl_tenant`
    FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
