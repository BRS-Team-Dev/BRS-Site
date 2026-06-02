import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { ServicePoolEntry, TaskProject, TaskTeam } from '../../core/models';
import { ComboBox, ComboOption } from '../../shared/combo-box';

/**
 * /tasks/taskboard — landing page that shows all teams with their projects.
 */
@Component({
  selector: 'app-tasks-landing',
  imports: [RouterLink, FormsModule, ComboBox],
  template: `
    <div class="toolbar">
      <h1>Tasks</h1>
      @if (selectedTeam(); as st) {
        <span class="team-filter">
          <span class="dot" [style.background]="st.color || '#888'"></span>
          {{ st.name }}
          <a class="clear" routerLink="/tasks/taskboard" title="Show all teams">×</a>
        </span>
      }
      <span class="spacer"></span>
      <a class="ghost" routerLink="/tasks/taskboard/settings" style="margin-right: 8px;">⚙ Settings</a>
      <button class="primary" (click)="toggleNewProject()">
        {{ showNewProject() ? '× Cancel' : '+ New project' }}
      </button>
    </div>

    @if (showNewProject()) {
      <div class="invite-card card">
        <h3>New project</h3>
        <label>Team</label>
        <select [(ngModel)]="draft.team_id" name="tm">
          <option [ngValue]="null">— pick a team —</option>
          @for (t of teams(); track t.id) {
            <option [ngValue]="t.id">{{ t.name }}</option>
          }
        </select>
        <label>Name</label>
        <input [(ngModel)]="draft.name" (ngModelChange)="autoSlug()" name="nm" placeholder="Q2 Website Refresh" />
        <label>Slug</label>
        <input [(ngModel)]="draft.slug" name="sl" placeholder="q2_refresh" />
        <label>Service (optional)</label>
        <div class="muted small" style="margin-top: 0; margin-bottom: 6px;">
          Linking to a service derives the client automatically from the
          onboarding email. Search by client name, form, or price.
        </div>
        <app-combo-box
          [items]="serviceOptions()"
          [selectedValue]="draft.onboarding_client_id ?? null"
          name="svc"
          placeholder="Search services — client, form, price…"
          (valueChange)="onServicePick($event)" />
        <label>Description</label>
        <textarea [(ngModel)]="draft.description" name="ds" rows="2"></textarea>
        @if (newError()) { <div class="error-msg">{{ newError() }}</div> }
        <div class="row" style="margin-top: 12px; gap: 8px;">
          <button class="primary" (click)="createProject()" [disabled]="creating()">
            {{ creating() ? 'Creating…' : 'Create project' }}
          </button>
          <button class="ghost" (click)="closeNewProject()">Done</button>
        </div>
      </div>
    }

    <div class="teams">
      @for (t of visibleTeams(); track t.id) {
        <section class="team-block">
          <header class="team-head">
            <span class="team-dot" [style.background]="t.color || '#888'"></span>
            <h2>{{ t.name }}</h2>
            <span class="muted small">{{ t.project_count ?? 0 }} project{{ (t.project_count ?? 0) === 1 ? '' : 's' }}</span>
          </header>
          @if (projectsByTeam().get(t.id!); as projs) {
            <div class="project-grid">
              @for (p of projs; track p.id) {
                <a class="project-card" [routerLink]="['/tasks/taskboard/projects', p.id]">
                  <div class="proj-name">{{ p.name }}</div>
                  @if (p.description) { <p class="proj-desc">{{ p.description }}</p> }
                  <div class="proj-meta">
                    <span class="badge" [style.borderColor]="t.color">{{ t.name }}</span>
                    @if (p.client_name) { <span class="muted small">· {{ p.client_name }}</span> }
                    <span class="spacer"></span>
                    <span class="muted small">{{ p.item_count ?? 0 }} items</span>
                  </div>
                </a>
              }
            </div>
          } @else {
            <p class="muted">No projects yet for this team.</p>
          }
        </section>
      }
    </div>
  `,
  styles: [`
    .teams { padding: 20px; display: flex; flex-direction: column; gap: 32px; }
    /* Small chip in the toolbar showing the active team filter (when ?team=N
       is set via the sidenav) with a clear-x linking back to /tasks/taskboard. */
    .team-filter {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 4px 10px;
      border: 1px solid var(--line); border-radius: 999px;
      background: var(--bg-2); color: var(--fg);
      font-size: 12px;
    }
    .team-filter .dot { width: 8px; height: 8px; border-radius: 50%; }
    .team-filter .clear {
      color: var(--muted); text-decoration: none; padding: 0 4px;
      border-radius: 4px; line-height: 1;
    }
    .team-filter .clear:hover { color: var(--danger); background: rgba(255,100,100,0.1); }
    .team-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
    .team-head h2 { margin: 0; font-size: 18px; }
    .team-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
    .project-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 14px;
    }
    .project-card {
      display: block; padding: 16px;
      background: var(--bg-2); border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      color: var(--fg); text-decoration: none;
      transition: border-color 0.15s, transform 0.15s;
    }
    .project-card:hover { border-color: var(--primary); transform: translateY(-1px); }
    .proj-name { font-weight: 600; margin-bottom: 6px; }
    .proj-desc { color: var(--muted); font-size: 13px; margin: 0 0 12px 0; line-height: 1.5; }
    .proj-meta { display: flex; align-items: center; gap: 8px; }
    .proj-meta .spacer { flex: 1; }

    .invite-card { margin: 12px 20px 0; padding: 20px; }
    .invite-card label { margin-top: 12px; }
  `],
})
export class TasksLanding {
  private api = inject(Api);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  teams = signal<TaskTeam[]>([]);
  projects = signal<TaskProject[]>([]);
  // Sidenav passes ?team=N to filter the landing page to a single team.
  selectedTeamId = signal<number | null>(null);
  selectedTeam = computed(() => {
    const id = this.selectedTeamId();
    if (id == null) return null;
    return this.teams().find(t => t.id === id) ?? null;
  });
  visibleTeams = computed(() => {
    const id = this.selectedTeamId();
    if (id == null) return this.teams();
    return this.teams().filter(t => t.id === id);
  });
  servicesPool = signal<ServicePoolEntry[]>([]);
  /** Compose a rich label per service so the combo-box's substring filter
   *  works as a multi-attribute search ("Acme", "monthly", "£500", form name). */
  serviceOptions = computed<ComboOption[]>(() => {
    const opts: ComboOption[] = [{ value: null, label: '— none —' }];
    for (const s of this.servicesPool()) {
      const clientLabel = s.client_canonical_name?.trim()
        || s.client_name?.trim()
        || s.client_email
        || 'Client';
      const company = s.client_company?.trim();
      const clientPart = company ? `${clientLabel} (${company})` : clientLabel;
      const terms = this.formatServiceTerms(s);
      const taken = s.linked_project_id ? ' · already linked' : '';
      // Include qualification date so duplicate (form, client) entries are
      // distinguishable when a client has multiple instances of the same service.
      const date = s.qualified_at ? ` · ${s.qualified_at.slice(0, 10)}` : '';
      opts.push({
        value: s.onboarding_client_id,
        label: `${s.form_title} — ${clientPart}${terms ? ' · ' + terms : ''}${date}${taken}`,
      });
    }
    return opts;
  });

  private formatServiceTerms(s: ServicePoolEntry): string {
    if (!s.has_price || s.price == null) return '';
    const n = Number(s.price);
    if (!isFinite(n)) return '';
    const money = n.toLocaleString(undefined, { style: 'currency', currency: 'GBP' });
    if (s.payment_type === 'one_off') return `${money} one-off`;
    const tail = s.is_indefinite
      ? ' · indefinite'
      : (s.contract_length_months ? ` · ${s.contract_length_months} mo` : '');
    return `${money} / ${s.repeat_duration ?? 'period'}${tail}`;
  }
  projectsByTeam = computed(() => {
    const map = new Map<number, TaskProject[]>();
    for (const p of this.projects()) {
      const list = map.get(p.team_id) ?? [];
      list.push(p);
      map.set(p.team_id, list);
    }
    return map;
  });

  showNewProject = signal(false);
  creating = signal(false);
  newError = signal<string | null>(null);
  draft: TaskProject = { team_id: 0, slug: '', name: '', description: '' };

  ngOnInit() {
    this.api.listTaskTeams().subscribe(r => this.teams.set(r.teams));
    this.api.listTaskProjects().subscribe(r => this.projects.set(r.projects));
    this.api.listServicesPool().subscribe(r => this.servicesPool.set(r.services));
    this.route.queryParamMap.subscribe(q => {
      const raw = q.get('team');
      const id = raw != null && /^\d+$/.test(raw) ? +raw : null;
      this.selectedTeamId.set(id);
    });
  }

  onServicePick(v: string | number | null) {
    const id = (typeof v === 'number' && v > 0) ? v : null;
    this.draft.onboarding_client_id = id;
    // Eagerly mirror the client_id from the picked service so cards in the
    // grid show client_name without waiting for a project refetch. The
    // backend re-derives this on save anyway.
    if (id) {
      const match = this.servicesPool().find(s => s.onboarding_client_id === id);
      this.draft.client_id = match?.client_id ?? null;
    } else {
      this.draft.client_id = null;
    }
  }

  toggleNewProject() {
    if (this.showNewProject()) this.closeNewProject();
    else this.openNewProject();
  }
  openNewProject() {
    this.draft = {
      team_id: this.teams()[0]?.id ?? 0,
      slug: '', name: '', description: '',
      client_id: null, onboarding_client_id: null,
    };
    this.newError.set(null);
    this.showNewProject.set(true);
  }
  closeNewProject() {
    this.showNewProject.set(false);
    this.newError.set(null);
  }
  autoSlug() {
    const slug = (this.draft.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').substring(0, 60);
    if (slug && /^[a-z]/.test(slug)) this.draft.slug = slug;
  }
  createProject() {
    this.newError.set(null);
    if (!this.draft.team_id) { this.newError.set('Pick a team'); return; }
    if (!this.draft.name?.trim()) { this.newError.set('Name required'); return; }
    if (!/^[a-z][a-z0-9_-]{0,79}$/.test(this.draft.slug || '')) { this.newError.set('Invalid slug'); return; }
    this.creating.set(true);
    this.api.createTaskProject(this.draft).subscribe({
      next: r => {
        this.creating.set(false);
        this.closeNewProject();
        this.router.navigate(['/tasks/taskboard/projects', r.id]);
      },
      error: e => { this.creating.set(false); this.newError.set(e?.error?.error || 'Failed'); },
    });
  }
}
