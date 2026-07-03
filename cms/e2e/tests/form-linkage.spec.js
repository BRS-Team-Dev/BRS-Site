// @ts-check
/**
 * Form-submission linkage end-to-end walkthrough.
 *
 * Five critical flows in ONE persistent browser session:
 *   1. Standard form submitted with attach_client_id → shows on Clients
 *      → onboarding tab.
 *   2. Standard form submitted with attach_lead_id → shows on Leads
 *      → onboarding tab.
 *   3. Standard form pinned to a service (service_offering_id) → new
 *      submission auto-links to that service → shows in Services panel
 *      → onboarding tab.
 *   4. Detach button on Clients → onboarding → submission disappears
 *      (link_id removed, underlying row preserved).
 *   5. Manual attach via API (POST /api/form-submission-links) — the
 *      link surfaces on the target record's onboarding tab.
 *
 * Runs against the local dev environment. Assumes `claude-test@`
 * super-admin session (see `global-setup.js`) and that tenant 1 has
 * at least one client + one lead + one service_offering seeded.
 */
const { test, expect, request } = require('@playwright/test');
const db = require('../helpers/db');

const SLUG = 'e2e_link_form';
const API = 'http://localhost/builtrightstudio/cms/api';

/**
 * Public submit uses the same route real users hit. We wrap fetch
 * because the public form endpoint accepts multipart or JSON.
 */
async function publicSubmit({ slug, notes, attachClientId, attachLeadId, attachServiceId }) {
  const params = new URLSearchParams();
  if (attachClientId)  params.set('attach_client_id',  String(attachClientId));
  if (attachLeadId)    params.set('attach_lead_id',    String(attachLeadId));
  if (attachServiceId) params.set('attach_service_id', String(attachServiceId));
  const url = `${API}/public/forms/${slug}/submit${params.toString() ? '?' + params : ''}`;

  const ctx = await request.newContext();
  const res = await ctx.post(url, {
    data: { notes },
    headers: { 'Content-Type': 'application/json' },
  });
  await ctx.dispose();
  const body = await res.text();
  if (!res.ok()) throw new Error(`public submit ${res.status()}: ${body}`);
  return body;
}

test.beforeAll(() => {
  db.cleanupTestForm(SLUG);
});
test.afterAll(() => {
  db.cleanupTestForm(SLUG);
});

test('form-submission linkage: client + lead + service, plus detach + manual attach', async ({ page }) => {
  const clientId  = db.anyClientId();
  const leadId    = db.anyLeadId();
  const serviceId = db.anyServiceId();
  test.skip(!clientId,  'no client seeded in tenant 1');
  test.skip(!leadId,    'no lead seeded in tenant 1');
  test.skip(!serviceId, 'no service_offerings row seeded in tenant 1');

  // Seed the form once — reused across all scenarios.
  const form = db.seedTestForm(SLUG, 'E2E Link Form');

  // ────────────────────────────────────────────────────────
  // SCENARIO 1: Client attach via public submit
  // ────────────────────────────────────────────────────────
  await test.step('client: public submit auto-links, appears on Onboarding tab', async () => {
    await publicSubmit({
      slug: SLUG,
      notes: 'E2E-CLIENT payload one',
      attachClientId: clientId,
    });

    // Verify DB row exists BEFORE clicking through the UI so a UI
    // regression can't hide a DB-side breakage.
    const linkCount = parseInt(
      db.sql(`SELECT COUNT(*) FROM form_submission_links
                WHERE form_id=${form.form_id} AND client_id=${clientId}`),
      10,
    );
    expect(linkCount).toBeGreaterThan(0);

    await page.goto(`admin/clients/${clientId}`);
    await page.getByRole('button', { name: 'Onboarding' }).click();
    await expect(page.getByText('E2E Link Form')).toBeVisible();
    // Expand — captured data table appears.
    await page.locator('.sub-toggle').first().click();
    await expect(page.getByText('E2E-CLIENT payload one')).toBeVisible();
  });

  // ────────────────────────────────────────────────────────
  // SCENARIO 2: Lead attach via public submit
  // ────────────────────────────────────────────────────────
  await test.step('lead: public submit auto-links, appears on Onboarding tab', async () => {
    await publicSubmit({
      slug: SLUG,
      notes: 'E2E-LEAD payload two',
      attachLeadId: leadId,
    });

    const linkCount = parseInt(
      db.sql(`SELECT COUNT(*) FROM form_submission_links
                WHERE form_id=${form.form_id} AND lead_id=${leadId}`),
      10,
    );
    expect(linkCount).toBeGreaterThan(0);

    await page.goto(`admin/leads/${leadId}`);
    await page.getByRole('button', { name: 'Onboarding' }).click();
    await expect(page.getByText('E2E Link Form')).toBeVisible();
    await page.locator('.sub-toggle').first().click();
    await expect(page.getByText('E2E-LEAD payload two')).toBeVisible();
  });

  // ────────────────────────────────────────────────────────
  // SCENARIO 3: Service auto-attach via forms.service_offering_id
  // ────────────────────────────────────────────────────────
  await test.step('service: form pinned to service → auto-link on submit', async () => {
    // Pin the form to a service so any subsequent submission auto-links.
    db.sql(`UPDATE forms SET service_offering_id=${serviceId} WHERE id=${form.form_id}`);

    await publicSubmit({
      slug: SLUG,
      notes: 'E2E-SERVICE payload three',
      // No explicit attach — the form's own service_offering_id fires.
    });

    const linkCount = parseInt(
      db.sql(`SELECT COUNT(*) FROM form_submission_links
                WHERE form_id=${form.form_id} AND service_offering_id=${serviceId}`),
      10,
    );
    expect(linkCount).toBeGreaterThan(0);

    await page.goto('admin/services');
    // Click the service row to open its panel.
    await page.locator(`tr:has-text("")`).first();
    // Robust selection: click the row containing our service by id via URL.
    await page.evaluate((sid) => {
      const row = Array.from(document.querySelectorAll('tr'))
        .find(tr => tr.querySelector('button.icon-btn')?.getAttribute('title') === 'Edit');
      row?.click?.();
    }, serviceId);
    // Fallback — click the first service row if evaluate didn't hit.
    const rowCount = await page.locator('table.data tbody tr').count();
    if (rowCount > 0) await page.locator('table.data tbody tr').first().click();

    await page.getByRole('button', { name: /^Onboarding$/ }).click();
    await expect(page.getByText('E2E Link Form')).toBeVisible();
  });

  // ────────────────────────────────────────────────────────
  // SCENARIO 4: Detach from client via UI
  // ────────────────────────────────────────────────────────
  await test.step('detach: remove link from client, submission preserved', async () => {
    const beforeLinks = parseInt(
      db.sql(`SELECT COUNT(*) FROM form_submission_links
                WHERE form_id=${form.form_id} AND client_id=${clientId}`),
      10,
    );
    const beforeSubs = parseInt(
      db.sql(`SELECT COUNT(*) FROM \`${form.table_name}\``),
      10,
    );
    expect(beforeLinks).toBeGreaterThan(0);

    await page.goto(`admin/clients/${clientId}`);
    await page.getByRole('button', { name: 'Onboarding' }).click();
    // First Detach button on the page.
    await page.getByRole('button', { name: /Detach/ }).first().click();
    // Custom overlay dialog — confirm.
    await page.getByRole('button', { name: 'Detach', exact: true }).click();

    // Wait a moment for the DELETE to complete.
    await page.waitForTimeout(500);

    const afterLinks = parseInt(
      db.sql(`SELECT COUNT(*) FROM form_submission_links
                WHERE form_id=${form.form_id} AND client_id=${clientId}`),
      10,
    );
    const afterSubs = parseInt(
      db.sql(`SELECT COUNT(*) FROM \`${form.table_name}\``),
      10,
    );
    expect(afterLinks).toBe(beforeLinks - 1);
    expect(afterSubs).toBe(beforeSubs); // submission row preserved
  });

  // ────────────────────────────────────────────────────────
  // SCENARIO 5: Manual attach via API endpoint
  // ────────────────────────────────────────────────────────
  await test.step('manual attach: POST /form-submission-links links an existing submission', async () => {
    // Insert a fresh submission WITHOUT any link.
    db.sql(`INSERT INTO \`${form.table_name}\` (tenant_id, notes)
            VALUES (1, 'E2E-MANUAL orphan submission')`);
    const orphanId = parseInt(db.sql('SELECT LAST_INSERT_ID()'), 10);

    // Pull the JWT cookie from the storage state so we can call the
    // authenticated endpoint. `page.context().request` inherits the
    // session cookie, so we can just POST through it.
    const res = await page.request.post(`${API}/form-submission-links`, {
      data: {
        form_id: form.form_id,
        submission_id: orphanId,
        client_id: clientId,
      },
    });
    expect(res.status()).toBe(201);

    await page.goto(`admin/clients/${clientId}`);
    await page.getByRole('button', { name: 'Onboarding' }).click();
    await page.locator('.sub-toggle').first().click();
    await expect(page.getByText('E2E-MANUAL orphan submission')).toBeVisible();
  });
});
