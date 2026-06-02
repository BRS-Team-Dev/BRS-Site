import { Component, inject, signal, computed } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
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
 * /hr/legal/:slug — single legal document on its own page.
 *
 * Two modes:
 *  - **view** (default): renders the body HTML with [innerHTML]
 *  - **edit**: title / category / summary / body / publish toggle, auto-save
 *    on blur. Mirrors the project's standard auto-save pattern.
 *
 * Backend accepts id or slug for GET, so the URL stays human-readable.
 */
@Component({
  selector: 'app-hr-legal-detail',
  imports: [FormsModule],
  template: `
    <div class="toolbar">
      <button class="ghost back" (click)="back()" title="Back to list">← Back</button>
      <h1>{{ doc()?.title || 'Loading…' }}</h1>
      @if (doc(); as d) {
        @if (d.is_published) {
          <span class="status status-published">published</span>
        } @else {
          <span class="status status-draft">draft</span>
        }
      }
      <span class="spacer"></span>
      @if (doc(); as d) {
        <button class="ghost" (click)="mode.set(mode() === 'edit' ? 'view' : 'edit')">
          {{ mode() === 'edit' ? '← Done editing' : '✎ Edit' }}
        </button>
        @if (d.is_published) {
          <button class="ghost" (click)="patch({ is_published: 0 })">Unpublish</button>
        } @else {
          <button class="primary" (click)="patch({ is_published: 1 })">Publish</button>
        }
        <button class="ghost danger" (click)="del()" title="Delete">✕</button>
      }
    </div>

    <div class="page">
      @if (loading()) {
        <p class="muted">Loading…</p>
      } @else if (!doc()) {
        <div class="empty">
          <p class="muted">Document not found.</p>
        </div>
      } @else if (doc(); as d) {
        @if (mode() === 'view') {
          <article class="doc">
            <header class="doc-head">
              <span class="cat-pill">{{ categoryLabel(d.category) }}</span>
              @if (d.summary) { <p class="muted">{{ d.summary }}</p> }
              @if (d.updated_at) { <p class="muted small">Last updated {{ d.updated_at }}</p> }
            </header>
            @if (d.body) {
              <div class="doc-body" [innerHTML]="d.body"></div>
            } @else {
              <p class="muted small empty-body">This document has no content yet. Click <strong>✎ Edit</strong> to add some.</p>
            }
          </article>
        } @else {
          <div class="form-sections">
            <div class="section-card">
              <h3 class="card-title">Metadata</h3>
              <div class="meta-row">
                <div class="meta-field">
                  <label>Title</label>
                  <input [ngModel]="d.title" (blur)="patch({ title: $any($event.target).value })" name="t_title" />
                </div>
                <div class="meta-field meta-narrow">
                  <label>Category</label>
                  <select [ngModel]="d.category" (ngModelChange)="patch({ category: $event })" name="t_cat">
                    @for (c of categories; track c.key) {
                      <option [value]="c.key">{{ c.label }}</option>
                    }
                  </select>
                </div>
              </div>
              <div class="meta-row">
                <div class="meta-field">
                  <label>Summary</label>
                  <input [ngModel]="d.summary" (blur)="patch({ summary: $any($event.target).value })" name="t_summary"
                    placeholder="One-line description shown in the list." />
                </div>
              </div>
              <div class="meta-row">
                <div class="meta-field">
                  <label>Sidenav</label>
                  <label class="inline-toggle">
                    <input type="checkbox"
                      [checked]="!!d.show_in_sidenav"
                      (change)="patch({ show_in_sidenav: $any($event.target).checked ? 1 : 0 })" />
                    <span>Show in the public /legal sidenav</span>
                  </label>
                </div>
                <div class="meta-field">
                  <label>Parent policy</label>
                  <select [ngModel]="d.parent_id" (ngModelChange)="patch({ parent_id: $event })" name="t_parent">
                    <option [ngValue]="null">— top-level —</option>
                    @for (p of parentChoices(); track p.id) {
                      <option [ngValue]="p.id">{{ p.title }}</option>
                    }
                  </select>
                </div>
              </div>
            </div>

            <div class="section-card">
              <h3 class="card-title">Body <span class="muted small">(HTML — basic tags supported)</span></h3>
              <textarea rows="22" class="body-input"
                [ngModel]="d.body"
                (blur)="patch({ body: $any($event.target).value })"
                name="t_body"
                placeholder="<h2>Section title</h2>
<p>Paragraph text…</p>
<ul><li>Bullet</li></ul>"></textarea>
              <p class="muted small no-notes">Use plain HTML — &lt;h2&gt;, &lt;p&gt;, &lt;ul&gt;/&lt;ol&gt;, &lt;a&gt;, &lt;strong&gt; render as expected. Saved on blur.</p>
            </div>
          </div>
        }
      }
    </div>
  `,
  styles: [`
    .toolbar { padding: 16px 20px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
    .toolbar h1 { margin: 0; font-size: 22px; }
    .spacer { flex: 1; }
    .back { padding: 4px 10px; }

    .page { padding: 20px 24px 32px; background: #ffffff; min-height: calc(100vh - 120px); }
    .empty { padding: 60px 20px; text-align: center; }

    /* Read-only article view. */
    .doc {
      max-width: 760px; margin: 0 auto;
      background: var(--bg-3); border: 1px solid var(--line); border-radius: var(--radius);
      padding: 32px 36px;
    }
    .doc-head { padding-bottom: 16px; margin-bottom: 16px; border-bottom: 1px solid var(--line); display: flex; flex-direction: column; gap: 6px; }
    .doc-head p { margin: 0; }
    .doc-body { line-height: 1.6; font-size: 14px; }
    .doc-body :first-child { margin-top: 0; }
    .doc-body h1, .doc-body h2, .doc-body h3 { color: var(--fg); margin: 1.4em 0 0.4em; }
    .doc-body h2 { font-size: 18px; }
    .doc-body h3 { font-size: 16px; }
    .doc-body p, .doc-body ul, .doc-body ol { margin: 0.6em 0; color: var(--fg); }
    .doc-body a { color: var(--primary); text-decoration: none; }
    .doc-body a:hover { text-decoration: underline; }
    .doc-body code { background: var(--bg-2); padding: 1px 6px; border-radius: 4px; font-size: 12px; }
    .empty-body { text-align: center; padding: 40px 0; }

    .cat-pill {
      align-self: flex-start;
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

    /* Edit mode — same section-card pattern as the rest of the project. */
    .form-sections { display: flex; flex-direction: column; gap: 18px; max-width: 900px; margin: 0 auto; }
    .section-card {
      background: var(--bg-3); border: 1px solid var(--line); border-radius: var(--radius);
      padding: 18px; display: flex; flex-direction: column; gap: 14px;
    }
    .section-card .card-title {
      margin: 0; font-size: 13px; color: var(--muted);
      text-transform: uppercase; letter-spacing: 0.6px; font-weight: 700;
    }
    .section-card .no-notes { margin: 0; }
    .meta-row { display: flex; gap: 12px; flex-wrap: wrap; align-items: end; }
    .meta-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 200px; }
    .meta-field.meta-narrow { flex: 0 0 200px; min-width: 200px; }
    .meta-field label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; margin: 0; }
    .body-input { font-family: var(--mono, ui-monospace, monospace); font-size: 13px; line-height: 1.5; }
  `],
})
export class HrLegalDetail {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  readonly categories = CATEGORIES;

  doc      = signal<HrLegalDocument | null>(null);
  loading  = signal(true);
  mode     = signal<'view' | 'edit'>('view');
  /** All other published/draft docs — used to populate the parent dropdown. */
  allDocs  = signal<HrLegalDocument[]>([]);

  /** Parent dropdown choices: every other doc *minus* this doc and its
   *  descendants, so picking a parent can never create a cycle. */
  parentChoices = computed<HrLegalDocument[]>(() => {
    const me = this.doc();
    if (!me?.id) return this.allDocs();
    const all = this.allDocs();
    // BFS to collect ids reachable downward from me.
    const blocked = new Set<number>([me.id]);
    let frontier = [me.id];
    while (frontier.length > 0) {
      const next: number[] = [];
      for (const d of all) {
        if (d.id && d.parent_id != null && frontier.includes(d.parent_id) && !blocked.has(d.id)) {
          blocked.add(d.id);
          next.push(d.id);
        }
      }
      frontier = next;
    }
    return all.filter(d => d.id != null && !blocked.has(d.id));
  });

  ngOnInit() {
    const slug = this.route.snapshot.paramMap.get('slug');
    if (!slug) { this.loading.set(false); return; }
    this.api.getHrLegalDoc(slug).subscribe({
      next: r => { this.doc.set(r.document); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
    // Load the full list in parallel so the parent dropdown is ready by the
    // time the user flips into edit mode.
    this.api.listHrLegalDocs().subscribe(r => this.allDocs.set(r.documents));
  }

  back() { this.router.navigate(['/hr/legal']); }

  /** Auto-save patch. If the slug changed (because the title changed) the
   *  URL is updated in-place via replaceState so the link stays human. */
  patch(p: Partial<HrLegalDocument>) {
    const d = this.doc();
    if (!d?.id) return;
    this.api.updateHrLegalDoc(d.id, p).subscribe(r => {
      const merged: HrLegalDocument = { ...d, ...p };
      if (r.slug && r.slug !== d.slug) {
        merged.slug = r.slug;
        // URL update without a navigation so the editor stays open.
        this.router.navigate(['/hr/legal', r.slug], { replaceUrl: true });
      }
      this.doc.set(merged);
    });
  }

  del() {
    const d = this.doc();
    if (!d?.id) return;
    if (!confirm(`Delete "${d.title}"? This cannot be undone.`)) return;
    this.api.deleteHrLegalDoc(d.id).subscribe(() => this.router.navigate(['/hr/legal']));
  }

  categoryLabel(key: string | undefined): string {
    return CATEGORIES.find(c => c.key === (key ?? 'policy'))?.label ?? (key ?? '');
  }
}
