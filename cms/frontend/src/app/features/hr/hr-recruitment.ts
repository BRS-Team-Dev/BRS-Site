import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { environment } from '@env/environment';
import { Api } from '../../core/api';
import { HrApplication, HrApplicationNote, HrCandidate, HrInterview, HrJob, TaskTeam } from '../../core/models';
import { EntityContracts } from '../../shared/entity-contracts';

const STAGES: Array<{ key: HrApplication['stage']; label: string }> = [
  { key: 'applied',    label: 'Applied' },
  { key: 'screening',  label: 'Screening' },
  { key: 'interview',  label: 'Interview' },
  { key: 'offer',      label: 'Offer' },
  { key: 'hired',      label: 'Hired' },
  { key: 'rejected',   label: 'Rejected' },
];

@Component({
  selector: 'app-hr-recruitment',
  imports: [FormsModule, EntityContracts],
  template: `
    <div class="toolbar">
      <h1>Recruitment</h1>
      <span class="spacer"></span>
      <button class="primary" (click)="newJob()">+ New job</button>
    </div>

    <div class="layout">
      <aside class="job-list">
        @for (j of jobs(); track j.id) {
          <button class="job-item" [class.active]="selectedId() === j.id" (click)="select(j)">
            <strong>{{ j.title }}</strong>
            <span class="muted small">{{ j.department || '—' }} · {{ j.location || 'remote' }}</span>
            <span class="status status-{{ j.status }}">{{ j.status }}</span>
            <span class="muted small">{{ j.application_count ?? 0 }} applicants{{ (j.hired_count ?? 0) > 0 ? ' · ' + j.hired_count + ' hired' : '' }}</span>
          </button>
        }
        @if (jobs().length === 0) { <p class="muted small" style="padding: 12px;">No jobs yet.</p> }
      </aside>

      <section class="job-detail">
        @if (selected(); as j) {
          <div class="form-sections">
            <div class="section-card">
              <h3 class="card-title">Job details</h3>
              <div class="meta-row">
                <div class="meta-field">
                  <label>Title</label>
                  <input [ngModel]="j.title" (blur)="patch({ title: $any($event.target).value })" name="j_title" />
                </div>
                <div class="meta-field">
                  <label>Status</label>
                  <select [ngModel]="j.status" (ngModelChange)="patch({ status: $event })" name="j_status">
                    <option value="draft">Draft</option>
                    <option value="open">Open</option>
                    <option value="closed">Closed</option>
                  </select>
                </div>
              </div>
              <div class="meta-row">
                <div class="meta-field">
                  <label>Department</label>
                  <select [ngModel]="j.department" (ngModelChange)="patch({ department: $event })" name="j_dept">
                    <option [ngValue]="null">— none —</option>
                    @for (t of teams(); track t.id) {
                      <option [ngValue]="t.name">{{ t.name }}</option>
                    }
                    @if (j.department && !departmentInTeams(j.department)) {
                      <option [ngValue]="j.department">{{ j.department }} (legacy)</option>
                    }
                  </select>
                </div>
                <div class="meta-field">
                  <label>Location</label>
                  <input [ngModel]="j.location" (blur)="patch({ location: $any($event.target).value })" name="j_loc" placeholder="London / Remote / …" />
                </div>
                <div class="meta-field">
                  <label>Employment type</label>
                  <select [ngModel]="j.employment_type" (ngModelChange)="patch({ employment_type: $event })" name="j_et">
                    <option value="full_time">Full-time</option>
                    <option value="part_time">Part-time</option>
                    <option value="contractor">Contractor</option>
                    <option value="intern">Intern</option>
                  </select>
                </div>
              </div>
              <div class="meta-row">
                <div class="meta-field">
                  <label>Salary min</label>
                  <input type="number" step="500" [ngModel]="j.salary_min" (blur)="patch({ salary_min: +$any($event.target).value })" name="j_smin" placeholder="0" />
                </div>
                <div class="meta-field">
                  <label>Salary max</label>
                  <input type="number" step="500" [ngModel]="j.salary_max" (blur)="patch({ salary_max: +$any($event.target).value })" name="j_smax" placeholder="0" />
                </div>
                <div class="meta-field meta-narrow">
                  <label>Currency</label>
                  <input [ngModel]="j.salary_currency" (blur)="patch({ salary_currency: $any($event.target).value })" name="j_scur" placeholder="GBP" />
                </div>
              </div>
              <div class="meta-row">
                <div class="meta-field">
                  <label>Description</label>
                  <textarea rows="4" [ngModel]="j.description" (blur)="patch({ description: $any($event.target).value })" name="j_desc" placeholder="Short write-up — what the role is for, who the hire reports to, scope."></textarea>
                </div>
              </div>

              <div class="meta-row">
                <div class="meta-field">
                  <label>Responsibilities <span class="muted small">({{ respBullets().length }} bullet{{ respBullets().length === 1 ? '' : 's' }})</span></label>
                  <textarea rows="3" [ngModel]="respSummary()" (ngModelChange)="respSummary.set($event)"
                            (blur)="saveResp()" name="r_summary"
                            placeholder="Short write-up — overview of what the hire owns and the day-to-day."></textarea>
                  @if (respBullets().length > 0) {
                    <ul class="bullet-list">
                      @for (b of respBullets(); track $index; let i = $index) {
                        <li class="bullet">
                          <span class="bullet-mark">•</span>
                          <input [ngModel]="b" (ngModelChange)="setRespBullet(i, $event)"
                                 (blur)="saveResp()" name="r_b_{{ i }}"
                                 placeholder="e.g. Lead the X team" />
                          <button type="button" class="ghost icon-btn danger" (click)="removeRespBullet(i)" title="Remove">✕</button>
                        </li>
                      }
                    </ul>
                  }
                  <div class="row">
                    <button type="button" class="ghost" (click)="addRespBullet()">+ Add bullet</button>
                  </div>
                </div>
              </div>

              <div class="meta-row">
                <div class="meta-field">
                  <label>Benefits <span class="muted small">({{ benefitBullets().length }} bullet{{ benefitBullets().length === 1 ? '' : 's' }})</span></label>
                  <textarea rows="3" [ngModel]="benefitSummary()" (ngModelChange)="benefitSummary.set($event)"
                            (blur)="saveBenefit()" name="b_summary"
                            placeholder="Short write-up — what's in it for the hire (perks, culture, growth)."></textarea>
                  @if (benefitBullets().length > 0) {
                    <ul class="bullet-list">
                      @for (b of benefitBullets(); track $index; let i = $index) {
                        <li class="bullet">
                          <span class="bullet-mark">•</span>
                          <input [ngModel]="b" (ngModelChange)="setBenefitBullet(i, $event)"
                                 (blur)="saveBenefit()" name="b_b_{{ i }}"
                                 placeholder="e.g. 25 days holiday + bank holidays" />
                          <button type="button" class="ghost icon-btn danger" (click)="removeBenefitBullet(i)" title="Remove">✕</button>
                        </li>
                      }
                    </ul>
                  }
                  <div class="row">
                    <button type="button" class="ghost" (click)="addBenefitBullet()">+ Add bullet</button>
                  </div>
                </div>
              </div>
              @if (j.status === 'open' && j.slug) {
                <div class="row public-link-row">
                  <span class="muted small">Public posting:</span>
                  <a class="ghost" [href]="publicJobUrl(j)" target="_blank" rel="noopener">↗ View at /jobs/{{ j.slug }}</a>
                  <span class="spacer"></span>
                  <button class="ghost" type="button" (click)="copyJobLink(j)" title="Copy public link">📋 Copy link</button>
                </div>
              } @else if (j.status !== 'open') {
                <p class="muted small no-notes">Set status to <strong>Open</strong> to publish this job at <code>/jobs/{{ j.slug }}</code>.</p>
              }

              <div class="row danger-zone">
                <span class="muted small">Removing the job also removes every applicant tied to it.</span>
                <span class="spacer"></span>
                <button class="ghost danger" (click)="delJob(j)">✕ Delete job</button>
              </div>
            </div>

            <div class="section-card">
              <h3 class="card-title">Add a candidate</h3>
              <div class="meta-row">
                <div class="meta-field"><label>First name</label><input [(ngModel)]="newCand.first_name" name="cf" /></div>
                <div class="meta-field"><label>Last name</label><input [(ngModel)]="newCand.last_name"  name="cl" /></div>
                <div class="meta-field"><label>Email</label><input type="email" [(ngModel)]="newCand.email" name="ce" placeholder="email@example.com" /></div>
                <div class="meta-field"><label>Source</label><input [(ngModel)]="newCand.source" name="cs" placeholder="LinkedIn, referral…" /></div>
              </div>
              @if (candError()) { <p class="err">{{ candError() }}</p> }
              <div class="row">
                <button class="primary" (click)="addCandidate()" [disabled]="!newCand.first_name.trim() || !newCand.email.trim()">+ Add candidate</button>
              </div>
            </div>

            <div class="section-card">
              <h3 class="card-title">Candidate pipeline <span class="muted small">({{ pipeline().length }})</span></h3>
              <p class="muted small no-notes">Drag candidates between stages. Click <strong>→ Hire</strong> to convert to an onboarding employee record.</p>
              <div class="pipeline" (dragover)="$event.preventDefault()">
                @for (s of stages; track s.key) {
                  <div class="col"
                       [class.drag-over]="dragOverStage() === s.key"
                       (dragover)="onDragOver(s.key, $event)"
                       (drop)="dropOnStage(s.key)">
                    <div class="col-head">
                      <span class="stage-pill stage-{{ s.key }}">{{ s.label }}</span>
                      <span class="muted small">{{ stageItems(s.key).length }}</span>
                    </div>
                    <div class="col-list">
                      @for (a of stageItems(s.key); track a.id) {
                        <div class="cand-card"
                             draggable="true"
                             (click)="openCandidate(a)"
                             (dragstart)="onDragStart(a)"
                             (dragend)="onDragEnd()"
                             [class.dragging]="draggingId() === a.id">
                          <div class="cand-head">
                            <strong>{{ a.first_name }} {{ a.last_name }}</strong>
                            @if (a.rating) { <span class="rating">{{ a.rating }}/5</span> }
                          </div>
                          <div class="muted small">{{ a.email }}</div>
                          @if (a.source) { <div class="muted small">via {{ a.source }}</div> }
                          <div class="actions">
                            @if (nextStage(a.stage); as ns) {
                              <button class="ghost" (click)="advance(a, $event)" [title]="'Move to ' + stageLabel(ns)">→ {{ stageLabel(ns) }}</button>
                            }
                            <button class="ghost icon-btn danger" (click)="delApp(a); $event.stopPropagation()" title="Remove">✕</button>
                          </div>
                        </div>
                      }
                      @if (stageItems(s.key).length === 0) { <div class="col-empty muted small">Drop here</div> }
                    </div>
                  </div>
                }
              </div>
            </div>
          </div>
        } @else {
          <p class="muted small empty-state">Select a job on the left, or click <strong>+ New job</strong> to create one.</p>
        }
      </section>
    </div>

    @if (viewingApp(); as v) {
      <div class="modal-backdrop" (click)="closeCandidate()">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-head">
            <div>
              <h2>{{ v.first_name }} {{ v.last_name }}</h2>
              <div class="muted small">
                <span class="stage-pill stage-{{ v.stage }}">{{ stageLabel(v.stage) }}</span>
                @if (v.applied_at) { · Applied {{ shortDate(v.applied_at) }} }
                @if (v.source) { · via {{ v.source }} }
              </div>
            </div>
            <button class="ghost icon-btn" (click)="closeCandidate()" title="Close">✕</button>
          </div>

          <div class="modal-body">
            <dl class="kv">
              <div class="kv-row"><dt>Email</dt><dd>@if (v.email) { <a [href]="'mailto:' + v.email">{{ v.email }}</a> } @else { — }</dd></div>
              <div class="kv-row"><dt>Phone</dt><dd>{{ v.phone || '—' }}</dd></div>
              <div class="kv-row"><dt>LinkedIn</dt><dd>@if (v.linkedin_url) { <a [href]="v.linkedin_url" target="_blank" rel="noopener">{{ v.linkedin_url }}</a> } @else { — }</dd></div>
              <div class="kv-row"><dt>CV</dt><dd>@if (v.cv_path) { <a [href]="cvUrl(v.cv_path)" target="_blank" rel="noopener">↗ Open CV</a> } @else { <span class="muted">No CV uploaded</span> }</dd></div>
              <div class="kv-row"><dt>Source</dt><dd>{{ v.source || '—' }}</dd></div>
              <div class="kv-row"><dt>Applied</dt><dd>{{ v.applied_at ? shortDate(v.applied_at) : '—' }}</dd></div>
              @if (v.decided_at) {
                <div class="kv-row"><dt>Decided</dt><dd>{{ shortDate(v.decided_at) }}</dd></div>
              }
            </dl>

            <div class="section-card">
              <h3 class="card-title">Recruiter</h3>
              <div class="meta-row">
                <div class="meta-field">
                  <label>Stage</label>
                  <select [ngModel]="v.stage" (ngModelChange)="patchCandidate({ stage: $event })" name="v_stage">
                    @for (s of stages; track s.key) {
                      <option [ngValue]="s.key">{{ s.label }}</option>
                    }
                  </select>
                </div>
                <div class="meta-field meta-narrow">
                  <label>Rating</label>
                  <select [ngModel]="v.rating" (ngModelChange)="patchCandidate({ rating: $event === null ? null : +$event })" name="v_rating">
                    <option [ngValue]="null">—</option>
                    <option [ngValue]="1">1</option>
                    <option [ngValue]="2">2</option>
                    <option [ngValue]="3">3</option>
                    <option [ngValue]="4">4</option>
                    <option [ngValue]="5">5</option>
                  </select>
                </div>
              </div>
            </div>

            <div class="section-card">
              <h3 class="card-title">Contracts</h3>
              <app-entity-contracts audience="applicant" [entityId]="v.candidate_id"></app-entity-contracts>
            </div>

            <div class="section-card">
              <h3 class="card-title">Notes <span class="muted small">({{ viewingNotes().length }})</span></h3>
              @if (v.recruiter_notes) {
                <div class="cover-note">
                  <span class="muted small">Cover note from application</span>
                  <p>{{ v.recruiter_notes }}</p>
                </div>
              }
              @if (viewingNotes().length === 0 && !v.recruiter_notes) {
                <p class="muted small no-notes">No notes yet. Leave the first one below.</p>
              }
              @if (viewingNotes().length > 0) {
                <ul class="note-list">
                  @for (n of viewingNotes(); track n.id) {
                    <li class="note-item">
                      <div class="note-head">
                        <strong>{{ n.author_name || 'Recruiter' }}</strong>
                        <span class="muted small">· {{ shortDateTime(n.created_at) }}</span>
                        <span class="spacer"></span>
                        <button type="button" class="ghost icon-btn danger" (click)="deleteNote(n)" title="Delete note">✕</button>
                      </div>
                      <p class="note-body">{{ n.body }}</p>
                    </li>
                  }
                </ul>
              }
              <div class="add-note">
                <textarea rows="3"
                          [ngModel]="newNoteBody()"
                          (ngModelChange)="newNoteBody.set($event)"
                          name="v_new_note"
                          placeholder="Leave a note for the recruiting team…"></textarea>
                <div class="row">
                  <span class="spacer"></span>
                  <button type="button" class="primary" (click)="addNote()" [disabled]="!newNoteBody().trim()">+ Add note</button>
                </div>
              </div>
            </div>

            <div class="section-card">
              <h3 class="card-title">Interviews <span class="muted small">({{ viewingInterviews().length }})</span></h3>
              @if (viewingInterviews().length === 0) {
                <p class="muted small no-notes">No interviews scheduled yet.</p>
              } @else {
                <ul class="kv-list">
                  @for (i of viewingInterviews(); track i.id) {
                    <li>
                      <strong>{{ shortDateTime(i.scheduled_at) }}</strong>
                      @if (i.kind) { <span class="muted small"> · {{ i.kind }}</span> }
                      @if (i.interviewer_name) { <span class="muted small"> · {{ i.interviewer_name }}</span> }
                      @if (i.rating) { <span class="rating">{{ i.rating }}/5</span> }
                      @if (i.feedback) { <div class="ref-notes">{{ i.feedback }}</div> }
                    </li>
                  }
                </ul>
              }
            </div>
          </div>

          <div class="modal-foot">
            @if (nextStage(v.stage); as ns) {
              <button class="primary" (click)="advance(v); closeCandidate()">→ {{ stageLabel(ns) }}</button>
            }
            <span class="spacer"></span>
            <button class="ghost danger" (click)="delApp(v); closeCandidate()">✕ Remove</button>
            <button class="ghost" (click)="closeCandidate()">Close</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .toolbar { padding: 16px 20px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--line); }
    .toolbar h1 { margin: 0; font-size: 22px; }
    .spacer { flex: 1; }

    .layout {
      display: grid; grid-template-columns: 280px 1fr;
      background: #ffffff; min-height: calc(100vh - 120px);
    }
    .job-list {
      padding: 12px;
      display: flex; flex-direction: column; gap: 6px;
      align-self: start;
    }
    .job-item {
      display: flex; flex-direction: column; gap: 4px;
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
      padding: 10px 12px; text-align: left; color: var(--fg); cursor: pointer;
    }
    .job-item:hover { border-color: var(--primary); }
    .job-item.active { border-color: var(--primary); background: var(--bg-3); }

    .status {
      align-self: flex-start; padding: 1px 6px; border-radius: 4px;
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      border: 1px solid var(--line);
    }
    .status-draft  { color: var(--muted); }
    .status-open   { color: var(--primary); border-color: var(--primary); background: rgba(212,169,58,0.12); }
    .status-closed { color: var(--muted); opacity: 0.7; }

    .job-detail { padding: 20px 24px 32px; overflow-x: hidden; }
    .empty-state { padding: 40px 20px; text-align: center; }

    /* Canonical section-card pattern (memory.md). */
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
    .meta-field.meta-narrow { flex: 0 0 120px; min-width: 120px; }
    .meta-field label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; margin: 0; }
    .meta-field input, .meta-field select, .meta-field textarea { width: 100%; }

    .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .err { color: #ef4444; font-size: 13px; margin: 0; }
    .danger-zone { padding-top: 10px; border-top: 1px dashed var(--line); }

    /* Bullet-list editor — used for Responsibilities + Benefits.
       Each section is its own full-width meta-row containing a write-up
       textarea + a list of bullets. Persisted as JSON {summary, bullets}
       in the existing TEXT column. */
    .bullet-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .bullet { display: grid; grid-template-columns: 14px 1fr auto; gap: 8px; align-items: center; }
    .bullet-mark { color: var(--primary); font-size: 16px; line-height: 1; text-align: center; }
    .bullet input { width: 100%; }

    /* Pipeline kanban — cards live inside the section-card. */
    .pipeline {
      display: grid; grid-template-columns: repeat(6, minmax(180px, 1fr));
      gap: 10px; overflow-x: auto;
    }
    .col {
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
      min-height: 320px; display: flex; flex-direction: column;
      transition: background 0.15s, border-color 0.15s;
    }
    .col.drag-over { background: var(--bg-3); border-color: var(--primary); box-shadow: inset 0 0 0 1px var(--primary); }
    .col-head { padding: 10px 12px; border-bottom: 1px solid var(--line); display: flex; align-items: center; gap: 8px; }
    .stage-pill {
      padding: 2px 10px; border-radius: 999px;
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      border: 1px solid var(--line);
    }
    .stage-applied   { color: var(--muted); }
    .stage-screening { color: var(--primary); border-color: var(--primary); }
    .stage-interview { color: var(--primary); border-color: var(--primary); }
    .stage-offer     { color: var(--primary); border-color: var(--primary); }
    .stage-hired     { color: #10b981; border-color: #10b981; }
    .stage-rejected  { color: #ef4444; border-color: #ef4444; }

    .col-list { padding: 8px; display: flex; flex-direction: column; gap: 8px; flex: 1; }
    .col-empty { padding: 16px; text-align: center; }
    .cand-card {
      background: var(--bg-3); border: 1px solid var(--line); border-radius: var(--radius-sm);
      padding: 10px 12px; cursor: grab;
    }
    .cand-card:hover { border-color: var(--primary); }
    .cand-card.dragging { opacity: 0.4; border-style: dashed; }
    .cand-head { display: flex; align-items: center; gap: 8px; }
    .cand-head .rating { margin-left: auto; padding: 1px 6px; border-radius: 4px; background: rgba(212, 169, 58, 0.18); color: var(--primary); font-size: 11px; font-weight: 700; }
    .cand-card .actions { margin-top: 8px; display: flex; gap: 6px; align-items: center; }
    .cand-card .actions .ghost { padding: 4px 8px; font-size: 11px; }

    /* Candidate detail modal — same pattern as hr-onboarding's section modal. */
    .modal-backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,0.6);
      display: flex; align-items: center; justify-content: center; z-index: 100;
    }
    .modal {
      width: 720px; max-width: 92vw; max-height: 92vh;
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius);
      display: flex; flex-direction: column; overflow: hidden;
    }
    .modal-head { display: flex; align-items: flex-start; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid var(--line); flex: 0 0 auto; gap: 12px; }
    .modal-head h2 { margin: 0 0 4px; font-size: 16px; }
    .modal-body { padding: 16px 18px; flex: 1 1 auto; overflow: auto; display: flex; flex-direction: column; gap: 14px; }
    .modal-foot { padding: 14px 18px; border-top: 1px solid var(--line); display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
    .modal-foot button.danger { background: rgba(239,68,68,0.10); color: #ef4444; border-color: #ef4444; }
    .modal-foot button.danger:hover { background: rgba(239,68,68,0.20); }

    .kv { margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .kv-row {
      display: grid; grid-template-columns: 140px 1fr; gap: 12px;
      padding: 6px 8px; background: var(--bg-3); border: 1px solid var(--line); border-radius: var(--radius-sm);
    }
    .kv-row dt { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; margin: 0; }
    .kv-row dd { margin: 0; font-size: 13px; word-break: break-word; }
    .kv-row a { color: var(--primary); text-decoration: none; }
    .kv-row a:hover { text-decoration: underline; }

    .kv-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .kv-list li { padding: 8px 10px; background: var(--bg-3); border: 1px solid var(--line); border-radius: var(--radius-sm); position: relative; }
    .kv-list .rating { margin-left: 8px; padding: 1px 6px; border-radius: 4px; background: rgba(212, 169, 58, 0.18); color: var(--primary); font-size: 11px; font-weight: 700; }
    .ref-notes { margin-top: 4px; font-size: 12px; color: var(--muted); white-space: pre-wrap; }

    /* Notes thread on the candidate detail panel. */
    .cover-note {
      padding: 8px 10px; background: var(--bg-2); border: 1px dashed var(--line); border-radius: var(--radius-sm);
    }
    .cover-note p { margin: 4px 0 0; font-size: 13px; white-space: pre-wrap; }
    .note-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .note-item {
      padding: 8px 10px; background: var(--bg-3); border: 1px solid var(--line); border-radius: var(--radius-sm);
    }
    .note-head { display: flex; align-items: center; gap: 6px; }
    .note-body { margin: 4px 0 0; font-size: 13px; white-space: pre-wrap; }
    .add-note { display: flex; flex-direction: column; gap: 6px; }
    .add-note textarea { width: 100%; }
  `],
})
export class HrRecruitment {
  private api = inject(Api);
  private router = inject(Router);

  readonly stages = STAGES;

  jobs = signal<HrJob[]>([]);
  selectedId = signal<number | null>(null);
  pipeline = signal<HrApplication[]>([]);
  /** Org teams used to populate the Department dropdown — sourced from the
   *  task_teams catalog so HR / Tasks / Recruitment all read the same list. */
  teams = signal<TaskTeam[]>([]);

  newCand: { first_name: string; last_name: string; email: string; source: string } =
    { first_name: '', last_name: '', email: '', source: '' };
  candError = signal<string | null>(null);

  draggingId = signal<number | null>(null);
  dragOverStage = signal<HrApplication['stage'] | null>(null);
  private dragging: HrApplication | null = null;
  /** Suppresses the click-to-open-panel that would otherwise fire after a drag. */
  private suppressClick = false;

  selected = computed(() => this.jobs().find(j => j.id === this.selectedId()) ?? null);

  // ── Candidate detail panel ────────────────────────────────────────────────
  viewingApp = signal<HrApplication | null>(null);
  viewingInterviews = signal<HrInterview[]>([]);
  viewingNotes = signal<HrApplicationNote[]>([]);
  newNoteBody = signal<string>('');

  openCandidate(a: HrApplication, ev?: Event) {
    if (ev) ev.stopPropagation();
    if (this.suppressClick) { this.suppressClick = false; return; }
    if (!a.id) return;
    // Optimistically use the row from the pipeline (already joined with the
    // candidate fields), then fetch the canonical version + interviews so the
    // panel always reflects the latest server state.
    this.viewingApp.set(a);
    this.viewingInterviews.set([]);
    this.viewingNotes.set([]);
    this.newNoteBody.set('');
    this.api.getHrApplication(a.id).subscribe(r => {
      this.viewingApp.set(r.application);
      this.viewingInterviews.set(r.interviews);
      this.viewingNotes.set(r.notes ?? []);
    });
  }
  closeCandidate() {
    this.viewingApp.set(null);
    this.viewingInterviews.set([]);
    this.viewingNotes.set([]);
    this.newNoteBody.set('');
  }

  addNote() {
    const a = this.viewingApp();
    const body = this.newNoteBody().trim();
    if (!a?.id || body === '') return;
    this.api.addHrApplicationNote(a.id, body).subscribe(() => {
      this.newNoteBody.set('');
      this.api.getHrApplication(a.id!).subscribe(r => this.viewingNotes.set(r.notes ?? []));
    });
  }
  deleteNote(n: HrApplicationNote) {
    const a = this.viewingApp();
    if (!a?.id || !n.id) return;
    if (!confirm('Delete this note?')) return;
    this.api.deleteHrApplicationNote(a.id, n.id).subscribe(() => {
      this.viewingNotes.update(list => list.filter(x => x.id !== n.id));
    });
  }
  patchCandidate(p: Partial<HrApplication>) {
    const a = this.viewingApp();
    if (!a?.id) return;
    this.api.updateHrApplication(a.id, p).subscribe(() => {
      // Local merge so the open panel reflects the new value without flicker.
      this.viewingApp.set({ ...a, ...p });
      // Refresh the kanban so card fields (rating, stage) stay in sync.
      if (this.selectedId()) {
        this.api.getHrJobPipeline(this.selectedId()!).subscribe(r => this.pipeline.set(r.applications));
      }
    });
  }
  /** Public path for serving an uploaded CV (matches the docUrl convention). */
  cvUrl(path: string | null | undefined): string {
    return path ? `${environment.basePath}/${path.replace(/^\//, '')}` : '';
  }
  stageLabel(s: HrApplication['stage'] | undefined): string {
    return STAGES.find(x => x.key === s)?.label ?? (s ?? '');
  }
  /** Linear forward path through the pipeline, skipping the 'rejected' branch.
   *  Returns null at the end states (hired / rejected) so the card hides the button. */
  nextStage(stage: HrApplication['stage'] | undefined): HrApplication['stage'] | null {
    switch (stage) {
      case 'applied':   return 'screening';
      case 'screening': return 'interview';
      case 'interview': return 'offer';
      case 'offer':     return 'hired';
      default:          return null;
    }
  }
  advance(a: HrApplication, ev?: Event) {
    if (ev) ev.stopPropagation();
    const n = this.nextStage(a.stage);
    if (!n || !a.id) return;
    // Moving into 'hired' creates the employee record + admin user via the
    // existing hire flow rather than just flipping the stage.
    if (n === 'hired') { this.hire(a); return; }
    this.api.updateHrApplication(a.id, { stage: n }).subscribe(() => this.refreshPipeline());
  }
  shortDate(s: string | null | undefined): string {
    if (!s) return '';
    const d = new Date(s.includes('T') ? s : s.replace(' ', 'T'));
    return isNaN(d.getTime()) ? String(s) : d.toLocaleDateString();
  }
  shortDateTime(s: string | null | undefined): string {
    if (!s) return '';
    const d = new Date(s.includes('T') ? s : s.replace(' ', 'T'));
    return isNaN(d.getTime()) ? String(s) : `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }

  /**
   * Drafts for Responsibilities and Benefits sections. Each section has a
   * short write-up summary + an ordered list of bullets. Stored in the DB as
   * a JSON-encoded `{ summary, bullets }` object in the existing TEXT column;
   * we parse on select and serialize on save. Older raw-string values load
   * cleanly as a single-bullet fallback.
   */
  respSummary = signal<string>('');
  respBullets = signal<string[]>([]);
  benefitSummary = signal<string>('');
  benefitBullets = signal<string[]>([]);
  private hydratedJobId: number | null = null;

  private parseSection(raw: string | null | undefined): { summary: string; bullets: string[] } {
    if (!raw) return { summary: '', bullets: [] };
    try {
      const v = JSON.parse(raw);
      // Modern shape: { summary, bullets }
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        return {
          summary: typeof v.summary === 'string' ? v.summary : '',
          bullets: Array.isArray(v.bullets) ? v.bullets.map(String) : [],
        };
      }
      // Legacy shape: string[] — treat as bullets only, no summary.
      if (Array.isArray(v)) return { summary: '', bullets: v.map(String) };
    } catch { /* fall through to plain-text fallback */ }
    // Pre-existing plain-text content — keep as the summary, no bullets.
    return { summary: String(raw), bullets: [] };
  }
  private syncBulletsFromJob() {
    const j = this.selected();
    if (!j) {
      this.respSummary.set(''); this.respBullets.set([]);
      this.benefitSummary.set(''); this.benefitBullets.set([]);
      this.hydratedJobId = null;
      return;
    }
    if (this.hydratedJobId === j.id) return; // don't clobber in-progress edits on refresh
    const r = this.parseSection(j.responsibilities);
    const b = this.parseSection(j.benefits);
    this.respSummary.set(r.summary); this.respBullets.set(r.bullets);
    this.benefitSummary.set(b.summary); this.benefitBullets.set(b.bullets);
    this.hydratedJobId = j.id ?? null;
  }
  /** Persist the current section state back to the job as a JSON-encoded {summary, bullets}. */
  private saveSectionField(field: 'responsibilities' | 'benefits', summary: string, bullets: string[]) {
    const cleanedBullets = bullets.map(b => b.trim()).filter(b => b !== '');
    const cleanedSummary = summary.trim();
    const value = (!cleanedSummary && cleanedBullets.length === 0)
      ? null
      : JSON.stringify({ summary: cleanedSummary, bullets: cleanedBullets });
    this.patch({ [field]: value } as Partial<HrJob>);
  }
  addRespBullet()    { this.respBullets.update(list => [...list, '']); }
  addBenefitBullet() { this.benefitBullets.update(list => [...list, '']); }
  setRespBullet(idx: number, value: string) {
    this.respBullets.update(list => list.map((b, i) => i === idx ? value : b));
  }
  setBenefitBullet(idx: number, value: string) {
    this.benefitBullets.update(list => list.map((b, i) => i === idx ? value : b));
  }
  removeRespBullet(idx: number) {
    this.respBullets.update(list => list.filter((_, i) => i !== idx));
    this.saveResp();
  }
  removeBenefitBullet(idx: number) {
    this.benefitBullets.update(list => list.filter((_, i) => i !== idx));
    this.saveBenefit();
  }
  saveResp()    { this.saveSectionField('responsibilities', this.respSummary(),    this.respBullets()); }
  saveBenefit() { this.saveSectionField('benefits',         this.benefitSummary(), this.benefitBullets()); }

  ngOnInit() {
    this.refreshJobs();
    this.api.listTaskTeams().subscribe(r => this.teams.set(r.teams));
  }

  /** Used to keep a legacy free-text department visible in the dropdown so existing
   *  jobs don't appear unset just because their value isn't in the team catalog. */
  departmentInTeams(name: string | null | undefined): boolean {
    if (!name) return false;
    return this.teams().some(t => t.name === name);
  }

  /** Public-facing URL for an open posting; respects the /builtrightstudio base path
   *  used in dev (matches the same base that hr-onboarding.ts portalUrl uses). */
  publicJobUrl(j: HrJob): string {
    if (!j.slug) return '';
    const base = location.origin + (location.pathname.startsWith('/builtrightstudio') ? '/builtrightstudio' : '');
    return `${base}/jobs/${j.slug}`;
  }
  copyJobLink(j: HrJob) {
    const url = this.publicJobUrl(j);
    if (!url) return;
    navigator.clipboard?.writeText(url).then(
      () => alert('Public job link copied to clipboard:\n' + url),
      () => alert(url),
    );
  }

  refreshJobs() {
    this.api.listHrJobs().subscribe(r => {
      this.jobs.set(r.jobs);
      if (this.selectedId() === null && r.jobs.length > 0) this.select(r.jobs[0]);
    });
  }

  select(j: HrJob) {
    // Reset the hydration guard so the new job's bullets are loaded from its row.
    this.hydratedJobId = null;
    this.selectedId.set(j.id ?? null);
    this.syncBulletsFromJob();
    if (j.id) this.api.getHrJobPipeline(j.id).subscribe(r => this.pipeline.set(r.applications));
  }

  newJob() {
    this.api.createHrJob({ title: 'New job', employment_type: 'full_time', status: 'draft', salary_currency: 'GBP' }).subscribe(r => {
      this.api.listHrJobs().subscribe(rr => {
        this.jobs.set(rr.jobs);
        const j = rr.jobs.find(x => x.id === r.id);
        if (j) this.select(j);
      });
    });
  }

  patch(p: Partial<HrJob>) {
    const id = this.selectedId();
    if (!id) return;
    this.api.updateHrJob(id, p).subscribe(() => this.refreshJobs());
  }
  delJob(j: HrJob) {
    if (!j.id) return;
    if (!confirm(`Delete "${j.title}"?`)) return;
    this.api.deleteHrJob(j.id).subscribe(() => {
      this.selectedId.set(null);
      this.pipeline.set([]);
      this.refreshJobs();
    });
  }

  addCandidate() {
    this.candError.set(null);
    if (!this.newCand.first_name.trim() || !this.newCand.last_name.trim() || !/^[^@]+@[^@]+\.[^@]+$/.test(this.newCand.email)) {
      this.candError.set('First name, last name, and a valid email are required.');
      return;
    }
    const jid = this.selectedId();
    if (!jid) return;
    this.api.createHrCandidate({
      first_name: this.newCand.first_name.trim(),
      last_name:  this.newCand.last_name.trim(),
      email:      this.newCand.email.trim(),
      source:     this.newCand.source.trim() || null,
    }).subscribe({
      next: r => {
        this.api.applyHrCandidate(jid, r.id).subscribe(() => {
          this.newCand = { first_name: '', last_name: '', email: '', source: '' };
          this.refreshPipeline();
          this.refreshJobs();
        });
      },
      error: e => this.candError.set(e?.error?.error || 'Failed'),
    });
  }

  refreshPipeline() {
    const id = this.selectedId();
    if (id) this.api.getHrJobPipeline(id).subscribe(r => this.pipeline.set(r.applications));
  }

  /** Pre-grouped pipeline by stage. Built once per `pipeline()` change so
   *  the kanban template doesn't re-filter the array twice per stage on
   *  every signal-driven render. */
  byStage = computed<Record<NonNullable<HrApplication['stage']>, HrApplication[]>>(() => {
    const out: Record<string, HrApplication[]> = {
      applied: [], screening: [], interview: [], offer: [], hired: [], rejected: [],
    };
    for (const a of this.pipeline()) {
      const s = a.stage ?? 'applied';
      (out[s] ??= []).push(a);
    }
    return out as Record<NonNullable<HrApplication['stage']>, HrApplication[]>;
  });
  stageItems(stage: HrApplication['stage']): HrApplication[] {
    return this.byStage()[stage ?? 'applied'] ?? [];
  }

  // Drag-drop
  onDragStart(a: HrApplication) {
    this.dragging = a;
    this.draggingId.set(a.id ?? null);
  }
  onDragEnd() {
    this.dragging = null;
    this.draggingId.set(null);
    this.dragOverStage.set(null);
    // Drag fires a click on dragend; swallow the next one so the panel doesn't open.
    this.suppressClick = true;
  }
  onDragOver(stage: HrApplication['stage'], e: DragEvent) {
    e.preventDefault();
    if (this.draggingId() !== null && this.dragOverStage() !== stage) this.dragOverStage.set(stage);
  }
  dropOnStage(stage: HrApplication['stage']) {
    const a = this.dragging;
    this.onDragEnd();
    if (!a?.id || a.stage === stage) return;
    this.api.updateHrApplication(a.id, { stage }).subscribe(() => this.refreshPipeline());
  }

  hire(a: HrApplication) {
    if (!a.id) return;
    if (!confirm(`Hire ${a.first_name} ${a.last_name}? An employee record will be created and linked to a new admin user.`)) return;
    this.api.hireHrApplication(a.id).subscribe(r => {
      this.refreshPipeline();
      this.refreshJobs();
      this.router.navigate(['/hr/employees', r.employee_id]);
    });
  }
  delApp(a: HrApplication) {
    if (!a.id) return;
    if (!confirm('Remove this application?')) return;
    this.api.deleteHrApplication(a.id).subscribe(() => this.refreshPipeline());
  }
}
