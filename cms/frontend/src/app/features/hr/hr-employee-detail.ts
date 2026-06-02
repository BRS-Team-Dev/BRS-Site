import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { environment } from '@env/environment';
import { Api } from '../../core/api';
import { HrCertification, HrCourseAssignment, HrDocument, HrDocumentType, HrEmployee, HrEmployeeNote, HrPtoSummary, HrTimeOffEntry } from '../../core/models';
import { DocumentViewer, ViewableDoc } from '../../shared/document-viewer';

type Tab = 'profile' | 'documents' | 'time' | 'pto' | 'learning';

@Component({
  selector: 'app-hr-employee-detail',
  imports: [RouterLink, FormsModule, DocumentViewer],
  template: `
    @if (employee(); as e) {
      <div class="toolbar">
        <button class="ghost" routerLink="/hr/employees">← Back</button>
        <h1>{{ e.first_name }} {{ e.last_name }}</h1>
        <span class="muted small status status-{{ e.status }}">{{ e.status }}</span>
        <span class="spacer"></span>
        @if (saving()) { <span class="muted small">Saving…</span> }
      </div>

      <div class="tab-nav">
        @for (t of tabs; track t.key) {
          <button class="tab-btn" [class.active]="tab() === t.key" (click)="tab.set(t.key)">{{ t.label }}</button>
        }
      </div>

      <div class="content">
        @if (tab() === 'profile') {
          <div class="form-sections">
            <div class="section-card">
              <h3 class="card-title">Personal</h3>
              <div class="meta-row">
                <div class="meta-field"><label>Preferred name</label>
                  <input [ngModel]="e.preferred_name" (blur)="patch({ preferred_name: $any($event.target).value })" name="pn" /></div>
                <div class="meta-field"><label>Date of birth</label>
                  <input type="date" [ngModel]="e.dob" (change)="patch({ dob: $any($event.target).value })" name="dob" /></div>
                <div class="meta-field"><label>Phone</label>
                  <input [ngModel]="e.phone" (blur)="patch({ phone: $any($event.target).value })" name="ph" /></div>
              </div>
            </div>

            <div class="section-card">
              <h3 class="card-title">Address</h3>
              <div class="meta-row">
                <div class="meta-field"><label>Line 1</label>
                  <input [ngModel]="e.address_line1" (blur)="patch({ address_line1: $any($event.target).value })" name="al1" /></div>
                <div class="meta-field"><label>Line 2</label>
                  <input [ngModel]="e.address_line2" (blur)="patch({ address_line2: $any($event.target).value })" name="al2" /></div>
              </div>
              <div class="meta-row">
                <div class="meta-field"><label>City</label>
                  <input [ngModel]="e.city" (blur)="patch({ city: $any($event.target).value })" name="ct" /></div>
                <div class="meta-field"><label>Region</label>
                  <input [ngModel]="e.region" (blur)="patch({ region: $any($event.target).value })" name="rg" /></div>
                <div class="meta-field"><label>Postcode</label>
                  <input [ngModel]="e.postcode" (blur)="patch({ postcode: $any($event.target).value })" name="pc" /></div>
                <div class="meta-field"><label>Country</label>
                  <input [ngModel]="e.country" (blur)="patch({ country: $any($event.target).value })" name="cn" /></div>
              </div>
            </div>

            <div class="section-card">
              <h3 class="card-title">Emergency contact</h3>
              <div class="meta-row">
                <div class="meta-field"><label>Name</label>
                  <input [ngModel]="e.emergency_name" (blur)="patch({ emergency_name: $any($event.target).value })" name="en" /></div>
                <div class="meta-field"><label>Phone</label>
                  <input [ngModel]="e.emergency_phone" (blur)="patch({ emergency_phone: $any($event.target).value })" name="ep" /></div>
                <div class="meta-field"><label>Relationship</label>
                  <input [ngModel]="e.emergency_rel" (blur)="patch({ emergency_rel: $any($event.target).value })" name="er" /></div>
              </div>
            </div>

            <div class="section-card">
              <h3 class="card-title">Job</h3>
              <div class="meta-row">
                <div class="meta-field"><label>Position</label>
                  <input [ngModel]="e.position" (blur)="patch({ position: $any($event.target).value })" name="pos" /></div>
                <div class="meta-field"><label>Department</label>
                  <input [ngModel]="e.department" (blur)="patch({ department: $any($event.target).value })" name="dep" /></div>
              </div>

              <div class="meta-row">
                <div class="meta-field"><label>Employment type</label>
                  <select [ngModel]="e.employment_type" (ngModelChange)="patch({ employment_type: $event })" name="et">
                    <option value="full_time">Full-time</option>
                    <option value="part_time">Part-time</option>
                    <option value="contractor">Contractor</option>
                    <option value="intern">Intern</option>
                  </select></div>
                <div class="meta-field"><label>Status</label>
                  <select [ngModel]="e.status" (ngModelChange)="patch({ status: $event })" name="st">
                    <option value="onboarding">Onboarding</option>
                    <option value="active">Active</option>
                    <option value="on_leave">On leave</option>
                    <option value="terminated">Terminated</option>
                  </select></div>
                <div class="meta-field"><label>Hire date</label>
                  <input type="date" [ngModel]="e.hire_date" (change)="patch({ hire_date: $any($event.target).value })" name="hd" /></div>
                @if (e.status === 'terminated') {
                  <div class="meta-field"><label>End date</label>
                    <input type="date" [ngModel]="e.end_date" (change)="patch({ end_date: $any($event.target).value })" name="ed" /></div>
                }
              </div>

              <div class="meta-row">
                <div class="meta-field"><label>Manager</label>
                  <select [ngModel]="e.manager_id" (ngModelChange)="patch({ manager_id: $event })" name="mg">
                    <option [ngValue]="null">— none —</option>
                    @for (m of managerChoices(); track m.id) {
                      <option [ngValue]="m.id">{{ m.first_name }} {{ m.last_name }}</option>
                    }
                  </select></div>
                <div class="meta-field"><label>PTO days / year</label>
                  <input type="number" step="0.5" [ngModel]="e.pto_days_year" (blur)="patch({ pto_days_year: +$any($event.target).value })" name="pto" /></div>
              </div>

              <div class="meta-row">
                <div class="meta-field"><label>Salary</label>
                  <input type="number" step="0.01"
                         [ngModel]="e.salary_amount"
                         (blur)="patch({ salary_amount: +$any($event.target).value })" name="sa" /></div>
                <div class="meta-field"><label>Currency</label>
                  <select [ngModel]="e.salary_currency" (ngModelChange)="patch({ salary_currency: $event })" name="cu">
                    <option value="GBP">GBP</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                  </select></div>
                <div class="meta-field"><label>Period</label>
                  <select [ngModel]="e.salary_period" (ngModelChange)="patch({ salary_period: $event })" name="sp">
                    <option value="annual">/ year</option>
                    <option value="monthly">/ month</option>
                    <option value="hourly">/ hour</option>
                  </select></div>
              </div>
            </div>

            <div class="section-card">
              <h3 class="card-title">Payroll &amp; banking</h3>
              <div class="meta-row">
                <div class="meta-field"><label>Tax code</label>
                  <input [ngModel]="e.tax_code" (blur)="patch({ tax_code: $any($event.target).value })" name="tc" placeholder="e.g. 1257L" /></div>
                <div class="meta-field"><label>National insurance no.</label>
                  <input [ngModel]="e.national_insurance_number" (blur)="patch({ national_insurance_number: $any($event.target).value })" name="ni" placeholder="e.g. AB123456C" /></div>
                <div class="meta-field"><label>Student loan plan</label>
                  <select [ngModel]="e.student_loan_plan ?? 'none'" (ngModelChange)="patch({ student_loan_plan: $event })" name="sl">
                    <option value="none">None</option>
                    <option value="plan_1">Plan 1</option>
                    <option value="plan_2">Plan 2</option>
                    <option value="plan_4">Plan 4</option>
                    <option value="postgraduate">Postgraduate</option>
                  </select></div>
              </div>

              <div class="meta-row">
                <div class="meta-field">
                  <label>Pension</label>
                  <label class="inline-toggle">
                    <input type="checkbox" [checked]="!!e.pension_opt_in" (change)="patch({ pension_opt_in: $any($event.target).checked ? 1 : 0 })" />
                    <span>Enrolled in workplace pension</span>
                  </label>
                </div>
                @if (e.pension_opt_in) {
                  <div class="meta-field">
                    <label>Contribution %</label>
                    <input type="number" min="0" max="14" step="0.5"
                           [ngModel]="e.pension_employee_pct ?? 5"
                           (blur)="patch({ pension_employee_pct: clampPct(+$any($event.target).value) })"
                           name="pemp" placeholder="0–14"
                           title="Employer matches the same %" />
                  </div>
                }
              </div>

              <div class="meta-row">
                <div class="meta-field"><label>Bank name</label>
                  <input [ngModel]="e.bank_name" (blur)="patch({ bank_name: $any($event.target).value })" name="bn" /></div>
                <div class="meta-field"><label>Account name</label>
                  <input [ngModel]="e.bank_account_name" (blur)="patch({ bank_account_name: $any($event.target).value })" name="ban" /></div>
              </div>
              <div class="meta-row">
                <div class="meta-field"><label>Sort code</label>
                  <input [ngModel]="e.sort_code" (blur)="patch({ sort_code: $any($event.target).value })" name="sc" placeholder="00-00-00" /></div>
                <div class="meta-field"><label>Account number</label>
                  <input [ngModel]="e.account_number" (blur)="patch({ account_number: $any($event.target).value })" name="an" /></div>
              </div>
            </div>

            <div class="section-card">
              <h3 class="card-title">Notes <span class="muted small">({{ employeeNotes().length }})</span></h3>
              @if (employeeNotes().length === 0) {
                <p class="muted small no-notes">No notes yet — leave the first one below.</p>
              } @else {
                <ul class="note-list">
                  @for (n of employeeNotes(); track n.id) {
                    <li class="note-item">
                      <div class="note-meta">
                        <strong>{{ n.author_name || n.author_email || 'unknown' }}</strong>
                        <span class="muted small">{{ formatTime(n.created_at) }}</span>
                        <button class="ghost icon-btn danger" (click)="delEmployeeNote(n)" title="Delete note">✕</button>
                      </div>
                      <div class="note-body">{{ n.body }}</div>
                    </li>
                  }
                </ul>
              }
              <div class="note-form">
                <textarea rows="2" [(ngModel)]="newEmployeeNote" name="newEmpNote" placeholder="Add a note about this employee…"></textarea>
                <button class="primary" (click)="addEmployeeNote()" [disabled]="!newEmployeeNote.trim()">Add note</button>
              </div>
            </div>
          </div>
        }

        @if (tab() === 'documents') {
          <div class="form-sections">
            <div class="section-card">
              <h3 class="card-title">Required documents <span class="muted small">({{ docCompletion().filled }} / {{ docCompletion().required }})</span></h3>
              <p class="muted small no-notes">
                Types managed centrally on <strong>HR → Documents</strong>. New hires upload these via the onboarding portal; HR can also upload on their behalf below.
              </p>
              @if (uploadDocTypes().length === 0) {
                <p class="muted small">No required types defined yet.</p>
              } @else {
                <ul class="slot-list">
                  @for (t of uploadDocTypes(); track t.id) {
                    @let d = docForType(t.id!);
                    <li class="slot" [class.filled]="!!d" [class.missing]="!d && t.is_required">
                      <div class="slot-head">
                        <strong>{{ t.name }}</strong>
                        @if (t.is_required) { <span class="pill required">required</span> } @else { <span class="pill">optional</span> }
                        @if (d) { <span class="pill done">✓ submitted</span> }
                        <span class="spacer"></span>
                        @if (d) {
                          <button class="ghost" type="button" (click)="viewing.set(d)">View</button>
                          <button class="ghost icon-btn danger" (click)="delDoc(d)" title="Replace / remove">✕</button>
                        } @else {
                          <label class="ghost file-pick">
                            <input type="file" hidden (change)="onSlotFile(t, $any($event.target).files); $event.target.value = ''" />
                            <span>+ Upload</span>
                          </label>
                        }
                      </div>
                      @if (t.description) { <div class="muted small">{{ t.description }}</div> }
                      @if (d) {
                        <div class="slot-meta muted small">
                          @if (d.reference_number) { Ref: <strong>{{ d.reference_number }}</strong> · }
                          @if (d.issued_at) { Issued: {{ d.issued_at }} · }
                          @if (d.expires_at) { Expires: {{ d.expires_at }} · }
                          Uploaded {{ d.uploaded_at }}{{ d.uploaded_by_name ? ' by ' + d.uploaded_by_name : '' }}
                        </div>
                      }
                    </li>
                  }
                </ul>
              }
            </div>

            <div class="section-card">
              <h3 class="card-title">Signed documents <span class="muted small">({{ signedCompletion().signed }} / {{ signedCompletion().total }})</span></h3>
              <p class="muted small no-notes">
                Templates HR distributes for the employee to sign electronically (contracts, code of conduct, policies).
                The employee signs from <strong>HR → My HR</strong> or via the onboarding portal.
              </p>
              @if (signedDocTypes().length === 0) {
                <p class="muted small">No signed-document templates configured yet.</p>
              } @else {
                <ul class="slot-list">
                  @for (t of signedDocTypes(); track t.id) {
                    @let d = docForType(t.id!);
                    <li class="slot" [class.filled]="!!d?.signed_at" [class.missing]="!d?.signed_at">
                      <div class="slot-head">
                        <strong>{{ t.name }}</strong>
                        <span class="pill required">to sign</span>
                        @if (d?.signed_at) {
                          <span class="pill done">✓ signed {{ d?.signed_at }}</span>
                        } @else {
                          <span class="sig-pill pending">Awaiting signature</span>
                        }
                        <span class="spacer"></span>
                        @if (d) {
                          <button class="ghost" type="button" (click)="viewing.set(d!)">View document</button>
                        } @else if (t.template_path) {
                          <button class="ghost" type="button" (click)="viewTemplate(t)">View template</button>
                        }
                      </div>
                      @if (t.description) { <div class="muted small">{{ t.description }}</div> }
                    </li>
                  }
                </ul>
              }
            </div>

            <div class="section-card">
              <h3 class="card-title">Other uploads <span class="muted small">({{ otherDocs().length }})</span></h3>
              <div class="meta-row">
                <div class="meta-field">
                  <label>Document name</label>
                  <input [ngModel]="docName()" (ngModelChange)="docName.set($event)" name="dn" placeholder="Optional — defaults to file name" />
                </div>
                <div class="meta-field">
                  <label>Category</label>
                  <select [ngModel]="docCategory()" (ngModelChange)="docCategory.set($event)" name="dc">
                    <option value="general">General</option>
                    <option value="contract">Contract</option>
                    <option value="performance">Performance</option>
                  </select>
                </div>
                <div class="meta-field">
                  <label>File</label>
                  <input #fileInput type="file" (change)="onFile($any($event.target).files)" />
                </div>
              </div>
              @if (otherDocs().length === 0) {
                <p class="muted small">No other documents yet.</p>
              } @else {
                <ul class="slot-list">
                  @for (d of otherDocs(); track d.id) {
                    <li class="slot filled">
                      <div class="slot-head">
                        <button class="file-link" type="button" (click)="viewing.set(d)"><strong>{{ d.title }}</strong></button>
                        <span class="pill">{{ d.category || 'general' }}</span>
                        <span class="spacer"></span>
                        <button class="ghost" type="button" (click)="viewing.set(d)">View</button>
                        <button class="ghost icon-btn danger" (click)="delDoc(d)" title="Delete">✕</button>
                      </div>
                      <div class="slot-meta muted small">
                        Uploaded {{ d.uploaded_at }}{{ d.uploaded_by_name ? ' by ' + d.uploaded_by_name : '' }}
                      </div>
                    </li>
                  }
                </ul>
              }
            </div>
          </div>
        }

        @if (tab() === 'pto') {
          @if (pto(); as p) {
            <div class="pto-summary">
              <div class="metric"><span class="m-label">Allowance</span><span class="m-val">{{ p.allowance }} d</span></div>
              <div class="metric"><span class="m-label">Accrued</span><span class="m-val">{{ p.accrued }} d</span></div>
              <div class="metric"><span class="m-label">Taken</span><span class="m-val">{{ p.taken }} d</span></div>
              <div class="metric headline"><span class="m-label">Balance</span><span class="m-val">{{ p.balance }} d</span></div>
              <div class="row" style="gap: 8px; align-items: center;">
                <button class="primary" (click)="accruePto()">+ Monthly accrual</button>
                <button class="ghost" (click)="adjustPto()">Manual adjustment</button>
              </div>
            </div>
            @if (p.ledger.length === 0) {
              <p class="muted small" style="margin-top: 14px;">No ledger entries yet. Click "Monthly accrual" to seed one.</p>
            } @else {
              <table class="data" style="margin-top: 14px;">
                <thead><tr><th>Date</th><th>Kind</th><th>Days</th><th>Notes</th></tr></thead>
                <tbody>
                  @for (l of p.ledger; track l.id) {
                    <tr>
                      <td>{{ l.effective_date }}</td>
                      <td><span class="ledger-kind k-{{ l.kind }}">{{ l.kind }}</span></td>
                      <td [class.neg]="l.days < 0">{{ l.days > 0 ? '+' : '' }}{{ l.days }}</td>
                      <td class="muted small">{{ l.notes || '' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            }
          } @else {
            <p class="muted small">Loading…</p>
          }
        }

        @if (tab() === 'learning') {
          <div class="learning-canvas">
          <h3 class="lh">Assigned courses <span class="muted small">({{ learning().length }})</span></h3>
          @if (learning().length === 0) {
            <p class="muted small">No courses assigned. Use the <em>Learning</em> page to assign one.</p>
          } @else {
            <ul class="course-list">
              @for (a of learning(); track a.id) {
                @let modPct = a.module_count ? Math.round(((a.modules_completed ?? 0) / a.module_count) * 100) : 0;
                <li class="course-card" [class.done]="a.status === 'completed'">
                  <div class="course-head">
                    <div class="course-title">
                      <strong>{{ a.title }}</strong>
                      @if (a.is_required) { <span class="pill required">required</span> }
                      @if (a.assign_scope && a.assign_scope !== 'individual') {
                        <span class="pill" [class.scope-co]="a.assign_scope === 'company'" [class.scope-dept]="a.assign_scope === 'department'">
                          {{ a.assign_scope === 'company' ? 'Company-wide' : 'Dept · ' + (a.assign_scope_value || '—') }}
                        </span>
                      }
                      @if (a.compliance_task_id) {
                        <span class="pill scope-comp" title="Satisfies compliance task">⚖ {{ a.compliance_task_title || 'compliance' }}</span>
                      }
                    </div>
                    <span class="spacer"></span>
                    <button class="ghost icon-btn danger" (click)="delAssignment(a)" title="Unassign">✕</button>
                  </div>
                  <div class="course-meta muted small">
                    @if (a.provider)        { {{ a.provider }} }
                    @if (a.category)        { @if (a.provider) { · } {{ a.category }} }
                    @if (a.duration_hours)  { · ~{{ a.duration_hours }}h }
                    @if (a.completed_at)    { · completed {{ a.completed_at }} }
                    @if (a.link) { · <a [href]="a.link" target="_blank" rel="noopener">↗ external link</a> }
                  </div>
                  @if (a.module_count && a.module_count > 0) {
                    <div class="course-progress">
                      <div class="bar"><div class="fill" [style.width.%]="modPct"></div></div>
                      <span class="muted small">{{ a.modules_completed ?? 0 }} / {{ a.module_count }} module{{ a.module_count === 1 ? '' : 's' }}</span>
                    </div>
                  }
                  <div class="meta-row">
                    <div class="meta-field">
                      <label>Status</label>
                      <select [ngModel]="a.status" (ngModelChange)="patchAssignment(a, { status: $event })" name="ls_{{ a.id }}">
                        <option value="not_started">Not started</option>
                        <option value="in_progress">In progress</option>
                        <option value="completed">Completed</option>
                        <option value="expired">Expired</option>
                      </select>
                    </div>
                    <div class="meta-field">
                      <label>Due</label>
                      <input type="date" [ngModel]="a.due_date" (change)="patchAssignment(a, { due_date: $any($event.target).value })" />
                    </div>
                    <div class="meta-field">
                      <label>Score</label>
                      <input type="number" step="0.1" [ngModel]="a.score" (blur)="patchAssignment(a, { score: +$any($event.target).value })" placeholder="—" />
                    </div>
                  </div>
                </li>
              }
            </ul>
          }

          <h3 class="lh" style="margin-top: 24px;">Certifications</h3>
          <div class="cert-form">
            <div class="cf-row">
              <div><label>Name *</label><input [(ngModel)]="newCert.name" name="cn" placeholder="AWS Certified Cloud Practitioner" /></div>
              <div><label>Issuer</label><input [(ngModel)]="newCert.issuer" name="ci" placeholder="Amazon Web Services" /></div>
              <div><label>Credential ID</label><input [(ngModel)]="newCert.credential_id" name="cid" placeholder="ABC-123-XYZ" /></div>
            </div>
            <div class="cf-row">
              <div><label>Issued</label><input type="date" [(ngModel)]="newCert.issued_at" name="cd1" /></div>
              <div><label>Expires</label><input type="date" [(ngModel)]="newCert.expires_at" name="cd2" /></div>
              <div>
                <label>Certificate file</label>
                <input #certFile type="file" accept=".pdf,.png,.jpg,.jpeg" (change)="onCertFile($any($event.target).files)" />
                @if (certFileSel(); as f) { <div class="muted small">{{ f.name }} ({{ formatBytes(f.size) }})</div> }
              </div>
              <button class="primary" (click)="addCert()" [disabled]="!newCert.name.trim() || savingCert()">
                {{ savingCert() ? 'Uploading…' : '+ Add' }}
              </button>
            </div>
            @if (certError()) { <div class="error-msg">{{ certError() }}</div> }
          </div>
          @if (certifications().length === 0) {
            <p class="muted small">No certifications recorded.</p>
          } @else {
            <table class="data">
              <thead><tr><th>Name</th><th>Issuer</th><th>Issued</th><th>Expires</th><th>Credential ID</th><th>File</th><th></th></tr></thead>
              <tbody>
                @for (c of certifications(); track c.id) {
                  <tr [class.expired]="certIsExpired(c)">
                    <td><strong>{{ c.name }}</strong></td>
                    <td>{{ c.issuer || '—' }}</td>
                    <td>{{ c.issued_at || '—' }}</td>
                    <td>
                      {{ c.expires_at || '—' }}
                      @if (certIsExpired(c)) { <span class="exp-pill">expired</span> }
                    </td>
                    <td class="muted small">{{ c.credential_id || '—' }}</td>
                    <td>
                      @if (c.file_path) {
                        <a [href]="certUrl(c)" target="_blank" rel="noopener">↗ View</a>
                      } @else {
                        <span class="muted small">—</span>
                      }
                    </td>
                    <td class="actions"><button class="ghost icon-btn danger" (click)="delCert(c)" title="Delete">✕</button></td>
                  </tr>
                }
              </tbody>
            </table>
          }
          </div>
        }

        @if (tab() === 'time') {
          <div class="time-canvas">
          <div class="row" style="margin-bottom: 14px; gap: 8px; align-items: end;">
            <div><label>Kind</label>
              <select [(ngModel)]="newOff.kind" name="kn">
                <option value="vacation">Vacation</option>
                <option value="sick">Sick</option>
                <option value="personal">Personal</option>
                <option value="unpaid">Unpaid</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div><label>Start</label>
              <input type="date" [(ngModel)]="newOff.start_date" name="st" />
            </div>
            <div><label>End</label>
              <input type="date" [(ngModel)]="newOff.end_date" name="en" />
            </div>
            <button class="primary" (click)="addTimeOff()">+ Request</button>
          </div>
          @if (timeOff().length === 0) {
            <p class="muted small">No time-off requests yet.</p>
          } @else {
            <table class="data">
              <thead><tr><th>Kind</th><th>From</th><th>To</th><th>Days</th><th>Status</th><th></th></tr></thead>
              <tbody>
                @for (t of timeOff(); track t.id) {
                  <tr>
                    <td>{{ t.kind }}</td>
                    <td>{{ t.start_date }}</td>
                    <td>{{ t.end_date }}</td>
                    <td>{{ t.days }}</td>
                    <td><span class="status status-time-{{ t.status }}">{{ t.status }}</span></td>
                    <td class="actions">
                      @if (t.status === 'pending') {
                        <button class="ghost" (click)="reviewTimeOff(t, 'approved')">Approve</button>
                        <button class="ghost danger" (click)="reviewTimeOff(t, 'denied')">Deny</button>
                      }
                      @if (t.status === 'pending' || t.status === 'approved') {
                        <button class="ghost icon-btn danger" (click)="cancelTimeOff(t)" title="Cancel request">✕</button>
                      } @else {
                        <button class="ghost icon-btn danger" (click)="deleteTimeOff(t)" title="Delete row">✕</button>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          }
          </div>
        }
      </div>
    } @else {
      <div class="empty"><p class="muted">Loading…</p></div>
    }

    <app-document-viewer [doc]="viewing()" (closed)="viewing.set(null)"></app-document-viewer>
  `,
  styles: [`
    .toolbar { padding: 16px 20px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--line); }
    .toolbar h1 { margin: 0; font-size: 22px; }
    .spacer { flex: 1; }
    .status {
      padding: 2px 10px; border-radius: 999px;
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      border: 1px solid var(--line);
    }
    .status-active     { color: var(--primary); border-color: var(--primary); }
    .status-onboarding { color: var(--primary); border-color: var(--primary); }
    .status-on_leave   { color: #f59e0b; border-color: #f59e0b; }
    .status-terminated { color: #ef4444; border-color: #ef4444; }
    .status-time-pending  { color: var(--primary); border-color: var(--primary); }
    .status-time-approved { color: var(--primary); border-color: var(--primary); }
    .status-time-denied   { color: #ef4444; border-color: #ef4444; }
    .status-time-cancelled{ color: var(--muted); border-color: var(--muted); }

    .tab-nav { display: flex; gap: 4px; border-bottom: 1px solid var(--line); padding: 0 24px; }
    .tab-btn { padding: 14px 20px; background: none; border: none; color: var(--muted); cursor: pointer; font-size: 13px; position: relative; }
    .tab-btn.active { color: var(--primary); }
    .tab-btn.active::after { content: ''; position: absolute; bottom: -1px; left: 0; right: 0; height: 2px; background: var(--primary); }
    .tab-btn:hover { color: var(--primary); background: transparent; border-color: transparent; }

    .content { padding: 20px 24px 32px; background: #ffffff; min-height: calc(100vh - 200px); }

    .form-grid { display: grid; grid-template-columns: 160px 1fr; column-gap: 16px; row-gap: 10px; align-items: center; max-width: 720px; }
    .form-grid label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
    .form-grid h3.section-h {
      grid-column: 1 / -1;
      margin: 18px 0 4px;
      font-size: 13px; color: var(--muted);
      text-transform: uppercase; letter-spacing: 0.6px; font-weight: 700;
      border-top: 1px solid var(--line); padding-top: 14px;
    }
    .form-sections { display: flex; flex-direction: column; gap: 18px; }
    .section-card {
      background: var(--bg-3);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 18px;
      display: flex; flex-direction: column; gap: 14px;
    }
    .section-card .card-title {
      margin: 0 0 4px;
      font-size: 13px; color: var(--muted);
      text-transform: uppercase; letter-spacing: 0.6px; font-weight: 700;
    }
    .section-card textarea { width: 100%; }
    .meta-row { display: flex; gap: 12px; flex-wrap: wrap; align-items: end; }
    .meta-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 200px; }
    .meta-field.meta-narrow { flex: 0 0 160px; }
    .meta-field label {
      margin: 0; color: var(--muted);
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
    }
    .meta-field input, .meta-field select { width: 100%; }
    .inline-toggle {
      display: inline-flex; align-items: center; gap: 8px;
      margin: 0; padding: 8px 10px;
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
      cursor: pointer; white-space: nowrap;
      text-transform: none; letter-spacing: normal;
      color: var(--fg); font-size: 13px;
      width: 100%;
    }
    .inline-toggle input[type="checkbox"] { width: 16px; height: 16px; flex: 0 0 16px; cursor: pointer; }

    .no-notes { margin: 0; }
    .note-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .note-item {
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
      padding: 10px 12px;
    }
    .note-meta { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
    .note-meta strong { font-size: 13px; }
    .note-meta .icon-btn { margin-left: auto; }
    .note-body { white-space: pre-wrap; line-height: 1.5; font-size: 13px; }
    .note-form { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
    .note-form button { align-self: flex-end; }

    .slot-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .slot {
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
      padding: 10px 12px; display: flex; flex-direction: column; gap: 4px;
    }
    .slot.filled { border-color: var(--primary); }
    .slot.missing { border-left: 3px solid #f97316; }
    .slot-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .slot-meta { padding-top: 4px; border-top: 1px solid var(--line); }
    .pill {
      padding: 1px 6px; border-radius: 4px; font-size: 10px;
      text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      border: 1px solid var(--line); color: var(--muted);
    }
    .pill.required { color: var(--primary); border-color: var(--primary); background: rgba(212,169,58,0.12); }
    .pill.done     { color: var(--primary); border-color: var(--primary); background: rgba(212,169,58,0.12); }
    .file-pick {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 4px 10px; cursor: pointer;
      background: var(--bg-3); border: 1px solid var(--primary); border-radius: var(--radius-sm);
      color: var(--primary); font-size: 12px; margin: 0;
      text-transform: none; letter-spacing: normal;
    }
    .file-pick:hover { background: rgba(212,169,58,0.12); }
    .file-link {
      background: transparent; border: 0; padding: 0;
      color: var(--primary); cursor: pointer; font: inherit;
      text-align: left;
    }
    .file-link:hover { text-decoration: underline; }
    .row { display: flex; align-items: center; gap: 8px; }
    .grow { flex: 1; }

    .task-list { display: flex; flex-direction: column; gap: 6px; }
    .task-row {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 10px; background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
    }
    .task-row.done input[type="text"], .task-row.done .grow { text-decoration: line-through; color: var(--muted); }

    .actions { text-align: right; }

    .check { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); white-space: nowrap; }
    .check input { margin: 0; }
    .check-row { display: flex; align-items: center; gap: 8px; }
    .check-row input[type="checkbox"] { width: 16px; height: 16px; flex: 0 0 16px; cursor: pointer; }
    .check-row label {
      margin: 0; cursor: pointer;
      color: var(--fg); font-size: 13px;
      text-transform: none; letter-spacing: normal;
    }
    .sig-pill { padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; }
    .sig-pill.pending { background: rgba(212, 169, 58, 0.18); color: var(--primary); }
    .sig-pill.signed  { background: rgba(212, 169, 58, 0.18); color: var(--primary); }

    .pto-summary {
      display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
      padding: 16px; background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius);
    }
    .metric { display: flex; flex-direction: column; gap: 2px; min-width: 90px; }
    .metric .m-label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
    .metric .m-val   { font-size: 18px; font-weight: 700; }
    .metric.headline .m-val { font-size: 24px; color: var(--primary); }
    .ledger-kind { padding: 2px 8px; border-radius: 4px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
    .ledger-kind.k-accrual { background: rgba(212, 169, 58, 0.18); color: var(--primary); }
    .ledger-kind.k-taken   { background: rgba(239, 68, 68, 0.18); color: #ef4444; }
    .ledger-kind.k-adjust  { background: rgba(212, 169, 58, 0.18); color: var(--primary); }
    .ledger-kind.k-reset   { background: var(--bg-3); color: var(--muted); }
    td.neg { color: #ef4444; }

    .lh { font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 10px; font-weight: 600; }
    .req-pill {
      display: inline-block; padding: 1px 6px; border-radius: 4px;
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      background: rgba(212, 169, 58, 0.18); color: var(--primary);
      margin-left: 6px;
    }
    .exp-pill {
      display: inline-block; padding: 1px 6px; border-radius: 4px;
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      background: rgba(239, 68, 68, 0.18); color: #ef4444;
      margin-left: 6px;
    }
    tr.expired { opacity: 0.7; }

    .course-list { list-style: none; margin: 0 0 24px; padding: 0; display: flex; flex-direction: column; gap: 10px; }
    .course-card {
      background: var(--bg-3); border: 1px solid var(--line); border-radius: var(--radius-sm);
      padding: 12px 14px;
      display: flex; flex-direction: column; gap: 8px;
    }
    .course-card.done { border-left: 3px solid #10b981; }
    .course-head { display: flex; align-items: center; gap: 10px; }
    .course-head .spacer { flex: 1; }
    .course-title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
    .course-title strong { font-size: 14px; }
    .course-card .pill {
      padding: 1px 6px; border-radius: 4px; font-size: 10px;
      text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      background: var(--bg-2); color: var(--muted); border: 1px solid var(--line);
    }
    .course-card .pill.required { color: var(--primary); border-color: var(--primary); background: rgba(212,169,58,0.15); }
    .course-card .pill.scope-co { color: var(--primary); border-color: var(--primary); }
    .course-card .pill.scope-dept { color: var(--fg); }
    .course-card .pill.scope-comp { color: #10b981; border-color: #10b981; }
    .course-meta { padding: 0 2px; }
    .course-meta a { color: var(--primary); }
    .course-progress { display: flex; align-items: center; gap: 10px; }
    .course-progress .bar { flex: 1; height: 8px; background: var(--bg-2); border-radius: 999px; overflow: hidden; border: 1px solid var(--line); }
    .course-progress .fill { height: 100%; background: var(--primary); transition: width 0.2s; }

    .learning-canvas, .time-canvas {
      background: #ffffff;
      border-radius: var(--radius);
      padding: 20px;
      margin: -4px 0 0;
    }
    .learning-canvas .lh, .time-canvas .lh { color: #0a0a0a; }
    .learning-canvas > .muted, .learning-canvas > p.muted,
    .time-canvas > .muted, .time-canvas > p.muted { color: #555 !important; }
    .learning-canvas .cert-form { background: var(--bg-2); }
    .time-canvas label { color: #555; }
    .cert-form { background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 14px; margin-bottom: 14px; }
    .cert-form .cf-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: end; margin-bottom: 8px; }
    .cert-form .cf-row > div { flex: 1 1 180px; min-width: 0; }
    .cert-form .cf-row > button { flex: 0 0 auto; }
    .cert-form label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 4px; }
    .cert-form input { width: 100%; }
  `],
})
export class HrEmployeeDetail {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  readonly tabs: { key: Tab; label: string }[] = [
    { key: 'profile',    label: 'Profile' },
    { key: 'documents',  label: 'Documents' },
    { key: 'time',       label: 'Time off' },
    { key: 'pto',        label: 'PTO ledger' },
    { key: 'learning',   label: 'Learning' },
  ];
  /** Expose Math to the template for percentage rounding. */
  readonly Math = Math;

  tab = signal<Tab>('profile');
  saving = signal(false);

  employeeId = signal<number | null>(null);
  employee = signal<HrEmployee | null>(null);
  allEmployees = signal<HrEmployee[]>([]);
  managerChoices = computed(() => this.allEmployees().filter(x => x.id !== this.employeeId()));

  documents = signal<HrDocument[]>([]);
  docTypes = signal<HrDocumentType[]>([]);
  docCategory = signal<string>('general');
  docName = signal<string>('');
  docRequiresSig = signal(false);

  uploadDocTypes = computed(() => this.docTypes().filter(t => (t.kind ?? 'upload') === 'upload'));
  signedDocTypes = computed(() => this.docTypes().filter(t => t.kind === 'signed'));
  /** Documents that don't link to a typed slot (uploaded as freeform). Signed-template rows
   * are excluded — they show in the dedicated Signed documents section. */
  otherDocs = computed(() => {
    const signedTypeIds = new Set(this.signedDocTypes().map(t => t.id));
    return this.documents().filter(d => !d.doc_type_id || (d.doc_type_id && !signedTypeIds.has(d.doc_type_id) && !this.uploadDocTypes().some(t => t.id === d.doc_type_id)));
  });
  /** Required-slot completion summary (upload kinds only). */
  docCompletion = computed(() => {
    const required = this.uploadDocTypes().filter(t => t.is_required);
    const submitted = new Set(this.documents().map(d => d.doc_type_id).filter(x => !!x));
    const filled = required.filter(t => submitted.has(t.id!)).length;
    return { filled, required: required.length };
  });
  /** Signed-document completion summary (signed kinds only). */
  signedCompletion = computed(() => {
    const total = this.signedDocTypes().length;
    const signed = this.documents().filter(d => {
      const t = this.signedDocTypes().find(x => x.id === d.doc_type_id);
      return t && d.signed_at;
    }).length;
    return { signed, total };
  });

  pto = signal<HrPtoSummary | null>(null);

  learning = signal<HrCourseAssignment[]>([]);
  certifications = signal<HrCertification[]>([]);
  newCert: HrCertification = { name: '', issuer: '', credential_id: '' };
  certFileSel = signal<File | null>(null);
  savingCert = signal(false);
  certError = signal<string | null>(null);

  timeOff = signal<HrTimeOffEntry[]>([]);
  newOff: HrTimeOffEntry = { employee_id: 0, kind: 'vacation', start_date: '', end_date: '' };

  employeeNotes = signal<HrEmployeeNote[]>([]);
  newEmployeeNote = '';

  viewing = signal<ViewableDoc | null>(null);

  ngOnInit() {
    this.route.paramMap.subscribe(p => {
      const id = +p.get('id')!;
      this.employeeId.set(id);
      this.newOff.employee_id = id;
      this.refresh();
    });
    this.route.queryParamMap.subscribe(q => {
      const t = q.get('tab') as Tab | null;
      if (t && ['profile','documents','pto','learning','time'].includes(t)) {
        this.tab.set(t);
      }
    });
    this.api.listHrEmployees().subscribe(r => this.allEmployees.set(r.employees));
  }

  refresh() {
    const id = this.employeeId();
    if (!id) return;
    this.api.getHrEmployee(id).subscribe(r => this.employee.set(r.employee));
    this.api.listHrDocuments(id).subscribe(r => this.documents.set(r.documents));
    this.api.listHrTimeOff(undefined, id).subscribe(r => this.timeOff.set(r.entries));
    this.api.getHrPto(id).subscribe(r => this.pto.set(r));
    this.api.listEmpHrLearning(id).subscribe(r => this.learning.set(r.assignments));
    this.api.listEmpHrCertifications(id).subscribe(r => this.certifications.set(r.certifications));
    this.api.listEmployeeNotes(id).subscribe(r => this.employeeNotes.set(r.notes));
    this.api.listHrDocumentTypes().subscribe(r => this.docTypes.set(r.types));
  }
  refreshLearning() {
    const id = this.employeeId();
    if (id) this.api.listEmpHrLearning(id).subscribe(r => this.learning.set(r.assignments));
  }
  refreshCerts() {
    const id = this.employeeId();
    if (id) this.api.listEmpHrCertifications(id).subscribe(r => this.certifications.set(r.certifications));
  }
  patchAssignment(a: HrCourseAssignment, p: Partial<HrCourseAssignment>) {
    const id = this.employeeId();
    if (!id || !a.id) return;
    this.api.updateEmpHrLearning(id, a.id, p).subscribe(() => this.refreshLearning());
  }
  delAssignment(a: HrCourseAssignment) {
    const id = this.employeeId();
    if (!id || !a.id) return;
    if (!confirm('Remove this assignment?')) return;
    this.api.deleteEmpHrLearning(id, a.id).subscribe(() => this.refreshLearning());
  }
  addCert() {
    const id = this.employeeId();
    if (!id || !this.newCert.name.trim() || this.savingCert()) return;
    this.certError.set(null);
    this.savingCert.set(true);
    this.api.createEmpHrCertification(id, this.newCert, this.certFileSel()).subscribe({
      next: () => {
        this.savingCert.set(false);
        this.newCert = { name: '', issuer: '', credential_id: '' };
        this.certFileSel.set(null);
        this.refreshCerts();
      },
      error: e => {
        this.savingCert.set(false);
        this.certError.set(e?.error?.error || 'Failed to add');
      },
    });
  }
  onCertFile(files: FileList | null) {
    this.certFileSel.set(files && files.length > 0 ? files[0] : null);
  }
  certUrl(c: HrCertification): string {
    return c.file_path ? `${environment.basePath}/api/${c.file_path}` : '';
  }
  formatBytes(n: number): string {
    if (!n) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }
  patchCert(c: HrCertification, p: Partial<HrCertification>) {
    const id = this.employeeId();
    if (!id || !c.id) return;
    this.api.updateEmpHrCertification(id, c.id, p).subscribe(() => this.refreshCerts());
  }
  delCert(c: HrCertification) {
    const id = this.employeeId();
    if (!id || !c.id) return;
    if (!confirm(`Delete "${c.name}"?`)) return;
    this.api.deleteEmpHrCertification(id, c.id).subscribe(() => this.refreshCerts());
  }
  certIsExpired(c: HrCertification): boolean {
    if (!c.expires_at) return false;
    return new Date(c.expires_at) < new Date();
  }
  refreshPto() {
    const id = this.employeeId();
    if (id) this.api.getHrPto(id).subscribe(r => this.pto.set(r));
  }
  accruePto() {
    const id = this.employeeId();
    if (!id) return;
    this.api.accrueHrPto(id).subscribe(() => this.refreshPto());
  }
  adjustPto() {
    const id = this.employeeId();
    if (!id) return;
    const raw = prompt('Adjust PTO by how many days? (use negative to subtract)');
    if (!raw) return;
    const days = parseFloat(raw);
    if (isNaN(days) || days === 0) return;
    const notes = prompt('Notes (optional)') || undefined;
    this.api.adjustHrPto(id, days, notes).subscribe(() => this.refreshPto());
  }

  patch(p: Partial<HrEmployee>) {
    const id = this.employeeId();
    if (!id) return;
    this.saving.set(true);
    this.api.updateHrEmployee(id, p).subscribe({
      next: () => { this.saving.set(false); this.refresh(); },
      error: () => this.saving.set(false),
    });
  }

  onFile(files: FileList | null) {
    const id = this.employeeId();
    if (!id || !files || files.length === 0) return;
    const file = files[0];
    const title = this.docName().trim() || file.name;
    this.api.uploadHrDocument(id, file, title, this.docCategory(), false).subscribe(() => {
      this.docName.set('');
      this.api.listHrDocuments(id).subscribe(r => this.documents.set(r.documents));
    });
  }
  /** Returns the most-recent document the employee uploaded against the given type. */
  docForType(typeId: number): HrDocument | undefined {
    return this.documents().find(d => d.doc_type_id === typeId);
  }
  viewTemplate(t: HrDocumentType) {
    if (!t.template_path) return;
    this.viewing.set({
      title: t.name,
      file_path: t.template_path,
      mime_type: t.template_mime,
      category: 'template',
    });
  }
  onSlotFile(t: HrDocumentType, files: FileList | null) {
    const id = this.employeeId();
    if (!id || !t.id || !files || files.length === 0) return;
    const file = files[0];
    this.api.uploadHrDocument(id, file, t.name, 'general', false, t.id).subscribe(() => {
      this.api.listHrDocuments(id).subscribe(r => this.documents.set(r.documents));
    });
  }
  delDoc(d: HrDocument) {
    const id = this.employeeId();
    if (!id || !d.id) return;
    if (!confirm(`Delete "${d.title}"?`)) return;
    this.api.deleteHrDocument(id, d.id).subscribe(() => {
      this.api.listHrDocuments(id).subscribe(r => this.documents.set(r.documents));
    });
  }
  docUrl(d: HrDocument): string {
    return `${environment.basePath}/${(d.file_path ?? '').replace(/^\//, '')}`;
  }

  addTimeOff() {
    const id = this.employeeId();
    if (!id || !this.newOff.start_date || !this.newOff.end_date) return;
    this.api.createHrTimeOff({ ...this.newOff, employee_id: id }).subscribe(() => {
      this.newOff = { employee_id: id, kind: 'vacation', start_date: '', end_date: '' };
      this.api.listHrTimeOff(undefined, id).subscribe(r => this.timeOff.set(r.entries));
    });
  }
  reviewTimeOff(t: HrTimeOffEntry, status: 'approved' | 'denied') {
    if (!t.id) return;
    this.api.updateHrTimeOff(t.id, { status }).subscribe(() => {
      const id = this.employeeId();
      if (id) this.api.listHrTimeOff(undefined, id).subscribe(r => this.timeOff.set(r.entries));
    });
  }
  cancelTimeOff(t: HrTimeOffEntry) {
    if (!t.id) return;
    if (!confirm(`Cancel this ${t.kind} request from ${t.start_date} to ${t.end_date}?`)) return;
    this.api.updateHrTimeOff(t.id, { status: 'cancelled' }).subscribe(() => {
      const id = this.employeeId();
      if (id) this.api.listHrTimeOff(undefined, id).subscribe(r => this.timeOff.set(r.entries));
    });
  }
  deleteTimeOff(t: HrTimeOffEntry) {
    if (!t.id) return;
    if (!confirm('Permanently delete this request? This cannot be undone.')) return;
    this.api.deleteHrTimeOff(t.id).subscribe(() => {
      const id = this.employeeId();
      if (id) this.api.listHrTimeOff(undefined, id).subscribe(r => this.timeOff.set(r.entries));
    });
  }
  clampPct(v: number): number {
    if (isNaN(v)) return 0;
    return Math.max(0, Math.min(14, v));
  }

  // Employee notes thread
  addEmployeeNote() {
    const id = this.employeeId();
    const body = this.newEmployeeNote.trim();
    if (!id || !body) return;
    this.api.addEmployeeNote(id, body).subscribe(() => {
      this.newEmployeeNote = '';
      this.api.listEmployeeNotes(id).subscribe(r => this.employeeNotes.set(r.notes));
    });
  }
  delEmployeeNote(n: HrEmployeeNote) {
    const id = this.employeeId();
    if (!id || !n.id) return;
    if (!confirm('Delete this note?')) return;
    this.api.deleteEmployeeNote(id, n.id).subscribe(() =>
      this.api.listEmployeeNotes(id).subscribe(r => this.employeeNotes.set(r.notes))
    );
  }
  formatTime(iso?: string): string {
    if (!iso) return '';
    const d = new Date(iso.replace(' ', 'T'));
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }
}
