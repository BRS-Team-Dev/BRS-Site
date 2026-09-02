import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  AdminSection, AdminUser, AdminUserRecord, AppSettings, BillingProfile, BillingSummary, FormInvite, FormSubmissionCandidateGroup, FormSubmissionLinkGroup, PaymentMethod, StripeConfig, StripeSetupIntent, StripeSubscribeResult, SubscriptionInvoice, SubscriptionPlan, SubscriptionTier, UsersSubscription,
  AppNotification, ChFetchResult, ChFoundCounts, ChLastRun, ChMilestones, ChOfficersResult, ChProfilesResult, ChQualifyResult, ChStaffResult, CompanyLead, CompanyLeadDetail, Client, ClientAccount, ClientContact, ClientInfo, ClientNote, ClientService, ClientServicesTotals, CrmDashboardOverview, CrmTask, CrmTaskNote, CrmTaskStats, CustomTheme, EmailProvider, EmailRouting, FeedbackForm, FeedbackQuestion, FeedbackResponse, Invoice, InvoiceLine, InvoiceServiceLink, InvoiceTemplate, Lead, LeadIndustrySummary, LeadInfo, LeadNote, LeadServiceLink, NotificationEventDef, NotificationRule, NotificationSection, NotificationUnreadCount, ServiceClientDetail, ServiceClientLink, ServicePoolEntry,
  FormDef, FormField, FormSection,
  HrCertification, HrChangeRequest, HrComplianceNote, HrComplianceTask, HrCourse, HrCourseAssignment,
  HrEmployeeNote,
  HrGoal, HrFeedbackNote, HrSkill, HrEmployeeSkill, HrShift,
  HrCourseModule, HrCoursePlayerSnapshot, HrQuizResult,
  ContractType, ContractGroup, ContractTemplate, EntityContractsResponse, HrDocumentType, HrLegalDocument, HrOnboardingPortalSnapshot, HrOnboardingProgress, HrOnboardingSection, HrReference,
  HrDocument, HrEmployee, HrFeedbackEntry, HrOnboardingTask, HrPayrollPeriod, HrPayslip,
  HrApplication, HrApplicationNote, HrCandidate, HrInterview, HrJob,
  HrPulseAggregate, HrPulseSurvey, HrSuccessionCandidate, HrSuccessionCandidateNote, HrSuccessionPlan, HrSuccessionPlanNote, HrSurveyQuestion, PublicSurveyDef,
  HrPtoSummary, HrReview, HrReviewCycle, HrReviewResponses, HrTimeOffEntry,
  NewsletterCampaign, NewsletterRecipient,
  OnboardingClient, OnboardingFormPayload,
  TaskItem, TaskItemState, TaskItemType, TaskIteration, TaskProject, TaskTeam, TaskTeamMember,
  Tender, TenderInfo, TenderContact, TenderContactNumber, TenderDocument, TenderDocumentKind, TenderNote,
  TenderSection, TenderTracker, TenderLeadFeed, TenderLeadImportResult, OperationTask, OperationTaskStatus,
  OperationsDocument, OperationsDocumentsBrowse,
  Partner, PartnerContact, PartnerNote, PartnerAccount,
  Contractor, ContractorNote, ContractorPermissions, ClientContractorLink,
  AssignmentGroup, AssigneeOption, AssignmentRole, AssigneeType,
  Affiliate, AffiliateNote,
  RecruitmentCandidate, RecruitmentCandidateDocument, RecruitmentCandidateNote,
  RecruitmentCandidateStatus, RecruitmentDocGroup, RecruitmentDocType, RecruitmentDocumentRow, RecruitmentOnboarding,
  RecruitmentOnboardingPortalSnapshot,
  RecruitmentPlacement, RecruitmentRole, RecruitmentSkill,
  ServiceOffering,
  SuperAuditEntry,
  TenantSummary,
  UnifiedLead, UnifiedLeadSource,
} from './models';
import { AiModel, CustomAiModel } from './ai-models';
import { environment } from '@env/environment';

export interface PublicBranding {
  bg_color?: string;
  name?: string;
  logo_url?: string;
}

/** The slice of the tenants registry row the SPA needs at runtime —
 *  brand name for the top-nav, logo path for the dashboard header,
 *  and the colour-theme slug for the [data-theme] attribute. Returned
 *  by every auth endpoint (/auth/login, /auth/me, /auth/impersonate)
 *  so the frontend never needs a separate registry round-trip. */
export interface TenantBranding {
  id: number;
  slug: string | null;
  brand_name: string | null;
  color_theme: string;
  logo_path: string | null;
}

const BASE = `${environment.basePath}/api`;

@Injectable({ providedIn: 'root' })
export class Api {
  private http = inject(HttpClient);

  // auth
  login(email: string, password: string): Observable<{ token: string; user: AdminUser; tenant: TenantBranding }> {
    return this.http.post<{ token: string; user: AdminUser; tenant: TenantBranding }>(`${BASE}/auth/login`, { email, password });
  }
  me(): Observable<{ user: AdminUser; tenant: TenantBranding }> {
    return this.http.get<{ user: AdminUser; tenant: TenantBranding }>(`${BASE}/auth/me`);
  }
  /** Super-admin: hand the current session's identity to another tenant.
   *  Returns a NEW JWT scoped to the target tenant. */
  impersonate(tenantId: number): Observable<{
    token: string; tenant_id: number; tenant_slug: string; brand_name: string;
    tenant: TenantBranding; impersonating: { from: number };
  }> {
    return this.http.post<{
      token: string; tenant_id: number; tenant_slug: string; brand_name: string;
      tenant: TenantBranding; impersonating: { from: number };
    }>(`${BASE}/auth/impersonate`, { tenant_id: tenantId });
  }
  /** Admin: sign in as a user in the same tenant (typically a contractor). */
  impersonateUser(userId: number): Observable<{
    token: string; user: AdminUser; tenant: TenantBranding; impersonating: { from_user: number };
  }> {
    return this.http.post<{
      token: string; user: AdminUser; tenant: TenantBranding; impersonating: { from_user: number };
    }>(`${BASE}/auth/impersonate-user`, { user_id: userId });
  }
  /** Persist a new colour-theme slug for the current tenant. The
   *  backend writes `tenants.color_theme` + flushes the APCu row cache
   *  so /auth/me reflects the change immediately. */
  updateThemeSetting(slug: string): Observable<{ ok: boolean; color_theme: string }> {
    return this.http.put<{ ok: boolean; color_theme: string }>(`${BASE}/settings/theme`, { color_theme: slug });
  }
  /** Per-user theme override. Pass `null` to clear and fall back to the
   *  tenant default. */
  updateMyTheme(slug: string | null): Observable<{ ok: boolean; color_theme: string | null }> {
    return this.http.put<{ ok: boolean; color_theme: string | null }>(`${BASE}/auth/me/theme`, { color_theme: slug });
  }

  // ── Super-admin (cross-tenant) ────────────────────────────────────
  listAllTenants(): Observable<{ tenants: TenantSummary[] }> {
    return this.http.get<{ tenants: TenantSummary[] }>(`${BASE}/super-admin/tenants`);
  }
  suspendTenant(id: number): Observable<{ ok: boolean; tenant_id: number; status: string }> {
    return this.http.post<{ ok: boolean; tenant_id: number; status: string }>(`${BASE}/super-admin/tenants/${id}/suspend`, {});
  }
  activateTenant(id: number): Observable<{ ok: boolean; tenant_id: number; status: string }> {
    return this.http.post<{ ok: boolean; tenant_id: number; status: string }>(`${BASE}/super-admin/tenants/${id}/activate`, {});
  }
  softDeleteTenant(id: number): Observable<{ ok: boolean; tenant_id: number; status: string }> {
    return this.http.post<{ ok: boolean; tenant_id: number; status: string }>(`${BASE}/super-admin/tenants/${id}/soft-delete`, {});
  }
  listSuperAuditLog(limit = 100): Observable<{ entries: SuperAuditEntry[] }> {
    return this.http.get<{ entries: SuperAuditEntry[] }>(`${BASE}/super-admin/audit?limit=${limit}`);
  }
  changePassword(current_password: string, new_password: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${BASE}/auth/change-password`, { current_password, new_password });
  }
  /** For temp-password accounts: caller's JWT is proof of the temp pw. */
  setInitialPassword(new_password: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${BASE}/auth/set-initial-password`, { new_password });
  }

  // ── CRM tasks ────────────────────────────────────────────────────
  listCrmTasks(): Observable<{ tasks: CrmTask[]; stats: CrmTaskStats }> {
    return this.http.get<{ tasks: CrmTask[]; stats: CrmTaskStats }>(`${BASE}/crm-tasks`);
  }
  createCrmTask(payload: Partial<CrmTask>): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/crm-tasks`, payload);
  }
  updateCrmTask(id: number, payload: Partial<CrmTask>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/crm-tasks/${id}`, payload);
  }
  deleteCrmTask(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/crm-tasks/${id}`);
  }

  // ── Feedback forms (questionnaire / form / survey / poll) ──
  listFeedbackForms(filter?: { kind?: string; client?: number; lead?: number; service?: number; published?: number | boolean }): Observable<{ forms: FeedbackForm[] }> {
    const q = new URLSearchParams();
    if (filter?.kind)    q.set('kind', filter.kind);
    if (filter?.client)  q.set('client', String(filter.client));
    if (filter?.lead)    q.set('lead',   String(filter.lead));
    if (filter?.service) q.set('service', String(filter.service));
    if (filter?.published) q.set('published', '1');
    const qs = q.toString();
    return this.http.get<{ forms: FeedbackForm[] }>(`${BASE}/feedback-forms${qs ? '?' + qs : ''}`);
  }
  getFeedbackForm(id: number): Observable<{ form: FeedbackForm; questions: FeedbackQuestion[]; response_count: number }> {
    return this.http.get<{ form: FeedbackForm; questions: FeedbackQuestion[]; response_count: number }>(`${BASE}/feedback-forms/${id}`);
  }
  createFeedbackForm(payload: Partial<FeedbackForm>): Observable<{ id: number; public_token: string }> {
    return this.http.post<{ id: number; public_token: string }>(`${BASE}/feedback-forms`, payload);
  }
  updateFeedbackForm(id: number, payload: Partial<FeedbackForm>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/feedback-forms/${id}`, payload);
  }
  cloneFeedbackForm(id: number, opts?: { service_offering_id?: number; service_name?: string }): Observable<{ id: number; public_token: string }> {
    return this.http.post<{ id: number; public_token: string }>(
      `${BASE}/feedback-forms/${id}/clone`,
      opts ?? {},
    );
  }
  deleteFeedbackForm(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/feedback-forms/${id}`);
  }
  addFeedbackQuestion(formId: number, payload: Partial<FeedbackQuestion>): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/feedback-forms/${formId}/questions`, payload);
  }
  updateFeedbackQuestion(formId: number, qid: number, payload: Partial<FeedbackQuestion>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/feedback-forms/${formId}/questions/${qid}`, payload);
  }
  deleteFeedbackQuestion(formId: number, qid: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/feedback-forms/${formId}/questions/${qid}`);
  }
  listFeedbackResponses(formId: number, filter?: { client?: number; lead?: number }): Observable<{ responses: FeedbackResponse[] }> {
    const q = new URLSearchParams();
    if (filter?.client) q.set('client', String(filter.client));
    if (filter?.lead)   q.set('lead',   String(filter.lead));
    const qs = q.toString();
    return this.http.get<{ responses: FeedbackResponse[] }>(
      `${BASE}/feedback-forms/${formId}/responses${qs ? '?' + qs : ''}`,
    );
  }
  attachFeedbackFormToClient(formId: number, clientId: number): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${BASE}/feedback-forms/${formId}/clients`, { client_id: clientId });
  }
  detachFeedbackFormFromClient(formId: number, clientId: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/feedback-forms/${formId}/clients/${clientId}`);
  }
  attachFeedbackFormToLead(formId: number, leadId: number): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${BASE}/feedback-forms/${formId}/leads`, { lead_id: leadId });
  }
  detachFeedbackFormFromLead(formId: number, leadId: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/feedback-forms/${formId}/leads/${leadId}`);
  }

  // ─── Email providers + routing (migration 122) ───────────────
  listEmailProviders(): Observable<{ providers: EmailProvider[] }> {
    return this.http.get<{ providers: EmailProvider[] }>(`${BASE}/email/providers`);
  }
  createEmailProvider(payload: Partial<EmailProvider> & { api_key?: string; api_secret?: string; smtp_password?: string }): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/email/providers`, payload);
  }
  updateEmailProvider(id: number, payload: Partial<EmailProvider> & { api_key?: string; api_secret?: string; smtp_password?: string }): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/email/providers/${id}`, payload);
  }
  deleteEmailProvider(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/email/providers/${id}`);
  }
  testEmailProvider(id: number, to: string): Observable<{ ok: boolean; sent_to?: string; error?: string }> {
    return this.http.post<{ ok: boolean; sent_to?: string; error?: string }>(
      `${BASE}/email/providers/${id}/test`, { to }
    );
  }
  // ─── Custom themes (migration 126) ───────────────────────────
  listCustomThemes(): Observable<{ themes: CustomTheme[] }> {
    return this.http.get<{ themes: CustomTheme[] }>(`${BASE}/themes`);
  }
  createCustomTheme(payload: Partial<CustomTheme>): Observable<{ id: number; slug: string }> {
    return this.http.post<{ id: number; slug: string }>(`${BASE}/themes`, payload);
  }
  updateCustomTheme(id: number, payload: Partial<CustomTheme>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/themes/${id}`, payload);
  }
  deleteCustomTheme(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/themes/${id}`);
  }

  getEmailSystemStatus(): Observable<{
    system_fallback_enabled: boolean;
    grace_days_left: number | null;
    in_grace: boolean;
    expired: boolean;
  }> {
    return this.http.get<{
      system_fallback_enabled: boolean;
      grace_days_left: number | null;
      in_grace: boolean;
      expired: boolean;
    }>(`${BASE}/email/system`);
  }
  getEmailRouting(): Observable<{ routing: EmailRouting }> {
    return this.http.get<{ routing: EmailRouting }>(`${BASE}/email/routing`);
  }
  updateEmailRouting(payload: Partial<EmailRouting>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/email/routing`, payload);
  }

  listCrmTaskNotes(taskId: number): Observable<{ notes: CrmTaskNote[] }> {
    return this.http.get<{ notes: CrmTaskNote[] }>(`${BASE}/crm-tasks/${taskId}/notes`);
  }
  addCrmTaskNote(taskId: number, body: string): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/crm-tasks/${taskId}/notes`, { body });
  }

  // forms
  listForms(): Observable<{ forms: FormDef[] }> {
    return this.http.get<{ forms: FormDef[] }>(`${BASE}/forms`);
  }
  getForm(id: number): Observable<{ form: FormDef; fields: FormField[] }> {
    return this.http.get<{ form: FormDef; fields: FormField[] }>(`${BASE}/forms/${id}`);
  }
  createForm(payload: Partial<FormDef> & { fields: FormField[] }): Observable<{ id: number; slug: string }> {
    return this.http.post<{ id: number; slug: string }>(`${BASE}/forms`, payload);
  }
  updateForm(id: number, payload: Partial<FormDef> & { fields: FormField[] }): Observable<{ ok: boolean; slug: string }> {
    return this.http.put<{ ok: boolean; slug: string }>(`${BASE}/forms/${id}`, payload);
  }
  deleteForm(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/forms/${id}`);
  }

  // service offerings (CRM Services catalogue — standalone, not onboarding)
  listServiceOfferings(): Observable<{ services: ServiceOffering[] }> {
    return this.http.get<{ services: ServiceOffering[] }>(`${BASE}/services`);
  }
  /** Clients currently tied to a catalogue service — either via a
   *  direct client_service_offerings row OR via a qualified
   *  onboarding_clients entry whose form links to this service. */
  listClientsOnService(serviceId: number): Observable<{ clients: ServiceClientLink[] }> {
    return this.http.get<{ clients: ServiceClientLink[] }>(`${BASE}/services/${serviceId}/clients`);
  }
  /** Update the workflow status on a catalogue-attached service link
   *  row. Onboarding-derived rows reject this (their status is read
   *  from task_projects). */
  updateServiceClientStatus(serviceId: number, linkId: number, status: string) {
    return this.http.put<{ ok: boolean; status: string }>(
      `${BASE}/services/${serviceId}/clients/${linkId}/status`,
      { status }
    );
  }
  /** Single-row detail for the full-page tracking view. `key` is
   *  `cat-<linkId>` (catalogue attach) or `onb-<ocId>` (onboarding). */
  getServiceClientDetail(serviceId: number, key: string): Observable<{ client: ServiceClientDetail; service: ServiceOffering }> {
    return this.http.get<{ client: ServiceClientDetail; service: ServiceOffering }>(
      `${BASE}/services/${serviceId}/client/${key}`
    );
  }
  /** The onboarding form (if any) linked to a catalogue service via
   *  forms.service_offering_id. Returns `{ form: null }` when nothing
   *  is linked yet — the modal uses that to show "+ Create
   *  onboarding". */
  getServiceOnboardingForm(serviceId: number): Observable<{ form: { id: number; slug: string; title: string; is_published: 0 | 1; created_at?: string } | null }> {
    return this.http.get<{ form: { id: number; slug: string; title: string; is_published: 0 | 1; created_at?: string } | null }>(
      `${BASE}/services/${serviceId}/onboarding`
    );
  }
  createServiceOffering(payload: Partial<ServiceOffering>): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/services`, payload);
  }
  updateServiceOffering(id: number, payload: Partial<ServiceOffering>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/services/${id}`, payload);
  }
  deleteServiceOffering(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/services/${id}`);
  }

  // submissions
  listSubmissions(formId: number, page = 1, per = 50): Observable<{ rows: any[]; total: number; page: number; per: number }> {
    const params = new HttpParams().set('page', page).set('per', per);
    return this.http.get<{ rows: any[]; total: number; page: number; per: number }>(
      `${BASE}/forms/${formId}/submissions`, { params });
  }
  getSubmission(formId: number, rowId: number): Observable<{ row: any }> {
    return this.http.get<{ row: any }>(`${BASE}/forms/${formId}/submissions/${rowId}`);
  }
  deleteSubmission(formId: number, rowId: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/forms/${formId}/submissions/${rowId}`);
  }

  // settings
  getSettings(): Observable<{ settings: AppSettings }> {
    return this.http.get<{ settings: AppSettings }>(`${BASE}/settings`);
  }
  updateSettings(s: Partial<AppSettings>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/settings`, s);
  }
  testMail(to: string): Observable<{ ok: boolean; error?: string }> {
    return this.http.post<{ ok: boolean; error?: string }>(`${BASE}/settings/test-mail`, { to });
  }
  // ─── Notifications (migration 127) ───────────────────────────
  listNotifications(section?: string): Observable<{ notifications: AppNotification[] }> {
    const qs = section ? `?section=${encodeURIComponent(section)}` : '';
    return this.http.get<{ notifications: AppNotification[] }>(`${BASE}/notifications${qs}`);
  }
  notificationUnreadCount(): Observable<NotificationUnreadCount> {
    return this.http.get<NotificationUnreadCount>(`${BASE}/notifications/unread-count`);
  }
  markNotificationRead(id: number): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/notifications/${id}/read`, {});
  }
  markAllNotificationsRead(section?: string): Observable<{ ok: boolean }> {
    const qs = section ? `?section=${encodeURIComponent(section)}` : '';
    return this.http.post<{ ok: boolean }>(`${BASE}/notifications/read-all${qs}`, {});
  }
  listNotificationEvents(): Observable<{ events: NotificationEventDef[] }> {
    return this.http.get<{ events: NotificationEventDef[] }>(`${BASE}/notifications/events`);
  }
  listNotificationRules(): Observable<{ rules: NotificationRule[] }> {
    return this.http.get<{ rules: NotificationRule[] }>(`${BASE}/notifications/rules`);
  }
  updateNotificationRule(eventKey: string, rule: Partial<NotificationRule>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/notifications/rules/${encodeURIComponent(eventKey)}`, rule);
  }

  uploadBrandLogo(file: File): Observable<{ url: string }> {
    const fd = new FormData();
    fd.append('file', file);
    return this.http.post<{ url: string }>(`${BASE}/settings/logo`, fd);
  }
  /** Server-side proxy that fetches a logo URL and streams the raw
   *  image bytes back. Bypasses browser CORS for cross-origin logos
   *  (e.g. a dev localhost frontend + a prod-domain logo). Response is
   *  the image bytes with the origin's Content-Type header preserved. */
  fetchLogoBlob(url: string): Observable<Blob> {
    return this.http.get(`${BASE}/settings/logo-fetch?url=${encodeURIComponent(url)}`, { responseType: 'blob' });
  }

  // onboarding (admin)
  listOnboardingForms(): Observable<{ forms: FormDef[] }> {
    return this.http.get<{ forms: FormDef[] }>(`${BASE}/onboarding/forms`);
  }
  getOnboardingForm(id: number): Observable<{ form: FormDef; sections: FormSection[] }> {
    return this.http.get<{ form: FormDef; sections: FormSection[] }>(`${BASE}/onboarding/forms/${id}`);
  }
  createOnboardingForm(payload: OnboardingFormPayload): Observable<{ id: number; slug: string }> {
    return this.http.post<{ id: number; slug: string }>(`${BASE}/onboarding/forms`, payload);
  }
  updateOnboardingForm(id: number, payload: OnboardingFormPayload): Observable<{ ok: boolean; slug: string }> {
    return this.http.put<{ ok: boolean; slug: string }>(`${BASE}/onboarding/forms/${id}`, payload);
  }
  deleteOnboardingForm(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/onboarding/forms/${id}`);
  }
  listAllOnboardingClients(): Observable<{ clients: OnboardingClient[] }> {
    return this.http.get<{ clients: OnboardingClient[] }>(`${BASE}/onboarding/clients`);
  }
  /** Cross-form list of clients who have been qualified somewhere. Used by
   *  the main-section Invite picker to surface existing contacts. */
  listAllQualifiedOnboardingClients(): Observable<{ clients: OnboardingClient[] }> {
    return this.http.get<{ clients: OnboardingClient[] }>(`${BASE}/onboarding/clients?qualified=1`);
  }
  listOnboardingClients(formId: number, qualified = false): Observable<{ clients: OnboardingClient[]; total_sections: number }> {
    const q = qualified ? '?qualified=1' : '';
    return this.http.get<{ clients: OnboardingClient[]; total_sections: number }>(`${BASE}/onboarding/forms/${formId}/clients${q}`);
  }
  inviteOnboardingClient(formId: number, payload: { client_email?: string; client_name?: string; parent_client_id?: number }): Observable<{ id: number; token: string; url: string }> {
    return this.http.post<{ id: number; token: string; url: string }>(`${BASE}/onboarding/forms/${formId}/clients`, payload);
  }
  getOnboardingClient(formId: number, clientId: number): Observable<{ client: OnboardingClient; submission: any }> {
    return this.http.get<{ client: OnboardingClient; submission: any }>(`${BASE}/onboarding/forms/${formId}/clients/${clientId}`);
  }
  deleteOnboardingClient(formId: number, clientId: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/onboarding/forms/${formId}/clients/${clientId}`);
  }
  acknowledgeOnboardingClient(formId: number, clientId: number): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${BASE}/onboarding/forms/${formId}/clients/${clientId}/acknowledge`, {});
  }
  qualifyOnboardingClient(formId: number, clientId: number, unqualify = false): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(
      `${BASE}/onboarding/forms/${formId}/clients/${clientId}/qualify`,
      unqualify ? { unqualify: true } : {}
    );
  }

  // independent admin sections
  listSections(): Observable<{ sections: AdminSection[] }> {
    return this.http.get<{ sections: AdminSection[] }>(`${BASE}/sections`);
  }
  getSection(id: number): Observable<{ section: AdminSection }> {
    return this.http.get<{ section: AdminSection }>(`${BASE}/sections/${id}`);
  }
  createSection(payload: AdminSection): Observable<{ id: number; slug: string }> {
    return this.http.post<{ id: number; slug: string }>(`${BASE}/sections`, payload);
  }
  updateSection(id: number, payload: AdminSection): Observable<{ ok: boolean; slug: string }> {
    return this.http.put<{ ok: boolean; slug: string }>(`${BASE}/sections/${id}`, payload);
  }
  deleteSection(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/sections/${id}`);
  }

  // standalone clients (independent of forms)
  listClients(): Observable<{ clients: Client[] }> {
    return this.http.get<{ clients: Client[] }>(`${BASE}/clients`);
  }
  getClient(id: number): Observable<{ client: Client }> {
    return this.http.get<{ client: Client }>(`${BASE}/clients/${id}`);
  }
  createClient(payload: Client): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/clients`, payload);
  }
  updateClient(id: number, payload: Partial<Client>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/clients/${id}`, payload);
  }
  deleteClient(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/clients/${id}`);
  }
  /** Demote a client back to a lead. Inverse of `promoteLead`. Creates
   *  a fresh `leads` row with the client's name/email/phone/etc and
   *  deletes the client (cascading sub-tables — same semantics as the
   *  existing DELETE handler). */
  relegateClientToLead(id: number): Observable<{ ok: boolean; lead_id: number }> {
    return this.http.post<{ ok: boolean; lead_id: number }>(
      `${BASE}/clients/${id}/relegate-to-lead`, {}
    );
  }
  listClientContacts(clientId: number): Observable<{ contacts: ClientContact[] }> {
    return this.http.get<{ contacts: ClientContact[] }>(`${BASE}/clients/${clientId}/contacts`);
  }
  createClientContact(clientId: number, payload: ClientContact): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/clients/${clientId}/contacts`, payload);
  }
  updateClientContact(clientId: number, contactId: number, payload: ClientContact): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/clients/${clientId}/contacts/${contactId}`, payload);
  }
  deleteClientContact(clientId: number, contactId: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/clients/${clientId}/contacts/${contactId}`);
  }
  /** Promote a contact to primary; the backend demotes any existing primary
   *  contact for the same client in a transaction so the invariant holds. */
  setPrimaryClientContact(clientId: number, contactId: number): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${BASE}/clients/${clientId}/contacts/${contactId}/primary`, {});
  }

  // ── Lead contacts (mirror of the client_contacts endpoints) ───────
  // Same shape as ClientContact so the lead Contacts tab can reuse the
  // existing ClientContact UI patterns without a parallel interface.
  listLeadContacts(leadId: number): Observable<{ contacts: ClientContact[] }> {
    return this.http.get<{ contacts: ClientContact[] }>(`${BASE}/leads/${leadId}/contacts`);
  }
  createLeadContact(leadId: number, payload: ClientContact): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/leads/${leadId}/contacts`, payload);
  }
  updateLeadContact(leadId: number, contactId: number, payload: ClientContact): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/leads/${leadId}/contacts/${contactId}`, payload);
  }
  deleteLeadContact(leadId: number, contactId: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/leads/${leadId}/contacts/${contactId}`);
  }
  setPrimaryLeadContact(leadId: number, contactId: number): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${BASE}/leads/${leadId}/contacts/${contactId}/primary`, {});
  }
  listClientAccounts(clientId: number): Observable<{ accounts: ClientAccount[] }> {
    return this.http.get<{ accounts: ClientAccount[] }>(`${BASE}/clients/${clientId}/accounts`);
  }
  createClientAccount(clientId: number, payload: ClientAccount): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/clients/${clientId}/accounts`, payload);
  }
  updateClientAccount(clientId: number, accountId: number, payload: ClientAccount): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/clients/${clientId}/accounts/${accountId}`, payload);
  }
  deleteClientAccount(clientId: number, accountId: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/clients/${clientId}/accounts/${accountId}`);
  }
  listClientNotes(clientId: number): Observable<{ notes: ClientNote[] }> {
    return this.http.get<{ notes: ClientNote[] }>(`${BASE}/clients/${clientId}/notes`);
  }
  createClientNote(clientId: number, payload: ClientNote): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/clients/${clientId}/notes`, payload);
  }
  updateClientNote(clientId: number, noteId: number, payload: ClientNote): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/clients/${clientId}/notes/${noteId}`, payload);
  }
  deleteClientNote(clientId: number, noteId: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/clients/${clientId}/notes/${noteId}`);
  }
  listClientInfo(clientId: number): Observable<{ info: ClientInfo[] }> {
    return this.http.get<{ info: ClientInfo[] }>(`${BASE}/clients/${clientId}/info`);
  }
  createClientInfo(clientId: number, payload: ClientInfo): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/clients/${clientId}/info`, payload);
  }
  updateClientInfo(clientId: number, infoId: number, payload: ClientInfo): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/clients/${clientId}/info/${infoId}`, payload);
  }
  deleteClientInfo(clientId: number, infoId: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/clients/${clientId}/info/${infoId}`);
  }
  /** Onboarding-form services this client is signed up for, with computed
   *  contract figures and aggregate totals. */
  listClientServices(clientId: number): Observable<{ services: ClientService[]; totals: ClientServicesTotals }> {
    return this.http.get<{ services: ClientService[]; totals: ClientServicesTotals }>(
      `${BASE}/clients/${clientId}/services`
    );
  }
  /** One-shot CRM dashboard payload — totals + status breakdowns + recent activity. */
  getCrmDashboard(): Observable<CrmDashboardOverview> {
    return this.http.get<CrmDashboardOverview>(`${BASE}/dashboard/crm`);
  }
  /** One-shot: invite this client to a Services-attached onboarding form AND
   *  qualify them in the same request. A fresh onboarding_clients row is
   *  created each call (deliberately), so the same client can have multiple
   *  instances of the same service (e.g. multiple websites). */
  addClientService(clientId: number, formId: number):
    Observable<{ ok: boolean; onboarding_client_id: number; project_id: number | null; token: string }> {
    return this.http.post<{ ok: boolean; onboarding_client_id: number; project_id: number | null; token: string }>(
      `${BASE}/clients/${clientId}/services`, { form_id: formId }
    );
  }
  // Attach a catalogue service (service_offerings) directly to a client.
  // Optional priceOverride is used when the catalogue service has
  // is_variable_price=1 — the picker collects the price at attach time.
  addClientServiceOffering(
    clientId: number,
    serviceOfferingId: number,
    priceOverride?: number | null,
  ): Observable<{ ok: boolean; service_link_id: number }> {
    const body: any = { service_offering_id: serviceOfferingId };
    if (priceOverride !== undefined && priceOverride !== null && !Number.isNaN(priceOverride)) {
      body.price = priceOverride;
    }
    return this.http.post<{ ok: boolean; service_link_id: number }>(
      `${BASE}/clients/${clientId}/services`, body
    );
  }
  removeClientServiceOffering(clientId: number, linkId: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/clients/${clientId}/services/offering/${linkId}`);
  }
  // Edit the pricing snapshot on a catalogue-attached row. Every field
  // is optional — the backend leaves omitted keys alone.
  updateClientServiceOffering(
    clientId: number,
    linkId: number,
    patch: {
      price?: number | null;
      payment_type?: 'one_off' | 'recurring';
      repeat_duration?: 'weekly' | 'monthly' | 'quarterly' | 'yearly' | null;
    },
  ): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(
      `${BASE}/clients/${clientId}/services/offering/${linkId}`, patch
    );
  }

  // leads — potential clients funnel; promote() copies fields into a clients row
  listLeads(): Observable<{ leads: Lead[] }> {
    return this.http.get<{ leads: Lead[] }>(`${BASE}/leads`);
  }
  /** Distinct industries currently in use across the leads table, with
   *  per-industry counts. Drives the dynamic Leads sub-menu on the
   *  sidenav + the industry filter dropdown on the list view. */
  listLeadIndustries(): Observable<{ industries: LeadIndustrySummary[] }> {
    return this.http.get<{ industries: LeadIndustrySummary[] }>(`${BASE}/leads/industries`);
  }
  getLead(id: number): Observable<{ lead: Lead }> {
    return this.http.get<{ lead: Lead }>(`${BASE}/leads/${id}`);
  }
  createLead(payload: Lead): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/leads`, payload);
  }
  bulkCreateLeads(leads: Partial<Lead>[]): Observable<{ inserted: number; errors: { row: number; error: string }[] }> {
    return this.http.post<{ inserted: number; errors: { row: number; error: string }[] }>(
      `${BASE}/leads/bulk`, { leads }
    );
  }
  aiGenerateLeads(searchModel: string, formatModel: string | null, prompt: string): Observable<{ leads: Partial<Lead>[] }> {
    return this.http.post<{ leads: Partial<Lead>[] }>(
      `${BASE}/leads/ai-generate`,
      { search_model: searchModel, format_model: formatModel ?? '', prompt }
    );
  }
  listAiModels(): Observable<{ models: AiModel[] }> {
    return this.http.get<{ models: AiModel[] }>(`${BASE}/leadgen/models`);
  }

  // Companies House enrichment pipeline — its own `company_leads` staging area,
  // isolated from `leads` until promoted. See routes/company_leads.php.
  chPipeline(source?: string): Observable<{ stages: Record<string, number>; milestones?: ChMilestones; last_run?: ChLastRun | null }> {
    const q = source ? '?source=' + encodeURIComponent(source) : '';
    return this.http.get<{ stages: Record<string, number>; milestones?: ChMilestones; last_run?: ChLastRun | null }>(`${BASE}/company-leads/pipeline${q}`);
  }
  saveChLastRun(body: { checked: number; enriched: number; found: ChFoundCounts; source?: string }): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${BASE}/company-leads/last-run`, body);
  }
  chFetchCompanies(opts: { days?: number; limit?: number; sector?: string; status?: string }): Observable<ChFetchResult> {
    return this.http.post<ChFetchResult>(`${BASE}/company-leads/fetch`, opts);
  }
  /** Push the local pipeline (optionally one source) to a dev/prod target that
   *  can't run the headless crawlers. Local exports + ships to the target's import. */
  chPush(opts: { target: 'dev' | 'prod'; source?: string; ids?: number[] }): Observable<{ target: string; pushed: number; result: { inserted: number; skipped: number } }> {
    return this.http.post<{ target: string; pushed: number; result: { inserted: number; skipped: number } }>(`${BASE}/company-leads/push`, opts);
  }
  /** LinkedIn Stage-1 source pull — captures a company list from LinkedIn.
   *  With a stored li_at cookie it paginates the real faceted search
   *  (keyword + region via search_url/geo); otherwise falls back to the
   *  keyless DuckDuckGo index (keyword only). */
  chFetchLinkedin(opts: { keyword?: string; location?: string; search_url?: string; geo?: string; sizes?: string[]; start_page?: number; pages?: number }): Observable<ChFetchResult & { total: number; to_page: number; next_page: number; done: boolean }> {
    return this.http.post<ChFetchResult & { total: number; to_page: number; next_page: number; done: boolean }>(`${BASE}/company-leads/fetch-linkedin`, opts);
  }
  chEnrichOfficers(limit: number): Observable<ChOfficersResult> {
    return this.http.post<ChOfficersResult>(`${BASE}/company-leads/officers`, { limit });
  }
  chFindProfiles(method: 'api' | 'scrape'): Observable<ChProfilesResult> {
    return this.http.post<ChProfilesResult>(`${BASE}/company-leads/profiles`, { method });
  }
  chFindStaff(method: 'scrape' | 'cookie'): Observable<ChStaffResult> {
    return this.http.post<ChStaffResult>(`${BASE}/company-leads/staff`, { method });
  }
  // Qualify — one bundled enrichment pass per record, cursor-chunked.
  chQualify(opts: { after_id: number; limit?: number; ids?: number[]; source?: string; google_method?: 'api' | 'scrape'; linkedin_method?: 'scrape' | 'cookie' }): Observable<ChQualifyResult> {
    return this.http.post<ChQualifyResult>(`${BASE}/company-leads/qualify`, opts);
  }
  /** Run ONE enrichment step on a single pipeline record — the isolated
   *  "get google / get linkedin / …" APIs, reusable from any section. */
  chEnrichStep(
    id: number,
    step: 'officers' | 'google' | 'linkedin' | 'domain' | 'contact',
    opts: { google_method?: 'api' | 'scrape'; linkedin_method?: 'scrape' | 'cookie' } = {},
  ): Observable<{ ok: boolean; step: string; found: Record<string, number | string | boolean>;
                  lead: { id: number; phone: string | null; url: string | null; url_status: string | null; address: string | null; email: string | null } }> {
    return this.http.post<{ ok: boolean; step: string; found: Record<string, number | string | boolean>;
                            lead: { id: number; phone: string | null; url: string | null; url_status: string | null; address: string | null; email: string | null } }>(
      `${BASE}/company-leads/${id}/${step}`, opts);
  }
  // Pipeline records (the list on the Companies House page).
  listCompanyLeads(opts: { stage?: number; q?: string; source?: string } = {}): Observable<{ company_leads: CompanyLead[] }> {
    const qs = new URLSearchParams();
    if (opts.stage != null) qs.set('stage', String(opts.stage));
    if (opts.q) qs.set('q', opts.q);
    if (opts.source) qs.set('source', opts.source);
    const s = qs.toString();
    return this.http.get<{ company_leads: CompanyLead[] }>(`${BASE}/company-leads${s ? '?' + s : ''}`);
  }
  getCompanyLead(id: number): Observable<CompanyLeadDetail> {
    return this.http.get<CompanyLeadDetail>(`${BASE}/company-leads/${id}`);
  }
  /** Amalgamated list for the unified Lead Gen landing page — every lead
   *  across both the company_leads pipeline and the funnel `leads` table. */
  listAllLeads(q?: string): Observable<{ leads: UnifiedLead[]; sources: UnifiedLeadSource[] }> {
    const s = q ? '?q=' + encodeURIComponent(q) : '';
    return this.http.get<{ leads: UnifiedLead[]; sources: UnifiedLeadSource[] }>(`${BASE}/company-leads/all${s}`);
  }
  promoteCompanyLead(id: number): Observable<{ ok: boolean; lead_id: number }> {
    return this.http.post<{ ok: boolean; lead_id: number }>(`${BASE}/company-leads/${id}/promote`, {});
  }
  deleteCompanyLead(id: number): Observable<{ ok: boolean; deleted: number }> {
    return this.http.delete<{ ok: boolean; deleted: number }>(`${BASE}/company-leads/${id}`);
  }
  purgeCompanyLeads(): Observable<{ ok: boolean; deleted: number }> {
    return this.http.delete<{ ok: boolean; deleted: number }>(`${BASE}/company-leads`);
  }
  listCustomAiModels(): Observable<{ models: CustomAiModel[] }> {
    return this.http.get<{ models: CustomAiModel[] }>(`${BASE}/leadgen/models/custom`);
  }
  createCustomAiModel(payload: Partial<CustomAiModel>): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/leadgen/models/custom`, payload);
  }
  deleteCustomAiModel(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/leadgen/models/custom/${id}`);
  }

  // newsletter — campaigns + send/schedule/preview
  listCampaigns(): Observable<{ campaigns: NewsletterCampaign[] }> {
    return this.http.get<{ campaigns: NewsletterCampaign[] }>(`${BASE}/newsletter/campaigns`);
  }
  getCampaign(id: number): Observable<{ campaign: NewsletterCampaign }> {
    return this.http.get<{ campaign: NewsletterCampaign }>(`${BASE}/newsletter/campaigns/${id}`);
  }
  createCampaign(payload: Partial<NewsletterCampaign>): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/newsletter/campaigns`, payload);
  }
  updateCampaign(id: number, payload: Partial<NewsletterCampaign>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/newsletter/campaigns/${id}`, payload);
  }
  deleteCampaign(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/newsletter/campaigns/${id}`);
  }
  sendCampaign(id: number): Observable<{ ok: boolean; sent: number; failed: number; recipients: number; last_error: string | null }> {
    return this.http.post<{ ok: boolean; sent: number; failed: number; recipients: number; last_error: string | null }>(
      `${BASE}/newsletter/campaigns/${id}/send`, {}
    );
  }
  scheduleCampaign(id: number, scheduledAt: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(
      `${BASE}/newsletter/campaigns/${id}/schedule`, { scheduled_at: scheduledAt }
    );
  }
  previewCampaignRecipients(
    id: number,
    overrides: Partial<Pick<NewsletterCampaign, 'audience_clients' | 'audience_leads' | 'audience_custom_emails'>> = {}
  ): Observable<{ count: number; sample: NewsletterRecipient[] }> {
    return this.http.post<{ count: number; sample: NewsletterRecipient[] }>(
      `${BASE}/newsletter/campaigns/${id}/preview-recipients`, overrides
    );
  }
  getCampaignRecipients(id: number): Observable<{ recipients: NewsletterRecipient[] }> {
    return this.http.get<{ recipients: NewsletterRecipient[] }>(`${BASE}/newsletter/campaigns/${id}/recipients`);
  }
  processDueCampaigns(): Observable<{ processed: { id: number; sent?: number; failed?: number; error?: string }[] }> {
    return this.http.post<{ processed: { id: number; sent?: number; failed?: number; error?: string }[] }>(
      `${BASE}/newsletter/process-due`, {}
    );
  }

  // tenders — Operations system
  listTenders(): Observable<{ tenders: Tender[] }> {
    return this.http.get<{ tenders: Tender[] }>(`${BASE}/tenders`);
  }
  /**
   * Live tender-lead feed. Proxied through the operations route
   * (GET /api/operations/tender-leads → cms/scraper/tenders.php) so the
   * dev-server proxy and prod .htaccess both reach it consistently.
   * Params mirror tenders.php: days (window), type (friendly CPV group), q (keyword).
   */
  tenderLeads(opts: { days?: number; type?: string; q?: string } = {}): Observable<TenderLeadFeed> {
    let params = new HttpParams();
    if (opts.days) params = params.set('days', String(opts.days));
    if (opts.type) params = params.set('type', opts.type);
    if (opts.q && opts.q.trim()) params = params.set('q', opts.q.trim());
    return this.http.get<TenderLeadFeed>(`${BASE}/operations/tender-leads`, { params });
  }
  /** Pull from the aggregator and upsert into tender_leads. `mode:'since'` uses
   *  the most recent stored published_date as the cutoff; otherwise `days` (≤30). */
  importTenderLeads(opts: { days?: number; mode?: 'since' } = {}): Observable<TenderLeadImportResult> {
    let params = new HttpParams();
    if (opts.mode) params = params.set('mode', opts.mode);
    else if (opts.days) params = params.set('days', String(opts.days));
    return this.http.post<TenderLeadImportResult>(`${BASE}/operations/tender-leads/import`, {}, { params });
  }
  /** Friendly type → stored-lead count, for the Lead Gen sidenav sub-menu. */
  tenderLeadTypeCounts(): Observable<{ types: { type: string; count: number }[] }> {
    return this.http.get<{ types: { type: string; count: number }[] }>(`${BASE}/operations/tender-leads/types`);
  }
  /** Delete every stored tender lead for the current tenant. */
  purgeTenderLeads(): Observable<{ deleted: number }> {
    return this.http.delete<{ deleted: number }>(`${BASE}/operations/tender-leads`);
  }
  /** Promote a stored lead into a tracked Tender, copying all its info into the
   *  new tender's Info tab as individual entries. Returns the new tender id. */
  promoteTenderLead(ocid: string): Observable<{ tender_id: number }> {
    return this.http.post<{ tender_id: number }>(`${BASE}/operations/tender-leads/promote`, { ocid });
  }
  getTender(id: number): Observable<{ tender: Tender }> {
    return this.http.get<{ tender: Tender }>(`${BASE}/tenders/${id}`);
  }
  createTender(payload: Tender): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/tenders`, payload);
  }
  updateTender(id: number, payload: Tender): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/tenders/${id}`, payload);
  }
  deleteTender(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/tenders/${id}`);
  }
  bulkCreateTenders(tenders: Partial<Tender>[]): Observable<{ inserted: number; errors: { row: number; error: string }[] }> {
    return this.http.post<{ inserted: number; errors: { row: number; error: string }[] }>(
      `${BASE}/tenders/bulk`, { tenders }
    );
  }

  // Tender sub-resources (mirror the clients/* pattern)
  listTenderInfo(tenderId: number): Observable<{ info: TenderInfo[] }> {
    return this.http.get<{ info: TenderInfo[] }>(`${BASE}/tenders/${tenderId}/info`);
  }
  createTenderInfo(tenderId: number, payload: TenderInfo): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/tenders/${tenderId}/info`, payload);
  }
  updateTenderInfo(tenderId: number, infoId: number, payload: TenderInfo): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/tenders/${tenderId}/info/${infoId}`, payload);
  }
  deleteTenderInfo(tenderId: number, infoId: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/tenders/${tenderId}/info/${infoId}`);
  }

  listTenderContacts(tenderId: number): Observable<{ contacts: TenderContact[] }> {
    return this.http.get<{ contacts: TenderContact[] }>(`${BASE}/tenders/${tenderId}/contacts`);
  }
  createTenderContact(tenderId: number, payload: TenderContact): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/tenders/${tenderId}/contacts`, payload);
  }
  updateTenderContact(tenderId: number, contactId: number, payload: TenderContact): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/tenders/${tenderId}/contacts/${contactId}`, payload);
  }
  deleteTenderContact(tenderId: number, contactId: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/tenders/${tenderId}/contacts/${contactId}`);
  }
  addTenderContactNumber(tenderId: number, contactId: number, payload: TenderContactNumber): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/tenders/${tenderId}/contacts/${contactId}/numbers`, payload);
  }
  deleteTenderContactNumber(tenderId: number, contactId: number, numberId: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/tenders/${tenderId}/contacts/${contactId}/numbers/${numberId}`);
  }

  listTenderDocuments(tenderId: number, kind?: TenderDocumentKind): Observable<{ documents: TenderDocument[] }> {
    const url = kind
      ? `${BASE}/tenders/${tenderId}/documents?kind=${kind}`
      : `${BASE}/tenders/${tenderId}/documents`;
    return this.http.get<{ documents: TenderDocument[] }>(url);
  }
  createTenderDocument(tenderId: number, payload: TenderDocument): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/tenders/${tenderId}/documents`, payload);
  }
  updateTenderDocument(tenderId: number, docId: number, payload: TenderDocument): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/tenders/${tenderId}/documents/${docId}`, payload);
  }
  deleteTenderDocument(tenderId: number, docId: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/tenders/${tenderId}/documents/${docId}`);
  }
  uploadTenderDocument(
    tenderId: number,
    args: { sectionId?: number | null; kind?: TenderDocumentKind; file: File; title?: string; description?: string }
  ): Observable<{ id: number }> {
    const fd = new FormData();
    fd.append('file', args.file);
    if (args.sectionId != null) fd.append('section_id', String(args.sectionId));
    if (args.kind)              fd.append('kind', args.kind);
    if (args.title)             fd.append('title', args.title);
    if (args.description)       fd.append('description', args.description);
    // HttpClient leaves Content-Type unset for FormData so the browser sets
    // the proper multipart boundary; JWT interceptor still attaches the bearer.
    return this.http.post<{ id: number }>(`${BASE}/tenders/${tenderId}/documents/upload`, fd);
  }
  toggleTenderDocumentComplete(tenderId: number, docId: number, isCompleted?: boolean): Observable<{ ok: boolean; is_completed: 0 | 1 }> {
    return this.http.post<{ ok: boolean; is_completed: 0 | 1 }>(
      `${BASE}/tenders/${tenderId}/documents/${docId}/complete`,
      isCompleted === undefined ? {} : { is_completed: isCompleted },
    );
  }

  // Tender sections
  listTenderSections(tenderId: number): Observable<{ sections: TenderSection[]; documents: TenderDocument[] }> {
    return this.http.get<{ sections: TenderSection[]; documents: TenderDocument[] }>(`${BASE}/tenders/${tenderId}/sections`);
  }
  createTenderSection(tenderId: number, payload: TenderSection): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/tenders/${tenderId}/sections`, payload);
  }
  bulkCreateTenderSections(tenderId: number, sections: TenderSection[]): Observable<{ created: number }> {
    return this.http.post<{ created: number }>(`${BASE}/tenders/${tenderId}/sections/bulk`, { sections });
  }
  updateTenderSection(tenderId: number, sectionId: number, payload: Partial<TenderSection>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/tenders/${tenderId}/sections/${sectionId}`, payload);
  }
  deleteTenderSection(tenderId: number, sectionId: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/tenders/${tenderId}/sections/${sectionId}`);
  }
  toggleTenderSectionComplete(tenderId: number, sectionId: number, isCompleted?: boolean): Observable<{ ok: boolean; is_completed: 0 | 1 }> {
    return this.http.post<{ ok: boolean; is_completed: 0 | 1 }>(
      `${BASE}/tenders/${tenderId}/sections/${sectionId}/complete`,
      isCompleted === undefined ? {} : { is_completed: isCompleted },
    );
  }

  // Tender tracker — reminders dashboard
  getTenderTracker(): Observable<TenderTracker> {
    return this.http.get<TenderTracker>(`${BASE}/tenders/tracker`);
  }

  // Operations manual tasks (operation_tasks table)
  listOperationTasks(status?: OperationTaskStatus): Observable<{ tasks: OperationTask[] }> {
    const url = status ? `${BASE}/operations/tasks?status=${status}` : `${BASE}/operations/tasks`;
    return this.http.get<{ tasks: OperationTask[] }>(url);
  }
  createOperationTask(payload: OperationTask): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/operations/tasks`, payload);
  }
  updateOperationTask(id: number, payload: Partial<OperationTask>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/operations/tasks/${id}`, payload);
  }
  deleteOperationTask(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/operations/tasks/${id}`);
  }
  setOperationTaskStatus(id: number, status: OperationTaskStatus): Observable<{ ok: boolean; status: OperationTaskStatus; completed_at: string | null }> {
    return this.http.post<{ ok: boolean; status: OperationTaskStatus; completed_at: string | null }>(
      `${BASE}/operations/tasks/${id}/status`, { status },
    );
  }

  // Operations Documents — aggregated view across hr_documents + tender_documents
  listOperationsDocuments(): Observable<{ documents: OperationsDocument[] }> {
    return this.http.get<{ documents: OperationsDocument[] }>(`${BASE}/operations/documents`);
  }
  /** Browse the cms/uploads filesystem tree. `path` is the sub-path relative
   *  to the uploads root (empty = root). */
  browseOperationsDocuments(path: string = ''): Observable<OperationsDocumentsBrowse> {
    const url = path
      ? `${BASE}/operations/documents/browse?path=${encodeURIComponent(path)}`
      : `${BASE}/operations/documents/browse`;
    return this.http.get<OperationsDocumentsBrowse>(url);
  }

  // ───── Operations: Partners ──────────────────────────────────────
  listPartners(): Observable<{ partners: Partner[] }> {
    return this.http.get<{ partners: Partner[] }>(`${BASE}/partners`);
  }
  getPartner(id: number): Observable<{ partner: Partner }> {
    return this.http.get<{ partner: Partner }>(`${BASE}/partners/${id}`);
  }
  createPartner(payload: Partner): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/partners`, payload);
  }
  updatePartner(id: number, payload: Partner): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/partners/${id}`, payload);
  }
  deletePartner(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/partners/${id}`);
  }
  listPartnerContacts(id: number): Observable<{ contacts: PartnerContact[] }> {
    return this.http.get<{ contacts: PartnerContact[] }>(`${BASE}/partners/${id}/contacts`);
  }
  createPartnerContact(id: number, payload: PartnerContact): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/partners/${id}/contacts`, payload);
  }
  updatePartnerContact(id: number, cid: number, payload: PartnerContact): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/partners/${id}/contacts/${cid}`, payload);
  }
  deletePartnerContact(id: number, cid: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/partners/${id}/contacts/${cid}`);
  }
  listPartnerNotes(id: number): Observable<{ notes: PartnerNote[] }> {
    return this.http.get<{ notes: PartnerNote[] }>(`${BASE}/partners/${id}/notes`);
  }
  createPartnerNote(id: number, payload: PartnerNote): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/partners/${id}/notes`, payload);
  }
  updatePartnerNote(id: number, nid: number, payload: PartnerNote): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/partners/${id}/notes/${nid}`, payload);
  }
  deletePartnerNote(id: number, nid: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/partners/${id}/notes/${nid}`);
  }
  listPartnerAccounts(id: number): Observable<{ accounts: PartnerAccount[] }> {
    return this.http.get<{ accounts: PartnerAccount[] }>(`${BASE}/partners/${id}/accounts`);
  }
  createPartnerAccount(id: number, payload: PartnerAccount): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/partners/${id}/accounts`, payload);
  }
  updatePartnerAccount(id: number, aid: number, payload: PartnerAccount): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/partners/${id}/accounts/${aid}`, payload);
  }
  deletePartnerAccount(id: number, aid: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/partners/${id}/accounts/${aid}`);
  }

  // ───── Operations: Contractors ───────────────────────────────────
  listContractors(): Observable<{ contractors: Contractor[] }> {
    return this.http.get<{ contractors: Contractor[] }>(`${BASE}/contractors`);
  }
  getContractor(id: number): Observable<{ contractor: Contractor }> {
    return this.http.get<{ contractor: Contractor }>(`${BASE}/contractors/${id}`);
  }
  createContractor(payload: Contractor): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/contractors`, payload);
  }
  updateContractor(id: number, payload: Contractor): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/contractors/${id}`, payload);
  }
  deleteContractor(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/contractors/${id}`);
  }
  listContractorNotes(id: number): Observable<{ notes: ContractorNote[] }> {
    return this.http.get<{ notes: ContractorNote[] }>(`${BASE}/contractors/${id}/notes`);
  }
  createContractorNote(id: number, payload: ContractorNote): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/contractors/${id}/notes`, payload);
  }
  updateContractorNote(id: number, nid: number, payload: ContractorNote): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/contractors/${id}/notes/${nid}`, payload);
  }
  deleteContractorNote(id: number, nid: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/contractors/${id}/notes/${nid}`);
  }
  enableContractorLogin(id: number, email?: string): Observable<{ ok: boolean; admin_user_id: number; email: string; temp_password: string; onboarding_token: string }> {
    return this.http.post<{ ok: boolean; admin_user_id: number; email: string; temp_password: string; onboarding_token: string }>(
      `${BASE}/contractors/${id}/account/enable`,
      email ? { email } : {},
    );
  }
  disableContractorLogin(id: number): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${BASE}/contractors/${id}/account/disable`, {});
  }
  reactivateContractorLogin(id: number): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${BASE}/contractors/${id}/account/reactivate`, {});
  }
  resetContractorPassword(id: number): Observable<{ ok: boolean; temp_password: string }> {
    return this.http.post<{ ok: boolean; temp_password: string }>(`${BASE}/contractors/${id}/account/reset-password`, {});
  }
  getContractorSecurity(id: number): Observable<{ permissions: ContractorPermissions }> {
    return this.http.get<{ permissions: ContractorPermissions }>(`${BASE}/contractors/${id}/security`);
  }
  updateContractorSecurity(id: number, permissions: ContractorPermissions): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/contractors/${id}/security`, { permissions });
  }
  listContractorClients(id: number): Observable<{ clients: Array<{ link_id: number; role: string | null; added_at: string; client_id: number; client_name: string }> }> {
    return this.http.get<{ clients: Array<{ link_id: number; role: string | null; added_at: string; client_id: number; client_name: string }> }>(`${BASE}/contractors/${id}/clients`);
  }

  // ── Assignments (shared between client + lead detail) ──────────
  listAssignees(): Observable<{ assignees: AssigneeOption[] }> {
    return this.http.get<{ assignees: AssigneeOption[] }>(`${BASE}/assignees`);
  }
  listAssignments(entity: 'client' | 'lead', entityId: number): Observable<{ assignments: AssignmentGroup[] }> {
    return this.http.get<{ assignments: AssignmentGroup[] }>(`${BASE}/${entity}s/${entityId}/assignments`);
  }
  createAssignment(entity: 'client' | 'lead', entityId: number, payload: { role: AssignmentRole; assignee_type: AssigneeType; assignee_id: number; notes?: string | null }): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/${entity}s/${entityId}/assignments`, payload);
  }
  endAssignment(entity: 'client' | 'lead', entityId: number, aid: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/${entity}s/${entityId}/assignments/${aid}`);
  }

  // ── Client -> contractors junction ─────────────────────────────
  listClientContractors(clientId: number): Observable<{ contractors: ClientContractorLink[] }> {
    return this.http.get<{ contractors: ClientContractorLink[] }>(`${BASE}/clients/${clientId}/contractors`);
  }
  attachClientContractor(clientId: number, contractorId: number, role?: string | null): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/clients/${clientId}/contractors`, { contractor_id: contractorId, role });
  }
  updateClientContractor(clientId: number, linkId: number, role: string | null): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/clients/${clientId}/contractors/${linkId}`, { role });
  }
  detachClientContractor(clientId: number, linkId: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/clients/${clientId}/contractors/${linkId}`);
  }

  // ───── Contractor self-service (/api/contractor/me/*) ───────────
  getContractorMe(): Observable<{ contractor: Contractor; permissions: ContractorPermissions; account: { email: string; display_name: string } }> {
    return this.http.get<{ contractor: Contractor; permissions: ContractorPermissions; account: { email: string; display_name: string } }>(`${BASE}/contractor/me`);
  }
  listContractorMeClients(): Observable<{ clients: any[] }> {
    return this.http.get<{ clients: any[] }>(`${BASE}/contractor/me/clients`);
  }
  listContractorMeTasks(): Observable<{ tasks: import('../shared/user-task-tracker').MyTaskRow[] }> {
    return this.http.get<{ tasks: import('../shared/user-task-tracker').MyTaskRow[] }>(`${BASE}/contractor/me/tasks`);
  }
  patchContractorMeCrmTaskStatus(taskId: number, status: string): Observable<{ ok: boolean }> {
    return this.http.patch<{ ok: boolean }>(`${BASE}/contractor/me/tasks/crm/${taskId}`, { status });
  }
  getContractorMeOverview(): Observable<{ overview: any }> {
    return this.http.get<{ overview: any }>(`${BASE}/contractor/me/overview`);
  }
  getHrMeOverview(): Observable<{ overview: any }> {
    return this.http.get<{ overview: any }>(`${BASE}/hr/me/overview`);
  }
  // ── My accounts & commissions (both portals) ────────────────────
  getHrMeCommissions(): Observable<any> {
    return this.http.get<any>(`${BASE}/hr/me/commissions`);
  }
  getContractorMeCommissions(): Observable<any> {
    return this.http.get<any>(`${BASE}/contractor/me/commissions`);
  }
  // Admin CRUD on the client detail Commissions tab.
  listClientCommissions(clientId: number): Observable<{ commissions: any[] }> {
    return this.http.get<{ commissions: any[] }>(`${BASE}/clients/${clientId}/commissions`);
  }
  createClientCommission(clientId: number, payload: any): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/clients/${clientId}/commissions`, payload);
  }
  updateClientCommission(clientId: number, cid: number, payload: any): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/clients/${clientId}/commissions/${cid}`, payload);
  }
  deleteClientCommission(clientId: number, cid: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/clients/${clientId}/commissions/${cid}`);
  }
  listClientCommissionRules(clientId: number): Observable<{ rules: any[] }> {
    return this.http.get<{ rules: any[] }>(`${BASE}/clients/${clientId}/commission-rules`);
  }
  createClientCommissionRule(clientId: number, payload: any): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/clients/${clientId}/commission-rules`, payload);
  }
  updateClientCommissionRule(clientId: number, rid: number, payload: any): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/clients/${clientId}/commission-rules/${rid}`, payload);
  }
  deleteClientCommissionRule(clientId: number, rid: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/clients/${clientId}/commission-rules/${rid}`);
  }
  listHrMeTasks(): Observable<{ tasks: import('../shared/user-task-tracker').MyTaskRow[] }> {
    return this.http.get<{ tasks: import('../shared/user-task-tracker').MyTaskRow[] }>(`${BASE}/hr/me/tasks`);
  }
  patchHrMeCrmTaskStatus(taskId: number, status: string): Observable<{ ok: boolean }> {
    return this.http.patch<{ ok: boolean }>(`${BASE}/hr/me/tasks/crm/${taskId}`, { status });
  }
  updateContractorMe(payload: Partial<Contractor>): Observable<{ ok: boolean }> {
    return this.http.patch<{ ok: boolean }>(`${BASE}/contractor/me`, payload);
  }
  changeContractorMePassword(current: string, next: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${BASE}/contractor/me/password`, { current_password: current, new_password: next });
  }
  listContractorMeContracts(): Observable<{ contracts: any[] }> {
    return this.http.get<{ contracts: any[] }>(`${BASE}/contractor/me/contracts`);
  }
  listContractorMeDocuments(): Observable<{ documents: any[] }> {
    return this.http.get<{ documents: any[] }>(`${BASE}/contractor/me/documents`);
  }

  // ───── Site Previews (marketing site-view.html data) ─────────────
  listSitePreviews(): Observable<{ site_previews: any[] }> {
    return this.http.get<{ site_previews: any[] }>(`${BASE}/site-previews`);
  }
  getSitePreview(slug: string): Observable<{ site_preview: any }> {
    return this.http.get<{ site_preview: any }>(`${BASE}/site-previews/${slug}`);
  }
  createSitePreview(payload: any): Observable<{ id: number; slug: string }> {
    return this.http.post<{ id: number; slug: string }>(`${BASE}/site-previews`, payload);
  }
  updateSitePreview(slug: string, payload: any): Observable<{ ok: boolean; slug: string }> {
    return this.http.put<{ ok: boolean; slug: string }>(`${BASE}/site-previews/${slug}`, payload);
  }
  deleteSitePreview(slug: string): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/site-previews/${slug}`);
  }

  // ───── Lead bookings ─────────────────────────────────────────────
  /** `from`/`to` are YYYY-MM-DD and half-open (from inclusive, to exclusive);
   *  supplying them scopes the fetch to a date range for the calendar view. */
  listLeadBookings(params?: { status?: string; lead_id?: number; from?: string; to?: string }): Observable<{ bookings: any[] }> {
    let hp = new HttpParams();
    if (params?.status) hp = hp.set('status', params.status);
    if (params?.lead_id != null) hp = hp.set('lead_id', String(params.lead_id));
    if (params?.from) hp = hp.set('from', params.from);
    if (params?.to)   hp = hp.set('to',   params.to);
    return this.http.get<{ bookings: any[] }>(`${BASE}/lead-bookings`, { params: hp });
  }
  getLeadBooking(id: number): Observable<{ booking: any }> {
    return this.http.get<{ booking: any }>(`${BASE}/lead-bookings/${id}`);
  }
  createLeadBooking(payload: any): Observable<{ id: number; lead_id: number }> {
    return this.http.post<{ id: number; lead_id: number }>(`${BASE}/lead-bookings`, payload);
  }
  searchLeadBookingPeople(q: string): Observable<{ people: Array<{ type: 'lead' | 'contact'; id: number; name: string; company: string | null; email: string | null; phone: string | null }> }> {
    return this.http.get<any>(`${BASE}/lead-bookings/people`, { params: new HttpParams().set('q', q) });
  }
  updateLeadBooking(id: number, payload: any): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/lead-bookings/${id}`, payload);
  }
  deleteLeadBooking(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/lead-bookings/${id}`);
  }
  resendLeadBookingNotifications(id: number): Observable<{ ok: boolean; message: string }> {
    return this.http.post<{ ok: boolean; message: string }>(`${BASE}/lead-bookings/${id}/resend`, {});
  }
  getLeadBookingRecipientOptions(): Observable<{ people: Array<{ email: string; display_name: string }>; defaults: string[] }> {
    return this.http.get<{ people: Array<{ email: string; display_name: string }>; defaults: string[] }>(`${BASE}/lead-bookings/recipient-options`);
  }

  // ───── Operations: Affiliates ────────────────────────────────────
  listAffiliates(): Observable<{ affiliates: Affiliate[] }> {
    return this.http.get<{ affiliates: Affiliate[] }>(`${BASE}/affiliates`);
  }
  getAffiliate(id: number): Observable<{ affiliate: Affiliate }> {
    return this.http.get<{ affiliate: Affiliate }>(`${BASE}/affiliates/${id}`);
  }
  createAffiliate(payload: Affiliate): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/affiliates`, payload);
  }
  updateAffiliate(id: number, payload: Affiliate): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/affiliates/${id}`, payload);
  }
  deleteAffiliate(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/affiliates/${id}`);
  }
  listAffiliateNotes(id: number): Observable<{ notes: AffiliateNote[] }> {
    return this.http.get<{ notes: AffiliateNote[] }>(`${BASE}/affiliates/${id}/notes`);
  }
  createAffiliateNote(id: number, payload: AffiliateNote): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/affiliates/${id}/notes`, payload);
  }
  updateAffiliateNote(id: number, nid: number, payload: AffiliateNote): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/affiliates/${id}/notes/${nid}`, payload);
  }
  deleteAffiliateNote(id: number, nid: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/affiliates/${id}/notes/${nid}`);
  }

  listTenderNotes(tenderId: number): Observable<{ notes: TenderNote[] }> {
    return this.http.get<{ notes: TenderNote[] }>(`${BASE}/tenders/${tenderId}/notes`);
  }
  createTenderNote(tenderId: number, payload: TenderNote): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/tenders/${tenderId}/notes`, payload);
  }
  updateTenderNote(tenderId: number, noteId: number, payload: TenderNote): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/tenders/${tenderId}/notes/${noteId}`, payload);
  }
  deleteTenderNote(tenderId: number, noteId: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/tenders/${tenderId}/notes/${noteId}`);
  }
  updateLead(id: number, payload: Lead): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/leads/${id}`, payload);
  }
  deleteLead(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/leads/${id}`);
  }
  promoteLead(id: number): Observable<{ ok: boolean; client_id: number; already?: boolean }> {
    return this.http.post<{ ok: boolean; client_id: number; already?: boolean }>(
      `${BASE}/leads/${id}/promote`, {}
    );
  }
  listLeadNotes(leadId: number): Observable<{ notes: LeadNote[] }> {
    return this.http.get<{ notes: LeadNote[] }>(`${BASE}/leads/${leadId}/notes`);
  }
  createLeadNote(leadId: number, payload: LeadNote): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/leads/${leadId}/notes`, payload);
  }
  updateLeadNote(leadId: number, noteId: number, payload: LeadNote): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/leads/${leadId}/notes/${noteId}`, payload);
  }
  deleteLeadNote(leadId: number, noteId: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/leads/${leadId}/notes/${noteId}`);
  }
  listLeadInfo(leadId: number): Observable<{ info: LeadInfo[] }> {
    return this.http.get<{ info: LeadInfo[] }>(`${BASE}/leads/${leadId}/info`);
  }
  createLeadInfo(leadId: number, payload: LeadInfo): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/leads/${leadId}/info`, payload);
  }
  updateLeadInfo(leadId: number, infoId: number, payload: LeadInfo): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/leads/${leadId}/info/${infoId}`, payload);
  }
  deleteLeadInfo(leadId: number, infoId: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/leads/${leadId}/info/${infoId}`);
  }

  // lead → services (junction via migration 111). Returned rows carry a
  // flat `service_offering_id` + the joined catalogue `name`/`price` so
  // the badge list can render without a second round-trip.
  listLeadServices(leadId: number): Observable<{ services: LeadServiceLink[] }> {
    return this.http.get<{ services: LeadServiceLink[] }>(`${BASE}/leads/${leadId}/services`);
  }
  addLeadService(
    leadId: number,
    serviceOfferingId: number,
    opts?: { price?: number | null; payment_type?: 'one_off' | 'recurring'; repeat_duration?: string | null },
  ): Observable<{ id: number; service_offering_id: number }> {
    const body: any = { service_offering_id: serviceOfferingId };
    if (opts?.price !== undefined && opts?.price !== null && !Number.isNaN(opts.price)) {
      body.price = opts.price;
    }
    if (opts?.payment_type) body.payment_type = opts.payment_type;
    if (opts?.repeat_duration) body.repeat_duration = opts.repeat_duration;
    return this.http.post<{ id: number; service_offering_id: number }>(
      `${BASE}/leads/${leadId}/services`, body
    );
  }
  removeLeadService(leadId: number, linkId: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/leads/${leadId}/services/${linkId}`);
  }

  // taskboard
  listTaskTeams(): Observable<{ teams: TaskTeam[] }> {
    return this.http.get<{ teams: TaskTeam[] }>(`${BASE}/tasks/teams`);
  }
  /** Qualified onboarding entries (services) the user can link a project to.
   *  Each entry includes form pricing/terms + canonical-client match + an
   *  indicator if it's already linked to another project. */
  listServicesPool(): Observable<{ services: ServicePoolEntry[] }> {
    return this.http.get<{ services: ServicePoolEntry[] }>(`${BASE}/tasks/services-pool`);
  }
  createTaskTeam(p: TaskTeam): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/tasks/teams`, p);
  }
  updateTaskTeam(id: number, p: TaskTeam): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/tasks/teams/${id}`, p);
  }
  deleteTaskTeam(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/tasks/teams/${id}`);
  }
  /** Roster management for a team (057). */
  listTaskTeamMembers(teamId: number): Observable<{ members: TaskTeamMember[] }> {
    return this.http.get<{ members: TaskTeamMember[] }>(`${BASE}/tasks/teams/${teamId}/members`);
  }
  addTaskTeamMember(teamId: number, userId: number): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${BASE}/tasks/teams/${teamId}/members`, { user_id: userId });
  }
  removeTaskTeamMember(teamId: number, userId: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/tasks/teams/${teamId}/members/${userId}`);
  }

  listTaskProjects(teamId?: number): Observable<{ projects: TaskProject[] }> {
    const q = teamId ? `?team_id=${teamId}` : '';
    return this.http.get<{ projects: TaskProject[] }>(`${BASE}/tasks/projects${q}`);
  }
  getTaskProject(id: number): Observable<{ project: TaskProject }> {
    return this.http.get<{ project: TaskProject }>(`${BASE}/tasks/projects/${id}`);
  }
  createTaskProject(p: TaskProject): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/tasks/projects`, p);
  }
  updateTaskProject(id: number, p: TaskProject): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/tasks/projects/${id}`, p);
  }
  deleteTaskProject(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/tasks/projects/${id}`);
  }

  listTaskTypes(): Observable<{ types: TaskItemType[] }> {
    return this.http.get<{ types: TaskItemType[] }>(`${BASE}/tasks/types`);
  }
  createTaskType(p: TaskItemType): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/tasks/types`, p);
  }
  updateTaskType(id: number, p: TaskItemType): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/tasks/types/${id}`, p);
  }
  deleteTaskType(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/tasks/types/${id}`);
  }

  listTaskStates(): Observable<{ states: TaskItemState[] }> {
    return this.http.get<{ states: TaskItemState[] }>(`${BASE}/tasks/states`);
  }
  createTaskState(p: TaskItemState): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/tasks/states`, p);
  }
  updateTaskState(id: number, p: TaskItemState): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/tasks/states/${id}`, p);
  }
  deleteTaskState(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/tasks/states/${id}`);
  }

  listTaskItems(opts?: { project_id?: number; iteration_id?: number | null }): Observable<{ items: TaskItem[] }> {
    const params: string[] = [];
    if (opts?.project_id) params.push(`project_id=${opts.project_id}`);
    if (opts?.iteration_id !== undefined) params.push(`iteration_id=${opts.iteration_id ?? 'null'}`);
    const q = params.length ? '?' + params.join('&') : '';
    return this.http.get<{ items: TaskItem[] }>(`${BASE}/tasks/items${q}`);
  }
  getTaskItem(id: number): Observable<{ item: TaskItem }> {
    return this.http.get<{ item: TaskItem }>(`${BASE}/tasks/items/${id}`);
  }
  createTaskItem(p: TaskItem): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/tasks/items`, p);
  }
  updateTaskItem(id: number, p: Partial<TaskItem>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/tasks/items/${id}`, p);
  }
  deleteTaskItem(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/tasks/items/${id}`);
  }

  listTaskIterations(projectId?: number): Observable<{ iterations: TaskIteration[] }> {
    const q = projectId ? `?project_id=${projectId}` : '';
    return this.http.get<{ iterations: TaskIteration[] }>(`${BASE}/tasks/iterations${q}`);
  }
  createTaskIteration(p: TaskIteration): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/tasks/iterations`, p);
  }
  updateTaskIteration(id: number, p: Partial<TaskIteration>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/tasks/iterations/${id}`, p);
  }
  deleteTaskIteration(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/tasks/iterations/${id}`);
  }

  // users (admin team management)
  listAdminUsers(): Observable<{ users: AdminUserRecord[] }> {
    return this.http.get<{ users: AdminUserRecord[] }>(`${BASE}/users`);
  }
  createAdminUser(p: AdminUserRecord): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/users`, p);
  }
  updateAdminUser(id: number, p: AdminUserRecord): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/users/${id}`, p);
  }
  deleteAdminUser(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/users/${id}`);
  }
  deactivateAdminUser(id: number): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${BASE}/users/${id}/deactivate`, {});
  }
  reinstateAdminUser(id: number): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${BASE}/users/${id}/reinstate`, {});
  }
  getUsersSubscription(): Observable<UsersSubscription> {
    return this.http.get<UsersSubscription>(`${BASE}/users/subscription`);
  }
  updateUsersSubscription(tier: SubscriptionTier): Observable<{ ok: boolean; tier: SubscriptionTier }> {
    return this.http.put<{ ok: boolean; tier: SubscriptionTier }>(`${BASE}/users/subscription`, { tier });
  }

  // ─── Billing (migration 129/130) ─────────────────────────────
  getBillingSummary(): Observable<BillingSummary> {
    return this.http.get<BillingSummary>(`${BASE}/billing`);
  }
  updateBillingProfile(p: Partial<BillingProfile>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/billing/profile`, p);
  }
  createPaymentMethod(p: Partial<PaymentMethod>): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/billing/payment-methods`, p);
  }
  updatePaymentMethod(id: number, p: Partial<PaymentMethod>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/billing/payment-methods/${id}`, p);
  }
  makePaymentMethodDefault(id: number): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${BASE}/billing/payment-methods/${id}/default`, {});
  }
  deletePaymentMethod(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/billing/payment-methods/${id}`);
  }
  listSubscriptionInvoices(): Observable<{ invoices: SubscriptionInvoice[] }> {
    return this.http.get<{ invoices: SubscriptionInvoice[] }>(`${BASE}/billing/invoices`);
  }

  // ─── Stripe ──────────────────────────────────────────────────
  getStripeConfig(): Observable<StripeConfig> {
    return this.http.get<StripeConfig>(`${BASE}/billing/stripe/config`);
  }
  createStripeSetupIntent(types: string[] = ['card']): Observable<StripeSetupIntent> {
    return this.http.post<StripeSetupIntent>(`${BASE}/billing/stripe/setup-intent`, { payment_method_types: types });
  }
  syncStripePaymentMethod(pm_id: string, make_default: boolean): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${BASE}/billing/stripe/sync-payment-method`,
      { payment_method_id: pm_id, make_default });
  }
  stripeSubscribe(tier: SubscriptionTier, cadence: 'monthly' | 'yearly' = 'monthly'): Observable<StripeSubscribeResult | { deferred: true; effective_at: string; message: string }> {
    return this.http.post<StripeSubscribeResult | { deferred: true; effective_at: string; message: string }>(`${BASE}/billing/stripe/subscribe`, { tier, cadence });
  }

  listPlans(): Observable<{ plans: SubscriptionPlan[] }> {
    return this.http.get<{ plans: SubscriptionPlan[] }>(`${BASE}/billing/plans`);
  }
  updatePlan(id: number, patch: Partial<SubscriptionPlan> & { features?: string[] }): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/billing/plans/${id}`, patch);
  }
  stripeCancel(): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${BASE}/billing/stripe/cancel`, {});
  }
  stripeCancelPending(): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${BASE}/billing/stripe/cancel-pending`, {});
  }
  stripePortal(): Observable<{ url: string }> {
    return this.http.post<{ url: string }>(`${BASE}/billing/stripe/portal`, {});
  }

  // ─── Form submission linkage ─────────────────────────────
  listFormSubmissionsFor(type: 'client' | 'lead' | 'service', id: number): Observable<{ groups: FormSubmissionLinkGroup[] }> {
    return this.http.get<{ groups: FormSubmissionLinkGroup[] }>(`${BASE}/form-submission-links/for/${type}/${id}`);
  }
  attachFormSubmission(payload: {
    form_id: number;
    submission_id: number;
    client_id?: number;
    lead_id?: number;
    service_offering_id?: number;
  }): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/form-submission-links`, payload);
  }
  listAttachCandidates(excludeType: 'client'|'lead'|'service', excludeId: number): Observable<{ forms: FormSubmissionCandidateGroup[] }> {
    return this.http.get<{ forms: FormSubmissionCandidateGroup[] }>(
      `${BASE}/form-submission-links/candidates?exclude_type=${excludeType}&exclude_id=${excludeId}`
    );
  }

  // ─── Form invitations (client/lead + token URLs) ─────────────
  listFormInvites(formId: number): Observable<{ invites: FormInvite[] }> {
    return this.http.get<{ invites: FormInvite[] }>(`${BASE}/forms/${formId}/invites`);
  }
  createFormInvite(formId: number, payload: {
    parent_client_id?: number;
    parent_lead_id?:   number;
    client_email?:     string;
    client_name?:      string;
  }): Observable<{ id: number; token: string; url: string }> {
    return this.http.post<{ id: number; token: string; url: string }>(
      `${BASE}/forms/${formId}/invites`, payload,
    );
  }
  deleteFormInvite(formId: number, inviteId: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/forms/${formId}/invites/${inviteId}`);
  }
  detachFormSubmission(id: number, force = false): Observable<{ ok: boolean }> {
    const url = `${BASE}/form-submission-links/${id}` + (force ? '?force=1' : '');
    return this.http.delete<{ ok: boolean }>(url);
  }

  // ====================================================================
  // HR
  // ====================================================================

  listHrEmployees(): Observable<{ employees: HrEmployee[] }> {
    return this.http.get<{ employees: HrEmployee[] }>(`${BASE}/hr/employees`);
  }
  getHrEmployee(id: number): Observable<{ employee: HrEmployee }> {
    return this.http.get<{ employee: HrEmployee }>(`${BASE}/hr/employees/${id}`);
  }
  createHrEmployee(p: HrEmployee & { email?: string; role?: string }): Observable<{ id: number; admin_user_id: number; temp_password?: string }> {
    return this.http.post<{ id: number; admin_user_id: number; temp_password?: string }>(`${BASE}/hr/employees`, p);
  }
  updateHrEmployee(id: number, p: Partial<HrEmployee>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/hr/employees/${id}`, p);
  }
  deleteHrEmployee(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/hr/employees/${id}`);
  }

  listHrOnboarding(employeeId: number): Observable<{ tasks: HrOnboardingTask[] }> {
    return this.http.get<{ tasks: HrOnboardingTask[] }>(`${BASE}/hr/employees/${employeeId}/onboarding`);
  }
  createHrOnboarding(employeeId: number, p: HrOnboardingTask): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/hr/employees/${employeeId}/onboarding`, p);
  }
  updateHrOnboarding(employeeId: number, taskId: number, p: Partial<HrOnboardingTask>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/hr/employees/${employeeId}/onboarding/${taskId}`, p);
  }
  deleteHrOnboarding(employeeId: number, taskId: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/hr/employees/${employeeId}/onboarding/${taskId}`);
  }

  listHrDocuments(employeeId: number): Observable<{ documents: HrDocument[] }> {
    return this.http.get<{ documents: HrDocument[] }>(`${BASE}/hr/employees/${employeeId}/documents`);
  }
  /** Org-wide documents in one round-trip (collapses the per-employee N+1
   *  on `/hr/documents`). Backend returns `{ employee_id → HrDocument[] }`. */
  listAllHrDocuments(): Observable<{ documents_by_employee: Record<string, HrDocument[]> }> {
    return this.http.get<{ documents_by_employee: Record<string, HrDocument[]> }>(`${BASE}/hr/all-documents`);
  }
  /** Org-wide onboarding tasks in one round-trip (collapses the N+1 on
   *  `/hr/onboarding`). Backend returns `{ employee_id → HrOnboardingTask[] }`. */
  listAllHrOnboarding(): Observable<{ tasks_by_employee: Record<string, HrOnboardingTask[]> }> {
    return this.http.get<{ tasks_by_employee: Record<string, HrOnboardingTask[]> }>(`${BASE}/hr/all-onboarding`);
  }
  uploadHrDocument(employeeId: number, file: File, title: string, category: string, requiresSignature = false, docTypeId?: number | null): Observable<{ id: number }> {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('title', title);
    fd.append('category', category);
    if (requiresSignature) fd.append('requires_signature', '1');
    if (docTypeId)         fd.append('doc_type_id', String(docTypeId));
    return this.http.post<{ id: number }>(`${BASE}/hr/employees/${employeeId}/documents`, fd);
  }
  deleteHrDocument(employeeId: number, docId: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/hr/employees/${employeeId}/documents/${docId}`);
  }

  listHrPayrollPeriods(): Observable<{ periods: HrPayrollPeriod[] }> {
    return this.http.get<{ periods: HrPayrollPeriod[] }>(`${BASE}/hr/payroll/periods`);
  }
  createHrPayrollPeriod(p: HrPayrollPeriod): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/hr/payroll/periods`, p);
  }
  updateHrPayrollPeriod(id: number, p: Partial<HrPayrollPeriod>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/hr/payroll/periods/${id}`, p);
  }
  deleteHrPayrollPeriod(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/hr/payroll/periods/${id}`);
  }
  exportHrPayrollCsv(periodId: number): Observable<Blob> {
    return this.http.get(`${BASE}/hr/payroll/periods/${periodId}/export.csv`, { responseType: 'blob' });
  }
  getHrPayrollYtd(employeeId: number, periodId: number): Observable<{
    tax_year_start: string;
    taxable_gross: number;
    income_tax: number;
    employee_nic: number;
    employer_nic: number;
    other_deductions: number;
    pension_employee: number;
    pension_employer: number;
    total_payments: number;
    total_deductions: number;
    net_pay: number;
  }> {
    return this.http.get<any>(`${BASE}/hr/payroll/ytd?employee_id=${employeeId}&period_id=${periodId}`);
  }
  listHrPayslips(periodId: number): Observable<{ payslips: HrPayslip[] }> {
    return this.http.get<{ payslips: HrPayslip[] }>(`${BASE}/hr/payroll/periods/${periodId}/payslips`);
  }
  upsertHrPayslip(periodId: number, p: HrPayslip): Observable<{ ok: boolean; net_amount: number }> {
    return this.http.post<{ ok: boolean; net_amount: number }>(`${BASE}/hr/payroll/periods/${periodId}/payslips`, p);
  }
  updateHrPayslip(periodId: number, slipId: number, p: Partial<HrPayslip>): Observable<{ ok: boolean; net_amount: number }> {
    return this.http.put<{ ok: boolean; net_amount: number }>(`${BASE}/hr/payroll/periods/${periodId}/payslips/${slipId}`, p);
  }
  deleteHrPayslip(periodId: number, slipId: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/hr/payroll/periods/${periodId}/payslips/${slipId}`);
  }

  listHrTimeOff(status?: string, employeeId?: number): Observable<{ entries: HrTimeOffEntry[] }> {
    const p: string[] = [];
    if (status)     p.push(`status=${encodeURIComponent(status)}`);
    if (employeeId) p.push(`employee_id=${employeeId}`);
    const q = p.length ? '?' + p.join('&') : '';
    return this.http.get<{ entries: HrTimeOffEntry[] }>(`${BASE}/hr/time-off${q}`);
  }
  createHrTimeOff(p: HrTimeOffEntry): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/hr/time-off`, p);
  }
  updateHrTimeOff(id: number, p: Partial<HrTimeOffEntry>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/hr/time-off/${id}`, p);
  }
  deleteHrTimeOff(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/hr/time-off/${id}`);
  }

  // PTO ledger
  getHrPto(employeeId: number): Observable<HrPtoSummary> {
    return this.http.get<HrPtoSummary>(`${BASE}/hr/employees/${employeeId}/pto`);
  }
  accrueHrPto(employeeId: number, days?: number): Observable<{ ok: boolean; days: number }> {
    return this.http.post<{ ok: boolean; days: number }>(`${BASE}/hr/employees/${employeeId}/pto/accrue`, days != null ? { days } : {});
  }
  adjustHrPto(employeeId: number, days: number, notes?: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${BASE}/hr/employees/${employeeId}/pto/adjust`, { days, notes });
  }

  // Performance reviews
  listHrReviewCycles(): Observable<{ cycles: HrReviewCycle[] }> {
    return this.http.get<{ cycles: HrReviewCycle[] }>(`${BASE}/hr/reviews/cycles`);
  }
  createHrReviewCycle(p: HrReviewCycle): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/hr/reviews/cycles`, p);
  }
  updateHrReviewCycle(id: number, p: Partial<HrReviewCycle>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/hr/reviews/cycles/${id}`, p);
  }
  deleteHrReviewCycle(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/hr/reviews/cycles/${id}`);
  }
  seedHrReviewCycle(id: number): Observable<{ ok: boolean; created: number }> {
    return this.http.post<{ ok: boolean; created: number }>(`${BASE}/hr/reviews/cycles/${id}/seed`, {});
  }
  listHrReviews(opts?: { cycle_id?: number; employee_id?: number; status?: string }): Observable<{ reviews: HrReview[] }> {
    const params: string[] = [];
    if (opts?.cycle_id)    params.push(`cycle_id=${opts.cycle_id}`);
    if (opts?.employee_id) params.push(`employee_id=${opts.employee_id}`);
    if (opts?.status)      params.push(`status=${encodeURIComponent(opts.status)}`);
    const q = params.length ? '?' + params.join('&') : '';
    return this.http.get<{ reviews: HrReview[] }>(`${BASE}/hr/reviews${q}`);
  }
  getHrReview(id: number): Observable<{ review: HrReview }> {
    return this.http.get<{ review: HrReview }>(`${BASE}/hr/reviews/${id}`);
  }
  updateHrReview(id: number, p: { responses?: HrReviewResponses; overall?: number; goals_next_period?: string; sign?: boolean; manager_id?: number }): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/hr/reviews/${id}`, p);
  }
  deleteHrReview(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/hr/reviews/${id}`);
  }
  // Self-service review-respond (employee fills self-review on /hr/me)
  submitHrMyReviewResponse(reviewId: number, p: { responses?: HrReviewResponses; overall?: number; sign?: boolean }): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${BASE}/hr/me/review-respond/${reviewId}`, p);
  }
  listHrMyReviews(): Observable<{ reviews: HrReview[] }> {
    return this.http.get<{ reviews: HrReview[] }>(`${BASE}/hr/me/reviews`);
  }

  // ───── Manager-Self-Service (MSS) ─────
  listMyTeam(): Observable<{ team: HrEmployee[] }> {
    return this.http.get<{ team: HrEmployee[] }>(`${BASE}/hr/me/team`);
  }
  listMyTeamTimeOff(status?: string): Observable<{ entries: HrTimeOffEntry[] }> {
    const q = status ? `?status=${encodeURIComponent(status)}` : '';
    return this.http.get<{ entries: HrTimeOffEntry[] }>(`${BASE}/hr/me/team-time-off${q}`);
  }
  decideMyTeamTimeOff(requestId: number, status: 'approved' | 'denied' | 'cancelled'): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${BASE}/hr/me/team-time-off-action/${requestId}`, { status });
  }
  listMyTeamReviews(): Observable<{ reviews: HrReview[] }> {
    return this.http.get<{ reviews: HrReview[] }>(`${BASE}/hr/me/team-reviews`);
  }
  listMyTeamLearning(status?: string): Observable<{ assignments: HrCourseAssignment[] }> {
    const q = status ? `?status=${encodeURIComponent(status)}` : '';
    return this.http.get<{ assignments: HrCourseAssignment[] }>(`${BASE}/hr/me/team-learning${q}`);
  }
  listMyTeamCertifications(): Observable<{ certifications: HrCertification[] }> {
    return this.http.get<{ certifications: HrCertification[] }>(`${BASE}/hr/me/team-certifications`);
  }

  // Hiring (manager-scoped)
  listMyTeamHiring(): Observable<{ jobs: HrJob[]; applications: HrApplication[] }> {
    return this.http.get<{ jobs: HrJob[]; applications: HrApplication[] }>(`${BASE}/hr/me/team-hiring`);
  }
  addMyTeamHiringFeedback(applicationId: number, p: { kind?: string; feedback: string; rating?: number }): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/hr/me/team-hiring-feedback/${applicationId}`, p);
  }
  setMyTeamApplicationStage(applicationId: number, stage: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${BASE}/hr/me/team-hiring-stage/${applicationId}`, { stage });
  }

  // Succession (manager-scoped)
  listMyTeamSuccession(): Observable<{ plans: HrSuccessionPlan[] }> {
    return this.http.get<{ plans: HrSuccessionPlan[] }>(`${BASE}/hr/me/team-succession`);
  }

  // Shifts
  listMyShifts(): Observable<{ shifts: HrShift[] }> {
    return this.http.get<{ shifts: HrShift[] }>(`${BASE}/hr/me/shifts`);
  }
  listMyTeamShifts(from?: string, to?: string): Observable<{ shifts: HrShift[] }> {
    const params: string[] = [];
    if (from) params.push('from=' + encodeURIComponent(from));
    if (to)   params.push('to='   + encodeURIComponent(to));
    const q = params.length ? '?' + params.join('&') : '';
    return this.http.get<{ shifts: HrShift[] }>(`${BASE}/hr/me/team-shifts${q}`);
  }
  createTeamShift(p: Partial<HrShift>): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/hr/me/team-shifts`, p);
  }
  updateTeamShift(id: number, p: Partial<HrShift>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/hr/me/team-shifts/${id}`, p);
  }
  deleteTeamShift(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/hr/me/team-shifts/${id}`);
  }

  // Goals (self)
  listMyGoals(): Observable<{ goals: HrGoal[] }> {
    return this.http.get<{ goals: HrGoal[] }>(`${BASE}/hr/me/goals`);
  }
  createMyGoal(p: Partial<HrGoal>): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/hr/me/goals`, p);
  }
  updateMyGoal(id: number, p: Partial<HrGoal>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/hr/me/goals/${id}`, p);
  }
  deleteMyGoal(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/hr/me/goals/${id}`);
  }
  // Goals (manager)
  listMyTeamGoals(): Observable<{ goals: HrGoal[] }> {
    return this.http.get<{ goals: HrGoal[] }>(`${BASE}/hr/me/team-goals`);
  }
  createTeamGoal(employeeId: number, p: Partial<HrGoal>): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/hr/me/team-goals/${employeeId}`, p);
  }
  updateTeamGoal(goalId: number, p: Partial<HrGoal>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/hr/me/team-goals/${goalId}`, p);
  }
  deleteTeamGoal(goalId: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/hr/me/team-goals/${goalId}`);
  }

  // Skills
  listHrSkills(): Observable<{ skills: HrSkill[] }> {
    return this.http.get<{ skills: HrSkill[] }>(`${BASE}/hr/me/skills`);
  }
  createHrSkill(p: Partial<HrSkill>): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/hr/me/skills`, p);
  }
  deleteHrSkill(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/hr/me/skills/${id}`);
  }
  /** Read-only list of my own skill assessments. Both employee and manager can write. */
  listMyOwnSkills(): Observable<{ rows: HrEmployeeSkill[] }> {
    return this.http.get<{ rows: HrEmployeeSkill[] }>(`${BASE}/hr/me/my-skills`);
  }
  /**
   * Self-service upsert of one of my skill rows. Pass either `skill_id` (an
   * existing catalog row) OR `skill_name` (free-form; backend looks it up
   * case-insensitively and auto-creates the catalog row if needed).
   */
  upsertMyOwnSkill(p: {
    skill_id?: number;
    skill_name?: string;
    category?: string;
    current_level: number;
    target_level: number;
    notes?: string;
  }): Observable<{ ok: boolean; skill_id?: number }> {
    return this.http.post<{ ok: boolean; skill_id?: number }>(`${BASE}/hr/me/my-skills`, p);
  }
  /** Remove one of my own skill rows. */
  deleteMyOwnSkill(skillId: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/hr/me/my-skills/${skillId}`);
  }
  listMyTeamSkills(): Observable<{ rows: HrEmployeeSkill[] }> {
    return this.http.get<{ rows: HrEmployeeSkill[] }>(`${BASE}/hr/me/team-skills`);
  }
  upsertEmployeeSkill(employeeId: number, p: { skill_id: number; current_level: number; target_level: number; notes?: string }): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${BASE}/hr/me/team-skills/${employeeId}`, p);
  }
  removeEmployeeSkill(employeeId: number, skillId: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/hr/me/team-skills/${employeeId}/${skillId}`);
  }

  // Feedback / 1:1 notes
  listFeedbackNotes(employeeId: number): Observable<{ notes: HrFeedbackNote[] }> {
    return this.http.get<{ notes: HrFeedbackNote[] }>(`${BASE}/hr/me/feedback-notes?employee_id=${employeeId}`);
  }
  addFeedbackNote(employeeId: number, p: Partial<HrFeedbackNote>): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/hr/me/feedback-notes/${employeeId}`, p);
  }
  deleteFeedbackNote(noteId: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/hr/me/feedback-notes/${noteId}`);
  }

  // Learning & development
  listHrCourses(): Observable<{ courses: HrCourse[] }> {
    return this.http.get<{ courses: HrCourse[] }>(`${BASE}/hr/courses`);
  }
  getHrCourse(id: number): Observable<{ course: HrCourse }> {
    return this.http.get<{ course: HrCourse }>(`${BASE}/hr/courses/${id}`);
  }
  createHrCourse(p: HrCourse): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/hr/courses`, p);
  }
  updateHrCourse(id: number, p: Partial<HrCourse>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/hr/courses/${id}`, p);
  }
  deleteHrCourse(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/hr/courses/${id}`);
  }
  listHrCourseAssignments(courseId: number): Observable<{ assignments: HrCourseAssignment[] }> {
    return this.http.get<{ assignments: HrCourseAssignment[] }>(`${BASE}/hr/courses/${courseId}/assignments`);
  }
  assignHrCourse(courseId: number, employeeIds: number[], dueDate?: string, scope: 'individual'|'department'|'company' = 'individual', scopeValue?: string): Observable<{ ok: boolean; created: number }> {
    return this.http.post<{ ok: boolean; created: number }>(`${BASE}/hr/courses/${courseId}/assign`, {
      employee_ids: employeeIds, due_date: dueDate || null,
      scope, scope_value: scopeValue || null,
    });
  }
  unassignHrCourseScope(courseId: number, scope: 'department'|'company', scopeValue?: string): Observable<{ ok: boolean; removed: number }> {
    return this.http.post<{ ok: boolean; removed: number }>(`${BASE}/hr/courses/${courseId}/unassign-scope`, {
      scope, scope_value: scopeValue || null,
    });
  }
  listEmployeeNotes(employeeId: number): Observable<{ notes: HrEmployeeNote[] }> {
    return this.http.get<{ notes: HrEmployeeNote[] }>(`${BASE}/hr/employees/${employeeId}/notes`);
  }
  addEmployeeNote(employeeId: number, body: string): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/hr/employees/${employeeId}/notes`, { body });
  }
  deleteEmployeeNote(employeeId: number, noteId: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/hr/employees/${employeeId}/notes/${noteId}`);
  }
  listEmpHrLearning(employeeId: number): Observable<{ assignments: HrCourseAssignment[] }> {
    return this.http.get<{ assignments: HrCourseAssignment[] }>(`${BASE}/hr/employees/${employeeId}/learning`);
  }
  // Course module authoring (admin)
  listHrCourseModules(courseId: number): Observable<{ modules: HrCourseModule[] }> {
    return this.http.get<{ modules: HrCourseModule[] }>(`${BASE}/hr/courses/${courseId}/modules`);
  }
  createHrCourseModule(courseId: number, p: Partial<HrCourseModule> & { quiz?: any[] }): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/hr/courses/${courseId}/modules`, p);
  }
  updateHrCourseModule(courseId: number, moduleId: number, p: Partial<HrCourseModule> & { quiz?: any[] }): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/hr/courses/${courseId}/modules/${moduleId}`, p);
  }
  deleteHrCourseModule(courseId: number, moduleId: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/hr/courses/${courseId}/modules/${moduleId}`);
  }
  uploadHrCourseSlideImage(courseId: number, moduleId: number, file: File): Observable<{ url: string }> {
    const fd = new FormData();
    fd.append('file', file);
    return this.http.post<{ url: string }>(`${BASE}/hr/courses/${courseId}/modules/${moduleId}/upload-image`, fd);
  }
  uploadHrCourseModuleImage(courseId: number, moduleId: number, file: File, position: 'above' | 'below', alt?: string): Observable<{ ok: boolean; images: any[] }> {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('position', position);
    if (alt) fd.append('alt', alt);
    return this.http.post<{ ok: boolean; images: any[] }>(`${BASE}/hr/courses/${courseId}/modules/${moduleId}/images`, fd);
  }
  deleteHrCourseModuleImage(courseId: number, moduleId: number, idx: number): Observable<{ ok: boolean; images: any[] }> {
    return this.http.delete<{ ok: boolean; images: any[] }>(`${BASE}/hr/courses/${courseId}/modules/${moduleId}/images/${idx}`);
  }
  // Course player (employee, authenticated)
  getMyCourseDetail(assignmentId: number): Observable<HrCoursePlayerSnapshot> {
    return this.http.get<HrCoursePlayerSnapshot>(`${BASE}/hr/me/course-detail/${assignmentId}`);
  }
  completeMyCourseModule(assignmentId: number, moduleId: number): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${BASE}/hr/me/course-module-complete/${assignmentId}/${moduleId}`, {});
  }
  submitMyCourseQuiz(assignmentId: number, moduleId: number, answers: Record<string, number[]>): Observable<HrQuizResult> {
    return this.http.post<HrQuizResult>(`${BASE}/hr/me/course-module-quiz/${assignmentId}/${moduleId}`, { answers });
  }
  // Course player (public onboarding portal, token-gated)
  getOnboardingCourseDetail(token: string, assignmentId: number): Observable<HrCoursePlayerSnapshot> {
    return this.http.get<HrCoursePlayerSnapshot>(`${BASE}/public-hr-onboarding/${token}/course-detail/${assignmentId}`);
  }
  completeOnboardingCourseModule(token: string, assignmentId: number, moduleId: number): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${BASE}/public-hr-onboarding/${token}/course-module-complete/${assignmentId}/${moduleId}`, {});
  }
  submitOnboardingCourseQuiz(token: string, assignmentId: number, moduleId: number, answers: Record<string, number[]>): Observable<HrQuizResult> {
    return this.http.post<HrQuizResult>(`${BASE}/public-hr-onboarding/${token}/course-module-quiz/${assignmentId}/${moduleId}`, { answers });
  }
  updateEmpHrLearning(employeeId: number, assignmentId: number, p: Partial<HrCourseAssignment>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/hr/employees/${employeeId}/learning/${assignmentId}`, p);
  }
  deleteEmpHrLearning(employeeId: number, assignmentId: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/hr/employees/${employeeId}/learning/${assignmentId}`);
  }
  listEmpHrCertifications(employeeId: number): Observable<{ certifications: HrCertification[] }> {
    return this.http.get<{ certifications: HrCertification[] }>(`${BASE}/hr/employees/${employeeId}/certifications`);
  }
  createEmpHrCertification(employeeId: number, p: HrCertification, file?: File | null): Observable<{ id: number; file_path?: string }> {
    if (file) {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('name', p.name);
      if (p.issuer)        fd.append('issuer', p.issuer);
      if (p.issued_at)     fd.append('issued_at', p.issued_at);
      if (p.expires_at)    fd.append('expires_at', p.expires_at);
      if (p.credential_id) fd.append('credential_id', p.credential_id);
      if (p.notes)         fd.append('notes', p.notes);
      return this.http.post<{ id: number; file_path?: string }>(`${BASE}/hr/employees/${employeeId}/certifications`, fd);
    }
    return this.http.post<{ id: number; file_path?: string }>(`${BASE}/hr/employees/${employeeId}/certifications`, p);
  }
  updateEmpHrCertification(employeeId: number, certId: number, p: Partial<HrCertification>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/hr/employees/${employeeId}/certifications/${certId}`, p);
  }
  deleteEmpHrCertification(employeeId: number, certId: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/hr/employees/${employeeId}/certifications/${certId}`);
  }
  // Self-service learning
  listHrMyLearning(): Observable<{ assignments: HrCourseAssignment[] }> {
    return this.http.get<{ assignments: HrCourseAssignment[] }>(`${BASE}/hr/me/learning`);
  }
  updateHrMyLearningProgress(assignmentId: number, p: { status?: string; score?: number; notes?: string }): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${BASE}/hr/me/learning-progress/${assignmentId}`, p);
  }
  listHrMyCertifications(): Observable<{ certifications: HrCertification[] }> {
    return this.http.get<{ certifications: HrCertification[] }>(`${BASE}/hr/me/certifications`);
  }

  // Profile change requests
  listHrChangeRequests(status?: string): Observable<{ requests: HrChangeRequest[] }> {
    const q = status ? `?status=${encodeURIComponent(status)}` : '';
    return this.http.get<{ requests: HrChangeRequest[] }>(`${BASE}/hr/change-requests${q}`);
  }
  reviewHrChangeRequest(id: number, status: 'approved' | 'denied'): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/hr/change-requests/${id}`, { status });
  }
  // Self-service change requests
  listHrMyChangeRequests(): Observable<{ requests: HrChangeRequest[] }> {
    return this.http.get<{ requests: HrChangeRequest[] }>(`${BASE}/hr/me/change-requests`);
  }
  createHrMyChangeRequest(p: { field: string; new_value: string; note?: string }): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/hr/me/change-requests`, p);
  }

  // Recruitment / ATS
  listHrJobs(): Observable<{ jobs: HrJob[] }> {
    return this.http.get<{ jobs: HrJob[] }>(`${BASE}/hr/jobs`);
  }
  getHrJob(id: number): Observable<{ job: HrJob }> {
    return this.http.get<{ job: HrJob }>(`${BASE}/hr/jobs/${id}`);
  }
  createHrJob(p: HrJob): Observable<{ id: number; slug: string }> {
    return this.http.post<{ id: number; slug: string }>(`${BASE}/hr/jobs`, p);
  }
  updateHrJob(id: number, p: Partial<HrJob>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/hr/jobs/${id}`, p);
  }
  deleteHrJob(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/hr/jobs/${id}`);
  }
  getHrJobPipeline(id: number): Observable<{ applications: HrApplication[] }> {
    return this.http.get<{ applications: HrApplication[] }>(`${BASE}/hr/jobs/${id}/pipeline`);
  }
  listHrCandidates(): Observable<{ candidates: HrCandidate[] }> {
    return this.http.get<{ candidates: HrCandidate[] }>(`${BASE}/hr/candidates`);
  }
  createHrCandidate(p: HrCandidate): Observable<{ id: number; existing?: boolean }> {
    return this.http.post<{ id: number; existing?: boolean }>(`${BASE}/hr/candidates`, p);
  }
  applyHrCandidate(jobId: number, candidateId: number): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/hr/applications`, { job_id: jobId, candidate_id: candidateId });
  }
  getHrApplication(id: number): Observable<{ application: HrApplication; interviews: HrInterview[]; notes: HrApplicationNote[] }> {
    return this.http.get<{ application: HrApplication; interviews: HrInterview[]; notes: HrApplicationNote[] }>(`${BASE}/hr/applications/${id}`);
  }
  updateHrApplication(id: number, p: Partial<HrApplication>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/hr/applications/${id}`, p);
  }
  addHrApplicationNote(id: number, body: string): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/hr/applications/${id}/notes`, { body });
  }
  deleteHrApplicationNote(id: number, noteId: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/hr/applications/${id}/notes/${noteId}`);
  }
  hireHrApplication(id: number, hireDate?: string): Observable<{ ok: boolean; employee_id: number }> {
    return this.http.post<{ ok: boolean; employee_id: number }>(`${BASE}/hr/applications/${id}/hire`, { hire_date: hireDate });
  }
  scheduleHrInterview(applicationId: number, p: HrInterview): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/hr/applications/${applicationId}/interviews`, p);
  }
  deleteHrApplication(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/hr/applications/${id}`);
  }

  // Succession
  listHrSuccessionPlans(): Observable<{ plans: HrSuccessionPlan[] }> {
    return this.http.get<{ plans: HrSuccessionPlan[] }>(`${BASE}/hr/succession`);
  }
  createHrSuccessionPlan(p: HrSuccessionPlan): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/hr/succession`, p);
  }
  updateHrSuccessionPlan(id: number, p: Partial<HrSuccessionPlan>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/hr/succession/${id}`, p);
  }
  deleteHrSuccessionPlan(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/hr/succession/${id}`);
  }
  listHrSuccessionCandidates(planId: number): Observable<{ candidates: HrSuccessionCandidate[] }> {
    return this.http.get<{ candidates: HrSuccessionCandidate[] }>(`${BASE}/hr/succession/${planId}/candidates`);
  }
  addHrSuccessionCandidate(planId: number, p: { employee_id: number; readiness?: string; notes?: string }): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${BASE}/hr/succession/${planId}/candidates`, p);
  }
  updateHrSuccessionCandidate(planId: number, candidateId: number, p: Partial<HrSuccessionCandidate>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/hr/succession/${planId}/candidates/${candidateId}`, p);
  }
  deleteHrSuccessionCandidate(planId: number, candidateId: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/hr/succession/${planId}/candidates/${candidateId}`);
  }
  listHrSuccessionPlanNotes(planId: number): Observable<{ notes: HrSuccessionPlanNote[] }> {
    return this.http.get<{ notes: HrSuccessionPlanNote[] }>(`${BASE}/hr/succession/${planId}/notes`);
  }
  addHrSuccessionPlanNote(planId: number, body: string): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/hr/succession/${planId}/notes`, { body });
  }
  deleteHrSuccessionPlanNote(planId: number, noteId: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/hr/succession/${planId}/notes/${noteId}`);
  }
  listHrSuccessionCandidateNotes(planId: number, candidateId: number): Observable<{ notes: HrSuccessionCandidateNote[] }> {
    return this.http.get<{ notes: HrSuccessionCandidateNote[] }>(`${BASE}/hr/succession/${planId}/candidates/${candidateId}/notes`);
  }
  addHrSuccessionCandidateNote(planId: number, candidateId: number, body: string): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/hr/succession/${planId}/candidates/${candidateId}/notes`, { body });
  }
  deleteHrSuccessionCandidateNote(planId: number, candidateId: number, noteId: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/hr/succession/${planId}/candidates/${candidateId}/notes/${noteId}`);
  }

  // Reports
  getHrReportsOverview(): Observable<any> {
    return this.http.get<any>(`${BASE}/hr/reports/overview`);
  }

  // Compliance
  listHrCompliance(): Observable<{ tasks: HrComplianceTask[] }> {
    return this.http.get<{ tasks: HrComplianceTask[] }>(`${BASE}/hr/compliance`);
  }
  createHrCompliance(p: HrComplianceTask): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/hr/compliance`, p);
  }
  updateHrCompliance(id: number, p: Partial<HrComplianceTask>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/hr/compliance/${id}`, p);
  }
  completeHrCompliance(id: number): Observable<{ ok: boolean; next_due_at: string }> {
    return this.http.post<{ ok: boolean; next_due_at: string }>(`${BASE}/hr/compliance/${id}/complete`, {});
  }
  deleteHrCompliance(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/hr/compliance/${id}`);
  }
  listHrComplianceCourses(taskId: number): Observable<{ courses: HrCourse[] }> {
    return this.http.get<{ courses: HrCourse[] }>(`${BASE}/hr/compliance/${taskId}/courses`);
  }
  listHrComplianceNotes(taskId: number): Observable<{ notes: HrComplianceNote[] }> {
    return this.http.get<{ notes: HrComplianceNote[] }>(`${BASE}/hr/compliance/${taskId}/notes`);
  }
  addHrComplianceNote(taskId: number, body: string): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/hr/compliance/${taskId}/notes`, { body });
  }
  deleteHrComplianceNote(taskId: number, noteId: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/hr/compliance/${taskId}/notes/${noteId}`);
  }

  // Public, token-gated survey (used by /surveys/:token and embeds)
  getPublicSurvey(token: string): Observable<{ survey: PublicSurveyDef }> {
    return this.http.get<{ survey: PublicSurveyDef }>(`${BASE}/public-survey/${token}`);
  }
  submitPublicSurvey(token: string, answers: Record<string, any>): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${BASE}/public-survey/${token}/respond`, { answers });
  }

  // Engagement / pulse surveys & feedback
  listHrPulseSurveys(): Observable<{ surveys: HrPulseSurvey[] }> {
    return this.http.get<{ surveys: HrPulseSurvey[] }>(`${BASE}/hr/pulse-surveys`);
  }
  createHrPulseSurvey(p: HrPulseSurvey): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/hr/pulse-surveys`, p);
  }
  updateHrPulseSurvey(id: number, p: Partial<HrPulseSurvey>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/hr/pulse-surveys/${id}`, p);
  }
  deleteHrPulseSurvey(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/hr/pulse-surveys/${id}`);
  }
  getHrPulseSurveyResponses(id: number): Observable<{ survey: HrPulseSurvey; responses: any[]; aggregate: HrPulseAggregate }> {
    return this.http.get<{ survey: HrPulseSurvey; responses: any[]; aggregate: HrPulseAggregate }>(`${BASE}/hr/pulse-surveys/${id}/responses`);
  }
  listHrFeedback(status?: string): Observable<{ feedback: HrFeedbackEntry[] }> {
    const q = status ? `?status=${encodeURIComponent(status)}` : '';
    return this.http.get<{ feedback: HrFeedbackEntry[] }>(`${BASE}/hr/feedback${q}`);
  }
  updateHrFeedback(id: number, status: 'new'|'reviewed'|'actioned'|'archived'): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/hr/feedback/${id}`, { status });
  }
  deleteHrFeedback(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/hr/feedback/${id}`);
  }
  // Self-service
  listHrMyPulseSurveys(): Observable<{ surveys: HrPulseSurvey[] }> {
    return this.http.get<{ surveys: HrPulseSurvey[] }>(`${BASE}/hr/me/pulse-surveys`);
  }
  submitHrMyPulseResponse(surveyId: number, answers: Record<string, number | string>): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${BASE}/hr/me/pulse-respond/${surveyId}`, { answers });
  }
  submitHrMyFeedback(p: { message: string; category?: string; anonymous?: boolean }): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/hr/me/feedback`, p);
  }

  // Public onboarding portal (token-gated, no auth — used by the new hire's link)
  getHrOnboardingPortal(token: string): Observable<HrOnboardingPortalSnapshot> {
    return this.http.get<HrOnboardingPortalSnapshot>(`${BASE}/public-hr-onboarding/${token}`);
  }
  saveHrOnboardingProfile(token: string, p: any): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${BASE}/public-hr-onboarding/${token}/profile`, p);
  }
  saveHrOnboardingContact(token: string, p: any): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${BASE}/public-hr-onboarding/${token}/contact`, p);
  }
  saveHrOnboardingEmergency(token: string, p: any): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${BASE}/public-hr-onboarding/${token}/emergency`, p);
  }
  saveHrOnboardingPayroll(token: string, p: any): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${BASE}/public-hr-onboarding/${token}/payroll`, p);
  }
  saveHrOnboardingDiversity(token: string, p: any): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${BASE}/public-hr-onboarding/${token}/diversity`, p);
  }
  saveHrOnboardingBackground(token: string, p: any): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${BASE}/public-hr-onboarding/${token}/background`, p);
  }
  addHrOnboardingReference(token: string, p: HrReference): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/public-hr-onboarding/${token}/references`, p);
  }
  deleteHrOnboardingReference(token: string, id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/public-hr-onboarding/${token}/references/${id}`);
  }
  uploadHrOnboardingDoc(token: string, file: File, opts: {
    title: string;
    category?: string;
    doc_type_id?: number | null;
    reference_number?: string;
    issued_at?: string;
    expires_at?: string;
  }): Observable<{ id: number }> {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('title', opts.title);
    if (opts.category) fd.append('category', opts.category);
    if (opts.doc_type_id) fd.append('doc_type_id', String(opts.doc_type_id));
    if (opts.reference_number) fd.append('reference_number', opts.reference_number);
    if (opts.issued_at)  fd.append('issued_at',  opts.issued_at);
    if (opts.expires_at) fd.append('expires_at', opts.expires_at);
    return this.http.post<{ id: number }>(`${BASE}/public-hr-onboarding/${token}/documents`, fd);
  }
  // Document types (HR-managed catalogue)
  listHrDocumentTypes(): Observable<{ types: HrDocumentType[] }> {
    return this.http.get<{ types: HrDocumentType[] }>(`${BASE}/hr/document-types`);
  }
  createHrDocumentType(p: HrDocumentType): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/hr/document-types`, p);
  }
  /** Multipart variant — used for kind='signed' or 'contract' to upload a
   *  template file (with optional builder JSON). The kind is taken from the
   *  payload so the same call site works for both buckets. */
  createHrSignedDocumentType(p: HrDocumentType, template: File, blocksJson?: string): Observable<{ id: number }> {
    const fd = new FormData();
    fd.append('name', p.name);
    fd.append('kind', p.kind === 'contract' ? 'contract' : 'signed');
    fd.append('template', template);
    if (p.description) fd.append('description', p.description);
    if (blocksJson)    fd.append('blocks_json', blocksJson);
    if (p.audience)            fd.append('audience', p.audience);
    if (p.contract_type_id)    fd.append('contract_type_id', String(p.contract_type_id));
    if (p.group_id)            fd.append('group_id', String(p.group_id));
    fd.append('add_to_onboarding', p.add_to_onboarding ? '1' : '0');
    fd.append('is_required',       p.is_required ? '1' : '0');
    fd.append('needs_reference',   p.needs_reference ? '1' : '0');
    fd.append('needs_issue_date',  p.needs_issue_date ? '1' : '0');
    fd.append('needs_expiry_date', p.needs_expiry_date ? '1' : '0');
    if (p.sort_order != null) fd.append('sort_order', String(p.sort_order));
    return this.http.post<{ id: number }>(`${BASE}/hr/document-types`, fd);
  }
  /** Upload an inline image used inside a signed-document page block. */
  uploadHrTemplateImage(file: File): Observable<{ url: string }> {
    const fd = new FormData();
    fd.append('file', file);
    return this.http.post<{ url: string }>(`${BASE}/hr/document-types/template-image`, fd);
  }
  /**
   * Multipart update for an existing signed-document type. Pass `template` to replace
   * the rendered PDF; pass `blocksJson` to update the page-builder source.
   */
  updateHrSignedDocumentType(id: number, p: HrDocumentType, template?: File, blocksJson?: string): Observable<{ ok: boolean }> {
    const fd = new FormData();
    fd.append('name', p.name);
    if (p.description != null) fd.append('description', p.description);
    if (template) fd.append('template', template);
    if (blocksJson !== undefined) fd.append('blocks_json', blocksJson);
    // Class (audience) + contract type must be sent on edit too, or they'd
    // silently revert. Always send them (empty contract_type_id = clear).
    fd.append('audience', p.audience || 'employee');
    fd.append('contract_type_id', p.contract_type_id != null ? String(p.contract_type_id) : '');
    // Always send group_id (empty = Ungrouped) so the bucket can be cleared.
    fd.append('group_id', p.group_id != null ? String(p.group_id) : '');
    fd.append('add_to_onboarding', p.add_to_onboarding ? '1' : '0');
    fd.append('is_required',       p.is_required ? '1' : '0');
    fd.append('needs_reference',   p.needs_reference ? '1' : '0');
    fd.append('needs_issue_date',  p.needs_issue_date ? '1' : '0');
    fd.append('needs_expiry_date', p.needs_expiry_date ? '1' : '0');
    if (p.sort_order != null) fd.append('sort_order', String(p.sort_order));
    return this.http.post<{ ok: boolean }>(`${BASE}/hr/document-types/${id}`, fd);
  }
  updateHrDocumentType(id: number, p: Partial<HrDocumentType>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/hr/document-types/${id}`, p);
  }
  // Contract-types lookup (NDA / MSA / etc.) — referenced by
  // HrDocumentType.contract_type_id. Managed inline on the Contracts page.
  listContractTypes(): Observable<{ types: ContractType[] }> {
    return this.http.get<{ types: ContractType[] }>(`${BASE}/hr/contract-types`);
  }
  createContractType(p: ContractType): Observable<{ id: number; slug: string }> {
    return this.http.post<{ id: number; slug: string }>(`${BASE}/hr/contract-types`, p);
  }
  updateContractType(id: number, p: Partial<ContractType>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/hr/contract-types/${id}`, p);
  }
  deleteContractType(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/hr/contract-types/${id}`);
  }
  // Contract groups (092) — collapsible buckets for contract templates.
  listContractGroups(): Observable<{ groups: ContractGroup[] }> {
    return this.http.get<{ groups: ContractGroup[] }>(`${BASE}/hr/contract-groups`);
  }
  createContractGroup(p: ContractGroup): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/hr/contract-groups`, p);
  }
  updateContractGroup(id: number, p: Partial<ContractGroup>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/hr/contract-groups/${id}`, p);
  }
  deleteContractGroup(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/hr/contract-groups/${id}`);
  }
  // Per-entity contracts (the Contracts tab on client/candidate/etc. detail pages).
  listEntityContracts(audience: string, entityId: number): Observable<EntityContractsResponse> {
    return this.http.get<EntityContractsResponse>(`${BASE}/contracts/${audience}/${entityId}`);
  }
  signEntityContract(audience: string, entityId: number, docId: number): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${BASE}/contracts/${audience}/${entityId}/${docId}/sign`, {});
  }
  unsignEntityContract(audience: string, entityId: number, docId: number): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${BASE}/contracts/${audience}/${entityId}/${docId}/unsign`, {});
  }
  /** Templates available to attach for the given audience. */
  listContractTemplates(audience: string, entityId: number): Observable<{ templates: ContractTemplate[] }> {
    return this.http.get<{ templates: ContractTemplate[] }>(`${BASE}/contracts/${audience}/${entityId}/templates`);
  }
  /** Attach a template to this entity. For the client audience, an
   *  optional client_service_offering_id binds the new doc to a service. */
  attachEntityContract(
    audience: string, entityId: number,
    body: { doc_type_id: number; client_service_offering_id?: number | null },
  ): Observable<{ ok: boolean; id: number }> {
    return this.http.post<{ ok: boolean; id: number }>(`${BASE}/contracts/${audience}/${entityId}/attach`, body);
  }
  /** Change (or clear) the service link on an existing client contract.
   *  Passing null detaches it and keeps the contract as client-wide. */
  setContractService(entityId: number, docId: number, csoId: number | null): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(
      `${BASE}/contracts/client/${entityId}/${docId}/service`,
      { client_service_offering_id: csoId }
    );
  }

  deleteHrDocumentType(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/hr/document-types/${id}`);
  }

  // ── HR / Legal documents ───────────────────────────────────────────────
  listHrLegalDocs(): Observable<{ documents: HrLegalDocument[] }> {
    return this.http.get<{ documents: HrLegalDocument[] }>(`${BASE}/hr/legal`);
  }
  /** Look up by id or slug — backend accepts either. */
  getHrLegalDoc(idOrSlug: string | number): Observable<{ document: HrLegalDocument }> {
    return this.http.get<{ document: HrLegalDocument }>(`${BASE}/hr/legal/${idOrSlug}`);
  }
  createHrLegalDoc(p: Partial<HrLegalDocument>): Observable<{ id: number; slug: string }> {
    return this.http.post<{ id: number; slug: string }>(`${BASE}/hr/legal`, p);
  }
  updateHrLegalDoc(id: number, p: Partial<HrLegalDocument>): Observable<{ ok: boolean; slug: string }> {
    return this.http.put<{ ok: boolean; slug: string }>(`${BASE}/hr/legal/${id}`, p);
  }
  deleteHrLegalDoc(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/hr/legal/${id}`);
  }
  // Public-facing endpoints for the /legal/:slug page (no auth required).
  listPublicLegal(): Observable<{ documents: HrLegalDocument[] }> {
    return this.http.get<{ documents: HrLegalDocument[] }>(`${BASE}/public/legal`);
  }
  getPublicLegal(slug: string): Observable<{ document: HrLegalDocument }> {
    return this.http.get<{ document: HrLegalDocument }>(`${BASE}/public/legal/${slug}`);
  }

  deleteHrOnboardingDoc(token: string, did: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/public-hr-onboarding/${token}/documents/${did}`);
  }
  signHrOnboardingDocument(token: string, did: number, signatureDataUrl: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(
      `${BASE}/public-hr-onboarding/${token}/documents/${did}/sign`,
      { signature_data: signatureDataUrl },
    );
  }
  signHrOnboardingDocumentWithPdf(token: string, did: number, signatureDataUrl: string, signedPdf: Blob): Observable<{ ok: boolean; file_path?: string }> {
    const fd = new FormData();
    fd.append('signature_data', signatureDataUrl);
    fd.append('signed_pdf', signedPdf, 'signed.pdf');
    return this.http.post<{ ok: boolean; file_path?: string }>(
      `${BASE}/public-hr-onboarding/${token}/documents/${did}/sign`,
      fd,
    );
  }
  toggleHrOnboardingTask(token: string, tid: number, isDone: boolean): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${BASE}/public-hr-onboarding/${token}/tasks/${tid}`, { is_done: isDone });
  }
  setHrOnboardingLearning(token: string, aid: number, status: 'not_started'|'in_progress'|'completed'): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${BASE}/public-hr-onboarding/${token}/learning/${aid}`, { status });
  }
  submitHrOnboardingSection(token: string, section: HrOnboardingSection): Observable<{ ok: boolean; progress: HrOnboardingProgress; completed: boolean }> {
    return this.http.post<{ ok: boolean; progress: HrOnboardingProgress; completed: boolean }>(`${BASE}/public-hr-onboarding/${token}/submit/${section}`, {});
  }

  // ── Public Recruitment onboarding portal (token-gated, no auth) ────
  //
  // Companion to the HR portal above, but for the candidate side. The
  // four stages — sign contract / general info / CV / documents — are
  // intentionally narrower than the HR equivalent: no payroll, no
  // references, no learning. Only profile fields a candidate can
  // self-serve are accepted by the backend.
  getRecruitmentOnboardingPortal(token: string): Observable<RecruitmentOnboardingPortalSnapshot> {
    return this.http.get<RecruitmentOnboardingPortalSnapshot>(`${BASE}/public-recruitment-onboarding/${token}`);
  }
  saveRecruitmentOnboardingGeneral(token: string, p: Partial<RecruitmentCandidate>): Observable<{ ok: boolean; changed?: number }> {
    return this.http.put<{ ok: boolean; changed?: number }>(`${BASE}/public-recruitment-onboarding/${token}/general`, p);
  }
  signRecruitmentOnboardingContract(token: string, signedName: string): Observable<{ ok: boolean; contract_signed_at: string | null }> {
    return this.http.post<{ ok: boolean; contract_signed_at: string | null }>(`${BASE}/public-recruitment-onboarding/${token}/sign-contract`, { signed_name: signedName });
  }
  uploadRecruitmentOnboardingCv(token: string, file: File): Observable<{ ok: boolean; file_path: string }> {
    const fd = new FormData();
    fd.append('file', file);
    return this.http.post<{ ok: boolean; file_path: string }>(`${BASE}/public-recruitment-onboarding/${token}/cv`, fd);
  }
  uploadRecruitmentOnboardingDoc(
    token: string,
    file: File | null,
    meta: {
      title?: string;
      doc_type_id?: number | null;
      reference_number?: string;
      issuing_body?: string;
      issued_at?: string;
      expires_at?: string;
    },
  ): Observable<{ id: number }> {
    const fd = new FormData();
    if (file)                  fd.append('file', file);
    if (meta.title)            fd.append('title', meta.title);
    if (meta.doc_type_id)      fd.append('doc_type_id', String(meta.doc_type_id));
    if (meta.reference_number) fd.append('reference_number', meta.reference_number);
    if (meta.issuing_body)     fd.append('issuing_body', meta.issuing_body);
    if (meta.issued_at)        fd.append('issued_at', meta.issued_at);
    if (meta.expires_at)       fd.append('expires_at', meta.expires_at);
    return this.http.post<{ id: number }>(`${BASE}/public-recruitment-onboarding/${token}/documents`, fd);
  }
  // HR-side verify / reject
  verifyHrOnboardingSection(employeeId: number, section: HrOnboardingSection, verify: boolean): Observable<{ ok: boolean; progress: HrOnboardingProgress }> {
    return this.http.post<{ ok: boolean; progress: HrOnboardingProgress }>(`${BASE}/hr/employees/${employeeId}/verify-section/${section}`, { verify });
  }
  rejectHrOnboardingSection(employeeId: number, section: HrOnboardingSection, reason: string): Observable<{ ok: boolean; progress: HrOnboardingProgress }> {
    return this.http.post<{ ok: boolean; progress: HrOnboardingProgress }>(`${BASE}/hr/employees/${employeeId}/reject-section/${section}`, { reason });
  }
  listHrReferences(employeeId: number): Observable<{ references: HrReference[] }> {
    return this.http.get<{ references: HrReference[] }>(`${BASE}/hr/employees/${employeeId}/references`);
  }

  // Self-service ("Me")
  getHrMe(): Observable<{ employee: HrEmployee }> {
    return this.http.get<{ employee: HrEmployee }>(`${BASE}/hr/me`);
  }
  listHrMyPayslips(): Observable<{ payslips: HrPayslip[] }> {
    return this.http.get<{ payslips: HrPayslip[] }>(`${BASE}/hr/me/payslips`);
  }
  listHrMyTimeOff(): Observable<{ entries: HrTimeOffEntry[] }> {
    return this.http.get<{ entries: HrTimeOffEntry[] }>(`${BASE}/hr/me/time-off`);
  }
  createHrMyTimeOff(p: Partial<HrTimeOffEntry>): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/hr/me/time-off`, p);
  }
  listHrMyDocuments(): Observable<{ documents: HrDocument[] }> {
    return this.http.get<{ documents: HrDocument[] }>(`${BASE}/hr/me/documents`);
  }
  signHrDocument(documentId: number, signatureDataUrl: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${BASE}/hr/me/sign/${documentId}`, { signature_data: signatureDataUrl });
  }
  /** Self-service upload to the logged-in employee's own document record. */
  uploadHrMyDocument(file: File, opts: {
    title?: string;
    category?: string;
    doc_type_id?: number | null;
    reference_number?: string;
    issued_at?: string;
    expires_at?: string;
  } = {}): Observable<{ id: number }> {
    const fd = new FormData();
    fd.append('file', file);
    if (opts.title)            fd.append('title', opts.title);
    if (opts.category)         fd.append('category', opts.category);
    if (opts.doc_type_id)      fd.append('doc_type_id', String(opts.doc_type_id));
    if (opts.reference_number) fd.append('reference_number', opts.reference_number);
    if (opts.issued_at)        fd.append('issued_at',  opts.issued_at);
    if (opts.expires_at)       fd.append('expires_at', opts.expires_at);
    return this.http.post<{ id: number }>(`${BASE}/hr/me/documents`, fd);
  }
  /** Remove an unsigned document the employee uploaded themselves. */
  deleteHrMyDocument(documentId: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/hr/me/documents/${documentId}`);
  }
  /** Multipart variant — also replaces the row's file_path with the in-browser-rendered signed PDF. */
  signHrDocumentWithPdf(documentId: number, signatureDataUrl: string, signedPdf: Blob): Observable<{ ok: boolean; file_path?: string }> {
    const fd = new FormData();
    fd.append('signature_data', signatureDataUrl);
    fd.append('signed_pdf', signedPdf, 'signed.pdf');
    return this.http.post<{ ok: boolean; file_path?: string }>(`${BASE}/hr/me/sign/${documentId}`, fd);
  }

  // public
  getPublicForm(slug: string): Observable<{ form: FormDef; fields: FormField[]; branding?: PublicBranding }> {
    return this.http.get<{ form: FormDef; fields: FormField[]; branding?: PublicBranding }>(`${BASE}/public/forms/${slug}`);
  }
  submitPublic(slug: string, body: FormData | any): Observable<{ ok: boolean; thank_you_message: string }> {
    return this.http.post<{ ok: boolean; thank_you_message: string }>(`${BASE}/public/forms/${slug}/submit`, body);
  }
  /** Anonymous list of all status='open' job postings — used by /jobs. */
  listPublicJobs(): Observable<{ jobs: HrJob[] }> {
    return this.http.get<{ jobs: HrJob[] }>(`${BASE}/public/jobs`);
  }
  /** Anonymous single posting by slug — used by /jobs/:slug. */
  getPublicJob(slug: string): Observable<{ job: HrJob }> {
    return this.http.get<{ job: HrJob }>(`${BASE}/public/jobs/${slug}`);
  }
  /**
   * Anonymous application submission. Multipart so candidates can attach a CV.
   * Backend upserts hr_candidates by email and creates an hr_applications row
   * (stage='applied'); duplicates against the same job return ok=true with
   * `duplicate:true` so the UI can show a friendly "already applied" state.
   */
  applyForPublicJob(slug: string, body: FormData): Observable<{ ok: boolean; application_id?: number; duplicate?: boolean; message?: string }> {
    return this.http.post<{ ok: boolean; application_id?: number; duplicate?: boolean; message?: string }>(
      `${BASE}/public/jobs/${slug}/apply`,
      body,
    );
  }

  // ── Accounting / invoices ────────────────────────────────────────────────
  // Invoice list. `filter` narrows to a specific client (client's Invoices
  // tab) or a specific service link (services-admin per-service view).
  listInvoices(filter?: { clientId?: number; serviceLinkId?: number }): Observable<{ invoices: Invoice[] }> {
    let url = `${BASE}/accounting/invoices`;
    const qs: string[] = [];
    if (filter?.clientId) qs.push(`client_id=${filter.clientId}`);
    if (filter?.serviceLinkId) qs.push(`service_link_id=${filter.serviceLinkId}`);
    if (qs.length) url += `?${qs.join('&')}`;
    return this.http.get<{ invoices: Invoice[] }>(url);
  }
  getInvoice(id: number): Observable<{ invoice: Invoice; lines: InvoiceLine[]; services: InvoiceServiceLink[] }> {
    return this.http.get<{ invoice: Invoice; lines: InvoiceLine[]; services: InvoiceServiceLink[] }>(
      `${BASE}/accounting/invoices/${id}`
    );
  }
  createInvoice(p: Partial<Invoice> & {
    lines?: Partial<InvoiceLine>[];
    service_link_ids?: number[];
  }): Observable<{ id: number; invoice_number: string }> {
    return this.http.post<{ id: number; invoice_number: string }>(`${BASE}/accounting/invoices`, p);
  }
  updateInvoice(id: number, p: Partial<Invoice>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/accounting/invoices/${id}`, p);
  }
  deleteInvoice(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/accounting/invoices/${id}`);
  }
  sendInvoice(id: number): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${BASE}/accounting/invoices/${id}/send`, {});
  }
  markInvoicePaid(id: number): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${BASE}/accounting/invoices/${id}/mark-paid`, {});
  }
  /** Email the invoice HTML to bill_to_email (or override `to`).
   *  Backend flips draft → sent + stamps sent_at on the first send. */
  emailInvoice(id: number, to?: string): Observable<{ ok: boolean; sent_to: string }> {
    return this.http.post<{ ok: boolean; sent_to: string }>(
      `${BASE}/accounting/invoices/${id}/email`,
      to ? { to } : {}
    );
  }
  // Mark part paid. Omit amount to default to half the invoice total
  // server-side (matches the client-tab "part paid" pill default).
  markInvoicePartPaid(id: number, amount_paid?: number): Observable<{ ok: boolean; amount_paid: number }> {
    return this.http.post<{ ok: boolean; amount_paid: number }>(
      `${BASE}/accounting/invoices/${id}/mark-part-paid`,
      amount_paid !== undefined ? { amount_paid } : {}
    );
  }
  addInvoiceLine(invoiceId: number, p: Partial<InvoiceLine>): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/accounting/invoices/${invoiceId}/lines`, p);
  }
  updateInvoiceLine(invoiceId: number, lineId: number, p: Partial<InvoiceLine>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/accounting/invoices/${invoiceId}/lines/${lineId}`, p);
  }
  deleteInvoiceLine(invoiceId: number, lineId: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/accounting/invoices/${invoiceId}/lines/${lineId}`);
  }
  // Attach / detach client_service_offerings to an invoice — drives
  // the per-service "invoice chip" on the client Services tab and the
  // per-service Invoices sub-tab on services-admin.
  attachInvoiceService(invoiceId: number, clientServiceOfferingId: number): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(
      `${BASE}/accounting/invoices/${invoiceId}/services`,
      { client_service_offering_id: clientServiceOfferingId }
    );
  }
  detachInvoiceService(invoiceId: number, clientServiceOfferingId: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(
      `${BASE}/accounting/invoices/${invoiceId}/services/${clientServiceOfferingId}`
    );
  }

  // ── Invoice templates (migration 144) ───────────────────────
  // Tenant-scoped HTML templates uploaded via Settings → Invoices,
  // rendered server-side with mustache-style variable substitution
  // and returned as HTML to the browser for Print → Save as PDF.
  listInvoiceTemplates(): Observable<{ templates: InvoiceTemplate[] }> {
    return this.http.get<{ templates: InvoiceTemplate[] }>(`${BASE}/accounting/templates`);
  }
  getInvoiceTemplate(id: number): Observable<{ template: InvoiceTemplate }> {
    return this.http.get<{ template: InvoiceTemplate }>(`${BASE}/accounting/templates/${id}`);
  }
  createInvoiceTemplate(p: { name: string; html: string; is_default?: boolean }): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/accounting/templates`, p);
  }
  updateInvoiceTemplate(id: number, p: Partial<InvoiceTemplate>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/accounting/templates/${id}`, p);
  }
  deleteInvoiceTemplate(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/accounting/templates/${id}`);
  }
  setDefaultInvoiceTemplate(id: number): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${BASE}/accounting/templates/${id}/default`, {});
  }
  renderInvoiceTemplate(templateId: number, invoiceId: number): Observable<{ html: string; invoice_number: string }> {
    return this.http.get<{ html: string; invoice_number: string }>(
      `${BASE}/accounting/templates/${templateId}/render/${invoiceId}`
    );
  }

  // ───── Recruitment (migration 077) ────────────────────────────────
  // Clients reuse the existing /api/clients endpoint with ?is_recruitment=1
  // so we don't duplicate company records — the same client row can be a
  // CRM client AND a recruitment client.
  listRecruitmentClients(): Observable<{ clients: Client[] }> {
    return this.http.get<{ clients: Client[] }>(`${BASE}/clients?is_recruitment=1`);
  }

  listRecruitmentCandidates(status?: RecruitmentCandidateStatus): Observable<{ candidates: RecruitmentCandidate[] }> {
    const url = status ? `${BASE}/recruitment/candidates?status=${status}` : `${BASE}/recruitment/candidates`;
    return this.http.get<{ candidates: RecruitmentCandidate[] }>(url);
  }
  getRecruitmentCandidate(id: number): Observable<{ candidate: RecruitmentCandidate; onboarding: RecruitmentOnboarding }> {
    return this.http.get<{ candidate: RecruitmentCandidate; onboarding: RecruitmentOnboarding }>(`${BASE}/recruitment/candidates/${id}`);
  }
  createRecruitmentCandidate(p: RecruitmentCandidate): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/recruitment/candidates`, p);
  }
  updateRecruitmentCandidate(id: number, p: Partial<RecruitmentCandidate>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/recruitment/candidates/${id}`, p);
  }
  deleteRecruitmentCandidate(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/recruitment/candidates/${id}`);
  }
  uploadRecruitmentCandidateCV(id: number, file: File): Observable<{ ok: boolean; file_path: string }> {
    const fd = new FormData();
    fd.append('file', file);
    return this.http.post<{ ok: boolean; file_path: string }>(`${BASE}/recruitment/candidates/${id}/cv`, fd);
  }

  // Candidate documents (compliance pack)
  listRecruitmentCandidateDocuments(id: number): Observable<{ documents: RecruitmentCandidateDocument[] }> {
    return this.http.get<{ documents: RecruitmentCandidateDocument[] }>(`${BASE}/recruitment/candidates/${id}/documents`);
  }
  /** Upload a candidate document. `file` is optional — info-only doc
   *  types (`submission_type='info_only'`) submit metadata only. */
  uploadRecruitmentCandidateDocument(
    id: number,
    file: File | null,
    meta: {
      title?: string;
      doc_type_id?: number | null;
      reference_number?: string;
      issuing_body?: string;
      issued_at?: string;
      expires_at?: string;
    },
  ): Observable<{ id: number }> {
    const fd = new FormData();
    if (file)                  fd.append('file', file);
    if (meta.title)            fd.append('title', meta.title);
    if (meta.doc_type_id)      fd.append('doc_type_id', String(meta.doc_type_id));
    if (meta.reference_number) fd.append('reference_number', meta.reference_number);
    if (meta.issuing_body)     fd.append('issuing_body', meta.issuing_body);
    if (meta.issued_at)        fd.append('issued_at', meta.issued_at);
    if (meta.expires_at)       fd.append('expires_at', meta.expires_at);
    return this.http.post<{ id: number }>(`${BASE}/recruitment/candidates/${id}/documents`, fd);
  }
  updateRecruitmentCandidateDocument(id: number, did: number, p: Partial<RecruitmentCandidateDocument>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/recruitment/candidates/${id}/documents/${did}`, p);
  }
  deleteRecruitmentCandidateDocument(id: number, did: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/recruitment/candidates/${id}/documents/${did}`);
  }

  // Candidate notes
  listRecruitmentCandidateNotes(id: number): Observable<{ notes: RecruitmentCandidateNote[] }> {
    return this.http.get<{ notes: RecruitmentCandidateNote[] }>(`${BASE}/recruitment/candidates/${id}/notes`);
  }
  createRecruitmentCandidateNote(id: number, p: RecruitmentCandidateNote): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/recruitment/candidates/${id}/notes`, p);
  }
  updateRecruitmentCandidateNote(id: number, nid: number, p: Partial<RecruitmentCandidateNote>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/recruitment/candidates/${id}/notes/${nid}`, p);
  }
  deleteRecruitmentCandidateNote(id: number, nid: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/recruitment/candidates/${id}/notes/${nid}`);
  }

  // Placements (candidate × client) — migration 084.
  listRecruitmentPlacements(id: number): Observable<{ placements: RecruitmentPlacement[] }> {
    return this.http.get<{ placements: RecruitmentPlacement[] }>(`${BASE}/recruitment/candidates/${id}/placements`);
  }
  createRecruitmentPlacement(id: number, p: RecruitmentPlacement): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/recruitment/candidates/${id}/placements`, p);
  }
  updateRecruitmentPlacement(id: number, pid: number, p: Partial<RecruitmentPlacement>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/recruitment/candidates/${id}/placements/${pid}`, p);
  }
  deleteRecruitmentPlacement(id: number, pid: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/recruitment/candidates/${id}/placements/${pid}`);
  }
  /** All placements that involve a given recruitment client — drives the
   *  Recruitment client detail page. */
  listRecruitmentClientPlacements(clientId: number): Observable<{ placements: RecruitmentPlacement[] }> {
    return this.http.get<{ placements: RecruitmentPlacement[] }>(`${BASE}/recruitment/clients/${clientId}/placements`);
  }

  // Client-level role openings (migration 085) — multiple candidates
  // can attach to a single role via the placement endpoint's role_id.
  listRecruitmentClientRoles(clientId: number): Observable<{ roles: RecruitmentRole[] }> {
    return this.http.get<{ roles: RecruitmentRole[] }>(`${BASE}/recruitment/clients/${clientId}/roles`);
  }
  createRecruitmentClientRole(clientId: number, p: RecruitmentRole): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/recruitment/clients/${clientId}/roles`, p);
  }
  updateRecruitmentClientRole(clientId: number, roleId: number, p: Partial<RecruitmentRole>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/recruitment/clients/${clientId}/roles/${roleId}`, p);
  }
  deleteRecruitmentClientRole(clientId: number, roleId: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/recruitment/clients/${clientId}/roles/${roleId}`);
  }

  // Doc-type catalogue (settings)
  listRecruitmentDocTypes(): Observable<{ types: RecruitmentDocType[] }> {
    return this.http.get<{ types: RecruitmentDocType[] }>(`${BASE}/recruitment/doc-types`);
  }
  createRecruitmentDocType(p: RecruitmentDocType): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/recruitment/doc-types`, p);
  }
  updateRecruitmentDocType(id: number, p: Partial<RecruitmentDocType>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/recruitment/doc-types/${id}`, p);
  }
  deleteRecruitmentDocType(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/recruitment/doc-types/${id}`);
  }

  // Doc-type groups (collapsible sections on /recruitment/settings)
  listRecruitmentDocGroups(): Observable<{ groups: RecruitmentDocGroup[] }> {
    return this.http.get<{ groups: RecruitmentDocGroup[] }>(`${BASE}/recruitment/doc-groups`);
  }
  createRecruitmentDocGroup(p: RecruitmentDocGroup): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/recruitment/doc-groups`, p);
  }
  updateRecruitmentDocGroup(id: number, p: Partial<RecruitmentDocGroup>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/recruitment/doc-groups/${id}`, p);
  }
  deleteRecruitmentDocGroup(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/recruitment/doc-groups/${id}`);
  }

  // Skills catalogue — managed from Settings → Skills tab.
  listRecruitmentSkills(): Observable<{ skills: RecruitmentSkill[] }> {
    return this.http.get<{ skills: RecruitmentSkill[] }>(`${BASE}/recruitment/skills`);
  }
  createRecruitmentSkill(p: RecruitmentSkill): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${BASE}/recruitment/skills`, p);
  }
  updateRecruitmentSkill(id: number, p: Partial<RecruitmentSkill>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${BASE}/recruitment/skills/${id}`, p);
  }
  deleteRecruitmentSkill(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/recruitment/skills/${id}`);
  }

  // Aggregated documents view
  listRecruitmentDocuments(): Observable<{ documents: RecruitmentDocumentRow[] }> {
    return this.http.get<{ documents: RecruitmentDocumentRow[] }>(`${BASE}/recruitment/documents`);
  }
  /** Filesystem walker scoped to cms/uploads/recruitment/. Drives the
   *  Documentation page's Browse tab. `path` is relative to that root. */
  browseRecruitmentDocuments(path: string = ''): Observable<OperationsDocumentsBrowse> {
    const url = path
      ? `${BASE}/recruitment/documents/browse?path=${encodeURIComponent(path)}`
      : `${BASE}/recruitment/documents/browse`;
    return this.http.get<OperationsDocumentsBrowse>(url);
  }
  /** Delete a file or folder under cms/uploads/recruitment/. Folders are
   *  removed recursively; any `recruitment_candidate_documents` /
   *  `recruitment_candidates.cv_file_path` rows that referenced the
   *  deleted path are cleared server-side. */
  deleteRecruitmentBrowseItem(path: string): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(
      `${BASE}/recruitment/documents/browse?path=${encodeURIComponent(path)}`,
    );
  }
}
