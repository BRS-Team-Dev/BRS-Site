-- Migration 141: persist scraped tender opportunities ("leads").
--
-- The Operations > Leads page used to poll the live aggregator
-- (cms/scraper/tenders.php -> Find a Tender + Contracts Finder) on every
-- page load / filter change. That is slow and flaky (live gov APIs). It now
-- reads from this table; an "Import latest" button pulls the last 24h from
-- the aggregator and upserts rows here (dedup on ocid per tenant).
--
-- One column per top-level value the aggregator JSON returns: scalars get
-- typed columns, nested objects/arrays are stored as JSON, and raw_json keeps
-- the untouched original for completeness / future fields. buyer_name is a
-- denormalised copy of buyer.name for cheap search + sort.

CREATE TABLE IF NOT EXISTS `tender_leads` (
  `id`                 INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  `tenant_id`          INT UNSIGNED    NOT NULL,
  `ocid`               VARCHAR(190)    NOT NULL,
  `notice_id`          VARCHAR(190)    NULL,
  `source`             VARCHAR(60)     NULL,
  `notice_type`        VARCHAR(190)    NULL,
  `language`           VARCHAR(20)     NULL,
  `title`              TEXT            NULL,
  `description`        MEDIUMTEXT      NULL,
  `status`             VARCHAR(40)     NULL,
  `buyer_name`         VARCHAR(255)    NULL,
  `value_amount`       DECIMAL(18,2)   NULL,
  `value_currency`     CHAR(3)         NULL,
  `main_category`      VARCHAR(120)    NULL,
  `published_date`     DATETIME        NULL,
  `deadline`           DATETIME        NULL,
  `enquiry_deadline`   DATETIME        NULL,
  `contract_start`     DATE            NULL,
  `contract_end`       DATE            NULL,
  `contract_days`      INT             NULL,
  `procedure_type`     VARCHAR(190)    NULL,
  `legal_basis`        VARCHAR(120)    NULL,
  `covered_by_gpa`     TINYINT(1)      NULL,
  `suitable_for_sme`   TINYINT(1)      NULL,
  `suitable_for_vcse`  TINYINT(1)      NULL,
  `lot_count`          INT             NULL,
  `link`               VARCHAR(500)    NULL,
  `types`              JSON            NULL,
  `buyer`              JSON            NULL,
  `parties`            JSON            NULL,
  `cpv_codes`          JSON            NULL,
  `regions`            JSON            NULL,
  `delivery_addresses` JSON            NULL,
  `framework`          JSON            NULL,
  `lots`               JSON            NULL,
  `milestones`         JSON            NULL,
  `selection_criteria` JSON            NULL,
  `award_criteria`     JSON            NULL,
  `submission`         JSON            NULL,
  `participation`      JSON            NULL,
  `documents`          JSON            NULL,
  `raw_json`           JSON            NULL,
  `imported_at`        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tenant_ocid` (`tenant_id`, `ocid`),
  KEY `idx_tenant_published` (`tenant_id`, `published_date`),
  KEY `idx_tenant_deadline` (`tenant_id`, `deadline`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
