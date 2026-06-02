import { Component, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { environment } from '@env/environment';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { HrCertification, HrChangeRequest, HrCourseAssignment, HrDocument, HrDocumentType, HrEmployee, HrEmployeeSkill, HrFeedbackNote, HrGoal, HrPayslip, HrPulseSurvey, HrReview, HrReviewQuestion, HrReviewResponses, HrShift, HrSkill, HrSurveyQuestion, HrTimeOffEntry } from '../../core/models';
import { SignaturePad } from './signature-pad';
import { HrCoursePlayer } from './hr-course-player';
import { DocumentViewer, ViewableDoc } from '../../shared/document-viewer';

type Tab = 'profile' | 'payslips' | 'time' | 'shifts' | 'documents' | 'reviews' | 'learning' | 'goals' | 'skills' | 'feedback' | 'voice';

/**
 * /hr/me — employee self-service portal. Shows the signed-in user's own HR data.
 */
@Component({
  selector: 'app-hr-me',
  imports: [DecimalPipe, FormsModule, SignaturePad, HrCoursePlayer, DocumentViewer],
  template: `
    @if (employee(); as e) {
      <div class="toolbar">
        <h1>{{ e.first_name }} {{ e.last_name }}</h1>
        <span class="muted small">{{ e.position }} · {{ e.department }}</span>
      </div>

      <div class="content">
        @if (tab() === 'profile') {
          <div class="form-sections">
            <div class="section-card">
              <h3 class="card-title">Personal</h3>
              <div class="meta-row">
                <div class="meta-field"><label>First name</label><input [value]="e.first_name" disabled /></div>
                <div class="meta-field"><label>Last name</label><input [value]="e.last_name" disabled /></div>
                <div class="meta-field"><label>Preferred name</label><input [value]="e.preferred_name || ''" disabled /></div>
              </div>
              <div class="meta-row">
                <div class="meta-field"><label>Date of birth</label><input [value]="e.dob || ''" disabled /></div>
                <div class="meta-field"><label>Pronouns</label><input [value]="e.pronouns || ''" disabled /></div>
                <div class="meta-field"><label>Nationality</label><input [value]="e.nationality || ''" disabled /></div>
              </div>
            </div>

            <div class="section-card">
              <h3 class="card-title">Contact</h3>
              <div class="meta-row">
                <div class="meta-field"><label>Email</label><input [value]="e.email || ''" disabled /></div>
                <div class="meta-field"><label>Phone</label><input [value]="e.phone || ''" disabled /></div>
              </div>
              <div class="meta-row">
                <div class="meta-field"><label>Address line 1</label><input [value]="e.address_line1 || ''" disabled /></div>
                <div class="meta-field"><label>Address line 2</label><input [value]="e.address_line2 || ''" disabled /></div>
              </div>
              <div class="meta-row">
                <div class="meta-field"><label>City</label><input [value]="e.city || ''" disabled /></div>
                <div class="meta-field"><label>Region</label><input [value]="e.region || ''" disabled /></div>
                <div class="meta-field"><label>Postcode</label><input [value]="e.postcode || ''" disabled /></div>
                <div class="meta-field"><label>Country</label><input [value]="e.country || ''" disabled /></div>
              </div>
            </div>

            <div class="section-card">
              <h3 class="card-title">Emergency contact</h3>
              <div class="meta-row">
                <div class="meta-field"><label>Name</label><input [value]="e.emergency_name || ''" disabled /></div>
                <div class="meta-field"><label>Phone</label><input [value]="e.emergency_phone || ''" disabled /></div>
                <div class="meta-field"><label>Relationship</label><input [value]="e.emergency_rel || ''" disabled /></div>
              </div>
            </div>

            <div class="section-card">
              <h3 class="card-title">Job</h3>
              <div class="meta-row">
                <div class="meta-field"><label>Position</label><input [value]="e.position || ''" disabled /></div>
                <div class="meta-field"><label>Department</label><input [value]="e.department || ''" disabled /></div>
                <div class="meta-field"><label>Employment type</label><input [value]="e.employment_type || ''" disabled /></div>
              </div>
              <div class="meta-row">
                <div class="meta-field"><label>Hire date</label><input [value]="e.hire_date || ''" disabled /></div>
                <div class="meta-field"><label>Status</label><input [value]="e.status || ''" disabled /></div>
                <div class="meta-field"><label>PTO days / year</label><input [value]="e.pto_days_year ?? ''" disabled /></div>
              </div>
            </div>

            <div class="section-card">
              <h3 class="card-title">Payroll &amp; banking</h3>
              <div class="meta-row">
                <div class="meta-field"><label>Tax code</label><input [value]="e.tax_code || ''" disabled /></div>
                <div class="meta-field"><label>NI number</label><input [value]="e.national_insurance_number || ''" disabled /></div>
                <div class="meta-field"><label>Student loan plan</label><input [value]="e.student_loan_plan || 'none'" disabled /></div>
              </div>
              <div class="meta-row">
                <div class="meta-field"><label>Pension opt-in</label><input [value]="e.pension_opt_in ? 'Yes' : 'No'" disabled /></div>
                <div class="meta-field"><label>Pension % (you)</label><input [value]="e.pension_employee_pct ?? ''" disabled /></div>
                <div class="meta-field"><label>Pension % (employer)</label><input [value]="e.pension_employer_pct ?? ''" disabled /></div>
              </div>
              <div class="meta-row">
                <div class="meta-field"><label>Bank name</label><input [value]="e.bank_name || ''" disabled /></div>
                <div class="meta-field"><label>Account name</label><input [value]="e.bank_account_name || ''" disabled /></div>
                <div class="meta-field"><label>Sort code</label><input [value]="e.sort_code || ''" disabled /></div>
                <div class="meta-field"><label>Account number</label><input [value]="e.account_number || ''" disabled /></div>
              </div>
            </div>

            <div class="section-card">
              <h3 class="card-title">Request a profile change</h3>
              <p class="muted small no-notes">Anything wrong above? Submit a change request and HR will review and apply approved changes.</p>
              <div class="meta-row">
                <div class="meta-field">
                  <label>Field</label>
                  <select [(ngModel)]="changeForm.field" name="cf">
                    <option value="phone">Phone</option>
                    <option value="address_line1">Address line 1</option>
                    <option value="address_line2">Address line 2</option>
                    <option value="city">City</option>
                    <option value="region">Region</option>
                    <option value="postcode">Postcode</option>
                    <option value="country">Country</option>
                    <option value="emergency_name">Emergency contact name</option>
                    <option value="emergency_phone">Emergency contact phone</option>
                    <option value="emergency_rel">Emergency contact relationship</option>
                    <option value="preferred_name">Preferred name</option>
                    <option value="dob">Date of birth</option>
                  </select>
                </div>
                <div class="meta-field"><label>New value</label><input [(ngModel)]="changeForm.new_value" name="cv" /></div>
                <div class="meta-field"><label>Note (optional)</label><input [(ngModel)]="changeForm.note" name="cn" placeholder="Why is this changing?" /></div>
              </div>
              @if (changeError()) { <p class="err">{{ changeError() }}</p> }
              <div class="row">
                <button class="primary" (click)="submitChangeRequest()" [disabled]="!changeForm.new_value">Submit request</button>
              </div>
            </div>

            <div class="section-card">
              <h3 class="card-title">My change requests <span class="muted small">({{ myChangeRequests().length }})</span></h3>
              @if (myChangeRequests().length === 0) {
                <p class="muted small no-notes">No change requests submitted yet.</p>
              } @else {
                <ul class="slot-list">
                  @for (r of myChangeRequests(); track r.id) {
                    <li class="slot" [class.filled]="r.status === 'approved'" [class.missing]="r.status === 'pending'">
                      <div class="slot-head">
                        <strong>{{ r.field }}</strong>
                        <span class="status status-{{ r.status }}">{{ r.status }}</span>
                        <span class="spacer"></span>
                        <span class="muted small">submitted {{ r.created_at }}</span>
                      </div>
                      <div class="slot-meta muted small">
                        <strong>{{ r.old_value || '—' }}</strong> → <strong>{{ r.new_value || '—' }}</strong>
                        @if (r.note) { · <em>{{ r.note }}</em> }
                      </div>
                    </li>
                  }
                </ul>
              }
            </div>
          </div>
        }

        @if (tab() === 'payslips') {
          <div class="form-sections">
            <div class="section-card">
              <h3 class="card-title">My payslips <span class="muted small">({{ payslips().length }})</span></h3>
              @if (payslips().length === 0) {
                <p class="muted small no-notes">No payslips yet.</p>
              } @else {
                <ul class="slot-list">
                  @for (s of payslips(); track s.id) {
                    <li class="slot filled">
                      <div class="slot-head">
                        <strong>{{ ($any(s)).period_name }}</strong>
                        <span class="muted small">{{ ($any(s)).start_date }} → {{ ($any(s)).end_date }}</span>
                        <span class="spacer"></span>
                        <span class="net-amount"><strong>{{ s.net_amount | number:'1.2-2' }}</strong> {{ s.currency }}</span>
                        <button class="ghost" (click)="printSlip(s)" title="Print payslip">🖨 Print</button>
                      </div>
                      <div class="slot-meta payslip-breakdown">
                        <span><span class="k">Gross</span> {{ s.gross_amount | number:'1.2-2' }}</span>
                        <span><span class="k">Tax</span> {{ s.tax_amount | number:'1.2-2' }}</span>
                        <span><span class="k">NI</span> {{ s.ni_amount | number:'1.2-2' }}</span>
                        <span><span class="k">Pay date</span> {{ ($any(s)).pay_date || '—' }}</span>
                      </div>
                    </li>
                  }
                </ul>
              }
            </div>
          </div>
        }

        @if (tab() === 'time') {
          <div class="form-sections">
            <div class="section-card">
              <h3 class="card-title">Request time off</h3>
              <div class="meta-row">
                <div class="meta-field">
                  <label>Kind</label>
                  <select [(ngModel)]="newReq.kind" name="kn">
                    <option value="vacation">Vacation</option>
                    <option value="sick">Sick</option>
                    <option value="personal">Personal</option>
                    <option value="unpaid">Unpaid</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div class="meta-field"><label>Start</label><input type="date" [(ngModel)]="newReq.start_date" name="st" /></div>
                <div class="meta-field"><label>End</label><input type="date" [(ngModel)]="newReq.end_date" name="en" /></div>
              </div>
              @if (reqError()) { <p class="err">{{ reqError() }}</p> }
              <div class="row">
                <button class="primary" (click)="submitReq()" [disabled]="!newReq.start_date || !newReq.end_date">Submit request</button>
              </div>
            </div>

            <div class="section-card">
              <h3 class="card-title">My requests <span class="muted small">({{ myTimeOff().length }})</span></h3>
              @if (myTimeOff().length === 0) {
                <p class="muted small no-notes">No requests yet.</p>
              } @else {
                <ul class="slot-list">
                  @for (t of myTimeOff(); track t.id) {
                    <li class="slot" [class.filled]="t.status === 'approved'" [class.missing]="t.status === 'pending'">
                      <div class="slot-head">
                        <strong>{{ t.kind }}</strong>
                        <span class="status status-{{ t.status }}">{{ t.status }}</span>
                        <span class="spacer"></span>
                        <span class="net-amount"><strong>{{ t.days }}</strong> {{ t.days === 1 ? 'day' : 'days' }}</span>
                      </div>
                      <div class="slot-meta">
                        <span class="muted small">{{ t.start_date }} → {{ t.end_date }}</span>
                        @if (t.notes) { <span class="muted small"> · {{ t.notes }}</span> }
                      </div>
                    </li>
                  }
                </ul>
              }
            </div>
          </div>
        }

        @if (tab() === 'reviews') {
          <div class="form-sections">
            <div class="section-card">
              <h3 class="card-title">My reviews <span class="muted small">({{ myReviews().length }})</span></h3>
              @if (myReviews().length === 0) {
                <p class="muted small no-notes">You don't have any reviews yet.</p>
              } @else {
                <div class="review-list">
                  @for (r of myReviews(); track r.id) {
                <div class="review-card" [class.editing]="reviewEditingId() === r.id">
                  <header>
                    <strong>{{ r.cycle_name }}</strong>
                    <span class="muted small">{{ r.period_start }} → {{ r.period_end }}</span>
                    <span class="spacer"></span>
                    <span class="status status-{{ r.status }}">{{ r.status?.replace('_', ' ') }}</span>
                  </header>

                  @if (reviewEditingId() === r.id) {
                    <div class="grid">
                      @for (q of questionsFor(r); track q.id) {
                        <div class="qrow">
                          <label class="qlabel">{{ q.label }}</label>
                          @if (q.type === 'rating') {
                            <div class="rating-group">
                              @for (n of [1,2,3,4,5]; track n) {
                                <button class="rate-btn" type="button"
                                        [class.selected]="getRating(q) === n"
                                        (click)="setRating(q, n)">{{ n }}</button>
                              }
                            </div>
                          } @else {
                            <textarea rows="3"
                                      [value]="getText(q)"
                                      (blur)="setText(q, $any($event.target).value)"></textarea>
                          }
                        </div>
                      }
                    </div>
                    <div class="row" style="gap: 8px; margin-top: 12px;">
                      <span class="muted small" style="margin-right: 6px;">Overall:</span>
                      <div class="rating-group">
                        @for (n of [1,2,3,4,5]; track n) {
                          <button class="rate-btn" type="button"
                                  [class.selected]="myOverall() === n"
                                  (click)="myOverall.set(n)">{{ n }}</button>
                        }
                      </div>
                      <span class="spacer"></span>
                      <button class="primary" (click)="saveReview(r, true)">✓ Submit self review</button>
                      <button class="ghost" (click)="saveReview(r, false)">Save draft</button>
                      <button class="ghost" (click)="reviewEditingId.set(null)">Close</button>
                    </div>
                  } @else {
                    <p class="muted small" style="margin: 8px 0;">
                      @if (r.employee_signed_at) {
                        You submitted this self review on {{ r.employee_signed_at }}.
                      } @else if (r.status === 'self_review') {
                        Self review in progress.
                      } @else {
                        Pending self review.
                      }
                    </p>
                    @if (r.manager_signed_at && (r.status === 'completed' || r.status === 'closed')) {
                      <p class="muted small">Manager review completed {{ r.manager_signed_at }} · overall {{ r.manager_overall ?? '—' }} / 5</p>
                      @if (r.goals_next_period) {
                        <p style="margin-top: 8px;"><strong>Goals for next period:</strong><br>{{ r.goals_next_period }}</p>
                      }
                    }
                    @if (r.status !== 'completed' && r.status !== 'closed') {
                      <button class="primary" (click)="startReview(r)">{{ r.employee_signed_at ? 'Edit my answers' : 'Fill in self review' }}</button>
                    }
                  }
                </div>
              }
            </div>
              }
            </div>
          </div>
        }

        @if (tab() === 'learning') {
          @if (playingAssignmentId(); as aid) {
            <app-hr-course-player [assignmentId]="aid" mode="me" (exit)="closePlayer()" (completed)="onCourseCompleted()"></app-hr-course-player>
          } @else {
            <div class="form-sections">
              <div class="section-card">
                <h3 class="card-title">Active courses <span class="muted small">({{ activeLearning().length }})</span></h3>
                @if (activeLearning().length === 0) {
                  <p class="muted small no-notes">No courses to work on right now.</p>
                } @else {
                  <ul class="learn-list">
                    @for (a of activeLearning(); track a.id) {
                      <li class="learn-card">
                        <div class="learn-head">
                          <strong>{{ a.title }}</strong>
                          @if (a.is_required) { <span class="pill required">required</span> }
                          <span class="spacer"></span>
                          <span class="status status-{{ a.status }}">{{ a.status?.replace('_', ' ') }}</span>
                        </div>
                        <div class="muted small">
                          {{ a.provider || '—' }} · {{ a.category || 'general' }}
                          @if (a.duration_hours) { · {{ a.duration_hours }}h }
                          @if (a.due_date) { · due {{ a.due_date }} }
                        </div>
                        <div class="learn-actions">
                          <button class="primary" (click)="openCourse(a)">{{ a.status === 'in_progress' ? 'Continue course' : 'Start course' }}</button>
                          @if (a.link) { <a class="ghost" [href]="a.link" target="_blank" rel="noopener">↗ External link</a> }
                        </div>
                      </li>
                    }
                  </ul>
                }
              </div>

              <div class="section-card">
                <h3 class="card-title">Completed courses <span class="muted small">({{ completedLearning().length }})</span></h3>
                @if (completedLearning().length === 0) {
                  <p class="muted small no-notes">Nothing completed yet — finish an active course and it'll move here.</p>
                } @else {
                  <ul class="learn-list">
                    @for (a of completedLearning(); track a.id) {
                      <li class="learn-card done">
                        <div class="learn-head">
                          <strong>{{ a.title }}</strong>
                          @if (a.is_required) { <span class="pill required">required</span> }
                          <span class="spacer"></span>
                          <span class="status status-completed">✓ completed</span>
                        </div>
                        <div class="muted small">
                          {{ a.provider || '—' }} · {{ a.category || 'general' }}
                          @if (a.duration_hours) { · {{ a.duration_hours }}h }
                          · finished {{ a.completed_at }}
                        </div>
                        <div class="learn-actions">
                          <button class="ghost" (click)="openCourse(a)">Review course</button>
                          @if (a.link) { <a class="ghost" [href]="a.link" target="_blank" rel="noopener">↗ External link</a> }
                        </div>
                      </li>
                    }
                  </ul>
                }
              </div>

              <div class="section-card">
                <h3 class="card-title">My certifications <span class="muted small">({{ myCertifications().length }})</span></h3>
                @if (myCertifications().length === 0) {
                  <p class="muted small no-notes">No certifications recorded.</p>
                } @else {
                  <table class="data">
                    <thead><tr><th>Name</th><th>Issuer</th><th>Issued</th><th>Expires</th></tr></thead>
                    <tbody>
                      @for (c of myCertifications(); track c.id) {
                        <tr [class.expired]="certIsExpired(c)">
                          <td><strong>{{ c.name }}</strong></td>
                          <td>{{ c.issuer || '—' }}</td>
                          <td>{{ c.issued_at || '—' }}</td>
                          <td>{{ c.expires_at || '—' }} @if (certIsExpired(c)) { <span class="exp-pill">expired</span> }</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                }
              </div>
            </div>
          }
        }

        @if (tab() === 'voice') {
          <div class="form-sections">
            <div class="section-card">
              <h3 class="card-title">Open pulse surveys <span class="muted small">({{ pulseSurveys().length }})</span></h3>
              @if (pulseSurveys().length === 0) {
                <p class="muted small no-notes">No surveys awaiting your input.</p>
              } @else {
                <ul class="pulse-list">
                  @for (s of pulseSurveys(); track s.id) {
                    <li class="pulse-card" [class.done]="s.already_answered">
                      <div class="pulse-head">
                        <strong>{{ s.title }}</strong>
                        @if (s.is_anonymous) { <span class="pill">anonymous</span> }
                        <span class="spacer"></span>
                        @if (s.already_answered) { <span class="muted small">✓ submitted</span> }
                      </div>
                      @if (s.description) { <p class="muted small">{{ s.description }}</p> }
                      @if (!s.already_answered) {
                        <div class="grid">
                          @for (q of surveyQuestionsOf(s); track q.id) {
                            <div class="qrow">
                              <label class="qlabel">{{ q.label }}</label>
                              @if (q.type === 'rating') {
                                <div class="rating-group">
                                  @for (n of [1,2,3,4,5]; track n) {
                                    <button class="rate-btn" type="button"
                                            [class.selected]="pulseAnswer(s.id!, q.id) === n"
                                            (click)="setPulseAnswer(s.id!, q.id, n)">{{ n }}</button>
                                  }
                                </div>
                              } @else {
                                <textarea rows="3"
                                          [value]="pulseAnswer(s.id!, q.id) || ''"
                                          (blur)="setPulseAnswer(s.id!, q.id, $any($event.target).value)"></textarea>
                              }
                            </div>
                          }
                        </div>
                        <div class="row">
                          <button class="primary" (click)="submitPulse(s)">Submit response</button>
                        </div>
                      }
                    </li>
                  }
                </ul>
              }
            </div>

            <div class="section-card">
              <h3 class="card-title">Send feedback to HR</h3>
              <p class="muted small no-notes">Anonymous by default-or-not — your call. Goes to the HR feedback inbox.</p>
              <div class="meta-row">
                <div class="meta-field">
                  <label>Category</label>
                  <select [(ngModel)]="feedbackForm.category" name="fc">
                    <option value="general">General</option>
                    <option value="manager">My manager</option>
                    <option value="culture">Culture</option>
                    <option value="benefits">Benefits</option>
                    <option value="suggestion">Suggestion</option>
                    <option value="concern">Concern</option>
                  </select>
                </div>
                <div class="meta-field">
                  <label>Anonymous?</label>
                  <label class="inline-toggle">
                    <input type="checkbox" [(ngModel)]="feedbackForm.anonymous" name="fa" />
                    <span>Send without your name attached</span>
                  </label>
                </div>
              </div>
              <textarea rows="4" [(ngModel)]="feedbackForm.message" name="fm" placeholder="What's on your mind?"></textarea>
              <div class="row">
                <button class="primary" (click)="submitFeedback()" [disabled]="!feedbackForm.message.trim()">Send</button>
                @if (feedbackSent()) { <span class="muted small">✓ Thanks — your message was sent</span> }
              </div>
            </div>
          </div>
        }

        @if (tab() === 'shifts') {
          <div class="form-sections">
            <div class="section-card">
              <h3 class="card-title">My shifts <span class="muted small">({{ myShifts().length }})</span></h3>
              @if (myShifts().length === 0) {
                <p class="muted small no-notes">No shifts scheduled.</p>
              } @else {
                <ul class="slot-list">
                  @for (s of myShifts(); track s.id) {
                    <li class="slot" [class.filled]="s.status === 'scheduled'" [class.missing]="s.status === 'swap_requested'">
                      <div class="slot-head">
                        <strong>{{ s.shift_date }}</strong>
                        @if (s.role) { <span class="pill">{{ s.role }}</span> }
                        <span class="status status-{{ s.status }}">{{ s.status?.replace('_', ' ') }}</span>
                        <span class="spacer"></span>
                        <span class="net-amount">{{ s.start_time }} – {{ s.end_time }}</span>
                      </div>
                      @if (s.location || s.notes) {
                        <div class="slot-meta muted small">
                          @if (s.location) { 📍 {{ s.location }} }
                          @if (s.location && s.notes) { · }
                          @if (s.notes) { {{ s.notes }} }
                        </div>
                      }
                    </li>
                  }
                </ul>
              }
            </div>
          </div>
        }

        @if (tab() === 'goals') {
          <div class="form-sections">
            <div class="section-card">
              <h3 class="card-title">Add a goal</h3>
              <div class="meta-row">
                <div class="meta-field"><label>Title</label><input [(ngModel)]="newGoal.title" name="g_t" placeholder="e.g. Ship onboarding portal v2" /></div>
                <div class="meta-field"><label>Measurable outcome</label><input [(ngModel)]="newGoal.measurable" name="g_m" placeholder="What does success look like?" /></div>
                <div class="meta-field"><label>Due</label><input type="date" [(ngModel)]="newGoal.due_date" name="g_d" /></div>
              </div>
              @if (goalError()) { <p class="err">{{ goalError() }}</p> }
              <div class="row">
                <button class="primary" (click)="addMyGoal()" [disabled]="!newGoal.title.trim()">+ Add goal</button>
              </div>
            </div>

            <div class="section-card">
              <h3 class="card-title">My goals <span class="muted small">({{ myGoals().length }})</span></h3>
              @if (myGoals().length === 0) {
                <p class="muted small no-notes">No goals yet — add one above.</p>
              } @else {
                <ul class="goal-list">
                  @for (g of myGoals(); track g.id) {
                    <li class="goal-card">
                      <div class="goal-head">
                        <strong>{{ g.title }}</strong>
                        <span class="status status-{{ g.status }}">{{ g.status?.replace('_', ' ') }}</span>
                        <span class="spacer"></span>
                        @if (g.due_date) { <span class="muted small">due {{ g.due_date }}</span> }
                        <button class="ghost icon-btn danger" (click)="delMyGoal(g)" title="Delete">✕</button>
                      </div>
                      @if (g.measurable) { <div class="muted small">{{ g.measurable }}</div> }
                      <div class="meta-row">
                        <div class="meta-field"><label>Status</label>
                          <select [ngModel]="g.status" (ngModelChange)="updateMyGoal(g, { status: $event })" name="gs_{{ g.id }}">
                            <option value="not_started">Not started</option>
                            <option value="in_progress">In progress</option>
                            <option value="completed">Completed</option>
                            <option value="cancelled">Cancelled</option>
                          </select>
                        </div>
                        <div class="meta-field"><label>Progress %</label>
                          <input type="number" min="0" max="100" [ngModel]="g.progress_pct" (blur)="updateMyGoal(g, { progress_pct: +$any($event.target).value })" name="gp_{{ g.id }}" />
                        </div>
                      </div>
                    </li>
                  }
                </ul>
              }
            </div>
          </div>
        }

        @if (tab() === 'skills') {
          <div class="form-sections">
            <div class="section-card">
              <h3 class="card-title">Add a skill</h3>
              <p class="muted small no-notes">Name any skill you want assessed — type it freely, or pick one HR already catalogued from the suggestions. Your manager can also update these.</p>
              <div class="meta-row">
                <div class="meta-field">
                  <label>Skill name</label>
                  <input [ngModel]="newSkill().name" (ngModelChange)="setNewSkill({ name: $event })"
                         name="ns_name" placeholder="e.g. TypeScript, Public speaking…"
                         list="skill-name-suggest" autocomplete="off" />
                  <datalist id="skill-name-suggest">
                    @for (c of skillCatalog(); track c.id) {
                      <option [value]="c.name"></option>
                    }
                  </datalist>
                </div>
                <div class="meta-field">
                  <label>Category</label>
                  <input [ngModel]="newSkill().category" (ngModelChange)="setNewSkill({ category: $event })"
                         name="ns_cat" placeholder="Optional — e.g. Frontend, Soft skills"
                         list="skill-cat-suggest" autocomplete="off" />
                  <datalist id="skill-cat-suggest">
                    @for (c of skillCategories(); track c) {
                      <option [value]="c"></option>
                    }
                  </datalist>
                </div>
              </div>
              <div class="meta-row">
                <div class="meta-field">
                  <label>Current level (0–5)</label>
                  <input type="number" min="0" max="5" [ngModel]="newSkill().current_level"
                         (ngModelChange)="setNewSkill({ current_level: +$event })" name="ns_curr" />
                </div>
                <div class="meta-field">
                  <label>Target level (0–5)</label>
                  <input type="number" min="0" max="5" [ngModel]="newSkill().target_level"
                         (ngModelChange)="setNewSkill({ target_level: +$event })" name="ns_targ" />
                </div>
                <div class="meta-field">
                  <label>Notes</label>
                  <input [ngModel]="newSkill().notes" (ngModelChange)="setNewSkill({ notes: $event })"
                         name="ns_notes" placeholder="Optional — context for the level" />
                </div>
              </div>
              @if (skillError()) { <p class="err">{{ skillError() }}</p> }
              <div class="row">
                <button class="primary" (click)="addMySkill()" [disabled]="!newSkill().name.trim()">+ Add skill</button>
              </div>
            </div>

            <div class="section-card">
              <h3 class="card-title">My skill assessments <span class="muted small">({{ myOwnSkills().length }})</span></h3>
              @if (myOwnSkills().length === 0) {
                <p class="muted small no-notes">No skills assessed yet — add one above.</p>
              } @else {
                <ul class="slot-list">
                  @for (s of myOwnSkills(); track s.id) {
                    <li class="slot filled">
                      <div class="slot-head">
                        <strong>{{ s.skill_name }}</strong>
                        @if (s.category) { <span class="pill">{{ s.category }}</span> }
                        <span class="spacer"></span>
                        @if (editingSkillId() !== s.id) {
                          <div class="skill-meter" [attr.title]="'Current: ' + s.current_level + ' / 5 · Target: ' + s.target_level + ' / 5'">
                            @for (n of [1,2,3,4,5]; track n) {
                              <span class="seg"
                                    [class.filled]="n <= s.current_level"
                                    [class.target]="n === s.target_level && n > s.current_level"></span>
                            }
                            <span class="skill-meter-label muted small">{{ s.current_level }} → {{ s.target_level }} / 5</span>
                          </div>
                          <button class="ghost icon-btn" (click)="startEditSkill(s)" title="Edit">✎</button>
                          <button class="ghost icon-btn danger" (click)="delMySkill(s)" title="Remove">✕</button>
                        }
                      </div>

                      @if (editingSkillId() === s.id) {
                        <div class="meta-row">
                          <div class="meta-field">
                            <label>Current level (0–5)</label>
                            <input type="number" min="0" max="5" [(ngModel)]="s.current_level" name="es_curr_{{ s.id }}" />
                          </div>
                          <div class="meta-field">
                            <label>Target level (0–5)</label>
                            <input type="number" min="0" max="5" [(ngModel)]="s.target_level" name="es_targ_{{ s.id }}" />
                          </div>
                        </div>
                        <div class="meta-row">
                          <div class="meta-field">
                            <label>Notes</label>
                            <input [(ngModel)]="s.notes" name="es_notes_{{ s.id }}" placeholder="Optional — context for the level" />
                          </div>
                        </div>
                        <div class="row">
                          <button class="primary" (click)="saveSkillEdit(s)">Save</button>
                          <button class="ghost" (click)="cancelEditSkill()">Cancel</button>
                        </div>
                      } @else if (s.notes || s.assessed_at) {
                        <div class="slot-meta muted small">
                          @if (s.notes) { {{ s.notes }} }
                          @if (s.notes && s.assessed_at) { · }
                          @if (s.assessed_at) { assessed {{ s.assessed_at }} }
                        </div>
                      }
                    </li>
                  }
                </ul>
              }
            </div>
          </div>
        }

        @if (tab() === 'feedback') {
          <div class="form-sections">
            <div class="section-card">
              <h3 class="card-title">Notes from my manager <span class="muted small">({{ mySharedFeedback().length }})</span></h3>
              <p class="muted small no-notes">Shared notes from your manager — feedback, 1:1 summaries, recognition. Private notes never appear here.</p>
              @if (mySharedFeedback().length === 0) {
                <p class="muted small no-notes">No feedback shared yet.</p>
              } @else {
                <ul class="fb-list">
                  @for (n of mySharedFeedback(); track n.id) {
                    <li class="fb-card">
                      <div class="fb-head">
                        <span class="kind-pill kind-{{ n.kind }}">{{ n.kind.replace('_', ' ') }}</span>
                        @if (n.meeting_date) { <span class="muted small">meeting {{ n.meeting_date }}</span> }
                        <span class="spacer"></span>
                        <span class="muted small">{{ n.author_name || n.author_email || 'Manager' }} · {{ n.created_at }}</span>
                      </div>
                      <p class="fb-body">{{ n.body }}</p>
                    </li>
                  }
                </ul>
              }
            </div>
          </div>
        }

        @if (tab() === 'documents') {
          <div class="form-sections">
            <div class="section-card">
              <h3 class="card-title">Documents to sign <span class="muted small">({{ docsToSign().length }})</span></h3>
              @if (docsToSign().length === 0) {
                <p class="muted small no-notes">Nothing waiting for your signature.</p>
              } @else {
                <ul class="slot-list">
                  @for (d of docsToSign(); track d.id) {
                    <li class="slot" [class.filled]="!!d.signed_at" [class.missing]="!d.signed_at">
                      <div class="slot-head">
                        <strong>{{ d.title }}</strong>
                        <span class="pill">{{ d.category || 'general' }}</span>
                        @if (d.signed_at) {
                          <span class="sig-pill signed">✓ signed {{ d.signed_at }}</span>
                        } @else {
                          <span class="sig-pill pending">awaiting signature</span>
                        }
                        <span class="spacer"></span>
                        <button class="ghost" type="button" (click)="viewDoc(d)">View</button>
                        <a class="ghost" [href]="docUrl(d)" [download]="downloadName(d)" target="_blank" rel="noopener">⇩ Download</a>
                      </div>
                      @if (d.requires_signature && !d.signed_at) {
                        @if (signingId() === d.id) {
                          <app-signature-pad (signed)="completeSign(d, $event)" />
                          <div class="row" style="margin-top: 6px;">
                            <button class="ghost" (click)="signingId.set(null)">Cancel</button>
                          </div>
                        } @else {
                          <div class="row" style="margin-top: 6px;">
                            <button class="primary" (click)="startSign(d)">Sign now</button>
                          </div>
                        }
                      }
                    </li>
                  }
                </ul>
              }
            </div>

            <div class="section-card">
              <h3 class="card-title">Required documents <span class="muted small">({{ uploadDocTypes().length }})</span></h3>
              <p class="muted small no-notes">HR-controlled catalog. Each item below is a slot — drop in the file you have on hand.</p>
              @if (uploadDocTypes().length === 0) {
                <p class="muted small no-notes">No required document types defined.</p>
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
                          <button class="ghost" type="button" (click)="viewDoc(d)">View</button>
                          <a class="ghost" [href]="docUrl(d)" [download]="downloadName(d)" target="_blank" rel="noopener">⇩ Download</a>
                          <button class="ghost icon-btn danger" (click)="delMyDoc(d)" title="Replace / remove">✕</button>
                        } @else {
                          <label class="ghost file-pick">
                            <input type="file" hidden (change)="uploadForType(t, $any($event.target).files); $event.target.value = ''" />
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
                          Uploaded {{ d.uploaded_at }}
                        </div>
                      }
                    </li>
                  }
                </ul>
              }
            </div>

            <div class="section-card">
              <h3 class="card-title">Other documents <span class="muted small">({{ docsOther().length }})</span></h3>
              <p class="muted small no-notes">Anything else you'd like HR to have on file — receipts, certificates, supporting evidence.</p>
              <div class="meta-row">
                <div class="meta-field">
                  <label>Title</label>
                  <input [ngModel]="extraTitle()" (ngModelChange)="extraTitle.set($event)" name="ext_t" placeholder="Optional — defaults to the file name" />
                </div>
                <div class="meta-field">
                  <label>Category</label>
                  <select [ngModel]="extraCategory()" (ngModelChange)="extraCategory.set($event)" name="ext_c">
                    <option value="general">General</option>
                    <option value="contract">Contract</option>
                    <option value="performance">Performance</option>
                    <option value="evidence">Evidence</option>
                  </select>
                </div>
                <div class="meta-field">
                  <label>File</label>
                  <input type="file" (change)="uploadExtra($any($event.target).files); $event.target.value = ''" [disabled]="extraBusy()" />
                </div>
              </div>
              @if (extraError()) { <p class="err">{{ extraError() }}</p> }
              @if (docsOther().length === 0) {
                <p class="muted small no-notes">No other documents yet.</p>
              } @else {
                <ul class="slot-list">
                  @for (d of docsOther(); track d.id) {
                    <li class="slot filled">
                      <div class="slot-head">
                        <strong>{{ d.title }}</strong>
                        <span class="pill">{{ d.category || 'general' }}</span>
                        <span class="spacer"></span>
                        <button class="ghost" type="button" (click)="viewDoc(d)">View</button>
                        <a class="ghost" [href]="docUrl(d)" [download]="downloadName(d)" target="_blank" rel="noopener">⇩ Download</a>
                        <button class="ghost icon-btn danger" (click)="delMyDoc(d)" title="Delete">✕</button>
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
      </div>
    } @else if (errored()) {
      <div class="empty">
        <h2>You don't have an HR record yet</h2>
        <p class="muted">Ask an HR admin to add you as an employee from <code>/hr/employees</code>.</p>
      </div>
    } @else {
      <div class="empty"><p class="muted">Loading…</p></div>
    }

    <app-document-viewer [doc]="viewing()" (closed)="viewing.set(null)"></app-document-viewer>
  `,
  styles: [`
    .toolbar { padding: 16px 20px; display: flex; align-items: baseline; gap: 12px; border-bottom: 1px solid var(--line); }
    .toolbar h1 { margin: 0; font-size: 22px; }
    .content { padding: 20px 24px 32px; background: #ffffff; min-height: calc(100vh - 120px); }

    /* Canonical section-card pattern (memory.md): each section is its own card. */
    .form-sections { display: flex; flex-direction: column; gap: 18px; }
    .section-card {
      background: var(--bg-3); border: 1px solid var(--line); border-radius: var(--radius);
      padding: 18px; display: flex; flex-direction: column; gap: 14px;
    }
    .section-card .card-title {
      margin: 0; font-size: 13px; color: var(--muted);
      text-transform: uppercase; letter-spacing: 0.6px; font-weight: 700;
    }
    .section-card .no-notes { margin: 0; }

    /* meta-row + meta-field — every form row uses this. */
    .meta-row { display: flex; gap: 12px; flex-wrap: wrap; align-items: end; }
    .meta-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 200px; }
    .meta-field label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; margin: 0; }
    .meta-field input, .meta-field select, .meta-field textarea { width: 100%; }
    .inline-toggle {
      display: inline-flex; align-items: center; gap: 8px;
      margin: 0; padding: 8px 10px;
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
      cursor: pointer; white-space: nowrap;
      color: var(--fg); font-size: 13px;
      width: 100%;
    }
    .inline-toggle input[type="checkbox"] { width: 16px; height: 16px; flex: 0 0 16px; cursor: pointer; }

    .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .err { color: #ef4444; font-size: 13px; margin: 0; }

    /* Status pills — used across all tabs. */
    .status { padding: 2px 10px; border-radius: 999px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700; border: 1px solid var(--line); }
    .status-pending        { color: var(--primary); border-color: var(--primary); }
    .status-approved       { color: var(--primary); border-color: var(--primary); }
    .status-denied         { color: #ef4444; border-color: #ef4444; }
    .status-cancelled      { color: var(--muted); border-color: var(--muted); }
    .status-not_started    { color: var(--muted); border-color: var(--line); }
    .status-self_review    { color: var(--primary); border-color: var(--primary); }
    .status-manager_review { color: var(--primary); border-color: var(--primary); }
    .status-completed      { color: var(--primary); border-color: var(--primary); }
    .status-closed         { color: var(--muted); border-color: var(--muted); }
    .status-in_progress    { color: var(--primary); border-color: var(--primary); }
    .status-expired        { color: #ef4444; border-color: #ef4444; }
    .status-scheduled      { color: var(--primary); border-color: var(--primary); }

    /* Generic pill (required, anonymous, category) */
    .pill {
      padding: 1px 6px; border-radius: 4px; font-size: 10px;
      text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      border: 1px solid var(--line); color: var(--muted);
    }
    .pill.required { color: var(--primary); border-color: var(--primary); background: rgba(212,169,58,0.12); }
    .pill.done { color: var(--primary); border-color: var(--primary); background: rgba(212,169,58,0.12); }
    .file-pick {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 12px;
      background: var(--bg-3); border: 1px solid var(--line); border-radius: var(--radius-sm);
      color: var(--fg); cursor: pointer; font-size: 13px;
    }
    .file-pick:hover { border-color: var(--primary); color: var(--primary); }

    .net-amount {
      padding: 2px 10px; border-radius: 4px;
      background: rgba(212, 169, 58, 0.12); color: var(--primary);
      border: 1px solid var(--primary); font-size: 13px;
    }
    .payslip-breakdown {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px;
    }
    .payslip-breakdown .k {
      color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;
      display: block; margin-bottom: 2px;
    }
    .payslip-breakdown > span { display: flex; flex-direction: column; }

    /* slot-list — same pattern as /hr/employees/:id Documents tab. */
    .slot-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .slot {
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
      padding: 10px 12px; display: flex; flex-direction: column; gap: 4px;
    }
    .slot.filled { border-color: var(--primary); }
    .slot.missing { border-color: #f59e0b; }
    .slot-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .slot-meta { padding-top: 4px; border-top: 1px solid var(--line); }
    .sig-pill {
      padding: 1px 6px; border-radius: 4px; font-size: 10px;
      text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      border: 1px solid var(--line);
    }
    .sig-pill.signed  { color: var(--primary); border-color: var(--primary); background: rgba(212,169,58,0.12); }
    .sig-pill.pending { color: #f59e0b; border-color: #f59e0b; background: rgba(245,158,11,0.10); }
    .exp-pill {
      display: inline-block; padding: 1px 6px; border-radius: 4px;
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      background: rgba(239, 68, 68, 0.18); color: #ef4444;
      margin-left: 6px;
    }
    tr.expired { opacity: 0.7; }

    /* Goals */
    .goal-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .goal-card {
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
      padding: 10px 12px; display: flex; flex-direction: column; gap: 8px;
    }
    .goal-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .goal-head .spacer { flex: 1; }

    /* Skills level chip + meter */
    .lvl {
      display: inline-block; min-width: 22px; padding: 1px 6px;
      background: var(--primary); color: #0a0a0a;
      border-radius: 4px; font-weight: 700; text-align: center; font-size: 12px;
    }
    .skill-meter { display: inline-flex; align-items: center; gap: 6px; }
    .skill-meter .seg {
      width: 22px; height: 8px; border-radius: 2px;
      background: var(--bg-2); border: 1px solid var(--line);
    }
    .skill-meter .seg.filled { background: var(--primary); border-color: var(--primary); }
    .skill-meter .seg.target { background: transparent; border: 1px dashed var(--primary); }
    .skill-meter-label { margin-left: 4px; }

    /* Feedback notes thread */
    .fb-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .fb-card {
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
      padding: 10px 12px; display: flex; flex-direction: column; gap: 6px;
    }
    .fb-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .fb-head .spacer { flex: 1; }
    .fb-body { white-space: pre-wrap; line-height: 1.5; font-size: 13px; margin: 0; }
    .kind-pill {
      padding: 1px 6px; border-radius: 4px; font-size: 10px;
      text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      background: var(--bg-3); color: var(--muted); border: 1px solid var(--line);
    }
    .kind-pill.kind-feedback     { color: var(--primary); border-color: var(--primary); }
    .kind-pill.kind-one_on_one   { color: #3b82f6; border-color: #3b82f6; }
    .kind-pill.kind-coaching     { color: #a78bfa; border-color: #a78bfa; }
    .kind-pill.kind-recognition  { color: #10b981; border-color: #10b981; }

    /* Reviews */
    .review-list { display: flex; flex-direction: column; gap: 12px; }
    .review-card {
      padding: 12px; background: var(--bg-2);
      border: 1px solid var(--line); border-radius: var(--radius-sm);
      display: flex; flex-direction: column; gap: 8px;
    }
    .review-card.editing { border-color: var(--primary); }
    .review-card header { display: flex; align-items: center; gap: 10px; }
    .review-card header .spacer { flex: 1; }

    /* Learning cards */
    .learn-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .learn-card {
      padding: 12px; background: var(--bg-2);
      border: 1px solid var(--line); border-radius: var(--radius-sm);
      display: flex; flex-direction: column; gap: 6px;
    }
    .learn-card.done { border-left: 3px solid var(--primary); }
    .learn-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .learn-head .spacer { flex: 1; }
    .learn-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

    /* Pulse surveys */
    .pulse-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
    .pulse-card {
      padding: 12px; background: var(--bg-2);
      border: 1px solid var(--line); border-radius: var(--radius-sm);
      display: flex; flex-direction: column; gap: 10px;
    }
    .pulse-card.done { opacity: 0.6; }
    .pulse-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .pulse-head .spacer { flex: 1; }

    /* Question rows for review + pulse */
    .grid { display: flex; flex-direction: column; gap: 12px; }
    .qrow { display: grid; grid-template-columns: 220px 1fr; gap: 14px; align-items: start; }
    .qlabel { padding-top: 6px; color: var(--muted); font-size: 13px; }
    .rating-group { display: flex; gap: 6px; }
    .rate-btn {
      width: 36px; height: 36px;
      background: var(--bg-3); border: 1px solid var(--line); color: var(--fg);
      border-radius: var(--radius-sm); cursor: pointer; font-weight: 700;
    }
    .rate-btn:hover { border-color: var(--primary); }
    .rate-btn.selected { background: var(--primary); color: #0a0a0a; border-color: var(--primary); }

    .empty { padding: 40px 20px; text-align: center; }
    .actions { text-align: right; }
  `],
})
export class HrMe {
  private api = inject(Api);
  private router = inject(Router);

  readonly tabs: { key: Tab; label: string }[] = [
    { key: 'profile',   label: 'My profile' },
    { key: 'payslips',  label: 'Payslips' },
    { key: 'time',      label: 'Time off' },
    { key: 'documents', label: 'Documents' },
    { key: 'reviews',   label: 'Reviews' },
    { key: 'learning',  label: 'Learning' },
    { key: 'voice',     label: 'Pulse & feedback' },
  ];
  tab = signal<Tab>('profile');
  errored = signal(false);

  employee = signal<HrEmployee | null>(null);
  payslips = signal<HrPayslip[]>([]);
  myTimeOff = signal<HrTimeOffEntry[]>([]);
  documents = signal<HrDocument[]>([]);
  myReviews = signal<HrReview[]>([]);
  myLearning = signal<HrCourseAssignment[]>([]);
  myCertifications = signal<HrCertification[]>([]);
  myChangeRequests = signal<HrChangeRequest[]>([]);
  changeForm = { field: 'phone', new_value: '', note: '' };
  changeError = signal<string | null>(null);

  // Sidenav-driven sections added with the ESS shell.
  myShifts = signal<HrShift[]>([]);
  myGoals = signal<HrGoal[]>([]);
  myOwnSkills = signal<HrEmployeeSkill[]>([]);
  /** Catalog of skills HR has defined — used for category suggestions in the picker datalist. */
  skillCatalog = signal<HrSkill[]>([]);
  /** Distinct category strings from the catalog so the New-skill form can suggest them. */
  skillCategories = computed(() => {
    const set = new Set<string>();
    this.skillCatalog().forEach(s => { if (s.category) set.add(s.category); });
    return Array.from(set).sort();
  });
  /**
   * New-skill form state — free-form name + optional category. Backend resolves
   * the name to an existing catalog row case-insensitively or creates a new one.
   */
  newSkill = signal<{ name: string; category: string; current_level: number; target_level: number; notes: string }>(
    { name: '', category: '', current_level: 0, target_level: 5, notes: '' }
  );
  skillError = signal<string | null>(null);
  /** Track which existing skill row is in inline-edit mode. */
  editingSkillId = signal<number | null>(null);
  mySharedFeedback = signal<HrFeedbackNote[]>([]);
  newGoal = { title: '', description: '', measurable: '', due_date: '' };
  goalError = signal<string | null>(null);

  /** Active courses — anything still requiring action. */
  activeLearning = computed(() => this.myLearning().filter(a => a.status !== 'completed'));
  /** Courses the employee has finished. */
  completedLearning = computed(() => this.myLearning().filter(a => a.status === 'completed'));

  /** Documents requiring (or that have received) a signature — own list. */
  docsToSign = computed(() => this.documents().filter(d => !!d.requires_signature));
  /** Free-form uploads not tied to a required-document type — appear under "Other documents". */
  docsOther = computed(() => {
    const typedIds = new Set(this.uploadDocTypes().map(t => t.id));
    return this.documents().filter(d => !d.requires_signature && (!d.doc_type_id || !typedIds.has(d.doc_type_id)));
  });

  // Required document types (catalog — kind='upload') so each one becomes a slot.
  docTypes = signal<HrDocumentType[]>([]);
  uploadDocTypes = computed(() => this.docTypes().filter(t => (t.kind ?? 'upload') === 'upload'));
  docForType(typeId: number): HrDocument | undefined {
    return this.documents().find(d => d.doc_type_id === typeId && !d.requires_signature);
  }

  /** Free-form upload form state for the "Other documents" card. */
  extraTitle = signal<string>('');
  extraCategory = signal<string>('general');
  extraBusy = signal(false);
  extraError = signal<string | null>(null);

  viewing = signal<ViewableDoc | null>(null);
  viewDoc(d: HrDocument) { this.viewing.set(d as ViewableDoc); }
  /** Filename used by the browser download attribute — derived from file_path so users get a sensible save-as name. */
  downloadName(d: HrDocument): string {
    if (!d.file_path) return d.title || 'document';
    return d.file_path.split('/').pop() || d.title || 'document';
  }

  /** Upload a file against a required document type (shows in the slot for that type). */
  uploadForType(t: HrDocumentType, files: FileList | null) {
    if (!t.id || !files || files.length === 0) return;
    const file = files[0];
    this.api.uploadHrMyDocument(file, { title: t.name, doc_type_id: t.id, category: 'general' }).subscribe({
      next: () => this.refreshDocs(),
      error: e => alert(e?.error?.error || 'Upload failed'),
    });
  }
  /** Free-form upload (Other documents). */
  uploadExtra(files: FileList | null) {
    if (!files || files.length === 0) return;
    const file = files[0];
    const title = this.extraTitle().trim() || file.name;
    this.extraBusy.set(true);
    this.extraError.set(null);
    this.api.uploadHrMyDocument(file, { title, category: this.extraCategory() }).subscribe({
      next: () => {
        this.extraBusy.set(false);
        this.extraTitle.set('');
        this.refreshDocs();
      },
      error: e => {
        this.extraBusy.set(false);
        this.extraError.set(e?.error?.error || 'Upload failed');
      },
    });
  }
  /** Delete a self-uploaded (non-signed) document. */
  delMyDoc(d: HrDocument) {
    if (!d.id) return;
    if (!confirm(`Delete "${d.title}"?`)) return;
    this.api.deleteHrMyDocument(d.id).subscribe(() => this.refreshDocs());
  }
  private refreshDocs() {
    this.api.listHrMyDocuments().subscribe(rr => this.documents.set(rr.documents));
  }

  pulseSurveys = signal<HrPulseSurvey[]>([]);
  pulseAnswers = signal<Record<number, Record<string, number | string>>>({});
  feedbackForm = { message: '', category: 'general', anonymous: false };
  feedbackSent = signal(false);

  signingId = signal<number | null>(null);
  reviewEditingId = signal<number | null>(null);
  reviewResponses = signal<HrReviewResponses>({});
  myOverall = signal<number | null>(null);

  newReq: { kind: HrTimeOffEntry['kind']; start_date: string; end_date: string } = {
    kind: 'vacation', start_date: '', end_date: '',
  };
  reqError = signal<string | null>(null);

  /** Map between sidenav URL path segments and the internal tab key. */
  private static readonly URL_TO_TAB: Record<string, Tab> = {
    '':           'profile',
    'payslips':   'payslips',
    'time-off':   'time',
    'shifts':     'shifts',
    'documents':  'documents',
    'reviews':    'reviews',
    'learning':   'learning',
    'goals':      'goals',
    'skills':     'skills',
    'feedback':   'feedback',
    'engagement': 'voice',
  };

  private syncTabFromUrl() {
    const url = this.router.url.split('?')[0]; // strip query
    const seg = url.replace(/^\//, '').split('/').slice(1).join('/'); // after '/me/'
    const tab = HrMe.URL_TO_TAB[seg];
    if (tab) this.tab.set(tab);
  }

  ngOnInit() {
    // /me, /me/payslips, /me/time-off, etc. all mount this component; pick the
    // active tab from whichever path the user navigated to.
    this.syncTabFromUrl();
    this.router.events
      .pipe(filter(e => e instanceof NavigationEnd))
      .subscribe(() => this.syncTabFromUrl());

    this.api.getHrMe().subscribe({
      next: r => {
        this.employee.set(r.employee);
        this.api.listHrMyPayslips().subscribe(rr => this.payslips.set(rr.payslips));
        this.api.listHrMyTimeOff().subscribe(rr => this.myTimeOff.set(rr.entries));
        this.api.listHrMyDocuments().subscribe(rr => this.documents.set(rr.documents));
        this.api.listHrMyReviews().subscribe(rr => this.myReviews.set(rr.reviews));
        this.api.listHrMyLearning().subscribe(rr => this.myLearning.set(rr.assignments));
        this.api.listHrMyCertifications().subscribe(rr => this.myCertifications.set(rr.certifications));
        this.api.listHrMyChangeRequests().subscribe(rr => this.myChangeRequests.set(rr.requests));
        this.api.listHrMyPulseSurveys().subscribe(rr => this.pulseSurveys.set(rr.surveys));
        this.api.listMyShifts().subscribe(rr => this.myShifts.set(rr.shifts));
        this.api.listMyGoals().subscribe(rr => this.myGoals.set(rr.goals));
        this.api.listMyOwnSkills().subscribe(rr => this.myOwnSkills.set(rr.rows));
        this.api.listHrSkills().subscribe(rr => this.skillCatalog.set(rr.skills));
        this.api.listHrDocumentTypes().subscribe(rr => this.docTypes.set(rr.types));
        if (r.employee.id) {
          this.api.listFeedbackNotes(r.employee.id).subscribe(rr => this.mySharedFeedback.set(rr.notes));
        }
      },
      error: () => this.errored.set(true),
    });
  }

  // ── Goals (self-service) ────────────────────────────────────────────────────
  addMyGoal() {
    const title = this.newGoal.title.trim();
    if (!title) { this.goalError.set('Title is required.'); return; }
    this.goalError.set(null);
    this.api.createMyGoal({
      title,
      description: this.newGoal.description.trim() || null,
      measurable: this.newGoal.measurable.trim() || null,
      due_date: this.newGoal.due_date || null,
    } as Partial<HrGoal>).subscribe({
      next: () => {
        this.newGoal = { title: '', description: '', measurable: '', due_date: '' };
        this.api.listMyGoals().subscribe(rr => this.myGoals.set(rr.goals));
      },
      error: e => this.goalError.set(e?.error?.error || 'Could not save goal.'),
    });
  }
  updateMyGoal(g: HrGoal, p: Partial<HrGoal>) {
    if (!g.id) return;
    this.api.updateMyGoal(g.id, p).subscribe(() => {
      this.api.listMyGoals().subscribe(rr => this.myGoals.set(rr.goals));
    });
  }
  delMyGoal(g: HrGoal) {
    if (!g.id) return;
    if (!confirm(`Delete goal "${g.title}"?`)) return;
    this.api.deleteMyGoal(g.id).subscribe(() => {
      this.api.listMyGoals().subscribe(rr => this.myGoals.set(rr.goals));
    });
  }

  // ── Self skill assessments ─────────────────────────────────────────────────
  setNewSkill(patch: Partial<{ name: string; category: string; current_level: number; target_level: number; notes: string }>) {
    this.newSkill.set({ ...this.newSkill(), ...patch });
  }
  addMySkill() {
    const f = this.newSkill();
    const name = f.name.trim();
    if (!name) { this.skillError.set('Give the skill a name.'); return; }
    // Block duplicate self-assessments by case-insensitive name match.
    if (this.myOwnSkills().some(s => (s.skill_name || '').toLowerCase() === name.toLowerCase())) {
      this.skillError.set('You already have a row for that skill — edit it instead.');
      return;
    }
    this.skillError.set(null);
    this.api.upsertMyOwnSkill({
      skill_name: name,
      category: f.category.trim() || undefined,
      current_level: f.current_level,
      target_level: f.target_level,
      notes: f.notes.trim() || undefined,
    }).subscribe({
      next: () => {
        this.newSkill.set({ name: '', category: '', current_level: 0, target_level: 5, notes: '' });
        this.api.listMyOwnSkills().subscribe(rr => this.myOwnSkills.set(rr.rows));
        // Refresh catalog too in case a new entry was created.
        this.api.listHrSkills().subscribe(rr => this.skillCatalog.set(rr.skills));
      },
      error: e => this.skillError.set(e?.error?.error || 'Could not add skill.'),
    });
  }
  startEditSkill(s: HrEmployeeSkill) { if (s.id) this.editingSkillId.set(s.id); }
  cancelEditSkill() { this.editingSkillId.set(null); }
  saveSkillEdit(s: HrEmployeeSkill) {
    if (!s.skill_id) return;
    this.api.upsertMyOwnSkill({
      skill_id: s.skill_id,
      current_level: s.current_level ?? 0,
      target_level: s.target_level ?? 0,
      notes: (s.notes ?? '').trim() || undefined,
    }).subscribe({
      next: () => {
        this.editingSkillId.set(null);
        this.api.listMyOwnSkills().subscribe(rr => this.myOwnSkills.set(rr.rows));
      },
    });
  }
  delMySkill(s: HrEmployeeSkill) {
    if (!s.skill_id) return;
    if (!confirm(`Remove "${s.skill_name}" from your skill assessments?`)) return;
    this.api.deleteMyOwnSkill(s.skill_id).subscribe(() => {
      this.api.listMyOwnSkills().subscribe(rr => this.myOwnSkills.set(rr.rows));
    });
  }

  // Pulse surveys + feedback (self-service)
  surveyQuestionsOf(s: HrPulseSurvey): HrSurveyQuestion[] {
    const raw = s.questions_json;
    if (Array.isArray(raw)) return raw;
    try { return JSON.parse((raw as string) || '[]'); } catch { return []; }
  }
  setPulseAnswer(surveyId: number, qid: string, value: number | string) {
    const all = { ...this.pulseAnswers() };
    const cur = { ...(all[surveyId] || {}) };
    cur[qid] = value;
    all[surveyId] = cur;
    this.pulseAnswers.set(all);
  }
  pulseAnswer(surveyId: number, qid: string): number | string | undefined {
    return this.pulseAnswers()[surveyId]?.[qid];
  }
  submitPulse(s: HrPulseSurvey) {
    if (!s.id) return;
    const answers = this.pulseAnswers()[s.id] || {};
    this.api.submitHrMyPulseResponse(s.id, answers).subscribe(() => {
      this.api.listHrMyPulseSurveys().subscribe(rr => this.pulseSurveys.set(rr.surveys));
      const all = { ...this.pulseAnswers() };
      delete all[s.id!];
      this.pulseAnswers.set(all);
    });
  }
  submitFeedback() {
    if (!this.feedbackForm.message.trim()) return;
    this.api.submitHrMyFeedback({ ...this.feedbackForm }).subscribe(() => {
      this.feedbackForm = { message: '', category: 'general', anonymous: false };
      this.feedbackSent.set(true);
      setTimeout(() => this.feedbackSent.set(false), 3000);
    });
  }

  // Reviews
  questionsFor(r: HrReview): HrReviewQuestion[] {
    const raw = r.questions_json;
    if (Array.isArray(raw)) return raw;
    try { return JSON.parse((raw as string) || '[]'); } catch { return []; }
  }
  private parseResponses(raw: any): HrReviewResponses {
    if (!raw) return {};
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(raw); } catch { return {}; }
  }
  startReview(r: HrReview) {
    if (!r.id) return;
    this.reviewResponses.set(this.parseResponses(r.employee_responses_json));
    this.myOverall.set(r.employee_overall ?? null);
    this.reviewEditingId.set(r.id);
  }
  getRating(q: HrReviewQuestion): number | null {
    const v = this.reviewResponses()[q.id];
    return typeof v === 'number' ? v : null;
  }
  getText(q: HrReviewQuestion): string {
    const v = this.reviewResponses()[q.id];
    return typeof v === 'string' ? v : '';
  }
  setRating(q: HrReviewQuestion, n: number) {
    this.reviewResponses.set({ ...this.reviewResponses(), [q.id]: n });
  }
  setText(q: HrReviewQuestion, value: string) {
    this.reviewResponses.set({ ...this.reviewResponses(), [q.id]: value });
  }
  // Profile change requests (self-service)
  submitChangeRequest() {
    this.changeError.set(null);
    if (!this.changeForm.new_value.trim()) { this.changeError.set('Please enter the new value'); return; }
    this.api.createHrMyChangeRequest({ ...this.changeForm }).subscribe({
      next: () => {
        this.changeForm = { field: 'phone', new_value: '', note: '' };
        this.api.listHrMyChangeRequests().subscribe(rr => this.myChangeRequests.set(rr.requests));
      },
      error: e => this.changeError.set(e?.error?.error || 'Failed'),
    });
  }

  // Learning
  playingAssignmentId = signal<number | null>(null);
  setMyAssignmentStatus(a: HrCourseAssignment, status: 'not_started' | 'in_progress' | 'completed') {
    if (!a.id) return;
    this.api.updateHrMyLearningProgress(a.id, { status }).subscribe(() => {
      this.api.listHrMyLearning().subscribe(rr => this.myLearning.set(rr.assignments));
    });
  }
  openCourse(a: HrCourseAssignment) {
    if (!a.id) return;
    this.playingAssignmentId.set(a.id);
  }
  closePlayer() {
    this.playingAssignmentId.set(null);
    this.api.listHrMyLearning().subscribe(rr => this.myLearning.set(rr.assignments));
  }
  onCourseCompleted() {
    this.api.listHrMyLearning().subscribe(rr => this.myLearning.set(rr.assignments));
  }
  certIsExpired(c: HrCertification): boolean {
    if (!c.expires_at) return false;
    return new Date(c.expires_at) < new Date();
  }

  saveReview(r: HrReview, sign: boolean) {
    if (!r.id) return;
    if (sign && !confirm('Submit your self review? Your manager will be notified to complete their part.')) return;
    this.api.submitHrMyReviewResponse(r.id, {
      responses: this.reviewResponses(),
      overall: this.myOverall() ?? undefined,
      sign,
    }).subscribe(() => {
      this.reviewEditingId.set(null);
      this.api.listHrMyReviews().subscribe(rr => this.myReviews.set(rr.reviews));
    });
  }

  submitReq() {
    this.reqError.set(null);
    if (!this.newReq.start_date || !this.newReq.end_date) { this.reqError.set('Pick dates'); return; }
    this.api.createHrMyTimeOff(this.newReq).subscribe({
      next: () => {
        this.newReq = { kind: 'vacation', start_date: '', end_date: '' };
        this.api.listHrMyTimeOff().subscribe(rr => this.myTimeOff.set(rr.entries));
      },
      error: e => this.reqError.set(e?.error?.error || 'Failed'),
    });
  }

  docUrl(d: HrDocument): string {
    return d.file_path ? `${environment.basePath}/${d.file_path.replace(/^\//, '')}` : '';
  }

  startSign(d: HrDocument) { if (d.id) this.signingId.set(d.id); }
  async completeSign(d: HrDocument, dataUrl: string) {
    if (!d.id) return;
    const refresh = () => this.api.listHrMyDocuments().subscribe(rr => this.documents.set(rr.documents));

    if (d.template_blocks_json) {
      try {
        const pages = JSON.parse(d.template_blocks_json);
        if (Array.isArray(pages) && pages.length > 0) {
          const e = this.employee();
          const signerName = `${e?.first_name ?? ''} ${e?.last_name ?? ''}`.trim();
          const { renderPdfDocBlob } = await import('./pdf-doc-renderer');
          const signedBlob = await renderPdfDocBlob(pages, {
            title: d.title || 'Document',
            signatureDataUrl: dataUrl,
            signerName,
          });
          this.api.signHrDocumentWithPdf(d.id, dataUrl, signedBlob).subscribe(() => {
            this.signingId.set(null);
            refresh();
          });
          return;
        }
      } catch (err) {
        console.error('Signed-PDF render failed, falling back to signature-only:', err);
      }
    }

    this.api.signHrDocument(d.id, dataUrl).subscribe(() => {
      this.signingId.set(null);
      refresh();
    });
  }

  printSlip(s: HrPayslip) {
    const e = this.employee();
    if (!e || !s.id) return;
    this.router.navigate(['/hr/payslip', s.period_id, s.id]);
  }
}
