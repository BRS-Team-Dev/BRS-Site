import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import { Tender, TenderStatus } from '../../core/models';
import { DEFAULT_SECTIONS } from './tender-section-defaults';

/**
 * Bulk import for tenders. Modelled on the file-import half of leadgen-admin.
 * SheetJS parses xlsx/xls/csv in the browser, columns are auto-mapped against
 * the tender schema, the user reviews + overrides the mapping, then valid
 * rows are POSTed to /api/tenders/bulk.
 *
 * In addition to the base tender fields, the importer recognises one
 * yes/no column per default section (Application form, Proposal, etc.) plus
 * a "Custom sections" comma-separated column. Selected sections are sent
 * as `sections: [{slug, label}]` per tender and inserted into
 * tender_document_sections in the same transaction as the tender row.
 *
 * Lives at /operations/tenders/import. Entry point is the "Import list"
 * button on the tenders list toolbar.
 */
type BaseField =
  | 'title' | 'buyer' | 'reference' | 'value' | 'currency' | 'category'
  | 'source_url' | 'submission_deadline' | 'decision_date' | 'status' | 'notes';

/** Slug of a default-section column, or the special "custom" extras column. */
type SectionField = string; // narrows at usage sites; values are DEFAULT_SECTIONS[].slug | 'custom_sections'

type BaseMapping    = Record<BaseField, number>;
type SectionMapping = Record<SectionField, number>;

const BASE_FIELDS: { key: BaseField; label: string; required?: boolean }[] = [
  { key: 'title',               label: 'Title', required: true },
  { key: 'buyer',               label: 'Buyer' },
  { key: 'reference',           label: 'Reference' },
  { key: 'value',               label: 'Value' },
  { key: 'currency',            label: 'Currency' },
  { key: 'category',            label: 'Category' },
  { key: 'source_url',          label: 'Source URL' },
  { key: 'submission_deadline', label: 'Submission deadline' },
  { key: 'decision_date',       label: 'Decision date' },
  { key: 'status',              label: 'Status' },
  { key: 'notes',               label: 'Notes' },
];

// Section columns: 9 yes/no defaults + 1 comma-separated extras column.
const SECTION_FIELDS: { key: string; label: string }[] = [
  ...DEFAULT_SECTIONS.map(s => ({ key: s.slug, label: s.label })),
  { key: 'custom_sections', label: 'Custom sections' },
];

// Order matters — earlier entries get first claim on ambiguous headers.
const BASE_PATTERNS: Record<BaseField, RegExp[]> = {
  reference:           [/reference/i, /\bref\b/i, /tender.?(no|number|id)/i, /procurement.?id/i],
  buyer:               [/buyer/i, /customer/i, /\bclient\b/i, /(contract(ing)?\s*)?authority/i, /procur(ing|ement)/i, /commission(er|ing)/i],
  value:               [/\bvalue\b/i, /amount/i, /budget/i, /\bworth\b/i, /contract\s*value/i, /\bprice\b/i],
  currency:            [/currency/i, /\bccy\b/i],
  category:            [/category/i, /sector/i, /\btype\b/i, /\bcpv\b/i],
  source_url:          [/\burl\b/i, /\blink\b/i, /website/i, /portal/i, /source.?link/i],
  submission_deadline: [/deadline/i, /closing\s*date/i, /submission.?date/i, /submit.?by/i, /\bdue\b/i],
  decision_date:       [/decision/i, /award.?date/i, /result.?date/i, /outcome.?date/i],
  status:              [/status/i, /\bstage\b/i, /\bstate\b/i],
  notes:               [/\bnotes?\b/i, /comments?/i, /remarks/i, /description/i],
  // Run last so it doesn't beat reference / buyer on ambiguous headers.
  title:               [/\btitle\b/i, /tender/i, /opportunity/i, /\bname\b/i, /subject/i],
};

const SECTION_PATTERNS: Record<string, RegExp[]> = {
  application_form:       [/application\s*form/i, /\bsq\s*form\b/i],
  pricing_schedule:       [/pricing/i, /price\s*schedule/i, /rate\s*card/i, /pricing\s*matrix/i],
  questionnaire:          [/questionnaire/i, /\bpqq\b/i, /\bsq\b/i, /selection\s*questionnaire/i],
  proposal:               [/proposal/i, /method(ology)?/i, /technical\s*doc/i],
  case_studies:           [/case\s*stud(ies|y)/i, /past\s*projects?/i],
  references:             [/^references?$/i, /testimonials?/i, /^refs?$/i],
  pitch_deck:             [/pitch\s*deck/i, /presentation/i, /\bslides\b/i],
  insurance_certificates: [/insurance/i, /\bpii\b/i, /public\s*liability/i, /\bel\s*cert/i, /\bcerts?\b/i],
  financials_accounts:    [/financ(ial|e)s?/i, /accounts/i, /balance\s*sheet/i],
  custom_sections:        [/custom\s*sections?/i, /extra\s*sections?/i, /additional\s*(doc|section)/i, /other\s*sections?/i],
};

const HEADER_KEYWORDS = [
  'title', 'tender', 'buyer', 'authority', 'reference', 'value', 'amount',
  'currency', 'category', 'deadline', 'closing', 'status', 'url', 'link', 'notes',
  'application', 'pricing', 'questionnaire', 'proposal', 'case', 'references',
  'pitch', 'insurance', 'financials',
];

const ALLOWED_STATUSES: TenderStatus[] = ['planning', 'drafting', 'submitted', 'awarded', 'rejected', 'withdrawn'];

const TRUTHY_VALUES = new Set(['yes', 'y', 'true', '1', 'x', '✓', 'tick', 'on']);
const FALSY_NA_VALUES = new Set(['no', 'n', 'false', '0', 'n/a', 'na', 'off', '']);

/** Loose slugify mirroring the front-end tenders-admin convention. */
function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

@Component({
  selector: 'app-tenders-import',
  imports: [FormsModule, RouterLink],
  template: `
    <div class="toolbar">
      <button class="ghost" routerLink="/operations/tenders">← Back</button>
      <h1>Import tenders</h1>
      <span class="spacer"></span>
      @if (hasInput()) {
        <button class="ghost" (click)="reset()">Start over</button>
      }
    </div>

    @if (!hasInput()) {
      <div class="card upload">
        <h2>Import a list</h2>
        <p class="muted">Upload an Excel (.xlsx, .xls) or CSV file. Each row becomes a tender. Columns are matched automatically — you'll be able to review and override the mapping before importing.</p>
        <p class="muted small">Tip: add one column per required document (Application form, Proposal, etc.) with <code>yes</code> / <code>no</code> / <code>n/a</code> values to attach sections to each tender. Use a <code>Custom sections</code> column for anything extra (comma-separated).</p>
        <label class="file-drop" [class.dragging]="dragging()" (dragover)="onDragOver($event)" (dragleave)="onDragLeave($event)" (drop)="onDrop($event)">
          <input type="file" accept=".xlsx,.xls,.csv" (change)="onFileChange($event)" hidden #fileInput />
          @if (parsing()) {
            <span>Parsing…</span>
          } @else {
            <span>
              <svg class="upload-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v12"/><path d="M7 9l5-5 5 5"/><path d="M5 17v3h14v-3"/></svg>
              Drop a file here, or <button class="link" type="button" (click)="fileInput.click()">browse</button>
            </span>
          }
        </label>
        @if (parseError()) { <div class="error-msg">{{ parseError() }}</div> }
      </div>
    } @else {
      <div class="card">
        <h2>File · {{ filename() }}</h2>
        <div class="meta-row">
          <div class="meta-field">
            <label>Detected rows</label>
            <div class="value">{{ rows().length }} data rows ({{ headers().length }} columns)</div>
          </div>
          <div class="meta-field">
            <label>Default currency</label>
            <input type="text" [(ngModel)]="defaultCurrency" name="default_currency" maxlength="3" placeholder="GBP" />
          </div>
          <div class="meta-field">
            <label>Default status</label>
            <select [(ngModel)]="defaultStatus" name="default_status">
              @for (s of allowedStatuses; track s) { <option [value]="s">{{ s }}</option> }
            </select>
          </div>
        </div>
        <p class="muted small">Defaults apply when the row's cell is empty or unrecognised.</p>
      </div>

      <div class="card">
        <h2>Column mapping</h2>
        <p class="muted small">Match each tender field to a column in your sheet. <span class="req">★</span> = required.</p>
        <div class="map-grid">
          @for (f of baseFields; track f.key) {
            <div class="map-row">
              <label>{{ f.label }}@if (f.required) { <span class="req">★</span> }</label>
              <select [ngModel]="baseMapping()[f.key]" (ngModelChange)="setBaseMapping(f.key, $event)" [name]="'map_' + f.key">
                <option [ngValue]="-1">— (skip) —</option>
                @for (h of headers(); track $index) {
                  <option [ngValue]="$index">{{ h || '(column ' + ($index + 1) + ')' }}</option>
                }
              </select>
            </div>
          }
        </div>

        <div class="section-divider">
          <h3>Required documents</h3>
          <p class="muted small">Map each default section to a yes/no/n/a column. Truthy values (<code>yes</code>, <code>y</code>, <code>1</code>, <code>x</code>, <code>✓</code>) attach the section; everything else (<code>no</code>, <code>n/a</code>, blank) skips it. The <strong>Custom sections</strong> column is a comma-separated list of extra section names.</p>
        </div>
        <div class="map-grid">
          @for (f of sectionFields; track f.key) {
            <div class="map-row">
              <label>{{ f.label }}</label>
              <select [ngModel]="sectionMapping()[f.key]" (ngModelChange)="setSectionMapping(f.key, $event)" [name]="'sec_' + f.key">
                <option [ngValue]="-1">— (skip) —</option>
                @for (h of headers(); track $index) {
                  <option [ngValue]="$index">{{ h || '(column ' + ($index + 1) + ')' }}</option>
                }
              </select>
            </div>
          }
        </div>
      </div>

      <div class="card">
        <h2>Preview</h2>
        <p class="muted small">First {{ previewRows().length }} of {{ validTenderCount() }} valid tenders. Rows missing a title are skipped.</p>
        <div class="table-wrap">
          <table class="data">
            <thead><tr>
              @for (f of activeBaseFields(); track f.key) { <th>{{ f.label }}</th> }
              @if (anySectionMapped()) { <th>Required documents</th> }
            </tr></thead>
            <tbody>
              @for (t of previewRows(); track $index) {
                <tr>
                  @for (f of activeBaseFields(); track f.key) {
                    <td>{{ tenderValue(t, f.key) || '—' }}</td>
                  }
                  @if (anySectionMapped()) {
                    <td class="sections-cell">
                      @if (t.sections && t.sections.length > 0) {
                        @for (s of t.sections; track s.slug) { <span class="sec-chip">{{ s.label }}</span> }
                      } @else { — }
                    </td>
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
          ✓ Imported {{ r.inserted }} tender{{ r.inserted === 1 ? '' : 's' }}.
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
        <button class="primary" [disabled]="importing() || validTenderCount() === 0" (click)="doImport()">
          {{ importing() ? 'Importing…' : 'Import ' + validTenderCount() + ' tender' + (validTenderCount() === 1 ? '' : 's') }}
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
    .upload-icon { width: 16px; height: 16px; vertical-align: -3px; margin-right: 6px; }
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
    .section-divider {
      margin: 20px 0 12px;
      padding-top: 16px;
      border-top: 1px solid var(--line);
    }
    .section-divider h3 {
      font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;
      color: var(--muted); margin: 0 0 4px; font-weight: 600;
    }
    .sections-cell { line-height: 1.8; }
    .sec-chip {
      display: inline-block;
      background: var(--bg-3);
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 2px 10px;
      font-size: 11px;
      margin-right: 4px;
      white-space: nowrap;
    }
    .actions-bar { display: flex; justify-content: flex-end; padding: 16px 0; }
    .error-list { margin: 8px 0 0 0; padding-left: 18px; max-height: 160px; overflow-y: auto; font-size: 12px; }
    .req { color: var(--primary); margin-left: 2px; }
    .card + .card { margin-top: 16px; }
    code { background: var(--bg-2); padding: 1px 4px; border-radius: 3px; font-size: 12px; }
  `],
})
export class TendersImport {
  private api = inject(Api);

  baseFields = BASE_FIELDS;
  sectionFields = SECTION_FIELDS;
  allowedStatuses = ALLOWED_STATUSES;

  filename = signal<string>('');
  rows = signal<any[][]>([]);
  headers = signal<string[]>([]);
  baseMapping    = signal<BaseMapping>(this.emptyBaseMapping());
  sectionMapping = signal<SectionMapping>(this.emptySectionMapping());
  defaultCurrency = 'GBP';
  defaultStatus: TenderStatus = 'planning';

  parsing = signal(false);
  parseError = signal<string | null>(null);
  importing = signal(false);
  importError = signal<string | null>(null);
  importResult = signal<{ inserted: number; errors: { row: number; error: string }[] } | null>(null);

  dragging = signal(false);

  hasInput = computed(() => this.rows().length > 0);

  activeBaseFields = computed(() => BASE_FIELDS.filter(f => this.baseMapping()[f.key] >= 0));
  anySectionMapped = computed(() => Object.values(this.sectionMapping()).some(v => v >= 0));

  validTenders = computed<(Partial<Tender> & { sections: { slug: string; label: string }[] })[]>(() =>
    this.buildTenders(this.rows(), this.baseMapping(), this.sectionMapping())
  );
  validTenderCount = computed(() => this.validTenders().length);
  previewRows = computed(() => this.validTenders().slice(0, 10));

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

  setBaseMapping(field: BaseField, columnIndex: number) {
    this.baseMapping.set({ ...this.baseMapping(), [field]: columnIndex });
  }
  setSectionMapping(field: SectionField, columnIndex: number) {
    this.sectionMapping.set({ ...this.sectionMapping(), [field]: columnIndex });
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
      this.baseMapping.set(this.autoMapBase(headerRow));
      this.sectionMapping.set(this.autoMapSections(headerRow));
    } catch (e: any) {
      this.parseError.set(e?.message || 'Failed to parse file');
      this.rows.set([]);
      this.headers.set([]);
    } finally {
      this.parsing.set(false);
    }
  }

  /** Scan first ~10 rows; pick the first that looks like headers. */
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

  private autoMapBase(headers: string[]): BaseMapping {
    const map = this.emptyBaseMapping();
    for (const field of Object.keys(BASE_PATTERNS) as BaseField[]) {
      for (let i = 0; i < headers.length; i++) {
        if (map[field] !== -1) break;
        const h = headers[i] || '';
        if (BASE_PATTERNS[field].some(p => p.test(h))) {
          if (Object.values(map).includes(i)) continue;
          map[field] = i;
        }
      }
    }
    return map;
  }

  private autoMapSections(headers: string[]): SectionMapping {
    const map = this.emptySectionMapping();
    for (const key of Object.keys(SECTION_PATTERNS)) {
      for (let i = 0; i < headers.length; i++) {
        if (map[key] !== -1) break;
        const h = headers[i] || '';
        if (SECTION_PATTERNS[key].some(p => p.test(h))) {
          if (Object.values(map).includes(i)) continue;
          map[key] = i;
        }
      }
    }
    return map;
  }

  private emptyBaseMapping(): BaseMapping {
    return {
      title: -1, buyer: -1, reference: -1, value: -1, currency: -1, category: -1,
      source_url: -1, submission_deadline: -1, decision_date: -1, status: -1, notes: -1,
    };
  }
  private emptySectionMapping(): SectionMapping {
    const m: SectionMapping = {};
    for (const f of SECTION_FIELDS) m[f.key] = -1;
    return m;
  }

  private buildTenders(
    rows: any[][],
    baseMap: BaseMapping,
    secMap: SectionMapping,
  ): (Partial<Tender> & { sections: { slug: string; label: string }[] })[] {
    const out: (Partial<Tender> & { sections: { slug: string; label: string }[] })[] = [];
    const defaultLabels = new Map(DEFAULT_SECTIONS.map(s => [s.slug, s.label]));

    for (const row of rows) {
      const get = (idx: number) => idx < 0 ? '' : String(row[idx] ?? '').trim();
      const title = get(baseMap.title);
      if (!title) continue;

      const rawStatus = get(baseMap.status).toLowerCase();
      const status = (ALLOWED_STATUSES as string[]).includes(rawStatus)
        ? (rawStatus as TenderStatus)
        : this.defaultStatus;

      const rawCurrency = get(baseMap.currency).toUpperCase();
      const currency = (rawCurrency.length === 3 ? rawCurrency : this.defaultCurrency.toUpperCase()) || 'GBP';

      const rawValue = get(baseMap.value).replace(/[, ]/g, '');
      const value = rawValue !== '' && !isNaN(Number(rawValue)) ? Number(rawValue) : null;

      // --- Collect required-document sections for this row ---
      const sections: { slug: string; label: string }[] = [];
      for (const slug of defaultLabels.keys()) {
        const colIdx = secMap[slug];
        if (colIdx < 0) continue;
        if (this.isTruthy(get(colIdx))) {
          sections.push({ slug, label: defaultLabels.get(slug)! });
        }
      }
      const customIdx = secMap['custom_sections'] ?? -1;
      if (customIdx >= 0) {
        const cell = get(customIdx);
        if (cell) {
          for (const raw of cell.split(/[,;|]/)) {
            const label = raw.trim();
            if (!label) continue;
            const slug = slugify(label);
            if (!slug) continue;
            // Skip if a default with the same slug was already added.
            if (sections.some(s => s.slug === slug)) continue;
            sections.push({ slug, label });
          }
        }
      }

      out.push({
        title,
        buyer:               get(baseMap.buyer)               || undefined,
        reference:           get(baseMap.reference)           || undefined,
        value:               value ?? undefined,
        currency,
        category:            get(baseMap.category)            || undefined,
        source_url:          get(baseMap.source_url)          || undefined,
        submission_deadline: get(baseMap.submission_deadline) || undefined,
        decision_date:       get(baseMap.decision_date)       || undefined,
        status,
        notes:               get(baseMap.notes)               || undefined,
        sections,
      });
    }
    return out;
  }

  private isTruthy(s: string): boolean {
    const v = s.trim().toLowerCase();
    return TRUTHY_VALUES.has(v);
  }

  tenderValue(t: Partial<Tender>, key: BaseField): string {
    const v = (t as any)[key];
    return v == null ? '' : String(v);
  }

  doImport() {
    const tenders = this.validTenders();
    if (tenders.length === 0) return;
    this.importing.set(true);
    this.importError.set(null);
    this.importResult.set(null);
    this.api.bulkCreateTenders(tenders).subscribe({
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
    this.baseMapping.set(this.emptyBaseMapping());
    this.sectionMapping.set(this.emptySectionMapping());
    this.defaultCurrency = 'GBP';
    this.defaultStatus = 'planning';
    this.parseError.set(null);
    this.importError.set(null);
    this.importResult.set(null);
  }
}
