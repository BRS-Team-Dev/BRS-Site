-- 157_assignments.sql
--
-- Unified assignments table: assign a person (employee, contractor, or
-- partner) to a client or lead in a specific work-area role. Reassignment
-- is append-only — stamp ended_at on the previous active row and insert a
-- new one — so history + audit trail fall out of the schema for free.
--
-- Roles:
--   onboarding     — account manager for the onboarding phase
--   services       — account manager for delivery of services
--   service_tasks  — dev(s) doing the work; MULTIPLE concurrent allowed
--   account_tasks  — account manager for general/ad-hoc updates
-- All roles except service_tasks enforce one-active-at-a-time in the API
-- (auto-end the previous row on POST); service_tasks lets a client have
-- several devs at once.

CREATE TABLE `assignments` (
  `id`                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`            INT UNSIGNED NOT NULL,
  `entity_type`          ENUM('client','lead') NOT NULL,
  `entity_id`            INT UNSIGNED NOT NULL,
  `role`                 ENUM('onboarding','services','service_tasks','account_tasks') NOT NULL,
  `assignee_type`        ENUM('employee','contractor','partner') NOT NULL,
  `assignee_id`          INT UNSIGNED NOT NULL,
  `assigned_by_user_id`  INT UNSIGNED NULL,
  `assigned_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ended_by_user_id`     INT UNSIGNED NULL,
  `ended_at`             DATETIME NULL,
  `notes`                TEXT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_entity`  (`tenant_id`, `entity_type`, `entity_id`, `role`),
  KEY `idx_active`  (`tenant_id`, `entity_type`, `entity_id`, `role`, `ended_at`),
  KEY `idx_assignee` (`tenant_id`, `assignee_type`, `assignee_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
