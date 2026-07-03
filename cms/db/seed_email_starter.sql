-- One-off seed: give every existing tenant a "starter kit" of email
-- provider templates so tenants see every supported option pre-listed
-- in Settings → Email. All 8 rows land inactive with empty credentials —
-- filling any in makes it usable and flips the status to "Ready" once
-- test-send confirms delivery.
--
-- Idempotent: uses INSERT IGNORE on the (tenant_id, name) unique key,
-- so re-running never duplicates rows.

-- Loop over every existing active tenant.
DELIMITER $$
DROP PROCEDURE IF EXISTS seed_email_starters $$
CREATE PROCEDURE seed_email_starters()
BEGIN
  DECLARE done INT DEFAULT 0;
  DECLARE tid  INT UNSIGNED;
  DECLARE cur  CURSOR FOR
    SELECT id FROM tenants WHERE status IN ('active','provisioning');
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;
  OPEN cur;
  seed_loop: LOOP
    FETCH cur INTO tid;
    IF done THEN LEAVE seed_loop; END IF;

    INSERT IGNORE INTO email_providers
      (tenant_id, provider, name, is_active, from_email, from_name,
       smtp_host, smtp_port, smtp_encryption)
    VALUES
      -- API-key based transactional providers
      (tid, 'postmark', 'Postmark',   0, '', '', NULL, NULL, 'tls'),
      (tid, 'resend',   'Resend',     0, '', '', NULL, NULL, 'tls'),
      (tid, 'sendgrid', 'SendGrid',   0, '', '', NULL, NULL, 'tls'),
      (tid, 'brevo',    'Brevo',      0, '', '', NULL, NULL, 'tls'),
      -- Providers with extra config
      (tid, 'mailgun',  'Mailgun',    0, '', '', NULL, NULL, 'tls'),
      (tid, 'ses',      'Amazon SES', 0, '', '', NULL, NULL, 'tls'),
      -- SMTP presets — hosts + ports pre-filled so the tenant only
      -- needs to add their app-password / auth username to get going.
      (tid, 'smtp', 'Gmail (SMTP)',   0, '', '', 'smtp.gmail.com',     587, 'tls'),
      (tid, 'smtp', 'Outlook (SMTP)', 0, '', '', 'smtp.office365.com', 587, 'tls');
  END LOOP;
  CLOSE cur;
END $$
DELIMITER ;

CALL seed_email_starters();
DROP PROCEDURE seed_email_starters;

SELECT tenant_id, provider, name, smtp_host, smtp_port, is_active
  FROM email_providers ORDER BY tenant_id, id;
