/**
 * Frontend mirror of the AI model registry. Keep in sync with
 * `api/lib/AI.php` constant `AI::MODELS`. Order in this array drives the
 * dropdown order on the LeadGen "AI Generated List" card.
 */
export type AiProvider =
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'xai'
  | 'deepseek'
  | 'perplexity'
  | 'skywork'
  | 'openai_compatible';

export interface AiModel {
  id: string;
  label: string;
  provider: AiProvider;
  /** Whether this model can do web-grounded research natively (built-in or via tool). */
  search: boolean;
  /** Overrides the provider's default endpoint when set. */
  custom_endpoint?: string | null;
}

/** A user-added row in the `ai_models` table. */
export interface CustomAiModel {
  id: number;
  model_id: string;
  label: string;
  provider: AiProvider;
  supports_search: 0 | 1 | boolean;
  custom_endpoint: string | null;
  created_at?: string;
}

export const AI_MODELS: AiModel[] = [
  { id: 'claude-opus-4-7',           label: 'Claude Opus 4.7',     provider: 'anthropic',  search: true  },
  { id: 'claude-sonnet-4-6',         label: 'Claude Sonnet 4.6',   provider: 'anthropic',  search: true  },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5',    provider: 'anthropic',  search: true  },
  { id: 'gpt-4o',                    label: 'GPT-4o',              provider: 'openai',     search: true  },
  { id: 'gpt-4o-mini',               label: 'GPT-4o mini',         provider: 'openai',     search: false },
  { id: 'o1',                        label: 'OpenAI o1',           provider: 'openai',     search: false },
  { id: 'gemini-2.5-pro',            label: 'Gemini 2.5 Pro',      provider: 'gemini',     search: true  },
  { id: 'gemini-2.5-flash',          label: 'Gemini 2.5 Flash',    provider: 'gemini',     search: true  },
  { id: 'grok-4',                    label: 'Grok 4',              provider: 'xai',        search: true  },
  { id: 'grok-3',                    label: 'Grok 3',              provider: 'xai',        search: true  },
  { id: 'sonar',                     label: 'Perplexity Sonar',    provider: 'perplexity', search: true  },
  { id: 'sonar-pro',                 label: 'Perplexity Sonar Pro',provider: 'perplexity', search: true  },
  { id: 'deepseek-chat',             label: 'DeepSeek Chat',       provider: 'deepseek',   search: false },
  { id: 'deepseek-reasoner',         label: 'DeepSeek Reasoner',   provider: 'deepseek',   search: false },
  { id: 'skywork-o1',                label: 'Skywork o1',          provider: 'skywork',    search: false },
  { id: 'skywork-13b-chat',          label: 'Skywork 13B Chat',    provider: 'skywork',    search: false },
];

export const PROVIDER_LABELS: Record<AiProvider, string> = {
  anthropic:         'Anthropic',
  openai:            'OpenAI',
  gemini:            'Google Gemini',
  xai:               'xAI Grok',
  deepseek:          'DeepSeek',
  perplexity:        'Perplexity',
  skywork:           'Skywork',
  openai_compatible: 'Custom (OpenAI-compatible)',
};

export const PROVIDER_KEY_SETTING: Record<AiProvider, string> = {
  anthropic:         'ai_anthropic_api_key',
  openai:            'ai_openai_api_key',
  gemini:            'ai_gemini_api_key',
  xai:               'ai_xai_api_key',
  deepseek:          'ai_deepseek_api_key',
  perplexity:        'ai_perplexity_api_key',
  skywork:           'ai_skywork_api_key',
  openai_compatible: 'ai_custom_api_key',
};

export const PROVIDER_SECRET_SETTING: Record<AiProvider, string> = {
  anthropic:         'ai_anthropic_api_secret',
  openai:            'ai_openai_api_secret',
  gemini:            'ai_gemini_api_secret',
  xai:               'ai_xai_api_secret',
  deepseek:          'ai_deepseek_api_secret',
  perplexity:        'ai_perplexity_api_secret',
  skywork:           'ai_skywork_api_secret',
  openai_compatible: 'ai_custom_api_secret',
};
