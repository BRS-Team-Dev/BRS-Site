-- Migration 049: Store the structured page/block JSON used to author signed-document
-- templates in-app. The rendered PDF still lives on hr_document_types.template_path
-- (so the existing distribute/sign flow is unchanged); blocks_json is the editable source.

USE `builtrightstudio_cms`;

ALTER TABLE `hr_document_types`
    ADD COLUMN `template_blocks_json` LONGTEXT NULL AFTER `template_size`;
