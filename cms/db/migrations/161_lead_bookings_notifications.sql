-- Notification + Teams-meeting metadata for lead_bookings.
--
-- All columns are nullable so existing INSERTs in lead_bookings.php and
-- public_lead_booking.php keep working without change. Populated by
-- LeadBookingNotifier and (for customer_timezone) by the public booking route.

ALTER TABLE `lead_bookings`
  -- Microsoft Graph online meeting id, once auto-created. Nullable so
  -- bookings still save if Teams integration is unconfigured or Graph is
  -- down; a retry job can fill it later.
  ADD COLUMN `teams_meeting_id` VARCHAR(255) NULL AFTER `meeting_url`,

  -- Idempotency marker for LeadBookingNotifier::onScheduled(). A non-null
  -- value means the "booking scheduled" notification pipeline has already
  -- fired for the current scheduled_at. When scheduled_at changes it is
  -- reset to NULL so the "rescheduled" variant fires.
  ADD COLUMN `notification_sent_at` DATETIME NULL AFTER `teams_meeting_id`,

  -- Per-booking override of internal notification recipients (JSON array
  -- of email addresses). NULL means use the tenant's default recipient
  -- list from settings. Editing this field on one booking never changes
  -- the tenant default.
  ADD COLUMN `notification_recipients` TEXT NULL AFTER `notification_sent_at`,

  -- IANA timezone name the visitor picked their slot in (e.g.
  -- 'America/New_York'). Written by public_lead_booking.php; NULL for
  -- admin-created bookings (assumed Europe/London). Used to render the
  -- client-facing email in the visitor's own local time rather than UK.
  ADD COLUMN `customer_timezone` VARCHAR(60) NULL AFTER `source`;
