-- Migration 153: url_status column on company_leads.
--
-- The Qualify pass now classifies each company website (DNS + HTTP headers +
-- a small body sample, no rendering) as live / parked / for_sale / unconfigured
-- / dead / unknown. We store that verdict so the pipeline list can flag a
-- website icon RED when the domain isn't actually a live business site (parked
-- or for sale), instead of gold. NULL = not yet checked; treated as active.
-- Also lets the contact crawl skip parking pages, whose fake "related searches"
-- blocks would otherwise feed junk emails/phones into enrichment.

USE `builtrightstudio_cms`;

ALTER TABLE `company_leads`
  ADD COLUMN `url_status` VARCHAR(20) NULL AFTER `url`;
