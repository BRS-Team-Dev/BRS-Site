import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { DialogService } from '../../core/dialog';

type Mode = 'list' | 'edit';

interface SitePreview {
  id?: number;
  slug: string;
  name: string;
  category: string | null;
  feature: { video: string; overline: string; heading: string; body: string };
  mockup:  { desktop: string; tablet: string; phone: string };
  fullvideo: string | null;
  fullimage: string | null;
  is_published: boolean;
}

const empty = (): SitePreview => ({
  slug: '', name: '', category: '',
  feature: { video: '', overline: 'Feature', heading: '', body: '' },
  mockup:  { desktop: '', tablet: '', phone: '' },
  fullvideo: '', fullimage: '', is_published: true,
});

/**
 * Site Previews admin — CRUD for the marketing site's
 * /site-view.html?site=<slug> preview data. Each row is a client
 * site showcase (feature video + text, device mockup, full video,
 * long full-page image). Public read at /api/public-site-preview/:slug.
 *
 *   /admin/site-previews              → list
 *   /admin/site-previews/new          → create
 *   /admin/site-previews/:slug/edit   → edit
 */
@Component({
  selector: 'app-site-previews-admin',
  imports: [RouterLink, FormsModule],
  template: `
    @if (mode() === 'list') {
      <div class="toolbar">
        <h1>Site previews</h1>
        <span class="spacer"></span>
        <button class="primary" routerLink="/admin/site-previews/new">+ New site preview</button>
      </div>

      @if (rows().length === 0) {
        <div class="empty">
          <p class="muted">No site previews yet.</p>
          <button class="primary" routerLink="/admin/site-previews/new">Create your first preview</button>
        </div>
      } @else {
        <div class="table-wrap">
          <table class="data">
            <thead><tr>
              <th>Name</th><th>Slug</th><th>Category</th><th>Published</th><th>Updated</th><th></th>
            </tr></thead>
            <tbody>
              @for (r of rows(); track r.slug) {
                <tr (click)="edit(r)">
                  <td><strong>{{ r.name }}</strong></td>
                  <td><span class="muted mono small">{{ r.slug }}</span></td>
                  <td>{{ r.category || '—' }}</td>
                  <td>
                    <span class="status-pill" [attr.data-status]="r.is_published ? 'active' : 'inactive'">
                      {{ r.is_published ? 'Live' : 'Draft' }}
                    </span>
                  </td>
                  <td class="muted small">{{ r.updated_at }}</td>
                  <td class="actions">
                    <a class="ghost small" [href]="publicUrl(r.slug)" target="_blank" (click)="$event.stopPropagation()">View</a>
                    <button class="ghost icon-btn" (click)="edit(r, $event)" title="Edit">✎</button>
                    <button class="ghost icon-btn danger" (click)="del(r, $event)" title="Delete">✕</button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    }

    @if (mode() === 'edit') {
      <div class="toolbar">
        <button class="ghost" (click)="back()">← Back</button>
        <h1>{{ draft.slug ? draft.name || draft.slug : 'New site preview' }}</h1>
        <span class="spacer"></span>
        @if (originalSlug()) {
          <a class="ghost" [href]="publicUrl(originalSlug()!)" target="_blank">View live →</a>
        }
        <button class="primary" (click)="save()" [disabled]="saving()">
          {{ saving() ? 'Saving…' : 'Save' }}
        </button>
      </div>
      @if (error()) { <div class="error-msg">{{ error() }}</div> }

      <div class="card">
        <h2>Basics</h2>
        <div class="row three">
          <div class="field">
            <label>Slug <span class="req">★</span></label>
            <input [(ngModel)]="draft.slug" name="sp_slug" placeholder="my-site" />
            <span class="muted small">URL id — lower-case letters, digits, hyphens.</span>
          </div>
          <div class="field">
            <label>Site name <span class="req">★</span></label>
            <input [(ngModel)]="draft.name" name="sp_name" />
          </div>
          <div class="field">
            <label>Category</label>
            <input [(ngModel)]="draft.category" name="sp_cat" placeholder="Websites, Branding…" />
          </div>
        </div>
        <label class="check nowrap" style="margin-top: 12px;">
          <input type="checkbox" [(ngModel)]="draft.is_published" name="sp_pub" /> Published (visible to the public URL)
        </label>
      </div>

      <div class="card">
        <h2>Feature section (video left, text right)</h2>
        <div class="field">
          <label>Video URL (mp4)</label>
          <input [(ngModel)]="draft.feature.video" name="sp_fv" />
        </div>
        <div class="row two">
          <div class="field">
            <label>Overline</label>
            <input [(ngModel)]="draft.feature.overline" name="sp_fo" />
          </div>
          <div class="field">
            <label>Heading</label>
            <input [(ngModel)]="draft.feature.heading" name="sp_fh" />
          </div>
        </div>
        <div class="field">
          <label>Body</label>
          <textarea rows="4" [(ngModel)]="draft.feature.body" name="sp_fb"></textarea>
        </div>
      </div>

      <div class="card">
        <h2>Device mockup screenshots</h2>
        <div class="row three">
          <div class="field">
            <label>Desktop image URL</label>
            <input [(ngModel)]="draft.mockup.desktop" name="sp_md" />
          </div>
          <div class="field">
            <label>Tablet image URL</label>
            <input [(ngModel)]="draft.mockup.tablet" name="sp_mt" />
          </div>
          <div class="field">
            <label>Phone image URL</label>
            <input [(ngModel)]="draft.mockup.phone" name="sp_mp" />
          </div>
        </div>
      </div>

      <div class="card">
        <h2>Full-page video &amp; image</h2>
        <div class="field">
          <label>Full-page video URL (mp4)</label>
          <input [(ngModel)]="draft.fullvideo" name="sp_ffv" />
        </div>
        <div class="field">
          <label>Full-page image URL (long website screenshot)</label>
          <input [(ngModel)]="draft.fullimage" name="sp_ffi" />
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .layout { padding: 20px; }
    .field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
    .row.two   { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .row.three { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    @media (max-width: 780px) {
      .row.two, .row.three { grid-template-columns: 1fr; }
    }
    .card { padding: 20px; }
    .card + .card { margin-top: 16px; }
    .card h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); margin: 0 0 12px 0; font-weight: 600; }
    .req { color: var(--primary); margin-left: 2px; }
    .mono { font-family: monospace; }
    .actions { text-align: right; white-space: nowrap; }
    .ghost.small { padding: 4px 10px; font-size: 12px; }
  `],
})
export class SitePreviewsAdmin {
  private api = inject(Api);
  private dialog = inject(DialogService);
  private router = inject(Router);
  private route  = inject(ActivatedRoute);

  rows = signal<any[]>([]);
  mode = signal<Mode>('list');
  draft: SitePreview = empty();
  originalSlug = signal<string | null>(null);

  saving = signal(false);
  error = signal<string | null>(null);

  constructor() {
    this.route.url.subscribe(() => this.routeToMode());
    this.route.params.subscribe(() => this.routeToMode());
    this.loadList();
  }

  private routeToMode() {
    const url = this.router.url;
    if (url.endsWith('/admin/site-previews') || url.startsWith('/admin/site-previews?')) {
      this.mode.set('list');
      this.originalSlug.set(null);
      return;
    }
    if (url.endsWith('/admin/site-previews/new')) {
      this.draft = empty();
      this.originalSlug.set(null);
      this.mode.set('edit');
      this.error.set(null);
      return;
    }
    const m = /\/admin\/site-previews\/([a-z0-9-]+)\/edit/.exec(url);
    if (m) this.loadOne(m[1]);
  }

  private loadList() {
    this.api.listSitePreviews().subscribe(r => this.rows.set(r.site_previews));
  }
  private loadOne(slug: string) {
    this.api.getSitePreview(slug).subscribe(r => {
      // Backend returns the row already decoded (feature/mockup as objects).
      const sp = r.site_preview;
      this.draft = {
        slug: sp.slug, name: sp.name, category: sp.category ?? '',
        feature: { video: sp.feature?.video ?? '', overline: sp.feature?.overline ?? 'Feature',
                   heading: sp.feature?.heading ?? '', body: sp.feature?.body ?? '' },
        mockup:  { desktop: sp.mockup?.desktop ?? '', tablet: sp.mockup?.tablet ?? '',
                   phone: sp.mockup?.phone ?? '' },
        fullvideo: sp.fullvideo ?? '', fullimage: sp.fullimage ?? '',
        is_published: !!sp.is_published,
      };
      this.originalSlug.set(sp.slug);
      this.error.set(null);
      this.mode.set('edit');
    });
  }

  edit(r: any, e?: Event) { e?.stopPropagation(); this.router.navigate(['/admin/site-previews', r.slug, 'edit']); }
  back() { this.router.navigate(['/admin/site-previews']); }

  async del(r: any, e: Event) {
    e.stopPropagation();
    const ok = await this.dialog.confirm(
      `Delete "${r.name}"? The public URL /site-view.html?site=${r.slug} will 404.`,
      { title: 'Delete site preview', confirmLabel: 'Delete', variant: 'danger' },
    );
    if (!ok) return;
    this.api.deleteSitePreview(r.slug).subscribe(() => this.loadList());
  }

  save() {
    this.error.set(null);
    const slug = (this.draft.slug || '').trim();
    if (!/^[a-z0-9-]+$/.test(slug)) { this.error.set('Slug must be lower-case letters, digits or hyphens.'); return; }
    if (!(this.draft.name || '').trim()) { this.error.set('Name is required.'); return; }
    this.saving.set(true);
    const payload = { ...this.draft, slug };
    const orig = this.originalSlug();
    const after = (savedSlug: string) => {
      this.saving.set(false);
      this.router.navigate(['/admin/site-previews', savedSlug, 'edit']);
    };
    const fail = (e: any) => { this.saving.set(false); this.error.set(e?.error?.error || 'Save failed.'); };
    if (orig) {
      this.api.updateSitePreview(orig, payload).subscribe({ next: r => after(r.slug), error: fail });
    } else {
      this.api.createSitePreview(payload).subscribe({ next: r => after(r.slug), error: fail });
    }
  }

  publicUrl(slug: string): string {
    // Marketing site lives at the same host under /builtrightstudio/main-website/.
    return `/builtrightstudio/main-website/site-view.html?site=${encodeURIComponent(slug)}`;
  }
}
