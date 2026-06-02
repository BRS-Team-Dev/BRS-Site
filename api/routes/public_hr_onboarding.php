<?php
declare(strict_types=1);

use BRS\Db;
use BRS\Json;

require_once __DIR__ . '/../lib/hr_course.php';

/*
 * Public employee onboarding portal — no auth, only the token is the access control.
 *
 *   GET  /api/public-hr-onboarding/:token                   — full snapshot
 *   POST /api/public-hr-onboarding/:token/profile           — basic profile fields
 *   POST /api/public-hr-onboarding/:token/contact           — phone + address
 *   POST /api/public-hr-onboarding/:token/emergency         — emergency contact
 *   POST /api/public-hr-onboarding/:token/documents         — multipart upload
 *   DELETE /api/public-hr-onboarding/:token/documents/:did  — remove an upload
 *   POST /api/public-hr-onboarding/:token/learning/:aid     — mark course in_progress / completed
 *   POST /api/public-hr-onboarding/:token/submit/:section   — mark a section complete
 */

return function (string $method, array $segs): void {
    $pdo = Db::pdo();
    $token = (string)($segs[1] ?? '');
    if ($token === '' || strlen($token) < 16) Json::fail('token required', 400);

    $row = $pdo->prepare('SELECT * FROM hr_employees WHERE onboarding_token = ?');
    $row->execute([$token]);
    $emp = $row->fetch();
    if (!$emp) Json::fail('Invalid or expired link', 404);

    $eid = (int)$emp['id'];
    $sub = (string)($segs[2] ?? '');

    if ($sub === '' && $method === 'GET') {
        // Auto-seed the default checklist if none exist yet (covers older employees).
        $countQ = $pdo->prepare('SELECT COUNT(*) FROM hr_onboarding_tasks WHERE employee_id = ?');
        $countQ->execute([$eid]);
        if ((int)$countQ->fetchColumn() === 0) {
            $defs = $pdo->query('SELECT title, description, category, linked_section, sort_order FROM hr_default_onboarding_tasks ORDER BY sort_order, id')->fetchAll();
            $taskIns = $pdo->prepare('INSERT INTO hr_onboarding_tasks (employee_id, title, description, category, linked_section, sort_order) VALUES (?,?,?,?,?,?)');
            foreach ($defs as $dt) {
                $taskIns->execute([$eid, $dt['title'], $dt['description'], $dt['category'], $dt['linked_section'], (int)$dt['sort_order']]);
            }
        }

        // Full snapshot for the portal.
        $u = $pdo->prepare('SELECT email, display_name FROM admin_users WHERE id = ?');
        $u->execute([$emp['admin_user_id']]); $user = $u->fetch();
        $tasks = $pdo->prepare('SELECT * FROM hr_onboarding_tasks WHERE employee_id = ? ORDER BY sort_order, id');
        $tasks->execute([$eid]);
        $references = $pdo->prepare('SELECT * FROM hr_references WHERE employee_id = ? ORDER BY sort_order, id');
        $references->execute([$eid]);
        $docs = $pdo->prepare('SELECT id, doc_type_id, category, title, file_path, mime_type, requires_signature, signed_at,
                                      reference_number, issued_at, expires_at, uploaded_at
                               FROM hr_documents WHERE employee_id = ? ORDER BY uploaded_at DESC');
        $docs->execute([$eid]);
        $docTypes = $pdo->query('SELECT * FROM hr_document_types ORDER BY sort_order, id')->fetchAll();
        $learning = $pdo->prepare('
            SELECT a.*, c.title, c.provider, c.category, c.link, c.duration_hours, c.is_required
            FROM hr_course_assignments a JOIN hr_courses c ON c.id = a.course_id
            WHERE a.employee_id = ? ORDER BY a.due_date IS NULL, a.due_date');
        $learning->execute([$eid]);

        $progress = json_decode($emp['onboarding_progress_json'] ?? '', true) ?: [];
        Json::send([
            'employee'  => [
                'id'              => $eid,
                'first_name'      => $emp['first_name'],
                'last_name'       => $emp['last_name'],
                'preferred_name'  => $emp['preferred_name'],
                'pronouns'        => $emp['pronouns']        ?? null,
                'gender'          => $emp['gender']          ?? null,
                'nationality'     => $emp['nationality']     ?? null,
                'national_insurance_number' => $emp['national_insurance_number'] ?? null,
                'linkedin_url'    => $emp['linkedin_url']    ?? null,
                'dob'             => $emp['dob'],
                'phone'           => $emp['phone'],
                'address_line1'   => $emp['address_line1'],
                'address_line2'   => $emp['address_line2'],
                'city'            => $emp['city'],
                'region'          => $emp['region'],
                'postcode'        => $emp['postcode'],
                'country'         => $emp['country'],
                'current_location' => $emp['current_location'] ?? null,
                'emergency_name'  => $emp['emergency_name'],
                'emergency_phone' => $emp['emergency_phone'],
                'emergency_rel'   => $emp['emergency_rel'],
                'position'        => $emp['position'],
                'department'      => $emp['department'],
                'hire_date'       => $emp['hire_date'],
                'tax_code'           => $emp['tax_code']           ?? null,
                'student_loan_plan'  => $emp['student_loan_plan']  ?? 'none',
                'pension_opt_in'        => (int)($emp['pension_opt_in'] ?? 1),
                'pension_employee_pct'  => (float)($emp['pension_employee_pct'] ?? 5),
                'pension_employer_pct'  => (float)($emp['pension_employer_pct'] ?? 3),
                'bank_name'          => $emp['bank_name']          ?? null,
                'bank_account_name'  => $emp['bank_account_name']  ?? null,
                'sort_code'          => $emp['sort_code']          ?? null,
                'account_number'     => $emp['account_number']     ?? null,
                'ethnicity'              => $emp['ethnicity']              ?? null,
                'disability_status'      => $emp['disability_status']      ?? null,
                'accommodations_needed'  => $emp['accommodations_needed']  ?? null,
                'dietary_requirements'   => $emp['dietary_requirements']   ?? null,
                'tshirt_size'            => $emp['tshirt_size']            ?? null,
                'criminal_record_declared' => $emp['criminal_record_declared'] ?? null,
                'criminal_record_details'  => $emp['criminal_record_details']  ?? null,
                'dbs_check_ref'            => $emp['dbs_check_ref']            ?? null,
                'dbs_check_date'           => $emp['dbs_check_date']           ?? null,
                'email'           => $user['email'] ?? null,
                'display_name'    => $user['display_name'] ?? null,
            ],
            'progress'      => $progress,
            'tasks'         => $tasks->fetchAll(),
            'documents'     => $docs->fetchAll(),
            'document_types' => $docTypes,
            'references'    => $references->fetchAll(),
            'learning'      => $learning->fetchAll(),
        ]);
    }

    if ($sub === 'profile' && $method === 'POST') {
        $b = Json::readBody();
        $pdo->prepare('UPDATE hr_employees SET
            preferred_name = ?, dob = ?,
            pronouns = ?, gender = ?, nationality = ?,
            national_insurance_number = ?, linkedin_url = ?
            WHERE id = ?')->execute([
            array_key_exists('preferred_name', $b)            ? $b['preferred_name']            : $emp['preferred_name'],
            array_key_exists('dob', $b)                       ? ($b['dob'] ?: null)             : $emp['dob'],
            array_key_exists('pronouns', $b)                  ? $b['pronouns']                  : $emp['pronouns'],
            array_key_exists('gender', $b)                    ? $b['gender']                    : $emp['gender'],
            array_key_exists('nationality', $b)               ? $b['nationality']               : $emp['nationality'],
            array_key_exists('national_insurance_number', $b) ? $b['national_insurance_number'] : $emp['national_insurance_number'],
            array_key_exists('linkedin_url', $b)              ? $b['linkedin_url']              : $emp['linkedin_url'],
            $eid,
        ]);
        Json::send(['ok' => true]);
    }

    if ($sub === 'payroll' && $method === 'POST') {
        $b = Json::readBody();
        $allowedPlans = ['none','plan_1','plan_2','plan_4','postgrad'];
        $newPlan = array_key_exists('student_loan_plan', $b) && in_array($b['student_loan_plan'], $allowedPlans, true)
            ? $b['student_loan_plan']
            : ($emp['student_loan_plan'] ?? 'none');
        $clamp = fn($v, $min, $max) => max($min, min($max, (float)$v));
        $empPct = isset($b['pension_employee_pct']) ? $clamp($b['pension_employee_pct'], 0, 14) : (float)($emp['pension_employee_pct'] ?? 5);
        $erPct  = $empPct; // Employer matches employee contribution.
        $pdo->prepare('UPDATE hr_employees SET
            tax_code = ?, student_loan_plan = ?, pension_opt_in = ?, pension_employee_pct = ?, pension_employer_pct = ?,
            bank_name = ?, bank_account_name = ?, sort_code = ?, account_number = ?
            WHERE id = ?')->execute([
            array_key_exists('tax_code', $b)          ? $b['tax_code']          : $emp['tax_code'],
            $newPlan,
            isset($b['pension_opt_in'])               ? (int)!!$b['pension_opt_in'] : (int)($emp['pension_opt_in'] ?? 1),
            $empPct,
            $erPct,
            array_key_exists('bank_name', $b)         ? $b['bank_name']         : $emp['bank_name'],
            array_key_exists('bank_account_name', $b) ? $b['bank_account_name'] : $emp['bank_account_name'],
            array_key_exists('sort_code', $b)         ? $b['sort_code']         : $emp['sort_code'],
            array_key_exists('account_number', $b)    ? $b['account_number']    : $emp['account_number'],
            $eid,
        ]);
        Json::send(['ok' => true]);
    }

    if ($sub === 'diversity' && $method === 'POST') {
        $b = Json::readBody();
        $pdo->prepare('UPDATE hr_employees SET
            ethnicity = ?, disability_status = ?, accommodations_needed = ?,
            dietary_requirements = ?, tshirt_size = ?
            WHERE id = ?')->execute([
            array_key_exists('ethnicity', $b)             ? $b['ethnicity']             : $emp['ethnicity'],
            array_key_exists('disability_status', $b)     ? $b['disability_status']     : $emp['disability_status'],
            array_key_exists('accommodations_needed', $b) ? $b['accommodations_needed'] : $emp['accommodations_needed'],
            array_key_exists('dietary_requirements', $b)  ? $b['dietary_requirements']  : $emp['dietary_requirements'],
            array_key_exists('tshirt_size', $b)           ? $b['tshirt_size']           : $emp['tshirt_size'],
            $eid,
        ]);
        Json::send(['ok' => true]);
    }

    if ($sub === 'contact' && $method === 'POST') {
        $b = Json::readBody();
        $pdo->prepare('UPDATE hr_employees
            SET phone = ?, address_line1 = ?, address_line2 = ?, city = ?, region = ?, postcode = ?, country = ?, current_location = ?
            WHERE id = ?')->execute([
            array_key_exists('phone', $b)            ? $b['phone']            : $emp['phone'],
            array_key_exists('address_line1', $b)    ? $b['address_line1']    : $emp['address_line1'],
            array_key_exists('address_line2', $b)    ? $b['address_line2']    : $emp['address_line2'],
            array_key_exists('city', $b)             ? $b['city']             : $emp['city'],
            array_key_exists('region', $b)           ? $b['region']           : $emp['region'],
            array_key_exists('postcode', $b)         ? $b['postcode']         : $emp['postcode'],
            array_key_exists('country', $b)          ? $b['country']          : $emp['country'],
            array_key_exists('current_location', $b) ? $b['current_location'] : $emp['current_location'],
            $eid,
        ]);
        Json::send(['ok' => true]);
    }

    if ($sub === 'background' && $method === 'POST') {
        $b = Json::readBody();
        $declared = array_key_exists('criminal_record_declared', $b)
            ? (is_null($b['criminal_record_declared']) ? null : (int)!!$b['criminal_record_declared'])
            : $emp['criminal_record_declared'];
        $pdo->prepare('UPDATE hr_employees
            SET criminal_record_declared = ?, criminal_record_details = ?, dbs_check_ref = ?, dbs_check_date = ?
            WHERE id = ?')->execute([
            $declared,
            array_key_exists('criminal_record_details', $b) ? $b['criminal_record_details'] : $emp['criminal_record_details'],
            array_key_exists('dbs_check_ref', $b)           ? $b['dbs_check_ref']           : $emp['dbs_check_ref'],
            array_key_exists('dbs_check_date', $b)          ? ($b['dbs_check_date'] ?: null) : $emp['dbs_check_date'],
            $eid,
        ]);
        Json::send(['ok' => true]);
    }

    if ($sub === 'references') {
        if ($method === 'POST') {
            $b = Json::readBody();
            $name = trim((string)($b['name'] ?? ''));
            if ($name === '') Json::fail('reference name required', 400);
            $ins = $pdo->prepare('INSERT INTO hr_references
                (employee_id, name, relationship, email, phone, company, position, notes, sort_order)
                VALUES (?,?,?,?,?,?,?,?,?)');
            $ins->execute([
                $eid, $name,
                $b['relationship'] ?? null,
                $b['email']        ?? null,
                $b['phone']        ?? null,
                $b['company']      ?? null,
                $b['position']     ?? null,
                $b['notes']        ?? null,
                (int)($b['sort_order'] ?? 0),
            ]);
            Json::send(['id' => (int)$pdo->lastInsertId()], 201);
        }
        $rid = (int)($segs[3] ?? 0);
        if ($rid > 0 && $method === 'DELETE') {
            $pdo->prepare('DELETE FROM hr_references WHERE id = ? AND employee_id = ?')->execute([$rid, $eid]);
            Json::send(['ok' => true]);
        }
        Json::fail('Method not allowed', 405);
    }

    if ($sub === 'emergency' && $method === 'POST') {
        $b = Json::readBody();
        $pdo->prepare('UPDATE hr_employees SET emergency_name = ?, emergency_phone = ?, emergency_rel = ? WHERE id = ?')
            ->execute([
                array_key_exists('emergency_name', $b)  ? $b['emergency_name']  : $emp['emergency_name'],
                array_key_exists('emergency_phone', $b) ? $b['emergency_phone'] : $emp['emergency_phone'],
                array_key_exists('emergency_rel', $b)   ? $b['emergency_rel']   : $emp['emergency_rel'],
                $eid,
            ]);
        Json::send(['ok' => true]);
    }

    if ($sub === 'documents') {
        if ($method === 'POST') {
            // Two flows: (a) upload a file, (b) sign a previously-distributed signed-document row.
            $did = (int)($segs[3] ?? 0);
            $action = (string)($segs[4] ?? '');
            if ($did > 0 && $action === 'sign') {
                $isMultipart = !empty($_FILES) || !empty($_POST);
                if ($isMultipart) {
                    $sig = (string)($_POST['signature_data'] ?? '');
                    if ($sig === '' || strpos($sig, 'data:image') !== 0) Json::fail('signature_data required', 400);
                    $row = $pdo->prepare('SELECT id, file_path FROM hr_documents WHERE id = ? AND employee_id = ?');
                    $row->execute([$did, $eid]);
                    $cur = $row->fetch();
                    if (!$cur) Json::fail('Document not found', 404);
                    $newPath = $cur['file_path']; $newSize = null; $newMime = null;
                    if (!empty($_FILES['signed_pdf'])) {
                        $f = $_FILES['signed_pdf'];
                        if ($f['error'] !== UPLOAD_ERR_OK) Json::fail('upload failed', 400);
                        $dir = __DIR__ . '/../../uploads/hr/' . $eid;
                        if (!is_dir($dir)) @mkdir($dir, 0775, true);
                        $fname = time() . '_signed_' . preg_replace('/[^A-Za-z0-9._-]+/', '_', basename($f['name']));
                        $dest = $dir . '/' . $fname;
                        if (!move_uploaded_file($f['tmp_name'], $dest)) Json::fail('failed to save signed copy', 500);
                        $newPath = 'uploads/hr/' . $eid . '/' . $fname;
                        $newSize = (int)$f['size'];
                        $newMime = $f['type'] ?? 'application/pdf';
                    }
                    $pdo->prepare('UPDATE hr_documents
                        SET signed_at = NOW(), signed_by = NULL, signature_data = ?,
                            file_path = ?, file_size = COALESCE(?, file_size), mime_type = COALESCE(?, mime_type)
                        WHERE id = ?')
                        ->execute([$sig, $newPath, $newSize, $newMime, $did]);
                    Json::send(['ok' => true, 'file_path' => $newPath]);
                }
                $b = Json::readBody();
                $sig = (string)($b['signature_data'] ?? '');
                if ($sig === '' || strpos($sig, 'data:image') !== 0) Json::fail('signature_data (data: URL) required', 400);
                $row = $pdo->prepare('SELECT id FROM hr_documents WHERE id = ? AND employee_id = ?');
                $row->execute([$did, $eid]);
                if (!$row->fetch()) Json::fail('Document not found', 404);
                $pdo->prepare('UPDATE hr_documents SET signed_at = NOW(), signed_by = NULL, signature_data = ? WHERE id = ?')
                    ->execute([$sig, $did]);
                Json::send(['ok' => true]);
            }

            if (empty($_FILES['file'])) Json::fail('file required', 400);
            $f = $_FILES['file'];
            if ($f['error'] !== UPLOAD_ERR_OK) Json::fail('upload failed', 400);
            $title    = trim((string)($_POST['title'] ?? $f['name']));
            $category = trim((string)($_POST['category'] ?? 'general'));
            $docTypeId = !empty($_POST['doc_type_id']) ? (int)$_POST['doc_type_id'] : null;
            $reference = trim((string)($_POST['reference_number'] ?? '')) ?: null;
            $issuedAt  = !empty($_POST['issued_at'])  ? (string)$_POST['issued_at']  : null;
            $expiresAt = !empty($_POST['expires_at']) ? (string)$_POST['expires_at'] : null;

            $dir = __DIR__ . '/../../uploads/hr/' . $eid;
            if (!is_dir($dir)) @mkdir($dir, 0775, true);
            $safe = preg_replace('/[^A-Za-z0-9._-]+/', '_', basename($f['name']));
            $name = time() . '_' . $safe;
            $dest = $dir . '/' . $name;
            if (!move_uploaded_file($f['tmp_name'], $dest)) Json::fail('failed to save file', 500);

            $relPath = 'uploads/hr/' . $eid . '/' . $name;
            $ins = $pdo->prepare('INSERT INTO hr_documents
                (employee_id, doc_type_id, category, title, file_path, file_size, mime_type,
                 reference_number, issued_at, expires_at, uploaded_by)
                VALUES (?,?,?,?,?,?,?, ?,?,?, NULL)');
            $ins->execute([$eid, $docTypeId, $category, $title, $relPath, (int)$f['size'], $f['type'] ?? null,
                $reference, $issuedAt, $expiresAt]);
            Json::send(['id' => (int)$pdo->lastInsertId()], 201);
        }
        $did = (int)($segs[3] ?? 0);
        if ($did > 0 && $method === 'DELETE') {
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

    if ($sub === 'tasks' && $method === 'POST') {
        // Toggle a task as done/undone (employee acknowledgement).
        $tid = (int)($segs[3] ?? 0);
        if ($tid <= 0) Json::fail('task id required', 400);
        $row = $pdo->prepare('SELECT * FROM hr_onboarding_tasks WHERE id = ? AND employee_id = ?');
        $row->execute([$tid, $eid]);
        $task = $row->fetch();
        if (!$task) Json::fail('Task not found', 404);
        $b = Json::readBody();
        $isDone = !empty($b['is_done']) ? 1 : 0;
        $doneAt = $isDone ? ($task['done_at'] ?? date('Y-m-d H:i:s')) : null;
        $pdo->prepare('UPDATE hr_onboarding_tasks SET is_done = ?, done_at = ? WHERE id = ?')
            ->execute([$isDone, $doneAt, $tid]);
        Json::send(['ok' => true]);
    }

    if ($sub === 'learning' && $method === 'POST') {
        $aid = (int)($segs[3] ?? 0);
        if ($aid <= 0) Json::fail('assignment id required', 400);
        $row = $pdo->prepare('SELECT * FROM hr_course_assignments WHERE id = ? AND employee_id = ?');
        $row->execute([$aid, $eid]);
        $a = $row->fetch();
        if (!$a) Json::fail('Assignment not found', 404);
        $b = Json::readBody();
        $allowed = ['not_started','in_progress','completed','expired'];
        $newStatus = $b['status'] ?? null;
        if (!in_array($newStatus, $allowed, true)) Json::fail('invalid status', 400);
        $completedAt = $newStatus === 'completed' ? ($a['completed_at'] ?? date('Y-m-d H:i:s')) : null;
        $pdo->prepare('UPDATE hr_course_assignments SET status = ?, completed_at = ? WHERE id = ?')
            ->execute([$newStatus, $completedAt, $aid]);
        Json::send(['ok' => true]);
    }

    if ($sub === 'course-detail' && $method === 'GET') {
        $aid = (int)($segs[3] ?? 0);
        if ($aid <= 0) Json::fail('assignment id required', 400);
        $row = $pdo->prepare('
            SELECT a.*, c.title, c.description, c.provider, c.category, c.duration_hours, c.is_required, c.link
            FROM hr_course_assignments a JOIN hr_courses c ON c.id = a.course_id
            WHERE a.id = ? AND a.employee_id = ?');
        $row->execute([$aid, $eid]);
        $a = $row->fetch();
        if (!$a) Json::fail('Assignment not found', 404);
        $modules = loadModulesForPlayer($pdo, (int)$a['course_id']);
        $progStmt = $pdo->prepare('SELECT module_id, completed_at, quiz_score, quiz_attempts
                                   FROM hr_course_module_progress WHERE assignment_id = ?');
        $progStmt->execute([$aid]);
        Json::send(['assignment' => $a, 'modules' => $modules, 'progress' => $progStmt->fetchAll()]);
    }

    if ($sub === 'course-module-complete' && $method === 'POST') {
        $aid = (int)($segs[3] ?? 0);
        $mid = (int)($segs[4] ?? 0);
        if ($aid <= 0 || $mid <= 0) Json::fail('assignment id and module id required', 400);
        $row = $pdo->prepare('SELECT * FROM hr_course_assignments WHERE id = ? AND employee_id = ?');
        $row->execute([$aid, $eid]);
        $a = $row->fetch();
        if (!$a) Json::fail('Assignment not found', 404);
        $mod = moduleForCourse($pdo, $mid, (int)$a['course_id']);
        if ($mod['kind'] === 'quiz') Json::fail('Use the quiz endpoint for quiz modules', 400);
        upsertModuleProgress($pdo, $aid, $mid, ['completed_at' => date('Y-m-d H:i:s')]);
        finalizeAssignmentIfDone($pdo, $aid, (int)$a['course_id']);
        Json::send(['ok' => true]);
    }

    if ($sub === 'course-module-quiz' && $method === 'POST') {
        $aid = (int)($segs[3] ?? 0);
        $mid = (int)($segs[4] ?? 0);
        if ($aid <= 0 || $mid <= 0) Json::fail('assignment id and module id required', 400);
        $row = $pdo->prepare('SELECT * FROM hr_course_assignments WHERE id = ? AND employee_id = ?');
        $row->execute([$aid, $eid]);
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

    if ($sub === 'submit') {
        if ($method !== 'POST') Json::fail('Method not allowed', 405);
        $section = (string)($segs[3] ?? '');
        $allowedSections = ['profile','contact','emergency','payroll','documents','tasks','learning','background','references','diversity'];
        if (!in_array($section, $allowedSections, true)) Json::fail('invalid section', 400);

        $progress = json_decode($emp['onboarding_progress_json'] ?? '', true) ?: [];
        // A re-submit clears any prior rejection so HR sees a fresh "submitted" state.
        $cur = $progress[$section] ?? [];
        $cur['submitted_at']    = date('Y-m-d H:i:s');
        $cur['rejected_at']     = null;
        $cur['rejected_by']     = null;
        $cur['rejected_reason'] = null;
        $progress[$section] = $cur;
        // Auto-tick any checklist tasks that point at this section.
        $pdo->prepare('UPDATE hr_onboarding_tasks
            SET is_done = 1, done_at = COALESCE(done_at, NOW())
            WHERE employee_id = ? AND linked_section = ? AND is_done = 0')
            ->execute([$eid, $section]);

        // If every section is submitted, mark overall complete.
        $allSubmitted = true;
        foreach ($allowedSections as $s) {
            if (empty($progress[$s]['submitted_at'])) { $allSubmitted = false; break; }
        }
        $completedAt = $allSubmitted ? ($emp['onboarding_completed_at'] ?? date('Y-m-d H:i:s')) : $emp['onboarding_completed_at'];

        $pdo->prepare('UPDATE hr_employees SET onboarding_progress_json = ?, onboarding_completed_at = ? WHERE id = ?')
            ->execute([json_encode($progress), $completedAt, $eid]);
        Json::send(['ok' => true, 'progress' => $progress, 'completed' => $allSubmitted]);
    }

    Json::fail('Not found', 404);
};
