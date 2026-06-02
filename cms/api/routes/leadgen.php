<?php
declare(strict_types=1);

use BRS\AI;
use BRS\Auth;
use BRS\Db;
use BRS\Json;

/**
 * Lead Gen routes.
 *   GET    /api/leadgen/models           → merged registry (built-ins + DB)
 *   GET    /api/leadgen/models/custom    → only the user-added rows
 *   POST   /api/leadgen/models/custom    → create a new custom model row
 *   DELETE /api/leadgen/models/custom/:id → remove a custom model row
 *
 * Custom rows live in the `ai_models` table (migration 064). They merge with
 * the hard-coded `BRS\AI::MODELS` registry — user rows override built-ins
 * sharing the same `model_id` so users can patch a label or endpoint without
 * a code change.
 */

return function (string $method, array $segs): void {
    Auth::require();
    $pdo = Db::pdo();

    // /api/leadgen/models → merged registry (built-ins + custom)
    if (($segs[1] ?? '') === 'models' && !isset($segs[2])) {
        if ($method !== 'GET') Json::fail('Method not allowed', 405);
        $models = [];
        foreach (AI::getAllModels() as $id => $m) {
            $models[] = [
                'id'              => $id,
                'label'           => $m['label'],
                'provider'        => $m['provider'],
                'search'          => (bool)$m['search'],
                'custom_endpoint' => $m['custom_endpoint'] ?? null,
            ];
        }
        Json::send(['models' => $models]);
    }

    // /api/leadgen/models/custom[/...]
    if (($segs[1] ?? '') === 'models' && ($segs[2] ?? '') === 'custom') {
        $id = isset($segs[3]) ? (int)$segs[3] : null;

        if ($id === null) {
            if ($method === 'GET') {
                $rows = $pdo->query('SELECT id, model_id, label, provider, supports_search, custom_endpoint, created_at FROM ai_models ORDER BY id DESC')->fetchAll();
                Json::send(['models' => $rows]);
            }
            if ($method === 'POST') {
                $body = Json::readBody();
                $modelId        = trim((string)($body['model_id'] ?? ''));
                $label          = trim((string)($body['label']    ?? ''));
                $provider       = trim((string)($body['provider'] ?? ''));
                $supportsSearch = (int)(bool)($body['supports_search'] ?? false);
                $customEndpoint = trim((string)($body['custom_endpoint'] ?? '')) ?: null;

                if ($modelId === '') Json::fail('model_id is required', 400);
                if ($label === '')   Json::fail('label is required', 400);
                $allowedProviders = ['anthropic', 'openai', 'gemini', 'xai', 'deepseek', 'perplexity', 'skywork', 'openai_compatible'];
                if (!in_array($provider, $allowedProviders, true)) {
                    Json::fail('provider must be one of: ' . implode(', ', $allowedProviders), 400);
                }
                if ($provider === 'openai_compatible' && !$customEndpoint) {
                    Json::fail('custom_endpoint is required for openai_compatible provider', 400);
                }

                try {
                    $ins = $pdo->prepare('INSERT INTO ai_models (model_id, label, provider, supports_search, custom_endpoint) VALUES (?,?,?,?,?)');
                    $ins->execute([$modelId, $label, $provider, $supportsSearch, $customEndpoint]);
                } catch (\PDOException $e) {
                    if ((int)$e->errorInfo[1] === 1062) {
                        Json::fail('A model with that model_id already exists.', 409);
                    }
                    throw $e;
                }
                Json::send(['id' => (int)$pdo->lastInsertId()], 201);
            }
            Json::fail('Method not allowed', 405);
        }

        if ($id <= 0) Json::fail('Invalid id', 400);
        if ($method === 'DELETE') {
            $pdo->prepare('DELETE FROM ai_models WHERE id = ?')->execute([$id]);
            Json::send(['ok' => true]);
        }
        Json::fail('Method not allowed', 405);
    }

    Json::fail('Not found', 404);
};
