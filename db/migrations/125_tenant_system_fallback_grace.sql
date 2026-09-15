-- Migration 125: per-tenant grace period for the system email fallback.
--
-- Tenants get 30 days of "free" system-fallback delivery from account
-- creation. After that, unrouted email sends stop working until they
-- configure their own provider (Postmark/Resend/Brevo/etc). The Mailer
-- checks this on every send-via-fallback and refuses cleanly after the
-- grace date passes.
--
-- Existing tenants are grandfathered with a 30-day grace from today so
-- the enforcement rolls out non-breakingly. New tenants get the same
-- 30-day window from their created_at.

ALTER TABLE `tenants`
  ADD COLUMN `system_fallback_grace_until` DATE NULL
    COMMENT '30-day system-SMTP fallback window; NULL = no grace granted'
    AFTER `deleted_at`;

-- Grandfather every active tenant with 30 days from today.
UPDATE `tenants`
   SET `system_fallback_grace_until` = DATE_ADD(CURRENT_DATE, INTERVAL 30 DAY)
 WHERE `system_fallback_grace_until` IS NULL
   AND `status` IN ('active','provisioning');
