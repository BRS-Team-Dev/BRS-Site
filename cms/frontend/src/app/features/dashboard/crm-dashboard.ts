import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import { CrmDashboardOverview } from '../../core/models';

/**
 * CRM dashboard at `/admin/dashboard`. Single-fetch one-shot view —
 * `api.getCrmDashboard()` returns every panel's data in one payload.
 *
 * Layout: KPI tiles → status breakdowns (leads + services) → recent
 * activity columns. Uses global `.toolbar`, `.layout`, `.card`,
 * `table.data` per project conventions; only `.kpi-grid`, `.kpi-card`,
 * `.bar-row`, `.activity-grid`, `.dot` are introduced locally.
 */
@Component({
  selector: 'app-crm-dashboard',
  imports: [RouterLink],
  template: `
    <div class="toolbar">
      <h1>Dashboard</h1>
      <span class="spacer"></span>
      <span class="muted small">CRM overview</span>
    </div>

    @if (data(); as d) {
      <div class="layout">
        <!-- ── KPI tiles ─────────────────────────────────────────── -->
        <div class="kpi-grid">
          <a class="kpi-card" routerLink="/admin/clients">
            <div class="kpi-label">Clients</div>
            <div class="kpi-value">{{ d.totals.clients }}</div>
          </a>
          <a class="kpi-card" routerLink="/admin/leads">
            <div class="kpi-label">Active leads</div>
            <div class="kpi-value">{{ activeLeads(d) }}</div>
            <div class="kpi-sub">
              {{ d.totals.leads_promoted }} promoted · {{ d.totals.leads }} all-time
            </div>
          </a>
          <a class="kpi-card" routerLink="/admin/services">
            <div class="kpi-label">Active services</div>
            <div class="kpi-value">{{ d.totals.services_active }}</div>
            @if (d.totals.services_ended > 0) {
              <div class="kpi-sub">{{ d.totals.services_ended }} ended</div>
            }
          </a>
          <div class="kpi-card">
            <div class="kpi-label">Monthly recurring</div>
            <div class="kpi-value">{{ formatMoney(d.totals.mrr) }}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Total contract value</div>
            <div class="kpi-value">
              {{ formatMoney(d.totals.total_contract_value) }}
              @if (d.totals.has_indefinite) { <span class="kpi-sub-inline"> + ongoing</span> }
            </div>
          </div>
          <a class="kpi-card" routerLink="/admin/forms">
            <div class="kpi-label">Forms</div>
            <div class="kpi-value">{{ d.totals.forms }}</div>
          </a>
          <a class="kpi-card" routerLink="/admin/onboarding">
            <div class="kpi-label">Onboarding</div>
            <div class="kpi-value">{{ d.totals.onboarding_templates }}</div>
          </a>
        </div>

        <!-- ── Status breakdowns ────────────────────────────────── -->
        <div class="breakdown-grid">
          <section class="card">
            <h2>Leads pipeline</h2>
            @if (totalLeads(d) === 0) {
              <p class="muted">No leads yet.</p>
            } @else {
              @for (s of leadStatusOrder; track s) {
                <div class="bar-row">
                  <span class="dot" [attr.data-lead-status]="s"></span>
                  <span class="label">{{ leadStatusLabel(s) }}</span>
                  <div class="bar-track">
                    <div class="bar-fill"
                         [style.width.%]="pct(d.leads_by_status[s], totalLeads(d))"
                         [attr.data-lead-status]="s"></div>
                  </div>
                  <span class="count">{{ d.leads_by_status[s] }}</span>
                </div>
              }
            }
          </section>

          <section class="card">
            <h2>Services by project status</h2>
            @if (totalServices(d) === 0) {
              <p class="muted">No qualified services yet.</p>
            } @else {
              @for (s of serviceStatusOrder; track s) {
                <div class="bar-row">
                  <span class="dot" [attr.data-pstatus]="s"></span>
                  <span class="label">{{ serviceStatusLabel(s) }}</span>
                  <div class="bar-track">
                    <div class="bar-fill"
                         [style.width.%]="pct(d.services_by_status[s], totalServices(d))"
                         [attr.data-pstatus]="s"></div>
                  </div>
                  <span class="count">{{ d.services_by_status[s] }}</span>
                </div>
              }
            }
          </section>
        </div>

        <!-- ── Recent activity ──────────────────────────────────── -->
        <div class="activity-grid">
          <section class="card">
            <h2>Recent clients</h2>
            @if (d.recent_clients.length === 0) {
              <p class="muted">No clients yet.</p>
            } @else {
              <ul class="activity-list">
                @for (c of d.recent_clients; track c.id) {
                  <li>
                    <a [routerLink]="['/admin/clients', c.id]">
                      <strong>{{ c.name }}</strong>
                      @if (c.company) { <span class="muted small"> · {{ c.company }}</span> }
                    </a>
                    <span class="when">{{ formatDate(c.created_at) }}</span>
                  </li>
                }
              </ul>
            }
          </section>

          <section class="card">
            <h2>Recent leads</h2>
            @if (d.recent_leads.length === 0) {
              <p class="muted">No leads yet.</p>
            } @else {
              <ul class="activity-list">
                @for (l of d.recent_leads; track l.id) {
                  <li>
                    <a [routerLink]="['/admin/leads', l.id]">
                      <strong>{{ l.name }}</strong>
                      @if (l.company) { <span class="muted small"> · {{ l.company }}</span> }
                    </a>
                    <span class="status-pill" [attr.data-lead-status]="l.status">
                      {{ leadStatusLabel(l.status) }}
                    </span>
                  </li>
                }
              </ul>
            }
          </section>

          <section class="card">
            <h2>Recent qualifications</h2>
            @if (d.recent_qualifications.length === 0) {
              <p class="muted">No services qualified yet.</p>
            } @else {
              <ul class="activity-list">
                @for (q of d.recent_qualifications; track q.onboarding_client_id) {
                  <li>
                    <strong>{{ q.client_name || q.client_email }}</strong>
                    <span class="muted small"> · {{ q.form_title }}</span>
                    <span class="when">{{ formatDate(q.qualified_at) }}</span>
                  </li>
                }
              </ul>
            }
          </section>
        </div>
      </div>
    } @else {
      <div class="layout"><p class="muted">Loading dashboard…</p></div>
    }
  `,
  styles: [`
    /* KPI tiles — auto-fill grid so 6 tiles wrap cleanly on narrower viewports. */
    .kpi-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 12px;
    }
    .kpi-card {
      display: block;
      background: var(--bg-3); border: 1px solid var(--line);
      border-radius: var(--radius); padding: 16px 18px;
      color: var(--fg); text-decoration: none;
      transition: border-color 0.15s, transform 0.15s;
    }
    a.kpi-card:hover { border-color: var(--primary); transform: translateY(-1px); }
    .kpi-label {
      color: var(--muted); font-size: 11px;
      text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;
    }
    .kpi-value { font-size: 24px; font-weight: 700; line-height: 1.1; }
    .kpi-sub { color: var(--muted); font-size: 11px; margin-top: 6px; }
    .kpi-sub-inline { color: var(--muted); font-size: 12px; font-weight: 400; }

    /* Breakdown cards row — equal columns, equal height (grid stretches by default).
       Standalone class instead of .layout-2col because that's the 380px + 1fr
       info/detail split, which is wrong for two equally-weighted breakdown cards. */
    .breakdown-grid {
      display: grid; grid-template-columns: 1fr 1fr;
      gap: 12px; margin-top: 16px;
    }
    @media (max-width: 900px) { .breakdown-grid { grid-template-columns: 1fr; } }

    /* Card title style — matches the project convention. */
    .card h2 {
      font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;
      color: var(--muted); margin: 0 0 16px 0; font-weight: 600;
    }

    /* Status breakdown rows — small dot + label + horizontal bar + count. */
    .bar-row {
      display: grid; grid-template-columns: 12px 110px 1fr 32px;
      align-items: center; gap: 10px; padding: 6px 0;
    }
    .bar-row .label { font-size: 13px; }
    .bar-row .count { text-align: right; font-weight: 600; font-size: 13px; }
    .bar-track {
      height: 8px; background: var(--bg-2); border-radius: 999px; overflow: hidden;
    }
    .bar-fill { height: 100%; background: var(--muted); transition: width 0.2s; }
    .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--muted); }

    /* Lead status colors — mirror clients-admin / leads-admin status pills. */
    .dot[data-lead-status="new"],       .bar-fill[data-lead-status="new"]       { background: var(--primary); }
    .dot[data-lead-status="contacted"], .bar-fill[data-lead-status="contacted"] { background: #60a5fa; }
    .dot[data-lead-status="qualified"], .bar-fill[data-lead-status="qualified"] { background: var(--primary); }
    .dot[data-lead-status="converted"], .bar-fill[data-lead-status="converted"] { background: #56c98a; }
    .dot[data-lead-status="rejected"],  .bar-fill[data-lead-status="rejected"]  { background: var(--danger); }

    /* Project status colors — mirror the badges on the client services tab. */
    .dot[data-pstatus="new"],      .bar-fill[data-pstatus="new"]      { background: var(--primary); }
    .dot[data-pstatus="ongoing"],  .bar-fill[data-pstatus="ongoing"]  { background: #56c98a; }
    .dot[data-pstatus="testing"],  .bar-fill[data-pstatus="testing"]  { background: #60a5fa; }
    .dot[data-pstatus="blocked"],  .bar-fill[data-pstatus="blocked"]  { background: var(--danger); }
    .dot[data-pstatus="complete"], .bar-fill[data-pstatus="complete"] { background: var(--muted); }
    .dot[data-pstatus="none"],     .bar-fill[data-pstatus="none"]     { background: var(--line); }

    /* Inline status pill in the recent-leads list. */
    .status-pill {
      display: inline-block; padding: 2px 8px; border-radius: 999px;
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.4px;
      border: 1px solid var(--line); color: var(--muted);
      margin-left: 8px;
    }
    .status-pill[data-lead-status="new"]       { color: var(--primary); border-color: var(--primary); }
    .status-pill[data-lead-status="contacted"] { color: #60a5fa; border-color: #60a5fa; }
    .status-pill[data-lead-status="qualified"] { color: var(--primary); border-color: var(--primary); background: rgba(212,169,58,0.10); }
    .status-pill[data-lead-status="converted"] { color: #56c98a; border-color: #56c98a; background: rgba(86,201,138,0.10); }
    .status-pill[data-lead-status="rejected"]  { color: var(--danger); border-color: var(--danger); }

    /* Recent activity columns. */
    .activity-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 12px; margin-top: 16px;
    }
    .activity-list {
      list-style: none; margin: 0; padding: 0;
      display: flex; flex-direction: column; gap: 8px;
    }
    .activity-list li {
      display: flex; align-items: center; gap: 6px;
      padding: 6px 0; border-bottom: 1px solid var(--line);
    }
    .activity-list li:last-child { border-bottom: none; }
    .activity-list a { color: var(--fg); text-decoration: none; flex: 1; min-width: 0; }
    .activity-list a:hover { color: var(--primary); }
    .activity-list .when {
      color: var(--muted); font-size: 11px; white-space: nowrap; margin-left: auto;
    }
  `],
})
export class CrmDashboard {
  private api = inject(Api);
  data = signal<CrmDashboardOverview | null>(null);

  readonly leadStatusOrder = ['new','prospect','dead','converted'] as const;
  readonly serviceStatusOrder = ['new','ongoing','testing','blocked','complete','none'] as const;

  ngOnInit() {
    this.api.getCrmDashboard().subscribe({
      next: r => this.data.set(r),
      error: () => this.data.set(null),
    });
  }

  pct(n: number, total: number): number {
    if (!total) return 0;
    return Math.round((n / total) * 100);
  }
  totalLeads(d: CrmDashboardOverview): number {
    return Object.values(d.leads_by_status).reduce((a, b) => a + b, 0);
  }
  totalServices(d: CrmDashboardOverview): number {
    return Object.values(d.services_by_status).reduce((a, b) => a + b, 0);
  }
  /** Active leads = still in the pipeline (not converted, not dead). */
  activeLeads(d: CrmDashboardOverview): number {
    const s = d.leads_by_status;
    return (s.new ?? 0) + (s.prospect ?? 0);
  }

  leadStatusLabel(s: string | null | undefined): string {
    switch (s) {
      case 'new':       return 'New';
      case 'prospect':  return 'Prospect';
      case 'dead':      return 'Dead';
      case 'converted': return 'Converted';
      default:          return s || '—';
    }
  }
  serviceStatusLabel(s: string): string {
    switch (s) {
      case 'new':      return 'New';
      case 'ongoing':  return 'Ongoing';
      case 'testing':  return 'Testing';
      case 'blocked':  return 'Blocked';
      case 'complete': return 'Complete';
      case 'none':     return 'No project';
      default:         return s;
    }
  }

  formatMoney(v: number | null | undefined): string {
    if (v == null) return '—';
    const n = Number(v);
    if (!isFinite(n)) return '—';
    return n.toLocaleString(undefined, { style: 'currency', currency: 'GBP' });
  }
  formatDate(v: string | null | undefined): string {
    if (!v) return '—';
    return v.length >= 10 ? v.slice(0, 10) : v;
  }
}
