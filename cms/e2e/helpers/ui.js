// @ts-check
/**
 * Human-mouse helpers for Playwright specs.
 *
 * Rather than Playwright's default instant clicks + fills, these helpers
 * move the mouse cursor visibly across the page and type characters one
 * at a time - so a human watching the browser can follow every action.
 *
 * All helpers accept either a Playwright Locator or a `data-testid` string;
 * the latter is resolved via `page.getByTestId(id)`. The Playwright
 * config is HEADED by default (`playwright.config.js`), so nothing extra
 * is needed to actually see the cursor move.
 *
 * Tunables:
 *   MOUSE_STEPS  - number of intermediate positions between move start
 *                  and end. Bigger = smoother + slower.
 *   TYPE_DELAY   - ms between keystrokes.
 *
 * All timings are quiet on CI (env CI=1) so headless runs don't waste
 * wall-clock time on human-readable animations.
 */
const { expect } = require('@playwright/test');

const CI = process.env.CI === '1';
const MOUSE_STEPS = CI ? 1  : 20;
const TYPE_DELAY  = CI ? 0  : 50;
const HOVER_MS    = CI ? 0  : 300;

/** Resolve either a Locator or a `data-testid` string to a Locator. */
function resolve(page, target) {
  if (typeof target === 'string') return page.getByTestId(target);
  return target;
}

/** Move the mouse in visible steps to the centre of `target`, then click.
 *  Also hovers briefly beforehand so the target's :hover state is visible. */
async function moveThenClick(page, target) {
  const loc = resolve(page, target);
  await loc.scrollIntoViewIfNeeded();
  const box = await loc.boundingBox();
  if (!box) throw new Error(`moveThenClick: target has no bounding box: ${target}`);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy, { steps: MOUSE_STEPS });
  await page.waitForTimeout(HOVER_MS);
  await page.mouse.down();
  await page.waitForTimeout(30);
  await page.mouse.up();
}

/** Move-then-click and type character-by-character. Clears existing
 *  content first via Ctrl+A + Delete so an already-populated input
 *  ends up with just `text`. */
async function humanType(page, target, text) {
  const loc = resolve(page, target);
  await moveThenClick(page, loc);
  // Select all + delete so re-runs of an edit don't concatenate.
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await loc.pressSequentially(String(text), { delay: TYPE_DELAY });
}

/** Move-then-click on a native <select>, then pick an option.
 *
 *  `option` can be:
 *    - a string       -> matched against the option's `value` attribute
 *    - {label: '...'} -> matched against the option's visible text
 *    - {index: N}     -> the Nth option (0-based)
 *    - {value: '...'} -> explicit value match
 *
 *  Angular templates that use `[ngValue]` (not `[value]`) auto-generate
 *  DOM values like `0: object` internally, so string matching fails.
 *  Use {label: 'X'} for those. */
async function humanPick(page, target, option) {
  const loc = resolve(page, target);
  await moveThenClick(page, loc);
  const arg = typeof option === 'string' ? option : option;
  await loc.selectOption(arg);
}

/** Move-then-click on a checkbox. Uses native check() so the state
 *  ends up as `checked` regardless of the current state. */
async function humanCheck(page, target, checked = true) {
  const loc = resolve(page, target);
  await loc.scrollIntoViewIfNeeded();
  const box = await loc.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: MOUSE_STEPS });
    await page.waitForTimeout(HOVER_MS);
  }
  if (checked) await loc.check();
  else         await loc.uncheck();
}

/** Wait until Playwright's Inspector "Resume" button is clicked.
 *  Only enabled when NOT running in CI so scripted runs don't hang. */
async function waitForContinue(page, label) {
  if (CI) return;
  console.log(`\n─── PAUSED: ${label} — click Resume in the Playwright Inspector ───\n`);
  await page.pause();
}

module.exports = {
  moveThenClick,
  humanType,
  humanPick,
  humanCheck,
  waitForContinue,
};
