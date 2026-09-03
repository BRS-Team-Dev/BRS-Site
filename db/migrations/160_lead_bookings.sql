-- 160_lead_bookings.sql
--
-- Consultation-call bookings from prospects. Standalone (a booking
-- can arrive before there's a matching leads row) but with an
-- optional FK to leads for when the two are related — nulled on
-- lead delete so bookings survive.
--
-- Lives under CRM → Leads → Bookings in the sidebar. Populated
-- from either the marketing site's "Book a call" flow (later) or
-- created manually by admins from the CMS.

CREATE TABLE `lead_bookings` (
  `id`                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`         INT UNSIGNED NOT NULL,
  `lead_id`           INT UNSIGNED NULL,
  `name`              VARCHAR(190) NOT NULL,
  `email`             VARCHAR(190) NULL,
  `phone`             VARCHAR(80)  NULL,
  `company`           VARCHAR(190) NULL,
  `topic`             VARCHAR(255) NULL,
  `notes`             TEXT NULL,
  `scheduled_at`      DATETIME NULL,
  `duration_minutes`  SMALLINT UNSIGNED NOT NULL DEFAULT 15,
  `status`            ENUM('requested','confirmed','completed','cancelled','no_show') NOT NULL DEFAULT 'requested',
  `meeting_url`       VARCHAR(500) NULL,
  `source`            VARCHAR(60)  NULL,             -- e.g. 'website', 'referral', 'manual'
  `assignee_user_id`  INT UNSIGNED NULL,
  `created_by_user_id` INT UNSIGNED NULL,
  `created_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_bookings_tenant`      (`tenant_id`),
  KEY `idx_bookings_lead`        (`tenant_id`, `lead_id`),
  KEY `idx_bookings_status_time` (`tenant_id`, `status`, `scheduled_at`),
  CONSTRAINT `fk_booking_lead` FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
