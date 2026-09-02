import { Component, ViewChild, ElementRef, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import { Auth } from '../../core/auth';
import { environment } from '@env/environment';

type Step = 'email' | 'password' | 'set-password';

/**
 * Two-step login (email -> password) with a mandatory third step when the
 * account is flagged `must_change_password` (temp password from account
 * creation, admin reset, or an admin-issued reactivate). No email
 * enumeration: we never round-trip the email alone — `must_change_password`
 * only surfaces after a successful password verify.
 */
@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink],
  template: `
    <div class="wrap">
      <div class="card">
        <div class="brand-mark">
          <img [src]="logoSrc" alt="BuiltRightStudio" />
        </div>
        <h1>{{ heading() }}</h1>
        <p class="muted small">{{ subheading() }}</p>

        @if (step() === 'email') {
          <form (submit)="submitEmail($event)">
            <label>Email</label>
            <input #emailInput type="email" name="email" [(ngModel)]="email"
                   required autofocus autocomplete="username" />
            @if (error()) { <div class="error-msg">{{ error() }}</div> }
            <div style="height:16px"></div>
            <button type="submit" class="primary">Continue</button>
          </form>
        }

        @if (step() === 'password') {
          <div class="who-row">
            <span class="who-email">{{ email }}</span>
            <button type="button" class="ghost small" (click)="backToEmail()">Change</button>
          </div>
          <form (submit)="submitPassword($event)">
            <label>Password</label>
            <input #pwInput type="password" name="password" [(ngModel)]="password"
                   required autofocus autocomplete="current-password" />
            @if (error()) { <div class="error-msg">{{ error() }}</div> }
            <div style="height:16px"></div>
            <button type="submit" class="primary" [disabled]="loading()">
              {{ loading() ? 'Signing in…' : 'Sign in' }}
            </button>
            <div class="forgot-row">
              <a routerLink="/forgot-password">Forgot password?</a>
            </div>
          </form>
        }

        @if (step() === 'set-password') {
          <div class="who-row">
            <span class="who-email">{{ email }}</span>
          </div>
          <p class="notice">
            This is a temporary password. Set a new one to continue.
          </p>
          <form (submit)="submitNewPassword($event)">
            <label>New password</label>
            <input #newPwInput type="password" name="new_pw" [(ngModel)]="newPassword"
                   required autofocus autocomplete="new-password" minlength="8" />
            <div style="height:12px"></div>
            <label>Confirm new password</label>
            <input type="password" name="confirm_pw" [(ngModel)]="confirmPassword"
                   required autocomplete="new-password" minlength="8" />
            @if (error()) { <div class="error-msg">{{ error() }}</div> }
            <div style="height:16px"></div>
            <button type="submit" class="primary" [disabled]="loading()">
              {{ loading() ? 'Saving…' : 'Set password &amp; continue' }}
            </button>
          </form>
        }
      </div>
    </div>
  `,
  styles: [`
    .wrap { display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
    .card { width: 100%; max-width: 380px; }
    .brand-mark { display: flex; justify-content: center; margin-bottom: 16px; }
    .brand-mark img { width: 64px; height: 64px; object-fit: contain; }
    h1 { margin: 0 0 4px 0; font-size: 22px; text-align: center; }
    .muted.small { text-align: center; }
    .who-row {
      display: flex; align-items: center; justify-content: space-between;
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
      padding: 8px 12px; margin: 12px 0;
    }
    .who-email { font-size: 13px; color: var(--fg); }
    .ghost.small { padding: 4px 10px; font-size: 12px; }
    .notice {
      margin: 8px 0 12px 0; padding: 10px 12px;
      background: var(--bg-2); border: 1px solid var(--primary); border-radius: var(--radius-sm);
      color: var(--fg); font-size: 13px;
    }
    .forgot-row { margin-top: 14px; text-align: center; font-size: 13px; }
    .forgot-row a { color: var(--muted); text-decoration: none; }
    .forgot-row a:hover { text-decoration: underline; }
  `],
})
export class Login {
  private api = inject(Api);
  private auth = inject(Auth);
  private router = inject(Router);
  logoSrc = `${environment.basePath}/icon.png`;

  step = signal<Step>('email');
  email = '';
  password = '';
  newPassword = '';
  confirmPassword = '';
  loading = signal(false);
  error = signal<string | null>(null);

  @ViewChild('pwInput')    pwInput?: ElementRef<HTMLInputElement>;
  @ViewChild('newPwInput') newPwInput?: ElementRef<HTMLInputElement>;

  constructor() {
    // If the caller is already logged in with a temp password (they closed the
    // tab mid-flow), pre-fill the email and skip straight to the set-password
    // step. Their JWT is still valid, so /auth/change-password will succeed.
    const cached = this.auth.user() as { email?: string; must_change_password?: boolean } | null;
    if (cached?.must_change_password) {
      this.email = cached.email ?? '';
      this.step.set('set-password');
    }

    // Autofocus each step's primary input after Angular renders it.
    effect(() => {
      const s = this.step();
      queueMicrotask(() => {
        if (s === 'password')     this.pwInput?.nativeElement.focus();
        if (s === 'set-password') this.newPwInput?.nativeElement.focus();
      });
    });
  }

  heading = () => this.step() === 'set-password' ? 'Choose a new password' : 'Sign in';
  subheading = () => this.step() === 'set-password'
    ? 'One-off, then you’re in.'
    : 'BuiltRightStudio CMS';

  submitEmail(e: Event) {
    e.preventDefault();
    this.error.set(null);
    const email = this.email.trim();
    if (!email) return;
    // Client-side email shape check only — no server round-trip means no
    // enumeration. The real check happens on the password step.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.error.set('Enter a valid email address.');
      return;
    }
    this.email = email;
    this.step.set('password');
  }

  backToEmail() {
    this.step.set('email');
    this.password = '';
    this.error.set(null);
  }

  submitPassword(e: Event) {
    e.preventDefault();
    this.loading.set(true);
    this.error.set(null);
    this.auth.login(this.email, this.password).subscribe({
      next: () => {
        this.loading.set(false);
        const user = this.auth.user() as { role?: string; must_change_password?: boolean } | null;
        if (user?.must_change_password) {
          this.step.set('set-password');
          return;
        }
        this.router.navigateByUrl(user?.role === 'contractor' ? '/contractor/me' : '/admin/clients');
      },
      error: err => {
        this.loading.set(false);
        this.error.set(err?.error?.error || 'Invalid email or password.');
      },
    });
  }

  submitNewPassword(e: Event) {
    e.preventDefault();
    this.error.set(null);
    if (this.newPassword.length < 8) { this.error.set('Password must be at least 8 characters.'); return; }
    if (this.newPassword !== this.confirmPassword) { this.error.set('Passwords do not match.'); return; }
    this.loading.set(true);
    // Uses the dedicated set-initial-password endpoint: it verifies
    // must_change_password=1 in the DB and doesn't require the current
    // password (the caller's JWT is proof they knew the temp pw). This
    // handles both the same-session flow and the "closed the tab, came
    // back" flow uniformly.
    this.api.setInitialPassword(this.newPassword).subscribe({
      next: () => {
        this.loading.set(false);
        // Update the cached user record so downstream code (nav guards etc.)
        // sees must_change_password=false immediately.
        this.auth.patchUser({ must_change_password: false } as any);
        const role = (this.auth.user() as { role?: string } | null)?.role;
        this.router.navigateByUrl(role === 'contractor' ? '/contractor/me' : '/admin/clients');
      },
      error: err => {
        this.loading.set(false);
        this.error.set(err?.error?.error || 'Could not set new password.');
      },
    });
  }
}
