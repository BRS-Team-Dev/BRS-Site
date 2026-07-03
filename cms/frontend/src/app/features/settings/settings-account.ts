import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { DialogService } from '../../core/dialog';
import { AdminUserRecord, SubscriptionTier, UsersSubscription } from '../../core/models';

/**
 * Settings → Account tab. Manages users allowed to sign into the tenant.
 *
 * Layout:
 *   - Subscription card at top: current tier, usage bar "3 of 5", quick
 *     "Upgrade →" button when at/near cap.
 *   - Users table below with actions per row:
 *       Edit           — profile / role / password
 *       Deactivate     — is_active=0, still visible in list, easy to reinstate
 *       Reinstate      — is_active=1 (cap-guarded)
 *       Delete         — hard-remove (soft via deleted_at) — data preserved
 *   - + Add user modal — new email + name + role + initial password.
 *     Disabled + explanatory message when at cap.
 *
 * The tier ladder is fetched from the backend (single source of truth
 * for cap values) rather than hardcoded here.
 */

const TIER_LABELS: Record<SubscriptionTier, string> = {
  trial:           'Trial',
  starter:         'Starter',
  growth:          'Growth',
  scale:           'Scale',
  business:        'Business',
  enterprise_lite: 'Enterprise Lite',
  enterprise:      'Enterprise',
};

@Component({
  selector: 'app-settings-account',
  imports: [FormsModule],
  template: `
    @if (loading()) {
      <p class="muted small">Loading…</p>
    } @else if (sub(); as s) {
      <!-- ── Subscription + usage card ────────────────────────── -->
      <section class="tier-card">
        <div class="tier-head">
          <div>
            <div class="muted small">Current plan</div>
            <strong>{{ tierLabel(s.tier) }}</strong>
          </div>
          <div class="tier-usage">
            <div class="muted small">Active users</div>
            <strong>
              {{ s.active_count }} of {{ s.max_active_users == null ? '∞' : s.max_active_users }}
            </strong>
          </div>
          @if (nextTier()) {
            <button class="primary" (click)="upgrade()">
              Upgrade to {{ tierLabel(nextTier()!) }}
            </button>
          }
        </div>
        @if (s.max_active_users != null) {
          <div class="usage-bar">
            <div class="usage-fill"
                 [style.width.%]="(s.active_count / s.max_active_users) * 100"
                 [class.warning]="s.active_count / s.max_active_users >= 0.8"
                 [class.at-cap]="s.at_cap"></div>
          </div>
        }
        @if (s.at_cap) {
          <p class="cap-warn">
            <strong>You're at the {{ tierLabel(s.tier) }} plan's active-user cap.</strong>
            Deactivate a user to make room, or upgrade to add more.
          </p>
        }
      </section>

      <!-- ── Users table ──────────────────────────────────────── -->
      <section class="users-section">
        <div class="section-head">
          <h3>Users</h3>
          <span class="spacer"></span>
          <button class="primary"
                  (click)="openAdd()"
                  [disabled]="s.at_cap"
                  [title]="s.at_cap ? 'You are at the plan cap — upgrade or deactivate a user first' : ''">
            + Add user
          </button>
        </div>

        @if (users().length === 0) {
          <p class="muted small">No users yet.</p>
        } @else {
          <div class="table-wrap">
            <table class="data">
              <thead><tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th></th>
              </tr></thead>
              <tbody>
                @for (u of users(); track u.id) {
                  <tr [class.dim]="!u.is_active">
                    <td><strong>{{ u.display_name }}</strong></td>
                    <td>{{ u.email }}</td>
                    <td><span class="pill">{{ u.role }}</span></td>
                    <td>
                      @if (u.is_active) {
                        <span class="status-pill" data-status="ready">Active</span>
                      } @else {
                        <span class="status-pill" data-status="paused">Deactivated</span>
                      }
                    </td>
                    <td class="actions">
                      <button class="ghost small" (click)="openEdit(u)">Edit</button>
                      @if (u.is_active) {
                        <button class="ghost small" (click)="deactivate(u)">Deactivate</button>
                      } @else {
                        <button class="ghost small" (click)="reinstate(u)" [disabled]="s.at_cap">Reinstate</button>
                      }
                      <button class="ghost icon-btn danger" (click)="del(u)" title="Delete">✕</button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>
    }

    <!-- ── Add / Edit modal ──────────────────────────────────── -->
    @if (modalOpen()) {
      <div class="modal-backdrop" (click)="closeModal()">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-head">
            <h2>{{ draft.id ? 'Edit user' : 'Add user' }}</h2>
            <button class="ghost icon-btn" (click)="closeModal()">✕</button>
          </div>
          <div class="modal-body">
            @if (modalError()) { <p class="error-msg">{{ modalError() }}</p> }

            <label>Display name</label>
            <input [(ngModel)]="draft.display_name" name="dn" placeholder="Jane Doe" />

            <label>Email</label>
            <input type="email" [(ngModel)]="draft.email" name="em"
                   placeholder="jane@example.com" [readOnly]="!!draft.id" />
            @if (draft.id) { <p class="muted small">Email can't be changed after account creation.</p> }

            <label>Role</label>
            <select [(ngModel)]="draft.role" name="rl">
              <option value="admin">Admin — full access</option>
              <option value="member">Member — day-to-day CRM</option>
              <option value="viewer">Viewer — read-only</option>
            </select>

            <label>{{ draft.id ? 'New password (leave blank to keep)' : 'Initial password' }}</label>
            <input type="password" [(ngModel)]="draft.password" name="pw"
                   [placeholder]="draft.id ? '••••••••' : 'Minimum 8 characters'" />
          </div>
          <div class="modal-foot">
            <button class="ghost" (click)="closeModal()">Cancel</button>
            <button class="primary" (click)="save()" [disabled]="saving()">
              {{ saving() ? 'Saving…' : (draft.id ? 'Update' : 'Add') }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    section { margin-bottom: 24px; }

    /* Subscription card */
    .tier-card {
      padding: 14px 16px;
      border: 1px solid var(--line); border-radius: var(--radius);
      background: var(--bg-2);
      overflow: hidden;    /* stop button/usage-bar from spilling on narrow widths */
    }
    .tier-head {
      display: flex; align-items: center; gap: 20px;
      flex-wrap: wrap;
      min-width: 0;
    }
    .tier-head > div { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .tier-head strong { font-size: 15px; }
    .tier-head .muted { font-size: 11px; text-transform: uppercase;
      letter-spacing: 0.5px; font-weight: 600; margin: 0; }
    .tier-head .primary {
      margin-left: auto; white-space: nowrap; flex-shrink: 0;
      padding: 8px 14px; font-size: 13px;
    }

    .usage-bar {
      margin-top: 10px; height: 6px; background: var(--bg-3);
      border-radius: 999px; overflow: hidden;
    }
    .usage-fill {
      height: 100%; background: var(--success); border-radius: 999px;
      transition: width .2s, background .2s;
    }
    .usage-fill.warning { background: var(--warning); }
    .usage-fill.at-cap  { background: var(--danger); }

    .cap-warn {
      margin: 12px 0 0; padding: 8px 12px;
      background: color-mix(in oklab, var(--danger), transparent 82%);
      border: 1px solid color-mix(in oklab, var(--danger), transparent 55%);
      border-radius: var(--radius-sm);
      color: var(--fg); font-size: 13px; line-height: 1.5;
    }
    .cap-warn strong { color: var(--danger); }

    /* Users section */
    .users-section { min-width: 0; }
    .section-head {
      display: flex; align-items: center; gap: 10px; margin-bottom: 12px;
      flex-wrap: wrap;
    }
    .section-head h3 { margin: 0; font-size: 14px; text-transform: uppercase;
      letter-spacing: 0.5px; color: var(--muted); font-weight: 700; }
    .section-head .spacer { flex: 1; }
    .section-head > button {
      white-space: nowrap; flex-shrink: 0;
      padding: 8px 14px; font-size: 13px;
    }

    /* Table lives in a horizontal-scroll wrapper so it never overflows
       the tab pane on narrow viewports. Column widths pinned so the
       Actions column doesn't get pushed off-screen. */
    .users-section .table-wrap { overflow-x: auto; margin: 0; padding: 0; min-height: 0; }
    .users-section table.data { table-layout: fixed; width: 100%; min-width: 640px; }
    .users-section table.data th:nth-child(1) { width: 20%; }
    .users-section table.data th:nth-child(2) { width: 32%; }
    .users-section table.data th:nth-child(3) { width: 90px; }
    .users-section table.data th:nth-child(4) { width: 110px; }
    .users-section table.data th:nth-child(5) { width: 220px; }
    .users-section table.data td { overflow: hidden; text-overflow: ellipsis; }

    table.data tr.dim td { opacity: 0.6; }
    td.actions {
      display: flex; gap: 4px; white-space: nowrap;
      justify-content: flex-end;   /* keep icon-btn pinned to the right */
    }
    td.actions button { white-space: nowrap; flex-shrink: 0; }
    .status-pill { display: inline-block; padding: 2px 10px; border-radius: 999px;
      font-size: 11px; font-weight: 600; letter-spacing: 0.3px;
      background: var(--bg-3); color: var(--muted); white-space: nowrap; }
    .status-pill[data-status="ready"]  { background: color-mix(in oklab, var(--success), transparent 78%); color: var(--success); }
    .status-pill[data-status="paused"] { background: var(--bg-3); color: var(--muted); }
  `],
})
export class SettingsAccount {
  private api = inject(Api);
  private dialog = inject(DialogService);

  loading = signal(true);
  sub     = signal<UsersSubscription | null>(null);
  users   = signal<AdminUserRecord[]>([]);

  modalOpen  = signal(false);
  modalError = signal<string | null>(null);
  saving     = signal(false);

  draft: AdminUserRecord & { password?: string } = this.blank();

  /** Next tier up in the ladder — drives the "Upgrade to X" button.
   *  Returns null when the tenant is already on enterprise. */
  nextTier = computed<SubscriptionTier | null>(() => {
    const s = this.sub();
    if (!s) return null;
    const idx = s.tier_ladder.findIndex(t => t.tier === s.tier);
    if (idx < 0 || idx >= s.tier_ladder.length - 1) return null;
    return s.tier_ladder[idx + 1].tier;
  });

  ngOnInit() { this.load(); }

  private load() {
    this.loading.set(true);
    // Fetch both in parallel; usage bar needs the subscription payload
    // AND the users list needs the row data.
    this.api.getUsersSubscription().subscribe({
      next: r => { this.sub.set(r); this.maybeFinishLoading(); },
    });
    this.api.listAdminUsers().subscribe({
      next: r => { this.users.set(r.users ?? []); this.maybeFinishLoading(); },
    });
  }
  private loaded = { sub: false, users: false };
  private maybeFinishLoading() {
    // Simple gate — both must land before we hide the loader.
    if (this.sub() && this.users().length >= 0) this.loading.set(false);
  }

  tierLabel(tier: SubscriptionTier): string {
    return TIER_LABELS[tier];
  }

  private blank(): AdminUserRecord & { password?: string } {
    return { email: '', display_name: '', role: 'member', is_active: 1, password: '' };
  }

  openAdd() {
    this.draft = this.blank();
    this.modalError.set(null);
    this.modalOpen.set(true);
  }
  openEdit(u: AdminUserRecord) {
    // Password intentionally blank — server keeps existing when omitted.
    this.draft = { ...u, password: '' };
    this.modalError.set(null);
    this.modalOpen.set(true);
  }
  closeModal() { this.modalOpen.set(false); }

  save() {
    if (!this.draft.display_name?.trim()) { this.modalError.set('Display name is required'); return; }
    if (!this.draft.email?.trim())        { this.modalError.set('Email is required'); return; }
    if (!this.draft.id && (this.draft.password ?? '').length < 8) {
      this.modalError.set('Password must be at least 8 characters'); return;
    }
    this.saving.set(true);
    this.modalError.set(null);

    // Strip password if blank on edit so the server doesn't reject.
    const payload: any = { ...this.draft };
    if (this.draft.id && !payload.password) delete payload.password;

    const onOk = () => { this.saving.set(false); this.modalOpen.set(false); this.load(); };
    const onErr = (e: any) => {
      this.saving.set(false);
      this.modalError.set(e?.error?.error || 'Save failed');
    };
    if (this.draft.id) {
      this.api.updateAdminUser(this.draft.id, payload).subscribe({ next: onOk, error: onErr });
    } else {
      this.api.createAdminUser(payload).subscribe({ next: onOk, error: onErr });
    }
  }

  async deactivate(u: AdminUserRecord) {
    if (!u.id) return;
    const ok = await this.dialog.confirm(
      `Deactivate ${u.display_name}? They won't be able to sign in.`,
      { title: 'Deactivate user', confirmLabel: 'Deactivate', variant: 'warning' }
    );
    if (!ok) return;
    this.api.deactivateAdminUser(u.id).subscribe(() => this.load());
  }
  reinstate(u: AdminUserRecord) {
    if (!u.id) return;
    this.api.reinstateAdminUser(u.id).subscribe({
      next: () => this.load(),
      error: e => this.dialog.alert(
        e?.error?.error || 'Reinstate failed',
        { title: 'Reinstate failed', variant: 'danger' }
      ),
    });
  }
  async del(u: AdminUserRecord) {
    if (!u.id) return;
    const ok = await this.dialog.confirm(
      `Permanently delete ${u.display_name}? Their historical data (assigned tasks, notes, etc.) is preserved.`,
      { title: 'Delete user', confirmLabel: 'Delete', variant: 'danger' }
    );
    if (!ok) return;
    this.api.deleteAdminUser(u.id).subscribe(() => this.load());
  }

  upgrade() {
    const next = this.nextTier();
    if (!next) return;
    // Jump to the Billing tab and scroll the picker to the target
    // tier's card. Real upgrade happens through Stripe there; the old
    // direct-PUT stub is retired now that billing is real.
    window.dispatchEvent(new CustomEvent('settings:go-tab', { detail: 'billing' }));
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('billing:show-tier', { detail: next }));
    }, 50);
  }
}
