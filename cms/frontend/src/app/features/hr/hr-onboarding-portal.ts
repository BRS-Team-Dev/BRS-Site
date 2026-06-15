import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { environment } from '@env/environment';
import { Api } from '../../core/api';
import { HrCourseAssignment, HrDocument, HrDocumentType, HrOnboardingPortalSnapshot, HrOnboardingProgress, HrOnboardingSection, HrOnboardingTask, HrReference } from '../../core/models';
import { COUNTRIES } from './countries';
import { HrCoursePlayer } from './hr-course-player';
import { SignaturePad } from './signature-pad';
import { DocumentViewer, ViewableDoc } from '../../shared/document-viewer';

type Step = HrOnboardingSection;

const STEPS: Array<{ key: Step; label: string; optional?: boolean }> = [
  { key: 'profile',    label: 'About you' },
  { key: 'contact',    label: 'Contact & address' },
  { key: 'emergency',  label: 'Emergency contact' },
  { key: 'payroll',    label: 'Payroll & banking' },
  { key: 'background', label: 'Background check' },
  { key: 'references', label: 'References' },
  { key: 'documents',  label: 'Documents' },
  { key: 'tasks',      label: 'Checklist' },
  { key: 'learning',   label: 'Learning' },
  { key: 'diversity',  label: 'Equality (optional)', optional: true },
];

/**
 * /hr-onboarding/:token — public portal for a new hire. No auth, no shell.
 */
@Component({
  selector: 'app-hr-onboarding-portal',
  imports: [FormsModule, HrCoursePlayer, SignaturePad, DocumentViewer],
  template: `
    <div class="portal">
      <header class="hd">
        <div class="brand">BuiltRightStudio · HR onboarding</div>
        @if (snap(); as s) {
          <div class="muted small">Welcome, {{ s.employee.first_name }}</div>
        }
      </header>

      @if (errored()) {
        <div class="card error">
          <h2>Link not valid</h2>
          <p>This onboarding link is invalid or has expired. Please contact HR for a fresh link.</p>
        </div>
      } @else if (snap(); as s) {
        <div class="layout">
          <aside class="steps">
            @for (st of steps; track st.key) {
              @let info = sectionInfo(st.key);
              <button class="step"
                      [class.active]="step() === st.key"
                      [class.submitted]="info.submitted"
                      [class.verified]="info.verified"
                      [class.rejected]="info.rejected_at"
                      (click)="step.set(st.key)">
                <span class="step-mark">
                  @if (info.verified) { ✓ }
                  @else if (info.rejected_at) { ! }
                  @else if (info.submitted) { ● }
                  @else { ○ }
                </span>
                {{ st.label }}
                @if (info.rejected_at) { <span class="step-rej">needs changes</span> }
              </button>
            }
            <div class="progress-summary muted small">
              {{ submittedCount() }} / {{ steps.length }} sections submitted
              @if (s.employee.onboarding_completed_at) { · all done ✓ }
            </div>
          </aside>

          <section class="content">
            @let curInfo = sectionInfo(step());
            @if (curInfo.rejected_at) {
              <div class="reject-banner">
                <strong>HR sent this section back for changes.</strong>
                @if (curInfo.rejected_reason) { <p>"{{ curInfo.rejected_reason }}"</p> }
                <p class="muted small">Update the fields below and re-submit.</p>
              </div>
            }
            @if (step() === 'profile') {
              <h2>About you</h2>
              <p class="muted">Personal details we keep on file. Required for employment records and tax.</p>
              <div class="grid-2">
                <div><label>Legal first name</label><input disabled [value]="s.employee.first_name" /></div>
                <div><label>Legal last name</label><input disabled [value]="s.employee.last_name" /></div>
                <div><label>Preferred name (optional)</label><input [(ngModel)]="profileForm.preferred_name" name="pn" /></div>
                <div><label>Pronouns (optional)</label><input [(ngModel)]="profileForm.pronouns" name="pr" placeholder="e.g. she/her, they/them" /></div>
                <div><label>Date of birth *</label><input type="date" [(ngModel)]="profileForm.dob" name="dob" /></div>
                <div><label>Gender (optional)</label><input [(ngModel)]="profileForm.gender" name="gn" placeholder="self-describe" /></div>
                <div>
                  <label>Nationality *</label>
                  <select [(ngModel)]="profileForm.nationality" name="nt">
                    <option value="">— select —</option>
                    @for (c of countries; track c) { <option [value]="c">{{ c }}</option> }
                  </select>
                </div>
                <div>
                  <label>National Insurance number *</label>
                  <input [(ngModel)]="profileForm.national_insurance_number" name="ni" placeholder="QQ 12 34 56 C" />
                </div>
                <div class="full"><label>LinkedIn URL (optional)</label><input [(ngModel)]="profileForm.linkedin_url" name="li" placeholder="https://linkedin.com/in/…" /></div>
              </div>
              <p class="muted small">Need to change your legal name? Email HR.</p>
              <div class="actions">
                <button class="primary" (click)="saveAndSubmit('profile')" [disabled]="saving()">
                  {{ saving() ? 'Saving…' : (sectionInfo('profile').submitted ? 'Update & resubmit' : 'Save & submit') }}
                </button>
              </div>
            }

            @if (step() === 'payroll') {
              <h2>Payroll &amp; banking</h2>
              <p class="muted">Where should we send your salary, and what tax code applies? Leave tax code blank if unsure — HR will set the default.</p>
              <div class="grid-2">
                <div>
                  <label>Tax code</label>
                  <input [(ngModel)]="payrollForm.tax_code" name="tc" placeholder="e.g. 1257L" />
                </div>
                <div>
                  <label>Student loan plan</label>
                  <select [(ngModel)]="payrollForm.student_loan_plan" name="sl">
                    <option value="none">None</option>
                    <option value="plan_1">Plan 1</option>
                    <option value="plan_2">Plan 2</option>
                    <option value="plan_4">Plan 4 (Scotland)</option>
                    <option value="postgrad">Postgrad</option>
                  </select>
                </div>
                <div class="full">
                  <label class="check">
                    <input type="checkbox" [(ngModel)]="payrollForm.pension_opt_in" name="po" />
                    Opt in to the workplace pension scheme (default — you can opt out via HR later)
                  </label>
                </div>
                @if (payrollForm.pension_opt_in) {
                  <div class="full">
                    <label>Your contribution % <span class="muted small">(employer matches)</span></label>
                    <input type="number" min="0" max="14" step="0.5"
                           [(ngModel)]="payrollForm.pension_employee_pct" name="ppe"
                           placeholder="0–14 (default 5)" />
                  </div>
                }
                <div class="full"><label>Bank name</label><input [(ngModel)]="payrollForm.bank_name" name="bn" /></div>
                <div class="full"><label>Account holder name</label><input [(ngModel)]="payrollForm.bank_account_name" name="ban" placeholder="As shown on your bank statement" /></div>
                <div><label>Sort code</label><input [(ngModel)]="payrollForm.sort_code" name="sc" placeholder="00-00-00" /></div>
                <div><label>Account number</label><input [(ngModel)]="payrollForm.account_number" name="an" placeholder="8 digits" /></div>
              </div>
              <p class="muted small">All banking details are visible only to HR + payroll admins.</p>
              <div class="actions">
                <button class="primary" (click)="saveAndSubmit('payroll')" [disabled]="saving()">
                  {{ saving() ? 'Saving…' : (sectionInfo('payroll').submitted ? 'Update & resubmit' : 'Save & submit') }}
                </button>
              </div>
            }

            @if (step() === 'diversity') {
              <h2>Equality &amp; inclusion (optional)</h2>
              <p class="muted">All fields are optional. We use this to make sure our workplace works for everyone — never for hiring or pay decisions. You can leave anything blank.</p>
              <div class="grid-2">
                <div><label>Ethnicity</label><input [(ngModel)]="diversityForm.ethnicity" name="et" placeholder="self-describe" /></div>
                <div><label>Disability status</label><input [(ngModel)]="diversityForm.disability_status" name="ds" placeholder="e.g. none, registered disabled" /></div>
                <div class="full"><label>Reasonable adjustments needed</label><textarea rows="2" [(ngModel)]="diversityForm.accommodations_needed" name="an2"></textarea></div>
                <div class="full"><label>Dietary requirements (for team events)</label><textarea rows="2" [(ngModel)]="diversityForm.dietary_requirements" name="dr"></textarea></div>
                <div>
                  <label>T-shirt size (for team swag)</label>
                  <select [(ngModel)]="diversityForm.tshirt_size" name="ts">
                    <option value="">— prefer not to say —</option>
                    <option value="XS">XS</option>
                    <option value="S">S</option>
                    <option value="M">M</option>
                    <option value="L">L</option>
                    <option value="XL">XL</option>
                    <option value="XXL">XXL</option>
                  </select>
                </div>
              </div>
              <div class="actions">
                <button class="primary" (click)="saveAndSubmit('diversity')" [disabled]="saving()">
                  {{ saving() ? 'Saving…' : (sectionInfo('diversity').submitted ? 'Update & resubmit' : 'Save & submit') }}
                </button>
              </div>
            }

            @if (step() === 'contact') {
              <h2>Contact &amp; address</h2>
              <p class="muted">Where can we reach you, and where do you live?</p>
              <div class="grid-2">
                <div><label>Phone *</label><input [(ngModel)]="contactForm.phone" name="ph" /></div>
                <div>
                  <label>Country of residence *</label>
                  <select [(ngModel)]="contactForm.country" name="co">
                    <option value="">— select —</option>
                    @for (c of countries; track c) { <option [value]="c">{{ c }}</option> }
                  </select>
                </div>
                <div class="full"><label>Permanent address — line 1 *</label><input [(ngModel)]="contactForm.address_line1" name="a1" /></div>
                <div class="full"><label>Permanent address — line 2</label><input [(ngModel)]="contactForm.address_line2" name="a2" /></div>
                <div><label>City *</label><input [(ngModel)]="contactForm.city" name="ci" /></div>
                <div><label>Region / county</label><input [(ngModel)]="contactForm.region" name="rg" /></div>
                <div><label>Postcode *</label><input [(ngModel)]="contactForm.postcode" name="pc" /></div>
                <div><label>Current location (if different)</label><input [(ngModel)]="contactForm.current_location" name="cl" placeholder="e.g. London, UK or Lagos, Nigeria" /></div>
              </div>
              <p class="muted small">Use <em>Current location</em> if you're temporarily based somewhere other than your permanent address (e.g. travelling, relocating).</p>
              <div class="actions">
                <button class="primary" (click)="saveAndSubmit('contact')" [disabled]="saving()">
                  {{ saving() ? 'Saving…' : (sectionInfo('contact').submitted ? 'Update & resubmit' : 'Save & submit') }}
                </button>
              </div>
            }

            @if (step() === 'emergency') {
              <h2>Emergency contact</h2>
              <p class="muted">Who should we reach in case of an emergency?</p>
              <div class="grid-2">
                <div><label>Name</label><input [(ngModel)]="emergencyForm.emergency_name" name="en" /></div>
                <div><label>Relationship</label><input [(ngModel)]="emergencyForm.emergency_rel" name="er" placeholder="e.g. partner, parent" /></div>
                <div><label>Phone</label><input [(ngModel)]="emergencyForm.emergency_phone" name="ep" /></div>
              </div>
              <div class="actions">
                <button class="primary" (click)="saveAndSubmit('emergency')" [disabled]="saving()">
                  {{ saving() ? 'Saving…' : (sectionInfo('emergency').submitted ? 'Update & resubmit' : 'Save & submit') }}
                </button>
              </div>
            }

            @if (step() === 'documents') {
              <h2>Documents</h2>
              <p class="muted">Here are the documents HR is expecting. Click a slot to upload — fill in any reference numbers or dates we ask for.</p>

              <div class="doc-slots">
                @for (dt of uploadTypes(s); track dt.id) {
                  @let upload = docFor(dt.id!);
                  <div class="slot" [class.filled]="!!upload" [class.required]="!!dt.is_required">
                    <div class="slot-head">
                      <strong>{{ dt.name }}</strong>
                      @if (dt.is_required) { <span class="req-pill">required</span> }
                      @if (upload) { <span class="ok-pill">✓ uploaded</span> }
                    </div>
                    @if (dt.description) { <p class="muted small">{{ dt.description }}</p> }

                    @if (upload) {
                      <div class="slot-meta muted small">
                        <a [href]="docUrl(upload)" target="_blank" rel="noopener">{{ upload.title }}</a>
                        @if (upload.reference_number) { · ref {{ upload.reference_number }} }
                        @if (upload.issued_at)       { · issued {{ upload.issued_at }} }
                        @if (upload.expires_at)      { · expires {{ upload.expires_at }} }
                      </div>
                      <div class="row" style="gap: 6px; margin-top: 6px;">
                        <button class="ghost" (click)="openSlot(dt)">Replace</button>
                        <button class="ghost danger" (click)="deleteDoc(upload)">Remove</button>
                      </div>
                    } @else {
                      <button class="primary" (click)="openSlot(dt)">+ Upload</button>
                    }
                  </div>
                }

                <!-- Free-form extras anyone can add -->
                <div class="slot extras">
                  <div class="slot-head"><strong>Other / extra documents</strong></div>
                  <p class="muted small">Anything else you'd like HR to have on file.</p>
                  <button class="ghost" (click)="openExtras()">+ Add extra</button>
                  @if (extraUploads(s).length > 0) {
                    <ul class="extras-list">
                      @for (d of extraUploads(s); track d.id) {
                        <li>
                          <a [href]="docUrl(d)" target="_blank" rel="noopener">{{ d.title }}</a>
                          <span class="spacer"></span>
                          <button class="ghost icon-btn danger" (click)="deleteDoc(d)">✕</button>
                        </li>
                      }
                    </ul>
                  }
                </div>
              </div>

              @if (signedTypes(s).length > 0) {
                <h3 style="margin-top: 24px;">Documents to sign</h3>
                <p class="muted">Read each document and sign at the bottom. You can re-sign by clearing the pad.</p>
                <div class="doc-slots">
                  @for (dt of signedTypes(s); track dt.id) {
                    @let row = docFor(dt.id!);
                    <div class="slot" [class.filled]="!!row?.signed_at" [class.required]="true">
                      <div class="slot-head">
                        <strong>{{ dt.name }}</strong>
                        <span class="req-pill">to sign</span>
                        @if (row?.signed_at) { <span class="ok-pill">✓ signed {{ row?.signed_at }}</span> }
                      </div>
                      @if (dt.description) { <p class="muted small">{{ dt.description }}</p> }
                      @if (row) {
                        <div class="slot-meta">
                          <button class="ghost" type="button" (click)="viewing.set(row!)">View {{ dt.name }}</button>
                        </div>
                      } @else if (dt.template_path) {
                        <div class="slot-meta">
                          <button class="ghost" type="button" (click)="viewTemplate(dt)">View {{ dt.name }}</button>
                        </div>
                      }
                      @if (row && !row.signed_at) {
                        @if (signingId() === row.id) {
                          <app-signature-pad (signed)="completeSign(row, $event)" />
                          <button class="ghost" style="margin-top: 6px;" (click)="signingId.set(null)">Cancel</button>
                        } @else {
                          <button class="primary" style="margin-top: 6px;" (click)="startSign(row)">Sign now</button>
                        }
                      }
                    </div>
                  }
                </div>
              }

              <div class="actions">
                <button class="primary" (click)="submit('documents')" [disabled]="saving()">
                  {{ sectionInfo('documents').submitted ? 'Update & resubmit' : 'Mark documents complete' }}
                </button>
              </div>
            }

            <!-- Upload modal — shown when a slot or "extra" is opened -->
            @if (uploadingType() || uploadingExtra()) {
              <div class="modal-backdrop" (click)="cancelUpload()"></div>
              <div class="modal-card">
                <h3>
                  @if (uploadingType(); as dt) { Upload {{ dt.name }} }
                  @else { Add an extra document }
                </h3>
                @if (uploadingType(); as dt) {
                  @if (dt.description) { <p class="muted small">{{ dt.description }}</p> }
                }
                <div class="upload-form">
                  <label>File</label>
                  <input type="file" (change)="setUploadFile($any($event.target).files)" />
                  @if (uploadFile(); as f) { <div class="muted small">{{ f.name }}</div> }

                  @if (uploadingExtra()) {
                    <label>Title</label>
                    <input [(ngModel)]="uploadMeta.title" name="ut" placeholder="A short label, e.g. 'Visa support letter'" />
                    <label>Category</label>
                    <select [(ngModel)]="uploadMeta.category" name="uc">
                      <option value="general">General</option>
                      <option value="payroll">Payroll</option>
                      <option value="performance">Performance</option>
                      <option value="other">Other</option>
                    </select>
                  }

                  @if (uploadingType()?.needs_reference) {
                    <label>Reference / document number</label>
                    <input [(ngModel)]="uploadMeta.reference_number" name="urn" placeholder="e.g. passport number, share code" />
                  }
                  @if (uploadingType()?.needs_issue_date) {
                    <label>Issue date</label>
                    <input type="date" [(ngModel)]="uploadMeta.issued_at" name="uid" />
                  }
                  @if (uploadingType()?.needs_expiry_date) {
                    <label>Expiry date</label>
                    <input type="date" [(ngModel)]="uploadMeta.expires_at" name="ued" />
                  }

                  @if (uploadError()) { <div class="error-msg">{{ uploadError() }}</div> }
                  <div class="row" style="gap: 8px; margin-top: 12px;">
                    <button class="primary" (click)="confirmUpload()" [disabled]="!uploadFile() || saving()">
                      {{ saving() ? 'Uploading…' : 'Upload' }}
                    </button>
                    <button class="ghost" (click)="cancelUpload()">Cancel</button>
                  </div>
                </div>
              </div>
            }

            @if (step() === 'background') {
              <h2>Background check</h2>
              <p class="muted">Required by HR for employment compliance. Your honest answer here doesn't automatically disqualify you — HR will follow up if needed.</p>
              <div class="grid-2">
                <div class="full">
                  <label>Have you been convicted of a criminal offence (excluding spent convictions under the Rehabilitation of Offenders Act 1974)?</label>
                  <div class="row" style="gap: 16px; margin-top: 6px;">
                    <label class="check"><input type="radio" name="cr" [value]="false" [(ngModel)]="backgroundForm.criminal_record_declared" /> No</label>
                    <label class="check"><input type="radio" name="cr" [value]="true"  [(ngModel)]="backgroundForm.criminal_record_declared" /> Yes</label>
                  </div>
                </div>
                @if (backgroundForm.criminal_record_declared === true) {
                  <div class="full">
                    <label>Please provide brief details (HR will discuss confidentially)</label>
                    <textarea rows="3" [(ngModel)]="backgroundForm.criminal_record_details" name="crd"></textarea>
                  </div>
                }
                <div><label>DBS / background check reference (if you have one)</label><input [(ngModel)]="backgroundForm.dbs_check_ref" name="dbsr" /></div>
                <div><label>DBS check date</label><input type="date" [(ngModel)]="backgroundForm.dbs_check_date" name="dbsd" /></div>
              </div>
              <div class="actions">
                <button class="primary" (click)="saveAndSubmit('background')" [disabled]="saving() || backgroundForm.criminal_record_declared === null">
                  {{ saving() ? 'Saving…' : (sectionInfo('background').submitted ? 'Update & resubmit' : 'Save & submit') }}
                </button>
              </div>
            }

            @if (step() === 'references') {
              <h2>References</h2>
              <p class="muted">Add at least two professional references. We'll only contact them after you've had a chance to give them a heads-up.</p>

              @if (s.references.length === 0) {
                <p class="muted small">No references added yet.</p>
              } @else {
                <ul class="ref-list">
                  @for (r of s.references; track r.id) {
                    <li>
                      <div class="ref-head">
                        <strong>{{ r.name }}</strong>
                        @if (r.relationship) { <span class="muted small">· {{ r.relationship }}</span> }
                      </div>
                      <div class="muted small">
                        @if (r.position || r.company) { {{ r.position || '' }}{{ r.position && r.company ? ' at ' : '' }}{{ r.company || '' }} · }
                        @if (r.email) { {{ r.email }} }
                        @if (r.email && r.phone) { · }
                        @if (r.phone) { {{ r.phone }} }
                      </div>
                      <div class="ref-actions">
                        <button class="ghost icon-btn danger" (click)="deleteReference(r)" title="Remove">✕</button>
                      </div>
                    </li>
                  }
                </ul>
              }

              <h3 class="lh">Add a reference</h3>
              <div class="grid-2">
                <div><label>Full name *</label><input [(ngModel)]="newReference.name" name="rn" /></div>
                <div><label>Relationship</label><input [(ngModel)]="newReference.relationship" name="rr" placeholder="e.g. former manager, colleague" /></div>
                <div><label>Email</label><input type="email" [(ngModel)]="newReference.email" name="re" /></div>
                <div><label>Phone</label><input [(ngModel)]="newReference.phone" name="rp" /></div>
                <div><label>Company</label><input [(ngModel)]="newReference.company" name="rc" /></div>
                <div><label>Their position</label><input [(ngModel)]="newReference.position" name="rps" /></div>
              </div>
              @if (refError()) { <div class="error-msg">{{ refError() }}</div> }
              <div class="actions">
                <button class="ghost" (click)="addReference()" [disabled]="!newReference.name">+ Add reference</button>
                <span class="spacer"></span>
                <button class="primary" (click)="submit('references')" [disabled]="saving() || s.references.length < 1">
                  {{ saving() ? 'Saving…' : (sectionInfo('references').submitted ? 'Update & resubmit' : 'Submit references') }}
                </button>
              </div>
            }

            @if (step() === 'tasks') {
              <h2>Onboarding checklist</h2>
              <p class="muted">Everything HR needs you to wrap up. The first batch tracks the portal sections themselves — they tick automatically as you submit each one. The rest are practical first-week items you can mark off yourself.</p>

              @let done = doneTaskCount(s);
              <div class="checklist-progress">
                <div class="bar"><div class="fill" [style.width.%]="(done / (s.tasks.length || 1)) * 100"></div></div>
                <span class="muted small">{{ done }} / {{ s.tasks.length }} done</span>
              </div>

              @if (s.tasks.length === 0) {
                <p class="muted small">No checklist items yet — HR will add some shortly.</p>
              } @else {
                @for (group of taskGroups(s); track group.label) {
                  <h3 class="task-group-h">{{ group.label }}</h3>
                  <ul class="task-cards">
                    @for (t of group.items; track t.id) {
                      <li class="task-card" [class.done]="t.is_done" [class.linked]="!!t.linked_section">
                        <label class="task-row">
                          <input type="checkbox" [checked]="!!t.is_done" (change)="toggleTask(t, $any($event.target).checked)" />
                          <div class="task-body">
                            <div class="task-title">
                              {{ t.title }}
                              @if (t.linked_section) {
                                <span class="section-badge" [class.section-done]="!!sectionInfo(t.linked_section).submitted">
                                  {{ sectionLabel(t.linked_section) }}
                                  @if (sectionInfo(t.linked_section).submitted) { ✓ }
                                </span>
                              }
                            </div>
                            @if (t.description) { <div class="task-desc">{{ t.description }}</div> }
                            @if (t.due_date) { <div class="task-due">due {{ t.due_date }}</div> }
                          </div>
                          @if (t.is_done) { <span class="done-mark">✓</span> }
                        </label>
                      </li>
                    }
                  </ul>
                }
              }
              <div class="actions">
                <button class="primary" (click)="submit('tasks')" [disabled]="saving()">
                  {{ sectionInfo('tasks').submitted ? 'Update & resubmit' : 'Submit checklist' }}
                </button>
              </div>
            }

            @if (step() === 'learning') {
              @if (playingAssignmentId(); as aid) {
                <app-hr-course-player [assignmentId]="aid" mode="public" [token]="token()" (exit)="closePlayer()" (completed)="onCourseCompleted()"></app-hr-course-player>
              } @else {
                <h2>Required learning</h2>
                @if (s.learning.length === 0) {
                  <p class="muted small">No courses assigned yet.</p>
                } @else {
                  <ul class="course-list">
                    @for (a of s.learning; track a.id) {
                      <li>
                        <strong>{{ a.title }}</strong>
                        @if (a.is_required) { <span class="req-pill">required</span> }
                        <div class="muted small">{{ a.provider || '—' }}{{ a.duration_hours ? ' · ' + a.duration_hours + 'h' : '' }}</div>
                        <div class="row" style="margin-top: 6px; gap: 8px;">
                          <button class="primary" (click)="openCourse(a)">{{ a.status === 'completed' ? 'Review course' : (a.status === 'in_progress' ? 'Continue course' : 'Start course') }}</button>
                          @if (a.link) { <a class="ghost" [href]="a.link" target="_blank" rel="noopener">↗ External link</a> }
                          @if (a.status === 'completed') { <span class="muted small">Completed {{ a.completed_at }}</span> }
                        </div>
                      </li>
                    }
                  </ul>
                }
                <div class="actions">
                  <button class="primary" (click)="submit('learning')" [disabled]="saving()">
                    {{ sectionInfo('learning').submitted ? 'Update & resubmit' : 'Submit learning' }}
                  </button>
                </div>
              }
            }
          </section>
        </div>
      } @else {
        <div class="card"><p class="muted">Loading…</p></div>
      }
    </div>

    <app-document-viewer [doc]="viewing()" (closed)="viewing.set(null)"></app-document-viewer>
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
    .step.submitted .step-mark { color: var(--primary); }
    .step.verified  .step-mark { color: #10b981; }
    .step.rejected  .step-mark { color: #ef4444; }
    .step.rejected  { border-left: 3px solid #ef4444; padding-left: 9px; }
    .step-rej {
      margin-left: auto;
      padding: 1px 6px; border-radius: 4px; font-size: 9px;
      text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      background: rgba(239,68,68,0.15); color: #ef4444; border: 1px solid #ef4444;
    }
    .reject-banner {
      padding: 12px 14px; margin-bottom: 14px;
      border: 1px solid #ef4444; border-radius: var(--radius-sm);
      background: rgba(239,68,68,0.10);
      color: #ef4444;
    }
    .reject-banner p { margin: 4px 0 0; color: var(--fg); }
    .progress-summary { padding: 8px 4px; }

    .content {
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius);
      padding: 24px;
    }
    .content h2 { margin: 0 0 6px; font-size: 22px; }
    .content > p.muted { margin-top: 0; }

    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 16px; }
    .grid-2 .full { grid-column: 1 / -1; }
    .grid-2 label { margin-bottom: 4px; }
    .grid-2 label.check { display: flex; align-items: center; gap: 8px; text-transform: none; letter-spacing: 0; font-size: 13px; color: var(--fg); }
    .grid-2 label.check input[type="checkbox"] { width: auto; }
    .actions { display: flex; gap: 8px; margin-top: 20px; }

    .upload-row { display: flex; gap: 8px; align-items: center; margin: 14px 0; }
    .upload-row select { width: 200px; }
    .doc-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
    .doc-list li { display: flex; align-items: center; gap: 10px; padding: 8px 10px; background: var(--bg-3); border-radius: var(--radius-sm); }
    .cat { padding: 1px 6px; border-radius: 4px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; background: var(--bg-2); color: var(--muted); }
    .spacer { flex: 1; }

    /* Checklist redesign */
    .checklist-progress { display: flex; align-items: center; gap: 12px; margin: 14px 0 18px; }
    .checklist-progress .bar { flex: 1; height: 8px; background: var(--bg-3); border-radius: 999px; overflow: hidden; border: 1px solid var(--line); }
    .checklist-progress .fill { height: 100%; background: var(--primary); transition: width 0.3s ease; }

    .task-group-h { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.6px; margin: 18px 0 8px; font-weight: 700; }
    .task-cards { list-style: none; padding: 0; margin: 0 0 8px; display: flex; flex-direction: column; gap: 6px; }
    .task-card {
      background: var(--bg-3); border: 1px solid var(--line); border-radius: var(--radius-sm);
      transition: border-color 0.15s, opacity 0.15s;
    }
    .task-card.linked { border-left: 3px solid var(--primary); }
    .task-card.done { opacity: 0.7; }
    .task-card.done.linked { border-left-color: #10b981; }
    .task-card:hover { border-color: var(--primary); }
    .task-card.done:hover { border-color: var(--line); }

    .task-row {
      display: flex; align-items: flex-start; gap: 12px;
      padding: 12px 14px;
      cursor: pointer;
      margin: 0;
      text-transform: none; letter-spacing: 0;
    }
    .task-row input[type="checkbox"] { margin-top: 3px; width: 18px; height: 18px; flex-shrink: 0; cursor: pointer; }
    .task-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
    .task-title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 14px; color: var(--fg); font-weight: 500; }
    .task-card.done .task-title { color: var(--muted); text-decoration: line-through; }
    .task-desc { font-size: 13px; color: var(--muted); line-height: 1.45; }
    .task-due { font-size: 12px; color: var(--primary); }

    .section-badge {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 2px 8px; border-radius: 999px;
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; font-weight: 700;
      background: rgba(212, 169, 58, 0.12); color: var(--primary);
      border: 1px solid var(--primary);
    }
    .section-badge.section-done { background: rgba(16, 185, 129, 0.15); color: #10b981; border-color: #10b981; }

    .done-mark { color: #10b981; font-size: 18px; font-weight: 700; flex-shrink: 0; padding-top: 2px; }

    .course-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
    .course-list li { padding: 12px 14px; background: var(--bg-3); border-radius: var(--radius-sm); }
    .req-pill {
      padding: 1px 6px; border-radius: 4px;
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      background: rgba(212, 169, 58, 0.18); color: var(--primary);
      margin-left: 6px;
    }

    .card { padding: 24px; background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius); text-align: center; }
    .card.error { border-color: var(--danger); }
    .card.error h2 { color: var(--danger); margin: 0 0 8px; }

    .doc-slots { display: flex; flex-direction: column; gap: 12px; margin: 14px 0; }
    .slot {
      padding: 14px; background: var(--bg-3); border: 1px solid var(--line); border-radius: var(--radius-sm);
      display: flex; flex-direction: column; gap: 6px;
    }
    .slot.required { border-left: 3px solid var(--primary); }
    .slot.filled { border-left: 3px solid #10b981; }
    .slot.extras { border-style: dashed; }
    .slot-head { display: flex; align-items: center; gap: 8px; }
    .ok-pill { padding: 1px 6px; border-radius: 4px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700; background: rgba(16, 185, 129, 0.18); color: #10b981; }
    .slot-meta { padding: 6px 8px; background: var(--bg-2); border-radius: var(--radius-sm); }
    .extras-list { list-style: none; padding: 0; margin: 8px 0 0 0; display: flex; flex-direction: column; gap: 4px; }
    .extras-list li { display: flex; align-items: center; gap: 8px; padding: 6px 8px; background: var(--bg-2); border-radius: var(--radius-sm); font-size: 13px; }

    .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 200; }
    .modal-card {
      position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
      width: min(520px, 92vw);
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius);
      box-shadow: var(--shadow);
      padding: 24px;
      z-index: 201;
    }
    .modal-card h3 { margin: 0 0 8px 0; font-size: 18px; }
    .upload-form label { margin-top: 12px; display: block; }
    .upload-form input, .upload-form select { width: 100%; }

    .ref-list { list-style: none; padding: 0; margin: 0 0 14px; display: flex; flex-direction: column; gap: 8px; }
    .ref-list li { padding: 10px 12px; background: var(--bg-3); border: 1px solid var(--line); border-radius: var(--radius-sm); position: relative; }
    .ref-head { display: flex; align-items: center; gap: 6px; }
    .ref-actions { position: absolute; right: 10px; top: 10px; }
    h3.lh { font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; margin: 16px 0 10px; }
  `],
})
export class HrOnboardingPortal {
  private api = inject(Api);
  private route = inject(ActivatedRoute);

  readonly steps = STEPS;
  step = signal<Step>('profile');
  snap = signal<HrOnboardingPortalSnapshot | null>(null);
  errored = signal(false);
  saving = signal(false);

  profileForm: any   = {
    preferred_name: '', dob: '',
    pronouns: '', gender: '', nationality: '',
    national_insurance_number: '', linkedin_url: '',
  };
  contactForm: any   = { phone: '', address_line1: '', address_line2: '', city: '', region: '', postcode: '', country: '', current_location: '' };
  emergencyForm: any = { emergency_name: '', emergency_phone: '', emergency_rel: '' };
  payrollForm: any   = {
    tax_code: '', student_loan_plan: 'none',
    pension_opt_in: true, pension_employee_pct: 5, pension_employer_pct: 3,
    bank_name: '', bank_account_name: '', sort_code: '', account_number: '',
  };
  diversityForm: any = {
    ethnicity: '', disability_status: '', accommodations_needed: '',
    dietary_requirements: '', tshirt_size: '',
  };
  backgroundForm: any = {
    criminal_record_declared: null,
    criminal_record_details: '',
    dbs_check_ref: '',
    dbs_check_date: '',
  };
  newReference: HrReference = { name: '', relationship: '', email: '', phone: '', company: '', position: '' };
  refError = signal<string | null>(null);
  countries = COUNTRIES;

  // Document upload modal state
  uploadingType  = signal<HrDocumentType | null>(null);
  uploadingExtra = signal<boolean>(false);
  uploadFile     = signal<File | null>(null);
  uploadError    = signal<string | null>(null);
  uploadMeta: { title: string; category: string; reference_number: string; issued_at: string; expires_at: string } =
    { title: '', category: 'general', reference_number: '', issued_at: '', expires_at: '' };

  submittedCount = computed(() => {
    const s = this.snap(); if (!s) return 0;
    let n = 0;
    for (const k of this.steps) if (s.progress[k.key]?.submitted_at) n++;
    return n;
  });

  ngOnInit() {
    const token = this.route.snapshot.paramMap.get('token') || '';
    if (!token) { this.errored.set(true); return; }
    this.refresh(token);
  }

  refresh(token?: string) {
    const t = token ?? this.route.snapshot.paramMap.get('token') ?? '';
    this.api.getHrOnboardingPortal(t).subscribe({
      next: r => {
        this.snap.set(r);
        const e = r.employee as any;
        this.profileForm   = {
          preferred_name: e.preferred_name || '', dob: e.dob || '',
          pronouns: e.pronouns || '', gender: e.gender || '',
          nationality: e.nationality || '',
          national_insurance_number: e.national_insurance_number || '',
          linkedin_url: e.linkedin_url || '',
        };
        this.contactForm   = {
          phone: e.phone || '', address_line1: e.address_line1 || '', address_line2: e.address_line2 || '',
          city: e.city || '', region: e.region || '', postcode: e.postcode || '', country: e.country || '',
          current_location: e.current_location || '',
        };
        this.emergencyForm = { emergency_name: e.emergency_name || '', emergency_phone: e.emergency_phone || '', emergency_rel: e.emergency_rel || '' };
        this.payrollForm = {
          tax_code: e.tax_code || '',
          student_loan_plan: e.student_loan_plan || 'none',
          pension_opt_in: e.pension_opt_in !== 0,
          pension_employee_pct: e.pension_employee_pct ?? 5,
          pension_employer_pct: e.pension_employer_pct ?? 3,
          bank_name: e.bank_name || '',
          bank_account_name: e.bank_account_name || '',
          sort_code: e.sort_code || '',
          account_number: e.account_number || '',
        };
        this.diversityForm = {
          ethnicity: e.ethnicity || '',
          disability_status: e.disability_status || '',
          accommodations_needed: e.accommodations_needed || '',
          dietary_requirements: e.dietary_requirements || '',
          tshirt_size: e.tshirt_size || '',
        };
        this.backgroundForm = {
          criminal_record_declared: e.criminal_record_declared ?? null,
          criminal_record_details:  e.criminal_record_details  ?? '',
          dbs_check_ref:            e.dbs_check_ref            ?? '',
          dbs_check_date:           e.dbs_check_date           ?? '',
        };
      },
      error: () => this.errored.set(true),
    });
  }

  sectionInfo(s: HrOnboardingSection): {
    submitted: boolean; verified: boolean;
    rejected_at: string | null; rejected_reason: string | null;
  } {
    const p = this.snap()?.progress[s];
    return {
      submitted: !!p?.submitted_at,
      verified: !!p?.verified_at,
      rejected_at: p?.rejected_at ?? null,
      rejected_reason: p?.rejected_reason ?? null,
    };
  }

  saveAndSubmit(section: HrOnboardingSection) {
    const t = this.route.snapshot.paramMap.get('token') || '';
    this.saving.set(true);
    const after = () => this.api.submitHrOnboardingSection(t, section).subscribe(() => {
      this.saving.set(false);
      this.refresh(t);
    });
    if (section === 'profile')         this.api.saveHrOnboardingProfile(t, this.profileForm).subscribe(after);
    else if (section === 'contact')    this.api.saveHrOnboardingContact(t, this.contactForm).subscribe(after);
    else if (section === 'emergency')  this.api.saveHrOnboardingEmergency(t, this.emergencyForm).subscribe(after);
    else if (section === 'payroll')    this.api.saveHrOnboardingPayroll(t, this.payrollForm).subscribe(after);
    else if (section === 'background') this.api.saveHrOnboardingBackground(t, this.backgroundForm).subscribe(after);
    else if (section === 'diversity')  this.api.saveHrOnboardingDiversity(t, this.diversityForm).subscribe(after);
  }

  addReference() {
    this.refError.set(null);
    if (!this.newReference.name?.trim()) { this.refError.set('Reference name is required'); return; }
    const t = this.route.snapshot.paramMap.get('token') || '';
    this.api.addHrOnboardingReference(t, this.newReference).subscribe({
      next: () => {
        this.newReference = { name: '', relationship: '', email: '', phone: '', company: '', position: '' };
        this.refresh(t);
      },
      error: e => this.refError.set(e?.error?.error || 'Failed to add reference'),
    });
  }
  deleteReference(r: HrReference) {
    if (!r.id) return;
    if (!confirm(`Remove reference "${r.name}"?`)) return;
    const t = this.route.snapshot.paramMap.get('token') || '';
    this.api.deleteHrOnboardingReference(t, r.id).subscribe(() => this.refresh(t));
  }

  submit(section: HrOnboardingSection) {
    const t = this.route.snapshot.paramMap.get('token') || '';
    this.saving.set(true);
    this.api.submitHrOnboardingSection(t, section).subscribe(() => {
      this.saving.set(false);
      this.refresh(t);
    });
  }

  // ─── Documents (slot-driven) ───
  docFor(typeId: number): HrDocument | undefined {
    return this.snap()?.documents.find(d => d.doc_type_id === typeId);
  }
  uploadTypes(s: HrOnboardingPortalSnapshot): HrDocumentType[] {
    return s.document_types.filter(t => (t.kind ?? 'upload') === 'upload');
  }
  signedTypes(s: HrOnboardingPortalSnapshot): HrDocumentType[] {
    // 'signed' policies always show; 'contract' kinds only when the HR admin
    // flagged "Add to onboarding" (095) and they target employees.
    return s.document_types.filter(t =>
      t.kind === 'signed' ||
      (t.kind === 'contract' && (t.audience ?? 'employee') === 'employee' && !!t.add_to_onboarding)
    );
  }
  extraUploads(s: HrOnboardingPortalSnapshot): HrDocument[] {
    const typedIds = new Set(s.document_types.map(t => t.id).filter(x => !!x));
    return s.documents.filter(d => !d.doc_type_id || !typedIds.has(d.doc_type_id));
  }
  templateUrl(t: HrDocumentType): string {
    return t.template_path ? `${environment.basePath}/${t.template_path.replace(/^\//, '')}` : '';
  }

  viewing = signal<ViewableDoc | null>(null);
  viewTemplate(t: HrDocumentType) {
    if (!t.template_path) return;
    this.viewing.set({
      title: t.name,
      file_path: t.template_path,
      mime_type: t.template_mime,
      category: 'template',
    });
  }

  signingId = signal<number | null>(null);
  startSign(d: HrDocument) { if (d.id) this.signingId.set(d.id); }
  async completeSign(d: HrDocument, dataUrl: string) {
    if (!d.id) return;
    const t = this.route.snapshot.paramMap.get('token') || '';
    const dt = this.snap()?.document_types.find(x => x.id === d.doc_type_id);
    const blocksJson = dt?.template_blocks_json;
    const signerName = `${this.snap()?.employee.first_name ?? ''} ${this.snap()?.employee.last_name ?? ''}`.trim();

    // If we have the page-builder source, regenerate the PDF with the signature
    // stamped onto each page's sign zone and upload it as the employee's signed copy.
    if (blocksJson) {
      try {
        const pages = JSON.parse(blocksJson);
        if (Array.isArray(pages) && pages.length > 0) {
          const { renderPdfDocBlob } = await import('./pdf-doc-renderer');
          const signedBlob = await renderPdfDocBlob(pages, {
            title: dt?.name || d.title || 'Document',
            signatureDataUrl: dataUrl,
            signerName,
          });
          this.api.signHrOnboardingDocumentWithPdf(t, d.id, dataUrl, signedBlob).subscribe(() => {
            this.signingId.set(null);
            this.refresh(t);
          });
          return;
        }
      } catch (err) {
        console.error('Signed-PDF render failed, falling back to signature-only:', err);
      }
    }

    // Fallback: just store the signature data on the row.
    this.api.signHrOnboardingDocument(t, d.id, dataUrl).subscribe(() => {
      this.signingId.set(null);
      this.refresh(t);
    });
  }
  openSlot(dt: HrDocumentType) {
    this.uploadingType.set(dt);
    this.uploadingExtra.set(false);
    this.uploadFile.set(null);
    this.uploadError.set(null);
    this.uploadMeta = {
      title: dt.name,
      category: 'general',
      reference_number: '',
      issued_at: '',
      expires_at: '',
    };
  }
  openExtras() {
    this.uploadingType.set(null);
    this.uploadingExtra.set(true);
    this.uploadFile.set(null);
    this.uploadError.set(null);
    this.uploadMeta = {
      title: '',
      category: 'general',
      reference_number: '',
      issued_at: '',
      expires_at: '',
    };
  }
  cancelUpload() {
    this.uploadingType.set(null);
    this.uploadingExtra.set(false);
    this.uploadFile.set(null);
    this.uploadError.set(null);
  }
  setUploadFile(files: FileList | null) {
    this.uploadFile.set(files && files.length > 0 ? files[0] : null);
  }
  confirmUpload() {
    const file = this.uploadFile();
    if (!file) return;
    const t = this.route.snapshot.paramMap.get('token') || '';
    const dt = this.uploadingType();
    const isExtra = this.uploadingExtra();
    const title = (this.uploadMeta.title || dt?.name || file.name).trim() || file.name;
    if (isExtra && !title) { this.uploadError.set('Please give the document a title'); return; }

    this.saving.set(true);
    this.api.uploadHrOnboardingDoc(t, file, {
      title,
      category: this.uploadMeta.category,
      doc_type_id: dt?.id ?? null,
      reference_number: this.uploadMeta.reference_number || undefined,
      issued_at:  this.uploadMeta.issued_at  || undefined,
      expires_at: this.uploadMeta.expires_at || undefined,
    }).subscribe({
      next: () => {
        // Replace flow: if there was already an upload for this type, remove the old one.
        if (dt?.id) {
          const existing = this.snap()?.documents.find(d => d.doc_type_id === dt.id && d.id);
          // The new upload is now the latest; the existing-replace cleanup runs only if there were duplicates.
          // For now we leave both rows — HR can clean up if they want.
          void existing;
        }
        this.saving.set(false);
        this.cancelUpload();
        this.refresh(t);
      },
      error: e => {
        this.saving.set(false);
        this.uploadError.set(e?.error?.error || 'Upload failed');
      },
    });
  }

  deleteDoc(d: HrDocument) {
    if (!d.id) return;
    if (!confirm('Remove this file?')) return;
    const t = this.route.snapshot.paramMap.get('token') || '';
    this.api.deleteHrOnboardingDoc(t, d.id).subscribe(() => this.refresh(t));
  }
  docUrl(d: HrDocument): string {
    return d.file_path ? `${environment.basePath}/${d.file_path.replace(/^\//, '')}` : '';
  }

  // ─── Checklist helpers ───
  doneTaskCount(s: HrOnboardingPortalSnapshot): number {
    return s.tasks.filter(t => t.is_done).length;
  }
  sectionLabel(s: HrOnboardingSection): string {
    return STEPS.find(x => x.key === s)?.label ?? s;
  }
  taskGroups(s: HrOnboardingPortalSnapshot): { label: string; items: HrOnboardingTask[] }[] {
    const linked = s.tasks.filter(t => !!t.linked_section);
    const others = s.tasks.filter(t => !t.linked_section);
    const out: { label: string; items: HrOnboardingTask[] }[] = [];
    if (linked.length) out.push({ label: 'Onboarding sections', items: linked });
    if (others.length) out.push({ label: 'First-week tasks',     items: others });
    return out;
  }

  toggleTask(t: HrOnboardingTask, isDone: boolean) {
    if (!t.id) return;
    const tk = this.route.snapshot.paramMap.get('token') || '';
    this.api.toggleHrOnboardingTask(tk, t.id, isDone).subscribe(() => this.refresh(tk));
  }
  setLearning(a: HrCourseAssignment, status: 'in_progress'|'completed') {
    if (!a.id) return;
    const t = this.route.snapshot.paramMap.get('token') || '';
    this.api.setHrOnboardingLearning(t, a.id, status).subscribe(() => this.refresh(t));
  }

  // Course player wiring
  playingAssignmentId = signal<number | null>(null);
  token() { return this.route.snapshot.paramMap.get('token') || ''; }
  openCourse(a: HrCourseAssignment) {
    if (!a.id) return;
    this.playingAssignmentId.set(a.id);
  }
  closePlayer() {
    this.playingAssignmentId.set(null);
    this.refresh();
  }
  onCourseCompleted() { this.refresh(); }
}
