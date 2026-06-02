-- Migration 002: Add new field types (color, style_cards, multi_file).

USE `builtrightstudio_cms`;

ALTER TABLE `form_fields`
  MODIFY COLUMN `type` ENUM(
    'text','email','tel','url','number','password',
    'textarea','select','radio','checkbox',
    'date','datetime','file',
    'color','style_cards','multi_file'
  ) NOT NULL;
