<?php
declare(strict_types=1);

use BRS\Db;
use BRS\Json;

/*
 * Public contact enquiry from the Built Right Recruitment marketing site →
 * a CRM lead. No auth.
 *
 *   POST /api/public-recruitment-contact   (multipart/urlencoded)
 *     name, email, phone, message, seeking, company (honeypot)
 *
 * Inserts a `leads` row with source='Recruitment Website' and the chosen
 * `seeking` category so enquiries can be triaged in the CMS Leads list.
 */
return function (string $method, array $segs): void {
    if ($method !== 'POST') Json::fail('Method not allowed', 405);
    $pdo = Db::pdo();

    // Honeypot — silently accept-and-drop bots.
    if (trim((string)($_POST['company'] ?? '')) !== '') { Json::send(['ok' => true]); return; }

    $name    = trim((string)($_POST['name']    ?? ''));
    $email   = trim((string)($_POST['email']   ?? ''));
    $phone   = trim((string)($_POST['phone']   ?? ''));
    $message = trim((string)($_POST['message'] ?? ''));
    $seeking = trim((string)($_POST['seeking'] ?? ''));
    if ($name === '') Json::fail('Name is required', 400);
    if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) Json::fail('Please enter a valid email address', 400);

    $pdo->prepare('INSERT INTO leads (name, email, phone, notes, status, source, seeking) VALUES (?,?,?,?,?,?,?)')
        ->execute([
            $name,
            $email   !== '' ? $email   : null,
            $phone   !== '' ? $phone   : null,
            $message !== '' ? $message : null,
            'new',
            'Recruitment Website',
            $seeking !== '' ? mb_substr($seeking, 0, 120) : null,
        ]);
    $id = (int)$pdo->lastInsertId();

    // Match the authed leads POST: replay lead-audience contract templates.
    if (class_exists('\\BRS\\Contracts')) { \BRS\Contracts::fanOutToNewEntity($pdo, 'lead', $id); }

    Json::send(['ok' => true, 'id' => $id], 201);
};
