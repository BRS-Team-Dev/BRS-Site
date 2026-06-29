-- Migration 108: Rewrite the UNIQUE indexes that need to be per-tenant.
--
-- These 15 indexes previously enforced global uniqueness on a single
-- column (e.g. admin_users.email, forms.slug, invoices.invoice_number).
-- Under the new tenant-per-row model each tenant must be free to use
-- the same values without colliding with a sibling — so the constraint
-- becomes (tenant_id, <column>) instead of just (<column>).
--
-- Indexes that we DELIBERATELY leave alone fall into two buckets:
--
--   1. FK-scoped composites like form_fields(form_id, name) — already
--      tenant-isolated through their parent FK because form_id is
--      unique per tenant after this migration.
--   2. URL tokens that genuinely need to stay globally unique because
--      they're routed without tenant context (URLs hit before login):
--        - hr_employees.onboarding_token
--        - hr_pulse_surveys.public_token
--        - newsletter_recipients.unsubscribe_token
--        - onboarding_clients.client_token
--        - password_resets.token_hash
--        - recruitment_candidates.onboarding_token
--      A 128-bit random token will never collide across tenants in
--      practice, and these tokens carry the tenant implicitly via the
--      row they identify.

-- ── 1. admin_sections.slug → (tenant_id, slug) ───────────────────
ALTER TABLE `admin_sections`
  DROP INDEX `slug`,
  ADD UNIQUE KEY `uk_admin_sections_tenant_slug` (`tenant_id`, `slug`);

-- ── 2. admin_users.email → (tenant_id, email) ────────────────────
ALTER TABLE `admin_users`
  DROP INDEX `email`,
  ADD UNIQUE KEY `uk_admin_users_tenant_email` (`tenant_id`, `email`);

-- ── 3. affiliates.affiliate_code → (tenant_id, affiliate_code) ───
ALTER TABLE `affiliates`
  DROP INDEX `uk_affiliate_code`,
  ADD UNIQUE KEY `uk_affiliates_tenant_code` (`tenant_id`, `affiliate_code`);

-- ── 4. ai_models.model_id → (tenant_id, model_id) ────────────────
ALTER TABLE `ai_models`
  DROP INDEX `uk_model_id`,
  ADD UNIQUE KEY `uk_ai_models_tenant_model_id` (`tenant_id`, `model_id`);

-- ── 5. contract_types.slug → (tenant_id, slug) ───────────────────
ALTER TABLE `contract_types`
  DROP INDEX `uniq_slug`,
  ADD UNIQUE KEY `uk_contract_types_tenant_slug` (`tenant_id`, `slug`);

-- ── 6. forms.slug → (tenant_id, slug) ────────────────────────────
ALTER TABLE `forms`
  DROP INDEX `slug`,
  ADD UNIQUE KEY `uk_forms_tenant_slug` (`tenant_id`, `slug`);

-- ── 7. hr_candidates.email → (tenant_id, email) ──────────────────
ALTER TABLE `hr_candidates`
  DROP INDEX `uniq_cand_email`,
  ADD UNIQUE KEY `uk_hr_candidates_tenant_email` (`tenant_id`, `email`);

-- ── 8. hr_jobs.slug → (tenant_id, slug) ──────────────────────────
ALTER TABLE `hr_jobs`
  DROP INDEX `slug`,
  ADD UNIQUE KEY `uk_hr_jobs_tenant_slug` (`tenant_id`, `slug`);

-- ── 9. hr_legal_documents.slug → (tenant_id, slug) ───────────────
ALTER TABLE `hr_legal_documents`
  DROP INDEX `uniq_legal_slug`,
  ADD UNIQUE KEY `uk_hr_legal_documents_tenant_slug` (`tenant_id`, `slug`);

-- ── 10. hr_skills.name → (tenant_id, name) ───────────────────────
ALTER TABLE `hr_skills`
  DROP INDEX `uniq_skill_name`,
  ADD UNIQUE KEY `uk_hr_skills_tenant_name` (`tenant_id`, `name`);

-- ── 11. invoices.invoice_number → (tenant_id, invoice_number) ────
ALTER TABLE `invoices`
  DROP INDEX `uniq_invoice_number`,
  ADD UNIQUE KEY `uk_invoices_tenant_number` (`tenant_id`, `invoice_number`);

-- ── 12. recruitment_skills.name → (tenant_id, name) ──────────────
ALTER TABLE `recruitment_skills`
  DROP INDEX `uniq_name`,
  ADD UNIQUE KEY `uk_recruitment_skills_tenant_name` (`tenant_id`, `name`);

-- ── 13. task_item_states.slug → (tenant_id, slug) ────────────────
ALTER TABLE `task_item_states`
  DROP INDEX `slug`,
  ADD UNIQUE KEY `uk_task_item_states_tenant_slug` (`tenant_id`, `slug`);

-- ── 14. task_item_types.slug → (tenant_id, slug) ─────────────────
ALTER TABLE `task_item_types`
  DROP INDEX `slug`,
  ADD UNIQUE KEY `uk_task_item_types_tenant_slug` (`tenant_id`, `slug`);

-- ── 15. task_teams.slug → (tenant_id, slug) ──────────────────────
ALTER TABLE `task_teams`
  DROP INDEX `slug`,
  ADD UNIQUE KEY `uk_task_teams_tenant_slug` (`tenant_id`, `slug`);
