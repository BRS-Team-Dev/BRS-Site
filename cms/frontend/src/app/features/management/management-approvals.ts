import { Component, computed, inject, signal } from '@angular/core';
import { Api } from '../../core/api';
import { HrTimeOffEntry } from '../../core/models';

@Component({
  selector: 'app-management-approvals',
  template: `
    <div class="toolbar">
      <h1>Approvals</h1>
      <span class="spacer"></span>
      <div class="filters">
        <button class="filter" [class.active]="filter() === 'pending'"  (click)="filter.set('pending')">Pending ({{ counts().pending }})</button>
        <button class="filter" [class.active]="filter() === 'approved'" (click)="filter.set('approved')">Approved ({{ counts().approved }})</button>
        <button class="filter" [class.active]="filter() === 'denied'"   (click)="filter.set('denied')">Denied ({{ counts().denied }})</button>
        <button class="filter" [class.active]="filter() === 'all'"      (click)="filter.set('all')">All</button>
      </div>
    </div>

    <div class="page">
      @if (visible().length === 0) {
        <div class="empty"><p class="muted small">Nothing in this list right now.</p></div>
      } @else {
        <ul class="slot-list">
          @for (r of visible(); track r.id) {
            <li class="slot" [class.filled]="r.status === 'approved'" [class.missing]="r.status === 'pending'" [class.denied]="r.status === 'denied'">
              <div class="slot-head">
                <strong>{{ r.first_name }} {{ r.last_name }}</strong>
                <span class="kind kind-{{ r.kind }}">{{ r.kind }}</span>
                <span class="status status-{{ r.status }}">{{ r.status }}</span>
                <span class="spacer"></span>
                @if (r.status === 'pending') {
                  <button class="primary" (click)="decide(r, 'approved')">Approve</button>
                  <button class="ghost danger" (click)="decide(r, 'denied')">Deny</button>
                }
              </div>
              <div class="slot-meta small">
                <span>{{ r.position || '—' }}</span>
                <span>· {{ r.start_date }} — {{ r.end_date }}</span>
                <span>· {{ r.days }} day{{ +(r.days || 0) === 1 ? '' : 's' }}</span>
                @if (r.notes) { <span>· {{ r.notes }}</span> }
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
    .filters { display: flex; gap: 4px; }
    .filter {
      background: none; border: 1px solid var(--line); padding: 6px 12px;
      border-radius: var(--radius-sm); color: var(--muted); cursor: pointer; font-size: 12px;
    }
    .filter.active { color: var(--primary); border-color: var(--primary); }

    .page { padding: 20px; background: #ffffff; min-height: calc(100vh - 120px); }
    .empty { padding: 48px 20px; text-align: center; }

    .slot-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .slot {
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
      padding: 12px 14px; display: flex; flex-direction: column; gap: 6px;
    }
    .slot.filled  { border-color: var(--primary); }
    .slot.missing { border-color: #f59e0b; }
    .slot.denied  { border-color: #ef4444; opacity: 0.85; }
    .slot-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .slot-head strong { font-size: 14px; }
    .slot-head .primary, .slot-head .ghost { padding: 4px 12px; font-size: 12px; }
    .slot-meta { padding-top: 6px; border-top: 1px solid var(--line); display: flex; flex-wrap: wrap; gap: 6px; color: var(--fg); }

    .status {
      padding: 1px 8px; border-radius: 999px;
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      border: 1px solid var(--line);
    }
    .status-pending  { color: #f59e0b;        border-color: #f59e0b; background: rgba(245,158,11,0.10); }
    .status-approved { color: var(--primary); border-color: var(--primary); background: rgba(212,169,58,0.12); }
    .status-denied   { color: #ef4444;        border-color: #ef4444; background: rgba(239,68,68,0.10); }
    .status-cancelled{ color: var(--muted); }
    .kind {
      padding: 1px 6px; border-radius: 4px; font-size: 10px;
      text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      border: 1px solid var(--line); color: var(--muted);
    }
  `],
})
export class ManagementApprovals {
  private api = inject(Api);

  entries = signal<HrTimeOffEntry[]>([]);
  filter = signal<'pending' | 'approved' | 'denied' | 'all'>('pending');

  counts = computed(() => {
    const out = { pending: 0, approved: 0, denied: 0 };
    for (const r of this.entries()) {
      if (r.status === 'pending')  out.pending++;
      if (r.status === 'approved') out.approved++;
      if (r.status === 'denied')   out.denied++;
    }
    return out;
  });

  visible = computed(() => {
    const f = this.filter();
    if (f === 'all') return this.entries();
    return this.entries().filter(r => r.status === f);
  });

  ngOnInit() { this.refresh(); }
  refresh() { this.api.listMyTeamTimeOff().subscribe(r => this.entries.set(r.entries)); }
  decide(r: HrTimeOffEntry, status: 'approved' | 'denied') {
    if (!r.id) return;
    this.api.decideMyTeamTimeOff(r.id, status).subscribe(() => this.refresh());
  }
}
