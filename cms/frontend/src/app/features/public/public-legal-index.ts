import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import { HrLegalDocument } from '../../core/models';
import { SettingsService } from '../../core/settings.service';
import { PublicBrandBanner, PublicFooter } from '../../shared/public-chrome';
import { PublicLegalSidenav } from './public-legal-sidenav';

/**
 * /legal — public index of every published legal document.
 * Anonymous, no shell, no auth.
 *
 * Header + footer are pulled from `shared/public-chrome.ts` so all
 * public pages stay visually consistent.
 */
@Component({
  selector: 'app-public-legal-index',
  imports: [RouterLink, PublicBrandBanner, PublicFooter, PublicLegalSidenav],
  template: `
    <app-public-brand-banner [brandName]="brandName()" [brandLogoUrl]="brandLogoUrl()"></app-public-brand-banner>

    <div class="wrap">
      <app-public-legal-sidenav [documents]="documents()"></app-public-legal-sidenav>

      <div class="main">
        <div class="card">
          <header class="hd">
            <h1>Legal</h1>
            <p class="muted">{{ documents().length }} document{{ documents().length === 1 ? '' : 's' }} published.</p>
          </header>

          @if (loading()) {
            <p class="muted">Loading…</p>
          } @else if (documents().length === 0) {
            <div class="empty">
              <h2>Nothing here yet</h2>
              <p class="muted">Check back soon — we publish legal updates as they become available.</p>
            </div>
          } @else {
            <ul class="list">
              @for (d of documents(); track d.id) {
                <li class="row">
                  <a [routerLink]="['/legal', d.slug]" class="link">
                    <div class="head">
                      <strong>{{ d.title }}</strong>
                      <span class="cat">{{ categoryLabel(d.category) }}</span>
                    </div>
                    @if (d.summary) { <p class="summary">{{ d.summary }}</p> }
                    @if (d.updated_at) { <p class="meta">Updated {{ d.updated_at }}</p> }
                  </a>
                </li>
              }
            </ul>
          }
        </div>
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
      background: #ffffff; border: 1px solid #e5e5e5; border-radius: 12px;
      padding: 40px;
    }
    .hd { padding-bottom: 20px; border-bottom: 1px solid #e5e5e5; margin-bottom: 24px; }
    .hd h1 { margin: 0 0 6px; font-size: 28px; }
    .hd p { margin: 0; }
    .empty { padding: 40px 0; text-align: center; }
    .empty h2 { margin: 0 0 8px; }

    .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
    .row { background: #fafafa; border: 1px solid #e5e5e5; border-radius: 8px; transition: border-color 0.15s; }
    .row:hover { border-color: #d4a93a; }
    .link { display: block; padding: 16px 18px; color: #0a0a0a; text-decoration: none; }
    .head { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
    .head strong { font-size: 16px; }
    .cat {
      padding: 1px 8px; border-radius: 999px;
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      border: 1px solid #e5e5e5; color: #6b7280;
    }
    .summary { margin: 4px 0 4px; font-size: 13px; color: #4b5563; }
    .meta { margin: 0; font-size: 12px; color: #6b7280; }
  `],
})
export class PublicLegalIndex {
  private api = inject(Api);
  private svc = inject(SettingsService);

  brandName    = this.svc.brandName;
  brandLogoUrl = this.svc.brandLogoUrl;
  documents    = signal<HrLegalDocument[]>([]);
  loading      = signal(true);

  ngOnInit() {
    this.svc.ensureLoaded();
    this.api.listPublicLegal().subscribe({
      next: r => { this.documents.set(r.documents); this.loading.set(false); },
      error: () => this.loading.set(false),
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
