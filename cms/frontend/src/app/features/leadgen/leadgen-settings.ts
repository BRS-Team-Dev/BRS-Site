import { Component, Input, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import { DialogService } from '../../core/dialog';
import { AppSettings } from '../../core/models';
import { SettingsService } from '../../core/settings.service';
import {
  AiProvider, CustomAiModel,
  PROVIDER_KEY_SETTING, PROVIDER_LABELS, PROVIDER_SECRET_SETTING,
} from '../../core/ai-models';

interface NewModelDraft {
  model_id: string;
  label: string;
  provider: AiProvider;
  supports_search: boolean;
  custom_endpoint: string;
}

const BLANK_DRAFT = (): NewModelDraft => ({
  model_id: '',
  label: '',
  provider: 'anthropic',
  supports_search: false,
  custom_endpoint: '',
});

/**
 * Lead Gen settings — provider API keys/secrets and custom-model registry.
 * Keys round-trip through the same `settings` table; custom models live in
 * the `ai_models` table and merge with the hard-coded `BRS\AI::MODELS` list.
 */
@Component({
  selector: 'app-leadgen-settings',
  imports: [FormsModule, RouterLink],
  template: `
    @if (!embedded) {
      <div class="toolbar">
        <button class="ghost" routerLink="/admin/leadgen">← Back to Lead Gen</button>
        <h1>Lead Gen · Settings</h1>
      </div>
    }

    @if (!loaded()) {
      <div class="empty">Loading settings…</div>
    } @else {
      <div class="layout">
        <section class="card">
          <h2>AI / LLM provider credentials</h2>
          <p class="muted small">Used by Lead Gen → AI Generated List. Keys are stored server-side and shown as <code>••••••••</code> once set; leave a field unchanged to keep the existing value. Most providers only need an API key — the secret slot is there for providers that issue key+secret pairs.</p>
          @for (p of providers; track p) {
            <fieldset class="provider">
              <legend>{{ providerLabel(p) }}</legend>
              <label>API key</label>
              <input
                type="password"
                [ngModel]="s[providerKeySetting(p)]"
                (ngModelChange)="s[providerKeySetting(p)] = $event"
                [name]="providerKeySetting(p)"
                placeholder="(unchanged)"
                autocomplete="off" />
              <label>API secret <span class="muted">(optional)</span></label>
              <input
                type="password"
                [ngModel]="s[providerSecretSetting(p)]"
                (ngModelChange)="s[providerSecretSetting(p)] = $event"
                [name]="providerSecretSetting(p)"
                placeholder="(unchanged)"
                autocomplete="off" />
            </fieldset>
          }
          <div class="row sticky-save">
            <span class="spacer"></span>
            @if (savedAt()) { <span class="muted small">Saved {{ savedAt() }}</span> }
            <button class="primary" (click)="saveCreds()" [disabled]="saving()">
              {{ saving() ? 'Saving…' : 'Save credentials' }}
            </button>
          </div>
        </section>

        <section class="card">
          <h2>Companies House crawler</h2>
          <p class="muted small">Stage 3 (Google Business profiles) uses the official <strong>Google Places API</strong>. Paste a Google Maps Platform API key with the <em>Places API (New)</em> enabled and billing on — the $200/month Maps credit keeps typical use free, and you can set a budget cap so it never charges. Stored server-side and shown as <code>••••••••</code> once set.</p>
          <label>Google Maps API key</label>
          <input
            type="password"
            [ngModel]="s['google_maps_api_key']"
            (ngModelChange)="s['google_maps_api_key'] = $event"
            name="google_maps_api_key"
            placeholder="(unchanged)"
            autocomplete="off" />

          <p class="muted small" style="margin-top:16px">Stage 5 (LinkedIn staff) — <strong>optional</strong>. The no-key scraper only finds the company's LinkedIn URL (LinkedIn blocks unauthenticated requests). To pull staff, paste your own <code>li_at</code> session cookie below. <strong>⚠ This drives your logged-in LinkedIn session — against LinkedIn's ToS, and heavy use can get your account restricted. Use sparingly.</strong></p>
          <label>LinkedIn <code>li_at</code> cookie</label>
          <input
            type="password"
            [ngModel]="s['linkedin_li_at']"
            (ngModelChange)="s['linkedin_li_at'] = $event"
            name="linkedin_li_at"
            placeholder="(unchanged)"
            autocomplete="off" />
          <label>LinkedIn <code>JSESSIONID</code> <span class="muted">(optional, improves reliability)</span></label>
          <input
            type="password"
            [ngModel]="s['linkedin_csrf']"
            (ngModelChange)="s['linkedin_csrf'] = $event"
            name="linkedin_csrf"
            placeholder="(unchanged)"
            autocomplete="off" />

          <h2 style="margin-top:24px">Sync targets (push local → dev / prod)</h2>
          <p class="muted small">The LinkedIn crawlers need a headless browser, which only runs <strong>locally</strong>. Do the crawling + enrichment here, then <strong>push the finished leads</strong> up to dev or prod (which stay curl-only) from the pipeline's <em>Sync</em> control. Enter each target's API base URL and a login it can use to import.</p>
          @for (t of ['dev', 'prod']; track t) {
            <label>{{ t === 'dev' ? 'Dev' : 'Prod' }} API base URL <span class="muted">(e.g. https://…/cc/api)</span></label>
            <input type="text" [ngModel]="s['sync_' + t + '_url']" (ngModelChange)="s['sync_' + t + '_url'] = $event" [name]="'sync_' + t + '_url'" placeholder="https://…/api" autocomplete="off" />
            <div class="row" style="gap:10px">
              <div style="flex:1">
                <label>{{ t }} login email</label>
                <input type="text" [ngModel]="s['sync_' + t + '_email']" (ngModelChange)="s['sync_' + t + '_email'] = $event" [name]="'sync_' + t + '_email'" placeholder="admin@…" autocomplete="off" />
              </div>
              <div style="flex:1">
                <label>{{ t }} password</label>
                <input type="password" [ngModel]="s['sync_' + t + '_pass']" (ngModelChange)="s['sync_' + t + '_pass'] = $event" [name]="'sync_' + t + '_pass'" placeholder="(unchanged)" autocomplete="off" />
              </div>
            </div>
          }

          <div class="row sticky-save">
            <span class="spacer"></span>
            @if (savedAt()) { <span class="muted small">Saved {{ savedAt() }}</span> }
            <button class="primary" (click)="saveCreds()" [disabled]="saving()">
              {{ saving() ? 'Saving…' : 'Save' }}
            </button>
          </div>
        </section>

        <section class="card">
          <h2>Custom models</h2>
          <p class="muted small">Add new model IDs as they ship from existing providers (no code change needed), or point a row at a self-hosted/third-party OpenAI-compatible endpoint (Ollama, vLLM, Together, Groq, Fireworks, etc.). Custom rows merge with the built-in registry; matching <code>model_id</code> overrides the built-in.</p>

          @if (customModels().length > 0) {
            <div class="table-wrap">
              <table class="data">
                <thead><tr>
                  <th>Model ID</th>
                  <th>Label</th>
                  <th>Provider</th>
                  <th>Search</th>
                  <th>Endpoint</th>
                  <th></th>
                </tr></thead>
                <tbody>
                  @for (m of customModels(); track m.id) {
                    <tr>
                      <td><code>{{ m.model_id }}</code></td>
                      <td>{{ m.label }}</td>
                      <td>{{ providerLabel(m.provider) }}</td>
                      <td>{{ m.supports_search ? '✓' : '—' }}</td>
                      <td class="endpoint">{{ m.custom_endpoint || '—' }}</td>
                      <td class="actions">
                        <button class="ghost icon-btn danger" (click)="deleteModel(m)" title="Delete" aria-label="Delete">✕</button>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }

          <h3 class="add-title">Add a model</h3>
          <div class="map-grid">
            <div class="map-row">
              <label>Model ID <span class="req">*</span></label>
              <input [(ngModel)]="draft.model_id" name="new_model_id" placeholder="e.g. claude-sonnet-4-7" />
            </div>
            <div class="map-row">
              <label>Display label <span class="req">*</span></label>
              <input [(ngModel)]="draft.label" name="new_model_label" placeholder="Claude Sonnet 4.7" />
            </div>
            <div class="map-row">
              <label>Provider</label>
              <select [(ngModel)]="draft.provider" name="new_model_provider">
                @for (p of providersIncludingCustom; track p) {
                  <option [value]="p">{{ providerLabel(p) }}</option>
                }
              </select>
            </div>
            <div class="map-row">
              <label>Web search support</label>
              <select [ngModel]="draft.supports_search" (ngModelChange)="draft.supports_search = $event" name="new_model_search">
                <option [ngValue]="false">No</option>
                <option [ngValue]="true">Yes</option>
              </select>
            </div>
          </div>
          <label>Custom endpoint URL @if (draft.provider === 'openai_compatible') { <span class="req">*</span> } @else { <span class="muted">(optional — overrides default)</span> }</label>
          <input [(ngModel)]="draft.custom_endpoint" name="new_model_endpoint" placeholder="https://api.example.com/v1/chat/completions" />
          @if (modelError()) { <div class="error-msg">{{ modelError() }}</div> }
          <div class="row">
            <span class="spacer"></span>
            <button class="primary" (click)="addModel()" [disabled]="addingModel()">
              {{ addingModel() ? 'Adding…' : 'Add model' }}
            </button>
          </div>
        </section>
      </div>
    }
  `,
  styles: [`
    .layout { display: grid; grid-template-columns: minmax(0, 720px); gap: 20px; padding: 20px; }
    .card label { margin-top: 10px; }
    .card h3.add-title {
      font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;
      color: var(--muted); margin: 18px 0 8px 0; font-weight: 600;
    }
    .sticky-save { display: flex; align-items: center; gap: 10px; }
    fieldset.provider {
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      padding: 10px 14px 14px 14px;
      margin: 10px 0;
    }
    fieldset.provider legend {
      padding: 0 6px;
      color: var(--fg);
      font-size: 13px;
      font-weight: 600;
    }
    .map-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
    .map-row { display: flex; flex-direction: column; gap: 4px; }
    .map-row label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
    table.data .endpoint {
      font-family: "JetBrains Mono", monospace;
      font-size: 12px;
      max-width: 280px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .req { color: var(--primary); margin-left: 2px; }
  `],
})
export class LeadgenSettings {
  private api = inject(Api);
  private svc = inject(SettingsService);
  private dialog = inject(DialogService);

  /** When true, hide the page-level toolbar so this component renders
   *  cleanly inside another page's tab (e.g. /admin/settings → Lead
   *  Gen tab). Routed standalone usage at /admin/leadgen/settings
   *  leaves this false so the back button + h1 still appear. */
  @Input() embedded = false;

  s: AppSettings = {};
  loaded = signal(false);
  saving = signal(false);
  savedAt = signal<string | null>(null);

  customModels = signal<CustomAiModel[]>([]);
  draft: NewModelDraft = BLANK_DRAFT();
  addingModel = signal(false);
  modelError = signal<string | null>(null);

  providers: AiProvider[] = ['anthropic', 'openai', 'gemini', 'xai', 'deepseek', 'perplexity', 'skywork'];
  providersIncludingCustom: AiProvider[] = [...this.providers, 'openai_compatible'];

  providerLabel = (p: AiProvider) => PROVIDER_LABELS[p];
  providerKeySetting = (p: AiProvider) => PROVIDER_KEY_SETTING[p];
  providerSecretSetting = (p: AiProvider) => PROVIDER_SECRET_SETTING[p];

  ngOnInit() {
    this.svc.load().subscribe(r => {
      this.s = { ...r.settings };
      this.loaded.set(true);
    });
    this.loadCustomModels();
  }

  private loadCustomModels() {
    this.api.listCustomAiModels().subscribe({
      next: r => this.customModels.set(r.models),
      error: () => {/* silent — table may not exist on a fresh checkout */},
    });
  }

  saveCreds() {
    this.saving.set(true);
    // Only round-trip the AI key/secret fields — leave anything else owned by
    // the global settings page untouched.
    const aiOnly: AppSettings = {};
    for (const p of this.providers) {
      const k = this.providerKeySetting(p);
      const s = this.providerSecretSetting(p);
      if (this.s[k] !== undefined) aiOnly[k] = this.s[k];
      if (this.s[s] !== undefined) aiOnly[s] = this.s[s];
    }
    // Companies House crawler keys (Stage 3 Google + Stage 5 LinkedIn) ride
    // along in the same save.
    for (const k of ['google_maps_api_key', 'linkedin_li_at', 'linkedin_csrf',
      'sync_dev_url', 'sync_dev_email', 'sync_dev_pass',
      'sync_prod_url', 'sync_prod_email', 'sync_prod_pass']) {
      if (this.s[k] !== undefined) aiOnly[k] = this.s[k];
    }
    this.svc.update(aiOnly).subscribe({
      next: () => { this.saving.set(false); this.savedAt.set(new Date().toLocaleTimeString()); },
      error: () => this.saving.set(false),
    });
  }

  addModel() {
    this.modelError.set(null);
    if (!this.draft.model_id.trim() || !this.draft.label.trim()) {
      this.modelError.set('Model ID and label are required.');
      return;
    }
    if (this.draft.provider === 'openai_compatible' && !this.draft.custom_endpoint.trim()) {
      this.modelError.set('Custom endpoint URL is required for openai_compatible models.');
      return;
    }
    this.addingModel.set(true);
    this.api.createCustomAiModel({
      model_id:        this.draft.model_id.trim(),
      label:           this.draft.label.trim(),
      provider:        this.draft.provider,
      supports_search: this.draft.supports_search,
      custom_endpoint: this.draft.custom_endpoint.trim() || null,
    }).subscribe({
      next: () => {
        this.addingModel.set(false);
        this.draft = BLANK_DRAFT();
        this.loadCustomModels();
      },
      error: e => {
        this.addingModel.set(false);
        this.modelError.set(e?.error?.error || 'Failed to add model');
      },
    });
  }

  async deleteModel(m: CustomAiModel) {
    const ok = await this.dialog.confirm(`Remove custom model "${m.label}" (${m.model_id})?`, {
      title: 'Remove custom model',
      confirmLabel: 'Remove',
      variant: 'danger',
    });
    if (!ok) return;
    this.api.deleteCustomAiModel(m.id).subscribe(() => this.loadCustomModels());
  }
}
