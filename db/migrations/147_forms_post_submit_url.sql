-- Migration 147: per-form "redirect after submit" URL.
--
-- When set, the public open-link portal shows the Thanks card briefly
-- and then navigates the visitor to this URL (customer's own dashboard,
-- CMS login, calendly booking page, whatever the sender wants). When
-- blank, the Thanks card stays put with the standard message.
--
-- 500 chars covers arbitrary query strings + tracking params. NULL by
-- default so existing forms keep their current no-redirect behaviour.

ALTER TABLE `forms`
  ADD COLUMN `post_submit_url` VARCHAR(500) NULL AFTER `public_target`;
