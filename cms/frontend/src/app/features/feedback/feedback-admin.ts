import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { Api } from '../../core/api';
import { DialogService } from '../../core/dialog';
import { environment } from '@env/environment';
import { FeedbackForm, FeedbackKind } from '../../core/models';

const KIND_OPTIONS: { key: FeedbackKind; label: string; hint: string }[] = [
  { key: 'questionnaire', label: 'Questionnaire', hint: 'Multi-question structured form' },
  { key: 'form',          label: 'Feedback form', hint: 'Free-form comments + ratings' },
  { key: 'survey',        label: 'Survey',        hint: 'Broad research / data collection' },
  { key: 'poll',          label: 'Poll',          hint: 'Single quick-answer question' },
];

/**
 * /admin/feedback — list page for the feedback module.
 *
 * Each row is a feedback form (questionnaire / form / survey / poll).
 * New rows are spawned from the type-picker modal; rows route into the
 * builder at /admin/feedback/:id. The share modal lifts the public URL
 * + iframe embed code on demand.
 */
@Component({
  selector: 'app-feedback-admin',
  imports: [FormsModule, RouterLink, DatePipe],
  template: `
    <div class="toolbar">
      <h1>Feedback</h1>
      <span class="spacer"></span>
      <select [(ngModel)]="filterKind" name="kind" class="status-filter">
        <option value="">All types</option>
        @for (k of kindOptions; track k.key) {
          <option [value]="k.key">{{ k.label }}</option>
        }
      </select>
      <button class="primary" (click)="openCreate()">+ New feedback</button>
    </div>

    @if (loading()) {
      <p class="muted" style="padding: 20px;">Loading…</p>
    } @else if (visible().length === 0) {
      <div class="empty">
        <p class="muted">No feedback forms yet.</p>
        <button class="primary" (click)="openCreate()">+ Create your first</button>
      </div>
    } @else {
      <div class="table-wrap">
        <table class="data">
          <thead><tr>
            <th>Title</th>
            <th>Type</th>
            <th>Status</th>
            <th>Questions</th>
            <th>Responses</th>
            <th>Created</th>
            <th></th>
          </tr></thead>
          <tbody>
            @for (f of visible(); track f.id) {
              <tr (click)="open(f)">
                <td>
                  <strong>{{ f.title }}</strong>
                  @if (f.description) {
                    <div class="muted small desc">{{ f.description }}</div>
                  }
                </td>
                <td><span class="kind-pill" [attr.data-kind]="f.kind">{{ kindLabel(f.kind) }}</span></td>
                <td>
                  @if (f.is_published) {
                    <span class="pill">Published</span>
                  } @else {
                    <span class="pill muted-pill">Draft</span>
                  }
                </td>
                <td>{{ f.question_count || 0 }}</td>
                <td>{{ f.response_count || 0 }}</td>
                <td>{{ f.created_at | date:'mediumDate' }}</td>
                <td class="actions">
                  <button class="ghost icon-btn" (click)="openShare(f, $event)" title="Share / embed">↗</button>
                  <button class="ghost icon-btn" (click)="open(f, $event)" title="Edit">✎</button>
                  <button class="ghost icon-btn danger" (click)="del(f, $event)" title="Delete">✕</button>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }

    <!-- ── New-feedback type picker modal ─────────────────────── -->
    @if (createOpen()) {
      <div class="modal-backdrop" (click)="createOpen.set(false)">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-head">
            <h2>New feedback</h2>
            <button class="ghost icon-btn" (click)="createOpen.set(false)">✕</button>
          </div>
          <div class="modal-body">
            <label>Type</label>
            <div class="kind-grid">
              @for (k of kindOptions; track k.key) {
                <button type="button"
                        class="kind-card"
                        [class.selected]="draftKind() === k.key"
                        (click)="draftKind.set(k.key)">
                  <strong>{{ k.label }}</strong>
                  <span class="muted small">{{ k.hint }}</span>
                </button>
              }
            </div>

            <label style="margin-top: 16px;">Title</label>
            <input [(ngModel)]="draftTitle" name="cd_title" placeholder="e.g. Post-onboarding feedback" />
            @if (createError()) { <p class="error-msg">{{ createError() }}</p> }
          </div>
          <div class="modal-foot">
            <button class="ghost" (click)="createOpen.set(false)">Cancel</button>
            <button class="primary" (click)="create()" [disabled]="creating()">
              {{ creating() ? 'Creating…' : 'Create & edit' }}
            </button>
          </div>
        </div>
      </div>
    }

    <!-- ── Share modal — public URL + embed iframe code ──────── -->
    @if (sharingFor(); as f) {
      <div class="modal-backdrop" (click)="sharingFor.set(null)">
        <div class="modal share-modal" (click)="$event.stopPropagation()">
          <div class="modal-head">
            <h2>Share &amp; embed</h2>
            <button class="ghost icon-btn" (click)="sharingFor.set(null)">✕</button>
          </div>
          <div class="modal-body">
            <label>Optional client / lead tail</label>
            <p class="muted small">Appended to the URL so responses get tagged to the right record.</p>
            <div class="row two-col">
              <div>
                <label class="sub-label">Client ID</label>
                <input type="number" [(ngModel)]="shareClientId" name="sh_client" placeholder="e.g. 12" />
              </div>
              <div>
                <label class="sub-label">Lead ID</label>
                <input type="number" [(ngModel)]="shareLeadId" name="sh_lead" placeholder="e.g. 5" />
              </div>
            </div>

            <label style="margin-top: 16px;">Public URL</label>
            <div class="copy-row">
              <input [value]="publicUrl(f)" readonly />
              <button class="ghost" (click)="copy(publicUrl(f), 'url')">Copy</button>
            </div>

            <label style="margin-top: 16px;">Embed code (iframe)</label>
            <textarea readonly rows="3">{{ embedSnippet(f) }}</textarea>
            <div class="row" style="justify-content: flex-end;">
              <button class="ghost" (click)="copy(embedSnippet(f), 'embed')">Copy embed</button>
            </div>

            @if (copyMsg()) { <p class="success-msg">{{ copyMsg() }}</p> }
          </div>
          <div class="modal-foot">
            <button class="primary" (click)="sharingFor.set(null)">Done</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .desc { margin-top: 2px; max-width: 480px; }

    .kind-pill {
      display: inline-block; padding: 2px 10px; border-radius: 999px;
      font-size: 11px; font-weight: 600; letter-spacing: 0.3px;
      background: var(--bg-2); color: var(--muted);
    }
    .kind-pill[data-kind="questionnaire"] { background: color-mix(in oklab, #8aa9ff, transparent 80%); color: #8aa9ff; }
    .kind-pill[data-kind="form"]          { background: color-mix(in oklab, var(--primary), transparent 78%); color: var(--primary); }
    .kind-pill[data-kind="survey"]        { background: color-mix(in oklab, var(--success), transparent 78%); color: var(--success); }
    .kind-pill[data-kind="poll"]          { background: color-mix(in oklab, var(--warning), transparent 78%); color: var(--warning); }

    .pill {
      display: inline-block; padding: 2px 10px; border-radius: 999px;
      font-size: 12px;
      background: color-mix(in srgb, var(--primary) 18%, transparent);
      color: var(--primary); border: 1px solid color-mix(in srgb, var(--primary) 40%, transparent);
    }
    .pill.muted-pill { background: transparent; color: var(--muted); border-color: var(--line); }

    td.actions { text-align: right; white-space: nowrap; display: flex; gap: 4px; justify-content: flex-end; }
    td.actions .icon-btn {
      width: 32px; height: 32px; padding: 0;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 15px; line-height: 1;
    }

    /* Type picker — 2x2 card grid that mimics the theme picker
       pattern from /me/account so admins recognise the affordance. */
    .kind-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
      margin-top: 8px;
    }
    .kind-card {
      display: flex; flex-direction: column; gap: 4px;
      padding: 12px 14px; border-radius: var(--radius);
      background: var(--bg-2); border: 1px solid var(--line);
      cursor: pointer; text-align: left;
      transition: border-color .15s, transform .15s;
    }
    .kind-card:hover { border-color: var(--primary); transform: translateY(-1px); }
    .kind-card.selected {
      border-color: var(--primary);
      box-shadow: 0 0 0 2px color-mix(in oklab, var(--primary), transparent 70%);
    }

    /* Share modal styling: copy-rows and inline labels. */
    .copy-row { display: flex; gap: 6px; align-items: center; }
    .copy-row input { flex: 1; font-family: "JetBrains Mono", monospace; font-size: 12px; }
    .share-modal textarea {
      font-family: "JetBrains Mono", monospace; font-size: 12px;
      width: 100%; resize: vertical;
    }
    .sub-label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
    .row.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .status-filter { width: auto; min-width: 160px; }
  `],
})
export class FeedbackAdmin {
  private api    = inject(Api);
  private router = inject(Router);
  private dialog = inject(DialogService);

  readonly kindOptions = KIND_OPTIONS;
  forms   = signal<FeedbackForm[]>([]);
  loading = signal(true);

  filterKind: string = '';

  visible = computed(() => {
    if (!this.filterKind) return this.forms();
    return this.forms().filter(f => f.kind === this.filterKind);
  });

  // ── create modal ─────────────────────────────────────────────
  createOpen   = signal(false);
  createError  = signal<string | null>(null);
  creating     = signal(false);
  draftKind    = signal<FeedbackKind>('form');
  draftTitle   = '';

  // ── share modal ──────────────────────────────────────────────
  sharingFor   = signal<FeedbackForm | null>(null);
  shareClientId: number | null = null;
  shareLeadId:   number | null = null;
  copyMsg      = signal<string | null>(null);

  ngOnInit() { this.load(); }

  private load() {
    this.loading.set(true);
    this.api.listFeedbackForms().subscribe({
      next: r => { this.forms.set(r.forms); this.loading.set(false); },
      error: () => { this.loading.set(false); },
    });
  }

  kindLabel(k: string): string {
    return this.kindOptions.find(o => o.key === k as FeedbackKind)?.label ?? k;
  }

  openCreate() {
    this.draftTitle = '';
    this.draftKind.set('form');
    this.createError.set(null);
    this.createOpen.set(true);
  }
  create() {
    const title = this.draftTitle.trim();
    if (!title) { this.createError.set('Title is required'); return; }
    this.creating.set(true);
    this.api.createFeedbackForm({ title, kind: this.draftKind() }).subscribe({
      next: r => {
        this.creating.set(false);
        this.createOpen.set(false);
        this.router.navigate(['/admin/feedback', r.id]);
      },
      error: e => {
        this.creating.set(false);
        this.createError.set(e?.error?.error || 'Could not create');
      },
    });
  }

  open(f: FeedbackForm, ev?: Event) {
    ev?.stopPropagation();
    this.router.navigate(['/admin/feedback', f.id]);
  }

  openShare(f: FeedbackForm, ev?: Event) {
    ev?.stopPropagation();
    this.shareClientId = null;
    this.shareLeadId   = null;
    this.copyMsg.set(null);
    this.sharingFor.set(f);
  }

  publicUrl(f: FeedbackForm): string {
    // Mounted under the site root: /feedback/:token serves the SPA's
    // public viewer. Attribution goes on a single `id` param:
    //   - client fill  → ?id=c{N}
    //   - lead fill    → ?id=l{N}
    //   - public share → ?id=0
    // Backend parses the prefix to tag the response accordingly.
    const base = window.location.origin + environment.basePath + '/feedback/' + f.public_token;
    let idParam = '0';
    if (this.shareClientId) idParam = 'c' + this.shareClientId;
    else if (this.shareLeadId) idParam = 'l' + this.shareLeadId;
    return `${base}?id=${idParam}`;
  }
  embedSnippet(f: FeedbackForm): string {
    return `<iframe src="${this.publicUrl(f)}" style="width:100%;height:600px;border:0;" loading="lazy"></iframe>`;
  }

  async copy(text: string, label: 'url' | 'embed') {
    try {
      await navigator.clipboard.writeText(text);
      this.copyMsg.set(label === 'url' ? 'URL copied to clipboard.' : 'Embed snippet copied.');
      setTimeout(() => this.copyMsg.set(null), 2500);
    } catch {
      this.copyMsg.set('Could not copy — copy the text manually.');
    }
  }

  async del(f: FeedbackForm, ev?: Event) {
    ev?.stopPropagation();
    const ok = await this.dialog.confirm(`Delete "${f.title}"? Responses will also be removed.`, {
      title: 'Delete form',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    this.api.deleteFeedbackForm(f.id).subscribe(() => this.load());
  }
}
