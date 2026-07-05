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
 *   GET    /api/accounting/invoices                    list (?client_id=X filters)
 *   POST   /api/accounting/invoices                    create draft (header + optional lines + optional service_link_ids)
 *   GET    /api/accounting/invoices/:id                detail (header + lines + services)
 *   PUT    /api/accounting/invoices/:id                update header (status, amount_paid, ...)
 *   DELETE /api/accounting/invoices/:id                delete (lines + service links cascade)
 *   POST   /api/accounting/invoices/:id/send           flip draft → sent, stamp sent_at
 *   POST   /api/accounting/invoices/:id/email          email the invoice HTML to bill_to_email, stamp sent_at
 *   POST   /api/accounting/invoices/:id/mark-paid      flip → paid, stamp paid_at, amount_paid = total
 *   POST   /api/accounting/invoices/:id/mark-part-paid amount_paid defaults to total / 2 when omitted
 *
 *   POST   /api/accounting/invoices/:id/lines          add line
 *   PUT    /api/accounting/invoices/:id/lines/:lid     update line
 *   DELETE /api/accounting/invoices/:id/lines/:lid     remove line
 *
 *   POST   /api/accounting/invoices/:id/services       body: { client_service_offering_id }
 *   DELETE /api/accounting/invoices/:id/services/:lid  detach a service from this invoice
 */

return function (string $method, array $segs): void {
    Auth::require();
    $pdo = Db::tpdo();
    $sub = (string)($segs[1] ?? '');

    if ($sub === 'invoices') {
        handleInvoices($pdo, $method, $segs);
        return;
    }
    if ($sub === 'templates') {
        handleTemplates($pdo, $method, $segs);
        return;
    }
    Json::fail('Not found', 404);
};

/** Handle /api/accounting/templates[/:id[/default|/render/:invoiceId]] */
function handleTemplates(\PDO|\BRS\TenantPdo $pdo, string $method, array $segs): void
{
    // Collection: /api/accounting/templates
    if (!isset($segs[2])) {
        if ($method === 'GET') {
            $rows = $pdo->query(
                'SELECT id, name, is_default, created_at, updated_at
                   FROM invoice_templates
                  ORDER BY is_default DESC, name'
            )->fetchAll();
            Json::send(['templates' => $rows]);
        }
        if ($method === 'POST') {
            $b = Json::readBody();
            $name = trim((string)($b['name'] ?? ''));
            $html = (string)($b['html'] ?? '');
            if ($name === '') Json::fail('name required', 400);
            if ($html === '') Json::fail('html required', 400);
            $isDefault = !empty($b['is_default']) ? 1 : 0;

            // Only one default per tenant — clear the flag on siblings
            // before the insert so the constraint is a plain check.
            if ($isDefault) {
                $pdo->query('UPDATE invoice_templates SET is_default = 0');
            }
            $pdo->prepare('INSERT INTO invoice_templates (name, html, is_default) VALUES (?,?,?)')
                ->execute([$name, $html, $isDefault]);
            Json::send(['id' => (int)$pdo->lastInsertId()], 201);
        }
        Json::fail('Method not allowed', 405);
    }

    $id = (int)$segs[2];
    if ($id <= 0) Json::fail('Invalid id', 400);
    $sel = $pdo->prepare('SELECT * FROM invoice_templates WHERE id = ?');
    $sel->execute([$id]);
    $tpl = $sel->fetch();
    if (!$tpl) Json::fail('Template not found', 404);

    $action = (string)($segs[3] ?? '');

    // PUT /api/accounting/templates/:id/default — flip this row to the
    // active default; clears the flag on all siblings first so the rule
    // "exactly one default per tenant" always holds.
    if ($action === 'default' && $method === 'POST') {
        $pdo->query('UPDATE invoice_templates SET is_default = 0');
        $pdo->prepare('UPDATE invoice_templates SET is_default = 1 WHERE id = ?')->execute([$id]);
        Json::send(['ok' => true]);
    }

    // POST /api/accounting/templates/:id/render/:invoiceId — return
    // the template HTML with mustache-style variables substituted for
    // the invoice + tenant branding. Used by the Download / View PDF
    // flow when the user has picked a custom template.
    if ($action === 'render' && isset($segs[4]) && $method === 'GET') {
        $invoiceId = (int)$segs[4];
        if ($invoiceId <= 0) Json::fail('Invalid invoice id', 400);

        $ist = $pdo->prepare(
            'SELECT i.*, c.name AS client_name
               FROM invoices i
               LEFT JOIN clients c ON c.id = i.client_id
              WHERE i.id = ?'
        );
        $ist->execute([$invoiceId]);
        $inv = $ist->fetch();
        if (!$inv) Json::fail('Invoice not found', 404);

        $lst = $pdo->prepare('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY sort_order, id');
        $lst->execute([$invoiceId]);
        $lines = $lst->fetchAll();

        // Tenant settings under invoice.* — feed the same branding
        // values the built-in template uses so custom templates can
        // reference {{business_name}}, {{bank_account_number}} etc.
        $settings = [];
        // Grab the cross-namespace brand_logo_url in the same query so
        // templateRender's fallback path doesn't need its own $pdo (it
        // previously referenced an undefined variable and silently
        // caught, so no logo ever rendered when only the general slot
        // was set).
        $sst = $pdo->prepare("SELECT k, v FROM settings WHERE k LIKE 'invoice.%' OR k = 'brand_logo_url'");
        $sst->execute();
        foreach ($sst->fetchAll() as $row) {
            $settings[$row['k']] = (string)$row['v'];
        }

        $html = templateRender($tpl['html'], $inv, $lines, $settings);
        Json::send(['html' => $html, 'invoice_number' => $inv['invoice_number']]);
    }

    if ($method === 'GET' && $action === '') {
        Json::send(['template' => $tpl]);
    }

    if ($method === 'PUT' && $action === '') {
        $b = Json::readBody();
        $sets = []; $vals = [];
        if (array_key_exists('name', $b)) {
            $n = trim((string)$b['name']);
            if ($n === '') Json::fail('name required', 400);
            $sets[] = 'name = ?'; $vals[] = $n;
        }
        if (array_key_exists('html', $b)) {
            $sets[] = 'html = ?'; $vals[] = (string)$b['html'];
        }
        if (array_key_exists('is_default', $b)) {
            $isD = !empty($b['is_default']) ? 1 : 0;
            if ($isD) $pdo->query('UPDATE invoice_templates SET is_default = 0');
            $sets[] = 'is_default = ?'; $vals[] = $isD;
        }
        if ($sets) {
            $vals[] = $id;
            $pdo->prepare('UPDATE invoice_templates SET ' . implode(', ', $sets) . ' WHERE id = ?')
                ->execute($vals);
        }
        Json::send(['ok' => true]);
    }

    if ($method === 'DELETE' && $action === '') {
        $pdo->prepare('DELETE FROM invoice_templates WHERE id = ?')->execute([$id]);
        Json::send(['ok' => true]);
    }

    Json::fail('Method not allowed', 405);
}

/** Fill mustache-style {{var}} placeholders + {{#lines}}…{{/lines}}
 *  block loops in the template HTML. Not a full templating engine —
 *  intentionally minimal so tenants can't smuggle PHP or shell in.
 *
 *  Supported placeholders:
 *    {{invoice_number}}, {{issue_date}}, {{due_date}}, {{status}}
 *    {{bill_to_name}}, {{bill_to_email}}, {{bill_to_address}}, {{notes}}
 *    {{subtotal}}, {{tax_total}}, {{total}}, {{amount_paid}}, {{balance}}
 *    {{business_name}}, {{business_address}}, {{business_email}},
 *    {{business_phone}}, {{business_website}}
 *    {{bank_name}}, {{bank_account_name}}, {{bank_account_number}}, {{bank_sort_code}}
 *    {{signature_name}}, {{tax_label}}
 *
 *  Line-item loop:
 *    {{#lines}}
 *      <tr><td>{{description}}</td><td>{{quantity}}</td>
 *          <td>{{unit_price}}</td><td>{{line_total}}</td></tr>
 *    {{/lines}}
 */
function templateRender(string $html, array $inv, array $lines, array $settings): string
{
    $money = static function ($v): string {
        if ($v === null || $v === '') return '';
        $n = (float)$v;
        return number_format($n, 2);
    };
    $esc = static fn($v): string => htmlspecialchars((string)($v ?? ''), ENT_QUOTES, 'UTF-8');

    $paid    = (float)($inv['amount_paid'] ?? 0);
    $total   = (float)($inv['total'] ?? 0);
    $balance = max(0, $total - $paid);

    $vars = [
        'invoice_number'       => (string)($inv['invoice_number'] ?? ''),
        'issue_date'           => (string)($inv['issue_date'] ?? ''),
        'due_date'             => (string)($inv['due_date'] ?? ''),
        'status'               => (string)($inv['status'] ?? ''),
        'bill_to_name'         => (string)($inv['bill_to_name'] ?? ''),
        'bill_to_email'        => (string)($inv['bill_to_email'] ?? ''),
        'bill_to_address'      => (string)($inv['bill_to_address'] ?? ''),
        'notes'                => (string)($inv['notes'] ?? ''),
        'subtotal'             => $money($inv['subtotal'] ?? 0),
        'tax_total'            => $money($inv['tax_total'] ?? 0),
        'total'                => $money($inv['total'] ?? 0),
        'amount_paid'          => $money($paid),
        'balance'              => $money($balance),
        'business_name'        => (string)($settings['invoice.business_name'] ?? ''),
        'business_address'     => (string)($settings['invoice.business_address'] ?? ''),
        'business_email'       => (string)($settings['invoice.business_email'] ?? ''),
        'business_phone'       => (string)($settings['invoice.business_phone'] ?? ''),
        'business_website'     => (string)($settings['invoice.business_website'] ?? ''),
        'bank_name'            => (string)($settings['invoice.bank_name'] ?? ''),
        'bank_account_name'    => (string)($settings['invoice.bank_account_name'] ?? ''),
        'bank_account_number'  => (string)($settings['invoice.bank_account_number'] ?? ''),
        'bank_sort_code'       => (string)($settings['invoice.bank_sort_code'] ?? ''),
        'signature_name'       => (string)($settings['invoice.signature_name'] ?? ''),
        'tax_label'            => (string)($settings['invoice.tax_label'] ?? 'Tax'),
        // Prefer the invoice-specific logo override; fall back to the
        // org-wide brand_logo_url so tenants that already uploaded a
        // logo don't need to duplicate it here.
        'logo_url'             => (string)($settings['invoice.logo_url'] ?? ''),
    ];
    if ($vars['logo_url'] === '') {
        // Cross-namespace fallback to the org-wide brand_logo_url set
        // from Settings → General. The caller's SELECT now pulls both
        // namespaces in one query so we read from the same array here.
        $vars['logo_url'] = (string)($settings['brand_logo_url'] ?? '');
    }

    // Expand {{#lines}} … {{/lines}} blocks first — otherwise the plain
    // {{var}} pass would strip variables OUT of the loop template.
    $html = preg_replace_callback(
        '/\{\{\s*#lines\s*\}\}(.*?)\{\{\s*\/lines\s*\}\}/s',
        static function ($m) use ($lines, $money, $esc) {
            $tpl = $m[1];
            $out = '';
            foreach ($lines as $l) {
                $rowVars = [
                    'description' => (string)($l['description'] ?? ''),
                    'quantity'    => (string)($l['quantity']    ?? ''),
                    'unit_price'  => $money($l['unit_price']    ?? 0),
                    'tax_rate'    => (string)($l['tax_rate']    ?? '0'),
                    'line_total'  => $money($l['line_total']    ?? 0),
                    'line_tax'    => $money($l['line_tax']      ?? 0),
                ];
                $row = $tpl;
                foreach ($rowVars as $k => $v) {
                    $row = str_replace('{{' . $k . '}}',        $esc($v), $row);
                    $row = str_replace('{{ ' . $k . ' }}',      $esc($v), $row);
                }
                $out .= $row;
            }
            return $out;
        },
        $html
    ) ?? $html;

    // Plain {{var}} substitution — HTML-escape to keep templates safe.
    foreach ($vars as $k => $v) {
        $html = str_replace('{{' . $k . '}}',        $esc($v), $html);
        $html = str_replace('{{ ' . $k . ' }}',      $esc($v), $html);
    }
    return $html;
}

/** Generate the next invoice number for the calendar year, e.g. INV-2026-0042. */
function nextInvoiceNumber(\PDO|\BRS\TenantPdo $pdo): string
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
function recalcInvoiceTotals(\PDO|\BRS\TenantPdo $pdo, int $invoiceId): void
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

/** Minimal invoice email body — a self-contained HTML block that Gmail
 *  / Outlook will render inline. Kept intentionally simple (no external
 *  CSS, only inline styles, safe fallback fonts) so it looks the same
 *  in every client without needing a proper email templating engine.
 *  The formatted total sits at the bottom; each line is a table row. */
function renderInvoiceEmailHtml(array $inv, array $lines): string
{
    $esc = static fn(?string $s): string => htmlspecialchars((string)($s ?? ''), ENT_QUOTES, 'UTF-8');
    $money = static function ($v): string {
        $n = $v === null || $v === '' ? 0.0 : (float)$v;
        return '&pound;' . number_format($n, 2);
    };

    $rows = '';
    foreach ($lines as $l) {
        $rows .= '<tr>'
            . '<td style="padding:6px 8px;border-bottom:1px solid #eee;">' . $esc($l['description']) . '</td>'
            . '<td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">' . $esc((string)(float)$l['quantity']) . '</td>'
            . '<td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">' . $money($l['unit_price']) . '</td>'
            . '<td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">' . $money($l['line_total']) . '</td>'
            . '</tr>';
    }
    if ($rows === '') {
        $rows = '<tr><td colspan="4" style="padding:12px;color:#888;text-align:center;">No line items.</td></tr>';
    }

    return
        '<div style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:640px;margin:0 auto;padding:24px;">'
        . '<h1 style="margin:0 0 8px;color:#111;">Invoice ' . $esc($inv['invoice_number']) . '</h1>'
        . '<p style="margin:0 0 16px;color:#555;">Issued ' . $esc($inv['issue_date'])
        . ($inv['due_date'] ? ' &middot; Due ' . $esc($inv['due_date']) : '') . '</p>'
        . '<p style="margin:0 0 24px;"><strong>Bill to:</strong><br>'
        . $esc($inv['bill_to_name'])
        . ($inv['bill_to_email'] ? '<br>' . $esc($inv['bill_to_email']) : '')
        . '</p>'
        . '<table style="width:100%;border-collapse:collapse;font-size:14px;">'
        . '<thead><tr style="background:#f6f6f6;">'
        . '<th style="padding:8px;text-align:left;">Description</th>'
        . '<th style="padding:8px;text-align:right;width:60px;">Qty</th>'
        . '<th style="padding:8px;text-align:right;width:90px;">Unit</th>'
        . '<th style="padding:8px;text-align:right;width:90px;">Total</th>'
        . '</tr></thead><tbody>' . $rows . '</tbody></table>'
        . '<div style="margin-top:20px;text-align:right;font-size:14px;">'
        .   '<div>Subtotal: ' . $money($inv['subtotal']) . '</div>'
        .   '<div>Tax: ' . $money($inv['tax_total']) . '</div>'
        .   '<div style="margin-top:6px;font-size:18px;font-weight:700;color:#111;">Total: ' . $money($inv['total']) . '</div>'
        . '</div>'
        . ($inv['notes'] ? '<p style="margin-top:24px;color:#555;white-space:pre-wrap;">' . $esc($inv['notes']) . '</p>' : '')
        . '</div>';
}

/** Compute and persist line_total + line_tax for a row. */
function recalcLineRow(\PDO|\BRS\TenantPdo $pdo, int $lineId): void
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

function handleInvoices(\PDO|\BRS\TenantPdo $pdo, string $method, array $segs): void
{
    // Collection: /api/accounting/invoices
    if (!isset($segs[2])) {
        if ($method === 'GET') {
            // Optional filters via query string: ?client_id=X (client's Invoices tab)
            // and ?service_link_id=Y (per-service invoice list on services-admin).
            $clientId      = isset($_GET['client_id'])       ? (int)$_GET['client_id']       : 0;
            $serviceLinkId = isset($_GET['service_link_id']) ? (int)$_GET['service_link_id'] : 0;

            $sql = 'SELECT i.*, c.name AS client_name FROM invoices i
                    LEFT JOIN clients c ON c.id = i.client_id';
            $args = [];
            $wheres = [];
            if ($clientId > 0) {
                $wheres[] = 'i.client_id = ?';
                $args[] = $clientId;
            }
            if ($serviceLinkId > 0) {
                $wheres[] = 'EXISTS (SELECT 1 FROM invoice_service_links isl
                                       WHERE isl.invoice_id = i.id
                                         AND isl.client_service_offering_id = ?)';
                $args[] = $serviceLinkId;
            }
            if ($wheres) $sql .= ' WHERE ' . implode(' AND ', $wheres);
            $sql .= ' ORDER BY i.issue_date DESC, i.id DESC';

            $stmt = $pdo->prepare($sql);
            $stmt->execute($args);
            $rows = $stmt->fetchAll();

            // Attach per-row service link summaries so the client's Invoices
            // tab can label each row with the services it bills for without
            // needing a follow-up GET per invoice.
            $ids = array_map(fn($r) => (int)$r['id'], $rows);
            $serviceMap = [];
            if ($ids) {
                $ph = implode(',', array_fill(0, count($ids), '?'));
                $svcStmt = $pdo->prepare(
                    "SELECT isl.invoice_id, isl.client_service_offering_id, cso.name
                       FROM invoice_service_links isl
                       JOIN client_service_offerings cso ON cso.id = isl.client_service_offering_id
                      WHERE isl.invoice_id IN ($ph)
                      ORDER BY isl.sort_order, isl.id"
                );
                $svcStmt->execute($ids);
                foreach ($svcStmt->fetchAll() as $sr) {
                    $iid = (int)$sr['invoice_id'];
                    $serviceMap[$iid] = $serviceMap[$iid] ?? [];
                    $serviceMap[$iid][] = [
                        'client_service_offering_id' => (int)$sr['client_service_offering_id'],
                        'name' => $sr['name'],
                    ];
                }
            }
            foreach ($rows as &$r) {
                $r['services'] = $serviceMap[(int)$r['id']] ?? [];
            }
            unset($r);

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

            // Optional service links — the caller can associate this
            // invoice with N client_service_offerings rows in one shot
            // so the Services tab can render an invoice chip per row.
            $links = is_array($b['service_link_ids'] ?? null) ? $b['service_link_ids'] : [];
            $lo = 0;
            foreach ($links as $slid) {
                $slid = (int)$slid;
                if ($slid <= 0) continue;
                $pdo->prepare('INSERT IGNORE INTO invoice_service_links
                    (invoice_id, client_service_offering_id, sort_order)
                    VALUES (?, ?, ?)')->execute([$id, $slid, $lo++]);
            }

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

    // /api/accounting/invoices/:id/email
    // Emails the invoice HTML to bill_to_email (or the address in the
    // body), also stamps sent_at so the row transitions to "sent" the
    // same way the plain /send action does. 400 when no target email.
    if ($action === 'email' && $method === 'POST') {
        if ($inv['status'] === 'void') Json::fail('Cannot email a voided invoice', 400);
        $body = Json::readBody();
        $to = trim((string)($body['to'] ?? $inv['bill_to_email'] ?? ''));
        if ($to === '' || !filter_var($to, FILTER_VALIDATE_EMAIL)) {
            Json::fail('No valid email address on this invoice — set bill_to_email first', 400);
        }

        // Pull lines + services for the rendered body so the email is
        // self-contained. Reuses the same GET-detail queries.
        $ls = $pdo->prepare('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY sort_order, id');
        $ls->execute([$id]);
        $lines = $ls->fetchAll();

        $subject = 'Invoice ' . $inv['invoice_number'];
        $html = renderInvoiceEmailHtml($inv, $lines);

        [$ok, $err] = \BRS\Mailer::sendVia('system', $to, $subject, $html);
        if (!$ok) Json::fail($err ?: 'Failed to send email', 500);

        // First send flips draft → sent so the row stops looking unsent
        // in the list. Re-sends leave sent_at alone (already stamped).
        if ($inv['status'] === 'draft') {
            $pdo->prepare('UPDATE invoices SET status = "sent", sent_at = NOW() WHERE id = ?')
                ->execute([$id]);
        }
        Json::send(['ok' => true, 'sent_to' => $to]);
    }

    // /api/accounting/invoices/:id/mark-paid
    if ($action === 'mark-paid' && $method === 'POST') {
        if ($inv['status'] === 'void') Json::fail('Cannot mark a voided invoice as paid', 400);
        $pdo->prepare(
            'UPDATE invoices SET status = "paid", paid_at = NOW(), amount_paid = total WHERE id = ?'
        )->execute([$id]);
        Json::send(['ok' => true]);
    }

    // /api/accounting/invoices/:id/mark-part-paid
    // Body: { amount_paid?: number }  — defaults to half the invoice total.
    if ($action === 'mark-part-paid' && $method === 'POST') {
        if ($inv['status'] === 'void') Json::fail('Cannot mark a voided invoice as part paid', 400);
        $b = Json::readBody();
        $total = (float)$inv['total'];
        $amt = (isset($b['amount_paid']) && $b['amount_paid'] !== '' && $b['amount_paid'] !== null)
            ? (float)$b['amount_paid']
            : round($total / 2, 2);
        // Clamp to [0, total] so admins can't record more paid than the
        // invoice value without switching to 'paid' proper.
        if ($amt < 0) $amt = 0;
        if ($amt > $total) $amt = $total;
        $pdo->prepare('UPDATE invoices SET status = "part_paid", amount_paid = ?, paid_at = NULL WHERE id = ?')
            ->execute([$amt, $id]);
        Json::send(['ok' => true, 'amount_paid' => $amt]);
    }

    // /api/accounting/invoices/:id/services[/:linkId]
    // Attach a client_service_offerings row to this invoice so the
    // Services tab can render "invoice raised" chips per row. DELETE
    // detaches one specific link; POST idempotently attaches.
    if ($action === 'services') {
        $linkId = isset($segs[4]) ? (int)$segs[4] : null;
        if ($method === 'POST' && $linkId === null) {
            $b = Json::readBody();
            $csoId = (int)($b['client_service_offering_id'] ?? 0);
            if ($csoId <= 0) Json::fail('client_service_offering_id required', 400);
            $nextStmt = $pdo->prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 FROM invoice_service_links WHERE invoice_id = ?');
            $nextStmt->execute([$id]);
            $next = (int)$nextStmt->fetchColumn();
            $pdo->prepare('INSERT IGNORE INTO invoice_service_links
                (invoice_id, client_service_offering_id, sort_order)
                VALUES (?, ?, ?)')->execute([$id, $csoId, $next]);
            Json::send(['ok' => true]);
        }
        if ($method === 'DELETE' && $linkId !== null) {
            $pdo->prepare('DELETE FROM invoice_service_links
                WHERE invoice_id = ? AND client_service_offering_id = ?')
                ->execute([$id, $linkId]);
            Json::send(['ok' => true]);
        }
        Json::fail('Method not allowed', 405);
    }

    // Header GET / PUT / DELETE
    if ($method === 'GET' && $action === '') {
        $linesStmt = $pdo->prepare('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY sort_order, id');
        $linesStmt->execute([$id]);
        $svcStmt = $pdo->prepare(
            'SELECT isl.id AS link_id, isl.client_service_offering_id, isl.sort_order,
                    cso.name, cso.price, cso.payment_type, cso.repeat_duration
               FROM invoice_service_links isl
               JOIN client_service_offerings cso ON cso.id = isl.client_service_offering_id
              WHERE isl.invoice_id = ?
              ORDER BY isl.sort_order, isl.id'
        );
        $svcStmt->execute([$id]);
        Json::send([
            'invoice'  => $inv,
            'lines'    => $linesStmt->fetchAll(),
            'services' => $svcStmt->fetchAll(),
        ]);
    }
    if ($method === 'PUT' && $action === '') {
        $b = Json::readBody();
        // Keep the invoice number immutable; everything else is patchable.
        $fields = [
            'client_id', 'onboarding_client_id',
            'bill_to_name', 'bill_to_email', 'bill_to_address',
            'currency', 'issue_date', 'due_date', 'status', 'notes', 'amount_paid',
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
