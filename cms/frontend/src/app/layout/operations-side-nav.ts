import { Component, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter } from 'rxjs';
import { Api } from '../core/api';
import { SettingsService } from '../core/settings.service';
import { SideNavFooter } from './side-nav-footer';
import { environment } from '@env/environment';

/**
 * Sidenav for the Operations system (`/operations/*`).
 *
 * Tenders is an expandable parent: it routes to the tracked-tenders list and
 * hosts Lead Gen (the scraped tender-opportunity feed) as a child. Lead Gen in
 * turn expands to every friendly type currently held by at least one stored
 * lead, each with a count and a deep-link that filters the feed to that type.
 */
@Component({
  selector: 'app-operations-side-nav',
  imports: [RouterLink, RouterLinkActive, SideNavFooter],
  template: `
    <aside>
      <div class="brand">
        @if (logoUrl()) {
          <img class="logo" [src]="logoUrl()" alt="" (error)="logoFailed = true" [hidden]="logoFailed" />
        }
        @if (!logoUrl() || logoFailed) {
          <span class="mark">{{ initials() }}</span>
        }
        <span class="name">{{ brandName() }}</span>
      </div>
      <nav>
        <a routerLink="/operations/dashboard" routerLinkActive="active">
          <span class="icon">▦</span> Dashboard
        </a>

        <!-- Tenders (parent) → tracked list; hosts Lead Gen + type filters. -->
        <div class="nav-group" [class.open]="isGroupOpen('tenders', isTendersGroupActive())">
          <a routerLink="/operations/tenders" [class.active]="isTendersActive()">
            <span class="icon">📄</span> Tenders
            <span class="caret" (click)="toggleCaret('tenders', $event)">›</span>
          </a>
          <div class="children">
            <div class="nav-group" [class.open]="isGroupOpen('leadgen', isLeadsActive())">
              <a routerLink="/operations/leads" [class.active]="isLeadsBareActive()">
                <span class="icon">📡</span> Lead Gen
                @if (typeCounts().length > 0) {
                  <span class="caret" (click)="toggleCaret('leadgen', $event)">›</span>
                }
              </a>
              @if (typeCounts().length > 0) {
                <div class="children">
                  @for (t of typeCounts(); track t.type) {
                    <a [routerLink]="['/operations/leads']"
                       [queryParams]="{ type: t.type, days: 30 }"
                       [class.active]="isTypeActive(t.type)">
                      <span class="icon">◌</span>
                      <span class="label" [title]="typeLabel(t.type)">{{ typeLabel(t.type) }}</span>
                      <span class="count">{{ t.count }}</span>
                    </a>
                  }
                </div>
              }
            </div>
          </div>
        </div>

        <a routerLink="/operations/taskboard" routerLinkActive="active">
          <span class="icon">✓</span> Taskboard
        </a>
        <a routerLink="/operations/contracts" routerLinkActive="active">
          <span class="icon">📜</span> Contracts
        </a>
        <a routerLink="/operations/documents" routerLinkActive="active">
          <span class="icon">📁</span> Documents
        </a>
        <a routerLink="/operations/partners" routerLinkActive="active">
          <span class="icon">🤝</span> Partners
        </a>
        <a routerLink="/operations/contractors" routerLinkActive="active">
          <span class="icon">👷</span> Contractors
        </a>
        <a routerLink="/operations/affiliates" routerLinkActive="active">
          <span class="icon">🎯</span> Affiliates
        </a>
      </nav>
      <app-side-nav-footer />
    </aside>
  `,
  styles: [`
    aside {
      width: 220px;
      background: var(--bg-2);
      border-right: 1px solid var(--line);
      display: flex; flex-direction: column;
      height: 100%;
    }
    .brand {
      display: flex; align-items: center; gap: 10px;
      height: 52px; padding: 0 18px;
      border-bottom: 1px solid var(--line);
    }
    .brand .mark {
      display: inline-flex; align-items: center; justify-content: center;
      width: 30px; height: 30px;
      background: var(--primary); color: #0a0a0a;
      font-weight: 800; font-size: 12px; letter-spacing: 0.5px;
      border-radius: var(--radius-sm);
      flex-shrink: 0;
    }
    .brand .logo { width: 30px; height: 30px; object-fit: contain; border-radius: var(--radius-sm); flex-shrink: 0; }
    .brand .name { font-weight: 700; font-size: 14px; letter-spacing: 0.4px; color: var(--fg); }
    nav {
      flex: 1;
      padding: 12px 10px;
      display: flex; flex-direction: column; gap: 2px;
      overflow-y: auto;
    }
    a {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 12px; border-radius: var(--radius-sm);
      color: var(--fg); font-size: 14px;
      transition: background 0.15s, color 0.15s;
    }
    a:hover { background: var(--bg-3); }
    a.active { background: var(--bg-3); color: var(--primary); }
    .icon { width: 20px; text-align: center; opacity: 0.85; flex-shrink: 0; }
    .label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .caret {
      margin-left: auto; opacity: 0.6;
      padding: 4px 6px; margin-top: -4px; margin-bottom: -4px; margin-right: -6px;
      border-radius: var(--radius-sm); cursor: pointer;
      transition: transform 0.2s;
    }
    .caret:hover { background: var(--bg-3); opacity: 1; }
    .nav-group.open > a > .caret { transform: rotate(90deg); }
    .children {
      display: none;
      flex-direction: column; gap: 2px;
      margin: 4px 0 4px 10px;
      padding-left: 10px;
      border-left: 1px solid var(--line);
    }
    .children a { font-size: 13px; padding: 8px 12px; }
    .children a .count {
      margin-left: auto;
      padding: 1px 6px;
      border-radius: 999px;
      background: var(--bg-3);
      color: var(--muted);
      font-size: 11px;
      font-weight: 600;
      line-height: 1.5;
    }
    .children a.active .count { background: rgba(212, 169, 58, 0.16); color: var(--primary); }
    .nav-group.open > .children { display: flex; }
  `],
})
export class OperationsSideNav {
  private svc = inject(SettingsService);
  private api = inject(Api);
  private router = inject(Router);
  brandName = this.svc.brandName;
  logoUrl = computed(() => this.svc.brandLogoUrl() || `${environment.basePath}/icon.png`);
  initials = this.svc.brandInitials;
  logoFailed = false;

  typeCounts = signal<{ type: string; count: number }[]>([]);
  currentUrl = signal<string>(this.router.url);
  private flippedGroups = signal<Set<string>>(new Set());

  toggleCaret(key: string, ev: Event): void {
    ev.preventDefault();
    ev.stopPropagation();
    const next = new Set(this.flippedGroups());
    if (next.has(key)) next.delete(key); else next.add(key);
    this.flippedGroups.set(next);
  }
  isGroupOpen(key: string, isActive: boolean): boolean {
    return this.flippedGroups().has(key) ? !isActive : isActive;
  }

  isTendersActive = (): boolean => {
    const u = this.currentUrl();
    return u === '/operations/tenders' || u.startsWith('/operations/tenders/') || u.startsWith('/operations/tenders?');
  };
  isLeadsActive = (): boolean => {
    const u = this.currentUrl();
    return u === '/operations/leads' || u.startsWith('/operations/leads/') || u.startsWith('/operations/leads?');
  };
  /** The Tenders group auto-opens on the tenders list OR anywhere under Lead Gen. */
  isTendersGroupActive = (): boolean => this.isTendersActive() || this.isLeadsActive();
  /** Bare Lead Gen highlights on the feed with no type filter applied. */
  isLeadsBareActive = (): boolean => this.isLeadsActive() && this.typeParam() === '';
  isTypeActive = (type: string): boolean => this.isLeadsActive() && this.typeParam() === type;

  private typeParam(): string {
    const u = this.currentUrl();
    const q = u.split('?')[1] ?? '';
    return new URLSearchParams(q).get('type') ?? '';
  }

  private static ACRONYMS: Record<string, string> = { crm: 'CRM', seo: 'SEO', it: 'IT', ecommerce: 'E-commerce' };
  typeLabel(key: string): string {
    return key.split('-')
      .map(w => OperationsSideNav.ACRONYMS[w] ?? (w.charAt(0).toUpperCase() + w.slice(1)))
      .join(' ');
  }

  constructor() {
    this.svc.ensureLoaded();
    this.loadTypeCounts();
    this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(e => {
      this.currentUrl.set((e as NavigationEnd).urlAfterRedirects);
      this.flippedGroups.set(new Set());
      // Refresh counts whenever the user lands on the Lead Gen feed (covers a
      // fresh import changing the stored set).
      if (this.isLeadsActive()) this.loadTypeCounts();
    });
  }

  private loadTypeCounts() {
    this.api.tenderLeadTypeCounts().subscribe({
      next: r => this.typeCounts.set(r.types ?? []),
      error: () => {/* silent — likely not authed yet */},
    });
  }
}
