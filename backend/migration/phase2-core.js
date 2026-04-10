#!/usr/bin/env node
/**
 * PHASE 2: Core Tables Migration
 * Migrates: stazioni, aziende, attestazioni (from aziende SOA fields), users, users_periodi
 * These tables have foreign key dependencies on Phase 1 reference data.
 */
import { getPool, closePool, readCsv, cleanVal, log, logPhase, ProgressTracker, createBatchCollector } from './utils.js';

const PHASE = '2';

// ============================================================
// STAZIONI (Procurement Authorities)
// ============================================================
async function migrateStazioni(pool) {
  logPhase(PHASE, 'Migrating STAZIONI...');
  const tracker = new ProgressTracker('Stazioni', 0);

  const collector = createBatchCollector(
    pool,
    'stazioni',
    ['id', 'nome', 'indirizzo', 'cap', 'citta', 'id_provincia', 'telefono', 'partita_iva', 'email', 'codice_ausa', 'attivo'],
    500,
    'DO UPDATE SET nome = EXCLUDED.nome, indirizzo = EXCLUDED.indirizzo, cap = EXCLUDED.cap, citta = EXCLUDED.citta, id_provincia = EXCLUDED.id_provincia, telefono = EXCLUDED.telefono, partita_iva = EXCLUDED.partita_iva, email = EXCLUDED.email, codice_ausa = EXCLUDED.codice_ausa, attivo = EXCLUDED.attivo',
    'id'
  );

  for await (const row of readCsv('stazioni')) {
    const id = cleanVal(row.id, 'int');
    if (!id) continue;

    const nome = cleanVal(row.RagioneSociale) || cleanVal(row.Nome) || 'Sconosciuta';
    const indirizzo = cleanVal(row.Indirizzo);
    const cap = cleanVal(row.Cap);
    const citta = cleanVal(row['Città'] || row.Citta);
    const idProvincia = cleanVal(row.id_provincia, 'int');
    const telefono = cleanVal(row.Tel);
    const partitaIva = cleanVal(row.PartitaIva);
    const email = cleanVal(row.Email);
    const lat = cleanVal(row.Lat, 'float');
    const lng = cleanVal(row.Lon, 'float'); // Lon → lng
    const eliminata = cleanVal(row.eliminata, 'bool');
    const note = cleanVal(row.Note);
    const codiceAusa = cleanVal(row.COD); // primary COD → codice_ausa

    try {
      await collector.add([id, nome, indirizzo, cap, citta, idProvincia, telefono, partitaIva, email, codiceAusa, !eliminata]);
    } catch (err) {
      console.error(`  Stazioni error [${id}]: ${err.message}`);
      tracker.error();
    }
  }

  await collector.flush();
  await pool.query(`SELECT setval('stazioni_id_seq', (SELECT COALESCE(MAX(id),0) FROM stazioni))`);
  logPhase(PHASE, `  Stazioni: ${collector.total} rows migrated`);
  return collector.total;
}

// ============================================================
// AZIENDE (Companies) + ATTESTAZIONI extraction
// ============================================================
async function migrateAziende(pool) {
  logPhase(PHASE, 'Migrating AZIENDE + extracting ATTESTAZIONI...');

  // We need to collect SOA data for attestazioni extraction
  const soaData = [];

  // Pre-load valid province IDs for FK validation
  const validProvinceRes = await pool.query('SELECT id FROM province');
  const validProvinceIds = new Set(validProvinceRes.rows.map(r => r.id));
  let skippedCorrupt = 0;

  const collector = createBatchCollector(
    pool,
    'aziende',
    ['id', 'ragione_sociale', 'partita_iva', 'codice_fiscale', 'indirizzo', 'cap', 'citta', 'id_provincia', 'telefono', 'email', 'pec', 'note', 'attivo'],
    500,
    'DO UPDATE SET ragione_sociale = EXCLUDED.ragione_sociale, partita_iva = EXCLUDED.partita_iva, codice_fiscale = EXCLUDED.codice_fiscale, indirizzo = EXCLUDED.indirizzo, cap = EXCLUDED.cap, citta = EXCLUDED.citta, id_provincia = EXCLUDED.id_provincia, telefono = EXCLUDED.telefono, email = EXCLUDED.email, pec = EXCLUDED.pec, note = EXCLUDED.note, attivo = EXCLUDED.attivo',
    'id'
  );

  for await (const row of readCsv('aziende')) {
    const id = cleanVal(row.id, 'bigint');
    if (!id) continue;

    // Detect corrupted rows: if RagioneSociale looks like garbage or id is huge and nonsensical
    const ragioneSociale = cleanVal(row.RagioneSociale) || cleanVal(row.Nome) || 'Sconosciuta';
    if (ragioneSociale.length > 400) {
      skippedCorrupt++;
      continue; // Corrupted row from CSV pipe delimiter in Note field
    }

    const partitaIva = cleanVal(row.PartitaIva);
    const codiceFiscale = cleanVal(row.CodiceFiscale);
    const indirizzo = cleanVal(row.Indirizzo);
    const cap = cleanVal(row.Cap);
    const citta = cleanVal(row['Città'] || row.Citta);
    let idProvincia = cleanVal(row.id_provincia, 'int');
    const telefono = cleanVal(row.Tel);
    const email = cleanVal(row.Email);
    const pec = cleanVal(row.IndirizzoPEC);
    const note = cleanVal(row.Note);
    const eliminata = cleanVal(row.eliminata, 'bool');

    // Validate FK: id_provincia must exist in province table, otherwise set NULL
    if (idProvincia && !validProvinceIds.has(idProvincia)) {
      idProvincia = null;
    }

    // Truncate fields that could overflow varchar limits
    const safePiva = partitaIva ? partitaIva.substring(0, 50) : null;
    const safeCf = codiceFiscale ? codiceFiscale.substring(0, 50) : null;

    try {
      await collector.add([id, ragioneSociale, safePiva, safeCf, indirizzo, cap, citta, idProvincia, telefono, email, pec, note, !eliminata]);

      // Extract SOA attestazione if present
      const numeroSoa = cleanVal(row.NumeroSoa);
      if (numeroSoa) {
        soaData.push({
          idAzienda: id,
          numeroSoa,
          dataRilascio: cleanVal(row.DataRilascioAttestazioneOriginaria, 'date'),
          dataRilascioInCorso: cleanVal(row.DataRilascioAttestazioneInCorso, 'date'),
          validitaTriennale: cleanVal(row['ValiditàTriennale'] || row.ValiditaTriennale, 'bool'),
          validitaQuinquennale: cleanVal(row['ValiditàQuinquennale'] || row.ValiditaQuinquennale, 'bool'),
          organismo: cleanVal(row.SocAttestatriceSoa)
        });
      }

      if (collector.processed > 0 && collector.processed % 5000 === 0) {
        log(`  Aziende progress: ${collector.processed} processed, ${collector.total} inserted, ${collector.errors} batch errors...`);
      }
    } catch (err) {
      console.error(`  Aziende error [${id}]: ${err.message}`);
    }
  }

  await collector.flush();
  await pool.query(`SELECT setval('aziende_id_seq', (SELECT COALESCE(MAX(id),0) FROM aziende))`);
  if (skippedCorrupt > 0) {
    logPhase(PHASE, `  Aziende: ${skippedCorrupt} corrupted rows skipped (pipe in Note field)`);
  }
  logPhase(PHASE, `  Aziende: ${collector.total} rows migrated`);

  // ─── ATTESTAZIONI ───
  // The main source is attestazioni_aziende.csv (194k rows) which contains:
  //   IdAzienda | IdSoa (= soa.id directly) | id_attestazione (= classifica I-VIII) | Anno
  // The aziende CSV has NumeroSoa (attestation protocol number), SocAttestatriceSoa (organism),
  //   and date fields which we use to enrich each record.

  logPhase(PHASE, '  Migrating attestazioni from attestazioni_aziende.csv...');

  // Ensure UNIQUE constraint exists for ON CONFLICT to work
  try {
    await pool.query(`
      ALTER TABLE attestazioni
      ADD CONSTRAINT attestazioni_azienda_soa_unique UNIQUE (id_azienda, id_soa)
    `);
    logPhase(PHASE, '  Created UNIQUE constraint on attestazioni(id_azienda, id_soa)');
  } catch (err) {
    if (err.code === '42710') {
      logPhase(PHASE, '  UNIQUE constraint already exists on attestazioni(id_azienda, id_soa)');
    } else {
      logPhase(PHASE, `  Note: constraint creation returned: ${err.message}`);
    }
  }

  // Pre-load valid SOA ids and valid azienda ids for FK validation
  // IMPORTANT: pg driver returns bigint as string, int as Number — force all to Number for Set.has() strict equality
  const validSoaRes = await pool.query('SELECT id FROM soa');
  const validSoaIds = new Set(validSoaRes.rows.map(r => Number(r.id)));
  const validAzRes = await pool.query('SELECT id FROM aziende');
  const validAzIds = new Set(validAzRes.rows.map(r => Number(r.id)));
  logPhase(PHASE, `  FK validation sets: ${validSoaIds.size} SOA, ${validAzIds.size} aziende`);

  // Build enrichment map from soaData extracted during aziende migration
  // soaData has: { idAzienda, numeroSoa, dataRilascio, dataRilascioInCorso, validitaTriennale, validitaQuinquennale, organismo }
  const enrichMap = new Map();
  for (const soa of soaData) {
    enrichMap.set(Number(soa.idAzienda), soa);
  }

  const attestazioniCollector = createBatchCollector(
    pool,
    'attestazioni',
    ['id_azienda', 'id_soa', 'classifica', 'data_rilascio', 'data_scadenza', 'organismo', 'attivo'],
    500,
    'DO NOTHING',
    'id_azienda, id_soa'
  );

  // Debug: show sample types from first SOA/azienda id in sets
  const sampleSoa = [...validSoaIds].slice(0, 3);
  const sampleAz = [...validAzIds].slice(0, 3);
  logPhase(PHASE, `  Sample SOA ids: [${sampleSoa.join(', ')}] (type: ${typeof sampleSoa[0]})`);
  logPhase(PHASE, `  Sample azienda ids: [${sampleAz.join(', ')}] (type: ${typeof sampleAz[0]})`);

  let attCount = 0;
  let attSkipped = 0;
  let debugShown = false;
  for await (const row of readCsv('attestazioni_aziende')) {
    const idAzienda = cleanVal(row.IdAzienda || row.id_azienda, 'bigint');
    const idSoa = cleanVal(row.IdSoa || row.id_soa, 'int');
    const classifica = cleanVal(row.id_attestazione || row.id_Attestazione, 'int');
    if (!idAzienda || !idSoa) continue;

    // Debug first row to verify types
    if (!debugShown) {
      logPhase(PHASE, `  First CSV row: IdAzienda=${idAzienda} (${typeof idAzienda}), IdSoa=${idSoa} (${typeof idSoa})`);
      logPhase(PHASE, `  Set.has checks: az=${validAzIds.has(Number(idAzienda))}, soa=${validSoaIds.has(Number(idSoa))}`);
      debugShown = true;
    }

    // FK validation — ensure Number type for Set.has() strict equality
    if (!validAzIds.has(Number(idAzienda)) || !validSoaIds.has(Number(idSoa))) {
      attSkipped++;
      continue;
    }

    // Enrich with azienda SOA data if available
    const enrichment = enrichMap.get(Number(idAzienda));
    let dataRilascio = null;
    let dataScadenza = null;
    let organismo = null;

    if (enrichment) {
      dataRilascio = enrichment.dataRilascio;
      organismo = enrichment.organismo;
      // Calculate scadenza from release date
      if (enrichment.dataRilascioInCorso) {
        const base = new Date(enrichment.dataRilascioInCorso);
        if (enrichment.validitaQuinquennale) {
          base.setFullYear(base.getFullYear() + 5);
        } else if (enrichment.validitaTriennale) {
          base.setFullYear(base.getFullYear() + 3);
        }
        dataScadenza = base.toISOString().split('T')[0];
      }
    }

    const attivo = dataScadenza ? new Date(dataScadenza) > new Date() : true;

    try {
      await attestazioniCollector.add([idAzienda, idSoa, classifica, dataRilascio, dataScadenza, organismo, attivo]);
      attCount++;
      if (attCount % 2000 === 0) {
        log(`  Attestazioni progress: ${attCount} processed, ${attestazioniCollector.total} inserted, ${attSkipped} skipped...`);
      }
    } catch (err) {
      if (err.code !== '23505') {
        console.error(`  Attestazioni error [az ${idAzienda}, soa ${idSoa}]: ${err.message}`);
      }
    }
  }

  await attestazioniCollector.flush();
  logPhase(PHASE, `  Attestazioni: ${attestazioniCollector.total} rows migrated (${attSkipped} skipped FK)`);
  return { aziende: collector.total, attestazioni: attestazioniCollector.total };
}

// ============================================================
// USERS + USERS_PERIODI
// ============================================================
async function migrateUsers(pool) {
  logPhase(PHASE, 'Migrating USERS + extracting USERS_PERIODI...');

  const periodiData = [];

  const usersCollector = createBatchCollector(
    pool,
    'users',
    ['username', 'email', 'password_hash', 'nome', 'cognome', 'ruolo', 'attivo', 'ultimo_accesso'],
    500,
    'DO UPDATE SET email = EXCLUDED.email, nome = EXCLUDED.nome, cognome = EXCLUDED.cognome, ruolo = EXCLUDED.ruolo, attivo = EXCLUDED.attivo, ultimo_accesso = EXCLUDED.ultimo_accesso',
    'username'
  );

  const usersDuplicateEmails = [];

  for await (const row of readCsv('users')) {
    const username = cleanVal(row.UserName);
    if (!username) continue;

    const email = cleanVal(row.Email);
    if (!email) continue; // email is NOT NULL in new schema

    const nome = cleanVal(row.FirstName);
    const cognome = cleanVal(row.LastName);
    const attivo = cleanVal(row.IsApproved, 'bool');
    const ultimoAccesso = cleanVal(row.LastLogin, 'timestamp');
    const createdAt = cleanVal(row.CreateDate, 'timestamp') || new Date().toISOString();

    // Password: we'll set a placeholder hash - users will need to reset
    const passwordHash = '$2a$10$migration_placeholder_hash_reset_required_000';

    // Determine role
    let ruolo = 'utente';
    if (username === 'admin' || username === 'Admin') ruolo = 'admin';

    try {
      await usersCollector.add([username, email, passwordHash, nome, cognome, ruolo, attivo, ultimoAccesso]);

      // Extract subscription period data for users_periodi
      const inizioEsiti = cleanVal(row.InizioEsiti, 'date');
      const expire = cleanVal(row.Expire, 'date');
      if (inizioEsiti || expire) {
        periodiData.push({
          username,
          dataInizio: inizioEsiti || createdAt.split('T')[0],
          dataFine: expire,
          renewEsiti: cleanVal(row.RenewEsiti, 'bool'),
          renewBandi: cleanVal(row.RenewBandi, 'bool'),
          prezzoEsiti: cleanVal(row.PrezzoEsiti, 'decimal'),
          prezzoBandi: cleanVal(row.PrezzoBandi, 'decimal'),
          prezzo: cleanVal(row.Prezzo, 'decimal')
        });
      }

      if (usersCollector.processed > 0 && usersCollector.processed % 1000 === 0) {
        log(`  Users progress: ${usersCollector.processed} processed, ${usersCollector.total} inserted...`);
      }
    } catch (err) {
      if (err.code === '23505') {
        // Duplicate email - collect for fallback
        usersDuplicateEmails.push({
          username,
          passwordHash,
          nome,
          cognome,
          ruolo,
          attivo,
          ultimoAccesso,
          createdAt
        });
      } else {
        console.error(`  Users error [${username}]: ${err.message}`);
      }
    }
  }

  await usersCollector.flush();

  // Now handle duplicate emails with fallback
  const usersFallbackCollector = createBatchCollector(
    pool,
    'users',
    ['username', 'email', 'password_hash', 'nome', 'cognome', 'ruolo', 'attivo', 'ultimo_accesso'],
    500,
    'DO NOTHING'
  );

  for (const user of usersDuplicateEmails) {
    try {
      await usersFallbackCollector.add([
        user.username,
        `${user.username}@migrated.easywin.it`,
        user.passwordHash,
        user.nome,
        user.cognome,
        user.ruolo,
        user.attivo,
        user.ultimoAccesso
      ]);
    } catch (err2) {
      console.error(`  Users error [${user.username}]: ${err2.message}`);
    }
  }

  await usersFallbackCollector.flush();
  const usersCount = usersCollector.total + usersFallbackCollector.total;

  logPhase(PHASE, `  Users: ${usersCount} rows migrated`);

  // Now migrate users_periodi from extracted data + existing CSV
  logPhase(PHASE, `  Migrating users_periodi (${periodiData.length} from users extraction)...`);

  const periodiCollector = createBatchCollector(
    pool,
    'users_periodi',
    ['username', 'data_inizio', 'data_fine', 'tipo', 'importo_bandi', 'importo_esiti', 'note', 'attivo'],
    500,
    'DO NOTHING'
  );

  let periodiCount = 0;

  // First: existing users_periodi.csv
  try {
    for await (const row of readCsv('users_periodi')) {
      const username = cleanVal(row.UserName);
      const dataInizio = cleanVal(row.InizioPeriodo, 'date');
      if (!username) continue;

      try {
        await periodiCollector.add([
          username,
          dataInizio || '2020-01-01',
          cleanVal(row.FinePeriodo, 'date'),
          'standard',
          cleanVal(row.PrezzoBandi, 'decimal'),
          cleanVal(row.PrezzoEsiti, 'decimal'),
          `Migrated from old DB period ID ${cleanVal(row.ID)}`,
          true
        ]);
        periodiCount++;
      } catch (err) {
        // FK error if user doesn't exist
      }
    }
  } catch (err) {
    log(`  users_periodi.csv not found, using extracted data only`);
  }

  // Then: extracted from users subscription fields (only if no periodi record exists)
  for (const p of periodiData) {
    try {
      const exists = await pool.query(
        `SELECT 1 FROM users_periodi WHERE username = $1 LIMIT 1`,
        [p.username]
      );
      if (exists.rows.length > 0) continue; // already has period records

      await periodiCollector.add([
        p.username,
        p.dataInizio,
        p.dataFine,
        'standard',
        p.prezzoBandi,
        p.prezzoEsiti,
        'Extracted from users subscription fields',
        true
      ]);
      periodiCount++;
    } catch (err) {
      // Skip
    }
  }

  await periodiCollector.flush();

  logPhase(PHASE, `  Users Periodi: ${periodiCollector.total} rows migrated`);
  return { users: usersCount, periodi: periodiCollector.total };
}

// ============================================================
// MAIN
// ============================================================
export async function runPhase2() {
  const pool = getPool();
  logPhase(PHASE, '=== CORE TABLES MIGRATION START ===');
  const start = Date.now();

  const results = {};
  results.stazioni = await migrateStazioni(pool);
  const azResult = await migrateAziende(pool);
  results.aziende = azResult.aziende;
  results.attestazioni = azResult.attestazioni;
  const userResult = await migrateUsers(pool);
  results.users = userResult.users;
  results.usersPeriodi = userResult.periodi;

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  logPhase(PHASE, `=== CORE TABLES MIGRATION COMPLETE in ${elapsed}s ===`);
  logPhase(PHASE, `Results: ${JSON.stringify(results)}`);
  return results;
}

if (process.argv[1]?.includes('phase2')) {
  runPhase2().then(() => closePool()).catch(err => {
    console.error('Phase 2 failed:', err);
    closePool();
    process.exit(1);
  });
}
