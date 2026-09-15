import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import { DialogService } from '../../core/dialog';
import { MailerPlaceholder, MailerTemplate } from '../../core/models';

/**
 * Mailer - templates.
 *
 *   /admin/mailer/templates
 *
 * The reusable messages the composer's "Load template…" picker offers.
 * Placeholders ({{first_name}}, {{company}}, ...) are stored un-substituted
 * and filled in per recipient at send time, so a template is written exactly
 * like a message. This page lists, creates, edits, duplicates and deletes
 * them; "Use" opens the composer with the template loaded
 * (/admin/mailer/compose?template=<id>).
 */
@Component({
  selector: 'app-mailer-templates',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="toolbar">
      <h1>Templates</h1>
      <span class="spacer"></span>
      <input type="text" class="mt-search" placeholder="Search name or subject…"
             [ngModel]="q()" (ngModelChange)="q.set($event)" />
      <button class="ghost" routerLink="/admin/mailer/compose">Compose</button>
      <button class="primary" (click)="create()">+ New template</button>
    </div>

    <p class="muted small mt-sub">
      Reusable messages for the composer. Write them like a real message; placeholders are filled in per person when it is sent.
    </p>

    @if (error()) { <div class="error-msg mt-err">{{ error() }}</div> }

    @if (loading() && !templates().length) {
      <p class="muted small mt-sub">Loading…</p>
    } @else if (!filtered().length) {
      <div class="empty">
        @if (q().trim()) { No template matches "{{ q() }}". }
        @else { No templates yet. Write one here, or save a message from the composer. }
      </div>
    } @else {
      <div class="table-wrap mt-table">
        <table class="data">
          <thead>
            <tr>
              <th>Name</th>
              <th>Subject</th>
              <th class="mt-col-used">Used</th>
              <th class="mt-col-date">Updated</th>
              <th class="mt-col-act"></th>
            </tr>
          </thead>
          <tbody>
            @for (t of filtered(); track t.id) {
              <tr (click)="edit(t)" title="Edit this template">
                <td>
                  <strong>{{ t.name }}</strong>
                  <div class="muted small mt-snippet">{{ snippet(t.body_html) }}</div>
                </td>
                <td class="mt-subject">{{ t.subject || '—' }}</td>
                <td class="mt-col-used muted small mt-nowrap">
                  @if (t.uses) { {{ t.uses }} send{{ t.uses === 1 ? '' : 's' }} · last {{ fmtDate(t.last_used_at) }} }
                  @else { never }
                </td>
                <td class="mt-col-date muted small mt-nowrap">{{ fmtDate(t.updated_at) }}</td>
                <td class="mt-col-act mt-nowrap" (click)="$event.stopPropagation()">
                  <button class="primary small" (click)="use(t)" title="Open the composer with this template loaded">Use</button>
                  <button class="ghost small" (click)="edit(t)">Edit</button>
                  <button class="ghost small" (click)="duplicate(t)">Duplicate</button>
                  <button class="ghost small" (click)="remove(t)">Delete</button>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }

    <!-- ── Editor ─────────────────────────────────────────────── -->
    @if (editorOpen()) {
      <div class="modal-backdrop" (click)="closeEditor()">
        <div class="modal modal-wide mt-modal" (click)="$event.stopPropagation()">
          <div class="modal-head">
            <h2>{{ draftId() ? 'Edit template' : 'New template' }}</h2>
            <button class="ghost" (click)="closeEditor()">✕</button>
          </div>
          <div class="modal-body">
            <div class="mt-editor">
              <div class="mt-fields">
                <label class="mt-label" for="mtName">Name</label>
                <input id="mtName" type="text" [ngModel]="draftName()" (ngModelChange)="draftName.set($event)"
                       placeholder="e.g. First outreach - care homes" />

                <label class="mt-label" for="mtSubject">Subject</label>
                <input id="mtSubject" type="text" [ngModel]="draftSubject()" (ngModelChange)="draftSubject.set($event)"
                       placeholder="Quick question about {{ '{{company}}' }}" />

                <label class="mt-label" for="mtBody">Body</label>
                <textarea id="mtBody" rows="14" #bodyBox
                          [ngModel]="draftBody()" (ngModelChange)="draftBody.set($event)"
                          placeholder="Hi {{ '{{first_name}}' }},&#10;&#10;…"></textarea>

                <div class="mt-tokens">
                  <span class="muted small">Insert:</span>
                  @for (p of placeholders(); track p.key) {
                    <button type="button" class="mt-token" [title]="tokenTitle(p)" (click)="insertToken(p, bodyBox)">{{ p.label }}</button>
                  }
                </div>
              </div>

              <div class="mt-preview">
                <div class="mt-label">Preview</div>
                <p class="muted small">Placeholders are shown as written; each recipient gets their own values.</p>
                <div class="mt-preview-subject">{{ draftSubject() || '(no subject)' }}</div>
                <div class="mt-preview-body" [innerHTML]="draftBody()"></div>
              </div>
            </div>
            @if (editorError()) { <div class="error-msg">{{ editorError() }}</div> }
          </div>
          <div class="modal-foot">
            @if (draftId()) {
              <button class="ghost" (click)="useDraft()" title="Save and open the composer with this template">Save &amp; use</button>
            }
            <span class="spacer"></span>
            <button class="ghost" (click)="closeEditor()">Cancel</button>
            <button class="primary" (click)="save()" [disabled]="saving() || !draftName().trim()">
              {{ saving() ? 'Saving…' : 'Save template' }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .toolbar { padding: 16px 20px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--line); flex-wrap: nowrap; }
    .toolbar h1 { margin: 0; font-size: 22px; white-space: nowrap; }
    .spacer { flex: 1; }
    .toolbar button { white-space: nowrap; }
    /* The global 'input { width: 100% }' would wrap the toolbar row. */
    .mt-search { width: 260px; }

    .mt-sub { padding: 0 20px; margin: 10px 0 0; }
    .mt-err { margin: 12px 20px; }
    .mt-table { margin: 14px 20px 20px; }
    .mt-nowrap { white-space: nowrap; }
    .mt-col-used { width: 200px; }
    .mt-col-date { width: 120px; }
    .mt-col-act { width: 250px; text-align: right; }
    .mt-col-act button { white-space: nowrap; margin-left: 4px; }
    .mt-subject { max-width: 360px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mt-snippet { max-width: 360px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px; }

    .mt-modal { width: 1080px; }
    .mt-modal .modal-body { overflow-y: auto; padding: 16px 18px; }
    .mt-modal .modal-foot { display: flex; align-items: center; gap: 8px; padding: 12px 18px; border-top: 1px solid var(--line); }
    .mt-modal .modal-foot button { white-space: nowrap; }
    .mt-editor { display: grid; grid-template-columns: 3fr 2fr; gap: 18px; align-items: start; }
    @media (max-width: 900px) { .mt-editor { grid-template-columns: 1fr; } }
    .mt-label { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); margin: 10px 0 4px; }
    .mt-fields textarea { width: 100%; font-family: inherit; resize: vertical; }
    .mt-tokens { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 10px; }
    .mt-token {
      padding: 2px 8px; font-size: 11px; cursor: pointer; white-space: nowrap;
      background: transparent; color: var(--primary); border: 1px solid var(--line); border-radius: 999px;
    }
    .mt-token:hover { border-color: var(--primary); }
    .mt-preview { border-left: 1px solid var(--line); padding-left: 18px; min-width: 0; }
    .mt-preview-subject { font-weight: 600; margin: 8px 0 6px; word-break: break-word; }
    .mt-preview-body { border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 10px; font-size: 13px; word-break: break-word; min-height: 120px; }
    .mt-preview-body p { margin: 0 0 10px; }
  `],
})
export class MailerTemplates {
  private api = inject(Api);
  private dialog = inject(DialogService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  readonly templates = signal<MailerTemplate[]>([]);
  readonly placeholders = signal<MailerPlaceholder[]>([]);
  readonly q = signal('');
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  readonly editorOpen = signal(false);
  readonly editorError = signal<string | null>(null);
  readonly draftId = signal<number | null>(null);
  readonly draftName = signal('');
  readonly draftSubject = signal('');
  readonly draftBody = signal('');

  readonly filtered = computed(() => {
    const needle = this.q().trim().toLowerCase();
    const all = this.templates();
    if (!needle) return all;
    return all.filter(t => (t.name || '').toLowerCase().includes(needle) || (t.subject || '').toLowerCase().includes(needle));
  });

  constructor() {
    this.load();
    this.api.mailerPlaceholders().subscribe({ next: r => this.placeholders.set(r.placeholders || []) });
    // ?new=1 (the composer's "Create new template" button): open a blank editor at once.
    if (this.route.snapshot.queryParamMap.get('new')) {
      this.create();
      this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
    }
  }

  load() {
    this.loading.set(true);
    this.error.set(null);
    this.api.listMailerTemplates().subscribe({
      next: r => { this.templates.set(r.templates || []); this.loading.set(false); },
      error: e => { this.error.set(e?.error?.error || 'Failed to load templates.'); this.loading.set(false); },
    });
  }

  // ── Editor ─────────────────────────────────────────────────────
  create() { this.openEditor(null, '', '', ''); }
  edit(t: MailerTemplate) { this.openEditor(t.id, t.name, t.subject || '', t.body_html || ''); }
  duplicate(t: MailerTemplate) { this.openEditor(null, t.name + ' (copy)', t.subject || '', t.body_html || ''); }

  private openEditor(id: number | null, name: string, subject: string, body: string) {
    this.draftId.set(id);
    this.draftName.set(name);
    this.draftSubject.set(subject);
    this.draftBody.set(body);
    this.editorError.set(null);
    this.editorOpen.set(true);
  }

  closeEditor() { this.editorOpen.set(false); }

  /** Save the draft; resolves with the template id (new or existing). */
  private persist(): Promise<number | null> {
    const name = this.draftName().trim();
    if (!name) { this.editorError.set('Give the template a name.'); return Promise.resolve(null); }
    const payload = { name, subject: this.draftSubject().trim(), body_html: this.draftBody() };
    const id = this.draftId();
    this.saving.set(true);
    this.editorError.set(null);
    return new Promise(resolve => {
      const done = (newId: number) => { this.saving.set(false); this.load(); resolve(newId); };
      const fail = (e: any) => { this.saving.set(false); this.editorError.set(e?.error?.error || 'Could not save the template.'); resolve(null); };
      if (id) this.api.updateMailerTemplate(id, payload).subscribe({ next: () => done(id), error: fail });
      else this.api.createMailerTemplate(payload).subscribe({ next: r => done(r.id), error: fail });
    });
  }

  save() {
    this.persist().then(id => { if (id) this.closeEditor(); });
  }

  useDraft() {
    this.persist().then(id => { if (id) this.router.navigate(['/admin/mailer/compose'], { queryParams: { template: id } }); });
  }

  use(t: MailerTemplate) {
    this.router.navigate(['/admin/mailer/compose'], { queryParams: { template: t.id } });
  }

  remove(t: MailerTemplate) {
    const used = t.uses ? ` It has been used for ${t.uses} send${t.uses === 1 ? '' : 's'}; those stay in Sent emails.` : '';
    this.dialog.confirm(`Delete the template "${t.name}"?${used}`,
      { title: 'Delete template', variant: 'danger', confirmLabel: 'Delete' }).then(ok => {
      if (!ok) return;
      this.api.deleteMailerTemplate(t.id).subscribe({
        next: () => this.load(),
        error: e => this.error.set(e?.error?.error || 'Could not delete the template.'),
      });
    });
  }

  // ── Placeholders ───────────────────────────────────────────────
  tokenTitle(p: MailerPlaceholder): string {
    if (p.leads && p.clients) return p.token;
    return p.token + (p.leads ? ' — leads only, blank for clients' : ' — clients only, blank for leads');
  }

  /** Drop a token at the caret rather than at the end, so it lands mid-sentence. */
  insertToken(p: MailerPlaceholder, box: HTMLTextAreaElement) {
    const cur = this.draftBody();
    const start = box.selectionStart ?? cur.length;
    const end = box.selectionEnd ?? cur.length;
    this.draftBody.set(cur.slice(0, start) + p.token + cur.slice(end));
    setTimeout(() => {
      box.focus();
      const pos = start + p.token.length;
      box.setSelectionRange(pos, pos);
    });
  }

  // ── Formatting ─────────────────────────────────────────────────
  snippet(html: string | null): string {
    const text = (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return text.length > 110 ? text.slice(0, 110) + '…' : text;
  }
  fmtDate(s: string | null | undefined): string {
    if (!s) return '—';
    const d = new Date(s.replace(' ', 'T'));
    if (isNaN(d.getTime())) return s;
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }
}
