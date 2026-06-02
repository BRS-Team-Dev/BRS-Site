import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api';

/**
 * Accounting landing page. Triage view summarising what's coming up so the
 * user lands somewhere useful when they switch into the system. The full
 * GL / Cash flow / Bank feed views land here later — see
 * docs/accounting-plan.txt for the phased rollout.
 */
@Component({
  selector: 'app-accounting-dashboard',
  imports: [RouterLink],
  template: `
    <div class="toolbar">
      <h1>Accounting</h1>
      <span class="spacer"></span>
    </div>

    <div class="page">
      <div class="grid">
        <a class="tile" routerLink="/accounting/invoices">
          <div class="tile-head">
            <span class="ico">🧾</span>
            <strong>Invoices</strong>
          </div>
          <p class="muted small">Bill clients for qualified onboarding services.</p>
        </a>
        <a class="tile" routerLink="/accounting/payroll">
          <div class="tile-head">
            <span class="ico">💵</span>
            <strong>Payroll</strong>
          </div>
          <p class="muted small">Run pay periods, view payslips, export.</p>
        </a>
        <div class="tile soon" aria-disabled="true">
          <div class="tile-head">
            <span class="ico">🏦</span>
            <strong>Bank feed</strong>
            <span class="pill">soon</span>
          </div>
          <p class="muted small">Sync transactions from Monzo / Open Banking.</p>
        </div>
        <div class="tile soon" aria-disabled="true">
          <div class="tile-head">
            <span class="ico">📊</span>
            <strong>Reports</strong>
            <span class="pill">soon</span>
          </div>
          <p class="muted small">P&amp;L, balance sheet, cash flow.</p>
        </div>
        <div class="tile soon" aria-disabled="true">
          <div class="tile-head">
            <span class="ico">⚖</span>
            <strong>VAT / HMRC</strong>
            <span class="pill">soon</span>
          </div>
          <p class="muted small">MTD-compliant VAT returns + Self Assessment.</p>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .toolbar { padding: 16px 20px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--line); }
    .toolbar h1 { margin: 0; font-size: 22px; }
    .spacer { flex: 1; }

    .page { padding: 20px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
    .tile {
      background: var(--bg-3); border: 1px solid var(--line); border-radius: var(--radius);
      padding: 16px 18px; display: flex; flex-direction: column; gap: 8px;
      color: var(--fg); text-decoration: none; cursor: pointer;
      transition: border-color 0.15s;
    }
    .tile:hover { border-color: var(--primary); }
    .tile.soon { cursor: default; opacity: 0.6; }
    .tile.soon:hover { border-color: var(--line); }
    .tile-head { display: flex; align-items: center; gap: 10px; }
    .tile-head strong { font-size: 14px; }
    .ico { font-size: 20px; line-height: 1; }
    .pill {
      margin-left: auto;
      padding: 1px 8px; border-radius: 999px;
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      border: 1px solid var(--line); color: var(--muted);
    }
    .tile p { margin: 0; }
  `],
})
export class AccountingDashboard {
  private api = inject(Api);
}
