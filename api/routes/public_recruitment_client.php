<?php
declare(strict_types=1);

use BRS\Db;
use BRS\Json;

/*
 * Public "Request Candidates" enquiry from the Built Right Recruitment
 * marketing site. No auth.
 *
 *   POST /api/public-recruitment-client   (multipart/urlencoded)
 *     name (contact person), organisation, email, phone, vacancy
 *     company (honeypot) — must stay empty
 *
 * Creates a recruitment CLIENT (clients.is_recruitment_client=1) with a
 * primary contact from the person's name, fans out client-audience contracts,
 * and adds the Recruitment service by creating a recruitment role from the
 * vacancy (which mirrors as the Recruitment row on the CRM Services tab and
 * puts the client in the Recruitment system).
 */
use BRS\Tenant;

return function (string $method, array $segs): void {
    // Public routes have no JWT — bootstrap the tenant context.
    // Hardcoded to BRS (tenant 1) until per-tenant public routing
    // lands in Phase 5 (subdomain detection / per-tenant API key).
    Tenant::setForPublic();
    if ($method !== 'POST') Json::fail('Method not allowed', 405);
    $pdo = Db::tpdo();

    // Honeypot — silently accept-and-drop bots.
    if (trim((string)($_POST['company'] ?? '')) !== '') { Json::send(['ok' => true]); return; }

    $contact = trim((string)($_POST['name']         ?? ''));
    $org     = trim((string)($_POST['organisation'] ?? ''));
    $email   = trim((string)($_POST['email']        ?? ''));
    $phone   = trim((string)($_POST['phone']        ?? ''));
    $vacancy = trim((string)($_POST['vacancy']      ?? ''));
    if ($org === '') Json::fail('Organisation is required', 400);
    if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) Json::fail('Please enter a valid email address', 400);

    $noteParts = [];
    if ($contact !== '') $noteParts[] = 'Contact: ' . $contact;
    if ($vacancy !== '') $noteParts[] = 'Vacancy requirement: ' . $vacancy;
    $noteParts[] = 'Submitted via website (Request Candidates).';
    $notes = implode("\n\n", $noteParts);

    $pdo->beginTransaction();
    try {
        // 1) Client row (flagged as a recruitment client).
        $pdo->prepare('INSERT INTO clients (name, email, phone, company, notes, is_recruitment_client) VALUES (?,?,?,?,?,1)')
            ->execute([$org, $email !== '' ? $email : null, $phone !== '' ? $phone : null, $org, $notes]);
        $clientId = (int)$pdo->lastInsertId();

        // 2) Replay client-audience contract templates as pending docs.
        if (class_exists('\\BRS\\Contracts')) { \BRS\Contracts::fanOutToNewEntity($pdo, 'client', $clientId); }

        // 3) Primary contact from the person's name (basic-info card source).
        if ($contact !== '') {
            $parts = preg_split('/\s+/', $contact, 2) ?: [$contact];
            $pdo->prepare('INSERT INTO client_contacts (client_id, first_name, last_name, email, is_primary, sort_order) VALUES (?,?,?,?,1,0)')
                ->execute([$clientId, $parts[0], $parts[1] ?? '', $email !== '' ? $email : null]);
            $contactId = (int)$pdo->lastInsertId();
            if ($phone !== '') {
                $pdo->prepare('INSERT INTO client_contact_numbers (contact_id, number, label, sort_order) VALUES (?,?,?,0)')
                    ->execute([$contactId, $phone, 'mobile']);
            }
        }

        // 4) Recruitment role from the vacancy + mirror it as the Recruitment
        //    service (createServiceRowForRole). This is what "adds the
        //    recruitment service" and lists them in the Recruitment system.
        $title = $vacancy !== '' ? mb_substr($vacancy, 0, 120) : 'Website enquiry';
        $pdo->prepare('INSERT INTO recruitment_roles (client_id, title, description, status, currency) VALUES (?,?,?,?,?)')
            ->execute([$clientId, $title, $vacancy !== '' ? $vacancy : null, 'open', 'GBP']);
        $roleId = (int)$pdo->lastInsertId();
        \BRS\Recruitment::createServiceRowForRole($pdo, $clientId, $roleId);

        $pdo->commit();
    } catch (\Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }

    Json::send(['ok' => true, 'id' => $clientId], 201);
};
