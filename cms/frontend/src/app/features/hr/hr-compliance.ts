import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { HrComplianceNote, HrComplianceTask, HrComplianceTaskType, HrCourse } from '../../core/models';

type DraftTask = {
  title: string;
  description: string;
  jurisdiction: string;
  frequency: HrComplianceTask['frequency'];
  task_type: HrComplianceTaskType;
  /** When task_type === 'training' this is the course we link to the new task on save (0 = none). */
  linked_course_id: number;
  next_due_at: string;
  notes: string;
};

const TASK_TYPE_LABELS: Record<HrComplianceTaskType, string> = {
  training: 'Training',
  document: 'Document submission / update',
  audit: 'Audit',
  employee: 'Employee compliance',
  other: 'Other',
};

const blankDraft = (): DraftTask => {
  const today = new Date();
  const next = new Date(today.getFullYear(), today.getMonth() + 1, today.getDate())
    .toISOString().slice(0, 10);
  return {
    title: '',
    description: '',
    jurisdiction: 'UK',
    frequency: 'annual',
    task_type: 'other',
    linked_course_id: 0,
    next_due_at: next,
    notes: '',
  };
};

@Component({
  selector: 'app-hr-compliance',
  imports: [FormsModule],
  template: `
    <div class="toolbar">
      <h1>Compliance</h1>
      <span class="spacer"></span>
      <button class="primary" (click)="openCreate()">+ New task</button>
    </div>

    <div class="summary">
      <div class="metric"><span class="m-label">Overdue</span><span class="m-val danger">{{ counts().overdue }}</span></div>
      <div class="metric"><span class="m-label">Due ≤ 30 days</span><span class="m-val warn">{{ counts().due }}</span></div>
      <div class="metric"><span class="m-label">Upcoming</span><span class="m-val">{{ counts().upcoming }}</span></div>
      <div class="metric"><span class="m-label">Completed (one-off)</span><span class="m-val ok">{{ counts().done }}</span></div>
    </div>

    <div class="section">
      <div class="section-head">
        <div class="section-head-text">
          <h2>Main checklist <span class="muted small">({{ oneOffTasks().length }})</span></h2>
          <span class="muted small">One-off compliance items the company needs to complete and tick off.</span>
        </div>
      </div>
      @if (oneOffTasks().length === 0) {
        <p class="muted small empty-line">No one-off tasks yet. Use <strong>+ New task</strong> with frequency set to <em>One-off</em>.</p>
      } @else {
        <div class="task-list">
          @for (t of oneOffTasks(); track t.id) {
            <div class="task-card"
                 [class.expanded]="expandedTaskId() === t.id"
                 [class.overdue]="t.status === 'overdue'"
                 [class.row-done]="t.status === 'done'">
              <div class="task-row" (click)="toggleExpand(t)">
                <span class="caret">{{ expandedTaskId() === t.id ? '▾' : '▸' }}</span>
                <div class="task-title">
                  <div class="row" style="gap: 6px; align-items: center;">
                    <strong>{{ t.title || 'Untitled task' }}</strong>
                    <span class="type-pill type-{{ t.task_type || 'other' }}">{{ taskTypeLabel(t) }}</span>
                  </div>
                  @if (t.description) { <div class="muted small">{{ t.description }}</div> }
                </div>
                <span class="muted small">{{ t.next_due_at || '—' }}</span>
                <span class="status status-{{ t.status }}">{{ t.status }}</span>
                <div class="actions" (click)="$event.stopPropagation()">
                  @if (t.status !== 'done') {
                    <button class="primary" (click)="markDone(t)">✓ Done</button>
                  } @else {
                    <span class="muted small">completed</span>
                  }
                  <button class="ghost icon-btn danger" (click)="del(t)" title="Delete">✕</button>
                </div>
              </div>
              @if (expandedTaskId() === t.id) {
                <div class="task-detail">
                  <div class="detail-grid">
                    <label>Title</label>
                    <input [ngModel]="t.title" (blur)="patch(t, { title: $any($event.target).value })" />

                    <label>Description</label>
                    <textarea rows="2" [ngModel]="t.description" (blur)="patch(t, { description: $any($event.target).value })"></textarea>
                  </div>

                  <div class="meta-row">
                    <div class="meta-field">
                      <label>Type</label>
                      <select [ngModel]="t.task_type || 'other'" (ngModelChange)="patch(t, { task_type: $event }); maybeReloadCourses(t)" name="tt_{{ t.id }}">
                        <option value="training">Training</option>
                        <option value="document">Document submission / update</option>
                        <option value="audit">Audit</option>
                        <option value="employee">Employee compliance</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                    <div class="meta-field">
                      <label>Jurisdiction</label>
                      <input [ngModel]="t.jurisdiction" (blur)="patch(t, { jurisdiction: $any($event.target).value })" />
                    </div>
                    <div class="meta-field">
                      <label>Due date</label>
                      <input type="date" [ngModel]="t.next_due_at" (change)="patch(t, { next_due_at: $any($event.target).value })" />
                    </div>
                    <div class="meta-field">
                      <label>Done on</label>
                      <span class="muted meta-static">{{ t.last_done_at || '— not yet —' }}</span>
                    </div>
                  </div>

                  @if (t.task_type === 'training') {
                    <div class="linked-courses">
                      <h4>Linked courses <span class="muted small">({{ (coursesByTask()[t.id!] || []).length }})</span></h4>
                      @if ((coursesByTask()[t.id!] || []).length === 0) {
                        <p class="muted small no-notes">No courses linked yet — pick one below.</p>
                      } @else {
                        <ul class="course-link-list">
                          @for (c of coursesByTask()[t.id!]; track c.id) {
                            <li class="course-link-item">
                              <strong>{{ c.title }}</strong>
                              @if (c.is_required) { <span class="link-pill">required</span> }
                              @if (!c.is_active) { <span class="link-pill muted-pill">inactive</span> }
                              <span class="muted small" style="flex: 1;">{{ c.completed_count ?? 0 }} / {{ c.assigned_count ?? 0 }} completed · {{ c.provider || '—' }}</span>
                              <button class="ghost icon-btn danger" (click)="unlinkCourse(t, c)" title="Unlink course">✕</button>
                            </li>
                          }
                        </ul>
                      }
                      <div class="link-course-row">
                        <select [(ngModel)]="linkPickerByTask[t.id!]" name="lp_{{ t.id }}">
                          <option [ngValue]="0">— add a course —</option>
                          @for (c of unlinkableCourses(t); track c.id) {
                            <option [ngValue]="c.id">{{ c.title }}{{ !c.is_active ? ' (inactive)' : '' }}{{ c.compliance_task_id ? ' — currently linked elsewhere' : '' }}</option>
                          }
                        </select>
                        <button class="primary"
                                (click)="linkCourseToTask(t)"
                                [disabled]="!linkPickerByTask[t.id!]">Link</button>
                      </div>
                    </div>
                  }

                  <div class="notes-thread">
                    <h4>Notes <span class="muted small">({{ (notesByTask()[t.id!] || []).length }})</span></h4>

                    @if ((notesByTask()[t.id!] || []).length === 0) {
                      <p class="muted small no-notes">No notes yet — leave the first one below.</p>
                    } @else {
                      <ul class="note-list">
                        @for (n of notesByTask()[t.id!]; track n.id) {
                          <li class="note-item">
                            <div class="note-meta">
                              <strong>{{ n.author_name || n.author_email || 'unknown' }}</strong>
                              <span class="muted small">{{ formatTime(n.created_at) }}</span>
                              <button class="ghost icon-btn danger" (click)="delNote(t, n)" title="Delete note">✕</button>
                            </div>
                            <div class="note-body">{{ n.body }}</div>
                          </li>
                        }
                      </ul>
                    }

                    <div class="note-form">
                      <textarea rows="2"
                                [ngModel]="noteDrafts()[t.id!] || ''"
                                (ngModelChange)="setNoteDraft(t.id!, $event)"
                                name="nd_{{ t.id }}"
                                placeholder="Add a follow-up note…"></textarea>
                      <button class="primary" (click)="addNote(t)" [disabled]="!(noteDrafts()[t.id!] || '').trim()">
                        Add note
                      </button>
                    </div>
                  </div>
                </div>
              }
            </div>
          }
        </div>
      }
    </div>

    <div class="section">
      <div class="section-head">
        <div class="section-head-text">
          <h2>Upcoming (recurring) <span class="muted small">({{ recurringTasks().length }})</span></h2>
          <span class="muted small">Recurring obligations — completing one rolls the next due date forward by the cadence.</span>
        </div>
      </div>
      <div class="rec-tabs">
        <button class="rec-tab" [class.active]="recView() === 'active'" (click)="recView.set('active')">
          Active ({{ recActive().length }})
        </button>
        <button class="rec-tab" [class.active]="recView() === 'done'" (click)="recView.set('done')">
          Done this iteration ({{ recDoneThisIteration().length }})
        </button>
        <button class="rec-tab" [class.active]="recView() === 'all'" (click)="recView.set('all')">
          All ({{ recurringTasks().length }})
        </button>
      </div>
      @if (visibleRecurring().length === 0) {
        <p class="muted small empty-line">
          @if (recView() === 'done') {
            No recurring tasks have been completed in their current cycle yet.
          } @else if (recView() === 'active') {
            All recurring tasks are up to date for this iteration.
          } @else {
            No recurring tasks yet.
          }
        </p>
      } @else {
        <div class="task-list">
          @for (t of visibleRecurring(); track t.id) {
            <div class="task-card"
                 [class.expanded]="expandedTaskId() === t.id"
                 [class.overdue]="t.status === 'overdue'"
                 [class.row-done-cycle]="isDoneThisIteration(t)">
              <div class="task-row" (click)="toggleExpand(t)">
                <span class="caret">{{ expandedTaskId() === t.id ? '▾' : '▸' }}</span>
                <div class="task-title">
                  <div class="row" style="gap: 6px; align-items: center;">
                    <strong>{{ t.title || 'Untitled task' }}</strong>
                    <span class="type-pill type-{{ t.task_type || 'other' }}">{{ taskTypeLabel(t) }}</span>
                  </div>
                  <div class="muted small">{{ (t.frequency || '').replace('_', ' ') }} · next {{ t.next_due_at || '—' }}</div>
                </div>
                <span class="status status-{{ t.status }}">{{ t.status }}</span>
                @if (isDoneThisIteration(t)) { <span class="cycle-pill">✓ this cycle</span> }
                <div class="actions" (click)="$event.stopPropagation()">
                  @if (!isDoneThisIteration(t)) {
                    <button class="primary" (click)="markDone(t)">✓ Done</button>
                  } @else {
                    <span class="muted small">awaiting</span>
                  }
                  <button class="ghost icon-btn danger" (click)="del(t)" title="Delete">✕</button>
                </div>
              </div>
              @if (expandedTaskId() === t.id) {
                <div class="task-detail">
                  <div class="detail-grid">
                    <label>Title</label>
                    <input [ngModel]="t.title" (blur)="patch(t, { title: $any($event.target).value })" />

                    <label>Description</label>
                    <textarea rows="2" [ngModel]="t.description" (blur)="patch(t, { description: $any($event.target).value })"></textarea>
                  </div>

                  <div class="meta-row">
                    <div class="meta-field">
                      <label>Type</label>
                      <select [ngModel]="t.task_type || 'other'" (ngModelChange)="patch(t, { task_type: $event }); maybeReloadCourses(t)" name="tt_{{ t.id }}">
                        <option value="training">Training</option>
                        <option value="document">Document submission / update</option>
                        <option value="audit">Audit</option>
                        <option value="employee">Employee compliance</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                    <div class="meta-field">
                      <label>Jurisdiction</label>
                      <input [ngModel]="t.jurisdiction" (blur)="patch(t, { jurisdiction: $any($event.target).value })" />
                    </div>
                    <div class="meta-field">
                      <label>Frequency</label>
                      <select [ngModel]="t.frequency" (ngModelChange)="patch(t, { frequency: $event })" name="cf2_{{ t.id }}">
                        <option value="monthly">Monthly</option>
                        <option value="quarterly">Quarterly</option>
                        <option value="annual">Annual</option>
                        <option value="custom">Custom</option>
                        <option value="one_off">Convert to one-off</option>
                      </select>
                    </div>
                    <div class="meta-field">
                      <label>Next due</label>
                      <input type="date" [ngModel]="t.next_due_at" (change)="patch(t, { next_due_at: $any($event.target).value })" />
                    </div>
                    <div class="meta-field">
                      <label>Last done</label>
                      <span class="muted meta-static">{{ t.last_done_at || '— never —' }}</span>
                    </div>
                  </div>

                  @if (t.task_type === 'training') {
                    <div class="linked-courses">
                      <h4>Linked courses <span class="muted small">({{ (coursesByTask()[t.id!] || []).length }})</span></h4>
                      @if ((coursesByTask()[t.id!] || []).length === 0) {
                        <p class="muted small no-notes">No courses linked yet — pick one below.</p>
                      } @else {
                        <ul class="course-link-list">
                          @for (c of coursesByTask()[t.id!]; track c.id) {
                            <li class="course-link-item">
                              <strong>{{ c.title }}</strong>
                              @if (c.is_required) { <span class="link-pill">required</span> }
                              @if (!c.is_active) { <span class="link-pill muted-pill">inactive</span> }
                              <span class="muted small" style="flex: 1;">{{ c.completed_count ?? 0 }} / {{ c.assigned_count ?? 0 }} completed · {{ c.provider || '—' }}</span>
                              <button class="ghost icon-btn danger" (click)="unlinkCourse(t, c)" title="Unlink course">✕</button>
                            </li>
                          }
                        </ul>
                      }
                      <div class="link-course-row">
                        <select [(ngModel)]="linkPickerByTask[t.id!]" name="lp_{{ t.id }}">
                          <option [ngValue]="0">— add a course —</option>
                          @for (c of unlinkableCourses(t); track c.id) {
                            <option [ngValue]="c.id">{{ c.title }}{{ !c.is_active ? ' (inactive)' : '' }}{{ c.compliance_task_id ? ' — currently linked elsewhere' : '' }}</option>
                          }
                        </select>
                        <button class="primary"
                                (click)="linkCourseToTask(t)"
                                [disabled]="!linkPickerByTask[t.id!]">Link</button>
                      </div>
                    </div>
                  }

                  <div class="notes-thread">
                    <h4>Notes <span class="muted small">({{ (notesByTask()[t.id!] || []).length }})</span></h4>

                    @if ((notesByTask()[t.id!] || []).length === 0) {
                      <p class="muted small no-notes">No notes yet — leave the first one below.</p>
                    } @else {
                      <ul class="note-list">
                        @for (n of notesByTask()[t.id!]; track n.id) {
                          <li class="note-item">
                            <div class="note-meta">
                              <strong>{{ n.author_name || n.author_email || 'unknown' }}</strong>
                              <span class="muted small">{{ formatTime(n.created_at) }}</span>
                              <button class="ghost icon-btn danger" (click)="delNote(t, n)" title="Delete note">✕</button>
                            </div>
                            <div class="note-body">{{ n.body }}</div>
                          </li>
                        }
                      </ul>
                    }

                    <div class="note-form">
                      <textarea rows="2"
                                [ngModel]="noteDrafts()[t.id!] || ''"
                                (ngModelChange)="setNoteDraft(t.id!, $event)"
                                name="nd_{{ t.id }}"
                                placeholder="Add a follow-up note…"></textarea>
                      <button class="primary" (click)="addNote(t)" [disabled]="!(noteDrafts()[t.id!] || '').trim()">
                        Add note
                      </button>
                    </div>
                  </div>
                </div>
              }
            </div>
          }
        </div>
      }
    </div>

    @if (showCreate()) {
      <div class="modal-backdrop" (click)="closeCreate()">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-head">
            <h2>New compliance task</h2>
            <button class="ghost icon-btn" (click)="closeCreate()" title="Close">✕</button>
          </div>
          <div class="modal-body">
            <label>Title <span class="required">*</span></label>
            <input [(ngModel)]="draft.title" name="d_title" placeholder="e.g. Pension re-enrolment" />

            <label>Description</label>
            <textarea rows="2" [(ngModel)]="draft.description" name="d_desc" placeholder="Optional context — what does this cover?"></textarea>

            <label>Task type</label>
            <select [(ngModel)]="draft.task_type" name="d_type">
              <option value="training">Training</option>
              <option value="document">Document submission / update</option>
              <option value="audit">Audit</option>
              <option value="employee">Employee compliance</option>
              <option value="other">Other</option>
            </select>
            @if (draft.task_type === 'training') {
              <label>Linked course</label>
              <select [(ngModel)]="draft.linked_course_id" name="d_course">
                <option [ngValue]="0">— pick a course (optional) —</option>
                @for (c of allCourses(); track c.id) {
                  <option [ngValue]="c.id">
                    {{ c.title }}{{ !c.is_active ? ' (inactive)' : '' }}{{ c.compliance_task_id ? ' — already linked' : '' }}
                  </option>
                }
              </select>
              @if (allCourses().length === 0) {
                <p class="muted small">No courses exist yet. Create one in <strong>Learning</strong> first, or leave this blank and link it later.</p>
              }
            }

            <div class="row-grid">
              <div>
                <label>Jurisdiction</label>
                <input [(ngModel)]="draft.jurisdiction" name="d_jur" placeholder="UK" />
              </div>
              <div>
                <label>Frequency</label>
                <select [(ngModel)]="draft.frequency" name="d_freq">
                  <option value="one_off">One-off</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="annual">Annual</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
              <div>
                <label>Next due <span class="required">*</span></label>
                <input type="date" [(ngModel)]="draft.next_due_at" name="d_due" />
              </div>
            </div>

            <label>Notes</label>
            <textarea rows="3" [(ngModel)]="draft.notes" name="d_notes" placeholder="Internal notes — links to evidence, owner, etc."></textarea>

            @if (createError()) { <p class="err">{{ createError() }}</p> }
          </div>
          <div class="modal-foot">
            <button class="ghost" (click)="closeCreate()">Cancel</button>
            <button class="primary" (click)="saveCreate()" [disabled]="busy()">{{ busy() ? 'Saving…' : 'Create task' }}</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .toolbar { padding: 16px 20px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--line); }
    .toolbar h1 { margin: 0; font-size: 22px; }
    .spacer { flex: 1; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; padding: 16px 20px; }
    .metric { padding: 14px; background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius); display: flex; flex-direction: column; gap: 4px; }
    .m-label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
    .m-val { font-size: 24px; font-weight: 700; }
    .m-val.danger { color: #ef4444; }
    .m-val.warn   { color: var(--primary); }
    .m-val.ok     { color: var(--primary); }
    .empty { padding: 40px 20px; text-align: center; }
    .empty-line { padding: 0 20px 16px; }

    .task-list {
      display: flex; flex-direction: column; gap: 6px;
      padding: 16px;
      margin: 0;
      background: #ffffff;
      border-radius: 0;
      border: 1px solid var(--line);
      border-left: none;
      border-right: none;
    }
    .task-card {
      background: var(--bg-3); border: 1px solid var(--line); border-radius: var(--radius-sm);
      overflow: hidden;
    }
    .task-card.expanded { border-color: var(--primary); }
    /* Overdue card stays the default colour — the red OVERDUE pill is enough of an indicator. */
    .task-card.row-done    { opacity: 0.55; }
    .task-card.row-done .task-title strong { text-decoration: line-through; }
    /* Done-this-iteration card stays the default colour — the gold "this cycle" pill is enough. */

    .task-row {
      display: grid;
      grid-template-columns: 16px 1fr auto auto auto auto;
      gap: 12px; align-items: center;
      padding: 10px 14px; cursor: pointer;
    }
    .task-row:hover { background: rgba(212,169,58,0.04); }
    .task-card .caret { color: var(--muted); font-size: 12px; }
    .task-title { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .task-title strong { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .task-row .actions { display: flex; gap: 6px; align-items: center; }

    .task-detail { padding: 12px 14px 14px; border-top: 1px solid var(--line); background: var(--bg-2); }
    .detail-grid { display: grid; grid-template-columns: 130px 1fr; gap: 10px 14px; align-items: start; }
    .detail-grid > label { margin: 6px 0 0; }
    .detail-grid > input, .detail-grid > textarea, .detail-grid > select { width: 100%; }
    .meta-row {
      display: flex; gap: 12px; flex-wrap: wrap;
      margin-top: 12px;
    }
    .meta-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 140px; }
    .meta-field label { margin: 0; }
    .meta-field input, .meta-field select { width: 100%; }
    .meta-static { padding: 8px 10px; }

    .type-pill {
      padding: 1px 6px; border-radius: 4px; font-size: 10px;
      text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      border: 1px solid var(--line); white-space: nowrap;
    }
    .type-pill.type-training { color: var(--primary); border-color: var(--primary); background: rgba(212,169,58,0.12); }
    .type-pill.type-document { color: #60a5fa; border-color: #60a5fa; background: rgba(96,165,250,0.12); }
    .type-pill.type-audit    { color: #f97316; border-color: #f97316; background: rgba(249,115,22,0.12); }
    .type-pill.type-employee { color: #a78bfa; border-color: #a78bfa; background: rgba(167,139,250,0.12); }
    .type-pill.type-other    { color: var(--muted); }

    .linked-courses { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--line); }
    .linked-courses h4 { margin: 0 0 8px; font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; }
    .course-link-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .course-link-item {
      background: var(--bg-3); border: 1px solid var(--line); border-radius: var(--radius-sm);
      padding: 8px 10px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 13px;
    }
    .link-pill {
      padding: 1px 6px; border-radius: 4px; font-size: 10px;
      text-transform: uppercase; letter-spacing: 0.5px;
      background: rgba(212,169,58,0.18); color: var(--primary);
    }
    .link-pill.muted-pill { background: var(--bg-2); color: var(--muted); border: 1px solid var(--line); }
    .link-course-row { display: flex; gap: 8px; margin-top: 8px; }
    .link-course-row select { flex: 1; }

    .notes-thread { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--line); }
    .notes-thread h4 { margin: 0 0 8px; font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; }
    .no-notes { margin: 4px 0 12px; }
    .note-list { list-style: none; margin: 0 0 12px; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .note-item {
      background: var(--bg-3); border: 1px solid var(--line); border-radius: var(--radius-sm);
      padding: 8px 10px;
    }
    .note-meta { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
    .note-meta strong { font-size: 13px; }
    .note-meta .icon-btn { margin-left: auto; }
    .note-body { white-space: pre-wrap; line-height: 1.5; font-size: 13px; }
    .note-form { display: flex; flex-direction: column; gap: 6px; }
    .note-form button { align-self: flex-end; }
    .section { padding: 8px 0 4px; }
    .section + .section { border-top: 1px solid var(--line); margin-top: 8px; }
    .section-head {
      padding: 12px 20px 8px; display: flex; align-items: flex-start; gap: 10px;
      background: none; border: none; width: 100%; text-align: left; color: inherit;
    }
    .section-head.clickable { cursor: pointer; }
    .section-head.clickable:hover { background: rgba(212,169,58,0.04); border: none; }
    .section-head .caret { color: var(--muted); font-size: 12px; padding-top: 2px; min-width: 14px; }
    .section-head-text { display: flex; flex-direction: column; gap: 2px; flex: 1; }
    .section-head h2 { margin: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); }
    .table-wrap { padding: 0 20px 20px; }
    tr.row-done { opacity: 0.55; }
    tr.row-done input { text-decoration: line-through; }
    tr.row-done-cycle { background: rgba(212, 169, 58, 0.04); }
    .rec-tabs { display: flex; gap: 4px; padding: 0 20px 8px; border-bottom: 1px solid var(--line); }
    .rec-tab {
      background: none; border: none; padding: 6px 14px; cursor: pointer;
      color: var(--muted); font-size: 12px; border-bottom: 2px solid transparent;
      text-transform: uppercase; letter-spacing: 0.5px;
    }
    .rec-tab:hover { color: var(--fg); background: none; border-color: transparent; }
    .rec-tab.active { color: var(--primary); border-color: var(--primary); }
    .cycle-pill {
      display: inline-block; margin-left: 6px;
      padding: 1px 6px; border-radius: 4px;
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;
      background: rgba(212, 169, 58, 0.18); color: var(--primary);
    }
    .status {
      display: inline-block; padding: 2px 10px; border-radius: 999px;
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      border: 1px solid var(--line);
    }
    .status-upcoming { color: var(--muted); }
    .status-due      { color: var(--primary); border-color: var(--primary); }
    .status-overdue  { color: #ef4444; border-color: #ef4444; }
    .status-done     { color: var(--primary); border-color: var(--primary); }
    .actions { text-align: right; white-space: nowrap; }
    tr.overdue td { background: rgba(239, 68, 68, 0.14) !important; }
    tr.overdue td:first-child { box-shadow: inset 3px 0 0 #ef4444; }

    .modal-backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,0.6);
      display: flex; align-items: center; justify-content: center; z-index: 100;
    }
    .modal {
      width: 540px; max-width: 90vw; max-height: 90vh; overflow: auto;
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius);
      display: flex; flex-direction: column;
    }
    .modal-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid var(--line); }
    .modal-head h2 { margin: 0; font-size: 16px; }
    .modal-body { padding: 16px 18px; display: flex; flex-direction: column; gap: 8px; }
    .modal-body label { margin-top: 6px; }
    .modal-foot { padding: 14px 18px; border-top: 1px solid var(--line); display: flex; justify-content: flex-end; gap: 8px; }
    .row-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
    .row-grid > div { display: flex; flex-direction: column; gap: 4px; }
    .row-grid label { margin: 0; }
    .required { color: #ef4444; }
    .err { color: #ef4444; font-size: 13px; margin: 4px 0 0; }
  `],
})
export class HrCompliance {
  private api = inject(Api);

  tasks = signal<HrComplianceTask[]>([]);
  showCreate = signal(false);
  busy = signal(false);
  createError = signal<string | null>(null);
  draft: DraftTask = blankDraft();

  oneOffTasks    = computed(() => this.tasks().filter(t => t.frequency === 'one_off'));
  recurringTasks = computed(() => this.tasks().filter(t => t.frequency !== 'one_off'));

  recView = signal<'active' | 'done' | 'all'>('active');
  expandedTaskId = signal<number | null>(null);
  notesByTask = signal<Record<number, HrComplianceNote[]>>({});
  noteDrafts = signal<Record<number, string>>({});
  coursesByTask = signal<Record<number, HrCourse[]>>({});
  allCourses = signal<HrCourse[]>([]);
  linkPickerByTask: Record<number, number> = {};

  toggleExpand(t: HrComplianceTask) {
    if (!t.id) return;
    const next = this.expandedTaskId() === t.id ? null : t.id;
    this.expandedTaskId.set(next);
    if (next !== null && this.notesByTask()[next] === undefined) {
      this.loadNotes(next);
    }
    if (next !== null && t.task_type === 'training' && this.coursesByTask()[next] === undefined) {
      this.loadCourses(next);
    }
  }
  /** Refetch the linked-courses list whenever the task type changes to or from `training`. */
  maybeReloadCourses(t: HrComplianceTask) {
    if (!t.id) return;
    if (t.task_type === 'training') this.loadCourses(t.id);
    else this.coursesByTask.update(m => { const c = { ...m }; delete c[t.id!]; return c; });
  }
  private loadCourses(taskId: number) {
    this.api.listHrComplianceCourses(taskId).subscribe(r => {
      this.coursesByTask.update(m => ({ ...m, [taskId]: r.courses }));
    });
  }
  taskTypeLabel(t: HrComplianceTask): string { return TASK_TYPE_LABELS[t.task_type || 'other']; }

  /** Courses that aren't already linked to this task; used to populate the inline picker. */
  unlinkableCourses(t: HrComplianceTask): HrCourse[] {
    const linkedIds = new Set((this.coursesByTask()[t.id!] || []).map(c => c.id));
    return this.allCourses().filter(c => !linkedIds.has(c.id));
  }
  linkCourseToTask(t: HrComplianceTask) {
    if (!t.id) return;
    const courseId = this.linkPickerByTask[t.id] || 0;
    if (!courseId) return;
    this.api.updateHrCourse(courseId, { compliance_task_id: t.id }).subscribe(() => {
      this.linkPickerByTask[t.id!] = 0;
      this.loadCourses(t.id!);
      this.loadAllCourses();
    });
  }
  unlinkCourse(t: HrComplianceTask, c: HrCourse) {
    if (!t.id || !c.id) return;
    if (!confirm(`Unlink "${c.title}" from this task?`)) return;
    this.api.updateHrCourse(c.id, { compliance_task_id: null as any }).subscribe(() => {
      this.loadCourses(t.id!);
      this.loadAllCourses();
    });
  }
  private loadNotes(taskId: number) {
    this.api.listHrComplianceNotes(taskId).subscribe(r => {
      this.notesByTask.update(m => ({ ...m, [taskId]: r.notes }));
    });
  }
  setNoteDraft(taskId: number, body: string) {
    this.noteDrafts.update(m => ({ ...m, [taskId]: body }));
  }
  addNote(t: HrComplianceTask) {
    if (!t.id) return;
    const body = (this.noteDrafts()[t.id] || '').trim();
    if (!body) return;
    this.api.addHrComplianceNote(t.id, body).subscribe(() => {
      this.noteDrafts.update(m => ({ ...m, [t.id!]: '' }));
      this.loadNotes(t.id!);
    });
  }
  delNote(t: HrComplianceTask, n: HrComplianceNote) {
    if (!t.id || !n.id) return;
    if (!confirm('Delete this note?')) return;
    this.api.deleteHrComplianceNote(t.id, n.id).subscribe(() => this.loadNotes(t.id!));
  }
  formatTime(iso?: string): string {
    if (!iso) return '';
    const d = new Date(iso.replace(' ', 'T'));
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  /**
   * "Done this iteration" = the task was marked complete and the next due date
   * has been rolled forward, but that next date hasn't arrived (or fallen into
   * the 30-day due window) yet. Status flips back to 'due' / 'overdue' on its
   * own as the next cycle approaches, which moves the row out of this bucket.
   */
  isDoneThisIteration(t: HrComplianceTask): boolean {
    return !!t.last_done_at && t.status === 'upcoming';
  }
  recDoneThisIteration = computed(() => this.recurringTasks().filter(t => this.isDoneThisIteration(t)));
  recActive            = computed(() => this.recurringTasks().filter(t => !this.isDoneThisIteration(t)));
  visibleRecurring     = computed(() => {
    const v = this.recView();
    if (v === 'done')   return this.recDoneThisIteration();
    if (v === 'active') return this.recActive();
    return this.recurringTasks();
  });

  counts = computed(() => {
    const out = { overdue: 0, due: 0, upcoming: 0, done: 0 };
    for (const t of this.tasks()) {
      if (t.status === 'overdue') out.overdue++;
      else if (t.status === 'due') out.due++;
      else if (t.status === 'upcoming') out.upcoming++;
      else if (t.status === 'done') out.done++;
    }
    return out;
  });

  ngOnInit() {
    this.refresh();
    this.loadAllCourses();
  }
  refresh() { this.api.listHrCompliance().subscribe(r => this.tasks.set(r.tasks)); }
  private loadAllCourses() {
    this.api.listHrCourses().subscribe(r => this.allCourses.set(r.courses));
  }

  openCreate() {
    this.draft = blankDraft();
    this.createError.set(null);
    this.showCreate.set(true);
  }
  closeCreate() {
    if (this.busy()) return;
    this.showCreate.set(false);
  }
  saveCreate() {
    const d = this.draft;
    if (!d.title.trim())   { this.createError.set('Title is required.'); return; }
    if (!d.next_due_at)    { this.createError.set('Next due date is required.'); return; }
    this.busy.set(true);
    this.createError.set(null);
    this.api.createHrCompliance({
      title: d.title.trim(),
      description: d.description.trim() || undefined,
      jurisdiction: d.jurisdiction.trim() || 'UK',
      frequency: d.frequency,
      task_type: d.task_type,
      next_due_at: d.next_due_at,
      notes: d.notes.trim() || undefined,
    }).subscribe({
      next: r => {
        const taskId = r.id;
        const linkCourse = d.task_type === 'training' && d.linked_course_id > 0;
        const finish = () => {
          this.busy.set(false);
          this.showCreate.set(false);
          this.refresh();
          this.loadAllCourses();
        };
        if (linkCourse && taskId) {
          this.api.updateHrCourse(d.linked_course_id, { compliance_task_id: taskId }).subscribe({
            next: () => finish(),
            error: () => finish(), // task is created either way; surface course-link error silently
          });
        } else {
          finish();
        }
      },
      error: e => { this.busy.set(false); this.createError.set(e?.error?.error || 'Could not create task'); },
    });
  }

  patch(t: HrComplianceTask, p: Partial<HrComplianceTask>) {
    if (!t.id) return;
    this.api.updateHrCompliance(t.id, p).subscribe(() => this.refresh());
  }
  markDone(t: HrComplianceTask) {
    if (!t.id) return;
    this.api.completeHrCompliance(t.id).subscribe(() => this.refresh());
  }
  del(t: HrComplianceTask) {
    if (!t.id) return;
    if (!confirm(`Delete "${t.title}"?`)) return;
    this.api.deleteHrCompliance(t.id).subscribe(() => this.refresh());
  }
}
