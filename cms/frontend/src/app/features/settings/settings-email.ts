import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { DialogService } from '../../core/dialog';
import { EmailProvider, EmailProviderKind, EmailPurpose, EmailRouting } from '../../core/models';

/**
 * Settings → Email tab.
 *
 * Two subsections:
 *   1. Providers — list every configured email provider for the tenant.
 *      Add/edit/delete via the modal below the table. Secrets are never
 *      returned by the API — the credential inputs show "(set — leave
 *      blank to keep)" when a value already exists so re-entering isn't
 *      required just to change from_email.
 *   2. Routing — four purposes (newsletter, system, invite, internal),
 *      each with a dropdown of providers. Saved with one click at the
 *      bottom of the section.
 *
 * A Test send button per provider hits POST /email/providers/:id/test
 * with a target address and shows the result inline.
 */

interface ProviderKindMeta {
  key: EmailProviderKind;
  label: string;
  hint: string;
  fields: ('api_key' | 'api_secret' | 'aws_region' | 'mailgun_domain' | 'smtp')[];
  /** Direct link to the provider's signup / account page. */
  signupUrl?: string;
  /** Human-readable free-tier summary. When set, a green "Free" badge
   *  appears next to the provider so tenants know they can start
   *  without a credit card. `null` = paid only. */
  freeTier?: string | null;
  tier?: 'transactional' | 'personal';
}

const KINDS: ProviderKindMeta[] = [
  { key: 'postmark',   label: 'Postmark',      hint: 'Transactional-focused. Best deliverability at low volume.',                    fields: ['api_key'],                              tier: 'transactional', signupUrl: 'https://postmarkapp.com/sign_up',              freeTier: null },
  { key: 'resend',     label: 'Resend',        hint: 'Developer-friendly. Modern API + React templates.',                            fields: ['api_key'],                              tier: 'transactional', signupUrl: 'https://resend.com/signup',                    freeTier: '3,000/mo (100/day)' },
  { key: 'sendgrid',   label: 'SendGrid',      hint: 'Marketing + transactional. Widely integrated, big scale.',                     fields: ['api_key'],                              tier: 'transactional', signupUrl: 'https://signup.sendgrid.com/',                 freeTier: '100/day' },
  { key: 'brevo',      label: 'Brevo',         hint: 'EU-based. No credit card for the free tier — easiest start.',                  fields: ['api_key'],                              tier: 'transactional', signupUrl: 'https://www.brevo.com/free-smtp-server/',      freeTier: '300/day' },
  { key: 'mailersend', label: 'MailerSend',    hint: 'Solid transactional API. Free forever tier — no card required.',              fields: ['api_key'],                              tier: 'transactional', signupUrl: 'https://www.mailersend.com/signup',            freeTier: '3,000/mo' },
  { key: 'mailgun',    label: 'Mailgun',       hint: 'Requires a verified sending domain. 3-month trial then paid.',                 fields: ['api_key', 'mailgun_domain'],            tier: 'transactional', signupUrl: 'https://signup.mailgun.com/',                  freeTier: null },
  { key: 'ses',        label: 'Amazon SES',    hint: 'Cheapest at scale (~$0.10 per 1000). SES SMTP creds + AWS region.',            fields: ['api_key', 'api_secret', 'aws_region'], tier: 'transactional',  signupUrl: 'https://console.aws.amazon.com/ses/home',      freeTier: null },
  { key: 'smtp',       label: 'SMTP (custom)', hint: 'Any SMTP server — cPanel mailbox, Google Workspace, Office 365, self-hosted.', fields: ['smtp'],                                 tier: 'transactional', signupUrl: undefined,                                       freeTier: null },
];

const PURPOSES: { key: EmailPurpose; label: string; hint: string }[] = [
  { key: 'newsletter', label: 'Newsletters',           hint: 'Bulk campaigns from the Newsletter builder.' },
  { key: 'system',     label: 'System emails',         hint: 'Password resets, email verification, generic system mails.' },
  { key: 'invite',     label: 'Invite links',          hint: 'Onboarding portal invites (client / HR / recruitment).' },
  { key: 'internal',   label: 'Internal notifications', hint: 'Alerts to admin users — form submits, task assignments.' },
];

@Component({
  selector: 'app-settings-email',
  imports: [FormsModule],
  template: `
    <!-- System-fallback banner. Three states, escalating in urgency:
         - Info (grace > 7 days) — informational reminder
         - Warning (grace ≤ 7 days) — amber, days-left front and centre
         - Expired — red, sends will fail until a provider is configured -->
    @if (systemFallbackEnabled()) {
      @if (fallbackExpired()) {
        <div class="fallback-banner expired">
          <strong>System fallback expired.</strong>
          Your grace period for using BuiltRightStudio's mail server has
          ended. Configure a provider below and set at least one routing
          rule — outbound email is currently failing.
        </div>
      } @else if ((graceDaysLeft() ?? 999) <= 7) {
        <div class="fallback-banner warning">
          <strong>{{ graceDaysLeft() }} day{{ graceDaysLeft() === 1 ? '' : 's' }} left on your email grace period.</strong>
          Unrouted emails go through BuiltRightStudio's mail server until
          then. After that, sending will fail until you configure a provider
          — pick one below and hit Sign up ↗ if you don't have an account yet.
        </div>
      } @else {
        <div class="fallback-banner info">
          <strong>System fallback active — {{ graceDaysLeft() }} days remaining.</strong>
          Emails go through BuiltRightStudio's mail server until you
          configure your own provider. Deliverability and reputation
          during this window are on us, not your domain — set up a
          provider below to move to your own reputation.
        </div>
      }
    }

    <section>
      <h2>Providers</h2>
      <p class="muted small">
        Configure one or more email providers. You can point different email
        purposes at different providers below — e.g. Postmark for password
        resets, SES for newsletters.
      </p>

      @if (loading()) {
        <p class="muted small">Loading…</p>
      } @else if (providers().length === 0) {
        <div class="empty-card">
          <p class="muted">No providers configured yet.</p>
          <button class="primary" (click)="openAdd()">+ Add provider</button>
        </div>
      } @else {
        <!-- Card list — collapsed rows show just the identity + status;
             clicking anywhere on the header expands to reveal hint,
             from-address, last test detail, and any per-provider notes.
             Same interaction as the Feedback tabs elsewhere. -->
        <div class="prov-list">
          @for (p of providers(); track p.id) {
            <div class="prov-row" [class.open]="expandedProvider() === p.id"
                 [class.dim]="statusFor(p) === 'not_configured'">
              <div class="prov-head" (click)="toggleProviderRow(p.id)">
                <span class="caret">›</span>
                <div class="prov-meta">
                  <strong>{{ p.name }}</strong>
                  <span class="status-pill" [attr.data-status]="statusFor(p)">{{ statusLabel(p) }}</span>
                  @if (freeTierFor(p.provider)) {
                    <span class="free-badge inline">Free: {{ freeTierFor(p.provider) }}</span>
                  }
                </div>
                <div class="prov-actions" (click)="$event.stopPropagation()">
                  @if (statusFor(p) === 'not_configured') {
                    @if (signupUrlFor(p.provider)) {
                      <a class="ghost small signup-link" [href]="signupUrlFor(p.provider)"
                         target="_blank" rel="noopener">Sign up ↗</a>
                    }
                    <button class="primary small" (click)="openEdit(p)">Configure</button>
                  } @else {
                    <button class="ghost small" (click)="openTest(p)" title="Send a test email">Test</button>
                    <button class="ghost small" (click)="openEdit(p)" title="Edit credentials">Edit</button>
                    <button class="ghost icon-btn danger" (click)="del(p)" title="Delete">✕</button>
                  }
                </div>
              </div>
              @if (expandedProvider() === p.id) {
                <div class="prov-body">
                  <p class="muted small" style="margin-top: 0;">{{ kindHintFor(p.provider) }}</p>

                  <div class="prov-facts">
                    @if (p.from_email) {
                      <div class="fact">
                        <label>From address</label>
                        <div class="mono">{{ p.from_email }}</div>
                        @if (p.from_name) { <div class="muted small">{{ p.from_name }}</div> }
                      </div>
                    } @else {
                      <div class="fact">
                        <label>From address</label>
                        <div class="muted small">Not set — click Configure to add one</div>
                      </div>
                    }
                    <div class="fact">
                      <label>Last test</label>
                      @if (p.last_test_at) {
                        @if (p.last_test_ok) {
                          <div class="test-ok">✓ {{ p.last_test_at }}</div>
                        } @else {
                          <div class="test-fail" [title]="p.last_test_error || ''">✗ {{ p.last_test_at }}</div>
                        }
                        @if (!p.last_test_ok && p.last_test_error) {
                          <div class="muted small">{{ p.last_test_error }}</div>
                        }
                      } @else {
                        <div class="muted small">Never tested</div>
                      }
                    </div>
                    @if (isPersonalSmtp(p)) {
                      <div class="fact fact-warn">
                        <label>Note</label>
                        <div>Personal mailbox — 300–500/day cap. Not suitable for newsletters.</div>
                      </div>
                    }
                  </div>
                </div>
              }
            </div>
          }
        </div>
        <div class="tab-actions">
          <button class="primary" (click)="openAdd()">+ Add provider</button>
        </div>
      }
    </section>

    <hr />

    <section>
      <h2>Routing</h2>
      <p class="muted small">
        Pick which provider handles each type of email. Purposes left on
        "— use system default —" fall back to the legacy configuration.
      </p>

      @for (row of purposes; track row.key) {
        <div class="route-row">
          <div class="route-info">
            <strong>{{ row.label }}</strong>
            <span class="muted small">{{ row.hint }}</span>
          </div>
          <select [ngModel]="routing()[row.key]"
                  (ngModelChange)="setRoute(row.key, $event)"
                  [name]="'route_' + row.key">
            <option [ngValue]="null">— use system default —</option>
            @for (p of activeProviders(); track p.id) {
              <option [ngValue]="p.id">{{ p.name }} ({{ kindLabel(p.provider) }})</option>
            }
          </select>
        </div>
      }

      <div class="tab-actions">
        <button class="primary" (click)="saveRouting()" [disabled]="savingRouting()">
          {{ savingRouting() ? 'Saving…' : 'Save routing' }}
        </button>
        @if (routingMsg()) { <span class="success-msg small">{{ routingMsg() }}</span> }
      </div>
    </section>

    <!-- ── Add / Edit provider modal ─────────────────────────── -->
    @if (modalOpen()) {
      <div class="modal-backdrop" (click)="closeModal()">
        <div class="modal wide" (click)="$event.stopPropagation()">
          <div class="modal-head">
            <h2>{{ draft.id ? 'Edit provider' : 'Add provider' }}</h2>
            <button class="ghost icon-btn" (click)="closeModal()">✕</button>
          </div>
          <div class="modal-body">
            @if (modalError()) { <p class="error-msg">{{ modalError() }}</p> }

            <label>Provider</label>
            <select [(ngModel)]="draft.provider" name="prov" [disabled]="!!draft.id">
              @for (k of kinds; track k.key) {
                <option [value]="k.key">{{ k.label }}{{ k.freeTier ? ' — free tier available' : '' }}</option>
              }
            </select>
            <div class="kind-hint">
              <p class="muted small no-margin">{{ currentKindMeta().hint }}</p>
              <div class="kind-meta">
                @if (currentKindMeta().freeTier) {
                  <span class="free-badge">Free: {{ currentKindMeta().freeTier }}</span>
                }
                @if (currentKindMeta().signupUrl) {
                  <a [href]="currentKindMeta().signupUrl" target="_blank" rel="noopener"
                     class="signup-link">Sign up at {{ signupHostLabel() }} ↗</a>
                }
              </div>
            </div>

            <label>Display name</label>
            <input [(ngModel)]="draft.name" name="name" placeholder="e.g. Postmark — Main" />

            <div class="row two-col">
              <div>
                <label>From email</label>
                <input type="email" [(ngModel)]="draft.from_email" name="fe" placeholder="hello@builtrightstudio.com" />
              </div>
              <div>
                <label>From name</label>
                <input [(ngModel)]="draft.from_name" name="fn" placeholder="BuiltRightStudio" />
              </div>
            </div>

            <label>Reply-to (optional)</label>
            <input type="email" [(ngModel)]="draft.reply_to" name="rt" placeholder="support@builtrightstudio.com" />

            <hr />

            <!-- API key style providers (postmark / resend / sendgrid / brevo) -->
            @if (needs('api_key') && !needs('smtp')) {
              <label>API key {{ credHint('has_api_key') }}</label>
              <input type="password" [(ngModel)]="draft.api_key" name="ak" [placeholder]="apiKeyPlaceholder()" />
            }
            @if (needs('mailgun_domain')) {
              <label>Mailgun domain</label>
              <input [(ngModel)]="draft.mailgun_domain" name="mg" placeholder="mg.builtrightstudio.com" />
            }
            @if (needs('aws_region')) {
              <div class="row two-col">
                <div>
                  <label>SMTP username (SES) {{ credHint('has_api_key') }}</label>
                  <input [(ngModel)]="draft.api_key" name="sesu" placeholder="AKIA…" />
                </div>
                <div>
                  <label>SMTP password (SES) {{ credHint('has_api_secret') }}</label>
                  <input type="password" [(ngModel)]="draft.api_secret" name="sesp" [placeholder]="draft.has_api_secret ? '•••• (leave blank to keep)' : 'BM…'" />
                </div>
              </div>
              <label>AWS region</label>
              <input [(ngModel)]="draft.aws_region" name="reg" placeholder="eu-west-1" />
            }
            @if (needs('smtp')) {
              <div class="row two-col">
                <div>
                  <label>SMTP host</label>
                  <input [(ngModel)]="draft.smtp_host" name="sh" placeholder="smtp.gmail.com" />
                </div>
                <div>
                  <label>SMTP port</label>
                  <input type="number" [(ngModel)]="draft.smtp_port" name="sp" placeholder="587" />
                </div>
              </div>
              <label>Encryption</label>
              <select [(ngModel)]="draft.smtp_encryption" name="se">
                <option value="tls">STARTTLS (587)</option>
                <option value="ssl">SSL (465)</option>
                <option value="none">None</option>
              </select>
              <div class="row two-col">
                <div>
                  <label>SMTP username</label>
                  <input [(ngModel)]="draft.smtp_user" name="su" />
                </div>
                <div>
                  <label>SMTP password {{ credHint('has_smtp_password') }}</label>
                  <input type="password" [(ngModel)]="draft.smtp_password" name="spw" [placeholder]="draft.has_smtp_password ? '•••• (leave blank to keep)' : ''" />
                </div>
              </div>
            }

            <label class="inline-toggle">
              <input type="checkbox" [(ngModel)]="draft.is_active" name="act" />
              Active — available for routing
            </label>

            <div class="advanced-toggle">
              <button type="button" class="ghost small" (click)="advancedOpen.set(!advancedOpen())">
                {{ advancedOpen() ? '▾' : '▸' }} Advanced (custom headers)
              </button>
            </div>
            @if (advancedOpen()) {
              <p class="muted small">
                Add outgoing MIME headers as JSON. Common uses:
                <code>List-Unsubscribe</code> on newsletters,
                <code>X-Campaign-Id</code> for tracking. Leave empty for
                the sensible defaults.
              </p>
              <textarea rows="5" class="mono"
                [(ngModel)]="draft.custom_headers_json" name="hdrs"
                placeholder='&#123;&#10;  "List-Unsubscribe": "&lt;mailto:unsub@example.com&gt;",&#10;  "X-Campaign-Id": "monthly-roadmap"&#10;&#125;'></textarea>
              @if (headerJsonError()) { <p class="error-msg small">{{ headerJsonError() }}</p> }
            }
          </div>
          <div class="modal-foot">
            <button class="ghost" (click)="closeModal()">Cancel</button>
            <button class="primary" (click)="save()" [disabled]="saving()">
              {{ saving() ? 'Saving…' : (draft.id ? 'Update' : 'Add') }}
            </button>
          </div>
        </div>
      </div>
    }

    <!-- ── Test send modal ───────────────────────────────────── -->
    @if (testOpen()) {
      <div class="modal-backdrop" (click)="testOpen.set(false)">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-head">
            <h2>Test send — {{ testProvider()?.name }}</h2>
            <button class="ghost icon-btn" (click)="testOpen.set(false)">✕</button>
          </div>
          <div class="modal-body">
            <p class="muted small" style="margin-top: 0;">
              Sends a test email using the stored credentials. Result is
              recorded on the provider row and shown in the Last test column.
            </p>
            <label>Send to</label>
            <input type="email" [(ngModel)]="testTo" name="testto" placeholder="you@example.com" />
            @if (testResult()) {
              <div [class]="testResult()!.ok ? 'success-msg' : 'error-msg'" style="margin-top: 12px;">
                {{ testResult()!.ok ? ('✓ Sent to ' + testResult()!.sent_to) : ('✗ ' + testResult()!.error) }}
              </div>
            }
          </div>
          <div class="modal-foot">
            <button class="ghost" (click)="testOpen.set(false)">Close</button>
            <button class="primary" (click)="doTest()" [disabled]="testing() || !testTo.trim()">
              {{ testing() ? 'Sending…' : 'Send test' }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    hr { border: none; border-top: 1px solid var(--line); margin: 28px 0; }
    section h2 { margin: 0 0 4px; font-size: 16px; font-weight: 600; }
    section > p.muted.small { margin-top: 0; }

    /* System fallback banner — three severity levels driven by the
       grace window remaining. Info (blue-grey) until 7 days out, then
       warning (amber), then expired (red). */
    .fallback-banner {
      padding: 12px 14px; margin-bottom: 18px;
      border-radius: var(--radius-sm);
      color: var(--fg); font-size: 13px; line-height: 1.5;
    }
    .fallback-banner.info {
      background: color-mix(in oklab, var(--primary), transparent 88%);
      border: 1px solid color-mix(in oklab, var(--primary), transparent 62%);
    }
    .fallback-banner.info strong { color: var(--primary); }
    .fallback-banner.warning {
      background: color-mix(in oklab, var(--warning), transparent 82%);
      border: 1px solid color-mix(in oklab, var(--warning), transparent 55%);
    }
    .fallback-banner.warning strong { color: var(--warning); }
    .fallback-banner.expired {
      background: color-mix(in oklab, var(--danger), transparent 82%);
      border: 1px solid color-mix(in oklab, var(--danger), transparent 55%);
    }
    .fallback-banner.expired strong { color: var(--danger); }

    /* Kind hint block in the modal — free-tier badge + signup link. */
    .kind-hint { margin-top: 4px; }
    .kind-hint .no-margin { margin: 0; }
    .kind-meta { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 6px;
      align-items: center; }
    .free-badge {
      display: inline-block; padding: 2px 10px; border-radius: 999px;
      font-size: 11px; font-weight: 700; letter-spacing: 0.3px;
      background: color-mix(in oklab, var(--success), transparent 78%);
      color: var(--success); white-space: nowrap;
    }
    .signup-link {
      color: var(--primary); text-decoration: none;
      font-size: 12px; font-weight: 500; white-space: nowrap;
    }
    .signup-link:hover { text-decoration: underline; }

    .empty-card { padding: 24px; text-align: center;
      border: 1px dashed var(--line); border-radius: var(--radius-sm);
      background: var(--bg-2); }
    .empty-card p { margin: 0 0 12px; }

    /* Providers as an expandable card list — collapsed rows keep the
       identity + status + primary action on a single line so all 8
       providers scan cleanly; clicking a header reveals the hint text,
       from-address, last test detail, and any per-provider notes. */
    .prov-list { display: flex; flex-direction: column; gap: 6px; }
    .prov-row {
      border: 1px solid var(--line); border-radius: var(--radius-sm);
      background: var(--bg); overflow: hidden;
    }
    .prov-row.dim { opacity: 0.75; }
    .prov-row.dim:hover { opacity: 1; }
    .prov-head {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 14px; cursor: pointer;
    }
    .prov-head:hover { background: var(--bg-2); }
    .prov-head .caret {
      display: inline-block; transition: transform .12s;
      color: var(--muted); font-size: 14px; flex-shrink: 0;
    }
    .prov-row.open .prov-head .caret { transform: rotate(90deg); }
    .prov-meta {
      flex: 1; display: flex; align-items: center; gap: 10px;
      min-width: 0; flex-wrap: wrap;
    }
    .prov-meta strong { font-size: 14px; white-space: nowrap; }
    .prov-actions {
      display: flex; align-items: center; gap: 6px;
      flex-shrink: 0; white-space: nowrap;
    }

    .prov-body {
      padding: 12px 14px 14px; border-top: 1px solid var(--line);
      background: var(--bg-2);
    }
    .prov-facts {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 14px; margin-top: 8px;
    }
    .fact label {
      display: block; margin: 0 0 4px; color: var(--muted);
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
      font-weight: 600;
    }
    .fact .mono { font-family: "JetBrains Mono", ui-monospace, monospace;
      font-size: 12px; word-break: break-all; }
    .fact-warn { color: var(--warning); }
    .fact-warn label { color: var(--warning); }

    /* Inline free-tier badge on the provider name row — smaller than
       the modal version so it doesn't dominate the cell. */
    .free-badge.inline { display: inline-block; margin-left: 8px;
      padding: 1px 8px; font-size: 10px; vertical-align: middle; }

    td .kind-pill { padding: 2px 10px; border-radius: 999px; font-size: 11px;
      font-weight: 600; background: var(--bg-3); color: var(--muted); }

    /* Status pill — reflects config + test-send state. */
    .status-pill { display: inline-block; padding: 2px 10px; border-radius: 999px;
      font-size: 11px; font-weight: 600; letter-spacing: 0.3px;
      background: var(--bg-3); color: var(--muted); white-space: nowrap; }
    .status-pill[data-status="not_configured"] { background: var(--bg-3); color: var(--muted); }
    .status-pill[data-status="paused"]         { background: var(--bg-3); color: var(--muted); }
    .status-pill[data-status="untested"]       { background: color-mix(in oklab, var(--warning), transparent 78%); color: var(--warning); }
    .status-pill[data-status="ready"]          { background: color-mix(in oklab, var(--success), transparent 78%); color: var(--success); }
    .status-pill[data-status="failing"]        { background: color-mix(in oklab, var(--danger),  transparent 78%); color: var(--danger); }

    .advanced-toggle { margin-top: 14px; }
    .advanced-toggle button.ghost { padding: 4px 8px; }
    .modal-body textarea.mono { font-family: "JetBrains Mono", ui-monospace, monospace;
      font-size: 12px; line-height: 1.4; }
    code { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 12px;
      background: var(--bg-3); padding: 1px 5px; border-radius: 3px; }
    .test-ok   { color: var(--success); font-size: 12px; }
    .test-fail { color: var(--danger); font-size: 12px; cursor: help; }

    td.actions button { white-space: nowrap; }

    .route-row { display: flex; align-items: center; gap: 16px;
      padding: 12px 0; border-top: 1px solid var(--line); }
    .route-row:first-of-type { border-top: 0; }
    .route-info { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .route-info strong { font-size: 14px; }
    .route-row select { width: 320px; max-width: 40%; }

    .tab-actions { margin-top: 16px; display: flex; align-items: center; gap: 12px; }
    .tab-actions > * { white-space: nowrap; flex-shrink: 0; }

    .modal.wide { max-width: 640px; }
    .row.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .modal-body label.inline-toggle {
      display: inline-flex; align-items: center; gap: 8px; margin-top: 14px;
      padding: 8px 10px; background: var(--bg-2); border: 1px solid var(--line);
      border-radius: var(--radius-sm); cursor: pointer;
      color: var(--fg); font-size: 13px; font-weight: 500;
      text-transform: none; letter-spacing: normal; white-space: nowrap;
    }
    .modal-body label.inline-toggle input { width: auto; }
  `],
})
export class SettingsEmail {
  private api = inject(Api);
  private dialog = inject(DialogService);

  readonly kinds = KINDS;
  readonly purposes = PURPOSES;

  loading = signal(true);
  providers = signal<EmailProvider[]>([]);
  routing = signal<EmailRouting>({ newsletter: null, system: null, invite: null, internal: null });
  /** True when the .env has SYSTEM_SMTP_* configured — we show a banner
   *  so tenants know their un-routed sends use YOUR infrastructure. */
  systemFallbackEnabled = signal(false);
  /** Days remaining in the current tenant's grace window (null if the
   *  fallback isn't enabled or the tenant has no grace granted). */
  graceDaysLeft   = signal<number | null>(null);
  /** True once the tenant's grace date has passed — send() refuses the
   *  fallback in this state and the banner escalates to red. */
  fallbackExpired = signal(false);

  // Add/Edit modal state
  modalOpen = signal(false);
  modalError = signal<string | null>(null);
  saving = signal(false);
  advancedOpen = signal(false);
  headerJsonError = signal<string | null>(null);
  draft: Partial<EmailProvider> & { api_key?: string; api_secret?: string; smtp_password?: string } = this.blank();

  // Test-send modal state
  testOpen = signal(false);
  testProvider = signal<EmailProvider | null>(null);
  testTo = '';
  testing = signal(false);
  testResult = signal<{ ok: boolean; sent_to?: string; error?: string } | null>(null);

  // Routing save state
  savingRouting = signal(false);
  routingMsg = signal<string | null>(null);

  ngOnInit() { this.load(); }

  private load() {
    this.loading.set(true);
    this.api.listEmailProviders().subscribe({
      next: r => { this.providers.set(r.providers); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
    this.api.getEmailRouting().subscribe({
      next: r => this.routing.set(r.routing),
    });
    this.api.getEmailSystemStatus().subscribe({
      next: r => {
        this.systemFallbackEnabled.set(!!r.system_fallback_enabled);
        this.graceDaysLeft.set(r.grace_days_left);
        this.fallbackExpired.set(!!r.expired);
      },
    });
  }

  activeProviders(): EmailProvider[] {
    return this.providers().filter(p => !!p.is_active);
  }

  kindLabel(k: EmailProviderKind): string {
    return KINDS.find(x => x.key === k)?.label ?? k;
  }

  /** Extract a short host label from the current kind's signup URL,
   *  e.g. https://postmarkapp.com/sign_up → postmarkapp.com. Falls
   *  back to the provider label if URL parsing fails. */
  signupHostLabel(): string {
    const url = this.currentKindMeta().signupUrl;
    if (!url) return this.currentKindMeta().label;
    try { return new URL(url).hostname.replace(/^www\./, ''); }
    catch { return this.currentKindMeta().label; }
  }

  signupUrlFor(kind: EmailProviderKind): string | undefined {
    return KINDS.find(x => x.key === kind)?.signupUrl;
  }
  freeTierFor(kind: EmailProviderKind): string | null | undefined {
    return KINDS.find(x => x.key === kind)?.freeTier;
  }
  kindHintFor(kind: EmailProviderKind): string {
    return KINDS.find(x => x.key === kind)?.hint ?? '';
  }

  /** Which provider card is expanded (or null when all collapsed). */
  expandedProvider = signal<number | null>(null);
  toggleProviderRow(id: number) {
    this.expandedProvider.set(this.expandedProvider() === id ? null : id);
  }

  /** One of four status values used for the status pill: reflects
   *  whether the provider has credentials and whether a test send has
   *  succeeded. Drives colour via the [data-status] attribute. */
  statusFor(p: EmailProvider): 'not_configured' | 'untested' | 'ready' | 'failing' | 'paused' {
    const hasCreds = !!p.has_api_key || !!p.has_smtp_password || !!p.has_api_secret;
    if (!hasCreds) return 'not_configured';
    if (!p.is_active) return 'paused';
    if (p.last_test_at == null) return 'untested';
    return p.last_test_ok ? 'ready' : 'failing';
  }

  statusLabel(p: EmailProvider): string {
    switch (this.statusFor(p)) {
      case 'not_configured': return 'Not configured';
      case 'untested':       return 'Untested';
      case 'ready':          return 'Ready';
      case 'failing':        return 'Failing';
      case 'paused':         return 'Paused';
    }
  }

  /** Gmail / Outlook SMTP presets are personal mailboxes — providers
   *  cap them around 300–500/day and ban bulk. Flag them in the UI
   *  so tenants know not to route newsletters through them. */
  isPersonalSmtp(p: EmailProvider): boolean {
    if (p.provider !== 'smtp') return false;
    const host = (p.smtp_host || '').toLowerCase();
    return host.includes('gmail.com') || host.includes('office365.com') || host.includes('outlook.com');
  }

  currentKindMeta(): ProviderKindMeta {
    return KINDS.find(k => k.key === (this.draft.provider ?? 'postmark')) || KINDS[0];
  }

  /** Which conditional field group renders in the modal for the picked kind. */
  needs(field: 'api_key' | 'api_secret' | 'aws_region' | 'mailgun_domain' | 'smtp'): boolean {
    return this.currentKindMeta().fields.includes(field);
  }

  /** Placeholder shown on the API key input — signals whether one is
   *  already stored so the user knows they can leave it blank to keep. */
  apiKeyPlaceholder(): string {
    if (this.draft.has_api_key) return '•••• (leave blank to keep current key)';
    return 'Paste your API key';
  }

  credHint(flag: 'has_api_key' | 'has_api_secret' | 'has_smtp_password'): string {
    return (this.draft as any)[flag] ? '(currently set)' : '';
  }

  private blank(): typeof this.draft {
    return {
      provider: 'postmark',
      name: '',
      is_active: true,
      from_email: '',
      from_name: '',
      reply_to: '',
      smtp_encryption: 'tls',
    };
  }

  openAdd() {
    this.draft = this.blank();
    this.modalError.set(null);
    this.headerJsonError.set(null);
    this.advancedOpen.set(!!this.draft.custom_headers_json);
    this.modalOpen.set(true);
  }

  openEdit(p: EmailProvider) {
    // Clone and blank out credential input fields — the API returns
    // has_* flags only; the user enters new values only if they want
    // to change them.
    this.draft = {
      ...p,
      is_active: !!p.is_active,
      api_key: '',
      api_secret: '',
      smtp_password: '',
    };
    this.modalError.set(null);
    this.headerJsonError.set(null);
    this.advancedOpen.set(!!this.draft.custom_headers_json);
    this.modalOpen.set(true);
  }

  closeModal() { this.modalOpen.set(false); }

  save() {
    if (!this.draft.name?.trim()) { this.modalError.set('Display name is required'); return; }
    if (!this.draft.from_email?.trim()) { this.modalError.set('From email is required'); return; }
    // Validate custom_headers_json parses as an object of string values.
    const raw = (this.draft.custom_headers_json ?? '').trim();
    if (raw !== '') {
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          this.headerJsonError.set('Headers must be a JSON object like { "X-Foo": "bar" }');
          return;
        }
        this.headerJsonError.set(null);
      } catch {
        this.headerJsonError.set('Invalid JSON — check for missing quotes or commas');
        return;
      }
    } else {
      this.headerJsonError.set(null);
    }
    this.saving.set(true);
    const payload: any = { ...this.draft, is_active: this.draft.is_active ? 1 : 0 };
    // Drop the has_* flags — they're inbound-only diagnostics.
    delete payload.has_api_key; delete payload.has_api_secret; delete payload.has_smtp_password;
    delete payload.last_test_at; delete payload.last_test_ok; delete payload.last_test_error;
    delete payload.created_at; delete payload.updated_at; delete payload.id;

    const onOk = () => { this.saving.set(false); this.modalOpen.set(false); this.load(); };
    const onErr = (e: any) => { this.saving.set(false); this.modalError.set(e?.error?.error || 'Save failed'); };
    if (this.draft.id) {
      this.api.updateEmailProvider(this.draft.id, payload).subscribe({ next: onOk, error: onErr });
    } else {
      this.api.createEmailProvider(payload).subscribe({ next: onOk, error: onErr });
    }
  }

  async del(p: EmailProvider) {
    const ok = await this.dialog.confirm(
      `Delete "${p.name}"? Any routing pointing at it will fall back to the system default.`,
      { title: 'Delete provider', confirmLabel: 'Delete', variant: 'danger' }
    );
    if (!ok) return;
    this.api.deleteEmailProvider(p.id).subscribe(() => this.load());
  }

  openTest(p: EmailProvider) {
    this.testProvider.set(p);
    this.testTo = '';
    this.testResult.set(null);
    this.testOpen.set(true);
  }

  doTest() {
    const p = this.testProvider();
    if (!p || !this.testTo.trim()) return;
    this.testing.set(true);
    this.testResult.set(null);
    this.api.testEmailProvider(p.id, this.testTo.trim()).subscribe({
      next: r => { this.testing.set(false); this.testResult.set({ ok: true, sent_to: r.sent_to }); this.load(); },
      error: e => { this.testing.set(false); this.testResult.set({ ok: false, error: e?.error?.error || 'Send failed' }); this.load(); },
    });
  }

  setRoute(purpose: EmailPurpose, providerId: number | null) {
    this.routing.update(r => ({ ...r, [purpose]: providerId }));
  }

  saveRouting() {
    this.savingRouting.set(true);
    this.routingMsg.set(null);
    this.api.updateEmailRouting(this.routing()).subscribe({
      next: () => { this.savingRouting.set(false); this.routingMsg.set('Saved.');
                    setTimeout(() => this.routingMsg.set(null), 2500); },
      error: () => this.savingRouting.set(false),
    });
  }
}
