import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { Auth } from '../../core/auth';
import { AdminUserRecord, ServicePoolEntry, TaskItem, TaskItemState, TaskItemType, TaskIteration, TaskProject } from '../../core/models';
import { ComboBox, ComboOption } from '../../shared/combo-box';

type TabKey = 'backlog' | 'board' | 'sprints' | 'reports';

const FIB_POINTS = [0.5, 1, 2, 3, 5, 8, 13, 21];
const DAY_OPTIONS = [0.5, 1, 2, 3, 5, 8, 13];

/**
 * /tasks/taskboard/projects/:id
 *   • Backlog tab — sortable + filterable table
 *   • Board tab — kanban grouped by state, drag between columns
 *   • Right-side detail panel for editing a work item
 */
@Component({
  selector: 'app-tasks-project',
  imports: [RouterLink, FormsModule, ComboBox],
  template: `
    <div class="toolbar breadcrumb-bar">
      <a routerLink="/tasks/taskboard" class="crumb">Taskboard</a>
      <span class="sep">›</span>
      @if (project()?.team_name) { <span class="muted small">{{ project()?.team_name }}</span><span class="sep">›</span> }
      <h1>{{ project()?.name || 'Project' }}</h1>
      @if (project()?.client_id && project()?.client_name) {
        <a class="client-chip" [routerLink]="['/admin/clients', project()!.client_id]" title="Open client">
          ● {{ project()?.client_name }}
        </a>
      }
      @if (activeIteration(); as cur) {
        <span class="current-sprint" (click)="goToCurrentSprint()" title="Click to filter board by this sprint">
          <span class="pulse"></span> Current sprint: {{ cur.name }}
        </span>
      }
      <span class="spacer"></span>
      <button class="ghost" (click)="toggleClientPicker()" [title]="project()?.onboarding_client_id ? 'Change service' : 'Link a service'">
        @if (project()?.onboarding_client_id) { ✎ Service } @else { + Link service }
      </button>
      <button class="primary" (click)="newItem()">+ New work item</button>
    </div>

    @if (showClientPicker()) {
      <div class="client-picker-bar">
        <span class="muted small">Linked service:</span>
        <app-combo-box
          class="client-combo"
          [items]="serviceOptions()"
          [selectedValue]="project()?.onboarding_client_id ?? null"
          name="proj_service"
          placeholder="Search services — client, form, price…"
          (valueChange)="setProjectService($event)" />
        <button class="ghost" (click)="showClientPicker.set(false)">Done</button>
      </div>
    }

    <div class="tab-nav">
      @for (t of tabs; track t.key) {
        <button class="tab-btn" [class.active]="tab() === t.key" (click)="tab.set(t.key)">{{ t.label }}</button>
      }
    </div>

    <div class="content">
      @if (tab() === 'backlog') {
        <div class="filters">
          <input [value]="search()" (input)="search.set($any($event.target).value)" placeholder="Search title…" class="filter-input" />
          <select [ngModel]="filterType()" (ngModelChange)="filterType.set($event)" name="ft">
            <option [ngValue]="null">All types</option>
            @for (t of types(); track t.id) { <option [ngValue]="t.id">{{ t.name }}</option> }
          </select>
          <select [ngModel]="filterState()" (ngModelChange)="filterState.set($event)" name="fs">
            <option [ngValue]="null">All states</option>
            @for (s of states(); track s.id) { <option [ngValue]="s.id">{{ s.name }}</option> }
          </select>
          <select [ngModel]="filterAssignee()" (ngModelChange)="filterAssignee.set($event)" name="fa">
            <option [ngValue]="null">All assignees</option>
            <option [ngValue]="0">Unassigned</option>
            @for (u of users(); track u.id) { <option [ngValue]="u.id">{{ u.display_name }}</option> }
          </select>
        </div>

        @if (filteredItems().length === 0) {
          <div class="empty">
            <p class="muted">No items match.</p>
            <button class="primary" (click)="newItem()">+ New work item</button>
          </div>
        } @else {
          <div class="table-wrap">
            <table class="data items-table">
              <thead><tr>
                <th style="width: 40px;"></th>
                <th>ID</th>
                <th>Title</th>
                <th>State</th>
                <th>Priority</th>
                <th>Effort</th>
                <th>Assignee</th>
                <th></th>
              </tr></thead>
              <tbody>
                @for (it of filteredItems(); track it.id) {
                  <tr (click)="openItem(it)" [class.selected]="selectedId() === it.id">
                    <td><span class="type-chip" [style.background]="it.type_color || '#666'" [title]="it.type_name">{{ it.type_icon || '·' }}</span></td>
                    <td class="muted small">#{{ it.id }}</td>
                    <td><strong>{{ it.title }}</strong></td>
                    <td><span class="state-pill" [style.borderColor]="it.state_color">{{ it.state_name }}</span></td>
                    <td>P{{ it.priority }}</td>
                    <td class="muted small">{{ formatEffort(it) }}</td>
                    <td class="muted small">{{ it.assignee_name || '—' }}</td>
                    <td class="actions"><button class="ghost icon-btn danger" (click)="del(it, $event)" title="Delete">✕</button></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }

      @if (tab() === 'sprints') {
        <div class="sprints sprints-grid">
          <!-- LEFT: Backlog column -->
          <section class="iter-card backlog-card backlog-col"
                   [class.drag-over]="dragOverIterationId() === 'none'"
                   (dragover)="onDragOverIteration(null, $event)"
                   (drop)="dropOnIteration(null)">
            <header class="iter-head">
              <span class="iter-state state-planning">backlog</span>
              <h3 style="margin: 0;">Backlog</h3>
              <span class="spacer"></span>
              <span class="muted small">{{ itemsForIteration(null).length }} items</span>
            </header>
            @if (itemsForIteration(null).length === 0) {
              <div class="iter-empty muted small">Backlog is empty.</div>
            } @else {
              <div class="iter-items">
                @for (i of itemsForIteration(null); track i.id) {
                  <div class="iter-item" draggable="true" (dragstart)="onDragStart(i)" (dragend)="onDragEnd()" [class.dragging]="draggingId() === i.id" (click)="openItem(i)">
                    <span class="type-chip" [style.background]="i.type_color || '#666'">{{ i.type_icon || '·' }}</span>
                    <span class="muted small">#{{ i.id }}</span>
                    <span class="iter-item-title">{{ i.title }}</span>
                    <span class="state-pill" [style.borderColor]="i.state_color">{{ i.state_name }}</span>
                    <span class="muted small">{{ i.assignee_name ? initials(i.assignee_name) : '—' }}</span>
                    <span class="muted small effort">{{ formatEffort(i) }}</span>
                  </div>
                }
              </div>
            }
          </section>

          <!-- RIGHT: Iterations column -->
          <div class="sprints-right">
            <div class="sprint-toolbar">
              <h2>Iterations</h2>
              <span class="spacer"></span>
              <button class="primary" (click)="newIteration()">+ New iteration</button>
            </div>
            @if (iterations().length === 0) {
              <div class="empty">
                <p class="muted">No iterations yet. Create one to start planning a sprint.</p>
              </div>
            } @else {
              <div class="iter-list">
                @for (it of iterations(); track it.id) {
                <section class="iter-card"
                         [class.is-active]="it.state === 'active'"
                         [class.drag-over]="dragOverIterationId() === it.id"
                         (dragover)="onDragOverIteration(it.id!, $event)"
                         (drop)="dropOnIteration(it.id!)">
                  <header class="iter-head">
                    <input class="iter-name" [(ngModel)]="it.name" (blur)="patchIteration(it, { name: it.name })" name="in_{{ it.id }}" placeholder="Sprint name" />
                    <span class="iter-state state-{{ it.state }}">{{ it.state }}</span>
                  </header>
                  <div class="iter-controls">
                    <input type="date" class="date-input"
                           [(ngModel)]="it.start_date"
                           (change)="patchIteration(it, { start_date: it.start_date })"
                           (click)="openPicker($event)"
                           name="is_{{ it.id }}" />
                    <span class="muted small">→</span>
                    <input type="date" class="date-input"
                           [(ngModel)]="it.end_date"
                           (change)="patchIteration(it, { end_date: it.end_date })"
                           (click)="openPicker($event)"
                           name="ie_{{ it.id }}" />
                    <select class="state-select" [(ngModel)]="it.state" (ngModelChange)="patchIteration(it, { state: $event })" name="ist_{{ it.id }}">
                      <option value="planning">Planning</option>
                      <option value="active">Active</option>
                      <option value="closed">Closed</option>
                    </select>
                    <select class="state-select" [(ngModel)]="it.effort_mode" (ngModelChange)="patchIteration(it, { effort_mode: $event })" name="iem_{{ it.id }}" title="Effort unit for this sprint">
                      <option value="days">Days</option>
                      <option value="points">Points</option>
                    </select>
                    <button class="ghost icon-btn danger" (click)="delIteration(it)" title="Delete">✕</button>
                  </div>
                  <textarea class="iter-goal" [(ngModel)]="it.goal" (blur)="patchIteration(it, { goal: it.goal })" name="ig_{{ it.id }}" placeholder="Sprint goal" rows="1"></textarea>

                  <div class="iter-stats">
                    <span class="stat"><b>{{ itemsForIteration(it.id!).length }}</b> items</span>
                    <span class="stat"><b>{{ pointsForIteration(it.id!) }}</b> points</span>
                    <span class="stat"><b>{{ daysForIteration(it.id!) }}</b> days</span>
                    <span class="spacer"></span>
                    @if (capacityFor(it).length > 0) {
                      <span class="muted small">Capacity:</span>
                      @for (c of capacityFor(it); track c.uid) {
                        <span class="cap-chip"
                              [class.over]="c.assigned > c.cap"
                              [title]="c.name + ': ' + c.assigned + ' / ' + c.cap + ' days'">
                          {{ initials(c.name) }} {{ c.assigned }}/{{ c.cap }}
                        </span>
                      }
                    }
                  </div>

                  @if (itemsForIteration(it.id!).length === 0) {
                    <div class="iter-empty muted small">Drag a backlog item here, or assign from the side panel.</div>
                  } @else {
                    <div class="iter-items">
                      @for (i of itemsForIteration(it.id!); track i.id) {
                        <div class="iter-item" draggable="true" (dragstart)="onDragStart(i)" (dragend)="onDragEnd()" [class.dragging]="draggingId() === i.id" (click)="openItem(i)">
                          <span class="type-chip" [style.background]="i.type_color || '#666'">{{ i.type_icon || '·' }}</span>
                          <span class="muted small">#{{ i.id }}</span>
                          <span class="iter-item-title">{{ i.title }}</span>
                          <span class="state-pill" [style.borderColor]="i.state_color">{{ i.state_name }}</span>
                          <span class="muted small">{{ i.assignee_name ? initials(i.assignee_name) : '—' }}</span>
                          <span class="muted small effort">{{ formatEffort(i) }}</span>
                        </div>
                      }
                    </div>
                  }
                </section>
              }
              </div>
            }
          </div>
        </div>
      }

      @if (tab() === 'reports') {
        <div class="reports">
          <div class="report-grid">
            <div class="metric-card">
              <span class="metric-label">Total items</span>
              <span class="metric-value">{{ items().length }}</span>
            </div>
            <div class="metric-card">
              <span class="metric-label">Open</span>
              <span class="metric-value">{{ openCount() }}</span>
            </div>
            <div class="metric-card">
              <span class="metric-label">Closed</span>
              <span class="metric-value">{{ closedCount() }}</span>
            </div>
            <div class="metric-card">
              <span class="metric-label">% complete</span>
              <span class="metric-value">{{ pctComplete() }}%</span>
            </div>
          </div>

          <div class="report-section">
            <h3>Items by state</h3>
            <div class="bar-list">
              @for (s of states(); track s.id) {
                @if ((countsByState().get(s.id!) ?? 0) > 0) {
                  <div class="bar-row">
                    <span class="bar-label">{{ s.name }}</span>
                    <div class="bar-track">
                      <div class="bar-fill" [style.width.%]="pct(countsByState().get(s.id!) ?? 0, items().length)" [style.background]="s.color || 'var(--primary)'"></div>
                    </div>
                    <span class="bar-count">{{ countsByState().get(s.id!) ?? 0 }}</span>
                  </div>
                }
              }
            </div>
          </div>

          <div class="report-section">
            <h3>Items by type</h3>
            <div class="bar-list">
              @for (t of types(); track t.id) {
                @if ((countsByType().get(t.id!) ?? 0) > 0) {
                  <div class="bar-row">
                    <span class="bar-label">
                      <span class="type-chip" [style.background]="t.color || '#666'">{{ t.icon || '·' }}</span>
                      {{ t.name }}
                    </span>
                    <div class="bar-track">
                      <div class="bar-fill" [style.width.%]="pct(countsByType().get(t.id!) ?? 0, items().length)" [style.background]="t.color || 'var(--primary)'"></div>
                    </div>
                    <span class="bar-count">{{ countsByType().get(t.id!) ?? 0 }}</span>
                  </div>
                }
              }
            </div>
          </div>

          <div class="report-section">
            <h3>Velocity by iteration</h3>
            @if (velocityRows().length === 0) {
              <p class="muted small">No closed work in any iteration yet.</p>
            } @else {
              <div class="bar-list">
                @for (v of velocityRows(); track v.id) {
                  <div class="bar-row">
                    <span class="bar-label">{{ v.name }}</span>
                    <div class="bar-track">
                      <div class="bar-fill" [style.width.%]="pct(v.completed, v.planned || v.completed || 1)"></div>
                    </div>
                    <span class="bar-count">{{ v.completed }} / {{ v.planned }}</span>
                  </div>
                }
              </div>
            }
          </div>

          <div class="report-section">
            <h3>Workload by assignee</h3>
            @if (workloadRows().length === 0) {
              <p class="muted small">Nobody is currently assigned an open item.</p>
            } @else {
              <div class="bar-list">
                @for (w of workloadRows(); track w.uid) {
                  <div class="bar-row">
                    <span class="bar-label">
                      <span class="assignee">{{ initials(w.name) }}</span>
                      {{ w.name }}
                    </span>
                    <div class="bar-track">
                      <div class="bar-fill" [style.width.%]="pct(w.open, maxWorkload())"></div>
                    </div>
                    <span class="bar-count">{{ w.open }} open</span>
                  </div>
                }
              </div>
            }
          </div>
        </div>
      }

      @if (tab() === 'board') {
        <div class="board-wrap">
        <div class="board-toolbar">
          <label class="muted small">Sprint</label>
          <select [ngModel]="boardIteration()" (ngModelChange)="boardIteration.set($event)" name="bsp">
            <option [ngValue]="'all'">All sprints</option>
            <option [ngValue]="null">Backlog (no sprint)</option>
            @for (i of iterations(); track i.id) {
              <option [ngValue]="i.id">{{ i.name }}@if (i.state === 'active') { · active }</option>
            }
          </select>
          <span class="muted small">{{ boardItems().length }} items</span>
        </div>
        <div class="board-heads">
          @for (s of boardStates(); track s.id) {
            <div class="col-head dark-head">
              <span class="state-pill" [style.borderColor]="s.color">{{ s.name }}</span>
              <span class="muted small">{{ boardItemsByState().get(s.id!)?.length ?? 0 }}</span>
            </div>
          }
        </div>
        <div class="board-canvas">
        <div class="board" (dragover)="$event.preventDefault()">
          @for (s of boardStates(); track s.id) {
            <div class="board-col"
                 [class.drag-over]="dragOverStateId() === s.id"
                 (dragover)="onDragOverState(s.id!, $event)"
                 (drop)="dropOnState(s.id!)">
              <div class="col-list">
                @for (it of boardItemsByState().get(s.id!) ?? []; track it.id) {
                  <div class="card-item"
                       draggable="true"
                       (dragstart)="onDragStart(it)"
                       (dragend)="onDragEnd()"
                       (dragover)="onDragOverCard(it.id!, $event)"
                       (click)="openItem(it)"
                       [class.selected]="selectedId() === it.id"
                       [class.dragging]="draggingId() === it.id"
                       [class.drop-above]="dragOverCardId() === it.id && dragOverPosition() === 'above'"
                       [class.drop-below]="dragOverCardId() === it.id && dragOverPosition() === 'below'">
                    <div class="card-head">
                      <span class="type-chip" [style.background]="it.type_color || '#666'">{{ it.type_icon || '·' }}</span>
                      <span class="muted small">#{{ it.id }}</span>
                    </div>
                    <div class="card-title">{{ it.title }}</div>
                    @if (it.description) {
                      <div class="card-desc">{{ it.description }}</div>
                    } @else {
                      <div class="card-desc card-desc--empty muted small">No description</div>
                    }
                    <div class="card-meta">
                      @if (it.assignee_name) { <span class="assignee">{{ initials(it.assignee_name) }}</span> }
                      <span class="spacer"></span>
                      @if (it.story_points || it.effort_days) { <span class="muted small">{{ formatEffort(it) }}</span> }
                    </div>
                  </div>
                }
                @if (!(itemsByState().get(s.id!)?.length)) {
                  <div class="col-empty muted small">Drop here</div>
                }
              </div>
            </div>
          }
        </div>
        </div>
        </div>
      }
    </div>

    <!-- Item detail side panel -->
    @if (panelItem(); as it) {
      <div class="panel-backdrop" (click)="closePanel()"></div>
      <aside class="item-panel">
        <header>
          <span class="type-chip" [style.background]="it.type_color || '#666'">{{ it.type_icon || '·' }}</span>
          @if (isDraft()) {
            <span class="muted small">New work item</span>
            <span class="spacer"></span>
            <button class="primary" (click)="confirmDraft()" [disabled]="creating()">
              {{ creating() ? 'Creating…' : 'Create' }}
            </button>
            <button class="ghost icon-btn" (click)="cancelDraft()" title="Cancel">×</button>
          } @else {
            <span class="muted small">#{{ it.id }}</span>
            <span class="spacer"></span>
            @if (panelMode() === 'edit') {
              <button class="primary" (click)="toggleEdit()">Done</button>
              <button class="ghost" (click)="toggleEdit()">Cancel</button>
            } @else {
              <button class="ghost" (click)="toggleEdit()">✎ Edit</button>
              <button class="ghost icon-btn" (click)="closePanel()" title="Close">×</button>
            }
          }
        </header>

        <div class="panel-body">
          @if (parentOf(it); as par) {
            <div class="parent-crumb" (click)="openItem(par)">
              <span class="muted small">Parent</span>
              <span class="type-chip" [style.background]="par.type_color || '#666'">{{ par.type_icon || '·' }}</span>
              <span class="muted small">#{{ par.id }}</span>
              <span class="par-title">{{ par.title }}</span>
            </div>
          }

          @if (inEditMode()) {
            <!-- ─── EDIT VIEW ─── -->
            @if (isDraft()) {
              <input class="title-input"
                     [value]="draftTitle()"
                     (input)="draftTitle.set($any($event.target).value)"
                     placeholder="Title (required)" />
              @if (draftError()) {
                <div class="error-msg" style="margin: -8px 0 12px 10px;">{{ draftError() }}</div>
              }
            } @else {
              <input class="title-input" [(ngModel)]="it.title" (blur)="patch(it, { title: it.title })" name="dt" placeholder="Title" />
            }

            <div class="kv-grid">
              <label>Type</label>
              <select [(ngModel)]="it.type_id" (ngModelChange)="patch(it, { type_id: $event })" name="dty">
                @for (t of types(); track t.id) { <option [ngValue]="t.id">{{ t.name }}</option> }
              </select>

              <label>State</label>
              <select [(ngModel)]="it.state_id" (ngModelChange)="patch(it, { state_id: $event })" name="dst">
                @for (s of states(); track s.id) { <option [ngValue]="s.id">{{ s.name }}</option> }
              </select>

              <label>Parent</label>
              <select [(ngModel)]="it.parent_id" (ngModelChange)="patch(it, { parent_id: $event })" name="dpa">
                <option [ngValue]="null">None</option>
                @for (p of parentChoices(it); track p.id) { <option [ngValue]="p.id">#{{ p.id }} · {{ p.title }}</option> }
              </select>

              <label>Iteration</label>
              <select [(ngModel)]="it.iteration_id" (ngModelChange)="patch(it, { iteration_id: $event })" name="dit">
                <option [ngValue]="null">Backlog</option>
                @for (i of iterations(); track i.id) { <option [ngValue]="i.id">{{ i.name }}</option> }
              </select>

              <label>Assignee</label>
              <select [(ngModel)]="it.assigned_to" (ngModelChange)="patch(it, { assigned_to: $event })" name="das">
                <option [ngValue]="null">— unassigned —</option>
                @for (u of users(); track u.id) { <option [ngValue]="u.id">{{ u.display_name }}</option> }
              </select>

              <label>Priority</label>
              <select [(ngModel)]="it.priority" (ngModelChange)="patch(it, { priority: $event })" name="dpr">
                <option [ngValue]="1">P1 — critical</option>
                <option [ngValue]="2">P2 — high</option>
                <option [ngValue]="3">P3 — medium</option>
                <option [ngValue]="4">P4 — low</option>
              </select>

              @if (effortModeFor(it) === 'points') {
                <label>Story points</label>
                <select [(ngModel)]="it.story_points" (ngModelChange)="patch(it, { story_points: $event, effort_mode: 'points' })" name="dsp">
                  <option [ngValue]="null">—</option>
                  @for (p of fibPoints; track p) { <option [ngValue]="p">{{ p }}</option> }
                </select>
              } @else {
                <label>Days</label>
                <select [(ngModel)]="it.effort_days" (ngModelChange)="patch(it, { effort_days: $event, effort_mode: 'days' })" name="dde">
                  <option [ngValue]="null">—</option>
                  @for (d of dayOptions; track d) { <option [ngValue]="d">{{ formatDay(d) }}</option> }
                </select>
              }
            </div>

            <h4 class="sec">Description</h4>
            <textarea [(ngModel)]="it.description" (blur)="patch(it, { description: it.description })" name="dde2" rows="5" placeholder="What needs to be done?"></textarea>

            <h4 class="sec">Acceptance criteria</h4>
            <textarea [(ngModel)]="it.acceptance_criteria" (blur)="patch(it, { acceptance_criteria: it.acceptance_criteria })" name="dac" rows="4" placeholder="How will we know it's done?"></textarea>
          } @else {
            <!-- ─── DISPLAY VIEW ─── -->
            <h2 class="display-title">{{ it.title }}</h2>

            <div class="kv-grid kv-display">
              <label>Type</label>
              <div class="kv-val">
                <span class="type-chip" [style.background]="it.type_color || '#666'">{{ it.type_icon || '·' }}</span>
                {{ it.type_name }}
              </div>

              <label>State</label>
              <div class="kv-val">
                <span class="state-pill" [style.borderColor]="it.state_color">{{ it.state_name }}</span>
              </div>

              <label>Parent</label>
              <div class="kv-val">
                @if (parentOf(it); as par) {
                  <a class="link" (click)="openItem(par)">#{{ par.id }} · {{ par.title }}</a>
                } @else { None }
              </div>

              <label>Iteration</label>
              <div class="kv-val">{{ iterationName(it.iteration_id) || 'Backlog' }}</div>

              <label>Assignee</label>
              <div class="kv-val assignee-cell">
                <button class="assignee-trigger" (click)="openAssigneePicker()">
                  {{ it.assignee_name || 'Unassigned' }}
                  <span class="caret">▾</span>
                </button>
                @if (assigneePickerOpen()) {
                  <div class="picker-backdrop" (click)="closeAssigneePicker()"></div>
                  <div class="picker-pop" (click)="$event.stopPropagation()">
                    <input class="picker-search"
                           [value]="assigneeQuery()"
                           (input)="assigneeQuery.set($any($event.target).value)"
                           placeholder="Search team…"
                           autofocus />
                    <div class="picker-list">
                      @if (currentUser() && it.assigned_to !== currentUser()!.id) {
                        <button class="picker-opt assign-self" (click)="setAssignee(it, currentUser()!.id)">
                          <span class="assignee-pill">{{ initials(currentUser()!.display_name) }}</span>
                          <span class="picker-name">Assign to me</span>
                          <span class="muted small picker-email">{{ currentUser()!.display_name }}</span>
                        </button>
                      }
                      <button class="picker-opt" [class.selected]="!it.assigned_to" (click)="setAssignee(it, null)">
                        <span class="assignee-pill unassigned">—</span>
                        Unassigned
                      </button>
                      @for (u of assigneeMatches(); track u.id) {
                        <button class="picker-opt" [class.selected]="it.assigned_to === u.id" (click)="setAssignee(it, u.id!)">
                          <span class="assignee-pill">{{ initials(u.display_name) }}</span>
                          <span class="picker-name">{{ u.display_name }}</span>
                          @if (u.email) { <span class="muted small picker-email">{{ u.email }}</span> }
                        </button>
                      }
                      @if (assigneeMatches().length === 0) {
                        <div class="picker-empty muted small">No matches</div>
                      }
                    </div>
                  </div>
                }
              </div>

              <label>Priority</label>
              <div class="kv-val">{{ priorityLabel(it.priority) }}</div>

              <label>Effort</label>
              <div class="kv-val">{{ formatEffort(it) }}</div>
            </div>

            <h4 class="sec">Description</h4>
            @if (it.description) {
              <p class="display-text">{{ it.description }}</p>
            } @else {
              <p class="muted small">— no description —</p>
            }

            <h4 class="sec">Acceptance criteria</h4>
            @if (it.acceptance_criteria) {
              <p class="display-text">{{ it.acceptance_criteria }}</p>
            } @else {
              <p class="muted small">— no criteria —</p>
            }
          }

          @if (childrenOf(it.id!).length > 0) {
            <h4 class="sec">Children ({{ childrenOf(it.id!).length }})</h4>
            <div class="child-list">
              @for (c of childrenOf(it.id!); track c.id) {
                <div class="child-row" (click)="openItem(c)">
                  <span class="type-chip" [style.background]="c.type_color || '#666'">{{ c.type_icon || '·' }}</span>
                  <span class="muted small">#{{ c.id }}</span>
                  <span class="child-title">{{ c.title }}</span>
                  <span class="state-pill" [style.borderColor]="c.state_color">{{ c.state_name }}</span>
                </div>
              }
            </div>
          }

          @if (it.created_at) {
            <div class="muted small ts">
              Created {{ it.created_at }}@if (it.updated_at && it.updated_at !== it.created_at) { · updated {{ it.updated_at }} }
              @if (it.closed_at) { · closed {{ it.closed_at }} }
            </div>
          }

          @if (!isDraft() && panelMode() === 'edit') {
            <div class="danger-zone">
              <button class="ghost danger" (click)="del(it)">✕ Delete this work item</button>
            </div>
          }
        </div>
      </aside>
    }
  `,
  styles: [`
    .breadcrumb-bar .crumb { color: var(--muted); font-size: 13px; text-decoration: none; }
    .breadcrumb-bar .crumb:hover { color: var(--primary); }
    .breadcrumb-bar .sep { color: var(--muted); font-size: 14px; }
    .breadcrumb-bar h1 { margin: 0; }
    /* Client chip in the project header — clickable link to the client profile. */
    .client-chip {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 4px 10px; margin-left: 8px;
      border: 1px solid var(--line); border-radius: 999px;
      background: var(--bg-2); color: var(--fg);
      font-size: 12px; text-decoration: none;
    }
    .client-chip:hover { border-color: var(--primary); color: var(--primary); }
    .client-picker-bar {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 24px;
      border-bottom: 1px solid var(--line);
      background: var(--bg-2);
    }
    .client-picker-bar .client-combo { flex: 1; max-width: 480px; }
    .current-sprint {
      display: inline-flex; align-items: center; gap: 6px;
      margin-left: 12px;
      padding: 4px 10px;
      border-radius: 999px;
      background: rgba(212, 169, 58, 0.15);
      border: 1px solid var(--primary);
      color: var(--primary);
      font-size: 12px; font-weight: 600;
      cursor: pointer;
    }
    .current-sprint:hover { background: rgba(212, 169, 58, 0.25); }
    .current-sprint .pulse {
      width: 8px; height: 8px; border-radius: 50%;
      background: var(--primary);
      box-shadow: 0 0 0 0 var(--primary);
      animation: pulse 1.8s infinite;
    }
    @keyframes pulse {
      0%   { box-shadow: 0 0 0 0 rgba(212, 169, 58, 0.6); }
      70%  { box-shadow: 0 0 0 8px rgba(212, 169, 58, 0); }
      100% { box-shadow: 0 0 0 0 rgba(212, 169, 58, 0); }
    }

    .tab-nav { display: flex; gap: 4px; border-bottom: 1px solid var(--line); padding: 0 24px; }
    .tab-btn { padding: 14px 20px; background: none; border: none; color: var(--muted); cursor: pointer; font-size: 13px; position: relative; transition: color 0.15s; }
    .tab-btn:hover { color: var(--primary); background: transparent; border-color: transparent; }
    .tab-btn.active { color: var(--primary); }
    .tab-btn.active::after { content: ''; position: absolute; bottom: -1px; left: 0; right: 0; height: 2px; background: var(--primary); }

    .content { padding: 16px 24px 32px; }

    .filters { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: nowrap; align-items: center; }
    .filters .filter-input { flex: 2 1 200px; min-width: 0; width: auto; }
    .filters select { flex: 1 1 140px; min-width: 0; width: auto; }
    @media (max-width: 720px) {
      .filters { flex-wrap: wrap; }
      .filters .filter-input,
      .filters select { flex-basis: 100%; }
    }

    .items-table tr { cursor: pointer; }
    .items-table tr.selected { outline: 1px solid var(--primary); }
    .items-table td.actions { text-align: right; }
    .type-chip {
      display: inline-flex; align-items: center; justify-content: center;
      width: 22px; height: 22px;
      border-radius: var(--radius-sm);
      background: var(--bg-3) !important;
      color: var(--muted);
      border: 1px solid var(--line);
      font-weight: 700; font-size: 11px;
      flex-shrink: 0;
    }
    .state-pill {
      display: inline-block;
      padding: 2px 10px;
      border: 1px solid var(--muted);
      border-radius: 999px;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--fg);
      background: transparent;
    }

    /* Board */
    .board-wrap {
      background: #000;
      /* offset .content's 16px 24px 32px padding so the band bleeds edge-to-edge */
      margin: -16px -24px -32px;
      padding: 20px 24px 32px;
      min-height: calc(100vh - 180px);
    }
    .board-heads {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 14px;
      margin-top: 16px;
    }
    .board-heads .dark-head {
      padding: 12px 14px;
      display: flex; align-items: center; gap: 8px;
      border: 0;
      background: transparent;
      color: var(--fg);
    }
    .board-canvas {
      background: #ffffff;
      border-radius: var(--radius);
      padding: 20px;
      margin-top: 0;
    }
    .board-toolbar {
      display: flex; align-items: center; gap: 10px;
      margin-bottom: 16px;
      padding: 14px 18px;
      background: var(--bg-2);
      border: 1px solid var(--line);
      border-radius: var(--radius);
    }
    .board-toolbar select {
      width: 320px;
      flex: 0 0 auto;
      background: var(--bg-3);
      border: 1px solid var(--muted);
    }
    .board-toolbar select:hover,
    .board-toolbar select:focus { border-color: var(--primary); }
    .board-toolbar > .muted { white-space: nowrap; }
    .board {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 14px;
      align-items: stretch;
    }
    .board-col {
      background: #ffffff;
      border: 1px solid #d4d4d4;
      border-radius: var(--radius);
      min-height: 420px;
      display: flex; flex-direction: column;
      transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;
    }
    .board-col:hover { background: #ececec; }
    .board-col.drag-over {
      background: #ececec;
      border-color: var(--primary);
      box-shadow: inset 0 0 0 1px var(--primary), 0 0 0 4px rgba(212, 169, 58, 0.12);
    }
    .board-col.drag-over .col-empty {
      border-color: var(--primary);
      color: var(--primary);
      background: rgba(212, 169, 58, 0.08);
    }
    .col-head {
      padding: 12px 14px;
      display: flex; align-items: center; gap: 8px;
    }
    .board-col .col-head { display: none; }
    .col-list { padding: 10px; display: flex; flex-direction: column; gap: 8px; flex: 1; }
    .col-empty {
      border: 0;
      padding: 20px;
      text-align: center;
      color: #777;
      flex: 1;
    }
    .card-item {
      background: var(--bg-3);
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      padding: 10px 12px;
      cursor: grab;
      transition: border-color 0.15s, transform 0.15s;
      height: 180px;
      display: flex; flex-direction: column;
    }
    .card-item:hover { border-color: var(--primary); }
    .card-item.selected { outline: 1px solid var(--primary); }
    .card-item.dragging { opacity: 0.35; transform: scale(0.98); border-style: dashed; }
    .card-item { position: relative; }
    .card-item.drop-above::before,
    .card-item.drop-below::after {
      content: '';
      position: absolute;
      left: 0; right: 0;
      height: 4px;
      background: var(--primary);
      border-radius: 2px;
      box-shadow: 0 0 12px rgba(212, 169, 58, 0.7), 0 0 0 3px rgba(212, 169, 58, 0.18);
      pointer-events: none;
      z-index: 5;
      animation: drop-line-pulse 1s ease-in-out infinite alternate;
    }
    .card-item.drop-above::before { top: -6px; }
    .card-item.drop-below::after  { bottom: -6px; }
    @keyframes drop-line-pulse {
      from { box-shadow: 0 0 12px rgba(212, 169, 58, 0.7), 0 0 0 3px rgba(212, 169, 58, 0.18); }
      to   { box-shadow: 0 0 18px rgba(212, 169, 58, 1.0), 0 0 0 5px rgba(212, 169, 58, 0.28); }
    }
    .card-item:active { cursor: grabbing; }
    .card-head { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
    .card-title {
      font-size: 14px; line-height: 1.4; margin-bottom: 6px;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      flex-shrink: 0;
    }
    .card-desc {
      font-size: 12px; line-height: 1.45;
      color: var(--muted);
      margin-bottom: 8px;
      flex: 1;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
      white-space: pre-wrap;
    }
    .card-desc--empty { font-style: italic; opacity: 0.55; }
    .card-meta { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
    .assignee {
      display: inline-flex; align-items: center; justify-content: center;
      width: 22px; height: 22px;
      background: var(--primary); color: #0a0a0a;
      border-radius: 50%;
      font-size: 10px; font-weight: 700;
    }

    /* Side panel */
    .panel-backdrop {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.5);
      z-index: 100;
    }
    .item-panel {
      position: fixed; top: 0; right: 0; bottom: 0;
      width: min(560px, 95vw);
      background: var(--bg-2);
      border-left: 1px solid var(--line);
      box-shadow: var(--shadow);
      z-index: 101;
      display: flex; flex-direction: column;
      animation: slide 0.25s ease-out;
    }
    @keyframes slide { from { transform: translateX(100%); } to { transform: translateX(0); } }
    .item-panel header {
      padding: 14px 16px;
      border-bottom: 1px solid var(--line);
      display: flex; align-items: center; gap: 8px;
    }
    .item-panel .panel-body { flex: 1; overflow-y: auto; padding: 16px; }
    .title-input {
      font-size: 18px; font-weight: 600;
      background: transparent; border: 1px solid transparent; padding: 8px 10px;
      width: 100%; margin-bottom: 16px;
    }
    .title-input:focus { border-color: var(--line); background: var(--bg-3); }
    .kv-grid { display: grid; grid-template-columns: 130px 1fr; gap: 10px 12px; align-items: center; }
    .kv-grid label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin: 0; }
    h4.sec { margin: 24px 0 8px 0; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; }
    .ts { margin-top: 16px; }

    /* Display mode */
    .display-title { margin: 0 0 16px 0; font-size: 22px; font-weight: 600; }
    .kv-display label { padding: 6px 0; }
    .kv-val { display: flex; align-items: center; gap: 8px; padding: 6px 0; font-size: 14px; }
    .kv-val .link { color: var(--primary); cursor: pointer; }
    .kv-val .link:hover { text-decoration: underline; }
    .display-text {
      white-space: pre-wrap;
      line-height: 1.55;
      margin: 0 0 8px 0;
      padding: 10px 12px;
      background: var(--bg-3);
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
    }

    /* Inline assignee picker */
    .assignee-cell { position: relative; padding: 0; }
    .assignee-trigger {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 0;
      margin: 0;
      background: transparent;
      border: 0;
      color: var(--fg);
      font: inherit;
      font-size: 14px;
      cursor: pointer;
    }
    .assignee-trigger:hover { color: var(--primary); background: transparent; }
    .assignee-trigger .caret { color: var(--muted); font-size: 11px; margin-left: 2px; }
    .picker-backdrop {
      position: fixed; inset: 0;
      background: transparent;
      z-index: 200;
    }
    .picker-pop {
      position: absolute;
      top: calc(100% + 4px); left: 0;
      width: 280px;
      background: var(--bg-2);
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      box-shadow: var(--shadow);
      z-index: 201;
      display: flex; flex-direction: column;
      max-height: 320px;
    }
    .picker-search {
      width: 100%; padding: 8px 10px;
      border: 0; border-bottom: 1px solid var(--line);
      background: var(--bg-3); color: var(--fg);
      border-radius: var(--radius-sm) var(--radius-sm) 0 0;
      font-size: 13px;
      outline: none;
    }
    .picker-list { overflow-y: auto; padding: 4px; }
    .picker-opt {
      display: flex; align-items: center; gap: 8px; width: 100%;
      padding: 8px 10px;
      background: transparent; border: 0; border-radius: var(--radius-sm);
      color: var(--fg); text-align: left; cursor: pointer;
      font-size: 13px;
    }
    .picker-opt:hover { background: var(--bg-3); }
    .picker-opt.selected { background: var(--bg-3); color: var(--primary); }
    .picker-opt.assign-self {
      color: var(--primary);
      border-bottom: 1px solid var(--line);
      margin-bottom: 4px; padding-bottom: 10px;
      border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    }
    .picker-opt .picker-name { flex: 1; }
    .picker-opt .picker-email { font-size: 11px; }
    .picker-empty { padding: 12px; text-align: center; }
    .assignee-pill {
      display: inline-flex; align-items: center; justify-content: center;
      width: 22px; height: 22px;
      background: var(--primary); color: #0a0a0a;
      border-radius: 50%;
      font-size: 10px; font-weight: 700;
      flex-shrink: 0;
    }
    .assignee-pill.unassigned { background: var(--bg-3); color: var(--muted); border: 1px solid var(--line); }

    .danger-zone {
      margin-top: 32px;
      padding-top: 16px;
      border-top: 1px solid var(--line);
      display: flex;
    }
    .danger-zone .ghost.danger {
      color: var(--muted);
      border: 1px solid var(--line);
      background: transparent;
      padding: 8px 14px;
      transition: color 0.15s, border-color 0.15s, background 0.15s;
    }
    .danger-zone .ghost.danger:hover {
      color: #ef4444;
      border-color: #ef4444;
      background: rgba(239, 68, 68, 0.08);
    }

    .parent-crumb {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 10px; margin-bottom: 12px;
      background: var(--bg-3); border: 1px solid var(--line); border-radius: var(--radius-sm);
      cursor: pointer; transition: border-color 0.15s;
    }
    .parent-crumb:hover { border-color: var(--primary); }
    .parent-crumb .par-title { font-size: 13px; }

    .child-list { display: flex; flex-direction: column; gap: 6px; }
    .child-row {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 10px;
      background: var(--bg-3); border: 1px solid var(--line); border-radius: var(--radius-sm);
      cursor: pointer; transition: border-color 0.15s;
    }
    .child-row:hover { border-color: var(--primary); }
    .child-row .child-title { font-size: 13px; flex: 1; }

    /* Sprints */
    .sprint-toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
    .sprint-toolbar h2 { margin: 0; font-size: 18px; }
    .sprints {
      background: #ffffff;
      border-radius: var(--radius);
      padding: 20px;
    }
    .sprints-grid {
      display: grid;
      grid-template-columns: minmax(320px, 1fr) minmax(0, 2fr);
      gap: 20px;
      align-items: start;
    }
    .sprints-right { display: flex; flex-direction: column; }
    .backlog-col { position: sticky; top: 12px; }
    @media (max-width: 900px) {
      .sprints-grid { grid-template-columns: 1fr; }
      .backlog-col { position: static; }
    }
    .sprints .sprint-toolbar h2 { color: #0a0a0a; }
    .sprints .sprint-toolbar .muted { color: #555 !important; }
    .sprints .empty .muted { color: #555 !important; }
    /* iter-cards (filled, dark) keep the dark theme palette */
    .sprints .iter-card { color: var(--fg); }
    .iter-list { display: flex; flex-direction: column; gap: 16px; }
    .iter-card {
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius);
      padding: 14px;
    }
    .iter-card.backlog-card { background: var(--bg-2); border-style: dashed; }
    .iter-card.is-active {
      border-color: var(--primary);
      box-shadow: 0 0 0 1px var(--primary), 0 4px 16px rgba(212, 169, 58, 0.12);
    }
    .iter-card.is-active::before {
      content: '◆ Current sprint';
      display: block;
      color: var(--primary);
      font-size: 11px; font-weight: 700;
      letter-spacing: 0.6px; text-transform: uppercase;
      margin-bottom: 8px;
    }
    .iter-card { transition: background 0.15s, border-color 0.15s, box-shadow 0.15s; }
    .iter-card.drag-over {
      border-color: var(--primary);
      border-style: solid;
      box-shadow: inset 0 0 0 1px var(--primary), 0 0 0 4px rgba(212, 169, 58, 0.12);
      background: rgba(212, 169, 58, 0.06);
    }
    .iter-card.drag-over .iter-empty {
      border-color: var(--primary);
      color: var(--primary);
    }
    .iter-item.dragging { opacity: 0.35; border-style: dashed; }
    /* Top row: title input on the left, status pill on the right. The pill
       is a read-only state indicator, separate from the editable inputs in
       the controls row below. */
    .iter-head {
      display: flex; align-items: center; gap: 10px;
      margin-bottom: 8px;
    }
    .iter-head .iter-name { flex: 1; }
    .iter-head .iter-state { flex-shrink: 0; }
    /* Controls row underneath: dates, status/effort selects, delete.
       Spread to full card width via space-between so the row reads as a
       deliberate strip rather than left-clumped controls with empty space. */
    .iter-controls {
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
      justify-content: space-between;
      margin-bottom: 8px;
    }
    .iter-controls .date-input {
      width: 120px; padding: 4px 8px; height: 30px; line-height: 1; font-size: 12px;
      cursor: pointer;
    }
    .iter-controls .state-select {
      width: 110px; padding: 4px 8px; height: 30px; line-height: 1; font-size: 12px;
    }
    /* Tint the native calendar icon gold (Chromium / Edge / Safari). */
    .iter-controls .date-input::-webkit-calendar-picker-indicator {
      filter: invert(72%) sepia(45%) saturate(820%) hue-rotate(5deg) brightness(95%) contrast(85%);
      cursor: pointer;
      opacity: 1;
    }
    .iter-name {
      flex: 1; width: 100%;
      font-size: 18px; font-weight: 600;
      background: transparent; border: 1px solid transparent;
      border-radius: var(--radius-sm);
      padding: 6px 10px;
      max-width: none;
      cursor: text;
      transition: background 0.15s, border-color 0.15s;
    }
    .iter-name:hover {
      background: var(--bg-3);
      border-color: var(--line);
    }
    .iter-name:focus {
      border-color: var(--primary);
      background: var(--bg-3);
      outline: none;
    }
    .iter-state {
      display: inline-block; padding: 2px 10px; border-radius: 999px;
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
    }
    .iter-state.state-planning { background: var(--bg-3); color: var(--muted); }
    .iter-state.state-active   { background: var(--primary); color: #0a0a0a; }
    .iter-state.state-closed   { background: var(--bg-3); color: var(--muted); opacity: 0.7; }
    .iter-goal {
      width: 100%; background: transparent; border: 1px solid transparent;
      padding: 4px 8px; font-size: 13px; color: var(--muted);
      resize: vertical; margin-bottom: 8px;
    }
    .iter-goal:focus { border-color: var(--line); background: var(--bg-3); color: var(--fg); }
    .iter-stats {
      display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
      padding: 8px 0 12px;
      border-bottom: 1px solid var(--line);
      margin-bottom: 10px;
    }
    .iter-stats .stat { font-size: 12px; color: var(--muted); }
    .iter-stats .stat b { color: var(--fg); font-weight: 600; }
    .cap-chip {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 2px 8px; border-radius: 999px;
      background: var(--bg-3); border: 1px solid var(--line);
      font-size: 11px; color: var(--fg);
    }
    .cap-chip.over { border-color: #ef4444; color: #ef4444; }
    .iter-empty {
      border: 1px dashed var(--line); border-radius: var(--radius-sm);
      padding: 16px; text-align: center;
    }
    .iter-items { display: flex; flex-direction: column; gap: 4px; }
    .iter-item {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 10px;
      background: var(--bg-3); border: 1px solid var(--line); border-radius: var(--radius-sm);
      cursor: pointer;
    }
    .iter-item:hover { border-color: var(--primary); }
    .iter-item, .iter-item-title { color: var(--fg); }
    .iter-item-title { flex: 1; font-size: 13px; }
    .iter-item .effort { min-width: 60px; text-align: right; }

    /* Reports */
    .reports { display: flex; flex-direction: column; gap: 24px; }
    .report-grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
    }
    .metric-card {
      display: flex; flex-direction: column; gap: 4px;
      padding: 16px;
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius);
    }
    .metric-label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
    .metric-value { font-size: 26px; font-weight: 700; color: var(--primary); }
    .report-section h3 { font-size: 14px; margin: 0 0 10px 0; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; }
    .bar-list { display: flex; flex-direction: column; gap: 6px; }
    .bar-row { display: flex; align-items: center; gap: 12px; }
    .bar-label { min-width: 160px; font-size: 13px; display: flex; align-items: center; gap: 8px; }
    .bar-track { flex: 1; height: 16px; background: var(--bg-3); border-radius: 999px; overflow: hidden; border: 1px solid var(--line); }
    .bar-fill { height: 100%; background: var(--primary); transition: width 0.3s ease; }
    .bar-count { min-width: 80px; text-align: right; font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
  `],
})
export class TasksProject {
  private api = inject(Api);
  private auth = inject(Auth);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  /** Currently signed-in user (read-only signal). */
  currentUser = this.auth.user;

  readonly tabs: { key: TabKey; label: string }[] = [
    { key: 'backlog', label: 'Backlog' },
    { key: 'board',   label: 'Board' },
    { key: 'sprints', label: 'Sprints' },
    { key: 'reports', label: 'Reports' },
  ];
  readonly fibPoints = FIB_POINTS;
  readonly dayOptions = DAY_OPTIONS;
  formatDay = (d: number) => d < 1 ? `½ day` : `${d} day${d === 1 ? '' : 's'}`;

  tab = signal<TabKey>('backlog');
  projectId = signal<number | null>(null);
  project = signal<TaskProject | null>(null);
  items = signal<TaskItem[]>([]);
  types = signal<TaskItemType[]>([]);
  states = signal<TaskItemState[]>([]);
  users = signal<AdminUserRecord[]>([]);
  iterations = signal<TaskIteration[]>([]);

  // Inline service picker for the project header. The project's link is to a
  // service (onboarding_client_id); the client comes from the email match
  // and shows up as the header chip.
  servicesPool = signal<ServicePoolEntry[]>([]);
  showClientPicker = signal(false);
  serviceOptions = computed<ComboOption[]>(() => {
    const opts: ComboOption[] = [{ value: null, label: '— none —' }];
    for (const s of this.servicesPool()) {
      const clientLabel = s.client_canonical_name?.trim()
        || s.client_name?.trim()
        || s.client_email
        || 'Client';
      const company = s.client_company?.trim();
      const clientPart = company ? `${clientLabel} (${company})` : clientLabel;
      const terms = this.formatServiceTerms(s);
      const taken = s.linked_project_id && s.linked_project_id !== this.projectId()
        ? ' · already linked'
        : '';
      // Include qualification date so duplicate (form, client) entries are
      // distinguishable when a client has multiple instances of the same service.
      const date = s.qualified_at ? ` · ${s.qualified_at.slice(0, 10)}` : '';
      opts.push({
        value: s.onboarding_client_id,
        label: `${s.form_title} — ${clientPart}${terms ? ' · ' + terms : ''}${date}${taken}`,
      });
    }
    return opts;
  });

  private formatServiceTerms(s: ServicePoolEntry): string {
    if (!s.has_price || s.price == null) return '';
    const n = Number(s.price);
    if (!isFinite(n)) return '';
    const money = n.toLocaleString(undefined, { style: 'currency', currency: 'GBP' });
    if (s.payment_type === 'one_off') return `${money} one-off`;
    const tail = s.is_indefinite
      ? ' · indefinite'
      : (s.contract_length_months ? ` · ${s.contract_length_months} mo` : '');
    return `${money} / ${s.repeat_duration ?? 'period'}${tail}`;
  }

  toggleClientPicker() {
    if (!this.servicesPool().length) {
      this.api.listServicesPool().subscribe(r => this.servicesPool.set(r.services));
    }
    this.showClientPicker.update(v => !v);
  }

  setProjectService(v: string | number | null) {
    const id = this.projectId();
    const cur = this.project();
    if (!id || !cur) return;
    const ocid = (typeof v === 'number' && v > 0) ? v : null;
    const match = ocid !== null
      ? this.servicesPool().find(s => s.onboarding_client_id === ocid) ?? null
      : null;
    // Backend re-derives client_id from the new service link automatically.
    this.api.updateTaskProject(id, { ...cur, onboarding_client_id: ocid }).subscribe({
      next: () => {
        this.project.set({
          ...cur,
          onboarding_client_id: ocid,
          client_id: match?.client_id ?? null,
          client_name: match?.client_canonical_name
            ?? match?.client_name
            ?? match?.client_email
            ?? null,
        });
      },
    });
  }
  /** Default per-assignee capacity in days for an iteration. */
  defaultSprintCapacity = 10;

  /** Board's active sprint filter. 'all' = every item, null = backlog only, number = specific iteration. */
  boardIteration = signal<number | null | 'all'>('all');

  // Filters (signals so the computed below reacts in zoneless mode)
  search = signal('');
  filterType = signal<number | null>(null);
  filterState = signal<number | null>(null);
  filterAssignee = signal<number | null>(null);

  // Selection
  selectedId = signal<number | null>(null);
  selectedItem = computed(() => this.items().find(i => i.id === this.selectedId()) ?? null);
  /** Display vs edit mode for the side panel. Drafts always render the edit form. */
  panelMode = signal<'view' | 'edit'>('view');
  inEditMode = computed(() => this.isDraft() || this.panelMode() === 'edit');

  /** Inline assignee picker (view-mode quick edit). */
  assigneePickerOpen = signal(false);
  assigneeQuery = signal('');
  assigneeMatches = computed(() => {
    const q = this.assigneeQuery().trim().toLowerCase();
    if (!q) return this.users();
    return this.users().filter(u =>
      (u.display_name || '').toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q),
    );
  });

  // Draft for new work items — held locally until the user confirms.
  draftItem = signal<TaskItem | null>(null);
  draftTitle = signal('');
  creating = signal(false);
  draftError = signal<string | null>(null);
  isDraft = computed(() => this.draftItem() !== null);
  panelItem = computed(() => this.draftItem() ?? this.selectedItem());

  // Drag-drop
  draggingId = signal<number | null>(null);
  dragOverStateId = signal<number | null>(null);
  dragOverIterationId = signal<number | null | 'none'>(null);
  /** Card the dragged item is hovering over, plus whether the cursor is on the top half (above) or bottom half (below). */
  dragOverCardId = signal<number | null>(null);
  dragOverPosition = signal<'above' | 'below'>('below');
  private dragging: TaskItem | null = null;

  filteredItems = computed(() => {
    const q = this.search().trim().toLowerCase();
    const ft = this.filterType();
    const fs = this.filterState();
    const fa = this.filterAssignee();
    return this.items().filter(i => {
      if (q && !i.title.toLowerCase().includes(q)) return false;
      if (ft !== null && i.type_id !== ft) return false;
      if (fs !== null && i.state_id !== fs) return false;
      if (fa !== null) {
        if (fa === 0 && i.assigned_to) return false;
        if (fa !== 0 && i.assigned_to !== fa) return false;
      }
      return true;
    });
  });

  boardStates = computed(() => this.states().filter(s => !s.is_terminal || (this.boardItemsByState().get(s.id!)?.length ?? 0) > 0));

  itemsByState = computed(() => {
    const map = new Map<number, TaskItem[]>();
    for (const i of this.items()) {
      const list = map.get(i.state_id) ?? [];
      list.push(i);
      map.set(i.state_id, list);
    }
    return map;
  });

  activeIteration = computed(() => this.iterations().find(i => i.state === 'active') ?? null);

  /** Items shown on the board, filtered by selected sprint. */
  boardItems = computed(() => {
    const sel = this.boardIteration();
    if (sel === 'all') return this.items();
    if (sel === null)  return this.items().filter(i => i.iteration_id == null);
    return this.items().filter(i => i.iteration_id === sel);
  });

  boardItemsByState = computed(() => {
    const map = new Map<number, TaskItem[]>();
    for (const i of this.boardItems()) {
      const list = map.get(i.state_id) ?? [];
      list.push(i);
      map.set(i.state_id, list);
    }
    return map;
  });

  // When this view is opened with `?item=N` (e.g. from the client Services
  // tab's expanded items list), we auto-open that item in the side panel
  // once the items list has loaded.
  private pendingOpenItemId: number | null = null;

  ngOnInit() {
    this.route.paramMap.subscribe(p => {
      const id = +p.get('id')!;
      this.projectId.set(id);
      this.api.getTaskProject(id).subscribe(r => this.project.set(r.project));
      this.refreshItems();
      this.refreshIterations();
    });
    this.route.queryParamMap.subscribe(q => {
      const raw = q.get('item');
      const id = raw != null && /^\d+$/.test(raw) ? +raw : null;
      this.pendingOpenItemId = id;
      // If items are already loaded, open immediately. Otherwise refreshItems
      // will pick it up after fetch.
      this.tryOpenPendingItem();
    });
    this.api.listTaskTypes().subscribe(r => this.types.set(r.types));
    this.api.listTaskStates().subscribe(r => this.states.set(r.states));
    this.api.listAdminUsers().subscribe(r => this.users.set(r.users.filter(u => u.is_active)));
  }

  refreshItems() {
    const pid = this.projectId();
    if (!pid) return;
    this.api.listTaskItems({ project_id: pid }).subscribe(r => {
      // MySQL DECIMAL columns come back as strings — coerce so [ngValue]="2" matches.
      const normalized = r.items.map(i => ({
        ...i,
        story_points:   i.story_points   == null ? null : +i.story_points,
        effort_days:    i.effort_days    == null ? null : +i.effort_days,
        remaining_days: i.remaining_days == null ? null : +i.remaining_days,
        completed_days: i.completed_days == null ? null : +i.completed_days,
      }));
      this.items.set(normalized);
      this.tryOpenPendingItem();
    });
  }

  private tryOpenPendingItem() {
    const want = this.pendingOpenItemId;
    if (want == null) return;
    const found = this.items().find(i => i.id === want);
    if (!found) return;
    this.pendingOpenItemId = null; // consume — don't re-open on subsequent refreshes
    this.openItem(found);
  }
  refreshIterations() {
    const pid = this.projectId();
    if (!pid) return;
    this.api.listTaskIterations(pid).subscribe(r => {
      this.iterations.set(r.iterations);
      // On first load, focus the board on the active sprint if there is one.
      if (this.boardIteration() === 'all') {
        const active = r.iterations.find(i => i.state === 'active');
        if (active?.id) this.boardIteration.set(active.id);
      }
    });
  }

  newItem() {
    const pid = this.projectId();
    if (!pid) return;
    const type = this.types().find(t => t.is_default) ?? this.types()[0];
    const state = this.states().find(s => s.is_default_new) ?? this.states()[0];
    this.selectedId.set(null);
    this.draftError.set(null);
    this.draftTitle.set('');
    this.draftItem.set({
      project_id: pid,
      type_id: type?.id!,
      state_id: state?.id!,
      title: '',
      priority: 3,
      type_color: type?.color ?? undefined,
      type_icon:  type?.icon  ?? undefined,
      type_name:  type?.name,
      state_color: state?.color ?? undefined,
      state_name:  state?.name,
    });
  }

  confirmDraft() {
    if (this.creating()) return;
    const draft = this.draftItem();
    if (!draft) return;
    const title = (this.draftTitle() || '').trim();
    if (!title) { this.draftError.set('Title required'); return; }
    this.draftError.set(null);
    this.creating.set(true);
    const payload: TaskItem = { ...draft, title };
    this.api.createTaskItem(payload).subscribe({
      next: r => {
        this.creating.set(false);
        this.draftItem.set(null);
        this.draftTitle.set('');
        this.refreshItems();
        setTimeout(() => this.selectedId.set(r.id), 50);
      },
      error: e => {
        this.creating.set(false);
        const msg = e?.error?.error || e?.message || `Failed to create (${e?.status ?? 'network'})`;
        this.draftError.set(msg);
      },
    });
  }
  cancelDraft() {
    this.draftItem.set(null);
    this.draftTitle.set('');
    this.draftError.set(null);
  }

  openItem(it: TaskItem) {
    this.draftItem.set(null);
    this.panelMode.set('view');
    this.selectedId.set(it.id ?? null);
  }
  closePanel() {
    this.draftItem.set(null);
    this.panelMode.set('view');
    this.selectedId.set(null);
  }
  toggleEdit() {
    this.panelMode.set(this.panelMode() === 'edit' ? 'view' : 'edit');
  }
  iterationName(id: number | null | undefined): string | null {
    if (!id) return null;
    return this.iterations().find(i => i.id === id)?.name ?? null;
  }
  openAssigneePicker() {
    this.assigneeQuery.set('');
    this.assigneePickerOpen.set(true);
  }
  closeAssigneePicker() {
    this.assigneePickerOpen.set(false);
  }
  setAssignee(it: TaskItem, userId: number | null) {
    this.closeAssigneePicker();
    this.patch(it, { assigned_to: userId });
  }
  /** Effort unit comes from the item's iteration; falls back to days for backlog items. */
  effortModeFor(it: TaskItem): 'points' | 'days' {
    if (!it.iteration_id) return 'days';
    return this.iterations().find(i => i.id === it.iteration_id)?.effort_mode ?? 'days';
  }
  priorityLabel(p: number | undefined): string {
    switch (p) {
      case 1: return 'P1 — critical';
      case 2: return 'P2 — high';
      case 4: return 'P4 — low';
      default: return 'P3 — medium';
    }
  }
  del(it: TaskItem, e?: Event) {
    e?.stopPropagation();
    if (!it.id) return;
    if (!confirm(`Delete "${it.title}"?`)) return;
    this.api.deleteTaskItem(it.id).subscribe(() => {
      this.selectedId.set(null);
      this.refreshItems();
    });
  }

  patch(it: TaskItem, changes: Partial<TaskItem>) {
    if (!it.id) return;
    this.api.updateTaskItem(it.id, changes).subscribe(() => this.refreshItems());
  }

  formatEffort(i: TaskItem): string {
    const mode = this.effortModeFor(i);
    if (mode === 'points' && i.story_points != null) return `${i.story_points} pts`;
    if (mode === 'days'   && i.effort_days  != null) return this.formatDay(+i.effort_days);
    return '—';
  }
  initials(name: string): string {
    return name.split(/\s+/).map(s => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  }

  parentOf(it: TaskItem): TaskItem | null {
    if (!it.parent_id) return null;
    return this.items().find(i => i.id === it.parent_id) ?? null;
  }
  childrenOf(id: number): TaskItem[] {
    return this.items().filter(i => i.parent_id === id);
  }
  /** Possible parents = items in this project minus self and any descendants (no cycles). */
  parentChoices(it: TaskItem): TaskItem[] {
    const banned = new Set<number>([it.id!]);
    let added = true;
    while (added) {
      added = false;
      for (const i of this.items()) {
        if (i.parent_id != null && banned.has(i.parent_id) && !banned.has(i.id!)) {
          banned.add(i.id!); added = true;
        }
      }
    }
    return this.items().filter(i => !banned.has(i.id!));
  }

  // Drag-drop handlers
  onDragStart(it: TaskItem) {
    this.dragging = it;
    this.draggingId.set(it.id ?? null);
  }
  onDragEnd() {
    this.dragging = null;
    this.draggingId.set(null);
    this.dragOverStateId.set(null);
    this.dragOverIterationId.set(null);
    this.dragOverCardId.set(null);
  }
  /** Card-level dragover — figures out insertion position relative to the card under cursor. */
  onDragOverCard(targetId: number, e: DragEvent) {
    e.preventDefault();
    if (this.draggingId() === null || this.draggingId() === targetId) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const above = e.clientY < rect.top + rect.height / 2;
    if (this.dragOverCardId() !== targetId) this.dragOverCardId.set(targetId);
    const pos: 'above' | 'below' = above ? 'above' : 'below';
    if (this.dragOverPosition() !== pos) this.dragOverPosition.set(pos);
  }
  /** dragover fires continuously while the cursor is over the element OR any of its
   *  children, so it doesn't flicker the way dragenter/dragleave do across nested cards. */
  onDragOverState(stateId: number, e: DragEvent) {
    e.preventDefault();
    if (this.draggingId() === null) return;
    if (this.dragOverStateId() !== stateId) this.dragOverStateId.set(stateId);
  }
  onDragOverIteration(id: number | null, e: DragEvent) {
    e.preventDefault();
    if (this.draggingId() === null) return;
    const key = id ?? 'none';
    if (this.dragOverIterationId() !== key) this.dragOverIterationId.set(key);
  }
  dropOnState(stateId: number) {
    const it = this.dragging;
    const targetCardId = this.dragOverCardId();
    const position = this.dragOverPosition();
    this.onDragEnd();
    if (!it || !it.id) return;

    const stateChanged = it.state_id !== stateId;
    // Items that will live in the target column (excluding the dragged one).
    const target = (this.boardItemsByState().get(stateId) ?? []).filter(x => x.id !== it.id);
    let insertAt = target.length;
    if (targetCardId !== null) {
      const idx = target.findIndex(x => x.id === targetCardId);
      if (idx >= 0) insertAt = position === 'above' ? idx : idx + 1;
    }
    const reorderInSameCol = !stateChanged && targetCardId !== null;
    if (!stateChanged && !reorderInSameCol) return;
    this.applyReorder(target, it, insertAt, stateChanged ? { state_id: stateId } : {});
  }
  dropOnIteration(iterationId: number | null) {
    const it = this.dragging;
    this.onDragEnd();
    if (!it || !it.id) return;
    if ((it.iteration_id ?? null) === iterationId) return;
    this.patch(it, { iteration_id: iterationId });
  }

  /** Apply the new ordering by re-numbering sort_order for the affected column. */
  private applyReorder(targetWithoutDragged: TaskItem[], dragged: TaskItem, insertAt: number, extra: Partial<TaskItem>) {
    const next = [...targetWithoutDragged];
    next.splice(insertAt, 0, dragged);
    const requests = next.map((item, i) => {
      const sort_order = (i + 1) * 10;
      const patch: Partial<TaskItem> = { sort_order };
      if (item.id === dragged.id && extra) Object.assign(patch, extra);
      return this.api.updateTaskItem(item.id!, patch);
    });
    Promise.all(requests.map(r => r.toPromise())).then(() => this.refreshItems());
  }

  // Iterations
  openPicker(e: Event) {
    const el = e.target as HTMLInputElement & { showPicker?: () => void };
    el.showPicker?.();
  }

  goToCurrentSprint() {
    const cur = this.activeIteration();
    if (!cur?.id) return;
    this.tab.set('board');
    this.boardIteration.set(cur.id);
  }

  newIteration() {
    const pid = this.projectId();
    if (!pid) return;
    const n = this.iterations().length + 1;
    this.api.createTaskIteration({
      project_id: pid,
      name: `Sprint ${n}`,
      state: 'planning',
    }).subscribe(() => this.refreshIterations());
  }
  patchIteration(it: TaskIteration, changes: Partial<TaskIteration>) {
    if (!it.id) return;
    // Enforce single active sprint: close any other active iteration first.
    if (changes.state === 'active') {
      const others = this.iterations().filter(x => x.id !== it.id && x.state === 'active');
      const closeOthers = others.map(o => this.api.updateTaskIteration(o.id!, { state: 'closed' }).toPromise());
      Promise.all(closeOthers).then(() => {
        this.api.updateTaskIteration(it.id!, changes).subscribe(() => this.refreshIterations());
      });
      return;
    }
    this.api.updateTaskIteration(it.id, changes).subscribe(() => this.refreshIterations());
  }
  delIteration(it: TaskIteration) {
    if (!it.id) return;
    if (!confirm(`Delete "${it.name}"? Its items will return to the backlog.`)) return;
    this.api.deleteTaskIteration(it.id).subscribe(() => {
      this.refreshIterations();
      this.refreshItems();
    });
  }
  itemsForIteration(iterationId: number | null): TaskItem[] {
    return this.items().filter(i => (i.iteration_id ?? null) === iterationId);
  }
  pointsForIteration(iterationId: number): number {
    return this.itemsForIteration(iterationId)
      .filter(i => i.effort_mode === 'points' && i.story_points != null)
      .reduce((sum, i) => sum + Number(i.story_points), 0);
  }
  daysForIteration(iterationId: number): number {
    return this.itemsForIteration(iterationId)
      .filter(i => i.effort_mode === 'days' && i.effort_days != null)
      .reduce((sum, i) => sum + Number(i.effort_days), 0);
  }
  // Reports
  openCount = computed(() => this.items().filter(i => !i.state_is_terminal).length);
  closedCount = computed(() => this.items().filter(i => i.state_is_terminal).length);
  pctComplete = computed(() => {
    const total = this.items().length;
    return total === 0 ? 0 : Math.round((this.closedCount() / total) * 100);
  });
  countsByState = computed(() => {
    const map = new Map<number, number>();
    for (const i of this.items()) map.set(i.state_id, (map.get(i.state_id) ?? 0) + 1);
    return map;
  });
  countsByType = computed(() => {
    const map = new Map<number, number>();
    for (const i of this.items()) map.set(i.type_id, (map.get(i.type_id) ?? 0) + 1);
    return map;
  });
  velocityRows = computed(() =>
    this.iterations()
      .map(it => {
        const inIter = this.items().filter(i => i.iteration_id === it.id);
        const planned = inIter.length;
        const completed = inIter.filter(i => i.state_is_terminal).length;
        return { id: it.id!, name: it.name, planned, completed };
      })
      .filter(r => r.planned > 0)
  );
  workloadRows = computed(() => {
    const map = new Map<number, number>();
    for (const i of this.items()) {
      if (i.assigned_to && !i.state_is_terminal) {
        map.set(i.assigned_to, (map.get(i.assigned_to) ?? 0) + 1);
      }
    }
    return [...map.entries()].map(([uid, open]) => {
      const u = this.users().find(x => x.id === uid);
      return { uid, name: u?.display_name || `#${uid}`, open };
    }).sort((a, b) => b.open - a.open);
  });
  maxWorkload = computed(() => {
    const rows = this.workloadRows();
    return rows.length === 0 ? 1 : Math.max(...rows.map(r => r.open));
  });
  pct(n: number, total: number): number {
    return total === 0 ? 0 : Math.round((n / total) * 100);
  }

  /** Per-assignee capacity vs assigned days for an iteration. */
  capacityFor(it: TaskIteration): { uid: number; name: string; cap: number; assigned: number }[] {
    const items = this.itemsForIteration(it.id!);
    const totals = new Map<number, number>();
    for (const i of items) {
      if (!i.assigned_to) continue;
      const days = i.effort_mode === 'days' && i.effort_days != null ? Number(i.effort_days) : 0;
      totals.set(i.assigned_to, (totals.get(i.assigned_to) ?? 0) + days);
    }
    return [...totals.entries()].map(([uid, assigned]) => {
      const u = this.users().find(x => x.id === uid);
      return { uid, name: u?.display_name || `#${uid}`, cap: this.defaultSprintCapacity, assigned: +assigned.toFixed(1) };
    });
  }
}
