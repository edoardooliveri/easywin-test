# Cowork Prompt — Discovery Albi Fornitori

Questo è il prompt da copiare nella chat Anthropic (claude.ai) per far
scoprire a Claude se le stazioni appaltanti italiane hanno un albo
fornitori online, senza spendere credito API tuo.

---

## Come si usa

1. **Genera la lista stazioni** in locale:
   ```bash
   node scripts/genera-batch-albi.js --batch 1 --size 50
   ```
   Stampa su stdout (e salva in `data/cowork-batches/batch-001.json`) un
   blocco di 50 stazioni in formato JSON Lines pronto da incollare.

2. **Apri una nuova chat** su https://claude.ai (modello Sonnet 4.5
   consigliato per qualità, Haiku 4.5 per velocità). **Attiva la web
   search** (toggle in basso a sinistra quando componi il messaggio).

3. **Incolla il prompt sotto + la lista** del punto 1. Claude eseguirà
   le ricerche web e restituirà un blocco JSON conforme.

4. **Copia il JSON di risposta** in `data/cowork-batches/batch-001-out.json`.

5. **Importa nel JSON cumulativo** (poi importerai tutto nel DB con lo
   script `tools/albi/import-albi-da-scan.js` già pronto):
   ```bash
   node scripts/applica-batch-albi.js --in data/cowork-batches/batch-001-out.json
   ```

6. **Ripeti** con batch 2, 3, ... finché copri tutte le stazioni
   (ti consiglio batch da 30-50 alla volta — più di 50 Claude può
   andare in timeout o tagliare la risposta).

---

## IL PROMPT (copiala interamente sotto, e in fondo incolla la lista)

```
Sei un assistente che scopre se le **stazioni appaltanti italiane** hanno un **albo fornitori online**, per popolare un database di e-procurement.

INPUT
Ti darò una lista JSON di stazioni appaltanti. Schema di ogni elemento:
{
  "id": 1234,
  "ragione_sociale": "COMUNE DI ROMA",
  "citta": "Roma",
  "provincia": "RM",
  "sito_web": "https://www.comune.roma.it"   // opzionale, può mancare
}

COSA DEVI FARE PER OGNI STAZIONE
1. Fai web search (usa lo strumento web search disponibile) con query come:
     "<RAGIONE_SOCIALE>" "albo fornitori"
     "<RAGIONE_SOCIALE>" iscrizione fornitori
     site:<dominio_sito_web> albo fornitori    (se hai il sito)
2. Cerca pagine ufficiali della stazione (NO portali generici come
   acquistinretepa.it, MEPA, ecc. SOLO siti istituzionali o piattaforme
   dedicate alla stazione: TuttoGare, Net4market, Sintel, Maggioli,
   PortaleAppalti, GareTelematiche, ASMECOMM, ASMEL, DigitalPA,
   Sardegna CAT, ecc.).
3. Se trovi una pagina di "albo fornitori" o "elenco operatori
   economici" o "vendor list" attiva, leggi la pagina e estrai i dati.

OUTPUT
Restituisci ESATTAMENTE un blocco di codice JSON (nessun altro testo
prima o dopo, niente commenti) con uno snake_case di questa forma:

{
  "scanned": {
    "1234": {
      "id": 1234,
      "ragione_sociale": "COMUNE DI ROMA",
      "citta": "Roma",
      "ha_albo": true,
      "url_albo": "https://albofornitori.comune.roma.it/...",
      "piattaforma": "Maggioli Cloud",
      "categorie_soa": ["OG1", "OG3", "OS18A"],
      "documenti_richiesti": [
        "Visura camerale recente",
        "DURC in corso di validità",
        "Attestazione SOA (se lavori)",
        "Autocertificazione art. 80 D.Lgs 36/2023"
      ],
      "procedura_iscrizione": "Registrazione su portale, compilazione anagrafica, upload documenti, scelta categorie merceologiche, attesa approvazione.",
      "scadenza_iscrizione": null,
      "note": "Aperto tutto l'anno, rinnovo annuale auto.",
      "confidence": "alta",
      "source_url": "https://albofornitori.comune.roma.it/info"
    },
    "5678": {
      "id": 5678,
      "ragione_sociale": "COMUNE DI BORGOVALSUGANA",
      "citta": "Borgo Valsugana",
      "ha_albo": false,
      "url_albo": null,
      "piattaforma": null,
      "confidence": "media",
      "note": "Non trovata pagina dedicata; usano MEPA come unico canale."
    },
    "9999": {
      "id": 9999,
      "ragione_sociale": "STAZIONE INTROVABILE",
      "citta": "Sconosciuta",
      "ha_albo": null,
      "url_albo": null,
      "piattaforma": null,
      "confidence": "bassa",
      "note": "Nessuna pagina ufficiale rintracciata, da rivedere manualmente."
    }
  }
}

REGOLE STRINGENTI
- `ha_albo`: true SOLO se hai trovato una pagina con form di iscrizione
  o elenco aperto; false se il sito ufficiale esiste ma dichiara
  esplicitamente che NON ha albo (es. solo MEPA); null se non hai
  trovato informazioni affidabili.
- `confidence`:
    "alta"  = pagina ufficiale trovata, URL diretto verificato, almeno
              piattaforma + documenti chiari
    "media" = info parziali o piattaforma terza identificata ma form
              di iscrizione non chiarissimo
    "bassa" = inferenza non confermata; segnalare per review manuale
- `url_albo`: deve essere un URL CHE FUNZIONA (non un generico /home).
  Preferisci la pagina del modulo di iscrizione o quella dell'albo
  pubblico.
- `piattaforma`: usa nomi standard: "Maggioli Cloud", "TuttoGare",
  "Net4market", "Sintel", "Sardegna CAT", "ASMECOMM", "ASMEL",
  "DigitalPA", "GareTelematiche", "Portale Acquisti Iren",
  "PortaleAppalti (Maggioli)", "Portale proprietario" (se costruito
  in casa dalla stazione), "MEPA" SOLO se la stazione dichiara di
  usare ESCLUSIVAMENTE MEPA come albo.
- `categorie_soa`: array opzionale, codici SOA standard italiani
  (OG1..OG13, OS1..OS35, SF01..SF36) se elencati nella pagina.
- `documenti_richiesti`: array di stringhe brevi; documenti standard
  comuni vanno comunque elencati per chiarezza utente.
- `note`: max 200 caratteri.
- `source_url`: l'URL preciso da cui hai estratto le info principali.
- NIENTE testo fuori dal blocco JSON. NIENTE commenti dentro il JSON.
  Se non trovi nulla per una stazione, mettila comunque nel dizionario
  con ha_albo=null e confidence=bassa.

QUANDO NON HAI ABBASTANZA TEMPO PER TUTTE
Se 50 stazioni sono troppe per la finestra, processa quante puoi e
restituisci comunque il JSON parziale (solo le scanned completate).
NON inventare risultati per chiudere il batch: meglio meno e
accurate.

ECCO LA LISTA DA PROCESSARE:
```

[**Qui sotto incolli la lista** generata da `scripts/genera-batch-albi.js`]

---

## Note operative

- **Costo per te**: zero, perché la chat claude.ai è inclusa nel piano
  Pro/Team. Cowork (se l'hai attivato) è anche meglio: la tariffa è
  inclusa nel piano enterprise.
- **Rate**: 30-50 stazioni per chat. Oltre Claude può tagliare la
  risposta o saltare alcune entry.
- **Idempotenza**: il file cumulativo `data/albi_fornitori_results.json`
  viene aggiornato in modo non distruttivo (`applica-batch-albi.js`
  fa merge per id, l'ultima risposta vince).
- **Qualità**: ogni 5-10 batch fai uno spot check manuale dei record
  con confidence "alta" — apri 3-5 URL random e verifica che siano
  davvero la pagina dell'albo (anti-hallucination).
- **Quando hai 1000+ albi nel JSON**: importi tutto nel DB con
  `node tools/albi/import-albi-da-scan.js` (script già pronto).
