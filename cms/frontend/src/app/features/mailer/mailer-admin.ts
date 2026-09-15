import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '@env/environment';
import { Api } from '../../core/api';
import { DialogService } from '../../core/dialog';
import { MailerPlaceholder, MailerRecipient, MailerTemplate } from '../../core/models';

/**
 * Mailer - write one message and send it to a filtered slice of the CRM.
 *
 *   /admin/mailer/compose   (the Mailer overview lives at /admin/mailer)
 *
 * Audience is Leads / Clients / Both, narrowed by industry, then ticked
 * per recipient so nothing goes out that the sender did not see. Placeholders
 * ({{first_name}}, {{company}}, ...) are substituted per recipient on the
 * server at send time, never here. Messages can be saved as templates.
 *
 * Sibling of Newsletter, not a replacement: Newsletter broadcasts a
 * block-built email to everyone, Mailer sends targeted, personalised copy.
 * Both share delivery and the same unsubscribe suppression list.
 */
@Component({
  selector: 'app-mailer-admin',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="toolbar">
      <h1>Compose</h1>
      <span class="spacer"></span>
      <select class="ml-tplpick" #tplSelect (change)="pickTemplate(tplSelect)">
        <option value="">Load template…</option>
        @for (t of templates(); track t.id) { <option [value]="t.id">{{ t.name }}</option> }
      </select>
      <button class="ghost" routerLink="/admin/mailer/sent" title="Every email sent through the Mailer">Sent emails</button>
      <button class="ghost" routerLink="/admin/mailer/templates" [queryParams]="{ new: 1 }" title="Write a new reusable template">Create new template</button>
      <button class="ghost" (click)="saveTemplate()" [disabled]="sending()">Save as template</button>
      <button class="primary" (click)="send()" [disabled]="!canSend() || sending()">
        {{ sending() ? 'Sending…' : 'Send to ' + selectedCount() }}
      </button>
    </div>

    <p class="muted small ml-sub">
      Write a message, choose who it goes to, and send. Placeholders are filled in per person.
      Anyone who has unsubscribed is shown but cannot be selected.
    </p>

    @if (error()) { <div class="error-msg">{{ error() }}</div> }
    @if (result(); as r) {
      <div class="ml-result">
        Sent <strong>{{ r.sent }}</strong> of {{ r.total }}.
        @if (r.failed) { <span class="ml-bad">{{ r.failed }} failed</span> }
        @if (r.skipped) { <span class="muted">{{ r.skipped }} skipped (unsubscribed)</span> }
      </div>
    }

    <div class="ml-grid">
      <!-- ── Compose ─────────────────────────────────────────── -->
      <section class="ml-pane">
        <h3>Message</h3>

        <!-- Send as — which team-member mailbox the campaign appears from.
             Populated from /api/graph-users when the User.Read.All Graph
             permission is granted; falls back to a note when it isn't. -->
        @if (graphUsers().length > 0) {
          <label class="ml-label" for="mlFrom">Send as</label>
          <select id="mlFrom" [ngModel]="senderId()" (ngModelChange)="senderId.set($event)">
            <option value="">— default (organizer mailbox) —</option>
            @for (u of graphUsers(); track u.id) {
              <option [value]="u.id">{{ u.displayName }} · {{ u.mail }}</option>
            }
          </select>
          <p class="muted small" style="margin: -6px 0 12px;">
            The campaign will be delivered from this mailbox. Replies land there.
          </p>
        } @else if (graphUsersError()) {
          <p class="muted small" style="margin-bottom: 12px;">
            Send-as picker unavailable — {{ graphUsersError() }}
          </p>
        }

        <label class="ml-label" for="mlSubject">Subject</label>
        <input id="mlSubject" type="text" [ngModel]="subject()" (ngModelChange)="subject.set($event)"
               placeholder="Quick question about {{ '{{company}}' }}" />

        <label class="ml-label" for="mlBody">Body</label>
        <textarea id="mlBody" rows="14" #bodyBox
                  [ngModel]="body()" (ngModelChange)="body.set($event)"
                  placeholder="Hi {{ '{{first_name}}' }},&#10;&#10;…"></textarea>

        <div class="ml-tokens">
          <span class="muted small">Insert:</span>
          @for (p of placeholders(); track p.key) {
            <button type="button" class="ml-token" [title]="tokenTitle(p)"
                    (click)="insertToken(p, bodyBox)">{{ p.label }}</button>
          }
        </div>

        <!-- Link maker: builds a tracked link so the URL is never typed by hand.
             Only pages that load main-website/js/page-view.js can count views,
             so only those are offered (trackedPages in the class). -->
        <label class="ml-label" for="mlLinkText">Tracked link</label>
        <div class="ml-filters">
          <select [ngModel]="linkPage()" (ngModelChange)="linkPage.set($event)" title="Page the link opens">
            @for (pg of trackedPages; track pg.file) {
              <option [value]="pg.file">{{ pg.label }}</option>
            }
          </select>
          <input id="mlLinkText" type="text" placeholder="Link text (blank = bare URL)"
                 [ngModel]="linkText()" (ngModelChange)="linkText.set($event)" />
          <button type="button" class="ghost" style="white-space: nowrap"
                  (click)="insertTrackedLink(bodyBox)">Insert link</button>
        </div>
        <p class="muted small" style="margin: -4px 0 10px; word-break: break-all;">Inserts: {{ trackedLink() }}</p>

        <details class="ml-preview">
          <summary>Preview with the first selected recipient</summary>
          @if (previewFor(); as p) {
            <p class="muted small">To {{ p.name }} &lt;{{ p.email }}&gt;</p>
            <div class="ml-preview-subject">{{ renderPreview(subject(), p) }}</div>
            <div class="ml-preview-body" [innerHTML]="renderPreview(body(), p)"></div>
          } @else {
            <p class="muted small">Select a recipient to preview.</p>
          }
        </details>
      </section>

      <!-- ── Audience ────────────────────────────────────────── -->
      <section class="ml-pane">
        <h3>Audience</h3>

        <!-- Follow-up mode: recipients came from the Sent emails page, not
             from the filter. Each is addressed to the inbox it was originally
             mailed at, and sending marks the originals "followed up". -->
        @if (followUp(); as fu) {
          <div class="ml-followup">
            <div class="ml-followup-main">
              <strong>Follow-up</strong>
              <span class="muted small">
                to {{ fu.count }} email{{ fu.count === 1 ? '' : 's' }}@if (fu.subject) { from "{{ fu.subject }}" }
                @if (fu.missing) { · <span class="ml-bad">{{ fu.missing }} skipped, record deleted</span> }
              </span>
            </div>
            <button type="button" class="ghost small" (click)="clearFollowUp()">✕ Clear</button>
          </div>
        } @else {
        <div class="ml-filters">
          <select [ngModel]="audience()" (ngModelChange)="audience.set($event); loadAudience()">
            <option value="both">Leads &amp; clients</option>
            <option value="leads">Leads only</option>
            <option value="clients">Clients only</option>
          </select>
          <select [ngModel]="industry()" (ngModelChange)="industry.set($event); loadAudience()">
            <option value="">All industries</option>
            @for (i of industries(); track i.label) {
              <option [value]="i.label">{{ i.label }} ({{ i.count }})</option>
            }
          </select>
          <select [ngModel]="source()" (ngModelChange)="source.set($event); loadAudience()"
                  title="How the lead was acquired. Leads only — clients carry no source.">
            <option value="">All sources</option>
            @for (s of sources(); track s.label) {
              <option [value]="s.label">{{ s.label }} ({{ s.count }})</option>
            }
          </select>
          <input type="text" placeholder="Search name / company / email…"
                 [ngModel]="q()" (ngModelChange)="q.set($event); loadAudience()" />
        </div>

        <div class="ml-filters">
          <select [ngModel]="sendTo()" (ngModelChange)="sendTo.set($event); loadAudience()"
                  title="Which contact on each record the message is addressed to">
            <option value="primary">Main contact</option>
            <option value="company">Company inbox only</option>
            <option value="role">By role…</option>
            <option value="all">All contacts</option>
          </select>
          @if (sendTo() === 'role') {
            <select [ngModel]="role()" (ngModelChange)="role.set($event); loadAudience()">
              <option value="">Choose a role…</option>
              @for (r of roles(); track r.label) {
                <option [value]="r.label">{{ r.label }} ({{ r.count }})</option>
              }
            </select>
          }
        </div>

        <p class="muted small ml-mode-note">{{ modeNote() }}</p>
        }

        <!-- One-off recipient: an address that is not (or not yet) in the
             CRM. Sits at the top of the list, ticked, and is logged under
             Sent emails as 'manual'. -->
        <form class="ml-oneoff" (submit)="addManual(); $event.preventDefault()">
          <input type="email" name="oneoffEmail" placeholder="Send to an email not in the CRM…"
                 [ngModel]="manualEmail()" (ngModelChange)="manualEmail.set($event)" />
          <input type="text" name="oneoffName" placeholder="Name (optional)"
                 [ngModel]="manualName()" (ngModelChange)="manualName.set($event)" />
          <button type="submit" class="ghost" [disabled]="!manualEmail().trim()">+ Add</button>
        </form>
        @if (manualError()) { <p class="error-msg ml-oneoff-err">{{ manualError() }}</p> }

        <div class="ml-selbar">
          <label class="ml-check-inline">
            <input type="checkbox" [checked]="allSelected()" [indeterminate]="someSelected()"
                   (change)="toggleAll($event)" />
            <span>Select all {{ selectableCount() }}</span>
          </label>
          <span class="spacer"></span>
          <span class="muted small">{{ selectedCount() }} selected</span>
        </div>

        @if (loadingAudience()) { <p class="muted small">Loading recipients…</p> }
        @else if (!visible().length) {
          <p class="muted small">{{ followUp() ? 'None of the picked emails can be followed up.' : 'Nobody matches this filter.' }}</p>
        }
        @else {
          <div class="ml-list">
            @for (r of visible(); track r.kind + r.id + ":" + (r.contact_id || "") + ":" + (r.kind === 'manual' ? r.email : "")) {
              <label class="ml-rec" [class.is-off]="r.suppressed" [class.is-manual]="r.kind === 'manual'">
                <input type="checkbox" [checked]="isSelected(r)" [disabled]="!!r.suppressed"
                       (change)="toggle(r)" />
                <span class="ml-rec-main">
                  <strong>{{ r.name || r.email }}</strong>
                  <span class="muted small">
                    @if (r.contact_name) {
                      {{ r.contact_name }}@if (r.job_title) { <span class="muted"> · {{ r.job_title }}</span> } · {{ r.email }}
                    } @else {
                      <span class="ml-noperson" title="No named contact on this record, so greeting placeholders will be blank">no named contact</span> · {{ r.email }}
                    }
                  </span>
                </span>
                @if (r.via_company_inbox) {
                  <span class="ml-viainbox" title="This person has no email address of their own, so the message goes to the record's shared inbox">shared inbox</span>
                }
                <span class="ml-kind" [attr.data-kind]="r.kind">{{ r.kind === 'manual' ? 'one-off' : r.kind }}</span>
                @if (r.suppressed) { <span class="ml-unsub" title="Unsubscribed">unsubscribed</span> }
                @if (r.kind === 'manual') {
                  <button type="button" class="ml-oneoff-x" title="Remove" (click)="removeManual(r, $event)">✕</button>
                }
              </label>
            }
          </div>
        }
      </section>
    </div>

  `,
  styles: [`
    .toolbar { padding: 16px 20px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--line); flex-wrap: nowrap; }
    .toolbar h1 { margin: 0; font-size: 22px; }
    .spacer { flex: 1; }
    .toolbar button { white-space: nowrap; }
    /* The global 'select { width: 100% }' would wrap the toolbar row. */
    .ml-tplpick { width: 190px; }

    .ml-sub { padding: 0 20px; margin: 10px 0 0; }
    .error-msg, .ml-result { margin: 12px 20px; }
    .ml-result { padding: 10px 14px; border: 1px solid var(--success); border-radius: var(--radius-sm); display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
    .ml-bad { color: var(--danger); }

    .ml-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 16px 20px; align-items: start; }
    @media (max-width: 1100px) { .ml-grid { grid-template-columns: 1fr; } }

    .ml-pane { background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 16px; }
    .ml-pane h3 { margin: 0 0 12px; font-size: 15px; }
    .ml-label { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); margin: 10px 0 4px; }
    .ml-pane textarea { width: 100%; font-family: inherit; resize: vertical; }

    .ml-tokens { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 10px; }
    .ml-token {
      padding: 2px 8px; font-size: 11px; cursor: pointer; white-space: nowrap;
      background: transparent; color: var(--primary);
      border: 1px solid var(--line); border-radius: 999px;
    }
    .ml-token:hover { border-color: var(--primary); }

    .ml-preview { margin-top: 14px; }
    .ml-preview summary { cursor: pointer; font-size: 12px; color: var(--muted); }
    .ml-preview-subject { font-weight: 600; margin: 8px 0 6px; }
    .ml-preview-body { border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 10px; font-size: 13px; }

    .ml-filters { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
    .ml-filters select, .ml-filters input { flex: 1 1 150px; min-width: 140px; }

    /* styles.scss sets 'input, textarea, select { width: 100% }' globally, so
       an unqualified checkbox stretches and shoves everything beside it off
       to the right. Every checkbox on this page needs an explicit box. */
    .ml-pane input[type="checkbox"] { width: 16px; height: 16px; flex: 0 0 16px; padding: 0; margin: 0; }

    .ml-selbar { display: flex; align-items: center; gap: 10px; padding: 6px 0 10px; border-bottom: 1px solid var(--line); }
    /* Checkbox labels in a metadata row inherit uppercase/letter-spacing from
       the surrounding card unless reset, and wrap onto two lines. */
    .ml-check-inline { display: flex; align-items: center; gap: 6px; cursor: pointer;
      text-transform: none; letter-spacing: normal; white-space: nowrap; font-size: 13px; }

    .ml-list { max-height: 460px; overflow-y: auto; margin-top: 8px; }
    .ml-rec {
      display: flex; align-items: center; gap: 10px;
      padding: 6px 4px; border-bottom: 1px solid var(--line); cursor: pointer;
      text-transform: none; letter-spacing: normal;
    }
    .ml-rec.is-off { opacity: 0.5; cursor: not-allowed; }
    .ml-rec-main { display: flex; flex-direction: column; min-width: 0; flex: 1; }
    .ml-rec-main span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ml-kind {
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      padding: 1px 6px; border-radius: 4px; border: 1px solid; white-space: nowrap;
    }
    .ml-kind[data-kind="lead"]   { color: var(--primary); border-color: var(--primary); }
    .ml-kind[data-kind="client"] { color: var(--success); border-color: var(--success); }
    .ml-kind[data-kind="manual"] { color: var(--muted); border-color: var(--muted); }
    .ml-oneoff { display: flex; gap: 8px; align-items: center; margin: 0 0 10px; }
    .ml-oneoff input[type="email"] { flex: 2 1 200px; min-width: 160px; }
    .ml-oneoff input[type="text"]  { flex: 1 1 120px; min-width: 110px; }
    .ml-oneoff button { white-space: nowrap; }
    .ml-oneoff-err { margin: -6px 0 8px; }
    .ml-rec.is-manual { background: var(--bg-3); }
    .ml-oneoff-x {
      background: transparent; border: 0; color: var(--muted); cursor: pointer; padding: 0 4px; font-size: 12px; line-height: 1;
    }
    .ml-oneoff-x:hover { color: var(--danger); }
    .ml-unsub { font-size: 10px; color: var(--danger); white-space: nowrap; }
    /* No contact behind this record: greeting tokens will render blank. */
    .ml-noperson { color: var(--warning); }
    /* Named person reached at a shared address rather than their own. */
    .ml-viainbox { font-size: 10px; color: var(--muted); white-space: nowrap; }
    .ml-mode-note { margin: 0 0 10px; }
    .ml-followup {
      display: flex; align-items: center; gap: 10px; margin-bottom: 10px;
      padding: 8px 12px; border: 1px solid var(--primary); border-radius: var(--radius-sm);
    }
    .ml-followup-main { display: flex; flex-direction: column; min-width: 0; flex: 1; }
    .ml-followup button { white-space: nowrap; }

  `],
})
export class MailerAdmin {
  private api = inject(Api);
  private dialog = inject(DialogService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  /** Set while composing a follow-up (?followup=<recipient ids>). The
   *  recipient list then comes from /api/mailer/followup, not the filter. */
  readonly followUp = signal<{ ids: number[]; count: number; subject: string | null; missing: number } | null>(null);

  readonly subject = signal('');
  readonly body = signal('');
  readonly audience = signal<'leads' | 'clients' | 'both'>('both');
  readonly industry = signal('');
  readonly q = signal('');
  /** Lead acquisition source. Leads-only: `clients` has no source column, so
   *  setting this drops clients from the audience (the server does it, and
   *  modeNote() says so). */
  readonly source = signal('');
  readonly sources = signal<{ label: string; count: number }[]>([]);
  /** Which contact on each record to address. */
  readonly sendTo = signal<'primary' | 'company' | 'role' | 'all'>('primary');
  readonly role = signal('');
  readonly roles = signal<{ label: string; count: number }[]>([]);

  readonly modeNote = computed(() => {
    // A source filter silently removes clients unless we say so — they hold
    // no acquisition source, so no client can ever match one.
    const src = this.source() && this.audience() !== 'leads'
      ? ` Clients are excluded while a source is set — only leads carry one.`
      : '';
    return this.sendToNote() + src;
  });

  private readonly sendToNote = computed(() => {
    switch (this.sendTo()) {
      case 'company': return 'One message per record, to its own email address. No person is named, so greeting placeholders stay blank.';
      case 'role':    return this.role()
        ? `One message per contact whose role is "${this.role()}". Contacts with no address of their own are reached at the company inbox.`
        : 'Choose a role to target.';
      case 'all':     return 'One message per contact on each record. Contacts with no address of their own are reached at the company inbox, and duplicates to the same address are merged.';
      default:        return 'One message per record, to its main contact — the flagged primary, or the first on file.';
    }
  });

  readonly recipients = signal<MailerRecipient[]>([]);
  readonly industries = signal<{ label: string; count: number }[]>([]);
  readonly placeholders = signal<MailerPlaceholder[]>([]);
  readonly templates = signal<MailerTemplate[]>([]);

  readonly loadingAudience = signal(false);
  readonly sending = signal(false);

  // Send-as picker — Microsoft 365 users the campaign can send from.
  // Empty until /api/graph-users returns; falls back to the tenant's
  // default organizer mailbox when senderId is blank.
  readonly senderId        = signal<string>('');
  readonly graphUsers      = signal<Array<{ id: string; displayName: string; mail: string; userPrincipalName: string; jobTitle: string | null }>>([]);
  readonly graphUsersError = signal<string | null>(null);
  private http = inject(HttpClient);
  readonly error = signal<string | null>(null);
  readonly result = signal<{ total: number; sent: number; failed: number; skipped: number } | null>(null);

  // Zoneless: replace the Set rather than mutating it, or dependent
  // computeds never re-evaluate.
  readonly selected = signal<Set<string>>(new Set());

  /** Row identity includes the contact: the same record can appear once per
   *  person, and those are separate messages. */
  private key(r: { kind: string; id: number; contact_id?: number | null; email?: string }) {
    if (r.kind === 'manual') return 'manual:' + (r.email || '').toLowerCase();
    return r.kind + ':' + r.id + ':' + (r.contact_id ?? '');
  }

  /** One-off addresses typed in by hand. Kept apart from the filtered list so
   *  changing the audience filter never drops them. */
  readonly manual = signal<MailerRecipient[]>([]);
  readonly manualEmail = signal('');
  readonly manualName = signal('');
  readonly manualError = signal<string | null>(null);
  /** What the list shows: one-offs first, then the filtered CRM recipients. */
  readonly visible = computed<MailerRecipient[]>(() => [...this.manual(), ...this.recipients()]);

  addManual() {
    const email = this.manualEmail().trim().toLowerCase();
    const name = this.manualName().trim();
    this.manualError.set(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { this.manualError.set('That does not look like an email address.'); return; }
    if (this.visible().some(r => (r.email || '').toLowerCase() === email)) {
      this.manualError.set('That address is already in the list.'); return;
    }
    const row: MailerRecipient = {
      kind: 'manual', id: 0, name: name || email, email, company: null, industry: null,
      contact_name: name, job_title: '', contact_id: null, has_person: name ? 1 : 0, via_company_inbox: 0, suppressed: 0,
    };
    this.manual.set([...this.manual(), row]);
    this.selected.set(new Set([...this.selected(), this.key(row)]));
    this.manualEmail.set('');
    this.manualName.set('');
  }

  removeManual(r: MailerRecipient, ev: Event) {
    ev.preventDefault();
    ev.stopPropagation();
    this.manual.set(this.manual().filter(m => m !== r));
    const next = new Set(this.selected());
    next.delete(this.key(r));
    this.selected.set(next);
  }

  readonly selectable = computed(() => this.visible().filter(r => !r.suppressed));
  readonly selectableCount = computed(() => this.selectable().length);
  readonly selectedCount = computed(() => this.selected().size);
  readonly canSend = computed(() =>
    this.selectedCount() > 0 && this.subject().trim() !== '' && this.body().trim() !== '');

  readonly allSelected = computed(() => {
    const s = this.selectable();
    return s.length > 0 && s.every(r => this.selected().has(this.key(r)));
  });
  readonly someSelected = computed(() => {
    const n = this.selectable().filter(r => this.selected().has(this.key(r))).length;
    return n > 0 && n < this.selectableCount();
  });

  /** First selected recipient, used to render the preview. */
  readonly previewFor = computed(() =>
    this.visible().find(r => this.selected().has(this.key(r))) ?? null);

  constructor() {
    const fu = (this.route.snapshot.queryParamMap.get('followup') || '')
      .split(',').map(x => Number(x)).filter(n => Number.isInteger(n) && n > 0);
    if (fu.length) this.loadFollowUp(fu); else this.loadAudience();
    const tpl = Number(this.route.snapshot.queryParamMap.get('template') || 0);
    if (tpl > 0) this.pendingTemplateId = tpl;
    this.api.mailerIndustries().subscribe({ next: r => this.industries.set(r.industries || []) });
    this.api.mailerRoles().subscribe({ next: r => this.roles.set(r.roles || []) });
    this.api.mailerSources().subscribe({ next: r => this.sources.set(r.sources || []) });
    this.api.mailerPlaceholders().subscribe({ next: r => this.placeholders.set(r.placeholders || []) });
    this.refreshTemplates();
    // Populate the Send-as dropdown. Silently no-ops when Graph isn't
    // configured or the User.Read.All permission isn't granted (backend
    // returns { users: [] } or an error).
    this.http.get<{ users: any[]; note?: string }>(`${environment.basePath}/api/graph-users`).subscribe({
      next: r => this.graphUsers.set(r.users || []),
      error: e => this.graphUsersError.set(e?.error?.error || 'Could not load team members.'),
    });
  }

  /** Template asked for in the URL (?template=id), applied once the list is in. */
  private pendingTemplateId = 0;
  /** Template the current message was started from; sent as template_id so
   *  the Templates page can count uses. Cleared when the composer is emptied. */
  readonly templateId = signal<number | null>(null);

  refreshTemplates() {
    this.api.listMailerTemplates().subscribe({ next: r => {
      this.templates.set(r.templates || []);
      if (this.pendingTemplateId) { this.loadTemplate(this.pendingTemplateId); this.pendingTemplateId = 0; }
    } });
  }

  /** Follow-up mode: the list is the picked log rows, every one pre-ticked,
   *  and the subject is prefilled "Re: ..." when they all share one. */
  loadFollowUp(ids: number[]) {
    this.loadingAudience.set(true);
    this.api.mailerFollowup(ids).subscribe({
      next: r => {
        const recs = r.recipients || [];
        this.followUp.set({ ids, count: recs.length, subject: r.subject, missing: (r.missing || []).length });
        this.manual.set(recs.filter(x => x.kind === 'manual'));
        this.recipients.set(recs.filter(x => x.kind !== 'manual'));
        this.selected.set(new Set(recs.filter(x => !x.suppressed).map(x => this.key(x))));
        if (r.subject && !this.subject().trim()) {
          this.subject.set(/^re:/i.test(r.subject) ? r.subject : 'Re: ' + r.subject);
        }
        this.loadingAudience.set(false);
      },
      error: e => { this.error.set(e?.error?.error || 'Failed to load the emails to follow up.'); this.loadingAudience.set(false); },
    });
  }

  clearFollowUp() {
    this.followUp.set(null);
    this.selected.set(new Set());
    this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
    this.loadAudience();
  }

  loadAudience() {
    if (this.followUp()) return;
    this.loadingAudience.set(true);
    this.api.mailerAudience(this.audience(), this.industry(), this.q(), this.sendTo(), this.role(), this.source()).subscribe({
      next: r => {
        this.recipients.set(r.recipients || []);
        // Drop anything no longer in view so the count never claims more
        // than the list can show.
        const live = new Set([...this.manual(), ...(r.recipients || [])].map(x => this.key(x)));
        const next = new Set([...this.selected()].filter(k => live.has(k)));
        this.selected.set(next);
        this.loadingAudience.set(false);
      },
      error: e => { this.error.set(e?.error?.error || 'Failed to load recipients.'); this.loadingAudience.set(false); },
    });
  }

  isSelected(r: MailerRecipient) { return this.selected().has(this.key(r)); }

  toggle(r: MailerRecipient) {
    if (r.suppressed) return;
    const next = new Set(this.selected());
    const k = this.key(r);
    next.has(k) ? next.delete(k) : next.add(k);
    this.selected.set(next);
  }

  toggleAll(ev: Event) {
    const on = (ev.target as HTMLInputElement).checked;
    const next = new Set(this.selected());
    for (const r of this.selectable()) { on ? next.add(this.key(r)) : next.delete(this.key(r)); }
    this.selected.set(next);
  }

  tokenTitle(p: MailerPlaceholder): string {
    if (p.leads && p.clients) return p.token;
    return p.token + (p.leads ? ' — leads only, blank for clients' : ' — clients only, blank for leads');
  }

  /** Put text at the caret (replacing any selection) and leave the caret just
   *  after it, so an insert lands mid-sentence rather than at the end. */
  private insertAtCaret(text: string, box: HTMLTextAreaElement) {
    const cur = this.body();
    const start = box.selectionStart ?? cur.length;
    const end = box.selectionEnd ?? cur.length;
    this.body.set(cur.slice(0, start) + text + cur.slice(end));
    setTimeout(() => {
      box.focus();
      const pos = start + text.length;
      box.setSelectionRange(pos, pos);
    });
  }

  /** Drop a token at the caret rather than at the end, so it lands mid-sentence. */
  insertToken(p: MailerPlaceholder, box: HTMLTextAreaElement) {
    this.insertAtCaret(p.token, box);
  }

  // ── Link maker ─────────────────────────────────────────────
  /** Live marketing site. No site-URL setting exists, so it lives here. */
  private readonly siteBase = 'https://builtrightstudio.com';

  /** Pages whose views are counted — each MUST load main-website/js/page-view.js.
   *  A page without it would produce links that silently never count, so add
   *  the script to the page first, then the page here. */
  // Every entry MUST load js/page-view.js or its links never count. All of
  // these do (added site-wide). Deliberately NOT offered: pricing.html and
  // onboarding.html (noindex — pricing was hidden from the site on request),
  // products.html and site-view-*.html (not linked from the public site).
  readonly trackedPages: { file: string; label: string }[] = [
    { file: 'preview.html',                label: 'Preview page' },
    { file: 'index.html',                  label: 'Home' },
    { file: 'about.html',                  label: 'About' },
    { file: 'websites.html',               label: 'Websites' },
    { file: 'software-solutions.html',     label: 'Software solutions' },
    { file: 'it-services.html',            label: 'IT services' },
    { file: 'social-media-marketing.html', label: 'Social media marketing' },
    { file: 'portfolio.html',              label: 'Portfolio' },
    { file: 'casestudy.html',              label: 'Case study' },
    { file: 'brand-kit.html',              label: 'Brand kit' },
    { file: 'contact.html',                label: 'Contact' },
  ];

  readonly linkPage = signal(this.trackedPages[0].file);
  readonly linkText = signal('View your preview');

  /** The link exactly as inserted, placeholders left for the server to fill
   *  per recipient. {{id_type}} rather than a fixed type, so a mixed leads +
   *  clients send records each view against the right record. The raw & is
   *  intentional: readable in the textarea, and valid HTML because "&id_type"
   *  is not a named character reference. Blank link text gives the bare URL. */
  readonly trackedLink = computed(() => {
    const url = this.siteBase + '/' + this.linkPage() + '?id={{id}}&id_type={{id_type}}';
    const text = this.linkText().trim();
    return text ? '<a href="' + url + '">' + this.escapeHtml(text) + '</a>' : url;
  });

  insertTrackedLink(box: HTMLTextAreaElement) {
    this.insertAtCaret(this.trackedLink(), box);
  }

  /** Link text is typed by the user and lands inside HTML. */
  private escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** Client-side echo of the server's substitution, for the preview only.
   *  Person tokens read the resolved CONTACT, never the record name — the
   *  preview has to show the same blank the recipient would actually get. */
  renderPreview(text: string, r: MailerRecipient): string {
    const contact = (r.contact_name || '').trim();
    return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_m, key: string) => {
      const k = key.toLowerCase();
      if (k === 'first_name')   return contact.split(/\s+/)[0] || '';
      if (k === 'last_name')    return contact.split(/\s+/).slice(1).join(' ');
      if (k === 'contact_name') return contact;
      if (k === 'job_title')    return r.job_title || '';
      if (k === 'id')           return String(r.id ?? '');
      if (k === 'id_type')      return r.kind || '';
      if (k === 'name')         return r.name || '';
      if (k === 'email')        return r.email || '';
      if (k === 'company')      return r.company || '';
      if (k === 'industry')     return r.industry || '';
      // Everything else is only known server-side; don't imply a value we
      // have not actually resolved.
      return '…';
    });
  }

  /** Person tokens used in the current message. */
  private personTokensUsed(): string[] {
    const text = this.subject() + ' ' + this.body();
    return this.placeholders()
      .filter(p => p.person && new RegExp('\\{\\{\\s*' + p.key + '\\s*\\}\\}', 'i').test(text))
      .map(p => p.token);
  }

  /** Selected recipients with no contact behind them, who would receive the
   *  greeting tokens as empty strings ("Hi ,"). */
  readonly blankGreetings = computed(() =>
    this.visible().filter(r => this.selected().has(this.key(r)) && !r.has_person));

  loadTemplate(idRaw: string | number) {
    const id = Number(idRaw);
    if (!id) return;
    const t = this.templates().find(x => x.id === id);
    if (!t) return;
    this.subject.set(t.subject || '');
    this.body.set(t.body_html || '');
    this.templateId.set(t.id);
  }

  /** Toolbar picker: load the chosen template's subject + body, then put the
   *  picker back on "Load template…". Left on the template's name, picking that
   *  SAME template again (say, to undo edits to its subject) fires no change
   *  event in the browser, so nothing reloads - and the name implied the
   *  composer still matched the template after it had been edited. The DOM
   *  value is reset directly: a signal set back to '' it already held would
   *  not re-render the select. */
  pickTemplate(el: HTMLSelectElement) {
    this.loadTemplate(el.value);
    el.value = '';
  }

  saveTemplate() {
    this.dialog.prompt('Name this template', { title: 'Save as template', defaultValue: '' }).then(name => {
      if (!name || !name.trim()) return;
      this.api.createMailerTemplate({ name: name.trim(), subject: this.subject(), body_html: this.body() })
        .subscribe({
          next: () => this.refreshTemplates(),
          error: e => this.error.set(e?.error?.error || 'Could not save template.'),
        });
    });
  }

  send() {
    if (!this.canSend() || this.sending()) return;
    const chosen = this.visible().filter(r => this.selected().has(this.key(r)));

    // A message that greets by name, sent to records with no named contact,
    // arrives as "Hi ,". Say so before it goes out rather than after.
    const tokens = this.personTokensUsed();
    const blanks = this.blankGreetings();
    const warn = (tokens.length && blanks.length)
      ? `\n\nWARNING: ${blanks.length} of these have no named contact, so ${tokens.join(' / ')} will be blank for them. Examples: ${blanks.slice(0, 3).map(r => r.name || r.email).join(', ')}${blanks.length > 3 ? '…' : ''}`
      : '';

    const what = this.followUp() ? 'follow-up' : 'message';
    this.dialog.confirm(
      `Send the ${what} "${this.subject()}" to ${chosen.length} recipient${chosen.length === 1 ? '' : 's'}?${warn}\n\nThis sends real email immediately and cannot be undone.`,
      { title: 'Send message', confirmLabel: 'Send', variant: warn ? 'warning' : 'default' },
    ).then(ok => {
      if (!ok) return;
      this.sending.set(true);
      this.error.set(null);
      this.result.set(null);
      this.api.sendMailer({
        subject: this.subject(),
        body_html: this.body(),
        audience: this.audience(),
        industry: this.industry(),
        recipients: chosen.map(r => ({
          kind: r.kind, id: r.id, contact_id: r.contact_id ?? null,
          reply_to_recipient_id: r.reply_to_recipient_id || undefined,
          // One-offs carry their address + name; CRM rows are re-read server-side.
          email: r.kind === 'manual' ? r.email : undefined,
          name: r.kind === 'manual' ? (r.contact_name || undefined) : undefined,
        })),
        sender_id: this.senderId() || undefined,
        template_id: this.templateId() || undefined,
      } as any).subscribe({
        next: res => {
          this.sending.set(false);
          this.result.set({ total: res.total, sent: res.sent, failed: res.failed, skipped: res.skipped });
          this.selected.set(new Set());
          this.manual.set([]);
        },
        error: e => {
          this.sending.set(false);
          this.error.set(e?.error?.error || 'Send failed.');
        },
      });
    });
  }
}
