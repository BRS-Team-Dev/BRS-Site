#!/usr/bin/env bash
# Live end-to-end for the onboarding submit → auto-qualify → CSO →
# task_project → crm_task chain. Creates a real onboarding_clients
# token, posts a real submission through the HTTP endpoint, and
# verifies every downstream side effect against the DB.
#
# Fixtures are cleaned up on exit whether the test passes or fails,
# so the DB is left in the same shape it was found in.

set -u
MYSQL="/c/xampp/mysql/bin/mysql.exe"
DB="builtrightstudio_cms"
BASE="http://localhost/builtrightstudio/cms/api"
PASS=0; FAIL=0

sql () { "$MYSQL" -uroot "$DB" -sN -e "$1" 2>&1; }
ok  () { PASS=$((PASS+1)); echo "  ✓ $1"; }
err () { FAIL=$((FAIL+1)); echo "  ✗ $1"; [ -n "${2:-}" ] && echo "     $2"; }
section () { echo ""; echo "── $1"; }

# Fixture ids we control so cleanup is exact.
FORM_ID=2                          # management_system onboarding form
UNIQ="e2e-$(date +%s)-$$"
EMAIL="e2e+${UNIQ}@example.test"
TOKEN=$(openssl rand -hex 32)      # 64 hex chars — matches the length gate

# Track ids to clean up at exit. Only touch rows we created.
CLEANUP_TEAM_ID=""
CLEANUP_SET_TEAM_ID_BACK=""
CLEANUP_OC_ID=""
CLEANUP_CLIENT_ID=""

cleanup () {
    echo ""; echo "── Cleanup"
    [ -n "$CLEANUP_OC_ID"     ] && sql "DELETE FROM onboarding_clients WHERE id=$CLEANUP_OC_ID" >/dev/null
    [ -n "$CLEANUP_CLIENT_ID" ] && sql "DELETE FROM crm_tasks WHERE service_client_link_id IN (SELECT id FROM client_service_offerings WHERE client_id=$CLEANUP_CLIENT_ID)" >/dev/null
    [ -n "$CLEANUP_CLIENT_ID" ] && sql "DELETE FROM task_projects WHERE client_id=$CLEANUP_CLIENT_ID" >/dev/null
    [ -n "$CLEANUP_CLIENT_ID" ] && sql "DELETE FROM client_service_offerings WHERE client_id=$CLEANUP_CLIENT_ID" >/dev/null
    [ -n "$CLEANUP_CLIENT_ID" ] && sql "DELETE FROM clients WHERE id=$CLEANUP_CLIENT_ID" >/dev/null
    sql "DELETE FROM form_management_system WHERE contact_email='$EMAIL'" >/dev/null
    # Restore team_id on the form if we mutated it.
    [ -n "$CLEANUP_SET_TEAM_ID_BACK" ] && sql "UPDATE forms SET team_id=NULL WHERE id=$FORM_ID" >/dev/null
    [ -n "$CLEANUP_TEAM_ID"   ] && sql "DELETE FROM task_teams WHERE id=$CLEANUP_TEAM_ID" >/dev/null
    echo "  Fixture rows removed."
}
trap cleanup EXIT

# ─────────────────────────────────────────────────────────────────
section "0. Fixture — ensure the form has a team so task_project fires"
# The seeded management_system form has team_id=NULL. Create a
# throwaway team and point the form at it for this test, then revert.
CLEANUP_TEAM_ID=$(sql "INSERT INTO task_teams (tenant_id, slug, name) VALUES (1, 'e2e-team-${UNIQ}', 'E2E Team'); SELECT LAST_INSERT_ID();")
if [ -z "$CLEANUP_TEAM_ID" ] || [ "$CLEANUP_TEAM_ID" = "0" ]; then
    err "failed to create test team"; exit 1
fi
ok "created throwaway team id=$CLEANUP_TEAM_ID"
sql "UPDATE forms SET team_id=$CLEANUP_TEAM_ID WHERE id=$FORM_ID" >/dev/null
CLEANUP_SET_TEAM_ID_BACK=1
ok "assigned team to form $FORM_ID"

# ─────────────────────────────────────────────────────────────────
section "1. Create onboarding_clients row + submission_id"
# Insert the submission row first — the submit handler expects
# onboarding_clients.submission_id to point at a form_management_system
# row so it can read the answers back out for auto-attach.
CLEANUP_SUB_ID=$(sql "INSERT INTO form_management_system
    (tenant_id, company_name, company_url, company_size, contact_name, contact_email, contact_phone)
    VALUES (1, 'E2E Corp ${UNIQ}', 'https://e2e.example', '10-25', 'E2E Contact', '$EMAIL', '+44 1234 000000');
    SELECT LAST_INSERT_ID();")
ok "created form_management_system row id=$CLEANUP_SUB_ID"

CLEANUP_OC_ID=$(sql "INSERT INTO onboarding_clients
    (tenant_id, form_id, client_email, client_name, client_token, submission_id, started_at)
    VALUES (1, $FORM_ID, '$EMAIL', 'E2E Contact', '$TOKEN', $CLEANUP_SUB_ID, NOW());
    SELECT LAST_INSERT_ID();")
ok "created onboarding_clients row id=$CLEANUP_OC_ID token=${TOKEN:0:12}…"

# ─────────────────────────────────────────────────────────────────
section "2. POST /submit — real HTTP call"
RESP=$(curl -s -w "\n---HTTP %{http_code}---\n" -X POST \
    "$BASE/public/onboarding/$FORM_ID/$TOKEN/submit")
HTTP=$(printf '%s' "$RESP" | grep -oE 'HTTP [0-9]+' | tail -1 | awk '{print $2}')
if [ "$HTTP" = "200" ] || [ "$HTTP" = "201" ]; then
    ok "submit endpoint returned $HTTP"
else
    err "submit endpoint returned $HTTP" "$RESP"
fi

# ─────────────────────────────────────────────────────────────────
section "3. Side effect: onboarding_clients auto-qualified"
row=$(sql "SELECT submitted_at IS NOT NULL, qualified_at IS NOT NULL FROM onboarding_clients WHERE id=$CLEANUP_OC_ID")
sub_flag=$(echo "$row" | awk '{print $1}')
qual_flag=$(echo "$row" | awk '{print $2}')
[ "$sub_flag" = "1" ]  && ok "submitted_at set"  || err "submitted_at NOT set" "$row"
[ "$qual_flag" = "1" ] && ok "qualified_at set (auto-qualify)" || err "qualified_at NOT set" "$row"

# ─────────────────────────────────────────────────────────────────
section "4. Side effect: clients row auto-created"
CLEANUP_CLIENT_ID=$(sql "SELECT id FROM clients WHERE LOWER(email)=LOWER('$EMAIL') LIMIT 1")
if [ -n "$CLEANUP_CLIENT_ID" ] && [ "$CLEANUP_CLIENT_ID" != "0" ]; then
    ok "clients row id=$CLEANUP_CLIENT_ID"
    row=$(sql "SELECT company, phone FROM clients WHERE id=$CLEANUP_CLIENT_ID")
    echo "$row" | grep -q "E2E Corp ${UNIQ}" && ok "company copied from submission" || err "company not copied" "$row"
    echo "$row" | grep -q '+44 1234 000000' && ok "phone copied from submission"    || err "phone not copied"   "$row"
else
    err "clients row was NOT created"
    CLEANUP_CLIENT_ID=""  # so cleanup skips
fi

# ─────────────────────────────────────────────────────────────────
section "5. Side effect: client_service_offerings row with status='qualified'"
if [ -n "$CLEANUP_CLIENT_ID" ]; then
    CSO=$(sql "SELECT id, service_offering_id, status FROM client_service_offerings WHERE client_id=$CLEANUP_CLIENT_ID")
    if [ -n "$CSO" ]; then
        cso_svc=$(echo "$CSO" | awk '{print $2}')
        cso_status=$(echo "$CSO" | awk '{print $3}')
        [ "$cso_svc" = "5" ] && ok "CSO service_offering_id=5 (Management system)"    || err "CSO service_offering_id wrong" "$CSO"
        [ "$cso_status" = "qualified" ] && ok "CSO status='qualified' (auto-advanced)" || err "CSO status wrong" "$CSO"
    else
        err "no CSO row created"
    fi
fi

# ─────────────────────────────────────────────────────────────────
section "6. Side effect: task_projects row (form has team_id)"
if [ -n "$CLEANUP_CLIENT_ID" ]; then
    TP=$(sql "SELECT id, team_id, client_id, onboarding_client_id, status FROM task_projects WHERE onboarding_client_id=$CLEANUP_OC_ID")
    if [ -n "$TP" ]; then
        ok "task_projects row created: $TP"
        tp_team=$(echo "$TP" | awk '{print $2}')
        tp_client=$(echo "$TP" | awk '{print $3}')
        [ "$tp_team" = "$CLEANUP_TEAM_ID" ] && ok "project team_id matches ($tp_team)" || err "project team_id wrong" "want $CLEANUP_TEAM_ID, got $tp_team"
        [ "$tp_client" = "$CLEANUP_CLIENT_ID" ] && ok "project client_id linked to canonical client" || err "project client_id not linked" "want $CLEANUP_CLIENT_ID, got $tp_client"
    else
        err "task_projects row NOT created"
    fi
fi

# ─────────────────────────────────────────────────────────────────
section "7. Side effect: crm_tasks row"
if [ -n "$CLEANUP_CLIENT_ID" ]; then
    CSO_ID=$(sql "SELECT id FROM client_service_offerings WHERE client_id=$CLEANUP_CLIENT_ID LIMIT 1")
    if [ -n "$CSO_ID" ]; then
        CT=$(sql "SELECT id, title, category, priority, status FROM crm_tasks WHERE service_client_link_id=$CSO_ID")
        if [ -n "$CT" ]; then
            ok "crm_tasks row: $CT"
            echo "$CT" | grep -q '^[0-9]*[[:space:]]*New client' && ok "title starts with 'New client'" || err "title wrong" "$CT"
            echo "$CT" | grep -q 'client'                       && ok "category='client'"              || err "category wrong"
            echo "$CT" | grep -q 'high'                         && ok "priority='high'"                || err "priority wrong"
            echo "$CT" | grep -q 'to_do'                        && ok "status='to_do'"                 || err "status wrong"
        else
            err "crm_tasks row NOT created for CSO $CSO_ID"
        fi
    fi
fi

# ─────────────────────────────────────────────────────────────────
section "8. crm_tasks list JOIN surfaces linked client"
if [ -n "$CLEANUP_CLIENT_ID" ]; then
    JOIN=$(sql "SELECT cso.client_id AS linked_client_id, cl.name AS linked_client_name
                  FROM crm_tasks t
             LEFT JOIN client_service_offerings cso ON cso.id = t.service_client_link_id
             LEFT JOIN clients cl ON cl.id = cso.client_id
                 WHERE t.service_client_link_id IN
                       (SELECT id FROM client_service_offerings WHERE client_id=$CLEANUP_CLIENT_ID)")
    lc_id=$(echo "$JOIN" | awk '{print $1}')
    lc_name=$(echo "$JOIN" | awk '{$1=""; print $0}' | sed 's/^ //')
    [ "$lc_id" = "$CLEANUP_CLIENT_ID" ] && ok "join returns linked_client_id=$lc_id"     || err "join client_id wrong" "$JOIN"
    [ -n "$lc_name" ]                   && ok "join returns linked_client_name='$lc_name'" || err "join name empty"
fi

# ─────────────────────────────────────────────────────────────────
section "9. Idempotency — re-submit should NOT double-create side effects"
curl -s -X POST "$BASE/public/onboarding/$FORM_ID/$TOKEN/submit" >/dev/null
COUNTS=$(sql "SELECT
    (SELECT COUNT(*) FROM client_service_offerings WHERE client_id=$CLEANUP_CLIENT_ID) AS cso,
    (SELECT COUNT(*) FROM task_projects WHERE onboarding_client_id=$CLEANUP_OC_ID) AS tp,
    (SELECT COUNT(*) FROM crm_tasks WHERE service_client_link_id IN (SELECT id FROM client_service_offerings WHERE client_id=$CLEANUP_CLIENT_ID)) AS ct")
c_cso=$(echo "$COUNTS" | awk '{print $1}')
c_tp=$(echo "$COUNTS"  | awk '{print $2}')
c_ct=$(echo "$COUNTS"  | awk '{print $3}')
[ "$c_cso" = "1" ] && ok "CSO count still 1 (no dupe on re-submit)"          || err "CSO duplicated" "count=$c_cso"
[ "$c_tp"  = "1" ] && ok "task_project count still 1 (no dupe on re-submit)" || err "task_project duplicated" "count=$c_tp"
[ "$c_ct"  = "1" ] && ok "crm_task count still 1 (no dupe on re-submit)"     || err "crm_task duplicated" "count=$c_ct"

# ─────────────────────────────────────────────────────────────────
section "Summary"
echo ""
echo "  Passed: $PASS"
echo "  Failed: $FAIL"
[ "$FAIL" -eq 0 ] && echo "  🟢 End-to-end flow validated." || echo "  🔴 Investigate failing checks above."
exit "$FAIL"
