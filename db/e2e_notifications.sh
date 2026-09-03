#!/usr/bin/env bash
# End-to-end verification of NotificationDispatcher — the code path every
# trigger call site (public.php / public_onboarding.php / public_feedback.php)
# invokes via one-line calls. Uses direct PHP CLI dispatch so we test the
# component itself, not the HTTP transport.
#
# Approach: capture a "since" timestamp before each fire, then count rows
# created after it. No title mangling, no fixture cross-contamination.

set -u
MYSQL="/c/xampp/mysql/bin/mysql.exe"
PHP="/c/xampp/php/php.exe"
DB="builtrightstudio_cms"
PASS=0; FAIL=0

sql () { "$MYSQL" -uroot "$DB" -sN -e "$1" 2>&1; }
ok  () { PASS=$((PASS+1)); echo "  ✓ $1"; }
err () { FAIL=$((FAIL+1)); echo "  ✗ $1"; [ -n "${2:-}" ] && echo "     $2"; }
section () { echo ""; echo "── $1"; }

# Shim that fires the dispatcher against the real .env-configured DB.
# Uses bootstrap.php (the actual name of the autoload file) with a
# BRS_ENV_FILE override so BRS\Config finds .env correctly.
fire () {
    local key="$1" title="$2" link="$3"
    BRS_ENV_FILE="$PWD/cms/.env" "$PHP" -r "
        require 'cms/api/bootstrap.php';
        BRS\\Tenant::overrideTo(1);
        \$n = BRS\\NotificationDispatcher::fire('$key', [
            'title'    => '$title',
            'body'     => null,
            'link_url' => '$link',
        ]);
        echo \$n;
    " 2>&1
}

# ─────────────────────────────────────────────────────────────────
section "0. Prep"
ADMIN_COUNT=$(sql "SELECT COUNT(*) FROM admin_users WHERE tenant_id=1 AND role='admin' AND is_active=1")
[ "$ADMIN_COUNT" -gt 0 ] && ok "$ADMIN_COUNT admin(s) on tenant 1" || { err "no admins"; exit 1; }

# Ensure no stale test rules from prior runs skew results
sql "DELETE FROM notification_rules WHERE tenant_id=1 AND event_key IN
       ('crm.feedback.response','crm.form.submitted','crm.onboarding.submitted')" >/dev/null
ok "cleared any stale test rules"

# ─────────────────────────────────────────────────────────────────
run_dispatch_test () {
    local event_key="$1" expect_category="$2" description="$3"
    section "Trigger: $event_key ($description)"

    # Delta window — capture start time BEFORE fire
    local since
    since=$(sql "SELECT NOW()")
    sleep 1  # ensure clock advances so DEFAULT CURRENT_TIMESTAMP > since

    local returned
    returned=$(fire "$event_key" "TEST-$event_key" "/admin/test")

    if [ "$returned" = "$ADMIN_COUNT" ]; then
        ok "dispatcher returned $returned (matches admin count)"
    else
        err "dispatcher return value" "expected $ADMIN_COUNT got '$returned'"
    fi

    local n_new
    n_new=$(sql "SELECT COUNT(*) FROM notifications
                    WHERE tenant_id=1 AND event_key='$event_key' AND created_at > '$since'")
    local t_new
    t_new=$(sql "SELECT COUNT(*) FROM crm_tasks
                    WHERE tenant_id=1 AND title='TEST-$event_key' AND created_at > '$since'")
    local t_cat
    t_cat=$(sql "SELECT category FROM crm_tasks
                    WHERE tenant_id=1 AND title='TEST-$event_key' AND created_at > '$since' LIMIT 1")

    [ "$n_new" = "$ADMIN_COUNT" ] && ok "$n_new notifications (one per admin)" \
        || err "notification count" "expected $ADMIN_COUNT got $n_new"
    [ "$t_new" = "1" ] && ok "1 crm_task created (creates_task=1)" \
        || err "task count" "expected 1 got $t_new"
    [ "$t_cat" = "$expect_category" ] && ok "task category='$expect_category'" \
        || err "task category" "expected '$expect_category' got '$t_cat'"

    # Cleanup
    sql "DELETE FROM notifications WHERE event_key='$event_key' AND created_at > '$since'" >/dev/null
    sql "DELETE FROM crm_tasks     WHERE title='TEST-$event_key' AND created_at > '$since'" >/dev/null
}

# All 3 wired triggers, with expected task category from the section→category map
run_dispatch_test 'crm.form.submitted'       'form'       'Public form submitted'
run_dispatch_test 'crm.onboarding.submitted' 'onboarding' 'Onboarding form submitted'
run_dispatch_test 'crm.feedback.response'    'form'       'Feedback response received'

# ─────────────────────────────────────────────────────────────────
section "Rule override: enabled=0 skips notification + task"
sql "INSERT INTO notification_rules
       (tenant_id, event_key, enabled, recipient_scope, recipient_ref, creates_task)
     VALUES (1, 'crm.form.submitted', 0, 'role', 'admin', 1)
     ON DUPLICATE KEY UPDATE enabled = 0" >/dev/null

since=$(sql "SELECT NOW()"); sleep 1
returned=$(fire 'crm.form.submitted' 'TEST-DISABLED' '')

[ "$returned" = "0" ] && ok "dispatcher returned 0 (enabled=0)" \
    || err "should return 0 when disabled" "got '$returned'"
n_new=$(sql "SELECT COUNT(*) FROM notifications WHERE event_key='crm.form.submitted' AND created_at > '$since'")
t_new=$(sql "SELECT COUNT(*) FROM crm_tasks     WHERE title='TEST-DISABLED' AND created_at > '$since'")
[ "$n_new" = "0" ] && ok "no notifications fired" || err "notification leak" "got $n_new"
[ "$t_new" = "0" ] && ok "no task created"       || err "task leak"         "got $t_new"

sql "DELETE FROM notification_rules WHERE tenant_id=1 AND event_key='crm.form.submitted'" >/dev/null

# ─────────────────────────────────────────────────────────────────
section "Rule override: creates_task=0 keeps notification, skips task"
sql "INSERT INTO notification_rules
       (tenant_id, event_key, enabled, recipient_scope, recipient_ref, creates_task)
     VALUES (1, 'crm.feedback.response', 1, 'role', 'admin', 0)
     ON DUPLICATE KEY UPDATE creates_task = 0, enabled = 1" >/dev/null

since=$(sql "SELECT NOW()"); sleep 1
returned=$(fire 'crm.feedback.response' 'TEST-NOTASK' '')

[ "$returned" = "$ADMIN_COUNT" ] && ok "dispatcher returned $ADMIN_COUNT (notifs still delivered)" \
    || err "expected $ADMIN_COUNT" "got '$returned'"
n_new=$(sql "SELECT COUNT(*) FROM notifications WHERE event_key='crm.feedback.response' AND created_at > '$since'")
t_new=$(sql "SELECT COUNT(*) FROM crm_tasks     WHERE title='TEST-NOTASK' AND created_at > '$since'")
[ "$n_new" = "$ADMIN_COUNT" ] && ok "$n_new notifications delivered" \
    || err "notification count" "expected $ADMIN_COUNT got $n_new"
[ "$t_new" = "0" ] && ok "task NOT created (rule creates_task=0)" \
    || err "task should be suppressed" "got $t_new"

# Cleanup
sql "DELETE FROM notification_rules WHERE tenant_id=1 AND event_key='crm.feedback.response'" >/dev/null
sql "DELETE FROM notifications WHERE event_key='crm.feedback.response' AND created_at > '$since'" >/dev/null

# ─────────────────────────────────────────────────────────────────
section "Inbox endpoint queries"
# Verify the SELECTs the /api/notifications endpoints execute.
UNREAD=$(sql "SELECT COUNT(*) FROM notifications
                 WHERE tenant_id=1 AND user_id = (SELECT id FROM admin_users WHERE tenant_id=1 AND role='admin' LIMIT 1)
                   AND read_at IS NULL")
[ "$UNREAD" -ge 0 ] && ok "unread-count query returns $UNREAD (structure OK)" \
    || err "unread-count query broken"

BY_SECTION=$(sql "SELECT COUNT(DISTINCT section) FROM notifications WHERE tenant_id=1")
[ "$BY_SECTION" -ge 0 ] && ok "by-section groupBy query works ($BY_SECTION sections present)" \
    || err "by-section query broken"

# ─────────────────────────────────────────────────────────────────
section "Summary"
echo ""
echo "  Passed: $PASS"
echo "  Failed: $FAIL"
[ "$FAIL" -eq 0 ] && echo "  🟢 Dispatcher verified end-to-end." || echo "  🔴 See failures above."
exit "$FAIL"
