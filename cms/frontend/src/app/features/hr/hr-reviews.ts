import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { HrReview, HrReviewCycle } from '../../core/models';

/**
 * /hr/reviews — list of review cycles + a flat list of all reviews per cycle.
 * Manager-side: click a row to open the editor at /hr/reviews/:id.
 */
@Component({
  selector: 'app-hr-reviews',
  imports: [FormsModule],
  template: `
    <div class="toolbar">
      <h1>Performance reviews</h1>
      <span class="spacer"></span>
      <button class="primary" (click)="newCycle()">+ New cycle</button>
    </div>

    <div class="layout">
      <aside class="cycle-list">
        @for (c of cycles(); track c.id) {
          <button class="cycle-item" [class.active]="selectedId() === c.id" (click)="select(c)">
            <strong>{{ c.name }}</strong>
            <span class="muted small">{{ c.period_start }} → {{ c.period_end }}</span>
            <span class="status status-{{ c.status }}">{{ c.status }}</span>
            <span class="muted small">{{ c.completed_count ?? 0 }} / {{ c.review_count ?? 0 }} completed</span>
          </button>
        }
        @if (cycles().length === 0) { <p class="muted small" style="padding: 12px;">No cycles yet.</p> }
      </aside>

      <section class="cycle-detail">
        @if (selected(); as c) {
          <div class="cycle-card">
            <div class="row" style="flex-wrap: wrap;">
              <input [ngModel]="c.name" (blur)="patchCycle({ name: $any($event.target).value })" name="cn" />
              <input type="date" [ngModel]="c.period_start" (change)="patchCycle({ period_start: $any($event.target).value })" />
              <span class="muted">→</span>
              <input type="date" [ngModel]="c.period_end" (change)="patchCycle({ period_end: $any($event.target).value })" />
              <select [ngModel]="c.status" (ngModelChange)="patchCycle({ status: $event })" name="cs">
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="closed">Closed</option>
              </select>
              <button class="ghost" (click)="seed(c)" [disabled]="seeding()">
                {{ seeding() ? 'Seeding…' : '+ Seed reviews for active employees' }}
              </button>
              <button class="ghost danger" (click)="delCycle(c)">✕ Delete cycle</button>
            </div>
          </div>

          <h3 class="sec">Reviews ({{ reviews().length }})</h3>
          @if (reviews().length === 0) {
            <p class="muted small">No reviews seeded yet. Click <em>Seed reviews</em> above to create one row per active employee.</p>
          } @else {
            <table class="data">
              <thead><tr><th>Employee</th><th>Position</th><th>Status</th><th>Self</th><th>Manager</th><th></th></tr></thead>
              <tbody>
                @for (r of reviews(); track r.id) {
                  <tr (click)="open(r)">
                    <td><strong>{{ r.first_name }} {{ r.last_name }}</strong></td>
                    <td class="muted small">{{ r.position || '—' }}</td>
                    <td><span class="status status-r-{{ r.status }}">{{ r.status?.replace('_', ' ') }}</span></td>
                    <td>{{ r.employee_overall ?? '—' }}</td>
                    <td>{{ r.manager_overall ?? '—' }}</td>
                    <td class="actions"><button class="ghost icon-btn" (click)="open(r); $event.stopPropagation()">›</button></td>
                  </tr>
                }
              </tbody>
            </table>
          }
        } @else {
          <p class="muted small" style="padding: 24px;">Select a cycle on the left, or create one.</p>
        }
      </section>
    </div>
  `,
  styles: [`
    .toolbar { padding: 16px 20px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--line); }
    .toolbar h1 { margin: 0; font-size: 22px; }
    .spacer { flex: 1; }
    .layout { display: grid; grid-template-columns: 280px 1fr; min-height: calc(100vh - 120px); }
    .cycle-list { border-right: 1px solid var(--line); padding: 12px; display: flex; flex-direction: column; gap: 6px; overflow-y: auto; }
    .cycle-item {
      display: flex; flex-direction: column; gap: 2px;
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
      padding: 10px 12px; text-align: left; color: var(--fg); cursor: pointer;
    }
    .cycle-item:hover { border-color: var(--primary); }
    .cycle-item.active { border-color: var(--primary); background: var(--bg-3); }
    .cycle-detail { padding: 20px; }
    .cycle-card {
      background: var(--bg-3);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 16px;
      margin-bottom: 16px;
    }
    .cycle-card .row { margin-bottom: 0; flex-wrap: nowrap; align-items: center; }
    .cycle-card .row > input,
    .cycle-card .row > select { width: auto; flex: 0 1 auto; }
    .cycle-card .row > input[name="cn"] { flex: 1 1 200px; }
    .cycle-card .row > input[type="date"] { flex: 0 0 150px; }
    .cycle-card .row > select { flex: 0 0 120px; }
    .cycle-card .row > button { flex: 0 0 auto; white-space: nowrap; }
    @media (max-width: 1100px) {
      .cycle-card .row { flex-wrap: wrap; }
    }
    .row { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
    h3.sec { font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 10px; }
    tr { cursor: pointer; }
    .status, .status-r-not_started, .status-r-self_review, .status-r-manager_review, .status-r-completed, .status-r-closed {
      display: inline-block; padding: 2px 10px; border-radius: 999px;
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      border: 1px solid var(--line);
    }
    .status-draft    { color: var(--muted); }
    .status-active   { color: var(--primary); border-color: var(--primary); }
    .status-closed   { color: var(--muted); border-color: var(--muted); }
    .status-r-not_started     { color: var(--muted); }
    .status-r-self_review     { color: var(--primary); border-color: var(--primary); }
    .status-r-manager_review  { color: var(--primary); border-color: var(--primary); }
    .status-r-completed       { color: var(--primary); border-color: var(--primary); }
    .status-r-closed          { color: var(--muted); border-color: var(--muted); }
    .actions { text-align: right; }
  `],
})
export class HrReviews {
  private api = inject(Api);
  private router = inject(Router);

  cycles = signal<HrReviewCycle[]>([]);
  selectedId = signal<number | null>(null);
  reviews = signal<HrReview[]>([]);
  seeding = signal(false);

  selected = computed(() => this.cycles().find(c => c.id === this.selectedId()) ?? null);

  ngOnInit() {
    this.refreshCycles();
  }

  refreshCycles() {
    this.api.listHrReviewCycles().subscribe(r => {
      this.cycles.set(r.cycles);
      if (this.selectedId() === null && r.cycles.length > 0) this.select(r.cycles[0]);
    });
  }

  select(c: HrReviewCycle) {
    this.selectedId.set(c.id ?? null);
    if (c.id) this.api.listHrReviews({ cycle_id: c.id }).subscribe(rr => this.reviews.set(rr.reviews));
  }

  newCycle() {
    const today = new Date();
    const year = today.getFullYear();
    const half = today.getMonth() < 6 ? 1 : 2;
    const periodStart = `${year}-${half === 1 ? '01-01' : '07-01'}`;
    const periodEnd   = `${year}-${half === 1 ? '06-30' : '12-31'}`;
    const name = `H${half} ${year}`;
    this.api.createHrReviewCycle({ name, period_start: periodStart, period_end: periodEnd, status: 'draft' }).subscribe(r => {
      this.api.listHrReviewCycles().subscribe(rr => {
        this.cycles.set(rr.cycles);
        const c = rr.cycles.find(x => x.id === r.id);
        if (c) this.select(c);
      });
    });
  }

  patchCycle(p: Partial<HrReviewCycle>) {
    const id = this.selectedId();
    if (!id) return;
    this.api.updateHrReviewCycle(id, p).subscribe(() => this.refreshCycles());
  }

  delCycle(c: HrReviewCycle) {
    if (!c.id) return;
    if (!confirm(`Delete cycle "${c.name}"? All reviews in it will be removed.`)) return;
    this.api.deleteHrReviewCycle(c.id).subscribe(() => {
      this.selectedId.set(null);
      this.reviews.set([]);
      this.refreshCycles();
    });
  }

  seed(c: HrReviewCycle) {
    if (!c.id) return;
    this.seeding.set(true);
    this.api.seedHrReviewCycle(c.id).subscribe({
      next: r => {
        this.seeding.set(false);
        if (r.created === 0) alert('No new reviews — every active employee already has one for this cycle.');
        this.select(c);
        this.refreshCycles();
      },
      error: () => this.seeding.set(false),
    });
  }

  open(r: HrReview) {
    this.router.navigate(['/hr/reviews', r.id]);
  }
}
