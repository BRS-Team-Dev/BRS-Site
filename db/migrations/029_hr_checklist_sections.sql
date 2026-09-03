-- Migration 029: link onboarding tasks to portal sections so they auto-tick
-- when the matching section is submitted. Replace the default checklist with
-- section-aligned tasks.

USE `builtrightstudio_cms`;

ALTER TABLE `hr_onboarding_tasks`
    ADD COLUMN `linked_section` ENUM('profile','contact','emergency','payroll','background','references','documents','learning','diversity')
        NULL AFTER `category`;

ALTER TABLE `hr_default_onboarding_tasks`
    ADD COLUMN `linked_section` ENUM('profile','contact','emergency','payroll','background','references','documents','learning','diversity')
        NULL AFTER `category`;

-- Re-seed the default checklist to mirror every portal section + a few admin tasks.
DELETE FROM `hr_default_onboarding_tasks`;
INSERT INTO `hr_default_onboarding_tasks` (title, description, category, linked_section, sort_order) VALUES
  ('Complete your personal profile',          'Confirm name, DOB, nationality, and NI number.',                'profile', 'profile',    10),
  ('Confirm your contact and address',        'Phone, where you live, and current location if different.',     'profile', 'contact',    20),
  ('Add an emergency contact',                'Someone we can reach in an emergency.',                          'profile', 'emergency',  30),
  ('Submit payroll and banking details',      'Required for your salary to be paid on time.',                   'payroll', 'payroll',    40),
  ('Background check declaration',            'Standard Rehabilitation of Offenders Act 1974 declaration.',     'admin',   'background', 50),
  ('Add at least two references',             'We''ll only contact them after speaking with you.',              'admin',   'references', 60),
  ('Upload all required documents',           'ID, right-to-work, signed contract, P45 / starter, banking.',    'admin',   'documents',  70),
  ('Complete required learning',              'Any courses HR has assigned to you.',                            'admin',   'learning',   80),
  ('Optional: equality & inclusion info',     'Helps us improve the workplace — never used for hiring decisions.', 'admin', 'diversity',  90),
  ('Read the employee handbook',              'You''ll find it in the documents area or on the intranet.',      'admin',   NULL,        100),
  ('Set up your workstation and software',    'Laptop, accounts, dev environment.',                             'tech',    NULL,        110),
  ('Meet your direct manager',                'Schedule a kick-off 1:1 in your first week.',                    'people',  NULL,        120),
  ('Book a 1:1 with HR for first-week check-in', NULL,                                                          'people',  NULL,        130);
