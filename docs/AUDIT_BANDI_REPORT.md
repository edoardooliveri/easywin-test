# AUDIT BANDI — Fase A: report comparativo vecchio vs nuovo form

Data: 2026-04-14
Branch: `docs/audit-bandi-fase-a`
Fonte vecchio form: screenshot `appalti.easywin.it/Gestione/Bandi/ModificaBando/…` del 2026-04-14
Fonte nuovo form: `admin/bando-pagina.html` (funzione `render(b)`, riga 723)
Fonte DB: `\d bandi` su mini-neon (82 colonne)

---

## 1. Executive summary

Il vecchio form "Modifica Bando" espone **45 campi** editabili/visibili, organizzati in 9 righe funzionali. Il nuovo form `bando-pagina.html` rende **31 campi** in 6 card tematiche, di cui solo **17 editabili** (con `name` attribute per il form submit).

**Gap critico:** 27 campi del vecchio form non sono renderizzati nel nuovo. Di questi:
- **25 MISSING** — colonna DB presente, campo form assente. Sono candidati da aggiungere in Fase B.
- **2 FORSE_OBSOLETO** — semantica dubbia, richiedono conferma da Edoardo.
- **5 read-only** nel nuovo dove erano editabili nel vecchio (dropdown lookup mancanti).
- **1 DIVISO** — il dropdown "Visibilita" del vecchio e diventato 3 flag separati nel DB.

L'intera sezione **Sopralluogo** (6 campi) e l'intera sezione **Spedizione** (6 campi) del vecchio form sono completamente assenti dal nuovo.

**Stima effort Fase B:** 3-4 giorni CC. ~0 ALTER TABLE (le colonne DB esistono gia), ~25 campi da aggiungere al form HTML, ~2-3 modifiche al backend PUT (gia nel whitelist), 1 fix bug (link_bando/id_esito phantom columns).

| Contatore | Valore |
|-----------|--------|
| Campi vecchio form | 45 |
| Campi nuovo form (renderizzati) | 31 |
| **MISSING** (da aggiungere) | **25** |
| **FORSE_OBSOLETO** (chiedere) | **2** |
| Domande aperte per Edoardo | **10** |

---

## 2. Tabella comparativa completa

Legenda stati: `OK` presente e funzionante | `RINOMINATO` presente con nome diverso | `MISSING` assente nel form nuovo | `DIVISO` un campo vecchio diviso in piu campi nuovi | `FORSE_OBSOLETO` potenzialmente non piu necessario

### Riga 1 — Identificazione

| # | Campo vecchio (label UI) | Nome tecnico vecchio (ipotesi) | Presente nel nuovo? | Nome tecnico nuovo (DB/JSON) | Stato | Note |
|---|---|---|---|---|---|---|
| 1 | Province (multi-tag) | Province | Si (read-only) | `b.provincia_nome` (join province→stazioni) | OK | Visibile in Anagrafica come "Provincia". Non editabile: la provincia deriva dalla stazione appaltante, non e impostata direttamente sul bando. Nel vecchio era un multi-tag editabile. |
| 2 | CodiceCIG | CodiceCIG | Si | `b.codice_cig` / `bandi.codice_cig` | OK | Editabile in entrambi i form. |

### Riga 2 — Oggetto

| # | Campo vecchio (label UI) | Nome tecnico vecchio (ipotesi) | Presente nel nuovo? | Nome tecnico nuovo (DB/JSON) | Stato | Note |
|---|---|---|---|---|---|---|
| 3 | Oggetto (textarea) | Oggetto | Si | `b.titolo` / `bandi.titolo` | RINOMINATO | Label: "Titolo / Oggetto". Stessa colonna DB `titolo TEXT NOT NULL`. |

### Riga 3 — Tipologia e trattamento

| # | Campo vecchio (label UI) | Nome tecnico vecchio (ipotesi) | Presente nel nuovo? | Nome tecnico nuovo (DB/JSON) | Stato | Note |
|---|---|---|---|---|---|---|
| 4 | Tipologia di bandi (dropdown, es. "Procedura Aperta") | TipologiaBandi | No | `bandi.id_tipologia_bando` → `tipologia_bandi.nome` | MISSING | **Attenzione:** il nuovo form mostra "Tipologia gara" (`tipologia_gare_nome`) che e la tipologia CONTRATTUALE (Lavori, Servizi, Forniture), NON la tipologia PROCEDURALE (Procedura Aperta, Ristretta, Negoziata). Sono due lookup diverse: `id_tipologia` vs `id_tipologia_bando`. Il dropdown procedurale manca completamente. |
| 5 | Criteri di aggiudicazione (dropdown) | CriterioAggiudicazione | Si (read-only) | `b.criterio_nome` (join criteri) / `bandi.id_criterio` | MISSING | Label "Criterio aggiudicazione" visibile in card Piattaforma, ma solo come testo read-only. Dropdown di modifica mancante. Backend PUT accetta `id_criterio`. |
| 6 | Max invitati (numero) | MaxInvitati | No | `bandi.max_invitati_negoziate` | MISSING | Colonna DB esiste (`INTEGER DEFAULT 0`). Rilevante per procedure negoziate. |
| 7 | N° decimali (numero) | NDecimali | No | `bandi.n_decimali` | MISSING | Colonna DB esiste (`SMALLINT DEFAULT 3`). Usato nel calcolo esito per arrotondamento ribassi. |
| 8 | Accorpa ali (checkbox) | AccorpaAli | No | `bandi.accorpa_ali` | MISSING | Colonna DB esiste (`BOOLEAN DEFAULT false`). Parametro calcolo esito. |
| 9 | Accorpa ribassi ali (dropdown) | AccorpaRibassiAli | No | `bandi.tipo_accorpa_ali` | MISSING | Colonna DB esiste (`INTEGER`). Parametro calcolo esito. |

### Riga 4 — SOA e importo principale

| # | Campo vecchio (label UI) | Nome tecnico vecchio (ipotesi) | Presente nel nuovo? | Nome tecnico nuovo (DB/JSON) | Stato | Note |
|---|---|---|---|---|---|---|
| 10 | Soa Prevalente (dropdown) | SoaPrevalente | Si (read-only) | `b.soa_categoria` (join soa) / `bandi.id_soa` | MISSING | Label "SOA categoria" visibile in Anagrafica con codice + descrizione. Dropdown di modifica mancante. Backend PUT accetta `id_soa`. |
| 11 | Attestazione (dropdown, es. "IV [2.582.000]") | Attestazione | No | `bandi.soa_val` | MISSING | Colonna DB esiste (`INTEGER`). Livello di qualificazione SOA (I-VIII con fasce di importo). |
| 12 | Importo (importo SOA prevalente) | ImportoSoaPrevalente | No | `bandi.importo_soa_prevalente` | MISSING | Colonna DB esiste (`NUMERIC`). Importo specifico della categoria SOA prevalente. |
| 13 | Categoria presunta (checkbox) | CategoriaPresunta | No | `bandi.categoria_presunta` | MISSING | Colonna DB esiste (`BOOLEAN DEFAULT false`). Flag: la SOA non e certa, e stata dedotta. |
| 14 | Sostitutiva prev. (dropdown) | SostitutivaPrev | No | `bandi.categoria_sostitutiva` | MISSING | Colonna DB esiste (`INTEGER`). Riferimento a `soa.id` per la categoria SOA sostitutiva della prevalente. |
| 15 | Limite di esclusione (numero) | LimiteDiEsclusione | No | `bandi.limit_min_media` | MISSING | Colonna DB esiste (`SMALLINT`). Soglia percentuale per esclusione automatica in calcolo esito. |
| 16 | Visibilita (dropdown: Pubblico/Privato/Doppiato/Rettificato) | Visibilita | Parziale | `bandi.privato` + `bandi.rettificato` + `bandi.annullato` | DIVISO | Nel vecchio: un unico dropdown a 4 valori. Nel nuovo: 3 colonne DB separate. Chip ANNULLATO/PRIVATO visibili ma non editabili. Nessun dropdown/toggle nel form. "Doppiato" non ha colonna corrispondente. |
| 17 | Codice esterno Presidia (readonly) | CodiceEsterno | Si | `b.external_code` / `bandi.external_code` | OK | Card Metadata, read-only in entrambi. |

### Riga 5 — Importi di dettaglio

| # | Campo vecchio (label UI) | Nome tecnico vecchio (ipotesi) | Presente nel nuovo? | Nome tecnico nuovo (DB/JSON) | Stato | Note |
|---|---|---|---|---|---|---|
| 18 | Netto dei Lavori | NettoLavori | Si | `b.importo_so` / `bandi.importo_so` | RINOMINATO | Label: "Importo S.O." (Soggetto a ribasso). Editabile. |
| 19 | Costo manodopera | CostoManodopera | Si | `b.importo_manodopera` / `bandi.importo_manodopera` | OK | Label: "Manodopera". Editabile. |
| 20 | Oneri di sicurezza | OneriSicurezza | Si | `b.importo_co` / `bandi.importo_co` | RINOMINATO | Label: "Importo C.O." (Costi per la sicurezza non soggetti a ribasso). Editabile. |
| 21 | Opere in economia | OpereInEconomia | Si | `b.importo_eco` / `bandi.importo_eco` | RINOMINATO | Label: "Importo Eco". Editabile. |
| 22 | Oneri progettuali | OneriProgettuali | Si | `b.oneri_progettazione` / `bandi.oneri_progettazione` | RINOMINATO | Label: "Oneri progettazione". Editabile. |
| 23 | Indirizzo | Indirizzo | No | `bandi.indirizzo` | MISSING | Colonna DB esiste (`TEXT`). Indirizzo del cantiere/luogo dell'appalto. Non confondere con indirizzo della stazione appaltante (che e in `stazioni.indirizzo`). |
| 24 | Cap | Cap | No | `bandi.cap` | MISSING | Colonna DB esiste (`VARCHAR`). CAP del cantiere. |
| 25 | Citta | Citta | Parziale | `bandi.citta` | RINOMINATO | Nel nuovo form: "Citta stazione" mostra `b.stazione_citta \|\| b.citta`. **Ambiguita semantica:** il vecchio form intendeva la citta del CANTIERE (`bandi.citta`), il nuovo mostra la citta della STAZIONE APPALTANTE (`stazioni.citta`) con fallback su `bandi.citta`. Read-only, non editabile. |

### Riga 6 — Date e opzioni

| # | Campo vecchio (label UI) | Nome tecnico vecchio (ipotesi) | Presente nel nuovo? | Nome tecnico nuovo (DB/JSON) | Stato | Note |
|---|---|---|---|---|---|---|
| 26 | Data scadenza (datetime) | DataScadenza | Si | `b.data_offerta` / `bandi.data_offerta` | RINOMINATO | Label: "Scadenza offerta". Editabile. Nel vecchio si chiamava "Data scadenza". |
| 27 | Data apertura Comunicata (datetime + checkbox) | DataAperturaComunicata | Parziale | `b.data_apertura` + `bandi.comunicazione_diretta_data` | DIVISO | Nel nuovo: solo `data_apertura` editabile (label: "Data apertura"). Il checkbox `comunicazione_diretta_data` che abilitava la comunicazione diretta e assente dal form. Backend PUT lo accetta. |
| 28 | Data pubblicazione (datetime) | DataPubblicazione | Si | `b.data_pubblicazione` / `bandi.data_pubblicazione` | OK | Editabile in entrambi. |
| 29 | FORZA data di modifica (datetime + flag) | ForzaDataModifica | No | `bandi.data_modifica` | FORSE_OBSOLETO | Vedi sezione 4. |
| 30 | Tipo dati dell'esito (dropdown) | TipoDatiEsito | No | `bandi.tipo_dati_esito` | MISSING | Colonna DB esiste (`INTEGER`). Classifica il tipo di dati disponibili per l'esito (Completa, Solo vincitore, N partecipanti, ecc.). Lookup: `tipo_dati_gara`. |
| 31 | Telematica (checkbox) | Telematica | No | `bandi.sped_telematica` | MISSING | Colonna DB esiste (`TEXT`→boolean). Flag: offerta inviata per via telematica. |
| 32 | Piattaforma Digitale (dropdown) | PiattaformaDigitale | Si (read-only) | `b.piattaforma_nome` (join) / `bandi.id_piattaforma` | MISSING | Label "Piattaforma" visibile in card Piattaforma come testo read-only. Dropdown di modifica mancante. Backend PUT accetta `id_piattaforma`. |

### Riga 7 — Sopralluogo

| # | Campo vecchio (label UI) | Nome tecnico vecchio (ipotesi) | Presente nel nuovo? | Nome tecnico nuovo (DB/JSON) | Stato | Note |
|---|---|---|---|---|---|---|
| 33 | Tipo Sopralluogo (dropdown) | TipoSopralluogo | No | `bandi.id_tipo_sopralluogo` | MISSING | Colonna DB esiste (`INTEGER DEFAULT 0`). **Nota:** la tabella lookup `tipo_sopralluogo` NON esiste nel DB. Il campo e un intero orfano senza lookup. |
| 34 | Note per Sopralluogo (textarea) | NotePerSopralluogo | No | `bandi.note_per_sopralluogo` | MISSING | Colonna DB esiste (`TEXT`). |
| 35 | Termine prenotazione (datetime) | TerminePrenotazione | No | `bandi.data_max_per_prenotazione` | MISSING | Colonna DB esiste (`TIMESTAMPTZ`). Data ultima per prenotare il sopralluogo. |
| 36 | Termine sopralluogo (datetime) | TermineSopralluogo | No | `bandi.data_max_per_sopralluogo` | MISSING | Colonna DB esiste (`TIMESTAMPTZ`). Data ultima per effettuare il sopralluogo. |
| 37 | PEC (checkbox) | PEC | No | `bandi.sped_pec` | MISSING | Colonna DB esiste (`TEXT`→boolean). Flag: spedizione documenti via PEC. |
| 38 | Indirizzo PEC (testo) | IndirizzoPEC | No | `bandi.indirizzo_pec` | MISSING | Colonna DB esiste (`TEXT`). |

### Riga 8 — Altre modalita

| # | Campo vecchio (label UI) | Nome tecnico vecchio (ipotesi) | Presente nel nuovo? | Nome tecnico nuovo (DB/JSON) | Stato | Note |
|---|---|---|---|---|---|---|
| 39 | Posta (flag spedizione) | Posta | No | `bandi.sped_posta` | MISSING | Colonna DB esiste (`TEXT`→boolean). |
| 40 | Corriere (flag spedizione) | Corriere | No | `bandi.sped_corriere` | MISSING | Colonna DB esiste (`TEXT`→boolean). |
| 41 | A mano (flag spedizione) | AMano | No | `bandi.sped_mano` | MISSING | Colonna DB esiste (`TEXT`→boolean). |
| 42 | Annullato (flag) | Annullato | Parziale | `bandi.annullato` | MISSING | Chip "ANNULLATO" visibile nel form se `annullato=true`, ma manca toggle/checkbox per impostare o rimuovere lo stato. Backend PUT accetta `annullato`. |
| 43 | Soglia di riferimento (numero) | SogliaDiRiferimento | Si | `b.soglia_riferimento` / `bandi.soglia_riferimento` | OK | Editabile in entrambi. Label: "Soglia riferimento". |

### Riga 9 — Azienda dedicata e link

| # | Campo vecchio (label UI) | Nome tecnico vecchio (ipotesi) | Presente nel nuovo? | Nome tecnico nuovo (DB/JSON) | Stato | Note |
|---|---|---|---|---|---|---|
| 44 | AZIENDA PER CUI CREARE IL BANDO (autocomplete) | AziendaDedicata | No | Nessuna colonna DB corrispondente | FORSE_OBSOLETO | Vedi sezione 4. |
| 45 | Indirizzo elaborati (URL) | IndirizzoElaborati | No | `bandi.indirizzo_elaborati` | MISSING | Colonna DB esiste (`TEXT`). URL dove scaricare i documenti di gara. |

---

## 3. MISSING: da decidere

### 3.1 Tipologia di bandi (#4)
- **Semantica:** tipo di procedura di gara (Procedura Aperta, Ristretta, Negoziata, Dialogo Competitivo, ecc.)
- **Tipo dato:** `INTEGER` FK → `tipologia_bandi.id` (tabella gia esistente con 6 valori seed)
- **Dove va nel form nuovo:** card "Piattaforma e tipologia" — aggiungere dropdown `<select>` con opzioni da `/api/lookups/tipologie-bandi`
- **Migration necessaria:** NESSUNA — colonna `id_tipologia_bando` gia presente in `bandi`
- **Impatto su altre feature:** rilevante per filtri newsletter, AI autocompila, statistiche per procedura
- **Raccomandazione:** **Aggiungere** — campo fondamentale per la classificazione delle gare

### 3.2 Criteri di aggiudicazione — dropdown editabile (#5)
- **Semantica:** criterio con cui viene aggiudicata la gara (Prezzo piu basso, OEPV, Costo fisso, ecc.)
- **Tipo dato:** `INTEGER` FK → `criteri.id` (tabella gia esistente con 24 formule di calcolo)
- **Dove va nel form nuovo:** card "Piattaforma e tipologia" — sostituire il testo read-only con `<select>` alimentato da `/api/lookups/criteri`
- **Migration necessaria:** NESSUNA — colonna `id_criterio` gia presente
- **Impatto su altre feature:** il criterio e usato dal motore di calcolo esiti (simulazioni-engine.js)
- **Raccomandazione:** **Aggiungere** — senza questo dropdown non si puo impostare il criterio da form

### 3.3 Max invitati (#6)
- **Semantica:** numero massimo di imprese invitabili nelle procedure negoziate
- **Tipo dato:** `INTEGER DEFAULT 0` — gia in `bandi.max_invitati_negoziate`
- **Dove va nel form nuovo:** card "Piattaforma e tipologia" — campo numerico, visibile condizionalmente se procedura e negoziata
- **Migration necessaria:** NESSUNA
- **Impatto su altre feature:** parametro per le procedure negoziate
- **Raccomandazione:** **Aggiungere** — rilevante solo per negoziate, mostrare condizionalmente

### 3.4 N. decimali (#7)
- **Semantica:** precisione decimale per arrotondamento ribassi nel calcolo esito
- **Tipo dato:** `SMALLINT DEFAULT 3` — gia in `bandi.n_decimali`
- **Dove va nel form nuovo:** card "Piattaforma e tipologia" — input numerico
- **Migration necessaria:** NESSUNA
- **Impatto su altre feature:** parametro critico per il motore di calcolo esiti (simulazioni-engine)
- **Raccomandazione:** **Aggiungere** — senza questo campo il calcolo esiti usa sempre default 3

### 3.5 Accorpa ali (#8) e Accorpa ribassi ali (#9)
- **Semantica:** parametri per il trattamento delle Ali (categorie SOA secondarie) nel calcolo ribasso complessivo. "Accorpa ali" attiva il raggruppamento; "Accorpa ribassi ali" definisce la modalita (Si tutti, No, Solo prevalente)
- **Tipo dato:** `BOOLEAN DEFAULT false` (accorpa_ali) + `INTEGER` (tipo_accorpa_ali) — entrambi gia in DB
- **Dove va nel form nuovo:** card "Piattaforma e tipologia" — checkbox + dropdown condizionale
- **Migration necessaria:** NESSUNA
- **Impatto su altre feature:** parametri calcolo esiti
- **Raccomandazione:** **Aggiungere** — parametri tecnici, possono essere in una sotto-sezione "Parametri calcolo"

### 3.6 SOA Prevalente — dropdown editabile (#10)
- **Semantica:** categoria SOA prevalente della lavorazione (OG1-OG13, OS1-OS35)
- **Tipo dato:** `INTEGER` FK → `soa.id` (65 valori) — gia in `bandi.id_soa`
- **Dove va nel form nuovo:** card "Anagrafica" — sostituire testo read-only con `<select>` alimentato da `/api/lookups/soa`
- **Migration necessaria:** NESSUNA
- **Impatto su altre feature:** classificazione SOA usata per filtri newsletter, matching albi fornitori, AI
- **Raccomandazione:** **Aggiungere** — campo fondamentale

### 3.7 Attestazione / Livello SOA (#11)
- **Semantica:** livello di qualificazione SOA (I-VIII), ciascuno con fascia di importo (es. IV = fino a 2.582.000 EUR)
- **Tipo dato:** `INTEGER` — gia in `bandi.soa_val`
- **Dove va nel form nuovo:** card "Anagrafica" — dropdown con livelli I-VIII, visibile dopo selezione SOA
- **Migration necessaria:** NESSUNA
- **Impatto su altre feature:** usato per filtrare bandi per livello di qualificazione
- **Raccomandazione:** **Aggiungere** — accoppiato con SOA Prevalente

### 3.8 Importo SOA prevalente (#12)
- **Semantica:** importo specifico riferito alla sola categoria SOA prevalente (distinto dall'importo complessivo)
- **Tipo dato:** `NUMERIC` — gia in `bandi.importo_soa_prevalente`
- **Dove va nel form nuovo:** card "Importi" — campo numerico
- **Migration necessaria:** NESSUNA
- **Impatto su altre feature:** calcolo graduatorie, filtri per importo specifico SOA
- **Raccomandazione:** **Aggiungere**

### 3.9 Categoria presunta (#13)
- **Semantica:** flag che indica se la classificazione SOA e stata dedotta (non verificata da documentazione ufficiale)
- **Tipo dato:** `BOOLEAN DEFAULT false` — gia in `bandi.categoria_presunta`
- **Dove va nel form nuovo:** card "Anagrafica" — checkbox accanto a SOA Prevalente
- **Migration necessaria:** NESSUNA
- **Impatto su altre feature:** indicatore di qualita dato per AI e operatori
- **Raccomandazione:** **Aggiungere**

### 3.10 Sostitutiva prevalente (#14)
- **Semantica:** categoria SOA che puo sostituire la prevalente (es. OS30 sostitutiva di OG11)
- **Tipo dato:** `INTEGER` FK → `soa.id` — gia in `bandi.categoria_sostitutiva`
- **Dove va nel form nuovo:** card "Anagrafica" — dropdown SOA condizionale
- **Migration necessaria:** NESSUNA
- **Impatto su altre feature:** matching qualificazione imprese
- **Raccomandazione:** **Aggiungere** — dropdown SOA secondario

### 3.11 Limite di esclusione (#15)
- **Semantica:** soglia percentuale per l'esclusione automatica delle offerte anomale (art. 97 d.lgs. 50/2016)
- **Tipo dato:** `SMALLINT` — gia in `bandi.limit_min_media`
- **Dove va nel form nuovo:** card "Piattaforma e tipologia" — input numerico
- **Migration necessaria:** NESSUNA
- **Impatto su altre feature:** parametro critico per il motore di calcolo esiti
- **Raccomandazione:** **Aggiungere**

### 3.12 Visibilita — toggle editabili (#16)
- **Semantica:** stato di visibilita/pubblicazione del bando. Nel vecchio: Pubblico/Privato/Doppiato/Rettificato come dropdown unico
- **Tipo dato:** `bandi.privato` (INT: 0=pubblico, 1+=privato), `bandi.rettificato` (BOOL), `bandi.annullato` (BOOL) — tutte gia presenti
- **Dove va nel form nuovo:** card "Anagrafica" — 3 toggle/checkbox separati per privato, rettificato, annullato. Oppure un dropdown unificato come nel vecchio.
- **Migration necessaria:** NESSUNA
- **Impatto su altre feature:** filtraggio bandi per visibilita, newsletter (bandi privati esclusi)
- **Raccomandazione:** **Aggiungere** — almeno toggle per annullato e privato

### 3.13 Indirizzo, Cap cantiere (#23, #24)
- **Semantica:** indirizzo fisico del cantiere/luogo di esecuzione dell'appalto
- **Tipo dato:** `TEXT` (indirizzo) + `VARCHAR` (cap) — gia in DB
- **Dove va nel form nuovo:** nuova card "Localizzazione cantiere" oppure in Anagrafica
- **Migration necessaria:** NESSUNA
- **Impatto su altre feature:** geolocalizzazione sopralluoghi, mappa sopralluoghi
- **Raccomandazione:** **Aggiungere** — utili per sopralluoghi e logistica

### 3.14 Tipo dati dell'esito (#30)
- **Semantica:** classifica il tipo di informazioni disponibili sull'esito della gara (Completa, Solo vincitore, Solo N partecipanti, Gara non conclusa, Non assegnato)
- **Tipo dato:** `INTEGER` — gia in `bandi.tipo_dati_esito`. Lookup: `tipo_dati_gara`
- **Dove va nel form nuovo:** card "Piattaforma e tipologia" — dropdown
- **Migration necessaria:** NESSUNA
- **Impatto su altre feature:** pre-classifica la qualita dei dati esito prima della conversione bando→esito
- **Raccomandazione:** **Aggiungere**

### 3.15 Telematica (#31)
- **Semantica:** flag che indica se l'offerta deve essere inviata telematicamente
- **Tipo dato:** `TEXT`→boolean — gia in `bandi.sped_telematica`
- **Dove va nel form nuovo:** nuova card "Spedizione" oppure in "Piattaforma e tipologia"
- **Migration necessaria:** NESSUNA
- **Impatto su altre feature:** complementare a "Piattaforma Digitale"
- **Raccomandazione:** **Aggiungere** — strettamente collegato alla piattaforma

### 3.16 Piattaforma Digitale — dropdown editabile (#32)
- **Semantica:** piattaforma e-procurement su cui e pubblicata la gara (MePA, SINTEL, TuttoGare, ecc.)
- **Tipo dato:** `INTEGER` FK → `piattaforme.id` — gia in `bandi.id_piattaforma`
- **Dove va nel form nuovo:** card "Piattaforma e tipologia" — sostituire testo read-only con `<select>` alimentato da `/api/lookups/piattaforme`
- **Migration necessaria:** NESSUNA
- **Impatto su altre feature:** filtraggio per piattaforma, statistiche
- **Raccomandazione:** **Aggiungere**

### 3.17 Sezione Sopralluogo completa (#33-#38)

#### Tipo Sopralluogo (#33)
- **Semantica:** classificazione del tipo di sopralluogo richiesto (obbligatorio, facoltativo, da verificare, non richiesto)
- **Tipo dato:** `INTEGER DEFAULT 0` — gia in `bandi.id_tipo_sopralluogo`. **NOTA:** tabella lookup `tipo_sopralluogo` NON ESISTE nel DB. Servira crearla.
- **Dove va nel form nuovo:** nuova card "Sopralluogo"
- **Migration necessaria:** `CREATE TABLE tipo_sopralluogo (id SERIAL, nome VARCHAR(100), attivo BOOLEAN DEFAULT true)` + seed valori
- **Raccomandazione:** **Aggiungere** — creare prima la lookup table

#### Note per Sopralluogo (#34)
- **Tipo dato:** `TEXT` — gia in `bandi.note_per_sopralluogo`
- **Dove va nel form nuovo:** card "Sopralluogo" — textarea
- **Migration necessaria:** NESSUNA
- **Raccomandazione:** **Aggiungere**

#### Termine prenotazione (#35)
- **Tipo dato:** `TIMESTAMPTZ` — gia in `bandi.data_max_per_prenotazione`
- **Dove va nel form nuovo:** card "Sopralluogo" — input date
- **Migration necessaria:** NESSUNA
- **Raccomandazione:** **Aggiungere**

#### Termine sopralluogo (#36)
- **Tipo dato:** `TIMESTAMPTZ` — gia in `bandi.data_max_per_sopralluogo`
- **Dove va nel form nuovo:** card "Sopralluogo" — input date
- **Migration necessaria:** NESSUNA
- **Raccomandazione:** **Aggiungere**

#### PEC spedizione (#37) e Indirizzo PEC (#38)
- **Tipo dato:** `TEXT`→boolean (sped_pec) + `TEXT` (indirizzo_pec) — gia in DB
- **Dove va nel form nuovo:** card "Sopralluogo" o card "Spedizione" — checkbox + testo condizionale
- **Migration necessaria:** NESSUNA
- **Raccomandazione:** **Aggiungere**

### 3.18 Sezione Spedizione (#39-#41)

#### Posta, Corriere, A mano
- **Semantica:** modalita di invio documenti/offerte (checkboxes multipli)
- **Tipo dato:** `TEXT`→boolean per ciascuno — gia in `bandi.sped_posta`, `sped_corriere`, `sped_mano`
- **Dove va nel form nuovo:** nuova card "Modalita di spedizione" — 5 checkbox (posta, corriere, mano, pec, telematica)
- **Migration necessaria:** NESSUNA
- **Impatto su altre feature:** nessuno diretto, campo informativo
- **Raccomandazione:** **Aggiungere** — raggruppare tutti i flag spedizione in una card unica

### 3.19 Annullato — toggle (#42)
- **Semantica:** flag che indica che il bando e stato annullato/revocato
- **Tipo dato:** `BOOLEAN DEFAULT false` — gia in `bandi.annullato`
- **Dove va nel form nuovo:** card "Anagrafica" — toggle/checkbox con conferma
- **Migration necessaria:** NESSUNA
- **Impatto su altre feature:** bandi annullati esclusi da newsletter, filtri, statistiche
- **Raccomandazione:** **Aggiungere** — operazione frequente, serve un toggle esplicito

### 3.20 Indirizzo elaborati (#45)
- **Semantica:** URL per scaricare documentazione di gara (disciplinare, allegati tecnici, ecc.)
- **Tipo dato:** `TEXT` — gia in `bandi.indirizzo_elaborati`
- **Dove va nel form nuovo:** card "Piattaforma e tipologia" — input URL
- **Migration necessaria:** NESSUNA
- **Impatto su altre feature:** link diretto alla documentazione, utile per operatori e AI
- **Raccomandazione:** **Aggiungere**

---

## 4. FORSE_OBSOLETO: chiedere a Edoardo

### 4.1 FORZA data di modifica (#29)
- **Perche sospetto sia obsoleto:** nel vecchio ASP.NET, `data_modifica` non si aggiornava automaticamente — serviva un flag "FORZA" per override manuale. Nel nuovo sistema PostgreSQL, il trigger `updated_at = NOW()` gestisce automaticamente il timestamp di modifica. Il campo `data_modifica` esiste ancora nel DB ma viene aggiornato dal backend PUT (`data_modifica = NOW()`).
- **Dove potrebbe essere stato spostato:** nessun spostamento, la funzionalita e coperta dal trigger automatico
- **Cosa chiedere a Edoardo:** "C'e ancora un caso d'uso per forzare manualmente la data di modifica? Es. import bulk dove vuoi preservare la data originale? Oppure possiamo considerare questo campo coperto da `updated_at`?"

### 4.2 AZIENDA PER CUI CREARE IL BANDO (#44)
- **Perche sospetto sia obsoleto:** nel DB attuale non esiste una colonna tipo `id_azienda_dedicata` nella tabella `bandi`. Il vecchio form aveva un autocomplete per associare un bando a un'azienda specifica (probabilmente per gestire bandi "privati" dedicati a un singolo cliente). Nel nuovo sistema, il concetto di bando privato e gestito diversamente (`privato` + `privato_username`).
- **Dove potrebbe essere stato spostato:** la colonna `privato_username` (VARCHAR) potrebbe essere il sostituto parziale — identifica l'utente a cui e dedicato il bando. Ma non e una FK a `aziende`, e un username.
- **Cosa chiedere a Edoardo:** "Il campo 'Azienda dedicata' serviva per associare un bando a un cliente specifico? E sostituito da `privato_username`? Oppure serve ancora una FK a `aziende` per collegare bando→cliente?"

---

## 5. Nuovo ha, vecchio no

Campi presenti SOLO nel nuovo form (non nello screenshot del vecchio):

### 5.1 Codice CUP (`bandi.codice_cup`)
- **Dove introdotto:** migration 001 (`codice_cup VARCHAR(20)`)
- **Semantica:** Codice Unico di Progetto — identificativo complementare al CIG, obbligatorio per opere pubbliche
- **Wired end-to-end:** Si — editabile in form, salvato via PUT, indicizzato (`idx_bandi_cup`)
- **Nota:** nel vecchio sistema probabilmente gestito ma non visibile nel form screenshot

### 5.2 Apertura posticipata (`bandi.data_apertura_posticipata`)
- **Dove introdotto:** migration 001
- **Semantica:** data di apertura buste posticipata rispetto all'originale. Gestita anche dall'azione "Posticipa Scadenza" del form
- **Wired end-to-end:** Si — editabile, azione dedicata con modal, backend endpoint `/bandi/:id/posticipa`

### 5.3 Link bando (`b.link_bando`)
- **Dove introdotto:** **COLONNA DB NON ESISTE** (vedi Scoperte collaterali)
- **Semantica:** URL diretto al bando sulla piattaforma di pubblicazione
- **Wired end-to-end:** **NO** — il form lo renderizza e lo include nel payload di salvataggio, ma la colonna non esiste. Il PUT silenziosamente non lo salva (se e nel whitelist ma non in DB, il SQL dinamico lo ignora o fallisce). **Questo e un bug.**

### 5.4 Tipologia gara (`b.tipologia_gare_nome`)
- **Dove introdotto:** join su `tipologia_gare` via `bandi.id_tipologia` (migration 001)
- **Semantica:** tipo di CONTRATTO (Lavori Pubblici, Servizi, Forniture, Mista, Concessione). Diverso da "Tipologia di bandi" del vecchio (#4) che era il tipo di PROCEDURA
- **Wired end-to-end:** Parziale — visibile come testo read-only, ma manca dropdown editabile nel form. La colonna `id_tipologia` esiste ed e nel PUT whitelist

### 5.5 Campi metadata/audit
- `b.fonte_dati` — fonte di importazione (manuale, presidia, maggioli, ai)
- `b.created_at`, `b.updated_at` — timestamp di audit automatici
- Nessuno di questi era visibile nel vecchio form screenshot

### 5.6 Campi AI (non nel form, solo in DB)
- `ai_processed`, `ai_confidence`, `ai_extracted_data`, `ai_processed_at` — pipeline AI autocompila
- `in_lavorazione` — flag "in lavorazione" per workflow
- `id_fonte_web` — FK a fonti web per scraping
- Questi non sono nel form ma sono usati dal backend

---

## 6. Piano d'attacco Fase B

### 6.1 ALTER TABLE su `bandi`
**ZERO.** Tutte le 25 colonne MISSING esistono gia nel DB. Unica eccezione:
- `CREATE TABLE tipo_sopralluogo` — lookup table mancante per `id_tipo_sopralluogo`
- `ALTER TABLE bandi ADD COLUMN link_bando TEXT` — se Edoardo conferma che serve (vedi domanda #6)

### 6.2 Nuovi campi nel form HTML (`bando-pagina.html`)

| Card | Campi da aggiungere | Tipo |
|------|---------------------|------|
| **Anagrafica** | SOA Prevalente (dropdown), Attestazione (dropdown), Categoria presunta (checkbox), Sostitutiva prev. (dropdown), Privato (toggle), Annullato (toggle), Rettificato (toggle) | 7 campi |
| **Date e scadenze** | (nessuno — gia completa) | — |
| **Importi** | Importo SOA prevalente (number) | 1 campo |
| **Piattaforma e tipologia** | Tipologia bandi/procedura (dropdown), Criteri (dropdown→select), Piattaforma (dropdown→select), Tipologia gara (dropdown→select), Max invitati (number cond.), N decimali (number), Accorpa ali (checkbox), Tipo accorpa ali (dropdown cond.), Limite esclusione (number), Tipo dati esito (dropdown), Indirizzo elaborati (URL) | 11 campi |
| **Sopralluogo** (nuova) | Tipo sopralluogo (dropdown), Note sopralluogo (textarea), Termine prenotazione (date), Termine sopralluogo (date) | 4 campi |
| **Spedizione** (nuova) | Telematica (checkbox), PEC (checkbox), Indirizzo PEC (text cond.), Posta (checkbox), Corriere (checkbox), A mano (checkbox) | 6 campi |
| **Localizzazione cantiere** (nuova) | Indirizzo (text), Cap (text), Citta cantiere (text) | 3 campi |
| **Totale** | | **32 campi** |

### 6.3 Endpoint backend da modificare

| Endpoint | Modifica |
|----------|----------|
| `PUT /api/bandi/:id` | Gia accetta tutti i campi MISSING nel whitelist. **Nessuna modifica necessaria.** |
| `GET /api/bandi/:id` | Usa `SELECT b.*` — gia ritorna tutti i campi. Aggiungere JOIN per `tipo_sopralluogo` se si crea la lookup. |
| `POST /api/bandi/` | Verificare che i nuovi campi editabili siano nel whitelist di inserimento. |
| `GET /api/lookups/*` | Gia espone tutte le lookup necessarie. Aggiungere endpoint `GET /api/lookups/tipo-sopralluogo` se si crea la tabella. |

### 6.4 Migrations da scrivere

1. `028_tipo_sopralluogo.sql` — `CREATE TABLE tipo_sopralluogo` + seed (Obbligatorio, Facoltativo, Da verificare, Non richiesto)
2. `029_bandi_link_bando.sql` — `ALTER TABLE bandi ADD COLUMN link_bando TEXT` (se confermato)
3. Nessuna altra migration necessaria

### 6.5 Stima effort

| Task | Effort |
|------|--------|
| Render 32 campi nel form (HTML/JS) | 1.5 giorni CC |
| Nuova card Sopralluogo + card Spedizione + card Localizzazione | 0.5 giorni CC |
| Dropdown con fetch lookup (5 dropdown) | 0.5 giorni CC |
| Fix bug link_bando/id_esito | 0.5 giorni CC |
| Migration tipo_sopralluogo + seed | 0.25 giorni CC |
| Test e validazione | 0.5 giorni CC |
| **Totale** | **~3.5 giorni CC** |

### 6.6 Rischio di regressioni su API esistenti

**Basso.** Motivazioni:
- Il backend PUT gia accetta tutti i campi nel whitelist — nessuna modifica al routing
- Il GET usa `SELECT b.*` — nessun campo aggiuntivo da joinare (tranne tipo_sopralluogo)
- Le lookup sono gia esposte dagli endpoint `/api/lookups/*`
- Le modifiche sono tutte nel form frontend (bando-pagina.html)
- **Unico rischio:** il fix di `link_bando` richiede ALTER TABLE. Se ci sono payload salvati che includono `link_bando`, il PUT potrebbe star silenziosamente scartando quel campo (da verificare)

---

## 7. Aperte (domande esplicite a Edoardo)

1. **Tipologia di bandi vs Tipologia gara:** il vecchio form mostrava la tipologia PROCEDURALE (Procedura Aperta, Ristretta, ecc. → `id_tipologia_bando`). Il nuovo mostra la tipologia CONTRATTUALE (Lavori, Servizi, Forniture → `id_tipologia`). Servono ENTRAMBI i dropdown nel nuovo form? O basta uno?

2. **Province multi-tag:** nel vecchio form le Province erano un multi-tag editabile (un bando poteva riguardare piu province). Nel nuovo, la provincia viene dalla stazione appaltante (join). Il bando puo coprire piu province? Serve un multi-tag o basta la provincia della stazione?

3. **"Doppiato" in Visibilita:** il vecchio dropdown aveva l'opzione "Doppiato". Cosa significava? Non c'e una colonna `doppiato` nel DB. Era uno stato di workflow? E stato eliminato intenzionalmente?

4. **FORZA data di modifica:** c'e ancora un caso d'uso per forzare manualmente il timestamp di modifica? O e coperto da `updated_at` automatico?

5. **AZIENDA PER CUI CREARE IL BANDO:** questo campo serviva per collegare un bando a un'azienda/cliente specifico? E sostituito da `privato_username`? Serve una FK a `aziende`?

6. **link_bando:** il form renderizza `b.link_bando` come campo editabile, ma la colonna NON ESISTE nel DB. Cosa doveva contenere? Creare la colonna (`ALTER TABLE bandi ADD COLUMN link_bando TEXT`)? O rimuovere il campo dal form?

7. **id_esito:** il backend PUT whitelist include `id_esito`, ma questa colonna NON ESISTE nel DB. Era prevista una FK `bandi.id_esito → gare.id` per collegare bando→esito direttamente? Attualmente il collegamento avviene via CIG. Creare la colonna o rimuovere dal whitelist?

8. **tipo_sopralluogo lookup:** `bandi.id_tipo_sopralluogo` esiste come colonna (INTEGER DEFAULT 0) ma la tabella lookup `tipo_sopralluogo` non esiste. Quali valori deve contenere? Proposta: 0=Non specificato, 1=Obbligatorio, 2=Facoltativo, 3=Non richiesto, 4=Da verificare.

9. **sped_* come TEXT→boolean:** le colonne spedizione (`sped_pec`, `sped_posta`, `sped_corriere`, `sped_mano`, `sped_telematica`) sono tutte `TEXT` con default `'false'` (stringa, non boolean). Convertire in `BOOLEAN` in Fase B? O lasciare per backwards compatibility?

10. **Importo SOA sostitutiva:** la colonna `bandi.importo_soa_sostitutiva` esiste nel DB ma non era nello screenshot del vecchio form. E un campo nuovo aggiunto durante la migrazione? Va nel form?

---

## Scoperte collaterali

### Bug: `link_bando` phantom field
Il form `bando-pagina.html` (riga 772) renderizza `b.link_bando` come campo editabile con `name: 'link_bando'`. Il backend PUT (`bandi.js`) include `link_bando` nel whitelist di campi accettati. **Ma la colonna `link_bando` non esiste nella tabella `bandi`.** Il campo viene incluso nel payload di salvataggio ma il SQL UPDATE lo scarta silenziosamente (il backend costruisce il SET dinamicamente e include solo campi presenti nel payload che sono nel whitelist — se la colonna non esiste, il query potrebbe fallire con errore PostgreSQL). Da verificare il comportamento esatto e decidere: creare la colonna o rimuovere il campo.

### Bug: `id_esito` phantom column in PUT whitelist
Il backend PUT (`bandi.js`) include `id_esito` nel whitelist di campi aggiornabili. **Ma la colonna `id_esito` non esiste nella tabella `bandi`.** Il collegamento bando→esito attualmente avviene via matching CIG tramite la funzione "Converti in Esito". Se si vuole una FK diretta, serve `ALTER TABLE bandi ADD COLUMN id_esito UUID REFERENCES gare(id)`.

### Nota: ambiguita semantica "Citta stazione" vs "Citta cantiere"
Il form nuovo mostra "Citta stazione" (`b.stazione_citta || b.citta`). Il fallback su `b.citta` e fuorviante perche `bandi.citta` nel vecchio form indicava la citta del CANTIERE, non della stazione. Suggerimento: separare i due concetti nel form con label distinte.

### Nota: campi `sped_*` sono TEXT non BOOLEAN
Le 5 colonne spedizione usano `TEXT` con default `'false'` (stringa). Probabilmente eredita dallo schema C# legacy dove i boolean erano stringhe. Funziona ma e incoerente con gli altri flag boolean del DB (`annullato`, `accorpa_ali`, `categoria_presunta`).
