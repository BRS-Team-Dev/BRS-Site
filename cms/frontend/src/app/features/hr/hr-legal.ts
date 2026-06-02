import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { HrLegalDocument } from '../../core/models';

const CATEGORIES: Array<{ key: string; label: string }> = [
  { key: 'policy',  label: 'Policy' },
  { key: 'terms',   label: 'Terms & Conditions' },
  { key: 'privacy', label: 'Privacy' },
  { key: 'other',   label: 'Other' },
];

/**
 * /hr/legal — list of legal documents (policies, T&Cs, privacy etc.).
 * Each row links to its own page at /hr/legal/:slug.
 *
 * The "Add" form lives inline in a modal so HR can spin up a new document
 * without leaving the list. Heavy editing happens on the per-document page.
 */
@Component({
  selector: 'app-hr-legal',
  imports: [FormsModule],
  template: `
    <div class="toolbar">
      <h1>Legal</h1>
      <span class="spacer"></span>
      <select [ngModel]="filter()" (ngModelChange)="filter.set($event)" name="cat" class="cat-filter">
        <option value="all">All categories</option>
        @for (c of categories; track c.key) {
          <option [value]="c.key">{{ c.label }}</option>
        }
      </select>
      <button class="primary" (click)="openCreate()">+ New document</button>
    </div>

    <div class="page">
      @if (loading()) {
        <p class="muted">Loading…</p>
      } @else if (filtered().length === 0) {
        <div class="empty">
          <p class="muted">No legal documents yet.</p>
          <button class="primary" (click)="openCreate()">+ Create your first one</button>
        </div>
      } @else {
        <ul class="slot-list">
          @for (d of filtered(); track d.id) {
            <li class="slot" (click)="open(d)">
              <div class="slot-head">
                <strong>{{ d.title }}</strong>
                <span class="cat-pill">{{ categoryLabel(d.category) }}</span>
                @if (d.is_published) {
                  <span class="status status-published">published</span>
                } @else {
                  <span class="status status-draft">draft</span>
                }
                <span class="spacer"></span>
                <span class="muted small">/{{ d.slug }}</span>
                <a class="ghost go-btn"
                   [href]="publicUrl(d)"
                   target="_blank"
                   rel="noopener"
                   (click)="$event.stopPropagation()"
                   [title]="d.is_published ? 'Open the public page' : 'Draft — public page returns 404 until published'">
                  Go to ↗
                </a>
              </div>
              @if (d.summary) { <p class="summary muted small">{{ d.summary }}</p> }
              <div class="slot-meta small">
                @if (d.updated_at) { <span>Updated {{ d.updated_at }}</span> }
              </div>
            </li>
          }
        </ul>
      }
    </div>

    @if (creating()) {
      <div class="modal-backdrop" (click)="closeCreate()">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-head">
            <h2>New legal document</h2>
            <button class="ghost icon-btn" (click)="closeCreate()" title="Close">✕</button>
          </div>
          <div class="modal-body">
            <div class="meta-row">
              <div class="meta-field">
                <label>Title <span class="required">*</span></label>
                <input [(ngModel)]="draft.title" name="d_title" placeholder="e.g. Code of Conduct" />
              </div>
              <div class="meta-field meta-narrow">
                <label>Category</label>
                <select [(ngModel)]="draft.category" name="d_cat">
                  @for (c of categories; track c.key) {
                    <option [value]="c.key">{{ c.label }}</option>
                  }
                </select>
              </div>
            </div>
            <div class="meta-row">
              <div class="meta-field">
                <label>Short summary</label>
                <input [(ngModel)]="draft.summary" name="d_summary" placeholder="One-line description shown in the list." />
              </div>
            </div>
            <div class="meta-row">
              <div class="meta-field">
                <label>Sidenav</label>
                <label class="inline-toggle">
                  <input type="checkbox" [(ngModel)]="draft.show_in_sidenav" name="d_sidenav" />
                  <span>Show in the public /legal sidenav</span>
                </label>
              </div>
              <div class="meta-field">
                <label>Parent policy</label>
                <select [(ngModel)]="draft.parent_id" name="d_parent">
                  <option [ngValue]="null">— top-level —</option>
                  @for (p of documents(); track p.id) {
                    <option [ngValue]="p.id">{{ p.title }}</option>
                  }
                </select>
              </div>
            </div>
            @if (createError()) { <p class="err">{{ createError() }}</p> }
          </div>
          <div class="modal-foot">
            <span class="spacer"></span>
            <button class="ghost" (click)="closeCreate()">Cancel</button>
            <button class="primary" (click)="submitCreate()" [disabled]="!draft.title.trim() || busy()">
              {{ busy() ? 'Creating…' : 'Create draft' }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .toolbar { padding: 16px 20px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
    .toolbar h1 { margin: 0; font-size: 22px; }
    .spacer { flex: 1; }
    .cat-filter { width: auto; min-width: 180px; }

    .page { padding: 20px; background: #ffffff; min-height: calc(100vh - 120px); }
    .empty { padding: 60px 20px; text-align: center; display: flex; flex-direction: column; gap: 12px; align-items: center; }

    .slot-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .slot {
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
      padding: 14px 16px; display: flex; flex-direction: column; gap: 6px;
      cursor: pointer; transition: border-color 0.15s;
    }
    .slot:hover { border-color: var(--primary); }
    .slot-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .slot-head strong { font-size: 15px; }
    .summary { margin: 4px 0 0; }
    .slot-meta { padding-top: 6px; border-top: 1px solid var(--line); display: flex; gap: 8px; flex-wrap: wrap; color: var(--muted); }

    .cat-pill {
      padding: 1px 8px; border-radius: 999px;
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      border: 1px solid var(--line); color: var(--muted);
    }
    .status {
      padding: 1px 8px; border-radius: 999px;
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      border: 1px solid var(--line);
    }
    .status-published { color: var(--primary); border-color: var(--primary); background: rgba(212,169,58,0.12); }
    .status-draft     { color: var(--muted); }

    /* Modal pattern matches the canonical project modal. */
    .modal-backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,0.6);
      display: flex; align-items: center; justify-content: center; z-index: 100;
    }
    .modal {
      width: 560px; max-width: 92vw; max-height: 92vh;
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius);
      display: flex; flex-direction: column; overflow: hidden;
    }
    .modal-head { display: flex; align-items: flex-start; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid var(--line); flex: 0 0 auto; gap: 12px; }
    .modal-head h2 { margin: 0; font-size: 16px; }
    .modal-body { padding: 16px 18px; flex: 1 1 auto; overflow: auto; display: flex; flex-direction: column; gap: 12px; }
    .modal-foot { padding: 14px 18px; border-top: 1px solid var(--line); display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }

    .meta-row { display: flex; gap: 12px; flex-wrap: wrap; align-items: end; }
    .meta-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 200px; }
    .meta-field.meta-narrow { flex: 0 0 200px; min-width: 200px; }
    .meta-field label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; margin: 0; }
    .required { color: #ef4444; }
    .err { color: #ef4444; font-size: 13px; margin: 0; }
  `],
})
export class HrLegal {
  private api = inject(Api);
  private router = inject(Router);

  readonly categories = CATEGORIES;

  documents = signal<HrLegalDocument[]>([]);
  loading   = signal(true);
  filter    = signal<'all' | string>('all');

  filtered = computed(() => {
    const f = this.filter();
    if (f === 'all') return this.documents();
    return this.documents().filter(d => (d.category ?? 'policy') === f);
  });

  creating    = signal(false);
  createError = signal<string | null>(null);
  busy        = signal(false);
  draft: {
    title: string;
    category: string;
    summary: string;
    show_in_sidenav: boolean;
    parent_id: number | null;
  } = this.blankDraft();

  ngOnInit() {
    this.api.listHrLegalDocs().subscribe({
      next: r => { this.documents.set(r.documents); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  blankDraft() {
    return { title: '', category: 'policy', summary: '', show_in_sidenav: true, parent_id: null as number | null };
  }
  openCreate() {
    this.draft = this.blankDraft();
    this.createError.set(null);
    this.creating.set(true);
  }
  closeCreate() { if (!this.busy()) this.creating.set(false); }
  submitCreate() {
    if (!this.draft.title.trim()) { this.createError.set('Title is required'); return; }
    this.busy.set(true);
    this.api.createHrLegalDoc({
      title: this.draft.title.trim(),
      category: this.draft.category || 'policy',
      summary: this.draft.summary.trim() || null,
      is_published: 0,
      show_in_sidenav: this.draft.show_in_sidenav ? 1 : 0,
      parent_id: this.draft.parent_id,
    }).subscribe({
      next: r => {
        this.busy.set(false);
        this.creating.set(false);
        // Land directly on the new document's edit page.
        this.router.navigate(['/hr/legal', r.slug]);
      },
      error: e => { this.busy.set(false); this.createError.set(e?.error?.error || 'Could not create'); },
    });
  }

  open(d: HrLegalDocument) {
    if (d.slug) this.router.navigate(['/hr/legal', d.slug]);
  }
  /** Public-facing URL for an admin row. Respects the /builtrightstudio
   *  base path used in dev (matches the same scheme as `publicJobUrl` in
   *  hr-recruitment). Drafts still link here so HR can preview, but the
   *  backend will return 404 until the doc is published. */
  publicUrl(d: HrLegalDocument): string {
    if (!d.slug) return '';
    const base = location.origin + (location.pathname.startsWith('/builtrightstudio') ? '/builtrightstudio' : '');
    return `${base}/legal/${d.slug}`;
  }
  categoryLabel(key: string | undefined): string {
    return CATEGORIES.find(c => c.key === (key ?? 'policy'))?.label ?? (key ?? '');
  }
}
