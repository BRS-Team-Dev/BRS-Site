-- 165_mailer_rendered_copy.sql
--
-- Keep the exact copy each recipient received. mailer_sends stores the
-- TEMPLATE subject/body (with {{placeholders}}); the per-recipient version
-- is rendered at send time. Without these columns the lead/client Mail tab
-- could only show the raw template ("Hi {{name}}"), not what was delivered.
--
-- Both nullable: skipped rows (unsubscribed) are never rendered, and rows
-- logged before this migration fall back to the template in the history API.

ALTER TABLE `mailer_send_recipients`
  ADD COLUMN `rendered_subject` VARCHAR(255) NULL AFTER `name`,
  ADD COLUMN `rendered_body`    MEDIUMTEXT   NULL AFTER `rendered_subject`;
