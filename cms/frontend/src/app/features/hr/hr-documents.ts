import { Component, ViewChild, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { environment } from '@env/environment';
import { Api } from '../../core/api';
import { HrDocument, HrDocumentType, HrEmployee } from '../../core/models';
import { DocumentViewer, ViewableDoc } from '../../shared/document-viewer';
import { PdfDocBuilder } from './pdf-doc-builder';

/**
 * /hr/documents — central place for HR to define which documents the company
 * requires from every employee, plus an org-wide index of what's been uploaded.
 *
 * The catalog (`hr_document_types`) drives both the onboarding portal's
 * Documents step and each employee's Documents tab — adding a type here
 * propagates everywhere automatically.
 */
@Component({
  selector: 'app-hr-documents',
  imports: [FormsModule, DocumentViewer, PdfDocBuilder],
  template: `
    <div class="toolbar">
      <h1>Documents</h1>
      <span class="spacer"></span>
      <button class="ghost" (click)="openAddType()">+ New document type</button>
      <button class="ghost" (click)="openAddContract()">+ New contract</button>
      <button class="primary" (click)="openAddSigned()">+ New signed document</button>
    </div>

    <div class="content">
      <div class="form-sections">
        <div class="section-card" [class.collapsed]="isCollapsed('signed')">
          <button class="card-title-btn" type="button" (click)="toggleSection('signed')">
            <span class="caret">{{ isCollapsed('signed') ? '▸' : '▾' }}</span>
            <h3 class="card-title">Signed documents <span class="muted small">({{ signedTypes().length }})</span></h3>
          </button>
          @if (!isCollapsed('signed')) {
            <p class="muted small no-notes">
              Templates HR uploads once (contracts, code of conduct, policies). Every active employee
              gets a copy in their Documents tab to sign electronically.
            </p>

            @if (signedTypes().length === 0) {
              <p class="muted small">No signed documents yet — add one to roll it out to every employee.</p>
            } @else {
              <ul class="type-list">
                @for (t of signedTypes(); track t.id; let i = $index; let last = $last) {
                  @let stats = signedStats(t.id!);
                  <li class="type-item">
                    <div class="type-head">
                      <strong>{{ t.name }}</strong>
                      <span class="pill required">to sign</span>
                      @if (t.template_path) {
                        <button class="file-link" type="button" (click)="previewTemplate(t)">View template</button>
                      }
                      <span class="spacer"></span>
                      <span class="muted small">{{ stats.signed }} / {{ stats.total }} signed</span>
                      <button class="ghost icon-btn" (click)="moveType(t, i, -1, 'signed')" [disabled]="i === 0" title="Move up">↑</button>
                      <button class="ghost icon-btn" (click)="moveType(t, i, 1, 'signed')" [disabled]="last" title="Move down">↓</button>
                      <button class="ghost icon-btn" (click)="editSigned(t)" title="Edit">✎</button>
                      <button class="ghost icon-btn danger" (click)="delType(t)" title="Delete">✕</button>
                    </div>
                    @if (t.description) { <div class="muted small">{{ t.description }}</div> }
                  </li>
                }
              </ul>
            }
          }
        </div>

        <div class="section-card" [class.collapsed]="isCollapsed('contract')">
          <button class="card-title-btn" type="button" (click)="toggleSection('contract')">
            <span class="caret">{{ isCollapsed('contract') ? '▸' : '▾' }}</span>
            <h3 class="card-title">Contracts <span class="muted small">({{ contractTypes().length }})</span></h3>
          </button>
          @if (!isCollapsed('contract')) {
            <p class="muted small no-notes">
              Employment contracts HR uploads or builds once. Every active employee gets a copy in
              their Documents tab to sign electronically.
            </p>

            @if (contractTypes().length === 0) {
              <p class="muted small">No contracts yet — add one to roll it out to every employee.</p>
            } @else {
              <ul class="type-list">
                @for (t of contractTypes(); track t.id; let i = $index; let last = $last) {
                  @let stats = signedStats(t.id!);
                  <li class="type-item">
                    <div class="type-head">
                      <strong>{{ t.name }}</strong>
                      <span class="pill required">contract</span>
                      @if (t.template_path) {
                        <button class="file-link" type="button" (click)="previewTemplate(t)">View template</button>
                      }
                      <span class="spacer"></span>
                      <span class="muted small">{{ stats.signed }} / {{ stats.total }} signed</span>
                      <button class="ghost icon-btn" (click)="moveType(t, i, -1, 'contract')" [disabled]="i === 0" title="Move up">↑</button>
                      <button class="ghost icon-btn" (click)="moveType(t, i, 1, 'contract')" [disabled]="last" title="Move down">↓</button>
                      <button class="ghost icon-btn" (click)="editContract(t)" title="Edit">✎</button>
                      <button class="ghost icon-btn danger" (click)="delType(t)" title="Delete">✕</button>
                    </div>
                    @if (t.description) { <div class="muted small">{{ t.description }}</div> }
                  </li>
                }
              </ul>
            }
          }
        </div>

        <div class="section-card" [class.collapsed]="isCollapsed('upload')">
          <button class="card-title-btn" type="button" (click)="toggleSection('upload')">
            <span class="caret">{{ isCollapsed('upload') ? '▸' : '▾' }}</span>
            <h3 class="card-title">Required document types <span class="muted small">({{ uploadTypes().length }})</span></h3>
          </button>
          @if (!isCollapsed('upload')) {
            <p class="muted small no-notes">
              HR-controlled catalog. New hires see these as upload slots in the onboarding portal,
              and each employee's Documents tab tracks which types they've submitted.
            </p>

            @if (uploadTypes().length === 0) {
              <p class="muted small">No types configured yet — add one to start collecting documents from employees.</p>
            } @else {
              <ul class="type-list">
                @for (t of uploadTypes(); track t.id; let i = $index; let last = $last) {
                  <li class="type-item">
                    <div class="type-head">
                      <strong>{{ t.name }}</strong>
                      @if (t.is_required) { <span class="pill required">required</span> } @else { <span class="pill optional">optional</span> }
                      @if (t.needs_reference) { <span class="pill">ref #</span> }
                      @if (t.needs_issue_date) { <span class="pill">issued</span> }
                      @if (t.needs_expiry_date) { <span class="pill">expires</span> }
                      <span class="spacer"></span>
                      <button class="ghost icon-btn" (click)="moveType(t, i, -1, 'upload')" [disabled]="i === 0" title="Move up">↑</button>
                      <button class="ghost icon-btn" (click)="moveType(t, i, 1, 'upload')" [disabled]="last" title="Move down">↓</button>
                      <button class="ghost icon-btn" (click)="editType(t)" title="Edit">✎</button>
                      <button class="ghost icon-btn danger" (click)="delType(t)" title="Delete">✕</button>
                    </div>
                    @if (t.description) { <div class="muted small">{{ t.description }}</div> }
                  </li>
                }
              </ul>
            }
          }
        </div>

        <div class="section-card" [class.collapsed]="isCollapsed('org')">
          <div class="org-head">
            <button class="card-title-btn" type="button" (click)="toggleSection('org')">
              <span class="caret">{{ isCollapsed('org') ? '▸' : '▾' }}</span>
              <h3 class="card-title">Org-wide submissions</h3>
            </button>
            @if (!isCollapsed('org')) {
              <input class="search" type="search" placeholder="Search by name…"
                     [ngModel]="search()" (ngModelChange)="search.set($event)" name="search" (click)="$event.stopPropagation()" />
              <span class="muted small">{{ filteredEmployees().length }} of {{ employees().length }}</span>
            }
          </div>
          @if (!isCollapsed('org')) {
          @if (employees().length === 0) {
            <p class="muted small no-notes">No employees yet.</p>
          } @else if (filteredEmployees().length === 0) {
            <p class="muted small no-notes">No employees match "{{ search() }}".</p>
          } @else {
            <ul class="emp-list">
              @for (e of filteredEmployees(); track e.id) {
                @let docs = docsFor(e.id!);
                @let summary = submissionSummary(e.id!);
                <li class="emp-card" [class.expanded]="expandedEmp() === e.id">
                  <button class="emp-head" (click)="toggleEmp(e.id!)">
                    <span class="caret">{{ expandedEmp() === e.id ? '▾' : '▸' }}</span>
                    <strong>{{ e.first_name }} {{ e.last_name }}</strong>
                    <span class="muted small emp-pos">{{ e.position || '—' }}</span>
                    <div class="bar"><div class="bar-fill" [style.width.%]="summary.pct"></div></div>
                    <span class="muted small filled">{{ summary.filled }} / {{ summary.required }} required</span>
                    <span class="muted small files">{{ docs.length }} file{{ docs.length === 1 ? '' : 's' }}</span>
                    <button class="ghost open-btn" (click)="$event.stopPropagation(); open(e)" title="Open profile">Open ↗</button>
                  </button>
                  @if (expandedEmp() === e.id) {
                    <div class="emp-body">
                      @if (docs.length === 0) {
                        <p class="muted small">No files uploaded yet.</p>
                      } @else {
                        <ul class="file-list">
                          @for (d of docs; track d.id) {
                            <li class="file-row">
                              <span class="cat">{{ docTypeName(d.doc_type_id) || d.category || 'general' }}</span>
                              <button class="file-link" (click)="viewing.set(d)" type="button">{{ d.title }}</button>
                              @if (d.signed_at) {
                                <span class="sig-pill signed" title="Signed {{ d.signed_at }}">✓ signed</span>
                              } @else if (d.requires_signature) {
                                <span class="sig-pill pending">awaiting signature</span>
                              }
                              @if (d.reference_number) { <span class="muted small">Ref: {{ d.reference_number }}</span> }
                              @if (d.expires_at) { <span class="muted small">expires {{ d.expires_at }}</span> }
                              <span class="spacer"></span>
                              <span class="muted small">{{ d.uploaded_at }}</span>
                            </li>
                          }
                        </ul>
                      }
                    </div>
                  }
                </li>
              }
            </ul>
          }
          }
        </div>
      </div>
    </div>

    <app-document-viewer [doc]="viewing()" (closed)="viewing.set(null)"></app-document-viewer>

    @if (showForm()) {
      <div class="modal-backdrop" (click)="closeForm()">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-head">
            <h2>{{ draft.id ? 'Edit document type' : 'New document type' }}</h2>
            <button class="ghost icon-btn" (click)="closeForm()" title="Close">✕</button>
          </div>
          <div class="modal-body">
            <label>Name <span class="required">*</span></label>
            <input [(ngModel)]="draft.name" name="d_name" placeholder="e.g. Passport / National ID" />

            <label>Description</label>
            <textarea rows="2" [(ngModel)]="draft.description" name="d_desc" placeholder="Optional helper text shown to the employee."></textarea>

            <div class="meta-row">
              <div class="meta-field">
                <label>Required?</label>
                <label class="inline-toggle">
                  <input type="checkbox" [(ngModel)]="draft.is_required" name="d_req" />
                  <span>Mandatory for every employee</span>
                </label>
              </div>
            </div>
            <div class="meta-row">
              <div class="meta-field">
                <label>Reference #</label>
                <label class="inline-toggle">
                  <input type="checkbox" [(ngModel)]="draft.needs_reference" name="d_ref" />
                  <span>Ask for reference number</span>
                </label>
              </div>
              <div class="meta-field">
                <label>Issue date</label>
                <label class="inline-toggle">
                  <input type="checkbox" [(ngModel)]="draft.needs_issue_date" name="d_iss" />
                  <span>Ask for issue date</span>
                </label>
              </div>
              <div class="meta-field">
                <label>Expiry date</label>
                <label class="inline-toggle">
                  <input type="checkbox" [(ngModel)]="draft.needs_expiry_date" name="d_exp" />
                  <span>Ask for expiry date</span>
                </label>
              </div>
            </div>

            @if (formError()) { <p class="err">{{ formError() }}</p> }
          </div>
          <div class="modal-foot">
            <button class="ghost" (click)="closeForm()">Cancel</button>
            <button class="primary" (click)="saveType()" [disabled]="busy()">{{ busy() ? 'Saving…' : (draft.id ? 'Save changes' : 'Create type') }}</button>
          </div>
        </div>
      </div>
    }

    @if (showSignedForm()) {
      <div class="modal-backdrop" (click)="closeSignedForm()">
        <div class="modal modal-wide" (click)="$event.stopPropagation()">
          <div class="modal-head">
            <h2>{{ signedDraft.id ? ('Edit ' + signedKindLabel()) : ('New ' + signedKindLabel()) }}</h2>
            <button class="ghost icon-btn" (click)="closeSignedForm()" title="Close">✕</button>
          </div>
          <div class="modal-body">
            <div class="meta-row">
              <div class="meta-field">
                <label>Name <span class="required">*</span></label>
                <input [(ngModel)]="signedDraft.name" name="s_name" placeholder="e.g. Code of conduct" />
              </div>
              <div class="meta-field">
                <label>Required?</label>
                <label class="inline-toggle">
                  <input type="checkbox" [(ngModel)]="signedDraft.is_required" name="s_req" />
                  <span>Mandatory for every employee</span>
                </label>
              </div>
            </div>

            <label>Description</label>
            <textarea rows="2" [(ngModel)]="signedDraft.description" name="s_desc" placeholder="Optional helper text shown to the employee."></textarea>

            <div class="mode-tabs">
              <button type="button" class="mode-tab" [class.active]="signedMode() === 'build'" (click)="signedMode.set('build')">Build pages</button>
              <button type="button" class="mode-tab" [class.active]="signedMode() === 'upload'" (click)="signedMode.set('upload')">Upload PDF</button>
            </div>

            @if (signedMode() === 'build') {
              <p class="muted small no-notes">Compose the document page-by-page. Each page renders an A4 PDF with a standard sign zone at the bottom.</p>
              <app-pdf-doc-builder
                [title]="signedDraft.name || 'Document'"
                [initialBlocksJson]="signedDraft.template_blocks_json"></app-pdf-doc-builder>
            } @else {
              <label>Template file <span class="required">*</span></label>
              <input type="file" accept="application/pdf,image/*" (change)="onSignedTemplate($event)" />
              @if (signedTemplate()) {
                <p class="muted small">{{ signedTemplate()!.name }} · {{ formatBytes(signedTemplate()!.size) }}</p>
              } @else {
                <p class="muted small">Upload the document every employee will sign (PDF recommended).</p>
              }
            }

            @if (signedError()) { <p class="err">{{ signedError() }}</p> }
          </div>
          <div class="modal-foot">
            <button class="ghost" (click)="closeSignedForm()">Cancel</button>
            <button class="primary" (click)="saveSigned()" [disabled]="busy()">{{ busy() ? (signedMode() === 'build' ? 'Rendering…' : 'Uploading…') : (signedDraft.id ? 'Save changes' : 'Roll out to employees') }}</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .toolbar { padding: 16px 20px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--line); }
    .toolbar h1 { margin: 0; font-size: 22px; }
    .spacer { flex: 1; }
    .content { padding: 20px 24px 32px; background: #ffffff; min-height: calc(100vh - 120px); }
    .form-sections { display: flex; flex-direction: column; gap: 18px; }
    .section-card {
      background: var(--bg-3);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 18px;
      display: flex; flex-direction: column; gap: 14px;
    }
    .section-card .card-title {
      margin: 0;
      font-size: 13px; color: var(--muted);
      text-transform: uppercase; letter-spacing: 0.6px; font-weight: 700;
    }
    .card-title-btn {
      display: flex; align-items: center; gap: 8px;
      background: transparent; border: 0; padding: 0;
      cursor: pointer; color: var(--fg);
      width: fit-content;
      text-align: left;
    }
    .card-title-btn .caret { color: var(--muted); font-size: 12px; }
    .card-title-btn:hover .card-title { color: var(--primary); }
    .section-card.collapsed { gap: 0; }
    .no-notes { margin: 0; }

    .type-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .type-item {
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
      padding: 10px 12px; display: flex; flex-direction: column; gap: 4px;
    }
    .type-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .pill {
      padding: 1px 6px; border-radius: 4px; font-size: 10px;
      text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      border: 1px solid var(--line); color: var(--muted);
    }
    .pill.required { color: var(--primary); border-color: var(--primary); background: rgba(212,169,58,0.12); }
    .pill.optional { color: var(--muted); }

    .org-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .org-head .card-title { flex: 0 0 auto; }
    .org-head .search { flex: 1; min-width: 220px; max-width: 360px; }

    .emp-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .emp-card {
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
      overflow: hidden;
    }
    .emp-card.expanded { border-color: var(--primary); }
    .emp-head {
      display: grid;
      grid-template-columns: 16px auto 1fr 200px auto auto auto;
      gap: 12px; align-items: center;
      width: 100%; padding: 10px 14px;
      background: transparent; border: 0; color: var(--fg);
      cursor: pointer; text-align: left; font: inherit;
    }
    .emp-head:hover { background: rgba(212,169,58,0.04); border: 0; }
    .emp-head .caret { color: var(--muted); font-size: 12px; }
    .emp-head .emp-pos { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .emp-head .filled { white-space: nowrap; }
    .emp-head .files { white-space: nowrap; }
    .emp-head .open-btn { padding: 4px 10px; font-size: 12px; }
    .bar { height: 6px; background: var(--bg-3); border-radius: 999px; overflow: hidden; border: 1px solid var(--line); }
    .bar-fill { height: 100%; background: var(--primary); transition: width 0.2s; }
    .emp-body {
      padding: 12px 14px 14px; border-top: 1px solid var(--line); background: var(--bg-3);
    }
    .file-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
    .file-row {
      display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
      padding: 8px 10px;
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
      font-size: 13px;
    }
    .file-row .cat {
      padding: 1px 6px; border-radius: 4px; font-size: 10px;
      text-transform: uppercase; letter-spacing: 0.5px;
      background: var(--bg-3); color: var(--muted); border: 1px solid var(--line);
    }
    .file-row a { color: var(--fg); }
    .file-row .spacer { flex: 1; }
    .file-link {
      background: transparent; border: 0; padding: 0;
      color: var(--primary); cursor: pointer; font: inherit;
      text-align: left;
    }
    .file-link:hover { text-decoration: underline; }
    .sig-pill {
      padding: 1px 6px; border-radius: 4px; font-size: 10px;
      text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      border: 1px solid var(--line);
    }
    .sig-pill.signed { color: var(--primary); border-color: var(--primary); background: rgba(212,169,58,0.12); }
    .sig-pill.pending { color: #f59e0b; border-color: #f59e0b; background: rgba(245,158,11,0.10); }

    .modal-backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,0.6);
      display: flex; align-items: center; justify-content: center; z-index: 100;
    }
    .modal {
      width: 620px; max-width: 92vw; max-height: 92vh;
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius);
      display: flex; flex-direction: column;
      overflow: hidden;
    }
    .modal-wide { width: 1080px; }
    .modal .modal-head { flex: 0 0 auto; }
    .modal .modal-body { flex: 1 1 auto; overflow: auto; }
    .modal .modal-foot { flex: 0 0 auto; }
    .mode-tabs {
      display: flex; gap: 4px;
      margin: 8px 0 4px;
      border-bottom: 1px solid var(--line);
    }
    .mode-tab {
      padding: 8px 14px;
      background: transparent; border: 0; border-bottom: 2px solid transparent;
      color: var(--muted); cursor: pointer; font: inherit;
    }
    .mode-tab:hover { color: var(--fg); }
    .mode-tab.active { color: var(--primary); border-bottom-color: var(--primary); }
    .modal-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid var(--line); }
    .modal-head h2 { margin: 0; font-size: 16px; }
    .modal-body { padding: 16px 18px; display: flex; flex-direction: column; gap: 8px; }
    .modal-body label { margin-top: 6px; }
    .modal-foot { padding: 14px 18px; border-top: 1px solid var(--line); display: flex; justify-content: flex-end; gap: 8px; }
    .meta-row { display: flex; gap: 12px; flex-wrap: wrap; align-items: end; }
    .meta-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 200px; }
    .meta-field label { margin: 0; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
    .meta-field input, .meta-field select { width: 100%; }
    .inline-toggle {
      display: inline-flex; align-items: center; gap: 8px;
      margin: 0; padding: 8px 10px;
      background: var(--bg-3); border: 1px solid var(--line); border-radius: var(--radius-sm);
      cursor: pointer; white-space: nowrap;
      text-transform: none; letter-spacing: normal;
      color: var(--fg); font-size: 13px;
      width: 100%;
    }
    .inline-toggle input[type="checkbox"] { width: 16px; height: 16px; flex: 0 0 16px; cursor: pointer; }
    .required { color: #ef4444; }
    .err { color: #ef4444; font-size: 13px; margin: 4px 0 0; }
  `],
})
export class HrDocuments {
  private api = inject(Api);
  private router = inject(Router);

  employees = signal<HrEmployee[]>([]);
  types = signal<HrDocumentType[]>([]);
  docMap = signal<Map<number, HrDocument[]>>(new Map());
  search = signal<string>('');
  expandedEmp = signal<number | null>(null);

  filteredEmployees = computed(() => {
    const q = this.search().trim().toLowerCase();
    if (!q) return this.employees();
    return this.employees().filter(e =>
      `${e.first_name ?? ''} ${e.last_name ?? ''} ${e.position ?? ''} ${e.department ?? ''}`
        .toLowerCase()
        .includes(q)
    );
  });

  uploadTypes   = computed(() => this.types().filter(t => (t.kind ?? 'upload') === 'upload'));
  signedTypes   = computed(() => this.types().filter(t => t.kind === 'signed'));
  contractTypes = computed(() => this.types().filter(t => t.kind === 'contract'));

  /** Label fragment used by the build-pages modal — switches "signed document"
   *  vs "contract" depending on what the current draft is. */
  signedKindLabel(): string {
    return (this.signedDraft.kind === 'contract') ? 'contract' : 'signed document';
  }

  collapsedSections = signal<Set<string>>(new Set());
  isCollapsed(key: string): boolean { return this.collapsedSections().has(key); }
  toggleSection(key: string) {
    const next = new Set(this.collapsedSections());
    if (next.has(key)) next.delete(key); else next.add(key);
    this.collapsedSections.set(next);
  }

  showForm = signal(false);
  busy = signal(false);
  formError = signal<string | null>(null);
  draft: HrDocumentType = this.blank();

  showSignedForm = signal(false);
  signedError = signal<string | null>(null);
  signedDraft: HrDocumentType = this.blankSigned();
  signedTemplate = signal<File | null>(null);
  signedMode = signal<'build' | 'upload'>('build');
  @ViewChild(PdfDocBuilder) pdfBuilder?: PdfDocBuilder;

  viewing = signal<ViewableDoc | null>(null);

  ngOnInit() {
    this.refreshTypes();
    this.api.listHrEmployees().subscribe(r => this.employees.set(r.employees));
    // One round-trip for the whole org's documents instead of N requests
    // (was: per-employee `listHrDocuments` fanned out via forEach).
    this.refreshAllDocs();
  }
  refreshTypes() {
    this.api.listHrDocumentTypes().subscribe(r => this.types.set(r.types));
  }
  /** Re-fetch every employee's documents in one query and rebuild the map. */
  refreshAllDocs() {
    this.api.listAllHrDocuments().subscribe(r => {
      const m = new Map<number, HrDocument[]>();
      for (const [eid, docs] of Object.entries(r.documents_by_employee ?? {})) {
        m.set(Number(eid), docs);
      }
      this.docMap.set(m);
    });
  }

  docsFor(id: number): HrDocument[] {
    return this.docMap().get(id) ?? [];
  }
  /** How many of the *required* types this employee has submitted. */
  submissionSummary(id: number): { filled: number; required: number; pct: number } {
    const requiredTypes = this.types().filter(t => t.is_required);
    const docs = this.docsFor(id);
    const submittedTypeIds = new Set(docs.map(d => d.doc_type_id).filter(x => !!x));
    const filled = requiredTypes.filter(t => submittedTypeIds.has(t.id!)).length;
    const required = requiredTypes.length;
    const pct = required === 0 ? 100 : Math.round(filled / required * 100);
    return { filled, required, pct };
  }
  open(e: HrEmployee) {
    this.router.navigate(['/hr/employees', e.id], { queryParams: { tab: 'documents' } });
  }
  toggleEmp(id: number) {
    const next = this.expandedEmp() === id ? null : id;
    this.expandedEmp.set(next);
    // Pull fresh docs for this employee on every expansion so signed-elsewhere
    // updates (portal / hr-me) show up without a full page reload.
    if (next === id) {
      this.api.listHrDocuments(id).subscribe(rr => {
        const m = new Map(this.docMap());
        m.set(id, rr.documents);
        this.docMap.set(m);
      });
    }
  }
  docTypeName(typeId: number | null | undefined): string | null {
    if (!typeId) return null;
    return this.types().find(t => t.id === typeId)?.name ?? null;
  }
  docUrl(d: HrDocument): string {
    return `${environment.basePath}/${(d.file_path ?? '').replace(/^\//, '')}`;
  }

  openAddType() { this.draft = this.blank(); this.formError.set(null); this.showForm.set(true); }
  editType(t: HrDocumentType) {
    this.draft = {
      id: t.id,
      name: t.name,
      description: t.description ?? '',
      is_required: !!t.is_required,
      needs_reference: !!t.needs_reference,
      needs_issue_date: !!t.needs_issue_date,
      needs_expiry_date: !!t.needs_expiry_date,
      sort_order: t.sort_order ?? 0,
    } as HrDocumentType;
    this.formError.set(null);
    this.showForm.set(true);
  }
  closeForm() { if (!this.busy()) this.showForm.set(false); }
  saveType() {
    const d = this.draft;
    if (!d.name?.trim()) { this.formError.set('Name is required.'); return; }
    this.busy.set(true);
    this.formError.set(null);
    const payload: any = {
      name: d.name.trim(),
      description: (d.description ?? '').toString().trim() || null,
      is_required: d.is_required ? 1 : 0,
      needs_reference: d.needs_reference ? 1 : 0,
      needs_issue_date: d.needs_issue_date ? 1 : 0,
      needs_expiry_date: d.needs_expiry_date ? 1 : 0,
      sort_order: Number(d.sort_order) || 0,
    };
    const obs: import('rxjs').Observable<any> = d.id
      ? this.api.updateHrDocumentType(d.id, payload)
      : this.api.createHrDocumentType(payload);
    obs.subscribe({
      next: () => { this.busy.set(false); this.showForm.set(false); this.refreshTypes(); },
      error: (e: any) => { this.busy.set(false); this.formError.set(e?.error?.error || 'Could not save type'); },
    });
  }
  /** Swap this type's sort_order with its neighbour within its kind bucket. */
  moveType(t: HrDocumentType, idx: number, dir: -1 | 1, kind: 'upload' | 'signed' | 'contract') {
    const bucket = kind === 'signed'   ? this.signedTypes()
                 : kind === 'contract' ? this.contractTypes()
                 : this.uploadTypes();
    const j = idx + dir;
    if (j < 0 || j >= bucket.length) return;
    const a = bucket[idx], b = bucket[j];
    if (!a.id || !b.id) return;
    const aOrder = (a.sort_order ?? idx * 10);
    const bOrder = (b.sort_order ?? j * 10);
    this.api.updateHrDocumentType(a.id, { sort_order: bOrder }).subscribe();
    this.api.updateHrDocumentType(b.id, { sort_order: aOrder }).subscribe(() => this.refreshTypes());
  }

  signedStats(typeId: number): { signed: number; total: number } {
    let signed = 0, total = 0;
    this.docMap().forEach(docs => {
      docs.filter(d => d.doc_type_id === typeId).forEach(d => {
        total++;
        if (d.signed_at) signed++;
      });
    });
    return { signed, total };
  }

  previewTemplate(t: HrDocumentType) {
    if (!t.template_path) return;
    this.viewing.set({
      title: t.name,
      file_path: t.template_path,
      mime_type: t.template_mime,
      category: 'template',
    });
  }

  delType(t: HrDocumentType) {
    if (!t.id) return;
    const extra = t.kind === 'signed'
      ? '\n\nUnsigned copies on each employee will be removed too. Already-signed copies will be kept.'
      : ` Existing uploaded documents won't be deleted, but they'll lose their typed link.`;
    if (!confirm(`Delete "${t.name}"?${extra}`)) return;
    this.api.deleteHrDocumentType(t.id).subscribe(() => {
      this.refreshTypes();
      // Refresh org-wide submissions so signed-doc rows disappear immediately.
      this.refreshAllDocs();
    });
  }

  // ── Signed-document creation / edit ─────────────────────────────────────────
  openAddSigned() {
    this.signedDraft = this.blankSigned();
    this.signedTemplate.set(null);
    this.signedError.set(null);
    this.signedMode.set('build');
    this.showSignedForm.set(true);
    // Builder hydrates from [initialBlocksJson] = undefined → starts blank.
  }
  /** Same flow as a signed document but the type rides on kind='contract'
   *  so HR can keep employment contracts in their own section. */
  openAddContract() {
    this.signedDraft = this.blankContract();
    this.signedTemplate.set(null);
    this.signedError.set(null);
    this.signedMode.set('build');
    this.showSignedForm.set(true);
  }
  editContract(t: HrDocumentType) {
    this.signedDraft = {
      id: t.id,
      name: t.name,
      description: t.description ?? '',
      kind: 'contract',
      template_path: t.template_path ?? null,
      template_mime: t.template_mime ?? null,
      template_size: t.template_size ?? null,
      template_blocks_json: t.template_blocks_json ?? null,
      is_required: !!t.is_required,
      needs_reference: !!t.needs_reference,
      needs_issue_date: !!t.needs_issue_date,
      needs_expiry_date: !!t.needs_expiry_date,
      sort_order: t.sort_order ?? 0,
    } as HrDocumentType;
    this.signedTemplate.set(null);
    this.signedError.set(null);
    this.signedMode.set(t.template_blocks_json ? 'build' : 'upload');
    this.showSignedForm.set(true);
  }
  editSigned(t: HrDocumentType) {
    this.signedDraft = {
      id: t.id,
      name: t.name,
      description: t.description ?? '',
      kind: 'signed',
      template_path: t.template_path ?? null,
      template_mime: t.template_mime ?? null,
      template_size: t.template_size ?? null,
      template_blocks_json: t.template_blocks_json ?? null,
      is_required: !!t.is_required,
      needs_reference: !!t.needs_reference,
      needs_issue_date: !!t.needs_issue_date,
      needs_expiry_date: !!t.needs_expiry_date,
      sort_order: t.sort_order ?? 0,
    } as HrDocumentType;
    this.signedTemplate.set(null);
    this.signedError.set(null);
    this.signedMode.set(t.template_blocks_json ? 'build' : 'upload');
    this.showSignedForm.set(true);
    // Builder hydrates from [initialBlocksJson] = signedDraft.template_blocks_json
    // when it mounts — no manual ViewChild call needed.
  }
  closeSignedForm() { if (!this.busy()) this.showSignedForm.set(false); }
  onSignedTemplate(ev: Event) {
    const f = (ev.target as HTMLInputElement).files?.[0] ?? null;
    this.signedTemplate.set(f);
  }
  async saveSigned() {
    const d = this.signedDraft;
    if (!d.name?.trim()) { this.signedError.set('Name is required.'); return; }
    const isEdit = !!d.id;

    let file: File | null = null;
    let blocksJson: string | undefined;

    if (this.signedMode() === 'build') {
      const builder = this.pdfBuilder;
      if (!builder || builder.isEmpty()) { this.signedError.set('Add at least one block before saving.'); return; }
      this.busy.set(true);
      this.signedError.set(null);
      try {
        const safe = d.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'document';
        const blob = await builder.renderToPdfBlob(`${safe}.pdf`);
        file = new File([blob], `${safe}.pdf`, { type: 'application/pdf' });
        blocksJson = builder.serialize();
      } catch (err) {
        console.error(err);
        this.busy.set(false);
        this.signedError.set('PDF rendering failed.');
        return;
      }
    } else {
      const f = this.signedTemplate();
      if (!isEdit && !f) { this.signedError.set('Template file is required.'); return; }
      file = f;
      this.busy.set(true);
      this.signedError.set(null);
    }

    const payload: HrDocumentType = {
      ...d,
      name: d.name.trim(),
      description: (d.description ?? '').toString().trim() || null,
      sort_order: Number(d.sort_order) || 0,
    };
    const onSuccess = () => {
      this.busy.set(false);
      this.showSignedForm.set(false);
      this.refreshTypes();
      // Refresh org-wide submissions so any new / replaced rows appear immediately.
      this.refreshAllDocs();
    };
    const onError = (e: any) => {
      this.busy.set(false);
      this.signedError.set(e?.error?.error || (isEdit ? 'Could not update template' : 'Could not upload template'));
    };

    if (isEdit) {
      this.api.updateHrSignedDocumentType(d.id!, payload, file ?? undefined, blocksJson)
        .subscribe({ next: onSuccess, error: onError });
    } else {
      this.api.createHrSignedDocumentType(payload, file!, blocksJson)
        .subscribe({ next: onSuccess, error: onError });
    }
  }

  formatBytes(n: number | null | undefined): string {
    if (!n) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }

  private blank(): HrDocumentType {
    return {
      name: '',
      description: '',
      kind: 'upload',
      is_required: true,
      needs_reference: false,
      needs_issue_date: false,
      needs_expiry_date: false,
      sort_order: (this.uploadTypes().length + 1) * 10,
    } as HrDocumentType;
  }
  private blankSigned(): HrDocumentType {
    return {
      name: '',
      description: '',
      kind: 'signed',
      is_required: true,
      needs_reference: false,
      needs_issue_date: false,
      needs_expiry_date: false,
      sort_order: (this.signedTypes().length + 1) * 10,
    } as HrDocumentType;
  }
  private blankContract(): HrDocumentType {
    return {
      name: '',
      description: '',
      kind: 'contract',
      is_required: true,
      needs_reference: false,
      needs_issue_date: false,
      needs_expiry_date: false,
      sort_order: (this.contractTypes().length + 1) * 10,
    } as HrDocumentType;
  }
}
