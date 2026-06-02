import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { environment } from '@env/environment';
import { HrFeedbackEntry, HrPulseAggregate, HrPulseSurvey, HrSurveyQuestion } from '../../core/models';

type Tab = 'surveys' | 'feedback';

@Component({
  selector: 'app-hr-engagement',
  imports: [FormsModule],
  template: `
    <div class="toolbar">
      <h1>Engagement</h1>
      <span class="spacer"></span>
      @if (tab() === 'surveys') { <button class="primary" (click)="newSurvey()">+ New survey</button> }
    </div>

    <div class="tab-nav">
      @for (t of tabs; track t.key) {
        <button class="tab-btn" [class.active]="tab() === t.key" (click)="tab.set(t.key)">{{ t.label }}</button>
      }
    </div>

    <div class="content">
      @if (tab() === 'surveys') {
        <div class="layout">
          <aside class="survey-list">
            @for (s of surveys(); track s.id) {
              <button class="survey-item" [class.active]="selectedId() === s.id" (click)="select(s)">
                <strong>{{ s.title }}</strong>
                <span class="muted small">
                  <span class="status status-{{ s.status }}">{{ s.status }}</span>
                  · {{ s.is_anonymous ? 'anonymous' : 'identified' }}
                  · {{ s.response_count ?? 0 }} responses
                </span>
              </button>
            }
            @if (surveys().length === 0) { <p class="muted small" style="padding: 12px;">No surveys yet.</p> }
          </aside>

          <section class="survey-detail">
            @if (selected(); as s) {
              <div class="survey-card">
                <button class="group-head" (click)="formOpen.set(!formOpen())">
                  <span class="caret">{{ formOpen() ? '▾' : '▸' }}</span>
                  <span class="group-title">Survey setup</span>
                  <span class="muted small">{{ draftQuestions().length }} question{{ draftQuestions().length === 1 ? '' : 's' }}</span>
                </button>

                @if (formOpen()) {
                <input class="title-input" [ngModel]="s.title" (blur)="patch({ title: $any($event.target).value })" placeholder="Survey title" />

                <div class="config-row">
                  <select class="status-select" [ngModel]="s.status" (ngModelChange)="patch({ status: $event })" name="ss">
                    <option value="draft">Draft</option>
                    <option value="open">Open</option>
                    <option value="closed">Closed</option>
                  </select>
                  <select class="visibility-select"
                          [ngModel]="s.allow_external ? 'public' : 'internal'"
                          (ngModelChange)="patch({ allow_external: $event === 'public' ? 1 : 0 })"
                          name="vs">
                    <option value="internal">Internal only</option>
                    <option value="public">Public (link + embed)</option>
                  </select>
                  <label class="check"><input type="checkbox" [checked]="!!s.is_anonymous" (change)="patch({ is_anonymous: $any($event.target).checked ? 1 : 0 })" /> Anonymous</label>
                </div>

                @if (s.allow_external) {
                  @if (s.public_token) {
                    <div class="public-url">
                      <span class="muted small">Public link</span>
                      <a class="url" [href]="publicUrl(s)" target="_blank" rel="noopener">{{ publicUrl(s) }}</a>
                      <button class="ghost copy-btn" [class.copied]="copiedKey() === 'link'" (click)="copyLink(publicUrl(s), 'link')">
                        {{ copiedKey() === 'link' ? '✓ Copied' : 'Copy link' }}
                      </button>
                      <button class="ghost copy-btn" [class.copied]="copiedKey() === 'embed'" (click)="copyLink(embedSnippet(s), 'embed')">
                        {{ copiedKey() === 'embed' ? '✓ Copied' : 'Copy embed' }}
                      </button>
                    </div>
                  } @else {
                    <p class="muted small">Generating public link…</p>
                  }
                }

                <h3 class="sec">Questions</h3>
                @for (q of draftQuestions(); track q.id; let i = $index) {
                  <div class="qrow">
                    <select [(ngModel)]="q.type" (ngModelChange)="updateQuestions(s)" name="qt_{{ s.id }}_{{ i }}">
                      <option value="rating">Rating (1-5)</option>
                      <option value="text">Free text</option>
                    </select>
                    <input [(ngModel)]="q.label" (blur)="updateQuestions(s)" name="ql_{{ s.id }}_{{ i }}" placeholder="Question label" />
                    <button class="ghost icon-btn danger" (click)="removeQuestion(s, i)">✕</button>
                  </div>
                }
                <button class="ghost" (click)="addQuestion(s)">+ Add question</button>

                <h3 class="sec">Aggregate (rating questions)</h3>
                @if (loadingAgg()) { <p class="muted small">Loading…</p> }
                @else if (ratingRows().length === 0) {
                  <p class="muted small">No rating questions yet.</p>
                } @else {
                  <div class="bar-list">
                    @for (row of ratingRows(); track row.id) {
                      <div class="bar-row">
                        <span class="bar-label">{{ row.label || row.id }}</span>
                        <div class="bar-track"><div class="bar-fill" [style.width.%]="(row.avg ?? 0) / 5 * 100"></div></div>
                        <span class="bar-count">avg {{ row.avg ?? '—' }} · {{ row.count }} resp</span>
                      </div>
                    }
                  </div>
                }
                }

                <button class="group-head" (click)="responsesOpen.set(!responsesOpen())">
                  <span class="caret">{{ responsesOpen() ? '▾' : '▸' }}</span>
                  <span class="group-title">Responses</span>
                  <span class="muted small">{{ responses().length }} submitted</span>
                </button>

                @if (responsesOpen()) {
                  @if (loadingAgg()) {
                    <p class="muted small">Loading…</p>
                  } @else if (responses().length === 0) {
                    <p class="muted small">No responses yet. Open the survey, share the link, or wait for employees to fill it out from <code>/hr/me</code>.</p>
                  } @else {
                    <ul class="response-list">
                      @for (r of responses(); track r.id) {
                        <li class="response-item" [class.expanded]="expandedResponseId() === r.id">
                          <button class="response-head" (click)="toggleResponse(r.id)">
                            <span class="caret">{{ expandedResponseId() === r.id ? '▾' : '▸' }}</span>
                            @if (r.first_name || r.last_name) {
                              <strong>{{ r.first_name }} {{ r.last_name }}</strong>
                            } @else {
                              <strong class="anon">Anonymous</strong>
                            }
                            <span class="response-date muted small">{{ r.submitted_at }}</span>
                            <span class="response-summary muted small">{{ summaryFor(r) }}</span>
                          </button>
                          @if (expandedResponseId() === r.id) {
                            <div class="response-body">
                              @for (q of ratingQuestions(); track q.id) {
                                @let val = parseAnswers(r)[q.id];
                                @if (val !== undefined && val !== null && val !== '') {
                                  <div class="ans">
                                    <div class="ans-label">{{ q.label }}</div>
                                    <div class="ans-value rating-val">{{ val }} / 5</div>
                                  </div>
                                }
                              }
                              @for (q of textQuestions(); track q.id) {
                                @let val = parseAnswers(r)[q.id];
                                @if (val) {
                                  <div class="ans">
                                    <div class="ans-label">{{ q.label }}</div>
                                    <div class="ans-value text-val">{{ val }}</div>
                                  </div>
                                }
                              }
                            </div>
                          }
                        </li>
                      }
                    </ul>
                  }
                }

                <div class="card-footer">
                  <button class="ghost danger" (click)="delSurvey(s)">✕ Delete</button>
                </div>
              </div>
            } @else {
              <p class="muted small" style="padding: 24px;">Select a survey on the left, or create one.</p>
            }
          </section>
        </div>
      }

      @if (tab() === 'feedback') {
        @if (feedback().length === 0) {
          <p class="muted small">No feedback yet.</p>
        } @else {
          <table class="data">
            <thead><tr><th>Submitted</th><th>From</th><th>Category</th><th>Message</th><th>Status</th><th></th></tr></thead>
            <tbody>
              @for (f of feedback(); track f.id) {
                <tr>
                  <td class="muted small">{{ f.created_at }}</td>
                  <td>
                    @if (f.first_name) { <strong>{{ f.first_name }} {{ f.last_name }}</strong> }
                    @else { <span class="muted small"><em>anonymous</em></span> }
                  </td>
                  <td>{{ f.category }}</td>
                  <td class="msg">{{ f.message }}</td>
                  <td>
                    <select [ngModel]="f.status" (ngModelChange)="setFeedbackStatus(f, $event)" name="fs_{{ f.id }}">
                      <option value="new">New</option>
                      <option value="reviewed">Reviewed</option>
                      <option value="actioned">Actioned</option>
                      <option value="archived">Archived</option>
                    </select>
                  </td>
                  <td class="actions"><button class="ghost icon-btn danger" (click)="delFeedback(f)" title="Delete">✕</button></td>
                </tr>
              }
            </tbody>
          </table>
        }
      }
    </div>
  `,
  styles: [`
    .toolbar { padding: 16px 20px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--line); }
    .toolbar h1 { margin: 0; font-size: 22px; }
    .spacer { flex: 1; }

    .tab-nav { display: flex; gap: 4px; border-bottom: 1px solid var(--line); padding: 0 24px; }
    .tab-btn { padding: 14px 20px; background: none; border: none; color: var(--muted); cursor: pointer; font-size: 13px; position: relative; }
    .tab-btn.active { color: var(--primary); }
    .tab-btn.active::after { content: ''; position: absolute; bottom: -1px; left: 0; right: 0; height: 2px; background: var(--primary); }

    .content { padding: 20px; }

    .layout { display: grid; grid-template-columns: 280px 1fr; min-height: calc(100vh - 168px); }
    .survey-list { border-right: 1px solid var(--line); padding: 12px; display: flex; flex-direction: column; gap: 6px; overflow-y: auto; }
    .survey-item {
      display: flex; flex-direction: column; gap: 2px;
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
      padding: 10px 12px; text-align: left; color: var(--fg); cursor: pointer;
    }
    .survey-item:hover { border-color: var(--primary); }
    .survey-item.active { border-color: var(--primary); background: var(--bg-3); }
    .survey-detail { padding: 20px; }
    .survey-card {
      background: var(--bg-3);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 16px;
    }
    .survey-card .row { margin-bottom: 0; }
    .survey-card .sec:first-of-type { margin-top: 16px; }
    .title-input { width: 100%; margin-bottom: 10px; }
    .config-row {
      display: flex; align-items: center; gap: 12px;
      flex-wrap: wrap;
    }
    .status-select     { width: auto; flex: 0 0 140px; }
    .visibility-select { width: auto; flex: 0 0 200px; }
    .spacer-flex { flex: 1; }
    .card-footer {
      margin-top: 18px; padding-top: 14px;
      border-top: 1px solid var(--line);
      display: flex; justify-content: flex-end;
    }
    .group-head {
      display: flex; align-items: center; gap: 10px;
      width: 100%; padding: 10px 0; margin: 8px 0 4px;
      background: transparent; border: 0; border-bottom: 1px solid var(--line);
      color: var(--fg); cursor: pointer; text-align: left; font: inherit;
    }
    .group-head:hover { color: var(--primary); border-color: var(--primary); background: transparent; }
    .group-head .caret { color: var(--muted); font-size: 12px; min-width: 14px; }
    .group-head .group-title { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
    .group-head .muted { margin-left: auto; }
    .response-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .response-item {
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
      overflow: hidden;
    }
    .response-item.expanded { border-color: var(--primary); }
    .response-head {
      display: grid;
      grid-template-columns: 16px auto auto 1fr;
      gap: 12px; align-items: center;
      width: 100%; padding: 10px 14px;
      background: transparent; border: 0; color: var(--fg);
      cursor: pointer; text-align: left; font: inherit;
    }
    .response-head:hover { background: rgba(212,169,58,0.04); border: 0; }
    .response-head .caret { color: var(--muted); font-size: 12px; }
    .response-head .anon { color: #a78bfa; }
    .response-head .response-date { white-space: nowrap; }
    .response-head .response-summary { text-align: right; white-space: nowrap; }
    .response-body {
      padding: 10px 14px 14px;
      border-top: 1px solid var(--line);
      display: flex; flex-direction: column; gap: 10px;
    }
    .ans { display: flex; flex-direction: column; gap: 2px; }
    .ans-label { color: var(--muted); font-size: 12px; }
    .ans-value { font-size: 13px; }
    .rating-val { color: var(--primary); font-weight: 700; font-size: 14px; }
    .text-val { white-space: pre-wrap; line-height: 1.5; }
    .copy-btn.copied {
      color: var(--primary);
      border-color: var(--primary);
      background: rgba(212,169,58,0.12);
    }
    .public-url {
      display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
      padding: 8px 10px; margin-top: 10px;
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
    }
    .public-url .url {
      flex: 1; min-width: 200px;
      color: var(--primary); font-family: var(--mono, monospace);
      font-size: 12px; word-break: break-all; text-decoration: none;
    }
    .public-url .url:hover { text-decoration: underline; }
    h3.sec { font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; margin: 22px 0 10px; }
    .row { display: flex; align-items: center; gap: 8px; }
    .check {
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 13px; color: var(--fg);
      text-transform: none; letter-spacing: normal;
      white-space: nowrap; cursor: pointer; margin: 0;
    }
    .check input[type="checkbox"] {
      width: 16px; height: 16px;
      flex: 0 0 16px;
      margin: 0; padding: 0;
      border-radius: 3px;
      cursor: pointer;
    }

    .qrow { display: grid; grid-template-columns: 200px 1fr 40px; gap: 8px; align-items: center; margin-bottom: 6px; }

    .distrib { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; font-size: 13px; }
    .distrib code { background: var(--bg-2); padding: 1px 6px; border-radius: 4px; font-size: 12px; }
    .distrib .warn { color: #f97316; }
    .link-row { display: flex; gap: 6px; align-items: center; margin-top: 4px; }
    .link-row input { flex: 1; }
    .embed { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; align-items: flex-start; }
    .embed pre {
      width: 100%;
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
      padding: 10px 12px; font-size: 12px;
      white-space: pre-wrap; word-break: break-all; margin: 0;
    }

    .status {
      display: inline-block; padding: 2px 8px; border-radius: 999px;
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      border: 1px solid var(--line);
    }
    .status-draft  { color: var(--muted); }
    .status-open   { color: var(--primary); border-color: var(--primary); }
    .status-closed { color: var(--muted); border-color: var(--muted); }

    .bar-list { display: flex; flex-direction: column; gap: 6px; }
    .bar-row { display: flex; align-items: center; gap: 12px; }
    .bar-label { min-width: 220px; font-size: 13px; }
    .bar-track { flex: 1; height: 16px; background: var(--bg-3); border-radius: 999px; overflow: hidden; border: 1px solid var(--line); }
    .bar-fill { height: 100%; background: var(--primary); transition: width 0.3s ease; }
    .bar-count { min-width: 140px; text-align: right; font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }

    table.data .msg { white-space: pre-wrap; max-width: 480px; }
    .actions { text-align: right; }
  `],
})
export class HrEngagement {
  private api = inject(Api);

  readonly tabs: { key: Tab; label: string }[] = [
    { key: 'surveys',  label: 'Pulse surveys' },
    { key: 'feedback', label: 'Feedback inbox' },
  ];
  tab = signal<Tab>('surveys');

  surveys = signal<HrPulseSurvey[]>([]);
  selectedId = signal<number | null>(null);
  aggregate = signal<HrPulseAggregate>({});
  responses = signal<any[]>([]);
  loadingAgg = signal(false);

  feedback = signal<HrFeedbackEntry[]>([]);

  /** Mutable, stable-reference list of questions for the currently-selected survey. */
  draftQuestions = signal<HrSurveyQuestion[]>([]);

  selected = computed(() => this.surveys().find(s => s.id === this.selectedId()) ?? null);
  aggKeys = computed(() => Object.keys(this.aggregate()));
  /**
   * Rating-question rows for the aggregate panel. Sourced from draftQuestions
   * so the labels and ordering always match what's shown in the Questions list,
   * with server-side avg / count looked up by question id.
   */
  ratingRows = computed(() => {
    const agg = this.aggregate();
    return this.draftQuestions()
      .filter(q => q.type === 'rating')
      .map(q => ({
        id: q.id,
        label: q.label,
        avg: agg[q.id]?.avg ?? null,
        count: agg[q.id]?.count ?? 0,
      }));
  });

  ngOnInit() {
    this.refreshSurveys();
    this.refreshFeedback();
  }

  refreshSurveys() {
    this.api.listHrPulseSurveys().subscribe(r => {
      this.surveys.set(r.surveys);
      if (this.selectedId() === null && r.surveys.length > 0) this.select(r.surveys[0]);
    });
  }
  refreshFeedback() {
    this.api.listHrFeedback().subscribe(r => this.feedback.set(r.feedback));
  }

  questionsOf(s: HrPulseSurvey): HrSurveyQuestion[] {
    const raw = s.questions_json;
    if (Array.isArray(raw)) return raw;
    try { return JSON.parse((raw as string) || '[]'); } catch { return []; }
  }
  labelFor(s: HrPulseSurvey, qid: string): string {
    const q = this.questionsOf(s).find(x => x.id === qid);
    return q?.label ?? qid;
  }

  select(s: HrPulseSurvey) {
    this.selectedId.set(s.id ?? null);
    this.draftQuestions.set(this.deepCloneQuestions(s));
    if (!s.id) return;
    this.loadingAgg.set(true);
    this.api.getHrPulseSurveyResponses(s.id).subscribe(r => {
      this.aggregate.set(r.aggregate);
      this.responses.set(r.responses || []);
      this.loadingAgg.set(false);
      // If responses exist, focus the manager on them; otherwise show the setup form.
      const hasResponses = (r.responses || []).length > 0;
      this.responsesOpen.set(hasResponses);
      this.formOpen.set(!hasResponses);
    });
  }
  parseAnswers(r: any): Record<string, any> {
    if (!r?.answers_json) return {};
    try { return JSON.parse(r.answers_json) || {}; } catch { return {}; }
  }
  textQuestions(): HrSurveyQuestion[] {
    return this.draftQuestions().filter(q => q.type === 'text');
  }
  ratingQuestions(): HrSurveyQuestion[] {
    return this.draftQuestions().filter(q => q.type === 'rating');
  }

  expandedResponseId = signal<number | null>(null);
  formOpen = signal(true);
  responsesOpen = signal(false);

  toggleResponse(id: number | null | undefined) {
    if (!id) return;
    this.expandedResponseId.set(this.expandedResponseId() === id ? null : id);
  }
  /** One-line preview shown on the collapsed row: average rating + word count of free text. */
  summaryFor(r: any): string {
    const ans = this.parseAnswers(r);
    const ratings = this.ratingQuestions().map(q => ans[q.id]).filter(v => typeof v === 'number');
    const avg = ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) : null;
    const textBits = this.textQuestions().filter(q => !!ans[q.id]).length;
    const parts: string[] = [];
    if (avg !== null) parts.push(`avg ${avg}/5`);
    if (textBits > 0) parts.push(`${textBits} comment${textBits === 1 ? '' : 's'}`);
    return parts.join(' · ');
  }
  private deepCloneQuestions(s: HrPulseSurvey): HrSurveyQuestion[] {
    return this.questionsOf(s).map(q => ({ ...q }));
  }

  newSurvey() {
    this.api.createHrPulseSurvey({ title: 'New pulse survey', status: 'draft', is_anonymous: 1 }).subscribe(r => {
      this.api.listHrPulseSurveys().subscribe(rr => {
        this.surveys.set(rr.surveys);
        const s = rr.surveys.find(x => x.id === r.id);
        if (s) this.select(s);
      });
    });
  }

  patch(p: Partial<HrPulseSurvey>) {
    const id = this.selectedId();
    if (!id) return;
    this.api.updateHrPulseSurvey(id, p).subscribe(() => this.refreshSurveys());
  }

  delSurvey(s: HrPulseSurvey) {
    if (!s.id) return;
    if (!confirm(`Delete "${s.title}"? All responses will be lost.`)) return;
    this.api.deleteHrPulseSurvey(s.id).subscribe(() => {
      this.selectedId.set(null);
      this.refreshSurveys();
    });
  }

  addQuestion(s: HrPulseSurvey) {
    if (!s.id) return;
    const list = this.draftQuestions();
    const next: HrSurveyQuestion = {
      id: 'q' + (list.length + 1) + '_' + Date.now().toString(36),
      type: 'rating',
      label: 'New question',
    };
    this.draftQuestions.set([...list, next]);
    this.persistDraft(s);
  }
  removeQuestion(s: HrPulseSurvey, idx: number) {
    if (!s.id) return;
    const list = [...this.draftQuestions()];
    list.splice(idx, 1);
    this.draftQuestions.set(list);
    this.persistDraft(s);
  }
  updateQuestions(s: HrPulseSurvey) {
    if (!s.id) return;
    this.persistDraft(s);
  }
  private persistDraft(s: HrPulseSurvey) {
    if (!s.id) return;
    const payload = this.draftQuestions();
    this.api.updateHrPulseSurvey(s.id, { questions: payload } as any).subscribe(() => {
      // Mirror the saved questions onto the survey object so the list view stays consistent
      // without forcing a full refetch (which would race with rapid edits).
      this.surveys.update(list => list.map(x => x.id === s.id ? { ...x, questions_json: JSON.stringify(payload) } : x));
      // Refresh the aggregate + raw responses so the panel stays accurate.
      this.api.getHrPulseSurveyResponses(s.id!).subscribe(r => {
        this.aggregate.set(r.aggregate);
        this.responses.set(r.responses || []);
      });
    });
  }

  publicUrl(s: HrPulseSurvey): string {
    if (!s.public_token) return '';
    return `${window.location.origin}${environment.basePath}/surveys/${s.public_token}`;
  }
  embedSnippet(s: HrPulseSurvey): string {
    const url = this.publicUrl(s);
    if (!url) return '';
    return `<iframe src="${url}" width="100%" height="640" style="border:0;border-radius:8px;" loading="lazy" title="${(s.title || 'Survey').replace(/"/g, '&quot;')}"></iframe>`;
  }
  copiedKey = signal<'link' | 'embed' | null>(null);
  private copiedTimer: ReturnType<typeof setTimeout> | null = null;
  copyLink(text: string, key: 'link' | 'embed' = 'link') {
    if (!text) return;
    const flash = () => {
      this.copiedKey.set(key);
      if (this.copiedTimer) clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => this.copiedKey.set(null), 1500);
    };
    navigator.clipboard?.writeText(text).then(flash, () => alert(text));
  }

  setFeedbackStatus(f: HrFeedbackEntry, status: 'new'|'reviewed'|'actioned'|'archived') {
    if (!f.id) return;
    this.api.updateHrFeedback(f.id, status).subscribe(() => this.refreshFeedback());
  }
  delFeedback(f: HrFeedbackEntry) {
    if (!f.id) return;
    if (!confirm('Delete this feedback entry?')) return;
    this.api.deleteHrFeedback(f.id).subscribe(() => this.refreshFeedback());
  }
}
