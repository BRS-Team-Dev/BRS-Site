import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { Auth } from '../../core/auth';
import { DialogService } from '../../core/dialog';
import { AppSettings } from '../../core/models';
import { SettingsService } from '../../core/settings.service';
import { ThemeService, TENANT_THEMES, THEME_META, TenantTheme } from '../../core/theme.service';
import { LeadgenSettings } from '../leadgen/leadgen-settings';
import { SettingsAccount } from './settings-account';
import { SettingsBilling } from './settings-billing';
import { SettingsEmail } from './settings-email';
import { SettingsNotifications } from './settings-notifications';

/**
 * Org-wide Settings page.
 *
 * Renders standalone — the Shell hides the system sidenav when the route
 * matches /admin/settings so this page owns the whole content area with
 * its own left-tab rail. Lands here from any sidenav footer.
 *
 * Each tab persists independently (no global Save). The legacy "Save
 * settings" panel that used to put one button at the page bottom has
 * been retired in favour of per-tab actions because the user invariably
 * only wants to save the tab they're looking at.
 */
type TabKey = 'general' | 'notifications' | 'email' | 'appearance' | 'uploads' | 'leadgen' | 'account' | 'billing';

interface TabDef {
  key: TabKey;
  label: string;
  icon: string;
}

@Component({
  selector: 'app-settings',
  imports: [FormsModule, LeadgenSettings, SettingsAccount, SettingsBilling, SettingsEmail, SettingsNotifications],
  template: `
    <div class="page">
      <header class="page-head">
        <h1>Settings</h1>
        <p class="muted">Manage your organisation's configuration.</p>
      </header>

      <div class="settings-grid">
        <aside class="tab-rail">
          @for (t of tabs; track t.key) {
            <button type="button"
                    class="tab-row"
                    [class.selected]="active() === t.key"
                    (click)="active.set(t.key)">
              <span class="tab-icon">{{ t.icon }}</span>
              <span class="tab-label">{{ t.label }}</span>
            </button>
          }
        </aside>

        @if (!loaded()) {
          <div class="tab-pane"><p class="muted">Loading settings…</p></div>
        } @else {
          <div class="tab-pane">
            @switch (active()) {
              @case ('general') {
                <section>
                  <h2>General</h2>
                  <p class="muted small">Organisation identity — used in the sidebar header, public forms, onboarding portals, and everywhere else the app shows your name and logo.</p>

                  <label>Organisation name</label>
                  <input [(ngModel)]="s.brand_name" name="brand_name" placeholder="Acme Corp Ltd" />
                  <p class="muted small">Displayed in the top-left, on public forms, and on onboarding portals.</p>

                  <label>Logo</label>
                  <div class="logo-row">
                    <div class="logo-preview">
                      @if (s.brand_logo_url) {
                        <img [src]="s.brand_logo_url" alt="" (error)="s.brand_logo_url = ''" />
                      } @else {
                        <span class="muted small">No logo</span>
                      }
                    </div>
                    <div class="logo-inputs">
                      <input type="url" [(ngModel)]="s.brand_logo_url" name="brand_logo_url" placeholder="https://…/logo.png" />
                      <div class="logo-actions">
                        <label class="ghost small file-btn">
                          {{ logoUploading() ? 'Uploading…' : (s.brand_logo_url ? 'Replace' : 'Upload') }}
                          <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp"
                                 (change)="uploadLogo($any($event.target).files?.[0])"
                                 [disabled]="logoUploading()" hidden />
                        </label>
                        @if (s.brand_logo_url) {
                          <button type="button" class="ghost small danger" (click)="s.brand_logo_url = ''">Remove</button>
                        }
                      </div>
                      @if (logoError()) { <p class="error-msg small">{{ logoError() }}</p> }
                    </div>
                  </div>

                  <label>Website</label>
                  <input type="url" [(ngModel)]="s.org_website" name="org_website" placeholder="https://acme.com" />

                  <label>Contact email</label>
                  <input type="email" [(ngModel)]="s.org_contact_email" name="org_contact_email" placeholder="hello@acme.com" />

                  <label>Timezone</label>
                  <select [(ngModel)]="s.org_timezone" name="org_timezone">
                    <option value="">— system default (UTC) —</option>
                    @for (tz of timezones; track tz) {
                      <option [value]="tz">{{ tz }}</option>
                    }
                  </select>
                  <p class="muted small">Used for date/time formatting throughout the admin.</p>

                  <label>Public form background</label>
                  <div class="color-row">
                    <input type="color" [(ngModel)]="s.public_form_bg_color" name="public_form_bg_color_picker" class="color-swatch" />
                    <input type="text" [(ngModel)]="s.public_form_bg_color" name="public_form_bg_color" placeholder="#0a0a0a" class="color-text" />
                    <button type="button" class="ghost" (click)="s.public_form_bg_color = ''" title="Reset to default">↺</button>
                  </div>
                  <p class="muted small">Backdrop shown on public forms and onboarding portals.</p>

                  <div class="tab-actions">
                    <button class="primary" (click)="save()" [disabled]="saving()">
                      {{ saving() ? 'Saving…' : 'Save general' }}
                    </button>
                    @if (savedAt()) { <span class="muted small">Saved {{ savedAt() }}</span> }
                  </div>
                </section>
              }

              @case ('notifications') {
                <!-- Per-event rules for the 44-event notification
                     catalogue (migration 127). Extracted into its own
                     component because the editor is substantial. -->
                <app-settings-notifications></app-settings-notifications>
              }

              @case ('email') {
                <!-- Provider config + purpose routing (migration 122).
                     Extracted into its own component because there's
                     enough state (providers list, add/edit modal, test
                     modal, routing) to warrant a dedicated view. -->
                <app-settings-email></app-settings-email>
              }

              @case ('appearance') {
                <section>
                  <h2>Appearance</h2>
                  <p class="muted small">
                    Brand colour theme — applies to everyone on this tenant unless
                    they pick a personal override on <strong>My account</strong>.
                    Click a panel to preview live, then <strong>Save theme</strong> to persist.
                  </p>

                  <h3 class="sub">Presets</h3>
                  <div class="theme-grid">
                    @for (slug of themes; track slug) {
                      <button type="button"
                              class="theme-card"
                              [class.selected]="theme.theme() === slug"
                              [style.--swatch-primary]="meta[slug].primary"
                              [style.--swatch-bg]="meta[slug].bg"
                              (click)="theme.preview(slug)">
                        <span class="theme-swatch">
                          <span class="swatch-bg"></span>
                          <span class="swatch-dot"></span>
                        </span>
                        <span class="theme-label">
                          <strong>{{ meta[slug].label }}</strong>
                          <span class="muted small">{{ meta[slug].mood }}</span>
                        </span>
                      </button>
                    }
                  </div>

                  <!-- Custom themes — tenant-created via the modal below.
                       Each card behaves like a preset but adds Edit/Delete
                       controls. Cache lives in localStorage, hydrated
                       synchronously by ThemeService at boot. -->
                  <h3 class="sub">Custom themes</h3>
                  @if (theme.customs().length === 0) {
                    <p class="muted small">No custom themes yet. Create one below to base a look on your own brand colours.</p>
                  } @else {
                    <div class="theme-grid">
                      @for (ct of theme.customs(); track ct.id) {
                        <div class="theme-card-wrap">
                          <button type="button"
                                  class="theme-card"
                                  [class.selected]="theme.theme() === ct.slug"
                                  [style.--swatch-primary]="ct.vars['--primary']"
                                  [style.--swatch-bg]="ct.vars['--bg']"
                                  (click)="theme.preview(ct.slug)">
                            <span class="theme-swatch">
                              <span class="swatch-bg"></span>
                              <span class="swatch-dot"></span>
                            </span>
                            <span class="theme-label">
                              <strong>{{ ct.label }}</strong>
                              <span class="muted small">{{ ct.mood || 'Custom' }}</span>
                            </span>
                          </button>
                          <div class="theme-card-actions">
                            <button class="ghost small" (click)="openCustomEdit(ct); $event.stopPropagation()">Edit</button>
                            <button class="ghost icon-btn danger" (click)="deleteCustom(ct); $event.stopPropagation()" title="Delete">✕</button>
                          </div>
                        </div>
                      }
                    </div>
                  }

                  @if (themeMsg()) { <div class="success-msg">{{ themeMsg() }}</div> }
                  @if (themeErr()) { <div class="error-msg">{{ themeErr() }}</div> }

                  <div class="tab-actions">
                    <button class="primary"
                            (click)="saveTheme()"
                            [disabled]="themeBusy() || theme.theme() === savedSlug()">
                      {{ themeBusy() ? 'Saving…' : 'Save theme' }}
                    </button>
                    <button class="ghost" (click)="openCustomNew()">+ Create custom theme</button>
                    @if (theme.theme() !== savedSlug()) {
                      <button class="ghost" (click)="revertTheme()">Cancel preview</button>
                    }
                  </div>
                </section>

                <!-- ── Create / Edit custom theme modal ─────────────── -->
                @if (customModalOpen()) {
                  <div class="modal-backdrop" (click)="closeCustomModal()">
                    <div class="modal wide" (click)="$event.stopPropagation()">
                      <div class="modal-head">
                        <h2>{{ customDraft.id ? 'Edit custom theme' : 'New custom theme' }}</h2>
                        <button class="ghost icon-btn" (click)="closeCustomModal()">✕</button>
                      </div>
                      <div class="modal-body">
                        @if (customError()) { <p class="error-msg">{{ customError() }}</p> }

                        <div class="row two-col">
                          <div>
                            <label>Label</label>
                            <input [(ngModel)]="customDraft.label" name="ct_label" placeholder="Cobalt Storm" />
                          </div>
                          <div>
                            <label>Mood (optional)</label>
                            <input [(ngModel)]="customDraft.mood" name="ct_mood" placeholder="Dark · Cool" />
                          </div>
                        </div>
                        <p class="muted small">Changes preview live across the whole app. Cancel discards.</p>

                        <div class="var-grid">
                          @for (v of colorVars; track v.key) {
                            <div class="var-row">
                              <label>{{ v.label }}</label>
                              <div class="color-input-wrap">
                                <input type="color"
                                       [value]="customDraft.vars[v.key] || v.default"
                                       (input)="setVar(v.key, $any($event.target).value)"
                                       [name]="'ct_' + v.key" />
                                <input type="text"
                                       [value]="customDraft.vars[v.key] || v.default"
                                       (input)="setVar(v.key, $any($event.target).value)"
                                       [name]="'ct_hex_' + v.key"
                                       maxlength="7" class="hex" />
                              </div>
                              <span class="muted small var-hint">{{ v.hint }}</span>
                            </div>
                          }
                        </div>
                      </div>
                      <div class="modal-foot">
                        <button class="ghost" (click)="closeCustomModal()">Cancel</button>
                        <button class="primary" (click)="saveCustom()" [disabled]="customSaving()">
                          {{ customSaving() ? 'Saving…' : (customDraft.id ? 'Update' : 'Create') }}
                        </button>
                      </div>
                    </div>
                  </div>
                }
              }

              @case ('uploads') {
                <section>
                  <h2>Uploads</h2>
                  <p class="muted small">Caps applied to all admin and public uploads — submission attachments, logos, HR documents.</p>

                  <label>Max upload size (MB)</label>
                  <input [(ngModel)]="s.upload_max_mb" name="upload_max_mb" placeholder="10" />

                  <div class="tab-actions">
                    <button class="primary" (click)="save()" [disabled]="saving()">
                      {{ saving() ? 'Saving…' : 'Save uploads' }}
                    </button>
                    @if (savedAt()) { <span class="muted small">Saved {{ savedAt() }}</span> }
                  </div>
                </section>
              }

              @case ('leadgen') {
                <!-- LeadgenSettings is the existing page at
                     /admin/leadgen/settings, embedded here without its
                     toolbar so it slots into the tab cleanly. The
                     standalone route still works as a deep link. -->
                <app-leadgen-settings [embedded]="true" />
              }

              @case ('account') {
                <!-- User management — CRUD for admin_users on this
                     tenant, gated by subscription-tier cap. Personal
                     password-change moved to My account (/me/account). -->
                <app-settings-account></app-settings-account>
              }

              @case ('billing') {
                <!-- Subscription billing — plan summary, billing
                     details, payment methods, invoice history.
                     Backed by /api/billing (migrations 129/130). -->
                <app-settings-billing></app-settings-billing>
              }
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    /* Standalone page — no system sidenav, but the global top-nav still
       sits above. Soak up the remaining viewport for a centred layout. */
    :host { display: block; min-width: 0; }
    .page {
      max-width: 1100px;
      margin: 0 auto;
      padding: 28px 32px 64px;
    }
    .page-head { margin-bottom: 24px; }
    .page-head h1 { margin: 0; font-size: 26px; }
    .page-head p { margin: 4px 0 0; }

    /* Two-column: tab rail left, content right. Stacks below 800px so
       the rail becomes a horizontal row at the top of the pane. */
    .settings-grid {
      display: grid;
      /* minmax(0, 1fr) so the tab-pane column NEVER grows past its
         allotted width when a child (eg. billing plan carousel) has
         intrinsic content wider than the pane. Without the min: 0
         the grid track defaults to minmax(auto, 1fr) and overflowing
         children silently expand the whole layout. */
      grid-template-columns: 220px minmax(0, 1fr);
      gap: 20px;
      align-items: start;
    }
    @media (max-width: 800px) {
      .settings-grid { grid-template-columns: 1fr; }
      .tab-rail { display: flex; flex-direction: row; flex-wrap: wrap; }
    }

    /* Tab rail — looks like a stack of pill rows. Selected row gets the
       primary-tinted background + a left border accent so the user
       reads it as "you're here". */
    .tab-rail {
      background: var(--bg-2);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 8px;
      display: flex; flex-direction: column; gap: 2px;
    }
    .tab-row {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 12px; border-radius: var(--radius-sm);
      background: transparent; border: 1px solid transparent;
      color: var(--fg); font-size: 14px; text-align: left;
      cursor: pointer;
      transition: background 0.15s, color 0.15s, border-color 0.15s;
    }
    .tab-row:hover { background: var(--bg-3); }
    .tab-row.selected {
      background: var(--bg-3);
      color: var(--primary);
      border-color: var(--line);
    }
    .tab-icon { width: 20px; text-align: center; opacity: 0.85; }

    /* Right pane — single card per tab. Each section header drops the
       global muted-uppercase h2 in favour of a regular weighted title
       because the page-head has already done the "this is a settings
       page" framing. */
    .tab-pane {
      background: var(--bg-2);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 24px;
      min-height: 360px;
      /* min-width: 0 belt-and-braces so the pane itself is a valid
         shrinkable container for scrollable children (billing carousel). */
      min-width: 0;
      overflow: hidden;
    }
    .tab-pane h2 { margin: 0 0 4px; font-size: 18px; text-transform: none; letter-spacing: 0; color: var(--fg); font-weight: 600; }
    .tab-pane p.small { margin-top: 0; }
    .tab-pane label { display: block; margin-top: 14px; }
    .tab-pane hr { border: none; border-top: 1px solid var(--line); margin: 20px 0 10px; }

    .tab-actions {
      display: flex; align-items: center; gap: 10px;
      margin-top: 20px; padding-top: 16px;
      border-top: 1px solid var(--line);
    }

    /* Inline colour picker — colour input + hex text input side by side. */
    .color-row { display: flex; gap: 8px; align-items: center; margin-top: 6px; }

    /* Logo picker — preview swatch + URL/Upload row. */
    .logo-row { display: flex; gap: 12px; align-items: flex-start;
      margin-top: 6px; }
    .logo-preview {
      width: 64px; height: 64px; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      background: var(--bg-3); border: 1px solid var(--line);
      border-radius: var(--radius-sm); overflow: hidden;
    }
    .logo-preview img { max-width: 100%; max-height: 100%; object-fit: contain; }
    .logo-inputs { flex: 1; display: flex; flex-direction: column; gap: 6px; }
    .logo-actions { display: flex; gap: 6px; align-items: center; }
    .file-btn {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 4px 10px; margin: 0; cursor: pointer;
      border: 1px solid var(--line); border-radius: var(--radius-sm);
      background: transparent; color: var(--fg);
      font-size: 12px; font-weight: 500;
      text-transform: none; letter-spacing: normal;
      white-space: nowrap;
    }
    .file-btn:hover { background: var(--bg-3); border-color: var(--primary); }
    .color-row .color-swatch {
      width: 44px; height: 36px; padding: 2px;
      flex-shrink: 0; cursor: pointer;
    }
    .color-row .color-text { flex: 1; font-family: "JetBrains Mono", monospace; }

    /* Sub-heading between preset + custom sections. */
    h3.sub { margin: 24px 0 6px; font-size: 12px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); }
    section > h3.sub:first-of-type { margin-top: 16px; }

    /* Theme picker — same 3-up grid pattern used on /me/account. */
    .theme-grid {
      display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;
      margin-top: 12px;
    }
    /* Custom theme card wrapper — hosts the theme-card AND floating
       Edit/Delete controls so the picker interaction is uninterrupted. */
    .theme-card-wrap { position: relative; }
    .theme-card-actions {
      position: absolute; top: 6px; right: 6px;
      display: flex; gap: 4px;
      opacity: 0; transition: opacity .12s;
    }
    .theme-card-wrap:hover .theme-card-actions,
    .theme-card-wrap:focus-within .theme-card-actions { opacity: 1; }
    .theme-card-actions button { padding: 3px 8px; font-size: 11px; }

    /* Custom theme editor modal — 2-col grid of colour rows with a
       native picker + hex text field for precise entry. */
    .modal.wide { max-width: 720px; }
    .var-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 14px 24px;
      margin-top: 14px;
    }
    @media (max-width: 640px) { .var-grid { grid-template-columns: 1fr; } }
    .var-row { display: flex; flex-direction: column; gap: 4px; }
    .var-row label {
      display: block; color: var(--muted); font-size: 11px;
      text-transform: uppercase; letter-spacing: 0.5px; margin: 0;
    }
    .color-input-wrap { display: flex; align-items: center; gap: 8px; }
    /* Native color pickers render their swatch inside padding + border
       by default; strip both so the whole box is the actual colour and
       the value reads at a glance. */
    .color-input-wrap input[type="color"] {
      width: 36px; height: 32px; padding: 0; flex-shrink: 0;
      border-radius: var(--radius-sm); cursor: pointer;
      background: transparent; border: 1px solid var(--line);
      overflow: hidden;
    }
    .color-input-wrap input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }
    .color-input-wrap input[type="color"]::-webkit-color-swatch { border: 0; border-radius: var(--radius-sm); }
    .color-input-wrap input[type="color"]::-moz-color-swatch      { border: 0; border-radius: var(--radius-sm); }
    .color-input-wrap input.hex {
      flex: 1; width: 100px; font-family: "JetBrains Mono", ui-monospace, monospace;
      font-size: 12px; text-transform: uppercase;
    }
    .var-hint { font-size: 11px; }
    @media (max-width: 720px) { .theme-grid { grid-template-columns: 1fr 1fr; } }
    .theme-card {
      display: flex; align-items: center; gap: 12px;
      padding: 10px 12px; border-radius: var(--radius);
      background: var(--bg-2); border: 1px solid var(--line);
      cursor: pointer; text-align: left;
      transition: border-color .15s, transform .15s;
    }
    .theme-card:hover { border-color: var(--primary); transform: translateY(-1px); }
    .theme-card.selected {
      border-color: var(--primary);
      box-shadow: 0 0 0 2px color-mix(in oklab, var(--primary), transparent 70%);
    }
    .theme-swatch {
      position: relative;
      width: 44px; height: 44px; border-radius: 8px;
      flex-shrink: 0; overflow: hidden;
      border: 1px solid var(--line);
    }
    .theme-swatch .swatch-bg { position: absolute; inset: 0; background: var(--swatch-bg); }
    .theme-swatch .swatch-dot {
      position: absolute; right: 6px; bottom: 6px;
      width: 16px; height: 16px; border-radius: 50%;
      background: var(--swatch-primary);
      box-shadow: 0 0 0 2px rgba(255,255,255,0.15);
    }
    .theme-label { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .theme-label strong { font-size: 13px; }
  `],
})
export class Settings {
  private api = inject(Api);
  private svc = inject(SettingsService);
  private auth = inject(Auth);
  private dialog = inject(DialogService);
  theme = inject(ThemeService);

  // Exposed to the template so the @for can iterate.
  readonly themes = TENANT_THEMES;
  readonly meta   = THEME_META;

  /** Common IANA timezones surfaced on the General tab. Keeping the
   *  list short + curated rather than shipping the full ~600 IANA set
   *  — tenants who need a niche zone can request an add. */
  readonly timezones: string[] = [
    'UTC',
    'Europe/London',
    'Europe/Dublin',
    'Europe/Paris',
    'Europe/Berlin',
    'Europe/Madrid',
    'Europe/Rome',
    'Europe/Amsterdam',
    'Europe/Stockholm',
    'Europe/Warsaw',
    'Europe/Istanbul',
    'Africa/Lagos',
    'Africa/Johannesburg',
    'Africa/Cairo',
    'Asia/Dubai',
    'Asia/Karachi',
    'Asia/Kolkata',
    'Asia/Singapore',
    'Asia/Hong_Kong',
    'Asia/Tokyo',
    'Australia/Sydney',
    'Pacific/Auckland',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'America/Toronto',
    'America/Mexico_City',
    'America/Sao_Paulo',
  ];

  readonly tabs: TabDef[] = [
    { key: 'general',       label: 'General',        icon: '⚙' },
    { key: 'appearance',    label: 'Appearance',     icon: '◐' },
    { key: 'billing',       label: 'Billing',        icon: '💳' },
    { key: 'account',       label: 'Account',        icon: '👤' },
    { key: 'email',         label: 'Email',          icon: '✉' },
    { key: 'notifications', label: 'Notifications',  icon: '🔔' },
    { key: 'leadgen',       label: 'AI LLMs',        icon: '🤖' },
    { key: 'uploads',       label: 'Uploads',        icon: '⇪' },
  ];
  active = signal<TabKey>('general');

  /** Cross-tab jump for sibling components. `SettingsBilling` fires
   *  `settings:go-tab` when the user clicks "Change plan →" so the
   *  Account tab (which owns the upgrade UI) becomes active without
   *  routing away from Settings. */
  private onGoTab = (e: Event) => {
    const detail = (e as CustomEvent).detail as TabKey;
    if (this.tabs.some(t => t.key === detail)) this.active.set(detail);
  };

  s: AppSettings = {};
  loaded = signal(false);
  testTo = '';
  cur = ''; newp = '';
  saving = signal(false);
  testing = signal(false);
  testResult = signal<{ ok: boolean; error?: string } | null>(null);
  passResult = signal<{ ok: boolean; msg: string } | null>(null);
  savedAt = signal<string | null>(null);

  // Logo upload state (General tab). On success the returned URL is
  // written into `s.brand_logo_url` — the standard save() flow persists
  // it. Failure surfaces inline under the input row.
  logoUploading = signal(false);
  logoError     = signal<string | null>(null);
  uploadLogo(file: File | undefined) {
    if (!file) return;
    this.logoError.set(null);
    this.logoUploading.set(true);
    this.api.uploadBrandLogo(file).subscribe({
      next: r => {
        this.logoUploading.set(false);
        // Prefix with backend origin so <img src=…> works even if the
        // Angular dev server is on a different port.
        this.s.brand_logo_url = r.url.startsWith('http')
          ? r.url
          : (this.origin() + r.url);
      },
      error: e => {
        this.logoUploading.set(false);
        this.logoError.set(e?.error?.error || 'Upload failed');
      },
    });
  }
  private origin(): string {
    // In production the API + frontend share the same origin so
    // returning '' is fine. In dev the frontend runs on :4200 and the
    // API is under /builtrightstudio/cms — the base path from env
    // covers both cases.
    return window.location.origin;
  }

  // Theme picker state. `savedSlug` tracks the persisted tenant choice
  // so we can disable Save when nothing changed and show Cancel preview
  // when the live preview differs.
  themeBusy = signal(false);
  themeMsg  = signal<string | null>(null);
  themeErr  = signal<string | null>(null);
  // savedSlug is any string because custom themes have `custom-…` slugs
  // that aren't in the TenantTheme union. Persisted the same way.
  savedSlug = signal<string>(
    (this.auth.tenant()?.color_theme as string) ?? 'midnight-gold'
  );

  saveTheme() {
    this.themeMsg.set(null);
    this.themeErr.set(null);
    const slug = this.theme.theme();
    this.themeBusy.set(true);
    this.theme.saveTenantDefault(slug).subscribe({
      next: () => {
        this.themeBusy.set(false);
        this.themeMsg.set('Organisation theme saved — applies to everyone unless they pick a personal override on My account.');
        this.savedSlug.set(slug);
        this.auth.patchTenant({ color_theme: slug });
      },
      error: e => {
        this.themeBusy.set(false);
        this.themeErr.set(e?.error?.error || 'Could not save theme.');
      },
    });
  }

  revertTheme() {
    this.theme.preview(this.savedSlug());
    this.themeMsg.set(null);
    this.themeErr.set(null);
  }

  // ─── Custom themes editor ────────────────────────────────────
  // The 12 CSS variables tenants can override. Each row renders a
  // native colour picker + a hex text input for keyboard entry. `default`
  // seeds a new theme with sensible Midnight Gold values; `hint` explains
  // where the variable shows up so tenants aren't guessing.
  readonly colorVars: { key: string; label: string; default: string; hint: string }[] = [
    { key: '--bg',        label: 'Background',            default: '#0a0a0a', hint: 'Main app canvas.' },
    { key: '--bg-2',      label: 'Surface',               default: '#141414', hint: 'Cards, side nav, table rows.' },
    { key: '--bg-3',      label: 'Elevated',              default: '#1c1c1c', hint: 'Inputs, hover states, pills.' },
    { key: '--line',      label: 'Border',                default: '#2a2620', hint: 'Dividers, input borders.' },
    { key: '--fg',        label: 'Text',                  default: '#ffffff', hint: 'Primary text colour.' },
    { key: '--muted',     label: 'Muted text',            default: '#bab2a4', hint: 'Secondary + placeholder text.' },
    { key: '--primary',   label: 'Primary',               default: '#d4a93a', hint: 'Brand accent — buttons, links.' },
    { key: '--primary-2', label: 'Primary — hover',       default: '#b8902a', hint: 'Hover shade of primary.' },
    { key: '--primary-3', label: 'Primary — deep',        default: '#987f3e', hint: 'Pressed / disabled shade.' },
    { key: '--danger',    label: 'Danger',                default: '#ff6464', hint: 'Delete, errors, destructive.' },
    { key: '--success',   label: 'Success',               default: '#56c98a', hint: 'Saved, healthy, active.' },
    { key: '--warning',   label: 'Warning',               default: '#ff9f43', hint: 'Warnings, needs-attention.' },
  ];

  customModalOpen = signal(false);
  customSaving    = signal(false);
  customError     = signal<string | null>(null);
  /** Editor draft — mutated by setVar() and cleared on close. `vars`
   *  starts empty; missing keys fall back to the `default` per row. */
  customDraft: { id?: number; slug?: string; label: string; mood: string; vars: Record<string, string> } = {
    label: '', mood: '', vars: {},
  };

  openCustomNew() {
    this.customDraft = { label: '', mood: '', vars: {} };
    // Seed with the defaults so the pickers show something.
    for (const v of this.colorVars) this.customDraft.vars[v.key] = v.default;
    this.customError.set(null);
    this.customModalOpen.set(true);
    // Live-preview the seeded set so the user sees what they're starting from.
    this.theme.previewVars(this.customDraft.vars);
  }

  openCustomEdit(ct: { id: number; slug: string; label: string; mood?: string | null; vars: Record<string, string> }) {
    this.customDraft = {
      id: ct.id,
      slug: ct.slug,
      label: ct.label,
      mood: ct.mood ?? '',
      // Copy the map so edits don't mutate the cache in place.
      vars: { ...ct.vars },
    };
    // Fill in any missing keys with defaults so every picker has a value.
    for (const v of this.colorVars) {
      if (!this.customDraft.vars[v.key]) this.customDraft.vars[v.key] = v.default;
    }
    this.customError.set(null);
    this.customModalOpen.set(true);
    this.theme.previewVars(this.customDraft.vars);
  }

  closeCustomModal() {
    this.customModalOpen.set(false);
    // Restore whatever was active before the modal opened.
    this.theme.restoreCurrent();
  }

  /** Every input in the editor calls this. Updates the draft AND
   *  applies the vars live so the entire app repaints as the user
   *  drags the colour picker. */
  setVar(key: string, value: string) {
    this.customDraft.vars = { ...this.customDraft.vars, [key]: value };
    this.theme.previewVars(this.customDraft.vars);
  }

  saveCustom() {
    if (!this.customDraft.label.trim()) {
      this.customError.set('Label is required'); return;
    }
    this.customSaving.set(true);
    this.customError.set(null);
    // Split create vs update at the call site — the two API methods
    // return different response shapes, so a single method returning
    // their union would break `.subscribe()` typing. Handlers are
    // shared and the response shape difference is absorbed here.
    const payload = {
      slug:  this.customDraft.slug,
      label: this.customDraft.label,
      mood:  this.customDraft.mood || null,
      vars:  this.customDraft.vars,
    };
    const onOk = (slug: string) => {
      this.customSaving.set(false);
      this.customModalOpen.set(false);
      // Optimistic insert into the in-memory customs list so preview()
      // can resolve the slug before refreshCustoms() lands. Without
      // this the preview races the API refetch and normalize() falls
      // back to the default preset because the slug is unknown.
      const draftClone = {
        id:    this.customDraft.id ?? Date.now(),
        slug,
        label: this.customDraft.label,
        mood:  this.customDraft.mood || null,
        vars:  { ...this.customDraft.vars },
      };
      this.theme.customs.update(list => {
        const idx = list.findIndex(t => t.slug === slug);
        if (idx >= 0) {
          const next = [...list];
          next[idx] = { ...next[idx], ...draftClone };
          return next;
        }
        return [...list, draftClone];
      });
      this.theme.preview(slug);
      // Background refresh replaces the optimistic id/timestamps with
      // the canonical server values (and picks up anything a sibling
      // tab created since our cache was last written).
      this.theme.refreshCustoms();
    };
    const onErr = (e: any) => {
      this.customSaving.set(false);
      this.customError.set(e?.error?.error || 'Could not save theme');
    };
    if (this.customDraft.id) {
      this.theme.updateCustomThemeApi(this.customDraft.id, payload).subscribe({
        next: () => onOk(this.customDraft.slug || ''),
        error: onErr,
      });
    } else {
      this.theme.createCustomThemeApi(payload).subscribe({
        next: r => onOk(r.slug),
        error: onErr,
      });
    }
  }

  async deleteCustom(ct: { id: number; slug: string; label: string }) {
    const ok = await this.dialog.confirm(
      `Delete "${ct.label}"? Any user with this theme selected falls back to the tenant default.`,
      { title: 'Delete custom theme', confirmLabel: 'Delete', variant: 'danger' }
    );
    if (!ok) return;
    this.theme.deleteCustomTheme(ct.id).subscribe(() => {
      this.theme.refreshCustoms();
      // If the deleted theme was active, revert to the tenant default.
      if (this.theme.theme() === ct.slug) this.theme.preview(this.savedSlug());
    });
  }

  ngOnInit() {
    window.addEventListener('settings:go-tab', this.onGoTab);
    this.svc.load().subscribe(r => {
      this.s = { ...r.settings };
      this.loaded.set(true);
    });
  }
  ngOnDestroy() {
    window.removeEventListener('settings:go-tab', this.onGoTab);
  }
  save() {
    this.saving.set(true);
    this.svc.update(this.s).subscribe({
      next: () => { this.saving.set(false); this.savedAt.set(new Date().toLocaleTimeString()); },
      error: () => this.saving.set(false),
    });
  }
  testMail() {
    this.testing.set(true);
    this.testResult.set(null);
    this.api.testMail(this.testTo).subscribe({
      next: r => { this.testing.set(false); this.testResult.set(r); },
      error: e => { this.testing.set(false); this.testResult.set({ ok: false, error: e?.error?.error || 'Failed' }); },
    });
  }
  changePass() {
    this.passResult.set(null);
    this.api.changePassword(this.cur, this.newp).subscribe({
      next: () => { this.passResult.set({ ok: true, msg: 'Password updated' }); this.cur = ''; this.newp = ''; },
      error: e => this.passResult.set({ ok: false, msg: e?.error?.error || 'Failed' }),
    });
  }
}
