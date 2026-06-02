import { Component, computed, inject, signal } from '@angular/core';
import { Api } from '../../core/api';
import { HrCourseAssignment, HrEmployee, HrReview, HrTimeOffEntry } from '../../core/models';

@Component({
  selector: 'app-management-analytics',
  template: `
    <div class="toolbar">
      <h1>Team analytics</h1>
      <span class="spacer"></span>
      <span class="muted small">{{ team().length }} active direct report{{ team().length === 1 ? '' : 's' }}</span>
    </div>

    @if (team().length === 0) {
      <div class="empty"><p class="muted">No direct reports linked to your record yet.</p></div>
    } @else {
      <div class="summary">
        <div class="metric"><span class="m-label">Headcount</span><span class="m-val">{{ team().length }}</span></div>
        <div class="metric"><span class="m-label">Avg tenure</span><span class="m-val">{{ avgTenureMonths() }} mo</span></div>
        <div class="metric"><span class="m-label">On leave today</span><span class="m-val warn">{{ onLeaveToday() }}</span></div>
        <div class="metric"><span class="m-label">Reviews complete</span><span class="m-val ok">{{ reviewsCompletePct() }}%</span></div>
        <div class="metric"><span class="m-label">Learning completion</span><span class="m-val ok">{{ learningPct() }}%</span></div>
        <div class="metric"><span class="m-label">Overdue learning</span><span class="m-val danger">{{ overdueLearning() }}</span></div>
      </div>

      <h2 class="sec-title">Status mix</h2>
      <div class="bar-block">
        @for (s of statusMix(); track s.label) {
          <div class="bar-row">
            <span class="bar-label">{{ s.label }}</span>
            <div class="bar"><div class="bar-fill" [style.width.%]="s.pct" [style.background]="s.color"></div></div>
            <span class="muted small bar-val">{{ s.count }} ({{ s.pct }}%)</span>
          </div>
        }
      </div>

      <h2 class="sec-title">Department mix</h2>
      @if (departmentMix().length === 0) {
        <p class="muted small empty-line">No department data yet.</p>
      } @else {
        <div class="bar-block">
          @for (d of departmentMix(); track d.label) {
            <div class="bar-row">
              <span class="bar-label">{{ d.label }}</span>
              <div class="bar"><div class="bar-fill" [style.width.%]="d.pct"></div></div>
              <span class="muted small bar-val">{{ d.count }} ({{ d.pct }}%)</span>
            </div>
          }
        </div>
      }

      <h2 class="sec-title">Leave taken (last 12 months)</h2>
      @if (leaveByEmployee().length === 0) {
        <p class="muted small empty-line">No approved leave on record.</p>
      } @else {
        <div class="bar-block">
          @for (e of leaveByEmployee(); track e.label) {
            <div class="bar-row">
              <span class="bar-label">{{ e.label }}</span>
              <div class="bar"><div class="bar-fill" [style.width.%]="e.pct"></div></div>
              <span class="muted small bar-val">{{ e.days }} days</span>
            </div>
          }
        </div>
      }
    }
  `,
  styles: [`
    .toolbar { padding: 16px 20px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--line); }
    .toolbar h1 { margin: 0; font-size: 22px; }
    .spacer { flex: 1; }
    .empty { padding: 48px 20px; text-align: center; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; padding: 16px 20px; }
    .metric { padding: 14px; background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius); display: flex; flex-direction: column; gap: 4px; }
    .m-label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
    .m-val { font-size: 24px; font-weight: 700; }
    .m-val.warn   { color: #f97316; }
    .m-val.danger { color: #ef4444; }
    .m-val.ok     { color: var(--primary); }

    .sec-title { padding: 20px 20px 8px; margin: 0; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); }
    .empty-line { padding: 0 20px 16px; color: var(--muted); }
    .bar-block { padding: 0 20px 20px; display: flex; flex-direction: column; gap: 8px; }
    .bar-row { display: grid; grid-template-columns: 160px 1fr 110px; gap: 12px; align-items: center; }
    .bar-label { font-size: 13px; color: var(--fg); }
    .bar { height: 14px; background: var(--bg-2); border: 1px solid var(--line); border-radius: 999px; overflow: hidden; }
    .bar-fill { height: 100%; background: var(--primary); transition: width 0.2s; }
    .bar-val { text-align: right; }
  `],
})
export class ManagementAnalytics {
  private api = inject(Api);

  team = signal<HrEmployee[]>([]);
  reviews = signal<HrReview[]>([]);
  learning = signal<HrCourseAssignment[]>([]);
  leaves = signal<HrTimeOffEntry[]>([]);

  ngOnInit() {
    this.api.listMyTeam().subscribe(r => this.team.set(r.team));
    this.api.listMyTeamReviews().subscribe(r => this.reviews.set(r.reviews));
    this.api.listMyTeamLearning().subscribe(r => this.learning.set(r.assignments));
    this.api.listMyTeamTimeOff('approved').subscribe(r => this.leaves.set(r.entries));
  }

  avgTenureMonths = computed(() => {
    const t = this.team();
    if (t.length === 0) return 0;
    const today = Date.now();
    const total = t.reduce((sum, e) => {
      if (!e.hire_date) return sum;
      const d = new Date(e.hire_date + 'T00:00:00').getTime();
      return sum + Math.max(0, (today - d) / (30.44 * 86400000));
    }, 0);
    return Math.round(total / t.length);
  });

  onLeaveToday = computed(() => {
    const today = new Date().toISOString().slice(0, 10);
    return this.leaves().filter(e => today >= e.start_date && today <= e.end_date).length;
  });

  reviewsCompletePct = computed(() => {
    const r = this.reviews();
    if (r.length === 0) return 0;
    return Math.round(r.filter(x => x.status === 'completed' || x.status === 'closed').length / r.length * 100);
  });

  learningPct = computed(() => {
    const l = this.learning();
    if (l.length === 0) return 0;
    return Math.round(l.filter(x => x.status === 'completed').length / l.length * 100);
  });

  overdueLearning = computed(() => {
    const today = new Date().toISOString().slice(0, 10);
    return this.learning().filter(x => x.due_date && x.due_date < today && x.status !== 'completed').length;
  });

  statusMix = computed(() => {
    const t = this.team();
    const buckets: Record<string, number> = { active: 0, onboarding: 0, on_leave: 0 };
    for (const e of t) buckets[e.status || 'active'] = (buckets[e.status || 'active'] || 0) + 1;
    const total = t.length || 1;
    return [
      { label: 'Active',     count: buckets['active']     || 0, pct: Math.round((buckets['active']     || 0) / total * 100), color: 'var(--primary)' },
      { label: 'Onboarding', count: buckets['onboarding'] || 0, pct: Math.round((buckets['onboarding'] || 0) / total * 100), color: '#60a5fa' },
      { label: 'On leave',   count: buckets['on_leave']   || 0, pct: Math.round((buckets['on_leave']   || 0) / total * 100), color: '#f97316' },
    ];
  });

  departmentMix = computed(() => {
    const t = this.team();
    const buckets = new Map<string, number>();
    for (const e of t) {
      const d = e.department || 'Unassigned';
      buckets.set(d, (buckets.get(d) || 0) + 1);
    }
    const total = t.length || 1;
    return [...buckets.entries()]
      .map(([label, count]) => ({ label, count, pct: Math.round(count / total * 100) }))
      .sort((a, b) => b.count - a.count);
  });

  leaveByEmployee = computed(() => {
    const t = this.team();
    const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 1);
    const cutISO = cutoff.toISOString().slice(0, 10);
    const sums = new Map<number, number>();
    for (const l of this.leaves()) {
      if (l.start_date < cutISO) continue;
      sums.set(l.employee_id, (sums.get(l.employee_id) || 0) + (l.days || 0));
    }
    const max = Math.max(1, ...sums.values());
    return t
      .map(e => ({
        label: `${e.first_name} ${e.last_name}`,
        days: +(sums.get(e.id!) || 0).toFixed(1),
        pct: Math.round((sums.get(e.id!) || 0) / max * 100),
      }))
      .filter(r => r.days > 0)
      .sort((a, b) => b.days - a.days);
  });
}
