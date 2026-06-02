import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Api } from './api';
import { AdminUser } from './models';
import { tap } from 'rxjs';

const STORAGE_KEY = 'brs.token';
const USER_KEY = 'brs.user';

@Injectable({ providedIn: 'root' })
export class Auth {
  private api = inject(Api);
  private router = inject(Router);

  private _token = signal<string | null>(localStorage.getItem(STORAGE_KEY));
  private _user  = signal<AdminUser | null>(this.readUser());

  readonly token = this._token.asReadonly();
  readonly user  = this._user.asReadonly();
  readonly isLoggedIn = computed(() => !!this._token());

  login(email: string, password: string) {
    return this.api.login(email, password).pipe(tap(res => {
      localStorage.setItem(STORAGE_KEY, res.token);
      localStorage.setItem(USER_KEY, JSON.stringify(res.user));
      this._token.set(res.token);
      this._user.set(res.user);
    }));
  }

  logout() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(USER_KEY);
    this._token.set(null);
    this._user.set(null);
    this.router.navigateByUrl('/login');
  }

  private readUser(): AdminUser | null {
    try { const raw = localStorage.getItem(USER_KEY); return raw ? JSON.parse(raw) : null; }
    catch { return null; }
  }
}
