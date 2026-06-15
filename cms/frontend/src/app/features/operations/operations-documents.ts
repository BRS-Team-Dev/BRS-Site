import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { environment } from '@env/environment';
import { Api } from '../../core/api';
import { OperationsDocument, OperationsDocumentStatus, OperationsDocumentsBrowse } from '../../core/models';

type ViewTab = 'list' | 'browse';

const STATUS_LABEL: Record<OperationsDocumentStatus, string> = {
  valid:   'Valid',
  pending: 'Pending',
  expired: 'Expired',
};

/**
 * /operations/documents — universal documents view across the CMS.
 *
 * List tab: flat union of every uploaded file (hr_documents +
 * tender_documents), filterable by owner-type / doc-type / status, with
 * status chips for quick filtering.
 *
 * Browse tab: filesystem walker rooted at cms/uploads/, so anything that
 * landed on disk but isn't tracked in a database table is still visible.
 *
 * The renamed Contracts page (/operations/contracts) handles contract
 * templates + signing flows — this page is read-only browsing.
 */
@Component({
  selector: 'app-operations-documents',
  imports: [FormsModule],
  template: `
    <div class="toolbar">
      <h1>Documents</h1>
      <span class="spacer"></span>
      <span class="muted small">Showing <strong>{{ visible().length }}</strong> / <strong>{{ docs().length }}</strong></span>
    </div>

    <p class="muted page-sub">All uploaded documents across HR and Tenders, plus a filesystem browser of cms/uploads.</p>

    <div class="tab-nav">
      <button class="tab-btn" [class.active]="tab() === 'list'" (click)="tab.set('list')">
        <span class="tab-ic">≡</span> List
      </button>
      <button class="tab-btn" [class.active]="tab() === 'browse'" (click)="setTab('browse')">
        <span class="tab-ic">📁</span> Browse
      </button>
    </div>

    @if (tab() === 'list') {
      <div class="chip-row">
        @for (s of statusOrder; track s) {
          <button class="chip" [class.active]="statusChip() === s" [attr.data-status]="s"
                  (click)="setStatus(s)">
            {{ STATUS_LABEL[s] }} <span class="chip-count">· {{ statusCount(s) }}</span>
          </button>
        }
        <button class="chip clear" [class.active]="!statusChip()" (click)="setStatus(null)">
          All <span class="chip-count">· {{ docs().length }}</span>
        </button>
      </div>

      <div class="filter-row">
        <input class="search" type="search" placeholder="Search by title, owner, type, reference…"
               [value]="search()" (input)="search.set(asValue($event))" />
        <select class="filter-select" [value]="ownerType()" (change)="ownerType.set(asValue($event))">
          <option value="">All owners</option>
          @for (o of ownerTypes(); track o) { <option [value]="o">{{ o }}</option> }
        </select>
        <select class="filter-select" [value]="docType()" (change)="docType.set(asValue($event))">
          <option value="">All types</option>
          @for (t of docTypes(); track t) { <option [value]="t">{{ t }}</option> }
        </select>
        <button class="ghost" (click)="clearFilters()" [disabled]="!filtersActive()">Clear</button>
      </div>

      @if (loading()) {
        <p class="muted">Loading…</p>
      } @else if (visible().length === 0) {
        <div class="empty">
          <p class="muted">No documents match these filters.</p>
        </div>
      } @else {
        <div class="table-wrap">
          <table class="data">
            <thead><tr>
              <th>Type</th>
              <th>Owner</th>
              <th>Status</th>
              <th>Reference</th>
              <th>Uploaded</th>
              <th>Expiry</th>
              <th class="actions-col"></th>
            </tr></thead>
            <tbody>
              @for (d of visible(); track d.uid) {
                <tr>
                  <td>
                    <strong>{{ d.title }}</strong>
                    <div class="muted small">{{ d.doc_type }}</div>
                  </td>
                  <td>
                    <span class="owner-pill" [attr.data-kind]="d.owner_type.toLowerCase()">{{ d.owner_type }}</span>
                    <span class="owner-name">{{ d.owner_name }}</span>
                  </td>
                  <td>
                    <span class="status-pill" [attr.data-status]="d.status">{{ STATUS_LABEL[d.status] }}</span>
                  </td>
                  <td>{{ d.reference || '—' }}</td>
                  <td>{{ formatDate(d.uploaded_at) }}</td>
                  <td>{{ d.expires_at ? formatDate(d.expires_at) : '—' }}</td>
                  <td class="actions">
                    <a class="ghost icon-btn" [href]="fileUrl(d.file_path)" target="_blank" rel="noopener" title="View">👁</a>
                    <a class="ghost icon-btn" [href]="fileUrl(d.file_path)" [attr.download]="d.title" title="Download">⬇</a>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    }

    @if (tab() === 'browse') {
      <div class="browse-head">
        <div class="crumbs">
          <button class="crumb" (click)="loadBrowse('')">storage</button>
          @for (c of crumbs(); track c.path; let i = $index) {
            <span class="sep">/</span>
            @if (i < crumbs().length - 1) {
              <button class="crumb" (click)="loadBrowse(c.path)">{{ c.name }}</button>
            } @else {
              <span class="crumb current">{{ c.name }}</span>
            }
          }
        </div>
        @if (browse()?.parent !== null && browse()?.path) {
          <button class="ghost" (click)="loadBrowse(browse()!.parent || '')">↑ Up</button>
        }
      </div>

      @if (browseLoading()) {
        <p class="muted">Loading…</p>
      } @else if (browse(); as b) {
        @if (b.entries.length === 0) {
          <div class="empty"><p class="muted">Folder is empty.</p></div>
        } @else {
          <div class="table-wrap">
            <table class="data">
              <thead><tr>
                <th>Name</th>
                <th class="size-col">Size</th>
                <th class="modified-col">Modified</th>
                <th class="actions-col"></th>
              </tr></thead>
              <tbody>
                @for (e of b.entries; track e.path) {
                  <tr [class.dir]="e.type === 'dir'" (dblclick)="onEntryDblClick(e)">
                    <td>
                      @if (e.type === 'dir') {
                        <button class="link" (click)="loadBrowse(e.path)">
                          <span class="icon-folder">📁</span> {{ e.name }}
                        </button>
                      } @else {
                        <span class="icon-file">📄</span> {{ e.name }}
                      }
                    </td>
                    <td>{{ e.size !== null ? formatSize(e.size) : '—' }}</td>
                    <td>{{ formatDate(e.modified) }}</td>
                    <td class="actions">
                      @if (e.type === 'file') {
                        <a class="ghost icon-btn" [href]="uploadsFileUrl(e.path)" target="_blank" rel="noopener" title="View">👁</a>
                        <a class="ghost icon-btn" [href]="uploadsFileUrl(e.path)" [attr.download]="e.name" title="Download">⬇</a>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }
    }
  `,
  styles: [`
    .toolbar h1 { margin: 0; }
    .page-sub { margin: 0 24px 8px; }
    .filter-select { padding: 6px 8px; flex: 0 0 auto; width: auto; min-width: 160px; max-width: 220px; }

    .tab-nav {
      display: flex; gap: 4px; padding: 0 24px;
      border-bottom: 1px solid var(--line);
      margin-bottom: 16px;
    }
    .tab-btn {
      background: transparent; color: var(--muted); border: none;
      padding: 10px 16px; border-bottom: 2px solid transparent;
      cursor: pointer; font-size: 14px; display: inline-flex; align-items: center; gap: 6px;
    }
    .tab-btn:hover { color: var(--fg); }
    .tab-btn.active { color: var(--primary); border-bottom-color: var(--primary); }
    .tab-ic { font-size: 14px; }

    .chip-row {
      display: flex; gap: 8px; flex-wrap: wrap;
      padding: 0 24px 12px;
    }
    .chip {
      background: var(--bg-2); color: var(--muted); border: 1px solid var(--line);
      padding: 4px 12px; border-radius: 999px; cursor: pointer; font-size: 12px;
    }
    .chip:hover { background: var(--bg-3); color: var(--fg); }
    .chip.active { color: var(--fg); border-color: var(--primary); }
    .chip[data-status="valid"].active   { background: rgba(76, 175, 80, 0.15); color: #7ed985; border-color: #4caf50; }
    .chip[data-status="pending"].active { background: rgba(255, 193, 7, 0.15); color: var(--primary); border-color: var(--primary); }
    .chip[data-status="expired"].active { background: rgba(244, 67, 54, 0.15); color: #f08577; border-color: #d84d3e; }
    .chip-count { opacity: 0.7; margin-left: 2px; }

    .filter-row {
      display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
      padding: 0 24px 16px;
    }
    .filter-row .search { flex: 1 1 280px; min-width: 220px; }

    .empty {
      padding: 32px 24px; text-align: center;
    }

    .table-wrap { padding: 0 24px 24px; overflow-x: auto; }
    table.data { width: 100%; border-collapse: collapse; }
    table.data th, table.data td {
      text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--line);
      font-size: 13px; vertical-align: middle;
    }
    table.data th { color: var(--muted); text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px; }
    table.data tr.dir td:first-child { font-weight: 500; }
    .size-col { width: 100px; }
    .modified-col { width: 180px; }
    .actions-col { width: 90px; }
    .actions { text-align: right; white-space: nowrap; }
    .actions .icon-btn { padding: 4px 6px; margin-left: 2px; }

    .owner-pill {
      display: inline-block; padding: 2px 8px; border-radius: 999px;
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;
      border: 1px solid var(--line); color: var(--muted); margin-right: 6px;
    }
    .owner-pill[data-kind="employee"] { color: #6db4ff; border-color: #4d8edb; background: rgba(77, 142, 219, 0.12); }
    .owner-pill[data-kind="tender"]   { color: var(--primary); border-color: var(--primary); background: rgba(255, 193, 7, 0.12); }
    .owner-name { font-weight: 500; }

    .status-pill {
      display: inline-block; padding: 2px 10px; border-radius: 999px;
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
      border: 1px solid var(--line); color: var(--muted);
    }
    .status-pill[data-status="valid"]   { color: #7ed985; border-color: #4caf50; background: rgba(76, 175, 80, 0.15); }
    .status-pill[data-status="pending"] { color: var(--primary); border-color: var(--primary); background: rgba(255, 193, 7, 0.15); }
    .status-pill[data-status="expired"] { color: #f08577; border-color: #d84d3e; background: rgba(244, 67, 54, 0.15); }

    .browse-head {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0 24px 12px; gap: 16px;
    }
    .crumbs {
      display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
      font-size: 14px;
    }
    .crumb {
      background: transparent; border: 0; color: var(--primary); cursor: pointer;
      padding: 4px 6px; border-radius: var(--radius-sm); font-size: 14px;
    }
    .crumb:hover { background: var(--bg-3); }
    .crumb.current { color: var(--fg); cursor: default; }
    .sep { color: var(--muted); }

    .link {
      background: transparent; border: 0; color: var(--primary); cursor: pointer;
      font-size: 13px; padding: 0; display: inline-flex; align-items: center; gap: 8px;
    }
    .link:hover { text-decoration: underline; }
    .icon-folder, .icon-file { opacity: 0.85; }
  `],
})
export class OperationsDocuments {
  private api = inject(Api);

  STATUS_LABEL = STATUS_LABEL;
  statusOrder: OperationsDocumentStatus[] = ['valid', 'pending', 'expired'];

  tab        = signal<ViewTab>('list');
  loading    = signal<boolean>(true);
  docs       = signal<OperationsDocument[]>([]);

  // List-view filters
  statusChip = signal<OperationsDocumentStatus | null>(null);
  search     = signal<string>('');
  ownerType  = signal<string>('');
  docType    = signal<string>('');

  // Browse-view state
  browse        = signal<OperationsDocumentsBrowse | null>(null);
  browseLoading = signal<boolean>(false);

  ownerTypes = computed(() => {
    const set = new Set<string>();
    for (const d of this.docs()) set.add(d.owner_type);
    return Array.from(set).sort();
  });
  docTypes = computed(() => {
    const set = new Set<string>();
    for (const d of this.docs()) set.add(d.doc_type);
    return Array.from(set).sort();
  });
  filtersActive = computed(() =>
    !!(this.statusChip() || this.search() || this.ownerType() || this.docType()),
  );

  visible = computed(() => {
    const q = this.search().trim().toLowerCase();
    const status = this.statusChip();
    const owner = this.ownerType();
    const type = this.docType();
    return this.docs().filter(d => {
      if (status && d.status !== status) return false;
      if (owner && d.owner_type !== owner) return false;
      if (type && d.doc_type !== type) return false;
      if (q) {
        const blob = `${d.title} ${d.owner_name} ${d.doc_type} ${d.reference ?? ''}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  });

  crumbs = computed(() => {
    const path = this.browse()?.path ?? '';
    if (!path) return [];
    const parts = path.split('/');
    const out: { name: string; path: string }[] = [];
    let acc = '';
    for (const p of parts) {
      acc = acc ? `${acc}/${p}` : p;
      out.push({ name: p, path: acc });
    }
    return out;
  });

  constructor() {
    this.api.listOperationsDocuments().subscribe({
      next: r => { this.docs.set(r.documents ?? []); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────
  asValue(ev: Event): string { return (ev.target as HTMLInputElement | HTMLSelectElement).value; }

  statusCount(s: OperationsDocumentStatus): number {
    return this.docs().filter(d => d.status === s).length;
  }
  setStatus(s: OperationsDocumentStatus | null) { this.statusChip.set(s); }
  clearFilters() {
    this.statusChip.set(null);
    this.search.set('');
    this.ownerType.set('');
    this.docType.set('');
  }

  setTab(t: ViewTab) {
    this.tab.set(t);
    if (t === 'browse' && !this.browse()) this.loadBrowse('');
  }
  loadBrowse(path: string) {
    this.browseLoading.set(true);
    this.api.browseOperationsDocuments(path).subscribe({
      next: r => { this.browse.set(r); this.browseLoading.set(false); },
      error: () => this.browseLoading.set(false),
    });
  }
  onEntryDblClick(e: { type: 'dir' | 'file'; path: string }) {
    if (e.type === 'dir') this.loadBrowse(e.path);
  }

  // ── URLs ───────────────────────────────────────────────────────────
  /** Build a usable URL for a hr_documents/tender_documents `file_path`
   *  (cms-relative, e.g. 'uploads/hr/12/...'). */
  fileUrl(filePath: string): string {
    const clean = (filePath ?? '').replace(/^\//, '');
    return `${environment.basePath}/${clean}`;
  }
  /** Build a URL for a browse-tab entry path (relative to cms/uploads/). */
  uploadsFileUrl(entryPath: string): string {
    const clean = (entryPath ?? '').replace(/^\//, '');
    return `${environment.basePath}/uploads/${clean}`;
  }

  // ── Formatters ─────────────────────────────────────────────────────
  formatDate(s: string | null | undefined): string {
    if (!s) return '—';
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  formatSize(bytes: number): string {
    if (bytes < 1024)         return bytes + ' B';
    if (bytes < 1024 * 1024)  return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 ** 3)    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    return (bytes / 1024 ** 3).toFixed(1) + ' GB';
  }
}
