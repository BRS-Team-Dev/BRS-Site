import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import { Lead, LeadStatus } from '../../core/models';
import { AI_MODELS, AiModel } from '../../core/ai-models';

type LeadField = 'name' | 'email' | 'phone' | 'company' | 'address' | 'url' | 'status' | 'source';
type Mapping = Record<LeadField, number>; // -1 means unmapped

const ALL_FIELDS: { key: LeadField; label: string; required?: boolean }[] = [
  { key: 'name',    label: 'Name', required: true },
  { key: 'email',   label: 'Email' },
  { key: 'phone',   label: 'Phone' },
  { key: 'company', label: 'Company' },
  { key: 'address', label: 'Address' },
  { key: 'url',     label: 'Website / URL' },
  { key: 'status',  label: 'Status' },
  { key: 'source',  label: 'Source' },
];

const FIELD_PATTERNS: Record<LeadField, RegExp[]> = {
  // company picks first so that "Company / Provider" doesn't get grabbed
  // as `name` — auto-mapping iterates fields in this object order.
  company: [/company/i, /provider/i, /organi[sz]ation/i, /business/i],
  email:   [/e-?mail/i],
  phone:   [/phone/i, /\btel(ephone)?\b/i, /mobile/i, /contact\s*(no|number)/i],
  address: [/address/i, /location/i, /\bstreet\b/i],
  url:     [/url/i, /website/i, /\blink\b/i, /profile/i, /\bweb\b/i],
  status:  [/status/i, /\bstage\b/i],
  source:  [/source/i, /origin/i],
  // Run last so it doesn't beat company/etc on ambiguous headers.
  name:    [/\bname\b/i, /agency/i, /branch/i, /\bcontact\b/i, /\blead\b/i],
};

const HEADER_KEYWORDS = ['name', 'email', 'phone', 'company', 'address', 'status', 'source', 'url', 'website', 'agency', 'provider', 'profile'];

const ALLOWED_STATUSES: LeadStatus[] = ['new', 'contacted', 'qualified', 'converted', 'rejected'];

/**
 * Lead Gen — bulk-import lists into the Leads table.
 *   /admin/leadgen
 *
 * Frontend parses xlsx/xls/csv via SheetJS (lazy-loaded), auto-detects the
 * header row + column mapping, lets the user override, then POSTs the
 * mapped rows as JSON to /api/leads/bulk for batch insert.
 */
@Component({
  selector: 'app-leadgen-admin',
  imports: [FormsModule, RouterLink],
  template: `
    <div class="toolbar">
      <h1>Lead Gen</h1>
      <span class="spacer"></span>
      @if (hasInput()) {
        <button class="ghost" (click)="reset()">Start over</button>
      }
    </div>

    @if (!hasInput()) {
      <div class="card">
        <h2>AI Generated List</h2>
        <p class="muted small">Describe what kind of leads you want. The search model researches with web access (where supported); the format model coerces the result into the lead schema. Generated rows always go through the preview/review step before being saved — verify before contacting.</p>
        <p class="muted small">🔑 No API keys yet? <a routerLink="/admin/leadgen/settings">Configure provider keys →</a></p>
        <div class="meta-row">
          <div class="meta-field">
            <label>Search model</label>
            <select [(ngModel)]="aiSearchModel" name="ai_search_model">
              @for (m of aiSearchModels; track m.id) {
                <option [value]="m.id">{{ m.label }}{{ m.search ? ' · web search' : '' }}</option>
              }
            </select>
          </div>
          <div class="meta-field">
            <label>Format model</label>
            <select [(ngModel)]="aiFormatModel" name="ai_format_model">
              <option value="">— same as search model —</option>
              @for (m of aiModels; track m.id) {
                <option [value]="m.id">{{ m.label }}</option>
              }
            </select>
          </div>
        </div>
        <label>Prompt</label>
        <textarea [(ngModel)]="aiPrompt" name="ai_prompt" rows="4" placeholder="e.g. Find 50 small homecare agencies registered with the CQC within 10 miles of Camden, London. Include phone, address, and website."></textarea>
        <div class="actions-bar">
          <button class="primary" [disabled]="aiGenerating() || !aiPrompt.trim()" (click)="generateAi()">
            {{ aiGenerating() ? 'Generating…' : '✨ Generate' }}
          </button>
        </div>
        @if (aiError()) { <div class="error-msg">{{ aiError() }}</div> }
      </div>

      <div class="card upload">
        <h2>Import a list</h2>
        <p class="muted">Upload an Excel (.xlsx, .xls) or CSV file. Each row becomes a lead. Columns are matched automatically — you'll be able to review and override the mapping before importing.</p>
        <label class="file-drop" [class.dragging]="dragging()" (dragover)="onDragOver($event)" (dragleave)="onDragLeave($event)" (drop)="onDrop($event)">
          <input type="file" accept=".xlsx,.xls,.csv" (change)="onFileChange($event)" hidden #fileInput />
          @if (parsing()) {
            <span>Parsing…</span>
          } @else {
            <span>📂 Drop a file here, or <button class="link" type="button" (click)="fileInput.click()">browse</button></span>
          }
        </label>
        @if (parseError()) { <div class="error-msg">{{ parseError() }}</div> }
      </div>
    } @else {
      <div class="card">
        <h2>{{ aiLeads().length > 0 ? 'AI · ' + aiSearchModel : 'File · ' + filename() }}</h2>
        <div class="meta-row">
          <div class="meta-field">
            @if (aiLeads().length > 0) {
              <label>Source</label>
              <div class="value">AI generated · {{ aiLeads().length }} lead{{ aiLeads().length === 1 ? '' : 's' }}</div>
            } @else {
              <label>Detected rows</label>
              <div class="value">{{ rows().length }} data rows ({{ headers().length }} columns)</div>
            }
          </div>
          <div class="meta-field">
            <label>Default source</label>
            <input type="text" [(ngModel)]="defaultSource" name="default_source" placeholder="e.g. CQC London Homecare 2026-05" />
          </div>
          <div class="meta-field">
            <label>Default status</label>
            <select [(ngModel)]="defaultStatus" name="default_status">
              @for (s of allowedStatuses; track s) { <option [value]="s">{{ s }}</option> }
            </select>
          </div>
        </div>
        @if (aiLeads().length > 0) {
          <p class="muted small">⚠ AI-generated. Verify each row before contacting — model may have invented details.</p>
        } @else {
          <p class="muted small">Source is stamped on every imported lead that doesn't already have one in its sheet. Status is used when the row's status cell is empty or unrecognised.</p>
        }
      </div>

      @if (aiLeads().length === 0) {
        <div class="card">
          <h2>Column mapping</h2>
          <p class="muted small">Match each lead field to a column in your sheet. Fields marked with <span class="req">*</span> are required.</p>
          <div class="map-grid">
            @for (f of allFields; track f.key) {
              <div class="map-row">
                <label>{{ f.label }}@if (f.required) { <span class="req">*</span> }</label>
                <select [ngModel]="mapping()[f.key]" (ngModelChange)="setMapping(f.key, $event)" [name]="'map_' + f.key">
                  <option [ngValue]="-1">— (skip) —</option>
                  @for (h of headers(); track $index) {
                    <option [ngValue]="$index">{{ h || '(column ' + ($index + 1) + ')' }}</option>
                  }
                </select>
              </div>
            }
          </div>
        </div>
      }

      <div class="card">
        <h2>Preview</h2>
        <p class="muted small">First {{ previewRows().length }} of {{ validLeadCount() }} valid leads. Rows are kept if they have either a contact name or a company; company-only rows use the company as the lead name.</p>
        <div class="table-wrap">
          <table class="data">
            <thead><tr>
              @for (f of activeFields(); track f.key) { <th>{{ f.label }}</th> }
            </tr></thead>
            <tbody>
              @for (l of previewRows(); track $index) {
                <tr>
                  @for (f of activeFields(); track f.key) {
                    <td>{{ leadValue(l, f.key) || '—' }}</td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>

      @if (importError()) { <div class="error-msg">{{ importError() }}</div> }
      @if (importResult(); as r) {
        <div class="success-msg">
          ✓ Imported {{ r.inserted }} lead{{ r.inserted === 1 ? '' : 's' }}.
          @if (r.errors.length > 0) {
            <span> {{ r.errors.length }} row{{ r.errors.length === 1 ? '' : 's' }} skipped:</span>
            <ul class="error-list">
              @for (e of r.errors; track $index) {
                <li>Row {{ e.row }}: {{ e.error }}</li>
              }
            </ul>
          }
        </div>
      }

      <div class="actions-bar">
        <button class="primary" [disabled]="importing() || validLeadCount() === 0" (click)="doImport()">
          {{ importing() ? 'Importing…' : 'Import ' + validLeadCount() + ' lead' + (validLeadCount() === 1 ? '' : 's') }}
        </button>
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .upload { text-align: center; }
    .file-drop {
      display: flex; align-items: center; justify-content: center;
      min-height: 140px;
      border: 2px dashed var(--line); border-radius: var(--radius);
      cursor: pointer;
      transition: border-color 0.15s, background 0.15s;
      margin-top: 16px; padding: 20px;
      color: var(--muted); font-size: 14px;
    }
    .file-drop:hover, .file-drop.dragging {
      border-color: var(--primary);
      background: var(--bg-3);
    }
    button.link {
      background: transparent; border: none; padding: 0;
      color: var(--primary); cursor: pointer;
      text-decoration: underline; font-size: inherit;
    }
    button.link:hover { color: var(--primary-2); background: transparent; border: none; }
    .meta-row { display: flex; gap: 12px; flex-wrap: wrap; align-items: end; }
    .meta-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 200px; }
    .meta-field label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
    .meta-field .value { color: var(--fg); font-size: 14px; }
    .map-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
    .map-row { display: flex; flex-direction: column; gap: 4px; }
    .map-row label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
    .actions-bar { display: flex; justify-content: flex-end; padding: 16px 0; }
    .error-list { margin: 8px 0 0 0; padding-left: 18px; max-height: 160px; overflow-y: auto; font-size: 12px; }
    .req { color: var(--primary); margin-left: 2px; }
    .card + .card { margin-top: 16px; }
  `],
})
export class LeadgenAdmin {
  private api = inject(Api);

  allFields = ALL_FIELDS;
  allowedStatuses = ALLOWED_STATUSES;

  // File-import state
  filename = signal<string>('');
  rows = signal<any[][]>([]);
  headers = signal<string[]>([]);
  mapping = signal<Mapping>(this.emptyMapping());
  defaultSource = '';
  defaultStatus: LeadStatus = 'new';

  parsing = signal(false);
  parseError = signal<string | null>(null);
  importing = signal(false);
  importError = signal<string | null>(null);
  importResult = signal<{ inserted: number; errors: { row: number; error: string }[] } | null>(null);

  dragging = signal(false);

  // AI-generation state. When `aiLeads()` is non-empty the review screen
  // skips the column-mapping step and feeds the AI rows straight into the
  // shared preview/import flow.
  // Models start with the static built-ins and get replaced once the
  // backend's merged list (built-ins + user-added rows) loads.
  aiModelsSig = signal<AiModel[]>(AI_MODELS);
  get aiModels() { return this.aiModelsSig(); }
  get aiSearchModels(): AiModel[] { return this.aiModelsSig().filter(m => m.search); }
  aiSearchModel = AI_MODELS.find(m => m.search)?.id ?? AI_MODELS[0].id;
  aiFormatModel = '';
  aiPrompt = '';
  aiGenerating = signal(false);
  aiError = signal<string | null>(null);
  aiLeads = signal<Partial<Lead>[]>([]);

  /** Either source has loaded leads → review/import section is visible. */
  hasInput = computed(() => this.rows().length > 0 || this.aiLeads().length > 0);

  /** Fields the user has actually mapped to a column (file mode), or every
   *  field with at least one non-empty value (AI mode). */
  activeFields = computed(() => {
    if (this.aiLeads().length > 0) {
      const present = new Set<LeadField>();
      for (const l of this.aiLeads()) {
        for (const f of ALL_FIELDS) {
          if ((l as any)[f.key]) present.add(f.key);
        }
      }
      return ALL_FIELDS.filter(f => present.has(f.key) || f.required);
    }
    return ALL_FIELDS.filter(f => this.mapping()[f.key] >= 0);
  });

  /** All leads that would be inserted. Pulls from AI when present, else
   *  builds from the parsed file rows + column mapping. Default source/status
   *  are applied in both paths. */
  validLeads = computed<Partial<Lead>[]>(() => {
    if (this.aiLeads().length > 0) return this.applyDefaultsToAi(this.aiLeads());
    return this.buildLeads(this.rows(), this.mapping());
  });
  validLeadCount = computed(() => this.validLeads().length);
  previewRows = computed(() => this.validLeads().slice(0, 10));

  private applyDefaultsToAi(leads: Partial<Lead>[]): Partial<Lead>[] {
    const ds = this.defaultSource.trim();
    return leads.map(l => ({
      ...l,
      status: ((l.status as LeadStatus) ?? this.defaultStatus),
      source: l.source || ds || undefined,
    }));
  }

  ngOnInit() {
    // Pull the merged registry (built-ins + user-added) from the backend.
    // Falls back silently to the static built-in list on error.
    this.api.listAiModels().subscribe({
      next: r => {
        if (r.models?.length) this.aiModelsSig.set(r.models);
      },
      error: () => {/* silent — keep built-in defaults */},
    });
  }

  generateAi() {
    const prompt = this.aiPrompt.trim();
    if (!prompt) return;
    this.aiGenerating.set(true);
    this.aiError.set(null);
    this.api.aiGenerateLeads(this.aiSearchModel, this.aiFormatModel || null, prompt).subscribe({
      next: r => {
        this.aiGenerating.set(false);
        this.aiLeads.set(r.leads || []);
        if (!this.defaultSource) {
          this.defaultSource = `AI · ${this.aiSearchModel} · ${new Date().toISOString().slice(0, 10)}`;
        }
      },
      error: e => {
        this.aiGenerating.set(false);
        this.aiError.set(e?.error?.error || 'Generation failed');
      },
    });
  }

  setMapping(field: LeadField, columnIndex: number) {
    this.mapping.set({ ...this.mapping(), [field]: columnIndex });
  }

  onDragOver(e: DragEvent) { e.preventDefault(); this.dragging.set(true); }
  onDragLeave(e: DragEvent) { e.preventDefault(); this.dragging.set(false); }
  onDrop(e: DragEvent) {
    e.preventDefault();
    this.dragging.set(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) this.parseFile(f);
  }
  onFileChange(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) this.parseFile(f);
  }

  private async parseFile(file: File) {
    this.parsing.set(true);
    this.parseError.set(null);
    this.importResult.set(null);
    this.filename.set(file.name);
    try {
      const buf = await file.arrayBuffer();
      const XLSX = await import('xlsx');
      const wb = XLSX.read(buf, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) throw new Error('No sheets found in workbook');
      const all = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, raw: false, defval: '' });
      if (all.length === 0) throw new Error('Sheet is empty');

      const headerIdx = this.findHeaderRowIndex(all);
      const headerRow = (all[headerIdx] ?? []).map(c => String(c ?? '').trim());
      const dataRows = all.slice(headerIdx + 1)
        .filter(r => Array.isArray(r) && r.some(c => c != null && String(c).trim() !== ''));

      this.headers.set(headerRow);
      this.rows.set(dataRows);
      this.mapping.set(this.autoMap(headerRow));
    } catch (e: any) {
      this.parseError.set(e?.message || 'Failed to parse file');
      this.rows.set([]);
      this.headers.set([]);
    } finally {
      this.parsing.set(false);
    }
  }

  /** Scan the first ~10 rows; pick the first one that looks like headers
   *  (≥ 2 cells matching known keywords). Falls back to row 0. */
  private findHeaderRowIndex(rows: any[][]): number {
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const row = rows[i];
      if (!Array.isArray(row)) continue;
      const matches = row.filter(c => {
        if (typeof c !== 'string') return false;
        const s = c.toLowerCase();
        return HEADER_KEYWORDS.some(kw => s.includes(kw));
      }).length;
      if (matches >= 2) return i;
    }
    return 0;
  }

  /** Best-effort header → field mapping. User can override in the UI. */
  private autoMap(headers: string[]): Mapping {
    const map = this.emptyMapping();
    for (const field of Object.keys(FIELD_PATTERNS) as LeadField[]) {
      for (let i = 0; i < headers.length; i++) {
        if (map[field] !== -1) break;
        const h = headers[i] || '';
        if (FIELD_PATTERNS[field].some(p => p.test(h))) {
          // skip columns already claimed by a higher-priority field
          if (Object.values(map).includes(i)) continue;
          map[field] = i;
        }
      }
    }
    return map;
  }

  private emptyMapping(): Mapping {
    return { name: -1, email: -1, phone: -1, company: -1, address: -1, url: -1, status: -1, source: -1 };
  }

  private buildLeads(rows: any[][], mapping: Mapping): Partial<Lead>[] {
    const out: Partial<Lead>[] = [];
    for (const row of rows) {
      const get = (idx: number) => idx < 0 ? '' : String(row[idx] ?? '').trim();
      const personName = get(mapping.name);
      const company    = get(mapping.company);
      // Accept any row that has SOMETHING to identify the lead — a person
      // name OR a company name. Lists of newly-established providers
      // typically only have the business name at this stage; dropping
      // them because there's no human contact yet loses 90%+ of the
      // dataset. When no person is supplied we use the company as the
      // lead's display name so the row is still saveable + searchable.
      if (!personName && !company) continue;
      const name = personName || company;
      const email = get(mapping.email);
      const rawStatus = get(mapping.status).toLowerCase();
      const status = (ALLOWED_STATUSES as string[]).includes(rawStatus)
        ? (rawStatus as LeadStatus)
        : this.defaultStatus;
      out.push({
        name,
        email:   email || undefined,
        phone:   get(mapping.phone)   || undefined,
        company: company || undefined,
        address: get(mapping.address) || undefined,
        url:     get(mapping.url)     || undefined,
        status,
        source:  get(mapping.source)  || this.defaultSource || undefined,
      });
    }
    return out;
  }

  leadValue(l: Partial<Lead>, key: LeadField): string {
    const v = (l as any)[key];
    return v == null ? '' : String(v);
  }

  doImport() {
    const leads = this.validLeads();
    if (leads.length === 0) return;
    this.importing.set(true);
    this.importError.set(null);
    this.importResult.set(null);
    this.api.bulkCreateLeads(leads).subscribe({
      next: r => {
        this.importing.set(false);
        this.importResult.set(r);
      },
      error: e => {
        this.importing.set(false);
        this.importError.set(e?.error?.error || 'Import failed');
      },
    });
  }

  reset() {
    this.filename.set('');
    this.rows.set([]);
    this.headers.set([]);
    this.mapping.set(this.emptyMapping());
    this.defaultSource = '';
    this.defaultStatus = 'new';
    this.parseError.set(null);
    this.importError.set(null);
    this.importResult.set(null);
    this.aiLeads.set([]);
    this.aiPrompt = '';
    this.aiError.set(null);
  }
}
