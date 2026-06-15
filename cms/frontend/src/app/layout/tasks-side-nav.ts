import { Component, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter } from 'rxjs';
import { Api } from '../core/api';
import { TaskTeam } from '../core/models';
import { environment } from '@env/environment';
import { SettingsService } from '../core/settings.service';

/**
 * Tasks system sidenav (`/tasks/*`).
 *
 * Top-level entry: Taskboard. Underneath, each task team is rendered as a
 * child link that filters the Taskboard landing to that team via
 * `?team=<id>` (existing convention, see `tasks-landing.ts`).
 */
@Component({
  selector: 'app-tasks-side-nav',
  imports: [RouterLink],
  template: `
    <aside>
      <div class="brand">
        @if (logoUrl()) {
          <img class="logo" [src]="logoUrl()" alt="" (error)="logoFailed = true" [hidden]="logoFailed" />
        }
        @if (!logoUrl() || logoFailed) {
          <span class="mark">{{ initials() }}</span>
        }
        <span class="name">{{ brandName() }}</span>
      </div>
      <nav>
        <div class="nav-group">
          <a routerLink="/tasks/taskboard" [class.active]="isTaskboardActive()">
            <span class="icon">▦</span> Taskboard
            @if (taskTeams().length > 0) { <span class="caret">›</span> }
          </a>
          @if (taskTeams().length > 0) {
            <div class="children">
              @for (t of taskTeams(); track t.id) {
                <a [routerLink]="['/tasks/taskboard']" [queryParams]="{ team: t.id }">
                  <span class="icon" [style.color]="t.color || ''">◆</span> {{ t.name }}
                </a>
              }
            </div>
          }
        </div>

        <div class="nav-group">
          <a routerLink="/tasks/team" [class.active]="isTeamActive()">
            <span class="icon">◉</span> Team
          </a>
        </div>
      </nav>
    </aside>
  `,
  styles: [`
    aside {
      width: 220px;
      background: var(--bg-2);
      border-right: 1px solid var(--line);
      display: flex; flex-direction: column;
      height: 100%;
    }
    .brand {
      display: flex; align-items: center; gap: 10px;
      height: 52px; padding: 0 18px;
      border-bottom: 1px solid var(--line);
    }
    .brand .mark {
      display: inline-flex; align-items: center; justify-content: center;
      width: 30px; height: 30px;
      background: var(--primary); color: #0a0a0a;
      font-weight: 800; font-size: 12px; letter-spacing: 0.5px;
      border-radius: var(--radius-sm);
      flex-shrink: 0;
    }
    .brand .logo { width: 30px; height: 30px; object-fit: contain; border-radius: var(--radius-sm); flex-shrink: 0; }
    .brand .name { font-weight: 700; font-size: 14px; letter-spacing: 0.4px; color: var(--fg); }
    nav {
      flex: 1;
      padding: 12px 10px;
      display: flex; flex-direction: column; gap: 2px;
      overflow-y: auto;
    }
    a {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 12px; border-radius: var(--radius-sm);
      color: var(--fg); font-size: 14px;
      transition: background 0.15s, color 0.15s;
    }
    a:hover { background: var(--bg-3); }
    a.active { background: var(--bg-3); color: var(--primary); }
    .icon { width: 20px; text-align: center; opacity: 0.85; }
    .caret { margin-left: auto; opacity: 0.6; transition: transform 0.2s; }
    .nav-group:has(.active) > a > .caret,
    .nav-group:hover > a > .caret { transform: rotate(90deg); }
    .children {
      display: none;
      flex-direction: column; gap: 2px;
      margin: 4px 0 4px 10px;
      padding-left: 10px;
      border-left: 1px solid var(--line);
    }
    .children a { font-size: 13px; padding: 8px 12px; }
    .nav-group:has(.active) > .children,
    .nav-group:hover > .children { display: flex; }
  `],
})
export class TasksSideNav {
  private svc = inject(SettingsService);
  private api = inject(Api);
  private router = inject(Router);

  brandName = this.svc.brandName;
  // Fall back to the bundled BRS icon when no brand logo is configured.
  logoUrl   = computed(() => this.svc.brandLogoUrl() || `${environment.basePath}/icon.png`);
  initials  = this.svc.brandInitials;
  logoFailed = false;

  taskTeams = signal<TaskTeam[]>([]);
  currentUrl = signal<string>(this.router.url);

  isTaskboardActive(): boolean {
    const url = this.currentUrl();
    return url === '/tasks/taskboard'
      || url.startsWith('/tasks/taskboard/')
      || url.startsWith('/tasks/taskboard?');
  }

  isTeamActive(): boolean {
    const url = this.currentUrl();
    return url === '/tasks/team' || url.startsWith('/tasks/team/');
  }

  constructor() {
    this.svc.ensureLoaded();
    this.loadTaskTeams();
    this.router.events
      .pipe(filter(e => e instanceof NavigationEnd))
      .subscribe(e => {
        const url = (e as NavigationEnd).urlAfterRedirects;
        this.currentUrl.set(url);
        if (url.startsWith('/tasks/taskboard')) this.loadTaskTeams();
      });
  }

  private loadTaskTeams() {
    this.api.listTaskTeams().subscribe({
      next: r => this.taskTeams.set(r.teams),
      error: () => {/* silent — likely not authed yet */},
    });
  }
}
