import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { SettingsService } from '../core/settings.service';
import { environment } from '@env/environment';

@Component({
  selector: 'app-hr-side-nav',
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
        <a routerLink="/hr/dashboard" routerLinkActive="active">
          <span class="icon">▦</span> Dashboard
        </a>
        <div class="divider"></div>
        <a routerLink="/hr/employees" routerLinkActive="active">
          <span class="icon">👥</span> Employees
        </a>
        <a routerLink="/hr/recruitment" routerLinkActive="active">
          <span class="icon">⊕</span> Recruitment
        </a>
        <a routerLink="/hr/onboarding" routerLinkActive="active">
          <span class="icon">◈</span> Onboarding
        </a>
        <a routerLink="/hr/time-off" routerLinkActive="active">
          <span class="icon">⌛</span> Time off
        </a>
        <!-- Documents moved to Operations (June 2026). Component and
             tables still live here; only the navigation home changed. -->
        <div class="divider"></div>
        <a routerLink="/hr/reviews" routerLinkActive="active">
          <span class="icon">✎</span> Reviews
        </a>
        <a routerLink="/hr/learning" routerLinkActive="active">
          <span class="icon">📚</span> Learning
        </a>
        <a routerLink="/hr/engagement" routerLinkActive="active">
          <span class="icon">♥</span> Engagement
        </a>
        <a routerLink="/hr/succession" routerLinkActive="active">
          <span class="icon">♛</span> Succession
        </a>
        <div class="divider"></div>
        <a routerLink="/hr/change-requests" routerLinkActive="active">
          <span class="icon">⇆</span> Change requests
        </a>
        <a routerLink="/hr/compliance" routerLinkActive="active">
          <span class="icon">⚖</span> Compliance
        </a>
        <a routerLink="/hr/legal" routerLinkActive="active">
          <span class="icon">§</span> Legal
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
export class HrSideNav {
  private svc = inject(SettingsService);
  brandName = this.svc.brandName;
  // Fall back to the bundled BRS icon when no brand logo is configured.
  logoUrl = computed(() => this.svc.brandLogoUrl() || `${environment.basePath}/icon.png`);
  initials = this.svc.brandInitials;
  logoFailed = false;

  constructor() {
    // Load settings if not already cached, so the logo shows even on a direct /hr load.
    this.svc.ensureLoaded();
  }
}
