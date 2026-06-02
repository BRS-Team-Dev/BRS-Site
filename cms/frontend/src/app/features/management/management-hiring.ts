import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { HrApplication, HrJob } from '../../core/models';

const STAGES = ['applied', 'screening', 'interview', 'offer', 'hired', 'rejected'] as const;

@Component({
  selector: 'app-management-hiring',
  imports: [FormsModule],
  template: `
    <div class="toolbar">
      <h1>Hiring</h1>
      <span class="spacer"></span>
      <span class="muted small">{{ jobs().length }} job{{ jobs().length === 1 ? '' : 's' }} · {{ activeApps().length }} active candidate{{ activeApps().length === 1 ? '' : 's' }}</span>
    </div>

    @if (jobs().length === 0) {
      <div class="empty"><p class="muted">You aren't listed as the hiring manager on any open jobs.</p>
        <p class="muted small">Ask HR to set <em>hiring_manager_id</em> on your jobs in Recruitment.</p></div>
    } @else {
      <h2 class="sec-title">Roles I'm hiring for</h2>
      <div class="job-grid">
        @for (j of jobs(); track j.id) {
          <div class="job-card">
            <div class="job-head">
              <strong>{{ j.title }}</strong>
              <span class="status status-{{ j.status }}">{{ j.status }}</span>
            </div>
            <span class="muted small">{{ j.department || '—' }} · {{ j.location || '—' }}</span>
            <span class="muted small">{{ j.app_count ?? 0 }} application{{ j.app_count === 1 ? '' : 's' }} · {{ j.active_count ?? 0 }} active</span>
          </div>
        }
      </div>

      <h2 class="sec-title">Pipeline</h2>
      <div class="kanban">
        @for (s of stages; track s) {
          <div class="col">
            <div class="col-head">
              <strong>{{ stageLabel(s) }}</strong>
              <span class="muted small">{{ countAt(s) }}</span>
            </div>
            <div class="col-body">
              @for (a of appsAt(s); track a.id) {
                <div class="app-card" [class.expanded]="expandedId() === a.id">
                  <div class="app-head" (click)="toggle(a)">
                    <strong>{{ a.c_first }} {{ a.c_last }}</strong>
                    <div class="muted small">{{ a.job_title }}</div>
                  </div>
                  @if (expandedId() === a.id) {
                    <div class="app-body">
                      <div class="muted small">{{ a.email }}</div>

                      <label>Stage</label>
                      <select [ngModel]="a.stage" (ngModelChange)="setStage(a, $event)" name="st_{{ a.id }}">
                        @for (s2 of stages; track s2) {
                          <option [value]="s2">{{ stageLabel(s2) }}</option>
                        }
                      </select>

                      <label>Add interview feedback</label>
                      <select [(ngModel)]="fbKind[a.id!]" name="fk_{{ a.id }}">
                        <option value="phone">Phone</option>
                        <option value="video">Video</option>
                        <option value="onsite">Onsite</option>
                        <option value="technical">Technical</option>
                        <option value="culture">Culture</option>
                        <option value="panel">Panel</option>
                        <option value="other">Other</option>
                      </select>
                      <textarea rows="3" [(ngModel)]="fbBody[a.id!]" name="fb_{{ a.id }}" placeholder="Standardised notes — strengths, concerns, recommendation."></textarea>
                      <div class="row" style="gap: 8px;">
                        <label class="muted small" style="margin: 0;">Rating</label>
                        <select [(ngModel)]="fbRating[a.id!]" name="fr_{{ a.id }}" style="width: 90px;">
                          <option [ngValue]="0">— none —</option>
                          @for (r of [1,2,3,4,5]; track r) { <option [ngValue]="r">{{ r }}</option> }
                        </select>
                        <span class="spacer"></span>
                        <button class="primary" [disabled]="!(fbBody[a.id!] || '').trim()" (click)="submitFeedback(a)">Save feedback</button>
                      </div>
                    </div>
                  }
                </div>
              }
              @if (countAt(s) === 0) { <p class="muted small empty-col">—</p> }
            </div>
          </div>
        }
      </div>
    }
  `,
  styles: [`
    .toolbar { padding: 16px 20px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--line); }
    .toolbar h1 { margin: 0; font-size: 22px; }
    .spacer { flex: 1; }
    .empty { padding: 48px 20px; text-align: center; }
    .sec-title { padding: 20px 20px 8px; margin: 0; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); }
    .job-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; padding: 0 20px 4px; }
    .job-card { background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 12px; display: flex; flex-direction: column; gap: 4px; }
    .job-head { display: flex; align-items: center; justify-content: space-between; }
    .status {
      padding: 2px 8px; border-radius: 999px; font-size: 10px;
      text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      border: 1px solid var(--line);
    }
    .status-open  { color: var(--primary); border-color: var(--primary); }
    .status-draft { color: var(--muted); }
    .status-closed{ color: #ef4444; border-color: #ef4444; }

    .kanban { display: grid; grid-template-columns: repeat(6, minmax(180px, 1fr)); gap: 8px; padding: 8px 20px 20px; overflow-x: auto; }
    .col { background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm); display: flex; flex-direction: column; min-height: 120px; }
    .col-head { padding: 8px 10px; border-bottom: 1px solid var(--line); display: flex; justify-content: space-between; align-items: baseline; }
    .col-body { padding: 6px; display: flex; flex-direction: column; gap: 6px; }
    .empty-col { color: var(--muted); margin: 12px 6px; }
    .app-card { background: var(--bg-3); border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; }
    .app-card.expanded { border-color: var(--primary); }
    .app-head { cursor: pointer; }
    .app-body { display: flex; flex-direction: column; gap: 6px; padding-top: 6px; border-top: 1px solid var(--line); }
    .app-body label { margin: 4px 0 0; }
    .row { display: flex; align-items: center; }
  `],
})
export class ManagementHiring {
  private api = inject(Api);

  jobs = signal<HrJob[]>([]);
  apps = signal<HrApplication[]>([]);
  expandedId = signal<number | null>(null);
  stages = STAGES;

  fbKind: Record<number, string> = {};
  fbBody: Record<number, string> = {};
  fbRating: Record<number, number> = {};

  activeApps = computed(() => this.apps().filter(a => a.stage !== 'hired' && a.stage !== 'rejected'));

  ngOnInit() { this.refresh(); }
  refresh() {
    this.api.listMyTeamHiring().subscribe(r => { this.jobs.set(r.jobs); this.apps.set(r.applications); });
  }
  countAt(stage: string) { return this.apps().filter(a => a.stage === stage).length; }
  appsAt(stage: string)  { return this.apps().filter(a => a.stage === stage); }
  toggle(a: HrApplication) {
    if (!a.id) return;
    this.expandedId.set(this.expandedId() === a.id ? null : a.id);
  }
  setStage(a: HrApplication, stage: string) {
    if (!a.id) return;
    this.api.setMyTeamApplicationStage(a.id, stage).subscribe(() => this.refresh());
  }
  submitFeedback(a: HrApplication) {
    if (!a.id) return;
    const body = (this.fbBody[a.id] || '').trim();
    if (!body) return;
    const rating = this.fbRating[a.id] || undefined;
    this.api.addMyTeamHiringFeedback(a.id, {
      kind: this.fbKind[a.id] || 'other',
      feedback: body,
      rating,
    }).subscribe(() => {
      this.fbBody[a.id!] = '';
      this.fbRating[a.id!] = 0;
      alert('Feedback saved.');
    });
  }
  stageLabel(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }
}
