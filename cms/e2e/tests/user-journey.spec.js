// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Single continuous user-journey test — one browser session, no login
 * (JWT is loaded from global-setup's storageState). Walk through the
 * app as a normal user would.
 *
 * Structured into test.step() blocks so the report has a clean outline
 * you can scrub through afterwards. Console errors + page errors
 * anywhere in the flow fail the whole run.
 */

test.describe.configure({ mode: 'serial' });

test('day-in-the-life admin walkthrough', async ({ page }) => {
  const errs = [];
  page.on('console',   (m) => { if (m.type() === 'error') errs.push(`[console] ${m.text()}`); });
  page.on('pageerror', (e) => { errs.push(`[pageerror] ${e.message}`); });

  await test.step('open the admin — landing on Clients', async () => {
    await page.goto('admin');
    await expect(page.locator('.brand')).toBeVisible();
    // Match the top-level sidenav link by its exact href, not text —
    // "Clients" also appears in nested Services sub-menu items.
    await expect(page.locator('nav a[href$="/admin/clients"]')).toBeVisible();
  });

  await test.step('click the notification bell in the top nav', async () => {
    const bell = page.locator('app-notification-bell button.bell').first();
    await bell.click();
    await expect(page.locator('app-notification-bell .panel')).toBeVisible();
    // Cycle through a couple of the section sub-tabs.
    await page.locator('app-notification-bell .tab', { hasText: 'HR' }).click();
    await page.waitForTimeout(400);
    await page.locator('app-notification-bell .tab', { hasText: 'CRM' }).click();
    // Close it by clicking off.
    await page.locator('body').click({ position: { x: 5, y: 5 } });
  });

  await test.step('navigate to the Task Board', async () => {
    await page.locator('nav a[href$="/admin/taskboard"]').click();
    await expect(page.getByRole('heading', { name: /task board/i })).toBeVisible();
  });

  await test.step('navigate to Clients', async () => {
    await page.locator('nav a[href$="/admin/clients"]').click();
    await expect(page.getByRole('heading', { name: /clients/i }).first()).toBeVisible();
  });

  await test.step('open the Services section', async () => {
    // Services expands into a submenu of catalogue rows. Just click
    // the header link and confirm the /admin/services page loads.
    await page.goto('admin/services');
    await expect(page.getByRole('heading', { name: /services/i })).toBeVisible();
  });

  await test.step('open Settings → General', async () => {
    await page.goto('admin/settings');
    await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible();
    // The General tab should already be active by default.
    await expect(page.locator('.tab-row.selected')).toContainText('General');
  });

  await test.step('flip to the Notifications tab and expand CRM section', async () => {
    await page.locator('.tab-row .tab-label', { hasText: 'Notifications' }).click();
    await expect(page.getByRole('heading', { name: /notifications/i })).toBeVisible();
    // CRM section renders 13 events; check the header shows some events.
    await expect(page.locator('.section-block', { hasText: 'CRM' })).toBeVisible();
  });

  await test.step('flip to Appearance tab and check preset picker', async () => {
    await page.locator('.tab-row .tab-label', { hasText: 'Appearance' }).click();
    await expect(page.getByRole('heading', { name: /appearance/i })).toBeVisible();
    await expect(page.locator('.theme-card', { hasText: 'Midnight Gold' })).toBeVisible();
  });

  await test.step('flip to Email tab and inspect the providers list', async () => {
    await page.locator('.tab-row .tab-label', { hasText: 'Email' }).click();
    await expect(page.getByRole('heading', { name: /providers/i })).toBeVisible();
  });

  await test.step('end — assert no console errors surfaced during the whole walk', async () => {
    expect(errs, `Console errors captured:\n${errs.join('\n')}`).toHaveLength(0);
  });
});
