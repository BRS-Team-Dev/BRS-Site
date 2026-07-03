import { Component, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import { DialogService } from '../../core/dialog';
import { environment } from '@env/environment';
import { FeedbackAnswer, FeedbackForm, FeedbackKind, FeedbackQuestion, FeedbackQuestionType, FeedbackResponse, ServiceOffering } from '../../core/models';

const QTYPE_OPTIONS: { key: FeedbackQuestionType; label: string; needsOptions: boolean }[] = [
  { key: 'short_text',    label: 'Short text',    needsOptions: false },
  { key: 'long_text',     label: 'Long text',     needsOptions: false },
  { key: 'rating',        label: 'Rating (1–5)',  needsOptions: false },
  { key: 'yes_no',        label: 'Yes / No',      needsOptions: false },
  { key: 'single_choice', label: 'Single choice', needsOptions: true  },
  { key: 'multi_choice',  label: 'Multiple choice', needsOptions: true },
];

/**
 * Per-kind builder rules — this is what actually makes questionnaire /
 * form / survey / poll behave differently instead of being labels.
 *
 * - poll         → one question, choice-only. Add-card hides after 1.
 * - survey       → rating + choice types (structured multi-question).
 * - form         → free-form open feedback (text + rating).
 * - questionnaire→ everything goes.
 */
const KIND_RULES: Record<FeedbackKind, {
  allowedTypes: FeedbackQuestionType[];
  maxQuestions: number | null;
  defaultType: FeedbackQuestionType;
  hint: string;
}> = {
  poll: {
    allowedTypes: ['single_choice', 'multi_choice'],
    maxQuestions: 1,
    defaultType: 'single_choice',
    hint: 'Polls are one quick choice question. Options appear as tap targets.',
  },
  survey: {
    allowedTypes: ['rating', 'yes_no', 'single_choice', 'multi_choice', 'short_text'],
    maxQuestions: null,
    defaultType: 'rating',
    hint: 'Surveys focus on structured ratings and multiple-choice answers.',
  },
  form: {
    allowedTypes: ['short_text', 'long_text', 'rating', 'yes_no'],
    maxQuestions: null,
    defaultType: 'long_text',
    hint: 'Feedback forms lean on open text with a rating or two.',
  },
  questionnaire: {
    allowedTypes: ['short_text', 'long_text', 'rating', 'yes_no', 'single_choice', 'multi_choice'],
    maxQuestions: null,
    defaultType: 'short_text',
    hint: 'Questionnaires can mix every question type.',
  },
};

/**
 * /admin/feedback/:id — feedback builder.
 *
 * Left: form metadata (title, kind, description, published flag,
 * thank-you message). Right: question list with reorder + per-row
 * edit + add-new card.
 *
 * Title saves on blur; question edits save on blur. Keeps the UX
 * forgiving — no monolithic "Save" button.
 */
@Component({
  selector: 'app-feedback-builder',
  imports: [FormsModule, RouterLink, DecimalPipe],
  template: `
    <div class="toolbar">
      <button class="ghost" routerLink="/admin/feedback">← Back</button>
      @if (form()) {
        <h1>{{ form()!.title || 'Untitled' }}</h1>
        <span class="kind-pill" [attr.data-kind]="form()!.kind">{{ form()!.kind }}</span>
      } @else {
        <h1>Loading…</h1>
      }
      <span class="spacer"></span>
      @if (saving()) { <span class="muted small">Saving…</span> }
    </div>

    @if (form(); as f) {
      <div class="layout-2col">
        <!-- ── Left: form metadata card ─────────────────────── -->
        <aside class="card">
          <h2>Form details</h2>

          <label>Title</label>
          <input [(ngModel)]="draft.title" name="ft" (blur)="saveMeta('title')" />

          <label>Type</label>
          <select [(ngModel)]="draft.kind" name="fk" (change)="saveMeta('kind')">
            <option value="questionnaire">Questionnaire</option>
            <option value="form">Feedback form</option>
            <option value="survey">Survey</option>
            <option value="poll">Poll</option>
          </select>
          <p class="muted small kind-hint">{{ kindHint() }}</p>

          <label>Description</label>
          <textarea rows="3" [(ngModel)]="draft.description" name="fd" (blur)="saveMeta('description')"></textarea>

          <label>Submit button label</label>
          <input [(ngModel)]="draft.submit_label" name="fsl" (blur)="saveMeta('submit_label')" placeholder="Submit" />

          <label>Thank-you message</label>
          <textarea rows="2" [(ngModel)]="draft.thank_you_message" name="fty" (blur)="saveMeta('thank_you_message')"
                    placeholder="Thanks — your feedback has been received."></textarea>

          <label class="check">
            <input type="checkbox" [(ngModel)]="draft.is_published" name="fip" (change)="saveMeta('is_published')" />
            <span>Published</span>
          </label>
          <p class="muted small">Unpublished forms reject public submissions.</p>

          <hr />

          <h2>Attach to</h2>
          <p class="muted small" style="margin-top: -8px;">
            Broadcast rule — decide who sees this form on their feedback
            tab automatically. Pick one; per-row attaches still work
            alongside whichever mode is selected.
          </p>

          <div class="scope-list">
            <label class="scope-opt">
              <input type="radio" name="scope" value="none"
                     [checked]="attachScope() === 'none'"
                     (change)="setAttachScope('none')" />
              <span>None <span class="muted small">(only per-row attaches)</span></span>
            </label>
            <label class="scope-opt">
              <input type="radio" name="scope" value="all_clients"
                     [checked]="attachScope() === 'all_clients'"
                     (change)="setAttachScope('all_clients')" />
              <span>All clients</span>
            </label>
            <label class="scope-opt">
              <input type="radio" name="scope" value="all_leads"
                     [checked]="attachScope() === 'all_leads'"
                     (change)="setAttachScope('all_leads')" />
              <span>All leads</span>
            </label>
            <label class="scope-opt">
              <input type="radio" name="scope" value="service"
                     [checked]="attachScope() === 'service'"
                     (change)="setAttachScope('service')" />
              <span>Clients + leads with a specific service</span>
            </label>
          </div>

          @if (attachScope() === 'service') {
            <label style="margin-top: 10px;">Service</label>
            <select [ngModel]="draft.service_offering_id ?? null"
                    (ngModelChange)="onServiceChange($event)"
                    name="svc">
              <option [ngValue]="null">— pick a service —</option>
              @for (s of services(); track s.id) {
                <option [ngValue]="s.id">{{ s.name }}</option>
              }
            </select>
          }

          <hr />

          <h2>Public link</h2>
          <p class="muted small">Anyone with this URL can fill the form.</p>
          <div class="copy-row">
            <input readonly [value]="publicUrl()" />
            <button class="ghost" (click)="copyUrl()">Copy</button>
            <a class="ghost" [href]="publicUrl()" target="_blank" rel="noopener"
               title="Open in new tab">Open ↗</a>
          </div>
          @if (copyMsg()) { <p class="success-msg small">{{ copyMsg() }}</p> }
        </aside>

        <!-- ── Right: questions + responses (tabbed) ────────── -->
        <section class="questions-pane">
          <!-- Tab strip: swaps the pane body between the question
               editor and the responses viewer. Response count is
               shown in the tab label so it's visible without needing
               to open the tab. -->
          <div class="pane-tabs">
            <button type="button" class="pane-tab"
                    [class.active]="builderTab() === 'questions'"
                    (click)="setBuilderTab('questions')">
              Questions <span class="muted small">· {{ questions().length }}</span>
            </button>
            <button type="button" class="pane-tab"
                    [class.active]="builderTab() === 'responses'"
                    (click)="setBuilderTab('responses')">
              Responses <span class="muted small">· {{ responses().length }}</span>
            </button>
          </div>

          @if (builderTab() === 'questions') {

          @if (questions().length === 0) {
            <div class="card empty-card">
              <p class="muted">No questions yet. Add one below to start.</p>
            </div>
          }

          @for (q of questions(); track q.id) {
            <div class="card q-card">
              <div class="q-head">
                <div class="q-num">{{ $index + 1 }}</div>
                <select [ngModel]="q.type" (ngModelChange)="updateQ(q, 'type', $event)" [name]="'qt_' + q.id">
                  @for (t of allowedQtypes(); track t.key) {
                    <option [value]="t.key">{{ t.label }}</option>
                  }
                </select>
                <label class="inline-check">
                  <input type="checkbox" [ngModel]="!!q.is_required"
                         (ngModelChange)="updateQ(q, 'is_required', $event ? 1 : 0)"
                         [name]="'qr_' + q.id" />
                  Required
                </label>
                <span class="spacer"></span>
                <button class="ghost icon-btn danger" (click)="deleteQ(q)" title="Delete">✕</button>
              </div>
              <label>Question</label>
              <input [ngModel]="q.label" (ngModelChange)="q.label = $event" (blur)="updateQ(q, 'label', q.label)" [name]="'ql_' + q.id" />
              <label>Help text (optional)</label>
              <input [ngModel]="q.help_text" (ngModelChange)="q.help_text = $event" (blur)="updateQ(q, 'help_text', q.help_text)" [name]="'qh_' + q.id" />
              @if (needsOptions(q.type)) {
                <label>Options</label>
                <div class="opt-rows">
                  @for (opt of ensureOptions(q); track $index; let i = $index) {
                    <div class="opt-row">
                      <input type="text"
                             [ngModel]="q.options![i]"
                             (ngModelChange)="setOption(q, i, $event)"
                             (blur)="updateQ(q, 'options_json', q.options)"
                             [name]="'qo_' + q.id + '_' + i"
                             [placeholder]="'Option ' + (i + 1)" />
                      <button type="button" class="ghost icon-btn danger"
                              (click)="removeOption(q, i)"
                              [disabled]="(q.options?.length || 0) <= 1"
                              title="Remove">✕</button>
                    </div>
                  }
                  <button type="button" class="ghost small add-opt"
                          (click)="addOption(q)">+ Add option</button>
                </div>
              }
            </div>
          }

          @if (canAddQuestion()) {
            <div class="card add-card">
              <label>New question</label>
              <div class="row" style="gap: 8px;">
                <input [(ngModel)]="newQLabel" name="newq" placeholder="e.g. How did you hear about us?"
                       (keyup.enter)="addQuestion()" />
                <select [(ngModel)]="newQType" name="newq_t" style="min-width: 160px; width: auto;">
                  @for (t of allowedQtypes(); track t.key) {
                    <option [value]="t.key">{{ t.label }}</option>
                  }
                </select>
                <button class="primary" [disabled]="!newQLabel.trim() || addingQ()" (click)="addQuestion()">
                  {{ addingQ() ? 'Adding…' : '+ Add' }}
                </button>
              </div>
            </div>
          } @else {
            <p class="muted small cap-note">
              {{ draft.kind === 'poll' ? 'Polls carry a single question.' : 'Maximum number of questions reached.' }}
            </p>
          }

          } @else if (builderTab() === 'responses') {

          <!-- Analytics — only meaningful for polls + surveys. Free-form
               forms and questionnaires are mostly text so we skip
               aggregation and jump straight to the response list. -->
          @if (showAnalytics()) {
            <div class="card analytics-card">
              <h2>Analytics</h2>
              <p class="muted small" style="margin-top: -8px;">
                Aggregated across {{ responses().length }} submission{{ responses().length === 1 ? '' : 's' }}.
              </p>

              @for (q of visibleAnalytics(); track q.id) {
                <div class="analytics-block" [class.collapsed]="isCollapsed(q.id!)">
                  <div class="analytics-head" (click)="toggleBlock(q.id!)">
                    <span class="caret">›</span>
                    <strong>{{ q.label }}</strong>
                    @if (q.type === 'rating') {
                      <span class="pill avg">Avg {{ ratingAverage(q) | number:'1.1-1' }} / 5</span>
                    }
                    <span class="muted small">{{ q.type.replace('_', ' ') }}</span>
                  </div>
                  @if (!isCollapsed(q.id!)) {
                    <div class="bar-list">
                      @for (row of statsFor(q); track row.label) {
                        <div class="bar-row">
                          <span class="bar-label">{{ row.label }}</span>
                          <div class="bar-track">
                            <div class="bar-fill" [style.width.%]="row.pct"></div>
                          </div>
                          <span class="bar-count">{{ row.count }}</span>
                          <span class="bar-pct muted small">{{ row.pct | number:'1.0-0' }}%</span>
                        </div>
                      }
                    </div>
                  }
                </div>
              }

              @if (aggregatableQuestions().length > 1) {
                <button type="button" class="ghost view-all-btn"
                        (click)="analyticsShowAll.set(!analyticsShowAll())">
                  @if (analyticsShowAll()) {
                    Hide extra analytics
                  } @else {
                    View all {{ aggregatableQuestions().length }} analytics ↓
                  }
                </button>
              }

              @if (aggregatableQuestions().length === 0) {
                <p class="muted small">No aggregatable questions — this form is all free-text.</p>
              }
            </div>
          }

          <div class="card responses-card">
            <div class="row" style="align-items: center;">
              <h2 style="margin: 0; flex: 1;">Responses</h2>
              <span class="muted small">{{ responses().length }}</span>
              <button class="ghost small" (click)="loadResponses()" [disabled]="loadingResponses()">
                {{ loadingResponses() ? 'Refreshing…' : 'Refresh' }}
              </button>
            </div>

            @if (loadingResponses() && responses().length === 0) {
              <p class="muted small">Loading…</p>
            } @else if (responses().length === 0) {
              <p class="muted small">No submissions yet.</p>
            } @else {
              <div class="responses-list">
                @for (r of responses(); track r.id) {
                  <div class="response" [class.open]="expandedResponse() === r.id">
                    <div class="response-head" (click)="toggleResponse(r.id)">
                      <span class="caret">›</span>
                      <div class="response-meta">
                        <strong>{{ r.submitted_at }}</strong>
                        @if (r.client_name) {
                          <span class="badge client">Client · {{ r.client_name }}</span>
                        } @else if (r.lead_name) {
                          <span class="badge lead">Lead · {{ r.lead_name }}</span>
                        } @else {
                          <span class="muted small">Anonymous</span>
                        }
                      </div>
                      @if (r.ip_address) { <span class="muted small">{{ r.ip_address }}</span> }
                    </div>
                    @if (expandedResponse() === r.id) {
                      <div class="response-body">
                        @for (a of (r.answers || []); track a.id) {
                          <div class="answer-row">
                            <label>{{ questionLabel(a.question_id) }}</label>
                            <div>{{ formatAnswer(a) }}</div>
                          </div>
                        }
                        @if ((r.answers || []).length === 0) {
                          <p class="muted small">No answers recorded.</p>
                        }
                      </div>
                    }
                  </div>
                }
              </div>
            }
          </div>

          }
        </section>
      </div>
    }
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .toolbar { padding: 16px 20px; display: flex; align-items: center; gap: 12px; border-bottom: 1px solid var(--line); }
    .toolbar h1 { margin: 0; font-size: 20px; }
    .kind-pill {
      padding: 2px 10px; border-radius: 999px;
      font-size: 11px; font-weight: 600; letter-spacing: 0.3px;
      background: var(--bg-2); color: var(--muted);
    }
    .kind-pill[data-kind="questionnaire"] { background: color-mix(in oklab, #8aa9ff, transparent 80%); color: #8aa9ff; }
    .kind-pill[data-kind="form"]          { background: color-mix(in oklab, var(--primary), transparent 78%); color: var(--primary); }
    .kind-pill[data-kind="survey"]        { background: color-mix(in oklab, var(--success), transparent 78%); color: var(--success); }
    .kind-pill[data-kind="poll"]          { background: color-mix(in oklab, var(--warning), transparent 78%); color: var(--warning); }

    .card h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;
      color: var(--muted); margin: 0 0 12px 0; font-weight: 600; }
    .card label { display: block; margin-top: 12px; color: var(--muted);
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
    .card hr { border: none; border-top: 1px solid var(--line); margin: 20px 0; }
    .card .check { display: inline-flex; align-items: center; gap: 8px; cursor: pointer;
      color: var(--fg); margin-top: 14px; text-transform: none; letter-spacing: normal; font-size: 14px; }
    .copy-row { display: flex; gap: 6px; align-items: stretch; }
    .copy-row input { flex: 1; font-family: "JetBrains Mono", monospace; font-size: 12px; }
    .copy-row a.ghost {
      display: inline-flex; align-items: center; padding: 0 12px;
      border: 1px solid var(--line); border-radius: var(--radius-sm);
      color: var(--fg); text-decoration: none; font-size: 13px;
    }
    .copy-row a.ghost:hover { background: var(--bg-3); border-color: var(--primary); }

    .pane-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--line);
      margin-bottom: 16px; }
    .pane-tab { background: transparent; border: 0; padding: 10px 14px;
      cursor: pointer; color: var(--muted); font-size: 13px; font-weight: 500;
      border-bottom: 2px solid transparent; margin-bottom: -1px; }
    .pane-tab:hover { color: var(--fg); }
    .pane-tab.active { color: var(--fg); border-bottom-color: var(--primary); }

    .questions-pane { display: flex; flex-direction: column; gap: 12px; }
    .empty-card { text-align: center; padding: 28px; }
    .q-card { padding: 16px 20px; }
    .q-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
    .q-num { width: 24px; height: 24px; border-radius: 50%;
      background: var(--bg-3); color: var(--muted); display: inline-flex;
      align-items: center; justify-content: center; font-size: 12px; font-weight: 700; }
    .q-head select { width: auto; min-width: 160px; }
    /* NOTE on specificity: '.card label { text-transform: uppercase }'
       (0,2,0) beats a bare '.inline-check' (0,1,0), so the reset only
       lands with a matching selector. Also nowrap so the label never
       drops the word onto its own line under the checkbox. */
    label.inline-check, .card label.inline-check {
      display: inline-flex; align-items: center; gap: 6px;
      color: var(--fg); font-size: 13px; cursor: pointer;
      font-weight: 500;
      text-transform: none; letter-spacing: normal;
      white-space: nowrap;
      margin: 0;
    }
    label.inline-check input { width: auto; margin: 0; }

    /* Attach-to scope picker — vertical list of radio rows. Overrides
       the metadata card's 'label { text-transform: uppercase }' rule
       so the option text renders normally. */
    .scope-list { display: flex; flex-direction: column; gap: 8px;
      margin-top: 8px; }
    .card label.scope-opt {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 10px; margin: 0;
      border: 1px solid var(--line); border-radius: var(--radius-sm);
      background: var(--bg-2); cursor: pointer;
      color: var(--fg); font-size: 14px; font-weight: 500;
      text-transform: none; letter-spacing: normal;
      white-space: nowrap;
    }
    .card label.scope-opt:hover { border-color: var(--primary); }
    .card label.scope-opt input { width: auto; margin: 0; flex-shrink: 0; }
    .card label.scope-opt:has(input:checked) {
      border-color: var(--primary);
      background: color-mix(in oklab, var(--primary), transparent 88%);
    }

    .opt-rows { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
    .opt-row  { display: flex; align-items: center; gap: 6px; }
    .opt-row input { flex: 1; }
    .opt-row .icon-btn { flex-shrink: 0; }
    .add-opt { align-self: flex-start; margin-top: 4px; padding: 4px 10px; font-size: 12px; }
    .add-card { background: var(--bg-2); border-style: dashed; }
    .add-card .row { display: flex; align-items: center; }
    .add-card input { flex: 1; }
    .cap-note { text-align: center; padding: 12px; margin: 0;
      background: var(--bg-2); border: 1px dashed var(--line); border-radius: var(--radius-sm); }
    .kind-hint { margin: 4px 0 0; }

    /* Analytics panel — sits above the raw response list on polls +
       surveys. One .analytics-block per aggregatable question. */
    .analytics-card { margin-bottom: 12px; }
    .analytics-block { padding: 14px 0; border-top: 1px solid var(--line); }
    .analytics-block:first-of-type { border-top: 0; }
    .analytics-head { display: flex; align-items: center; gap: 10px;
      margin-bottom: 10px; cursor: pointer;
      user-select: none; }
    .analytics-head:hover strong { color: var(--primary); }
    .analytics-head strong { font-size: 14px; flex: 1; transition: color .12s; }
    .analytics-head .muted { text-transform: capitalize; }
    .analytics-head .caret { display: inline-block; transition: transform .12s;
      color: var(--muted); font-size: 16px; line-height: 1; width: 12px;
      transform: rotate(90deg); }
    .analytics-block.collapsed .analytics-head { margin-bottom: 0; }
    .analytics-block.collapsed .analytics-head .caret { transform: rotate(0); }
    .analytics-head .pill.avg { background: color-mix(in oklab, var(--primary), transparent 78%);
      color: var(--primary); padding: 2px 10px; border-radius: 999px;
      font-size: 11px; font-weight: 700; }

    .view-all-btn {
      width: 100%; margin-top: 10px; padding: 8px;
      border: 1px dashed var(--line); border-radius: var(--radius-sm);
      background: transparent; color: var(--muted); cursor: pointer;
      font-size: 13px;
    }
    .view-all-btn:hover { color: var(--primary); border-color: var(--primary); }

    .bar-list { display: flex; flex-direction: column; gap: 6px; }
    .bar-row  { display: grid; grid-template-columns: 60px 1fr 40px 44px;
      align-items: center; gap: 10px; font-size: 13px; }
    .bar-label { color: var(--fg); overflow: hidden; text-overflow: ellipsis;
      white-space: nowrap; }
    .bar-track { position: relative; height: 8px; background: var(--bg-3);
      border-radius: 999px; overflow: hidden; }
    .bar-fill  { position: absolute; top: 0; left: 0; height: 100%;
      background: var(--primary); border-radius: 999px;
      transition: width .2s ease; }
    .bar-count { text-align: right; font-variant-numeric: tabular-nums;
      color: var(--fg); font-weight: 600; }
    .bar-pct   { text-align: right; font-variant-numeric: tabular-nums; }

    .responses-card .responses-list { display: flex; flex-direction: column;
      gap: 6px; margin-top: 10px; }
    .response { border: 1px solid var(--line); border-radius: var(--radius-sm);
      background: var(--bg); overflow: hidden; }
    .response-head { display: flex; align-items: center; gap: 10px;
      padding: 10px 12px; cursor: pointer; }
    .response-head:hover { background: var(--bg-2); }
    .response-head .caret { display: inline-block; transition: transform .12s;
      color: var(--muted); font-size: 14px; }
    .response.open .response-head .caret { transform: rotate(90deg); }
    .response-meta { flex: 1; display: flex; align-items: center; gap: 8px; }
    .badge { padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; }
    .badge.client { background: color-mix(in oklab, var(--primary), transparent 78%); color: var(--primary); }
    .badge.lead   { background: color-mix(in oklab, var(--success), transparent 78%); color: var(--success); }
    .response-body { padding: 12px 14px 14px; border-top: 1px solid var(--line);
      background: var(--bg-2); }
    .answer-row { padding: 6px 0; }
    .answer-row label { display: block; color: var(--muted);
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
      margin: 0 0 3px 0; }
  `],
})
export class FeedbackBuilder {
  private api    = inject(Api);
  private route  = inject(ActivatedRoute);
  private router = inject(Router);
  private dialog = inject(DialogService);

  readonly qtypeOptions = QTYPE_OPTIONS;

  /** Question types allowed for the current form's kind. */
  allowedQtypes(): { key: FeedbackQuestionType; label: string; needsOptions: boolean }[] {
    const kind = (this.draft.kind ?? 'form') as FeedbackKind;
    const allowed = KIND_RULES[kind]?.allowedTypes ?? [];
    return this.qtypeOptions.filter(o => allowed.includes(o.key));
  }

  /** Max questions this kind can carry (null = unlimited). */
  maxQuestions(): number | null {
    const kind = (this.draft.kind ?? 'form') as FeedbackKind;
    return KIND_RULES[kind]?.maxQuestions ?? null;
  }

  /** Whether the add-question card should be shown given the kind's cap. */
  canAddQuestion(): boolean {
    const cap = this.maxQuestions();
    if (cap == null) return true;
    return this.questions().length < cap;
  }

  /** Short one-liner shown under the type picker so the user knows
   *  why the question type dropdown just changed. */
  kindHint(): string {
    const kind = (this.draft.kind ?? 'form') as FeedbackKind;
    return KIND_RULES[kind]?.hint ?? '';
  }

  form      = signal<FeedbackForm | null>(null);
  questions = signal<FeedbackQuestion[]>([]);
  services  = signal<ServiceOffering[]>([]);
  saving    = signal(false);
  copyMsg   = signal<string | null>(null);

  /** Service picker in the Attach-to section fires this. Because the
   *  saveMeta path reads from `draft`, we set the draft first then
   *  reuse the shared field-persist helper. */
  onServiceChange(id: number | null) {
    this.draft.service_offering_id = id ?? null;
    this.saveMeta('service_offering_id');
  }

  /** Broadcast scope the radios reflect. Owned separately from the
   *  persisted fields so picking "service" shows the picker BEFORE a
   *  service id has been chosen — otherwise the dropdown would only
   *  render once service_offering_id was already set, which is the
   *  wrong order. Reset from persisted state whenever a form loads. */
  attachScope = signal<'none' | 'all_clients' | 'all_leads' | 'service'>('none');

  /** Setting a scope is mutually exclusive. For none/all_clients/
   *  all_leads we persist immediately; for 'service' we flip the flags
   *  to false but leave service_offering_id alone until the user picks
   *  one from the dropdown that just appeared. */
  setAttachScope(scope: 'none' | 'all_clients' | 'all_leads' | 'service') {
    this.attachScope.set(scope);
    this.draft.broadcast_to_all_clients = scope === 'all_clients';
    this.draft.broadcast_to_all_leads   = scope === 'all_leads';
    if (scope !== 'service') this.draft.service_offering_id = null;
    this.saveMeta('broadcast_to_all_clients');
    this.saveMeta('broadcast_to_all_leads');
    if (scope !== 'service') this.saveMeta('service_offering_id');
  }

  /** Derive the initial scope from the loaded form's flags. Called
   *  from load() so the radio group reflects saved state on entry. */
  private deriveAttachScope(): 'none' | 'all_clients' | 'all_leads' | 'service' {
    if (this.draft.broadcast_to_all_clients) return 'all_clients';
    if (this.draft.broadcast_to_all_leads)   return 'all_leads';
    if (this.draft.service_offering_id)      return 'service';
    return 'none';
  }

  draft: Partial<FeedbackForm> = { title: '', kind: 'form' };

  newQLabel = '';
  newQType: FeedbackQuestionType = 'short_text';
  addingQ = signal(false);

  responses        = signal<FeedbackResponse[]>([]);
  loadingResponses = signal(false);
  expandedResponse = signal<number | null>(null);

  /** Which tab the right-hand pane is showing. */
  builderTab = signal<'questions' | 'responses'>('questions');
  setBuilderTab(t: 'questions' | 'responses') { this.builderTab.set(t); }

  /** Whether the "View all" toggle on the analytics panel is open.
   *  When closed we render only the first aggregatable question so
   *  long surveys don't dominate the tab. */
  analyticsShowAll = signal(false);

  /** Per-block collapse state (question id → collapsed). Clicking the
   *  block header flips this so individual questions can be hidden
   *  once the user is done reading them. Default = expanded. */
  collapsedBlocks = signal<Record<number, boolean>>({});
  toggleBlock(qid: number) {
    this.collapsedBlocks.update(m => ({ ...m, [qid]: !m[qid] }));
  }
  isCollapsed(qid: number): boolean {
    return !!this.collapsedBlocks()[qid];
  }

  /** Slice fed to the template: the whole list once "View all" is on,
   *  or just the first block by default. Callers still hit the raw
   *  aggregatable list for the total count. */
  visibleAnalytics(): FeedbackQuestion[] {
    const all = this.aggregatableQuestions();
    return this.analyticsShowAll() ? all : all.slice(0, 1);
  }

  ngOnInit() {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (!id) { this.router.navigate(['/admin/feedback']); return; }
    this.load(id);
    this.loadResponses();
    // Populate the Attach-to > Service dropdown from the shared service
    // catalogue. Small list; loaded once per builder session.
    this.api.listServiceOfferings().subscribe({
      next: r => this.services.set(r.services ?? []),
    });
  }

  loadResponses() {
    const f = this.form();
    const id = f?.id ?? Number(this.route.snapshot.paramMap.get('id'));
    if (!id) return;
    this.loadingResponses.set(true);
    this.api.listFeedbackResponses(id).subscribe({
      next: r => { this.responses.set(r.responses ?? []); this.loadingResponses.set(false); },
      error: () => { this.responses.set([]); this.loadingResponses.set(false); },
    });
  }

  /** Whether the current form kind gets an analytics panel above the
   *  raw response list. Free-form 'form' + 'questionnaire' can't be
   *  aggregated meaningfully (too much long-text) so they're skipped. */
  showAnalytics(): boolean {
    const k = (this.draft.kind ?? 'form') as FeedbackKind;
    return (k === 'poll' || k === 'survey') && this.responses().length > 0;
  }

  /** Kinds we know how to aggregate. Everything else falls back to a
   *  simple response-count summary at the individual-question level. */
  private aggregatable(t: FeedbackQuestionType): boolean {
    return t === 'rating' || t === 'yes_no' || t === 'single_choice' || t === 'multi_choice';
  }

  /** Pull all answer values for one question across every response,
   *  normalising the string-encoded multi_choice arrays back to arrays.
   *  Skips empty answers so counts reflect actual submissions. */
  private answersFor(qid: number): (string | string[])[] {
    const out: (string | string[])[] = [];
    for (const r of this.responses()) {
      for (const a of (r.answers || [])) {
        if (a.question_id !== qid) continue;
        const raw = (a.value ?? '').toString();
        if (!raw) continue;
        if (raw.startsWith('[') && raw.endsWith(']')) {
          try {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr)) { out.push(arr.map(String)); continue; }
          } catch {}
        }
        out.push(raw);
      }
    }
    return out;
  }

  /** Ordered rows for a rating question: label 1..5 with count + pct. */
  ratingStats(q: FeedbackQuestion): { label: string; count: number; pct: number; avg: number; total: number }[] {
    const values = this.answersFor(q.id!).map(v => Number(Array.isArray(v) ? v[0] : v)).filter(Number.isFinite);
    const total  = values.length;
    const avg    = total ? values.reduce((s, n) => s + n, 0) / total : 0;
    const buckets = [1, 2, 3, 4, 5].map(n => {
      const count = values.filter(v => Math.round(v) === n).length;
      return { label: `${n}★`, count, pct: total ? (count / total) * 100 : 0, avg, total };
    });
    return buckets;
  }

  /** Two rows: Yes / No — with count + pct. */
  yesNoStats(q: FeedbackQuestion): { label: string; count: number; pct: number; total: number }[] {
    const values = this.answersFor(q.id!).map(v => (Array.isArray(v) ? v[0] : v).toString().toLowerCase());
    const total  = values.length;
    const yes    = values.filter(v => v === 'yes' || v === 'true' || v === '1').length;
    const no     = total - yes;
    return [
      { label: 'Yes', count: yes, pct: total ? (yes / total) * 100 : 0, total },
      { label: 'No',  count: no,  pct: total ? (no  / total) * 100 : 0, total },
    ];
  }

  /** One row per configured option — count of respondents who picked
   *  it, plus the total-vote percentage. For single_choice the total
   *  equals the response count; for multi_choice it can exceed it. */
  choiceStats(q: FeedbackQuestion): { label: string; count: number; pct: number; total: number }[] {
    const options = q.options && q.options.length ? q.options : [];
    const values  = this.answersFor(q.id!);
    // Flatten multi_choice arrays to individual votes.
    const flat: string[] = [];
    for (const v of values) {
      if (Array.isArray(v)) flat.push(...v);
      else flat.push(v);
    }
    const responseCount = this.responses().length;
    return options.map(opt => {
      const count = flat.filter(v => v === opt).length;
      return {
        label: opt,
        count,
        pct: responseCount ? (count / responseCount) * 100 : 0,
        total: responseCount,
      };
    });
  }

  /** Convenience — pick the right stat function for the question type
   *  so the template can @switch on type without duplicating logic. */
  statsFor(q: FeedbackQuestion): { label: string; count: number; pct: number; total: number }[] {
    switch (q.type) {
      case 'rating':        return this.ratingStats(q);
      case 'yes_no':        return this.yesNoStats(q);
      case 'single_choice':
      case 'multi_choice':  return this.choiceStats(q);
      default:              return [];
    }
  }

  /** Only include questions we can aggregate — text types would just
   *  show a response count row so we skip them at the panel level. */
  aggregatableQuestions(): FeedbackQuestion[] {
    return this.questions().filter(q => this.aggregatable(q.type));
  }

  /** Average rating pulled out as a headline number for rating tiles. */
  ratingAverage(q: FeedbackQuestion): number {
    const values = this.answersFor(q.id!).map(v => Number(Array.isArray(v) ? v[0] : v)).filter(Number.isFinite);
    return values.length ? values.reduce((s, n) => s + n, 0) / values.length : 0;
  }

  toggleResponse(id: number) {
    this.expandedResponse.set(this.expandedResponse() === id ? null : id);
  }

  questionLabel(qid: number): string {
    return this.questions().find(q => q.id === qid)?.label ?? `Q#${qid}`;
  }

  /** Answers are stored as strings in the DB. Multi-choice values are
   *  serialised as JSON arrays by the public submit path; other types
   *  are the raw scalar. Detect the array shape and pretty-print. */
  formatAnswer(a: FeedbackAnswer): string {
    const raw = (a.value ?? '').toString();
    if (!raw) return '—';
    if (raw.startsWith('[') && raw.endsWith(']')) {
      try {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) return arr.length ? arr.join(', ') : '—';
      } catch {}
    }
    return raw;
  }

  private load(id: number) {
    this.api.getFeedbackForm(id).subscribe({
      next: r => {
        this.form.set(r.form);
        this.draft = {
          ...r.form,
          is_published:             !!r.form.is_published,
          broadcast_to_all_clients: !!r.form.broadcast_to_all_clients,
          broadcast_to_all_leads:   !!r.form.broadcast_to_all_leads,
        };
        this.attachScope.set(this.deriveAttachScope());
        // Coerce options_json → options array on each question for editing
        this.questions.set(r.questions.map(q => {
          let opts: string[] = [];
          if (typeof q.options_json === 'string' && q.options_json) {
            try { opts = JSON.parse(q.options_json); } catch {}
          } else if (Array.isArray(q.options_json)) {
            opts = q.options_json;
          } else if (Array.isArray(q.options)) {
            opts = q.options;
          }
          return { ...q, options: opts };
        }));
      },
      error: () => this.router.navigate(['/admin/feedback']),
    });
  }

  needsOptions(t: FeedbackQuestionType): boolean {
    return this.qtypeOptions.find(o => o.key === t)?.needsOptions ?? false;
  }

  saveMeta(field: keyof FeedbackForm) {
    const f = this.form();
    if (!f) return;
    const payload: Partial<FeedbackForm> = {};
    (payload as any)[field] = (this.draft as any)[field];
    if (field === 'is_published')             payload.is_published             = this.draft.is_published             ? 1 : 0;
    if (field === 'broadcast_to_all_clients') payload.broadcast_to_all_clients = this.draft.broadcast_to_all_clients ? 1 : 0;
    if (field === 'broadcast_to_all_leads')   payload.broadcast_to_all_leads   = this.draft.broadcast_to_all_leads   ? 1 : 0;
    this.saving.set(true);
    this.api.updateFeedbackForm(f.id, payload).subscribe({
      next: () => { this.saving.set(false); this.form.set({ ...f, ...payload }); },
      error: () => this.saving.set(false),
    });
    // When kind changes, sync the "new question" widget default AND
    // migrate any existing question whose type is now disallowed. We
    // don't delete anything — the user can decide — but the type is
    // coerced to the kind's default so the widget stays consistent.
    if (field === 'kind') this.onKindChanged();
  }

  private onKindChanged() {
    const kind = (this.draft.kind ?? 'form') as FeedbackKind;
    const rules = KIND_RULES[kind];
    if (!rules) return;
    if (!rules.allowedTypes.includes(this.newQType)) {
      this.newQType = rules.defaultType;
    }
    // Coerce any existing question whose type is no longer allowed.
    const qs = this.questions();
    for (const q of qs) {
      if (!rules.allowedTypes.includes(q.type)) {
        this.updateQ(q, 'type', rules.defaultType);
        q.type = rules.defaultType;
      }
    }
  }

  setQOptions(q: FeedbackQuestion, raw: string) {
    q.options = raw.split('\n').map(s => s.trim()).filter(Boolean);
  }

  /** Guarantees at least two option rows exist for the input-row UI.
   *  Called from the template's @for so a freshly-typed question
   *  (options = undefined) immediately renders two empty inputs. */
  ensureOptions(q: FeedbackQuestion): string[] {
    if (!q.options || q.options.length === 0) q.options = ['', ''];
    else if (q.options.length === 1)          q.options = [q.options[0], ''];
    return q.options;
  }

  setOption(q: FeedbackQuestion, index: number, value: string) {
    if (!q.options) q.options = [];
    q.options = q.options.map((v, i) => i === index ? value : v);
  }

  addOption(q: FeedbackQuestion) {
    if (!q.options) q.options = [];
    q.options = [...q.options, ''];
  }

  /** Remove + persist. Guarded to keep at least one option row so
   *  the question is never left in an invalid state. */
  removeOption(q: FeedbackQuestion, index: number) {
    if (!q.options || q.options.length <= 1) return;
    q.options = q.options.filter((_, i) => i !== index);
    this.updateQ(q, 'options_json', q.options);
  }

  addQuestion() {
    const f = this.form();
    if (!f) return;
    const label = this.newQLabel.trim();
    if (!label) return;
    this.addingQ.set(true);
    const payload: Partial<FeedbackQuestion> = {
      label,
      type: this.newQType,
      sort_order: this.questions().length,
    };
    this.api.addFeedbackQuestion(f.id, payload).subscribe({
      next: () => {
        this.addingQ.set(false);
        this.newQLabel = '';
        this.load(f.id);
      },
      error: () => this.addingQ.set(false),
    });
  }

  updateQ(q: FeedbackQuestion, field: string, value: any) {
    const f = this.form();
    if (!f || !q.id) return;
    const payload: any = {};
    payload[field] = field === 'options_json' ? (Array.isArray(value) ? value : []) : value;
    this.saving.set(true);
    this.api.updateFeedbackQuestion(f.id, q.id, payload).subscribe({
      next: () => this.saving.set(false),
      error: () => this.saving.set(false),
    });
  }

  async deleteQ(q: FeedbackQuestion) {
    const f = this.form();
    if (!f || !q.id) return;
    const ok = await this.dialog.confirm('Delete this question?', {
      title: 'Delete question',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    this.api.deleteFeedbackQuestion(f.id, q.id).subscribe(() => this.load(f.id));
  }

  publicUrl(): string {
    // Attribution scheme: `?id=0` marks a public / anonymous share.
    // Client + lead detail tabs use `?id=c{N}` / `?id=l{N}` for tagging.
    const f = this.form();
    return f ? `${window.location.origin}${environment.basePath}/feedback/${f.public_token}?id=0` : '';
  }
  async copyUrl() {
    try {
      await navigator.clipboard.writeText(this.publicUrl());
      this.copyMsg.set('Copied.');
      setTimeout(() => this.copyMsg.set(null), 2000);
    } catch {
      this.copyMsg.set('Copy failed — copy manually.');
    }
  }
}
