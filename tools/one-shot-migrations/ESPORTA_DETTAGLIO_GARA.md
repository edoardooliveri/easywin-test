# Come esportare `DettaglioGara` da SQL Server e migrare in Neon

Questo documento spiega passo-passo come esportare la tabella `DettaglioGara` dal
SQL Server di produzione EasyWin e importarla nel database Neon del nuovo sito.

---

## 1. Esportare il CSV da SQL Server

Usa il tool `bcp` (fornito con SQL Server). Apri il prompt dei comandi sulla
macchina che ha accesso al DB di produzione e lancia:

```cmd
bcp "SELECT id_gara, 'BASE' AS Variante, id_azienda, NULL AS AtiAvv, Posizione, Ribasso, TaglioAli, MMediaArit, Anomala, Vincitrice, Ammessa, AmmessaRiserva, Esclusa, Note, InsertPosition, 0 AS DaVerificare, 0 AS Sconosciuto, 0 AS PariMerito, NULL AS IDAziendaEsecutrice1, NULL AS IDAziendaEsecutrice2, NULL AS IDAziendaEsecutrice3, NULL AS IDAziendaEsecutrice4, NULL AS IDAziendaEsecutrice5 FROM easywin.dbo.DettaglioGara" queryout "C:\easywin_export\dettaglio_gara.csv" -c -t"|" -r"\n" -S NOME_SERVER -U sa -P PASSWORD
```

Sostituisci:
- `NOME_SERVER` con il nome/IP del tuo SQL Server
- `PASSWORD` con la password dell'utente `sa` (o usa `-T` per autenticazione Windows)
- `C:\easywin_export\` con la cartella di destinazione

### Se il tuo schema di produzione ha più colonne
Se la tabella `DettaglioGara` su PROD ha già aggiunto i campi `Variante`,
`AtiAvv`, `DaVerificare`, `Sconosciuto`, `PariMerito`, `IDAziendaEsecutriceN`,
puoi semplificare a:

```cmd
bcp "SELECT id_gara, Variante, id_azienda, AtiAvv, Posizione, Ribasso, TaglioAli, MMediaArit, Anomala, Vincitrice, Ammessa, AmmessaRiserva, Esclusa, Note, InsertPosition, DaVerificare, Sconosciuto, PariMerito, IDAziendaEsecutrice1, IDAziendaEsecutrice2, IDAziendaEsecutrice3, IDAziendaEsecutrice4, IDAziendaEsecutrice5 FROM easywin.dbo.DettaglioGara" queryout "C:\easywin_export\dettaglio_gara.csv" -c -t"|" -r"\n" -S NOME_SERVER -U sa -P PASSWORD
```

### Aggiungere l'header sulla prima riga
`bcp` non scrive l'header. Crea a mano un file `dettaglio_gara_header.tmp` nella
stessa cartella, con **una sola riga** che contiene questo testo esatto:

```
id_gara|Variante|id_azienda|AtiAvv|Posizione|Ribasso|TaglioAli|MMediaArit|Anomala|Vincitrice|Ammessa|AmmessaRiserva|Esclusa|Note|InsertPosition|DaVerificare|Sconosciuto|PariMerito|IDAziendaEsecutrice1|IDAziendaEsecutrice2|IDAziendaEsecutrice3|IDAziendaEsecutrice4|IDAziendaEsecutrice5
```

In alternativa puoi aggiungere `UNION ALL SELECT 'id_gara','Variante',...` come
prima riga della query `bcp`, ma è più macchinoso.

Dimensioni attese: qualche centinaia di MB (il phase3-main originale dichiara ~596 MB).

---

## 2. Rendere il CSV accessibile a Claude

Metti il file in una cartella che Claude può leggere. La più semplice è una
**sottocartella del progetto già montato**:

```
C:\Users\...\sito easywin\backend\easywin_export\dettaglio_gara.csv
C:\Users\...\sito easywin\backend\easywin_export\dettaglio_gara_header.tmp
```

Oppure chiedi a Claude di montare una nuova cartella (es. il tuo Desktop dove
hai messo l'export).

---

## 3. Lanciare la migrazione

Dal terminale nella cartella `backend`:

```bash
node migration/run-dettaglio-gara-only.js --csv-dir ./easywin_export
```

Oppure passando un path assoluto se la cartella è altrove. Flag utili:

- `--limit 1000` → importa solo le prime 1000 righe (utile per test veloce)
- `--truncate` → svuota `dettaglio_gara` prima di importare (altrimenti fa
  append con `ON CONFLICT DO NOTHING`)

### Cosa fa lo script
1. Verifica che la tabella `dettaglio_gara` esista.
2. Carica in memoria tutti gli `id` di `gare` e `aziende` già presenti in Neon.
3. Legge il CSV riga per riga in streaming (memory-efficient, anche su file da 500+ MB).
4. Per ogni riga:
   - Salta se `id_gara` non esiste in `gare` Neon → stampa alla fine il conteggio.
   - Salta se `id_azienda` non esiste in `aziende` Neon → idem.
   - Inserisce in batch da 500 con `ON CONFLICT DO NOTHING` (non duplica righe già presenti).
5. Al termine stampa: righe lette, inserite, saltate FK gara, saltate FK azienda, errori.

### Output atteso
```
[START] dettaglio_gara ha attualmente 5000 righe
[DG] Caricamento id gare esistenti …
  145237 gare valide in Neon
  98234 aziende valide in Neon
  … 20000 inserite (lette 20000, skip FK gara=0, skip FK az=12)
  … 40000 inserite (…)
  …
[DG] FINITO in 420.3s
  righe CSV lette:        1245678
  righe inserite:         1240123
  saltate (gara mancante):3245
  saltate (az mancante):  2310
  errori batch:           0
  errori riga:            0
  totale in Neon adesso:  1245123
```

---

## 4. Verifica dopo la migrazione

Apri il pannello admin e vai su un qualsiasi esito recente (es. 145597). La
graduatoria dovrebbe adesso comparire. Oppure da console browser:

```js
fetch('/api/esiti/145597/graduatoria').then(r=>r.json()).then(j=>j.length)
```

Dovrebbe tornare il numero di partecipanti.

---

## Troubleshooting

**"relation dettaglio_gara does not exist"** → prima esegui la migrazione phase3-lite
che crea la tabella.

**"Cannot find module"** → assicurati di lanciare il comando dalla cartella `backend`, non da `migration`.

**Colonne mancanti nell'esito** → lo script salta automaticamente. Se hai un CSV
con colonne diverse da quelle attese, modifica `run-dettaglio-gara-only.js`
aggiungendo il nome corretto in `row.XXX`.

**File enorme, Node va in OOM** → aumenta la heap: `node --max-old-space-size=4096 migration/run-dettaglio-gara-only.js --csv-dir ...`
