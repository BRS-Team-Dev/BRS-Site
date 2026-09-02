import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { Api } from '../../core/api';
import { DialogService } from '../../core/dialog';
import { environment } from '@env/environment';
import { ClientContact, FeedbackForm, FeedbackQuestion, FeedbackResponse, Lead, LeadIndustrySummary, LeadInfo, LeadNote, LeadServiceLink, LeadStatus, ServiceOffering } from '../../core/models';
import { AssignmentsPanel } from '../../shared/assignments-panel';
import { FormSubmissionsList } from '../../shared/form-submissions-list';

type Mode = 'list' | 'view' | 'edit';
type LeadTabKey = 'info' | 'contacts' | 'services' | 'assignments' | 'onboarding' | 'feedback' | 'notes';

const STATUS_LABELS: Record<LeadStatus, string> = {
  new:       'New',
  prospect:  'Prospect',
  dead:      'Dead',
  converted: 'Converted',
};

/** Columns the user can sort the list by. Tied to fields on `Lead`. */
type LeadSortKey =
  | 'name' | 'email' | 'phone' | 'company'
  | 'industry' | 'service_name' | 'contacted_at' | 'added_by' | 'status';

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
  imports: [RouterLink, FormsModule, DatePipe, AssignmentsPanel, FormSubmissionsList],
  template: `
    @if (mode() === 'list') {
      <div class="toolbar">
        <h1>Leads</h1>
        <span class="spacer"></span>
        <input class="search" type="search" placeholder="Search name / email / phone / company / industry / service / source / added by…"
               [ngModel]="searchTerm()" (ngModelChange)="searchTerm.set($event)" name="search" />
        <select [ngModel]="filterIndustry()" (ngModelChange)="filterIndustry.set($event)" name="ind_filter" class="status-filter">
          <option value="">All industries</option>
          @for (i of industryOptions(); track i.name) {
            <option [value]="i.name">{{ i.name }} ({{ i.lead_count }})</option>
          }
        </select>
        <select [ngModel]="filterServiceId()" (ngModelChange)="filterServiceId.set($event)" name="svc_filter" class="status-filter">
          <option [ngValue]="''">All services</option>
          @for (s of serviceOptions(); track s.id) {
            <option [ngValue]="s.id">{{ s.name }}</option>
          }
        </select>
        <select [ngModel]="filterContacted()" (ngModelChange)="filterContacted.set($event)" name="ctd_filter" class="status-filter">
          <option value="">All contacts</option>
          <option value="yes">Contacted</option>
          <option value="no">Not contacted</option>
        </select>
        <select [ngModel]="filterStatus()" (ngModelChange)="filterStatus.set($event)" name="status_filter" class="status-filter">
          <option value="">All statuses</option>
          @for (s of statusOptions; track s) {
            <option [value]="s">{{ statusLabel(s) }}</option>
          }
        </select>
        @if (anyFilterActive()) {
          <button class="ghost" type="button" (click)="clearFilters()" title="Clear all filters">✕ Clear</button>
        }
        <button class="primary" routerLink="/admin/leads/new">+ New lead</button>
      </div>

      @if (visible().length === 0) {
        <div class="empty">
          @if (anyFilterActive()) {
            <p class="muted">No leads match these filters.</p>
            <button class="ghost" (click)="clearFilters()">Clear filters</button>
          } @else {
            <p class="muted">No leads yet.</p>
            <button class="primary" routerLink="/admin/leads/new">Add your first lead</button>
          }
        </div>
      } @else {
        <p class="muted small list-count">
          {{ visible().length }} of {{ leads().length }} lead{{ leads().length === 1 ? '' : 's' }}
        </p>
        <div class="table-wrap">
          <table class="data">
            <thead><tr>
              @for (c of sortColumns; track c.key) {
                <th class="sortable"
                    [class.active]="sortBy() === c.key"
                    [class.sticky-status]="c.key === 'status'"
                    (click)="toggleSort(c.key)"
                    [attr.aria-sort]="sortBy() === c.key ? (sortDir() === 'asc' ? 'ascending' : 'descending') : 'none'">
                  <span>{{ c.label }}</span>
                  <span class="sort-mark">
                    @if (sortBy() === c.key) { {{ sortDir() === 'asc' ? '▲' : '▼' }} }
                    @else { <span class="muted small">↕</span> }
                  </span>
                </th>
              }
              <th class="sticky-actions"></th>
            </tr></thead>
            <tbody>
              @for (l of visible(); track l.id) {
                <tr (click)="view(l)">
                  <td>
                    <strong>{{ l.name }}</strong>
                    @if (l.stage) {
                      <span class="stage-chip" [title]="'Companies House · stage ' + l.stage + ' of 5'">S{{ l.stage }}</span>
                    }
                  </td>
                  <td>{{ l.email || '—' }}</td>
                  <td>{{ l.phone || '—' }}</td>
                  <td>{{ l.company || '—' }}</td>
                  <td>{{ l.industry || '—' }}</td>
                  <td>{{ l.service_name || '—' }}</td>
                  <td (click)="$event.stopPropagation()">
                    <button class="contacted-pill" type="button"
                            [class.yes]="!!l.contacted_at"
                            (click)="toggleContacted(l)"
                            [title]="l.contacted_at ? ('Contacted ' + (l.contacted_at | date:'short')) : 'Mark as contacted'">
                      {{ l.contacted_at ? 'Yes' : 'No' }}
                    </button>
                  </td>
                  <td>
                    @if (l.added_by_system) {
                      <span class="muted">System</span>
                      @if (l.added_by_name) { <span class="muted small"> · {{ l.added_by_name }}</span> }
                    } @else if (l.added_by_name) {
                      {{ l.added_by_name }}
                    } @else {
                      <span class="muted">—</span>
                    }
                  </td>
                  <td class="sticky-status" (click)="$event.stopPropagation()">
                    <select class="status-inline"
                            [attr.data-status]="l.status || 'new'"
                            [ngModel]="l.status || 'new'"
                            (ngModelChange)="changeStatus(l, $event)"
                            [name]="'st_' + l.id"
                            [title]="'Change status'">
                      @for (s of statusOptions; track s) {
                        <option [value]="s">{{ statusLabel(s) }}</option>
                      }
                      @if (l.status === 'converted') {
                        <option value="converted" disabled>Converted</option>
                      }
                    </select>
                  </td>
                  <td class="actions sticky-actions">
                    <button class="ghost icon-btn" (click)="view(l, $event)" title="View" aria-label="View">👁</button>
                    <button class="ghost icon-btn" (click)="edit(l, $event)" title="Edit" aria-label="Edit">✎</button>
                    @if (l.status !== 'converted' && !l.promoted_client_id) {
                      <button class="ghost icon-btn promote" (click)="promoteRow(l, $event)" title="Promote to client" aria-label="Promote to client">↑</button>
                    }
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
            <div class="kv"><label>Industry</label><div>{{ l.industry || '—' }}</div></div>
            <div class="kv"><label>Service</label><div>{{ l.service_name || '—' }}</div></div>
            <div class="kv">
              <label>Contacted</label>
              <div>
                @if (l.contacted_at) {
                  <span class="status-pill" data-status="prospect">Yes · {{ l.contacted_at | date:'short' }}</span>
                } @else { — }
              </div>
            </div>
            <div class="kv">
              <label>Added by</label>
              <div>
                @if (l.added_by_system) {
                  <span class="muted">System</span>
                  @if (l.added_by_name) { · {{ l.added_by_name }} }
                } @else if (l.added_by_name) {
                  {{ l.added_by_name }}
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
                  (click)="onTabClick(t.key, l.id!)">
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
                          <input [(ngModel)]="contactDraft.first_name" name="lcd_first" placeholder="Jane" />
                        </div>
                        <div>
                          <label>Last name</label>
                          <input [(ngModel)]="contactDraft.last_name" name="lcd_last" placeholder="Doe" />
                        </div>
                      </div>
                      <label>Position</label>
                      <input [(ngModel)]="contactDraft.position" name="lcd_pos" placeholder="CEO" />
                      <label>Email</label>
                      <input type="email" [(ngModel)]="contactDraft.email" name="lcd_email" placeholder="jane@example.com" />

                      <label>LinkedIn URL</label>
                      <input type="url" [(ngModel)]="contactDraft.linkedin_url" name="lcd_linkedin"
                             placeholder="https://www.linkedin.com/in/jane-doe/" />

                      <label>Numbers</label>
                      @for (n of contactNumbers(); track $index; let i = $index) {
                        <div class="number-row">
                          <input [(ngModel)]="n.number" [name]="'lnum_' + i" placeholder="+44 7700 900123" />
                          <input [(ngModel)]="n.label" [name]="'llbl_' + i" placeholder="mobile / office" class="num-label" />
                          <button class="ghost icon-btn danger" (click)="removeNumber(i)" title="Remove">✕</button>
                        </div>
                      }
                      <button class="ghost" (click)="addNumber()">+ Add number</button>

                      <div class="checkbox-row" style="margin-top: 12px;">
                        <input type="checkbox" id="lverified" [(ngModel)]="contactDraft.verified" name="lcd_verified" />
                        <label for="lverified">Verified</label>
                      </div>

                      @if (contactError()) { <div class="error-msg">{{ contactError() }}</div> }
                      <div class="row" style="margin-top: 16px; gap: 8px;">
                        <button class="primary" (click)="saveContact()" [disabled]="contactSaving()">
                          {{ contactSaving() ? 'Saving…' : (contactDraft.id ? 'Update' : 'Save contact') }}
                        </button>
                        <button class="ghost" (click)="closeContactForm()">Done</button>
                      </div>
                    </div>
                  }

                  @if (contacts().length === 0 && !contactFormOpen()) {
                    <p class="muted">No contacts yet.</p>
                  } @else if (contacts().length > 0) {
                    <div class="contact-list">
                      @for (ct of contacts(); track ct.id) {
                        <div class="contact-card" [class.expanded]="expandedContact() === ct.id" [class.primary]="!!ct.is_primary">
                          <div class="contact-head" (click)="toggleContact(ct)">
                            <span class="caret">›</span>
                            <div class="contact-name">
                              <strong>{{ ct.first_name }} {{ ct.last_name }}</strong>
                              @if (ct.position) { <span class="position">{{ ct.position }}</span> }
                            </div>
                            @if (ct.is_primary) {
                              <span class="badge primary">Primary</span>
                            } @else {
                              <button class="ghost small make-primary" (click)="makePrimary(ct); $event.stopPropagation()" title="Set as primary contact">
                                Set as primary
                              </button>
                            }
                            @if (ct.verified) { <span class="badge success">Verified</span> }
                            <span class="spacer"></span>
                            <button class="ghost icon-btn" (click)="editContact(ct); $event.stopPropagation()" title="Edit">✎</button>
                            <button class="ghost icon-btn danger" (click)="deleteContact(ct); $event.stopPropagation()" title="Delete">✕</button>
                          </div>
                          @if (expandedContact() === ct.id) {
                            <div class="contact-body">
                              @if (ct.email) { <div class="muted small"><span class="ic">✉</span> <a [href]="'mailto:' + ct.email">{{ ct.email }}</a></div> }
                              @if (ct.linkedin_url) { <div class="muted small"><span class="ic">in</span> <a [href]="ct.linkedin_url" target="_blank" rel="noopener">LinkedIn profile</a></div> }
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
                  </div>

                  <!-- Picker row: a dropdown filtered to services NOT yet
                       attached to this lead, plus an "+ Add" button. -->
                  <div class="service-picker">
                    <select [ngModel]="servicePickerValue"
                            (ngModelChange)="onServicePickerChange($event)"
                            name="svc_pick"
                            [disabled]="availableUnselectedServices().length === 0">
                      <option value="">
                        @if (availableUnselectedServices().length === 0) {
                          All services already added
                        } @else {
                          Choose a service…
                        }
                      </option>
                      @for (s of availableUnselectedServices(); track s.id) {
                        <option [value]="s.id">{{ s.name }}</option>
                      }
                    </select>
                    <button class="primary"
                            (click)="addService()"
                            [disabled]="!servicePickerValue || serviceSaving()
                                        || (isPickedServiceVariablePriced() && !servicePickerPrice)">
                      {{ serviceSaving() ? 'Adding…' : '+ Add' }}
                    </button>
                  </div>
                  @if (isPickedServiceVariablePriced()) {
                    <div class="row" style="margin-top: 10px; gap: 8px; align-items: center;">
                      <label style="min-width: 90px; margin: 0;">Price (GBP)</label>
                      <input type="number" min="0" step="0.01"
                        [(ngModel)]="servicePickerPrice" name="svc_pick_price"
                        placeholder="0.00" style="max-width: 180px;" />
                      <span class="muted small">
                        @if (servicePickerPrice !== null && servicePickerPrice !== undefined) {
                          Pre-filled from the catalogue default — override
                          for this lead.
                        } @else {
                          No catalogue default set — enter a price for this lead.
                        }
                      </span>
                    </div>
                  }
                  @if (serviceError()) { <div class="error-msg">{{ serviceError() }}</div> }

                  <!-- Attached services as badges. × removes the link. -->
                  @if (leadServices().length === 0) {
                    <p class="muted" style="margin-top: 18px;">No services attached yet.</p>
                  } @else {
                    <div class="badge-list" style="margin-top: 16px;">
                      @for (s of leadServices(); track s.id) {
                        <span class="badge service-chip">
                          {{ s.name }}
                          <button class="badge-x" (click)="removeService(s)" title="Remove">×</button>
                        </span>
                      }
                    </div>
                  }
                }
                @case ('assignments') {
                  <div class="tab-head">
                    <h3>Assignments</h3>
                    <span class="spacer"></span>
                  </div>
                  <p class="muted small" style="margin: 0 0 12px 0;">
                    Assign an employee, contractor, or partner to each work-area role.
                    Reassignment keeps a full audit trail of who was assigned when, by whom.
                  </p>
                  <app-assignments-panel entity="lead" [entityId]="l.id!"></app-assignments-panel>
                }
                @case ('onboarding') {
                  <div class="tab-head">
                    <h3>Onboarding</h3>
                    <span class="spacer"></span>
                  </div>
                  <p class="muted small">
                    Every form + multipart-form submission linked to this lead,
                    grouped by form. Click a submission to see the captured fields.
                    When the lead is promoted to a client, submissions carry over.
                  </p>
                  <app-form-submissions-list type="lead" [recordId]="l.id!" />
                }
                @case ('feedback') {
                  <div class="tab-head">
                    <h3>Feedback</h3>
                    <span class="spacer"></span>
                  </div>
                  <div class="attach-row">
                    <select [(ngModel)]="feedbackToAttach" name="fb_attach_l">
                      <option [ngValue]="null">— pick a form to attach —</option>
                      @for (f of attachableFeedback(); track f.id) {
                        <option [ngValue]="f.id">{{ f.title }} ({{ f.kind }})</option>
                      }
                    </select>
                    <button class="primary"
                            [disabled]="!feedbackToAttach || attachingFeedback()"
                            (click)="attachFeedback(l.id!)">
                      {{ attachingFeedback() ? 'Attaching…' : 'Attach' }}
                    </button>
                    <a class="ghost small" routerLink="/admin/feedback">
                      Manage forms →
                    </a>
                  </div>
                  @if (loadingFeedback()) {
                    <p class="muted">Loading…</p>
                  } @else if (leadFeedback().length === 0) {
                    <p class="muted">No feedback forms linked to this lead yet.</p>
                  } @else {
                    <div class="fb-list">
                      @for (group of leadFeedbackGroups(); track group.key) {
                        <div class="fb-section-head">
                          <span class="fb-section-title">{{ group.label }}</span>
                          <span class="muted small">· {{ group.forms.length }}</span>
                        </div>
                        @for (f of group.forms; track f.id) {
                        <div class="fb-row" [class.open]="expandedFeedback() === f.id">
                          <div class="fb-head" (click)="toggleFeedbackRow(f.id!)">
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
                                <p class="muted small">This lead hasn't submitted yet. Share the link to invite them.</p>
                              } @else {
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
                                <button class="ghost small" (click)="copyLeadFeedbackLink(f, l.id!, $event)">Copy link</button>
                                <span class="spacer"></span>
                                @if (group.key === 'lead') {
                                  <button class="ghost small danger fb-detach"
                                          (click)="detachFeedback(f, l.id!, $event)"
                                          title="Detach — removes every link between this lead and the form (junction + legacy + response tags).">✕ Detach</button>
                                } @else if (group.key === 'broadcast') {
                                  <span class="muted small">Broadcast — edit on form builder to disable.</span>
                                } @else if (group.key === 'service') {
                                  <span class="muted small">Via service — remove the lead from the service to detach.</span>
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

            <div class="row two-col">
              <div>
                <label>Industry / sector</label>
                <input list="ld_industries" [(ngModel)]="draft.industry" name="ld_industry"
                       placeholder="Healthcare, Construction, …" />
                <datalist id="ld_industries">
                  @for (i of industryOptions(); track i.name) {
                    <option [value]="i.name"></option>
                  }
                </datalist>
              </div>
              <div>
                <label>Service we're pitching</label>
                <select [(ngModel)]="draft.service_offering_id" name="ld_service">
                  <option [ngValue]="null">— none —</option>
                  @for (s of serviceOptions(); track s.id) {
                    <option [ngValue]="s.id">{{ s.name }}</option>
                  }
                </select>
              </div>
            </div>

            <label>Source</label>
            <input [(ngModel)]="draft.source" name="ld_source" placeholder="referral, website, event…" />

            <label class="check">
              <input type="checkbox" name="ld_contacted"
                     [checked]="!!draft.contacted_at"
                     (change)="setDraftContacted($any($event.target).checked)" />
              Already contacted
            </label>

            <label>Notes</label>
            <textarea [(ngModel)]="draft.notes" name="ld_notes" rows="6" placeholder="Anything worth knowing about this lead."></textarea>
          </section>
        }
      </div>
    }
  `,
  styles: [`
    /* Component element must be a constrained block so the inner
       .table-wrap can scroll horizontally instead of pushing main wider.
       Without min-width:0 the host grows to fit the widest descendant,
       defeating the shell's overflow-x:hidden safety net. */
    :host { display: block; min-width: 0; }

    /* Toolbar select needs a capped width — global rule sets selects to
       width:100% which would otherwise blow up the toolbar. */
    .status-filter { width: auto; min-width: 160px; }
    /* Search box sits to the left of the filter selects. flex:1 lets it
       eat the remaining toolbar room when the filters collapse on a
       narrow viewport. */
    .toolbar .search {
      flex: 1 1 220px; max-width: 360px; min-width: 180px;
      padding: 6px 10px;
      background: var(--bg-2);
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      color: var(--fg); font-size: 13px;
    }
    .toolbar .search:focus { outline: 0; border-color: var(--primary); }
    /* Match the 24px outer margin used by .table-wrap so this caption
       lines up with the table area on both sides, instead of hugging
       the main edge. */
    .list-count { margin: 4px 24px 8px; }

    /* Inline contacted indicator on the list. Click toggles between
       Yes (today's timestamp) and No (null). Colour-coded same way
       as the status pills so the column scans at a glance. */
    .contacted-pill {
      padding: 3px 12px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: var(--bg-2);
      color: var(--muted);
      font-size: 12px; font-weight: 600;
      cursor: pointer;
      transition: border-color 0.15s, color 0.15s, background 0.15s;
    }
    .contacted-pill:hover { border-color: var(--primary); color: var(--primary); }
    .contacted-pill.yes {
      color: var(--success); border-color: var(--success);
      background: rgba(86, 201, 138, 0.10);
    }

    /* Edit-form contacted-checkbox label — sits inline with the box,
       matches the existing .check pattern other admin pages use. */
    label.check {
      display: inline-flex; align-items: center; gap: 8px; margin: 12px 0;
      cursor: pointer; color: var(--fg); font-size: 14px; font-weight: 500;
      text-transform: none; letter-spacing: normal;
      white-space: nowrap;
    }
    label.check input { width: auto; }

    .actions { display: flex; gap: 4px; justify-content: flex-end; }
    /* Compact 32×32 icon buttons in row-actions cells. Without this the
       default button padding (8 14) inflates each icon to ~46px wide and
       the actions cell balloons past the sticky-actions reservation,
       which lets the status pill overlap with action icons after the
       horizontal-scroll fix. Mirrors clients-admin's canonical sizing. */
    td.actions .icon-btn {
      width: 32px; height: 32px; padding: 0;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 15px; line-height: 1;
    }

    /* Status + actions column pinned to the right of the table so users
       always see what they can do to a row even while horizontally
       scrolling the long lead list. Width offsets are explicit so the
       two sticky cells line up; if you change the sticky-actions width,
       update the sticky-status right offset to match.
       The thead cells use the global gold thead bg (via the primary-3
       token); tbody cells reuse the card-row bg-3 and pick up the row's
       hover override so the sticky region animates with the row. */
    table.data th.sticky-status,
    table.data th.sticky-actions,
    table.data td.sticky-status,
    table.data td.sticky-actions {
      position: sticky;
      background: var(--bg-3);
      z-index: 1;
    }
    table.data thead th.sticky-status,
    table.data thead th.sticky-actions {
      background: var(--primary-3);
      z-index: 2;
    }
    /* Widths picked so the widest pill ("Prospect") + select chevron + cell
       padding fit cleanly, and so the two sticky columns line up with no
       gap or overlap between them. Actions width = 4×32 icons + 3×4 gaps
       + 24 padding = ~164, rounded up to 170 for the rare 4-button row. */
    table.data td.sticky-actions,
    table.data th.sticky-actions { right: 0; width: 170px; min-width: 170px; }
    table.data td.sticky-status,
    table.data th.sticky-status { right: 170px; width: 150px; min-width: 150px; }
    table.data tbody tr:hover td.sticky-status,
    table.data tbody tr:hover td.sticky-actions { background: #262626; }
    /* Soft left edge so the user notices content is scrolling under the
       sticky region rather than the row ending there. */
    table.data th.sticky-status,
    table.data td.sticky-status {
      box-shadow: -8px 0 12px -8px rgba(0, 0, 0, 0.45);
    }

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
    .stage-chip {
      display: inline-block; margin-left: 8px; padding: 1px 7px;
      border: 1px solid var(--primary); border-radius: 999px;
      color: var(--primary); font-size: 10px; font-weight: 700; vertical-align: middle;
      text-transform: none; letter-spacing: 0;
    }
    .status-pill[data-status="new"]       { color: var(--primary); border-color: var(--primary); }
    .status-pill[data-status="prospect"]  { color: #60a5fa; border-color: #60a5fa; background: rgba(96, 165, 250, 0.1); }
    .status-pill[data-status="dead"]      { color: var(--danger); border-color: var(--danger); background: rgba(239, 68, 68, 0.10); }
    .status-pill[data-status="converted"] { color: var(--success); border-color: var(--success); background: rgba(86, 201, 138, 0.1); }

    /* Sortable table headers — used on the leads list. Clicking toggles
       through asc → desc → unsorted; an indicator arrow shows the
       current direction. */
    th.sortable { cursor: pointer; user-select: none; white-space: nowrap; }
    th.sortable:hover { color: var(--primary); }
    th.sortable.active { color: var(--primary); }
    th.sortable .sort-mark { margin-left: 6px; font-size: 11px; opacity: 0.8; }

    /* Inline status dropdown in the list cell. Pills/colour are carried
       over so the row still reads at a glance. */
    .status-inline {
      /* Strip the native chevron — Chromium/Webkit/Firefox each render
         the default arrow anchored to the right edge of the control's
         paint box, so padding-right alone will not move it. With
         appearance: none we hide it and paint a custom one via
         background-image. The actual chevron URL is set per
         [data-status] below because data-URL SVGs resolve currentColor
         against their own (blank) host document, not the parent CSS,
         so we hard-code the stroke hex per status to keep the arrow
         on-brand with the pill text. */
      -webkit-appearance: none;
              appearance: none;
      background-repeat: no-repeat;
      background-position: right 10px center;
      padding: 3px 26px 3px 12px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background-color: var(--bg-2);
      color: var(--fg);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      min-width: auto; width: auto;
    }
    /* Edge/IE legacy: hide the expand pseudo so the native arrow doesn't
       slip back in even after appearance: none. */
    .status-inline::-ms-expand { display: none; }
    .status-inline:hover { border-color: var(--primary); }

    /* Per-status chevron + text/border colour. The stroke hex in each
       data: SVG matches the pill colour one-for-one so the arrow always
       reads as part of the pill rather than a stray native control. */
    .status-inline[data-status="new"] {
      color: var(--primary); border-color: var(--primary);
      background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6' fill='none'><path d='M1 1l4 4 4-4' stroke='%23d4a93a' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/></svg>");
    }
    .status-inline[data-status="prospect"] {
      color: #60a5fa; border-color: #60a5fa; background-color: rgba(96, 165, 250, 0.08);
      background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6' fill='none'><path d='M1 1l4 4 4-4' stroke='%2360a5fa' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/></svg>");
    }
    .status-inline[data-status="dead"] {
      color: var(--danger); border-color: var(--danger); background-color: rgba(239, 68, 68, 0.08);
      background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6' fill='none'><path d='M1 1l4 4 4-4' stroke='%23ef4444' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/></svg>");
    }
    .status-inline[data-status="converted"] {
      color: var(--success); border-color: var(--success); background-color: rgba(86, 201, 138, 0.08);
      background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6' fill='none'><path d='M1 1l4 4 4-4' stroke='%2356c98a' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/></svg>");
    }

    /* Promote icon on the list — keeps the row's actions consistent
       with the existing eye/pencil/cross set. */
    .icon-btn.promote { color: var(--success); }
    .icon-btn.promote:hover { background: rgba(86, 201, 138, 0.15); }

    /* Contacts tab — mirrors the contact UI on clients-admin so the
       lead detail looks identical, just scoped to lead data. Component
       styles are encapsulated, so the rules have to live here too
       instead of being pulled in from clients-admin. */
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

    .attach-row { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
    .attach-row select { flex: 1; }
    .attach-row a { padding: 6px 10px; font-size: 12px; }

    /* Feedback tab — card-list matching the response-viewer look. */
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
    .fb-meta { flex: 1; display: flex; align-items: center; gap: 10px; min-width: 0; }
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

    /* ----- Services tab ------------------------------------------------ */
    /* Picker is a single row: dropdown + Add button. The dropdown gets a
       width override because of the global "select { width: 100% }" rule
       — without it the button wraps to the next line. */
    .service-picker { display: flex; gap: 8px; align-items: center; }
    .service-picker select { flex: 1; min-width: 200px; width: auto; }

    /* Removal chip: a small × button tucked inside the badge. */
    .service-chip { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; }
    .badge-x {
      background: transparent; border: 0; padding: 0;
      color: var(--muted); font-size: 14px; line-height: 1; cursor: pointer;
    }
    .badge-x:hover { color: var(--danger); }

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
  private dialog = inject(DialogService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  // Only the user-pickable statuses appear in the dropdown. `converted`
  // is set by the promote endpoint and cleared by the relegate endpoint;
  // it isn't selectable directly.
  readonly statusOptions: LeadStatus[] = ['new', 'prospect', 'dead'];
  statusLabel(s: LeadStatus): string { return STATUS_LABELS[s] ?? s; }

  // Sort state for the list table. Defaults to created-order (no key).
  readonly sortColumns: { key: LeadSortKey; label: string }[] = [
    { key: 'name',         label: 'Name' },
    { key: 'email',        label: 'Email' },
    { key: 'phone',        label: 'Phone' },
    { key: 'company',      label: 'Company' },
    { key: 'industry',     label: 'Industry' },
    { key: 'service_name', label: 'Service' },
    { key: 'contacted_at', label: 'Contacted' },
    { key: 'added_by',     label: 'Added by' },
    { key: 'status',       label: 'Status' },
  ];
  sortBy  = signal<LeadSortKey | null>(null);
  sortDir = signal<'asc' | 'desc'>('asc');

  /** Click handler for the sortable headers. First click sets the key
   *  to asc, second click flips to desc, third click clears the sort. */
  toggleSort(key: LeadSortKey) {
    if (this.sortBy() !== key) { this.sortBy.set(key); this.sortDir.set('asc'); return; }
    if (this.sortDir() === 'asc') { this.sortDir.set('desc'); return; }
    this.sortBy.set(null);
  }

  mode = signal<Mode>('list');
  isNew = signal(false);
  saving = signal(false);
  error = signal<string | null>(null);
  promoting = signal(false);
  promoteError = signal<string | null>(null);

  leads = signal<Lead[]>([]);
  current = signal<Lead | null>(null);

  // ── Filter + search state ────────────────────────────────────────
  // Each filter is a signal so the toolbar's [ngModel]/(ngModelChange)
  // binding stays reactive in zoneless mode. `visible()` (below)
  // recomputes whenever any of them changes.
  filterStatus    = signal<string>('');
  filterIndustry  = signal<string>('');
  filterServiceId = signal<number | ''>('');
  filterContacted = signal<'' | 'yes' | 'no'>('');
  searchTerm      = signal<string>('');

  /** Distinct industries pulled from /api/leads/industries — duplicated
   *  here so the filter dropdown can show counts without re-walking the
   *  full leads list every render. */
  industryOptions = signal<LeadIndustrySummary[]>([]);

  /** Active service offerings the user can pick from. Sourced from
   *  /api/services so the dropdown automatically adopts new entries
   *  added in the CRM Services page. */
  serviceOptions  = signal<ServiceOffering[]>([]);

  formReady = signal(false);
  draft: Lead = this.blankDraft();

  // Tabs on the right-side detail card.
  readonly tabs: { key: LeadTabKey; label: string }[] = [
    { key: 'info',       label: 'Info' },
    { key: 'contacts',   label: 'Contacts' },
    { key: 'services',   label: 'Services' },
    { key: 'assignments', label: 'Assignments' },
    { key: 'onboarding', label: 'Onboarding' },
    { key: 'feedback',   label: 'Feedback' },
    { key: 'notes',      label: 'Notes' },
  ];
  activeTab = signal<LeadTabKey>('info');

  // Feedback tab state — forms attached to the current lead via the
  // feedback_form_leads junction (migration 120), with the legacy
  // owner column as a fallback.
  leadFeedback       = signal<FeedbackForm[]>([]);
  loadingFeedback    = signal(false);
  allFeedbackForms   = signal<FeedbackForm[]>([]);
  feedbackToAttach: number | null = null;
  attachingFeedback  = signal(false);
  /** Currently-expanded feedback row on the tab (form id, or null). */
  expandedFeedback   = signal<number | null>(null);
  feedbackDetailQuestions = signal<FeedbackQuestion[]>([]);
  feedbackDetailResponses = signal<FeedbackResponse[]>([]);
  loadingFeedbackDetail   = signal(false);
  private feedbackLoadedForLead: number | null = null;

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

  /** Load form questions + this-lead-only responses so the expanded
   *  row can render answers inline. */
  private loadFeedbackDetail(formId: number) {
    const leadId = this.current()?.id;
    if (!leadId) return;
    this.loadingFeedbackDetail.set(true);
    this.feedbackDetailResponses.set([]);
    this.feedbackDetailQuestions.set([]);
    this.api.getFeedbackForm(formId).subscribe({
      next: r => this.feedbackDetailQuestions.set(r.questions ?? []),
    });
    this.api.listFeedbackResponses(formId, { lead: leadId }).subscribe({
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

  attachableFeedback = () => {
    const attached = new Set(this.leadFeedback().map(f => f.id));
    return this.allFeedbackForms().filter(f => !attached.has(f.id));
  };

  /** Split the flat list into three sections keyed off the backend's
   *  match_source annotation. Empty groups are dropped. */
  leadFeedbackGroups(): { key: string; label: string; forms: FeedbackForm[] }[] {
    const forms = this.leadFeedback();
    const lead      = forms.filter(f => f.match_source === 'lead'    || !f.match_source);
    const service   = forms.filter(f => f.match_source === 'service');
    const broadcast = forms.filter(f => f.match_source === 'broadcast');
    const groups: { key: string; label: string; forms: FeedbackForm[] }[] = [];
    if (lead.length)      groups.push({ key: 'lead',      label: 'Lead-specific',       forms: lead });
    if (service.length)   groups.push({ key: 'service',   label: 'Via a service',       forms: service });
    if (broadcast.length) groups.push({ key: 'broadcast', label: 'Default — all leads', forms: broadcast });
    return groups;
  }

  onTabClick(key: LeadTabKey, leadId: number) {
    this.activeTab.set(key);
    if (key === 'feedback') this.loadFeedback(leadId);
  }

  loadFeedback(leadId: number) {
    if (this.feedbackLoadedForLead === leadId) return;
    this.feedbackLoadedForLead = leadId;
    this.loadingFeedback.set(true);
    this.api.listFeedbackForms({ lead: leadId }).subscribe({
      next: r => { this.leadFeedback.set(r.forms ?? []); this.loadingFeedback.set(false); },
      error: () => { this.leadFeedback.set([]); this.loadingFeedback.set(false); },
    });
    if (this.allFeedbackForms().length === 0) {
      this.api.listFeedbackForms({ published: 1 }).subscribe({
        next: r => this.allFeedbackForms.set(r.forms ?? []),
      });
    }
  }

  attachFeedback(leadId: number) {
    const fid = this.feedbackToAttach;
    if (!fid) return;
    this.attachingFeedback.set(true);
    this.api.attachFeedbackFormToLead(fid, leadId).subscribe({
      next: () => {
        this.attachingFeedback.set(false);
        this.feedbackToAttach = null;
        this.feedbackLoadedForLead = null;
        this.loadFeedback(leadId);
      },
      error: () => this.attachingFeedback.set(false),
    });
  }

  async detachFeedback(f: FeedbackForm, leadId: number, e: Event) {
    e.stopPropagation();
    if (!f.id) return;
    const ok = await this.dialog.confirm(
      `Detach "${f.title}" from this lead?`,
      { title: 'Detach form', confirmLabel: 'Detach', variant: 'warning' }
    );
    if (!ok) return;
    this.api.detachFeedbackFormFromLead(f.id, leadId).subscribe(() => {
      this.feedbackLoadedForLead = null;
      this.loadFeedback(leadId);
    });
  }

  openFeedback(f: FeedbackForm) {
    if (!f.id) return;
    this.router.navigate(['/admin/feedback', f.id]);
  }

  copyLeadFeedbackLink(f: FeedbackForm, leadId: number, e: Event) {
    e.stopPropagation();
    // Attribution scheme: `?id=c{N}` for clients, `?id=l{N}` for leads,
    // `?id=0` for anonymous / public share.
    const url = `${window.location.origin}${environment.basePath}/feedback/${f.public_token}?id=l${leadId}`;
    navigator.clipboard.writeText(url);
  }

  // Services tab state — junction-row list + the catalogue picker.
  // `availableUnselectedServices` filters the catalogue against current
  // links so the dropdown can't offer dupes (UNIQUE enforces it server
  // side; this is the friendly UX layer).
  leadServices         = signal<LeadServiceLink[]>([]);
  availableServices    = signal<ServiceOffering[]>([]);
  servicePickerValue   = '';
  /** Only used when the picked catalogue service is variable-priced.
   *  Reset when the dropdown changes / the form succeeds. */
  servicePickerPrice: number | null = null;
  serviceSaving        = signal(false);
  serviceError         = signal<string | null>(null);
  availableUnselectedServices = computed(() => {
    const taken = new Set(this.leadServices().map(s => s.service_offering_id));
    return this.availableServices().filter(s => s.id !== undefined && !taken.has(s.id));
  });

  /** True when the current picker selection is a variable-priced service —
   *  drives the inline price input above the +Add button. */
  isPickedServiceVariablePriced(): boolean {
    const id = Number(this.servicePickerValue);
    if (!id) return false;
    const svc = this.availableServices().find(s => s.id === id);
    return !!svc?.is_variable_price;
  }

  /** Picker changed: prefill the price with the catalogue default when
   *  the new selection is variable-priced; clear it otherwise so a
   *  stale value from a prior pick can't leak into the payload. */
  onServicePickerChange(next: string) {
    this.servicePickerValue = next;
    const id = Number(next);
    if (id) {
      const svc = this.availableServices().find(s => s.id === id);
      if (svc?.is_variable_price) {
        const def = svc.price;
        this.servicePickerPrice = (def === null || def === undefined || (def as any) === '')
          ? null : Number(def);
        return;
      }
    }
    this.servicePickerPrice = null;
  }

  // Contacts tab state — mirrors clients-admin's contact UI exactly so
  // promote-to-client carries a contact list the client form already
  // understands.
  contacts = signal<ClientContact[]>([]);
  contactFormOpen = signal(false);
  contactSaving = signal(false);
  contactError = signal<string | null>(null);
  contactDraft: ClientContact = { first_name: '', last_name: '', position: '', email: '', verified: false, numbers: [] };
  contactNumbers = signal<Array<{ number: string; label?: string | null }>>([]);
  expandedContact = signal<number | null>(null);

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

  /** True when any filter or search box is set — drives the visibility
   *  of the "Clear" button and the empty-state copy. */
  anyFilterActive = computed(() =>
    !!this.filterStatus() || !!this.filterIndustry() ||
    this.filterServiceId() !== '' || !!this.filterContacted() ||
    !!this.searchTerm().trim()
  );

  clearFilters() {
    this.filterStatus.set('');
    this.filterIndustry.set('');
    this.filterServiceId.set('');
    this.filterContacted.set('');
    this.searchTerm.set('');
    // Strip the query params so the URL no longer deep-links to a
    // filtered view — keeps the leads-side-nav "Leads" parent active
    // instead of one of the industry children.
    this.router.navigate(['/admin/leads'], { queryParams: {} });
  }

  visible = computed(() => {
    let list = this.leads();
    if (this.filterStatus()) list = list.filter(l => (l.status || 'new') === this.filterStatus());
    if (this.filterIndustry()) list = list.filter(l => (l.industry || '') === this.filterIndustry());
    const svc = this.filterServiceId();
    if (svc !== '') list = list.filter(l => l.service_offering_id === svc);
    if (this.filterContacted() === 'yes') list = list.filter(l => !!l.contacted_at);
    else if (this.filterContacted() === 'no') list = list.filter(l => !l.contacted_at);
    const q = this.searchTerm().trim().toLowerCase();
    if (q) {
      list = list.filter(l => {
        const hay = [
          l.name, l.email, l.phone, l.company, l.industry,
          l.service_name, l.source, l.added_by_name,
          l.added_by_system ? 'system' : '',
          l.notes,
        ].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(q);
      });
    }
    const key = this.sortBy();
    if (!key) return list;
    const dir = this.sortDir() === 'asc' ? 1 : -1;
    // Stable, case-insensitive sort. Empty values sort to the end
    // regardless of direction so they don't crowd the top when sorting
    // by sparse columns like email/phone.
    // Per-key value extractor — most keys are direct columns, but a few
    // need synthesising (added_by reads "System" or the joined name;
    // contacted_at is a timestamp string we sort lexicographically since
    // ISO format sorts correctly that way).
    const extract = (l: Lead): string => {
      switch (key) {
        case 'added_by':
          return (l.added_by_system ? 'system' : (l.added_by_name || '')).toLowerCase();
        case 'service_name':
          return (l.service_name || '').toLowerCase();
        case 'contacted_at':
          return (l.contacted_at || '');
        default:
          return String((l as any)[key] ?? '').trim().toLowerCase();
      }
    };
    return [...list].sort((a, b) => {
      const av = extract(a);
      const bv = extract(b);
      if (av === '' && bv === '') return 0;
      if (av === '') return 1;
      if (bv === '') return -1;
      if (av < bv) return -1 * dir;
      if (av > bv) return  1 * dir;
      return 0;
    });
  });

  constructor() {
    // `route.url` is backed by a ReplaySubject(1) — it emits the current URL
    // to new subscribers immediately, so a separate `detectMode()` call here
    // would fire `listLeads`/`getLead` twice on first paint.
    this.route.url.subscribe(() => this.detectMode());

    // Sidenav sub-items pass ?industry=… / ?service=… on the link. Keep
    // the in-page filter dropdowns in sync with the URL so the toolbar
    // reflects what's actually being displayed.
    this.route.queryParamMap.subscribe(q => {
      this.filterIndustry.set(q.get('industry') ?? '');
      const svc = q.get('service');
      this.filterServiceId.set(svc ? +svc : '');
      const ctd = q.get('contacted');
      this.filterContacted.set(ctd === 'yes' || ctd === 'no' ? ctd : '');
    });

    // Auxiliary lookups for the filter dropdowns. Failures are swallowed
    // — both endpoints already return empty arrays on auth issues.
    this.api.listLeadIndustries().subscribe({
      next: r => this.industryOptions.set(r.industries),
      error: () => this.industryOptions.set([]),
    });
    this.api.listServiceOfferings().subscribe({
      next: r => this.serviceOptions.set((r.services || []).filter(s => s.is_active !== 0)),
      error: () => this.serviceOptions.set([]),
    });
  }

  /** Inline toggle on the list — flips contacted_at between NOW and null
   *  and PUTs the change. Optimistic update with rollback on failure,
   *  same pattern as the status dropdown. */
  toggleContacted(l: Lead) {
    if (!l.id) return;
    const wasContacted = !!l.contacted_at;
    const nextTs = wasContacted ? null : new Date().toISOString().slice(0, 19).replace('T', ' ');
    this.leads.update(list => list.map(x => x.id === l.id ? { ...x, contacted_at: nextTs } : x));
    this.api.updateLead(l.id, { ...l, contacted: !wasContacted } as any).subscribe({
      error: e => {
        this.leads.update(list => list.map(x => x.id === l.id ? { ...x, contacted_at: l.contacted_at } : x));
        this.dialog.alert(e?.error?.error || 'Failed to update contacted status', { title: 'Error', variant: 'danger' });
      },
    });
  }

  private blankDraft(): Lead {
    return {
      name: '', email: '', phone: '', address: '', company: '', url: '',
      notes: '', status: 'new', source: '',
      industry: '', service_offering_id: null, contacted_at: null,
    };
  }

  /** Flip the edit-form contacted checkbox between NOW and null. Lives
   *  on the class because Angular template expressions can't do `new
   *  Date()` directly. */
  setDraftContacted(on: boolean) {
    this.draft.contacted_at = on
      ? new Date().toISOString().slice(0, 19).replace('T', ' ')
      : null;
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
          this.closeContactForm();
          this.expandedContact.set(null);
          this.loadNotes(id);
          this.loadInfoEntries(id);
          this.loadContacts(id);
          this.loadServices(id);
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
      industry: (this.draft.industry || '').trim() || null,
      service_offering_id: this.draft.service_offering_id ?? null,
      contacted_at: this.draft.contacted_at ?? null,
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

  async del(l: Lead, ev?: Event) {
    ev?.stopPropagation();
    if (!l.id) return;
    const ok = await this.dialog.confirm(
      `Delete lead "${l.name}"? This cannot be undone.`,
      { title: 'Delete lead', confirmLabel: 'Delete', variant: 'danger' }
    );
    if (!ok) return;
    this.api.deleteLead(l.id).subscribe({
      next: () => this.loadList(),
      error: e => this.dialog.alert(e?.error?.error || 'Failed to delete', { title: 'Error', variant: 'danger' }),
    });
  }

  async delCurrent() {
    const c = this.current();
    if (!c?.id) return;
    const ok = await this.dialog.confirm(
      `Delete lead "${c.name}"? This cannot be undone.`,
      { title: 'Delete lead', confirmLabel: 'Delete', variant: 'danger' }
    );
    if (!ok) return;
    this.api.deleteLead(c.id).subscribe({
      next: () => this.router.navigate(['/admin/leads']),
      error: e => this.dialog.alert(e?.error?.error || 'Failed to delete', { title: 'Error', variant: 'danger' }),
    });
  }

  /** Inline status change from the list — fires a PUT immediately on
   *  the row's existing payload, keeps the local list in sync without a
   *  reload. */
  changeStatus(l: Lead, next: LeadStatus) {
    if (!l.id || (l.status || 'new') === next) return;
    const prev = l.status;
    // Optimistic update so the dropdown reflects the change instantly.
    this.leads.update(list => list.map(x => x.id === l.id ? { ...x, status: next } : x));
    this.api.updateLead(l.id, { ...l, status: next }).subscribe({
      error: e => {
        // Roll back on failure.
        this.leads.update(list => list.map(x => x.id === l.id ? { ...x, status: prev } : x));
        this.dialog.alert(e?.error?.error || 'Failed to update status', { title: 'Error', variant: 'danger' });
      },
    });
  }

  /** Promote-to-client direct from the list row (skips opening the lead).
   *  Mirrors the existing `promote()` on the detail view. */
  async promoteRow(l: Lead, ev?: Event) {
    ev?.stopPropagation();
    if (!l.id) return;
    const ok = await this.dialog.confirm(
      `Promote "${l.name}" to a client? Their fields will be copied into the Clients section.`,
      { title: 'Promote to client', confirmLabel: 'Promote', variant: 'warning' }
    );
    if (!ok) return;
    this.api.promoteLead(l.id).subscribe({
      next: r => this.router.navigate(['/admin/clients', r.client_id]),
      error: e => this.dialog.alert(e?.error?.error || 'Failed to promote lead', { title: 'Error', variant: 'danger' }),
    });
  }

  async promote() {
    const c = this.current();
    if (!c?.id) return;
    const ok = await this.dialog.confirm(
      `Promote "${c.name}" to a client? Their fields will be copied into the Clients section.`,
      { title: 'Promote to client', confirmLabel: 'Promote', variant: 'warning' }
    );
    if (!ok) return;

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

  // ----- Contacts -----
  /** Refresh the list of contacts for the active lead. Called after every
   *  mutation so the visible list always matches what the backend holds. */
  private loadContacts(leadId: number) {
    this.api.listLeadContacts(leadId).subscribe({
      next: r => this.contacts.set(r.contacts),
      error: () => this.contacts.set([]),
    });
  }

  toggleContact(c: ClientContact) {
    if (!c.id) return;
    this.expandedContact.set(this.expandedContact() === c.id ? null : c.id);
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

  addNumber() { this.contactNumbers.update(list => [...list, { number: '', label: '' }]); }
  removeNumber(i: number) { this.contactNumbers.update(list => list.filter((_, idx) => idx !== i)); }

  editContact(c: ClientContact) {
    this.contactDraft = { ...c };
    this.contactNumbers.set((c.numbers || []).map(n => ({ number: n.number, label: n.label ?? '' })));
    this.contactError.set(null);
    this.contactFormOpen.set(true);
  }

  saveContact() {
    const leadId = this.current()?.id;
    if (!leadId) return;
    const first = (this.contactDraft.first_name || '').trim();
    if (!first) { this.contactError.set('First name is required'); return; }
    const email = (this.contactDraft.email || '').trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.contactError.set('Invalid email');
      return;
    }
    this.contactError.set(null);
    this.contactSaving.set(true);

    const payload: ClientContact = {
      ...this.contactDraft,
      first_name: first,
      email: email || null,
      // Strip blank rows before they hit the API — the server already
      // ignores them but the round-trip is cleaner this way.
      numbers: this.contactNumbers().filter(n => (n.number || '').trim() !== ''),
    };

    const after = () => {
      this.contactSaving.set(false);
      this.closeContactForm();
      this.loadContacts(leadId);
    };
    const onError = (e: any) => {
      this.contactSaving.set(false);
      this.contactError.set(e?.error?.error || 'Failed to save contact');
    };

    if (this.contactDraft.id) {
      this.api.updateLeadContact(leadId, this.contactDraft.id, payload).subscribe({ next: after, error: onError });
    } else {
      this.api.createLeadContact(leadId, payload).subscribe({ next: after, error: onError });
    }
  }

  async deleteContact(c: ClientContact) {
    const leadId = this.current()?.id;
    if (!leadId || !c.id) return;
    const ok = await this.dialog.confirm(
      `Delete contact "${c.first_name} ${c.last_name || ''}"?`,
      { title: 'Delete contact', confirmLabel: 'Delete', variant: 'danger' }
    );
    if (!ok) return;
    this.api.deleteLeadContact(leadId, c.id).subscribe(() => this.loadContacts(leadId));
  }

  makePrimary(c: ClientContact) {
    const leadId = this.current()?.id;
    if (!leadId || !c.id) return;
    this.api.setPrimaryLeadContact(leadId, c.id).subscribe(() => this.loadContacts(leadId));
  }

  // ----- Services -----
  // Loads both sides of the picker on lead open: the catalogue (for the
  // dropdown) AND the currently-attached links (for the badges + dedup).
  private loadServices(leadId: number) {
    this.servicePickerValue = '';
    this.servicePickerPrice = null;
    this.serviceError.set(null);
    this.api.listLeadServices(leadId).subscribe({
      next: r => this.leadServices.set(r.services ?? []),
      error: () => this.leadServices.set([]),
    });
    this.api.listServiceOfferings().subscribe({
      next: r => this.availableServices.set(r.services ?? []),
      error: () => this.availableServices.set([]),
    });
  }

  addService() {
    const leadId = this.current()?.id;
    const soid   = Number(this.servicePickerValue);
    if (!leadId || !soid) return;

    let priceOverride: number | null = null;
    if (this.isPickedServiceVariablePriced()) {
      const raw = this.servicePickerPrice;
      if (raw === null || raw === undefined || (raw as any) === '' || Number(raw) < 0) {
        this.serviceError.set('Enter a price for this variable-priced service');
        return;
      }
      priceOverride = Number(raw);
    }

    this.serviceSaving.set(true);
    this.serviceError.set(null);
    this.api.addLeadService(leadId, soid, priceOverride !== null ? { price: priceOverride } : undefined).subscribe({
      next: () => {
        this.serviceSaving.set(false);
        this.servicePickerValue = '';
        this.servicePickerPrice = null;
        this.loadServices(leadId);
      },
      error: e => {
        this.serviceSaving.set(false);
        this.serviceError.set(e?.error?.error || 'Could not add service.');
      },
    });
  }

  removeService(s: LeadServiceLink) {
    const leadId = this.current()?.id;
    if (!leadId) return;
    this.api.removeLeadService(leadId, s.id).subscribe(() => this.loadServices(leadId));
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
  async deleteNote(n: LeadNote) {
    const leadId = this.current()?.id;
    if (!leadId || !n.id) return;
    const ok = await this.dialog.confirm(
      `Delete note "${n.title}"?`,
      { title: 'Delete note', confirmLabel: 'Delete', variant: 'danger' }
    );
    if (!ok) return;
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
  async deleteInfo(i: LeadInfo) {
    const leadId = this.current()?.id;
    if (!leadId || !i.id) return;
    const ok = await this.dialog.confirm(
      `Delete "${i.name}"?`,
      { title: 'Delete info', confirmLabel: 'Delete', variant: 'danger' }
    );
    if (!ok) return;
    this.api.deleteLeadInfo(leadId, i.id).subscribe(() => this.loadInfoEntries(leadId));
  }
}
