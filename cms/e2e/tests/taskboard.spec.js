// @ts-check
/**
 * TASKBOARD PAGE = /admin/taskboard
 *
 * SINGLE test, SINGLE persistent browser session. Runs every flow
 * function in the order specified by the user; between page groups
 * (there's only one page group here) the browser stays open until
 * you click Resume in the Playwright Inspector.
 *
 * Each flow function is a discrete, labelled step so they map 1:1 to
 * the trackable code you asked for. Selectors target `data-testid`
 * attributes that were added to `taskboard-admin.ts` in the same
 * commit as this file.
 *
 * Coverage (mirrors your instruction list):
 *   1. filters
 *   2. add task
 *   3. edit task
 *   4. add note
 *   5. change status
 *   6. delete task
 */
const { test, expect } = require('@playwright/test');
const { moveThenClick, humanType, humanPick, waitForContinue } = require('../helpers/ui');
const db = require('../helpers/db');

const TITLE = `E2E-TASK ${Date.now()}`;
const EDITED_TITLE = `E2E-TASK-EDITED ${Date.now()}`;

// Human-mouse animation is deliberately visible; a full run needs ~5
// minutes of wall-clock. Playwright's default 60s test timeout kills
// the browser mid-flow so the whole spec fails on the first slow step.
test.setTimeout(10 * 60 * 1000);

test('taskboard page: filters -> add -> edit -> note -> status -> delete', async ({ page }) => {
  // Land on the taskboard.
  await page.goto('admin/taskboard');
  await expect(page.getByRole('heading', { name: 'Task Board' })).toBeVisible();

  // ── Flow functions, in order ─────────────────────────────
  await filters(page);
  await addTask(page, TITLE);
  const taskId = await lookupTaskIdByTitle(TITLE);
  await editTask(page, taskId, EDITED_TITLE);
  await addNote(page, taskId, 'E2E note: post created from Playwright.');
  await changeStatus(page, taskId, 'in_progress');
  await deleteTask(page, taskId);

  // Persistent window: wait for you to click Resume before the test
  // (and its browser context) tears down.
  await waitForContinue(page, 'Taskboard flow complete');
});

/* ────────────────────────────────────────────────────────────
 * FLOW FUNCTIONS - each mirrors a bullet from your spec.
 * ────────────────────────────────────────────────────────── */

/** filters: sample a few category pills + type in the search box.
 *  Not every pill to keep total runtime reasonable - 3 is enough
 *  to demonstrate the filter loop works.
 *  @param {import('@playwright/test').Page} page */
async function filters(page) {
  for (const cat of ['client', 'onboarding', 'all']) {
    await moveThenClick(page, `taskboard-filter-${cat}`);
    await expect(page.getByTestId(`taskboard-filter-${cat}`)).toHaveClass(/selected/);
  }

  await humanType(page, 'taskboard-search', 'ZZZ-no-match');
  await humanType(page, 'taskboard-search', ''); // clear
}

/** addTask: open modal, fill fields, save.
 *  @param {import('@playwright/test').Page} page
 *  @param {string} title */
async function addTask(page, title) {
  await moveThenClick(page, 'taskboard-btn-add');
  await expect(page.getByTestId('taskboard-modal-title')).toBeVisible();

  await humanType(page, 'taskboard-modal-title',       title);
  await humanType(page, 'taskboard-modal-description', 'Created via Playwright e2e spec.');
  await humanPick(page, 'taskboard-modal-category',    'other');
  await humanPick(page, 'taskboard-modal-priority',    'high');
  await humanPick(page, 'taskboard-modal-status',      'to_do');

  await moveThenClick(page, 'taskboard-modal-save');
  // Modal should close; new title should appear in the table.
  await expect(page.getByText(title)).toBeVisible();
}

/** Look up the crm_tasks.id for a given title (used by later flows).
 *  @param {string} title */
async function lookupTaskIdByTitle(title) {
  const raw = db.sql(
    `SELECT id FROM crm_tasks WHERE tenant_id=1 AND title='${title.replace(/'/g, "''")}' LIMIT 1`,
  );
  if (!raw) throw new Error(`lookupTaskIdByTitle: no task with title=${title}`);
  return parseInt(raw, 10);
}

/** editTask: click the row's edit icon, change title, save.
 *  @param {import('@playwright/test').Page} page
 *  @param {number} id
 *  @param {string} newTitle */
async function editTask(page, id, newTitle) {
  await moveThenClick(page, `taskboard-row-${id}-edit`);
  await expect(page.getByTestId('taskboard-modal-title')).toBeVisible();
  await humanType(page, 'taskboard-modal-title', newTitle);
  await moveThenClick(page, 'taskboard-modal-save');
  await expect(page.getByText(newTitle)).toBeVisible();
}

/** addNote: reopen task, type in the note textarea, click Post.
 *  @param {import('@playwright/test').Page} page
 *  @param {number} id
 *  @param {string} body */
async function addNote(page, id, body) {
  await moveThenClick(page, `taskboard-row-${id}-edit`);
  await humanType(page, 'taskboard-modal-note-body', body);
  await moveThenClick(page, 'taskboard-modal-note-post');
  // Post button clears the textarea + appends to note list.
  await expect(page.getByText(body)).toBeVisible();
  // Close the modal so the next flow can re-open cleanly.
  await moveThenClick(page, 'taskboard-modal-cancel');
}

/** changeStatus: use the row-level inline status <select>.
 *  @param {import('@playwright/test').Page} page
 *  @param {number} id
 *  @param {string} status */
async function changeStatus(page, id, status) {
  await humanPick(page, `taskboard-status-${id}`, status);
  // DB round-trip - assert the row now reads the new status.
  await expect
    .poll(() => db.sql(`SELECT status FROM crm_tasks WHERE id=${id}`))
    .toBe(status);
}

/** deleteTask: click ✕ - a custom dialog confirm appears (memory:
 *  Dialog overlay lives at core/dialog.ts) - click Delete to confirm.
 *  @param {import('@playwright/test').Page} page
 *  @param {number} id */
async function deleteTask(page, id) {
  await moveThenClick(page, `taskboard-row-${id}-delete`);
  // The overlay dialog renders inside `app-dialog-host`. Its primary
  // button is labelled Delete when the variant is danger.
  await moveThenClick(page, page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }));
  // Row should be gone from the DB.
  await expect
    .poll(() => db.sql(`SELECT COUNT(*) FROM crm_tasks WHERE id=${id}`))
    .toBe('0');
}
