import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '@env/environment';
import { FormSection, FormField } from '../../core/models';
import { PublicBrandBanner, PublicFooter } from '../../shared/public-chrome';

/**
 * Public "open link" onboarding portal.
 *
 * URL: /onboarding/open/:slug — no token, no auth. Fetches the form
 * schema by slug and posts a single-shot submission. Backend handles
 * auto-provisioning (client or lead, depending on forms.public_target).
 *
 * Not the same as OnboardingPortal (the invite-token flow) — this one
 * has no autosave, no per-section completion tracking, no returning-user
 * state to load. It's a plain form-and-submit for anonymous visitors,
 * so the whole thing stays under ~300 lines.
 *
 * Anti-spam: renders a hidden `_hp` honeypot input; bots that dutifully
 * fill every field get 200 without any provisioning.
 */
interface OpenState {
  form: {
    id: number; slug: string; title: string;
    description?: string | null; intro_html?: string | null;
    submit_label?: string; thank_you_message?: string | null;
    public_target: 'client' | 'lead' | 'none';
    post_submit_url?: string | null;
  };
  sections: FormSection[];
  branding?: { bg_color?: string; name?: string; logo_url?: string };
}

const BASE = `${environment.basePath}/api`;

@Component({
  selector: 'app-onboarding-open-portal',
  standalone: true,
  imports: [CommonModule, FormsModule, PublicBrandBanner, PublicFooter],
  template: `
    @if (loading()) { <p class="loading">Loading…</p> }
    @else if (notFound()) {
      <div class="error-screen">
        <div class="card">
          <h1>Onboarding not found</h1>
          <p>This link is no longer active. Ask the sender for a new one.</p>
        </div>
      </div>
    }
    @else if (state(); as st) {
      <app-public-brand-banner
        [brandName]="st.branding?.name"
        [brandLogoUrl]="st.branding?.logo_url">
      </app-public-brand-banner>

      @if (submitted()) {
        <section class="hero">
          <div class="thankyou-card">
            <div class="check-ring">
              <div class="check">✓</div>
            </div>
            <h1>You're all set</h1>
            <p class="thank-msg">{{ st.form.thank_you_message || 'Your onboarding has been received. We\\'ll be in touch shortly.' }}</p>

            @if (st.form.post_submit_url) {
              <div class="redirect-row">
                @if (redirectCountdown() > 0) {
                  <p class="muted small">
                    Redirecting to
                    <strong>{{ redirectDestinationLabel() }}</strong>
                    in {{ redirectCountdown() }}s…
                  </p>
                }
                <div class="cta-row">
                  <a class="primary" [href]="st.form.post_submit_url">
                    Continue to {{ redirectDestinationLabel() }} →
                  </a>
                  @if (redirectCountdown() > 0) {
                    <button type="button" class="ghost" (click)="cancelRedirect()">
                      Cancel auto-redirect
                    </button>
                  }
                </div>
              </div>
            }
          </div>
        </section>
      } @else {
        <section class="hero">
          <div class="hero-grid">
            <div>
              <span class="overline">Welcome</span>
              <h1>{{ st.form.title }}</h1>
              @if (st.form.description) { <p class="lead">{{ st.form.description }}</p> }
              @if (!st.form.description && st.form.intro_html) { <div class="intro" [innerHTML]="st.form.intro_html"></div> }
            </div>
          </div>
        </section>

        <form class="content" (ngSubmit)="submit()" #f="ngForm">
          <!-- Honeypot — hidden from real users; bots that fill every
               field trigger the server-side skip. -->
          <input type="text" name="_hp" [(ngModel)]="honeypot" tabindex="-1" autocomplete="off"
                 style="position:absolute;left:-10000px;top:auto;width:1px;height:1px;overflow:hidden;" />

          @for (sec of st.sections; track sec.id; let sidx = $index) {
            <section class="section">
              <h2>{{ sec.title || 'Section ' + (sidx + 1) }}</h2>
              @if (sec.description) { <p class="section-desc">{{ sec.description }}</p> }

              <div class="fields">
                @for (fl of sec.fields || []; track fl.id) {
                  <div class="field" [class.wide]="isWide(fl)">
                    <label [attr.for]="'f_' + fl.id">
                      {{ fl.label }}
                      @if (fl.is_required) { <span class="req">★</span> }
                    </label>

                    @switch (fl.type) {
                      @case ('textarea') {
                        <textarea [id]="'f_' + fl.id" [name]="fl.name" rows="4"
                                  [(ngModel)]="values[fl.name]"
                                  [required]="!!fl.is_required"
                                  [placeholder]="fl.placeholder || ''"></textarea>
                      }
                      @case ('select') {
                        <select [id]="'f_' + fl.id" [name]="fl.name"
                                [(ngModel)]="values[fl.name]"
                                [required]="!!fl.is_required">
                          <option value="">— pick one —</option>
                          @for (o of (fl.options || []); track o.value) {
                            <option [value]="o.value">{{ o.label }}</option>
                          }
                        </select>
                      }
                      @case ('checkbox') {
                        @if (fl.options && fl.options.length) {
                          <div class="checkgroup">
                            @for (o of fl.options; track o.value) {
                              <label class="check">
                                <input type="checkbox"
                                       [checked]="isChecked(fl.name, o.value)"
                                       (change)="toggleCheck(fl.name, o.value, $any($event.target).checked)" />
                                <span>{{ o.label }}</span>
                              </label>
                            }
                          </div>
                        } @else {
                          <label class="check">
                            <input type="checkbox" [(ngModel)]="values[fl.name]" [name]="fl.name" />
                            <span>{{ fl.placeholder || 'Yes' }}</span>
                          </label>
                        }
                      }
                      @case ('radio') {
                        <div class="checkgroup">
                          @for (o of (fl.options || []); track o.value) {
                            <label class="check">
                              <input type="radio" [name]="fl.name" [value]="o.value"
                                     [(ngModel)]="values[fl.name]" [required]="!!fl.is_required" />
                              <span>{{ o.label }}</span>
                            </label>
                          }
                        </div>
                      }
                      @case ('number') {
                        <input type="number" [id]="'f_' + fl.id" [name]="fl.name"
                               [(ngModel)]="values[fl.name]" [required]="!!fl.is_required"
                               [placeholder]="fl.placeholder || ''" />
                      }
                      @case ('date') {
                        <input type="date" [id]="'f_' + fl.id" [name]="fl.name"
                               [(ngModel)]="values[fl.name]" [required]="!!fl.is_required" />
                      }
                      @case ('email') {
                        <input type="email" [id]="'f_' + fl.id" [name]="fl.name"
                               [(ngModel)]="values[fl.name]" [required]="!!fl.is_required"
                               [placeholder]="fl.placeholder || 'you@example.com'" />
                      }
                      @case ('tel') {
                        <input type="tel" [id]="'f_' + fl.id" [name]="fl.name"
                               [(ngModel)]="values[fl.name]" [required]="!!fl.is_required"
                               [placeholder]="fl.placeholder || ''" />
                      }
                      @case ('url') {
                        <input type="url" [id]="'f_' + fl.id" [name]="fl.name"
                               [(ngModel)]="values[fl.name]" [required]="!!fl.is_required"
                               [placeholder]="fl.placeholder || 'https://…'" />
                      }
                      @default {
                        <input type="text" [id]="'f_' + fl.id" [name]="fl.name"
                               [(ngModel)]="values[fl.name]" [required]="!!fl.is_required"
                               [placeholder]="fl.placeholder || ''" />
                      }
                    }

                    @if (fl.help_text) { <p class="help">{{ fl.help_text }}</p> }
                  </div>
                }
              </div>
            </section>
          }

          @if (submitError()) { <p class="error-msg">{{ submitError() }}</p> }

          <div class="foot">
            <!-- Email is the identity key on the backend. We look at
                 common name/email fields; a required one shows up in
                 the sections themselves. -->
            <button type="submit" class="primary" [disabled]="submitting()">
              {{ submitting() ? 'Submitting…' : (st.form.submit_label || 'Submit') }}
            </button>
          </div>
        </form>
      }

      <app-public-footer />
    }
  `,
  styles: [`
    :host { display: block; min-height: 100vh; background: var(--bg, #0d0d0d); color: var(--fg, #eee); }
    .loading, .error-screen { padding: 80px 24px; text-align: center; color: var(--muted, #999); }
    .error-screen .card { max-width: 480px; margin: 0 auto; padding: 40px; background: var(--bg-2, #1a1a1a); border-radius: 8px; }
    .hero { padding: 40px 24px 24px; max-width: 900px; margin: 0 auto; }
    .hero-grid { display: grid; gap: 20px; }
    .hero .overline { color: var(--primary, #d4a93a); text-transform: uppercase; letter-spacing: 0.4px; font-size: 12px; }
    .hero h1 { font-size: 32px; margin: 6px 0 8px; }
    .hero .lead, .hero .intro { color: var(--muted, #999); margin: 0; }
    .content { max-width: 900px; margin: 0 auto; padding: 0 24px 60px; position: relative; }
    .section { background: var(--bg-2, #1a1a1a); border: 1px solid var(--line, #333); border-radius: 8px; padding: 24px; margin-bottom: 20px; }
    .section h2 { margin: 0 0 4px; font-size: 20px; }
    .section-desc { color: var(--muted, #999); margin: 0 0 16px; font-size: 14px; }
    .fields { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .field.wide, .field:has(textarea) { grid-column: 1 / -1; }
    @media (max-width: 640px) { .fields { grid-template-columns: 1fr; } }
    .field label { display: block; margin-bottom: 4px; font-size: 12px; color: var(--muted, #999); text-transform: uppercase; letter-spacing: 0.5px; }
    .field input, .field textarea, .field select { width: 100%; padding: 10px 12px; background: var(--bg, #0d0d0d); border: 1px solid var(--line, #333); color: var(--fg, #eee); border-radius: 4px; font: inherit; box-sizing: border-box; }
    .field textarea { resize: vertical; min-height: 92px; }
    .field .req { color: var(--primary, #d4a93a); margin-left: 3px; }
    .field .help { color: var(--muted, #999); font-size: 12px; margin: 4px 0 0; }
    .checkgroup { display: flex; flex-direction: column; gap: 6px; }
    .check { display: flex; align-items: center; gap: 8px; text-transform: none; letter-spacing: normal; font-size: 14px; color: var(--fg, #eee); cursor: pointer; }
    .check input { width: auto; }
    .error-msg { color: #ff6464; margin: 12px 0; text-align: right; }
    .foot { display: flex; justify-content: flex-end; margin-top: 24px; }
    .foot .primary { padding: 12px 28px; background: var(--primary, #d4a93a); color: #111; border: none; border-radius: 4px; cursor: pointer; font-weight: 600; font-size: 15px; }
    .foot .primary[disabled] { opacity: 0.6; cursor: not-allowed; }
    .thankyou-card {
      max-width: 560px; margin: 80px auto; padding: 56px 40px;
      background: linear-gradient(180deg, var(--bg-2, #1a1a1a) 0%, var(--bg, #0d0d0d) 100%);
      border: 1px solid var(--line, #333); border-radius: 14px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.4);
      text-align: center;
    }
    /* Concentric check-ring — pulsing halo + solid green tick. */
    .thankyou-card .check-ring {
      width: 92px; height: 92px; margin: 0 auto 20px;
      border-radius: 50%; display: grid; place-items: center;
      background: radial-gradient(circle, rgba(86,201,138,0.22) 0%, rgba(86,201,138,0) 70%);
      animation: pulse 2s ease-out infinite;
    }
    .thankyou-card .check {
      width: 64px; height: 64px; border-radius: 50%;
      background: linear-gradient(135deg, #56c98a 0%, #3ba36a 100%);
      color: #fff; font-size: 34px; font-weight: 700; line-height: 64px;
      box-shadow: 0 4px 16px rgba(86,201,138,0.35);
    }
    @keyframes pulse {
      0%   { transform: scale(1);   opacity: 1; }
      70%  { transform: scale(1.15); opacity: 0.5; }
      100% { transform: scale(1.25); opacity: 0; }
    }
    .thankyou-card h1 { margin: 0 0 10px; font-size: 28px; letter-spacing: -0.3px; }
    .thankyou-card .thank-msg { color: var(--muted, #999); margin: 0 auto; max-width: 380px; line-height: 1.55; }

    /* Redirect block sits below the thanks message. */
    .redirect-row { margin-top: 28px; padding-top: 24px; border-top: 1px solid var(--line, #333); }
    .redirect-row .cta-row { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; margin-top: 12px; }
    .redirect-row .primary {
      display: inline-block; padding: 12px 24px;
      background: var(--primary, #d4a93a); color: #111;
      border-radius: 6px; font-weight: 600; text-decoration: none;
      transition: transform 120ms ease, box-shadow 120ms ease;
    }
    .redirect-row .primary:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(212,169,58,0.35); }
    .redirect-row .ghost {
      padding: 12px 20px; background: transparent;
      color: var(--muted, #999); border: 1px solid var(--line, #333);
      border-radius: 6px; cursor: pointer; font-size: 13px;
    }
    .redirect-row .ghost:hover { border-color: var(--muted, #999); color: var(--fg, #eee); }
  `],
})
export class OnboardingOpenPortal {
  private route = inject(ActivatedRoute);
  private http = inject(HttpClient);

  loading = signal(true);
  notFound = signal(false);
  state = signal<OpenState | null>(null);
  submitted = signal(false);
  submitting = signal(false);
  submitError = signal<string | null>(null);
  honeypot = '';
  values: Record<string, any> = {};

  /** Countdown until we navigate to `post_submit_url`. 0 = no timer
   *  active (either not set, already fired, or user cancelled). */
  redirectCountdown = signal(0);
  private redirectTimer: any = null;

  /** Short human label for the Continue button ("cms.example.com" from
   *  "https://cms.example.com/login?x=1"). Root-relative URLs read as
   *  "this site" — friendlier than showing "/cc/login". */
  redirectDestinationLabel(): string {
    const url = this.state()?.form?.post_submit_url || '';
    if (!url) return '';
    if (url.startsWith('/')) return 'this site';
    try {
      const u = new URL(url);
      return u.host.replace(/^www\./, '');
    } catch {
      return url;
    }
  }

  cancelRedirect() {
    if (this.redirectTimer) {
      clearInterval(this.redirectTimer);
      this.redirectTimer = null;
    }
    this.redirectCountdown.set(0);
  }

  /** Kick off the auto-redirect timer. 4-second grace so the user
   *  actually sees the confirmation card before the browser leaves. */
  private startRedirectTimer(url: string) {
    this.redirectCountdown.set(4);
    this.redirectTimer = setInterval(() => {
      const next = this.redirectCountdown() - 1;
      if (next <= 0) {
        clearInterval(this.redirectTimer);
        this.redirectTimer = null;
        this.redirectCountdown.set(0);
        window.location.href = url;
      } else {
        this.redirectCountdown.set(next);
      }
    }, 1000);
  }

  constructor() {
    const slug = this.route.snapshot.paramMap.get('slug');
    if (!slug) { this.notFound.set(true); this.loading.set(false); return; }
    this.http.get<OpenState>(`${BASE}/public/onboarding/slug/${slug}`).subscribe({
      next: r => { this.state.set(r); this.loading.set(false); },
      error: () => { this.notFound.set(true); this.loading.set(false); },
    });
  }

  isWide(fl: FormField): boolean {
    return fl.type === 'textarea' || (fl.type === 'checkbox' && !!fl.options && fl.options.length > 0);
  }
  isChecked(name: string, opt: string): boolean {
    const v = this.values[name];
    return Array.isArray(v) ? v.includes(opt) : false;
  }
  toggleCheck(name: string, opt: string, on: boolean) {
    const cur: string[] = Array.isArray(this.values[name]) ? [...this.values[name]] : [];
    if (on) { if (!cur.includes(opt)) cur.push(opt); }
    else    { const i = cur.indexOf(opt); if (i >= 0) cur.splice(i, 1); }
    this.values[name] = cur;
  }

  submit() {
    const st = this.state();
    if (!st || this.submitting()) return;
    this.submitting.set(true);
    this.submitError.set(null);
    const payload = { ...this.values, _hp: this.honeypot };
    this.http.post<{ ok: boolean; thank_you_message: string }>(
      `${BASE}/public/onboarding/slug/${st.form.slug}/submit`,
      payload,
    ).subscribe({
      next: () => {
        this.submitting.set(false);
        this.submitted.set(true);
        window.scrollTo(0, 0);
        // If the form is configured with a redirect target, start the
        // countdown so the user's confirmation experience feels active
        // rather than a dead-end thank-you screen.
        const redirect = st.form.post_submit_url;
        if (redirect) this.startRedirectTimer(redirect);
      },
      error: (e: any) => {
        this.submitting.set(false);
        this.submitError.set(e?.error?.error || 'Submit failed — please try again.');
      },
    });
  }
}
