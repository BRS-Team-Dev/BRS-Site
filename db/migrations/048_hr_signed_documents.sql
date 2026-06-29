-- Migration 048: Signed-document templates.
--   • hr_document_types now distinguishes upload-only (employee provides a file)
--     from signed (HR uploads a template that every employee signs).
--   • signed-document templates live on the type; per-employee signatures still
--     land in hr_documents (signed_at / signed_by / signature_data already exist).

USE `builtrightstudio_cms`;

ALTER TABLE `hr_document_types`
    ADD COLUMN `kind`           ENUM('upload','signed') NOT NULL DEFAULT 'upload' AFTER `description`,
    ADD COLUMN `template_path`  VARCHAR(500) NULL AFTER `kind`,
    ADD COLUMN `template_mime`  VARCHAR(120) NULL AFTER `template_path`,
    ADD COLUMN `template_size`  INT UNSIGNED NULL AFTER `template_mime`;

-- Backfill: the existing "Signed employment contract" row was an upload type
-- in the old model. Leave it as 'upload' so existing data is unaffected;
-- HR can re-create it as a 'signed' type with a template if they want.
