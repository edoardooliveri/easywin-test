#!/usr/bin/env node
/**
 * PHASE 3: Main Data Migration
 * Migrates: bandi (with UUID generation), gare (with variant system), dettaglio_gara,
 *           allegati_bando, junction tables (bandi_soa_*, bandi_province, gare_soa_*, gare_province, etc.)
 *
 * This is the LARGEST phase - bandi.csv is ~907MB, dettaglio_gara ~596MB
 */
import { getPool, closePool, readCsv, cleanVal, log, logPhase, createBatchCollector } from './utils.js';
import { randomUUID } from 'crypto';

const PHASE = '3';

// Global UUID mapping: old INT id_bando → new UUID
const bandiUuidMap = new Map();

// Pre-loaded valid FK sets
let validStazioniIds = new Set();
let validSoaIds = new Set();

// ============================================================
// SCHEMA FIX: Widen varchar columns that are too narrow for real data
// ============================================================
async function fixSchemaForMigration(pool) {
  logPhase(PHASE, 'Fixing schema constraints for migration...');
  const alterations = [
    // Bandi — widen narrow varchar cols to TEXT
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
    `ALTER TABLE bandi ALTER COLUMN sped_pec TYPE TEXT`,
    `ALTER TABLE bandi ALTER COLUMN sped_posta TYPE TEXT`,
    `ALTER TABLE bandi ALTER COLUMN sped_corriere TYPE TEXT`,
    `ALTER TABLE bandi ALTER COLUMN sped_mano TYPE TEXT`,
    `ALTER TABLE bandi ALTER COLUMN sped_telematica TYPE TEXT`,
    `ALTER TABLE bandi ALTER COLUMN provenienza TYPE TEXT`,
    `ALTER TABLE bandi ALTER COLUMN external_code TYPE TEXT`,
    `ALTER TABLE bandi ALTER COLUMN fonte_dati TYPE TEXT`,
    // Gare — widen too
    `ALTER TABLE gare ALTER COLUMN indirizzo TYPE TEXT`,
    `ALTER TABLE gare ALTER COLUMN citta TYPE TEXT`,
    `ALTER TABLE gare ALTER COLUMN codice_cig TYPE VARCHAR(50)`,
    `ALTER TABLE gare ALTER COLUMN provenienza TYPE TEXT`,
    `ALTER TABLE gare ALTER COLUMN external_code TYPE TEXT`,
    `ALTER TABLE gare ALTER COLUMN fonte_dati TYPE TEXT`,
    // Aziende cap
    `ALTER TABLE aziende ALTER COLUMN cap TYPE VARCHAR(20)`,
  ];

  let fixed = 0;
  for (const sql of alterations) {
    try {
      await pool.query(sql);
      fixed++;
    } catch (err) {
      // Column might not exist or already correct type — skip silently
    }
  }
  logPhase(PHASE, `  Schema fixes applied: ${fixed}/${alterations.length}`);

  // Temporarily drop ALL foreign key constraints on migration target tables
  // This avoids FK violations during bulk migration — data integrity is checked after
  const targetTables = [
    'bandi', 'gare', 'dettaglio_gara',
    'bandi_soa_sec', 'bandi_soa_alt', 'bandi_soa_app', 'bandi_soa_sost',
    'bandi_province', 'bandi_modifiche', 'bandi_probabilita',
    'gare_province', 'gare_soa',
    'simulazioni', 'simulazioni_dettagli',
    'registro_gare', 'richieste_servizi'
  ];

  let droppedFks = 0;
  for (const table of targetTables) {
    try {
      const fkRes = await pool.query(`
        SELECT conname FROM pg_constraint
        WHERE conrelid = $1::regclass AND contype = 'f'
      `, [table]);
      for (const fk of fkRes.rows) {
        try {
          await pool.query(`ALTER TABLE ${table} DROP CONSTRAINT ${fk.conname}`);
          droppedFks++;
        } catch (err) {}
      }
    } catch (err) {
      // Table might not exist yet
    }
  }
  logPhase(PHASE, `  Dropped ${droppedFks} FK constraints (will restore after migration)`);
}

// ============================================================
// BANDI (Tenders) - UUID generation required
// ============================================================
async function migrateBandi(pool) {
  logPhase(PHASE, 'Migrating BANDI (UUID generation)...');
  let count = 0;
  let errors = 0;

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
    'id_tipo_spedizione', 'sped_pec', 'sped_posta', 'sped_corriere', 'sped_mano',
    'sped_telematica', 'indirizzo_pec', 'indirizzo_elaborati',
    'max_invitati_negoziate', 'comunicazione_diretta_data', 'provenienza',
    'external_code', 'fonte_dati', 'annullato', 'privato', 'note',
    'note_01', 'note_02', 'note_03', 'note_04', 'note_05',
    'username_controllo', 'note_controllo', 'creatore_avviso',
    'username_avviso', 'note_avviso', 'inserito_da', 'data_inserimento',
    'modificato_da', 'data_modifica',
    'ai_processed', 'created_at', 'updated_at'
  ];

  const collector = createBatchCollector(pool, 'bandi', columns, 200, '(id) DO NOTHING');

  for await (const row of readCsv('bandi')) {
    const oldId = cleanVal(row.id_bando, 'int');
    if (!oldId) continue;

    // Generate UUID for this bando BEFORE adding to batch
    const uuid = randomUUID();
    bandiUuidMap.set(oldId, uuid);

    const params = [
      uuid,
      cleanVal(row.id_stazione, 'int'),
      cleanVal(row.Stazione),
      cleanVal(row.Titolo) || 'Senza titolo',
      cleanVal(row.DataPubblicazione, 'date') || '2000-01-01',
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
      cleanVal(row.SpedPEC, 'bool'),
      cleanVal(row.SpedPosta, 'bool'),
      cleanVal(row.SpedCorriere, 'bool'),
      cleanVal(row.SpedMano, 'bool'),
      cleanVal(row.SpedTelematica, 'bool'),
      cleanVal(row.IndirizzoPEC),
      cleanVal(row.IndirizzoElaborati),
      cleanVal(row.MaxInvitatiNegoziate, 'int') || 0,
      cleanVal(row.ComunicazioneDirettaData, 'bool'),
      cleanVal(row.Provenienza),
      cleanVal(row.ExternalCode),
      cleanVal(row.FonteDati),
      cleanVal(row.Annullato, 'bool'),
      cleanVal(row.Privato, 'int') || 0,
      cleanVal(row.Note),
      cleanVal(row.Note01),
      cleanVal(row.Note02),
      cleanVal(row.Note03),
      cleanVal(row.Note04),
      cleanVal(row.Note05),
      cleanVal(row.UsernameControllo),
      cleanVal(row.NoteControllo),
      cleanVal(row.CreatoreAvviso),
      cleanVal(row.UsernameAvviso),
      cleanVal(row.NoteAvviso),
      cleanVal(row.InseritoDa),
      cleanVal(row.DataInserimento, 'timestamp') || new Date().toISOString(),
      cleanVal(row.ModificatoDa),
      cleanVal(row.DataModifica, 'timestamp'),
      false,  // ai_processed
      new Date().toISOString(),  // created_at
      new Date().toISOString()   // updated_at
    ];

    try {
      await collector.add(params);
      count++;

      if (count % 10000 === 0) {
        log(`  Bandi progress: ${count} rows (${collector.errors} batch errors, ${bandiUuidMap.size} UUIDs mapped)...`);
      }
    } catch (err) {
      errors++;
      if (errors <= 10) {
        console.error(`  Bandi error [old_id=${oldId}]: ${err.message}`);
      }
    }
  }

  await collector.flush();
  logPhase(PHASE, `  Bandi: ${count} rows migrated, ${collector.total} inserted, ${collector.errors} errors, ${bandiUuidMap.size} UUID mappings`);
  return count;
}

// ============================================================
// GARE (Results) - with variant system handling
// ============================================================
async function migrateGare(pool) {
  logPhase(PHASE, 'Migrating GARE (with variant system)...');
  let count = 0;
  let variantCount = 0;
  let errors = 0;

  const columns = [
    'id', 'id_bando', 'data', 'titolo', 'codice_cig', 'cap', 'citta', 'indirizzo',
    'id_stazione', 'id_soa', 'soa_val', 'id_tipologia', 'id_tipo_dati', 'id_piattaforma',
    'importo', 'importo_soa_prevalente', 'n_partecipanti', 'n_sorteggio', 'n_decimali',
    'id_vincitore', 'ribasso', 'media_ar', 'soglia_an', 'media_sc',
    'soglia_riferimento', 'accorpa_ali', 'tipo_accorpa_ali', 'limit_min_media',
    'annullato', 'privato', 'provenienza', 'external_code', 'fonte_dati', 'note',
    'enabled', 'eliminata', 'temp', 'lat', 'lon', 'enable_to_all', 'bloccato',
    'username', 'username_modifica', 'data_inserimento', 'data_modifica', 'data_abilitazione',
    'max_invitati_negoziate', 'variante',
    'ai_processed', 'created_at', 'updated_at'
  ];

  const collector = createBatchCollector(pool, 'gare', columns, 300, '(id) DO NOTHING');
  const variantUpdates = [];  // Collect variant 2 updates for batch processing

  for await (const row of readCsv('gare')) {
    const id = cleanVal(row.id, 'int');
    if (!id) continue;

    // Map old id_bando to new UUID - MUST keep this before adding to batch
    const oldIdBando = cleanVal(row.id_bando, 'int');
    const newIdBando = oldIdBando ? bandiUuidMap.get(oldIdBando) : null;

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
      cleanVal(row.temp, 'bool'),
      cleanVal(row.lat, 'float'),
      cleanVal(row.lon, 'float'),
      cleanVal(row.EnableToAll, 'bool'),
      cleanVal(row.Bloccato, 'bool'),
      cleanVal(row.username),
      cleanVal(row.usernameModifica),
      cleanVal(row.DataInserimento, 'timestamp'),
      cleanVal(row.DataModifica, 'timestamp'),
      cleanVal(row.DataAbilitazione, 'timestamp'),
      cleanVal(row.MaxInvitatiNegoziate, 'int') || 0,
      cleanVal(row.Variante) || 'BASE',
      false,  // ai_processed
      new Date().toISOString(),  // created_at
      new Date().toISOString()   // updated_at
    ];

    try {
      await collector.add(params);
      count++;

      // Handle Variant 2: if MediaAr2 is present, collect update for batch
      const mediaAr2 = cleanVal(row.MediaAr2, 'decimal');
      if (mediaAr2 !== null) {
        variantCount++;
        variantUpdates.push({
          id,
          mediaAr2,
          sogliaAn2: cleanVal(row.SogliaAn2, 'decimal'),
          ribasso2: cleanVal(row.Ribasso2, 'decimal'),
          idVincitore2: cleanVal(row.id_vincitore2, 'int')
        });
      }

      if (count % 10000 === 0) {
        log(`  Gare progress: ${count} rows (${variantCount} variants, ${collector.errors} batch errors)...`);
      }
    } catch (err) {
      errors++;
      if (errors <= 10) {
        console.error(`  Gare error [${id}]: ${err.message}`);
      }
    }
  }

  await collector.flush();

  // Process variant updates in batches
  if (variantUpdates.length > 0) {
    const variantCollector = createBatchCollector(pool, 'gare', ['note', 'id'], 300);
    for (const variant of variantUpdates) {
      const noteAppend = `\n[VARIANT_ALT: MediaAr2=${variant.mediaAr2 || ''}, SogliaAn2=${variant.sogliaAn2 || ''}, Ribasso2=${variant.ribasso2 || ''}, id_vincitore2=${variant.idVincitore2 || ''}]`;
      await pool.query(
        `UPDATE gare SET note = COALESCE(note, '') || $1 WHERE id = $2`,
        [noteAppend, variant.id]
      ).catch(() => {}); // Non-critical
    }
  }

  await pool.query(`SELECT setval('gare_id_seq', (SELECT COALESCE(MAX(id),0) FROM gare))`);
  logPhase(PHASE, `  Gare: ${count} rows migrated, ${variantCount} with variant data, ${collector.errors} errors`);
  return count;
}

// ============================================================
// DETTAGLIO_GARA (Bid Details)
// ============================================================
async function migrateDettaglioGara(pool) {
  logPhase(PHASE, 'Migrating DETTAGLIO_GARA...');
  let count = 0;

  const columns = [
    'id_gara', 'variante', 'id_azienda', 'ati_avv', 'posizione', 'ribasso',
    'taglio_ali', 'm_media_arit', 'anomala', 'vincitrice', 'ammessa',
    'ammessa_riserva', 'esclusa', 'note', 'insert_position', 'da_verificare',
    'sconosciuto', 'pari_merito',
    'id_azienda_esecutrice_1', 'id_azienda_esecutrice_2',
    'id_azienda_esecutrice_3', 'id_azienda_esecutrice_4', 'id_azienda_esecutrice_5'
  ];

  const collector = createBatchCollector(pool, 'dettaglio_gara', columns, 1000, 'DO NOTHING');

  for await (const row of readCsv('dettaglio_gara')) {
    const idGara = cleanVal(row.id_gara, 'int');
    const idAzienda = cleanVal(row.id_azienda, 'int');
    if (!idGara) continue;

    const params = [
      idGara,
      cleanVal(row.Variante) || 'BASE',
      idAzienda,
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
      count++;

      if (count % 20000 === 0) {
        log(`  Dettaglio gara progress: ${count} rows (${collector.errors} batch errors)...`);
      }
    } catch (err) {
      // error already logged by collector
    }
  }

  await collector.flush();
  logPhase(PHASE, `  Dettaglio gara: ${count} rows migrated, ${collector.total} inserted, ${collector.errors} errors`);
  return count;
}

// ============================================================
// JUNCTION TABLES (bandi_soa_*, bandi_province, gare_soa_*, gare_province, etc.)
// ============================================================
async function migrateJunctionTables(pool) {
  logPhase(PHASE, 'Migrating junction tables...');
  const results = {};

  // BANDI_SOA_SEC
  results.bandi_soa_sec = await migrateJunction(pool, 'bandi_soa_sec', 'bandi_soa_sec',
    ['id_bando', 'id_soa', 'soa_val'],
    (row) => {
      const oldId = cleanVal(row.id_bando, 'int');
      return [bandiUuidMap.get(oldId), cleanVal(row.id_soa, 'int'), cleanVal(row.SoaVal, 'int')];
    },
    'uuid'
  );

  // BANDI_SOA_ALT
  results.bandi_soa_alt = await migrateJunction(pool, 'bandi_soa_alt', 'bandi_soa_alt',
    ['id_bando', 'id_soa', 'soa_val'],
    (row) => {
      const oldId = cleanVal(row.id_bando, 'int');
      return [bandiUuidMap.get(oldId), cleanVal(row.id_soa, 'int'), cleanVal(row.SoaVal, 'int')];
    },
    'uuid'
  );

  // BANDI_SOA_APP
  results.bandi_soa_app = await migrateJunction(pool, 'bandi_soa_app', 'bandi_soa_app',
    ['id_bando', 'id_soa', 'soa_val'],
    (row) => {
      const oldId = cleanVal(row.id_bando, 'int');
      return [bandiUuidMap.get(oldId), cleanVal(row.id_soa, 'int'), cleanVal(row.SoaVal, 'int')];
    },
    'uuid'
  );

  // BANDI_PROVINCE
  results.bandi_province = await migrateJunction(pool, 'bandi_province', 'bandi_province',
    ['id_bando', 'id_provincia'],
    (row) => {
      const oldId = cleanVal(row.id_bando, 'int');
      return [bandiUuidMap.get(oldId), cleanVal(row.id_provincia, 'int')];
    },
    'uuid'
  );

  // BANDI_MODIFICHE
  results.bandi_modifiche = await migrateJunction(pool, 'bandi_modifiche', 'bandi_modifiche',
    ['id_bando', 'username', 'data_modifica', 'nota'],
    (row) => {
      const oldId = cleanVal(row.id_bando, 'int');
      return [
        bandiUuidMap.get(oldId),
        cleanVal(row.username || row.UserName),
        cleanVal(row.DataModifica || row.Data, 'timestamp'),
        cleanVal(row.Nota || row.Note)
      ];
    },
    'uuid'
  );

  // GARE_PROVINCE
  results.gare_province = await migrateJunction(pool, 'gare_province', 'gare_province',
    ['id_gara', 'id_provincia'],
    (row) => [cleanVal(row.id_gara || row.id, 'int'), cleanVal(row.id_provincia, 'int')],
    'int'
  );

  // GARE_SOA_SEC
  results.gare_soa_sec = await migrateJunction(pool, 'gare_soa_sec', 'gare_soa',
    ['id_gara', 'id_soa', 'tipo'],
    (row) => [cleanVal(row.id_gara || row.id, 'int'), cleanVal(row.id_soa, 'int'), 'SEC'],
    'int'
  );

  // GARE_SOA_ALT
  results.gare_soa_alt = await migrateJunction(pool, 'gare_soa_alt', 'gare_soa',
    ['id_gara', 'id_soa', 'tipo'],
    (row) => [cleanVal(row.id_gara || row.id, 'int'), cleanVal(row.id_soa, 'int'), 'ALT'],
    'int'
  );

  // GARE_SOA_APP
  results.gare_soa_app = await migrateJunction(pool, 'gare_soa_app', 'gare_soa',
    ['id_gara', 'id_soa', 'tipo'],
    (row) => [cleanVal(row.id_gara || row.id, 'int'), cleanVal(row.id_soa, 'int'), 'APP'],
    'int'
  );

  logPhase(PHASE, `Junction tables results: ${JSON.stringify(results)}`);
  return results;
}

async function migrateJunction(pool, csvName, tableName, columns, mapFn, idType) {
  let count = 0;

  const collector = createBatchCollector(pool, tableName, columns, 1000, 'DO NOTHING');

  try {
    for await (const row of readCsv(csvName)) {
      const values = mapFn(row);
      // Skip if UUID mapping failed (first value is null for UUID type)
      if (idType === 'uuid' && !values[0]) continue;
      if (values.some(v => v === undefined)) continue;

      try {
        await collector.add(values);
        count++;

        if (count % 100000 === 0 && count > 0) {
          log(`  ${csvName}: ${count} rows...`);
        }
      } catch (err) {
        // error already logged by collector
      }
    }
    await collector.flush();
  } catch (err) {
    log(`  ${csvName}: file not found or error: ${err.message}`);
  }

  log(`  ${csvName} → ${tableName}: ${count} rows, ${collector.total} inserted, ${collector.errors} errors`);
  return count;
}

// ============================================================
// SIMULAZIONI (complete simulation system)
// ============================================================
async function migrateSimulazioni(pool) {
  logPhase(PHASE, 'Migrating SIMULAZIONI system...');

  // Simulazioni
  let simCount = 0;
  const simColumns = ['id', 'username', 'titolo', 'data_creazione', 'data_modifica', 'note'];
  const simCollector = createBatchCollector(pool, 'simulazioni', simColumns, 500, '(id) DO NOTHING');

  try {
    for await (const row of readCsv('simulazioni')) {
      const id = cleanVal(row.id || row.ID, 'int');
      if (!id) continue;
      try {
        await simCollector.add([
          id,
          cleanVal(row.username || row.UserName),
          cleanVal(row.Titolo || row.titolo) || 'Simulazione',
          cleanVal(row.DataCreazione || row.DataInserimento, 'timestamp'),
          cleanVal(row.DataModifica, 'timestamp'),
          cleanVal(row.Note || row.note)
        ]);
        simCount++;
      } catch (err) {}
    }
    await simCollector.flush();
    await pool.query(`SELECT setval('simulazioni_id_seq', (SELECT COALESCE(MAX(id),0) FROM simulazioni))`);
  } catch (err) {
    log(`  simulazioni error: ${err.message}`);
  }
  log(`  Simulazioni: ${simCount} rows, ${simCollector.total} inserted, ${simCollector.errors} errors`);

  // Simulazioni dettagli
  let detCount = 0;
  const detColumns = ['id_simulazione', 'id_azienda', 'ribasso', 'posizione', 'ammessa', 'esclusa'];
  const detCollector = createBatchCollector(pool, 'simulazioni_dettagli', detColumns, 1000, 'DO NOTHING');

  try {
    for await (const row of readCsv('simulazioni_dettagli')) {
      try {
        await detCollector.add([
          cleanVal(row.id_simulazione, 'int'),
          cleanVal(row.id_azienda, 'int'),
          cleanVal(row.Ribasso || row.ribasso, 'decimal'),
          cleanVal(row.Posizione || row.posizione, 'int'),
          cleanVal(row.Ammessa || row.ammessa, 'bool'),
          cleanVal(row.Esclusa || row.esclusa, 'bool')
        ]);
        detCount++;

        if (detCount % 100000 === 0) {
          log(`  Simulazioni dettagli progress: ${detCount} rows...`);
        }
      } catch (err) {}
    }
    await detCollector.flush();
  } catch (err) {
    log(`  simulazioni_dettagli error: ${err.message}`);
  }
  log(`  Simulazioni dettagli: ${detCount} rows, ${detCollector.total} inserted, ${detCollector.errors} errors`);

  return { simulazioni: simCount, dettagli: detCount };
}

// ============================================================
// ADDITIONAL TABLES: registro_gare, richieste_servizi, bandi_probabilita
// ============================================================
async function migrateAdditional(pool) {
  logPhase(PHASE, 'Migrating additional tables...');
  const results = {};

  // REGISTRO_GARE
  let count = 0;
  const regColumns = ['id_gara', 'username', 'data_registrazione', 'note'];
  const regCollector = createBatchCollector(pool, 'registro_gare', regColumns, 500, 'DO NOTHING');

  try {
    for await (const row of readCsv('registro_gare')) {
      const idGara = cleanVal(row.id_gara, 'int');
      if (!idGara) continue;
      try {
        await regCollector.add([
          idGara,
          cleanVal(row.username || row.UserName),
          cleanVal(row.Data || row.DataRegistrazione, 'timestamp'),
          cleanVal(row.Note)
        ]);
        count++;
      } catch (err) {}
    }
    await regCollector.flush();
  } catch (err) {}
  results.registro_gare = count;
  log(`  Registro gare: ${count} rows, ${regCollector.total} inserted, ${regCollector.errors} errors`);

  // RICHIESTE_SERVIZI
  count = 0;
  const richColumns = ['id_bando', 'username', 'data_richiesta', 'tipo', 'note'];
  const richCollector = createBatchCollector(pool, 'richieste_servizi', richColumns, 500, 'DO NOTHING');

  try {
    for await (const row of readCsv('richieste_servizi')) {
      try {
        await richCollector.add([
          bandiUuidMap.get(cleanVal(row.id_bando, 'int')),
          cleanVal(row.username || row.UserName),
          cleanVal(row.Data || row.DataRichiesta, 'timestamp'),
          cleanVal(row.Tipo || row.tipo),
          cleanVal(row.Note)
        ]);
        count++;
      } catch (err) {}
    }
    await richCollector.flush();
  } catch (err) {}
  results.richieste_servizi = count;
  log(`  Richieste servizi: ${count} rows, ${richCollector.total} inserted, ${richCollector.errors} errors`);

  // BANDI_PROBABILITA
  count = 0;
  const probColumns = ['id_bando', 'username', 'probabilita'];
  const probCollector = createBatchCollector(pool, 'bandi_probabilita', probColumns, 500, 'DO NOTHING');

  try {
    for await (const row of readCsv('bandi_probabilita')) {
      try {
        await probCollector.add([
          bandiUuidMap.get(cleanVal(row.id_bando, 'int')),
          cleanVal(row.username || row.UserName),
          cleanVal(row.Probabilita || row.probabilita, 'int')
        ]);
        count++;
      } catch (err) {}
    }
    await probCollector.flush();
  } catch (err) {}
  results.bandi_probabilita = count;
  log(`  Bandi probabilita: ${count} rows, ${probCollector.total} inserted, ${probCollector.errors} errors`);

  return results;
}

// ============================================================
// MAIN
// ============================================================
export async function runPhase3() {
  const pool = getPool();
  logPhase(PHASE, '=== MAIN DATA MIGRATION START ===');
  const start = Date.now();

  const results = {};

  // Step 0: Fix schema constraints for real data
  await fixSchemaForMigration(pool);

  // Step 1: Bandi (generates UUID map needed by everything else)
  results.bandi = await migrateBandi(pool);
  logPhase(PHASE, `UUID map size: ${bandiUuidMap.size} entries`);

  // Step 2: Gare (uses UUID map for id_bando)
  results.gare = await migrateGare(pool);

  // Step 3: Dettaglio gara
  results.dettaglioGara = await migrateDettaglioGara(pool);

  // Step 4: Junction tables
  results.junction = await migrateJunctionTables(pool);

  // Step 5: Simulazioni
  results.simulazioni = await migrateSimulazioni(pool);

  // Step 6: Additional tables
  results.additional = await migrateAdditional(pool);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  logPhase(PHASE, `=== MAIN DATA MIGRATION COMPLETE in ${elapsed}s ===`);
  logPhase(PHASE, `Results: ${JSON.stringify(results, null, 2)}`);
  return results;
}

// Export UUID map for external use
export function getBandiUuidMap() {
  return bandiUuidMap;
}

if (process.argv[1]?.includes('phase3')) {
  runPhase3().then(() => closePool()).catch(err => {
    console.error('Phase 3 failed:', err);
    closePool();
    process.exit(1);
  });
}
