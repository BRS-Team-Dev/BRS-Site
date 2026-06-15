import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import { RecruitmentCandidate } from '../../core/models';

/**
 * /recruitment/dashboard — high-level recruitment overview. Just counts per
 * pipeline state for now; more KPIs as the data grows.
 */
@Component({
  selector: 'app-recruitment-dashboard',
  imports: [RouterLink],
  template: `
    <div class="toolbar">
      <h1>Recruitment</h1>
      <span class="spacer"></span>
      <button class="primary" routerLink="/recruitment/candidates/new">+ New candidate</button>
    </div>

    <p class="muted page-sub">Pipeline snapshot across every candidate.</p>

    <div class="kpi-grid">
      @for (k of kpis(); track k.key) {
        <a class="kpi" [routerLink]="['/recruitment/candidates']" [queryParams]="{ status: k.key }">
          <div class="kpi-num">{{ k.count }}</div>
          <div class="kpi-label">{{ k.label }}</div>
        </a>
      }
    </div>

    <div class="grid-2">
      <section class="card">
        <h3>Recent candidates</h3>
        @if (recent().length === 0) {
          <p class="muted">No candidates yet. <a routerLink="/recruitment/candidates/new">Add your first.</a></p>
        } @else {
          <ul class="recent">
            @for (c of recent(); track c.id) {
              <li>
                <a [routerLink]="['/recruitment/candidates', c.id]">
                  <strong>{{ c.first_name }} {{ c.last_name }}</strong>
                  <span class="muted small">{{ c.role || '—' }}</span>
                </a>
                <span class="status-pill" [attr.data-status]="c.status">{{ c.status }}</span>
              </li>
            }
          </ul>
        }
      </section>

      <section class="card">
        <h3>Quick links</h3>
        <ul class="links">
          <li><a routerLink="/recruitment/clients">🏢 Clients</a></li>
          <li><a routerLink="/recruitment/candidates">🎯 Candidates</a></li>
          <li><a routerLink="/recruitment/documentation">📁 Documentation</a></li>
          <li><a routerLink="/recruitment/settings">⚙ Settings</a></li>
        </ul>
      </section>
    </div>
  `,
  styles: [`
    .page-sub { margin: 0 24px 12px; }

    .kpi-grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 12px; padding: 0 24px 16px;
    }
    .kpi {
      display: block; background: var(--bg-2); border: 1px solid var(--line);
      border-radius: var(--radius-sm); padding: 16px;
      transition: border-color 0.15s, transform 0.15s;
    }
    .kpi:hover { border-color: var(--primary); transform: translateY(-1px); }
    .kpi-num { font-size: 28px; font-weight: 700; color: var(--primary); }
    .kpi-label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px; }

    .grid-2 { display: grid; grid-template-columns: 2fr 1fr; gap: 16px; padding: 0 24px 24px; }
    @media (max-width: 900px) { .grid-2 { grid-template-columns: 1fr; } }
    .card {
      background: var(--bg-2); border: 1px solid var(--line);
      border-radius: var(--radius-sm); padding: 16px;
    }
    .card h3 { margin: 0 0 12px; font-size: 14px; }
    .recent, .links { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .recent li { display: flex; align-items: center; gap: 12px; }
    .recent li a { flex: 1; display: flex; flex-direction: column; color: var(--fg); }
    .recent li a strong { font-size: 13px; }
    .links li a { color: var(--primary); font-size: 14px; }
    .links li a:hover { text-decoration: underline; }

    .status-pill {
      display: inline-block; padding: 2px 10px; border-radius: 999px;
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
      border: 1px solid var(--line); color: var(--muted);
    }
    .status-pill[data-status="interviewing"]     { color: #6db4ff; border-color: #4d8edb; background: rgba(77, 142, 219, 0.15); }
    .status-pill[data-status="processing"]       { color: var(--primary); border-color: var(--primary); background: rgba(255, 193, 7, 0.15); }
    .status-pill[data-status="compliant"]        { color: #7ed985; border-color: #4caf50; background: rgba(76, 175, 80, 0.15); }
    .status-pill[data-status="client_screening"] { color: #d6a3ff; border-color: #8e5dc4; background: rgba(142, 93, 196, 0.15); }
    .status-pill[data-status="placed"]           { color: #7ed985; border-color: #4caf50; background: rgba(76, 175, 80, 0.20); }
    .status-pill[data-status="rejected_by_us"] { color: #f08577; border-color: #d84d3e; background: rgba(244, 67, 54, 0.15); }
  `],
})
export class RecruitmentDashboard {
  private api = inject(Api);

  candidates = signal<RecruitmentCandidate[]>([]);

  kpis = computed(() => {
    const cs = this.candidates();
    const buckets: { key: string; label: string }[] = [
      { key: 'new',              label: 'New' },
      { key: 'interviewing',     label: 'Interviewing' },
      { key: 'processing',       label: 'Processing' },
      { key: 'compliant',        label: 'Compliant' },
      { key: 'client_screening', label: 'Client Screening' },
      { key: 'placed',           label: 'Placed' },
    ];
    return buckets.map(b => ({ ...b, count: cs.filter(c => c.status === b.key).length }));
  });
  recent = computed(() => this.candidates().slice(0, 8));

  constructor() {
    this.api.listRecruitmentCandidates().subscribe(r => this.candidates.set(r.candidates ?? []));
  }
}
