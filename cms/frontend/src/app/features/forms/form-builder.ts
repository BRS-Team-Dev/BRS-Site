import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { FIELD_TYPES, FormDef, FormField, HAS_OPTIONS, FieldType } from '../../core/models';
import { SIDENAV_BUILTIN_PARENTS } from '../../core/sidenav-config';

interface FieldDraft extends FormField {
  _localId?: number;
  _options?: { value: string; label: string }[];
}

let _localCounter = 1;

@Component({
  selector: 'app-form-builder',
  imports: [FormsModule],
  template: `
    <div class="toolbar">
      <button class="ghost" (click)="back()">← Back</button>
      <h1>{{ isNew() ? 'New form' : 'Edit form' }}</h1>
      <span class="spacer"></span>
      @if (saving()) { <span class="muted small">Saving…</span> }
      @if (error()) { <span class="error-msg">{{ error() }}</span> }
      <button class="primary" (click)="save()" [disabled]="saving()">Save</button>
    </div>

    <div class="layout">
      <section class="meta card">
        <h2>Form details</h2>

        <label>Title</label>
        <input [(ngModel)]="form.title" (ngModelChange)="autoSlug()" name="title" />

        <label>Slug (used in URL and DB table name)</label>
        <input [(ngModel)]="form.slug" name="slug" />
        <div class="muted small">Lowercase letters, digits, underscores. Starts with a letter.</div>

        <label>Submit button label</label>
        <input [(ngModel)]="form.submit_label" name="submit_label" placeholder="Submit" />

        <label>Intro / write-up (HTML allowed)</label>
        <textarea [(ngModel)]="form.intro_html" name="intro_html" rows="3"></textarea>

        <label>Thank-you message (shown after submit)</label>
        <textarea [(ngModel)]="form.thank_you_message" name="thank_you_message" rows="2"></textarea>

        <div class="checkbox-row">
          <input type="checkbox" id="pub" [(ngModel)]="form.is_published" name="is_published" />
          <label for="pub">Published (publicly accessible)</label>
        </div>

        <hr />
        <h2>Sidenav placement</h2>
        <label>Where should this form appear?</label>
        <select [(ngModel)]="form.sidenav_placement" name="sidenav_placement">
          <option value="top">Don't show in sidenav (default)</option>
          <option value="child">As a child of another section</option>
        </select>

        @if (form.sidenav_placement === 'child') {
          <label>Parent section</label>
          <select [(ngModel)]="form.sidenav_parent_key" name="sidenav_parent_key">
            <option [ngValue]="null">— pick a parent —</option>
            @for (p of parentChoices(); track p.key) {
              <option [ngValue]="p.key">{{ p.label }}</option>
            }
          </select>
        }

        <hr />
        <h2>Parent process</h2>
        <div class="muted small" style="margin-bottom: 8px;">
          Optionally link this form to another process so its submissions belong to that process's records.
        </div>
        <select [(ngModel)]="form.parent_process_form_id" name="parent_process_form_id">
          <option [ngValue]="null">— none (standalone) —</option>
          @for (p of parentProcessChoices(); track p.id) {
            <option [ngValue]="p.id">{{ p.title }}</option>
          }
        </select>

        <hr />
        <h2>Email — admin notification</h2>
        <label>Recipient email (notify on submission)</label>
        <input type="email" [(ngModel)]="form.notify_email" name="notify_email" placeholder="you@example.com" />
        <label>Subject</label>
        <input [(ngModel)]="form.notify_subject" name="notify_subject" placeholder="New submission: {{ form.title }}" />
        <label>HTML body — use {{ '{{ field_name }}' }} tokens</label>
        <textarea [(ngModel)]="form.notify_template" name="notify_template" rows="4"></textarea>

        <hr />
        <h2>Email — thank-you to submitter</h2>
        <label>Which field holds the submitter's email?</label>
        <select [(ngModel)]="form.reply_from_field" name="reply_from_field">
          <option [ngValue]="null">— none —</option>
          @for (f of emailFields(); track f.name) {
            <option [value]="f.name">{{ f.label }} ({{ f.name }})</option>
          }
        </select>
        <label>Subject</label>
        <input [(ngModel)]="form.reply_subject" name="reply_subject" placeholder="Thanks for your submission" />
        <label>HTML body</label>
        <textarea [(ngModel)]="form.reply_template" name="reply_template" rows="4"></textarea>
      </section>

      <section class="fields card">
        <div class="row">
          <h2 style="margin:0;flex:1;">Fields</h2>
          <button class="primary" (click)="addField()">+ Add field</button>
        </div>

        @if (fields().length === 0) {
          <p class="muted">No fields yet. Click "Add field" to start.</p>
        }

        @for (f of fields(); track f._localId; let i = $index) {
          <div class="field">
            <div class="field-head row">
              <strong>{{ f.label || '(unnamed)' }}</strong>
              <code>{{ f.name }}</code>
              <span class="badge">{{ f.type }}</span>
              <span class="spacer"></span>
              <button class="ghost" (click)="moveUp(i)" [disabled]="i === 0">↑</button>
              <button class="ghost" (click)="moveDown(i)" [disabled]="i === fields().length - 1">↓</button>
              <button class="danger" (click)="remove(i)">Remove</button>
            </div>
            <div class="field-body">
              <div>
                <label>Label</label>
                <input [ngModel]="f.label" (ngModelChange)="onLabel(i, $event)" name="label_{{i}}" />
              </div>
              <div>
                <label>Field name (column)</label>
                <input [ngModel]="f.name" (ngModelChange)="setField(i, 'name', $event)" name="name_{{i}}" />
              </div>
              <div>
                <label>Type</label>
                <select [ngModel]="f.type" (ngModelChange)="setField(i, 'type', $event)" name="type_{{i}}">
                  @for (t of fieldTypes; track t.value) {
                    <option [value]="t.value">{{ t.label }}</option>
                  }
                </select>
              </div>
              <div>
                <label>Placeholder</label>
                <input [ngModel]="f.placeholder" (ngModelChange)="setField(i, 'placeholder', $event)" name="ph_{{i}}" />
              </div>
              <div style="grid-column: 1 / -1;">
                <label>Help text</label>
                <input [ngModel]="f.help_text" (ngModelChange)="setField(i, 'help_text', $event)" name="help_{{i}}" />
              </div>

              @if (hasOptions(f.type)) {
                <div style="grid-column: 1 / -1;">
                  <label>Options (one per line, optionally "value|label")</label>
                  <textarea
                    [ngModel]="optionsToText(f)"
                    (ngModelChange)="setOptions(i, $event)"
                    name="opts_{{i}}"
                    rows="3"
                    placeholder="red&#10;green&#10;blue"></textarea>
                </div>
              }

              <div class="checkbox-row" style="grid-column: 1 / -1;">
                <input
                  type="checkbox"
                  id="req_{{i}}"
                  [ngModel]="!!f.is_required"
                  (ngModelChange)="setField(i, 'is_required', $event ? 1 : 0)"
                  name="req_{{i}}" />
                <label for="req_{{i}}">Required</label>
              </div>
            </div>
          </div>
        }
      </section>
    </div>
  `,
  styles: [`
    .layout { display: grid; grid-template-columns: 380px 1fr; gap: 20px; padding: 20px; align-items: start; }
    .card h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); margin: 0 0 12px 0; font-weight: 600; }
    .meta label { margin-top: 12px; }
    .meta hr { border: none; border-top: 1px solid var(--line); margin: 20px 0 16px 0; }
    .field { border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 12px; margin-top: 12px; background: var(--bg); }
    .field-head { gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
    .field-head code { font-size: 11px; }
    .field-body { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    @media (max-width: 1100px) { .layout { grid-template-columns: 1fr; } }
  `],
})
export class FormBuilder {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  fieldTypes = FIELD_TYPES;
  hasOptions = (t: FieldType) => HAS_OPTIONS.includes(t);

  isNew = signal(true);
  formId = signal<number | null>(null);
  fields = signal<FieldDraft[]>([]);
  saving = signal(false);
  error = signal<string | null>(null);
  onboardingForms = signal<FormDef[]>([]);

  form: Partial<FormDef> = {
    title: '', slug: '', submit_label: 'Submit',
    is_published: false, thank_you_message: '',
    sidenav_placement: 'top', sidenav_parent_key: null,
    parent_process_form_id: null,
  };

  emailFields = computed(() => this.fields().filter(f => f.type === 'email'));

  parentChoices = computed<{ key: string; label: string }[]>(() => {
    const forms = this.onboardingForms()
      .filter(f => f.id !== this.formId())
      .map(f => ({ key: String(f.id), label: f.main_section_label || f.title }));
    return [...SIDENAV_BUILTIN_PARENTS, ...forms];
  });
  parentProcessChoices = computed(() =>
    this.onboardingForms().filter(f => f.id !== this.formId())
  );

  ngOnInit() {
    // Load onboarding forms so they can be picked as a parent section / parent process.
    this.api.listOnboardingForms().subscribe(r => this.onboardingForms.set(r.forms));

    const id = this.route.snapshot.paramMap.get('id');
    if (id && id !== 'new') {
      this.isNew.set(false);
      this.formId.set(+id);
      this.api.getForm(+id).subscribe(res => {
        this.form = {
          ...res.form,
          is_published: !!res.form.is_published,
          sidenav_placement: res.form.sidenav_placement || 'top',
          sidenav_parent_key: res.form.sidenav_parent_key ?? null,
          parent_process_form_id: res.form.parent_process_form_id ?? null,
        };
        this.fields.set(res.fields.map(f => this.toDraft(f)));
      });
    }
  }

  private toDraft(f: FormField): FieldDraft {
    let opts: { value: string; label: string }[] | undefined;
    if (typeof f.options_json === 'string' && f.options_json) {
      try { opts = JSON.parse(f.options_json); } catch {}
    } else if (Array.isArray(f.options_json)) {
      opts = f.options_json;
    }
    return { ...f, _localId: ++_localCounter, _options: opts, is_required: !!f.is_required ? 1 : 0 };
  }

  autoSlug() {
    if (!this.isNew()) return;
    if (!this.form.title) return;
    const slug = (this.form.title || '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').substring(0, 60);
    if (slug && /^[a-z]/.test(slug)) this.form.slug = slug;
  }

  addField() {
    const idx = this.fields().length + 1;
    const f: FieldDraft = {
      _localId: ++_localCounter,
      name: `field_${idx}`,
      label: `Field ${idx}`,
      type: 'text',
      is_required: 0,
      _options: [],
    };
    this.fields.update(arr => [...arr, f]);
  }

  remove(i: number) {
    if (!confirm('Remove this field? If saved, this will drop the column and lose its data.')) return;
    this.fields.update(arr => arr.filter((_, idx) => idx !== i));
  }

  moveUp(i: number) {
    if (i === 0) return;
    this.fields.update(arr => {
      const a = [...arr]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; return a;
    });
  }
  moveDown(i: number) {
    this.fields.update(arr => {
      if (i >= arr.length - 1) return arr;
      const a = [...arr]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; return a;
    });
  }

  onLabel(i: number, label: string) {
    this.fields.update(arr => {
      const a = [...arr];
      a[i] = { ...a[i], label };
      // auto-generate name from label only if name is empty or still matches an autofilled pattern
      if (!a[i].id) {
        const auto = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').substring(0, 60);
        if (auto && /^[a-z]/.test(auto)) a[i].name = auto;
      }
      return a;
    });
  }

  setField(i: number, key: keyof FieldDraft, value: any) {
    this.fields.update(arr => {
      const a = [...arr];
      a[i] = { ...a[i], [key]: value } as FieldDraft;
      return a;
    });
  }

  optionsToText(f: FieldDraft): string {
    return (f._options || []).map(o =>
      o.value === o.label ? o.value : `${o.value}|${o.label}`
    ).join('\n');
  }
  setOptions(i: number, text: string) {
    const opts = text.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
      const [v, lbl] = l.split('|');
      return { value: v.trim(), label: (lbl || v).trim() };
    });
    this.fields.update(arr => {
      const a = [...arr];
      a[i] = { ...a[i], _options: opts };
      return a;
    });
  }

  back() { this.router.navigateByUrl('/admin/forms'); }

  save() {
    this.error.set(null);
    if (!this.form.title || !this.form.slug) { this.error.set('Title and slug are required'); return; }
    if (!/^[a-z][a-z0-9_]{0,59}$/.test(this.form.slug)) {
      this.error.set('Slug must be lowercase letters/digits/underscore, starting with a letter'); return;
    }
    for (const f of this.fields()) {
      if (!/^[a-z][a-z0-9_]{0,59}$/.test(f.name)) {
        this.error.set(`Field name "${f.name}" is invalid`); return;
      }
    }

    const payload = {
      ...this.form,
      is_published: this.form.is_published ? 1 : 0,
      sidenav_placement: this.form.sidenav_placement || 'top',
      sidenav_parent_key: this.form.sidenav_placement === 'child' ? (this.form.sidenav_parent_key ?? null) : null,
      parent_process_form_id: this.form.parent_process_form_id ?? null,
      fields: this.fields().map(f => ({
        id: f.id,
        name: f.name,
        label: f.label,
        type: f.type,
        is_required: f.is_required ? 1 : 0,
        placeholder: f.placeholder || null,
        help_text: f.help_text || null,
        options_json: HAS_OPTIONS.includes(f.type) ? (f._options || []) : null,
      })),
    } as any;

    this.saving.set(true);
    const handler = {
      next: () => { this.saving.set(false); this.router.navigateByUrl('/admin/forms'); },
      error: (e: any) => { this.saving.set(false); this.error.set(e?.error?.error || 'Save failed'); },
    };
    if (this.isNew()) this.api.createForm(payload).subscribe(handler);
    else this.api.updateForm(this.formId()!, payload).subscribe(handler);
  }
}
