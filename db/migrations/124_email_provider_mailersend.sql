-- Migration 124: add MailerSend to the email_providers ENUM.
--
-- MailerSend has a genuinely-free tier at 3,000 emails/month (no card
-- required) plus a modern REST API — makes it a good "start free" option
-- alongside Brevo and Resend.
--
-- ENUM widening only. Existing rows keep working.

ALTER TABLE `email_providers`
  MODIFY COLUMN `provider`
  ENUM('postmark','resend','sendgrid','ses','mailgun','brevo','mailersend','smtp') NOT NULL;
