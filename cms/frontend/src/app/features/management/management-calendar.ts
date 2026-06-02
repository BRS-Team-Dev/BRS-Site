import { Component, computed, inject, signal } from '@angular/core';
import { Api } from '../../core/api';
import { HrTimeOffEntry } from '../../core/models';

interface DayCell {
  date: Date;
  iso: string;
  inMonth: boolean;
  isToday: boolean;
  entries: HrTimeOffEntry[];
}

const KIND_COLOR: Record<string, string> = {
  vacation: '#10b981',
  sick:     '#ef4444',
  personal: '#a78bfa',
  unpaid:   '#6b7280',
  other:    '#f59e0b',
};

@Component({
  selector: 'app-management-calendar',
  template: `
    <div class="toolbar">
      <h1>Team calendar</h1>
      <span class="spacer"></span>
      <div class="nav">
        <button class="ghost" (click)="step(-1)">‹ {{ prevLabel() }}</button>
        <span class="month-label">{{ monthLabel() }}</span>
        <button class="ghost" (click)="step(1)">{{ nextLabel() }} ›</button>
        <button class="ghost" (click)="goToToday()">Today</button>
      </div>
    </div>

    <div class="legend">
      <span class="muted small">Kinds:</span>
      @for (k of kinds; track k) {
        <span class="legend-pill" [style.color]="kindColor(k)" [style.border-color]="kindColor(k)">{{ k }}</span>
      }
      <span class="spacer"></span>
      <span class="muted small">Showing approved &amp; pending requests for direct reports.</span>
    </div>

    <div class="cal">
      <div class="dow-row">
        @for (d of dayHeaders; track d) { <div class="dow">{{ d }}</div> }
      </div>
      <div class="grid">
        @for (cell of cells(); track cell.iso) {
          <div class="cell"
               [class.out]="!cell.inMonth"
               [class.today]="cell.isToday">
            <div class="day-num">{{ cell.date.getDate() }}</div>
            <div class="entries">
              @for (e of cell.entries; track e.id) {
                <div class="entry"
                     [style.background]="kindColor(e.kind)"
                     [class.pending]="e.status === 'pending'"
                     [title]="entryTooltip(e)">
                  {{ e.first_name }} {{ e.last_name }}
                </div>
              }
            </div>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .toolbar { padding: 16px 20px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--line); }
    .toolbar h1 { margin: 0; font-size: 22px; }
    .spacer { flex: 1; }
    .nav { display: flex; align-items: center; gap: 8px; }
    .month-label { font-weight: 600; min-width: 160px; text-align: center; }
    .legend { display: flex; align-items: center; gap: 8px; padding: 10px 20px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
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
    .entry {
      padding: 1px 6px;
      border-radius: 3px;
      font-size: 11px;
      color: #0a0a0a;
      font-weight: 600;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .entry.pending {
      background: transparent !important;
      border: 1px dashed currentColor;
      color: var(--fg);
      font-weight: 500;
    }
  `],
})
export class ManagementCalendar {
  private api = inject(Api);

  dayHeaders = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  kinds = ['vacation','sick','personal','unpaid','other'];

  /** First-of-month for the currently rendered grid. */
  cursor = signal(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  entries = signal<HrTimeOffEntry[]>([]);

  monthLabel  = computed(() => this.cursor().toLocaleString(undefined, { month: 'long', year: 'numeric' }));
  prevLabel   = computed(() => new Date(this.cursor().getFullYear(), this.cursor().getMonth() - 1, 1).toLocaleString(undefined, { month: 'short' }));
  nextLabel   = computed(() => new Date(this.cursor().getFullYear(), this.cursor().getMonth() + 1, 1).toLocaleString(undefined, { month: 'short' }));

  /** 6×7 grid of days (5–6 weeks) from the Monday before the 1st to fill the trailing weeks. */
  cells = computed<DayCell[]>(() => {
    const cur = this.cursor();
    const first = new Date(cur);
    // Monday-first: weekday where Mon=0..Sun=6
    const dow = (first.getDay() + 6) % 7;
    const start = new Date(first);
    start.setDate(first.getDate() - dow);

    const today = new Date(); today.setHours(0,0,0,0);
    const out: DayCell[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const iso = d.toISOString().slice(0, 10);
      out.push({
        date: d,
        iso,
        inMonth: d.getMonth() === cur.getMonth(),
        isToday: d.getTime() === today.getTime(),
        entries: this.entriesOn(iso),
      });
    }
    return out;
  });

  ngOnInit() { this.refresh(); }

  refresh() {
    // Show approved + pending so managers can plan against in-flight requests too.
    this.api.listMyTeamTimeOff().subscribe(r => this.entries.set(r.entries.filter(e =>
      e.status === 'approved' || e.status === 'pending'
    )));
  }
  step(delta: number) {
    const c = this.cursor();
    this.cursor.set(new Date(c.getFullYear(), c.getMonth() + delta, 1));
  }
  goToToday() {
    const t = new Date();
    this.cursor.set(new Date(t.getFullYear(), t.getMonth(), 1));
  }
  kindColor(kind?: string): string { return KIND_COLOR[kind || 'other'] || KIND_COLOR['other']; }

  private entriesOn(iso: string): HrTimeOffEntry[] {
    // Inclusive on both ends.
    return this.entries().filter(e => iso >= e.start_date && iso <= e.end_date);
  }
  entryTooltip(e: HrTimeOffEntry): string {
    return `${e.first_name} ${e.last_name} — ${e.kind} (${e.status}) ${e.start_date} → ${e.end_date}`;
  }
}
