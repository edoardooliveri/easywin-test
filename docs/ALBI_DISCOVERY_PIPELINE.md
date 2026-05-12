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
   │ scan-albi-        │  │ Cowork / claude.ai │  │ popola-albi-       │
   │ completo.js       │  │ (web search ON)    │  │ fornitori.js       │
   │ (NO AI)           │  │                    │  │ (NO AI)            │
   │ URL pattern +     │  │ Discovery AI a     │  │ Bulk per piatta-   │
   │ DuckDuckGo + KW   │  │ costo 0 via chat   │  │ forma (MePA/CONSIP)│
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

NB: nessuno degli script eseguiti sul server consuma più la
`ANTHROPIC_API_KEY` per la discovery degli albi. Il vecchio
`backend/scripts/ricerca-albi-web.js` è stato rimosso. La parte AI
viene fatta interattivamente in claude.ai/Cowork (piano incluso, costo
zero) e i risultati JSON vengono mergiati nel cumulativo in locale,
poi importati nel DB dallo script `import-albi-da-scan.js`.

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

### Step 3 — Discovery AI via Cowork / claude.ai (costo zero)

La discovery AI non gira più sul server (`ricerca-albi-web.js`
rimosso: consumava `ANTHROPIC_API_KEY` di produzione). Si fa
interattivamente in chat claude.ai (Pro/Team) o Cowork: incluso nel
piano, costo €0 di API.

Workflow per ogni batch di 50 stazioni:

```bash
# 1) Estrai 50 stazioni non ancora processate, copia nella clipboard (macOS)
node scripts/genera-batch-albi.js --batch 1 --size 50 | pbcopy

# 2) Apri https://claude.ai → nuova chat → modello Sonnet 4.5 → web search ON
#    Copia il prompt da prompts/COWORK_ALBI_DISCOVERY.md (tutto il blocco
#    fra le triple-backtick) → incolla → vai a capo → incolla la lista
#    (è già nella clipboard).
#    Claude restituirà un JSON conforme allo schema.

# 3) Salva la risposta JSON in data/cowork-batches/batch-001-out.json e applica:
node scripts/applica-batch-albi.js --in data/cowork-batches/batch-001-out.json

# 4) Ripeti con --batch 2, 3, ... il file _processed.json evita duplicati.
```

Quando hai accumulato abbastanza batch (es. tutte le ~14.000 stazioni
restanti) lancia lo Step 1 sopra (`import-albi-da-scan.js`) puntando al
file cumulativo `data/albi_fornitori_results.json` per popolare il DB.

Vedi `prompts/COWORK_ALBI_DISCOVERY.md` per il prompt completo + regole
anti-allucinazione + esempi di output (alta/media/bassa confidence).

### Step 4 — Re-check periodico (opzionale)

Ogni 60 giorni rifare lo Step 3 (Cowork) per le stazioni con
`albi_fornitori.ultimo_aggiornamento < NOW() - 60 days`. Lo script
`genera-batch-albi.js` accetta in futuro un flag `--recheck` (TODO)
che pesca da quel filtro invece che dalle stazioni mai processate.

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

# Avvia bulk piattaforme (MePA/CONSIP/Sintel ecc.)
curl -X POST http://localhost:3001/api/albi-fornitori/admin/discovery/run \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tipo":"popola_piattaforme"}'

# Importa il seed iniziale (217 albi pronti)
curl -X POST http://localhost:3001/api/albi-fornitori/admin/discovery/run \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tipo":"import_scan","file":"data/albi_fornitori_ok_only.json"}'
```

NB: il tipo `ricerca_web` non è più disponibile (ritorna 400). La
discovery AI passa per Cowork/claude.ai — vedi Step 3.

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
  alle 02:00 lancia `popola_piattaforme` (no AI) per riconciliare
  eventuali stazioni nuove; la parte AI rimane manuale via Cowork per
  non consumare API key del server.
- **Pannello UI admin Cowork** che genera direttamente il blocco
  pronto-da-incollare con un click (oggi: `node scripts/genera-batch-albi.js
  --batch N | pbcopy`).

---

## 6. Troubleshooting

### `import-albi-da-scan.js` ritorna "ECONNREFUSED 127.0.0.1:5432"
Postgres locale non è up. Controlla `DATABASE_URL` nel `.env` del backend.

### Molti record con `match_method=fuzzy_multi` (ambigui)
Il file JSON contiene ragioni sociali "vecchie" (es. aziende municipalizzate
ridenominate). Esamina `data/import-albi-report.json` → array `ambigui`,
correggi manualmente.

### `scan-albi-completo.js` si interrompe per rate limit DuckDuckGo
Aumenta il delay tra le richieste nel config dello script. Riavvia,
riprende dal progresso salvato. NB: la discovery AI vera (con
estrazione dei dettagli) ora la fai via Cowork (Step 3) — non serve
più mantenere lo script che chiamava Anthropic dal server.

### La UI cliente "Albi Fornitori" mostra ancora 0
Verifica con `psql`:
```sql
SELECT COUNT(*) FROM albi_fornitori WHERE attivo = true;
```
Se = 0, lo step 1 di import non è ancora stato eseguito o ha riportato
solo `non_trovati` (vedi report).
