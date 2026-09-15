-- Migration 115: lightweight CRM-level task board.
--
-- A simple to-do table for ad-hoc CRM tasks — "call this lead",
-- "draft a service proposal", "follow up on onboarding submission".
-- Distinct from the existing `operations_tasks` (operations-area
-- to-dos tied to tenders/etc.) and from `task_items` (delivery work
-- tracked under task_projects). Lives at the CRM level so a CRM
-- admin doesn't need to switch systems to triage their own backlog.
--
-- Status flow: to_do → in_progress → done. `completed_at` is set when
-- status transitions into 'done' and cleared when it moves back out,
-- so the dashboard's "Done" KPI can rely on that column without
-- recomputing from the audit history.
--
-- Priority is the standard 4-level scale used elsewhere in the
-- product (low / medium / high / urgent). Due date is optional —
-- not every task has a deadline.

CREATE TABLE IF NOT EXISTS `crm_tasks` (
  `id`               INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `tenant_id`        INT UNSIGNED NOT NULL,
  `title`            VARCHAR(255) NOT NULL,
  `description`      TEXT NULL,
  `category`         ENUM('lead','client','service','form','onboarding','other')
                       NOT NULL DEFAULT 'other',
  `assignee_user_id` INT UNSIGNED NULL,
  `priority`         ENUM('low','medium','high','urgent') NOT NULL DEFAULT 'medium',
  `status`           ENUM('to_do','in_progress','done') NOT NULL DEFAULT 'to_do',
  `due_at`           DATETIME NULL,
  `completed_at`     DATETIME NULL,
  `created_by_user_id` INT UNSIGNED NULL,
  `created_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `idx_crm_tasks_tenant`   (`tenant_id`),
  KEY `idx_crm_tasks_status`   (`status`),
  KEY `idx_crm_tasks_assignee` (`assignee_user_id`),
  KEY `idx_crm_tasks_due_at`   (`due_at`),
  CONSTRAINT `fk_crm_tasks_tenant`
    FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`),
  CONSTRAINT `fk_crm_tasks_assignee`
    FOREIGN KEY (`assignee_user_id`) REFERENCES `admin_users`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_crm_tasks_creator`
    FOREIGN KEY (`created_by_user_id`) REFERENCES `admin_users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
