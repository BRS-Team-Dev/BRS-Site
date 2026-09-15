import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { DialogService } from '../../core/dialog';
import { CompanyLeadDetail, UnifiedLead, UnifiedLeadSource } from '../../core/models';

/**
 * Amalgamated "Lead Gen" landing page. One table of EVERY lead across both
 * backend tables — the company_leads enrichment pipeline (Companies House +
 * LinkedIn) and the funnel `leads` table (AI prompt + imported + manual) —
 * with a Source column classifying the acquisition method. Same table + detail
 * format as the Companies House / LinkedIn pipeline pages (State icon grid,
 * grouped detail modal); this page is read/browse only — enrichment + promote
 * live on the per-source child pages.
 */
@Component({
  selector: 'app-leadgen-all',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="toolbar">
      <h1>Lead Gen</h1>
      <span class="spacer"></span>
      <input class="lg-search" type="text" placeholder="Search name / company / number…"
             [ngModel]="q()" (ngModelChange)="q.set($event)" />
      <select class="lg-source" [ngModel]="sourceFilter()" (ngModelChange)="sourceFilter.set($event)">
        <option value="">All sources ({{ rows().length }})</option>
        @for (s of sources(); track s.label) {
          <option [value]="s.label">{{ s.label }} ({{ s.count }})</option>
        }
      </select>
      <button class="ghost" (click)="reload()" [disabled]="loading()">{{ loading() ? 'Loading…' : '↻ Refresh' }}</button>
    </div>

    <p class="muted small lg-sub">Every company our acquisition methods have found, consolidated so each one appears once however many methods found it. Promoting moves a company into Leads and clears it from here and from its source lists. Bookings are not lead gen and are not listed.</p>

    @if (selectedCount() > 0) {
      <div class="lg-bulkbar">
        <strong>{{ selectedCount() }}</strong> selected
        <span class="muted small">({{ selectedRecordCount() }} underlying record{{ selectedRecordCount() === 1 ? '' : 's' }})</span>
        <span class="spacer"></span>
        <button class="ghost" (click)="clearSelection()" [disabled]="promoting()">Clear</button>
        <button class="primary" (click)="promoteSelected()" [disabled]="promoting()">
          {{ promoting() ? 'Promoting…' : 'Promote to Leads' }}
        </button>
      </div>
    }

    @if (loading()) { <p class="muted">Loading…</p> }
    @else if (!rows().length) { <p class="muted">No leads yet — capture some from Companies House, LinkedIn, the AI prompt, or an import.</p> }
    @else if (!filtered().length) { <p class="muted">No leads match. <button class="link-btn" (click)="clearFilters()">Clear filters</button></p> }
    @else {
      <div class="table-wrap">
        <table class="data">
          <thead><tr>
            <th class="lg-check">
              <input type="checkbox" [checked]="allSelected()" [indeterminate]="someSelected()"
                     (change)="toggleAll($event)" title="Select all shown" />
            </th>
            <th>Recorded</th><th>Source</th><th>State</th><th>Company</th><th>Number</th><th>Industry</th><th></th>
          </tr></thead>
          <tbody>
            @for (r of filtered(); track r.key) {
              <tr class="lg-row" [class.is-selected]="isSelected(r)" (click)="view(r)">
                <td class="lg-check" (click)="$event.stopPropagation()">
                  <input type="checkbox" [checked]="isSelected(r)" (change)="toggle(r)" />
                </td>
                <td class="lg-date">{{ recordedDate(r) }}</td>
                <td class="lg-sources">
                  @for (s of labelsOf(r); track s) {
                    <span class="src-chip" [style.--c]="sourceColor(s)">{{ s }}</span>
                  }
                  @if (r.ambiguous_name) {
                    <span class="lg-warn" title="Another company shares this name but has a different company number, so this record was left unmerged.">!</span>
                  }
                </td>
                <td class="cl-info-icons">
                  <div class="cl-ic-row" title="Company: address · website · LinkedIn · email · phone">
                    <svg class="cl-ic-lead" viewBox="0 0 24 24"><title>Company</title><path [attr.d]="leadCompanyPath" /></svg>
                    @for (ic of icons; track ic.key) {
                      <svg class="cl-ic" [class.on]="companyHas(r, ic.key)" [class.bad]="companyBad(r, ic.key)" viewBox="0 0 24 24"><title>Company · {{ ic.title }}</title><path [attr.d]="ic.path" /></svg>
                    }
                  </div>
                  <div class="cl-ic-row" title="Directors &amp; staff: address · LinkedIn · email · phone">
                    <svg class="cl-ic-lead" viewBox="0 0 24 24"><title>Directors &amp; staff</title><path [attr.d]="leadPeoplePath" /></svg>
                    @for (ic of icons; track ic.key) {
                      @if (ic.key !== 'website') {
                        <svg class="cl-ic" [class.on]="peopleHas(r, ic.key)" viewBox="0 0 24 24"><title>Person · {{ ic.title }}</title><path [attr.d]="ic.path" /></svg>
                      }
                    }
                  </div>
                </td>
                <td>
                  <strong>{{ r.company || r.name }}</strong>
                  @if ((r.member_count || 1) > 1) {
                    <span class="lg-merged" [title]="mergedTitle(r)">{{ r.member_count }} records</span>
                  }
                </td>
                <td>{{ r.company_number || '—' }}</td>
                <td class="lg-industry" [title]="r.industry || ''">{{ r.industry || '—' }}</td>
                <td class="lg-actions" (click)="$event.stopPropagation()">
                  <button class="ghost small" (click)="promoteOne(r)" [disabled]="promoting()">Promote</button>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }

    @if (error()) { <div class="error-msg">{{ error() }}</div> }

    @if (detail(); as d) {
      <div class="modal-backdrop" (click)="detail.set(null)">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-head">
            <h3>{{ d.company || d.name }}</h3>
            <button class="ghost" (click)="detail.set(null)">✕</button>
          </div>
          <div class="modal-body">
            <p class="muted small">
              <span class="src-chip" [style.--c]="sourceColor(d.source_label)">{{ d.source_label }}</span>
              @if (d.company_number) { · {{ d.company_number }} }
              @if (d.industry) { · {{ d.industry }} }
            </p>

            <h4>Company details</h4>
            <table class="data lg-info"><tbody>
              @for (i of companyFacts(); track $index) {
                <tr><td class="lg-key">{{ i.label }}</td>
                <td>@if (i.url) { <a [href]="i.url" target="_blank" rel="noopener">{{ i.value }}</a> } @else { {{ i.value }} }</td></tr>
              }
            </tbody></table>

            @if (loadingDetail()) { <p class="muted small">Loading pipeline detail…</p> }

            @if (infoRows().length) {
              <h4>Enrichment</h4>
              <table class="data lg-info"><tbody>
                @for (i of infoRows(); track $index) {
                  <tr><td class="lg-key">{{ i.label }}</td>
                  <td>@if (i.url) { <a [href]="i.url" target="_blank" rel="noopener">{{ i.value }}</a> } @else { {{ i.value }} }</td></tr>
                }
              </tbody></table>
            }

            @if (people().length) {
              <h4>People ({{ people().length }})</h4>
              <ul class="lg-people">
                @for (p of people(); track $index) {
                  <li>
                    <div class="lg-person-name">{{ p.name }}@if (p.role) { <span class="muted"> · {{ p.role }}</span> }</div>
                    <dl class="lg-person-detail">
                      @for (f of p.fields; track $index) {
                        <dt>{{ f.label }}</dt>
                        <dd>@if (f.url) { <a [href]="f.url" target="_blank" rel="noopener">{{ f.value }}</a> } @else { {{ f.value }} }</dd>
                      }
                    </dl>
                  </li>
                }
              </ul>
            }

            @if (d.notes) {
              <h4>Notes</h4>
              <p class="lg-notes">{{ d.notes }}</p>
            }
          </div>
          <div class="modal-foot">
            <span class="muted small">{{ d.origin === 'company_lead' ? 'Pipeline record' : 'Funnel lead' }}</span>
            <span class="spacer"></span>
            <button class="ghost" (click)="detail.set(null)">Close</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: block; padding: 20px; }
    .lg-sub { margin: -4px 0 14px; }

    /* Bulk action bar — only rendered while something is selected. */
    .lg-bulkbar {
      display: flex; align-items: center; gap: 10px; flex-wrap: nowrap;
      padding: 10px 14px; margin: 0 0 12px;
      background: var(--bg-2); border: 1px solid var(--primary);
      border-radius: var(--radius-sm);
    }
    .lg-bulkbar .spacer { flex: 1; }
    .lg-bulkbar button { white-space: nowrap; }

    .lg-check { width: 34px; text-align: center; }
    .lg-check input { cursor: pointer; }
    .lg-row.is-selected { outline: 1px solid var(--primary); outline-offset: -1px; }

    /* A consolidated row carries one chip per method that found it. */
    .lg-sources { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }

    .lg-merged {
      display: inline-block; margin-left: 8px; padding: 1px 6px;
      font-size: 10px; font-weight: 700; letter-spacing: 0.4px;
      text-transform: uppercase; white-space: nowrap;
      color: var(--muted); border: 1px solid var(--line); border-radius: 4px;
    }

    .lg-warn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 16px; height: 16px; border-radius: 50%;
      font-size: 10px; font-weight: 700; cursor: help;
      color: var(--warning); border: 1px solid var(--warning);
    }

    .lg-actions { text-align: right; white-space: nowrap; }
    .lg-actions button { white-space: nowrap; }
    .lg-search { flex: 0 1 240px; min-width: 140px; width: auto; }
    .lg-source { width: auto; min-width: 170px; }

    .lg-row { cursor: pointer; }
    .lg-date { white-space: nowrap; color: var(--muted); font-variant-numeric: tabular-nums; }
    .lg-industry { max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    /* Source pill — colour keyed per method via the --c custom property. */
    .src-chip {
      display: inline-block; padding: 2px 9px; border-radius: 999px;
      font-size: 11px; font-weight: 600; white-space: nowrap;
      color: var(--c, var(--primary));
      border: 1px solid color-mix(in srgb, var(--c, var(--primary)) 55%, transparent);
      background: color-mix(in srgb, var(--c, var(--primary)) 14%, transparent);
    }

    /* State icon grid — identical to the pipeline list. */
    .cl-info-icons { white-space: nowrap; }
    .cl-ic-row { display: flex; gap: 7px; align-items: center; }
    .cl-ic-row + .cl-ic-row { margin-top: 5px; }
    .cl-ic { width: 15px; height: 15px; fill: #5a5a5a; flex: none; }
    .cl-ic.on { fill: var(--primary); }
    .cl-ic.bad { fill: #e5484d; }
    .cl-ic-lead { width: 13px; height: 13px; fill: var(--muted); flex: none; margin-right: 3px; opacity: 0.7; }

    .link-btn { background: none; border: none; color: var(--primary); cursor: pointer; padding: 0; font: inherit; text-decoration: underline; }

    /* Detail modal — grouped sections (mirrors the pipeline modal). */
    .modal-body h4 { margin: 16px 0 6px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); }
    .modal-body h4:first-of-type { margin-top: 10px; }
    .lg-key { color: var(--muted); white-space: nowrap; width: 1%; vertical-align: top; }
    .lg-notes { white-space: pre-wrap; margin: 4px 0 6px; }
    .lg-people { list-style: none; padding: 0; margin: 4px 0 6px; }
    .lg-people li { padding: 8px 0; border-bottom: 1px solid var(--line); }
    .lg-people li:last-child { border-bottom: none; }
    .lg-person-name { font-weight: 600; }
    .lg-person-detail { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; margin: 4px 0 0; }
    .lg-person-detail dt { color: var(--muted); font-size: 12px; }
    .lg-person-detail dd { margin: 0; font-size: 13px; word-break: break-word; }
    .modal-foot { display: flex; align-items: center; gap: 8px; }
    .modal-foot .spacer { flex: 1; }
  `],
})
export class LeadgenAll {
  private api = inject(Api);
  private dialog = inject(DialogService);

  readonly rows = signal<UnifiedLead[]>([]);
  readonly sources = signal<UnifiedLeadSource[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly q = signal('');
  readonly sourceFilter = signal('');

  // Detail modal — the row plus (for pipeline records) lazily-fetched
  // info + contacts.
  readonly detail = signal<UnifiedLead | null>(null);
  readonly loadingDetail = signal(false);
  private readonly detailData = signal<CompanyLeadDetail | null>(null);

  // Selection is by row key. Held as a new Set on every change because this
  // app runs zoneless — mutating a Set in place would not retrigger the
  // computeds that read it.
  readonly selected = signal<Set<string>>(new Set());
  readonly promoting = signal(false);

  readonly selectedCount = computed(() => this.selected().size);
  /** How many underlying records the selection covers — a consolidated row
   *  can stand for several, and all of them get cleared on promote. */
  readonly selectedRecordCount = computed(() =>
    this.rows().filter(r => this.selected().has(r.key))
      .reduce((n, r) => n + (r.member_count || 1), 0));

  readonly allSelected = computed(() => {
    const f = this.filtered();
    return f.length > 0 && f.every(r => this.selected().has(r.key));
  });
  readonly someSelected = computed(() => {
    const f = this.filtered();
    const n = f.filter(r => this.selected().has(r.key)).length;
    return n > 0 && n < f.length;
  });

  constructor() { this.reload(); }

  isSelected(r: UnifiedLead) { return this.selected().has(r.key); }

  toggle(r: UnifiedLead) {
    const next = new Set(this.selected());
    next.has(r.key) ? next.delete(r.key) : next.add(r.key);
    this.selected.set(next);
  }

  /** Select-all applies to what is currently FILTERED, not the whole table —
   *  ticking the header box after filtering to "LinkedIn" should not quietly
   *  arm 200 Companies House rows for promotion. */
  toggleAll(ev: Event) {
    const on = (ev.target as HTMLInputElement).checked;
    const next = new Set(this.selected());
    for (const r of this.filtered()) { on ? next.add(r.key) : next.delete(r.key); }
    this.selected.set(next);
  }

  clearSelection() { this.selected.set(new Set()); }

  labelsOf(r: UnifiedLead): string[] {
    return r.source_labels?.length ? r.source_labels : [r.source_label];
  }

  mergedTitle(r: UnifiedLead): string {
    return 'Consolidated from ' + (r.members || [])
      .map(m => m.source_label + ' #' + m.id).join(', ');
  }

  promoteOne(r: UnifiedLead) { this.promote([r]); }
  promoteSelected() { this.promote(this.rows().filter(r => this.selected().has(r.key))); }

  private promote(targets: UnifiedLead[]) {
    if (!targets.length || this.promoting()) return;

    const records = targets.reduce((n, r) => n + (r.member_count || 1), 0);
    const what = targets.length === 1
      ? `"${targets[0].company || targets[0].name}"`
      : `${targets.length} companies`;
    const extra = records > targets.length
      ? `\n\nThis clears ${records} records in total, including the copies held on their source lists.`
      : '';

    this.dialog.confirm(
      `Promote ${what} to Leads?${extra}\n\nThey will be removed from Lead Gen and from the source lists they came from.`,
      { title: 'Promote to Leads', confirmLabel: 'Promote' },
    ).then(ok => {
      if (!ok) return;
      this.promoting.set(true);
      this.error.set(null);
      const groups = targets.map(r => ({
        members: r.members?.length
          ? r.members
          : [{ origin: r.origin, id: r.id, source_label: r.source_label }],
      }));
      this.api.promoteLeadgenBulk(groups).subscribe({
        next: res => {
          this.promoting.set(false);
          this.clearSelection();
          if (res.errors?.length) {
            this.error.set(`Promoted ${res.promoted} of ${groups.length}. ${res.errors[0].error}`);
          }
          this.reload();
        },
        error: e => {
          this.promoting.set(false);
          this.error.set(e?.error?.error || 'Promote failed.');
        },
      });
    });
  }

  reload() {
    this.loading.set(true);
    this.error.set(null);
    this.api.listAllLeads().subscribe({
      next: r => { this.rows.set(r.leads || []); this.sources.set(r.sources || []); this.loading.set(false); },
      error: e => { this.error.set(e?.error?.error || 'Failed to load leads.'); this.loading.set(false); },
    });
  }

  clearFilters() { this.q.set(''); this.sourceFilter.set(''); }

  readonly filtered = computed(() => {
    const term = this.q().trim().toLowerCase();
    const src = this.sourceFilter();
    return this.rows().filter(r => {
      // Match ANY of the row's methods: a company found by both Companies
      // House and LinkedIn must still appear under the LinkedIn filter.
      if (src && !(r.source_labels?.length ? r.source_labels : [r.source_label]).includes(src)) return false;
      if (!term) return true;
      return (r.company || '').toLowerCase().includes(term)
        || (r.name || '').toLowerCase().includes(term)
        || (r.company_number || '').toLowerCase().includes(term);
    });
  });

  view(r: UnifiedLead) {
    this.detail.set(r);
    this.detailData.set(null);
    if (r.origin === 'company_lead') {
      this.loadingDetail.set(true);
      this.api.getCompanyLead(r.id).subscribe({
        next: d => { this.detailData.set(d); this.loadingDetail.set(false); },
        error: () => { this.loadingDetail.set(false); },
      });
    }
  }

  recordedDate(r: UnifiedLead): string {
    const s = r.created_at;
    if (!s) return '—';
    const d = new Date(s.replace(' ', 'T'));
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  // ── Source pill colours ────────────────────────────────────────────────
  private readonly srcPalette: Record<string, string> = {
    'Companies House': '#5AA9E6',
    'LinkedIn':        '#0A66C2',
    'Manual':          '#9AA0A6',
  };
  private readonly srcFallback = ['#6FCF97', '#BB6BD9', '#F2994A', '#EB5757', '#2D9CDB', '#E0B34A'];
  sourceColor(label: string): string {
    if (this.srcPalette[label]) return this.srcPalette[label];
    // Deterministic pick from the fallback ramp so a label keeps its colour.
    let h = 0;
    for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
    return this.srcFallback[h % this.srcFallback.length];
  }

  // ── State icon grid ────────────────────────────────────────────────────
  readonly leadCompanyPath = 'M3 21V7l6-4v4l6-4v6h6v12H3zm4-2h2v-2H7v2zm0-4h2v-2H7v2zm4 4h2v-2h-2v2zm0-4h2v-2h-2v2zm0-4h2V9h-2v2zm4 8h2v-2h-2v2zm0-4h2v-2h-2v2z';
  readonly leadPeoplePath = 'M12 12a4 4 0 100-8 4 4 0 000 8zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z';
  readonly icons: { key: string; title: string; path: string }[] = [
    { key: 'address',  title: 'Address',  path: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1112 6.5a2.5 2.5 0 010 5z' },
    { key: 'website',  title: 'Website',  path: 'M12 2a10 10 0 100 20 10 10 0 000-20zm6.92 6h-2.95a15.7 15.7 0 00-1.38-3.56A8.03 8.03 0 0118.92 8zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14a7.96 7.96 0 010-4h3.38a16.6 16.6 0 000 4H4.26zm.81 2h2.95c.32 1.25.78 2.45 1.38 3.56A8 8 0 015.07 16zm2.95-8H5.07a8 8 0 014.33-3.56A15.7 15.7 0 008.02 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66a14.9 14.9 0 010-4h4.68a14.9 14.9 0 010 4zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95a8.03 8.03 0 01-4.33 3.56zM16.36 14a16.6 16.6 0 000-4h3.38a7.96 7.96 0 010 4h-3.38z' },
    { key: 'linkedin', title: 'LinkedIn', path: 'M19 3a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h14zM8.34 9.67H5.67V18h2.67V9.67zM7 6.33a1.55 1.55 0 100 3.1 1.55 1.55 0 000-3.1zM18.33 18v-4.57c0-2.45-1.31-3.59-3.06-3.59-1.41 0-2.04.78-2.39 1.32v-1.13H10.2V18h2.67v-4.53c0-.24.02-.48.09-.65.19-.48.63-.98 1.37-.98.97 0 1.35.74 1.35 1.82V18h2.66z' },
    { key: 'email',    title: 'Email',    path: 'M20 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V6a2 2 0 00-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z' },
    { key: 'phone',    title: 'Phone',    path: 'M6.62 10.79a15.5 15.5 0 006.59 6.59l2.2-2.2a1 1 0 011.02-.24 11.4 11.4 0 003.56.57 1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.45.57 3.57a1 1 0 01-.25 1.02l-2.2 2.2z' },
  ];
  private readonly deadUrl = ['parked', 'for_sale', 'unconfigured', 'dead'];
  private urlDead(r: UnifiedLead): boolean { return !!r.url && this.deadUrl.includes(r.url_status ?? ''); }

  companyHas(r: UnifiedLead, key: string): boolean {
    switch (key) {
      case 'address':  return !!r.address;
      case 'website':  return !!r.url && !this.urlDead(r);
      case 'linkedin': return !!r.c_li;
      case 'email':    return !!r.email;
      case 'phone':    return !!r.phone;
    }
    return false;
  }
  companyBad(r: UnifiedLead, key: string): boolean { return key === 'website' && this.urlDead(r); }
  peopleHas(r: UnifiedLead, key: string): boolean {
    switch (key) {
      case 'address':  return !!r.p_addr;
      case 'website':  return false;
      case 'linkedin': return !!r.p_li;
      case 'email':    return !!r.p_email;
      case 'phone':    return !!r.p_phone;
    }
    return false;
  }

  // ── Detail modal derived views ─────────────────────────────────────────
  private isUrl(v: string | null | undefined): string | null {
    const s = (v || '').trim();
    return /^https?:\/\//i.test(s) ? s : null;
  }
  private mailto(v: string | null | undefined): string | null {
    const s = (v || '').trim();
    return s && s.includes('@') ? 'mailto:' + s : null;
  }

  /** Fixed company-detail slots built straight off the row. */
  readonly companyFacts = computed<{ label: string; value: string; url: string | null }[]>(() => {
    const d = this.detail();
    if (!d) return [];
    const out: { label: string; value: string; url: string | null }[] = [];
    const add = (label: string, value: string | null | undefined, url: string | null = null) => {
      out.push({ label, value: (value && value.trim()) ? value : '—', url });
    };
    add('Source', d.source_label);
    if (d.company_number) add('Company number', d.company_number);
    add('Industry', d.industry);
    add('Address', d.address);
    add('Phone', d.phone);
    add('Email', d.email, this.mailto(d.email));
    add('Website', d.url, this.isUrl(d.url));
    return out;
  });

  /** Enrichment info entries (pipeline records only). */
  readonly infoRows = computed<{ label: string; value: string; url: string | null }[]>(() => {
    const dd = this.detailData();
    if (!dd) return [];
    return (dd.info || [])
      .filter(i => (i.value || '').trim() !== '')
      .map(i => ({ label: i.name, value: (i.value || '').trim(), url: this.isUrl(i.value) }));
  });

  /** People (director/staff contacts) — pipeline records only. */
  readonly people = computed<{ name: string; role: string; fields: { label: string; value: string; url: string | null }[] }[]>(() => {
    const dd = this.detailData();
    if (!dd) return [];
    return (dd.contacts || []).map(c => {
      const name = [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || '—';
      const fields: { label: string; value: string; url: string | null }[] = [];
      if (c.email)        fields.push({ label: 'Email', value: c.email, url: this.mailto(c.email) });
      if (c.phone)        fields.push({ label: 'Phone', value: c.phone, url: null });
      if (c.linkedin_url) fields.push({ label: 'LinkedIn', value: c.linkedin_url, url: this.isUrl(c.linkedin_url) });
      return { name, role: (c.position || '').trim(), fields };
    });
  });
}
