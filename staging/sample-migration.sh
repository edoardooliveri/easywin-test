#!/usr/bin/env bash
# ============================================================================
# sample-migration.sh
# ============================================================================
# Migrazione "sample" SQL Server → Postgres: TOP 1000 righe per tabella.
# Pensato per popolare lo schema staging in modo veloce (~10 min) così da
# poter testare il rewrite UI senza dover migrare 10M+ righe reali.
#
# La migrazione completa di produzione si farà su un VPS vero (più veloce,
# più affidabile, niente Rosetta emulation).
#
# Architettura:
#   1. Per ogni tabella nella lista:
#      a. SQL Server BCP export → /tmp/<table>.tsv (nel container)
#      b. docker cp → host /tmp
#      c. docker cp → Postgres container /tmp
#      d. psql \copy legacy.<table> FROM /tmp/<table>.tsv
#   2. Lancia transform-* per popolare anche public.*
#
# Uso:
#   bash staging/sample-migration.sh                # esegue tutto
#   bash staging/sample-migration.sh export-only    # solo BCP, no Postgres
#   bash staging/sample-migration.sh import-only    # solo COPY, file gia' presenti
#
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

# Config
MSSQL_CONTAINER="easywin-sqlserver-restore"
MSSQL_USER="sa"
MSSQL_PASS="EasyWin2026!"

PG_CONTAINER="easywin-pg-staging"
PG_USER="easywin"
PG_DB="easywin_staging"

SAMPLE_SIZE=1000
TMP_DIR="${TMPDIR:-/tmp}/easywin-sample"
mkdir -p "$TMP_DIR"

# Delimiter: TAB. Raro nei dati testuali italiani.
DELIM=$'\t'

# Colori
BLUE='\033[0;34m'; GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
hdr() { echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n${BLUE}▶${NC} $*\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; }
ok() { echo -e "  ${GREEN}✓${NC} $*"; }
err() { echo -e "  ${RED}✗${NC} $*" >&2; }
info() { echo -e "  ${YELLOW}ℹ${NC} $*"; }

# ----------------------------------------------------------------------------
# Lista tabelle: "SqlServerName:Limit"
#   Limit = 0  → tutte le righe (per reference data piccole)
#   Limit = N  → SELECT TOP N
# ----------------------------------------------------------------------------
TABLES=(
  # Reference data — prendo tutto, sono poche righe
  "Regioni:0"
  "Province:0"
  "Soa:0"
  "Criteri:0"
  "TipologiaBandi:0"
  "TipologiaGare:0"
  "Piattaforme:0"
  "TipoDatiGara:0"

  # Anagrafica
  "Stazioni:$SAMPLE_SIZE"
  "Users:0"                       # 1.7k totali, prendo tutti per testing login
  "Aziende:$SAMPLE_SIZE"
  "AziendaPersonale:$SAMPLE_SIZE"
  "AttestazioniAziende:$SAMPLE_SIZE"

  # aspnet (per auth) — tutti
  "aspnet_Users:0"
  "aspnet_Membership:0"
  "aspnet_Roles:0"
  "aspnet_UsersInRoles:0"

  # Bandi + correlate
  "Bandi:$SAMPLE_SIZE"
  "BandiProvince:$SAMPLE_SIZE"
  "BandiSoaApp:$SAMPLE_SIZE"
  "BandiSoaAlt:$SAMPLE_SIZE"
  "BandiSoaSec:$SAMPLE_SIZE"
  "BandiSoaSost:$SAMPLE_SIZE"
  "AllegatiBando:$SAMPLE_SIZE"
  "AperturaBandi:$SAMPLE_SIZE"
  "ScritturaBandi:$SAMPLE_SIZE"
  "ElaboratiProgettuali:$SAMPLE_SIZE"
  "Sopralluoghi:$SAMPLE_SIZE"

  # Esiti (gare)
  "Gare:$SAMPLE_SIZE"
  "DettaglioGara:$SAMPLE_SIZE"
  "GareProvince:$SAMPLE_SIZE"
)

# ============================================================================
# STEP 1: PREREQUISITI
# ============================================================================
step_prereq() {
  hdr "Step 1/4 — Prerequisiti"

  for c in "$MSSQL_CONTAINER" "$PG_CONTAINER"; do
    if ! docker ps --format '{{.Names}}' | grep -q "^${c}$"; then
      err "Container $c non in esecuzione. Avvia con:"
      err "  bash staging/run-local-migration.sh start-${c#easywin-}"
      exit 1
    fi
    ok "Container $c: running"
  done

  # Verifica connessione SQL Server
  if docker exec "$MSSQL_CONTAINER" /opt/mssql-tools18/bin/sqlcmd \
      -S localhost -U "$MSSQL_USER" -P "$MSSQL_PASS" -C -d Gare \
      -Q "SELECT 1" >/dev/null 2>&1; then
    ok "SQL Server: connesso a database Gare"
  else
    err "Cannot connect to SQL Server / database Gare"
    exit 1
  fi

  # Verifica connessione Postgres
  if docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -c "SELECT 1" >/dev/null 2>&1; then
    ok "Postgres: connesso a $PG_DB"
  else
    err "Cannot connect to Postgres"
    exit 1
  fi

  # Verifica esistenza schema legacy
  local n
  n=$(docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -At -c \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='legacy'" 2>/dev/null || echo 0)
  if [ "$n" -lt 50 ]; then
    err "Schema legacy ha solo $n tabelle. Esegui prima pgloader (anche se fallisce, basta che crei lo schema)."
    exit 1
  fi
  ok "Schema legacy: $n tabelle pronte"

  info "TMP dir: $TMP_DIR"
}


# ============================================================================
# STEP 2: BCP EXPORT da SQL Server
# ============================================================================
step_export() {
  hdr "Step 2/4 — BCP export da SQL Server"

  local n_total=${#TABLES[@]}
  local i=0
  for entry in "${TABLES[@]}"; do
    i=$((i+1))
    local table="${entry%:*}"
    local limit="${entry#*:}"
    local table_lower
    table_lower=$(echo "$table" | tr '[:upper:]' '[:lower:]')
    local out_file="/tmp/${table_lower}.tsv"

    # Costruisci query
    local query
    if [ "$limit" = "0" ]; then
      query="SELECT * FROM Gare.dbo.${table}"
    else
      query="SELECT TOP ${limit} * FROM Gare.dbo.${table}"
    fi

    echo -ne "  [${i}/${n_total}] ${table} ... "

    # BCP queryout con character format, TAB delimiter
    # -c = character output (no native binary)
    # -t = field terminator (TAB)
    # -u = trust server certificate (mssql-tools18 BCP 18.6+ requires this
    #      for SQL Server 2022 self-signed cert; NOT -C which is code page!)
    if docker exec "$MSSQL_CONTAINER" /opt/mssql-tools18/bin/bcp \
        "${query}" queryout "${out_file}" \
        -S localhost -U "$MSSQL_USER" -P "$MSSQL_PASS" \
        -u \
        -c \
        -t $'\t' \
        2>"${TMP_DIR}/${table_lower}.bcp.err" >/dev/null; then
      # Copia dal container al host
      docker cp "${MSSQL_CONTAINER}:${out_file}" "${TMP_DIR}/${table_lower}.tsv" 2>/dev/null
      local rows
      rows=$(wc -l < "${TMP_DIR}/${table_lower}.tsv" | tr -d ' ')
      echo -e "${GREEN}✓${NC} ${rows} righe"
    else
      echo -e "${RED}✗${NC} export fallito"
      # Mostra errore
      cat "${TMP_DIR}/${table_lower}.bcp.err" 2>/dev/null | head -5 | sed 's/^/      /'
    fi
  done
}


# ============================================================================
# STEP 3: COPY in Postgres
# ============================================================================
step_import() {
  hdr "Step 3/4 — COPY in Postgres"

  local n_total=${#TABLES[@]}
  local i=0
  for entry in "${TABLES[@]}"; do
    i=$((i+1))
    local table="${entry%:*}"
    local table_lower
    table_lower=$(echo "$table" | tr '[:upper:]' '[:lower:]')
    local local_file="${TMP_DIR}/${table_lower}.tsv"

    echo -ne "  [${i}/${n_total}] legacy.${table_lower} ... "

    if [ ! -f "$local_file" ]; then
      echo -e "${YELLOW}skip${NC} (file mancante)"
      continue
    fi

    # Copia file dal host nel container Postgres
    docker cp "$local_file" "${PG_CONTAINER}:/tmp/${table_lower}.tsv" 2>/dev/null

    # Verifica esistenza tabella in legacy
    local table_exists
    table_exists=$(docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -At -c \
      "SELECT 1 FROM information_schema.tables WHERE table_schema='legacy' AND table_name='${table_lower}'" 2>/dev/null)
    if [ "$table_exists" != "1" ]; then
      echo -e "${YELLOW}skip${NC} (tabella legacy.${table_lower} non esiste)"
      continue
    fi

    # TRUNCATE + COPY
    # FORMAT csv per gestire quoting; DELIMITER tab; NULL '' (empty = NULL)
    if docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" \
        -c "TRUNCATE legacy.${table_lower} CASCADE;" >/dev/null 2>&1 && \
       docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" \
        -c "\\copy legacy.${table_lower} FROM '/tmp/${table_lower}.tsv' WITH (FORMAT csv, DELIMITER E'\\t', NULL '', QUOTE E'\\b')" 2>&1 | tail -1 \
        | grep -qE "COPY [0-9]+"; then
      local rows
      rows=$(docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -At -c \
        "SELECT COUNT(*) FROM legacy.${table_lower}" 2>/dev/null || echo "?")
      echo -e "${GREEN}✓${NC} ${rows} righe"
    else
      # Riprova SENZA cascade truncate (forse FK problem) e con quoting più tollerante
      if docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" \
          -c "DELETE FROM legacy.${table_lower}; \\copy legacy.${table_lower} FROM '/tmp/${table_lower}.tsv' WITH (FORMAT csv, DELIMITER E'\\t', NULL '', QUOTE E'\\b')" 2>&1 | tail -3 | head -1; then
        echo -e "${YELLOW}!${NC} caricato con warning"
      else
        echo -e "${RED}✗${NC} copy fallito"
      fi
    fi
  done

  # Reset sequenze SERIAL
  info "Reset sequenze SERIAL su legacy.*..."
  docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -c "
    DO \$\$
    DECLARE r RECORD;
    BEGIN
      FOR r IN
        SELECT n.nspname, c.relname, a.attname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid=c.relnamespace
        JOIN pg_attribute a ON a.attrelid=c.oid
        WHERE n.nspname='legacy' AND c.relkind='r'
          AND a.attidentity<>'' OR pg_get_serial_sequence(format('%I.%I',n.nspname,c.relname), a.attname) IS NOT NULL
      LOOP
        BEGIN
          PERFORM setval(pg_get_serial_sequence(format('%I.%I',r.nspname,r.relname),r.attname),
                         GREATEST(1, (SELECT max(t.x) FROM (SELECT (row_to_json(x)->>r.attname)::bigint AS x FROM (SELECT * FROM information_schema.tables WHERE table_schema=r.nspname AND table_name=r.relname) x) t)));
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
      END LOOP;
    END\$\$;
  " >/dev/null 2>&1 || true
}


# ============================================================================
# STEP 4: TRANSFORM → public.*
# ============================================================================
step_transform() {
  hdr "Step 4/4 — Transform legacy → public"

  info "Eseguo transform-legacy-to-public.sql..."
  docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" \
    < "$REPO_ROOT/staging/transform-legacy-to-public.sql" 2>&1 \
    | grep -E "NOTICE|WARNING" | head -30 | sed 's/^/    /'

  info "Eseguo transform-legacy-anagrafica.sql..."
  docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" \
    < "$REPO_ROOT/staging/transform-legacy-anagrafica.sql" 2>&1 \
    | grep -E "NOTICE|WARNING" | head -30 | sed 's/^/    /'
}


# ============================================================================
# REPORT FINALE
# ============================================================================
step_report() {
  hdr "Riepilogo finale"
  docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -c "
    SELECT 'legacy.bandi'        AS tabella, COUNT(*) AS righe FROM legacy.bandi
    UNION ALL SELECT 'legacy.gare',           COUNT(*) FROM legacy.gare
    UNION ALL SELECT 'legacy.aziende',        COUNT(*) FROM legacy.aziende
    UNION ALL SELECT 'legacy.users',          COUNT(*) FROM legacy.users
    UNION ALL SELECT 'legacy.stazioni',       COUNT(*) FROM legacy.stazioni
    UNION ALL SELECT 'legacy.attestazioniaziende', COUNT(*) FROM legacy.attestazioniaziende
    UNION ALL SELECT '─── public ───', 0
    UNION ALL SELECT 'public.bandi',          COUNT(*) FROM public.bandi
    UNION ALL SELECT 'public.gare',           COUNT(*) FROM public.gare
    UNION ALL SELECT 'public.aziende',        COUNT(*) FROM public.aziende
    UNION ALL SELECT 'public.users',          COUNT(*) FROM public.users
    UNION ALL SELECT 'public.stazioni',       COUNT(*) FROM public.stazioni
    UNION ALL SELECT 'public.attestazioni',   COUNT(*) FROM public.attestazioni
    UNION ALL SELECT 'public.user_roles',     COUNT(*) FROM public.user_roles
    "
  echo
  ok "Sample migration completata."
  info "Per testare il backend con questo DB:"
  info "  DATABASE_URL=postgresql://easywin:easywin_local@localhost:5434/easywin_staging"
  info "  cd backend && npm start"
}


# ============================================================================
# MAIN
# ============================================================================
case "${1:-all}" in
  prereq)      step_prereq ;;
  export|export-only) step_prereq; step_export ;;
  import|import-only) step_prereq; step_import ;;
  transform)   step_prereq; step_transform ;;
  report)      step_report ;;
  all)
    step_prereq
    step_export
    step_import
    step_transform
    step_report
    ;;
  *)
    echo "Uso: bash $(basename "$0") [all|prereq|export|import|transform|report]"
    exit 1
    ;;
esac
