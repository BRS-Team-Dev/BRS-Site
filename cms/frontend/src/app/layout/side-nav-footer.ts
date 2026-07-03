import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { Auth } from '../core/auth';

/**
 * Sidenav footer — pinned at the bottom of every system sidenav, holds
 * the org-wide Settings link. Only renders when the caller is an admin
 * (a super-admin OR an `admin_users.role = 'admin'` holder), so most
 * tenant members never see it.
 *
 * Dropped into each sidenav with `<app-side-nav-footer />` AFTER the
 * `<nav>` block. Because every sidenav's `<aside>` is `flex-direction:
 * column` and `<nav>` is `flex: 1`, the footer is naturally pushed to
 * the bottom of the rail.
 *
 * Future: a "role admin" tier needs more granular gating — for now we
 * fall back to the catch-all admin role, and the Settings page itself
 * should render a subset of cards based on scope.
 */
@Component({
  selector: 'app-side-nav-footer',
  imports: [RouterLink, RouterLinkActive],
  template: `
    @if (canSee()) {
      <div class="nav-footer">
        <a routerLink="/admin/settings" routerLinkActive="active">
          <span class="icon">⚙</span> Settings
        </a>
      </div>
    }
  `,
  styles: [`
    .nav-footer {
      border-top: 1px solid var(--line);
      padding: 10px;
    }
    .nav-footer a {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 12px; border-radius: var(--radius-sm);
      color: var(--fg); font-size: 14px;
      transition: background 0.15s, color 0.15s;
    }
    .nav-footer a:hover { background: var(--bg-3); }
    .nav-footer a.active { background: var(--bg-3); color: var(--primary); }
    .nav-footer .icon { width: 20px; text-align: center; opacity: 0.85; }
  `],
})
export class SideNavFooter {
  private auth = inject(Auth);

  /** Show the org Settings link to super-admins and to anyone whose
   *  admin_users.role is 'admin'. The user record is the one stashed
   *  in localStorage by Auth.login(). */
  readonly canSee = computed(() => {
    if (this.auth.isSuper()) return true;
    const role = (this.auth.user() as { role?: string } | null)?.role;
    return role === 'admin';
  });
}
