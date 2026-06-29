-- Migration 098: Sector + service + contacted + author tracking on leads.
--
-- Adds the new lead attributes surfaced through the CRM list view:
--   industry           — sector the lead operates in (free text so new
--                        ones can appear automatically; the sidenav
--                        groups leads by distinct industry values).
--   service_offering_id — FK to `service_offerings.id`. Which of our
--                        services we are pitching this lead. Null until
--                        chosen. ON DELETE SET NULL keeps the lead alive
--                        when an offering is removed from the catalogue.
--   contacted_at        — null = not contacted yet. The list view shows
--                        a yes/no badge driven off IS NOT NULL.
--   added_by_user_id    — FK to `admin_users.id`. Set on user-driven
--                        creates (POST /api/leads, /:id PUT, etc.) from
--                        the JWT sub claim. ON DELETE SET NULL so we
--                        do not orphan a lead when the author leaves.
--   added_by_system     — Boolean. True for rows created by automated
--                        processes (bulk imports, AI-generate, etc.).
--                        The list "Added by" column reads:
--                          added_by_system=1                → "System"
--                          else added_by_user_id IS NOT NULL → display_name
--                          else                             → "—"
--
-- Backfill: every existing lead is treated as healthcare-sector +
-- system-added per the project owner's directive.

ALTER TABLE `leads`
  ADD COLUMN `industry`           VARCHAR(120) NULL AFTER `source`,
  ADD COLUMN `service_offering_id` INT UNSIGNED NULL AFTER `industry`,
  ADD COLUMN `contacted_at`       DATETIME     NULL AFTER `service_offering_id`,
  ADD COLUMN `added_by_user_id`   INT UNSIGNED NULL AFTER `contacted_at`,
  ADD COLUMN `added_by_system`    TINYINT(1)   NOT NULL DEFAULT 0 AFTER `added_by_user_id`,
  ADD KEY `idx_industry`       (`industry`),
  ADD KEY `idx_service`        (`service_offering_id`),
  ADD KEY `idx_contacted_at`   (`contacted_at`),
  ADD KEY `idx_added_by_user`  (`added_by_user_id`),
  ADD CONSTRAINT `fk_lead_service_offering`
    FOREIGN KEY (`service_offering_id`) REFERENCES `service_offerings`(`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_lead_added_by_user`
    FOREIGN KEY (`added_by_user_id`) REFERENCES `admin_users`(`id`) ON DELETE SET NULL;

-- Backfill existing rows — every lead currently on the books was
-- imported by the lead-gen pipeline against the healthcare sector.
UPDATE `leads`
   SET `industry`        = 'Healthcare',
       `added_by_system` = 1
 WHERE `industry` IS NULL;
