import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Auth } from '../../core/auth';
import { environment } from '@env/environment';

@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink],
  template: `
    <div class="wrap">
      <div class="card">
        <div class="brand-mark">
          <img [src]="logoSrc" alt="BuiltRightStudio" />
        </div>
        <h1>Sign in</h1>
        <p class="muted small">BuiltRightStudio CMS</p>
        <form (submit)="submit($event)">
          <label>Email</label>
          <input type="email" name="email" [(ngModel)]="email" required autofocus />
          <div style="height:12px"></div>
          <label>Password</label>
          <input type="password" name="password" [(ngModel)]="password" required />
          @if (error()) { <div class="error-msg">{{ error() }}</div> }
          <div style="height:16px"></div>
          <button type="submit" class="primary" [disabled]="loading()">
            {{ loading() ? 'Signing in…' : 'Sign in' }}
          </button>
          <div class="forgot-row">
            <a routerLink="/forgot-password">Forgot password?</a>
          </div>
        </form>
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
    .forgot-row { margin-top: 14px; text-align: center; font-size: 13px; }
    .forgot-row a { color: var(--muted); text-decoration: none; }
    .forgot-row a:hover { text-decoration: underline; }
  `],
})
export class Login {
  private auth = inject(Auth);
  private router = inject(Router);
  logoSrc = `${environment.basePath}/icon.png`;
  email = '';
  password = '';
  loading = signal(false);
  error = signal<string | null>(null);

  submit(e: Event) {
    e.preventDefault();
    this.loading.set(true);
    this.error.set(null);
    this.auth.login(this.email, this.password).subscribe({
      next: () => { this.loading.set(false); this.router.navigateByUrl('/admin/clients'); },
      error: err => { this.loading.set(false); this.error.set(err?.error?.error || 'Login failed'); },
    });
  }
}
