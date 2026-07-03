// Playwright config for BuiltRightStudio CRM e2e tests.
// Runs against the local dev environment (Angular dev server on :4200
// + Apache-hosted API). HEADED by default when run locally so you can
// watch the browser drive the app; auto-flips to HEADLESS under CI=1.

const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  // Runs ONCE before any test — logs in, saves storage state.
  globalSetup: require.resolve('./global-setup'),
  use: {
    // Trailing slash is critical — Playwright's URL resolution treats
    // a path-suffixed baseURL like a filename, so without it
    // `page.goto('login')` resolves to /builtrightstudio/login instead
    // of /builtrightstudio/cms/login.
    baseURL: 'http://localhost:4200/builtrightstudio/cms/',
    // Default HEADED so you can watch the browser drive itself.
    // Force headless with `CI=1 npm test` for scripted runs.
    headless: process.env.CI === '1',
    // Deliberate pause between actions so it's readable at human speed.
    launchOptions: {
      slowMo: process.env.CI === '1' ? 0 : 1000,
    },
    screenshot: 'on',
    video: 'on',
    trace: 'on',
    // Every test starts with the JWT + cookies from global-setup — no
    // login prompt appears in any spec's browser session.
    storageState: '.auth/state.json',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
