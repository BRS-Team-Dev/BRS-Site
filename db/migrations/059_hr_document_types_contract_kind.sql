-- Migration 059: Contract document type.
-- Adds a third value to hr_document_types.kind so HR can manage employment
-- contracts as their own bucket (in addition to upload + signed).
--
-- Behaviour mirrors the existing 'signed' kind end-to-end:
--   • HR builds / uploads a template per contract
--   • Each active employee gets a pending hr_documents row pointing at it
--   • Employees sign through the same /sign/:did flow
-- The split is purely so HR can keep contracts visually + organisationally
-- separate from generic signed policies (code of conduct etc.).

USE `builtrightstudio_cms`;

ALTER TABLE `hr_document_types`
    MODIFY COLUMN `kind` ENUM('upload','signed','contract') NOT NULL DEFAULT 'upload';
