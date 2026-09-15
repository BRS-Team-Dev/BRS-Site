-- Migration 084: Per-candidate-per-client placements + status cleanup.
--
-- The candidate enum used to carry `rejected_by_client` alongside
-- `rejected_by_us`. With the new Placements feature, rejection is
-- per-client (one candidate can be screening with A while rejected by
-- B), so the candidate-level enum drops that value. Any existing
-- rows get remapped to `rejected_by_us` for the column constraint;
-- HR can re-classify by adding placement rows after the fact.
--
-- `recruitment_placements` is the join table:
--   - status drives both tabs on the candidate detail page:
--     * Placements tab → status IN ('screening','placed','ended')
--     * Rejected   tab → status = 'rejected'
--   - commission tracking is split into part / full so partial payment
--     reads cleanly: paid_part flips first, then paid_full once the
--     final cut clears.

USE `builtrightstudio_cms`;

-- 1. Status cleanup — round-trip via VARCHAR same as 082 because MySQL
--    refuses to UPDATE a row to a value not in the current ENUM and
--    refuses to ALTER an ENUM while non-fitting values exist.
ALTER TABLE `recruitment_candidates`
  MODIFY COLUMN `status` VARCHAR(40) NOT NULL DEFAULT 'new';

UPDATE `recruitment_candidates`
  SET `status` = 'rejected_by_us'
  WHERE `status` = 'rejected_by_client';

ALTER TABLE `recruitment_candidates`
  MODIFY COLUMN `status` ENUM(
    'new',
    'interviewing',
    'processing',
    'compliant',
    'client_screening',
    'placed',
    'rejected_by_us'
  ) NOT NULL DEFAULT 'new';

-- 2. Placements table.
CREATE TABLE IF NOT EXISTS `recruitment_placements` (
  `id`                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `candidate_id`         INT UNSIGNED NOT NULL,
  `client_id`            INT UNSIGNED NOT NULL,
  `role`                 VARCHAR(150) NULL,
  `status`               ENUM('screening','placed','ended','rejected') NOT NULL DEFAULT 'screening',
  `start_date`           DATE NULL,
  `end_date`             DATE NULL,
  `contract_value`       DECIMAL(12,2) NULL,
  `commission_value`     DECIMAL(12,2) NULL,
  `currency`             CHAR(3) NOT NULL DEFAULT 'GBP',
  `commission_paid_part` TINYINT(1) NOT NULL DEFAULT 0,
  `commission_paid_full` TINYINT(1) NOT NULL DEFAULT 0,
  `commission_due_part`  DATE NULL,
  `commission_due_full`  DATE NULL,
  `contract_notes`       TEXT NULL,
  `rejection_reason`     TEXT NULL,
  `created_at`           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `idx_candidate` (`candidate_id`),
  KEY `idx_client`    (`client_id`),
  KEY `idx_status`    (`status`),
  CONSTRAINT `fk_plc_candidate` FOREIGN KEY (`candidate_id`) REFERENCES `recruitment_candidates`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_plc_client`    FOREIGN KEY (`client_id`)    REFERENCES `clients`(`id`)              ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
