#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# scripts/smoke.sh — 19-endpoint baseline smoke test
#
# Baseline attesa:
#   Con JWT admin:  13/19 PASS (endpoint 1-4,6-10 + 16-19 → 200/201/204)
#   Senza JWT:       4/19 PASS (endpoint 1,2,9,10 → 200)
#
# 6 FAIL noti pre-esistenti (non regressioni):
#   #5  /api/admin/sistema/info   → 500  (tabella errors)
#   #11 /api/clienti/profilo      → 500  (colonne mancanti)
#   #12 /api/esiti/recenti        → 500  ("recenti" come integer)
#   #13 /api/bandi/recenti        → 500  ("recenti" come uuid)
#   #14 /api/presidia/stato       → 404  (route mancante)
#   #15 /api/pubblico/stats       → 404  (route mancante)
#
# Uso:
#   bash scripts/smoke.sh                                     # senza JWT (4/19)
#   SMOKE_ADMIN_PASSWORD=xxx bash scripts/smoke.sh             # con JWT (13/19)
#   SMOKE_ADMIN_EMAIL=user@x.it SMOKE_ADMIN_PASSWORD=xxx bash scripts/smoke.sh
#   SMOKE_BASE_URL=http://localhost:3000 bash scripts/smoke.sh
# ──────────────────────────────────────────────────────────────
set -euo pipefail

BASE="${SMOKE_BASE_URL:-http://localhost:3001}"
ADMIN_USER="${SMOKE_ADMIN_EMAIL:-admin@easywin.it}"
ADMIN_PASS="${SMOKE_ADMIN_PASSWORD:-}"

PASS_COUNT=0
FAIL_COUNT=0
KNOWN_FAIL=0

# ── Step 1: Login ────────────────────────────────────────────
JWT=""
if [ -n "$ADMIN_PASS" ]; then
  LOGIN_BODY="{\"username\":\"${ADMIN_USER}\",\"password\":\"${ADMIN_PASS}\"}"
  LOGIN_RESP=$(curl -sf -m 10 -X POST "$BASE/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d "$LOGIN_BODY" 2>/dev/null) || LOGIN_RESP=""

  if [ -n "$LOGIN_RESP" ]; then
    # Extract token — try jq first, fallback to grep
    if command -v jq &>/dev/null; then
      JWT=$(echo "$LOGIN_RESP" | jq -r '.token // empty' 2>/dev/null) || JWT=""
    else
      JWT=$(echo "$LOGIN_RESP" | grep -o '"token":"[^"]*"' | head -1 | cut -d'"' -f4) || JWT=""
    fi
  fi

  if [ -n "$JWT" ]; then
    echo "LOGIN  OK — JWT ottenuto per $ADMIN_USER"
    EXPECTED_BASELINE=13
  else
    echo "LOGIN  FAIL — proseguo senza JWT (baseline ridotta)"
    EXPECTED_BASELINE=4
  fi
else
  echo "INFO   SMOKE_ADMIN_PASSWORD non impostata — solo endpoint pubblici"
  echo "       Per baseline completa (9/15):"
  echo "       SMOKE_ADMIN_PASSWORD=xxx bash scripts/smoke.sh"
  EXPECTED_BASELINE=4
fi

echo ""
printf "%-3s  %-45s  %-4s  %-6s\n" "#" "Endpoint" "Code" "Status"
printf "%s\n" "--------------------------------------------------------------"

# ── Step 2: Check endpoint ───────────────────────────────────
# Args: num url need_auth known_fail_marker
check() {
  local num="$1" path="$2" need_auth="${3:-}" known="${4:-}"
  local code label

  if [ "$need_auth" = "auth" ] && [ -n "$JWT" ]; then
    code=$(curl -s -o /dev/null -w "%{http_code}" -m 10 \
      -H "Authorization: Bearer $JWT" "$BASE$path" 2>/dev/null) || code="000"
  else
    code=$(curl -s -o /dev/null -w "%{http_code}" -m 10 \
      "$BASE$path" 2>/dev/null) || code="000"
  fi

  if [ "$code" = "200" ]; then
    label="PASS"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    if [ -n "$known" ]; then
      label="FAIL $known"
      KNOWN_FAIL=$((KNOWN_FAIL + 1))
    else
      label="FAIL"
    fi
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi

  printf "%-3s  %-45s  %-4s  %-6s\n" "$num" "GET $path" "$code" "$label"
}

# ── Endpoint pubblici ────────────────────────────────────────
check 1  "/api/bandi?page=1&limit=2"
check 2  "/api/esiti?page=1&limit=2"

# ── Endpoint admin (JWT required) ────────────────────────────
check 3  "/api/admin/dashboard/summary"       auth
check 4  "/api/admin/dashboard/stats"         auth
check 5  "/api/admin/sistema/info"            auth  "*"
check 6  "/api/admin/sistema/tasks"           auth
check 7  "/api/admin/utenti?page=1&limit=2"   auth
check 8  "/api/admin/newsletter/storico"      auth

# ── Endpoint pubblici (cont.) ────────────────────────────────
check 9  "/api/lookups/regioni"
check 10 "/api/ricerca-doppia?q=test"

# ── Endpoint clienti (JWT required) ──────────────────────────
check 11 "/api/clienti/profilo"               auth  "*"

# ── Endpoint con FAIL noti ───────────────────────────────────
check 12 "/api/esiti/recenti"                 ""    "*"
check 13 "/api/bandi/recenti"                 ""    "*"
check 14 "/api/presidia/stato"                ""    "*"
check 15 "/api/pubblico/stats"                ""    "*"

# ── Scorporabili CRUD (JWT required) ──────────────────────────
TOTAL=19

if [ -n "$JWT" ]; then
  # Get first bando id for testing
  TEST_BANDO_ID=$(curl -sf -m 10 -H "Authorization: Bearer $JWT" \
    "$BASE/api/bandi?page=1&limit=1" 2>/dev/null \
    | jq -r '.data[0].id // empty' 2>/dev/null) || TEST_BANDO_ID=""

  if [ -n "$TEST_BANDO_ID" ]; then
    # 16: GET scorporabili (expect 200)
    check 16 "/api/bandi/$TEST_BANDO_ID/scorporabili" auth

    # 17: POST scorporabile
    # Need a valid SOA id — get from soa lookup
    FIRST_SOA=$(curl -sf -m 10 "$BASE/api/lookups/soa" 2>/dev/null \
      | jq -r '.[0].id // empty' 2>/dev/null) || FIRST_SOA=""

    if [ -n "$FIRST_SOA" ]; then
      POST_RESP=$(curl -sf -m 10 -X POST "$BASE/api/bandi/$TEST_BANDO_ID/scorporabili" \
        -H "Authorization: Bearer $JWT" \
        -H "Content-Type: application/json" \
        -d "{\"id_soa\":$FIRST_SOA,\"soa_val\":3,\"importo\":50000}" 2>/dev/null) || POST_RESP=""
      SCORP_ID=$(echo "$POST_RESP" | jq -r '.id // empty' 2>/dev/null) || SCORP_ID=""

      if [ -n "$SCORP_ID" ]; then
        printf "%-3s  %-45s  %-4s  %-6s\n" "17" "POST scorporabile (id=$SCORP_ID)" "201" "PASS"
        PASS_COUNT=$((PASS_COUNT + 1))

        # 18: PUT scorporabile
        PUT_CODE=$(curl -s -o /dev/null -w "%{http_code}" -m 10 -X PUT \
          "$BASE/api/bandi/$TEST_BANDO_ID/scorporabili/$SCORP_ID" \
          -H "Authorization: Bearer $JWT" \
          -H "Content-Type: application/json" \
          -d '{"importo":75000,"subappaltabile":true,"percentuale_subappalto":30}' 2>/dev/null) || PUT_CODE="000"
        if [ "$PUT_CODE" = "200" ]; then
          printf "%-3s  %-45s  %-4s  %-6s\n" "18" "PUT scorporabile $SCORP_ID" "$PUT_CODE" "PASS"
          PASS_COUNT=$((PASS_COUNT + 1))
        else
          printf "%-3s  %-45s  %-4s  %-6s\n" "18" "PUT scorporabile $SCORP_ID" "$PUT_CODE" "FAIL"
          FAIL_COUNT=$((FAIL_COUNT + 1))
        fi

        # 19: DELETE scorporabile
        DEL_CODE=$(curl -s -o /dev/null -w "%{http_code}" -m 10 -X DELETE \
          "$BASE/api/bandi/$TEST_BANDO_ID/scorporabili/$SCORP_ID" \
          -H "Authorization: Bearer $JWT" 2>/dev/null) || DEL_CODE="000"
        if [ "$DEL_CODE" = "200" ] || [ "$DEL_CODE" = "204" ]; then
          printf "%-3s  %-45s  %-4s  %-6s\n" "19" "DELETE scorporabile $SCORP_ID" "$DEL_CODE" "PASS"
          PASS_COUNT=$((PASS_COUNT + 1))
        else
          printf "%-3s  %-45s  %-4s  %-6s\n" "19" "DELETE scorporabile $SCORP_ID" "$DEL_CODE" "FAIL"
          FAIL_COUNT=$((FAIL_COUNT + 1))
        fi
      else
        printf "%-3s  %-45s  %-4s  %-6s\n" "17" "POST scorporabile" "ERR" "FAIL"
        FAIL_COUNT=$((FAIL_COUNT + 1))
        printf "%-3s  %-45s  %-4s  %-6s\n" "18" "PUT scorporabile (skip)" "---" "FAIL"
        FAIL_COUNT=$((FAIL_COUNT + 1))
        printf "%-3s  %-45s  %-4s  %-6s\n" "19" "DELETE scorporabile (skip)" "---" "FAIL"
        FAIL_COUNT=$((FAIL_COUNT + 1))
      fi
    else
      printf "%-3s  %-45s  %-4s  %-6s\n" "17" "POST scorp (no SOA lookup)" "---" "FAIL"
      FAIL_COUNT=$((FAIL_COUNT + 1))
      printf "%-3s  %-45s  %-4s  %-6s\n" "18" "PUT scorp (skip)" "---" "FAIL"
      FAIL_COUNT=$((FAIL_COUNT + 1))
      printf "%-3s  %-45s  %-4s  %-6s\n" "19" "DELETE scorp (skip)" "---" "FAIL"
      FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
  else
    printf "%-3s  %-45s  %-4s  %-6s\n" "16" "GET scorp (no test bando)" "---" "FAIL"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    printf "%-3s  %-45s  %-4s  %-6s\n" "17" "POST scorp (skip)" "---" "FAIL"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    printf "%-3s  %-45s  %-4s  %-6s\n" "18" "PUT scorp (skip)" "---" "FAIL"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    printf "%-3s  %-45s  %-4s  %-6s\n" "19" "DELETE scorp (skip)" "---" "FAIL"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
else
  printf "%-3s  %-45s  %-4s  %-6s\n" "16" "GET scorporabili (no JWT)" "---" "SKIP"
  printf "%-3s  %-45s  %-4s  %-6s\n" "17" "POST scorporabile (no JWT)" "---" "SKIP"
  printf "%-3s  %-45s  %-4s  %-6s\n" "18" "PUT scorporabile (no JWT)" "---" "SKIP"
  printf "%-3s  %-45s  %-4s  %-6s\n" "19" "DELETE scorporabile (no JWT)" "---" "SKIP"
fi

# ── Risultati ────────────────────────────────────────────────
echo ""
echo "--------------------------------------------------------------"
echo "Pass (200): $PASS_COUNT / $TOTAL | Fail: $FAIL_COUNT (di cui $KNOWN_FAIL noti *)"
echo "Baseline attesa: $EXPECTED_BASELINE / $TOTAL"

DELTA=$((PASS_COUNT - EXPECTED_BASELINE))
if [ "$DELTA" -eq 0 ]; then
  echo "Delta: 0 — OK"
  exit 0
elif [ "$DELTA" -gt 0 ]; then
  echo "Delta: +$DELTA (miglioramento rispetto a baseline)"
  exit 0
else
  echo "Delta: $DELTA — REGRESSIONE"
  exit 1
fi
