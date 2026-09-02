import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { BookingDetailModal } from './booking-detail-modal';

interface CalBooking {
  id: number;
  name: string;
  company: string | null;
  scheduled_at: string | null;   // 'YYYY-MM-DD HH:MM:SS', UK wall clock
  duration_minutes: number;
  status: 'requested' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
  source: string | null;
  lead_name?: string | null;
  assignee_name?: string | null;
}

interface DayCell {
  iso: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
  entries: CalBooking[];
}

/** Local Y-M-D. Never `toISOString()` — that shifts to UTC and lands on
 *  the wrong day for anyone east of Greenwich. */
function ymd(d: Date): string {
  return d.getFullYear() + '-' +
         String(d.getMonth() + 1).padStart(2, '0') + '-' +
         String(d.getDate()).padStart(2, '0');
}

/**
 * Bookings calendar — the month view under CRM -> Bookings.
 *
 *   /admin/bookings/calendar
 *
 * `scheduled_at` holds UK wall-clock time (see the public booking flow in
 * routes/public_lead_booking.php). It is displayed here EXACTLY as stored
 * and never parsed into a Date: the team works one clock, and parsing
 * 'YYYY-MM-DD HH:MM:SS' would re-interpret it in the admin's own browser
 * timezone. Bucketing is plain string slicing for the same reason.
 */
@Component({
  selector: 'app-lead-bookings-calendar',
  imports: [FormsModule, BookingDetailModal],
  template: `
    <div class="toolbar">
      <h1>Bookings calendar</h1>
      <span class="spacer"></span>
      <select [(ngModel)]="filterStatus" (ngModelChange)="applyFilter()" name="status_filter" class="status-filter">
        <option value="">All statuses</option>
        @for (s of statusOptions; track s) { <option [value]="s">{{ statusLabel(s) }}</option> }
      </select>
      <button class="primary" (click)="openId.set('new')">+ New booking</button>
    </div>

    <div class="cal-head">
      <div class="nav">
        <button class="ghost" (click)="step(-1)">&lsaquo; {{ prevLabel() }}</button>
        <span class="month-label">{{ monthLabel() }}</span>
        <button class="ghost" (click)="step(1)">{{ nextLabel() }} &rsaquo;</button>
        <button class="ghost" (click)="goToToday()">Today</button>
      </div>
      <span class="spacer"></span>
      <span class="legend">
        @for (s of statusOptions; track s) {
          <span class="legend-pill" [attr.data-status]="s">{{ statusLabel(s) }}</span>
        }
      </span>
    </div>

    <div class="cal">
      <div class="dow-row">
        @for (d of dayHeaders; track d) { <div class="dow">{{ d }}</div> }
      </div>
      <div class="grid">
        @for (cell of cells(); track cell.iso) {
          <div class="cell" [class.out]="!cell.inMonth" [class.today]="cell.isToday">
            <div class="day-num">{{ cell.day }}</div>
            <div class="entries">
              @for (b of cell.entries; track b.id) {
                <button type="button" class="entry" [attr.data-status]="b.status"
                        (click)="openId.set(b.id)"
                        [title]="tooltip(b)">
                  <span class="entry-time">{{ timeOf(b) }}</span>
                  <span class="entry-name">{{ b.name }}</span>
                </button>
              }
            </div>
          </div>
        }
      </div>
    </div>

    <p class="muted small foot">
      @if (loaded()) {
        {{ monthCount() }} booking{{ monthCount() === 1 ? '' : 's' }} in {{ monthLabel() }}{{ filterStatus ? ' with that status' : '' }}.
      } @else { Loading&hellip; }
      Times are UK (Europe/London), as stored on the booking.
      Bookings with no date yet appear on the list, not here.
    </p>

    <!-- Shared with the list view: clicking a booking edits it in place
         rather than navigating away from the month you were looking at. -->
    <app-booking-detail-modal
      [bookingId]="openId()"
      (closed)="openId.set(null)"
      (changed)="onModalChanged()" />
  `,
  styles: [`
    .toolbar { padding: 16px 20px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--line); }
    .toolbar h1 { margin: 0; font-size: 22px; }
    .spacer { flex: 1; }
    /* The global 'select { width: 100% }' would otherwise wrap the toolbar row. */
    .status-filter { width: 180px; }

    .cal-head {
      display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
      padding: 12px 20px; border-bottom: 1px solid var(--line);
    }
    .nav { display: flex; align-items: center; gap: 8px; flex-wrap: nowrap; }
    .nav button { white-space: nowrap; }
    .month-label { font-weight: 600; min-width: 160px; text-align: center; }
    .legend { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .legend-pill {
      padding: 1px 6px; border-radius: 4px; font-size: 10px;
      text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      border: 1px solid; background: transparent;
    }

    .cal { padding: 16px 20px; }
    .dow-row { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; margin-bottom: 4px; }
    .dow { padding: 6px 8px; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
    .grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
    .cell {
      min-height: 110px;
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
      padding: 4px 6px;
      display: flex; flex-direction: column; gap: 4px;
    }
    .cell.out { opacity: 0.4; }
    .cell.today { border-color: var(--primary); }
    .day-num { font-size: 12px; color: var(--muted); }
    .entries { display: flex; flex-direction: column; gap: 2px; }

    /* A <button>, not a link — it opens the detail modal in place rather
       than navigating, so it needs the browser's button defaults reset. */
    .entry {
      display: flex; align-items: baseline; gap: 5px;
      width: 100%;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: inherit;
      font-size: 11px;
      text-align: left;
      border: 1px solid;
      background: transparent;
      cursor: pointer;
      white-space: nowrap; overflow: hidden;
    }
    .entry:hover { filter: brightness(1.35); }
    .entry-time { font-weight: 700; }
    .entry-name { overflow: hidden; text-overflow: ellipsis; }

    /* One colour per status, matching the pills on the list page. */
    .entry[data-status="requested"], .legend-pill[data-status="requested"] { color: var(--warning); border-color: var(--warning); }
    .entry[data-status="confirmed"], .legend-pill[data-status="confirmed"] { color: var(--primary); border-color: var(--primary); }
    .entry[data-status="completed"], .legend-pill[data-status="completed"] { color: var(--success); border-color: var(--success); }
    .entry[data-status="cancelled"], .legend-pill[data-status="cancelled"] { color: var(--muted);   border-color: var(--muted); }
    .entry[data-status="no_show"],   .legend-pill[data-status="no_show"]   { color: var(--danger);  border-color: var(--danger); }
    .entry[data-status="cancelled"] .entry-name { text-decoration: line-through; }

    .empty { padding: 0 20px 16px; }
    .foot { padding: 0 20px 20px; }
  `],
})
export class LeadBookingsCalendar {
  private api = inject(Api);

  dayHeaders = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  statusOptions = ['requested', 'confirmed', 'completed', 'cancelled', 'no_show'] as const;
  statusLabel = (s: string) => ({
    requested: 'Requested', confirmed: 'Confirmed', completed: 'Completed',
    cancelled: 'Cancelled', no_show: 'No show',
  } as Record<string, string>)[s] ?? s;

  filterStatus = '';
  bookings = signal<CalBooking[]>([]);
  loaded   = signal(false);

  /** Booking open in the shared detail modal: null = closed. */
  openId = signal<number | 'new' | null>(null);

  /** First-of-month for the currently rendered grid. */
  cursor = signal(new Date(new Date().getFullYear(), new Date().getMonth(), 1));

  monthLabel = computed(() => this.cursor().toLocaleString(undefined, { month: 'long', year: 'numeric' }));
  prevLabel  = computed(() => new Date(this.cursor().getFullYear(), this.cursor().getMonth() - 1, 1).toLocaleString(undefined, { month: 'short' }));
  nextLabel  = computed(() => new Date(this.cursor().getFullYear(), this.cursor().getMonth() + 1, 1).toLocaleString(undefined, { month: 'short' }));

  /** Monday on or before the 1st — the top-left cell of the grid. */
  private gridStart(cur = this.cursor()): Date {
    const dow = (cur.getDay() + 6) % 7;              // Monday-first
    return new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() - dow);
  }

  /** 6x7 grid from the Monday on or before the 1st. */
  cells = computed<DayCell[]>(() => {
    const cur = this.cursor();
    const start = this.gridStart(cur);
    const todayIso = ymd(new Date());

    // Bucket once per render rather than filtering the list 42 times.
    const byDay = new Map<string, CalBooking[]>();
    for (const b of this.bookings()) {
      if (!b.scheduled_at) continue;
      const iso = b.scheduled_at.slice(0, 10);
      const list = byDay.get(iso);
      if (list) list.push(b); else byDay.set(iso, [b]);
    }
    for (const list of byDay.values()) {
      list.sort((a, b) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? ''));
    }

    const out: DayCell[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const iso = ymd(d);
      out.push({
        iso,
        day: d.getDate(),
        inMonth: d.getMonth() === cur.getMonth(),
        isToday: iso === todayIso,
        entries: byDay.get(iso) ?? [],
      });
    }
    return out;
  });

  monthCount = computed(() =>
    this.cells().reduce((n, c) => n + (c.inMonth ? c.entries.length : 0), 0)
  );

  ngOnInit() { this.load(); }

  applyFilter() { this.load(); }

  /**
   * Fetch only the 42 days actually on screen rather than the whole table.
   * `to` is exclusive, matching the half-open range the API expects, so
   * moving month to month never double-counts a boundary day.
   */
  load() {
    const start = this.gridStart();
    const end   = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 42);
    this.api.listLeadBookings({
      from: ymd(start),
      to:   ymd(end),
      ...(this.filterStatus ? { status: this.filterStatus } : {}),
    }).subscribe({
      next: r => {
        this.bookings.set((r.bookings ?? []) as CalBooking[]);
        this.loaded.set(true);
      },
      error: () => this.loaded.set(true),
    });
  }

  /** Save or delete in the modal — refetch so the grid reflects it. A
   *  rescheduled booking can move off this month entirely, which the
   *  ranged refetch handles: it simply won't come back. */
  onModalChanged() { this.load(); }

  step(delta: number) {
    const c = this.cursor();
    this.cursor.set(new Date(c.getFullYear(), c.getMonth() + delta, 1));
    this.load();
  }

  goToToday() {
    const t = new Date();
    this.cursor.set(new Date(t.getFullYear(), t.getMonth(), 1));
    this.load();
  }

  /** UK wall-clock HH:MM, sliced straight out of the stored string. */
  timeOf(b: CalBooking): string {
    return b.scheduled_at ? b.scheduled_at.slice(11, 16) : '';
  }

  tooltip(b: CalBooking): string {
    const bits = [b.name];
    if (b.company) bits.push(b.company);
    bits.push(this.statusLabel(b.status));
    if (b.scheduled_at) bits.push(`${this.timeOf(b)} UK, ${b.duration_minutes} min`);
    if (b.assignee_name) bits.push(`with ${b.assignee_name}`);
    if (b.source) bits.push(`via ${b.source}`);
    return bits.join(' - ');
  }
}
