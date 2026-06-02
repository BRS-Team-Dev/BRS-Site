import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import { HrJob } from '../../core/models';
import { SettingsService } from '../../core/settings.service';

/**
 * /jobs — public list of all open positions. Anonymous, no shell, no auth.
 * Uses the brand name from settings as the page header.
 */
@Component({
  selector: 'app-public-jobs',
  imports: [RouterLink],
  template: `
    <div class="page">
      <header class="hd">
        <span class="brand">{{ brandName() }}</span>
        <h1>Open positions</h1>
        <p class="muted">{{ jobs().length }} role{{ jobs().length === 1 ? '' : 's' }} currently hiring.</p>
      </header>

      @if (loading()) {
        <p class="muted">Loading…</p>
      } @else if (jobs().length === 0) {
        <div class="empty">
          <h2>Nothing open right now</h2>
          <p class="muted">Check back soon — we publish new openings as they open up.</p>
        </div>
      } @else {
        <ul class="job-list">
          @for (j of jobs(); track j.id) {
            <li class="job-card">
              <a [routerLink]="['/jobs', j.slug]" class="job-link">
                <div class="job-head">
                  <strong>{{ j.title }}</strong>
                  <span class="pill">{{ etLabel(j.employment_type) }}</span>
                </div>
                <div class="muted small">
                  {{ j.department || '—' }}
                  @if (j.location) { · {{ j.location }} }
                  @if (j.salary_min && j.salary_max) { · {{ formatSalary(j) }} }
                </div>
                @if (j.description) { <p class="desc">{{ j.description }}</p> }
                <span class="muted small view">View posting →</span>
              </a>
            </li>
          }
        </ul>
      }

      <footer class="ft">
        <span class="muted small">Powered by {{ brandName() }}</span>
      </footer>
    </div>
  `,
  styles: [`
    :host { display: block; min-height: 100vh; background: #ffffff; color: var(--fg); }
    .page { max-width: 880px; margin: 0 auto; padding: 48px 24px; }
    .hd { padding-bottom: 24px; border-bottom: 1px solid var(--line); margin-bottom: 24px; }
    .hd .brand { font-weight: 700; letter-spacing: 0.4px; color: var(--primary); font-size: 13px; }
    .hd h1 { margin: 8px 0 6px; font-size: 28px; }
    .empty { padding: 60px 0; text-align: center; }
    .empty h2 { margin: 0 0 8px; }

    .job-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
    .job-card {
      background: var(--bg-3); border: 1px solid var(--line); border-radius: var(--radius);
      transition: border-color 0.15s;
    }
    .job-card:hover { border-color: var(--primary); }
    .job-link { display: block; padding: 16px 18px; color: var(--fg); text-decoration: none; }
    .job-head { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
    .job-head strong { font-size: 16px; }
    .pill {
      padding: 1px 6px; border-radius: 4px; font-size: 10px;
      text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      background: var(--bg-2); color: var(--muted); border: 1px solid var(--line);
    }
    .desc {
      margin: 8px 0 6px; font-size: 13px; line-height: 1.5; color: var(--muted);
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .view { color: var(--primary); }

    .ft { padding-top: 24px; margin-top: 32px; border-top: 1px solid var(--line); text-align: center; }
  `],
})
export class PublicJobs {
  private api = inject(Api);
  private svc = inject(SettingsService);
  brandName = this.svc.brandName;

  jobs = signal<HrJob[]>([]);
  loading = signal(true);

  ngOnInit() {
    this.svc.ensureLoaded();
    this.api.listPublicJobs().subscribe({
      next: r => { this.jobs.set(r.jobs); this.loading.set(false); },
      error: () => { this.loading.set(false); },
    });
  }

  etLabel(t: HrJob['employment_type'] | undefined): string {
    switch (t) {
      case 'full_time':  return 'Full-time';
      case 'part_time':  return 'Part-time';
      case 'contractor': return 'Contractor';
      case 'intern':     return 'Intern';
      default:           return t || '';
    }
  }
  formatSalary(j: HrJob): string {
    const cur = j.salary_currency || 'GBP';
    const fmt = (n: number) => new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n);
    return `${fmt(Number(j.salary_min))} – ${fmt(Number(j.salary_max))}`;
  }
}
