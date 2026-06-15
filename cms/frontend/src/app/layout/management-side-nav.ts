import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { SettingsService } from '../core/settings.service';
import { environment } from '@env/environment';

@Component({
  selector: 'app-management-side-nav',
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
        <a routerLink="/management/dashboard" routerLinkActive="active">
          <span class="icon">▦</span> Dashboard
        </a>
        <a routerLink="/management/team" routerLinkActive="active">
          <span class="icon">👥</span> My team
        </a>
        <div class="divider"></div>
        <a routerLink="/management/approvals" routerLinkActive="active">
          <span class="icon">✓</span> Approvals
        </a>
        <a routerLink="/management/calendar" routerLinkActive="active">
          <span class="icon">📅</span> Team calendar
        </a>
        <a routerLink="/management/schedule" routerLinkActive="active">
          <span class="icon">⏱</span> Shifts &amp; schedule
        </a>
        <div class="divider"></div>
        <a routerLink="/management/reviews" routerLinkActive="active">
          <span class="icon">✎</span> Reviews
        </a>
        <a routerLink="/management/feedback" routerLinkActive="active">
          <span class="icon">💬</span> Feedback &amp; 1:1s
        </a>
        <a routerLink="/management/goals" routerLinkActive="active">
          <span class="icon">◎</span> Goals
        </a>
        <a routerLink="/management/skills" routerLinkActive="active">
          <span class="icon">★</span> Skills
        </a>
        <div class="divider"></div>
        <a routerLink="/management/hiring" routerLinkActive="active">
          <span class="icon">⊕</span> Hiring
        </a>
        <a routerLink="/management/succession" routerLinkActive="active">
          <span class="icon">♛</span> Succession
        </a>
        <div class="divider"></div>
        <a routerLink="/management/analytics" routerLinkActive="active">
          <span class="icon">📊</span> Analytics
        </a>
        <a routerLink="/management/compliance" routerLinkActive="active">
          <span class="icon">⚖</span> Compliance alerts
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
    .divider { height: 1px; background: var(--line); margin: 8px 6px; }
  `],
})
export class ManagementSideNav {
  private svc = inject(SettingsService);
  brandName = this.svc.brandName;
  // Fall back to the bundled BRS icon when no brand logo is configured.
  logoUrl = computed(() => this.svc.brandLogoUrl() || `${environment.basePath}/icon.png`);
  initials = this.svc.brandInitials;
  logoFailed = false;

  constructor() {
    this.svc.ensureLoaded();
  }
}
