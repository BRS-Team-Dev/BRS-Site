import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { Lead, LeadInfo, LeadNote, LeadStatus } from '../../core/models';

type Mode = 'list' | 'view' | 'edit';
type LeadTabKey = 'info' | 'notes';

const STATUS_LABELS: Record<LeadStatus, string> = {
  new:       'New',
  contacted: 'Contacted',
  qualified: 'Qualified',
  converted: 'Converted',
  rejected:  'Rejected',
};

/**
 * Leads section — potential clients before promotion.
 *   /admin/leads           → list
 *   /admin/leads/new       → create
 *   /admin/leads/:id       → view (read-only)
 *   /admin/leads/:id/edit  → edit
 *
 * Fields mirror Client (name/email/phone/company/notes) so promotion copies
 * 1:1 to a `clients` row. Adds a status workflow + optional source.
 */
@Component({
  selector: 'app-leads-admin',
  imports: [RouterLink, FormsModule],
  template: `
    @if (mode() === 'list') {
      <div class="toolbar">
        <h1>Leads</h1>
        <span class="spacer"></span>
        <select [(ngModel)]="filterStatus" name="status_filter" class="status-filter">
          <option value="">All statuses</option>
          @for (s of statusOptions; track s) {
            <option [value]="s">{{ statusLabel(s) }}</option>
          }
        </select>
        <button class="primary" routerLink="/admin/leads/new">+ New lead</button>
      </div>

      @if (visible().length === 0) {
        <div class="empty">
          <p class="muted">No leads yet.</p>
          <button class="primary" routerLink="/admin/leads/new">Add your first lead</button>
        </div>
      } @else {
        <div class="table-wrap">
          <table class="data">
            <thead><tr>
              <th>Name</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Company</th>
              <th>Status</th>
              <th></th>
            </tr></thead>
            <tbody>
              @for (l of visible(); track l.id) {
                <tr (click)="view(l)">
                  <td><strong>{{ l.name }}</strong></td>
                  <td>{{ l.email || '—' }}</td>
                  <td>{{ l.phone || '—' }}</td>
                  <td>{{ l.company || '—' }}</td>
                  <td>
                    <span class="status-pill" [attr.data-status]="l.status || 'new'">
                      {{ statusLabel(l.status || 'new') }}
                    </span>
                  </td>
                  <td class="actions">
                    <button class="ghost icon-btn" (click)="view(l, $event)" title="View" aria-label="View">👁</button>
                    <button class="ghost icon-btn" (click)="edit(l, $event)" title="Edit" aria-label="Edit">✎</button>
                    <button class="ghost icon-btn danger" (click)="del(l, $event)" title="Delete" aria-label="Delete">✕</button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    }

    @if (mode() === 'view') {
      <div class="toolbar">
        <button class="ghost" (click)="back()">← Back</button>
        <h1>{{ current()?.name || 'Lead' }}</h1>
        <span class="spacer"></span>
        @if (current()?.promoted_client_id) {
          <button class="ghost" (click)="goPromotedClient()" title="Open promoted client">
            ↗ View client
          </button>
        } @else {
          <button class="primary" (click)="promote()" [disabled]="promoting()">
            {{ promoting() ? 'Promoting…' : '✓ Promote to client' }}
          </button>
        }
        <button class="ghost" (click)="goEdit()" title="Edit">✎ Edit</button>
        <button class="danger" (click)="delCurrent()">Delete</button>
      </div>

      @if (promoteError()) {
        <div class="layout"><div class="error-msg">{{ promoteError() }}</div></div>
      }

      @if (current(); as l) {
        <div class="layout-2col">
          <section class="card">
            <div class="card-head">
              <h2>Lead</h2>
              <span class="status-pill" [attr.data-status]="l.status || 'new'">
                {{ statusLabel(l.status || 'new') }}
              </span>
            </div>
            <div class="kv"><label>Name</label><div>{{ l.name }}</div></div>
            <div class="kv"><label>Email</label><div>{{ l.email || '—' }}</div></div>
            <div class="kv"><label>Phone</label><div>{{ l.phone || '—' }}</div></div>
            <div class="kv"><label>Address</label><div class="notes">{{ l.address || '—' }}</div></div>
            <div class="kv"><label>Company</label><div>{{ l.company || '—' }}</div></div>
            <div class="kv">
              <label>Website</label>
              <div>
                @if (l.url) {
                  <a [href]="l.url" target="_blank" rel="noopener">{{ l.url }}</a>
                } @else { — }
              </div>
            </div>
            <div class="kv"><label>Source</label><div>{{ l.source || '—' }}</div></div>
            <div class="kv"><label>Notes</label><div class="notes">{{ l.notes || '—' }}</div></div>
            @if (l.promoted_client_id) {
              <div class="kv">
                <label>Promoted</label>
                <div class="muted">{{ l.promoted_at || '—' }} → client #{{ l.promoted_client_id }}</div>
              </div>
            }
            @if (l.created_at) { <div class="kv"><label>Created</label><div>{{ l.created_at }}</div></div> }
            @if (l.updated_at) { <div class="kv"><label>Last updated</label><div>{{ l.updated_at }}</div></div> }
          </section>

          <section class="card detail-card">
            <div class="tab-nav">
              @for (t of tabs; track t.key) {
                <button
                  class="tab-btn"
                  [class.active]="activeTab() === t.key"
                  (click)="activeTab.set(t.key)">
                  {{ t.label }}
                </button>
              }
            </div>

            <div class="tab-content">
              @switch (activeTab()) {
                @case ('info') {
                  <div class="tab-head">
                    <h3>Information</h3>
                    <span class="spacer"></span>
                    <button class="primary" (click)="toggleInfoForm()">
                      {{ infoFormOpen() ? '× Cancel' : '+ Add info' }}
                    </button>
                  </div>

                  @if (infoFormOpen()) {
                    <div class="info-form">
                      <label>Name <span class="req">★</span></label>
                      <input [(ngModel)]="infoDraft.name" name="if_name" placeholder="e.g. Industry" />

                      <label>Value</label>
                      <textarea [(ngModel)]="infoDraft.value" name="if_value" rows="3" placeholder="e.g. SaaS / Fintech"></textarea>

                      @if (infoError()) { <div class="error-msg">{{ infoError() }}</div> }
                      <div class="row" style="margin-top: 16px; gap: 8px;">
                        <button class="primary" (click)="saveInfo()" [disabled]="infoSaving()">
                          {{ infoSaving() ? 'Saving…' : (infoDraft.id ? 'Update' : 'Save info') }}
                        </button>
                        <button class="ghost" (click)="closeInfoForm()">Done</button>
                      </div>
                    </div>
                  }

                  @if (infoEntries().length === 0 && !infoFormOpen()) {
                    <p class="muted">No additional info yet.</p>
                  } @else if (infoEntries().length > 0) {
                    <div class="info-list">
                      @for (i of infoEntries(); track i.id) {
                        <div class="kv info-row">
                          <label>{{ i.name }}</label>
                          <div>{{ i.value || '—' }}</div>
                          <div class="info-actions">
                            <button class="ghost icon-btn" (click)="editInfo(i)" title="Edit">✎</button>
                            <button class="ghost icon-btn danger" (click)="deleteInfo(i)" title="Delete">✕</button>
                          </div>
                        </div>
                      }
                    </div>
                  }
                }
                @case ('notes') {
                  <div class="tab-head">
                    <h3>Notes</h3>
                    <span class="spacer"></span>
                    <button class="primary" (click)="toggleNoteForm()">
                      {{ noteFormOpen() ? '× Cancel' : '+ Add note' }}
                    </button>
                  </div>

                  @if (noteFormOpen()) {
                    <div class="note-form">
                      <label>Title <span class="req">★</span></label>
                      <input [(ngModel)]="noteDraft.title" name="nd_title" placeholder="What's this note about?" />

                      <label>Body</label>
                      <textarea [(ngModel)]="noteDraft.body" name="nd_body" rows="6" placeholder="Type the note here…"></textarea>

                      @if (noteError()) { <div class="error-msg">{{ noteError() }}</div> }
                      <div class="row" style="margin-top: 16px; gap: 8px;">
                        <button class="primary" (click)="saveNote()" [disabled]="noteSaving()">
                          {{ noteSaving() ? 'Saving…' : (noteDraft.id ? 'Update' : 'Save note') }}
                        </button>
                        <button class="ghost" (click)="closeNoteForm()">Done</button>
                      </div>
                    </div>
                  }

                  @if (notes().length === 0) {
                    <p class="muted">No notes yet.</p>
                  } @else {
                    <div class="note-list">
                      @for (n of notes(); track n.id) {
                        <div class="note-card" [class.expanded]="expandedNote() === n.id">
                          <div class="note-head" (click)="toggleNote(n)">
                            <span class="caret">›</span>
                            <div class="note-name">
                              <strong>{{ n.title }}</strong>
                              @if (n.updated_at) { <span class="position">{{ n.updated_at }}</span> }
                            </div>
                            <span class="spacer"></span>
                            <button class="ghost icon-btn" (click)="editNote(n); $event.stopPropagation()" title="Edit">✎</button>
                            <button class="ghost icon-btn danger" (click)="deleteNote(n); $event.stopPropagation()" title="Delete">✕</button>
                          </div>
                          @if (expandedNote() === n.id) {
                            <div class="note-body-wrap">
                              @if (n.body) {
                                <p class="note-body">{{ n.body }}</p>
                              } @else {
                                <p class="muted small">No body.</p>
                              }
                            </div>
                          }
                        </div>
                      }
                    </div>
                  }
                }
              }
            </div>
          </section>
        </div>
      }
    }

    @if (mode() === 'edit') {
      <div class="toolbar">
        <button class="ghost" (click)="back()">← Back</button>
        <h1>{{ isNew() ? 'New lead' : (draft.name || 'Edit lead') }}</h1>
        <span class="spacer"></span>
        <button class="primary" (click)="save()" [disabled]="saving()">
          {{ saving() ? 'Saving…' : (isNew() ? 'Create lead' : 'Save changes') }}
        </button>
      </div>

      <div class="layout">
        @if (error()) { <div class="error-msg">{{ error() }}</div> }

        @if (formReady()) {
          <section class="card">
            <h2>Details</h2>

            <div class="row two-col">
              <div>
                <label>Name <span class="req">★</span></label>
                <input [(ngModel)]="draft.name" name="ld_name" placeholder="John Doe" />
              </div>
              <div>
                <label>Status</label>
                <select [(ngModel)]="draft.status" name="ld_status">
                  @for (s of statusOptions; track s) {
                    <option [value]="s">{{ statusLabel(s) }}</option>
                  }
                </select>
              </div>
            </div>

            <div class="row two-col">
              <div>
                <label>Email</label>
                <input type="email" [(ngModel)]="draft.email" name="ld_email" placeholder="john@example.com" />
              </div>
              <div>
                <label>Phone</label>
                <input [(ngModel)]="draft.phone" name="ld_phone" placeholder="+44 7123 456789" />
              </div>
            </div>

            <label>Address</label>
            <textarea [(ngModel)]="draft.address" name="ld_address" rows="3" placeholder="Street, city, postcode"></textarea>

            <div class="row two-col">
              <div>
                <label>Company</label>
                <input [(ngModel)]="draft.company" name="ld_company" placeholder="Acme Ltd" />
              </div>
              <div>
                <label>Website</label>
                <input type="url" [(ngModel)]="draft.url" name="ld_url" placeholder="https://example.com" />
              </div>
            </div>

            <label>Source</label>
            <input [(ngModel)]="draft.source" name="ld_source" placeholder="referral, website, event…" />

            <label>Notes</label>
            <textarea [(ngModel)]="draft.notes" name="ld_notes" rows="6" placeholder="Anything worth knowing about this lead."></textarea>
          </section>
        }
      </div>
    }
  `,
  styles: [`
    /* Toolbar select needs a capped width — global rule sets selects to
       width:100% which would otherwise blow up the toolbar. */
    .status-filter { width: auto; min-width: 160px; }

    .actions { display: flex; gap: 4px; justify-content: flex-end; }

    /* Card title style — matches the project convention used in clients-admin
       (small uppercase muted). */
    .card h2 {
      font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;
      color: var(--muted); margin: 0 0 12px 0; font-weight: 600;
    }
    .card-head { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
    .card-head h2 { margin: 0; flex: 1; }

    /* Vertical kv: label stacked above value — global label rule supplies
       the muted-uppercase styling; we just space rows here. */
    .kv { margin-bottom: 14px; }
    .kv > div { word-break: break-word; }
    .kv .notes { white-space: pre-wrap; }

    .row.two-col {
      display: grid; grid-template-columns: 1fr 1fr;
      gap: 12px; margin-bottom: 14px;
    }
    .req { color: var(--primary); margin-left: 2px; }

    .status-pill {
      display: inline-block;
      padding: 3px 10px; border-radius: 999px;
      font-size: 11px; font-weight: 600; letter-spacing: 0.4px;
      text-transform: uppercase;
      border: 1px solid var(--line);
      background: var(--bg-3); color: var(--muted);
    }
    .status-pill[data-status="new"]       { color: var(--primary); border-color: var(--primary); }
    .status-pill[data-status="contacted"] { color: #60a5fa; border-color: #60a5fa; }
    .status-pill[data-status="qualified"] { color: var(--primary); border-color: var(--primary); background: rgba(212, 169, 58, 0.1); }
    .status-pill[data-status="converted"] { color: var(--success); border-color: var(--success); background: rgba(86, 201, 138, 0.1); }
    .status-pill[data-status="rejected"]  { color: var(--danger); border-color: var(--danger); }

    /* ----- Tabbed detail card (mirrors clients-admin) ------------------ */
    .detail-card { padding: 0; overflow: hidden; }
    .tab-nav {
      display: flex; gap: 2px;
      border-bottom: 1px solid var(--line);
      padding: 0 12px;
      overflow-x: auto;
    }
    .tab-btn {
      padding: 14px 16px;
      background: transparent; border: none;
      color: var(--muted); cursor: pointer;
      font-size: 13px; white-space: nowrap;
      position: relative;
      transition: color 0.15s;
    }
    .tab-btn:hover { color: var(--fg); background: transparent; border-color: transparent; }
    .tab-btn.active { color: var(--primary); }
    .tab-btn.active::after {
      content: ''; position: absolute; bottom: -1px; left: 0; right: 0; height: 2px;
      background: var(--primary);
    }
    .tab-content { padding: 24px; }
    .tab-content h3 {
      margin: 0 0 12px 0; font-size: 14px;
      text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); font-weight: 600;
    }
    .tab-head { display: flex; align-items: center; margin-bottom: 16px; }
    .tab-head h3 { margin: 0; }

    /* ----- Info tab ---------------------------------------------------- */
    .info-form {
      padding: 16px;
      background: var(--bg-3);
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      margin-bottom: 16px;
    }
    .info-form label { margin-top: 12px; display: block; }

    /* Info rows reuse the global .kv label-above-value pattern; we only
       add the trailing edit/delete actions that appear on hover. */
    .info-row { position: relative; }
    .info-row .info-actions {
      position: absolute; top: 0; right: 0;
      display: flex; gap: 2px;
      opacity: 0; transition: opacity 0.15s;
    }
    .info-row:hover .info-actions { opacity: 1; }

    /* ----- Notes tab --------------------------------------------------- */
    .note-form {
      padding: 16px;
      background: var(--bg-3);
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      margin-bottom: 16px;
    }
    .note-form label { margin-top: 12px; display: block; }

    .note-list { display: flex; flex-direction: column; gap: 12px; }
    .note-card {
      background: var(--bg-3);
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      overflow: hidden;
      transition: border-color 0.15s;
    }
    .note-card:hover { border-color: var(--primary); }
    .note-head {
      display: flex; align-items: center; gap: 8px;
      padding: 12px 14px;
      cursor: pointer;
      user-select: none;
    }
    .note-head .caret {
      color: var(--muted);
      transition: transform 0.2s;
      flex-shrink: 0;
    }
    .note-card.expanded .note-head .caret { transform: rotate(90deg); }
    .note-name { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .note-name strong { font-size: 14px; line-height: 1.2; }
    .note-name .position {
      color: var(--primary);
      font-size: 12px;
      font-style: italic;
      letter-spacing: 0.2px;
      line-height: 1.2;
    }
    .note-body-wrap {
      padding: 0 14px 14px 14px;
      border-top: 1px solid var(--line);
      padding-top: 12px;
    }
    .note-body {
      white-space: pre-wrap;
      color: var(--fg);
      margin: 0;
      line-height: 1.6;
    }
  `],
})
export class LeadsAdmin {
  private api = inject(Api);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  readonly statusOptions: LeadStatus[] = ['new', 'contacted', 'qualified', 'converted', 'rejected'];
  statusLabel(s: LeadStatus): string { return STATUS_LABELS[s] ?? s; }

  mode = signal<Mode>('list');
  isNew = signal(false);
  saving = signal(false);
  error = signal<string | null>(null);
  promoting = signal(false);
  promoteError = signal<string | null>(null);

  leads = signal<Lead[]>([]);
  current = signal<Lead | null>(null);
  filterStatus = '';
  formReady = signal(false);
  draft: Lead = this.blankDraft();

  // Tabs on the right-side detail card.
  readonly tabs: { key: LeadTabKey; label: string }[] = [
    { key: 'info',  label: 'Info' },
    { key: 'notes', label: 'Notes' },
  ];
  activeTab = signal<LeadTabKey>('info');

  // Notes tab state — mirrors clients-admin.
  notes = signal<LeadNote[]>([]);
  noteFormOpen = signal(false);
  noteSaving = signal(false);
  noteError = signal<string | null>(null);
  noteDraft: LeadNote = { title: '', body: '' };
  expandedNote = signal<number | null>(null);

  // Info tab state — name/value pairs displayed as kv list.
  infoEntries = signal<LeadInfo[]>([]);
  infoFormOpen = signal(false);
  infoSaving = signal(false);
  infoError = signal<string | null>(null);
  infoDraft: LeadInfo = { name: '', value: '' };

  visible = computed(() => {
    const list = this.leads();
    if (!this.filterStatus) return list;
    return list.filter(l => (l.status || 'new') === this.filterStatus);
  });

  constructor() {
    // `route.url` is backed by a ReplaySubject(1) — it emits the current URL
    // to new subscribers immediately, so a separate `detectMode()` call here
    // would fire `listLeads`/`getLead` twice on first paint.
    this.route.url.subscribe(() => this.detectMode());
  }

  private blankDraft(): Lead {
    return { name: '', email: '', phone: '', address: '', company: '', url: '', notes: '', status: 'new', source: '' };
  }

  private detectMode() {
    const url = this.router.url.split('?')[0].split('#')[0];

    if (/\/admin\/leads\/new(\/|$)/.test(url)) {
      this.isNew.set(true);
      this.draft = this.blankDraft();
      this.error.set(null);
      this.mode.set('edit');
      this.formReady.set(true);
      return;
    }

    const editMatch = url.match(/\/admin\/leads\/(\d+)\/edit$/);
    if (editMatch) {
      this.isNew.set(false);
      this.formReady.set(false);
      this.loadOne(parseInt(editMatch[1], 10), 'edit');
      return;
    }

    const viewMatch = url.match(/\/admin\/leads\/(\d+)$/);
    if (viewMatch) {
      this.formReady.set(false);
      this.loadOne(parseInt(viewMatch[1], 10), 'view');
      return;
    }

    this.mode.set('list');
    this.loadList();
  }

  private loadList() {
    this.api.listLeads().subscribe({
      next: r => this.leads.set(r.leads),
      error: e => this.error.set(e?.error?.error || 'Failed to load leads'),
    });
  }

  private loadOne(id: number, m: Mode) {
    this.api.getLead(id).subscribe({
      next: r => {
        this.current.set(r.lead);
        this.draft = { ...this.blankDraft(), ...r.lead };
        this.mode.set(m);
        this.formReady.set(true);
        if (m === 'view') {
          this.activeTab.set('info');
          this.closeNoteForm();
          this.closeInfoForm();
          this.loadNotes(id);
          this.loadInfoEntries(id);
        }
      },
      error: () => {
        this.error.set('Lead not found');
        this.router.navigate(['/admin/leads']);
      },
    });
  }

  view(l: Lead, ev?: Event) {
    if (ev) ev.stopPropagation();
    this.router.navigate(['/admin/leads', l.id]);
  }

  edit(l: Lead, ev?: Event) {
    ev?.stopPropagation();
    this.router.navigate(['/admin/leads', l.id, 'edit']);
  }

  goEdit() {
    const c = this.current();
    if (c?.id) this.router.navigate(['/admin/leads', c.id, 'edit']);
  }

  back() { this.router.navigate(['/admin/leads']); }

  save() {
    const name = (this.draft.name || '').trim();
    if (!name) { this.error.set('Name is required'); return; }
    const email = (this.draft.email || '').trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.error.set('Invalid email');
      return;
    }

    this.error.set(null);
    this.saving.set(true);

    const payload: Lead = {
      name,
      email: email || null,
      phone: (this.draft.phone || '').trim() || null,
      address: this.draft.address ?? null,
      company: (this.draft.company || '').trim() || null,
      url: (this.draft.url || '').trim() || null,
      notes: this.draft.notes ?? null,
      status: this.draft.status || 'new',
      source: (this.draft.source || '').trim() || null,
    };

    const onError = (e: any) => {
      this.saving.set(false);
      this.error.set(e?.error?.error || 'Failed to save lead');
    };

    if (this.isNew()) {
      this.api.createLead(payload).subscribe({
        next: r => {
          this.saving.set(false);
          this.router.navigate(['/admin/leads', r.id]);
        },
        error: onError,
      });
    } else {
      const id = this.current()!.id!;
      this.api.updateLead(id, payload).subscribe({
        next: () => {
          this.saving.set(false);
          this.router.navigate(['/admin/leads', id]);
        },
        error: onError,
      });
    }
  }

  del(l: Lead, ev?: Event) {
    ev?.stopPropagation();
    if (!l.id) return;
    if (!confirm(`Delete lead "${l.name}"? This cannot be undone.`)) return;
    this.api.deleteLead(l.id).subscribe({
      next: () => this.loadList(),
      error: e => alert(e?.error?.error || 'Failed to delete'),
    });
  }

  delCurrent() {
    const c = this.current();
    if (!c?.id) return;
    if (!confirm(`Delete lead "${c.name}"? This cannot be undone.`)) return;
    this.api.deleteLead(c.id).subscribe({
      next: () => this.router.navigate(['/admin/leads']),
      error: e => alert(e?.error?.error || 'Failed to delete'),
    });
  }

  promote() {
    const c = this.current();
    if (!c?.id) return;
    if (!confirm(`Promote "${c.name}" to a client? Their fields will be copied into the Clients section.`)) return;

    this.promoteError.set(null);
    this.promoting.set(true);
    this.api.promoteLead(c.id).subscribe({
      next: r => {
        this.promoting.set(false);
        this.router.navigate(['/admin/clients', r.client_id]);
      },
      error: e => {
        this.promoting.set(false);
        this.promoteError.set(e?.error?.error || 'Failed to promote lead');
      },
    });
  }

  goPromotedClient() {
    const c = this.current();
    if (c?.promoted_client_id) {
      this.router.navigate(['/admin/clients', c.promoted_client_id]);
    }
  }

  // ----- Notes -----
  private loadNotes(leadId: number) {
    this.api.listLeadNotes(leadId).subscribe({
      next: r => this.notes.set(r.notes),
      error: () => this.notes.set([]),
    });
  }

  toggleNote(n: LeadNote) {
    if (!n.id) return;
    this.expandedNote.set(this.expandedNote() === n.id ? null : n.id);
  }

  toggleNoteForm() {
    if (this.noteFormOpen()) this.closeNoteForm();
    else this.openNoteForm();
  }
  openNoteForm() {
    this.noteDraft = { title: '', body: '' };
    this.noteError.set(null);
    this.noteFormOpen.set(true);
  }
  closeNoteForm() {
    this.noteFormOpen.set(false);
    this.noteError.set(null);
  }
  editNote(n: LeadNote) {
    this.noteDraft = { ...n };
    this.noteError.set(null);
    this.noteFormOpen.set(true);
  }
  saveNote() {
    const leadId = this.current()?.id;
    if (!leadId) return;
    if (!this.noteDraft.title?.trim()) { this.noteError.set('Title is required'); return; }
    this.noteSaving.set(true);
    this.noteError.set(null);
    const done = () => {
      this.noteSaving.set(false);
      this.closeNoteForm();
      this.loadNotes(leadId);
    };
    const fail = (e: any) => {
      this.noteSaving.set(false);
      this.noteError.set(e?.error?.error || 'Failed to save note');
    };
    if (this.noteDraft.id) {
      this.api.updateLeadNote(leadId, this.noteDraft.id, this.noteDraft).subscribe({ next: done, error: fail });
    } else {
      this.api.createLeadNote(leadId, this.noteDraft).subscribe({ next: done, error: fail });
    }
  }
  deleteNote(n: LeadNote) {
    const leadId = this.current()?.id;
    if (!leadId || !n.id) return;
    if (!confirm(`Delete note "${n.title}"?`)) return;
    this.api.deleteLeadNote(leadId, n.id).subscribe(() => this.loadNotes(leadId));
  }

  // ----- Info entries -----
  private loadInfoEntries(leadId: number) {
    this.api.listLeadInfo(leadId).subscribe({
      next: r => this.infoEntries.set(r.info),
      error: () => this.infoEntries.set([]),
    });
  }

  toggleInfoForm() {
    if (this.infoFormOpen()) this.closeInfoForm();
    else this.openInfoForm();
  }
  openInfoForm() {
    this.infoDraft = { name: '', value: '' };
    this.infoError.set(null);
    this.infoFormOpen.set(true);
  }
  closeInfoForm() {
    this.infoFormOpen.set(false);
    this.infoError.set(null);
  }
  editInfo(i: LeadInfo) {
    this.infoDraft = { ...i };
    this.infoError.set(null);
    this.infoFormOpen.set(true);
  }
  saveInfo() {
    const leadId = this.current()?.id;
    if (!leadId) return;
    if (!this.infoDraft.name?.trim()) { this.infoError.set('Name is required'); return; }
    this.infoSaving.set(true);
    this.infoError.set(null);
    const done = () => {
      this.infoSaving.set(false);
      this.closeInfoForm();
      this.loadInfoEntries(leadId);
    };
    const fail = (e: any) => {
      this.infoSaving.set(false);
      this.infoError.set(e?.error?.error || 'Failed to save info');
    };
    if (this.infoDraft.id) {
      this.api.updateLeadInfo(leadId, this.infoDraft.id, this.infoDraft).subscribe({ next: done, error: fail });
    } else {
      this.api.createLeadInfo(leadId, this.infoDraft).subscribe({ next: done, error: fail });
    }
  }
  deleteInfo(i: LeadInfo) {
    const leadId = this.current()?.id;
    if (!leadId || !i.id) return;
    if (!confirm(`Delete "${i.name}"?`)) return;
    this.api.deleteLeadInfo(leadId, i.id).subscribe(() => this.loadInfoEntries(leadId));
  }
}
