# DESIGN_MAIL_SYSTEM — EasyWin

**Data**: 2026-04-14
**Branch base**: `main` (post PR-MAIL-0)
**Autore**: design session con Claude, approvato da Edoardo
**Prerequisiti letti**: `RECON_MAIL_SYSTEM.md`, memoria progetto (mail flows vecchio sito, newsletter filtri, provider decision)

---

## 0. Scope e obiettivi

Questo documento definisce l'architettura del sistema mail EasyWin dopo PR-MAIL-0 (security fix). Copre l'inventario di tutti i flussi mail del prodotto, la scelta dei componenti tecnici, lo schema DB unificato, e il breakdown in sub-PR eseguibili.

Il sistema mail attuale è frammentato in 5 transporter SMTP scollegati con 3 default host diversi, 2 endpoint duplicati tra `admin-dashboard.js` e `newsletter.js`, zero idempotenza scheduler (tranne Presidia), e tre template ("posticipo", "assegnazione_apertura", "cambio_incaricato") pronti ma senza alcun wiring. L'obiettivo di PR-MAIL-2 è portare tutti gli invii email sotto un'unica infrastruttura, migrare il provider da Aruba a Brevo, e completare i flussi operativi oggi mancanti.

**Non-obiettivi**: non rifacciamo il template engine (i 25 template di `email-templates.js` sono maturi e restano); non introduciamo Redis/BullMQ (il volume previsto non lo giustifica); non sostituiamo `nodemailer` (rimane libreria di trasporto, cambia solo il provider dietro).

---

## 1. Provider scelto: Brevo

La decisione è già memorizzata (`project_mail_provider_decision.md`): Brevo unico canale, piano ~25€/mese, ~20k mail/mese. Dominio mittente `easywin.it` (già operativo su Aruba, quindi SPF base esiste).

**Precisazione storica sulla "velocità"**: nei sorgenti legacy (`Kits.Ewin.Jobs/SendEsitoJob/SendEsitoJob.cs:41`) c'è il commento *"il limite è 250 mail ogni 20 minuti, e 5000 mail al giorno"* riferito a `smtp.easywin.it`. In 25 anni di operatività con ~500 clienti attivi questo limite non si è mai manifestato in produzione, perché i `Thread.Sleep(5000)` della newsletter e `Thread.Sleep(1000)` della civetta erano calibrati proprio per rispettarlo (500 clienti × 5s = ~42 min = ~240 mail/20min, appena sotto la soglia). Quindi la migrazione a Brevo non risolve un collo di bottiglia reale di throughput — lo risolve in astratto, ma non è il motivo dominante.

**Motivi veri della migrazione a Brevo**, in ordine di impatto concreto:

1. **Deliverability**: IP pool Brevo gestiti e monitorati riducono drasticamente il rischio di finire in spam o blacklist rispetto a un IP self-hosted di un server aziendale. Soprattutto ora che Gmail/Outlook hanno inasprito le policy (SPF+DKIM+DMARC obbligatori dal 2024 per mittenti bulk), un IP con reputation gestita professionalmente è quasi necessario.
2. **Tracking eventi**: aperture, click, bounce, spam complaint arrivano via webhook Brevo e si possono salvare su `mail_log`. Oggi non sappiamo se una mail è stata aperta, se il link è stato cliccato, se il destinatario ha marcato come spam — il mittente SMTP di Aruba non lo dice. Per una newsletter B2B questo è una cecità che impedisce di pulire la lista e capire cosa funziona.
3. **Bounce handling automatico**: Brevo gestisce hard-bounce marcando automaticamente gli indirizzi invalidi, così non si continua a inviare a caselle morte (che peggiorerebbero la reputation IP). Oggi questa disciplina è manuale o inesistente.
4. **SPF/DKIM/DMARC**: Brevo fornisce i record DNS pronti e li aggiorna se cambia qualcosa lato provider. Configurazione una tantum, poi gestita.
5. **Dashboard analytics**: volume inviato, tassi di apertura/click, bounce rate, reputation score. Utile per decisioni di prodotto (quale soggetto funziona meglio, quale giorno/ora, ecc.).
6. **Margine futuro**: se un giorno i clienti crescono a 1000-2000 e servisse mandare civetta in real-time su più gare contemporanee, il limite 250/20min diventerebbe vincolante. Brevo lo elimina preventivamente — ma questo è beneficio a futuro, non oggi.

La strategia DNS durante la transizione è affiancare Brevo ad Aruba, non sostituire: il record SPF esistente va esteso con `include:spf.brevo.com`, il DKIM Brevo è un record nuovo con selector dedicato (non entra in conflitto con DKIM Aruba eventualmente presente), DMARC resta a `p=none` durante il test e può passare a `p=quarantine` dopo due settimane di invii puliti. Questo permette rollback immediato a livello applicativo (basta ri-switchare env) senza dover ri-toccare il DNS.

**Prerequisito operativo utente** (non CC):
- Creare account Brevo
- Aggiungere dominio `easywin.it` e verificarlo
- Pubblicare record DKIM indicati da Brevo sul DNS `easywin.it`
- Estendere SPF esistente
- Generare API key SMTP e salvarla per quando arriva PR-MAIL-2a

Questi step possono essere fatti in parallelo allo sviluppo di PR-MAIL-2a ma devono essere completi **prima del merge** per poter testare.

---

## 1.bis Evidenze dal codice legacy (sorgenti C# .NET)

Analisi dei sorgenti in `~/Downloads/EasyWin 2/` ha confermato 6 comportamenti del vecchio sistema che informano il nuovo design:

**Architettura legacy**: Quartz.NET scheduler (Windows Service `TaskManagerService`) ospita i job `EwinNewsletterJob`, `EwinSendEsitoJob`, `BandiAperturaAlertJob`, `BandiSopralluogoAlertJob`, `GestioneAbbonamentiJob`, `PubblicazioneEsitiAlert`. Ogni job è una classe C# che fa query via Entity Framework a SQL Server, costruisce l'HTML via `string.Format` su template `.txt` (header + body + item + footer), invia via `System.Net.Mail.SmtpClient` asincrono.

**Filtro newsletter vecchio è solo su Province** (via `Users.Regioni[].Province`), non su SOA né importi. Il nuovo sistema aggiunge filtri SOA + importo + province. La SOA viene chiesta all'utente in fase di iscrizione e salvata nel profilo, quindi la personalizzazione è un upgrade netto rispetto al vecchio, non una regressione da gestire.

**Civetta esito ha due template distinti**: `Esiti/esito.txt` per partecipanti già clienti EasyWin (email completa con tutte le graduatorie e ribassi) e `Esiti/EsitoNotRegistered.txt` per non-clienti (versione lead-gen alleggerita, con call-to-action a iscriversi). Questa distinzione è una feature di business, non un dettaglio implementativo — va preservata nel nuovo sistema con `meta.registered: boolean` che pilota il template a runtime.

**Email secondarie (CC automatici)**: ogni utente può avere N email aggiuntive in tabella `Users.UserEmails`, e il vecchio sistema le aggiunge automaticamente in CC a ogni invio (newsletter + civetta). Feature che il nuovo sistema probabilmente non supporta oggi e che va portata. `mail-transport.send()` deve accettare `cc: string[]` e i chiamanti (newsletter, civetta) devono leggere le email secondarie dalla tabella utenti.

**Delay inter-messaggio conservativi**: civetta `Thread.Sleep(1000)` (1 msg/sec), newsletter `Thread.Sleep(5000)` tra utenti. Erano calibrati deliberatamente per stare sotto il cap 250/20min dello SMTP self-hosted, cap che infatti in produzione non si è mai toccato. Con Brevo si può alzare tranquillamente a 20 msg/sec (vedi §3.4), ma non è il motivo dominante della migrazione — è un side effect.

**Scheduling newsletter vecchio**: cron `0 15 3 * * ?` (03:15 AM). Il nuovo è 04:30, dopo l'import Presidia delle 04:00 — così la newsletter parte su dati freschi del giorno. Si conferma 04:30 come orario definitivo.

**Credenziali in plaintext nei legacy App.Config** (nota di sicurezza, non architetturale): SMTP password e DB password sono in chiaro nei file di configurazione del vecchio sistema. Quando arriverà la migrazione DB, le credenziali vecchie vanno ruotate prima del cutover. Nessuna di queste credenziali è stata copiata nel nuovo repo né nei file di design.

---

## 2. Principi architetturali

### 2.1 Single source of truth per l'invio

Un solo modulo (`backend/src/lib/mail-transport.js`) è responsabile di aprire connessioni SMTP, applicare rate-limit, gestire retry, e scrivere su `mail_log`. Nessun file nel repo può più chiamare `nodemailer.createTransport()` direttamente. Questo vincolo è presidiato da un test (o almeno da un grep check in smoke).

### 2.2 Log unificato

Una sola tabella (`mail_log`) registra ogni email inviata dal sistema, indipendentemente dal canale (newsletter, civetta, alert, reminder, evento gara, custom). Questo permette audit, debugging, e un pannello admin unico "Mail inviate" invece di dashboard frammentate per flusso.

### 2.3 Idempotenza scheduler DB-backed

Gli scheduler oggi tengono `_lastRunDate` in memoria. Restart prima dell'ora di esecuzione = doppio invio. Il nuovo pattern legge `tasks.data_ultima_esecuzione` all'avvio e prima di ogni run, con aggiornamento atomico post-esecuzione.

### 2.4 Fail-safe in batch

Errori singoli non bloccano il batch: ogni destinatario ha il proprio try/catch, status su `mail_log`, retry limitato (max 2 tentativi con backoff 30s/5min) per codici temporanei (421, 450, 451, 452), skip definitivo per codici permanenti (550, 553).

### 2.5 Provider-agnostico

Il modulo `mail-transport.js` espone un'API astratta (`send({to, from, subject, html, channel, meta})`). Sotto usa nodemailer + SMTP relay Brevo. Cambiare provider in futuro (es. Amazon SES se il volume esplode) significa modificare solo la configurazione interna del modulo, non i 5 file chiamanti.

---

## 3. Componenti

### 3.1 `backend/src/lib/mail-transport.js` (nuovo)

Modulo singleton con inizializzazione lazy. API pubblica:

```js
await mailTransport.send({
  to: 'dest@example.com',            // required
  cc: ['second@example.com'],         // opzionale, array email secondarie utente
  subject: 'Oggetto',                 // required
  html: '<p>...</p>',                 // required
  text: '...',                        // opzionale, auto-generato da html se mancante
  from: 'noreply@easywin.it',         // opzionale, default SMTP_FROM
  channel: 'newsletter_bandi',        // required, enum fisso (vedi §4)
  meta: { user_id: 42, gara_id: 123,  // opzionale, salvato in mail_log.meta JSONB
          registered: true }          // per civetta: true=cliente, false=lead-gen
});
// Ritorna: { messageId, mailLogId, status: 'sent'|'failed', error? }
```

**Supporto CC**: il campo `cc` è opzionale, array di stringhe. I chiamanti (newsletter, civetta) sono responsabili di popolarlo leggendo le email secondarie dell'utente (vedi §1.bis sulla feature legacy `Users.UserEmails`). `mail-transport` non fa join DB autonomo — resta un modulo di pura trasporto.

Internamente:
- Connection pool SMTP (max 10 connessioni)
- Semaforo per rate-limit in-process (max 20 msg/secondo, configurabile via `MAIL_RATE_LIMIT`)
- Retry automatico: 2 tentativi per errori temporanei, backoff 30s → 5min
- Write su `mail_log` PRIMA di inviare (status='queued') e UPDATE dopo (status='sent'|'failed')
- Cattura `messageId` SMTP di Brevo per tracking futuro

### 3.2 Schema `mail_log` (migration 026)

```sql
CREATE TABLE IF NOT EXISTS mail_log (
    id                  SERIAL PRIMARY KEY,
    channel             VARCHAR(40) NOT NULL,
    to_email            VARCHAR(300) NOT NULL,
    to_user_id          INTEGER REFERENCES users(id) ON DELETE SET NULL,
    from_email          VARCHAR(300),
    subject             VARCHAR(500),
    status              VARCHAR(20) NOT NULL DEFAULT 'queued',
    error_message       TEXT,
    provider_message_id VARCHAR(300),
    batch_id            INTEGER REFERENCES newsletter_invii(id) ON DELETE SET NULL,
    meta                JSONB DEFAULT '{}',
    sent_at             TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_mail_log_channel_created ON mail_log(channel, created_at DESC);
CREATE INDEX idx_mail_log_user ON mail_log(to_user_id, created_at DESC) WHERE to_user_id IS NOT NULL;
CREATE INDEX idx_mail_log_status ON mail_log(status, created_at DESC) WHERE status != 'sent';
CREATE INDEX idx_mail_log_batch ON mail_log(batch_id) WHERE batch_id IS NOT NULL;
```

**Relazione con `newsletter_invii`**: quest'ultima rimane come aggregate/batch record (una riga per ogni "invio massivo"), mentre `mail_log` è il dettaglio per-destinatario. Il campo `batch_id` collega. `newsletter_invii_log` (schema duplicato per-recipient solo newsletter) può essere deprecato: i suoi dati si migrano in `mail_log` con `channel='newsletter_bandi'|'newsletter_esiti'` in PR-MAIL-2a.

**Valori enum del campo `channel`** (documentati, non vincolati a livello DB per flessibilità):
- `newsletter_bandi`, `newsletter_esiti`, `newsletter_custom` — batch mattutino 5:30 e broadcast admin
- `civetta_esito` — mail lead-gen con graduatoria + ribasso a non-clienti
- `alert_apertura`, `alert_sopralluogo`, `alert_scrittura` — reminder operativi per clienti
- `alert_import` — alert admin per fallimenti import Presidia
- `reminder_scadenza_30`, `reminder_scadenza_7`, `reminder_scadenza_0` — reminder rinnovo abbonamento
- `evento_posticipo`, `evento_assegnazione`, `evento_cambio_incaricato` — notifiche modifica gara
- `password_reset`, `contact_form` — transactional generiche

### 3.3 Pattern idempotenza scheduler

Ogni scheduler (`newsletter-scheduler`, `abbonamenti-scheduler`, `bandi-alerts` runner) all'avvio e prima di ogni tick esegue:

```js
async function canRunToday(taskTipo, targetHour) {
  const today = todayKeyLocal();           // 'YYYY-MM-DD' in timezone Europe/Rome
  const { rows } = await db.query(
    'SELECT data_ultima_esecuzione, stato_ultima_esecuzione FROM tasks WHERE tipo = $1',
    [taskTipo]
  );
  if (!rows[0]) return true;                // primo run mai
  const last = rows[0].data_ultima_esecuzione;
  if (!last) return true;
  const lastDay = toLocalDay(last);
  if (lastDay === today && rows[0].stato_ultima_esecuzione === 'ok') return false;
  return new Date().getHours() >= targetHour;
}
```

Post-esecuzione:
```js
await db.query(
  `UPDATE tasks SET data_ultima_esecuzione=NOW(), stato_ultima_esecuzione=$2,
     messaggio_ultima_esecuzione=$3, prossima_esecuzione=$4
   WHERE tipo=$1`,
  [taskTipo, status, message, nextRunTimestamp]
);
```

Questo elimina la dipendenza da `_lastRunDate` in-memory. Restart = comportamento identico, zero double-send.

### 3.4 Rate-limit e batch size

Brevo non pubblica limiti duri sul piano 25€. Sul volume attuale (~500 clienti, newsletter quotidiana) non ci sono né col vecchio sistema né col nuovo problemi di throughput: la newsletter parte alle 04:30 e ha tutta la notte/mattina per completare. La scelta dei parametri qui sotto è guidata dal principio *"non essere più lenti di quanto strettamente necessario"* piuttosto che dalla necessità di spingere sulla velocità:

- Max 20 messaggi/secondo via SMTP (semaforo in-process) — valore prudente, Brevo regge molto di più
- Delay inter-messaggio 50ms minimo per batch (vs 1000-5000ms del legacy, che erano calibrati per rispettare il cap 250/20min di smtp.easywin.it)
- Concurrency 10 connessioni SMTP pool
- Batch size newsletter mattutina: no limite esplicito (resta loop sequenziale con semaforo)

Effetto pratico sul caso tipico: newsletter da 500 utenti completa in ~25 secondi invece di ~42 minuti. Beneficio operativo: se un giorno serve rimandare la newsletter (per esempio perché l'import Presidia è arrivato tardi), si può farlo senza occupare una grossa finestra temporale. Non è un requisito, è comodità.

Variabili env proposte:
```
MAIL_PROVIDER=brevo                  # futuro: 'ses', 'postmark', ecc.
BREVO_SMTP_HOST=smtp-relay.brevo.com
BREVO_SMTP_PORT=587
BREVO_SMTP_USER=...                  # email account Brevo
BREVO_SMTP_KEY=...                   # API key SMTP Brevo
MAIL_FROM='"EasyWin" <noreply@easywin.it>'
MAIL_RATE_LIMIT=20                   # msg/secondo
MAIL_POOL_SIZE=10                    # connessioni concorrenti
MAIL_RETRY_ATTEMPTS=2
MAIL_DRY_RUN=false                   # se true, scrive mail_log senza inviare (utile test)
```

---

## 4. Inventario flussi mail

Priorità confermate da Edoardo:

| Priorità | Flusso | Canale `mail_log` | Stato oggi | Sub-PR |
|----------|--------|---------------------|------------|--------|
| 1 | Newsletter Bandi 5:30 personalizzata SOA/regioni | `newsletter_bandi` | Funzionante in `newsletter.js`, duplicata in `admin-dashboard.js` | 2b |
| 1 | Newsletter Esiti 5:30 | `newsletter_esiti` | Broadcast non personalizzato (tutti gli utenti con flag) | 2b |
| 2 | Mail civetta esito (lead-gen post-invio ribasso) — **2 template: registered + non-registered** | `civetta_esito` | 1 solo template pronto, 2° mancante; `sendEsitoNotifications()` con bug naming, zero wiring UI | 2c |
| 3 | Alert apertura buste (-3gg/-1gg) | `alert_apertura` | Funzionante in `bandi-alerts.js` | 2d |
| 3 | Alert sopralluogo (-3gg/-1gg) | `alert_sopralluogo` | Funzionante in `bandi-alerts.js` | 2d |
| 3 | Alert scrittura bandi (-3gg/-1gg) | `alert_scrittura` | **Mancante**, da aggiungere | 2d |
| 3 | Alert import Presidia fallito | `alert_import` | Console-log only, da wire su mail | 2d |
| 4 | Reminder scadenza -30gg | `reminder_scadenza_30` | Funzionante in `abbonamenti-scheduler.js` | 2e |
| 4 | Reminder scadenza -7gg | `reminder_scadenza_7` | Funzionante | 2e |
| 4 | Reminder scadenza del giorno | `reminder_scadenza_0` | Funzionante | 2e |
| 5 | Evento posticipo apertura | `evento_posticipo` | Template pronto, **zero trigger** | 2f |
| 5 | Evento assegnazione apertura | `evento_assegnazione` | Template pronto, zero trigger | 2f |
| 5 | Evento cambio incaricato | `evento_cambio_incaricato` | Template pronto, zero trigger | 2f |
| — | Password reset | `password_reset` | Funzionante, resta invariato (solo migrato a mail-transport) | 2a |
| — | Contact form | `contact_form` | Funzionante, resta invariato | 2a |

---

## 5. Breakdown sub-PR

### PR-MAIL-2a — Infrastruttura (blocker)

**Obiettivo**: creare il modulo unificato e migrare tutti gli invii esistenti senza cambiare business logic. È il fondamento di tutto il resto.

Commit previsti:
1. `feat(db): migration 026 crea tabella mail_log` — schema §3.2
2. `feat(mail): nuovo modulo mail-transport con rate-limit, retry, supporto CC` — §3.1 (include `cc: string[]`)
3. `chore(mail): config Brevo + variabili env documentate`
4. `refactor(newsletter): newsletter.js usa mail-transport + legge email secondarie utente in CC`
5. `refactor(admin-dashboard): invia-bandi/invia-esiti usa mail-transport` (risolve dup con newsletter.js: consolidare su un path canonico, l'altro diventa alias)
6. `refactor(email-service): sendEsitoNotifications + sendEmail usano mail-transport`
7. `refactor(bandi-alerts): alert aperture/sopralluoghi usano mail-transport`
8. `refactor(abbonamenti-scheduler): reminder + rinnovo usano mail-transport`
9. `feat(scheduler): idempotenza DB-backed in newsletter-scheduler e abbonamenti-scheduler` — §3.3
10. `feat(mail): username_invio popolato in mail_log + newsletter_invii` (fix residuo #4 di PR-MAIL-0)
11. `feat(users): tabella users_email_secondarie se non esiste, + endpoint CRUD /admin/utenti/:id/emails` (porta la feature `Users.UserEmails` legacy nel nuovo schema)

Criteri done:
- `grep "createTransport\|createTransporter" backend/src --exclude=lib/mail-transport.js` ritorna 0 match
- Smoke 12/15 (stabile)
- Invio manuale test produce riga su `mail_log` con `status='sent'` e `provider_message_id` valorizzato
- Dry-run mode (`MAIL_DRY_RUN=true`) scrive riga `mail_log` ma non invia

Non in scope: feature nuove, UI admin per `mail_log`, modifiche template.

**Stima**: 6-10h di CC, 1 PR grande ma internamente ordinato.

### PR-MAIL-2b — Newsletter Bandi/Esiti 5:30

**Obiettivo**: consolidare definitivamente la duplicazione admin-dashboard vs newsletter e aggiungere personalizzazione esiti oggi mancante.

Commit:
1. `refactor(newsletter): rimuovi duplicazione invia-bandi/invia-esiti, admin-dashboard chiama POST /api/newsletter/auto con parametri`
2. `feat(newsletter): personalizzazione esiti via filtri SOA/regioni (riuso logic bandi)` — RECON sezione 2.3: "Nessun filtro equivalente per esiti"
3. `feat(admin): pagina admin /admin/newsletter-log mostra mail_log filtrato per canale newsletter_*`
4. `test: smoke end-to-end newsletter mattutina con 1 utente test`

Criteri done:
- Un solo endpoint canonico per newsletter (evidente da grep)
- Esiti filtrati come bandi
- Admin può vedere storico invii

### PR-MAIL-2c — Mail civetta esito (real-time)

**Obiettivo**: collegare la funzione già esistente `sendEsitoNotifications()` a un trigger UI, fixare il naming mismatch `dettagliogara` → `dettaglio_gara`, e implementare i **due template distinti** (come nel legacy): uno per clienti già iscritti (versione completa con graduatoria e ribassi) e uno per non-clienti lead-gen (versione alleggerita con CTA iscrizione).

Commit:
1. `fix(email-service): dettagliogara → dettaglio_gara, colonne lowercase`
2. `feat(email-templates): aggiungi buildEsitoCivettaRegisteredEmail + buildEsitoCivettaNotRegisteredEmail (porting da Schemas/Esiti/esito.txt e EsitoNotRegistered.txt legacy)`
3. `feat(api): POST /admin/esiti/:id/invia-notifiche — trigger civetta con logica split registered/not-registered`
4. `feat(admin): bottone "Invia mail a partecipanti" nella pagina dettaglio esito, con preview dei 2 template`
5. `feat(mail): log canale civetta_esito in mail_log con meta.id_gara e meta.registered=true|false`
6. `test: end-to-end con esito demo, verifica template corretto per ogni destinatario`

Criteri done:
- Click su bottone admin invia N mail ai partecipanti
- Partecipanti già clienti EasyWin (match su `users.partita_iva` o `users.email`) ricevono template registered
- Non-clienti ricevono template not-registered (lead-gen)
- mail_log popolato per ogni destinatario con `meta.registered` booleano

### PR-MAIL-2d — Alert operativi + scritture + import

**Obiettivo**: completare gli alert ops aggiungendo "scritture" (scrittura_bandi, prep offerta) e wire-ing dell'alert import Presidia.

Commit:
1. `feat(alerts): alert scrittura_bandi a -3gg/-1gg, simmetrico ad aperture/sopralluoghi`
2. `feat(alerts): alert email su 3+ fallimenti consecutivi import Presidia`
3. `refactor(alerts): unifica finestra temporale via costanti condivise`
4. `feat(admin): dashboard "Alert ops" mostra mail_log per canali alert_*`

Criteri done:
- Scritture con `eseguito=false` e data entro 3/1 giorno → utenti pertinenti ricevono mail
- Fallimento import triggera mail ad ADMIN_EMAIL
- Admin vede cosa è stato inviato

### PR-MAIL-2e — Reminder scadenze

**Obiettivo**: verificare che il flusso `abbonamenti-scheduler.js` funzioni correttamente dopo migrazione a mail-transport, e dare visibilità admin.

Commit:
1. `test: audit abbonamenti-scheduler post PR-MAIL-2a (tutti i canali reminder_scadenza_* scritti su mail_log)`
2. `feat(admin): pagina /admin/abbonamenti-scadenze mostra prossime scadenze + reminder già inviati`
3. `fix: eventuali bug emersi durante audit (placeholder commit)`

Criteri done:
- Reminder -30/-7/0 testati su utente finto con scadenza artificiale
- Admin può vedere chi scade e quando
- Storico reminder visibile per utente

### PR-MAIL-2f — Eventi gara (posticipo, assegnazione, cambio incaricato)

**Obiettivo**: costruire il wiring completamente mancante per i 3 template eventi gara.

Commit:
1. `feat(mail-events): nuovo modulo mail-events.js che espone 3 funzioni (notifyPosticipo, notifyAssegnazione, notifyCambioIncaricato)`
2. `feat(bandi): hook in PUT /bandi/:id — se data_apertura o data_apertura_posticipata cambia, chiama notifyPosticipo`
3. `feat(servizi): hook in POST/PUT /bandi/:id/apertura — assegnazione e cambio incaricato triggerano notifiche`
4. `feat(servizi): stesso hook per sopralluoghi e scritture`
5. `test: modifica manuale bando → mail a partecipanti; cambio incaricato → mail al nuovo + vecchio`

Criteri done:
- Modifica data gara → tutti i partecipanti registrati ricevono notifica
- Assegnazione/cambio incaricato → ricevente notificato
- mail_log popolato con meta.id_gara, meta.id_apertura, ecc.

---

## 6. Ordine esecuzione e dipendenze

```
PR-MAIL-0 (done) ──► PR-MAIL-2a (infrastruttura)
                           │
                           ├─► PR-MAIL-2b (newsletter)       [indipendenti tra loro]
                           ├─► PR-MAIL-2c (civetta)          [indipendenti tra loro]
                           ├─► PR-MAIL-2d (alert ops)        [indipendenti tra loro]
                           ├─► PR-MAIL-2e (reminder)         [indipendenti tra loro]
                           └─► PR-MAIL-2f (eventi gara)      [indipendenti tra loro]
```

2a è blocker di tutte le altre. Dopo 2a, le 5 restanti si possono fare in qualsiasi ordine (anche in parallelo se vuoi mandare più prompt CC separati, ma sequenziale è più sicuro).

Ordine consigliato di valore per il business:
1. PR-MAIL-2a (infrastruttura, obbligato)
2. PR-MAIL-2b (newsletter 5:30, core del prodotto)
3. PR-MAIL-2c (civetta, lead-gen — impatto commerciale diretto)
4. PR-MAIL-2d (alert ops, retention clienti esistenti)
5. PR-MAIL-2e (reminder scadenze, recupero ricavi)
6. PR-MAIL-2f (eventi gara, nice-to-have, template già pronti)

---

## 7. Rischi e mitigazioni

**Transizione SMTP Aruba → Brevo.** Il rischio concreto è finire in spam durante il primo invio da nuovo IP/IP pool Brevo se il DNS non è perfettamente configurato. Mitigazione: DNS DKIM+SPF completi prima del primo invio, DMARC a `p=none` per 2 settimane di warmup, prime mail dirette a indirizzi test (tuo + tester) prima di switchare la newsletter mattutina.

**Double-send durante switch scheduler.** Se si rilascia PR-MAIL-2a con il nuovo scheduler idempotente senza spegnere il vecchio, per una mattina potrebbero partire 2 newsletter. Mitigazione: PR-MAIL-2a contiene un `MAIL_AUTO_SCHEDULER_LEGACY_DISABLED=true` che disattiva i path legacy in un solo commit atomico.

**dettaglio_gara mismatch nel DB reale.** Il RECON ipotizza una vista/alias mai verificata. Prima di PR-MAIL-2c serve un test empirico: query `SELECT * FROM dettagliogara LIMIT 1` sul mini-neon. Se fallisce (probabile), il fix è semplice rename nel codice; se passa, c'è una vista ancora da scoprire.

**Volume utenti sconosciuto.** 650 mail/giorno su piano Brevo 25€ (20k/mese) coprono fino a ~650 utenti attivi × 1 newsletter/giorno. Se il numero reale fosse più alto (improbabile ma non verificato), serve upgrade piano Brevo. Mitigazione a costo zero: aggiungere `SELECT COUNT(*) FROM users WHERE attivo=true` come primo comando del prompt CC di PR-MAIL-2a.

**Regressioni smoke.** Il baseline attuale è 12/15. Ogni sub-PR deve mantenere questo. Se scende a 11/15 o meno, rollback immediato del commit colpevole.

---

## 8. Prerequisiti utente (Edoardo)

Da fare prima o durante PR-MAIL-2a, ma **prima del merge**:

- [ ] Creare account Brevo
- [ ] Aggiungere dominio `easywin.it` in Brevo e avviare verifica
- [ ] Aggiungere record DKIM Brevo al DNS `easywin.it` (istruzioni le fornisce Brevo stessa dopo l'aggiunta del dominio)
- [ ] Estendere record SPF esistente aggiungendo `include:spf.brevo.com` (lascia `include` Aruba se ancora presente)
- [ ] Impostare DMARC a `p=none` con `rua=mailto:edoardo.oliveri07@gmail.com` per ricevere report
- [ ] Generare API key SMTP su Brevo e conservarla in luogo sicuro

Verifica DNS: dopo la pubblicazione, attendere 1-24h (in genere < 1h) e verificare con `dig TXT easywin.it` e `dig TXT <selector>._domainkey.easywin.it` o via tool online tipo mxtoolbox.

---

## 9. Criteri di done complessivi (PR-MAIL-2 finita)

- Tutti gli invii mail passano da `mail-transport.js`
- Brevo è l'unico SMTP configurato, Aruba spento in env
- `mail_log` popolato per ogni singola mail con `channel`, `status`, `provider_message_id`
- Admin panel mostra: newsletter storico, mail civetta inviate, alert ops, reminder scadenze, eventi gara
- Smoke 12/15 stabile (o migliore)
- Template vecchi (25 funzioni di `email-templates.js`) invariati — nessun refactor UX in questa fase
- Alert import Presidia attivo
- Scritture nel flusso alert ops
- Eventi gara (posticipo/assegnazione/cambio incaricato) triggerati da modifiche DB

---

## 10. Decisioni aperte

**Nessuna che blocchi PR-MAIL-2a.** Lista di cose da risolvere in sub-PR successive:

- In PR-MAIL-2c: **risolta** — il vecchio sistema ha 2 template (registered/not-registered) e questa distinzione è confermata da Edoardo come requisito. Entrambi i gruppi (clienti e non-clienti) ricevono la civetta, ma con template diversi.
- In PR-MAIL-2f: cambio di data gara "minore" (modifica di 1 ora) deve triggerare notifica o solo posticipi rilevanti (es. > 1 giorno)? Da definire soglia.
- In PR-MAIL-2d: alert scritture vuole la stessa personalizzazione SOA/regioni delle newsletter, o va a tutti gli utenti con servizio "scritture" attivo?
- Orario newsletter 04:30 confermato (post-Presidia 04:00). Eventuale cambio futuro previa approvazione Edoardo.

---

## 11. Prossimo step operativo

Scrivere `PROMPT_CC_PR_MAIL_2a.md` con istruzioni dettagliate per CC, basate su questo design. Il prompt sarà molto più articolato dei precedenti (PR grande con 10 commit), quindi verrà strutturato in fasi esplicite:

- Fase 0 preflight
- Fase 1 ricognizione puntuale (letture obbligatorie)
- Fase 2 commit 1: migration mail_log
- Fase 3 commit 2: modulo mail-transport
- Fase 4 commit 3-10: migrazioni chiamanti + idempotenza
- Fase 5 smoke test
- Fase 6 push e report

Tempo stimato totale PR-MAIL-2a: 6-10h CC.
