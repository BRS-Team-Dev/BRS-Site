import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { Api } from '../../core/api';
import { EntityContracts } from '../../shared/entity-contracts';
import { InvoiceDetailModal } from '../accounting/invoice-detail-modal';
import {
  Invoice,
  InvoiceStatus,
  ServiceClientDetail as ServiceClientDetailModel,
  ServiceClientStatus,
  ServiceOffering,
} from '../../core/models';

type TabKey = 'status' | 'onboarding' | 'tasks' | 'invoices' | 'contracts';

/**
 * /admin/services/:sid/client/:key
 *
 * Full-page tracking view for one client on one service. Replaces the
 * inline modal that used to open from the on-page Clients table; the
 * dedicated URL means deep links + back/forward + sidenav navigation
 * all work cleanly, and there's room for the tabs we'll need as
 * onboarding-side / tasks-side context grows.
 *
 * Layout mirrors the canonical 2-col CRM detail pattern (left card +
 * tabbed right pane), so it visually slots in next to the existing
 * client detail page.
 */
@Component({
  selector: 'app-service-client-detail',
  imports: [RouterLink, DatePipe, EntityContracts, InvoiceDetailModal],
  template: `
    <div class="toolbar">
      <button class="ghost" (click)="back()">← Back</button>
      <h1>{{ client()?.name || client()?.email || '…' }}</h1>
      <span class="spacer"></span>
      @if (loading()) { <span class="muted small">Loading…</span> }
    </div>

    @if (error()) {
      <div class="empty">
        <p class="muted">{{ error() }}</p>
        <button class="primary" (click)="back()">Back to services</button>
      </div>
    } @else if (client(); as c) {
      <div class="layout-2col">
        <!-- ── Left: identity card ─────────────────────────── -->
        <aside class="card info-card">
          <h2>Client</h2>

          <div class="kv">
            <label>Name</label>
            <div>{{ c.name || '—' }}</div>
          </div>
          <div class="kv">
            <label>Email</label>
            <div>{{ c.email || '—' }}</div>
          </div>
          @if (c.phone) {
            <div class="kv">
              <label>Phone</label>
              <div>{{ c.phone }}</div>
            </div>
          }
          @if (c.company) {
            <div class="kv">
              <label>Company</label>
              <div>{{ c.company }}</div>
            </div>
          }
          @if (c.address) {
            <div class="kv">
              <label>Address</label>
              <div>{{ c.address }}</div>
            </div>
          }

          <hr />

          <h2>Service</h2>
          <div class="kv">
            <label>Name</label>
            <div>{{ service()?.name || '—' }}</div>
          </div>
          <div class="kv">
            <label>Status</label>
            <div>
              <span class="status-pill" [attr.data-status]="c.status">{{ statusLabel(c.status) }}</span>
            </div>
          </div>
          <div class="kv">
            <label>Source</label>
            <div>
              <span class="sc-badge" [class.onboarding]="c.source === 'onboarding'">{{ c.source }}</span>
            </div>
          </div>
          @if (c.client_id) {
            <div class="kv">
              <label>CRM record</label>
              <div>
                <a [routerLink]="['/admin/clients', c.client_id]">Open client profile →</a>
              </div>
            </div>
          }
        </aside>

        <!-- ── Right: tabbed work pane ─────────────────────── -->
        <section class="card detail-card">
          <div class="tab-nav">
            @for (t of tabs; track t.key) {
              <button class="tab-btn"
                      [class.active]="activeTab() === t.key"
                      (click)="onTabClick(t.key)">
                {{ t.label }}
              </button>
            }
          </div>

          <div class="tab-content">
            @switch (activeTab()) {

              <!-- ─ Status ─ -->
              @case ('status') {
                <div class="tab-head"><h3>Workflow status</h3></div>
                @if (statusErr()) { <p class="error-msg">{{ statusErr() }}</p> }
                @if (statusMsg()) { <p class="success-msg">{{ statusMsg() }}</p> }

                <!-- Onboarding phase — the four front-end states the
                     client moves through before work begins. Each
                     transition auto-creates a CRM task framing the
                     next action. -->
                <h4 class="phase-title">Onboarding phase</h4>
                <p class="muted small no-notes">Sending the link → form submitted → admin approval.</p>
                <div class="status-grid">
                  @for (s of onboardingPhase; track s) {
                    <button type="button"
                            class="status-chip"
                            [attr.data-status]="s"
                            [class.selected]="c.status === s"
                            [disabled]="statusBusy()"
                            (click)="changeStatus(s)">
                      {{ statusLabel(s) }}
                    </button>
                  }
                </div>

                <!-- Work phase — automatically reached when admin
                     hits "qualified" (which auto-bumps to to_do
                     server-side). Move between these to track
                     delivery. -->
                <h4 class="phase-title" style="margin-top: 22px;">Work phase</h4>
                <p class="muted small no-notes">Started after qualification — track delivery here.</p>
                <div class="status-grid">
                  @for (s of workPhase; track s) {
                    <button type="button"
                            class="status-chip"
                            [attr.data-status]="s"
                            [class.selected]="c.status === s"
                            [disabled]="statusBusy()"
                            (click)="changeStatus(s)">
                      {{ statusLabel(s) }}
                    </button>
                  }
                </div>
              }

              <!-- ─ Onboarding ─ -->
              @case ('onboarding') {
                <div class="tab-head">
                  <h3>Onboarding</h3>
                  <span class="spacer"></span>
                  <!-- Granular qualification marker. Stays consistent
                       with the workflow status — "Pending
                       qualification" only after submission, never
                       when the row hasn't moved yet. -->
                  @if (qualificationBadge(c); as b) {
                    <span class="qual-badge" [attr.data-mode]="b.mode">{{ b.label }}</span>
                  }
                </div>

                <!-- Form info — show what's known regardless of
                     source. For catalogue-direct clients we just
                     surface a label so admins know nothing's tied
                     yet; the qualified marker above still tells
                     them where the row is in the workflow. -->
                <div class="kv">
                  <label>Form</label>
                  <div>{{ c.form_title || (c.source === 'catalogue' ? 'Direct catalogue attach — no form linked' : '(untitled)') }}</div>
                </div>
                <div class="kv">
                  <label>Submitted</label>
                  <div>
                    @if (c.submitted_at) {
                      {{ c.submitted_at | date:'mediumDate' }}
                    } @else { Not submitted yet }
                  </div>
                </div>
                <div class="kv">
                  <label>Qualified</label>
                  <div>
                    @if (c.qualified_at) {
                      {{ c.qualified_at | date:'mediumDate' }}
                    } @else if (isQualified(c)) {
                      Approved (no audit timestamp — pre-117 row)
                    } @else { Awaiting qualification }
                  </div>
                </div>

                <div class="row" style="margin-top: 16px;">
                  @if (c.form_id && c.onboarding_client_id) {
                    <!-- Row came in through the form — go straight
                         to the per-client pipeline view. -->
                    <a class="primary" [routerLink]="['/admin/onboarding', c.form_id, 'clients']">
                      Open onboarding pipeline →
                    </a>
                  } @else if (linkedForm(); as lf) {
                    <!-- Catalogue attach + the SERVICE has a linked
                         form. Same destination — pipeline for that
                         form — so the admin can invite this client. -->
                    <a class="primary" [routerLink]="['/admin/onboarding', lf.id, 'clients']">
                      Open onboarding pipeline →
                    </a>
                  } @else {
                    <!-- No form anywhere — offer the create-form CTA. -->
                    <a class="primary" [routerLink]="['/admin/onboarding/new']" [queryParams]="{ service: c.service_offering_id }">
                      + Create onboarding for this service
                    </a>
                  }
                </div>
              }

              <!-- ─ Tasks ─ -->
              @case ('tasks') {
                <div class="tab-head"><h3>Task project</h3></div>
                @if (c.project_id && c.project_team_id) {
                  <div class="kv">
                    <label>Project</label>
                    <div>{{ c.project_slug || c.project_id }}</div>
                  </div>
                  <div class="kv">
                    <label>Task-side state</label>
                    <div><span class="status-pill" [attr.data-status]="mappedProjectStatus()">{{ c.project_status || '—' }}</span></div>
                  </div>
                  <div class="row" style="margin-top: 16px;">
                    <a class="primary"
                       [routerLink]="['/tasks/team']"
                       [queryParams]="{ project: c.project_id }">
                      Open task board →
                    </a>
                  </div>
                } @else {
                  <p class="muted">
                    No task project yet. Projects are auto-created when
                    an onboarding form is qualified, IF the form is
                    bound to a task team. Direct catalogue attaches
                    don't currently spin one up — start one from the
                    task board if the work has begun.
                  </p>
                  <div class="row" style="margin-top: 16px;">
                    <a class="primary" routerLink="/tasks/team">Open task board →</a>
                  </div>
                }
              }

              <!-- ─ Invoices ─ -->
              @case ('invoices') {
                <div class="tab-head">
                  <h3>Invoices</h3>
                  <span class="spacer"></span>
                  @if (c.client_id) {
                    <a class="ghost small"
                       [routerLink]="['/admin/clients']"
                       [queryParams]="{ client: c.client_id, tab: 'invoices' }">
                      Manage on client →
                    </a>
                  }
                </div>
                @if (invoicesLoading()) {
                  <p class="muted">Loading invoices…</p>
                } @else if (invoicesForLink().length === 0) {
                  <p class="muted">
                    No invoices raised for this client on this service yet.
                    @if (c.client_id) {
                      Generate one from the client's <strong>Invoices</strong> tab.
                    }
                  </p>
                } @else {
                  <table class="data invoices-table">
                    <thead><tr>
                      <th>#</th>
                      <th>Issued</th>
                      <th>Due</th>
                      <th>Status</th>
                      <th style="text-align: right;">Total</th>
                    </tr></thead>
                    <tbody>
                      @for (inv of invoicesForLink(); track inv.id) {
                        <tr class="clickable" (click)="openInvoice(inv.id!)">
                          <td><strong>{{ inv.invoice_number }}</strong></td>
                          <td>{{ inv.issue_date || '—' }}</td>
                          <td>{{ inv.due_date || '—' }}</td>
                          <td><span class="status-pill" [attr.data-status]="inv.status">{{ invoiceStatusLabel(inv.status) }}</span></td>
                          <td style="text-align: right;">{{ formatMoney(inv.total) }}</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                }
              }

              <!-- ─ Contracts ─
                   Uses the shared <app-entity-contracts> component with
                   this client's services + a default service link so the
                   attach modal pre-selects "Management system" (or
                   whichever service this per-client page belongs to). -->
              @case ('contracts') {
                <div class="tab-head">
                  <h3>Contracts</h3>
                  <span class="spacer"></span>
                  @if (c.client_id) {
                    <a class="ghost small"
                       [routerLink]="['/admin/clients']"
                       [queryParams]="{ client: c.client_id, tab: 'contracts' }">
                      Manage on client →
                    </a>
                  }
                </div>
                @if (c.client_id) {
                  <app-entity-contracts
                    audience="client"
                    [entityId]="+c.client_id"
                    [services]="clientCatalogServices()"
                    [defaultServiceLinkId]="defaultServiceLinkIdForAttach()">
                  </app-entity-contracts>
                } @else {
                  <p class="muted">This client isn't attached via the catalogue yet — contracts open once the client is fully set up.</p>
                }
              }
            }
          </div>
        </section>
      </div>
    }

    <!-- Shared invoice detail modal — opens in place so staff can view
         and edit the invoice without leaving the per-client view. -->
    <app-invoice-detail-modal
      [invoiceId]="activeInvoiceId()"
      (closed)="onInvoiceClosed()">
    </app-invoice-detail-modal>
  `,
  styles: [`
    :host { display: block; min-width: 0; }

    .toolbar { padding: 16px 24px; display: flex; align-items: center; gap: 12px; }
    .toolbar h1 { margin: 0; font-size: 22px; }

    .empty { padding: 40px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 12px; }

    .info-card { padding: 22px; }
    .info-card h2 {
      font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;
      color: var(--muted); margin: 0 0 14px; font-weight: 600;
    }
    .info-card hr {
      border: none; border-top: 1px solid var(--line);
      margin: 22px 0 14px;
    }
    .info-card .kv { margin-bottom: 14px; }
    .info-card .kv > div { word-break: break-word; }
    .info-card a { color: var(--primary); text-decoration: none; }
    .info-card a:hover { text-decoration: underline; }

    .detail-card { padding: 0; }
    .tab-nav {
      display: flex; gap: 4px; padding: 0 18px;
      border-bottom: 1px solid var(--line);
    }
    .tab-btn {
      position: relative;
      background: transparent; border: 0; padding: 14px 14px;
      color: var(--muted); cursor: pointer; font-size: 14px;
    }
    .tab-btn:hover { color: var(--fg); }
    .tab-btn.active { color: var(--primary); }
    .tab-btn.active::after {
      content: ''; position: absolute; left: 12px; right: 12px; bottom: -1px;
      height: 2px; background: var(--primary);
    }
    .tab-content { padding: 24px; }
    .tab-content h3 { font-size: 16px; margin: 0; }
    .tab-head { display: flex; align-items: center; margin-bottom: 16px; }

    .kv label {
      display: block;
      color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
      margin-bottom: 2px;
    }

    /* Status pill + chip — same colour scheme as the services-admin
       list, kept duplicated here so this page doesn't depend on a
       sibling component's styles. */
    .status-pill, .status-chip {
      display: inline-block;
      padding: 2px 10px; border-radius: 999px;
      font-size: 12px; font-weight: 600; letter-spacing: 0.3px;
      background: var(--bg-2); color: var(--muted);
      border: 1px solid transparent;
    }
    /* Invoice status colours — matches the client-side Invoices tab. */
    .status-pill[data-status="draft"]     { color: var(--muted); }
    .status-pill[data-status="sent"]      { color: #f59e0b; border-color: #f59e0b; background: rgba(245,158,11,0.10); }
    .status-pill[data-status="part_paid"] { color: #60a5fa; border-color: #60a5fa; background: rgba(96,165,250,0.12); }
    .status-pill[data-status="paid"]      { color: #56c98a; border-color: #56c98a; background: rgba(86,201,138,0.12); }
    .status-pill[data-status="void"]      { color: var(--muted); text-decoration: line-through; }
    /* Clickable rows in the Invoices table (only) — hover cue + pointer. */
    .invoices-table tr.clickable { cursor: pointer; }
    .invoices-table tr.clickable:hover { background: var(--bg-3); }
    /* 8-state colour scheme. Onboarding phase tints sit on cool
       hues (slate / blue / amber / gold); work phase moves through
       warm green completion + a muted hold. */
    .status-pill[data-status="new"], .status-chip[data-status="new"] {
      background: color-mix(in oklab, var(--muted), transparent 78%); color: var(--muted);
    }
    .status-pill[data-status="onboarding"], .status-chip[data-status="onboarding"] {
      background: color-mix(in oklab, #8aa9ff, transparent 80%); color: #8aa9ff;
    }
    .status-pill[data-status="submitted"], .status-chip[data-status="submitted"] {
      background: color-mix(in oklab, var(--warning), transparent 80%); color: var(--warning);
    }
    .status-pill[data-status="qualified"], .status-chip[data-status="qualified"] {
      background: color-mix(in oklab, var(--primary), transparent 78%); color: var(--primary);
    }
    .status-pill[data-status="to_do"], .status-chip[data-status="to_do"] {
      background: color-mix(in oklab, #b48aff, transparent 80%); color: #b48aff;
    }
    .status-pill[data-status="in_progress"], .status-chip[data-status="in_progress"] {
      background: color-mix(in oklab, var(--primary), transparent 80%); color: var(--primary);
    }
    .status-pill[data-status="done"], .status-chip[data-status="done"] {
      background: color-mix(in oklab, var(--success), transparent 78%); color: var(--success);
    }
    .status-pill[data-status="on_hold"], .status-chip[data-status="on_hold"] {
      background: color-mix(in oklab, var(--danger), transparent 80%); color: var(--danger);
    }

    /* Phase title separates the two chip rows. */
    .phase-title {
      margin: 0 0 4px; font-size: 12px;
      text-transform: uppercase; letter-spacing: 0.5px;
      color: var(--muted); font-weight: 600;
    }
    .no-notes { margin: 0 0 8px; }

    /* Qualified / pending-qualification marker in the Onboarding
       tab head. Green when row has moved into the work phase,
       muted/warning otherwise. */
    .qual-badge {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 3px 12px; border-radius: 999px;
      font-size: 11px; font-weight: 600; letter-spacing: 0.3px;
      background: var(--bg-2); color: var(--muted);
    }
    .qual-badge[data-mode="new"] {
      background: color-mix(in oklab, var(--muted), transparent 78%);
      color: var(--muted);
    }
    .qual-badge[data-mode="progress"] {
      background: color-mix(in oklab, #8aa9ff, transparent 78%);
      color: #8aa9ff;
    }
    .qual-badge[data-mode="pending"] {
      background: color-mix(in oklab, var(--warning), transparent 78%);
      color: var(--warning);
    }
    .qual-badge[data-mode="qualified"] {
      background: color-mix(in oklab, var(--success), transparent 78%);
      color: var(--success);
    }

    .status-grid { display: flex; flex-wrap: wrap; gap: 8px; }
    .status-chip {
      cursor: pointer; padding: 6px 14px; font-size: 13px;
      transition: transform 0.1s, border-color 0.15s;
    }
    .status-chip:hover:not(:disabled) {
      transform: translateY(-1px); border-color: currentColor;
    }
    .status-chip.selected { border-color: currentColor; }
    .status-chip:disabled { opacity: 0.5; cursor: not-allowed; }

    .sc-badge {
      display: inline-block;
      padding: 1px 8px; border-radius: 999px;
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.4px;
      background: var(--bg-2); color: var(--muted);
    }
    .sc-badge.onboarding {
      background: rgba(212, 169, 58, 0.15); color: var(--primary);
    }

    .note { margin-top: 16px; }
  `],
})
export class ServiceClientDetail {
  private api    = inject(Api);
  private route  = inject(ActivatedRoute);
  private router = inject(Router);

  client  = signal<ServiceClientDetailModel | null>(null);
  service = signal<ServiceOffering | null>(null);
  loading = signal(false);
  error   = signal<string | null>(null);

  activeTab = signal<TabKey>('status');
  readonly tabs: { key: TabKey; label: string }[] = [
    { key: 'status',     label: 'Status' },
    { key: 'onboarding', label: 'Onboarding' },
    { key: 'tasks',      label: 'Tasks' },
    { key: 'invoices',   label: 'Invoices' },
    { key: 'contracts',  label: 'Contracts' },
  ];

  // ── Invoices tab state ───────────────────────────────────────────
  // Loaded once (lazy on first tab click), filtered by service_link_id
  // when the row came from the catalogue attach path, or by client_id
  // otherwise (onboarding-only clients don't map to a CSO row yet).
  invoicesLoading = signal(false);
  invoices = signal<Invoice[]>([]);
  private invoicesLoadedFor: string | null = null;

  /** For catalogue rows the fetch is already narrowed by service_link_id
   *  so no client-side filter is needed. For onboarding rows we ask for
   *  the whole client's invoice list and show everything (the user is
   *  looking at *this client's* work on the service either way). */
  invoicesForLink(): Invoice[] { return this.invoices(); }

  onTabClick(key: TabKey) {
    this.activeTab.set(key);
    if (key === 'invoices') this.loadInvoicesForCurrentClient();
  }

  /** Synthetic single-item services list for the entity-contracts
   *  attach picker. We're already viewing THIS specific service, so
   *  offering the whole catalogue would be noise — one option is
   *  enough and the modal auto-selects it. */
  clientCatalogServices(): any[] {
    const c = this.client();
    if (!c?.link_id || c.source !== 'catalogue') return [];
    return [{
      kind: 'catalog',
      service_link_id: Number(c.link_id),
      name: c.form_title || 'Service',
      form_title: c.form_title || null,
    }];
  }

  /** Passed as `defaultServiceLinkId` to <app-entity-contracts> so the
   *  attach modal opens with this service already ticked. Null when
   *  the row came in via the onboarding-only path (no CSO row yet). */
  defaultServiceLinkIdForAttach(): number | null {
    const c = this.client();
    if (c?.source === 'catalogue' && c.link_id != null) return Number(c.link_id);
    return null;
  }

  // Drives the shared <app-invoice-detail-modal>. Setting to a number
  // opens the modal; the modal's (closed) handler clears it back to
  // null and triggers a reload so status / paid changes reflect.
  activeInvoiceId = signal<number | null>(null);
  openInvoice(id: number) { this.activeInvoiceId.set(id); }
  onInvoiceClosed() {
    this.activeInvoiceId.set(null);
    // Force a re-fetch so any status / paid edits show on the list.
    this.invoicesLoadedFor = null;
    this.loadInvoicesForCurrentClient();
  }

  invoiceStatusLabel(st?: InvoiceStatus | string | null): string {
    switch (st) {
      case 'draft':     return 'Draft';
      case 'sent':      return 'Not paid';
      case 'part_paid': return 'Part paid';
      case 'paid':      return 'Paid';
      case 'void':      return 'Void';
      default:          return String(st ?? '');
    }
  }

  /** Match the money formatting used elsewhere in this component. Some
   *  callers (line_total etc.) come back as strings from PHP/PDO. */
  formatMoney(v: number | string | null | undefined): string {
    if (v === null || v === undefined || v === '') return '£0.00';
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) return '£0.00';
    return '£' + n.toFixed(2);
  }

  private loadInvoicesForCurrentClient() {
    const c = this.client();
    if (!c) return;
    // Cache-bust key: link_id if catalogue-source, else client_id.
    const key = c.source === 'catalogue' && c.link_id != null
      ? `link:${c.link_id}`
      : c.client_id != null ? `client:${c.client_id}` : null;
    if (!key || key === this.invoicesLoadedFor) return;
    this.invoicesLoadedFor = key;

    this.invoicesLoading.set(true);
    const filter = c.source === 'catalogue' && c.link_id != null
      ? { serviceLinkId: Number(c.link_id) }
      : c.client_id != null ? { clientId: Number(c.client_id) } : {};
    this.api.listInvoices(filter).subscribe({
      next: r => { this.invoices.set(r.invoices || []); this.invoicesLoading.set(false); },
      error: () => { this.invoices.set([]); this.invoicesLoading.set(false); },
    });
  }

  /** Two phases of the 8-state workflow, rendered as separate chip
   *  rows so the funnel reads top-down. Clicking through the
   *  onboarding-phase chips auto-creates the matching CRM task
   *  (see services.php). `qualified` is special — server-side it
   *  immediately bumps to `to_do` so the user sees the work phase
   *  light up in the same write. */
  readonly onboardingPhase: ServiceClientStatus[] =
    ['new','onboarding','submitted','qualified'];
  readonly workPhase: ServiceClientStatus[] =
    ['to_do','in_progress','done','on_hold'];

  /** True iff this row has progressed past the onboarding phase
   *  (already in the work phase). Drives the Qualified pill on the
   *  qualification row + the "Approved" fallback when there's no
   *  qualified_at timestamp. */
  isQualified(c: ServiceClientDetailModel | null): boolean {
    if (!c) return false;
    return ['to_do','in_progress','done','on_hold'].includes(c.status);
  }

  /** Granular badge state — `new` shouldn't show "Pending
   *  qualification" because nothing's been sent or submitted yet.
   *  Returns {label, mode} where mode drives the colour scheme. */
  qualificationBadge(c: ServiceClientDetailModel | null): { label: string; mode: 'new' | 'progress' | 'pending' | 'qualified' } | null {
    if (!c) return null;
    switch (c.status) {
      case 'new':        return { label: '◇ Not started',           mode: 'new' };
      case 'onboarding': return { label: '⌛ Onboarding in progress', mode: 'progress' };
      case 'submitted':  return { label: '⏳ Pending qualification',  mode: 'pending' };
      case 'qualified':
      case 'to_do':
      case 'in_progress':
      case 'done':
      case 'on_hold':    return { label: '✓ Qualified',              mode: 'qualified' };
    }
    return null;
  }

  /** The onboarding form (if any) linked to this service via
   *  forms.service_offering_id. Fetched on init so the Onboarding
   *  tab can show "Open onboarding →" even for catalogue-attached
   *  rows — the form belongs to the SERVICE, not the row. */
  linkedForm = signal<{ id: number; slug: string; title: string } | null>(null);

  statusBusy = signal(false);
  statusErr  = signal<string | null>(null);
  statusMsg  = signal<string | null>(null);

  /** The `c.project_status` value isn't a member of our unified enum
   *  (it's the task_projects enum). Map it to the closest unified
   *  state so the pill colour-codes consistently. */
  /** Map the task_projects.status enum (new/ongoing/testing/blocked/
   *  complete) onto our 8-state unified workflow so the Tasks tab
   *  pill picks up the right colour. */
  mappedProjectStatus = computed<ServiceClientStatus>(() => {
    const ps = this.client()?.project_status;
    if (ps === 'complete') return 'done';
    if (ps === 'new')      return 'to_do';
    if (ps === 'ongoing' || ps === 'testing' || ps === 'blocked') return 'in_progress';
    return 'new';
  });

  statusLabel(s: ServiceClientStatus): string {
    // Snake_case → title case ("in_progress" → "In Progress").
    return s.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  private sid = 0;
  private key = '';

  ngOnInit() {
    this.route.paramMap.subscribe(p => {
      const sid = Number(p.get('sid'));
      const key = p.get('key') || '';
      if (!sid || !key) { this.error.set('Invalid URL'); return; }
      this.sid = sid;
      this.key = key;
      this.fetch();
    });
  }

  private fetch() {
    this.loading.set(true);
    this.error.set(null);
    this.linkedForm.set(null);
    this.api.getServiceClientDetail(this.sid, this.key).subscribe({
      next: r => {
        this.loading.set(false);
        this.client.set(r.client);
        this.service.set(r.service);
        // Also pull the service's linked onboarding form (if any)
        // so the Onboarding tab can offer a deep link even when the
        // client came in via the catalogue-attach path.
        this.api.getServiceOnboardingForm(this.sid).subscribe({
          next: f => this.linkedForm.set(f.form ?? null),
          error: () => this.linkedForm.set(null),
        });
      },
      error: e => {
        this.loading.set(false);
        this.error.set(e?.error?.error || 'Client not found on this service.');
      },
    });
  }

  changeStatus(next: ServiceClientStatus) {
    const c = this.client();
    if (!c || c.source !== 'catalogue' || !c.link_id) return;
    if (c.status === next) return;

    this.statusBusy.set(true);
    this.statusErr.set(null);
    this.statusMsg.set(null);
    this.api.updateServiceClientStatus(this.sid, Number(c.link_id), next).subscribe({
      next: () => {
        this.statusBusy.set(false);
        this.client.set({ ...c, status: next });
        this.statusMsg.set(`Status changed to ${this.statusLabel(next)}.`);
      },
      error: e => {
        this.statusBusy.set(false);
        this.statusErr.set(e?.error?.error || 'Could not update status.');
      },
    });
  }

  back() {
    this.router.navigate(['/admin/services'], {
      queryParams: { service: this.sid },
    });
  }
}
