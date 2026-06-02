-- Migration 010: Client contacts (with multiple phone numbers per contact).

USE `builtrightstudio_cms`;

CREATE TABLE IF NOT EXISTS `client_contacts` (
  `id`         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `client_id`  INT UNSIGNED NOT NULL,
  `first_name` VARCHAR(120) NOT NULL,
  `last_name`  VARCHAR(120) NULL,
  `position`   VARCHAR(190) NULL,
  `email`      VARCHAR(190) NULL,
  `verified`   TINYINT(1) NOT NULL DEFAULT 0,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_contact_client`
    FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `client_contact_numbers` (
  `id`         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `contact_id` INT UNSIGNED NOT NULL,
  `number`     VARCHAR(80) NOT NULL,
  `label`      VARCHAR(60) NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  CONSTRAINT `fk_number_contact`
    FOREIGN KEY (`contact_id`) REFERENCES `client_contacts`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
