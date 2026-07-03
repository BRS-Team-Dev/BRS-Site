import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { Api } from '../../core/api';
import { DialogService } from '../../core/dialog';
import { environment } from '@env/environment';
import { Client, ClientAccount, ClientContact, ClientInfo, ClientNote, ClientService, ClientServicesTotals, FeedbackForm, FeedbackQuestion, FeedbackResponse, FormDef, FormSubmissionLinkGroup, ServiceOffering, TaskItem } from '../../core/models';
import { EntityContracts } from '../../shared/entity-contracts';
import { FormSubmissionsList } from '../../shared/form-submissions-list';

type TabKey = 'info' | 'contacts' | 'services' | 'accounts' | 'contracts' | 'onboarding' | 'feedback' | 'notes';

/**
 * Standalone Clients section.
 *   /admin/clients           → list
 *   /admin/clients/new       → create
 *   /admin/clients/:id       → view (read-only)
 *   /admin/clients/:id/edit  → edit
 */
@Component({
  selector: 'app-clients-admin',
  imports: [RouterLink, FormsModule, EntityContracts, FormSubmissionsList],
  template: `
    @if (mode() === 'list') {
      <div class="toolbar">
        <h1>Clients</h1>
        <span class="spacer"></span>
        <button class="primary" routerLink="/admin/clients/new">+ New client</button>
      </div>

      @if (clients().length === 0) {
        <div class="empty">
          <p class="muted">No clients yet.</p>
          <button class="primary" routerLink="/admin/clients/new">Add your first client</button>
        </div>
      } @else {
        <div class="table-wrap">
          <table class="data">
            <thead><tr>
              <th>Name</th><th>Email</th><th>Phone</th><th>Company</th><th></th>
            </tr></thead>
            <tbody>
              @for (c of clients(); track c.id) {
                <tr (click)="view(c)">
                  <td><strong>{{ c.name }}</strong></td>
                  <td>{{ c.email || '—' }}</td>
                  <td>{{ c.phone || '—' }}</td>
                  <td>{{ c.company || '—' }}</td>
                  <td class="actions">
                    <button class="ghost icon-btn" (click)="view(c, $event)" title="View" aria-label="View"
>👁</button>
                    <button class="ghost icon-btn" (click)="edit(c, $event)" title="Edit" aria-label="Edit"
>✎</button>
                    <button class="ghost icon-btn relegate" (click)="relegate(c, $event)" title="Send back to leads" aria-label="Send back to leads"
>↓</button>
                    <button class="ghost icon-btn danger" (click)="del(c, $event)" title="Delete" aria-label="Delete"
>✕</button>
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
        <h1>{{ current()?.name || 'Client' }}</h1>
        <span class="spacer"></span>
        <button class="ghost" (click)="goEdit()" title="Edit">✎ Edit</button>
        <button class="ghost" (click)="relegateCurrent()" title="Send back to leads">↓ Send to leads</button>
        <button class="danger" (click)="delCurrent()">Delete</button>
      </div>

      @if (current(); as c) {
        <div class="layout-2col">
          <section class="card">
            <h2>Client</h2>
            <div class="kv"><label>Name</label><div>{{ primaryContactName(c) }}</div></div>
            <div class="kv"><label>Email</label><div>{{ primaryContactEmail(c) || '—' }}</div></div>
            <div class="kv"><label>Phone</label><div>{{ primaryContactPhone() || '—' }}</div></div>
            <div class="kv"><label>Address</label><div class="notes">{{ c.address || '—' }}</div></div>
            <div class="kv"><label>Company</label><div>{{ c.company || '—' }}</div></div>
            <div class="kv">
              <label>Website</label>
              <div>
                @if (c.url) {
                  <a [href]="c.url" target="_blank" rel="noopener">{{ c.url }}</a>
                } @else { — }
              </div>
            </div>
            <div class="kv"><label>Notes</label><div class="notes">{{ c.notes || '—' }}</div></div>
            @if (c.created_at) { <div class="kv"><label>Created</label><div>{{ c.created_at }}</div></div> }
            @if (c.updated_at) { <div class="kv"><label>Last updated</label><div>{{ c.updated_at }}</div></div> }
          </section>

          <section class="card detail-card">
            <div class="tab-nav">
              @for (t of tabs; track t.key) {
                <button
                  class="tab-btn"
                  [class.active]="activeTab() === t.key"
                  (click)="onTabClick(t.key, c.id!)"
>
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
                      <input [(ngModel)]="infoDraft.name" name="if_name" placeholder="e.g. Industry"
 />

                      <label>Value</label>
                      <textarea [(ngModel)]="infoDraft.value" name="if_value" rows="3" placeholder="e.g. SaaS / Fintech"
></textarea>

                      @if (infoError()) { <div class="error-msg">{{ infoError() }}</div> }
                      <div class="row" style="margin-top: 16px; gap: 8px;">
                        <button class="primary" (click)="saveInfo()" [disabled]="infoSaving()"
>
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
                            <button class="ghost icon-btn" (click)="editInfo(i)" title="Edit"
>✎</button>
                            <button class="ghost icon-btn danger" (click)="deleteInfo(i)" title="Delete"
>✕</button>
                          </div>
                        </div>
                      }
                    </div>
                  }
                }
                @case ('contacts') {
                  <div class="tab-head">
                    <h3>Contacts</h3>
                    <span class="spacer"></span>
                    <button class="primary" (click)="toggleContactForm()">
                      {{ contactFormOpen() ? '× Cancel' : '+ Add contact' }}
                    </button>
                  </div>

                  @if (contactFormOpen()) {
                    <div class="contact-form">
                      <div class="row two-col">
                        <div>
                          <label>First name <span class="req">★</span></label>
                          <input [(ngModel)]="contactDraft.first_name" name="cd_first" placeholder="Jane"
 />
                        </div>
                        <div>
                          <label>Last name</label>
                          <input [(ngModel)]="contactDraft.last_name" name="cd_last" placeholder="Doe"
 />
                        </div>
                      </div>
                      <label>Position</label>
                      <input [(ngModel)]="contactDraft.position" name="cd_pos" placeholder="CEO"
 />
                      <label>Email</label>
                      <input type="email" [(ngModel)]="contactDraft.email" name="cd_email" placeholder="jane@example.com"
 />

                      <label>Numbers</label>
                      @for (n of contactNumbers(); track $index; let i = $index) {
                        <div class="number-row">
                          <input [(ngModel)]="n.number" [name]="'num_' + i" placeholder="+1 555 123 4567"
 />
                          <input [(ngModel)]="n.label" [name]="'lbl_' + i" placeholder="mobile / office" class="num-label"
 />
                          <button class="ghost icon-btn danger" (click)="removeNumber(i)" title="Remove"
>✕</button>
                        </div>
                      }
                      <button class="ghost" (click)="addNumber()">+ Add number</button>

                      <div class="checkbox-row" style="margin-top: 12px;">
                        <input type="checkbox" id="verified" [(ngModel)]="contactDraft.verified" name="cd_verified"
 />
                        <label for="verified">Verified</label>
                      </div>

                      @if (contactError()) { <div class="error-msg">{{ contactError() }}</div> }
                      <div class="row" style="margin-top: 16px; gap: 8px;">
                        <button class="primary" (click)="saveContact()" [disabled]="contactSaving()"
>
                          {{ contactSaving() ? 'Saving…' : (contactDraft.id ? 'Update' : 'Save contact') }}
                        </button>
                        <button class="ghost" (click)="closeContactForm()">Done</button>
                      </div>
                    </div>
                  }

                  @if (contacts().length === 0) {
                    <p class="muted">No contacts yet.</p>
                  } @else {
                    <div class="contact-list">
                      @for (ct of contacts(); track ct.id) {
                        <div class="contact-card" [class.expanded]="expandedContact() === ct.id" [class.primary]="!!ct.is_primary"
>
                          <div class="contact-head" (click)="toggleContact(ct)">
                            <span class="caret">›</span>
                            <div class="contact-name">
                              <strong>{{ ct.first_name }} {{ ct.last_name }}</strong>
                              @if (ct.position) { <span class="position">{{ ct.position }}</span> }
                            </div>
                            @if (ct.is_primary) {
                              <span class="badge primary">Primary</span>
                            } @else {
                              <button class="ghost small make-primary" (click)="makePrimary(ct); $event.stopPropagation()" title="Set as primary contact"
>
                                Set as primary
                              </button>
                            }
                            @if (ct.verified) { <span class="badge success">Verified</span> }
                            <span class="spacer"></span>
                            <button class="ghost icon-btn" (click)="editContact(ct); $event.stopPropagation()" title="Edit"
>✎</button>
                            <button class="ghost icon-btn danger" (click)="deleteContact(ct); $event.stopPropagation()" title="Delete"
>✕</button>
                          </div>
                          @if (expandedContact() === ct.id) {
                            <div class="contact-body">
                              @if (ct.email) { <div class="muted small"><span class="ic">✉</span> <a [href]="'mailto:' + ct.email">{{ ct.email }}</a></div> }
                              @for (n of ct.numbers; track n.id) {
                                <div class="muted small"><span class="ic">☏</span> <a [href]="'tel:' + n.number">{{ n.number }}</a> @if (n.label) { <span>— {{ n.label }}</span> }</div>
                              }
                            </div>
                          }
                        </div>
                      }
                    </div>
                  }
                }
                @case ('services') {
                  <div class="tab-head">
                    <h3>Services</h3>
                    <span class="spacer"></span>
                    <button class="primary" (click)="toggleAddService()">
                      {{ addServiceOpen() ? '× Cancel' : '+ Add service' }}
                    </button>
                  </div>

                  @if (addServiceOpen()) {
                    <div class="info-form">
                      <div class="muted small" style="margin-bottom: 8px;">
                        Catalogue services attach with their price; onboarding
                        processes also create an instance for this client,
                        qualify it, and (if the form has a team) auto-create the
                        project. Picking the same one again is fine — each is its
                        own record.
                      </div>
                      <label>Service <span class="req">★</span></label>
                      <select [(ngModel)]="addServiceSel" name="add_svc_form">
                        <option [ngValue]="null">— pick a service —</option>
                        @if (serviceOfferings().length) {
                          <optgroup label="Catalogue services">
                            @for (s of serviceOfferings(); track s.id) {
                              <option [ngValue]="'svc:' + s.id">{{ s.name }}</option>
                            }
                          </optgroup>
                        }
                        @if (serviceForms().length) {
                          <optgroup label="Onboarding processes">
                            @for (f of serviceForms(); track f.id) {
                              <option [ngValue]="'form:' + f.id">{{ f.title }}</option>
                            }
                          </optgroup>
                        }
                      </select>
                      @if (addServiceError()) { <div class="error-msg">{{ addServiceError() }}</div> }
                      <div class="row" style="margin-top: 14px; gap: 8px;">
                        <button class="primary" (click)="addService()" [disabled]="addServiceSaving() || !addServiceSel"
>
                          {{ addServiceSaving() ? 'Adding…' : 'Add service' }}
                        </button>
                        <button class="ghost" (click)="closeAddService()">Cancel</button>
                      </div>
                    </div>
                  }

                  @if (services().length === 0) {
                    <p class="muted">
                      No services yet. Use <strong>+ Add service</strong> to
                      attach a catalogue service or onboarding process.
                    </p>
                  } @else {
                    <div class="totals-grid">
                      <div class="total-card">
                        <div class="total-label">Contract value</div>
                        <div class="total-value">
                          {{ formatMoney(servicesTotals()?.total_contract_value) }}
                          @if (servicesTotals()?.has_indefinite) {
                            <span class="muted small"> + ongoing</span>
                          }
                        </div>
                      </div>
                      <div class="total-card">
                        <div class="total-label">To date</div>
                        <div class="total-value">{{ formatMoney(servicesTotals()?.total_to_date) }}</div>
                      </div>
                      <div class="total-card">
                        <div class="total-label">Incoming</div>
                        <div class="total-value">{{ formatMoney(servicesTotals()?.total_incoming) }}</div>
                      </div>
                      <div class="total-card">
                        <div class="total-label">Monthly value</div>
                        <div class="total-value">{{ formatMoney(servicesTotals()?.monthly_value) }}</div>
                      </div>
                    </div>

                    <ul class="slot-list services-list">
                      @for (s of services(); track s.row_key) {
                        <li class="slot"
                            [class.filled]="s.status !== 'ended'"
                            [class.missing]="s.status === 'ended'"
                            [class.expanded]="isServiceExpanded(s.row_key)"
>
                          <div class="slot-head"
                               [class.no-caret]="!isExpandable(s)"
                               (click)="toggleService(s)">
                            @if (isExpandable(s)) { <span class="caret">›</span> }
                            <strong>{{ s.form_title }}</strong>
                            @if (s.kind === 'catalog') {
                              <span class="pill" data-pstatus="catalog">Service</span>
                            } @else if (s.status === 'ended') {
                              <span class="pill ended">Ended</span>
                            } @else if (s.project_status) {
                              <span class="pill" [attr.data-pstatus]="s.project_status">
                                {{ projectStatusLabel(s.project_status) }}
                              </span>
                            } @else {
                              <span class="pill" data-pstatus="none">No project</span>
                            }
                            <span class="terms-pill">
                              @if (!s.has_price) {
                                No price
                              } @else if (s.payment_type === 'one_off') {
                                One-off · {{ formatMoney(s.price) }}
                              } @else {
                                {{ formatMoney(s.price) }} / {{ s.repeat_duration }}
                                @if (s.is_indefinite) { · indefinite }
                                @else if (s.contract_length_months) { · {{ s.contract_length_months }} mo }
                              }
                            </span>
                            <span class="spacer"></span>
                            <span class="monthly-chip"><strong>{{ formatMoney(s.monthly_value) }}</strong> /mo</span>
                            @if (s.kind === 'catalog') {
                              <button class="ghost icon-btn danger" (click)="removeCatalogService(s, $event)" title="Remove service"
>✕</button>
                            }
                          </div>
                          <div class="slot-meta service-breakdown">
                            <span><span class="k">Started</span> {{ formatDate(s.qualified_at || s.submitted_at || s.started_at) }}</span>
                            <span>
                              <span class="k">Contract</span>
                              @if (s.total_value === null) { <span class="muted">ongoing</span> }
                              @else { {{ formatMoney(s.total_value) }} }
                            </span>
                            <span><span class="k">To date</span> {{ formatMoney(s.to_date) }}</span>
                            <span>
                              <span class="k">Incoming</span>
                              @if (s.is_indefinite) { <span class="muted">—</span> }
                              @else { {{ formatMoney(s.incoming) }} }
                            </span>
                          </div>

                          @if (isServiceExpanded(s.row_key)) {
                            <!-- Onboarding rows: show linked work items -->
                            @if (s.kind === 'onboarding') {
                              <div class="service-items">
                                @if (!s.project_id) {
                                  <p class="muted small">No project linked — work items appear here when one is created.</p>
                                } @else if (serviceItemsLoading().has(s.project_id)) {
                                  <p class="muted small">Loading work items…</p>
                                } @else if ((serviceItems().get(s.project_id)?.length ?? 0) === 0) {
                                  <p class="muted small">No work items in this project yet.</p>
                                } @else {
                                  <div class="items-head">
                                    <strong>Work items</strong>
                                    <span class="spacer"></span>
                                    <a class="ghost small" [routerLink]="['/tasks/taskboard/projects', s.project_id]">Open project →</a>
                                  </div>
                                  <ul class="items-list">
                                    @for (it of serviceItems().get(s.project_id)!; track it.id) {
                                      <li>
                                        @if (it.type_color) { <span class="type-dot" [style.background]="it.type_color"></span> }
                                        <span class="it-id">#{{ it.id }}</span>
                                        <a class="it-title" [routerLink]="['/tasks/taskboard/projects', s.project_id]" [queryParams]="{ item: it.id }">
                                          {{ it.title }}
                                        </a>
                                        <span class="spacer"></span>
                                        @if (it.state_name) {
                                          <span class="it-state" [style.color]="it.state_color || ''" [style.borderColor]="it.state_color || ''">
                                            {{ it.state_name }}
                                          </span>
                                        }
                                        @if (it.assignee_name) {
                                          <span class="muted small">{{ it.assignee_name }}</span>
                                        }
                                      </li>
                                    }
                                  </ul>
                                }
                              </div>
                            }

                            <!-- Any row (catalog or onboarding) with linked
                                 form submissions on the same service: show
                                 the captured data inline, collapsible per
                                 submission so multiple entries don't
                                 dominate the row. -->
                            @if (hasLinkedOnboarding(s)) {
                              <div class="service-onboarding">
                                <div class="items-head">
                                  <strong>Onboarding captured</strong>
                                  <span class="spacer"></span>
                                  <a class="ghost small" (click)="activeTab.set('onboarding'); $event.preventDefault()">Open Onboarding tab →</a>
                                </div>
                                @for (g of linkedOnboardingFor(s); track g.form.id) {
                                  <div class="ob-form">
                                    <span class="ob-form-type" [class.multipart]="g.form.form_type === 'onboarding'">
                                      {{ g.form.form_type === 'onboarding' ? 'Multipart' : 'Form' }}
                                    </span>
                                    <strong>{{ g.form.title }}</strong>
                                    <span class="muted small">{{ g.submissions.length }} submission{{ g.submissions.length === 1 ? '' : 's' }}</span>
                                  </div>
                                  <ul class="ob-subs">
                                    @for (sub of g.submissions; track sub.link_id) {
                                      <li>
                                        <button type="button" class="ob-toggle" (click)="toggleServiceSub(sub.link_id, $event)">
                                          <span class="ob-caret">{{ isServiceSubOpen(sub.link_id) ? '▾' : '▸' }}</span>
                                          <span class="ob-when">{{ formatDate(sub.submitted_at) }}</span>
                                          @if (sub.is_compulsory) {
                                            <span class="ob-required">🔒 Required</span>
                                          }
                                        </button>
                                        @if (isServiceSubOpen(sub.link_id)) {
                                          @if (!sub.data) {
                                            <p class="muted small">Submission data missing.</p>
                                          } @else {
                                            <table class="ob-fields">
                                              @for (row of submissionRows(sub.data); track row.key) {
                                                <tr>
                                                  <th>{{ prettyFieldName(row.key) }}</th>
                                                  <td>{{ formatValue(row.value) }}</td>
                                                </tr>
                                              }
                                            </table>
                                          }
                                        }
                                      </li>
                                    }
                                  </ul>
                                }
                              </div>
                            }
                          }
                        </li>
                      }
                    </ul>
                  }
                }
                @case ('accounts') {
                  <div class="tab-head">
                    <h3>Accounts</h3>
                    <span class="spacer"></span>
                    <button class="primary" (click)="toggleAccountForm()">
                      {{ accountFormOpen() ? '× Cancel' : '+ Add account' }}
                    </button>
                  </div>

                  @if (accountFormOpen()) {
                    <div class="contact-form">
                      <label>Account name <span class="req">★</span></label>
                      <input [(ngModel)]="accountDraft.account_name" name="ad_name" placeholder="Cloudflare, Mailchimp, etc."
 />

                      <label>Login URL</label>
                      <input [(ngModel)]="accountDraft.login_url" name="ad_url" placeholder="https://example.com/login"
 />

                      <label>Username / email</label>
                      <input [(ngModel)]="accountDraft.username" name="ad_user" placeholder="user@example.com"
 />

                      <label>Password</label>
                      <div class="number-row" style="grid-template-columns: 1fr 32px;">
                        <input
                          [type]="passwordFieldVisible() ? 'text' : 'password'"
                          [(ngModel)]="accountDraft.password"
                          name="ad_pw"
                          placeholder="••••••••"
 />
                        <button class="ghost icon-btn" (click)="passwordFieldVisible.set(!passwordFieldVisible())" [title]="passwordFieldVisible() ? 'Hide' : 'Show'">
                          @if (passwordFieldVisible()) {
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                              <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/>
                              <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/>
                              <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/>
                              <line x1="2" y1="2" x2="22" y2="22"/>
                            </svg>
                          } @else {
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                              <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/>
                              <circle cx="12" cy="12" r="3"/>
                            </svg>
                          }
                        </button>
                      </div>

                      @if (accountError()) { <div class="error-msg">{{ accountError() }}</div> }
                      <div class="row" style="margin-top: 16px; gap: 8px;">
                        <button class="primary" (click)="saveAccount()" [disabled]="accountSaving()"
>
                          {{ accountSaving() ? 'Saving…' : (accountDraft.id ? 'Update' : 'Save account') }}
                        </button>
                        <button class="ghost" (click)="closeAccountForm()">Done</button>
                      </div>
                    </div>
                  }

                  @if (accounts().length === 0) {
                    <p class="muted">No accounts yet.</p>
                  } @else {
                    <div class="contact-list">
                      @for (acc of accounts(); track acc.id) {
                        <div class="contact-card" [class.expanded]="expandedAccount() === acc.id"
>
                          <div class="contact-head" (click)="toggleAccount(acc)">
                            <span class="caret">›</span>
                            <div class="contact-name">
                              <strong>{{ acc.account_name }}</strong>
                              @if (acc.username) { <span class="position">{{ acc.username }}</span> }
                            </div>
                            <span class="spacer"></span>
                            <button class="ghost icon-btn" (click)="editAccount(acc); $event.stopPropagation()" title="Edit"
>✎</button>
                            <button class="ghost icon-btn danger" (click)="deleteAccount(acc); $event.stopPropagation()" title="Delete"
>✕</button>
                          </div>
                          @if (expandedAccount() === acc.id) {
                            <div class="contact-body">
                              @if (acc.login_url) {
                                <div class="muted small">
                                  <span class="ic">↗</span>
                                  <a [href]="acc.login_url" target="_blank" rel="noopener">{{ acc.login_url }}</a>
                                </div>
                              }
                              @if (acc.username) {
                                <div class="muted small">
                                  <span class="ic">@</span>
                                  <span class="value">{{ acc.username }}</span>
                                  <button class="copy-btn" (click)="copyToClipboard(acc.username || ''); $event.stopPropagation()" title="Copy">⎘</button>
                                </div>
                              }
                              @if (acc.password) {
                                <div class="muted small">
                                  <span class="ic">⚿</span>
                                  <span class="value mono">{{ isPasswordShown(acc.id!) ? acc.password : '••••••••' }}</span>
                                  <button class="copy-btn" (click)="togglePasswordVisible(acc.id!); $event.stopPropagation()" [title]="isPasswordShown(acc.id!) ? 'Hide' : 'Show'">
                                    @if (isPasswordShown(acc.id!)) {
                                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/>
                                        <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/>
                                        <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/>
                                        <line x1="2" y1="2" x2="22" y2="22"/>
                                      </svg>
                                    } @else {
                                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/>
                                        <circle cx="12" cy="12" r="3"/>
                                      </svg>
                                    }
                                  </button>
                                  <button class="copy-btn" (click)="copyToClipboard(acc.password || ''); $event.stopPropagation()" title="Copy">⎘</button>
                                </div>
                              }
                            </div>
                          }
                        </div>
                      }
                    </div>
                  }
                }
                @case ('contracts') {
                  <div class="tab-head"><h3>Contracts</h3></div>
                  <app-entity-contracts audience="client" [entityId]="c.id!"></app-entity-contracts>
                }
                @case ('onboarding') {
                  <div class="tab-head">
                    <h3>Onboarding</h3>
                    <span class="spacer"></span>
                  </div>
                  <p class="muted small">
                    Every form + multipart-form submission linked to this client,
                    grouped by form. Click a submission to see the captured
                    fields. Detach removes the link but keeps the submission.
                  </p>
                  <app-form-submissions-list type="client" [recordId]="c.id!" />
                }
                @case ('feedback') {
                  <div class="tab-head">
                    <h3>Feedback</h3>
                    <span class="spacer"></span>
                  </div>

                  <!-- Inline attach: pick a published form from the
                       dropdown and click Attach. Options list is the
                       full published catalogue minus already-attached
                       forms so we can't create a duplicate row. -->
                  <div class="attach-row">
                    <select [(ngModel)]="feedbackToAttach" name="fb_attach">
                      <option [ngValue]="null">— pick a form to attach —</option>
                      @for (f of attachableFeedback(); track f.id) {
                        <option [ngValue]="f.id">{{ f.title }} ({{ f.kind }})</option>
                      }
                    </select>
                    <button class="primary"
                            [disabled]="!feedbackToAttach || attachingFeedback()"
                            (click)="attachFeedback(c.id!)"
>
                      {{ attachingFeedback() ? 'Attaching…' : 'Attach' }}
                    </button>
                    <a class="ghost small" routerLink="/admin/feedback">
                      Manage forms →
                    </a>
                  </div>

                  @if (loadingFeedback()) {
                    <p class="muted">Loading…</p>
                  } @else if (clientFeedback().length === 0) {
                    <p class="muted">No feedback forms linked to this client yet.</p>
                  } @else {
                    <div class="fb-list">
                      @for (group of clientFeedbackGroups(); track group.key) {
                        <div class="fb-section-head">
                          <span class="fb-section-title">{{ group.label }}</span>
                          <span class="muted small">· {{ group.forms.length }}</span>
                        </div>
                        @for (f of group.forms; track f.id) {
                        <div class="fb-row" [class.open]="expandedFeedback() === f.id"
>
                          <div class="fb-head" (click)="toggleFeedbackRow(f.id!)"
>
                            <span class="caret">›</span>
                            <div class="fb-meta">
                              <strong>{{ f.updated_at || f.created_at || '—' }}</strong>
                              <span class="fb-title">{{ f.title }}</span>
                              <span class="kind-pill" [attr.data-kind]="f.kind">{{ f.kind }}</span>
                              @if (group.key === 'service' && f.match_service_name) {
                                <span class="svc-tag">{{ f.match_service_name }}</span>
                              }
                            </div>
                            <span class="muted small">#{{ f.id }}</span>
                          </div>
                          @if (expandedFeedback() === f.id) {
                            <div class="fb-body">
                              @if (f.description) {
                                <p class="muted small" style="margin-top: 0;">{{ f.description }}</p>
                              }

                              @if (loadingFeedbackDetail()) {
                                <p class="muted small">Loading submissions…</p>
                              } @else if (feedbackDetailResponses().length === 0) {
                                <p class="muted small">This client hasn't submitted yet. Share the link to invite them.</p>
                              } @else {
                                <!-- Every response this client has made to this form,
                                     newest first. Each answer is labelled with its
                                     question so context is obvious inline. -->
                                @for (r of feedbackDetailResponses(); track r.id) {
                                  <div class="submission" [class.open]="isSubmissionOpen(r.id)">
                                    <div class="submission-head" (click)="toggleSubmission(r.id)">
                                      <span class="caret">›</span>
                                      <strong>{{ r.submitted_at }}</strong>
                                      @if (r.ip_address) { <span class="muted small">{{ r.ip_address }}</span> }
                                    </div>
                                    @if (isSubmissionOpen(r.id)) {
                                      @for (a of (r.answers || []); track a.id) {
                                        <div class="answer-row">
                                          <label>{{ feedbackQuestionLabel(a.question_id) }}</label>
                                          <div>{{ formatFeedbackAnswer(a.value) }}</div>
                                        </div>
                                      }
                                      @if ((r.answers || []).length === 0) {
                                        <p class="muted small">No answers recorded.</p>
                                      }
                                    }
                                  </div>
                                }
                              }

                              <div class="fb-actions">
                                <button class="ghost small" (click)="openFeedback(f); $event.stopPropagation()">Open builder →</button>
                                <button class="ghost small" (click)="copyFeedbackLink(f, c.id!, $event)">Copy link</button>
                                <span class="spacer"></span>
                                @if (group.key === 'client') {
                                  <button class="ghost small danger fb-detach"
                                          (click)="detachFeedback(f, c.id!, $event)"
                                          title="Detach — removes every link between this client and the form (junction + legacy + response tags).">✕ Detach</button>
                                } @else if (group.key === 'broadcast') {
                                  <span class="muted small">Broadcast — edit on form builder to disable.</span>
                                } @else if (group.key === 'service') {
                                  <span class="muted small">Via service — remove the client from the service to detach.</span>
                                }
                              </div>
                            </div>
                          }
                        </div>
                        }
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
                    <div class="contact-form">
                      <label>Title <span class="req">★</span></label>
                      <input [(ngModel)]="noteDraft.title" name="nd_title" placeholder="What's this note about?"
 />

                      <label>Body</label>
                      <textarea [(ngModel)]="noteDraft.body" name="nd_body" rows="6" placeholder="Type the note here…"
></textarea>

                      @if (noteError()) { <div class="error-msg">{{ noteError() }}</div> }
                      <div class="row" style="margin-top: 16px; gap: 8px;">
                        <button class="primary" (click)="saveNote()" [disabled]="noteSaving()"
>
                          {{ noteSaving() ? 'Saving…' : (noteDraft.id ? 'Update' : 'Save note') }}
                        </button>
                        <button class="ghost" (click)="closeNoteForm()">Done</button>
                      </div>
                    </div>
                  }

                  @if (notes().length === 0) {
                    <p class="muted">No notes yet.</p>
                  } @else {
                    <div class="contact-list">
                      @for (n of notes(); track n.id) {
                        <div class="contact-card" [class.expanded]="expandedNote() === n.id"
>
                          <div class="contact-head" (click)="toggleNote(n)">
                            <span class="caret">›</span>
                            <div class="contact-name">
                              <strong>{{ n.title }}</strong>
                              @if (n.updated_at) { <span class="position">{{ n.updated_at }}</span> }
                            </div>
                            <span class="spacer"></span>
                            <button class="ghost icon-btn" (click)="editNote(n); $event.stopPropagation()" title="Edit"
>✎</button>
                            <button class="ghost icon-btn danger" (click)="deleteNote(n); $event.stopPropagation()" title="Delete"
>✕</button>
                          </div>
                          @if (expandedNote() === n.id) {
                            <div class="contact-body">
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
      } @else {
        <div class="empty"><p class="muted">Loading…</p></div>
      }
    }

    @if (mode() === 'edit') {
      <div class="toolbar">
        <button class="ghost" (click)="back()">← Back</button>
        <h1>{{ isNew() ? 'New client' : 'Edit client' }}</h1>
        <span class="spacer"></span>
        @if (saving()) { <span class="muted small">Saving…</span> }
        @if (error()) { <span class="error-msg">{{ error() }}</span> }
        <button class="primary" (click)="save()" [disabled]="saving()">Save</button>
      </div>

      @if (formReady()) {
        <div class="layout">
          <section class="card">
            <h2>Client details</h2>

            <label>Name <span class="req">*</span></label>
            <input [(ngModel)]="draft.name" name="n" placeholder="Jane Doe" />

            <label>Email</label>
            <input type="email" [(ngModel)]="draft.email" name="e" placeholder="jane@example.com" />

            <label>Phone</label>
            <input [(ngModel)]="draft.phone" name="p" placeholder="+1 555 123 4567" />

            <label>Address</label>
            <textarea [(ngModel)]="draft.address" name="ad" rows="3" placeholder="Street, city, postcode"></textarea>

            <label>Company</label>
            <input [(ngModel)]="draft.company" name="co" placeholder="Acme Corp" />

            <label>Website</label>
            <input type="url" [(ngModel)]="draft.url" name="u" placeholder="https://example.com" />

            <label>Notes</label>
            <textarea [(ngModel)]="draft.notes" name="no" rows="5" placeholder="Anything worth remembering about this client…"></textarea>

            @if (!isNew()) {
              <hr />
              <button class="danger" (click)="delCurrent()" style="width:100%;">Delete client</button>
            }
          </section>
        </div>
      } @else {
        <div class="empty"><p class="muted">Loading…</p></div>
      }
    }
  `,
  styles: [`
    .layout { display: grid; grid-template-columns: 480px; gap: 20px; padding: 20px; }
    .layout-2col {
      display: grid;
      grid-template-columns: 380px 1fr;
      gap: 20px;
      padding: 20px;
      align-items: start;
    }
    @media (max-width: 1100px) { .layout-2col { grid-template-columns: 1fr; } }

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
    .tab-content .notes { white-space: pre-wrap; color: var(--fg); }

    .tab-head { display: flex; align-items: center; margin-bottom: 16px; }
    .tab-head h3 { margin: 0; }
    .tab-head .spacer { flex: 1; }

    .attach-row { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
    .attach-row select { flex: 1; }
    .attach-row a { padding: 6px 10px; font-size: 12px; }

    /* Feedback tab — card-list matching the response-viewer look:
       collapsed row shows date/time + title + kind tag + form id,
       clicking anywhere on the head expands to reveal actions. */
    .fb-list { display: flex; flex-direction: column; gap: 6px; }
    .fb-section-head { display: flex; align-items: baseline; gap: 8px;
      margin: 14px 0 4px; padding: 0; }
    .fb-list > .fb-section-head:first-child { margin-top: 0; }
    .fb-section-title { color: var(--muted); font-size: 11px;
      text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700; }
    .svc-tag { padding: 2px 8px; border-radius: 999px;
      font-size: 11px; font-weight: 600;
      background: color-mix(in oklab, var(--primary), transparent 82%);
      color: var(--primary); white-space: nowrap; }
    .fb-row  { border: 1px solid var(--line); border-radius: var(--radius-sm);
      background: var(--bg); overflow: hidden; }
    .fb-head { display: flex; align-items: center; gap: 10px;
      padding: 10px 14px; cursor: pointer; }
    .fb-head:hover { background: var(--bg-2); }
    .fb-head .caret { display: inline-block; transition: transform .12s;
      color: var(--muted); font-size: 14px; }
    .fb-row.open .fb-head .caret { transform: rotate(90deg); }
    .fb-meta { flex: 1; display: flex; align-items: center; gap: 10px;
      min-width: 0; }
    .fb-meta strong { font-variant-numeric: tabular-nums; }
    .fb-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .kind-pill { padding: 2px 10px; border-radius: 999px;
      font-size: 11px; font-weight: 600; letter-spacing: 0.3px;
      background: var(--bg-3); color: var(--muted); text-transform: capitalize; }
    .kind-pill[data-kind="questionnaire"] { background: color-mix(in oklab, #8aa9ff, transparent 80%); color: #8aa9ff; }
    .kind-pill[data-kind="form"]          { background: color-mix(in oklab, var(--primary), transparent 78%); color: var(--primary); }
    .kind-pill[data-kind="survey"]        { background: color-mix(in oklab, var(--success), transparent 78%); color: var(--success); }
    .kind-pill[data-kind="poll"]          { background: color-mix(in oklab, var(--warning), transparent 78%); color: var(--warning); }

    .fb-body { padding: 10px 14px 14px; border-top: 1px solid var(--line);
      background: var(--bg-2); }
    .fb-actions { display: flex; gap: 8px; align-items: center; margin-top: 10px;
      padding-top: 10px; border-top: 1px dashed var(--line); }
    .fb-actions .spacer { flex: 1; }
    .fb-actions button { white-space: nowrap; }

    /* Individual submission card inside an expanded feedback row —
       one per client submission. Answer rows use the same label +
       value shape as the builder's response viewer for consistency. */
    .submission { padding: 8px 0; border-top: 1px solid var(--line); }
    .submission:first-of-type { border-top: 0; padding-top: 0; }
    .submission-head { display: flex; align-items: center; gap: 10px;
      cursor: pointer; user-select: none; padding: 4px 0; }
    .submission-head:hover strong { color: var(--primary); }
    .submission-head strong { font-variant-numeric: tabular-nums;
      transition: color .12s; }
    .submission-head .caret { display: inline-block; transition: transform .12s;
      color: var(--muted); font-size: 14px; }
    .submission.open .submission-head { margin-bottom: 6px; }
    .submission.open .submission-head .caret { transform: rotate(90deg); }
    .answer-row { padding: 4px 0; }
    .answer-row label { display: block; color: var(--muted);
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
      margin: 0 0 3px 0; }

    /* ----- Services tab ------------------------------------------------ */
    .totals-grid {
      display: grid; grid-template-columns: repeat(4, 1fr);
      gap: 12px; margin-bottom: 16px;
    }
    @media (max-width: 1100px) { .totals-grid { grid-template-columns: repeat(2, 1fr); } }
    .total-card {
      background: var(--bg-3);
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      padding: 12px 14px;
    }
    .total-label {
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
      color: var(--muted); margin-bottom: 6px;
    }
    .total-value { font-size: 18px; font-weight: 600; color: var(--fg); }
    /* Services slot-list — matches the project's slot pattern (used in /me/* and HR Documents).
       Each row is a card; the price/monthly chip lives on the right and a 4-cell
       breakdown grid (Started / Contract / To date / Incoming) sits below. */
    .services-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .services-list .slot { background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
    .services-list .slot.filled  { border-left: 3px solid var(--primary); }
    .services-list .slot.missing { border-left: 3px solid var(--muted); opacity: 0.85; }
    .services-list .slot-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; cursor: pointer; user-select: none; }
    .services-list .slot-head .spacer { flex: 1; }
    .services-list .slot-head .caret {
      color: var(--muted); transition: transform 0.15s; flex-shrink: 0;
      width: 12px; text-align: center;
    }
    .services-list .slot.expanded .slot-head .caret { transform: rotate(90deg); color: var(--primary); }

    .service-items {
      margin-top: 12px; padding-top: 12px;
      border-top: 1px solid var(--line);
    }
    .items-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .items-head .spacer { flex: 1; }
    .items-list {
      list-style: none; padding: 0; margin: 0;
      display: flex; flex-direction: column; gap: 4px;
    }
    .items-list li {
      display: flex; align-items: center; gap: 10px;
      padding: 6px 10px;
      background: var(--bg-3); border: 1px solid var(--line);
      border-radius: var(--radius-sm); font-size: 13px;
    }
    .items-list .type-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .items-list .it-id { color: var(--muted); font-size: 12px; min-width: 36px; }
    .items-list .it-title { color: var(--fg); text-decoration: none; }
    .items-list .it-title:hover { color: var(--primary); }
    .items-list .it-state {
      padding: 1px 8px; border-radius: 999px;
      font-size: 11px; border: 1px solid var(--line);
      white-space: nowrap;
    }
    .items-list .spacer { flex: 1; }

    /* Onboarding-captured block inside an expanded service row. */
    .service-onboarding {
      margin-top: 12px; padding-top: 12px;
      border-top: 1px dashed var(--line);
    }
    .ob-form {
      display: flex; align-items: center; gap: 10px;
      margin: 4px 0;
    }
    .ob-form strong { font-size: 13px; }
    .ob-form-type {
      padding: 2px 8px; border-radius: 999px;
      background: var(--bg-3); color: var(--muted);
      font-size: 10px; font-weight: 700; letter-spacing: 0.5px;
      text-transform: uppercase; white-space: nowrap;
    }
    .ob-form-type.multipart {
      background: color-mix(in oklab, var(--primary), transparent 78%);
      color: var(--primary);
    }
    .ob-subs {
      list-style: none; padding: 0; margin: 0 0 6px;
      display: flex; flex-direction: column; gap: 4px;
    }
    .ob-subs li {
      background: var(--bg-3); border-radius: var(--radius-sm);
      overflow: hidden;
    }
    .ob-toggle {
      display: flex; align-items: center; gap: 10px;
      width: 100%; padding: 6px 10px;
      background: transparent; border: none; color: var(--fg);
      cursor: pointer; text-align: left; font: inherit; font-size: 12px;
    }
    .ob-toggle:hover { background: color-mix(in oklab, var(--primary), transparent 92%); }
    .ob-caret { width: 12px; opacity: 0.6; }
    .ob-when { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 12px; }
    .ob-required {
      padding: 1px 8px; border-radius: 999px;
      font-size: 10px; font-weight: 600; letter-spacing: 0.3px;
      background: var(--bg); color: var(--muted);
      border: 1px solid var(--line);
    }
    .ob-fields {
      width: 100%; border-collapse: collapse;
      padding: 6px 10px 8px; font-size: 12px;
      background: var(--bg);
    }
    .ob-fields th, .ob-fields td {
      padding: 4px 10px; border-bottom: 1px dashed var(--line);
      vertical-align: top;
    }
    .ob-fields th {
      color: var(--muted); font-weight: 600; text-align: left; width: 30%; white-space: nowrap;
    }
    .ob-fields td { color: var(--fg); word-break: break-word; }
    .services-list .pill {
      padding: 1px 6px; border-radius: 4px; font-size: 10px;
      text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      border: 1px solid var(--line); color: var(--muted);
    }
    .services-list .pill.active { color: var(--primary); border-color: var(--primary); background: rgba(212,169,58,0.12); }
    .services-list .pill.ended  { color: var(--muted); }
    /* Project-status pill colors (056). Pill has a [data-pstatus] attr per service. */
    .services-list .pill[data-pstatus="new"]      { color: var(--primary); border-color: var(--primary); background: rgba(212,169,58,0.12); }
    .services-list .pill[data-pstatus="ongoing"]  { color: #56c98a; border-color: #56c98a; background: rgba(86,201,138,0.12); }
    .services-list .pill[data-pstatus="testing"]  { color: #60a5fa; border-color: #60a5fa; background: rgba(96,165,250,0.12); }
    .services-list .pill[data-pstatus="blocked"]  { color: var(--danger); border-color: var(--danger); background: rgba(255,100,100,0.10); }
    .services-list .pill[data-pstatus="complete"] { color: var(--muted); border-color: var(--line); }
    .services-list .pill[data-pstatus="none"]     { color: var(--muted); border-style: dashed; }
    .services-list .pill[data-pstatus="catalog"]  { color: var(--primary); border-color: var(--primary); background: rgba(212,169,58,0.12); }
    /* Catalogue rows have no expand caret — pull the title back to the edge. */
    .services-list .slot-head.no-caret { cursor: default; }
    .services-list .terms-pill {
      padding: 2px 8px; border-radius: 4px; font-size: 12px;
      background: var(--bg-3); border: 1px solid var(--line); color: var(--fg);
    }
    .services-list .monthly-chip {
      padding: 2px 10px; border-radius: 4px; font-size: 13px;
      background: rgba(212, 169, 58, 0.12); color: var(--primary);
      border: 1px solid var(--primary);
    }
    .service-breakdown {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px;
      padding-top: 8px; border-top: 1px solid var(--line);
    }
    .service-breakdown > span { display: flex; flex-direction: column; gap: 2px; }
    .service-breakdown .k { color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }

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

    .contact-form {
      padding: 16px;
      background: var(--bg-3);
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      margin-bottom: 16px;
    }
    .contact-form label { margin-top: 12px; display: block; }
    .contact-form .req { color: var(--primary); margin-left: 4px; }
    .contact-form .row.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .number-row {
      display: grid;
      grid-template-columns: 1fr 140px 32px;
      gap: 8px;
      margin-top: 8px;
      align-items: center;
    }
    .number-row .num-label { font-size: 13px; }

    .contact-list { display: flex; flex-direction: column; gap: 12px; }
    .contact-card {
      background: var(--bg-3);
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      overflow: hidden;
      transition: border-color 0.15s;
    }
    .contact-card:hover { border-color: var(--primary); }
    .contact-card.primary { border-color: var(--primary); border-left-width: 3px; }
    .make-primary { color: var(--primary); }
    .contact-head {
      display: flex; align-items: center; gap: 8px;
      padding: 12px 14px;
      cursor: pointer;
      user-select: none;
    }
    .contact-head .caret {
      color: var(--muted);
      transition: transform 0.2s;
      flex-shrink: 0;
    }
    .contact-card.expanded .contact-head .caret { transform: rotate(90deg); }
    .contact-head .spacer { flex: 1; }
    .contact-name { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .contact-name strong { font-size: 14px; line-height: 1.2; }
    .contact-name .position {
      color: var(--primary);
      font-size: 12px;
      font-style: italic;
      letter-spacing: 0.2px;
      line-height: 1.2;
    }

    .contact-body {
      padding: 0 14px 14px 14px;
      border-top: 1px solid var(--line);
      padding-top: 12px;
      display: flex; flex-direction: column; gap: 4px;
    }
    .contact-body .ic {
      display: inline-block;
      color: var(--primary);
      width: 18px;
      text-align: center;
      margin-right: 4px;
    }
    .contact-card a { color: var(--fg); text-decoration: none; }
    .contact-card a:hover { color: var(--primary); }
    .contact-body .value { color: var(--fg); margin-right: 6px; }
    .contact-body .value.mono { font-family: "JetBrains Mono", monospace; letter-spacing: 0.5px; }
    .contact-body > div {
      display: flex; align-items: center; gap: 6px;
      min-height: 22px;
    }
    .contact-body .copy-btn {
      display: inline-flex; align-items: center; justify-content: center;
      background: transparent; border: none; color: var(--muted);
      padding: 0 4px; cursor: pointer; font-size: 14px; line-height: 1;
    }
    .contact-body .copy-btn:hover { color: var(--primary); background: transparent; border-color: transparent; }
    .contact-body svg { display: block; }
    .note-body {
      white-space: pre-wrap;
      color: var(--fg);
      margin: 0;
      line-height: 1.6;
    }
    .card h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); margin: 0 0 12px 0; font-weight: 600; }
    .card label { margin-top: 12px; }
    .card hr { border: none; border-top: 1px solid var(--line); margin: 20px 0 16px 0; }
    .req { color: var(--primary); margin-left: 2px; }
    .kv { margin-bottom: 14px; }
    .kv label {
      display: block; color: var(--muted); font-size: 11px;
      text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 4px 0;
    }
    .kv > div { color: var(--fg); font-size: 14px; word-break: break-word; }
    .kv .notes { white-space: pre-wrap; }
    td.actions { text-align: right; white-space: nowrap; }
    td.actions .icon-btn + .icon-btn { margin-left: 4px; }
    .icon-btn {
      width: 32px; height: 32px; padding: 0;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 15px; line-height: 1;
    }
    .icon-btn:hover { color: var(--primary); border-color: var(--primary); }
    .icon-btn.danger:hover { color: var(--danger); border-color: var(--danger); background: rgba(255,100,100,0.08); }
    /* Send-back-to-leads action. Distinct hue from the danger ✕ so the
       two buttons don't look interchangeable at a glance. */
    .icon-btn.relegate { color: #60a5fa; }
    .icon-btn.relegate:hover { color: #60a5fa; border-color: #60a5fa; background: rgba(96, 165, 250, 0.10); }
  `],
})
export class ClientsAdmin {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private dialog = inject(DialogService);

  mode = signal<'list' | 'view' | 'edit'>('list');
  isNew = signal(false);
  saving = signal(false);
  error = signal<string | null>(null);
  clients = signal<Client[]>([]);
  current = signal<Client | null>(null);
  /** Becomes true once draft is ready to bind — prevents ngModel from latching
   *  onto stale empty values before the GET resolves. */
  formReady = signal(false);

  readonly tabs: { key: TabKey; label: string }[] = [
    { key: 'info',       label: 'Info' },
    { key: 'contacts',   label: 'Contacts' },
    { key: 'services',   label: 'Services' },
    { key: 'accounts',   label: 'Accounts' },
    { key: 'contracts',  label: 'Contracts' },
    { key: 'onboarding', label: 'Onboarding' },
    { key: 'feedback',   label: 'Feedback' },
    { key: 'notes',      label: 'Notes' },
  ];
  activeTab = signal<TabKey>('info');

  // Feedback tab state — forms with client_id = current client, loaded lazily
  // the first time the tab is opened per detail view.
  clientFeedback     = signal<FeedbackForm[]>([]);
  loadingFeedback    = signal(false);
  allFeedbackForms   = signal<FeedbackForm[]>([]);
  feedbackToAttach: number | null = null;
  attachingFeedback  = signal(false);
  /** Currently-expanded feedback row on the tab (form id, or null). */
  expandedFeedback   = signal<number | null>(null);
  /** Questions (labels) + responses for the currently-expanded form.
   *  Loaded lazily on toggle so we don't fan out API calls per row. */
  feedbackDetailQuestions = signal<FeedbackQuestion[]>([]);
  feedbackDetailResponses = signal<FeedbackResponse[]>([]);
  loadingFeedbackDetail   = signal(false);
  private feedbackLoadedForClient: number | null = null;

  toggleFeedbackRow(id: number) {
    if (this.expandedFeedback() === id) {
      this.expandedFeedback.set(null);
      return;
    }
    this.expandedFeedback.set(id);
    this.loadFeedbackDetail(id);
    this.openSubmissions.set(new Set());
  }

  /** Per-submission expand state — default collapsed. */
  openSubmissions = signal<Set<number>>(new Set<number>());
  isSubmissionOpen(id: number): boolean { return this.openSubmissions().has(id); }
  toggleSubmission(id: number) {
    this.openSubmissions.update(set => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  /** Load form questions + this-client-only responses so the expanded
   *  row can render answers inline. Two-request pattern: questions
   *  come with the form, responses hit the ?client=N filter. */
  private loadFeedbackDetail(formId: number) {
    const clientId = this.current()?.id;
    if (!clientId) return;
    this.loadingFeedbackDetail.set(true);
    this.feedbackDetailResponses.set([]);
    this.feedbackDetailQuestions.set([]);
    this.api.getFeedbackForm(formId).subscribe({
      next: r => this.feedbackDetailQuestions.set(r.questions ?? []),
    });
    this.api.listFeedbackResponses(formId, { client: clientId }).subscribe({
      next: r => {
        this.feedbackDetailResponses.set(r.responses ?? []);
        this.loadingFeedbackDetail.set(false);
      },
      error: () => this.loadingFeedbackDetail.set(false),
    });
  }

  feedbackQuestionLabel(qid: number): string {
    return this.feedbackDetailQuestions().find(q => q.id === qid)?.label ?? `Q#${qid}`;
  }

  /** Multi-choice answers are stored as JSON arrays; unpack for display. */
  formatFeedbackAnswer(value: string | null): string {
    const raw = (value ?? '').toString();
    if (!raw) return '—';
    if (raw.startsWith('[') && raw.endsWith(']')) {
      try {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) return arr.length ? arr.join(', ') : '—';
      } catch {}
    }
    return raw;
  }

  /** Attach dropdown = published forms not already attached to this client. */
  attachableFeedback = () => {
    const attached = new Set(this.clientFeedback().map(f => f.id));
    return this.allFeedbackForms().filter(f => !attached.has(f.id));
  };

  /** Split the flat feedback list into three sections keyed off the
   *  backend's match_source annotation. Empty groups are dropped so
   *  the header + row doesn't render for a bucket with nothing in it. */
  clientFeedbackGroups(): { key: string; label: string; forms: FeedbackForm[] }[] {
    const forms = this.clientFeedback();
    const client    = forms.filter(f => f.match_source === 'client'    || !f.match_source);
    const service   = forms.filter(f => f.match_source === 'service');
    const broadcast = forms.filter(f => f.match_source === 'broadcast');
    const groups: { key: string; label: string; forms: FeedbackForm[] }[] = [];
    if (client.length)    groups.push({ key: 'client',    label: 'Client-specific',    forms: client });
    if (service.length)   groups.push({ key: 'service',   label: 'Via a service',      forms: service });
    if (broadcast.length) groups.push({ key: 'broadcast', label: 'Default — all clients', forms: broadcast });
    return groups;
  }

  onTabClick(key: TabKey, clientId: number) {
    this.activeTab.set(key);
    if (key === 'feedback') this.loadFeedback(clientId);
  }

  loadFeedback(clientId: number) {
    if (this.feedbackLoadedForClient === clientId) return;
    this.feedbackLoadedForClient = clientId;
    this.loadingFeedback.set(true);
    this.api.listFeedbackForms({ client: clientId }).subscribe({
      next: r => { this.clientFeedback.set(r.forms ?? []); this.loadingFeedback.set(false); },
      error: () => { this.clientFeedback.set([]); this.loadingFeedback.set(false); },
    });
    // Populate the attach dropdown with every published form so the
    // user can pick from the catalogue. Published-only — you can't
    // share a draft.
    if (this.allFeedbackForms().length === 0) {
      this.api.listFeedbackForms({ published: 1 } as any).subscribe({
        next: r => this.allFeedbackForms.set(r.forms ?? []),
      });
    }
  }

  attachFeedback(clientId: number) {
    const fid = this.feedbackToAttach;
    if (!fid) return;
    this.attachingFeedback.set(true);
    this.api.attachFeedbackFormToClient(fid, clientId).subscribe({
      next: () => {
        this.attachingFeedback.set(false);
        this.feedbackToAttach = null;
        this.feedbackLoadedForClient = null;
        this.loadFeedback(clientId);
      },
      error: () => this.attachingFeedback.set(false),
    });
  }

  async detachFeedback(f: FeedbackForm, clientId: number, e: Event) {
    e.stopPropagation();
    if (!f.id) return;
    const ok = await this.dialog.confirm(
      `Detach "${f.title}" from this client?`,
      { title: 'Detach form', confirmLabel: 'Detach', variant: 'warning' }
    );
    if (!ok) return;
    this.api.detachFeedbackFormFromClient(f.id, clientId).subscribe(() => {
      this.feedbackLoadedForClient = null;
      this.loadFeedback(clientId);
    });
  }

  openFeedback(f: FeedbackForm) {
    if (!f.id) return;
    this.router.navigate(['/admin/feedback', f.id]);
  }

  copyFeedbackLink(f: FeedbackForm, clientId: number, e: Event) {
    e.stopPropagation();
    // Attribution scheme: `?id=c{N}` for clients, `?id=l{N}` for leads,
    // `?id=0` for anonymous / public share. Public API parses the prefix
    // to tag the response row.
    const url = `${window.location.origin}${environment.basePath}/feedback/${f.public_token}?id=c${clientId}`;
    navigator.clipboard.writeText(url);
  }

  // Contacts tab state
  contacts = signal<ClientContact[]>([]);
  contactFormOpen = signal(false);
  contactSaving = signal(false);
  contactError = signal<string | null>(null);
  contactDraft: ClientContact = { first_name: '', last_name: '', position: '', email: '', verified: false, numbers: [] };
  contactNumbers = signal<{ number: string; label: string }[]>([]);
  expandedContact = signal<number | null>(null);

  toggleContact(c: ClientContact) {
    if (!c.id) return;
    this.expandedContact.set(this.expandedContact() === c.id ? null : c.id);
  }

  /** Looks up the primary contact in the loaded contacts list. The basic-info
   *  card pulls Name/Email/Phone from this contact, falling back to the
   *  legacy `clients.name/email/phone` columns when no primary is loaded
   *  (e.g. before the contacts list has fetched, or for a freshly created
   *  client). */
  primaryContact(): ClientContact | null {
    return this.contacts().find(c => !!c.is_primary) ?? null;
  }
  primaryContactName(c: Client): string {
    const p = this.primaryContact();
    if (p) {
      const full = `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim();
      if (full) return full;
    }
    return c.name;
  }
  primaryContactEmail(c: Client): string | null {
    return this.primaryContact()?.email ?? c.email ?? null;
  }
  primaryContactPhone(): string | null {
    const p = this.primaryContact();
    const num = p?.numbers?.[0]?.number;
    return num ?? this.current()?.phone ?? null;
  }

  // Accounts tab state
  accounts = signal<ClientAccount[]>([]);
  accountFormOpen = signal(false);
  accountSaving = signal(false);
  accountError = signal<string | null>(null);
  accountDraft: ClientAccount = { account_name: '', login_url: '', username: '', password: '' };
  expandedAccount = signal<number | null>(null);
  /** Account ids whose password is currently revealed in the view. */
  shownPasswords = signal<Set<number>>(new Set());
  passwordFieldVisible = signal(false);

  toggleAccount(a: ClientAccount) {
    if (!a.id) return;
    this.expandedAccount.set(this.expandedAccount() === a.id ? null : a.id);
  }

  // Notes tab state
  notes = signal<ClientNote[]>([]);
  noteFormOpen = signal(false);
  noteSaving = signal(false);
  noteError = signal<string | null>(null);
  noteDraft: ClientNote = { title: '', body: '' };
  expandedNote = signal<number | null>(null);

  // Info tab state — name/value pairs displayed as kv list.
  infoEntries = signal<ClientInfo[]>([]);
  infoFormOpen = signal(false);
  infoSaving = signal(false);
  infoError = signal<string | null>(null);
  infoDraft: ClientInfo = { name: '', value: '' };

  // Services tab state — onboarding services this client is signed up for.
  services = signal<ClientService[]>([]);
  servicesTotals = signal<ClientServicesTotals | null>(null);

  // "+ Add service" — picks a Services-attached onboarding form and creates
  // a new instance for this client (invite + qualify + auto-project) in one
  // request. Picking the same form twice deliberately produces two separate
  // instances so a client can have multiple of the same service.
  serviceForms = signal<FormDef[]>([]);
  serviceOfferings = signal<ServiceOffering[]>([]);
  addServiceOpen = signal(false);
  // Encoded selection: 'svc:<id>' = catalogue service, 'form:<id>' = onboarding.
  addServiceSel: string | null = null;
  addServiceSaving = signal(false);
  addServiceError = signal<string | null>(null);

  // Collapsible service rows — keyed by onboarding_client_id (per memory.md
  // collapsible-section pattern: Set signal + caret + conditional body).
  // Items are cached by project_id once fetched so re-expanding is instant.
  /** Keyed by ClientService.row_key so both onboarding + catalog rows
   *  can expand. Previously keyed by onboarding_client_id (numeric),
   *  which meant catalog rows couldn't expand at all. */
  expandedServices = signal<Set<string>>(new Set());
  serviceItems = signal<Map<number, TaskItem[]>>(new Map());
  serviceItemsLoading = signal<Set<number>>(new Set());

  /** Onboarding submissions grouped by service_offering_id, so a
   *  catalog service row can display "the onboarding data captured
   *  for this client on this service" without hitting the API again.
   *  Loaded once alongside the Services tab data. */
  clientSubmissionsBySvc = signal<Map<number, FormSubmissionLinkGroup[]>>(new Map());
  /** Which submission (link_id) is currently open under a service row. */
  openServiceSubs = signal<Set<number>>(new Set());

  isServiceExpanded(rowKey: string): boolean {
    return this.expandedServices().has(rowKey);
  }
  /** Any onboarding data captured for this catalog service row? */
  hasLinkedOnboarding(s: ClientService): boolean {
    const sid = s.service_offering_id;
    if (sid == null) return false;
    const g = this.clientSubmissionsBySvc().get(sid);
    return !!g && g.length > 0;
  }
  /** Groups (form → submissions) for the row's linked onboarding. */
  linkedOnboardingFor(s: ClientService): FormSubmissionLinkGroup[] {
    const sid = s.service_offering_id;
    if (sid == null) return [];
    return this.clientSubmissionsBySvc().get(sid) ?? [];
  }
  /** True when the row has expansion content — either work items
   *  (onboarding rows with a project) OR linked onboarding data
   *  (catalog rows). Drives caret visibility + click behaviour. */
  isExpandable(s: ClientService): boolean {
    if (s.kind === 'onboarding') return true;
    return this.hasLinkedOnboarding(s);
  }
  toggleService(s: ClientService) {
    if (!this.isExpandable(s)) return;
    const cur = new Set(this.expandedServices());
    if (cur.has(s.row_key)) {
      cur.delete(s.row_key);
    } else {
      cur.add(s.row_key);
      // Onboarding rows: lazy-load work items the first time.
      if (s.kind === 'onboarding') {
        const pid = s.project_id;
        if (pid && !this.serviceItems().has(pid) && !this.serviceItemsLoading().has(pid)) {
          const loading = new Set(this.serviceItemsLoading()); loading.add(pid);
          this.serviceItemsLoading.set(loading);
          this.api.listTaskItems({ project_id: pid }).subscribe({
            next: r => {
              const map = new Map(this.serviceItems()); map.set(pid, r.items);
              this.serviceItems.set(map);
              const ld = new Set(this.serviceItemsLoading()); ld.delete(pid);
              this.serviceItemsLoading.set(ld);
            },
            error: () => {
              const map = new Map(this.serviceItems()); map.set(pid, []);
              this.serviceItems.set(map);
              const ld = new Set(this.serviceItemsLoading()); ld.delete(pid);
              this.serviceItemsLoading.set(ld);
            },
          });
        }
      }
    }
    this.expandedServices.set(cur);
  }

  toggleServiceSub(linkId: number, ev: Event) {
    ev.stopPropagation();
    const cur = new Set(this.openServiceSubs());
    if (cur.has(linkId)) cur.delete(linkId); else cur.add(linkId);
    this.openServiceSubs.set(cur);
  }
  isServiceSubOpen(linkId: number): boolean {
    return this.openServiceSubs().has(linkId);
  }
  submissionRows(data: Record<string, any> | null): { key: string; value: any }[] {
    if (!data) return [];
    const skip = new Set(['ip_address', 'submitted_at', 'created_at', 'updated_at']);
    return Object.entries(data)
      .filter(([k, v]) => !skip.has(k) && v !== null && v !== '')
      .map(([key, value]) => ({ key, value }));
  }
  prettyFieldName(k: string): string {
    return k.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
  }
  formatValue(v: any): string {
    if (v == null) return '—';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }

  formatMoney(v: number | null | undefined): string {
    if (v === null || v === undefined) return '—';
    const n = Number(v);
    if (!isFinite(n)) return '—';
    return n.toLocaleString(undefined, { style: 'currency', currency: 'GBP' });
  }

  /** Strip the time portion off a "YYYY-MM-DD HH:MM:SS" datetime string so
   *  the Started column doesn't wrap over three lines. */
  formatDate(v: string | null | undefined): string {
    if (!v) return '—';
    return v.length >= 10 ? v.slice(0, 10) : v;
  }

  /** Human-friendly label for the linked task project's status. */
  projectStatusLabel(s: string | null | undefined): string {
    switch (s) {
      case 'new':      return 'New';
      case 'ongoing':  return 'Ongoing';
      case 'testing':  return 'Testing';
      case 'blocked':  return 'Blocked';
      case 'complete': return 'Complete';
      default:         return s || '—';
    }
  }

  toggleNote(n: ClientNote) {
    if (!n.id) return;
    this.expandedNote.set(this.expandedNote() === n.id ? null : n.id);
  }
  togglePasswordVisible(id: number) {
    const cur = new Set(this.shownPasswords());
    if (cur.has(id)) cur.delete(id); else cur.add(id);
    this.shownPasswords.set(cur);
  }
  isPasswordShown(id: number): boolean { return this.shownPasswords().has(id); }
  copyToClipboard(text: string) { navigator.clipboard?.writeText(text || ''); }

  draft: Client = { name: '', email: '', phone: '', address: '', company: '', url: '', notes: '' };

  ngOnInit() {
    // The same component is reused across all four URL shapes; re-detect on every
    // route change so view ↔ edit ↔ list switches refresh state correctly.
    // `route.url` is backed by a ReplaySubject(1) — it emits the current URL
    // to new subscribers immediately, so a separate `detectMode()` call here
    // would fire every loader twice on first paint (was: 12 parallel requests
    // on a client detail view; now 6).
    this.route.url.subscribe(() => this.detectMode());
  }

  private resetDraft() {
    // Mutate the same object reference so ngModel bindings stay attached to it
    // and pick up the new values via change detection.
    Object.assign(this.draft, { id: undefined, name: '', email: '', phone: '', address: '', company: '', url: '', notes: '' });
  }

  private detectMode() {
    const url = this.router.url;
    this.error.set(null);
    this.current.set(null);
    this.formReady.set(false);
    if (/\/admin\/clients\/new(\?|$)/.test(url)) {
      this.resetDraft();
      this.mode.set('edit');
      this.isNew.set(true);
      this.formReady.set(true);
      return;
    }
    const editMatch = url.match(/\/admin\/clients\/(\d+)\/edit/);
    if (editMatch) {
      this.mode.set('edit');
      this.isNew.set(false);
      this.api.getClient(+editMatch[1]).subscribe({
        next: r => {
          Object.assign(this.draft, r.client);
          this.formReady.set(true);
        },
        error: e => this.error.set(e?.error?.error || 'Failed to load client'),
      });
      return;
    }
    const viewMatch = url.match(/\/admin\/clients\/(\d+)/);
    if (viewMatch) {
      const cid = +viewMatch[1];
      this.mode.set('view');
      this.isNew.set(false);
      this.api.getClient(cid).subscribe({
        next: r => this.current.set(r.client),
        error: e => this.error.set(e?.error?.error || 'Failed to load client'),
      });
      this.loadContacts(cid);
      this.loadAccounts(cid);
      this.loadNotes(cid);
      this.loadInfoEntries(cid);
      this.loadServices(cid);
      this.activeTab.set('info');
      this.closeContactForm();
      this.closeAccountForm();
      this.closeNoteForm();
      this.closeInfoForm();
      return;
    }
    this.mode.set('list');
    this.api.listClients().subscribe(r => this.clients.set(r.clients));
  }

  view(c: Client, e?: Event) {
    e?.stopPropagation();
    this.router.navigate(['/admin/clients', c.id]);
  }
  edit(c: Client, e?: Event) {
    e?.stopPropagation();
    this.router.navigate(['/admin/clients', c.id, 'edit']);
  }
  goEdit() {
    const id = this.current()?.id ?? this.draft.id;
    if (!id) return;
    this.router.navigate(['/admin/clients', id, 'edit']);
  }

  async del(c: Client, e: Event) {
    e.stopPropagation();
    const ok = await this.dialog.confirm(
      `Delete "${c.name}"?`,
      { title: 'Delete client', confirmLabel: 'Delete', variant: 'danger' }
    );
    if (!ok) return;
    this.api.deleteClient(c.id!).subscribe(() => this.api.listClients().subscribe(r => this.clients.set(r.clients)));
  }
  async delCurrent() {
    const c = this.current() ?? this.draft;
    if (!c.id) return;
    const ok = await this.dialog.confirm(
      `Delete "${c.name}"?`,
      { title: 'Delete client', confirmLabel: 'Delete', variant: 'danger' }
    );
    if (!ok) return;
    this.api.deleteClient(c.id).subscribe(() => this.router.navigateByUrl('/admin/clients'));
  }

  /** Demote a client back into the leads pipeline. Mirrors `del` for the
   *  list row — the underlying endpoint copies the basic fields into a
   *  new leads row, then deletes the client (FK cascades sub-tables). */
  async relegate(c: Client, e: Event) {
    e.stopPropagation();
    if (!c.id) return;
    const ok = await this.dialog.confirm(
      `Send "${c.name}" back to leads? Their contacts, accounts and services on this client will be discarded.`,
      { title: 'Send back to leads', confirmLabel: 'Send back', variant: 'warning' }
    );
    if (!ok) return;
    this.api.relegateClientToLead(c.id).subscribe({
      next: r => this.router.navigate(['/admin/leads', r.lead_id]),
      error: err => this.dialog.alert(
        err?.error?.error || 'Failed to relegate',
        { title: 'Relegate failed', variant: 'danger' }
      ),
    });
  }
  /** Same action triggered from the client-detail toolbar. */
  async relegateCurrent() {
    const c = this.current() ?? this.draft;
    if (!c.id) return;
    const ok = await this.dialog.confirm(
      `Send "${c.name}" back to leads? Their contacts, accounts and services on this client will be discarded.`,
      { title: 'Send back to leads', confirmLabel: 'Send back', variant: 'warning' }
    );
    if (!ok) return;
    this.api.relegateClientToLead(c.id).subscribe({
      next: r => this.router.navigate(['/admin/leads', r.lead_id]),
      error: err => this.dialog.alert(
        err?.error?.error || 'Failed to relegate',
        { title: 'Relegate failed', variant: 'danger' }
      ),
    });
  }

  save() {
    this.error.set(null);
    if (!this.draft.name?.trim()) { this.error.set('Name is required'); return; }
    this.saving.set(true);
    const handler = {
      next: () => { this.saving.set(false); this.router.navigateByUrl('/admin/clients'); },
      error: (e: any) => { this.saving.set(false); this.error.set(e?.error?.error || 'Save failed'); },
    };
    if (this.isNew()) this.api.createClient(this.draft).subscribe(handler);
    else this.api.updateClient(this.draft.id!, this.draft).subscribe(handler);
  }

  back() { this.router.navigateByUrl('/admin/clients'); }

  // ----- Contacts -----
  private loadContacts(clientId: number) {
    this.api.listClientContacts(clientId).subscribe(r => this.contacts.set(r.contacts));
  }
  toggleContactForm() {
    if (this.contactFormOpen()) this.closeContactForm();
    else this.openContactForm();
  }
  openContactForm() {
    this.contactDraft = { first_name: '', last_name: '', position: '', email: '', verified: false, numbers: [] };
    this.contactNumbers.set([]);
    this.contactError.set(null);
    this.contactFormOpen.set(true);
  }
  closeContactForm() {
    this.contactFormOpen.set(false);
    this.contactError.set(null);
  }
  addNumber() {
    this.contactNumbers.update(arr => [...arr, { number: '', label: '' }]);
  }
  removeNumber(i: number) {
    this.contactNumbers.update(arr => arr.filter((_, idx) => idx !== i));
  }
  editContact(c: ClientContact) {
    this.contactDraft = { ...c, verified: !!c.verified };
    this.contactNumbers.set((c.numbers ?? []).map(n => ({ number: n.number, label: n.label || '' })));
    this.contactError.set(null);
    this.contactFormOpen.set(true);
  }
  saveContact() {
    const cid = this.current()?.id;
    if (!cid) return;
    this.contactError.set(null);
    if (!this.contactDraft.first_name?.trim()) { this.contactError.set('First name is required'); return; }

    const payload: ClientContact = {
      ...this.contactDraft,
      verified: this.contactDraft.verified ? 1 : 0,
      numbers: this.contactNumbers().filter(n => n.number.trim() !== ''),
    };
    this.contactSaving.set(true);
    const done = () => {
      this.contactSaving.set(false);
      this.closeContactForm();
      this.loadContacts(cid);
    };
    const fail = (e: any) => {
      this.contactSaving.set(false);
      this.contactError.set(e?.error?.error || 'Save failed');
    };
    if (this.contactDraft.id) {
      this.api.updateClientContact(cid, this.contactDraft.id, payload).subscribe({ next: done, error: fail });
    } else {
      this.api.createClientContact(cid, payload).subscribe({ next: done, error: fail });
    }
  }
  async deleteContact(c: ClientContact) {
    const clientId = this.current()?.id;
    if (!clientId || !c.id) return;
    const ok = await this.dialog.confirm(
      `Delete contact "${c.first_name} ${c.last_name || ''}"?`,
      { title: 'Delete contact', confirmLabel: 'Delete', variant: 'danger' }
    );
    if (!ok) return;
    this.api.deleteClientContact(clientId, c.id).subscribe(() => this.loadContacts(clientId));
  }
  /** Promote this contact to primary; backend demotes any existing primary
   *  for the same client. The basic-info card on the left re-pulls
   *  Name/Email/Phone from the new primary once contacts reload. */
  makePrimary(c: ClientContact) {
    const clientId = this.current()?.id;
    if (!clientId || !c.id) return;
    this.api.setPrimaryClientContact(clientId, c.id).subscribe(() => this.loadContacts(clientId));
  }

  // ----- Accounts -----
  private loadAccounts(clientId: number) {
    this.api.listClientAccounts(clientId).subscribe(r => this.accounts.set(r.accounts));
  }
  toggleAccountForm() {
    if (this.accountFormOpen()) this.closeAccountForm();
    else this.openAccountForm();
  }
  openAccountForm() {
    this.accountDraft = { account_name: '', login_url: '', username: '', password: '' };
    this.accountError.set(null);
    this.passwordFieldVisible.set(false);
    this.accountFormOpen.set(true);
  }
  closeAccountForm() {
    this.accountFormOpen.set(false);
    this.accountError.set(null);
    this.passwordFieldVisible.set(false);
  }
  editAccount(a: ClientAccount) {
    this.accountDraft = { ...a };
    this.accountError.set(null);
    this.passwordFieldVisible.set(false);
    this.accountFormOpen.set(true);
  }
  saveAccount() {
    const cid = this.current()?.id;
    if (!cid) return;
    this.accountError.set(null);
    if (!this.accountDraft.account_name?.trim()) { this.accountError.set('Account name is required'); return; }
    this.accountSaving.set(true);
    const done = () => {
      this.accountSaving.set(false);
      this.closeAccountForm();
      this.loadAccounts(cid);
    };
    const fail = (e: any) => {
      this.accountSaving.set(false);
      this.accountError.set(e?.error?.error || 'Save failed');
    };
    if (this.accountDraft.id) {
      this.api.updateClientAccount(cid, this.accountDraft.id, this.accountDraft).subscribe({ next: done, error: fail });
    } else {
      this.api.createClientAccount(cid, this.accountDraft).subscribe({ next: done, error: fail });
    }
  }
  async deleteAccount(a: ClientAccount) {
    const clientId = this.current()?.id;
    if (!clientId || !a.id) return;
    const ok = await this.dialog.confirm(
      `Delete account "${a.account_name}"?`,
      { title: 'Delete account', confirmLabel: 'Delete', variant: 'danger' }
    );
    if (!ok) return;
    this.api.deleteClientAccount(clientId, a.id).subscribe(() => this.loadAccounts(clientId));
  }

  // ----- Notes -----
  private loadNotes(clientId: number) {
    this.api.listClientNotes(clientId).subscribe(r => this.notes.set(r.notes));
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
  editNote(n: ClientNote) {
    this.noteDraft = { ...n };
    this.noteError.set(null);
    this.noteFormOpen.set(true);
  }
  saveNote() {
    const cid = this.current()?.id;
    if (!cid) return;
    this.noteError.set(null);
    if (!this.noteDraft.title?.trim()) { this.noteError.set('Title is required'); return; }
    this.noteSaving.set(true);
    const done = () => {
      this.noteSaving.set(false);
      this.closeNoteForm();
      this.loadNotes(cid);
    };
    const fail = (e: any) => {
      this.noteSaving.set(false);
      this.noteError.set(e?.error?.error || 'Save failed');
    };
    if (this.noteDraft.id) {
      this.api.updateClientNote(cid, this.noteDraft.id, this.noteDraft).subscribe({ next: done, error: fail });
    } else {
      this.api.createClientNote(cid, this.noteDraft).subscribe({ next: done, error: fail });
    }
  }
  async deleteNote(n: ClientNote) {
    const clientId = this.current()?.id;
    if (!clientId || !n.id) return;
    const ok = await this.dialog.confirm(
      `Delete note "${n.title}"?`,
      { title: 'Delete note', confirmLabel: 'Delete', variant: 'danger' }
    );
    if (!ok) return;
    this.api.deleteClientNote(clientId, n.id).subscribe(() => this.loadNotes(clientId));
  }

  // ----- Info entries -----
  private loadInfoEntries(clientId: number) {
    this.api.listClientInfo(clientId).subscribe({
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
  editInfo(i: ClientInfo) {
    this.infoDraft = { ...i };
    this.infoError.set(null);
    this.infoFormOpen.set(true);
  }
  saveInfo() {
    const clientId = this.current()?.id;
    if (!clientId) return;
    if (!this.infoDraft.name?.trim()) { this.infoError.set('Name is required'); return; }
    this.infoSaving.set(true);
    this.infoError.set(null);
    const done = () => {
      this.infoSaving.set(false);
      this.closeInfoForm();
      this.loadInfoEntries(clientId);
    };
    const fail = (e: any) => {
      this.infoSaving.set(false);
      this.infoError.set(e?.error?.error || 'Failed to save info');
    };
    if (this.infoDraft.id) {
      this.api.updateClientInfo(clientId, this.infoDraft.id, this.infoDraft).subscribe({ next: done, error: fail });
    } else {
      this.api.createClientInfo(clientId, this.infoDraft).subscribe({ next: done, error: fail });
    }
  }
  async deleteInfo(i: ClientInfo) {
    const clientId = this.current()?.id;
    if (!clientId || !i.id) return;
    const ok = await this.dialog.confirm(
      `Delete "${i.name}"?`,
      { title: 'Delete entry', confirmLabel: 'Delete', variant: 'danger' }
    );
    if (!ok) return;
    this.api.deleteClientInfo(clientId, i.id).subscribe(() => this.loadInfoEntries(clientId));
  }

  // ----- Services -----
  private loadServices(clientId: number) {
    this.api.listClientServices(clientId).subscribe({
      next: r => {
        this.services.set(r.services);
        this.servicesTotals.set(r.totals);
      },
      error: () => {
        this.services.set([]);
        this.servicesTotals.set(null);
      },
    });

    // Also pull the form-submission linkage for this client so each
    // catalog service row can surface the onboarding data captured
    // for the same service_offering_id.
    this.api.listFormSubmissionsFor('client', clientId).subscribe({
      next: r => {
        // Group by service_offering_id. A group with no service link
        // (bucket==='default') is not surfaced under any service row.
        const map = new Map<number, FormSubmissionLinkGroup[]>();
        for (const g of r.groups ?? []) {
          if (g.bucket !== 'service') continue;
          // The endpoint carries service_offering_id on the form node
          // when the link resolved via forms.service_offering_id.
          const anySub = g.submissions[0];
          if (!anySub) continue;
          // The form's service link is available via a per-form lookup
          // that came through the join in the endpoint. Backend already
          // ensured every "service" bucket has a service_offering_id;
          // pull from the first submission's link row.
          const svcId = (g as any).form?.service_offering_id
            ?? (g as any).service_offering_id
            ?? null;
          if (svcId == null) continue;
          const arr = map.get(svcId) ?? [];
          arr.push(g);
          map.set(svcId, arr);
        }
        this.clientSubmissionsBySvc.set(map);
      },
      error: () => this.clientSubmissionsBySvc.set(new Map()),
    });
  }

  toggleAddService() {
    if (this.addServiceOpen()) this.closeAddService();
    else this.openAddService();
  }
  openAddService() {
    this.addServiceSel = null;
    this.addServiceError.set(null);
    this.addServiceOpen.set(true);
    // Lazy-load the catalogue services + Services-attached onboarding forms.
    if (!this.serviceOfferings().length) {
      this.api.listServiceOfferings().subscribe({
        next: r => this.serviceOfferings.set(r.services.filter(s => !!s.is_active)),
        error: () => this.serviceOfferings.set([]),
      });
    }
    if (!this.serviceForms().length) {
      this.api.listOnboardingForms().subscribe({
        next: r => this.serviceForms.set(
          r.forms.filter(f => f.sidenav_placement === 'child' && f.sidenav_parent_key === 'services')
        ),
        error: () => this.serviceForms.set([]),
      });
    }
  }
  closeAddService() {
    this.addServiceOpen.set(false);
    this.addServiceError.set(null);
  }
  addService() {
    const clientId = this.current()?.id;
    if (!clientId) return;
    const sel = this.addServiceSel;
    if (!sel) { this.addServiceError.set('Pick a service'); return; }
    this.addServiceSaving.set(true);
    this.addServiceError.set(null);

    const [kind, idStr] = sel.split(':');
    const refId = Number(idStr);
    const req: Observable<unknown> = kind === 'svc'
      ? this.api.addClientServiceOffering(clientId, refId)
      : this.api.addClientService(clientId, refId);
    req.subscribe({
      next: () => {
        this.addServiceSaving.set(false);
        this.closeAddService();
        this.loadServices(clientId);
      },
      error: (e: any) => {
        this.addServiceSaving.set(false);
        this.addServiceError.set(e?.error?.error || 'Failed to add service');
      },
    });
  }
  async removeCatalogService(s: ClientService, e?: Event) {
    e?.stopPropagation();
    const clientId = this.current()?.id;
    if (!clientId || s.service_link_id == null) return;
    const ok = await this.dialog.confirm(
      `Remove "${s.name}" from this client?`,
      { title: 'Remove service', confirmLabel: 'Remove', variant: 'danger' }
    );
    if (!ok) return;
    this.api.removeClientServiceOffering(clientId, s.service_link_id).subscribe({
      next: () => this.loadServices(clientId),
    });
  }
}
