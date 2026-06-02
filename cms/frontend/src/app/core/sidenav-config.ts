/**
 * Built-in CRM sidenav sections that accept child entries via
 * `sidenav_parent_key`. Single source of truth — both the side-nav
 * rendering and the form/section-builder parent dropdowns import from
 * here. Add a new entry once and it shows up in every dropdown AND the
 * sidenav renders any forms/sections placed underneath it.
 *
 * Order matters — it controls the order in the parent-picker dropdowns.
 */
export interface SidenavBuiltinParent {
  key: string;
  label: string;
}

export const SIDENAV_BUILTIN_PARENTS: SidenavBuiltinParent[] = [
  // Order mirrors the CRM sidenav top-level entries.
  { key: 'clients',    label: 'Clients' },
  { key: 'leads',      label: 'Leads' },
  { key: 'leadgen',    label: 'Lead Gen' },
  { key: 'newsletter', label: 'Newsletter' },
  { key: 'services',   label: 'Services' },
  { key: 'forms',      label: 'Forms' },
  { key: 'onboarding', label: 'Onboarding' },
  // 'tasks' and 'team' removed when those moved into the Tasks peer system
  // at /tasks/* — nesting CRM forms/sections under them no longer makes sense.
];
