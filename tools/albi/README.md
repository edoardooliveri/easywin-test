# Tools — Albi Fornitori Pipeline

Pipeline ripetibile per scansione, estrazione, import e restore
dei dati albi fornitori.

## Ordine di esecuzione

1. `scan-albi-completo.js` — Scansiona siti web stazioni appaltanti
   cercando pagine "albo fornitori". Strategia ibrida: URL pattern +
   DuckDuckGo fallback + keyword matching. Incrementale e interrompibile.
   - Input: tabella `stazioni` (DB PostgreSQL)
   - Output: `data/albi_fornitori_results.json`
   - Flags: `--limit N`, `--dry-run`, `--from-id N`, `--batch N`

2. `extract-albo-details.cjs` — Arricchisce i risultati della scansione
   con dettagli estratti dalle pagine piattaforma (documenti richiesti,
   procedura iscrizione). Merge nel file risultati.
   - Input: JSON su stdin (risultati con `ha_albo=true`)
   - Output: merge in `data/albi_fornitori_results.json`

3. `import-albi-da-scan.js` — Importa nel DB i risultati della scansione.
   Match stazione per ID o fuzzy su nome. Inserisce solo entry con
   `ha_albo=true`, converte documenti, deduplica.
   - Input: `data/albi_fornitori_results.json`
   - Output: tabella `albi_fornitori` (DB), report in `data/import-albi-report.json`
   - Flags: `--dry-run`, `--verbose`, `--file=<path>`

4. `restore-albi-campione-docs.js` — (Opzionale/fix) Ripristina documenti
   delle 16 stazioni campione sovrascritti dall'import precedente.
   - Input: `backend/data/albi-fornitori-campione.json`
   - Output: UPDATE su `albi_fornitori` (DB)
   - Flags: `--dry-run`

## Dipendenze

- Database: PostgreSQL (Neon mini-neon o prod), connessione via `DATABASE_URL` in `.env`
- Node.js packages: `pg`, `dotenv` (dal `backend/package.json`)
- Input esterno: siti web stazioni appaltanti (step 1), file campione (step 4)

## Output

I file di output sono ignorati da git (pattern `data/*.json` in
.gitignore). Restano sul disco locale per ispezione.

## Quando rigirare

Quando si aggiungono nuove stazioni appaltanti al DB o quando
Presidia/ANAC pubblicano aggiornamenti massivi degli elenchi.
Frequenza tipica: trimestrale o su richiesta.
