import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { HrTimeOffEntry } from '../../core/models';

@Component({
  selector: 'app-hr-time-off',
  imports: [FormsModule],
  template: `
    <div class="toolbar">
      <h1>Time off</h1>
      <span class="spacer"></span>
      <select [ngModel]="statusFilter()" (ngModelChange)="statusFilter.set($event)" name="sf">
        <option [ngValue]="null">All statuses</option>
        <option value="pending">Pending</option>
        <option value="approved">Approved</option>
        <option value="denied">Denied</option>
        <option value="cancelled">Cancelled</option>
      </select>
    </div>

    @if (filtered().length === 0) {
      <div class="empty"><p class="muted">No requests match.</p></div>
    } @else {
      <div class="table-wrap">
        <table class="data">
          <thead><tr>
            <th>Employee</th><th>Kind</th><th>From</th><th>To</th><th>Days</th><th>Status</th><th>Notes</th><th></th>
          </tr></thead>
          <tbody>
            @for (t of filtered(); track t.id) {
              <tr (click)="open(t)">
                <td><strong>{{ t.first_name }} {{ t.last_name }}</strong></td>
                <td>{{ t.kind }}</td>
                <td>{{ t.start_date }}</td>
                <td>{{ t.end_date }}</td>
                <td>{{ t.days }}</td>
                <td><span class="status status-{{ t.status }}">{{ t.status }}</span></td>
                <td class="muted small">{{ t.notes || '' }}</td>
                <td class="actions" (click)="$event.stopPropagation()">
                  @if (t.status === 'pending') {
                    <button class="ghost" (click)="review(t, 'approved')">Approve</button>
                    <button class="ghost danger" (click)="review(t, 'denied')">Deny</button>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
  styles: [`
    .toolbar { padding: 16px 20px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--line); }
    .toolbar h1 { margin: 0; font-size: 22px; }
    .spacer { flex: 1; }
    .table-wrap { padding: 12px 20px 20px; }
    .empty { padding: 40px 20px; text-align: center; }
    tr { cursor: pointer; }
    .status {
      display: inline-block; padding: 2px 10px; border-radius: 999px;
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      border: 1px solid var(--line);
    }
    .status-pending   { color: var(--primary); border-color: var(--primary); }
    .status-approved  { color: var(--primary); border-color: var(--primary); }
    .status-denied    { color: #ef4444; border-color: #ef4444; }
    .status-cancelled { color: var(--muted); border-color: var(--muted); }
    .actions { text-align: right; }
  `],
})
export class HrTimeOff {
  private api = inject(Api);
  private router = inject(Router);

  entries = signal<HrTimeOffEntry[]>([]);
  statusFilter = signal<string | null>('pending');

  filtered = computed(() => {
    const sf = this.statusFilter();
    return sf ? this.entries().filter(e => e.status === sf) : this.entries();
  });

  ngOnInit() { this.refresh(); }

  refresh() {
    this.api.listHrTimeOff().subscribe(r => this.entries.set(r.entries));
  }

  open(t: HrTimeOffEntry) {
    this.router.navigate(['/hr/employees', t.employee_id], { queryParams: { tab: 'time' } });
  }
  review(t: HrTimeOffEntry, status: 'approved' | 'denied') {
    if (!t.id) return;
    this.api.updateHrTimeOff(t.id, { status }).subscribe(() => this.refresh());
  }
}
