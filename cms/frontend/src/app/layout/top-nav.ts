import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api';
import { Auth } from '../core/auth';
import { DialogService } from '../core/dialog';
import { TenantSummary } from '../core/models';
import { SettingsService } from '../core/settings.service';
import { SystemService, SystemKey } from '../core/system.service';
import { NotificationBell } from './notification-bell';
import { Router } from '@angular/router';

@Component({
  selector: 'app-top-nav',
  imports: [RouterLink, NotificationBell],
  template: `
    @if (auth.isImpersonating()) {
      <!-- Banner pinned across the top whenever the caller is inside
           someone else's account. Two variants: tenant-level
           impersonation (super-admin), and user-level impersonation
           (admin signed in as a contractor). Both restore via
           Auth.switchBack(). -->
      <div class="imp-banner">
        <span class="imp-dot"></span>
        @if (auth.isImpersonatingUser()) {
          Signed in as
          @if (auth.user(); as u) { <strong>{{ u.display_name || u.email }}</strong> }
          — you are seeing what they see. Actions taken here are attributed to them.
        } @else {
          Impersonating
          @if (currentTenantBrand(); as b) { <strong>{{ b }}</strong> }
          — your changes are attributed as System within this tenant.
        }
        <button class="imp-back" (click)="switchBack()" title="Return to your own account">
          ↩ Switch back
        </button>
      </div>
    }
    <nav>
      @if (!isContractor()) {
        <div class="system-switcher" (click)="open.set(!open())">
          <span class="title">{{ system.currentDef().label }}</span>
          <span class="caret">▾</span>
          @if (open()) {
            <div class="picker-backdrop" (click)="open.set(false); $event.stopPropagation()"></div>
            <div class="picker-pop" (click)="$event.stopPropagation()">
              @for (s of pickerSystems(); track s.key) {
                <button class="picker-opt"
                        [class.selected]="system.current() === s.key"
                        [class.placeholder]="s.placeholder"
                        (click)="switch(s.key)">
                  <span class="sys-dot" [attr.data-sys]="s.key"></span>
                  <span class="sys-label">{{ s.label }}</span>
                  @if (s.placeholder) { <span class="muted small">soon</span> }
                </button>
              }
            </div>
          }
        </div>
      } @else {
        <span class="title">{{ system.currentDef().label }}</span>
      }
      <span class="spacer"></span>
      @if (auth.isSuper()) {
        <!-- Super-admin only: cross-tenant switcher. Lists every tenant
             from the registry; clicking one calls /api/auth/impersonate
             which returns a JWT scoped to the target tenant. The home
             token gets stashed in localStorage so Switch back works
             without a re-login. -->
        <div class="tenant-switcher" (click)="tenantOpen.set(!tenantOpen()); $event.stopPropagation()">
          <span class="ts-dot" [class.active]="!auth.isImpersonating()"></span>
          <span class="ts-label">{{ currentTenantBrand() || ('Tenant ' + auth.tenantId()) }}</span>
          <span class="caret">▾</span>
          @if (tenantOpen()) {
            <div class="picker-backdrop" (click)="tenantOpen.set(false); $event.stopPropagation()"></div>
            <div class="picker-pop tenant-pop" (click)="$event.stopPropagation()">
              <div class="ts-head muted small">Switch tenant</div>
              @if (loadingTenants()) {
                <div class="ts-load">Loading…</div>
              } @else if (tenants().length === 0) {
                <div class="ts-empty muted small">No tenants found.</div>
              } @else {
                @for (t of tenants(); track t.id) {
                  <button class="picker-opt tenant-opt"
                          [class.selected]="auth.tenantId() === t.id"
                          [class.suspended]="t.status === 'suspended' || t.status === 'deleted'"
                          [disabled]="t.status !== 'active'"
                          (click)="impersonate(t)">
                    <span class="sys-dot" [attr.data-status]="t.status"></span>
                    <span class="sys-label">{{ t.brand_name }}</span>
                    <span class="muted small">{{ t.slug }}</span>
                    @if (t.status !== 'active') {
                      <span class="ts-pill" [attr.data-status]="t.status">{{ t.status }}</span>
                    }
                  </button>
                }
              }
              @if (auth.isImpersonating()) {
                <div class="divider"></div>
                <button class="picker-opt tenant-back" (click)="switchBack()">
                  <span class="sys-dot" data-status="home"></span>
                  <span class="sys-label">↩ Switch back to home tenant</span>
                </button>
              }
            </div>
          }
        </div>
      }
      <!-- Theme is now tenant-level (chosen at signup or from
           /me/account → Appearance). No per-user dark/light toggle. -->

      <!-- Notification bell — sub-tabbed panel per system section,
           badge shows total unread across all sections. -->
      @if (auth.user()) {
        <app-notification-bell></app-notification-bell>
      }

      @if (auth.user(); as u) {
        <div class="user-menu" (click)="userOpen.set(!userOpen()); $event.stopPropagation()">
          <span class="user-avatar">{{ initials(u.display_name || u.email) }}</span>
          <span class="user-label muted small">{{ u.display_name || u.email }}</span>
          <span class="caret">▾</span>
          @if (userOpen()) {
            <div class="picker-backdrop" (click)="userOpen.set(false); $event.stopPropagation()"></div>
            <div class="user-pop" (click)="$event.stopPropagation()">
              <div class="user-head">
                <strong>{{ u.display_name || u.email }}</strong>
                @if (u.display_name) { <span class="muted small">{{ u.email }}</span> }
              </div>
              <div class="divider"></div>
              @for (link of myAccountLinks(); track link.href) {
                <a class="user-opt" [routerLink]="link.href" (click)="userOpen.set(false)">
                  <span class="opt-icon">{{ link.icon }}</span>
                  <span class="opt-label">{{ link.label }}</span>
                </a>
              }
              @if (auth.isImpersonating()) {
                <div class="divider"></div>
                <button class="user-opt switch-back-opt" (click)="userOpen.set(false); switchBack()">
                  <span class="opt-icon">↩</span>
                  <span class="opt-label">
                    @if (auth.isImpersonatingUser()) { End impersonation }
                    @else { Return to home tenant }
                  </span>
                </button>
              }
              <div class="divider"></div>
              <button class="user-opt logout" (click)="userOpen.set(false); auth.logout()">
                <span class="opt-icon">⎋</span>
                <span class="opt-label">Logout</span>
              </button>
            </div>
          }
        </div>
      }
    </nav>
  `,
  styles: [`
    nav {
      display: flex; align-items: center; gap: 12px;
      padding: 12px 20px;
      background: var(--bg);
      border-bottom: 1px solid var(--line);
      height: 52px;
    }
    .system-switcher {
      position: relative;
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 12px;
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      cursor: pointer;
      background: var(--bg-2);
      transition: border-color 0.15s;
    }
    .system-switcher:hover { border-color: var(--primary); }
    .title { font-weight: 700; letter-spacing: 0.4px; color: var(--fg); font-size: 13px; }
    .caret { color: var(--muted); font-size: 11px; }
    .spacer { flex: 1; }
    .picker-backdrop {
      position: fixed; inset: 0;
      z-index: 100;
    }
    .picker-pop {
      position: absolute; top: calc(100% + 6px); left: 0;
      min-width: 200px;
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
      box-shadow: var(--shadow);
      padding: 4px;
      z-index: 101;
      display: flex; flex-direction: column; gap: 2px;
    }
    .picker-opt {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 10px;
      background: transparent; border: 0; border-radius: var(--radius-sm);
      color: var(--fg); cursor: pointer; text-align: left;
      font-size: 13px;
    }
    .picker-opt:hover { background: var(--bg-3); }
    .picker-opt.selected { background: var(--bg-3); color: var(--primary); }
    .picker-opt.placeholder { opacity: 0.55; }
    .sys-label { flex: 1; }
    .sys-dot {
      width: 10px; height: 10px; border-radius: 50%;
      background: var(--muted);
      flex-shrink: 0;
    }
    .sys-dot[data-sys="cms"]        { background: var(--primary); }
    .sys-dot[data-sys="hr"]         { background: #10b981; }
    .sys-dot[data-sys="management"] { background: #a78bfa; }
    .sys-dot[data-sys="operations"] { background: #f97316; }
    .sys-dot[data-sys="recruitment"]{ background: #ec4899; }
    .sys-dot[data-sys="accounting"] { background: #14b8a6; }
    .sys-dot[data-sys="crm"]        { background: #3b82f6; }
    .sys-dot[data-sys="account"]    { background: #f59e0b; }
    .sys-dot[data-sys="support"]    { background: #ef4444; }

    .user-menu {
      position: relative;
      display: inline-flex; align-items: center; gap: 8px;
      padding: 4px 10px 4px 4px;
      border: 1px solid var(--line); border-radius: var(--radius-sm);
      background: var(--bg-2); cursor: pointer;
      transition: border-color 0.15s;
    }
    .user-menu:hover { border-color: var(--primary); }
    .user-avatar {
      width: 28px; height: 28px; border-radius: 50%;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--primary); color: #0a0a0a;
      font-size: 11px; font-weight: 700; letter-spacing: 0.5px;
    }
    .user-label { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .user-pop {
      position: absolute; top: calc(100% + 6px); right: 0;
      min-width: 260px;
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
      box-shadow: var(--shadow);
      padding: 4px;
      z-index: 101;
      display: flex; flex-direction: column; gap: 2px;
    }
    .user-head {
      padding: 10px 12px 6px;
      display: flex; flex-direction: column; gap: 2px;
    }
    .user-head strong { font-size: 13px; }
    .divider { height: 1px; background: var(--line); margin: 4px 0; }
    .user-opt {
      display: grid; grid-template-columns: 24px 1fr auto; gap: 10px; align-items: center;
      padding: 8px 10px;
      background: transparent; border: 0; border-radius: var(--radius-sm);
      color: var(--fg); cursor: pointer; text-align: left;
      font-size: 13px;
      text-decoration: none;
      width: 100%;
    }
    .user-opt:hover { background: var(--bg-3); }
    .user-opt .opt-icon { color: var(--primary); font-size: 16px; text-align: center; }
    .user-opt.logout { color: #ef4444; }
    .user-opt.logout:hover { background: rgba(239,68,68,0.10); }
    .user-opt.logout .opt-icon { color: #ef4444; }
    .user-opt.switch-back-opt { color: var(--primary); font-weight: 600; }
    .user-opt.switch-back-opt:hover { background: color-mix(in srgb, var(--primary) 12%, transparent); }
    .user-opt.switch-back-opt .opt-icon { color: var(--primary); }

    /* Impersonation banner — shown across the top whenever a super-
       admin is operating inside someone else's tenant. Vivid colour
       so it can never be mistaken for normal chrome. */
    .imp-banner {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 20px;
      background: linear-gradient(90deg, rgba(239,68,68,0.18), rgba(239,68,68,0.06));
      border-bottom: 1px solid #ef4444;
      color: #ef4444;
      font-size: 13px; font-weight: 600;
      letter-spacing: 0.2px;
    }
    .imp-banner strong { color: var(--fg); margin: 0 4px; }
    .imp-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: #ef4444;
      box-shadow: 0 0 0 0 rgba(239,68,68,0.7);
      animation: imp-pulse 2s infinite;
      flex-shrink: 0;
    }
    @keyframes imp-pulse {
      0%   { box-shadow: 0 0 0 0 rgba(239,68,68,0.7); }
      70%  { box-shadow: 0 0 0 8px rgba(239,68,68,0); }
      100% { box-shadow: 0 0 0 0 rgba(239,68,68,0); }
    }
    .imp-back {
      margin-left: auto;
      padding: 4px 12px;
      background: var(--bg-2);
      border: 1px solid #ef4444; border-radius: 999px;
      color: #ef4444; cursor: pointer;
      font-size: 12px; font-weight: 700;
    }
    .imp-back:hover { background: #ef4444; color: #fff; }

    /* Super-admin tenant switcher — sits next to the theme button.
       Looks like the system-switcher pill but bordered in gold so it's
       clearly the cross-tenant control, not the system picker. */
    .tenant-switcher {
      position: relative;
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 12px;
      background: var(--bg-2);
      border: 1px solid var(--primary);
      border-radius: var(--radius-sm);
      cursor: pointer;
      transition: background 0.15s;
    }
    .tenant-switcher:hover { background: var(--bg-3); }
    .ts-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: var(--muted);
      flex-shrink: 0;
    }
    .ts-dot.active { background: var(--primary); }
    .ts-label { color: var(--fg); font-size: 13px; font-weight: 600; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tenant-pop {
      right: 0; left: auto;
      min-width: 260px;
    }
    .ts-head { padding: 8px 12px 4px; text-transform: uppercase; letter-spacing: 0.5px; font-size: 10px; }
    .ts-load, .ts-empty { padding: 12px; text-align: center; font-size: 13px; }
    .tenant-opt {
      display: grid; grid-template-columns: 12px 1fr auto auto; gap: 10px; align-items: center;
    }
    .tenant-opt[disabled] { opacity: 0.5; cursor: not-allowed; }
    .tenant-opt .sys-dot[data-status="active"]    { background: #10b981; }
    .tenant-opt .sys-dot[data-status="provisioning"] { background: var(--primary); }
    .tenant-opt .sys-dot[data-status="suspended"] { background: #ef4444; }
    .tenant-opt .sys-dot[data-status="deleted"]   { background: var(--muted); }
    .tenant-opt .sys-dot[data-status="home"]      { background: var(--primary); }
    .ts-pill {
      padding: 1px 6px; border-radius: 4px; font-size: 10px;
      text-transform: uppercase; letter-spacing: 0.4px; font-weight: 700;
      border: 1px solid currentColor;
    }
    .ts-pill[data-status="suspended"] { color: #ef4444; }
    .ts-pill[data-status="deleted"]   { color: var(--muted); }
    .tenant-back { color: var(--primary); }
  `],
})
export class TopNav {
  private svc = inject(SettingsService);
  private api = inject(Api);
  private dialog = inject(DialogService);
  auth = inject(Auth);
  system = inject(SystemService);
  private router = inject(Router);
  brandName = this.svc.brandName;
  open = signal(false);
  userOpen = signal(false);

  // ── Super-admin tenant switcher state ─────────────────────────────
  tenantOpen      = signal(false);
  tenants         = signal<TenantSummary[]>([]);
  loadingTenants  = signal(false);
  /** Display name for the tenant the user is CURRENTLY operating in.
   *  Derived from the cached tenants list — the JWT only carries the
   *  numeric id, so we look it up here for the banner + switcher pill. */
  currentTenantBrand = computed(() => {
    const id = this.auth.tenantId();
    return this.tenants().find(t => t.id === id)?.brand_name ?? null;
  });

  constructor() {
    // Whenever the dropdown opens AND we're a super-admin, fetch the
    // tenants list. Effects re-run on signal changes — opening from
    // closed → open triggers the fetch; closing is cheap and skipped.
    effect(() => {
      if (!this.tenantOpen() || !this.auth.isSuper()) return;
      // Already loaded? skip.
      if (this.tenants().length > 0 || this.loadingTenants()) return;
      this.loadingTenants.set(true);
      this.api.listAllTenants().subscribe({
        next: r => { this.tenants.set(r.tenants); this.loadingTenants.set(false); },
        error: () => { this.tenants.set([]); this.loadingTenants.set(false); },
      });
    });
    // Also load on first init when super so the banner brand-name
    // resolves without needing to open the switcher first.
    effect(() => {
      if (!this.auth.isSuper() || this.tenants().length > 0 || this.loadingTenants()) return;
      this.loadingTenants.set(true);
      this.api.listAllTenants().subscribe({
        next: r => { this.tenants.set(r.tenants); this.loadingTenants.set(false); },
        error: () => { this.tenants.set([]); this.loadingTenants.set(false); },
      });
    });
    // When the caller is a contractor (including via impersonation), fetch
    // their permission flags so the dropdown only lists Clients / Tasks if
    // those flags are on — same rule the sidebar uses.
    effect(() => {
      if (!this.isContractor() || this.contractorPerms() !== null) return;
      this.api.getContractorMe().subscribe({
        next: r => this.contractorPerms.set(r.permissions),
        error: () => this.contractorPerms.set({}),
      });
    });
  }

  /** Systems shown in the picker — `hidden: true` ones (like 'me') are reached elsewhere. */
  pickerSystems = () => this.system.systems.filter(s => !s.hidden);

  /** Contractor role = self-service portal only. Hides the system switcher
   *  and the super-admin tenant switcher, and swaps My Account entries to
   *  the /contractor/me/* portal. */
  isContractor = computed(() => (this.auth.user() as { role?: string } | null)?.role === 'contractor');
  myAccountLink = computed(() => this.isContractor() ? '/contractor/me' : '/me');

  /** Permissions gate the Clients / Tasks entries in the dropdown for
   *  contractors — same rule the sidebar uses. Lazy-loaded once when
   *  the caller is a contractor; refetched if the role changes. */
  contractorPerms = signal<{ view_clients?: boolean; view_tasks?: boolean } | null>(null);

  /** Expanded My-Account menu — one entry per section so the dropdown
   *  gives access to everything under it, matching the sidebar. */
  myAccountLinks = computed<Array<{ href: string; label: string; icon: string }>>(() => {
    if (this.isContractor()) {
      const p = this.contractorPerms() ?? {};
      const links: Array<{ href: string; label: string; icon: string }> = [
        { href: '/contractor/me',           label: 'Overview',   icon: '▦' },
      ];
      if (p.view_tasks)   links.push({ href: '/contractor/me/tasks',   label: 'Tasks',   icon: '✅' });
      if (p.view_clients) links.push({ href: '/contractor/me/clients', label: 'Clients', icon: '🏢' });
      links.push(
        { href: '/contractor/me/accounts',  label: 'Accounts & commissions', icon: '💰' },
        { href: '/contractor/me/profile',   label: 'Profile',          icon: '👤' },
        { href: '/contractor/me/contracts', label: 'Contracts',        icon: '📝' },
        { href: '/contractor/me/documents', label: 'Documents',        icon: '📄' },
        { href: '/contractor/me/account',   label: 'Account settings', icon: '⚙' },
      );
      return links;
    }
    // Employees / admins — mirrors the /me sidebar entries.
    return [
      { href: '/me',            label: 'Overview',         icon: '▦' },
      { href: '/me/tasks',      label: 'Tasks',            icon: '✅' },
      { href: '/me/accounts',   label: 'Accounts & commissions', icon: '💰' },
      { href: '/me/profile',    label: 'Profile',          icon: '👤' },
      { href: '/me/payslips',   label: 'Payslips',         icon: '💵' },
      { href: '/me/time-off',   label: 'Time off',         icon: '⌛' },
      { href: '/me/documents',  label: 'Documents',        icon: '📄' },
      { href: '/me/account',    label: 'Account settings', icon: '⚙' },
    ];
  });

  switch(key: SystemKey) {
    this.open.set(false);
    if (this.system.current() !== key) this.system.switchTo(key);
  }

  /** Swap the active JWT to one scoped to the chosen tenant. The home
   *  token is stashed by Auth.impersonate() so switch-back works without
   *  re-logging. Full-page reload so every cached HTTP request that
   *  closed over the old token is dropped. */
  impersonate(t: TenantSummary) {
    if (t.status !== 'active') return;
    this.tenantOpen.set(false);
    this.auth.impersonate(t.id).subscribe({
      next: () => { window.location.reload(); },
      error: err => this.dialog.alert(
        'Impersonation failed: ' + (err?.error?.error || 'unknown'),
        { title: 'Impersonation failed', variant: 'danger' }
      ),
    });
  }

  switchBack() {
    this.tenantOpen.set(false);
    const wasUserImpersonation = this.auth.isImpersonatingUser();
    this.auth.switchBack();
    // After user-level impersonation the contractor URL is unreachable for
    // the admin — send them back to the CRM home. Tenant-level impersonation
    // typically stays on a matching route in the home tenant, so reload.
    if (wasUserImpersonation) this.router.navigateByUrl('/admin/clients');
    else window.location.reload();
  }

  initials(s: string | null | undefined): string {
    if (!s) return '?';
    const parts = s.includes('@') ? [s.split('@')[0]] : s.trim().split(/\s+/);
    return parts.map(p => p.charAt(0).toUpperCase()).slice(0, 2).join('') || '?';
  }
}
