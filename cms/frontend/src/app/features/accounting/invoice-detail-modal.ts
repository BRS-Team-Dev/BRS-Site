import { Component, EventEmitter, Input, Output, SimpleChanges, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { DialogService } from '../../core/dialog';
import { AppSettings, Invoice, InvoiceLine, InvoiceServiceLink, InvoiceStatus, InvoiceTemplate } from '../../core/models';
import { SettingsService } from '../../core/settings.service';

/** Resolved invoice-branding configuration used when we draw a PDF or
 *  the "View" HTML tab. Populated from the tenant's `invoice.*` settings
 *  keys (see Settings → Invoices). Missing keys degrade to sensible
 *  defaults so a tenant that hasn't filled anything in still gets a
 *  usable invoice — just without their branding / bank details. */
interface InvoiceBranding {
  business_name: string;
  business_address: string;
  business_email: string;
  business_phone: string;
  business_website: string;
  bank_name: string;
  bank_account_name: string;
  bank_account_number: string;
  bank_sort_code: string;
  show_bank_details: boolean;
  signature_name: string;
  signature_font: 'italic' | 'bold' | 'script';
  tax_label: string;
  /** Absolute URL to the tenant's logo. Falls back to the organisation
   *  `brand_logo_url` (Settings → General) when no invoice-specific
   *  override is set, so a tenant that's already uploaded a logo
   *  gets it on invoices out-of-the-box. */
  logo_url: string;
}

/**
 * Shared invoice detail modal.
 *
 * Opens whenever `invoiceId` changes to a non-null value. Handles header
 * edits, line-item edits, service detach and status transitions (send /
 * part-paid / paid) in place — parents just bind the id and listen for
 * `closed`. Reused by the client detail page's Invoices tab AND the
 * services-admin per-client detail page so both flows show the exact
 * same invoice UX without duplicating the template.
 *
 * amount_paid becomes an editable input when status = 'part_paid' so
 * staff can adjust the deposit / partial payment after the initial
 * "half the total" default the Part paid button applies.
 */
@Component({
  selector: 'app-invoice-detail-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    @if (invoiceId != null && open()) {
      <div class="modal-backdrop" (click)="close()">
        <div class="modal" (click)="$event.stopPropagation()" style="max-width: 780px;">
          <div class="modal-head">
            <h3>
              {{ detail()?.invoice?.invoice_number || 'Invoice' }}
              @if (detail()?.invoice?.status; as st) {
                <span class="pill" [attr.data-inv-status]="st" style="margin-left: 8px;">
                  {{ statusLabel(st) }}
                </span>
              }
            </h3>
            <button class="ghost icon-btn" (click)="close()">✕</button>
          </div>
          <div class="modal-body">
            @if (loading()) {
              <p class="muted">Loading…</p>
            } @else if (detail(); as d) {
              <div class="row two-col">
                <div>
                  <label>Bill to</label>
                  <input [(ngModel)]="draft.bill_to_name" name="id_bt"
                         (change)="saveHeader()" />
                </div>
                <div>
                  <label>Email</label>
                  <input [(ngModel)]="draft.bill_to_email" name="id_em"
                         (change)="saveHeader()" />
                </div>
              </div>
              <div class="row two-col">
                <div>
                  <label>Issue date</label>
                  <input type="date" [(ngModel)]="draft.issue_date" name="id_iss"
                         (change)="saveHeader()" />
                </div>
                <div>
                  <label>Due date</label>
                  <input type="date" [(ngModel)]="draft.due_date" name="id_due"
                         (change)="saveHeader()" />
                </div>
              </div>

              <label style="margin-top: 12px;">Services billed</label>
              @if (d.services.length === 0) {
                <p class="muted small">No services attached to this invoice.</p>
              } @else {
                <ul class="new-invoice-services">
                  @for (svc of d.services; track svc.client_service_offering_id) {
                    <li>
                      <span>{{ svc.name }}</span>
                      <span class="muted small">
                        {{ formatMoney(svc.price) }}
                        @if (svc.payment_type === 'recurring' && svc.repeat_duration) {
                          / {{ svc.repeat_duration }}
                        }
                      </span>
                      <button class="ghost icon-btn danger"
                              (click)="detachService(svc.client_service_offering_id)"
                              title="Remove from invoice">✕</button>
                    </li>
                  }
                </ul>
              }

              <label style="margin-top: 12px;">Line items</label>
              <table class="data invoice-lines">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th style="width:70px;">Qty</th>
                    <th style="width:100px;">Unit £</th>
                    <th style="width:70px;">Tax %</th>
                    <th style="width:100px;">Total</th>
                    <th style="width:36px;"></th>
                  </tr>
                </thead>
                <tbody>
                  @for (ln of lines(); track ln.id) {
                    <tr>
                      <td>
                        <input [(ngModel)]="ln.description" name="ld_{{ ln.id }}"
                               (change)="saveLine(ln)" />
                      </td>
                      <td>
                        <input type="number" min="0" step="0.01"
                               [(ngModel)]="ln.quantity" name="lq_{{ ln.id }}"
                               (change)="saveLine(ln)" />
                      </td>
                      <td>
                        <input type="number" min="0" step="0.01"
                               [(ngModel)]="ln.unit_price" name="lu_{{ ln.id }}"
                               (change)="saveLine(ln)" />
                      </td>
                      <td>
                        <input type="number" min="0" step="0.01"
                               [(ngModel)]="ln.tax_rate" name="lt_{{ ln.id }}"
                               (change)="saveLine(ln)" />
                      </td>
                      <td>{{ formatMoney(ln.line_total) }}</td>
                      <td>
                        <button class="ghost icon-btn danger"
                                (click)="removeLine(ln.id!)" title="Remove">✕</button>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
              <button class="ghost small" (click)="addLine()" style="margin-top: 6px;">
                + Add line
              </button>

              <!-- Actions on the left of the totals row: download the
                   invoice as a PDF (client-side render via html2pdf.js
                   against the hidden .pdf-source below) or email it to
                   bill_to_email (backend POST /email uses Mailer). -->
              <div class="totals-panel">
                <div class="totals-actions">
                  @if (templates().length > 0) {
                    <label class="tpl-picker">
                      <span class="tpl-picker-label">Template</span>
                      <select [ngModel]="pickedTemplateId()"
                              (ngModelChange)="pickedTemplateId.set($event ? +$event : null)"
                              name="tpl_pick">
                        <option [ngValue]="null">Built-in (Modern)</option>
                        @for (t of templates(); track t.id) {
                          <option [ngValue]="t.id">
                            {{ t.name }}{{ t.is_default ? ' — default' : '' }}
                          </option>
                        }
                      </select>
                    </label>
                  }
                  <button class="ghost action-btn"
                          [disabled]="pdfBusy()"
                          (click)="viewPdf()">
                    <span class="icon">👁</span>
                    {{ pdfBusy() ? 'Preparing…' : 'View PDF' }}
                  </button>
                  <button class="ghost action-btn"
                          [disabled]="pdfBusy()"
                          (click)="downloadPdf()">
                    <span class="icon">⬇</span>
                    {{ pdfBusy() ? 'Preparing…' : 'Download PDF' }}
                  </button>
                  <button class="ghost action-btn"
                          [disabled]="emailBusy() || !d.invoice.bill_to_email"
                          [title]="d.invoice.bill_to_email ? 'Send to ' + d.invoice.bill_to_email : 'Set bill_to_email first'"
                          (click)="sendEmail()">
                    <span class="icon">✉</span>
                    {{ emailBusy() ? 'Sending…' : 'Send email' }}
                  </button>
                  @if (emailSentTo(); as target) {
                    <span class="muted small">Sent to {{ target }}</span>
                  }
                </div>
                <div class="totals-card">
                  <div class="row">
                    <span class="k">Subtotal</span>
                    <span class="v">{{ formatMoney(d.invoice.subtotal) }}</span>
                  </div>
                  <div class="row">
                    <span class="k">Tax</span>
                    <span class="v">{{ formatMoney(d.invoice.tax_total) }}</span>
                  </div>
                  <div class="divider"></div>
                  <div class="row grand">
                    <span class="k">Total</span>
                    <span class="v">{{ formatMoney(d.invoice.total) }}</span>
                  </div>
                  @if (d.invoice.status === 'part_paid' || d.invoice.status === 'paid') {
                    <div class="divider"></div>
                    <div class="row paid-row">
                      <span class="k">Paid</span>
                      @if (d.invoice.status === 'part_paid') {
                        <span class="paid-input">
                          <span class="prefix">£</span>
                          <input type="number" min="0" step="0.01"
                                 [ngModel]="paidDraft()"
                                 (ngModelChange)="paidDraft.set($event)"
                                 (change)="savePaid()"
                                 name="id_amt" />
                        </span>
                      } @else {
                        <span class="v">{{ formatMoney(d.invoice.amount_paid) }}</span>
                      }
                    </div>
                    <div class="row balance" [class.zero]="remainingBalance() === 0">
                      <span class="k">Balance</span>
                      <span class="v">{{ formatMoney(remainingBalance()) }}</span>
                    </div>
                    <div class="progress" [title]="'Paid ' + formatMoney(d.invoice.amount_paid) + ' of ' + formatMoney(d.invoice.total)">
                      <div class="bar" [style.width.%]="paidPct()"></div>
                    </div>
                  }
                </div>
              </div>

              @if (error()) { <div class="error-msg" style="margin-top: 10px;">{{ error() }}</div> }
            }
          </div>
          <!-- Footer splits into "Status" chips (current status highlighted,
               click to move to another state) + Done. Feels less like three
               floating buttons and more like a labelled control. -->
          <div class="modal-foot invoice-foot">
            <div class="status-group">
              <span class="status-label">Status</span>
              @if (detail()?.invoice?.status === 'draft') {
                <button class="status-chip current" [attr.data-inv-status]="'draft'">Draft</button>
                <button class="status-chip" (click)="markSent()">Mark sent</button>
              } @else {
                @if (detail()?.invoice?.status !== 'void') {
                  <button class="status-chip"
                          [class.current]="detail()?.invoice?.status === 'sent'"
                          [attr.data-inv-status]="'sent'"
                          (click)="markSent()">Not paid</button>
                  <button class="status-chip"
                          [class.current]="detail()?.invoice?.status === 'part_paid'"
                          [attr.data-inv-status]="'part_paid'"
                          (click)="markPartPaid()">Part paid</button>
                  <button class="status-chip"
                          [class.current]="detail()?.invoice?.status === 'paid'"
                          [attr.data-inv-status]="'paid'"
                          (click)="markPaid()">Paid</button>
                }
              }
            </div>
            <button class="primary" (click)="close()">Done</button>
          </div>
        </div>
      </div>
    }

  `,
  styles: [`
    /* ── Totals row ─────────────────────────────────────────────────
       Two columns: actions on the LEFT (Download PDF / Send email —
       filling what was empty space), totals card on the RIGHT. Wraps
       to stacked on narrow modals. */
    .totals-panel {
      display: flex; align-items: flex-start; justify-content: space-between;
      gap: 24px; margin-top: 16px; flex-wrap: wrap;
    }
    .totals-actions {
      display: flex; flex-direction: column; gap: 8px;
      flex: 1; min-width: 180px;
    }
    .totals-actions .action-btn {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 8px 14px; border-radius: var(--radius-sm);
      background: var(--bg-2); border: 1px solid var(--line);
      color: var(--fg); cursor: pointer; font-size: 13px;
      transition: border-color 120ms ease, background 120ms ease;
      justify-content: flex-start;
    }
    .totals-actions .action-btn:hover:not([disabled]) { border-color: var(--primary); color: var(--primary); }
    .totals-actions .action-btn[disabled] { opacity: 0.55; cursor: not-allowed; }
    .totals-actions .action-btn .icon { font-size: 14px; }
    /* Template picker — sits above the action buttons in the same column. */
    .totals-actions .tpl-picker { display: flex; flex-direction: column; gap: 4px; margin-bottom: 4px; }
    .totals-actions .tpl-picker-label {
      color: var(--muted); text-transform: uppercase;
      letter-spacing: 0.5px; font-size: 11px;
    }
    .totals-actions .tpl-picker select {
      padding: 6px 10px; background: var(--bg-2);
      border: 1px solid var(--line); color: var(--fg);
      border-radius: var(--radius-sm); font: inherit;
    }

    /* ── Original totals card ───────────────────────────────────────
       Right-aligned receipt-style summary. Narrow max-width so it
       doesn't compete with the line-items grid on wide modals. */
    .totals-card {
      width: 100%; max-width: 320px;
      background: var(--bg-3); border: 1px solid var(--line);
      border-radius: var(--radius-sm); padding: 14px 18px;
      display: flex; flex-direction: column; gap: 8px;
      font-size: 14px;
    }
    .totals-card .row {
      display: flex; align-items: center; justify-content: space-between;
      gap: 12px;
    }
    .totals-card .k { color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; font-size: 11px; }
    .totals-card .v { color: var(--fg); font-variant-numeric: tabular-nums; }
    .totals-card .divider { height: 1px; background: var(--line); margin: 2px 0; }
    /* Grand total — bigger, gold, right-anchored so the eye lands here. */
    .totals-card .grand .k { color: var(--fg); font-size: 12px; }
    .totals-card .grand .v { color: var(--primary); font-size: 18px; font-weight: 700; }
    /* Paid row — the input sits flush with the right column. */
    .totals-card .paid-row .v { color: #60a5fa; font-weight: 600; }
    .totals-card .paid-input {
      display: inline-flex; align-items: center; gap: 0;
      background: var(--bg-2); border: 1px solid var(--line);
      border-radius: 4px; padding: 0 8px;
    }
    .totals-card .paid-input .prefix { color: var(--muted); margin-right: 2px; }
    .totals-card .paid-input input {
      border: none; background: transparent; color: var(--fg);
      padding: 4px 0; width: 90px; text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .totals-card .paid-input input:focus { outline: none; }
    /* Outstanding balance — turns red when > 0 to prompt "still owed". */
    .totals-card .balance .k { color: var(--muted); }
    .totals-card .balance .v { color: var(--danger); font-weight: 600; }
    .totals-card .balance.zero .v { color: var(--muted); font-weight: 500; }
    /* Progress bar — visual reminder of how far the client is through. */
    .totals-card .progress {
      height: 6px; background: var(--bg-2); border-radius: 999px;
      overflow: hidden; margin-top: 4px;
    }
    .totals-card .progress .bar {
      height: 100%; background: #60a5fa;
      border-radius: 999px; transition: width 200ms ease;
    }

    /* ── Footer status control ─────────────────────────────────────
       "Status: [Not paid] [Part paid] [Paid]" — chips highlight the
       current state so staff see at a glance where the invoice is. */
    .invoice-foot { justify-content: space-between; align-items: center; gap: 12px; }
    .status-group { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .status-label { color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; font-size: 11px; margin-right: 4px; }
    .status-chip {
      padding: 6px 12px; border-radius: 999px; font-size: 12px;
      font-weight: 600; letter-spacing: 0.3px;
      background: transparent; color: var(--muted);
      border: 1px solid var(--line); cursor: pointer;
      transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
    }
    .status-chip:hover:not(.current) { border-color: var(--primary); color: var(--fg); }
    .status-chip.current { cursor: default; }
    .status-chip.current[data-inv-status="draft"]     { color: var(--muted); border-color: var(--muted); background: var(--bg-3); }
    .status-chip.current[data-inv-status="sent"]      { color: #f59e0b; border-color: #f59e0b; background: rgba(245,158,11,0.10); }
    .status-chip.current[data-inv-status="part_paid"] { color: #60a5fa; border-color: #60a5fa; background: rgba(96,165,250,0.12); }
    .status-chip.current[data-inv-status="paid"]      { color: #56c98a; border-color: #56c98a; background: rgba(86,201,138,0.12); }
  `],
})
export class InvoiceDetailModal {
  private api = inject(Api);
  private dialog = inject(DialogService);
  private settingsSvc = inject(SettingsService);

  /** Trigger the initial settings load (idempotent) so the branding is
   *  available by the time a user clicks Download / View / Send. */
  constructor() {
    this.settingsSvc.ensureLoaded();
    this.ensureTemplatesLoaded();
  }

  /** Fetch the tenant's saved templates once per session so the picker
   *  in the modal footer can render immediately when the user opens
   *  their first invoice. Idempotent — safe to call from `open()`. */
  private ensureTemplatesLoaded() {
    if (this.templatesLoaded) return;
    this.templatesLoaded = true;
    this.api.listInvoiceTemplates().subscribe({
      next: r => {
        const list = r.templates || [];
        this.templates.set(list);
        // Auto-select the tenant's default template so first-time users
        // don't have to touch the dropdown — Download uses it as-is.
        const def = list.find(t => t.is_default);
        if (def?.id) this.pickedTemplateId.set(def.id);
      },
      error: () => this.templates.set([]),
    });
  }

  /** Resolve the current tenant's invoice branding into a flat object.
   *  Called at draw time so any settings edited during the session are
   *  picked up on the very next PDF without a modal remount. */
  private branding(): InvoiceBranding {
    const s = (this.settingsSvc.settings() ?? {}) as AppSettings;
    const get = (k: string) => (s[k] as string) || '';
    const font = get('invoice.signature_font') as InvoiceBranding['signature_font'];
    return {
      business_name:       get('invoice.business_name'),
      business_address:    get('invoice.business_address'),
      business_email:      get('invoice.business_email'),
      business_phone:      get('invoice.business_phone'),
      business_website:    get('invoice.business_website'),
      bank_name:           get('invoice.bank_name'),
      bank_account_name:   get('invoice.bank_account_name'),
      bank_account_number: get('invoice.bank_account_number'),
      bank_sort_code:      get('invoice.bank_sort_code'),
      show_bank_details:   get('invoice.show_bank_details') !== '0',
      signature_name:      get('invoice.signature_name'),
      signature_font:      font || 'italic',
      tax_label:           get('invoice.tax_label') || 'Tax',
      // Prefer the per-invoice override; fall through to the org logo
      // from Settings → General so a tenant that's already uploaded a
      // brand mark doesn't have to re-configure it here.
      logo_url:            get('invoice.logo_url') || get('brand_logo_url'),
    };
  }

  /** Fetch a URL and return it as a data-URL (base64) so jsPDF can
   *  embed the image in the PDF stream. Cross-origin URLs go through
   *  the backend proxy via Api.fetchLogoBlob() so the JWT auth
   *  interceptor attaches the Bearer token; same-origin URLs fetch
   *  directly. Returns null on any failure so the PDF still renders
   *  without the logo rather than throwing. */
  private async fetchImageAsDataUrl(url: string): Promise<string | null> {
    if (!url) return null;

    const blobToDataUrl = (blob: Blob) => new Promise<string | null>(resolve => {
      const r = new FileReader();
      r.onload  = () => resolve(String(r.result || '') || null);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });

    try {
      const parsed = new URL(url, window.location.href);
      const sameOrigin = parsed.origin === window.location.origin;
      if (sameOrigin) {
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) return null;
        return await blobToDataUrl(await res.blob());
      }
      // Cross-origin → backend proxy over HttpClient (auth interceptor
      // adds the Bearer token). This is what was missing before, so
      // the raw fetch was silently 401-ing and the logo never rendered.
      const blob = await new Promise<Blob | null>(resolve => {
        this.api.fetchLogoBlob(url).subscribe({
          next: b => resolve(b),
          error: () => resolve(null),
        });
      });
      return blob ? await blobToDataUrl(blob) : null;
    } catch { return null; }
  }

  pdfBusy = signal(false);
  emailBusy = signal(false);
  /** Set after a successful send so the modal shows a confirmation
   *  chip ("Sent to jane@example.com") until the modal is reopened. */
  emailSentTo = signal<string | null>(null);

  /** Custom HTML templates uploaded via Settings → Invoices. Loaded on
   *  first open of the modal and cached for the session. The dropdown
   *  auto-picks the tenant's default template when one is flagged; a
   *  user override during the session is remembered per invoice open. */
  templates = signal<InvoiceTemplate[]>([]);
  pickedTemplateId = signal<number | null>(null);
  private templatesLoaded = false;

  /** null → modal is closed. Setting to a number opens + fetches. */
  @Input() invoiceId: number | null = null;
  @Output() closed = new EventEmitter<void>();

  open = signal(false);
  loading = signal(false);
  error = signal<string | null>(null);
  detail = signal<{ invoice: Invoice; services: InvoiceServiceLink[] } | null>(null);
  lines = signal<InvoiceLine[]>([]);
  /** Editable mirror of amount_paid — signal so the input tracks changes
   *  from re-fetches (mark-part-paid response updates the header). */
  paidDraft = signal<number | null>(null);

  draft: {
    bill_to_name: string;
    bill_to_email: string | null;
    issue_date: string;
    due_date: string | null;
  } = { bill_to_name: '', bill_to_email: null, issue_date: '', due_date: null };

  ngOnChanges(ch: SimpleChanges) {
    if ('invoiceId' in ch) {
      const id = this.invoiceId;
      if (id != null) {
        this.open.set(true);
        this.load(id);
      } else {
        this.open.set(false);
      }
    }
  }

  statusLabel(st?: InvoiceStatus | string | null): string {
    switch (st) {
      case 'draft':     return 'Draft';
      case 'sent':      return 'Not paid';
      case 'part_paid': return 'Part paid';
      case 'paid':      return 'Paid';
      case 'void':      return 'Void';
      default:          return String(st ?? '');
    }
  }

  formatMoney(v: number | string | null | undefined): string {
    if (v === null || v === undefined || v === '') return '—';
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) return '—';
    return n.toLocaleString(undefined, { style: 'currency', currency: 'GBP' });
  }

  /** Numeric total - paid, clamped at 0 so a stray over-payment doesn't
   *  render "-£X.XX". Used by the Balance row + progress bar in the
   *  right-hand totals card. */
  remainingBalance(): number {
    const inv = this.detail()?.invoice;
    if (!inv) return 0;
    const total = Number(inv.total ?? 0);
    const paid = Number(inv.amount_paid ?? 0);
    const rem = total - paid;
    return rem > 0 ? rem : 0;
  }

  /** Percentage paid, clamped to [0, 100]. Drives the .progress .bar
   *  width. When total is zero we render 100 so the bar looks full
   *  rather than empty on a £0 invoice that's been "settled". */
  paidPct(): number {
    const inv = this.detail()?.invoice;
    if (!inv) return 0;
    const total = Number(inv.total ?? 0);
    const paid = Number(inv.amount_paid ?? 0);
    if (!Number.isFinite(total) || total <= 0) return paid > 0 ? 100 : 0;
    const pct = (paid / total) * 100;
    if (pct < 0) return 0;
    if (pct > 100) return 100;
    return pct;
  }

  close() {
    this.open.set(false);
    this.detail.set(null);
    this.lines.set([]);
    this.error.set(null);
    this.emailSentTo.set(null);
    this.closed.emit();
  }

  private load(id: number) {
    this.loading.set(true);
    this.error.set(null);
    // Clear any "Sent to …" chip from a prior invoice so it doesn't
    // persist across the modal being reopened for a different row.
    this.emailSentTo.set(null);
    this.api.getInvoice(id).subscribe({
      next: r => this.applyDetail(r),
      error: (e: any) => {
        this.loading.set(false);
        this.error.set(e?.error?.error || 'Load failed');
      },
    });
  }

  private applyDetail(r: { invoice: Invoice; lines: InvoiceLine[]; services: InvoiceServiceLink[] }) {
    this.detail.set({ invoice: r.invoice, services: r.services || [] });
    this.lines.set((r.lines || []).map(l => ({
      ...l,
      quantity:   l.quantity   == null ? 1 : Number(l.quantity),
      unit_price: l.unit_price == null ? 0 : Number(l.unit_price),
      tax_rate:   l.tax_rate   == null ? 0 : Number(l.tax_rate),
    })));
    this.draft = {
      bill_to_name:  r.invoice.bill_to_name || '',
      bill_to_email: r.invoice.bill_to_email || null,
      issue_date:    r.invoice.issue_date || '',
      due_date:      r.invoice.due_date || null,
    };
    this.paidDraft.set(
      r.invoice.amount_paid === null || r.invoice.amount_paid === undefined
        ? null : Number(r.invoice.amount_paid)
    );
    this.loading.set(false);
  }

  private reload() {
    const id = this.detail()?.invoice?.id;
    if (id) this.load(id);
  }

  saveHeader() {
    const id = this.detail()?.invoice?.id;
    if (!id) return;
    this.api.updateInvoice(id, {
      bill_to_name:  this.draft.bill_to_name,
      bill_to_email: this.draft.bill_to_email,
      issue_date:    this.draft.issue_date,
      due_date:      this.draft.due_date,
    }).subscribe({ error: (e: any) => this.error.set(e?.error?.error || 'Save failed') });
  }

  saveLine(ln: InvoiceLine) {
    const id = this.detail()?.invoice?.id;
    if (!id || !ln.id) return;
    this.api.updateInvoiceLine(id, ln.id, {
      description: ln.description,
      quantity:    Number(ln.quantity),
      unit_price:  Number(ln.unit_price),
      tax_rate:    Number(ln.tax_rate),
    }).subscribe({
      next: () => this.reload(),
      error: (e: any) => this.error.set(e?.error?.error || 'Line save failed'),
    });
  }

  addLine() {
    const id = this.detail()?.invoice?.id;
    if (!id) return;
    this.api.addInvoiceLine(id, {
      description: 'New line',
      quantity: 1,
      unit_price: 0,
      tax_rate: 0,
    }).subscribe({ next: () => this.reload() });
  }

  removeLine(lineId: number) {
    const id = this.detail()?.invoice?.id;
    if (!id) return;
    this.api.deleteInvoiceLine(id, lineId).subscribe({ next: () => this.reload() });
  }

  detachService(csoId: number) {
    const id = this.detail()?.invoice?.id;
    if (!id) return;
    this.api.detachInvoiceService(id, csoId).subscribe({ next: () => this.reload() });
  }

  async downloadPdf() {
    const d = this.detail();
    if (!d || this.pdfBusy()) return;

    // If a custom template is picked, ask the backend to render it and
    // open the result in a new tab with an auto-triggered print dialog
    // — the browser's Save-as-PDF option produces the actual .pdf file.
    // If no template is picked (or the picker is empty), fall through
    // to the jsPDF drawer that we already ship as the "Modern" layout.
    const tplId = this.pickedTemplateId();
    if (tplId != null) {
      this.pdfBusy.set(true);
      this.api.renderInvoiceTemplate(tplId, d.invoice.id!).subscribe({
        next: r => {
          this.pdfBusy.set(false);
          this.openRenderedHtml(r.html, r.invoice_number, true);
        },
        error: (e: any) => {
          this.pdfBusy.set(false);
          this.dialog.alert(e?.error?.error || 'Template render failed.', { title: 'PDF error', variant: 'danger' });
        },
      });
      return;
    }

    this.pdfBusy.set(true);
    try {
      const { jsPDF } = await import('jspdf');
      const b = this.branding();
      // Preload the logo (if any) BEFORE draw so addImage can embed it
      // synchronously. A failed fetch just resolves to null and the
      // PDF renders without the logo — never blocks.
      const logoData = await this.fetchImageAsDataUrl(b.logo_url);
      const doc = this.drawInvoicePdf(
        new jsPDF({ unit: 'mm', format: 'a4' }),
        d.invoice, this.lines(), b, logoData,
      );
      const safe = (s?: string | null) => (s || '').replace(/[^A-Za-z0-9_-]+/g, '_');
      doc.save(`invoice-${safe(d.invoice.invoice_number)}.pdf`);
    } catch (err) {
      console.error(err);
      this.dialog.alert('PDF generation failed.', { title: 'PDF error', variant: 'danger' });
    } finally {
      this.pdfBusy.set(false);
    }
  }

  /** Open template-rendered HTML in a new tab. `autoPrint` triggers the
   *  browser print dialog immediately on load — this is the "Download"
   *  path, and Save-as-PDF from the print dialog produces the file. */
  private openRenderedHtml(html: string, invoiceNumber: string, autoPrint: boolean) {
    // Wrap the rendered template with a tiny toolbar + print helper so
    // there's always a visible fallback if autoprint gets blocked.
    const wrapped = `<!doctype html><html><head>
<meta charset="utf-8" />
<title>Invoice ${invoiceNumber}</title>
<style>
  body { margin: 0; font-family: Arial, sans-serif; background: #f4f4f4; }
  .toolbar { position: sticky; top: 0; z-index: 999;
             background: #111; color: #fff; padding: 10px 20px;
             display: flex; align-items: center; gap: 12px; }
  .toolbar button { background: #d4a93a; color: #111; border: 0;
                    padding: 8px 16px; border-radius: 4px; cursor: pointer;
                    font-weight: 600; }
  .toolbar .hint { color: #aaa; font-size: 13px; }
  @media print { .toolbar { display: none; } body { background: #fff; } @page { size: A4; margin: 0; } }
</style>
</head><body>
<div class="toolbar">
  <button onclick="window.print()">Print / Save as PDF</button>
  <span class="hint">Ctrl+P also opens the print dialog.</span>
</div>
${html}
${autoPrint ? '<script>setTimeout(() => window.print(), 500);</script>' : ''}
</body></html>`;

    const win = window.open('', '_blank');
    if (!win) {
      const url = 'data:text/html;charset=utf-8,' + encodeURIComponent(wrapped);
      window.location.href = url;
      return;
    }
    win.document.open();
    win.document.write(wrapped);
    win.document.close();
  }

  /** Draw the invoice using jsPDF primitives — matches the reference
   *  layout (professional Australian-style tax invoice):
   *    Header:      logo/name (left)  |  "Invoice NNNN" + "Tax invoice" (right)
   *    Recipient:   BILL TO (left)    |  meta grid: Issue / Due / Reference (right)
   *    Summary bar: 4 cells in gold/dark — Inv No | Issue | Due | Total due
   *    Table:       Description | Qty | Unit price | Amount
   *    Totals:      Subtotal, Tax rows, Total (right)
   *    PAID TO:     Bank block (optional, from settings)
   *    Signature:   "Issued by, signature" + signed name in signature font
   *    Footer:      phone / website / email, then business name + address
   *
   *  A4 portrait: 210 x 297 mm. Left / right margins 15mm. */
  private drawInvoicePdf(doc: any, inv: Invoice, lines: InvoiceLine[], b: InvoiceBranding, logoData: string | null = null): any {
    const money = (v: any) => {
      if (v === null || v === undefined || v === '') return '-';
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n)) return '-';
      return 'GBP ' + n.toFixed(2);
    };
    const str = (v: any) => (v === null || v === undefined ? '' : String(v));

    const PAGE_W = 210;
    const LEFT   = 15;
    const RIGHT  = PAGE_W - LEFT; // 195
    const GOLD: [number, number, number] = [212, 169, 58];
    const DARK: [number, number, number] = [40, 40, 40];
    const MUTED: [number, number, number] = [110, 110, 110];
    const TEXT: [number, number, number] = [40, 40, 40];

    // ── HEADER ─────────────────────────────────────────────
    // Right: "Invoice NNNN" heading + "Tax invoice" caption
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.setTextColor(...DARK);
    doc.text(`Invoice ${str(inv.invoice_number)}`, RIGHT, 22, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text('Tax invoice', RIGHT, 27, { align: 'right' });

    // Left: logo above the business name when we have one embedded.
    // Logo is height-limited to 18mm so a tall image doesn't push the
    // BILL TO block down the page; width auto-scales to keep aspect.
    let nameY = 28;
    if (logoData) {
      try {
        // Detect format from the data-URL header (e.g. "data:image/png;…")
        const fmtMatch = /^data:image\/([a-z0-9+]+);/i.exec(logoData);
        const fmt = (fmtMatch?.[1] || 'PNG').toUpperCase().replace('SVG+XML', 'SVG');
        const props = doc.getImageProperties ? doc.getImageProperties(logoData) : { width: 100, height: 100 };
        const maxH  = 16;
        const scale = maxH / props.height;
        const w = Math.min(45, props.width * scale);
        const h = props.height * scale;
        doc.addImage(logoData, fmt, LEFT, 14, w, h);
        nameY = 14 + h + 6;
      } catch (err) {
        // Bad image data — carry on and let the name-only header render.
        console.warn('Invoice logo failed to render, falling back to name only.', err);
      }
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(...DARK);
    doc.text(b.business_name || 'Your Business', LEFT, nameY);

    // ── RECIPIENT + META ROW ───────────────────────────────
    // Left: BILL TO block
    let leftY = 44;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('BILL TO', LEFT, leftY);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...TEXT);
    leftY += 5;
    doc.text(str(inv.bill_to_name) || '-', LEFT, leftY);
    if (inv.bill_to_address) {
      const addrLines = doc.splitTextToSize(str(inv.bill_to_address), 80);
      for (const line of addrLines) {
        leftY += 4.5;
        doc.text(line, LEFT, leftY);
      }
    }
    if (inv.bill_to_email) {
      leftY += 4.5;
      doc.text(str(inv.bill_to_email), LEFT, leftY);
    }

    // Right: meta grid — label column right-anchored, value bold
    const metaLabelX = 160;
    const metaValueX = RIGHT;
    let metaY = 44;
    const drawMeta = (label: string, value: string) => {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(...MUTED);
      doc.text(label, metaLabelX, metaY, { align: 'right' });
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...TEXT);
      doc.text(value || '-', metaValueX, metaY, { align: 'right' });
      metaY += 5;
    };
    drawMeta('Issue date:', str(inv.issue_date));
    drawMeta('Due date:',   str(inv.due_date));
    drawMeta('Reference:',  str(inv.invoice_number));

    // ── SUMMARY BAR — 4 cells (gold, gold, gold, dark) ─────
    const barY = Math.max(leftY, metaY) + 8;
    const barH = 16;
    const cellW = (RIGHT - LEFT) / 4;

    // Gold cells (Inv No / Issue / Due)
    doc.setFillColor(...GOLD);
    doc.rect(LEFT,             barY, cellW * 3, barH, 'F');
    // Dark cell (Total due)
    doc.setFillColor(...DARK);
    doc.rect(LEFT + cellW * 3, barY, cellW,     barH, 'F');

    const cellLabel = (label: string, value: string, i: number, dark = false) => {
      const x = LEFT + cellW * i + 4;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(dark ? 200 : 255, dark ? 200 : 255, dark ? 200 : 255);
      doc.text(label, x, barY + 6);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(dark ? 13 : 11);
      doc.setTextColor(255, 255, 255);
      doc.text(value || '-', x, barY + 13);
    };
    cellLabel('Invoice No', str(inv.invoice_number), 0);
    cellLabel('Issue date', str(inv.issue_date),     1);
    cellLabel('Due date',   str(inv.due_date),       2);
    cellLabel('Total due (GBP)', money(inv.total).replace('GBP ', 'GBP '), 3, true);

    // ── LINE ITEMS TABLE ───────────────────────────────────
    let y = barY + barH + 10;
    const colDesc  = LEFT;
    const colQty   = 120;
    const colUnit  = 150;
    const colTotal = RIGHT;

    // Table header
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text('Description',      colDesc, y);
    doc.text('Quantity',         colQty,  y, { align: 'right' });
    doc.text('Unit price (GBP)', colUnit, y, { align: 'right' });
    doc.text('Amount (GBP)',     colTotal, y, { align: 'right' });
    y += 2;
    doc.setDrawColor(200);
    doc.line(LEFT, y, RIGHT, y);
    y += 6;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...TEXT);
    if (lines.length === 0) {
      doc.setTextColor(...MUTED);
      doc.text('No line items.', PAGE_W / 2, y, { align: 'center' });
      doc.setTextColor(...TEXT);
      y += 8;
    } else {
      for (const l of lines) {
        const descLines = doc.splitTextToSize(str(l.description), colQty - colDesc - 6);
        doc.text(descLines[0] ?? '', colDesc, y);
        doc.text(str(l.quantity),          colQty,  y, { align: 'right' });
        doc.text(money(l.unit_price).replace('GBP ', ''), colUnit, y, { align: 'right' });
        doc.text(money(l.line_total).replace('GBP ', ''), colTotal, y, { align: 'right' });
        y += 6;
      }
    }
    y += 2;
    doc.setDrawColor(220);
    doc.line(LEFT, y, RIGHT, y);
    y += 6;

    // ── SUBTOTALS BLOCK (right-aligned) ────────────────────
    const totalsX = RIGHT;
    const drawTotalRow = (label: string, value: string, bold = false, size = 10, colour = TEXT) => {
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.setFontSize(size);
      doc.setTextColor(...colour);
      doc.text(label,  colDesc, y);
      doc.text(value,  totalsX, y, { align: 'right' });
      y += 6;
    };
    drawTotalRow('Subtotal:', money(inv.subtotal).replace('GBP ', ''));
    if (Number(inv.tax_total) > 0) {
      drawTotalRow(`${b.tax_label}:`, money(inv.tax_total).replace('GBP ', ''));
    }
    y += 1;
    doc.setDrawColor(150);
    doc.line(totalsX - 60, y, totalsX, y);
    y += 5;
    drawTotalRow(`Total (GBP):`, money(inv.total).replace('GBP ', ''), true, 12);

    if (inv.status === 'part_paid' || inv.status === 'paid') {
      drawTotalRow('Paid:', money(inv.amount_paid).replace('GBP ', ''), false, 10, MUTED);
      if (inv.status === 'part_paid') {
        drawTotalRow('Balance:', money(this.remainingBalance()).replace('GBP ', ''), true, 10, [180, 90, 0]);
      }
    }

    // ── PAID TO block (optional) ───────────────────────────
    if (b.show_bank_details && (b.bank_name || b.bank_account_number)) {
      y += 8;
      doc.setFillColor(248, 246, 240);
      const paidBoxH = 30;
      doc.rect(LEFT, y, 90, paidBoxH, 'F');
      doc.setDrawColor(...GOLD);
      doc.setLineWidth(0.4);
      doc.line(LEFT, y, LEFT, y + paidBoxH);
      doc.setLineWidth(0.2);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(...DARK);
      doc.text('PAID TO', LEFT + 4, y + 6);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(...TEXT);
      let py = y + 12;
      const line = (l: string) => { doc.text(l, LEFT + 4, py); py += 4.5; };
      if (b.bank_name)           line(`Bank: ${b.bank_name}`);
      if (b.bank_account_name)   line(`Account name: ${b.bank_account_name}`);
      if (b.bank_account_number) line(`Account no: ${b.bank_account_number}`);
      if (b.bank_sort_code)      line(`Sort code: ${b.bank_sort_code}`);

      // ── Signature block — sits alongside the PAID TO card ──
      const sigX = 130;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(...MUTED);
      doc.text('Issued by, signature', sigX, y + 6);

      const sig = b.signature_name || b.business_name || '';
      if (sig) {
        // Map signature style → jsPDF built-in font. jsPDF doesn't ship
        // real script fonts, so we approximate with italics / sizing.
        switch (b.signature_font) {
          case 'bold':   doc.setFont('helvetica', 'bolditalic'); doc.setFontSize(18); break;
          case 'script': doc.setFont('times',     'italic');     doc.setFontSize(22); break;
          case 'italic':
          default:       doc.setFont('times',     'italic');     doc.setFontSize(18);
        }
        doc.setTextColor(...DARK);
        doc.text(sig, sigX, y + 22);
      }

      y += paidBoxH + 4;
    } else {
      // No PAID TO — still show the signature block on the right.
      y += 8;
      const sigX = 130;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(...MUTED);
      doc.text('Issued by, signature', sigX, y);
      const sig = b.signature_name || b.business_name || '';
      if (sig) {
        switch (b.signature_font) {
          case 'bold':   doc.setFont('helvetica', 'bolditalic'); doc.setFontSize(18); break;
          case 'script': doc.setFont('times',     'italic');     doc.setFontSize(22); break;
          case 'italic':
          default:       doc.setFont('times',     'italic');     doc.setFontSize(18);
        }
        doc.setTextColor(...DARK);
        doc.text(sig, sigX, y + 14);
      }
      y += 20;
    }

    // ── Notes (optional) ───────────────────────────────────
    if (inv.notes) {
      y += 6;
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(9);
      doc.setTextColor(...MUTED);
      const noteLines = doc.splitTextToSize(str(inv.notes), RIGHT - LEFT);
      doc.text(noteLines, LEFT, y);
      y += 4.5 * noteLines.length;
    }

    // ── FOOTER ─────────────────────────────────────────────
    const footerY = 275;
    doc.setDrawColor(220);
    doc.line(LEFT, footerY - 4, RIGHT, footerY - 4);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    const foot: string[] = [];
    if (b.business_phone)   foot.push(b.business_phone);
    if (b.business_website) foot.push(b.business_website);
    if (b.business_email)   foot.push(b.business_email);
    doc.text(foot.join('     '), PAGE_W / 2, footerY, { align: 'center' });

    if (b.business_name) {
      let fY = footerY + 5;
      doc.text(b.business_name, PAGE_W / 2, fY, { align: 'center' });
      if (b.business_address) {
        const addr = doc.splitTextToSize(b.business_address, 160);
        for (const line of addr) {
          fY += 4;
          doc.text(line, PAGE_W / 2, fY, { align: 'center' });
        }
      }
    }

    return doc;
  }

  /** View opens a printable HTML rendition of the invoice in a new tab.
   *  Bypasses html2canvas entirely — the browser renders the HTML
   *  natively so what you see is exactly what will print. The tab has
   *  a Print button and CSS @media print rules so the user can hit
   *  Ctrl+P → Save as PDF for a native PDF export. */
  viewPdf() {
    const d = this.detail();
    if (!d) return;

    // Custom template picked → backend renders it, we open in a new tab
    // WITHOUT auto-print so the user can review before saving.
    const tplId = this.pickedTemplateId();
    if (tplId != null) {
      this.pdfBusy.set(true);
      this.api.renderInvoiceTemplate(tplId, d.invoice.id!).subscribe({
        next: r => {
          this.pdfBusy.set(false);
          this.openRenderedHtml(r.html, r.invoice_number, false);
        },
        error: (e: any) => {
          this.pdfBusy.set(false);
          this.dialog.alert(e?.error?.error || 'Template render failed.', { title: 'View PDF', variant: 'danger' });
        },
      });
      return;
    }

    // Built-in "Modern" — client-side HTML.
    const html = this.buildPdfHtmlDocument(d.invoice, this.lines(), this.branding());
    const win = window.open('', '_blank');
    if (!win) {
      const url = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
      window.location.href = url;
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
  }

  /** Build the "View PDF" tab HTML — same visual layout as the PDF
   *  drawer (business header, bill-to + right meta, gold summary bar,
   *  line items, totals, PAID TO, signature, footer). Browser renders
   *  it natively; the toolbar's Print button uses the native Save-as-PDF. */
  private buildPdfHtmlDocument(inv: Invoice, displayLines: InvoiceLine[], b: InvoiceBranding): string {
    const esc = (s: any): string => {
      if (s === null || s === undefined) return '';
      return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    };
    const money = (v: number | string | null | undefined) => this.formatMoney(v);
    const nl = (s: string) => esc(s).replace(/\n/g, '<br />');

    const linesHtml = displayLines.length === 0
      ? `<tr><td colspan="4" style="padding:12px;color:#888;text-align:center;">No line items.</td></tr>`
      : displayLines.map(l => `
          <tr>
            <td>${esc(l.description)}</td>
            <td class="num">${esc(l.quantity)}</td>
            <td class="num">${esc(money(l.unit_price))}</td>
            <td class="num">${esc(money(l.line_total))}</td>
          </tr>
        `).join('');

    const paidBlock = inv.status === 'part_paid' || inv.status === 'paid'
      ? `<div class="row"><div class="label">Paid</div><div class="value">${esc(money(inv.amount_paid))}</div></div>`
        + (inv.status === 'part_paid'
          ? `<div class="row balance"><div class="label">Balance</div><div class="value">${esc(money(this.remainingBalance()))}</div></div>`
          : '')
      : '';

    // Map signature font choice → CSS. jsPDF can't ship a real script
    // font, but the browser can — use system-available cursive families.
    const sigFontCss = b.signature_font === 'bold'
      ? `font-family: 'Brush Script MT', 'Lucida Handwriting', cursive; font-size: 32px; font-weight: 700;`
      : b.signature_font === 'script'
      ? `font-family: 'Brush Script MT', 'Lucida Handwriting', cursive; font-size: 36px;`
      : `font-family: 'Times New Roman', Times, serif; font-style: italic; font-size: 28px;`;

    const sigText = b.signature_name || b.business_name || '';

    const paidToBlock = b.show_bank_details && (b.bank_name || b.bank_account_number) ? `
      <div class="paid-to">
        <div class="paid-to-label">PAID TO</div>
        ${b.bank_name           ? `<div><span class="k">Bank</span> ${esc(b.bank_name)}</div>` : ''}
        ${b.bank_account_name   ? `<div><span class="k">Account name</span> ${esc(b.bank_account_name)}</div>` : ''}
        ${b.bank_account_number ? `<div><span class="k">Account no</span> ${esc(b.bank_account_number)}</div>` : ''}
        ${b.bank_sort_code      ? `<div><span class="k">Sort code</span> ${esc(b.bank_sort_code)}</div>` : ''}
      </div>` : '';

    return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Invoice ${esc(inv.invoice_number)}</title>
<style>
  body { margin: 0; background: #f4f4f4; font-family: Arial, Helvetica, sans-serif; color: #333; font-size: 12px; }
  .bar {
    position: sticky; top: 0; z-index: 10;
    background: #111; color: #fff; padding: 10px 20px;
    display: flex; align-items: center; gap: 12px;
  }
  .bar button {
    background: #d4a93a; color: #111; border: 0; padding: 8px 16px;
    border-radius: 4px; cursor: pointer; font-weight: 600;
  }
  .bar .hint { color: #aaa; font-size: 13px; }

  .sheet {
    max-width: 820px; margin: 24px auto; background: #fff;
    padding: 48px; box-shadow: 0 2px 12px rgba(0,0,0,0.1);
    box-sizing: border-box;
  }

  /* Header */
  .head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; gap: 24px; }
  .head .biz { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
  .head .biz .logo { max-height: 60px; max-width: 180px; object-fit: contain; }
  .head .biz .biz-name { font-size: 20px; font-weight: 700; color: #222; }
  .head .inv-title { text-align: right; }
  .head .inv-title h1 { margin: 0; font-size: 26px; color: #222; font-weight: 600; }
  .head .inv-title .sub { color: #888; font-size: 11px; margin-top: 2px; }

  /* Recipient + meta grid */
  .recipient { display: flex; justify-content: space-between; margin-bottom: 24px; gap: 40px; }
  .bill-to { flex: 1; }
  .bill-to .label { font-weight: 700; margin-bottom: 6px; }
  .bill-to .lines { line-height: 1.5; }
  .meta { min-width: 220px; }
  .meta .row { display: flex; justify-content: space-between; padding: 3px 0; }
  .meta .row .k { color: #888; }
  .meta .row .v { font-weight: 700; }

  /* Summary bar */
  .summary { display: grid; grid-template-columns: 1fr 1fr 1fr 1.2fr; margin-bottom: 24px; }
  .summary .cell { padding: 10px 14px; background: #d4a93a; color: #fff; }
  .summary .cell.dark { background: #222; }
  .summary .cell .lbl { font-size: 10px; opacity: 0.9; }
  .summary .cell .val { font-size: 15px; font-weight: 700; margin-top: 3px; }
  .summary .cell.dark .val { font-size: 20px; }

  /* Line items */
  table.items { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  table.items th { padding: 8px 4px; text-align: left; color: #888; font-weight: 600; font-size: 11px; border-bottom: 1px solid #ccc; }
  table.items th.num, table.items td.num { text-align: right; }
  table.items td { padding: 10px 4px; border-bottom: 1px solid #eee; }

  /* Totals */
  .totals { max-width: 320px; margin-left: auto; margin-bottom: 24px; }
  .totals .row { display: flex; justify-content: space-between; padding: 4px 0; }
  .totals .row.total { font-weight: 700; font-size: 14px; border-top: 1px solid #999; padding-top: 8px; margin-top: 4px; color: #222; }
  .totals .row.balance .value { color: #b45309; font-weight: 700; }

  /* PAID TO + signature */
  .footer-block { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 32px; }
  .paid-to { padding: 14px 16px; background: #f8f6f0; border-left: 3px solid #d4a93a; }
  .paid-to .paid-to-label { font-weight: 700; margin-bottom: 8px; font-size: 11px; letter-spacing: 0.5px; }
  .paid-to div { line-height: 1.7; }
  .paid-to .k { color: #888; display: inline-block; min-width: 100px; }
  .sig { text-align: left; }
  .sig .sig-label { color: #888; font-size: 11px; margin-bottom: 8px; }
  .sig .sig-name { ${sigFontCss} color: #222; line-height: 1.2; }

  /* Notes */
  .notes { margin-top: 24px; color: #666; white-space: pre-wrap; font-style: italic; }

  /* Page footer */
  .foot { margin-top: 44px; padding-top: 12px; border-top: 1px solid #eee; text-align: center; color: #999; font-size: 11px; }
  .foot .contact span { margin: 0 10px; }
  .foot .biz-line { margin-top: 6px; color: #666; }

  @media print {
    body { background: #fff; }
    .bar { display: none; }
    .sheet { box-shadow: none; margin: 0; max-width: none; padding: 20mm; }
    @page { size: A4; margin: 0; }
  }
</style>
</head>
<body>
  <div class="bar">
    <button onclick="window.print()">Print / Save as PDF</button>
    <span class="hint">Ctrl+P (Cmd+P on Mac) also opens the print dialog.</span>
  </div>

  <div class="sheet">
    <div class="head">
      <div class="biz">
        ${b.logo_url ? `<img class="logo" src="${esc(b.logo_url)}" alt="" />` : ''}
        <div class="biz-name">${esc(b.business_name || 'Your Business')}</div>
      </div>
      <div class="inv-title">
        <h1>Invoice ${esc(inv.invoice_number)}</h1>
        <div class="sub">Tax invoice</div>
      </div>
    </div>

    <div class="recipient">
      <div class="bill-to">
        <div class="label">BILL TO</div>
        <div class="lines">
          ${esc(inv.bill_to_name) || '&mdash;'}
          ${inv.bill_to_address ? `<br />${nl(inv.bill_to_address)}` : ''}
          ${inv.bill_to_email ? `<br />${esc(inv.bill_to_email)}` : ''}
        </div>
      </div>
      <div class="meta">
        <div class="row"><span class="k">Issue date:</span><span class="v">${esc(inv.issue_date) || '&mdash;'}</span></div>
        <div class="row"><span class="k">Due date:</span><span class="v">${esc(inv.due_date) || '&mdash;'}</span></div>
        <div class="row"><span class="k">Reference:</span><span class="v">${esc(inv.invoice_number) || '&mdash;'}</span></div>
      </div>
    </div>

    <div class="summary">
      <div class="cell"><div class="lbl">Invoice No</div><div class="val">${esc(inv.invoice_number)}</div></div>
      <div class="cell"><div class="lbl">Issue date</div><div class="val">${esc(inv.issue_date)}</div></div>
      <div class="cell"><div class="lbl">Due date</div><div class="val">${esc(inv.due_date) || '—'}</div></div>
      <div class="cell dark"><div class="lbl">Total due (GBP)</div><div class="val">${esc(money(inv.total))}</div></div>
    </div>

    <table class="items">
      <thead>
        <tr>
          <th>Description</th>
          <th class="num" style="width:70px;">Quantity</th>
          <th class="num" style="width:110px;">Unit price (£)</th>
          <th class="num" style="width:110px;">Amount (£)</th>
        </tr>
      </thead>
      <tbody>${linesHtml}</tbody>
    </table>

    <div class="totals">
      <div class="row"><div class="label">Subtotal:</div><div class="value">${esc(money(inv.subtotal))}</div></div>
      ${Number(inv.tax_total) > 0 ? `<div class="row"><div class="label">${esc(b.tax_label)}:</div><div class="value">${esc(money(inv.tax_total))}</div></div>` : ''}
      <div class="row total"><div class="label">Total (GBP):</div><div class="value">${esc(money(inv.total))}</div></div>
      ${paidBlock}
    </div>

    <div class="footer-block">
      ${paidToBlock || '<div></div>'}
      <div class="sig">
        <div class="sig-label">Issued by, signature</div>
        <div class="sig-name">${esc(sigText)}</div>
      </div>
    </div>

    ${inv.notes ? `<div class="notes">${esc(inv.notes)}</div>` : ''}

    <div class="foot">
      <div class="contact">
        ${b.business_phone   ? `<span>&#9742; ${esc(b.business_phone)}</span>`   : ''}
        ${b.business_website ? `<span>&#9673; ${esc(b.business_website)}</span>` : ''}
        ${b.business_email   ? `<span>&#9993; ${esc(b.business_email)}</span>`   : ''}
      </div>
      ${b.business_name ? `<div class="biz-line">${esc(b.business_name)}${b.business_address ? '<br />' + nl(b.business_address) : ''}</div>` : ''}
    </div>
  </div>
</body>
</html>`;
  }

  async sendEmail() {
    const inv = this.detail()?.invoice;
    if (!inv?.id || this.emailBusy()) return;
    const target = inv.bill_to_email;
    if (!target) {
      this.dialog.alert(
        'No email address on this invoice. Set Bill to → Email first.',
        { title: 'Send email', variant: 'danger' }
      );
      return;
    }
    const ok = await this.dialog.confirm(
      `Send invoice ${inv.invoice_number} to ${target}?`,
      { title: 'Send invoice', confirmLabel: 'Send' }
    );
    if (!ok) return;
    this.emailBusy.set(true);
    this.error.set(null);
    this.api.emailInvoice(inv.id).subscribe({
      next: r => {
        this.emailBusy.set(false);
        this.emailSentTo.set(r.sent_to);
        // Backend flipped draft → sent + stamped sent_at on the first
        // send — refresh so the header pill + Sent date reflect that.
        this.reload();
      },
      error: (e: any) => {
        this.emailBusy.set(false);
        this.error.set(e?.error?.error || 'Email failed');
      },
    });
  }

  markSent() {
    const id = this.detail()?.invoice?.id;
    if (!id) return;
    this.api.sendInvoice(id).subscribe({ next: () => this.reload() });
  }

  markPaid() {
    const id = this.detail()?.invoice?.id;
    if (!id) return;
    this.api.markInvoicePaid(id).subscribe({ next: () => this.reload() });
  }

  /** First press: server-side default half-total. Subsequent adjustments
   *  happen through the inline "Paid £" input below the totals. */
  markPartPaid() {
    const id = this.detail()?.invoice?.id;
    if (!id) return;
    this.api.markInvoicePartPaid(id).subscribe({ next: () => this.reload() });
  }

  /** User edited the amount_paid input on a part-paid invoice.
   *  Persist via a plain header PUT — server clamps to [0, total]. */
  savePaid() {
    const inv = this.detail()?.invoice;
    if (!inv?.id) return;
    const raw = this.paidDraft();
    const amt = raw === null || raw === undefined || (raw as any) === ''
      ? null : Number(raw);
    if (amt !== null && !Number.isFinite(amt)) return;
    this.api.updateInvoice(inv.id, { amount_paid: amt }).subscribe({
      next: () => this.reload(),
      error: (e: any) => this.error.set(e?.error?.error || 'Save failed'),
    });
  }
}
