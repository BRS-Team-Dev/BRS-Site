// @ts-check
/**
 * DB helpers for e2e tests. Shells out to the local mysql client because
 * we don't want to pull a Node MySQL driver just for setup/teardown.
 *
 * Every function is synchronous over `spawnSync` — tests await them via
 * a thin wrapper to keep the spec code linear.
 */
const { spawnSync } = require('node:child_process');

const MYSQL = 'C:/xampp/mysql/bin/mysql.exe';
const DB    = 'builtrightstudio_cms';

function sql(query) {
  const res = spawnSync(MYSQL, ['-uroot', DB, '-sN', '-e', query], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (res.status !== 0) throw new Error(`mysql: ${res.stderr || res.stdout}`);
  return res.stdout.trim();
}

/** admin_users.id of the claude-test super-admin on tenant 1. */
function testAdminId() {
  return parseInt(
    sql(`SELECT id FROM admin_users WHERE email='claude-test@builtrightstudio.com' AND tenant_id=1`),
    10,
  );
}

/** Wipe every notification + notification-related crm_task for our
 *  test user so counts start at zero for each scenario. */
function resetInbox() {
  const uid = testAdminId();
  sql(`DELETE FROM notifications WHERE user_id=${uid}`);
  // Also drop any test-generated tasks so counts don't drift.
  sql(`DELETE FROM crm_tasks WHERE title LIKE 'E2E-%' OR title LIKE 'Feedback response — %E2E-%'`);
}

function unreadCount() {
  const uid = testAdminId();
  const n = sql(`SELECT COUNT(*) FROM notifications WHERE user_id=${uid} AND read_at IS NULL`);
  return parseInt(n, 10);
}

function taskCount(pattern = '%') {
  const n = sql(`SELECT COUNT(*) FROM crm_tasks WHERE tenant_id=1 AND title LIKE '${pattern.replace(/'/g, "''")}'`);
  return parseInt(n, 10);
}

/** Get a published feedback poll's token so we can hit the public
 *  submit endpoint without needing to build one via the UI. */
function seededPollToken() {
  const t = sql(
    `SELECT public_token FROM feedback_forms
       WHERE tenant_id=1 AND is_published=1 AND kind='poll'
       ORDER BY id LIMIT 1`,
  );
  if (!t) throw new Error('no seeded published poll — run seed_feedback_test.sql first');
  return t;
}

function clearRules(eventKey) {
  sql(`DELETE FROM notification_rules WHERE tenant_id=1 AND event_key='${eventKey}'`);
}

/**
 * Insert a bare-minimum standard form with a single 'notes' text field.
 * Returns { form_id, slug, table_name }.
 * Skips DDL::syncTable and manually creates the dynamic table so the
 * setup is one shell call, not a whole PHP roundtrip.
 */
function seedTestForm(slug = 'e2e_test_form', title = 'E2E Test Form') {
  // Idempotent: drop any prior seed.
  sql(`DELETE FROM forms WHERE slug='${slug}' AND tenant_id=1`);
  sql(`DROP TABLE IF EXISTS \`form_${slug}\``);

  sql(
    `INSERT INTO forms (tenant_id, slug, form_type, title, submit_label, is_published)
     VALUES (1, '${slug}', 'standard', '${title.replace(/'/g, "''")}', 'Submit', 1)`,
  );
  const form_id = parseInt(sql(`SELECT id FROM forms WHERE slug='${slug}' AND tenant_id=1`), 10);

  sql(
    `INSERT INTO form_fields
       (tenant_id, form_id, name, label, type, is_required, sort_order)
     VALUES (1, ${form_id}, 'notes', 'Notes', 'text', 0, 1)`,
  );

  const table_name = `form_${slug}`;
  sql(
    `CREATE TABLE \`${table_name}\` (
       id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
       tenant_id INT UNSIGNED NOT NULL,
       submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       ip_address VARCHAR(45) NULL,
       notes TEXT NULL,
       KEY (tenant_id)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  );

  return { form_id, slug, table_name };
}

/** Insert a submission row directly and link it to a record.
 *  Returns { submission_id, link_id }. */
function seedSubmission({ form_id, table_name, notes, client_id, lead_id, service_offering_id }) {
  sql(
    `INSERT INTO \`${table_name}\` (tenant_id, notes) VALUES (1, '${(notes || '').replace(/'/g, "''")}')`,
  );
  const submission_id = parseInt(sql(`SELECT LAST_INSERT_ID()`), 10);
  sql(
    `INSERT INTO form_submission_links
       (tenant_id, form_id, submission_table, submission_id,
        client_id, lead_id, service_offering_id, attach_source)
     VALUES (1, ${form_id}, '${table_name}', ${submission_id},
        ${client_id ? client_id : 'NULL'},
        ${lead_id ? lead_id : 'NULL'},
        ${service_offering_id ? service_offering_id : 'NULL'},
        'auto')`,
  );
  const link_id = parseInt(sql(`SELECT LAST_INSERT_ID()`), 10);
  return { submission_id, link_id };
}

/** Any existing client id for tenant 1 (or null). */
function anyClientId() {
  const r = sql(`SELECT id FROM clients WHERE tenant_id=1 ORDER BY id LIMIT 1`);
  return r ? parseInt(r, 10) : null;
}

/** Any existing lead id for tenant 1 (or null). */
function anyLeadId() {
  const r = sql(`SELECT id FROM leads WHERE tenant_id=1 ORDER BY id LIMIT 1`);
  return r ? parseInt(r, 10) : null;
}

/** Any existing service offering id (or null). */
function anyServiceId() {
  const r = sql(`SELECT id FROM service_offerings WHERE tenant_id=1 ORDER BY id LIMIT 1`);
  return r ? parseInt(r, 10) : null;
}

/** Remove every trace of the e2e test seed so a re-run starts clean. */
function cleanupTestForm(slug = 'e2e_test_form') {
  const idRow = sql(`SELECT id FROM forms WHERE slug='${slug}' AND tenant_id=1`);
  if (idRow) {
    const form_id = parseInt(idRow, 10);
    sql(`DELETE FROM form_submission_links WHERE form_id=${form_id}`);
    sql(`DELETE FROM forms WHERE id=${form_id}`);
  }
  sql(`DROP TABLE IF EXISTS \`form_${slug}\``);
}

module.exports = {
  sql,
  testAdminId,
  resetInbox,
  unreadCount,
  taskCount,
  seededPollToken,
  clearRules,
  seedTestForm,
  seedSubmission,
  anyClientId,
  anyLeadId,
  anyServiceId,
  cleanupTestForm,
};
