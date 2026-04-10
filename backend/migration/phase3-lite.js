#!/usr/bin/env node
/**
 * PHASE 3 LITE: Essential Data Migration (512MB limit)
 *
 * Migrates only:
 * - bandi from 2022+ (~509k rows instead of 1.6M)
 * - gare linked to those bandi
 * - dettaglio_gara linked to those gare
 * - essential junction tables (bandi_province, bandi_soa_*, gare_province, gare_soa_*)
 *
 * SKIPS: simulazioni, allegati_bando, punteggi, bandi_modifiche, registro_gare
 */
import { getPool, closePool, readCsv, cleanVal, log, logPhase, createBatchCollector } from './utils.js';
import { randomUUID } from 'crypto';

const PHASE = '3L';
const YEAR_CUTOFF = 2022; // Only migrate bandi from this year onward

// Global UUID mapping: old INT id_bando → new UUID
const bandiUuidMap = new Map();
// Set of migrated gare IDs (for filtering dettaglio_gara)
const migratedGareIds = new Set();

// ============================================================
// SCHEMA FIX
// ============================================================
async function fixSchema(pool) {
  logPhase(PHASE, 'Fixing schema for migration...');

  // First: clear any partial data from previous failed runs
  const tablesToClear = [
    'dettaglio_gara', 'gare_soa', 'gare_province', 'gare',
    'bandi_province', 'bandi_soa_sec', 'bandi_soa_alt', 'bandi_soa_app', 'bandi_soa_sost',
    'bandi_modifiche', 'bandi_probabilita', 'richieste_servizi',
    'bandi'
  ];
  for (const t of tablesToClear) {
    try { await pool.query(`TRUNCATE TABLE ${t} CASCADE`); } catch (e) {}
  }
  logPhase(PHASE, '  Cleared partial data from previous runs');

  // Widen varchar columns
  const alterations = [
    `ALTER TABLE bandi ALTER COLUMN indirizzo TYPE TEXT`,
    `ALTER TABLE bandi ALTER COLUMN cap TYPE VARCHAR(20)`,
    `ALTER TABLE bandi ALTER COLUMN citta TYPE TEXT`,
    `ALTER TABLE bandi ALTER COLUMN regione TYPE TEXT`,
    `ALTER TABLE bandi ALTER COLUMN stazione_nome TYPE TEXT`,
    `ALTER TABLE bandi ALTER COLUMN codice_cig TYPE VARCHAR(50)`,
    `ALTER TABLE bandi ALTER COLUMN codice_cup TYPE VARCHAR(50)`,
    `ALTER TABLE bandi ALTER COLUMN indirizzo_pec TYPE TEXT`,
    `ALTER TABLE bandi ALTER COLUMN indirizzo_elaborati TYPE TEXT`,
    `ALTER TABLE bandi ALTER COLUMN note_per_sopralluogo TYPE TEXT`,
    `ALTER TABLE bandi ALTER COLUMN provenienza TYPE TEXT`,
    `ALTER TABLE bandi ALTER COLUMN external_code TYPE TEXT`,
    `ALTER TABLE bandi ALTER COLUMN fonte_dati TYPE TEXT`,
    `ALTER TABLE gare ALTER COLUMN indirizzo TYPE TEXT`,
    `ALTER TABLE gare ALTER COLUMN citta TYPE TEXT`,
    `ALTER TABLE gare ALTER COLUMN codice_cig TYPE VARCHAR(50)`,
    `ALTER TABLE gare ALTER COLUMN provenienza TYPE TEXT`,
    `ALTER TABLE gare ALTER COLUMN external_code TYPE TEXT`,
    `ALTER TABLE gare ALTER COLUMN fonte_dati TYPE TEXT`,
    `ALTER TABLE gare ALTER COLUMN titolo TYPE TEXT`,
    `ALTER TABLE gare ALTER COLUMN cap TYPE VARCHAR(20)`,
    `ALTER TABLE aziende ALTER COLUMN cap TYPE VARCHAR(20)`,
    // Bandi: widen remaining varchar columns that overflow
    `ALTER TABLE bandi ALTER COLUMN titolo TYPE TEXT`,
    `ALTER TABLE bandi ALTER COLUMN note TYPE TEXT`,
    `ALTER TABLE bandi ALTER COLUMN inserito_da TYPE TEXT`,
    `ALTER TABLE bandi ALTER COLUMN modificato_da TYPE TEXT`,
    // Bandi: fix smallint overflow (max_invitati_negoziate can exceed 32767)
    `ALTER TABLE bandi ALTER COLUMN max_invitati_negoziate TYPE INTEGER`,
    // Gare: widen remaining
    `ALTER TABLE gare ALTER COLUMN note TYPE TEXT`,
    `ALTER TABLE gare ALTER COLUMN username TYPE TEXT`,
    // Dettaglio_gara: add missing ati_avv column
    `ALTER TABLE dettaglio_gara ADD COLUMN IF NOT EXISTS ati_avv VARCHAR(10)`,
    // Dettaglio_gara: widen note
    `ALTER TABLE dettaglio_gara ALTER COLUMN note TYPE TEXT`,
  ];

  let fixed = 0;
  for (const sql of alterations) {
    try { await pool.query(sql); fixed++; } catch (e) {}
  }
  logPhase(PHASE, `  Schema fixes: ${fixed}/${alterations.length}`);

  // Drop FK constraints on target tables
  const targetTables = [
    'bandi', 'gare', 'dettaglio_gara',
    'bandi_soa_sec', 'bandi_soa_alt', 'bandi_soa_app', 'bandi_soa_sost',
    'bandi_province', 'bandi_modifiche', 'bandi_probabilita',
    'gare_province', 'gare_soa',
    'registro_gare', 'richieste_servizi'
  ];

  let dropped = 0;
  for (const table of targetTables) {
    try {
      const fkRes = await pool.query(`
        SELECT conname FROM pg_constraint
        WHERE conrelid = $1::regclass AND contype = 'f'
      `, [table]);
      for (const fk of fkRes.rows) {
        try { await pool.query(`ALTER TABLE ${table} DROP CONSTRAINT ${fk.conname}`); dropped++; } catch (e) {}
      }
    } catch (e) {}
  }
  logPhase(PHASE, `  Dropped ${dropped} FK constraints`);
}

// ============================================================
// BANDI (filtered by year)
// ============================================================
async function migrateBandi(pool) {
  logPhase(PHASE, `Migrating BANDI (${YEAR_CUTOFF}+ only)...`);
  let count = 0;
  let skippedOld = 0;

  const columns = [
    'id', 'id_stazione', 'stazione_nome', 'titolo', 'data_pubblicazione',
    'codice_cig', 'codice_cup', 'id_soa', 'soa_val', 'categoria_presunta',
    'categoria_sostitutiva', 'importo_soa_prevalente', 'importo_soa_sostitutiva',
    'importo_so', 'importo_co', 'importo_eco', 'oneri_progettazione', 'importo_manodopera',
    'soglia_riferimento', 'data_offerta', 'data_apertura', 'data_apertura_posticipata',
    'data_apertura_da_destinarsi', 'data_sop_start', 'data_sop_end',
    'data_max_per_sopralluogo', 'data_max_per_prenotazione', 'data_avviso',
    'ora_avviso', 'data_controllo', 'indirizzo', 'cap', 'citta', 'regione',
    'id_tipologia', 'id_tipologia_bando', 'id_criterio', 'id_piattaforma',
    'n_decimali', 'limit_min_media', 'accorpa_ali', 'tipo_accorpa_ali',
    'tipo_dati_esito', 'id_tipo_sopralluogo', 'note_per_sopralluogo',
    'id_tipo_spedizione',
    'indirizzo_pec', 'indirizzo_elaborati',
    'max_invitati_negoziate', 'provenienza',
    'external_code', 'fonte_dati', 'annullato', 'privato', 'note',
    'inserito_da', 'data_inserimento', 'modificato_da', 'data_modifica',
    'ai_processed', 'created_at', 'updated_at'
  ];

  const collector = createBatchCollector(pool, 'bandi', columns, 300, 'DO NOTHING', 'id');

  for await (const row of readCsv('bandi')) {
    const oldId = cleanVal(row.id_bando, 'int');
    if (!oldId) continue;

    // Year filter
    const dataPub = cleanVal(row.DataPubblicazione, 'date');
    if (dataPub) {
      const year = parseInt(dataPub.substring(0, 4), 10);
      if (year < YEAR_CUTOFF) {
        skippedOld++;
        continue;
      }
    } else {
      skippedOld++;
      continue; // Skip bandi without date
    }

    const uuid = randomUUID();
    bandiUuidMap.set(oldId, uuid);

    const params = [
      uuid,
      cleanVal(row.id_stazione, 'int'),
      cleanVal(row.Stazione),
      cleanVal(row.Titolo) || 'Senza titolo',
      dataPub,
      cleanVal(row.CodiceCIG),
      cleanVal(row.CodiceCUP),
      cleanVal(row.id_soa, 'int'),
      cleanVal(row.SoaVal, 'int'),
      cleanVal(row.CategoriaPresunta, 'bool'),
      cleanVal(row.CategoriaSostitutiva, 'int'),
      cleanVal(row.ImportoSoaPrevalente, 'decimal'),
      cleanVal(row.ImportoSoaSostitutiva, 'decimal'),
      cleanVal(row.ImportoSO, 'decimal'),
      cleanVal(row.ImportoCO, 'decimal'),
      cleanVal(row.ImportoEco, 'decimal'),
      cleanVal(row.OneriProgettazione, 'decimal'),
      cleanVal(row.ImportoManodopera, 'decimal'),
      cleanVal(row.SogliaRiferimento, 'float'),
      cleanVal(row.DataOfferta, 'timestamp'),
      cleanVal(row.DataApertura, 'timestamp'),
      cleanVal(row.DataAperturaPosticipata, 'timestamp'),
      cleanVal(row.DataAperturaDaDestinarsi, 'bool'),
      cleanVal(row.DataSopStart, 'timestamp'),
      cleanVal(row.DataSopEnd, 'timestamp'),
      cleanVal(row.DataMaxPerSopralluogo, 'timestamp'),
      cleanVal(row.DataMaxPerPrenotazione, 'timestamp'),
      cleanVal(row.DataAvviso, 'timestamp'),
      cleanVal(row.OraAvviso, 'timestamp'),
      cleanVal(row.DataControllo, 'timestamp'),
      cleanVal(row.Indirizzo),
      cleanVal(row.Cap),
      cleanVal(row.Citta),
      cleanVal(row.Regione),
      cleanVal(row.id_tipologia, 'int'),
      cleanVal(row.id_tipologia_bando, 'int'),
      cleanVal(row.id_criterio, 'int'),
      cleanVal(row.IDPiattaformaDigitale, 'int') || 0,
      cleanVal(row.NDecimali, 'int') || 3,
      cleanVal(row.LimitMinMedia, 'int'),
      cleanVal(row.AccorpaAli, 'bool'),
      cleanVal(row.TipoAccorpaALI, 'int'),
      cleanVal(row.TipoDatiEsito, 'int'),
      cleanVal(row.IDTipoSopralluogo, 'int') || 0,
      cleanVal(row.NotePerSopralluogo),
      cleanVal(row.IDTipoSpedizione, 'int') || 0,
      cleanVal(row.IndirizzoPEC),
      cleanVal(row.IndirizzoElaborati),
      cleanVal(row.MaxInvitatiNegoziate, 'int') || 0,
      cleanVal(row.Provenienza),
      cleanVal(row.ExternalCode),
      cleanVal(row.FonteDati),
      cleanVal(row.Annullato, 'bool'),
      cleanVal(row.Privato, 'int') || 0,
      cleanVal(row.Note),
      cleanVal(row.InseritoDa),
      cleanVal(row.DataInserimento, 'timestamp') || new Date().toISOString(),
      cleanVal(row.ModificatoDa),
      cleanVal(row.DataModifica, 'timestamp'),
      false,  // ai_processed
      new Date().toISOString(),
      new Date().toISOString()
    ];

    try {
      await collector.add(params);
      count++;
      if (count % 10000 === 0) {
        log(`  Bandi progress: ${count} migrated, ${skippedOld} skipped (old), ${collector.errors} errors...`);
      }
    } catch (err) {
      if (count < 5) console.error(`  Bandi error [${oldId}]: ${err.message}`);
    }
  }

  await collector.flush();
  logPhase(PHASE, `  Bandi: ${collector.total} rows migrated, ${skippedOld} skipped (before ${YEAR_CUTOFF}), ${collector.errors} errors`);
  logPhase(PHASE, `  UUID map: ${bandiUuidMap.size} entries`);
  return collector.total;
}

// ============================================================
// GARE (only those linked to migrated bandi)
// ============================================================
async function migrateGare(pool) {
  logPhase(PHASE, 'Migrating GARE (linked to migrated bandi only)...');
  let count = 0;
  let skipped = 0;

  const columns = [
    'id', 'id_bando', 'data', 'titolo', 'codice_cig', 'cap', 'citta', 'indirizzo',
    'id_stazione', 'id_soa', 'soa_val', 'id_tipologia', 'id_tipo_dati', 'id_piattaforma',
    'importo', 'importo_soa_prevalente', 'n_partecipanti', 'n_sorteggio', 'n_decimali',
    'id_vincitore', 'ribasso', 'media_ar', 'soglia_an', 'media_sc',
    'soglia_riferimento', 'accorpa_ali', 'tipo_accorpa_ali', 'limit_min_media',
    'annullato', 'privato', 'provenienza', 'external_code', 'fonte_dati', 'note',
    'enabled', 'eliminata', 'lat', 'lon',
    'username', 'data_inserimento', 'data_modifica',
    'variante',
    'ai_processed', 'created_at', 'updated_at'
  ];

  const collector = createBatchCollector(pool, 'gare', columns, 500, 'DO NOTHING', 'id');

  for await (const row of readCsv('gare')) {
    const id = cleanVal(row.id, 'int');
    if (!id) continue;

    const oldIdBando = cleanVal(row.id_bando, 'int');
    const newIdBando = oldIdBando ? bandiUuidMap.get(oldIdBando) : null;

    // Only migrate gare linked to migrated bandi
    if (!newIdBando) { skipped++; continue; }

    migratedGareIds.add(id);

    const params = [
      id,
      newIdBando,
      cleanVal(row.Data, 'date'),
      cleanVal(row.Titolo),
      cleanVal(row.CodiceCIG),
      cleanVal(row.Cap),
      cleanVal(row.Citta),
      cleanVal(row.Indirizzo),
      cleanVal(row.id_stazione, 'int'),
      cleanVal(row.id_soa, 'int'),
      cleanVal(row.SoaVal, 'int'),
      cleanVal(row.id_tipologia, 'int'),
      cleanVal(row.id_tipoDatiGara, 'int'),
      cleanVal(row.IDPiattaformaDigitale, 'int') || 1,
      cleanVal(row.Importo, 'decimal'),
      cleanVal(row.ImportoSoaPrevalente, 'decimal'),
      cleanVal(row.NPartecipanti, 'int') || 0,
      cleanVal(row.NSorteggio, 'int') || 0,
      cleanVal(row.NDecimali, 'int') || 3,
      cleanVal(row.id_vincitore, 'int'),
      cleanVal(row.Ribasso, 'decimal'),
      cleanVal(row.MediaAr, 'decimal'),
      cleanVal(row.SogliaAn, 'decimal'),
      cleanVal(row.MediaSc, 'decimal'),
      cleanVal(row.SogliaRiferimento, 'float'),
      cleanVal(row.AccorpaAli, 'bool'),
      cleanVal(row.TipoAccorpaALI, 'int'),
      cleanVal(row.LimitMinMedia, 'int'),
      cleanVal(row.Annullato, 'bool'),
      cleanVal(row.Privato) || 0,
      cleanVal(row.Provenienza),
      cleanVal(row.ExternalCode),
      cleanVal(row.FonteDati),
      cleanVal(row.Note),
      cleanVal(row.enabled, 'bool'),
      cleanVal(row.eliminata, 'bool'),
      cleanVal(row.lat, 'float'),
      cleanVal(row.lon, 'float'),
      cleanVal(row.username),
      cleanVal(row.DataInserimento, 'timestamp'),
      cleanVal(row.DataModifica, 'timestamp'),
      cleanVal(row.Variante) || 'BASE',
      false,
      new Date().toISOString(),
      new Date().toISOString()
    ];

    try {
      await collector.add(params);
      count++;
      if (count % 10000 === 0) {
        log(`  Gare progress: ${count} migrated, ${skipped} skipped...`);
      }
    } catch (err) {}
  }

  await collector.flush();
  await pool.query(`SELECT setval('gare_id_seq', GREATEST((SELECT COALESCE(MAX(id),0) FROM gare), 1))`);
  logPhase(PHASE, `  Gare: ${collector.total} rows migrated, ${skipped} skipped (no matching bando)`);
  return collector.total;
}

// ============================================================
// DETTAGLIO_GARA (only for migrated gare)
// ============================================================
async function migrateDettaglioGara(pool) {
  logPhase(PHASE, 'Migrating DETTAGLIO_GARA (linked to migrated gare only)...');
  let count = 0;
  let skipped = 0;

  const columns = [
    'id_gara', 'variante', 'id_azienda', 'ati_avv', 'posizione', 'ribasso',
    'taglio_ali', 'm_media_arit', 'anomala', 'vincitrice', 'ammessa',
    'ammessa_riserva', 'esclusa', 'note',
    'id_azienda_esecutrice_1', 'id_azienda_esecutrice_2',
    'id_azienda_esecutrice_3', 'id_azienda_esecutrice_4', 'id_azienda_esecutrice_5'
  ];

  const collector = createBatchCollector(pool, 'dettaglio_gara', columns, 1000, 'DO NOTHING');

  for await (const row of readCsv('dettaglio_gara')) {
    const idGara = cleanVal(row.id_gara, 'int');
    if (!idGara) continue;

    // Only migrate if gara was migrated
    if (!migratedGareIds.has(idGara)) { skipped++; continue; }

    const params = [
      idGara,
      cleanVal(row.Variante) || 'BASE',
      cleanVal(row.id_azienda, 'int'),
      cleanVal(row.AtiAvv),
      cleanVal(row.Posizione, 'int'),
      cleanVal(row.Ribasso, 'decimal'),
      cleanVal(row.TaglioAli, 'bool'),
      cleanVal(row.MMediaArit, 'decimal'),
      cleanVal(row.Anomala, 'bool'),
      cleanVal(row.Vincitrice, 'bool'),
      cleanVal(row.Ammessa, 'bool'),
      cleanVal(row.AmmessaRiserva, 'bool'),
      cleanVal(row.Esclusa, 'bool'),
      cleanVal(row.Note),
      cleanVal(row.IDAziendaEsecutrice1, 'int'),
      cleanVal(row.IDAziendaEsecutrice2, 'int'),
      cleanVal(row.IDAziendaEsecutrice3, 'int'),
      cleanVal(row.IDAziendaEsecutrice4, 'int'),
      cleanVal(row.IDAziendaEsecutrice5, 'int')
    ];

    try {
      await collector.add(params);
      count++;
      if (count % 20000 === 0) {
        log(`  Dettaglio gara progress: ${count} migrated, ${skipped} skipped...`);
      }
    } catch (err) {}
  }

  await collector.flush();
  logPhase(PHASE, `  Dettaglio gara: ${collector.total} rows migrated, ${skipped} skipped`);
  return collector.total;
}

// ============================================================
// JUNCTION TABLES
// ============================================================
async function migrateJunction(pool, csvName, tableName, columns, mapFn, filterFn) {
  let count = 0;
  let skipped = 0;
  const collector = createBatchCollector(pool, tableName, columns, 1000, 'DO NOTHING');

  try {
    for await (const row of readCsv(csvName)) {
      const values = mapFn(row);
      if (!values || (filterFn && !filterFn(row, values))) { skipped++; continue; }
      if (values.some(v => v === undefined || v === null && columns[values.indexOf(v)] !== 'soa_val')) {
        // Skip if primary key values are null
        if (!values[0] || !values[1]) { skipped++; continue; }
      }
      try {
        await collector.add(values);
        count++;
        if (count % 50000 === 0) log(`  ${csvName}: ${count} rows...`);
      } catch (err) {}
    }
    await collector.flush();
  } catch (err) {
    log(`  ${csvName}: ${err.message}`);
  }

  log(`  ${csvName} → ${tableName}: ${collector.total} inserted, ${skipped} skipped`);
  return collector.total;
}

async function migrateJunctionTables(pool) {
  logPhase(PHASE, 'Migrating junction tables...');
  const results = {};

  // BANDI junction tables — filter by bandiUuidMap
  const bandiFn = (row) => {
    const oldId = cleanVal(row.id_bando, 'int');
    const uuid = bandiUuidMap.get(oldId);
    return uuid ? [uuid, cleanVal(row.id_soa, 'int'), cleanVal(row.SoaVal, 'int')] : null;
  };

  results.bandi_soa_sec = await migrateJunction(pool, 'bandi_soa_sec', 'bandi_soa_sec',
    ['id_bando', 'id_soa', 'soa_val'], bandiFn);
  results.bandi_soa_alt = await migrateJunction(pool, 'bandi_soa_alt', 'bandi_soa_alt',
    ['id_bando', 'id_soa', 'soa_val'], bandiFn);
  results.bandi_soa_app = await migrateJunction(pool, 'bandi_soa_app', 'bandi_soa_app',
    ['id_bando', 'id_soa', 'soa_val'], bandiFn);

  results.bandi_province = await migrateJunction(pool, 'bandi_province', 'bandi_province',
    ['id_bando', 'id_provincia'], (row) => {
      const oldId = cleanVal(row.id_bando, 'int');
      const uuid = bandiUuidMap.get(oldId);
      return uuid ? [uuid, cleanVal(row.id_provincia, 'int')] : null;
    });

  // GARE junction tables — filter by migratedGareIds
  results.gare_province = await migrateJunction(pool, 'gare_province', 'gare_province',
    ['id_gara', 'id_provincia'], (row) => {
      const idGara = cleanVal(row.id_gara || row.id, 'int');
      return migratedGareIds.has(idGara) ? [idGara, cleanVal(row.id_provincia, 'int')] : null;
    });

  results.gare_soa_sec = await migrateJunction(pool, 'gare_soa_sec', 'gare_soa',
    ['id_gara', 'id_soa', 'tipo'], (row) => {
      const idGara = cleanVal(row.id_gara || row.id, 'int');
      return migratedGareIds.has(idGara) ? [idGara, cleanVal(row.id_soa, 'int'), 'SEC'] : null;
    });

  results.gare_soa_alt = await migrateJunction(pool, 'gare_soa_alt', 'gare_soa',
    ['id_gara', 'id_soa', 'tipo'], (row) => {
      const idGara = cleanVal(row.id_gara || row.id, 'int');
      return migratedGareIds.has(idGara) ? [idGara, cleanVal(row.id_soa, 'int'), 'ALT'] : null;
    });

  results.gare_soa_app = await migrateJunction(pool, 'gare_soa_app', 'gare_soa',
    ['id_gara', 'id_soa', 'tipo'], (row) => {
      const idGara = cleanVal(row.id_gara || row.id, 'int');
      return migratedGareIds.has(idGara) ? [idGara, cleanVal(row.id_soa, 'int'), 'APP'] : null;
    });

  logPhase(PHASE, `Junction results: ${JSON.stringify(results)}`);
  return results;
}

// ============================================================
// MAIN
// ============================================================
async function runPhase3Lite() {
  const pool = getPool();
  logPhase(PHASE, `=== LITE MIGRATION START (${YEAR_CUTOFF}+ only) ===`);
  const start = Date.now();

  await fixSchema(pool);

  const results = {};
  results.bandi = await migrateBandi(pool);
  logPhase(PHASE, `UUID map: ${bandiUuidMap.size} entries`);

  results.gare = await migrateGare(pool);
  logPhase(PHASE, `Migrated gare IDs: ${migratedGareIds.size}`);

  results.dettaglioGara = await migrateDettaglioGara(pool);
  results.junction = await migrateJunctionTables(pool);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  logPhase(PHASE, `=== LITE MIGRATION COMPLETE in ${elapsed}s ===`);
  logPhase(PHASE, `Results: ${JSON.stringify(results, null, 2)}`);

  // Show DB size
  try {
    const sizeRes = await pool.query(`SELECT pg_size_pretty(pg_database_size(current_database())) as size`);
    logPhase(PHASE, `Database size: ${sizeRes.rows[0].size}`);
  } catch (e) {}

  return results;
}

runPhase3Lite().then(() => closePool()).catch(err => {
  console.error('Phase 3 Lite failed:', err);
  closePool();
  process.exit(1);
});
