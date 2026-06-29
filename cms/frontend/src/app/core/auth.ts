import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Api } from './api';
import { AdminUser } from './models';
import { tap } from 'rxjs';

const STORAGE_KEY = 'brs.token';
const USER_KEY = 'brs.user';
// When Bobby (or any super-admin) impersonates a tenant, we stash the
// ORIGINAL token here so a one-click "Switch back" works even after a
// page refresh. Cleared on logout + on a successful switch-back.
const ORIGINAL_TOKEN_KEY = 'brs.original_token';
const ORIGINAL_USER_KEY  = 'brs.original_user';

/** Subset of the JWT payload the frontend cares about. The backend
 *  signs the token with HS256 so we can decode the payload locally with
 *  zero round-trips — verification stays server-side; we only read. */
export interface JwtClaims {
  sub: number;
  email: string;
  tenant_id: number;
  super?: boolean;
  iat: number;
  exp: number;
  impersonating?: { from: number };
}

@Injectable({ providedIn: 'root' })
export class Auth {
  private api = inject(Api);
  private router = inject(Router);

  private _token = signal<string | null>(localStorage.getItem(STORAGE_KEY));
  private _user  = signal<AdminUser | null>(this.readUser());

  readonly token = this._token.asReadonly();
  readonly user  = this._user.asReadonly();
  readonly isLoggedIn = computed(() => !!this._token());

  /** Decoded JWT claims. Re-computes whenever the token changes. */
  readonly claims = computed<JwtClaims | null>(() => {
    const tok = this._token();
    return tok ? Auth.decodeJwt(tok) : null;
  });
  readonly isSuper       = computed(() => !!this.claims()?.super);
  readonly tenantId      = computed(() => this.claims()?.tenant_id ?? null);
  readonly isImpersonating = computed(() => !!this.claims()?.impersonating);
  /** Tenant id the super-admin was operating in BEFORE impersonating. */
  readonly originalTenantId = computed(() => this.claims()?.impersonating?.from ?? null);

  login(email: string, password: string) {
    return this.api.login(email, password).pipe(tap(res => {
      localStorage.setItem(STORAGE_KEY, res.token);
      localStorage.setItem(USER_KEY, JSON.stringify(res.user));
      this._token.set(res.token);
      this._user.set(res.user);
    }));
  }

  /** Super-admin: hand the current session's identity to another tenant.
   *  Stashes the ORIGINAL token so switchBack() can restore it without
   *  needing a re-login. */
  impersonate(targetTenantId: number) {
    return this.api.impersonate(targetTenantId).pipe(tap(res => {
      // Stash the original token (only on the FIRST impersonation; nested
      // impersonations keep the same original so switchBack always
      // returns to the home tenant).
      if (!localStorage.getItem(ORIGINAL_TOKEN_KEY) && !this.isImpersonating()) {
        const curToken = this._token();
        const curUser  = localStorage.getItem(USER_KEY);
        if (curToken) localStorage.setItem(ORIGINAL_TOKEN_KEY, curToken);
        if (curUser)  localStorage.setItem(ORIGINAL_USER_KEY,  curUser);
      }
      localStorage.setItem(STORAGE_KEY, res.token);
      this._token.set(res.token);
      // user record stays as the super-admin's own — they're still
      // *who they are*, just operating in someone else's tenant.
    }));
  }

  /** Restore the original token saved before the first impersonation. */
  switchBack() {
    const origTok  = localStorage.getItem(ORIGINAL_TOKEN_KEY);
    const origUser = localStorage.getItem(ORIGINAL_USER_KEY);
    if (!origTok) return;
    localStorage.setItem(STORAGE_KEY, origTok);
    if (origUser) localStorage.setItem(USER_KEY, origUser);
    localStorage.removeItem(ORIGINAL_TOKEN_KEY);
    localStorage.removeItem(ORIGINAL_USER_KEY);
    this._token.set(origTok);
    this._user.set(origUser ? JSON.parse(origUser) : null);
  }

  logout() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(ORIGINAL_TOKEN_KEY);
    localStorage.removeItem(ORIGINAL_USER_KEY);
    this._token.set(null);
    this._user.set(null);
    this.router.navigateByUrl('/login');
  }

  private readUser(): AdminUser | null {
    try { const raw = localStorage.getItem(USER_KEY); return raw ? JSON.parse(raw) : null; }
    catch { return null; }
  }

  /** HS256 JWT layout: header.payload.signature, all base64url. We only
   *  need to read the payload — signature verification stays server-side. */
  private static decodeJwt(token: string): JwtClaims | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const pad = '='.repeat((4 - (parts[1].length % 4)) % 4);
      const json = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/') + pad);
      return JSON.parse(json) as JwtClaims;
    } catch { return null; }
  }
}
