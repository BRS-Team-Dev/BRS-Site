import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import {
  TenderTracker, TenderTrackerRow, Tender,
  OperationTask, OperationTaskStatus,
} from '../../core/models';

/**
 * Operations Taskboard. Two sources merged into one task list:
 *   1. Auto-derived tasks from /api/tenders/tracker — overdue,
 *      due-soon, awaiting-decision, incomplete, stale. Not editable;
 *      the underlying tender state changes them.
 *   2. Manual tasks stored in `operation_tasks` (migration 071).
 *      User-created, editable, deletable. Optional `tender_id` links
 *      a task to a specific tender so its title shows in the context.
 *
 *   /operations/taskboard
 *
 * Filter chips at the top focus on one bucket / status; "Manual"
 * shows only user-added tasks. The "+ New task" button opens a
 * modal form with title, category, status, priority, due date,
 * and an optional tender to link to.
 */

type AutoBucket = 'overdue' | 'due_soon' | 'awaiting_decision' | 'incomplete' | 'stale';
type Bucket = AutoBucket | 'manual';

interface TaskRow {
  /** Stable id for `track` in `@for`. Auto tasks use `auto-<bucket>-<id>`,
   *  manual tasks use `manual-<id>`. */
  rowKey: string;
  /** Underlying tender id (auto) or task id (manual) for navigation. */
  refId: number;
  source: 'auto' | 'manual';
  bucket: Bucket;
  task: string;
  context: string;
  priority: 'high' | 'medium' | 'low';
  status: string;
  dueDisplay: string;
  /** Raw manual task — populated for `source === 'manual'` so the row
   *  knows what to edit/delete and what status transitions are allowed. */
  manual?: OperationTask;
}

const BUCKET_LABELS: Record<Bucket, string> = {
  overdue:           'Overdue',
  due_soon:          'Due soon',
  awaiting_decision: 'Awaiting decision',
  incomplete:        'Incomplete',
  stale:             'Stale',
  manual:            'Manual',
};

const STATUS_LABELS: Record<OperationTaskStatus, string> = {
  to_do:       'To do',
  in_progress: 'In progress',
  done:        'Done',
};

const blankTask = (): OperationTask => ({
  title: '', description: '', category: '',
  status: 'to_do', priority: 'medium',
  due_date: '', tender_id: null,
});

@Component({
  selector: 'app-tenders-taskboard',
  imports: [FormsModule],
  template: `
    <div class="toolbar">
      <h1>Operations · Taskboard</h1>
      <span class="spacer"></span>
      <input
        class="search"
        type="search"
        placeholder="Search tasks…"
        [value]="search()"
        (input)="search.set($any($event.target).value)" />
      <button class="ghost" (click)="reload()" [disabled]="loading()">
        {{ loading() ? 'Loading…' : '↻ Refresh' }}
      </button>
      <button class="primary" (click)="openNew()">+ New task</button>
    </div>

    <div class="filters">
      <button class="chip" [class.active]="activeFilter() === 'all'" (click)="activeFilter.set('all')">
        All <span class="count">{{ allTasks().length }}</span>
      </button>
      @for (b of bucketKeys; track b) {
        <button class="chip"
                [class.active]="activeFilter() === b"
                [attr.data-bucket]="b"
                (click)="activeFilter.set(b)">
          {{ bucketLabel(b) }}
          <span class="count">{{ countsByBucket()[b] }}</span>
        </button>
      }
    </div>

    @if (loading() && allTasks().length === 0) {
      <div class="empty"><p class="muted">Loading…</p></div>
    } @else if (visibleTasks().length === 0) {
      <div class="empty">
        <p class="muted">
          @if (activeFilter() === 'all' && allTasks().length === 0) {
            🎉 No tasks. Click <strong>+ New task</strong> to add one.
          } @else if (search()) {
            No tasks match "{{ search() }}".
          } @else {
            No tasks in this bucket.
          }
        </p>
      </div>
    } @else {
      <div class="table-wrap">
        <table class="data taskboard">
          <thead><tr>
            <th class="col-id">ID</th>
            <th>Task</th>
            <th>Category</th>
            <th>Priority</th>
            <th>Status</th>
            <th>Due</th>
            <th></th>
          </tr></thead>
          <tbody>
            @for (t of visibleTasks(); track t.rowKey) {
              <tr (click)="open(t)">
                <td class="col-id">{{ t.refId }}</td>
                <td>
                  <div class="task-title">{{ t.task }}</div>
                  <div class="muted small">{{ t.context }}</div>
                </td>
                <td>
                  <span class="bucket-pill" [attr.data-bucket]="t.bucket">{{ bucketLabel(t.bucket) }}</span>
                </td>
                <td>
                  <span class="priority-pill" [attr.data-priority]="t.priority">{{ t.priority }}</span>
                </td>
                <td>
                  <span class="status-pill" [attr.data-status]="t.status">{{ statusDisplay(t.status) }}</span>
                </td>
                <td [class.overdue]="t.bucket === 'overdue'">{{ t.dueDisplay }}</td>
                <td class="actions">
                  @if (t.source === 'manual') {
                    <button class="ghost icon-btn" (click)="editTask(t); $event.stopPropagation()" title="Edit">✎</button>
                    <button class="ghost icon-btn danger" (click)="deleteTask(t); $event.stopPropagation()" title="Delete">✕</button>
                  } @else {
                    <button class="ghost icon-btn" (click)="open(t); $event.stopPropagation()" title="Open">›</button>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }

    <!-- New / edit task modal -->
    @if (modalOpen()) {
      <div class="modal-backdrop" (click)="closeModal()">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-head">
            <h2>{{ draft.id ? 'Edit task' : 'New task' }}</h2>
            <button class="ghost icon-btn" (click)="closeModal()" title="Close">✕</button>
          </div>

          <label>Title <span class="req">★</span></label>
          <input [(ngModel)]="draft.title" name="t_title" placeholder="What needs doing?" />

          <label>Description</label>
          <textarea [(ngModel)]="draft.description" name="t_desc" rows="3" placeholder="Any extra context"></textarea>

          <div class="row two">
            <div class="field">
              <label>Category</label>
              <input [(ngModel)]="draft.category" name="t_cat" placeholder="e.g. Research, Admin, Follow-up" list="op-category-options" />
              <datalist id="op-category-options">
                <option value="Research"></option>
                <option value="Admin"></option>
                <option value="Follow-up"></option>
                <option value="Internal"></option>
              </datalist>
            </div>
            <div class="field">
              <label>Linked tender (optional)</label>
              <select [(ngModel)]="draft.tender_id" name="t_tender">
                <option [ngValue]="null">— none —</option>
                @for (t of tenders(); track t.id) {
                  <option [ngValue]="t.id">{{ t.title }}</option>
                }
              </select>
            </div>
          </div>

          <div class="row two">
            <div class="field">
              <label>Priority</label>
              <select [(ngModel)]="draft.priority" name="t_priority">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div class="field">
              <label>Status</label>
              <select [(ngModel)]="draft.status" name="t_status">
                <option value="to_do">To do</option>
                <option value="in_progress">In progress</option>
                <option value="done">Done</option>
              </select>
            </div>
          </div>

          <label>Due date</label>
          <input type="datetime-local" [(ngModel)]="draft.due_date" name="t_due" />

          @if (modalError()) { <div class="error-msg">{{ modalError() }}</div> }

          <div class="row modal-actions">
            <span class="spacer"></span>
            <button class="ghost" (click)="closeModal()">Cancel</button>
            <button class="primary" (click)="saveTask()" [disabled]="modalSaving()">
              {{ modalSaving() ? 'Saving…' : (draft.id ? 'Save' : 'Create task') }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: block; padding: 16px 20px; }
    .toolbar h1 { font-size: 18px; }
    .toolbar .search { width: 280px; padding: 8px 12px; font-size: 13px; }

    .filters { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0 16px 0; }
    .chip {
      display: inline-flex; align-items: center; gap: 8px;
      background: var(--bg-2); color: var(--fg);
      border: 1px solid var(--line); border-radius: 999px;
      padding: 6px 14px; font-size: 13px;
      cursor: pointer; transition: border-color 0.15s, color 0.15s;
    }
    .chip:hover { border-color: var(--primary); color: var(--primary); }
    .chip.active { background: var(--primary); color: #0a0a0a; border-color: var(--primary); font-weight: 600; }
    .chip .count {
      background: rgba(0,0,0,0.15);
      padding: 1px 8px; border-radius: 999px; font-size: 11px;
    }
    .chip.active .count { background: rgba(0,0,0,0.25); color: #0a0a0a; }

    table.taskboard tr { cursor: pointer; }
    .col-id { color: var(--muted); width: 60px; }
    .task-title { font-weight: 600; color: var(--fg); margin-bottom: 2px; }
    .actions { width: 80px; text-align: right; white-space: nowrap; }

    .bucket-pill {
      display: inline-block; padding: 2px 10px;
      border-radius: 999px; font-size: 11px;
      border: 1px solid var(--line); color: var(--muted);
    }
    .bucket-pill[data-bucket="overdue"]           { color: var(--danger);  border-color: var(--danger);  background: rgba(255,100,100,0.10); }
    .bucket-pill[data-bucket="due_soon"]          { color: var(--primary); border-color: var(--primary); background: rgba(212,169,58,0.12); }
    .bucket-pill[data-bucket="awaiting_decision"] { color: var(--primary); border-color: var(--primary); background: rgba(212,169,58,0.12); }
    .bucket-pill[data-bucket="incomplete"]        { color: var(--warning, var(--primary)); border-color: var(--warning, var(--primary)); }
    .bucket-pill[data-bucket="stale"]             { color: var(--muted);   border-style: dashed; }
    .bucket-pill[data-bucket="manual"]            { color: var(--fg);      border-color: var(--line); background: var(--bg-3); }

    .priority-pill {
      display: inline-block; padding: 2px 10px;
      border-radius: 999px; font-size: 11px;
      border: 1px solid var(--line); color: var(--muted);
      text-transform: capitalize;
    }
    .priority-pill[data-priority="high"]   { color: var(--danger);  border-color: var(--danger); }
    .priority-pill[data-priority="medium"] { color: var(--primary); border-color: var(--primary); }
    .priority-pill[data-priority="low"]    { color: var(--muted); }

    .status-pill {
      display: inline-block; padding: 2px 10px;
      border-radius: 999px; font-size: 11px; text-transform: uppercase;
      letter-spacing: 0.5px; border: 1px solid var(--line); color: var(--muted);
    }
    .status-pill[data-status="planning"]    { color: var(--muted); }
    .status-pill[data-status="drafting"]    { color: var(--primary); border-color: var(--primary); }
    .status-pill[data-status="submitted"]   { color: var(--primary); border-color: var(--primary); }
    .status-pill[data-status="awarded"]     { color: var(--success); border-color: var(--success); }
    .status-pill[data-status="rejected"]    { color: var(--danger);  border-color: var(--danger); }
    .status-pill[data-status="withdrawn"]   { color: var(--muted); }
    .status-pill[data-status="to_do"]       { color: var(--muted); }
    .status-pill[data-status="in_progress"] { color: var(--primary); border-color: var(--primary); }
    .status-pill[data-status="done"]        { color: var(--success); border-color: var(--success); }

    .overdue { color: var(--danger); font-weight: 600; }

    /* ───── Modal ──────────────────────────────────────────────────── */
    .modal-backdrop {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.6);
      display: flex; align-items: center; justify-content: center;
      z-index: 1000;
    }
    .modal {
      background: var(--bg-2); border: 1px solid var(--line);
      border-radius: var(--radius); padding: 24px;
      width: 540px; max-width: 90vw; max-height: 90vh; overflow-y: auto;
      box-shadow: var(--shadow);
    }
    .modal-head {
      display: flex; align-items: center; gap: 12px;
      margin-bottom: 12px;
    }
    .modal-head h2 { flex: 1; margin: 0; font-size: 16px; }
    .modal label { margin-top: 12px; display: block; }
    .modal .row.two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .modal .field { display: flex; flex-direction: column; gap: 4px; }
    .modal .field label { margin-top: 0; }
    .modal-actions { display: flex; gap: 8px; margin-top: 20px; }
    .req { color: var(--primary); margin-left: 2px; }
  `],
})
export class TendersTaskboard {
  private api = inject(Api);
  private router = inject(Router);

  bucketKeys: Bucket[] = ['overdue', 'due_soon', 'awaiting_decision', 'incomplete', 'stale', 'manual'];
  bucketLabel = (b: Bucket): string => BUCKET_LABELS[b];

  loading = signal(false);
  tracker = signal<TenderTracker | null>(null);
  manualTasks = signal<OperationTask[]>([]);
  tenders = signal<Tender[]>([]);
  activeFilter = signal<'all' | Bucket>('all');
  search = signal('');

  // Modal state
  modalOpen = signal(false);
  modalSaving = signal(false);
  modalError = signal<string | null>(null);
  draft: OperationTask = blankTask();

  statusDisplay(s: string): string {
    return STATUS_LABELS[s as OperationTaskStatus]
      ?? (s.charAt(0).toUpperCase() + s.slice(1).replace('_', ' '));
  }

  /** Auto tracker tasks — one row per bucket entry. */
  autoTasks = computed<TaskRow[]>(() => {
    const t = this.tracker();
    if (!t) return [];
    const rows: TaskRow[] = [];
    const ctx = (r: TenderTrackerRow) => r.buyer ? `${r.title} · ${r.buyer}` : (r.title ?? '');

    for (const r of t.overdue) {
      const past = this.daysAgo(r.submission_deadline);
      rows.push({
        rowKey: `auto-overdue-${r.id}`, refId: r.id!, source: 'auto',
        bucket: 'overdue', priority: 'high',
        task: past != null ? `Submit application — OVERDUE by ${past} day${past === 1 ? '' : 's'}` : 'Submit application — OVERDUE',
        context: ctx(r), status: r.status || 'planning',
        dueDisplay: this.fmt(r.submission_deadline),
      });
    }
    for (const r of t.due_soon) {
      const left = this.daysUntil(r.submission_deadline);
      rows.push({
        rowKey: `auto-due_soon-${r.id}`, refId: r.id!, source: 'auto',
        bucket: 'due_soon', priority: left != null && left <= 2 ? 'high' : 'medium',
        task: left == null ? 'Submit application — due soon'
            : left === 0 ? 'Submit application — due today'
            : left === 1 ? 'Submit application — due tomorrow'
            : `Submit application — due in ${left} days`,
        context: ctx(r), status: r.status || 'planning',
        dueDisplay: this.fmt(r.submission_deadline),
      });
    }
    for (const r of t.awaiting_decision) {
      rows.push({
        rowKey: `auto-awaiting_decision-${r.id}`, refId: r.id!, source: 'auto',
        bucket: 'awaiting_decision', priority: 'medium',
        task: r.decision_date ? 'Follow up — decision expected' : 'Follow up — chase decision date',
        context: ctx(r), status: r.status || 'submitted',
        dueDisplay: this.fmt(r.decision_date) || '—',
      });
    }
    for (const r of t.incomplete) {
      const closeToDeadline = this.daysUntil(r.submission_deadline);
      rows.push({
        rowKey: `auto-incomplete-${r.id}`, refId: r.id!, source: 'auto',
        bucket: 'incomplete',
        priority: closeToDeadline != null && closeToDeadline <= 7 ? 'high' : 'medium',
        task: `Documentation missing — ${r.open_sections} of ${r.total_sections} section${r.total_sections === 1 ? '' : 's'} open`,
        context: ctx(r), status: r.status || 'planning',
        dueDisplay: this.fmt(r.submission_deadline) || '—',
      });
    }
    for (const r of t.stale) {
      rows.push({
        rowKey: `auto-stale-${r.id}`, refId: r.id!, source: 'auto',
        bucket: 'stale', priority: 'low',
        task: 'Review — no progress in 14+ days',
        context: ctx(r), status: r.status || 'planning',
        dueDisplay: this.fmt(r.submission_deadline) || '—',
      });
    }
    return rows;
  });

  /** Manual `operation_tasks` rows, projected into the same shape as auto tasks. */
  manualRows = computed<TaskRow[]>(() => {
    return this.manualTasks().map(t => ({
      rowKey: `manual-${t.id}`,
      refId:  t.id!,
      source: 'manual' as const,
      bucket: 'manual' as const,
      task:   t.title,
      context: this.manualContext(t),
      priority: (t.priority ?? 'medium') as 'low' | 'medium' | 'high',
      status:  t.status ?? 'to_do',
      dueDisplay: this.fmt(t.due_date) || '—',
      manual: t,
    }));
  });

  /** Merged list used by the search + filter + table. */
  allTasks = computed<TaskRow[]>(() => [...this.autoTasks(), ...this.manualRows()]);

  countsByBucket = computed<Record<Bucket, number>>(() => {
    const init: Record<Bucket, number> = {
      overdue: 0, due_soon: 0, awaiting_decision: 0, incomplete: 0, stale: 0, manual: 0,
    };
    for (const t of this.allTasks()) init[t.bucket]++;
    return init;
  });

  visibleTasks = computed<TaskRow[]>(() => {
    const q = this.search().trim().toLowerCase();
    const filter = this.activeFilter();
    return this.allTasks().filter(t => {
      if (filter !== 'all' && t.bucket !== filter) return false;
      if (!q) return true;
      return (t.task + ' ' + t.context).toLowerCase().includes(q);
    });
  });

  constructor() { this.reload(); }

  reload() {
    this.loading.set(true);
    let done = 0;
    const oneDone = () => { if (++done >= 3) this.loading.set(false); };
    this.api.getTenderTracker().subscribe({
      next: t => { this.tracker.set(t); oneDone(); },
      error: () => oneDone(),
    });
    this.api.listOperationTasks().subscribe({
      next: r => { this.manualTasks.set(r.tasks); oneDone(); },
      error: () => oneDone(),
    });
    this.api.listTenders().subscribe({
      next: r => { this.tenders.set(r.tenders); oneDone(); },
      error: () => oneDone(),
    });
  }

  open(t: TaskRow) {
    if (t.source === 'manual') {
      // For manual tasks linked to a tender, click drills into the tender;
      // otherwise the row is its own thing — open the edit modal.
      const tid = t.manual?.tender_id;
      if (tid) this.router.navigate(['/operations/tenders', tid]);
      else this.editTask(t);
      return;
    }
    this.router.navigate(['/operations/tenders', t.refId]);
  }

  openNew() {
    this.draft = blankTask();
    this.modalError.set(null);
    this.modalOpen.set(true);
  }
  editTask(t: TaskRow) {
    if (!t.manual) return;
    // Datetime-local needs the "YYYY-MM-DDTHH:MM" form
    const due = t.manual.due_date
      ? String(t.manual.due_date).replace(' ', 'T').slice(0, 16)
      : '';
    this.draft = { ...t.manual, due_date: due };
    this.modalError.set(null);
    this.modalOpen.set(true);
  }
  closeModal() {
    this.modalOpen.set(false);
    this.draft = blankTask();
    this.modalError.set(null);
  }
  saveTask() {
    this.modalError.set(null);
    const title = (this.draft.title || '').trim();
    if (!title) { this.modalError.set('Title is required.'); return; }
    this.modalSaving.set(true);
    const payload: OperationTask = {
      ...this.draft,
      title,
      description: (this.draft.description || '').trim() || null,
      category:    (this.draft.category    || '').trim() || null,
      // datetime-local "T" → DB DATETIME space form
      due_date: this.draft.due_date
        ? String(this.draft.due_date).replace('T', ' ').slice(0, 19)
        : null,
      tender_id: this.draft.tender_id ?? null,
    };
    const after = () => {
      this.modalSaving.set(false);
      this.closeModal();
      this.api.listOperationTasks().subscribe(r => this.manualTasks.set(r.tasks));
    };
    if (this.draft.id) {
      this.api.updateOperationTask(this.draft.id, payload).subscribe({
        next: after,
        error: e => { this.modalSaving.set(false); this.modalError.set(e?.error?.error || 'Save failed'); },
      });
    } else {
      this.api.createOperationTask(payload).subscribe({
        next: after,
        error: e => { this.modalSaving.set(false); this.modalError.set(e?.error?.error || 'Save failed'); },
      });
    }
  }
  deleteTask(t: TaskRow) {
    if (!t.manual?.id) return;
    if (!confirm(`Delete task "${t.manual.title}"?`)) return;
    this.api.deleteOperationTask(t.manual.id).subscribe(() => {
      this.api.listOperationTasks().subscribe(r => this.manualTasks.set(r.tasks));
    });
  }

  private manualContext(t: OperationTask): string {
    const parts: string[] = [];
    if (t.category) parts.push(t.category);
    if (t.tender_title) parts.push(`↗ ${t.tender_title}`);
    return parts.join(' · ');
  }

  private fmt(s: string | null | undefined): string {
    if (!s) return '';
    return s.replace('T', ' ').slice(0, 16);
  }
  /** Whole days from now until the given datetime (calendar-day floor). */
  private daysUntil(s: string | null | undefined): number | null {
    if (!s) return null;
    const t = new Date(String(s).replace(' ', 'T')).getTime();
    if (!Number.isFinite(t)) return null;
    const now = new Date(); now.setHours(0, 0, 0, 0);
    return Math.floor((t - now.getTime()) / 86_400_000);
  }
  /** Whole days since the given datetime (for "OVERDUE by N days"). */
  private daysAgo(s: string | null | undefined): number | null {
    const u = this.daysUntil(s);
    return u == null ? null : Math.abs(Math.min(0, u));
  }
}
