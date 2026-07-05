import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { environment } from '@env/environment';
import { Api } from '../../core/api';
import { DialogService } from '../../core/dialog';
import {
  FIELD_TYPES, FieldType, FormDef, FormField, FormSection,
  HAS_OPTIONS, OnboardingFormPayload, ServiceOffering, TaskTeam,
} from '../../core/models';
import { SIDENAV_BUILTIN_PARENTS } from '../../core/sidenav-config';
import { AttachScopeValue, FormAttachPicker } from '../../shared/form-attach-picker';
import { FormInvites } from '../../shared/form-invites';

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
  imports: [FormsModule, FormAttachPicker, FormInvites],
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

        <!-- ── Open link ──────────────────────────────────────────
             Token-less public URL. When on, anyone with the URL can
             fill this form; on submit the backend auto-provisions a
             client or lead (see public_target). Off by default so
             existing forms stay invite-only. -->
        <div class="checkbox-row">
          <input type="checkbox" id="pub_open"
                 [(ngModel)]="form.is_public_open" name="is_public_open"
                 [disabled]="!form.is_published" />
          <label for="pub_open">
            Open link (anyone with the URL can submit)
            @if (!form.is_published) {
              <span class="muted small">— publish the form first</span>
            }
          </label>
        </div>

        @if (form.is_public_open && form.is_published) {
          <div style="margin: 10px 0 4px 0;">
            <label>On public submit, create</label>
            <select [(ngModel)]="form.public_target" name="public_target">
              <option value="client">Client + attach linked service</option>
              <option value="lead">Lead</option>
              <option value="none">Nothing (store the submission only)</option>
            </select>
          </div>

          <label style="margin-top: 12px;">Redirect after submit (optional)</label>
          <input type="text" [(ngModel)]="form.post_submit_url" name="post_submit_url"
                 placeholder="/cc/login  or  https://example.com/booking" />
          <p class="muted small">
            Send the submitter here after a brief "Thanks" screen. Leave
            blank to stay on the confirmation card. Absolute (https://…)
            or root-relative (starts with <code>/</code>).
          </p>

          <label>Public URL</label>
          <div class="url-row">
            <input type="text" readonly [value]="publicOpenUrl()" (focus)="$any($event.target).select()" />
            <button type="button" class="ghost" (click)="copyPublicUrl()">
              {{ urlCopied() ? 'Copied ✓' : 'Copy' }}
            </button>
            <a class="ghost" [href]="publicOpenUrl()" target="_blank" rel="noopener">Open ↗</a>
          </div>
          <p class="muted small">
            Share this URL anywhere — website, email, socials. Every submit
            @switch (form.public_target) {
              @case ('client') { creates or updates a client and attaches the linked service. }
              @case ('lead')   { creates a new lead in the CRM. }
              @default         { is stored but no CRM record is created. }
            }
          </p>
        }

        <hr />
        <h2>Main section (qualified clients)</h2>
        <div class="muted small" style="margin-bottom: 8px;">
          Once a client is qualified they're moved out of onboarding into a "main section" in the sidenav.
        </div>

        <label>Section label (defaults to template title)</label>
        <input [(ngModel)]="form.main_section_label" name="main_section_label" [placeholder]="form.title || ''" />

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
        <h2>Attach to</h2>
        <p class="muted small no-notes">
          Determines who sees this onboarding as part of their default
          onboarding tab. Individual invites (below) stack on top of
          whichever scope you pick. Picking a service also inherits its
          pricing / cadence, same as before.
        </p>
        <app-form-attach-picker [value]="attachValue" (valueChange)="onAttachChange($event)" />
        @if (selectedService(); as svc) {
          <div class="service-preview muted small">
            <strong>{{ svc.name }}</strong>
            @if (svc.price !== null && svc.price !== '' && svc.price !== undefined) {
              · {{ servicePriceSummary(svc) }}
            }
            @if (svc.description) { <div class="desc">{{ svc.description }}</div> }
          </div>
        }

        @if (!isNew() && formId()) {
          <hr />
          <h2>Individual invitations</h2>
          <p class="muted small">
            On top of any broadcast scope above, invite specific clients
            or leads with a tokenised URL. Same mechanism as before —
            just re-shared here so both builders behave the same way.
          </p>
          <app-form-invites [formId]="formId()!" [formSlug]="form.slug || ''" />
        }

        <!-- Allow-multiple toggle. When a service is linked the
             service's flag is the source of truth — the input is
             read-only and shows the inherited value. -->
        <div class="allow-multiple-row">
          <label class="check">
            <input type="checkbox"
                   [checked]="effectiveAllowMultiple()"
                   [disabled]="!!selectedService()"
                   (change)="toggleAllowMultiple($any($event.target).checked)" />
            <span>Allow multiple submissions per client</span>
          </label>
          @if (selectedService(); as svc) {
            <p class="muted small inh-note">
              Inherited from <strong>{{ svc.name }}</strong>
              ({{ svc.allow_multiple ? 'allowed' : 'not allowed' }}).
              Change the toggle on the service to override.
            </p>
          } @else {
            <p class="muted small inh-note">
              No service linked — this flag controls the form on its
              own. Subscription-style flows usually leave it off.
            </p>
          }
        </div>

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
    /* Public URL row — readonly input + Copy + Open buttons. */
    .url-row { display: flex; gap: 6px; align-items: center; }
    .url-row input { flex: 1; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 12px; }
    .url-row .ghost { padding: 6px 12px; background: transparent; color: var(--fg); border: 1px solid var(--line); border-radius: var(--radius-sm); cursor: pointer; font-size: 12px; text-decoration: none; white-space: nowrap; }
    .url-row .ghost:hover { border-color: var(--primary); color: var(--primary); }

    /* Confirmation chip showing the resolved service after picking
       one — gives admins visual feedback that pricing is now coming
       from the catalogue, not the legacy form-level fields. */
    .service-preview {
      margin-top: 10px; padding: 10px 12px;
      background: var(--bg-3); border: 1px solid var(--line);
      border-radius: var(--radius-sm);
    }
    .service-preview .desc { margin-top: 4px; opacity: 0.8; }

    /* Allow-multiple toggle + its inheritance note. Sits right below
       the service preview so the relationship reads naturally. */
    .allow-multiple-row { margin-top: 14px; }
    .allow-multiple-row .check {
      display: inline-flex; align-items: center; gap: 8px; cursor: pointer;
      text-transform: none; letter-spacing: normal;
      font-size: 14px; font-weight: 500; color: var(--fg);
      white-space: nowrap;
    }
    .allow-multiple-row .check span { white-space: nowrap; }
    .allow-multiple-row .check input:disabled { cursor: not-allowed; }
    .allow-multiple-row .inh-note { margin: 6px 0 0; line-height: 1.4; }

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
  private dialog = inject(DialogService);
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
    service_offering_id: null,
    broadcast_to_all_clients: 0,
    broadcast_to_all_leads: 0,
    is_public_open: 0,
    public_target: 'client',
    post_submit_url: null,
    has_price: false, price: null,
    payment_type: 'one_off', repeat_duration: null,
    contract_length_months: null, is_indefinite: false,
  };

  /** Flips true briefly after Copy so the button reads "Copied ✓". */
  urlCopied = signal(false);

  /** Catalogue services available to link this onboarding to. Fetched
   *  once on init; the picker just renders names + a price summary. */
  services = signal<ServiceOffering[]>([]);

  /** Currently-linked service, resolved off the picker value. NOT a
   *  computed — the picker writes to `this.form.service_offering_id`
   *  on a plain object, which doesn't dirty any signal. A computed
   *  would memoize the initial value forever. A plain method is
   *  cheap (single Array.find) and re-runs on every CD cycle. */
  selectedService(): ServiceOffering | null {
    const id = this.form.service_offering_id;
    if (id === null || id === undefined) return null;
    return this.services().find(s => s.id === Number(id)) ?? null;
  }

  /** Legacy service-picker hook. Kept because save() may reference it
   *  indirectly (the preview still calls `selectedService`); the shared
   *  attach picker now drives service_offering_id via `onAttachChange`. */
  onServiceChange(id: number | null): void {
    this.form.service_offering_id = id;
  }

  /** Canonical value bound to <app-form-attach-picker>. Keeps the three
   *  underlying flags on `form` in sync via `onAttachChange`. */
  attachValue: AttachScopeValue = {
    scope: 'none',
    broadcast_to_all_clients: 0,
    broadcast_to_all_leads: 0,
    service_offering_id: null,
  };

  onAttachChange(v: AttachScopeValue) {
    this.attachValue = v;
    this.form.broadcast_to_all_clients = v.broadcast_to_all_clients;
    this.form.broadcast_to_all_leads   = v.broadcast_to_all_leads;
    this.form.service_offering_id      = v.service_offering_id;
  }

  /** Reduce the three flags on a loaded form to the picker's scope. */
  private hydrateAttach() {
    const bc = !!this.form.broadcast_to_all_clients;
    const bl = !!this.form.broadcast_to_all_leads;
    const sid = this.form.service_offering_id ?? null;
    this.attachValue = {
      scope: bc ? 'all_clients' : bl ? 'all_leads' : sid ? 'service' : 'none',
      broadcast_to_all_clients: bc ? 1 : 0,
      broadcast_to_all_leads:   bl ? 1 : 0,
      service_offering_id: sid,
    };
  }

  /** Resolved allow_multiple value shown on the toggle. When a
   *  service is linked the service's flag wins; otherwise the form's
   *  own flag is the source of truth. */
  effectiveAllowMultiple(): boolean {
    const svc = this.selectedService();
    if (svc) return !!svc.allow_multiple;
    return !!this.form.allow_multiple;
  }

  /** Toggle only mutates the form-level flag — when a service is
   *  linked the input is disabled so this never fires for that case. */
  toggleAllowMultiple(checked: boolean): void {
    this.form.allow_multiple = checked ? 1 : 0;
  }

  /** "£500 · one-off" / "£99/month · 12m contract" / "£99/month · indefinite". */
  servicePriceSummary(s: ServiceOffering): string {
    const num = Number(s.price);
    if (!Number.isFinite(num) || num <= 0) return 'no price';
    const cur = s.currency || '£';
    const money = `${cur}${num.toFixed(2).replace(/\.00$/, '')}`;
    if (s.payment_type === 'recurring') {
      const cadence = s.repeat_duration || 'period';
      return `${money}/${cadence.replace(/ly$/, '')}`;
    }
    return `${money} · one-off`;
  }

  ngOnInit() {
    // Load every onboarding form so the builder can offer parent-section choices.
    this.api.listOnboardingForms().subscribe(r => this.allForms.set(r.forms));
    this.api.listTaskTeams().subscribe(r => this.teams.set(r.teams));
    this.api.listServiceOfferings().subscribe(r => this.services.set(r.services));

    const id = this.route.snapshot.paramMap.get('id');
    if (id && id !== 'new') {
      this.isNew.set(false);
      this.formId.set(+id);
      this.api.getOnboardingForm(+id).subscribe(res => {
        this.form = {
          ...res.form,
          is_published: !!res.form.is_published,
          allow_multiple: !!res.form.allow_multiple,
          sidenav_placement: res.form.sidenav_placement || 'top',
          sidenav_parent_key: res.form.sidenav_parent_key ?? null,
          main_section_label: res.form.main_section_label ?? '',
          parent_process_form_id: res.form.parent_process_form_id ?? null,
          team_id: res.form.team_id !== null && res.form.team_id !== undefined
            ? Number(res.form.team_id) : null,
          service_offering_id: res.form.service_offering_id !== null && res.form.service_offering_id !== undefined
            ? Number(res.form.service_offering_id) : null,
          broadcast_to_all_clients: res.form.broadcast_to_all_clients ? 1 : 0,
          broadcast_to_all_leads:   res.form.broadcast_to_all_leads   ? 1 : 0,
          is_public_open: !!res.form.is_public_open,
          public_target:  (res.form.public_target as any) || 'client',
          post_submit_url: res.form.post_submit_url ?? null,
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
        this.hydrateAttach();
      });
    } else {
      this.expandedSection.set(null); // nothing to expand until first add
      // Pre-link to a service when the URL carries ?service=<id> — the
      // service edit modal links here with that param when an admin
      // clicks "+ Create onboarding for this service".
      const presetService = this.route.snapshot.queryParamMap.get('service');
      if (presetService) {
        const sid = Number(presetService);
        if (Number.isFinite(sid) && sid > 0) {
          this.form.service_offering_id = sid;
        }
      }
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
  async removeSection(si: number) {
    const ok = await this.dialog.confirm('Remove this section? All its fields will also be removed (and their columns dropped if saved).', { title: 'Remove section', confirmLabel: 'Remove', variant: 'danger' });
    if (!ok) return;
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
  async removeField(si: number, fi: number) {
    const ok = await this.dialog.confirm('Remove this field? If saved, this will drop the column and lose its data.', { title: 'Remove field', confirmLabel: 'Remove', variant: 'danger' });
    if (!ok) return;
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

  /** Fully-qualified public URL for the open-link flow. Built from the
   *  configured basePath so it works whether the frontend is served on
   *  localhost:4200, /cc in prod, or /builtrightstudio/cms locally. */
  publicOpenUrl(): string {
    const slug = (this.form.slug || '').trim();
    if (!slug) return '';
    return `${window.location.origin}${environment.basePath}/onboarding/open/${slug}`;
  }

  async copyPublicUrl() {
    const url = this.publicOpenUrl();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      this.urlCopied.set(true);
      setTimeout(() => this.urlCopied.set(false), 2000);
    } catch {
      this.dialog.alert('Could not copy to clipboard — select and copy manually.', { title: 'Copy failed', variant: 'danger' });
    }
  }

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
      allow_multiple: this.form.allow_multiple ? 1 : 0,
      // Sidenav placement is no longer user-editable — everything
      // sits under Onboarding > Multipart forms automatically.
      sidenav_placement: 'top',
      sidenav_parent_key: null,
      main_section_label: this.form.main_section_label || null,
      parent_process_form_id: this.form.parent_process_form_id ?? null,
      team_id: this.form.team_id ?? null,
      service_offering_id: this.form.service_offering_id ?? null,
      // Open-link mode (migration 146) — only meaningful when published.
      is_public_open: (this.form.is_published && this.form.is_public_open) ? 1 : 0,
      public_target:  (this.form.public_target as any) || 'client',
      // Redirect target (migration 147). Trim + normalise so empty
      // strings don't accidentally become "everyone gets redirected".
      post_submit_url: (this.form.post_submit_url || '').trim() || null,
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
