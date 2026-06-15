-- Migration 071: Operations manual tasks.
--
-- The Tenders Taskboard merges two sources:
--   1. Auto-derived "tasks" from the tender tracker (overdue / due-soon /
--      incomplete / awaiting decision / stale) — no storage, computed on
--      the fly from the `tenders` + `tender_document_sections` tables.
--   2. Manual tasks added by an operator — this table. Free-text category,
--      optional tender link (cascades to NULL so detached tasks aren't
--      lost when a tender is deleted).
--
-- Status flow: to_do → in_progress → done. `completed_at` is set when the
-- row transitions to 'done' and cleared when it leaves 'done'.

CREATE TABLE IF NOT EXISTS `operation_tasks` (
  `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `title`        VARCHAR(255) NOT NULL,
  `description`  TEXT NULL,
  `category`     VARCHAR(60)  NULL,
  `status`       ENUM('to_do','in_progress','done') NOT NULL DEFAULT 'to_do',
  `priority`     ENUM('low','medium','high')        NOT NULL DEFAULT 'medium',
  `due_date`     DATETIME NULL,
  `tender_id`    INT UNSIGNED NULL,
  `completed_at` DATETIME NULL,
  `created_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_status_due` (`status`, `due_date`),
  KEY `idx_tender` (`tender_id`),
  CONSTRAINT `fk_op_task_tender`
    FOREIGN KEY (`tender_id`) REFERENCES `tenders`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
