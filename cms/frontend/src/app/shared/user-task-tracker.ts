import { Component, computed, inject, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

/**
 * Unified task row shape emitted by every "my tasks" endpoint —
 * merges CRM tasks (crm_tasks) and heavy-duty Taskboard items
 * (task_items) into one list so the user sees everything assigned
 * to them in one place. `source` tells the UI which system the row
 * belongs to (drives the badge + deep-link).
 */
export interface MyTaskRow {
  id: number;
  source: 'crm' | 'taskboard';
  title: string;
  description?: string | null;
  category?: string | null;      // crm_tasks.category
  project_name?: string | null;  // task_items.project name
  status: string;
  priority: string;
  due_at?: string | null;
  created_at?: string;
  updated_at?: string;
  /** Deep-link back into the system the task lives in (for detail view). */
  href?: string | null;
}

/**
 * Shared "My tasks" tracker used by both the employee (/me) and
 * contractor (/contractor/me) portals. Uses the generic taskboard
 * style (KPI cards + filter row + flat table) — NOT the heavy-duty
 * kanban / sprint / project shape used in /tasks/*.
 *
 * The tracker is display-only: parents pass a merged task list and
 * a status-change callback. Status changes on CRM rows can be
 * PATCH'd back; taskboard-item rows are read-only here (change them
 * in the heavy-duty /tasks board where the sprint/effort context
 * lives).
 */
@Component({
  selector: 'app-user-task-tracker',
  imports: [DatePipe, FormsModule, RouterLink],
  template: `
    <!-- KPI cards ────────────────────────────────────────────── -->
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-value">{{ stats().total }}</div>
        <div class="kpi-label">Total assigned</div>
        <div class="kpi-bar bar-total"></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-value">{{ stats().to_do }}</div>
        <div class="kpi-label">To do</div>
        <div class="kpi-bar bar-todo" [style.width.%]="pct(stats().to_do)"></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-value">{{ stats().in_progress }}</div>
        <div class="kpi-label">In progress</div>
        <div class="kpi-bar bar-progress" [style.width.%]="pct(stats().in_progress)"></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-value" [class.overdue-count]="stats().overdue > 0">{{ stats().overdue }}</div>
        <div class="kpi-label">Overdue</div>
        <div class="kpi-bar bar-overdue" [style.width.%]="pct(stats().overdue)"></div>
      </div>
    </div>

    <!-- Filter row ─────────────────────────────────────────── -->
    <div class="filter-row">
      <button class="cat-pill" [class.selected]="sourceFilter() === 'all'"       (click)="sourceFilter.set('all')">All <span class="cat-count">{{ tasks().length }}</span></button>
      <button class="cat-pill" [class.selected]="sourceFilter() === 'crm'"       (click)="sourceFilter.set('crm')">CRM <span class="cat-count">{{ countBySource('crm') }}</span></button>
      <button class="cat-pill" [class.selected]="sourceFilter() === 'taskboard'" (click)="sourceFilter.set('taskboard')">Taskboard <span class="cat-count">{{ countBySource('taskboard') }}</span></button>
      <span class="spacer"></span>
      <button class="cat-pill" [class.selected]="hideDone()" (click)="hideDone.set(!hideDone())" title="Hide completed tasks">
        {{ hideDone() ? '✓ Hide done' : 'Show done' }}
      </button>
      <input class="search" type="search" placeholder="Search tasks…" [ngModel]="search()" (ngModelChange)="search.set($event)" name="q" />
    </div>

    <!-- Table ─────────────────────────────────────────────── -->
    @if (visible().length === 0) {
      <div class="empty">
        <p class="muted">No open tasks assigned to you.</p>
      </div>
    } @else {
      <div class="table-wrap">
        <table class="data">
          <thead><tr>
            <th>Source</th>
            <th>Task</th>
            <th>Context</th>
            <th>Priority</th>
            <th>Status</th>
            <th>Due</th>
          </tr></thead>
          <tbody>
            @for (t of visible(); track t.source + ':' + t.id) {
              <tr [class.done-row]="isDone(t.status)">
                <td><span class="src-pill" [attr.data-src]="t.source">{{ t.source === 'crm' ? 'CRM' : 'Taskboard' }}</span></td>
                <td>
                  @if (t.href) {
                    <a [routerLink]="t.href"><strong>{{ t.title }}</strong></a>
                  } @else {
                    <strong>{{ t.title }}</strong>
                  }
                  @if (t.description) { <div class="muted small task-desc">{{ t.description }}</div> }
                </td>
                <td>{{ t.project_name || t.category || '—' }}</td>
                <td><span class="pri-pill" [attr.data-pri]="priorityLabel(t.priority).toLowerCase()">{{ priorityLabel(t.priority) }}</span></td>
                <td>
                  @if (t.source === 'crm') {
                    <select class="status-inline" [attr.data-status]="t.status" [ngModel]="t.status"
                            (ngModelChange)="onStatusChange.emit({ task: t, next: $event })" [name]="'st_' + t.source + '_' + t.id">
                      <option value="to_do">To Do</option>
                      <option value="in_progress">In Progress</option>
                      <option value="done">Done</option>
                      <option value="on_hold">On Hold</option>
                    </select>
                  } @else {
                    <span class="status-pill" [attr.data-status]="t.status">{{ statusLabel(t.status) }}</span>
                  }
                </td>
                <td [class.overdue]="isOverdue(t)">
                  @if (t.due_at) { {{ t.due_at | date:'mediumDate' }} } @else { — }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
    @media (max-width: 900px) { .kpi-grid { grid-template-columns: repeat(2, 1fr); } }
    @media (max-width: 500px) { .kpi-grid { grid-template-columns: 1fr; } }
    .kpi-card {
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
      padding: 14px 16px; display: flex; flex-direction: column; gap: 4px;
    }
    .kpi-value { font-size: 26px; font-weight: 700; color: var(--fg); font-variant-numeric: tabular-nums; }
    .kpi-value.overdue-count { color: var(--danger); }
    .kpi-label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
    .kpi-bar { height: 3px; border-radius: 2px; margin-top: 6px; background: var(--line); transition: width 300ms ease; }
    .kpi-bar.bar-total   { background: var(--primary); }
    .kpi-bar.bar-todo    { background: var(--muted); }
    .kpi-bar.bar-progress{ background: var(--primary); }
    .kpi-bar.bar-overdue { background: var(--danger); }

    .filter-row {
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
      padding: 8px 0; margin-bottom: 10px;
    }
    .spacer { flex: 1; }
    .cat-pill {
      background: var(--bg-2); border: 1px solid var(--line); border-radius: 999px;
      padding: 5px 12px; font-size: 12px; color: var(--fg); cursor: pointer; white-space: nowrap;
    }
    .cat-pill:hover { border-color: var(--primary); }
    .cat-pill.selected { background: var(--bg-3); border-color: var(--primary); color: var(--primary); }
    .cat-count { margin-left: 6px; color: var(--muted); font-size: 11px; font-weight: 700; }
    .search { max-width: 260px; }

    .empty { text-align: center; padding: 40px 20px; }

    .src-pill {
      display: inline-block; padding: 2px 8px; border-radius: 999px;
      font-size: 10.5px; font-weight: 700; letter-spacing: 0.3px; text-transform: uppercase;
      border: 1px solid var(--line); color: var(--muted); white-space: nowrap;
    }
    .src-pill[data-src="crm"]       { color: var(--primary); border-color: var(--primary); }
    .src-pill[data-src="taskboard"] { color: #56CCF2;        border-color: #56CCF2; }

    .task-desc { margin-top: 2px; max-width: 420px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .pri-pill {
      display: inline-block; padding: 2px 8px; border-radius: 999px;
      font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px;
      border: 1px solid var(--line); color: var(--muted); white-space: nowrap;
    }
    .pri-pill[data-pri="low"]    { color: var(--muted); }
    .pri-pill[data-pri="medium"] { color: var(--primary); border-color: var(--primary); }
    .pri-pill[data-pri="high"]   { color: var(--warning); border-color: var(--warning); }
    .pri-pill[data-pri="urgent"] { color: var(--danger);  border-color: var(--danger); }

    .status-inline {
      background: transparent; border: 1px solid var(--line); border-radius: 999px;
      padding: 3px 10px; font-size: 12px; color: var(--fg); cursor: pointer;
    }
    .status-inline[data-status="to_do"]       { color: var(--muted); }
    .status-inline[data-status="in_progress"] { color: var(--primary); border-color: var(--primary); }
    .status-inline[data-status="done"]        { color: var(--success); border-color: var(--success); }
    .status-inline[data-status="on_hold"]     { color: var(--warning); border-color: var(--warning); }

    .status-pill {
      display: inline-block; padding: 3px 10px; border-radius: 999px;
      font-size: 12px; font-weight: 600; letter-spacing: 0.2px;
      border: 1px solid var(--line); color: var(--muted); white-space: nowrap;
    }
    .status-pill[data-status="todo"]        { color: var(--muted); }
    .status-pill[data-status="in_progress"] { color: var(--primary); border-color: var(--primary); }
    .status-pill[data-status="review"]      { color: #BB6BD9; border-color: #BB6BD9; }
    .status-pill[data-status="done"]        { color: var(--success); border-color: var(--success); }

    .overdue { color: var(--danger); font-weight: 700; }
    .done-row { opacity: 0.55; }
  `],
})
export class UserTaskTracker {
  tasks = input.required<MyTaskRow[]>();
  onStatusChange = output<{ task: MyTaskRow; next: string }>();

  sourceFilter = signal<'all' | 'crm' | 'taskboard'>('all');
  search = signal('');
  hideDone = signal(true);

  private isOverdueDate(due: string | null | undefined): boolean {
    if (!due) return false;
    return new Date(due).getTime() < Date.now();
  }
  isDone(status: string) { return status === 'done'; }
  isOverdue(t: MyTaskRow): boolean {
    return !this.isDone(t.status) && this.isOverdueDate(t.due_at);
  }

  priorityLabel(p: string): string {
    // task_items.priority is 1..5 int; crm_tasks.priority is enum string.
    const n = Number(p);
    if (Number.isFinite(n)) {
      return n <= 1 ? 'Low' : n === 2 ? 'Medium' : n === 3 ? 'High' : 'Urgent';
    }
    return p ? p[0].toUpperCase() + p.slice(1) : '—';
  }
  statusLabel(s: string): string {
    return s.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
  }

  countBySource(src: 'crm' | 'taskboard'): number {
    return this.tasks().filter(t => t.source === src).length;
  }

  stats = computed(() => {
    const list = this.tasks();
    let to_do = 0, in_progress = 0, done = 0, overdue = 0;
    for (const t of list) {
      if (t.status === 'done') { done++; continue; }
      if (t.status === 'in_progress' || t.status === 'review') in_progress++;
      else to_do++;
      if (this.isOverdueDate(t.due_at)) overdue++;
    }
    return { total: list.length, to_do, in_progress, done, overdue };
  });

  pct(n: number): number {
    const total = this.tasks().length || 1;
    return Math.round((n / total) * 100);
  }

  visible = computed(() => {
    const s = this.search().trim().toLowerCase();
    const src = this.sourceFilter();
    const hide = this.hideDone();
    return this.tasks().filter(t => {
      if (src !== 'all' && t.source !== src) return false;
      if (hide && t.status === 'done') return false;
      if (s && !(t.title.toLowerCase().includes(s)
              || (t.description || '').toLowerCase().includes(s)
              || (t.project_name || '').toLowerCase().includes(s)
              || (t.category    || '').toLowerCase().includes(s))) return false;
      return true;
    });
  });
}
