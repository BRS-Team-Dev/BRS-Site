-- Migration 013: Taskboard foundation
--   • Areas → Projects → Iterations → Work items
--   • Configurable types and states (seeded)
--   • Tags, comments, history, attachments, links, capacity
--   • Extends admin_users with role + is_active for assignment / multi-user

USE `builtrightstudio_cms`;

-- ---------- admin_users extensions ----------
ALTER TABLE `admin_users`
  ADD COLUMN `role`      ENUM('admin','member','viewer') NOT NULL DEFAULT 'admin' AFTER `display_name`,
  ADD COLUMN `is_active` TINYINT(1) NOT NULL DEFAULT 1;

-- ---------- Areas (CRM, CMS, HR, Marketing…) ----------
CREATE TABLE IF NOT EXISTS `task_areas` (
  `id`          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `slug`        VARCHAR(60)  NOT NULL UNIQUE,
  `name`        VARCHAR(120) NOT NULL,
  `description` TEXT NULL,
  `icon`        VARCHAR(40) NULL,
  `color`       VARCHAR(20) NULL,
  `sort_order`  INT NOT NULL DEFAULT 0,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- Projects (within an area, optionally linked to a CRM client) ----------
CREATE TABLE IF NOT EXISTS `task_projects` (
  `id`          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `area_id`     INT UNSIGNED NOT NULL,
  `slug`        VARCHAR(80)  NOT NULL,
  `name`        VARCHAR(190) NOT NULL,
  `description` TEXT NULL,
  `client_id`   INT UNSIGNED NULL,
  `sort_order`  INT NOT NULL DEFAULT 0,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uniq_area_slug` (`area_id`, `slug`),
  CONSTRAINT `fk_project_area`   FOREIGN KEY (`area_id`)   REFERENCES `task_areas`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_project_client` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`)    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- Iterations / Sprints ----------
CREATE TABLE IF NOT EXISTS `task_iterations` (
  `id`         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `project_id` INT UNSIGNED NOT NULL,
  `name`       VARCHAR(120) NOT NULL,
  `start_date` DATE NULL,
  `end_date`   DATE NULL,
  `goal`       TEXT NULL,
  `state`      ENUM('planning','active','closed') NOT NULL DEFAULT 'planning',
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_iteration_project` FOREIGN KEY (`project_id`) REFERENCES `task_projects`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- Configurable item types ----------
CREATE TABLE IF NOT EXISTS `task_item_types` (
  `id`         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `slug`       VARCHAR(40) NOT NULL UNIQUE,
  `name`       VARCHAR(80) NOT NULL,
  `color`      VARCHAR(20) NULL,
  `icon`       VARCHAR(40) NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `is_default` TINYINT(1) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- Configurable item states ----------
CREATE TABLE IF NOT EXISTS `task_item_states` (
  `id`             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `slug`           VARCHAR(40) NOT NULL UNIQUE,
  `name`           VARCHAR(80) NOT NULL,
  `color`          VARCHAR(20) NULL,
  `sort_order`     INT NOT NULL DEFAULT 0,
  `is_terminal`    TINYINT(1) NOT NULL DEFAULT 0,
  `is_default_new` TINYINT(1) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- Tags (per-project) ----------
CREATE TABLE IF NOT EXISTS `task_tags` (
  `id`         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `project_id` INT UNSIGNED NOT NULL,
  `name`       VARCHAR(60) NOT NULL,
  `color`      VARCHAR(20) NULL,
  UNIQUE KEY `uniq_project_tag` (`project_id`, `name`),
  CONSTRAINT `fk_tag_project` FOREIGN KEY (`project_id`) REFERENCES `task_projects`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- Work items ----------
CREATE TABLE IF NOT EXISTS `task_items` (
  `id`                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `project_id`          INT UNSIGNED NOT NULL,
  `parent_id`           INT UNSIGNED NULL,
  `type_id`             INT UNSIGNED NOT NULL,
  `state_id`            INT UNSIGNED NOT NULL,
  `iteration_id`        INT UNSIGNED NULL,
  `assigned_to`         INT UNSIGNED NULL,
  `title`               VARCHAR(255) NOT NULL,
  `description`         MEDIUMTEXT NULL,
  `acceptance_criteria` MEDIUMTEXT NULL,
  `priority`            TINYINT NOT NULL DEFAULT 2,
  `effort_mode`         ENUM('points','days') NULL,
  `story_points`        DECIMAL(6,2) NULL,
  `effort_days`         DECIMAL(6,2) NULL,
  `remaining_days`      DECIMAL(6,2) NULL,
  `completed_days`      DECIMAL(6,2) NULL,
  `board_column`        VARCHAR(40) NOT NULL DEFAULT 'todo',
  `sort_order`          INT NOT NULL DEFAULT 0,
  `created_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `closed_at`           DATETIME NULL,
  CONSTRAINT `fk_item_project`   FOREIGN KEY (`project_id`)   REFERENCES `task_projects`(`id`)    ON DELETE CASCADE,
  CONSTRAINT `fk_item_parent`    FOREIGN KEY (`parent_id`)    REFERENCES `task_items`(`id`)      ON DELETE SET NULL,
  CONSTRAINT `fk_item_type`      FOREIGN KEY (`type_id`)      REFERENCES `task_item_types`(`id`),
  CONSTRAINT `fk_item_state`     FOREIGN KEY (`state_id`)     REFERENCES `task_item_states`(`id`),
  CONSTRAINT `fk_item_iteration` FOREIGN KEY (`iteration_id`) REFERENCES `task_iterations`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_item_assignee`  FOREIGN KEY (`assigned_to`)  REFERENCES `admin_users`(`id`)     ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- Item-tag join ----------
CREATE TABLE IF NOT EXISTS `task_item_tags` (
  `item_id` INT UNSIGNED NOT NULL,
  `tag_id`  INT UNSIGNED NOT NULL,
  PRIMARY KEY (`item_id`, `tag_id`),
  CONSTRAINT `fk_itemtag_item` FOREIGN KEY (`item_id`) REFERENCES `task_items`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_itemtag_tag`  FOREIGN KEY (`tag_id`)  REFERENCES `task_tags`(`id`)  ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- Comments ----------
CREATE TABLE IF NOT EXISTS `task_item_comments` (
  `id`         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `item_id`    INT UNSIGNED NOT NULL,
  `author_id`  INT UNSIGNED NULL,
  `body`       MEDIUMTEXT NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_comment_item`   FOREIGN KEY (`item_id`)   REFERENCES `task_items`(`id`)  ON DELETE CASCADE,
  CONSTRAINT `fk_comment_author` FOREIGN KEY (`author_id`) REFERENCES `admin_users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- History (field-level audit) ----------
CREATE TABLE IF NOT EXISTS `task_item_history` (
  `id`         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `item_id`    INT UNSIGNED NOT NULL,
  `author_id`  INT UNSIGNED NULL,
  `field`      VARCHAR(60) NOT NULL,
  `old_value`  TEXT NULL,
  `new_value`  TEXT NULL,
  `changed_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_history_item`   FOREIGN KEY (`item_id`)   REFERENCES `task_items`(`id`)  ON DELETE CASCADE,
  CONSTRAINT `fk_history_author` FOREIGN KEY (`author_id`) REFERENCES `admin_users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- Attachments ----------
CREATE TABLE IF NOT EXISTS `task_item_attachments` (
  `id`            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `item_id`       INT UNSIGNED NOT NULL,
  `file_path`     VARCHAR(500) NOT NULL,
  `original_name` VARCHAR(255) NULL,
  `uploaded_by`   INT UNSIGNED NULL,
  `uploaded_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_attach_item` FOREIGN KEY (`item_id`)     REFERENCES `task_items`(`id`)  ON DELETE CASCADE,
  CONSTRAINT `fk_attach_user` FOREIGN KEY (`uploaded_by`) REFERENCES `admin_users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- Item-to-item links ----------
CREATE TABLE IF NOT EXISTS `task_item_links` (
  `id`         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `source_id`  INT UNSIGNED NOT NULL,
  `target_id`  INT UNSIGNED NOT NULL,
  `link_type`  ENUM('related','predecessor','successor','duplicate') NOT NULL DEFAULT 'related',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uniq_link` (`source_id`, `target_id`, `link_type`),
  CONSTRAINT `fk_link_source` FOREIGN KEY (`source_id`) REFERENCES `task_items`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_link_target` FOREIGN KEY (`target_id`) REFERENCES `task_items`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- Sprint capacity ----------
CREATE TABLE IF NOT EXISTS `task_sprint_capacity` (
  `id`                     INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `iteration_id`           INT UNSIGNED NOT NULL,
  `user_id`                INT UNSIGNED NOT NULL,
  `capacity_hours_per_day` DECIMAL(4,1) NOT NULL DEFAULT 8.0,
  `days_off`               INT NOT NULL DEFAULT 0,
  UNIQUE KEY `uniq_capacity` (`iteration_id`, `user_id`),
  CONSTRAINT `fk_capacity_iteration` FOREIGN KEY (`iteration_id`) REFERENCES `task_iterations`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_capacity_user`      FOREIGN KEY (`user_id`)      REFERENCES `admin_users`(`id`)    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- Seed default item types ----------
INSERT IGNORE INTO `task_item_types` (`slug`, `name`, `color`, `icon`, `sort_order`, `is_default`) VALUES
  ('story',    'Story',    '#3b82f6', 'S', 1, 1),
  ('task',     'Task',     '#f59e0b', 'T', 2, 0),
  ('bug',      'Bug',      '#ef4444', 'B', 3, 0),
  ('reminder', 'Reminder', '#f97316', 'R', 4, 0),
  ('test',     'Test',     '#8b5cf6', 'X', 5, 0),
  ('deploy',   'Deploy',   '#10b981', 'D', 6, 0);

-- ---------- Seed default item states ----------
INSERT IGNORE INTO `task_item_states` (`slug`, `name`, `color`, `sort_order`, `is_terminal`, `is_default_new`) VALUES
  ('new',      'New',      '#9ca3af', 1, 0, 1),
  ('active',   'Active',   '#3b82f6', 2, 0, 0),
  ('resolved', 'Resolved', '#10b981', 3, 0, 0),
  ('closed',   'Closed',   '#6b7280', 4, 1, 0);

-- ---------- Seed default areas ----------
INSERT IGNORE INTO `task_areas` (`slug`, `name`, `color`, `sort_order`) VALUES
  ('crm',       'CRM',       '#d4a93a', 1),
  ('cms',       'CMS',       '#3b82f6', 2),
  ('hr',        'HR',        '#10b981', 3),
  ('marketing', 'Marketing', '#ef4444', 4);
