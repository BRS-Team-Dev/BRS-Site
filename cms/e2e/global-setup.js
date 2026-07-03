// @ts-check
/**
 * Runs ONCE before any test. Logs into the CRM and writes the browser
 * storage state (cookies + localStorage — where the JWT lives) to
 * .auth/state.json. Every subsequent test loads that state and is
 * already logged in — no repeat login flashes on your screen.
 *
 * Persistence: state.json is kept between runs, so the second-and-later
 * `npm test` invocations skip the login step entirely as long as the
 * saved JWT is still valid. We deliberately re-login on every setup
 * anyway (it's ~2 seconds) so JWT expiry can't silently fail runs
 * days later.
 */
const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const CREDS = {
  email: 'claude-test@builtrightstudio.com',
  password: '29ae7c454ffdcc024896eda3da3f2522',
};
const BASE = 'http://localhost:4200/builtrightstudio/cms/';
const STATE_FILE = path.join(__dirname, '.auth', 'state.json');

module.exports = async () => {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ baseURL: BASE });

  await page.goto('login');
  await page.locator('input[type="email"]').fill(CREDS.email);
  await page.locator('input[type="password"]').fill(CREDS.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL('**/admin/**', { timeout: 20_000 });

  await page.context().storageState({ path: STATE_FILE });
  await browser.close();
  // eslint-disable-next-line no-console
  console.log(`  → auth captured to ${STATE_FILE}`);
};
