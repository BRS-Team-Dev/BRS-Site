import { CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';
import { Auth } from './auth';

export const authGuard: CanActivateFn = () => {
  const auth = inject(Auth);
  const router = inject(Router);
  if (!auth.isLoggedIn()) { router.navigateByUrl('/login'); return false; }
  // Force pending password-change users back to /login where the set-password
  // step is rendered. Handles the "closed the tab mid-flow" case — an
  // already-issued temp-password JWT would otherwise let them navigate.
  // Skip during impersonation: the ADMIN doesn't need to set the target
  // user's password — Switch back returns them to their own admin session.
  const u = auth.user() as { must_change_password?: boolean } | null;
  if (u?.must_change_password && !auth.isImpersonating()) {
    router.navigateByUrl('/login');
    return false;
  }
  return true;
};
