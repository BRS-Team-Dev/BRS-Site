-- Migration 119: feedback / survey / poll system.
--
-- Four tables for a CRM-level feedback module:
--
--   feedback_forms      A questionnaire / feedback form / survey /
--                       poll. Carries the public share token, the
--                       form metadata, and optional links to a
--                       client / lead / service.
--   feedback_questions  Ordered questions belonging to a form. Type
--                       drives the rendered widget (text, rating,
--                       single/multi-choice, yes/no, long_text).
--   feedback_responses  One row per submission. May reference a
--                       client or lead when the form was opened from
--                       a linked URL (?client=N / ?lead=N).
--   feedback_answers    Per-question answer rows tied to a response.
--                       Value is text — booleans and numbers store
--                       their string repr; multi-choice stores a
--                       JSON array. Keeps the table generic.
--
-- All four cascade on parent delete to keep cleanup atomic. Tenant
-- FK on each so Db::tpdo()'s rewriter scopes automatically.

CREATE TABLE IF NOT EXISTS `feedback_forms` (
  `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `tenant_id`    INT UNSIGNED NOT NULL,
  `kind`         ENUM('questionnaire','form','survey','poll') NOT NULL DEFAULT 'form',
  `title`        VARCHAR(255) NOT NULL,
  `description`  TEXT NULL,
  `intro_html`   TEXT NULL,
  `submit_label` VARCHAR(60) NOT NULL DEFAULT 'Submit',
  `thank_you_message` TEXT NULL,
  `public_token` CHAR(40) NOT NULL,
  `is_published` TINYINT(1) NOT NULL DEFAULT 0,
  -- Optional link to ONE of: a client, a lead, or a service. The UI
  -- enforces "at most one"; the DB allows any combination so we don't
  -- have to migrate when the rules change.
  `client_id`             INT UNSIGNED NULL,
  `lead_id`               INT UNSIGNED NULL,
  `service_offering_id`   INT UNSIGNED NULL,
  `created_by_user_id`    INT UNSIGNED NULL,
  `created_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_feedback_token` (`public_token`),
  KEY `idx_feedback_forms_tenant`   (`tenant_id`),
  KEY `idx_feedback_forms_client`   (`client_id`),
  KEY `idx_feedback_forms_lead`     (`lead_id`),
  KEY `idx_feedback_forms_service`  (`service_offering_id`),
  CONSTRAINT `fk_feedback_forms_tenant`  FOREIGN KEY (`tenant_id`)  REFERENCES `tenants`(`id`),
  CONSTRAINT `fk_feedback_forms_client`  FOREIGN KEY (`client_id`)  REFERENCES `clients`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_feedback_forms_lead`    FOREIGN KEY (`lead_id`)    REFERENCES `leads`(`id`)   ON DELETE SET NULL,
  CONSTRAINT `fk_feedback_forms_service` FOREIGN KEY (`service_offering_id`) REFERENCES `service_offerings`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_feedback_forms_creator` FOREIGN KEY (`created_by_user_id`) REFERENCES `admin_users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `feedback_questions` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `tenant_id`  INT UNSIGNED NOT NULL,
  `form_id`    INT UNSIGNED NOT NULL,
  `type`       ENUM('short_text','long_text','rating','yes_no','single_choice','multi_choice') NOT NULL DEFAULT 'short_text',
  `label`      VARCHAR(500) NOT NULL,
  `help_text`  VARCHAR(500) NULL,
  `options_json` TEXT NULL, -- for single_choice / multi_choice
  `is_required` TINYINT(1) NOT NULL DEFAULT 0,
  `sort_order` INT NOT NULL DEFAULT 0,
  KEY `idx_feedback_questions_tenant` (`tenant_id`),
  KEY `idx_feedback_questions_form`   (`form_id`),
  CONSTRAINT `fk_feedback_questions_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`),
  CONSTRAINT `fk_feedback_questions_form`   FOREIGN KEY (`form_id`)   REFERENCES `feedback_forms`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `feedback_responses` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `tenant_id`  INT UNSIGNED NOT NULL,
  `form_id`    INT UNSIGNED NOT NULL,
  `client_id`  INT UNSIGNED NULL,
  `lead_id`    INT UNSIGNED NULL,
  `submitted_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ip_address` VARCHAR(45) NULL,
  KEY `idx_feedback_responses_tenant` (`tenant_id`),
  KEY `idx_feedback_responses_form`   (`form_id`),
  KEY `idx_feedback_responses_client` (`client_id`),
  KEY `idx_feedback_responses_lead`   (`lead_id`),
  CONSTRAINT `fk_feedback_responses_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`),
  CONSTRAINT `fk_feedback_responses_form`   FOREIGN KEY (`form_id`)   REFERENCES `feedback_forms`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_feedback_responses_client` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_feedback_responses_lead`   FOREIGN KEY (`lead_id`)   REFERENCES `leads`(`id`)   ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `feedback_answers` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `tenant_id`   INT UNSIGNED NOT NULL,
  `response_id` INT UNSIGNED NOT NULL,
  `question_id` INT UNSIGNED NOT NULL,
  `value`       TEXT NULL,
  KEY `idx_feedback_answers_tenant`  (`tenant_id`),
  KEY `idx_feedback_answers_resp`    (`response_id`),
  KEY `idx_feedback_answers_question`(`question_id`),
  CONSTRAINT `fk_feedback_answers_tenant`   FOREIGN KEY (`tenant_id`)   REFERENCES `tenants`(`id`),
  CONSTRAINT `fk_feedback_answers_resp`     FOREIGN KEY (`response_id`) REFERENCES `feedback_responses`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_feedback_answers_question` FOREIGN KEY (`question_id`) REFERENCES `feedback_questions`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
