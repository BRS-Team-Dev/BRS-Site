import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '@env/environment';
import { FeedbackForm, FeedbackQuestion } from '../../core/models';

interface PublicFeedbackResponse {
  form: FeedbackForm;
  questions: FeedbackQuestion[];
  context: { client_id: number | null; lead_id: number | null };
}

/**
 * /feedback/:token — public viewer for any feedback form. Auth-free;
 * the token IS the access control. Optional ?client=N / ?lead=N tail
 * is forwarded to the public API so the submission gets tagged.
 *
 * Renders six question types: short_text, long_text, rating (1-5),
 * yes_no, single_choice (radio), multi_choice (checkbox).
 */
@Component({
  selector: 'app-feedback-public',
  imports: [FormsModule],
  template: `
    <div class="page">
      @if (loading()) {
        <p class="muted">Loading…</p>
      } @else if (error()) {
        <div class="error-card">
          <h2>Unavailable</h2>
          <p class="muted">{{ error() }}</p>
        </div>
      } @else if (submitted()) {
        <div class="thanks-card">
          <h2>Thanks 👍</h2>
          <p>{{ thankYou() }}</p>
        </div>
      } @else if (data(); as d) {
        <div class="form-card">
          <header>
            <h1>{{ d.form.title }}</h1>
            @if (d.form.description) { <p class="muted">{{ d.form.description }}</p> }
          </header>

          @for (q of d.questions; track q.id; let i = $index) {
            <div class="q-block">
              <label>
                {{ i + 1 }}. {{ q.label }}
                @if (q.is_required) { <span class="req">*</span> }
              </label>
              @if (q.help_text) { <p class="muted small">{{ q.help_text }}</p> }

              @switch (q.type) {
                @case ('short_text') {
                  <input type="text" [(ngModel)]="answers[q.id!]" [name]="'a_' + q.id" />
                }
                @case ('long_text') {
                  <textarea rows="4" [(ngModel)]="answers[q.id!]" [name]="'a_' + q.id"></textarea>
                }
                @case ('rating') {
                  <div class="rating-row">
                    @for (n of [1,2,3,4,5]; track n) {
                      <button type="button" class="star"
                              [class.on]="answers[q.id!] === ('' + n)"
                              (click)="answers[q.id!] = ('' + n)">
                        {{ answers[q.id!] === ('' + n) ? '★' : '☆' }}
                      </button>
                    }
                  </div>
                }
                @case ('yes_no') {
                  <div class="yn-row">
                    <button type="button" class="yn"
                            [class.on]="answers[q.id!] === 'yes'"
                            (click)="answers[q.id!] = 'yes'">Yes</button>
                    <button type="button" class="yn"
                            [class.on]="answers[q.id!] === 'no'"
                            (click)="answers[q.id!] = 'no'">No</button>
                  </div>
                }
                @case ('single_choice') {
                  <div class="opt-list">
                    @for (opt of (q.options || []); track opt) {
                      <label class="opt">
                        <input type="radio" [name]="'a_' + q.id" [value]="opt"
                               [checked]="answers[q.id!] === opt"
                               (change)="answers[q.id!] = opt" />
                        {{ opt }}
                      </label>
                    }
                  </div>
                }
                @case ('multi_choice') {
                  <div class="opt-list">
                    @for (opt of (q.options || []); track opt) {
                      <label class="opt">
                        <input type="checkbox"
                               [checked]="(multi[q.id!] || []).includes(opt)"
                               (change)="toggleMulti(q.id!, opt, $any($event.target).checked)" />
                        {{ opt }}
                      </label>
                    }
                  </div>
                }
              }
            </div>
          }

          @if (submitError()) { <p class="error-msg">{{ submitError() }}</p> }
          <div class="cta">
            <button class="primary" (click)="submit()" [disabled]="submitting()">
              {{ submitting() ? 'Submitting…' : (d.form.submit_label || 'Submit') }}
            </button>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; background: var(--bg); min-height: 100vh; }
    .page { max-width: 720px; margin: 0 auto; padding: 32px 20px; }
    .form-card, .thanks-card, .error-card {
      background: var(--bg-2); border: 1px solid var(--line);
      border-radius: var(--radius); padding: 28px;
    }
    header { margin-bottom: 24px; }
    h1 { margin: 0 0 6px; font-size: 22px; }
    h2 { margin: 0 0 6px; font-size: 18px; }
    .q-block { margin-bottom: 22px; padding-bottom: 22px; border-bottom: 1px solid var(--line); }
    .q-block:last-of-type { border-bottom: 0; }
    label { display: block; font-size: 14px; font-weight: 600; margin-bottom: 6px; }
    .req { color: var(--danger); margin-left: 4px; }
    .opt-list { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
    .opt { display: flex; align-items: center; gap: 8px;
      font-weight: 400; font-size: 14px; cursor: pointer; margin: 0; }
    .opt input { width: auto; }
    .rating-row { display: flex; gap: 4px; margin-top: 6px; }
    .star { background: transparent; border: 0; padding: 4px 6px;
      font-size: 28px; cursor: pointer; color: var(--muted); }
    .star.on { color: var(--primary); }
    .yn-row { display: flex; gap: 8px; margin-top: 6px; }
    .yn { padding: 8px 18px; border-radius: var(--radius-sm);
      background: var(--bg-3); border: 1px solid var(--line);
      color: var(--fg); cursor: pointer; }
    .yn.on { background: var(--primary); color: #0a0a0a; border-color: var(--primary); }
    .cta { margin-top: 24px; text-align: right; }
  `],
})
export class FeedbackPublic {
  private http  = inject(HttpClient);
  private route = inject(ActivatedRoute);

  loading      = signal(true);
  error        = signal<string | null>(null);
  submitted    = signal(false);
  submitting   = signal(false);
  submitError  = signal<string | null>(null);
  thankYou     = signal<string>('Thanks — your feedback has been received.');
  data         = signal<PublicFeedbackResponse | null>(null);

  /** Single-value answers (text / rating / yes_no / single_choice). */
  answers: Record<number, string> = {};
  /** Multi-choice answers — array per question. */
  multi: Record<number, string[]> = {};

  /** Built off the route token + query params. The public API
   *  treats `?client=` / `?lead=` as tags for the response row. */
  private apiUrl(): string {
    const token = this.route.snapshot.paramMap.get('token') || '';
    const q = new URLSearchParams(window.location.search);
    const tail = q.toString();
    return `${environment.basePath}/api/public/feedback/${token}${tail ? '?' + tail : ''}`;
  }

  ngOnInit() {
    this.http.get<PublicFeedbackResponse>(this.apiUrl()).subscribe({
      next: r => {
        // Normalise options_json into options[] for the radio/checkbox views
        r.questions = r.questions.map(q => {
          let opts: string[] = [];
          if (typeof q.options_json === 'string' && q.options_json) {
            try { opts = JSON.parse(q.options_json); } catch {}
          } else if (Array.isArray(q.options_json)) {
            opts = q.options_json;
          } else if (Array.isArray(q.options)) {
            opts = q.options;
          }
          return { ...q, options: opts };
        });
        this.data.set(r);
        this.loading.set(false);
      },
      error: e => {
        this.loading.set(false);
        this.error.set(e?.error?.error || 'Feedback form not available.');
      },
    });
  }

  toggleMulti(qid: number, opt: string, checked: boolean) {
    const cur = this.multi[qid] || [];
    if (checked) {
      if (!cur.includes(opt)) this.multi[qid] = [...cur, opt];
    } else {
      this.multi[qid] = cur.filter(o => o !== opt);
    }
  }

  submit() {
    const d = this.data();
    if (!d) return;
    const answers: { question_id: number; value: any }[] = [];
    for (const q of d.questions) {
      if (!q.id) continue;
      if (q.type === 'multi_choice') {
        answers.push({ question_id: q.id, value: this.multi[q.id] || [] });
      } else {
        answers.push({ question_id: q.id, value: this.answers[q.id] ?? '' });
      }
    }
    this.submitting.set(true);
    this.submitError.set(null);
    this.http.post<{ ok: boolean; thank_you_message?: string }>(this.apiUrl(), { answers }).subscribe({
      next: r => {
        this.submitting.set(false);
        if (r.thank_you_message) this.thankYou.set(r.thank_you_message);
        this.submitted.set(true);
      },
      error: e => {
        this.submitting.set(false);
        this.submitError.set(e?.error?.error || 'Could not submit. Please try again.');
      },
    });
  }
}
