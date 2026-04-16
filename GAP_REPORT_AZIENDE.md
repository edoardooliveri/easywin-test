# Gap Analysis: Schema Legacy Aziende/Albi vs Nuovo Sito

**Data**: 2026-04-15
**Sorgente legacy**: `migrazione-postgres` (SQL Server → Postgres)
**Nuovo sito**: `backend/src/db/migrations/`

---

## Riepilogo

| Tabella | Colonne legacy | Mappate | ADD | SKIP | REVIEW |
|---------|---------------|---------|-----|------|--------|
| Aziende | 66 | 15 | 37 | 8 | 6 |
| AziendaPersonale | 4 | 3 | 1 | 0 | 0 |
| AttestazioniAziende | 6 | 3 | 2 | 0 | 1 |
| EventiAziende | 10 | 3 | 5 | 0 | 2 |
| NoteAziende | 6 | 4 | 1 | 0 | 1 |
| Consorzi | 3 | 3 | 0 | 0 | 0 |
| ModificheAzienda | 4 | 3 | 0 | 0 | 1 |
| **TOTALE** | **99** | **34** | **46** | **8** | **11** |

**Verdetto: migrazione 031 necessaria** (46 colonne ADD).

---

## 1. Aziende (96K righe legacy → tabella `aziende`)

### Colonne mappate (15/66)

| Colonna legacy | Tipo legacy | Colonna nuovo | Note |
|---|---|---|---|
| id | INTEGER | id | PK |
| RagioneSociale | VARCHAR(255) | ragione_sociale | OK, nuovo ha VARCHAR(500) |
| Indirizzo | VARCHAR(255) | indirizzo | OK |
| Cap | CHAR(5) | cap | OK |
| Città | VARCHAR(255) | citta | OK |
| id_provincia | INTEGER | id_provincia | OK |
| Tel | CHAR(30) | telefono | OK |
| PartitaIva | CHAR(11) | partita_iva | OK, allargata a VARCHAR(50) in 008 |
| Email | VARCHAR(100) | email | OK |
| Note | TEXT | note | OK |
| CodiceFiscale | VARCHAR(50) | codice_fiscale | OK |
| eliminata | BOOLEAN | eliminata | OK, aggiunta in 005 |
| IndirizzoPEC | VARCHAR(256) | pec | OK |
| DataCreazione | TIMESTAMPTZ | created_at / data_inserimento | OK |
| DataModifica | TIMESTAMPTZ | updated_at / data_modifica | OK |

### Colonne ADD (37) — da aggiungere con migrazione 031

| # | Colonna legacy | Tipo legacy | Colonna nuovo proposta | Tipo nuovo | Categoria |
|---|---|---|---|---|---|
| 1 | Nome | VARCHAR(255) | nome_breve | VARCHAR(255) | Anagrafica |
| 2 | COD | UUID | cod | UUID | Anagrafica |
| 3 | username | VARCHAR(50) | username | VARCHAR(100) | Link utente |
| 4 | SendEmail | BOOLEAN | send_email | BOOLEAN DEFAULT false | CRM |
| 5 | LastEmailSend | TIMESTAMPTZ | ultimo_invio_email | TIMESTAMPTZ | CRM |
| 6 | CCIA | VARCHAR(50) | cciaa | VARCHAR(50) | Camera Commercio |
| 7 | IscrizioneCCIA | VARCHAR(150) | iscrizione_cciaa | VARCHAR(200) | Camera Commercio |
| 8 | DataIscrizioneCCIA | TIMESTAMPTZ | data_iscrizione_cciaa | TIMESTAMPTZ | Camera Commercio |
| 9 | TipologiaAttestazione | VARCHAR(150) | tipologia_attestazione | VARCHAR(200) | SOA |
| 10 | SocAttestatriceSoa | VARCHAR(150) | soa_attestatrice | VARCHAR(200) | SOA |
| 11 | NumeroSoa | VARCHAR(150) | numero_soa | VARCHAR(200) | SOA |
| 12 | DataRilascioAttestazioneOriginaria | TIMESTAMPTZ | data_rilascio_attestazione_orig | TIMESTAMPTZ | SOA |
| 13 | ValiditàTriennale | TIMESTAMPTZ | validita_triennale | TIMESTAMPTZ | SOA |
| 14 | ValiditàQuinquennale | TIMESTAMPTZ | validita_quinquennale | TIMESTAMPTZ | SOA |
| 15 | DataRilascioAttestazioneInCorso | TIMESTAMPTZ | data_rilascio_attestazione_corso | TIMESTAMPTZ | SOA |
| 16 | DataVerificaTriennale | TIMESTAMPTZ | data_verifica_triennale | TIMESTAMPTZ | SOA |
| 17 | UsernameResponsabile | VARCHAR(256) | username_responsabile | VARCHAR(100) | CRM |
| 18 | Referente | VARCHAR(50) | referente | VARCHAR(100) | CRM |
| 19 | TelefonoReferente | VARCHAR(50) | telefono_referente | VARCHAR(50) | CRM |
| 20 | StatoNonInteressato | BOOLEAN | stato_non_interessato | BOOLEAN DEFAULT false | Stato commerciale |
| 21 | DataNonInteressato | TIMESTAMPTZ | data_non_interessato | TIMESTAMPTZ | Stato commerciale |
| 22 | UsernameNonInteressato | VARCHAR(256) | username_non_interessato | VARCHAR(100) | Stato commerciale |
| 23 | NoteNonInteressato | VARCHAR(2000) | note_non_interessato | TEXT | Stato commerciale |
| 24 | NascondiStato | BOOLEAN | nascondi_stato | BOOLEAN DEFAULT false | Stato commerciale |
| 25 | Cessata | BOOLEAN | cessata | BOOLEAN DEFAULT false | Stato commerciale |
| 26 | CodiceSDI | VARCHAR(7) | codice_sdi | VARCHAR(7) | Fatturazione |
| 27 | AbbonatoSopralluoghi | BOOLEAN | abbonato_sopralluoghi | BOOLEAN DEFAULT false | Abbonamenti |
| 28 | AbbonatoAperture | BOOLEAN | abbonato_aperture | BOOLEAN DEFAULT false | Abbonamenti |
| 29 | PresenteDocumentoDelega | BOOLEAN | presente_doc_delega | BOOLEAN DEFAULT false | Documenti |
| 30 | PresenteDocumentoIdentita | BOOLEAN | presente_doc_identita | BOOLEAN DEFAULT false | Documenti |
| 31 | PresenteDocumentoSOA | BOOLEAN | presente_doc_soa | BOOLEAN DEFAULT false | Documenti |
| 32 | PresenteDocumentoCCIAA | BOOLEAN | presente_doc_cciaa | BOOLEAN DEFAULT false | Documenti |
| 33 | DataScadenzaDelega | TIMESTAMPTZ | data_scadenza_delega | TIMESTAMPTZ | Documenti |
| 34 | DataScadenzaIdentita | TIMESTAMPTZ | data_scadenza_identita | TIMESTAMPTZ | Documenti |
| 35 | DataScadenzaSOA | TIMESTAMPTZ | data_scadenza_soa | TIMESTAMPTZ | Documenti |
| 36 | DataScadenzaCCIAA | TIMESTAMPTZ | data_scadenza_cciaa | TIMESTAMPTZ | Documenti |
| 37 | Consorzio | BOOLEAN | consorzio | BOOLEAN DEFAULT false | Anagrafica |
| 38 | ISOScadenza | TIMESTAMPTZ | iso_scadenza | TIMESTAMPTZ | Certificazioni |
| 39 | ISORilasciatoDa | VARCHAR(255) | iso_rilasciato_da | VARCHAR(255) | Certificazioni |

### Colonne SKIP (8) — non necessarie

| Colonna legacy | Tipo | Motivazione |
|---|---|---|
| PrezzoBandi | NUMERIC | Pricing gestito in `periodi` (per-utente, non per-azienda) |
| PrezzoEsiti | NUMERIC | Idem |
| PrezzoBundle | NUMERIC | Idem |
| ScadenzaBandi | TIMESTAMPTZ | Subscription gestita in `periodi`/`users` |
| ScadenzaEsiti | TIMESTAMPTZ | Idem |
| ScadenzaBundle | TIMESTAMPTZ | Idem |
| OldName | VARCHAR(255) | Storico, valore in <5% delle righe. Se serve, recuperabile dal dump |
| ID_Concorrente | INTEGER | Ref a tabella Concorrenti (29 righe). Tabella legacy non usata nel nuovo |

### Colonne REVIEW (6) — servono decisione utente

| Colonna legacy | Tipo | Dubbio |
|---|---|---|
| DocumentoDelega | BYTEA | 4 colonne BYTEA per riga = pesante. Alternativa: usare `user_documents` o file storage |
| DocumentoIdentita | BYTEA | Idem |
| DocumentoSOA | BYTEA | Idem |
| DocumentoCCIAA | BYTEA | Idem |

**Domanda REVIEW**: i 4 documenti binari vanno spostati in una tabella separata `aziende_documenti` (tipo, file, scadenza) oppure aggiunti come BYTEA direttamente su `aziende`? La tabella `user_documents` (mig 018) gestisce documenti per utente, non per azienda.

---

## 2. AziendaPersonale (157K righe → tabella `azienda_personale`)

| Colonna legacy | Tipo legacy | Presente? | Colonna nuovo | Note |
|---|---|---|---|---|
| IdAzienda | INTEGER | ✅ | id_azienda | OK |
| Nome | VARCHAR(150) | ✅ | nome | Nuovo ha anche `cognome` (legacy ha solo Nome) |
| Ruolo | VARCHAR(150) | ✅ | ruolo | OK |
| CodiceFiscale | VARCHAR(150) | ❌ ADD | — | Codice fiscale del personale |

**ADD**: 1 colonna — `codice_fiscale VARCHAR(50)`

---

## 3. AttestazioniAziende (194K righe → tabella `attestazioni`)

| Colonna legacy | Tipo legacy | Presente? | Colonna nuovo | Note |
|---|---|---|---|---|
| IdAzienda | INTEGER | ✅ | id_azienda | OK |
| IdSoa | INTEGER | ✅ | id_soa | OK |
| id_attestazione | INTEGER | ❓ REVIEW | — | Ref a lookup `Attestazioni` (10 righe) — è il "tipo" di attestazione? |
| Anno | INTEGER | ❌ ADD | — | Anno di riferimento dell'attestazione |
| Username | VARCHAR(50) | ❌ ADD | — | Chi ha inserito il record |
| DataInserimento | TIMESTAMPTZ | ✅ | created_at | OK |

**ADD**: 2 colonne — `anno INTEGER`, `username VARCHAR(100)`
**REVIEW**: 1 colonna — `id_attestazione` (verificare se mappa a `classifica` nel nuovo o è un campo diverso)

---

## 4. EventiAziende (965K righe → tabella `eventi_aziende`)

Lo schema legacy ha un **modello request-response** (DataInvio/DataRisposta, Tipo/Stato/IDEsito) molto diverso dal nuovo che è un semplice event log.

| Colonna legacy | Tipo legacy | Presente? | Colonna nuovo | Note |
|---|---|---|---|---|
| ID | INTEGER | ✅ | id | PK |
| IDAzienda | INTEGER | ✅ | id_azienda | OK |
| Tipo | INTEGER | ⚠️ | tipo VARCHAR | Legacy usa INT, nuovo usa VARCHAR. Serve mapping |
| Stato | INTEGER | ❌ ADD | — | Stato workflow (0=nuovo, 1=in corso, 2=completato?) |
| DataInvio | TIMESTAMPTZ | ❌ ADD | — | Data invio comunicazione (≠ data_inserimento) |
| UserNameInvio | VARCHAR(256) | ✅ | username | OK (ma nel legacy è chi ha inviato) |
| IDEsito | INTEGER | ❌ ADD | — | Ref a esito/risultato dell'evento |
| DataRisposta | TIMESTAMPTZ | ❌ ADD | — | Data risposta ricevuta |
| UserNameRisposta | VARCHAR(256) | ❌ ADD | — | Chi ha risposto |
| Nota | VARCHAR(2000) | ✅ | descrizione | OK (mapping nome diverso) |

**ADD**: 5 colonne — `stato INTEGER`, `data_invio TIMESTAMPTZ`, `id_esito INTEGER`, `data_risposta TIMESTAMPTZ`, `username_risposta VARCHAR(100)`

**REVIEW**:
- `Tipo` legacy è INTEGER, nuovo è VARCHAR. Servirà un mapping dei valori durante l'import.
- `DataInvio` vs `data_inserimento`: nel legacy sono distinti (quando è stato inviato vs quando è stato creato il record). Nel nuovo c'è solo `data_inserimento`.

---

## 5. NoteAziende (5K righe → tabella `note_aziende`)

| Colonna legacy | Tipo legacy | Presente? | Colonna nuovo | Note |
|---|---|---|---|---|
| ID | INTEGER | ✅ | id | PK |
| IDAzienda | INTEGER | ✅ | id_azienda | OK |
| Data | TIMESTAMPTZ | ✅ | data_inserimento | OK |
| UserName | VARCHAR(256) | ✅ | username | OK |
| Nota | VARCHAR(2000) | ✅ | testo | OK (mapping nome) |
| DataAlert | TIMESTAMPTZ | ❌ ADD | — | Data reminder/alert schedulato |

**ADD**: 1 colonna — `data_alert TIMESTAMPTZ`

**REVIEW**: `Nota` legacy è VARCHAR(2000), `testo` nuovo è TEXT. Nessun problema (TEXT accetta tutto).

---

## 6. Consorzi (7K righe → tabella `consorzi`)

| Colonna legacy | Tipo legacy | Presente? | Colonna nuovo | Note |
|---|---|---|---|---|
| IdConsorzio | INTEGER | ✅ | id_azienda_consorzio | OK |
| IdComponente | INTEGER | ✅ | id_azienda_membro | OK |
| Data | TIMESTAMPTZ | ✅ | data_inizio | OK (mapping approssimativo) |

**Nessun gap.** Il nuovo schema ha colonne extra (data_fine, attivo) che il legacy non ha.

---

## 7. ModificheAzienda (8K righe → tabella `modifiche_azienda`)

| Colonna legacy | Tipo legacy | Presente? | Colonna nuovo | Note |
|---|---|---|---|---|
| id_azienda | INTEGER | ✅ | id_azienda | OK |
| UserName | VARCHAR(50) | ✅ | username | OK |
| DataModifica | TIMESTAMPTZ | ✅ | data | OK |
| Note | TEXT | ❓ REVIEW | — | Nuovo ha campo/valore_precedente/valore_nuovo (strutturato) |

**REVIEW**: Lo schema legacy usa `Note TEXT` per descrizioni libere delle modifiche. Il nuovo usa campi strutturati (`campo`, `valore_precedente`, `valore_nuovo`). Durante l'import, il testo di `Note` potrebbe essere mappato in `valore_nuovo` o si potrebbe aggiungere un campo `note TEXT` alla tabella per backward compatibility.

---

## Migrazione 031 — Contenuto

File: `backend/src/db/migrations/031_aziende_align_legacy.sql`

Aggiunge **46 colonne** su 5 tabelle:
- `aziende`: 39 colonne (anagrafica, CRM, documenti, certificazioni, stato commerciale)
- `azienda_personale`: 1 colonna (codice_fiscale)
- `attestazioni`: 2 colonne (anno, username)
- `eventi_aziende`: 5 colonne (stato, data_invio, id_esito, data_risposta, username_risposta)
- `note_aziende`: 1 colonna (data_alert)

NON incluse nella migrazione (REVIEW — richiedono decisione):
- 4 colonne BYTEA su aziende (DocumentoDelega/Identita/SOA/CCIAA)
- id_attestazione su attestazioni
- note TEXT su modifiche_azienda
- Mapping Tipo INT→VARCHAR su eventi_aziende

---

## Prossimi passi

1. **Decidere le REVIEW** (11 colonne) — in particolare i 4 BYTEA documenti
2. **Eseguire la migrazione 031** se il report è approvato
3. **Import dati legacy** nello schema del nuovo sito (script separato)
4. **Aggiornare route e UI** per gestire le nuove colonne
