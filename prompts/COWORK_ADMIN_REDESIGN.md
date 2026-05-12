# Cowork Prompt — Redesign sezione admin (una alla volta)

Questo prompt si usa **una volta per ogni sotto-sezione** del gestionale
admin. Il contratto grafico (palette, tipografia, componenti) è in
`prompts/ADMIN_DESIGN_SYSTEM.md` — incollalo come secondo blocco nel
messaggio Claude/Cowork, prima di allegare l'HTML della sezione da
rifare.

---

## Setup (una volta per ogni nuova chat Claude/Cowork)

1. Vai su https://claude.ai → **nuova chat** → modello **Sonnet 4.5**
   (consigliato per qualità del codice + intuizione di design).
2. **Allega come file**:
   - `prompts/ADMIN_DESIGN_SYSTEM.md` (il design system)
   - L'estratto HTML della sezione da rifare (vedi sotto "Come estrarre")
3. Incolla il **prompt principale** (sotto la riga separatrice
   tripla `===`), sostituendo i 3 segnaposto `<SEZIONE_NOME>`,
   `<RIGHE_DA_A>`, `<SCREENSHOT_LINK_OPZIONALE>`.
4. Invia. Claude restituisce il **nuovo HTML/CSS** della sezione,
   pronto da incollare al posto dell'originale.

---

## Come estrarre l'HTML di una sezione

`admin/index.html` è un file di **26.651 righe** (SPA). Le pagine sono
contenitori con id `pageXxx`. Per estrarne uno usa `sed`:

```bash
# 1) trova le righe di una pagina (es. pageAziende)
grep -n 'id="pageAziende"\|pageCreateAzienda\|pageCestinoAziende' admin/index.html | head

# 2) estrai dalla riga A alla riga B
sed -n '3100,3400p' admin/index.html > /tmp/sezione-aziende.html

# 3) allega /tmp/sezione-aziende.html alla chat Claude
```

Oppure per le pagine standalone (es. `azienda-pagina.html`) le carichi
intere — sono già file separati di dimensioni gestibili.

---

## ====================================================================
## IL PROMPT (copialo a partire da qui, dopo aver allegato i 2 file)
## ====================================================================

Sei un senior frontend engineer + UI/UX designer. Mi aiuti a rifare la
**grafica** di una sezione del gestionale admin di easyWin (piattaforma
e-procurement italiana). Lo stack è HTML + CSS + JS vanilla — niente
React/Vue. La logica JS NON si tocca: solo struttura HTML, classi e
CSS.

## Contratto grafico

Vedi il file allegato `ADMIN_DESIGN_SYSTEM.md` per palette, tipografia,
componenti standard, motion, accessibilità. **Riusa i token CSS
indicati** (`var(--surface)`, `var(--accent)`, ecc.) invece di
hard-coded hex. Se aggiungi nuovi componenti, definisci eventuali
token nuovi nel `:root` della sezione (mai inline a caso).

## Sezione da rifare

Sezione: **<SEZIONE_NOME>**
Origine: `admin/index.html` (righe <RIGHE_DA_A>) — vedi file allegato.
Screenshot stato attuale (opzionale): <SCREENSHOT_LINK_OPZIONALE>

## Cosa devi fare

1. **Studia** il file allegato (HTML attuale): identifica le sotto-aree
   (filtri, tabelle, KPI, form, modal, empty state) e i pattern UI
   ricorrenti.
2. **Verifica** quali ID/classi/onclick sono referenziati dal JS:
   - cerca pattern come `document.getElementById('...')`,
     `querySelector('.classe-xxx')`, `onclick="funzione()"` nei
     blocchi `<script>` adiacenti.
   - **Questi NON si possono toccare**. Sono il contratto col JS.
3. **Riscrivi** la sezione applicando il design system:
   - sostituisci colori hard-coded con i token CSS,
   - sostituisci button generici con `.btn-primary` / `.btn-secondary`
     definiti nel design system,
   - tabelle dense con header maiuscolo + row hover + tabular-nums sui
     numeri,
   - KPI cards con grande numero font-head + label uppercase,
   - empty state con icona grande + testo muted + CTA opzionale,
   - filtri form con label sopra l'input + grid responsive.
4. **Aggiungi qualcosa di nuovo** solo se palesemente utile:
   - badge di stato dove c'è un boolean visualizzato come testo,
   - skeleton loading dove il JS oggi mostra "Caricamento...",
   - tooltip sui truncate (CIG, P.IVA),
   - chip count dei risultati,
   - barra di paginazione visibile se la tabella ha più di una pagina.
   Niente animazioni invadenti.
5. **Mantieni la struttura HTML semantica**: `<section>`, `<header>`,
   `<table>`, `<form>`, `<button>`. Niente div soup.
6. **Niente Tailwind/Bootstrap**: CSS scoped o classi semantiche con
   stile inline-style come ultima opzione. Preferisci `<style>`
   block in cima alla sezione con classi prefissate (es. `.az-` per
   Aziende, `.bn-` per Bandi).

## Output

Restituiscimi in **due blocchi di codice separati**:

1. **Blocco `html`** con la sezione completa rifatta (HTML + CSS scoped
   in `<style>` all'inizio). Pronta da incollare al posto delle righe
   originali in `admin/index.html`.
2. **Blocco `markdown`** con:
   - Lista degli **ID/classi/onclick** che hai preservato (per audit)
   - Lista degli **ID/classi nuovi** che hai introdotto (con nota se
     vanno cablati al JS — di solito no, sono solo style hooks)
   - Eventuali **TODO** che hai notato e non hai potuto risolvere
     senza toccare la logica JS (es. "il JS popola la tabella con un
     `<tr>` di 6 colonne, ho mantenuto l'ordine ma la 4ª colonna nel
     vecchio era 'Stato' come testo libero — suggerirei di
     trasformarla in badge ma serve modificare la funzione
     `renderRow()` riga 1234").

## Vincoli stringenti

- **NON cambiare** ID/name/onclick/action di nessun elemento.
- **NON cambiare** ordine delle colonne in tabelle (il JS li popola
  per posizione).
- **NON aggiungere** nuove dipendenze (no librerie esterne nuove).
  Chart.js e Tom-Select sono già caricati globalmente — riusabili.
- **NON toccare** i blocchi `<script>` dentro la sezione, a meno che
  non sia un cambio strettamente necessario per il rendering
  iniziale (in tal caso segnalalo nel TODO).
- Font Awesome 6 è già caricato — usalo liberamente per le icone.
- Comfortaa + Inter sono i font da usare (Comfortaa già caricato,
  Inter caricalo via Google Fonts se serve).

Inizia analizzando l'HTML allegato e poi produci il blocco
ridisegnato.

## ====================================================================
## FINE DEL PROMPT
## ====================================================================

---

## Ordine consigliato delle sezioni da rifare

Faresti prima quelle viste **più di frequente** dagli operatori:

| Priorità | Sezione | File / Container | Tempo stimato |
|---|---|---|---|
| 1 | **Amministrazione (Dashboard generale)** | `admin/index.html` pageAmministrazione | 30 min |
| 2 | **Lista Bandi** | `admin/index.html` pageBandi | 30 min |
| 3 | **Lista Esiti** | `admin/index.html` pageEsiti | 30 min |
| 4 | **Lista Aziende** | `admin/index.html` pageAziende | 30 min |
| 5 | **Lista Stazioni** | `admin/index.html` pageStazioni | 25 min |
| 6 | **HOME UTENTI** | `admin/index.html` pageUtenti | 30 min |
| 7 | **Calendario / Agenda / Appuntamenti Bandi** | pageScadenze, pageAgendaMensile, pageAppuntamenti | 25 min ogni |
| 8 | **Albi Fornitori dashboard** | pageAlbiDashboard | 25 min |
| 9 | **Dettaglio Bando** (form 6 card) | `admin/bando-pagina.html` | 45 min |
| 10 | **Dettaglio Esito** + ATI + Avvalimenti + Graduatoria | 4 file standalone | 45 min totali |
| 11 | **Dettaglio Azienda** | `admin/azienda-pagina.html` | 30 min |
| 12 | **Dettaglio Utente** + sub-pagine selezione/storico | 6 file utente-*-pagina.html | 60 min totali |
| 13 | **Newsletter admin** | `admin/newsletter-admin.html` | 20 min |
| 14 | **Presidia admin** | `admin/presidia-admin.html` | 20 min |
| 15 | **SOA admin / Avvalimenti / Abbonamenti / SyncUrl** | 4 file standalone | 60 min totali |

Totale stimato: **8-10 chat Cowork**, ~5-8 ore di tempo totale "operatore".

---

## Workflow consigliato

1. **Per ogni sezione**:
   - Estrai HTML con sed
   - Apri nuova chat claude.ai (modello Sonnet 4.5)
   - Allega `ADMIN_DESIGN_SYSTEM.md` + l'estratto HTML
   - Incolla il prompt sostituendo i segnaposto
   - Ricevi il blocco HTML rifatto
2. **Incolla** nel file giusto al posto delle righe originali
3. **Verifica subito in locale**: `open admin/index.html` (o porta del
   server se in dev) e fai click intorno alla sezione rifatta
4. **Se qualcosa si rompe** (di solito succede su 1 sezione su 10):
   - Apri devtools → console → trova l'errore
   - Probabile causa: un ID era effettivamente referenziato dal JS in
     un posto che il prompt non aveva visto
   - Aggiungi nel prompt successivo "particolare attenzione a `#xxx`"
5. **Commit dedicato per ogni sezione**: messaggio tipo
   `refactor(admin/aziende): redesign UI con design system`
6. **Push e prosegui con la prossima sezione**

---

## Tip pratici

- **Una sezione per chat**: non chiedere "rifammi anche l'altra"
  nella stessa conversazione. Claude perde il filo.
- **Limite 1500-2000 righe HTML per chat**: se una sezione è più
  grande, dividila in 2 chat (es. "Lista Aziende — filtri" e "Lista
  Aziende — tabella + modal").
- **Salvati gli output**: ogni risposta di Claude tienila in
  `prompts/outputs/<sezione>.md` prima di applicarla. Se sbagli
  l'incolla, hai la fonte.
- **Riapplica il design system ad ogni file standalone**: dato che ogni
  file ha il suo `<head>`, devi inserire le CSS variables del :root in
  ognuno. Per evitare ripetizioni, crea `admin/admin-tokens.css` che
  contiene il blocco CSS variables + tipografia base, e includilo con
  `<link rel="stylesheet" href="admin-tokens.css">` in ogni file
  admin/*.html. Vale la pena fare il refactor prima della prima
  sezione, così tutte le successive partono già con le variabili
  caricate.
