-- Migration 146: token-less "open link" public onboarding.
--
-- Admin can now flip an onboarding form into "open link" mode: submits
-- through /onboarding/open/:slug (no token) create an on-the-fly
-- onboarding_clients row and run the same auto-provision block as the
-- invite flow — client or lead depending on public_target.
--
-- 1. forms.is_public_open  — off by default; existing forms keep the
--    invite-only behaviour they've always had. When on, the slug URL
--    is live.
--
-- 2. forms.public_target — where an anonymous submission lands:
--      client → client row + linked service (existing flow)
--      lead   → lead row (new branch)
--      none   → submission stored, no CRM record created
--    Defaults to 'client' so the natural case (submit → become a client)
--    just works. Only used when is_public_open = 1.
--
-- 3. public_onboarding_rate — one row per IP tracking recent submits
--    for the rate limiter (5/min/IP). Prunes on read; no cron needed.
--    tenant_id required so the rewriter injects it correctly.

ALTER TABLE `forms`
  ADD COLUMN `is_public_open` TINYINT(1) NOT NULL DEFAULT 0 AFTER `service_offering_id`,
  ADD COLUMN `public_target` ENUM('client','lead','none') NOT NULL DEFAULT 'client' AFTER `is_public_open`;

CREATE TABLE IF NOT EXISTS `public_onboarding_rate` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`  INT UNSIGNED NOT NULL,
  `ip`         VARCHAR(45) NOT NULL,
  `form_id`    INT UNSIGNED NOT NULL,
  `hit_at`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_por_ip_time` (`ip`, `hit_at`),
  KEY `idx_por_tenant`  (`tenant_id`),
  CONSTRAINT `fk_por_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`),
  CONSTRAINT `fk_por_form`   FOREIGN KEY (`form_id`)   REFERENCES `forms` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
