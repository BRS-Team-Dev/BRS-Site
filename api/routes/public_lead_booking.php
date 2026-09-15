<?php
declare(strict_types=1);

use BRS\Db;
use BRS\Json;
use BRS\LeadBookingNotifier;
use BRS\Tenant;

// Must sit ABOVE the `return function` below: once that closure is returned
// PHP stops executing top-level statements, so a require_once placed after it
// silently never runs.
require_once __DIR__ . '/../lib/LeadBookingNotifier.php';

/*
 * Public "Book a call" flow from the marketing site -> CRM.
 * No auth. The authed twin lives in lead_bookings.php.
 *
 *   GET  /api/public-lead-booking/days?tz=America/New_York
 *        -> { tz, dates: ["2026-09-02", ...], min_date, max_date }
 *
 *   GET  /api/public-lead-booking/slots?date=YYYY-MM-DD&tz=America/New_York
 *        -> { date, tz, tz_abbr, uk_abbr, same_as_uk, slots: [...] }
 *
 *   POST /api/public-lead-booking            (JSON)
 *        { name, email, phone, company, slot, tz, website }
 *        -> { ok: true, booking_id, lead_id, scheduled_at }
 *
 * TIMEZONES
 * ---------
 * The team works UK hours; prospects are UK and US. So:
 *   - Availability is defined in Europe/London (weekdays 09:00-22:00).
 *   - `date` and the `time` on each slot are in the VISITOR's timezone,
 *     so a US visitor picks against their own working day.
 *   - Each slot also carries `value` - the UK wall-clock datetime - and
 *     that is the only thing POST accepts. The browser never does the
 *     conversion, so a stale clock or a spoofed tz cannot shift a booking.
 *   - `lead_bookings.scheduled_at` therefore always stores UK local
 *     wall-clock time, matching what the CMS admin editor writes via its
 *     <input type="datetime-local">. The team only ever sees UK time.
 *
 * NOTE: bootstrap.php pins PHP to UTC. Every comparison here is either
 * between DateTimeImmutable objects (compared by absolute instant, so
 * tz-safe) or against an explicitly Europe/London value. Never compare
 * a UK wall-clock string against date() output.
 *
 * `website` is a honeypot - real visitors never see the field.
 */

// Bookable window, in UK terms. Kept server-side so the picker and the
// validator can never drift apart: the browser renders what it is given.
const BRS_BOOK_TZ           = 'Europe/London';
const BRS_BOOK_START_HOUR   = 9;    // first slot 09:00 UK
const BRS_BOOK_END_HOUR     = 22;   // last slot starts before 22:00 UK
const BRS_BOOK_STEP_MINUTES = 30;
const BRS_BOOK_DAYS_AHEAD   = 30;   // how far out the picker may go
const BRS_BOOK_DURATION     = 15;
const BRS_BOOK_NOTICE       = '+1 hour';   // minimum lead time

function brs_book_uk(): DateTimeZone
{
    return new DateTimeZone(BRS_BOOK_TZ);
}

/** Visitor timezone, falling back to UK for anything unrecognised. */
function brs_book_tz(string $tz): DateTimeZone
{
    $tz = trim($tz);
    if ($tz === '') return brs_book_uk();
    try {
        return new DateTimeZone($tz);
    } catch (\Throwable $e) {
        return brs_book_uk();
    }
}

/**
 * Every slot start on one UK calendar date, as UK-local instants.
 * Weekdays only. Empty for weekends or a malformed date.
 *
 * The 09:00-22:00 band never overlaps a UK DST transition (those happen
 * at 01:00/02:00), so no slot is ever skipped or duplicated.
 */
function brs_booking_uk_day_slots(string $ukDate): array
{
    $d = DateTimeImmutable::createFromFormat('!Y-m-d', $ukDate, brs_book_uk());
    if (!$d || $d->format('Y-m-d') !== $ukDate) return [];
    if ((int)$d->format('N') >= 6) return [];           // Sat/Sun

    $out = [];
    for ($m = BRS_BOOK_START_HOUR * 60; $m < BRS_BOOK_END_HOUR * 60; $m += BRS_BOOK_STEP_MINUTES) {
        $out[] = $d->setTime(intdiv($m, 60), $m % 60);
    }
    return $out;
}

/** First and last UK dates the picker may reach. */
function brs_booking_uk_window(): array
{
    $today = new DateTimeImmutable('today', brs_book_uk());
    return [$today, $today->modify('+' . BRS_BOOK_DAYS_AHEAD . ' days')];
}

/** Earliest instant that may be booked. */
function brs_booking_cutoff(): DateTimeImmutable
{
    return (new DateTimeImmutable('now', brs_book_uk()))->modify(BRS_BOOK_NOTICE);
}

/**
 * UK wall-clock strings already spoken for, across the whole window.
 * Anything cancelled or no-showed frees its slot again.
 */
function brs_booking_taken($pdo): array
{
    [$from, $to] = brs_booking_uk_window();
    $q = $pdo->prepare(
        "SELECT DISTINCT DATE_FORMAT(scheduled_at, '%Y-%m-%d %H:%i:00') AS s
           FROM lead_bookings
          WHERE scheduled_at >= ? AND scheduled_at < ?
            AND status IN ('requested','confirmed','completed')"
    );
    $q->execute([$from->format('Y-m-d 00:00:00'), $to->modify('+1 day')->format('Y-m-d 00:00:00')]);
    return array_flip(array_column($q->fetchAll(), 's'));
}

/**
 * Every bookable slot in the window that is still free and far enough out,
 * as UK-local instants. This is the single definition of "available" that
 * /days, /slots and POST all agree on.
 */
function brs_booking_open_slots($pdo): array
{
    $taken  = brs_booking_taken($pdo);
    $cutoff = brs_booking_cutoff();
    [$from, $to] = brs_booking_uk_window();

    $out = [];
    for ($d = $from; $d <= $to; $d = $d->modify('+1 day')) {
        foreach (brs_booking_uk_day_slots($d->format('Y-m-d')) as $slot) {
            if ($slot < $cutoff) continue;
            if (isset($taken[$slot->format('Y-m-d H:i:00')])) continue;
            $out[] = $slot;
        }
    }
    return $out;
}

return function (string $method, array $segs): void {
    if ($method === 'OPTIONS') { http_response_code(204); exit; }

    Tenant::setForPublic();
    $pdo = Db::tpdo();
    $sub = $segs[1] ?? '';

    // -- GET /days?tz= ----------------------------------------------
    // Which dates in the VISITOR's timezone still have a free slot.
    // Drives which days the calendar enables, so a US visitor is never
    // offered a day that holds nothing once converted.
    if ($sub === 'days') {
        if ($method !== 'GET') Json::fail('Method not allowed', 405);
        $tz = brs_book_tz((string)($_GET['tz'] ?? ''));

        $dates = [];
        foreach (brs_booking_open_slots($pdo) as $slot) {
            $dates[$slot->setTimezone($tz)->format('Y-m-d')] = true;
        }
        $dates = array_keys($dates);
        sort($dates);

        Json::send([
            'tz'       => $tz->getName(),
            'dates'    => $dates,
            'min_date' => $dates[0] ?? null,
            'max_date' => $dates ? $dates[count($dates) - 1] : null,
        ]);
    }

    // -- GET /slots?date=&tz= ---------------------------------------
    // Every UK slot that lands on the given date IN THE VISITOR'S
    // TIMEZONE. `value` is the UK wall-clock time to post back.
    if ($sub === 'slots') {
        if ($method !== 'GET') Json::fail('Method not allowed', 405);
        $tz   = brs_book_tz((string)($_GET['tz'] ?? ''));
        $date = trim((string)($_GET['date'] ?? ''));

        $localDay = DateTimeImmutable::createFromFormat('!Y-m-d', $date, $tz);
        if (!$localDay || $localDay->format('Y-m-d') !== $date) {
            Json::fail('A valid date is required', 400);
        }
        $dayEnd = $localDay->modify('+1 day');

        $taken  = brs_booking_taken($pdo);
        $cutoff = brs_booking_cutoff();
        $uk     = brs_book_uk();

        // A visitor's local day can straddle two UK dates (and does, for
        // anywhere far enough east or west), so walk the UK day either
        // side and keep whatever instants land inside the local day.
        $slots = [];
        $probe = $localDay->setTimezone($uk)->modify('-1 day');
        for ($i = 0; $i < 3; $i++, $probe = $probe->modify('+1 day')) {
            foreach (brs_booking_uk_day_slots($probe->format('Y-m-d')) as $slot) {
                if ($slot < $localDay || $slot >= $dayEnd) continue;
                $local = $slot->setTimezone($tz);
                $slots[] = [
                    'value'     => $slot->format('Y-m-d H:i:s'),   // UK wall clock - post this back
                    'time'      => $local->format('H:i'),          // visitor's local time
                    'uk_time'   => $slot->format('H:i'),
                    'uk_date'   => $slot->format('Y-m-d'),
                    'available' => $slot >= $cutoff && !isset($taken[$slot->format('Y-m-d H:i:00')]),
                ];
            }
        }
        usort($slots, static fn(array $a, array $b): int => strcmp($a['time'], $b['time']));

        // When the visitor is effectively on UK time there is nothing to
        // disambiguate, so the UI drops the dual-time labelling.
        $sameAsUk = true;
        foreach ($slots as $s) {
            if ($s['time'] !== $s['uk_time']) { $sameAsUk = false; break; }
        }

        Json::send([
            'date'       => $date,
            'tz'         => $tz->getName(),
            'tz_abbr'    => $localDay->format('T'),
            'uk_abbr'    => $localDay->setTimezone($uk)->format('T'),
            'same_as_uk' => $sameAsUk,
            'slots'      => $slots,
        ]);
    }

    if ($sub !== '') Json::fail('Not found', 404);
    if ($method !== 'POST') Json::fail('Method not allowed', 405);

    $b = Json::readBody();

    // Honeypot - silently accept-and-drop bots.
    if (trim((string)($b['website'] ?? '')) !== '') { Json::send(['ok' => true]); }

    $name    = trim((string)($b['name']    ?? ''));
    $email   = trim((string)($b['email']   ?? ''));
    $phone   = trim((string)($b['phone']   ?? ''));
    $company = trim((string)($b['company'] ?? ''));
    $notes   = trim((string)($b['notes']   ?? ''));
    $slotRaw = trim((string)($b['slot']    ?? ''));
    $tz      = brs_book_tz((string)($b['tz'] ?? ''));

    if ($name  === '') Json::fail('Please enter your name', 400);
    if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        Json::fail('Please enter a valid email address', 400);
    }
    if ($phone === '') Json::fail('Please enter a phone number', 400);

    // The slot is a UK wall-clock datetime the /slots endpoint handed out.
    // Re-derive it rather than trusting it: it has to be a real slot on the
    // grid, inside the window, still free, and far enough out.
    $slot = DateTimeImmutable::createFromFormat('!Y-m-d H:i:s', $slotRaw, brs_book_uk());
    if (!$slot || $slot->format('Y-m-d H:i:s') !== $slotRaw) {
        Json::fail('Please pick an available time', 400);
    }
    $onGrid = false;
    foreach (brs_booking_uk_day_slots($slot->format('Y-m-d')) as $candidate) {
        if ($candidate == $slot) { $onGrid = true; break; }
    }
    [$from, $to] = brs_booking_uk_window();
    if (!$onGrid || $slot < $from || $slot > $to->modify('+1 day')) {
        Json::fail('Please pick an available time', 400);
    }
    if ($slot < brs_booking_cutoff()) {
        Json::fail('That slot has passed - please pick another time', 400);
    }

    $scheduledAt = $slot->format('Y-m-d H:i:s');

    // Slot still free? Cheap guard against two people racing the same time.
    $busy = $pdo->prepare(
        "SELECT id FROM lead_bookings
          WHERE scheduled_at = ? AND status IN ('requested','confirmed','completed')
          LIMIT 1"
    );
    $busy->execute([$scheduledAt]);
    if ($busy->fetch()) Json::fail('That slot has just been taken - please pick another time', 409);

    // The row stores UK time so the team reads one clock. Keep the
    // visitor's own time alongside it in the notes, so whoever makes the
    // call knows what hour it is for them.
    $local  = $slot->setTimezone($tz);
    $ukName = brs_book_uk()->getName();
    if ($tz->getName() !== $ukName && $local->format('H:i') !== $slot->format('H:i')) {
        $line = 'Booked from ' . $tz->getName() . ' - their local time is '
              . $local->format('D j M Y, H:i') . ' (' . $local->format('T') . ').';
        $notes = $notes !== '' ? $notes . "\n" . $line : $line;
    }

    // -- Lead -------------------------------------------------------
    // Reuse the existing lead for this email rather than stacking a
    // duplicate every time the same prospect books.
    $find = $pdo->prepare('SELECT id FROM leads WHERE email = ? ORDER BY id DESC LIMIT 1');
    $find->execute([$email]);
    $leadId = (int)($find->fetchColumn() ?: 0);

    if ($leadId) {
        // Fill in anything we did not have before; never overwrite.
        $pdo->prepare(
            'UPDATE leads
                SET phone   = COALESCE(NULLIF(phone, ""), ?),
                    company = COALESCE(NULLIF(company, ""), ?)
              WHERE id = ?'
        )->execute([$phone ?: null, $company ?: null, $leadId]);
    } else {
        $pdo->prepare(
            'INSERT INTO leads (name, email, phone, company, notes, status, source)
             VALUES (?,?,?,?,?,?,?)'
        )->execute([
            $name,
            $email,
            $phone   !== '' ? $phone   : null,
            $company !== '' ? $company : null,
            $notes   !== '' ? $notes   : null,
            'new',
            'website booking',
        ]);
        $leadId = (int)$pdo->lastInsertId();

        // Match the authed leads POST: replay lead-audience contract templates.
        if (class_exists('\\BRS\\Contracts')) { \BRS\Contracts::fanOutToNewEntity($pdo, 'lead', $leadId); }
    }

    // -- Booking ----------------------------------------------------
    $pdo->prepare(
        'INSERT INTO lead_bookings
         (lead_id, name, email, phone, company, topic, notes,
          scheduled_at, duration_minutes, status, source, customer_timezone)
         VALUES (?,?,?,?,?,?,?, ?,?,?,?,?)'
    )->execute([
        $leadId,
        $name,
        $email,
        $phone   !== '' ? $phone   : null,
        $company !== '' ? $company : null,
        'Free 15-minute intro call',
        $notes   !== '' ? $notes   : null,
        $scheduledAt,
        BRS_BOOK_DURATION,
        'requested',
        'website',
        // The notifier renders the client-facing email in this zone. Stored
        // as the resolved IANA name, so an unrecognised `tz` lands as
        // 'Europe/London' rather than something unparseable downstream.
        $tz->getName(),
    ]);
    $bookingId = (int)$pdo->lastInsertId();

    // Email the team and the prospect. Never throws and swallows SMTP
    // failures internally, so it cannot break this response — but it must
    // stay ABOVE Json::send(), which ends in exit().
    LeadBookingNotifier::onScheduled($bookingId);

    Json::send([
        'ok'           => true,
        'booking_id'   => $bookingId,
        'lead_id'      => $leadId,
        'scheduled_at' => $scheduledAt,
    ], 201);
};
