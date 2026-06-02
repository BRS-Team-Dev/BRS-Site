import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '@env/environment';

@Component({
  selector: 'app-reset-password',
  imports: [FormsModule, RouterLink],
  template: `
    <div class="wrap">
      <div class="card">
        <div class="brand-mark">
          <img [src]="logoSrc" alt="BuiltRightStudio" />
        </div>
        <h1>Set a new password</h1>

        @if (!token()) {
          <p class="error-msg">This reset link is missing or malformed.</p>
          <div style="height:14px"></div>
          <a routerLink="/forgot-password">Request a new link</a>
        } @else if (done()) {
          <p>Password updated. You can now sign in with your new password.</p>
          <div style="height:14px"></div>
          <a routerLink="/login">Go to sign in</a>
        } @else {
          <form (submit)="submit($event)">
            <label>New password</label>
            <input type="password" name="pw1" [(ngModel)]="pw1" required minlength="8" autofocus />
            <div style="height:12px"></div>
            <label>Confirm new password</label>
            <input type="password" name="pw2" [(ngModel)]="pw2" required minlength="8" />
            @if (mismatch()) { <div class="error-msg">Passwords don't match.</div> }
            @if (error()) { <div class="error-msg">{{ error() }}</div> }
            <div style="height:16px"></div>
            <button type="submit" class="primary" [disabled]="loading() || mismatch() || pw1.length < 8">
              {{ loading() ? 'Saving…' : 'Set new password' }}
            </button>
            <div class="back-row">
              <a routerLink="/login">Back to sign in</a>
            </div>
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
    .back-row { margin-top: 14px; text-align: center; font-size: 13px; }
    .back-row a { color: var(--muted); text-decoration: none; }
    .back-row a:hover { text-decoration: underline; }
  `],
})
export class ResetPassword {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  logoSrc = `${environment.basePath}/icon.png`;
  token = signal<string>(this.route.snapshot.queryParamMap.get('token') ?? '');
  pw1 = '';
  pw2 = '';
  loading = signal(false);
  error = signal<string | null>(null);
  done = signal(false);
  mismatch = computed(() => this.pw1.length > 0 && this.pw2.length > 0 && this.pw1 !== this.pw2);

  submit(e: Event) {
    e.preventDefault();
    if (this.mismatch() || this.pw1.length < 8) return;
    this.loading.set(true);
    this.error.set(null);
    this.http.post(`${environment.basePath}/api/auth/reset-password`, {
      token: this.token(),
      new_password: this.pw1,
    }).subscribe({
      next: () => { this.loading.set(false); this.done.set(true); },
      error: err => { this.loading.set(false); this.error.set(err?.error?.error || 'Could not reset password'); },
    });
  }
}
