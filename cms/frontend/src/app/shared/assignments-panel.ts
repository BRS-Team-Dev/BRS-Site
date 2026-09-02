import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api';
import { DialogService } from '../core/dialog';
import {
  Assignment, AssignmentGroup, AssignmentRole, AssigneeOption, AssigneeType,
} from '../core/models';

interface RoleMeta {
  key: AssignmentRole;
  title: string;
  subtitle: string;
  /** true = one active assignee at a time; false = multiple (service_tasks). */
  singleActive: boolean;
}

const ROLES: RoleMeta[] = [
  { key: 'onboarding',    title: 'Onboarding',            subtitle: 'Account manager',  singleActive: true },
  { key: 'services',      title: 'Services',              subtitle: 'Account manager',  singleActive: true },
  { key: 'service_tasks', title: 'Service tasks',         subtitle: 'Dev(s)',           singleActive: false },
  { key: 'account_tasks', title: 'Account / ad-hoc tasks', subtitle: 'Account manager', singleActive: true },
];

const TYPE_LABEL: Record<AssigneeType, string> = {
  employee: 'Employee', contractor: 'Contractor', partner: 'Partner',
};

/**
 * Shared Assignments panel — mounted from both the client and lead detail
 * pages. Renders one card per role showing the current assignee(s) plus a
 * collapsible reassignment history (audit trail). The pick-a-person modal
 * flips between employee / contractor / partner and filters live.
 */
@Component({
  selector: 'app-assignments-panel',
  imports: [FormsModule],
  template: `
    @if (loading()) {
      <p class="muted small">Loading assignments…</p>
    } @else {
      <div class="assign-grid">
        @for (r of roles; track r.key) {
          <div class="assign-card">
            <div class="assign-head">
              <div>
                <h4>{{ r.title }}</h4>
                <span class="muted small">{{ r.subtitle }}</span>
              </div>
              <button class="ghost" (click)="openPicker(r)" style="white-space: nowrap;">
                @if (currentFor(r.key).length === 0) { + Assign }
                @else if (r.singleActive) { ↻ Reassign }
                @else { + Add }
              </button>
            </div>

            <div class="assign-current">
              @if (currentFor(r.key).length === 0) {
                <p class="muted small no-current">No one assigned.</p>
              } @else {
                @for (a of currentFor(r.key); track a.id) {
                  <div class="assignee-row">
                    <span class="type-pill" [attr.data-type]="a.assignee_type">{{ typeLabel(a.assignee_type) }}</span>
                    <div class="who">
                      <strong>{{ a.assignee_name }}</strong>
                      @if (a.assignee_position) { <span class="muted small">{{ a.assignee_position }}</span> }
                    </div>
                    <span class="since muted small">since {{ formatDate(a.assigned_at) }}</span>
                    <button class="ghost icon-btn danger" (click)="unassign(a)" title="Remove">✕</button>
                  </div>
                }
              }
            </div>

            @if (historyFor(r.key).length > 0) {
              <button class="hist-toggle" (click)="toggleHistory(r.key)">
                <span>{{ isHistoryOpen(r.key) ? '▾' : '▸' }} History ({{ historyFor(r.key).length }})</span>
              </button>
              @if (isHistoryOpen(r.key)) {
                <div class="hist-list">
                  @for (h of historyFor(r.key); track h.id) {
                    <div class="hist-row">
                      <span class="type-pill" [attr.data-type]="h.assignee_type">{{ typeLabel(h.assignee_type) }}</span>
                      <strong>{{ h.assignee_name }}</strong>
                      <span class="muted small">
                        {{ formatDate(h.assigned_at) }}
                        @if (h.assigned_by_name) { by {{ h.assigned_by_name }} }
                        · ended {{ formatDate(h.ended_at) }}
                        @if (h.ended_by_name) { by {{ h.ended_by_name }} }
                      </span>
                    </div>
                  }
                </div>
              }
            }
          </div>
        }
      </div>
    }

    @if (pickerRole()) {
      <div class="modal-backdrop" (click)="closePicker()"></div>
      <div class="modal">
        <div class="modal-head">
          <strong>Assign — {{ pickerRole()!.title }}</strong>
          <span class="spacer"></span>
          <button class="ghost" (click)="closePicker()">✕</button>
        </div>
        <div class="modal-body">
          <div class="type-tabs">
            @for (t of typeTabs; track t.key) {
              <button class="type-tab" [class.active]="pickerType() === t.key" (click)="pickerType.set(t.key)">
                {{ t.label }} <span class="count muted">({{ countByType(t.key) }})</span>
              </button>
            }
          </div>
          <input class="picker-search" [(ngModel)]="pickerSearch" name="pk_search" placeholder="Filter by name…" />
          <div class="picker-list">
            @if (filteredPickerOptions().length === 0) {
              <p class="muted small" style="padding: 12px;">No matches.</p>
            }
            @for (o of filteredPickerOptions(); track (o.type + ':' + o.id)) {
              <button class="picker-row" (click)="pickPerson(o)">
                <div class="who">
                  <strong>{{ o.name }}</strong>
                  @if (o.subtitle) { <span class="muted small">{{ o.subtitle }}</span> }
                </div>
                <span class="type-pill" [attr.data-type]="o.type">{{ typeLabel(o.type) }}</span>
              </button>
            }
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .assign-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    @media (max-width: 900px) { .assign-grid { grid-template-columns: 1fr; } }
    .assign-card {
      background: var(--bg-2); border: 1px solid var(--line);
      border-radius: var(--radius-sm); padding: 14px 16px;
      display: flex; flex-direction: column; gap: 10px;
    }
    .assign-head { display: flex; align-items: flex-start; gap: 10px; }
    .assign-head > div { flex: 1; }
    .assign-head h4 { margin: 0; font-size: 14px; color: var(--fg); }
    .no-current { margin: 0; padding: 6px 0; }
    .assignee-row {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 10px; background: var(--bg-3); border-radius: var(--radius-sm);
      margin-bottom: 6px;
    }
    .assignee-row .who { flex: 1; display: flex; flex-direction: column; }
    .assignee-row .who strong { color: var(--fg); font-size: 13px; }
    .assignee-row .since { white-space: nowrap; }
    .type-pill {
      display: inline-block; padding: 2px 8px; border-radius: 999px;
      font-size: 10.5px; font-weight: 700; letter-spacing: 0.3px; text-transform: uppercase;
      border: 1px solid var(--line); color: var(--muted); white-space: nowrap;
    }
    .type-pill[data-type="employee"]   { color: var(--primary); border-color: var(--primary); }
    .type-pill[data-type="contractor"] { color: #56CCF2; border-color: #56CCF2; }
    .type-pill[data-type="partner"]    { color: #BB6BD9; border-color: #BB6BD9; }
    .hist-toggle {
      background: transparent; border: 0; padding: 6px 0;
      color: var(--muted); font-size: 12px; text-align: left; cursor: pointer;
      display: flex; align-items: center; gap: 6px;
    }
    .hist-toggle:hover { color: var(--fg); }
    .hist-list { display: flex; flex-direction: column; gap: 4px; padding-top: 4px; border-top: 1px dashed var(--line); }
    .hist-row {
      display: flex; align-items: center; gap: 8px;
      padding: 6px 4px; font-size: 12px;
    }
    .hist-row strong { color: var(--fg); }

    /* Modal (reuses global .modal-* look) */
    .modal-backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,0.55);
      z-index: 200;
    }
    .modal {
      position: fixed; top: 8vh; left: 50%; transform: translateX(-50%);
      width: min(92vw, 520px); max-height: 84vh;
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius);
      box-shadow: var(--shadow); z-index: 201;
      display: flex; flex-direction: column;
    }
    .modal-head { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-bottom: 1px solid var(--line); }
    .modal-head .spacer { flex: 1; }
    .modal-body { padding: 12px 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
    .type-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--line); padding-bottom: 6px; }
    .type-tab {
      background: transparent; border: 0; padding: 8px 12px;
      color: var(--muted); cursor: pointer; border-radius: var(--radius-sm) var(--radius-sm) 0 0;
      font-size: 13px;
    }
    .type-tab:hover { color: var(--fg); background: var(--bg-3); }
    .type-tab.active { color: var(--primary); background: var(--bg-3); }
    .type-tab .count { margin-left: 4px; font-size: 11px; }
    .picker-search { width: 100%; }
    .picker-list { display: flex; flex-direction: column; gap: 4px; max-height: 40vh; overflow-y: auto; }
    .picker-row {
      display: flex; align-items: center; gap: 10px;
      background: var(--bg-3); border: 1px solid var(--line); border-radius: var(--radius-sm);
      padding: 8px 12px; cursor: pointer; text-align: left; color: var(--fg);
    }
    .picker-row:hover { border-color: var(--primary); }
    .picker-row .who { flex: 1; display: flex; flex-direction: column; }
  `],
})
export class AssignmentsPanel {
  private api = inject(Api);
  private dialog = inject(DialogService);

  entity   = input.required<'client' | 'lead'>();
  entityId = input.required<number>();

  roles = ROLES;
  typeTabs: { key: AssigneeType; label: string }[] = [
    { key: 'employee',   label: 'Employees' },
    { key: 'contractor', label: 'Contractors' },
    { key: 'partner',    label: 'Partners' },
  ];

  loading = signal(true);
  groups  = signal<AssignmentGroup[]>([]);
  historyOpen = signal<Set<AssignmentRole>>(new Set());

  // Picker modal state
  pickerRole   = signal<RoleMeta | null>(null);
  pickerType   = signal<AssigneeType>('employee');
  pickerSearch = '';
  allAssignees = signal<AssigneeOption[]>([]);

  constructor() {
    // Reload whenever the target entity changes (e.g. router hop between clients).
    effect(() => {
      const e = this.entity();
      const id = this.entityId();
      if (!id) return;
      this.load(e, id);
    });
  }

  private load(e: 'client' | 'lead', id: number) {
    this.loading.set(true);
    this.api.listAssignments(e, id).subscribe({
      next: r => { this.groups.set(r.assignments); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  currentFor(role: AssignmentRole): Assignment[] {
    return this.groups().find(g => g.role === role)?.current ?? [];
  }
  historyFor(role: AssignmentRole): Assignment[] {
    return this.groups().find(g => g.role === role)?.history ?? [];
  }
  isHistoryOpen(role: AssignmentRole): boolean { return this.historyOpen().has(role); }
  toggleHistory(role: AssignmentRole) {
    const s = new Set(this.historyOpen());
    s.has(role) ? s.delete(role) : s.add(role);
    this.historyOpen.set(s);
  }

  typeLabel(t: AssigneeType) { return TYPE_LABEL[t]; }
  formatDate(s: string | null): string {
    if (!s) return '—';
    return s.replace('T', ' ').substring(0, 16);
  }

  openPicker(role: RoleMeta) {
    this.pickerRole.set(role);
    this.pickerType.set('employee');
    this.pickerSearch = '';
    if (this.allAssignees().length === 0) {
      this.api.listAssignees().subscribe({ next: r => this.allAssignees.set(r.assignees) });
    }
  }
  closePicker() { this.pickerRole.set(null); }

  countByType(t: AssigneeType): number {
    return this.allAssignees().filter(a => a.type === t).length;
  }
  filteredPickerOptions = computed<AssigneeOption[]>(() => {
    const t = this.pickerType();
    const q = this.pickerSearch.trim().toLowerCase();
    return this.allAssignees()
      .filter(a => a.type === t)
      .filter(a => !q || a.name.toLowerCase().includes(q) || (a.subtitle || '').toLowerCase().includes(q));
  });

  pickPerson(opt: AssigneeOption) {
    const role = this.pickerRole(); if (!role) return;
    this.api.createAssignment(this.entity(), this.entityId(), {
      role: role.key, assignee_type: opt.type, assignee_id: opt.id,
    }).subscribe({
      next: () => { this.closePicker(); this.load(this.entity(), this.entityId()); },
      error: async e => {
        await this.dialog.alert(e?.error?.error || 'Failed to assign.');
      },
    });
  }

  async unassign(a: Assignment) {
    const ok = await this.dialog.confirm(
      `Remove ${a.assignee_name} from this role?`,
      { title: 'Remove assignment', confirmLabel: 'Remove', variant: 'danger' },
    );
    if (!ok) return;
    this.api.endAssignment(this.entity(), this.entityId(), a.id).subscribe(() => {
      this.load(this.entity(), this.entityId());
    });
  }
}
