import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Api } from '../../core/api';
import { NewsletterCampaign, NewsletterRecipient, NewsletterStatus } from '../../core/models';
import {
  BLOCK_LABELS, NewsletterBlock, NewsletterBlockKind,
  makeBlock, parseBlocksJson, renderBlocksToHtml,
} from './newsletter-blocks';

type Mode = 'list' | 'compose' | 'view';

const STATUS_LABELS: Record<NewsletterStatus, string> = {
  draft:     'Draft',
  scheduled: 'Scheduled',
  sending:   'Sending',
  sent:      'Sent',
  failed:    'Failed',
};

/**
 * Newsletter — campaigns list + block-based compose/edit/view.
 *
 *   /admin/newsletter            → list
 *   /admin/newsletter/new        → compose
 *   /admin/newsletter/:id        → view (read-only after send) / edit (drafts)
 *
 * Compose UX is a block builder (mirrors the hr-learning slide-blocks
 * pattern): a vertical list of typed blocks (heading / paragraph / image /
 * button / divider / spacer / raw HTML), each with its own editor, plus
 * up/down/delete controls. The "Add block" row at the bottom appends new
 * blocks. The right-hand pane lives-renders the blocks as inline-styled,
 * email-safe HTML via a `computed()` over the `blocks` signal — every
 * mutation goes through `blocks.set([...])` so the computed re-runs
 * (zoneless: signals are the source of truth).
 *
 * Persistence: on save the rendered HTML goes into `body_html` (used by
 * the existing send pipeline) and the block list serialises to
 * `blocks_json` (so editing reload reconstructs the builder). Legacy
 * campaigns with `blocks_json IS NULL` open as a single 'html' block
 * containing their original `body_html`.
 */
@Component({
  selector: 'app-newsletter-admin',
  imports: [FormsModule, RouterLink],
  template: `
    @if (mode() === 'list') {
      <div class="toolbar">
        <h1>Newsletter</h1>
        <span class="spacer"></span>
        <button class="ghost" (click)="processDue()" [disabled]="processing()" title="Manually fire any scheduled campaigns whose scheduled time has passed">
          {{ processing() ? 'Processing…' : 'Process due' }}
        </button>
        <button class="primary" routerLink="/admin/newsletter/new">+ New campaign</button>
      </div>

      @if (processResult()) { <div class="success-msg">{{ processResult() }}</div> }

      @if (campaigns().length === 0) {
        <div class="empty">
          <p class="muted">No campaigns yet.</p>
          <button class="primary" routerLink="/admin/newsletter/new">Compose your first newsletter</button>
        </div>
      } @else {
        <div class="table-wrap">
          <table class="data">
            <thead><tr>
              <th>Subject</th>
              <th>Audience</th>
              <th>Status</th>
              <th>Recipients</th>
              <th>Sent / Failed</th>
              <th>When</th>
              <th></th>
            </tr></thead>
            <tbody>
              @for (c of campaigns(); track c.id) {
                <tr (click)="open(c)">
                  <td><strong>{{ c.subject }}</strong></td>
                  <td>
                    @if (c.audience_clients) { <span class="badge">Clients</span> }
                    @if (c.audience_leads) { <span class="badge">Leads</span> }
                  </td>
                  <td>
                    <span class="status-pill" [attr.data-status]="c.status || 'draft'">
                      {{ statusLabel(c.status || 'draft') }}
                    </span>
                  </td>
                  <td>{{ c.recipient_count || '—' }}</td>
                  <td>
                    {{ c.sent_count || 0 }}@if (c.failed_count) { <span class="failed"> / {{ c.failed_count }} failed</span> }
                  </td>
                  <td>
                    @if (c.status === 'sent' && c.sent_at) { Sent {{ c.sent_at }} }
                    @else if (c.status === 'scheduled' && c.scheduled_at) { Scheduled {{ c.scheduled_at }} }
                    @else { {{ c.created_at }} }
                  </td>
                  <td class="actions">
                    <button class="ghost icon-btn danger" (click)="del(c, $event)" title="Delete" aria-label="Delete">✕</button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    }

    @if (mode() === 'compose' || mode() === 'view') {
      <div class="toolbar">
        <button class="ghost" routerLink="/admin/newsletter">← Back</button>
        <h1>{{ headerTitle() }}</h1>
        <span class="spacer"></span>
        @if (canEdit()) {
          <button class="ghost" (click)="save('draft')" [disabled]="saving()">{{ saving() ? 'Saving…' : 'Save draft' }}</button>
          <button class="ghost" (click)="openSchedule()" [disabled]="saving()">Schedule…</button>
          <button class="primary" (click)="sendNow()" [disabled]="saving() || sending()">
            {{ sending() ? 'Sending…' : '✉ Send now' }}
          </button>
        }
      </div>

      @if (errorMsg()) { <div class="error-msg">{{ errorMsg() }}</div> }
      @if (sendResult(); as r) {
        <div class="success-msg">
          ✓ Sent to {{ r.sent }} of {{ r.recipients }}.
          @if (r.failed) { <span class="failed">{{ r.failed }} failed.</span> }
          @if (r.last_error) { <div class="muted small mono">{{ r.last_error }}</div> }
        </div>
      }

      <div class="layout-2col">
        <div class="card form-pane">
          <h2>Campaign</h2>
          <label>Subject <span class="req">*</span></label>
          <input [value]="subject()" (input)="subject.set($any($event.target).value)" [disabled]="!canEdit()" placeholder="Spring update — May 2026" />

          <label>Audience</label>
          <div class="audience-row">
            <label class="check">
              <input type="checkbox" [checked]="audClients()" (change)="audClients.set($any($event.target).checked)" [disabled]="!canEdit()" />
              All clients
            </label>
            <label class="check">
              <input type="checkbox" [checked]="audLeads()" (change)="audLeads.set($any($event.target).checked)" [disabled]="!canEdit()" />
              All leads
            </label>
          </div>
          <label>Custom email list <span class="muted">(optional — comma, semicolon, or newline separated)</span></label>
          <textarea [value]="audCustom()" (input)="audCustom.set($any($event.target).value)" [disabled]="!canEdit()" rows="3" placeholder="alice@example.com, bob@example.com"></textarea>

          <div class="recipient-count">
            <span class="muted small">{{ recipientCountLabel() }}</span>
            @if (canEdit()) { <button class="ghost small" (click)="refreshPreview()" [disabled]="previewing()">{{ previewing() ? 'Counting…' : 'Refresh count' }}</button> }
          </div>

          <hr />

          <h2>Body</h2>
          <p class="muted small">Build the email out of typed blocks. The right-hand pane updates as you type. An unsubscribe footer is appended automatically when sending.</p>

          <div class="blocks">
            @for (b of blocks(); track b.id; let i = $index; let last = $last) {
              <div class="block">
                <div class="block-head">
                  <span class="kind-pill kind-{{ b.kind }}">{{ blockLabel(b.kind) }}</span>
                  <span class="spacer"></span>
                  @if (canEdit()) {
                    <button class="block-icon" (click)="moveBlock(b.id, -1)" [disabled]="i === 0" title="Move up">↑</button>
                    <button class="block-icon" (click)="moveBlock(b.id, 1)" [disabled]="last" title="Move down">↓</button>
                    <button class="block-icon danger" (click)="removeBlock(b.id)" title="Remove">✕</button>
                  }
                </div>

                @switch (b.kind) {
                  @case ('heading') {
                    <div class="row two">
                      <div class="field">
                        <label>Level</label>
                        <select [value]="b.level ?? 2" (change)="patch(b.id, { level: $any(+$any($event.target).value) })" [disabled]="!canEdit()">
                          <option [value]="1">H1 (largest)</option>
                          <option [value]="2">H2</option>
                          <option [value]="3">H3</option>
                        </select>
                      </div>
                      <div class="field">
                        <label>Align</label>
                        <select [value]="b.align ?? 'left'" (change)="patch(b.id, { align: $any($event.target).value })" [disabled]="!canEdit()">
                          <option value="left">Left</option>
                          <option value="center">Center</option>
                          <option value="right">Right</option>
                        </select>
                      </div>
                    </div>
                    <input [value]="b.text ?? ''" (input)="patch(b.id, { text: $any($event.target).value })" [disabled]="!canEdit()" placeholder="Heading text" />
                  }
                  @case ('paragraph') {
                    <div class="row two">
                      <div class="field">
                        <label>Align</label>
                        <select [value]="b.align ?? 'left'" (change)="patch(b.id, { align: $any($event.target).value })" [disabled]="!canEdit()">
                          <option value="left">Left</option>
                          <option value="center">Center</option>
                          <option value="right">Right</option>
                        </select>
                      </div>
                    </div>
                    <textarea rows="4" [value]="b.text ?? ''" (input)="patch(b.id, { text: $any($event.target).value })" [disabled]="!canEdit()" placeholder="Paragraph copy. Newlines become &lt;br&gt;."></textarea>
                  }
                  @case ('image') {
                    <label>Image URL</label>
                    <input [value]="b.url ?? ''" (input)="patch(b.id, { url: $any($event.target).value })" [disabled]="!canEdit()" placeholder="https://example.com/banner.png" />
                    <div class="row two">
                      <div class="field">
                        <label>Alt text</label>
                        <input [value]="b.alt ?? ''" (input)="patch(b.id, { alt: $any($event.target).value })" [disabled]="!canEdit()" placeholder="Describe the image" />
                      </div>
                      <div class="field">
                        <label>Click-through (optional)</label>
                        <input [value]="b.href ?? ''" (input)="patch(b.id, { href: $any($event.target).value })" [disabled]="!canEdit()" placeholder="https://example.com" />
                      </div>
                    </div>
                  }
                  @case ('button') {
                    <div class="row two">
                      <div class="field">
                        <label>Label</label>
                        <input [value]="b.label ?? ''" (input)="patch(b.id, { label: $any($event.target).value })" [disabled]="!canEdit()" placeholder="Learn more" />
                      </div>
                      <div class="field">
                        <label>Align</label>
                        <select [value]="b.align ?? 'left'" (change)="patch(b.id, { align: $any($event.target).value })" [disabled]="!canEdit()">
                          <option value="left">Left</option>
                          <option value="center">Center</option>
                          <option value="right">Right</option>
                        </select>
                      </div>
                    </div>
                    <label>URL</label>
                    <input [value]="b.url ?? ''" (input)="patch(b.id, { url: $any($event.target).value })" [disabled]="!canEdit()" placeholder="https://example.com" />
                  }
                  @case ('divider') {
                    <p class="muted small no-margin">A horizontal rule. No options.</p>
                  }
                  @case ('spacer') {
                    <label>Height (px)</label>
                    <input type="number" min="0" max="200" [value]="b.height ?? 24" (input)="patch(b.id, { height: +$any($event.target).value })" [disabled]="!canEdit()" />
                  }
                  @case ('html') {
                    <p class="muted small no-margin">Raw HTML — pasted as-is. Use sparingly; keep styles inline.</p>
                    <textarea rows="6" class="mono" [value]="b.html ?? ''" (input)="patch(b.id, { html: $any($event.target).value })" [disabled]="!canEdit()"></textarea>
                  }
                }
              </div>
            }
            @if (blocks().length === 0) {
              <p class="muted small">No blocks yet — add one below to start building this email.</p>
            }
          </div>

          @if (canEdit()) {
            <div class="add-row">
              <span class="muted small">Add block:</span>
              @for (k of allBlockKinds; track k) {
                <button class="add-btn" (click)="addBlock(k)">+ {{ blockLabel(k) }}</button>
              }
            </div>
          }
        </div>

        <div class="card preview-pane">
          <h2>Live preview</h2>
          @if (blocks().length > 0) {
            <div class="preview-frame">
              <div class="preview" [innerHTML]="previewHtml()"></div>
            </div>
          } @else {
            <p class="muted">Add a block on the left to see a live render here.</p>
          }
        </div>
      </div>

      @if (mode() === 'view' && recipientRows().length > 0) {
        <div class="card">
          <h2>Send log</h2>
          <div class="table-wrap">
            <table class="data">
              <thead><tr>
                <th>Email</th><th>Name</th><th>Source</th><th>Status</th><th>Sent at</th><th>Error</th>
              </tr></thead>
              <tbody>
                @for (r of recipientRows(); track r.id) {
                  <tr>
                    <td><code>{{ r.email }}</code></td>
                    <td>{{ r.name || '—' }}</td>
                    <td>{{ r.source }}</td>
                    <td><span class="status-pill" [attr.data-rstatus]="r.status">{{ r.status }}</span></td>
                    <td>{{ r.sent_at || '—' }}</td>
                    <td class="error-cell">{{ r.error_msg || '' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }

      @if (showSchedule()) {
        <div class="modal-backdrop" (click)="cancelSchedule()">
          <div class="modal" (click)="$event.stopPropagation()">
            <h2>Schedule send</h2>
            <label>When (your local time)</label>
            <input type="datetime-local" [value]="scheduleAt()" (input)="scheduleAt.set($any($event.target).value)" />
            <p class="muted small">Scheduled campaigns fire when <code>Process due</code> runs (manually from the list, or via cron — see admin docs).</p>
            <div class="row">
              <span class="spacer"></span>
              <button class="ghost" (click)="cancelSchedule()">Cancel</button>
              <button class="primary" (click)="confirmSchedule()" [disabled]="!scheduleAt() || saving()">Schedule</button>
            </div>
          </div>
        </div>
      }
    }
  `,
  styles: [`
    :host { display: block; }
    .layout-2col { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; padding-top: 16px; }
    @media (max-width: 1100px) { .layout-2col { grid-template-columns: minmax(0, 1fr); } }
    .form-pane label { margin-top: 12px; }
    .audience-row { display: flex; gap: 16px; margin: 6px 0 4px 0; }
    .audience-row label.check {
      display: flex; align-items: center; gap: 6px;
      margin: 0; color: var(--fg);
      font-size: 13px; text-transform: none; letter-spacing: 0;
      cursor: pointer;
    }
    .recipient-count { display: flex; align-items: center; gap: 12px; margin-top: 10px; }

    /* Blocks (mirrors hr-learning's slide-block pattern) */
    .blocks { display: flex; flex-direction: column; gap: 10px; margin-top: 8px; }
    .block {
      background: var(--bg-3);
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      padding: 10px 12px 12px 12px;
    }
    .block-head { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
    .block-head .spacer { flex: 1; }
    .kind-pill {
      display: inline-block; padding: 2px 8px;
      border-radius: 999px; font-size: 11px; text-transform: uppercase;
      letter-spacing: 0.5px;
      background: var(--bg-2); color: var(--muted);
      border: 1px solid var(--line);
    }
    .block-icon {
      background: transparent; border: none;
      color: var(--muted); padding: 2px 6px;
      cursor: pointer; font-size: 13px;
      border-radius: var(--radius-sm);
    }
    .block-icon:hover { background: var(--bg-2); color: var(--fg); }
    .block-icon.danger:hover { color: var(--danger); }
    .block-icon:disabled { opacity: 0.3; cursor: not-allowed; }

    .row.two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .field { display: flex; flex-direction: column; gap: 4px; }
    .field label { margin-top: 0; }
    .no-margin { margin: 0 0 4px 0; }
    .mono { font-family: "JetBrains Mono", monospace; font-size: 13px; }

    .add-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 12px; }
    .add-btn {
      background: var(--bg-3); color: var(--fg);
      border: 1px solid var(--line);
      padding: 5px 10px; border-radius: var(--radius-sm);
      font-size: 12px; cursor: pointer;
    }
    .add-btn:hover { border-color: var(--primary); color: var(--primary); }

    /* Preview pane — light frame to mimic email-client chrome */
    .preview-frame {
      background: #f3f4f6;
      padding: 16px;
      border-radius: var(--radius-sm);
      max-height: 720px; overflow-y: auto;
    }
    .preview-pane .preview { background: transparent; }
    .preview-pane .preview * { max-width: 100%; }

    /* Status pills (shared with list view) */
    .badge {
      display: inline-block; padding: 2px 8px; margin-right: 4px;
      border-radius: 999px; font-size: 11px;
      background: var(--bg-3); color: var(--muted);
      border: 1px solid var(--line);
    }
    .status-pill {
      display: inline-block; padding: 2px 10px;
      border-radius: 999px; font-size: 11px; text-transform: uppercase;
      letter-spacing: 0.5px;
      border: 1px solid var(--line);
      color: var(--muted);
    }
    .status-pill[data-status="draft"]     { color: var(--muted); }
    .status-pill[data-status="scheduled"] { color: var(--primary); border-color: var(--primary); }
    .status-pill[data-status="sending"]   { color: var(--primary); border-color: var(--primary); }
    .status-pill[data-status="sent"]      { color: var(--success); border-color: var(--success); }
    .status-pill[data-status="failed"]    { color: var(--danger); border-color: var(--danger); }
    .status-pill[data-rstatus="sent"]     { color: var(--success); border-color: var(--success); }
    .status-pill[data-rstatus="failed"]   { color: var(--danger); border-color: var(--danger); }
    .status-pill[data-rstatus="suppressed"] { color: var(--warning, var(--muted)); }

    .failed { color: var(--danger); }
    .error-cell {
      max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      font-family: "JetBrains Mono", monospace; font-size: 12px;
    }
    .req { color: var(--primary); margin-left: 2px; }
    code { font-family: "JetBrains Mono", monospace; font-size: 12px; }

    /* Schedule modal */
    .modal-backdrop {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.6);
      display: flex; align-items: center; justify-content: center;
      z-index: 1000;
    }
    .modal {
      background: var(--bg-2);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 24px;
      width: 420px; max-width: 90vw;
      box-shadow: var(--shadow);
    }
    .modal label { margin-top: 8px; }
  `],
})
export class NewsletterAdmin {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private sanitizer = inject(DomSanitizer);

  mode = signal<Mode>('list');
  campaigns = signal<NewsletterCampaign[]>([]);
  draftId = signal<number | null>(null);
  status = signal<NewsletterStatus>('draft');

  // Scalar form state lives in signals so the live preview computed re-runs
  // on every keystroke. Plain class properties don't trigger re-evaluation
  // in zoneless mode (see memory.md → Zoneless gotchas).
  subject = signal('');
  audClients = signal(true);
  audLeads = signal(true);
  audCustom = signal('');
  scheduledAt = signal<string | null>(null);

  blocks = signal<NewsletterBlock[]>([]);

  saving = signal(false);
  sending = signal(false);
  previewing = signal(false);
  processing = signal(false);

  errorMsg = signal<string | null>(null);
  processResult = signal<string | null>(null);
  sendResult = signal<{ sent: number; failed: number; recipients: number; last_error: string | null } | null>(null);

  recipientPreviewCount = signal<number | null>(null);
  recipientRows = signal<NewsletterRecipient[]>([]);

  showSchedule = signal(false);
  scheduleAt = signal('');

  readonly allBlockKinds: NewsletterBlockKind[] = ['heading', 'paragraph', 'image', 'button', 'divider', 'spacer', 'html'];
  blockLabel = (k: NewsletterBlockKind) => BLOCK_LABELS[k];
  statusLabel = (s: NewsletterStatus): string => STATUS_LABELS[s] || s;

  canEdit = computed<boolean>(() => {
    if (this.mode() === 'compose') {
      const s = this.status();
      return s === 'draft' || s === 'scheduled';
    }
    return false;
  });

  headerTitle = computed(() => {
    if (this.mode() === 'compose' && !this.draftId()) return 'New campaign';
    if (this.mode() === 'view') return this.subject() || 'Campaign';
    return this.subject() || 'Edit campaign';
  });

  recipientCountLabel = computed(() => {
    const n = this.recipientPreviewCount();
    if (n === null) return 'Recipient count not yet computed.';
    if (n === 0) return 'No matching recipients (after de-dup + suppression list).';
    return `${n} unique recipient${n === 1 ? '' : 's'} after de-dup and suppression.`;
  });

  /** Re-runs whenever `blocks()` changes — that's the whole point of moving
   *  block edits through `signal.set([...])`. */
  previewHtml = computed<SafeHtml>(() => {
    const html = renderBlocksToHtml(this.blocks());
    return this.sanitizer.bypassSecurityTrustHtml(html);
  });

  constructor() {
    this.route.url.subscribe(() => this.routeToMode());
    this.route.params.subscribe(() => this.routeToMode());
    this.loadCampaigns();
  }

  private routeToMode() {
    const url = this.router.url;
    if (url.endsWith('/admin/newsletter') || url.startsWith('/admin/newsletter?')) {
      this.mode.set('list');
      this.resetForm();
      return;
    }
    if (url.endsWith('/admin/newsletter/new')) {
      this.mode.set('compose');
      this.resetForm();
      return;
    }
    const m = /\/admin\/newsletter\/(\d+)/.exec(url);
    if (m) {
      const id = Number(m[1]);
      this.api.getCampaign(id).subscribe(r => this.loadCampaignIntoForm(r.campaign, id));
    }
  }

  private resetForm() {
    this.draftId.set(null);
    this.subject.set('');
    this.audClients.set(true);
    this.audLeads.set(true);
    this.audCustom.set('');
    this.scheduledAt.set(null);
    this.status.set('draft');
    this.blocks.set([]);
    this.errorMsg.set(null);
    this.sendResult.set(null);
    this.recipientPreviewCount.set(null);
    this.recipientRows.set([]);
  }

  private loadCampaignIntoForm(c: NewsletterCampaign, id: number) {
    this.draftId.set(id);
    this.subject.set(c.subject || '');
    this.audClients.set(!!c.audience_clients);
    this.audLeads.set(!!c.audience_leads);
    this.audCustom.set(c.audience_custom_emails || '');
    this.scheduledAt.set(c.scheduled_at || null);
    this.status.set((c.status as NewsletterStatus) || 'draft');
    // Restore blocks from blocks_json; legacy drafts (NULL) become a single
    // 'html' block so they open in the builder without losing content.
    const fromJson = parseBlocksJson(c.blocks_json ?? null);
    if (fromJson.length > 0) {
      this.blocks.set(fromJson);
    } else if (c.body_html) {
      this.blocks.set([{ ...makeBlock('html'), html: c.body_html }]);
    } else {
      this.blocks.set([]);
    }
    this.mode.set(this.canEdit() ? 'compose' : 'view');
    if (!this.canEdit()) this.loadRecipients(id);
  }

  private loadCampaigns() {
    this.api.listCampaigns().subscribe(r => this.campaigns.set(r.campaigns));
  }
  private loadRecipients(id: number) {
    this.api.getCampaignRecipients(id).subscribe(r => this.recipientRows.set(r.recipients));
  }

  open(c: NewsletterCampaign) { this.router.navigate(['/admin/newsletter', c.id]); }
  del(c: NewsletterCampaign, e: Event) {
    e.stopPropagation();
    if (!confirm(`Delete campaign "${c.subject}"?`)) return;
    this.api.deleteCampaign(c.id!).subscribe(() => this.loadCampaigns());
  }

  // ───── Block editing ─────────────────────────────────────────────
  addBlock(kind: NewsletterBlockKind) {
    this.blocks.set([...this.blocks(), makeBlock(kind)]);
  }
  removeBlock(id: string) {
    this.blocks.set(this.blocks().filter(b => b.id !== id));
  }
  moveBlock(id: string, delta: -1 | 1) {
    const arr = [...this.blocks()];
    const idx = arr.findIndex(b => b.id === id);
    const swap = idx + delta;
    if (idx < 0 || swap < 0 || swap >= arr.length) return;
    [arr[idx], arr[swap]] = [arr[swap], arr[idx]];
    this.blocks.set(arr);
  }
  /** Immutable patch — mutating a block's property on the existing object
   *  reference would not retrigger the preview computed in zoneless mode. */
  patch(id: string, fields: Partial<NewsletterBlock>) {
    this.blocks.set(this.blocks().map(b => b.id === id ? { ...b, ...fields } : b));
  }

  // ───── Save / Send / Schedule ───────────────────────────────────
  refreshPreview() {
    if (!this.draftId()) {
      this.save('draft', () => this.refreshPreview());
      return;
    }
    this.previewing.set(true);
    this.api.previewCampaignRecipients(this.draftId()!, {
      audience_clients:        this.audClients(),
      audience_leads:          this.audLeads(),
      audience_custom_emails:  this.audCustom() || '',
    }).subscribe({
      next: r => { this.previewing.set(false); this.recipientPreviewCount.set(r.count); },
      error: e => { this.previewing.set(false); this.errorMsg.set(e?.error?.error || 'Preview failed'); },
    });
  }

  save(targetStatus: 'draft' | 'scheduled', cb?: () => void) {
    this.errorMsg.set(null);
    if (!this.subject().trim()) {
      this.errorMsg.set('Subject is required.');
      return;
    }
    this.saving.set(true);
    const renderedHtml = renderBlocksToHtml(this.blocks());
    const blocksJson   = JSON.stringify(this.blocks());
    const payload: Partial<NewsletterCampaign> = {
      subject:                 this.subject().trim(),
      body_html:               renderedHtml,
      blocks_json:             blocksJson,
      audience_clients:        this.audClients(),
      audience_leads:          this.audLeads(),
      audience_custom_emails:  this.audCustom() || null,
      status:                  targetStatus,
      scheduled_at:            targetStatus === 'scheduled' ? this.scheduledAt() : null,
    };
    const after = (id: number) => {
      this.saving.set(false);
      this.draftId.set(id);
      this.status.set(targetStatus);
      cb?.();
    };
    if (this.draftId()) {
      this.api.updateCampaign(this.draftId()!, payload).subscribe({
        next: () => after(this.draftId()!),
        error: e => { this.saving.set(false); this.errorMsg.set(e?.error?.error || 'Save failed'); },
      });
    } else {
      this.api.createCampaign(payload).subscribe({
        next: r => {
          this.router.navigate(['/admin/newsletter', r.id], { replaceUrl: true });
          after(r.id);
        },
        error: e => { this.saving.set(false); this.errorMsg.set(e?.error?.error || 'Save failed'); },
      });
    }
  }

  sendNow() {
    if (!confirm('Send this campaign now? This cannot be undone.')) return;
    const dispatch = (id: number) => {
      this.sending.set(true);
      this.errorMsg.set(null);
      this.sendResult.set(null);
      this.api.sendCampaign(id).subscribe({
        next: r => {
          this.sending.set(false);
          this.sendResult.set(r);
          this.api.getCampaign(id).subscribe(g => this.loadCampaignIntoForm(g.campaign, id));
        },
        error: e => { this.sending.set(false); this.errorMsg.set(e?.error?.error || 'Send failed'); },
      });
    };
    if (this.draftId()) dispatch(this.draftId()!);
    else this.save('draft', () => dispatch(this.draftId()!));
  }

  openSchedule() {
    this.scheduleAt.set(this.scheduledAt() || '');
    this.showSchedule.set(true);
  }
  cancelSchedule() { this.showSchedule.set(false); }
  confirmSchedule() {
    const when = this.scheduleAt();
    if (!when) return;
    const dispatch = (id: number) => {
      const mysql = when.replace('T', ' ').slice(0, 19);
      this.api.scheduleCampaign(id, mysql).subscribe({
        next: () => {
          this.showSchedule.set(false);
          this.status.set('scheduled');
          this.scheduledAt.set(mysql);
          this.loadCampaigns();
        },
        error: e => this.errorMsg.set(e?.error?.error || 'Schedule failed'),
      });
    };
    if (this.draftId()) dispatch(this.draftId()!);
    else this.save('draft', () => dispatch(this.draftId()!));
  }

  processDue() {
    this.processing.set(true);
    this.processResult.set(null);
    this.api.processDueCampaigns().subscribe({
      next: r => {
        this.processing.set(false);
        const n = r.processed.length;
        this.processResult.set(n === 0 ? 'No campaigns due.' : `Processed ${n} campaign${n === 1 ? '' : 's'}.`);
        this.loadCampaigns();
      },
      error: () => this.processing.set(false),
    });
  }
}
