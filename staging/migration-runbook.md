# Runbook Migrazione DB — SQL Server → Postgres

**Sorgente:** `Gare05_VEN-Ridotto.bak` (18GB, SQL Server)
**Destinazione:** Postgres 16 su VPS Aruba, database `easywin_staging`
**Tool primario:** pgloader (v3.6+) in Docker
**Tool intermedio:** SQL Server 2022 Developer Edition in Docker (gratis, non richiede licenza)

---

## Pre-requisiti

- [ ] VPS Aruba già configurato (vedi `PIANO_STAGING.md` §4)
- [ ] Docker installato sul VPS
- [ ] Postgres 16 installato e DB `easywin_staging` creato (vuoto)
- [ ] Spazio disco libero: almeno **80GB** sul VPS durante la migrazione (il `.bak` 18GB + il DB SQL Server ripristinato ~25GB + il DB Postgres popolato ~15GB + overhead)
- [ ] File `Gare05_VEN-Ridotto.rar` o `.bak` sul tuo Mac

---

## Fase A — Upload del .bak al VPS

### A.1 Dal tuo Mac
```bash
# Usa il .rar (1.6GB) — molto più veloce
scp ~/Downloads/Gare05_VEN-Ridotto.rar easywin@<IP-VPS>:/tmp/

# Tempo: ~30 minuti su connessione casalinga 50Mbps up
```

### A.2 Sul VPS — decompressione
```bash
sudo mkdir -p /var/backups/sqlserver
sudo chown easywin:easywin /var/backups/sqlserver
cd /var/backups/sqlserver
unrar x /tmp/Gare05_VEN-Ridotto.rar
# Risultato: Gare05_VEN-Ridotto.bak (18GB)
rm /tmp/Gare05_VEN-Ridotto.rar
```

Verifica:
```bash
ls -lh /var/backups/sqlserver/
# Devi vedere il .bak da ~18GB
```

---

## Fase B — SQL Server in Docker

### B.1 Avvia container
```bash
# Il file .bak deve essere accessibile al container
docker run -d \
  --name sqlserver-restore \
  -e "ACCEPT_EULA=Y" \
  -e "MSSQL_SA_PASSWORD=EasyWin2026!" \
  -e "MSSQL_PID=Developer" \
  -p 1433:127.0.0.1:1433 \
  -v /var/backups/sqlserver:/var/backups:ro \
  -v sqlserver-data:/var/opt/mssql \
  --memory 6g \
  mcr.microsoft.com/mssql/server:2022-latest

# Attendi ~30 secondi che parta
sleep 30
docker logs sqlserver-restore | tail -20
# Deve dire "SQL Server is now ready for client connections"
```

### B.2 Installa client mssql-tools nel container
```bash
docker exec -it sqlserver-restore bash
# Dentro il container:
apt-get update && apt-get install -y curl gnupg
curl https://packages.microsoft.com/keys/microsoft.asc | apt-key add -
curl https://packages.microsoft.com/config/ubuntu/22.04/prod.list > /etc/apt/sources.list.d/mssql-release.list
apt-get update
ACCEPT_EULA=Y apt-get install -y mssql-tools unixodbc-dev
export PATH="$PATH:/opt/mssql-tools/bin"
exit
```

### B.3 RESTORE del .bak
```bash
# Dall'host
docker exec -it sqlserver-restore /opt/mssql-tools/bin/sqlcmd \
  -S localhost -U sa -P 'EasyWin2026!' \
  -Q "RESTORE FILELISTONLY FROM DISK = '/var/backups/Gare05_VEN-Ridotto.bak'"
```
Questo ti mostra i **logical names** dei file dati e log — te li serve per il RESTORE. Tipicamente sono `Gare` (dati) e `Gare_log` (log). Segnateli.

```bash
# Esegui il RESTORE (sostituisci i logical names se diversi)
docker exec -it sqlserver-restore /opt/mssql-tools/bin/sqlcmd \
  -S localhost -U sa -P 'EasyWin2026!' \
  -Q "RESTORE DATABASE Gare FROM DISK = '/var/backups/Gare05_VEN-Ridotto.bak' WITH \
      MOVE 'Gare' TO '/var/opt/mssql/data/Gare.mdf', \
      MOVE 'Gare_log' TO '/var/opt/mssql/data/Gare_log.ldf', \
      REPLACE, RECOVERY"
```

Il restore di 18GB impiega 15-30 minuti. Verifica:
```bash
docker exec -it sqlserver-restore /opt/mssql-tools/bin/sqlcmd \
  -S localhost -U sa -P 'EasyWin2026!' \
  -Q "SELECT name FROM sys.databases"
# Deve elencare: master, tempdb, model, msdb, Gare
```

### B.4 Sanity check
```bash
docker exec -it sqlserver-restore /opt/mssql-tools/bin/sqlcmd \
  -S localhost -U sa -P 'EasyWin2026!' -d Gare \
  -Q "SELECT TOP 20 name FROM sys.tables ORDER BY name"
```
Dovresti vedere nomi tipo `Bandi`, `Gare`, `Azienda`, `DettaglioGara`, ecc.

```bash
# Row count delle tabelle principali
docker exec -it sqlserver-restore /opt/mssql-tools/bin/sqlcmd \
  -S localhost -U sa -P 'EasyWin2026!' -d Gare \
  -Q "SELECT t.name, p.rows FROM sys.tables t
      JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0,1)
      ORDER BY p.rows DESC"
```
**Salva questo output in un file**: `baseline_rowcounts_sqlserver.txt` (ci servirà per la verifica).

---

## Fase C — pgloader

### C.1 Installa pgloader
pgloader richiede SBCL. Installa su Ubuntu:
```bash
sudo apt install -y pgloader
# Versione: pgloader --version (dev 3.6.3+ va bene)
```

Se la versione apt è troppo vecchia (<3.6), usa Docker:
```bash
# Alternativa Docker
docker pull dimitri/pgloader:latest
```

### C.2 Copia il config
```bash
cd /home/easywin
mkdir -p migration && cd migration
# Copia qui pgloader-easywin.load dal repo o dal tuo workspace
# Contenuto nel file pgloader-easywin.load fornito
```

### C.3 Adatta il config
Apri `pgloader-easywin.load` e verifica/modifica:
- `FROM mssql://sa:EasyWin2026!@localhost/Gare` — credenziali SQL Server
- `INTO postgresql://easywin:<password>@localhost/easywin_staging` — credenziali Postgres

### C.4 Lancia migrazione
```bash
# Screen o tmux così se cade la SSH non si interrompe
tmux new -s migration

pgloader --verbose pgloader-easywin.load 2>&1 | tee pgloader.log
```

Durata: **2-4 ore** per 20GB (dipende dalla CPU del VPS e dal numero di indici).
Durante l'esecuzione, in un'altra sessione SSH puoi monitorare:
```bash
# Progress sul DB di destinazione
watch -n 10 'sudo -u postgres psql easywin_staging -c "
  SELECT schemaname, tablename, n_live_tup as rows
  FROM pg_stat_user_tables
  ORDER BY n_live_tup DESC LIMIT 10"'
```

### C.5 Leggi i warning
A fine corsa pgloader stampa un riepilogo:
- **Errors**: 0 = bene, >0 = alcune tabelle non sono migrate, leggi il log
- **Read/Written**: deve combaciare (se SQL Server aveva 1M righe in Bandi, Postgres deve avere 1M righe in bandi)
- **Heap Memory**: per monitoring

Salva `pgloader.log` per riferimento.

---

## Fase D — Verifica

Vedi `verify-migration.sh`. Esegui:
```bash
cd /home/easywin/migration
chmod +x verify-migration.sh
./verify-migration.sh > verify.txt
less verify.txt
```

Controlla:
- Row count match per ogni tabella
- Valori min/max di date/id combaciano
- Alcune query sample (es. `SELECT COUNT(*) FROM bandi WHERE data_pubblicazione > '2025-01-01'`)

Se qualcosa non torna: apri un problema e non proseguire.

---

## Fase E — Post-migration fixes

⚠️ **IMPORTANTE** — Workflow aggiornato 2026-05-13.

Dopo pgloader **i dati sono nello schema `legacy.*`**, NON in `public.*`. Lo schema
`public` contiene già la struttura modernizzata creata dalle migrations 001-036
del nuovo sito (`bandi.id` UUID, snake_case, FK migliorate). Servono **2 script
in sequenza**:

### E.1 — Trasformazione `legacy` → `public` (mapping INT→UUID)

```bash
sudo -u postgres psql easywin_staging -f /home/easywin/migration/transform-legacy-to-public.sql
```

Cosa fa:
- Crea `migration_maps.bandi_id_map(legacy_id INT, new_id UUID)` con UUID v5
  **deterministici** (rilancia la migrazione → stesso UUID, idempotente)
- `public.bandi` ← `legacy.bandi` con UUID dal mapping
- 20+ tabelle dipendenti (`bandi_province`, `allegati_bando`, `aperture`,
  `scritture`, `elaborati`, `sopralluoghi`, `bandi_soa_*`, `gare` esiti, ecc.)
  con FK tradotte da INT → UUID
- VACUUM ANALYZE + verifica row count finale con NOTICE

### E.2 — Post-migration fixes generici

```bash
sudo -u postgres psql easywin_staging -f /home/easywin/migration/post-migration-fixes.sql
```

Cosa fa:
- Sequenze (SERIAL) allineate ai valori MAX degli id
- Collation case-insensitive dove serve
- Alcuni tipi BIT → BOOLEAN che pgloader potrebbe aver lasciato come INT

---

## Fase F — Cleanup

Quando la migrazione è validata:
```bash
# Stop container SQL Server (conserva il volume per emergenze 7 giorni)
docker stop sqlserver-restore

# Dopo 7 giorni se tutto va bene, cancella anche volume + file
docker rm sqlserver-restore
docker volume rm sqlserver-data
rm /var/backups/sqlserver/Gare05_VEN-Ridotto.bak
# Recuperi ~45GB di disco
```

---

## Problemi frequenti

**"pgloader: mssql connection failed"**
- Il container SQL Server è up? `docker ps`
- La porta 1433 è esposta? Il config pgloader punta a `localhost` e il container è mappato `-p 1433:127.0.0.1:1433`

**"out of memory" durante pgloader**
- Aumenta swap: `sudo fallocate -l 4G /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile`
- Riduci `batch size` in `pgloader-easywin.load`

**"violates foreign key constraint"**
- Le FK di Postgres sono state create prima di popolare le tabelle
- Usa `WITH data only` su una seconda passata, o disabilita le FK durante il load (default pgloader: crea FK alla fine, non dovrebbe succedere)

**Una tabella non è migrata**
- Controlla `pgloader.log` per l'errore specifico
- Probabilmente è un tipo non mappato — aggiungi CAST nel config

**Row count SQL Server > Postgres**
- pgloader mostra `read=X, written=X, errs=Y` — se errs>0, dati persi
- Leggi le righe specifiche che hanno fallito nel log e valuta se recuperarle manualmente
