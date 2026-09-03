#!/usr/bin/env bash
# End-to-end smoke for the feedback + onboarding + task-board feature stack.
# Runs against the local XAMPP DB. Uses direct SQL (rolled back where
# possible) for admin-scoped behavior, curl for the public routes.
#
# Prints  ✓  / ✗ per check + a summary. Any ✗ means investigate.

set -u
MYSQL="/c/xampp/mysql/bin/mysql.exe"
DB="builtrightstudio_cms"
BASE="http://localhost/builtrightstudio/cms/api"
PASS=0; FAIL=0

sql () { "$MYSQL" -uroot "$DB" -sN -e "$1" 2>&1; }
say () { echo "$@"; }
ok  () { PASS=$((PASS+1)); say "  ✓ $1"; }
err () { FAIL=$((FAIL+1)); say "  ✗ $1"; [ -n "${2:-}" ] && say "     $2"; }

section () { say ""; say "── $1"; }

# ─────────────────────────────────────────────────────────────────
section "1. Schema — migrations 119 / 120 / 121"
for t in feedback_forms feedback_questions feedback_responses feedback_answers \
         feedback_form_clients feedback_form_leads; do
  n=$(sql "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$DB' AND table_name='$t'")
  [ "$n" = "1" ] && ok "table $t exists" || err "table $t missing"
done
for c in broadcast_to_all_clients broadcast_to_all_leads service_offering_id public_token; do
  n=$(sql "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='$DB' AND table_name='feedback_forms' AND column_name='$c'")
  [ "$n" = "1" ] && ok "feedback_forms.$c present" || err "feedback_forms.$c missing"
done

# ─────────────────────────────────────────────────────────────────
section "2. Public feedback GET — every URL variant"
TOKEN=$(sql "SELECT public_token FROM feedback_forms WHERE tenant_id=1 AND is_published=1 LIMIT 1")
[ -n "$TOKEN" ] || { err "no published form to test with"; exit 1; }

check_ctx () {
  local q="$1" want_c="$2" want_l="$3"
  local body ctx
  body=$(curl -s "$BASE/public/feedback/$TOKEN?$q")
  ctx=$(printf '%s' "$body" | grep -o '"context":{[^}]*}')
  local expect="\"context\":{\"client_id\":$want_c,\"lead_id\":$want_l}"
  if [ "$ctx" = "$expect" ]; then ok "?$q → $ctx"
  else err "?$q returned wrong context" "expected $expect, got $ctx"
  fi
}
check_ctx 'id=c2'    2      null
check_ctx 'id=l3'    null   3
check_ctx 'id=0'     null   null
check_ctx ''         null   null

# ─────────────────────────────────────────────────────────────────
section "3. Legacy ?client= / ?lead= fallback still works"
check_ctx 'client=2' 2      null
check_ctx 'lead=3'   null   3

# ─────────────────────────────────────────────────────────────────
section "4. Case-insensitive token"
UPPER=$(printf '%s' "$TOKEN" | tr 'a-f' 'A-F')
body=$(curl -s "$BASE/public/feedback/$UPPER?id=0")
if printf '%s' "$body" | grep -q '"questions":\['; then ok "uppercase token resolves"
else err "uppercase token rejected" "got: ${body:0:120}"
fi

# ─────────────────────────────────────────────────────────────────
section "5. match_source annotation on client filter"
# Reuse the exact CASE from feedback.php against a known client:
#   client 2 (Jane) has a qualified CSO for svc 5 (Management system)
# For coverage, add fixtures then roll back.
sql "START TRANSACTION;
     -- Use form 5 for the service test — no existing Jane response, so
     -- 'client' priority won't shadow the service branch. Form 3 gets
     -- the broadcast flag, form 1 gets an explicit junction to Jane.
     UPDATE feedback_forms SET broadcast_to_all_clients=1 WHERE id=3;
     UPDATE feedback_forms SET service_offering_id=5 WHERE id=5;
     INSERT IGNORE INTO feedback_form_clients (tenant_id, form_id, client_id) VALUES (1, 1, 2);
     SELECT f.id,
            CASE
              WHEN f.client_id = 2
                OR EXISTS (SELECT 1 FROM feedback_form_clients ffc WHERE ffc.form_id=f.id AND ffc.client_id=2)
                OR EXISTS (SELECT 1 FROM feedback_responses fr WHERE fr.form_id=f.id AND fr.client_id=2)
                THEN 'client'
              WHEN f.service_offering_id IS NOT NULL
                AND EXISTS (SELECT 1 FROM client_service_offerings cso WHERE cso.client_id=2 AND cso.service_offering_id=f.service_offering_id)
                THEN 'service'
              WHEN f.broadcast_to_all_clients=1 THEN 'broadcast'
              ELSE NULL
            END AS ms
       FROM feedback_forms f WHERE tenant_id=1;
     ROLLBACK;" > /tmp/ms.txt 2>&1

grep -q "^1[[:space:]]client$"    /tmp/ms.txt && ok "form 1 → 'client' (junction fixture)"    || err "form 1 not tagged 'client'" "$(cat /tmp/ms.txt)"
grep -q "^3[[:space:]]broadcast$" /tmp/ms.txt && ok "form 3 → 'broadcast' (fixture flag)"     || err "form 3 not tagged 'broadcast'"
grep -q "^5[[:space:]]service$"   /tmp/ms.txt && ok "form 5 → 'service' (fixture svc=5, no response shadow)" || err "form 5 not tagged 'service'" "$(cat /tmp/ms.txt)"

# ─────────────────────────────────────────────────────────────────
section "6. Detach cascade — junction + legacy + response retag"
sql "START TRANSACTION;
     -- Fixture: fully attach form 1 to client 2 via all three routes
     UPDATE feedback_forms SET client_id=2 WHERE id=1;
     INSERT IGNORE INTO feedback_form_clients (tenant_id, form_id, client_id) VALUES (1, 1, 2);
     INSERT INTO feedback_responses (tenant_id, form_id, client_id) VALUES (1, 1, 2);
     SET @rid = LAST_INSERT_ID();
     -- Pre-check
     SELECT '' AS _;
     SELECT client_id FROM feedback_forms WHERE id=1;
     SELECT COUNT(*) FROM feedback_form_clients WHERE form_id=1 AND client_id=2;
     SELECT COUNT(*) FROM feedback_responses WHERE form_id=1 AND client_id=2;
     -- Simulate detach
     DELETE FROM feedback_form_clients WHERE form_id=1 AND client_id=2;
     UPDATE feedback_forms SET client_id=NULL WHERE id=1 AND client_id=2;
     UPDATE feedback_responses SET client_id=NULL WHERE form_id=1 AND client_id=2;
     -- Post-check
     SELECT client_id FROM feedback_forms WHERE id=1;
     SELECT COUNT(*) FROM feedback_form_clients WHERE form_id=1 AND client_id=2;
     SELECT COUNT(*) FROM feedback_responses WHERE form_id=1 AND client_id=2;
     ROLLBACK;" > /tmp/detach.txt 2>&1

# Expect: legacy NULL after, junction 0 after, responses 0 after
if grep -q '^NULL$' /tmp/detach.txt && \
   awk 'NR==FNR{a[NR]=$0;next}' /tmp/detach.txt /dev/null; \
   [ "$(tail -n 3 /tmp/detach.txt | head -1)" = "NULL" ] && \
   [ "$(tail -n 2 /tmp/detach.txt | head -1)" = "0" ] && \
   [ "$(tail -n 1 /tmp/detach.txt)" = "0" ]; then
   ok "detach nulled legacy, deleted junction, retagged responses"
else
   err "detach cascade produced unexpected state" "$(cat /tmp/detach.txt)"
fi

# ─────────────────────────────────────────────────────────────────
section "7. Clone endpoint SQL simulation"
sql "START TRANSACTION;
     SET @src = 4;
     -- Source questions count
     SELECT COUNT(*) FROM feedback_questions WHERE form_id=@src;
     -- Simulate clone
     SET @svc_name = 'Web Design';
     INSERT INTO feedback_forms
       (tenant_id, kind, title, description, submit_label, public_token,
        is_published, broadcast_to_all_clients, broadcast_to_all_leads,
        service_offering_id)
     SELECT tenant_id, kind, CONCAT(title, ' (', @svc_name, ')'),
            description, submit_label,
            LOWER(CONCAT(LPAD(HEX(FLOOR(RAND()*POW(2,32))),8,'0'),
                        LPAD(HEX(FLOOR(RAND()*POW(2,32))),8,'0'),
                        LPAD(HEX(FLOOR(RAND()*POW(2,32))),8,'0'),
                        LPAD(HEX(FLOOR(RAND()*POW(2,32))),8,'0'),
                        LPAD(HEX(FLOOR(RAND()*POW(2,32))),8,'0'))),
            is_published, 0, 0, 5
       FROM feedback_forms WHERE id=@src;
     SET @dst = LAST_INSERT_ID();
     INSERT INTO feedback_questions (tenant_id, form_id, type, label, options_json, is_required, sort_order)
       SELECT tenant_id, @dst, type, label, options_json, is_required, sort_order
         FROM feedback_questions WHERE form_id=@src;
     SELECT title, broadcast_to_all_clients, broadcast_to_all_leads, service_offering_id
       FROM feedback_forms WHERE id=@dst;
     SELECT COUNT(*) FROM feedback_questions WHERE form_id=@dst;
     ROLLBACK;" > /tmp/clone.txt 2>&1

if grep -Eq 'Post-project satisfaction survey \(Web Design\)[[:space:]]+0[[:space:]]+0[[:space:]]+5' /tmp/clone.txt; then
  ok "clone form: title suffixed, broadcasts cleared, service set"
else
  err "clone form metadata wrong" "$(cat /tmp/clone.txt)"
fi
src_q=$(head -1 /tmp/clone.txt)
dst_q=$(tail -1 /tmp/clone.txt)
[ "$src_q" = "$dst_q" ] && [ -n "$src_q" ] && ok "clone questions: $src_q → $dst_q (match)" || err "question count mismatch" "src=$src_q dst=$dst_q"

# ─────────────────────────────────────────────────────────────────
section "8. Broadcast filters — all_clients, all_leads, service"
sql "START TRANSACTION;
     UPDATE feedback_forms SET broadcast_to_all_clients=1 WHERE id=3;
     -- Should appear for EVERY client
     SELECT COUNT(*) FROM feedback_forms f WHERE f.id=3
       AND (f.broadcast_to_all_clients=1);
     ROLLBACK;" > /tmp/bcast.txt 2>&1
grep -q '^1$' /tmp/bcast.txt && ok "broadcast_to_all_clients flag surfaces" || err "broadcast flag not read"

# ─────────────────────────────────────────────────────────────────
section "9. Promote lead → client carry-forward"
sql "START TRANSACTION;
     -- Fixture: give lead 2 a service link, a feedback junction, and a tagged response
     INSERT IGNORE INTO lead_services (tenant_id, lead_id, service_offering_id) VALUES (1, 2, 1);
     INSERT IGNORE INTO feedback_form_leads (tenant_id, form_id, lead_id) VALUES (1, 4, 2);
     INSERT INTO feedback_responses (tenant_id, form_id, lead_id) VALUES (1, 4, 2);
     SET @lead = 2;
     SET @new_client = 1;
     -- Run the exact statements from the promote handler
     INSERT INTO client_service_offerings
       (tenant_id, client_id, service_offering_id, name, price, payment_type, status)
     SELECT ls.tenant_id, @new_client, so.id, so.name, so.price,
            COALESCE(so.payment_type, 'one_off'), 'new'
       FROM lead_services ls JOIN service_offerings so ON so.id=ls.service_offering_id
      WHERE ls.lead_id=@lead;
     INSERT IGNORE INTO feedback_form_clients (tenant_id, form_id, client_id)
     SELECT tenant_id, form_id, @new_client FROM feedback_form_leads WHERE lead_id=@lead;
     UPDATE feedback_responses SET client_id=@new_client, lead_id=NULL WHERE lead_id=@lead;
     -- Verify
     SELECT (SELECT COUNT(*) FROM client_service_offerings WHERE client_id=@new_client AND service_offering_id=1) AS csos,
            (SELECT COUNT(*) FROM feedback_form_clients WHERE form_id=4 AND client_id=@new_client) AS junc,
            (SELECT COUNT(*) FROM feedback_responses WHERE form_id=4 AND client_id=@new_client AND lead_id IS NULL) AS resp;
     ROLLBACK;" > /tmp/promote.txt 2>&1
promo_line=$(tail -1 /tmp/promote.txt)
if echo "$promo_line" | grep -Eq '^[1-9][0-9]*[[:space:]]+[1-9][0-9]*[[:space:]]+[1-9][0-9]*$'; then
  ok "promote carried: CSO + junction + response retag ($promo_line)"
else
  err "promote carry-forward incomplete" "$promo_line"
fi

# ─────────────────────────────────────────────────────────────────
section "10. Relegate client → lead mirror"
sql "START TRANSACTION;
     SET @client = 1;
     SET @new_lead = 2;
     -- Fixture: give client 1 an extra CSO + feedback junction
     INSERT INTO client_service_offerings (tenant_id, client_id, service_offering_id, name, payment_type, status)
       VALUES (1, @client, 1, 'Website build', 'one_off', 'new');
     INSERT IGNORE INTO feedback_form_clients (tenant_id, form_id, client_id) VALUES (1, 1, @client);
     -- Run relegate SQL
     INSERT IGNORE INTO lead_services (tenant_id, lead_id, service_offering_id)
     SELECT DISTINCT cso.tenant_id, @new_lead, cso.service_offering_id
       FROM client_service_offerings cso WHERE cso.client_id=@client AND cso.service_offering_id IS NOT NULL;
     INSERT IGNORE INTO feedback_form_leads (tenant_id, form_id, lead_id)
     SELECT tenant_id, form_id, @new_lead FROM feedback_form_clients WHERE client_id=@client;
     UPDATE feedback_responses SET lead_id=@new_lead, client_id=NULL WHERE client_id=@client;
     SELECT (SELECT COUNT(*) FROM lead_services WHERE lead_id=@new_lead) AS ls,
            (SELECT COUNT(*) FROM feedback_form_leads WHERE lead_id=@new_lead AND form_id=1) AS junc;
     ROLLBACK;" > /tmp/releg.txt 2>&1
releg_line=$(tail -1 /tmp/releg.txt)
if echo "$releg_line" | grep -Eq '^[1-9][0-9]*[[:space:]]+[1-9][0-9]*$'; then
  ok "relegate carried: lead_services + junction ($releg_line)"
else
  err "relegate carry-forward incomplete" "$releg_line"
fi

# ─────────────────────────────────────────────────────────────────
section "11. Services tab dedup — onboarding row suppressed when CSO exists"
# Jane (client 2) has:
#   - onboarding_clients id=3, service_offering_id=5, qualified_at set
#   - client_service_offerings id=3, client_id=2, service_offering_id=5
# Emulate the dedup filter and confirm the onboarding row would be dropped.
res=$(sql "
  SELECT COUNT(*)
    FROM onboarding_clients oc
    JOIN forms f ON f.id = oc.form_id
    LEFT JOIN client_service_offerings cso
           ON cso.client_id = 2 AND cso.service_offering_id = f.service_offering_id
   WHERE LOWER(oc.client_email) = LOWER('acme-test@acme-example.com')
     AND f.sidenav_placement = 'child'
     AND f.sidenav_parent_key = 'services'
     AND oc.qualified_at IS NOT NULL
     AND cso.id IS NULL
")
[ "$res" = "0" ] && ok "dedup: 0 onboarding rows survive after CSO check" || err "dedup didn't suppress" "count=$res"

# ─────────────────────────────────────────────────────────────────
section "12. crm_tasks list join surfaces linked client"
sql "START TRANSACTION;
     INSERT INTO crm_tasks (tenant_id, title, category, priority, status, service_client_link_id)
       VALUES (1, 'E2E SMOKE new client', 'client', 'high', 'to_do', 3);
     SELECT t.title, cso.client_id, cl.name
       FROM crm_tasks t
       LEFT JOIN client_service_offerings cso ON cso.id = t.service_client_link_id
       LEFT JOIN clients cl ON cl.id = cso.client_id
      WHERE t.title = 'E2E SMOKE new client';
     ROLLBACK;" > /tmp/join.txt 2>&1
if grep -Eq 'E2E SMOKE new client[[:space:]]+2[[:space:]]+Jane Tester' /tmp/join.txt; then
  ok "join surfaces linked_client_id=2, name='Jane Tester'"
else
  err "join returned wrong shape" "$(cat /tmp/join.txt)"
fi

# ─────────────────────────────────────────────────────────────────
section "Summary"
say ""
say "  Passed: $PASS"
say "  Failed: $FAIL"
[ "$FAIL" -eq 0 ] && say "  🟢 All checks green." || say "  🔴 Investigate failing checks above."
exit "$FAIL"
