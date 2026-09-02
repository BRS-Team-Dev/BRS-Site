import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { DialogService } from '../../core/dialog';
import { TenderLead, TenderLeadFeed } from '../../core/models';

/** Friendly type filters relevant to a web / software / creative studio.
 *  Keys mirror the `type` map in cms/scraper/tenders.php. */
const TYPE_OPTIONS: { key: string; label: string }[] = [
  { key: 'website',         label: 'Websites' },
  { key: 'ecommerce',       label: 'E-commerce' },
  { key: 'crm',             label: 'CRM' },
  { key: 'software-dev',    label: 'Software development' },
  { key: 'software',        label: 'Software (all)' },
  { key: 'app-mobile',      label: 'Mobile apps' },
  { key: 'it-services',     label: 'IT services' },
  { key: 'hosting-cloud',   label: 'Hosting & cloud' },
  { key: 'data-analytics',  label: 'Data & analytics' },
  { key: 'cyber-security',  label: 'Cyber security' },
  { key: 'seo-marketing',   label: 'SEO & marketing' },
  { key: 'design-creative', label: 'Design & creative' },
  { key: 'media-video',     label: 'Media & video' },
  { key: 'consultancy',     label: 'Consultancy' },
  { key: 'training',        label: 'Training' },
];

/**
 * Operations → Leads.
 *
 * A stored feed of UK tender opportunities. Rows live in the `tender_leads`
 * table (one column per aggregator field); the page reads them fast and
 * filters against the DB. "Import latest" pulls the last 24 hours from the
 * aggregator (cms/scraper/tenders.php) and upserts. A lead can be promoted
 * into a tracked Tender in one click.
 */
@Component({
  selector: 'app-operations-leads',
  imports: [FormsModule],
  template: `
    <div class="toolbar">
      <h1>Lead Gen</h1>
      <span class="spacer"></span>
      <select [(ngModel)]="days" name="days" (ngModelChange)="refresh()" [disabled]="loading()">
        @for (d of dayOptions; track d) { <option [ngValue]="d">Last {{ d }} days</option> }
      </select>
      <select [(ngModel)]="type" name="type" (ngModelChange)="refresh()" [disabled]="loading()">
        <option value="">All types</option>
        @for (t of typeOptions; track t.key) { <option [value]="t.key">{{ t.label }}</option> }
      </select>
      <input [(ngModel)]="q" name="q" placeholder="Keyword…" (keyup.enter)="refresh()" [disabled]="loading()" />
      <button class="ghost" (click)="refresh()" [disabled]="loading()">Refresh</button>
      <button class="ghost purge" (click)="doPurge()" [disabled]="loading() || importing() || purging() || !leads().length" title="Delete all stored leads">
        {{ purging() ? 'Purging…' : 'Purge' }}
      </button>
      <select [(ngModel)]="importMode" name="importmode" [disabled]="importing()" title="Import window">
        <option value="since">Since last update</option>
        <option value="30">Last 30 days</option>
      </select>
      <button class="primary" (click)="doImport()" [disabled]="importing()">
        {{ importing() ? 'Importing…' : 'Import' }}
      </button>
    </div>

    <p class="muted small hint">
      Stored opportunities from Find a Tender &amp; Contracts Finder. <strong>Import</strong> pulls
      the last 30 days, or just what's new since your last import; add a promising one to
      <strong>Tenders</strong> to start tracking it.
    </p>

    <div class="meta-strip">
      @if (feed(); as f) {
        <span><strong>{{ f.meta.count }}</strong> leads</span>
        @if (f.meta.window) { <span class="muted small">{{ fmtDate(f.meta.window.from) }} → {{ fmtDate(f.meta.window.to) }}</span> }
      }
      @if (importMsg(); as m) { <span class="import-msg small">{{ m }}</span> }
    </div>

    @if (loading()) {
      <div class="empty"><p class="muted">Loading stored leads…</p></div>
    } @else if (error()) {
      <div class="empty">
        <p class="error-msg">{{ error() }}</p>
        <button class="primary" (click)="refresh()">Try again</button>
      </div>
    } @else if (leads().length === 0) {
      <div class="empty">
        <p class="muted">No stored leads in this window.</p>
        <button class="primary" (click)="doImport('30')" [disabled]="importing()">
          {{ importing() ? 'Importing…' : 'Import the last 30 days' }}
        </button>
      </div>
    } @else {
      <div class="table-wrap">
        <table class="data leads-table">
          <thead><tr>
            <th class="c-pub">Published</th>
            <th class="c-type">Type</th>
            <th class="c-op">Opportunity</th>
            <th class="num c-val sortable" (click)="cycleValueSort()" title="Sort by value">Value{{ valueSortIndicator() }}</th>
            <th class="c-dead">Deadline</th>
            <th class="c-reg">Region</th>
            <th class="c-act"></th>
          </tr></thead>
          <tbody>
            @for (l of sortedLeads(); track l.id) {
              <tr (click)="selected.set(l)">
                <td class="c-pub muted small">{{ fmtDate(l.publishedDate) }}</td>
                <td class="c-type"><span class="chips">@for (ty of topTypes(l); track ty) { <span class="chip">{{ typeLabel(ty) }}</span> }@if (!l.types.length) { <span class="muted small">—</span> }</span></td>
                <td class="c-op op">
                  <div class="clip strong">{{ l.title }}</div>
                  <div class="clip muted small">{{ l.buyer?.name || sourceLabel(l.source) }}</div>
                </td>
                <td class="num c-val">{{ fmtMoney(l.value) }}</td>
                <td class="c-dead" [class.soon]="deadlineSoon(l.deadline)">{{ fmtDate(l.deadline) }}</td>
                <td class="c-reg">{{ regionOf(l) }}</td>
                <td class="c-act actions" (click)="$event.stopPropagation()">
                  @if (added().has(l.id)) { <span class="added small">Added ✓</span> }
                  @else { <button class="ghost sm" (click)="addAsTender(l)" [disabled]="busy().has(l.id)">{{ busy().has(l.id) ? '…' : '+ Tender' }}</button> }
                  @if (l.link) { <a class="ext notice" [href]="l.link" target="_blank" rel="noopener" title="Open notice">↗</a> }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }

    <!-- Detail -->
    @if (selected(); as l) {
      <div class="modal-backdrop" (click)="selected.set(null)">
        <div class="modal lead-modal" (click)="$event.stopPropagation()">
          <div class="modal-head">
            <h2>{{ l.title }}</h2>
            <button class="ghost icon-btn" (click)="selected.set(null)" aria-label="Close">✕</button>
          </div>
          <div class="modal-body">
            @if (l.types.length) {
              <div class="chips block">@for (ty of l.types; track ty) { <span class="chip">{{ typeLabel(ty) }}</span> }</div>
            }

            <div class="kv-grid">
              <div class="kv"><label>Buyer</label><div>{{ l.buyer?.name || '—' }}</div></div>
              <div class="kv"><label>Buyer type</label><div>{{ l.buyer?.buyerType || '—' }}</div></div>
              <div class="kv"><label>Value</label><div>{{ fmtMoney(l.value) }}</div></div>
              <div class="kv"><label>Status</label><div>{{ l.status || '—' }}</div></div>
              <div class="kv"><label>Published</label><div>{{ fmtDate(l.publishedDate) }}</div></div>
              <div class="kv"><label>Deadline</label><div [class.soon]="deadlineSoon(l.deadline)">{{ fmtDate(l.deadline) }}</div></div>
              <div class="kv"><label>Enquiry deadline</label><div>{{ fmtDate(l.enquiryDeadline) }}</div></div>
              <div class="kv"><label>Region</label><div>{{ regionOf(l) }}</div></div>
              <div class="kv"><label>Source</label><div>{{ sourceLabel(l.source) }}</div></div>
              <div class="kv"><label>Notice type</label><div>{{ l.noticeType || '—' }}</div></div>
              <div class="kv"><label>Procedure</label><div>{{ l.procedureType || '—' }}</div></div>
              <div class="kv"><label>Main category</label><div>{{ l.mainCategory || '—' }}</div></div>
              <div class="kv"><label>Legal basis</label><div>{{ l.legalBasis || '—' }}</div></div>
              <div class="kv"><label>Language</label><div>{{ l.language || '—' }}</div></div>
              <div class="kv"><label>Suitable for SME</label><div>{{ yesNo(l.suitableForSME) }}</div></div>
              <div class="kv"><label>Suitable for VCSE</label><div>{{ yesNo(l.suitableForVCSE) }}</div></div>
              <div class="kv"><label>Covered by GPA</label><div>{{ yesNo(l.coveredByGPA) }}</div></div>
              <div class="kv"><label>Reference</label><div>{{ l.noticeId || '—' }}</div></div>
            </div>

            @if (l.description) {
              <h3 class="sub">Description</h3>
              <p class="desc">{{ l.description }}</p>
            }

            <!-- Contract -->
            @if (l.contractStart || l.contractEnd || l.contractDays) {
              <h3 class="sub">Contract</h3>
              <div class="kv-grid">
                <div class="kv"><label>Start</label><div>{{ fmtDate(l.contractStart) }}</div></div>
                <div class="kv"><label>End</label><div>{{ fmtDate(l.contractEnd) }}</div></div>
                @if (l.contractDays) { <div class="kv"><label>Duration</label><div>{{ l.contractDays }} days</div></div> }
              </div>
            }

            <!-- Framework -->
            @if (l.framework; as fw) {
              @if (fw.isFramework) {
                <h3 class="sub">Framework agreement</h3>
                <div class="kv-grid">
                  <div class="kv"><label>Method</label><div>{{ fw.method || '—' }}</div></div>
                  <div class="kv"><label>Period end</label><div>{{ fmtDate(fw.periodEnd) }}</div></div>
                  @if (fw.maxParticipants) { <div class="kv"><label>Max participants</label><div>{{ fw.maxParticipants }}</div></div> }
                </div>
                @if (fw.description) { <p class="desc small">{{ fw.description }}</p> }
              }
            }

            <!-- Lots -->
            @if (l.lots && l.lots.length) {
              <h3 class="sub">Lots ({{ l.lots.length }})</h3>
              <div class="sub-cards">
                @for (lot of l.lots; track $index) {
                  <div class="sub-card">
                    <strong>{{ lot.title || ('Lot ' + (lot.id || ($index + 1))) }}</strong>
                    <div class="muted small">
                      @if (lot.value; as lv) { @if (lv.amount != null) { {{ fmtMoney({ amount: lv.amount, currency: lv.currency || 'GBP' }) }} · } }
                      @if (lot.contractPeriod; as cp) { @if (cp.start || cp.end) { {{ fmtDate(cp.start) }} → {{ fmtDate(cp.end) }} } }
                    </div>
                    @if (lot.description) { <div class="small desc">{{ lot.description }}</div> }
                  </div>
                }
              </div>
            }

            <!-- Milestones -->
            @if (l.milestones && l.milestones.length) {
              <h3 class="sub">Key dates</h3>
              <ul class="plain">
                @for (m of l.milestones; track $index) {
                  <li><span class="muted">{{ fmtDate(m.dueDate) }}</span> — {{ m.title || m.type }}</li>
                }
              </ul>
            }

            <!-- Criteria -->
            @if (l.awardCriteria && l.awardCriteria.length) {
              <h3 class="sub">Award criteria</h3>
              <ul class="plain">
                @for (c of l.awardCriteria; track $index) { <li>{{ c.name || c.type }}@if (c.description) { <span class="muted small"> — {{ c.description }}</span> }</li> }
              </ul>
            }
            @if (l.selectionCriteria && l.selectionCriteria.length) {
              <h3 class="sub">Selection criteria</h3>
              <ul class="plain">
                @for (c of l.selectionCriteria; track $index) { <li>{{ c.type }}@if (c.description) { <span class="muted small"> — {{ c.description }}</span> }</li> }
              </ul>
            }

            <!-- Submission -->
            @if (l.submission; as s) {
              @if (s.url || s.variantPolicy || s.electronicAuction != null || hasContent(s.methods) || hasContent(s.languages)) {
                <h3 class="sub">Submission</h3>
                <div class="kv-grid">
                  @if (hasContent(s.methods)) { <div class="kv"><label>Method</label><div>{{ joinList(s.methods) }}</div></div> }
                  @if (s.url) { <div class="kv"><label>Portal</label><div><a class="ext" [href]="s.url" target="_blank" rel="noopener">{{ s.url }}</a></div></div> }
                  @if (s.electronicAuction != null) { <div class="kv"><label>e-Auction</label><div>{{ yesNo(s.electronicAuction) }}</div></div> }
                  @if (hasContent(s.languages)) { <div class="kv"><label>Languages</label><div>{{ joinList(s.languages) }}</div></div> }
                  @if (s.variantPolicy) { <div class="kv"><label>Variants</label><div>{{ s.variantPolicy }}</div></div> }
                </div>
              }
            }

            <!-- Participation -->
            @if (l.participation; as pt) {
              @if (pt.minimumCandidates != null || hasContent(pt.reservedParticipation)) {
                <h3 class="sub">Participation</h3>
                <div class="kv-grid">
                  @if (pt.minimumCandidates != null) { <div class="kv"><label>Min. candidates</label><div>{{ pt.minimumCandidates }}</div></div> }
                  @if (hasContent(pt.reservedParticipation)) { <div class="kv"><label>Reserved</label><div>{{ joinList(pt.reservedParticipation) }}</div></div> }
                </div>
              }
            }

            <!-- Buyer contact + address -->
            @if (l.buyer?.contact; as c) {
              @if (c.name || c.email || c.phone) {
                <h3 class="sub">Buyer contact</h3>
                <div class="kv-grid">
                  @if (c.name) { <div class="kv"><label>Name</label><div>{{ c.name }}</div></div> }
                  @if (c.email) { <div class="kv"><label>Email</label><div>{{ c.email }}</div></div> }
                  @if (c.phone) { <div class="kv"><label>Phone</label><div>{{ c.phone }}</div></div> }
                </div>
              }
            }
            @if (l.buyer?.address; as a) {
              @if (a.locality || a.postcode || a.region) {
                <h3 class="sub">Buyer address</h3>
                <p class="small">{{ addressLine(a) }}</p>
              }
            }

            <!-- Delivery -->
            @if (l.deliveryAddresses && l.deliveryAddresses.length) {
              <h3 class="sub">Delivery</h3>
              <ul class="plain">
                @for (d of l.deliveryAddresses; track $index) { <li class="small">{{ d.description || addressLine(d) }}</li> }
              </ul>
            }

            <!-- Parties -->
            @if (l.parties && l.parties.length > 1) {
              <h3 class="sub">Parties ({{ l.parties.length }})</h3>
              <ul class="plain">
                @for (p of l.parties; track $index) { <li class="small">{{ p.name }}@if (p.roles?.length) { <span class="muted"> — {{ joinList(p.roles) }}</span> }</li> }
              </ul>
            }

            <!-- CPV -->
            @if (l.cpvCodes && l.cpvCodes.length) {
              <h3 class="sub">CPV codes</h3>
              <div class="chips block">@for (c of l.cpvCodes; track c) { <span class="chip mono">{{ c }}</span> }</div>
            }

            <!-- Documents -->
            @if (l.documents && l.documents.length) {
              <h3 class="sub">Documents</h3>
              <ul class="plain">
                @for (d of l.documents; track d.url) { <li><a class="ext" [href]="d.url" target="_blank" rel="noopener">{{ d.title || d.type || d.url }} ↗</a></li> }
              </ul>
            }
          </div>
          <div class="modal-foot">
            @if (l.link) { <a class="ext" [href]="l.link" target="_blank" rel="noopener">View full notice ↗</a> }
            <span class="spacer"></span>
            @if (added().has(l.id)) { <span class="added">Added to tenders ✓</span> }
            @else { <button class="primary" (click)="addAsTender(l)" [disabled]="busy().has(l.id)">{{ busy().has(l.id) ? 'Adding…' : 'Add to tenders' }}</button> }
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    /* Match the 24px horizontal inset used by the global .toolbar / .table-wrap. */
    .hint { margin: 0; padding: 12px 24px 0; }
    .toolbar select, .toolbar input { width: auto; min-width: 150px; }
    .meta-strip { display: flex; align-items: center; gap: 14px; padding: 10px 24px 14px; flex-wrap: wrap; }
    .import-msg { color: var(--primary); }
    .purge { color: var(--danger, #ef4444); }
    .purge:hover:not(:disabled) { border-color: var(--danger, #ef4444); }
    /* Fixed layout so long titles clip to a single line with an ellipsis
       instead of overflowing into the next column. */
    .leads-table { table-layout: fixed; width: 100%; }
    table.data.leads-table th, table.data.leads-table td {
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .c-pub  { width: 110px; }
    .c-type { width: 132px; }
    .c-val  { width: 116px; }
    .c-dead { width: 110px; }
    .c-reg  { width: 96px; }
    .c-act  { width: 150px; }
    /* .c-op has no width → it takes the remaining space */
    .op .clip { display: block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .op .clip.strong { font-weight: 600; }
    td.num, th.num { text-align: right; }
    th.sortable { cursor: pointer; user-select: none; }
    th.sortable:hover { color: var(--primary); }
    .c-act .notice { margin-left: 8px; }
    .chips { display: inline-flex; flex-wrap: nowrap; gap: 4px; overflow: hidden; }
    .chips.block { margin: 4px 0 8px; }
    .chip { display: inline-block; padding: 2px 8px; border-radius: 999px; background: var(--bg-3); border: 1px solid var(--line); font-size: 11px; white-space: nowrap; }
    .chip.mono { font-family: var(--mono, monospace); }
    td.actions { white-space: nowrap; text-align: right; }
    td.actions .ext { margin-right: 10px; }
    .ext { color: var(--primary); font-size: 13px; }
    .ext:hover { text-decoration: underline; }
    .added { color: var(--primary); font-size: 13px; white-space: nowrap; }
    button.sm { padding: 4px 10px; font-size: 12px; }
    .soon { color: var(--warn, #f59e0b); font-weight: 600; }
    /* modal */
    .lead-modal { max-width: 720px; }
    .kv-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 20px; margin-bottom: 6px; }
    .kv { margin-bottom: 4px; }
    .kv .soon { font-weight: 600; }
    .sub { font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); margin: 18px 0 6px; }
    .desc { white-space: pre-wrap; line-height: 1.5; }
    .desc.small { font-size: 13px; }
    .plain { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 5px; margin: 0; }
    .sub-cards { display: flex; flex-direction: column; gap: 8px; }
    .sub-card { background: var(--bg-3); border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 10px 12px; }
    @media (max-width: 640px) { .kv-grid { grid-template-columns: 1fr; } }
  `],
})
export class OperationsLeads {
  private api = inject(Api);
  private dialog = inject(DialogService);
  private route = inject(ActivatedRoute);

  readonly dayOptions = [1, 3, 7, 14, 30];
  readonly typeOptions = TYPE_OPTIONS;

  days = 7;
  type = '';
  q = '';
  importMode = 'since';

  loading = signal(false);
  importing = signal(false);
  purging = signal(false);
  importMsg = signal<string | null>(null);
  error = signal<string | null>(null);
  feed = signal<TenderLeadFeed | null>(null);
  leads = computed(() => this.feed()?.tenders ?? []);

  /** none | desc | asc — sort the table by value (nulls last). */
  valueSort = signal<'none' | 'desc' | 'asc'>('none');
  sortedLeads = computed(() => {
    const ls = this.leads();
    const s = this.valueSort();
    if (s === 'none') return ls;
    const dir = s === 'desc' ? -1 : 1;
    return [...ls].sort((a, b) => {
      const av = a.value?.amount ?? null, bv = b.value?.amount ?? null;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;   // nulls always last
      if (bv == null) return -1;
      return (av - bv) * dir;
    });
  });

  added = signal<Set<string>>(new Set());
  busy = signal<Set<string>>(new Set());
  selected = signal<TenderLead | null>(null);

  constructor() {
    // Drive the filters from the URL so the sidenav type sub-menu (which
    // deep-links ?type=…&days=30) works. Fires once on load too.
    this.route.queryParamMap.subscribe(pm => {
      this.type = pm.get('type') ?? '';
      const d = Number(pm.get('days'));
      if (d && this.dayOptions.includes(d)) this.days = d;
      this.refresh();
    });
  }

  cycleValueSort() {
    const s = this.valueSort();
    this.valueSort.set(s === 'none' ? 'desc' : s === 'desc' ? 'asc' : 'none');
  }
  valueSortIndicator(): string {
    const s = this.valueSort();
    return s === 'desc' ? ' ↓' : s === 'asc' ? ' ↑' : '';
  }

  refresh() {
    this.loading.set(true);
    this.error.set(null);
    this.api.tenderLeads({ days: this.days, type: this.type || undefined, q: this.q || undefined }).subscribe({
      next: (feed) => { this.feed.set(feed); this.loading.set(false); },
      error: (e) => { this.error.set(e?.error?.error || e?.message || 'Could not load stored leads.'); this.loading.set(false); },
    });
  }

  doImport(modeOverride?: string) {
    if (this.importing()) return;
    const mode = modeOverride ?? this.importMode;
    this.importing.set(true);
    this.importMsg.set(null);
    const opts = mode === 'since' ? { mode: 'since' as const } : { days: Number(mode) || 30 };
    this.api.importTenderLeads(opts).subscribe({
      next: (r) => {
        this.importing.set(false);
        const win = r.days ? ` over the last ${r.days} day${r.days === 1 ? '' : 's'}` : '';
        const skip = r.skipped ? `, ${r.skipped} already stored` : '';
        this.importMsg.set(`Imported ${r.imported} new${skip}${win}`);
        this.refresh();
      },
      error: (e) => {
        this.importing.set(false);
        this.dialog.alert(e?.error?.error || 'Import failed. The aggregator may be busy — try again shortly.');
      },
    });
  }

  /** Promote a lead to a tracked tender — the backend copies every field into
   *  the tender's Info tab as individual entries. */
  async doPurge() {
    if (this.purging() || !this.leads().length) return;
    const ok = await this.dialog.confirm('Delete ALL stored leads? This removes the whole Lead Gen table and cannot be undone. (Tenders you have already created are not affected.)');
    if (!ok) return;
    this.purging.set(true);
    this.importMsg.set(null);
    this.api.purgeTenderLeads().subscribe({
      next: (r) => {
        this.purging.set(false);
        this.importMsg.set(`Purged ${r.deleted} leads`);
        this.added.set(new Set());
        this.refresh();
      },
      error: (e) => {
        this.purging.set(false);
        this.dialog.alert(e?.error?.error || 'Could not purge leads.');
      },
    });
  }

  addAsTender(l: TenderLead) {
    if (this.added().has(l.id) || this.busy().has(l.id)) return;
    this.busy.update((s) => new Set(s).add(l.id));
    this.api.promoteTenderLead(l.id).subscribe({
      next: () => {
        this.added.update((s) => new Set(s).add(l.id));
        this.busy.update((s) => { const n = new Set(s); n.delete(l.id); return n; });
      },
      error: (e) => {
        this.busy.update((s) => { const n = new Set(s); n.delete(l.id); return n; });
        this.dialog.alert(e?.error?.error || 'Could not add this lead to tenders.');
      },
    });
  }

  // ---- display helpers ----
  topTypes(l: TenderLead): string[] { return (l.types || []).slice(0, 2); }
  typeLabel(key: string): string { return this.typeOptions.find((o) => o.key === key)?.label ?? key; }
  regionOf(l: TenderLead): string { return l.buyer?.address?.region || (l.regions && l.regions.length ? l.regions[0] : '') || '—'; }
  sourceLabel(src: string): string {
    if (src === 'find-a-tender') return 'Find a Tender';
    if (src === 'contracts-finder') return 'Contracts Finder';
    return src || '—';
  }
  yesNo(v: boolean | null | undefined): string { return v == null ? '—' : (v ? 'Yes' : 'No'); }
  hasContent(v: unknown): boolean { return Array.isArray(v) ? v.length > 0 : (v != null && v !== ''); }
  joinList(v: unknown): string {
    if (Array.isArray(v)) return v.filter((x) => x != null && x !== '').join(', ') || '—';
    return (v == null || v === '') ? '—' : String(v);
  }
  addressLine(a: { street?: string | null; locality?: string | null; region?: string | null; postcode?: string | null }): string {
    return [a.street, a.locality, a.region, a.postcode].filter(Boolean).join(', ') || '—';
  }

  fmtMoney(v?: { amount: number | null; currency: string } | null): string {
    if (!v || v.amount == null) return '—';
    try {
      return new Intl.NumberFormat('en-GB', { style: 'currency', currency: v.currency || 'GBP', maximumFractionDigits: 0 }).format(Number(v.amount));
    } catch { return `${v.currency || ''} ${v.amount}`.trim(); }
  }
  fmtDate(iso?: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  deadlineSoon(iso?: string | null): boolean {
    if (!iso) return false;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return false;
    return (d.getTime() - Date.now()) / 86400000 <= 14;
  }
}
