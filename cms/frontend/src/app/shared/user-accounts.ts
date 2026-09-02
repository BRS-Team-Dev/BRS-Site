import { Component, computed, input, signal, effect, inject } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { Api } from '../core/api';

/**
 * "My accounts & commissions" — shared page for both /me and
 * /contractor/me. Reads from /hr/me/commissions or
 * /contractor/me/commissions depending on the [source] input.
 *
 * Layout:
 *   1. KPI grid   — YTD earned / paid / pending / active accounts
 *   2. Accounts   — list of clients the user is currently the active
 *                   assignee on, with their roles, since date, active
 *                   standing rule (if any), and per-account totals.
 *   3. Ledger     — flat table of every commission entry, most recent
 *                   first. Read-only from the portal; admins add /
 *                   edit / delete from the client detail Commissions
 *                   tab.
 */
@Component({
  selector: 'app-user-accounts',
  imports: [DatePipe, DecimalPipe],
  template: `
    <div class="hero">
      <h2>My accounts &amp; commissions</h2>
      <p class="muted small">Client accounts you're currently assigned to and every commission you've earned.</p>
    </div>

    @if (loading()) { <p class="muted small">Loading…</p> }

    @if (data(); as d) {
      <!-- KPI cards ────────────────────────────────────────────── -->
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-value">£{{ (d.totals?.earned_ytd || 0) | number:'1.2-2' }}</div>
          <div class="kpi-label">Earned this year</div>
          <div class="kpi-bar bar-earn"></div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value">£{{ (d.totals?.paid_total || 0) | number:'1.2-2' }}</div>
          <div class="kpi-label">Total paid</div>
          <div class="kpi-bar bar-paid"></div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value" [class.k-danger]="(d.totals?.pending_total || 0) > 0">£{{ (d.totals?.pending_total || 0) | number:'1.2-2' }}</div>
          <div class="kpi-label">Pending</div>
          <div class="kpi-bar bar-pending"></div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value">{{ (d.accounts || []).length }}</div>
          <div class="kpi-label">Active accounts</div>
          <div class="kpi-bar bar-total"></div>
        </div>
      </div>

      <!-- Accounts ──────────────────────────────────────────────── -->
      <div class="card">
        <div class="card-head">
          <h3>Client accounts</h3>
          <span class="muted small">{{ (d.accounts || []).length }} active</span>
        </div>
        @if (!d.accounts || d.accounts.length === 0) {
          <p class="muted small no-rows">You're not currently assigned to any client accounts.</p>
        } @else {
          <table class="data">
            <thead>
              <tr>
                <th>Client</th>
                <th>Roles</th>
                <th>Since</th>
                <th>Standing rule</th>
                <th class="num">Earned</th>
                <th class="num">Pending</th>
              </tr>
            </thead>
            <tbody>
              @for (a of d.accounts; track a.client_id) {
                <tr>
                  <td>
                    <strong>{{ a.client_name }}</strong>
                    @if (a.company) { <div class="muted small">{{ a.company }}</div> }
                  </td>
                  <td>
                    @for (r of splitRoles(a.roles); track r) {
                      <span class="role-pill" [attr.data-role]="r">{{ roleLabel(r) }}</span>
                    }
                  </td>
                  <td>{{ a.assigned_since | date:'mediumDate' }}</td>
                  <td>
                    @if (!a.rules || a.rules.length === 0) {
                      <span class="muted small">—</span>
                    } @else {
                      @for (rule of a.rules; track rule.id) {
                        <div class="rule-line">
                          @if (rule.rate_type === 'percentage') { <strong>{{ rule.rate }}%</strong> }
                          @else { <strong>£{{ rule.rate | number:'1.2-2' }}</strong> }
                          <span class="muted small">
                            of {{ rule.applies_to === 'all' ? 'all invoices' : rule.applies_to === 'recurring' ? 'recurring only' : 'one-off only' }}
                            · {{ rule.cadence.replace('_', ' ') }}
                          </span>
                        </div>
                      }
                    }
                  </td>
                  <td class="num"><strong>£{{ (a.totals?.earned || 0) | number:'1.2-2' }}</strong></td>
                  <td class="num" [class.pending]="(a.totals?.pending || 0) > 0">£{{ (a.totals?.pending || 0) | number:'1.2-2' }}</td>
                </tr>
              }
            </tbody>
          </table>
        }
      </div>

      <!-- Ledger ────────────────────────────────────────────────── -->
      <div class="card">
        <div class="card-head">
          <h3>Commission ledger</h3>
          <span class="muted small">{{ (d.ledger || []).length }} {{ (d.ledger || []).length === 1 ? 'entry' : 'entries' }}</span>
        </div>
        @if (!d.ledger || d.ledger.length === 0) {
          <p class="muted small no-rows">No commission entries yet.</p>
        } @else {
          <table class="data">
            <thead>
              <tr>
                <th>Earned</th>
                <th>Client</th>
                <th>Kind</th>
                <th>Description</th>
                <th>Status</th>
                <th>Paid</th>
                <th class="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              @for (l of d.ledger; track l.id) {
                <tr>
                  <td>{{ l.earned_on | date:'mediumDate' }}</td>
                  <td>{{ l.client_name || '—' }}</td>
                  <td><span class="kind-pill" [attr.data-kind]="l.kind">{{ l.kind }}</span></td>
                  <td>{{ l.description || '—' }}</td>
                  <td><span class="status-pill" [attr.data-status]="l.status">{{ l.status }}</span></td>
                  <td>@if (l.paid_on) { {{ l.paid_on | date:'mediumDate' }} } @else { <span class="muted">—</span> }</td>
                  <td class="num"><strong>£{{ l.amount | number:'1.2-2' }}</strong></td>
                </tr>
              }
            </tbody>
          </table>
        }
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .hero { margin-bottom: 16px; }
    .hero h2 { margin: 0 0 4px 0; font-size: 22px; color: var(--fg); text-transform: none; letter-spacing: 0; }

    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
    @media (max-width: 900px) { .kpi-grid { grid-template-columns: repeat(2, 1fr); } }
    @media (max-width: 500px) { .kpi-grid { grid-template-columns: 1fr; } }
    .kpi-card {
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
      padding: 14px 16px; display: flex; flex-direction: column; gap: 4px;
    }
    .kpi-value { font-size: 24px; font-weight: 700; color: var(--fg); font-variant-numeric: tabular-nums; }
    .kpi-value.k-danger { color: var(--warning); }
    .kpi-label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
    .kpi-bar { height: 3px; border-radius: 2px; margin-top: 6px; }
    .kpi-bar.bar-earn { background: var(--primary); }
    .kpi-bar.bar-paid { background: var(--success); }
    .kpi-bar.bar-pending { background: var(--warning); }
    .kpi-bar.bar-total { background: var(--muted); }

    .card {
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
      padding: 16px 18px; margin-bottom: 14px;
    }
    .card-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; }
    .card-head h3 { margin: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); font-weight: 600; }
    .card-head .muted.small { margin-left: auto; }
    .no-rows { margin: 8px 0; }

    .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .pending { color: var(--warning); font-weight: 700; }

    .role-pill {
      display: inline-block; padding: 2px 8px; margin: 1px 3px 1px 0;
      border-radius: 999px; font-size: 10.5px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.3px; border: 1px solid var(--line); color: var(--muted);
    }
    .role-pill[data-role="onboarding"]    { color: #f97316; border-color: #f97316; }
    .role-pill[data-role="services"]      { color: var(--primary); border-color: var(--primary); }
    .role-pill[data-role="service_tasks"] { color: #56CCF2; border-color: #56CCF2; }
    .role-pill[data-role="account_tasks"] { color: #BB6BD9; border-color: #BB6BD9; }

    .rule-line { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; }

    .kind-pill, .status-pill {
      display: inline-block; padding: 2px 10px; border-radius: 999px;
      font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px;
      border: 1px solid var(--line); color: var(--muted); white-space: nowrap;
    }
    .kind-pill[data-kind="accrual"]    { color: var(--primary);  border-color: var(--primary); }
    .kind-pill[data-kind="bonus"]      { color: #10b981;         border-color: #10b981; }
    .kind-pill[data-kind="adjustment"] { color: var(--warning);  border-color: var(--warning); }
    .kind-pill[data-kind="payout"]     { color: var(--success);  border-color: var(--success); }
    .status-pill[data-status="pending"]   { color: var(--warning);  border-color: var(--warning); }
    .status-pill[data-status="earned"]    { color: var(--primary);  border-color: var(--primary); }
    .status-pill[data-status="paid"]      { color: var(--success);  border-color: var(--success); }
    .status-pill[data-status="cancelled"] { color: var(--danger);   border-color: var(--danger); text-decoration: line-through; }
  `],
})
export class UserAccounts {
  private api = inject(Api);

  /** Which side of the app is asking — drives the endpoint choice. */
  source = input.required<'hr' | 'contractor'>();

  loading = signal(true);
  data = signal<any | null>(null);

  constructor() {
    effect(() => {
      const s = this.source();
      this.loading.set(true);
      const req = s === 'hr' ? this.api.getHrMeCommissions() : this.api.getContractorMeCommissions();
      req.subscribe({
        next: r => { this.data.set(r); this.loading.set(false); },
        error: () => { this.data.set({ accounts: [], rules: [], ledger: [], totals: {} }); this.loading.set(false); },
      });
    });
  }

  splitRoles(csv: string | null): string[] {
    if (!csv) return [];
    return csv.split(',').map(s => s.trim()).filter(Boolean);
  }
  roleLabel(r: string): string {
    switch (r) {
      case 'onboarding':    return 'Onboarding';
      case 'services':      return 'Services';
      case 'service_tasks': return 'Service tasks';
      case 'account_tasks': return 'Account tasks';
      default: return r;
    }
  }
}
