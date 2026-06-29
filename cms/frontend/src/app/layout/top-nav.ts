import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api';
import { Auth } from '../core/auth';
import { TenantSummary } from '../core/models';
import { SettingsService } from '../core/settings.service';
import { SystemService, SystemKey } from '../core/system.service';
import { ThemeService } from '../core/theme.service';

@Component({
  selector: 'app-top-nav',
  imports: [RouterLink],
  template: `
    @if (auth.isImpersonating()) {
      <!-- Banner pinned across the top whenever a super-admin is operating
           inside someone else's tenant. The Switch back button instantly
           swaps the JWT back to the home tenant via Auth.switchBack(). -->
      <div class="imp-banner">
        <span class="imp-dot"></span>
        Impersonating
        @if (currentTenantBrand(); as b) { <strong>{{ b }}</strong> }
        — your changes are attributed as System within this tenant.
        <button class="imp-back" (click)="switchBack()" title="Return to your home tenant">
          ↩ Switch back
        </button>
      </div>
    }
    <nav>
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
      <button
        class="ghost theme-btn"
        (click)="theme.toggle()"
        [title]="theme.theme() === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'"
        [attr.aria-label]="theme.theme() === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'">
        {{ theme.theme() === 'dark' ? '☀' : '☾' }}
      </button>
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
              <a class="user-opt" routerLink="/me" (click)="userOpen.set(false)">
                <span class="opt-icon">⚙</span>
                <span class="opt-label">My Account</span>
              </a>
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

    .theme-btn {
      width: 32px; height: 32px; padding: 0;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 18px; line-height: 1;
    }
    .theme-btn:hover { color: var(--primary); border-color: var(--primary); }
    :host-context([data-theme="light"]) .theme-btn { color: var(--primary); }

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
  auth = inject(Auth);
  theme = inject(ThemeService);
  system = inject(SystemService);
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
  }

  /** Systems shown in the picker — `hidden: true` ones (like 'me') are reached elsewhere. */
  pickerSystems = () => this.system.systems.filter(s => !s.hidden);

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
      error: err => alert('Impersonation failed: ' + (err?.error?.error || 'unknown')),
    });
  }

  switchBack() {
    this.tenantOpen.set(false);
    this.auth.switchBack();
    window.location.reload();
  }

  initials(s: string | null | undefined): string {
    if (!s) return '?';
    const parts = s.includes('@') ? [s.split('@')[0]] : s.trim().split(/\s+/);
    return parts.map(p => p.charAt(0).toUpperCase()).slice(0, 2).join('') || '?';
  }
}
