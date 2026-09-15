-- Migration 021: Compliance task tracker.
-- We don't auto-update to live legislation; this is a scheduled-obligations tracker.

USE `builtrightstudio_cms`;

CREATE TABLE IF NOT EXISTS `hr_compliance_tasks` (
    `id`            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `title`         VARCHAR(190) NOT NULL,
    `description`   TEXT NULL,
    `jurisdiction`  VARCHAR(40)  NOT NULL DEFAULT 'UK',
    `frequency`     ENUM('one_off','monthly','quarterly','annual','custom') NOT NULL DEFAULT 'annual',
    `last_done_at`  DATE NULL,
    `next_due_at`   DATE NOT NULL,
    `owner_id`      INT UNSIGNED NULL,
    `status`        ENUM('upcoming','due','overdue','done','archived') NOT NULL DEFAULT 'upcoming',
    `notes`         TEXT NULL,
    `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT `fk_comp_owner` FOREIGN KEY (`owner_id`) REFERENCES `admin_users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `hr_compliance_tasks` (title, description, jurisdiction, frequency, next_due_at) VALUES
  ('HMRC RTI submission',           'Send Real Time Information to HMRC each pay period.',           'UK', 'monthly', LAST_DAY(CURDATE())),
  ('P60 issuance to all employees', 'Issue P60 forms by 31 May each year.',                          'UK', 'annual',  CONCAT(YEAR(CURDATE()), '-05-31')),
  ('P11D filing',                   'File P11D for benefits in kind by 6 July each year.',           'UK', 'annual',  CONCAT(YEAR(CURDATE()), '-07-06')),
  ('Pension auto-enrolment review', 'Re-enrolment cycle for eligible workers.',                      'UK', 'annual',  CONCAT(YEAR(CURDATE()), '-12-31')),
  ('Right-to-work check audit',     'Audit RTW documentation for all hires in the past year.',       'UK', 'annual',  CONCAT(YEAR(CURDATE()), '-12-31')),
  ('Gender pay gap report',         'Required for orgs with 250+ employees by 4 April.',             'UK', 'annual',  CONCAT(YEAR(CURDATE()), '-04-04'));
