import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { AdminUserRecord } from '../../core/models';

/**
 * /admin/users — team-member management for the CMS / taskboard assignees.
 */
@Component({
  selector: 'app-users-admin',
  imports: [FormsModule],
  template: `
    <div class="toolbar">
      <h1>Team</h1>
      <span class="spacer"></span>
      <button class="primary" (click)="toggleNew()">
        {{ showNew() ? '× Cancel' : '+ New member' }}
      </button>
    </div>

    @if (showNew()) {
      <div class="invite-card card">
        <h3>Invite team member</h3>
        <div class="grid-2">
          <div>
            <label>Display name</label>
            <input [(ngModel)]="draft.display_name" name="dn" placeholder="Jane Doe" />
          </div>
          <div>
            <label>Email</label>
            <input [(ngModel)]="draft.email" name="em" type="email" placeholder="jane@studio.com" />
          </div>
          <div>
            <label>Role</label>
            <select [(ngModel)]="draft.role" name="rl">
              <option value="admin">Admin</option>
              <option value="member">Member</option>
              <option value="viewer">Viewer</option>
            </select>
          </div>
          <div>
            <label>Initial password</label>
            <input [(ngModel)]="draft.password" name="pw" type="text" placeholder="At least 8 characters" />
          </div>
        </div>
        @if (error()) { <div class="error-msg">{{ error() }}</div> }
        <div class="row" style="margin-top: 14px; gap: 8px;">
          <button class="primary" (click)="create()" [disabled]="saving()">
            {{ saving() ? 'Creating…' : 'Create member' }}
          </button>
          <button class="ghost" (click)="closeNew()">Done</button>
        </div>
      </div>
    }

    @if (active().length === 0 && inactive().length === 0) {
      <div class="empty">
        <p class="muted">No team members yet.</p>
      </div>
    } @else {
      <div class="table-wrap">
        <table class="data">
          <thead><tr>
            <th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th>
          </tr></thead>
          <tbody>
            @for (u of active(); track u.id) {
              <tr>
                <td>
                  @if (editing() === u.id) {
                    <input [(ngModel)]="edits.display_name" name="ed_{{ u.id }}" />
                  } @else {
                    <strong>{{ u.display_name }}</strong>
                  }
                </td>
                <td>
                  @if (editing() === u.id) {
                    <input [(ngModel)]="edits.email" name="ee_{{ u.id }}" type="email" />
                  } @else {
                    <code>{{ u.email }}</code>
                  }
                </td>
                <td>
                  @if (editing() === u.id) {
                    <select [(ngModel)]="edits.role" name="er_{{ u.id }}">
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  } @else {
                    <span class="role role-{{ u.role || 'member' }}">{{ u.role || 'member' }}</span>
                  }
                </td>
                <td><span class="muted small">Active</span></td>
                <td class="actions">
                  @if (editing() === u.id) {
                    <button class="ghost icon-btn" (click)="saveEdit(u)" title="Save">✓</button>
                    <button class="ghost icon-btn danger" (click)="cancelEdit()" title="Cancel">✕</button>
                  } @else {
                    <button class="ghost icon-btn" (click)="startEdit(u)" title="Edit">✎</button>
                    <button class="ghost icon-btn danger" (click)="deactivate(u)" title="Deactivate">✕</button>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      @if (inactive().length > 0) {
        <div class="toolbar" style="margin-top: 24px;">
          <h2 style="font-size: 16px; color: var(--muted); margin: 0;">Deactivated</h2>
        </div>
        <div class="table-wrap">
          <table class="data">
            <thead><tr>
              <th>Name</th><th>Email</th><th>Role</th><th></th>
            </tr></thead>
            <tbody>
              @for (u of inactive(); track u.id) {
                <tr class="dim">
                  <td>{{ u.display_name }}</td>
                  <td><code>{{ u.email }}</code></td>
                  <td><span class="role role-{{ u.role || 'member' }}">{{ u.role || 'member' }}</span></td>
                  <td class="actions">
                    <button class="ghost icon-btn" (click)="reactivate(u)" title="Reactivate">↺</button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    }
  `,
  styles: [`
    .grid-2 {
      display: grid; grid-template-columns: 1fr 1fr; gap: 14px;
    }
    .grid-2 label { margin-top: 0; }
    .invite-card { margin: 12px 20px 0; padding: 20px; }
    .role {
      display: inline-block; padding: 2px 10px; border-radius: 999px;
      font-size: 12px; font-weight: 600; text-transform: capitalize;
      border: 1px solid var(--line);
    }
    .role-admin { color: var(--primary); border-color: var(--primary); }
    .role-member { color: var(--fg); }
    .role-viewer { color: var(--muted); }
    tr.dim td { opacity: 0.55; }
    .empty { padding: 40px 20px; text-align: center; }
  `],
})
export class UsersAdmin {
  private api = inject(Api);

  users = signal<AdminUserRecord[]>([]);
  active = computed(() => this.users().filter(u => u.is_active !== 0));
  inactive = computed(() => this.users().filter(u => u.is_active === 0));

  showNew = signal(false);
  saving = signal(false);
  error = signal<string | null>(null);
  draft: AdminUserRecord = { email: '', display_name: '', role: 'member', password: '' };

  editing = signal<number | null>(null);
  edits: AdminUserRecord = { email: '', display_name: '', role: 'member' };

  ngOnInit() { this.load(); }

  private load() {
    this.api.listAdminUsers().subscribe(r => this.users.set(r.users));
  }

  toggleNew() {
    if (this.showNew()) this.closeNew();
    else this.openNew();
  }
  openNew() {
    this.draft = { email: '', display_name: '', role: 'member', password: '' };
    this.error.set(null);
    this.showNew.set(true);
  }
  closeNew() {
    this.showNew.set(false);
    this.error.set(null);
  }
  create() {
    this.error.set(null);
    if (!this.draft.display_name?.trim()) { this.error.set('Display name required'); return; }
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(this.draft.email || '')) { this.error.set('Valid email required'); return; }
    if ((this.draft.password || '').length < 8) { this.error.set('Password must be at least 8 characters'); return; }
    this.saving.set(true);
    this.api.createAdminUser(this.draft).subscribe({
      next: () => { this.saving.set(false); this.closeNew(); this.load(); },
      error: e => { this.saving.set(false); this.error.set(e?.error?.error || 'Failed'); },
    });
  }

  startEdit(u: AdminUserRecord) {
    this.edits = { id: u.id, email: u.email, display_name: u.display_name, role: u.role || 'member' };
    this.editing.set(u.id!);
  }
  cancelEdit() { this.editing.set(null); }
  saveEdit(u: AdminUserRecord) {
    if (!u.id) return;
    this.api.updateAdminUser(u.id, this.edits).subscribe(() => {
      this.editing.set(null);
      this.load();
    });
  }

  deactivate(u: AdminUserRecord) {
    if (!u.id) return;
    if (!confirm(`Deactivate ${u.display_name}? Their assignments and history are preserved.`)) return;
    this.api.deleteAdminUser(u.id).subscribe(() => this.load());
  }
  reactivate(u: AdminUserRecord) {
    if (!u.id) return;
    this.api.updateAdminUser(u.id, { ...u, is_active: 1 }).subscribe(() => this.load());
  }
}
