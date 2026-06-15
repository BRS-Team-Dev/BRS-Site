import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { EntityContracts } from '../../shared/entity-contracts';
import {
  Affiliate, AffiliateStatus, AffiliateTier, AffiliateType,
  CommissionType, AffiliatePayoutMethod, AffiliateNote,
} from '../../core/models';

type Mode = 'list' | 'view' | 'edit';

const STATUS_LABELS: Record<AffiliateStatus, string> = {
  pending: 'Pending', active: 'Active', paused: 'Paused',
  suspended: 'Suspended', terminated: 'Terminated',
};
const TIER_LABELS: Record<AffiliateTier, string> = {
  bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum',
};
const TYPE_LABELS: Record<AffiliateType, string> = {
  individual: 'Individual', company: 'Company',
};
const PAYOUT_LABELS: Record<AffiliatePayoutMethod, string> = {
  bank_transfer: 'Bank transfer', paypal: 'PayPal', stripe: 'Stripe', other: 'Other',
};

const blankDraft = (): Affiliate => ({
  name: '', affiliate_type: 'individual', status: 'pending', tier: 'bronze',
  affiliate_code: '', referral_link: '',
  commission_rate: null, commission_type: 'percentage', currency: 'GBP',
  payout_method: 'bank_transfer', payout_threshold: null, payment_terms: '',
  marketing_channel: '', joined_date: '', end_date: '',
  primary_email: '', primary_phone: '', website: '',
  social_handles: '', notes: '',
});
const blankNote = (): AffiliateNote => ({ title: '', body: '', sort_order: 0 });

const slugify = (s: string): string =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Affiliates admin — Operations system. Tracks commission-based marketing
 * partners. The `affiliate_code` is the unique handle on referral URLs and
 * is what we reconcile conversions against — auto-suggested from the name
 * on new entries.
 *
 *   /operations/affiliates            → list
 *   /operations/affiliates/new        → create
 *   /operations/affiliates/:id        → view
 *   /operations/affiliates/:id/edit   → edit
 */
@Component({
  selector: 'app-affiliates-admin',
  imports: [RouterLink, FormsModule, EntityContracts],
  template: `
    @if (mode() === 'list') {
      <div class="toolbar">
        <h1>Affiliates</h1>
        <span class="spacer"></span>
        <select [(ngModel)]="filterStatus" name="status_filter" class="status-filter">
          <option value="">All statuses</option>
          @for (s of statusOptions; track s) { <option [value]="s">{{ statusLabel(s) }}</option> }
        </select>
        <select [(ngModel)]="filterTier" name="tier_filter" class="status-filter">
          <option value="">All tiers</option>
          @for (t of tierOptions; track t) { <option [value]="t">{{ tierLabel(t) }}</option> }
        </select>
        <button class="primary" routerLink="/operations/affiliates/new">+ New affiliate</button>
      </div>

      @if (visible().length === 0) {
        <div class="empty">
          <p class="muted">No affiliates yet.</p>
          <button class="primary" routerLink="/operations/affiliates/new">Add your first affiliate</button>
        </div>
      } @else {
        <div class="table-wrap">
          <table class="data">
            <thead><tr>
              <th>Name</th><th>Code</th><th>Tier</th><th>Channel</th>
              <th>Commission</th><th>Payout</th><th>Status</th><th></th>
            </tr></thead>
            <tbody>
              @for (a of visible(); track a.id) {
                <tr (click)="view(a)">
                  <td><strong>{{ a.name }}</strong>
                    <div class="muted small">{{ typeLabel(a.affiliate_type || 'individual') }}</div>
                  </td>
                  <td><code>{{ a.affiliate_code }}</code></td>
                  <td><span class="badge" [attr.data-tier]="a.tier">{{ tierLabel(a.tier || 'bronze') }}</span></td>
                  <td>{{ a.marketing_channel || '—' }}</td>
                  <td>
                    @if (a.commission_rate) {
                      @if (a.commission_type === 'percentage') { {{ a.commission_rate }}% }
                      @else { {{ a.currency }} {{ formatValue(a.commission_rate) }} flat }
                    } @else { — }
                  </td>
                  <td>{{ payoutLabel(a.payout_method || 'bank_transfer') }}</td>
                  <td><span class="status-pill" [attr.data-status]="a.status || 'pending'">{{ statusLabel(a.status || 'pending') }}</span></td>
                  <td class="actions">
                    <button class="ghost icon-btn" (click)="view(a, $event)" title="View">👁</button>
                    <button class="ghost icon-btn" (click)="edit(a, $event)" title="Edit">✎</button>
                    <button class="ghost icon-btn danger" (click)="del(a, $event)" title="Delete">✕</button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    }

    @if (mode() === 'view' && current(); as a) {
      <div class="toolbar">
        <button class="ghost" routerLink="/operations/affiliates">← Back</button>
        <h1>{{ a.name }}</h1>
        <span class="spacer"></span>
        <button class="ghost" (click)="edit(a)">✎ Edit</button>
        <button class="danger" (click)="delCurrent()">Delete</button>
      </div>

      <div class="card">
        <h2>Identity</h2>
        <div class="row two">
          <div class="kv"><label>Status</label>
            <div><span class="status-pill" [attr.data-status]="a.status || 'pending'">{{ statusLabel(a.status || 'pending') }}</span></div>
          </div>
          <div class="kv"><label>Tier</label>
            <div><span class="badge" [attr.data-tier]="a.tier">{{ tierLabel(a.tier || 'bronze') }}</span></div>
          </div>
        </div>
        <div class="row two">
          <div class="kv"><label>Type</label><div>{{ typeLabel(a.affiliate_type || 'individual') }}</div></div>
          <div class="kv"><label>Marketing channel</label><div>{{ a.marketing_channel || '—' }}</div></div>
        </div>
        <div class="row two">
          <div class="kv"><label>Affiliate code</label><div><code>{{ a.affiliate_code }}</code></div></div>
          <div class="kv"><label>Referral link</label>
            <div>@if (a.referral_link) { <a [href]="a.referral_link" target="_blank" rel="noopener">{{ a.referral_link }}</a> } @else { — }</div>
          </div>
        </div>
        <div class="row two">
          <div class="kv"><label>Joined</label><div>{{ a.joined_date || '—' }}</div></div>
          <div class="kv"><label>End date</label><div>{{ a.end_date || '—' }}</div></div>
        </div>

        <h2 style="margin-top: 18px;">Commission &amp; payouts</h2>
        <div class="row two">
          <div class="kv"><label>Rate</label>
            <div>
              @if (a.commission_rate) {
                @if (a.commission_type === 'percentage') { {{ a.commission_rate }}% }
                @else { {{ a.currency }} {{ formatValue(a.commission_rate) }} flat }
              } @else { — }
            </div>
          </div>
          <div class="kv"><label>Payout method</label><div>{{ payoutLabel(a.payout_method || 'bank_transfer') }}</div></div>
        </div>
        <div class="row two">
          <div class="kv"><label>Payout threshold</label>
            <div>@if (a.payout_threshold) { {{ a.currency }} {{ formatValue(a.payout_threshold) }} } @else { — }</div>
          </div>
          <div class="kv"><label>Payment terms</label><div>{{ a.payment_terms || '—' }}</div></div>
        </div>

        <h2 style="margin-top: 18px;">Contact</h2>
        <div class="row two">
          <div class="kv"><label>Email</label>
            <div>@if (a.primary_email) { <a [href]="'mailto:' + a.primary_email">{{ a.primary_email }}</a> } @else { — }</div>
          </div>
          <div class="kv"><label>Phone</label><div>{{ a.primary_phone || '—' }}</div></div>
        </div>
        <div class="kv"><label>Website</label>
          <div>@if (a.website) { <a [href]="a.website" target="_blank" rel="noopener">{{ a.website }}</a> } @else { — }</div>
        </div>
        <div class="kv"><label>Social handles</label><div class="notes">{{ a.social_handles || '—' }}</div></div>

        @if (a.notes) {
          <h2 style="margin-top: 18px;">Quick notes</h2>
          <div class="kv"><div class="notes">{{ a.notes }}</div></div>
        }
      </div>

      <div class="card">
        <h2>Contracts</h2>
        <app-entity-contracts audience="affiliate" [entityId]="a.id!"></app-entity-contracts>
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
        <h1>{{ draft.id ? 'Edit affiliate' : 'New affiliate' }}</h1>
        <span class="spacer"></span>
        <button class="primary" (click)="save()" [disabled]="saving()">{{ saving() ? 'Saving…' : (draft.id ? 'Save' : 'Create affiliate') }}</button>
      </div>
      @if (error()) { <div class="error-msg">{{ error() }}</div> }

      <div class="card">
        <h2>Identity</h2>
        <label>Name <span class="req">★</span></label>
        <input [(ngModel)]="draft.name" name="name" (blur)="autofillCode()" />

        <div class="row two">
          <div class="field"><label>Affiliate type</label>
            <select [(ngModel)]="draft.affiliate_type" name="atype">
              @for (t of typeOptions; track t) { <option [value]="t">{{ typeLabel(t) }}</option> }
            </select>
          </div>
          <div class="field"><label>Status</label>
            <select [(ngModel)]="draft.status" name="status">
              @for (s of statusOptions; track s) { <option [value]="s">{{ statusLabel(s) }}</option> }
            </select>
          </div>
        </div>

        <div class="row two">
          <div class="field"><label>Tier</label>
            <select [(ngModel)]="draft.tier" name="tier">
              @for (t of tierOptions; track t) { <option [value]="t">{{ tierLabel(t) }}</option> }
            </select>
          </div>
          <div class="field"><label>Marketing channel</label>
            <input [(ngModel)]="draft.marketing_channel" name="channel" placeholder="Social, Email, Blog, …" /></div>
        </div>

        <label>Affiliate code <span class="req">★</span> <span class="muted small">(unique — used in referral URLs)</span></label>
        <input [(ngModel)]="draft.affiliate_code" name="code" placeholder="auto-generated from name" />
        <label>Referral link <span class="muted small">(full URL with the code embedded)</span></label>
        <input [(ngModel)]="draft.referral_link" name="ref_link" placeholder="https://example.com/?ref=…" />

        <div class="row two">
          <div class="field"><label>Joined date</label>
            <input type="date" [(ngModel)]="draft.joined_date" name="joined" /></div>
          <div class="field"><label>End date</label>
            <input type="date" [(ngModel)]="draft.end_date" name="end" /></div>
        </div>

        <h2 style="margin-top: 20px;">Commission</h2>
        <div class="row two">
          <div class="field"><label>Commission type</label>
            <select [(ngModel)]="draft.commission_type" name="ctype">
              <option value="percentage">Percentage of sale</option>
              <option value="flat">Flat fee per conversion</option>
            </select>
          </div>
          <div class="field"><label>Rate</label>
            <input type="number" step="0.01" min="0" [(ngModel)]="draft.commission_rate" name="rate" />
          </div>
        </div>
        <div class="row two">
          <div class="field"><label>Currency</label>
            <select [(ngModel)]="draft.currency" name="currency">
              <option value="GBP">GBP</option><option value="USD">USD</option><option value="EUR">EUR</option>
            </select>
          </div>
          <div class="field"><label>Payout method</label>
            <select [(ngModel)]="draft.payout_method" name="payout">
              @for (p of payoutOptions; track p) { <option [value]="p">{{ payoutLabel(p) }}</option> }
            </select>
          </div>
        </div>
        <div class="row two">
          <div class="field"><label>Payout threshold</label>
            <input type="number" step="0.01" min="0" [(ngModel)]="draft.payout_threshold" name="threshold" placeholder="Min balance before payout" /></div>
          <div class="field"><label>Payment terms</label>
            <input [(ngModel)]="draft.payment_terms" name="terms" placeholder="Net 30, monthly, …" /></div>
        </div>

        <h2 style="margin-top: 20px;">Contact</h2>
        <div class="row two">
          <div class="field"><label>Email</label>
            <input type="email" [(ngModel)]="draft.primary_email" name="email" /></div>
          <div class="field"><label>Phone</label>
            <input [(ngModel)]="draft.primary_phone" name="phone" /></div>
        </div>
        <label>Website</label>
        <input [(ngModel)]="draft.website" name="website" placeholder="https://" />
        <label>Social handles <span class="muted small">(one per line)</span></label>
        <textarea [(ngModel)]="draft.social_handles" name="social" rows="3" placeholder="@instagram&#10;@twitter&#10;youtube.com/@channel"></textarea>

        <h2 style="margin-top: 20px;">Notes</h2>
        <textarea [(ngModel)]="draft.notes" name="notes" rows="4"></textarea>
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
    .status-pill[data-status="pending"]    { color: var(--muted); }
    .status-pill[data-status="active"]     { color: var(--success); border-color: var(--success); }
    .status-pill[data-status="paused"]     { color: var(--primary); border-color: var(--primary); }
    .status-pill[data-status="suspended"]  { color: var(--danger);  border-color: var(--danger); }
    .status-pill[data-status="terminated"] { color: var(--danger);  border-color: var(--danger); }
    .badge {
      display: inline-block; padding: 2px 10px; text-transform: capitalize;
      border-radius: 999px; font-size: 11px;
      background: var(--bg-3); color: var(--muted);
      border: 1px solid var(--line);
    }
    .badge[data-tier="silver"]   { color: #c0c0c0; border-color: #c0c0c0; }
    .badge[data-tier="gold"]     { color: var(--primary); border-color: var(--primary); }
    .badge[data-tier="platinum"] { color: #e5e4e2; border-color: #e5e4e2; }

    code {
      font-family: "JetBrains Mono", monospace;
      background: var(--bg-3); padding: 1px 6px;
      border-radius: 4px; font-size: 12px;
    }
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
export class AffiliatesAdmin {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  statusOptions: AffiliateStatus[]        = ['pending', 'active', 'paused', 'suspended', 'terminated'];
  tierOptions:   AffiliateTier[]          = ['bronze', 'silver', 'gold', 'platinum'];
  typeOptions:   AffiliateType[]          = ['individual', 'company'];
  payoutOptions: AffiliatePayoutMethod[]  = ['bank_transfer', 'paypal', 'stripe', 'other'];
  statusLabel = (s: AffiliateStatus)        => STATUS_LABELS[s] || s;
  tierLabel   = (t: AffiliateTier)          => TIER_LABELS[t] || t;
  typeLabel   = (t: AffiliateType)          => TYPE_LABELS[t] || t;
  payoutLabel = (p: AffiliatePayoutMethod)  => PAYOUT_LABELS[p] || p;

  affiliates = signal<Affiliate[]>([]);
  current = signal<Affiliate | null>(null);
  mode = signal<Mode>('list');
  draft: Affiliate = blankDraft();
  filterStatus = '';
  filterTier = '';

  saving = signal(false);
  error = signal<string | null>(null);
  subSaving = signal(false);
  subError = signal<string | null>(null);

  notes = signal<AffiliateNote[]>([]);
  noteFormOpen = signal(false);
  noteDraft: AffiliateNote = blankNote();

  visible = computed(() => {
    let list = this.affiliates();
    if (this.filterStatus) list = list.filter(a => (a.status || 'pending') === this.filterStatus);
    if (this.filterTier)   list = list.filter(a => (a.tier   || 'bronze')  === this.filterTier);
    return list;
  });

  constructor() {
    this.route.url.subscribe(() => this.routeToMode());
    this.route.params.subscribe(() => this.routeToMode());
    this.loadList();
  }

  private routeToMode() {
    const url = this.router.url;
    if (url.endsWith('/operations/affiliates') || url.startsWith('/operations/affiliates?')) {
      this.mode.set('list'); this.current.set(null); return;
    }
    if (url.endsWith('/operations/affiliates/new')) {
      this.mode.set('edit'); this.draft = blankDraft(); this.error.set(null); return;
    }
    const editMatch = /\/operations\/affiliates\/(\d+)\/edit/.exec(url);
    const viewMatch = /\/operations\/affiliates\/(\d+)$/.exec(url);
    if (editMatch) this.loadOne(Number(editMatch[1]), 'edit');
    else if (viewMatch) this.loadOne(Number(viewMatch[1]), 'view');
  }
  private loadList() { this.api.listAffiliates().subscribe(r => this.affiliates.set(r.affiliates)); }
  private loadOne(id: number, target: Mode) {
    this.api.getAffiliate(id).subscribe(r => {
      this.current.set(r.affiliate);
      if (target === 'edit') this.draft = { ...r.affiliate };
      this.mode.set(target);
      if (target === 'view') {
        this.api.listAffiliateNotes(id).subscribe(n => this.notes.set(n.notes));
      }
    });
  }

  view(a: Affiliate, e?: Event) { e?.stopPropagation(); this.router.navigate(['/operations/affiliates', a.id]); }
  edit(a: Affiliate, e?: Event) { e?.stopPropagation(); this.router.navigate(['/operations/affiliates', a.id, 'edit']); }
  back() {
    if (this.draft.id) this.router.navigate(['/operations/affiliates', this.draft.id]);
    else this.router.navigate(['/operations/affiliates']);
  }
  del(a: Affiliate, e: Event) {
    e.stopPropagation();
    if (!confirm(`Delete affiliate "${a.name}"?`)) return;
    this.api.deleteAffiliate(a.id!).subscribe(() => this.loadList());
  }
  delCurrent() {
    const a = this.current(); if (!a) return;
    if (!confirm(`Delete affiliate "${a.name}"?`)) return;
    this.api.deleteAffiliate(a.id!).subscribe(() => this.router.navigate(['/operations/affiliates']));
  }

  /** Auto-suggest an affiliate code from the name if the user hasn't filled it yet. */
  autofillCode() {
    if (!this.draft.affiliate_code && this.draft.name) {
      this.draft.affiliate_code = slugify(this.draft.name);
    }
  }

  save() {
    this.error.set(null);
    const name = (this.draft.name || '').trim();
    if (!name) { this.error.set('Name is required.'); return; }
    const code = (this.draft.affiliate_code || '').trim();
    if (!code) { this.error.set('Affiliate code is required.'); return; }
    this.saving.set(true);
    const payload: Affiliate = {
      ...this.draft, name, affiliate_code: code,
      referral_link:     (this.draft.referral_link     || '').trim() || null,
      payment_terms:     (this.draft.payment_terms     || '').trim() || null,
      marketing_channel: (this.draft.marketing_channel || '').trim() || null,
      primary_email:     (this.draft.primary_email     || '').trim() || null,
      primary_phone:     (this.draft.primary_phone     || '').trim() || null,
      website:           (this.draft.website           || '').trim() || null,
      joined_date:       this.draft.joined_date || null,
      end_date:          this.draft.end_date    || null,
      commission_rate:   this.draft.commission_rate === '' || this.draft.commission_rate == null ? null : Number(this.draft.commission_rate),
      payout_threshold:  this.draft.payout_threshold === '' || this.draft.payout_threshold == null ? null : Number(this.draft.payout_threshold),
    };
    const after = (id: number) => { this.saving.set(false); this.router.navigate(['/operations/affiliates', id]); };
    if (this.draft.id) {
      this.api.updateAffiliate(this.draft.id, payload).subscribe({
        next: () => after(this.draft.id!),
        error: e => { this.saving.set(false); this.error.set(e?.error?.error || 'Save failed'); },
      });
    } else {
      this.api.createAffiliate(payload).subscribe({
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
  editNote(n: AffiliateNote) { this.noteDraft = { ...n }; this.subError.set(null); this.noteFormOpen.set(true); }
  saveNote() {
    const id = this.current()?.id; if (!id) return;
    const title = (this.noteDraft.title || '').trim();
    if (!title) { this.subError.set('Title is required.'); return; }
    this.subSaving.set(true);
    const payload: AffiliateNote = { ...this.noteDraft, title };
    const after = () => {
      this.subSaving.set(false); this.closeNoteForm();
      this.api.listAffiliateNotes(id).subscribe(r => this.notes.set(r.notes));
    };
    if (this.noteDraft.id) {
      this.api.updateAffiliateNote(id, this.noteDraft.id, payload).subscribe({ next: after,
        error: e => { this.subSaving.set(false); this.subError.set(e?.error?.error || 'Save failed'); } });
    } else {
      this.api.createAffiliateNote(id, payload).subscribe({ next: after,
        error: e => { this.subSaving.set(false); this.subError.set(e?.error?.error || 'Save failed'); } });
    }
  }
  deleteNote(n: AffiliateNote) {
    const id = this.current()?.id; if (!id || !n.id) return;
    if (!confirm(`Delete "${n.title}"?`)) return;
    this.api.deleteAffiliateNote(id, n.id).subscribe(() => {
      this.api.listAffiliateNotes(id).subscribe(r => this.notes.set(r.notes));
    });
  }

  formatValue(v: number | string): string {
    const n = typeof v === 'string' ? parseFloat(v) : v;
    if (!Number.isFinite(n)) return String(v);
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}
