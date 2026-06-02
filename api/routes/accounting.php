<?php
declare(strict_types=1);

use BRS\Auth;
use BRS\Db;
use BRS\Json;

/*
 * Accounting system route — handles all /api/accounting/* paths.
 *
 * Phase 1 surface area: Invoices.
 * Bank feed, VAT, full GL, etc. parked until integration unblocked
 * (see docs/accounting-plan.txt).
 *
 *   GET    /api/accounting/invoices                    list
 *   POST   /api/accounting/invoices                    create draft (header + optional lines)
 *   GET    /api/accounting/invoices/:id                detail (header + lines)
 *   PUT    /api/accounting/invoices/:id                update header
 *   DELETE /api/accounting/invoices/:id                delete (lines cascade)
 *   POST   /api/accounting/invoices/:id/send           flip draft → sent, stamp sent_at
 *   POST   /api/accounting/invoices/:id/mark-paid      flip → paid, stamp paid_at
 *
 *   POST   /api/accounting/invoices/:id/lines          add line
 *   PUT    /api/accounting/invoices/:id/lines/:lid     update line
 *   DELETE /api/accounting/invoices/:id/lines/:lid     remove line
 */

return function (string $method, array $segs): void {
    Auth::require();
    $pdo = Db::pdo();
    $sub = (string)($segs[1] ?? '');

    if ($sub === 'invoices') {
        handleInvoices($pdo, $method, $segs);
        return;
    }
    Json::fail('Not found', 404);
};

/** Generate the next invoice number for the calendar year, e.g. INV-2026-0042. */
function nextInvoiceNumber(\PDO $pdo): string
{
    $year = (int)date('Y');
    $prefix = 'INV-' . $year . '-';
    $stmt = $pdo->prepare("SELECT invoice_number FROM invoices
                           WHERE invoice_number LIKE ?
                           ORDER BY id DESC LIMIT 1");
    $stmt->execute([$prefix . '%']);
    $last = (string)$stmt->fetchColumn();
    $next = 1;
    if ($last !== '' && preg_match('/-(\d+)$/', $last, $m)) {
        $next = ((int)$m[1]) + 1;
    }
    return $prefix . str_pad((string)$next, 4, '0', STR_PAD_LEFT);
}

/** Refresh the invoice header totals after a line insert/update/delete. */
function recalcInvoiceTotals(\PDO $pdo, int $invoiceId): void
{
    $stmt = $pdo->prepare('SELECT
        COALESCE(SUM(line_total), 0) AS subtotal,
        COALESCE(SUM(line_tax),   0) AS tax_total
        FROM invoice_lines WHERE invoice_id = ?');
    $stmt->execute([$invoiceId]);
    $r = $stmt->fetch();
    $sub = (float)$r['subtotal'];
    $tax = (float)$r['tax_total'];
    $tot = $sub + $tax;
    $pdo->prepare('UPDATE invoices SET subtotal = ?, tax_total = ?, total = ? WHERE id = ?')
        ->execute([$sub, $tax, $tot, $invoiceId]);
}

/** Compute and persist line_total + line_tax for a row. */
function recalcLineRow(\PDO $pdo, int $lineId): void
{
    $stmt = $pdo->prepare('SELECT quantity, unit_price, tax_rate FROM invoice_lines WHERE id = ?');
    $stmt->execute([$lineId]);
    $r = $stmt->fetch();
    if (!$r) return;
    $base = (float)$r['quantity'] * (float)$r['unit_price'];
    $tax  = $base * ((float)$r['tax_rate'] / 100.0);
    $pdo->prepare('UPDATE invoice_lines SET line_total = ?, line_tax = ? WHERE id = ?')
        ->execute([$base, $tax, $lineId]);
}

function handleInvoices(\PDO $pdo, string $method, array $segs): void
{
    // Collection: /api/accounting/invoices
    if (!isset($segs[2])) {
        if ($method === 'GET') {
            $rows = $pdo->query('SELECT i.*, c.name AS client_name
                FROM invoices i
                LEFT JOIN clients c ON c.id = i.client_id
                ORDER BY i.issue_date DESC, i.id DESC')->fetchAll();
            Json::send(['invoices' => $rows]);
        }
        if ($method === 'POST') {
            $b = Json::readBody();
            $billTo = trim((string)($b['bill_to_name'] ?? ''));
            if ($billTo === '') Json::fail('bill_to_name required', 400);

            $clientId   = !empty($b['client_id'])           ? (int)$b['client_id']           : null;
            $obClientId = !empty($b['onboarding_client_id']) ? (int)$b['onboarding_client_id'] : null;
            $issueDate  = (string)($b['issue_date'] ?? date('Y-m-d'));
            $dueDate    = !empty($b['due_date']) ? (string)$b['due_date'] : null;
            $currency   = (string)($b['currency'] ?? 'GBP');
            $notes      = $b['notes'] ?? null;
            $billEmail  = trim((string)($b['bill_to_email']   ?? '')) ?: null;
            $billAddr   = $b['bill_to_address'] ?? null;

            $number = nextInvoiceNumber($pdo);

            $pdo->prepare('INSERT INTO invoices
                (invoice_number, client_id, onboarding_client_id,
                 bill_to_name, bill_to_email, bill_to_address,
                 currency, issue_date, due_date, status, notes)
                VALUES (?,?,?,?,?,?,?,?,?,"draft",?)')
                ->execute([
                    $number, $clientId, $obClientId,
                    $billTo, $billEmail, $billAddr,
                    $currency, $issueDate, $dueDate, $notes,
                ]);
            $id = (int)$pdo->lastInsertId();

            // Optional initial lines.
            $lines = is_array($b['lines'] ?? null) ? $b['lines'] : [];
            $sortOrder = 0;
            foreach ($lines as $ln) {
                $desc = trim((string)($ln['description'] ?? ''));
                if ($desc === '') continue;
                $ins = $pdo->prepare('INSERT INTO invoice_lines
                    (invoice_id, description, quantity, unit_price, tax_rate, sort_order)
                    VALUES (?,?,?,?,?,?)');
                $ins->execute([
                    $id, $desc,
                    (float)($ln['quantity']   ?? 1),
                    (float)($ln['unit_price'] ?? 0),
                    (float)($ln['tax_rate']   ?? 0),
                    $sortOrder++,
                ]);
                recalcLineRow($pdo, (int)$pdo->lastInsertId());
            }
            recalcInvoiceTotals($pdo, $id);

            Json::send(['id' => $id, 'invoice_number' => $number], 201);
        }
        Json::fail('Method not allowed', 405);
    }

    $id = (int)$segs[2];
    if ($id <= 0) Json::fail('Invalid id', 400);

    $stmt = $pdo->prepare('SELECT i.*, c.name AS client_name
        FROM invoices i LEFT JOIN clients c ON c.id = i.client_id
        WHERE i.id = ?');
    $stmt->execute([$id]);
    $inv = $stmt->fetch();
    if (!$inv) Json::fail('Invoice not found', 404);

    $action = (string)($segs[3] ?? '');

    // /api/accounting/invoices/:id/lines[/:lid]
    if ($action === 'lines') {
        $lid = isset($segs[4]) ? (int)$segs[4] : null;

        if ($lid === null) {
            if ($method === 'POST') {
                $b = Json::readBody();
                $desc = trim((string)($b['description'] ?? ''));
                if ($desc === '') Json::fail('description required', 400);
                // sort_order: append to the end if not provided.
                $nextStmt = $pdo->prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 FROM invoice_lines WHERE invoice_id = ?');
                $nextStmt->execute([$id]);
                $next = (int)$nextStmt->fetchColumn();
                $ins = $pdo->prepare('INSERT INTO invoice_lines
                    (invoice_id, description, quantity, unit_price, tax_rate, sort_order)
                    VALUES (?,?,?,?,?,?)');
                $ins->execute([
                    $id, $desc,
                    (float)($b['quantity']   ?? 1),
                    (float)($b['unit_price'] ?? 0),
                    (float)($b['tax_rate']   ?? 0),
                    isset($b['sort_order']) ? (int)$b['sort_order'] : $next,
                ]);
                $newId = (int)$pdo->lastInsertId();
                recalcLineRow($pdo, $newId);
                recalcInvoiceTotals($pdo, $id);
                Json::send(['id' => $newId], 201);
            }
            Json::fail('Method not allowed', 405);
        }

        $row = $pdo->prepare('SELECT * FROM invoice_lines WHERE id = ? AND invoice_id = ?');
        $row->execute([$lid, $id]);
        $line = $row->fetch();
        if (!$line) Json::fail('Line not found', 404);

        if ($method === 'PUT') {
            $b = Json::readBody();
            $pdo->prepare('UPDATE invoice_lines SET
                description = ?, quantity = ?, unit_price = ?, tax_rate = ?, sort_order = ?
                WHERE id = ?')->execute([
                array_key_exists('description', $b) ? trim((string)$b['description']) : $line['description'],
                array_key_exists('quantity',    $b) ? (float)$b['quantity']           : (float)$line['quantity'],
                array_key_exists('unit_price',  $b) ? (float)$b['unit_price']         : (float)$line['unit_price'],
                array_key_exists('tax_rate',    $b) ? (float)$b['tax_rate']           : (float)$line['tax_rate'],
                array_key_exists('sort_order',  $b) ? (int)$b['sort_order']           : (int)$line['sort_order'],
                $lid,
            ]);
            recalcLineRow($pdo, $lid);
            recalcInvoiceTotals($pdo, $id);
            Json::send(['ok' => true]);
        }
        if ($method === 'DELETE') {
            $pdo->prepare('DELETE FROM invoice_lines WHERE id = ?')->execute([$lid]);
            recalcInvoiceTotals($pdo, $id);
            Json::send(['ok' => true]);
        }
        Json::fail('Method not allowed', 405);
    }

    // /api/accounting/invoices/:id/send
    if ($action === 'send' && $method === 'POST') {
        if ($inv['status'] === 'void') Json::fail('Cannot send a voided invoice', 400);
        $pdo->prepare('UPDATE invoices SET status = "sent", sent_at = NOW() WHERE id = ?')->execute([$id]);
        Json::send(['ok' => true]);
    }

    // /api/accounting/invoices/:id/mark-paid
    if ($action === 'mark-paid' && $method === 'POST') {
        if ($inv['status'] === 'void') Json::fail('Cannot mark a voided invoice as paid', 400);
        $pdo->prepare('UPDATE invoices SET status = "paid", paid_at = NOW() WHERE id = ?')->execute([$id]);
        Json::send(['ok' => true]);
    }

    // Header GET / PUT / DELETE
    if ($method === 'GET' && $action === '') {
        $linesStmt = $pdo->prepare('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY sort_order, id');
        $linesStmt->execute([$id]);
        Json::send(['invoice' => $inv, 'lines' => $linesStmt->fetchAll()]);
    }
    if ($method === 'PUT' && $action === '') {
        $b = Json::readBody();
        // Keep the invoice number immutable; everything else is patchable.
        $fields = [
            'client_id', 'onboarding_client_id',
            'bill_to_name', 'bill_to_email', 'bill_to_address',
            'currency', 'issue_date', 'due_date', 'status', 'notes',
        ];
        $sets = []; $vals = [];
        foreach ($fields as $f) {
            if (!array_key_exists($f, $b)) continue;
            $sets[] = "$f = ?";
            $vals[] = $b[$f];
        }
        if ($sets) {
            $vals[] = $id;
            $pdo->prepare('UPDATE invoices SET ' . implode(', ', $sets) . ' WHERE id = ?')->execute($vals);
        }
        Json::send(['ok' => true]);
    }
    if ($method === 'DELETE' && $action === '') {
        $pdo->prepare('DELETE FROM invoices WHERE id = ?')->execute([$id]);
        Json::send(['ok' => true]);
    }

    Json::fail('Method not allowed', 405);
}
