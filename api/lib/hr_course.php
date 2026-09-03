<?php
declare(strict_types=1);

use BRS\Json;

/*
 * Shared course-player helpers — used by both /api/hr/me/* (authenticated) and
 * /api/public-hr-onboarding/* (token-gated) routes.
 */

/** Strip `correct` keys from quiz items so the player can't see the answers. */
function sanitizeQuizForPlayer(array &$module): void {
    if (($module['kind'] ?? '') !== 'quiz' || empty($module['quiz_json'])) return;
    $q = json_decode((string)$module['quiz_json'], true);
    if (!is_array($q)) return;
    foreach ($q as &$item) { unset($item['correct']); }
    unset($item);
    $module['quiz_json'] = json_encode($q);
}

/** Load all modules for a course, with quiz answers stripped. */
function loadModulesForPlayer(\PDO|\BRS\TenantPdo $pdo, int $courseId): array {
    $stmt = $pdo->prepare('SELECT id, course_id, title, kind, body, video_url, quiz_json, images_json, blocks_json, pass_score, sort_order
                           FROM hr_course_modules WHERE course_id = ? ORDER BY sort_order, id');
    $stmt->execute([$courseId]);
    $rows = $stmt->fetchAll();
    foreach ($rows as &$m) { sanitizeQuizForPlayer($m); }
    unset($m);
    return $rows;
}

/** Verify that a module belongs to a course; fail 404 otherwise. */
function moduleForCourse(\PDO|\BRS\TenantPdo $pdo, int $mid, int $cid): array {
    $row = $pdo->prepare('SELECT * FROM hr_course_modules WHERE id = ? AND course_id = ?');
    $row->execute([$mid, $cid]);
    $m = $row->fetch();
    if (!$m) Json::fail('Module not found', 404);
    return $m;
}

/** Insert or update a per-assignment / per-module progress row. */
function upsertModuleProgress(\PDO|\BRS\TenantPdo $pdo, int $aid, int $mid, array $patch): void {
    $row = $pdo->prepare('SELECT * FROM hr_course_module_progress WHERE assignment_id = ? AND module_id = ?');
    $row->execute([$aid, $mid]);
    $cur = $row->fetch();
    $score    = array_key_exists('quiz_score', $patch)   ? $patch['quiz_score']   : ($cur['quiz_score'] ?? null);
    $compAt   = array_key_exists('completed_at', $patch) ? $patch['completed_at'] : ($cur['completed_at'] ?? null);
    $attempts = ($patch['quiz_attempts'] ?? null) === 'increment'
        ? (int)($cur['quiz_attempts'] ?? 0) + 1
        : (int)($cur['quiz_attempts'] ?? 0);
    if ($cur) {
        $pdo->prepare('UPDATE hr_course_module_progress
            SET completed_at = ?, quiz_score = ?, quiz_attempts = ?
            WHERE id = ?')->execute([$compAt, $score, $attempts, (int)$cur['id']]);
    } else {
        $pdo->prepare('INSERT INTO hr_course_module_progress
            (assignment_id, module_id, completed_at, quiz_score, quiz_attempts)
            VALUES (?,?,?,?,?)')->execute([$aid, $mid, $compAt, $score, $attempts]);
    }
}

/** Bump the assignment to in_progress on first activity, or completed when all modules are done. */
function finalizeAssignmentIfDone(\PDO|\BRS\TenantPdo $pdo, int $aid, int $cid): void {
    $tot = $pdo->prepare('SELECT COUNT(*) FROM hr_course_modules WHERE course_id = ?');
    $tot->execute([$cid]);
    $total = (int)$tot->fetchColumn();
    if ($total === 0) return;
    $done = $pdo->prepare('SELECT COUNT(*) FROM hr_course_module_progress
                           WHERE assignment_id = ? AND completed_at IS NOT NULL');
    $done->execute([$aid]);
    $doneCount = (int)$done->fetchColumn();
    if ($doneCount >= $total) {
        $pdo->prepare('UPDATE hr_course_assignments
            SET status = "completed", completed_at = COALESCE(completed_at, NOW())
            WHERE id = ?')->execute([$aid]);
    } else {
        $pdo->prepare('UPDATE hr_course_assignments
            SET status = CASE WHEN status = "not_started" THEN "in_progress" ELSE status END
            WHERE id = ?')->execute([$aid]);
    }
}

/**
 * Score a quiz module against a map of { questionId: [chosenIndices] }.
 * Returns score (0-100), per-question correctness, and the list of wrong question ids.
 */
function scoreQuiz(array $module, array $answers): array {
    $quiz = json_decode((string)($module['quiz_json'] ?? '[]'), true);
    if (!is_array($quiz) || count($quiz) === 0) {
        return ['score' => 0, 'total' => 0, 'correct' => 0, 'wrong_ids' => []];
    }
    $correct = 0;
    $wrong   = [];
    foreach ($quiz as $q) {
        $id = (string)($q['id'] ?? '');
        $expected = isset($q['correct']) && is_array($q['correct']) ? array_map('intval', $q['correct']) : [];
        sort($expected);
        $given = isset($answers[$id]) && is_array($answers[$id])
            ? array_values(array_unique(array_map('intval', $answers[$id])))
            : [];
        sort($given);
        if (count($expected) > 0 && $expected === $given) {
            $correct++;
        } else {
            $wrong[] = $id;
        }
    }
    $total = count($quiz);
    $score = $total > 0 ? (int)round($correct / $total * 100) : 0;
    return ['score' => $score, 'total' => $total, 'correct' => $correct, 'wrong_ids' => $wrong];
}
