-- One-off seed for the newsletter module.
-- Creates four representative campaigns covering the four statuses
-- (draft / scheduled / sent x2) and every block type + audience mix.
-- Idempotent: DELETEs by subject before inserting so re-runs stay clean.

SET @tid = 1;

-- Reset any prior seed rows so re-runs don't stack duplicates.
DELETE FROM newsletter_campaigns WHERE tenant_id = @tid AND subject IN (
  'Q4 product roadmap — draft',
  'Founder''s monthly note — May',
  'Welcome to BuiltRightStudio',
  'How''s it going? Quick 30-second survey'
);

-- Grab a published feedback poll token so the Feedback CTA block links
-- to a real form. Falls back to a placeholder if no polls exist.
SET @poll_token = (
  SELECT public_token FROM feedback_forms
   WHERE tenant_id = @tid AND is_published = 1 AND kind = 'poll'
   ORDER BY id LIMIT 1
);
SET @poll_title = (
  SELECT title FROM feedback_forms
   WHERE tenant_id = @tid AND is_published = 1 AND kind = 'poll'
   ORDER BY id LIMIT 1
);

-- ── 1. DRAFT — Q4 product roadmap ──────────────────────────────
INSERT INTO newsletter_campaigns
  (tenant_id, subject, body_html, blocks_json,
   audience_clients, audience_leads, audience_custom_emails, status)
VALUES (
  @tid,
  'Q4 product roadmap — draft',
  '<div style="max-width:600px;margin:0 auto;padding:24px;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#333;">
    <h2 style="font-family:Arial,Helvetica,sans-serif;font-size:20px;margin:18px 0 10px 0;color:#222;font-weight:700;">What''s shipping this quarter</h2>
    <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#333;margin:10px 0;">
      Three things landing before December: automated onboarding
      qualification, a rebuilt Task Board, and native Slack alerts.
      Details below.
    </p>
    <h3 style="font-family:Arial,Helvetica,sans-serif;font-size:16px;margin:18px 0 10px 0;color:#222;font-weight:700;">1. Auto-qualification</h3>
    <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#333;margin:10px 0;">
      No more clicking Qualify after every submission. The pipeline
      moves the moment your client hits Submit.
    </p>
    <hr style="border:none;border-top:1px solid #ddd;margin:22px 0;" />
    <div style="text-align:left;margin:18px 0;">
      <a href="https://builtrightstudio.com/roadmap"
         style="display:inline-block;padding:11px 22px;background:#0a0a0a;color:#ffffff;text-decoration:none;border-radius:4px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:600;">
         Read the full roadmap →
      </a>
    </div>
  </div>',
  '[
    {"id":"b1a","kind":"heading","text":"What''s shipping this quarter","level":2,"align":"left"},
    {"id":"b1b","kind":"paragraph","text":"Three things landing before December: automated onboarding qualification, a rebuilt Task Board, and native Slack alerts. Details below.","align":"left"},
    {"id":"b1c","kind":"heading","text":"1. Auto-qualification","level":3,"align":"left"},
    {"id":"b1d","kind":"paragraph","text":"No more clicking Qualify after every submission. The pipeline moves the moment your client hits Submit.","align":"left"},
    {"id":"b1e","kind":"divider"},
    {"id":"b1f","kind":"button","label":"Read the full roadmap →","url":"https://builtrightstudio.com/roadmap","align":"left"}
  ]',
  1, 0,
  'alice@example.com, bob@example.com',
  'draft'
);

-- ── 2. SCHEDULED — Founder's monthly note ──────────────────────
INSERT INTO newsletter_campaigns
  (tenant_id, subject, body_html, blocks_json,
   audience_clients, audience_leads, audience_custom_emails,
   status, scheduled_at)
VALUES (
  @tid,
  'Founder''s monthly note — May',
  '<div style="max-width:600px;margin:0 auto;padding:24px;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#333;">
    <h1 style="font-family:Arial,Helvetica,sans-serif;font-size:24px;margin:18px 0 10px 0;color:#222;font-weight:700;">Hey there,</h1>
    <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#333;margin:10px 0;">
      Quick update from the studio this month. We wrapped four sites,
      onboarded eleven new clients, and shipped the Feedback module
      you''ve been asking about.
    </p>
    <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#333;margin:10px 0;">
      If you''re on the fence about a rebuild, reply to this email and
      we''ll block off 15 minutes to talk through your goals — no
      pitch, just an honest opinion.
    </p>
    <div style="height:24px;line-height:24px;font-size:0;">&nbsp;</div>
    <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#333;margin:10px 0;">
      — Bobby
    </p>
  </div>',
  '[
    {"id":"b2a","kind":"heading","text":"Hey there,","level":1,"align":"left"},
    {"id":"b2b","kind":"paragraph","text":"Quick update from the studio this month. We wrapped four sites, onboarded eleven new clients, and shipped the Feedback module you''ve been asking about.","align":"left"},
    {"id":"b2c","kind":"paragraph","text":"If you''re on the fence about a rebuild, reply to this email and we''ll block off 15 minutes to talk through your goals — no pitch, just an honest opinion.","align":"left"},
    {"id":"b2d","kind":"spacer","height":24},
    {"id":"b2e","kind":"paragraph","text":"— Bobby","align":"left"}
  ]',
  0, 1, NULL,
  'scheduled',
  NOW() + INTERVAL 2 DAY
);

-- ── 3. SENT — Welcome to BuiltRightStudio ──────────────────────
INSERT INTO newsletter_campaigns
  (tenant_id, subject, body_html, blocks_json,
   audience_clients, audience_leads, audience_custom_emails,
   status, sent_at, recipient_count, sent_count, failed_count)
VALUES (
  @tid,
  'Welcome to BuiltRightStudio',
  '<div style="max-width:600px;margin:0 auto;padding:24px;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#333;">
    <h1 style="font-family:Arial,Helvetica,sans-serif;font-size:24px;margin:18px 0 10px 0;color:#222;font-weight:700;text-align:center;">Welcome aboard</h1>
    <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#333;margin:10px 0;text-align:center;">
      Thanks for signing up. Here''s what to expect from us: one email
      per month, roadmap highlights, and the occasional case study.
      That''s it.
    </p>
    <hr style="border:none;border-top:1px solid #ddd;margin:22px 0;" />
    <h2 style="font-family:Arial,Helvetica,sans-serif;font-size:20px;margin:18px 0 10px 0;color:#222;font-weight:700;">Where to start</h2>
    <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#333;margin:10px 0;">
      If you''re new here, the two most useful things we make are the
      onboarding portal and the CRM task board. Both are in your
      admin panel.
    </p>
    <div style="text-align:center;margin:18px 0;">
      <a href="https://builtrightstudio.com/admin"
         style="display:inline-block;padding:11px 22px;background:#0a0a0a;color:#ffffff;text-decoration:none;border-radius:4px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:600;">
         Open admin panel
      </a>
    </div>
  </div>',
  '[
    {"id":"b3a","kind":"heading","text":"Welcome aboard","level":1,"align":"center"},
    {"id":"b3b","kind":"paragraph","text":"Thanks for signing up. Here''s what to expect from us: one email per month, roadmap highlights, and the occasional case study. That''s it.","align":"center"},
    {"id":"b3c","kind":"divider"},
    {"id":"b3d","kind":"heading","text":"Where to start","level":2,"align":"left"},
    {"id":"b3e","kind":"paragraph","text":"If you''re new here, the two most useful things we make are the onboarding portal and the CRM task board. Both are in your admin panel.","align":"left"},
    {"id":"b3f","kind":"button","label":"Open admin panel","url":"https://builtrightstudio.com/admin","align":"center"}
  ]',
  1, 1, NULL,
  'sent',
  NOW() - INTERVAL 14 DAY,
  3, 3, 0
);
SET @c3 = LAST_INSERT_ID();

-- Recipients for campaign 3 (populates the send log table)
INSERT INTO newsletter_recipients
  (tenant_id, campaign_id, email, name, source, source_id, unsubscribe_token, status, sent_at) VALUES
  (@tid, @c3, 't@test.com',                    'Bobby Jackson', 'client', 1, LOWER(REPLACE(UUID(),'-','')), 'sent', NOW() - INTERVAL 14 DAY),
  (@tid, @c3, 'acme-test@acme-example.com',    'Jane Tester',   'client', 2, LOWER(REPLACE(UUID(),'-','')), 'sent', NOW() - INTERVAL 14 DAY),
  (@tid, @c3, 'kira@brightlane.example.co.uk', 'Kira Holland',  'client', 3, LOWER(REPLACE(UUID(),'-','')), 'sent', NOW() - INTERVAL 14 DAY);

-- ── 4. SENT — feedback CTA newsletter ──────────────────────────
INSERT INTO newsletter_campaigns
  (tenant_id, subject, body_html, blocks_json,
   audience_clients, audience_leads, audience_custom_emails,
   status, sent_at, recipient_count, sent_count, failed_count)
VALUES (
  @tid,
  'How''s it going? Quick 30-second survey',
  CONCAT('<div style="max-width:600px;margin:0 auto;padding:24px;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#333;">
    <h2 style="font-family:Arial,Helvetica,sans-serif;font-size:20px;margin:18px 0 10px 0;color:#222;font-weight:700;">One question, thirty seconds</h2>
    <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#333;margin:10px 0;">
      We''re planning next quarter and want to hear from you.
      Which tier are you leaning toward? Tap below.
    </p>
    <div style="text-align:center;margin:22px 0;">
      <a href="http://localhost:4200/builtrightstudio/cms/feedback/', COALESCE(@poll_token, 'PLACEHOLDER'), '?id=0"
         style="display:inline-block;padding:12px 24px;background:#0a0a0a;color:#ffffff;text-decoration:none;border-radius:4px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:600;">
         Give feedback →
      </a>
    </div>
    <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#333;margin:10px 0;text-align:center;">
      <em>Answers stay anonymous unless you opt in.</em>
    </p>
  </div>'),
  CONCAT('[
    {"id":"b4a","kind":"heading","text":"One question, thirty seconds","level":2,"align":"left"},
    {"id":"b4b","kind":"paragraph","text":"We''re planning next quarter and want to hear from you. Which tier are you leaning toward? Tap below.","align":"left"},
    {"id":"b4c","kind":"feedback","formToken":"', COALESCE(@poll_token, ''), '","formTitle":"', COALESCE(@poll_title, ''), '","label":"Give feedback →","align":"center","publicBase":"http://localhost:4200/builtrightstudio/cms"},
    {"id":"b4d","kind":"paragraph","text":"Answers stay anonymous unless you opt in.","align":"center"}
  ]'),
  1, 0, NULL,
  'sent',
  NOW() - INTERVAL 3 DAY,
  2, 2, 0
);
SET @c4 = LAST_INSERT_ID();

INSERT INTO newsletter_recipients
  (tenant_id, campaign_id, email, name, source, source_id, unsubscribe_token, status, sent_at) VALUES
  (@tid, @c4, 't@test.com',                 'Bobby Jackson', 'client', 1, LOWER(REPLACE(UUID(),'-','')), 'sent', NOW() - INTERVAL 3 DAY),
  (@tid, @c4, 'acme-test@acme-example.com', 'Jane Tester',   'client', 2, LOWER(REPLACE(UUID(),'-','')), 'sent', NOW() - INTERVAL 3 DAY);

-- Summary
SELECT id, subject, status, scheduled_at, sent_at,
       audience_clients AS c, audience_leads AS l, audience_custom_emails AS custom,
       recipient_count, sent_count
  FROM newsletter_campaigns
 WHERE tenant_id = @tid AND subject IN (
   'Q4 product roadmap — draft',
   'Founder''s monthly note — May',
   'Welcome to BuiltRightStudio',
   'How''s it going? Quick 30-second survey'
 )
 ORDER BY id;
