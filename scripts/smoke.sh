#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# scripts/smoke.sh — 15-endpoint baseline smoke test
#
# Baseline attesa:
#   Con JWT admin:  9/15 PASS (endpoint 1-4,6-10 → 200)
#   Senza JWT:      4/15 PASS (endpoint 1,2,9,10 → 200)
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
#   bash scripts/smoke.sh                                     # senza JWT (4/15)
#   SMOKE_ADMIN_PASSWORD=xxx bash scripts/smoke.sh             # con JWT (9/15)
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
    EXPECTED_BASELINE=9
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

# ── Risultati ────────────────────────────────────────────────
echo ""
echo "--------------------------------------------------------------"
echo "Pass (200): $PASS_COUNT / 15 | Fail: $FAIL_COUNT (di cui $KNOWN_FAIL noti *)"
echo "Baseline attesa: $EXPECTED_BASELINE / 15"

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
