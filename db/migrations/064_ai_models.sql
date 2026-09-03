-- Migration 064: User-extensible AI model registry.
--
-- The Lead Gen feature ships with a hard-coded list of known models in
-- BRS\AI::MODELS / frontend ai-models.ts. This table lets users add
-- additional models without a code change — typically when a new model
-- ships from an existing provider (e.g. claude-sonnet-4-7) or when
-- pointing at an OpenAI-compatible custom endpoint (Ollama, vLLM,
-- Together, Groq, etc.).
--
-- model_id      — exact ID sent to the provider's API
-- label         — display name for the dropdown
-- provider      — one of the seven known providers OR 'openai_compatible'
-- supports_search — whether to enable the provider's web-search tool
-- custom_endpoint — overrides the default endpoint when set; required
--                   for provider='openai_compatible', optional otherwise
--
-- Built-ins are NOT stored here — they live in code as the safe default.

CREATE TABLE IF NOT EXISTS `ai_models` (
  `id`              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `model_id`        VARCHAR(120) NOT NULL,
  `label`           VARCHAR(160) NOT NULL,
  `provider`        VARCHAR(40)  NOT NULL,
  `supports_search` TINYINT(1)   NOT NULL DEFAULT 0,
  `custom_endpoint` VARCHAR(500) NULL,
  `created_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_model_id` (`model_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
