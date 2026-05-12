# Albi Fornitori — pipeline di discovery

Aggiornato: 2026-05-12.

Stato iniziale (alla data di stesura): **0 albi nel DB**, ma 217 albi
validati pronti in `data/albi_fornitori_ok_only.json` e una pipeline
ibrida (URL pattern + DuckDuckGo + Claude AI) già scritta.

Obiettivo finale: per ognuna delle ~16.729 stazioni appaltanti italiane,
sapere se esiste un **albo fornitori attivo**, con URL del form di
iscrizione, **piattaforma**, **categorie SOA accettate**, **documenti
richiesti** e **scadenze**. La pagina cliente "Albi Fornitori" mostra
questi dati e permette di richiedere il servizio di iscrizione.

---

## 1. Architettura della pipeline

```
                          ┌─────────────────────┐
                          │  Stazioni in DB     │
                          │  (~16.700 record)   │
                          └──────────┬──────────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              ▼                      ▼                      ▼
   ┌───────────────────┐  ┌────────────────────┐  ┌────────────────────┐
   │ scan-albi-        │  │ ricerca-albi-web   │  │ popola-albi-       │
   │ completo.js       │  │ (Claude AI)        │  │ fornitori.js       │
   │                   │  │                    │  │                    │
   │ URL pattern +     │  │ Fetch sito + AI    │  │ Bulk per piatta-   │
   │ DuckDuckGo + KW   │  │ extraction         │  │ forma (MePA/CONSIP)│
   └─────────┬─────────┘  └──────────┬─────────┘  └──────────┬─────────┘
             │                       │                       │
             ▼                       ▼                       ▼
   data/albi_fornitori_results.json (incrementale)         INSERT in DB
             │                       │
             ▼                       ▼
   extract-albo-details.cjs (arricchimento)
             │
             ▼
   import-albi-da-scan.js (UPSERT in DB con match fuzzy stazione)
             │
             ▼
   ┌─────────────────────┐
   │  albi_fornitori     │
   │  (tabella DB)       │
   └─────────────────────┘
             │
             ▼
   /api/albi-fornitori/* (cliente + admin)
             │
             ▼
   UI cliente "Albi Fornitori" + dashboard admin
```

Tutte le run vengono tracciate in `albi_discovery_runs` (migration 034).

---

## 2. Step operativi per popolare il DB

Assumi `DATABASE_URL`, `ANTHROPIC_API_KEY` settate nel `.env` del backend.

### Step 1 — Import "seed" dei 217 albi già validati

`data/albi_fornitori_ok_only.json` contiene 217 albi confermati (filtro
`verdetto=OK` su `Albi_Verifica_Batch1.xlsx`). Sono il punto di partenza.

```bash
# DRY-RUN: simula senza scrivere
node tools/albi/import-albi-da-scan.js \
  --file=data/albi_fornitori_ok_only.json \
  --dry-run --verbose

# REAL: scrive in DB
node tools/albi/import-albi-da-scan.js \
  --file=data/albi_fornitori_ok_only.json \
  --verbose
```

Report finale salvato in `data/import-albi-report.json` con: inseriti,
aggiornati, non trovati (match fuzzy stazione fallito), ambigui.

### Step 2 — Popolazione bulk per piattaforma nota

`popola-albi-fornitori.js` mappa automaticamente le stazioni che usano
piattaforme di e-procurement note (MePA/CONSIP, Sintel, Net4market,
TuttoGare, ecc.) a un record di albo standard. È molto efficiente:
copre potenzialmente migliaia di stazioni in un colpo.

```bash
# DRY-RUN
node backend/scripts/popola-albi-fornitori.js --dry-run

# REAL
node backend/scripts/popola-albi-fornitori.js
```

### Step 3 — Discovery web + AI per le stazioni rimanenti

`ricerca-albi-web.js` itera sulle stazioni senza albo verificato,
ordina per numero di bandi pubblicati (così le stazioni più attive
vengono coperte prima), fa fetch del sito web + DuckDuckGo + estrazione
con Claude. **Incrementale**: salta le stazioni già processate.

```bash
# Test su 10 stazioni
node backend/scripts/ricerca-albi-web.js --limit 10 --dry-run

# Produzione: 500 stazioni alla volta
node backend/scripts/ricerca-albi-web.js --limit 500

# Riprendi da un offset specifico
node backend/scripts/ricerca-albi-web.js --offset 2000 --limit 500

# Solo una stazione specifica (debug)
node backend/scripts/ricerca-albi-web.js --id 1234
```

File di progresso: `backend/scripts/ricerca-albi-progress.json` (idempotenza
locale). Log: `backend/scripts/ricerca-albi-log.txt`.

Costo stimato: ~€0.005-0.01 per stazione con Sonnet, ~€0.001 con Haiku.
Per 14.000 stazioni rimanenti: tra ~€14 (Haiku) e ~€140 (Sonnet) una tantum.

### Step 4 — Re-check periodico (opzionale)

Ogni 60 giorni rilanciare lo step 3 con flag `--recheck` (TODO) per
scoprire variazioni: nuove SOA accettate, scadenze nuove, piattaforma
cambiata. Il job rispetta un cooldown per non sovraccaricare i server.

---

## 3. Da admin UI (REST)

Endpoint disponibili sotto `/api/albi-fornitori/admin/discovery/` (JWT
admin richiesto).

| Metodo | Path | Cosa fa |
|---|---|---|
| GET  | `/status` | Ultime 20 run, summary aggregato per tipo, coverage stazioni (totali / con albo / verificati). |
| POST | `/run` | Lancia uno script in background. Body: `{tipo, limit?, offset?, from_id?, file?, dry_run?}`. `tipo` ∈ `ricerca_web` / `scan_completo` / `popola_piattaforme` / `import_scan`. |
| POST | `/runs/:id/chiudi` | Chiude manualmente una run rimasta "running" (es. crash). Body: `{success?, note?}`. |

Esempi curl:

```bash
TOKEN=...  # JWT admin

# Status corrente
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/albi-fornitori/admin/discovery/status | jq

# Avvia ricerca AI su 100 stazioni
curl -X POST http://localhost:3001/api/albi-fornitori/admin/discovery/run \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tipo":"ricerca_web","limit":100}'

# Importa il seed iniziale (217 albi pronti)
curl -X POST http://localhost:3001/api/albi-fornitori/admin/discovery/run \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tipo":"import_scan","file":"data/albi_fornitori_ok_only.json"}'
```

**Anti double-run**: il backend rifiuta `POST /run` se esiste già una run
dello stesso tipo con `success IS NULL`. Per sbloccare: `POST /runs/:id/chiudi`.

---

## 4. Tabelle DB coinvolte

- `albi_fornitori` (migration 004): tabella principale degli albi.
- `iscrizioni_albo` (migration 004): tracking iscrizioni delle aziende clienti.
- `richieste_servizio_albi` (migration 004): richieste cliente di servizio iscrizione.
- `albi_discovery_runs` (migration 034 — nuova): storico delle run + view
  aggregata `v_albi_discovery_summary` per dashboard.

---

## 5. Roadmap residua (Fase 2)

- **UI admin "Discovery Albi"** con timeline run + review queue dei record
  con `confidence` bassa (richiede aggiunta di un campo confidence in
  `albi_fornitori` — TODO migration 035).
- **Sentinella che chiude le run**: oggi le run lanciate da `POST /run`
  rimangono `success IS NULL` finché un operatore non chiama
  `POST /runs/:id/chiudi`. Va aggiunto un watcher che osserva il file di
  progresso degli script e marca la run come success/error quando il
  child process termina.
- **Scheduler automatico** stile `presidia-scheduler.js`: ogni notte
  alle 02:00 lancia `ricerca-albi-web --limit N` finché non tutte le
  stazioni sono coperte. Toggle via env `ALBI_DISCOVERY_AUTO=true`.
- **Web search nativo Anthropic** (quando disponibile in produzione)
  per sostituire DuckDuckGo HTML scraping (oggi fragile a rate limit).

---

## 6. Troubleshooting

### `import-albi-da-scan.js` ritorna "ECONNREFUSED 127.0.0.1:5432"
Postgres locale non è up. Controlla `DATABASE_URL` nel `.env` del backend.

### Molti record con `match_method=fuzzy_multi` (ambigui)
Il file JSON contiene ragioni sociali "vecchie" (es. aziende municipalizzate
ridenominate). Esamina `data/import-albi-report.json` → array `ambigui`,
correggi manualmente.

### `ricerca-albi-web.js` si interrompe per rate limit DuckDuckGo
Aumenta `DELAY_BETWEEN_REQUESTS` (default 2000 ms) in `CONFIG`. Riavvia,
riprende dal progresso salvato.

### La UI cliente "Albi Fornitori" mostra ancora 0
Verifica con `psql`:
```sql
SELECT COUNT(*) FROM albi_fornitori WHERE attivo = true;
```
Se = 0, lo step 1 di import non è ancora stato eseguito o ha riportato
solo `non_trovati` (vedi report).
