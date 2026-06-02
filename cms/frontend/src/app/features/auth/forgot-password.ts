import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '@env/environment';

@Component({
  selector: 'app-forgot-password',
  imports: [FormsModule, RouterLink],
  template: `
    <div class="wrap">
      <div class="card">
        <div class="brand-mark">
          <img [src]="logoSrc" alt="BuiltRightStudio" />
        </div>
        <h1>Reset your password</h1>
        <p class="muted small">We'll email you a link to set a new password.</p>

        @if (submitted()) {
          <p>If an account exists for that email, a reset link is on its way. Check your inbox.</p>
          <div style="height:14px"></div>
          <a routerLink="/login">Back to sign in</a>
        } @else {
          <form (submit)="submit($event)">
            <label>Email</label>
            <input type="email" name="email" [(ngModel)]="email" required autofocus />
            @if (error()) { <div class="error-msg">{{ error() }}</div> }
            <div style="height:16px"></div>
            <button type="submit" class="primary" [disabled]="loading()">
              {{ loading() ? 'Sending…' : 'Send reset link' }}
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
    .muted.small { text-align: center; }
    .back-row { margin-top: 14px; text-align: center; font-size: 13px; }
    .back-row a { color: var(--muted); text-decoration: none; }
    .back-row a:hover { text-decoration: underline; }
  `],
})
export class ForgotPassword {
  private http = inject(HttpClient);
  logoSrc = `${environment.basePath}/icon.png`;
  email = '';
  loading = signal(false);
  error = signal<string | null>(null);
  submitted = signal(false);

  submit(e: Event) {
    e.preventDefault();
    this.loading.set(true);
    this.error.set(null);
    this.http.post(`${environment.basePath}/api/auth/forgot-password`, { email: this.email })
      .subscribe({
        next: () => { this.loading.set(false); this.submitted.set(true); },
        error: err => { this.loading.set(false); this.error.set(err?.error?.error || 'Something went wrong'); },
      });
  }
}
