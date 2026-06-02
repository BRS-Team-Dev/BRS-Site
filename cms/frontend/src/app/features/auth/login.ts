import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Auth } from '../../core/auth';

@Component({
  selector: 'app-login',
  imports: [FormsModule],
  template: `
    <div class="wrap">
      <div class="card">
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
        </form>
      </div>
    </div>
  `,
  styles: [`
    .wrap { display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
    .card { width: 100%; max-width: 380px; }
    h1 { margin: 0 0 4px 0; font-size: 22px; }
  `],
})
export class Login {
  private auth = inject(Auth);
  private router = inject(Router);
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
