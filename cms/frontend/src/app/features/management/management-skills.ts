import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { HrEmployee, HrEmployeeSkill, HrSkill } from '../../core/models';

interface CellKey { employeeId: number; skillId: number; }

@Component({
  selector: 'app-management-skills',
  imports: [FormsModule],
  template: `
    <div class="toolbar">
      <h1>Skills &amp; gaps</h1>
      <span class="spacer"></span>
      <button class="primary" (click)="openSkillForm()">+ New skill</button>
    </div>

    @if (showSkillForm()) {
      <div class="skill-form">
        <input [(ngModel)]="newName"     name="sk_name" placeholder="Skill name (e.g. TypeScript)" />
        <input [(ngModel)]="newCategory" name="sk_cat"  placeholder="Category (e.g. Engineering)" />
        <button class="primary" (click)="saveSkill()" [disabled]="!newName.trim()">Save</button>
        <button class="ghost"   (click)="closeSkillForm()">Cancel</button>
      </div>
    }

    @if (team().length === 0) {
      <div class="empty"><p class="muted">No direct reports linked to your record yet.</p></div>
    } @else if (skills().length === 0) {
      <div class="empty"><p class="muted">No skills tracked yet. Add one above to start mapping the team.</p></div>
    } @else {
      <div class="heatmap-wrap">
        <table class="heatmap">
          <thead>
            <tr>
              <th class="emp-th">Employee</th>
              @for (s of skills(); track s.id) {
                <th class="skill-th" [title]="s.description || s.name">
                  <div class="skill-name">{{ s.name }}</div>
                  @if (s.category) { <div class="muted small">{{ s.category }}</div> }
                  <button class="ghost icon-btn danger inline" (click)="removeSkill(s)" title="Remove skill from catalogue">✕</button>
                </th>
              }
            </tr>
          </thead>
          <tbody>
            @for (e of team(); track e.id) {
              <tr>
                <td class="emp-td"><strong>{{ e.first_name }} {{ e.last_name }}</strong><div class="muted small">{{ e.position || '—' }}</div></td>
                @for (s of skills(); track s.id) {
                  <td class="cell"
                      [class.gap]="hasGap(e.id!, s.id!)"
                      (click)="openCell(e.id!, s.id!)">
                    @if (cell(e.id!, s.id!); as v) {
                      <div class="dots">
                        @for (i of [1,2,3,4,5]; track i) {
                          <span class="dot" [class.filled]="i <= v.current_level" [class.target]="i === v.target_level && v.target_level > v.current_level"></span>
                        }
                      </div>
                      <div class="muted small">{{ v.current_level }} / {{ v.target_level || '—' }}</div>
                    } @else {
                      <span class="muted small">—</span>
                    }
                  </td>
                }
              </tr>
            }
          </tbody>
        </table>
      </div>
    }

    @if (editing()) {
      <div class="modal-backdrop" (click)="closeCell()">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-head">
            <h2>{{ editingLabel() }}</h2>
            <button class="ghost icon-btn" (click)="closeCell()" title="Close">✕</button>
          </div>
          <div class="modal-body">
            <label>Current level (0 = none, 5 = expert)</label>
            <input type="range" min="0" max="5" [(ngModel)]="editCurrent" name="ec" />
            <div class="range-val">{{ editCurrent }}</div>

            <label>Target level</label>
            <input type="range" min="0" max="5" [(ngModel)]="editTarget" name="et" />
            <div class="range-val">{{ editTarget }}</div>

            <label>Notes</label>
            <textarea rows="3" [(ngModel)]="editNotes" name="en" placeholder="Evidence, recommended training, etc."></textarea>
          </div>
          <div class="modal-foot">
            @if (canDeleteAssessment()) {
              <button class="ghost danger" (click)="deleteCell()">✕ Remove</button>
            }
            <span class="spacer"></span>
            <button class="ghost" (click)="closeCell()">Cancel</button>
            <button class="primary" (click)="saveCell()">Save</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .toolbar { padding: 16px 20px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--line); }
    .toolbar h1 { margin: 0; font-size: 22px; }
    .spacer { flex: 1; }
    .empty { padding: 48px 20px; text-align: center; }

    .skill-form {
      display: flex; gap: 8px; align-items: center;
      padding: 12px 20px; border-bottom: 1px solid var(--line);
      background: var(--bg-3);
    }
    .skill-form input { flex: 1; min-width: 200px; }

    .heatmap-wrap { padding: 16px 20px; overflow-x: auto; }
    .heatmap { border-collapse: separate; border-spacing: 0; min-width: 100%; }
    .heatmap th, .heatmap td {
      padding: 10px 12px; text-align: left; vertical-align: top;
      border-bottom: 1px solid var(--line);
    }
    .heatmap thead th { background: var(--bg-2); position: sticky; top: 0; z-index: 1; }
    .emp-th, .emp-td { min-width: 180px; position: sticky; left: 0; background: var(--bg-2); z-index: 2; }
    .emp-td { background: var(--bg-3); }
    .skill-th { min-width: 120px; position: relative; }
    .skill-name { font-size: 13px; font-weight: 600; }
    .icon-btn.inline { position: absolute; top: 4px; right: 4px; padding: 2px 6px; opacity: 0.4; }
    .skill-th:hover .icon-btn.inline { opacity: 1; }

    .cell {
      cursor: pointer; min-width: 120px;
      transition: background 0.15s;
    }
    .cell:hover { background: var(--bg-3); }
    .cell.gap { background: rgba(239,68,68,0.06); }
    .cell.gap:hover { background: rgba(239,68,68,0.12); }
    .dots { display: flex; gap: 3px; margin-bottom: 2px; }
    .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--bg-2); border: 1px solid var(--line); }
    .dot.filled { background: var(--primary); border-color: var(--primary); }
    .dot.target { border-color: var(--primary); border-style: dashed; }

    .modal-backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,0.6);
      display: flex; align-items: center; justify-content: center; z-index: 100;
    }
    .modal {
      width: 480px; max-width: 90vw; max-height: 90vh; overflow: auto;
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius);
    }
    .modal-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid var(--line); }
    .modal-head h2 { margin: 0; font-size: 16px; }
    .modal-body { padding: 16px 18px; display: flex; flex-direction: column; gap: 8px; }
    .modal-body label { margin-top: 6px; }
    .modal-foot { padding: 14px 18px; border-top: 1px solid var(--line); display: flex; justify-content: flex-end; gap: 8px; align-items: center; }
    .range-val { color: var(--primary); font-weight: 700; font-size: 14px; }
  `],
})
export class ManagementSkills {
  private api = inject(Api);

  team = signal<HrEmployee[]>([]);
  skills = signal<HrSkill[]>([]);
  rows = signal<HrEmployeeSkill[]>([]);

  showSkillForm = signal(false);
  newName = '';
  newCategory = '';

  editing = signal<CellKey | null>(null);
  editCurrent = 0;
  editTarget = 0;
  editNotes = '';

  ngOnInit() { this.refresh(); }
  refresh() {
    this.api.listMyTeam().subscribe(r => this.team.set(r.team));
    this.api.listHrSkills().subscribe(r => this.skills.set(r.skills));
    this.api.listMyTeamSkills().subscribe(r => this.rows.set(r.rows));
  }

  cell(employeeId: number, skillId: number): HrEmployeeSkill | undefined {
    return this.rows().find(r => r.employee_id === employeeId && r.skill_id === skillId);
  }
  hasGap(employeeId: number, skillId: number): boolean {
    const c = this.cell(employeeId, skillId);
    if (!c) return false;
    return c.target_level > c.current_level;
  }

  openSkillForm() { this.showSkillForm.set(true); this.newName = ''; this.newCategory = ''; }
  closeSkillForm() { this.showSkillForm.set(false); }
  saveSkill() {
    if (!this.newName.trim()) return;
    this.api.createHrSkill({
      name: this.newName.trim(),
      category: this.newCategory.trim() || undefined,
    }).subscribe({
      next: () => { this.closeSkillForm(); this.refresh(); },
      error: e => alert(e?.error?.error || 'Could not save skill'),
    });
  }
  removeSkill(s: HrSkill) {
    if (!s.id) return;
    if (!confirm(`Remove "${s.name}" from the catalogue? All assessments using it will also be removed.`)) return;
    this.api.deleteHrSkill(s.id).subscribe(() => this.refresh());
  }

  openCell(employeeId: number, skillId: number) {
    const c = this.cell(employeeId, skillId);
    this.editCurrent = c?.current_level || 0;
    this.editTarget  = c?.target_level || 0;
    this.editNotes   = c?.notes || '';
    this.editing.set({ employeeId, skillId });
  }
  editingLabel(): string {
    const e = this.editing();
    if (!e) return '';
    const emp = this.team().find(x => x.id === e.employeeId);
    const sk  = this.skills().find(x => x.id === e.skillId);
    return `${emp?.first_name} ${emp?.last_name} · ${sk?.name}`;
  }
  closeCell() { this.editing.set(null); }
  canDeleteAssessment(): boolean {
    const e = this.editing();
    if (!e) return false;
    return !!this.cell(e.employeeId, e.skillId);
  }
  saveCell() {
    const e = this.editing();
    if (!e) return;
    this.api.upsertEmployeeSkill(e.employeeId, {
      skill_id: e.skillId,
      current_level: this.editCurrent,
      target_level: this.editTarget,
      notes: this.editNotes,
    }).subscribe(() => { this.editing.set(null); this.refresh(); });
  }
  deleteCell() {
    const e = this.editing();
    if (!e) return;
    this.api.removeEmployeeSkill(e.employeeId, e.skillId).subscribe(() => { this.editing.set(null); this.refresh(); });
  }
}
