-- Migration 042: pulse surveys can be filled out externally via a tokenised
-- public link. Backfills tokens for existing surveys.

USE `builtrightstudio_cms`;

ALTER TABLE `hr_pulse_surveys`
    ADD COLUMN `public_token`     CHAR(32) NULL AFTER `closes_at`,
    ADD COLUMN `allow_external`   TINYINT(1) NOT NULL DEFAULT 0 AFTER `public_token`,
    ADD UNIQUE KEY `uniq_pulse_token` (`public_token`);

UPDATE `hr_pulse_surveys`
SET `public_token` = SUBSTRING(SHA2(CONCAT(id, UUID(), RAND()), 256), 1, 32)
WHERE `public_token` IS NULL;
