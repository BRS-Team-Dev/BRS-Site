import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import { HrReview } from '../../core/models';

@Component({
  selector: 'app-management-reviews',
  imports: [RouterLink],
  template: `
    <div class="toolbar">
      <h1>Team reviews</h1>
      <span class="spacer"></span>
      <span class="muted small">{{ awaiting().length }} awaiting your input</span>
    </div>

    @if (reviews().length === 0) {
      <div class="empty"><p class="muted">No reviews seeded for your direct reports yet.</p></div>
    } @else {
      <table class="data">
        <thead><tr>
          <th>Employee</th><th>Cycle</th><th>Status</th><th>Self overall</th><th>Manager overall</th><th></th>
        </tr></thead>
        <tbody>
          @for (r of reviews(); track r.id) {
            <tr [class.row-awaiting]="r.status === 'manager_review'">
              <td><strong>{{ r.first_name }} {{ r.last_name }}</strong><div class="muted small">{{ r.position || '—' }}</div></td>
              <td>{{ r.cycle_name }}<div class="muted small">{{ r.period_start }} → {{ r.period_end }}</div></td>
              <td><span class="status status-r-{{ r.status }}">{{ r.status?.replace('_', ' ') }}</span></td>
              <td>{{ r.employee_overall ?? '—' }}</td>
              <td>{{ r.manager_overall ?? '—' }}</td>
              <td class="actions"><a class="ghost" [routerLink]="['/hr/reviews', r.id]">Open →</a></td>
            </tr>
          }
        </tbody>
      </table>
    }
  `,
  styles: [`
    .toolbar { padding: 16px 20px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--line); }
    .toolbar h1 { margin: 0; font-size: 22px; }
    .spacer { flex: 1; }
    .empty { padding: 48px 20px; text-align: center; }
    table.data { margin: 16px 20px; }
    .status {
      display: inline-block; padding: 2px 10px; border-radius: 999px;
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      border: 1px solid var(--line);
    }
    .status-r-not_started   { color: var(--muted); }
    .status-r-self_review   { color: #60a5fa; border-color: #60a5fa; }
    .status-r-manager_review{ color: var(--primary); border-color: var(--primary); }
    .status-r-completed     { color: var(--primary); border-color: var(--primary); }
    .status-r-closed        { color: var(--muted); }
    tr.row-awaiting { background: rgba(212,169,58,0.06); }
    .actions { text-align: right; }
  `],
})
export class ManagementReviews {
  private api = inject(Api);

  reviews = signal<HrReview[]>([]);
  awaiting = computed(() => this.reviews().filter(r => r.status === 'manager_review'));

  ngOnInit() { this.api.listMyTeamReviews().subscribe(r => this.reviews.set(r.reviews)); }
}
