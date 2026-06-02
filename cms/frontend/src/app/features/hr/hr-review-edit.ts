import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { HrReview, HrReviewQuestion, HrReviewResponses } from '../../core/models';

/**
 * /hr/reviews/:id — manager-side editor for a single review.
 */
@Component({
  selector: 'app-hr-review-edit',
  imports: [RouterLink, FormsModule],
  template: `
    @if (review(); as r) {
      <div class="toolbar">
        <button class="ghost" routerLink="/hr/reviews">← Back</button>
        <h1>{{ r.first_name }} {{ r.last_name }}</h1>
        <span class="muted small">{{ r.cycle_name }} · {{ r.period_start }} → {{ r.period_end }}</span>
        <span class="status status-{{ r.status }}">{{ r.status?.replace('_', ' ') }}</span>
        <span class="spacer"></span>
        @if (saving()) { <span class="muted small">Saving…</span> }
        @if (!isCompleted()) {
          <button class="primary" (click)="sign()" [disabled]="saving()">✓ Sign &amp; complete</button>
        }
      </div>

      <div class="content">
        <h3 class="sec">Self review (read-only)</h3>
        @if (selfFilled()) {
          <div class="grid">
            @for (q of questions(); track q.id) {
              <div class="qrow">
                <div class="qlabel">{{ q.label }}</div>
                <div class="qval">
                  @if (q.type === 'rating') {
                    <span class="rating">{{ employeeAnswer(q) ?? '—' }} / 5</span>
                  } @else {
                    <span>{{ employeeAnswer(q) || '—' }}</span>
                  }
                </div>
              </div>
            }
          </div>
          <p class="muted small">Self overall: <strong>{{ r.employee_overall ?? '—' }}</strong>
            @if (r.employee_signed_at) { · signed {{ r.employee_signed_at }} }
          </p>
        } @else {
          <p class="muted small">Employee has not submitted their self-review yet.</p>
        }

        <h3 class="sec">Manager review</h3>
        @if (isCompleted()) {
          <p class="muted small locked-note">This review is signed and locked. Use the Reviews list to delete and re-create if a correction is needed.</p>
        }
        <div class="grid">
          @for (q of questions(); track q.id) {
            <div class="qrow">
              <label class="qlabel">{{ q.label }}</label>
              @if (q.type === 'rating') {
                <div class="rating-group">
                  @for (n of [1,2,3,4,5]; track n) {
                    <button class="rate-btn" type="button"
                            [disabled]="isCompleted()"
                            [class.selected]="rated(q) === n"
                            (click)="setRating(q, n)">{{ n }}</button>
                  }
                </div>
              } @else {
                <textarea rows="3"
                          [value]="textAnswer(q)"
                          [disabled]="isCompleted()"
                          (blur)="setText(q, $any($event.target).value)"></textarea>
              }
            </div>
          }
        </div>

        <h3 class="sec">Overall</h3>
        <div class="rating-group">
          @for (n of [1,2,3,4,5]; track n) {
            <button class="rate-btn" type="button"
                    [disabled]="isCompleted()"
                    [class.selected]="overall() === n"
                    (click)="setOverall(n)">{{ n }}</button>
          }
        </div>

        <h3 class="sec">Goals for next period</h3>
        <textarea rows="4"
                  [value]="goals()"
                  [disabled]="isCompleted()"
                  (blur)="setGoals($any($event.target).value)"
                  placeholder="What should this person focus on next?"></textarea>

        @if (r.manager_signed_at) {
          <p class="muted small" style="margin-top: 16px;">Manager signed: {{ r.manager_signed_at }}</p>
        }
      </div>
    } @else {
      <div class="empty"><p class="muted">Loading…</p></div>
    }
  `,
  styles: [`
    .toolbar { padding: 16px 20px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--line); }
    .toolbar h1 { margin: 0; font-size: 22px; }
    .spacer { flex: 1; }
    .content { padding: 20px 24px 32px; max-width: 800px; }
    h3.sec { font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; margin: 24px 0 10px; }
    .grid { display: flex; flex-direction: column; gap: 12px; }
    .qrow { display: grid; grid-template-columns: 220px 1fr; gap: 14px; align-items: start; }
    .qlabel { padding-top: 6px; color: var(--muted); font-size: 13px; }
    .qval   { padding-top: 6px; }
    .rating { color: var(--primary); font-weight: 700; }
    .rating-group { display: flex; gap: 6px; }
    .rate-btn {
      width: 36px; height: 36px;
      background: var(--bg-2); border: 1px solid var(--line); color: var(--fg);
      border-radius: var(--radius-sm); cursor: pointer; font-weight: 700;
    }
    .rate-btn:hover { border-color: var(--primary); }
    .rate-btn.selected { background: var(--primary); color: #0a0a0a; border-color: var(--primary); }
    .status {
      display: inline-block; padding: 2px 10px; border-radius: 999px;
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      border: 1px solid var(--line);
    }
    .status-not_started    { color: var(--muted); }
    .status-self_review    { color: var(--primary); border-color: var(--primary); }
    .status-manager_review { color: var(--primary); border-color: var(--primary); }
    .status-completed      { color: var(--primary); border-color: var(--primary); }
    .status-closed         { color: var(--muted); border-color: var(--muted); }
    .empty { padding: 60px; text-align: center; }
    .locked-note { background: rgba(212, 169, 58, 0.08); border-left: 3px solid var(--primary); padding: 8px 12px; margin: 0 0 12px; }
    .rate-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    textarea:disabled { opacity: 0.6; cursor: not-allowed; }
  `],
})
export class HrReviewEdit {
  private api = inject(Api);
  private route = inject(ActivatedRoute);

  review = signal<HrReview | null>(null);
  saving = signal(false);
  managerResponses = signal<HrReviewResponses>({});
  overall = signal<number | null>(null);
  goals = signal<string>('');

  questions = computed<HrReviewQuestion[]>(() => {
    const r = this.review();
    if (!r) return [];
    const raw = r.questions_json;
    if (Array.isArray(raw)) return raw;
    try { return JSON.parse((raw as string) || '[]'); } catch { return []; }
  });

  isCompleted = computed(() => {
    const s = this.review()?.status;
    return s === 'completed' || s === 'closed';
  });

  selfFilled = computed(() => {
    const r = this.review();
    if (!r) return false;
    const j = r.employee_responses_json;
    if (!j) return false;
    if (typeof j === 'string') return j.length > 2;
    return Object.keys(j).length > 0;
  });

  ngOnInit() {
    this.route.paramMap.subscribe(p => {
      const id = +p.get('id')!;
      this.api.getHrReview(id).subscribe(r => {
        this.review.set(r.review);
        const m = this.parseResponses(r.review.manager_responses_json);
        this.managerResponses.set(m);
        this.overall.set(r.review.manager_overall ?? null);
        this.goals.set(r.review.goals_next_period ?? '');
      });
    });
  }

  private parseResponses(raw: any): HrReviewResponses {
    if (!raw) return {};
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(raw); } catch { return {}; }
  }

  rated(q: HrReviewQuestion): number | null {
    const v = this.managerResponses()[q.id];
    return typeof v === 'number' ? v : null;
  }
  textAnswer(q: HrReviewQuestion): string {
    const v = this.managerResponses()[q.id];
    return typeof v === 'string' ? v : '';
  }
  employeeAnswer(q: HrReviewQuestion): number | string | null {
    const r = this.review();
    if (!r) return null;
    const map = this.parseResponses(r.employee_responses_json);
    return map[q.id] ?? null;
  }

  setRating(q: HrReviewQuestion, n: number) {
    this.managerResponses.set({ ...this.managerResponses(), [q.id]: n });
    this.persist();
  }
  setText(q: HrReviewQuestion, value: string) {
    this.managerResponses.set({ ...this.managerResponses(), [q.id]: value });
    this.persist();
  }
  setOverall(n: number) {
    this.overall.set(n);
    this.persist();
  }
  setGoals(text: string) {
    this.goals.set(text);
    this.persist();
  }

  private persist(opts: { sign?: boolean } = {}) {
    const r = this.review();
    if (!r?.id) return;
    this.saving.set(true);
    this.api.updateHrReview(r.id, {
      responses: this.managerResponses(),
      overall: this.overall() ?? undefined,
      goals_next_period: this.goals(),
      sign: opts.sign,
    }).subscribe({
      next: () => {
        this.saving.set(false);
        if (opts.sign) this.api.getHrReview(r.id!).subscribe(rr => this.review.set(rr.review));
      },
      error: () => this.saving.set(false),
    });
  }

  sign() {
    if (!confirm('Sign and complete this review? It will move to "completed" and be visible to the employee.')) return;
    this.persist({ sign: true });
  }
}
