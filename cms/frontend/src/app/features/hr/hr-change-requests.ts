import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { HrChangeRequest } from '../../core/models';

/**
 * /hr/change-requests — HR-side inbox of profile updates submitted by employees.
 * Approving applies the change to the employee row.
 */
@Component({
  selector: 'app-hr-change-requests',
  imports: [FormsModule],
  template: `
    <div class="toolbar">
      <h1>Profile change requests</h1>
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
            <th>Employee</th><th>Field</th><th>From</th><th>To</th><th>Note</th><th>Status</th><th>Submitted</th><th></th>
          </tr></thead>
          <tbody>
            @for (r of filtered(); track r.id) {
              <tr>
                <td><strong>{{ r.first_name }} {{ r.last_name }}</strong></td>
                <td><code>{{ r.field }}</code></td>
                <td class="muted small">{{ r.old_value || '—' }}</td>
                <td><strong>{{ r.new_value || '—' }}</strong></td>
                <td class="muted small">{{ r.note || '' }}</td>
                <td><span class="status status-{{ r.status }}">{{ r.status }}</span></td>
                <td class="muted small">{{ r.created_at }}</td>
                <td class="actions">
                  @if (r.status === 'pending') {
                    <button class="ghost" (click)="review(r, 'approved')">Approve</button>
                    <button class="ghost danger" (click)="review(r, 'denied')">Deny</button>
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
    .empty { padding: 40px 20px; text-align: center; }
    .table-wrap { padding: 12px 20px 20px; }
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
export class HrChangeRequests {
  private api = inject(Api);

  requests = signal<HrChangeRequest[]>([]);
  statusFilter = signal<string | null>('pending');

  filtered = computed(() => {
    const sf = this.statusFilter();
    return sf ? this.requests().filter(r => r.status === sf) : this.requests();
  });

  ngOnInit() { this.refresh(); }

  refresh() {
    this.api.listHrChangeRequests().subscribe(r => this.requests.set(r.requests));
  }
  review(r: HrChangeRequest, status: 'approved' | 'denied') {
    if (!r.id) return;
    this.api.reviewHrChangeRequest(r.id, status).subscribe(() => this.refresh());
  }
}
