<?php
declare(strict_types=1);

namespace BRS;

/**
 * AI provider dispatcher for the Lead Gen "AI Generated List" feature.
 *
 * Two-stage pipeline:
 *   1. SEARCH — call the chosen model (with web-search tool when supported)
 *      to gather real businesses matching the user's brief.
 *   2. FORMAT — if a different format model was requested, send stage-1 output
 *      to it to coerce into strict JSON. Otherwise stage-1 output is parsed
 *      directly. Always returns { leads: [...] } matching the lead schema.
 *
 * API keys live in the `settings` table under `ai_<provider>_api_key` and are
 * never exposed to the browser. Read this file in tandem with the model
 * registry mirrored in `frontend/src/app/core/ai-models.ts` — they MUST stay
 * in sync.
 */
final class AI
{
    /** Model registry. Mirror in `frontend/src/app/core/ai-models.ts`. */
    public const MODELS = [
        // Anthropic
        'claude-opus-4-7'           => ['provider' => 'anthropic',  'label' => 'Claude Opus 4.7',     'search' => true],
        'claude-sonnet-4-6'         => ['provider' => 'anthropic',  'label' => 'Claude Sonnet 4.6',   'search' => true],
        'claude-haiku-4-5-20251001' => ['provider' => 'anthropic',  'label' => 'Claude Haiku 4.5',    'search' => true],
        // OpenAI
        'gpt-4o'                    => ['provider' => 'openai',     'label' => 'GPT-4o',              'search' => true],
        'gpt-4o-mini'               => ['provider' => 'openai',     'label' => 'GPT-4o mini',         'search' => false],
        'o1'                        => ['provider' => 'openai',     'label' => 'OpenAI o1',           'search' => false],
        // Gemini
        'gemini-2.5-pro'            => ['provider' => 'gemini',     'label' => 'Gemini 2.5 Pro',      'search' => true],
        'gemini-2.5-flash'          => ['provider' => 'gemini',     'label' => 'Gemini 2.5 Flash',    'search' => true],
        // xAI Grok
        'grok-4'                    => ['provider' => 'xai',        'label' => 'Grok 4',              'search' => true],
        'grok-3'                    => ['provider' => 'xai',        'label' => 'Grok 3',              'search' => true],
        // Perplexity (native web search built into sonar models)
        'sonar'                     => ['provider' => 'perplexity', 'label' => 'Perplexity Sonar',    'search' => true],
        'sonar-pro'                 => ['provider' => 'perplexity', 'label' => 'Perplexity Sonar Pro','search' => true],
        // DeepSeek
        'deepseek-chat'             => ['provider' => 'deepseek',   'label' => 'DeepSeek Chat',       'search' => false],
        'deepseek-reasoner'         => ['provider' => 'deepseek',   'label' => 'DeepSeek Reasoner',   'search' => false],
        // Skywork (endpoint format may need adjustment when first used)
        'skywork-o1'                => ['provider' => 'skywork',    'label' => 'Skywork o1',          'search' => false],
        'skywork-13b-chat'          => ['provider' => 'skywork',    'label' => 'Skywork 13B Chat',    'search' => false],
    ];

    /** Provider → settings key for the API key. */
    private const PROVIDER_KEY_SETTING = [
        'anthropic'         => 'ai_anthropic_api_key',
        'openai'            => 'ai_openai_api_key',
        'gemini'            => 'ai_gemini_api_key',
        'xai'               => 'ai_xai_api_key',
        'deepseek'          => 'ai_deepseek_api_key',
        'perplexity'        => 'ai_perplexity_api_key',
        'skywork'           => 'ai_skywork_api_key',
        'openai_compatible' => 'ai_custom_api_key',
    ];

    /** Provider → settings key for the API secret. Most providers don't use a
     *  separate secret today; the slot exists for forward-compat with key+secret
     *  schemes (OAuth-style apps, signed-webhook providers, etc.). */
    private const PROVIDER_SECRET_SETTING = [
        'anthropic'         => 'ai_anthropic_api_secret',
        'openai'            => 'ai_openai_api_secret',
        'gemini'            => 'ai_gemini_api_secret',
        'xai'               => 'ai_xai_api_secret',
        'deepseek'          => 'ai_deepseek_api_secret',
        'perplexity'        => 'ai_perplexity_api_secret',
        'skywork'           => 'ai_skywork_api_secret',
        'openai_compatible' => 'ai_custom_api_secret',
    ];

    /**
     * Lead schema mirrored verbatim into the prompt so the model returns rows
     * the `/api/leads/bulk` endpoint can ingest without translation. Field
     * names, types, max lengths, and the `status` enum match the `leads` table
     * (db migration 050 + 060). Update both this constant AND the schema
     * comment block below if the table changes.
     */
    private const LEAD_SCHEMA_BLOCK = <<<TXT
{
  "leads": [
    {
      "name":    string,  // REQUIRED. Branch / trading / contact name. Max 190 chars.
      "company": string,  // Legal/registered company name. Max 190 chars. May equal name. null if unknown.
      "email":   string,  // Primary email, lowercase. Must be a valid RFC-5321 address. Max 190 chars. null if unknown — never fabricate.
      "phone":   string,  // Primary phone, digits and standard punctuation only ("+44 20 …" / "(020) …"). Max 80 chars. null if unknown — never fabricate.
      "address": string,  // Full postal address as a single line. null if unknown.
      "url":     string,  // Website URL incl. scheme (https://…). Max 500 chars. null if unknown.
      "notes":   string,  // Short context (≤ 200 chars): regulator, sector, one-line USP. null if nothing useful.
      "status":  string,  // One of EXACTLY: "new" | "contacted" | "qualified" | "converted" | "rejected". Use "new" unless you have a specific reason to set otherwise.
      "source":  string   // Where the lead was sourced from (URL, registry name, dataset name). Max 120 chars. null if unknown.
    }
  ]
}
TXT;

    private const SYSTEM_PROMPT = <<<TXT
You are a lead-generation assistant. Find REAL companies and businesses that match the user's brief, using web search where available.

Return ONLY a JSON object (no markdown fences, no prose, no commentary) matching this schema EXACTLY. Field names, types, max lengths, and enum values must align with the target database — extra fields will be discarded, malformed JSON will be rejected:

TXT
. self::LEAD_SCHEMA_BLOCK . <<<TXT


Rules:
- Only include real, verifiable businesses. If you cannot verify a row, omit it rather than fabricate. Quality over quantity.
- Unknown field → null. Never invent phone numbers, emails, addresses, or URLs.
- Respect the max lengths above — truncate sensibly if a value is longer.
- "status" MUST be one of the five enum values exactly (lowercase). Default to "new".
- "source" should record where the data came from (e.g. "cqc.org.uk", "Companies House register"), not the prompt itself.
- Return strict JSON. No markdown fences, no headings, no prose around the JSON.
TXT;

    private const FORMAT_SYSTEM_PROMPT = <<<TXT
Reformat the input below into a JSON object matching this schema EXACTLY:

TXT
. self::LEAD_SCHEMA_BLOCK . <<<TXT


Rules:
- Preserve every business present in the input; do not invent new ones or new field values.
- Coerce values into the right types and lengths above. If a field is missing or untrustworthy, use null.
- "status" MUST be one of: "new", "contacted", "qualified", "converted", "rejected". Default to "new".
- Return ONLY the JSON object, no markdown fences, no commentary, no other text.
TXT;

    public static function getApiKey(string $provider): string
    {
        $key = self::PROVIDER_KEY_SETTING[$provider] ?? null;
        if (!$key) return '';
        $row = Db::pdo()->prepare('SELECT v FROM settings WHERE k = ?');
        $row->execute([$key]);
        return (string)($row->fetchColumn() ?: '');
    }

    public static function getApiSecret(string $provider): string
    {
        $key = self::PROVIDER_SECRET_SETTING[$provider] ?? null;
        if (!$key) return '';
        $row = Db::pdo()->prepare('SELECT v FROM settings WHERE k = ?');
        $row->execute([$key]);
        return (string)($row->fetchColumn() ?: '');
    }

    /** Built-in models merged with user-added rows from the `ai_models` table.
     *  User entries with the same `model_id` as a built-in override the built-in
     *  (so users can change a label or override an endpoint without code change). */
    public static function getAllModels(): array
    {
        $merged = self::MODELS;
        try {
            $rows = Db::pdo()->query('SELECT model_id, label, provider, supports_search, custom_endpoint FROM ai_models')->fetchAll();
        } catch (\Throwable $e) {
            return $merged; // table may not exist yet on a fresh checkout
        }
        foreach ($rows as $r) {
            $merged[(string)$r['model_id']] = [
                'provider'        => (string)$r['provider'],
                'label'           => (string)$r['label'],
                'search'          => (bool)(int)$r['supports_search'],
                'custom_endpoint' => $r['custom_endpoint'] !== null && $r['custom_endpoint'] !== ''
                    ? (string)$r['custom_endpoint']
                    : null,
            ];
        }
        return $merged;
    }

    /**
     * Run the two-stage generate flow. $formatModel may be null/empty/equal to
     * $searchModel — in those cases stage-1 output is parsed directly.
     */
    public static function generate(string $searchModel, ?string $formatModel, string $userPrompt): array
    {
        $models = self::getAllModels();
        if (!isset($models[$searchModel])) {
            throw new \RuntimeException("Unknown search model: {$searchModel}");
        }
        if ($formatModel !== null && $formatModel !== '' && $formatModel !== $searchModel
            && !isset($models[$formatModel])) {
            throw new \RuntimeException("Unknown format model: {$formatModel}");
        }

        $stage1 = self::callProvider(
            $models[$searchModel]['provider'],
            $searchModel,
            self::SYSTEM_PROMPT,
            $userPrompt,
            (bool)$models[$searchModel]['search'],
            $models[$searchModel]['custom_endpoint'] ?? null
        );

        $jsonText = $stage1;
        if ($formatModel && $formatModel !== $searchModel) {
            $jsonText = self::callProvider(
                $models[$formatModel]['provider'],
                $formatModel,
                self::FORMAT_SYSTEM_PROMPT,
                $stage1,
                false,
                $models[$formatModel]['custom_endpoint'] ?? null
            );
        }

        return self::parseLeadsJson($jsonText);
    }

    /** Strip markdown fences and parse JSON, returning the leads array. */
    private static function parseLeadsJson(string $text): array
    {
        $t = trim($text);
        // Strip ```json … ``` or ``` … ``` fences
        if (preg_match('/```(?:json)?\s*(\{.*\})\s*```/s', $t, $m)) {
            $t = $m[1];
        }
        // If still not pure JSON, try to extract the outermost {...} block
        if ($t !== '' && $t[0] !== '{') {
            $start = strpos($t, '{');
            $end   = strrpos($t, '}');
            if ($start !== false && $end !== false && $end > $start) {
                $t = substr($t, $start, $end - $start + 1);
            }
        }
        $parsed = json_decode($t, true);
        if (!is_array($parsed) || !isset($parsed['leads']) || !is_array($parsed['leads'])) {
            throw new \RuntimeException('Model did not return JSON with a "leads" array. Raw output: ' . substr($text, 0, 500));
        }
        return array_values(array_filter($parsed['leads'], static fn($l) => is_array($l) && trim((string)($l['name'] ?? '')) !== ''));
    }

    private static function callProvider(string $provider, string $model, string $system, string $user, bool $useSearch, ?string $customEndpoint = null): string
    {
        $key = self::getApiKey($provider);
        if ($key === '') {
            throw new \RuntimeException("API key for {$provider} is not configured. Add it in Lead Gen → Settings.");
        }
        return match ($provider) {
            'anthropic'         => self::callAnthropic($key, $model, $system, $user, $useSearch, $customEndpoint),
            'openai'            => self::callOpenAI($key, $model, $system, $user, $useSearch, $customEndpoint),
            'gemini'            => self::callGemini($key, $model, $system, $user, $useSearch, $customEndpoint),
            'xai'               => self::callXai($key, $model, $system, $user, $useSearch, $customEndpoint),
            'deepseek'          => self::callDeepSeek($key, $model, $system, $user, $customEndpoint),
            'perplexity'        => self::callPerplexity($key, $model, $system, $user, $customEndpoint),
            'skywork'           => self::callSkywork($key, $model, $system, $user, $customEndpoint),
            'openai_compatible' => self::callOpenAICompatible($key, $model, $system, $user, $customEndpoint),
            default             => throw new \RuntimeException("Unknown provider: {$provider}"),
        };
    }

    private static function curlPost(string $url, array $headers, array $body): array
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => json_encode($body, JSON_UNESCAPED_SLASHES),
            CURLOPT_HTTPHEADER     => array_merge(['Content-Type: application/json'], $headers),
            CURLOPT_TIMEOUT        => 120,
            CURLOPT_CONNECTTIMEOUT => 15,
        ]);
        $resp = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err  = curl_error($ch);
        curl_close($ch);
        if ($resp === false) throw new \RuntimeException("HTTP request failed: {$err}");
        $json = json_decode((string)$resp, true);
        if ($code >= 400) {
            $msg = is_array($json) ? json_encode($json) : (string)$resp;
            throw new \RuntimeException("Provider returned HTTP {$code}: " . substr($msg, 0, 500));
        }
        if (!is_array($json)) {
            throw new \RuntimeException('Provider returned non-JSON response.');
        }
        return $json;
    }

    private static function callAnthropic(string $key, string $model, string $system, string $user, bool $useSearch, ?string $customEndpoint = null): string
    {
        $body = [
            'model'      => $model,
            'max_tokens' => 8192,
            'system'     => $system,
            'messages'   => [['role' => 'user', 'content' => $user]],
        ];
        if ($useSearch) {
            $body['tools'] = [[
                'type'     => 'web_search_20250305',
                'name'     => 'web_search',
                'max_uses' => 5,
            ]];
        }
        $resp = self::curlPost($customEndpoint ?: 'https://api.anthropic.com/v1/messages', [
            "x-api-key: {$key}",
            'anthropic-version: 2023-06-01',
        ], $body);
        $text = '';
        foreach (($resp['content'] ?? []) as $block) {
            if (($block['type'] ?? '') === 'text') $text .= $block['text'] ?? '';
        }
        return $text;
    }

    private static function callOpenAI(string $key, string $model, string $system, string $user, bool $useSearch, ?string $customEndpoint = null): string
    {
        if ($useSearch) {
            // Responses API supports the web_search tool.
            $body = [
                'model'        => $model,
                'instructions' => $system,
                'input'        => $user,
                'tools'        => [['type' => 'web_search']],
            ];
            $resp = self::curlPost($customEndpoint ?: 'https://api.openai.com/v1/responses', [
                "Authorization: Bearer {$key}",
            ], $body);
            // Newer Responses API exposes flat `output_text`.
            if (!empty($resp['output_text'])) return (string)$resp['output_text'];
            // Fallback: walk the structured `output` array.
            $text = '';
            foreach (($resp['output'] ?? []) as $item) {
                foreach (($item['content'] ?? []) as $c) {
                    if (($c['type'] ?? '') === 'output_text') $text .= $c['text'] ?? '';
                }
            }
            return $text;
        }
        $body = [
            'model'           => $model,
            'messages'        => [
                ['role' => 'system', 'content' => $system],
                ['role' => 'user',   'content' => $user],
            ],
            'response_format' => ['type' => 'json_object'],
        ];
        $resp = self::curlPost($customEndpoint ?: 'https://api.openai.com/v1/chat/completions', [
            "Authorization: Bearer {$key}",
        ], $body);
        return (string)($resp['choices'][0]['message']['content'] ?? '');
    }

    private static function callGemini(string $key, string $model, string $system, string $user, bool $useSearch, ?string $customEndpoint = null): string
    {
        $url  = $customEndpoint ?: ("https://generativelanguage.googleapis.com/v1beta/models/{$model}:generateContent?key=" . urlencode($key));
        $body = [
            'systemInstruction' => ['parts' => [['text' => $system]]],
            'contents'          => [['role' => 'user', 'parts' => [['text' => $user]]]],
        ];
        if ($useSearch) {
            $body['tools'] = [['google_search' => new \stdClass()]];
        } else {
            // JSON mime type is incompatible with grounding tools, so only request it when no search.
            $body['generationConfig'] = ['responseMimeType' => 'application/json'];
        }
        $resp = self::curlPost($url, [], $body);
        $text = '';
        foreach (($resp['candidates'][0]['content']['parts'] ?? []) as $p) {
            $text .= $p['text'] ?? '';
        }
        return $text;
    }

    private static function callXai(string $key, string $model, string $system, string $user, bool $useSearch, ?string $customEndpoint = null): string
    {
        $body = [
            'model'    => $model,
            'messages' => [
                ['role' => 'system', 'content' => $system],
                ['role' => 'user',   'content' => $user],
            ],
        ];
        if ($useSearch) {
            $body['search_parameters'] = ['mode' => 'auto'];
        }
        $resp = self::curlPost($customEndpoint ?: 'https://api.x.ai/v1/chat/completions', [
            "Authorization: Bearer {$key}",
        ], $body);
        return (string)($resp['choices'][0]['message']['content'] ?? '');
    }

    private static function callDeepSeek(string $key, string $model, string $system, string $user, ?string $customEndpoint = null): string
    {
        return self::genericChatCompletion($key, $customEndpoint ?: 'https://api.deepseek.com/chat/completions', $model, $system, $user);
    }

    private static function callPerplexity(string $key, string $model, string $system, string $user, ?string $customEndpoint = null): string
    {
        // Sonar models have web search built in — no flag needed.
        return self::genericChatCompletion($key, $customEndpoint ?: 'https://api.perplexity.ai/chat/completions', $model, $system, $user);
    }

    private static function callSkywork(string $key, string $model, string $system, string $user, ?string $customEndpoint = null): string
    {
        // Skywork's public chat API is OpenAI-compatible. Endpoint may need
        // adjustment depending on which Skywork product is in use — override
        // via a custom_endpoint on the model row if so.
        return self::genericChatCompletion($key, $customEndpoint ?: 'https://api.skywork.ai/v1/chat/completions', $model, $system, $user);
    }

    /**
     * Bring-your-own OpenAI-compatible endpoint (Ollama, vLLM, Together, Groq,
     * Fireworks, etc.). The custom_endpoint on the model row is required.
     */
    private static function callOpenAICompatible(string $key, string $model, string $system, string $user, ?string $customEndpoint): string
    {
        if (!$customEndpoint) {
            throw new \RuntimeException("openai_compatible models require a custom endpoint URL on the model row.");
        }
        return self::genericChatCompletion($key, $customEndpoint, $model, $system, $user);
    }

    /** Shared OpenAI-compatible chat-completion helper. */
    private static function genericChatCompletion(string $key, string $url, string $model, string $system, string $user): string
    {
        $body = [
            'model'    => $model,
            'messages' => [
                ['role' => 'system', 'content' => $system],
                ['role' => 'user',   'content' => $user],
            ],
        ];
        $resp = self::curlPost($url, [
            "Authorization: Bearer {$key}",
        ], $body);
        return (string)($resp['choices'][0]['message']['content'] ?? '');
    }
}
