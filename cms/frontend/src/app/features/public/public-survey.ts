import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { HrSurveyQuestion, PublicSurveyDef } from '../../core/models';

/**
 * /surveys/:token — public, token-gated pulse-survey responder.
 * Renders without the app shell so it can be linked or embedded in an iframe
 * on any third-party site.
 */
@Component({
  selector: 'app-public-survey',
  imports: [FormsModule],
  template: `
    <div class="page">
      <div class="card">
        @if (loading()) {
          <p class="muted">Loading survey…</p>
        } @else if (errored()) {
          <h2>Unavailable</h2>
          <p class="muted">{{ errorMsg() || 'This survey link is invalid, closed, or has expired.' }}</p>
          @if (errorStatus() !== null) {
            <p class="muted small">HTTP {{ errorStatus() }}</p>
          }
        } @else if (submitted()) {
          <h2>✓ Thank you</h2>
          <p class="muted">Your response has been recorded.</p>
        } @else if (survey(); as s) {
          <h1>{{ s.title }}</h1>
          @if (s.description) { <p class="muted">{{ s.description }}</p> }
          @if (s.is_anonymous) {
            <p class="anon-pill">This survey is anonymous — your name and email are not collected.</p>
          }

          <form (submit)="$event.preventDefault(); submit()">
            @for (q of s.questions; track q.id; let qi = $index) {
              <div class="q-block">
                <label class="q-label">{{ qi + 1 }}. {{ q.label }}</label>
                @if (q.type === 'rating') {
                  <div class="rating">
                    @for (n of [1,2,3,4,5]; track n) {
                      <label class="rating-opt" [class.picked]="answers[q.id] === n">
                        <input type="radio" name="r_{{ q.id }}" [value]="n" [(ngModel)]="answers[q.id]" />
                        <span>{{ n }}</span>
                      </label>
                    }
                  </div>
                  <div class="rating-hint">
                    <span class="muted small">1 — Strongly disagree</span>
                    <span class="muted small">5 — Strongly agree</span>
                  </div>
                } @else {
                  <textarea rows="3" [(ngModel)]="answers[q.id]" name="t_{{ q.id }}" placeholder="Type your answer…"></textarea>
                }
              </div>
            }

            @if (errorMsg()) { <p class="err">{{ errorMsg() }}</p> }
            <button class="primary" type="submit" [disabled]="busy()">{{ busy() ? 'Submitting…' : 'Submit response' }}</button>
          </form>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; min-height: 100vh; background: var(--bg); padding: 20px; }
    .page { max-width: 720px; margin: 24px auto; }
    .card {
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius);
      padding: 28px;
    }
    h1 { margin: 0 0 6px; font-size: 22px; }
    h2 { margin: 0 0 6px; font-size: 18px; color: var(--primary); }
    .anon-pill {
      display: inline-block; padding: 6px 10px; border-radius: var(--radius-sm);
      background: rgba(167,139,250,0.12); border: 1px solid #a78bfa; color: #a78bfa;
      font-size: 12px; margin: 8px 0 12px;
    }
    form { display: flex; flex-direction: column; gap: 16px; margin-top: 12px; }
    .q-block { display: flex; flex-direction: column; gap: 8px; }
    .q-label { font-weight: 500; color: var(--fg); margin: 0; text-transform: none; letter-spacing: normal; font-size: 14px; }
    .rating { display: flex; gap: 6px; flex-wrap: wrap; }
    .rating-opt {
      flex: 1; min-width: 56px; cursor: pointer;
      padding: 12px 0; border: 1px solid var(--line); border-radius: var(--radius-sm);
      background: var(--bg-3); text-align: center; color: var(--fg);
      font-size: 16px; font-weight: 600; margin: 0;
      transition: border-color 0.15s, background 0.15s;
    }
    .rating-opt:hover { border-color: var(--primary); }
    .rating-opt.picked { border-color: var(--primary); background: rgba(212,169,58,0.18); color: var(--primary); }
    .rating-opt input { display: none; }
    .rating-hint { display: flex; justify-content: space-between; }
    .err { color: #ef4444; font-size: 13px; margin: 0; }
    button.primary { align-self: flex-start; }
  `],
})
export class PublicSurvey {
  private route = inject(ActivatedRoute);
  private api = inject(Api);

  loading = signal(true);
  errored = signal(false);
  errorMsg = signal<string | null>(null);
  errorStatus = signal<number | null>(null);
  submitted = signal(false);
  busy = signal(false);
  survey = signal<PublicSurveyDef | null>(null);
  answers: Record<string, any> = {};

  ngOnInit() {
    const token = this.route.snapshot.paramMap.get('token') || '';
    if (!token) { this.errored.set(true); this.loading.set(false); return; }
    this.api.getPublicSurvey(token).subscribe({
      next: r => {
        this.survey.set(r.survey);
        for (const q of r.survey.questions) this.answers[q.id] = q.type === 'rating' ? null : '';
        this.loading.set(false);
      },
      error: e => {
        // Surface the HTTP status alongside the message so a stuck-error
        // state (cached 410, proxy 404, etc.) can be diagnosed without
        // dropping into the browser network tab.
        // eslint-disable-next-line no-console
        console.error('[public-survey] failed to load', { status: e?.status, error: e?.error });
        this.errored.set(true);
        this.errorStatus.set(typeof e?.status === 'number' ? e.status : null);
        this.errorMsg.set(e?.error?.error || null);
        this.loading.set(false);
      },
    });
  }

  submit() {
    if (this.busy()) return;
    const s = this.survey();
    if (!s) return;
    // Require at least every rating question to be answered.
    for (const q of s.questions) {
      if (q.type === 'rating' && (this.answers[q.id] === null || this.answers[q.id] === undefined)) {
        this.errorMsg.set('Please answer every rating question before submitting.');
        return;
      }
    }
    this.errorMsg.set(null);
    this.busy.set(true);
    const token = this.route.snapshot.paramMap.get('token') || '';
    this.api.submitPublicSurvey(token, this.answers).subscribe({
      next: () => { this.busy.set(false); this.submitted.set(true); },
      error: e => { this.busy.set(false); this.errorMsg.set(e?.error?.error || 'Could not submit response.'); },
    });
  }
}
