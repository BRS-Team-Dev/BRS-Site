-- Demo data for the Recruitment system. Safe to re-run: clears + reseeds.
-- NOT a migration — run manually when you want fresh demo data; never
-- include in production deploys.

USE `builtrightstudio_cms`;

-- Wipe (cascades to candidate documents + notes via FKs)
DELETE FROM `recruitment_candidates`;
ALTER TABLE `recruitment_candidates` AUTO_INCREMENT = 1;

-- ─────────────────────────── CANDIDATES ────────────────────────────────
INSERT INTO `recruitment_candidates`
  (first_name, last_name, email, phone, dob, nationality,
   address_line1, city, postcode, country,
   role, discipline, experience_level, experience_years,
   day_rate, currency, availability, source, status,
   contract_signed_at, notes) VALUES

  ('Aaron',  'Mitchell',  'aaron.mitchell@example.com',  '+44 7700 900101', '1990-04-12', 'British',
   '12 Wharf Street', 'Manchester', 'M3 5LF', 'United Kingdom',
   'Quantity Surveyor', 'Construction', 'senior', 8,
   525.00, 'GBP', 'immediate', 'LinkedIn', 'available',
   '2026-05-22 09:14:00', 'Strong QS background — recently led the new Salford schools framework. Highly recommended by previous PM.'),

  ('Priya',  'Sharma',    'priya.sharma@example.com',    '+44 7700 900102', '1993-07-29', 'British',
   '47 Northdown Road', 'London', 'EC1V 9NR', 'United Kingdom',
   'Site Manager',    'Construction', 'mid',    5,
   475.00, 'GBP', 'one_week', 'Referral · J. Reilly', 'placed',
   '2026-04-10 11:00:00', 'Placed with Acme Build Ltd until end of Q3. Renewal likely.'),

  ('Daniel', 'O''Connor', 'd.oconnor@example.com',       '+44 7700 900103', '1988-11-04', 'Irish',
   '8 Liffey View', 'Liverpool', 'L1 8JQ', 'United Kingdom',
   'Project Manager', 'Construction', 'senior', 10,
   600.00, 'GBP', 'two_weeks', 'CV-Library', 'onboarding',
   NULL, 'PMP-certified; finishing notice period with Carillion remnant. RTW reviewed but DBS outstanding.'),

  ('Sofia',  'Almeida',   'sofia.almeida@example.com',   '+44 7700 900104', '1995-02-17', 'Portuguese',
   '203 Mile End Road', 'London', 'E1 4UN', 'United Kingdom',
   'M&E Coordinator', 'Construction', 'mid',    4,
   420.00, 'GBP', 'immediate', 'Indeed', 'screening',
   NULL, 'Awaiting reference confirmations from two prior contractors.'),

  ('Marcus', 'Reid',      'marcus.reid@example.com',     '+44 7700 900105', '1985-09-22', 'British',
   '5 Granby Street', 'Leeds', 'LS1 6BB', 'United Kingdom',
   'Health & Safety Advisor', 'Construction', 'senior', 12,
   500.00, 'GBP', 'one_month', 'Referral · OSH Network', 'available',
   '2026-06-01 14:30:00', 'NEBOSH Diploma + CDM Coordinator. Day rate negotiable for long contracts.'),

  ('Elena',  'Petrova',   'elena.petrova@example.com',   '+44 7700 900106', '1992-12-08', 'Bulgarian',
   '78 Hagley Road', 'Birmingham', 'B16 8QN', 'United Kingdom',
   'Senior Estimator', 'Construction', 'senior', 9,
   550.00, 'GBP', 'two_weeks', 'LinkedIn', 'onboarding',
   NULL, 'Tier 2 visa transfer required — sponsorship confirmed by client. Awaiting Home Office decision.'),

  ('James',  'Wright',    'james.wright@example.com',    '+44 7700 900107', '1997-06-13', 'British',
   '14 Park Avenue', 'Bristol', 'BS6 6AB', 'United Kingdom',
   'Trainee Site Engineer', 'Construction', 'junior',  1,
   220.00, 'GBP', 'immediate', 'University careers fair', 'new',
   NULL, 'Recent Civil Engineering graduate (1st class, Bristol). No site experience yet.'),

  ('Aisha',  'Khan',      'aisha.khan@example.com',      '+44 7700 900108', '1989-03-25', 'British',
   '90 King Street', 'Edinburgh', 'EH1 1RB', 'United Kingdom',
   'Document Controller', 'Construction', 'mid',    6,
   295.00, 'GBP', 'immediate', 'Direct application', 'available',
   '2026-05-30 10:00:00', 'Asite + Aconex expert. Open to hybrid only — no full on-site.'),

  ('Liam',   'Murphy',    'liam.murphy@example.com',     '+44 7700 900109', '1991-08-19', 'Irish',
   '22 Cherry Lane', 'Manchester', 'M14 7DR', 'United Kingdom',
   'Electrical Supervisor', 'Construction', 'senior', 11,
   460.00, 'GBP', 'two_weeks', 'Jobboard', 'placed',
   '2026-03-18 09:00:00', 'Placed with North-West Energy. Excellent feedback; would re-place immediately on rotation.'),

  ('Hannah', 'Cole',      'hannah.cole@example.com',     '+44 7700 900110', '1994-10-02', 'British',
   '6 Riverside Walk', 'Newcastle', 'NE1 3UF', 'United Kingdom',
   'Planner', 'Construction', 'mid', 5,
   430.00, 'GBP', 'one_week', 'Referral · S. Hill', 'screening',
   NULL, 'P6 + Asta expert. Currently between roles after Galliford restructure.'),

  ('Tom',    'Brennan',   'tom.brennan@example.com',     '+44 7700 900111', '1983-01-15', 'British',
   '101 The Avenue', 'Glasgow', 'G12 8QQ', 'United Kingdom',
   'Commercial Manager', 'Construction', 'lead', 18,
   725.00, 'GBP', 'later', 'Headhunt', 'inactive',
   NULL, 'Approached for senior commercial role but currently committed elsewhere until Jan-2027.'),

  ('Yuki',   'Tanaka',    'yuki.tanaka@example.com',     '+44 7700 900112', '1996-05-21', 'Japanese',
   '34 Old Park Lane', 'London', 'W1K 1QA', 'United Kingdom',
   'Architectural Technologist', 'Construction', 'mid', 4,
   410.00, 'GBP', 'immediate', 'LinkedIn', 'available',
   '2026-06-05 15:00:00', 'Revit + Rhino expert. BIM Level 2 trained. Skilled vis portfolio.'),

  ('Kwame',  'Asante',    'kwame.asante@example.com',    '+44 7700 900113', '1987-09-30', 'British',
   '15 Heath Drive', 'Manchester', 'M20 3LR', 'United Kingdom',
   'Civil Engineer (Roads)', 'Construction', 'senior', 9,
   495.00, 'GBP', 'two_weeks', 'Referral · D. O''Connor', 'onboarding',
   NULL, 'Highways England experience. References cleared; finishing right-to-work check.'),

  ('Rebecca','Owens',     'rebecca.owens@example.com',   '+44 7700 900114', '1992-02-11', 'British',
   '88 Briarwood Close', 'Sheffield', 'S10 3BG', 'United Kingdom',
   'Cost Consultant', 'Construction', 'mid', 6,
   460.00, 'GBP', 'one_week', 'CV-Library', 'new',
   NULL, 'Just received first contact — discovery call scheduled for next Tuesday.'),

  ('Ahmed',  'Ibrahim',   'ahmed.ibrahim@example.com',   '+44 7700 900115', '1990-11-08', 'Egyptian',
   '7 Argyle Square', 'London', 'WC1H 8AS', 'United Kingdom',
   'BIM Coordinator', 'Construction', 'senior', 8,
   500.00, 'GBP', 'immediate', 'LinkedIn', 'rejected',
   NULL, 'Strong technical fit but role required UK-driving + site travel which candidate declined.');

-- Notes (a couple per candidate so the Notes tab isn't empty)
INSERT INTO `recruitment_candidate_notes` (candidate_id, title, body, sort_order) VALUES
  (1, 'First call',         'Energetic, very clear on rate expectations. Open to inside-IR35 only.', 0),
  (1, 'Reference check',    'Spoke with Sarah Hill (ex-PM) — strong endorsement on commercial side.', 1),
  (2, 'Placement check-in', '3-month review with Acme Build — client extremely happy. Likely renewal Sept.', 0),
  (3, 'DBS update',         'Application submitted via Disclosure Scotland 2026-06-04. Awaiting result.', 0),
  (5, 'Day rate window',    'Will flex to £475 for 6+ month contracts. Strict no on under 3 months.', 0),
  (6, 'Visa milestone',     'Sponsor licence on file. CoS issued; Home Office decision expected within 4 weeks.', 0),
  (9, 'Renewal',            'Confirmed willing to extend with NW Energy if rotation pattern keeps current 2:1.', 0),
  (12,'Portfolio',          'Linked portfolio in CV email. Especially strong residential interior viz work.', 0);

-- Compliance documents — info-only entries (no files on disk needed).
-- Mix of statuses so the Documents page chips show realistic counts.
INSERT INTO `recruitment_candidate_documents`
  (candidate_id, doc_type_id, title, file_path, file_size, mime_type,
   reference_number, issuing_body, issued_at, expires_at, status, uploaded_by) VALUES

  -- Aaron (1) — fully compliant
  (1, 1, 'Right to work',                NULL, NULL, NULL, 'RTW-AM-2026-0042', 'Home Office', '2026-01-15', '2031-01-14', 'valid',   NULL),
  (1, 2, 'Passport / National ID',       NULL, NULL, NULL, 'GBR123456',        'HM Passport Office', '2021-06-01', '2031-06-01', 'valid', NULL),
  (1, 4, 'National Insurance number',    NULL, NULL, NULL, 'AB123456C',        'HMRC',         NULL,         NULL,         'valid',   NULL),
  (1, 8, 'Bank details',                 NULL, NULL, NULL, '04-00-04 12345678','Monzo Bank',   NULL,         NULL,         'valid',   NULL),

  -- Daniel (3) — onboarding; some valid, DBS pending
  (3, 1, 'Right to work',                NULL, NULL, NULL, 'RTW-DOC-2026-0107','Home Office', '2026-04-02', '2029-04-01', 'valid',   NULL),
  (3, 2, 'Passport / National ID',       NULL, NULL, NULL, 'IRL876541',        'Department of Foreign Affairs (IE)', '2019-09-10', '2029-09-10', 'valid', NULL),
  (3, 5, 'Enhanced DBS',                 NULL, NULL, NULL, '001122334455',     'Disclosure & Barring Service', '2026-06-04', NULL, 'pending', NULL),

  -- Sofia (4) — screening; one valid + one rejected (reupload pending)
  (4, 1, 'Right to work',                NULL, NULL, NULL, 'RTW-SA-2026-0211','Home Office', '2024-08-12', '2027-08-11', 'valid',   NULL),
  (4, 3, 'Proof of address',             NULL, NULL, NULL, NULL,               'British Gas',  '2026-02-01', NULL,         'rejected',NULL),

  -- Elena (6) — onboarding; visa-driven
  (6, 1, 'Right to work',                NULL, NULL, NULL, 'CoS-2026-EP-0001','Home Office', '2026-05-20', '2029-05-19', 'pending', NULL),
  (6, 2, 'Passport / National ID',       NULL, NULL, NULL, 'BG7654321',        'Bulgarian Republic', '2022-03-14', '2032-03-13', 'valid', NULL),

  -- Kwame (13) — onboarding; references in flight
  (13, 1, 'Right to work',               NULL, NULL, NULL, 'RTW-KA-2026-0319','Home Office', '2026-03-30', '2031-03-29', 'valid',   NULL),
  (13, 7, 'References',                  NULL, NULL, NULL, NULL,               'Highways England', NULL,        NULL,         'pending', NULL);
