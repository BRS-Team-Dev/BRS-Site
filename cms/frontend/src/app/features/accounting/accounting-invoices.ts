import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { Client, Invoice, InvoiceLine, InvoiceStatus } from '../../core/models';

const STATUSES: InvoiceStatus[] = ['draft', 'sent', 'paid', 'void'];

/**
 * Accounting → Invoices.
 *
 * List view on the left, detail panel on the right when a row is selected.
 * New invoices are drafted via `+ New invoice`; status transitions
 * (draft → sent → paid) are one-click buttons.
 *
 * Lines auto-save: blur on description / quantity / price / VAT triggers
 * `updateInvoiceLine` and the backend recalculates header totals.
 */
@Component({
  selector: 'app-accounting-invoices',
  imports: [FormsModule],
  template: `
    <div class="toolbar">
      <h1>Invoices</h1>
      <span class="spacer"></span>
      <div class="filters">
        <button class="filter" [class.active]="filter() === 'all'"   (click)="filter.set('all')">All ({{ invoices().length }})</button>
        @for (s of statuses; track s) {
          <button class="filter" [class.active]="filter() === s" (click)="filter.set(s)">{{ s }} ({{ counts()[s] }})</button>
        }
      </div>
      <button class="primary" (click)="openCreate()">+ New invoice</button>
    </div>

    <div class="page">
      @if (visible().length === 0) {
        <div class="empty"><p class="muted">No invoices in this view.</p></div>
      } @else {
        <ul class="slot-list">
          @for (i of visible(); track i.id) {
            <li class="slot" [class.active]="selectedId() === i.id" (click)="open(i)">
              <div class="slot-head">
                <strong>{{ i.invoice_number }}</strong>
                <span class="status status-{{ i.status }}">{{ i.status }}</span>
                <span class="spacer"></span>
                <span class="amount">{{ money(i.total, i.currency) }}</span>
              </div>
              <div class="slot-meta small">
                <span>{{ i.bill_to_name || i.client_name || '—' }}</span>
                @if (i.issue_date) { <span>· Issued {{ i.issue_date }}</span> }
                @if (i.due_date) { <span>· Due {{ i.due_date }}</span> }
              </div>
            </li>
          }
        </ul>
      }
    </div>

    @if (creating()) {
      <div class="modal-backdrop" (click)="closeCreate()">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-head">
            <h2>New invoice</h2>
            <button class="ghost icon-btn" (click)="closeCreate()" title="Close">✕</button>
          </div>
          <div class="modal-body">
            <div class="section-card">
              <h3 class="card-title">Bill to</h3>
              <div class="meta-row">
                <div class="meta-field">
                  <label>Client (optional)</label>
                  <select [ngModel]="draft.client_id" (ngModelChange)="setClient($event)" name="d_client">
                    <option [ngValue]="null">— manual —</option>
                    @for (c of clients(); track c.id) {
                      <option [ngValue]="c.id">{{ c.name }}@if (c.company) { · {{ c.company }} }</option>
                    }
                  </select>
                </div>
                <div class="meta-field">
                  <label>Bill-to name *</label>
                  <input [(ngModel)]="draft.bill_to_name" name="d_name" />
                </div>
              </div>
              <div class="meta-row">
                <div class="meta-field">
                  <label>Email</label>
                  <input type="email" [(ngModel)]="draft.bill_to_email" name="d_email" />
                </div>
                <div class="meta-field meta-narrow">
                  <label>Currency</label>
                  <input [(ngModel)]="draft.currency" name="d_cur" />
                </div>
              </div>
              <div class="meta-row">
                <div class="meta-field">
                  <label>Address</label>
                  <textarea rows="2" [(ngModel)]="draft.bill_to_address" name="d_addr"></textarea>
                </div>
              </div>
            </div>
            <div class="section-card">
              <h3 class="card-title">Dates</h3>
              <div class="meta-row">
                <div class="meta-field">
                  <label>Issue date</label>
                  <input type="date" [(ngModel)]="draft.issue_date" name="d_issue" />
                </div>
                <div class="meta-field">
                  <label>Due date</label>
                  <input type="date" [(ngModel)]="draft.due_date" name="d_due" />
                </div>
              </div>
            </div>
            @if (createError()) { <p class="err">{{ createError() }}</p> }
          </div>
          <div class="modal-foot">
            <span class="spacer"></span>
            <button class="ghost" (click)="closeCreate()">Cancel</button>
            <button class="primary" (click)="submitCreate()" [disabled]="!draft.bill_to_name.trim()">Create draft</button>
          </div>
        </div>
      </div>
    }

    @if (selected(); as inv) {
      <div class="modal-backdrop" (click)="closeDetail()">
        <div class="modal modal-wide" (click)="$event.stopPropagation()">
          <div class="modal-head">
            <div>
              <h2>{{ inv.invoice_number }} <span class="status status-{{ inv.status }}">{{ inv.status }}</span></h2>
              <div class="muted small">
                Issued {{ inv.issue_date }}
                @if (inv.due_date) { · Due {{ inv.due_date }} }
                · {{ money(inv.total, inv.currency) }}
              </div>
            </div>
            <button class="ghost icon-btn" (click)="closeDetail()" title="Close">✕</button>
          </div>

          <div class="modal-body">
            <div class="section-card">
              <h3 class="card-title">Bill to</h3>
              <div class="meta-row">
                <div class="meta-field">
                  <label>Name</label>
                  <input [ngModel]="inv.bill_to_name" (blur)="patchInvoice({ bill_to_name: $any($event.target).value })" name="i_name" />
                </div>
                <div class="meta-field">
                  <label>Email</label>
                  <input [ngModel]="inv.bill_to_email" (blur)="patchInvoice({ bill_to_email: $any($event.target).value })" name="i_email" />
                </div>
              </div>
              <div class="meta-row">
                <div class="meta-field">
                  <label>Address</label>
                  <textarea rows="2" [ngModel]="inv.bill_to_address" (blur)="patchInvoice({ bill_to_address: $any($event.target).value })" name="i_addr"></textarea>
                </div>
              </div>
            </div>

            <div class="section-card">
              <h3 class="card-title">Lines</h3>
              @if (lines().length === 0) {
                <p class="muted small no-notes">No lines yet — add the first one below.</p>
              } @else {
                <table class="lines">
                  <thead>
                    <tr>
                      <th>Description</th>
                      <th class="num">Qty</th>
                      <th class="num">Unit price</th>
                      <th class="num">VAT %</th>
                      <th class="num">Total</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (l of lines(); track l.id) {
                      <tr>
                        <td><input [ngModel]="l.description" (blur)="patchLine(l, { description: $any($event.target).value })" name="l_desc_{{ l.id }}" /></td>
                        <td class="num"><input type="number" step="0.01" [ngModel]="l.quantity"   (blur)="patchLine(l, { quantity:   +$any($event.target).value })" name="l_q_{{ l.id }}" /></td>
                        <td class="num"><input type="number" step="0.01" [ngModel]="l.unit_price" (blur)="patchLine(l, { unit_price: +$any($event.target).value })" name="l_u_{{ l.id }}" /></td>
                        <td class="num"><input type="number" step="0.01" [ngModel]="l.tax_rate"   (blur)="patchLine(l, { tax_rate:   +$any($event.target).value })" name="l_t_{{ l.id }}" /></td>
                        <td class="num">{{ money(lineGross(l), inv.currency) }}</td>
                        <td><button class="ghost icon-btn danger" (click)="deleteLine(l)" title="Remove">✕</button></td>
                      </tr>
                    }
                  </tbody>
                </table>
              }
              <div class="row">
                <button class="ghost" (click)="addLine()">+ Add line</button>
                <span class="spacer"></span>
                <span class="totals">
                  <span class="muted small">Subtotal</span>
                  <strong>{{ money(inv.subtotal, inv.currency) }}</strong>
                  <span class="muted small">VAT</span>
                  <strong>{{ money(inv.tax_total, inv.currency) }}</strong>
                  <span class="muted small">Total</span>
                  <strong class="total">{{ money(inv.total, inv.currency) }}</strong>
                </span>
              </div>
            </div>

            <div class="section-card">
              <h3 class="card-title">Notes</h3>
              <textarea rows="3" [ngModel]="inv.notes" (blur)="patchInvoice({ notes: $any($event.target).value })" name="i_notes"
                placeholder="Anything to print on the invoice (payment instructions, references, thank-you)."></textarea>
            </div>
          </div>

          <div class="modal-foot">
            @if (inv.status === 'draft') {
              <button class="primary" (click)="send()">→ Mark sent</button>
            } @else if (inv.status === 'sent') {
              <button class="primary" (click)="markPaid()">✓ Mark paid</button>
            }
            <span class="spacer"></span>
            <button class="ghost danger" (click)="del()">✕ Delete</button>
            <button class="ghost" (click)="closeDetail()">Close</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .toolbar { padding: 16px 20px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
    .toolbar h1 { margin: 0; font-size: 22px; }
    .spacer { flex: 1; }
    .filters { display: flex; gap: 4px; flex-wrap: wrap; }
    .filter {
      background: none; border: 1px solid var(--line); padding: 6px 12px;
      border-radius: var(--radius-sm); color: var(--muted); cursor: pointer; font-size: 12px;
      text-transform: capitalize;
    }
    .filter.active { color: var(--primary); border-color: var(--primary); }

    .page { padding: 20px; }
    .empty { padding: 48px 20px; text-align: center; }

    .slot-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .slot {
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
      padding: 12px 14px; display: flex; flex-direction: column; gap: 6px;
      cursor: pointer; transition: border-color 0.15s;
    }
    .slot:hover, .slot.active { border-color: var(--primary); }
    .slot-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .slot-head strong { font-size: 14px; }
    .slot-meta { padding-top: 6px; border-top: 1px solid var(--line); display: flex; flex-wrap: wrap; gap: 6px; color: var(--fg); }
    .amount { font-weight: 700; color: var(--primary); }

    .status {
      padding: 1px 8px; border-radius: 999px;
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      border: 1px solid var(--line);
    }
    .status-draft { color: var(--muted); }
    .status-sent  { color: #f59e0b;        border-color: #f59e0b; background: rgba(245,158,11,0.10); }
    .status-paid  { color: var(--primary); border-color: var(--primary); background: rgba(212,169,58,0.12); }
    .status-void  { color: #ef4444;        border-color: #ef4444; background: rgba(239,68,68,0.10); }

    /* Modal pattern matches the canonical hr-onboarding modal. */
    .modal-backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,0.6);
      display: flex; align-items: center; justify-content: center; z-index: 100;
    }
    .modal {
      width: 720px; max-width: 92vw; max-height: 92vh;
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius);
      display: flex; flex-direction: column; overflow: hidden;
    }
    .modal-wide { width: 920px; }
    .modal-head { display: flex; align-items: flex-start; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid var(--line); flex: 0 0 auto; gap: 12px; }
    .modal-head h2 { margin: 0 0 4px; font-size: 16px; display: flex; align-items: center; gap: 8px; }
    .modal-body { padding: 16px 18px; flex: 1 1 auto; overflow: auto; display: flex; flex-direction: column; gap: 14px; }
    .modal-foot { padding: 14px 18px; border-top: 1px solid var(--line); display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
    .modal-foot button.danger { background: rgba(239,68,68,0.10); color: #ef4444; border-color: #ef4444; }
    .modal-foot button.danger:hover { background: rgba(239,68,68,0.20); }

    .section-card {
      background: var(--bg-3); border: 1px solid var(--line); border-radius: var(--radius);
      padding: 16px; display: flex; flex-direction: column; gap: 12px;
    }
    .section-card .card-title {
      margin: 0; font-size: 13px; color: var(--muted);
      text-transform: uppercase; letter-spacing: 0.6px; font-weight: 700;
    }
    .section-card .no-notes { margin: 0; }
    .meta-row { display: flex; gap: 12px; flex-wrap: wrap; align-items: end; }
    .meta-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 200px; }
    .meta-field.meta-narrow { flex: 0 0 120px; min-width: 120px; }
    .meta-field label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; margin: 0; }
    .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .err { color: #ef4444; font-size: 13px; margin: 0; }

    table.lines { width: 100%; border-collapse: collapse; }
    table.lines th, table.lines td { padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: middle; }
    table.lines th { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; text-align: left; font-weight: 700; }
    table.lines td.num, table.lines th.num { text-align: right; }
    table.lines input { width: 100%; }
    table.lines td.num input { text-align: right; }

    .totals { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .totals strong { color: var(--fg); }
    .totals .total { color: var(--primary); font-size: 16px; }
  `],
})
export class AccountingInvoices {
  private api = inject(Api);

  readonly statuses = STATUSES;

  invoices = signal<Invoice[]>([]);
  clients  = signal<Client[]>([]);
  filter   = signal<'all' | InvoiceStatus>('all');

  selectedId = signal<number | null>(null);
  selected   = signal<Invoice | null>(null);
  lines      = signal<InvoiceLine[]>([]);

  creating    = signal(false);
  createError = signal<string | null>(null);
  draft: {
    client_id: number | null;
    bill_to_name: string;
    bill_to_email: string;
    bill_to_address: string;
    currency: string;
    issue_date: string;
    due_date: string;
  } = this.blankDraft();

  counts = computed(() => {
    const out: Record<InvoiceStatus, number> = { draft: 0, sent: 0, paid: 0, void: 0 };
    for (const i of this.invoices()) {
      const s = (i.status ?? 'draft') as InvoiceStatus;
      out[s] = (out[s] ?? 0) + 1;
    }
    return out;
  });

  visible = computed(() => {
    const f = this.filter();
    if (f === 'all') return this.invoices();
    return this.invoices().filter(i => (i.status ?? 'draft') === f);
  });

  ngOnInit() {
    this.refresh();
    this.api.listClients().subscribe(r => this.clients.set(r.clients));
  }

  refresh() { this.api.listInvoices().subscribe(r => this.invoices.set(r.invoices)); }

  // ── Create draft ──────────────────────────────────────────────────────
  blankDraft() {
    return {
      client_id: null as number | null,
      bill_to_name: '',
      bill_to_email: '',
      bill_to_address: '',
      currency: 'GBP',
      issue_date: new Date().toISOString().slice(0, 10),
      due_date: '',
    };
  }
  openCreate() {
    this.draft = this.blankDraft();
    this.createError.set(null);
    this.creating.set(true);
  }
  closeCreate() { this.creating.set(false); }
  setClient(clientId: number | null) {
    this.draft.client_id = clientId;
    if (clientId) {
      const c = this.clients().find(x => x.id === clientId);
      if (c) {
        this.draft.bill_to_name  = c.name;
        this.draft.bill_to_email = c.email ?? '';
      }
    }
  }
  submitCreate() {
    if (!this.draft.bill_to_name.trim()) { this.createError.set('Bill-to name is required'); return; }
    this.api.createInvoice({
      client_id:        this.draft.client_id,
      bill_to_name:     this.draft.bill_to_name.trim(),
      bill_to_email:    this.draft.bill_to_email.trim() || null,
      bill_to_address:  this.draft.bill_to_address.trim() || null,
      currency:         this.draft.currency || 'GBP',
      issue_date:       this.draft.issue_date,
      due_date:         this.draft.due_date || null,
    }).subscribe({
      next: r => {
        this.creating.set(false);
        this.refresh();
        // Auto-open the freshly created invoice so the user can add lines.
        this.api.getInvoice(r.id).subscribe(d => {
          this.selectedId.set(r.id);
          this.selected.set(d.invoice);
          this.lines.set(d.lines);
        });
      },
      error: e => this.createError.set(e?.error?.error || 'Failed'),
    });
  }

  // ── Detail panel ──────────────────────────────────────────────────────
  open(i: Invoice) {
    if (!i.id) return;
    this.selectedId.set(i.id);
    this.selected.set(i);
    this.lines.set([]);
    this.api.getInvoice(i.id).subscribe(d => {
      this.selected.set(d.invoice);
      this.lines.set(d.lines);
    });
  }
  closeDetail() {
    this.selectedId.set(null);
    this.selected.set(null);
    this.lines.set([]);
  }
  patchInvoice(p: Partial<Invoice>) {
    const inv = this.selected();
    if (!inv?.id) return;
    this.api.updateInvoice(inv.id, p).subscribe(() => {
      this.selected.set({ ...inv, ...p });
      this.refresh();
    });
  }

  // ── Lines ─────────────────────────────────────────────────────────────
  addLine() {
    const inv = this.selected();
    if (!inv?.id) return;
    this.api.addInvoiceLine(inv.id, { description: 'New line', quantity: 1, unit_price: 0, tax_rate: 0 })
      .subscribe(() => this.reloadDetail());
  }
  patchLine(l: InvoiceLine, p: Partial<InvoiceLine>) {
    const inv = this.selected();
    if (!inv?.id || !l.id) return;
    this.api.updateInvoiceLine(inv.id, l.id, p).subscribe(() => this.reloadDetail());
  }
  deleteLine(l: InvoiceLine) {
    const inv = this.selected();
    if (!inv?.id || !l.id) return;
    if (!confirm('Remove this line?')) return;
    this.api.deleteInvoiceLine(inv.id, l.id).subscribe(() => this.reloadDetail());
  }
  private reloadDetail() {
    const id = this.selectedId();
    if (!id) return;
    this.api.getInvoice(id).subscribe(d => {
      this.selected.set(d.invoice);
      this.lines.set(d.lines);
      this.refresh();
    });
  }

  // ── Status transitions ────────────────────────────────────────────────
  send() {
    const inv = this.selected();
    if (!inv?.id) return;
    this.api.sendInvoice(inv.id).subscribe(() => {
      this.selected.set({ ...inv, status: 'sent' });
      this.refresh();
    });
  }
  markPaid() {
    const inv = this.selected();
    if (!inv?.id) return;
    this.api.markInvoicePaid(inv.id).subscribe(() => {
      this.selected.set({ ...inv, status: 'paid' });
      this.refresh();
    });
  }
  del() {
    const inv = this.selected();
    if (!inv?.id) return;
    if (!confirm(`Delete ${inv.invoice_number}?`)) return;
    this.api.deleteInvoice(inv.id).subscribe(() => {
      this.closeDetail();
      this.refresh();
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────
  money(value: number | string | undefined, currency: string | undefined): string {
    const n = Number(value ?? 0);
    const cur = currency || 'GBP';
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(n);
  }
  lineGross(l: InvoiceLine): number {
    return Number(l.line_total ?? 0) + Number(l.line_tax ?? 0);
  }
}
