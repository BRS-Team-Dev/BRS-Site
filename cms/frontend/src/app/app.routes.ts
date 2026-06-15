import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';
import { Login } from './features/auth/login';
import { Shell } from './layout/shell';

/*
 * Lazy-loading note. Every feature route below uses `loadComponent` so the
 * matching component (and its imports — including any models/api methods it
 * touches) ships in its own chunk rather than the initial bundle. The only
 * eagerly imported components in this file are `Login` (bootstrap entry) and
 * `Shell` (wraps every authenticated route — it has to be in the initial
 * bundle so the auth shell paints immediately after login).
 *
 * Repeating the same `import()` expression across multiple routes (e.g.
 * `HrMe` for /me/*, `LeadsAdmin` for the four /admin/leads/* paths) is fine —
 * Angular dedupes the chunk, so each component still ends up in a single
 * file shared by all its routes.
 */

export const routes: Routes = [
  { path: 'login', component: Login },
  { path: 'forgot-password', loadComponent: () => import('./features/auth/forgot-password').then(m => m.ForgotPassword) },
  { path: 'reset-password',  loadComponent: () => import('./features/auth/reset-password').then(m => m.ResetPassword) },
  // Public form (iframe-safe; no shell, no auth)
  { path: 'forms/:slug',                loadComponent: () => import('./features/public-form/public-form').then(m => m.PublicForm) },
  // Public onboarding portal (token in URL; no shell, no auth)
  { path: 'onboarding/:formId/:token',  loadComponent: () => import('./features/onboarding/onboarding-portal').then(m => m.OnboardingPortal) },
  // Public HR onboarding portal for new hires (token in URL; no shell, no auth)
  { path: 'hr-onboarding/:token',       loadComponent: () => import('./features/hr/hr-onboarding-portal').then(m => m.HrOnboardingPortal) },
  // Public Recruitment onboarding portal for candidates (token in URL; no shell, no auth)
  { path: 'recruitment-onboarding/:token', loadComponent: () => import('./features/recruitment/recruitment-onboarding-portal').then(m => m.RecruitmentOnboardingPortal) },
  { path: 'surveys/:token',             loadComponent: () => import('./features/public/public-survey').then(m => m.PublicSurvey) },
  // Public job board — anonymous, no shell, no auth.
  { path: 'jobs',                       loadComponent: () => import('./features/public/public-jobs').then(m => m.PublicJobs) },
  { path: 'jobs/:slug',                 loadComponent: () => import('./features/public/public-job').then(m => m.PublicJob) },
  // Public legal pages — anonymous, no shell, no auth. Backend only serves
  // is_published=1 docs at /api/public/legal[/:slug]; drafts return 404.
  { path: 'legal',                      loadComponent: () => import('./features/public/public-legal-index').then(m => m.PublicLegalIndex) },
  { path: 'legal/:slug',                loadComponent: () => import('./features/public/public-legal').then(m => m.PublicLegal) },

  // Admin shell behind auth
  {
    path: '',
    component: Shell,
    canActivate: [authGuard],
    children: [
      { path: '', redirectTo: 'admin/clients', pathMatch: 'full' },
      { path: 'admin', redirectTo: 'admin/clients', pathMatch: 'full' },

      // ────────── CMS ──────────
      { path: 'admin/dashboard',                 loadComponent: () => import('./features/dashboard/crm-dashboard').then(m => m.CrmDashboard) },
      { path: 'admin/forms',                     loadComponent: () => import('./features/forms/forms-list').then(m => m.FormsList) },
      { path: 'admin/forms/new',                 loadComponent: () => import('./features/forms/form-builder').then(m => m.FormBuilder) },
      { path: 'admin/forms/:id/edit',            loadComponent: () => import('./features/forms/form-builder').then(m => m.FormBuilder) },
      { path: 'admin/forms/:id/submissions',     loadComponent: () => import('./features/submissions/submissions-list').then(m => m.SubmissionsList) },
      { path: 'admin/submissions',               loadComponent: () => import('./features/submissions/submissions-list').then(m => m.SubmissionsList) },
      { path: 'admin/submissions/:id',           loadComponent: () => import('./features/submissions/submissions-list').then(m => m.SubmissionsList) },
      { path: 'admin/settings',                  loadComponent: () => import('./features/settings/settings').then(m => m.Settings) },

      { path: 'admin/onboarding',                  loadComponent: () => import('./features/onboarding/onboarding-list').then(m => m.OnboardingList) },
      { path: 'admin/onboarding/clients',          loadComponent: () => import('./features/onboarding/onboarding-clients').then(m => m.OnboardingClients) },
      { path: 'admin/onboarding/new',              loadComponent: () => import('./features/onboarding/onboarding-builder').then(m => m.OnboardingBuilder) },
      { path: 'admin/onboarding/:id/edit',         loadComponent: () => import('./features/onboarding/onboarding-builder').then(m => m.OnboardingBuilder) },
      { path: 'admin/onboarding/:id/clients',      loadComponent: () => import('./features/onboarding/onboarding-clients').then(m => m.OnboardingClients) },
      { path: 'admin/onboarding/:id/client/:cid',  loadComponent: () => import('./features/onboarding/onboarding-clients').then(m => m.OnboardingClients) },
      { path: 'admin/main/:id',                    loadComponent: () => import('./features/onboarding/main-section').then(m => m.MainSection) },
      { path: 'admin/main/:id/client/:cid',        loadComponent: () => import('./features/onboarding/qualified-client').then(m => m.QualifiedClient) },

      { path: 'admin/sections',           loadComponent: () => import('./features/sections/sections-admin').then(m => m.SectionsAdmin) },
      { path: 'admin/sections/new',       loadComponent: () => import('./features/sections/sections-admin').then(m => m.SectionsAdmin) },
      { path: 'admin/sections/:id/edit',  loadComponent: () => import('./features/sections/sections-admin').then(m => m.SectionsAdmin) },
      { path: 'admin/section/:id',        loadComponent: () => import('./features/sections/sections-admin').then(m => m.SectionsAdmin) },

      { path: 'admin/leads',           loadComponent: () => import('./features/leads/leads-admin').then(m => m.LeadsAdmin) },
      { path: 'admin/leads/new',       loadComponent: () => import('./features/leads/leads-admin').then(m => m.LeadsAdmin) },
      { path: 'admin/leads/:id',       loadComponent: () => import('./features/leads/leads-admin').then(m => m.LeadsAdmin) },
      { path: 'admin/leads/:id/edit',  loadComponent: () => import('./features/leads/leads-admin').then(m => m.LeadsAdmin) },

      // Lazy-loaded so the SheetJS xlsx parser ships in its own chunk
      // rather than the initial bundle.
      { path: 'admin/leadgen',           loadComponent: () => import('./features/leadgen/leadgen-admin').then(m => m.LeadgenAdmin) },
      { path: 'admin/leadgen/settings',  loadComponent: () => import('./features/leadgen/leadgen-settings').then(m => m.LeadgenSettings) },

      { path: 'admin/newsletter',        loadComponent: () => import('./features/newsletter/newsletter-admin').then(m => m.NewsletterAdmin) },
      { path: 'admin/newsletter/new',    loadComponent: () => import('./features/newsletter/newsletter-admin').then(m => m.NewsletterAdmin) },
      { path: 'admin/newsletter/:id',    loadComponent: () => import('./features/newsletter/newsletter-admin').then(m => m.NewsletterAdmin) },

      { path: 'admin/clients',           loadComponent: () => import('./features/clients/clients-admin').then(m => m.ClientsAdmin) },
      { path: 'admin/clients/new',       loadComponent: () => import('./features/clients/clients-admin').then(m => m.ClientsAdmin) },
      { path: 'admin/clients/:id',       loadComponent: () => import('./features/clients/clients-admin').then(m => m.ClientsAdmin) },
      { path: 'admin/clients/:id/edit',  loadComponent: () => import('./features/clients/clients-admin').then(m => m.ClientsAdmin) },

      { path: 'admin/services',          loadComponent: () => import('./features/services/services-admin').then(m => m.ServicesAdmin) },

      // ────────── Tasks (peer system at /tasks/*) ──────────
      // Tasks is its own top-level system as of the Tasks/Taskboard split.
      // The old `/admin/tasks/*` URLs redirect to the new locations so any
      // bookmarks or in-flight references keep working.
      { path: 'tasks', redirectTo: 'tasks/taskboard', pathMatch: 'full' },
      { path: 'tasks/taskboard',               loadComponent: () => import('./features/tasks/tasks-landing').then(m => m.TasksLanding) },
      { path: 'tasks/taskboard/settings',      loadComponent: () => import('./features/tasks/tasks-settings').then(m => m.TasksSettings) },
      { path: 'tasks/taskboard/projects/:id',  loadComponent: () => import('./features/tasks/tasks-project').then(m => m.TasksProject) },
      { path: 'admin/tasks',                   redirectTo: 'tasks/taskboard', pathMatch: 'full' },
      { path: 'admin/tasks/settings',          redirectTo: 'tasks/taskboard/settings', pathMatch: 'full' },
      { path: 'admin/tasks/projects/:id',      redirectTo: 'tasks/taskboard/projects/:id' },

      // Team (admin user CRUD) — moved from CRM into the Tasks system.
      // Old /admin/users URL kept as a redirect for any in-flight references.
      { path: 'tasks/team',  loadComponent: () => import('./features/users/users-admin').then(m => m.UsersAdmin) },
      { path: 'admin/users', redirectTo: 'tasks/team', pathMatch: 'full' },

      // ────────── My Account (per-user) ──────────
      // Lives at /me so it's clearly the logged-in user's own area, accessed
      // from the top-nav user dropdown. Has its own MeSideNav (mounted in
      // Shell). All section URLs drive HrMe's active tab via path matching;
      // /me/account is the only non-tab page (password / appearance settings).
      { path: 'me',             loadComponent: () => import('./features/hr/hr-me').then(m => m.HrMe) },
      { path: 'me/payslips',    loadComponent: () => import('./features/hr/hr-me').then(m => m.HrMe) },
      { path: 'me/time-off',    loadComponent: () => import('./features/hr/hr-me').then(m => m.HrMe) },
      { path: 'me/shifts',      loadComponent: () => import('./features/hr/hr-me').then(m => m.HrMe) },
      { path: 'me/documents',   loadComponent: () => import('./features/hr/hr-me').then(m => m.HrMe) },
      { path: 'me/reviews',     loadComponent: () => import('./features/hr/hr-me').then(m => m.HrMe) },
      { path: 'me/learning',    loadComponent: () => import('./features/hr/hr-me').then(m => m.HrMe) },
      { path: 'me/goals',       loadComponent: () => import('./features/hr/hr-me').then(m => m.HrMe) },
      { path: 'me/skills',      loadComponent: () => import('./features/hr/hr-me').then(m => m.HrMe) },
      { path: 'me/feedback',    loadComponent: () => import('./features/hr/hr-me').then(m => m.HrMe) },
      { path: 'me/engagement',  loadComponent: () => import('./features/hr/hr-me').then(m => m.HrMe) },
      { path: 'me/account',     loadComponent: () => import('./features/ess/my-account').then(m => m.MyAccount) },

      // ────────── HR ──────────
      { path: 'hr', redirectTo: 'hr/dashboard', pathMatch: 'full' },
      { path: 'hr/dashboard',                  loadComponent: () => import('./features/hr/hr-dashboard').then(m => m.HrDashboard) },
      { path: 'hr/employees',                  loadComponent: () => import('./features/hr/hr-employees').then(m => m.HrEmployees) },
      { path: 'hr/employees/new',              loadComponent: () => import('./features/hr/hr-employees').then(m => m.HrEmployees) },
      { path: 'hr/employees/:id',              loadComponent: () => import('./features/hr/hr-employee-detail').then(m => m.HrEmployeeDetail) },
      { path: 'hr/onboarding',                 loadComponent: () => import('./features/hr/hr-onboarding').then(m => m.HrOnboarding) },
      { path: 'hr/reviews',                    loadComponent: () => import('./features/hr/hr-reviews').then(m => m.HrReviews) },
      { path: 'hr/reviews/:id',                loadComponent: () => import('./features/hr/hr-review-edit').then(m => m.HrReviewEdit) },
      { path: 'hr/learning',                   loadComponent: () => import('./features/hr/hr-learning').then(m => m.HrLearning) },
      { path: 'hr/change-requests',            loadComponent: () => import('./features/hr/hr-change-requests').then(m => m.HrChangeRequests) },
      { path: 'hr/compliance',                 loadComponent: () => import('./features/hr/hr-compliance').then(m => m.HrCompliance) },
      { path: 'hr/legal',                      loadComponent: () => import('./features/hr/hr-legal').then(m => m.HrLegal) },
      { path: 'hr/legal/:slug',                loadComponent: () => import('./features/hr/hr-legal-detail').then(m => m.HrLegalDetail) },
      { path: 'hr/engagement',                 loadComponent: () => import('./features/hr/hr-engagement').then(m => m.HrEngagement) },
      { path: 'hr/succession',                 loadComponent: () => import('./features/hr/hr-succession').then(m => m.HrSuccession) },
      { path: 'hr/recruitment',                loadComponent: () => import('./features/hr/hr-recruitment').then(m => m.HrRecruitment) },
      // Documents moved to the Operations system. The /hr/documents URL is
      // kept as a redirect so any in-flight bookmarks/links keep resolving.
      // The component still lives under features/hr/ since the data model,
      // tables (hr_documents, hr_document_types), and backend (hr.php) all
      // remain HR-owned — only the navigation home changes.
      { path: 'hr/documents',                  redirectTo: 'operations/contracts', pathMatch: 'full' },
      // Payroll moved to /accounting/payroll. Keep the old URL as a redirect
      // so existing bookmarks / Management links resolve.
      { path: 'hr/payroll',                    redirectTo: 'accounting/payroll', pathMatch: 'full' },
      { path: 'hr/payslip/:periodId/:slipId',  loadComponent: () => import('./features/hr/hr-payslip-print').then(m => m.HrPayslipPrint) },
      { path: 'hr/time-off',                   loadComponent: () => import('./features/hr/hr-time-off').then(m => m.HrTimeOff) },

      // ────────── Management (MSS) ──────────
      { path: 'management',            redirectTo: 'management/dashboard', pathMatch: 'full' },
      { path: 'management/dashboard',  loadComponent: () => import('./features/management/management-dashboard').then(m => m.ManagementDashboard) },
      { path: 'management/team',       loadComponent: () => import('./features/management/management-team').then(m => m.ManagementTeam) },
      { path: 'management/approvals',  loadComponent: () => import('./features/management/management-approvals').then(m => m.ManagementApprovals) },
      { path: 'management/reviews',    loadComponent: () => import('./features/management/management-reviews').then(m => m.ManagementReviews) },
      { path: 'management/schedule',   loadComponent: () => import('./features/management/management-schedule').then(m => m.ManagementSchedule) },
      { path: 'management/feedback',   loadComponent: () => import('./features/management/management-feedback').then(m => m.ManagementFeedback) },
      { path: 'management/goals',      loadComponent: () => import('./features/management/management-goals').then(m => m.ManagementGoals) },
      { path: 'management/compliance', loadComponent: () => import('./features/management/management-compliance').then(m => m.ManagementCompliance) },
      { path: 'management/calendar',   loadComponent: () => import('./features/management/management-calendar').then(m => m.ManagementCalendar) },
      { path: 'management/skills',     loadComponent: () => import('./features/management/management-skills').then(m => m.ManagementSkills) },
      { path: 'management/hiring',     loadComponent: () => import('./features/management/management-hiring').then(m => m.ManagementHiring) },
      { path: 'management/succession', loadComponent: () => import('./features/management/management-succession').then(m => m.ManagementSuccession) },
      { path: 'management/analytics',  loadComponent: () => import('./features/management/management-analytics').then(m => m.ManagementAnalytics) },

      // ────────── Operations ──────────
      // Newly added system. Dashboard-only scaffold today; sub-pages get added
      // as features land in cms/frontend/src/app/features/operations/.
      { path: 'operations',                  redirectTo: 'operations/dashboard', pathMatch: 'full' },
      { path: 'operations/dashboard',        loadComponent: () => import('./features/operations/operations-dashboard').then(m => m.OperationsDashboard) },
      { path: 'operations/taskboard',        loadComponent: () => import('./features/operations/tenders-taskboard').then(m => m.TendersTaskboard) },
      { path: 'operations/partners',           loadComponent: () => import('./features/operations/partners-admin').then(m => m.PartnersAdmin) },
      { path: 'operations/partners/new',       loadComponent: () => import('./features/operations/partners-admin').then(m => m.PartnersAdmin) },
      { path: 'operations/partners/:id',       loadComponent: () => import('./features/operations/partners-admin').then(m => m.PartnersAdmin) },
      { path: 'operations/partners/:id/edit',  loadComponent: () => import('./features/operations/partners-admin').then(m => m.PartnersAdmin) },
      { path: 'operations/contractors',           loadComponent: () => import('./features/operations/contractors-admin').then(m => m.ContractorsAdmin) },
      { path: 'operations/contractors/new',       loadComponent: () => import('./features/operations/contractors-admin').then(m => m.ContractorsAdmin) },
      { path: 'operations/contractors/:id',       loadComponent: () => import('./features/operations/contractors-admin').then(m => m.ContractorsAdmin) },
      { path: 'operations/contractors/:id/edit',  loadComponent: () => import('./features/operations/contractors-admin').then(m => m.ContractorsAdmin) },
      { path: 'operations/affiliates',            loadComponent: () => import('./features/operations/affiliates-admin').then(m => m.AffiliatesAdmin) },
      { path: 'operations/affiliates/new',        loadComponent: () => import('./features/operations/affiliates-admin').then(m => m.AffiliatesAdmin) },
      { path: 'operations/affiliates/:id',        loadComponent: () => import('./features/operations/affiliates-admin').then(m => m.AffiliatesAdmin) },
      { path: 'operations/affiliates/:id/edit',   loadComponent: () => import('./features/operations/affiliates-admin').then(m => m.AffiliatesAdmin) },
      // Contracts (was the HR Documents page — renamed once a separate generic
      // Operations Documents page was added). Same component + backend; route
      // data tells hr-documents.ts to show only contract-kind sections and
      // re-label its heading.
      { path: 'operations/contracts',        loadComponent: () => import('./features/hr/hr-documents').then(m => m.HrDocuments), data: { onlyKind: 'contract' } },
      // Generic Documents view — aggregated uploads across HR + Tenders, plus
      // a filesystem Browse tab rooted at cms/uploads/.
      { path: 'operations/documents',        loadComponent: () => import('./features/operations/operations-documents').then(m => m.OperationsDocuments) },
      { path: 'operations/tenders',          loadComponent: () => import('./features/operations/tenders-admin').then(m => m.TendersAdmin) },
      { path: 'operations/tenders/new',      loadComponent: () => import('./features/operations/tenders-admin').then(m => m.TendersAdmin) },
      // 'import' must come BEFORE ':id' — Angular matches routes in order, and
      // ':id' would otherwise swallow the literal "import" segment.
      { path: 'operations/tenders/import',   loadComponent: () => import('./features/operations/tenders-import').then(m => m.TendersImport) },
      { path: 'operations/tenders/:id',      loadComponent: () => import('./features/operations/tenders-admin').then(m => m.TendersAdmin) },
      { path: 'operations/tenders/:id/edit', loadComponent: () => import('./features/operations/tenders-admin').then(m => m.TendersAdmin) },

      // ────────── Recruitment ──────────
      // Agency placing candidates with external clients (migration 077).
      // Clients are filtered from the shared `clients` table via the
      // `is_recruitment_client` flag rather than a separate table.
      { path: 'recruitment',                  redirectTo: 'recruitment/dashboard', pathMatch: 'full' },
      { path: 'recruitment/dashboard',        loadComponent: () => import('./features/recruitment/recruitment-dashboard').then(m => m.RecruitmentDashboard) },
      { path: 'recruitment/clients',          loadComponent: () => import('./features/recruitment/recruitment-clients').then(m => m.RecruitmentClients) },
      { path: 'recruitment/clients/:id',       loadComponent: () => import('./features/recruitment/recruitment-client-detail').then(m => m.RecruitmentClientDetail) },
      { path: 'recruitment/candidates',       loadComponent: () => import('./features/recruitment/recruitment-candidates').then(m => m.RecruitmentCandidates) },
      { path: 'recruitment/candidates/new',   loadComponent: () => import('./features/recruitment/recruitment-candidates').then(m => m.RecruitmentCandidates) },
      { path: 'recruitment/candidates/:id',   loadComponent: () => import('./features/recruitment/recruitment-candidates').then(m => m.RecruitmentCandidates) },
      { path: 'recruitment/candidates/:id/edit', loadComponent: () => import('./features/recruitment/recruitment-candidates').then(m => m.RecruitmentCandidates) },
      { path: 'recruitment/documentation',    loadComponent: () => import('./features/recruitment/recruitment-documentation').then(m => m.RecruitmentDocumentation) },
      { path: 'recruitment/settings',         loadComponent: () => import('./features/recruitment/recruitment-settings').then(m => m.RecruitmentSettings) },

      // ────────── Accounting ──────────
      // Phase 1: dashboard + invoices + payroll (payroll relocated from /hr).
      // Bank feed, VAT, full GL parked until integration details are
      // unblocked (see docs/accounting-plan.txt).
      { path: 'accounting',            redirectTo: 'accounting/dashboard', pathMatch: 'full' },
      { path: 'accounting/dashboard',  loadComponent: () => import('./features/accounting/accounting-dashboard').then(m => m.AccountingDashboard) },
      { path: 'accounting/invoices',   loadComponent: () => import('./features/accounting/accounting-invoices').then(m => m.AccountingInvoices) },
      { path: 'accounting/payroll',    loadComponent: () => import('./features/hr/hr-payroll').then(m => m.HrPayroll) },

      // ────────── Placeholder systems ──────────
      { path: 'crm',     loadComponent: () => import('./features/system-placeholder/system-placeholder').then(m => m.SystemPlaceholder), data: { title: 'CRM' } },
      { path: 'account', loadComponent: () => import('./features/system-placeholder/system-placeholder').then(m => m.SystemPlaceholder), data: { title: 'Account' } },
      { path: 'support', loadComponent: () => import('./features/system-placeholder/system-placeholder').then(m => m.SystemPlaceholder), data: { title: 'Support' } },
    ],
  },

  { path: '**', redirectTo: 'admin/clients' },
];
