import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Auth } from '../../core/auth';
import { ThemeService } from '../../core/theme.service';
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
            <div class="meta-row">
              <div class="meta-field">
                <label>Theme</label>
                <label class="inline-toggle">
                  <input type="checkbox" [checked]="theme.theme() === 'light'" (change)="theme.toggle()" />
                  <span>Light theme</span>
                </label>
              </div>
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
    .inline-toggle {
      display: inline-flex; align-items: center; gap: 8px;
      margin: 0; padding: 8px 10px;
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
      cursor: pointer; white-space: nowrap; color: var(--fg); font-size: 13px;
      width: 100%;
    }
    .inline-toggle input { width: 16px; height: 16px; }
    .row { display: flex; gap: 8px; align-items: center; }
    .err { color: #ef4444; font-size: 13px; margin: 0; }
    .ok-msg { color: #10b981; font-size: 13px; margin: 0; }
  `],
})
export class MyAccount {
  auth = inject(Auth);
  theme = inject(ThemeService);
  private api = inject(Api);

  currentPw = '';
  newPw = '';
  confirmPw = '';
  busy = signal(false);
  msg = signal<string | null>(null);
  err = signal<string | null>(null);

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
