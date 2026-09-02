import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { Api } from '../core/api';
import { Auth } from '../core/auth';
import { SettingsService } from '../core/settings.service';
import { ContractorPermissions } from '../core/models';
import { environment } from '@env/environment';

/**
 * Sidenav for the contractor self-service area (`/contractor/me/*`).
 * The only sidebar a role='contractor' user ever sees — every other
 * system nav is gated to admin/member/viewer via top-nav visibility
 * and the backend 403.
 */
@Component({
  selector: 'app-contractor-me-side-nav',
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
        <a routerLink="/contractor/me" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">
          <span class="icon">▦</span> Overview
        </a>
        @if (perms().view_tasks) {
          <a routerLink="/contractor/me/tasks" routerLinkActive="active">
            <span class="icon">✅</span> Tasks
          </a>
        }
        @if (perms().view_clients) {
          <a routerLink="/contractor/me/clients" routerLinkActive="active">
            <span class="icon">🏢</span> Clients
          </a>
        }
        <a routerLink="/contractor/me/accounts" routerLinkActive="active">
          <span class="icon">💰</span> Accounts &amp; commissions
        </a>
        <div class="divider"></div>
        <a routerLink="/contractor/me/profile" routerLinkActive="active">
          <span class="icon">👤</span> Profile
        </a>
        <a routerLink="/contractor/me/contracts" routerLinkActive="active">
          <span class="icon">📝</span> Contracts
        </a>
        <a routerLink="/contractor/me/documents" routerLinkActive="active">
          <span class="icon">📄</span> Documents
        </a>
        <div class="divider"></div>
        <a routerLink="/contractor/me/account" routerLinkActive="active">
          <span class="icon">⚙</span> Account settings
        </a>
      </nav>
      <div class="foot">
        <span class="muted small">{{ brandName() }} · Contractor</span>
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
export class ContractorMeSideNav {
  auth = inject(Auth);
  private api = inject(Api);
  private svc = inject(SettingsService);
  brandName = this.svc.brandName;
  initials = this.svc.brandInitials;
  logoUrl = computed(() => this.svc.brandLogoUrl() || `${environment.basePath}/icon.png`);
  logoFailed = false;

  // Permissions govern which side-nav entries are visible. Loaded once
  // when the sidebar mounts; contractor-me.ts also re-reads them on
  // every navigation so the profile view stays in sync.
  perms = signal<ContractorPermissions>({
    view_clients: false, view_tasks: false, view_invoices: false,
    upload_documents: false, edit_profile: true,
  });

  constructor() {
    this.svc.ensureLoaded();
    this.api.getContractorMe().subscribe({
      next: r => this.perms.set(r.permissions),
      error: () => {},
    });
  }
}
