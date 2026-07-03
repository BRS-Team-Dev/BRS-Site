-- Migration 123: advanced custom headers on email providers.
--
-- `custom_headers_json` stores a JSON object mapping header name → value.
-- The dispatcher (api/lib/EmailDispatcher.php) merges these into every
-- outbound message, letting tenants add things like:
--
--   { "List-Unsubscribe": "<mailto:unsub@x.com>, <https://x.com/unsub>",
--     "X-Priority":       "1",
--     "X-Campaign-Id":    "roadmap-may" }
--
-- Default is NULL — sensible built-in headers already ship without
-- needing tenant config. The Settings UI hides this behind an
-- "Advanced" disclosure so casual users don't see it.

ALTER TABLE `email_providers`
  ADD COLUMN `custom_headers_json` TEXT NULL AFTER `smtp_encryption`;
