import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Api } from '../../core/api';
import { HrLegalDocument } from '../../core/models';
import { SettingsService } from '../../core/settings.service';
import { PublicBrandBanner, PublicFooter } from '../../shared/public-chrome';
import { PublicLegalSidenav } from './public-legal-sidenav';

/**
 * /legal/:slug — public view of a published legal document.
 * Anonymous, no shell, no auth — same pattern as /jobs/:slug.
 *
 * The body is HTML authored in the admin (see /hr/legal/:slug edit mode)
 * and rendered with [innerHTML]. Only documents with is_published=1 are
 * served by the backend; drafts return 404.
 *
 * Header + footer come from `shared/public-chrome.ts` so they stay in
 * sync with the form / index / onboarding-portal pages.
 */
@Component({
  selector: 'app-public-legal',
  imports: [PublicBrandBanner, PublicFooter, PublicLegalSidenav],
  template: `
    <app-public-brand-banner [brandName]="brandName()" [brandLogoUrl]="brandLogoUrl()"></app-public-brand-banner>

    <div class="wrap">
      <app-public-legal-sidenav></app-public-legal-sidenav>

      <div class="main">
        @if (loading()) {
          <p class="muted">Loading…</p>
        } @else if (notFound()) {
          <div class="card empty">
            <h1>Document not found</h1>
            <p class="muted">This page is unavailable, or the link is wrong.</p>
          </div>
        } @else if (doc(); as d) {
          <article class="card doc">
            <header class="doc-head">
              <span class="cat">{{ categoryLabel(d.category) }}</span>
              <h1>{{ d.title }}</h1>
              @if (d.summary) { <p class="summary">{{ d.summary }}</p> }
              @if (d.updated_at) { <p class="meta">Last updated {{ d.updated_at }}</p> }
            </header>
            @if (d.body) {
              <div class="doc-body" [innerHTML]="d.body"></div>
            } @else {
              <p class="muted">This document has no content yet.</p>
            }
          </article>
        }
      </div>
    </div>

    <app-public-footer></app-public-footer>
  `,
  styles: [`
    :host { display: block; min-height: 100vh; background: #ffffff; color: #0a0a0a; }
    .wrap {
      max-width: 1120px; margin: 0 auto; padding: 40px 24px;
      display: grid; grid-template-columns: 240px 1fr; gap: 32px;
      align-items: start;
    }
    @media (max-width: 800px) {
      .wrap { grid-template-columns: 1fr; }
    }
    .main { min-width: 0; }
    .muted { color: #6b7280; }

    .card {
      background: #ffffff;
      border: 1px solid #e5e5e5;
      border-radius: 12px;
      padding: 40px;
    }
    .empty { text-align: center; }
    .empty h1 { margin: 0 0 8px; }

    .doc-head { padding-bottom: 20px; margin-bottom: 24px; border-bottom: 1px solid #e5e5e5; display: flex; flex-direction: column; gap: 8px; }
    .doc-head .cat {
      align-self: flex-start;
      padding: 2px 10px; border-radius: 999px;
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      border: 1px solid #d4a93a; color: #d4a93a; background: rgba(212,169,58,0.08);
    }
    .doc-head h1 { margin: 4px 0 0; font-size: 28px; line-height: 1.2; }
    .doc-head .summary { margin: 4px 0 0; font-size: 16px; color: #4b5563; }
    .doc-head .meta { margin: 0; font-size: 12px; color: #6b7280; }

    .doc-body { line-height: 1.7; font-size: 15px; color: #1f2937; }
    .doc-body :first-child { margin-top: 0; }
    .doc-body h1, .doc-body h2, .doc-body h3 { color: #0a0a0a; margin: 1.6em 0 0.4em; }
    .doc-body h2 { font-size: 22px; }
    .doc-body h3 { font-size: 18px; }
    .doc-body p, .doc-body ul, .doc-body ol { margin: 0.8em 0; }
    .doc-body a { color: #d4a93a; text-decoration: underline; }
    .doc-body code { background: #f3f4f6; padding: 1px 6px; border-radius: 4px; font-size: 12px; }
    .doc-body strong { color: #0a0a0a; }
  `],
})
export class PublicLegal {
  private route = inject(ActivatedRoute);
  private api   = inject(Api);
  private svc   = inject(SettingsService);

  brandName    = this.svc.brandName;
  brandLogoUrl = this.svc.brandLogoUrl;
  doc          = signal<HrLegalDocument | null>(null);
  loading      = signal(true);
  notFound     = signal(false);

  ngOnInit() {
    this.svc.ensureLoaded();
    const slug = this.route.snapshot.paramMap.get('slug') || '';
    if (!slug) { this.notFound.set(true); this.loading.set(false); return; }
    this.api.getPublicLegal(slug).subscribe({
      next: r => { this.doc.set(r.document); this.loading.set(false); },
      error: () => { this.notFound.set(true); this.loading.set(false); },
    });
  }

  categoryLabel(key: string | undefined): string {
    switch (key) {
      case 'policy':  return 'Policy';
      case 'terms':   return 'Terms & Conditions';
      case 'privacy': return 'Privacy';
      case 'other':   return 'Other';
      default:        return key || '';
    }
  }
}
