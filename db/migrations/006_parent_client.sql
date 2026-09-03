-- Migration 006: Link onboarding clients to a parent-process client.

USE `builtrightstudio_cms`;

ALTER TABLE `onboarding_clients`
  ADD COLUMN `parent_client_id` INT UNSIGNED NULL AFTER `form_id`,
  ADD CONSTRAINT `fk_client_parent_client`
    FOREIGN KEY (`parent_client_id`) REFERENCES `onboarding_clients`(`id`) ON DELETE SET NULL;
