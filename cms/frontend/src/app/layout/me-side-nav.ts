import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { Auth } from '../core/auth';
import { SettingsService } from '../core/settings.service';
import { environment } from '@env/environment';

/**
 * Sidenav for the per-user "My Account" area (`/me/*`).
 *
 * Mirrors the visual pattern of HrSideNav / ManagementSideNav but instead of
 * org-wide functions it lists the sections an employee can manage about
 * themselves: profile, payslips, time off, documents, reviews, learning,
 * engagement (pulse + feedback), and the account-level settings page
 * (password / appearance).
 */
@Component({
  selector: 'app-me-side-nav',
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
        <a routerLink="/me" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">
          <span class="icon">▦</span> Overview
        </a>
        <a routerLink="/me/tasks" routerLinkActive="active">
          <span class="icon">✅</span> Tasks
        </a>
        <a routerLink="/me/accounts" routerLinkActive="active">
          <span class="icon">💰</span> Accounts &amp; commissions
        </a>
        <div class="divider"></div>
        <a routerLink="/me/profile" routerLinkActive="active">
          <span class="icon">👤</span> Profile
        </a>
        <a routerLink="/me/payslips" routerLinkActive="active">
          <span class="icon">💵</span> Payslips
        </a>
        <a routerLink="/me/time-off" routerLinkActive="active">
          <span class="icon">⌛</span> Time off
        </a>
        <a routerLink="/me/shifts" routerLinkActive="active">
          <span class="icon">⏱</span> Shifts
        </a>
        <a routerLink="/me/documents" routerLinkActive="active">
          <span class="icon">📄</span> Documents
        </a>
        <div class="divider"></div>
        <a routerLink="/me/reviews" routerLinkActive="active">
          <span class="icon">✎</span> Reviews
        </a>
        <a routerLink="/me/learning" routerLinkActive="active">
          <span class="icon">📚</span> Learning
        </a>
        <a routerLink="/me/goals" routerLinkActive="active">
          <span class="icon">◎</span> Goals
        </a>
        <a routerLink="/me/skills" routerLinkActive="active">
          <span class="icon">★</span> Skills
        </a>
        <a routerLink="/me/feedback" routerLinkActive="active">
          <span class="icon">💬</span> Feedback &amp; 1:1s
        </a>
        <a routerLink="/me/engagement" routerLinkActive="active">
          <span class="icon">♥</span> Pulse surveys
        </a>
        <div class="divider"></div>
        <a routerLink="/me/account" routerLinkActive="active">
          <span class="icon">⚙</span> Account settings
        </a>
      </nav>
      <div class="foot">
        <span class="muted small">{{ brandName() }} · My Account</span>
      </div>
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
      min-height: 52px; padding: 8px 14px;
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
    .foot { padding: 12px 14px; border-top: 1px solid var(--line); }
  `],
})
export class MeSideNav {
  auth = inject(Auth);
  private svc = inject(SettingsService);
  brandName = this.svc.brandName;
  initials = this.svc.brandInitials;
  logoUrl = computed(() => this.svc.brandLogoUrl() || `${environment.basePath}/icon.png`);
  logoFailed = false;

  constructor() { this.svc.ensureLoaded(); }
}
