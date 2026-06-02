import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import { HrEmployee, HrTimeOffEntry, HrCourseAssignment, HrReview } from '../../core/models';

/**
 * /management/dashboard — landing page of the Manager Self-Service portal.
 *
 * Shows direct reports plus quick counts of pending approvals, in-flight
 * reviews, and overdue learning so the manager can triage before drilling in.
 */
@Component({
  selector: 'app-management-dashboard',
  imports: [RouterLink],
  template: `
    <div class="toolbar">
      <h1>Manager dashboard</h1>
    </div>

    @if (notManager()) {
      <div class="empty">
        <p class="muted">You don't have any direct reports linked to your employee record yet.</p>
        <p class="muted small">Ask HR to set <em>manager_id</em> on the employees you manage in the HR Employees page.</p>
      </div>
    } @else {
      <div class="summary">
        <a class="metric" routerLink="/management/team">
          <span class="m-label">Direct reports</span>
          <span class="m-val">{{ team().length }}</span>
        </a>
        <a class="metric" routerLink="/management/approvals">
          <span class="m-label">Pending approvals</span>
          <span class="m-val warn">{{ pendingApprovals() }}</span>
        </a>
        <a class="metric" routerLink="/management/reviews">
          <span class="m-label">Reviews awaiting me</span>
          <span class="m-val warn">{{ reviewsAwaiting() }}</span>
        </a>
        <a class="metric" routerLink="/management/compliance">
          <span class="m-label">Overdue learning</span>
          <span class="m-val danger">{{ overdueLearning() }}</span>
        </a>
      </div>

      <h2 class="sec-title">My team</h2>
      <div class="team-grid">
        @for (e of team(); track e.id) {
          <a class="team-card" [routerLink]="['/hr/employees', e.id]">
            <div class="team-row">
              <strong>{{ e.first_name }} {{ e.last_name }}</strong>
              <span class="status status-{{ e.status }}">{{ e.status?.replace('_', ' ') }}</span>
            </div>
            <span class="muted small">{{ e.position || '—' }}</span>
            <span class="muted small">{{ e.department || '—' }}</span>
          </a>
        }
      </div>
    }
  `,
  styles: [`
    .toolbar { padding: 16px 20px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--line); }
    .toolbar h1 { margin: 0; font-size: 22px; }
    .empty { padding: 48px 20px; text-align: center; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; padding: 16px 20px; }
    .metric {
      padding: 14px; background: var(--bg-2); border: 1px solid var(--line);
      border-radius: var(--radius); display: flex; flex-direction: column; gap: 4px;
      text-decoration: none; color: var(--fg);
      transition: border-color 0.15s, background 0.15s;
    }
    .metric:hover { border-color: var(--primary); background: var(--bg-3); }
    .m-label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
    .m-val { font-size: 24px; font-weight: 700; }
    .m-val.warn   { color: var(--primary); }
    .m-val.danger { color: #ef4444; }
    .sec-title { padding: 20px 20px 8px; margin: 0; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); }
    .team-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; padding: 0 20px 20px; }
    .team-card {
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
      padding: 12px 14px; display: flex; flex-direction: column; gap: 4px;
      text-decoration: none; color: var(--fg);
    }
    .team-card:hover { border-color: var(--primary); }
    .team-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
    .status {
      display: inline-block; padding: 2px 8px; border-radius: 999px;
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      border: 1px solid var(--line);
    }
    .status-active     { color: var(--primary); border-color: var(--primary); }
    .status-onboarding { color: #60a5fa;        border-color: #60a5fa; }
    .status-on_leave   { color: #f97316;        border-color: #f97316; }
    .status-terminated { color: var(--muted); }
  `],
})
export class ManagementDashboard {
  private api = inject(Api);
  private router = inject(Router);

  team = signal<HrEmployee[]>([]);
  pendingApprovals = signal(0);
  reviewsAwaiting = signal(0);
  overdueLearning = signal(0);
  notManager = computed(() => this.team().length === 0);

  ngOnInit() {
    this.api.listMyTeam().subscribe(r => {
      this.team.set(r.team);
      // Pull aggregate counts in parallel once we know we have a team.
      if (r.team.length > 0) {
        this.api.listMyTeamTimeOff('pending').subscribe(rr => this.pendingApprovals.set(rr.entries.length));
        this.api.listMyTeamReviews().subscribe(rr =>
          this.reviewsAwaiting.set(rr.reviews.filter(x => x.status === 'manager_review').length));
        this.api.listMyTeamLearning('overdue').subscribe(rr => this.overdueLearning.set(rr.assignments.length));
      }
    });
  }
}
