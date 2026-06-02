import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { HrEmployee, HrSuccessionCandidate, HrSuccessionCandidateNote, HrSuccessionPlan, HrSuccessionPlanNote } from '../../core/models';
import { ComboBox, ComboOption } from '../../shared/combo-box';

@Component({
  selector: 'app-hr-succession',
  imports: [FormsModule, ComboBox],
  template: `
    <div class="toolbar">
      <h1>Succession planning</h1>
      <span class="spacer"></span>
      <button class="primary" (click)="newPlan()">+ New plan</button>
    </div>

    <div class="layout">
      <aside class="plan-list">
        @for (p of plans(); track p.id) {
          <button class="plan-item" [class.active]="selectedId() === p.id" (click)="select(p)">
            <strong>{{ p.key_role }}</strong>
            <span class="muted small">
              @if (p.holder_first_name) { {{ p.holder_first_name }} {{ p.holder_last_name }} }
              @else { <em>vacant</em> }
            </span>
            <span class="risk risk-{{ p.risk_level }}">risk: {{ p.risk_level }}</span>
            <span class="muted small">{{ p.candidate_count ?? 0 }} candidate{{ (p.candidate_count ?? 0) === 1 ? '' : 's' }}</span>
          </button>
        }
        @if (plans().length === 0) { <p class="muted small" style="padding: 12px;">No plans yet.</p> }
      </aside>

      <section class="plan-detail">
        @if (selected(); as p) {
          <div class="plan-card">
            <div class="meta-row">
              <div class="meta-field">
                <label>Key role</label>
                <app-combo-box
                  [items]="roleOptions()"
                  [selectedValue]="p.key_role"
                  [customLabel]="p.key_role"
                  [allowCustom]="true"
                  placeholder="e.g. Head of Engineering"
                  name="kr_{{ p.id }}"
                  (valueChange)="patch({ key_role: $any($event) })"
                ></app-combo-box>
              </div>
              <div class="meta-field">
                <label>Current holder</label>
                <app-combo-box
                  [items]="holderOptions()"
                  [selectedValue]="p.current_holder_id ?? null"
                  placeholder="— vacant —"
                  name="ch_{{ p.id }}"
                  (valueChange)="patch({ current_holder_id: $any($event) ?? null })"
                ></app-combo-box>
              </div>
              <div class="meta-field meta-narrow">
                <label>Risk level</label>
                <select [ngModel]="p.risk_level" (ngModelChange)="patch({ risk_level: $event })" name="rl">
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
            </div>

            <h3 class="sec">Notes <span class="muted small">({{ notes().length }})</span></h3>
            @if (notes().length === 0) {
              <p class="muted small no-notes">No notes yet — leave the first one below.</p>
            } @else {
              <ul class="note-list">
                @for (n of notes(); track n.id) {
                  <li class="note-item">
                    <div class="note-meta">
                      <strong>{{ n.author_name || n.author_email || 'unknown' }}</strong>
                      <span class="muted small">{{ formatTime(n.created_at) }}</span>
                      <button class="ghost icon-btn danger" (click)="delNote(n)" title="Delete note">✕</button>
                    </div>
                    <div class="note-body">{{ n.body }}</div>
                  </li>
                }
              </ul>
            }
            <div class="note-form">
              <textarea rows="2" [(ngModel)]="newNote" name="newNote" placeholder="Add a note about this plan…"></textarea>
              <button class="primary" (click)="addNote()" [disabled]="!newNote.trim()">Add note</button>
            </div>

            <button class="group-head" (click)="candidatesOpen.set(!candidatesOpen())">
              <span class="caret">{{ candidatesOpen() ? '▾' : '▸' }}</span>
              <span class="group-title">Candidates</span>
              <span class="muted small">{{ candidates().length }} listed</span>
            </button>

            @if (candidatesOpen()) {
              <div class="add-cand">
                <select [(ngModel)]="addEmpId" name="ae" class="cand-emp">
                  <option [ngValue]="0">— pick a candidate —</option>
                  @for (e of unaddedEmployees(); track e.id) {
                    <option [ngValue]="e.id">{{ e.first_name }} {{ e.last_name }}{{ e.position ? ' (' + e.position + ')' : '' }}</option>
                  }
                </select>
                <select [(ngModel)]="addReadiness" name="ar" class="cand-ready">
                  <option value="now">Ready now</option>
                  <option value="1-2y">1–2 years</option>
                  <option value="3-5y">3–5 years</option>
                </select>
                <button class="primary cand-add" (click)="addCand()" [disabled]="!addEmpId">+ Add candidate</button>
              </div>
              @if (candidates().length === 0) {
                <p class="muted small">No candidates added yet.</p>
              } @else {
                <ul class="cand-list">
                  @for (c of candidates(); track c.id) {
                    <li class="cand-card" [class.expanded]="expandedCandId() === c.id">
                      <button class="cand-head" type="button" (click)="toggleCand(c.id)">
                        <span class="caret">{{ expandedCandId() === c.id ? '▾' : '▸' }}</span>
                        <strong>{{ c.first_name }} {{ c.last_name }}</strong>
                        <span class="muted small">{{ c.position || '—' }}{{ c.department ? ' · ' + c.department : '' }}</span>
                        <span class="readiness ready-{{ c.readiness }}">{{ readinessLabel(c.readiness) }}</span>
                        <button class="ghost icon-btn danger" type="button" (click)="$event.stopPropagation(); delCand(c)" title="Remove">✕</button>
                      </button>
                      @if (expandedCandId() === c.id) {
                        <div class="cand-body">
                          <div class="meta-row">
                            <div class="meta-field meta-narrow">
                              <label>Readiness</label>
                              <select [ngModel]="c.readiness" (ngModelChange)="updateCand(c, { readiness: $event })" name="cr_{{ c.id }}">
                                <option value="now">Ready now</option>
                                <option value="1-2y">1–2 years</option>
                                <option value="3-5y">3–5 years</option>
                              </select>
                            </div>
                          </div>

                          <h4 class="thread-title">Notes <span class="muted small">({{ (candNotes()[c.id!] || []).length }})</span></h4>
                          @if ((candNotes()[c.id!] || []).length === 0) {
                            <p class="muted small no-notes">No notes yet — leave the first one below.</p>
                          } @else {
                            <ul class="note-list">
                              @for (n of candNotes()[c.id!]; track n.id) {
                                <li class="note-item">
                                  <div class="note-meta">
                                    <strong>{{ n.author_name || n.author_email || 'unknown' }}</strong>
                                    <span class="muted small">{{ formatTime(n.created_at) }}</span>
                                    <button class="ghost icon-btn danger" (click)="delCandNote(c, n)" title="Delete note">✕</button>
                                  </div>
                                  <div class="note-body">{{ n.body }}</div>
                                </li>
                              }
                            </ul>
                          }
                          <div class="note-form">
                            <textarea rows="2"
                                      [ngModel]="candNoteDrafts()[c.id!] || ''"
                                      (ngModelChange)="setCandNoteDraft(c.id!, $event)"
                                      name="cnd_{{ c.id }}"
                                      placeholder="Add a follow-up note about this candidate…"></textarea>
                            <button class="primary"
                                    (click)="addCandNote(c)"
                                    [disabled]="!(candNoteDrafts()[c.id!] || '').trim()">Add note</button>
                          </div>
                        </div>
                      }
                    </li>
                  }
                </ul>
              }
            }

            <div class="card-footer">
              <button class="ghost danger" (click)="delPlan(p)">✕ Delete plan</button>
            </div>
          </div>
        } @else {
          <p class="muted small" style="padding: 24px;">Select a plan on the left, or create one.</p>
        }
      </section>
    </div>
  `,
  styles: [`
    .toolbar { padding: 16px 20px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--line); }
    .toolbar h1 { margin: 0; font-size: 22px; }
    .spacer { flex: 1; }
    .layout { display: grid; grid-template-columns: 280px 1fr; min-height: calc(100vh - 120px); }
    .plan-list { border-right: 1px solid var(--line); padding: 12px; display: flex; flex-direction: column; gap: 6px; overflow-y: auto; }
    .plan-item {
      display: flex; flex-direction: column; gap: 2px;
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
      padding: 10px 12px; text-align: left; color: var(--fg); cursor: pointer;
    }
    .plan-item:hover { border-color: var(--primary); }
    .plan-item.active { border-color: var(--primary); background: var(--bg-3); }
    .plan-detail { padding: 20px; }
    .plan-card {
      background: var(--bg-3);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 18px;
    }
    .form-grid { display: grid; grid-template-columns: 160px 1fr; column-gap: 16px; row-gap: 10px; align-items: center; }
    .form-grid label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin: 0; }
    .meta-row { display: flex; gap: 12px; flex-wrap: wrap; }
    .meta-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 180px; }
    .meta-field.meta-narrow { flex: 0 0 160px; }
    .meta-field label { margin: 0; }
    .meta-field input, .meta-field select { width: 100%; }
    .group-head {
      display: flex; align-items: center; gap: 10px;
      width: 100%; padding: 10px 0; margin: 16px 0 10px;
      background: transparent; border: 0; border-bottom: 1px solid var(--line);
      color: var(--fg); cursor: pointer; text-align: left; font: inherit;
    }
    .group-head:hover { color: var(--primary); border-color: var(--primary); background: transparent; }
    .group-head .caret { color: var(--muted); font-size: 12px; min-width: 14px; }
    .group-head .group-title { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
    .group-head .muted { margin-left: auto; }

    .cand-list {
      list-style: none !important;
      margin: 0; padding: 0;
      display: flex; flex-direction: column; gap: 6px;
      width: 100%;
    }
    .cand-card {
      list-style: none;
      display: block; width: 100%;
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
      overflow: hidden;
    }
    .cand-card::marker { content: ''; }
    .cand-card.expanded { border-color: var(--primary); }
    .cand-head {
      display: grid;
      grid-template-columns: 16px auto 1fr auto auto;
      gap: 12px; align-items: center;
      width: 100%; padding: 10px 14px;
      background: transparent; border: 0; color: var(--fg);
      cursor: pointer; text-align: left; font: inherit;
    }
    .cand-head:hover { background: rgba(212,169,58,0.04); border: 0; }
    .cand-head .caret { color: var(--muted); font-size: 12px; }
    .cand-head .icon-btn.danger { color: #ef4444; }
    .cand-body { padding: 10px 14px 14px; border-top: 1px solid var(--line); background: var(--bg-3); }
    .readiness {
      padding: 1px 6px; border-radius: 4px; font-size: 10px;
      text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      border: 1px solid var(--line); white-space: nowrap;
    }
    .ready-now  { color: var(--primary); border-color: var(--primary); background: rgba(212,169,58,0.12); }
    .ready-1-2y { color: #60a5fa; border-color: #60a5fa; }
    .ready-3-5y { color: var(--muted); }
    .thread-title { margin: 14px 0 8px; font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; }
    h3.sec { font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; margin: 22px 0 10px; }
    .row { display: flex; align-items: center; gap: 8px; }
    .add-cand {
      display: grid;
      grid-template-columns: 1fr 160px auto;
      gap: 8px; align-items: center;
      margin-bottom: 14px;
    }
    .add-cand .cand-emp,
    .add-cand .cand-ready { width: 100%; }
    .add-cand .cand-add { white-space: nowrap; }
    .card-footer {
      margin-top: 18px; padding-top: 14px;
      border-top: 1px solid var(--line);
      display: flex; justify-content: flex-end;
    }
    .no-notes { margin: 0 0 12px; }
    .note-list { list-style: none; margin: 0 0 12px; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .note-item {
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
      padding: 10px 12px;
    }
    .note-meta { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
    .note-meta strong { font-size: 13px; }
    .note-meta .icon-btn { margin-left: auto; }
    .note-body { white-space: pre-wrap; line-height: 1.5; font-size: 13px; }
    .note-form { display: flex; flex-direction: column; gap: 6px; }
    .note-form button { align-self: flex-end; }
    .risk {
      align-self: flex-start; padding: 1px 6px; border-radius: 4px;
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
    }
    .risk-low    { background: var(--bg-3); color: var(--muted); }
    .risk-medium { background: rgba(212, 169, 58, 0.18); color: var(--primary); }
    .risk-high   { background: rgba(239, 68, 68, 0.18); color: #ef4444; }
    .actions { text-align: right; }
  `],
})
export class HrSuccession {
  private api = inject(Api);

  plans = signal<HrSuccessionPlan[]>([]);
  selectedId = signal<number | null>(null);
  candidates = signal<HrSuccessionCandidate[]>([]);
  employees = signal<HrEmployee[]>([]);
  notes = signal<HrSuccessionPlanNote[]>([]);
  candidatesOpen = signal(true);
  expandedCandId = signal<number | null>(null);
  candNotes = signal<Record<number, HrSuccessionCandidateNote[]>>({});
  candNoteDrafts = signal<Record<number, string>>({});

  toggleCand(id: number | null | undefined) {
    if (!id) return;
    const next = this.expandedCandId() === id ? null : id;
    this.expandedCandId.set(next);
    if (next !== null && this.candNotes()[next] === undefined) {
      this.loadCandNotes(next);
    }
  }
  private loadCandNotes(candidateId: number) {
    const planId = this.selectedId();
    if (!planId) return;
    this.api.listHrSuccessionCandidateNotes(planId, candidateId).subscribe(r => {
      this.candNotes.update(m => ({ ...m, [candidateId]: r.notes }));
    });
  }
  setCandNoteDraft(candidateId: number, body: string) {
    this.candNoteDrafts.update(m => ({ ...m, [candidateId]: body }));
  }
  addCandNote(c: HrSuccessionCandidate) {
    const planId = this.selectedId();
    if (!planId || !c.id) return;
    const body = (this.candNoteDrafts()[c.id] || '').trim();
    if (!body) return;
    this.api.addHrSuccessionCandidateNote(planId, c.id, body).subscribe(() => {
      this.candNoteDrafts.update(m => ({ ...m, [c.id!]: '' }));
      this.loadCandNotes(c.id!);
    });
  }
  delCandNote(c: HrSuccessionCandidate, n: HrSuccessionCandidateNote) {
    const planId = this.selectedId();
    if (!planId || !c.id || !n.id) return;
    if (!confirm('Delete this note?')) return;
    this.api.deleteHrSuccessionCandidateNote(planId, c.id, n.id).subscribe(() => this.loadCandNotes(c.id!));
  }
  readinessLabel(r?: string) {
    return r === 'now' ? 'Ready now' : r === '1-2y' ? '1–2 yrs' : r === '3-5y' ? '3–5 yrs' : 'TBD';
  }

  addEmpId = 0;
  addReadiness: 'now' | '1-2y' | '3-5y' = '1-2y';
  newNote = '';

  selected = computed(() => this.plans().find(p => p.id === this.selectedId()) ?? null);
  unaddedEmployees = computed(() => {
    const ids = new Set(this.candidates().map(c => c.employee_id));
    return this.employees().filter(e => e.status !== 'terminated' && !ids.has(e.id!));
  });
  /** Distinct non-empty position values across the company, used for the Key role autocomplete. */
  companyRoles = computed(() => {
    const set = new Set<string>();
    for (const e of this.employees()) {
      if (e.position) set.add(e.position);
    }
    return [...set].sort();
  });
  roleOptions = computed<ComboOption[]>(() =>
    this.companyRoles().map(r => ({ value: r, label: r })),
  );
  holderOptions = computed<ComboOption[]>(() => [
    { value: null, label: '— vacant —' },
    ...this.employees()
      .filter(e => e.status !== 'terminated' && !!e.id)
      .map(e => ({ value: e.id!, label: `${e.first_name} ${e.last_name}` })),
  ]);

  ngOnInit() {
    this.refreshPlans();
    this.api.listHrEmployees().subscribe(r => this.employees.set(r.employees));
  }

  refreshPlans() {
    this.api.listHrSuccessionPlans().subscribe(r => {
      this.plans.set(r.plans);
      if (this.selectedId() === null && r.plans.length > 0) this.select(r.plans[0]);
    });
  }
  select(p: HrSuccessionPlan) {
    this.selectedId.set(p.id ?? null);
    this.newNote = '';
    if (p.id) {
      this.api.listHrSuccessionCandidates(p.id).subscribe(r => this.candidates.set(r.candidates));
      this.api.listHrSuccessionPlanNotes(p.id).subscribe(r => this.notes.set(r.notes));
    }
  }
  addNote() {
    const id = this.selectedId();
    const body = this.newNote.trim();
    if (!id || !body) return;
    this.api.addHrSuccessionPlanNote(id, body).subscribe(() => {
      this.newNote = '';
      this.api.listHrSuccessionPlanNotes(id).subscribe(r => this.notes.set(r.notes));
    });
  }
  delNote(n: HrSuccessionPlanNote) {
    const id = this.selectedId();
    if (!id || !n.id) return;
    if (!confirm('Delete this note?')) return;
    this.api.deleteHrSuccessionPlanNote(id, n.id).subscribe(() =>
      this.api.listHrSuccessionPlanNotes(id).subscribe(r => this.notes.set(r.notes))
    );
  }
  formatTime(iso?: string): string {
    if (!iso) return '';
    const d = new Date(iso.replace(' ', 'T'));
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }
  newPlan() {
    this.api.createHrSuccessionPlan({ key_role: 'New key role', risk_level: 'medium' }).subscribe(r => {
      this.api.listHrSuccessionPlans().subscribe(rr => {
        this.plans.set(rr.plans);
        const p = rr.plans.find(x => x.id === r.id);
        if (p) this.select(p);
      });
    });
  }
  patch(p: Partial<HrSuccessionPlan>) {
    const id = this.selectedId();
    if (!id) return;
    this.api.updateHrSuccessionPlan(id, p).subscribe(() => this.refreshPlans());
  }
  delPlan(p: HrSuccessionPlan) {
    if (!p.id) return;
    if (!confirm(`Delete plan for "${p.key_role}"?`)) return;
    this.api.deleteHrSuccessionPlan(p.id).subscribe(() => {
      this.selectedId.set(null);
      this.candidates.set([]);
      this.refreshPlans();
    });
  }
  addCand() {
    const id = this.selectedId();
    if (!id || !this.addEmpId) return;
    this.api.addHrSuccessionCandidate(id, { employee_id: this.addEmpId, readiness: this.addReadiness }).subscribe(() => {
      this.addEmpId = 0;
      this.api.listHrSuccessionCandidates(id).subscribe(r => this.candidates.set(r.candidates));
      this.refreshPlans();
    });
  }
  updateCand(c: HrSuccessionCandidate, p: Partial<HrSuccessionCandidate>) {
    const planId = this.selectedId();
    if (!planId || !c.id) return;
    this.api.updateHrSuccessionCandidate(planId, c.id, p).subscribe();
  }
  delCand(c: HrSuccessionCandidate) {
    const planId = this.selectedId();
    if (!planId || !c.id) return;
    if (!confirm(`Remove ${c.first_name} ${c.last_name}?`)) return;
    this.api.deleteHrSuccessionCandidate(planId, c.id).subscribe(() => {
      this.api.listHrSuccessionCandidates(planId).subscribe(r => this.candidates.set(r.candidates));
      this.refreshPlans();
    });
  }
}
