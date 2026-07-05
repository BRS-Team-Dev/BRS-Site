-- Migration 148: composite primary key on settings.
--
-- The original settings table declared `k` alone as the primary key,
-- which broke multi-tenancy — only one tenant can hold any given key
-- (e.g. only ONE tenant can store `brand_name`). Signup was silently
-- catching this as a "duplicate entry" and failing without a useful
-- message; and any tenant #2 that tried to persist settings would
-- either error or silently update tenant #1's values.
--
-- Swap the PK to (tenant_id, k). Drop the redundant idx_settings_tenant
-- index because the composite PK already covers `tenant_id` lookups on
-- its own via a prefix scan.

ALTER TABLE `settings` DROP PRIMARY KEY;
ALTER TABLE `settings` ADD PRIMARY KEY (`tenant_id`, `k`);
