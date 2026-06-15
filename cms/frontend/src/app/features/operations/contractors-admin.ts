import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { EntityContracts } from '../../shared/entity-contracts';
import {
  Contractor, ContractorStatus, ContractorType, ContractorSource,
  EngagementType, Ir35Status, ContractorNote,
} from '../../core/models';

type Mode = 'list' | 'view' | 'edit';

const STATUS_LABELS: Record<ContractorStatus, string> = {
  active: 'Active', inactive: 'Inactive', on_break: 'On break', ended: 'Ended',
};
const TYPE_LABELS: Record<ContractorType, string> = {
  individual: 'Individual', agency: 'Agency', freelancer: 'Freelancer', consultant: 'Consultant',
};
const ENG_LABELS: Record<EngagementType, string> = {
  hourly: 'Hourly', daily: 'Daily', project: 'Project', retainer: 'Retainer',
  full_time: 'Full time', part_time: 'Part time',
};
const IR35_LABELS: Record<Ir35Status, string> = {
  inside: 'Inside IR35', outside: 'Outside IR35', not_applicable: 'N/A', unknown: 'Unknown',
};

const blankDraft = (): Contractor => ({
  name: '', contractor_type: 'freelancer', internal_external: 'external',
  discipline: '', status: 'active', engagement_type: 'hourly',
  rate: null, currency: 'GBP', start_date: '', end_date: '',
  primary_email: '', primary_phone: '', website: '', address: '',
  tax_id: '', vat_number: '', company_number: '', ir35_status: 'unknown',
  notes: '', project_manager_id: null,
});
const blankNote = (): ContractorNote => ({ title: '', body: '', sort_order: 0 });

/**
 * Contractors admin — Operations system. Tracks external/internal
 * contractors with the UK-specific tax shape (IR35 status, VAT, company
 * number, UTR). Single-column detail view with an embedded notes section.
 *
 *   /operations/contractors            → list
 *   /operations/contractors/new        → create
 *   /operations/contractors/:id        → view
 *   /operations/contractors/:id/edit   → edit
 */
@Component({
  selector: 'app-contractors-admin',
  imports: [RouterLink, FormsModule, EntityContracts],
  template: `
    @if (mode() === 'list') {
      <div class="toolbar">
        <h1>Contractors</h1>
        <span class="spacer"></span>
        <select [(ngModel)]="filterStatus" name="status_filter" class="status-filter">
          <option value="">All statuses</option>
          @for (s of statusOptions; track s) { <option [value]="s">{{ statusLabel(s) }}</option> }
        </select>
        <select [(ngModel)]="filterKind" name="kind_filter" class="status-filter">
          <option value="">Internal + external</option>
          <option value="internal">Internal only</option>
          <option value="external">External only</option>
        </select>
        <button class="primary" routerLink="/operations/contractors/new">+ New contractor</button>
      </div>

      @if (visible().length === 0) {
        <div class="empty">
          <p class="muted">No contractors yet.</p>
          <button class="primary" routerLink="/operations/contractors/new">Add your first contractor</button>
        </div>
      } @else {
        <div class="table-wrap">
          <table class="data">
            <thead><tr>
              <th>Name</th><th>Discipline</th><th>Engagement</th><th>Rate</th>
              <th>Source</th><th>IR35</th><th>Status</th><th></th>
            </tr></thead>
            <tbody>
              @for (c of visible(); track c.id) {
                <tr (click)="view(c)">
                  <td><strong>{{ c.name }}</strong>
                    <div class="muted small">{{ typeLabel(c.contractor_type || 'freelancer') }}</div>
                  </td>
                  <td>{{ c.discipline || '—' }}</td>
                  <td>{{ engLabel(c.engagement_type || 'hourly') }}</td>
                  <td>
                    @if (c.rate) { {{ c.currency }} {{ formatValue(c.rate) }} } @else { — }
                  </td>
                  <td><span class="badge" [attr.data-source]="c.internal_external">{{ c.internal_external }}</span></td>
                  <td><span class="badge">{{ ir35Label(c.ir35_status || 'unknown') }}</span></td>
                  <td><span class="status-pill" [attr.data-status]="c.status || 'active'">{{ statusLabel(c.status || 'active') }}</span></td>
                  <td class="actions">
                    <button class="ghost icon-btn" (click)="view(c, $event)" title="View">👁</button>
                    <button class="ghost icon-btn" (click)="edit(c, $event)" title="Edit">✎</button>
                    <button class="ghost icon-btn danger" (click)="del(c, $event)" title="Delete">✕</button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    }

    @if (mode() === 'view' && current(); as c) {
      <div class="toolbar">
        <button class="ghost" routerLink="/operations/contractors">← Back</button>
        <h1>{{ c.name }}</h1>
        <span class="spacer"></span>
        <button class="ghost" (click)="edit(c)">✎ Edit</button>
        <button class="danger" (click)="delCurrent()">Delete</button>
      </div>

      <div class="card">
        <h2>Engagement</h2>
        <div class="row two">
          <div class="kv"><label>Status</label>
            <div><span class="status-pill" [attr.data-status]="c.status || 'active'">{{ statusLabel(c.status || 'active') }}</span></div>
          </div>
          <div class="kv"><label>Type</label><div>{{ typeLabel(c.contractor_type || 'freelancer') }}</div></div>
        </div>
        <div class="row two">
          <div class="kv"><label>Internal / external</label><div>{{ c.internal_external }}</div></div>
          <div class="kv"><label>Discipline</label><div>{{ c.discipline || '—' }}</div></div>
        </div>
        <div class="row two">
          <div class="kv"><label>Engagement</label><div>{{ engLabel(c.engagement_type || 'hourly') }}</div></div>
          <div class="kv"><label>Rate</label>
            <div>@if (c.rate) { {{ c.currency }} {{ formatValue(c.rate) }} per {{ rateUnit(c.engagement_type) }} } @else { — }</div>
          </div>
        </div>
        <div class="row two">
          <div class="kv"><label>Start date</label><div>{{ c.start_date || '—' }}</div></div>
          <div class="kv"><label>End date</label><div>{{ c.end_date || '—' }}</div></div>
        </div>

        <h2 style="margin-top: 18px;">Contact</h2>
        <div class="row two">
          <div class="kv"><label>Email</label>
            <div>@if (c.primary_email) { <a [href]="'mailto:' + c.primary_email">{{ c.primary_email }}</a> } @else { — }</div>
          </div>
          <div class="kv"><label>Phone</label><div>{{ c.primary_phone || '—' }}</div></div>
        </div>
        <div class="kv"><label>Website</label>
          <div>@if (c.website) { <a [href]="c.website" target="_blank" rel="noopener">{{ c.website }}</a> } @else { — }</div>
        </div>
        <div class="kv"><label>Address</label><div class="notes">{{ c.address || '—' }}</div></div>

        <h2 style="margin-top: 18px;">Legal &amp; tax</h2>
        <div class="row two">
          <div class="kv"><label>UTR / Tax ID</label><div>{{ c.tax_id || '—' }}</div></div>
          <div class="kv"><label>VAT number</label><div>{{ c.vat_number || '—' }}</div></div>
        </div>
        <div class="row two">
          <div class="kv"><label>Company number</label><div>{{ c.company_number || '—' }}</div></div>
          <div class="kv"><label>IR35 status</label>
            <div><span class="badge" [attr.data-ir35]="c.ir35_status">{{ ir35Label(c.ir35_status || 'unknown') }}</span></div>
          </div>
        </div>

        @if (c.notes) {
          <h2 style="margin-top: 18px;">Quick notes</h2>
          <div class="kv"><div class="notes">{{ c.notes }}</div></div>
        }
        <div class="kv"><label>Project manager</label><div>{{ c.manager_email || '—' }}</div></div>
      </div>

      <div class="card">
        <h2>Contracts</h2>
        <app-entity-contracts audience="contractor" [entityId]="c.id!"></app-entity-contracts>
      </div>

      <div class="card">
        <div class="tab-head" style="margin-bottom: 16px;">
          <h2 style="margin: 0;">Notes</h2>
          <span class="spacer"></span>
          <button class="primary" (click)="toggleNoteForm()">{{ noteFormOpen() ? '× Cancel' : '+ Add note' }}</button>
        </div>
        @if (noteFormOpen()) {
          <div class="sub-form">
            <label>Title <span class="req">★</span></label>
            <input [(ngModel)]="noteDraft.title" name="nf_title" />
            <label>Body</label>
            <textarea [(ngModel)]="noteDraft.body" name="nf_body" rows="6"></textarea>
            @if (subError()) { <div class="error-msg">{{ subError() }}</div> }
            <div class="row" style="margin-top: 16px; gap: 8px;">
              <button class="primary" (click)="saveNote()" [disabled]="subSaving()">
                {{ subSaving() ? 'Saving…' : (noteDraft.id ? 'Update' : 'Save note') }}
              </button>
              <button class="ghost" (click)="closeNoteForm()">Close</button>
            </div>
          </div>
        }
        @if (notes().length === 0 && !noteFormOpen()) {
          <p class="muted">No notes yet.</p>
        } @else {
          <div class="note-list">
            @for (n of notes(); track n.id) {
              <div class="note-card">
                <div class="note-head">
                  <strong>{{ n.title }}</strong>
                  <span class="spacer"></span>
                  <span class="muted small">{{ n.updated_at || n.created_at }}</span>
                  <button class="ghost icon-btn" (click)="editNote(n)" title="Edit">✎</button>
                  <button class="ghost icon-btn danger" (click)="deleteNote(n)" title="Delete">✕</button>
                </div>
                @if (n.body) { <p class="note-body">{{ n.body }}</p> }
              </div>
            }
          </div>
        }
      </div>
    }

    @if (mode() === 'edit') {
      <div class="toolbar">
        <button class="ghost" (click)="back()">← Back</button>
        <h1>{{ draft.id ? 'Edit contractor' : 'New contractor' }}</h1>
        <span class="spacer"></span>
        <button class="primary" (click)="save()" [disabled]="saving()">{{ saving() ? 'Saving…' : (draft.id ? 'Save' : 'Create contractor') }}</button>
      </div>
      @if (error()) { <div class="error-msg">{{ error() }}</div> }

      <div class="card">
        <h2>Identity</h2>
        <label>Name <span class="req">★</span></label>
        <input [(ngModel)]="draft.name" name="name" placeholder="Person or agency name" />

        <div class="row two">
          <div class="field"><label>Contractor type</label>
            <select [(ngModel)]="draft.contractor_type" name="ctype">
              @for (t of typeOptions; track t) { <option [value]="t">{{ typeLabel(t) }}</option> }
            </select>
          </div>
          <div class="field"><label>Internal / external</label>
            <select [(ngModel)]="draft.internal_external" name="kind">
              <option value="external">External</option>
              <option value="internal">Internal</option>
            </select>
          </div>
        </div>

        <div class="row two">
          <div class="field"><label>Discipline</label>
            <input [(ngModel)]="draft.discipline" name="discipline" placeholder="Development, Design, …" /></div>
          <div class="field"><label>Status</label>
            <select [(ngModel)]="draft.status" name="status">
              @for (s of statusOptions; track s) { <option [value]="s">{{ statusLabel(s) }}</option> }
            </select>
          </div>
        </div>

        <h2 style="margin-top: 20px;">Engagement</h2>
        <div class="row two">
          <div class="field"><label>Engagement type</label>
            <select [(ngModel)]="draft.engagement_type" name="eng">
              @for (e of engOptions; track e) { <option [value]="e">{{ engLabel(e) }}</option> }
            </select>
          </div>
          <div class="field"><label>Rate</label>
            <input type="number" step="0.01" min="0" [(ngModel)]="draft.rate" name="rate" />
          </div>
        </div>
        <div class="row two">
          <div class="field"><label>Currency</label>
            <select [(ngModel)]="draft.currency" name="currency">
              <option value="GBP">GBP</option><option value="USD">USD</option><option value="EUR">EUR</option>
            </select>
          </div>
          <div class="field"><label>Start date</label>
            <input type="date" [(ngModel)]="draft.start_date" name="start_date" /></div>
        </div>
        <label>End date</label>
        <input type="date" [(ngModel)]="draft.end_date" name="end_date" />

        <h2 style="margin-top: 20px;">Contact</h2>
        <div class="row two">
          <div class="field"><label>Email</label>
            <input type="email" [(ngModel)]="draft.primary_email" name="email" /></div>
          <div class="field"><label>Phone</label>
            <input [(ngModel)]="draft.primary_phone" name="phone" /></div>
        </div>
        <label>Website</label>
        <input [(ngModel)]="draft.website" name="website" placeholder="https://" />
        <label>Address</label>
        <textarea [(ngModel)]="draft.address" name="address" rows="2"></textarea>

        <h2 style="margin-top: 20px;">Legal &amp; tax</h2>
        <div class="row two">
          <div class="field"><label>UTR / Tax ID</label>
            <input [(ngModel)]="draft.tax_id" name="tax_id" /></div>
          <div class="field"><label>VAT number</label>
            <input [(ngModel)]="draft.vat_number" name="vat_no" /></div>
        </div>
        <div class="row two">
          <div class="field"><label>Company number</label>
            <input [(ngModel)]="draft.company_number" name="company_no" /></div>
          <div class="field"><label>IR35 status</label>
            <select [(ngModel)]="draft.ir35_status" name="ir35">
              @for (i of ir35Options; track i) { <option [value]="i">{{ ir35Label(i) }}</option> }
            </select>
          </div>
        </div>

        <h2 style="margin-top: 20px;">Notes</h2>
        <textarea [(ngModel)]="draft.notes" name="notes" rows="4" placeholder="Quick summary — richer entries can go in the Notes section after save."></textarea>
      </div>
    }
  `,
  styles: [`
    .status-filter { padding: 6px 8px; flex: 0 0 auto; width: auto; min-width: 160px; max-width: 220px; }
    .status-pill {
      display: inline-block; padding: 2px 10px;
      border-radius: 999px; font-size: 11px; text-transform: uppercase;
      letter-spacing: 0.5px; border: 1px solid var(--line); color: var(--muted);
    }
    .status-pill[data-status="active"]   { color: var(--success); border-color: var(--success); }
    .status-pill[data-status="inactive"] { color: var(--muted); }
    .status-pill[data-status="on_break"] { color: var(--primary); border-color: var(--primary); }
    .status-pill[data-status="ended"]    { color: var(--danger);  border-color: var(--danger); }
    .badge {
      display: inline-block; padding: 2px 8px; text-transform: capitalize;
      border-radius: 999px; font-size: 11px;
      background: var(--bg-3); color: var(--muted);
      border: 1px solid var(--line);
    }
    .badge[data-source="internal"]      { color: var(--primary); border-color: var(--primary); }
    .badge[data-ir35="inside"]          { color: var(--danger); border-color: var(--danger); }
    .badge[data-ir35="outside"]         { color: var(--success); border-color: var(--success); }

    .row.two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .field { display: flex; flex-direction: column; gap: 4px; }
    .field label { margin-top: 0; }

    .kv { margin-bottom: 14px; }
    .kv label { display: block; color: var(--muted); font-size: 11px;
      text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 4px 0; }
    .kv > div { color: var(--fg); font-size: 14px; word-break: break-word; }
    .kv .notes { white-space: pre-wrap; }
    .card { padding: 20px; }
    .card + .card { margin-top: 16px; }
    .card h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); margin: 0 0 12px 0; font-weight: 600; }
    .card label { margin-top: 12px; }
    .req { color: var(--primary); margin-left: 2px; }
    .tab-head { display: flex; align-items: center; }
    .tab-head .spacer { flex: 1; }

    .sub-form {
      padding: 16px; background: var(--bg-3); border: 1px solid var(--line);
      border-radius: var(--radius-sm); margin-bottom: 16px;
    }
    .sub-form label { margin-top: 12px; display: block; }
    .note-list { display: flex; flex-direction: column; gap: 10px; }
    .note-card {
      background: var(--bg-3); border: 1px solid var(--line);
      border-radius: var(--radius-sm); padding: 12px 14px;
    }
    .note-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .note-head .spacer { flex: 1; }
    .note-body { margin: 0; white-space: pre-wrap; color: var(--fg); font-size: 14px; line-height: 1.6; }
  `],
})
export class ContractorsAdmin {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  statusOptions: ContractorStatus[] = ['active', 'inactive', 'on_break', 'ended'];
  typeOptions:   ContractorType[]   = ['individual', 'agency', 'freelancer', 'consultant'];
  engOptions:    EngagementType[]   = ['hourly', 'daily', 'project', 'retainer', 'full_time', 'part_time'];
  ir35Options:   Ir35Status[]       = ['inside', 'outside', 'not_applicable', 'unknown'];
  statusLabel = (s: ContractorStatus) => STATUS_LABELS[s] || s;
  typeLabel   = (t: ContractorType)   => TYPE_LABELS[t] || t;
  engLabel    = (e: EngagementType)   => ENG_LABELS[e] || e;
  ir35Label   = (i: Ir35Status)       => IR35_LABELS[i] || i;

  contractors = signal<Contractor[]>([]);
  current = signal<Contractor | null>(null);
  mode = signal<Mode>('list');
  draft: Contractor = blankDraft();
  filterStatus = '';
  filterKind = '';

  saving = signal(false);
  error = signal<string | null>(null);
  subSaving = signal(false);
  subError = signal<string | null>(null);

  notes = signal<ContractorNote[]>([]);
  noteFormOpen = signal(false);
  noteDraft: ContractorNote = blankNote();

  visible = computed(() => {
    let list = this.contractors();
    if (this.filterStatus) list = list.filter(c => (c.status || 'active') === this.filterStatus);
    if (this.filterKind)   list = list.filter(c => c.internal_external === this.filterKind);
    return list;
  });

  rateUnit(et: EngagementType | undefined): string {
    return et === 'daily' ? 'day'
      : et === 'project' ? 'project'
      : et === 'retainer' ? 'month'
      : et === 'full_time' || et === 'part_time' ? 'month'
      : 'hour';
  }

  constructor() {
    this.route.url.subscribe(() => this.routeToMode());
    this.route.params.subscribe(() => this.routeToMode());
    this.loadList();
  }

  private routeToMode() {
    const url = this.router.url;
    if (url.endsWith('/operations/contractors') || url.startsWith('/operations/contractors?')) {
      this.mode.set('list'); this.current.set(null); return;
    }
    if (url.endsWith('/operations/contractors/new')) {
      this.mode.set('edit'); this.draft = blankDraft(); this.error.set(null); return;
    }
    const editMatch = /\/operations\/contractors\/(\d+)\/edit/.exec(url);
    const viewMatch = /\/operations\/contractors\/(\d+)$/.exec(url);
    if (editMatch) this.loadOne(Number(editMatch[1]), 'edit');
    else if (viewMatch) this.loadOne(Number(viewMatch[1]), 'view');
  }
  private loadList() { this.api.listContractors().subscribe(r => this.contractors.set(r.contractors)); }
  private loadOne(id: number, target: Mode) {
    this.api.getContractor(id).subscribe(r => {
      this.current.set(r.contractor);
      if (target === 'edit') this.draft = { ...r.contractor };
      this.mode.set(target);
      if (target === 'view') {
        this.api.listContractorNotes(id).subscribe(n => this.notes.set(n.notes));
      }
    });
  }

  view(c: Contractor, e?: Event) { e?.stopPropagation(); this.router.navigate(['/operations/contractors', c.id]); }
  edit(c: Contractor, e?: Event) { e?.stopPropagation(); this.router.navigate(['/operations/contractors', c.id, 'edit']); }
  back() {
    if (this.draft.id) this.router.navigate(['/operations/contractors', this.draft.id]);
    else this.router.navigate(['/operations/contractors']);
  }
  del(c: Contractor, e: Event) {
    e.stopPropagation();
    if (!confirm(`Delete contractor "${c.name}"?`)) return;
    this.api.deleteContractor(c.id!).subscribe(() => this.loadList());
  }
  delCurrent() {
    const c = this.current(); if (!c) return;
    if (!confirm(`Delete contractor "${c.name}"?`)) return;
    this.api.deleteContractor(c.id!).subscribe(() => this.router.navigate(['/operations/contractors']));
  }

  save() {
    this.error.set(null);
    const name = (this.draft.name || '').trim();
    if (!name) { this.error.set('Name is required.'); return; }
    this.saving.set(true);
    const payload: Contractor = {
      ...this.draft, name,
      discipline:     (this.draft.discipline     || '').trim() || null,
      primary_email:  (this.draft.primary_email  || '').trim() || null,
      primary_phone:  (this.draft.primary_phone  || '').trim() || null,
      website:        (this.draft.website        || '').trim() || null,
      tax_id:         (this.draft.tax_id         || '').trim() || null,
      vat_number:     (this.draft.vat_number     || '').trim() || null,
      company_number: (this.draft.company_number || '').trim() || null,
      start_date:     this.draft.start_date || null,
      end_date:       this.draft.end_date   || null,
      rate:           this.draft.rate === '' || this.draft.rate == null ? null : Number(this.draft.rate),
    };
    const after = (id: number) => { this.saving.set(false); this.router.navigate(['/operations/contractors', id]); };
    if (this.draft.id) {
      this.api.updateContractor(this.draft.id, payload).subscribe({
        next: () => after(this.draft.id!),
        error: e => { this.saving.set(false); this.error.set(e?.error?.error || 'Save failed'); },
      });
    } else {
      this.api.createContractor(payload).subscribe({
        next: r => after(r.id),
        error: e => { this.saving.set(false); this.error.set(e?.error?.error || 'Save failed'); },
      });
    }
  }

  toggleNoteForm() {
    if (this.noteFormOpen()) { this.closeNoteForm(); return; }
    this.noteDraft = blankNote(); this.subError.set(null); this.noteFormOpen.set(true);
  }
  closeNoteForm() { this.noteFormOpen.set(false); this.subError.set(null); }
  editNote(n: ContractorNote) { this.noteDraft = { ...n }; this.subError.set(null); this.noteFormOpen.set(true); }
  saveNote() {
    const id = this.current()?.id; if (!id) return;
    const title = (this.noteDraft.title || '').trim();
    if (!title) { this.subError.set('Title is required.'); return; }
    this.subSaving.set(true);
    const payload: ContractorNote = { ...this.noteDraft, title };
    const after = () => {
      this.subSaving.set(false); this.closeNoteForm();
      this.api.listContractorNotes(id).subscribe(r => this.notes.set(r.notes));
    };
    if (this.noteDraft.id) {
      this.api.updateContractorNote(id, this.noteDraft.id, payload).subscribe({ next: after,
        error: e => { this.subSaving.set(false); this.subError.set(e?.error?.error || 'Save failed'); } });
    } else {
      this.api.createContractorNote(id, payload).subscribe({ next: after,
        error: e => { this.subSaving.set(false); this.subError.set(e?.error?.error || 'Save failed'); } });
    }
  }
  deleteNote(n: ContractorNote) {
    const id = this.current()?.id; if (!id || !n.id) return;
    if (!confirm(`Delete "${n.title}"?`)) return;
    this.api.deleteContractorNote(id, n.id).subscribe(() => {
      this.api.listContractorNotes(id).subscribe(r => this.notes.set(r.notes));
    });
  }

  formatValue(v: number | string): string {
    const n = typeof v === 'string' ? parseFloat(v) : v;
    if (!Number.isFinite(n)) return String(v);
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}
