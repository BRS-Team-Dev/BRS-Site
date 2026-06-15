import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { EntityContracts } from '../../shared/entity-contracts';
import {
  Partner, PartnerStatus, PartnerType, PartnerTier,
  PartnerContact, PartnerNote, PartnerAccount,
} from '../../core/models';

type Mode = 'list' | 'view' | 'edit';
type ViewTab = 'overview' | 'contract' | 'contacts' | 'accounts' | 'notes';
type EditTab = 'identity' | 'contract' | 'contact' | 'legal' | 'scope';

const STATUS_LABELS: Record<PartnerStatus, string> = {
  prospective: 'Prospective', active: 'Active', paused: 'Paused', terminated: 'Terminated',
};
const TYPE_LABELS: Record<PartnerType, string> = {
  strategic: 'Strategic', reseller: 'Reseller', technology: 'Technology',
  channel: 'Channel', referral: 'Referral', other: 'Other',
};
const TIER_LABELS: Record<PartnerTier, string> = {
  preferred: 'Preferred', standard: 'Standard', prospective: 'Prospective',
};

const blankDraft = (): Partner => ({
  legal_name: '', trading_name: '', partnership_type: 'strategic', tier: 'standard',
  status: 'prospective', start_date: '', renewal_date: '', auto_renew: false,
  contract_value: null, currency: 'GBP',
  primary_email: '', primary_phone: '', website: '', address: '',
  registration_number: '', vat_number: '', scope: '', relationship_owner_id: null,
});
const blankContact = (): PartnerContact => ({
  first_name: '', last_name: '', position: '', email: '', phone: '', is_primary: false, sort_order: 0,
});
const blankAccount = (): PartnerAccount => ({
  account_name: '', login_url: '', username: '', password: '', sort_order: 0,
});
const blankNote = (): PartnerNote => ({ title: '', body: '', sort_order: 0 });

/**
 * Partners — Operations system. Detail view uses the clients-style 2-col
 * layout: a minimal identity card on the left and a 5-tab detail card on
 * the right (Overview / Contract / Contacts / Accounts / Notes). The edit
 * form is also tabbed (Identity / Contract / Contact & Address / Legal /
 * Scope) so long forms don't require constant scrolling.
 *
 *   /operations/partners            → list
 *   /operations/partners/new        → create
 *   /operations/partners/:id        → view
 *   /operations/partners/:id/edit   → edit
 */
@Component({
  selector: 'app-partners-admin',
  imports: [RouterLink, FormsModule, EntityContracts],
  template: `
    @if (mode() === 'list') {
      <div class="toolbar">
        <h1>Partners</h1>
        <span class="spacer"></span>
        <select [(ngModel)]="filterStatus" name="status_filter" class="status-filter">
          <option value="">All statuses</option>
          @for (s of statusOptions; track s) { <option [value]="s">{{ statusLabel(s) }}</option> }
        </select>
        <button class="primary" routerLink="/operations/partners/new">+ New partner</button>
      </div>

      @if (visible().length === 0) {
        <div class="empty">
          <p class="muted">No partners yet.</p>
          <button class="primary" routerLink="/operations/partners/new">Add your first partner</button>
        </div>
      } @else {
        <div class="table-wrap">
          <table class="data">
            <thead><tr>
              <th>Name</th><th>Type</th><th>Tier</th><th>Renewal</th>
              <th>Contract value</th><th>Status</th><th></th>
            </tr></thead>
            <tbody>
              @for (p of visible(); track p.id) {
                <tr (click)="view(p)">
                  <td><strong>{{ p.legal_name }}</strong>
                    @if (p.trading_name) { <div class="muted small">{{ p.trading_name }}</div> }
                  </td>
                  <td><span class="badge">{{ typeLabel(p.partnership_type || 'strategic') }}</span></td>
                  <td><span class="badge">{{ tierLabel(p.tier || 'standard') }}</span></td>
                  <td>{{ p.renewal_date || '—' }}</td>
                  <td>
                    @if (p.contract_value) { {{ p.currency }} {{ formatValue(p.contract_value) }} } @else { — }
                  </td>
                  <td><span class="status-pill" [attr.data-status]="p.status || 'prospective'">{{ statusLabel(p.status || 'prospective') }}</span></td>
                  <td class="actions">
                    <button class="ghost icon-btn" (click)="view(p, $event)" title="View">👁</button>
                    <button class="ghost icon-btn" (click)="edit(p, $event)" title="Edit">✎</button>
                    <button class="ghost icon-btn danger" (click)="del(p, $event)" title="Delete">✕</button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    }

    @if (mode() === 'view' && current(); as p) {
      <div class="toolbar">
        <button class="ghost" routerLink="/operations/partners">← Back</button>
        <h1>{{ p.legal_name }}</h1>
        <span class="spacer"></span>
        <button class="ghost" (click)="edit(p)">✎ Edit</button>
        <button class="danger" (click)="delCurrent()">Delete</button>
      </div>

      <div class="layout-2col">
        <!-- ───── Left card: minimal identity ────────────────────── -->
        <section class="card identity-card">
          <h2>Partner</h2>
          <div class="kv"><label>Trading name</label><div>{{ p.trading_name || '—' }}</div></div>
          <div class="kv"><label>Status</label>
            <div><span class="status-pill" [attr.data-status]="p.status || 'prospective'">{{ statusLabel(p.status || 'prospective') }}</span></div>
          </div>
          <div class="kv"><label>Type</label><div><span class="badge">{{ typeLabel(p.partnership_type || 'strategic') }}</span></div></div>
          <div class="kv"><label>Tier</label><div><span class="badge">{{ tierLabel(p.tier || 'standard') }}</span></div></div>
          <hr class="divider" />
          <div class="kv"><label>Primary email</label>
            <div>@if (p.primary_email) { <a [href]="'mailto:' + p.primary_email">{{ p.primary_email }}</a> } @else { — }</div>
          </div>
          <div class="kv"><label>Primary phone</label>
            <div>@if (p.primary_phone) { <a [href]="'tel:' + p.primary_phone">{{ p.primary_phone }}</a> } @else { — }</div>
          </div>
          <div class="kv"><label>Website</label>
            <div>@if (p.website) { <a [href]="p.website" target="_blank" rel="noopener">{{ p.website }}</a> } @else { — }</div>
          </div>
          @if (p.created_at) { <div class="kv"><label>Created</label><div>{{ p.created_at }}</div></div> }
        </section>

        <!-- ───── Right card: tabbed details ────────────────────── -->
        <section class="card detail-card">
          <div class="tab-nav">
            @for (t of viewTabs; track t.key) {
              <button class="tab-btn" [class.active]="activeViewTab() === t.key" (click)="setViewTab(t.key)">{{ t.label }}</button>
            }
          </div>
          <div class="tab-content">
            @switch (activeViewTab()) {

              @case ('overview') {
                <h3>Overview</h3>
                <div class="row two">
                  <div class="kv"><label>Contract value</label>
                    <div>@if (p.contract_value) { {{ p.currency }} {{ formatValue(p.contract_value) }} } @else { — }</div>
                  </div>
                  <div class="kv"><label>Currency</label><div>{{ p.currency }}</div></div>
                </div>
                <div class="kv"><label>Scope of partnership</label>
                  <div class="notes">{{ p.scope || '—' }}</div>
                </div>
                <div class="kv"><label>Relationship owner</label>
                  <div>{{ p.owner_email || '—' }}</div>
                </div>
              }

              @case ('contract') {
                <h3>Contract &amp; terms</h3>
                <div class="row two">
                  <div class="kv"><label>Start date</label><div>{{ p.start_date || '—' }}</div></div>
                  <div class="kv"><label>Renewal date</label>
                    <div>{{ p.renewal_date || '—' }}</div>
                  </div>
                </div>
                <div class="kv"><label>Auto-renew</label>
                  <div>{{ p.auto_renew ? 'Yes — renews automatically at end of term' : 'No — requires manual renewal' }}</div>
                </div>
                <div class="kv"><label>Contract value</label>
                  <div>@if (p.contract_value) { {{ p.currency }} {{ formatValue(p.contract_value) }} } @else { — }</div>
                </div>
                <h3 style="margin-top: 20px;">Signed contracts</h3>
                <app-entity-contracts audience="partner" [entityId]="p.id!"></app-entity-contracts>
              }

              @case ('contacts') {
                <div class="tab-head">
                  <h3>Contacts</h3><span class="spacer"></span>
                  <button class="primary" (click)="toggleContactForm()">{{ contactFormOpen() ? '× Cancel' : '+ Add contact' }}</button>
                </div>
                @if (contactFormOpen()) {
                  <div class="sub-form">
                    <div class="row two">
                      <div class="field"><label>First name <span class="req">★</span></label>
                        <input [(ngModel)]="contactDraft.first_name" name="cf_first" /></div>
                      <div class="field"><label>Last name</label>
                        <input [(ngModel)]="contactDraft.last_name" name="cf_last" /></div>
                    </div>
                    <label>Position</label>
                    <input [(ngModel)]="contactDraft.position" name="cf_pos" placeholder="Procurement, Legal, …" />
                    <div class="row two">
                      <div class="field"><label>Email</label>
                        <input type="email" [(ngModel)]="contactDraft.email" name="cf_email" /></div>
                      <div class="field"><label>Phone</label>
                        <input [(ngModel)]="contactDraft.phone" name="cf_phone" /></div>
                    </div>
                    <label class="check-line">
                      <input type="checkbox" [(ngModel)]="contactDraft.is_primary" name="cf_primary" /> Primary contact
                    </label>
                    @if (subError()) { <div class="error-msg">{{ subError() }}</div> }
                    <div class="row" style="margin-top: 16px; gap: 8px;">
                      <button class="primary" (click)="saveContact()" [disabled]="subSaving()">
                        {{ subSaving() ? 'Saving…' : (contactDraft.id ? 'Update' : 'Save contact') }}
                      </button>
                      <button class="ghost" (click)="closeContactForm()">Close</button>
                    </div>
                  </div>
                }
                @if (contacts().length === 0 && !contactFormOpen()) {
                  <p class="muted">No contacts yet.</p>
                } @else {
                  <div class="contact-list">
                    @for (c of contacts(); track c.id) {
                      <div class="contact-card">
                        <div class="contact-head">
                          <div class="contact-name">
                            <strong>{{ c.first_name }} {{ c.last_name }}</strong>
                            @if (c.position) { <span class="position">{{ c.position }}</span> }
                          </div>
                          @if (c.is_primary) { <span class="badge primary">Primary</span> }
                          <span class="spacer"></span>
                          <button class="ghost icon-btn" (click)="editContact(c)" title="Edit">✎</button>
                          <button class="ghost icon-btn danger" (click)="deleteContact(c)" title="Delete">✕</button>
                        </div>
                        <div class="contact-body">
                          @if (c.email) { <div><span class="ic">✉</span> <a [href]="'mailto:' + c.email">{{ c.email }}</a></div> }
                          @if (c.phone) { <div><span class="ic">☎</span> <a [href]="'tel:' + c.phone">{{ c.phone }}</a></div> }
                        </div>
                      </div>
                    }
                  </div>
                }
              }

              @case ('accounts') {
                <div class="tab-head">
                  <h3>Accounts</h3><span class="spacer"></span>
                  <button class="primary" (click)="toggleAccountForm()">{{ accountFormOpen() ? '× Cancel' : '+ Add account' }}</button>
                </div>
                @if (accountFormOpen()) {
                  <div class="sub-form">
                    <label>Account name <span class="req">★</span></label>
                    <input [(ngModel)]="accountDraft.account_name" name="af_name" placeholder="Partner portal, Billing console, …" />
                    <label>Login URL</label>
                    <input [(ngModel)]="accountDraft.login_url" name="af_url" placeholder="https://" />
                    <div class="row two">
                      <div class="field"><label>Username</label>
                        <input [(ngModel)]="accountDraft.username" name="af_user" /></div>
                      <div class="field"><label>Password</label>
                        <input type="password" [(ngModel)]="accountDraft.password" name="af_pass" /></div>
                    </div>
                    @if (subError()) { <div class="error-msg">{{ subError() }}</div> }
                    <div class="row" style="margin-top: 16px; gap: 8px;">
                      <button class="primary" (click)="saveAccount()" [disabled]="subSaving()">
                        {{ subSaving() ? 'Saving…' : (accountDraft.id ? 'Update' : 'Save account') }}
                      </button>
                      <button class="ghost" (click)="closeAccountForm()">Close</button>
                    </div>
                  </div>
                }
                @if (accounts().length === 0 && !accountFormOpen()) {
                  <p class="muted">No accounts yet. Add portal credentials, billing logins, or any shared workspace your partner uses with you.</p>
                } @else {
                  <div class="account-list">
                    @for (a of accounts(); track a.id) {
                      <div class="account-card">
                        <div class="account-head">
                          <strong>{{ a.account_name }}</strong>
                          <span class="spacer"></span>
                          <button class="ghost icon-btn" (click)="editAccount(a)" title="Edit">✎</button>
                          <button class="ghost icon-btn danger" (click)="deleteAccount(a)" title="Delete">✕</button>
                        </div>
                        @if (a.login_url || a.username) {
                          <div class="account-body">
                            @if (a.login_url) {
                              <div><span class="ic">🔗</span> <a [href]="a.login_url" target="_blank" rel="noopener">{{ a.login_url }}</a></div>
                            }
                            @if (a.username) {
                              <div><span class="ic">👤</span> <code>{{ a.username }}</code>
                                <button class="copy-btn" (click)="copy(a.username!)" title="Copy">📋</button>
                              </div>
                            }
                            @if (a.password) {
                              <div><span class="ic">🔒</span>
                                <code>{{ revealedPasswordIds().has(a.id!) ? a.password : '••••••••' }}</code>
                                <button class="copy-btn" (click)="togglePassword(a.id!)" [title]="revealedPasswordIds().has(a.id!) ? 'Hide' : 'Show'">
                                  {{ revealedPasswordIds().has(a.id!) ? '🙈' : '👁' }}
                                </button>
                                <button class="copy-btn" (click)="copy(a.password!)" title="Copy">📋</button>
                              </div>
                            }
                          </div>
                        }
                      </div>
                    }
                  </div>
                }
              }

              @case ('notes') {
                <div class="tab-head">
                  <h3>Notes</h3><span class="spacer"></span>
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
              }
            }
          </div>
        </section>
      </div>
    }

    @if (mode() === 'edit') {
      <div class="toolbar">
        <button class="ghost" (click)="back()">← Back</button>
        <h1>{{ draft.id ? 'Edit partner' : 'New partner' }}</h1>
        <span class="spacer"></span>
        <button class="primary" (click)="save()" [disabled]="saving()">{{ saving() ? 'Saving…' : (draft.id ? 'Save' : 'Create partner') }}</button>
      </div>
      @if (error()) { <div class="error-msg">{{ error() }}</div> }

      <section class="card detail-card">
        <div class="tab-nav">
          @for (t of editTabs; track t.key) {
            <button class="tab-btn" [class.active]="activeEditTab() === t.key" (click)="activeEditTab.set(t.key)">{{ t.label }}</button>
          }
        </div>
        <div class="tab-content">
          @switch (activeEditTab()) {

            @case ('identity') {
              <label>Legal name <span class="req">★</span></label>
              <input [(ngModel)]="draft.legal_name" name="legal_name" />
              <div class="row two">
                <div class="field"><label>Trading name</label>
                  <input [(ngModel)]="draft.trading_name" name="trading_name" /></div>
                <div class="field"><label>Partnership type</label>
                  <select [(ngModel)]="draft.partnership_type" name="ptype">
                    @for (t of typeOptions; track t) { <option [value]="t">{{ typeLabel(t) }}</option> }
                  </select>
                </div>
              </div>
              <div class="row two">
                <div class="field"><label>Status</label>
                  <select [(ngModel)]="draft.status" name="status">
                    @for (s of statusOptions; track s) { <option [value]="s">{{ statusLabel(s) }}</option> }
                  </select>
                </div>
                <div class="field"><label>Tier</label>
                  <select [(ngModel)]="draft.tier" name="tier">
                    @for (t of tierOptions; track t) { <option [value]="t">{{ tierLabel(t) }}</option> }
                  </select>
                </div>
              </div>
            }

            @case ('contract') {
              <div class="row two">
                <div class="field"><label>Contract value</label>
                  <input type="number" step="0.01" min="0" [(ngModel)]="draft.contract_value" name="value" /></div>
                <div class="field"><label>Currency</label>
                  <select [(ngModel)]="draft.currency" name="currency">
                    <option value="GBP">GBP</option><option value="USD">USD</option><option value="EUR">EUR</option>
                  </select>
                </div>
              </div>
              <div class="row two">
                <div class="field"><label>Start date</label>
                  <input type="date" [(ngModel)]="draft.start_date" name="start_date" /></div>
                <div class="field"><label>Renewal date</label>
                  <input type="date" [(ngModel)]="draft.renewal_date" name="renewal_date" /></div>
              </div>
              <label class="check-line">
                <input type="checkbox" [(ngModel)]="draft.auto_renew" name="auto_renew" /> Auto-renew at end of term
              </label>
            }

            @case ('contact') {
              <div class="row two">
                <div class="field"><label>Primary email</label>
                  <input type="email" [(ngModel)]="draft.primary_email" name="email" /></div>
                <div class="field"><label>Primary phone</label>
                  <input [(ngModel)]="draft.primary_phone" name="phone" /></div>
              </div>
              <label>Website</label>
              <input [(ngModel)]="draft.website" name="website" placeholder="https://" />
              <label>Registered address</label>
              <textarea [(ngModel)]="draft.address" name="address" rows="3"></textarea>
            }

            @case ('legal') {
              <div class="row two">
                <div class="field"><label>Registration number</label>
                  <input [(ngModel)]="draft.registration_number" name="reg_no" /></div>
                <div class="field"><label>VAT number</label>
                  <input [(ngModel)]="draft.vat_number" name="vat_no" /></div>
              </div>
            }

            @case ('scope') {
              <label>Scope of partnership</label>
              <textarea [(ngModel)]="draft.scope" name="scope" rows="10" placeholder="What we do together, deliverables, expectations, terms, obligations…"></textarea>
              <p class="muted small">Rich free-form text. For structured deliverables or per-clause obligations, use the Notes tab after save (one note per clause keeps them searchable).</p>
            }
          }
        </div>
      </section>
    }
  `,
  styles: [`
    .status-filter { padding: 6px 8px; flex: 0 0 auto; width: auto; min-width: 160px; max-width: 220px; }
    .status-pill {
      display: inline-block; padding: 2px 10px;
      border-radius: 999px; font-size: 11px; text-transform: uppercase;
      letter-spacing: 0.5px; border: 1px solid var(--line); color: var(--muted);
    }
    .status-pill[data-status="prospective"] { color: var(--muted); }
    .status-pill[data-status="active"]      { color: var(--success); border-color: var(--success); }
    .status-pill[data-status="paused"]      { color: var(--primary); border-color: var(--primary); }
    .status-pill[data-status="terminated"]  { color: var(--danger);  border-color: var(--danger); }
    .badge {
      display: inline-block; padding: 2px 8px;
      border-radius: 999px; font-size: 11px;
      background: var(--bg-3); color: var(--muted);
      border: 1px solid var(--line);
    }
    .badge.primary { color: var(--primary); border-color: var(--primary); }

    .row.two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .field { display: flex; flex-direction: column; gap: 4px; }
    .field label { margin-top: 0; }
    .check-line { display: flex; align-items: center; gap: 8px; margin-top: 14px;
      text-transform: none; letter-spacing: 0; font-size: 13px; color: var(--fg); cursor: pointer; }
    .check-line input[type="checkbox"] { width: 16px; height: 16px; flex-shrink: 0; }

    .kv { margin-bottom: 14px; }
    .kv label { display: block; color: var(--muted); font-size: 11px;
      text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 4px 0; }
    .kv > div { color: var(--fg); font-size: 14px; word-break: break-word; }
    .kv .notes { white-space: pre-wrap; }
    .card h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); margin: 0 0 12px 0; font-weight: 600; }
    .req { color: var(--primary); margin-left: 2px; }

    .layout-2col {
      display: grid; grid-template-columns: 320px 1fr;
      gap: 20px; padding: 20px; align-items: start;
    }
    @media (max-width: 1100px) { .layout-2col { grid-template-columns: 1fr; } }
    .identity-card hr.divider { border: none; border-top: 1px solid var(--line); margin: 14px 0; }

    .detail-card { padding: 0; overflow: hidden; }
    .tab-nav {
      display: flex; gap: 2px; border-bottom: 1px solid var(--line);
      padding: 0 12px; overflow-x: auto;
    }
    .tab-btn {
      padding: 14px 16px; background: transparent; border: none;
      color: var(--muted); cursor: pointer; font-size: 13px; white-space: nowrap;
      position: relative; transition: color 0.15s;
    }
    .tab-btn:hover { color: var(--fg); }
    .tab-btn.active { color: var(--primary); }
    .tab-btn.active::after {
      content: ''; position: absolute; bottom: -1px; left: 0; right: 0; height: 2px;
      background: var(--primary);
    }
    .tab-content { padding: 24px; }
    .tab-content h3 { margin: 0 0 16px 0; font-size: 14px;
      text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); font-weight: 600; }
    .tab-content label { display: block; margin-top: 12px; }
    .tab-head { display: flex; align-items: center; margin-bottom: 16px; }
    .tab-head h3 { margin: 0; }
    .tab-head .spacer { flex: 1; }

    .sub-form {
      padding: 16px; background: var(--bg-3); border: 1px solid var(--line);
      border-radius: var(--radius-sm); margin-bottom: 16px;
    }
    .sub-form label { margin-top: 12px; display: block; }

    .contact-list, .note-list, .account-list { display: flex; flex-direction: column; gap: 10px; }
    .contact-card, .note-card, .account-card {
      background: var(--bg-3); border: 1px solid var(--line);
      border-radius: var(--radius-sm); padding: 12px 14px;
    }
    .contact-head, .note-head, .account-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .contact-head .spacer, .note-head .spacer, .account-head .spacer { flex: 1; }
    .contact-name { display: flex; flex-direction: column; gap: 2px; }
    .contact-name strong { font-size: 14px; }
    .contact-name .position { color: var(--primary); font-size: 12px; font-style: italic; }
    .contact-body, .account-body { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
    .contact-body .ic, .account-body .ic { color: var(--primary); width: 18px; display: inline-block; text-align: center; margin-right: 4px; }
    .contact-body a, .account-body a { color: var(--fg); text-decoration: none; }
    .contact-body a:hover, .account-body a:hover { color: var(--primary); }
    .account-body code { font-family: "JetBrains Mono", monospace; font-size: 12px;
      background: var(--bg-2); padding: 2px 6px; border-radius: 4px; }
    .copy-btn {
      background: transparent; border: none; color: var(--muted);
      cursor: pointer; padding: 0 4px; font-size: 12px;
    }
    .copy-btn:hover { color: var(--primary); }
    .note-body { margin: 0; white-space: pre-wrap; color: var(--fg); font-size: 14px; line-height: 1.6; }
  `],
})
export class PartnersAdmin {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  statusOptions: PartnerStatus[] = ['prospective', 'active', 'paused', 'terminated'];
  typeOptions:   PartnerType[]   = ['strategic', 'reseller', 'technology', 'channel', 'referral', 'other'];
  tierOptions:   PartnerTier[]   = ['preferred', 'standard', 'prospective'];
  statusLabel = (s: PartnerStatus) => STATUS_LABELS[s] || s;
  typeLabel   = (t: PartnerType)   => TYPE_LABELS[t] || t;
  tierLabel   = (t: PartnerTier)   => TIER_LABELS[t] || t;

  viewTabs: { key: ViewTab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'contract', label: 'Contract' },
    { key: 'contacts', label: 'Contacts' },
    { key: 'accounts', label: 'Accounts' },
    { key: 'notes',    label: 'Notes' },
  ];
  editTabs: { key: EditTab; label: string }[] = [
    { key: 'identity', label: 'Identity' },
    { key: 'contract', label: 'Contract' },
    { key: 'contact',  label: 'Contact' },
    { key: 'legal',    label: 'Legal' },
    { key: 'scope',    label: 'Scope' },
  ];

  partners = signal<Partner[]>([]);
  current = signal<Partner | null>(null);
  mode = signal<Mode>('list');
  activeViewTab = signal<ViewTab>('overview');
  activeEditTab = signal<EditTab>('identity');
  draft: Partner = blankDraft();
  filterStatus = '';

  saving = signal(false);
  error = signal<string | null>(null);
  subSaving = signal(false);
  subError = signal<string | null>(null);

  contacts = signal<PartnerContact[]>([]);
  contactFormOpen = signal(false);
  contactDraft: PartnerContact = blankContact();

  accounts = signal<PartnerAccount[]>([]);
  accountFormOpen = signal(false);
  accountDraft: PartnerAccount = blankAccount();
  revealedPasswordIds = signal<Set<number>>(new Set());

  notes = signal<PartnerNote[]>([]);
  noteFormOpen = signal(false);
  noteDraft: PartnerNote = blankNote();

  visible = computed(() => {
    const f = this.filterStatus;
    return f ? this.partners().filter(p => (p.status || 'prospective') === f) : this.partners();
  });

  constructor() {
    this.route.url.subscribe(() => this.routeToMode());
    this.route.params.subscribe(() => this.routeToMode());
    this.loadList();
  }

  private routeToMode() {
    const url = this.router.url;
    if (url.endsWith('/operations/partners') || url.startsWith('/operations/partners?')) {
      this.mode.set('list'); this.current.set(null); return;
    }
    if (url.endsWith('/operations/partners/new')) {
      this.mode.set('edit'); this.draft = blankDraft(); this.activeEditTab.set('identity'); this.error.set(null); return;
    }
    const editMatch = /\/operations\/partners\/(\d+)\/edit/.exec(url);
    const viewMatch = /\/operations\/partners\/(\d+)$/.exec(url);
    if (editMatch) this.loadOne(Number(editMatch[1]), 'edit');
    else if (viewMatch) this.loadOne(Number(viewMatch[1]), 'view');
  }
  private loadList() { this.api.listPartners().subscribe(r => this.partners.set(r.partners)); }
  private loadOne(id: number, target: Mode) {
    this.api.getPartner(id).subscribe(r => {
      this.current.set(r.partner);
      if (target === 'edit') {
        this.draft = { ...r.partner };
        this.activeEditTab.set('identity');
      }
      this.mode.set(target);
      if (target === 'view') {
        this.activeViewTab.set('overview');
      }
    });
  }
  setViewTab(t: ViewTab) {
    this.activeViewTab.set(t);
    const id = this.current()?.id; if (!id) return;
    if (t === 'contacts' && this.contacts().length === 0) this.api.listPartnerContacts(id).subscribe(r => this.contacts.set(r.contacts));
    else if (t === 'accounts' && this.accounts().length === 0) this.api.listPartnerAccounts(id).subscribe(r => this.accounts.set(r.accounts));
    else if (t === 'notes' && this.notes().length === 0) this.api.listPartnerNotes(id).subscribe(r => this.notes.set(r.notes));
  }

  view(p: Partner, e?: Event) { e?.stopPropagation(); this.router.navigate(['/operations/partners', p.id]); }
  edit(p: Partner, e?: Event) { e?.stopPropagation(); this.router.navigate(['/operations/partners', p.id, 'edit']); }
  back() {
    if (this.draft.id) this.router.navigate(['/operations/partners', this.draft.id]);
    else this.router.navigate(['/operations/partners']);
  }
  del(p: Partner, e: Event) {
    e.stopPropagation();
    if (!confirm(`Delete partner "${p.legal_name}"?`)) return;
    this.api.deletePartner(p.id!).subscribe(() => this.loadList());
  }
  delCurrent() {
    const p = this.current(); if (!p) return;
    if (!confirm(`Delete partner "${p.legal_name}"?`)) return;
    this.api.deletePartner(p.id!).subscribe(() => this.router.navigate(['/operations/partners']));
  }

  save() {
    this.error.set(null);
    const name = (this.draft.legal_name || '').trim();
    if (!name) { this.error.set('Legal name is required.'); this.activeEditTab.set('identity'); return; }
    this.saving.set(true);
    const payload: Partner = {
      ...this.draft, legal_name: name,
      trading_name:        (this.draft.trading_name        || '').trim() || null,
      primary_email:       (this.draft.primary_email       || '').trim() || null,
      primary_phone:       (this.draft.primary_phone       || '').trim() || null,
      website:             (this.draft.website             || '').trim() || null,
      registration_number: (this.draft.registration_number || '').trim() || null,
      vat_number:          (this.draft.vat_number          || '').trim() || null,
      start_date:          this.draft.start_date   || null,
      renewal_date:        this.draft.renewal_date || null,
      contract_value:      this.draft.contract_value === '' || this.draft.contract_value == null ? null : Number(this.draft.contract_value),
    };
    const after = (id: number) => { this.saving.set(false); this.router.navigate(['/operations/partners', id]); };
    if (this.draft.id) {
      this.api.updatePartner(this.draft.id, payload).subscribe({
        next: () => after(this.draft.id!),
        error: e => { this.saving.set(false); this.error.set(e?.error?.error || 'Save failed'); },
      });
    } else {
      this.api.createPartner(payload).subscribe({
        next: r => after(r.id),
        error: e => { this.saving.set(false); this.error.set(e?.error?.error || 'Save failed'); },
      });
    }
  }

  // ───── Contacts tab ─────
  toggleContactForm() {
    if (this.contactFormOpen()) { this.closeContactForm(); return; }
    this.contactDraft = blankContact(); this.subError.set(null); this.contactFormOpen.set(true);
  }
  closeContactForm() { this.contactFormOpen.set(false); this.subError.set(null); }
  editContact(c: PartnerContact) { this.contactDraft = { ...c }; this.subError.set(null); this.contactFormOpen.set(true); }
  saveContact() {
    const id = this.current()?.id; if (!id) return;
    const first = (this.contactDraft.first_name || '').trim();
    if (!first) { this.subError.set('First name is required.'); return; }
    this.subSaving.set(true);
    const payload: PartnerContact = { ...this.contactDraft, first_name: first };
    const after = () => {
      this.subSaving.set(false); this.closeContactForm();
      this.api.listPartnerContacts(id).subscribe(r => this.contacts.set(r.contacts));
    };
    if (this.contactDraft.id) {
      this.api.updatePartnerContact(id, this.contactDraft.id, payload).subscribe({ next: after,
        error: e => { this.subSaving.set(false); this.subError.set(e?.error?.error || 'Save failed'); } });
    } else {
      this.api.createPartnerContact(id, payload).subscribe({ next: after,
        error: e => { this.subSaving.set(false); this.subError.set(e?.error?.error || 'Save failed'); } });
    }
  }
  deleteContact(c: PartnerContact) {
    const id = this.current()?.id; if (!id || !c.id) return;
    if (!confirm(`Delete ${c.first_name} ${c.last_name || ''}?`)) return;
    this.api.deletePartnerContact(id, c.id).subscribe(() => {
      this.api.listPartnerContacts(id).subscribe(r => this.contacts.set(r.contacts));
    });
  }

  // ───── Accounts tab ─────
  toggleAccountForm() {
    if (this.accountFormOpen()) { this.closeAccountForm(); return; }
    this.accountDraft = blankAccount(); this.subError.set(null); this.accountFormOpen.set(true);
  }
  closeAccountForm() { this.accountFormOpen.set(false); this.subError.set(null); }
  editAccount(a: PartnerAccount) { this.accountDraft = { ...a }; this.subError.set(null); this.accountFormOpen.set(true); }
  saveAccount() {
    const id = this.current()?.id; if (!id) return;
    const name = (this.accountDraft.account_name || '').trim();
    if (!name) { this.subError.set('Account name is required.'); return; }
    this.subSaving.set(true);
    const payload: PartnerAccount = { ...this.accountDraft, account_name: name };
    const after = () => {
      this.subSaving.set(false); this.closeAccountForm();
      this.api.listPartnerAccounts(id).subscribe(r => this.accounts.set(r.accounts));
    };
    if (this.accountDraft.id) {
      this.api.updatePartnerAccount(id, this.accountDraft.id, payload).subscribe({ next: after,
        error: e => { this.subSaving.set(false); this.subError.set(e?.error?.error || 'Save failed'); } });
    } else {
      this.api.createPartnerAccount(id, payload).subscribe({ next: after,
        error: e => { this.subSaving.set(false); this.subError.set(e?.error?.error || 'Save failed'); } });
    }
  }
  deleteAccount(a: PartnerAccount) {
    const id = this.current()?.id; if (!id || !a.id) return;
    if (!confirm(`Delete account "${a.account_name}"?`)) return;
    this.api.deletePartnerAccount(id, a.id).subscribe(() => {
      this.api.listPartnerAccounts(id).subscribe(r => this.accounts.set(r.accounts));
    });
  }
  togglePassword(id: number) {
    const next = new Set(this.revealedPasswordIds());
    if (next.has(id)) next.delete(id); else next.add(id);
    this.revealedPasswordIds.set(next);
  }
  copy(value: string) {
    if (!navigator?.clipboard) return;
    navigator.clipboard.writeText(value).catch(() => {});
  }

  // ───── Notes tab ─────
  toggleNoteForm() {
    if (this.noteFormOpen()) { this.closeNoteForm(); return; }
    this.noteDraft = blankNote(); this.subError.set(null); this.noteFormOpen.set(true);
  }
  closeNoteForm() { this.noteFormOpen.set(false); this.subError.set(null); }
  editNote(n: PartnerNote) { this.noteDraft = { ...n }; this.subError.set(null); this.noteFormOpen.set(true); }
  saveNote() {
    const id = this.current()?.id; if (!id) return;
    const title = (this.noteDraft.title || '').trim();
    if (!title) { this.subError.set('Title is required.'); return; }
    this.subSaving.set(true);
    const payload: PartnerNote = { ...this.noteDraft, title };
    const after = () => {
      this.subSaving.set(false); this.closeNoteForm();
      this.api.listPartnerNotes(id).subscribe(r => this.notes.set(r.notes));
    };
    if (this.noteDraft.id) {
      this.api.updatePartnerNote(id, this.noteDraft.id, payload).subscribe({ next: after,
        error: e => { this.subSaving.set(false); this.subError.set(e?.error?.error || 'Save failed'); } });
    } else {
      this.api.createPartnerNote(id, payload).subscribe({ next: after,
        error: e => { this.subSaving.set(false); this.subError.set(e?.error?.error || 'Save failed'); } });
    }
  }
  deleteNote(n: PartnerNote) {
    const id = this.current()?.id; if (!id || !n.id) return;
    if (!confirm(`Delete "${n.title}"?`)) return;
    this.api.deletePartnerNote(id, n.id).subscribe(() => {
      this.api.listPartnerNotes(id).subscribe(r => this.notes.set(r.notes));
    });
  }

  formatValue(v: number | string): string {
    const n = typeof v === 'string' ? parseFloat(v) : v;
    if (!Number.isFinite(n)) return String(v);
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}
