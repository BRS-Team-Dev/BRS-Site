import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { Auth } from '../../core/auth';
import { DialogService } from '../../core/dialog';
import { Contractor, ContractorPermissions } from '../../core/models';
import { MyTaskRow, UserTaskTracker } from '../../shared/user-task-tracker';
import { UserAccounts } from '../../shared/user-accounts';

type View = 'overview' | 'profile' | 'contracts' | 'documents' | 'clients' | 'tasks' | 'accounts' | 'account';

/**
 * Contractor self-service portal — reached at /contractor/me/*.
 * The only feature area a role='contractor' user has access to.
 * Everything is scoped server-side to the contractor row linked to
 * the logged-in admin_user_id, so no id needs to be threaded through
 * the URL.
 */
@Component({
  selector: 'app-contractor-me',
  imports: [RouterLink, FormsModule, UserTaskTracker, UserAccounts],
  template: `
    <div class="layout">
      <div class="toolbar">
        <h1>{{ heading() }}</h1>
      </div>

      @if (loading()) { <p class="muted">Loading…</p> }

      @if (view === 'overview' && overview(); as ov) {
        <div class="hero">
          <h2>Welcome back{{ contractor()?.name ? ', ' + contractor()!.name : '' }}</h2>
          <p class="muted small">Here's what's on your plate right now.</p>
        </div>

        <div class="ov-grid">
          <a class="ov-kpi" routerLink="/contractor/me/tasks" [class.stacked]="!permissions().view_tasks">
            <div class="k-value" [class.k-danger]="ov.tasks.overdue > 0">{{ ov.tasks.total }}</div>
            <div class="k-label">Open tasks</div>
            <div class="k-sub muted small">
              {{ ov.tasks.in_progress }} in progress
              @if (ov.tasks.overdue > 0) { · <span class="danger">{{ ov.tasks.overdue }} overdue</span> }
            </div>
          </a>
          <a class="ov-kpi" routerLink="/contractor/me/clients">
            <div class="k-value">{{ ov.clients }}</div>
            <div class="k-label">Assigned clients</div>
            <div class="k-sub muted small">Active engagements</div>
          </a>
          <a class="ov-kpi" routerLink="/contractor/me/contracts">
            <div class="k-value">{{ ov.contracts }}</div>
            <div class="k-label">Contracts</div>
            <div class="k-sub muted small">On file for you</div>
          </a>
          <a class="ov-kpi" routerLink="/contractor/me/documents">
            <div class="k-value">{{ ov.documents }}</div>
            <div class="k-label">Documents</div>
            <div class="k-sub muted small">Uploaded for you</div>
          </a>
        </div>

        <div class="card">
          <div class="tab-head" style="margin-bottom: 12px;">
            <h2 style="margin: 0;">Up next</h2>
            <span class="spacer"></span>
            <a class="ghost small" routerLink="/contractor/me/tasks">See all →</a>
          </div>
          @if (!ov.upcoming || ov.upcoming.length === 0) {
            <p class="muted small">Nothing scheduled — enjoy the calm.</p>
          } @else {
            <ul class="upcoming">
              @for (t of ov.upcoming; track t.source + ':' + t.id) {
                <li>
                  <span class="src-pill" [attr.data-src]="t.source">{{ t.source === 'crm' ? 'CRM' : 'Taskboard' }}</span>
                  <strong>{{ t.title }}</strong>
                  @if (t.project_name) { <span class="muted small">— {{ t.project_name }}</span> }
                  @if (t.due_at) { <span class="due muted small">due {{ t.due_at }}</span> }
                </li>
              }
            </ul>
          }
        </div>
      }

      @if (view === 'profile' && contractor(); as c) {
        <div class="card">
          <h2>Engagement</h2>
          <div class="row two">
            <div class="kv"><label>Discipline</label><div>{{ c.discipline || '—' }}</div></div>
            <div class="kv"><label>Status</label><div>{{ c.status }}</div></div>
          </div>
          <div class="row two">
            <div class="kv"><label>Engagement</label><div>{{ c.engagement_type }}</div></div>
            <div class="kv"><label>Rate</label>
              <div>@if (c.rate) { {{ c.currency }} {{ c.rate }} } @else { — }</div>
            </div>
          </div>
          <div class="row two">
            <div class="kv"><label>Start date</label><div>{{ c.start_date || '—' }}</div></div>
            <div class="kv"><label>End date</label><div>{{ c.end_date || '—' }}</div></div>
          </div>
          <p class="muted small">
            Rate, status and engagement dates are managed by your project manager.
            To change them, get in touch with them directly.
          </p>
        </div>

        <div class="card">
          <div class="tab-head">
            <h2 style="margin: 0;">Contact details</h2>
            <span class="spacer"></span>
            @if (!editing()) {
              @if (permissions().edit_profile) {
                <button class="ghost" (click)="startEdit()">✎ Edit</button>
              }
            } @else {
              <button class="primary" (click)="saveEdit()" [disabled]="saving()" style="white-space: nowrap;">
                {{ saving() ? 'Saving…' : 'Save' }}
              </button>
              <button class="ghost" (click)="cancelEdit()" style="white-space: nowrap;">Cancel</button>
            }
          </div>

          @if (!editing()) {
            <div class="row two">
              <div class="kv"><label>Email</label><div>{{ c.primary_email || '—' }}</div></div>
              <div class="kv"><label>Phone</label><div>{{ c.primary_phone || '—' }}</div></div>
            </div>
            <div class="kv"><label>Website</label><div>{{ c.website || '—' }}</div></div>
            <div class="kv"><label>Address</label><div class="notes">{{ c.address || '—' }}</div></div>
            <div class="row two">
              <div class="kv"><label>UTR / Tax ID</label><div>{{ c.tax_id || '—' }}</div></div>
              <div class="kv"><label>VAT number</label><div>{{ c.vat_number || '—' }}</div></div>
            </div>
          } @else {
            <div class="row two">
              <div class="field">
                <label>Email</label>
                <input type="email" [(ngModel)]="draft.primary_email" name="email" />
              </div>
              <div class="field">
                <label>Phone</label>
                <input [(ngModel)]="draft.primary_phone" name="phone" />
              </div>
            </div>
            <div class="field">
              <label>Website</label>
              <input [(ngModel)]="draft.website" name="website" />
            </div>
            <div class="field">
              <label>Address</label>
              <textarea rows="3" [(ngModel)]="draft.address" name="address"></textarea>
            </div>
            <div class="row two">
              <div class="field">
                <label>UTR / Tax ID</label>
                <input [(ngModel)]="draft.tax_id" name="tax_id" />
              </div>
              <div class="field">
                <label>VAT number</label>
                <input [(ngModel)]="draft.vat_number" name="vat_number" />
              </div>
            </div>
          }
        </div>
      }

      @if (view === 'contracts') {
        <div class="card">
          @if (contracts().length === 0) {
            <p class="muted">No contracts uploaded yet.</p>
          } @else {
            <table class="data">
              <thead><tr><th>Title</th><th>Issued</th><th>Expires</th><th>Signed</th><th></th></tr></thead>
              <tbody>
                @for (c of contracts(); track c.id) {
                  <tr>
                    <td>{{ c.title }}</td>
                    <td>{{ c.issued_at || '—' }}</td>
                    <td>{{ c.expires_at || '—' }}</td>
                    <td>@if (c.signed_at) { {{ c.signed_at }} } @else { <span class="muted">—</span> }</td>
                    <td style="text-align: right;">
                      <a class="ghost" [href]="fileUrl(c.file_path)" target="_blank" rel="noopener">Open</a>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </div>
      }

      @if (view === 'documents') {
        <div class="card">
          @if (documents().length === 0) {
            <p class="muted">No documents uploaded yet.</p>
          } @else {
            <table class="data">
              <thead><tr><th>Title</th><th>Category</th><th>Uploaded</th><th></th></tr></thead>
              <tbody>
                @for (d of documents(); track d.id) {
                  <tr>
                    <td>{{ d.title }}</td>
                    <td>{{ d.category }}</td>
                    <td>{{ d.uploaded_at }}</td>
                    <td style="text-align: right;">
                      <a class="ghost" [href]="fileUrl(d.file_path)" target="_blank" rel="noopener">Open</a>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </div>
      }

      @if (view === 'clients') {
        <div class="card">
          @if (!permissions().view_clients) {
            <p class="muted">You don't have permission to view clients.</p>
          } @else if (clients().length === 0) {
            <p class="muted">You haven't been assigned to any clients yet.</p>
          } @else {
            <table class="data">
              <thead><tr><th>Client</th><th>Company</th><th>Role</th><th>Contact</th><th>Since</th></tr></thead>
              <tbody>
                @for (c of clients(); track c.id) {
                  <tr>
                    <td>{{ c.name }}</td>
                    <td>{{ c.company || '—' }}</td>
                    <td>{{ c.engagement_role || '—' }}</td>
                    <td>@if (c.email) { <a [href]="'mailto:' + c.email">{{ c.email }}</a> } @else { — }</td>
                    <td>{{ c.added_at }}</td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </div>
      }

      @if (view === 'tasks') {
        @if (!permissions().view_tasks) {
          <div class="card"><p class="muted">You don't have permission to view tasks.</p></div>
        } @else {
          <app-user-task-tracker [tasks]="tasks()" (onStatusChange)="patchCrmTaskStatus($event.task, $event.next)" />
        }
      }

      @if (view === 'accounts') {
        <app-user-accounts source="contractor" />
      }

      @if (view === 'account') {
        <div class="card">
          <h2>Change password</h2>
          <div class="field">
            <label>Current password</label>
            <input type="password" [(ngModel)]="pwCurrent" name="cur_pw" autocomplete="current-password" />
          </div>
          <div class="field">
            <label>New password (min 8 characters)</label>
            <input type="password" [(ngModel)]="pwNew" name="new_pw" autocomplete="new-password" />
          </div>
          <div class="field">
            <label>Confirm new password</label>
            <input type="password" [(ngModel)]="pwConfirm" name="new_pw2" autocomplete="new-password" />
          </div>
          @if (pwError()) { <div class="error-msg">{{ pwError() }}</div> }
          <div style="margin-top: 12px;">
            <button class="primary" (click)="changePassword()" [disabled]="pwSaving()">
              {{ pwSaving() ? 'Saving…' : 'Change password' }}
            </button>
          </div>
        </div>
        <div class="card">
          <h2>Sign out</h2>
          <p class="muted small">Signs you out on this browser only.</p>
          <button class="ghost danger" (click)="signOut()">Sign out</button>
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .layout { padding: 20px; }
    .row.two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
    .kv { margin-bottom: 14px; }
    .kv label { display: block; color: var(--muted); font-size: 11px;
      text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 4px 0; }
    .kv > div { color: var(--fg); font-size: 14px; word-break: break-word; }
    .kv .notes { white-space: pre-wrap; }
    .card { padding: 20px; }
    .card + .card { margin-top: 16px; }
    .card h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); margin: 0 0 12px 0; font-weight: 600; }
    .tab-head { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
    .tab-head .spacer { flex: 1; }

    .hero { margin-bottom: 16px; }
    .hero h2 { margin: 0 0 4px 0; font-size: 22px; color: var(--fg); text-transform: none; letter-spacing: 0; }

    .ov-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
    @media (max-width: 900px) { .ov-grid { grid-template-columns: repeat(2, 1fr); } }
    @media (max-width: 500px) { .ov-grid { grid-template-columns: 1fr; } }
    .ov-kpi {
      display: flex; flex-direction: column; gap: 4px;
      background: var(--bg-2); border: 1px solid var(--line);
      border-radius: var(--radius-sm); padding: 14px 16px;
      color: var(--fg); text-decoration: none;
      transition: border-color 160ms ease, transform 160ms ease;
    }
    .ov-kpi:hover { border-color: var(--primary); transform: translateY(-1px); }
    .k-value { font-size: 28px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .k-value.k-danger { color: var(--danger); }
    .k-label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
    .k-sub { margin-top: 4px; }
    .danger { color: var(--danger); font-weight: 700; }

    .upcoming { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .upcoming li {
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
      background: var(--bg-3); border-radius: var(--radius-sm); padding: 8px 12px;
    }
    .upcoming .due { margin-left: auto; }
    .src-pill {
      display: inline-block; padding: 2px 8px; border-radius: 999px;
      font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px;
      border: 1px solid var(--line); color: var(--muted); white-space: nowrap;
    }
    .src-pill[data-src="crm"]       { color: var(--primary); border-color: var(--primary); }
    .src-pill[data-src="taskboard"] { color: #56CCF2;        border-color: #56CCF2; }
    .ghost.small { padding: 4px 10px; font-size: 12px; }
  `],
})
export class ContractorMe {
  private api = inject(Api);
  private auth = inject(Auth);
  private dialog = inject(DialogService);

  view: View = 'profile';

  loading = signal(true);
  contractor = signal<Contractor | null>(null);
  permissions = signal<ContractorPermissions>({
    view_clients: false, view_tasks: false, view_invoices: false,
    upload_documents: false, edit_profile: true,
  });

  editing = signal(false);
  saving = signal(false);
  draft: Partial<Contractor> = {};

  contracts = signal<any[]>([]);
  documents = signal<any[]>([]);
  clients = signal<any[]>([]);
  tasks = signal<MyTaskRow[]>([]);
  overview = signal<any | null>(null);

  pwCurrent = '';
  pwNew = '';
  pwConfirm = '';
  pwSaving = signal(false);
  pwError = signal<string | null>(null);

  constructor() {
    this.detectView();
    this.load();
  }

  private detectView() {
    const url = window.location.pathname;
    if (url.endsWith('/contracts'))      this.view = 'contracts';
    else if (url.endsWith('/documents')) this.view = 'documents';
    else if (url.endsWith('/clients'))   this.view = 'clients';
    else if (url.endsWith('/accounts'))  this.view = 'accounts';
    else if (url.endsWith('/tasks'))     this.view = 'tasks';
    else if (url.endsWith('/profile'))   this.view = 'profile';
    else if (url.endsWith('/account'))   this.view = 'account';
    else                                 this.view = 'overview';
  }

  heading(): string {
    return this.view === 'overview'  ? 'Overview'
         : this.view === 'profile'   ? 'My profile'
         : this.view === 'contracts' ? 'My contracts'
         : this.view === 'documents' ? 'My documents'
         : this.view === 'clients'   ? 'My clients'
         : this.view === 'accounts'  ? 'My accounts & commissions'
         : this.view === 'tasks'     ? 'My tasks'
         : 'Account settings';
  }

  private load() {
    this.loading.set(true);
    // Always hydrate the permissions signal — the side nav needs it to know
    // which entries to show. Cheap enough to fetch on every navigation.
    this.api.getContractorMe().subscribe({
      next: r => {
        this.contractor.set(r.contractor);
        this.permissions.set(r.permissions);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });

    if (this.view === 'overview') {
      this.api.getContractorMeOverview().subscribe({ next: r => this.overview.set(r.overview) });
    } else if (this.view === 'contracts') {
      this.api.listContractorMeContracts().subscribe({ next: r => this.contracts.set(r.contracts || []) });
    } else if (this.view === 'documents') {
      this.api.listContractorMeDocuments().subscribe({ next: r => this.documents.set(r.documents || []) });
    } else if (this.view === 'clients') {
      this.api.listContractorMeClients().subscribe({ next: r => this.clients.set(r.clients || []) });
    } else if (this.view === 'tasks') {
      this.api.listContractorMeTasks().subscribe({ next: r => this.tasks.set(r.tasks || []) });
    }
  }

  patchCrmTaskStatus(task: MyTaskRow, next: string) {
    // Optimistic — update the local copy immediately so the pill flips
    // without waiting for the round-trip. Roll back on error.
    const previous = task.status;
    this.tasks.set(this.tasks().map(t =>
      t.source === task.source && t.id === task.id ? { ...t, status: next } : t));
    this.api.patchContractorMeCrmTaskStatus(task.id, next).subscribe({
      error: () => {
        this.tasks.set(this.tasks().map(t =>
          t.source === task.source && t.id === task.id ? { ...t, status: previous } : t));
      },
    });
  }

  startEdit() {
    const c = this.contractor(); if (!c) return;
    this.draft = {
      primary_email: c.primary_email, primary_phone: c.primary_phone,
      website: c.website, address: c.address,
      tax_id: c.tax_id, vat_number: c.vat_number,
    };
    this.editing.set(true);
  }
  cancelEdit() { this.editing.set(false); }
  saveEdit() {
    this.saving.set(true);
    this.api.updateContractorMe(this.draft).subscribe({
      next: () => { this.saving.set(false); this.editing.set(false); this.load(); },
      error: async e => {
        this.saving.set(false);
        await this.dialog.alert(e?.error?.error || 'Save failed.');
      },
    });
  }

  async changePassword() {
    this.pwError.set(null);
    if (this.pwNew.length < 8) { this.pwError.set('Password must be at least 8 characters.'); return; }
    if (this.pwNew !== this.pwConfirm) { this.pwError.set('New and confirm password do not match.'); return; }
    this.pwSaving.set(true);
    this.api.changeContractorMePassword(this.pwCurrent, this.pwNew).subscribe({
      next: async () => {
        this.pwSaving.set(false);
        this.pwCurrent = ''; this.pwNew = ''; this.pwConfirm = '';
        await this.dialog.alert('Password updated.', { title: 'Password changed' });
      },
      error: e => {
        this.pwSaving.set(false);
        this.pwError.set(e?.error?.error || 'Failed to change password.');
      },
    });
  }

  signOut() { this.auth.logout(); }

  fileUrl(path: string | null | undefined): string {
    if (!path) return '#';
    if (/^https?:/i.test(path)) return path;
    return path.startsWith('/') ? path : '/' + path;
  }
}
