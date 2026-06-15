import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import {
  Tender, TenderStatus,
  TenderInfo, TenderContact, TenderContactNumber, TenderDocument, TenderNote,
  TenderSection, TenderTracker, TenderTrackerRow,
} from '../../core/models';
import { DEFAULT_SECTIONS, DefaultSection } from './tender-section-defaults';
import { environment } from '@env/environment';

type Mode = 'list' | 'view' | 'edit';
type TabKey = 'info' | 'contacts' | 'application' | 'notes';

const STATUS_LABELS: Record<TenderStatus, string> = {
  planning:  'Planning',
  drafting:  'Drafting',
  submitted: 'Submitted',
  awarded:   'Awarded',
  rejected:  'Rejected',
  withdrawn: 'Withdrawn',
};

const TABS: { key: TabKey; label: string }[] = [
  { key: 'info',        label: 'Info' },
  { key: 'contacts',    label: 'Contacts' },
  { key: 'application', label: 'Application' },
  { key: 'notes',       label: 'Notes' },
];

const blankDraft = (): Tender => ({
  title: '', buyer: '', reference: '', value: null, currency: 'GBP',
  category: '', source_url: '', submission_deadline: '', decision_date: '',
  status: 'planning', notes: '',
});
const blankInfoDraft = (): TenderInfo => ({ name: '', value: '', sort_order: 0 });
const blankContactDraft = (): TenderContact => ({
  first_name: '', last_name: '', position: '', email: '',
  is_primary: false, sort_order: 0, numbers: [],
});
const blankDocDraft = (sectionId: number | null): TenderDocument => ({
  section_id: sectionId, title: '', description: '', external_url: '', sort_order: 0,
});
const blankNoteDraft = (): TenderNote => ({ title: '', body: '', sort_order: 0 });
const slugify = (s: string): string =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `custom_${Date.now()}`;

/**
 * Tenders admin — Operations system. Mirrors the clients-admin two-column
 * layout for the detail view, with a Tracker reminders panel on top of the
 * list and a section-driven Application tab.
 *
 *   /operations/tenders            → list (with collapsible Tracker panel)
 *   /operations/tenders/new        → create (edit mode + section picker)
 *   /operations/tenders/:id        → view (2-col: basic info left + tabs right)
 *   /operations/tenders/:id/edit   → edit basic info
 *
 * Tabs: Info, Contacts, Application, Notes. The previous Proposals + Pitch
 * decks tabs were consolidated into Application; each tender's chosen
 * sections (from DEFAULT_SECTIONS or custom) become the headers under that
 * single tab, with multiple documents allowed per section and per-section +
 * per-document completion toggles.
 */
@Component({
  selector: 'app-tenders-admin',
  imports: [RouterLink, FormsModule],
  template: `
    @if (mode() === 'list') {
      <div class="toolbar">
        <h1>Tenders</h1>
        <span class="spacer"></span>
        <select [(ngModel)]="filterStatus" name="status_filter" class="status-filter">
          <option value="">All statuses</option>
          @for (s of statusOptions; track s) {
            <option [value]="s">{{ statusLabel(s) }}</option>
          }
        </select>
        <button class="ghost" routerLink="/operations/tenders/import">
          <svg class="upload-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v12"/><path d="M7 9l5-5 5 5"/><path d="M5 17v3h14v-3"/></svg>
          Import list
        </button>
        <button class="primary" routerLink="/operations/tenders/new">+ New tender</button>
      </div>

      @if (tracker(); as t) {
        @if (trackerHasItems(t)) {
          <a class="tracker-strip" routerLink="/operations/taskboard">
            <strong>⚠ Tracker</strong>
            <span class="muted small">{{ trackerSummary(t) }}</span>
            <span class="spacer"></span>
            <span class="muted small">View Taskboard →</span>
          </a>
        }
      }

      @if (visible().length === 0) {
        <div class="empty">
          <p class="muted">No tenders yet.</p>
          <button class="primary" routerLink="/operations/tenders/new">Add your first tender</button>
        </div>
      } @else {
        <div class="table-wrap">
          <table class="data">
            <thead><tr>
              <th>Title</th>
              <th>Buyer</th>
              <th>Value</th>
              <th>Deadline</th>
              <th>Status</th>
              <th></th>
            </tr></thead>
            <tbody>
              @for (t of visible(); track t.id) {
                <tr (click)="view(t)">
                  <td><strong>{{ t.title }}</strong>
                    @if (t.reference) { <div class="muted small">Ref: {{ t.reference }}</div> }
                  </td>
                  <td>{{ t.buyer || '—' }}</td>
                  <td>
                    @if (t.value !== null && t.value !== undefined && t.value !== '') {
                      {{ t.currency }} {{ formatValue(t.value) }}
                    } @else { — }
                  </td>
                  <td>
                    @if (t.submission_deadline) {
                      <span [class.overdue]="isOverdue(t)">{{ formatDeadline(t.submission_deadline) }}</span>
                    } @else { — }
                  </td>
                  <td>
                    <span class="status-pill" [attr.data-status]="t.status || 'planning'">
                      {{ statusLabel(t.status || 'planning') }}
                    </span>
                  </td>
                  <td class="actions">
                    <button class="ghost icon-btn" (click)="view(t, $event)" title="View" aria-label="View">👁</button>
                    <button class="ghost icon-btn" (click)="edit(t, $event)" title="Edit" aria-label="Edit">✎</button>
                    <button class="ghost icon-btn danger" (click)="del(t, $event)" title="Delete" aria-label="Delete">✕</button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    }

    @if (mode() === 'view' && current(); as t) {
      <div class="toolbar">
        <button class="ghost" routerLink="/operations/tenders">← Back</button>
        <h1>{{ t.title }}</h1>
        <span class="spacer"></span>
        <button class="ghost" (click)="edit(t)">✎ Edit</button>
        <button class="danger" (click)="delCurrent()">Delete</button>
      </div>

      <div class="layout-2col">
        <section class="card">
          <h2>Tender</h2>
          <div class="kv"><label>Status</label>
            <div><span class="status-pill" [attr.data-status]="t.status || 'planning'">{{ statusLabel(t.status || 'planning') }}</span></div>
          </div>
          <div class="kv"><label>Buyer</label><div>{{ t.buyer || '—' }}</div></div>
          <div class="kv"><label>Reference</label><div>{{ t.reference || '—' }}</div></div>
          <div class="kv"><label>Category</label><div>{{ t.category || '—' }}</div></div>
          <div class="kv"><label>Value</label>
            <div>
              @if (t.value !== null && t.value !== undefined && t.value !== '') {
                {{ t.currency }} {{ formatValue(t.value) }}
              } @else { — }
            </div>
          </div>
          <div class="kv"><label>Submission deadline</label>
            <div [class.overdue]="isOverdue(t)">{{ t.submission_deadline || '—' }}</div>
          </div>
          <div class="kv"><label>Decision date</label><div>{{ t.decision_date || '—' }}</div></div>
          <div class="kv"><label>Source URL</label>
            <div>
              @if (t.source_url) {
                <a [href]="t.source_url" target="_blank" rel="noopener">{{ t.source_url }}</a>
              } @else { — }
            </div>
          </div>
          <div class="kv"><label>Quick notes</label><div class="notes">{{ t.notes || '—' }}</div></div>
          @if (t.created_at) { <div class="kv"><label>Created</label><div>{{ t.created_at }}</div></div> }
          @if (t.updated_at) { <div class="kv"><label>Last updated</label><div>{{ t.updated_at }}</div></div> }
        </section>

        <section class="card detail-card">
          <div class="tab-nav">
            @for (tab of tabs; track tab.key) {
              <button class="tab-btn" [class.active]="activeTab() === tab.key" (click)="setTab(tab.key)">
                {{ tab.label }}
                @if (tab.key === 'application' && sections().length > 0) {
                  <span class="tab-progress">{{ sectionsCompleteCount() }}/{{ sections().length }}</span>
                }
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
                  <div class="sub-form">
                    <label>Name <span class="req">★</span></label>
                    <input [(ngModel)]="infoDraft.name" name="if_name" placeholder="e.g. Bid lead" />
                    <label>Value</label>
                    <textarea [(ngModel)]="infoDraft.value" name="if_value" rows="3" placeholder="e.g. Jane Doe"></textarea>
                    @if (subError()) { <div class="error-msg">{{ subError() }}</div> }
                    <div class="row" style="margin-top: 16px; gap: 8px;">
                      <button class="primary" (click)="saveInfo()" [disabled]="subSaving()">
                        {{ subSaving() ? 'Saving…' : (infoDraft.id ? 'Update' : 'Save info') }}
                      </button>
                      <button class="ghost" (click)="closeInfoForm()">Close</button>
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
                  <div class="sub-form">
                    <div class="row two">
                      <div class="field"><label>First name <span class="req">★</span></label>
                        <input [(ngModel)]="contactDraft.first_name" name="cd_first" placeholder="Jane" /></div>
                      <div class="field"><label>Last name</label>
                        <input [(ngModel)]="contactDraft.last_name" name="cd_last" placeholder="Doe" /></div>
                    </div>
                    <label>Position</label>
                    <input [(ngModel)]="contactDraft.position" name="cd_pos" placeholder="Procurement officer" />
                    <label>Email</label>
                    <input type="email" [(ngModel)]="contactDraft.email" name="cd_email" placeholder="jane@example.com" />
                    <label>Numbers</label>
                    @for (n of contactNumbers(); track $index; let i = $index) {
                      <div class="num-row">
                        <input [(ngModel)]="n.number" [name]="'num_' + i" placeholder="+44 …" />
                        <input [(ngModel)]="n.label"  [name]="'lab_' + i" placeholder="mobile / office" />
                        <button class="ghost icon-btn danger" (click)="removeContactNumber(i)" title="Remove">✕</button>
                      </div>
                    }
                    <button class="ghost small" (click)="addContactNumber()" type="button">+ Add number</button>
                    <label class="check-line">
                      <input type="checkbox" [(ngModel)]="contactDraft.is_primary" name="cd_primary" />
                      Primary contact for this tender
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
                } @else if (contacts().length > 0) {
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
                          @for (n of (c.numbers || []); track n.id) {
                            <div><span class="ic">☎</span> <a [href]="'tel:' + n.number">{{ n.number }}</a> @if (n.label) { <span class="muted small">({{ n.label }})</span> }</div>
                          }
                        </div>
                      </div>
                    }
                  </div>
                }
              }

              @case ('application') {
                <div class="tab-head">
                  <h3>Application — {{ sectionsCompleteCount() }} of {{ sections().length }} sections complete</h3>
                  <span class="spacer"></span>
                  <button class="ghost small" (click)="openSectionPicker()">+ Add section</button>
                </div>

                @if (sectionPickerOpen()) {
                  <div class="sub-form">
                    <p class="muted small">Pick required document sections for this tender. Add a custom one if your need isn't listed.</p>
                    <div class="picker-grid">
                      @for (d of unusedDefaults(); track d.slug) {
                        <label class="picker-check">
                          <input type="checkbox" [checked]="pickerSelected().has(d.slug)" (change)="togglePicker(d)" />
                          <span><strong>{{ d.label }}</strong>
                          @if (d.hint) { <span class="muted small"> — {{ d.hint }}</span> }
                          </span>
                        </label>
                      }
                    </div>
                    <label>Custom section</label>
                    <div class="row" style="gap: 8px;">
                      <input [(ngModel)]="customSectionLabel" name="custom_label" placeholder="e.g. Sustainability statement" />
                      <button class="ghost" (click)="addCustomSection()" [disabled]="!customSectionLabel.trim()">Add</button>
                    </div>
                    @if (subError()) { <div class="error-msg">{{ subError() }}</div> }
                    <div class="row" style="margin-top: 16px; gap: 8px;">
                      <button class="primary" (click)="commitSectionPicks()" [disabled]="subSaving() || pickerSelected().size === 0">
                        {{ subSaving() ? 'Saving…' : 'Add ' + pickerSelected().size + ' section' + (pickerSelected().size === 1 ? '' : 's') }}
                      </button>
                      <button class="ghost" (click)="closeSectionPicker()">Close</button>
                    </div>
                  </div>
                }

                @if (sections().length === 0 && !sectionPickerOpen()) {
                  <p class="muted">No sections yet. Click <strong>+ Add section</strong> to pick required documents for this tender.</p>
                }

                @for (s of sections(); track s.id) {
                  <div class="section-block" [class.collapsed]="!isSectionExpanded(s.id!)">
                    <div class="section-head">
                      <button class="caret-btn" (click)="toggleSectionExpanded(s.id!)" type="button" [attr.aria-expanded]="isSectionExpanded(s.id!)" [title]="isSectionExpanded(s.id!) ? 'Collapse' : 'Expand'">
                        <span class="caret">›</span>
                      </button>
                      <label class="section-check">
                        <input type="checkbox" [checked]="!!s.is_completed" (change)="toggleSectionComplete(s)" />
                        <span class="section-label" [class.completed]="!!s.is_completed">{{ s.label }}</span>
                      </label>
                      <span class="spacer"></span>
                      <span class="doc-count">{{ docsForSection(s.id!).length }} doc{{ docsForSection(s.id!).length === 1 ? '' : 's' }}</span>
                      <button class="ghost small" (click)="openDocForm(s.id!)">
                        {{ docFormOpen() && docDraft.section_id === s.id ? '× Cancel' : '+ Add document' }}
                      </button>
                      <button class="ghost icon-btn danger" (click)="deleteSection(s)" title="Remove section">✕</button>
                    </div>

                    @if (isSectionExpanded(s.id!)) {
                    @if (docFormOpen() && docDraft.section_id === s.id) {
                      <div class="sub-form">
                        <label>Title <span class="req">★</span></label>
                        <input [(ngModel)]="docDraft.title" name="dd_title" placeholder="e.g. Final v3 — submission pack" />
                        <label>Description</label>
                        <textarea [(ngModel)]="docDraft.description" name="dd_desc" rows="3" placeholder="Version notes, who authored it, etc."></textarea>
                        <label>External URL <span class="muted">(Drive / Dropbox / SharePoint)</span></label>
                        <input [(ngModel)]="docDraft.external_url" name="dd_url" placeholder="https://drive.google.com/…" />
                        @if (!docDraft.id) {
                          <label>Or upload a file</label>
                          <input type="file" (change)="onDocFileChange($event)" />
                          @if (docFile()) { <p class="muted small">Will upload: {{ docFile()!.name }} ({{ formatBytes(docFile()!.size) }})</p> }
                        } @else if (docDraft.file_path) {
                          <p class="muted small">Existing file: <a [href]="fileUrl(docDraft.file_path)" target="_blank" rel="noopener">{{ existingFileName(docDraft.file_path) }}</a>. Delete this entry and re-add to swap the file.</p>
                        }
                        @if (subError()) { <div class="error-msg">{{ subError() }}</div> }
                        <div class="row" style="margin-top: 16px; gap: 8px;">
                          <button class="primary" (click)="saveDoc()" [disabled]="subSaving()">
                            {{ subSaving() ? 'Saving…' : (docDraft.id ? 'Update' : 'Save document') }}
                          </button>
                          <button class="ghost" (click)="closeDocForm()">Close</button>
                        </div>
                      </div>
                    }

                    @if (docsForSection(s.id!).length === 0 && !(docFormOpen() && docDraft.section_id === s.id)) {
                      <p class="muted small section-empty">No documents in this section yet.</p>
                    } @else {
                      <div class="doc-list">
                        @for (d of docsForSection(s.id!); track d.id) {
                          <div class="doc-card" [class.doc-done]="!!d.is_completed">
                            <div class="doc-head">
                              <label class="doc-check" title="Mark this document complete">
                                <input type="checkbox" [checked]="!!d.is_completed" (change)="toggleDocComplete(d)" />
                              </label>
                              <strong>{{ d.title }}</strong>
                              <span class="spacer"></span>
                              @if (d.file_path) { <span class="badge">File</span> }
                              @if (d.external_url) { <span class="badge">Link</span> }
                              <button class="ghost icon-btn" (click)="editDoc(d)" title="Edit">✎</button>
                              <button class="ghost icon-btn danger" (click)="deleteDoc(d)" title="Delete">✕</button>
                            </div>
                            @if (d.description) { <p class="doc-desc">{{ d.description }}</p> }
                            <div class="doc-meta">
                              @if (d.file_path) {
                                <a [href]="fileUrl(d.file_path)" target="_blank" rel="noopener">⬇ Open file</a>
                                @if (d.file_size) { <span class="muted small">{{ formatBytes(d.file_size) }}</span> }
                              }
                              @if (d.external_url) {
                                <a [href]="d.external_url" target="_blank" rel="noopener">↗ {{ d.external_url }}</a>
                              }
                            </div>
                          </div>
                        }
                      </div>
                    }
                    } <!-- /isSectionExpanded -->
                  </div>
                }

                <!-- Legacy docs without a section_id surface here so they aren't orphaned -->
                @if (unfiledDocs().length > 0) {
                  <div class="section-block">
                    <div class="section-head">
                      <span class="section-label muted"><em>Uncategorised</em></span>
                      <span class="spacer"></span>
                      <span class="doc-count">{{ unfiledDocs().length }} doc{{ unfiledDocs().length === 1 ? '' : 's' }}</span>
                    </div>
                    <div class="doc-list">
                      @for (d of unfiledDocs(); track d.id) {
                        <div class="doc-card">
                          <div class="doc-head">
                            <strong>{{ d.title }}</strong>
                            <span class="spacer"></span>
                            <button class="ghost icon-btn" (click)="editDoc(d)" title="Edit">✎</button>
                            <button class="ghost icon-btn danger" (click)="deleteDoc(d)" title="Delete">✕</button>
                          </div>
                        </div>
                      }
                    </div>
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
                  <div class="sub-form">
                    <label>Title <span class="req">★</span></label>
                    <input [(ngModel)]="noteDraft.title" name="nd_title" placeholder="Note title" />
                    <label>Body</label>
                    <textarea [(ngModel)]="noteDraft.body" name="nd_body" rows="6" placeholder="What did we learn / decide?"></textarea>
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
                } @else if (notes().length > 0) {
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
        <h1>{{ draft.id ? 'Edit tender' : 'New tender' }}</h1>
        <span class="spacer"></span>
        <button class="primary" (click)="save()" [disabled]="saving()">
          {{ saving() ? 'Saving…' : (draft.id ? 'Save' : 'Create tender') }}
        </button>
      </div>
      @if (error()) { <div class="error-msg">{{ error() }}</div> }

      <div class="card">
        <h2>Details</h2>
        <label>Title <span class="req">★</span></label>
        <input [(ngModel)]="draft.title" name="title" placeholder="Tender name" />

        <div class="row two">
          <div class="field"><label>Status</label>
            <select [(ngModel)]="draft.status" name="status">
              @for (s of statusOptions; track s) { <option [value]="s">{{ statusLabel(s) }}</option> }
            </select>
          </div>
          <div class="field"><label>Buyer / Issuing organisation</label>
            <input [(ngModel)]="draft.buyer" name="buyer" placeholder="e.g. London Borough of Camden" /></div>
        </div>

        <div class="row two">
          <div class="field"><label>Reference number</label>
            <input [(ngModel)]="draft.reference" name="reference" placeholder="e.g. CCS-RM6263" /></div>
          <div class="field"><label>Category</label>
            <input [(ngModel)]="draft.category" name="category" placeholder="e.g. Software development" /></div>
        </div>

        <div class="row two">
          <div class="field"><label>Value</label>
            <input type="number" step="0.01" min="0" [(ngModel)]="draft.value" name="value" placeholder="0.00" /></div>
          <div class="field"><label>Currency</label>
            <select [(ngModel)]="draft.currency" name="currency">
              @for (c of currencies; track c) { <option [value]="c">{{ c }}</option> }
            </select>
          </div>
        </div>

        <div class="row two">
          <div class="field"><label>Submission deadline</label>
            <input type="datetime-local" [(ngModel)]="draft.submission_deadline" name="submission_deadline" /></div>
          <div class="field"><label>Decision date</label>
            <input type="date" [(ngModel)]="draft.decision_date" name="decision_date" /></div>
        </div>

        <label>Source URL <span class="muted">(listing page)</span></label>
        <input [(ngModel)]="draft.source_url" name="source_url" placeholder="https://www.contractsfinder.service.gov.uk/Notice/…" />

        <label>Quick notes</label>
        <textarea [(ngModel)]="draft.notes" name="notes" rows="6" placeholder="Short summary — richer notes can go in the Notes tab after save."></textarea>
      </div>

      <!-- Required documents picker — only shown for NEW tenders. Existing
           tenders manage sections inside the Application tab. -->
      @if (!draft.id) {
        <div class="card">
          <h2>Required documents</h2>
          <p class="muted small">Pick which documents this tender requires. Each one becomes a section in the Application tab where you can upload multiple files / paste links.</p>
          <div class="picker-grid">
            @for (d of defaultSections; track d.slug) {
              <label class="picker-check">
                <input type="checkbox" [checked]="newSectionPicks().has(d.slug)" (change)="toggleNewSection(d)" />
                <span><strong>{{ d.label }}</strong>
                @if (d.hint) { <span class="muted small"> — {{ d.hint }}</span> }
                </span>
              </label>
            }
          </div>
          @if (customNewSections().length > 0) {
            <p class="muted small">Custom sections:</p>
            <div class="custom-chips">
              @for (c of customNewSections(); track c.slug) {
                <span class="chip">{{ c.label }} <button class="x" (click)="removeCustomNewSection(c.slug)">×</button></span>
              }
            </div>
          }
          <label>Add custom section</label>
          <div class="row" style="gap: 8px;">
            <input [(ngModel)]="customNewLabel" name="custom_new_label" placeholder="e.g. Sustainability statement" />
            <button class="ghost" (click)="addCustomNewSection()" [disabled]="!customNewLabel.trim()">Add</button>
          </div>
        </div>
      }
    }
  `,
  styles: [`
    .status-filter { padding: 6px 8px; flex: 0 0 auto; width: auto; min-width: 160px; max-width: 220px; }
    .upload-icon { width: 14px; height: 14px; vertical-align: -2px; margin-right: 6px; }
    .status-pill {
      display: inline-block; padding: 2px 10px;
      border-radius: 999px; font-size: 11px; text-transform: uppercase;
      letter-spacing: 0.5px; border: 1px solid var(--line); color: var(--muted);
    }
    .status-pill[data-status="planning"]  { color: var(--muted); }
    .status-pill[data-status="drafting"]  { color: var(--primary); border-color: var(--primary); }
    .status-pill[data-status="submitted"] { color: var(--primary); border-color: var(--primary); }
    .status-pill[data-status="awarded"]   { color: var(--success); border-color: var(--success); }
    .status-pill[data-status="rejected"]  { color: var(--danger); border-color: var(--danger); }
    .status-pill[data-status="withdrawn"] { color: var(--muted); }
    .overdue { color: var(--danger); font-weight: 600; }

    .row.two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .field { display: flex; flex-direction: column; gap: 4px; }
    .field label { margin-top: 0; }
    .check-line { display: flex; align-items: center; gap: 8px; margin-top: 14px;
      text-transform: none; letter-spacing: 0; font-size: 13px; color: var(--fg); cursor: pointer; }

    .kv { margin-bottom: 14px; }
    .kv label { display: block; color: var(--muted); font-size: 11px;
      text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 4px 0; }
    .kv > div { color: var(--fg); font-size: 14px; word-break: break-word; }
    .kv .notes { white-space: pre-wrap; }
    .card h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); margin: 0 0 12px 0; font-weight: 600; }
    /* Form-label spacing only. Excludes custom-checkbox label wrappers
       (.section-check / .picker-check / .doc-check / .check-line) so they
       don't pick up a 12px top margin and throw off vertical centring of
       the checkbox + text row. */
    .card label:not(.section-check):not(.picker-check):not(.doc-check):not(.check-line) {
      margin-top: 12px;
    }
    .req { color: var(--primary); margin-left: 2px; }

    /* ───── Tracker summary strip ──────────────────────────────────── */
    /* One-line teaser above the tenders table; full breakdown lives on
       /operations/taskboard. */
    .tracker-strip {
      display: flex; align-items: center; gap: 12px;
      padding: 10px 16px; margin-bottom: 16px;
      background: var(--bg-2); border: 1px solid var(--line);
      border-left: 3px solid var(--primary);
      border-radius: var(--radius-sm);
      color: var(--fg); text-decoration: none;
      font-size: 13px;
      transition: border-color 0.15s;
    }
    .tracker-strip:hover { border-color: var(--primary); }
    .tracker-strip .spacer { flex: 1; }

    /* ───── 2-col + tabs ───────────────────────────────────────────── */
    .layout-2col {
      display: grid; grid-template-columns: 380px 1fr;
      gap: 20px; padding: 20px; align-items: start;
    }
    @media (max-width: 1100px) { .layout-2col { grid-template-columns: 1fr; } }
    .detail-card { padding: 0; overflow: hidden; }
    .tab-nav {
      display: flex; gap: 2px;
      border-bottom: 1px solid var(--line);
      padding: 0 12px; overflow-x: auto;
    }
    .tab-btn {
      padding: 14px 16px;
      background: transparent; border: none;
      color: var(--muted); cursor: pointer;
      font-size: 13px; white-space: nowrap;
      position: relative; transition: color 0.15s;
      display: inline-flex; align-items: center; gap: 8px;
    }
    .tab-btn:hover { color: var(--fg); background: transparent; border-color: transparent; }
    .tab-btn.active { color: var(--primary); }
    .tab-btn.active::after {
      content: ''; position: absolute; bottom: -1px; left: 0; right: 0; height: 2px;
      background: var(--primary);
    }
    .tab-progress {
      background: var(--bg-3); color: var(--muted);
      padding: 1px 7px; border-radius: 999px; font-size: 11px;
      border: 1px solid var(--line);
    }
    .tab-btn.active .tab-progress { color: var(--primary); border-color: var(--primary); }
    .tab-content { padding: 24px; }
    .tab-content h3 { margin: 0 0 12px 0; font-size: 14px;
      text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); font-weight: 600; }
    .tab-head { display: flex; align-items: center; margin-bottom: 16px; }
    .tab-head h3 { margin: 0; }
    .tab-head .spacer { flex: 1; }

    /* ───── Sub-form ───────────────────────────────────────────────── */
    .sub-form {
      padding: 16px;
      background: var(--bg-3); border: 1px solid var(--line);
      border-radius: var(--radius-sm); margin-bottom: 16px;
    }
    .sub-form label { margin-top: 12px; display: block; }
    .num-row { display: grid; grid-template-columns: 1fr 140px 32px; gap: 8px; margin-top: 8px; align-items: center; }

    /* ───── Section picker (used in new-tender form + Add section) ── */
    .picker-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 8px;
      margin: 8px 0;
    }
    .picker-check {
      display: flex; align-items: center;
      padding: 12px 14px;
      background: var(--bg-2); border: 1px solid var(--line);
      border-radius: var(--radius-sm); cursor: pointer;
      font-size: 13px; color: var(--fg);
      text-transform: none; letter-spacing: 0; margin-top: 0;
      line-height: 1; /* tight box so the checkbox centres against text */
    }
    .picker-check:hover { border-color: var(--primary); }
    .picker-check > span {
      flex: 1; min-width: 0;
      line-height: 1.4; /* expand only the text-wrap area, not the row */
    }

    /* ───── Custom-styled checkbox ──────────────────────────────────────
       Native checkboxes render as raw white squares on a dark theme. We
       opt out with appearance:none and paint a themed box ourselves so
       picker / section / doc / line checkboxes all look the same.
       Critical: width is set !important to defeat the global
       "input { width: 100% }" rule that otherwise stretches the box. */
    .picker-check input[type="checkbox"],
    .section-check input[type="checkbox"],
    .doc-check input[type="checkbox"],
    .check-line input[type="checkbox"] {
      appearance: none; -webkit-appearance: none;
      width: 18px !important; height: 18px;
      flex-shrink: 0;
      /* Explicit margin-right (not flex gap) so spacing is reliable across
         browsers even when the flex container has padding + box-sizing
         quirks. align-self centres it vertically against multi-line label
         spans. */
      margin: 0 12px 0 0; padding: 0;
      align-self: center;
      background: var(--bg-3); color: var(--primary);
      border: 1.5px solid var(--line);
      border-radius: 4px;
      cursor: pointer;
      position: relative;
      box-sizing: border-box;
      transition: border-color 0.12s, background 0.12s;
      vertical-align: middle;
    }
    .picker-check input[type="checkbox"]:hover,
    .section-check input[type="checkbox"]:hover,
    .doc-check input[type="checkbox"]:hover,
    .check-line input[type="checkbox"]:hover {
      border-color: var(--primary);
    }
    .picker-check input[type="checkbox"]:checked,
    .section-check input[type="checkbox"]:checked,
    .doc-check input[type="checkbox"]:checked,
    .check-line input[type="checkbox"]:checked {
      background: var(--primary);
      border-color: var(--primary);
    }
    .picker-check input[type="checkbox"]:checked::after,
    .section-check input[type="checkbox"]:checked::after,
    .doc-check input[type="checkbox"]:checked::after,
    .check-line input[type="checkbox"]:checked::after {
      content: '';
      position: absolute;
      left: 5px; top: 1px;
      width: 4px; height: 9px;
      border: solid #0a0a0a;
      border-width: 0 2px 2px 0;
      transform: rotate(45deg);
    }
    .picker-check input[type="checkbox"]:focus-visible,
    .section-check input[type="checkbox"]:focus-visible,
    .doc-check input[type="checkbox"]:focus-visible,
    .check-line input[type="checkbox"]:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: 2px;
    }
    .custom-chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 4px 10px; background: var(--bg-3);
      border: 1px solid var(--line); border-radius: 999px; font-size: 12px;
    }
    .chip .x {
      background: transparent; border: none; color: var(--muted);
      cursor: pointer; padding: 0; line-height: 1; font-size: 16px;
    }
    .chip .x:hover { color: var(--danger); }

    /* ───── Application sections ───────────────────────────────────── */
    .section-block {
      margin-bottom: 24px; padding-bottom: 20px;
      border-bottom: 1px solid var(--line);
    }
    .section-block:last-child { border-bottom: none; padding-bottom: 0; margin-bottom: 0; }
    /* Compact when collapsed: shrink the bottom padding so consecutive
       collapsed sections sit close together for easy scanning. */
    .section-block.collapsed { padding-bottom: 4px; }

    /* Caret button — chevron that rotates 90deg when the section is
       expanded. Sits before the section-check inside .section-head. */
    .caret-btn {
      background: transparent; border: none; padding: 0 2px;
      color: var(--muted); cursor: pointer;
      width: 24px; height: 24px;
      display: inline-flex; align-items: center; justify-content: center;
      border-radius: var(--radius-sm);
      flex-shrink: 0;
    }
    .caret-btn:hover { background: var(--bg-3); color: var(--primary); }
    .caret-btn .caret {
      display: inline-block; font-size: 14px;
      transition: transform 0.15s;
      line-height: 1;
    }
    /* When the section IS expanded, the parent doesn't have .collapsed,
       so rotate the caret 90deg. Default (no class) = expanded. */
    .section-block:not(.collapsed) .caret-btn .caret { transform: rotate(90deg); }
    .section-head {
      display: flex; align-items: center; gap: 12px;
      margin-bottom: 12px;
      /* No bottom border here — the .section-block's own border-bottom
         serves as the divider between sections; an extra one on the
         head would draw a double line below each title. */
    }
    .section-head .spacer { flex: 1; }
    .section-head .doc-count {
      color: var(--muted); font-size: 12px;
      padding: 2px 8px;
      background: var(--bg-3); border-radius: 999px;
      border: 1px solid var(--line);
    }
    /* Cross-axis (vertical) centring of the checkbox + label hinges on:
       (a) flex container with align-items: center
       (b) the label text having a LINE-HEIGHT of 1 — anything taller
       (e.g. 1.4) inflates the text box and visually offsets the
       checkbox even though the boxes are technically centred.   */
    .section-check {
      display: inline-flex; align-items: center;
      cursor: pointer; margin: 0; padding: 0;
      text-transform: none; letter-spacing: 0;
      line-height: 1;
    }
    .section-label {
      font-size: 15px; font-weight: 600; color: var(--fg);
      line-height: 1;
      display: inline-block;
    }
    .section-label.completed { text-decoration: line-through; color: var(--success); }
    .section-empty { margin: 0 0 0 24px; font-style: italic; }

    /* ───── Document cards ─────────────────────────────────────────── */
    .doc-list { display: flex; flex-direction: column; gap: 10px; margin-left: 0; }
    .doc-card {
      background: var(--bg-3); border: 1px solid var(--line);
      border-radius: var(--radius-sm); padding: 12px 14px;
    }
    .doc-card.doc-done { border-left: 3px solid var(--success); opacity: 0.85; }
    .doc-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .doc-head .spacer { flex: 1; }
    .doc-check { margin: 0; padding: 0; cursor: pointer; display: flex; align-items: center; }
    .doc-desc { margin: 4px 0 8px 0; color: var(--fg); font-size: 13px; white-space: pre-wrap; }
    .doc-meta { display: flex; flex-wrap: wrap; gap: 16px; font-size: 13px; }
    .doc-meta a { color: var(--primary); text-decoration: none; }
    .doc-meta a:hover { text-decoration: underline; }
    .badge {
      display: inline-block; padding: 2px 8px;
      border-radius: 999px; font-size: 11px;
      background: var(--bg-2); color: var(--muted);
      border: 1px solid var(--line);
    }
    .badge.primary { color: var(--primary); border-color: var(--primary); }

    /* ───── Info / Contacts / Notes (reused) ───────────────────────── */
    .info-list { display: flex; flex-direction: column; gap: 4px; }
    .info-row { display: grid; grid-template-columns: 160px 1fr auto; gap: 12px; align-items: start; padding: 8px 0; border-bottom: 1px solid var(--line); margin: 0; }
    .info-row label { margin-top: 4px; }
    .info-actions { display: flex; gap: 4px; }

    .contact-list { display: flex; flex-direction: column; gap: 12px; }
    .contact-card { background: var(--bg-3); border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 12px 14px; }
    .contact-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .contact-head .spacer { flex: 1; }
    .contact-name { display: flex; flex-direction: column; gap: 2px; }
    .contact-name strong { font-size: 14px; }
    .contact-name .position { color: var(--primary); font-size: 12px; font-style: italic; }
    .contact-body { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
    .contact-body .ic { color: var(--primary); width: 18px; display: inline-block; text-align: center; margin-right: 4px; }
    .contact-body a { color: var(--fg); text-decoration: none; }
    .contact-body a:hover { color: var(--primary); }

    .note-list { display: flex; flex-direction: column; gap: 10px; }
    .note-card { background: var(--bg-3); border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 12px 14px; }
    .note-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .note-head .spacer { flex: 1; }
    .note-body { margin: 0; white-space: pre-wrap; color: var(--fg); font-size: 14px; line-height: 1.6; }
  `],
})
export class TendersAdmin {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  statusOptions: TenderStatus[] = ['planning', 'drafting', 'submitted', 'awarded', 'rejected', 'withdrawn'];
  currencies = ['GBP', 'USD', 'EUR'];
  statusLabel = (s: TenderStatus): string => STATUS_LABELS[s] || s;
  tabs = TABS;
  defaultSections = DEFAULT_SECTIONS;

  // ───────── Core list / detail state ─────────
  tenders = signal<Tender[]>([]);
  current = signal<Tender | null>(null);
  mode = signal<Mode>('list');
  activeTab = signal<TabKey>('info');
  draft: Tender = blankDraft();
  filterStatus = '';

  saving = signal(false);
  error = signal<string | null>(null);

  // ───────── Tracker ─────────
  tracker = signal<TenderTracker | null>(null);

  // ───────── Sub-resource state ─────────
  subSaving = signal(false);
  subError  = signal<string | null>(null);

  infoEntries = signal<TenderInfo[]>([]);
  infoFormOpen = signal(false);
  infoDraft: TenderInfo = blankInfoDraft();

  contacts = signal<TenderContact[]>([]);
  contactFormOpen = signal(false);
  contactDraft: TenderContact = blankContactDraft();
  contactNumbers = signal<TenderContactNumber[]>([]);

  // Application tab — sections + documents
  sections = signal<TenderSection[]>([]);
  documents = signal<TenderDocument[]>([]);
  /** Section ids the user has expanded. Default-empty = every section
   *  starts collapsed, so the user sees a clean list of section labels
   *  for easy scanning and opens only the one they care about. Reset on
   *  each visit (no persistence across page loads, intentional). */
  expandedSections = signal<Set<number>>(new Set());
  docFormOpen = signal(false);
  docDraft: TenderDocument = blankDocDraft(null);
  docFile = signal<File | null>(null);

  isSectionExpanded(id: number): boolean { return this.expandedSections().has(id); }
  toggleSectionExpanded(id: number) {
    const next = new Set(this.expandedSections());
    if (next.has(id)) next.delete(id); else next.add(id);
    this.expandedSections.set(next);
  }

  // Section picker (inside Application tab on existing tenders)
  sectionPickerOpen = signal(false);
  pickerSelected = signal<Set<string>>(new Set());
  customSectionLabel = '';
  pickerCustoms = signal<DefaultSection[]>([]);

  // New-tender section picks (lives on the edit form)
  newSectionPicks = signal<Set<string>>(new Set());
  customNewLabel = '';
  customNewSections = signal<DefaultSection[]>([]);

  notes = signal<TenderNote[]>([]);
  noteFormOpen = signal(false);
  noteDraft: TenderNote = blankNoteDraft();

  // ───────── Computeds ─────────
  visible = computed(() => {
    const f = this.filterStatus;
    const list = this.tenders();
    return f ? list.filter(t => (t.status || 'planning') === f) : list;
  });
  sectionsCompleteCount = computed(() => this.sections().filter(s => !!s.is_completed).length);
  docsForSection = (sectionId: number): TenderDocument[] =>
    this.documents().filter(d => d.section_id === sectionId);
  unfiledDocs = computed(() =>
    this.documents().filter(d => d.section_id === null || d.section_id === undefined)
  );
  /** Default sections not already used by this tender. */
  unusedDefaults = computed<DefaultSection[]>(() => {
    const used = new Set(this.sections().map(s => s.slug));
    const all = [...DEFAULT_SECTIONS, ...this.pickerCustoms()];
    return all.filter(d => !used.has(d.slug));
  });
  trackerHasItems = (t: TenderTracker): boolean =>
    t.overdue.length + t.due_soon.length + t.awaiting_decision.length + t.incomplete.length + t.stale.length > 0;
  trackerSummary = (t: TenderTracker): string => {
    const parts: string[] = [];
    if (t.overdue.length)           parts.push(`${t.overdue.length} overdue`);
    if (t.due_soon.length)          parts.push(`${t.due_soon.length} due soon`);
    if (t.awaiting_decision.length) parts.push(`${t.awaiting_decision.length} awaiting decision`);
    if (t.incomplete.length)        parts.push(`${t.incomplete.length} incomplete`);
    if (t.stale.length)             parts.push(`${t.stale.length} stale`);
    return parts.join(' · ');
  };

  // ───────── Init / routing ─────────
  constructor() {
    this.route.url.subscribe(() => this.routeToMode());
    this.route.params.subscribe(() => this.routeToMode());
    this.loadList();
  }
  private routeToMode() {
    const url = this.router.url;
    if (url.endsWith('/operations/tenders') || url.startsWith('/operations/tenders?')) {
      this.mode.set('list');
      this.current.set(null);
      this.loadTracker();
      return;
    }
    if (url.endsWith('/operations/tenders/new')) {
      this.mode.set('edit');
      this.draft = blankDraft();
      this.newSectionPicks.set(new Set());
      this.customNewSections.set([]);
      this.customNewLabel = '';
      this.error.set(null);
      return;
    }
    const editMatch = /\/operations\/tenders\/(\d+)\/edit/.exec(url);
    const viewMatch = /\/operations\/tenders\/(\d+)$/.exec(url);
    if (editMatch) this.loadOne(Number(editMatch[1]), 'edit');
    else if (viewMatch) this.loadOne(Number(viewMatch[1]), 'view');
  }
  private loadList() { this.api.listTenders().subscribe(r => this.tenders.set(r.tenders)); }
  private loadTracker() {
    this.api.getTenderTracker().subscribe({
      next: t => this.tracker.set(t),
      error: () => this.tracker.set(null),
    });
  }
  private loadOne(id: number, target: Mode) {
    this.api.getTender(id).subscribe(r => {
      this.current.set(r.tender);
      if (target === 'edit') this.draft = { ...r.tender };
      this.mode.set(target);
      if (target === 'view') {
        this.activeTab.set('info');
        this.loadTab('info', id);
        // Preload application sections so the tab nav can show the
        // "N/M complete" badge before the user ever clicks Application.
        this.api.listTenderSections(id).subscribe(s => {
          this.sections.set(s.sections);
          this.documents.set(s.documents);
        });
      }
    });
  }
  setTab(tab: TabKey) {
    this.activeTab.set(tab);
    const id = this.current()?.id;
    if (id) this.loadTab(tab, id);
  }
  private loadTab(tab: TabKey, tenderId: number) {
    this.subError.set(null);
    if (tab === 'info') {
      this.api.listTenderInfo(tenderId).subscribe(r => this.infoEntries.set(r.info));
    } else if (tab === 'contacts') {
      this.api.listTenderContacts(tenderId).subscribe(r => this.contacts.set(r.contacts));
    } else if (tab === 'notes') {
      this.api.listTenderNotes(tenderId).subscribe(r => this.notes.set(r.notes));
    } else if (tab === 'application') {
      this.api.listTenderSections(tenderId).subscribe(r => {
        this.sections.set(r.sections);
        this.documents.set(r.documents);
      });
    }
  }

  // ───────── List nav ─────────
  open(t: Tender | TenderTrackerRow) { this.router.navigate(['/operations/tenders', t.id]); }
  view(t: Tender, e?: Event) { e?.stopPropagation(); this.router.navigate(['/operations/tenders', t.id]); }
  edit(t: Tender, e?: Event) { e?.stopPropagation(); this.router.navigate(['/operations/tenders', t.id, 'edit']); }
  back() {
    if (this.draft.id) this.router.navigate(['/operations/tenders', this.draft.id]);
    else this.router.navigate(['/operations/tenders']);
  }
  del(t: Tender, e: Event) {
    e.stopPropagation();
    if (!confirm(`Delete tender "${t.title}"?`)) return;
    this.api.deleteTender(t.id!).subscribe(() => this.loadList());
  }
  delCurrent() {
    const t = this.current();
    if (!t) return;
    if (!confirm(`Delete tender "${t.title}"?`)) return;
    this.api.deleteTender(t.id!).subscribe(() => this.router.navigate(['/operations/tenders']));
  }

  // ───────── Save basic + bulk-create selected sections on new tender ─────────
  save() {
    this.error.set(null);
    const title = (this.draft.title || '').trim();
    if (!title) { this.error.set('Title is required.'); return; }
    this.saving.set(true);
    const payload: Tender = {
      ...this.draft, title,
      buyer:      (this.draft.buyer      || '').trim() || null,
      reference:  (this.draft.reference  || '').trim() || null,
      category:   (this.draft.category   || '').trim() || null,
      source_url: (this.draft.source_url || '').trim() || null,
      submission_deadline: this.draft.submission_deadline
        ? String(this.draft.submission_deadline).replace('T', ' ').slice(0, 19) : null,
      decision_date: this.draft.decision_date || null,
      value: this.draft.value === '' || this.draft.value === null || this.draft.value === undefined
        ? null : Number(this.draft.value),
    };
    const afterCreate = (id: number) => {
      // For new tenders, bulk-create the picked sections, then navigate.
      const picks = this.collectNewSectionPicks();
      if (picks.length === 0) {
        this.saving.set(false);
        this.router.navigate(['/operations/tenders', id]);
        return;
      }
      this.api.bulkCreateTenderSections(id, picks).subscribe({
        next: () => { this.saving.set(false); this.router.navigate(['/operations/tenders', id]); },
        error: () => { this.saving.set(false); this.router.navigate(['/operations/tenders', id]); },
      });
    };
    if (this.draft.id) {
      this.api.updateTender(this.draft.id, payload).subscribe({
        next: () => { this.saving.set(false); this.router.navigate(['/operations/tenders', this.draft.id]); },
        error: e => { this.saving.set(false); this.error.set(e?.error?.error || 'Save failed'); },
      });
    } else {
      this.api.createTender(payload).subscribe({
        next: r => afterCreate(r.id),
        error: e => { this.saving.set(false); this.error.set(e?.error?.error || 'Save failed'); },
      });
    }
  }

  // ───────── New-tender section picker (edit form) ─────────
  toggleNewSection(d: DefaultSection) {
    const next = new Set(this.newSectionPicks());
    if (next.has(d.slug)) next.delete(d.slug); else next.add(d.slug);
    this.newSectionPicks.set(next);
  }
  addCustomNewSection() {
    const label = this.customNewLabel.trim();
    if (!label) return;
    const slug = slugify(label);
    if (this.customNewSections().some(c => c.slug === slug)) { this.customNewLabel = ''; return; }
    this.customNewSections.set([...this.customNewSections(), { slug, label }]);
    const next = new Set(this.newSectionPicks()); next.add(slug);
    this.newSectionPicks.set(next);
    this.customNewLabel = '';
  }
  removeCustomNewSection(slug: string) {
    this.customNewSections.set(this.customNewSections().filter(c => c.slug !== slug));
    const next = new Set(this.newSectionPicks()); next.delete(slug);
    this.newSectionPicks.set(next);
  }
  private collectNewSectionPicks(): TenderSection[] {
    const merged = [...DEFAULT_SECTIONS, ...this.customNewSections()];
    const picks = this.newSectionPicks();
    return merged
      .filter(d => picks.has(d.slug))
      .map((d, i) => ({ slug: d.slug, label: d.label, sort_order: i }));
  }

  // ───────── Info tab ─────────
  toggleInfoForm() {
    if (this.infoFormOpen()) { this.closeInfoForm(); return; }
    this.infoDraft = blankInfoDraft(); this.subError.set(null); this.infoFormOpen.set(true);
  }
  closeInfoForm() { this.infoFormOpen.set(false); this.infoDraft = blankInfoDraft(); this.subError.set(null); }
  editInfo(i: TenderInfo) { this.infoDraft = { ...i }; this.subError.set(null); this.infoFormOpen.set(true); }
  saveInfo() {
    const id = this.current()?.id; if (!id) return;
    const name = (this.infoDraft.name || '').trim();
    if (!name) { this.subError.set('Name is required.'); return; }
    this.subSaving.set(true);
    const payload: TenderInfo = { ...this.infoDraft, name, value: this.infoDraft.value || null };
    const after = () => { this.subSaving.set(false); this.closeInfoForm(); this.loadTab('info', id); };
    if (this.infoDraft.id) {
      this.api.updateTenderInfo(id, this.infoDraft.id, payload).subscribe({ next: after,
        error: e => { this.subSaving.set(false); this.subError.set(e?.error?.error || 'Save failed'); } });
    } else {
      this.api.createTenderInfo(id, payload).subscribe({ next: after,
        error: e => { this.subSaving.set(false); this.subError.set(e?.error?.error || 'Save failed'); } });
    }
  }
  deleteInfo(i: TenderInfo) {
    const id = this.current()?.id; if (!id || !i.id) return;
    if (!confirm(`Delete "${i.name}"?`)) return;
    this.api.deleteTenderInfo(id, i.id).subscribe(() => this.loadTab('info', id));
  }

  // ───────── Contacts tab ─────────
  toggleContactForm() {
    if (this.contactFormOpen()) { this.closeContactForm(); return; }
    this.contactDraft = blankContactDraft(); this.contactNumbers.set([]); this.subError.set(null);
    this.contactFormOpen.set(true);
  }
  closeContactForm() { this.contactFormOpen.set(false); this.contactDraft = blankContactDraft(); this.contactNumbers.set([]); this.subError.set(null); }
  editContact(c: TenderContact) {
    this.contactDraft = { ...c };
    this.contactNumbers.set((c.numbers || []).map(n => ({ ...n })));
    this.subError.set(null); this.contactFormOpen.set(true);
  }
  addContactNumber() { this.contactNumbers.set([...this.contactNumbers(), { number: '', label: '' }]); }
  removeContactNumber(i: number) { this.contactNumbers.set(this.contactNumbers().filter((_, idx) => idx !== i)); }
  saveContact() {
    const id = this.current()?.id; if (!id) return;
    const first = (this.contactDraft.first_name || '').trim();
    if (!first) { this.subError.set('First name is required.'); return; }
    this.subSaving.set(true);
    const payload: TenderContact = {
      ...this.contactDraft, first_name: first,
      last_name: (this.contactDraft.last_name || '').trim() || null,
      position:  (this.contactDraft.position  || '').trim() || null,
      email:     (this.contactDraft.email     || '').trim() || null,
      numbers:   this.contactNumbers().filter(n => (n.number || '').trim() !== ''),
    };
    const after = () => { this.subSaving.set(false); this.closeContactForm(); this.loadTab('contacts', id); };
    if (this.contactDraft.id) {
      this.api.updateTenderContact(id, this.contactDraft.id, payload).subscribe({ next: after,
        error: e => { this.subSaving.set(false); this.subError.set(e?.error?.error || 'Save failed'); } });
    } else {
      this.api.createTenderContact(id, payload).subscribe({ next: after,
        error: e => { this.subSaving.set(false); this.subError.set(e?.error?.error || 'Save failed'); } });
    }
  }
  deleteContact(c: TenderContact) {
    const id = this.current()?.id; if (!id || !c.id) return;
    if (!confirm(`Delete ${c.first_name} ${c.last_name || ''}?`)) return;
    this.api.deleteTenderContact(id, c.id).subscribe(() => this.loadTab('contacts', id));
  }

  // ───────── Application tab — sections ─────────
  openSectionPicker() {
    this.sectionPickerOpen.set(true);
    this.pickerSelected.set(new Set());
    this.pickerCustoms.set([]);
    this.customSectionLabel = '';
    this.subError.set(null);
  }
  closeSectionPicker() { this.sectionPickerOpen.set(false); this.subError.set(null); }
  togglePicker(d: DefaultSection) {
    const next = new Set(this.pickerSelected());
    if (next.has(d.slug)) next.delete(d.slug); else next.add(d.slug);
    this.pickerSelected.set(next);
  }
  addCustomSection() {
    const label = this.customSectionLabel.trim();
    if (!label) return;
    const slug = slugify(label);
    if (this.pickerCustoms().some(c => c.slug === slug) || this.sections().some(s => s.slug === slug)) {
      this.customSectionLabel = '';
      return;
    }
    this.pickerCustoms.set([...this.pickerCustoms(), { slug, label }]);
    const next = new Set(this.pickerSelected()); next.add(slug);
    this.pickerSelected.set(next);
    this.customSectionLabel = '';
  }
  commitSectionPicks() {
    const id = this.current()?.id; if (!id) return;
    const merged = [...DEFAULT_SECTIONS, ...this.pickerCustoms()];
    const picks = this.pickerSelected();
    const toCreate: TenderSection[] = merged
      .filter(d => picks.has(d.slug))
      .map((d, i) => ({ slug: d.slug, label: d.label, sort_order: this.sections().length + i }));
    if (toCreate.length === 0) { this.closeSectionPicker(); return; }
    this.subSaving.set(true);
    this.api.bulkCreateTenderSections(id, toCreate).subscribe({
      next: () => {
        this.subSaving.set(false);
        this.closeSectionPicker();
        this.loadTab('application', id);
      },
      error: e => { this.subSaving.set(false); this.subError.set(e?.error?.error || 'Save failed'); },
    });
  }
  toggleSectionComplete(s: TenderSection) {
    const id = this.current()?.id; if (!id || !s.id) return;
    // Optimistic toggle so the strikethrough flips immediately.
    const next = this.sections().map(x => x.id === s.id ? { ...x, is_completed: !x.is_completed } : x);
    this.sections.set(next);
    this.api.toggleTenderSectionComplete(id, s.id).subscribe({
      error: () => this.loadTab('application', id), // revert on failure
    });
  }
  deleteSection(s: TenderSection) {
    const id = this.current()?.id; if (!id || !s.id) return;
    if (!confirm(`Remove the "${s.label}" section? Documents in it become uncategorised but aren't deleted.`)) return;
    this.api.deleteTenderSection(id, s.id).subscribe(() => this.loadTab('application', id));
  }

  // ───────── Documents (now keyed to sections) ─────────
  openDocForm(sectionId: number) {
    if (this.docFormOpen() && this.docDraft.section_id === sectionId) { this.closeDocForm(); return; }
    this.docDraft = blankDocDraft(sectionId);
    this.docFile.set(null);
    this.subError.set(null);
    this.docFormOpen.set(true);
    // Auto-expand the target section so the form is visible.
    if (!this.expandedSections().has(sectionId)) {
      const next = new Set(this.expandedSections());
      next.add(sectionId);
      this.expandedSections.set(next);
    }
  }
  closeDocForm() {
    this.docFormOpen.set(false);
    this.docDraft = blankDocDraft(null);
    this.docFile.set(null);
    this.subError.set(null);
  }
  editDoc(d: TenderDocument) {
    this.docDraft = { ...d };
    this.docFile.set(null);
    this.subError.set(null);
    this.docFormOpen.set(true);
  }
  onDocFileChange(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    this.docFile.set(f ?? null);
  }
  saveDoc() {
    const id = this.current()?.id; if (!id) return;
    const title = (this.docDraft.title || '').trim();
    if (!title) { this.subError.set('Title is required.'); return; }
    this.subSaving.set(true);
    const after = () => { this.subSaving.set(false); this.closeDocForm(); this.loadTab('application', id); };

    if (!this.docDraft.id && this.docFile()) {
      this.api.uploadTenderDocument(id, {
        sectionId:   this.docDraft.section_id ?? null,
        file:        this.docFile()!,
        title,
        description: this.docDraft.description || undefined,
      }).subscribe({ next: after,
        error: e => { this.subSaving.set(false); this.subError.set(e?.error?.error || 'Upload failed'); } });
      return;
    }

    const payload: TenderDocument = {
      ...this.docDraft, title,
      description:  (this.docDraft.description  || '').trim() || null,
      external_url: (this.docDraft.external_url || '').trim() || null,
    };
    if (this.docDraft.id) {
      this.api.updateTenderDocument(id, this.docDraft.id, payload).subscribe({ next: after,
        error: e => { this.subSaving.set(false); this.subError.set(e?.error?.error || 'Save failed'); } });
    } else {
      this.api.createTenderDocument(id, payload).subscribe({ next: after,
        error: e => { this.subSaving.set(false); this.subError.set(e?.error?.error || 'Save failed'); } });
    }
  }
  deleteDoc(d: TenderDocument) {
    const id = this.current()?.id; if (!id || !d.id) return;
    if (!confirm(`Delete "${d.title}"?`)) return;
    this.api.deleteTenderDocument(id, d.id).subscribe(() => this.loadTab('application', id));
  }
  toggleDocComplete(d: TenderDocument) {
    const id = this.current()?.id; if (!id || !d.id) return;
    const next = this.documents().map(x => x.id === d.id ? { ...x, is_completed: !x.is_completed } : x);
    this.documents.set(next);
    this.api.toggleTenderDocumentComplete(id, d.id).subscribe({
      error: () => this.loadTab('application', id),
    });
  }

  // ───────── Notes tab ─────────
  toggleNoteForm() {
    if (this.noteFormOpen()) { this.closeNoteForm(); return; }
    this.noteDraft = blankNoteDraft(); this.subError.set(null); this.noteFormOpen.set(true);
  }
  closeNoteForm() { this.noteFormOpen.set(false); this.noteDraft = blankNoteDraft(); this.subError.set(null); }
  editNote(n: TenderNote) { this.noteDraft = { ...n }; this.subError.set(null); this.noteFormOpen.set(true); }
  saveNote() {
    const id = this.current()?.id; if (!id) return;
    const title = (this.noteDraft.title || '').trim();
    if (!title) { this.subError.set('Title is required.'); return; }
    this.subSaving.set(true);
    const payload: TenderNote = { ...this.noteDraft, title, body: this.noteDraft.body || null };
    const after = () => { this.subSaving.set(false); this.closeNoteForm(); this.loadTab('notes', id); };
    if (this.noteDraft.id) {
      this.api.updateTenderNote(id, this.noteDraft.id, payload).subscribe({ next: after,
        error: e => { this.subSaving.set(false); this.subError.set(e?.error?.error || 'Save failed'); } });
    } else {
      this.api.createTenderNote(id, payload).subscribe({ next: after,
        error: e => { this.subSaving.set(false); this.subError.set(e?.error?.error || 'Save failed'); } });
    }
  }
  deleteNote(n: TenderNote) {
    const id = this.current()?.id; if (!id || !n.id) return;
    if (!confirm(`Delete "${n.title}"?`)) return;
    this.api.deleteTenderNote(id, n.id).subscribe(() => this.loadTab('notes', id));
  }

  // ───────── Helpers ─────────
  formatValue(v: number | string): string {
    const n = typeof v === 'string' ? parseFloat(v) : v;
    if (!Number.isFinite(n)) return String(v);
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  formatDeadline(s: string): string { return (s || '').replace('T', ' ').slice(0, 16); }
  formatBytes(b: number): string {
    if (!b) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(b) / Math.log(k));
    return `${(b / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  }
  fileUrl(rel: string | null | undefined): string {
    return `${environment.basePath}/${(rel ?? '').replace(/^\//, '')}`;
  }
  existingFileName(rel: string | null | undefined): string {
    const p = (rel ?? '').replace(/^\//, '');
    const base = p.split('/').pop() ?? '';
    return base.replace(/^\d+_/, '');
  }
  isOverdue(t: Tender): boolean {
    const s = (t.status || 'planning');
    if (s === 'submitted' || s === 'awarded' || s === 'rejected' || s === 'withdrawn') return false;
    if (!t.submission_deadline) return false;
    const deadline = new Date(String(t.submission_deadline).replace(' ', 'T'));
    return !Number.isNaN(deadline.getTime()) && deadline.getTime() < Date.now();
  }
}
