import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { HrEmployee } from '../../core/models';

/**
 * /hr/employees             — list of employees
 * /hr/employees/new         — create-from-existing-user form
 * /hr/employees/:id         — detail page (handled via separate component)
 */
@Component({
  selector: 'app-hr-employees',
  imports: [RouterLink, FormsModule],
  template: `
    @if (mode() === 'list') {
      <div class="toolbar">
        <h1>Employees</h1>
        <span class="spacer"></span>
        <button class="primary" routerLink="/hr/employees/new">+ Add employee</button>
      </div>

      <div class="content">
        <div class="filter-bar">
          <input class="filter-input"
                 [value]="search()"
                 (input)="search.set($any($event.target).value)"
                 placeholder="Search name, email, position…" />
          <select [ngModel]="statusFilter()" (ngModelChange)="statusFilter.set($event)" name="sf">
            <option [ngValue]="null">All statuses</option>
            <option value="active">Active</option>
            <option value="onboarding">Onboarding</option>
            <option value="on_leave">On leave</option>
            <option value="terminated">Terminated</option>
          </select>
        </div>

        @if (filtered().length === 0) {
          <div class="empty"><p class="muted">No employees match.</p></div>
        } @else {
          <div class="table-wrap">
            <table class="data">
              <thead><tr>
                <th>Name</th><th>Position</th><th>Department</th><th>Hire date</th><th>Status</th><th></th>
              </tr></thead>
              <tbody>
                @for (e of filtered(); track e.id) {
                  <tr (click)="open(e)">
                    <td>
                      <strong>{{ e.first_name }} {{ e.last_name }}</strong>
                      @if (e.email) { <div class="muted small">{{ e.email }}</div> }
                    </td>
                    <td>{{ e.position || '—' }}</td>
                    <td>{{ e.department || '—' }}</td>
                    <td>{{ e.hire_date || '—' }}</td>
                    <td><span class="status status-{{ e.status }}">{{ e.status }}</span></td>
                    <td class="actions">
                      <button class="ghost icon-btn" (click)="open(e); $event.stopPropagation()" title="View">›</button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>
    }

    @if (mode() === 'new') {
      <div class="toolbar">
        <button class="ghost" routerLink="/hr/employees">← Back</button>
        <h1>Add employee</h1>
      </div>

      <div class="card form-card">
        <p class="muted small">Adding an employee here also creates their system login (CMS / HR self-service). They'll be able to sign in with the temp password we generate after save.</p>

        <div class="grid-2">
          <div>
            <label>First name *</label>
            <input [(ngModel)]="draft.first_name" name="fn" />
          </div>
          <div>
            <label>Last name *</label>
            <input [(ngModel)]="draft.last_name" name="ln" />
          </div>
          <div>
            <label>Work email *</label>
            <input type="email" [(ngModel)]="draft.email" name="em" placeholder="alex@studio.com" />
          </div>
          <div>
            <label>System role</label>
            <select [(ngModel)]="draft.role" name="rl">
              <option value="admin">Admin</option>
              <option value="member">Member</option>
              <option value="viewer">Viewer</option>
            </select>
          </div>
          <div>
            <label>Position</label>
            <input [(ngModel)]="draft.position" name="pn" />
          </div>
          <div>
            <label>Department</label>
            <input [(ngModel)]="draft.department" name="de" />
          </div>
          <div>
            <label>Employment type</label>
            <select [(ngModel)]="draft.employment_type" name="et">
              <option value="full_time">Full-time</option>
              <option value="part_time">Part-time</option>
              <option value="contractor">Contractor</option>
              <option value="intern">Intern</option>
            </select>
          </div>
          <div>
            <label>Hire date</label>
            <input type="date" [(ngModel)]="draft.hire_date" name="hd" />
          </div>
          <div>
            <label>Salary amount</label>
            <input type="number" step="0.01" [(ngModel)]="draft.salary_amount" name="sa" />
          </div>
          <div>
            <label>Salary period</label>
            <select [(ngModel)]="draft.salary_period" name="sp">
              <option value="annual">Annual</option>
              <option value="monthly">Monthly</option>
              <option value="hourly">Hourly</option>
            </select>
          </div>
        </div>
        @if (error()) { <div class="error-msg">{{ error() }}</div> }
        <div class="row" style="margin-top: 16px; gap: 8px;">
          <button class="primary" (click)="create()" [disabled]="saving()">
            {{ saving() ? 'Saving…' : 'Create employee' }}
          </button>
          <button class="ghost" routerLink="/hr/employees">Cancel</button>
        </div>
      </div>
    }

    @if (createdResult(); as r) {
      <div class="modal-backdrop" (click)="dismissResult()"></div>
      <div class="modal-card">
        <h2>Employee created ✓</h2>
        @if (r.temp_password) {
          <p>Share these credentials with <strong>{{ r.first_name }} {{ r.last_name }}</strong> so they can log in:</p>
          <div class="creds">
            <div><span class="k">Login email</span> <code>{{ r.email }}</code></div>
            <div><span class="k">Temp password</span> <code class="pw">{{ r.temp_password }}</code></div>
          </div>
          <p class="muted small">Tell them to change this on first login. The temp password will not be shown again.</p>
        } @else {
          <p>Linked to existing user <code>{{ r.email }}</code>.</p>
        }
        <div class="row" style="gap: 8px; margin-top: 16px;">
          <button class="primary" (click)="goToCreated()">Open employee</button>
          <button class="ghost" (click)="dismissResult()">Stay on list</button>
        </div>
      </div>
    }
  `,
  styles: [`
    .toolbar { padding: 16px 20px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--line); }
    .toolbar h1 { margin: 0; font-size: 22px; }
    .content { padding: 20px 24px 32px; background: #ffffff; min-height: calc(100vh - 120px); }
    .spacer { flex: 1; }
    .filter-bar { display: flex; gap: 8px; padding: 12px 20px; }
    .filter-bar input { flex: 1; }
    .filter-bar select { width: 180px; }
    .table-wrap { padding: 0 20px 20px; }
    tr { cursor: pointer; }
    .status {
      display: inline-block; padding: 2px 10px; border-radius: 999px;
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      border: 1px solid var(--line);
    }
    .status-active     { color: var(--primary); border-color: var(--primary); }
    .status-onboarding { color: var(--primary); border-color: var(--primary); }
    .status-on_leave   { color: #f59e0b; border-color: #f59e0b; }
    .status-terminated { color: #ef4444; border-color: #ef4444; }
    .actions { text-align: right; }
    .empty { padding: 40px 20px; text-align: center; }
    .form-card { margin: 16px 20px; padding: 20px; }
    .form-card label { margin-top: 12px; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 8px; }
    .grid-2 label { margin-top: 0; }

    .modal-backdrop {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.6);
      z-index: 200;
    }
    .modal-card {
      position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
      width: min(480px, 92vw);
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius);
      box-shadow: var(--shadow);
      padding: 24px;
      z-index: 201;
    }
    .modal-card h2 { margin: 0 0 12px 0; }
    .creds {
      margin: 12px 0;
      padding: 12px 14px;
      background: var(--bg-3);
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      display: flex; flex-direction: column; gap: 8px;
    }
    .creds .k { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; display: block; }
    .creds code { font-size: 14px; }
    .creds .pw { font-size: 16px; font-weight: 700; color: var(--primary); letter-spacing: 1px; }
    .row { display: flex; align-items: center; }
  `],
})
export class HrEmployees {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  mode = signal<'list' | 'new'>('list');
  employees = signal<HrEmployee[]>([]);
  search = signal('');
  statusFilter = signal<string | null>(null);
  saving = signal(false);
  error = signal<string | null>(null);

  /** Draft for the new-employee form. The form posts to /hr/employees which
   *  auto-creates the admin_users record from email + role. */
  draft: HrEmployee & { email?: string; role?: string } = {
    admin_user_id: 0,
    first_name: '', last_name: '',
    email: '', role: 'member',
    employment_type: 'full_time', salary_period: 'annual', salary_currency: 'GBP',
    pto_days_year: 25, status: 'onboarding',
  };

  /** Result returned from the server after creation — used to render the temp-password modal. */
  createdResult = signal<{ id: number; first_name: string; last_name: string; email: string; temp_password?: string } | null>(null);

  filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    const sf = this.statusFilter();
    return this.employees().filter(e => {
      if (sf && e.status !== sf) return false;
      if (q) {
        const hay = (e.first_name + ' ' + e.last_name + ' ' + (e.email || '') + ' ' + (e.position || '')).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  });

  ngOnInit() {
    this.route.url.subscribe(seg => {
      const isNew = seg.length > 0 && seg[seg.length - 1].path === 'new';
      this.mode.set(isNew ? 'new' : 'list');
    });
    this.refresh();
  }

  refresh() {
    this.api.listHrEmployees().subscribe(r => this.employees.set(r.employees));
  }

  open(e: HrEmployee) {
    this.router.navigate(['/hr/employees', e.id]);
  }

  create() {
    this.error.set(null);
    if (!this.draft.first_name?.trim()) { this.error.set('First name required'); return; }
    if (!this.draft.last_name?.trim())  { this.error.set('Last name required'); return; }
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(this.draft.email || '')) { this.error.set('Valid work email required'); return; }
    this.saving.set(true);
    this.api.createHrEmployee(this.draft).subscribe({
      next: r => {
        this.saving.set(false);
        this.refresh();
        this.createdResult.set({
          id: r.id,
          first_name: this.draft.first_name,
          last_name:  this.draft.last_name,
          email:      this.draft.email || '',
          temp_password: r.temp_password,
        });
      },
      error: e => { this.saving.set(false); this.error.set(e?.error?.error || 'Failed'); },
    });
  }

  dismissResult() {
    this.createdResult.set(null);
    // Reset the form so the next "+ Add employee" starts blank.
    this.draft = {
      admin_user_id: 0, first_name: '', last_name: '',
      email: '', role: 'member',
      employment_type: 'full_time', salary_period: 'annual', salary_currency: 'GBP',
      pto_days_year: 25, status: 'onboarding',
    };
    this.router.navigate(['/hr/employees']);
  }
  goToCreated() {
    const r = this.createdResult();
    if (!r) return;
    this.createdResult.set(null);
    this.router.navigate(['/hr/employees', r.id]);
  }
}
