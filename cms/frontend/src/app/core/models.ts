// ─── Notifications (migration 127) ───────────────────────────────
export type NotificationSection =
  'crm' | 'hr' | 'operations' | 'recruitment' | 'accounting' | 'management' | 'tasks';

export interface AppNotification {
  id: number;
  event_key: string;
  section: NotificationSection;
  title: string;
  body?: string | null;
  link_url?: string | null;
  read_at?: string | null;
  escalated_at?: string | null;
  created_at: string;
}

export interface NotificationUnreadCount {
  total: number;
  by_section: Partial<Record<NotificationSection, number>>;
}

/** One row from notification_events_catalog — global registry of every
 *  triggerable event. Drives the Settings → Notifications rules UI. */
export interface NotificationEventDef {
  id: number;
  event_key: string;
  section: NotificationSection;
  label: string;
  description?: string | null;
  default_recipient_scope: 'user' | 'team' | 'role' | 'tenant' | 'none';
  default_recipient_ref?: string | null;
  default_supervisor_role: string;
  default_creates_task: 0 | 1;
  default_escalate_after_minutes?: number | null;
  default_escalate_to_role?: string | null;
  is_active: 0 | 1;
}

/** Per-tenant override of a catalog default. Missing rows mean "use
 *  the catalog defaults". */
export interface NotificationRule {
  id?: number;
  event_key: string;
  enabled: 0 | 1;
  recipient_scope: 'user' | 'team' | 'role' | 'tenant' | 'none';
  recipient_ref?: string | null;
  supervisor_user_id?: number | null;
  supervisor_role?: string | null;
  creates_task: 0 | 1;
  escalate_after_minutes?: number | null;
  escalate_to_user_id?: number | null;
  escalate_to_role?: string | null;
}

// ─── Custom tenant themes (migration 126) ────────────────────────
export interface CustomTheme {
  id: number;
  slug: string;
  label: string;
  mood?: string | null;
  /** Map of CSS variable name (e.g. `--primary`) to color value. */
  vars: Record<string, string>;
  created_at?: string;
  updated_at?: string;
}

// ─── Email providers + routing (migration 122) ───────────────────
export type EmailProviderKind =
  | 'postmark' | 'resend' | 'sendgrid' | 'ses' | 'mailgun' | 'brevo' | 'mailersend' | 'smtp';

export type EmailPurpose = 'newsletter' | 'system' | 'invite' | 'internal';

/** One configured provider for a tenant. Secrets are NEVER returned by
 *  the API — the `has_*` flags tell the UI whether a credential is set
 *  so it can render "•••• (set)" vs "not set". To update a credential,
 *  send the new value; to keep it, omit the field / send empty string. */
export interface EmailProvider {
  id: number;
  provider: EmailProviderKind;
  name: string;
  is_active: 0 | 1 | boolean;
  from_email: string;
  from_name?: string | null;
  reply_to?: string | null;
  // Provider-specific config (no secrets — only the has_* flags come back)
  aws_region?: string | null;
  mailgun_domain?: string | null;
  smtp_host?: string | null;
  smtp_port?: number | null;
  smtp_user?: string | null;
  smtp_encryption?: 'none' | 'tls' | 'ssl';
  /** Advanced: raw JSON string of custom MIME headers. Applied on
   *  every outbound send by EmailDispatcher (migration 123). */
  custom_headers_json?: string | null;
  has_api_key?: boolean;
  has_api_secret?: boolean;
  has_smtp_password?: boolean;
  // Test-send diagnostics
  last_test_at?: string | null;
  last_test_ok?: 0 | 1 | null;
  last_test_error?: string | null;
  created_at?: string;
  updated_at?: string;
}

export type EmailRouting = {
  newsletter: number | null;
  system:     number | null;
  invite:     number | null;
  internal:   number | null;
};

export type FieldType =
  | 'text' | 'email' | 'tel' | 'url' | 'number' | 'password'
  | 'textarea'
  | 'select' | 'radio' | 'checkbox'
  | 'date' | 'datetime'
  | 'file' | 'multi_file'
  | 'color' | 'style_cards';

export interface FormField {
  id?: number;
  name: string;
  label: string;
  type: FieldType;
  is_required: 0 | 1 | boolean;
  options_json?: string | { value: string; label: string }[] | null;
  options?: { value: string; label: string }[];
  placeholder?: string | null;
  help_text?: string | null;
  sort_order?: number;
}

export interface FormDef {
  id?: number;
  slug: string;
  form_type?: 'standard' | 'onboarding';
  title: string;
  description?: string | null;
  intro_html?: string | null;
  submit_label?: string;
  thank_you_message?: string | null;
  notify_email?: string | null;
  notify_subject?: string | null;
  notify_template?: string | null;
  reply_subject?: string | null;
  reply_template?: string | null;
  reply_from_field?: string | null;
  is_published: 0 | 1 | boolean;
  /** Per-form sibling of service_offerings.allow_multiple. Only
   *  meaningful for STANDALONE onboarding forms — when service_offering_id
   *  is set, the service's flag is the source of truth. Migration 118. */
  allow_multiple?: 0 | 1 | boolean;
  // Pricing — currently surfaced only by the onboarding builder. `has_price`
  // toggles paid status; `price` carries the amount. Numbers come back from
  // PHP/PDO as strings on decimal columns, coerce when binding to numeric inputs.
  has_price?: 0 | 1 | boolean;
  price?: number | string | null;
  // Contract terms (055) — only meaningful when has_price=1.
  // payment_type='one_off'  → price is total contract value
  // payment_type='recurring' → price is per-period; repeat_duration sets cadence;
  //                            contract_length_months OR is_indefinite=1.
  payment_type?: 'one_off' | 'recurring';
  repeat_duration?: 'weekly' | 'monthly' | 'quarterly' | 'yearly' | null;
  contract_length_months?: number | null;
  is_indefinite?: 0 | 1 | boolean;
  // Sidenav placement for onboarding forms' main (qualified-clients) section
  main_section_label?: string | null;
  sidenav_placement?: 'top' | 'child';
  // Parent identifier when placement = 'child'. Built-ins use string keys
  // ('forms', 'onboarding'); nesting under another form uses its id as a string.
  sidenav_parent_key?: string | null;
  // Workflow link to another onboarding form (e.g. a Service form whose records
  // belong to a Client form's records). Independent from sidenav placement.
  parent_process_form_id?: number | null;
  // Task team that owns the work this onboarding kicks off (056). When set,
  // qualifying a client auto-creates a task_projects row for that team.
  team_id?: number | null;
  // Catalogue service this onboarding represents (113). When set, the
  // qualified client's services view reads pricing live from the
  // linked service_offerings row instead of the legacy has_price /
  // price / payment_type / repeat_duration fields on this row.
  service_offering_id?: number | null;
  /** Broadcast scope (migration 140). Mutually exclusive with
   *  `service_offering_id` — enforced server-side on save. */
  broadcast_to_all_clients?: 0 | 1 | boolean;
  broadcast_to_all_leads?:   0 | 1 | boolean;
  /** Open-link mode (migration 146). When true, the form has a token-less
   *  public URL at `/onboarding/open/:slug`. Anonymous submissions create
   *  an on-the-fly `onboarding_clients` row and auto-provision per
   *  `public_target` (client / lead / none). Off by default so no
   *  existing form goes live silently. */
  is_public_open?: 0 | 1 | boolean;
  /** Where an anonymous submission from the open link lands.
   *  `client` runs the same find-or-create + service-attach the invite
   *  flow does; `lead` inserts into `leads`; `none` stores the
   *  submission without creating any CRM row. Only used when
   *  `is_public_open` is on. */
  public_target?: 'client' | 'lead' | 'none';
  /** Optional redirect target after a successful public submission
   *  (migration 147). Absolute (http/https) or root-relative (`/…`);
   *  frontend + backend both validate. Null → stay on the Thanks card. */
  post_submit_url?: string | null;
  // When true, the form gets a standalone top-level sidenav entry in addition
  // to whatever sidenav placement it has via Onboarding/Forms grouping.
  show_in_sidenav_root?: 0 | 1 | boolean;
  field_count?: number;
  section_count?: number;
  submission_count?: number;
  client_count?: number;
  qualified_count?: number;
  created_at?: string;
  updated_at?: string;
}

export interface FormSection {
  id?: number;
  form_id?: number;
  slug: string;
  title: string;
  description?: string | null;
  sort_order?: number;
  fields: FormField[];
}

export interface OnboardingFormPayload extends Partial<FormDef> {
  sections: FormSection[];
}

/**
 * A standalone catalogue service the company sells (CRM Services page).
 * NOT an onboarding template — see `service_offerings` table (migration 086).
 * `price` arrives as a string from PHP/PDO; coerce with Number() on read.
 */
export interface ServiceOffering {
  id?: number;
  name: string;
  description?: string | null;
  price?: number | string | null;
  currency?: string;
  payment_type?: 'one_off' | 'recurring';
  repeat_duration?: 'weekly' | 'monthly' | 'quarterly' | 'yearly' | null;
  is_active?: 0 | 1 | boolean;
  /** When true, the same client can hold multiple instances of this
   *  service (auto-attach skips its dupe-check). For subscription-
   *  style services keep this false so re-submission is idempotent.
   *  Migration 118. */
  allow_multiple?: 0 | 1 | boolean;
  /** When true, the catalogue carries no fixed price — the actual
   *  price must be set at each attach (client or lead). Bespoke work
   *  like website builds where the quote depends on scope. Migration 142. */
  is_variable_price?: 0 | 1 | boolean;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
}

export interface Client {
  id?: number;
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  company?: string | null;
  url?: string | null;
  notes?: string | null;
  is_recruitment_client?: 0 | 1 | boolean;
  created_at?: string;
  updated_at?: string;
}

/**
 * Simplified lead pipeline (migration 096). `converted` is system-set
 * only — applied by /api/leads/:id/promote and reset to 'new' by
 * /api/clients/:id/relegate-to-lead. The other three are the user-
 * pickable values exposed in the leads-admin dropdown.
 */
export type LeadStatus = 'new' | 'prospect' | 'dead' | 'converted';

export interface Lead {
  id?: number;
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  company?: string | null;
  url?: string | null;
  notes?: string | null;
  status?: LeadStatus;
  source?: string | null;
  promoted_client_id?: number | null;
  promoted_at?: string | null;
  /** Free-text sector the lead operates in (Healthcare, Construction, etc.).
   *  Powers the dynamic Leads sub-menu in the sidenav — see
   *  Api.listLeadIndustries(). Backfilled to "Healthcare" by migration 098. */
  industry?: string | null;
  /** FK to a service_offerings row (the CRM Services catalogue). Drives
   *  the per-row Service column + Service filter on the list view. */
  service_offering_id?: number | null;
  /** Joined display column from the API — read-only on the frontend. */
  service_name?: string | null;
  /** NULL until the lead has been reached out to; the list view renders
   *  this as a yes/no badge driven off non-null. */
  contacted_at?: string | null;
  /** Admin user id who created the lead, or null for purely automated
   *  inserts. NULL'd by ON DELETE SET NULL when the admin is removed. */
  added_by_user_id?: number | null;
  /** True when the row was inserted by an automated process (bulk
   *  import, AI-generate, etc.). The list view shows "System" when this
   *  is set. */
  added_by_system?: 0 | 1 | boolean;
  /** Joined display name of the adding admin, or null for system rows. */
  added_by_name?: string | null;
  created_at?: string;
  updated_at?: string;
}

/** Distinct industry value with its lead count. Returned by
 *  GET /api/leads/industries. Powers the sidenav sub-menu + the industry
 *  filter dropdown on the leads list. */
export interface LeadIndustrySummary {
  name: string;
  lead_count: number;
}

export interface LeadNote {
  id?: number;
  lead_id?: number;
  title: string;
  body?: string | null;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
}

export interface LeadInfo {
  id?: number;
  lead_id?: number;
  name: string;
  value?: string | null;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
}

/** 8-state service client workflow.
 *   onboarding phase: new → onboarding → submitted → qualified
 *   work phase:       to_do → in_progress → done (+ on_hold)
 *
 * Each transition through the onboarding phase auto-creates a CRM
 * task framing the next action (send link / follow up / approve /
 * deliver). Hitting qualified server-side immediately bumps the row
 * to `to_do` so the work phase starts in the same write. */
// ─── Feedback forms (migration 119) ─────────────────────────────
export type FeedbackKind = 'questionnaire' | 'form' | 'survey' | 'poll';
export type FeedbackQuestionType =
  | 'short_text' | 'long_text' | 'rating' | 'yes_no' | 'single_choice' | 'multi_choice';

export interface FeedbackForm {
  id: number;
  kind: FeedbackKind;
  title: string;
  description?: string | null;
  intro_html?: string | null;
  submit_label?: string;
  thank_you_message?: string | null;
  public_token: string;
  is_published?: 0 | 1 | boolean;
  /** Attach-to-all flags (migration 121). When set, the form
   *  surfaces on every client's / lead's feedback tab automatically
   *  regardless of the per-client junction. */
  broadcast_to_all_clients?: 0 | 1 | boolean;
  broadcast_to_all_leads?:   0 | 1 | boolean;
  client_id?: number | null;
  lead_id?: number | null;
  service_offering_id?: number | null;
  created_by_name?: string | null;
  question_count?: number;
  response_count?: number;
  created_at?: string;
  updated_at?: string;
  /** Only set when the list was filtered by ?client=/?lead=. Tells
   *  the detail tabs why this form surfaced under that person so the
   *  UI can bucket the list into segments. `match_service_name` is
   *  populated when match_source === 'service'. */
  match_source?: 'client' | 'lead' | 'service' | 'broadcast' | null;
  match_service_name?: string | null;
}

export interface FeedbackQuestion {
  id?: number;
  form_id?: number;
  type: FeedbackQuestionType;
  label: string;
  help_text?: string | null;
  options_json?: string | string[] | null;
  options?: string[];
  is_required?: 0 | 1 | boolean;
  sort_order?: number;
}

export interface FeedbackResponse {
  id: number;
  form_id: number;
  client_id?: number | null;
  client_name?: string | null;
  lead_id?: number | null;
  lead_name?: string | null;
  submitted_at: string;
  ip_address?: string | null;
  answers?: FeedbackAnswer[];
}

export interface FeedbackAnswer {
  id: number;
  response_id: number;
  question_id: number;
  value: string | null;
}

export type ServiceClientStatus =
  | 'new' | 'onboarding' | 'submitted' | 'qualified'
  | 'to_do' | 'in_progress' | 'done' | 'on_hold';

export type CrmTaskCategory = 'lead' | 'client' | 'service' | 'form' | 'onboarding' | 'other';
export type CrmTaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type CrmTaskStatus   = 'to_do' | 'in_progress' | 'done';

/** A row from `crm_tasks` (migration 115) — joined with assignee +
 *  creator display names so the table can render without follow-up
 *  user lookups. */
export interface CrmTask {
  id: number;
  title: string;
  description?: string | null;
  category: CrmTaskCategory;
  assignee_user_id?: number | null;
  assignee_name?: string | null;
  priority: CrmTaskPriority;
  status: CrmTaskStatus;
  due_at?: string | null;
  completed_at?: string | null;
  created_by_user_id?: number | null;
  created_by_name?: string | null;
  created_at?: string;
  updated_at?: string;
  /** service_client_link_id back-references a client_service_offerings
   *  row; the list query joins through it to surface the linked client
   *  so the task card can render a "→ client" navigation link. */
  service_client_link_id?: number | null;
  linked_client_id?: number | null;
  linked_client_name?: string | null;
}

export interface CrmTaskStats {
  total: number;
  to_do: number;
  in_progress: number;
  done: number;
  urgent_open: number;
}

/** A note in the task's append-only thread. `user_id` can be null
 *  (admin offboarded) — render as "(deleted user)" in that case. */
export interface CrmTaskNote {
  id: number;
  task_id: number;
  user_id: number | null;
  user_name: string | null;
  user_email: string | null;
  body: string;
  created_at: string;
}

/** Single-client detail returned by GET /api/services/:sid/client/:key.
 *  Superset of the list-row shape with the canonical client fields
 *  (catalogue source) or onboarding context (onboarding source) +
 *  task-project state for the linked project. */
export interface ServiceClientDetail {
  link_id: number | string | null;
  status: ServiceClientStatus;
  service_offering_id: number | string;
  client_id: number | string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  address: string | null;
  website: string | null;
  notes: string | null;
  client_created_at: string | null;
  form_id: number | string | null;
  form_title: string | null;
  onboarding_client_id: number | string | null;
  submitted_at: string | null;
  qualified_at: string | null;
  project_id: number | string | null;
  project_slug: string | null;
  project_team_id: number | string | null;
  project_status: string | null;
  source: 'catalogue' | 'onboarding';
}

/** A client surfaced by GET /api/services/:id/clients — the union of
 *  the catalogue-attach path (client_service_offerings) and the
 *  onboarding-attach path (onboarding_clients whose form links to
 *  this service).
 *
 *  `client_id` is the canonical clients.id when the row came from the
 *  catalogue path; null when it came purely from onboarding and no
 *  matching clients row exists yet.
 *
 *  `link_id` is the client_service_offerings.id and only set on
 *  catalogue rows — that's the row the status-update endpoint targets.
 *
 *  `status` is the unified workflow state — directly stored for
 *  catalogue rows, computed from qualified_at + task_projects.status
 *  for onboarding rows.
 *
 *  The form/onboarding/project fields drive the "View onboarding" +
 *  "View task board" links in the per-client tracking panel.
 */
export interface ServiceClientLink {
  client_id: number | string | null;
  name: string | null;
  email: string | null;
  company: string | null;
  source: 'catalogue' | 'onboarding';
  link_id: number | string | null;
  status: ServiceClientStatus;
  form_id: number | string | null;
  onboarding_client_id: number | string | null;
  project_id: number | string | null;
  project_slug: string | null;
  project_team_id: number | string | null;
}

/** A row from `lead_services` joined to its catalogue counterpart. The
 *  `id` is the junction-row id (what DELETE targets); `service_offering_id`
 *  is the catalogue id (what the dropdown filters against). */
export interface LeadServiceLink {
  id: number;
  service_offering_id: number;
  name: string;
  price?: number | string | null;
  payment_type?: 'one_off' | 'recurring' | null;
  repeat_duration?: 'weekly' | 'monthly' | 'quarterly' | 'yearly' | null;
  /** True when the parent catalogue service is variable-priced —
   *  price above is the snapshot set at attach time. Migration 142. */
  is_variable_price?: 0 | 1 | boolean;
  created_at?: string;
}

export interface ClientContactNumber {
  id?: number;
  number: string;
  label?: string | null;
  sort_order?: number;
}

export interface ClientContact {
  id?: number;
  client_id?: number;
  first_name: string;
  last_name?: string | null;
  position?: string | null;
  email?: string | null;
  verified?: 0 | 1 | boolean;
  /** Exactly one contact per client carries is_primary=1. The basic-info
   *  card on the client view pulls Name/Email/Phone from the primary
   *  contact (with a fallback to the legacy `clients.name/email/phone`
   *  when no primary exists yet). Migration 061 added the column +
   *  backfilled existing clients. */
  is_primary?: 0 | 1 | boolean;
  numbers?: ClientContactNumber[];
  created_at?: string;
  updated_at?: string;
}

export interface ClientAccount {
  id?: number;
  client_id?: number;
  account_name: string;
  login_url?: string | null;
  username?: string | null;
  password?: string | null;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
}

export interface ClientNote {
  id?: number;
  client_id?: number;
  title: string;
  body?: string | null;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
}

export interface ClientService {
  // 'onboarding' = a Services-attached onboarding instance (has project/work
  // items). 'catalog' = a `service_offerings` row attached directly (no
  // project; migration 087). row_key is a stable per-row track key.
  kind: 'onboarding' | 'catalog';
  row_key: string;
  service_link_id: number | null;   // client_service_offerings.id for catalog rows
  /** service_offerings.id when this row is tied to a catalogue service
   *  (either directly for catalog rows, or via the form's service link
   *  for onboarding rows). Used to look up related form submissions
   *  under the Services tab expand-on-click. */
  service_offering_id: number | null;
  name: string;
  onboarding_client_id: number | null;
  form_id: number | null;
  form_slug: string | null;
  form_title: string;
  qualified_at?: string | null;
  submitted_at?: string | null;
  started_at?: string | null;
  has_price: 0 | 1;
  price: number | null;
  payment_type: 'one_off' | 'recurring';
  repeat_duration: 'weekly' | 'monthly' | 'quarterly' | 'yearly' | null;
  contract_length_months: number | null;
  is_indefinite: 0 | 1;
  contract_end: string | null;
  total_value: number | null;     // null when indefinite
  to_date: number;
  incoming: number;
  monthly_value: number;
  status: 'active' | 'ended';
  // Linked task project (056) — auto-created on qualify when the form has a
  // team. project_status drives the badge on the service card.
  project_id: number | null;
  project_status: 'new' | 'ongoing' | 'testing' | 'blocked' | 'complete' | null;
}

export interface ClientServicesTotals {
  total_contract_value: number;
  has_indefinite: boolean;
  total_to_date: number;
  total_incoming: number;
  monthly_value: number;
}

/** Service entry returned by `GET /api/tasks/services-pool` for the
 *  project-creation picker. Each row is a qualified onboarding entry
 *  (`onboarding_clients.id`) with form pricing/terms + canonical-client
 *  match + an indicator if it's already linked to a project. */
export interface ServicePoolEntry {
  onboarding_client_id: number;
  client_email: string;
  client_name: string | null;
  qualified_at: string | null;
  submitted_at: string | null;
  started_at: string | null;
  form_id: number;
  form_title: string;
  form_slug: string;
  has_price: 0 | 1;
  price: number | string | null;
  payment_type: 'one_off' | 'recurring';
  repeat_duration: 'weekly' | 'monthly' | 'quarterly' | 'yearly' | null;
  contract_length_months: number | null;
  is_indefinite: 0 | 1;
  client_id: number | null;
  client_canonical_name: string | null;
  client_company: string | null;
  linked_project_id: number | null;
  linked_project_name: string | null;
}

/** Aggregated CRM dashboard payload (`GET /api/dashboard/crm`). One-shot
 *  payload feeding every panel on the dashboard page so the frontend only
 *  does a single fetch per view. */
export interface CrmDashboardOverview {
  totals: {
    clients: number;
    leads: number;
    leads_promoted: number;
    forms: number;
    onboarding_templates: number;
    services_active: number;
    services_ended: number;
    mrr: number;
    total_contract_value: number;
    has_indefinite: boolean;
  };
  leads_by_status: Record<LeadStatus, number>;
  services_by_status: Record<'new'|'ongoing'|'testing'|'blocked'|'complete'|'none', number>;
  recent_clients: { id: number; name: string; email: string | null; company: string | null; created_at: string }[];
  recent_leads:   { id: number; name: string; email: string | null; company: string | null; status: LeadStatus; created_at: string }[];
  recent_qualifications: { onboarding_client_id: number; client_name: string | null; client_email: string; qualified_at: string; form_id: number; form_title: string }[];
}

export interface ClientInfo {
  id?: number;
  client_id?: number;
  name: string;
  value?: string | null;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
}

// ============================================================================
// Accounting
// ============================================================================

export type InvoiceStatus = 'draft' | 'sent' | 'part_paid' | 'paid' | 'void';

export interface Invoice {
  id?: number;
  invoice_number?: string;
  client_id?: number | null;
  onboarding_client_id?: number | null;
  bill_to_name: string;
  bill_to_email?: string | null;
  bill_to_address?: string | null;
  currency?: string;
  issue_date?: string;
  due_date?: string | null;
  status?: InvoiceStatus;
  // Decimals come back as strings from PHP/PDO — coerce with Number() at call sites.
  subtotal?: number | string;
  tax_total?: number | string;
  total?: number | string;
  /** Running paid total. NULL until any money is received; equals `total`
   *  when status = 'paid'. Migration 143. */
  amount_paid?: number | string | null;
  notes?: string | null;
  sent_at?: string | null;
  paid_at?: string | null;
  created_at?: string;
  updated_at?: string;
  // joined
  client_name?: string | null;
  /** Summary of client_service_offerings billed on this invoice — filled
   *  by the list endpoint so rows can show the service names inline. */
  services?: Array<{ client_service_offering_id: number; name: string }>;
}

export interface InvoiceLine {
  id?: number;
  invoice_id?: number;
  description: string;
  quantity?: number | string;
  unit_price?: number | string;
  tax_rate?: number | string;
  line_total?: number | string;
  line_tax?: number | string;
  sort_order?: number;
}

/** User-uploaded HTML invoice template. Migration 144. Rendered by
 *  the backend with mustache-style {{var}} + {{#lines}}…{{/lines}}
 *  substitution; the resulting HTML is what the Download / View flow
 *  opens in a new tab (Ctrl+P → Save as PDF for the actual export). */
export interface InvoiceTemplate {
  id?: number;
  name: string;
  html?: string;
  is_default?: 0 | 1 | boolean;
  created_at?: string;
  updated_at?: string;
}

/** Row from invoice_service_links joined to client_service_offerings —
 *  returned in the detail GET so the invoice modal can show which
 *  services it bills for (and let staff detach / add more). */
export interface InvoiceServiceLink {
  link_id: number;
  client_service_offering_id: number;
  sort_order: number;
  name: string;
  price?: number | string | null;
  payment_type?: 'one_off' | 'recurring' | null;
  repeat_duration?: 'weekly' | 'monthly' | 'quarterly' | 'yearly' | null;
}

// ============================================================================
// Taskboard
// ============================================================================

export interface TaskTeam {
  id?: number;
  slug: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  sort_order?: number;
  project_count?: number;
  created_at?: string;
}

/** Member of a task team (joined admin_users + task_team_members). */
export interface TaskTeamMember {
  id: number;             // admin_users.id
  email: string;
  display_name: string;
  role?: 'admin' | 'member' | 'viewer';
  is_active?: 0 | 1 | boolean;
  created_at?: string;    // when the membership was added
}

export type TaskProjectStatus = 'new' | 'ongoing' | 'testing' | 'blocked' | 'complete';

export interface TaskProject {
  id?: number;
  team_id: number;
  slug: string;
  name: string;
  description?: string | null;
  client_id?: number | null;
  status?: TaskProjectStatus;
  // 056 — back-link to the onboarding entry that auto-created this project (if any).
  onboarding_client_id?: number | null;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
  // joined
  team_slug?: string;
  team_name?: string;
  team_color?: string;
  client_name?: string | null;
  item_count?: number;
}

export interface TaskItemType {
  id?: number;
  slug: string;
  name: string;
  color?: string | null;
  icon?: string | null;
  sort_order?: number;
  is_default?: 0 | 1 | boolean;
}

export interface TaskItemState {
  id?: number;
  slug: string;
  name: string;
  color?: string | null;
  sort_order?: number;
  is_terminal?: 0 | 1 | boolean;
  is_default_new?: 0 | 1 | boolean;
}

export interface TaskIteration {
  id?: number;
  project_id: number;
  name: string;
  start_date?: string | null;
  end_date?: string | null;
  goal?: string | null;
  state?: 'planning' | 'active' | 'closed';
  effort_mode?: 'points' | 'days';
  sort_order?: number;
}

export interface TaskItem {
  id?: number;
  project_id: number;
  parent_id?: number | null;
  type_id: number;
  state_id: number;
  iteration_id?: number | null;
  assigned_to?: number | null;
  title: string;
  description?: string | null;
  acceptance_criteria?: string | null;
  priority?: number;
  effort_mode?: 'points' | 'days' | null;
  story_points?: number | null;
  effort_days?: number | null;
  remaining_days?: number | null;
  completed_days?: number | null;
  board_column?: string;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
  closed_at?: string | null;
  // joined
  type_slug?: string; type_name?: string; type_color?: string; type_icon?: string;
  state_slug?: string; state_name?: string; state_color?: string; state_is_terminal?: 0 | 1;
  assignee_name?: string | null; assignee_email?: string | null;
}

// ============================================================================
// HR
// ============================================================================

export interface HrEmployee {
  id?: number;
  admin_user_id: number;
  first_name: string;
  last_name: string;
  preferred_name?: string | null;
  dob?: string | null;
  phone?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  region?: string | null;
  postcode?: string | null;
  country?: string | null;
  emergency_name?: string | null;
  emergency_phone?: string | null;
  emergency_rel?: string | null;
  position?: string | null;
  department?: string | null;
  employment_type?: 'full_time' | 'part_time' | 'contractor' | 'intern';
  manager_id?: number | null;
  hire_date?: string | null;
  end_date?: string | null;
  status?: 'onboarding' | 'active' | 'on_leave' | 'terminated';
  salary_amount?: number | null;
  salary_currency?: string;
  salary_period?: 'hourly' | 'monthly' | 'annual';
  pto_days_year?: number;
  notes?: string | null;
  // identity / personal
  pronouns?: string | null;
  gender?: string | null;
  nationality?: string | null;
  current_location?: string | null;
  national_insurance_number?: string | null;
  linkedin_url?: string | null;
  // tax / payroll
  tax_code?: string | null;
  student_loan_plan?: 'none' | 'plan_1' | 'plan_2' | 'plan_4' | 'postgrad';
  pension_opt_in?: 0 | 1 | boolean;
  pension_employee_pct?: number;
  pension_employer_pct?: number;
  bank_name?: string | null;
  bank_account_name?: string | null;
  sort_code?: string | null;
  account_number?: string | null;
  // background
  criminal_record_declared?: 0 | 1 | null;
  criminal_record_details?: string | null;
  dbs_check_ref?: string | null;
  dbs_check_date?: string | null;
  // equality (optional)
  ethnicity?: string | null;
  disability_status?: string | null;
  accommodations_needed?: string | null;
  dietary_requirements?: string | null;
  tshirt_size?: string | null;
  // onboarding portal
  onboarding_token?: string | null;
  onboarding_progress_json?: string | HrOnboardingProgress | null;
  onboarding_completed_at?: string | null;
  // joined
  email?: string;
  display_name?: string;
  role?: string;
  manager_first_name?: string | null;
  manager_last_name?: string | null;
}

export type HrOnboardingSection = 'profile' | 'contact' | 'emergency' | 'payroll' | 'documents' | 'tasks' | 'learning' | 'background' | 'references' | 'diversity';

export interface HrReference {
  id?: number;
  employee_id?: number;
  name: string;
  relationship?: string | null;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  position?: string | null;
  notes?: string | null;
  sort_order?: number;
}

export interface HrOnboardingProgress {
  [section: string]: {
    submitted_at?: string | null;
    verified_at?: string | null;
    verified_by?: number | null;
    rejected_at?: string | null;
    rejected_by?: number | null;
    rejected_reason?: string | null;
  } | undefined;
}

export interface HrOnboardingPortalSnapshot {
  employee: Partial<HrEmployee>;
  progress: HrOnboardingProgress;
  tasks: HrOnboardingTask[];
  documents: HrDocument[];
  document_types: HrDocumentType[];
  references: HrReference[];
  learning: HrCourseAssignment[];
}

export interface HrOnboardingTask {
  id?: number;
  employee_id?: number;
  title: string;
  description?: string | null;
  category?: string | null;
  linked_section?: HrOnboardingSection | null;
  due_date?: string | null;
  is_done?: 0 | 1 | boolean;
  done_at?: string | null;
  sort_order?: number;
}

export interface HrDocument {
  id?: number;
  employee_id?: number;
  doc_type_id?: number | null;
  category?: string;
  title: string;
  file_path: string;
  file_size?: number | null;
  mime_type?: string | null;
  reference_number?: string | null;
  issued_at?: string | null;
  expires_at?: string | null;
  uploaded_by?: number | null;
  uploaded_by_name?: string | null;
  uploaded_at?: string;
  requires_signature?: 0 | 1 | boolean;
  signed_at?: string | null;
  signed_by?: number | null;
  /** Joined from hr_document_types — set by /hr/me/documents so the signing flow can re-render the signed PDF. */
  template_blocks_json?: string | null;
}

/** Audience a contract template targets — drives fan-out to the
 *  corresponding `*_documents` table (migration 076). */
export type ContractAudience =
  | 'employee' | 'client' | 'lead' | 'partner' | 'affiliate'
  | 'contractor' | 'candidate' | 'applicant' | 'supplier' | 'investor';

/** Editable lookup row from `contract_types` (NDA / MSA / employment / …).
 *  Referenced by `HrDocumentType.contract_type_id`. */
export interface ContractType {
  id?: number;
  name: string;
  slug?: string;
  sort_order?: number;
}

/** Collapsible bucket for contract templates on the Contracts page (092).
 *  Referenced by `HrDocumentType.group_id`. */
export interface ContractGroup {
  id?: number;
  name: string;
  sort_order?: number;
}

/** One contract document attached to an entity (client/candidate/etc.), as
 *  surfaced on that entity's Contracts tab. `is_required` is read live from
 *  the linked hr_document_types template. */
export interface EntityContract {
  id: number;
  doc_type_id: number | null;
  category: string;
  title: string;
  file_path: string | null;
  mime_type: string | null;
  requires_signature: 0 | 1;
  signed_at: string | null;
  uploaded_at: string;
  is_required: 0 | 1;
  type_name: string | null;
  /** Client audience only (migration 145) — nullable link to a specific
   *  client_service_offerings row. When set, the Services tab shows a
   *  contract chip on the row and the Contracts tab tags the service. */
  client_service_offering_id?: number | null;
  service_name?: string | null;
}

/** hr_document_types row — a reusable contract template that admin can
 *  attach to an entity via the "+ Attach contract" flow. */
export interface ContractTemplate {
  id: number;
  name: string;
  description: string | null;
  kind: 'contract' | 'signed' | 'upload';
  /** The audience this template was originally created for. The attach
   *  picker no longer gates on this — every template is offered — but
   *  it's still surfaced as a badge so admins can tell them apart. */
  audience?: string;
  audience_match?: 0 | 1;
  contract_type_id: number | null;
  template_path: string | null;
  template_mime: string | null;
  is_required: 0 | 1;
}

export interface EntityContractsSummary {
  total: number;
  signed: number;
  required: number;
  required_signed: number;
  required_outstanding: number;
}

export interface EntityContractsResponse {
  documents: EntityContract[];
  summary: EntityContractsSummary;
}

export interface HrDocumentType {
  id?: number;
  name: string;
  description?: string | null;
  /** 'upload' = employee provides a file.
   *  'signed' = HR provides a template that every employee signs.
   *  'contract' = same as signed, but lives in its own UI bucket so HR can keep
   *  employment contracts separate from generic signed policies. */
  kind?: 'upload' | 'signed' | 'contract';
  /** Who the contract is for. Drives which `*_documents` table the rollout
   *  fans into. Migration 076. Defaults to 'employee' for legacy rows. */
  audience?: ContractAudience;
  /** FK to `contract_types.id` — categorises the template (NDA, MSA, etc.). */
  contract_type_id?: number | null;
  /** FK to `hr_contract_groups.id` — buckets contracts into collapsible
   *  sections on the Contracts page (092). Null = Ungrouped. */
  group_id?: number | null;
  /** When set on an employee contract, it appears in the new-hire HR
   *  onboarding portal's "Documents to sign" step (095). */
  add_to_onboarding?: 0 | 1 | boolean;
  template_path?: string | null;
  template_mime?: string | null;
  template_size?: number | null;
  /** When the template was authored in-app via the page builder, the source JSON lives here. */
  template_blocks_json?: string | null;
  is_required?: 0 | 1 | boolean;
  needs_reference?: 0 | 1 | boolean;
  needs_issue_date?: 0 | 1 | boolean;
  needs_expiry_date?: 0 | 1 | boolean;
  sort_order?: number;
}

/** A single ordered block inside a signed-document page. */
export type PdfDocBlockKind = 'heading' | 'text' | 'bullet' | 'image' | 'spacer' | 'variable';
export interface PdfDocBlock {
  id: string;
  kind: PdfDocBlockKind;
  /** Plain text for heading / text / bullet / variable.
   *  For `bullet`: each newline-separated line becomes a list item.
   *  For `variable`: holds the default body shown when no per-attachment
   *  override exists (the "obligations / terms / etc." text). */
  body?: string;
  /** Heading level 1–3 (heading kind only). */
  level?: 1 | 2 | 3;
  /** Stored upload path for image blocks. */
  url?: string;
  /** Optional accessible label for image blocks. */
  alt?: string;
  /** Variable-block label, e.g. "Price" or "Obligations" — surfaces in
   *  the token picker as `[[label-slug]]` so other blocks can reference
   *  this value too. */
  label?: string;
}
export interface PdfDocPage {
  id: string;
  blocks: PdfDocBlock[];
  /** Whether the standard Signature/Date footer renders on this page.
   *  Omitted on legacy docs created before this flag was added — the
   *  builder/renderer fall back to "last page only" for those. */
  show_sign_zone?: boolean;
}

export interface HrPtoSummary {
  allowance: number;
  accrued: number;
  taken: number;
  balance: number;
  ledger: HrPtoLedgerEntry[];
}
export interface HrPtoLedgerEntry {
  id?: number;
  employee_id?: number;
  effective_date: string;
  kind: 'accrual' | 'adjust' | 'taken' | 'reset';
  days: number;
  notes?: string | null;
  created_at?: string;
}

export interface HrPayrollPeriod {
  id?: number;
  name: string;
  start_date: string;
  end_date: string;
  pay_date?: string | null;
  status?: 'draft' | 'approved' | 'paid';
  notes?: string | null;
  payslip_count?: number;
  net_total?: number;
  created_at?: string;
}

export interface HrPayslip {
  id?: number;
  period_id?: number;
  employee_id: number;
  gross_amount?: number;
  tax_amount?: number;
  ni_amount?: number;
  other_deduct?: number;
  pension_amount?: number;
  employer_pension_amount?: number;
  bonus_amount?: number;
  net_amount?: number;
  currency?: string;
  notes?: string | null;
  // joined
  first_name?: string;
  last_name?: string;
  position?: string | null;
}

export interface HrReviewQuestion {
  id: string;
  type: 'rating' | 'text';
  label: string;
}

export interface HrReviewCycle {
  id?: number;
  name: string;
  period_start: string;
  period_end: string;
  due_date?: string | null;
  status?: 'draft' | 'active' | 'closed';
  questions_json?: string | HrReviewQuestion[];
  notes?: string | null;
  review_count?: number;
  completed_count?: number;
}

export interface HrReviewResponses {
  [questionId: string]: number | string | null;
}

export interface HrReview {
  id?: number;
  cycle_id: number;
  employee_id: number;
  manager_id?: number | null;
  status?: 'not_started' | 'self_review' | 'manager_review' | 'completed' | 'closed';
  employee_responses_json?: string | HrReviewResponses | null;
  manager_responses_json?: string | HrReviewResponses | null;
  employee_overall?: number | null;
  manager_overall?: number | null;
  employee_signed_at?: string | null;
  manager_signed_at?: string | null;
  goals_next_period?: string | null;
  // joined
  first_name?: string;
  last_name?: string;
  position?: string | null;
  cycle_name?: string;
  period_start?: string;
  period_end?: string;
  due_date?: string | null;
  questions_json?: string | HrReviewQuestion[];
}

export interface HrCourse {
  id?: number;
  title: string;
  provider?: string | null;
  category?: string | null;
  description?: string | null;
  link?: string | null;
  duration_hours?: number | null;
  is_required?: 0 | 1 | boolean;
  compliance_task_id?: number | null;
  is_active?: 0 | 1 | boolean;
  // joined
  assigned_count?: number;
  completed_count?: number;
  compliance_task_title?: string | null;
}

export interface HrCourseAssignment {
  id?: number;
  employee_id: number;
  course_id: number;
  assigned_by?: number | null;
  assigned_at?: string;
  due_date?: string | null;
  status?: 'not_started' | 'in_progress' | 'completed' | 'expired';
  completed_at?: string | null;
  score?: number | null;
  certificate_path?: string | null;
  notes?: string | null;
  assign_scope?: 'individual' | 'department' | 'company';
  assign_scope_value?: string | null;
  // joined
  title?: string;
  provider?: string | null;
  category?: string | null;
  link?: string | null;
  duration_hours?: number | null;
  is_required?: 0 | 1 | boolean;
  /** Course → compliance link, set when a course satisfies a compliance obligation. */
  compliance_task_id?: number | null;
  compliance_task_title?: string | null;
  /** Total modules on the course (text/video/quiz). */
  module_count?: number;
  /** Modules this assignment has completed (their progress row has completed_at). */
  modules_completed?: number;
  first_name?: string;
  last_name?: string;
}

export type HrCourseModuleKind = 'text' | 'video' | 'quiz';

export interface HrQuizQuestion {
  id: string;
  prompt: string;
  options: string[];
  /** Indices of correct options. Sent only to admins; stripped before reaching the player. */
  correct?: number[];
}

export interface HrCourseModuleImage {
  url: string;
  position: 'above' | 'below';
  alt?: string;
}

export type HrSlideBlockKind = 'copy' | 'image' | 'video';

export interface HrSlideBlock {
  id: string;
  kind: HrSlideBlockKind;
  /** Plain text for copy blocks. */
  body?: string;
  /** Stored upload path for image blocks, or external link for video blocks. */
  url?: string;
  /** Optional accessible label for image blocks. */
  alt?: string;
}

export interface HrCourseModule {
  id?: number;
  course_id: number;
  title: string;
  kind: HrCourseModuleKind;
  body?: string | null;
  video_url?: string | null;
  /** JSON-encoded list of HrQuizQuestion. The player receives a string with `correct` keys removed. */
  quiz_json?: string | null;
  /** JSON-encoded HrCourseModuleImage[] (legacy text-module shape, kept for back-compat). */
  images_json?: string | null;
  /** JSON-encoded HrSlideBlock[] — the new ordered-block shape for slide modules. */
  blocks_json?: string | null;
  pass_score?: number;
  sort_order?: number;
}

export interface HrCourseModuleProgress {
  module_id: number;
  completed_at?: string | null;
  quiz_score?: number | null;
  quiz_attempts?: number;
}

export interface HrCoursePlayerSnapshot {
  assignment: HrCourseAssignment;
  modules: HrCourseModule[];
  progress: HrCourseModuleProgress[];
}

export interface HrQuizResult {
  score: number;
  total: number;
  correct: number;
  wrong_ids: string[];
  passed: boolean;
  pass_score: number;
}

export interface HrCertification {
  id?: number;
  employee_id?: number;
  name: string;
  issuer?: string | null;
  issued_at?: string | null;
  expires_at?: string | null;
  credential_id?: string | null;
  file_path?: string | null;
  notes?: string | null;
  created_at?: string;
  // joined
  first_name?: string;
  last_name?: string;
}

export interface HrJob {
  id?: number;
  title: string;
  slug?: string;
  department?: string | null;
  location?: string | null;
  employment_type?: 'full_time' | 'part_time' | 'contractor' | 'intern';
  salary_min?: number | null;
  salary_max?: number | null;
  salary_currency?: string;
  description?: string | null;
  responsibilities?: string | null;
  benefits?: string | null;
  hiring_manager_id?: number | null;
  status?: 'draft' | 'open' | 'closed';
  posted_at?: string | null;
  closed_at?: string | null;
  application_count?: number;
  hired_count?: number;
  // joined
  hm_first?: string;
  hm_last?: string;
  app_count?: number;
  active_count?: number;
}

export interface HrCandidate {
  id?: number;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string | null;
  cv_path?: string | null;
  linkedin_url?: string | null;
  source?: string | null;
  notes?: string | null;
  created_at?: string;
}

export interface HrApplication {
  id?: number;
  job_id: number;
  candidate_id: number;
  stage?: 'applied' | 'screening' | 'interview' | 'offer' | 'hired' | 'rejected';
  rating?: number | null;
  recruiter_notes?: string | null;
  applied_at?: string;
  decided_at?: string | null;
  sort_order?: number;
  // joined
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string | null;
  cv_path?: string | null;
  linkedin_url?: string | null;
  source?: string | null;
  job_title?: string;
  c_first?: string;
  c_last?: string;
}

export interface HrInterview {
  id?: number;
  application_id?: number;
  scheduled_at: string;
  kind?: 'phone' | 'video' | 'onsite' | 'technical' | 'culture' | 'panel' | 'other';
  interviewer_id?: number | null;
  feedback?: string | null;
  rating?: number | null;
  // joined
  interviewer_name?: string | null;
}

export interface HrApplicationNote {
  id?: number;
  application_id?: number;
  author_id?: number | null;
  body: string;
  created_at?: string;
  // joined
  author_name?: string | null;
}

export interface HrSuccessionPlan {
  id?: number;
  key_role: string;
  current_holder_id?: number | null;
  risk_level?: 'low' | 'medium' | 'high';
  notes?: string | null;
  // joined
  holder_first_name?: string | null;
  holder_last_name?: string | null;
  holder_first?: string | null;
  holder_last?: string | null;
  holder_manager_id?: number | null;
  candidate_count?: number;
  candidates?: HrSuccessionCandidate[];
}
export interface HrSuccessionCandidate {
  id?: number;
  plan_id?: number;
  employee_id: number;
  readiness?: 'now' | '1-2y' | '3-5y';
  notes?: string | null;
  // joined
  first_name?: string;
  last_name?: string;
  position?: string | null;
  department?: string | null;
}

export interface HrSurveyQuestion {
  id: string;
  type: 'rating' | 'text';
  label: string;
}

export interface HrPulseSurvey {
  id?: number;
  title: string;
  description?: string | null;
  is_anonymous?: 0 | 1 | boolean;
  questions_json?: string | HrSurveyQuestion[];
  status?: 'draft' | 'open' | 'closed';
  opens_at?: string | null;
  closes_at?: string | null;
  public_token?: string | null;
  allow_external?: 0 | 1 | boolean;
  response_count?: number;
  already_answered?: 0 | 1 | boolean;
}

export interface PublicSurveyDef {
  title: string;
  description?: string | null;
  is_anonymous?: 0 | 1 | boolean;
  questions: HrSurveyQuestion[];
}

export interface HrPulseAggregate {
  [questionId: string]: { avg: number | null; count: number };
}

export interface HrFeedbackEntry {
  id?: number;
  employee_id?: number | null;
  category?: string;
  message: string;
  status?: 'new' | 'reviewed' | 'actioned' | 'archived';
  reviewed_by?: number | null;
  reviewed_at?: string | null;
  created_at?: string;
  // joined
  first_name?: string | null;
  last_name?: string | null;
}

export type HrComplianceTaskType = 'training' | 'document' | 'audit' | 'employee' | 'other';

export interface HrComplianceTask {
  id?: number;
  title: string;
  description?: string | null;
  jurisdiction?: string;
  frequency?: 'one_off' | 'monthly' | 'quarterly' | 'annual' | 'custom';
  task_type?: HrComplianceTaskType;
  last_done_at?: string | null;
  next_due_at: string;
  owner_id?: number | null;
  status?: 'upcoming' | 'due' | 'overdue' | 'done' | 'archived';
  notes?: string | null;
  // joined
  owner_name?: string | null;
}

export interface HrGoal {
  id?: number;
  employee_id: number;
  created_by?: number | null;
  title: string;
  description?: string | null;
  measurable?: string | null;
  due_date?: string | null;
  status?: 'not_started' | 'in_progress' | 'completed' | 'cancelled';
  progress_pct?: number;
  created_at?: string;
  // joined
  first_name?: string;
  last_name?: string;
}

export interface HrShift {
  id?: number;
  employee_id: number;
  created_by?: number | null;
  shift_date: string;
  start_time: string;
  end_time: string;
  role?: string | null;
  location?: string | null;
  notes?: string | null;
  status?: 'scheduled' | 'swap_requested' | 'swapped' | 'cancelled';
  created_at?: string;
  // joined
  first_name?: string;
  last_name?: string;
}

export interface HrSkill {
  id?: number;
  name: string;
  category?: string | null;
  description?: string | null;
  created_at?: string;
}

export interface HrEmployeeSkill {
  id?: number;
  employee_id: number;
  skill_id: number;
  current_level: number;   // 0–5
  target_level: number;    // 0–5
  notes?: string | null;
  assessed_at?: string | null;
  // joined
  skill_name?: string;
  category?: string | null;
  first_name?: string;
  last_name?: string;
}

export type HrFeedbackNoteKind = 'feedback' | 'one_on_one' | 'coaching' | 'recognition';

export interface HrFeedbackNote {
  id?: number;
  employee_id: number;
  author_id?: number | null;
  kind: HrFeedbackNoteKind;
  body: string;
  meeting_date?: string | null;
  visibility?: 'private' | 'shared';
  created_at?: string;
  // joined
  author_name?: string | null;
  author_email?: string | null;
}

export interface HrEmployeeNote {
  id?: number;
  employee_id: number;
  user_id?: number | null;
  body: string;
  created_at?: string;
  author_name?: string | null;
  author_email?: string | null;
}

/** Legal document — policy, T&Cs, privacy, etc. Each row gets its own page
 *  at /hr/legal/:slug. Body is HTML (rendered with [innerHTML]). */
export interface HrLegalDocument {
  id?: number;
  slug?: string;
  title: string;
  /** Free-form bucket. Frontend offers a soft list (policy / terms / privacy / other). */
  category?: string;
  summary?: string | null;
  body?: string | null;
  is_published?: 0 | 1 | boolean;
  /** Whether this doc appears in the public /legal sidenav. Defaults to 1. */
  show_in_sidenav?: 0 | 1 | boolean;
  /** Self-FK — parent doc this one nests under in the sidenav. Null = top-level. */
  parent_id?: number | null;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
  created_by?: number | null;
  updated_by?: number | null;
}

export interface HrSuccessionPlanNote {
  id?: number;
  plan_id: number;
  user_id?: number | null;
  body: string;
  created_at?: string;
  author_name?: string | null;
  author_email?: string | null;
}

export interface HrSuccessionCandidateNote {
  id?: number;
  candidate_id: number;
  user_id?: number | null;
  body: string;
  created_at?: string;
  author_name?: string | null;
  author_email?: string | null;
}

export interface HrComplianceNote {
  id?: number;
  task_id: number;
  user_id?: number | null;
  body: string;
  created_at?: string;
  // joined
  author_name?: string | null;
  author_email?: string | null;
}

export interface HrChangeRequest {
  id?: number;
  employee_id?: number;
  field: string;
  old_value?: string | null;
  new_value?: string | null;
  note?: string | null;
  status?: 'pending' | 'approved' | 'denied' | 'cancelled';
  reviewed_by?: number | null;
  reviewed_at?: string | null;
  created_at?: string;
  // joined
  first_name?: string;
  last_name?: string;
}

export interface HrTimeOffEntry {
  id?: number;
  employee_id: number;
  kind: 'vacation' | 'sick' | 'personal' | 'unpaid' | 'other';
  start_date: string;
  end_date: string;
  days?: number;
  notes?: string | null;
  status?: 'pending' | 'approved' | 'denied' | 'cancelled';
  reviewed_by?: number | null;
  reviewed_at?: string | null;
  // joined
  first_name?: string;
  last_name?: string;
  position?: string | null;
}

export interface AdminUserRecord {
  id?: number;
  email: string;
  display_name: string;
  role?: 'admin' | 'member' | 'viewer';
  is_active?: 0 | 1 | boolean;
  password?: string;
  created_at?: string;
}

export type SubscriptionTier = 'trial' | 'starter' | 'growth' | 'scale' | 'business' | 'enterprise_lite' | 'enterprise';

/** Response from GET /api/users/subscription — tenant's tier, cap, and
 *  live usage so the UI can render "3 of 5 active users" + upgrade CTAs. */
// ─── Billing (migration 129/130) ─────────────────────────────────
export interface PaymentMethod {
  id: number;
  type: 'card' | 'bank' | 'other';
  brand?: string | null;
  last4?: string | null;
  holder_name?: string | null;
  expires_month?: number | null;
  expires_year?: number | null;
  is_default: 0 | 1;
  provider?: string | null;
  external_id?: string | null;
  created_at?: string;
}

export interface SubscriptionInvoice {
  id: number;
  invoice_number: string;
  description: string;
  amount_cents: number;
  currency: string;
  status: 'draft' | 'sent' | 'paid' | 'failed' | 'refunded';
  issued_at?: string | null;
  due_at?: string | null;
  paid_at?: string | null;
  pdf_url?: string | null;
  provider?: string | null;
  created_at?: string;
}

export interface BillingProfile {
  id: number;
  brand_name: string;
  subscription_tier: SubscriptionTier;
  billing_email?: string | null;
  billing_address?: string | null;
  vat_number?: string | null;
  pending_tier?: SubscriptionTier | null;
  pending_cadence?: 'monthly' | 'yearly' | null;
  pending_effective_at?: string | null;
}

export interface BillingSummary {
  profile: BillingProfile;
  payment_methods: PaymentMethod[];
  invoices: SubscriptionInvoice[];
}

export interface SubscriptionPlan {
  id: number;
  tier: SubscriptionTier;
  name: string;
  tagline?: string | null;
  user_range_label?: string | null;
  max_users: number | null;
  price_monthly_cents: number;
  price_yearly_cents: number;
  currency: string;
  is_contact_sales: 0 | 1;
  is_highlight: 0 | 1;
  is_active: 0 | 1;
  features: string[];
  stripe_price_monthly?: string | null;
  stripe_price_yearly?: string | null;
  sort_order: number;
}

export interface StripeConfig {
  configured: boolean;
  publishable_key: string | null;
  price_ids: Partial<Record<SubscriptionTier, string | null>>;
  tenant: {
    stripe_customer_id?: string | null;
    stripe_subscription_id?: string | null;
    stripe_status?: string | null;
    stripe_current_period_end?: string | null;
    stripe_default_pm_id?: string | null;
  };
}

export interface StripeSetupIntent {
  client_secret: string;
  setup_intent_id: string;
  customer_id: string;
}

export interface StripeSubscribeResult {
  subscription_id: string;
  status: string;
  client_secret: string | null;
  requires_action: boolean;
}

export interface UsersSubscription {
  tier: SubscriptionTier;
  /** null = enterprise (unlimited). */
  max_active_users: number | null;
  active_count: number;
  at_cap: boolean;
  tier_ladder: { tier: SubscriptionTier; max_active_users: number | null }[];
}

/** Grouped form-submission listing for a client / lead / service.
 *  Backed by `/api/form-submission-links/for/:type/:id`. */
/** Picker payload for the "+ Attach submission" modal. Returns every
 *  form in the tenant grouped with its recent submissions, marking
 *  which are already linked to the current record so the UI can
 *  disable those rows. */
export interface FormSubmissionCandidateGroup {
  form: {
    id: number;
    title: string;
    slug: string;
    form_type: 'standard' | 'onboarding';
    submission_table: string;
  };
  submissions: {
    submission_id: number;
    label: string;
    submitted_at?: string | null;
    already_linked: boolean;
  }[];
}

/** Invitation record shared by standard forms + multipart onboarding.
 *  Backed by the `onboarding_clients` table (client_token + parent
 *  ids). One invite = one tokenised URL for one recipient. */
export interface FormInvite {
  id: number;
  client_email: string;
  client_name?: string | null;
  parent_client_id?: number | null;
  parent_lead_id?: number | null;
  /** Resolved display name from clients.name / leads.name — nullable. */
  client_name_resolved?: string | null;
  lead_name_resolved?: string | null;
  token: string;
  url: string;
  started_at: string;
  submitted_at?: string | null;
  status: 'pending' | 'submitted';
}

export interface FormSubmissionLinkGroup {
  form: {
    id: number;
    title: string;
    slug: string;
    form_type: 'standard' | 'onboarding';
    /** Set when the form is pinned to a catalogue service. Drives the
     *  "expand a catalog service row to see its onboarding" behaviour
     *  on the client Services tab. */
    service_offering_id: number | null;
  };
  submissions: {
    link_id: number;
    submission_id: number;
    submitted_at?: string | null;
    link_source: 'token' | 'manual' | 'auto';
    linked_at: string;
    /** true when the link's client/lead is actively on the linked
     *  service - detach is refused server-side and the UI hides the
     *  button. Terminal-status service rows (done / on_hold) return
     *  false so the link becomes detachable once the service closes. */
    is_compulsory: boolean;
    data: Record<string, any> | null;
  }[];
  bucket: 'service' | 'default' | 'broadcast';
}

export interface AdminSection {
  id?: number;
  slug: string;
  title: string;
  description?: string | null;
  sidenav_placement?: 'top' | 'child';
  sidenav_parent_key?: string | null;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
}

export interface OnboardingClient {
  id: number;
  form_id: number;
  parent_client_id?: number | null;
  submission_id?: number | null;
  client_email: string;
  client_name?: string | null;
  client_token: string;
  completed_sections?: string | null; // JSON array stringified
  started_at: string;
  last_edited_at?: string | null;
  submitted_at?: string | null;
  qualified_at?: string | null;
  edited_after_submit?: 0 | 1;
  url?: string;
  // present on cross-form list
  form_title?: string;
  form_slug?: string;
  total_sections?: number;
  // Required-field progress (set by list endpoints)
  total_required?: number;
  filled_required?: number;
}

export interface AdminUser {
  id: number;
  email: string;
  display_name: string;
  role?: 'admin' | 'member' | 'viewer';
  /** Per-user override for `tenants.color_theme`. NULL/undefined means
   *  the user inherits the tenant default; set to one of the six theme
   *  slugs to opt out of org branding for personal viewing only. */
  color_theme?: string | null;
  super?: boolean;
  created_at?: string;
}

// Newsletter — see migration 065. Status flow:
//   draft → scheduled → sending → sent | failed
export type NewsletterStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed';

export interface NewsletterCampaign {
  id?: number;
  subject: string;
  body_html?: string;
  /** Builder structure (serialized array of NewsletterBlock — see
   *  features/newsletter/newsletter-blocks.ts). Null for legacy campaigns
   *  authored before the builder existed. */
  blocks_json?: string | null;
  audience_clients?: 0 | 1 | boolean;
  audience_leads?: 0 | 1 | boolean;
  audience_custom_emails?: string | null;
  status?: NewsletterStatus;
  scheduled_at?: string | null;
  sent_at?: string | null;
  recipient_count?: number;
  sent_count?: number;
  failed_count?: number;
  last_error?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface NewsletterRecipient {
  id: number;
  campaign_id?: number;
  email: string;
  name?: string | null;
  source: 'client' | 'lead' | 'custom';
  source_id?: number | null;
  status: 'pending' | 'sent' | 'failed' | 'suppressed';
  sent_at?: string | null;
  error_msg?: string | null;
}

// Tenders — Operations system, migration 068.
export type TenderStatus = 'planning' | 'drafting' | 'submitted' | 'awarded' | 'rejected' | 'withdrawn';

export interface Tender {
  id?: number;
  title: string;
  buyer?: string | null;
  reference?: string | null;
  value?: number | string | null;
  currency?: string;
  category?: string | null;
  source_url?: string | null;
  submission_deadline?: string | null;
  decision_date?: string | null;
  status?: TenderStatus;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

/**
 * A scraped tender opportunity ("lead") returned by the UK tender aggregator
 * endpoint (`cms/scraper/tenders.php` — Find a Tender + Contracts Finder).
 * Read-only feed; a lead can be promoted into a tracked {@link Tender}.
 */
export interface TenderLeadContact { name?: string | null; email?: string | null; phone?: string | null; url?: string | null; }
export interface TenderLeadAddress { street?: string | null; locality?: string | null; region?: string | null; postcode?: string | null; country?: string | null; }
export interface TenderLeadParty {
  name?: string | null;
  id?: string | null;
  roles?: string[];
  buyerType?: string | null;
  website?: string | null;
  contact?: TenderLeadContact | null;
  address?: TenderLeadAddress | null;
}
export interface TenderLeadValue { amount: number | null; currency: string; }
export interface TenderLeadCriterion { type?: string | null; name?: string | null; weight?: number | string | null; description?: string | null; }
export interface TenderLeadLot {
  id?: string | null;
  title?: string | null;
  description?: string | null;
  value?: { amount?: number | null; currency?: string | null };
  contractPeriod?: { start?: string | null; end?: string | null; days?: number | null };
  suitableForSME?: boolean | null;
  suitableForVCSE?: boolean | null;
  hasRenewal?: boolean | null;
  renewal?: string | null;
  hasOptions?: boolean | null;
  options?: string | null;
  awardCriteria?: TenderLeadCriterion[];
}
export interface TenderLeadMilestone { type?: string | null; title?: string | null; dueDate?: string | null; }
export interface TenderLeadDocument {
  title?: string | null;
  type?: string | null;
  description?: string | null;
  url: string;
  format?: string | null;
  language?: string | null;
  published?: string | null;
}
export interface TenderLeadFramework { isFramework?: boolean; method?: string | null; periodEnd?: string | null; maxParticipants?: number | null; description?: string | null; }
export interface TenderLeadSubmission { methods?: unknown; url?: string | null; electronicAuction?: boolean | null; languages?: unknown; variantPolicy?: string | null; }
export interface TenderLeadParticipation { fees?: unknown; reservedParticipation?: unknown; minimumCandidates?: number | null; }
export interface TenderLeadDeliveryAddress { street?: string | null; locality?: string | null; region?: string | null; postcode?: string | null; description?: string | null; }

export interface TenderLead {
  id: string;
  noticeId?: string | null;
  source: string;
  noticeType?: string | null;
  language?: string | null;
  title: string;
  description?: string;
  status?: string;
  types: string[];
  buyer?: TenderLeadParty | null;
  parties?: TenderLeadParty[];
  value?: TenderLeadValue | null;
  cpvCodes?: string[];
  mainCategory?: string | null;
  regions?: string[];
  deliveryAddresses?: TenderLeadDeliveryAddress[];
  publishedDate?: string | null;
  deadline?: string | null;
  enquiryDeadline?: string | null;
  contractStart?: string | null;
  contractEnd?: string | null;
  contractDays?: number | null;
  procedureType?: string | null;
  legalBasis?: string | null;
  coveredByGPA?: boolean | null;
  suitableForSME?: boolean | null;
  suitableForVCSE?: boolean | null;
  framework?: TenderLeadFramework | null;
  lots?: TenderLeadLot[];
  lotCount?: number;
  milestones?: TenderLeadMilestone[];
  selectionCriteria?: TenderLeadCriterion[];
  awardCriteria?: TenderLeadCriterion[];
  submission?: TenderLeadSubmission | null;
  participation?: TenderLeadParticipation | null;
  link?: string | null;
  documents?: TenderLeadDocument[];
  importedAt?: string | null;
}
export interface TenderLeadFeed {
  meta: {
    generatedAt?: string;
    window?: { from: string; to: string };
    count: number;
    sources?: string[];
    stored?: boolean;
    filters?: { type: string[]; cpv?: string[]; q: string };
    errors?: { source: string; url?: string; httpCode?: number; error: string }[];
  };
  tenders: TenderLead[];
}
export interface TenderLeadImportResult {
  imported: number;
  updated: number;
  skipped?: number;
  fetched: number;
  days?: number;
  window?: { from: string; to: string } | null;
  errors?: { source: string; error: string }[];
}

export interface TenderInfo {
  id?: number;
  tender_id?: number;
  name: string;
  value?: string | null;
  sort_order?: number;
}

export interface TenderContactNumber {
  id?: number;
  contact_id?: number;
  number: string;
  label?: string | null;
  sort_order?: number;
}

export interface TenderContact {
  id?: number;
  tender_id?: number;
  first_name: string;
  last_name?: string | null;
  position?: string | null;
  email?: string | null;
  is_primary?: 0 | 1 | boolean;
  sort_order?: number;
  numbers?: TenderContactNumber[];
}

/** Legacy column on tender_documents — kept nullable for the few rows
 *  authored before sections existed. The current UI groups by section_id. */
export type TenderDocumentKind = 'application' | 'proposal' | 'pitch_deck';

export interface TenderSection {
  id?: number;
  tender_id?: number;
  slug: string;
  label: string;
  is_completed?: 0 | 1 | boolean;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
}

export interface TenderDocument {
  id?: number;
  tender_id?: number;
  section_id?: number | null;
  kind?: TenderDocumentKind | null;
  title: string;
  description?: string | null;
  external_url?: string | null;
  file_path?: string | null;
  file_size?: number | null;
  mime_type?: string | null;
  sort_order?: number;
  is_completed?: 0 | 1 | boolean;
  created_at?: string;
  updated_at?: string;
}

/** Manual task tracked in `operation_tasks` (migration 071). Surfaced on
 *  the Operations Taskboard alongside the auto-derived tender tracker rows. */
export type OperationTaskStatus   = 'to_do' | 'in_progress' | 'done';
export type OperationTaskPriority = 'low' | 'medium' | 'high';

export interface OperationTask {
  id?: number;
  title: string;
  description?: string | null;
  category?: string | null;
  status?: OperationTaskStatus;
  priority?: OperationTaskPriority;
  due_date?: string | null;
  tender_id?: number | null;
  tender_title?: string | null;
  completed_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

// ───── Operations: Documents (aggregated view) ─────────────────────
/** Single normalized row returned by /api/operations/documents — unions
 *  rows from hr_documents and tender_documents so the Operations Documents
 *  page can show every uploaded file across systems in one table.
 *
 *  `file_path` is cms-relative (e.g. 'uploads/hr/12/1234_file.pdf'); the
 *  frontend prefixes `environment.basePath` to build a usable URL. */
export type OperationsDocumentStatus = 'valid' | 'pending' | 'expired';
export interface OperationsDocument {
  uid: string;
  system: 'hr' | 'tender' | 'recruitment';
  owner_type: string;
  owner_id: number;
  owner_name: string;
  doc_type: string;
  title: string;
  reference: string | null;
  status: OperationsDocumentStatus;
  uploaded_at: string;
  expires_at: string | null;
  issued_at: string | null;
  file_path: string;
  file_size: number | null;
  mime_type: string | null;
}

/** Response from /api/operations/documents/browse — one directory level
 *  rooted at cms/uploads/. `path` is the sub-path relative to the root
 *  ('' = root); `parent` is the parent sub-path or null at the root. */
export interface OperationsDocumentsBrowse {
  path: string;
  parent: string | null;
  entries: {
    name: string;
    type: 'dir' | 'file';
    size: number | null;
    modified: string;
    path: string;
  }[];
}

// ───── Operations: Partners (migration 072) ────────────────────────
export type PartnerStatus = 'prospective' | 'active' | 'paused' | 'terminated';
export type PartnerType   = 'strategic' | 'reseller' | 'technology' | 'channel' | 'referral' | 'other';
export type PartnerTier   = 'preferred' | 'standard' | 'prospective';

export interface Partner {
  id?: number;
  legal_name: string;
  trading_name?: string | null;
  partnership_type?: PartnerType;
  tier?: PartnerTier;
  status?: PartnerStatus;
  start_date?: string | null;
  renewal_date?: string | null;
  auto_renew?: 0 | 1 | boolean;
  contract_value?: number | string | null;
  currency?: string;
  primary_email?: string | null;
  primary_phone?: string | null;
  website?: string | null;
  address?: string | null;
  registration_number?: string | null;
  vat_number?: string | null;
  scope?: string | null;
  relationship_owner_id?: number | null;
  owner_email?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface PartnerContact {
  id?: number;
  partner_id?: number;
  first_name: string;
  last_name?: string | null;
  position?: string | null;
  email?: string | null;
  phone?: string | null;
  is_primary?: 0 | 1 | boolean;
  sort_order?: number;
}

export interface PartnerNote {
  id?: number;
  partner_id?: number;
  title: string;
  body?: string | null;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
}

export interface PartnerAccount {
  id?: number;
  partner_id?: number;
  account_name: string;
  login_url?: string | null;
  username?: string | null;
  password?: string | null;
  sort_order?: number;
}

// ───── Operations: Contractors (migration 073) ─────────────────────
export type ContractorStatus  = 'active' | 'inactive' | 'on_break' | 'ended';
export type ContractorType    = 'individual' | 'agency' | 'freelancer' | 'consultant';
export type ContractorSource  = 'internal' | 'external';
export type EngagementType    = 'hourly' | 'daily' | 'project' | 'retainer' | 'full_time' | 'part_time';
export type Ir35Status        = 'inside' | 'outside' | 'not_applicable' | 'unknown';

export interface Contractor {
  id?: number;
  name: string;
  contractor_type?: ContractorType;
  internal_external?: ContractorSource;
  discipline?: string | null;
  status?: ContractorStatus;
  engagement_type?: EngagementType;
  rate?: number | string | null;
  currency?: string;
  start_date?: string | null;
  end_date?: string | null;
  primary_email?: string | null;
  primary_phone?: string | null;
  website?: string | null;
  address?: string | null;
  tax_id?: string | null;
  vat_number?: string | null;
  company_number?: string | null;
  ir35_status?: Ir35Status;
  notes?: string | null;
  project_manager_id?: number | null;
  manager_email?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ContractorNote {
  id?: number;
  contractor_id?: number;
  title: string;
  body?: string | null;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
}

// ───── Operations: Affiliates (migration 074) ──────────────────────
export type AffiliateStatus     = 'pending' | 'active' | 'paused' | 'suspended' | 'terminated';
export type AffiliateTier       = 'bronze' | 'silver' | 'gold' | 'platinum';
export type AffiliateType       = 'individual' | 'company';
export type CommissionType      = 'percentage' | 'flat';
export type AffiliatePayoutMethod = 'bank_transfer' | 'paypal' | 'stripe' | 'other';

export interface Affiliate {
  id?: number;
  name: string;
  affiliate_type?: AffiliateType;
  status?: AffiliateStatus;
  tier?: AffiliateTier;
  affiliate_code: string;
  referral_link?: string | null;
  commission_rate?: number | string | null;
  commission_type?: CommissionType;
  currency?: string;
  payout_method?: AffiliatePayoutMethod;
  payout_threshold?: number | string | null;
  payment_terms?: string | null;
  marketing_channel?: string | null;
  joined_date?: string | null;
  end_date?: string | null;
  primary_email?: string | null;
  primary_phone?: string | null;
  website?: string | null;
  social_handles?: string | null;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface AffiliateNote {
  id?: number;
  affiliate_id?: number;
  title: string;
  body?: string | null;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
}

/** Tracker response from /api/tenders/tracker. Each bucket is a Tender row
 *  with the fields needed to render the reminder card. */
export interface TenderTrackerRow extends Tender {
  open_sections?: number;
  total_sections?: number;
}
export interface TenderTracker {
  overdue: TenderTrackerRow[];
  due_soon: TenderTrackerRow[];
  awaiting_decision: TenderTrackerRow[];
  incomplete: TenderTrackerRow[];
  stale: TenderTrackerRow[];
  threshold_days: number;
}

export interface TenderNote {
  id?: number;
  tender_id?: number;
  title: string;
  body?: string | null;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
}

export interface AppSettings {
  smtp_host?: string;
  smtp_port?: string;
  smtp_user?: string;
  smtp_pass?: string;
  smtp_secure?: string;
  smtp_from_email?: string;
  smtp_from_name?: string;
  brand_name?: string;
  brand_logo_url?: string;
  public_form_bg_color?: string;
  upload_max_mb?: string;
  // Organisation-level settings surfaced on the General tab. Note:
  // brand_name + brand_logo_url double as the org identity — they
  // drive the sidebar header, public forms, onboarding portals, and
  // any other place the app shows the tenant's name/mark.
  org_website?: string;
  org_contact_email?: string;
  org_timezone?: string;
  [k: string]: string | undefined;
}

// ───── Recruitment (migration 077) ──────────────────────────────────
export type RecruitmentCandidateStatus =
  'new' | 'interviewing' | 'processing' | 'compliant'
  | 'client_screening' | 'placed' | 'rejected_by_us';
export type RecruitmentExperienceLevel = 'junior' | 'mid' | 'senior' | 'lead' | 'principal';
export type RecruitmentAvailability    = 'immediate' | 'one_week' | 'two_weeks' | 'one_month' | 'later';
export type RecruitmentDocStatus       = 'pending' | 'valid' | 'expired' | 'rejected';
export type RecruitmentGender          = 'male' | 'female' | 'other' | 'prefer_not_to_say';

export interface RecruitmentCandidate {
  id?: number;
  first_name: string;
  last_name: string;
  email?: string | null;
  phone?: string | null;
  dob?: string | null;
  nationality?: string | null;
  gender?: RecruitmentGender | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  region?: string | null;
  postcode?: string | null;
  country?: string | null;
  /** Holds a valid driving licence. Migration 080. */
  has_driving_license?: 0 | 1 | boolean;
  /** Separate from holding a licence: willing/able to drive for work
   *  (commute to sites, drive between clients, etc.). */
  willing_to_drive?: 0 | 1 | boolean;
  role?: string | null;
  /** Agency-side taxonomy ("Clinical Lead", "Site Engineer", etc.). */
  candidate_type?: string | null;
  discipline?: string | null;
  experience_level?: RecruitmentExperienceLevel | null;
  experience_years?: number | null;
  /** Comma-separated skill tags. Split on display. Migration 080. */
  skills?: string | null;
  day_rate?: number | string | null;
  currency?: string;
  availability?: RecruitmentAvailability | null;
  cv_file_path?: string | null;
  cv_file_size?: number | null;
  cv_mime_type?: string | null;
  status?: RecruitmentCandidateStatus;
  source?: string | null;
  contract_doc_id?: number | null;
  contract_signed_at?: string | null;
  notes?: string | null;
  /** Per-candidate token for the public onboarding portal. Generated by
   *  the API on create; existing rows were backfilled by migration 087.
   *  Powers /recruitment-onboarding/<token>. */
  onboarding_token?: string | null;
  created_at?: string;
  updated_at?: string;
}

/** Shape returned by GET /api/public-recruitment-onboarding/:token —
 *  candidate snapshot + the doc-type checklist (filtered to
 *  `add_to_onboarding = 1`, bucketed by group). Drives the candidate
 *  portal at /recruitment-onboarding/<token>. */
export interface RecruitmentOnboardingPortalSnapshot {
  candidate: {
    id: number;
    first_name: string;
    last_name: string;
    email: string | null;
    phone: string | null;
    dob: string | null;
    gender: RecruitmentGender | null;
    nationality: string | null;
    address_line1: string | null;
    address_line2: string | null;
    city: string | null;
    region: string | null;
    postcode: string | null;
    country: string | null;
    has_driving_license: 0 | 1;
    willing_to_drive: 0 | 1;
    role: string | null;
    discipline: string | null;
    experience_level: RecruitmentExperienceLevel | null;
    experience_years: number | null;
    skills: string | null;
    availability: RecruitmentAvailability | null;
    cv_file_path: string | null;
    contract_signed_at: string | null;
  };
  doc_groups: Array<{
    id: number;
    name: string;
    items: Array<{
      doc_type_id: number;
      name: string;
      description: string | null;
      is_required: 0 | 1;
      submission_type: RecruitmentSubmissionType;
      needs_reference: 0 | 1;
      needs_issuing_body: 0 | 1;
      needs_issue_date: 0 | 1;
      needs_expiry_date: 0 | 1;
      submitted: RecruitmentCandidateDocument | null;
    }>;
  }>;
}

export type RecruitmentSubmissionType = 'file' | 'info_only';

/** Editable lookup of doc-type groups (Identity / Right to work /
 *  Financial / …). Drives the collapsible sections on the Settings
 *  page. Migration 079. */
export interface RecruitmentDocGroup {
  id?: number;
  name: string;
  sort_order?: number;
}

/** A single skill the agency tracks against candidates. May exist
 *  standalone OR be auto-linked to a recruitment_doc_types row (when
 *  `doc_type_id` is set). Deleting an auto-linked skill un-ticks the
 *  doc-type's "Add as skill" checkbox automatically. Migration 081. */
export interface RecruitmentSkill {
  id?: number;
  name: string;
  doc_type_id?: number | null;
  sort_order?: number;
}

export interface RecruitmentDocType {
  id?: number;
  name: string;
  description?: string | null;
  /** Optional FK to `recruitment_doc_groups.id`. Null = "Ungrouped"
   *  pseudo-section on the Settings page. */
  group_id?: number | null;
  /** "Add as skill" checkbox state. Derived on GET from whether a
   *  `recruitment_skills` row with `doc_type_id = this.id` exists.
   *  Migration 081. */
  add_as_skill?: 0 | 1 | boolean;
  is_required?: 0 | 1 | boolean;
  /** Whether the type appears in the candidate's onboarding checklist
   *  (independent of `is_required`). 076-era types defaulted to
   *  on-checklist behaviour, so migration 078 backfilled this to 1. */
  add_to_onboarding?: 0 | 1 | boolean;
  /** 'file' = candidate uploads a real document; 'info_only' = HR
   *  records dates / reference / issuing body without a file. */
  submission_type?: RecruitmentSubmissionType;
  needs_reference?: 0 | 1 | boolean;
  needs_issue_date?: 0 | 1 | boolean;
  needs_expiry_date?: 0 | 1 | boolean;
  needs_issuing_body?: 0 | 1 | boolean;
  sort_order?: number;
}

export interface RecruitmentCandidateDocument {
  id?: number;
  candidate_id?: number;
  doc_type_id?: number | null;
  doc_type_name?: string | null;
  title: string;
  /** Null for info-only entries (migration 078). */
  file_path?: string | null;
  file_size?: number | null;
  mime_type?: string | null;
  reference_number?: string | null;
  issuing_body?: string | null;
  issued_at?: string | null;
  expires_at?: string | null;
  status?: RecruitmentDocStatus;
  uploaded_at?: string;
}

export interface RecruitmentCandidateNote {
  id?: number;
  candidate_id?: number;
  title: string;
  body?: string | null;
  /** Pipeline-stage tag — snapshot of the candidate's status at the
   *  time the note was written. Drives the Notes-tab subtab grouping.
   *  Migration 083. */
  status?: RecruitmentCandidateStatus | null;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
}

export interface RecruitmentOnboardingProgress {
  contract_signed: boolean;
  docs_required: number;
  docs_valid: number;
  docs_pending: number;
}
export interface RecruitmentOnboardingChecklistItem {
  doc_type_id: number;
  name: string;
  is_required: 0 | 1;
  submission_type?: RecruitmentSubmissionType;
  status: RecruitmentDocStatus | null;
}
export interface RecruitmentOnboarding {
  checklist: RecruitmentOnboardingChecklistItem[];
  progress: RecruitmentOnboardingProgress;
}

/** A client-side role opening — migration 085. Multiple candidate
 *  placements can attach to a single role. */
export type RecruitmentRoleStatus = 'open' | 'filled' | 'cancelled';

export interface RecruitmentRole {
  id?: number;
  client_id?: number;
  title: string;
  description?: string | null;
  target_start_date?: string | null;
  target_end_date?: string | null;
  contract_value?: number | string | null;
  commission_value?: number | string | null;
  /** Amount received when only part of the commission is paid (091).
   *  Defaults to half of commission_value in the UI. */
  commission_part_amount?: number | string | null;
  /** Agency cut as a % of contract value (091, default 12). The
   *  commission_value amount is derived from it. */
  commission_percent?: number | string | null;
  currency?: string;
  /** Commission paid status — migrated from placement-level to
   *  role-level in 086 (one negotiated fee per role). */
  commission_paid_part?: 0 | 1 | boolean;
  commission_paid_full?: 0 | 1 | boolean;
  commission_due_part?: string | null;
  commission_due_full?: string | null;
  status?: RecruitmentRoleStatus;
  notes?: string | null;
  /** Computed counts surfaced by the GET endpoint (counts of placements
   *  attached to this role, broken down by status). */
  total_candidates?: number;
  vetting_count?: number;
  placed_count?: number;
  rejected_count?: number;
  created_at?: string;
  updated_at?: string;
}

/** A single placement (candidate × client) — migration 084. */
export type RecruitmentPlacementStatus = 'screening' | 'placed' | 'ended' | 'rejected';

export interface RecruitmentPlacement {
  id?: number;
  candidate_id?: number;
  client_id: number;
  /** Optional link to a `recruitment_roles` entry — set when the
   *  placement was created from a role's "Add candidate" action. */
  role_id?: number | null;
  /** Joined from the role's title on GET. */
  role_title?: string | null;
  /** Joined from `clients.name` on GET — not sent on POST/PUT. */
  client_name?: string;
  /** Joined from the candidate when listing by client. */
  candidate_name?: string;
  candidate_role?: string | null;
  candidate_status?: RecruitmentCandidateStatus;
  role?: string | null;
  status?: RecruitmentPlacementStatus;
  start_date?: string | null;
  end_date?: string | null;
  contract_value?: number | string | null;
  commission_value?: number | string | null;
  currency?: string;
  commission_paid_part?: 0 | 1 | boolean;
  commission_paid_full?: 0 | 1 | boolean;
  commission_due_part?: string | null;
  commission_due_full?: string | null;
  contract_notes?: string | null;
  rejection_reason?: string | null;
  created_at?: string;
  updated_at?: string;
}

/** Row returned by /api/recruitment/documents — aggregated docs view. */
export interface RecruitmentDocumentRow {
  id: number;
  candidate_id: number;
  candidate_name: string;
  doc_type_name: string | null;
  title: string;
  file_path: string;
  file_size: number | null;
  mime_type: string | null;
  reference_number: string | null;
  issued_at: string | null;
  expires_at: string | null;
  status: RecruitmentDocStatus;
  uploaded_at: string;
}

export const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'email', label: 'Email' },
  { value: 'tel', label: 'Phone' },
  { value: 'url', label: 'URL' },
  { value: 'number', label: 'Number' },
  { value: 'password', label: 'Password' },
  { value: 'textarea', label: 'Long text' },
  { value: 'select', label: 'Dropdown' },
  { value: 'radio', label: 'Radio buttons' },
  { value: 'checkbox', label: 'Checkboxes' },
  { value: 'date', label: 'Date' },
  { value: 'datetime', label: 'Date + time' },
  { value: 'file', label: 'File / document' },
  { value: 'multi_file', label: 'Multi-file upload' },
  { value: 'color', label: 'Color picker' },
  { value: 'style_cards', label: 'Style cards' },
];

export const HAS_OPTIONS: FieldType[] = ['select', 'radio', 'checkbox', 'style_cards'];

// ──────────────────────────────────────────────────────────────────
// Multi-tenant (super-admin) types
// ──────────────────────────────────────────────────────────────────

/** Row returned by GET /api/super-admin/tenants. */
export interface TenantSummary {
  id: number;
  slug: string;
  brand_name: string;
  status: 'provisioning' | 'active' | 'suspended' | 'deleted';
  created_at: string;
  deleted_at: string | null;
}

/** Row returned by GET /api/super-admin/audit. */
export interface SuperAuditEntry {
  id: number;
  super_email: string;
  action: string;
  target_tenant: number | null;
  from_tenant: number | null;
  ip: string | null;
  created_at: string;
  detail: string | null;
}
