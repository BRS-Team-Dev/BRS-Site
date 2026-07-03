import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import { DialogService } from '../../core/dialog';
import { DecimalPipe } from '@angular/common';
import { FeedbackForm, FeedbackKind, FeedbackQuestion, FeedbackQuestionType, FeedbackResponse, ServiceClientLink, ServiceClientStatus, ServiceOffering } from '../../core/models';
import { FormSubmissionsList } from '../../shared/form-submissions-list';

interface LinkedOnboardingForm {
  id: number;
  slug: string;
  title: string;
  is_published: 0 | 1;
}

/**
 * Services section (`/admin/services`) — a standalone catalogue of the
 * services the company sells (`service_offerings` table). Standard list-page:
 * toolbar + table, with create/edit via the global modal. This is NOT an
 * onboarding template; onboarding forms nested under Services stay in the
 * Services sidenav group.
 */
@Component({
  selector: 'app-services-admin',
  imports: [FormsModule, RouterLink, DecimalPipe, FormSubmissionsList],
  template: `
    <div class="toolbar">
      <h1>Services</h1>
      <span class="spacer"></span>
      <span class="muted small">{{ services().length }} service(s)</span>
      <button class="primary" (click)="openNew()">+ New service</button>
    </div>

    @if (services().length === 0) {
      <div class="empty">
        <p class="muted">No services yet.</p>
        <button class="primary" (click)="openNew()">Add your first service</button>
      </div>
    } @else {
      <div class="table-wrap">
        <table class="data">
          <thead><tr>
            <th>Service</th>
            <th>Price</th>
            <th>Status</th>
            <th></th>
          </tr></thead>
          <tbody>
            @for (s of services(); track s.id) {
              <tr (click)="selectService(s)" [class.selected]="selectedServiceId() === s.id">
                <td>
                  <strong>{{ s.name }}</strong>
                  @if (s.description) { <div class="muted small desc">{{ s.description }}</div> }
                </td>
                <td>{{ priceLabel(s) }}</td>
                <td>
                  <span class="pill" [class.muted-pill]="!isActive(s)">
                    {{ isActive(s) ? 'Active' : 'Inactive' }}
                  </span>
                </td>
                <td class="actions">
                  <button class="ghost icon-btn" (click)="openEdit(s, $event)" title="Edit">✎</button>
                  <button class="ghost icon-btn danger" (click)="del(s, $event)" title="Delete">✕</button>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <!-- Clients on the selected service. Lives on the page itself
           (NOT in the modal), so it stays visible while you scroll
           the services list or click between rows. Cleared if no
           service is selected. -->
      @if (selectedServiceId() !== null) {
        <div class="selected-panel">
          <div class="toolbar">
            <h2>{{ selectedServiceName() }}</h2>
            <span class="spacer"></span>
            <button class="ghost" (click)="clearSelection()" title="Clear selection">✕</button>
          </div>

          <!-- Tab strip — clients vs feedback forms attached to this
               service. Both tabs always available; the active one drives
               which body renders below. -->
          <div class="tab-strip">
            <button class="tab" [class.active]="panelTab() === 'clients'"
                    (click)="setPanelTab('clients')">
              Clients <span class="muted small">· {{ serviceClients().length }}</span>
            </button>
            <button class="tab" [class.active]="panelTab() === 'feedback'"
                    (click)="setPanelTab('feedback')">
              Feedback <span class="muted small">· {{ serviceFeedback().length }}</span>
            </button>
            <button class="tab" [class.active]="panelTab() === 'onboarding'"
                    (click)="setPanelTab('onboarding')">
              Onboarding
            </button>
          </div>

          @if (panelTab() === 'clients') {
            @if (loadingServiceClients()) {
              <p class="muted small selected-empty">Loading clients…</p>
            } @else if (serviceClients().length === 0) {
              <p class="muted small selected-empty">No clients currently on this service.</p>
            } @else {
              <h3 class="panel-sub">Active <span class="muted small">· {{ activeClients().length }}</span></h3>
              @if (activeClients().length === 0) {
                <p class="muted small selected-empty">All clients are completed.</p>
              } @else {
                <div class="table-wrap">
                  <table class="data">
                    <thead><tr>
                      <th>Name</th>
                      <th>Company</th>
                      <th>Email</th>
                      <th>Status</th>
                      <th>Source</th>
                    </tr></thead>
                    <tbody>
                      @for (c of activeClients(); track c.email + ':' + c.source) {
                        <tr (click)="openClientDetail(c)">
                          <td><strong>{{ c.name || '—' }}</strong></td>
                          <td>{{ c.company || '—' }}</td>
                          <td>{{ c.email || '—' }}</td>
                          <td><span class="status-pill" [attr.data-status]="c.status">{{ statusLabel(c.status) }}</span></td>
                          <td><span class="sc-badge" [class.onboarding]="c.source === 'onboarding'">{{ c.source }}</span></td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              }

              @if (completedClients().length > 0) {
                <h3 class="panel-sub completed-head">Previously completed <span class="muted small">· {{ completedClients().length }}</span></h3>
                <div class="table-wrap completed-wrap">
                  <table class="data">
                    <thead><tr>
                      <th>Name</th>
                      <th>Company</th>
                      <th>Email</th>
                      <th>Status</th>
                      <th>Source</th>
                    </tr></thead>
                    <tbody>
                      @for (c of completedClients(); track c.email + ':' + c.source) {
                        <tr (click)="openClientDetail(c)">
                          <td><strong>{{ c.name || '—' }}</strong></td>
                          <td>{{ c.company || '—' }}</td>
                          <td>{{ c.email || '—' }}</td>
                          <td><span class="status-pill" [attr.data-status]="c.status">{{ statusLabel(c.status) }}</span></td>
                          <td><span class="sc-badge" [class.onboarding]="c.source === 'onboarding'">{{ c.source }}</span></td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              }
            }
          } @else if (panelTab() === 'feedback') {
            <!-- Attach flow — pick a published form from the dropdown
                 and click Attach. If the selected form already
                 broadcasts to all clients / leads (or is already tied
                 to a different service), we CLONE it and attach the
                 clone; otherwise we just set service_offering_id on
                 the source form. -->
            <div class="panel-actions">
              <select [(ngModel)]="feedbackToAttach" name="fb_attach_svc">
                <option [ngValue]="null">— pick a form to attach —</option>
                @for (f of attachableServiceFeedback(); track f.id) {
                  <option [ngValue]="f.id">
                    {{ f.title }} ({{ f.kind }}){{ f.broadcast_to_all_clients || f.broadcast_to_all_leads || (f.service_offering_id && f.service_offering_id !== selectedServiceId()) ? ' — will clone' : '' }}
                  </option>
                }
              </select>
              <button class="primary"
                      [disabled]="!feedbackToAttach || attachingServiceFeedback()"
                      (click)="attachFormToService()">
                {{ attachingServiceFeedback() ? 'Attaching…' : 'Attach' }}
              </button>
              <span class="spacer"></span>
              <a class="ghost small" routerLink="/admin/feedback">Manage forms →</a>
            </div>
            @if (loadingServiceFeedback()) {
              <p class="muted small selected-empty">Loading feedback…</p>
            } @else if (serviceFeedback().length === 0) {
              <p class="muted small selected-empty">No feedback forms attached to this service.</p>
            } @else {
              <div class="fb-list">
                @for (f of serviceFeedback(); track f.id) {
                  <div class="fb-row" [class.open]="expandedFeedback() === f.id">
                    <div class="fb-head" (click)="toggleFeedbackRow(f.id!)">
                      <span class="caret">›</span>
                      <div class="fb-meta">
                        <strong>{{ f.updated_at || f.created_at || '—' }}</strong>
                        <span class="fb-title">{{ f.title }}</span>
                        <span class="kind-pill" [attr.data-kind]="f.kind">{{ f.kind }}</span>
                      </div>
                      <span class="muted small">#{{ f.id }} · {{ f.response_count || 0 }} response{{ f.response_count === 1 ? '' : 's' }}</span>
                    </div>
                    @if (expandedFeedback() === f.id) {
                      <div class="fb-body">
                        @if (f.description) {
                          <p class="muted small" style="margin-top: 0;">{{ f.description }}</p>
                        }

                        @if (loadingFeedbackDetail()) {
                          <p class="muted small">Loading submissions…</p>
                        } @else {

                          <!-- Analytics — polls + surveys get an aggregated
                               summary at the top so the reader gets the
                               shape of the responses before drilling in. -->
                          @if (showAnalyticsFor(f)) {
                            <div class="fb-analytics">
                              <h4>Analytics <span class="muted small">· {{ feedbackDetailResponses().length }} submission{{ feedbackDetailResponses().length === 1 ? '' : 's' }}</span></h4>
                              @for (q of visibleAnalyticsQs(); track q.id) {
                                <div class="ana-block" [class.collapsed]="isAnaCollapsed(q.id!)">
                                  <div class="ana-head" (click)="toggleAna(q.id!)">
                                    <span class="caret">›</span>
                                    <strong>{{ q.label }}</strong>
                                    @if (q.type === 'rating') {
                                      <span class="pill avg">Avg {{ ratingAverage(q) | number:'1.1-1' }} / 5</span>
                                    }
                                    <span class="muted small">{{ q.type.replace('_', ' ') }}</span>
                                  </div>
                                  @if (!isAnaCollapsed(q.id!)) {
                                    <div class="bar-list">
                                      @for (row of statsFor(q); track row.label) {
                                        <div class="bar-row">
                                          <span class="bar-label">{{ row.label }}</span>
                                          <div class="bar-track"><div class="bar-fill" [style.width.%]="row.pct"></div></div>
                                          <span class="bar-count">{{ row.count }}</span>
                                          <span class="bar-pct muted small">{{ row.pct | number:'1.0-0' }}%</span>
                                        </div>
                                      }
                                    </div>
                                  }
                                </div>
                              }
                              @if (aggregatableQs().length > 1) {
                                <button type="button" class="ghost view-all-btn"
                                        (click)="analyticsShowAll.set(!analyticsShowAll())">
                                  @if (analyticsShowAll()) {
                                    Hide extra analytics
                                  } @else {
                                    View all {{ aggregatableQs().length }} analytics ↓
                                  }
                                </button>
                              }
                            </div>
                          }

                          <!-- Individual submissions — same shape as the
                               client/lead tab: date/IP header, then each
                               answer labelled with its question. Shows
                               everyone who submitted, since this is the
                               service-wide view. -->
                          @if (feedbackDetailResponses().length === 0) {
                            <p class="muted small">No submissions yet.</p>
                          } @else {
                            <h4 class="fb-body-sub">Submissions</h4>
                            @for (r of feedbackDetailResponses(); track r.id) {
                              <div class="submission" [class.open]="isSubmissionOpen(r.id)">
                                <div class="submission-head" (click)="toggleSubmission(r.id)">
                                  <span class="caret">›</span>
                                  <strong>{{ r.submitted_at }}</strong>
                                  @if (r.client_name) {
                                    <span class="badge client">Client · {{ r.client_name }}</span>
                                  } @else if (r.lead_name) {
                                    <span class="badge lead">Lead · {{ r.lead_name }}</span>
                                  } @else {
                                    <span class="muted small">Anonymous</span>
                                  }
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
                        }

                        <div class="fb-actions">
                          <button class="ghost small" (click)="openFeedback(f); $event.stopPropagation()">Open builder →</button>
                        </div>
                      </div>
                    }
                  </div>
                }
              </div>
            }
          } @else if (panelTab() === 'onboarding') {
            <p class="muted small">
              Every form + multipart-form submission linked to this service.
              Click a submission to see the captured fields.
            </p>
            <app-form-submissions-list type="service" [recordId]="selectedServiceId()!" />
          }
        </div>
      }
    }

    @if (modalOpen()) {
      <div class="modal-backdrop" (click)="close()">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-head">
            <h2>{{ draft.id ? 'Edit service' : 'New service' }}</h2>
            <button class="ghost icon-btn" (click)="close()">✕</button>
          </div>
          <div class="modal-body">
            @if (error()) { <p class="error-msg">{{ error() }}</p> }

            <!-- Onboarding CTA — only meaningful for existing services
                 (the link goes off forms.service_offering_id which
                 needs a real service id). On the "+ New" flow we hide
                 this row entirely; the user can come back after first
                 save and the link will appear. -->
            @if (draft.id) {
              <div class="onboarding-cta">
                @if (loadingLinkedForm()) {
                  <span class="muted small">Looking up onboarding…</span>
                } @else if (linkedForm(); as lf) {
                  <div class="linked">
                    <div class="info">
                      <span class="muted small">Onboarding form</span>
                      <strong>{{ lf.title }}</strong>
                      @if (!lf.is_published) { <span class="badge muted">Draft</span> }
                    </div>
                    <a class="primary"
                       [routerLink]="['/admin/onboarding', lf.id, 'edit']"
                       (click)="close()">
                      Open onboarding →
                    </a>
                  </div>
                } @else {
                  <div class="unlinked">
                    <div class="info">
                      <span class="muted small">Onboarding form</span>
                      <strong>Not linked yet</strong>
                    </div>
                    <a class="primary"
                       [routerLink]="['/admin/onboarding/new']"
                       [queryParams]="{ service: draft.id }"
                       (click)="close()">
                      + Create onboarding for this service
                    </a>
                  </div>
                }
              </div>
            }

            <label>Name</label>
            <input [(ngModel)]="draft.name" name="name" placeholder="e.g. Web Design" />

            <label>Description</label>
            <textarea [(ngModel)]="draft.description" name="description" rows="3"
              placeholder="What this service includes…"></textarea>

            <div class="row two-col">
              <div>
                <label>Price ({{ draft.currency || 'GBP' }})</label>
                <input type="number" min="0" step="0.01"
                  [(ngModel)]="draft.price" name="price" placeholder="0.00" />
              </div>
              <div>
                <label>Billing</label>
                <select [(ngModel)]="draft.payment_type" name="payment_type">
                  <option value="one_off">One-off</option>
                  <option value="recurring">Recurring</option>
                </select>
              </div>
            </div>

            @if (draft.payment_type === 'recurring') {
              <label>Repeat every</label>
              <select [(ngModel)]="draft.repeat_duration" name="repeat_duration">
                <option [ngValue]="null">— pick a cadence —</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="yearly">Yearly</option>
              </select>
            }

            <label class="inline-toggle">
              <input type="checkbox" [(ngModel)]="draft.is_active" name="is_active" />
              Active (offered to clients)
            </label>

            <label class="inline-toggle">
              <input type="checkbox" [(ngModel)]="draft.allow_multiple" name="allow_multiple" />
              Allow multiple per client
              <span class="muted small inline-hint">
                Same client can have several instances of this service
                (re-purchasable). Leave off for subscription-style services.
              </span>
            </label>
          </div>
          <div class="modal-foot">
            <button class="ghost" (click)="close()">Cancel</button>
            <button class="primary" (click)="save()" [disabled]="saving()">
              {{ saving() ? 'Saving…' : 'Save' }}
            </button>
          </div>
        </div>
      </div>
    }

  `,
  styles: [`
    td.actions { text-align: right; white-space: nowrap; }
    td .desc { margin-top: 2px; max-width: 460px; }
    .pill { display: inline-block; padding: 2px 10px; border-radius: 999px;
      font-size: 12px; background: color-mix(in srgb, var(--primary) 18%, transparent);
      color: var(--primary); border: 1px solid color-mix(in srgb, var(--primary) 40%, transparent); }
    .pill.muted-pill { background: transparent; color: var(--muted); border-color: var(--line); }
    .modal-body .inline-toggle {
      display: grid; grid-template-columns: auto 1fr; column-gap: 8px;
      align-items: center; margin-top: 14px;
      color: var(--fg); font-size: 14px; font-weight: 500;
      text-transform: none; letter-spacing: normal;
      cursor: pointer;
    }
    .modal-body .inline-toggle input { width: auto; }
    .modal-body .inline-toggle .inline-hint {
      grid-column: 2; margin-top: 2px; line-height: 1.4;
    }
    .row.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

    /* Onboarding-form CTA at the top of the Edit Service modal. Two
       visual states: .linked (form already attached, gold-tinted) and
       .unlinked (no form yet, hint to create one). Both wrap a left
       info block + a primary action button on the right. */
    .onboarding-cta {
      margin-bottom: 18px; padding: 14px 16px;
      background: var(--bg-3); border: 1px solid var(--line);
      border-radius: var(--radius);
    }
    .onboarding-cta .linked,
    .onboarding-cta .unlinked {
      display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
    }
    .onboarding-cta .info { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
    .onboarding-cta .info strong { font-size: 14px; }
    .onboarding-cta .linked {
      box-shadow: inset 3px 0 0 var(--success);
      margin: -14px -16px 0; padding: 14px 16px;
      border-radius: var(--radius) var(--radius) 0 0;
    }
    .onboarding-cta a.primary { white-space: nowrap; }
    .onboarding-cta .badge {
      padding: 1px 8px; border-radius: 999px;
      background: var(--bg-2); color: var(--muted);
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.4px;
    }

    /* The global .table-wrap min-height: 80vh pushes anything that
       sits BELOW the services table off-screen — fine on most list
       pages but here it hides the on-page Clients panel. Drop the
       min-height so the table is only as tall as its content. */
    :host .table-wrap { min-height: 0; }

    /* Selected row in the services table — gold left border + tinted
       bg so it reads as "this is the row whose clients are shown
       below". */
    table.data tbody tr.selected td {
      background: color-mix(in oklab, var(--primary), transparent 88%);
    }
    table.data tbody tr.selected td:first-child {
      box-shadow: inset 3px 0 0 var(--primary);
    }

    /* On-page clients panel — sits below the services table. Outer
       horizontal margin matches the global .table-wrap (24px) so the
       panel header and the table inside line up vertically with the
       services list above. */
    .selected-panel {
      margin: 24px 24px 48px;
      padding-top: 12px;
      padding-bottom: 24px;
      border-top: 1px solid var(--line);
    }
    .selected-panel .toolbar { padding: 0 0 12px; }
    .selected-panel .toolbar h2 { margin: 0; font-size: 16px; }

    /* Tab strip across the top of the selected-service panel. Matches
       the underline-tab pattern used elsewhere (taskboard, leads detail). */
    .tab-strip { display: flex; gap: 4px; border-bottom: 1px solid var(--line); margin-bottom: 16px; }
    .tab-strip .tab { background: transparent; border: 0; padding: 10px 14px; cursor: pointer;
      color: var(--muted); font-size: 13px; font-weight: 500;
      border-bottom: 2px solid transparent; margin-bottom: -1px; }
    .tab-strip .tab:hover { color: var(--fg); }
    .tab-strip .tab.active { color: var(--fg); border-bottom-color: var(--primary); }

    .panel-actions { display: flex; align-items: center; gap: 10px; padding: 0 0 12px; }
    .panel-actions .spacer { flex: 1; }
    .panel-actions > * { white-space: nowrap; flex-shrink: 0; }
    .panel-actions select { flex: 1; min-width: 0; white-space: normal; }
    .panel-actions a.primary { padding: 6px 12px; font-size: 13px; border-radius: var(--radius-sm); }
    .panel-actions a.ghost   { padding: 6px 10px; font-size: 12px; }

    /* Feedback tab expandable rows — same shape as the client/lead
       feedback tabs so the interaction is consistent across the CRM. */
    .fb-list { display: flex; flex-direction: column; gap: 6px; }
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

    .fb-body { padding: 12px 14px 14px; border-top: 1px solid var(--line);
      background: var(--bg-2); }
    .fb-body-sub { margin: 14px 0 8px; font-size: 12px;
      text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); }
    .fb-actions { display: flex; gap: 8px; align-items: center; margin-top: 10px;
      padding-top: 10px; border-top: 1px dashed var(--line); }
    .fb-actions button { white-space: nowrap; }

    /* Analytics inline within an expanded feedback row */
    .fb-analytics { margin-top: 4px; padding: 12px 14px;
      background: var(--bg); border: 1px solid var(--line);
      border-radius: var(--radius-sm); }
    .fb-analytics h4 { margin: 0 0 8px; font-size: 12px;
      text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); }
    .ana-block { padding: 10px 0; border-top: 1px solid var(--line); }
    .ana-block:first-of-type { border-top: 0; }
    .ana-head { display: flex; align-items: center; gap: 10px;
      margin-bottom: 8px; cursor: pointer; user-select: none; }
    .ana-head strong { font-size: 13px; flex: 1; transition: color .12s; }
    .ana-head:hover strong { color: var(--primary); }
    .ana-head .muted { text-transform: capitalize; }
    .ana-head .caret { display: inline-block; transition: transform .12s;
      color: var(--muted); font-size: 14px; width: 12px;
      transform: rotate(90deg); }
    .ana-block.collapsed .ana-head { margin-bottom: 0; }
    .ana-block.collapsed .ana-head .caret { transform: rotate(0); }
    .ana-head .pill.avg { background: color-mix(in oklab, var(--primary), transparent 78%);
      color: var(--primary); padding: 2px 10px; border-radius: 999px;
      font-size: 11px; font-weight: 700; }

    .bar-list { display: flex; flex-direction: column; gap: 6px; }
    .bar-row  { display: grid; grid-template-columns: 60px 1fr 40px 44px;
      align-items: center; gap: 10px; font-size: 13px; }
    .bar-label { color: var(--fg); overflow: hidden; text-overflow: ellipsis;
      white-space: nowrap; }
    .bar-track { position: relative; height: 8px; background: var(--bg-3);
      border-radius: 999px; overflow: hidden; }
    .bar-fill  { position: absolute; top: 0; left: 0; height: 100%;
      background: var(--primary); border-radius: 999px;
      transition: width .2s ease; }
    .bar-count { text-align: right; font-variant-numeric: tabular-nums;
      color: var(--fg); font-weight: 600; }
    .bar-pct   { text-align: right; font-variant-numeric: tabular-nums; }
    .view-all-btn {
      width: 100%; margin-top: 10px; padding: 8px;
      border: 1px dashed var(--line); border-radius: var(--radius-sm);
      background: transparent; color: var(--muted); cursor: pointer;
      font-size: 13px;
    }
    .view-all-btn:hover { color: var(--primary); border-color: var(--primary); }

    /* Individual submissions */
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
    .badge { padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; }
    .badge.client { background: color-mix(in oklab, var(--primary), transparent 78%); color: var(--primary); }
    .badge.lead   { background: color-mix(in oklab, var(--success), transparent 78%); color: var(--success); }
    .answer-row { padding: 4px 0; }
    .answer-row label { display: block; color: var(--muted);
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
      margin: 0 0 3px 0; }
    .selected-panel .table-wrap {
      padding: 0; margin: 0;
      min-height: 0; max-height: 360px; overflow-y: auto;
    }
    .selected-panel .selected-empty { margin: 6px 0 16px; }

    /* Section heading inside the panel — separates Active from
       Previously completed. Smaller than the panel's h2 so the
       hierarchy reads h2 → h3. */
    .panel-sub { margin: 14px 0 8px; font-size: 14px; font-weight: 600; }
    .panel-sub.completed-head { margin-top: 22px; }

    /* Completed table is muted so the active list stays the primary
       read; clicks still work and rows still navigate to detail. */
    .selected-panel .completed-wrap table.data tbody tr { opacity: 0.6; }
    .selected-panel .completed-wrap table.data tbody tr:hover { opacity: 1; }
    .sc-badge {
      display: inline-block;
      padding: 1px 8px; border-radius: 999px;
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.4px;
      background: var(--bg-2); color: var(--muted);
    }
    .sc-badge.onboarding {
      background: rgba(212, 169, 58, 0.15); color: var(--primary);
    }

    /* Workflow status pill — colour-coded per state. The chip variant
       on the panel uses the same data-status hook with bigger padding
       + selectable border so it reads as an action target. */
    .status-pill, .status-chip {
      display: inline-block;
      padding: 2px 10px; border-radius: 999px;
      font-size: 12px; font-weight: 600; letter-spacing: 0.3px;
      background: var(--bg-2); color: var(--muted);
      border: 1px solid transparent;
    }
    /* 8-state colour scheme — mirrored from service-client-detail. */
    .status-pill[data-status="new"], .status-chip[data-status="new"] {
      background: color-mix(in oklab, var(--muted), transparent 78%); color: var(--muted);
    }
    .status-pill[data-status="onboarding"], .status-chip[data-status="onboarding"] {
      background: color-mix(in oklab, #8aa9ff, transparent 80%); color: #8aa9ff;
    }
    .status-pill[data-status="submitted"], .status-chip[data-status="submitted"] {
      background: color-mix(in oklab, var(--warning), transparent 80%); color: var(--warning);
    }
    .status-pill[data-status="qualified"], .status-chip[data-status="qualified"] {
      background: color-mix(in oklab, var(--primary), transparent 78%); color: var(--primary);
    }
    .status-pill[data-status="to_do"], .status-chip[data-status="to_do"] {
      background: color-mix(in oklab, #b48aff, transparent 80%); color: #b48aff;
    }
    .status-pill[data-status="in_progress"], .status-chip[data-status="in_progress"] {
      background: color-mix(in oklab, var(--primary), transparent 80%); color: var(--primary);
    }
    .status-pill[data-status="done"], .status-chip[data-status="done"] {
      background: color-mix(in oklab, var(--success), transparent 78%); color: var(--success);
    }
    .status-pill[data-status="on_hold"], .status-chip[data-status="on_hold"] {
      background: color-mix(in oklab, var(--danger), transparent 80%); color: var(--danger);
    }

    /* Client-tracking panel — reuses the global .modal* shell. The
       extra padding around modal-head fits a 2-line title (name +
       service context) without crowding. */
    .client-panel .modal-head {
      align-items: flex-start; gap: 12px;
    }
    .client-panel .modal-head h2 {
      margin: 0; font-size: 16px;
    }
    .client-panel .card-title {
      font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;
      color: var(--muted); margin: 18px 0 10px; font-weight: 600;
    }
    .client-panel .card-title:first-child { margin-top: 0; }

    /* Chip grid for status selection. Chips inherit the colour scheme
       from .status-chip[data-status="…"] above; .selected adds a solid
       border so the current value reads as "active". */
    .status-grid {
      display: flex; flex-wrap: wrap; gap: 8px;
    }
    .status-chip {
      cursor: pointer; padding: 6px 14px; font-size: 13px;
      transition: transform 0.1s, border-color 0.15s;
    }
    .status-chip:hover:not(:disabled) {
      transform: translateY(-1px);
      border-color: currentColor;
    }
    .status-chip.selected { border-color: currentColor; }
    .status-chip:disabled { opacity: 0.5; cursor: not-allowed; }

    /* Two-up cards for the navigation deep-links. Disabled state is
       a non-anchor div so router-link rules don't fight it. */
    .link-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
    }
    .link-card {
      display: flex; flex-direction: column; gap: 4px;
      padding: 14px 16px; border-radius: var(--radius);
      background: var(--bg-3); border: 1px solid var(--line);
      color: var(--fg); text-decoration: none;
      transition: border-color 0.15s, transform 0.15s;
    }
    .link-card:hover { border-color: var(--primary); transform: translateY(-1px); }
    .link-card strong { font-size: 14px; }
    .link-card.disabled { opacity: 0.6; cursor: not-allowed; }
    .link-card.disabled:hover { transform: none; border-color: var(--line); }
  `],
})
export class ServicesAdmin {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private dialog = inject(DialogService);

  services = signal<ServiceOffering[]>([]);

  modalOpen = signal(false);
  saving = signal(false);
  error = signal<string | null>(null);

  /** Currently-selected service id. Drives the on-page Clients panel
   *  below the services list. Set by clicking a row OR by the
   *  sidenav's ?service=<id> deep link. Independent of the edit modal
   *  — the panel stays visible while the modal is closed. */
  selectedServiceId = signal<number | null>(null);
  selectedServiceName = signal<string>('');

  /** Clients tied to the currently-selected service. */
  serviceClients = signal<ServiceClientLink[]>([]);
  loadingServiceClients = signal(false);

  /** Attach dropdown state — the id the user picked, whether an
   *  attach is in flight, and the catalogue of published forms
   *  loaded once per session. Cloning is opaque to the caller: the
   *  attach method inspects the picked form and decides whether
   *  to hit clone or a plain PUT. */
  feedbackToAttach: number | null = null;
  attachingServiceFeedback = signal(false);
  allPublishedFeedback     = signal<FeedbackForm[]>([]);

  /** Forms available to attach = published catalogue minus what's
   *  already attached to THIS service (their service_offering_id
   *  matches). Broadcasted / other-service forms stay in the list
   *  because they can still be cloned onto this service. */
  attachableServiceFeedback = () => {
    const svcId = this.selectedServiceId();
    const attached = new Set(this.serviceFeedback().map(f => f.id));
    return this.allPublishedFeedback().filter(f =>
      !attached.has(f.id)
      && !(f.service_offering_id === svcId),
    );
  };

  attachFormToService(): void {
    const fid   = this.feedbackToAttach;
    const svcId = this.selectedServiceId();
    if (!fid || !svcId) return;
    const source = this.allPublishedFeedback().find(f => f.id === fid);
    if (!source) return;

    // Clone branch — source is broadcasting OR already tied to a
    // different service. Cloning preserves the source's behavior for
    // its existing audience while giving this service its own copy
    // with the service name suffixed onto the title.
    const mustClone =
      !!source.broadcast_to_all_clients ||
      !!source.broadcast_to_all_leads   ||
      (source.service_offering_id != null && source.service_offering_id !== svcId);

    this.attachingServiceFeedback.set(true);
    const done = () => {
      this.attachingServiceFeedback.set(false);
      this.feedbackToAttach = null;
      this.loadServiceFeedback(svcId);
    };
    if (mustClone) {
      const svcName = this.selectedServiceName();
      this.api.cloneFeedbackForm(fid, { service_offering_id: svcId, service_name: svcName }).subscribe({
        next: () => done(),
        error: () => this.attachingServiceFeedback.set(false),
      });
    } else {
      // Direct-attach path — just set service_offering_id on the source.
      this.api.updateFeedbackForm(fid, { service_offering_id: svcId }).subscribe({
        next: () => done(),
        error: () => this.attachingServiceFeedback.set(false),
      });
    }
  }

  /** Feedback forms attached to the currently-selected service (i.e.
   *  rows whose service_offering_id matches selectedServiceId). The
   *  list is reloaded on selection change. */
  serviceFeedback = signal<FeedbackForm[]>([]);
  loadingServiceFeedback = signal(false);

  /** Which tab the selected-service panel is showing. */
  panelTab = signal<'clients' | 'feedback' | 'onboarding'>('clients');
  setPanelTab(t: 'clients' | 'feedback' | 'onboarding') { this.panelTab.set(t); }

  /** Split the unified list by lifecycle so the panel can render two
   *  tables — "Active" (anything still in flight) on top, "Previously
   *  completed" (status === done) below. */
  activeClients    = computed(() => this.serviceClients().filter(c => c.status !== 'done'));
  completedClients = computed(() => this.serviceClients().filter(c => c.status === 'done'));

  /** Onboarding form linked to the service currently being edited.
   *  Drives the CTA at the top of the modal: link/view if present,
   *  prompt to create if null. Fetched in openEdit; cleared in
   *  openNew. */
  linkedForm = signal<LinkedOnboardingForm | null>(null);
  loadingLinkedForm = signal(false);

  /** 8-state workflow surfaced so the table pill can render a
   *  title-cased label off the raw enum value. Source of truth is
   *  the matching enum in client_service_offerings (migration 117). */
  readonly statusOptions: ServiceClientStatus[] =
    ['new','onboarding','submitted','qualified','to_do','in_progress','done','on_hold'];

  /** Title-cased label for the pill. */
  statusLabel(s: ServiceClientStatus): string {
    // Snake_case → title case ("in_progress" → "In Progress").
    return s.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  /** Click on a client row navigates to the full-page detail at
   *  /admin/services/:sid/client/:key — keyed by source so the
   *  backend can fetch from the right table. */
  openClientDetail(c: ServiceClientLink): void {
    const sid = this.selectedServiceId();
    if (!sid) return;
    const key = c.source === 'catalogue'
      ? (c.link_id != null ? `cat-${c.link_id}` : null)
      : (c.onboarding_client_id != null ? `onb-${c.onboarding_client_id}` : null);
    if (!key) return;
    this.router.navigate(['/admin/services', sid, 'client', key]);
  }

  /** Row click: select the service. Editing is reserved for the
   *  pencil icon (openEdit) — clicks on the rest of the row only
   *  surface the clients panel.
   *
   *  Writes `?service=<id>` to the URL so the sidenav submenu can
   *  highlight the matching child via its isServiceOfferingActive
   *  check, and so reload/back-button preserves the selection. */
  selectService(s: ServiceOffering, e?: Event): void {
    e?.stopPropagation();
    if (!s.id) return;
    this.selectedServiceId.set(s.id);
    this.selectedServiceName.set(s.name || '');
    this.loadServiceClients(s.id);
    this.router.navigate([], {
      queryParams: { service: s.id },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /** Used by the sidenav deep link — sets the selection state from
   *  an already-known id. No modal, no URL push (the navigation that
   *  triggered the deep link already set the URL). */
  selectServiceById(id: number): void {
    const s = this.services().find(x => x.id === id);
    if (!s) return;
    this.selectedServiceId.set(id);
    this.selectedServiceName.set(s.name || '');
    this.loadServiceClients(id);
  }

  clearSelection(): void {
    this.selectedServiceId.set(null);
    this.selectedServiceName.set('');
    this.serviceClients.set([]);
    this.serviceFeedback.set([]);
    this.panelTab.set('clients');
    // Drop the query param so the sidenav stops highlighting.
    if (this.route.snapshot.queryParamMap.has('service')) {
      this.router.navigate([], { queryParams: {}, replaceUrl: true });
    }
  }

  private loadServiceClients(id: number): void {
    this.loadingServiceClients.set(true);
    this.serviceClients.set([]);
    this.api.listClientsOnService(id).subscribe({
      next: r => { this.serviceClients.set(r.clients ?? []); this.loadingServiceClients.set(false); },
      error: () => { this.serviceClients.set([]); this.loadingServiceClients.set(false); },
    });
    this.loadServiceFeedback(id);
  }

  private loadServiceFeedback(id: number): void {
    this.loadingServiceFeedback.set(true);
    this.serviceFeedback.set([]);
    this.api.listFeedbackForms({ service: id }).subscribe({
      next: r => { this.serviceFeedback.set(r.forms ?? []); this.loadingServiceFeedback.set(false); },
      error: () => { this.serviceFeedback.set([]); this.loadingServiceFeedback.set(false); },
    });
    // Lazy-fetch the published catalogue for the attach dropdown.
    // Loaded once per component; refetched here in case a new form
    // was published in another tab since the last selection.
    this.api.listFeedbackForms({ published: 1 }).subscribe({
      next: r => this.allPublishedFeedback.set(r.forms ?? []),
    });
  }

  openFeedback(f: FeedbackForm): void {
    if (!f.id) return;
    this.router.navigate(['/admin/feedback', f.id]);
  }

  // ─── Feedback tab expand + analytics ─────────────────────────────
  // Clicking a form on the Feedback sub-tab expands it inline instead
  // of navigating out. On expand we fetch questions (for answer labels
  // + analytics) plus every response to this form (unfiltered — the
  // service view is "everyone's activity on this form").

  expandedFeedback        = signal<number | null>(null);
  feedbackDetailQuestions = signal<FeedbackQuestion[]>([]);
  feedbackDetailResponses = signal<FeedbackResponse[]>([]);
  loadingFeedbackDetail   = signal(false);

  /** Which submission rows are expanded within an opened feedback form.
   *  Default = all collapsed; the header is enough for scanning, click
   *  to reveal the answers. */
  openSubmissions = signal<Set<number>>(new Set<number>());
  isSubmissionOpen(id: number): boolean { return this.openSubmissions().has(id); }
  toggleSubmission(id: number) {
    this.openSubmissions.update(set => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  toggleFeedbackRow(id: number) {
    if (this.expandedFeedback() === id) {
      this.expandedFeedback.set(null);
      return;
    }
    this.expandedFeedback.set(id);
    this.loadFeedbackDetail(id);
    // Reset the panel-level "view all" toggle so each expanded form
    // starts with just the first analytics block visible.
    this.analyticsShowAll.set(false);
    this.collapsedAnaBlocks.set({});
    // Collapse every submission by default whenever a new form opens.
    this.openSubmissions.set(new Set());
  }

  private loadFeedbackDetail(formId: number) {
    this.loadingFeedbackDetail.set(true);
    this.feedbackDetailResponses.set([]);
    this.feedbackDetailQuestions.set([]);
    this.api.getFeedbackForm(formId).subscribe({
      next: r => this.feedbackDetailQuestions.set(r.questions ?? []),
    });
    this.api.listFeedbackResponses(formId).subscribe({
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

  // ── Analytics (poll + survey kinds) ────────────────────────────

  /** Panel-level "View all N analytics" toggle. False → only the first
   *  block shows. True → every aggregatable block renders. */
  analyticsShowAll = signal(false);

  /** Per-question collapse state (question id → collapsed). */
  collapsedAnaBlocks = signal<Record<number, boolean>>({});
  toggleAna(qid: number) {
    this.collapsedAnaBlocks.update(m => ({ ...m, [qid]: !m[qid] }));
  }
  isAnaCollapsed(qid: number): boolean {
    return !!this.collapsedAnaBlocks()[qid];
  }

  /** Analytics only makes sense for polls + surveys. Text-heavy forms
   *  fall through to the raw submission list. */
  showAnalyticsFor(f: FeedbackForm): boolean {
    return (f.kind === 'poll' || f.kind === 'survey')
        && this.feedbackDetailResponses().length > 0
        && this.aggregatableQs().length > 0;
  }

  private aggregatable(t: FeedbackQuestionType): boolean {
    return t === 'rating' || t === 'yes_no' || t === 'single_choice' || t === 'multi_choice';
  }

  aggregatableQs(): FeedbackQuestion[] {
    return this.feedbackDetailQuestions().filter(q => this.aggregatable(q.type));
  }

  visibleAnalyticsQs(): FeedbackQuestion[] {
    const all = this.aggregatableQs();
    return this.analyticsShowAll() ? all : all.slice(0, 1);
  }

  /** Pull all answer values for one question across every loaded
   *  response, normalising the JSON-array multi_choice back to real
   *  arrays. Empty strings are skipped so counts match submissions. */
  private answersFor(qid: number): (string | string[])[] {
    const out: (string | string[])[] = [];
    for (const r of this.feedbackDetailResponses()) {
      for (const a of (r.answers || [])) {
        if (a.question_id !== qid) continue;
        const raw = (a.value ?? '').toString();
        if (!raw) continue;
        if (raw.startsWith('[') && raw.endsWith(']')) {
          try {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr)) { out.push(arr.map(String)); continue; }
          } catch {}
        }
        out.push(raw);
      }
    }
    return out;
  }

  ratingStats(q: FeedbackQuestion): { label: string; count: number; pct: number; total: number }[] {
    const values = this.answersFor(q.id!).map(v => Number(Array.isArray(v) ? v[0] : v)).filter(Number.isFinite);
    const total  = values.length;
    return [1, 2, 3, 4, 5].map(n => {
      const count = values.filter(v => Math.round(v) === n).length;
      return { label: `${n}★`, count, pct: total ? (count / total) * 100 : 0, total };
    });
  }

  yesNoStats(q: FeedbackQuestion): { label: string; count: number; pct: number; total: number }[] {
    const values = this.answersFor(q.id!).map(v => (Array.isArray(v) ? v[0] : v).toString().toLowerCase());
    const total  = values.length;
    const yes    = values.filter(v => v === 'yes' || v === 'true' || v === '1').length;
    const no     = total - yes;
    return [
      { label: 'Yes', count: yes, pct: total ? (yes / total) * 100 : 0, total },
      { label: 'No',  count: no,  pct: total ? (no  / total) * 100 : 0, total },
    ];
  }

  choiceStats(q: FeedbackQuestion): { label: string; count: number; pct: number; total: number }[] {
    const options = q.options && q.options.length ? q.options : [];
    const values  = this.answersFor(q.id!);
    const flat: string[] = [];
    for (const v of values) {
      if (Array.isArray(v)) flat.push(...v);
      else flat.push(v);
    }
    const responseCount = this.feedbackDetailResponses().length;
    return options.map(opt => {
      const count = flat.filter(v => v === opt).length;
      return {
        label: opt,
        count,
        pct: responseCount ? (count / responseCount) * 100 : 0,
        total: responseCount,
      };
    });
  }

  statsFor(q: FeedbackQuestion): { label: string; count: number; pct: number; total: number }[] {
    switch (q.type) {
      case 'rating':        return this.ratingStats(q);
      case 'yes_no':        return this.yesNoStats(q);
      case 'single_choice':
      case 'multi_choice':  return this.choiceStats(q);
      default:              return [];
    }
  }

  ratingAverage(q: FeedbackQuestion): number {
    const values = this.answersFor(q.id!).map(v => Number(Array.isArray(v) ? v[0] : v)).filter(Number.isFinite);
    return values.length ? values.reduce((s, n) => s + n, 0) / values.length : 0;
  }

  draft: Partial<ServiceOffering> = this.blank();

  // Sidenav service entries deep-link here as ?service=<id> to open that
  // service's edit modal. Held until the list has loaded, then consumed.
  private pendingOpenId: number | null = null;

  ngOnInit() {
    this.load();
    this.route.queryParamMap.subscribe(p => {
      const raw = p.get('service');
      this.pendingOpenId = raw ? Number(raw) : null;
      this.tryOpenPending();
    });
  }

  private load() {
    this.api.listServiceOfferings().subscribe(r => {
      // Decimal price comes back as a string from PHP/PDO — coerce for binding.
      this.services.set(r.services.map(s => ({
        ...s,
        price: s.price !== null && s.price !== undefined && (s.price as any) !== '' ? Number(s.price) : null,
        is_active: !!s.is_active,
        allow_multiple: !!s.allow_multiple,
      })));
      this.tryOpenPending();
    });
  }

  /** Sidenav deep link consumer. Selects the service to populate the
   *  on-page Clients panel — does NOT open the edit modal (the
   *  pencil icon on the row owns editing). Runs once both the list
   *  and the id are available. */
  private tryOpenPending() {
    if (this.pendingOpenId == null) return;
    const match = this.services().find(s => s.id === this.pendingOpenId);
    if (match) {
      this.pendingOpenId = null;
      this.selectServiceById(match.id!);
    }
  }

  private blank(): Partial<ServiceOffering> {
    return { name: '', description: '', price: null, currency: 'GBP',
      payment_type: 'one_off', repeat_duration: null, is_active: true };
  }

  isActive(s: ServiceOffering) { return !!s.is_active; }

  priceLabel(s: ServiceOffering): string {
    if (s.price === null || s.price === undefined || (s.price as any) === '') return '—';
    const amount = `£${Number(s.price).toFixed(2)}`;
    if (s.payment_type === 'recurring') {
      const map: Record<string, string> = {
        weekly: 'week', monthly: 'month', quarterly: 'quarter', yearly: 'year',
      };
      const per = s.repeat_duration ? map[s.repeat_duration] : null;
      return per ? `${amount} / ${per}` : `${amount} recurring`;
    }
    return `${amount} one-off`;
  }

  openNew() {
    this.draft = this.blank();
    this.error.set(null);
    this.serviceClients.set([]);
    this.loadingServiceClients.set(false);
    this.linkedForm.set(null);
    this.loadingLinkedForm.set(false);
    this.modalOpen.set(true);
  }

  openEdit(s: ServiceOffering, e?: Event) {
    e?.stopPropagation();
    this.draft = { ...s };
    this.error.set(null);
    this.modalOpen.set(true);
    // Fetch the linked onboarding form so the CTA at the top of the
    // modal renders the right state (link vs prompt to create).
    if (s.id) {
      this.linkedForm.set(null);
      this.loadingLinkedForm.set(true);
      this.api.getServiceOnboardingForm(s.id).subscribe({
        next: r => {
          this.loadingLinkedForm.set(false);
          this.linkedForm.set(r.form ?? null);
        },
        error: () => {
          this.loadingLinkedForm.set(false);
          this.linkedForm.set(null);
        },
      });
    }
  }

  close() {
    // Modal close is independent of selection — the clients panel
    // stays open with the same ?service= in the URL. Use the panel's
    // ✕ button to clear the selection.
    this.modalOpen.set(false);
  }

  save() {
    const name = (this.draft.name || '').trim();
    if (!name) { this.error.set('Name is required'); return; }

    const payload: Partial<ServiceOffering> = {
      name,
      description: (this.draft.description || '').trim() || null,
      price: this.draft.price === null || this.draft.price === undefined || (this.draft.price as any) === ''
        ? null : Number(this.draft.price),
      currency: this.draft.currency || 'GBP',
      payment_type: this.draft.payment_type === 'recurring' ? 'recurring' : 'one_off',
      repeat_duration: this.draft.payment_type === 'recurring' ? (this.draft.repeat_duration ?? null) : null,
      is_active: this.draft.is_active ? 1 : 0,
      allow_multiple: this.draft.allow_multiple ? 1 : 0,
    };

    this.saving.set(true);
    const done = {
      next: () => { this.saving.set(false); this.load(); this.close(); },
      error: (err: any) => { this.saving.set(false); this.error.set(err?.error?.error || 'Save failed'); },
    };
    if (this.draft.id) this.api.updateServiceOffering(this.draft.id, payload).subscribe(done);
    else this.api.createServiceOffering(payload).subscribe(done);
  }

  async del(s: ServiceOffering, e?: Event) {
    e?.stopPropagation();
    if (!s.id) return;
    const ok = await this.dialog.confirm(
      `Delete service "${s.name}"?`,
      { title: 'Delete service', confirmLabel: 'Delete', variant: 'danger' }
    );
    if (!ok) return;
    this.api.deleteServiceOffering(s.id).subscribe(() => this.load());
  }
}
