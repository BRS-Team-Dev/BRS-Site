<?php
declare(strict_types=1);

use BRS\Db;
use BRS\Json;

/*
 * Public, token-gated pulse survey endpoint. Used by:
 *   - external respondents at /surveys/:token
 *   - embedded iframes on third-party sites
 *
 *   GET  /api/public-survey/:token            — survey definition (questions, branding, status)
 *   POST /api/public-survey/:token/respond    — submit answers
 *
 * The survey only responds when:
 *   - hr_pulse_surveys.allow_external = 1
 *   - status = 'open'
 *   - opens_at / closes_at window respected
 *
 * Sets permissive embed headers so the page can be iframed cross-origin.
 */

// Allow embedding on third-party sites.
header_remove('X-Frame-Options');
header('Content-Security-Policy: frame-ancestors *');

use BRS\Tenant;

return function (string $method, array $segs): void {
    // Public routes have no JWT — bootstrap the tenant context.
    // Hardcoded to BRS (tenant 1) until per-tenant public routing
    // lands in Phase 5 (subdomain detection / per-tenant API key).
    Tenant::setForPublic();
    $pdo = Db::tpdo();
    $token = (string)($segs[1] ?? '');
    if ($token === '' || strlen($token) < 16) Json::fail('token required', 400);

    $row = $pdo->prepare('SELECT * FROM hr_pulse_surveys WHERE public_token = ?');
    $row->execute([$token]);
    $survey = $row->fetch();
    if (!$survey || (int)$survey['allow_external'] !== 1) Json::fail('Survey not found', 404);
    if ($survey['status'] !== 'open') Json::fail('Survey is not open', 410);
    if (!empty($survey['opens_at'])  && strtotime($survey['opens_at'])  > time()) Json::fail('Survey not open yet', 410);
    if (!empty($survey['closes_at']) && strtotime($survey['closes_at']) < time()) Json::fail('Survey has closed', 410);

    $action = (string)($segs[2] ?? '');

    if ($action === '' && $method === 'GET') {
        Json::send([
            'survey' => [
                'title'         => $survey['title'],
                'description'   => $survey['description'],
                'is_anonymous'  => (int)$survey['is_anonymous'],
                'questions'     => json_decode($survey['questions_json'] ?: '[]', true) ?: [],
            ],
        ]);
    }
    if ($action === 'respond' && $method === 'POST') {
        $b = Json::readBody();
        if (!isset($b['answers']) || !is_array($b['answers'])) Json::fail('answers required', 400);
        $ins = $pdo->prepare('INSERT INTO hr_pulse_responses (survey_id, employee_id, answers_json) VALUES (?, NULL, ?)');
        $ins->execute([(int)$survey['id'], json_encode($b['answers'])]);
        Json::send(['ok' => true], 201);
    }
    Json::fail('Not found', 404);
};
