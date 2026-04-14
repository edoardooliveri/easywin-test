# Audit Bandi — Fase B1: Schema + Backend

**Data:** 2026-04-14
**Branch:** `feat/audit-bandi-fase-b1-schema`
**Ref:** `docs/AUDIT_BANDI_REPORT.md` (Fase A, PR #2)

---

## Migration applicate

| # | File | Descrizione | Esito |
|---|------|-------------|-------|
| 026 | `026_tipo_sopralluogo.sql` | CREATE TABLE tipo_sopralluogo + seed 0-4 | OK |
| 027 | `027_bandi_link_bando.sql` | ALTER TABLE bandi ADD COLUMN link_bando TEXT | OK |
| 028 | `028_bandi_id_azienda_dedicata.sql` | ALTER TABLE bandi ADD COLUMN id_azienda_dedicata BIGINT FK→aziende(id) + partial index | OK |
| 029 | `029_bandi_sped_to_boolean.sql` | sped_pec/posta/corriere/mano/telematica TEXT→BOOLEAN | OK |

### Deviazione dal prompt: Migration 028

Il prompt specificava `id_azienda_dedicata UUID REFERENCES aziende(id)`. La colonna `aziende.id` è in realtà `BIGINT`, non `UUID`. La migration è stata corretta a `BIGINT` per match con lo schema esistente.

---

## Modifiche backend

### `routes/bandi.js`

1. **Rimosso `id_esito`** dal whitelist POST (insertableFields) e PUT (updatableFields) — era un campo phantom (nessuna colonna corrispondente).
2. **Aggiunto `id_azienda_dedicata`** al whitelist POST e PUT.
3. `link_bando` era già presente in entrambi i whitelist — ora la colonna DB esiste (migration 027).
4. `id_tipo_sopralluogo` era già presente — ora la lookup table esiste (migration 026).

### `routes/lookups.js`

- Nuovo endpoint `GET /api/lookups/tipo-sopralluogo` → ritorna `[{id, nome}]` da tabella `tipo_sopralluogo ORDER BY id`.

### `routes/admin-aziende.js`

- Nessuna modifica. Endpoint `GET /api/admin/aziende/search?q=<text>&limit=N` già esistente (riga ~1060). Ritorna `{risultati: [{id, ragione_sociale, partita_iva}]}`.

### `server.js`

- Aggiunte migration 026-029 all'array `AUTO_MIGRATIONS` (necessario per auto-apply all'avvio).

---

## Smoke test

### Test 1: tipo_sopralluogo (DB)

```
5 righe: id 0-4 (Non specificato, Obbligatorio, Facoltativo, Non richiesto, Da verificare)
```

PASS

### Test 2: Colonne bandi (DB)

```
id_azienda_dedicata  → bigint
id_tipo_sopralluogo  → integer
link_bando           → text
sped_corriere        → boolean
sped_mano            → boolean
sped_pec             → boolean
sped_posta           → boolean
sped_telematica      → boolean
```

PASS

### Test 3: GET /api/lookups/tipo-sopralluogo

```json
[
  {"id": 0, "nome": "Non specificato"},
  {"id": 1, "nome": "Obbligatorio"},
  {"id": 2, "nome": "Facoltativo"},
  {"id": 3, "nome": "Non richiesto"},
  {"id": 4, "nome": "Da verificare"}
]
```

PASS

### Test 4: GET /api/admin/aziende/search?q=a&limit=5

```
HTTP 200 — ritorna array con aziende (endpoint pre-esistente, nessuna modifica)
```

PASS

### Test 5: PUT /api/bandi/:id con id_azienda_dedicata

```
PUT con {"id_azienda_dedicata": 30} → HTTP 200 "Bando aggiornato con successo"
GET successivo conferma id_azienda_dedicata: 30
```

PASS

### Test 6: PUT /api/bandi/:id con id_esito (rimosso)

```
PUT con {"id_esito": "fake-value"} → HTTP 400 "Nessun campo da aggiornare"
(id_esito non è più nel whitelist, nessun campo valido nel payload)
```

PASS (comportamento atteso: rifiutato perché campo non riconosciuto)

### Test 7: Smoke baseline 15 endpoint

```
PASS GET /api/bandi?page=1&limit=2
PASS GET /api/esiti?page=1&limit=2
PASS GET /api/admin/dashboard/summary
PASS GET /api/admin/dashboard/stats
FAIL(500) GET /api/admin/sistema/info
PASS GET /api/admin/sistema/tasks
PASS GET /api/admin/utenti?page=1&limit=2
PASS GET /api/admin/newsletter/storico
PASS GET /api/lookups/regioni
PASS GET /api/ricerca-doppia?q=test
FAIL(500) GET /api/clienti/profilo
FAIL(500) GET /api/esiti/recenti
FAIL(500) GET /api/bandi/recenti
FAIL(404) GET /api/presidia/stato
FAIL(404) GET /api/pubblico/stats
---
Pass: 9 / 15 | Fail: 6
```

**Delta vs main: ZERO** — stessi 6 endpoint falliscono identicamente su main e feat (cause pre-esistenti non correlate a B1).

### Dati sped_* prima della conversione

Verifica preventiva: tutte e 5 le colonne contenevano solo valori `'false'` (nessun NULL, nessuna stringa inattesa). Conversione sicura.

---

## Riepilogo file modificati

```
backend/src/db/migrations/026_tipo_sopralluogo.sql           [NUOVO]
backend/src/db/migrations/027_bandi_link_bando.sql           [NUOVO]
backend/src/db/migrations/028_bandi_id_azienda_dedicata.sql  [NUOVO]
backend/src/db/migrations/029_bandi_sped_to_boolean.sql      [NUOVO]
backend/src/routes/bandi.js                                  [MODIFICA whitelist]
backend/src/routes/lookups.js                                [NUOVO endpoint]
backend/src/server.js                                        [AUTO_MIGRATIONS array]
docs/AUDIT_BANDI_FASE_B1.md                                  [NUOVO — questo report]
```
