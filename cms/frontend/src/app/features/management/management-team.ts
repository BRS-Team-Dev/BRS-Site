import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Api } from '../../core/api';
import { HrEmployee } from '../../core/models';

@Component({
  selector: 'app-management-team',
  template: `
    <div class="toolbar">
      <h1>My team</h1>
      <span class="spacer"></span>
      <span class="muted small">{{ team().length }} active direct report{{ team().length === 1 ? '' : 's' }}</span>
    </div>

    <div class="page">
      @if (team().length === 0) {
        <div class="empty"><p class="muted">No direct reports linked to your record.</p></div>
      } @else {
        <ul class="slot-list">
          @for (e of team(); track e.id) {
            <li class="slot filled" (click)="open(e)">
              <div class="slot-head">
                <strong>{{ e.first_name }} {{ e.last_name }}</strong>
                <span class="status status-{{ e.status }}">{{ e.status?.replace('_', ' ') }}</span>
                <span class="spacer"></span>
                <span class="muted small">Open profile →</span>
              </div>
              <div class="slot-meta muted small">
                <span>{{ e.position || '—' }}</span>
                @if (e.department) { <span>· {{ e.department }}</span> }
                @if (e.hire_date) { <span>· Hired {{ e.hire_date }}</span> }
                @if (e.employment_type) { <span>· {{ etLabel(e.employment_type) }}</span> }
              </div>
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: [`
    .toolbar { padding: 16px 20px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--line); }
    .toolbar h1 { margin: 0; font-size: 22px; }
    .spacer { flex: 1; }

    .page { padding: 20px; background: #ffffff; min-height: calc(100vh - 120px); }
    .empty { padding: 48px 20px; text-align: center; }

    .slot-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .slot {
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
      padding: 12px 14px; display: flex; flex-direction: column; gap: 6px;
      cursor: pointer; transition: border-color 0.15s;
    }
    .slot:hover { border-color: var(--primary); }
    .slot.filled { border-color: var(--line); }
    .slot-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .slot-head strong { font-size: 14px; }
    .slot-meta { padding-top: 6px; border-top: 1px solid var(--line); display: flex; flex-wrap: wrap; gap: 6px; }

    .status {
      padding: 1px 8px; border-radius: 999px;
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      border: 1px solid var(--line);
    }
    .status-active     { color: var(--primary); border-color: var(--primary); background: rgba(212,169,58,0.12); }
    .status-onboarding { color: #60a5fa;        border-color: #60a5fa; }
    .status-on_leave   { color: #f97316;        border-color: #f97316; }
    .status-terminated { color: var(--muted); }
  `],
})
export class ManagementTeam {
  private api = inject(Api);
  private router = inject(Router);
  team = signal<HrEmployee[]>([]);
  ngOnInit() { this.api.listMyTeam().subscribe(r => this.team.set(r.team)); }
  open(e: HrEmployee) { if (e.id) this.router.navigate(['/hr/employees', e.id]); }
  etLabel(t: HrEmployee['employment_type'] | undefined): string {
    switch (t) {
      case 'full_time':  return 'Full-time';
      case 'part_time':  return 'Part-time';
      case 'contractor': return 'Contractor';
      case 'intern':     return 'Intern';
      default:           return t || '';
    }
  }
}
