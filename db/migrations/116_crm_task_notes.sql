-- Migration 116: notes thread on CRM tasks.
--
-- Append-only thread of notes attached to a `crm_tasks` row (115).
-- Each note records WHO posted it and WHEN — the task-edit modal
-- shows the running thread under the form fields so admins can leave
-- context as they triage.
--
-- Cascades on task delete (a task gone is also its conversation
-- gone). user_id SET NULL on admin_user delete so we don't lose the
-- note when an admin offboards — the author shows as "(deleted user)"
-- in the UI instead.

CREATE TABLE IF NOT EXISTS `crm_task_notes` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `tenant_id`  INT UNSIGNED NOT NULL,
  `task_id`    INT UNSIGNED NOT NULL,
  `user_id`    INT UNSIGNED NULL,
  `body`       TEXT         NOT NULL,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_crm_task_notes_tenant` (`tenant_id`),
  KEY `idx_crm_task_notes_task`   (`task_id`),
  KEY `idx_crm_task_notes_user`   (`user_id`),
  CONSTRAINT `fk_crm_task_notes_tenant`
    FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`),
  CONSTRAINT `fk_crm_task_notes_task`
    FOREIGN KEY (`task_id`) REFERENCES `crm_tasks`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_crm_task_notes_user`
    FOREIGN KEY (`user_id`) REFERENCES `admin_users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
