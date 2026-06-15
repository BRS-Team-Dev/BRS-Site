import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { SettingsService } from '../core/settings.service';
import { environment } from '@env/environment';

/**
 * Sidenav for the Recruitment system (`/recruitment/*`). Mirrors the visual
 * pattern of the other system sidenavs.
 */
@Component({
  selector: 'app-recruitment-side-nav',
  imports: [RouterLink, RouterLinkActive],
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
        <a routerLink="/recruitment/dashboard" routerLinkActive="active">
          <span class="icon">▦</span> Dashboard
        </a>
        <a routerLink="/recruitment/clients" routerLinkActive="active">
          <span class="icon">🏢</span> Clients
        </a>
        <a routerLink="/recruitment/candidates" routerLinkActive="active">
          <span class="icon">🎯</span> Candidates
        </a>
        <a routerLink="/recruitment/documentation" routerLinkActive="active">
          <span class="icon">📁</span> Documentation
        </a>
        <a routerLink="/recruitment/settings" routerLinkActive="active">
          <span class="icon">⚙</span> Settings
        </a>
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
  `],
})
export class RecruitmentSideNav {
  private svc = inject(SettingsService);
  brandName = this.svc.brandName;
  logoUrl = computed(() => this.svc.brandLogoUrl() || `${environment.basePath}/icon.png`);
  initials = this.svc.brandInitials;
  logoFailed = false;

  constructor() {
    this.svc.ensureLoaded();
  }
}
