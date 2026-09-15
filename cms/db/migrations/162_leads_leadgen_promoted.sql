-- Mark a lead as promoted OUT of the Lead Gen acquisition list.
--
-- The Lead Gen page (/admin/leadgen) is the working list of everything our
-- acquisition methods have produced. Promoting a row is the act of saying
-- "this is a real lead now", after which it must disappear from Lead Gen
-- AND from its originating source page (Companies House, LinkedIn, ...).
--
-- For `company_leads` rows that already worked: promote copies the record
-- into `leads` and deletes the pipeline row. But the resulting `leads` row
-- would then reappear in Lead Gen, because the Lead Gen list unions both
-- tables. This column is the marker that keeps it out, and it also lets a
-- lead that ORIGINATED in `leads` (AI prompt / import / manual) be promoted
-- out of Lead Gen without moving tables at all.
--
-- Distinct from `promoted_at` / `promoted_client_id`, which mean "promoted
-- to a CLIENT". A lead can be promoted out of Lead Gen and still never
-- become a client.
--
-- Nullable with no default: existing rows stay in Lead Gen, and every
-- existing INSERT (including the booking routes') keeps working untouched.

ALTER TABLE `leads`
  ADD COLUMN `leadgen_promoted_at` DATETIME NULL AFTER `source`;

-- The Lead Gen query filters on this for every read, so index it alongside
-- the tenant scope it is always paired with.
ALTER TABLE `leads`
  ADD INDEX `idx_leads_leadgen_promoted` (`tenant_id`, `leadgen_promoted_at`);
