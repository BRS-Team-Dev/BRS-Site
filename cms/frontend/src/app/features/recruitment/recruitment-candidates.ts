import { Component, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { environment } from '@env/environment';
import { Api } from '../../core/api';
import {
  Client, RecruitmentCandidate, RecruitmentCandidateDocument, RecruitmentCandidateNote,
  RecruitmentCandidateStatus, RecruitmentDocGroup, RecruitmentDocType, RecruitmentOnboarding,
  RecruitmentPlacement, RecruitmentPlacementStatus, RecruitmentSkill,
} from '../../core/models';
import { EntityContracts } from '../../shared/entity-contracts';

type Mode = 'list' | 'view' | 'edit';
type Tab = 'profile' | 'onboarding' | 'documents' | 'contracts' | 'notes' | 'placements' | 'rejected';

/** One row in the Documents-tab catalog. `type` is null for the "Other
 *  uploads" section (uploads recorded without a doc-type); `submitted`
 *  is null when the candidate hasn't submitted that type yet. */
type DocCatalogRow = {
  type: RecruitmentDocType | null;
  submitted: RecruitmentCandidateDocument | null;
};
type DocCatalogSection = {
  key: string;
  id: number | null;
  name: string;
  uploaded: number;
  total: number;
  rows: DocCatalogRow[];
};

const STATUSES: RecruitmentCandidateStatus[] = [
  'new', 'interviewing', 'processing', 'compliant',
  'client_screening', 'placed', 'rejected_by_us',
];

const STATUS_LABEL: Record<RecruitmentCandidateStatus, string> = {
  new:                'New',
  interviewing:       'Interviewing',
  processing:         'Processing',
  compliant:          'Compliant',
  client_screening:   'Client Screening',
  placed:             'Placed',
  rejected_by_us:     'Rejected by Us',
};

const TABS: { key: Tab; label: string }[] = [
  { key: 'profile',    label: 'Profile' },
  { key: 'onboarding', label: 'Onboarding' },
  { key: 'documents',  label: 'Documents' },
  { key: 'contracts',  label: 'Contracts' },
  { key: 'notes',      label: 'Notes' },
  { key: 'placements', label: 'Placements' },
  { key: 'rejected',   label: 'Rejected' },
];

/**
 * /recruitment/candidates — list + detail + edit, all in one component
 * (same shape as the Operations tenders/partners pages). Mode is derived
 * from the URL: list, new, :id (view), :id/edit.
 */
@Component({
  selector: 'app-recruitment-candidates',
  imports: [RouterLink, FormsModule, EntityContracts],
  template: `
    @if (mode() === 'list') {
      <div class="toolbar">
        <h1>Candidates</h1>
        <span class="spacer"></span>
        <select [(ngModel)]="filterStatus" name="status_filter" class="status-filter">
          <option value="">All statuses</option>
          @for (s of STATUSES; track s) { <option [value]="s">{{ statusLabel(s) }}</option> }
        </select>
        <button class="primary" routerLink="/recruitment/candidates/new">+ New candidate</button>
      </div>

      @if (visible().length === 0) {
        <div class="empty">
          <p class="muted">No candidates match.</p>
          <button class="primary" routerLink="/recruitment/candidates/new">Add your first candidate</button>
        </div>
      } @else {
        <div class="table-wrap">
          <table class="data">
            <thead><tr>
              <th>Name</th>
              <th>Role</th>
              <th>Experience</th>
              <th>Day rate</th>
              <th>Status</th>
              <th class="actions-col"></th>
            </tr></thead>
            <tbody>
              @for (c of visible(); track c.id) {
                <tr (click)="view(c)">
                  <td>
                    <strong>{{ c.first_name }} {{ c.last_name }}</strong>
                    @if (c.email) { <div class="muted small">{{ c.email }}</div> }
                  </td>
                  <td>{{ c.role || '—' }}</td>
                  <td>{{ c.experience_level || '—' }}@if (c.experience_years) { · {{ c.experience_years }}y }</td>
                  <td>
                    @if (c.day_rate) { {{ c.currency }} {{ c.day_rate }} } @else { — }
                  </td>
                  <td>
                    <span class="status-pill" [attr.data-status]="c.status">{{ statusLabel(c.status) }}</span>
                  </td>
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
        <button class="ghost" routerLink="/recruitment/candidates">← Back</button>
        <h1>{{ c.first_name }} {{ c.last_name }}</h1>
        <select class="status-pill-select" [attr.data-status]="c.status"
                [ngModel]="c.status" (ngModelChange)="changeStatus($event)" name="cand_status"
                title="Change status">
          @for (s of STATUSES; track s) { <option [value]="s">{{ statusLabel(s) }}</option> }
        </select>
        <span class="spacer"></span>
        <button class="ghost" [routerLink]="['/recruitment/candidates', c.id, 'edit']">✎ Edit</button>
      </div>

      <div class="tab-nav">
        @for (t of TABS; track t.key) {
          <button class="tab-btn" [class.active]="tab() === t.key" (click)="setTab(t.key)">
            {{ t.label }}
            @if (t.key === 'documents') { <span class="badge">{{ docs().length }}</span> }
            @if (t.key === 'notes')     { <span class="badge">{{ notes().length }}</span> }
            @if (t.key === 'placements'){ <span class="badge">{{ activePlacements().length + historyPlacements().length }}</span> }
            @if (t.key === 'rejected')  {
              <span class="badge" [class.warn]="rejectedPlacements().length > 0">
                {{ rejectedPlacements().length }}
              </span>
            }
            @if (t.key === 'onboarding' && onboarding(); as ob) {
              <span class="badge" [class.warn]="ob.progress.docs_valid < ob.progress.docs_required">
                {{ ob.progress.docs_valid }}/{{ ob.progress.docs_required }}
              </span>
            }
          </button>
        }
      </div>

      @if (tab() === 'profile') {
        <section class="pipeline-update">
          <div class="pipeline-label">Update status</div>
          <div class="pipeline-chips">
            @for (s of STATUSES; track s) {
              <button class="pipeline-chip" [attr.data-status]="s"
                      [class.active]="c.status === s" (click)="changeStatus(s)">
                {{ statusLabel(s) }}
              </button>
            }
          </div>
        </section>

        <div class="profile-grid">
          <section class="card">
            <h3>Contact</h3>
            <dl class="kv">
              <dt>Email</dt><dd>{{ c.email || '—' }}</dd>
              <dt>Phone</dt><dd>{{ c.phone || '—' }}</dd>
              <dt>DOB</dt><dd>{{ c.dob || '—' }}</dd>
              <dt>Gender</dt><dd>{{ genderLabel(c.gender) }}</dd>
              <dt>Nationality</dt><dd>{{ c.nationality || '—' }}</dd>
              <dt>Address line 1</dt><dd>{{ c.address_line1 || '—' }}</dd>
              <dt>Address line 2</dt><dd>{{ c.address_line2 || '—' }}</dd>
              <dt>City</dt><dd>{{ c.city || '—' }}</dd>
              <dt>Postcode</dt><dd>{{ c.postcode || '—' }}</dd>
              <dt>Country</dt><dd>{{ c.country || '—' }}</dd>
              <dt>Driving</dt><dd>
                @if (c.has_driving_license) { <span class="pill yes">Licence</span> }
                @if (c.willing_to_drive)    { <span class="pill yes">Will drive</span> }
                @if (!c.has_driving_license && !c.willing_to_drive) { — }
              </dd>
            </dl>
          </section>
          <section class="card">
            <h3>Profile</h3>
            <dl class="kv">
              <dt>Role</dt><dd>{{ c.role || '—' }}</dd>
              <dt>Type</dt><dd>{{ c.candidate_type || '—' }}</dd>
              <dt>Discipline</dt><dd>{{ c.discipline || '—' }}</dd>
              <dt>Experience</dt><dd>{{ c.experience_level || '—' }}@if (c.experience_years) { · {{ c.experience_years }}y }</dd>
              <dt>Day rate</dt><dd>@if (c.day_rate) { {{ c.currency }} {{ c.day_rate }} } @else { — }</dd>
              <dt>Availability</dt><dd>{{ c.availability || '—' }}</dd>
              <dt>Source</dt><dd>{{ c.source || '—' }}</dd>
              <dt>CV</dt><dd>
                @if (c.cv_file_path) {
                  <a [href]="fileUrl(c.cv_file_path)" target="_blank" rel="noopener">View CV ↗</a>
                } @else { — }
              </dd>
              <dt>Skills</dt><dd>
                @if (skillList(c.skills).length === 0) { — } @else {
                  <div class="skill-chips">
                    @for (s of skillList(c.skills); track s) { <span class="skill-chip">{{ s }}</span> }
                  </div>
                }
              </dd>
            </dl>
            @if (c.notes) { <p class="muted">{{ c.notes }}</p> }
          </section>
        </div>
      }

      @if (tab() === 'onboarding' && onboarding(); as ob) {
        @if (c.onboarding_token) {
          <section class="onboarding-link-card">
            <div class="ol-icon" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            </div>
            <div class="ol-body">
              <div class="ol-head">
                <h3>{{ c.first_name }}'s onboarding link</h3>
                <span class="ol-pill"
                      [class.signed]="!!c.contract_signed_at"
                      [class.pending]="!c.contract_signed_at">
                  {{ c.contract_signed_at ? 'Signed' : 'Awaiting candidate' }}
                </span>
              </div>
              <p class="ol-sub">Share this URL — the candidate can sign their contract, complete their profile and upload documents without needing an admin login.</p>
              <div class="ol-link-row">
                <span class="ol-protocol">{{ linkScheme() }}</span>
                <input class="ol-input" readonly [value]="onboardingUrlPath(c.onboarding_token)" #linkInput
                       (focus)="linkInput.select()" title="Click to select" />
                <button class="ol-btn copy" type="button" (click)="copyOnboardingLink(linkInput)" [class.flash]="linkCopied()">
                  @if (linkCopied()) {
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    <span>Copied</span>
                  } @else {
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    <span>Copy</span>
                  }
                </button>
                <a class="ol-btn open" [href]="onboardingUrl(c.onboarding_token)" target="_blank" rel="noopener" title="Open portal in new tab">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                  <span>Open</span>
                </a>
              </div>
            </div>
          </section>
        }
        <section class="card pad">
          <h3>Onboarding progress</h3>
          <div class="progress-row">
            <div class="progress-step" [class.done]="ob.progress.contract_signed">
              <span class="step-mark">{{ ob.progress.contract_signed ? '✓' : '○' }}</span>
              <span>Contract signed</span>
            </div>
            <div class="progress-step" [class.done]="ob.progress.docs_valid >= ob.progress.docs_required">
              <span class="step-mark">{{ ob.progress.docs_valid >= ob.progress.docs_required ? '✓' : '○' }}</span>
              <span>Compliance pack ({{ ob.progress.docs_valid }} / {{ ob.progress.docs_required }} valid)</span>
            </div>
          </div>

          @if (!ob.progress.contract_signed) {
            <div class="contract-actions">
              <p class="muted small">Once the candidate has signed their agency contract, mark it complete:</p>
              <button class="primary" (click)="markContractSigned()">Mark contract as signed</button>
            </div>
          } @else {
            <p class="muted small">Contract signed on {{ formatDate(c.contract_signed_at) }}.</p>
          }

          <h3 style="margin-top: 20px">Compliance checklist</h3>
          <ul class="check-list">
            @for (item of ob.checklist; track item.doc_type_id) {
              <li>
                <span class="step-mark" [class.valid]="item.status === 'valid'"
                                        [class.pending]="item.status === 'pending'">
                  {{ item.status === 'valid' ? '✓' : item.status === 'pending' ? '⌛' : '○' }}
                </span>
                <strong>{{ item.name }}</strong>
                @if (item.status) {
                  <span class="status-pill" [attr.data-doc-status]="item.status">{{ item.status }}</span>
                } @else {
                  <span class="muted small">not submitted</span>
                }
                <span class="spacer"></span>
                @if (docForType(item.doc_type_id); as d) {
                  @if (d.file_path) {
                    <a class="ghost icon-btn" [href]="fileUrl(d.file_path)" target="_blank" rel="noopener" title="View">👁</a>
                  }
                  @if (d.status !== 'valid') {
                    <button class="ghost icon-btn approve" (click)="setDocStatus(d, 'valid')" title="Approve">✓</button>
                  }
                  @if (d.status !== 'rejected') {
                    <button class="ghost icon-btn danger" (click)="setDocStatus(d, 'rejected')" title="Reject">✕</button>
                  }
                } @else {
                  <button class="primary upload-btn" (click)="uploadForType(item.doc_type_id)">⬆ Upload</button>
                }
              </li>
            } @empty {
              <li class="muted small">No required documents configured. Add some in <a routerLink="/recruitment/settings">Settings</a>.</li>
            }
          </ul>
        </section>
      }

      @if (tab() === 'documents') {
        <section class="card pad">
          <div class="docs-actions">
            <button class="ghost" (click)="openUploadModal(null)">+ Upload document</button>
          </div>

          @if (docCatalogView().length === 0) {
            <p class="muted">No document types configured. Add some in <a routerLink="/recruitment/settings">Settings</a>.</p>
          } @else {
            <div class="group-list">
              @for (g of docCatalogView(); track g.key) {
                <section class="group-card">
                  <button class="group-head" type="button" (click)="toggleDocsCollapse(g.key)">
                    <span class="caret">{{ docCollapsed().has(g.key) ? '▸' : '▾' }}</span>
                    <strong class="group-title">{{ g.name }}</strong>
                    <span class="spacer"></span>
                    <span class="uploaded-badge" [class.complete]="g.uploaded === g.total">
                      {{ g.uploaded }}/{{ g.total }} uploaded
                    </span>
                  </button>
                  @if (!docCollapsed().has(g.key)) {
                    <ul class="type-list">
                      @for (r of g.rows; track r.type?.id ?? r.submitted?.id) {
                        <li class="type-item">
                          <div class="type-head">
                            <strong>{{ r.type?.name || r.submitted?.title || '—' }}</strong>
                            @if (r.type?.is_required) {
                              <span class="pill required">required</span>
                            } @else {
                              <span class="pill optional">optional</span>
                            }
                            @if (r.submitted) {
                              <span class="pill" [attr.data-status]="r.submitted.status">{{ r.submitted.status }}</span>
                              @if (!r.submitted.file_path) { <span class="pill info">info only</span> }
                              @if (r.submitted.reference_number) { <span class="pill">REF · {{ r.submitted.reference_number }}</span> }
                              @if (r.submitted.issuing_body)     { <span class="pill">{{ r.submitted.issuing_body }}</span> }
                              @if (r.submitted.issued_at)        { <span class="pill">issued {{ formatDate(r.submitted!.issued_at) }}</span> }
                              @if (r.submitted.expires_at)       { <span class="pill">expires {{ formatDate(r.submitted!.expires_at) }}</span> }
                            } @else {
                              <span class="missing">Missing</span>
                            }
                            <span class="spacer"></span>
                            @if (r.submitted) {
                              <select class="status-select" [ngModel]="r.submitted.status"
                                      (ngModelChange)="setDocStatus(r.submitted!, $event)" [name]="'ds_' + r.submitted.id">
                                <option value="pending">pending</option>
                                <option value="valid">valid</option>
                                <option value="expired">expired</option>
                                <option value="rejected">rejected</option>
                              </select>
                              @if (r.submitted.file_path) {
                                <a class="ghost icon-btn" [href]="fileUrl(r.submitted.file_path)" target="_blank" rel="noopener" title="View">👁</a>
                              }
                              <button class="ghost icon-btn" (click)="uploadForType(r.type?.id)" title="Replace">↻</button>
                              <button class="ghost icon-btn danger" (click)="delDoc(r.submitted)" title="Delete">✕</button>
                            } @else {
                              <button class="primary upload-btn" (click)="uploadForType(r.type?.id)">⬆ Upload</button>
                            }
                          </div>
                          @if (r.type?.description) { <div class="muted small">{{ r.type!.description }}</div> }
                        </li>
                      }
                    </ul>
                  }
                </section>
              }
            </div>
          }
        </section>
      }

      @if (tab() === 'contracts') {
        <section class="card pad">
          <h3>Contracts</h3>
          <app-entity-contracts audience="candidate" [entityId]="c.id!"></app-entity-contracts>
        </section>
      }

      @if (tab() === 'notes') {
        <section class="card pad">
          <div class="note-subtabs">
            @for (s of noteSubtabs(); track s) {
              <button class="note-subtab" [class.active]="notesActiveStatus() === s" [attr.data-status]="s"
                      (click)="notesActiveStatus.set(s)">
                {{ statusLabel(s) }} <span class="sub-count">{{ noteCountByStatus(s) }}</span>
              </button>
            }
          </div>

          <div class="sub-form">
            <h3>Add a note <span class="muted small">(tagged as <strong>{{ statusLabel(c.status) }}</strong>)</span></h3>
            <input [(ngModel)]="noteDraft.title" name="n_title" placeholder="Title" />
            <textarea rows="3" [(ngModel)]="noteDraft.body" name="n_body" placeholder="Body"></textarea>
            <button class="primary" (click)="addNote()" [disabled]="!noteDraft.title.trim()">+ Add note</button>
          </div>

          @if (filteredNotes().length === 0) {
            <p class="muted">No notes for <strong>{{ statusLabel(notesActiveStatus()) }}</strong> yet.</p>
          } @else {
            <ul class="note-list">
              @for (n of filteredNotes(); track n.id) {
                <li class="note-item">
                  <div class="note-head">
                    <strong>{{ n.title }}</strong>
                    @if (n.status) {
                      <span class="status-pill" [attr.data-status]="n.status">{{ statusLabel(n.status) }}</span>
                    }
                    <span class="spacer"></span>
                    <span class="muted small">{{ formatDate(n.created_at) }}</span>
                    <button class="ghost icon-btn danger" (click)="delNote(n)" title="Delete">✕</button>
                  </div>
                  @if (n.body) { <p class="note-body">{{ n.body }}</p> }
                </li>
              }
            </ul>
          }
        </section>
      }

      @if (tab() === 'placements') {
        <section class="card pad">
          <div class="docs-actions">
            <button class="primary" (click)="openAddPlacement()">+ Add to client</button>
          </div>

          @if (activePlacements().length > 0) {
            <h3 class="section-h">Current placement{{ activePlacements().length === 1 ? '' : 's' }}</h3>
            <div class="current-placements">
              @for (p of activePlacements(); track p.id) {
                <div class="placement-card current" [attr.data-status]="p.status">
                  <div class="placement-head">
                    <strong>{{ clientName(p.client_id) }}</strong>
                    <span class="status-pill" [attr.data-placement-status]="p.status">{{ p.status }}</span>
                    @if (p.role) { <span class="muted small">· {{ p.role }}</span> }
                    <span class="spacer"></span>
                    <button class="ghost icon-btn" (click)="editPlacement(p)" title="Edit">✎</button>
                    @if (p.status !== 'rejected') {
                      <button class="ghost icon-btn danger" (click)="rejectPlacement(p)" title="Mark rejected">⊘</button>
                    }
                    <button class="ghost icon-btn danger" (click)="delPlacement(p)" title="Delete">✕</button>
                  </div>
                  <div class="placement-body">
                    <div><span class="muted">Start</span> · {{ p.start_date ? formatDate(p.start_date) : '—' }}</div>
                    <div><span class="muted">End</span> · {{ p.end_date ? formatDate(p.end_date) : '—' }}</div>
                    <div><span class="muted">Value</span> · @if (p.contract_value) { {{ p.currency }} {{ p.contract_value }} } @else { — }</div>
                    <div><span class="muted">Commission</span> ·
                      @if (p.commission_value) { {{ p.currency }} {{ p.commission_value }} } @else { — }
                      @if (p.commission_paid_full) { <span class="pill yes">paid in full</span> }
                      @else if (p.commission_paid_part) { <span class="pill yes">part paid</span> }
                    </div>
                    @if (p.commission_due_part || p.commission_due_full) {
                      <div><span class="muted">Due</span> ·
                        @if (p.commission_due_part) { part {{ formatDate(p.commission_due_part) }} }
                        @if (p.commission_due_full) { · full {{ formatDate(p.commission_due_full) }} }
                      </div>
                    }
                  </div>
                  @if (p.contract_notes) { <p class="muted small placement-notes">{{ p.contract_notes }}</p> }
                </div>
              }
            </div>
          }

          @if (historyPlacements().length > 0) {
            <h3 class="section-h">Past placements</h3>
            <table class="data">
              <thead><tr>
                <th>Client</th>
                <th>Role</th>
                <th>Status</th>
                <th>Dates</th>
                <th>Value</th>
                <th>Commission</th>
                <th class="actions-col"></th>
              </tr></thead>
              <tbody>
                @for (p of historyPlacements(); track p.id) {
                  <tr>
                    <td><strong>{{ clientName(p.client_id) }}</strong></td>
                    <td>{{ p.role || '—' }}</td>
                    <td><span class="status-pill" [attr.data-placement-status]="p.status">{{ p.status }}</span></td>
                    <td>
                      {{ p.start_date ? formatDate(p.start_date) : '—' }} →
                      {{ p.end_date   ? formatDate(p.end_date)   : '—' }}
                    </td>
                    <td>@if (p.contract_value) { {{ p.currency }} {{ p.contract_value }} } @else { — }</td>
                    <td>@if (p.commission_value) { {{ p.currency }} {{ p.commission_value }} } @else { — }</td>
                    <td class="actions">
                      <button class="ghost icon-btn" (click)="editPlacement(p)" title="Edit">✎</button>
                      <button class="ghost icon-btn danger" (click)="delPlacement(p)" title="Delete">✕</button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          }

          @if (activePlacements().length === 0 && historyPlacements().length === 0) {
            <p class="muted">No placements yet — pitch this candidate to a client.</p>
          }
        </section>
      }

      @if (tab() === 'rejected') {
        <section class="card pad">
          <p class="muted page-sub">Clients that have rejected this candidate. When pitching them again, the Add-to-client picker flags previously-rejected clients in red.</p>
          @if (rejectedPlacements().length === 0) {
            <p class="muted">No rejections recorded.</p>
          } @else {
            <table class="data">
              <thead><tr>
                <th>Client</th>
                <th>Role pitched</th>
                <th>Reason</th>
                <th>Recorded</th>
                <th class="actions-col"></th>
              </tr></thead>
              <tbody>
                @for (p of rejectedPlacements(); track p.id) {
                  <tr>
                    <td><strong>{{ clientName(p.client_id) }}</strong></td>
                    <td>{{ p.role || '—' }}</td>
                    <td>{{ p.rejection_reason || '—' }}</td>
                    <td>{{ formatDate(p.updated_at) }}</td>
                    <td class="actions">
                      <button class="ghost icon-btn" (click)="editPlacement(p)" title="Edit">✎</button>
                      <button class="ghost icon-btn danger" (click)="delPlacement(p)" title="Delete">✕</button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </section>
      }
    }

    @if (showPlacementModal()) {
      <div class="modal-backdrop" (click)="closePlacementModal()">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-head">
            <h2>{{ placementDraft.id ? 'Edit placement' : 'Add to client' }}</h2>
            <button class="ghost icon-btn" (click)="closePlacementModal()" title="Close">✕</button>
          </div>
          <div class="modal-body">
            <label>Client <span class="required">*</span></label>
            <select [(ngModel)]="placementDraft.client_id" name="pl_client">
              <option [ngValue]="0">— Choose a client —</option>
              @for (c of recruitmentClients(); track c.id) {
                <option [ngValue]="c.id">{{ c.name }}{{ isRejectedClient(c.id) ? ' · ⚠ previously rejected' : '' }}</option>
              }
            </select>
            @if (isRejectedClient(placementDraft.client_id)) {
              <p class="warn-banner">⚠ This candidate has been rejected by this client before. Double-check before pitching again.</p>
            }

            <div class="meta-row">
              <div class="meta-field">
                <label>Role</label>
                <input [(ngModel)]="placementDraft.role" name="pl_role" placeholder="e.g. Site Manager" />
              </div>
              <div class="meta-field">
                <label>Status</label>
                <select [(ngModel)]="placementDraft.status" name="pl_status">
                  <option value="screening">Screening</option>
                  <option value="placed">Placed</option>
                  <option value="ended">Ended</option>
                  <option value="rejected">Rejected</option>
                </select>
              </div>
            </div>

            <div class="meta-row">
              <div class="meta-field">
                <label>Start date</label>
                <input type="date" [(ngModel)]="placementDraft.start_date" name="pl_start" />
              </div>
              <div class="meta-field">
                <label>End date</label>
                <input type="date" [(ngModel)]="placementDraft.end_date" name="pl_end" />
              </div>
            </div>

            <div class="meta-row">
              <div class="meta-field">
                <label>Contract value</label>
                <input type="number" [(ngModel)]="placementDraft.contract_value" name="pl_value" />
              </div>
              <div class="meta-field">
                <label>Our commission</label>
                <input type="number" [(ngModel)]="placementDraft.commission_value" name="pl_comm" />
              </div>
              <div class="meta-field" style="max-width: 90px">
                <label>Currency</label>
                <input [(ngModel)]="placementDraft.currency" name="pl_cur" maxlength="3" />
              </div>
            </div>

            <div class="toggle-grid">
              <label class="inline-toggle">
                <input type="checkbox" [(ngModel)]="placementDraft.commission_paid_part" name="pl_paid_part" />
                <span>Part commission paid</span>
              </label>
              <label class="inline-toggle">
                <input type="checkbox" [(ngModel)]="placementDraft.commission_paid_full" name="pl_paid_full" />
                <span>Full commission paid</span>
              </label>
            </div>

            <div class="meta-row">
              <div class="meta-field">
                <label>Part commission due</label>
                <input type="date" [(ngModel)]="placementDraft.commission_due_part" name="pl_due_part" />
              </div>
              <div class="meta-field">
                <label>Full commission due</label>
                <input type="date" [(ngModel)]="placementDraft.commission_due_full" name="pl_due_full" />
              </div>
            </div>

            <label>Contract notes</label>
            <textarea rows="2" [(ngModel)]="placementDraft.contract_notes" name="pl_notes"></textarea>

            @if (placementDraft.status === 'rejected') {
              <label>Rejection reason</label>
              <textarea rows="2" [(ngModel)]="placementDraft.rejection_reason" name="pl_rej"></textarea>
            }

            @if (placementError()) { <p class="err">{{ placementError() }}</p> }
          </div>
          <div class="modal-foot">
            <button class="ghost" (click)="closePlacementModal()" [disabled]="placementSaving()">Cancel</button>
            <button class="primary" (click)="savePlacement()" [disabled]="placementSaving()">
              {{ placementSaving() ? 'Saving…' : (placementDraft.id ? 'Save changes' : 'Create placement') }}
            </button>
          </div>
        </div>
      </div>
    }

    @if (showUploadModal()) {
      <div class="modal-backdrop" (click)="closeUploadModal()">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-head">
            <h2>{{ selectedUpType()?.submission_type === 'info_only' ? 'Record document info' : 'Upload a document' }}</h2>
            <button class="ghost icon-btn" (click)="closeUploadModal()" title="Close">✕</button>
          </div>
          <div class="modal-body">
            <label>Document type</label>
            <select [ngModel]="upDocTypeId()" (ngModelChange)="upDocTypeId.set($event)" name="up_type">
              <option [ngValue]="null">— Untyped —</option>
              @for (t of docTypes(); track t.id) { <option [ngValue]="t.id">{{ t.name }}</option> }
            </select>

            <label>Title</label>
            <input [(ngModel)]="upTitle" name="up_title"
                   [placeholder]="selectedUpType()?.name || 'Title'" />

            @if (showField('reference')) {
              <label>Reference #</label>
              <input [(ngModel)]="upReference" name="up_ref" />
            }
            @if (showField('issuing_body')) {
              <label>Issuing body</label>
              <input [(ngModel)]="upIssuingBody" name="up_iss" placeholder="e.g. Home Office" />
            }
            @if (showField('issued_at')) {
              <label>Issued</label>
              <input type="date" [(ngModel)]="upIssued" name="up_isd" />
            }
            @if (showField('expires_at')) {
              <label>Expires</label>
              <input type="date" [(ngModel)]="upExpires" name="up_exp" />
            }
            @if (selectedUpType()?.submission_type !== 'info_only') {
              <label>File <span class="required">*</span></label>
              <input type="file" (change)="onUploadFile($event)" />
            }

            @if (uploadError()) { <p class="err">{{ uploadError() }}</p> }
          </div>
          <div class="modal-foot">
            <button class="ghost" (click)="closeUploadModal()" [disabled]="uploading()">Cancel</button>
            <button class="primary" (click)="uploadDoc()" [disabled]="!canSubmitUpload() || uploading()">
              {{ uploading() ? 'Saving…' : (selectedUpType()?.submission_type === 'info_only' ? 'Save entry' : 'Upload') }}
            </button>
          </div>
        </div>
      </div>
    }

    @if (mode() === 'edit') {
      <div class="toolbar">
        <button class="ghost" (click)="cancelEdit()">← Cancel</button>
        <h1>{{ draft.id ? 'Edit candidate' : 'New candidate' }}</h1>
        <span class="spacer"></span>
        <button class="primary" (click)="save()">{{ draft.id ? 'Save changes' : 'Create' }}</button>
      </div>

      <section class="card pad">
        <h3>Identity</h3>
        <div class="form-grid">
          <div><label>First name <span class="required">*</span></label>
            <input [(ngModel)]="draft.first_name" name="f_first" /></div>
          <div><label>Last name <span class="required">*</span></label>
            <input [(ngModel)]="draft.last_name" name="f_last" /></div>
          <div><label>Email</label>
            <input type="email" [(ngModel)]="draft.email" name="f_email" /></div>
          <div><label>Phone</label>
            <input [(ngModel)]="draft.phone" name="f_phone" /></div>
          <div><label>DOB</label>
            <input type="date" [(ngModel)]="draft.dob" name="f_dob" /></div>
          <div><label>Gender</label>
            <select [(ngModel)]="draft.gender" name="f_gender">
              <option [ngValue]="null">—</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
              <option value="prefer_not_to_say">Prefer not to say</option>
            </select>
          </div>
          <div><label>Nationality</label>
            <input [(ngModel)]="draft.nationality" name="f_nat" /></div>
        </div>

        <h3>Address</h3>
        <div class="form-grid">
          <div class="full"><label>Address line 1</label>
            <input [(ngModel)]="draft.address_line1" name="f_a1" /></div>
          <div class="full"><label>Address line 2 <span class="muted small">(optional)</span></label>
            <input [(ngModel)]="draft.address_line2" name="f_a2" /></div>
          <div><label>City</label><input [(ngModel)]="draft.city" name="f_city" /></div>
          <div><label>Region</label><input [(ngModel)]="draft.region" name="f_region" /></div>
          <div><label>Postcode</label><input [(ngModel)]="draft.postcode" name="f_pc" /></div>
          <div><label>Country</label><input [(ngModel)]="draft.country" name="f_country" /></div>
        </div>

        <h3>Profile</h3>
        <div class="form-grid">
          <div><label>Role</label>
            <input [(ngModel)]="draft.role" name="f_role" placeholder="e.g. Quantity Surveyor" /></div>
          <div><label>Type</label>
            <input [(ngModel)]="draft.candidate_type" name="f_ctype" placeholder="e.g. Clinical Lead, Site Engineer" /></div>
          <div><label>Discipline</label>
            <input [(ngModel)]="draft.discipline" name="f_disc" placeholder="Construction, IT, …" /></div>
          <div><label>Experience level</label>
            <select [(ngModel)]="draft.experience_level" name="f_lvl">
              <option [ngValue]="null">—</option>
              <option value="junior">Junior</option>
              <option value="mid">Mid</option>
              <option value="senior">Senior</option>
              <option value="lead">Lead</option>
              <option value="principal">Principal</option>
            </select>
          </div>
          <div><label>Years</label>
            <input type="number" [(ngModel)]="draft.experience_years" name="f_yrs" /></div>
          <div><label>Day rate</label>
            <input type="number" [(ngModel)]="draft.day_rate" name="f_rate" /></div>
          <div><label>Currency</label>
            <input [(ngModel)]="draft.currency" name="f_cur" maxlength="3" /></div>
          <div><label>Availability</label>
            <select [(ngModel)]="draft.availability" name="f_avail">
              <option [ngValue]="null">—</option>
              <option value="immediate">Immediate</option>
              <option value="one_week">One week</option>
              <option value="two_weeks">Two weeks</option>
              <option value="one_month">One month</option>
              <option value="later">Later</option>
            </select>
          </div>
          <div><label>Status</label>
            <select [(ngModel)]="draft.status" name="f_status">
              @for (s of STATUSES; track s) { <option [value]="s">{{ statusLabel(s) }}</option> }
            </select>
          </div>
          <div><label>Source</label>
            <input [(ngModel)]="draft.source" name="f_src" placeholder="referral, job board, …" /></div>
        </div>

        <div class="toggle-row">
          <label class="inline-toggle">
            <input type="checkbox" [(ngModel)]="draft.has_driving_license" name="f_lic" />
            <span>Holds a driving licence</span>
          </label>
          <label class="inline-toggle">
            <input type="checkbox" [(ngModel)]="draft.willing_to_drive" name="f_drive" />
            <span>Willing to drive for work</span>
          </label>
        </div>

        <label>Skills <span class="muted small">(pick from the catalogue — manage in <a routerLink="/recruitment/settings">Settings → Skills</a>)</span></label>
        @if (availableSkills().length === 0) {
          <p class="muted small">No skills configured yet. Add some in Settings → Skills.</p>
        } @else {
          <div class="skill-picker">
            @for (s of availableSkills(); track s.id) {
              <button type="button" class="skill-chip-toggle"
                      [class.active]="isSkillSelected(s.name)"
                      (click)="toggleSkill(s.name)">
                {{ s.name }}
              </button>
            }
          </div>
        }
        @if (skillList(draft.skills).length > 0) {
          <div class="muted small chips-summary">
            Selected: <strong>{{ skillList(draft.skills).length }}</strong> · {{ draft.skills }}
          </div>
        }

        <label>Profile blurb</label>
        <textarea rows="3" [(ngModel)]="draft.notes" name="f_notes"></textarea>

        <h3>CV</h3>
        @if (draft.cv_file_path) {
          <p class="muted small">Current: <a [href]="fileUrl(draft.cv_file_path)" target="_blank" rel="noopener">{{ draft.cv_file_path }}</a></p>
        }
        <input type="file" accept="application/pdf,application/msword,.docx" (change)="onCvFile($event)" />
        @if (cvUploading()) {
          <p class="muted small">Uploading…</p>
        } @else if (cvFile()) {
          @if (draft.id) {
            <p class="muted small">Uploading <strong>{{ cvFile()!.name }}</strong>…</p>
          } @else {
            <p class="muted small"><strong>{{ cvFile()!.name }}</strong> will upload once the candidate is created.</p>
          }
        }

        @if (error()) { <p class="err">{{ error() }}</p> }
      </section>
    }
  `,
  styles: [`
    .toolbar h1 { margin: 0; font-size: 18px; }
    .status-filter { padding: 6px 8px; flex: 0 0 auto; width: auto; min-width: 160px; max-width: 220px; }

    .empty { padding: 32px 24px; text-align: center; }
    /* table.data styling — including separated card-rows + gold thead —
       comes from the global rule in styles.scss. Do NOT redeclare here. */
    .actions-col { width: 110px; }
    .actions { text-align: right; white-space: nowrap; }
    .actions .icon-btn { padding: 4px 6px; margin-left: 2px; }

    .status-pill, .status-pill-select {
      display: inline-block; padding: 2px 10px; border-radius: 999px;
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
      border: 1px solid var(--line); color: var(--muted);
    }
    /* Editable status pill on the candidate view toolbar — looks like
       a regular .status-pill but is a <select> the user can change. */
    .status-pill-select {
      -webkit-appearance: none; -moz-appearance: none; appearance: none;
      background: var(--bg-3); cursor: pointer;
      padding-right: 22px; font: inherit; font-size: 11px;
      text-transform: uppercase; letter-spacing: 0.5px;
      background-image: linear-gradient(45deg, transparent 50%, currentColor 50%),
                        linear-gradient(135deg, currentColor 50%, transparent 50%);
      background-position: calc(100% - 12px) 50%, calc(100% - 8px) 50%;
      background-size: 4px 4px, 4px 4px;
      background-repeat: no-repeat;
      width: auto; height: auto;
    }
    .status-pill-select:focus { outline: none; border-color: var(--primary); }
    .status-pill-select option { color: var(--fg); background: var(--bg-2); }

    /* Pipeline status colours — gold for the in-flight states, green for
       successful ones, blue for interviewing, purple for "with the client",
       red for rejections. Same data-status attribute drives both the
       static .status-pill and the editable .status-pill-select. */
    .status-pill[data-status="interviewing"], .status-pill-select[data-status="interviewing"]             { color: #6db4ff; border-color: #4d8edb; background-color: rgba(77, 142, 219, 0.15); }
    .status-pill[data-status="processing"], .status-pill-select[data-status="processing"]                 { color: var(--primary); border-color: var(--primary); background-color: rgba(255, 193, 7, 0.15); }
    .status-pill[data-status="compliant"], .status-pill-select[data-status="compliant"]                   { color: #7ed985; border-color: #4caf50; background-color: rgba(76, 175, 80, 0.15); }
    .status-pill[data-status="client_screening"], .status-pill-select[data-status="client_screening"]     { color: #d6a3ff; border-color: #8e5dc4; background-color: rgba(142, 93, 196, 0.15); }
    .status-pill[data-status="placed"], .status-pill-select[data-status="placed"]                         { color: #7ed985; border-color: #4caf50; background-color: rgba(76, 175, 80, 0.20); }
    .status-pill[data-status="rejected_by_us"], .status-pill-select[data-status="rejected_by_us"] {
      color: #f08577; border-color: #d84d3e; background-color: rgba(244, 67, 54, 0.15);
    }

    /* Update-pipeline chip selector — same status semantics as the
       pill / pill-select, rendered as a row of clickable chips so HR
       can see and reach every stage in one glance. The active chip is
       solid (status colour at 0.30 alpha) with a 2px border. */
    .pipeline-update {
      margin: 0 24px 16px;
      background: var(--bg-2); border: 1px solid var(--line);
      border-radius: var(--radius-sm); padding: 14px 16px;
      display: flex; flex-direction: column; gap: 10px;
    }
    .pipeline-label {
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
      color: var(--muted); font-weight: 600;
    }
    .pipeline-chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .pipeline-chip {
      padding: 4px 12px; border-radius: 999px;
      font-size: 12px; cursor: pointer;
      background: var(--bg-3); color: var(--muted);
      border: 1px solid var(--line);
      transition: background 0.15s, border-color 0.15s, color 0.15s;
    }
    .pipeline-chip:hover { color: var(--fg); border-color: var(--primary); }
    .pipeline-chip.active { font-weight: 600; border-width: 2px; padding: 3px 11px; }

    /* Per-status colour palette mirrors the status pills. Inactive
       chips show a 10% alpha tint; active chips bump to 30% + the
       full saturation border. */
    .pipeline-chip[data-status="new"]              { color: #b4b4b4; background-color: rgba(180,180,180,0.10); border-color: #5a5a5a; }
    .pipeline-chip[data-status="new"].active       { background-color: rgba(180,180,180,0.30); border-color: #b4b4b4; color: #f0f0f0; }
    .pipeline-chip[data-status="interviewing"]        { color: #6db4ff; background-color: rgba(77, 142, 219, 0.10); border-color: #4d8edb; }
    .pipeline-chip[data-status="interviewing"].active { background-color: rgba(77, 142, 219, 0.30); }
    .pipeline-chip[data-status="processing"]        { color: var(--primary); background-color: rgba(255, 193, 7, 0.10); border-color: var(--primary); }
    .pipeline-chip[data-status="processing"].active { background-color: rgba(255, 193, 7, 0.30); }
    .pipeline-chip[data-status="compliant"]        { color: #7ed985; background-color: rgba(76, 175, 80, 0.10); border-color: #4caf50; }
    .pipeline-chip[data-status="compliant"].active { background-color: rgba(76, 175, 80, 0.30); }
    .pipeline-chip[data-status="client_screening"]        { color: #d6a3ff; background-color: rgba(142, 93, 196, 0.10); border-color: #8e5dc4; }
    .pipeline-chip[data-status="client_screening"].active { background-color: rgba(142, 93, 196, 0.30); }
    .pipeline-chip[data-status="placed"]        { color: #7ed985; background-color: rgba(76, 175, 80, 0.18); border-color: #4caf50; }
    .pipeline-chip[data-status="placed"].active { background-color: rgba(76, 175, 80, 0.40); }
    .pipeline-chip[data-status="rejected_by_us"]            { color: #f08577; background-color: rgba(244, 67, 54, 0.10); border-color: #d84d3e; }
    .pipeline-chip[data-status="rejected_by_us"].active     { background-color: rgba(244, 67, 54, 0.30); }
    .status-pill[data-doc-status="valid"]    { color: #7ed985; border-color: #4caf50; background: rgba(76, 175, 80, 0.15); }
    .status-pill[data-doc-status="pending"]  { color: var(--primary); border-color: var(--primary); background: rgba(255, 193, 7, 0.15); }
    .status-pill[data-doc-status="expired"]  { color: #f08577; border-color: #d84d3e; background: rgba(244, 67, 54, 0.15); }
    .status-pill[data-doc-status="rejected"] { color: #f08577; border-color: #d84d3e; background: rgba(244, 67, 54, 0.15); }

    .tab-nav {
      display: flex; gap: 4px; padding: 0 24px;
      border-bottom: 1px solid var(--line); margin-bottom: 16px;
    }
    .tab-btn {
      background: transparent; color: var(--muted); border: none;
      padding: 10px 16px; border-bottom: 2px solid transparent;
      cursor: pointer; font-size: 14px; display: inline-flex; align-items: center; gap: 6px;
    }
    .tab-btn:hover { color: var(--fg); }
    .tab-btn.active { color: var(--primary); border-bottom-color: var(--primary); }
    .badge {
      background: var(--bg-3); border: 1px solid var(--line);
      padding: 1px 6px; border-radius: 999px; font-size: 10px; color: var(--muted);
    }
    .badge.warn { color: var(--primary); border-color: var(--primary); }

    .profile-grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 16px; padding: 0 24px 24px;
    }
    .card {
      background: var(--bg-2); border: 1px solid var(--line);
      border-radius: var(--radius-sm); padding: 16px;
    }
    .card.pad { margin: 0 24px 24px; }
    .card h3 { margin: 0 0 12px; font-size: 14px; }

    .kv { display: grid; grid-template-columns: 110px 1fr; gap: 6px 12px; margin: 0; }
    .kv dt { color: var(--muted); font-size: 12px; }
    .kv dd { margin: 0; font-size: 13px; }

    .progress-row { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 12px; }
    .progress-step {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 14px; border: 1px solid var(--line);
      border-radius: var(--radius-sm); background: var(--bg-3);
      font-size: 13px;
    }
    .progress-step.done { color: #7ed985; border-color: #4caf50; background: rgba(76, 175, 80, 0.12); }
    .step-mark {
      display: inline-flex; align-items: center; justify-content: center;
      width: 18px; height: 18px; border-radius: 50%;
      background: var(--bg-2); color: var(--muted);
      font-size: 11px;
    }
    .step-mark.valid   { background: rgba(76, 175, 80, 0.2); color: #7ed985; }
    .step-mark.pending { background: rgba(255, 193, 7, 0.2); color: var(--primary); }

    .contract-actions { margin-top: 12px; }

    /* ── Onboarding link card ──────────────────────────────────────── */
    .onboarding-link-card {
      display: flex; gap: 16px; align-items: flex-start;
      padding: 18px 20px; margin: 0 24px 16px;
      background:
        linear-gradient(135deg, rgba(212,169,58,0.10), rgba(212,169,58,0.02) 60%),
        var(--bg-2);
      border: 1px solid var(--line);
      border-left: 3px solid var(--primary);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
    }
    .ol-icon {
      flex: 0 0 auto;
      width: 40px; height: 40px;
      display: flex; align-items: center; justify-content: center;
      border-radius: 999px;
      background: rgba(212,169,58,0.16);
      color: var(--primary);
    }
    .ol-body { flex: 1 1 auto; min-width: 0; }
    .ol-head {
      display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
      margin-bottom: 4px;
    }
    .ol-head h3 { margin: 0; font-size: 16px; line-height: 1.2; }
    .ol-pill {
      padding: 2px 8px; border-radius: 999px;
      font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;
      border: 1px solid currentColor;
    }
    .ol-pill.pending { color: var(--primary); background: rgba(212,169,58,0.12); }
    .ol-pill.signed  { color: #10b981;        background: rgba(16,185,129,0.15); }
    .ol-sub { margin: 0 0 12px; color: var(--muted); font-size: 13px; line-height: 1.4; }

    .ol-link-row {
      display: flex; align-items: stretch; gap: 0;
      background: var(--bg-3);
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      overflow: hidden;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .ol-link-row:focus-within { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(212,169,58,0.18); }
    .ol-protocol {
      flex: 0 0 auto;
      padding: 9px 10px;
      background: rgba(255,255,255,0.04);
      color: var(--muted);
      font-family: ui-monospace, Menlo, Consolas, monospace;
      font-size: 12px;
      border-right: 1px solid var(--line);
      display: flex; align-items: center;
      user-select: none;
    }
    .ol-input {
      flex: 1 1 auto; min-width: 0;
      padding: 9px 12px;
      background: transparent; border: 0; outline: 0;
      color: var(--fg);
      font-family: ui-monospace, Menlo, Consolas, monospace;
      font-size: 13px;
      text-overflow: ellipsis;
      cursor: text;
    }
    .ol-btn {
      flex: 0 0 auto;
      display: inline-flex; align-items: center; gap: 6px;
      padding: 0 14px;
      background: transparent; border: 0; border-left: 1px solid var(--line);
      color: var(--fg); font-size: 13px; font-weight: 600;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
      text-decoration: none;
    }
    .ol-btn:hover { background: rgba(212,169,58,0.10); color: var(--primary); }
    .ol-btn.copy.flash { color: #10b981; background: rgba(16,185,129,0.10); }
    .ol-btn svg { flex-shrink: 0; }
    @media (max-width: 600px) {
      .onboarding-link-card { flex-direction: column; }
      .ol-icon { width: 32px; height: 32px; }
      .ol-link-row { flex-wrap: wrap; }
      .ol-input { min-width: 0; flex-basis: 100%; }
      .ol-protocol { border-right: 0; border-bottom: 1px solid var(--line); }
      .ol-btn { flex: 1 1 50%; justify-content: center; padding: 10px; border-left: 0; border-top: 1px solid var(--line); }
    }
    .check-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .check-list li {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 12px; background: var(--bg-3); border: 1px solid var(--line);
      border-radius: var(--radius-sm); font-size: 13px;
    }

    .sub-form {
      padding: 16px; background: var(--bg-3); border: 1px solid var(--line);
      border-radius: var(--radius-sm); margin-bottom: 16px;
    }
    /* Top action bar on the Documents tab — a single ghost button that
       opens the upload overlay. Row-level Upload / Replace buttons
       open the same overlay preselected with the target doc-type. */
    .docs-actions { display: flex; justify-content: flex-end; margin-bottom: 12px; }

    .form-grid {
      display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px;
      margin-bottom: 16px;
    }
    .form-grid > div { display: flex; flex-direction: column; }
    .form-grid .full { grid-column: 1 / -1; }
    @media (max-width: 800px) { .form-grid { grid-template-columns: 1fr 1fr; } }

    .status-select { padding: 4px 8px; width: auto; min-width: 110px; }

    .note-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
    .note-item {
      background: var(--bg-3); border: 1px solid var(--line);
      border-radius: var(--radius-sm); padding: 12px;
    }
    .note-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .note-body { margin: 8px 0 0; font-size: 13px; color: var(--fg); white-space: pre-wrap; }

    /* Sub-tab strip on the Notes tab — one per status that has notes
       (plus the candidate's current status so HR always has a tab to
       drop a fresh note into). Active sub-tab inherits the pipeline
       colour via the same data-status attribute. */
    .note-subtabs {
      display: flex; flex-wrap: wrap; gap: 6px;
      padding-bottom: 12px; margin-bottom: 12px;
      border-bottom: 1px solid var(--line);
    }
    .note-subtab {
      background: var(--bg-3); color: var(--muted); border: 1px solid var(--line);
      padding: 4px 12px; border-radius: 999px; font-size: 12px;
      cursor: pointer;
    }
    .note-subtab:hover { color: var(--fg); border-color: var(--primary); }
    .note-subtab .sub-count {
      display: inline-block; margin-left: 4px;
      background: var(--bg-2); padding: 1px 6px; border-radius: 999px;
      font-size: 10px; color: var(--muted);
    }
    .note-subtab.active { font-weight: 600; border-width: 2px; padding: 3px 11px; }
    .note-subtab.active[data-status="interviewing"]       { color: #6db4ff; border-color: #4d8edb; background-color: rgba(77, 142, 219, 0.20); }
    .note-subtab.active[data-status="processing"]         { color: var(--primary); border-color: var(--primary); background-color: rgba(255, 193, 7, 0.20); }
    .note-subtab.active[data-status="compliant"]          { color: #7ed985; border-color: #4caf50; background-color: rgba(76, 175, 80, 0.20); }
    .note-subtab.active[data-status="client_screening"]   { color: #d6a3ff; border-color: #8e5dc4; background-color: rgba(142, 93, 196, 0.20); }
    .note-subtab.active[data-status="placed"]             { color: #7ed985; border-color: #4caf50; background-color: rgba(76, 175, 80, 0.28); }
    .note-subtab.active[data-status="rejected_by_us"]     { color: #f08577; border-color: #d84d3e; background-color: rgba(244, 67, 54, 0.20); }
    .note-subtab.active[data-status="new"]                { color: #f0f0f0; border-color: #b4b4b4; background-color: rgba(180, 180, 180, 0.20); }

    /* Placements tab — current-placement summary cards + a table of
       history. Placement-status pills follow their own palette: blue =
       screening, green = placed, neutral = ended, red = rejected. */
    .section-h { margin: 18px 0 10px; font-size: 13px; color: var(--fg); }
    .current-placements { display: flex; flex-direction: column; gap: 10px; margin-bottom: 12px; }
    .placement-card {
      background: var(--bg-3); border: 1px solid var(--line);
      border-radius: var(--radius-sm); padding: 12px 14px;
    }
    .placement-card.current[data-status="placed"]    { border-color: #4caf50; }
    .placement-card.current[data-status="screening"] { border-color: #4d8edb; }
    .placement-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .placement-head strong { font-size: 14px; }
    .placement-body {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 8px 16px; margin-top: 8px; font-size: 13px;
    }
    .placement-notes { margin: 8px 0 0; }

    .status-pill[data-placement-status="screening"] { color: #6db4ff; border-color: #4d8edb; background-color: rgba(77, 142, 219, 0.15); }
    .status-pill[data-placement-status="placed"]    { color: #7ed985; border-color: #4caf50; background-color: rgba(76, 175, 80, 0.20); }
    .status-pill[data-placement-status="ended"]     { color: var(--muted); }
    .status-pill[data-placement-status="rejected"]  { color: #f08577; border-color: #d84d3e; background-color: rgba(244, 67, 54, 0.15); }

    .pill.yes { color: #7ed985; border-color: #4caf50; background: rgba(76, 175, 80, 0.15); margin-left: 6px; }

    /* Add-to-client modal — repurposes the toggle-grid + meta-row
       patterns from elsewhere in this file. The warn-banner highlights
       the "previously rejected by this client" case. */
    .meta-row { display: flex; gap: 12px; flex-wrap: wrap; align-items: end; margin: 8px 0; }
    .meta-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 140px; }
    .meta-field label { margin: 0; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
    .toggle-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 8px 0; }
    @media (max-width: 540px) { .toggle-grid { grid-template-columns: 1fr; } }
    .warn-banner {
      background: rgba(244, 67, 54, 0.12); border: 1px solid #d84d3e;
      color: #f08577; padding: 8px 12px; border-radius: var(--radius-sm);
      font-size: 13px; margin: 8px 0 0;
    }

    /* Collapsible doc-group sections on the Documents tab. Markup +
       look match recruitment-settings.ts exactly — same group card with
       a card-row list inside (NOT a table). */
    .group-list { display: flex; flex-direction: column; gap: 12px; }
    .group-card {
      background: var(--bg-2); border: 1px solid var(--line);
      border-radius: var(--radius-sm); overflow: hidden;
    }
    .group-head {
      width: 100%;
      display: flex; align-items: center; gap: 10px;
      background: var(--bg-3); border: 0; border-bottom: 1px solid var(--line);
      padding: 12px 14px; cursor: pointer; color: var(--fg);
      font: inherit; text-align: left;
    }
    .group-head:hover { background: var(--bg-2); }
    .group-title { font-size: 14px; }
    .caret { color: var(--muted); width: 14px; display: inline-block; }

    .type-list { list-style: none; margin: 0; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
    .type-item {
      background: var(--bg-3); border: 1px solid var(--line);
      border-radius: var(--radius-sm); padding: 10px 12px;
      display: flex; flex-direction: column; gap: 4px;
    }
    .type-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .type-head strong { font-size: 14px; }

    /* X/Y uploaded badge on the right of each group header. Goes green
       once the whole group is covered. */
    .uploaded-badge {
      background: var(--bg-2); color: var(--muted); border: 1px solid var(--line);
      padding: 3px 10px; border-radius: 999px; font-size: 11px;
    }
    .uploaded-badge.complete {
      color: #7ed985; border-color: #4caf50; background: rgba(76, 175, 80, 0.12);
    }

    /* Pills inside each type card. Mirror the Settings pill palette
       (gold = required, muted = optional, blue = info-only), plus
       status pills for the submitted state. */
    .pill {
      display: inline-block; padding: 2px 8px; border-radius: 999px;
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;
      border: 1px solid var(--line); background: var(--bg-2); color: var(--muted);
    }
    .pill.required { color: var(--primary); border-color: var(--primary); background: rgba(255,193,7,0.12); }
    .pill.optional { color: var(--muted); }
    .pill.info     { color: #6db4ff; border-color: #4d8edb; background: rgba(77, 142, 219, 0.12); }
    .pill.yes      { color: #7ed985; border-color: #4caf50; background: rgba(76, 175, 80, 0.15); margin-right: 6px; }
    .pill[data-status="valid"]    { color: #7ed985; border-color: #4caf50; background: rgba(76, 175, 80, 0.15); }
    .pill[data-status="pending"]  { color: var(--primary); border-color: var(--primary); background: rgba(255, 193, 7, 0.15); }
    .pill[data-status="expired"]  { color: #f08577; border-color: #d84d3e; background: rgba(244, 67, 54, 0.15); }
    .pill[data-status="rejected"] { color: #f08577; border-color: #d84d3e; background: rgba(244, 67, 54, 0.15); }
    .missing { color: #ef4444; font-weight: 600; }

    .upload-btn { padding: 4px 10px; font-size: 12px; }
    .type-head .status-select { width: auto; min-width: 110px; padding: 4px 8px; }
    /* Green tint on approve icon-buttons in the compliance checklist —
       symmetrical with the global .icon-btn.danger red. */
    .icon-btn.approve:hover { color: #7ed985; border-color: #4caf50; background: rgba(76, 175, 80, 0.10); }

    /* Skill chips on the Profile view + as a live preview under the
       Skills input in the edit form. */
    .skill-chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .skill-chip {
      background: var(--bg-3); border: 1px solid var(--line);
      border-radius: 999px; padding: 2px 10px; font-size: 12px; color: var(--fg);
    }
    .chips-preview { margin-top: 6px; }
    .chips-summary { margin-top: 6px; word-break: break-word; }

    /* Multi-select chip picker — used to pick from the agency's
       configured skill catalogue. Click toggles in/out of draft.skills.
       Active chips invert (gold background, dark text) so the selection
       reads at a glance. */
    .skill-picker {
      display: flex; flex-wrap: wrap; gap: 6px;
      margin: 6px 0 0;
    }
    .skill-chip-toggle {
      background: var(--bg-3); color: var(--fg);
      border: 1px solid var(--line); border-radius: 999px;
      padding: 4px 12px; font-size: 12px; cursor: pointer;
      transition: background 0.15s, border-color 0.15s, color 0.15s;
    }
    .skill-chip-toggle:hover { border-color: var(--primary); }
    .skill-chip-toggle.active {
      background: var(--primary); color: #0a0a0a; border-color: var(--primary);
      font-weight: 600;
    }

    /* Row of inline toggles in the edit form (driving licence + willing
       to drive). Matches recruitment-settings.ts's toggle pattern. */
    .toggle-row {
      display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
      margin: 0 0 12px;
    }
    @media (max-width: 540px) { .toggle-row { grid-template-columns: 1fr; } }
    .inline-toggle {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 12px; background: var(--bg-3); border: 1px solid var(--line);
      border-radius: var(--radius-sm); cursor: pointer; font-size: 13px; color: var(--fg);
    }
    .inline-toggle input[type="checkbox"] { width: 16px; height: 16px; flex: 0 0 16px; }

    .required { color: #ef4444; }
    .err { color: #ef4444; font-size: 13px; margin: 6px 0 0; }
  `],
})
export class RecruitmentCandidates {
  private api = inject(Api);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  STATUSES = STATUSES;
  STATUS_LABEL = STATUS_LABEL;
  TABS = TABS;

  mode    = signal<Mode>('list');
  current = signal<RecruitmentCandidate | null>(null);
  tab     = signal<Tab>('profile');
  error   = signal<string | null>(null);

  candidates = signal<RecruitmentCandidate[]>([]);
  filterStatus = '';

  // detail tabs
  docs       = signal<RecruitmentCandidateDocument[]>([]);
  notes      = signal<RecruitmentCandidateNote[]>([]);
  onboarding = signal<RecruitmentOnboarding | null>(null);
  docTypes   = signal<RecruitmentDocType[]>([]);
  docGroups  = signal<RecruitmentDocGroup[]>([]);
  /** Skills catalogue from /recruitment/settings, used by the edit
   *  form's multi-select chip picker. */
  availableSkills = signal<RecruitmentSkill[]>([]);

  /** Placements (candidate × client). Both the Placements and Rejected
   *  tabs read from this signal, filtered by status. */
  placements = signal<RecruitmentPlacement[]>([]);
  /** Recruitment clients to pick from when adding a new placement. */
  recruitmentClients = signal<Client[]>([]);

  // Placement add/edit modal state
  showPlacementModal = signal<boolean>(false);
  placementDraft: RecruitmentPlacement = this.blankPlacement();
  placementError = signal<string | null>(null);
  placementSaving = signal<boolean>(false);

  private blankPlacement(): RecruitmentPlacement {
    return {
      client_id: 0,
      role: '',
      status: 'screening',
      currency: 'GBP',
      commission_paid_part: false,
      commission_paid_full: false,
    };
  }

  /** Active placements (the candidate's current relationship with a
   *  client): anything not in `ended` or `rejected`. Rendered as the
   *  prominent summary card at the top of the Placements tab. */
  activePlacements = computed<RecruitmentPlacement[]>(() =>
    this.placements().filter(p => p.status === 'screening' || p.status === 'placed'),
  );
  /** Past placements that ran their course (not rejections). */
  historyPlacements = computed<RecruitmentPlacement[]>(() =>
    this.placements().filter(p => p.status === 'ended'),
  );
  /** Rejections — the Rejected tab reads from this. */
  rejectedPlacements = computed<RecruitmentPlacement[]>(() =>
    this.placements().filter(p => p.status === 'rejected'),
  );

  /** Set of client ids that have rejected this candidate. Used to
   *  flag the modal's client picker so HR sees a warning before
   *  re-pitching them. */
  rejectedClientIds = computed<Set<number>>(() =>
    new Set(this.placements().filter(p => p.status === 'rejected').map(p => p.client_id)),
  );

  openAddPlacement() {
    this.placementDraft = this.blankPlacement();
    this.placementError.set(null);
    this.showPlacementModal.set(true);
  }
  closePlacementModal() {
    if (this.placementSaving()) return;
    this.showPlacementModal.set(false);
  }
  clientName(id: number | null | undefined): string {
    if (!id) return '—';
    return this.recruitmentClients().find(c => c.id === id)?.name ?? '—';
  }
  isRejectedClient(id: number | null | undefined): boolean {
    return !!id && this.rejectedClientIds().has(id);
  }
  savePlacement() {
    const id = this.current()?.id; if (!id) return;
    const d = this.placementDraft;
    if (!d.client_id || d.client_id <= 0) {
      this.placementError.set('Pick a client.');
      return;
    }
    this.placementSaving.set(true);
    this.placementError.set(null);
    const done = () => {
      this.placementSaving.set(false);
      this.showPlacementModal.set(false);
      this.api.listRecruitmentPlacements(id).subscribe(r => this.placements.set(r.placements ?? []));
    };
    if (d.id) {
      this.api.updateRecruitmentPlacement(id, d.id, d).subscribe({
        next: done,
        error: e => { this.placementSaving.set(false); this.placementError.set(e?.error?.error ?? 'Save failed.'); },
      });
    } else {
      this.api.createRecruitmentPlacement(id, d).subscribe({
        next: done,
        error: e => { this.placementSaving.set(false); this.placementError.set(e?.error?.error ?? 'Create failed.'); },
      });
    }
  }
  editPlacement(p: RecruitmentPlacement) {
    this.placementDraft = { ...p };
    this.placementError.set(null);
    this.showPlacementModal.set(true);
  }
  delPlacement(p: RecruitmentPlacement) {
    const id = this.current()?.id; if (!id || !p.id) return;
    if (!confirm(`Delete this placement with ${this.clientName(p.client_id)}?`)) return;
    this.api.deleteRecruitmentPlacement(id, p.id).subscribe(() => {
      this.api.listRecruitmentPlacements(id).subscribe(r => this.placements.set(r.placements ?? []));
    });
  }
  /** Move a placement to rejected from the Placements tab — used by
   *  the "Mark rejected" inline action so HR can record an outcome
   *  without opening the full edit modal. */
  rejectPlacement(p: RecruitmentPlacement) {
    const id = this.current()?.id; if (!id || !p.id) return;
    this.api.updateRecruitmentPlacement(id, p.id, { status: 'rejected' }).subscribe(() => {
      this.api.listRecruitmentPlacements(id).subscribe(r => this.placements.set(r.placements ?? []));
    });
  }

  /** Collapsed-group keys on the Documents tab. Stringified group id, or
   *  'ungrouped' for the pseudo-section. All groups start collapsed. */
  docCollapsed = signal<Set<string>>(new Set());
  private docsCollapsedInit = false;
  toggleDocsCollapse(key: string) {
    const next = new Set(this.docCollapsed());
    if (next.has(key)) next.delete(key); else next.add(key);
    this.docCollapsed.set(next);
  }
  private collapseAllDocGroups() {
    const keys = new Set<string>();
    for (const s of this.docCatalogView()) keys.add(s.key);
    this.docCollapsed.set(keys);
  }

  /** Full doc-type catalogue from Settings, bucketed by group, with the
   *  candidate's most recent submitted document attached (if any) per
   *  type. Empty rows render as "Missing" so HR can see what's still
   *  outstanding at a glance — mirrors the user-requested catalog UX
   *  (per the "0/16 uploaded" screenshot). Any candidate uploads that
   *  came in without a doc-type (Untyped) appear in a bonus "Other
   *  uploads" section. */
  docCatalogView = computed<DocCatalogSection[]>(() => {
    // Latest submitted doc per doc_type_id (in case the same type was
    // submitted more than once — we show the freshest).
    const latestByType = new Map<number, RecruitmentCandidateDocument>();
    const untyped: RecruitmentCandidateDocument[] = [];
    for (const d of this.docs()) {
      if (d.doc_type_id) {
        const cur = latestByType.get(d.doc_type_id);
        if (!cur || (d.uploaded_at ?? '') > (cur.uploaded_at ?? '')) {
          latestByType.set(d.doc_type_id, d);
        }
      } else {
        untyped.push(d);
      }
    }

    // Bucket types by group_id.
    const typesByGroup = new Map<number | null, RecruitmentDocType[]>();
    for (const t of this.docTypes()) {
      const gid = t.group_id ?? null;
      if (!typesByGroup.has(gid)) typesByGroup.set(gid, []);
      typesByGroup.get(gid)!.push(t);
    }

    const sections: DocCatalogSection[] = this.docGroups()
      .map((g): DocCatalogSection => {
        const types = typesByGroup.get(g.id ?? null) ?? [];
        const rows: DocCatalogRow[] = types.map(t => ({
          type: t,
          submitted: t.id ? latestByType.get(t.id) ?? null : null,
        }));
        return {
          key: String(g.id), id: g.id ?? null, name: g.name,
          uploaded: rows.filter(r => r.submitted !== null).length,
          total: rows.length,
          rows,
        };
      })
      .filter(s => s.total > 0);

    // Ungrouped types (no group_id) — still part of the catalog.
    const ungroupedTypes = typesByGroup.get(null) ?? [];
    if (ungroupedTypes.length > 0) {
      const rows: DocCatalogRow[] = ungroupedTypes.map(t => ({
        type: t,
        submitted: t.id ? latestByType.get(t.id) ?? null : null,
      }));
      sections.push({
        key: 'ungrouped', id: null, name: 'Ungrouped',
        uploaded: rows.filter(r => r.submitted !== null).length,
        total: rows.length,
        rows,
      });
    }

    // Bonus section for any uploads that came in without a doc-type.
    if (untyped.length > 0) {
      sections.push({
        key: 'other-uploads', id: null, name: 'Other uploads',
        uploaded: untyped.length,
        total: untyped.length,
        rows: untyped.map(d => ({ type: null, submitted: d })),
      });
    }

    return sections;
  });

  /** Open the upload overlay preselected with a doc-type. Triggered
   *  from each row's Upload / Replace button on the catalog. */
  uploadForType(typeId: number | null | undefined) {
    if (typeId == null) return;
    this.openUploadModal(typeId);
  }

  // upload form
  upDocTypeId   = signal<number | null>(null);
  upTitle       = '';
  upReference   = '';
  upIssuingBody = '';
  upIssued      = '';
  upExpires     = '';
  upFile        = signal<File | null>(null);
  uploading     = signal<boolean>(false);
  uploadError   = signal<string | null>(null);
  showUploadModal = signal<boolean>(false);

  /** Open the upload overlay, optionally preselecting a doc-type (when
   *  triggered from a row's Upload / Replace button). */
  openUploadModal(typeId: number | null | undefined) {
    this.upDocTypeId.set(typeId ?? null);
    this.upTitle = ''; this.upReference = ''; this.upIssuingBody = '';
    this.upIssued = ''; this.upExpires = '';
    this.upFile.set(null);
    this.uploadError.set(null);
    this.showUploadModal.set(true);
  }
  closeUploadModal() {
    if (this.uploading()) return;
    this.showUploadModal.set(false);
  }

  /** Doc-type currently selected in the upload form. Drives field
   *  visibility (which "needs_*" flags) + submit-button label. */
  selectedUpType = computed<RecruitmentDocType | null>(() => {
    const id = this.upDocTypeId();
    if (!id) return null;
    return this.docTypes().find(t => t.id === id) ?? null;
  });

  /** Whether to show a given metadata field on the upload form. Untyped
   *  uploads (no doc-type selected) show every field so an admin can
   *  capture whatever they need. */
  showField(field: 'reference' | 'issuing_body' | 'issued_at' | 'expires_at'): boolean {
    const t = this.selectedUpType();
    if (!t) return true;
    switch (field) {
      case 'reference':    return !!t.needs_reference;
      case 'issuing_body': return !!t.needs_issuing_body;
      case 'issued_at':    return !!t.needs_issue_date;
      case 'expires_at':   return !!t.needs_expiry_date;
    }
  }

  /** Submit enabled when info-only types have a doc-type chosen, OR
   *  when a file has been picked. */
  canSubmitUpload(): boolean {
    const t = this.selectedUpType();
    if (t?.submission_type === 'info_only') return !!t.id;
    return !!this.upFile();
  }

  // edit form draft
  draft: RecruitmentCandidate = this.blank();

  // cv upload (in edit mode)
  cvFile      = signal<File | null>(null);
  cvUploading = signal<boolean>(false);

  visible = computed(() => {
    const s = this.filterStatus;
    return s ? this.candidates().filter(c => c.status === s) : this.candidates();
  });

  constructor() {
    this.route.url.subscribe(() => this.syncFromUrl());
    this.route.params.subscribe(() => this.syncFromUrl());
    effect(() => {
      // Refresh list whenever we return to list mode.
      if (this.mode() === 'list') this.refreshList();
    });
  }

  // ── Routing → mode ─────────────────────────────────────────────────
  private syncFromUrl() {
    const segs = this.router.url.split('?')[0].split('/').filter(Boolean);
    const last = segs[segs.length - 1];
    const id = Number(this.route.snapshot.params['id']);
    if (last === 'new') {
      this.draft = this.blank();
      this.error.set(null);
      this.mode.set('edit');
    } else if (id) {
      // Mode flips only AFTER draft is populated — otherwise the edit
      // form renders with a blank draft (and never re-renders when we
      // overwrite the property, since `draft` isn't a signal). The
      // header used to show "New candidate" on every existing-row edit.
      this.api.getRecruitmentCandidate(id).subscribe(r => {
        this.current.set(r.candidate);
        this.onboarding.set(r.onboarding);
        this.draft = { ...r.candidate };
        this.mode.set(last === 'edit' ? 'edit' : 'view');
        this.tab.set('profile');
      });
      this.loadTabsFor(id);
    } else {
      this.mode.set('list');
    }
  }

  refreshList() {
    this.api.listRecruitmentCandidates().subscribe(r => this.candidates.set(r.candidates ?? []));
  }
  loadTabsFor(id: number) {
    this.api.listRecruitmentCandidateDocuments(id).subscribe(r => {
      this.docs.set(r.documents ?? []);
      if (!this.docsCollapsedInit) { this.collapseAllDocGroups(); this.docsCollapsedInit = true; }
    });
    this.api.listRecruitmentCandidateNotes(id).subscribe(r => {
      this.notes.set(r.notes ?? []);
      // Default the Notes sub-tab to the candidate's current pipeline
      // stage so HR lands on the right bucket without an extra click.
      if (!this.notesActiveStatus()) {
        const cur = this.current()?.status;
        if (cur) this.notesActiveStatus.set(cur);
      }
    });
    this.api.listRecruitmentDocTypes().subscribe(r => this.docTypes.set(r.types ?? []));
    this.api.listRecruitmentDocGroups().subscribe(r => {
      this.docGroups.set(r.groups ?? []);
      if (!this.docsCollapsedInit) { this.collapseAllDocGroups(); this.docsCollapsedInit = true; }
    });
    this.api.listRecruitmentSkills().subscribe(r => this.availableSkills.set(r.skills ?? []));
    this.api.listRecruitmentPlacements(id).subscribe(r => this.placements.set(r.placements ?? []));
    this.api.listRecruitmentClients().subscribe(r => this.recruitmentClients.set(r.clients ?? []));
  }

  // ── List actions ──────────────────────────────────────────────────
  view(c: RecruitmentCandidate, ev?: Event) {
    ev?.stopPropagation();
    this.router.navigate(['/recruitment/candidates', c.id]);
  }
  edit(c: RecruitmentCandidate, ev?: Event) {
    ev?.stopPropagation();
    this.router.navigate(['/recruitment/candidates', c.id, 'edit']);
  }
  del(c: RecruitmentCandidate, ev?: Event) {
    ev?.stopPropagation();
    if (!c.id) return;
    if (!confirm(`Delete ${c.first_name} ${c.last_name}? All documents + notes will be removed.`)) return;
    this.api.deleteRecruitmentCandidate(c.id).subscribe(() => this.refreshList());
  }

  // ── Edit form ─────────────────────────────────────────────────────
  cancelEdit() {
    const id = this.draft.id;
    if (id) this.router.navigate(['/recruitment/candidates', id]);
    else    this.router.navigate(['/recruitment/candidates']);
  }
  save() {
    const d = this.draft;
    if (!d.first_name?.trim() || !d.last_name?.trim()) {
      this.error.set('First and last name are required.');
      return;
    }
    this.error.set(null);
    if (d.id) {
      this.api.updateRecruitmentCandidate(d.id, d).subscribe({
        next: () => this.router.navigate(['/recruitment/candidates', d.id]),
        error: e => this.error.set(e?.error?.error ?? 'Save failed.'),
      });
    } else {
      this.api.createRecruitmentCandidate(d).subscribe({
        next: r => {
          // If the user picked a CV during creation, the upload was
          // deferred (no candidate id existed yet). Flush it now, then
          // navigate to the new candidate's view either way.
          const pending = this.cvFile();
          if (pending) {
            this.uploadCvFor(r.id, pending, () =>
              this.router.navigate(['/recruitment/candidates', r.id]));
          } else {
            this.router.navigate(['/recruitment/candidates', r.id]);
          }
        },
        error: e => this.error.set(e?.error?.error ?? 'Create failed.'),
      });
    }
  }
  /** Picking a CV file kicks the upload immediately for existing
   *  candidates; for new ones, we just stash the file and let `save()`
   *  flush it after the create call returns an id. */
  onCvFile(ev: Event) {
    const f = (ev.target as HTMLInputElement).files?.[0] ?? null;
    this.cvFile.set(f);
    const id = this.draft.id;
    if (f && id) this.uploadCvFor(id, f);
  }

  /** Shared upload helper. Refreshes `current()` on success so the
   *  Profile view's CV link picks up the new file path. */
  private uploadCvFor(id: number, file: File, after?: () => void) {
    this.cvUploading.set(true);
    this.api.uploadRecruitmentCandidateCV(id, file).subscribe({
      next: r => {
        this.draft.cv_file_path = r.file_path;
        this.cvFile.set(null);
        this.cvUploading.set(false);
        this.api.getRecruitmentCandidate(id).subscribe(res => {
          this.current.set(res.candidate);
          after?.();
        });
      },
      error: () => { this.cvUploading.set(false); after?.(); },
    });
  }

  /** Kept for backwards compat with any future explicit-button flow;
   *  not currently bound from the template. */
  uploadCv() {
    const id = this.draft.id; const f = this.cvFile();
    if (id && f) this.uploadCvFor(id, f);
  }

  // ── View tabs ─────────────────────────────────────────────────────
  setTab(t: Tab) { this.tab.set(t); }

  /** Persist a status change from the inline pill-select on the
   *  candidate view toolbar. Updates the local `current()` and list
   *  optimistically — no full refetch needed. */
  changeStatus(status: RecruitmentCandidateStatus) {
    const cur = this.current();
    if (!cur?.id || cur.status === status) return;
    this.api.updateRecruitmentCandidate(cur.id, { status }).subscribe(() => {
      this.current.set({ ...cur, status });
      // Keep the list view in sync so the pill matches when you bounce back.
      this.candidates.update(list => list.map(c => c.id === cur.id ? { ...c, status } : c));
    });
  }

  markContractSigned() {
    const id = this.current()?.id; if (!id) return;
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    this.api.updateRecruitmentCandidate(id, { contract_signed_at: now, status: 'compliant' }).subscribe(() => {
      this.api.getRecruitmentCandidate(id).subscribe(r => {
        this.current.set(r.candidate);
        this.onboarding.set(r.onboarding);
      });
    });
  }

  // ── Documents tab ─────────────────────────────────────────────────
  onUploadFile(ev: Event) {
    this.upFile.set((ev.target as HTMLInputElement).files?.[0] ?? null);
    this.uploadError.set(null);
  }
  uploadDoc() {
    const id = this.current()?.id;
    if (!id) return;
    const sel = this.selectedUpType();
    const isInfoOnly = sel?.submission_type === 'info_only';
    const f = isInfoOnly ? null : this.upFile();
    if (!isInfoOnly && !f) return;
    this.uploading.set(true);
    this.uploadError.set(null);
    this.api.uploadRecruitmentCandidateDocument(id, f, {
      title: this.upTitle?.trim() || undefined,
      doc_type_id: this.upDocTypeId() ?? undefined,
      reference_number: this.upReference?.trim() || undefined,
      issuing_body: this.upIssuingBody?.trim() || undefined,
      issued_at: this.upIssued || undefined,
      expires_at: this.upExpires || undefined,
    }).subscribe({
      next: () => {
        this.upFile.set(null);
        this.upTitle = ''; this.upReference = ''; this.upIssuingBody = '';
        this.upIssued = ''; this.upExpires = '';
        this.upDocTypeId.set(null);
        this.uploading.set(false);
        this.showUploadModal.set(false);
        this.refreshDocs(id);
      },
      error: e => { this.uploading.set(false); this.uploadError.set(e?.error?.error ?? 'Upload failed.'); },
    });
  }
  refreshDocs(id: number) {
    this.api.listRecruitmentCandidateDocuments(id).subscribe(r => this.docs.set(r.documents ?? []));
    // Refresh onboarding to update progress counts
    this.api.getRecruitmentCandidate(id).subscribe(r => this.onboarding.set(r.onboarding));
  }
  setDocStatus(d: RecruitmentCandidateDocument, status: string) {
    const id = this.current()?.id; if (!id || !d.id) return;
    this.api.updateRecruitmentCandidateDocument(id, d.id, { status: status as any }).subscribe(() => this.refreshDocs(id));
  }
  delDoc(d: RecruitmentCandidateDocument) {
    const id = this.current()?.id; if (!id || !d.id) return;
    if (!confirm(`Delete "${d.title}"?`)) return;
    this.api.deleteRecruitmentCandidateDocument(id, d.id).subscribe(() => this.refreshDocs(id));
  }

  // ── Notes tab ─────────────────────────────────────────────────────
  noteDraft: RecruitmentCandidateNote = { title: '', body: '' };

  /** Sub-tab currently selected on the Notes tab. Auto-set to the
   *  candidate's current status the first time notes are loaded. */
  notesActiveStatus = signal<RecruitmentCandidateStatus | null>(null);

  /** Statuses to show in the Notes sub-tab strip — every status that
   *  has notes, plus the candidate's current status (so HR always
   *  sees a tab they can drop a fresh note into, even if it's empty).
   *  Order follows STATUSES so the pipeline progression reads
   *  left → right. */
  noteSubtabs = computed<RecruitmentCandidateStatus[]>(() => {
    const set = new Set<RecruitmentCandidateStatus>();
    for (const n of this.notes()) {
      if (n.status) set.add(n.status);
    }
    const cur = this.current()?.status;
    if (cur) set.add(cur);
    return STATUSES.filter(s => set.has(s));
  });

  noteCountByStatus(s: RecruitmentCandidateStatus): number {
    return this.notes().filter(n => n.status === s).length;
  }

  /** Notes filtered to the active sub-tab. Falls back to all notes if
   *  no sub-tab is selected (shouldn't happen — defaults run on load). */
  filteredNotes = computed<RecruitmentCandidateNote[]>(() => {
    const s = this.notesActiveStatus();
    if (!s) return this.notes();
    return this.notes().filter(n => n.status === s);
  });

  addNote() {
    const id = this.current()?.id; if (!id) return;
    const t = this.noteDraft.title?.trim(); if (!t) return;
    this.api.createRecruitmentCandidateNote(id, { ...this.noteDraft, title: t }).subscribe(() => {
      this.noteDraft = { title: '', body: '' };
      this.api.listRecruitmentCandidateNotes(id).subscribe(r => this.notes.set(r.notes ?? []));
      // After adding, snap the active sub-tab to the candidate's current
      // status so the new note (auto-tagged with it) is visible.
      const cur = this.current()?.status; if (cur) this.notesActiveStatus.set(cur);
    });
  }
  delNote(n: RecruitmentCandidateNote) {
    const id = this.current()?.id; if (!id || !n.id) return;
    if (!confirm('Delete this note?')) return;
    this.api.deleteRecruitmentCandidateNote(id, n.id).subscribe(() => {
      this.api.listRecruitmentCandidateNotes(id).subscribe(r => this.notes.set(r.notes ?? []));
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────
  fileUrl(p: string): string { return `${environment.basePath}/${(p ?? '').replace(/^\//, '')}`; }

  /** Last "Copy" button click — drives the inline "Copied" label flip. */
  linkCopied = signal(false);

  /** Absolute URL of the public candidate onboarding portal. We resolve it
   *  against window.location.origin (not basePath) so the link is portable
   *  off the local subpath — what the candidate sees in their browser. */
  onboardingUrl(token: string | null | undefined): string {
    if (!token) return '';
    const base = `${window.location.origin}${environment.basePath ?? ''}`.replace(/\/+$/, '');
    return `${base}/recruitment-onboarding/${token}`;
  }

  /** Scheme + "://" pulled off the front for the muted prefix chip in the
   *  link card UI. Always ends in "://" or returns empty if SSR. */
  linkScheme(): string {
    if (typeof window === 'undefined' || !window.location?.protocol) return '';
    return window.location.protocol + '//';
  }

  /** onboardingUrl() with the protocol stripped — the chip + input split
   *  shows the protocol once on the left in muted text and uses the
   *  remainder as the editable value so the URL still copies whole. */
  onboardingUrlPath(token: string | null | undefined): string {
    const full = this.onboardingUrl(token);
    return full.replace(/^[a-z]+:\/\//i, '');
  }

  /** Best-effort copy to clipboard. Uses the async clipboard API where
   *  available; falls back to the legacy execCommand path on insecure
   *  contexts (some intranet deployments). */
  copyOnboardingLink(input: HTMLInputElement): void {
    // The visible input shows the URL with the protocol stripped (for the
    // split-prefix look). Re-attach the protocol on copy so what the user
    // pastes is the full, working https://… URL.
    const url = this.linkScheme() + input.value;
    if (!url || url === this.linkScheme()) return;
    const flash = () => {
      this.linkCopied.set(true);
      setTimeout(() => this.linkCopied.set(false), 1800);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(flash, () => {
        input.select();
        document.execCommand('copy');
        flash();
      });
    } else {
      input.select();
      document.execCommand('copy');
      flash();
    }
  }
  /** Latest submitted document for a given doc-type, or null if the
   *  candidate hasn't submitted that type yet. Used by the Onboarding
   *  tab's compliance checklist to anchor View / Approve / Reject
   *  actions next to each row. */
  docForType(typeId: number): RecruitmentCandidateDocument | null {
    if (!typeId) return null;
    const matches = this.docs().filter(d => d.doc_type_id === typeId);
    if (matches.length === 0) return null;
    return matches.reduce((latest, d) =>
      (d.uploaded_at ?? '') > (latest.uploaded_at ?? '') ? d : latest, matches[0]);
  }

  /** Split the comma-separated `skills` blob into trimmed, non-empty
   *  tags for chip rendering. */
  skillList(s: string | null | undefined): string[] {
    if (!s) return [];
    return s.split(',').map(x => x.trim()).filter(x => x.length > 0);
  }
  /** Whether a skill name is currently in the draft's skills blob. */
  isSkillSelected(name: string): boolean {
    return this.skillList(this.draft.skills).includes(name);
  }
  /** Toggle a skill in/out of the draft. Re-joins into the canonical
   *  comma-separated string the rest of the app reads. */
  toggleSkill(name: string) {
    const current = this.skillList(this.draft.skills);
    const idx = current.indexOf(name);
    if (idx === -1) current.push(name);
    else current.splice(idx, 1);
    this.draft.skills = current.length ? current.join(', ') : null;
  }
  /** Human-friendly label for a candidate pipeline status. Wraps the
   *  STATUS_LABEL map so the Angular template typecheck doesn't widen
   *  the index expression to `any` when the value is optional in the
   *  source type. */
  statusLabel(s: RecruitmentCandidateStatus | null | undefined): string {
    return s ? STATUS_LABEL[s] : '—';
  }

  /** Human-friendly label for the gender enum. */
  genderLabel(g: string | null | undefined): string {
    switch (g) {
      case 'male':              return 'Male';
      case 'female':            return 'Female';
      case 'other':             return 'Other';
      case 'prefer_not_to_say': return 'Prefer not to say';
      default:                  return '—';
    }
  }
  formatDate(s: string | null | undefined): string {
    if (!s) return '—';
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  private blank(): RecruitmentCandidate {
    return {
      first_name: '', last_name: '',
      currency: 'GBP', status: 'new',
    } as RecruitmentCandidate;
  }
}
