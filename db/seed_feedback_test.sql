-- One-off seed for the feedback module.
-- Creates four representative forms (one per kind) plus questions and
-- 3 responses each — enough to exercise the responses tab, client/lead
-- badges, and every question widget.
--
-- Idempotent-ish: DELETEs the four seeded titles first so re-running
-- doesn't stack duplicates. Cascades wipe the questions/responses/answers
-- automatically.

SET @tid = 1;                         -- BRS tenant
SET @author = (SELECT id FROM admin_users WHERE tenant_id = @tid LIMIT 1);

DELETE FROM feedback_forms WHERE tenant_id = @tid AND title IN (
  'Quick pulse — service tier interest',
  'Post-project satisfaction survey',
  'Tell us what you think',
  'New-client onboarding questionnaire'
);

-- ── 1. Poll ─────────────────────────────────────────────────────────
INSERT INTO feedback_forms
  (tenant_id, kind, title, description, submit_label, thank_you_message,
   public_token, is_published, created_by_user_id)
VALUES (
  @tid, 'poll',
  'Quick pulse — service tier interest',
  'Which package matches what you were looking for today?',
  'Cast vote',
  'Thanks — we\'ll factor this into next quarter\'s pricing.',
  LOWER(CONCAT(LPAD(HEX(FLOOR(RAND()*POW(2,32))),8,'0'),
               LPAD(HEX(FLOOR(RAND()*POW(2,32))),8,'0'),
               LPAD(HEX(FLOOR(RAND()*POW(2,32))),8,'0'),
               LPAD(HEX(FLOOR(RAND()*POW(2,32))),8,'0'),
               LPAD(HEX(FLOOR(RAND()*POW(2,32))),8,'0'))),
  1, @author
);
SET @f1 = LAST_INSERT_ID();

INSERT INTO feedback_questions (tenant_id, form_id, type, label, options_json, is_required, sort_order)
VALUES
  (@tid, @f1, 'single_choice', 'Which tier caught your eye?',
   '["Starter","Growth","Scale"]', 1, 0);

-- ── 2. Survey ───────────────────────────────────────────────────────
INSERT INTO feedback_forms
  (tenant_id, kind, title, description, submit_label, thank_you_message,
   public_token, is_published, created_by_user_id)
VALUES (
  @tid, 'survey',
  'Post-project satisfaction survey',
  'Six questions — takes about two minutes. Your answers help us hire and train.',
  'Submit survey',
  'Appreciate the time — we read every response.',
  LOWER(CONCAT(LPAD(HEX(FLOOR(RAND()*POW(2,32))),8,'0'),
               LPAD(HEX(FLOOR(RAND()*POW(2,32))),8,'0'),
               LPAD(HEX(FLOOR(RAND()*POW(2,32))),8,'0'),
               LPAD(HEX(FLOOR(RAND()*POW(2,32))),8,'0'),
               LPAD(HEX(FLOOR(RAND()*POW(2,32))),8,'0'))),
  1, @author
);
SET @f2 = LAST_INSERT_ID();

INSERT INTO feedback_questions (tenant_id, form_id, type, label, help_text, options_json, is_required, sort_order) VALUES
  (@tid, @f2, 'rating',        'Overall, how would you rate this project?',      NULL, NULL, 1, 0),
  (@tid, @f2, 'rating',        'How would you rate communication throughout?',   NULL, NULL, 1, 1),
  (@tid, @f2, 'yes_no',        'Did we deliver on time?',                        NULL, NULL, 1, 2),
  (@tid, @f2, 'single_choice', 'How likely are you to recommend us?',            'Pick the closest match.',
   '["Very likely","Likely","Neutral","Unlikely"]', 1, 3),
  (@tid, @f2, 'multi_choice',  'Which parts of the work stood out? (pick any)',  NULL,
   '["Design quality","Speed","Support","Value for money","Onboarding"]', 0, 4),
  (@tid, @f2, 'short_text',    'One word to describe the collaboration.',        'Optional but appreciated.', NULL, 0, 5);

-- ── 3. Feedback form ────────────────────────────────────────────────
INSERT INTO feedback_forms
  (tenant_id, kind, title, description, submit_label, thank_you_message,
   public_token, is_published, created_by_user_id)
VALUES (
  @tid, 'form',
  'Tell us what you think',
  'Open-ended feedback about your recent experience. Nothing structured — just what stood out.',
  'Send feedback',
  'Thanks for taking the time.',
  LOWER(CONCAT(LPAD(HEX(FLOOR(RAND()*POW(2,32))),8,'0'),
               LPAD(HEX(FLOOR(RAND()*POW(2,32))),8,'0'),
               LPAD(HEX(FLOOR(RAND()*POW(2,32))),8,'0'),
               LPAD(HEX(FLOOR(RAND()*POW(2,32))),8,'0'),
               LPAD(HEX(FLOOR(RAND()*POW(2,32))),8,'0'))),
  1, @author
);
SET @f3 = LAST_INSERT_ID();

INSERT INTO feedback_questions (tenant_id, form_id, type, label, help_text, is_required, sort_order) VALUES
  (@tid, @f3, 'rating',    'How would you rate the overall experience?',      NULL, 1, 0),
  (@tid, @f3, 'long_text', 'What went well?',                                 'Anything specific?', 0, 1),
  (@tid, @f3, 'long_text', 'What could we have done better?',                 'Be honest — this is how we improve.', 0, 2),
  (@tid, @f3, 'yes_no',    'Would you work with us again?',                   NULL, 0, 3);

-- ── 4. Questionnaire ────────────────────────────────────────────────
INSERT INTO feedback_forms
  (tenant_id, kind, title, description, submit_label, thank_you_message,
   public_token, is_published, created_by_user_id)
VALUES (
  @tid, 'questionnaire',
  'New-client onboarding questionnaire',
  'A short discovery questionnaire before your kick-off call.',
  'Submit answers',
  'Perfect — your project lead will follow up within one working day.',
  LOWER(CONCAT(LPAD(HEX(FLOOR(RAND()*POW(2,32))),8,'0'),
               LPAD(HEX(FLOOR(RAND()*POW(2,32))),8,'0'),
               LPAD(HEX(FLOOR(RAND()*POW(2,32))),8,'0'),
               LPAD(HEX(FLOOR(RAND()*POW(2,32))),8,'0'),
               LPAD(HEX(FLOOR(RAND()*POW(2,32))),8,'0'))),
  1, @author
);
SET @f4 = LAST_INSERT_ID();

INSERT INTO feedback_questions (tenant_id, form_id, type, label, help_text, options_json, is_required, sort_order) VALUES
  (@tid, @f4, 'short_text',    'What is your business name?',                    NULL, NULL, 1, 0),
  (@tid, @f4, 'short_text',    'Website URL',                                    'If you have one.', NULL, 0, 1),
  (@tid, @f4, 'single_choice', 'Team size',                                      NULL,
   '["Just me","2-5","6-20","21-50","50+"]', 1, 2),
  (@tid, @f4, 'multi_choice',  'Which channels do you use today?',               'Pick all that apply.',
   '["Instagram","LinkedIn","TikTok","Email","Google Ads","None"]', 0, 3),
  (@tid, @f4, 'long_text',     'What outcome would make this project a success?', NULL, NULL, 1, 4);

-- ── Responses ───────────────────────────────────────────────────────
-- Helper: pick a couple of client + lead ids for tagging.
SET @c1 = (SELECT id FROM clients WHERE tenant_id = @tid LIMIT 1);
SET @c2 = (SELECT id FROM clients WHERE tenant_id = @tid LIMIT 1 OFFSET 1);
SET @l1 = (SELECT id FROM leads   WHERE tenant_id = @tid LIMIT 1);
SET @l2 = (SELECT id FROM leads   WHERE tenant_id = @tid LIMIT 1 OFFSET 1);

-- Poll responses (3 rows, all one-question)
INSERT INTO feedback_responses (tenant_id, form_id, client_id, lead_id, submitted_at, ip_address) VALUES
  (@tid, @f1, @c1,  NULL, NOW() - INTERVAL 4 DAY,  '203.0.113.14'),
  (@tid, @f1, NULL, @l1,  NOW() - INTERVAL 3 DAY,  '203.0.113.22'),
  (@tid, @f1, NULL, NULL, NOW() - INTERVAL 1 DAY,  '203.0.113.31');
SET @r1a = (SELECT id FROM feedback_responses WHERE form_id = @f1 ORDER BY id LIMIT 1);
SET @r1b = @r1a + 1;
SET @r1c = @r1a + 2;

INSERT INTO feedback_answers (tenant_id, response_id, question_id, value) VALUES
  (@tid, @r1a, (SELECT id FROM feedback_questions WHERE form_id = @f1 LIMIT 1), 'Growth'),
  (@tid, @r1b, (SELECT id FROM feedback_questions WHERE form_id = @f1 LIMIT 1), 'Scale'),
  (@tid, @r1c, (SELECT id FROM feedback_questions WHERE form_id = @f1 LIMIT 1), 'Starter');

-- Survey responses (2 rows, six-question)
INSERT INTO feedback_responses (tenant_id, form_id, client_id, lead_id, submitted_at, ip_address) VALUES
  (@tid, @f2, @c1,  NULL, NOW() - INTERVAL 10 DAY, '198.51.100.7'),
  (@tid, @f2, @c2,  NULL, NOW() - INTERVAL 2 DAY,  '198.51.100.9');
SET @r2a = (SELECT id FROM feedback_responses WHERE form_id = @f2 ORDER BY id LIMIT 1);
SET @r2b = @r2a + 1;

INSERT INTO feedback_answers (tenant_id, response_id, question_id, value)
SELECT @tid, @r2a, id,
  CASE sort_order
    WHEN 0 THEN '5'
    WHEN 1 THEN '4'
    WHEN 2 THEN 'yes'
    WHEN 3 THEN 'Very likely'
    WHEN 4 THEN '["Design quality","Speed","Value for money"]'
    WHEN 5 THEN 'thorough'
  END
FROM feedback_questions WHERE form_id = @f2;

INSERT INTO feedback_answers (tenant_id, response_id, question_id, value)
SELECT @tid, @r2b, id,
  CASE sort_order
    WHEN 0 THEN '4'
    WHEN 1 THEN '3'
    WHEN 2 THEN 'no'
    WHEN 3 THEN 'Likely'
    WHEN 4 THEN '["Support","Onboarding"]'
    WHEN 5 THEN 'friendly'
  END
FROM feedback_questions WHERE form_id = @f2;

-- Feedback form responses (3 rows)
INSERT INTO feedback_responses (tenant_id, form_id, client_id, lead_id, submitted_at, ip_address) VALUES
  (@tid, @f3, @c1,  NULL, NOW() - INTERVAL 7 DAY, '192.0.2.11'),
  (@tid, @f3, NULL, @l2,  NOW() - INTERVAL 5 DAY, '192.0.2.24'),
  (@tid, @f3, NULL, NULL, NOW() - INTERVAL 2 DAY, '192.0.2.55');
SET @r3a = (SELECT id FROM feedback_responses WHERE form_id = @f3 ORDER BY id LIMIT 1);
SET @r3b = @r3a + 1;
SET @r3c = @r3a + 2;

INSERT INTO feedback_answers (tenant_id, response_id, question_id, value)
SELECT @tid, @r3a, id,
  CASE sort_order
    WHEN 0 THEN '5'
    WHEN 1 THEN 'The kickoff workshop was excellent — the whole team was on the same page from day one.'
    WHEN 2 THEN 'Slightly tighter feedback loops on design revisions would help.'
    WHEN 3 THEN 'yes'
  END
FROM feedback_questions WHERE form_id = @f3;

INSERT INTO feedback_answers (tenant_id, response_id, question_id, value)
SELECT @tid, @r3b, id,
  CASE sort_order
    WHEN 0 THEN '4'
    WHEN 1 THEN 'Fast turnaround and clear updates.'
    WHEN 2 THEN 'Nothing major.'
    WHEN 3 THEN 'yes'
  END
FROM feedback_questions WHERE form_id = @f3;

INSERT INTO feedback_answers (tenant_id, response_id, question_id, value)
SELECT @tid, @r3c, id,
  CASE sort_order
    WHEN 0 THEN '3'
    WHEN 1 THEN 'Good communication overall.'
    WHEN 2 THEN 'Would have liked more design options up front.'
    WHEN 3 THEN ''
  END
FROM feedback_questions WHERE form_id = @f3;

-- Questionnaire responses (2 rows)
INSERT INTO feedback_responses (tenant_id, form_id, client_id, lead_id, submitted_at, ip_address) VALUES
  (@tid, @f4, NULL, @l1, NOW() - INTERVAL 6 DAY, '198.51.100.42'),
  (@tid, @f4, @c2,  NULL, NOW() - INTERVAL 1 DAY, '198.51.100.99');
SET @r4a = (SELECT id FROM feedback_responses WHERE form_id = @f4 ORDER BY id LIMIT 1);
SET @r4b = @r4a + 1;

INSERT INTO feedback_answers (tenant_id, response_id, question_id, value)
SELECT @tid, @r4a, id,
  CASE sort_order
    WHEN 0 THEN 'Northgate Studio'
    WHEN 1 THEN 'https://northgate.example'
    WHEN 2 THEN '2-5'
    WHEN 3 THEN '["Instagram","LinkedIn","Email"]'
    WHEN 4 THEN 'A steady stream of qualified enquiries from the new site within 90 days.'
  END
FROM feedback_questions WHERE form_id = @f4;

INSERT INTO feedback_answers (tenant_id, response_id, question_id, value)
SELECT @tid, @r4b, id,
  CASE sort_order
    WHEN 0 THEN 'Harbour & Co'
    WHEN 1 THEN ''
    WHEN 2 THEN '6-20'
    WHEN 3 THEN '["Google Ads","Email"]'
    WHEN 4 THEN 'Rebuild the online presence and land a top-3 Google ranking for our two main service pages.'
  END
FROM feedback_questions WHERE form_id = @f4;

-- Report
SELECT id, kind, title, is_published,
       (SELECT COUNT(*) FROM feedback_questions WHERE form_id = f.id) AS questions,
       (SELECT COUNT(*) FROM feedback_responses WHERE form_id = f.id) AS responses,
       CONCAT('http://localhost:4200/feedback/', public_token) AS public_url
  FROM feedback_forms f
 WHERE tenant_id = @tid AND id IN (@f1, @f2, @f3, @f4);
