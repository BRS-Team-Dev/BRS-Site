import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import {
  FIELD_TYPES, FieldType, FormDef, FormField, FormSection,
  HAS_OPTIONS, OnboardingFormPayload, TaskTeam,
} from '../../core/models';
import { SIDENAV_BUILTIN_PARENTS } from '../../core/sidenav-config';

interface FieldDraft extends FormField {
  _localId?: number;
  _options?: { value: string; label: string }[];
}
interface SectionDraft {
  id?: number;
  _localId: number;
  slug: string;
  title: string;
  description?: string | null;
  sort_order?: number;
  fields: FieldDraft[];
}

let _localCounter = 1;

@Component({
  selector: 'app-onboarding-builder',
  imports: [FormsModule],
  template: `
    <div class="toolbar">
      <button class="ghost" (click)="back()">← Back</button>
      <h1>{{ isNew() ? 'New onboarding template' : 'Edit onboarding template' }}</h1>
      <span class="spacer"></span>
      @if (saving()) { <span class="muted small">Saving…</span> }
      @if (error()) { <span class="error-msg">{{ error() }}</span> }
      <button class="primary" (click)="save()" [disabled]="saving()">Save</button>
    </div>

    <div class="layout">
      <section class="meta card">
        <h2>Template details</h2>

        <label>Title</label>
        <input [(ngModel)]="form.title" (ngModelChange)="autoSlug()" name="title" />

        <label>Slug (used in URL and DB table name)</label>
        <input [(ngModel)]="form.slug" name="slug" />
        <div class="muted small">Lowercase letters, digits, underscores. Starts with a letter.</div>

        <label>Intro / write-up (HTML allowed)</label>
        <textarea [(ngModel)]="form.intro_html" name="intro_html" rows="3"></textarea>

        <label>Completion message (shown after final submit)</label>
        <textarea [(ngModel)]="form.thank_you_message" name="thank_you_message" rows="2"></textarea>

        <div class="checkbox-row">
          <input type="checkbox" id="pub" [(ngModel)]="form.is_published" name="is_published" />
          <label for="pub">Published (clients can be invited)</label>
        </div>

        <hr />
        <h2>Main section (qualified clients)</h2>
        <div class="muted small" style="margin-bottom: 8px;">
          Once a client is qualified they're moved out of onboarding into a "main section" in the sidenav.
        </div>

        <label>Section label (defaults to template title)</label>
        <input [(ngModel)]="form.main_section_label" name="main_section_label" [placeholder]="form.title || ''" />

        <label>Sidenav placement</label>
        <select [(ngModel)]="form.sidenav_placement" name="sidenav_placement">
          <option value="top">Top-level item</option>
          <option value="child">Child of another section</option>
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
        <h2>Independent section</h2>
        <div class="checkbox-row">
          <input type="checkbox" id="rootSec"
            [(ngModel)]="form.show_in_sidenav_root" name="show_in_sidenav_root" />
          <label for="rootSec">Show this template as its own top-level sidenav section</label>
        </div>
        <div class="muted small">
          Adds a standalone "{{ form.title || 'Section' }}" entry to the sidenav (in addition to the Onboarding dropdown).
        </div>

        <hr />
        <h2>Parent process</h2>
        <div class="muted small" style="margin-bottom: 8px;">
          Optionally link this onboarding to another process. For example, a Service onboarding can declare a Client onboarding as its parent — useful when records here belong to / follow on from records there.
        </div>
        <select [(ngModel)]="form.parent_process_form_id" name="parent_process_form_id">
          <option [ngValue]="null">— none (standalone process) —</option>
          @for (p of parentProcessChoices(); track p.id) {
            <option [ngValue]="p.id">{{ p.title }}</option>
          }
        </select>

        <hr />
        <h2>Task team</h2>
        <div class="muted small" style="margin-bottom: 8px;">
          When set, qualifying a client on this onboarding auto-creates a
          project in the Tasks section assigned to the chosen team. The
          project's status drives the badge on the client's Services tab.
        </div>
        <select [(ngModel)]="form.team_id" name="team_id">
          <option [ngValue]="null">— none (no auto-project) —</option>
          @for (t of teams(); track t.id) {
            <option [ngValue]="t.id">{{ t.name }}</option>
          }
        </select>

        <hr />
        <h2>Pricing</h2>
        <div class="checkbox-row">
          <input type="checkbox" id="hasPrice"
            [(ngModel)]="form.has_price" name="has_price" />
          <label for="hasPrice">This onboarding has a price</label>
        </div>
        @if (form.has_price) {
          <label>Price</label>
          <input type="number" min="0" step="0.01"
            [(ngModel)]="form.price" name="price" placeholder="0.00" />

          <label>Payment type</label>
          <select [(ngModel)]="form.payment_type" name="payment_type">
            <option value="one_off">One-off</option>
            <option value="recurring">Recurring</option>
          </select>

          @if (form.payment_type === 'recurring') {
            <label>Repeat duration</label>
            <select [(ngModel)]="form.repeat_duration" name="repeat_duration">
              <option [ngValue]="null">— pick a cadence —</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="yearly">Yearly</option>
            </select>

            <div class="checkbox-row" style="margin-top: 12px;">
              <input type="checkbox" id="indefinite"
                [(ngModel)]="form.is_indefinite" name="is_indefinite" />
              <label for="indefinite">Indefinite (no fixed contract end)</label>
            </div>

            @if (!form.is_indefinite) {
              <label>Contract length (months)</label>
              <input type="number" min="1" step="1"
                [(ngModel)]="form.contract_length_months" name="contract_length_months"
                placeholder="12" />
            }
          }
        }

        <hr />
        <h2>Email — admin notification</h2>
        <label>Recipient email (notify on completion)</label>
        <input type="email" [(ngModel)]="form.notify_email" name="notify_email" placeholder="you@example.com" />
        <label>Subject</label>
        <input [(ngModel)]="form.notify_subject" name="notify_subject" placeholder="Onboarding complete: {{ form.title }}" />
        <label>HTML body — use {{ '{{ field_name }}' }} tokens</label>
        <textarea [(ngModel)]="form.notify_template" name="notify_template" rows="4"></textarea>
      </section>

      <section class="sections-pane">
        <div class="row" style="margin-bottom:12px;">
          <h2 style="margin:0;flex:1;">Sections</h2>
          <button class="primary" (click)="addSection()">+ Add section</button>
        </div>

        @if (sections().length === 0) {
          <div class="card empty-card">
            <p class="muted">No sections yet. Add a section to start grouping fields.</p>
            <button class="primary" (click)="addSection()">+ Add section</button>
          </div>
        }

        @for (s of sections(); track s._localId; let si = $index) {
          <div class="card section-card" [class.collapsed]="expandedSection() !== si">
            <div class="section-head row">
              <button class="section-toggle" (click)="toggleSection(si)">
                <span class="caret" [class.open]="expandedSection() === si">›</span>
                <strong>{{ s.title || '(untitled section)' }}</strong>
                <span class="muted small">{{ s.fields.length }} field{{ s.fields.length === 1 ? '' : 's' }}</span>
              </button>
              <code>{{ s.slug }}</code>
              <button class="ghost" (click)="moveSectionUp(si); $event.stopPropagation()" [disabled]="si === 0">↑</button>
              <button class="ghost" (click)="moveSectionDown(si); $event.stopPropagation()" [disabled]="si === sections().length - 1">↓</button>
              <button class="danger" (click)="removeSection(si); $event.stopPropagation()">Remove</button>
            </div>

          @if (expandedSection() === si) {
            <div class="section-meta">
              <div>
                <label>Title</label>
                <input [ngModel]="s.title" (ngModelChange)="onSectionTitle(si, $event)" name="sec_title_{{si}}" />
              </div>
              <div>
                <label>Slug</label>
                <input [ngModel]="s.slug" (ngModelChange)="setSection(si, 'slug', $event)" name="sec_slug_{{si}}" />
              </div>
              <div style="grid-column: 1 / -1;">
                <label>Description</label>
                <textarea [ngModel]="s.description" (ngModelChange)="setSection(si, 'description', $event)" name="sec_desc_{{si}}" rows="2"></textarea>
              </div>
            </div>

            <div class="row" style="margin: 16px 0 8px;">
              <h3 style="margin:0;flex:1;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted);">Fields</h3>
              <button class="ghost" (click)="addField(si)">+ Add field</button>
            </div>

            @if (s.fields.length === 0) {
              <p class="muted small">No fields yet.</p>
            }

            @for (f of s.fields; track f._localId; let fi = $index) {
              <div class="field">
                <div class="field-head row">
                  <strong>{{ f.label || '(unnamed)' }}</strong>
                  <code>{{ f.name }}</code>
                  <span class="badge">{{ f.type }}</span>
                  <span class="spacer"></span>
                  <button class="ghost" (click)="moveFieldUp(si, fi)" [disabled]="fi === 0">↑</button>
                  <button class="ghost" (click)="moveFieldDown(si, fi)" [disabled]="fi === s.fields.length - 1">↓</button>
                  <button class="danger" (click)="removeField(si, fi)">Remove</button>
                </div>
                <div class="field-body">
                  <div>
                    <label>Label</label>
                    <input [ngModel]="f.label" (ngModelChange)="onFieldLabel(si, fi, $event)" name="lbl_{{si}}_{{fi}}" />
                  </div>
                  <div>
                    <label>Field name (column)</label>
                    <input [ngModel]="f.name" (ngModelChange)="setField(si, fi, 'name', $event)" name="nm_{{si}}_{{fi}}" />
                  </div>
                  <div>
                    <label>Type</label>
                    <select [ngModel]="f.type" (ngModelChange)="setField(si, fi, 'type', $event)" name="ty_{{si}}_{{fi}}">
                      @for (t of fieldTypes; track t.value) {
                        <option [value]="t.value">{{ t.label }}</option>
                      }
                    </select>
                  </div>
                  <div>
                    <label>Placeholder</label>
                    <input [ngModel]="f.placeholder" (ngModelChange)="setField(si, fi, 'placeholder', $event)" name="ph_{{si}}_{{fi}}" />
                  </div>
                  <div style="grid-column: 1 / -1;">
                    <label>Help text</label>
                    <input [ngModel]="f.help_text" (ngModelChange)="setField(si, fi, 'help_text', $event)" name="hp_{{si}}_{{fi}}" />
                  </div>

                  @if (hasOptions(f.type)) {
                    <div style="grid-column: 1 / -1;">
                      <label>Options (one per line, optionally "value|label")</label>
                      <textarea
                        [ngModel]="optionsToText(f)"
                        (ngModelChange)="setOptions(si, fi, $event)"
                        name="op_{{si}}_{{fi}}"
                        rows="3"
                        placeholder="red&#10;green&#10;blue"></textarea>
                    </div>
                  }

                  <div class="checkbox-row" style="grid-column: 1 / -1;">
                    <input
                      type="checkbox"
                      id="rq_{{si}}_{{fi}}"
                      [ngModel]="!!f.is_required"
                      (ngModelChange)="setField(si, fi, 'is_required', $event ? 1 : 0)"
                      name="rq_{{si}}_{{fi}}" />
                    <label for="rq_{{si}}_{{fi}}">Required</label>
                  </div>
                </div>
              </div>
            }

            @if (s.fields.length > 0) {
              <div class="row" style="margin-top: 12px;">
                <span class="spacer"></span>
                <button class="ghost" (click)="addField(si)">+ Add field</button>
              </div>
            }
          }
          </div>
        }
      </section>
    </div>
  `,
  styles: [`
    .layout { display: grid; grid-template-columns: 380px 1fr; gap: 20px; padding: 20px; align-items: start; }
    .card h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); margin: 0 0 12px 0; font-weight: 600; }
    .meta label { margin-top: 12px; }
    /* Zero out the .meta label margin-top for checkbox-row labels so the
       label aligns with the checkbox instead of sitting 12px lower. */
    .meta .checkbox-row label { margin-top: 0; }
    .meta hr { border: none; border-top: 1px solid var(--line); margin: 20px 0 16px 0; }

    .sections-pane { display: flex; flex-direction: column; gap: 16px; }
    .section-card { padding: 20px; transition: padding 0.15s; }
    .section-card.collapsed { padding: 14px 20px; }
    .section-card.collapsed .section-head { margin-bottom: 0; padding-bottom: 0; border-bottom: none; }
    .section-head { gap: 10px; flex-wrap: wrap; margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid var(--line); }
    .section-toggle {
      display: inline-flex; align-items: center; gap: 8px;
      flex: 1; min-width: 0;
      background: transparent; border: none; padding: 4px 0;
      color: var(--fg); cursor: pointer; text-align: left;
    }
    .section-toggle:hover { color: var(--primary); border-color: transparent; background: transparent; }
    .section-toggle strong { font-size: 14px; }
    .section-toggle .caret { display: inline-block; transition: transform 0.15s; opacity: 0.7; }
    .section-toggle .caret.open { transform: rotate(90deg); }
    .section-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .empty-card { padding: 32px; text-align: center; }
    .empty-card p { margin: 0 0 12px; }

    .field { border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 12px; margin-top: 12px; background: var(--bg); }
    .field-head { gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
    .field-head code { font-size: 11px; }
    .field-body { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

    @media (max-width: 1100px) { .layout { grid-template-columns: 1fr; } }
  `],
})
export class OnboardingBuilder {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  fieldTypes = FIELD_TYPES;
  hasOptions = (t: FieldType) => HAS_OPTIONS.includes(t);

  isNew = signal(true);
  formId = signal<number | null>(null);
  sections = signal<SectionDraft[]>([]);
  expandedSection = signal<number | null>(0);
  saving = signal(false);
  error = signal<string | null>(null);
  allForms = signal<FormDef[]>([]);
  teams = signal<TaskTeam[]>([]);
  parentChoices = computed<{ key: string; label: string }[]>(() => {
    const forms = this.allForms()
      .filter(f => f.id !== this.formId())
      .map(f => ({ key: String(f.id), label: f.main_section_label || f.title }));
    return [...SIDENAV_BUILTIN_PARENTS, ...forms];
  });
  parentProcessChoices = computed(() =>
    this.allForms().filter(f => f.id !== this.formId())
  );

  toggleSection(si: number) {
    this.expandedSection.set(this.expandedSection() === si ? null : si);
  }

  form: Partial<FormDef> = {
    title: '', slug: '', submit_label: 'Submit',
    is_published: false, thank_you_message: '',
    main_section_label: '', sidenav_placement: 'top', sidenav_parent_key: null,
    parent_process_form_id: null, show_in_sidenav_root: false,
    team_id: null,
    has_price: false, price: null,
    payment_type: 'one_off', repeat_duration: null,
    contract_length_months: null, is_indefinite: false,
  };

  ngOnInit() {
    // Load every onboarding form so the builder can offer parent-section choices.
    this.api.listOnboardingForms().subscribe(r => this.allForms.set(r.forms));
    this.api.listTaskTeams().subscribe(r => this.teams.set(r.teams));

    const id = this.route.snapshot.paramMap.get('id');
    if (id && id !== 'new') {
      this.isNew.set(false);
      this.formId.set(+id);
      this.api.getOnboardingForm(+id).subscribe(res => {
        this.form = {
          ...res.form,
          is_published: !!res.form.is_published,
          sidenav_placement: res.form.sidenav_placement || 'top',
          sidenav_parent_key: res.form.sidenav_parent_key ?? null,
          main_section_label: res.form.main_section_label ?? '',
          parent_process_form_id: res.form.parent_process_form_id ?? null,
          team_id: res.form.team_id !== null && res.form.team_id !== undefined
            ? Number(res.form.team_id) : null,
          show_in_sidenav_root: !!res.form.show_in_sidenav_root,
          has_price: !!res.form.has_price,
          // Decimal columns come back as strings from PHP/PDO — coerce so the
          // numeric input binding round-trips cleanly.
          price: res.form.price !== null && res.form.price !== undefined ? Number(res.form.price) : null,
          payment_type: res.form.payment_type === 'recurring' ? 'recurring' : 'one_off',
          repeat_duration: res.form.repeat_duration ?? null,
          contract_length_months: res.form.contract_length_months !== null && res.form.contract_length_months !== undefined
            ? Number(res.form.contract_length_months) : null,
          is_indefinite: !!res.form.is_indefinite,
        };
        this.sections.set(res.sections.map(s => this.toSectionDraft(s)));
        this.expandedSection.set(res.sections.length > 0 ? 0 : null);
      });
    } else {
      this.expandedSection.set(null); // nothing to expand until first add
    }
  }

  private toSectionDraft(s: FormSection): SectionDraft {
    return {
      id: s.id,
      _localId: ++_localCounter,
      slug: s.slug,
      title: s.title,
      description: s.description ?? '',
      sort_order: s.sort_order,
      fields: (s.fields || []).map(f => this.toFieldDraft(f)),
    };
  }
  private toFieldDraft(f: FormField): FieldDraft {
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

  // Section CRUD
  addSection() {
    const idx = this.sections().length + 1;
    this.sections.update(arr => [...arr, {
      _localId: ++_localCounter,
      slug: `section_${idx}`,
      title: `Section ${idx}`,
      description: '',
      fields: [],
    }]);
    this.expandedSection.set(this.sections().length - 1); // expand the newly added section
  }
  removeSection(si: number) {
    if (!confirm('Remove this section? All its fields will also be removed (and their columns dropped if saved).')) return;
    this.sections.update(arr => arr.filter((_, i) => i !== si));
    const expanded = this.expandedSection();
    if (expanded === si) this.expandedSection.set(null);
    else if (expanded !== null && expanded > si) this.expandedSection.set(expanded - 1);
  }
  moveSectionUp(si: number) {
    if (si === 0) return;
    this.sections.update(arr => { const a = [...arr]; [a[si - 1], a[si]] = [a[si], a[si - 1]]; return a; });
  }
  moveSectionDown(si: number) {
    this.sections.update(arr => {
      if (si >= arr.length - 1) return arr;
      const a = [...arr]; [a[si + 1], a[si]] = [a[si], a[si + 1]]; return a;
    });
  }
  setSection(si: number, key: keyof SectionDraft, value: any) {
    this.sections.update(arr => {
      const a = [...arr]; a[si] = { ...a[si], [key]: value } as SectionDraft; return a;
    });
  }
  onSectionTitle(si: number, title: string) {
    this.sections.update(arr => {
      const a = [...arr]; const cur = { ...a[si], title };
      if (!cur.id) {
        const auto = title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').substring(0, 60);
        if (auto && /^[a-z]/.test(auto)) cur.slug = auto;
      }
      a[si] = cur; return a;
    });
  }

  // Field CRUD inside a section
  addField(si: number) {
    this.sections.update(arr => {
      const a = [...arr]; const sec = a[si];
      const idx = sec.fields.length + 1;
      const f: FieldDraft = {
        _localId: ++_localCounter,
        name: `${sec.slug}_field_${idx}`,
        label: `Field ${idx}`,
        type: 'text',
        is_required: 0,
        _options: [],
      };
      a[si] = { ...sec, fields: [...sec.fields, f] };
      return a;
    });
  }
  removeField(si: number, fi: number) {
    if (!confirm('Remove this field? If saved, this will drop the column and lose its data.')) return;
    this.sections.update(arr => {
      const a = [...arr]; a[si] = { ...a[si], fields: a[si].fields.filter((_, i) => i !== fi) }; return a;
    });
  }
  moveFieldUp(si: number, fi: number) {
    if (fi === 0) return;
    this.sections.update(arr => {
      const a = [...arr]; const f = [...a[si].fields];
      [f[fi - 1], f[fi]] = [f[fi], f[fi - 1]];
      a[si] = { ...a[si], fields: f }; return a;
    });
  }
  moveFieldDown(si: number, fi: number) {
    this.sections.update(arr => {
      const a = [...arr]; const f = [...a[si].fields];
      if (fi >= f.length - 1) return arr;
      [f[fi + 1], f[fi]] = [f[fi], f[fi + 1]];
      a[si] = { ...a[si], fields: f }; return a;
    });
  }
  setField(si: number, fi: number, key: keyof FieldDraft, value: any) {
    this.sections.update(arr => {
      const a = [...arr]; const f = [...a[si].fields];
      f[fi] = { ...f[fi], [key]: value } as FieldDraft;
      a[si] = { ...a[si], fields: f }; return a;
    });
  }
  onFieldLabel(si: number, fi: number, label: string) {
    this.sections.update(arr => {
      const a = [...arr]; const f = [...a[si].fields];
      const cur = { ...f[fi], label };
      if (!cur.id) {
        const auto = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').substring(0, 60);
        if (auto && /^[a-z]/.test(auto)) cur.name = auto;
      }
      f[fi] = cur; a[si] = { ...a[si], fields: f }; return a;
    });
  }

  optionsToText(f: FieldDraft): string {
    return (f._options || []).map(o => o.value === o.label ? o.value : `${o.value}|${o.label}`).join('\n');
  }
  setOptions(si: number, fi: number, text: string) {
    const opts = text.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
      const [v, lbl] = l.split('|'); return { value: v.trim(), label: (lbl || v).trim() };
    });
    this.setField(si, fi, '_options' as any, opts);
  }

  back() { this.router.navigateByUrl('/admin/onboarding'); }

  save() {
    this.error.set(null);
    if (!this.form.title || !this.form.slug) { this.error.set('Title and slug are required'); return; }
    if (!/^[a-z][a-z0-9_]{0,59}$/.test(this.form.slug)) {
      this.error.set('Slug must be lowercase letters/digits/underscore, starting with a letter'); return;
    }
    if (this.sections().length === 0) { this.error.set('Add at least one section'); return; }

    const seenNames = new Set<string>();
    for (const s of this.sections()) {
      if (!/^[a-z][a-z0-9_]{0,59}$/.test(s.slug)) {
        this.error.set(`Section slug "${s.slug}" is invalid`); return;
      }
      for (const f of s.fields) {
        if (!/^[a-z][a-z0-9_]{0,59}$/.test(f.name)) {
          this.error.set(`Field name "${f.name}" is invalid`); return;
        }
        if (seenNames.has(f.name)) {
          this.error.set(`Duplicate field name "${f.name}" — names must be unique across all sections`); return;
        }
        seenNames.add(f.name);
      }
    }

    const payload: OnboardingFormPayload = {
      ...this.form,
      is_published: this.form.is_published ? 1 : 0,
      sidenav_placement: this.form.sidenav_placement || 'top',
      sidenav_parent_key: this.form.sidenav_placement === 'child' ? (this.form.sidenav_parent_key ?? null) : null,
      main_section_label: this.form.main_section_label || null,
      parent_process_form_id: this.form.parent_process_form_id ?? null,
      team_id: this.form.team_id ?? null,
      show_in_sidenav_root: this.form.show_in_sidenav_root ? 1 : 0,
      has_price: this.form.has_price ? 1 : 0,
      price: this.form.has_price && this.form.price != null && this.form.price !== ''
        ? Number(this.form.price) : null,
      payment_type: this.form.has_price ? (this.form.payment_type || 'one_off') : 'one_off',
      repeat_duration: this.form.has_price && this.form.payment_type === 'recurring'
        ? (this.form.repeat_duration || null) : null,
      contract_length_months: this.form.has_price && this.form.payment_type === 'recurring' && !this.form.is_indefinite
          && this.form.contract_length_months != null && (this.form.contract_length_months as any) !== ''
        ? Number(this.form.contract_length_months) : null,
      is_indefinite: this.form.has_price && this.form.payment_type === 'recurring' && this.form.is_indefinite ? 1 : 0,
      sections: this.sections().map((s, sIdx) => ({
        id: s.id,
        slug: s.slug,
        title: s.title,
        description: s.description || null,
        sort_order: sIdx,
        fields: s.fields.map(f => ({
          id: f.id,
          name: f.name,
          label: f.label,
          type: f.type,
          is_required: f.is_required ? 1 : 0,
          placeholder: f.placeholder || null,
          help_text: f.help_text || null,
          options_json: HAS_OPTIONS.includes(f.type) ? (f._options || []) : null,
        })),
      })),
    };

    this.saving.set(true);
    const handler = {
      next: () => { this.saving.set(false); this.router.navigateByUrl('/admin/onboarding'); },
      error: (e: any) => { this.saving.set(false); this.error.set(e?.error?.error || 'Save failed'); },
    };
    if (this.isNew()) this.api.createOnboardingForm(payload).subscribe(handler);
    else this.api.updateOnboardingForm(this.formId()!, payload).subscribe(handler);
  }
}
