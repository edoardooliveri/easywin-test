# One-Shot Migration Scripts

Runner di migration già eseguiti in passato, conservati per
riferimento storico. **Non rigirare** — il loro effetto è già
nel DB corrente.

## File

- `run-migration-013.js` — eseguito per applicare la migration 013.
- `run-migration-add-gare-edit.js` — eseguito per aggiungere i
  campi di edit su gare (vedi backend/migration/ legacy).

Il workflow normale oggi usa AUTO_MIGRATIONS registrate in
`backend/src/server.js` — nessun runner manuale più necessario.
