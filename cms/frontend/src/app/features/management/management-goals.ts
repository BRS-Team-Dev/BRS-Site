import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { HrEmployee, HrGoal } from '../../core/models';

@Component({
  selector: 'app-management-goals',
  imports: [FormsModule],
  template: `
    <div class="toolbar">
      <h1>Goals</h1>
      <span class="spacer"></span>
      <button class="primary" (click)="openCreate()" [disabled]="team().length === 0">+ New goal</button>
    </div>

    <div class="filters">
      <button class="filter" [class.active]="filter() === 'open'"      (click)="filter.set('open')">Open ({{ counts().open }})</button>
      <button class="filter" [class.active]="filter() === 'completed'" (click)="filter.set('completed')">Completed ({{ counts().completed }})</button>
      <button class="filter" [class.active]="filter() === 'all'"       (click)="filter.set('all')">All</button>
      <span class="spacer"></span>
      <select [(ngModel)]="employeeFilter" name="emp_filter">
        <option [ngValue]="0">All direct reports</option>
        @for (e of team(); track e.id) {
          <option [ngValue]="e.id">{{ e.first_name }} {{ e.last_name }}</option>
        }
      </select>
    </div>

    @if (visible().length === 0) {
      <div class="empty"><p class="muted small">No goals match this filter.</p></div>
    } @else {
      <div class="goal-list">
        @for (g of visible(); track g.id) {
          <div class="goal-card" [class.expanded]="expandedId() === g.id">
            <div class="goal-row" (click)="toggleExpand(g)">
              <span class="caret">{{ expandedId() === g.id ? '▾' : '▸' }}</span>
              <div class="goal-title">
                <strong>{{ g.title }}</strong>
                <div class="muted small">{{ g.first_name }} {{ g.last_name }} · due {{ g.due_date || '—' }}</div>
              </div>
              <div class="progress-bar"><div class="progress-fill" [style.width.%]="g.progress_pct || 0"></div></div>
              <span class="muted small pct">{{ g.progress_pct || 0 }}%</span>
              <span class="status status-g-{{ g.status }}">{{ g.status?.replace('_', ' ') }}</span>
            </div>
            @if (expandedId() === g.id) {
              <div class="goal-detail">
                <div class="detail-grid">
                  <label>Title</label>
                  <input [ngModel]="g.title" (blur)="patch(g, { title: $any($event.target).value })" />
                  <label>Description</label>
                  <textarea rows="2" [ngModel]="g.description" (blur)="patch(g, { description: $any($event.target).value })" placeholder="What's the goal?"></textarea>
                  <label>How we measure success</label>
                  <input [ngModel]="g.measurable" (blur)="patch(g, { measurable: $any($event.target).value })" placeholder="The measurable outcome — “M” in SMART" />
                </div>
                <div class="meta-row">
                  <div class="meta-field">
                    <label>Due date</label>
                    <input type="date" [ngModel]="g.due_date" (change)="patch(g, { due_date: $any($event.target).value })" />
                  </div>
                  <div class="meta-field">
                    <label>Status</label>
                    <select [ngModel]="g.status" (ngModelChange)="patch(g, { status: $event })" name="gs_{{ g.id }}">
                      <option value="not_started">Not started</option>
                      <option value="in_progress">In progress</option>
                      <option value="completed">Completed</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </div>
                  <div class="meta-field">
                    <label>Progress %</label>
                    <input type="number" min="0" max="100" [ngModel]="g.progress_pct" (blur)="patch(g, { progress_pct: +$any($event.target).value })" />
                  </div>
                  <div class="meta-field" style="justify-content: flex-end; flex-direction: row; align-items: end;">
                    <button class="ghost danger" (click)="del(g)">✕ Delete goal</button>
                  </div>
                </div>
              </div>
            }
          </div>
        }
      </div>
    }

    @if (showCreate()) {
      <div class="modal-backdrop" (click)="closeCreate()">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-head">
            <h2>New goal</h2>
            <button class="ghost icon-btn" (click)="closeCreate()" title="Close">✕</button>
          </div>
          <div class="modal-body">
            <label>Direct report <span class="required">*</span></label>
            <select [(ngModel)]="draft.employee_id" name="d_emp">
              <option [ngValue]="0">— pick an employee —</option>
              @for (e of team(); track e.id) {
                <option [ngValue]="e.id">{{ e.first_name }} {{ e.last_name }}</option>
              }
            </select>

            <label>Title <span class="required">*</span></label>
            <input [(ngModel)]="draft.title" name="d_title" placeholder="e.g. Lead the migration to the new analytics stack" />

            <label>Description</label>
            <textarea rows="2" [(ngModel)]="draft.description" name="d_desc"></textarea>

            <label>How we measure success</label>
            <input [(ngModel)]="draft.measurable" name="d_meas" placeholder="e.g. 100% of dashboards moved by Q3" />

            <div class="row-grid">
              <div>
                <label>Due date</label>
                <input type="date" [(ngModel)]="draft.due_date" name="d_due" />
              </div>
              <div>
                <label>Status</label>
                <select [(ngModel)]="draft.status" name="d_st">
                  <option value="not_started">Not started</option>
                  <option value="in_progress">In progress</option>
                </select>
              </div>
            </div>

            @if (createError()) { <p class="err">{{ createError() }}</p> }
          </div>
          <div class="modal-foot">
            <button class="ghost" (click)="closeCreate()">Cancel</button>
            <button class="primary" (click)="saveCreate()" [disabled]="busy()">{{ busy() ? 'Saving…' : 'Create goal' }}</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .toolbar { padding: 16px 20px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--line); }
    .toolbar h1 { margin: 0; font-size: 22px; }
    .spacer { flex: 1; }
    .filters { display: flex; align-items: center; gap: 8px; padding: 12px 20px; border-bottom: 1px solid var(--line); }
    .filter {
      background: none; border: 1px solid var(--line); padding: 6px 12px;
      border-radius: var(--radius-sm); color: var(--muted); cursor: pointer; font-size: 12px;
    }
    .filter.active { color: var(--primary); border-color: var(--primary); }
    .empty { padding: 48px 20px; text-align: center; }
    .goal-list { padding: 16px 20px; display: flex; flex-direction: column; gap: 6px; }
    .goal-card { background: var(--bg-3); border: 1px solid var(--line); border-radius: var(--radius-sm); overflow: hidden; }
    .goal-card.expanded { border-color: var(--primary); }
    .goal-row {
      display: grid; grid-template-columns: 16px 1fr 140px 50px auto; gap: 12px;
      align-items: center; padding: 10px 14px; cursor: pointer;
    }
    .goal-row:hover { background: rgba(212,169,58,0.04); }
    .caret { color: var(--muted); font-size: 12px; }
    .goal-title { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .goal-title strong { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .progress-bar { height: 6px; background: var(--bg-2); border-radius: 999px; overflow: hidden; }
    .progress-fill { height: 100%; background: var(--primary); transition: width 0.2s; }
    .pct { text-align: right; }
    .status {
      display: inline-block; padding: 2px 10px; border-radius: 999px;
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      border: 1px solid var(--line); white-space: nowrap;
    }
    .status-g-not_started { color: var(--muted); }
    .status-g-in_progress { color: var(--primary); border-color: var(--primary); }
    .status-g-completed   { color: var(--primary); border-color: var(--primary); }
    .status-g-cancelled   { color: var(--muted); }

    .goal-detail { padding: 12px 14px; border-top: 1px solid var(--line); background: var(--bg-2); }
    .detail-grid { display: grid; grid-template-columns: 180px 1fr; gap: 10px 14px; align-items: start; }
    .detail-grid > label { margin: 6px 0 0; }
    .meta-row { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 12px; }
    .meta-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 140px; }
    .meta-field label { margin: 0; }

    .modal-backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,0.6);
      display: flex; align-items: center; justify-content: center; z-index: 100;
    }
    .modal {
      width: 540px; max-width: 90vw; max-height: 90vh; overflow: auto;
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius);
    }
    .modal-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid var(--line); }
    .modal-head h2 { margin: 0; font-size: 16px; }
    .modal-body { padding: 16px 18px; display: flex; flex-direction: column; gap: 8px; }
    .modal-body label { margin-top: 6px; }
    .modal-foot { padding: 14px 18px; border-top: 1px solid var(--line); display: flex; justify-content: flex-end; gap: 8px; }
    .row-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .row-grid > div { display: flex; flex-direction: column; gap: 4px; }
    .row-grid label { margin: 0; }
    .required { color: #ef4444; }
    .err { color: #ef4444; font-size: 13px; margin: 4px 0 0; }
  `],
})
export class ManagementGoals {
  private api = inject(Api);

  team = signal<HrEmployee[]>([]);
  goals = signal<HrGoal[]>([]);
  filter = signal<'open' | 'completed' | 'all'>('open');
  employeeFilter = 0;
  expandedId = signal<number | null>(null);

  showCreate = signal(false);
  busy = signal(false);
  createError = signal<string | null>(null);
  draft: Partial<HrGoal> & { employee_id: number } = this.blankDraft();

  counts = computed(() => {
    const out = { open: 0, completed: 0 };
    for (const g of this.goals()) {
      if (g.status === 'completed') out.completed++;
      else if (g.status !== 'cancelled') out.open++;
    }
    return out;
  });
  visible = computed(() => {
    const f = this.filter();
    let list = this.goals();
    if (this.employeeFilter) list = list.filter(g => g.employee_id === this.employeeFilter);
    if (f === 'open')      list = list.filter(g => g.status !== 'completed' && g.status !== 'cancelled');
    if (f === 'completed') list = list.filter(g => g.status === 'completed');
    return list;
  });

  ngOnInit() {
    this.api.listMyTeam().subscribe(r => this.team.set(r.team));
    this.refresh();
  }
  refresh() { this.api.listMyTeamGoals().subscribe(r => this.goals.set(r.goals)); }

  toggleExpand(g: HrGoal) {
    if (!g.id) return;
    this.expandedId.set(this.expandedId() === g.id ? null : g.id);
  }
  patch(g: HrGoal, p: Partial<HrGoal>) {
    if (!g.id) return;
    this.api.updateTeamGoal(g.id, p).subscribe(() => this.refresh());
  }
  del(g: HrGoal) {
    if (!g.id) return;
    if (!confirm(`Delete "${g.title}"?`)) return;
    this.api.deleteTeamGoal(g.id).subscribe(() => { this.expandedId.set(null); this.refresh(); });
  }

  openCreate() { this.draft = this.blankDraft(); this.createError.set(null); this.showCreate.set(true); }
  closeCreate() { if (!this.busy()) this.showCreate.set(false); }
  saveCreate() {
    const d = this.draft;
    if (!d.employee_id)        { this.createError.set('Pick a direct report.'); return; }
    if (!d.title?.trim())      { this.createError.set('Title is required.'); return; }
    this.busy.set(true);
    this.createError.set(null);
    this.api.createTeamGoal(d.employee_id, {
      title: d.title.trim(),
      description: d.description?.trim() || undefined,
      measurable: d.measurable?.trim() || undefined,
      due_date: d.due_date || undefined,
      status: d.status || 'not_started',
    }).subscribe({
      next: () => { this.busy.set(false); this.showCreate.set(false); this.refresh(); },
      error: e => { this.busy.set(false); this.createError.set(e?.error?.error || 'Could not create goal'); },
    });
  }
  private blankDraft(): Partial<HrGoal> & { employee_id: number } {
    return { employee_id: 0, title: '', description: '', measurable: '', due_date: '', status: 'not_started' };
  }
}
