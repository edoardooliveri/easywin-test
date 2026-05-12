# Import Presidia nel vecchio sito easyWin — riferimento per il rebuild

Sorgenti vecchio sito (read-only, ASP.NET MVC):
`/Users/edoardooliveri/Desktop/sorgentieasywin/`

Aggiornato: 2026-05-12. Questo documento è la **fonte di verità** sul
funzionamento di Presidia nel sito attuale (`easywin.it`); il nuovo sito deve
replicare gli stessi flussi end-to-end con stack Node.js/Fastify.

---

## 1. Componenti del vecchio sistema

### `BandiPresidiaManager.dll`
Business Logic Layer per Presidia. Classi (dedotte dai simboli PDB):

| Classe | Ruolo |
|---|---|
| `Presidia.Configuration.PresidiaConfigurations` | Espone `BandiServiceAddress` dal Web.config. |
| `Presidia.Configuration.PresidiaConfigurationSectionHandler` | Handler della sezione `<Presidia>`. |
| `BandiPresidia.BandiPresidiaProxy` | Client SOAP tipizzato verso `macsyws.asmx`. |
| `BandiPresidia.BlPresidia` | Business Logic: orchestra le chiamate SOAP, parsing DataSet, INSERT in DB. |
| `BandiPresidia.IBandiPresidia` | Interfaccia astratta (per DI/test). |
| `BandiPresidia.Esigenza` | Modello "Esigenza utente" = insieme dei filtri (SOA + province + criteri) per ricevere alert/newsletter solo dei bandi compatibili. |

**Endpoint SOAP**: `http://easywin.presidia.it/macsyws.asmx`
**Namespace**: `http://www.guru4.net/EuroConv`

### `Kits.Ewin.Jobs.dll` — Quartz Jobs

| Job | Classe (PDB) | Cosa fa |
|---|---|---|
| **BandiGathererJob** | `JobGatherer.cs` | Orchestratore: invoca uno o più `IImport`. Path principale di **import Presidia**. |
| **BandiGathererJob.PresidiaImport** | `PresidiaImport.cs` | Adapter `IImport` → `BlPresidia`. Chiama `RecuperaBandiAttivi(dal, al)`, mappa il DataSet a entità DB, INSERT in `bandi` con `provenienza='Presidia'`, scarica allegati. |
| **BandiDownloadNew** | `BandiDownloadNew.cs` + `BandiDownloadNewImport.cs` + `BandiDownloadNewIImport.cs` + `BandiDownloadNewParameters.cs` | Path alternativo (fonti non-Presidia o re-import manuale). |
| **BandiAlertJob** | `BandiAlertJob.cs` | Dopo l'import: matching `nuovi bandi × esigenze utenti` → email alert. |
| **BandiAperturaAlertJob** | `AlertsJob.cs` + `AperturaBandi.cs` | Alert su apertura/scadenza bandi. |
| **BandiSopralluogoAlertJob** | `AlertsSopralluoghiJob.cs` + `SopralluoghiBandi.cs` | Alert sopralluoghi obbligatori. |
| **GestioneAllegatiBandiJob** | omonimo | Scarico allegati (PDF disciplinare, capitolato, modulistica). |
| **GestioneAbbonamentiJob** | omonimo | Scadenze abbonamenti + sync `ExpireExternalBandi` su Presidia. |
| **GestioneUtenti** | `GestioneUtenti.cs` | Sync anagrafica utenti easyWin ↔ Presidia. |
| **NewsletterJob** | `EwinNewsletterJob.cs` | Newsletter bandi+esiti agli abbonati basata sulle Esigenze. |
| **PubblicazioneEsitiAlert** | omonimo | Alert pubblicazione nuovo esito. |
| **SendEsitoJob** | omonimo | Invio email di un esito singolo. |
| **SyncUrlJob** | `SyncUrlsjob.cs` + `HtmlToText.cs` + `SyncUrlResult.cs` | Scraping siti delle stazioni appaltanti (= alimenta `Fonti`). |
| **Riepilogo** | `Riepilogo.cs` | Job di riepilogo notturno. |

Helper trasversali: `QueuedThread.cs`, `FunzioniComuni.cs`.

### Configurazione Quartz (Web.config)

```xml
<quartz>
  <add key="quartz.scheduler.instanceName"      value="EwinJobScheduler" />
  <add key="quartz.threadPool.threadCount"      value="10" />
  <add key="quartz.threadPool.threadPriority"   value="2" />
  <add key="quartz.jobStore.misfireThreshold"   value="60000" />
  <add key="quartz.jobStore.type"               value="Quartz.Impl.AdoJobStore.JobStoreTX, Quartz" />
  <add key="quartz.jobStore.driverDelegateType" value="Quartz.Impl.AdoJobStore.StdAdoDelegate, Quartz" />
  <add key="quartz.jobStore.tablePrefix"        value="QRTZ_" />
  <add key="quartz.jobStore.dataSource"         value="myDS" />
  <add key="quartz.dataSource.myDS.connectionString" value="Data Source=localhost;Initial Catalog=Gare;User ID=easywin;password=ewin123" />
  <add key="quartz.dataSource.myDS.provider"    value="SqlServer-20" />
</quartz>
```

- Job store **persistente** su SQL Server (`Gare` DB), tabelle `QRTZ_*` (schema standard Quartz).
- Console di amministrazione esposta via `QuartzNetWebConsole` su path `/quartz/*`.

### Area `Areas/TasksManager/Views/{Jobs,Triggers,Scheduler}`
**Viste stub** quasi vuote (`<h2>Index</h2>`): la gestione vera è delegata alla `QuartzNetWebConsole` su `/quartz/*`. Nel nuovo sito **NON è necessario** replicare la console Quartz; basta esporre REST endpoint per status/runs/scheduler.

### Area `Areas/Gestione/Views/Fonti`
View: `Index`, `SincSiti`, `TestiChiave`, `FontiCheckResult`. Configura le sorgenti web (siti delle stazioni) per `SyncUrlJob`. Usa `Scripts/links.js`.

### Area `Areas/Gestione/Views/Utenti/UtentePresidia.cshtml` (56 righe)
Form admin per gestire l'utente Presidia di un cliente easyWin:

| Action POST/DELETE | Campi | Endpoint chiamato lato `BlPresidia` |
|---|---|---|
| `CreaUtentePresidia` | `UserName`, `RenewExternalBandi` (chk), `ExpireExternalBandi` (date) | `InserimentoAnagrafica(GUID, inizio, fine)` |
| `ModificaUtentePresidia` | idem | UPDATE locale + eventuale `AssociazioneEmail` |
| `EliminaUtentePresidia` (DELETE) | `UserName` | `SospendiCliente(GUID)` |

Il form "Crea" appare solo se `Model.BadiUserName` è vuoto, altrimenti vengono mostrati i form "Modifica" + "Elimina" — quindi **un utente easyWin ha al massimo un utente Presidia**, identificato da `users.BadiUserName`.

---

## 2. Operazioni SOAP utilizzate

| Operazione | Input | Output | Chi la usa |
|---|---|---|---|
| `RecuperaBandiAttivi(dal, al)` | range date | DataSet bandi nel periodo | `BandiGathererJob.PresidiaImport` |
| `TrovaBandiPerFiltri(GUID, categorie, province, ...)` | GUID + filtri esigenza | DataSet filtrato | UI admin "Ricerca" |
| `TrovaBandiPerCodice(sequenzaBandi)` | codice bando | DataSet singolo | Import singolo |
| `InserimentoAnagrafica(GUID, inizio, fine)` | GUID + contratto | esito | `CreaUtentePresidia` |
| `EsistenzaCliente(GUID)` | GUID | bool | pre-check |
| `SospendiCliente(GUID)` | GUID | esito | `EliminaUtentePresidia` |
| `RiabilitaCliente(GUID)` | GUID | esito | riattivazione |
| `AssociazioneEmail(GUID, email)` | GUID + email | esito | sync email |
| `RecuperaEmail(GUID)` | GUID | email | lookup |
| `RecuperaListaCategorie()` | — | lista SOA | dropdown |
| `RecuperaFontiDati()` | — | lista fonti | dropdown |

Tutte le chiamate con auth utente passano il **GUID** come parametro per-call. **Non c'è un username/password globale** verso Presidia.

---

## 3. Modello dati impattato

- `users.BadiUserName` / `users.ExpireExternalBandi` / `users.RenewExternalBandi` — relazione 1:1 easyWin ↔ Presidia.
- `bandi.provenienza = 'Presidia'` — discriminante origine.
- `QRTZ_*` — tabelle Quartz (persistenza job/trigger). Nel nuovo sito **non servono**: usiamo un mini-scheduler basato su `setInterval` + tabella `presidia_import_runs` per idempotenza.
- (Probabili) `Esigenze` — tabella di filtri SOA+province+criteri per utente. **Da verificare nel dump SQL** (`Gare05_VEN.bak`).

---

## 4. Mapping SOA Presidia → easyWin

Già replicato nel nuovo sito in `backend/src/services/presidia-soap.js` (costante `SOA_MAPPING`, ~100 righe). Esempi:

```
'CC20C' → 'AFC004'
'CC08A' → 'ASF001'
'CC09A' → 'ASG001'
'CC12A' → 'AFF001'
'CC17A' → 'AFA001'
'CC18A' → 'AMB001'
'CC80A' → 'AIA002'
```

Sorgente originale: `PresidiaImport.cs` nel vecchio.

---

## 5. Stato attuale nel nuovo sito (Node.js + Fastify)

**Già implementato:**

- `backend/src/services/presidia-soap.js` — client SOAP completo. Equivalente di `BandiPresidiaProxy`.
- `backend/src/services/presidia-import.js` — orchestratore import. Equivalente di `BandiGathererJob.PresidiaImport`.
- `backend/src/services/presidia-scheduler.js` — scheduler interno (`setInterval`) con 12 slot diurni + riepilogo 04:00. Attivato da env var `PRESIDIA_AUTO=true`. Idempotenza via `presidia_import_runs.slot_key`. **Sostituisce Quartz**.
- `backend/src/routes/presidia.js` — 12 endpoint admin (import/search/sync/status/categorie/fonti/test/runs*/scheduler-status).
- `backend/src/routes/bandi-import.js` — `POST /api/admin/bandi-import/presidia` import on-demand.
- Migration `024_presidia_import_runs.sql`.
- `docs/PRESIDIA_AI_SETUP.md` — guida operativa setup.

**Da fare nel rebuild** (in ordine di priorità):

1. **Tabella `esigenze`** + UI admin per definirle. Servono per `TrovaBandiPerFiltri` e per il futuro `BandiAlertJob`.
2. **Modello utente Presidia**: aggiungere a `users` le colonne `badi_user_name`, `expire_external_bandi`, `renew_external_bandi`. Endpoint:
   - `POST   /api/admin/utenti/:username/presidia` — crea (≅ `CreaUtentePresidia`)
   - `PUT    /api/admin/utenti/:username/presidia` — modifica
   - `DELETE /api/admin/utenti/:username/presidia` — sospendi
3. **Porting dei job mancanti** (stile `presidia-scheduler.js`, niente Quartz):
   - `BandiAlertJob` → matching bandi×esigenze → email
   - `BandiAperturaAlertJob` → alert apertura/scadenza
   - `BandiSopralluogoAlertJob` → alert sopralluoghi
   - `GestioneAllegatiBandiJob` → scarico allegati (parzialmente coperto da `bandi-ai/enrich-from-allegati`)
   - `SyncUrlJob` → scraping siti non-Presidia
   - `PubblicazioneEsitiAlert` → alert nuovo esito
4. **Sezione Fonti nel gestionale admin** (corrisponde a `Areas/Gestione/Views/Fonti/*`).
5. Quartz console **NON serve replicare**: usiamo `/api/presidia/scheduler-status` + `/api/presidia/runs*` come REST + una UI custom semplice.

---

## 6. Flusso end-to-end (legacy) — pseudo-codice

```
[Quartz CronTrigger schedulato]
       │
       ▼
[BandiGathererJob.Execute(JobExecutionContext)]
       │  legge JobGathererParameters: data_dal, data_al, fonti[]
       │
       ▼
[per ogni IImport configurato]
       │
       ▼
[PresidiaImport.Run(parameters)]
       │
       ├─▶ BandiPresidiaProxy.RecuperaBandiAttivi(dal, al)
       │       │  (SOAP call macsyws.asmx)
       │       ▼
       │   DataSet bandi (XML tipizzato)
       │
       ├─▶ per ogni riga del DataSet:
       │     - SOA_MAPPING Presidia → easyWin
       │     - extractCIG / extractCUP
       │     - normalizza date e importi
       │     - INSERT INTO bandi (..., provenienza='Presidia')
       │     - scarica allegati e li salva
       │
       └─▶ log riepilogo nella tabella audit
              │
              ▼
       [BandiAlertJob ← trigger]
              │
              ▼
       per ogni utente con Esigenza matchante:
              - email diretta (alert urgente), oppure
              - accumulo per invio batch (newsletter)
```

Nel nuovo sito il flow è identico ma il trigger è `setInterval` di `presidia-scheduler.js` invece di Quartz, e l'INSERT bandi avviene tramite `pg` (PostgreSQL) invece di Entity Framework su SQL Server.

---

## 7. Note di sicurezza / migrazione

- La connection string Quartz nel Web.config (`User ID=easywin;password=ewin123`) era **in chiaro**. Nel nuovo sito tutto va via env var.
- L'endpoint Presidia (`http://easywin.presidia.it/macsyws.asmx`) richiede **whitelist IP**: aprire ticket col fornitore quando si attiva da nuovi server (es. Render).
- Il GUID di ogni utente Presidia è il segreto operativo per le chiamate per-call. Nel nuovo sito andrà salvato in `users.badi_user_name` (o colonna dedicata `presidia_guid`) e mai esposto al cliente finale.
