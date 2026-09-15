-- Migration 081: Recruitment skills catalogue.
--
-- Skills can exist standalone OR be auto-managed from a recruitment
-- doc-type: ticking the "Add as skill" checkbox on a doc-type creates a
-- linked skill row (name mirrors the doc-type name); unticking deletes
-- it. Deleting the skill from /recruitment/settings → Skills tab also
-- unticks the doc-type checkbox (no separate flag column — the link's
-- existence IS the flag).
--
-- `doc_type_id` is nullable so standalone skills work without a link.
-- The unique index on `name` keeps the list dedup'd; the FK is
-- ON DELETE SET NULL so deleting a doc-type leaves its linked skill
-- standalone rather than vanishing too.

USE `builtrightstudio_cms`;

CREATE TABLE IF NOT EXISTS `recruitment_skills` (
  `id`           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `name`         VARCHAR(120) NOT NULL,
  `doc_type_id`  INT UNSIGNED NULL,
  `sort_order`   INT NOT NULL DEFAULT 0,
  `created_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uniq_name` (`name`),
  KEY `idx_doc_type` (`doc_type_id`),
  CONSTRAINT `fk_skill_doctype` FOREIGN KEY (`doc_type_id`)
    REFERENCES `recruitment_doc_types`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Default healthcare skill set seeded for the agency. Standalone — no
-- doc-type links yet; the user wires them up in Settings.
INSERT INTO `recruitment_skills` (name, sort_order) VALUES
  ('Autism',                10),
  ('Behavioural Support',   20),
  ('Blood Glucose Level',   30),
  ('BLS',                   40),
  ('Bowel Management',      50),
  ('Catheter Care',         60),
  ('Cough Assist',          70),
  ('Epilepsy Management',   80),
  ('Live-In',               90),
  ('Medication Admin',     100),
  ('Paediatrics',          110),
  ('PEG Feeding',          120),
  ('Spinal Injury',        130),
  ('Suctioning',           140),
  ('Tracheostomy Care',    150),
  ('Ventilation',          160);
