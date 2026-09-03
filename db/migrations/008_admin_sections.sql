-- Migration 008: Independent admin sections.
-- A section is a standalone sidenav entry that's NOT tied to a form. It
-- persists across form deletes and can be used as a CMS pane in its own right
-- (e.g. a "Client" section that lives independently of any onboarding form).

USE `builtrightstudio_cms`;

CREATE TABLE IF NOT EXISTS `admin_sections` (
  `id`                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `slug`               VARCHAR(80) NOT NULL UNIQUE,
  `title`              VARCHAR(190) NOT NULL,
  `description`        TEXT NULL,
  `sidenav_placement`  ENUM('top','child') NOT NULL DEFAULT 'top',
  `sidenav_parent_key` VARCHAR(40) NULL,
  `sort_order`         INT NOT NULL DEFAULT 0,
  `created_at`         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
