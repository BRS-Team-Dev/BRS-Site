// @ts-check
/**
 * Notifications end-to-end walkthrough — SINGLE test, SINGLE page,
 * SINGLE persistent browser window. Between each scenario the run
 * pauses via `page.pause()` — the Playwright Inspector attaches and
 * blocks until you click "Resume". Window stays open at the end so
 * you can inspect state manually.
 *
 * Ctrl+C in the terminal to exit for real.
 *
 * Coverage:
 *   A. Default catalog behaviour — trigger event → bell increments,
 *      notification appears, click marks read + navigates.
 *   B. Rule enabled=0 — trigger event → nothing lands.
 *   C. Rule creates_task=0 — trigger fires notification but not task.
 */
const { test, expect } = require('@playwright/test');
const db = require('../helpers/db');

// Fire the same code path public.php / public_onboarding.php /
// public_feedback.php invoke on trigger. Runs synchronously so test
// code reads linearly.
function fireEvent(eventKey, title = 'E2E-TEST', linkUrl = '/admin/feedback') {
  const { execFileSync } = require('node:child_process');
  execFileSync(
    'C:/xampp/php/php.exe',
    [
      '-r',
      `require 'cms/api/bootstrap.php';
       BRS\\Tenant::overrideTo(1);
       echo BRS\\NotificationDispatcher::fire('${eventKey}', [
         'title'    => '${title}',
         'body'     => null,
         'link_url' => '${linkUrl}',
       ]);`,
    ],
    {
      cwd: 'C:/xampp/htdocs/builtrightstudio',
      env: { ...process.env, BRS_ENV_FILE: 'C:/xampp/htdocs/builtrightstudio/cms/.env' },
      stdio: 'pipe',
    },
  );
}

/** Highlight the current scenario in the browser + terminal so you
 *  know what you're about to watch. */
async function announce(page, title) {
  console.log(`\n\n╔══ ${title} ══╗`);
  console.log(`║ Click "Resume" in the Playwright Inspector to run this scenario.`);
  console.log(`╚${'═'.repeat(title.length + 8)}╝\n`);
  // Also paint a big banner across the top of the page so it's obvious
  // which scenario is about to fire.
  await page.evaluate((t) => {
    let el = document.getElementById('__e2e_banner__');
    if (!el) {
      el = document.createElement('div');
      el.id = '__e2e_banner__';
      el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;padding:12px 20px;background:#d4a93a;color:#0a0a0a;font-family:system-ui;font-weight:700;font-size:14px;letter-spacing:0.3px;box-shadow:0 4px 12px rgba(0,0,0,0.3);';
      document.body.appendChild(el);
    }
    el.textContent = 'E2E → ' + t;
  }, title);
}

test('Notifications e2e walkthrough (persistent window)', async ({ page }) => {
  // Give the test 30 minutes so we don't time out while paused.
  test.setTimeout(30 * 60 * 1000);

  // Global reset so we start from a known state.
  db.resetInbox();
  db.clearRules('crm.feedback.response');

  await page.goto('admin');
  await expect(page.locator('.brand')).toBeVisible();

  // ─────────────────────────────────────────────────────────────
  await announce(page, 'Scenario A — default: event → bell increments → click → mark read + navigate');
  await page.pause();

  // Baseline
  expect(db.unreadCount()).toBe(0);
  await expect(page.locator('app-notification-bell .badge')).toHaveCount(0);

  // Fire the real event (same code path public feedback endpoint uses)
  fireEvent('crm.feedback.response', 'E2E-A: default trigger', '/admin/feedback');

  // DB truth first
  const aCount = db.unreadCount();
  expect(aCount).toBeGreaterThan(0);
  console.log(`   ✓ DB shows ${aCount} unread notification(s)`);

  // Bell polls every 60s — reload to pull the fresh count now
  await page.reload();
  await expect(page.locator('app-notification-bell .badge')).toBeVisible({ timeout: 15_000 });
  console.log('   ✓ Bell badge visible in the DOM');

  // Open the bell
  await page.locator('app-notification-bell button.bell').click();
  const panel = page.locator('app-notification-bell .panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.tab', { hasText: 'CRM' }).locator('.tab-badge')).toBeVisible();
  console.log('   ✓ CRM sub-tab shows a per-section badge');

  // Row is present + unread
  const rowA = panel.locator('.row', { hasText: 'E2E-A: default trigger' });
  await expect(rowA).toBeVisible();
  await expect(rowA).toHaveClass(/unread/);

  // Click → marks read + navigates
  await rowA.click();
  await expect(page).toHaveURL(/\/admin\/feedback/);
  console.log('   ✓ Click navigated to /admin/feedback');

  const readNow = parseInt(
    db.sql(`SELECT COUNT(*) FROM notifications
              WHERE user_id=${db.testAdminId()} AND read_at IS NOT NULL
                AND title='E2E-A: default trigger'`),
    10,
  );
  expect(readNow).toBe(1);
  console.log('   ✓ DB shows notification marked read');

  // ─────────────────────────────────────────────────────────────
  await announce(page, 'Scenario B — rule enabled=0: event fires, NOTHING lands');
  await page.pause();

  db.resetInbox();
  await page.goto('admin/settings');
  await page.locator('.tab-row .tab-label', { hasText: 'Notifications' }).click();
  await expect(page.getByRole('heading', { name: /notifications/i })).toBeVisible();

  // Show the row we're about to disable so you can see the UI
  const eventRow = page.locator('.event-row', { hasText: 'Feedback response received' });
  await expect(eventRow).toBeVisible();
  await eventRow.scrollIntoViewIfNeeded();

  // Disable via DB — UX gap: unchecking the master toggle hides the Save button
  db.sql(`INSERT INTO notification_rules
            (tenant_id, event_key, enabled, recipient_scope, recipient_ref, creates_task)
          VALUES (1, 'crm.feedback.response', 0, 'role', 'admin', 1)
          ON DUPLICATE KEY UPDATE enabled=0`);
  console.log('   ✓ Rule persisted: enabled=0');

  fireEvent('crm.feedback.response', 'E2E-B: should not fire', '/admin/feedback');
  expect(db.unreadCount()).toBe(0);
  expect(db.taskCount('E2E-B: should not fire')).toBe(0);
  console.log('   ✓ No notification + no task created');

  await page.goto('admin');
  await expect(page.locator('app-notification-bell .badge')).toHaveCount(0);
  console.log('   ✓ Bell has no badge');

  // ─────────────────────────────────────────────────────────────
  await announce(page, 'Scenario C — rule creates_task=0: notification fires, task does NOT');
  await page.pause();

  db.sql(`INSERT INTO notification_rules
            (tenant_id, event_key, enabled, recipient_scope, recipient_ref, creates_task)
          VALUES (1, 'crm.feedback.response', 1, 'role', 'admin', 0)
          ON DUPLICATE KEY UPDATE enabled=1, creates_task=0`);
  console.log('   ✓ Rule persisted: enabled=1, creates_task=0');

  db.resetInbox();
  expect(db.taskCount('E2E-C: notif only')).toBe(0);

  fireEvent('crm.feedback.response', 'E2E-C: notif only', '/admin/feedback');

  expect(db.unreadCount()).toBeGreaterThan(0);
  expect(db.taskCount('E2E-C: notif only')).toBe(0);
  console.log('   ✓ Notification delivered, task suppressed');

  await page.reload();
  await expect(page.locator('app-notification-bell .badge')).toBeVisible({ timeout: 10_000 });
  await page.locator('app-notification-bell button.bell').click();
  await expect(
    page.locator('app-notification-bell .row', { hasText: 'E2E-C: notif only' }),
  ).toBeVisible();
  console.log('   ✓ Bell + row show the notification');

  // ─────────────────────────────────────────────────────────────
  await announce(page, 'All scenarios complete. Window stays open — Ctrl+C in the terminal to exit.');
  console.log('\nAll 3 scenarios passed. Take your time — inspect the UI, click around,');
  console.log('open dev tools. Hit "Resume" in the Playwright Inspector to end the run.\n');

  // Cleanup before we hand control back
  db.clearRules('crm.feedback.response');
  await page.pause();
});
