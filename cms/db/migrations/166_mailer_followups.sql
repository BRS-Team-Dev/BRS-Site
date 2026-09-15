-- 166_mailer_followups.sql
--
-- Sent-emails page: outcomes and follow-ups.
--
-- `status` on mailer_send_recipients is the DELIVERY result (sent / failed /
-- skipped) and is written once, by the send. `outcome` is what happened
-- AFTER delivery - replied, interested, meeting booked, bounced ... - and is
-- set by hand from the Sent emails page, or to 'followed_up' automatically
-- when a follow-up goes out to that row. Kept separate so a hand-set outcome
-- never masks a delivery failure and vice versa.
--
-- A follow-up is an ordinary send whose recipients were picked from earlier
-- log rows rather than from the audience filter. Each new recipient row
-- points at the row it follows up (`follow_up_of_recipient_id`) and the
-- batch points at the batch it follows (`parent_send_id`, only when every
-- picked row came from the same batch). Neither is a foreign key: a follow-up
-- should survive the original being purged, and both stay NULL for normal
-- sends.

ALTER TABLE `mailer_send_recipients`
  ADD COLUMN `outcome`    VARCHAR(30) NULL AFTER `error`,
  ADD COLUMN `outcome_at` DATETIME    NULL AFTER `outcome`,
  ADD COLUMN `follow_up_of_recipient_id` INT UNSIGNED NULL AFTER `outcome_at`;

ALTER TABLE `mailer_send_recipients`
  ADD INDEX `idx_mailer_recip_followup` (`tenant_id`, `follow_up_of_recipient_id`);

ALTER TABLE `mailer_sends`
  ADD COLUMN `parent_send_id` INT UNSIGNED NULL AFTER `template_id`;
