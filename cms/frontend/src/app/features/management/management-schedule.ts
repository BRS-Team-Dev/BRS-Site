import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { HrEmployee, HrShift } from '../../core/models';

@Component({
  selector: 'app-management-schedule',
  imports: [FormsModule],
  template: `
    <div class="toolbar">
      <h1>Shifts &amp; schedule</h1>
      <span class="spacer"></span>
      <div class="nav">
        <button class="ghost" (click)="step(-7)">‹ Prev week</button>
        <span class="week-label">{{ weekLabel() }}</span>
        <button class="ghost" (click)="step(7)">Next week ›</button>
        <button class="ghost" (click)="goToThisWeek()">This week</button>
      </div>
      <button class="primary" (click)="openCreate()" [disabled]="team().length === 0">+ New shift</button>
    </div>

    @if (team().length === 0) {
      <div class="empty"><p class="muted">No direct reports linked to your record yet.</p></div>
    } @else {
      <div class="grid-wrap">
        <div class="grid">
          <div class="head-cell"></div>
          @for (d of weekDays(); track d.iso) {
            <div class="head-cell" [class.today]="d.isToday">
              <strong>{{ d.label }}</strong>
              <div class="muted small">{{ d.short }}</div>
            </div>
          }
          @for (e of team(); track e.id) {
            <div class="emp-cell"><strong>{{ e.first_name }} {{ e.last_name }}</strong></div>
            @for (d of weekDays(); track d.iso) {
              <div class="cell">
                @for (s of shiftsFor(e.id!, d.iso); track s.id) {
                  <div class="shift" (click)="openEdit(s)">
                    <strong>{{ s.start_time.slice(0,5) }}–{{ s.end_time.slice(0,5) }}</strong>
                    @if (s.role) { <div class="muted small">{{ s.role }}</div> }
                    @if (s.location) { <div class="muted small">{{ s.location }}</div> }
                  </div>
                }
              </div>
            }
          }
        </div>
      </div>
    }

    @if (formOpen()) {
      <div class="modal-backdrop" (click)="closeForm()">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-head">
            <h2>{{ draft.id ? 'Edit shift' : 'New shift' }}</h2>
            <button class="ghost icon-btn" (click)="closeForm()" title="Close">✕</button>
          </div>
          <div class="modal-body">
            <label>Direct report <span class="required">*</span></label>
            <select [(ngModel)]="draft.employee_id" name="d_emp" [disabled]="!!draft.id">
              <option [ngValue]="0">— pick an employee —</option>
              @for (e of team(); track e.id) { <option [ngValue]="e.id">{{ e.first_name }} {{ e.last_name }}</option> }
            </select>

            <div class="row-grid-3">
              <div>
                <label>Date</label>
                <input type="date" [(ngModel)]="draft.shift_date" name="d_date" />
              </div>
              <div>
                <label>Start</label>
                <input type="time" [(ngModel)]="draft.start_time" name="d_start" />
              </div>
              <div>
                <label>End</label>
                <input type="time" [(ngModel)]="draft.end_time" name="d_end" />
              </div>
            </div>

            <label>Role</label>
            <input [(ngModel)]="draft.role" name="d_role" placeholder="e.g. Front desk" />

            <label>Location</label>
            <input [(ngModel)]="draft.location" name="d_loc" placeholder="e.g. London office" />

            <label>Notes</label>
            <textarea rows="2" [(ngModel)]="draft.notes" name="d_notes"></textarea>

            @if (draft.id) {
              <label>Status</label>
              <select [(ngModel)]="draft.status" name="d_status">
                <option value="scheduled">Scheduled</option>
                <option value="swap_requested">Swap requested</option>
                <option value="swapped">Swapped</option>
                <option value="cancelled">Cancelled</option>
              </select>
            }

            @if (formError()) { <p class="err">{{ formError() }}</p> }
          </div>
          <div class="modal-foot">
            @if (draft.id) { <button class="ghost danger" (click)="del()">✕ Delete</button> }
            <span class="spacer"></span>
            <button class="ghost" (click)="closeForm()">Cancel</button>
            <button class="primary" (click)="save()">{{ draft.id ? 'Save' : 'Create shift' }}</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .toolbar { padding: 16px 20px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--line); }
    .toolbar h1 { margin: 0; font-size: 22px; }
    .spacer { flex: 1; }
    .nav { display: flex; align-items: center; gap: 8px; }
    .week-label { font-weight: 600; min-width: 240px; text-align: center; }
    .empty { padding: 48px 20px; text-align: center; }

    .grid-wrap { padding: 16px 20px; overflow-x: auto; }
    .grid {
      display: grid;
      grid-template-columns: 180px repeat(7, minmax(140px, 1fr));
      gap: 4px; min-width: 100%;
    }
    .head-cell {
      padding: 8px; background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
      text-align: center;
    }
    .head-cell.today { border-color: var(--primary); }
    .emp-cell {
      padding: 10px 12px; background: var(--bg-3); border: 1px solid var(--line); border-radius: var(--radius-sm);
      display: flex; align-items: center;
    }
    .cell {
      min-height: 80px; padding: 4px;
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
      display: flex; flex-direction: column; gap: 4px;
    }
    .shift {
      background: var(--bg-3); border: 1px solid var(--line); border-radius: var(--radius-sm);
      padding: 6px 8px; cursor: pointer;
    }
    .shift:hover { border-color: var(--primary); }

    .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 100; }
    .modal {
      width: 540px; max-width: 90vw; max-height: 90vh; overflow: auto;
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius);
    }
    .modal-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid var(--line); }
    .modal-head h2 { margin: 0; font-size: 16px; }
    .modal-body { padding: 16px 18px; display: flex; flex-direction: column; gap: 8px; }
    .modal-body label { margin-top: 6px; }
    .modal-foot { padding: 14px 18px; border-top: 1px solid var(--line); display: flex; justify-content: flex-end; gap: 8px; align-items: center; }
    .row-grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
    .row-grid-3 > div { display: flex; flex-direction: column; gap: 4px; }
    .row-grid-3 label { margin: 0; }
    .required { color: #ef4444; }
    .err { color: #ef4444; font-size: 13px; margin: 4px 0 0; }
  `],
})
export class ManagementSchedule {
  private api = inject(Api);

  team = signal<HrEmployee[]>([]);
  shifts = signal<HrShift[]>([]);
  weekStart = signal<Date>(this.startOfWeek(new Date()));

  formOpen = signal(false);
  formError = signal<string | null>(null);
  draft: Partial<HrShift> & { id?: number; employee_id: number } = this.blankDraft();

  weekDays = computed(() => {
    const start = this.weekStart();
    const today = new Date(); today.setHours(0,0,0,0);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start); d.setDate(start.getDate() + i);
      return {
        iso: d.toISOString().slice(0, 10),
        label: d.toLocaleDateString(undefined, { weekday: 'short' }),
        short: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        isToday: d.getTime() === today.getTime(),
      };
    });
  });
  weekLabel = computed(() => {
    const days = this.weekDays();
    return `${days[0].short} – ${days[6].short}`;
  });

  ngOnInit() {
    this.api.listMyTeam().subscribe(r => this.team.set(r.team));
    this.refresh();
  }
  refresh() {
    const days = this.weekDays();
    this.api.listMyTeamShifts(days[0].iso, days[6].iso).subscribe(r => this.shifts.set(r.shifts));
  }
  step(deltaDays: number) {
    const d = new Date(this.weekStart()); d.setDate(d.getDate() + deltaDays);
    this.weekStart.set(d);
    this.refresh();
  }
  goToThisWeek() { this.weekStart.set(this.startOfWeek(new Date())); this.refresh(); }
  shiftsFor(employeeId: number, iso: string): HrShift[] {
    return this.shifts().filter(s => s.employee_id === employeeId && s.shift_date === iso);
  }

  openCreate() { this.draft = this.blankDraft(); this.formError.set(null); this.formOpen.set(true); }
  openEdit(s: HrShift) {
    this.draft = {
      id: s.id, employee_id: s.employee_id,
      shift_date: s.shift_date,
      start_time: (s.start_time || '').slice(0, 5),
      end_time:   (s.end_time   || '').slice(0, 5),
      role: s.role || '', location: s.location || '', notes: s.notes || '',
      status: s.status || 'scheduled',
    };
    this.formError.set(null);
    this.formOpen.set(true);
  }
  closeForm() { this.formOpen.set(false); }
  save() {
    const d = this.draft;
    if (!d.employee_id || !d.shift_date || !d.start_time || !d.end_time) {
      this.formError.set('Employee, date, start, and end are required.');
      return;
    }
    const payload = {
      employee_id: d.employee_id,
      shift_date: d.shift_date,
      start_time: d.start_time,
      end_time: d.end_time,
      role: d.role || null,
      location: d.location || null,
      notes: d.notes || null,
      status: d.status || 'scheduled',
    };
    if (d.id) {
      this.api.updateTeamShift(d.id, payload).subscribe({
        next: () => { this.formOpen.set(false); this.refresh(); },
        error: e => this.formError.set(e?.error?.error || 'Could not save shift'),
      });
    } else {
      this.api.createTeamShift(payload).subscribe({
        next: () => { this.formOpen.set(false); this.refresh(); },
        error: e => this.formError.set(e?.error?.error || 'Could not create shift'),
      });
    }
  }
  del() {
    if (!this.draft.id) return;
    if (!confirm('Delete this shift?')) return;
    this.api.deleteTeamShift(this.draft.id).subscribe(() => { this.formOpen.set(false); this.refresh(); });
  }

  private startOfWeek(d: Date): Date {
    const x = new Date(d); x.setHours(0, 0, 0, 0);
    const dow = (x.getDay() + 6) % 7;     // Monday-first
    x.setDate(x.getDate() - dow);
    return x;
  }
  private blankDraft() {
    const today = new Date().toISOString().slice(0, 10);
    return { employee_id: 0, shift_date: today, start_time: '09:00', end_time: '17:00', role: '', location: '', notes: '', status: 'scheduled' as const };
  }
}
