# Setup Presidia + AI (Bandi & Esiti)

Questa guida spiega come configurare il **pipeline di import bandi da Presidia**
+ l'**analisi AI** (Anthropic) di bandi ed esiti, dalla fase di config delle env
var al primo import end-to-end.

Aggiornato: 2026-05-12.

---

## 1. Architettura del flusso

```
 ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
 │   Presidia WS    │    │  easyWin backend │    │   easyWin DB     │
 │ (macsyws.asmx)   │───▶│  presidia-import │───▶│ bandi, bandi_*_  │
 │    SOAP/WSDL     │    │   .js (service)  │    │ allegati, runs   │
 └──────────────────┘    └──────────┬───────┘    └──────────────────┘
                                    │
                                    ▼
                         ┌──────────────────┐    ┌──────────────────┐
                         │   bandi-ai.js    │───▶│  Anthropic API   │
                         │ (analyze/enrich) │    │ (Claude Sonnet)  │
                         └──────────────────┘    └──────────────────┘
                                    │
                                    ▼
                          aggiorna bandi con dati AI
                          (categoria_soa, classifica,
                           importi separati, ATI, ecc.)
```

Pipeline esiti analoga, ma il PDF (o Excel) viene caricato manualmente da admin
oppure scoperto in altro modo (Presidia oggi distribuisce bandi, non esiti).

```
 admin upload PDF esito  ─▶  POST /api/esiti-ai/analyze
                             │
                             ▼
                       Claude extracts JSON
                             │
                             ▼
                     admin review (queue)
                             │
                             ▼
                  POST /api/esiti-ai/create-from-review
                             │
                             ▼
                   gare + dettaglio_gara
                       (graduatoria)
```

---

## 2. Variabili d'ambiente richieste

Nel file `backend/.env` (vedi `backend/.env.example` per il template completo):

| Variabile | Default | Note |
|---|---|---|
| `PRESIDIA_SOAP_URL` | `http://easywin.presidia.it/macsyws.asmx` | Endpoint WSDL Presidia. Lasciare il default in produzione. |
| `PRESIDIA_AUTO` | `false` | Set `true` per attivare lo scheduler automatico (12 slot diurni + riepilogo 4:00). |
| `ANTHROPIC_API_KEY` | _vuoto_ | Necessaria per **tutte** le rotte `bandi-ai` ed `esiti-ai`. Senza → 500. |
| `AI_MODEL_BULK` | `claude-haiku-4-5-20251001` | Modello per processing massivo. |
| `AI_MODEL_INTERACTIVE` | `claude-sonnet-4-20250514` | Modello per analisi interattiva di alta qualità. |

L'autenticazione verso Presidia avviene **per chiamata** tramite il parametro
`GUID` passato dalla UI admin in /api/presidia/search e simili. Non esiste un
PRESIDIA_USERNAME / PRESIDIA_PASSWORD globale; le voci con quel nome che si
trovavano in `.env.example` precedenti erano placeholder mai usati dal codice e
sono state rimosse.

---

## 3. Verifica connettività Presidia

Prima di tutto, controlla che il backend riesca a parlare con Presidia.

```bash
# Test (no auth) — espone se la connessione SOAP funziona + stats import storici
curl -s http://localhost:3001/api/presidia/status | jq
```

Risposta attesa:

```json
{
  "soap_url": "http://easywin.presidia.it/macsyws.asmx",
  "connected": true,
  "connection_error": null,
  "statistiche": {
    "ultimo_import": "...",
    "ultimi_24h": "...",
    "ultimi_7_giorni": "...",
    "totale": "..."
  }
}
```

Se `connected: false`:
- Controlla il firewall di rete (Presidia è raggiungibile solo da IP whitelisted).
- Prova ad aggiungere `?WSDL` a `PRESIDIA_SOAP_URL` con curl per vedere se il
  servizio risponde:
  `curl -i "$PRESIDIA_SOAP_URL?WSDL"`.

---

## 4. Primo import manuale

Una volta verificata la connettività, fai un import di prova **a mano** su una
finestra temporale piccola:

```bash
TOKEN=...  # JWT di un utente admin

curl -X POST http://localhost:3001/api/presidia/import \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "data_dal": "2026-05-01",
    "data_al":  "2026-05-05",
    "max_results": 50
  }' | jq
```

Risposta tipica:

```json
{
  "imported": 27,
  "skipped":  18,
  "updated":  3,
  "errors":   2,
  "total_presidia": 50,
  "message": "Import completato: 27 nuovi, 3 rettificati, 18 già presenti, 2 errori"
}
```

Tutto viene loggato in `presidia_import_runs` (vedi migration 024). Per
controllare:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/presidia/runs/today | jq
```

---

## 5. Attivare lo scheduler automatico

Quando l'import manuale funziona, imposta `PRESIDIA_AUTO=true` nel `.env` e
riavvia il backend.

Slot orari (idempotenti, ogni slot ha una `slot_key` univoca):

- Diurni: 11:00, 12:00, 13:00, 14:00, 15:00, 16:00, 16:45, 17:15, 17:45,
  18:15, 18:45, 19:15
- Notturno (riepilogo): 04:00 (finestra ieri→oggi)

Se uno slot fallisce 3 volte di seguito, il backend invia una notifica email
all'admin (vedi `presidia-scheduler.js`).

Controllo dello stato runtime dello scheduler:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/presidia/scheduler-status | jq
```

---

## 6. Catena AI sui bandi importati

Una volta che i bandi sono in DB (provenienza='Presidia'), l'AI li può
arricchire. I principali entry point:

| Route | Cosa fa |
|---|---|
| `POST /api/bandi-ai/analyze` | Analizza un PDF arbitrario e ritorna JSON strutturato. |
| `POST /api/bandi-ai/create-from-pdf` | Stesso più creazione del bando in DB. |
| `POST /api/bandi-ai/process-single/:id` | Per un bando già in DB: ricalcola campi AI a partire dai suoi allegati. |
| `POST /api/bandi-ai/enrich-from-allegati` | Batch su tutti i bandi con allegati non ancora processati. |
| `POST /api/bandi-ai/enrich-batch` | Batch su un sottoinsieme (filtro). |

Esempio enrich di un bando appena importato:

```bash
curl -X POST http://localhost:3001/api/bandi-ai/process-single/<UUID_BANDO> \
  -H "Authorization: Bearer $TOKEN" | jq
```

Costo stimato (Sonnet 4 a maggio 2026): ~€0.02-0.05 per bando con allegati di
dimensione media. Usare `AI_MODEL_BULK=haiku-4-5` per le batch (~1/10 del
costo).

---

## 7. AI sugli esiti

Esiti non arrivano da Presidia (Presidia distribuisce bandi). Il flusso esiti
parte da un upload manuale del PDF/Excel dell'aggiudicazione:

| Route | Cosa fa |
|---|---|
| `POST /api/esiti-ai/analyze` | Upload PDF/Excel/immagine → JSON con anagrafica + graduatoria. |
| `GET /api/esiti-ai/pending` | Coda di esiti analizzati ma non ancora confermati. |
| `POST /api/esiti-ai/match-company` | Tenta il match della ragione sociale di un partecipante con `aziende` in DB. |
| `POST /api/esiti-ai/create-from-review` | Conferma l'esito creando `gare` + `dettaglio_gara`. |
| `POST /api/esiti-ai/link-bando/:id` | Collega un esito al bando di origine. |
| `POST /api/esiti-ai/analyze-graduatoria/:id` | Ri-analizza la graduatoria di un esito esistente. |
| `POST /api/esiti-ai/commit-graduatoria/:id` | Salva la graduatoria estratta dall'AI. |

Le ultime due sono il cuore della **feature "compilazione automatica
graduatoria esiti"** che chiediamo.

---

## 8. Troubleshooting

### `/api/presidia/status` torna `connected:false`
- IP non in whitelist Presidia: contatta il fornitore.
- Servizio Presidia offline: prova `?WSDL` con curl.

### Le route `/api/bandi-ai/*` o `/api/esiti-ai/*` tornano 500 con messaggio "ANTHROPIC_API_KEY non configurata"
- Il messaggio è esplicito: aggiungi la chiave nel `.env` del backend e riavvia.

### `POST /api/presidia/import` torna 500 senza messaggio chiaro
- Controlla `presidia_import_runs` per il dettaglio: ogni run fallita salva
  `error_detail` come JSON con stack trace.

### Lo scheduler non parte all'avvio
- Confermare `PRESIDIA_AUTO=true` nel `.env`.
- Controllare i log all'avvio: deve apparire "Presidia scheduler avviato".

### `/admin/esiti/crea` o `/admin/bandi/crea` mostrano "Errore: HTTP 500"
- Era un bug di validazione: il SPA admin chiamava `GET /api/esiti/crea` e il
  backend provava a parsare 'crea' come `INT`/`UUID`. Risolto col fix che
  ritorna 400 esplicito invece di propagare l'errore Postgres come 500.
  Per accedere correttamente alla pagina "Nuovo Esito" usare la nav admin
  (Esiti → CREA ESITO).

---

## 9. Riferimenti codice

- `backend/src/services/presidia-soap.js` — SOAP client + mapping SOA Presidia→easyWin
- `backend/src/services/presidia-import.js` — orchestratore import (chiama il client SOAP + INSERT in `bandi`)
- `backend/src/services/presidia-scheduler.js` — scheduler con slot e retry
- `backend/src/routes/presidia.js` — API admin esposte (12 endpoint)
- `backend/src/routes/bandi-ai.js` — AI per bandi (Claude SDK)
- `backend/src/routes/esiti-ai.js` — AI per esiti (Claude SDK)
- `backend/src/db/migrations/024_presidia_import_runs.sql` — tabella log import
