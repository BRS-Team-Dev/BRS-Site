-- Migration 127: unified notification + section-scoped task hooks.
--
-- Three tables:
--
--   notification_events_catalog  — GLOBAL registry of every triggerable
--       event across the system (CRM / HR / Ops / Recruitment / Accounting
--       / Management / Tasks). Seeded below. Adding a new event = add a
--       row and a NotificationDispatcher::fire() call in the code path.
--
--   notification_rules  — per-tenant overrides of the catalog defaults.
--       When a tenant hasn't customised an event, the catalog defaults
--       are used. When they have, this row wins.
--
--   notifications  — the actual per-user inbox rows. Dispatcher writes
--       one row per resolved recipient. Users read via /api/notifications.
--
-- Every trigger point in the code calls
--   NotificationDispatcher::fire('crm.onboarding.submitted', [...ctx])
-- which reads catalog + rules, resolves recipients, and materialises rows.

CREATE TABLE IF NOT EXISTS `notification_events_catalog` (
  `id`                             INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `event_key`                      VARCHAR(80)  NOT NULL,
  `section`                        VARCHAR(40)  NOT NULL,
  `label`                          VARCHAR(160) NOT NULL,
  `description`                    TEXT NULL,
  `default_recipient_scope`        ENUM('user','team','role','tenant','none') NOT NULL DEFAULT 'role',
  `default_recipient_ref`          VARCHAR(80)  NULL COMMENT 'role slug, team slug, or specific id — depends on scope',
  `default_supervisor_role`        VARCHAR(40)  NOT NULL DEFAULT 'admin',
  `default_creates_task`           TINYINT(1)   NOT NULL DEFAULT 1,
  `default_escalate_after_minutes` INT UNSIGNED NULL,
  `default_escalate_to_role`       VARCHAR(40)  NULL,
  `is_active`                      TINYINT(1)   NOT NULL DEFAULT 1,
  UNIQUE KEY `uq_nec_key` (`event_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `notification_rules` (
  `id`                     INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `tenant_id`              INT UNSIGNED NOT NULL,
  `event_key`              VARCHAR(80)  NOT NULL,
  `enabled`                TINYINT(1)   NOT NULL DEFAULT 1,
  `recipient_scope`        ENUM('user','team','role','tenant','none') NOT NULL,
  `recipient_ref`          VARCHAR(80)  NULL,
  `supervisor_user_id`     INT UNSIGNED NULL,
  `supervisor_role`        VARCHAR(40)  NULL,
  `creates_task`           TINYINT(1)   NOT NULL DEFAULT 1,
  `escalate_after_minutes` INT UNSIGNED NULL,
  `escalate_to_user_id`    INT UNSIGNED NULL,
  `escalate_to_role`       VARCHAR(40)  NULL,
  `created_at`             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_nr_tenant_event` (`tenant_id`, `event_key`),
  CONSTRAINT `fk_nr_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `notifications` (
  `id`             INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `tenant_id`      INT UNSIGNED NOT NULL,
  `user_id`        INT UNSIGNED NOT NULL,
  `event_key`      VARCHAR(80)  NOT NULL,
  `section`        VARCHAR(40)  NOT NULL COMMENT 'copied from catalog for sub-tab filter',
  `title`          VARCHAR(255) NOT NULL,
  `body`           TEXT NULL,
  `link_url`       VARCHAR(500) NULL,
  `read_at`        DATETIME NULL,
  `escalated_at`   DATETIME NULL,
  `created_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_notif_user_unread` (`tenant_id`, `user_id`, `read_at`),
  KEY `idx_notif_section`     (`tenant_id`, `section`, `created_at`),
  CONSTRAINT `fk_notif_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Catalog seed: every triggerable event in the app, per section. ──
-- Update this list as new features land. Additions are non-breaking:
-- INSERT IGNORE lets the same seed run every time.

INSERT IGNORE INTO `notification_events_catalog`
  (event_key, section, label, description,
   default_recipient_scope, default_recipient_ref,
   default_supervisor_role, default_creates_task,
   default_escalate_after_minutes, default_escalate_to_role)
VALUES
-- ── CRM ────────────────────────────────────────────────────────
('crm.form.submitted',              'crm', 'Form submitted',                   'A public form was submitted.',
 'role', 'admin', 'admin', 1, 1440, 'super'),
('crm.onboarding.started',          'crm', 'Onboarding started',               'A client opened their onboarding portal.',
 'role', 'admin', 'admin', 0, NULL, NULL),
('crm.onboarding.submitted',        'crm', 'Onboarding submitted',             'A client submitted their onboarding form. Auto-creates a "New client" task.',
 'role', 'admin', 'admin', 1, 480, 'super'),
('crm.onboarding.qualified',        'crm', 'Onboarding qualified',             'A submission was manually qualified (or auto-qualified on submit).',
 'role', 'admin', 'admin', 0, NULL, NULL),
('crm.client.created',              'crm', 'Client created',                   'A new client was added — manually or auto from onboarding.',
 'role', 'admin', 'admin', 0, NULL, NULL),
('crm.client.promoted_from_lead',   'crm', 'Lead promoted to client',          'A lead was promoted to a client.',
 'role', 'admin', 'admin', 1, NULL, NULL),
('crm.client.relegated_to_lead',    'crm', 'Client relegated to lead',         'A client was demoted back to a lead.',
 'role', 'admin', 'admin', 0, NULL, NULL),
('crm.service.status_changed',      'crm', 'Client service status changed',    'A client-service link moved along the pipeline.',
 'role', 'admin', 'admin', 0, NULL, NULL),
('crm.feedback.response',           'crm', 'Feedback response received',       'A public feedback form submission arrived.',
 'role', 'admin', 'admin', 1, NULL, NULL),
('crm.newsletter.sent',             'crm', 'Newsletter campaign sent',         'A newsletter campaign finished sending.',
 'user', NULL, 'admin', 0, NULL, NULL),
('crm.newsletter.failed',           'crm', 'Newsletter send failed',           'A campaign failed mid-send.',
 'role', 'admin', 'super', 1, 60, 'super'),
('crm.task.assigned',               'crm', 'CRM task assigned',                'A crm_task was assigned to a user.',
 'user', NULL, 'admin', 0, NULL, NULL),
('crm.task.overdue',                'crm', 'CRM task overdue',                 'A crm_task passed its due_at.',
 'user', NULL, 'admin', 1, 1440, 'admin'),
-- ── HR ─────────────────────────────────────────────────────────
('hr.employee.added',               'hr', 'Employee added',                    'A new employee row was created.',
 'role', 'admin', 'admin', 1, NULL, NULL),
('hr.onboarding.completed',         'hr', 'HR onboarding completed',           'A new hire finished their onboarding portal.',
 'role', 'admin', 'admin', 1, NULL, NULL),
('hr.timeoff.requested',            'hr', 'Time-off requested',                'An employee requested time off.',
 'role', 'manager', 'manager', 1, 2880, 'admin'),
('hr.timeoff.decided',              'hr', 'Time-off decision',                 'A manager approved or rejected time-off.',
 'user', NULL, 'admin', 0, NULL, NULL),
('hr.payslip.generated',            'hr', 'Payslip generated',                 'A new payslip was generated for an employee.',
 'user', NULL, 'admin', 0, NULL, NULL),
('hr.review.due',                   'hr', 'Review due',                        'A performance review is due within 7 days.',
 'role', 'manager', 'admin', 1, 4320, 'admin'),
('hr.review.submitted',             'hr', 'Review submitted',                  'A performance review was submitted by the manager.',
 'user', NULL, 'admin', 0, NULL, NULL),
('hr.course.assigned',              'hr', 'Course assigned',                   'An HR course was assigned to an employee.',
 'user', NULL, 'admin', 0, NULL, NULL),
('hr.course.completed',             'hr', 'Course completed',                  'An employee completed a course.',
 'role', 'admin', 'admin', 0, NULL, NULL),
('hr.compliance.overdue',           'hr', 'Compliance task overdue',           'A compliance task blew past its deadline.',
 'role', 'admin', 'super', 1, 1440, 'super'),
('hr.certification.expiring',       'hr', 'Certification expiring',            'An employee certification expires within 30 days.',
 'role', 'admin', 'admin', 1, NULL, NULL),
('hr.change_request.submitted',     'hr', 'HR change request submitted',       'An employee submitted a change request (address, bank etc).',
 'role', 'admin', 'admin', 1, 1440, 'admin'),
-- ── Operations ─────────────────────────────────────────────────
('operations.tender.created',       'operations', 'Tender created',            'A new tender was added to the pipeline.',
 'role', 'admin', 'admin', 0, NULL, NULL),
('operations.tender.due_soon',      'operations', 'Tender due soon',           'A tender submission is due within 3 days.',
 'role', 'admin', 'admin', 1, 720, 'admin'),
('operations.contract.expiring',    'operations', 'Contract expiring',         'A contract expires within 30 days.',
 'role', 'admin', 'admin', 1, NULL, NULL),
('operations.partner.added',        'operations', 'Partner added',             'A new partner was added.',
 'role', 'admin', 'admin', 0, NULL, NULL),
('operations.document.expired',     'operations', 'Document expired',          'An uploaded document (contract, insurance, cert) expired.',
 'role', 'admin', 'admin', 1, 1440, 'super'),
-- ── Recruitment ────────────────────────────────────────────────
('recruitment.candidate.added',     'recruitment', 'Candidate added',          'A new candidate entered the pipeline.',
 'role', 'admin', 'admin', 0, NULL, NULL),
('recruitment.interview.scheduled', 'recruitment', 'Interview scheduled',      'An interview slot was booked.',
 'user', NULL, 'admin', 1, NULL, NULL),
('recruitment.candidate.placed',    'recruitment', 'Candidate placed',         'A candidate was placed with a client — commission trigger.',
 'role', 'admin', 'admin', 1, NULL, NULL),
('recruitment.commission.due',      'recruitment', 'Commission payment due',   'A placement commission is billable.',
 'role', 'admin', 'admin', 1, 4320, 'super'),
-- ── Accounting ─────────────────────────────────────────────────
('accounting.invoice.sent',         'accounting', 'Invoice sent',              'An invoice was emailed to the customer.',
 'role', 'admin', 'admin', 0, NULL, NULL),
('accounting.invoice.paid',         'accounting', 'Invoice paid',              'An invoice was marked paid.',
 'role', 'admin', 'admin', 0, NULL, NULL),
('accounting.invoice.overdue',      'accounting', 'Invoice overdue',           'An invoice is past its due date.',
 'role', 'admin', 'super', 1, 1440, 'super'),
('accounting.payroll.processed',    'accounting', 'Payroll processed',         'A pay period ran to completion.',
 'role', 'admin', 'admin', 0, NULL, NULL),
-- ── Management ─────────────────────────────────────────────────
('management.approval.requested',   'management', 'Approval requested',        'A subordinate requested a decision.',
 'user', NULL, 'admin', 1, 1440, 'admin'),
('management.approval.decided',     'management', 'Approval decision',         'An approval was granted or denied.',
 'user', NULL, 'admin', 0, NULL, NULL),
('management.team.member_added',    'management', 'Team member added',         'A user was added to a manager''s team.',
 'user', NULL, 'admin', 0, NULL, NULL),
-- ── Tasks (peer project system) ────────────────────────────────
('tasks.task.assigned',             'tasks', 'Project task assigned',          'A task_projects task was assigned.',
 'user', NULL, 'admin', 0, NULL, NULL),
('tasks.task.overdue',              'tasks', 'Project task overdue',           'A task_projects task blew its deadline.',
 'user', NULL, 'admin', 1, 1440, 'admin'),
('tasks.project.created',           'tasks', 'Project created',                'A new task_projects project was created.',
 'role', 'admin', 'admin', 0, NULL, NULL);
