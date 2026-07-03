import { Component, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter } from 'rxjs';
import { Api } from '../core/api';
import { AdminSection, FormDef, LeadIndustrySummary, ServiceOffering } from '../core/models';
import { SettingsService } from '../core/settings.service';
import { SideNavFooter } from './side-nav-footer';
import { environment } from '@env/environment';

@Component({
  selector: 'app-side-nav',
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
        <div class="nav-group">
          <a routerLink="/admin/dashboard" [class.active]="isDashboardActive()">
            <span class="icon">▦</span> Dashboard
          </a>
        </div>

        <div class="nav-group">
          <a routerLink="/admin/taskboard" routerLinkActive="active">
            <span class="icon">✓</span> Task Board
          </a>
        </div>

        <div class="nav-group" [class.open]="isGroupOpen('clients', isClientsActive())">
          <a routerLink="/admin/clients" [class.active]="isClientsActive()">
            <span class="icon">●</span> Clients
            @if (childrenOfBuiltin('clients').length > 0) {
              <span class="caret" (click)="toggleCaret('clients', $event)">›</span>
            }
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

        <!-- Leads — restructured to host all lead-related entries as
             children: a Categories sub-group for industry filters, the
             Lead Gen page, and the Import Leads page. Lead Gen used to
             sit at the top level; it's now nested under Leads so the
             funnel reads coherently in one block. Auto-opens for any
             child route (leads, leadgen, leads/import) via
             isLeadsGroupActive. -->
        <div class="nav-group" [class.open]="isGroupOpen('leads', isLeadsGroupActive())">
          <a routerLink="/admin/leads" [class.active]="isLeadsActive()">
            <span class="icon">◇</span> Leads
            <span class="caret" (click)="toggleCaret('leads', $event)">›</span>
          </a>
          <div class="children">
            <!-- Categories — second-level dropdown that lists every
                 industry currently held by at least one lead. Each
                 industry deep-links the leads list to that industry
                 filter. The parent row toggles open/closed via the
                 caret; clicking the label does nothing on its own. -->
            <div class="nav-group" [class.open]="isGroupOpen('lead-categories', isLeadIndustryAnyActive())">
              <a class="non-routing" (click)="toggleCaret('lead-categories', $event)">
                <span class="icon">▦</span> Categories
                @if (leadIndustries().length > 0) {
                  <span class="caret">›</span>
                }
              </a>
              @if (leadIndustries().length > 0) {
                <div class="children">
                  @for (ind of leadIndustries(); track ind.name) {
                    <a [routerLink]="['/admin/leads']"
                       [queryParams]="{ industry: ind.name }"
                       queryParamsHandling="merge"
                       [class.active]="isLeadIndustryActive(ind.name)">
                      <span class="icon">◌</span>
                      <span class="label" [title]="ind.name">{{ ind.name }}</span>
                      <span class="count">{{ ind.lead_count }}</span>
                    </a>
                  }
                </div>
              }
            </div>

            <!-- Lead Gen — AI-driven prospect generation. Moved here
                 from a sibling top-level entry. Plain routerLinkActive
                 — exact match so /admin/leads/import (which mounts
                 the same component) doesn't light Lead Gen too. -->
            <a routerLink="/admin/leadgen"
               routerLinkActive="active"
               [routerLinkActiveOptions]="{ exact: true }">
              <span class="icon">⇪</span> Lead Gen
            </a>

            <!-- Import Leads — separate route, separate URL. Same
                 component as Lead Gen but routed in 'import' mode. -->
            <a routerLink="/admin/leads/import" routerLinkActive="active">
              <span class="icon">⤓</span> Import Leads
            </a>

            <!-- Any user-defined main sections still pinned under Leads. -->
            @for (c of childrenOfBuiltin('leads'); track c.id) {
              <a [routerLink]="childLinkPath(c)" [class.active]="isChildLinkActive(c)">
                <span class="icon">◌</span>
                <span class="label" [title]="c.main_section_label || c.title">{{ c.main_section_label || c.title }}</span>
              </a>
            }
            @for (c of childrenOfBuiltin('leadgen'); track c.id) {
              <a [routerLink]="childLinkPath(c)" [class.active]="isChildLinkActive(c)">
                <span class="icon">◌</span>
                <span class="label" [title]="c.main_section_label || c.title">{{ c.main_section_label || c.title }}</span>
              </a>
            }
          </div>
        </div>

        <div class="nav-group" [class.open]="isGroupOpen('services', isServicesActive())">
          <a routerLink="/admin/services" [class.active]="isServicesActive()">
            <span class="icon">⚒</span> Services
            @if (serviceOfferings().length > 0 || childrenOfBuiltin('services').length > 0) {
              <span class="caret" (click)="toggleCaret('services', $event)">›</span>
            }
          </a>
          @if (serviceOfferings().length > 0 || childrenOfBuiltin('services').length > 0) {
            <div class="children">
              @for (s of serviceOfferings(); track s.id) {
                <a [routerLink]="['/admin/services']" [queryParams]="{ service: s.id }"
                   [class.active]="isServiceOfferingActive(s.id!)">
                  <span class="icon">◌</span>
                  <span class="label" [title]="s.name">{{ s.name }}</span>
                </a>
              }
              @for (c of childrenOfBuiltin('services'); track c.id) {
                <a [routerLink]="childLinkPath(c)" [class.active]="isChildLinkActive(c)">
                  <span class="icon">◌</span>
                  <span class="label" [title]="c.main_section_label || c.title">{{ c.main_section_label || c.title }}</span>
                </a>
              }
            </div>
          }
        </div>

        <!-- Onboarding — parent routes to a dedicated hub page showing
             both surfaces (Standard forms + Multipart forms). Children
             open the two dedicated admin pages. -->
        <div class="nav-group" [class.open]="isGroupOpen('onboarding', isOnboardingHubActive() || isOnboardingActive() || isFormsActive())">
          <a routerLink="/admin/onboarding" [class.active]="isOnboardingHubActive()">
            <span class="icon">◈</span> Onboarding
            <span class="caret" (click)="toggleCaret('onboarding', $event)">›</span>
          </a>
          <div class="children">
            <!-- Forms sub-group -->
            <div class="nav-group" [class.open]="isGroupOpen('onb-forms', isFormsActive())">
              <a routerLink="/admin/forms" [class.active]="isFormsListActive()">
                <span class="icon">▤</span> Forms
                <span class="caret" (click)="toggleCaret('onb-forms', $event)">›</span>
              </a>
              <div class="children">
                <a routerLink="/admin/submissions" [class.active]="isSubmissionsActive()">
                  <span class="icon">☰</span> Submissions
                </a>
                @for (f of standardForms(); track f.id) {
                  <a [routerLink]="['/admin/forms', f.id, 'submissions']" [class.active]="isStandardFormActive(f.id!)">
                    <span class="icon">◌</span>
                    <span class="label" [title]="f.title">{{ f.title }}</span>
                  </a>
                }
                @for (m of childrenOfBuiltin('forms'); track m.id) {
                  <a [routerLink]="childLinkPath(m)" [class.active]="isChildLinkActive(m)">
                    <span class="icon">◌</span>
                    <span class="label" [title]="m.main_section_label || m.title">{{ m.main_section_label || m.title }}</span>
                  </a>
                }
              </div>
            </div>

            <!-- Multipart forms sub-group — /admin/onboarding/multipart
                 is the dedicated multipart list page (separate from
                 /admin/forms which is the standard-forms list). -->
            <div class="nav-group" [class.open]="isGroupOpen('onb-multi', isOnboardingActive())">
              <a routerLink="/admin/onboarding/multipart" [class.active]="isOnboardingActive()">
                <span class="icon">◈</span> Multipart forms
                @if (onboardingForms().length > 0 || childrenOfBuiltin('onboarding').length > 0) {
                  <span class="caret" (click)="toggleCaret('onb-multi', $event)">›</span>
                }
              </a>
              @if (onboardingForms().length > 0 || childrenOfBuiltin('onboarding').length > 0) {
                <div class="children">
                  @for (f of onboardingForms(); track f.id) {
                    <a [routerLink]="['/admin/onboarding', f.id, 'clients']" [class.active]="isOnboardingFormActive(f.id!)">
                      <span class="icon">◌</span>
                      <span class="label" [title]="f.title">{{ f.title }}</span>
                    </a>
                  }
                  @for (m of childrenOfBuiltin('onboarding'); track m.id) {
                    <a [routerLink]="childLinkPath(m)" [class.active]="isChildLinkActive(m)">
                      <span class="icon">◆</span>
                      <span class="label" [title]="m.main_section_label || m.title">{{ m.main_section_label || m.title }}</span>
                    </a>
                  }
                </div>
              }
            </div>
          </div>
        </div>

        <div class="nav-group" [class.open]="isGroupOpen('newsletter', isNewsletterActive())">
          <a routerLink="/admin/newsletter" [class.active]="isNewsletterActive()">
            <span class="icon">✉</span> Newsletter
            @if (childrenOfBuiltin('newsletter').length > 0) {
              <span class="caret" (click)="toggleCaret('newsletter', $event)">›</span>
            }
          </a>
          @if (childrenOfBuiltin('newsletter').length > 0) {
            <div class="children">
              @for (c of childrenOfBuiltin('newsletter'); track c.id) {
                <a [routerLink]="childLinkPath(c)" [class.active]="isChildLinkActive(c)">
                  <span class="icon">◌</span>
                  <span class="label" [title]="c.main_section_label || c.title">{{ c.main_section_label || c.title }}</span>
                </a>
              }
            </div>
          }
        </div>

        <div class="nav-group">
          <a routerLink="/admin/feedback" [class.active]="isFeedbackActive()">
            <span class="icon">★</span> Feedback
          </a>
        </div>

        @for (m of topMainSections(); track m.id) {
          <div class="nav-group" [class.open]="isGroupOpen('main:' + m.id, isMainSectionActive(m.id!))">
            <a [routerLink]="['/admin/main', m.id]" [class.active]="isMainSectionActive(m.id!)">
              <span class="icon">◆</span>
              <span class="label" [title]="m.main_section_label || m.title">{{ m.main_section_label || m.title }}</span>
              @if (childrenOf(m.id!).length > 0) {
                <span class="caret" (click)="toggleCaret('main:' + m.id, $event)">›</span>
              }
            </a>
            @if (childrenOf(m.id!).length > 0) {
              <div class="children">
                @for (c of childrenOf(m.id!); track c.id) {
                  <a [routerLink]="childLinkPath(c)" [class.active]="isChildLinkActive(c)">
                    <span class="icon">◌</span>
                    <span class="label" [title]="c.main_section_label || c.title">{{ c.main_section_label || c.title }}</span>
                  </a>
                }
              </div>
            }
          </div>
        }
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
    /* Anchors with no routerLink (e.g. the Categories group label —
       a pure container that only toggles open/closed) still need to
       read as interactive. */
    a.non-routing { cursor: pointer; }
    .icon { width: 20px; text-align: center; opacity: 0.85; flex-shrink: 0; }
    /* Label span truncates when the text overflows the row width.
       flex: 1 lets it eat leftover space so ellipsis kicks in; min-width: 0
       is required because a flex child's default min-content width would
       otherwise refuse to shrink below the intrinsic text width. Native
       [title] attr on the span provides the hover tooltip. */
    .label {
      flex: 1; min-width: 0;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    /* Caret stays pushed to the right of the row via margin-left: auto
       (the parent <a> is display: flex). The padding gives it a real
       click-target without bumping the row taller — the negative
       vertical margin cancels the padding's height contribution. */
    .caret {
      margin-left: auto; opacity: 0.6;
      padding: 4px 6px; margin-top: -4px; margin-bottom: -4px; margin-right: -6px;
      border-radius: var(--radius-sm); cursor: pointer;
      transition: transform 0.2s;
    }
    .caret:hover { background: var(--bg-3); opacity: 1; }
    /* Open state is fully driven by [class.open] in the template
       (which combines route-activity + the user's chevron overrides). */
    .nav-group.open > a > .caret { transform: rotate(90deg); }

    .children {
      display: none;
      flex-direction: column; gap: 2px;
      margin: 4px 0 4px 10px;
      padding-left: 10px;
      border-left: 1px solid var(--line);
    }
    .children a { font-size: 13px; padding: 8px 12px; }
    /* Compact count chip on sub-items that aggregate rows (e.g. each
       Leads → industry shows how many leads fall under it). */
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
export class SideNav {
  private svc = inject(SettingsService);
  private api = inject(Api);
  private router = inject(Router);
  brandName = this.svc.brandName;
  // Fall back to the bundled BRS icon when no brand logo is configured.
  logoUrl = computed(() => this.svc.brandLogoUrl() || `${environment.basePath}/icon.png`);
  initials = this.svc.brandInitials;
  logoFailed = false;

  /** Nav-group keys whose open state the user has manually FLIPPED
   *  away from the default (active = open, inactive = closed).
   *  Cleared on every navigation so a fresh route reverts every group
   *  to "open iff its route is active". Keys: 'clients','leads',
   *  'leadgen','newsletter','services','forms','onboarding','main:<id>'. */
  private flippedGroups = signal<Set<string>>(new Set());

  /** Click handler bound to the chevron span. Toggles the open state
   *  WITHOUT navigating (preventDefault + stopPropagation kills the
   *  parent anchor's routerLink). */
  toggleCaret(key: string, ev: Event): void {
    ev.preventDefault();
    ev.stopPropagation();
    const next = new Set(this.flippedGroups());
    if (next.has(key)) next.delete(key); else next.add(key);
    this.flippedGroups.set(next);
  }

  /** A group is open by default when its route is active. The user can
   *  flip that default via a chevron click — `flippedGroups` is the
   *  set of "user disagrees with default" overrides. */
  isGroupOpen(key: string, isActive: boolean): boolean {
    return this.flippedGroups().has(key) ? !isActive : isActive;
  }
  onboardingForms = signal<FormDef[]>([]);
  standardForms = signal<FormDef[]>([]);
  serviceOfferings = signal<ServiceOffering[]>([]);
  adminSections = signal<AdminSection[]>([]);
  /** Distinct industry values currently held by at least one lead.
   *  Populated from /api/leads/industries; each becomes a sub-menu
   *  entry under the Leads group that deep-links to
   *  /admin/leads?industry=<name>. */
  leadIndustries = signal<LeadIndustrySummary[]>([]);
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
  /** Broader check used for the Leads group's auto-open hint:
   *  matches every child route (Categories filter, Lead Gen, Import
   *  Leads). Without this, navigating from /admin/leads → /admin/leadgen
   *  would collapse the parent and hide Lead Gen + Import Leads. */
  isLeadsGroupActive = (): boolean => {
    const url = this.currentUrl();
    return this.isLeadsActive() || url.startsWith('/admin/leadgen');
  };
  /** An industry sub-link is active when the current URL is the leads
   *  list AND its `industry` query param matches this entry. Encoded
   *  match so names with spaces ("Care Homes") survive the round trip. */
  isLeadIndustryActive = (name: string): boolean => {
    const url = this.currentUrl();
    if (!url.startsWith('/admin/leads')) return false;
    const q = url.split('?')[1] ?? '';
    const params = new URLSearchParams(q);
    return (params.get('industry') ?? '') === name;
  };
  /** True when ANY industry filter is in the URL — used to auto-open
   *  the Categories sub-group whenever the user is filtered by one. */
  isLeadIndustryAnyActive = (): boolean => {
    const url = this.currentUrl();
    if (!url.startsWith('/admin/leads')) return false;
    const q = url.split('?')[1] ?? '';
    return new URLSearchParams(q).has('industry');
  };
  isFormsActive = (): boolean => {
    const url = this.currentUrl();
    // "Forms" sub-group lights on any standard-form admin URL, INCLUDING
    // the global Submissions page (which lives under Forms in the sidenav
    // even though its URL is /admin/submissions*). Any form-specific
    // sub-page (`/admin/forms/:id/edit|submissions|submission/...`) is
    // caught by the `/admin/forms/` prefix.
    if (url === '/admin/forms' || url.startsWith('/admin/forms/') || url.startsWith('/admin/forms?')) return true;
    if (url === '/admin/submissions' || url.startsWith('/admin/submissions/') || url.startsWith('/admin/submissions?')) return true;
    return false;
  };
  /** True only on the Onboarding hub itself so the parent link doesn't
   *  falsely light up when the user is drilled into a child page. */
  isOnboardingHubActive = (): boolean => {
    const url = this.currentUrl();
    return url === '/admin/onboarding' || url.startsWith('/admin/onboarding?');
  };
  /** "Forms" child anchor — highlights on the bare list URL only.
   *  Specific form rows own their own highlight via `isStandardFormActive`
   *  so the parent doesn't compete with them. */
  isFormsListActive = (): boolean => {
    const url = this.currentUrl();
    return url === '/admin/forms' || url.startsWith('/admin/forms?');
  };
  /** "Submissions" child anchor — global cross-form submissions viewer. */
  isSubmissionsActive = (): boolean => {
    const url = this.currentUrl();
    return url === '/admin/submissions'
        || url.startsWith('/admin/submissions/')
        || url.startsWith('/admin/submissions?');
  };
  /** Highlights a specific standard-form row in the sidenav whenever
   *  the user is on ANY sub-page for that form (edit / submissions /
   *  a single submission), not just the exact submissions URL. */
  isStandardFormActive = (id: number): boolean => {
    const url = this.currentUrl();
    return new RegExp(`^/admin/forms/${id}(/|\\?|$)`).test(url);
  };
  isLeadgenActive = (): boolean => {
    const url = this.currentUrl();
    // Parent only highlights on the index page; child pages light their own row.
    return url === '/admin/leadgen' || url.startsWith('/admin/leadgen?');
  };
  isNewsletterActive = (): boolean => {
    const url = this.currentUrl();
    return url === '/admin/newsletter' || url.startsWith('/admin/newsletter/') || url.startsWith('/admin/newsletter?');
  };
  isFeedbackActive = (): boolean => {
    const url = this.currentUrl();
    return url === '/admin/feedback' || url.startsWith('/admin/feedback/') || url.startsWith('/admin/feedback?');
  };
  isServicesActive = (): boolean => {
    const url = this.currentUrl();
    return url === '/admin/services' || url.startsWith('/admin/services/') || url.startsWith('/admin/services?');
  };
  /** A specific catalogue service is "active" when its edit modal is deep-linked
   *  open via `/admin/services?service=<id>`. */
  isServiceOfferingActive = (id: number): boolean =>
    new RegExp(`[?&]service=${id}(?:&|$)`).test(this.currentUrl());
  /** All forms (standard + multipart) now live exclusively under the
   *  Onboarding parent — the old sidenav_placement / sidenav_parent_key /
   *  show_in_sidenav_root fields no longer influence the tree. These
   *  helpers return empty so no form leaks to top-level or under
   *  clients / services / leads / newsletter. */
  topMainSections = computed<FormDef[]>(() => []);
  independentSections = computed<FormDef[]>(() => []);
  childrenOf = (_parentId: number): FormDef[] => [];
  childrenOfBuiltin = (_key: string): FormDef[] => [];
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
    // "Multipart forms" child row lights on any multipart-admin URL,
    // but NOT the bare Onboarding hub (that's `isOnboardingHubActive`
    // — parent-row only). Includes any form-specific sub-page
    // (`/admin/onboarding/:id/edit|clients|client/...`) so the
    // sub-group's [class.open] fires and the individual form row
    // becomes visible + highlighted.
    if (url === '/admin/onboarding/multipart' || url.startsWith('/admin/onboarding/multipart?')) return true;
    if (url === '/admin/onboarding/new') return true;
    if (url === '/admin/onboarding/clients' || url.startsWith('/admin/onboarding/clients/')) return true;
    if (/^\/admin\/onboarding\/\d+(\/|$|\?)/.test(url)) return true;
    return false;
  });
  /** Highlights a specific multipart-form row whenever the user is on
   *  ANY sub-page for that form (edit / clients list / a single
   *  client). Previously missed /edit. */
  isOnboardingFormActive = (formId: number): boolean => {
    const url = this.currentUrl();
    return new RegExp(`^/admin/onboarding/${formId}(/|\\?|$)`).test(url);
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
    this.loadServiceOfferings();
    this.loadSections();
    this.loadLeadIndustries();
    this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(e => {
      const url = (e as NavigationEnd).urlAfterRedirects;
      this.currentUrl.set(url);
      // Reset chevron overrides on every navigation so the new active
      // group opens cleanly and previously-flipped groups revert to
      // their default (open iff active = false → closed).
      this.flippedGroups.set(new Set());
      // Refresh sidenav children only when landing on the bare list root —
      // i.e. the page a user arrives at after creating / deleting an entry.
      // The previous `startsWith` checks fired on every navigation within
      // the area (e.g. visiting `/admin/forms/123/edit` re-listed all forms),
      // which produced 3 redundant requests on every sidenav click.
      if (url === '/admin/onboarding' || url.startsWith('/admin/onboarding?')) this.loadOnboardingForms();
      if (url === '/admin/forms'      || url.startsWith('/admin/forms?'))      this.loadStandardForms();
      if (url === '/admin/services'   || url.startsWith('/admin/services?'))   this.loadServiceOfferings();
      if (url === '/admin/sections'   || url.startsWith('/admin/sections?'))   this.loadSections();
      // Refresh the industry list whenever the user lands on the leads
      // root — covers add / delete / bulk-import / industry-edit cases
      // that would change the distinct set of values.
      if (url === '/admin/leads'      || url.startsWith('/admin/leads?'))      this.loadLeadIndustries();
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
  private loadServiceOfferings() {
    this.api.listServiceOfferings().subscribe({
      next: r => this.serviceOfferings.set(r.services),
      error: () => {/* silent — likely not authed yet */},
    });
  }
  private loadSections() {
    this.api.listSections().subscribe({
      next: r => this.adminSections.set(r.sections),
      error: () => {/* silent */},
    });
  }
  private loadLeadIndustries() {
    this.api.listLeadIndustries().subscribe({
      next: r => this.leadIndustries.set(r.industries),
      error: () => {/* silent — likely not authed yet */},
    });
  }
}
