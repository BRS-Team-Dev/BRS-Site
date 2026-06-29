-- Migration 109: Per-tenant public API key.
--
-- Powers per-tenant routing on public (no-JWT) endpoints. Each tenant
-- gets a 64-char URL-safe hex token; their marketing site embeds it
-- in the form JS and sends it as `X-Tenant-Key: …` on every public
-- request. The route looks up the tenant, sets context, and processes
-- the request against that tenant's data.
--
-- Requests with no key fall through to the BRS tenant (id=1) — this
-- keeps the existing single-tenant BRS marketing site working
-- unchanged. Once Acme onboards, their site sends their key and
-- traffic lands in their tenant.
--
-- The column is hex(32) = 64 chars, generated at provision time by
-- tenant-provision.php (which is updated in the same patch).

ALTER TABLE `tenants`
  ADD COLUMN `public_api_key` CHAR(64) NULL AFTER `status`,
  ADD UNIQUE KEY `uk_tenants_public_api_key` (`public_api_key`);

-- Backfill BRS with a freshly generated key so its marketing site can
-- be migrated off the fallback path whenever convenient. UUID (32 hex
-- chars) + first half of a salted SHA-256 (32 hex chars) → 64 chars
-- total. MySQL's `||` defaults to logical OR — use CONCAT() for string
-- joining.
UPDATE `tenants`
   SET `public_api_key` = CONCAT(
         LOWER(REPLACE(UUID(), '-', '')),
         SUBSTRING(SHA2(CONCAT('brs-seed', id, NOW(6)), 256), 1, 32)
       )
 WHERE `public_api_key` IS NULL;
