import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { environment } from '@env/environment';
import { HttpClient, HttpParams } from '@angular/common/http';
import { FormSection } from '../../core/models';
import { PublicBrandBanner, PublicFooter } from '../../shared/public-chrome';
import { Subject, debounceTime } from 'rxjs';

interface PortalState {
  form: { id: number; slug: string; title: string; description?: string | null; intro_html?: string | null; submit_label?: string; thank_you_message?: string | null };
  sections: FormSection[];
  client: {
    email: string; name?: string | null;
    started_at: string; last_edited_at?: string | null; submitted_at?: string | null;
    completed_sections: string[]; edited_after_submit: number;
  };
  values: Record<string, any>;
  branding?: { bg_color?: string; name?: string; logo_url?: string };
}

const BASE = `${environment.basePath}/api`;

@Component({
  selector: 'app-onboarding-portal',
  imports: [FormsModule, PublicBrandBanner, PublicFooter],
  template: `
    @if (loading()) { <p class="loading">Loading…</p> }
    @else if (notFound()) {
      <div class="error-screen"><div class="card"><h1>Onboarding link invalid</h1><p>This link is broken or has expired.</p></div></div>
    }
    @else if (state(); as st) {
      <app-public-brand-banner
        [brandName]="st.branding?.name"
        [brandLogoUrl]="st.branding?.logo_url"
        [link]="brandLink"></app-public-brand-banner>

      <section class="hero">
        <div class="hero-grid">
          <div>
            <span class="overline">Welcome{{ st.client.name ? ', ' + st.client.name : ' Back' }}</span>
            <h1>{{ st.form.title }}</h1>
            @if (st.form.description) { <p class="lead">{{ st.form.description }}</p> }
            @if (!st.form.description && st.form.intro_html) { <div class="intro" [innerHTML]="st.form.intro_html"></div> }
          </div>
          <div class="status-card">
            <h5>Status</h5>
            @if (st.client.submitted_at) {
              <div class="status-row"><span class="dot success"></span><span>Submitted</span></div>
              @if (st.client.edited_after_submit) {
                <div class="muted small">Edited after submission — admin notified</div>
              }
            } @else if (lastSavedAt() || st.client.last_edited_at) {
              <div class="status-row"><span class="dot pulse"></span><span>In Progress</span></div>
              <div class="muted small">Last saved {{ lastSavedAt() || st.client.last_edited_at }}</div>
            } @else {
              <div class="status-row"><span class="dot"></span><span>Not Started</span></div>
            }
          </div>
        </div>
      </section>

      <section class="portal">
        <div class="portal-grid">
          <aside class="sidebar">
            <div class="card">
              <h5>Progress</h5>
              <div class="progress-steps">
                @for (s of st.sections; track s.id; let idx = $index) {
                  <button
                    class="progress-step"
                    [class.completed]="isComplete(s)"
                    [class.active]="activeIdx() === idx"
                    (click)="setActive(idx)">
                    <span class="step-name">{{ s.title }}</span>
                    <span class="step-state">
                      @if (isComplete(s)) { Completed }
                      @else if (activeIdx() === idx) { In progress }
                      @else { Pending }
                    </span>
                  </button>
                }
              </div>
              <div class="overall">
                <div class="overall-row">
                  <span class="muted small">Overall</span>
                  <span class="gold small">{{ progressPct() }}%</span>
                </div>
                <div class="bar-track"><div class="bar-fill" [style.width.%]="progressPct()"></div></div>
              </div>
            </div>
          </aside>

          <div>
            <div class="tab-nav">
              @for (s of st.sections; track s.id; let idx = $index) {
                <button class="tab-btn" [class.active]="activeIdx() === idx" (click)="setActive(idx)">
                  {{ s.title }}
                  @if (isComplete(s)) { <span class="tab-check">✓</span> }
                </button>
              }
            </div>

            @if (activeSection(); as sec) {
              <div class="card section-card">
                <h2>{{ sec.title }}</h2>
                @if (sec.description) { <p class="muted">{{ sec.description }}</p> }

                <form (submit)="$event.preventDefault()">
                  @for (f of sec.fields; track f.id) {
                    <div class="field">
                      <label [attr.for]="f.name">
                        {{ f.label }}@if (f.is_required) { <span class="req" title="Required">★</span> }
                      </label>
                      @switch (f.type) {
                        @case ('textarea') {
                          <textarea [id]="f.name" [(ngModel)]="st.values[f.name]" (ngModelChange)="onChange()" [name]="f.name" rows="4" [placeholder]="f.placeholder || ''"></textarea>
                        }
                        @case ('select') {
                          <select [id]="f.name" [(ngModel)]="st.values[f.name]" (ngModelChange)="onChange()" [name]="f.name">
                            <option value="">— select —</option>
                            @for (o of f.options; track o.value) { <option [value]="o.value">{{ o.label }}</option> }
                          </select>
                        }
                        @case ('radio') {
                          @for (o of f.options; track o.value) {
                            <label class="radio-row">
                              <input type="radio" [name]="f.name" [value]="o.value" [(ngModel)]="st.values[f.name]" (ngModelChange)="onChange()" />
                              <span>{{ o.label }}</span>
                            </label>
                          }
                        }
                        @case ('checkbox') {
                          @for (o of f.options; track o.value) {
                            <label class="checkbox-row">
                              <input type="checkbox" [value]="o.value" (change)="toggleCheckbox(f.name, o.value, $event)" [checked]="hasChecked(f.name, o.value)" />
                              <span>{{ o.label }}</span>
                            </label>
                          }
                        }
                        @case ('color') {
                          <div class="color-row">
                            <input type="color" [id]="f.name" [(ngModel)]="st.values[f.name]" (ngModelChange)="onChange()" [name]="f.name" class="color-swatch" />
                            <input type="text" [(ngModel)]="st.values[f.name]" (ngModelChange)="onChange()" [name]="f.name + '_t'" class="color-text" placeholder="#000000" />
                          </div>
                        }
                        @case ('style_cards') {
                          <div class="style-cards-grid">
                            @for (o of f.options; track o.value; let idx = $index) {
                              <label class="style-card">
                                <input type="radio" [name]="f.name" [value]="o.value" [(ngModel)]="st.values[f.name]" (ngModelChange)="onChange()" hidden />
                                <div class="style-card-inner" [class.selected]="st.values[f.name] === o.value">
                                  <div class="style-card-preview" [style.background]="cardGradient(idx)"></div>
                                  <span>{{ o.label }}</span>
                                </div>
                              </label>
                            }
                          </div>
                        }
                        @case ('file') {
                          <input type="file" [id]="f.name" (change)="uploadFile(f.name, $event)" />
                          @if (st.values[f.name]) { <div class="file-current">Current: <a [href]="storageUrl(st.values[f.name])" target="_blank">{{ st.values[f.name] }}</a></div> }
                        }
                        @case ('multi_file') {
                          <input type="file" multiple [id]="f.name" (change)="uploadMultiFile(f.name, $event)" />
                          @if (parsedList(st.values[f.name]).length) {
                            <ul class="file-list">
                              @for (p of parsedList(st.values[f.name]); track p) {
                                <li><a [href]="storageUrl(p)" target="_blank">{{ p.split('/').pop() }}</a></li>
                              }
                            </ul>
                          }
                        }
                        @case ('date') {
                          <input type="date" [id]="f.name" [(ngModel)]="st.values[f.name]" (ngModelChange)="onChange()" [name]="f.name" />
                        }
                        @case ('datetime') {
                          <input type="datetime-local" [id]="f.name" [(ngModel)]="st.values[f.name]" (ngModelChange)="onChange()" [name]="f.name" />
                        }
                        @default {
                          <input [type]="f.type" [id]="f.name" [(ngModel)]="st.values[f.name]" (ngModelChange)="onChange()" [name]="f.name" [placeholder]="f.placeholder || ''" />
                        }
                      }
                      @if (f.help_text) { <div class="muted small">{{ f.help_text }}</div> }
                    </div>
                  }

                  <div class="form-footer">
                    <span class="muted small">
                      @if (saving()) { Saving… }
                      @else if (lastSavedAt()) { Saved {{ lastSavedAt() }} }
                      @else { All fields are saved automatically }
                    </span>
                    @if (isLastSection()) {
                      <button type="button" class="primary" (click)="finalize()" [disabled]="finalizing()">
                        {{ st.client.submitted_at ? 'Save changes' : 'Complete onboarding' }}
                      </button>
                    } @else {
                      <button type="button" class="primary" (click)="saveAndContinue()">Save & Continue</button>
                    }
                  </div>
                </form>
              </div>
            }
          </div>
        </div>
      </section>

      @if (finalDone()) {
        <section class="thanks">
          <div class="card">
            <h2>Thank you!</h2>
            <div [innerHTML]="finalMessage()"></div>
          </div>
        </section>
      }

      <app-public-footer></app-public-footer>
    }
  `,
  styles: [`
    :host { display: block; min-height: 100vh; }
    .loading { padding: 60px; text-align: center; color: var(--muted); }
    .error-screen { padding: 80px 20px; max-width: 480px; margin: 0 auto; }

    /* Hero */
    .hero { padding: 48px 40px; max-width: 1200px; margin: 0 auto; }
    .hero-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 48px; align-items: start; }
    .overline { color: var(--primary); text-transform: uppercase; letter-spacing: 0.15em; font-size: 12px; font-weight: 600; }
    .hero h1 { margin: 12px 0 16px; font-size: clamp(2rem, 4vw, 3rem); color: #000000; }
    .lead, .intro { color: #000000; font-size: 16px; line-height: 1.6; max-width: 560px; }
    .intro * { color: inherit; }
    .status-card { background: var(--bg-2); border: 1px solid var(--primary); border-radius: var(--radius); padding: 24px; }
    .status-card h5 { margin: 0 0 16px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); font-weight: 600; }
    .status-row { display: flex; align-items: center; gap: 10px; font-weight: 600; color: var(--primary); margin-bottom: 8px; }
    .dot { width: 12px; height: 12px; border-radius: 50%; background: var(--muted); display: inline-block; }
    .dot.success { background: var(--success); }
    .dot.pulse { background: var(--primary); animation: pulse 2s infinite; }
    @keyframes pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(212, 169, 58, 0.7); } 50% { box-shadow: 0 0 0 8px rgba(212, 169, 58, 0); } }

    /* Portal grid */
    .portal { padding: 0 40px 64px; max-width: 1200px; margin: 0 auto; }
    .portal-grid { display: grid; grid-template-columns: 280px 1fr; gap: 48px; align-items: start; }
    .sidebar { position: sticky; top: 24px; }
    .sidebar h5 { margin: 0 0 24px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); font-weight: 600; }

    .progress-steps { display: flex; flex-direction: column; gap: 0; }
    .progress-step {
      display: block; width: 100%; text-align: left;
      background: none; border: none; color: var(--fg);
      padding: 16px 0 16px 24px;
      border-left: 2px solid var(--line);
      margin-left: 12px;
      position: relative;
      cursor: pointer;
      transition: color 0.15s;
    }
    .progress-step::before {
      content: ''; position: absolute; left: -7px; top: 18px;
      width: 12px; height: 12px; border-radius: 50%;
      background: var(--bg-3); border: 2px solid var(--line);
      transition: all 0.15s;
    }
    .progress-step.completed::before { background: var(--primary); border-color: var(--primary); }
    .progress-step.active { border-left-color: var(--primary); }
    .progress-step.active::before { background: var(--bg); border-color: var(--primary); box-shadow: 0 0 0 4px rgba(212, 169, 58, 0.2); }
    .progress-step:hover { color: var(--primary); }
    .step-name { display: block; font-size: 14px; font-weight: 500; }
    .step-state { display: block; font-size: 11px; color: var(--muted); margin-top: 2px; text-transform: uppercase; letter-spacing: 0.1em; }
    .progress-step.active .step-name { color: var(--primary); }

    .overall { margin-top: 24px; padding-top: 24px; border-top: 1px solid var(--line); }
    .overall-row { display: flex; justify-content: space-between; margin-bottom: 8px; }
    .gold { color: var(--primary); }
    .bar-track { height: 6px; background: rgba(255, 255, 255, 0.12); border-radius: 999px; overflow: hidden; }
    .bar-fill { height: 100%; background: var(--primary); transition: width 0.3s; }

    /* Tabs + section card */
    .tab-nav {
      display: flex; gap: 4px;
      border-bottom: 1px solid var(--line);
      margin-bottom: 24px;
      overflow-x: auto;
    }
    .tab-btn {
      padding: 14px 20px; background: none; border: none;
      color: var(--muted); cursor: pointer; position: relative;
      font-size: 13px; white-space: nowrap;
      transition: color 0.15s;
      display: inline-flex; align-items: center; gap: 8px;
    }
    .tab-btn:hover { color: var(--primary); }
    .tab-btn.active { color: var(--primary); }
    .tab-btn.active::after {
      content: ''; position: absolute; bottom: -1px; left: 0; right: 0; height: 2px;
      background: var(--primary);
    }
    .tab-check { color: var(--success); font-weight: 700; }

    .section-card { padding: 32px; }
    .section-card h2 { margin: 0 0 8px; }

    .field { margin: 20px 0; }
    .field label { display: block; color: var(--fg); margin-bottom: 6px; text-transform: none; letter-spacing: 0; font-size: 13px; font-weight: 500; }
    .field .req {
      display: inline-block;
      margin-left: 4px;
      color: var(--primary);
      font-size: 14px;
      line-height: 1;
      vertical-align: middle;
    }
    .radio-row, .checkbox-row { display: flex; align-items: center; gap: 8px; padding: 6px 0; }
    .radio-row input, .checkbox-row input { width: auto; margin: 0; }
    .file-current, .file-list { margin-top: 8px; font-size: 12px; }
    .file-list { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 4px; }
    .file-list li { padding: 6px 10px; background: var(--bg-3); border-radius: var(--radius-sm); font-family: "JetBrains Mono", monospace; }

    .color-row { display: flex; gap: 8px; align-items: center; }
    .color-row .color-swatch { width: 50px; height: 42px; padding: 2px; cursor: pointer; }
    .color-row .color-text { flex: 1; font-family: "JetBrains Mono", monospace; }

    .style-cards-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
    @media (max-width: 600px) { .style-cards-grid { grid-template-columns: repeat(2, 1fr); } }
    .style-card { cursor: pointer; }
    .style-card-inner { padding: 16px; text-align: center; border: 2px solid var(--line); border-radius: var(--radius-sm); background: var(--bg-3); transition: border-color 0.15s; }
    .style-card-inner.selected { border-color: var(--primary); }
    .style-card-preview { height: 60px; border-radius: 4px; margin-bottom: 12px; }
    .style-card span { font-size: 13px; color: var(--fg); }

    .form-footer {
      display: flex; justify-content: space-between; align-items: center;
      padding-top: 24px; margin-top: 24px;
      border-top: 1px solid var(--line); gap: 16px; flex-wrap: wrap;
    }

    .thanks { padding: 64px 40px; max-width: 720px; margin: 0 auto; text-align: center; }
    .thanks .card { padding: 48px; }

    @media (max-width: 900px) {
      .hero-grid, .portal-grid { grid-template-columns: 1fr; }
      .sidebar { position: relative; top: 0; }
    }
    @media (max-width: 768px) {
      .hero, .portal { padding-left: 20px; padding-right: 20px; }
      .form-footer { flex-direction: column; align-items: stretch; }
      .form-footer .primary { width: 100%; }
    }
  `],
})
export class OnboardingPortal {
  private route = inject(ActivatedRoute);
  private http  = inject(HttpClient);

  loading = signal(true);
  notFound = signal(false);
  state = signal<PortalState | null>(null);
  activeIdx = signal(0);
  saving = signal(false);
  finalizing = signal(false);
  lastSavedAt = signal<string | null>(null);
  finalDone = signal(false);
  finalMessage = signal('');

  brandLink = 'https://builtrightstudio.com';

  private formId = 0;
  private token = '';
  private autosave$ = new Subject<void>();

  activeSection = computed(() => {
    const st = this.state();
    if (!st) return null;
    return st.sections[this.activeIdx()] ?? null;
  });

  ngOnInit() {
    this.formId = +this.route.snapshot.paramMap.get('formId')!;
    this.token  = this.route.snapshot.paramMap.get('token') || '';

    this.autosave$.pipe(debounceTime(600)).subscribe(() => this.saveValues());

    this.http.get<PortalState>(`${BASE}/public/onboarding/${this.formId}/${this.token}`).subscribe({
      next: st => {
        // Coerce checkbox JSON-strings into arrays for two-way binding
        for (const s of st.sections) {
          for (const f of s.fields) {
            if (f.type === 'checkbox') {
              const cur = (st.values as any)[f.name];
              if (typeof cur === 'string') {
                try { const parsed = JSON.parse(cur); if (Array.isArray(parsed)) (st.values as any)[f.name] = parsed; }
                catch {}
              } else if (cur === undefined || cur === null) {
                (st.values as any)[f.name] = [];
              }
            }
          }
        }
        this.state.set(st);
        if (st.branding?.bg_color) {
          // Apply to both <html> and <body> so any extra height beyond the
          // viewport doesn't reveal a different default page background.
          document.documentElement.style.backgroundColor = st.branding.bg_color;
          document.body.style.backgroundColor = st.branding.bg_color;
        }
        this.loading.set(false);
      },
      error: () => { this.notFound.set(true); this.loading.set(false); },
    });
  }

  ngOnDestroy() {
    document.documentElement.style.backgroundColor = '';
    document.body.style.backgroundColor = '';
  }

  setActive(idx: number) { this.activeIdx.set(idx); }
  isLastSection() { const st = this.state(); return st ? this.activeIdx() === st.sections.length - 1 : false; }

  isComplete(s: FormSection): boolean {
    const st = this.state();
    if (!st) return false;
    const required = s.fields.filter(f => f.is_required);
    if (required.length === 0) {
      // No required fields — section counts as complete only when explicitly
      // marked via Save & Continue.
      return st.client.completed_sections.includes(s.slug);
    }
    // Otherwise, complete when every required field has a value.
    return required.every(f => this.isFilled((st.values as any)[f.name]));
  }
  /** A field counts as "filled" when its value is non-empty for its type. */
  private isFilled(value: any): boolean {
    if (value === null || value === undefined || value === '') return false;
    if (Array.isArray(value) && value.length === 0) return false;
    if (typeof value === 'string' && value.trim() === '') return false;
    return true;
  }
  progressPct(): number {
    const st = this.state();
    if (!st) return 0;
    let total = 0, filled = 0;
    for (const s of st.sections) {
      for (const f of s.fields) {
        if (!f.is_required) continue;
        total++;
        if (this.isFilled((st.values as any)[f.name])) filled++;
      }
    }
    if (total === 0) {
      // Fall back to section-completion ratio when the form has no required
      // fields at all, so the bar still reflects the user's progression.
      if (!st.sections.length) return 0;
      return Math.round((st.client.completed_sections.length / st.sections.length) * 100);
    }
    return Math.round((filled / total) * 100);
  }

  hasChecked(name: string, value: string): boolean {
    const v = (this.state()?.values as any)?.[name];
    return Array.isArray(v) && v.includes(value);
  }
  toggleCheckbox(name: string, value: string, e: Event) {
    const checked = (e.target as HTMLInputElement).checked;
    const st = this.state(); if (!st) return;
    let arr = (st.values as any)[name];
    if (!Array.isArray(arr)) arr = [];
    if (checked) { if (!arr.includes(value)) arr.push(value); }
    else { arr = arr.filter((v: string) => v !== value); }
    (st.values as any)[name] = arr;
    this.onChange();
  }

  onChange() {
    // Re-emit the state signal so anything reading via the signal API (and the
    // progress / per-section completion in particular) recomputes on every keystroke.
    const cur = this.state();
    if (cur) this.state.set({ ...cur });
    this.autosave$.next();
  }

  private buildJsonValues(): Record<string, any> {
    const st = this.state();
    if (!st) return {};
    const out: Record<string, any> = {};
    for (const s of st.sections) {
      for (const f of s.fields) {
        if (f.type === 'file' || f.type === 'multi_file') continue;
        const v = (st.values as any)[f.name];
        if (v !== undefined) out[f.name] = v;
      }
    }
    return out;
  }

  saveValues(completeSlug?: string): Promise<void> {
    return new Promise(resolve => {
      const st = this.state(); if (!st) return resolve();
      this.saving.set(true);
      let url = `${BASE}/public/onboarding/${this.formId}/${this.token}`;
      const params = completeSlug ? new HttpParams().set('complete', completeSlug) : undefined;
      this.http.put<{ ok: boolean; completed_sections: string[] }>(url, this.buildJsonValues(), { params }).subscribe({
        next: r => {
          this.saving.set(false);
          this.lastSavedAt.set(new Date().toLocaleTimeString());
          if (r.completed_sections) {
            st.client.completed_sections = r.completed_sections;
            this.state.set({ ...st });
          }
          resolve();
        },
        error: () => { this.saving.set(false); resolve(); },
      });
    });
  }

  async saveAndContinue() {
    const st = this.state(); if (!st) return;
    const cur = st.sections[this.activeIdx()];
    if (cur) await this.saveValues(cur.slug);
    if (this.activeIdx() < st.sections.length - 1) this.activeIdx.set(this.activeIdx() + 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  uploadFile(name: string, e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0]; if (!file) return;
    this.uploadFiles(name, [file], false);
  }
  uploadMultiFile(name: string, e: Event) {
    const input = e.target as HTMLInputElement;
    const files = input.files ? Array.from(input.files) : [];
    if (!files.length) return;
    this.uploadFiles(name, files, true);
  }
  private uploadFiles(name: string, files: File[], multi: boolean) {
    const fd = new FormData();
    if (multi) for (const f of files) fd.append(`${name}[]`, f);
    else fd.append(name, files[0]);
    this.saving.set(true);
    this.http.put<{ ok: boolean }>(`${BASE}/public/onboarding/${this.formId}/${this.token}`, fd).subscribe({
      next: () => {
        this.saving.set(false);
        this.lastSavedAt.set(new Date().toLocaleTimeString());
        // Re-fetch to pick up the new path(s) since multipart doesn't echo them
        this.http.get<PortalState>(`${BASE}/public/onboarding/${this.formId}/${this.token}`).subscribe(st => {
          const cur = this.state(); if (!cur) return;
          (cur.values as any)[name] = (st.values as any)[name];
          this.state.set({ ...cur });
        });
      },
      error: () => this.saving.set(false),
    });
  }

  storageUrl(name: string): string { return `${environment.basePath}/storage/${name}`; }

  parsedList(val: any): string[] {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    if (typeof val === 'string') {
      try { const p = JSON.parse(val); if (Array.isArray(p)) return p; } catch {}
    }
    return [];
  }

  cardGradient(idx: number): string {
    const palettes = [
      'linear-gradient(135deg, #fff 0%, #f5f5f5 100%)',
      'linear-gradient(135deg, #1a1a1a 0%, #333 100%)',
      'linear-gradient(135deg, #d4a93a 0%, #b8860b 100%)',
      'linear-gradient(135deg, #ff6b6b 0%, #4ecdc4 100%)',
      'linear-gradient(135deg, #2c3e50 0%, #3498db 100%)',
      'linear-gradient(135deg, #a8d5ba 0%, #f5e6cc 100%)',
    ];
    return palettes[idx % palettes.length];
  }

  async finalize() {
    const st = this.state(); if (!st) return;
    const cur = st.sections[this.activeIdx()];
    if (cur) await this.saveValues(cur.slug);
    this.finalizing.set(true);
    this.http.post<{ ok: boolean; thank_you_message: string }>(
      `${BASE}/public/onboarding/${this.formId}/${this.token}/submit`, {}
    ).subscribe({
      next: r => {
        this.finalizing.set(false);
        this.finalMessage.set(r.thank_you_message || 'Thanks — your submission was received.');
        this.finalDone.set(true);
        const cs = this.state();
        if (cs) {
          cs.client.submitted_at = new Date().toISOString();
          this.state.set({ ...cs });
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
      },
      error: () => this.finalizing.set(false),
    });
  }
}
