import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Api } from '../../core/api';

interface HrOverview {
  headcount: number;
  turnover_pct_12mo: number;
  terminated_12mo: number;
  pending_time_off: number;
  expiring_certs: number;
  pending_change: number;
  overdue_compliance: number;
  open_surveys: number;
  by_status: { status: string; n: number }[];
  by_type:   { employment_type: string; n: number }[];
  by_department: { department: string; n: number }[];
  tenure: { lt1: number; y1_3: number; y3_5: number; y5_plus: number };
}

@Component({
  selector: 'app-hr-dashboard',
  imports: [RouterLink],
  template: `
    <div class="toolbar">
      <h1>HR · Dashboard</h1>
    </div>

    @if (overview(); as o) {
      <div class="grid">
        <a class="metric" routerLink="/hr/employees"><span class="m-label">Active headcount</span><span class="m-val">{{ o.headcount }}</span></a>
        <div class="metric"><span class="m-label">Turnover (12mo)</span><span class="m-val">{{ o.turnover_pct_12mo }}%</span><span class="muted small">{{ o.terminated_12mo }} left</span></div>
        <a class="metric" routerLink="/hr/time-off"><span class="m-label">Pending time-off</span><span class="m-val" [class.warn]="o.pending_time_off > 0">{{ o.pending_time_off }}</span></a>
        <a class="metric" routerLink="/hr/change-requests"><span class="m-label">Pending change requests</span><span class="m-val" [class.warn]="o.pending_change > 0">{{ o.pending_change }}</span></a>
        <a class="metric" routerLink="/hr/compliance"><span class="m-label">Overdue compliance</span><span class="m-val" [class.danger]="o.overdue_compliance > 0">{{ o.overdue_compliance }}</span></a>
        <div class="metric"><span class="m-label">Certs expiring ≤ 60d</span><span class="m-val" [class.warn]="o.expiring_certs > 0">{{ o.expiring_certs }}</span></div>
        <a class="metric" routerLink="/hr/engagement"><span class="m-label">Open pulse surveys</span><span class="m-val">{{ o.open_surveys }}</span></a>
      </div>

      <div class="charts">
        <section class="chart-card">
          <h3>By department</h3>
          @if (o.by_department.length === 0) {
            <p class="muted small">No employees yet.</p>
          } @else {
            <div class="bar-list">
              @for (d of o.by_department; track d.department) {
                <div class="bar-row">
                  <span class="bar-label">{{ d.department }}</span>
                  <div class="bar-track"><div class="bar-fill" [style.width.%]="pct(d.n, maxBy(o.by_department))"></div></div>
                  <span class="bar-count">{{ d.n }}</span>
                </div>
              }
            </div>
          }
        </section>

        <section class="chart-card">
          <h3>By employment type</h3>
          @if (o.by_type.length === 0) {
            <p class="muted small">No employees yet.</p>
          } @else {
            <div class="bar-list">
              @for (t of o.by_type; track t.employment_type) {
                <div class="bar-row">
                  <span class="bar-label">{{ t.employment_type.replace('_', ' ') }}</span>
                  <div class="bar-track"><div class="bar-fill" [style.width.%]="pct(t.n, maxByType(o.by_type))"></div></div>
                  <span class="bar-count">{{ t.n }}</span>
                </div>
              }
            </div>
          }
        </section>

        <section class="chart-card">
          <h3>Tenure</h3>
          <div class="bar-list">
            <div class="bar-row"><span class="bar-label">&lt; 1 year</span><div class="bar-track"><div class="bar-fill" [style.width.%]="pct(o.tenure.lt1, maxTenure(o.tenure))"></div></div><span class="bar-count">{{ o.tenure.lt1 }}</span></div>
            <div class="bar-row"><span class="bar-label">1-3 years</span><div class="bar-track"><div class="bar-fill" [style.width.%]="pct(o.tenure.y1_3, maxTenure(o.tenure))"></div></div><span class="bar-count">{{ o.tenure.y1_3 }}</span></div>
            <div class="bar-row"><span class="bar-label">3-5 years</span><div class="bar-track"><div class="bar-fill" [style.width.%]="pct(o.tenure.y3_5, maxTenure(o.tenure))"></div></div><span class="bar-count">{{ o.tenure.y3_5 }}</span></div>
            <div class="bar-row"><span class="bar-label">5+ years</span><div class="bar-track"><div class="bar-fill" [style.width.%]="pct(o.tenure.y5_plus, maxTenure(o.tenure))"></div></div><span class="bar-count">{{ o.tenure.y5_plus }}</span></div>
          </div>
        </section>
      </div>
    } @else {
      <p class="muted small" style="padding: 24px;">Loading…</p>
    }
  `,
  styles: [`
    .toolbar { padding: 16px 20px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--line); }
    .toolbar h1 { margin: 0; font-size: 22px; }

    .grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 14px;
      padding: 16px 20px;
    }
    .metric {
      display: flex; flex-direction: column; gap: 4px;
      padding: 18px;
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius);
      color: var(--fg); text-decoration: none;
      transition: border-color 0.15s;
    }
    a.metric, a.metric:visited, a.metric * { text-decoration: none; color: inherit; }
    a.metric:hover { border-color: var(--primary); cursor: pointer; }
    .m-label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
    .m-val   { font-size: 26px; font-weight: 700; color: var(--primary); }
    .m-val.warn   { color: var(--primary); }
    .m-val.danger { color: #ef4444; }

    .charts {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 14px; padding: 0 20px 20px;
    }
    .chart-card {
      padding: 16px;
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius);
    }
    .chart-card h3 { font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 12px; }
    .bar-list { display: flex; flex-direction: column; gap: 6px; }
    .bar-row { display: flex; align-items: center; gap: 12px; }
    .bar-label { min-width: 140px; font-size: 13px; }
    .bar-track { flex: 1; height: 14px; background: var(--bg-3); border-radius: 999px; overflow: hidden; border: 1px solid var(--line); }
    .bar-fill { height: 100%; background: var(--primary); transition: width 0.3s ease; }
    .bar-count { min-width: 40px; text-align: right; font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
  `],
})
export class HrDashboard {
  private api = inject(Api);
  overview = signal<HrOverview | null>(null);

  ngOnInit() {
    this.api.getHrReportsOverview().subscribe(o => this.overview.set(o));
  }

  pct(n: number, total: number): number {
    return total > 0 ? Math.round((n / total) * 100) : 0;
  }
  maxBy(rows: { n: number }[]): number {
    return rows.reduce((m, r) => Math.max(m, r.n), 1);
  }
  maxByType(rows: { n: number }[]): number { return this.maxBy(rows); }
  maxTenure(t: { lt1: number; y1_3: number; y3_5: number; y5_plus: number }): number {
    return Math.max(t.lt1, t.y1_3, t.y3_5, t.y5_plus, 1);
  }
}
