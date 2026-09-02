import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { BookingDetailModal } from './booking-detail-modal';

/**
 * Consultation-call bookings list. Clicking a row opens the shared
 * `BookingDetailModal` overlay rather than navigating.
 */
@Component({
  selector: 'app-lead-bookings-admin',
  imports: [FormsModule, BookingDetailModal],
  template: `
    <div class="toolbar">
      <h1>Bookings</h1>
      <span class="spacer"></span>
      <select [(ngModel)]="filterStatus" (ngModelChange)="loadList()" name="status_filter" class="status-filter">
        <option value="">All statuses</option>
        @for (s of statusOptions; track s) { <option [value]="s">{{ statusLabel(s) }}</option> }
      </select>
      <button class="primary" (click)="openNew()">+ New booking</button>
    </div>

    @if (!listLoaded()) {
      <div class="table-wrap"><table class="data">
        <thead><tr>
          <th>Name</th><th>Company</th><th>Topic</th>
          <th>When</th><th>Status</th><th>Source</th>
        </tr></thead>
        <tbody>
          @for (_ of skeletonRows; track $index) {
            <tr class="skeleton"><td colspan="6"><span class="bar"></span></td></tr>
          }
        </tbody>
      </table></div>
    } @else if (rows().length === 0) {
      <div class="empty">
        <p class="muted">No bookings{{ filterStatus ? ' with that status' : '' }} yet.</p>
        <button class="primary" (click)="openNew()">Log the first booking</button>
      </div>
    } @else {
      <div class="table-wrap">
        <table class="data">
          <thead><tr>
            <th>Name</th><th>Company</th><th>Topic</th>
            <th>When</th><th>Status</th><th>Source</th>
          </tr></thead>
          <tbody>
            @for (r of rows(); track r.id) {
              <tr (click)="openBooking(r.id)" class="clickable">
                <td>
                  <strong>{{ r.name }}</strong>
                  @if (r.email) { <div class="muted small">{{ r.email }}</div> }
                </td>
                <td>{{ r.company || '—' }}</td>
                <td>{{ r.topic || '—' }}</td>
                <td>
                  @if (r.scheduled_at) { {{ r.scheduled_at }} }
                  @else { <span class="muted">not scheduled</span> }
                  @if (r.duration_minutes) { <div class="muted small">{{ r.duration_minutes }} min</div> }
                </td>
                <td><span class="status-pill" [attr.data-status]="r.status">{{ statusLabel(r.status) }}</span></td>
                <td>{{ r.source || '—' }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }

    <app-booking-detail-modal
      [bookingId]="openId()"
      (closed)="onModalClosed()"
      (changed)="loadList()" />
  `,
  styles: [`
    :host { display: block; }
    .status-filter { width: 180px; }
    tr.clickable { cursor: pointer; }
    tr.skeleton td { padding: 14px 12px; }
    tr.skeleton .bar {
      display: block; height: 14px; width: 60%;
      background: linear-gradient(90deg, var(--bg-3), var(--bg-2), var(--bg-3));
      background-size: 200% 100%;
      border-radius: 4px;
      animation: sk 1.2s ease-in-out infinite;
    }
    @keyframes sk { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    .status-pill[data-status="requested"] { color: var(--warning); border-color: var(--warning); }
    .status-pill[data-status="confirmed"] { color: var(--primary); border-color: var(--primary); }
    .status-pill[data-status="completed"] { color: var(--success); border-color: var(--success); }
    .status-pill[data-status="cancelled"] { color: var(--muted); text-decoration: line-through; }
    .status-pill[data-status="no_show"]   { color: var(--danger);  border-color: var(--danger); }
  `],
})
export class LeadBookingsAdmin {
  private api = inject(Api);

  statusOptions = ['requested','confirmed','completed','cancelled','no_show'] as const;
  statusLabel = (s: string) => ({
    requested: 'Requested', confirmed: 'Confirmed', completed: 'Completed',
    cancelled: 'Cancelled', no_show: 'No-show',
  } as Record<string, string>)[s] ?? s;

  rows        = signal<any[]>([]);
  listLoaded  = signal(false);
  skeletonRows = Array(4);
  openId      = signal<number | 'new' | null>(null);
  filterStatus = '';

  constructor() {
    this.loadList();
  }

  loadList() {
    const params = this.filterStatus ? { status: this.filterStatus } : undefined;
    this.api.listLeadBookings(params).subscribe(r => {
      this.rows.set(r.bookings);
      this.listLoaded.set(true);
    });
  }

  openBooking(id: number) { this.openId.set(id); }
  openNew()               { this.openId.set('new'); }
  onModalClosed()         { this.openId.set(null); }
}
