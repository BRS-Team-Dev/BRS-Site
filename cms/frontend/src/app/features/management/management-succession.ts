import { Component, computed, inject, signal } from '@angular/core';
import { Api } from '../../core/api';
import { HrSuccessionPlan } from '../../core/models';

@Component({
  selector: 'app-management-succession',
  template: `
    <div class="toolbar">
      <h1>Succession</h1>
      <span class="spacer"></span>
      <span class="muted small">{{ plans().length }} plan{{ plans().length === 1 ? '' : 's' }} touch your team</span>
    </div>

    @if (plans().length === 0) {
      <div class="empty">
        <p class="muted">No succession plans involve anyone on your team yet.</p>
        <p class="muted small">Plans appear here when one of your direct reports is the current holder of a key role, or has been listed as a successor.</p>
      </div>
    } @else {
      <div class="plan-list">
        @for (p of plans(); track p.id) {
          <div class="plan-card" [class.risk-high]="p.risk_level === 'high'" [class.risk-medium]="p.risk_level === 'medium'">
            <div class="plan-head">
              <div>
                <strong>{{ p.key_role }}</strong>
                <div class="muted small">
                  Held by
                  @if (p.holder_first || p.holder_last) {
                    {{ p.holder_first }} {{ p.holder_last }}
                  } @else {
                    <em>vacant</em>
                  }
                </div>
              </div>
              <span class="risk risk-{{ p.risk_level }}">{{ p.risk_level }} risk</span>
            </div>

            <div class="cand-list">
              @for (c of p.candidates || []; track c.id) {
                <div class="cand-row">
                  <strong>{{ c.first_name }} {{ c.last_name }}</strong>
                  <span class="muted small">{{ c.position || '—' }}</span>
                  <span class="readiness ready-{{ c.readiness }}">{{ readinessLabel(c.readiness) }}</span>
                </div>
              }
              @if ((p.candidates || []).length === 0) {
                <p class="muted small">No successors identified yet.</p>
              }
            </div>

            @if (p.notes) { <p class="muted small notes">{{ p.notes }}</p> }
          </div>
        }
      </div>
    }
  `,
  styles: [`
    .toolbar { padding: 16px 20px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--line); }
    .toolbar h1 { margin: 0; font-size: 22px; }
    .spacer { flex: 1; }
    .empty { padding: 48px 20px; text-align: center; }
    .plan-list { padding: 16px 20px; display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
    .plan-card {
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius);
      padding: 14px; display: flex; flex-direction: column; gap: 10px;
    }
    .plan-card.risk-medium { border-left: 3px solid #f97316; }
    .plan-card.risk-high   { border-left: 3px solid #ef4444; }
    .plan-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
    .risk {
      padding: 2px 8px; border-radius: 999px; font-size: 10px;
      text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      border: 1px solid var(--line); white-space: nowrap;
    }
    .risk-low    { color: var(--primary); border-color: var(--primary); }
    .risk-medium { color: #f97316; border-color: #f97316; }
    .risk-high   { color: #ef4444; border-color: #ef4444; }

    .cand-list { display: flex; flex-direction: column; gap: 4px; }
    .cand-row {
      display: flex; align-items: center; gap: 10px;
      padding: 6px 8px; background: var(--bg-3); border: 1px solid var(--line);
      border-radius: var(--radius-sm);
    }
    .cand-row.mine { border-color: var(--primary); }
    .cand-row strong { flex: 0 0 auto; }
    .cand-row .muted { flex: 1; }
    .readiness {
      padding: 1px 6px; border-radius: 4px; font-size: 10px;
      text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      border: 1px solid var(--line);
    }
    .ready-now  { color: var(--primary); border-color: var(--primary); background: rgba(212,169,58,0.12); }
    .ready-1-2y { color: #60a5fa; border-color: #60a5fa; }
    .ready-3-5y { color: var(--muted); }
    .notes { white-space: pre-wrap; padding-top: 6px; border-top: 1px solid var(--line); margin: 0; }
  `],
})
export class ManagementSuccession {
  private api = inject(Api);
  plans = signal<HrSuccessionPlan[]>([]);

  ngOnInit() { this.api.listMyTeamSuccession().subscribe(r => this.plans.set(r.plans)); }

  readinessLabel(r?: string) { return r === 'now' ? 'Ready now' : r === '1-2y' ? '1–2 yrs' : r === '3-5y' ? '3–5 yrs' : 'TBD'; }
}
