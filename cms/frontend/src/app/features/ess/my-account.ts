import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Auth } from '../../core/auth';
import { ThemeService, TENANT_THEMES, THEME_META, TenantTheme } from '../../core/theme.service';
import { Api } from '../../core/api';

/**
 * /me/account — per-user account settings.
 *
 * Shows the bare-bones account info pulled from the JWT user record (email,
 * display name, role) plus controls for the user-controllable preferences:
 * theme + password change. Anything role-/permission-related stays on the
 * admin Users page; this is "settings about me, by me".
 */
@Component({
  selector: 'app-my-account',
  imports: [FormsModule],
  template: `
    <div class="toolbar">
      <h1>My Account</h1>
    </div>

    <div class="content">
      @if (auth.user(); as u) {
        <div class="form-sections">
          <div class="section-card">
            <h3 class="card-title">Identity</h3>
            <div class="meta-row">
              <div class="meta-field">
                <label>Display name</label>
                <input [value]="u.display_name" disabled />
              </div>
              <div class="meta-field">
                <label>Email</label>
                <input [value]="u.email" disabled />
              </div>
            </div>
            <p class="muted small no-notes">
              Display name and email are managed on the admin <strong>Users</strong> page —
              ask an administrator if anything needs to change.
            </p>
          </div>

          <div class="section-card">
            <h3 class="card-title">Appearance</h3>
            <p class="muted small no-notes">
              Your personal theme override. Defaults to the
              <strong>organisation theme</strong> picked in admin settings —
              choose a panel below to override just for your login, or hit
              <strong>Use organisation default</strong> to fall back.
            </p>
            <div class="theme-grid">
              @for (slug of themes; track slug) {
                <button type="button"
                        class="theme-card"
                        [class.selected]="theme.theme() === slug"
                        [style.--swatch-primary]="meta[slug].primary"
                        [style.--swatch-bg]="meta[slug].bg"
                        (click)="theme.preview(slug)">
                  <span class="theme-swatch">
                    <span class="swatch-bg"></span>
                    <span class="swatch-dot"></span>
                  </span>
                  <span class="theme-label">
                    <strong>{{ meta[slug].label }}</strong>
                    <span class="muted small">{{ meta[slug].mood }}</span>
                  </span>
                </button>
              }
            </div>
            @if (themeMsg()) { <p class="ok-msg">{{ themeMsg() }}</p> }
            @if (themeErr()) { <p class="err">{{ themeErr() }}</p> }
            <div class="row">
              <button class="primary"
                      (click)="saveTheme()"
                      [disabled]="themeBusy() || theme.theme() === savedSlug()">
                {{ themeBusy() ? 'Saving…' : 'Save my theme' }}
              </button>
              <button class="ghost"
                      (click)="clearOverride()"
                      [disabled]="themeBusy() || !hasOverride()">
                Use organisation default
              </button>
              @if (theme.theme() !== savedSlug()) {
                <button class="ghost" (click)="revertTheme()">Cancel preview</button>
              }
            </div>
          </div>

          <div class="section-card">
            <h3 class="card-title">Change password</h3>
            <div class="meta-row">
              <div class="meta-field">
                <label>Current password</label>
                <input type="password" [(ngModel)]="currentPw" name="cp" />
              </div>
              <div class="meta-field">
                <label>New password</label>
                <input type="password" [(ngModel)]="newPw" name="np" placeholder="Min 8 chars" />
              </div>
              <div class="meta-field">
                <label>Confirm new password</label>
                <input type="password" [(ngModel)]="confirmPw" name="np2" />
              </div>
            </div>
            @if (msg()) { <p class="ok-msg">{{ msg() }}</p> }
            @if (err()) { <p class="err">{{ err() }}</p> }
            <div class="row">
              <button class="primary" (click)="changePassword()" [disabled]="busy() || !canSubmit()">
                {{ busy() ? 'Saving…' : 'Update password' }}
              </button>
            </div>
          </div>
        </div>
      } @else {
        <p class="muted">Not signed in.</p>
      }
    </div>
  `,
  styles: [`
    .toolbar { padding: 16px 20px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--line); }
    .toolbar h1 { margin: 0; font-size: 22px; }
    .content { padding: 20px 24px 32px; background: #ffffff; min-height: calc(100vh - 120px); }

    .form-sections { display: flex; flex-direction: column; gap: 18px; max-width: 880px; }
    .section-card {
      background: var(--bg-3); border: 1px solid var(--line); border-radius: var(--radius);
      padding: 18px; display: flex; flex-direction: column; gap: 14px;
    }
    .card-title { margin: 0; font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.6px; font-weight: 700; }
    .no-notes { margin: 0; }
    .meta-row { display: flex; gap: 12px; flex-wrap: wrap; align-items: end; }
    .meta-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 200px; }
    .meta-field label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; margin: 0; }
    .meta-field input { width: 100%; }
    .row { display: flex; gap: 8px; align-items: center; }
    .err { color: #ef4444; font-size: 13px; margin: 0; }
    .ok-msg { color: #10b981; font-size: 13px; margin: 0; }

    /* Theme picker — 6 panels laid out 3-up on wide screens, stacked on
       narrow. Each card mimics the in-app feel: the inner swatch shows
       the theme's background colour with a primary-coloured dot on top
       so the user reads "dark with gold accent" / "light with mint" at
       a glance. Selected card gets a primary-coloured ring. */
    .theme-grid {
      display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;
    }
    @media (max-width: 720px) { .theme-grid { grid-template-columns: 1fr 1fr; } }
    .theme-card {
      display: flex; align-items: center; gap: 12px;
      padding: 10px 12px; border-radius: var(--radius);
      background: var(--bg-2); border: 1px solid var(--line);
      cursor: pointer; text-align: left;
      transition: border-color .15s, transform .15s;
    }
    .theme-card:hover { border-color: var(--primary); transform: translateY(-1px); }
    .theme-card.selected {
      border-color: var(--primary);
      box-shadow: 0 0 0 2px color-mix(in oklab, var(--primary), transparent 70%);
    }
    .theme-swatch {
      position: relative;
      width: 44px; height: 44px; border-radius: 8px;
      flex-shrink: 0; overflow: hidden;
      border: 1px solid var(--line);
    }
    .theme-swatch .swatch-bg {
      position: absolute; inset: 0; background: var(--swatch-bg);
    }
    .theme-swatch .swatch-dot {
      position: absolute; right: 6px; bottom: 6px;
      width: 16px; height: 16px; border-radius: 50%;
      background: var(--swatch-primary);
      box-shadow: 0 0 0 2px rgba(255,255,255,0.15);
    }
    .theme-label { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .theme-label strong { font-size: 13px; }
  `],
})
export class MyAccount {
  auth = inject(Auth);
  theme = inject(ThemeService);
  private api = inject(Api);

  // Exposed to the template so the @for can iterate.
  readonly themes = TENANT_THEMES;
  readonly meta   = THEME_META;

  currentPw = '';
  newPw = '';
  confirmPw = '';
  busy = signal(false);
  msg = signal<string | null>(null);
  err = signal<string | null>(null);

  // Theme picker state. `savedSlug` tracks the currently-effective theme
  // (user override if set, otherwise tenant default). `hasOverride` is
  // true when admin_users.color_theme is non-null, i.e. the user has
  // explicitly opted out of the org default.
  themeBusy   = signal(false);
  themeMsg    = signal<string | null>(null);
  themeErr    = signal<string | null>(null);
  hasOverride = signal<boolean>(!!this.auth.user()?.color_theme);
  savedSlug   = signal<string>(
    (this.auth.user()?.color_theme as string)
      || (this.auth.tenant()?.color_theme as string)
      || 'midnight-gold'
  );

  /** Write the per-user override (admin_users.color_theme). Doesn't
   *  touch the tenant default — that lives on /admin/settings. */
  saveTheme() {
    this.themeMsg.set(null);
    this.themeErr.set(null);
    const slug = this.theme.theme();
    this.themeBusy.set(true);
    this.theme.saveUserOverride(slug).subscribe({
      next: () => {
        this.themeBusy.set(false);
        this.themeMsg.set('Personal theme saved — only you see this.');
        this.savedSlug.set(slug);
        this.hasOverride.set(true);
        this.auth.patchUser({ color_theme: slug });
      },
      error: e => {
        this.themeBusy.set(false);
        this.themeErr.set(e?.error?.error || 'Could not save theme.');
      },
    });
  }

  /** Clear the override so the user falls back to the org default. */
  clearOverride() {
    this.themeMsg.set(null);
    this.themeErr.set(null);
    this.themeBusy.set(true);
    this.theme.saveUserOverride(null).subscribe({
      next: () => {
        this.themeBusy.set(false);
        this.themeMsg.set('Reverted to organisation default.');
        const tenantSlug = (this.auth.tenant()?.color_theme as string) || 'midnight-gold';
        this.savedSlug.set(tenantSlug);
        this.hasOverride.set(false);
        this.auth.patchUser({ color_theme: null });
        this.theme.preview(tenantSlug);
      },
      error: e => {
        this.themeBusy.set(false);
        this.themeErr.set(e?.error?.error || 'Could not clear override.');
      },
    });
  }

  revertTheme() {
    this.theme.preview(this.savedSlug());
    this.themeMsg.set(null);
    this.themeErr.set(null);
  }

  canSubmit(): boolean {
    return !!this.currentPw && !!this.newPw && this.newPw === this.confirmPw && this.newPw.length >= 8;
  }
  changePassword() {
    this.msg.set(null);
    this.err.set(null);
    if (!this.canSubmit()) {
      this.err.set('Make sure both new-password fields match and are at least 8 characters.');
      return;
    }
    this.busy.set(true);
    this.api.changePassword(this.currentPw, this.newPw).subscribe({
      next: () => {
        this.busy.set(false);
        this.msg.set('Password updated.');
        this.currentPw = ''; this.newPw = ''; this.confirmPw = '';
      },
      error: e => {
        this.busy.set(false);
        this.err.set(e?.error?.error || 'Could not update password.');
      },
    });
  }
}
