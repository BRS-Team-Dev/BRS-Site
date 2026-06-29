-- Migration 110: Tenant signup metadata.
--
-- Adds the fields collected by the public signup form on
-- /software-solutions: company URL, contact phone, company size
-- bucket, chosen colour theme slug, optional logo path. The first
-- admin's name + email still land in admin_users (per-tenant DB) —
-- these registry-level columns capture the company-wide info that
-- the super-admin sees on the tenant overview.
--
-- color_theme is a slug (e.g. 'midnight-gold', 'frosted-mint'). The
-- frontend's theme picker shows 6 panels each tied to one of these
-- slugs; the actual colour values get applied at runtime by the
-- settings.theme key once the tenant logs in.
--
-- logo_path is a relative path under cms/uploads/tenants/<id>/ — the
-- signup endpoint moves the multipart upload there during INSERT.

ALTER TABLE `tenants`
  ADD COLUMN `company_url`   VARCHAR(255) NULL AFTER `brand_name`,
  ADD COLUMN `contact_phone` VARCHAR(60)  NULL AFTER `company_url`,
  ADD COLUMN `company_size`  ENUM('1-5','5-10','10-25','25-50','50-100','100-500','1000+')
                                            NULL AFTER `contact_phone`,
  ADD COLUMN `color_theme`   VARCHAR(60)  NULL AFTER `company_size`,
  ADD COLUMN `logo_path`     VARCHAR(500) NULL AFTER `color_theme`;
