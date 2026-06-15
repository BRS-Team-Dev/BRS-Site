import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { environment } from '@env/environment';
import { Api } from '../../core/api';
import { RecruitmentOnboardingPortalSnapshot } from '../../core/models';
import { COUNTRIES } from '../hr/countries';

/*
 * /recruitment-onboarding/:token — public portal for a candidate joining
 * the agency. Four stages, no auth, no shell.
 *
 *   1. Sign contract     → marks contract_signed_at + types name
 *   2. General info      → editable subset of the candidate profile
 *   3. CV                → multipart upload, replaces previous CV
 *   4. Documents         → grouped by recruitment_doc_groups; only types
 *                          with `add_to_onboarding = 1` show up
 *
 * Mirrors the HR onboarding portal in look + auth model but the data
 * model is intentionally narrower — recruitment candidates aren't
 * employees and shouldn't be asked for tax / payroll / references.
 */

type Stage = 'sign' | 'general' | 'cv' | 'documents';

@Component({
  selector: 'app-recruitment-onboarding-portal',
  imports: [FormsModule],
  template: `
    <div class="portal">
      <header class="hd">
        <div class="brand">BuiltRightStudio · Candidate onboarding</div>
        @if (snap(); as s) {
          <div class="muted small">Welcome, {{ s.candidate.first_name }}</div>
        }
      </header>

      @if (errored()) {
        <div class="card error">
          <h2>Link not valid</h2>
          <p>This onboarding link is invalid or has expired. Please contact the agency for a fresh link.</p>
        </div>
      } @else if (snap(); as s) {
        <div class="layout">
          <aside class="steps">
            @for (st of STAGES; track st.key) {
              @let done = isStageDone(st.key);
              <button class="step"
                      [class.active]="stage() === st.key"
                      [class.done]="done"
                      (click)="stage.set(st.key)">
                <span class="step-mark">{{ done ? '✓' : '○' }}</span>
                {{ st.label }}
              </button>
            }
            <div class="progress-summary muted small">
              {{ completedCount() }} / {{ STAGES.length }} stages complete
            </div>
          </aside>

          <section class="content">
            <!-- ─── Stage 1 · Sign contract ─────────────────────────── -->
            @if (stage() === 'sign') {
              <h2>Sign your agency contract</h2>
              <p class="muted">Please review your agency contract and type your full legal name to confirm you've signed it. This records the date and name we hold on file.</p>
              @if (s.candidate.contract_signed_at) {
                <div class="info-banner">
                  <strong>Already signed</strong> · {{ formatDateTime(s.candidate.contract_signed_at) }}.
                  You don't need to do anything else here.
                </div>
              } @else {
                <div class="grid-2">
                  <div class="full">
                    <label>Type your full legal name *</label>
                    <input [(ngModel)]="signedName" name="signedName" placeholder="e.g. {{ s.candidate.first_name }} {{ s.candidate.last_name }}" />
                  </div>
                  <div class="full">
                    <label class="check">
                      <input type="checkbox" [(ngModel)]="signConfirmed" name="signConfirmed" />
                      I confirm I've read the contract and the name above is my legal signature.
                    </label>
                  </div>
                </div>
                @if (signError()) { <p class="err small">{{ signError() }}</p> }
                <div class="actions">
                  <button class="primary" (click)="submitContract()" [disabled]="saving() || !signConfirmed || !signedName.trim()">
                    {{ saving() ? 'Saving…' : 'Sign contract' }}
                  </button>
                </div>
              }
            }

            <!-- ─── Stage 2 · General info ──────────────────────────── -->
            @if (stage() === 'general') {
              <h2>About you</h2>
              <p class="muted">Check the details we hold are correct. Anything you change updates your candidate record immediately.</p>
              <div class="grid-2">
                <div><label>First name *</label><input [(ngModel)]="general.first_name" name="fn" /></div>
                <div><label>Last name *</label><input [(ngModel)]="general.last_name" name="ln" /></div>
                <div><label>Email</label><input type="email" [(ngModel)]="general.email" name="em" /></div>
                <div><label>Phone</label><input [(ngModel)]="general.phone" name="ph" /></div>
                <div><label>Date of birth</label><input type="date" [(ngModel)]="general.dob" name="dob" /></div>
                <div>
                  <label>Gender</label>
                  <select [(ngModel)]="general.gender" name="gn">
                    <option value="">— prefer not to say —</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                    <option value="prefer_not_to_say">Prefer not to say</option>
                  </select>
                </div>
                <div>
                  <label>Nationality</label>
                  <select [(ngModel)]="general.nationality" name="nt">
                    <option value="">— select —</option>
                    @for (c of countries; track c) { <option [value]="c">{{ c }}</option> }
                  </select>
                </div>
                <div>
                  <label>Country of residence</label>
                  <select [(ngModel)]="general.country" name="co">
                    <option value="">— select —</option>
                    @for (c of countries; track c) { <option [value]="c">{{ c }}</option> }
                  </select>
                </div>
                <div class="full"><label>Address line 1</label><input [(ngModel)]="general.address_line1" name="a1" /></div>
                <div class="full"><label>Address line 2</label><input [(ngModel)]="general.address_line2" name="a2" /></div>
                <div><label>City</label><input [(ngModel)]="general.city" name="ci" /></div>
                <div><label>Region / county</label><input [(ngModel)]="general.region" name="rg" /></div>
                <div><label>Postcode</label><input [(ngModel)]="general.postcode" name="pc" /></div>

                <div class="full"><h3 class="lh">Work preferences</h3></div>
                <div>
                  <label class="check">
                    <input type="checkbox" [(ngModel)]="general.has_driving_license" name="hdl" />
                    I hold a valid driving licence
                  </label>
                </div>
                <div>
                  <label class="check">
                    <input type="checkbox" [(ngModel)]="general.willing_to_drive" name="wtd" />
                    Willing to drive for work
                  </label>
                </div>
                <div><label>Primary role</label><input [(ngModel)]="general.role" name="ro" placeholder="e.g. Site Engineer" /></div>
                <div><label>Discipline</label><input [(ngModel)]="general.discipline" name="di" placeholder="e.g. Construction" /></div>
                <div>
                  <label>Experience level</label>
                  <select [(ngModel)]="general.experience_level" name="el">
                    <option value="">—</option>
                    <option value="junior">Junior</option>
                    <option value="mid">Mid</option>
                    <option value="senior">Senior</option>
                    <option value="lead">Lead</option>
                    <option value="principal">Principal</option>
                  </select>
                </div>
                <div>
                  <label>Years of experience</label>
                  <input type="number" min="0" max="60" [(ngModel)]="general.experience_years" name="ey" />
                </div>
                <div>
                  <label>Availability</label>
                  <select [(ngModel)]="general.availability" name="av">
                    <option value="">—</option>
                    <option value="immediate">Immediate</option>
                    <option value="one_week">~1 week</option>
                    <option value="two_weeks">~2 weeks</option>
                    <option value="one_month">~1 month</option>
                    <option value="later">Later</option>
                  </select>
                </div>
                <div class="full">
                  <label>Skills <span class="muted small">(comma separated)</span></label>
                  <input [(ngModel)]="general.skills" name="sk" placeholder="e.g. AutoCAD, Revit, NHS DBS" />
                </div>
              </div>
              @if (generalSaved()) { <p class="ok small">Saved ✓</p> }
              <div class="actions">
                <button class="primary" (click)="saveGeneral()" [disabled]="saving()">
                  {{ saving() ? 'Saving…' : 'Save details' }}
                </button>
              </div>
            }

            <!-- ─── Stage 3 · CV ────────────────────────────────────── -->
            @if (stage() === 'cv') {
              <h2>Upload your CV</h2>
              <p class="muted">A recent CV in PDF or Word format. Uploading a new one replaces the previous file.</p>
              @if (s.candidate.cv_file_path) {
                <p class="info-banner">
                  <strong>Current CV on file:</strong>
                  <a [href]="fileUrl(s.candidate.cv_file_path)" target="_blank" rel="noopener">View CV ↗</a>
                </p>
              }
              <div class="upload-row">
                <input type="file" (change)="onCvSelected($event)" accept=".pdf,.doc,.docx,.rtf,.odt" />
              </div>
              @if (cvError()) { <p class="err small">{{ cvError() }}</p> }
              @if (cvSaved()) { <p class="ok small">CV uploaded ✓</p> }
              <div class="actions">
                <button class="primary" (click)="uploadCv()" [disabled]="saving() || !cvFile()">
                  {{ saving() ? 'Uploading…' : 'Upload CV' }}
                </button>
              </div>
            }

            <!-- ─── Stage 4 · Documents ─────────────────────────────── -->
            @if (stage() === 'documents') {
              <h2>Compliance documents</h2>
              <p class="muted">Upload one document per type. We'll mark each one pending until the agency has reviewed it.</p>
              @if (s.doc_groups.length === 0) {
                <p class="muted small">No documents required.</p>
              } @else {
                @for (g of s.doc_groups; track g.id) {
                  <section class="group-card">
                    <h3 class="group-title">{{ g.name }}</h3>
                    <ul class="doc-list">
                      @for (it of g.items; track it.doc_type_id) {
                        <li class="doc-item">
                          <div class="doc-head">
                            <strong>{{ it.name }}</strong>
                            @if (it.is_required) { <span class="pill required">required</span> }
                            @if (it.submitted) {
                              <span class="pill" [attr.data-status]="it.submitted.status">{{ it.submitted.status }}</span>
                            }
                          </div>
                          @if (it.description) { <p class="muted small">{{ it.description }}</p> }
                          @if (it.submitted?.file_path) {
                            <p class="info-banner">
                              <strong>Submitted:</strong>
                              <a [href]="fileUrl(it.submitted!.file_path!)" target="_blank" rel="noopener">View ↗</a>
                              @if (it.submitted?.expires_at) { · expires {{ formatDate(it.submitted!.expires_at) }} }
                            </p>
                          }
                          <div class="doc-form">
                            @if (it.submission_type === 'file') {
                              <input type="file" (change)="onDocFileSelected(it.doc_type_id, $event)" />
                            }
                            @if (it.needs_reference) {
                              <input placeholder="Reference number"
                                     [value]="docMeta(it.doc_type_id).reference_number"
                                     (input)="setDocMeta(it.doc_type_id, 'reference_number', $any($event.target).value)" />
                            }
                            @if (it.needs_issuing_body) {
                              <input placeholder="Issuing body"
                                     [value]="docMeta(it.doc_type_id).issuing_body"
                                     (input)="setDocMeta(it.doc_type_id, 'issuing_body', $any($event.target).value)" />
                            }
                            @if (it.needs_issue_date) {
                              <input type="date" placeholder="Issued"
                                     [value]="docMeta(it.doc_type_id).issued_at"
                                     (input)="setDocMeta(it.doc_type_id, 'issued_at', $any($event.target).value)" />
                            }
                            @if (it.needs_expiry_date) {
                              <input type="date" placeholder="Expires"
                                     [value]="docMeta(it.doc_type_id).expires_at"
                                     (input)="setDocMeta(it.doc_type_id, 'expires_at', $any($event.target).value)" />
                            }
                            <button class="primary"
                                    (click)="uploadDoc(it)"
                                    [disabled]="saving() || !canUploadDoc(it)">
                              {{ it.submitted ? 'Replace' : 'Upload' }}
                            </button>
                          </div>
                          @if (docError(it.doc_type_id); as e) { <p class="err small">{{ e }}</p> }
                        </li>
                      }
                    </ul>
                  </section>
                }
              }
            }

            <div class="nav-row">
              <button class="ghost" (click)="goPrev()" [disabled]="!hasPrev()">← Previous</button>
              <span class="spacer"></span>
              <button class="ghost" (click)="goNext()" [disabled]="!hasNext()">Next →</button>
            </div>
          </section>
        </div>
      } @else {
        <div class="card"><p class="muted">Loading…</p></div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; min-height: 100vh; background: var(--bg); color: var(--fg); }
    .portal { max-width: 1100px; margin: 0 auto; padding: 24px 28px; }
    .hd { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--line); }
    .hd .brand { font-weight: 700; letter-spacing: 0.4px; color: var(--primary); font-size: 14px; }

    .layout { display: grid; grid-template-columns: 240px 1fr; gap: 24px; align-items: start; }
    @media (max-width: 800px) { .layout { grid-template-columns: 1fr; } }

    .steps { display: flex; flex-direction: column; gap: 4px; }
    .step {
      display: flex; align-items: center; gap: 10px;
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
      padding: 10px 12px; text-align: left; color: var(--fg); font-size: 14px; cursor: pointer;
      transition: border-color 0.15s, background 0.15s;
    }
    .step:hover { border-color: var(--primary); }
    .step.active { background: var(--bg-3); border-color: var(--primary); color: var(--primary); }
    .step-mark { font-weight: 700; width: 16px; text-align: center; color: var(--muted); }
    .step.done .step-mark { color: #10b981; }
    .progress-summary { padding: 8px 4px; }

    .content {
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius);
      padding: 24px;
    }
    .content h2 { margin: 0 0 6px; font-size: 22px; }
    .content > p.muted { margin-top: 0; }

    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 16px; }
    .grid-2 .full { grid-column: 1 / -1; }
    .grid-2 label { margin-bottom: 4px; display: block; }
    .grid-2 label.check { display: flex; align-items: center; gap: 8px; text-transform: none; letter-spacing: 0; font-size: 13px; color: var(--fg); }
    .grid-2 label.check input[type="checkbox"] { width: auto; }
    h3.lh { font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; margin: 16px 0 4px; }

    .actions { display: flex; gap: 8px; margin-top: 20px; }
    .nav-row { display: flex; align-items: center; gap: 8px; margin-top: 28px; padding-top: 16px; border-top: 1px solid var(--line); }
    .spacer { flex: 1; }

    .card { padding: 24px; background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius); text-align: center; }
    .card.error { border-color: var(--danger); }
    .card.error h2 { color: var(--danger); margin: 0 0 8px; }

    .info-banner {
      padding: 10px 12px; margin: 12px 0;
      background: var(--bg-3); border: 1px solid var(--line); border-radius: var(--radius-sm);
      font-size: 13px;
    }
    .info-banner a { margin-left: 6px; }
    .err  { color: #ef4444; }
    .ok   { color: #10b981; }

    .upload-row { display: flex; gap: 8px; align-items: center; margin: 14px 0; }

    .group-card { margin-top: 18px; }
    .group-title { font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); margin: 0 0 8px; }
    .doc-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
    .doc-item {
      background: var(--bg-3); border: 1px solid var(--line); border-radius: var(--radius-sm);
      padding: 12px 14px; display: flex; flex-direction: column; gap: 6px;
    }
    .doc-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .doc-form { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 4px; }
    .doc-form input { min-width: 140px; }
    .pill {
      padding: 1px 6px; border-radius: 4px; font-size: 10px;
      text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      background: var(--bg-2); color: var(--muted);
    }
    .pill.required { background: rgba(212, 169, 58, 0.18); color: var(--primary); }
    .pill[data-status="valid"]    { background: rgba(16,185,129,0.18); color: #10b981; }
    .pill[data-status="pending"]  { background: rgba(212,169,58,0.18); color: var(--primary); }
    .pill[data-status="rejected"] { background: rgba(239,68,68,0.18);  color: #ef4444; }
  `],
})
export class RecruitmentOnboardingPortal {
  private api   = inject(Api);
  private route = inject(ActivatedRoute);

  readonly STAGES: Array<{ key: Stage; label: string }> = [
    { key: 'sign',      label: '1. Sign contract' },
    { key: 'general',   label: '2. General info' },
    { key: 'cv',        label: '3. CV' },
    { key: 'documents', label: '4. Documents' },
  ];
  readonly countries = COUNTRIES;

  token   = signal<string>('');
  stage   = signal<Stage>('sign');
  snap    = signal<RecruitmentOnboardingPortalSnapshot | null>(null);
  errored = signal(false);
  saving  = signal(false);

  // Sign-contract form
  signedName   = '';
  signConfirmed = false;
  signError    = signal<string | null>(null);

  // General-info form (mirrors editable subset on the API)
  general: any = {
    first_name: '', last_name: '', email: '', phone: '', dob: '', gender: '',
    nationality: '', country: '', address_line1: '', address_line2: '',
    city: '', region: '', postcode: '',
    has_driving_license: false, willing_to_drive: false,
    role: '', discipline: '', experience_level: '', experience_years: null,
    availability: '', skills: '',
  };
  generalSaved = signal(false);

  // CV upload
  cvFile  = signal<File | null>(null);
  cvError = signal<string | null>(null);
  cvSaved = signal(false);

  // Per-doc-type local state. Keyed by doc_type_id so a candidate can prep
  // multiple rows before uploading any one of them.
  docFiles  = new Map<number, File>();
  docMetaMap = new Map<number, { reference_number: string; issuing_body: string; issued_at: string; expires_at: string }>();
  docErrors = signal<Record<number, string | null>>({});

  completedCount = computed(() => {
    const s = this.snap(); if (!s) return 0;
    let n = 0;
    if (s.candidate.contract_signed_at) n++;
    if (s.candidate.email && s.candidate.phone) n++;
    if (s.candidate.cv_file_path) n++;
    const docsAllSubmitted = s.doc_groups.every(g => g.items.every(it => !it.is_required || !!it.submitted));
    if (docsAllSubmitted) n++;
    return n;
  });

  ngOnInit() {
    const token = this.route.snapshot.paramMap.get('token') || '';
    if (!token) { this.errored.set(true); return; }
    this.token.set(token);
    this.refresh();
  }

  private refresh(): void {
    const t = this.token();
    this.api.getRecruitmentOnboardingPortal(t).subscribe({
      next: r => {
        this.snap.set(r);
        const c = r.candidate;
        this.general = {
          first_name: c.first_name || '', last_name: c.last_name || '',
          email: c.email || '', phone: c.phone || '', dob: c.dob || '',
          gender: c.gender || '', nationality: c.nationality || '',
          country: c.country || '',
          address_line1: c.address_line1 || '', address_line2: c.address_line2 || '',
          city: c.city || '', region: c.region || '', postcode: c.postcode || '',
          has_driving_license: !!c.has_driving_license,
          willing_to_drive:    !!c.willing_to_drive,
          role: c.role || '', discipline: c.discipline || '',
          experience_level: c.experience_level || '',
          experience_years: c.experience_years ?? null,
          availability: c.availability || '',
          skills: c.skills || '',
        };
      },
      error: () => this.errored.set(true),
    });
  }

  // ─── Stage helpers ────────────────────────────────────────────────
  isStageDone(s: Stage): boolean {
    const snap = this.snap(); if (!snap) return false;
    switch (s) {
      case 'sign':      return !!snap.candidate.contract_signed_at;
      case 'general':   return !!(snap.candidate.email && snap.candidate.phone);
      case 'cv':        return !!snap.candidate.cv_file_path;
      case 'documents': return snap.doc_groups.every(g => g.items.every(it => !it.is_required || !!it.submitted));
    }
  }

  hasPrev(): boolean { return this.STAGES.findIndex(s => s.key === this.stage()) > 0; }
  hasNext(): boolean { return this.STAGES.findIndex(s => s.key === this.stage()) < this.STAGES.length - 1; }
  goPrev(): void {
    const i = this.STAGES.findIndex(s => s.key === this.stage());
    if (i > 0) this.stage.set(this.STAGES[i - 1].key);
  }
  goNext(): void {
    const i = this.STAGES.findIndex(s => s.key === this.stage());
    if (i < this.STAGES.length - 1) this.stage.set(this.STAGES[i + 1].key);
  }

  // ─── Stage 1 · Sign contract ──────────────────────────────────────
  submitContract(): void {
    this.signError.set(null);
    const name = (this.signedName || '').trim();
    if (!name) { this.signError.set('Please type your full name to sign.'); return; }
    if (!this.signConfirmed) { this.signError.set('Please tick the confirmation box.'); return; }
    this.saving.set(true);
    this.api.signRecruitmentOnboardingContract(this.token(), name).subscribe({
      next: () => { this.saving.set(false); this.refresh(); },
      error: err => { this.saving.set(false); this.signError.set(err?.error?.error || 'Could not sign — please try again.'); },
    });
  }

  // ─── Stage 2 · General info ───────────────────────────────────────
  saveGeneral(): void {
    this.saving.set(true);
    this.generalSaved.set(false);
    const payload: any = { ...this.general };
    // Convert booleans + empty strings into shapes the backend expects.
    payload.has_driving_license = payload.has_driving_license ? 1 : 0;
    payload.willing_to_drive    = payload.willing_to_drive    ? 1 : 0;
    if (payload.experience_years === '' || payload.experience_years === null) {
      delete payload.experience_years;
    } else {
      payload.experience_years = +payload.experience_years;
    }
    this.api.saveRecruitmentOnboardingGeneral(this.token(), payload).subscribe({
      next: () => {
        this.saving.set(false);
        this.generalSaved.set(true);
        setTimeout(() => this.generalSaved.set(false), 2000);
        this.refresh();
      },
      error: () => { this.saving.set(false); },
    });
  }

  // ─── Stage 3 · CV ─────────────────────────────────────────────────
  onCvSelected(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    this.cvFile.set(input.files && input.files[0] ? input.files[0] : null);
    this.cvError.set(null);
    this.cvSaved.set(false);
  }
  uploadCv(): void {
    const f = this.cvFile(); if (!f) return;
    this.saving.set(true);
    this.api.uploadRecruitmentOnboardingCv(this.token(), f).subscribe({
      next: () => {
        this.saving.set(false);
        this.cvFile.set(null);
        this.cvSaved.set(true);
        setTimeout(() => this.cvSaved.set(false), 2500);
        this.refresh();
      },
      error: err => { this.saving.set(false); this.cvError.set(err?.error?.error || 'Upload failed — please try again.'); },
    });
  }

  // ─── Stage 4 · Documents ──────────────────────────────────────────
  docMeta(typeId: number) {
    if (!this.docMetaMap.has(typeId)) {
      this.docMetaMap.set(typeId, { reference_number: '', issuing_body: '', issued_at: '', expires_at: '' });
    }
    return this.docMetaMap.get(typeId)!;
  }
  setDocMeta(typeId: number, k: 'reference_number' | 'issuing_body' | 'issued_at' | 'expires_at', v: string): void {
    this.docMeta(typeId)[k] = v;
  }
  onDocFileSelected(typeId: number, ev: Event): void {
    const input = ev.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      this.docFiles.set(typeId, input.files[0]);
    } else {
      this.docFiles.delete(typeId);
    }
    this.docErrors.update(m => ({ ...m, [typeId]: null }));
  }
  canUploadDoc(it: { doc_type_id: number; submission_type: 'file' | 'info_only' }): boolean {
    if (it.submission_type === 'info_only') return true;
    return this.docFiles.has(it.doc_type_id);
  }
  docError(typeId: number): string | null {
    return this.docErrors()[typeId] ?? null;
  }
  uploadDoc(it: { doc_type_id: number; name: string; submission_type: 'file' | 'info_only' }): void {
    const f = this.docFiles.get(it.doc_type_id) ?? null;
    if (it.submission_type === 'file' && !f) {
      this.docErrors.update(m => ({ ...m, [it.doc_type_id]: 'Please choose a file first.' }));
      return;
    }
    this.saving.set(true);
    const meta = this.docMeta(it.doc_type_id);
    this.api.uploadRecruitmentOnboardingDoc(this.token(), f, {
      title: it.name,
      doc_type_id: it.doc_type_id,
      reference_number: meta.reference_number || undefined,
      issuing_body:     meta.issuing_body     || undefined,
      issued_at:        meta.issued_at        || undefined,
      expires_at:       meta.expires_at       || undefined,
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.docFiles.delete(it.doc_type_id);
        this.docErrors.update(m => ({ ...m, [it.doc_type_id]: null }));
        this.refresh();
      },
      error: err => {
        this.saving.set(false);
        this.docErrors.update(m => ({ ...m, [it.doc_type_id]: err?.error?.error || 'Upload failed — please try again.' }));
      },
    });
  }

  // ─── Misc helpers ─────────────────────────────────────────────────
  fileUrl(p: string): string { return `${environment.basePath}/${(p ?? '').replace(/^\//, '')}`; }
  formatDate(s: string | null | undefined): string {
    if (!s) return '—';
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return d.toLocaleDateString();
  }
  formatDateTime(s: string | null | undefined): string {
    if (!s) return '—';
    const d = new Date((s as string).replace(' ', 'T'));
    if (isNaN(d.getTime())) return s as string;
    return d.toLocaleString();
  }
}
