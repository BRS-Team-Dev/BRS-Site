import { Component, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter } from 'rxjs';
import { Api } from '../core/api';
import { AdminSection, FormDef } from '../core/models';
import { SettingsService } from '../core/settings.service';
import { environment } from '@env/environment';

@Component({
  selector: 'app-side-nav',
  imports: [RouterLink, RouterLinkActive],
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
        <div class="nav-group">
          <a routerLink="/admin/dashboard" [class.active]="isDashboardActive()">
            <span class="icon">▦</span> Dashboard
          </a>
        </div>

        <div class="nav-group">
          <a routerLink="/admin/clients" [class.active]="isClientsActive()">
            <span class="icon">●</span> Clients
            @if (childrenOfBuiltin('clients').length > 0) { <span class="caret">›</span> }
          </a>
          @if (childrenOfBuiltin('clients').length > 0) {
            <div class="children">
              @for (c of childrenOfBuiltin('clients'); track c.id) {
                <a [routerLink]="childLinkPath(c)" [class.active]="isChildLinkActive(c)">
                  <span class="icon">◌</span> {{ c.main_section_label || c.title }}
                </a>
              }
            </div>
          }
        </div>

        <div class="nav-group">
          <a routerLink="/admin/leads" [class.active]="isLeadsActive()">
            <span class="icon">◇</span> Leads
            @if (childrenOfBuiltin('leads').length > 0) { <span class="caret">›</span> }
          </a>
          @if (childrenOfBuiltin('leads').length > 0) {
            <div class="children">
              @for (c of childrenOfBuiltin('leads'); track c.id) {
                <a [routerLink]="childLinkPath(c)" [class.active]="isChildLinkActive(c)">
                  <span class="icon">◌</span> {{ c.main_section_label || c.title }}
                </a>
              }
            </div>
          }
        </div>

        <div class="nav-group">
          <a routerLink="/admin/leadgen" [class.active]="isLeadgenActive()">
            <span class="icon">⇪</span> Lead Gen
            <span class="caret">›</span>
          </a>
          <div class="children">
            <a routerLink="/admin/leadgen/settings" [class.active]="isLeadgenSettingsActive()">
              <span class="icon">⚙</span> Settings
            </a>
            @for (c of childrenOfBuiltin('leadgen'); track c.id) {
              <a [routerLink]="childLinkPath(c)" [class.active]="isChildLinkActive(c)">
                <span class="icon">◌</span> {{ c.main_section_label || c.title }}
              </a>
            }
          </div>
        </div>

        <div class="nav-group">
          <a routerLink="/admin/newsletter" [class.active]="isNewsletterActive()">
            <span class="icon">✉</span> Newsletter
            @if (childrenOfBuiltin('newsletter').length > 0) { <span class="caret">›</span> }
          </a>
          @if (childrenOfBuiltin('newsletter').length > 0) {
            <div class="children">
              @for (c of childrenOfBuiltin('newsletter'); track c.id) {
                <a [routerLink]="childLinkPath(c)" [class.active]="isChildLinkActive(c)">
                  <span class="icon">◌</span> {{ c.main_section_label || c.title }}
                </a>
              }
            </div>
          }
        </div>

        <div class="nav-group">
          <a routerLink="/admin/services" [class.active]="isServicesActive()">
            <span class="icon">⚒</span> Services
            @if (childrenOfBuiltin('services').length > 0) { <span class="caret">›</span> }
          </a>
          @if (childrenOfBuiltin('services').length > 0) {
            <div class="children">
              @for (c of childrenOfBuiltin('services'); track c.id) {
                <a [routerLink]="childLinkPath(c)" [class.active]="isChildLinkActive(c)">
                  <span class="icon">◌</span> {{ c.main_section_label || c.title }}
                </a>
              }
            </div>
          }
        </div>

        <div class="nav-group">
          <a routerLink="/admin/forms" routerLinkActive="active">
            <span class="icon">▤</span> Forms
            <span class="caret">›</span>
          </a>
          <div class="children">
            <a routerLink="/admin/submissions" routerLinkActive="active">
              <span class="icon">☰</span> Submissions
            </a>
            <a routerLink="/admin/settings" routerLinkActive="active">
              <span class="icon">⚙</span> Settings
            </a>
            @for (m of childrenOfBuiltin('forms'); track m.id) {
              <a [routerLink]="childLinkPath(m)" [class.active]="isChildLinkActive(m)">
                <span class="icon">◌</span> {{ m.main_section_label || m.title }}
              </a>
            }
          </div>
        </div>
        <div class="nav-group">
          <a routerLink="/admin/onboarding" [class.active]="isOnboardingActive()">
            <span class="icon">◈</span> Onboarding
            @if (onboardingForms().length > 0) { <span class="caret">›</span> }
          </a>
          @if (onboardingForms().length > 0 || childrenOfBuiltin('onboarding').length > 0) {
            <div class="children">
              @for (f of onboardingForms(); track f.id) {
                <a [routerLink]="['/admin/onboarding', f.id, 'clients']" [class.active]="isOnboardingFormActive(f.id!)">
                  <span class="icon">◌</span> {{ f.title }}
                </a>
              }
              @for (m of childrenOfBuiltin('onboarding'); track m.id) {
                <a [routerLink]="childLinkPath(m)" [class.active]="isChildLinkActive(m)">
                  <span class="icon">◆</span> {{ m.main_section_label || m.title }}
                </a>
              }
            </div>
          }
        </div>

        @for (m of topMainSections(); track m.id) {
          <div class="nav-group">
            <a [routerLink]="['/admin/main', m.id]" [class.active]="isMainSectionActive(m.id!)">
              <span class="icon">◆</span> {{ m.main_section_label || m.title }}
              @if (childrenOf(m.id!).length > 0) { <span class="caret">›</span> }
            </a>
            @if (childrenOf(m.id!).length > 0) {
              <div class="children">
                @for (c of childrenOf(m.id!); track c.id) {
                  <a [routerLink]="childLinkPath(c)" [class.active]="isChildLinkActive(c)">
                    <span class="icon">◌</span> {{ c.main_section_label || c.title }}
                  </a>
                }
              </div>
            }
          </div>
        }
      </nav>
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
    .brand .logo {
      width: 30px; height: 30px;
      object-fit: contain;
      border-radius: var(--radius-sm);
      flex-shrink: 0;
    }
    .brand .name {
      font-weight: 700; font-size: 14px; letter-spacing: 0.4px;
      color: var(--fg);
    }
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
    .icon { width: 20px; text-align: center; opacity: 0.85; }
    .caret {
      margin-left: auto; opacity: 0.6;
      transition: transform 0.2s;
    }
    .nav-group:has(.active) > a > .caret,
    .nav-group:hover > a > .caret { transform: rotate(90deg); }

    .children {
      display: none;
      flex-direction: column; gap: 2px;
      margin: 4px 0 4px 10px;
      padding-left: 10px;
      border-left: 1px solid var(--line);
    }
    .children a { font-size: 13px; padding: 8px 12px; }

    .nav-group:has(.active) > .children,
    .nav-group:hover > .children { display: flex; }
  `],
})
export class SideNav {
  private svc = inject(SettingsService);
  private api = inject(Api);
  private router = inject(Router);
  brandName = this.svc.brandName;
  // Fall back to the bundled BRS icon when no brand logo is configured.
  logoUrl = computed(() => this.svc.brandLogoUrl() || `${environment.basePath}/icon.png`);
  initials = this.svc.brandInitials;
  logoFailed = false;
  onboardingForms = signal<FormDef[]>([]);
  standardForms = signal<FormDef[]>([]);
  adminSections = signal<AdminSection[]>([]);
  currentUrl = signal<string>(this.router.url);
  topAdminSections = computed(() =>
    this.adminSections().filter(s => (s.sidenav_placement ?? 'top') === 'top')
  );
  isAdminSectionActive = (s: AdminSection): boolean => {
    const url = this.currentUrl();
    return url === `/admin/section/${s.id}` || url.startsWith(`/admin/section/${s.id}/`);
  };
  isDashboardActive = (): boolean => {
    const url = this.currentUrl();
    return url === '/admin/dashboard' || url.startsWith('/admin/dashboard/') || url.startsWith('/admin/dashboard?');
  };
  isClientsActive = (): boolean => {
    const url = this.currentUrl();
    return url === '/admin/clients' || url.startsWith('/admin/clients/') || url.startsWith('/admin/clients?');
  };
  isLeadsActive = (): boolean => {
    const url = this.currentUrl();
    return url === '/admin/leads' || url.startsWith('/admin/leads/') || url.startsWith('/admin/leads?');
  };
  isLeadgenActive = (): boolean => {
    const url = this.currentUrl();
    // Parent only highlights on the index page; child pages light their own row.
    return url === '/admin/leadgen' || url.startsWith('/admin/leadgen?');
  };
  isLeadgenSettingsActive = (): boolean => {
    const url = this.currentUrl();
    return url === '/admin/leadgen/settings' || url.startsWith('/admin/leadgen/settings/') || url.startsWith('/admin/leadgen/settings?');
  };
  isNewsletterActive = (): boolean => {
    const url = this.currentUrl();
    return url === '/admin/newsletter' || url.startsWith('/admin/newsletter/') || url.startsWith('/admin/newsletter?');
  };
  isServicesActive = (): boolean => {
    const url = this.currentUrl();
    return url === '/admin/services' || url.startsWith('/admin/services/') || url.startsWith('/admin/services?');
  };
  topMainSections = computed(() =>
    this.onboardingForms().filter(f => (f.sidenav_placement ?? 'top') === 'top')
  );
  /** Forms flagged to render as their own standalone top-level sidenav entry. */
  independentSections = computed(() =>
    [...this.onboardingForms(), ...this.standardForms()].filter(f => !!f.show_in_sidenav_root)
  );
  /** Forms (any type) with placement='child' nested under another form (parent_key === parent's id). */
  childrenOf = (parentId: number) =>
    [...this.onboardingForms(), ...this.standardForms()]
      .filter(f => f.sidenav_placement === 'child' && f.sidenav_parent_key === String(parentId));
  /** Forms (any type) with placement='child' nested under a built-in
   *  sidenav parent. The accepted keys are listed in
   *  `SIDENAV_BUILTIN_PARENTS` (`core/sidenav-config.ts`). */
  childrenOfBuiltin = (key: string) =>
    [...this.onboardingForms(), ...this.standardForms()]
      .filter(f => f.sidenav_placement === 'child' && f.sidenav_parent_key === key);
  isStandardForm = (f: FormDef) => f.form_type !== 'onboarding';
  /** Where in the admin UI a sidenav child link should point. */
  childLinkPath = (f: FormDef): any[] =>
    this.isStandardForm(f)
      ? ['/admin/forms', f.id, 'submissions']
      : ['/admin/main', f.id];
  isChildLinkActive = (f: FormDef): boolean =>
    this.isStandardForm(f)
      ? (this.currentUrl().startsWith(`/admin/forms/${f.id}/submissions`) || this.currentUrl().startsWith(`/admin/forms/${f.id}/submission/`))
      : this.isMainSectionActive(f.id!);

  isOnboardingActive = computed(() => {
    const url = this.currentUrl();
    // Active only on templates-management URLs — never on a specific form's
    // clients/client pages, since those highlight the form's own child entry.
    if (url === '/admin/onboarding' || url.startsWith('/admin/onboarding?')) return true;
    if (url === '/admin/onboarding/new') return true;
    if (/^\/admin\/onboarding\/\d+\/edit($|[/?])/.test(url)) return true;
    if (url === '/admin/onboarding/clients' || url.startsWith('/admin/onboarding/clients/')) return true;
    return false;
  });
  isOnboardingFormActive = (formId: number): boolean => {
    const url = this.currentUrl();
    return url === `/admin/onboarding/${formId}/clients`
        || url.startsWith(`/admin/onboarding/${formId}/clients/`)
        || url.startsWith(`/admin/onboarding/${formId}/client/`);
  };
  isMainSectionActive = (formId: number): boolean => {
    const url = this.currentUrl();
    return url === `/admin/main/${formId}`
        || url.startsWith(`/admin/main/${formId}/`)
        || url.startsWith(`/admin/main/${formId}?`);
  };

  constructor() {
    this.svc.ensureLoaded();
    this.loadOnboardingForms();
    this.loadStandardForms();
    this.loadSections();
    this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(e => {
      const url = (e as NavigationEnd).urlAfterRedirects;
      this.currentUrl.set(url);
      // Refresh sidenav children only when landing on the bare list root —
      // i.e. the page a user arrives at after creating / deleting an entry.
      // The previous `startsWith` checks fired on every navigation within
      // the area (e.g. visiting `/admin/forms/123/edit` re-listed all forms),
      // which produced 3 redundant requests on every sidenav click.
      if (url === '/admin/onboarding' || url.startsWith('/admin/onboarding?')) this.loadOnboardingForms();
      if (url === '/admin/forms'      || url.startsWith('/admin/forms?'))      this.loadStandardForms();
      if (url === '/admin/sections'   || url.startsWith('/admin/sections?'))   this.loadSections();
    });
  }

  private loadOnboardingForms() {
    this.api.listOnboardingForms().subscribe({
      next: r => this.onboardingForms.set(r.forms),
      error: () => {/* silent — likely not authed yet */},
    });
  }
  private loadStandardForms() {
    this.api.listForms().subscribe({
      next: r => this.standardForms.set(r.forms),
      error: () => {/* silent */},
    });
  }
  private loadSections() {
    this.api.listSections().subscribe({
      next: r => this.adminSections.set(r.sections),
      error: () => {/* silent */},
    });
  }
}
