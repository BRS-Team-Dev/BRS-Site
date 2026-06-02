import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { environment } from '@env/environment';
import { Api } from '../../core/api';
import { HrComplianceTask, HrCourse, HrCourseAssignment, HrCourseModule, HrCourseModuleImage, HrCourseModuleKind, HrEmployee, HrQuizQuestion, HrSlideBlock, HrSlideBlockKind } from '../../core/models';

interface DraftQuiz {
  questions: (HrQuizQuestion & { options: string[]; correct: number[] })[];
}

/**
 * /hr/learning — course catalog, module authoring, and per-course assignment management.
 */
@Component({
  selector: 'app-hr-learning',
  imports: [FormsModule],
  template: `
    <div class="toolbar">
      <h1>Learning</h1>
      <span class="spacer"></span>
      <button class="primary" (click)="newCourse()">+ New course</button>
    </div>

    <div class="layout">
      <aside class="course-list">
        @for (c of courses(); track c.id) {
          <div class="course-item" [class.active]="selectedId() === c.id" [class.inactive]="!c.is_active">
            <button class="course-body" (click)="select(c)">
              <div class="row" style="align-items: center; gap: 6px; flex-wrap: wrap;">
                <strong>{{ c.title }}</strong>
                @if (c.is_required) { <span class="req-pill">required</span> }
                @if (c.compliance_task_title) { <span class="compl-pill" [title]="c.compliance_task_title">⚖ compliance</span> }
              </div>
              <span class="muted small">{{ c.provider || '—' }} · {{ c.category || 'general' }}</span>
              <span class="muted small">{{ c.completed_count ?? 0 }} / {{ c.assigned_count ?? 0 }} completed</span>
            </button>
            <div class="course-toolbar">
              <label class="toggle" [title]="c.is_active ? 'Active — click to deactivate' : 'Inactive — click to activate'">
                <input type="checkbox" [checked]="!!c.is_active" (change)="toggleCourseActive(c, $event)" />
                <span class="toggle-track"><span class="toggle-thumb"></span></span>
                <span class="toggle-label">{{ c.is_active ? 'Active' : 'Inactive' }}</span>
              </label>
              <button class="ghost icon-btn danger" (click)="delCourse(c)" title="Delete course">✕</button>
            </div>
          </div>
        }
        @if (courses().length === 0) { <p class="muted small" style="padding: 12px;">No courses yet.</p> }
      </aside>

      <section class="course-detail">
        @if (selected(); as c) {
          <div class="tabs">
            <button class="tab" [class.active]="tab() === 'modules'" (click)="tab.set('modules')">Modules ({{ modules().length }})</button>
            <button class="tab" [class.active]="tab() === 'assignments'" (click)="tab.set('assignments')">Assignments ({{ assignments().length }})</button>
            <button class="tab" [class.active]="tab() === 'settings'" (click)="tab.set('settings')">Settings</button>
          </div>

          @if (tab() === 'settings') {
            <div class="editor-card">
              <div class="form-grid">
                <label>Title</label>
                <input [ngModel]="c.title" (blur)="patch({ title: $any($event.target).value })" />

                <label>Provider</label>
                <input [ngModel]="c.provider" (blur)="patch({ provider: $any($event.target).value })" />

                <label>Category</label>
                <input [ngModel]="c.category" (blur)="patch({ category: $any($event.target).value })" />

                <label>External link</label>
                <input [ngModel]="c.link" (blur)="patch({ link: $any($event.target).value })" placeholder="https://…" />

                <label>Duration (hours)</label>
                <input type="number" step="0.5" [ngModel]="c.duration_hours" (blur)="patch({ duration_hours: +$any($event.target).value })" />

                <label>Required</label>
                <div class="check-row">
                  <input id="course_required" type="checkbox" [checked]="!!c.is_required" (change)="patch({ is_required: $any($event.target).checked ? 1 : 0 })" />
                  <label for="course_required">Mark this course as required</label>
                </div>

                <label>Compliance link</label>
                <select [ngModel]="c.compliance_task_id ?? null" (change)="patch({ compliance_task_id: +$any($event.target).value || null })">
                  <option [ngValue]="null">— not linked —</option>
                  @for (t of complianceTasks(); track t.id) {
                    <option [ngValue]="t.id">{{ t.title }}</option>
                  }
                </select>

                <label>Description</label>
                <textarea rows="3" [ngModel]="c.description" (blur)="patch({ description: $any($event.target).value })"></textarea>
              </div>

              <div class="row" style="margin-top: 14px; gap: 8px;">
                <button class="ghost danger" (click)="delCourse(c)">✕ Delete course</button>
              </div>
            </div>
          }

          @if (tab() === 'modules') {
            <div class="module-layout">
              <div class="module-list">
                <div class="add-row">
                  <button class="add-btn" (click)="addModule('text')">+ Slide</button>
                  <button class="add-btn" (click)="addModule('video')">+ Video</button>
                  <button class="add-btn" (click)="addModule('quiz')">+ Quiz</button>
                </div>
                @if (modules().length === 0) {
                  <p class="muted small">No modules yet. Add a Text, Video, or Quiz module to start building this course.</p>
                }
                @for (m of modules(); track m.id; let i = $index) {
                  <button class="mod-item" [class.active]="selectedModuleId() === m.id" (click)="selectModule(m)">
                    <div class="row" style="gap: 6px; align-items: center;">
                      <span class="kind-pill kind-{{ m.kind }}">{{ kindLabel(m.kind) }}</span>
                      <strong class="ellipsis">{{ m.title }}</strong>
                    </div>
                    <div class="row mod-actions" style="gap: 4px;">
                      <button class="ghost icon-btn" (click)="moveModule(m, -1, $event)" [disabled]="i === 0" title="Move up">↑</button>
                      <button class="ghost icon-btn" (click)="moveModule(m, 1, $event)" [disabled]="i === modules().length - 1" title="Move down">↓</button>
                      <button class="ghost icon-btn danger" (click)="delModule(m, $event)" title="Delete">✕</button>
                    </div>
                  </button>
                }
              </div>

              <div class="module-editor">
                @if (selectedModule(); as m) {
                  <div class="editor-card">
                  <div class="form-grid">
                    <label>Title</label>
                    <input [(ngModel)]="m.title" name="m_title_{{ m.id }}" (blur)="saveModule(m)" />

                    @if (m.kind === 'text') {
                      <label>Slide blocks</label>
                      <div class="blocks">
                        @for (b of slideDraft(); track b.id; let bi = $index; let last = $last) {
                          <div class="block">
                            <div class="block-head">
                              <span class="kind-pill kind-{{ b.kind }}">{{ b.kind }}</span>
                              <span class="spacer"></span>
                              <button class="block-icon" (click)="moveBlock(m, bi, -1)" [disabled]="bi === 0" title="Move up">↑</button>
                              <button class="block-icon" (click)="moveBlock(m, bi, 1)" [disabled]="last" title="Move down">↓</button>
                              <button class="block-icon danger" (click)="removeBlock(m, bi)" title="Remove">✕</button>
                            </div>

                            @if (b.kind === 'copy') {
                              <textarea rows="6" [(ngModel)]="b.body" name="b_copy_{{ b.id }}" (blur)="saveModule(m)" placeholder="Slide copy. Plain text."></textarea>
                            }
                            @if (b.kind === 'image') {
                              @if (b.url) {
                                <img class="block-img" [src]="assetUrl(b.url)" [alt]="b.alt || ''" />
                                <input class="block-alt" [(ngModel)]="b.alt" name="b_alt_{{ b.id }}" (blur)="saveModule(m)" placeholder="Alt text (optional)" />
                              } @else {
                                <label class="block-img-pick">
                                  <input type="file" accept="image/*" (change)="uploadBlockImage(m, b, $event)" hidden />
                                  <span>Choose image…</span>
                                </label>
                              }
                            }
                            @if (b.kind === 'video') {
                              <input [(ngModel)]="b.url" name="b_vurl_{{ b.id }}" (blur)="saveModule(m)" placeholder="https://youtu.be/… or .mp4 URL" />
                            }
                          </div>
                        }
                      </div>
                      <div class="add-row" style="margin-top: 8px;">
                        <button class="add-btn" (click)="addBlock(m, 'copy')">+ Copy block</button>
                        <button class="add-btn" (click)="addBlock(m, 'image')">+ Image block</button>
                        <button class="add-btn" (click)="addBlock(m, 'video')">+ Video block</button>
                      </div>
                      @if (slideDraft().length === 0) {
                        <p class="muted small">No blocks yet — add a Copy, Image, or Video block to start building this slide.</p>
                      }
                    }

                    @if (m.kind === 'video') {
                      <label>Video URL</label>
                      <input [(ngModel)]="m.video_url" name="m_url_{{ m.id }}" (blur)="saveModule(m)" placeholder="https://youtu.be/… or https://vimeo.com/… or .mp4 URL" />

                      <label>Notes</label>
                      <textarea rows="6" [(ngModel)]="m.body" name="m_video_body_{{ m.id }}" (blur)="saveModule(m)" placeholder="Optional notes shown alongside the video."></textarea>
                    }

                    @if (m.kind === 'quiz') {
                      <label>Pass score</label>
                      <div class="row" style="gap: 6px; align-items: center;">
                        <input type="number" min="1" max="100" [(ngModel)]="m.pass_score" name="m_pass_{{ m.id }}" (blur)="saveModule(m)" style="width: 80px;" />
                        <span class="muted small">% required to pass (default 100)</span>
                      </div>
                    }
                  </div>

                  @if (m.kind === 'quiz') {
                    <div class="quiz-wrap">
                      <h3 class="sec" style="margin-top: 0;">Questions</h3>
                      <div class="quiz">
                      @for (q of draft().questions; track q.id; let qi = $index) {
                        <div class="q-card">
                          <div class="row" style="gap: 6px; align-items: center; margin-bottom: 6px;">
                            <span class="q-num">{{ qi + 1 }}.</span>
                            <input class="q-prompt" [(ngModel)]="q.prompt" name="q_p_{{ q.id }}" (blur)="saveModule(m)" placeholder="Question prompt" />
                            <button class="ghost icon-btn danger" (click)="removeQuestion(qi)" title="Remove question">✕</button>
                          </div>
                          @for (opt of q.options; track $index; let oi = $index) {
                            <div class="row opt-row" style="gap: 6px; align-items: center;">
                              <label class="check" title="Mark as correct">
                                <input type="checkbox" [checked]="q.correct.includes(oi)" (change)="toggleCorrect(qi, oi); saveModule(m)" />
                              </label>
                              <input [(ngModel)]="q.options[oi]" name="q_o_{{ q.id }}_{{ oi }}" (blur)="saveModule(m)" placeholder="Option text" style="flex: 1;" />
                              <button class="ghost icon-btn danger" (click)="removeOption(qi, oi); saveModule(m)" title="Remove option" [disabled]="q.options.length <= 2">✕</button>
                            </div>
                          }
                          <button class="add-btn" style="margin-top: 4px; align-self: flex-start;" (click)="addOption(qi); saveModule(m)">+ Option</button>
                        </div>
                      }
                      <button class="add-btn" (click)="addQuestion(); saveModule(m)">+ Add question</button>
                      @if (draft().questions.length === 0) {
                        <p class="muted small">Add at least one question. Mark the correct option(s) with the checkbox.</p>
                      }
                      </div>
                    </div>
                  }
                  </div>
                } @else {
                  <p class="muted small" style="padding: 24px;">Select a module on the left, or add one above.</p>
                }
              </div>
            </div>
          }

          @if (tab() === 'assignments') {
            <div class="assign-bar">
              <div class="assign-fields">
                <div class="assign-field assign-date">
                  <label>Due date (optional)</label>
                  <input type="date" [(ngModel)]="bulkDueDate" name="bd" />
                </div>
              </div>

              <div class="assign-row">
                <span class="assign-label">Individual</span>
                <select [(ngModel)]="bulkEmployeeId" name="be" class="assign-select">
                  <option [ngValue]="0">— pick an employee —</option>
                  @for (e of unassignedEmployees(); track e.id) {
                    <option [ngValue]="e.id">{{ e.first_name }} {{ e.last_name }}</option>
                  }
                </select>
                <button class="primary" (click)="assignOne()" [disabled]="!bulkEmployeeId">Assign</button>
              </div>

              <div class="assign-row">
                <span class="assign-label">Department</span>
                <select [(ngModel)]="bulkDepartment" name="bd2" class="assign-select">
                  <option [ngValue]="''">— pick a department —</option>
                  @for (d of departments(); track d) {
                    <option [ngValue]="d">{{ d }} ({{ countInDept(d) }})</option>
                  }
                </select>
                <button class="primary" (click)="assignDepartment()" [disabled]="!bulkDepartment || countInDept(bulkDepartment) === 0">
                  Assign department
                </button>
              </div>

              <div class="assign-row">
                <span class="assign-label">Whole company</span>
                <span class="muted small" style="flex: 1;">{{ unassignedEmployees().length }} active employee(s) currently unassigned</span>
                <button class="primary" (click)="assignAll()" [disabled]="unassignedEmployees().length === 0">
                  Assign to all active
                </button>
              </div>
            </div>
            @if (groupedAssignments().length === 0) {
              <p class="muted small">No assignments yet.</p>
            } @else {
              <div class="assign-list">
                @for (g of groupedAssignments(); track g.key) {
                  <div class="assign-card" [class.expanded]="expandedGroup() === g.key">
                    <div class="assign-card-head"
                         [class.clickable]="g.scope !== 'individual'"
                         (click)="g.scope !== 'individual' && toggleGroup(g.key)">
                      <div class="row" style="gap: 8px; align-items: center; flex: 1;">
                        @if (g.scope !== 'individual') {
                          <span class="caret">{{ expandedGroup() === g.key ? '▾' : '▸' }}</span>
                        }
                        <span class="assign-scope-pill scope-{{ g.scope }}">
                          {{ g.scope === 'company' ? 'Company' : (g.scope === 'department' ? 'Department' : 'Individual') }}
                        </span>
                        <strong>{{ g.label }}</strong>
                      </div>
                      <button class="ghost icon-btn danger"
                        (click)="$event.stopPropagation(); g.scope === 'individual' ? unassign(g.assignments[0]) : unassignScope(g.scope, g.scopeValue || undefined)"
                        title="Unassign">✕</button>
                    </div>
                    @if (g.scope === 'individual') {
                      <div class="assign-card-body">
                        <span class="status status-{{ g.assignments[0].status }}">{{ g.assignments[0].status?.replace('_', ' ') }}</span>
                        <span class="muted small">Due: {{ g.assignments[0].due_date || '—' }}</span>
                        @if (g.assignments[0].completed_at) {
                          <span class="muted small">Completed: {{ g.assignments[0].completed_at }}</span>
                        }
                        @if (g.assignments[0].score != null) {
                          <span class="muted small">Score: {{ g.assignments[0].score }}</span>
                        }
                      </div>
                    } @else {
                      <div class="assign-card-body">
                        <span class="muted small">{{ g.total }} assigned</span>
                        <span class="status status-completed">{{ g.completed }} completed</span>
                        <span class="status status-in_progress">{{ g.inProgress }} in progress</span>
                        <span class="status status-not_started">{{ g.notStarted }} not started</span>
                      </div>
                      <div class="assign-progress"><div class="assign-progress-fill" [style.width.%]="g.total ? (g.completed / g.total * 100) : 0"></div></div>

                      @if (expandedGroup() === g.key) {
                        <div class="assign-roster">
                          <div class="roster-head">
                            <span>Employee</span><span>Status</span><span>Due</span><span>Completed</span><span>Score</span><span></span>
                          </div>
                          @for (a of g.assignments; track a.id) {
                            <div class="roster-row">
                              <strong>{{ a.first_name }} {{ a.last_name }}</strong>
                              <span class="status status-{{ a.status }}">{{ a.status?.replace('_', ' ') }}</span>
                              <span class="muted small">{{ a.due_date || '—' }}</span>
                              <span class="muted small">{{ a.completed_at || '—' }}</span>
                              <span class="muted small">{{ a.score ?? '—' }}</span>
                              <button class="ghost icon-btn danger" (click)="$event.stopPropagation(); unassign(a)" title="Remove this employee from the assignment">✕</button>
                            </div>
                          }
                        </div>
                      }
                    }
                  </div>
                }
              </div>
            }
          }
        } @else {
          <p class="muted small" style="padding: 24px;">Select a course on the left, or create one.</p>
        }
      </section>
    </div>
  `,
  styles: [`
    .toolbar { padding: 16px 20px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--line); }
    .toolbar h1 { margin: 0; font-size: 22px; }
    .spacer { flex: 1; }
    .layout { display: grid; grid-template-columns: 280px 1fr; min-height: calc(100vh - 120px); }
    .course-list { border-right: 1px solid var(--line); padding: 12px; display: flex; flex-direction: column; gap: 6px; overflow-y: auto; }
    .course-item {
      display: flex; flex-direction: column;
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
      overflow: hidden;
    }
    .course-item:hover { border-color: var(--primary); }
    .course-item.active { border-color: var(--primary); background: var(--bg-3); }
    .course-body {
      display: flex; flex-direction: column; gap: 2px;
      background: transparent; border: none; padding: 10px 12px;
      text-align: left; color: var(--fg); cursor: pointer; width: 100%;
    }
    .course-body:hover { background: var(--bg-3); border: none; }
    .course-toolbar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 6px 10px; border-top: 1px solid var(--line); background: rgba(0,0,0,0.2);
    }
    .toggle { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; margin: 0; padding: 0; text-transform: none; letter-spacing: normal; }
    .toggle input { position: absolute; opacity: 0; pointer-events: none; }
    .toggle-track {
      width: 32px; height: 18px; background: var(--bg-3); border: 1px solid var(--line);
      border-radius: 999px; position: relative; transition: background 0.15s, border-color 0.15s;
    }
    .toggle-thumb {
      position: absolute; top: 1px; left: 1px;
      width: 14px; height: 14px; border-radius: 50%;
      background: var(--muted); transition: left 0.15s, background 0.15s;
    }
    .toggle input:checked + .toggle-track { background: rgba(212,169,58,0.18); border-color: var(--primary); }
    .toggle input:checked + .toggle-track .toggle-thumb { left: 15px; background: var(--primary); }
    .toggle-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; }
    .toggle input:checked ~ .toggle-label { color: var(--primary); }
    .req-pill {
      padding: 1px 6px; border-radius: 4px; font-size: 10px;
      text-transform: uppercase; letter-spacing: 0.5px;
      background: rgba(212, 169, 58, 0.18); color: var(--primary);
    }
    .compl-pill {
      padding: 1px 6px; border-radius: 4px; font-size: 10px;
      text-transform: uppercase; letter-spacing: 0.5px;
      background: rgba(167, 139, 250, 0.18); color: #a78bfa;
    }
    .inactive-pill {
      padding: 1px 6px; border-radius: 4px; font-size: 10px;
      text-transform: uppercase; letter-spacing: 0.5px;
      background: var(--bg-3); color: var(--muted); border: 1px solid var(--line);
    }
    .course-item.inactive { opacity: 0.65; }
    .course-item.inactive:hover, .course-item.inactive.active { opacity: 1; }
    .course-detail { padding: 20px; }
    .tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--line); margin-bottom: 16px; }
    .tab {
      background: none; border: none; padding: 8px 14px; cursor: pointer;
      color: var(--muted); font-size: 13px; border-bottom: 2px solid transparent;
    }
    .tab.active { color: var(--primary); border-color: var(--primary); }
    .form-grid { display: grid; grid-template-columns: 160px 1fr; column-gap: 16px; row-gap: 10px; align-items: center; max-width: 720px; }
    .form-grid label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
    .check { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--fg); }
    h3.sec { font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; margin: 24px 0 10px; }
    .row { display: flex; align-items: center; gap: 8px; }
    .status {
      display: inline-block; padding: 2px 10px; border-radius: 999px;
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      border: 1px solid var(--line);
    }
    .status-not_started { color: var(--muted); }
    .status-in_progress { color: var(--primary); border-color: var(--primary); }
    .status-completed   { color: var(--primary); border-color: var(--primary); }
    .status-expired     { color: #ef4444; border-color: #ef4444; }
    .actions { text-align: right; }

    .module-layout { display: grid; grid-template-columns: 280px 1fr; gap: 18px; }
    .module-list { display: flex; flex-direction: column; gap: 4px; max-height: calc(100vh - 240px); overflow-y: auto; padding-right: 4px; }
    .add-row { display: flex; gap: 6px; margin-bottom: 10px; }
    .add-btn {
      flex: 1; padding: 6px 8px; font-size: 12px;
      background: var(--bg-3); border: 1px dashed var(--line); color: var(--fg);
      border-radius: var(--radius-sm); cursor: pointer;
    }
    .add-btn:hover { border-color: var(--primary); border-style: solid; color: var(--primary); }
    .mod-item {
      display: flex; align-items: center; justify-content: space-between;
      gap: 8px; background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
      padding: 8px 10px; text-align: left; color: var(--fg); cursor: pointer; font-size: 13px;
    }
    .mod-item:hover { border-color: var(--primary); }
    .mod-item.active { border-color: var(--primary); background: var(--bg-3); }
    .mod-item .ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 130px; }
    .mod-actions { opacity: 0.6; transition: opacity 0.15s; }
    .mod-item:hover .mod-actions, .mod-item.active .mod-actions { opacity: 1; }
    .mod-actions .icon-btn { background: var(--bg-3); border: 1px solid var(--line); padding: 2px 6px; }
    .kind-pill {
      padding: 1px 6px; border-radius: 4px; font-size: 10px;
      text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      border: 1px solid var(--line); color: var(--muted);
    }
    .kind-pill.kind-text  { color: #60a5fa; border-color: #60a5fa; }
    .kind-pill.kind-video { color: #a78bfa; border-color: #a78bfa; }
    .kind-pill.kind-quiz  { color: var(--primary); border-color: var(--primary); }

    .editor-card {
      background: var(--bg-3);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 18px;
    }
    .editor-card .form-grid {
      grid-template-columns: 1fr;
      max-width: none;
      row-gap: 6px;
    }
    .editor-card .form-grid > label { margin-top: 8px; }
    .check-row {
      display: flex; align-items: center; gap: 8px;
    }
    .check-row input[type="checkbox"] { width: 16px; height: 16px; flex: 0 0 16px; cursor: pointer; }
    .check-row label {
      margin: 0; cursor: pointer;
      color: var(--fg); font-size: 13px;
      text-transform: none; letter-spacing: normal;
    }
    .quiz-wrap { margin-top: 18px; padding-top: 18px; border-top: 1px solid var(--line); }
    .quiz { display: flex; flex-direction: column; gap: 10px; }
    .q-card {
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
      padding: 12px; display: flex; flex-direction: column; gap: 6px;
    }
    .q-num { color: var(--muted); font-weight: 700; min-width: 18px; }
    .q-prompt { flex: 1; font-weight: 500; }
    .opt-row { padding-left: 20px; }
    .ghost.small { padding: 4px 10px; font-size: 12px; }
    .icon-btn { padding: 4px 6px; min-width: 28px; }
    .icon-btn.danger { color: #ef4444; }
    .icon-btn.danger:hover { background: rgba(239, 68, 68, 0.1); }

    .assign-bar {
      background: var(--bg-3);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 14px 16px;
      margin-bottom: 14px;
      display: flex; flex-direction: column; gap: 12px;
    }
    .assign-fields { display: flex; gap: 12px; align-items: end; flex-wrap: wrap; }
    .assign-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 200px; }
    .assign-field label { margin: 0; }
    .assign-field.assign-date { flex: 0 0 220px; }
    .assign-row {
      display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
      padding-top: 10px; border-top: 1px solid var(--line);
    }
    .assign-row:first-of-type { border-top: none; padding-top: 0; }
    .assign-label {
      width: 130px;
      color: var(--muted); font-size: 12px;
      text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;
    }
    .assign-select { flex: 1; min-width: 220px; }

    .assign-list { display: flex; flex-direction: column; gap: 10px; }
    .assign-card {
      background: var(--bg-3); border: 1px solid var(--line); border-radius: var(--radius-sm);
      padding: 12px 14px; display: flex; flex-direction: column; gap: 8px;
    }
    .assign-card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .assign-card-body { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .assign-scope-pill {
      display: inline-block; padding: 2px 8px; border-radius: 4px;
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      border: 1px solid var(--line);
    }
    .assign-scope-pill.scope-company    { color: var(--primary); border-color: var(--primary); background: rgba(212,169,58,0.12); }
    .assign-scope-pill.scope-department { color: #a78bfa;        border-color: #a78bfa;        background: rgba(167,139,250,0.12); }
    .assign-scope-pill.scope-individual { color: var(--muted); }
    .assign-progress { height: 4px; background: var(--bg-2); border-radius: 999px; overflow: hidden; }
    .assign-progress-fill { height: 100%; background: var(--primary); transition: width 0.2s; }
    .assign-card-head.clickable { cursor: pointer; user-select: none; }
    .assign-card-head.clickable:hover { color: var(--primary); }
    .assign-card.expanded { border-color: var(--primary); }
    .caret { color: var(--muted); font-size: 11px; width: 12px; display: inline-block; }
    .assign-roster {
      margin-top: 6px; padding-top: 10px; border-top: 1px solid var(--line);
      display: flex; flex-direction: column; gap: 2px;
    }
    .roster-head, .roster-row {
      display: grid;
      grid-template-columns: 2fr 1fr 1fr 1fr 0.7fr 32px;
      gap: 8px; align-items: center;
      padding: 6px 4px;
    }
    .roster-head {
      color: var(--muted); font-size: 11px;
      text-transform: uppercase; letter-spacing: 0.5px;
      border-bottom: 1px solid var(--line); padding-bottom: 8px;
    }
    .roster-row { font-size: 13px; border-bottom: 1px solid var(--line); }
    .roster-row:last-child { border-bottom: none; }

    .blocks { display: flex; flex-direction: column; gap: 10px; }
    .block {
      background: var(--bg-2);
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      padding: 10px 12px;
      display: flex; flex-direction: column; gap: 8px;
    }
    .block-head { display: flex; align-items: center; gap: 6px; }
    .block-head .spacer { flex: 1; }
    .block-icon {
      background: var(--bg-3); border: 1px solid var(--line); color: var(--fg);
      padding: 2px 8px; border-radius: var(--radius-sm); cursor: pointer; font-size: 12px;
    }
    .block-icon:hover { border-color: var(--primary); }
    .block-icon.danger { color: #ef4444; }
    .block-icon.danger:hover { background: rgba(239,68,68,0.1); }
    .block-img { display: block; max-width: 100%; height: auto; border-radius: var(--radius-sm); border: 1px solid var(--line); }
    .block-alt { width: 100%; }
    .block-img-pick {
      display: flex; align-items: center; justify-content: center;
      border: 1px dashed var(--line); border-radius: var(--radius-sm);
      padding: 24px; cursor: pointer; color: var(--muted);
      font-size: 13px; text-transform: none; letter-spacing: normal; margin: 0;
    }
    .block-img-pick:hover { border-color: var(--primary); border-style: solid; color: var(--primary); }

    .img-strip {
      display: grid;
      grid-template-columns: repeat(auto-fill, 120px);
      gap: 8px;
      margin-bottom: 6px;
    }
    .img-tile, .img-add {
      box-sizing: border-box;
      width: 120px;
      height: 90px;
      border-radius: var(--radius-sm);
      overflow: hidden;
      background: var(--bg-2);
      margin: 0;
      padding: 0;
      text-transform: none;
      letter-spacing: normal;
      font-size: inherit;
      color: var(--muted);
    }
    .img-tile { position: relative; border: 1px solid var(--line); }
    .img-tile img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .img-add {
      display: flex; align-items: center; justify-content: center;
      border: 1px dashed var(--line);
      cursor: pointer;
      transition: border-color 0.15s, color 0.15s;
    }
    .img-add:hover { border-color: var(--primary); border-style: solid; color: var(--primary); }
    .img-add .plus { font-size: 32px; line-height: 1; font-weight: 300; }
    .img-x {
      position: absolute; top: 4px; right: 4px;
      background: rgba(0,0,0,0.7); color: #fff; border: none;
      width: 22px; height: 22px; border-radius: 50%; cursor: pointer; padding: 0;
      display: flex; align-items: center; justify-content: center; font-size: 12px;
    }
    .img-x:hover { background: #ef4444; }
  `],
})
export class HrLearning {
  private api = inject(Api);
  private router = inject(Router);

  courses = signal<HrCourse[]>([]);
  selectedId = signal<number | null>(null);
  assignments = signal<HrCourseAssignment[]>([]);
  employees = signal<HrEmployee[]>([]);
  modules = signal<HrCourseModule[]>([]);
  complianceTasks = signal<HrComplianceTask[]>([]);
  expandedGroup = signal<string | null>(null);
  selectedModuleId = signal<number | null>(null);
  tab = signal<'modules' | 'assignments' | 'settings'>('modules');
  draft = signal<DraftQuiz>({ questions: [] });
  slideDraft = signal<HrSlideBlock[]>([]);

  bulkEmployeeId: number = 0;
  bulkDueDate: string = '';
  bulkDepartment: string = '';

  selected = computed(() => this.courses().find(c => c.id === this.selectedId()) ?? null);
  selectedModule = computed(() => this.modules().find(m => m.id === this.selectedModuleId()) ?? null);

  unassignedEmployees = computed(() => {
    const ids = new Set(this.assignments().map(a => a.employee_id));
    return this.employees().filter(e => e.status !== 'terminated' && !ids.has(e.id!));
  });

  departments = computed(() => {
    const set = new Set<string>();
    for (const e of this.employees()) {
      if (e.status !== 'terminated' && e.department) set.add(e.department);
    }
    return [...set].sort();
  });

  countInDept(dept: string): number {
    if (!dept) return 0;
    return this.unassignedEmployees().filter(e => e.department === dept).length;
  }

  /**
   * Groups raw assignments by scope so department / company-wide assigns show as
   * a single row with aggregate stats instead of one row per employee.
   */
  groupedAssignments = computed(() => {
    const all = this.assignments();
    const groups: Array<{
      key: string;
      label: string;
      scope: 'individual' | 'department' | 'company';
      scopeValue: string | null;
      total: number;
      completed: number;
      inProgress: number;
      notStarted: number;
      assignments: HrCourseAssignment[];
    }> = [];

    const company = all.filter(a => a.assign_scope === 'company');
    if (company.length) groups.push(this.summarize('company', null, 'Company-wide', company));

    const byDept = new Map<string, HrCourseAssignment[]>();
    for (const a of all) {
      if (a.assign_scope === 'department' && a.assign_scope_value) {
        const list = byDept.get(a.assign_scope_value) ?? [];
        list.push(a);
        byDept.set(a.assign_scope_value, list);
      }
    }
    [...byDept.keys()].sort().forEach(dept => {
      groups.push(this.summarize('department', dept, `${dept} department`, byDept.get(dept)!));
    });

    const individuals = all.filter(a => (a.assign_scope ?? 'individual') === 'individual');
    individuals.sort((a, b) => (a.last_name || '').localeCompare(b.last_name || ''));
    for (const a of individuals) {
      groups.push({
        key: 'i' + a.id,
        label: `${a.first_name} ${a.last_name}`,
        scope: 'individual',
        scopeValue: null,
        total: 1,
        completed: a.status === 'completed' ? 1 : 0,
        inProgress: a.status === 'in_progress' ? 1 : 0,
        notStarted: a.status === 'not_started' ? 1 : 0,
        assignments: [a],
      });
    }
    return groups;
  });

  private summarize(scope: 'department'|'company', value: string | null, label: string, list: HrCourseAssignment[]) {
    return {
      key: scope + ':' + (value ?? ''),
      label,
      scope,
      scopeValue: value,
      total: list.length,
      completed: list.filter(a => a.status === 'completed').length,
      inProgress: list.filter(a => a.status === 'in_progress').length,
      notStarted: list.filter(a => a.status === 'not_started').length,
      assignments: list,
    };
  }

  ngOnInit() {
    this.refreshCourses();
    this.api.listHrEmployees().subscribe(r => this.employees.set(r.employees));
    this.api.listHrCompliance().subscribe(r => this.complianceTasks.set(r.tasks));
  }

  refreshCourses() {
    this.api.listHrCourses().subscribe(r => {
      this.courses.set(r.courses);
      if (this.selectedId() === null && r.courses.length > 0) this.select(r.courses[0]);
    });
  }
  select(c: HrCourse) {
    this.selectedId.set(c.id ?? null);
    this.selectedModuleId.set(null);
    if (c.id) {
      this.api.listHrCourseAssignments(c.id).subscribe(rr => this.assignments.set(rr.assignments));
      this.refreshModules(c.id);
    }
  }
  refreshModules(courseId: number, prefer?: number | null) {
    this.api.listHrCourseModules(courseId).subscribe(r => {
      this.modules.set(r.modules);
      const next = prefer ?? this.selectedModuleId() ?? r.modules[0]?.id ?? null;
      this.selectedModuleId.set(next);
      this.loadDraftFor(next);
    });
  }
  selectModule(m: HrCourseModule) {
    this.selectedModuleId.set(m.id ?? null);
    this.loadDraftFor(m.id ?? null);
  }
  loadDraftFor(moduleId: number | null) {
    const m = this.modules().find(x => x.id === moduleId);
    if (!m) { this.draft.set({ questions: [] }); this.slideDraft.set([]); return; }
    if (m.kind === 'quiz') {
      const parsed = m.quiz_json ? this.safeParse(m.quiz_json) : [];
      this.draft.set({
        questions: (parsed || []).map((q: any) => ({
          id: String(q.id ?? this.uid()),
          prompt: String(q.prompt ?? ''),
          options: Array.isArray(q.options) ? q.options.map(String) : ['', ''],
          correct: Array.isArray(q.correct) ? q.correct.map((n: any) => +n) : [],
        })),
      });
      this.slideDraft.set([]);
    } else if (m.kind === 'text') {
      const parsed = m.blocks_json ? this.safeParse(m.blocks_json) : [];
      this.slideDraft.set((parsed || []).map((b: any) => ({
        id: String(b.id ?? this.uid()),
        kind: (b.kind === 'image' || b.kind === 'video') ? b.kind : 'copy',
        body: typeof b.body === 'string' ? b.body : undefined,
        url:  typeof b.url  === 'string' ? b.url  : undefined,
        alt:  typeof b.alt  === 'string' ? b.alt  : undefined,
      })));
      this.draft.set({ questions: [] });
    } else {
      this.draft.set({ questions: [] });
      this.slideDraft.set([]);
    }
  }
  newCourse() {
    // Default to inactive so HR has to explicitly publish a course before learners see it.
    this.api.createHrCourse({ title: 'New course', is_active: 0 }).subscribe(r => {
      this.api.listHrCourses().subscribe(rr => {
        this.courses.set(rr.courses);
        const c = rr.courses.find(x => x.id === r.id);
        if (c) this.select(c);
      });
    });
  }
  toggleCourseActive(c: HrCourse, ev: Event) {
    ev.stopPropagation();
    if (!c.id) return;
    const next = (ev.target as HTMLInputElement).checked ? 1 : 0;
    this.api.updateHrCourse(c.id, { is_active: next }).subscribe(() => this.refreshCourses());
  }
  patch(p: Partial<HrCourse>) {
    const id = this.selectedId();
    if (!id) return;
    this.api.updateHrCourse(id, p).subscribe(() => this.refreshCourses());
  }
  delCourse(c: HrCourse) {
    if (!c.id) return;
    if (!confirm(`Delete "${c.title}"? All assignments and progress will be removed.`)) return;
    this.api.deleteHrCourse(c.id).subscribe(() => {
      this.selectedId.set(null);
      this.refreshCourses();
    });
  }
  addModule(kind: HrCourseModuleKind) {
    const id = this.selectedId();
    if (!id) return;
    const title = kind === 'quiz' ? 'New quiz' : kind === 'video' ? 'New video' : 'New slide';
    this.api.createHrCourseModule(id, { title, kind, pass_score: 100 }).subscribe(r => {
      this.refreshModules(id, r.id);
    });
  }
  kindLabel(kind: HrCourseModuleKind): string {
    return kind === 'text' ? 'slide' : kind;
  }
  saveModule(m: HrCourseModule) {
    const id = this.selectedId();
    if (!id || !m.id) return;
    const payload: any = {
      title: m.title,
      body: m.body ?? null,
      video_url: m.video_url ?? null,
      pass_score: m.pass_score ?? 100,
    };
    if (m.kind === 'quiz') {
      payload.quiz = this.draft().questions.map(q => ({
        id: q.id,
        prompt: q.prompt,
        options: q.options,
        correct: q.correct,
      }));
    }
    if (m.kind === 'text') {
      payload.blocks = this.slideDraft();
    }
    this.api.updateHrCourseModule(id, m.id, payload).subscribe(() => {
      // Mirror the saved blocks into the modules signal so the player snapshot stays consistent.
      if (m.kind === 'text' && m.id) {
        const json = JSON.stringify(this.slideDraft());
        this.modules.update(list => list.map(x => x.id === m.id ? { ...x, blocks_json: json } : x));
      }
    });
  }
  delModule(m: HrCourseModule, ev: Event) {
    ev.stopPropagation();
    const id = this.selectedId();
    if (!id || !m.id) return;
    if (!confirm(`Delete module "${m.title}"?`)) return;
    this.api.deleteHrCourseModule(id, m.id).subscribe(() => {
      this.selectedModuleId.set(null);
      this.refreshModules(id, null);
    });
  }
  moveModule(m: HrCourseModule, dir: -1 | 1, ev: Event) {
    ev.stopPropagation();
    const id = this.selectedId();
    if (!id || !m.id) return;
    const list = [...this.modules()];
    const i = list.findIndex(x => x.id === m.id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const a = list[i], b = list[j];
    const aOrder = a.sort_order ?? 0;
    const bOrder = b.sort_order ?? 0;
    this.api.updateHrCourseModule(id, a.id!, { sort_order: bOrder }).subscribe();
    this.api.updateHrCourseModule(id, b.id!, { sort_order: aOrder }).subscribe(() => this.refreshModules(id, m.id));
  }
  // Quiz draft mutations — operate on `draft()` and let saveModule push to the server.
  addQuestion() {
    const cur = this.draft();
    this.draft.set({ questions: [...cur.questions, { id: this.uid(), prompt: '', options: ['', ''], correct: [] }] });
  }
  removeQuestion(i: number) {
    const cur = this.draft();
    const next = [...cur.questions]; next.splice(i, 1);
    this.draft.set({ questions: next });
    const m = this.selectedModule();
    if (m) this.saveModule(m);
  }
  addOption(qi: number) {
    const cur = this.draft();
    const next = cur.questions.map((q, i) => i === qi ? { ...q, options: [...q.options, ''] } : q);
    this.draft.set({ questions: next });
  }
  removeOption(qi: number, oi: number) {
    const cur = this.draft();
    const next = cur.questions.map((q, i) => {
      if (i !== qi) return q;
      const options = [...q.options]; options.splice(oi, 1);
      const correct = q.correct.filter(x => x !== oi).map(x => x > oi ? x - 1 : x);
      return { ...q, options, correct };
    });
    this.draft.set({ questions: next });
  }
  toggleCorrect(qi: number, oi: number) {
    const cur = this.draft();
    const next = cur.questions.map((q, i) => {
      if (i !== qi) return q;
      const correct = q.correct.includes(oi) ? q.correct.filter(x => x !== oi) : [...q.correct, oi].sort((a, b) => a - b);
      return { ...q, correct };
    });
    this.draft.set({ questions: next });
  }
  assignOne() {
    const id = this.selectedId();
    if (!id || !this.bulkEmployeeId) return;
    this.api.assignHrCourse(id, [this.bulkEmployeeId], this.bulkDueDate || undefined, 'individual').subscribe(() => {
      this.bulkEmployeeId = 0;
      this.refreshAssignments(id);
    });
  }
  assignAll() {
    const id = this.selectedId();
    if (!id) return;
    const ids = this.unassignedEmployees().map(e => e.id!);
    if (ids.length === 0) return;
    if (!confirm(`Assign this course to ${ids.length} active employee${ids.length === 1 ? '' : 's'}?`)) return;
    this.api.assignHrCourse(id, ids, this.bulkDueDate || undefined, 'company').subscribe(() => {
      this.refreshAssignments(id);
    });
  }
  assignDepartment() {
    const id = this.selectedId();
    if (!id || !this.bulkDepartment) return;
    const ids = this.unassignedEmployees().filter(e => e.department === this.bulkDepartment).map(e => e.id!);
    if (ids.length === 0) return;
    if (!confirm(`Assign this course to ${ids.length} employee${ids.length === 1 ? '' : 's'} in ${this.bulkDepartment}?`)) return;
    this.api.assignHrCourse(id, ids, this.bulkDueDate || undefined, 'department', this.bulkDepartment).subscribe(() => {
      this.bulkDepartment = '';
      this.refreshAssignments(id);
    });
  }
  private refreshAssignments(courseId: number) {
    this.api.listHrCourseAssignments(courseId).subscribe(r => this.assignments.set(r.assignments));
    this.refreshCourses();
  }
  toggleGroup(key: string) {
    this.expandedGroup.set(this.expandedGroup() === key ? null : key);
  }
  unassignScope(scope: 'department'|'company', value?: string) {
    const id = this.selectedId();
    if (!id) return;
    const label = scope === 'company' ? 'company-wide assignment' : `${value} department assignment`;
    if (!confirm(`Remove this ${label}? All progress will be lost for the affected employees.`)) return;
    this.api.unassignHrCourseScope(id, scope, value).subscribe(() => this.refreshAssignments(id));
  }
  unassign(a: HrCourseAssignment) {
    if (!a.id) return;
    if (!confirm('Remove this assignment? Progress will be lost.')) return;
    this.api.deleteEmpHrLearning(a.employee_id, a.id).subscribe(() => {
      const id = this.selectedId();
      if (id) this.api.listHrCourseAssignments(id).subscribe(r => this.assignments.set(r.assignments));
      this.refreshCourses();
    });
  }
  // Slide-block management — backed by slideDraft signal so ngModel mutations stick.
  addBlock(m: HrCourseModule, kind: HrSlideBlockKind) {
    const next: HrSlideBlock = { id: this.uid(), kind };
    if (kind === 'copy')  next.body = '';
    if (kind === 'video') next.url = '';
    this.slideDraft.update(list => [...list, next]);
    this.saveModule(m);
  }
  removeBlock(m: HrCourseModule, idx: number) {
    if (!confirm('Remove this block?')) return;
    this.slideDraft.update(list => { const next = [...list]; next.splice(idx, 1); return next; });
    this.saveModule(m);
  }
  moveBlock(m: HrCourseModule, idx: number, dir: -1 | 1) {
    this.slideDraft.update(list => {
      const next = [...list];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return list;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
    this.saveModule(m);
  }
  uploadBlockImage(m: HrCourseModule, b: HrSlideBlock, ev: Event) {
    const inp = ev.target as HTMLInputElement;
    const file = inp.files?.[0];
    const cid = this.selectedId();
    if (!file || !cid || !m.id) return;
    this.api.uploadHrCourseSlideImage(cid, m.id, file).subscribe({
      next: r => {
        this.slideDraft.update(list => list.map(x => x.id === b.id ? { ...x, url: r.url } : x));
        this.saveModule(m);
        inp.value = '';
      },
      error: e => { alert(e?.error?.error || 'Upload failed'); inp.value = ''; },
    });
  }

  // Legacy: image strips on text modules (above/below) — kept for old data only.
  imagesAt(m: HrCourseModule, position: 'above' | 'below'): HrCourseModuleImage[] {
    return this.parseImages(m).filter(i => i.position === position);
  }
  parseImages(m: HrCourseModule): HrCourseModuleImage[] {
    if (!m.images_json) return [];
    try { const v = JSON.parse(m.images_json); return Array.isArray(v) ? v : []; } catch { return []; }
  }
  assetUrl(rel: string): string { return `${environment.basePath}/` + rel; }
  uploadImage(m: HrCourseModule, position: 'above' | 'below', ev: Event) {
    const inp = ev.target as HTMLInputElement;
    const file = inp.files?.[0];
    const cid = this.selectedId();
    if (!file || !cid || !m.id) return;
    this.api.uploadHrCourseModuleImage(cid, m.id, file, position).subscribe({
      next: r => {
        this.applyImages(m.id!, r.images);
        inp.value = '';
      },
      error: e => { alert(e?.error?.error || 'Upload failed'); inp.value = ''; },
    });
  }
  removeImage(m: HrCourseModule, img: HrCourseModuleImage) {
    const cid = this.selectedId();
    if (!cid || !m.id) return;
    const all = this.parseImages(m);
    const idx = all.findIndex(i => i.url === img.url);
    if (idx < 0) return;
    if (!confirm('Remove this image?')) return;
    this.api.deleteHrCourseModuleImage(cid, m.id, idx).subscribe(r => {
      this.applyImages(m.id!, r.images);
    });
  }
  private applyImages(moduleId: number, images: HrCourseModuleImage[]) {
    const json = JSON.stringify(images);
    this.modules.update(list => list.map(x => x.id === moduleId ? { ...x, images_json: json } : x));
  }

  private uid(): string { return 'q' + Math.random().toString(36).slice(2, 10); }
  private safeParse(s: string): any[] | null { try { const v = JSON.parse(s); return Array.isArray(v) ? v : null; } catch { return null; } }
}
