import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { HrCourseAssignment, HrDocument, HrEmployee, HrOnboardingProgress, HrOnboardingSection, HrOnboardingTask, HrReference } from '../../core/models';

/**
 * Mirrors the 10 STEPS in HrOnboardingPortal so every step the new hire fills
 * in is independently verifiable by HR. Keep these in lockstep with the portal —
 * if you add a new section there, add it here too or HR will have no way to
 * approve it.
 */
const SECTIONS: { key: HrOnboardingSection; label: string; optional?: boolean }[] = [
  { key: 'profile',    label: 'Profile' },
  { key: 'contact',    label: 'Contact' },
  { key: 'emergency',  label: 'Emergency' },
  { key: 'payroll',    label: 'Payroll & banking' },
  { key: 'background', label: 'Background' },
  { key: 'references', label: 'References' },
  { key: 'documents',  label: 'Documents' },
  { key: 'tasks',      label: 'Checklist' },
  { key: 'learning',   label: 'Learning' },
  { key: 'diversity',  label: 'Equality', optional: true },
];

/**
 * /hr/onboarding — track each employee's onboarding portal progress, copy their
 *                  unique link, verify each section, and manage the per-person
 *                  task checklist inline (no need to dive into the employee
 *                  detail page for routine onboarding work).
 */
@Component({
  selector: 'app-hr-onboarding',
  imports: [FormsModule],
  template: `
    <div class="toolbar">
      <h1>Onboarding</h1>
      <span class="spacer"></span>
      <span class="muted small">{{ onboardingEmployees().length }} in progress</span>
    </div>

    <div class="content">
      @if (onboardingEmployees().length === 0) {
        <div class="empty">
          <p class="muted">Nobody is currently onboarding. Add a new employee or set an existing employee's status to "Onboarding".</p>
        </div>
      } @else {
        <div class="list">
          @for (e of onboardingEmployees(); track e.id) {
            <div class="card">
              <header class="hd">
                <div>
                  <strong>{{ e.first_name }} {{ e.last_name }}</strong>
                  <div class="muted small">{{ e.position || '—' }}{{ e.department ? ' · ' + e.department : '' }}</div>
                </div>
                <div class="link-area">
                  <input class="token" readonly [value]="portalUrl(e)" #urlIn (focus)="urlIn.select()" />
                  <button class="ghost" (click)="copyLink(e)" title="Copy onboarding link">📋 Copy</button>
                  <button class="primary" (click)="open(e)" title="Open employee detail">Open</button>
                </div>
              </header>

              <div class="progress-row">
                <div class="bar"><div class="fill" [style.width.%]="overallPct(e)"></div></div>
                <span class="muted small">{{ submittedCount(e) }} / {{ sections.length }} submitted · {{ verifiedCount(e) }} verified</span>
              </div>

              <div class="sections">
                @for (s of sections; track s.key) {
                  @let info = sectionInfo(e, s.key);
                  <div class="sec" [class.submitted]="info.submitted" [class.verified]="info.verified" [class.rejected]="info.rejected_at" [class.optional]="s.optional">
                    <div class="sec-head">
                      <span class="dot">
                        @if (info.verified) { ✓ }
                        @else if (info.rejected_at) { ✕ }
                        @else if (info.submitted) { ● }
                        @else { ○ }
                      </span>
                      <span class="sec-label">{{ s.label }}</span>
                      @if (s.optional) { <span class="opt-pill">optional</span> }
                      @if (info.rejected_at) { <span class="rej-pill">rejected</span> }
                    </div>
                    <div class="sec-meta muted small">
                      @if (info.rejected_at) { rejected {{ shortDate(info.rejected_at) }} }
                      @else if (info.submitted) { submitted {{ shortDate(info.submitted) }} }
                      @else { not yet }
                    </div>
                    @if (s.key === 'documents') {
                      @let signed = signedStats(e.id!);
                      @if (signed.total > 0) {
                        <div class="sec-extra muted small">
                          ✎ {{ signed.signed }} / {{ signed.total }} signed
                        </div>
                      }
                    }
                    <div class="sec-actions">
                      <button class="ghost" (click)="openSection(e, s.key)" title="View submitted information">View</button>
                      @if (info.verified) {
                        <button class="ghost" (click)="verify(e, s.key, false)" title="Undo verification">Unverify</button>
                      } @else if (info.submitted || info.rejected_at) {
                        <button class="primary" (click)="verify(e, s.key, true)">Verify</button>
                      } @else {
                        <span class="muted small">— waiting on employee —</span>
                      }
                    </div>
                  </div>
                }
              </div>

              @let empTasks = tasksFor(e.id!);
              @let empDone = empTasks.filter(t => t.is_done).length;
              <div class="tasks-block" [class.expanded]="isTasksOpen(e.id!)">
                <button class="tasks-head" type="button" (click)="toggleTasks(e.id!)">
                  <span class="caret">{{ isTasksOpen(e.id!) ? '▾' : '▸' }}</span>
                  <span class="tasks-title">Onboarding tasks</span>
                  <span class="muted small">{{ empDone }} / {{ empTasks.length }} done</span>
                </button>
                @if (isTasksOpen(e.id!)) {
                  <div class="tasks-body">
                    <div class="row" style="gap: 8px; margin-bottom: 10px;">
                      <input class="grow" [value]="newTaskTitle(e.id!)"
                             (input)="setNewTaskTitle(e.id!, $any($event.target).value)"
                             placeholder="Add an onboarding task…" />
                      <button class="primary" (click)="addTask(e.id!)" [disabled]="!newTaskTitle(e.id!).trim()">+ Add</button>
                    </div>
                    @if (empTasks.length === 0) {
                      <p class="muted small">No onboarding tasks yet.</p>
                    } @else {
                      <div class="task-list">
                        @for (t of empTasks; track t.id) {
                          <div class="task-row" [class.done]="t.is_done">
                            <input type="checkbox" [checked]="!!t.is_done" (change)="toggleTask(e.id!, t)" />
                            <input class="grow" [ngModel]="t.title" (blur)="updateTask(e.id!, t, { title: $any($event.target).value })" />
                            <input type="date" [ngModel]="t.due_date" (change)="updateTask(e.id!, t, { due_date: $any($event.target).value })" />
                            <button class="ghost icon-btn danger" (click)="delTask(e.id!, t)" title="Remove">✕</button>
                          </div>
                        }
                      </div>
                    }
                  </div>
                }
              </div>

              @if (e.onboarding_completed_at) {
                <div class="done-pill">✓ All sections submitted on {{ shortDate(e.onboarding_completed_at) }}</div>
              }
            </div>
          }
        </div>
      }
    </div>

    @if (viewing(); as v) {
      <div class="modal-backdrop" (click)="closeSection()">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-head">
            <div>
              <h2>{{ sectionLabel(v.section) }}</h2>
              <div class="muted small">{{ v.employee.first_name }} {{ v.employee.last_name }}</div>
            </div>
            <button class="ghost icon-btn" (click)="closeSection()" title="Close">✕</button>
          </div>

          @let info = sectionInfo(v.employee, v.section);
          <div class="modal-body">
            @if (info.rejected_at) {
              <div class="banner rejected">
                <strong>Rejected {{ shortDate(info.rejected_at) }}</strong>
                @if (info.rejected_reason) { <p>Reason sent to employee: "{{ info.rejected_reason }}"</p> }
              </div>
            }
            @if (info.verified) {
              <div class="banner verified">
                <strong>✓ Verified {{ shortDate(info.verified) }}</strong>
              </div>
            }
            @if (!info.submitted && !info.rejected_at && !info.verified) {
              <p class="muted">The employee hasn't submitted this section yet.</p>
            } @else {
              @switch (v.section) {
                @case ('profile')    { @let pf = profileFields(v.employee);    <dl class="kv">@for (r of pf; track r.label) {<div class="kv-row"><dt>{{ r.label }}</dt><dd>{{ r.value || '—' }}</dd></div>}</dl> }
                @case ('contact')    { @let cf = contactFields(v.employee);    <dl class="kv">@for (r of cf; track r.label) {<div class="kv-row"><dt>{{ r.label }}</dt><dd>{{ r.value || '—' }}</dd></div>}</dl> }
                @case ('emergency')  { @let ef = emergencyFields(v.employee);  <dl class="kv">@for (r of ef; track r.label) {<div class="kv-row"><dt>{{ r.label }}</dt><dd>{{ r.value || '—' }}</dd></div>}</dl> }
                @case ('payroll')    { @let pyf = payrollFields(v.employee);   <dl class="kv">@for (r of pyf; track r.label) {<div class="kv-row"><dt>{{ r.label }}</dt><dd>{{ r.value || '—' }}</dd></div>}</dl> }
                @case ('background') { @let bf = backgroundFields(v.employee); <dl class="kv">@for (r of bf; track r.label) {<div class="kv-row"><dt>{{ r.label }}</dt><dd>{{ r.value || '—' }}</dd></div>}</dl> }
                @case ('diversity')  { @let df = diversityFields(v.employee);  <dl class="kv">@for (r of df; track r.label) {<div class="kv-row"><dt>{{ r.label }}</dt><dd>{{ r.value || '—' }}</dd></div>}</dl> }
                @case ('references') {
                  @if (refs().length === 0) { <p class="muted small">No references provided.</p> }
                  @else {
                    <ul class="kv-list">
                      @for (r of refs(); track r.id) {
                        <li>
                          <strong>{{ r.name }}</strong>
                          @if (r.relationship) { <span class="muted small"> · {{ r.relationship }}</span> }
                          <div class="muted small">
                            {{ r.email || '—' }}{{ r.phone ? ' · ' + r.phone : '' }}
                            @if (r.company) { · {{ r.company }} }
                            @if (r.position) { · {{ r.position }} }
                          </div>
                          @if (r.notes) { <div class="ref-notes">{{ r.notes }}</div> }
                        </li>
                      }
                    </ul>
                  }
                }
                @case ('documents') {
                  @let docs = docsByEmp().get(v.employee.id!) ?? [];
                  @if (docs.length === 0) { <p class="muted small">No documents uploaded yet.</p> }
                  @else {
                    <ul class="kv-list">
                      @for (d of docs; track d.id) {
                        <li>
                          <strong>{{ d.title }}</strong>
                          <span class="muted small"> · {{ d.category || 'general' }}</span>
                          @if (d.requires_signature) {
                            @if (d.signed_at) { <span class="sig-pill signed">✓ signed {{ shortDate(d.signed_at) }}</span> }
                            @else { <span class="sig-pill pending">awaiting signature</span> }
                          }
                          <div class="muted small">Uploaded {{ d.uploaded_at }}</div>
                        </li>
                      }
                    </ul>
                  }
                }
                @case ('tasks') {
                  @let ts = tasksByEmp().get(v.employee.id!) ?? [];
                  @if (ts.length === 0) { <p class="muted small">No checklist items.</p> }
                  @else {
                    <ul class="kv-list">
                      @for (t of ts; track t.id) {
                        <li>
                          <strong>{{ t.is_done ? '✓' : '○' }} {{ t.title }}</strong>
                          @if (t.due_date) { <span class="muted small"> · due {{ t.due_date }}</span> }
                          @if (t.is_done && t.done_at) { <span class="muted small"> · done {{ shortDate(t.done_at) }}</span> }
                        </li>
                      }
                    </ul>
                  }
                }
                @case ('learning') {
                  @if (learning().length === 0) { <p class="muted small">No courses assigned.</p> }
                  @else {
                    <ul class="kv-list">
                      @for (a of learning(); track a.id) {
                        <li>
                          <strong>{{ a.title }}</strong>
                          @if (a.provider) { <span class="muted small"> · {{ a.provider }}</span> }
                          <div class="muted small">
                            Status: <strong>{{ a.status }}</strong>
                            @if (a.completed_at) { · completed {{ shortDate(a.completed_at) }} }
                            @if (a.due_date)     { · due {{ a.due_date }} }
                          </div>
                        </li>
                      }
                    </ul>
                  }
                }
              }
            }

            @if (rejecting()) {
              <div class="reject-form">
                <label>Why is this being rejected?</label>
                <textarea rows="3" [(ngModel)]="rejectReason" name="rr" placeholder="Tell the employee what to fix (will be shown on their portal)…"></textarea>
                @if (rejectError()) { <p class="err">{{ rejectError() }}</p> }
              </div>
            }
          </div>

          <div class="modal-foot">
            @if (rejecting()) {
              <button class="ghost" (click)="cancelReject()">Cancel</button>
              <span class="spacer"></span>
              <button class="danger" (click)="confirmReject()" [disabled]="busy()">{{ busy() ? 'Sending…' : 'Send rejection' }}</button>
            } @else {
              <button class="ghost" (click)="closeSection()">Close</button>
              <span class="spacer"></span>
              @if (info.verified) {
                <button class="ghost" (click)="verify(v.employee, v.section, false)">Unverify</button>
              } @else if (info.submitted || info.rejected_at) {
                <button class="ghost danger" (click)="startReject()">Reject</button>
                <button class="primary" (click)="verify(v.employee, v.section, true)">Verify</button>
              }
            }
          </div>
        </div>
      </div>
    }

  `,
  styles: [`
    .toolbar { padding: 16px 20px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--line); }
    .toolbar h1 { margin: 0; font-size: 22px; }
    .spacer { flex: 1; }
    .content { padding: 20px 24px 32px; background: #ffffff; min-height: calc(100vh - 120px); }
    .empty { padding: 40px 20px; text-align: center; }

    .list { display: flex; flex-direction: column; gap: 16px; }
    .card { background: var(--bg-3); border: 1px solid var(--line); border-radius: var(--radius); padding: 16px; }
    .hd { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; flex-wrap: wrap; }
    .hd strong { font-size: 16px; }
    .link-area { display: flex; gap: 6px; align-items: center; margin-left: auto; }
    .token { width: 320px; font-family: "JetBrains Mono", "Fira Code", monospace; font-size: 11px; }

    .progress-row { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
    .bar { flex: 1; height: 10px; background: var(--bg-2); border-radius: 999px; overflow: hidden; border: 1px solid var(--line); }
    .fill { height: 100%; background: var(--primary); transition: width 0.3s ease; }

    .sections { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px; }
    .sec {
      padding: 10px 12px;
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
      display: flex; flex-direction: column; gap: 4px;
    }
    .sec.submitted { border-color: var(--primary); }
    .sec.verified  { border-left: 3px solid #10b981; }
    .sec-head { display: flex; align-items: center; gap: 6px; font-weight: 600; font-size: 13px; }
    .dot { color: var(--muted); width: 14px; text-align: center; }
    .sec.submitted .dot { color: var(--primary); }
    .sec.verified  .dot { color: #10b981; }
    .sec.optional .sec-label { color: var(--muted); }
    .opt-pill {
      margin-left: auto;
      padding: 1px 6px; border-radius: 4px; font-size: 9px;
      text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      background: var(--bg-3); color: var(--muted); border: 1px solid var(--line);
    }
    .sec-extra {
      margin-top: 2px;
      padding: 3px 6px;
      background: rgba(212, 169, 58, 0.08);
      border: 1px solid var(--line); border-radius: 4px;
      width: fit-content;
    }
    .sec-actions { margin-top: 4px; }
    .sec-actions .ghost, .sec-actions .primary { padding: 4px 10px; font-size: 12px; }

    .tasks-block {
      margin-top: 14px; padding-top: 12px;
      border-top: 1px dashed var(--line);
    }
    .tasks-head {
      display: flex; align-items: center; gap: 8px;
      background: transparent; border: 0; padding: 0;
      cursor: pointer; color: var(--fg);
      width: 100%; text-align: left;
    }
    .tasks-head .caret { color: var(--muted); font-size: 12px; }
    .tasks-head .tasks-title { font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.6px; font-weight: 700; }
    .tasks-head:hover .tasks-title { color: var(--primary); }
    .tasks-body { margin-top: 12px; }
    .row { display: flex; align-items: center; }
    .grow { flex: 1; }

    .task-list { display: flex; flex-direction: column; gap: 6px; }
    .task-row {
      display: grid; grid-template-columns: auto 1fr 160px auto;
      gap: 8px; align-items: center;
      padding: 6px 10px;
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
    }
    .task-row.done input.grow { color: var(--muted); text-decoration: line-through; }
    .task-row input[type="checkbox"] { width: 16px; height: 16px; cursor: pointer; }

    .done-pill {
      margin-top: 12px;
      display: inline-block;
      padding: 6px 12px;
      background: rgba(16, 185, 129, 0.15);
      color: #10b981;
      border-radius: 999px;
      font-size: 12px; font-weight: 700;
    }

    .sec.rejected { border-left: 3px solid #ef4444; }
    .sec.rejected .dot { color: #ef4444; }
    .rej-pill {
      margin-left: auto;
      padding: 1px 6px; border-radius: 4px; font-size: 9px;
      text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      background: rgba(239,68,68,0.15); color: #ef4444; border: 1px solid #ef4444;
    }

    .modal-backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,0.6);
      display: flex; align-items: center; justify-content: center; z-index: 100;
    }
    .modal {
      width: 720px; max-width: 92vw; max-height: 92vh;
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius);
      display: flex; flex-direction: column;
      overflow: hidden;
    }
    .modal-head { display: flex; align-items: flex-start; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid var(--line); flex: 0 0 auto; }
    .modal-head h2 { margin: 0; font-size: 16px; }
    .modal-body { padding: 16px 18px; flex: 1 1 auto; overflow: auto; display: flex; flex-direction: column; gap: 12px; }
    .modal-foot { padding: 14px 18px; border-top: 1px solid var(--line); display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }

    .banner {
      padding: 10px 12px; border-radius: var(--radius-sm); border: 1px solid var(--line);
      font-size: 13px;
    }
    .banner.rejected { border-color: #ef4444; background: rgba(239,68,68,0.10); color: #ef4444; }
    .banner.rejected p { margin: 4px 0 0; color: var(--fg); }
    .banner.verified { border-color: #10b981; background: rgba(16,185,129,0.10); color: #10b981; }

    .kv { margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .kv-row {
      display: grid; grid-template-columns: 200px 1fr; gap: 12px;
      padding: 6px 8px; background: var(--bg-3); border: 1px solid var(--line); border-radius: var(--radius-sm);
    }
    .kv-row dt { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; margin: 0; }
    .kv-row dd { margin: 0; font-size: 13px; word-break: break-word; }

    .kv-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .kv-list li { padding: 8px 10px; background: var(--bg-3); border: 1px solid var(--line); border-radius: var(--radius-sm); }
    .ref-notes { margin-top: 4px; font-size: 12px; color: var(--muted); }
    .sig-pill {
      padding: 1px 6px; border-radius: 4px; font-size: 10px;
      text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      border: 1px solid var(--line);
    }
    .sig-pill.signed  { color: var(--primary); border-color: var(--primary); background: rgba(212,169,58,0.12); }
    .sig-pill.pending { color: #f59e0b; border-color: #f59e0b; background: rgba(245,158,11,0.10); }

    .reject-form { display: flex; flex-direction: column; gap: 6px; }
    .reject-form label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; }
    .reject-form textarea { width: 100%; }
    .err { color: #ef4444; font-size: 13px; margin: 0; }

    .modal-foot button.danger { background: rgba(239,68,68,0.10); color: #ef4444; border-color: #ef4444; }
    .modal-foot button.danger:hover { background: rgba(239,68,68,0.20); }
  `],
})
export class HrOnboarding {
  private api = inject(Api);
  private router = inject(Router);

  readonly sections = SECTIONS;

  employees = signal<HrEmployee[]>([]);
  onboardingEmployees = computed(() => this.employees().filter(e => e.status === 'onboarding'));

  /** Per-employee task list — eagerly loaded for everyone currently onboarding. */
  tasksByEmp = signal<Map<number, HrOnboardingTask[]>>(new Map());
  /** Per-employee document rows — used to surface signed-doc progress on the Documents card. */
  docsByEmp = signal<Map<number, HrDocument[]>>(new Map());
  /** Set of employee ids whose task panel is expanded. */
  tasksOpen = signal<Set<number>>(new Set());
  /** Per-employee draft for the "+ Add task" input. */
  newTaskByEmp = signal<Map<number, string>>(new Map());

  // ── Section detail modal state ──────────────────────────────────────────────
  viewing = signal<{ employee: HrEmployee; section: HrOnboardingSection } | null>(null);
  refs = signal<HrReference[]>([]);
  learning = signal<HrCourseAssignment[]>([]);
  rejecting = signal(false);
  rejectReason = '';
  rejectError = signal<string | null>(null);
  busy = signal(false);

  ngOnInit() {
    this.api.listHrEmployees().subscribe(r => this.employees.set(r.employees));
    // Two org-wide round-trips instead of 2N (was: per-onboarding-employee
    // `listHrOnboarding` + `listHrDocuments`). Per-employee loaders stay
    // around for the single-employee refresh after writes.
    this.api.listAllHrOnboarding().subscribe(r => {
      const m = new Map<number, HrOnboardingTask[]>();
      for (const [eid, tasks] of Object.entries(r.tasks_by_employee ?? {})) {
        m.set(Number(eid), tasks);
      }
      this.tasksByEmp.set(m);
    });
    this.api.listAllHrDocuments().subscribe(r => {
      const m = new Map<number, HrDocument[]>();
      for (const [eid, docs] of Object.entries(r.documents_by_employee ?? {})) {
        m.set(Number(eid), docs);
      }
      this.docsByEmp.set(m);
    });
  }

  refresh() {
    this.api.listHrEmployees().subscribe(r => this.employees.set(r.employees));
  }
  private loadTasks(empId: number) {
    this.api.listHrOnboarding(empId).subscribe(r => {
      const m = new Map(this.tasksByEmp());
      m.set(empId, r.tasks);
      this.tasksByEmp.set(m);
    });
  }
  private loadDocs(empId: number) {
    this.api.listHrDocuments(empId).subscribe(r => {
      const m = new Map(this.docsByEmp());
      m.set(empId, r.documents);
      this.docsByEmp.set(m);
    });
  }
  /** Counts how many signed-document rows the employee has and how many they've signed. */
  signedStats(empId: number): { signed: number; total: number } {
    const docs = (this.docsByEmp().get(empId) ?? []).filter(d => !!d.requires_signature);
    return { signed: docs.filter(d => !!d.signed_at).length, total: docs.length };
  }

  parseProgress(e: HrEmployee): HrOnboardingProgress {
    const raw = e.onboarding_progress_json;
    if (!raw) return {};
    if (typeof raw === 'object') return raw as HrOnboardingProgress;
    try { return JSON.parse(raw); } catch { return {}; }
  }

  sectionInfo(e: HrEmployee, key: HrOnboardingSection): {
    submitted: string | null; verified: string | null;
    rejected_at: string | null; rejected_reason: string | null;
  } {
    const p = this.parseProgress(e)[key];
    return {
      submitted: p?.submitted_at ?? null,
      verified: p?.verified_at ?? null,
      rejected_at: p?.rejected_at ?? null,
      rejected_reason: p?.rejected_reason ?? null,
    };
  }

  submittedCount(e: HrEmployee): number {
    const p = this.parseProgress(e);
    return SECTIONS.filter(s => p[s.key]?.submitted_at).length;
  }
  verifiedCount(e: HrEmployee): number {
    const p = this.parseProgress(e);
    return SECTIONS.filter(s => p[s.key]?.verified_at).length;
  }
  overallPct(e: HrEmployee): number {
    return Math.round((this.submittedCount(e) / SECTIONS.length) * 100);
  }

  shortDate(s: string | null): string {
    if (!s) return '';
    return s.slice(0, 10);
  }

  portalUrl(e: HrEmployee): string {
    if (!e.onboarding_token) return '— no token —';
    const base = location.origin + (location.pathname.startsWith('/builtrightstudio') ? '/builtrightstudio' : '');
    return `${base}/hr-onboarding/${e.onboarding_token}`;
  }

  copyLink(e: HrEmployee) {
    const url = this.portalUrl(e);
    navigator.clipboard?.writeText(url).then(
      () => alert('Onboarding link copied to clipboard:\n' + url),
      () => alert(url),
    );
  }

  verify(e: HrEmployee, section: HrOnboardingSection, on: boolean) {
    if (!e.id) return;
    this.api.verifyHrOnboardingSection(e.id, section, on).subscribe(() => this.refresh());
  }

  open(e: HrEmployee) {
    this.router.navigate(['/hr/employees', e.id]);
  }

  // ── Tasks ──────────────────────────────────────────────────────────────────
  tasksFor(empId: number): HrOnboardingTask[] { return this.tasksByEmp().get(empId) ?? []; }
  isTasksOpen(empId: number): boolean { return this.tasksOpen().has(empId); }
  toggleTasks(empId: number) {
    const next = new Set(this.tasksOpen());
    if (next.has(empId)) next.delete(empId); else next.add(empId);
    this.tasksOpen.set(next);
  }
  newTaskTitle(empId: number): string { return this.newTaskByEmp().get(empId) ?? ''; }
  setNewTaskTitle(empId: number, v: string) {
    const m = new Map(this.newTaskByEmp());
    m.set(empId, v);
    this.newTaskByEmp.set(m);
  }
  addTask(empId: number) {
    const title = this.newTaskTitle(empId).trim();
    if (!title) return;
    this.api.createHrOnboarding(empId, { title } as HrOnboardingTask).subscribe(() => {
      this.setNewTaskTitle(empId, '');
      this.loadTasks(empId);
    });
  }
  toggleTask(empId: number, t: HrOnboardingTask) {
    if (!t.id) return;
    this.api.updateHrOnboarding(empId, t.id, { is_done: t.is_done ? 0 : 1 }).subscribe(() => this.loadTasks(empId));
  }
  updateTask(empId: number, t: HrOnboardingTask, p: Partial<HrOnboardingTask>) {
    if (!t.id) return;
    this.api.updateHrOnboarding(empId, t.id, p).subscribe();
  }
  delTask(empId: number, t: HrOnboardingTask) {
    if (!t.id) return;
    if (!confirm(`Remove "${t.title}"?`)) return;
    this.api.deleteHrOnboarding(empId, t.id).subscribe(() => this.loadTasks(empId));
  }

  // ── Section detail modal ────────────────────────────────────────────────────
  sectionLabel(key: HrOnboardingSection): string {
    return SECTIONS.find(s => s.key === key)?.label ?? key;
  }
  openSection(e: HrEmployee, section: HrOnboardingSection) {
    if (!e.id) return;
    this.viewing.set({ employee: e, section });
    this.rejecting.set(false);
    this.rejectReason = '';
    this.rejectError.set(null);
    // Lazy-fetch supplementary data per section.
    if (section === 'references') {
      this.refs.set([]);
      this.api.listHrReferences(e.id).subscribe(r => this.refs.set(r.references));
    }
    if (section === 'learning') {
      this.learning.set([]);
      this.api.listEmpHrLearning(e.id).subscribe(r => this.learning.set(r.assignments));
    }
    // Tasks/docs are already eagerly loaded; refresh in case they're stale.
    if (section === 'documents') this.loadDocs(e.id);
    if (section === 'tasks') this.loadTasks(e.id);
  }
  closeSection() {
    if (this.busy()) return;
    this.viewing.set(null);
    this.rejecting.set(false);
  }
  startReject() {
    this.rejecting.set(true);
    this.rejectError.set(null);
    this.rejectReason = '';
  }
  cancelReject() {
    this.rejecting.set(false);
    this.rejectError.set(null);
  }
  confirmReject() {
    const v = this.viewing();
    if (!v?.employee.id) return;
    const reason = this.rejectReason.trim();
    if (!reason) { this.rejectError.set('Please give the employee a reason so they can fix it.'); return; }
    this.busy.set(true);
    this.api.rejectHrOnboardingSection(v.employee.id, v.section, reason).subscribe({
      next: () => {
        this.busy.set(false);
        this.rejecting.set(false);
        this.rejectReason = '';
        this.refresh();
        this.viewing.set(null);
      },
      error: (e: any) => {
        this.busy.set(false);
        this.rejectError.set(e?.error?.error || 'Could not reject section');
      },
    });
  }

  // ── Per-section read-only field mappers ─────────────────────────────────────
  private kv(label: string, value: any): { label: string; value: string } {
    if (value === null || value === undefined || value === '') return { label, value: '' };
    return { label, value: String(value) };
  }
  profileFields(e: HrEmployee) {
    return [
      this.kv('First name',     e.first_name),
      this.kv('Last name',      e.last_name),
      this.kv('Preferred name', e.preferred_name),
      this.kv('Date of birth',  e.dob),
      this.kv('Pronouns',       e.pronouns),
      this.kv('Gender',         e.gender),
      this.kv('Nationality',    e.nationality),
      this.kv('NI number',      e.national_insurance_number),
      this.kv('LinkedIn',       e.linkedin_url),
    ];
  }
  contactFields(e: HrEmployee) {
    const addr = [e.address_line1, e.address_line2, e.city, e.region, e.postcode, e.country]
      .filter(Boolean).join(', ');
    return [
      this.kv('Phone',            e.phone),
      this.kv('Address',          addr),
      this.kv('Current location', e.current_location),
    ];
  }
  emergencyFields(e: HrEmployee) {
    return [
      this.kv('Contact name',  e.emergency_name),
      this.kv('Phone',         e.emergency_phone),
      this.kv('Relationship',  e.emergency_rel),
    ];
  }
  payrollFields(e: HrEmployee) {
    return [
      this.kv('Tax code',          e.tax_code),
      this.kv('Student loan plan', e.student_loan_plan),
      this.kv('Pension opt-in',    e.pension_opt_in ? 'Yes' : 'No'),
      this.kv('Pension % (employee)', e.pension_employee_pct != null ? e.pension_employee_pct + '%' : ''),
      this.kv('Pension % (employer)', e.pension_employer_pct != null ? e.pension_employer_pct + '%' : ''),
      this.kv('Bank name',         e.bank_name),
      this.kv('Account name',      e.bank_account_name),
      this.kv('Sort code',         e.sort_code),
      this.kv('Account number',    e.account_number),
    ];
  }
  backgroundFields(e: HrEmployee) {
    const dec = e.criminal_record_declared;
    return [
      this.kv('Criminal record declared', dec === 1 ? 'Yes' : dec === 0 ? 'No' : ''),
      this.kv('Details',                  e.criminal_record_details),
      this.kv('DBS check reference',      e.dbs_check_ref),
      this.kv('DBS check date',           e.dbs_check_date),
    ];
  }
  diversityFields(e: HrEmployee) {
    return [
      this.kv('Ethnicity',             e.ethnicity),
      this.kv('Disability status',     e.disability_status),
      this.kv('Accommodations needed', e.accommodations_needed),
      this.kv('Dietary requirements',  e.dietary_requirements),
      this.kv('T-shirt size',          e.tshirt_size),
    ];
  }
}
