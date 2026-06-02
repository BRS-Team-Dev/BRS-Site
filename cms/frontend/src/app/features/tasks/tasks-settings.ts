import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { AdminUserRecord, TaskTeam, TaskTeamMember, TaskItemState, TaskItemType } from '../../core/models';

type Tab = 'teams' | 'types' | 'states';

/**
 * /tasks/taskboard/settings — manage teams, item types, and workflow states.
 */
@Component({
  selector: 'app-tasks-settings',
  imports: [FormsModule],
  template: `
    <div class="toolbar">
      <h1>Tasks · Settings</h1>
    </div>

    <div class="tab-nav">
      @for (t of tabs; track t.key) {
        <button class="tab-btn" [class.active]="tab() === t.key" (click)="tab.set(t.key)">{{ t.label }}</button>
      }
    </div>

    <div class="content">
      @if (tab() === 'teams') {
        <div class="settings-head">
          <h2>Teams</h2>
          <span class="muted small">Top-level org units responsible for work, e.g. CRM, CMS, HR.</span>
          <span class="spacer"></span>
          <button class="primary" (click)="newTeam()">+ Add team</button>
        </div>
        @for (t of teams(); track t.id) {
          <div class="team-card" [class.expanded]="isTeamExpanded(t.id!)">
            <div class="row-card">
              <button class="ghost icon-btn" (click)="toggleTeamMembers(t)" [title]="isTeamExpanded(t.id!) ? 'Hide members' : 'Show members'">
                <span class="caret">›</span>
              </button>
              <input type="color" [(ngModel)]="t.color" (change)="patchTeam(t)" name="tc_{{ t.id }}" />
              <input class="grow" [(ngModel)]="t.name" (blur)="patchTeam(t)" name="tn_{{ t.id }}" placeholder="Team name" />
              <input class="slug" [(ngModel)]="t.slug" name="ts_{{ t.id }}" placeholder="slug" disabled />
              <input type="number" class="ord" [(ngModel)]="t.sort_order" (change)="patchTeam(t)" name="to_{{ t.id }}" />
              <button class="ghost icon-btn danger" (click)="delTeam(t)" title="Delete">✕</button>
            </div>

            @if (isTeamExpanded(t.id!)) {
              <div class="members-block">
                <div class="members-head">
                  <strong>Members</strong>
                  <span class="muted small">{{ membersFor(t.id!).length }}</span>
                  <span class="spacer"></span>
                  <select [ngModel]="null" (ngModelChange)="addMember(t, $event)" name="add_m_{{ t.id }}">
                    <option [ngValue]="null">+ Add member…</option>
                    @for (u of usersNotInTeam(t.id!); track u.id) {
                      <option [ngValue]="u.id">{{ u.display_name || u.email }}</option>
                    }
                  </select>
                </div>

                @if (membersFor(t.id!).length === 0) {
                  <p class="muted small">No members yet.</p>
                } @else {
                  <ul class="member-list">
                    @for (m of membersFor(t.id!); track m.id) {
                      <li class="member-chip">
                        <span class="name">{{ m.display_name || m.email }}</span>
                        @if (m.role) { <span class="role">{{ m.role }}</span> }
                        <button class="x" (click)="removeMember(t, m)" title="Remove from team">✕</button>
                      </li>
                    }
                  </ul>
                }
              </div>
            }
          </div>
        }
      }

      @if (tab() === 'types') {
        <div class="settings-head">
          <h2>Work item types</h2>
          <span class="muted small">Story, task, bug, etc. Click "default" to make a type the default for new items.</span>
          <span class="spacer"></span>
          <button class="primary" (click)="newType()">+ Add type</button>
        </div>
        @for (t of types(); track t.id) {
          <div class="row-card">
            <input type="color" [(ngModel)]="t.color" (change)="patchType(t)" name="tc_{{ t.id }}" />
            <input class="grow" [(ngModel)]="t.name" (blur)="patchType(t)" name="tn_{{ t.id }}" placeholder="Type name" />
            <input class="icon-input" [(ngModel)]="t.icon" (blur)="patchType(t)" name="ti_{{ t.id }}" placeholder="S" maxlength="2" />
            <input class="slug" [(ngModel)]="t.slug" name="ts_{{ t.id }}" disabled />
            <label class="check">
              <input type="checkbox" [checked]="!!t.is_default" (change)="setDefaultType(t)" name="td_{{ t.id }}" />
              Default
            </label>
            <input type="number" class="ord" [(ngModel)]="t.sort_order" (change)="patchType(t)" name="to_{{ t.id }}" />
            <button class="ghost icon-btn danger" (click)="delType(t)" title="Delete">✕</button>
          </div>
        }
      }

      @if (tab() === 'states') {
        <div class="settings-head">
          <h2>Workflow states</h2>
          <span class="muted small">"Default new" sets the starting column. "Terminal" auto-stamps closed_at.</span>
          <span class="spacer"></span>
          <button class="primary" (click)="newState()">+ Add state</button>
        </div>
        @for (s of states(); track s.id) {
          <div class="row-card">
            <input type="color" [(ngModel)]="s.color" (change)="patchState(s)" name="sc_{{ s.id }}" />
            <input class="grow" [(ngModel)]="s.name" (blur)="patchState(s)" name="sn_{{ s.id }}" placeholder="State name" />
            <input class="slug" [(ngModel)]="s.slug" name="sg_{{ s.id }}" disabled />
            <label class="check">
              <input type="checkbox" [checked]="!!s.is_default_new" (change)="setDefaultNewState(s)" name="sd_{{ s.id }}" />
              Default new
            </label>
            <label class="check">
              <input type="checkbox" [checked]="!!s.is_terminal" (change)="toggleTerminal(s)" name="st_{{ s.id }}" />
              Terminal
            </label>
            <input type="number" class="ord" [(ngModel)]="s.sort_order" (change)="patchState(s)" name="so_{{ s.id }}" />
            <button class="ghost icon-btn danger" (click)="delState(s)" title="Delete">✕</button>
          </div>
        }
      }
    </div>
  `,
  styles: [`
    .tab-nav { display: flex; gap: 4px; border-bottom: 1px solid var(--line); padding: 0 24px; }
    .tab-btn { padding: 14px 20px; background: none; border: none; color: var(--muted); cursor: pointer; font-size: 13px; position: relative; }
    .tab-btn.active { color: var(--primary); }
    .tab-btn.active::after { content: ''; position: absolute; bottom: -1px; left: 0; right: 0; height: 2px; background: var(--primary); }
    .tab-btn:hover { color: var(--primary); background: transparent; border-color: transparent; }

    .content { padding: 16px 24px 32px; }
    .settings-head { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
    .settings-head h2 { margin: 0; font-size: 16px; }
    .row-card {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 10px; margin-bottom: 6px;
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
    }
    .row-card input[type="color"] { width: 32px; height: 32px; border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 0; cursor: pointer; }
    .row-card .grow { flex: 1; }
    .row-card .slug { font-family: monospace; font-size: 12px; max-width: 140px; opacity: 0.7; }
    .row-card .icon-input { width: 50px; text-align: center; font-weight: 700; }
    .row-card .ord { width: 60px; }
    .check { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); margin: 0; white-space: nowrap; }
    .check input { margin: 0; }

    /* ----- Team members (057) — expandable per row -------------------- */
    .team-card { margin-bottom: 6px; }
    .team-card .row-card { margin-bottom: 0; }
    .team-card .row-card .caret {
      color: var(--muted); transition: transform 0.15s; display: inline-block; width: 12px; text-align: center;
    }
    .team-card.expanded .row-card .caret { transform: rotate(90deg); color: var(--primary); }
    .members-block {
      padding: 12px 14px;
      background: var(--bg-3); border: 1px solid var(--line); border-top: none;
      border-radius: 0 0 var(--radius-sm) var(--radius-sm);
      margin-top: -1px;
    }
    .members-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
    .members-head .spacer { flex: 1; }
    .members-head select { width: auto; min-width: 200px; }
    .member-list {
      list-style: none; margin: 0; padding: 0;
      display: flex; flex-wrap: wrap; gap: 6px;
    }
    .member-chip {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 4px 4px 4px 10px;
      background: var(--bg-2); border: 1px solid var(--line); border-radius: 999px;
      font-size: 12px;
    }
    .member-chip .role { color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
    .member-chip .x {
      width: 22px; height: 22px; padding: 0;
      display: inline-flex; align-items: center; justify-content: center;
      background: transparent; border: none; color: var(--muted); cursor: pointer;
      border-radius: 50%; font-size: 12px;
    }
    .member-chip .x:hover { color: var(--danger); background: rgba(255,100,100,0.1); }
  `],
})
export class TasksSettings {
  private api = inject(Api);
  readonly tabs: { key: Tab; label: string }[] = [
    { key: 'teams',  label: 'Teams' },
    { key: 'types',  label: 'Item types' },
    { key: 'states', label: 'Workflow states' },
  ];
  tab = signal<Tab>('teams');

  teams  = signal<TaskTeam[]>([]);
  types  = signal<TaskItemType[]>([]);
  states = signal<TaskItemState[]>([]);

  // Team-members state (057). Set of expanded team ids + per-team member lists,
  // keyed by team_id; admin users loaded once for the "+ Add member" select.
  expandedTeams = signal<Set<number>>(new Set());
  teamMembers = signal<Map<number, TaskTeamMember[]>>(new Map());
  allUsers = signal<AdminUserRecord[]>([]);

  ngOnInit() {
    this.refreshTeams();
    this.api.listTaskTypes().subscribe(r => this.types.set(r.types));
    this.api.listTaskStates().subscribe(r => this.states.set(r.states));
  }

  // ----- Team members (057) -----
  isTeamExpanded(teamId: number): boolean {
    return this.expandedTeams().has(teamId);
  }
  toggleTeamMembers(t: TaskTeam) {
    if (!t.id) return;
    const cur = new Set(this.expandedTeams());
    if (cur.has(t.id)) {
      cur.delete(t.id);
    } else {
      cur.add(t.id);
      // Lazy-load admin users (once) and this team's members.
      if (this.allUsers().length === 0) {
        this.api.listAdminUsers().subscribe(r => this.allUsers.set(r.users.filter(u => u.is_active !== 0)));
      }
      if (!this.teamMembers().has(t.id)) {
        this.loadMembers(t.id);
      }
    }
    this.expandedTeams.set(cur);
  }
  private loadMembers(teamId: number) {
    this.api.listTaskTeamMembers(teamId).subscribe({
      next: r => {
        const map = new Map(this.teamMembers());
        map.set(teamId, r.members);
        this.teamMembers.set(map);
      },
      error: () => {
        const map = new Map(this.teamMembers());
        map.set(teamId, []);
        this.teamMembers.set(map);
      },
    });
  }
  membersFor(teamId: number): TaskTeamMember[] {
    return this.teamMembers().get(teamId) ?? [];
  }
  /** Admin users not already on the given team — feeds the "+ Add member" select. */
  usersNotInTeam(teamId: number): AdminUserRecord[] {
    const memberIds = new Set(this.membersFor(teamId).map(m => m.id));
    return this.allUsers().filter(u => u.id != null && !memberIds.has(u.id));
  }
  addMember(t: TaskTeam, userId: number | null) {
    if (!t.id || !userId) return;
    this.api.addTaskTeamMember(t.id, userId).subscribe(() => this.loadMembers(t.id!));
  }
  removeMember(t: TaskTeam, m: TaskTeamMember) {
    if (!t.id) return;
    if (!confirm(`Remove ${m.display_name || m.email} from "${t.name}"?`)) return;
    this.api.removeTaskTeamMember(t.id, m.id).subscribe(() => this.loadMembers(t.id!));
  }

  // Teams
  newTeam() {
    const slug = `team_${Date.now().toString(36)}`;
    this.api.createTaskTeam({ slug, name: 'New team', color: '#888888', sort_order: this.teams().length }).subscribe(() => this.refreshTeams());
  }
  patchTeam(t: TaskTeam) {
    if (!t.id) return;
    this.api.updateTaskTeam(t.id, t).subscribe();
  }
  delTeam(t: TaskTeam) {
    if (!t.id) return;
    if (!confirm(`Delete team "${t.name}"? Projects using it must be re-assigned first.`)) return;
    this.api.deleteTaskTeam(t.id).subscribe(() => this.refreshTeams());
  }
  refreshTeams() { this.api.listTaskTeams().subscribe(r => this.teams.set(r.teams)); }

  // Types
  newType() {
    const slug = `type_${Date.now().toString(36)}`;
    this.api.createTaskType({ slug, name: 'New type', color: '#888888', icon: 'X', sort_order: this.types().length }).subscribe(() => this.refreshTypes());
  }
  patchType(t: TaskItemType) {
    if (!t.id) return;
    this.api.updateTaskType(t.id, t).subscribe();
  }
  setDefaultType(t: TaskItemType) {
    if (!t.id) return;
    // Only one type can be default — clear others first.
    const promises = this.types().filter(x => x.id !== t.id && x.is_default).map(x => this.api.updateTaskType(x.id!, { ...x, is_default: 0 }));
    Promise.all(promises.map(p => p.toPromise())).then(() => {
      this.api.updateTaskType(t.id!, { ...t, is_default: t.is_default ? 0 : 1 }).subscribe(() => this.refreshTypes());
    });
  }
  delType(t: TaskItemType) {
    if (!t.id) return;
    if (!confirm(`Delete type "${t.name}"? Items of this type must be re-typed first.`)) return;
    this.api.deleteTaskType(t.id).subscribe(() => this.refreshTypes());
  }
  refreshTypes() { this.api.listTaskTypes().subscribe(r => this.types.set(r.types)); }

  // States
  newState() {
    const slug = `state_${Date.now().toString(36)}`;
    this.api.createTaskState({ slug, name: 'New state', color: '#888888', sort_order: this.states().length }).subscribe(() => this.refreshStates());
  }
  patchState(s: TaskItemState) {
    if (!s.id) return;
    this.api.updateTaskState(s.id, s).subscribe();
  }
  setDefaultNewState(s: TaskItemState) {
    if (!s.id) return;
    const promises = this.states().filter(x => x.id !== s.id && x.is_default_new).map(x => this.api.updateTaskState(x.id!, { ...x, is_default_new: 0 }));
    Promise.all(promises.map(p => p.toPromise())).then(() => {
      this.api.updateTaskState(s.id!, { ...s, is_default_new: s.is_default_new ? 0 : 1 }).subscribe(() => this.refreshStates());
    });
  }
  toggleTerminal(s: TaskItemState) {
    if (!s.id) return;
    this.api.updateTaskState(s.id, { ...s, is_terminal: s.is_terminal ? 0 : 1 }).subscribe(() => this.refreshStates());
  }
  delState(s: TaskItemState) {
    if (!s.id) return;
    if (!confirm(`Delete state "${s.name}"? Items in this state must be moved first.`)) return;
    this.api.deleteTaskState(s.id).subscribe(() => this.refreshStates());
  }
  refreshStates() { this.api.listTaskStates().subscribe(r => this.states.set(r.states)); }
}
