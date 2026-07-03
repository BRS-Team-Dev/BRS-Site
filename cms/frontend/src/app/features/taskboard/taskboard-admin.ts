import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import { DialogService } from '../../core/dialog';
import {
  CrmTask, CrmTaskCategory, CrmTaskNote, CrmTaskPriority, CrmTaskStatus, CrmTaskStats,
} from '../../core/models';

interface TaskDraft {
  id?: number;
  title: string;
  description: string;
  category: CrmTaskCategory;
  priority: CrmTaskPriority;
  status: CrmTaskStatus;
  due_at: string;
}

const ALL_CATS = ['all','lead','client','service','form','onboarding','other'] as const;
type CatFilter = typeof ALL_CATS[number];

/**
 * /admin/taskboard
 *
 * Lightweight CRM-level task board — admin's running list of
 * "things to do that aren't tied to a specific task project". Mirrors
 * the layout/feel of the Care4ocus board screenshot but in the BRS
 * dark palette: 4 KPI cards at top, category filter pills, then a
 * table of tasks with inline status + delete actions.
 *
 * Adding / editing happens in a global .modal overlay (per memory:
 * .modal-* classes live in styles.scss).
 */
@Component({
  selector: 'app-taskboard-admin',
  imports: [FormsModule, DatePipe, RouterLink],
  template: `
    <!-- Header ────────────────────────────────────────────────── -->
    <div class="toolbar">
      <div class="title-block">
        <h1>Task Board</h1>
        <p class="muted small">All outstanding to-dos across your CRM</p>
      </div>
      <span class="spacer"></span>
      @if (stats().urgent_open > 0) {
        <span class="urgent-badge">⚠ {{ stats().urgent_open }} Urgent</span>
      }
      <button class="primary" (click)="openNew()">+ Add Task</button>
    </div>

    <!-- KPI cards ─────────────────────────────────────────────── -->
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-value">{{ stats().total }}</div>
        <div class="kpi-label">Total Tasks</div>
        <div class="kpi-bar bar-total"></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-value">{{ stats().to_do }}</div>
        <div class="kpi-label">To Do</div>
        <div class="kpi-bar bar-todo" [style.width.%]="pct(stats().to_do)"></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-value">{{ stats().in_progress }}</div>
        <div class="kpi-label">In Progress</div>
        <div class="kpi-bar bar-progress" [style.width.%]="pct(stats().in_progress)"></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-value">{{ stats().done }}</div>
        <div class="kpi-label">Done</div>
        <div class="kpi-bar bar-done" [style.width.%]="pct(stats().done)"></div>
      </div>
    </div>

    <!-- Category pills ─────────────────────────────────────────── -->
    <div class="filter-row">
      @for (c of allCats; track c) {
        <button class="cat-pill"
                [class.selected]="catFilter() === c"
                (click)="catFilter.set(c)"
>
          {{ c === 'all' ? 'All' : titleCase(c) }}
          <span class="cat-count">{{ countByCategory(c) }}</span>
        </button>
      }
      <span class="spacer"></span>
      <input class="search" type="search" placeholder="Search tasks…"
             [ngModel]="search()" (ngModelChange)="search.set($event)" name="q"
 />
    </div>

    <!-- Table ──────────────────────────────────────────────────── -->
    @if (loading()) {
      <p class="muted" style="padding: 20px;">Loading…</p>
    } @else if (visible().length === 0) {
      <div class="empty">
        <p class="muted">No tasks yet.</p>
        <button class="primary" (click)="openNew()">+ Add your first task</button>
      </div>
    } @else {
      <div class="table-wrap">
        <table class="data">
          <thead><tr>
            <th>ID</th>
            <th>Task</th>
            <th>Category</th>
            <th>Assignee</th>
            <th>Priority</th>
            <th>Status</th>
            <th>Due</th>
            <th></th>
          </tr></thead>
          <tbody>
            @for (t of visible(); track t.id) {
              <tr (click)="openEdit(t)">
                <td><span class="muted small">{{ t.id }}</span></td>
                <td>
                  <strong>{{ t.title }}</strong>
                  @if (t.linked_client_id) {
                    <a class="client-link"
                       [routerLink]="['/admin/clients', t.linked_client_id]"
                       (click)="$event.stopPropagation()"
                       title="Open client">
                      → {{ t.linked_client_name || 'client' }}
                    </a>
                  }
                </td>
                <td><span class="cat-badge" [attr.data-cat]="t.category">{{ titleCase(t.category) }}</span></td>
                <td>{{ t.assignee_name || '—' }}</td>
                <td><span class="pri-pill" [attr.data-pri]="t.priority">{{ titleCase(t.priority) }}</span></td>
                <td (click)="$event.stopPropagation()">
                  <select class="status-inline"
                          [attr.data-status]="t.status"
                          [ngModel]="t.status"
                          (ngModelChange)="changeStatus(t, $event)"
                          [name]="'st_' + t.id"
>
                    <option value="to_do">To Do</option>
                    <option value="in_progress">In Progress</option>
                    <option value="done">Done</option>
                  </select>
                </td>
                <td [class.overdue]="isOverdue(t)">
                  @if (t.due_at) { {{ t.due_at | date:'mediumDate' }} } @else { — }
                </td>
                <td class="actions">
                  <button class="ghost icon-btn" (click)="openEdit(t, $event)" title="Edit"
>✎</button>
                  <button class="ghost icon-btn danger" (click)="del(t, $event)" title="Delete"
>✕</button>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }

    <!-- Add / Edit modal ──────────────────────────────────────── -->
    @if (modalOpen()) {
      <div class="modal-backdrop" (click)="closeModal()">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-head">
            <h2>{{ draft.id ? 'Edit task' : 'New task' }}</h2>
            <button class="ghost icon-btn" (click)="closeModal()">✕</button>
          </div>
          <div class="modal-body">
            @if (formError()) { <p class="error-msg">{{ formError() }}</p> }
            <label>Title</label>
            <input [(ngModel)]="draft.title" name="ft_title" placeholder="What needs doing?"
 />

            <label>Description</label>
            <textarea [(ngModel)]="draft.description" name="ft_desc" rows="3"
                      placeholder="Optional context, links, etc."
></textarea>

            <div class="row two-col">
              <div>
                <label>Category</label>
                <select [(ngModel)]="draft.category" name="ft_cat">
                  @for (c of editableCats; track c) {
                    <option [value]="c">{{ titleCase(c) }}</option>
                  }
                </select>
              </div>
              <div>
                <label>Priority</label>
                <select [(ngModel)]="draft.priority" name="ft_pri">
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
            </div>

            <div class="row two-col">
              <div>
                <label>Status</label>
                <select [(ngModel)]="draft.status" name="ft_status">
                  <option value="to_do">To Do</option>
                  <option value="in_progress">In Progress</option>
                  <option value="done">Done</option>
                </select>
              </div>
              <div>
                <label>Due</label>
                <input type="datetime-local" [(ngModel)]="draft.due_at" name="ft_due"
 />
              </div>
            </div>

            <!-- Notes thread — edit mode only (a fresh task has no id
                 to attach to yet). Append-only: posting calls the
                 backend with the current user's JWT, which the
                 endpoint stamps as the author. -->
            @if (draft.id) {
              <div class="notes-block">
                <label>Notes</label>
                <div class="note-compose">
                  <textarea [(ngModel)]="newNoteBody" name="ft_new_note"
                            rows="2" placeholder="Add a note…"
></textarea>
                  <button class="primary" type="button"
                          [disabled]="postingNote() || !newNoteBody.trim()"
                          (click)="postNote()"
>
                    {{ postingNote() ? 'Posting…' : 'Post' }}
                  </button>
                </div>
                @if (noteError()) { <p class="error-msg small">{{ noteError() }}</p> }

                @if (loadingNotes()) {
                  <p class="muted small">Loading notes…</p>
                } @else if (notes().length === 0) {
                  <p class="muted small note-empty">No notes yet.</p>
                } @else {
                  <ul class="note-list">
                    @for (n of notes(); track n.id) {
                      <li class="note-item">
                        <div class="note-head">
                          <strong>{{ n.user_name || '(deleted user)' }}</strong>
                          <span class="muted small">{{ n.created_at | date:'medium' }}</span>
                        </div>
                        <div class="note-body">{{ n.body }}</div>
                      </li>
                    }
                  </ul>
                }
              </div>
            }
          </div>
          <div class="modal-foot">
            <button class="ghost" (click)="closeModal()">Cancel</button>
            <button class="primary" (click)="save()" [disabled]="saving()">
              {{ saving() ? 'Saving…' : (draft.id ? 'Save changes' : 'Create task') }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: block; min-width: 0; }

    .toolbar {
      padding: 18px 24px; display: flex; align-items: flex-start; gap: 12px;
      border-bottom: 1px solid var(--line);
    }
    .title-block h1 { margin: 0; font-size: 22px; }
    .title-block p  { margin: 4px 0 0; }
    .urgent-badge {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 12px; border-radius: 999px;
      background: color-mix(in oklab, var(--danger), transparent 80%);
      color: var(--danger); font-size: 13px; font-weight: 600;
    }

    /* KPI cards — gradient progress bar underlines each value. */
    .kpi-grid {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px;
      padding: 20px 24px 8px;
    }
    @media (max-width: 900px) { .kpi-grid { grid-template-columns: repeat(2, 1fr); } }
    .kpi-card {
      background: var(--bg-2); border: 1px solid var(--line);
      border-radius: var(--radius); padding: 18px 20px;
      display: flex; flex-direction: column; gap: 4px;
    }
    .kpi-value { font-size: 30px; font-weight: 700; line-height: 1.1; }
    .kpi-label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
    .kpi-bar   { height: 4px; margin-top: 10px; border-radius: 2px; background: var(--bg-3); }
    .bar-total    { background: var(--fg); width: 100%; }
    .bar-todo     { background: var(--danger); }
    .bar-progress { background: var(--warning); }
    .bar-done     { background: var(--success); }

    /* Filter row — category pills + search. */
    .filter-row {
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
      padding: 12px 24px 8px;
    }
    .cat-pill {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 12px; border-radius: 999px;
      background: var(--bg-2); border: 1px solid var(--line);
      color: var(--fg); font-size: 13px; cursor: pointer;
      transition: border-color 0.15s, background 0.15s;
    }
    .cat-pill:hover { border-color: var(--primary); }
    .cat-pill.selected {
      background: var(--bg-3); border-color: var(--primary); color: var(--primary);
    }
    .cat-count {
      padding: 0 6px; min-width: 18px; text-align: center;
      background: var(--bg-3); color: var(--muted); border-radius: 999px;
      font-size: 11px; font-weight: 600;
    }
    .search { width: auto; min-width: 240px; }

    .empty {
      padding: 40px; text-align: center;
      display: flex; flex-direction: column; align-items: center; gap: 12px;
    }

    /* Inline "→ client" link under the task title. Only renders when
       the task was auto-created from an onboarding submission and
       carries a service_client_link_id. */
    .client-link {
      display: inline-block; margin-top: 3px; font-size: 12px;
      color: var(--primary); text-decoration: none; font-weight: 500;
      white-space: nowrap;
    }
    .client-link:hover { text-decoration: underline; }

    /* Category badge — colour-coded per category. */
    .cat-badge {
      display: inline-block;
      padding: 2px 10px; border-radius: 999px;
      font-size: 11px; font-weight: 600;
      background: var(--bg-2); color: var(--muted);
    }
    .cat-badge[data-cat="lead"]       { background: rgba(122, 169, 255, 0.18); color: #7aa9ff; }
    .cat-badge[data-cat="client"]     { background: rgba(86, 201, 138, 0.18); color: var(--success); }
    .cat-badge[data-cat="service"]    { background: rgba(212, 169, 58, 0.18); color: var(--primary); }
    .cat-badge[data-cat="form"]       { background: rgba(232, 138, 167, 0.18); color: #e88aa7; }
    .cat-badge[data-cat="onboarding"] { background: rgba(255, 159, 67, 0.18); color: var(--warning); }
    .cat-badge[data-cat="other"]      { background: var(--bg-2); color: var(--muted); }

    /* Priority pill — same shape as status, distinct colour. */
    .pri-pill {
      display: inline-block;
      padding: 2px 10px; border-radius: 999px;
      font-size: 11px; font-weight: 600;
    }
    .pri-pill[data-pri="low"]    { background: color-mix(in oklab, var(--muted), transparent 80%); color: var(--muted); }
    .pri-pill[data-pri="medium"] { background: color-mix(in oklab, var(--warning), transparent 80%); color: var(--warning); }
    .pri-pill[data-pri="high"]   { background: color-mix(in oklab, var(--primary), transparent 75%); color: var(--primary); }
    .pri-pill[data-pri="urgent"] { background: color-mix(in oklab, var(--danger), transparent 75%); color: var(--danger); }

    /* Inline status dropdown — re-uses the leads pattern so the
       look is consistent across CRM list pages. */
    .status-inline {
      -webkit-appearance: none; appearance: none;
      background-color: var(--bg-2); color: var(--fg);
      padding: 3px 26px 3px 12px;
      border-radius: 999px; border: 1px solid var(--line);
      font-size: 12px; font-weight: 600; cursor: pointer;
      width: auto; min-width: 0;
    }
    .status-inline:hover { border-color: var(--primary); }
    .status-inline[data-status="to_do"]       { color: var(--danger);  border-color: var(--danger); }
    .status-inline[data-status="in_progress"] { color: var(--warning); border-color: var(--warning); }
    .status-inline[data-status="done"]        { color: var(--success); border-color: var(--success); }

    td.actions { display: flex; gap: 4px; justify-content: flex-end; }
    td.actions .icon-btn {
      width: 32px; height: 32px; padding: 0;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 15px; line-height: 1;
    }
    .overdue { color: var(--danger); font-weight: 600; }

    .row.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

    /* Notes thread — sits below the form fields. Compose box +
       newest-first list. Each item shows author, timestamp, then
       the body in a card. */
    .notes-block {
      margin-top: 18px; padding-top: 16px;
      border-top: 1px solid var(--line);
    }
    .notes-block > label {
      display: block;
      color: var(--muted); font-size: 11px;
      text-transform: uppercase; letter-spacing: 0.5px;
      margin-bottom: 8px;
    }
    .note-compose {
      display: flex; flex-direction: column; gap: 8px;
    }
    .note-compose textarea { width: 100%; resize: vertical; min-height: 60px; }
    .note-compose button { width: 100%; }
    .note-empty { margin: 12px 0 0; }
    .note-list {
      list-style: none; padding: 0; margin: 14px 0 0;
      display: flex; flex-direction: column; gap: 8px;
      max-height: 260px; overflow-y: auto;
    }
    .note-item {
      padding: 10px 12px;
      background: var(--bg-3); border: 1px solid var(--line);
      border-radius: var(--radius-sm);
    }
    .note-head {
      display: flex; align-items: baseline; gap: 8px;
      margin-bottom: 4px;
    }
    .note-head strong { font-size: 13px; }
    .note-body { font-size: 13px; white-space: pre-wrap; word-break: break-word; }
    .error-msg.small { font-size: 12px; margin: 6px 0 0; }
  `],
})
export class TaskboardAdmin {
  private api = inject(Api);
  private dialog = inject(DialogService);

  tasks   = signal<CrmTask[]>([]);
  stats   = signal<CrmTaskStats>({ total: 0, to_do: 0, in_progress: 0, done: 0, urgent_open: 0 });
  loading = signal(true);

  search    = signal<string>('');
  catFilter = signal<CatFilter>('all');

  readonly allCats = ALL_CATS;
  readonly editableCats: CrmTaskCategory[] = ['lead','client','service','form','onboarding','other'];

  modalOpen  = signal(false);
  saving     = signal(false);
  formError  = signal<string | null>(null);
  draft: TaskDraft = this.blankDraft();

  // Notes thread state (edit mode only). The compose box is bound via
  // [(ngModel)] so it round-trips on draft typing; clears after a
  // successful post.
  notes        = signal<CrmTaskNote[]>([]);
  loadingNotes = signal(false);
  postingNote  = signal(false);
  noteError    = signal<string | null>(null);
  newNoteBody  = '';

  /** Visible-row filter: text search across title/description/assignee
   *  + category pill. Done tasks stay visible — admins might still
   *  want to find them; the colour-coded status pill makes the state
   *  obvious. */
  visible = computed<CrmTask[]>(() => {
    const q   = this.search().trim().toLowerCase();
    const cat = this.catFilter();
    return this.tasks().filter(t => {
      if (cat !== 'all' && t.category !== cat) return false;
      if (!q) return true;
      const hay = `${t.title} ${t.description ?? ''} ${t.assignee_name ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  });

  ngOnInit() { this.load(); }

  private load() {
    this.loading.set(true);
    this.api.listCrmTasks().subscribe({
      next: r => {
        this.tasks.set(r.tasks);
        this.stats.set(r.stats);
        this.loading.set(false);
      },
      error: () => { this.loading.set(false); },
    });
  }

  titleCase(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
  }

  /** Percentage of total tasks in a bucket — drives KPI bar width. */
  pct(n: number): number {
    const total = this.stats().total;
    return total > 0 ? Math.round((n / total) * 100) : 0;
  }

  countByCategory(c: CatFilter): number {
    if (c === 'all') return this.tasks().length;
    return this.tasks().filter(t => t.category === c).length;
  }

  isOverdue(t: CrmTask): boolean {
    if (!t.due_at || t.status === 'done') return false;
    return new Date(t.due_at).getTime() < Date.now();
  }

  changeStatus(t: CrmTask, next: CrmTaskStatus) {
    if (t.status === next) return;
    this.api.updateCrmTask(t.id, { status: next }).subscribe({
      next: () => this.load(),
      error: () => this.load(), // rollback by refetching truth
    });
  }

  openNew() {
    this.draft = this.blankDraft();
    this.formError.set(null);
    this.modalOpen.set(true);
  }

  openEdit(t: CrmTask, e?: Event) {
    e?.stopPropagation();
    this.draft = {
      id: t.id,
      title: t.title,
      description: t.description ?? '',
      category: t.category,
      priority: t.priority,
      status: t.status,
      due_at: t.due_at ? t.due_at.replace(' ', 'T').slice(0, 16) : '',
    };
    this.formError.set(null);
    this.notes.set([]);
    this.newNoteBody = '';
    this.noteError.set(null);
    this.loadNotes();
    this.modalOpen.set(true);
  }

  closeModal() {
    this.modalOpen.set(false);
    this.formError.set(null);
    this.notes.set([]);
    this.newNoteBody = '';
    this.noteError.set(null);
  }

  private loadNotes() {
    if (!this.draft.id) return;
    this.loadingNotes.set(true);
    this.api.listCrmTaskNotes(this.draft.id).subscribe({
      next: r => { this.notes.set(r.notes); this.loadingNotes.set(false); },
      error: () => { this.notes.set([]); this.loadingNotes.set(false); },
    });
  }

  postNote() {
    const body = this.newNoteBody.trim();
    if (!body || !this.draft.id) return;
    this.postingNote.set(true);
    this.noteError.set(null);
    this.api.addCrmTaskNote(this.draft.id, body).subscribe({
      next: () => {
        this.postingNote.set(false);
        this.newNoteBody = '';
        this.loadNotes();
      },
      error: e => {
        this.postingNote.set(false);
        this.noteError.set(e?.error?.error || 'Could not post note');
      },
    });
  }

  save() {
    const title = this.draft.title.trim();
    if (!title) { this.formError.set('Title is required'); return; }

    const payload: Partial<CrmTask> = {
      title,
      description: this.draft.description.trim() || null,
      category: this.draft.category,
      priority: this.draft.priority,
      status: this.draft.status,
      due_at: this.draft.due_at ? this.draft.due_at.replace('T', ' ') + ':00' : null,
    };

    this.saving.set(true);
    // Update + create return DIFFERENT result shapes ({ok} vs {id}), so
    // TypeScript can't unify them into one callable `.subscribe()`.
    // Split the call rather than papering over with `any`.
    const onOk    = () => { this.saving.set(false); this.closeModal(); this.load(); };
    const onErr   = (e: any) => {
      this.saving.set(false);
      this.formError.set(e?.error?.error || 'Could not save task');
    };
    if (this.draft.id) {
      this.api.updateCrmTask(this.draft.id, payload).subscribe({ next: onOk, error: onErr });
    } else {
      this.api.createCrmTask(payload).subscribe({ next: onOk, error: onErr });
    }
  }

  async del(t: CrmTask, e?: Event) {
    e?.stopPropagation();
    const ok = await this.dialog.confirm(`Delete "${t.title}"?`, {
      title: 'Delete task',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    this.api.deleteCrmTask(t.id).subscribe(() => this.load());
  }

  private blankDraft(): TaskDraft {
    return {
      title: '',
      description: '',
      category: 'other',
      priority: 'medium',
      status: 'to_do',
      due_at: '',
    };
  }
}
