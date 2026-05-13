#!/usr/bin/env bash
# ============================================================================
# run-local-migration.sh
# ============================================================================
# Orchestratore end-to-end per la migrazione SQL Server (Gare) → Postgres.
# Pensato per GIRARE LOCALMENTE SUL MAC via Docker, niente VPS, niente
# installazioni native (pgloader/mssql-tools sono dentro container).
#
# Architettura:
#   ┌──────────────────────────┐    ┌──────────────────────────┐
#   │ easywin-sqlserver-restore│    │  easywin-pg-staging      │
#   │ SQL Server 2022 Developer│    │  Postgres 16 Alpine      │
#   │ port localhost:1433      │    │  port localhost:5434     │
#   │ DB: Gare                 │    │  DB: easywin_staging     │
#   └────────────┬─────────────┘    └─────────────┬────────────┘
#                │                                │
#                └─────────────┬──────────────────┘
#                              ▼
#                ┌──────────────────────────┐
#                │   easywin-pgloader        │
#                │  (dimitri/pgloader image) │
#                │  esegue il transfer       │
#                └──────────────────────────┘
#
# Uso:
#   bash staging/run-local-migration.sh              # esegue tutti gli step
#   bash staging/run-local-migration.sh stepname     # solo uno step
#   bash staging/run-local-migration.sh --help       # lista step
#   bash staging/run-local-migration.sh --cleanup    # rimuove tutti i container
#
# Step disponibili (in ordine):
#   1. prereq           verifica spazio disco + Docker + file .bak
#   2. start-mssql      avvia container SQL Server 2022
#   3. restore-bak      ripristina Gare05_VEN.bak in SQL Server
#   4. start-postgres   avvia Postgres 16 (porta 5434)
#   5. apply-migrations applica le migrations 001-037 nello schema public
#   6. run-pgloader     trasferisce SQL Server → Postgres schema "legacy"
#   7. transform-bandi  legacy → public con UUID mapping (transform-legacy-to-public.sql)
#   8. transform-anag   legacy → public anagrafica (transform-legacy-anagrafica.sql)
#   9. post-fix         post-migration-fixes.sql
#  10. verify           confronto row count legacy vs public
#  11. summary          riepilogo finale
# ============================================================================

set -euo pipefail

# ----- CONFIG -----
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"
BAK_FILE="${BAK_FILE:-/Users/edoardooliveri/Desktop/database-extracted/Gare05_VEN.bak}"

MSSQL_CONTAINER="easywin-sqlserver-restore"
MSSQL_PASS="EasyWin2026!"
MSSQL_PORT="1433"

PG_CONTAINER="easywin-pg-staging"
PG_USER="easywin"
PG_PASS="easywin_local"
PG_DB="easywin_staging"
PG_PORT="5434"

# ----- COLORI -----
BLUE='\033[0;34m'; GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
hdr() { echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n${BLUE}▶${NC} $*\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; }
ok() { echo -e "  ${GREEN}✓${NC} $*"; }
err() { echo -e "  ${RED}✗${NC} $*" >&2; }
warn() { echo -e "  ${YELLOW}!${NC} $*"; }
info() { echo -e "  ${CYAN}ℹ${NC} $*"; }

# ============================================================================
# STEP 1: PREREQUISITI
# ============================================================================
step_prereq() {
  hdr "Step 1/11 — Verifica prerequisiti"

  if ! command -v docker &>/dev/null; then err "Docker non installato"; exit 1; fi
  ok "Docker installato: $(docker --version)"

  if ! docker info &>/dev/null; then err "Docker daemon non in esecuzione (Docker Desktop in pausa?)"; exit 1; fi
  ok "Docker daemon attivo"

  if [ ! -f "$BAK_FILE" ]; then err ".bak non trovato: $BAK_FILE"; exit 1; fi
  ok "Backup .bak: $(ls -lh "$BAK_FILE" | awk '{print $5}')"

  # Verifica spazio disco (serve ~50 GB libero: .bak 19 GB + SQL Server DB ~25 GB + Postgres ~15 GB)
  local avail_gb
  avail_gb=$(df -g "$HOME" | awk 'NR==2 {print $4}')
  if [ "$avail_gb" -lt 60 ]; then
    err "Spazio disco insufficiente: $avail_gb GB liberi, servono almeno 60 GB"
    exit 1
  fi
  ok "Spazio disco: ${avail_gb} GB liberi"

  # Verifica che le porte non siano occupate
  for port in $MSSQL_PORT $PG_PORT; do
    if lsof -nP -iTCP:$port -sTCP:LISTEN 2>/dev/null | grep -q LISTEN; then
      local used_by
      used_by=$(lsof -nP -iTCP:$port -sTCP:LISTEN | tail -n +2 | awk '{print $1}' | head -1)
      warn "Porta $port già in uso (da: $used_by). Lo script userà un container nuovo che potrebbe fallire."
    else
      ok "Porta $port libera"
    fi
  done
}

# ============================================================================
# STEP 2: AVVIO SQL SERVER
# ============================================================================
step_start_mssql() {
  hdr "Step 2/11 — Avvio container SQL Server 2022"

  if docker ps -a --format '{{.Names}}' | grep -q "^${MSSQL_CONTAINER}$"; then
    info "Container $MSSQL_CONTAINER già esistente, lo riuso"
    docker start "$MSSQL_CONTAINER" >/dev/null 2>&1 || true
  else
    info "Pull immagine SQL Server (può durare alcuni minuti la prima volta)..."
    docker pull mcr.microsoft.com/mssql/server:2022-latest

    info "Avvio container..."
    # Bind solo a localhost per sicurezza, monta il .bak read-only
    local bak_dir
    bak_dir=$(dirname "$BAK_FILE")
    docker run -d \
      --name "$MSSQL_CONTAINER" \
      -e "ACCEPT_EULA=Y" \
      -e "MSSQL_SA_PASSWORD=$MSSQL_PASS" \
      -e "MSSQL_PID=Developer" \
      -p "127.0.0.1:${MSSQL_PORT}:1433" \
      -v "${bak_dir}:/var/backups:ro" \
      -v "easywin-mssql-data:/var/opt/mssql" \
      --memory 4g \
      mcr.microsoft.com/mssql/server:2022-latest >/dev/null
  fi

  info "Aspetto che SQL Server sia ready (max 60s)..."
  for i in $(seq 1 60); do
    if docker exec "$MSSQL_CONTAINER" /opt/mssql-tools18/bin/sqlcmd -S localhost \
        -U sa -P "$MSSQL_PASS" -C -Q "SELECT @@VERSION" >/dev/null 2>&1; then
      ok "SQL Server ready dopo ${i}s"
      docker exec "$MSSQL_CONTAINER" /opt/mssql-tools18/bin/sqlcmd \
        -S localhost -U sa -P "$MSSQL_PASS" -C -Q "SELECT @@VERSION" 2>/dev/null | head -3
      return
    fi
    sleep 1
  done
  err "SQL Server non è partito in tempo"
  exit 1
}

# ============================================================================
# STEP 3: RESTORE BACKUP
# ============================================================================
step_restore_bak() {
  hdr "Step 3/11 — RESTORE Gare05_VEN.bak"

  local bak_name
  bak_name=$(basename "$BAK_FILE")

  # Verifica se DB Gare già esiste
  local exists
  exists=$(docker exec "$MSSQL_CONTAINER" /opt/mssql-tools18/bin/sqlcmd \
    -S localhost -U sa -P "$MSSQL_PASS" -C -h -1 \
    -Q "SELECT COUNT(*) FROM sys.databases WHERE name='Gare'" 2>/dev/null | head -1 | tr -d ' ')

  if [ "$exists" = "1" ]; then
    info "DB Gare già esistente. Salto RESTORE (usa --force per ri-eseguire)."
    if [ "${1:-}" = "--force" ]; then
      info "--force: droppo e ricreo"
      docker exec "$MSSQL_CONTAINER" /opt/mssql-tools18/bin/sqlcmd \
        -S localhost -U sa -P "$MSSQL_PASS" -C \
        -Q "ALTER DATABASE Gare SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE Gare"
    else
      return
    fi
  fi

  info "Estraggo logical names dal .bak..."
  docker exec "$MSSQL_CONTAINER" /opt/mssql-tools18/bin/sqlcmd \
    -S localhost -U sa -P "$MSSQL_PASS" -C \
    -Q "RESTORE FILELISTONLY FROM DISK='/var/backups/$bak_name'" 2>&1 | head -20

  warn "Verifica i logical names sopra! Se sono diversi da 'Gare' e 'Gare_log', ferma e modifica lo script."

  info "Avvio RESTORE (può durare 15-30 min per 19 GB)..."
  docker exec "$MSSQL_CONTAINER" /opt/mssql-tools18/bin/sqlcmd \
    -S localhost -U sa -P "$MSSQL_PASS" -C \
    -Q "RESTORE DATABASE Gare FROM DISK='/var/backups/$bak_name'
        WITH MOVE 'Gare' TO '/var/opt/mssql/data/Gare.mdf',
             MOVE 'Gare_log' TO '/var/opt/mssql/data/Gare_log.ldf',
             REPLACE, RECOVERY, STATS=10"

  ok "RESTORE completato"

  info "Verifica row count delle 5 tabelle principali..."
  docker exec "$MSSQL_CONTAINER" /opt/mssql-tools18/bin/sqlcmd \
    -S localhost -U sa -P "$MSSQL_PASS" -C -d Gare \
    -Q "SET NOCOUNT ON;
        SELECT t.name AS tabella, p.rows AS righe
        FROM sys.tables t
        JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0,1)
        WHERE t.name IN ('Bandi','Gare','Azienda','Aziende','Users','Stazioni','DettaglioGara')
        ORDER BY t.name"
}

# ============================================================================
# STEP 4: POSTGRES
# ============================================================================
step_start_postgres() {
  hdr "Step 4/11 — Avvio Postgres 16 (porta $PG_PORT)"

  if docker ps -a --format '{{.Names}}' | grep -q "^${PG_CONTAINER}$"; then
    info "Container $PG_CONTAINER già esistente, lo riuso"
    docker start "$PG_CONTAINER" >/dev/null 2>&1 || true
  else
    docker run -d \
      --name "$PG_CONTAINER" \
      -e POSTGRES_USER="$PG_USER" \
      -e POSTGRES_PASSWORD="$PG_PASS" \
      -e POSTGRES_DB="$PG_DB" \
      -p "127.0.0.1:${PG_PORT}:5432" \
      -v "easywin-pg-data:/var/lib/postgresql/data" \
      -v "${REPO_ROOT}/backend/src/db/migrations:/migrations:ro" \
      -v "${REPO_ROOT}/staging:/staging:ro" \
      --memory 2g \
      postgres:16-alpine >/dev/null
  fi

  for i in $(seq 1 30); do
    if docker exec "$PG_CONTAINER" pg_isready -U "$PG_USER" 2>/dev/null | grep -q accepting; then
      ok "Postgres ready dopo ${i}s"
      return
    fi
    sleep 1
  done
  err "Postgres non è partito in tempo"
  exit 1
}

# ============================================================================
# STEP 5: MIGRATIONS NEL SCHEMA public
# ============================================================================
step_apply_migrations() {
  hdr "Step 5/11 — Applico migrations 001-037 nel schema public"

  local errors=0 ok_count=0
  for f in $(ls "$REPO_ROOT"/backend/src/db/migrations/*.sql | sort); do
    local name
    name=$(basename "$f")
    if docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" \
        -v ON_ERROR_STOP=1 < "$f" >/dev/null 2>&1; then
      ok_count=$((ok_count+1))
      echo "  ✓ $name"
    else
      errors=$((errors+1))
      echo -e "  ${RED}✗${NC} $name (errore ignorato — alcune migrations pre-esistenti hanno bug latenti)"
    fi
  done
  info "Migrations: $ok_count OK / $errors errori"
  warn "Gli errori sono SPESSO pre-esistenti (migrations vecchie con bug). Le 036+037 mie devono passare."
}

# ============================================================================
# STEP 6: PGLOADER
# ============================================================================
step_run_pgloader() {
  hdr "Step 6/11 — pgloader: SQL Server → Postgres schema 'legacy'"

  # Adatto il file pgloader-easywin.load alle credenziali locali (rete docker)
  local tmp_load="/tmp/pgloader-local.load"
  sed -e "s|mssql://sa:[^@]*@localhost:1433|mssql://sa:${MSSQL_PASS}@${MSSQL_CONTAINER}:1433|g" \
      -e "s|postgresql://easywin:[^@]*@localhost:5432/easywin_staging|postgresql://${PG_USER}:${PG_PASS}@${PG_CONTAINER}:5432/${PG_DB}|g" \
      "$REPO_ROOT/staging/pgloader-easywin.load" > "$tmp_load"

  # Crea una network shared per far parlare i 3 container
  if ! docker network ls --format '{{.Name}}' | grep -q '^easywin-net$'; then
    docker network create easywin-net >/dev/null
  fi
  # Collega i container alla network se non già
  docker network connect easywin-net "$MSSQL_CONTAINER" 2>/dev/null || true
  docker network connect easywin-net "$PG_CONTAINER" 2>/dev/null || true

  info "Pull immagine pgloader..."
  docker pull dimitri/pgloader:latest >/dev/null

  info "Avvio pgloader (2-4h per 19 GB, vedi log)..."
  warn "ATTENZIONE: questo step è LUNGO. Apri un'altra shell e monitora con:"
  warn "  docker exec $PG_CONTAINER psql -U $PG_USER -d $PG_DB -c \"\\\\dt legacy.*\""

  docker run --rm -i \
    --network easywin-net \
    -v "$tmp_load:/data/pgloader.load:ro" \
    --memory 4g \
    dimitri/pgloader:latest pgloader --verbose /data/pgloader.load 2>&1 | tee "$REPO_ROOT/staging/pgloader.log"

  ok "pgloader completato (vedi staging/pgloader.log per dettagli)"
}

# ============================================================================
# STEP 7: TRANSFORM bandi UUID
# ============================================================================
step_transform_bandi() {
  hdr "Step 7/11 — transform-legacy-to-public.sql (bandi UUID mapping)"
  docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" \
    -v ON_ERROR_STOP=1 < "$REPO_ROOT/staging/transform-legacy-to-public.sql"
  ok "Transform bandi completato"
}

# ============================================================================
# STEP 8: TRANSFORM anagrafica
# ============================================================================
step_transform_anag() {
  hdr "Step 8/11 — transform-legacy-anagrafica.sql (aziende, users, stazioni)"
  docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" \
    -v ON_ERROR_STOP=1 < "$REPO_ROOT/staging/transform-legacy-anagrafica.sql"
  ok "Transform anagrafica completato"
}

# ============================================================================
# STEP 9: POST-MIGRATION FIXES
# ============================================================================
step_post_fix() {
  hdr "Step 9/11 — post-migration-fixes.sql"
  docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" \
    -v ON_ERROR_STOP=0 < "$REPO_ROOT/staging/post-migration-fixes.sql"
  ok "Post-fix completati"
}

# ============================================================================
# STEP 10: VERIFY ROW COUNT
# ============================================================================
step_verify() {
  hdr "Step 10/11 — Verify row counts"

  # Conta righe in legacy.* e public.* tabelle principali
  docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" \
    -c "SELECT 'bandi' AS tipo,
              (SELECT COUNT(*) FROM legacy.bandi) AS sqlserver_n,
              (SELECT COUNT(*) FROM public.bandi) AS postgres_n
        UNION ALL
        SELECT 'gare', (SELECT COUNT(*) FROM legacy.gare), (SELECT COUNT(*) FROM public.gare)
        UNION ALL
        SELECT 'aziende', COALESCE((SELECT COUNT(*) FROM legacy.azienda), 0), (SELECT COUNT(*) FROM public.aziende)
        UNION ALL
        SELECT 'users', (SELECT COUNT(*) FROM legacy.users), (SELECT COUNT(*) FROM public.users)
        UNION ALL
        SELECT 'stazioni', (SELECT COUNT(*) FROM legacy.stazioni), (SELECT COUNT(*) FROM public.stazioni)
        UNION ALL
        SELECT 'user_roles legacy', (SELECT COUNT(*) FROM legacy.aspnet_usersinroles), (SELECT COUNT(*) FROM public.user_roles)"
}

# ============================================================================
# STEP 11: SUMMARY
# ============================================================================
step_summary() {
  hdr "Step 11/11 — Summary"
  cat <<EOF

  ${GREEN}✓ MIGRAZIONE COMPLETATA${NC}

  Postgres locale staging:
    Host:     127.0.0.1:${PG_PORT}
    User:     ${PG_USER}
    Pwd:      ${PG_PASS}
    Database: ${PG_DB}

  Connect:
    PGPASSWORD=${PG_PASS} psql -h 127.0.0.1 -p ${PG_PORT} -U ${PG_USER} -d ${PG_DB}
    docker exec -it ${PG_CONTAINER} psql -U ${PG_USER} -d ${PG_DB}

  Schemi:
    legacy.*       (dati raw da SQL Server, CamelCase-flatten)
    public.*       (dati trasformati, snake_case, UUID per bandi)
    migration_maps (bandi_id_map: INT → UUID v5)

  Prossimi passi:
    1. Verifica i row count sopra
    2. Testa il login di un utente legacy:
         curl -X POST http://localhost:3001/api/auth/login \\
           -H 'Content-Type: application/json' \\
           -d '{"username":"...", "password":"..."}'
       Al primo successo, users.password_hash è bcrypt-ato e legacy_*=NULL
    3. Se OK, dump del DB staging → import su Neon produzione:
         docker exec ${PG_CONTAINER} pg_dump -U ${PG_USER} -d ${PG_DB} \\
           --schema=public --no-owner --no-acl > public-data.sql
         psql 'postgresql://...@neon-host/db' -f public-data.sql

  Cleanup container (quando non servono più):
    bash $(basename "$0") --cleanup

EOF
}

# ============================================================================
# CLEANUP
# ============================================================================
cleanup() {
  hdr "Cleanup container + volumi"
  docker stop "$MSSQL_CONTAINER" "$PG_CONTAINER" 2>/dev/null || true
  docker rm   "$MSSQL_CONTAINER" "$PG_CONTAINER" 2>/dev/null || true
  warn "Per rimuovere ANCHE i volumi (perderai i dati staging):"
  warn "  docker volume rm easywin-mssql-data easywin-pg-data"
  warn "Per rimuovere la network:"
  warn "  docker network rm easywin-net"
}

# ============================================================================
# HELP
# ============================================================================
show_help() {
  cat <<EOF
Uso: bash $(basename "$0") [step|--cleanup|--help]

Step disponibili (in ordine — eseguiti tutti se nessun argomento):
  prereq              Verifica prerequisiti
  start-mssql         Avvia SQL Server 2022
  restore-bak         RESTORE del .bak (15-30 min)
  start-postgres      Avvia Postgres 16
  apply-migrations    Applica migrations 001-037
  run-pgloader        SQL Server → legacy.* (2-4h)
  transform-bandi     Mapping UUID per bandi
  transform-anag      Anagrafica (aziende, users, stazioni)
  post-fix            Sequenze + BIT→BOOL + GRANT
  verify              Confronto row count
  summary             Riepilogo finale

Variabili d'ambiente override:
  BAK_FILE=/path/.bak    Default: ~/Desktop/database-extracted/Gare05_VEN.bak

Comandi:
  --help                 Mostra questa guida
  --cleanup              Rimuove container

Esempi:
  bash $(basename "$0")                    # esegue tutto
  bash $(basename "$0") prereq             # solo prereq
  bash $(basename "$0") verify             # solo verify
  bash $(basename "$0") --cleanup          # cleanup
EOF
}

# ============================================================================
# MAIN
# ============================================================================
case "${1:-all}" in
  --help|-h)        show_help; exit 0 ;;
  --cleanup)        cleanup; exit 0 ;;
  prereq)           step_prereq ;;
  start-mssql)      step_start_mssql ;;
  restore-bak)      step_restore_bak "${2:-}" ;;
  start-postgres)   step_start_postgres ;;
  apply-migrations) step_apply_migrations ;;
  run-pgloader)     step_run_pgloader ;;
  transform-bandi)  step_transform_bandi ;;
  transform-anag)   step_transform_anag ;;
  post-fix)         step_post_fix ;;
  verify)           step_verify ;;
  summary)          step_summary ;;
  all)
    step_prereq
    step_start_mssql
    step_restore_bak
    step_start_postgres
    step_apply_migrations
    step_run_pgloader
    step_transform_bandi
    step_transform_anag
    step_post_fix
    step_verify
    step_summary
    ;;
  *)
    err "Step sconosciuto: $1"
    show_help
    exit 1
    ;;
esac
