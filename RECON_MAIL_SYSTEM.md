# RECON MAIL SYSTEM — EasyWin

Data: 2026-04-14
Branch: main
Scope: read-only, zero commit

---

## Sezione 1 — Infrastruttura SMTP esistente

### 1.1 getMailTransporter() — 5 implementazioni indipendenti

| # | File | Pattern | Default host | Usato da |
|---|------|---------|--------------|----------|
| 1 | `backend/src/routes/newsletter.js:7-33` | singleton async (`getMailTransporter()`) | `localhost` | POST /auto, /auto/anteprima, /invia, GET /log (6 call site) |
| 2 | `backend/src/routes/admin-dashboard.js:6-29` | singleton async (COPIA IDENTICA di #1) | `localhost` | POST /newsletter/invia-bandi, /newsletter/invia-esiti |
| 3 | `backend/src/services/email-service.js:7-15` | module-level `const transporter` | `smtp.gmail.com` | `sendEsitoNotifications()`, `sendEmail()` |
| 4 | `backend/src/services/bandi-alerts.js:17-25` | module-level `const transporter` | `smtp.gmail.com` | alert aperture, sopralluoghi, esiti |
| 5 | `backend/src/services/abbonamenti-scheduler.js:33-48` | lazy init (`initMailer()`) | `smtp.easywin.it` | reminder scadenze, renewal |

**Libreria:** nodemailer (tutte e 5).
**Auth:** user/pass (`SMTP_USER` / `SMTP_PASS`). Nessun OAuth.
**Pool/retry/rate-limit:** newsletter.js supporta `SMTP_POOL` (JSON env var) per connection pooling. Gli altri 4 non hanno alcun pool, retry, o rate-limit.
**From default:** `process.env.SMTP_FROM || '"EasyWin" <noreply@easywin.it>'` (varia leggermente tra i file).

**Found:** 5 transporter indipendenti con 3 default host diversi (`localhost`, `smtp.gmail.com`, `smtp.easywin.it`).
**Missing:** Nessun transporter centralizzato. Nessun rate-limiting. Nessun retry (tranne presidia-scheduler per import, non per mail).
**Notes:** L'unificazione in un singolo modulo `mail-transport.js` è prerequisito per qualsiasi lavoro futuro. Il default `smtp.gmail.com` in email-service.js e bandi-alerts.js è sbagliato per Aruba.

### 1.2 Variabili ENV SMTP

Da `backend/.env` (tutte commentate):
```
SMTP_HOST       # default varia per file (vedi sopra)
SMTP_PORT       # default 587
SMTP_SECURE     # default false
SMTP_USER       # auth user
SMTP_PASS       # auth password
SMTP_FROM       # mittente (default noreply@easywin.it)
SMTP_POOL       # JSON config opzionale per connection pool (solo newsletter.js)
```

Env aggiuntive usate nei template:
```
ADMIN_EMAIL          # default admin@easywin.it
SITE_URL             # link nelle email
FRONTEND_URL         # link nelle email (usato come alias di SITE_URL)
LOGO_URL             # logo email (fallback: base64 inline da logo.png)
HERO_BG_URL          # hero background email
NEWSLETTER_SEND_HOUR # ora invio newsletter (default 4)
NEWSLETTER_SEND_MINUTE # minuto invio newsletter (default 30)
NEWSLETTER_AUTO      # flag attivazione scheduler (true/false)
ABBONAMENTI_SEND_HOUR  # ora scheduler abbonamenti (default 6)
ABBONAMENTI_SEND_MINUTE # minuto (default 0)
ABBONAMENTI_SCHEDULER   # flag attivazione (true/false)
```

**Found:** .env con variabili SMTP commentate. Nessun `.env.example` dedicato.
**Missing:** Nessuna documentazione dei rate limit Aruba. Nessuna variabile per rate-limit o batch size.

### 1.3 Pattern di invio usato oggi

```
// Pseudo-codice: pattern comune a tutti i 5 transporter
const transporter = await getMailTransporter();  // o modulo-level const

for (const recipient of recipients) {
  try {
    await transporter.sendMail({ from, to, subject, html });
    sent_count++;
  } catch (err) {
    console.error(`Errore per ${recipient.email}:`, err.message);
    failed_count++;
    // NO retry, NO backoff, NO delay tra invii
  }
}

// Log su DB (newsletter_invii) solo in newsletter.js
// admin-dashboard.js logga su newsletter_storico (TABELLA INESISTENTE — BUG)
```

**Found:** Loop sequenziale sincrono, fire-and-forget per errori, nessun throttle.
**Missing:** Retry, backoff, delay inter-messaggio, queue.
**Notes:** Con Aruba shared, il loop senza delay rischia throttling/ban. Serve almeno un delay 100-200ms tra invii.

---

## Sezione 2 — Tabelle DB rilevanti

### 2.1 Tabella `newsletter_invii`

**Creata in:** migration 006 (`006_additional_features.sql:288-301`), ri-dichiarata in 020 (`020_tasks_newsletter.sql:25-39`).

```sql
CREATE TABLE IF NOT EXISTS newsletter_invii (
    id             SERIAL PRIMARY KEY,
    tipo           VARCHAR(20) NOT NULL,       -- 'bandi', 'esiti', 'custom'
    oggetto        VARCHAR(500),
    testo          TEXT,
    data_invio     TIMESTAMPTZ DEFAULT NOW(),
    destinatari    INT DEFAULT 0,
    inviati        INT DEFAULT 0,
    falliti        INT DEFAULT 0,
    username_invio VARCHAR(200),
    data_da        DATE,                        -- aggiunta in 020
    data_a         DATE,                        -- aggiunta in 020
    note           TEXT                          -- aggiunta in 020
);
-- Indici: idx_newsletter_invii_data (data_invio DESC), idx_newsletter_invii_tipo (tipo)
```

**Tabella log dettagliato** (`020_tasks_newsletter.sql:42-55`):
```sql
CREATE TABLE IF NOT EXISTS newsletter_invii_log (
    id        SERIAL PRIMARY KEY,
    id_invio  INTEGER REFERENCES newsletter_invii(id) ON DELETE CASCADE,
    username  VARCHAR(200),
    email     VARCHAR(300),
    tipo      VARCHAR(20),
    n_items   INTEGER DEFAULT 0,
    status    VARCHAR(20) DEFAULT 'ok',
    errore    TEXT,
    data_invio TIMESTAMPTZ DEFAULT NOW()
);
```

**Tabella `tasks`** (`020_tasks_newsletter.sql:5-17`):
```sql
CREATE TABLE IF NOT EXISTS tasks (
    id                          SERIAL PRIMARY KEY,
    tipo                        VARCHAR(100) NOT NULL UNIQUE,
    nome                        VARCHAR(200),
    attivo                      BOOLEAN DEFAULT true,
    ora_invio                   VARCHAR(5) DEFAULT '04:00',
    data_ultima_esecuzione      TIMESTAMPTZ,
    stato_ultima_esecuzione     VARCHAR(50),
    messaggio_ultima_esecuzione TEXT,
    prossima_esecuzione         TIMESTAMPTZ,
    created_at                  TIMESTAMPTZ DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ DEFAULT NOW()
);
-- Seed: INSERT tipo='newsletter_auto', attivo=false
```

**BUG CRITICO:** `admin-dashboard.js:493,559` inserisce in `newsletter_storico` — **tabella che non esiste in nessuna migration**. Questi endpoint crashano al momento del log.

**Found:** Schema completo con log per-utente. Tabella `tasks` per controllo scheduler.
**Missing:** `newsletter_storico` referenziata ma mai creata.

### 2.2 Dati abbonamenti utenti

**Tabella: `users`** — scadenza è multi-colonna direttamente su users, NON su tabella separata.

Colonne scadenza (tutte `DATE`):
| Colonna | Migration | Servizio |
|---------|-----------|----------|
| `data_scadenza` | 005 (line 622) | Legacy Esiti |
| `scadenza_esiti` | 022 (line 15) | Alias esplicito Esiti |
| `scadenza_bandi` | 014 (line 27) | Bandi |
| `scadenza_esiti_light` | 014 (line 28) | Esiti Light |
| `scadenza_newsletter_esiti` | 014 (line 29) | Newsletter Esiti |
| `scadenza_newsletter_bandi` | 014 (line 30) | Newsletter Bandi |
| `scadenza_presidia` | 014 (line 69) | Presidia |
| `scadenza_albo_ai` | 022 (line 31) | Albo AI |

Colonne rinnovo:
| Colonna | Migration | Tipo |
|---------|-----------|------|
| `data_rinnovo` | 005 (line 625) | DATE |
| `rinnovo_automatico` | 005 (line 628) | BOOLEAN |
| `rinnovo_bandi` | 022 | BOOLEAN |
| `rinnovo_esiti` | 022 | BOOLEAN |
| `rinnovo_esiti_light` | 022 | BOOLEAN |
| `rinnovo_newsletter_esiti` | 022 | BOOLEAN |
| `rinnovo_newsletter_bandi` | 022 | BOOLEAN |

**`users_periodi`**: tabella storica con scadenze mirrors (migration 014:100-104, 022:64-76). Usata dal vecchio sistema per periodi di abbonamento.

**`abbonamenti-scheduler.js`** (428 righe): usa la matrice `SERVICES[]` per iterare tutti i servizi, controlla `scadField` e `rinField` per ogni utente, invia reminder a 30 e 7 giorni, auto-rinnova, disattiva.

**Found:** Scadenza multi-servizio su `users`, scheduler completo con 3 fasi.
**Missing:** Nessuna tabella separata storico rinnovi. Nessun audit trail dei cambiamenti.

### 2.3 Filtri personalizzazione utente (SOA/regioni/importi)

**Tabella: `utenti_filtri_bandi`** (migration 016):

```sql
CREATE TABLE IF NOT EXISTS utenti_filtri_bandi (
    id           SERIAL PRIMARY KEY,
    id_utente    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id_soa       INTEGER REFERENCES soa(id),        -- nullable = qualsiasi
    province_ids JSONB DEFAULT '[]',                 -- array di ID provincia
    importo_min  NUMERIC(15,2) DEFAULT 0,
    importo_max  NUMERIC(15,2) DEFAULT 0,
    descrizione  TEXT,
    attivo       BOOLEAN DEFAULT true,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);
```

**Semantica:** ogni utente ha N regole, matching in **OR** (basta una regola soddisfatta).
**Usata da:** `bandi-alerts.js:findMatchingUsers()` (line 51-117) e `newsletter.js` POST /auto.

**Found:** Schema e logica matching completi e funzionanti.
**Missing:** Nessun filtro equivalente per esiti (gli alert esiti vanno a TUTTI gli utenti con `newsletter_esiti=true`, senza filtro SOA/regione/importo).

### 2.4 Partecipanti gara (per mail civetta)

**Tabella: `dettaglio_gara`** (migration 002:163-217):

```sql
CREATE TABLE dettaglio_gara (
    id                SERIAL PRIMARY KEY,
    id_gara           INTEGER NOT NULL REFERENCES gare(id) ON DELETE CASCADE,
    id_azienda        INTEGER REFERENCES aziende(id),
    posizione         INTEGER,
    ribasso           DECIMAL(10,6),
    vincitrice        BOOLEAN DEFAULT false,
    anomala           BOOLEAN DEFAULT false,
    esclusa           BOOLEAN DEFAULT false,
    ragione_sociale   VARCHAR(500),      -- denormalizzato per aziende sconosciute
    punteggio_tecnico DECIMAL(10,4),     -- per OEPV
    punteggio_economico DECIMAL(10,4),
    punteggio_totale  DECIMAL(10,4),
    -- ... 5 aziende esecutrici ATI, note, timestamp
    UNIQUE(id_gara, variante, id_azienda)
);
```

**`email-service.js:sendEsitoNotifications()`** (line 20-126):
- Query `dettagliogara` con colonne PascalCase (`"Posizione"`, `"Ribasso"`, `"Vincitrice"`)
- Ma la tabella reale si chiama `dettaglio_gara` con colonne lowercase

**Found:** Tabella partecipanti esiste con schema completo. Funzione `sendEsitoNotifications()` pronta.
**Missing/BUG:** Naming mismatch `dettagliogara` (email-service.js) vs `dettaglio_gara` (migration). Possibile vista/alias non trovata, oppure funzione rotta.
**Notes:** L'email contiene dati sensibili (posizione, ribasso, vincitore). La funzione è completa ma potrebbe non funzionare con lo schema attuale.

### 2.5 Aperture / Sopralluoghi / Scritture

**`apertura_bandi`** (migration 001:327-352):
- Registrazione servizio "apertura buste" per un bando
- Colonne: `id_bando UUID`, `id_azienda INT`, `data TIMESTAMPTZ`, `indirizzo`, `prezzo`, `eseguito BOOLEAN`, `note`
- FK: `bandi(id)`, `aziende(id)`, `province(id)`

**`scrittura_bandi`** (migration 001:408-442):
- **"Scritture" = registrazioni di esame documentazione / preparazione offerta** per un bando
- Colonne: `id_bando UUID`, `id_azienda INT`, `prezzo`, `tipologia_spedizione`, `bollettino`, `cauzione`, `stato_sopralluogo INT`, `stato_passoe INT`, `eseguito BOOLEAN`
- Include stati di workflow: passoe, avcp, dare_cauzione, stato_m, stato_p

**`sopralluoghi`** (migration 007:1-174):
- Visite ispettive pre-gara (sopralluoghi sul luogo dei lavori)
- Schema completo con contatti, coordinate, documenti

**`bandi`** (migration 001) colonne correlate:
- `data_apertura TIMESTAMPTZ` — data apertura buste
- `data_apertura_posticipata TIMESTAMPTZ` — posticipo
- `data_apertura_da_destinarsi BOOLEAN`
- `data_max_per_sopralluogo TIMESTAMPTZ`
- `tipo_apertura_avviso VARCHAR(20)` (migration 012)

**Found:** 3 tabelle servizio complete con schema maturo. `scrittura_bandi` = preparazione offerta (non "scritture contrattuali").
**Missing:** Nessuna tabella "elaborati" collegata ad alert mail (tabella `elaborati_progettuali` esiste ma non ha trigger mail).

### 2.6 Volume utenti attivi

**NON TROVATO** — nessun accesso al DB mini-neon da questo ambiente.

Il codice in `abbonamenti-scheduler.js` carica `SELECT id, username, email, agente FROM users WHERE attivo = true` per iterare tutti gli utenti — suggerisce che il volume è gestibile in-memory (probabilmente < 10.000).

**Found:** Query pattern per utenti attivi.
**Missing:** Conteggio reale. Serve query su mini-neon o prod per dimensionare rate-limit Aruba.

---

## Sezione 3 — Scheduler / Cron orchestrator

### 3.1 Dipendenze scheduler

**Nessuna libreria cron installata.** `package.json` non contiene node-cron, bullmq, agenda, bree, o node-schedule.

Tutti i 4 scheduler usano **`setInterval` nativo** con check manuale dell'ora:
```js
setInterval(async () => {
  const now = new Date();
  if (now.getHours() < SEND_HOUR) return;       // non è ancora ora
  if (_lastRunDate === todayKey) return;          // già eseguito oggi
  _lastRunDate = todayKey;
  // ... esegui task
}, 5 * 60 * 1000);  // check ogni 5 min
```

**Found:** Pattern setInterval funzionante ma fragile.
**Missing:** Nessuna persistenza cross-restart (se il server riavvia prima dell'ora, il task viene rieseguito). `_lastRunDate` è solo in-memory.
**Notes:** `tasks` table in DB offre `data_ultima_esecuzione` ma non viene usata per idempotenza all'avvio — solo aggiornata dopo l'esecuzione. Solo `presidia-scheduler.js` ha idempotenza reale via DB (`presidia_import_runs.slot_key`).

### 3.2 Service scheduler committati

| Scheduler | Cosa fa | Avvio | Pattern | Log DB |
|-----------|---------|-------|---------|--------|
| `newsletter-scheduler.js` | Invio newsletter personalizzate + alert bandi | `startNewsletterScheduler(fastify)` in server.js | `setInterval(5min)`, ore 4:30 default | `tasks` table |
| `abbonamenti-scheduler.js` | Reminder 30/7gg + auto-renewal + disattivazione | `startAbbonamentoScheduler(fastify)` in server.js | `setInterval(5min)`, ore 6:00 default | `tasks` table |
| `bandi-alerts.js` | Alert aperture/sopralluoghi (3/1gg) + esiti today | Chiamato da newsletter-scheduler dopo invio | Funzione on-demand (`runAllAlerts()`) | Nessuno (solo console.log) |
| `presidia-scheduler.js` | Import SOAP da Presidia | `startPresidiaScheduler(fastify)` in server.js | `setInterval(1min)`, 13 slot/giorno + 04:00 | `presidia_import_runs` (idempotente) |
| `fonti-web-scheduler.js` | Scraping HTML fonti web | `startFontiWebScheduler(fastify)` in server.js | `setInterval(10min)` | No (non mail) |

**newsletter-scheduler.js — dettaglio critico:**
- Usa `fastify.inject()` per chiamare internamente `POST /api/admin/newsletter/auto`
- Genera un JWT admin interno con `fastify.jwt.sign({ username, is_admin: true, _internal: true })` (5min TTL)
- Dopo la newsletter, chiama `runAllAlerts()` da bandi-alerts.js

### 3.3 Registrazione in server.js

```
// Riga 56-59: import
import { startNewsletterScheduler } from './services/newsletter-scheduler.js';
import { startAbbonamentoScheduler } from './services/abbonamenti-scheduler.js';
import { startFontiWebScheduler } from './services/fonti-web-scheduler.js';
import { startPresidiaScheduler } from './services/presidia-scheduler.js';

// Riga 306-310: avvio nel blocco start()
startNewsletterScheduler(fastify);    // Newsletter personalizzata ore 4:30
startAbbonamentoScheduler(fastify);   // Gestione abbonamenti ore 6:00
startFontiWebScheduler(fastify);      // Sync fonti web ogni 10 min
startPresidiaScheduler(fastify);      // Import automatico Presidia (13 slot + riepilogo 04:00)
```

**Found:** 4 scheduler registrati direttamente nel bootstrap. Pattern uniforme.
**Missing:** Nessun modo di disabilitare/riavviare singoli scheduler a runtime (tranne `tasks.attivo` in DB per newsletter e abbonamenti).

---

## Sezione 4 — Template engine

### 4.1 email-templates.js

**File:** `backend/src/services/email-templates.js` (~900 righe)
**Pattern:** template literal HTML inline — nessuna libreria di templating.
**Design:** dark theme (bg #0F1923, gold #F5C518), font Comfortaa via Google Fonts, table-based layout per compatibilità email client.

**25 funzioni export:**

| Funzione | Parametri | Uso |
|----------|-----------|-----|
| `emailLayout(content, options)` | content HTML, {preheader, showUnsubscribe, unsubscribeUrl} | Wrapper principale |
| `goldBar()` | — | Separatore decorativo |
| `sectionTitle(title, subtitle)` | titolo, sottotitolo | Header sezione |
| `infoRow(label, value)` | chiave, valore | Riga key-value |
| `statCard(label, value, accent)` | label, numero, bool | Card statistica |
| `ctaButton(text, url, style)` | testo, URL, 'gold'\|'orange' | Pulsante CTA |
| `alertBox(text, type)` | testo, 'info'\|'warning'\|'success'\|'error' | Box colorato |
| `textBlock(html, options)` | HTML, {align} | Blocco testo |
| `spacer(height)` | px | Spazio verticale |
| `regionHeader(name)` | nome regione | Header raggruppamento |
| `newsletterItem(item, type)` | oggetto bando/esito, 'bandi'\|'esiti' | Item lista newsletter |
| `graduatoriaTable(graduatoria, currentPosition, isFull)` | array, int, bool | Tabella graduatoria |
| `buildEsitoNotificationEmail(gara, partecipante)` | dati gara, dati partecipante | Mail civetta completa |
| `buildParticipantEmail(gara, graduatoria, partecipante, isCliente)` | — | Mail partecipante con graduatoria |
| `buildNewsletterEmail(type, items, dateRange, noteAggiuntive)` | tipo, items, range date, note | Newsletter generica |
| `buildPasswordResetEmail(userName, resetLink)` | nome, link | Reset password |
| `buildContactFormEmail(contact)` | oggetto contatto | Form contatto |
| `buildScadenzaClienteEmail(user, daysLeft, scadenza)` | utente, giorni, data | Reminder scadenza per cliente |
| `buildScadenzaAdminEmail(scadenze)` | array scadenze | Riepilogo scadenze per admin |
| `buildImportAlertEmail(stats)` | statistiche import | Alert import completato |
| `buildApertureAlertEmail(aperture, destinatario, data)` | aperture, utente, data | Alert aperture del giorno |
| `buildSopralluoghiAlertEmail(sopralluoghi, destinatario, data)` | sopralluoghi, utente, data | Alert sopralluoghi del giorno |
| `buildEventNotificationEmail(tipo, details)` | 'posticipo'\|'assegnazione_apertura'\|'cambio_incaricato', dettagli | Notifica evento gara |
| `newsletterBandiPersonalizzata(user, bandi, regole)` | utente, bandi filtrati, regole matching | Newsletter bandi per-utente |
| `newsletterEsitiPersonalizzata(user, esiti, regole)` | utente, esiti filtrati, regole matching | Newsletter esiti per-utente |

### 4.2 Asset statici

- **Logo:** `logo.png` dalla root del progetto → convertito in **base64 data URI** inline (`data:image/png;base64,...`). Fallback: `process.env.LOGO_URL || 'https://easywin.it/assets/logo.png'`
- **Hero BG:** URL assoluto `https://www.easywin.it/application/themes/easywin/images/gare-di-appalto-italia.jpg`
- **Font:** Google Fonts `Comfortaa` via `@import url()` + `<link>` tag
- **Nessun CID attachment** — tutto inline o URL

**Found:** Sistema template maturo con 25 funzioni. Logo inline base64 è la scelta giusta per Aruba.
**Missing:** Nessun preview/test delle email. Nessun supporto dark mode per email client. Google Fonts potrebbe non caricarsi in tutti i client.

---

## Sezione 5 — Eventi gara (mail evento)

### Template pronti

`buildEventNotificationEmail(tipo, details)` in `email-templates.js:694-801` gestisce:

| tipo | Titolo | Contenuto |
|------|--------|-----------|
| `posticipo` | "Posticipo Seduta di Gara" | Alert warning con nuova data |
| `assegnazione_apertura` | "Assegnazione Apertura Buste" | Info con incaricato assegnato |
| `cambio_incaricato` | "Cambio Incaricato Apertura" | Info con nuovo incaricato |

### Trigger code

**NON TROVATO.** Non esiste alcun hook, event emitter, o chiamata post-update nei route handler che scateni l'invio di queste email.

I route handler per aperture/sopralluoghi (`bandi-servizi.js`) aggiornano i dati ma non emettono notifiche. Il template è pronto e inutilizzato.

**Found:** 3 template completi per eventi gara.
**Missing:** Tutto il wiring — serve: (a) identificare il trigger nel route handler, (b) determinare i destinatari, (c) chiamare il template + transporter. Completamente da costruire.

---

## Sezione 6 — Report finale

### Mappa completa dei flussi mail

```
                    ┌─────────────────────────┐
                    │     newsletter.js        │
                    │  getMailTransporter()    │──── POST /auto (personalizzata)
                    │  (singleton, SMTP_POOL)  │──── POST /auto/anteprima
                    │                         │──── POST /invia (custom broadcast)
                    │                         │──── GET /log
                    └─────────────────────────┘
                    ┌─────────────────────────┐
                    │   admin-dashboard.js     │
                    │  getMailTransporter()    │──── POST /newsletter/invia-bandi  ⚠️ SQL injection
                    │  (COPIA di newsletter)   │──── POST /newsletter/invia-esiti  ⚠️ SQL injection
                    │                         │     └── INSERT newsletter_storico  ⚠️ tabella inesistente
                    └─────────────────────────┘
                    ┌─────────────────────────┐
                    │    email-service.js      │
                    │  createTransport()       │──── sendEsitoNotifications()  ⚠️ naming mismatch
                    │  (module-level, gmail)   │──── sendEmail() (generico)
                    └─────────────────────────┘
                    ┌─────────────────────────┐
                    │    bandi-alerts.js       │
                    │  createTransport()       │──── runAperturaAlerts() (3/1 gg)
                    │  (module-level, gmail)   │──── runSopralluoghiAlerts() (3/1 gg)
                    │                         │──── runEsitiAlerts() (today)
                    └─────────────────────────┘
                    ┌─────────────────────────┐
                    │ abbonamenti-scheduler.js │
                    │  initMailer()            │──── sendReminderEmails() (30/7 gg)
                    │  (lazy, smtp.easywin.it) │──── processAutoRenewal()
                    │                         │──── processDeactivation()
                    └─────────────────────────┘
                    ┌─────────────────────────┐
                    │   email-templates.js     │
                    │  (25 funzioni export)    │──── Usato da: newsletter.js, bandi-alerts.js,
                    │  (nessun invio diretto)  │     abbonamenti-scheduler.js
                    │                         │──── NON usato da: email-service.js, admin-dashboard.js
                    └─────────────────────────┘

SCHEDULERS:
  newsletter-scheduler.js  ──setInterval(5min)──► POST /auto (via inject) + runAllAlerts()
  abbonamenti-scheduler.js ──setInterval(5min)──► reminder/renewal/deactivation diretto
  presidia-scheduler.js    ──setInterval(1min)──► import SOAP (mail solo su 3+ fail consecutivi)
  fonti-web-scheduler.js   ──setInterval(10min)─► scraping (no mail)
```

### Bug e problemi trovati

| # | Severità | Problema | File | Riga |
|---|----------|----------|------|------|
| 1 | **CRITICAL** | SQL injection in `invia-bandi`/`invia-esiti` (string interpolation di user input) | `admin-dashboard.js` | 451-534 |
| 2 | **HIGH** | `INSERT INTO newsletter_storico` — tabella non esiste in nessuna migration | `admin-dashboard.js` | 493, 559 |
| 3 | **HIGH** | 5 transporter indipendenti con 3 default host diversi | multipli | — |
| 4 | **MEDIUM** | `dettagliogara` con PascalCase vs `dettaglio_gara` lowercase — possibile query rotta | `email-service.js` | 39-47 |
| 5 | **MEDIUM** | Nessun rate-limit/delay tra invii — rischio ban Aruba | tutti | — |
| 6 | **LOW** | `_lastRunDate` solo in-memory — non sopravvive a restart | newsletter/abbonamenti scheduler | — |
| 7 | **LOW** | `sendAdminNewsletter()` FE chiama endpoint diversi (`invia-bandi`/`invia-esiti` su admin-dashboard) da quelli in newsletter.js — duplicazione funzionale | `admin/index.html:15264` | — |

---

### TOP-3 scoperte impattanti per il design

1. **5 transporter SMTP indipendenti con 3 default host diversi** — la prima azione di PR-MAIL-SYSTEM deve essere unificarli in un singolo modulo `mail-transport.js` con rate-limiting integrato. Senza questo, ogni nuova feature mail aggiunge un 6° transporter.

2. **SQL injection CRITICA in admin-dashboard.js** — gli endpoint `invia-bandi` e `invia-esiti` costruiscono query SQL con string interpolation di `filtro_regioni` e `filtro_soa`. Va fixata prima di qualsiasi lavoro sull'invio newsletter, indipendentemente da PR-MAIL-SYSTEM.

3. **Nessuna libreria cron — tutti scheduler sono setInterval puri** — funzionano ma non sopravvivono a restart (idempotenza solo in-memory, tranne presidia). Per il mail system completo serve almeno un meccanismo di idempotenza basato su DB per evitare double-send.

### TOP-3 unknown residui

1. **Volume utenti attivi** — non determinabile senza accesso a mini-neon o prod. Serve per dimensionare batch size e delay inter-messaggio con Aruba (tipico limit: 200-500 mail/ora su shared hosting).

2. **Rate limit effettivi Aruba SMTP** — nessuna documentazione nel repo. Serve contattare il provider o testare empiricamente (max connessioni, max messaggi/ora, max destinatari/messaggio).

3. **`dettagliogara` vs `dettaglio_gara`** — non chiaro se esiste una vista o un alias nel DB reale che mappa il nome vecchio (SQL Server) al nuovo (PostgreSQL). Se non esiste, `sendEsitoNotifications()` è completamente rotta e la mail civetta non funziona.
