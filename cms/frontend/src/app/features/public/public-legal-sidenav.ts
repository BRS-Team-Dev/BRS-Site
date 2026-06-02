import { Component, Input, computed, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { Api } from '../../core/api';
import { HrLegalDocument } from '../../core/models';

interface LegalNode {
  doc: HrLegalDocument;
  children: HrLegalDocument[];
}

/**
 * Sidenav for the public /legal area. Loads every published doc once and
 * renders a two-level tree:
 *
 *   • Top-level entries (parent_id = null)
 *     ◦ Children (parent_id = top-level id)
 *
 * Only docs with show_in_sidenav=1 appear. The active doc is highlighted
 * via routerLinkActive so it works on both the index and the per-doc page.
 *
 * Used by both `public-legal-index` and `public-legal` so the layout
 * stays consistent across the public legal area.
 */
@Component({
  selector: 'app-public-legal-sidenav',
  imports: [RouterLink, RouterLinkActive],
  template: `
    <aside class="legal-nav">
      <a class="nav-head" routerLink="/legal" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">
        Legal
      </a>
      @if (loading()) {
        <p class="muted small">Loading…</p>
      } @else if (tree().length === 0) {
        <p class="muted small">Nothing in the sidenav yet.</p>
      } @else {
        <ul class="nav-list">
          @for (n of tree(); track n.doc.id) {
            <li>
              <a [routerLink]="['/legal', n.doc.slug]" routerLinkActive="active">
                {{ n.doc.title }}
              </a>
              @if (n.children.length > 0) {
                <ul class="nav-children">
                  @for (c of n.children; track c.id) {
                    <li>
                      <a [routerLink]="['/legal', c.slug]" routerLinkActive="active">
                        {{ c.title }}
                      </a>
                    </li>
                  }
                </ul>
              }
            </li>
          }
        </ul>
      }
    </aside>
  `,
  styles: [`
    .legal-nav {
      align-self: start;
      background: #fafafa;
      border: 1px solid #e5e5e5;
      border-radius: 12px;
      padding: 20px 16px;
      display: flex; flex-direction: column; gap: 8px;
      position: sticky; top: 24px;
    }
    .nav-head {
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px;
      color: #6b7280; font-weight: 700; text-decoration: none;
      padding: 4px 6px; border-radius: 6px;
    }
    .nav-head.active { color: #d4a93a; }
    .nav-head:hover { color: #d4a93a; }

    .nav-list, .nav-children { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
    .nav-list > li > a, .nav-children > li > a {
      display: block;
      padding: 8px 10px;
      border-radius: 6px;
      color: #1f2937;
      text-decoration: none;
      font-size: 14px;
      transition: background 0.15s, color 0.15s;
    }
    .nav-list > li > a:hover, .nav-children > li > a:hover { background: #f3f4f6; color: #d4a93a; }
    .nav-list > li > a.active, .nav-children > li > a.active {
      background: rgba(212,169,58,0.14); color: #d4a93a; font-weight: 600;
    }
    .nav-children {
      margin-top: 4px;
      padding-left: 10px;
      border-left: 1px solid #e5e5e5;
    }
    .nav-children > li > a { font-size: 13px; padding: 6px 10px; color: #4b5563; }

    .muted { color: #6b7280; }
    .small { font-size: 12px; }
  `],
})
export class PublicLegalSidenav {
  private api = inject(Api);

  /** Optional pre-loaded list — saves a second request when the host
   *  component already fetched the public list. */
  @Input() set documents(docs: HrLegalDocument[] | null | undefined) {
    if (docs && docs.length > 0) {
      this.allDocs.set(docs);
      this.loading.set(false);
      this.fetched = true;
    }
  }

  loading = signal(true);
  allDocs = signal<HrLegalDocument[]>([]);
  private fetched = false;

  /** Top-level nodes (parent_id null) with their children inlined. */
  tree = computed<LegalNode[]>(() => {
    const visible = this.allDocs().filter(d => !!d.show_in_sidenav);
    const childrenByParent = new Map<number, HrLegalDocument[]>();
    for (const d of visible) {
      if (d.parent_id != null) {
        const list = childrenByParent.get(d.parent_id) ?? [];
        list.push(d);
        childrenByParent.set(d.parent_id, list);
      }
    }
    return visible
      .filter(d => d.parent_id == null)
      .map(d => ({ doc: d, children: childrenByParent.get(d.id!) ?? [] }));
  });

  ngOnInit() {
    if (this.fetched) return;
    this.api.listPublicLegal().subscribe({
      next: r => { this.allDocs.set(r.documents); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }
}
