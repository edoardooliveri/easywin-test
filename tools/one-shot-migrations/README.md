# One-Shot Migration Scripts

Runner di migration già eseguiti in passato, conservati per
riferimento storico. **Non rigirare** — il loro effetto è già
nel DB corrente.

## File

- `run-migration-013.js` — eseguito per applicare la migration 013.
- `run-migration-add-gare-edit.js` — eseguito per aggiungere i
  campi di edit su gare. Lo schema change e' stato promosso a
  migration ufficiale 025_gare_edit_fields.sql.
- `run-dettaglio-gara-only.js` + `ESPORTA_DETTAGLIO_GARA.md` — import
  one-shot del dataset dettaglio_gara da CSV esportato da SQL Server.
  Gia' eseguito; il CSV ha gia' popolato la tabella in prod.

Il workflow normale oggi usa AUTO_MIGRATIONS registrate in
`backend/src/server.js` — nessun runner manuale più necessario.
