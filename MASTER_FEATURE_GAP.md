# EasyWin - Master Feature Gap Analysis
## Original ASP.NET vs New Node.js/Fastify Site

**Data analisi**: 27 Marzo 2026
**Sistema originale**: 37 controller, 400+ metodi Gestione, 122+ metodi Abbonamenti, 265 stored procedures, 96+ tabelle, 57 viste
**Sistema nuovo**: 15 route files, 4 migrations, 3 frontend pages

---

## LEGENDA PRIORITÀ
- 🔴 CRITICO - Funzionalità core del business, senza queste il sito non funziona
- 🟠 IMPORTANTE - Funzionalità necessarie per operatività quotidiana
- 🟡 UTILE - Migliora l'esperienza ma non blocca l'operatività
- 🟢 NICE-TO-HAVE - Può essere implementato dopo il lancio

## LEGENDA STATO
- ✅ Implementato
- 🔶 Parziale
- ❌ Mancante

---

## 1. GESTIONALE (Area Admin)

### 1.1 Bandi Management
| Feature | Stato | Priorità | Note |
|---------|-------|----------|------|
| Lista bandi con filtri avanzati | ✅ | 🔴 | |
| Dettaglio bando completo | ✅ | 🔴 | |
| Crea/Modifica bando | ✅ | 🔴 | |
| Elimina bando (soft) | ✅ | 🔴 | |
| Allegati bando (upload/download/elimina) | ✅ | 🔴 | |
| Storia modifiche bando | ✅ | 🔴 | |
| Converti bando → esito | ✅ | 🔴 | |
| AI analisi PDF bando | ✅ | 🔴 | NUOVO |
| Clona bando | ❌ | 🟠 | BandiController.Bando.cs: ClonaBando() |
| Bandi incompleti | ❌ | 🟠 | BandiController.cs: Incompleti() |
| Bandi rettificati | ❌ | 🟡 | BandiController.cs: Rettificati() |
| Tipologie bandi (gestione) | ❌ | 🟡 | BandiController.cs: Tipologie() |
| Criteri (gestione) | ❌ | 🟡 | BandiController.cs: Criteri() |
| Verifica CIG duplicato | ❌ | 🟠 | BandiController.Bando.cs: CheckCIG() |
| Posticipa apertura | ❌ | 🟠 | PosticipaApertura(), PosticipaAperturaDaDestinarsi() |
| Imposta avviso/controllo | ❌ | 🟡 | ImpostaAvviso(), ImpostaControllo() |
| Inserisci link web | ❌ | 🟡 | InserisciLink(), InserisciLinkEsteso() |
| Bandi per stazione | ❌ | 🟠 | BandiStazione() |
| Bandi per utente | ❌ | 🟠 | BandiUtente() |
| Associa esito a bando | ❌ | 🟠 | AssociaEsito(), RimuoviAssociazioneEsito() |
| Imposta tipo esito | ❌ | 🟠 | ImpostaTipoEsito() |
| SOA bandi (gestione 4 tipi) | 🔶 | 🟠 | Solo prevalente, mancano sec/alt/app/sost |

### 1.2 Bandi - Servizi/Appuntamenti (COMPLETAMENTE MANCANTE)
| Feature | Stato | Priorità | Note |
|---------|-------|----------|------|
| Aperture (gestione completa) | ❌ | 🔴 | CRUD apertura + template + assegnazione |
| Scritture (gestione completa) | ❌ | 🔴 | CRUD scrittura + template |
| Sopralluoghi (gestione completa) | ❌ | 🔴 | CRUD sopralluogo + date + richieste disponibilità |
| Elaborati progettuali | ❌ | 🟠 | CRUD elaborato + template |
| Template per tutti i servizi | ❌ | 🟠 | 5 tipi di template (aperture, scritture, sopralluoghi, presa visione, elaborati) |
| Calendario/Agenda eventi | ❌ | 🟠 | Calendario(), Agenda(), Eventi() |
| Appuntamenti per tipo | ❌ | 🟠 | AppuntamentiScritture/Aperture/Elaborati/Sopralluoghi |
| Assegna stato/utente | ❌ | 🟠 | AssegnaStato(), AssegnaUtente(), Eseguito() |
| Richiesta disponibilità sopralluogo | ❌ | 🟠 | RichiestaDisponibilitaSopralluogo() |

### 1.3 Esiti Management
| Feature | Stato | Priorità | Note |
|---------|-------|----------|------|
| Lista esiti con filtri | ✅ | 🔴 | |
| Dettaglio esito | ✅ | 🔴 | |
| Crea/Modifica esito | ✅ | 🔴 | |
| Graduatoria (dettagli) | ✅ | 🔴 | |
| Workflow (conferma/abilita/disabilita/invia) | ✅ | 🔴 | |
| AI analisi PDF esito | ✅ | 🔴 | NUOVO |
| Cestino esiti | ❌ | 🟠 | Vista_Recycle_Gare |
| Esiti incompleti | ❌ | 🟠 | Vista_GareIncomplete |
| Esiti modificabili | ❌ | 🟡 | |
| Esiti da abilitare | ❌ | 🟠 | Vista_GareDisabled |
| Clona esito | ❌ | 🟠 | ewin_esiti_clone |
| ATI/Mandanti gestione | ❌ | 🔴 | Ati.cshtml, Mandanti.cshtml, DettagliMandanti.cshtml |
| Ricorsi (appeals) | ❌ | 🟡 | GareRicorsi table |
| Forza vincitore | ❌ | 🟡 | ForzaVincitore.cshtml |
| Copia/Inverti/Sposta numerazione | ❌ | 🟡 | CopiaNumerazione, InvertiNumerazione, SpostaNumerazione |
| Esporta XML | ❌ | 🟡 | EsportaXml.cshtml |
| Associa bando | ❌ | 🟠 | AssociaBando.cshtml |
| Esiti per utente | ❌ | 🟠 | EsitiUtente.cshtml |
| Punteggi OEPV (gestione) | ❌ | 🔴 | Tabella Punteggi |
| CalcolaIDTipologiaEsito | ❌ | 🔴 | Mappatura tipo bando+criterio → tipo esito (51 tipi) |
| SOA esiti (4 tipi) | 🔶 | 🟠 | Solo prevalente |
| Stato servizio | ❌ | 🟡 | StatoServizio.cshtml |

### 1.4 Aziende Management
| Feature | Stato | Priorità | Note |
|---------|-------|----------|------|
| Lista aziende con filtri | 🔶 | 🔴 | Solo lista base, mancano filtri avanzati |
| Dettaglio azienda completo | ❌ | 🔴 | |
| Crea/Modifica azienda | ❌ | 🔴 | |
| Elimina azienda (soft) | ❌ | 🟠 | |
| Cestino aziende | ❌ | 🟡 | Vista_Recycle_Aziende |
| Cerca aziende per esito | ❌ | 🟠 | CercaAziendePerEsito() |
| ATI con azienda | ❌ | 🟠 | AtiCon.cshtml |
| Modifica nota azienda | ❌ | 🟡 | ModificaNota.cshtml |
| Invio password di prova | ❌ | 🟡 | InvioRichiestaPasswordDiProva.cshtml |
| Invio descrizione servizi | ❌ | 🟡 | InvioDescrizioneServizi.cshtml |
| Attestazioni/SOA per azienda | ❌ | 🔴 | Tabella Attestazioni + AttestazioniAziende |
| Personale azienda | ❌ | 🟡 | Tabella AziendaPersonale |
| Eventi azienda | ❌ | 🟡 | Tabella EventiAziende |
| Note azienda | ❌ | 🟡 | Tabella NoteAziende |

### 1.5 Stazioni Management
| Feature | Stato | Priorità | Note |
|---------|-------|----------|------|
| Lista stazioni con filtri | 🔶 | 🔴 | Solo lista base |
| Dettaglio stazione completo | ❌ | 🔴 | |
| Crea/Modifica stazione | ❌ | 🔴 | |
| Elimina stazione (soft) | ❌ | 🟠 | |
| Cestino stazioni | ❌ | 🟡 | Vista_Recycle_Stazioni |
| Fonti web per stazione | ❌ | 🟠 | FontiWebSpecifiche, FontiWebGeneriche |
| Iscrizioni stazione | ❌ | 🟠 | Iscrizioni() con allegati |
| Sostituisci stazione | ❌ | 🟡 | SostituisciStazione(), SostituisciStazioniPresidia() |
| Risolvi stazione | ❌ | 🟡 | RisolviStazione() |
| Propaga piattaforma/regex | ❌ | 🟡 | PropagaPiattaforma(), PropagaRegularExpression() |
| Personale stazione | ❌ | 🟡 | Tabella PersonaleStazione |
| Presidia stazioni | ❌ | 🟡 | Tabella StazioniPresidia |

### 1.6 Utenti Management
| Feature | Stato | Priorità | Note |
|---------|-------|----------|------|
| Lista utenti con filtri | 🔶 | 🔴 | Solo lista base |
| Dettaglio utente completo | ❌ | 🔴 | 65+ metodi nel controller originale |
| Crea/Modifica utente | ❌ | 🔴 | |
| Elimina utente | ❌ | 🟠 | |
| Gestione abbonamento | ❌ | 🔴 | Abbonamento(), periodi, scadenze |
| Selezione bandi per utente | ❌ | 🔴 | SelezioneBandi() - quali bandi vede il cliente |
| Selezione esiti per utente | ❌ | 🔴 | SelezioneEsiti() - quali esiti vede il cliente |
| Newsletter bandi config | ❌ | 🟠 | NewslettersBandi() |
| Newsletter esiti config | ❌ | 🟠 | NewslettersEsiti() |
| Cambio password | ❌ | 🔴 | ChangePassword() |
| Email aggiuntive | ❌ | 🟠 | EmailsAggiuntive() |
| Storico utente | ❌ | 🟡 | Storico() |
| Fatturazione (fatture, proforma, pagamenti) | ❌ | 🔴 | 20+ metodi per billing |
| Periodi abbonamento | ❌ | 🔴 | AggiungiPeriodo, ModificaPeriodo, EliminaPeriodo |
| Incaricati (operativi assegnati) | ❌ | 🟠 | Incaricati() |
| Province utente | ❌ | 🟠 | UtenteProvince() |
| Scadenze abbonamenti | ❌ | 🔴 | Scadenze() con calendario |
| Inserimenti utente | ❌ | 🟡 | Inserimenti() |
| Controllo accessi | ❌ | 🟡 | ControlloAccessi() |
| Utenti Presidia | ❌ | 🟡 | CreaUtentePresidia, Modifica, Elimina |
| Copia SOA/province tra utenti | ❌ | 🟡 | CopiaSoaProvince() |

### 1.7 Concorrenti Management (COMPLETAMENTE MANCANTE)
| Feature | Stato | Priorità | Note |
|---------|-------|----------|------|
| Lista concorrenti con filtri | ❌ | 🟠 | |
| Dettaglio concorrente | ❌ | 🟠 | |
| Crea/Modifica concorrente | ❌ | 🟠 | |
| Elimina concorrente | ❌ | 🟠 | |
| Verifica P.IVA duplicata | ❌ | 🟡 | |
| Autocomplete concorrenti | ❌ | 🟡 | |

### 1.8 Esecutori Esterni Management (COMPLETAMENTE MANCANTE)
| Feature | Stato | Priorità | Note |
|---------|-------|----------|------|
| Lista esecutori con filtri | ❌ | 🟠 | Per gestione sopralluoghi |
| CRUD esecutore | ❌ | 🟠 | |
| Verifica univocità (P.IVA, CF, SDI) | ❌ | 🟡 | |

### 1.9 Intermediari Management (COMPLETAMENTE MANCANTE)
| Feature | Stato | Priorità | Note |
|---------|-------|----------|------|
| Lista intermediari con filtri | ❌ | 🟠 | |
| CRUD intermediario | ❌ | 🟠 | |
| Verifica univocità | ❌ | 🟡 | |

### 1.10 Dashboard Admin
| Feature | Stato | Priorità | Note |
|---------|-------|----------|------|
| Dashboard base con statistiche | 🔶 | 🔴 | Solo conteggi base |
| Newsletter management | ❌ | 🔴 | InviaNewsletter() con filtri utente |
| Stato servizi | ❌ | 🟠 | StatoServizi(), StatoServizio() |
| Rilancia servizio | ❌ | 🟡 | Rilancia() |
| Sposta CIG/CUP | ❌ | 🟡 | SpostaCIGCUP() |
| Dashboard per ruolo (admin/agent/publisher) | ❌ | 🟠 | 3 viste separate |

### 1.11 Fonti Web (COMPLETAMENTE MANCANTE)
| Feature | Stato | Priorità | Note |
|---------|-------|----------|------|
| Gestione fonti web | ❌ | 🟡 | Scraping/sync engine |
| Controllo automatico/manuale | ❌ | 🟡 | |
| Differenze fonti | ❌ | 🟡 | |
| Testi chiave | ❌ | 🟡 | |
| Sincronizzazione siti | ❌ | 🟡 | |

### 1.12 Piattaforme (PARZIALE)
| Feature | Stato | Priorità | Note |
|---------|-------|----------|------|
| Lista piattaforme | 🔶 | 🟡 | In lookups, manca CRUD |
| Dettaglio/modifica piattaforma | ❌ | 🟡 | |
| Regole regex piattaforma | ❌ | 🟡 | |

### 1.13 Servizi/Richieste (PARZIALE)
| Feature | Stato | Priorità | Note |
|---------|-------|----------|------|
| Lista richieste servizi | ❌ | 🟠 | ServiziController |
| Gestione stato richiesta | ❌ | 🟠 | Gestito/NonGestito |

### 1.14 Ricerca Doppia (MANCANTE)
| Feature | Stato | Priorità | Note |
|---------|-------|----------|------|
| Ricerca simultanea bandi+esiti | ❌ | 🟡 | RicercaDoppiaController |

---

## 2. AREA CLIENTI (Abbonamenti)

### 2.1 Home Utente
| Feature | Stato | Priorità | Note |
|---------|-------|----------|------|
| Dashboard con ultimi 50 bandi + 50 esiti | ❌ | 🔴 | UtenteController.Index() |
| Filtro per regione/provincia/SOA utente | ❌ | 🔴 | |
| Profilo utente | ❌ | 🔴 | Profilo() |
| Cambio password | ❌ | 🔴 | ChangePassword() |

### 2.2 Bandi Clienti
| Feature | Stato | Priorità | Note |
|---------|-------|----------|------|
| Browse bandi con filtri | 🔶 | 🔴 | Mancano filtri utente-specifici |
| Dettaglio bando | 🔶 | 🔴 | Manca vista client-specific |
| Registro bandi (add/remove/note) | ❌ | 🔴 | RegistroBandiAdd/Remove, RegistroGare |
| Esportazione registro | ❌ | 🟠 | EsportaRegistroGare() |
| Richiesta apertura | ❌ | 🔴 | RichiediApertura() |
| Richiesta servizi | ❌ | 🔴 | RichiediServizi() |
| Crea/Modifica bando (per cliente) | ❌ | 🟠 | CreaBando/ModificaBando clienti |
| Ultimi bandi (geolocalizzazione) | ❌ | 🟡 | UltimiBandi(lat, lon) |
| Storico newsletter | ❌ | 🟡 | StoricoNewsletter() |
| Assegna stato scrittura | ❌ | 🟠 | AssegnaStato() |

### 2.3 Esiti Clienti
| Feature | Stato | Priorità | Note |
|---------|-------|----------|------|
| Browse esiti con filtri | 🔶 | 🔴 | Mancano filtri utente-specifici |
| Dettaglio esito con varianti | ❌ | 🔴 | Esito(id, Variante) |
| Preferiti (add/remove/browse) | ❌ | 🔴 | PreferitiAdd/Remove, Preferiti() |
| Invio mail esito completo | ❌ | 🟠 | InviaMailEsitoCompleto() |
| Ultimi esiti (geolocalizzazione) | ❌ | 🟡 | UltimiEsiti(lat, lon) |
| Mappa esito | ❌ | 🟡 | EsitoMap() |
| Storico newsletter | ❌ | 🟡 | StoricoNewsletter() |

### 2.4 SIMULAZIONI - IL CUORE DEL BUSINESS (CRITICO)
| Feature | Stato | Priorità | Note |
|---------|-------|----------|------|
| Calcolo base con AI | ✅ | 🔴 | Implementato ma SEMPLIFICATO |
| Lista simulazioni utente | ✅ | 🔴 | |
| **MOTORE CALCOLO COMPLETO** | ❌ | 🔴🔴🔴 | 51 tipologie esito, taglio ali, soglia anomalia |
| Crea simulazione (wizard multi-step) | ❌ | 🔴 | Session-based multi-step workflow |
| Seleziona esiti per simulazione | ❌ | 🔴 | SelezionaEsiti() |
| Conferma simulazione | ❌ | 🔴 | ConfermaSimulazione() |
| Varianti simulazione | ❌ | 🔴 | Varianti(), BASE + modifiche |
| Dettagli partecipanti | ❌ | 🔴 | Dettagli() |
| Modifica ribasso singola azienda | ❌ | 🔴 | ModificaRibasso() |
| Aggiungi azienda fake | ❌ | 🔴 | AggiungiAzienda() con ribasso custom |
| Aggiungi range aziende fake | ❌ | 🔴 | AggiungiRangeAziende() |
| Aggiungi aziende da database | ❌ | 🟠 | AggiungiAziende() |
| Elimina azienda/aziende | ❌ | 🟠 | EliminaAzienda(), EliminaAziende() |
| Ricalcola (OLD + NEW algoritmo) | ❌ | 🔴 | RicalcolaOLD(), RicalcolaNEW() |
| Clona simulazione | ❌ | 🟠 | Clona() |
| Esporta Excel | ❌ | 🔴 | EsportaExcel() |
| Esporta XML | ❌ | 🟡 | EsportaXml() |
| Modifica soglia riferimento | ❌ | 🔴 | ModificaSogliaRiferimento() |
| Simula singolo esito | ❌ | 🟠 | Simulaesito() |
| Crea esito da simulazione | ❌ | 🟠 | CreaEsito() |
| Modifica esito da simulazione | ❌ | 🟡 | ModificaEsito() |
| **Costanti casi (16 array tipologici)** | ❌ | 🔴 | ArrNuoviCasi, ArrMassimoRibasso, ArrSbloccaCantieri etc. |

### 2.5 Analisi Azienda (COMPLETAMENTE MANCANTE)
| Feature | Stato | Priorità | Note |
|---------|-------|----------|------|
| Dettaglio azienda con statistiche | ❌ | 🔴 | Moda, media, varianza ribassi |
| Grafico ribassi (ultimi 40) | ❌ | 🔴 | GetRibassiAzienda() con regressione lineare |
| Grafico ribassi vincenti | ❌ | 🟠 | GetRibassiWinnerAzienda() |
| Grafico risultati (vincitore/anomala/esclusa) | ❌ | 🟠 | GetAziendaResults() |
| Grafico ATI (singola/mandataria/mandante) | ❌ | 🟡 | GetAziendaAti() |
| Regressione lineare previsione | ❌ | 🔴 | Kits.MathLib.Statistics |
| Medie mobili (semplice + esponenziale) | ❌ | 🟠 | |

### 2.6 ATI / Avvalimenti
| Feature | Stato | Priorità | Note |
|---------|-------|----------|------|
| Dettaglio ATI (mandataria + mandanti) | ❌ | 🟠 | AtiController |
| Esiti tra aziende ATI | ❌ | 🟠 | |
| Dettaglio avvalimenti | ❌ | 🟡 | AvvalimentiController |
| Esiti tra aziende avvalimenti | ❌ | 🟡 | |

---

## 3. SITO PUBBLICO

| Feature | Stato | Priorità | Note |
|---------|-------|----------|------|
| Homepage | ✅ | 🔴 | |
| Pagina bandi | ✅ | 🔴 | |
| Pagina esiti | ✅ | 🔴 | |
| Pagina servizi | ✅ | 🟠 | |
| Pagina sopralluoghi | ✅ | 🟠 | |
| Pagina simulazioni | ✅ | 🔴 | |
| Range statistico | ✅ | 🔴 | |
| Albi fornitori | ✅ | 🟠 | |
| Login | ✅ | 🔴 | |
| Contatti | ✅ | 🟠 | |
| RSS Bandi | ❌ | 🟡 | RssController |
| RSS Esiti | ❌ | 🟡 | |
| Recupera password | ❌ | 🔴 | RecuperaPassword() |
| Ultimi bandi geolocalizzati | ❌ | 🟡 | |
| Ultimi esiti geolocalizzati | ❌ | 🟡 | |
| Disabilita newsletter | ❌ | 🟡 | DisabilitaNewsletter() |
| Pagine servizi dettaglio (6 pagine) | ❌ | 🟡 | Apertura, OnDemand, Formazione, etc. |

---

## 4. SISTEMA / INFRASTRUTTURA

| Feature | Stato | Priorità | Note |
|---------|-------|----------|------|
| Autenticazione JWT | ✅ | 🔴 | |
| Ruoli utente (admin/operatore/utente) | 🔶 | 🔴 | Manca granularità originale (5+ ruoli) |
| SMTP email | 🔶 | 🔴 | Configurato ma non testato |
| Task scheduler (Quartz equivalent) | ❌ | 🟠 | 4 controller nel TasksManager |
| Web scraping engine | ❌ | 🟡 | FontiWeb + SincSiti |
| Newsletter generator | ❌ | 🔴 | Invio newsletter bandi/esiti |
| Fatturazione/billing | ❌ | 🔴 | Fatture, ProForma, Pagamenti |
| API pubblica (bandi/esiti) | ❌ | 🟡 | BandiApiController, EsitiApiController |
| Error logging (ELMAH equivalent) | ❌ | 🟡 | |
| Gestione ruoli granulare | ❌ | 🔴 | Administrator, Agent, Publisher, Incaricato, etc. |
| Export Excel generico | ❌ | 🟠 | Usato in molti punti |
| Upload/download allegati | 🔶 | 🔴 | Backend ok, frontend parziale |

---

## 5. DATABASE - TABELLE MANCANTI

### Completamente mancanti:
- `fonti_web` + `fonti_web_categorie` + `fonti_web_regulars` + `fonti_web_tipologie`
- `fonti_web_sync_check` + `fonti_testi_chiave`
- `sinc_siti_categorie` + `sinc_siti_espressioni` + `sinc_siti_siti`
- `fatture` + `fatture_pro_forma` + `dettaglio_fattura`
- `users_periodi` (subscription periods)
- `users_regioni` + `users_regioni_bandi` + `users_soa` + `users_soa_bandi`
- `users_soa_bandi_province` + `users_soa_esiti_province`
- `user_emails` (email aggiuntive)
- `agenti_incaricati` + `agenti_regioni`
- `incaricati_province`
- `azienda_personale`
- `modifiche_azienda` + `modifiche_stazioni`
- `iscrizione_stazioni`
- `personale_stazione`
- `stazioni_presidia`
- `consorzi`
- `downloads` (log download)
- `api` (chiavi API)
- `doppie_login`
- `job_messages` + `job_results`
- `eventi_aziende` + `note_aziende`
- `users_to_send`

### Parzialmente implementate:
- `gare_ricorsi` + `gare_ricorsi_utenti` (schema esiste ma senza logica)
- `attestazioni` + `attestazioni_aziende` (schema esiste ma senza CRUD)

---

## 6. RIEPILOGO QUANTITATIVO

| Area | Implementate | Parziali | Mancanti | Totale |
|------|-------------|----------|----------|--------|
| Bandi Gestionale | 8 | 1 | 18 | 27 |
| Bandi Servizi | 0 | 0 | 9 | 9 |
| Esiti Gestionale | 6 | 1 | 16 | 23 |
| Aziende | 0 | 1 | 13 | 14 |
| Stazioni | 0 | 1 | 11 | 12 |
| Utenti | 0 | 1 | 20 | 21 |
| Concorrenti | 0 | 0 | 6 | 6 |
| Esecutori/Intermediari | 0 | 0 | 6 | 6 |
| Dashboard | 0 | 1 | 5 | 6 |
| Fonti Web | 0 | 0 | 5 | 5 |
| Area Clienti Home | 0 | 0 | 4 | 4 |
| Clienti Bandi | 0 | 2 | 8 | 10 |
| Clienti Esiti | 0 | 1 | 6 | 7 |
| **SIMULAZIONI** | 2 | 0 | **20** | 22 |
| Analisi Azienda | 0 | 0 | 7 | 7 |
| ATI/Avvalimenti | 0 | 0 | 4 | 4 |
| Sito Pubblico | 10 | 0 | 7 | 17 |
| Sistema | 2 | 3 | 10 | 15 |
| **TOTALE** | **28** | **12** | **175** | **215** |

---

## 7. PIANO IMPLEMENTAZIONE SUGGERITO

### FASE 1 - Core Gestionale (Priorità 🔴)
1. Utenti completo (CRUD + abbonamenti + fatturazione)
2. Aziende completo (CRUD + attestazioni)
3. Stazioni completo (CRUD)
4. Bandi servizi (aperture, scritture, sopralluoghi)
5. CalcolaIDTipologiaEsito
6. ATI/Mandanti gestione esiti
7. Ruoli granulari

### FASE 2 - Area Clienti Core (Priorità 🔴)
8. Home utente con filtri personalizzati
9. Registro bandi + richieste servizi
10. Preferiti esiti
11. **MOTORE SIMULAZIONI COMPLETO** (51 tipologie)
12. Analisi azienda con grafici
13. Cambio password + recupera password

### FASE 3 - Operatività (Priorità 🟠)
14. Concorrenti, Esecutori, Intermediari
15. Dashboard per ruolo
16. Newsletter system
17. Calendario/agenda
18. Export Excel/XML
19. Clona bandi/esiti

### FASE 4 - Completamento (Priorità 🟡-🟢)
20. Fonti web / web scraping
21. Task scheduler
22. RSS feeds
23. API pubblica
24. Ricerca doppia
25. Error logging
