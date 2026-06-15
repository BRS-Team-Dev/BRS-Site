import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { Client, RecruitmentCandidate, RecruitmentPlacement, RecruitmentRole } from '../../core/models';

/**
 * /recruitment/clients/:id — Recruitment-flavored view of one client.
 * Reuses the shared `clients` row (same record as CRM) but renders only
 * the recruitment-relevant facets: contact info + every placement that
 * touched this client, grouped by status (active vs ended vs rejected).
 *
 * Full client editing lives at /admin/clients/:id (CRM) — this page
 * deep-links there for the "Edit" action.
 */
@Component({
  selector: 'app-recruitment-client-detail',
  imports: [RouterLink, FormsModule],
  template: `
    <div class="toolbar">
      <button class="ghost" routerLink="/recruitment/clients">← Back</button>
      <h1>{{ client()?.name || '—' }}</h1>
      <span class="spacer"></span>
      <a class="ghost edit-link" [routerLink]="['/admin/clients', clientId()]">✎ Edit in CRM</a>
    </div>

    @if (loading()) {
      <p class="muted pad">Loading…</p>
    } @else if (!client()) {
      <p class="muted pad">Client not found.</p>
    } @else if (client(); as c) {
      <div class="grid-2">
        <section class="card">
          <h3>Contact</h3>
          <dl class="kv">
            <dt>Company</dt><dd>{{ c.company || '—' }}</dd>
            <dt>Email</dt><dd>{{ c.email || '—' }}</dd>
            <dt>Phone</dt><dd>{{ c.phone || '—' }}</dd>
            <dt>Website</dt><dd>
              @if (c.url) {
                <a [href]="c.url" target="_blank" rel="noopener">{{ c.url }}</a>
              } @else { — }
            </dd>
            <dt>Address</dt><dd>{{ c.address || '—' }}</dd>
          </dl>
          @if (c.notes) {
            <h3>Notes</h3>
            <p class="muted">{{ c.notes }}</p>
          }
        </section>

        <section class="card">
          <h3>Placement summary</h3>
          <div class="stat-row">
            <div class="stat">
              <div class="num">{{ activePlacements().length }}</div>
              <div class="label">Active</div>
            </div>
            <div class="stat">
              <div class="num">{{ endedPlacements().length }}</div>
              <div class="label">Ended</div>
            </div>
            <div class="stat warn">
              <div class="num">{{ rejectedPlacements().length }}</div>
              <div class="label">Rejected</div>
            </div>
          </div>
        </section>
      </div>

      <div class="tab-nav">
        <button class="tab-btn" [class.active]="tab() === 'roles'" (click)="tab.set('roles')">
          Roles <span class="badge">{{ roles().length }}</span>
        </button>
        <button class="tab-btn" [class.active]="tab() === 'vetting'" (click)="tab.set('vetting')">
          Vetting <span class="badge">{{ vettingPlacements().length }}</span>
        </button>
        <button class="tab-btn" [class.active]="tab() === 'placed'" (click)="tab.set('placed')">
          Placed <span class="badge">{{ placedAndEnded().length }}</span>
        </button>
        <button class="tab-btn" [class.active]="tab() === 'rejected'" (click)="tab.set('rejected')">
          Rejected <span class="badge" [class.warn]="rejectedPlacements().length > 0">{{ rejectedPlacements().length }}</span>
        </button>
        <span class="spacer"></span>
        @if (tab() === 'roles') {
          <button class="primary add-btn" (click)="openAddRole()">+ New role</button>
        } @else {
          <button class="primary add-btn" (click)="openAddPlacement()">+ Add candidate</button>
        }
      </div>

      @if (tab() === 'roles') {
        @if (roles().length === 0) {
          <p class="muted pad">No roles defined yet for this client. Add one to start tracking candidates against it.</p>
        } @else {
          <div class="placement-list">
            @for (r of roles(); track r.id) {
              <section class="role-card" [attr.data-status]="r.status">
                <header class="role-head" (click)="toggleRoleExpanded(r.id!)">
                  <span class="caret">{{ roleExpanded().has(r.id!) ? '▾' : '▸' }}</span>
                  <strong class="role-title">{{ r.title }}</strong>
                  <span class="status-pill" [attr.data-role-status]="r.status">{{ r.status }}</span>
                  @if (r.target_start_date) { <span class="muted small">· starts {{ formatDate(r.target_start_date) }}</span> }
                  @if (r.contract_value) { <span class="muted small">· {{ r.currency }} {{ r.contract_value }}</span> }
                  @if (r.commission_value) {
                    <span class="muted small">· commission {{ r.currency }} {{ r.commission_value }}</span>
                    @if (r.commission_paid_full) { <span class="pill yes">paid in full</span> }
                    @else if (r.commission_paid_part) { <span class="pill yes">part paid</span> }
                  }
                  <span class="spacer"></span>
                  <span class="role-counts">
                    @if (r.vetting_count) { <span class="count vet">{{ r.vetting_count }} vetting</span> }
                    @if (r.placed_count)  { <span class="count plc">{{ r.placed_count }} placed</span> }
                    @if (r.rejected_count){ <span class="count rej">{{ r.rejected_count }} rejected</span> }
                  </span>
                  <span class="role-actions" (click)="$event.stopPropagation()">
                    <button class="ghost icon-btn" (click)="addCandidateToRole(r)" title="Add candidate to this role">+</button>
                    <button class="ghost icon-btn" (click)="editRole(r)" title="Edit role">✎</button>
                    <button class="ghost icon-btn danger" (click)="delRole(r)" title="Delete role">✕</button>
                  </span>
                </header>
                @if (roleExpanded().has(r.id!)) {
                  @if (r.description) { <p class="muted small role-desc">{{ r.description }}</p> }
                  @if (r.commission_due_part || r.commission_due_full) {
                    <p class="muted small role-desc">
                      Due ·
                      @if (r.commission_due_part) { part {{ formatDate(r.commission_due_part) }} }
                      @if (r.commission_due_full) { <span>· full {{ formatDate(r.commission_due_full) }}</span> }
                    </p>
                  }

                  @if (placementsForRole(r.id!).length > 0) {
                    <ul class="role-candidates">
                      @for (p of placementsForRole(r.id!); track p.id) {
                        <li>
                          <a class="cand-link" [routerLink]="['/recruitment/candidates', p.candidate_id]">
                            <strong>{{ p.candidate_name }}</strong>
                          </a>
                          <span class="status-pill" [attr.data-placement-status]="p.status">{{ p.status }}</span>
                          @if (p.candidate_role) { <span class="muted small">· {{ p.candidate_role }}</span> }
                          <span class="spacer"></span>
                          <span class="muted small">{{ formatDate(p.created_at) }}</span>
                        </li>
                      }
                    </ul>
                  }
                }
              </section>
            }
          </div>
        }
      }

      @if (tab() === 'vetting') {
        @if (vettingPlacements().length === 0) {
          <p class="muted pad">No candidates currently being vetted with this client.</p>
        } @else {
          <div class="placement-list">
            @for (p of vettingPlacements(); track p.id) {
              <div class="placement-card" data-status="screening">
                <div class="placement-head">
                  <a class="cand-link" [routerLink]="['/recruitment/candidates', p.candidate_id]">
                    <strong>{{ p.candidate_name }}</strong>
                  </a>
                  <span class="status-pill" data-placement-status="screening">screening</span>
                  @if (p.role) { <span class="muted small">· {{ p.role }}</span> }
                  @if (p.candidate_role) { <span class="muted small">· {{ p.candidate_role }}</span> }
                  <span class="spacer"></span>
                  <span class="muted small">Pitched {{ formatDate(p.created_at) }}</span>
                  <button class="ghost icon-btn" (click)="editPlacement(p)" title="Edit">✎</button>
                  <button class="ghost icon-btn danger" (click)="delPlacement(p)" title="Delete">✕</button>
                </div>
              </div>
            }
          </div>
        }
      }

      @if (tab() === 'placed') {
        @if (placedAndEnded().length === 0) {
          <p class="muted pad">No placed candidates yet with this client.</p>
        } @else {
          <div class="placement-list">
            @for (p of placedAndEnded(); track p.id) {
              <section class="placement-card" [attr.data-status]="p.status">
                <button class="placement-toggle" type="button" (click)="toggleExpanded(p.id!)">
                  <span class="caret">{{ expanded().has(p.id!) ? '▾' : '▸' }}</span>
                  <a class="cand-link" [routerLink]="['/recruitment/candidates', p.candidate_id]"
                     (click)="$event.stopPropagation()">
                    <strong>{{ p.candidate_name }}</strong>
                  </a>
                  <span class="status-pill" [attr.data-placement-status]="p.status">{{ p.status }}</span>
                  @if (p.role) { <span class="muted small">· {{ p.role }}</span> }
                  <span class="spacer"></span>
                  <span class="muted small">
                    {{ p.start_date ? formatDate(p.start_date) : '—' }} →
                    {{ p.end_date   ? formatDate(p.end_date)   : (p.status === 'placed' ? 'ongoing' : '—') }}
                  </span>
                  <span class="card-actions" (click)="$event.stopPropagation()">
                    <button class="ghost icon-btn" (click)="editPlacement(p)" title="Edit">✎</button>
                    <button class="ghost icon-btn danger" (click)="delPlacement(p)" title="Delete">✕</button>
                  </span>
                </button>
                @if (expanded().has(p.id!)) {
                  <div class="placement-body">
                    <div><span class="muted">Start</span> · {{ p.start_date ? formatDate(p.start_date) : '—' }}</div>
                    <div><span class="muted">End</span> · {{ p.end_date ? formatDate(p.end_date) : '—' }}</div>
                    <div><span class="muted">Contract value</span> ·
                      @if (p.contract_value) { {{ p.currency }} {{ p.contract_value }} } @else { — }
                    </div>
                    <div><span class="muted">Our commission</span> ·
                      @if (p.commission_value) { {{ p.currency }} {{ p.commission_value }} } @else { — }
                    </div>
                    <div><span class="muted">Commission status</span> ·
                      @if (p.commission_paid_full) { <span class="pill yes">paid in full</span> }
                      @else if (p.commission_paid_part) { <span class="pill yes">part paid</span> }
                      @else { <span class="muted">unpaid</span> }
                    </div>
                    @if (p.commission_due_part || p.commission_due_full) {
                      <div><span class="muted">Due</span> ·
                        @if (p.commission_due_part) { part {{ formatDate(p.commission_due_part) }} }
                        @if (p.commission_due_full) { · full {{ formatDate(p.commission_due_full) }} }
                      </div>
                    }
                    <div><span class="muted">Candidate role on file</span> · {{ p.candidate_role || '—' }}</div>
                    <div><span class="muted">Recorded</span> · {{ formatDate(p.created_at) }}</div>
                  </div>
                  @if (p.contract_notes) {
                    <p class="placement-notes">{{ p.contract_notes }}</p>
                  }
                }
              </section>
            }
          </div>
        }
      }

      @if (tab() === 'rejected') {
        @if (rejectedPlacements().length === 0) {
          <p class="muted pad">No candidates have been rejected by this client.</p>
        } @else {
          <div class="placement-list">
            @for (p of rejectedPlacements(); track p.id) {
              <div class="placement-card" data-status="rejected">
                <div class="placement-head">
                  <a class="cand-link" [routerLink]="['/recruitment/candidates', p.candidate_id]">
                    <strong>{{ p.candidate_name }}</strong>
                  </a>
                  <span class="status-pill" data-placement-status="rejected">rejected</span>
                  @if (p.role) { <span class="muted small">· {{ p.role }}</span> }
                  @if (p.candidate_role) { <span class="muted small">· {{ p.candidate_role }}</span> }
                  <span class="spacer"></span>
                  <span class="muted small">Recorded {{ formatDate(p.updated_at) }}</span>
                  <button class="ghost icon-btn" (click)="editPlacement(p)" title="Edit">✎</button>
                  <button class="ghost icon-btn danger" (click)="delPlacement(p)" title="Delete">✕</button>
                </div>
                @if (p.rejection_reason) {
                  <p class="placement-notes muted small">{{ p.rejection_reason }}</p>
                }
              </div>
            }
          </div>
        }
      }
    }

    @if (showRoleModal()) {
      <div class="modal-backdrop" (click)="closeRoleModal()">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-head">
            <h2>{{ roleDraft.id ? 'Edit role' : 'New role at ' + (client()?.name || '—') }}</h2>
            <button class="ghost icon-btn" (click)="closeRoleModal()" title="Close">✕</button>
          </div>
          <div class="modal-body">
            <label>Title <span class="required">*</span></label>
            <input [(ngModel)]="roleDraft.title" name="role_title" placeholder="e.g. Site Manager" />

            <label>Description</label>
            <textarea rows="2" [(ngModel)]="roleDraft.description" name="role_desc"
                      placeholder="Brief from the client — scope, must-haves, working pattern."></textarea>

            <div class="meta-row">
              <div class="meta-field">
                <label>Target start</label>
                <input type="date" [(ngModel)]="roleDraft.target_start_date" name="role_start" />
              </div>
              <div class="meta-field">
                <label>Target end</label>
                <input type="date" [(ngModel)]="roleDraft.target_end_date" name="role_end" />
              </div>
              <div class="meta-field">
                <label>Status</label>
                <select [(ngModel)]="roleDraft.status" name="role_status">
                  <option value="open">Open</option>
                  <option value="filled">Filled</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
            </div>

            <div class="meta-row">
              <div class="meta-field">
                <label>Contract value</label>
                <input type="number" [(ngModel)]="roleDraft.contract_value" name="role_value"
                  (ngModelChange)="onContractChange()" />
              </div>
              <div class="meta-field" style="max-width: 90px">
                <label>Currency</label>
                <input [(ngModel)]="roleDraft.currency" name="role_cur" maxlength="3" />
              </div>
            </div>

            <div class="meta-field">
              <label>Our commission — {{ rolePercent() }}% of contract</label>
              <div class="pct-row">
                <input type="range" min="0" max="100" step="1"
                  [ngModel]="rolePercent()" (ngModelChange)="onPercentChange($event)"
                  name="role_pct" class="pct-slider" />
                <input type="number" min="0" max="100" step="1"
                  [ngModel]="rolePercent()" (ngModelChange)="onPercentChange($event)"
                  name="role_pct_num" class="pct-num" />
                <span class="pct-pct">%</span>
              </div>
            </div>
            <div class="meta-row">
              <div class="meta-field">
                <label>Our commission ({{ roleDraft.currency || 'GBP' }})</label>
                <input type="number" [(ngModel)]="roleDraft.commission_value" name="role_comm"
                  (ngModelChange)="onCommissionChange()" />
              </div>
            </div>

            <div class="toggle-grid">
              <label class="inline-toggle">
                <input type="checkbox" [(ngModel)]="roleDraft.commission_paid_part" name="role_paid_part"
                  (ngModelChange)="onPartPaidChange($event)" />
                <span>Part commission paid</span>
              </label>
              <label class="inline-toggle">
                <input type="checkbox" [(ngModel)]="roleDraft.commission_paid_full" name="role_paid_full" />
                <span>Full commission paid</span>
              </label>
            </div>

            @if (roleDraft.commission_paid_part && !roleDraft.commission_paid_full) {
              <div class="meta-row">
                <div class="meta-field">
                  <label>Part amount paid ({{ roleDraft.currency || 'GBP' }}) — defaults to half</label>
                  <input type="number" [(ngModel)]="roleDraft.commission_part_amount" name="role_part_amt" />
                </div>
              </div>
            }

            <div class="meta-row">
              <div class="meta-field">
                <label>Part commission due</label>
                <input type="date" [(ngModel)]="roleDraft.commission_due_part" name="role_due_part" />
              </div>
              <div class="meta-field">
                <label>Full commission due</label>
                <input type="date" [(ngModel)]="roleDraft.commission_due_full" name="role_due_full" />
              </div>
            </div>

            <label>Notes</label>
            <textarea rows="2" [(ngModel)]="roleDraft.notes" name="role_notes"></textarea>

            @if (roleError()) { <p class="err">{{ roleError() }}</p> }
          </div>
          <div class="modal-foot">
            <button class="ghost" (click)="closeRoleModal()" [disabled]="roleSaving()">Cancel</button>
            <button class="primary" (click)="saveRole()" [disabled]="roleSaving()">
              {{ roleSaving() ? 'Saving…' : (roleDraft.id ? 'Save changes' : 'Create role') }}
            </button>
          </div>
        </div>
      </div>
    }

    @if (showPlacementModal()) {
      <div class="modal-backdrop" (click)="closePlacementModal()">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-head">
            <h2>{{ placementDraft.id ? 'Edit placement' : ('Add candidate to ' + (client()?.name || '—')) }}</h2>
            <button class="ghost icon-btn" (click)="closePlacementModal()" title="Close">✕</button>
          </div>
          <div class="modal-body">
            <label>Candidate <span class="required">*</span></label>
            <select [(ngModel)]="placementDraft.candidate_id" name="pl_candidate">
              <option [ngValue]="0">— Choose a candidate —</option>
              @for (c of candidates(); track c.id) {
                <option [ngValue]="c.id">
                  {{ c.first_name }} {{ c.last_name }}{{ c.role ? ' · ' + c.role : '' }}{{ isPreviouslyRejected(c.id) ? ' · ⚠ previously rejected' : '' }}
                </option>
              }
            </select>
            @if (isPreviouslyRejected(placementDraft.candidate_id)) {
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
              {{ placementSaving() ? 'Saving…' : (placementDraft.id ? 'Save changes' : 'Add placement') }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .toolbar h1 { margin: 0; font-size: 18px; }
    .pad { padding: 0 24px; }
    .edit-link { text-decoration: none; }

    .grid-2 {
      display: grid; grid-template-columns: 2fr 1fr;
      gap: 16px; padding: 16px 24px;
    }
    @media (max-width: 900px) { .grid-2 { grid-template-columns: 1fr; } }

    .card {
      background: var(--bg-2); border: 1px solid var(--line);
      border-radius: var(--radius-sm); padding: 16px;
    }
    .card h3 { margin: 0 0 12px; font-size: 14px; }

    .kv { display: grid; grid-template-columns: 110px 1fr; gap: 6px 12px; margin: 0; }
    .kv dt { color: var(--muted); font-size: 12px; }
    .kv dd { margin: 0; font-size: 13px; word-break: break-word; }

    .stat-row { display: flex; gap: 16px; }
    .stat {
      flex: 1;
      background: var(--bg-3); border: 1px solid var(--line);
      border-radius: var(--radius-sm); padding: 14px;
      text-align: center;
    }
    .stat .num { font-size: 24px; font-weight: 700; color: var(--primary); }
    .stat .label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px; }
    .stat.warn .num { color: #f08577; }

    .section-h { margin: 0 24px 10px; font-size: 13px; color: var(--fg); }

    .placement-list { display: flex; flex-direction: column; gap: 10px; padding: 0 24px 24px; }
    .placement-card {
      background: var(--bg-3); border: 1px solid var(--line);
      border-radius: var(--radius-sm); padding: 12px 14px;
    }
    /* No coloured borders per status — the badge does that work. */
    .placement-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .placement-head strong { font-size: 14px; }
    .placement-body {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 8px 16px; margin-top: 8px; font-size: 13px;
    }
    .cand-link { color: var(--primary); text-decoration: none; }
    .cand-link:hover { text-decoration: underline; }

    .status-pill {
      display: inline-block; padding: 2px 10px; border-radius: 999px;
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
      border: 1px solid var(--line); color: var(--muted);
    }
    .status-pill[data-placement-status="screening"] { color: #6db4ff; border-color: #4d8edb; background-color: rgba(77, 142, 219, 0.15); }
    .status-pill[data-placement-status="placed"]    { color: #7ed985; border-color: #4caf50; background-color: rgba(76, 175, 80, 0.20); }
    .status-pill[data-placement-status="ended"]     { color: var(--muted); }
    .status-pill[data-placement-status="rejected"]  { color: #f08577; border-color: #d84d3e; background-color: rgba(244, 67, 54, 0.15); }

    .pill.yes {
      display: inline-block; padding: 2px 8px; border-radius: 999px;
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;
      border: 1px solid #4caf50; color: #7ed985; background: rgba(76, 175, 80, 0.15);
      margin-left: 6px;
    }

    /* Tab nav between Vetting / Placed / Rejected — same pattern as
       elsewhere in the recruitment module. */
    .tab-nav {
      display: flex; gap: 4px; padding: 0 24px;
      border-bottom: 1px solid var(--line);
      margin: 0 0 16px;
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
    .badge.warn { color: #f08577; border-color: #d84d3e; }

    /* Collapsible placement card on the Placed tab. The toggle row
       behaves like a button; clicking the candidate name inside still
       routes (we stopPropagation on it). */
    .placement-toggle {
      width: 100%; background: transparent; border: 0; padding: 0; cursor: pointer;
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
      color: var(--fg); font: inherit; text-align: left;
    }
    .placement-toggle:hover { color: var(--primary); }
    .caret { color: var(--muted); width: 14px; display: inline-block; flex-shrink: 0; }
    .placement-notes {
      margin: 8px 0 0; font-size: 13px; color: var(--fg);
      white-space: pre-wrap;
    }

    /* "+ Add candidate" button lives at the right side of the tab nav. */
    .tab-nav .spacer { flex: 1; }
    .add-btn { margin: 4px 24px 4px 0; padding: 4px 14px; font-size: 13px; }
    .card-actions { display: inline-flex; gap: 4px; margin-left: 6px; }

    /* Placement modal — repurposes meta-row + toggle-grid from the
       candidate-side modal. warn-banner highlights the previously-
       rejected case. */
    .meta-row { display: flex; gap: 12px; flex-wrap: wrap; align-items: end; margin: 8px 0; }
    .meta-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 140px; }
    .meta-field label { margin: 0; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
    .toggle-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 8px 0; }
    @media (max-width: 540px) { .toggle-grid { grid-template-columns: 1fr; } }
    .inline-toggle {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 12px; background: var(--bg-3); border: 1px solid var(--line);
      border-radius: var(--radius-sm); cursor: pointer; font-size: 13px; color: var(--fg);
    }
    .inline-toggle input[type="checkbox"] { width: 16px; height: 16px; flex: 0 0 16px; }
    .pct-row { display: flex; align-items: center; gap: 12px; }
    .pct-slider { flex: 1; accent-color: var(--primary); height: 4px; cursor: pointer; }
    .pct-num { width: 72px; flex: 0 0 72px; }
    .pct-pct { color: var(--muted); font-size: 13px; }
    .warn-banner {
      background: rgba(244, 67, 54, 0.12); border: 1px solid #d84d3e;
      color: #f08577; padding: 8px 12px; border-radius: var(--radius-sm);
      font-size: 13px; margin: 8px 0 0;
    }
    .required { color: #ef4444; }
    .err { color: #ef4444; font-size: 13px; margin: 6px 0 0; }

    /* Roles tab — each role gets its own card showing its candidates. */
    .role-card {
      background: var(--bg-3); border: 1px solid var(--line);
      border-radius: var(--radius-sm); padding: 12px 14px;
    }
    .role-head {
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
      cursor: pointer;
      margin: -4px -6px 0;
      padding: 4px 6px;
      border-radius: var(--radius-sm);
    }
    .role-head:hover { background: rgba(255,255,255,0.03); }
    .role-title { font-size: 14px; }
    .role-actions { display: inline-flex; gap: 4px; margin-left: 4px; }
    .role-desc  { margin: 6px 0 8px; }
    .role-counts { display: inline-flex; gap: 6px; }
    .role-counts .count {
      display: inline-block; padding: 1px 8px; border-radius: 999px;
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;
      border: 1px solid var(--line); background: var(--bg-2);
    }
    .role-counts .vet { color: #6db4ff; border-color: #4d8edb; }
    .role-counts .plc { color: #7ed985; border-color: #4caf50; }
    .role-counts .rej { color: #f08577; border-color: #d84d3e; }

    .status-pill[data-role-status="open"]      { color: var(--primary); border-color: var(--primary); background: rgba(255, 193, 7, 0.15); }
    .status-pill[data-role-status="filled"]    { color: #7ed985; border-color: #4caf50; background: rgba(76, 175, 80, 0.20); }
    .status-pill[data-role-status="cancelled"] { color: var(--muted); }

    /* Per-role candidate list nested inside a role card. */
    .role-candidates {
      list-style: none; padding: 0; margin: 10px 0 0;
      display: flex; flex-direction: column; gap: 6px;
      border-top: 1px dashed var(--line); padding-top: 10px;
    }
    .role-candidates li {
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
      padding: 6px 10px; background: var(--bg-2); border: 1px solid var(--line);
      border-radius: var(--radius-sm); font-size: 13px;
    }
  `],
})
export class RecruitmentClientDetail {
  private api = inject(Api);
  private route = inject(ActivatedRoute);

  clientId = signal<number>(0);
  client = signal<Client | null>(null);
  placements = signal<RecruitmentPlacement[]>([]);
  loading = signal<boolean>(true);

  /** Candidates available to pick when adding a placement. */
  candidates = signal<RecruitmentCandidate[]>([]);

  tab = signal<'roles' | 'vetting' | 'placed' | 'rejected'>('roles');

  /** Role openings at this client. */
  roles = signal<RecruitmentRole[]>([]);

  /** Placements belonging to a given role (used to render the per-role
   *  candidate list inside each role card on the Roles tab). */
  placementsForRole(roleId: number): RecruitmentPlacement[] {
    return this.placements().filter(p => p.role_id === roleId);
  }

  /** Role ids currently expanded on the Roles tab. Default = all
   *  collapsed; user can expand one at a time (or many) and the choice
   *  is preserved across refreshes via `roleUserTouched`. */
  roleExpanded = signal<Set<number>>(new Set());
  private roleUserTouched = false;
  toggleRoleExpanded(rid: number) {
    this.roleUserTouched = true;
    const next = new Set(this.roleExpanded());
    if (next.has(rid)) next.delete(rid); else next.add(rid);
    this.roleExpanded.set(next);
  }

  // Role add/edit modal state
  showRoleModal = signal<boolean>(false);
  roleDraft: RecruitmentRole = this.blankRole();
  roleError = signal<string | null>(null);
  roleSaving = signal<boolean>(false);
  // Agency commission as a % of contract value (default 12). Drives the
  // commission amount; held as a signal so the slider label re-renders.
  readonly DEFAULT_PCT = 12;
  rolePercent = signal<number>(this.DEFAULT_PCT);

  private blankRole(): RecruitmentRole {
    return {
      title: '', description: '',
      currency: 'GBP', status: 'open',
      commission_percent: this.DEFAULT_PCT,
    };
  }

  private toNum(v: unknown): number {
    const n = typeof v === 'string' ? parseFloat(v) : (v as number);
    return Number.isFinite(n) ? n : 0;
  }

  openAddRole() {
    this.roleDraft = this.blankRole();
    this.rolePercent.set(this.DEFAULT_PCT);
    this.roleError.set(null);
    this.showRoleModal.set(true);
  }
  editRole(r: RecruitmentRole) {
    this.roleDraft = { ...r };
    // Seed the percentage: stored value wins; else derive from
    // commission/contract; else fall back to the 12% default.
    const stored = r.commission_percent != null && r.commission_percent !== ''
      ? this.toNum(r.commission_percent) : null;
    const contract = this.toNum(r.contract_value);
    const commission = this.toNum(r.commission_value);
    const derived = contract > 0 ? Math.round((commission / contract) * 100) : null;
    this.rolePercent.set(stored ?? derived ?? this.DEFAULT_PCT);
    this.roleError.set(null);
    this.showRoleModal.set(true);
  }

  /** Recompute the commission amount from contract × percent. */
  private recalcCommission() {
    const contract = this.toNum(this.roleDraft.contract_value);
    const pct = this.rolePercent();
    this.roleDraft.commission_value = Math.round(contract * (pct / 100) * 100) / 100;
  }
  onContractChange() { this.recalcCommission(); }
  onPercentChange(v: number | string) {
    let pct = Math.round(this.toNum(v));
    pct = Math.max(0, Math.min(100, pct));
    this.rolePercent.set(pct);
    this.roleDraft.commission_percent = pct;
    this.recalcCommission();
  }
  /** Manual edit of the commission amount → back out the implied percent. */
  onCommissionChange() {
    const contract = this.toNum(this.roleDraft.contract_value);
    if (contract > 0) {
      const pct = Math.max(0, Math.min(100, Math.round((this.toNum(this.roleDraft.commission_value) / contract) * 100)));
      this.rolePercent.set(pct);
      this.roleDraft.commission_percent = pct;
    }
  }
  /** First time "part paid" is ticked, default the amount to half. */
  onPartPaidChange(checked: boolean) {
    if (checked && (this.roleDraft.commission_part_amount == null || this.roleDraft.commission_part_amount === '')) {
      this.roleDraft.commission_part_amount = Math.round(this.toNum(this.roleDraft.commission_value) / 2 * 100) / 100;
    }
  }
  closeRoleModal() {
    if (this.roleSaving()) return;
    this.showRoleModal.set(false);
  }
  saveRole() {
    const d = this.roleDraft;
    if (!d.title?.trim()) { this.roleError.set('Role title is required.'); return; }
    const cid = this.clientId();
    if (!cid) return;
    this.roleSaving.set(true);
    this.roleError.set(null);
    const done = () => {
      this.roleSaving.set(false);
      this.showRoleModal.set(false);
      this.refreshRoles();
    };
    const fail = (e: any) => {
      this.roleSaving.set(false);
      this.roleError.set(e?.error?.error ?? 'Save failed.');
    };
    if (d.id) {
      this.api.updateRecruitmentClientRole(cid, d.id, d).subscribe({ next: done, error: fail });
    } else {
      this.api.createRecruitmentClientRole(cid, d).subscribe({ next: done, error: fail });
    }
  }
  delRole(r: RecruitmentRole) {
    if (!r.id) return;
    const candCount = r.total_candidates ?? 0;
    const msg = candCount > 0
      ? `Delete role "${r.title}"? ${candCount} candidate placement${candCount === 1 ? '' : 's'} will stay but lose the role link (they become role-less).`
      : `Delete role "${r.title}"?`;
    if (!confirm(msg)) return;
    const cid = this.clientId();
    this.api.deleteRecruitmentClientRole(cid, r.id).subscribe(() => this.refreshRoles());
  }
  /** Open the existing placement modal pre-locked to a specific role —
   *  HR can pick which candidate to pitch for it. The role's negotiated
   *  terms (contract value, commission, currency, target dates) seed
   *  the placement form so HR doesn't re-enter what's already on the
   *  role. Each can still be overridden per candidate. */
  addCandidateToRole(r: RecruitmentRole) {
    if (!r.id) return;
    this.placementDraft = {
      ...this.blankPlacement(),
      role_id: r.id,
      role: r.title,
      start_date: r.target_start_date ?? null,
      end_date: r.target_end_date ?? null,
      contract_value: r.contract_value ?? null,
      commission_value: r.commission_value ?? null,
      currency: r.currency || 'GBP',
    };
    this.placementError.set(null);
    this.showPlacementModal.set(true);
  }
  refreshRoles() {
    const cid = this.clientId();
    if (!cid) return;
    this.api.listRecruitmentClientRoles(cid).subscribe(r => this.roles.set(r.roles ?? []));
  }

  // Placement add/edit modal
  showPlacementModal = signal<boolean>(false);
  placementDraft: RecruitmentPlacement & { candidate_id?: number } = this.blankPlacement();
  placementError = signal<string | null>(null);
  placementSaving = signal<boolean>(false);

  private blankPlacement(): RecruitmentPlacement & { candidate_id?: number } {
    return {
      candidate_id: 0,
      client_id: this.clientId(),
      role: '',
      status: 'screening',
      currency: 'GBP',
      commission_paid_part: false,
      commission_paid_full: false,
    };
  }

  /** Candidate ids the current client has rejected before — used to
   *  flag the picker so HR sees a warning before re-pitching. */
  rejectedCandidateIds = computed<Set<number>>(() =>
    new Set(this.placements()
      .filter(p => p.status === 'rejected' && p.candidate_id !== undefined)
      .map(p => p.candidate_id!)),
  );
  isPreviouslyRejected(candId: number | null | undefined): boolean {
    return !!candId && this.rejectedCandidateIds().has(candId);
  }

  openAddPlacement() {
    this.placementDraft = this.blankPlacement();
    this.placementError.set(null);
    this.showPlacementModal.set(true);
  }
  editPlacement(p: RecruitmentPlacement) {
    this.placementDraft = { ...p };
    this.placementError.set(null);
    this.showPlacementModal.set(true);
  }
  closePlacementModal() {
    if (this.placementSaving()) return;
    this.showPlacementModal.set(false);
  }
  savePlacement() {
    const d = this.placementDraft;
    if (!d.candidate_id || d.candidate_id <= 0) {
      this.placementError.set('Pick a candidate.');
      return;
    }
    // Ensure the client side is set — for new rows this isn't editable
    // in the modal; we lock it to the page's client.
    if (!d.client_id) d.client_id = this.clientId();

    this.placementSaving.set(true);
    this.placementError.set(null);
    const cid = this.clientId();
    const done = () => {
      this.placementSaving.set(false);
      this.showPlacementModal.set(false);
      this.api.listRecruitmentClientPlacements(cid).subscribe(r =>
        this.placements.set(r.placements ?? []),
      );
      this.refreshRoles();
    };
    const fail = (e: any) => {
      this.placementSaving.set(false);
      this.placementError.set(e?.error?.error ?? 'Save failed.');
    };
    if (d.id) {
      // Updating an existing placement — endpoint is candidate-scoped.
      this.api.updateRecruitmentPlacement(d.candidate_id, d.id, d).subscribe({ next: done, error: fail });
    } else {
      this.api.createRecruitmentPlacement(d.candidate_id, d).subscribe({ next: done, error: fail });
    }
  }
  delPlacement(p: RecruitmentPlacement) {
    if (!p.id || !p.candidate_id) return;
    if (!confirm(`Delete this placement for ${p.candidate_name ?? 'this candidate'}?`)) return;
    const cid = this.clientId();
    this.api.deleteRecruitmentPlacement(p.candidate_id, p.id).subscribe(() => {
      this.api.listRecruitmentClientPlacements(cid).subscribe(r =>
        this.placements.set(r.placements ?? []),
      );
      this.refreshRoles();
    });
  }

  /** Placement ids the user has expanded on the Placed tab. */
  expanded = signal<Set<number>>(new Set());
  toggleExpanded(id: number) {
    const next = new Set(this.expanded());
    if (next.has(id)) next.delete(id); else next.add(id);
    this.expanded.set(next);
  }

  /** Vetting tab — placements still in the screening stage. */
  vettingPlacements = computed(() =>
    this.placements().filter(p => p.status === 'screening'),
  );
  /** Placed tab — currently placed + historically ended. The user
   *  asked for this single bucket; "ended" is the natural continuation
   *  of "placed" so they live together with the status pill telling
   *  them apart. */
  placedAndEnded = computed(() =>
    this.placements().filter(p => p.status === 'placed' || p.status === 'ended'),
  );

  /** Kept for the summary stats card (which uses three signals). */
  activePlacements = computed(() =>
    this.placements().filter(p => p.status === 'screening' || p.status === 'placed'),
  );
  endedPlacements = computed(() =>
    this.placements().filter(p => p.status === 'ended'),
  );
  rejectedPlacements = computed(() =>
    this.placements().filter(p => p.status === 'rejected'),
  );

  constructor() {
    this.route.params.subscribe(p => {
      const id = Number(p['id']);
      if (!id) return;
      this.clientId.set(id);
      this.loading.set(true);
      this.api.getClient(id).subscribe({
        next: r => { this.client.set(r.client); this.loading.set(false); },
        error: () => { this.client.set(null); this.loading.set(false); },
      });
      this.api.listRecruitmentClientPlacements(id).subscribe(r =>
        this.placements.set(r.placements ?? []),
      );
      this.api.listRecruitmentClientRoles(id).subscribe(r => this.roles.set(r.roles ?? []));
    });
    // Candidate roster for the picker — loaded once, not per-route.
    this.api.listRecruitmentCandidates().subscribe(r => this.candidates.set(r.candidates ?? []));
  }

  formatDate(s: string | null | undefined): string {
    if (!s) return '—';
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }
}
