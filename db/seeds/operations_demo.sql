-- Demo / test data for the Operations Partners + Contractors + Affiliates
-- pages. Safe to re-run: clears + reseeds. NOT a migration — run manually
-- when you want fresh demo data; never include in production deploys.

-- ───────────────────────────────────────────────────────────────────────
-- Wipe (cascades to *_contacts and *_notes via FKs)
DELETE FROM affiliates;
DELETE FROM contractors;
DELETE FROM partners;
ALTER TABLE affiliates  AUTO_INCREMENT = 1;
ALTER TABLE contractors AUTO_INCREMENT = 1;
ALTER TABLE partners    AUTO_INCREMENT = 1;

-- ─────────────────────────── PARTNERS ──────────────────────────────────
INSERT INTO partners (legal_name, trading_name, partnership_type, tier, status,
  start_date, renewal_date, auto_renew, contract_value, currency,
  primary_email, primary_phone, website, address,
  registration_number, vat_number, scope) VALUES
  ('Microsoft Corporation', 'Microsoft', 'technology', 'preferred', 'active',
    '2024-01-15', '2027-01-15', 1, 250000.00, 'GBP',
    'partners@microsoft.com', '+44 20 7426 7000',
    'https://partner.microsoft.com',
    'Microsoft Campus, Thames Valley Park, Reading RG6 1WG',
    'GB1234567', 'GB123456789',
    'Cloud platform partner — Azure credits, joint go-to-market, MSP-tier benefits.'),

  ('Stripe Payments UK Ltd', 'Stripe', 'channel', 'preferred', 'active',
    '2023-08-01', '2026-08-01', 1, 0.00, 'GBP',
    'partners@stripe.com', '+44 808 169 4014',
    'https://stripe.com/partners',
    '7th Floor, The Bower, 207-211 Old Street, London EC1V 9NR',
    'GB07395942', 'GB237302329',
    'Payment processing — 0.2% override on processed volume for clients we onboard.'),

  ('Acme Reseller Group Ltd', 'Acme', 'reseller', 'standard', 'active',
    '2025-03-01', '2026-03-01', 0, 45000.00, 'GBP',
    'hello@acme-reseller.example', '+44 161 555 0102',
    'https://acme-reseller.example',
    '14 Trafford Street, Manchester M5 4DR',
    'GB09876543', NULL,
    'Resells our managed-service tier to mid-market clients in the North-West.'),

  ('FinTech Founders Collective', NULL, 'referral', 'standard', 'active',
    '2025-11-10', NULL, 0, NULL, 'GBP',
    'intro@fintechfounders.example', NULL,
    'https://fintechfounders.example',
    NULL,
    NULL, NULL,
    'Referral-only — flat £2,500 per qualified intro that converts to a paid engagement.'),

  ('Globex Strategic Holdings', 'Globex', 'strategic', 'preferred', 'paused',
    '2022-06-01', '2026-06-01', 0, 180000.00, 'USD',
    'partners@globex.example', '+1 415 555 0150',
    'https://globex.example',
    '500 Folsom Street, San Francisco, CA 94105',
    'C0123456', NULL,
    'Strategic alliance — currently paused pending their post-acquisition integration.'),

  ('NorthernData Reseller (Old)', NULL, 'reseller', 'standard', 'terminated',
    '2021-04-01', '2024-04-01', 0, 28000.00, 'GBP',
    NULL, NULL, NULL, NULL, NULL, NULL,
    'Terminated April 2024 — kept on record for historical reporting.'),

  ('Acme Sustainability Co', NULL, 'other', 'prospective', 'prospective',
    NULL, NULL, 0, NULL, 'GBP',
    'partnerships@acme-sustain.example', NULL,
    'https://acme-sustain.example',
    NULL, NULL, NULL,
    'Initial conversations — exploring a joint carbon-reporting offering for shared clients.');

-- Partner contacts (multi-stakeholder)
INSERT INTO partner_contacts (partner_id, first_name, last_name, position, email, phone, is_primary, sort_order) VALUES
  (1, 'Priya',  'Anand',     'Partner Manager',     'priya.anand@microsoft.example',  '+44 20 7426 7050', 1, 0),
  (1, 'James',  'Whitfield', 'Technical Liaison',   'james.w@microsoft.example',      '+44 20 7426 7051', 0, 1),
  (2, 'Olivia', 'Bennett',   'Channel Director',    'olivia.bennett@stripe.example',  '+44 808 169 4015', 1, 0),
  (2, 'Marcus', 'Hughes',    'Integration Engineer','marcus.hughes@stripe.example',   NULL,               0, 1),
  (3, 'Daniel', 'Lopez',     'Managing Director',   'daniel@acme-reseller.example',   '+44 161 555 0103', 1, 0),
  (4, 'Sophie', 'Chen',      'Community Lead',      'sophie@fintechfounders.example', NULL,               1, 0),
  (5, 'Robert', 'Stein',     'VP Partnerships',     'robert.stein@globex.example',    '+1 415 555 0151',  1, 0);

-- Partner notes
INSERT INTO partner_notes (partner_id, title, body, sort_order) VALUES
  (1, 'Q1 2026 QBR', 'Strong Q4 — Azure consumption up 38% YoY across our shared clients. Next QBR scheduled for 12 Mar.', 0),
  (1, 'Co-marketing approval', 'Cleared by Microsoft legal for joint case-study publication on the FinTechCo migration.', 1),
  (2, 'Override structure', '0.2% override on net-new processed volume. Quarterly invoicing, net-30.', 0),
  (3, 'Renewal discussion', 'Open question on whether to extend tier benefits — depends on H1 pipeline.', 0),
  (5, 'Pause reason', 'Their acquisition by Initech announced 2025-12 — partnership paused until integration plan is shared (~Q3 2026).', 0);

-- Partner accounts (portal / billing credentials per partner relationship)
INSERT INTO partner_accounts (partner_id, account_name, login_url, username, password, sort_order) VALUES
  (1, 'Microsoft Partner Center', 'https://partner.microsoft.com/dashboard',     'brs-msp@builtrightstudio.com',    'Demo!Azure#2026', 0),
  (1, 'Azure Billing Portal',     'https://portal.azure.com/billing',            'finance@builtrightstudio.com',    'BillPortal$Demo1', 1),
  (1, 'Microsoft Learn (admin)',  'https://learn.microsoft.com/admin',           'brs-msp@builtrightstudio.com',    'LearnDemo!9981',  2),
  (2, 'Stripe Partner Dashboard', 'https://dashboard.stripe.com/partners',       'partners@builtrightstudio.com',   'Str1pe!Demo#2026', 0),
  (2, 'Stripe Connect (test)',    'https://dashboard.stripe.com/test/connect',   'partners@builtrightstudio.com',   'TestConnect#42',   1),
  (3, 'Acme Reseller Portal',     'https://portal.acme-reseller.example/login',  'brs-team',                        'Acme!Reseller2026', 0),
  (4, 'FinTech Founders Slack',   'https://fintechfounders.slack.com',           'brs-referrals',                   'SlackDemo#FF26',   0),
  (5, 'Globex Strategic Hub',     'https://hub.globex.example/login',            'brs-strategic',                   'Globex!Hub2026',   0),
  (5, 'Globex Quarterly Reports', 'https://reports.globex.example',              'brs-reporting',                   'QtrReport!Demo',   1);

-- ─────────────────────────── CONTRACTORS ───────────────────────────────
INSERT INTO contractors (name, contractor_type, internal_external, discipline, status,
  engagement_type, rate, currency, start_date, end_date,
  primary_email, primary_phone, website, address,
  tax_id, vat_number, company_number, ir35_status, notes) VALUES

  ('Emma Carter', 'freelancer', 'external', 'Frontend Development', 'active',
    'daily', 550.00, 'GBP', '2025-09-01', NULL,
    'emma@emmacarter.dev', '+44 7700 900145', 'https://emmacarter.dev', NULL,
    '1234567890', NULL, NULL, 'outside',
    'React / Angular specialist. Outside IR35 — declared via CEST tool. Invoices monthly net-14.'),

  ('Pixel Forge Studios Ltd', 'agency', 'external', 'UI/UX Design', 'active',
    'project', 8500.00, 'GBP', '2026-02-01', '2026-05-31',
    'projects@pixelforge.example', '+44 20 7946 0123', 'https://pixelforge.example',
    'Studio 4, 25 Hatton Garden, London EC1N 8AT',
    NULL, 'GB345678901', '08765432', 'not_applicable',
    'Q1-Q2 2026 design system refresh. Agency engagement — IR35 N/A.'),

  ('Daniel Okafor', 'freelancer', 'external', 'DevOps', 'active',
    'hourly', 75.00, 'GBP', '2024-10-15', NULL,
    'daniel.okafor@example.com', '+44 7700 900222', NULL, NULL,
    '9876543210', NULL, NULL, 'outside',
    'AWS / Terraform / Kubernetes. On-call rotation eligible.'),

  ('Sara Ng', 'consultant', 'external', 'Legal — Data Protection', 'active',
    'retainer', 2400.00, 'GBP', '2025-01-01', '2026-12-31',
    'sara.ng@nglegal.example', NULL, 'https://nglegal.example', NULL,
    '5555666677', 'GB987654321', '12345678', 'outside',
    'Monthly retainer for ongoing GDPR / DPIA reviews and DPO advisory.'),

  ('Marcus Reed', 'individual', 'internal', 'Project Management', 'active',
    'full_time', 6800.00, 'GBP', '2023-04-15', NULL,
    'marcus.reed@builtright.example', '+44 7700 900318', NULL, NULL,
    NULL, NULL, NULL, 'not_applicable',
    'Internal PMO lead — runs the operations standup and partner cadence.'),

  ('Helena Vasquez', 'freelancer', 'external', 'Copywriting', 'on_break',
    'hourly', 65.00, 'GBP', '2024-06-01', NULL,
    'helena@helena-writes.example', NULL, 'https://helena-writes.example', NULL,
    '1112223334', NULL, NULL, 'outside',
    'On extended maternity break until Sept 2026. Will resume on prior rate.'),

  ('Inside-IR35 Test Engineer', 'individual', 'external', 'QA Engineering', 'on_break',
    'daily', 480.00, 'GBP', '2025-04-01', NULL,
    'q.engineer@example.com', NULL, NULL, NULL,
    '2223334445', NULL, NULL, 'inside',
    'Inside IR35 per CEST determination — PAYE via umbrella company. Engagement on hold pending Q3 budget.'),

  ('OldGuard Consulting', 'agency', 'external', 'Architecture Review', 'ended',
    'project', 12000.00, 'GBP', '2024-09-01', '2024-12-31',
    NULL, NULL, NULL, NULL, NULL, 'GB111222333', '99887766', 'not_applicable',
    'One-off architecture audit Q4 2024. Engagement complete.');

-- Contractor notes
INSERT INTO contractor_notes (contractor_id, title, body, sort_order) VALUES
  (1, 'Renewal reminder', 'Quarterly check-in — confirm she''s still happy with the workload and rate. Last raise: Jan 2025.', 0),
  (1, 'Insurance cert',   'Professional indemnity certificate on file (expires 2026-09-01). Reminder set 30 days prior.', 1),
  (2, 'Milestone 1 signed off', 'Design tokens + component library delivered on schedule. Invoice 1 of 3 approved.', 0),
  (3, 'On-call schedule', 'Covers Tue/Thu nights on the primary rotation. Pager active 18:00–08:00 UK.', 0),
  (4, 'DPIA backlog', 'Three open DPIAs — newsletter unsubscribe flow, AI lead-gen prompts, tender uploads. Review due end of June.', 0),
  (7, 'IR35 review',  'CEST run 2025-04. Re-run scheduled annually or on scope change.', 0);

-- ─────────────────────────── AFFILIATES ────────────────────────────────
INSERT INTO affiliates (name, affiliate_type, status, tier, affiliate_code, referral_link,
  commission_rate, commission_type, currency,
  payout_method, payout_threshold, payment_terms, marketing_channel,
  joined_date, end_date,
  primary_email, primary_phone, website, social_handles, notes) VALUES

  ('Tech with Lara', 'individual', 'active', 'platinum', 'lara', 'https://builtright.example/?ref=lara',
    20.00, 'percentage', 'GBP',
    'paypal', 100.00, 'Net 30', 'YouTube + Newsletter',
    '2024-03-12', NULL,
    'lara@techwithlara.example', '+44 7700 900401', 'https://techwithlara.example',
    'youtube.com/@techwithlara' || CHAR(10) || '@techwithlara_yt (X)' || CHAR(10) || '@techwithlara (Instagram)',
    'Top performer 2025. Quarterly bonus +2% on volume over £25k.'),

  ('Dev Bytes Blog', 'company', 'active', 'gold', 'devbytes', 'https://builtright.example/?ref=devbytes',
    15.00, 'percentage', 'GBP',
    'bank_transfer', 250.00, 'Net 30', 'Technical Blog',
    '2024-09-01', NULL,
    'partnerships@devbytes.example', NULL, 'https://devbytes.example',
    '@devbytes (X)' || CHAR(10) || 'devbytes.dev',
    'Strong organic SEO presence — drives high-intent traffic.'),

  ('Founder Friday Newsletter', 'individual', 'active', 'silver', 'founderfriday', 'https://builtright.example/?ref=founderfriday',
    50.00, 'flat', 'GBP',
    'stripe', 50.00, 'Monthly', 'Email Newsletter',
    '2025-05-20', NULL,
    'hello@founderfriday.example', NULL, 'https://founderfriday.example',
    'twitter.com/founderfri',
    'Flat £50 per conversion via the dedicated landing page. Mid-volume but very high LTV.'),

  ('Startup Stacks Podcast', 'individual', 'active', 'silver', 'startupstacks', 'https://builtright.example/?ref=startupstacks',
    12.00, 'percentage', 'USD',
    'paypal', 100.00, 'Net 30', 'Podcast',
    '2025-02-08', NULL,
    'partnerships@startupstacks.example', NULL, 'https://startupstacks.example',
    '@startupstacks (everywhere)',
    'US-based — paid in USD. Reads sponsorships on every other episode.'),

  ('NewbieCoder TikTok', 'individual', 'active', 'bronze', 'newbiecoder', NULL,
    10.00, 'percentage', 'GBP',
    'paypal', 25.00, 'Monthly', 'TikTok',
    '2026-01-22', NULL,
    'newbiecoder.tt@example.com', NULL, NULL,
    'tiktok.com/@newbiecoder' || CHAR(10) || '@newbiecoder_yt (YouTube Shorts)',
    'New affiliate — small but growing audience. Still ramping.'),

  ('Marketing Daily', 'company', 'paused', 'bronze', 'marketing-daily', 'https://builtright.example/?ref=marketing-daily',
    10.00, 'percentage', 'GBP',
    'bank_transfer', 100.00, 'Net 30', 'Email Newsletter',
    '2024-11-15', NULL,
    'affiliates@marketingdaily.example', NULL, NULL, NULL,
    'Paused at their request — taking a content break Q2 2026.'),

  ('Coupon Grabber', 'individual', 'suspended', 'bronze', 'coupongrabber', 'https://builtright.example/?ref=coupongrabber',
    8.00, 'percentage', 'GBP',
    'paypal', 50.00, 'Monthly', 'Coupon site',
    '2025-07-01', NULL,
    'admin@coupongrabber.example', NULL, NULL, NULL,
    'Suspended pending review — flagged for low-quality traffic patterns and high refund rate.'),

  ('Pending Influencer Inc', 'company', 'pending', 'bronze', 'pending-inf-001', NULL,
    NULL, 'percentage', 'GBP',
    'bank_transfer', NULL, NULL, 'Instagram',
    NULL, NULL,
    'apps@pending-inf.example', NULL, NULL, NULL,
    'Application received — awaiting review by the affiliate manager.'),

  ('Old Affiliate (terminated)', 'individual', 'terminated', 'bronze', 'old-aff', NULL,
    10.00, 'percentage', 'GBP',
    'bank_transfer', NULL, NULL, 'Blog',
    '2023-01-01', '2024-12-31',
    NULL, NULL, NULL, NULL,
    'Terminated end of 2024 — record kept for historical commission reporting.');

-- Affiliate notes
INSERT INTO affiliate_notes (affiliate_id, title, body, sort_order) VALUES
  (1, 'YouTube collab Q2', 'Filming a long-form tutorial Q2 — co-promoted across both channels. Track via separate UTM.', 0),
  (1, 'Top performer Q1',  'Drove £42k in attributed revenue Q1 2026. On track for platinum-tier bonus payout in April.', 1),
  (2, 'SEO ranking',       'Their "best CRM" article ranks #2 — our affiliate link is in the comparison table.', 0),
  (3, 'Conversion check',  'Conversion rate from newsletter clicks is 4.8% vs platform average 2.1%. High-intent audience.', 0),
  (5, 'Onboarding call',   'Welcomed 2026-01-25. Sent media kit and brand guidelines.', 0),
  (7, 'Investigation log', 'Quality team flagged 14/120 conversions in the prior month as suspicious. Reviewing before reinstating.', 0);
