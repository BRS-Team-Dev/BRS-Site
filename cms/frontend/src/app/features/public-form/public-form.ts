import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Api } from '../../core/api';
import { FormDef, FormField } from '../../core/models';
import { PublicBrandBanner, PublicFooter } from '../../shared/public-chrome';

@Component({
  selector: 'app-public-form',
  imports: [FormsModule, PublicBrandBanner, PublicFooter],
  template: `
    <app-public-brand-banner [brandName]="brandName()" [brandLogoUrl]="brandLogoUrl()"></app-public-brand-banner>
    <div class="wrap">
      @if (loading()) {
        <p class="muted">Loading…</p>
      } @else if (notFound()) {
        <div class="card"><p>Form not found or not published.</p></div>
      } @else if (submitted()) {
        <div class="card"><div [innerHTML]="thankYou()"></div></div>
      } @else if (form()) {
        <div class="card">
          <h1>{{ form()!.title }}</h1>
          @if (form()!.intro_html) { <div [innerHTML]="form()!.intro_html"></div> }

          <form (submit)="submit($event)">
            @for (f of fields(); track f.id) {
              <div class="field">
                <label [attr.for]="f.name">
                  {{ f.label }} @if (f.is_required) { <span style="color:var(--danger)">*</span> }
                </label>
                @switch (f.type) {
                  @case ('textarea') {
                    <textarea
                      [id]="f.name"
                      [name]="f.name"
                      [(ngModel)]="values[f.name]"
                      [required]="!!f.is_required"
                      [placeholder]="f.placeholder || ''"
                      rows="4"></textarea>
                  }
                  @case ('select') {
                    <select [id]="f.name" [name]="f.name" [(ngModel)]="values[f.name]" [required]="!!f.is_required">
                      <option value="">— select —</option>
                      @for (o of f.options; track o.value) {
                        <option [value]="o.value">{{ o.label }}</option>
                      }
                    </select>
                  }
                  @case ('radio') {
                    @for (o of f.options; track o.value) {
                      <div class="checkbox-row">
                        <input type="radio" [id]="f.name + '_' + o.value" [name]="f.name" [value]="o.value" [(ngModel)]="values[f.name]" [required]="!!f.is_required" />
                        <label [for]="f.name + '_' + o.value">{{ o.label }}</label>
                      </div>
                    }
                  }
                  @case ('checkbox') {
                    @for (o of f.options; track o.value) {
                      <div class="checkbox-row">
                        <input type="checkbox" [id]="f.name + '_' + o.value" [value]="o.value" (change)="toggleCheckbox(f.name, o.value, $event)" />
                        <label [for]="f.name + '_' + o.value">{{ o.label }}</label>
                      </div>
                    }
                  }
                  @case ('file') {
                    <input type="file" [id]="f.name" [name]="f.name" (change)="onFile(f.name, $event)" [required]="!!f.is_required" />
                  }
                  @case ('multi_file') {
                    <input type="file" multiple [id]="f.name" [name]="f.name" (change)="onMultiFile(f.name, $event)" [required]="!!f.is_required" />
                    @if (multiFiles[f.name]?.length) {
                      <ul class="file-list">
                        @for (file of multiFiles[f.name]; track file.name) {
                          <li>{{ file.name }}</li>
                        }
                      </ul>
                    }
                  }
                  @case ('color') {
                    <div class="color-row">
                      <input type="color" [id]="f.name" [name]="f.name" [(ngModel)]="values[f.name]" [required]="!!f.is_required" class="color-swatch" />
                      <input type="text" [(ngModel)]="values[f.name]" [name]="f.name + '_text'" placeholder="#000000" class="color-text" />
                    </div>
                  }
                  @case ('style_cards') {
                    <div class="style-cards-grid">
                      @for (o of f.options; track o.value; let idx = $index) {
                        <label class="style-card">
                          <input type="radio" [name]="f.name" [value]="o.value" [(ngModel)]="values[f.name]" [required]="!!f.is_required" hidden />
                          <div class="style-card-inner" [class.selected]="values[f.name] === o.value">
                            <div class="style-card-preview" [style.background]="cardGradient(idx)"></div>
                            <span>{{ o.label }}</span>
                          </div>
                        </label>
                      }
                    </div>
                  }
                  @case ('date') {
                    <input type="date" [id]="f.name" [name]="f.name" [(ngModel)]="values[f.name]" [required]="!!f.is_required" />
                  }
                  @case ('datetime') {
                    <input type="datetime-local" [id]="f.name" [name]="f.name" [(ngModel)]="values[f.name]" [required]="!!f.is_required" />
                  }
                  @default {
                    <input
                      [type]="f.type"
                      [id]="f.name"
                      [name]="f.name"
                      [(ngModel)]="values[f.name]"
                      [required]="!!f.is_required"
                      [placeholder]="f.placeholder || ''" />
                  }
                }
                @if (f.help_text) { <div class="muted small">{{ f.help_text }}</div> }
                @if (errors()[f.name]) { <div class="error-msg">{{ errors()[f.name] }}</div> }
              </div>
            }
            @if (generalError()) { <div class="error-msg">{{ generalError() }}</div> }
            <button type="submit" class="primary" [disabled]="submitting()">
              {{ submitting() ? 'Submitting…' : (form()!.submit_label || 'Submit') }}
            </button>
          </form>
        </div>
      }
    </div>

    <app-public-footer></app-public-footer>
  `,
  styles: [`
    .wrap { max-width: 640px; margin: 0 auto; padding: 40px; }
    .card { padding: 40px; }
    .card h1 { margin-top: 0; }
    .field { margin: 16px 0; }
    .field label { color: var(--fg); text-transform: none; letter-spacing: 0; font-size: 13px; font-weight: 500; }

    .color-row { display: flex; gap: 8px; align-items: center; }
    .color-row .color-swatch { width: 50px; height: 42px; padding: 2px; flex-shrink: 0; cursor: pointer; }
    .color-row .color-text { flex: 1; font-family: "JetBrains Mono", monospace; }

    .style-cards-grid {
      display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;
    }
    @media (max-width: 600px) { .style-cards-grid { grid-template-columns: repeat(2, 1fr); } }
    .style-card { cursor: pointer; }
    .style-card-inner {
      padding: 16px; text-align: center;
      border: 2px solid var(--line);
      border-radius: var(--radius-sm);
      background: var(--bg-3);
      transition: border-color 0.15s;
    }
    .style-card-inner.selected { border-color: var(--primary); }
    .style-card-preview { height: 60px; border-radius: 4px; margin-bottom: 12px; }
    .style-card span { font-size: 13px; color: var(--fg); }

    .file-list {
      list-style: none; padding: 0; margin: 8px 0 0 0;
      display: flex; flex-direction: column; gap: 4px;
    }
    .file-list li {
      padding: 6px 10px;
      background: var(--bg-3);
      border-radius: var(--radius-sm);
      font-size: 12px;
      font-family: "JetBrains Mono", monospace;
    }
  `],
})
export class PublicForm {
  private api = inject(Api);
  private route = inject(ActivatedRoute);

  loading = signal(true);
  notFound = signal(false);
  submitted = signal(false);
  submitting = signal(false);
  form = signal<FormDef | null>(null);
  fields = signal<(FormField & { options?: { value: string; label: string }[] })[]>([]);
  values: Record<string, any> = {};
  files: Record<string, File> = {};
  multiFiles: Record<string, File[]> = {};
  checkboxes: Record<string, Set<string>> = {};
  errors = signal<Record<string, string>>({});
  generalError = signal<string | null>(null);
  thankYou = signal<string>('');
  brandName = signal<string>('');
  brandLogoUrl = signal<string>('');

  ngOnInit() {
    const slug = this.route.snapshot.paramMap.get('slug')!;
    this.api.getPublicForm(slug).subscribe({
      next: res => {
        this.form.set(res.form);
        this.fields.set(res.fields as any);
        for (const f of res.fields) {
          if (f.type === 'checkbox') this.checkboxes[f.name] = new Set();
        }
        const bg = res.branding?.bg_color?.trim();
        if (bg) document.body.style.backgroundColor = bg;
        this.brandName.set(res.branding?.name?.trim() ?? '');
        this.brandLogoUrl.set(res.branding?.logo_url?.trim() ?? '');
        this.loading.set(false);
      },
      error: () => { this.notFound.set(true); this.loading.set(false); },
    });
  }

  ngOnDestroy() {
    document.body.style.backgroundColor = '';
  }

  onFile(name: string, e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files?.[0]) this.files[name] = input.files[0];
  }
  onMultiFile(name: string, e: Event) {
    const input = e.target as HTMLInputElement;
    this.multiFiles[name] = input.files ? Array.from(input.files) : [];
  }
  toggleCheckbox(name: string, value: string, e: Event) {
    const checked = (e.target as HTMLInputElement).checked;
    const set = this.checkboxes[name];
    if (checked) set.add(value); else set.delete(value);
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

  submit(e: Event) {
    e.preventDefault();
    this.submitting.set(true);
    this.errors.set({});
    this.generalError.set(null);

    const slug = this.form()!.slug;
    const hasFiles = Object.keys(this.files).length > 0
      || Object.values(this.multiFiles).some(arr => arr.length > 0);

    let body: any;
    if (hasFiles) {
      body = new FormData();
      for (const [k, v] of Object.entries(this.values)) {
        if (v !== undefined && v !== null) body.append(k, String(v));
      }
      for (const [k, set] of Object.entries(this.checkboxes)) {
        for (const v of set) body.append(`${k}[]`, v);
      }
      for (const [k, file] of Object.entries(this.files)) body.append(k, file);
      for (const [k, list] of Object.entries(this.multiFiles)) {
        for (const file of list) body.append(`${k}[]`, file);
      }
    } else {
      body = { ...this.values };
      for (const [k, set] of Object.entries(this.checkboxes)) body[k] = [...set];
    }

    this.api.submitPublic(slug, body).subscribe({
      next: r => {
        this.submitting.set(false);
        this.thankYou.set(r.thank_you_message || 'Thanks — your submission was received.');
        this.submitted.set(true);
      },
      error: e => {
        this.submitting.set(false);
        if (e?.error?.fields) this.errors.set(e.error.fields);
        else this.generalError.set(e?.error?.error || 'Submission failed');
      },
    });
  }
}
