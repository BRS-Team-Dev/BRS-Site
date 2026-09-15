-- Demo placement data for the Recruitment client detail page. Run after
-- the candidate seed so the FK targets exist. Safe to re-run: clears +
-- reseeds the placements table only.

USE `builtrightstudio_cms`;

-- 1. Flag the existing clients as recruitment clients so the
--    /recruitment/clients list has more than one row.
UPDATE `clients` SET `is_recruitment_client` = 1
  WHERE id IN (2, 3, 4);

-- 2. Wipe any prior placements (FK cascades clean these on their own
--    when candidates/clients are deleted, but we want a fresh demo set).
DELETE FROM `recruitment_placements`;
ALTER TABLE `recruitment_placements` AUTO_INCREMENT = 1;

-- 3. Seed a mix of placements across the three tabs against
--    "Sunshine Care Agency" (id=4) — that's the obvious agency-flavoured
--    client. A couple more land on `sfsf` (3) and `john doe` (2) so
--    multiple recruitment client cards show some activity.

INSERT INTO `recruitment_placements`
  (candidate_id, client_id, role, status,
   start_date, end_date, contract_value, commission_value, currency,
   commission_paid_part, commission_paid_full,
   commission_due_part, commission_due_full,
   contract_notes, rejection_reason) VALUES

-- ───────── Sunshine Care Agency (client 4) ────────────────────────────
-- Vetting (screening) — three currently in the pipeline
  (10, 4, 'Live-In Carer',           'screening', NULL, NULL, NULL, NULL, 'GBP', 0,0, NULL, NULL,
   'Initial CV passed; clinical reference still outstanding.', NULL),
  (12, 4, 'Senior HCA',              'screening', NULL, NULL, NULL, NULL, 'GBP', 0,0, NULL, NULL,
   'Pitched 18 Jun — first interview scheduled for 24 Jun.', NULL),
  (14, 4, 'Mental Health Support',   'screening', NULL, NULL, NULL, NULL, 'GBP', 0,0, NULL, NULL,
   NULL, NULL),

-- Placed (active / ongoing) — two currently working with the client
  (2,  4, 'Site Manager',            'placed',
   '2026-04-10', NULL, 65000.00, 9750.00, 'GBP', 1, 0,
   '2026-05-10', '2027-04-10',
   '3-month rolling contract. Renewal expected after first review.', NULL),
  (9,  4, 'Electrical Supervisor',   'placed',
   '2026-03-18', NULL, 58000.00, 8700.00, 'GBP', 1, 1,
   '2026-04-18', '2026-09-18',
   'Long-running placement; commission paid in full ahead of schedule.', NULL),

-- Ended — three historical placements
  (1,  4, 'Quantity Surveyor',       'ended',
   '2025-09-01', '2026-02-28', 48000.00, 7200.00, 'GBP', 1, 1,
   '2025-10-01', '2026-03-01',
   'Successful 6-month engagement. Client gave full commission early.', NULL),
  (5,  4, 'H&S Lead',                'ended',
   '2025-06-15', '2025-12-15', 42000.00, 6300.00, 'GBP', 1, 1,
   NULL, '2026-01-15',
   'Standard 6-month placement, completed without issue.', NULL),
  (8,  4, 'Document Controller',     'ended',
   '2025-04-01', '2025-09-30', 28000.00, 4200.00, 'GBP', 1, 1,
   '2025-05-01', '2025-10-30',
   NULL, NULL),

-- Rejected — two candidates the client declined
  (15, 4, 'BIM Coordinator',         'rejected', NULL, NULL, NULL, NULL, 'GBP', 0,0, NULL, NULL,
   NULL, 'Client wanted on-site UK driving capability; candidate declined.'),
  (11, 4, 'Commercial Manager',      'rejected', NULL, NULL, NULL, NULL, 'GBP', 0,0, NULL, NULL,
   NULL, 'Rate too high for the budget the client signed off on.'),

-- ───────── sfsf (client 3) — a quieter relationship ───────────────────
  (4,  3, 'M&E Coordinator',         'screening', NULL, NULL, NULL, NULL, 'GBP', 0,0, NULL, NULL,
   'New pitch — awaiting first call.', NULL),
  (13, 3, 'Civil Engineer (Roads)',  'placed',
   '2026-05-12', NULL, 52000.00, 7800.00, 'GBP', 0, 0,
   '2026-06-12', '2026-11-12',
   'Active placement on the M62 widening package.', NULL),

-- ───────── john doe (client 2) — one rejection on record ──────────────
  (7,  2, 'Trainee Site Engineer',   'rejected', NULL, NULL, NULL, NULL, 'GBP', 0,0, NULL, NULL,
   NULL, 'Client looking for more on-site experience; candidate is graduate-level.');
