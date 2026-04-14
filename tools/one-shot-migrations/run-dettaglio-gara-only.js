#!/usr/bin/env node
/**
 * STANDALONE: Migra solo dettaglio_gara.csv in Neon.
 * Non tocca bandi, gare, aziende.
 *
 * USO:
 *   node migration/run-dettaglio-gara-only.js --csv-dir /path/to/easywin_export
 *   node migration/run-dettaglio-gara-only.js --csv-dir /path/to/easywin_export --truncate
 *
 * OPZIONI:
 *   --csv-dir <path>   Cartella contenente dettaglio_gara.csv (e opzionale _header.tmp)
 *   --truncate         Svuota dettaglio_gara prima di importare (default: append con DO NOTHING)
 *   --limit <N>        Importa solo le prime N righe (utile per test)
 *   --skip-missing-fk  Salta righe con id_gara non presente in gare (default: abilitato)
 *
 * FORMATO CSV atteso (pipe-delimited, header sulla prima riga):
 *   id_gara|Variante|id_azienda|AtiAvv|Posizione|Ribasso|TaglioAli|MMediaArit|Anomala|Vincitrice|Ammessa|AmmessaRiserva|Esclusa|Note|InsertPosition|DaVerificare|Sconosciuto|PariMerito|IDAziendaEsecutrice1|IDAziendaEsecutrice2|IDAziendaEsecutrice3|IDAziendaEsecutrice4|IDAziendaEsecutrice5
 *
 * Le colonne mancanti diventano NULL. "NULL" e stringa vuota vengono normalizzate.
 */
import { getPool, closePool, readCsv, cleanVal, log, logPhase, createBatchCollector } from './utils.js';

const args = process.argv.slice(2);
const truncate = args.includes('--truncate');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : 0;

async function main() {
  const pool = getPool();
  const start = Date.now();

  // 1. Verifica che la tabella esista
  try {
    const r = await pool.query("SELECT COUNT(*)::int AS n FROM dettaglio_gara");
    log(`[START] dettaglio_gara ha attualmente ${r.rows[0].n} righe`);
  } catch (e) {
    console.error('ERRORE: la tabella dettaglio_gara non esiste in Neon.', e.message);
    process.exit(1);
  }

  // 2. (Opzionale) truncate
  if (truncate) {
    logPhase('DG', 'TRUNCATE dettaglio_gara …');
    await pool.query('TRUNCATE dettaglio_gara RESTART IDENTITY CASCADE');
  }

  // 3. Pre-carica tutti gli id_gara validi (per skippare FK broken senza FK vincolato)
  logPhase('DG', 'Caricamento id gare esistenti …');
  const gareRes = await pool.query('SELECT id FROM gare');
  const validGare = new Set(gareRes.rows.map(r => Number(r.id)));
  log(`  ${validGare.size} gare valide in Neon`);

  // 4. Pre-carica aziende valide (id → esiste)
  const azRes = await pool.query('SELECT id FROM aziende');
  const validAz = new Set(azRes.rows.map(r => Number(r.id)));
  log(`  ${validAz.size} aziende valide in Neon`);

  // 5. Colonne target in Neon (ordine del batch insert)
  const columns = [
    'id_gara', 'variante', 'id_azienda', 'ati_avv', 'posizione', 'ribasso',
    'taglio_ali', 'm_media_arit', 'anomala', 'vincitrice', 'ammessa',
    'ammessa_riserva', 'esclusa', 'note', 'inserimento', 'da_verificare',
    'sconosciuto', 'pari_merito',
    'id_azienda_esecutrice_1', 'id_azienda_esecutrice_2',
    'id_azienda_esecutrice_3', 'id_azienda_esecutrice_4', 'id_azienda_esecutrice_5'
  ];

  // NOTA: m_media_arit è BOOLEAN in Neon (non decimal come nel phase3-main originale)
  // quindi cleanVal con 'bool'
  const collector = createBatchCollector(pool, 'dettaglio_gara', columns, 500, 'DO NOTHING');

  let read = 0, kept = 0, skippedFkGara = 0, skippedFkAz = 0, errRows = 0;

  try {
    for await (const row of readCsv('dettaglio_gara')) {
      read++;
      if (LIMIT && kept >= LIMIT) break;

      const idGara = cleanVal(row.id_gara, 'int');
      const idAzienda = cleanVal(row.id_azienda, 'int');
      if (!idGara) { errRows++; continue; }

      // Skip se la gara non esiste in Neon (FK broken)
      if (!validGare.has(idGara)) { skippedFkGara++; continue; }
      // Skip se azienda non esiste (FK broken)
      if (idAzienda && !validAz.has(idAzienda)) { skippedFkAz++; continue; }

      const params = [
        idGara,
        cleanVal(row.Variante) || 'BASE',
        idAzienda,
        cleanVal(row.AtiAvv),
        cleanVal(row.Posizione, 'int'),
        cleanVal(row.Ribasso, 'decimal'),
        cleanVal(row.TaglioAli, 'bool'),
        cleanVal(row.MMediaArit, 'bool'),   // BOOLEAN in Neon
        cleanVal(row.Anomala, 'bool'),
        cleanVal(row.Vincitrice, 'bool'),
        cleanVal(row.Ammessa, 'bool'),
        cleanVal(row.AmmessaRiserva, 'bool'),
        cleanVal(row.Esclusa, 'bool'),
        cleanVal(row.Note),
        cleanVal(row.InsertPosition, 'int'),
        cleanVal(row.DaVerificare, 'bool'),
        cleanVal(row.Sconosciuto, 'bool'),
        cleanVal(row.PariMerito, 'bool'),
        cleanVal(row.IDAziendaEsecutrice1, 'int'),
        cleanVal(row.IDAziendaEsecutrice2, 'int'),
        cleanVal(row.IDAziendaEsecutrice3, 'int'),
        cleanVal(row.IDAziendaEsecutrice4, 'int'),
        cleanVal(row.IDAziendaEsecutrice5, 'int')
      ];

      try {
        await collector.add(params);
        kept++;
        if (kept % 20000 === 0) {
          log(`  … ${kept} inserite (lette ${read}, skip FK gara=${skippedFkGara}, skip FK az=${skippedFkAz})`);
        }
      } catch (e) {
        errRows++;
      }
    }

    await collector.flush();
  } catch (e) {
    console.error('ERRORE fatale durante lettura CSV:', e.message);
    throw e;
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  logPhase('DG', `FINITO in ${elapsed}s`);
  log(`  righe CSV lette:        ${read}`);
  log(`  righe inserite:         ${kept}`);
  log(`  saltate (gara mancante):${skippedFkGara}`);
  log(`  saltate (az mancante):  ${skippedFkAz}`);
  log(`  errori batch:           ${collector.errors}`);
  log(`  errori riga:            ${errRows}`);

  // Verifica finale
  const after = await pool.query('SELECT COUNT(*)::int AS n FROM dettaglio_gara');
  log(`  totale in Neon adesso:  ${after.rows[0].n}`);

  await closePool();
}

main().catch(e => {
  console.error('FALLITO:', e);
  process.exit(1);
});
