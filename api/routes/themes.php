<?php
declare(strict_types=1);

use BRS\Auth;
use BRS\Db;
use BRS\Json;

/*
 * Per-tenant custom themes.
 *
 *   GET    /api/themes             list customs for current tenant
 *   POST   /api/themes             create a custom theme
 *   GET    /api/themes/:id         read
 *   PUT    /api/themes/:id         update
 *   DELETE /api/themes/:id         delete
 *
 * `vars_json` is stored as text but validated as a JSON object on write.
 * Each entry must be a CSS variable name (starts with `--` and only
 * hyphens/letters) mapped to a color-like value (any string; loose).
 * The frontend applier drops unknown keys defensively.
 *
 * Slugs must start with `custom-` so they never collide with the six
 * built-in preset slugs.
 */
return function (string $method, array $segs): void {
    $claims = Auth::require();
    $pdo    = Db::tpdo();

    // Reserved for the built-in presets — attempts to create a custom
    // with any of these slugs are rejected.
    $reservedSlugs = ['midnight-gold','frosted-mint','sunrise-coral','indigo-pulse','graphite-rose','forest-amber'];

    // Only accept CSS variable names — --foo, --foo-bar-3, etc.
    $isValidVarName = static fn(string $k): bool => (bool)preg_match('/^--[a-z][a-z0-9-]*$/', $k);

    // Validate/normalise the vars payload. Returns [json, error]. Errors
    // bubble up as 400s; a well-formed payload is re-encoded so callers
    // get consistent whitespace/ordering in the DB.
    $normaliseVars = static function ($raw) use ($isValidVarName): array {
        if (!is_array($raw)) return ['', 'vars must be an object of {"--name": "value"}'];
        $out = [];
        foreach ($raw as $k => $v) {
            if (!is_string($k) || !$isValidVarName($k))         return ['', "Invalid variable name: $k"];
            if (!is_string($v) && !is_numeric($v))              return ['', "Value for $k must be a string"];
            $val = trim((string)$v);
            if ($val === '' || strlen($val) > 80)               return ['', "Value for $k is empty or too long"];
            // Strip any raw newlines / semicolons that could escape the
            // CSS declaration when the frontend renders the <style>.
            if (preg_match('/[\r\n;{}]/', $val))                return ['', "Value for $k contains disallowed characters"];
            $out[$k] = $val;
        }
        if (!$out) return ['', 'vars object cannot be empty'];
        return [json_encode($out, JSON_UNESCAPED_UNICODE) ?: '', null];
    };

    // Slug rule: kebab-case, must start with custom-.
    $normaliseSlug = static function (string $slug) use ($reservedSlugs): array {
        $s = strtolower(trim($slug));
        $s = preg_replace('/[^a-z0-9-]+/', '-', $s) ?? '';
        $s = preg_replace('/-+/', '-', $s) ?? '';
        $s = trim($s, '-');
        if ($s === '')                            return ['', 'Slug required'];
        if (in_array($s, $reservedSlugs, true))   return ['', 'Slug is reserved for a preset'];
        if (strpos($s, 'custom-') !== 0)          $s = 'custom-' . $s;
        if (strlen($s) > 60)                      return ['', 'Slug too long (60 chars max)'];
        return [$s, null];
    };

    // Post-fetch shape: parse vars_json for the response so the caller
    // doesn't have to.
    $shape = static function (array $row): array {
        $vars = [];
        if (!empty($row['vars_json'])) {
            $decoded = json_decode($row['vars_json'], true);
            if (is_array($decoded)) $vars = $decoded;
        }
        unset($row['vars_json']);
        $row['vars'] = $vars;
        return $row;
    };

    // /api/themes  (collection)
    if (!isset($segs[1])) {
        if ($method === 'GET') {
            $rows = $pdo->query('SELECT * FROM tenant_themes ORDER BY label')->fetchAll();
            Json::send(['themes' => array_map($shape, $rows)]);
        }
        if ($method === 'POST') {
            $body  = Json::readBody();
            $label = trim((string)($body['label'] ?? ''));
            if ($label === '') Json::fail('Label is required', 400);

            [$slug, $slugErr] = $normaliseSlug((string)($body['slug'] ?? $label));
            if ($slugErr) Json::fail($slugErr, 400);
            [$varsJson, $varsErr] = $normaliseVars($body['vars'] ?? null);
            if ($varsErr) Json::fail($varsErr, 400);

            try {
                $ins = Db::pdo()->prepare(
                    'INSERT INTO tenant_themes (tenant_id, slug, label, mood, vars_json, created_by_user_id)
                     VALUES (?, ?, ?, ?, ?, ?)'
                );
                $ins->execute([
                    \BRS\Tenant::id(),
                    $slug,
                    $label,
                    trim((string)($body['mood'] ?? '')) ?: null,
                    $varsJson,
                    (int)$claims['sub'],
                ]);
                Json::send(['id' => (int)Db::pdo()->lastInsertId(), 'slug' => $slug], 201);
            } catch (\PDOException $e) {
                if ($e->getCode() === '23000') Json::fail('A theme with that slug already exists', 400);
                throw $e;
            }
        }
        Json::fail('Method not allowed', 405);
    }

    // /api/themes/:id
    $id = (int)$segs[1];
    if ($id <= 0) Json::fail('Invalid id', 400);
    $sel = $pdo->prepare('SELECT * FROM tenant_themes WHERE id = ?');
    $sel->execute([$id]);
    $row = $sel->fetch();
    if (!$row) Json::fail('Theme not found', 404);

    if ($method === 'GET') {
        Json::send(['theme' => $shape($row)]);
    }

    if ($method === 'PUT') {
        $body = Json::readBody();
        $fields = []; $params = [];
        if (array_key_exists('label', $body)) {
            $l = trim((string)$body['label']);
            if ($l === '') Json::fail('Label cannot be empty', 400);
            $fields[] = 'label = ?'; $params[] = $l;
        }
        if (array_key_exists('mood', $body))  { $fields[] = 'mood = ?'; $params[] = trim((string)$body['mood']) ?: null; }
        if (array_key_exists('vars', $body)) {
            [$varsJson, $varsErr] = $normaliseVars($body['vars']);
            if ($varsErr) Json::fail($varsErr, 400);
            $fields[] = 'vars_json = ?'; $params[] = $varsJson;
        }
        // Slug is intentionally immutable — changing it would strand
        // any user who has this theme set as their override.

        if ($fields) {
            $params[] = $id;
            $pdo->prepare('UPDATE tenant_themes SET ' . implode(', ', $fields) . ' WHERE id = ?')
                ->execute($params);
        }
        Json::send(['ok' => true]);
    }

    if ($method === 'DELETE') {
        $pdo->prepare('DELETE FROM tenant_themes WHERE id = ?')->execute([$id]);
        Json::send(['ok' => true]);
    }

    Json::fail('Method not allowed', 405);
};
