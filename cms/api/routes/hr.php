<?php
declare(strict_types=1);

use BRS\Auth;
use BRS\Db;
use BRS\Json;

/*
 * HR system route — handles all /api/hr/* paths.
 */

// Shared course-player helpers used by handleMe() and handleEmpLearning().
// MUST be loaded before the `return function(...)` below, because once that
// return executes, PHP stops running the rest of the file — so any
// `require_once` after it never fires (function declarations are hoisted at
// parse time, but require_once is a runtime statement).
require_once __DIR__ . '/../lib/hr_course.php';

return function (string $method, array $segs): void {
    Auth::require();
    $pdo = Db::tpdo();
    $sub = (string)($segs[1] ?? '');

    if ($sub === 'employees')        { handleEmployees($pdo, $method, $segs);       return; }
    if ($sub === 'payroll')          { handlePayroll($pdo, $method, $segs);         return; }
    if ($sub === 'time-off')         { handleTimeOff($pdo, $method, $segs);         return; }
    if ($sub === 'reviews')          { handleReviews($pdo, $method, $segs);         return; }
    if ($sub === 'courses')          { handleCourses($pdo, $method, $segs);         return; }
    if ($sub === 'change-requests')  { handleChangeRequests($pdo, $method, $segs);  return; }
    if ($sub === 'compliance')       { handleCompliance($pdo, $method, $segs);      return; }
    if ($sub === 'pulse-surveys')    { handlePulseSurveys($pdo, $method, $segs);    return; }
    if ($sub === 'feedback')         { handleFeedback($pdo, $method, $segs);        return; }
    if ($sub === 'reports')          { handleReports($pdo, $method, $segs);         return; }
    if ($sub === 'succession')       { handleSuccession($pdo, $method, $segs);      return; }
    if ($sub === 'jobs')             { handleJobs($pdo, $method, $segs);            return; }
    if ($sub === 'candidates')       { handleCandidates($pdo, $method, $segs);      return; }
    if ($sub === 'applications')     { handleApplications($pdo, $method, $segs);    return; }
    if ($sub === 'document-types')   { handleDocumentTypes($pdo, $method, $segs);   return; }
    if ($sub === 'contract-types')   { handleContractTypes($pdo, $method, $segs);   return; }
    if ($sub === 'contract-groups')  { handleContractGroups($pdo, $method, $segs);  return; }
    if ($sub === 'all-documents')    { handleAllDocuments($pdo, $method);           return; }
    if ($sub === 'all-onboarding')   { handleAllOnboarding($pdo, $method);          return; }
    if ($sub === 'legal')            { handleLegal($pdo, $method, $segs);           return; }
    if ($sub === 'me')               { handleMe($pdo, $method, $segs);              return; }
    Json::fail('Not found', 404);
};

/** Resolve the currently signed-in employee record (if any). */
function currentEmployee(\PDO|\BRS\TenantPdo $pdo): ?array {
    $claims = Auth::require();
    $uid = (int)($claims['sub'] ?? 0);
    if ($uid <= 0) return null;
    $stmt = $pdo->prepare('SELECT * FROM hr_employees WHERE admin_user_id = ?');
    $stmt->execute([$uid]);
    return $stmt->fetch() ?: null;
}

/** Helper: pick an enum value safely. Returns the fallback if not in $allowed. */
function pickEnum(?string $value, array $allowed, string $fallback): string {
    if ($value !== null && in_array($value, $allowed, true)) return $value;
    return $fallback;
}

function handleMe(\PDO|\BRS\TenantPdo $pdo, string $method, array $segs): void {
    $emp = currentEmployee($pdo);
    if (!$emp) Json::fail('No employee record for the current user', 404);

    $sub = (string)($segs[2] ?? '');
    if ($sub === '') {
        if ($method === 'GET') Json::send(['employee' => $emp]);
        Json::fail('Method not allowed', 405);
    }
    if ($sub === 'payslips') {
        if ($method !== 'GET') Json::fail('Method not allowed', 405);
        $stmt = $pdo->prepare('
            SELECT s.*, p.name AS period_name, p.start_date, p.end_date, p.pay_date, p.status AS period_status
            FROM hr_payslips s JOIN hr_payroll_periods p ON p.id = s.period_id
            WHERE s.employee_id = ? AND p.status IN ("approved","paid")
            ORDER BY p.start_date DESC');
        $stmt->execute([$emp['id']]);
        Json::send(['payslips' => $stmt->fetchAll()]);
    }
    if ($sub === 'time-off') {
        if ($method === 'GET') {
            $stmt = $pdo->prepare('SELECT * FROM hr_time_off_requests WHERE employee_id = ? ORDER BY start_date DESC, id DESC');
            $stmt->execute([$emp['id']]);
            Json::send(['entries' => $stmt->fetchAll()]);
        }
        if ($method === 'POST') {
            $b = Json::readBody();
            $start = $b['start_date'] ?? '';
            $end   = $b['end_date'] ?? '';
            if (!$start || !$end) Json::fail('start_date, end_date required', 400);
            $kind = pickEnum($b['kind'] ?? null, ['vacation','sick','personal','unpaid','other'], 'vacation');
            $days = isset($b['days']) ? (float)$b['days'] : (float)max(1, (strtotime($end) - strtotime($start)) / 86400 + 1);
            $ins = $pdo->prepare('INSERT INTO hr_time_off_requests
                (employee_id, kind, start_date, end_date, days, notes, status)
                VALUES (?,?,?,?,?,?, "pending")');
            $ins->execute([$emp['id'], $kind, $start, $end, $days, $b['notes'] ?? null]);
            Json::send(['id' => (int)$pdo->lastInsertId()], 201);
        }
        Json::fail('Method not allowed', 405);
    }
    if ($sub === 'documents') {
        if ($method === 'GET') {
            $stmt = $pdo->prepare('SELECT d.*, t.template_blocks_json
                                   FROM hr_documents d
                                   LEFT JOIN hr_document_types t ON t.id = d.doc_type_id
                                   WHERE d.employee_id = ? ORDER BY d.uploaded_at DESC');
            $stmt->execute([$emp['id']]);
            Json::send(['documents' => $stmt->fetchAll()]);
        }
        // Self-service upload: an employee adds a file to their own record (e.g.
        // satisfies a required document type, or just shares an extra). Mirrors
        // the admin-side handleDocuments POST but scoped to the current user.
        if ($method === 'POST') {
            if (empty($_FILES['file'])) Json::fail('file required', 400);
            $f = $_FILES['file'];
            if ($f['error'] !== UPLOAD_ERR_OK) Json::fail('upload failed (code ' . $f['error'] . ')', 400);
            $title    = trim((string)($_POST['title'] ?? $f['name']));
            $category = trim((string)($_POST['category'] ?? 'general'));
            $docTypeId = isset($_POST['doc_type_id']) && $_POST['doc_type_id'] !== '' ? (int)$_POST['doc_type_id'] : null;
            $reference = trim((string)($_POST['reference_number'] ?? '')) ?: null;
            $issuedAt  = !empty($_POST['issued_at'])  ? (string)$_POST['issued_at']  : null;
            $expiresAt = !empty($_POST['expires_at']) ? (string)$_POST['expires_at'] : null;

            $eid = (int)$emp['id'];
            $dir = __DIR__ . '/../../uploads/hr/' . $eid;
            if (!is_dir($dir)) @mkdir($dir, 0775, true);
            $safe = preg_replace('/[^A-Za-z0-9._-]+/', '_', basename($f['name']));
            $name = time() . '_' . $safe;
            $dest = $dir . '/' . $name;
            if (!move_uploaded_file($f['tmp_name'], $dest)) Json::fail('failed to save file', 500);

            $relPath = 'uploads/hr/' . $eid . '/' . $name;
            $claims = Auth::require();
            $ins = $pdo->prepare('INSERT INTO hr_documents
                (employee_id, doc_type_id, category, title, file_path, file_size, mime_type,
                 reference_number, issued_at, expires_at, uploaded_by)
                VALUES (?,?,?,?,?,?,?, ?,?,?, ?)');
            $ins->execute([
                $eid, $docTypeId, $category, $title, $relPath, (int)$f['size'], $f['type'] ?? null,
                $reference, $issuedAt, $expiresAt, (int)($claims['sub'] ?? 0) ?: null,
            ]);
            Json::send(['id' => (int)$pdo->lastInsertId()], 201);
        }
        // Self-service delete: an employee can remove their own non-signed document.
        if ($method === 'DELETE') {
            $did = (int)($segs[3] ?? 0);
            if ($did <= 0) Json::fail('document id required', 400);
            $row = $pdo->prepare('SELECT file_path, signed_at FROM hr_documents WHERE id = ? AND employee_id = ?');
            $row->execute([$did, $emp['id']]);
            $r = $row->fetch();
            if (!$r) Json::fail('Document not found', 404);
            if ($r['signed_at']) Json::fail('Cannot delete a signed document', 400);
            if (!empty($r['file_path'])) {
                $abs = __DIR__ . '/../../' . $r['file_path'];
                if (is_file($abs)) @unlink($abs);
            }
            $pdo->prepare('DELETE FROM hr_documents WHERE id = ? AND employee_id = ?')->execute([$did, $emp['id']]);
            Json::send(['ok' => true]);
        }
        Json::fail('Method not allowed', 405);
    }
    if ($sub === 'reviews') {
        if ($method !== 'GET') Json::fail('Method not allowed', 405);
        $stmt = $pdo->prepare('
            SELECT r.*, c.name AS cycle_name, c.period_start, c.period_end, c.due_date, c.questions_json
            FROM hr_reviews r JOIN hr_review_cycles c ON c.id = r.cycle_id
            WHERE r.employee_id = ? ORDER BY c.period_end DESC, r.id DESC');
        $stmt->execute([$emp['id']]);
        Json::send(['reviews' => $stmt->fetchAll()]);
    }
    if ($sub === 'review-respond') {
        if ($method !== 'POST') Json::fail('Method not allowed', 405);
        $rid = (int)($segs[3] ?? 0);
        if ($rid <= 0) Json::fail('review id required', 400);
        $b = Json::readBody();
        $row = $pdo->prepare('SELECT * FROM hr_reviews WHERE id = ? AND employee_id = ?');
        $row->execute([$rid, $emp['id']]);
        $rev = $row->fetch();
        if (!$rev) Json::fail('Review not found', 404);
        $sign = !empty($b['sign']);
        $newStatus = $rev['status'];
        if ($sign) $newStatus = 'manager_review';
        elseif ($rev['status'] === 'not_started') $newStatus = 'self_review';
        $pdo->prepare('UPDATE hr_reviews
            SET employee_responses_json = ?, employee_overall = ?, employee_signed_at = ?, status = ?
            WHERE id = ?')->execute([
            isset($b['responses']) ? json_encode($b['responses']) : $rev['employee_responses_json'],
            isset($b['overall']) ? (float)$b['overall'] : $rev['employee_overall'],
            $sign ? date('Y-m-d H:i:s') : $rev['employee_signed_at'],
            $newStatus,
            $rid,
        ]);
        Json::send(['ok' => true]);
    }
    if ($sub === 'learning') {
        if ($method !== 'GET') Json::fail('Method not allowed', 405);
        $stmt = $pdo->prepare('
            SELECT a.*, c.title, c.provider, c.category, c.link, c.duration_hours, c.is_required
            FROM hr_course_assignments a JOIN hr_courses c ON c.id = a.course_id
            WHERE a.employee_id = ? ORDER BY a.due_date IS NULL, a.due_date, a.id DESC');
        $stmt->execute([$emp['id']]);
        Json::send(['assignments' => $stmt->fetchAll()]);
    }
    if ($sub === 'learning-progress') {
        if ($method !== 'POST') Json::fail('Method not allowed', 405);
        $aid = (int)($segs[3] ?? 0);
        if ($aid <= 0) Json::fail('assignment id required', 400);
        $row = $pdo->prepare('SELECT * FROM hr_course_assignments WHERE id = ? AND employee_id = ?');
        $row->execute([$aid, $emp['id']]);
        $a = $row->fetch();
        if (!$a) Json::fail('Assignment not found', 404);
        $b = Json::readBody();
        $newStatus = pickEnum($b['status'] ?? null, ['not_started','in_progress','completed','expired'], $a['status']);
        $completedAt = $newStatus === 'completed' ? ($a['completed_at'] ?? date('Y-m-d H:i:s')) : null;
        $pdo->prepare('UPDATE hr_course_assignments
            SET status=?, completed_at=?, score=?, notes=?
            WHERE id = ?')->execute([
            $newStatus, $completedAt,
            isset($b['score']) ? (float)$b['score'] : $a['score'],
            array_key_exists('notes', $b) ? $b['notes'] : $a['notes'],
            $aid,
        ]);
        Json::send(['ok' => true]);
    }
    if ($sub === 'course-detail') {
        if ($method !== 'GET') Json::fail('Method not allowed', 405);
        $aid = (int)($segs[3] ?? 0);
        if ($aid <= 0) Json::fail('assignment id required', 400);
        $row = $pdo->prepare('
            SELECT a.*, c.title, c.description, c.provider, c.category, c.duration_hours, c.is_required, c.link
            FROM hr_course_assignments a JOIN hr_courses c ON c.id = a.course_id
            WHERE a.id = ? AND a.employee_id = ?');
        $row->execute([$aid, $emp['id']]);
        $a = $row->fetch();
        if (!$a) Json::fail('Assignment not found', 404);
        $modules = loadModulesForPlayer($pdo, (int)$a['course_id']);
        $progStmt = $pdo->prepare('SELECT module_id, completed_at, quiz_score, quiz_attempts
                                   FROM hr_course_module_progress WHERE assignment_id = ?');
        $progStmt->execute([$aid]);
        Json::send(['assignment' => $a, 'modules' => $modules, 'progress' => $progStmt->fetchAll()]);
    }
    if ($sub === 'course-module-complete') {
        if ($method !== 'POST') Json::fail('Method not allowed', 405);
        $aid = (int)($segs[3] ?? 0);
        $mid = (int)($segs[4] ?? 0);
        if ($aid <= 0 || $mid <= 0) Json::fail('assignment id and module id required', 400);
        $row = $pdo->prepare('SELECT * FROM hr_course_assignments WHERE id = ? AND employee_id = ?');
        $row->execute([$aid, $emp['id']]);
        $a = $row->fetch();
        if (!$a) Json::fail('Assignment not found', 404);
        $mod = moduleForCourse($pdo, $mid, (int)$a['course_id']);
        if ($mod['kind'] === 'quiz') Json::fail('Use the quiz endpoint for quiz modules', 400);
        upsertModuleProgress($pdo, $aid, $mid, ['completed_at' => date('Y-m-d H:i:s')]);
        finalizeAssignmentIfDone($pdo, $aid, (int)$a['course_id']);
        Json::send(['ok' => true]);
    }
    if ($sub === 'course-module-quiz') {
        if ($method !== 'POST') Json::fail('Method not allowed', 405);
        $aid = (int)($segs[3] ?? 0);
        $mid = (int)($segs[4] ?? 0);
        if ($aid <= 0 || $mid <= 0) Json::fail('assignment id and module id required', 400);
        $row = $pdo->prepare('SELECT * FROM hr_course_assignments WHERE id = ? AND employee_id = ?');
        $row->execute([$aid, $emp['id']]);
        $a = $row->fetch();
        if (!$a) Json::fail('Assignment not found', 404);
        $mod = moduleForCourse($pdo, $mid, (int)$a['course_id']);
        if ($mod['kind'] !== 'quiz') Json::fail('Module is not a quiz', 400);
        $b = Json::readBody();
        $answers = isset($b['answers']) && is_array($b['answers']) ? $b['answers'] : [];
        $result = scoreQuiz($mod, $answers);
        $passed = $result['score'] >= (int)$mod['pass_score'];
        upsertModuleProgress($pdo, $aid, $mid, [
            'quiz_score'    => $result['score'],
            'quiz_attempts' => 'increment',
            'completed_at'  => $passed ? date('Y-m-d H:i:s') : null,
        ]);
        if ($passed) finalizeAssignmentIfDone($pdo, $aid, (int)$a['course_id']);
        Json::send($result + ['passed' => $passed, 'pass_score' => (int)$mod['pass_score']]);
    }
    if ($sub === 'certifications') {
        if ($method === 'GET') {
            $stmt = $pdo->prepare('SELECT * FROM hr_certifications WHERE employee_id = ? ORDER BY issued_at DESC, id DESC');
            $stmt->execute([$emp['id']]);
            Json::send(['certifications' => $stmt->fetchAll()]);
        }
        Json::fail('Method not allowed', 405);
    }
    if ($sub === 'pulse-surveys') {
        if ($method !== 'GET') Json::fail('Method not allowed', 405);
        $stmt = $pdo->prepare('
            SELECT s.id, s.title, s.description, s.is_anonymous, s.questions_json, s.status, s.opens_at, s.closes_at,
                   EXISTS(SELECT 1 FROM hr_pulse_responses r WHERE r.survey_id = s.id AND r.employee_id = ?) AS already_answered
            FROM hr_pulse_surveys s
            WHERE s.status = "open"
              AND (s.opens_at IS NULL OR s.opens_at <= NOW())
              AND (s.closes_at IS NULL OR s.closes_at >= NOW())
            ORDER BY s.id DESC');
        $stmt->execute([$emp['id']]);
        Json::send(['surveys' => $stmt->fetchAll()]);
    }
    if ($sub === 'pulse-respond') {
        if ($method !== 'POST') Json::fail('Method not allowed', 405);
        $sid = (int)($segs[3] ?? 0);
        if ($sid <= 0) Json::fail('survey id required', 400);
        $b = Json::readBody();
        if (!isset($b['answers'])) Json::fail('answers required', 400);
        $survey = $pdo->prepare('SELECT is_anonymous FROM hr_pulse_surveys WHERE id = ? AND status = "open"');
        $survey->execute([$sid]);
        $sv = $survey->fetch();
        if (!$sv) Json::fail('Survey not found or closed', 404);
        $eid = !empty($sv['is_anonymous']) ? null : $emp['id'];
        $ins = $pdo->prepare('INSERT INTO hr_pulse_responses (survey_id, employee_id, answers_json) VALUES (?,?,?)');
        $ins->execute([$sid, $eid, json_encode($b['answers'])]);
        Json::send(['ok' => true], 201);
    }
    if ($sub === 'feedback') {
        if ($method === 'POST') {
            $b = Json::readBody();
            $msg = trim((string)($b['message'] ?? ''));
            if ($msg === '') Json::fail('message required', 400);
            $cat = trim((string)($b['category'] ?? 'general'));
            $eid = !empty($b['anonymous']) ? null : $emp['id'];
            $ins = $pdo->prepare('INSERT INTO hr_feedback (employee_id, category, message) VALUES (?,?,?)');
            $ins->execute([$eid, $cat ?: 'general', $msg]);
            Json::send(['id' => (int)$pdo->lastInsertId()], 201);
        }
        Json::fail('Method not allowed', 405);
    }
    if ($sub === 'change-requests') {
        if ($method === 'GET') {
            $stmt = $pdo->prepare('SELECT * FROM hr_change_requests WHERE employee_id = ? ORDER BY created_at DESC');
            $stmt->execute([$emp['id']]);
            Json::send(['requests' => $stmt->fetchAll()]);
        }
        if ($method === 'POST') {
            $b = Json::readBody();
            $field = trim((string)($b['field'] ?? ''));
            $newVal = (string)($b['new_value'] ?? '');
            $allowed = [
                'phone','address_line1','address_line2','city','region','postcode','country',
                'emergency_name','emergency_phone','emergency_rel','preferred_name','dob',
            ];
            if (!in_array($field, $allowed, true)) Json::fail('field not allowed for self-service', 400);
            $oldVal = (string)($emp[$field] ?? '');
            $ins = $pdo->prepare('INSERT INTO hr_change_requests
                (employee_id, field, old_value, new_value, note, status)
                VALUES (?,?,?,?,?, "pending")');
            $ins->execute([$emp['id'], $field, $oldVal, $newVal, $b['note'] ?? null]);
            Json::send(['id' => (int)$pdo->lastInsertId()], 201);
        }
        Json::fail('Method not allowed', 405);
    }
    // ───── Manager-Self-Service (MSS) endpoints ─────
    // All scoped to "my direct reports" — employees whose manager_id = currentEmployee.id.
    if ($sub === 'team') {
        if ($method !== 'GET') Json::fail('Method not allowed', 405);
        $stmt = $pdo->prepare('
            SELECT e.*, u.email, u.display_name
            FROM hr_employees e JOIN admin_users u ON u.id = e.admin_user_id
            WHERE e.manager_id = ? AND e.status != "terminated"
            ORDER BY e.last_name, e.first_name');
        $stmt->execute([$emp['id']]);
        Json::send(['team' => $stmt->fetchAll()]);
    }
    if ($sub === 'team-time-off') {
        if ($method !== 'GET') Json::fail('Method not allowed', 405);
        $where = 'e.manager_id = ?'; $params = [$emp['id']];
        if (!empty($_GET['status'])) { $where .= ' AND r.status = ?'; $params[] = (string)$_GET['status']; }
        $stmt = $pdo->prepare('
            SELECT r.*, e.first_name, e.last_name, e.position
            FROM hr_time_off_requests r JOIN hr_employees e ON e.id = r.employee_id
            WHERE ' . $where . '
            ORDER BY r.start_date DESC, r.id DESC');
        $stmt->execute($params);
        Json::send(['entries' => $stmt->fetchAll()]);
    }
    if ($sub === 'team-time-off-action') {
        if ($method !== 'POST') Json::fail('Method not allowed', 405);
        $rid = (int)($segs[3] ?? 0);
        if ($rid <= 0) Json::fail('request id required', 400);
        $b = Json::readBody();
        $newStatus = pickEnum($b['status'] ?? null, ['approved','denied','cancelled'], 'approved');
        $row = $pdo->prepare('
            SELECT r.*, e.manager_id FROM hr_time_off_requests r
            JOIN hr_employees e ON e.id = r.employee_id WHERE r.id = ?');
        $row->execute([$rid]);
        $r = $row->fetch();
        if (!$r) Json::fail('Request not found', 404);
        if ((int)$r['manager_id'] !== (int)$emp['id']) Json::fail('Not your direct report', 403);
        $claims = Auth::require();
        $pdo->prepare('UPDATE hr_time_off_requests SET status = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?')
            ->execute([$newStatus, (int)($claims['sub'] ?? 0) ?: null, $rid]);
        Json::send(['ok' => true]);
    }
    if ($sub === 'team-reviews') {
        if ($method !== 'GET') Json::fail('Method not allowed', 405);
        $stmt = $pdo->prepare('
            SELECT r.*, e.first_name, e.last_name, e.position,
                   c.name AS cycle_name, c.period_start, c.period_end, c.due_date, c.status AS cycle_status
            FROM hr_reviews r
            JOIN hr_employees e ON e.id = r.employee_id
            JOIN hr_review_cycles c ON c.id = r.cycle_id
            WHERE e.manager_id = ?
            ORDER BY c.period_end DESC, r.id DESC');
        $stmt->execute([$emp['id']]);
        Json::send(['reviews' => $stmt->fetchAll()]);
    }
    if ($sub === 'team-learning') {
        if ($method !== 'GET') Json::fail('Method not allowed', 405);
        $where = 'e.manager_id = ?'; $params = [$emp['id']];
        $statusFilter = (string)($_GET['status'] ?? '');
        if ($statusFilter === 'overdue') {
            $where .= ' AND a.due_date IS NOT NULL AND a.due_date < CURDATE() AND a.status != "completed"';
        } elseif (in_array($statusFilter, ['not_started','in_progress','completed','expired'], true)) {
            $where .= ' AND a.status = ?'; $params[] = $statusFilter;
        }
        $stmt = $pdo->prepare('
            SELECT a.*, e.first_name, e.last_name,
                   c.title, c.provider, c.duration_hours, c.is_required
            FROM hr_course_assignments a
            JOIN hr_employees e ON e.id = a.employee_id
            JOIN hr_courses c ON c.id = a.course_id
            WHERE ' . $where . '
            ORDER BY a.due_date IS NULL, a.due_date');
        $stmt->execute($params);
        Json::send(['assignments' => $stmt->fetchAll()]);
    }
    // ───── Goals (self) ─────
    if ($sub === 'goals') {
        $gid = (int)($segs[3] ?? 0);
        if ($gid === 0 && $method === 'GET') {
            $stmt = $pdo->prepare('SELECT * FROM hr_goals WHERE employee_id = ? ORDER BY status = "completed", due_date IS NULL, due_date');
            $stmt->execute([$emp['id']]);
            Json::send(['goals' => $stmt->fetchAll()]);
        }
        if ($gid === 0 && $method === 'POST') {
            $b = Json::readBody();
            $title = trim((string)($b['title'] ?? ''));
            if ($title === '') Json::fail('title required', 400);
            $claims = Auth::require();
            $ins = $pdo->prepare('INSERT INTO hr_goals
                (employee_id, created_by, title, description, measurable, due_date, status, progress_pct)
                VALUES (?,?,?,?,?,?,?,?)');
            $ins->execute([
                $emp['id'], (int)($claims['sub'] ?? 0) ?: null, $title,
                $b['description'] ?? null, $b['measurable'] ?? null, $b['due_date'] ?: null,
                pickEnum($b['status'] ?? null, ['not_started','in_progress','completed','cancelled'], 'not_started'),
                isset($b['progress_pct']) ? max(0, min(100, (int)$b['progress_pct'])) : 0,
            ]);
            Json::send(['id' => (int)$pdo->lastInsertId()], 201);
        }
        if ($gid > 0) {
            $row = $pdo->prepare('SELECT * FROM hr_goals WHERE id = ? AND employee_id = ?');
            $row->execute([$gid, $emp['id']]);
            $g = $row->fetch();
            if (!$g) Json::fail('Goal not found', 404);
            if ($method === 'PUT') {
                $b = Json::readBody();
                $pdo->prepare('UPDATE hr_goals
                    SET title = ?, description = ?, measurable = ?, due_date = ?, status = ?, progress_pct = ?
                    WHERE id = ?')->execute([
                    trim((string)($b['title'] ?? $g['title'])) ?: $g['title'],
                    array_key_exists('description', $b) ? $b['description'] : $g['description'],
                    array_key_exists('measurable', $b)  ? $b['measurable']  : $g['measurable'],
                    $b['due_date'] ?? $g['due_date'],
                    pickEnum($b['status'] ?? null, ['not_started','in_progress','completed','cancelled'], $g['status']),
                    isset($b['progress_pct']) ? max(0, min(100, (int)$b['progress_pct'])) : (int)$g['progress_pct'],
                    $gid,
                ]);
                Json::send(['ok' => true]);
            }
            if ($method === 'DELETE') {
                $pdo->prepare('DELETE FROM hr_goals WHERE id = ? AND employee_id = ?')->execute([$gid, $emp['id']]);
                Json::send(['ok' => true]);
            }
        }
        Json::fail('Method not allowed', 405);
    }
    // ───── Goals (manager) — direct reports only ─────
    if ($sub === 'team-goals') {
        $maybe = (int)($segs[3] ?? 0);
        if ($maybe === 0 && $method === 'GET') {
            $stmt = $pdo->prepare('
                SELECT g.*, e.first_name, e.last_name
                FROM hr_goals g JOIN hr_employees e ON e.id = g.employee_id
                WHERE e.manager_id = ?
                ORDER BY g.status = "completed", g.due_date IS NULL, g.due_date');
            $stmt->execute([$emp['id']]);
            Json::send(['goals' => $stmt->fetchAll()]);
        }
        // POST creates a goal for a direct report: /team-goals/:eid
        if ($maybe > 0 && $method === 'POST') {
            $eid = $maybe;
            $own = $pdo->prepare('SELECT id FROM hr_employees WHERE id = ? AND manager_id = ?');
            $own->execute([$eid, $emp['id']]);
            if (!$own->fetchColumn()) Json::fail('Not your direct report', 403);
            $b = Json::readBody();
            $title = trim((string)($b['title'] ?? ''));
            if ($title === '') Json::fail('title required', 400);
            $claims = Auth::require();
            $ins = $pdo->prepare('INSERT INTO hr_goals
                (employee_id, created_by, title, description, measurable, due_date, status, progress_pct)
                VALUES (?,?,?,?,?,?,?,?)');
            $ins->execute([
                $eid, (int)($claims['sub'] ?? 0) ?: null, $title,
                $b['description'] ?? null, $b['measurable'] ?? null, $b['due_date'] ?: null,
                pickEnum($b['status'] ?? null, ['not_started','in_progress','completed','cancelled'], 'not_started'),
                isset($b['progress_pct']) ? max(0, min(100, (int)$b['progress_pct'])) : 0,
            ]);
            Json::send(['id' => (int)$pdo->lastInsertId()], 201);
        }
        // PUT/DELETE on /team-goals/:gid (must belong to a direct report)
        if ($maybe > 0 && in_array($method, ['PUT','DELETE'], true) && (string)($segs[4] ?? '') === '') {
            $gid = $maybe;
            $row = $pdo->prepare('
                SELECT g.*, e.manager_id FROM hr_goals g
                JOIN hr_employees e ON e.id = g.employee_id WHERE g.id = ?');
            $row->execute([$gid]);
            $g = $row->fetch();
            if (!$g) Json::fail('Goal not found', 404);
            if ((int)$g['manager_id'] !== (int)$emp['id']) Json::fail('Not your direct report', 403);
            if ($method === 'PUT') {
                $b = Json::readBody();
                $pdo->prepare('UPDATE hr_goals
                    SET title = ?, description = ?, measurable = ?, due_date = ?, status = ?, progress_pct = ?
                    WHERE id = ?')->execute([
                    trim((string)($b['title'] ?? $g['title'])) ?: $g['title'],
                    array_key_exists('description', $b) ? $b['description'] : $g['description'],
                    array_key_exists('measurable', $b)  ? $b['measurable']  : $g['measurable'],
                    $b['due_date'] ?? $g['due_date'],
                    pickEnum($b['status'] ?? null, ['not_started','in_progress','completed','cancelled'], $g['status']),
                    isset($b['progress_pct']) ? max(0, min(100, (int)$b['progress_pct'])) : (int)$g['progress_pct'],
                    $gid,
                ]);
                Json::send(['ok' => true]);
            }
            if ($method === 'DELETE') {
                $pdo->prepare('DELETE FROM hr_goals WHERE id = ?')->execute([$gid]);
                Json::send(['ok' => true]);
            }
        }
        Json::fail('Method not allowed', 405);
    }
    // ───── Feedback / 1:1 notes ─────
    if ($sub === 'feedback-notes') {
        // GET ?employee_id=X — list notes for a direct report (or self if X = me)
        if ($method === 'GET') {
            $eid = (int)($_GET['employee_id'] ?? 0);
            if ($eid <= 0) Json::fail('employee_id required', 400);
            $isSelf = $eid === (int)$emp['id'];
            if (!$isSelf) {
                $own = $pdo->prepare('SELECT id FROM hr_employees WHERE id = ? AND manager_id = ?');
                $own->execute([$eid, $emp['id']]);
                if (!$own->fetchColumn()) Json::fail('Not your direct report', 403);
            }
            $sql = 'SELECT n.*, u.display_name AS author_name, u.email AS author_email
                    FROM hr_feedback_notes n LEFT JOIN admin_users u ON u.id = n.author_id
                    WHERE n.employee_id = ?'
                . ($isSelf ? ' AND n.visibility = "shared"' : '')
                . ' ORDER BY n.meeting_date DESC, n.created_at DESC, n.id DESC';
            $stmt = $pdo->prepare($sql); $stmt->execute([$eid]);
            Json::send(['notes' => $stmt->fetchAll()]);
        }
        if ($method === 'POST') {
            $eid = (int)($segs[3] ?? 0);
            if ($eid <= 0) Json::fail('employee id required', 400);
            $own = $pdo->prepare('SELECT id FROM hr_employees WHERE id = ? AND manager_id = ?');
            $own->execute([$eid, $emp['id']]);
            if (!$own->fetchColumn()) Json::fail('Not your direct report', 403);
            $b = Json::readBody();
            $body = trim((string)($b['body'] ?? ''));
            if ($body === '') Json::fail('body required', 400);
            $claims = Auth::require();
            $ins = $pdo->prepare('INSERT INTO hr_feedback_notes
                (employee_id, author_id, kind, body, meeting_date, visibility) VALUES (?,?,?,?,?,?)');
            $ins->execute([
                $eid, (int)($claims['sub'] ?? 0) ?: null,
                pickEnum($b['kind'] ?? null, ['feedback','one_on_one','coaching','recognition'], 'one_on_one'),
                $body,
                $b['meeting_date'] ?: null,
                pickEnum($b['visibility'] ?? null, ['private','shared'], 'shared'),
            ]);
            Json::send(['id' => (int)$pdo->lastInsertId()], 201);
        }
        if ($method === 'DELETE') {
            $nid = (int)($segs[3] ?? 0);
            if ($nid <= 0) Json::fail('note id required', 400);
            $row = $pdo->prepare('
                SELECT n.*, e.manager_id FROM hr_feedback_notes n
                JOIN hr_employees e ON e.id = n.employee_id WHERE n.id = ?');
            $row->execute([$nid]);
            $n = $row->fetch();
            if (!$n) Json::fail('Note not found', 404);
            if ((int)$n['manager_id'] !== (int)$emp['id']) Json::fail('Not your direct report', 403);
            $pdo->prepare('DELETE FROM hr_feedback_notes WHERE id = ?')->execute([$nid]);
            Json::send(['ok' => true]);
        }
        Json::fail('Method not allowed', 405);
    }
    // ───── Compliance alerts (manager) ─────
    // ───── Skills catalogue (HR-managed, all managers can read it) ─────
    if ($sub === 'skills') {
        $sid = (int)($segs[3] ?? 0);
        if ($sid === 0 && $method === 'GET') {
            $stmt = $pdo->query('SELECT * FROM hr_skills ORDER BY category, name');
            Json::send(['skills' => $stmt->fetchAll()]);
        }
        if ($sid === 0 && $method === 'POST') {
            $b = Json::readBody();
            $name = trim((string)($b['name'] ?? ''));
            if ($name === '') Json::fail('name required', 400);
            $ins = $pdo->prepare('INSERT INTO hr_skills (name, category, description) VALUES (?,?,?)');
            try { $ins->execute([$name, $b['category'] ?? null, $b['description'] ?? null]); }
            catch (\PDOException $e) { Json::fail('A skill with that name already exists', 409); }
            Json::send(['id' => (int)$pdo->lastInsertId()], 201);
        }
        if ($sid > 0 && $method === 'DELETE') {
            $pdo->prepare('DELETE FROM hr_skills WHERE id = ?')->execute([$sid]);
            Json::send(['ok' => true]);
        }
        Json::fail('Method not allowed', 405);
    }
    // ───── Self skills assessment ─────
    // GET — list all of the current employee's skill rows (joined with the catalog).
    // POST — upsert one (skill_id required); employee self-assesses current/target/notes.
    // DELETE /:skillId — remove one of their own skill rows.
    // Manager team-skills upsert still wins because it last-writes the assessed_at.
    if ($sub === 'my-skills') {
        if ($method === 'GET') {
            $stmt = $pdo->prepare('
                SELECT s.id, s.employee_id, s.skill_id, s.current_level, s.target_level, s.notes, s.assessed_at,
                       sk.name AS skill_name, sk.category
                FROM hr_employee_skills s
                JOIN hr_skills sk ON sk.id = s.skill_id
                WHERE s.employee_id = ?
                ORDER BY sk.category, sk.name');
            $stmt->execute([$emp['id']]);
            Json::send(['rows' => $stmt->fetchAll()]);
        }
        if ($method === 'POST') {
            $b = Json::readBody();
            $sid  = (int)($b['skill_id'] ?? 0);
            $name = trim((string)($b['skill_name'] ?? ''));
            $cat  = trim((string)($b['category'] ?? '')) ?: null;

            // Resolve to a catalog row id. If skill_name is given and the name
            // doesn't exist yet, auto-create it so employees can self-assess
            // skills HR hasn't formally catalogued.
            if ($sid <= 0 && $name !== '') {
                $look = $pdo->prepare('SELECT id FROM hr_skills WHERE LOWER(name) = LOWER(?)');
                $look->execute([$name]);
                $sid = (int)($look->fetchColumn() ?: 0);
                if ($sid === 0) {
                    $ins = $pdo->prepare('INSERT INTO hr_skills (name, category) VALUES (?, ?)');
                    $ins->execute([$name, $cat]);
                    $sid = (int)$pdo->lastInsertId();
                }
            }
            if ($sid <= 0) Json::fail('skill_id or skill_name required', 400);

            // Confirm the skill exists in the catalog (covers the skill_id-only case).
            $exists = $pdo->prepare('SELECT id FROM hr_skills WHERE id = ?');
            $exists->execute([$sid]);
            if (!$exists->fetchColumn()) Json::fail('Skill not found', 404);

            $current = max(0, min(5, (int)($b['current_level'] ?? 0)));
            $target  = max(0, min(5, (int)($b['target_level']  ?? 0)));
            $pdo->prepare('INSERT INTO hr_employee_skills
                (employee_id, skill_id, current_level, target_level, notes, assessed_at)
                VALUES (?,?,?,?,?, NOW())
                ON DUPLICATE KEY UPDATE
                    current_level = VALUES(current_level),
                    target_level  = VALUES(target_level),
                    notes         = VALUES(notes),
                    assessed_at   = NOW()')
                ->execute([$emp['id'], $sid, $current, $target, $b['notes'] ?? null]);
            Json::send(['ok' => true, 'skill_id' => $sid]);
        }
        if ($method === 'DELETE') {
            $skid = (int)($segs[3] ?? 0);
            if ($skid <= 0) Json::fail('skill id required', 400);
            $pdo->prepare('DELETE FROM hr_employee_skills WHERE employee_id = ? AND skill_id = ?')
                ->execute([$emp['id'], $skid]);
            Json::send(['ok' => true]);
        }
        Json::fail('Method not allowed', 405);
    }
    if ($sub === 'team-skills') {
        if ($method === 'GET') {
            $stmt = $pdo->prepare('
                SELECT s.id, s.employee_id, s.skill_id, s.current_level, s.target_level, s.notes, s.assessed_at,
                       sk.name AS skill_name, sk.category, e.first_name, e.last_name
                FROM hr_employee_skills s
                JOIN hr_skills sk ON sk.id = s.skill_id
                JOIN hr_employees e ON e.id = s.employee_id
                WHERE e.manager_id = ?
                ORDER BY e.last_name, e.first_name, sk.category, sk.name');
            $stmt->execute([$emp['id']]);
            Json::send(['rows' => $stmt->fetchAll()]);
        }
        // POST /:eid — upsert a single (employee, skill) pair for a direct report.
        $eid = (int)($segs[3] ?? 0);
        if ($eid > 0 && $method === 'POST') {
            $own = $pdo->prepare('SELECT id FROM hr_employees WHERE id = ? AND manager_id = ?');
            $own->execute([$eid, $emp['id']]);
            if (!$own->fetchColumn()) Json::fail('Not your direct report', 403);
            $b = Json::readBody();
            $sid = (int)($b['skill_id'] ?? 0);
            if ($sid <= 0) Json::fail('skill_id required', 400);
            $current = max(0, min(5, (int)($b['current_level'] ?? 0)));
            $target  = max(0, min(5, (int)($b['target_level']  ?? 0)));
            $pdo->prepare('INSERT INTO hr_employee_skills
                (employee_id, skill_id, current_level, target_level, notes, assessed_at)
                VALUES (?,?,?,?,?, NOW())
                ON DUPLICATE KEY UPDATE
                    current_level = VALUES(current_level),
                    target_level  = VALUES(target_level),
                    notes         = VALUES(notes),
                    assessed_at   = NOW()')
                ->execute([$eid, $sid, $current, $target, $b['notes'] ?? null]);
            Json::send(['ok' => true]);
        }
        if ($eid > 0 && $method === 'DELETE') {
            // /:eid/:skillId
            $skid = (int)($segs[4] ?? 0);
            if ($skid <= 0) Json::fail('skill id required', 400);
            $own = $pdo->prepare('SELECT id FROM hr_employees WHERE id = ? AND manager_id = ?');
            $own->execute([$eid, $emp['id']]);
            if (!$own->fetchColumn()) Json::fail('Not your direct report', 403);
            $pdo->prepare('DELETE FROM hr_employee_skills WHERE employee_id = ? AND skill_id = ?')
                ->execute([$eid, $skid]);
            Json::send(['ok' => true]);
        }
        Json::fail('Method not allowed', 405);
    }
    // ───── Hiring (manager-scoped) ─────
    if ($sub === 'team-hiring') {
        if ($method !== 'GET') Json::fail('Method not allowed', 405);
        $jobs = $pdo->prepare('
            SELECT j.*, m.first_name AS hm_first, m.last_name AS hm_last,
                   (SELECT COUNT(*) FROM hr_applications a WHERE a.job_id = j.id) AS app_count,
                   (SELECT COUNT(*) FROM hr_applications a WHERE a.job_id = j.id AND a.stage NOT IN ("hired","rejected")) AS active_count
            FROM hr_jobs j
            LEFT JOIN hr_employees m ON m.id = j.hiring_manager_id
            WHERE j.hiring_manager_id = ?
            ORDER BY j.status = "open" DESC, j.posted_at DESC, j.id DESC');
        $jobs->execute([$emp['id']]);
        $jobsRows = $jobs->fetchAll();
        $apps = $pdo->prepare('
            SELECT a.*, c.first_name AS c_first, c.last_name AS c_last, c.email, j.title AS job_title
            FROM hr_applications a
            JOIN hr_candidates c ON c.id = a.candidate_id
            JOIN hr_jobs j ON j.id = a.job_id
            WHERE j.hiring_manager_id = ?
            ORDER BY a.applied_at DESC, a.id DESC');
        $apps->execute([$emp['id']]);
        Json::send(['jobs' => $jobsRows, 'applications' => $apps->fetchAll()]);
    }
    if ($sub === 'team-hiring-feedback') {
        // POST /:applicationId — append interview feedback for a manager-owned application.
        if ($method !== 'POST') Json::fail('Method not allowed', 405);
        $aid = (int)($segs[3] ?? 0);
        if ($aid <= 0) Json::fail('application id required', 400);
        $own = $pdo->prepare('
            SELECT j.hiring_manager_id FROM hr_applications a
            JOIN hr_jobs j ON j.id = a.job_id WHERE a.id = ?');
        $own->execute([$aid]);
        $hm = $own->fetchColumn();
        if ($hm === false) Json::fail('Application not found', 404);
        if ((int)$hm !== (int)$emp['id']) Json::fail('Not your application', 403);
        $b = Json::readBody();
        $body = trim((string)($b['feedback'] ?? ''));
        if ($body === '') Json::fail('feedback required', 400);
        $rating = isset($b['rating']) ? max(1, min(5, (int)$b['rating'])) : null;
        $claims = Auth::require();
        $ins = $pdo->prepare('INSERT INTO hr_interviews
            (application_id, scheduled_at, kind, interviewer_id, feedback, rating)
            VALUES (?, NOW(), ?, ?, ?, ?)');
        $ins->execute([
            $aid,
            pickEnum($b['kind'] ?? null, ['phone','video','onsite','technical','culture','panel','other'], 'other'),
            (int)($claims['sub'] ?? 0) ?: null,
            $body,
            $rating,
        ]);
        Json::send(['id' => (int)$pdo->lastInsertId()], 201);
    }
    if ($sub === 'team-hiring-stage') {
        // POST /:applicationId — move application stage (manager only)
        if ($method !== 'POST') Json::fail('Method not allowed', 405);
        $aid = (int)($segs[3] ?? 0);
        if ($aid <= 0) Json::fail('application id required', 400);
        $own = $pdo->prepare('
            SELECT j.hiring_manager_id FROM hr_applications a
            JOIN hr_jobs j ON j.id = a.job_id WHERE a.id = ?');
        $own->execute([$aid]);
        $hm = $own->fetchColumn();
        if ($hm === false) Json::fail('Application not found', 404);
        if ((int)$hm !== (int)$emp['id']) Json::fail('Not your application', 403);
        $b = Json::readBody();
        $stage = pickEnum($b['stage'] ?? null, ['applied','screening','interview','offer','hired','rejected'], 'applied');
        $decided = in_array($stage, ['hired','rejected'], true) ? 'NOW()' : 'NULL';
        $pdo->prepare("UPDATE hr_applications SET stage = ?, decided_at = $decided WHERE id = ?")
            ->execute([$stage, $aid]);
        Json::send(['ok' => true]);
    }

    // ───── Succession (manager-scoped) ─────
    if ($sub === 'team-succession') {
        if ($method !== 'GET') Json::fail('Method not allowed', 405);
        $stmt = $pdo->prepare('
            SELECT p.id, p.key_role, p.risk_level, p.notes, p.current_holder_id,
                   inc.first_name AS holder_first, inc.last_name AS holder_last,
                   inc.manager_id  AS holder_manager_id
            FROM hr_succession_plans p
            LEFT JOIN hr_employees inc ON inc.id = p.current_holder_id
            WHERE inc.manager_id = ?
               OR EXISTS (
                   SELECT 1 FROM hr_succession_candidates sc
                   JOIN hr_employees ce ON ce.id = sc.employee_id
                   WHERE sc.plan_id = p.id AND ce.manager_id = ?
               )
            ORDER BY FIELD(p.risk_level, "high","medium","low"), p.key_role');
        $stmt->execute([$emp['id'], $emp['id']]);
        $plans = $stmt->fetchAll();
        if (!empty($plans)) {
            $ids = array_map(fn($p) => (int)$p['id'], $plans);
            $place = implode(',', array_fill(0, count($ids), '?'));
            $cs = $pdo->prepare('
                SELECT sc.*, e.first_name, e.last_name, e.position, e.manager_id
                FROM hr_succession_candidates sc
                JOIN hr_employees e ON e.id = sc.employee_id
                WHERE sc.plan_id IN (' . $place . ')
                ORDER BY FIELD(sc.readiness, "now","1-2y","3-5y"), e.last_name');
            $cs->execute($ids);
            $cands = $cs->fetchAll();
            $byPlan = [];
            foreach ($cands as $c) { $byPlan[(int)$c['plan_id']][] = $c; }
            foreach ($plans as &$p) { $p['candidates'] = $byPlan[(int)$p['id']] ?? []; }
            unset($p);
        }
        Json::send(['plans' => $plans]);
    }

    // ───── Schedule / shifts ─────
    if ($sub === 'shifts') {
        // Employee self-service: GET own shifts.
        if ($method !== 'GET') Json::fail('Method not allowed', 405);
        $stmt = $pdo->prepare('SELECT * FROM hr_shifts WHERE employee_id = ? ORDER BY shift_date DESC, start_time DESC');
        $stmt->execute([$emp['id']]);
        Json::send(['shifts' => $stmt->fetchAll()]);
    }
    if ($sub === 'team-shifts') {
        if ($method === 'GET') {
            // ?from=YYYY-MM-DD&to=YYYY-MM-DD
            $where = 'e.manager_id = ?'; $params = [$emp['id']];
            if (!empty($_GET['from'])) { $where .= ' AND s.shift_date >= ?'; $params[] = $_GET['from']; }
            if (!empty($_GET['to']))   { $where .= ' AND s.shift_date <= ?'; $params[] = $_GET['to']; }
            $stmt = $pdo->prepare('
                SELECT s.*, e.first_name, e.last_name
                FROM hr_shifts s JOIN hr_employees e ON e.id = s.employee_id
                WHERE ' . $where . '
                ORDER BY s.shift_date, s.start_time');
            $stmt->execute($params);
            Json::send(['shifts' => $stmt->fetchAll()]);
        }
        if ($method === 'POST' && !isset($segs[3])) {
            $b = Json::readBody();
            $eid = (int)($b['employee_id'] ?? 0);
            if ($eid <= 0) Json::fail('employee_id required', 400);
            $own = $pdo->prepare('SELECT id FROM hr_employees WHERE id = ? AND manager_id = ?');
            $own->execute([$eid, $emp['id']]);
            if (!$own->fetchColumn()) Json::fail('Not your direct report', 403);
            if (empty($b['shift_date']) || empty($b['start_time']) || empty($b['end_time'])) {
                Json::fail('shift_date, start_time, end_time required', 400);
            }
            $claims = Auth::require();
            $ins = $pdo->prepare('INSERT INTO hr_shifts
                (employee_id, created_by, shift_date, start_time, end_time, role, location, notes)
                VALUES (?,?,?,?,?,?,?,?)');
            $ins->execute([
                $eid, (int)($claims['sub'] ?? 0) ?: null,
                $b['shift_date'], $b['start_time'], $b['end_time'],
                $b['role'] ?? null, $b['location'] ?? null, $b['notes'] ?? null,
            ]);
            Json::send(['id' => (int)$pdo->lastInsertId()], 201);
        }
        $sid = (int)($segs[3] ?? 0);
        if ($sid > 0 && in_array($method, ['PUT','DELETE'], true)) {
            $row = $pdo->prepare('
                SELECT s.*, e.manager_id FROM hr_shifts s
                JOIN hr_employees e ON e.id = s.employee_id WHERE s.id = ?');
            $row->execute([$sid]);
            $sh = $row->fetch();
            if (!$sh) Json::fail('Shift not found', 404);
            if ((int)$sh['manager_id'] !== (int)$emp['id']) Json::fail('Not your direct report', 403);
            if ($method === 'PUT') {
                $b = Json::readBody();
                $pdo->prepare('UPDATE hr_shifts
                    SET shift_date = ?, start_time = ?, end_time = ?, role = ?, location = ?, notes = ?, status = ?
                    WHERE id = ?')->execute([
                    $b['shift_date'] ?? $sh['shift_date'],
                    $b['start_time'] ?? $sh['start_time'],
                    $b['end_time']   ?? $sh['end_time'],
                    array_key_exists('role', $b) ? $b['role'] : $sh['role'],
                    array_key_exists('location', $b) ? $b['location'] : $sh['location'],
                    array_key_exists('notes', $b) ? $b['notes'] : $sh['notes'],
                    pickEnum($b['status'] ?? null, ['scheduled','swap_requested','swapped','cancelled'], $sh['status']),
                    $sid,
                ]);
                Json::send(['ok' => true]);
            }
            if ($method === 'DELETE') {
                $pdo->prepare('DELETE FROM hr_shifts WHERE id = ?')->execute([$sid]);
                Json::send(['ok' => true]);
            }
        }
        Json::fail('Method not allowed', 405);
    }
    if ($sub === 'team-certifications') {
        if ($method !== 'GET') Json::fail('Method not allowed', 405);
        $stmt = $pdo->prepare('
            SELECT c.*, e.first_name, e.last_name
            FROM hr_certifications c JOIN hr_employees e ON e.id = c.employee_id
            WHERE e.manager_id = ?
            ORDER BY c.expires_at IS NULL, c.expires_at');
        $stmt->execute([$emp['id']]);
        Json::send(['certifications' => $stmt->fetchAll()]);
    }
    if ($sub === 'sign') {
        if ($method !== 'POST') Json::fail('Method not allowed', 405);
        $did = (int)($segs[3] ?? 0);
        if ($did <= 0) Json::fail('document id required', 400);

        // Multipart variant: client renders the signed PDF in-browser and uploads
        // it alongside the signature image. We replace the row's file_path so the
        // employee always sees their signed copy on view / download.
        $isMultipart = !empty($_FILES) || !empty($_POST);
        if ($isMultipart) {
            $sig = (string)($_POST['signature_data'] ?? '');
            if ($sig === '' || strpos($sig, 'data:image') !== 0) Json::fail('signature_data required', 400);
            $row = $pdo->prepare('SELECT id, file_path FROM hr_documents WHERE id = ? AND employee_id = ?');
            $row->execute([$did, $emp['id']]);
            $cur = $row->fetch();
            if (!$cur) Json::fail('Document not found', 404);
            $newPath = $cur['file_path'];
            $newSize = null; $newMime = null;
            if (!empty($_FILES['signed_pdf'])) {
                $f = $_FILES['signed_pdf'];
                if ($f['error'] !== UPLOAD_ERR_OK) Json::fail('upload failed (code ' . $f['error'] . ')', 400);
                $dir = __DIR__ . '/../../uploads/hr/' . $emp['id'];
                if (!is_dir($dir)) @mkdir($dir, 0775, true);
                $fname = time() . '_signed_' . preg_replace('/[^A-Za-z0-9._-]+/', '_', basename($f['name']));
                $dest = $dir . '/' . $fname;
                if (!move_uploaded_file($f['tmp_name'], $dest)) Json::fail('failed to save signed copy', 500);
                $newPath = 'uploads/hr/' . $emp['id'] . '/' . $fname;
                $newSize = (int)$f['size'];
                $newMime = $f['type'] ?? 'application/pdf';
            }
            $claims = Auth::require();
            $pdo->prepare('UPDATE hr_documents
                SET signed_at = NOW(), signed_by = ?, signature_data = ?,
                    file_path = ?, file_size = COALESCE(?, file_size), mime_type = COALESCE(?, mime_type)
                WHERE id = ?')
                ->execute([(int)($claims['sub'] ?? 0) ?: null, $sig, $newPath, $newSize, $newMime, $did]);
            Json::send(['ok' => true, 'file_path' => $newPath]);
        }

        $b = Json::readBody();
        $sig = (string)($b['signature_data'] ?? '');
        if ($sig === '' || strpos($sig, 'data:image') !== 0) Json::fail('signature_data (data: URL) required', 400);

        $row = $pdo->prepare('SELECT id FROM hr_documents WHERE id = ? AND employee_id = ?');
        $row->execute([$did, $emp['id']]);
        if (!$row->fetch()) Json::fail('Document not found', 404);

        $claims = Auth::require();
        $pdo->prepare('UPDATE hr_documents SET signed_at = NOW(), signed_by = ?, signature_data = ? WHERE id = ?')
            ->execute([(int)($claims['sub'] ?? 0) ?: null, $sig, $did]);
        Json::send(['ok' => true]);
    }
    Json::fail('Not found', 404);
}

function handleEmployees(\PDO|\BRS\TenantPdo $pdo, string $method, array $segs): void {
    if (isset($segs[2]) && isset($segs[3])) {
        $eid = (int)$segs[2];
        if ($segs[3] === 'onboarding')     { handleOnboarding($pdo, $method, $segs, $eid);     return; }
        if ($segs[3] === 'verify-section') { handleVerifySection($pdo, $method, $segs, $eid);  return; }
        if ($segs[3] === 'reject-section') { handleRejectSection($pdo, $method, $segs, $eid);  return; }
        if ($segs[3] === 'documents')      { handleDocuments($pdo, $method, $segs, $eid);      return; }
        if ($segs[3] === 'pto')            { handlePto($pdo, $method, $segs, $eid);            return; }
        if ($segs[3] === 'learning')       { handleEmpLearning($pdo, $method, $segs, $eid);    return; }
        if ($segs[3] === 'certifications') { handleCertifications($pdo, $method, $segs, $eid); return; }
        if ($segs[3] === 'notes')          { handleEmployeeNotes($pdo, $method, $segs, $eid);  return; }
        if ($segs[3] === 'references')     { handleEmpReferences($pdo, $method, $segs, $eid);  return; }
        Json::fail('Not found', 404);
    }

    if (!isset($segs[2])) {
        if ($method === 'GET') {
            // Hard upper bound — see clients.php for rationale. The full
            // employee row is needed by `/hr/onboarding` (PII review),
            // hence `e.*` rather than an explicit column list.
            $stmt = $pdo->query('
                SELECT e.*, u.email, u.display_name, u.role,
                       m.first_name AS manager_first_name, m.last_name AS manager_last_name
                FROM hr_employees e
                JOIN admin_users u   ON u.id = e.admin_user_id
                LEFT JOIN hr_employees m ON m.id = e.manager_id
                ORDER BY e.last_name, e.first_name
                LIMIT 1000
            ');
            Json::send(['employees' => $stmt->fetchAll()]);
        }
        if ($method === 'POST') {
            $b = Json::readBody();
            $userId    = (int)($b['admin_user_id'] ?? 0);
            $firstName = trim((string)($b['first_name'] ?? ''));
            $lastName  = trim((string)($b['last_name'] ?? ''));
            $email     = trim((string)($b['email'] ?? ''));
            if ($firstName === '')    Json::fail('first_name required', 400);
            if ($lastName === '')     Json::fail('last_name required', 400);

            // Auto-create the system user when no admin_user_id is supplied (the standard path).
            $tempPassword = null;
            if ($userId <= 0) {
                if (!filter_var($email, FILTER_VALIDATE_EMAIL)) Json::fail('Valid email required', 400);
                $existsUser = $pdo->prepare('SELECT id FROM admin_users WHERE email = ?');
                $existsUser->execute([$email]);
                $existingUserId = (int)$existsUser->fetchColumn();
                if ($existingUserId) {
                    $userId = $existingUserId;
                } else {
                    $tempPassword = bin2hex(random_bytes(6));
                    $hash = password_hash($tempPassword, PASSWORD_DEFAULT);
                    $role = pickEnum($b['role'] ?? null, ['admin','member','viewer'], 'member');
                    $insUser = $pdo->prepare('INSERT INTO admin_users (email, display_name, password_hash, role, is_active)
                                              VALUES (?,?,?,?,1)');
                    $insUser->execute([$email, trim($firstName . ' ' . $lastName), $hash, $role]);
                    $userId = (int)$pdo->lastInsertId();
                }
            }

            $exists = $pdo->prepare('SELECT id FROM hr_employees WHERE admin_user_id = ?');
            $exists->execute([$userId]);
            if ($exists->fetch()) Json::fail('That user already has an employee record', 409);

            $onboardingToken = bin2hex(random_bytes(16));

            $ins = $pdo->prepare('INSERT INTO hr_employees
                (admin_user_id, onboarding_token,
                 first_name, last_name, preferred_name, dob, phone,
                 address_line1, address_line2, city, region, postcode, country,
                 emergency_name, emergency_phone, emergency_rel,
                 position, department, employment_type, manager_id,
                 hire_date, status,
                 salary_amount, salary_currency, salary_period, pto_days_year, notes)
                VALUES (?,?, ?,?,?,?,?,?, ?,?,?,?,?,?, ?,?,?, ?,?,?,?, ?,?, ?,?,?,?,?)');
            $ins->execute([
                $userId, $onboardingToken, $firstName, $lastName,
                $b['preferred_name']  ?? null,
                $b['dob']             ?: null,
                $b['phone']           ?? null,
                $b['address_line1']   ?? null, $b['address_line2'] ?? null,
                $b['city'] ?? null, $b['region'] ?? null, $b['postcode'] ?? null, $b['country'] ?? null,
                $b['emergency_name'] ?? null, $b['emergency_phone'] ?? null, $b['emergency_rel'] ?? null,
                $b['position']  ?? null, $b['department'] ?? null,
                pickEnum($b['employment_type'] ?? null, ['full_time','part_time','contractor','intern'], 'full_time'),
                !empty($b['manager_id']) ? (int)$b['manager_id'] : null,
                $b['hire_date'] ?: null,
                pickEnum($b['status'] ?? null, ['onboarding','active','on_leave','terminated'], 'onboarding'),
                isset($b['salary_amount']) ? (float)$b['salary_amount'] : null,
                $b['salary_currency'] ?? 'GBP',
                pickEnum($b['salary_period'] ?? null, ['hourly','monthly','annual'], 'annual'),
                isset($b['pto_days_year']) ? (float)$b['pto_days_year'] : 25,
                $b['notes'] ?? null,
            ]);
            $newId = (int)$pdo->lastInsertId();
            $pdo->prepare('INSERT INTO hr_employment_history (employee_id, effective_date, event_type, new_value)
                           VALUES (?, ?, "hired", ?)')
                ->execute([$newId, $b['hire_date'] ?: date('Y-m-d'), $b['position'] ?? '']);

            // Seed the default onboarding checklist so the portal has something on day one.
            $defaults = $pdo->query('SELECT title, description, category, linked_section, sort_order FROM hr_default_onboarding_tasks ORDER BY sort_order, id')->fetchAll();
            $taskIns = $pdo->prepare('INSERT INTO hr_onboarding_tasks
                (employee_id, title, description, category, linked_section, sort_order) VALUES (?,?,?,?,?,?)');
            foreach ($defaults as $dt) {
                $taskIns->execute([$newId, $dt['title'], $dt['description'], $dt['category'], $dt['linked_section'], (int)$dt['sort_order']]);
            }

            // Auto-enroll in any company-wide and matching-department course assignments
            // so new hires automatically pick up the org's required learning.
            syncScopedCourseAssignments($pdo, $newId, $b['department'] ?? null);

            // Fan out every existing signed-document and contract template
            // targeting employees to this new hire as a pending row, so they
            // see it in their Documents tab / onboarding portal.
            // (Templates with audience != 'employee' are skipped — they
            // belong to clients / partners / etc.) Signed docs ride the same
            // path as contracts because audience defaulted to 'employee'
            // pre-076 and stays there for non-contract kinds.
            $tpls = $pdo->query("SELECT id, name, kind, template_path, template_mime, template_size
                                 FROM hr_document_types
                                 WHERE kind IN ('signed','contract')
                                   AND audience = 'employee'
                                   AND template_path IS NOT NULL")->fetchAll();
            if ($tpls) {
                $tplIns = $pdo->prepare('INSERT INTO hr_documents
                    (employee_id, doc_type_id, category, title, file_path, file_size, mime_type, requires_signature, uploaded_by)
                    VALUES (?,?,?,?,?,?,?,1,NULL)');
                foreach ($tpls as $t) {
                    $cat = ($t['kind'] === 'contract') ? 'contract' : 'signed';
                    $tplIns->execute([$newId, (int)$t['id'], $cat, $t['name'],
                        $t['template_path'], $t['template_size'] !== null ? (int)$t['template_size'] : null,
                        $t['template_mime']]);
                }
            }

            $resp = ['id' => $newId, 'admin_user_id' => $userId];
            if ($tempPassword !== null) $resp['temp_password'] = $tempPassword;
            Json::send($resp, 201);
        }
        Json::fail('Method not allowed', 405);
    }

    $id  = (int)$segs[2];
    $row = $pdo->prepare('
        SELECT e.*, u.email, u.display_name, u.role
        FROM hr_employees e JOIN admin_users u ON u.id = e.admin_user_id
        WHERE e.id = ?');
    $row->execute([$id]);
    $emp = $row->fetch();
    if (!$emp) Json::fail('Employee not found', 404);

    if ($method === 'GET') Json::send(['employee' => $emp]);
    if ($method === 'PUT') {
        $b = Json::readBody();
        $merge = function (string $k, $current) use ($b) {
            return array_key_exists($k, $b) ? $b[$k] : $current;
        };
        $newPos    = $merge('position', $emp['position']);
        $newSal    = isset($b['salary_amount']) ? (float)$b['salary_amount'] : (float)$emp['salary_amount'];
        $newStatus = pickEnum($merge('status', $emp['status']), ['onboarding','active','on_leave','terminated'], $emp['status']);
        $newType   = pickEnum($merge('employment_type', $emp['employment_type']), ['full_time','part_time','contractor','intern'], $emp['employment_type']);
        $newPer    = pickEnum($merge('salary_period', $emp['salary_period']), ['hourly','monthly','annual'], $emp['salary_period']);

        $newPlan   = pickEnum($merge('student_loan_plan', $emp['student_loan_plan'] ?? 'none'),
            ['none','plan_1','plan_2','plan_4','postgraduate'], $emp['student_loan_plan'] ?? 'none');

        $clamp = fn($v, $min, $max) => max($min, min($max, (float)$v));
        $newEmpPct = isset($b['pension_employee_pct']) ? $clamp($b['pension_employee_pct'], 0, 14) : (float)($emp['pension_employee_pct'] ?? 5);
        // Employer simply matches the employee contribution — kept in lock-step.
        $newErPct  = $newEmpPct;

        $pdo->prepare('UPDATE hr_employees SET
            first_name=?, last_name=?, preferred_name=?, dob=?, phone=?,
            address_line1=?, address_line2=?, city=?, region=?, postcode=?, country=?,
            emergency_name=?, emergency_phone=?, emergency_rel=?,
            position=?, department=?, employment_type=?, manager_id=?,
            hire_date=?, end_date=?, status=?,
            salary_amount=?, salary_currency=?, salary_period=?, pto_days_year=?, notes=?,
            tax_code=?, national_insurance_number=?, student_loan_plan=?, pension_opt_in=?,
            pension_employee_pct=?, pension_employer_pct=?,
            bank_name=?, bank_account_name=?, sort_code=?, account_number=?
            WHERE id = ?')->execute([
            $merge('first_name', $emp['first_name']), $merge('last_name', $emp['last_name']),
            $merge('preferred_name', $emp['preferred_name']),
            $merge('dob', $emp['dob']) ?: null,
            $merge('phone', $emp['phone']),
            $merge('address_line1', $emp['address_line1']), $merge('address_line2', $emp['address_line2']),
            $merge('city', $emp['city']), $merge('region', $emp['region']),
            $merge('postcode', $emp['postcode']), $merge('country', $emp['country']),
            $merge('emergency_name', $emp['emergency_name']), $merge('emergency_phone', $emp['emergency_phone']),
            $merge('emergency_rel', $emp['emergency_rel']),
            $newPos, $merge('department', $emp['department']),
            $newType,
            !empty($b['manager_id']) ? (int)$b['manager_id'] : (array_key_exists('manager_id', $b) ? null : $emp['manager_id']),
            $merge('hire_date', $emp['hire_date']) ?: null,
            $merge('end_date', $emp['end_date']) ?: null,
            $newStatus,
            isset($b['salary_amount']) ? $newSal : $emp['salary_amount'],
            $merge('salary_currency', $emp['salary_currency']),
            $newPer,
            isset($b['pto_days_year']) ? (float)$b['pto_days_year'] : (float)$emp['pto_days_year'],
            $merge('notes', $emp['notes']),
            $merge('tax_code', $emp['tax_code'] ?? null),
            $merge('national_insurance_number', $emp['national_insurance_number'] ?? null),
            $newPlan,
            isset($b['pension_opt_in']) ? (int)!!$b['pension_opt_in'] : (int)($emp['pension_opt_in'] ?? 1),
            $newEmpPct,
            $newErPct,
            $merge('bank_name', $emp['bank_name'] ?? null),
            $merge('bank_account_name', $emp['bank_account_name'] ?? null),
            $merge('sort_code', $emp['sort_code'] ?? null),
            $merge('account_number', $emp['account_number'] ?? null),
            $id,
        ]);

        $today = date('Y-m-d');
        if ($newPos !== $emp['position']) {
            $pdo->prepare('INSERT INTO hr_employment_history (employee_id, effective_date, event_type, old_value, new_value)
                           VALUES (?,?,"title_change",?,?)')->execute([$id, $today, $emp['position'], $newPos]);
        }
        if ((float)$newSal !== (float)$emp['salary_amount']) {
            $pdo->prepare('INSERT INTO hr_employment_history (employee_id, effective_date, event_type, old_value, new_value)
                           VALUES (?,?,"salary_change",?,?)')->execute([$id, $today, (string)$emp['salary_amount'], (string)$newSal]);
        }
        if ($newStatus !== $emp['status']) {
            $pdo->prepare('INSERT INTO hr_employment_history (employee_id, effective_date, event_type, old_value, new_value)
                           VALUES (?,?,"status_change",?,?)')->execute([$id, $today, $emp['status'], $newStatus]);
        }

        // If the department changed, pick up the new department's company / department-scoped courses.
        $newDept = $merge('department', $emp['department']);
        if ($newDept !== $emp['department']) {
            syncScopedCourseAssignments($pdo, $id, $newDept);
        }
        Json::send(['ok' => true]);
    }
    if ($method === 'DELETE') {
        $pdo->prepare('DELETE FROM hr_employees WHERE id = ?')->execute([$id]);
        Json::send(['ok' => true]);
    }
    Json::fail('Method not allowed', 405);
}

/**
 * GET /api/hr/all-documents — every employee's documents in one round-trip.
 *
 * The per-employee endpoint at `/api/hr/employees/:eid/documents` was being
 * fanned out from `/hr/documents` (one request per employee = N+1). This
 * endpoint returns the same row shape grouped by `employee_id` so the
 * frontend can populate its `Map<empId, HrDocument[]>` from a single query.
 */
function handleAllDocuments(\PDO|\BRS\TenantPdo $pdo, string $method): void {
    if ($method !== 'GET') Json::fail('Method not allowed', 405);
    $stmt = $pdo->query('SELECT d.*, u.display_name AS uploaded_by_name
                         FROM hr_documents d
                         LEFT JOIN admin_users u ON u.id = d.uploaded_by
                         ORDER BY d.employee_id, d.uploaded_at DESC');
    $rows = $stmt->fetchAll();
    $byEmployee = [];
    foreach ($rows as $r) {
        $eid = (string)(int)$r['employee_id'];
        if (!isset($byEmployee[$eid])) $byEmployee[$eid] = [];
        $byEmployee[$eid][] = $r;
    }
    Json::send(['documents_by_employee' => (object)$byEmployee]);
}

/**
 * GET /api/hr/all-onboarding — every employee's onboarding tasks in one
 * round-trip. Same N+1-collapse rationale as `/api/hr/all-documents`.
 */
function handleAllOnboarding(\PDO|\BRS\TenantPdo $pdo, string $method): void {
    if ($method !== 'GET') Json::fail('Method not allowed', 405);
    $rows = $pdo->query('SELECT * FROM hr_onboarding_tasks ORDER BY employee_id, sort_order, id')->fetchAll();
    $byEmployee = [];
    foreach ($rows as $r) {
        $eid = (string)(int)$r['employee_id'];
        if (!isset($byEmployee[$eid])) $byEmployee[$eid] = [];
        $byEmployee[$eid][] = $r;
    }
    Json::send(['tasks_by_employee' => (object)$byEmployee]);
}

function handleOnboarding(\PDO|\BRS\TenantPdo $pdo, string $method, array $segs, int $eid): void {
    if (!isset($segs[4])) {
        if ($method === 'GET') {
            $stmt = $pdo->prepare('SELECT * FROM hr_onboarding_tasks WHERE employee_id = ? ORDER BY sort_order, id');
            $stmt->execute([$eid]);
            Json::send(['tasks' => $stmt->fetchAll()]);
        }
        if ($method === 'POST') {
            $b = Json::readBody();
            $title = trim((string)($b['title'] ?? ''));
            if ($title === '') Json::fail('title required', 400);
            $ins = $pdo->prepare('INSERT INTO hr_onboarding_tasks
                (employee_id, title, description, category, due_date, sort_order)
                VALUES (?,?,?,?,?,?)');
            $ins->execute([
                $eid, $title,
                $b['description'] ?? null, $b['category'] ?? null,
                $b['due_date'] ?: null,
                (int)($b['sort_order'] ?? 0),
            ]);
            Json::send(['id' => (int)$pdo->lastInsertId()], 201);
        }
        Json::fail('Method not allowed', 405);
    }
    $tid = (int)$segs[4];
    if ($method === 'PUT') {
        $b = Json::readBody();
        $existing = $pdo->prepare('SELECT * FROM hr_onboarding_tasks WHERE id = ? AND employee_id = ?');
        $existing->execute([$tid, $eid]);
        $row = $existing->fetch();
        if (!$row) Json::fail('Task not found', 404);
        $isDone = array_key_exists('is_done', $b) ? (!empty($b['is_done']) ? 1 : 0) : (int)$row['is_done'];
        $doneAt = $isDone ? ($row['done_at'] ?? date('Y-m-d H:i:s')) : null;
        $pdo->prepare('UPDATE hr_onboarding_tasks
            SET title=?, description=?, category=?, due_date=?, is_done=?, done_at=?, sort_order=?
            WHERE id = ?')->execute([
            trim((string)($b['title'] ?? $row['title'])) ?: $row['title'],
            array_key_exists('description', $b) ? $b['description'] : $row['description'],
            array_key_exists('category', $b)    ? $b['category']    : $row['category'],
            array_key_exists('due_date', $b)    ? ($b['due_date'] ?: null) : $row['due_date'],
            $isDone, $doneAt,
            isset($b['sort_order']) ? (int)$b['sort_order'] : (int)$row['sort_order'],
            $tid,
        ]);
        Json::send(['ok' => true]);
    }
    if ($method === 'DELETE') {
        $pdo->prepare('DELETE FROM hr_onboarding_tasks WHERE id = ? AND employee_id = ?')->execute([$tid, $eid]);
        Json::send(['ok' => true]);
    }
    Json::fail('Method not allowed', 405);
}

function handleDocuments(\PDO|\BRS\TenantPdo $pdo, string $method, array $segs, int $eid): void {
    if (!isset($segs[4])) {
        if ($method === 'GET') {
            $stmt = $pdo->prepare('SELECT d.*, u.display_name AS uploaded_by_name
                                   FROM hr_documents d LEFT JOIN admin_users u ON u.id = d.uploaded_by
                                   WHERE d.employee_id = ? ORDER BY d.uploaded_at DESC');
            $stmt->execute([$eid]);
            Json::send(['documents' => $stmt->fetchAll()]);
        }
        if ($method === 'POST') {
            if (empty($_FILES['file'])) Json::fail('file required', 400);
            $f = $_FILES['file'];
            if ($f['error'] !== UPLOAD_ERR_OK) Json::fail('upload failed (code ' . $f['error'] . ')', 400);
            $title    = trim((string)($_POST['title'] ?? $f['name']));
            $category = trim((string)($_POST['category'] ?? 'general'));
            $reqSig   = !empty($_POST['requires_signature']) ? 1 : 0;
            $docTypeId = isset($_POST['doc_type_id']) && $_POST['doc_type_id'] !== '' ? (int)$_POST['doc_type_id'] : null;

            $dir = __DIR__ . '/../../uploads/hr/' . $eid;
            if (!is_dir($dir)) @mkdir($dir, 0775, true);
            $safe = preg_replace('/[^A-Za-z0-9._-]+/', '_', basename($f['name']));
            $name = time() . '_' . $safe;
            $dest = $dir . '/' . $name;
            if (!move_uploaded_file($f['tmp_name'], $dest)) Json::fail('failed to save file', 500);

            $relPath = 'uploads/hr/' . $eid . '/' . $name;
            $claims = Auth::require();
            $ins = $pdo->prepare('INSERT INTO hr_documents
                (employee_id, doc_type_id, category, title, file_path, file_size, mime_type, requires_signature, uploaded_by)
                VALUES (?,?,?,?,?,?,?,?,?)');
            $ins->execute([$eid, $docTypeId, $category, $title, $relPath, (int)$f['size'], $f['type'] ?? null, $reqSig, (int)($claims['sub'] ?? 0) ?: null]);
            Json::send(['id' => (int)$pdo->lastInsertId()], 201);
        }
        Json::fail('Method not allowed', 405);
    }
    $did = (int)$segs[4];
    if ($method === 'DELETE') {
        $row = $pdo->prepare('SELECT file_path FROM hr_documents WHERE id = ? AND employee_id = ?');
        $row->execute([$did, $eid]);
        $r = $row->fetch();
        if ($r && !empty($r['file_path'])) {
            $abs = __DIR__ . '/../../' . $r['file_path'];
            if (is_file($abs)) @unlink($abs);
        }
        $pdo->prepare('DELETE FROM hr_documents WHERE id = ? AND employee_id = ?')->execute([$did, $eid]);
        Json::send(['ok' => true]);
    }
    Json::fail('Method not allowed', 405);
}

function handlePto(\PDO|\BRS\TenantPdo $pdo, string $method, array $segs, int $eid): void {
    if (!isset($segs[4])) {
        if ($method !== 'GET') Json::fail('Method not allowed', 405);
        $emp = $pdo->prepare('SELECT pto_days_year, pto_taken_days, pto_accrued_days FROM hr_employees WHERE id = ?');
        $emp->execute([$eid]); $e = $emp->fetch();
        if (!$e) Json::fail('Employee not found', 404);
        $stmt = $pdo->prepare('SELECT * FROM hr_pto_ledger WHERE employee_id = ? ORDER BY effective_date DESC, id DESC');
        $stmt->execute([$eid]);
        $balance = (float)$e['pto_accrued_days'] - (float)$e['pto_taken_days'];
        Json::send([
            'allowance' => (float)$e['pto_days_year'],
            'accrued'   => (float)$e['pto_accrued_days'],
            'taken'     => (float)$e['pto_taken_days'],
            'balance'   => $balance,
            'ledger'    => $stmt->fetchAll(),
        ]);
    }
    $kind = (string)$segs[4];
    if ($kind === 'accrue' && $method === 'POST') {
        $b = Json::readBody();
        $emp = $pdo->prepare('SELECT pto_days_year FROM hr_employees WHERE id = ?');
        $emp->execute([$eid]); $e = $emp->fetch();
        if (!$e) Json::fail('Employee not found', 404);
        $days = isset($b['days']) ? (float)$b['days'] : round((float)$e['pto_days_year'] / 12, 1);
        $date = $b['effective_date'] ?? date('Y-m-d');
        $notes = $b['notes'] ?? 'Monthly accrual';
        $pdo->prepare('INSERT INTO hr_pto_ledger (employee_id, effective_date, kind, days, notes) VALUES (?,?,?,?,?)')
            ->execute([$eid, $date, 'accrual', $days, $notes]);
        $pdo->prepare('UPDATE hr_employees SET pto_accrued_days = pto_accrued_days + ? WHERE id = ?')
            ->execute([$days, $eid]);
        Json::send(['ok' => true, 'days' => $days], 201);
    }
    if ($kind === 'adjust' && $method === 'POST') {
        $b = Json::readBody();
        $days = (float)($b['days'] ?? 0);
        if ($days === 0.0) Json::fail('days required (positive or negative)', 400);
        $date = $b['effective_date'] ?? date('Y-m-d');
        $notes = $b['notes'] ?? 'Manual adjustment';
        $pdo->prepare('INSERT INTO hr_pto_ledger (employee_id, effective_date, kind, days, notes) VALUES (?,?,?,?,?)')
            ->execute([$eid, $date, 'adjust', $days, $notes]);
        $pdo->prepare('UPDATE hr_employees SET pto_accrued_days = pto_accrued_days + ? WHERE id = ?')
            ->execute([$days, $eid]);
        Json::send(['ok' => true]);
    }
    Json::fail('Not found', 404);
}

function handleEmpLearning(\PDO|\BRS\TenantPdo $pdo, string $method, array $segs, int $eid): void {
    if (!isset($segs[4])) {
        if ($method === 'GET') {
            // Also surface: compliance link (if course satisfies a compliance task),
            // module count + per-assignment completed-module count, so the UI can
            // show progress beyond the single status enum.
            $stmt = $pdo->prepare('
                SELECT a.*,
                       c.title, c.provider, c.category, c.link, c.duration_hours, c.is_required,
                       c.compliance_task_id,
                       ct.title AS compliance_task_title,
                       (SELECT COUNT(*) FROM hr_course_modules m WHERE m.course_id = c.id) AS module_count,
                       (SELECT COUNT(*) FROM hr_course_module_progress mp
                          INNER JOIN hr_course_modules m ON m.id = mp.module_id
                          WHERE mp.assignment_id = a.id
                            AND m.course_id = c.id
                            AND mp.completed_at IS NOT NULL) AS modules_completed
                FROM hr_course_assignments a
                JOIN hr_courses c ON c.id = a.course_id
                LEFT JOIN hr_compliance_tasks ct ON ct.id = c.compliance_task_id
                WHERE a.employee_id = ?
                ORDER BY a.due_date IS NULL, a.due_date, a.id DESC');
            $stmt->execute([$eid]);
            Json::send(['assignments' => $stmt->fetchAll()]);
        }
        Json::fail('Method not allowed', 405);
    }
    $aid = (int)$segs[4];
    if ($method === 'PUT') {
        $b = Json::readBody();
        $row = $pdo->prepare('SELECT * FROM hr_course_assignments WHERE id = ? AND employee_id = ?');
        $row->execute([$aid, $eid]);
        $a = $row->fetch();
        if (!$a) Json::fail('Assignment not found', 404);
        $newStatus = pickEnum($b['status'] ?? null, ['not_started','in_progress','completed','expired'], $a['status']);
        $completedAt = $newStatus === 'completed' ? ($a['completed_at'] ?? date('Y-m-d H:i:s')) : null;
        $pdo->prepare('UPDATE hr_course_assignments
            SET due_date=?, status=?, completed_at=?, score=?, notes=?
            WHERE id = ?')->execute([
            array_key_exists('due_date', $b) ? ($b['due_date'] ?: null) : $a['due_date'],
            $newStatus, $completedAt,
            isset($b['score']) ? (float)$b['score'] : $a['score'],
            array_key_exists('notes', $b) ? $b['notes'] : $a['notes'],
            $aid,
        ]);
        Json::send(['ok' => true]);
    }
    if ($method === 'DELETE') {
        $pdo->prepare('DELETE FROM hr_course_assignments WHERE id = ? AND employee_id = ?')->execute([$aid, $eid]);
        Json::send(['ok' => true]);
    }
    Json::fail('Method not allowed', 405);
}

function handleCertifications(\PDO|\BRS\TenantPdo $pdo, string $method, array $segs, int $eid): void {
    if (!isset($segs[4])) {
        if ($method === 'GET') {
            $stmt = $pdo->prepare('SELECT * FROM hr_certifications WHERE employee_id = ? ORDER BY issued_at DESC, id DESC');
            $stmt->execute([$eid]);
            Json::send(['certifications' => $stmt->fetchAll()]);
        }
        if ($method === 'POST') {
            $b = Json::readBody();
            $name = trim((string)($b['name'] ?? ''));
            if ($name === '') Json::fail('name required', 400);
            $filePath = saveCertFile($eid);
            $ins = $pdo->prepare('INSERT INTO hr_certifications
                (employee_id, name, issuer, issued_at, expires_at, credential_id, file_path, notes)
                VALUES (?,?,?,?,?,?,?,?)');
            $ins->execute([
                $eid, $name,
                $b['issuer'] ?? null,
                $b['issued_at']  ?: null,
                $b['expires_at'] ?: null,
                $b['credential_id'] ?? null,
                $filePath ?? ($b['file_path'] ?? null),
                $b['notes'] ?? null,
            ]);
            Json::send(['id' => (int)$pdo->lastInsertId(), 'file_path' => $filePath], 201);
        }
        Json::fail('Method not allowed', 405);
    }
    $cid = (int)$segs[4];
    $row = $pdo->prepare('SELECT * FROM hr_certifications WHERE id = ? AND employee_id = ?');
    $row->execute([$cid, $eid]);
    $cur = $row->fetch();
    if (!$cur) Json::fail('Certification not found', 404);

    if ($method === 'PUT') {
        $b = Json::readBody();
        $newFile = saveCertFile($eid);
        $finalPath = $cur['file_path'];
        if ($newFile) {
            if ($cur['file_path']) {
                $abs = __DIR__ . '/../../' . $cur['file_path'];
                if (is_file($abs)) @unlink($abs);
            }
            $finalPath = $newFile;
        } elseif (array_key_exists('file_path', $b)) {
            $finalPath = $b['file_path'];
        }
        $pdo->prepare('UPDATE hr_certifications
            SET name=?, issuer=?, issued_at=?, expires_at=?, credential_id=?, file_path=?, notes=?
            WHERE id = ?')->execute([
            trim((string)($b['name'] ?? $cur['name'])) ?: $cur['name'],
            array_key_exists('issuer', $b)        ? $b['issuer']        : $cur['issuer'],
            array_key_exists('issued_at', $b)     ? ($b['issued_at']  ?: null) : $cur['issued_at'],
            array_key_exists('expires_at', $b)    ? ($b['expires_at'] ?: null) : $cur['expires_at'],
            array_key_exists('credential_id', $b) ? $b['credential_id'] : $cur['credential_id'],
            $finalPath,
            array_key_exists('notes', $b)         ? $b['notes']         : $cur['notes'],
            $cid,
        ]);
        Json::send(['ok' => true, 'file_path' => $finalPath]);
    }
    if ($method === 'DELETE') {
        if ($cur['file_path']) {
            $abs = __DIR__ . '/../../' . $cur['file_path'];
            if (is_file($abs)) @unlink($abs);
        }
        $pdo->prepare('DELETE FROM hr_certifications WHERE id = ? AND employee_id = ?')->execute([$cid, $eid]);
        Json::send(['ok' => true]);
    }
    Json::fail('Method not allowed', 405);
}

/**
 * Auto-enroll an employee into every course that has a company-wide assignment
 * or a department-scoped assignment matching $department. Idempotent — INSERT
 * IGNORE skips rows that already exist for this (employee, course) pair.
 *
 * Called on employee creation and on department changes so new hires (and
 * transfers) automatically pick up the org's required learning instead of
 * silently missing it.
 */
function syncScopedCourseAssignments(\PDO|\BRS\TenantPdo $pdo, int $employeeId, ?string $department): void {
    // Company-wide courses: every course that has at least one company-scoped assignment.
    $companyCourses = $pdo->query('SELECT DISTINCT course_id, due_date
                                   FROM hr_course_assignments
                                   WHERE assign_scope = "company"')->fetchAll();
    $ins = $pdo->prepare('INSERT IGNORE INTO hr_course_assignments
        (employee_id, course_id, due_date, status, assign_scope, assign_scope_value)
        VALUES (?, ?, ?, "not_started", ?, ?)');
    foreach ($companyCourses as $c) {
        $ins->execute([$employeeId, (int)$c['course_id'], $c['due_date'] ?: null, 'company', null]);
    }
    // Department-scoped courses matching the employee's current department.
    if (!empty($department)) {
        $deptCourses = $pdo->prepare('SELECT DISTINCT course_id, due_date
                                      FROM hr_course_assignments
                                      WHERE assign_scope = "department" AND assign_scope_value = ?');
        $deptCourses->execute([$department]);
        foreach ($deptCourses->fetchAll() as $c) {
            $ins->execute([$employeeId, (int)$c['course_id'], $c['due_date'] ?: null, 'department', $department]);
        }
    }
}

function handleEmployeeNotes(\PDO|\BRS\TenantPdo $pdo, string $method, array $segs, int $eid): void {
    $nid = isset($segs[4]) ? (int)$segs[4] : 0;
    if ($nid === 0 && $method === 'GET') {
        $stmt = $pdo->prepare('
            SELECT n.id, n.employee_id, n.user_id, n.body, n.created_at,
                   u.display_name AS author_name, u.email AS author_email
            FROM hr_employee_notes n
            LEFT JOIN admin_users u ON u.id = n.user_id
            WHERE n.employee_id = ?
            ORDER BY n.created_at DESC, n.id DESC');
        $stmt->execute([$eid]);
        Json::send(['notes' => $stmt->fetchAll()]);
    }
    if ($nid === 0 && $method === 'POST') {
        $b = Json::readBody();
        $body = trim((string)($b['body'] ?? ''));
        if ($body === '') Json::fail('body required', 400);
        $claims = Auth::require();
        $uid = (int)($claims['sub'] ?? 0) ?: null;
        $ins = $pdo->prepare('INSERT INTO hr_employee_notes (employee_id, user_id, body) VALUES (?,?,?)');
        $ins->execute([$eid, $uid, $body]);
        Json::send(['id' => (int)$pdo->lastInsertId()], 201);
    }
    if ($nid > 0 && $method === 'DELETE') {
        $pdo->prepare('DELETE FROM hr_employee_notes WHERE id = ? AND employee_id = ?')
            ->execute([$nid, $eid]);
        Json::send(['ok' => true]);
    }
    Json::fail('Method not allowed', 405);
}

function saveCertFile(int $eid): ?string {
    if (empty($_FILES['file']) || $_FILES['file']['error'] === UPLOAD_ERR_NO_FILE) return null;
    $f = $_FILES['file'];
    if ($f['error'] !== UPLOAD_ERR_OK) Json::fail('upload failed (code ' . $f['error'] . ')', 400);
    $dir = __DIR__ . '/../../uploads/hr/' . $eid . '/certs';
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    $safe = preg_replace('/[^A-Za-z0-9._-]+/', '_', basename($f['name']));
    $name = time() . '_' . $safe;
    $dest = $dir . '/' . $name;
    if (!move_uploaded_file($f['tmp_name'], $dest)) Json::fail('failed to save file', 500);
    return 'uploads/hr/' . $eid . '/certs/' . $name;
}

function handlePayroll(\PDO|\BRS\TenantPdo $pdo, string $method, array $segs): void {
    // /payroll/ytd?employee_id=X&period_id=Y — UK tax-year YTD totals up to and including
    // the given period. Tax year runs 6 April → 5 April.
    if (($segs[2] ?? '') === 'ytd' && $method === 'GET') {
        $eid = (int)($_GET['employee_id'] ?? 0);
        $pid = (int)($_GET['period_id']   ?? 0);
        if ($eid <= 0 || $pid <= 0) Json::fail('employee_id and period_id required', 400);

        $row = $pdo->prepare('SELECT end_date FROM hr_payroll_periods WHERE id = ?');
        $row->execute([$pid]);
        $endDate = $row->fetchColumn();
        if (!$endDate) Json::fail('Period not found', 404);

        // UK tax-year start: 6 April of the year containing the period end_date,
        // unless the end_date is before April 6, in which case it's the prior year.
        $endTs   = strtotime($endDate);
        $year    = (int)date('Y', $endTs);
        $boundary = strtotime($year . '-04-06');
        if ($endTs < $boundary) $year--;
        $taxYearStart = $year . '-04-06';

        $stmt = $pdo->prepare('
            SELECT COALESCE(SUM(s.gross_amount),            0) AS gross,
                   COALESCE(SUM(s.bonus_amount),            0) AS bonus,
                   COALESCE(SUM(s.tax_amount),              0) AS tax,
                   COALESCE(SUM(s.ni_amount),               0) AS ni,
                   COALESCE(SUM(s.other_deduct),            0) AS other,
                   COALESCE(SUM(s.pension_amount),          0) AS pension,
                   COALESCE(SUM(s.employer_pension_amount), 0) AS er_pension,
                   COALESCE(SUM(s.net_amount),              0) AS net
            FROM hr_payslips s JOIN hr_payroll_periods p ON p.id = s.period_id
            WHERE s.employee_id = ?
              AND p.end_date <= ?
              AND p.end_date >= ?');
        $stmt->execute([$eid, $endDate, $taxYearStart]);
        $sums = $stmt->fetch() ?: ['gross' => 0, 'bonus' => 0, 'tax' => 0, 'ni' => 0, 'other' => 0, 'pension' => 0, 'er_pension' => 0, 'net' => 0];

        // Employer NIC, Class 1 secondary 2024-25: 13.8% above £9,100 / yr (≈ £758.33 / mo).
        // Approximate by counting full periods in the YTD window so a 6-month window deducts 6× the threshold.
        $periodCount = (int)$pdo->prepare('SELECT COUNT(*) FROM hr_payslips s JOIN hr_payroll_periods p ON p.id = s.period_id
                                            WHERE s.employee_id = ? AND p.end_date <= ? AND p.end_date >= ?')->execute([$eid, $endDate, $taxYearStart]);
        $stmt2 = $pdo->prepare('SELECT COUNT(*) FROM hr_payslips s JOIN hr_payroll_periods p ON p.id = s.period_id
                                WHERE s.employee_id = ? AND p.end_date <= ? AND p.end_date >= ?');
        $stmt2->execute([$eid, $endDate, $taxYearStart]);
        $periods = (int)$stmt2->fetchColumn();
        $secThreshold = 9100 / 12 * max(1, $periods);
        $employerNic = max(0, ((float)$sums['gross']) - $secThreshold) * 0.138;

        Json::send([
            'tax_year_start'      => $taxYearStart,
            'taxable_gross'       => round((float)$sums['gross'] + (float)$sums['bonus'], 2),
            'income_tax'          => round((float)$sums['tax'], 2),
            'employee_nic'        => round((float)$sums['ni'], 2),
            'employer_nic'        => round($employerNic, 2),
            'other_deductions'    => round((float)$sums['other'], 2),
            'pension_employee'    => round((float)$sums['pension'], 2),
            'pension_employer'    => round((float)$sums['er_pension'], 2),
            'total_payments'      => round((float)$sums['gross'] + (float)$sums['bonus'], 2),
            'total_deductions'    => round((float)$sums['tax'] + (float)$sums['ni'] + (float)$sums['other'] + (float)$sums['pension'], 2),
            'net_pay'             => round((float)$sums['net'], 2),
        ]);
    }
    if (($segs[2] ?? '') !== 'periods') Json::fail('Not found', 404);

    if (isset($segs[3]) && ($segs[4] ?? '') === 'export.csv') {
        if ($method !== 'GET') Json::fail('Method not allowed', 405);
        $pid = (int)$segs[3];
        $row = $pdo->prepare('SELECT * FROM hr_payroll_periods WHERE id = ?'); $row->execute([$pid]);
        $period = $row->fetch();
        if (!$period) Json::fail('Period not found', 404);
        $stmt = $pdo->prepare('
            SELECT e.first_name, e.last_name, u.email, e.position, e.department,
                   s.gross_amount, s.bonus_amount, s.tax_amount, s.ni_amount, s.other_deduct, s.net_amount, s.currency, s.notes
            FROM hr_payslips s
            JOIN hr_employees e ON e.id = s.employee_id
            JOIN admin_users u  ON u.id = e.admin_user_id
            WHERE s.period_id = ?
            ORDER BY e.last_name, e.first_name');
        $stmt->execute([$pid]);
        $rows = $stmt->fetchAll();

        $filename = 'payroll-' . preg_replace('/[^A-Za-z0-9_-]+/', '_', $period['name']) . '.csv';
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        $out = fopen('php://output', 'w');
        fputcsv($out, ['First name','Last name','Email','Position','Department','Gross','Bonus','Tax','NI','Other deductions','Net','Currency','Notes']);
        foreach ($rows as $r) {
            fputcsv($out, [
                $r['first_name'], $r['last_name'], $r['email'], $r['position'] ?? '', $r['department'] ?? '',
                $r['gross_amount'], $r['bonus_amount'], $r['tax_amount'], $r['ni_amount'], $r['other_deduct'],
                $r['net_amount'], $r['currency'], $r['notes'] ?? '',
            ]);
        }
        fclose($out);
        exit;
    }

    if (!isset($segs[3])) {
        if ($method === 'GET') {
            $stmt = $pdo->query('
                SELECT p.*,
                       (SELECT COUNT(*) FROM hr_payslips s WHERE s.period_id = p.id) AS payslip_count,
                       (SELECT COALESCE(SUM(s.net_amount),0) FROM hr_payslips s WHERE s.period_id = p.id) AS net_total
                FROM hr_payroll_periods p
                ORDER BY p.start_date DESC, p.id DESC
            ');
            Json::send(['periods' => $stmt->fetchAll()]);
        }
        if ($method === 'POST') {
            $b = Json::readBody();
            $name  = trim((string)($b['name'] ?? ''));
            $start = $b['start_date'] ?? '';
            $end   = $b['end_date']   ?? '';
            if ($name === '' || !$start || !$end) Json::fail('name, start_date, end_date required', 400);
            $ins = $pdo->prepare('INSERT INTO hr_payroll_periods (name, start_date, end_date, pay_date, status, notes) VALUES (?,?,?,?,?,?)');
            $ins->execute([
                $name, $start, $end, $b['pay_date'] ?: null,
                pickEnum($b['status'] ?? null, ['draft','approved','paid'], 'draft'),
                $b['notes'] ?? null,
            ]);
            Json::send(['id' => (int)$pdo->lastInsertId()], 201);
        }
        Json::fail('Method not allowed', 405);
    }

    $pid = (int)$segs[3];
    if (($segs[4] ?? '') === 'payslips') {
        if (!isset($segs[5])) {
            if ($method === 'GET') {
                $stmt = $pdo->prepare('
                    SELECT s.*, e.first_name, e.last_name, e.position
                    FROM hr_payslips s JOIN hr_employees e ON e.id = s.employee_id
                    WHERE s.period_id = ?
                    ORDER BY e.last_name, e.first_name');
                $stmt->execute([$pid]);
                Json::send(['payslips' => $stmt->fetchAll()]);
            }
            if ($method === 'POST') {
                $b = Json::readBody();
                $eid = (int)($b['employee_id'] ?? 0);
                if ($eid <= 0) Json::fail('employee_id required', 400);
                $gross   = (float)($b['gross_amount']            ?? 0);
                $tax     = (float)($b['tax_amount']              ?? 0);
                $ni      = (float)($b['ni_amount']               ?? 0);
                $other   = (float)($b['other_deduct']            ?? 0);
                $bonus   = (float)($b['bonus_amount']            ?? 0);
                $pension = (float)($b['pension_amount']          ?? 0);
                $erPens  = (float)($b['employer_pension_amount'] ?? 0);
                $net     = $gross + $bonus - $tax - $ni - $other - $pension;
                $ins = $pdo->prepare('INSERT INTO hr_payslips
                    (period_id, employee_id, gross_amount, tax_amount, ni_amount, other_deduct, pension_amount, employer_pension_amount, bonus_amount, net_amount, currency, notes)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
                    ON DUPLICATE KEY UPDATE
                      gross_amount=VALUES(gross_amount), tax_amount=VALUES(tax_amount), ni_amount=VALUES(ni_amount),
                      other_deduct=VALUES(other_deduct), pension_amount=VALUES(pension_amount), employer_pension_amount=VALUES(employer_pension_amount),
                      bonus_amount=VALUES(bonus_amount), net_amount=VALUES(net_amount),
                      currency=VALUES(currency), notes=VALUES(notes)');
                $ins->execute([$pid, $eid, $gross, $tax, $ni, $other, $pension, $erPens, $bonus, $net, $b['currency'] ?? 'GBP', $b['notes'] ?? null]);
                Json::send(['ok' => true, 'net_amount' => $net], 201);
            }
            Json::fail('Method not allowed', 405);
        }
        $sid = (int)$segs[5];
        if ($method === 'PUT') {
            $b = Json::readBody();
            $row = $pdo->prepare('SELECT * FROM hr_payslips WHERE id = ? AND period_id = ?');
            $row->execute([$sid, $pid]);
            $cur = $row->fetch();
            if (!$cur) Json::fail('Payslip not found', 404);
            $gross   = isset($b['gross_amount'])            ? (float)$b['gross_amount']            : (float)$cur['gross_amount'];
            $tax     = isset($b['tax_amount'])              ? (float)$b['tax_amount']              : (float)$cur['tax_amount'];
            $ni      = isset($b['ni_amount'])               ? (float)$b['ni_amount']               : (float)$cur['ni_amount'];
            $other   = isset($b['other_deduct'])            ? (float)$b['other_deduct']            : (float)$cur['other_deduct'];
            $bonus   = isset($b['bonus_amount'])            ? (float)$b['bonus_amount']            : (float)$cur['bonus_amount'];
            $pension = isset($b['pension_amount'])          ? (float)$b['pension_amount']          : (float)$cur['pension_amount'];
            $erPens  = isset($b['employer_pension_amount']) ? (float)$b['employer_pension_amount'] : (float)$cur['employer_pension_amount'];
            $net     = $gross + $bonus - $tax - $ni - $other - $pension;
            $pdo->prepare('UPDATE hr_payslips
                SET gross_amount=?, tax_amount=?, ni_amount=?, other_deduct=?, pension_amount=?, employer_pension_amount=?, bonus_amount=?, net_amount=?, currency=?, notes=?
                WHERE id = ?')->execute([
                $gross, $tax, $ni, $other, $pension, $erPens, $bonus, $net,
                $b['currency'] ?? $cur['currency'],
                array_key_exists('notes', $b) ? $b['notes'] : $cur['notes'],
                $sid,
            ]);
            Json::send(['ok' => true, 'net_amount' => $net]);
        }
        if ($method === 'DELETE') {
            $pdo->prepare('DELETE FROM hr_payslips WHERE id = ? AND period_id = ?')->execute([$sid, $pid]);
            Json::send(['ok' => true]);
        }
        Json::fail('Method not allowed', 405);
    }

    $row = $pdo->prepare('SELECT * FROM hr_payroll_periods WHERE id = ?'); $row->execute([$pid]);
    $period = $row->fetch();
    if (!$period) Json::fail('Period not found', 404);
    if ($method === 'GET') Json::send(['period' => $period]);
    if ($method === 'PUT') {
        $b = Json::readBody();
        $pdo->prepare('UPDATE hr_payroll_periods SET name=?, start_date=?, end_date=?, pay_date=?, status=?, notes=? WHERE id = ?')
            ->execute([
                trim((string)($b['name'] ?? $period['name'])) ?: $period['name'],
                $b['start_date'] ?? $period['start_date'],
                $b['end_date']   ?? $period['end_date'],
                array_key_exists('pay_date', $b) ? ($b['pay_date'] ?: null) : $period['pay_date'],
                pickEnum($b['status'] ?? null, ['draft','approved','paid'], $period['status']),
                array_key_exists('notes', $b) ? $b['notes'] : $period['notes'],
                $pid,
            ]);
        Json::send(['ok' => true]);
    }
    if ($method === 'DELETE') {
        $pdo->prepare('DELETE FROM hr_payroll_periods WHERE id = ?')->execute([$pid]);
        Json::send(['ok' => true]);
    }
    Json::fail('Method not allowed', 405);
}

function handleTimeOff(\PDO|\BRS\TenantPdo $pdo, string $method, array $segs): void {
    if (!isset($segs[2])) {
        if ($method === 'GET') {
            $where = []; $params = [];
            if (!empty($_GET['status'])) { $where[] = 't.status = ?'; $params[] = (string)$_GET['status']; }
            if (!empty($_GET['employee_id'])) { $where[] = 't.employee_id = ?'; $params[] = (int)$_GET['employee_id']; }
            $sql = 'SELECT t.*, e.first_name, e.last_name
                    FROM hr_time_off_requests t JOIN hr_employees e ON e.id = t.employee_id'
                . ($where ? ' WHERE ' . implode(' AND ', $where) : '')
                . ' ORDER BY t.start_date DESC, t.id DESC';
            $stmt = $pdo->prepare($sql); $stmt->execute($params);
            Json::send(['entries' => $stmt->fetchAll()]);
        }
        if ($method === 'POST') {
            $b = Json::readBody();
            $eid   = (int)($b['employee_id'] ?? 0);
            $start = $b['start_date'] ?? '';
            $end   = $b['end_date']   ?? '';
            if ($eid <= 0 || !$start || !$end) Json::fail('employee_id, start_date, end_date required', 400);
            $kind = pickEnum($b['kind'] ?? null, ['vacation','sick','personal','unpaid','other'], 'vacation');
            $days = isset($b['days']) ? (float)$b['days'] : (float)max(1, (strtotime($end) - strtotime($start)) / 86400 + 1);
            $status = pickEnum($b['status'] ?? null, ['pending','approved','denied','cancelled'], 'pending');
            $ins = $pdo->prepare('INSERT INTO hr_time_off_requests
                (employee_id, kind, start_date, end_date, days, notes, status)
                VALUES (?,?,?,?,?,?,?)');
            $ins->execute([$eid, $kind, $start, $end, $days, $b['notes'] ?? null, $status]);
            Json::send(['id' => (int)$pdo->lastInsertId()], 201);
        }
        Json::fail('Method not allowed', 405);
    }
    $id  = (int)$segs[2];
    $row = $pdo->prepare('SELECT * FROM hr_time_off_requests WHERE id = ?'); $row->execute([$id]);
    $entry = $row->fetch();
    if (!$entry) Json::fail('Entry not found', 404);
    if ($method === 'PUT') {
        $b = Json::readBody();
        $newStatus = pickEnum($b['status'] ?? null, ['pending','approved','denied','cancelled'], $entry['status']);
        $claims = Auth::require();
        $reviewedBy  = $newStatus !== 'pending' ? ((int)($claims['sub'] ?? 0) ?: null) : null;
        $reviewedAt  = $newStatus !== 'pending' ? date('Y-m-d H:i:s') : null;
        $newKind = pickEnum($b['kind'] ?? null, ['vacation','sick','personal','unpaid','other'], $entry['kind']);
        $newDays = isset($b['days']) ? (float)$b['days'] : (float)$entry['days'];
        $pdo->prepare('UPDATE hr_time_off_requests
            SET kind=?, start_date=?, end_date=?, days=?, notes=?, status=?, reviewed_by=?, reviewed_at=?
            WHERE id = ?')->execute([
            $newKind,
            $b['start_date'] ?? $entry['start_date'],
            $b['end_date']   ?? $entry['end_date'],
            $newDays,
            array_key_exists('notes', $b) ? $b['notes'] : $entry['notes'],
            $newStatus, $reviewedBy, $reviewedAt,
            $id,
        ]);

        $countsAgainstPto = in_array($newKind, ['vacation','personal'], true);
        $wasApproved = $entry['status'] === 'approved';
        $isApproved  = $newStatus === 'approved';
        $eid = (int)$entry['employee_id'];
        if ($countsAgainstPto && !$wasApproved && $isApproved) {
            $pdo->prepare('INSERT INTO hr_pto_ledger (employee_id, effective_date, kind, days, notes)
                           VALUES (?,?,?,?,?)')
                ->execute([$eid, $entry['start_date'], 'taken', $newDays, "Approved time-off #{$id}"]);
            $pdo->prepare('UPDATE hr_employees SET pto_taken_days = pto_taken_days + ? WHERE id = ?')
                ->execute([$newDays, $eid]);
        } elseif ($wasApproved && !$isApproved && in_array($entry['kind'], ['vacation','personal'], true)) {
            $pdo->prepare('INSERT INTO hr_pto_ledger (employee_id, effective_date, kind, days, notes)
                           VALUES (?,?,?,?,?)')
                ->execute([$eid, date('Y-m-d'), 'adjust', (float)$entry['days'], "Reversed time-off #{$id}"]);
            $pdo->prepare('UPDATE hr_employees SET pto_taken_days = GREATEST(pto_taken_days - ?, 0) WHERE id = ?')
                ->execute([(float)$entry['days'], $eid]);
        }
        Json::send(['ok' => true]);
    }
    if ($method === 'DELETE') {
        $pdo->prepare('DELETE FROM hr_time_off_requests WHERE id = ?')->execute([$id]);
        Json::send(['ok' => true]);
    }
    Json::fail('Method not allowed', 405);
}

function handleReviews(\PDO|\BRS\TenantPdo $pdo, string $method, array $segs): void {
    $sub = (string)($segs[2] ?? '');

    if ($sub === 'cycles') {
        if (!isset($segs[3])) {
            if ($method === 'GET') {
                $stmt = $pdo->query('
                    SELECT c.*,
                           (SELECT COUNT(*) FROM hr_reviews r WHERE r.cycle_id = c.id) AS review_count,
                           (SELECT COUNT(*) FROM hr_reviews r WHERE r.cycle_id = c.id AND r.status = "completed") AS completed_count
                    FROM hr_review_cycles c
                    ORDER BY c.period_start DESC, c.id DESC');
                Json::send(['cycles' => $stmt->fetchAll()]);
            }
            if ($method === 'POST') {
                $b = Json::readBody();
                $name  = trim((string)($b['name'] ?? ''));
                $start = $b['period_start'] ?? '';
                $end   = $b['period_end']   ?? '';
                if ($name === '' || !$start || !$end) Json::fail('name, period_start, period_end required', 400);
                $qs = isset($b['questions']) && is_array($b['questions']) ? $b['questions'] : defaultReviewQuestions();
                $ins = $pdo->prepare('INSERT INTO hr_review_cycles
                    (name, period_start, period_end, due_date, status, questions_json, notes)
                    VALUES (?,?,?,?,?,?,?)');
                $ins->execute([
                    $name, $start, $end,
                    $b['due_date'] ?: null,
                    pickEnum($b['status'] ?? null, ['draft','active','closed'], 'draft'),
                    json_encode($qs),
                    $b['notes'] ?? null,
                ]);
                Json::send(['id' => (int)$pdo->lastInsertId()], 201);
            }
            Json::fail('Method not allowed', 405);
        }

        $cid = (int)$segs[3];
        if (($segs[4] ?? '') === 'seed' && $method === 'POST') {
            $cycleQ = $pdo->prepare('SELECT id FROM hr_review_cycles WHERE id = ?');
            $cycleQ->execute([$cid]);
            if (!$cycleQ->fetch()) Json::fail('Cycle not found', 404);

            $emps = $pdo->prepare('SELECT id, manager_id FROM hr_employees WHERE status IN ("active","on_leave","onboarding")');
            $emps->execute();
            $created = 0;
            foreach ($emps->fetchAll() as $e) {
                $stmt = $pdo->prepare('INSERT IGNORE INTO hr_reviews (cycle_id, employee_id, manager_id, status) VALUES (?,?,?,"not_started")');
                $stmt->execute([$cid, (int)$e['id'], $e['manager_id'] ? (int)$e['manager_id'] : null]);
                if ($stmt->rowCount() > 0) $created++;
            }
            Json::send(['ok' => true, 'created' => $created]);
        }

        $row = $pdo->prepare('SELECT * FROM hr_review_cycles WHERE id = ?');
        $row->execute([$cid]);
        $cycle = $row->fetch();
        if (!$cycle) Json::fail('Cycle not found', 404);
        if ($method === 'GET') Json::send(['cycle' => $cycle]);
        if ($method === 'PUT') {
            $b = Json::readBody();
            $qs = isset($b['questions']) && is_array($b['questions']) ? json_encode($b['questions']) : $cycle['questions_json'];
            $pdo->prepare('UPDATE hr_review_cycles
                SET name=?, period_start=?, period_end=?, due_date=?, status=?, questions_json=?, notes=?
                WHERE id = ?')->execute([
                trim((string)($b['name'] ?? $cycle['name'])) ?: $cycle['name'],
                $b['period_start'] ?? $cycle['period_start'],
                $b['period_end']   ?? $cycle['period_end'],
                array_key_exists('due_date', $b) ? ($b['due_date'] ?: null) : $cycle['due_date'],
                pickEnum($b['status'] ?? null, ['draft','active','closed'], $cycle['status']),
                $qs,
                array_key_exists('notes', $b) ? $b['notes'] : $cycle['notes'],
                $cid,
            ]);
            Json::send(['ok' => true]);
        }
        if ($method === 'DELETE') {
            $pdo->prepare('DELETE FROM hr_review_cycles WHERE id = ?')->execute([$cid]);
            Json::send(['ok' => true]);
        }
        Json::fail('Method not allowed', 405);
    }

    if (!isset($segs[2])) {
        if ($method === 'GET') {
            $where = []; $params = [];
            if (!empty($_GET['cycle_id']))    { $where[] = 'r.cycle_id = ?';    $params[] = (int)$_GET['cycle_id']; }
            if (!empty($_GET['employee_id'])) { $where[] = 'r.employee_id = ?'; $params[] = (int)$_GET['employee_id']; }
            if (!empty($_GET['status']))      { $where[] = 'r.status = ?';      $params[] = (string)$_GET['status']; }
            $sql = '
                SELECT r.*,
                       e.first_name, e.last_name, e.position,
                       c.name AS cycle_name, c.period_start, c.period_end, c.due_date, c.questions_json
                FROM hr_reviews r
                JOIN hr_employees e     ON e.id = r.employee_id
                JOIN hr_review_cycles c ON c.id = r.cycle_id'
                . ($where ? ' WHERE ' . implode(' AND ', $where) : '')
                . ' ORDER BY c.period_end DESC, e.last_name, e.first_name';
            $stmt = $pdo->prepare($sql); $stmt->execute($params);
            Json::send(['reviews' => $stmt->fetchAll()]);
        }
        Json::fail('Method not allowed', 405);
    }

    $rid = (int)$segs[2];
    $row = $pdo->prepare('
        SELECT r.*, c.questions_json, c.name AS cycle_name
        FROM hr_reviews r JOIN hr_review_cycles c ON c.id = r.cycle_id
        WHERE r.id = ?');
    $row->execute([$rid]);
    $rev = $row->fetch();
    if (!$rev) Json::fail('Review not found', 404);

    if ($method === 'GET') Json::send(['review' => $rev]);
    if ($method === 'PUT') {
        $b = Json::readBody();
        $sign = !empty($b['sign']);
        $newStatus = $rev['status'];
        if ($sign) $newStatus = 'completed';
        elseif ($rev['status'] === 'self_review') $newStatus = 'manager_review';
        $pdo->prepare('UPDATE hr_reviews
            SET manager_responses_json = ?, manager_overall = ?, goals_next_period = ?, manager_signed_at = ?, status = ?, manager_id = ?
            WHERE id = ?')->execute([
            isset($b['responses']) ? json_encode($b['responses']) : $rev['manager_responses_json'],
            isset($b['overall']) ? (float)$b['overall'] : $rev['manager_overall'],
            array_key_exists('goals_next_period', $b) ? $b['goals_next_period'] : $rev['goals_next_period'],
            $sign ? date('Y-m-d H:i:s') : $rev['manager_signed_at'],
            $newStatus,
            !empty($b['manager_id']) ? (int)$b['manager_id'] : $rev['manager_id'],
            $rid,
        ]);
        Json::send(['ok' => true]);
    }
    if ($method === 'DELETE') {
        $pdo->prepare('DELETE FROM hr_reviews WHERE id = ?')->execute([$rid]);
        Json::send(['ok' => true]);
    }
    Json::fail('Method not allowed', 405);
}

function handleCourses(\PDO|\BRS\TenantPdo $pdo, string $method, array $segs): void {
    if (!isset($segs[2])) {
        if ($method === 'GET') {
            // Admin view shows both active and inactive courses; the UI tags inactive
            // ones so HR can re-activate or delete them.
            $stmt = $pdo->query('
                SELECT c.*,
                       ct.title AS compliance_task_title,
                       (SELECT COUNT(*) FROM hr_course_assignments a WHERE a.course_id = c.id) AS assigned_count,
                       (SELECT COUNT(*) FROM hr_course_assignments a WHERE a.course_id = c.id AND a.status = "completed") AS completed_count
                FROM hr_courses c
                LEFT JOIN hr_compliance_tasks ct ON ct.id = c.compliance_task_id
                ORDER BY c.is_active DESC, c.title');
            Json::send(['courses' => $stmt->fetchAll()]);
        }
        if ($method === 'POST') {
            $b = Json::readBody();
            $title = trim((string)($b['title'] ?? ''));
            if ($title === '') Json::fail('title required', 400);
            $ins = $pdo->prepare('INSERT INTO hr_courses (title, provider, category, description, link, duration_hours, is_required, compliance_task_id, is_active)
                VALUES (?,?,?,?,?,?,?,?,?)');
            $ins->execute([
                $title,
                $b['provider'] ?? null, $b['category'] ?? null,
                $b['description'] ?? null, $b['link'] ?? null,
                isset($b['duration_hours']) ? (float)$b['duration_hours'] : null,
                !empty($b['is_required']) ? 1 : 0,
                !empty($b['compliance_task_id']) ? (int)$b['compliance_task_id'] : null,
                isset($b['is_active']) ? (int)!!$b['is_active'] : 1,
            ]);
            Json::send(['id' => (int)$pdo->lastInsertId()], 201);
        }
        Json::fail('Method not allowed', 405);
    }
    $cid = (int)$segs[2];

    if (($segs[3] ?? '') === 'assign' && $method === 'POST') {
        $b = Json::readBody();
        $ids = isset($b['employee_ids']) && is_array($b['employee_ids']) ? array_map('intval', $b['employee_ids']) : [];
        if (empty($ids)) Json::fail('employee_ids required', 400);
        $due = $b['due_date'] ?: null;
        $scope = pickEnum($b['scope'] ?? null, ['individual','department','company'], 'individual');
        $scopeValue = $scope === 'department' ? trim((string)($b['scope_value'] ?? '')) : null;
        if ($scope === 'department' && !$scopeValue) Json::fail('scope_value required for department scope', 400);
        $claims = Auth::require();
        $by = (int)($claims['sub'] ?? 0) ?: null;
        $stmt = $pdo->prepare('INSERT IGNORE INTO hr_course_assignments
            (employee_id, course_id, assigned_by, due_date, status, assign_scope, assign_scope_value)
            VALUES (?,?,?,?, "not_started", ?, ?)');
        $created = 0;
        foreach ($ids as $eid) {
            $stmt->execute([$eid, $cid, $by, $due, $scope, $scopeValue]);
            if ($stmt->rowCount() > 0) $created++;
        }
        Json::send(['ok' => true, 'created' => $created]);
    }
    if (($segs[3] ?? '') === 'unassign-scope' && $method === 'POST') {
        $b = Json::readBody();
        $scope = pickEnum($b['scope'] ?? null, ['department','company'], 'company');
        $scopeValue = $scope === 'department' ? trim((string)($b['scope_value'] ?? '')) : null;
        if ($scope === 'department' && !$scopeValue) Json::fail('scope_value required', 400);
        if ($scope === 'company') {
            $del = $pdo->prepare('DELETE FROM hr_course_assignments WHERE course_id = ? AND assign_scope = "company"');
            $del->execute([$cid]);
        } else {
            $del = $pdo->prepare('DELETE FROM hr_course_assignments WHERE course_id = ? AND assign_scope = "department" AND assign_scope_value = ?');
            $del->execute([$cid, $scopeValue]);
        }
        Json::send(['ok' => true, 'removed' => $del->rowCount()]);
    }
    if (($segs[3] ?? '') === 'assignments') {
        if ($method === 'GET') {
            $stmt = $pdo->prepare('
                SELECT a.*, e.first_name, e.last_name
                FROM hr_course_assignments a JOIN hr_employees e ON e.id = a.employee_id
                WHERE a.course_id = ?
                ORDER BY e.last_name, e.first_name');
            $stmt->execute([$cid]);
            Json::send(['assignments' => $stmt->fetchAll()]);
        }
        Json::fail('Method not allowed', 405);
    }

    if (($segs[3] ?? '') === 'modules') {
        if (!isset($segs[4])) {
            if ($method === 'GET') {
                $stmt = $pdo->prepare('SELECT * FROM hr_course_modules WHERE course_id = ? ORDER BY sort_order, id');
                $stmt->execute([$cid]);
                Json::send(['modules' => $stmt->fetchAll()]);
            }
            if ($method === 'POST') {
                $b = Json::readBody();
                $title = trim((string)($b['title'] ?? ''));
                if ($title === '') Json::fail('title required', 400);
                $kind  = pickEnum($b['kind'] ?? null, ['text','video','quiz'], 'text');
                $orderQ = $pdo->prepare('SELECT COALESCE(MAX(sort_order), 0) + 10 FROM hr_course_modules WHERE course_id = ?');
                $orderQ->execute([$cid]);
                $sort = (int)$orderQ->fetchColumn();
                $ins = $pdo->prepare('INSERT INTO hr_course_modules
                    (course_id, title, kind, body, video_url, quiz_json, pass_score, sort_order)
                    VALUES (?,?,?,?,?,?,?,?)');
                $ins->execute([
                    $cid, $title, $kind,
                    $b['body']      ?? null,
                    $b['video_url'] ?? null,
                    isset($b['quiz']) ? json_encode($b['quiz']) : null,
                    isset($b['pass_score']) ? max(1, min(100, (int)$b['pass_score'])) : 100,
                    $sort,
                ]);
                Json::send(['id' => (int)$pdo->lastInsertId()], 201);
            }
            Json::fail('Method not allowed', 405);
        }
        $mid = (int)$segs[4];
        $row = $pdo->prepare('SELECT * FROM hr_course_modules WHERE id = ? AND course_id = ?');
        $row->execute([$mid, $cid]); $cur = $row->fetch();
        if (!$cur) Json::fail('Module not found', 404);

        // /modules/:mid/upload-image — multipart upload returning the saved URL only.
        // Used by the slide-block editor to insert image blocks at any position.
        if (($segs[5] ?? '') === 'upload-image' && $method === 'POST') {
            if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) Json::fail('image file required', 400);
            $f = $_FILES['file'];
            $allowed = ['image/jpeg','image/png','image/gif','image/webp','image/svg+xml'];
            if (!in_array($f['type'] ?? '', $allowed, true)) Json::fail('image must be jpg/png/gif/webp/svg', 400);
            $dir = __DIR__ . '/../../uploads/courses/' . $cid;
            if (!is_dir($dir)) @mkdir($dir, 0775, true);
            $safe = preg_replace('/[^A-Za-z0-9._-]+/', '_', basename($f['name']));
            $fname = 'm' . $mid . '_' . time() . '_' . $safe;
            $dest = $dir . '/' . $fname;
            if (!move_uploaded_file($f['tmp_name'], $dest)) Json::fail('failed to save file', 500);
            Json::send(['url' => 'uploads/courses/' . $cid . '/' . $fname], 201);
        }

        // /modules/:mid/images — upload (POST multipart) or remove (DELETE :idx) image entries.
        if (($segs[5] ?? '') === 'images') {
            $images = json_decode((string)($cur['images_json'] ?? '[]'), true);
            if (!is_array($images)) $images = [];

            if ($method === 'POST' && !isset($segs[6])) {
                if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) Json::fail('image file required', 400);
                $f = $_FILES['file'];
                $allowed = ['image/jpeg','image/png','image/gif','image/webp','image/svg+xml'];
                if (!in_array($f['type'] ?? '', $allowed, true)) Json::fail('image must be jpg/png/gif/webp/svg', 400);
                $dir = __DIR__ . '/../../uploads/courses/' . $cid;
                if (!is_dir($dir)) @mkdir($dir, 0775, true);
                $safe = preg_replace('/[^A-Za-z0-9._-]+/', '_', basename($f['name']));
                $fname = 'm' . $mid . '_' . time() . '_' . $safe;
                $dest = $dir . '/' . $fname;
                if (!move_uploaded_file($f['tmp_name'], $dest)) Json::fail('failed to save file', 500);
                $position = pickEnum($_POST['position'] ?? null, ['above','below'], 'above');
                $images[] = [
                    'url' => 'uploads/courses/' . $cid . '/' . $fname,
                    'position' => $position,
                    'alt' => (string)($_POST['alt'] ?? ''),
                ];
                $pdo->prepare('UPDATE hr_course_modules SET images_json = ? WHERE id = ?')
                    ->execute([json_encode($images), $mid]);
                Json::send(['ok' => true, 'images' => $images], 201);
            }
            if ($method === 'DELETE' && isset($segs[6])) {
                $idx = (int)$segs[6];
                if (!isset($images[$idx])) Json::fail('image not found', 404);
                $abs = __DIR__ . '/../../' . ($images[$idx]['url'] ?? '');
                if (is_file($abs)) @unlink($abs);
                array_splice($images, $idx, 1);
                $pdo->prepare('UPDATE hr_course_modules SET images_json = ? WHERE id = ?')
                    ->execute([json_encode($images), $mid]);
                Json::send(['ok' => true, 'images' => $images]);
            }
            Json::fail('Method not allowed', 405);
        }

        if ($method === 'GET') Json::send(['module' => $cur]);
        if ($method === 'PUT') {
            $b = Json::readBody();
            $kind = pickEnum($b['kind'] ?? null, ['text','video','quiz'], $cur['kind']);
            $pdo->prepare('UPDATE hr_course_modules
                SET title=?, kind=?, body=?, video_url=?, quiz_json=?, blocks_json=?, pass_score=?, sort_order=?
                WHERE id = ?')->execute([
                trim((string)($b['title'] ?? $cur['title'])) ?: $cur['title'],
                $kind,
                array_key_exists('body', $b)      ? $b['body']      : $cur['body'],
                array_key_exists('video_url', $b) ? $b['video_url'] : $cur['video_url'],
                array_key_exists('quiz', $b)      ? json_encode($b['quiz']) : $cur['quiz_json'],
                array_key_exists('blocks', $b)    ? json_encode($b['blocks']) : $cur['blocks_json'],
                isset($b['pass_score']) ? max(1, min(100, (int)$b['pass_score'])) : (int)$cur['pass_score'],
                isset($b['sort_order']) ? (int)$b['sort_order'] : (int)$cur['sort_order'],
                $mid,
            ]);
            Json::send(['ok' => true]);
        }
        if ($method === 'DELETE') {
            $pdo->prepare('DELETE FROM hr_course_modules WHERE id = ? AND course_id = ?')
                ->execute([$mid, $cid]);
            Json::send(['ok' => true]);
        }
        Json::fail('Method not allowed', 405);
    }

    $row = $pdo->prepare('SELECT * FROM hr_courses WHERE id = ?');
    $row->execute([$cid]);
    $course = $row->fetch();
    if (!$course) Json::fail('Course not found', 404);
    if ($method === 'GET') Json::send(['course' => $course]);
    if ($method === 'PUT') {
        $b = Json::readBody();
        $pdo->prepare('UPDATE hr_courses
            SET title=?, provider=?, category=?, description=?, link=?, duration_hours=?, is_required=?, compliance_task_id=?, is_active=?
            WHERE id = ?')->execute([
            trim((string)($b['title'] ?? $course['title'])) ?: $course['title'],
            array_key_exists('provider', $b)    ? $b['provider']    : $course['provider'],
            array_key_exists('category', $b)    ? $b['category']    : $course['category'],
            array_key_exists('description', $b) ? $b['description'] : $course['description'],
            array_key_exists('link', $b)        ? $b['link']        : $course['link'],
            isset($b['duration_hours']) ? (float)$b['duration_hours'] : $course['duration_hours'],
            isset($b['is_required']) ? (int)!!$b['is_required'] : (int)$course['is_required'],
            array_key_exists('compliance_task_id', $b)
                ? (!empty($b['compliance_task_id']) ? (int)$b['compliance_task_id'] : null)
                : $course['compliance_task_id'],
            isset($b['is_active'])   ? (int)!!$b['is_active']   : (int)$course['is_active'],
            $cid,
        ]);
        Json::send(['ok' => true]);
    }
    if ($method === 'DELETE') {
        $pdo->prepare('DELETE FROM hr_courses WHERE id = ?')->execute([$cid]);
        Json::send(['ok' => true]);
    }
    Json::fail('Method not allowed', 405);
}

function handleChangeRequests(\PDO|\BRS\TenantPdo $pdo, string $method, array $segs): void {
    if (!isset($segs[2])) {
        if ($method !== 'GET') Json::fail('Method not allowed', 405);
        $where = []; $params = [];
        if (!empty($_GET['status'])) { $where[] = 'r.status = ?'; $params[] = (string)$_GET['status']; }
        $sql = 'SELECT r.*, e.first_name, e.last_name
                FROM hr_change_requests r JOIN hr_employees e ON e.id = r.employee_id'
            . ($where ? ' WHERE ' . implode(' AND ', $where) : '')
            . ' ORDER BY r.created_at DESC';
        $stmt = $pdo->prepare($sql); $stmt->execute($params);
        Json::send(['requests' => $stmt->fetchAll()]);
    }
    $id = (int)$segs[2];
    $row = $pdo->prepare('SELECT * FROM hr_change_requests WHERE id = ?'); $row->execute([$id]);
    $req = $row->fetch();
    if (!$req) Json::fail('Request not found', 404);
    if ($method === 'PUT') {
        $b = Json::readBody();
        $newStatus = pickEnum($b['status'] ?? null, ['pending','approved','denied','cancelled'], $req['status']);
        $claims = Auth::require();
        $reviewedBy = $newStatus !== 'pending' ? ((int)($claims['sub'] ?? 0) ?: null) : null;
        $reviewedAt = $newStatus !== 'pending' ? date('Y-m-d H:i:s') : null;
        $pdo->prepare('UPDATE hr_change_requests SET status = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?')
            ->execute([$newStatus, $reviewedBy, $reviewedAt, $id]);
        if ($newStatus === 'approved' && $req['status'] !== 'approved') {
            $allowed = [
                'phone','address_line1','address_line2','city','region','postcode','country',
                'emergency_name','emergency_phone','emergency_rel','preferred_name','dob',
            ];
            if (in_array($req['field'], $allowed, true)) {
                $sql = 'UPDATE hr_employees SET `' . $req['field'] . '` = ? WHERE id = ?';
                $pdo->prepare($sql)->execute([$req['new_value'] ?: null, (int)$req['employee_id']]);
            }
        }
        Json::send(['ok' => true]);
    }
    if ($method === 'DELETE') {
        $pdo->prepare('DELETE FROM hr_change_requests WHERE id = ?')->execute([$id]);
        Json::send(['ok' => true]);
    }
    Json::fail('Method not allowed', 405);
}

function handleCompliance(\PDO|\BRS\TenantPdo $pdo, string $method, array $segs): void {
    if (!isset($segs[2])) {
        if ($method === 'GET') {
            $pdo->exec("UPDATE hr_compliance_tasks SET status = CASE
                WHEN status IN ('done','archived') THEN status
                WHEN next_due_at < CURDATE() THEN 'overdue'
                WHEN next_due_at <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) THEN 'due'
                ELSE 'upcoming'
            END");
            $stmt = $pdo->query('SELECT t.*, u.display_name AS owner_name
                                 FROM hr_compliance_tasks t LEFT JOIN admin_users u ON u.id = t.owner_id
                                 WHERE status != "archived" ORDER BY next_due_at');
            Json::send(['tasks' => $stmt->fetchAll()]);
        }
        if ($method === 'POST') {
            $b = Json::readBody();
            $title = trim((string)($b['title'] ?? ''));
            $next  = $b['next_due_at'] ?? '';
            if ($title === '' || !$next) Json::fail('title and next_due_at required', 400);
            $ins = $pdo->prepare('INSERT INTO hr_compliance_tasks
                (title, description, jurisdiction, frequency, task_type, next_due_at, owner_id, notes)
                VALUES (?,?,?,?,?,?,?,?)');
            $ins->execute([
                $title,
                $b['description'] ?? null,
                $b['jurisdiction'] ?? 'UK',
                pickEnum($b['frequency'] ?? null, ['one_off','monthly','quarterly','annual','custom'], 'annual'),
                pickEnum($b['task_type'] ?? null, ['training','document','audit','employee','other'], 'other'),
                $next,
                !empty($b['owner_id']) ? (int)$b['owner_id'] : null,
                $b['notes'] ?? null,
            ]);
            Json::send(['id' => (int)$pdo->lastInsertId()], 201);
        }
        Json::fail('Method not allowed', 405);
    }
    $id = (int)$segs[2];
    // /:id/notes — list (GET) or append (POST) timestamped follow-up notes.
    // /:id/notes/:nid — DELETE removes a single note.
    // /:id/courses — courses that point at this compliance task via hr_courses.compliance_task_id.
    if (($segs[3] ?? '') === 'courses' && $method === 'GET') {
        $stmt = $pdo->prepare('
            SELECT c.id, c.title, c.provider, c.is_required, c.is_active,
                   (SELECT COUNT(*) FROM hr_course_assignments a WHERE a.course_id = c.id) AS assigned_count,
                   (SELECT COUNT(*) FROM hr_course_assignments a WHERE a.course_id = c.id AND a.status = "completed") AS completed_count
            FROM hr_courses c
            WHERE c.compliance_task_id = ?
            ORDER BY c.title');
        $stmt->execute([$id]);
        Json::send(['courses' => $stmt->fetchAll()]);
    }
    if (($segs[3] ?? '') === 'notes') {
        $nid = isset($segs[4]) ? (int)$segs[4] : 0;
        if ($nid === 0 && $method === 'GET') {
            $stmt = $pdo->prepare('
                SELECT n.id, n.task_id, n.user_id, n.body, n.created_at,
                       u.display_name AS author_name, u.email AS author_email
                FROM hr_compliance_task_notes n
                LEFT JOIN admin_users u ON u.id = n.user_id
                WHERE n.task_id = ? ORDER BY n.created_at DESC, n.id DESC');
            $stmt->execute([$id]);
            Json::send(['notes' => $stmt->fetchAll()]);
        }
        if ($nid === 0 && $method === 'POST') {
            $b = Json::readBody();
            $body = trim((string)($b['body'] ?? ''));
            if ($body === '') Json::fail('body required', 400);
            $claims = Auth::require();
            $uid = (int)($claims['sub'] ?? 0) ?: null;
            $ins = $pdo->prepare('INSERT INTO hr_compliance_task_notes (task_id, user_id, body) VALUES (?,?,?)');
            $ins->execute([$id, $uid, $body]);
            Json::send(['id' => (int)$pdo->lastInsertId()], 201);
        }
        if ($nid > 0 && $method === 'DELETE') {
            $pdo->prepare('DELETE FROM hr_compliance_task_notes WHERE id = ? AND task_id = ?')
                ->execute([$nid, $id]);
            Json::send(['ok' => true]);
        }
        Json::fail('Method not allowed', 405);
    }
    if (($segs[3] ?? '') === 'complete' && $method === 'POST') {
        $row = $pdo->prepare('SELECT * FROM hr_compliance_tasks WHERE id = ?');
        $row->execute([$id]);
        $t = $row->fetch();
        if (!$t) Json::fail('Task not found', 404);

        $today = date('Y-m-d');
        $nextDue = $t['next_due_at'];
        switch ($t['frequency']) {
            case 'monthly':   $nextDue = date('Y-m-d', strtotime($t['next_due_at'] . ' +1 month'));    break;
            case 'quarterly': $nextDue = date('Y-m-d', strtotime($t['next_due_at'] . ' +3 months'));   break;
            case 'annual':    $nextDue = date('Y-m-d', strtotime($t['next_due_at'] . ' +1 year'));     break;
            case 'one_off':   $nextDue = $t['next_due_at']; break;
        }
        $newStatus = $t['frequency'] === 'one_off' ? 'done' : 'upcoming';
        $pdo->prepare('UPDATE hr_compliance_tasks SET last_done_at = ?, next_due_at = ?, status = ? WHERE id = ?')
            ->execute([$today, $nextDue, $newStatus, $id]);
        Json::send(['ok' => true, 'next_due_at' => $nextDue]);
    }
    if ($method === 'PUT') {
        $b = Json::readBody();
        $row = $pdo->prepare('SELECT * FROM hr_compliance_tasks WHERE id = ?');
        $row->execute([$id]);
        $t = $row->fetch();
        if (!$t) Json::fail('Task not found', 404);
        $pdo->prepare('UPDATE hr_compliance_tasks
            SET title = ?, description = ?, jurisdiction = ?, frequency = ?, task_type = ?, next_due_at = ?, owner_id = ?, notes = ?, status = ?
            WHERE id = ?')->execute([
            trim((string)($b['title'] ?? $t['title'])) ?: $t['title'],
            array_key_exists('description', $b) ? $b['description'] : $t['description'],
            $b['jurisdiction'] ?? $t['jurisdiction'],
            pickEnum($b['frequency'] ?? null, ['one_off','monthly','quarterly','annual','custom'], $t['frequency']),
            pickEnum($b['task_type'] ?? null, ['training','document','audit','employee','other'], $t['task_type'] ?? 'other'),
            $b['next_due_at'] ?? $t['next_due_at'],
            !empty($b['owner_id']) ? (int)$b['owner_id'] : (array_key_exists('owner_id', $b) ? null : $t['owner_id']),
            array_key_exists('notes', $b) ? $b['notes'] : $t['notes'],
            pickEnum($b['status'] ?? null, ['upcoming','due','overdue','done','archived'], $t['status']),
            $id,
        ]);
        Json::send(['ok' => true]);
    }
    if ($method === 'DELETE') {
        $pdo->prepare('DELETE FROM hr_compliance_tasks WHERE id = ?')->execute([$id]);
        Json::send(['ok' => true]);
    }
    Json::fail('Method not allowed', 405);
}

function handlePulseSurveys(\PDO|\BRS\TenantPdo $pdo, string $method, array $segs): void {
    if (!isset($segs[2])) {
        if ($method === 'GET') {
            $stmt = $pdo->query('
                SELECT s.*,
                       (SELECT COUNT(*) FROM hr_pulse_responses r WHERE r.survey_id = s.id) AS response_count
                FROM hr_pulse_surveys s ORDER BY s.id DESC');
            Json::send(['surveys' => $stmt->fetchAll()]);
        }
        if ($method === 'POST') {
            $b = Json::readBody();
            $title = trim((string)($b['title'] ?? ''));
            if ($title === '') Json::fail('title required', 400);
            $qs = isset($b['questions']) && is_array($b['questions']) ? $b['questions'] : [
                ['id' => 'happy', 'type' => 'rating', 'label' => 'How happy are you at work this week?'],
                ['id' => 'support', 'type' => 'rating', 'label' => 'Do you feel supported by your manager?'],
                ['id' => 'comments', 'type' => 'text', 'label' => 'Anything else you want to share?'],
            ];
            $ins = $pdo->prepare('INSERT INTO hr_pulse_surveys
                (title, description, is_anonymous, questions_json, status, opens_at, closes_at)
                VALUES (?,?,?,?,?,?,?)');
            $ins->execute([
                $title,
                $b['description'] ?? null,
                isset($b['is_anonymous']) ? (int)!!$b['is_anonymous'] : 1,
                json_encode($qs),
                pickEnum($b['status'] ?? null, ['draft','open','closed'], 'draft'),
                $b['opens_at']  ?: null,
                $b['closes_at'] ?: null,
            ]);
            Json::send(['id' => (int)$pdo->lastInsertId()], 201);
        }
        Json::fail('Method not allowed', 405);
    }
    $sid = (int)$segs[2];
    if (($segs[3] ?? '') === 'responses' && $method === 'GET') {
        $row = $pdo->prepare('SELECT * FROM hr_pulse_surveys WHERE id = ?');
        $row->execute([$sid]); $survey = $row->fetch();
        if (!$survey) Json::fail('Survey not found', 404);

        $stmt = $pdo->prepare('
            SELECT r.*, e.first_name, e.last_name
            FROM hr_pulse_responses r
            LEFT JOIN hr_employees e ON e.id = r.employee_id
            WHERE r.survey_id = ?
            ORDER BY r.submitted_at DESC');
        $stmt->execute([$sid]);
        $responses = $stmt->fetchAll();

        $questions = json_decode($survey['questions_json'], true) ?: [];
        $aggregate = [];
        foreach ($questions as $q) {
            if (($q['type'] ?? '') !== 'rating') continue;
            $sum = 0; $n = 0;
            foreach ($responses as $r) {
                $a = json_decode($r['answers_json'], true) ?: [];
                if (isset($a[$q['id']]) && is_numeric($a[$q['id']])) {
                    $sum += (float)$a[$q['id']]; $n++;
                }
            }
            $aggregate[$q['id']] = ['avg' => $n > 0 ? round($sum / $n, 2) : null, 'count' => $n];
        }
        Json::send([
            'survey'    => $survey,
            'responses' => $responses,
            'aggregate' => $aggregate,
        ]);
    }
    $row = $pdo->prepare('SELECT * FROM hr_pulse_surveys WHERE id = ?');
    $row->execute([$sid]); $survey = $row->fetch();
    if (!$survey) Json::fail('Survey not found', 404);
    if ($method === 'GET') Json::send(['survey' => $survey]);
    if ($method === 'PUT') {
        $b = Json::readBody();
        $qs = isset($b['questions']) && is_array($b['questions']) ? json_encode($b['questions']) : $survey['questions_json'];
        $allowExternal = isset($b['allow_external']) ? (int)!!$b['allow_external'] : (int)$survey['allow_external'];

        // Auto-mint a public token the first time a survey is flipped to
        // public — keeps the existing token if there's already one (so the
        // shared link / embed snippet stay stable across edits).
        $publicToken = $survey['public_token'];
        if ($allowExternal && empty($publicToken)) {
            $publicToken = bin2hex(random_bytes(16));
        }

        $pdo->prepare('UPDATE hr_pulse_surveys
            SET title=?, description=?, is_anonymous=?, questions_json=?, status=?, opens_at=?, closes_at=?, allow_external=?, public_token=?
            WHERE id = ?')->execute([
            trim((string)($b['title'] ?? $survey['title'])) ?: $survey['title'],
            array_key_exists('description', $b) ? $b['description'] : $survey['description'],
            isset($b['is_anonymous']) ? (int)!!$b['is_anonymous'] : (int)$survey['is_anonymous'],
            $qs,
            pickEnum($b['status'] ?? null, ['draft','open','closed'], $survey['status']),
            array_key_exists('opens_at', $b)  ? ($b['opens_at']  ?: null) : $survey['opens_at'],
            array_key_exists('closes_at', $b) ? ($b['closes_at'] ?: null) : $survey['closes_at'],
            $allowExternal,
            $publicToken,
            $sid,
        ]);
        Json::send(['ok' => true]);
    }
    if ($method === 'DELETE') {
        $pdo->prepare('DELETE FROM hr_pulse_surveys WHERE id = ?')->execute([$sid]);
        Json::send(['ok' => true]);
    }
    Json::fail('Method not allowed', 405);
}

function handleFeedback(\PDO|\BRS\TenantPdo $pdo, string $method, array $segs): void {
    if (!isset($segs[2])) {
        if ($method !== 'GET') Json::fail('Method not allowed', 405);
        $where = []; $params = [];
        if (!empty($_GET['status'])) { $where[] = 'f.status = ?'; $params[] = (string)$_GET['status']; }
        $sql = 'SELECT f.*, e.first_name, e.last_name
                FROM hr_feedback f LEFT JOIN hr_employees e ON e.id = f.employee_id'
            . ($where ? ' WHERE ' . implode(' AND ', $where) : '')
            . ' ORDER BY f.created_at DESC';
        $stmt = $pdo->prepare($sql); $stmt->execute($params);
        Json::send(['feedback' => $stmt->fetchAll()]);
    }
    $id = (int)$segs[2];
    if ($method === 'PUT') {
        $b = Json::readBody();
        $newStatus = $b['status'] ?? null;
        if (!in_array($newStatus, ['new','reviewed','actioned','archived'], true)) Json::fail('invalid status', 400);
        $claims = Auth::require();
        $pdo->prepare('UPDATE hr_feedback SET status = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?')
            ->execute([$newStatus, (int)($claims['sub'] ?? 0) ?: null, date('Y-m-d H:i:s'), $id]);
        Json::send(['ok' => true]);
    }
    if ($method === 'DELETE') {
        $pdo->prepare('DELETE FROM hr_feedback WHERE id = ?')->execute([$id]);
        Json::send(['ok' => true]);
    }
    Json::fail('Method not allowed', 405);
}

function handleReports(\PDO|\BRS\TenantPdo $pdo, string $method, array $segs): void {
    if ($method !== 'GET') Json::fail('Method not allowed', 405);
    $sub = (string)($segs[2] ?? 'overview');
    if ($sub === 'overview') {
        $headcount   = (int)$pdo->query('SELECT COUNT(*) FROM hr_employees WHERE status IN ("active","on_leave","onboarding")')->fetchColumn();
        $byStatus    = $pdo->query('SELECT status, COUNT(*) AS n FROM hr_employees GROUP BY status')->fetchAll();
        $byType      = $pdo->query('SELECT employment_type, COUNT(*) AS n FROM hr_employees WHERE status != "terminated" GROUP BY employment_type')->fetchAll();
        $byDept      = $pdo->query("SELECT IFNULL(NULLIF(department, ''), '— unassigned —') AS department, COUNT(*) AS n
                                    FROM hr_employees WHERE status != 'terminated' GROUP BY department ORDER BY n DESC")->fetchAll();

        $terminated12mo = (int)$pdo->query("SELECT COUNT(*) FROM hr_employees WHERE status = 'terminated' AND end_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)")->fetchColumn();
        $turnover = $headcount > 0 ? round($terminated12mo / max(1, $headcount + $terminated12mo) * 100, 1) : 0;

        $pendingTimeOff    = (int)$pdo->query("SELECT COUNT(*) FROM hr_time_off_requests WHERE status = 'pending'")->fetchColumn();
        $expiringCerts     = (int)$pdo->query("SELECT COUNT(*) FROM hr_certifications WHERE expires_at IS NOT NULL AND expires_at BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 60 DAY)")->fetchColumn();
        $pendingChange     = (int)$pdo->query("SELECT COUNT(*) FROM hr_change_requests WHERE status = 'pending'")->fetchColumn();
        $overdueCompliance = (int)$pdo->query("SELECT COUNT(*) FROM hr_compliance_tasks WHERE status = 'overdue'")->fetchColumn();
        $openSurveys       = (int)$pdo->query("SELECT COUNT(*) FROM hr_pulse_surveys WHERE status = 'open'")->fetchColumn();

        $tenure = $pdo->query("
            SELECT
                SUM(CASE WHEN TIMESTAMPDIFF(YEAR, hire_date, CURDATE()) < 1 THEN 1 ELSE 0 END) AS lt1,
                SUM(CASE WHEN TIMESTAMPDIFF(YEAR, hire_date, CURDATE()) BETWEEN 1 AND 2 THEN 1 ELSE 0 END) AS y1_3,
                SUM(CASE WHEN TIMESTAMPDIFF(YEAR, hire_date, CURDATE()) BETWEEN 3 AND 4 THEN 1 ELSE 0 END) AS y3_5,
                SUM(CASE WHEN TIMESTAMPDIFF(YEAR, hire_date, CURDATE()) >= 5 THEN 1 ELSE 0 END) AS y5_plus
            FROM hr_employees WHERE hire_date IS NOT NULL AND status != 'terminated'")->fetch();

        Json::send([
            'headcount'         => $headcount,
            'turnover_pct_12mo' => $turnover,
            'terminated_12mo'   => $terminated12mo,
            'pending_time_off'  => $pendingTimeOff,
            'expiring_certs'    => $expiringCerts,
            'pending_change'    => $pendingChange,
            'overdue_compliance'=> $overdueCompliance,
            'open_surveys'      => $openSurveys,
            'by_status'         => $byStatus,
            'by_type'           => $byType,
            'by_department'     => $byDept,
            'tenure'            => $tenure,
        ]);
    }
    Json::fail('Not found', 404);
}

function handleSuccession(\PDO|\BRS\TenantPdo $pdo, string $method, array $segs): void {
    if (!isset($segs[2])) {
        if ($method === 'GET') {
            $stmt = $pdo->query('
                SELECT p.*,
                       h.first_name AS holder_first_name, h.last_name AS holder_last_name,
                       (SELECT COUNT(*) FROM hr_succession_candidates c WHERE c.plan_id = p.id) AS candidate_count
                FROM hr_succession_plans p
                LEFT JOIN hr_employees h ON h.id = p.current_holder_id
                ORDER BY FIELD(p.risk_level, "high","medium","low"), p.key_role');
            Json::send(['plans' => $stmt->fetchAll()]);
        }
        if ($method === 'POST') {
            $b = Json::readBody();
            $role = trim((string)($b['key_role'] ?? ''));
            if ($role === '') Json::fail('key_role required', 400);
            $ins = $pdo->prepare('INSERT INTO hr_succession_plans
                (key_role, current_holder_id, risk_level, notes) VALUES (?,?,?,?)');
            $ins->execute([
                $role,
                !empty($b['current_holder_id']) ? (int)$b['current_holder_id'] : null,
                pickEnum($b['risk_level'] ?? null, ['low','medium','high'], 'medium'),
                $b['notes'] ?? null,
            ]);
            Json::send(['id' => (int)$pdo->lastInsertId()], 201);
        }
        Json::fail('Method not allowed', 405);
    }
    $pid = (int)$segs[2];
    // /:pid/notes — list (GET) or append (POST) timestamped notes; /:pid/notes/:nid — DELETE
    if (($segs[3] ?? '') === 'notes') {
        $nid = isset($segs[4]) ? (int)$segs[4] : 0;
        if ($nid === 0 && $method === 'GET') {
            $stmt = $pdo->prepare('
                SELECT n.id, n.plan_id, n.user_id, n.body, n.created_at,
                       u.display_name AS author_name, u.email AS author_email
                FROM hr_succession_plan_notes n
                LEFT JOIN admin_users u ON u.id = n.user_id
                WHERE n.plan_id = ? ORDER BY n.created_at DESC, n.id DESC');
            $stmt->execute([$pid]);
            Json::send(['notes' => $stmt->fetchAll()]);
        }
        if ($nid === 0 && $method === 'POST') {
            $b = Json::readBody();
            $body = trim((string)($b['body'] ?? ''));
            if ($body === '') Json::fail('body required', 400);
            $claims = Auth::require();
            $uid = (int)($claims['sub'] ?? 0) ?: null;
            $ins = $pdo->prepare('INSERT INTO hr_succession_plan_notes (plan_id, user_id, body) VALUES (?,?,?)');
            $ins->execute([$pid, $uid, $body]);
            Json::send(['id' => (int)$pdo->lastInsertId()], 201);
        }
        if ($nid > 0 && $method === 'DELETE') {
            $pdo->prepare('DELETE FROM hr_succession_plan_notes WHERE id = ? AND plan_id = ?')
                ->execute([$nid, $pid]);
            Json::send(['ok' => true]);
        }
        Json::fail('Method not allowed', 405);
    }
    if (($segs[3] ?? '') === 'candidates') {
        if (!isset($segs[4])) {
            if ($method === 'GET') {
                $stmt = $pdo->prepare('
                    SELECT c.*, e.first_name, e.last_name, e.position, e.department
                    FROM hr_succession_candidates c JOIN hr_employees e ON e.id = c.employee_id
                    WHERE c.plan_id = ? ORDER BY FIELD(c.readiness, "now","1-2y","3-5y"), e.last_name');
                $stmt->execute([$pid]);
                Json::send(['candidates' => $stmt->fetchAll()]);
            }
            if ($method === 'POST') {
                $b = Json::readBody();
                $eid = (int)($b['employee_id'] ?? 0);
                if ($eid <= 0) Json::fail('employee_id required', 400);
                $stmt = $pdo->prepare('INSERT IGNORE INTO hr_succession_candidates (plan_id, employee_id, readiness, notes) VALUES (?,?,?,?)');
                $stmt->execute([
                    $pid, $eid,
                    pickEnum($b['readiness'] ?? null, ['now','1-2y','3-5y'], '1-2y'),
                    $b['notes'] ?? null,
                ]);
                Json::send(['ok' => true]);
            }
            Json::fail('Method not allowed', 405);
        }
        $cid = (int)$segs[4];
        // /:pid/candidates/:cid/notes — list / append / delete timestamped notes per candidate.
        if (($segs[5] ?? '') === 'notes') {
            $own = $pdo->prepare('SELECT id FROM hr_succession_candidates WHERE id = ? AND plan_id = ?');
            $own->execute([$cid, $pid]);
            if (!$own->fetchColumn()) Json::fail('Candidate not found', 404);
            $nid = isset($segs[6]) ? (int)$segs[6] : 0;
            if ($nid === 0 && $method === 'GET') {
                $stmt = $pdo->prepare('
                    SELECT n.id, n.candidate_id, n.user_id, n.body, n.created_at,
                           u.display_name AS author_name, u.email AS author_email
                    FROM hr_succession_candidate_notes n
                    LEFT JOIN admin_users u ON u.id = n.user_id
                    WHERE n.candidate_id = ? ORDER BY n.created_at DESC, n.id DESC');
                $stmt->execute([$cid]);
                Json::send(['notes' => $stmt->fetchAll()]);
            }
            if ($nid === 0 && $method === 'POST') {
                $b = Json::readBody();
                $body = trim((string)($b['body'] ?? ''));
                if ($body === '') Json::fail('body required', 400);
                $claims = Auth::require();
                $uid = (int)($claims['sub'] ?? 0) ?: null;
                $ins = $pdo->prepare('INSERT INTO hr_succession_candidate_notes (candidate_id, user_id, body) VALUES (?,?,?)');
                $ins->execute([$cid, $uid, $body]);
                Json::send(['id' => (int)$pdo->lastInsertId()], 201);
            }
            if ($nid > 0 && $method === 'DELETE') {
                $pdo->prepare('DELETE FROM hr_succession_candidate_notes WHERE id = ? AND candidate_id = ?')
                    ->execute([$nid, $cid]);
                Json::send(['ok' => true]);
            }
            Json::fail('Method not allowed', 405);
        }
        if ($method === 'PUT') {
            $b = Json::readBody();
            $row = $pdo->prepare('SELECT * FROM hr_succession_candidates WHERE id = ? AND plan_id = ?');
            $row->execute([$cid, $pid]);
            $cur = $row->fetch();
            if (!$cur) Json::fail('Candidate not found', 404);
            $pdo->prepare('UPDATE hr_succession_candidates SET readiness = ?, notes = ? WHERE id = ?')
                ->execute([
                    pickEnum($b['readiness'] ?? null, ['now','1-2y','3-5y'], $cur['readiness']),
                    array_key_exists('notes', $b) ? $b['notes'] : $cur['notes'],
                    $cid,
                ]);
            Json::send(['ok' => true]);
        }
        if ($method === 'DELETE') {
            $pdo->prepare('DELETE FROM hr_succession_candidates WHERE id = ? AND plan_id = ?')->execute([$cid, $pid]);
            Json::send(['ok' => true]);
        }
        Json::fail('Method not allowed', 405);
    }
    $row = $pdo->prepare('SELECT * FROM hr_succession_plans WHERE id = ?');
    $row->execute([$pid]); $plan = $row->fetch();
    if (!$plan) Json::fail('Plan not found', 404);
    if ($method === 'PUT') {
        $b = Json::readBody();
        $pdo->prepare('UPDATE hr_succession_plans
            SET key_role = ?, current_holder_id = ?, risk_level = ?, notes = ?
            WHERE id = ?')->execute([
            trim((string)($b['key_role'] ?? $plan['key_role'])) ?: $plan['key_role'],
            !empty($b['current_holder_id']) ? (int)$b['current_holder_id'] : (array_key_exists('current_holder_id', $b) ? null : $plan['current_holder_id']),
            pickEnum($b['risk_level'] ?? null, ['low','medium','high'], $plan['risk_level']),
            array_key_exists('notes', $b) ? $b['notes'] : $plan['notes'],
            $pid,
        ]);
        Json::send(['ok' => true]);
    }
    if ($method === 'DELETE') {
        $pdo->prepare('DELETE FROM hr_succession_plans WHERE id = ?')->execute([$pid]);
        Json::send(['ok' => true]);
    }
    Json::fail('Method not allowed', 405);
}

function handleJobs(\PDO|\BRS\TenantPdo $pdo, string $method, array $segs): void {
    if (!isset($segs[2])) {
        if ($method === 'GET') {
            $stmt = $pdo->query('
                SELECT j.*,
                       (SELECT COUNT(*) FROM hr_applications a WHERE a.job_id = j.id) AS application_count,
                       (SELECT COUNT(*) FROM hr_applications a WHERE a.job_id = j.id AND a.stage = "hired") AS hired_count
                FROM hr_jobs j ORDER BY j.created_at DESC');
            Json::send(['jobs' => $stmt->fetchAll()]);
        }
        if ($method === 'POST') {
            $b = Json::readBody();
            $title = trim((string)($b['title'] ?? ''));
            if ($title === '') Json::fail('title required', 400);
            $slug = strtolower(preg_replace('/[^a-z0-9]+/i', '-', $title));
            $slug = preg_replace('/-+/', '-', trim($slug, '-')) . '-' . substr(md5((string)microtime(true)), 0, 6);
            $ins = $pdo->prepare('INSERT INTO hr_jobs
                (title, slug, department, location, employment_type, salary_min, salary_max, salary_currency, description, status, posted_at)
                VALUES (?,?,?,?,?,?,?,?,?,?, NULL)');
            $ins->execute([
                $title, $slug,
                $b['department'] ?? null, $b['location'] ?? null,
                pickEnum($b['employment_type'] ?? null, ['full_time','part_time','contractor','intern'], 'full_time'),
                isset($b['salary_min']) ? (float)$b['salary_min'] : null,
                isset($b['salary_max']) ? (float)$b['salary_max'] : null,
                $b['salary_currency'] ?? 'GBP',
                $b['description'] ?? null,
                pickEnum($b['status'] ?? null, ['draft','open','closed'], 'draft'),
            ]);
            Json::send(['id' => (int)$pdo->lastInsertId(), 'slug' => $slug], 201);
        }
        Json::fail('Method not allowed', 405);
    }
    $jid = (int)$segs[2];
    if (($segs[3] ?? '') === 'pipeline' && $method === 'GET') {
        $stmt = $pdo->prepare('
            SELECT a.*, c.first_name, c.last_name, c.email, c.phone
            FROM hr_applications a JOIN hr_candidates c ON c.id = a.candidate_id
            WHERE a.job_id = ?
            ORDER BY FIELD(a.stage, "applied","screening","interview","offer","hired","rejected"), a.sort_order, a.applied_at DESC');
        $stmt->execute([$jid]);
        Json::send(['applications' => $stmt->fetchAll()]);
    }
    $row = $pdo->prepare('SELECT * FROM hr_jobs WHERE id = ?');
    $row->execute([$jid]); $job = $row->fetch();
    if (!$job) Json::fail('Job not found', 404);
    if ($method === 'GET') Json::send(['job' => $job]);
    if ($method === 'PUT') {
        $b = Json::readBody();
        $newStatus = pickEnum($b['status'] ?? null, ['draft','open','closed'], $job['status']);
        $newType   = pickEnum($b['employment_type'] ?? null, ['full_time','part_time','contractor','intern'], $job['employment_type']);
        $postedAt  = $job['posted_at'];
        $closedAt  = $job['closed_at'];
        if ($job['status'] !== 'open' && $newStatus === 'open' && !$postedAt) $postedAt = date('Y-m-d H:i:s');
        if ($job['status'] !== 'closed' && $newStatus === 'closed') $closedAt = date('Y-m-d H:i:s');
        $pdo->prepare('UPDATE hr_jobs
            SET title = ?, department = ?, location = ?, employment_type = ?, salary_min = ?, salary_max = ?, salary_currency = ?,
                description = ?, responsibilities = ?, benefits = ?,
                status = ?, posted_at = ?, closed_at = ?
            WHERE id = ?')->execute([
            trim((string)($b['title'] ?? $job['title'])) ?: $job['title'],
            array_key_exists('department', $b) ? $b['department'] : $job['department'],
            array_key_exists('location', $b)   ? $b['location']   : $job['location'],
            $newType,
            isset($b['salary_min']) ? (float)$b['salary_min'] : $job['salary_min'],
            isset($b['salary_max']) ? (float)$b['salary_max'] : $job['salary_max'],
            $b['salary_currency'] ?? $job['salary_currency'],
            array_key_exists('description',     $b) ? $b['description']     : $job['description'],
            array_key_exists('responsibilities', $b) ? $b['responsibilities'] : $job['responsibilities'],
            array_key_exists('benefits',         $b) ? $b['benefits']         : $job['benefits'],
            $newStatus, $postedAt, $closedAt,
            $jid,
        ]);
        Json::send(['ok' => true]);
    }
    if ($method === 'DELETE') {
        $pdo->prepare('DELETE FROM hr_jobs WHERE id = ?')->execute([$jid]);
        Json::send(['ok' => true]);
    }
    Json::fail('Method not allowed', 405);
}

function handleCandidates(\PDO|\BRS\TenantPdo $pdo, string $method, array $segs): void {
    if (!isset($segs[2])) {
        if ($method === 'GET') {
            $stmt = $pdo->query('SELECT * FROM hr_candidates ORDER BY created_at DESC');
            Json::send(['candidates' => $stmt->fetchAll()]);
        }
        if ($method === 'POST') {
            $b = Json::readBody();
            $first = trim((string)($b['first_name'] ?? ''));
            $last  = trim((string)($b['last_name']  ?? ''));
            $email = trim((string)($b['email']      ?? ''));
            if ($first === '' || $last === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) Json::fail('first_name, last_name, valid email required', 400);
            $existing = $pdo->prepare('SELECT id FROM hr_candidates WHERE email = ?');
            $existing->execute([$email]);
            $r = $existing->fetch();
            if ($r) Json::send(['id' => (int)$r['id'], 'existing' => true]);
            $ins = $pdo->prepare('INSERT INTO hr_candidates
                (first_name, last_name, email, phone, cv_path, linkedin_url, source, notes)
                VALUES (?,?,?,?,?,?,?,?)');
            $ins->execute([
                $first, $last, $email,
                $b['phone'] ?? null,
                $b['cv_path'] ?? null,
                $b['linkedin_url'] ?? null,
                $b['source'] ?? null,
                $b['notes'] ?? null,
            ]);
            $newApplicantId = (int)$pdo->lastInsertId();
            // Replay every audience='applicant' contract template (e.g. offer
            // letters) as a pending applicant_documents row.
            \BRS\Contracts::fanOutToNewEntity($pdo, 'applicant', $newApplicantId);
            Json::send(['id' => $newApplicantId], 201);
        }
        Json::fail('Method not allowed', 405);
    }
    $cid = (int)$segs[2];
    $row = $pdo->prepare('SELECT * FROM hr_candidates WHERE id = ?');
    $row->execute([$cid]); $cand = $row->fetch();
    if (!$cand) Json::fail('Candidate not found', 404);
    if ($method === 'GET') {
        $apps = $pdo->prepare('SELECT a.*, j.title FROM hr_applications a JOIN hr_jobs j ON j.id = a.job_id WHERE a.candidate_id = ? ORDER BY a.applied_at DESC');
        $apps->execute([$cid]);
        Json::send(['candidate' => $cand, 'applications' => $apps->fetchAll()]);
    }
    if ($method === 'PUT') {
        $b = Json::readBody();
        $pdo->prepare('UPDATE hr_candidates SET first_name=?, last_name=?, email=?, phone=?, cv_path=?, linkedin_url=?, source=?, notes=? WHERE id = ?')
            ->execute([
                trim((string)($b['first_name'] ?? $cand['first_name'])) ?: $cand['first_name'],
                trim((string)($b['last_name']  ?? $cand['last_name']))  ?: $cand['last_name'],
                trim((string)($b['email']      ?? $cand['email']))      ?: $cand['email'],
                array_key_exists('phone', $b)        ? $b['phone']        : $cand['phone'],
                array_key_exists('cv_path', $b)      ? $b['cv_path']      : $cand['cv_path'],
                array_key_exists('linkedin_url', $b) ? $b['linkedin_url'] : $cand['linkedin_url'],
                array_key_exists('source', $b)       ? $b['source']       : $cand['source'],
                array_key_exists('notes', $b)        ? $b['notes']        : $cand['notes'],
                $cid,
            ]);
        Json::send(['ok' => true]);
    }
    if ($method === 'DELETE') {
        $pdo->prepare('DELETE FROM hr_candidates WHERE id = ?')->execute([$cid]);
        Json::send(['ok' => true]);
    }
    Json::fail('Method not allowed', 405);
}

function handleApplications(\PDO|\BRS\TenantPdo $pdo, string $method, array $segs): void {
    if (!isset($segs[2])) {
        if ($method === 'POST') {
            $b = Json::readBody();
            $jid = (int)($b['job_id'] ?? 0);
            $cid = (int)($b['candidate_id'] ?? 0);
            if ($jid <= 0 || $cid <= 0) Json::fail('job_id and candidate_id required', 400);
            $ins = $pdo->prepare('INSERT IGNORE INTO hr_applications (job_id, candidate_id, stage) VALUES (?,?, "applied")');
            $ins->execute([$jid, $cid]);
            $id = (int)$pdo->lastInsertId();
            if ($id === 0) {
                $row = $pdo->prepare('SELECT id FROM hr_applications WHERE job_id = ? AND candidate_id = ?');
                $row->execute([$jid, $cid]);
                $id = (int)$row->fetchColumn();
            }
            Json::send(['id' => $id], 201);
        }
        Json::fail('Method not allowed', 405);
    }
    $aid = (int)$segs[2];
    if (($segs[3] ?? '') === 'hire' && $method === 'POST') {
        $row = $pdo->prepare('
            SELECT a.*, c.first_name, c.last_name, c.email, c.phone, j.department
            FROM hr_applications a JOIN hr_candidates c ON c.id = a.candidate_id JOIN hr_jobs j ON j.id = a.job_id
            WHERE a.id = ?');
        $row->execute([$aid]); $app = $row->fetch();
        if (!$app) Json::fail('Application not found', 404);
        $b = Json::readBody();

        $userQ = $pdo->prepare('SELECT id FROM admin_users WHERE email = ?');
        $userQ->execute([$app['email']]);
        $userId = (int)$userQ->fetchColumn();
        if (!$userId) {
            $tempPass = bin2hex(random_bytes(8));
            $hash = password_hash($tempPass, PASSWORD_DEFAULT);
            $u = $pdo->prepare('INSERT INTO admin_users (email, display_name, password_hash, role, is_active) VALUES (?,?,?, "member", 1)');
            $u->execute([$app['email'], trim($app['first_name'] . ' ' . $app['last_name']), $hash]);
            $userId = (int)$pdo->lastInsertId();
        }

        $existsQ = $pdo->prepare('SELECT id FROM hr_employees WHERE admin_user_id = ?');
        $existsQ->execute([$userId]);
        $eid = (int)$existsQ->fetchColumn();
        if (!$eid) {
            $ins = $pdo->prepare('INSERT INTO hr_employees
                (admin_user_id, first_name, last_name, phone, position, department, employment_type, hire_date, status)
                VALUES (?,?,?,?,?,?, ?, ?, "onboarding")');
            $jobRow = $pdo->prepare('SELECT title, employment_type FROM hr_jobs WHERE id = ?');
            $jobRow->execute([$app['job_id']]);
            $job = $jobRow->fetch();
            $ins->execute([
                $userId, $app['first_name'], $app['last_name'], $app['phone'],
                $job['title'], $app['department'], $job['employment_type'] ?? 'full_time',
                $b['hire_date'] ?? date('Y-m-d'),
            ]);
            $eid = (int)$pdo->lastInsertId();
            $pdo->prepare('INSERT INTO hr_employment_history (employee_id, effective_date, event_type, new_value) VALUES (?,?,"hired",?)')
                ->execute([$eid, $b['hire_date'] ?? date('Y-m-d'), $job['title']]);
        }

        $pdo->prepare('UPDATE hr_applications SET stage = "hired", decided_at = NOW() WHERE id = ?')->execute([$aid]);
        Json::send(['ok' => true, 'employee_id' => $eid]);
    }
    $row = $pdo->prepare('
        SELECT a.*, c.first_name, c.last_name, c.email, c.phone, c.cv_path, c.linkedin_url, c.source,
               j.title AS job_title
        FROM hr_applications a JOIN hr_candidates c ON c.id = a.candidate_id JOIN hr_jobs j ON j.id = a.job_id
        WHERE a.id = ?');
    $row->execute([$aid]); $app = $row->fetch();
    if (!$app) Json::fail('Application not found', 404);
    if ($method === 'GET' && ($segs[3] ?? '') === '') {
        $ints = $pdo->prepare('
            SELECT i.*, u.display_name AS interviewer_name
            FROM hr_interviews i LEFT JOIN admin_users u ON u.id = i.interviewer_id
            WHERE i.application_id = ? ORDER BY i.scheduled_at DESC');
        $ints->execute([$aid]);
        $notes = $pdo->prepare('
            SELECT n.id, n.application_id, n.author_id, n.body, n.created_at,
                   u.display_name AS author_name
            FROM hr_application_notes n LEFT JOIN admin_users u ON u.id = n.author_id
            WHERE n.application_id = ? ORDER BY n.created_at DESC, n.id DESC');
        $notes->execute([$aid]);
        Json::send([
            'application' => $app,
            'interviews'  => $ints->fetchAll(),
            'notes'       => $notes->fetchAll(),
        ]);
    }
    // /applications/:id/notes — append-only thread of recruiter notes.
    if (($segs[3] ?? '') === 'notes') {
        $claims = Auth::require();
        $uid = (int)($claims['sub'] ?? 0) ?: null;
        if ($method === 'POST' && !isset($segs[4])) {
            $b = Json::readBody();
            $body = trim((string)($b['body'] ?? ''));
            if ($body === '') Json::fail('body required', 400);
            $ins = $pdo->prepare('INSERT INTO hr_application_notes (application_id, author_id, body) VALUES (?,?,?)');
            $ins->execute([$aid, $uid, $body]);
            Json::send(['id' => (int)$pdo->lastInsertId()], 201);
        }
        if ($method === 'DELETE' && isset($segs[4])) {
            $nid = (int)$segs[4];
            $pdo->prepare('DELETE FROM hr_application_notes WHERE id = ? AND application_id = ?')->execute([$nid, $aid]);
            Json::send(['ok' => true]);
        }
        Json::fail('Method not allowed', 405);
    }
    if ($method === 'PUT') {
        $b = Json::readBody();
        $newStage = pickEnum($b['stage'] ?? null, ['applied','screening','interview','offer','hired','rejected'], $app['stage']);
        $decidedAt = in_array($newStage, ['hired','rejected'], true) && $app['stage'] !== $newStage ? date('Y-m-d H:i:s') : $app['decided_at'];
        $pdo->prepare('UPDATE hr_applications SET stage = ?, rating = ?, recruiter_notes = ?, decided_at = ?, sort_order = ? WHERE id = ?')
            ->execute([
                $newStage,
                isset($b['rating']) ? (int)$b['rating'] : $app['rating'],
                array_key_exists('recruiter_notes', $b) ? $b['recruiter_notes'] : $app['recruiter_notes'],
                $decidedAt,
                isset($b['sort_order']) ? (int)$b['sort_order'] : $app['sort_order'],
                $aid,
            ]);
        Json::send(['ok' => true]);
    }
    if (($segs[3] ?? '') === 'interviews' && $method === 'POST') {
        $b = Json::readBody();
        if (empty($b['scheduled_at'])) Json::fail('scheduled_at required', 400);
        $kind = pickEnum($b['kind'] ?? null, ['phone','video','onsite','technical','culture','panel','other'], 'video');
        $ins = $pdo->prepare('INSERT INTO hr_interviews (application_id, scheduled_at, kind, interviewer_id, feedback, rating) VALUES (?,?,?,?,?,?)');
        $ins->execute([
            $aid, $b['scheduled_at'], $kind,
            !empty($b['interviewer_id']) ? (int)$b['interviewer_id'] : null,
            $b['feedback'] ?? null,
            isset($b['rating']) ? (int)$b['rating'] : null,
        ]);
        Json::send(['id' => (int)$pdo->lastInsertId()], 201);
    }
    if ($method === 'DELETE') {
        $pdo->prepare('DELETE FROM hr_applications WHERE id = ?')->execute([$aid]);
        Json::send(['ok' => true]);
    }
    Json::fail('Method not allowed', 405);
}

/** Read-only list of hr_references for HR-side review (e.g. on the onboarding section detail). */
function handleEmpReferences(\PDO|\BRS\TenantPdo $pdo, string $method, array $segs, int $eid): void {
    if ($method !== 'GET') Json::fail('Method not allowed', 405);
    $stmt = $pdo->prepare('SELECT * FROM hr_references WHERE employee_id = ? ORDER BY sort_order, id');
    $stmt->execute([$eid]);
    Json::send(['references' => $stmt->fetchAll()]);
}

function handleVerifySection(\PDO|\BRS\TenantPdo $pdo, string $method, array $segs, int $eid): void {
    if ($method !== 'POST') Json::fail('Method not allowed', 405);
    $section = (string)($segs[4] ?? '');
    $allowed = ['profile','contact','emergency','payroll','documents','tasks','learning','background','references','diversity'];
    if (!in_array($section, $allowed, true)) Json::fail('invalid section', 400);
    $b = Json::readBody();
    $verify = !array_key_exists('verify', $b) ? true : !empty($b['verify']);

    $row = $pdo->prepare('SELECT onboarding_progress_json FROM hr_employees WHERE id = ?');
    $row->execute([$eid]);
    $emp = $row->fetch();
    if (!$emp) Json::fail('Employee not found', 404);

    $progress = json_decode($emp['onboarding_progress_json'] ?? '', true) ?: [];
    $claims = Auth::require();
    $cur = $progress[$section] ?? [];
    if ($verify) {
        // Verifying clears any prior rejection — the section is now approved.
        $cur['verified_at']     = date('Y-m-d H:i:s');
        $cur['verified_by']     = (int)($claims['sub'] ?? 0) ?: null;
        $cur['rejected_at']     = null;
        $cur['rejected_by']     = null;
        $cur['rejected_reason'] = null;
    } else {
        $cur['verified_at'] = null;
        $cur['verified_by'] = null;
    }
    $progress[$section] = $cur;
    $pdo->prepare('UPDATE hr_employees SET onboarding_progress_json = ? WHERE id = ?')
        ->execute([json_encode($progress), $eid]);
    Json::send(['ok' => true, 'progress' => $progress]);
}

/** HR rejects a submitted section with a reason; employee sees it on the portal and re-submits. */
function handleRejectSection(\PDO|\BRS\TenantPdo $pdo, string $method, array $segs, int $eid): void {
    if ($method !== 'POST') Json::fail('Method not allowed', 405);
    $section = (string)($segs[4] ?? '');
    $allowed = ['profile','contact','emergency','payroll','documents','tasks','learning','background','references','diversity'];
    if (!in_array($section, $allowed, true)) Json::fail('invalid section', 400);
    $b = Json::readBody();
    $reason = trim((string)($b['reason'] ?? ''));
    if ($reason === '') Json::fail('reason required', 400);

    $row = $pdo->prepare('SELECT onboarding_progress_json FROM hr_employees WHERE id = ?');
    $row->execute([$eid]);
    $emp = $row->fetch();
    if (!$emp) Json::fail('Employee not found', 404);

    $progress = json_decode($emp['onboarding_progress_json'] ?? '', true) ?: [];
    $claims = Auth::require();
    $cur = $progress[$section] ?? [];
    $cur['rejected_at']     = date('Y-m-d H:i:s');
    $cur['rejected_by']     = (int)($claims['sub'] ?? 0) ?: null;
    $cur['rejected_reason'] = $reason;
    $cur['verified_at']     = null;
    $cur['verified_by']     = null;
    $progress[$section] = $cur;
    $pdo->prepare('UPDATE hr_employees SET onboarding_progress_json = ? WHERE id = ?')
        ->execute([json_encode($progress), $eid]);
    Json::send(['ok' => true, 'progress' => $progress]);
}

function handleDocumentTypes(\PDO|\BRS\TenantPdo $pdo, string $method, array $segs): void {
    // /hr/document-types/template-image — upload an image used inside a signed-document template.
    if (($segs[2] ?? null) === 'template-image' && $method === 'POST') {
        if (empty($_FILES['file'])) Json::fail('file required', 400);
        $f = $_FILES['file'];
        if ($f['error'] !== UPLOAD_ERR_OK) Json::fail('upload failed (code ' . $f['error'] . ')', 400);
        if (strpos((string)($f['type'] ?? ''), 'image/') !== 0) Json::fail('image required', 400);
        $dir = __DIR__ . '/../../uploads/hr/templates/images';
        if (!is_dir($dir)) @mkdir($dir, 0775, true);
        $safe = preg_replace('/[^A-Za-z0-9._-]+/', '_', basename($f['name']));
        $name = time() . '_' . bin2hex(random_bytes(3)) . '_' . $safe;
        $dest = $dir . '/' . $name;
        if (!move_uploaded_file($f['tmp_name'], $dest)) Json::fail('failed to save image', 500);
        Json::send(['url' => 'uploads/hr/templates/images/' . $name], 201);
    }
    if (!isset($segs[2])) {
        if ($method === 'GET') {
            $stmt = $pdo->query('SELECT * FROM hr_document_types ORDER BY sort_order, id');
            Json::send(['types' => $stmt->fetchAll()]);
        }
        if ($method === 'POST') {
            // Two shapes: JSON body (upload kind) or multipart (signed kind with template).
            $isMultipart = !empty($_FILES) || !empty($_POST);
            if ($isMultipart) {
                $name = trim((string)($_POST['name'] ?? ''));
                if ($name === '') Json::fail('name required', 400);
                $kind = pickEnum($_POST['kind'] ?? null, ['upload','signed','contract'], 'upload');
                $templatePath = null; $templateMime = null; $templateSize = null;
                // 'signed' and 'contract' both ride the template-upload path.
                if ($kind === 'signed' || $kind === 'contract') {
                    if (empty($_FILES['template'])) Json::fail('template file required for signed documents', 400);
                    $f = $_FILES['template'];
                    if ($f['error'] !== UPLOAD_ERR_OK) Json::fail('upload failed (code ' . $f['error'] . ')', 400);
                    $dir = __DIR__ . '/../../uploads/hr/templates';
                    if (!is_dir($dir)) @mkdir($dir, 0775, true);
                    $safe = preg_replace('/[^A-Za-z0-9._-]+/', '_', basename($f['name']));
                    $fname = time() . '_' . $safe;
                    $dest = $dir . '/' . $fname;
                    if (!move_uploaded_file($f['tmp_name'], $dest)) Json::fail('failed to save template', 500);
                    $templatePath = 'uploads/hr/templates/' . $fname;
                    $templateMime = $f['type'] ?? null;
                    $templateSize = (int)$f['size'];
                }
                $blocksJson = isset($_POST['blocks_json']) && trim((string)$_POST['blocks_json']) !== ''
                    ? (string)$_POST['blocks_json'] : null;
                $audience = ($kind === 'contract')
                    ? pickEnum($_POST['audience'] ?? null, ['employee','client','lead','partner','affiliate','contractor','candidate','applicant','supplier','investor'], 'employee')
                    : 'employee';
                $contractTypeId = ($kind === 'contract' && isset($_POST['contract_type_id']) && $_POST['contract_type_id'] !== '')
                    ? (int)$_POST['contract_type_id'] : null;
                $groupId = ($kind === 'contract' && isset($_POST['group_id']) && $_POST['group_id'] !== '')
                    ? (int)$_POST['group_id'] : null;
                $addToOnboarding = ($kind === 'contract' && !empty($_POST['add_to_onboarding'])) ? 1 : 0;
                $ins = $pdo->prepare('INSERT INTO hr_document_types
                    (name, description, kind, audience, contract_type_id, group_id, add_to_onboarding,
                     template_path, template_mime, template_size, template_blocks_json,
                     is_required, needs_reference, needs_issue_date, needs_expiry_date, sort_order)
                    VALUES (?,?,?,?,?,?,?, ?,?,?,?, ?,?,?,?,?)');
                $ins->execute([
                    $name,
                    $_POST['description'] ?? null,
                    $kind, $audience, $contractTypeId, $groupId, $addToOnboarding,
                    $templatePath, $templateMime, $templateSize, $blocksJson,
                    !empty($_POST['is_required'])       ? 1 : 0,
                    !empty($_POST['needs_reference'])   ? 1 : 0,
                    !empty($_POST['needs_issue_date'])  ? 1 : 0,
                    !empty($_POST['needs_expiry_date']) ? 1 : 0,
                    (int)($_POST['sort_order'] ?? 0),
                ]);
                $newId = (int)$pdo->lastInsertId();
                if (($kind === 'signed' || $kind === 'contract') && $templatePath) {
                    \BRS\Contracts::distributeTemplate($pdo, $newId, $name, $templatePath, $templateMime, $templateSize, $kind, $audience);
                }
                Json::send(['id' => $newId], 201);
            }
            $b = Json::readBody();
            $name = trim((string)($b['name'] ?? ''));
            if ($name === '') Json::fail('name required', 400);
            $ins = $pdo->prepare('INSERT INTO hr_document_types
                (name, description, is_required, needs_reference, needs_issue_date, needs_expiry_date, sort_order)
                VALUES (?,?,?,?,?,?,?)');
            $ins->execute([
                $name,
                $b['description'] ?? null,
                !empty($b['is_required'])       ? 1 : 0,
                !empty($b['needs_reference'])   ? 1 : 0,
                !empty($b['needs_issue_date'])  ? 1 : 0,
                !empty($b['needs_expiry_date']) ? 1 : 0,
                (int)($b['sort_order'] ?? 0),
            ]);
            Json::send(['id' => (int)$pdo->lastInsertId()], 201);
        }
        Json::fail('Method not allowed', 405);
    }
    $id = (int)$segs[2];
    $row = $pdo->prepare('SELECT * FROM hr_document_types WHERE id = ?'); $row->execute([$id]);
    $cur = $row->fetch();
    if (!$cur) Json::fail('Type not found', 404);
    // Multipart update — used when re-rendering / replacing a signed-document template.
    if ($method === 'POST' && (!empty($_FILES) || !empty($_POST))) {
        $name = trim((string)($_POST['name'] ?? $cur['name']));
        if ($name === '') $name = $cur['name'];
        $kind = $cur['kind'] ?? 'upload';
        $tplPath = $cur['template_path'];
        $tplMime = $cur['template_mime'];
        $tplSize = $cur['template_size'];
        if (($kind === 'signed' || $kind === 'contract') && !empty($_FILES['template'])) {
            $f = $_FILES['template'];
            if ($f['error'] !== UPLOAD_ERR_OK) Json::fail('upload failed (code ' . $f['error'] . ')', 400);
            $dir = __DIR__ . '/../../uploads/hr/templates';
            if (!is_dir($dir)) @mkdir($dir, 0775, true);
            $safe = preg_replace('/[^A-Za-z0-9._-]+/', '_', basename($f['name']));
            $fname = time() . '_' . $safe;
            $dest = $dir . '/' . $fname;
            if (!move_uploaded_file($f['tmp_name'], $dest)) Json::fail('failed to save template', 500);
            // Best-effort cleanup of the previous template file.
            if ($tplPath) {
                $abs = __DIR__ . '/../../' . $tplPath;
                if (is_file($abs)) @unlink($abs);
            }
            $tplPath = 'uploads/hr/templates/' . $fname;
            $tplMime = $f['type'] ?? null;
            $tplSize = (int)$f['size'];
        }
        $blocksJson = array_key_exists('blocks_json', $_POST)
            ? (trim((string)$_POST['blocks_json']) === '' ? null : (string)$_POST['blocks_json'])
            : $cur['template_blocks_json'];
        $groupId = array_key_exists('group_id', $_POST)
            ? ($_POST['group_id'] === '' || $_POST['group_id'] === null ? null : (int)$_POST['group_id'])
            : ($cur['group_id'] !== null ? (int)$cur['group_id'] : null);
        $addToOnboarding = array_key_exists('add_to_onboarding', $_POST)
            ? (!empty($_POST['add_to_onboarding']) ? 1 : 0)
            : (int)($cur['add_to_onboarding'] ?? 0);
        $pdo->prepare('UPDATE hr_document_types
            SET name=?, description=?, group_id=?, add_to_onboarding=?, template_path=?, template_mime=?, template_size=?, template_blocks_json=?,
                is_required=?, needs_reference=?, needs_issue_date=?, needs_expiry_date=?, sort_order=?
            WHERE id=?')->execute([
            $name,
            array_key_exists('description', $_POST) ? ($_POST['description'] !== '' ? $_POST['description'] : null) : $cur['description'],
            $groupId, $addToOnboarding,
            $tplPath, $tplMime, $tplSize, $blocksJson,
            isset($_POST['is_required'])       ? (int)!!$_POST['is_required']       : (int)$cur['is_required'],
            isset($_POST['needs_reference'])   ? (int)!!$_POST['needs_reference']   : (int)$cur['needs_reference'],
            isset($_POST['needs_issue_date'])  ? (int)!!$_POST['needs_issue_date']  : (int)$cur['needs_issue_date'],
            isset($_POST['needs_expiry_date']) ? (int)!!$_POST['needs_expiry_date'] : (int)$cur['needs_expiry_date'],
            isset($_POST['sort_order'])        ? (int)$_POST['sort_order']          : (int)$cur['sort_order'],
            $id,
        ]);
        // If the template file was replaced, push the new file_path/title down to
        // every pending (unsigned) row across whichever audience this template
        // serves so existing distributions stay in sync.
        if (($kind === 'signed' || $kind === 'contract') && !empty($_FILES['template'])) {
            $table = \BRS\Contracts::docsTable($cur['audience'] ?? 'employee');
            $pdo->prepare("UPDATE `$table`
                SET title = ?, file_path = ?, file_size = ?, mime_type = ?
                WHERE doc_type_id = ? AND signed_at IS NULL")
                ->execute([$name, $tplPath, $tplSize, $tplMime, $id]);
        }
        Json::send(['ok' => true]);
    }
    if ($method === 'PUT') {
        $b = Json::readBody();
        $pdo->prepare('UPDATE hr_document_types
            SET name=?, description=?, is_required=?, needs_reference=?, needs_issue_date=?, needs_expiry_date=?, sort_order=?
            WHERE id=?')->execute([
            trim((string)($b['name'] ?? $cur['name'])) ?: $cur['name'],
            array_key_exists('description', $b) ? $b['description'] : $cur['description'],
            isset($b['is_required'])       ? (int)!!$b['is_required']       : (int)$cur['is_required'],
            isset($b['needs_reference'])   ? (int)!!$b['needs_reference']   : (int)$cur['needs_reference'],
            isset($b['needs_issue_date'])  ? (int)!!$b['needs_issue_date']  : (int)$cur['needs_issue_date'],
            isset($b['needs_expiry_date']) ? (int)!!$b['needs_expiry_date'] : (int)$cur['needs_expiry_date'],
            isset($b['sort_order']) ? (int)$b['sort_order'] : (int)$cur['sort_order'],
            $id,
        ]);
        Json::send(['ok' => true]);
    }
    if ($method === 'DELETE') {
        // For template-driven types (signed / contract), also delete pending
        // (unsigned) rows we distributed. Already-signed copies stay.
        $curKind = $cur['kind'] ?? 'upload';
        if ($curKind === 'signed' || $curKind === 'contract') {
            $table = \BRS\Contracts::docsTable($cur['audience'] ?? 'employee');
            $pdo->prepare("DELETE FROM `$table` WHERE doc_type_id = ? AND signed_at IS NULL")->execute([$id]);
        }
        $pdo->prepare('DELETE FROM hr_document_types WHERE id = ?')->execute([$id]);
        Json::send(['ok' => true]);
    }
    Json::fail('Method not allowed', 405);
}

/**
 * Contract groups (092) — collapsible buckets for contract templates on the
 * Operations → Contracts page. Mirrors handleRecruitmentDocGroups.
 *   GET    /api/hr/contract-groups
 *   POST   /api/hr/contract-groups            { name, sort_order? }
 *   PUT    /api/hr/contract-groups/:id        { name?, sort_order? }
 *   DELETE /api/hr/contract-groups/:id        (types fall back to Ungrouped)
 */
function handleContractGroups(\PDO|\BRS\TenantPdo $pdo, string $method, array $segs): void {
    if (!isset($segs[2])) {
        if ($method === 'GET') {
            $rows = $pdo->query('SELECT id, name, sort_order FROM hr_contract_groups ORDER BY sort_order, id')->fetchAll();
            Json::send(['groups' => $rows]);
        }
        if ($method === 'POST') {
            $b = Json::readBody();
            $name = trim((string)($b['name'] ?? ''));
            if ($name === '') Json::fail('name required', 400);
            $sort = isset($b['sort_order']) ? (int)$b['sort_order']
                : ((int)$pdo->query('SELECT COALESCE(MAX(sort_order),0)+10 FROM hr_contract_groups')->fetchColumn());
            $pdo->prepare('INSERT INTO hr_contract_groups (name, sort_order) VALUES (?,?)')->execute([$name, $sort]);
            Json::send(['id' => (int)$pdo->lastInsertId()], 201);
        }
        Json::fail('Method not allowed', 405);
    }
    $id = (int)$segs[2];
    if ($id <= 0) Json::fail('Invalid id', 400);
    $row = $pdo->prepare('SELECT * FROM hr_contract_groups WHERE id = ?');
    $row->execute([$id]);
    $cur = $row->fetch();
    if (!$cur) Json::fail('Group not found', 404);

    if ($method === 'PUT') {
        $b = Json::readBody();
        $pdo->prepare('UPDATE hr_contract_groups SET name = ?, sort_order = ? WHERE id = ?')
            ->execute([
                trim((string)($b['name'] ?? $cur['name'])) ?: $cur['name'],
                isset($b['sort_order']) ? (int)$b['sort_order'] : (int)$cur['sort_order'],
                $id,
            ]);
        Json::send(['ok' => true]);
    }
    if ($method === 'DELETE') {
        // FK on hr_document_types.group_id is ON DELETE SET NULL — contracts in
        // this group become "Ungrouped", they are NOT deleted.
        $pdo->prepare('DELETE FROM hr_contract_groups WHERE id = ?')->execute([$id]);
        Json::send(['ok' => true]);
    }
    Json::fail('Method not allowed', 405);
}

// Multi-audience contract helpers (audience → table mapping, fan-out,
// template distribution) live in lib/Contracts.php so the entity create
// handlers in clients.php / partners.php / affiliates.php / contractors.php
// can call into them too (only one route file is loaded per request).

/**
 * /api/hr/contract-types — editable lookup of contract categories
 * (NDA / MSA / employment / etc.). Referenced by
 * `hr_document_types.contract_type_id`. Slugs are derived from the name
 * on create unless the caller supplies one.
 *
 *   GET    /api/hr/contract-types          → { types: [...] }
 *   POST   /api/hr/contract-types          → { id }
 *   PUT    /api/hr/contract-types/:id      → { ok }
 *   DELETE /api/hr/contract-types/:id      → { ok }
 */
function handleContractTypes(\PDO|\BRS\TenantPdo $pdo, string $method, array $segs): void {
    Auth::require();
    if (!isset($segs[2])) {
        if ($method === 'GET') {
            $rows = $pdo->query('SELECT id, name, slug, sort_order FROM contract_types ORDER BY sort_order, id')->fetchAll();
            Json::send(['types' => $rows]);
        }
        if ($method === 'POST') {
            $b = Json::readBody();
            $name = trim((string)($b['name'] ?? ''));
            if ($name === '') Json::fail('name required', 400);
            $slug = trim((string)($b['slug'] ?? ''));
            if ($slug === '') {
                $slug = preg_replace('/[^a-z0-9]+/', '-', strtolower($name)) ?? '';
                $slug = trim($slug, '-') ?: 'type';
            }
            $base = $slug; $i = 2;
            $check = $pdo->prepare('SELECT 1 FROM contract_types WHERE slug = ?');
            while (true) {
                $check->execute([$slug]);
                if (!$check->fetchColumn()) break;
                $slug = $base . '-' . $i++;
            }
            $sortOrder = isset($b['sort_order']) ? (int)$b['sort_order']
                : ((int)$pdo->query('SELECT COALESCE(MAX(sort_order),0)+10 FROM contract_types')->fetchColumn());
            $ins = $pdo->prepare('INSERT INTO contract_types (name, slug, sort_order) VALUES (?,?,?)');
            $ins->execute([$name, $slug, $sortOrder]);
            Json::send(['id' => (int)$pdo->lastInsertId(), 'slug' => $slug], 201);
        }
        Json::fail('Method not allowed', 405);
    }
    $id = (int)$segs[2];
    $cur = $pdo->prepare('SELECT * FROM contract_types WHERE id = ?');
    $cur->execute([$id]);
    $row = $cur->fetch();
    if (!$row) Json::fail('Type not found', 404);

    if ($method === 'PUT') {
        $b = $body = Json::readBody();
        $name = trim((string)($b['name'] ?? $row['name'])) ?: $row['name'];
        $sort = isset($b['sort_order']) ? (int)$b['sort_order'] : (int)$row['sort_order'];
        $pdo->prepare('UPDATE contract_types SET name = ?, sort_order = ? WHERE id = ?')
            ->execute([$name, $sort, $id]);
        Json::send(['ok' => true]);
    }
    if ($method === 'DELETE') {
        // FK on hr_document_types.contract_type_id is ON DELETE SET NULL, so
        // existing templates lose the type tag but otherwise stay intact.
        $pdo->prepare('DELETE FROM contract_types WHERE id = ?')->execute([$id]);
        Json::send(['ok' => true]);
    }
    Json::fail('Method not allowed', 405);
}

function defaultReviewQuestions(): array {
    return [
        ['id' => 'communication',     'type' => 'rating', 'label' => 'Communication'],
        ['id' => 'technical',         'type' => 'rating', 'label' => 'Technical skill'],
        ['id' => 'ownership',         'type' => 'rating', 'label' => 'Ownership & accountability'],
        ['id' => 'collaboration',     'type' => 'rating', 'label' => 'Collaboration'],
        ['id' => 'growth',            'type' => 'rating', 'label' => 'Growth & learning'],
        ['id' => 'highlights',        'type' => 'text',   'label' => 'Key highlights of the period'],
        ['id' => 'improvement',       'type' => 'text',   'label' => 'Areas for improvement'],
    ];
}

/**
 * Slugify a title for use in legal-document URLs. Mirrors the same
 * `[^a-z0-9]+ → -` rule used elsewhere in the project; uniqueness is
 * enforced by the DB UNIQUE on hr_legal_documents.slug, with a numeric
 * suffix appended on collision so re-using a title still works.
 */
function slugifyLegal(string $s): string {
    $s = strtolower($s);
    $s = preg_replace('/[^a-z0-9]+/', '-', $s) ?? '';
    return trim($s, '-') ?: 'document';
}
function uniqueLegalSlug(\PDO|\BRS\TenantPdo $pdo, string $base, ?int $excludeId = null): string {
    $slug = $base;
    $i = 2;
    while (true) {
        $sql = 'SELECT id FROM hr_legal_documents WHERE slug = ?';
        $params = [$slug];
        if ($excludeId !== null) { $sql .= ' AND id <> ?'; $params[] = $excludeId; }
        $stmt = $pdo->prepare($sql . ' LIMIT 1');
        $stmt->execute($params);
        if (!$stmt->fetchColumn()) return $slug;
        $slug = $base . '-' . $i++;
    }
}

/**
 * /hr/legal — policies, T&Cs, privacy, etc. Each row is its own page.
 *
 *   GET    /api/hr/legal                 list (admin sees drafts + published)
 *   POST   /api/hr/legal                 create
 *   GET    /api/hr/legal/:idOrSlug       single document
 *   PUT    /api/hr/legal/:id             update
 *   DELETE /api/hr/legal/:id             delete
 */
function handleLegal(\PDO|\BRS\TenantPdo $pdo, string $method, array $segs): void {
    $claims = Auth::require();
    $uid = (int)($claims['sub'] ?? 0) ?: null;

    if (!isset($segs[2])) {
        if ($method === 'GET') {
            $rows = $pdo->query('SELECT id, slug, title, category, summary, is_published,
                                        show_in_sidenav, parent_id, sort_order,
                                        created_at, updated_at, created_by, updated_by
                                 FROM hr_legal_documents
                                 ORDER BY sort_order, title')->fetchAll();
            Json::send(['documents' => $rows]);
        }
        if ($method === 'POST') {
            $b = Json::readBody();
            $title = trim((string)($b['title'] ?? ''));
            if ($title === '') Json::fail('title required', 400);
            $slugBase = trim((string)($b['slug'] ?? '')) !== ''
                ? slugifyLegal((string)$b['slug'])
                : slugifyLegal($title);
            $slug = uniqueLegalSlug($pdo, $slugBase);
            $cat  = trim((string)($b['category'] ?? 'policy')) ?: 'policy';
            // show_in_sidenav defaults to 1 — most policies should appear there.
            $showInSidenav = array_key_exists('show_in_sidenav', $b) ? (!empty($b['show_in_sidenav']) ? 1 : 0) : 1;
            $parentId = !empty($b['parent_id']) ? (int)$b['parent_id'] : null;

            $ins = $pdo->prepare('INSERT INTO hr_legal_documents
                (slug, title, category, summary, body, is_published, show_in_sidenav, parent_id, sort_order, created_by, updated_by)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)');
            $ins->execute([
                $slug, $title, $cat,
                trim((string)($b['summary'] ?? '')) ?: null,
                $b['body'] ?? null,
                !empty($b['is_published']) ? 1 : 0,
                $showInSidenav, $parentId,
                isset($b['sort_order']) ? (int)$b['sort_order'] : 0,
                $uid, $uid,
            ]);
            Json::send(['id' => (int)$pdo->lastInsertId(), 'slug' => $slug], 201);
        }
        Json::fail('Method not allowed', 405);
    }

    $key = (string)$segs[2];
    // Allow lookup by numeric id or by slug — list page links by slug.
    if (ctype_digit($key)) {
        $row = $pdo->prepare('SELECT * FROM hr_legal_documents WHERE id = ?');
        $row->execute([(int)$key]);
    } else {
        $row = $pdo->prepare('SELECT * FROM hr_legal_documents WHERE slug = ?');
        $row->execute([$key]);
    }
    $doc = $row->fetch();
    if (!$doc) Json::fail('Legal document not found', 404);

    if ($method === 'GET') Json::send(['document' => $doc]);

    $id = (int)$doc['id'];
    if ($method === 'PUT') {
        $b = Json::readBody();
        $title = array_key_exists('title', $b) ? trim((string)$b['title']) : (string)$doc['title'];
        if ($title === '') Json::fail('title required', 400);
        // If the title or slug changed, regenerate the slug (excluding self
        // from uniqueness check) so the URL stays in sync with the title.
        $slug = (string)$doc['slug'];
        if (array_key_exists('slug', $b) && trim((string)$b['slug']) !== '') {
            $slug = uniqueLegalSlug($pdo, slugifyLegal((string)$b['slug']), $id);
        } elseif (array_key_exists('title', $b) && $title !== $doc['title']) {
            $slug = uniqueLegalSlug($pdo, slugifyLegal($title), $id);
        }

        // parent_id: explicit null clears the link. Cycle prevention is the
        // frontend's job (its dropdown excludes the doc + its descendants);
        // a self-reference is silently rejected here as a safety net.
        $parentId = (int)$doc['parent_id'];
        if (array_key_exists('parent_id', $b)) {
            $raw = $b['parent_id'];
            $parentId = ($raw === null || $raw === '' || (int)$raw === 0) ? null : (int)$raw;
            if ($parentId === $id) $parentId = null;
        }

        $pdo->prepare('UPDATE hr_legal_documents SET
            slug=?, title=?, category=?, summary=?, body=?, is_published=?,
            show_in_sidenav=?, parent_id=?, sort_order=?, updated_by=?
            WHERE id=?')->execute([
            $slug,
            $title,
            array_key_exists('category', $b) ? (trim((string)$b['category']) ?: 'policy') : (string)$doc['category'],
            array_key_exists('summary', $b)  ? (trim((string)$b['summary']) ?: null)      : $doc['summary'],
            array_key_exists('body', $b)     ? $b['body']                                  : $doc['body'],
            array_key_exists('is_published', $b)    ? (!empty($b['is_published']) ? 1 : 0)    : (int)$doc['is_published'],
            array_key_exists('show_in_sidenav', $b) ? (!empty($b['show_in_sidenav']) ? 1 : 0) : (int)$doc['show_in_sidenav'],
            $parentId,
            array_key_exists('sort_order', $b) ? (int)$b['sort_order']                     : (int)$doc['sort_order'],
            $uid,
            $id,
        ]);
        Json::send(['ok' => true, 'slug' => $slug]);
    }
    if ($method === 'DELETE') {
        $pdo->prepare('DELETE FROM hr_legal_documents WHERE id = ?')->execute([$id]);
        Json::send(['ok' => true]);
    }
    Json::fail('Method not allowed', 405);
}
