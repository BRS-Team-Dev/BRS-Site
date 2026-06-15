/**
 * Canonical default document sections for a new tender. The user picks
 * which apply at creation time (or later from the section-picker); each
 * checked entry materialises a `tender_document_sections` row.
 *
 * Add new defaults at the end (sort_order = array index) so existing
 * tenders keep their established order. Custom sections appear at the
 * bottom of the list with sort_order = sections.length.
 */
export interface DefaultSection {
  slug: string;
  label: string;
  /** A short helper string shown under the checkbox in the picker. */
  hint?: string;
}

export const DEFAULT_SECTIONS: DefaultSection[] = [
  { slug: 'application_form',       label: 'Application form',       hint: "The buyer's official form" },
  { slug: 'pricing_schedule',       label: 'Pricing schedule',       hint: 'Costs / rate card / pricing matrix' },
  { slug: 'questionnaire',          label: 'Questionnaire',          hint: 'PQQ / SQ responses' },
  { slug: 'proposal',               label: 'Proposal',               hint: 'Technical / methodology document' },
  { slug: 'case_studies',           label: 'Case studies',           hint: 'Past project write-ups' },
  { slug: 'references',             label: 'References',             hint: 'Client references / testimonials' },
  { slug: 'pitch_deck',             label: 'Pitch deck',             hint: 'Slides for an oral presentation' },
  { slug: 'insurance_certificates', label: 'Insurance certificates', hint: 'PII / Public Liability / EL certs' },
  { slug: 'financials_accounts',    label: 'Financials / accounts',  hint: 'Last 2–3 years of accounts' },
];
