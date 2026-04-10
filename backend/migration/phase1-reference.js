#!/usr/bin/env node
/**
 * PHASE 1: Reference Data Migration
 * Migrates: regioni, province, soa, criteri, tipologia_gare, tipologia_bandi, piattaforme, tipo_dati_gara
 * These are small lookup tables with no complex transformations.
 */
import { getPool, closePool, readCsv, cleanVal, log, logPhase, ProgressTracker } from './utils.js';

const PHASE = '1';

// ============================================================
// REGIONI
// ============================================================
async function migrateRegioni(pool) {
  logPhase(PHASE, 'Migrating REGIONI...');
  let count = 0;
  for await (const row of readCsv('regioni')) {
    const id = cleanVal(row.id_regione, 'int');
    const nome = cleanVal(row.Regione);
    if (!id || !nome) continue;

    try {
      await pool.query(
        `INSERT INTO regioni (id, nome) VALUES ($1, $2)
         ON CONFLICT (id) DO UPDATE SET nome = EXCLUDED.nome`,
        [id, nome]
      );
      count++;
    } catch (err) {
      console.error(`  Regioni error: ${err.message}`);
    }
  }
  // Reset sequence
  await pool.query(`SELECT setval('regioni_id_seq', (SELECT COALESCE(MAX(id),0) FROM regioni))`);
  logPhase(PHASE, `  Regioni: ${count} rows migrated`);
  return count;
}

// ============================================================
// PROVINCE
// ============================================================
async function migrateProvince(pool) {
  logPhase(PHASE, 'Migrating PROVINCE...');
  let count = 0;
  for await (const row of readCsv('province')) {
    const id = cleanVal(row.id_provincia, 'int');
    const nome = cleanVal(row.Provincia);
    const idRegione = cleanVal(row.id_regione, 'int');
    const sigla = cleanVal(row.siglaprovincia) || '';
    const codiceIstat = cleanVal(row.id_istat);
    if (!id || !nome) continue;

    try {
      await pool.query(
        `INSERT INTO province (id, nome, sigla, id_regione, codice_istat)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET nome = EXCLUDED.nome, sigla = EXCLUDED.sigla,
           id_regione = EXCLUDED.id_regione, codice_istat = EXCLUDED.codice_istat`,
        [id, nome, sigla.trim(), idRegione, codiceIstat]
      );
      count++;
    } catch (err) {
      console.error(`  Province error: ${err.message}`);
    }
  }
  await pool.query(`SELECT setval('province_id_seq', (SELECT COALESCE(MAX(id),0) FROM province))`);
  logPhase(PHASE, `  Province: ${count} rows migrated`);
  return count;
}

// ============================================================
// SOA
// ============================================================
async function migrateSoa(pool) {
  logPhase(PHASE, 'Migrating SOA...');
  let count = 0;
  for await (const row of readCsv('soa')) {
    const id = cleanVal(row.id, 'int');
    const codice = cleanVal(row.cod);
    const descrizione = cleanVal(row.Descrizione) || '';
    const tipologia = cleanVal(row.Tipologia) || 'Lavori';
    if (!id || !codice) continue;

    // Extract tipo from codice (OG or OS)
    const tipo = codice.startsWith('OS') ? 'OS' : 'OG';

    try {
      await pool.query(
        `INSERT INTO soa (id, codice, descrizione, tipo)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET codice = EXCLUDED.codice,
           descrizione = EXCLUDED.descrizione, tipo = EXCLUDED.tipo`,
        [id, codice, descrizione.substring(0, 500), tipo]
      );
      count++;
    } catch (err) {
      if (err.code === '23505') {
        // Try update on codice conflict
        await pool.query(
          `UPDATE soa SET descrizione = $1, tipo = $2 WHERE codice = $3`,
          [descrizione.substring(0, 500), tipo, codice]
        ).catch(() => {});
      } else {
        console.error(`  SOA error [${codice}]: ${err.message}`);
      }
    }
  }
  await pool.query(`SELECT setval('soa_id_seq', (SELECT COALESCE(MAX(id),0) FROM soa))`);
  logPhase(PHASE, `  SOA: ${count} rows migrated`);
  return count;
}

// ============================================================
// CRITERI
// ============================================================
async function migrateCriteri(pool) {
  logPhase(PHASE, 'Migrating CRITERI...');
  let count = 0;
  for await (const row of readCsv('criteri')) {
    const id = cleanVal(row.id_criterio, 'int');
    const nome = cleanVal(row.Criterio);
    if (!id || !nome) continue;

    try {
      await pool.query(
        `INSERT INTO criteri (id, nome)
         VALUES ($1, $2)
         ON CONFLICT (id) DO UPDATE SET nome = EXCLUDED.nome`,
        [id, nome]
      );
      count++;
    } catch (err) {
      console.error(`  Criteri error: ${err.message}`);
    }
  }
  await pool.query(`SELECT setval('criteri_id_seq', (SELECT COALESCE(MAX(id),0) FROM criteri))`);
  logPhase(PHASE, `  Criteri: ${count} rows migrated`);
  return count;
}

// ============================================================
// TIPOLOGIA_GARE
// ============================================================
async function migrateTipologiaGare(pool) {
  logPhase(PHASE, 'Migrating TIPOLOGIA_GARE...');
  let count = 0;
  for await (const row of readCsv('tipologia_gare')) {
    const id = cleanVal(row.id_tipologia, 'int');
    const nome = cleanVal(row.Tipologia);
    if (!id || !nome) continue;

    try {
      await pool.query(
        `INSERT INTO tipologia_gare (id, nome)
         VALUES ($1, $2)
         ON CONFLICT (id) DO UPDATE SET nome = EXCLUDED.nome`,
        [id, nome]
      );
      count++;
    } catch (err) {
      console.error(`  Tipologia gare error: ${err.message}`);
    }
  }
  await pool.query(`SELECT setval('tipologia_gare_id_seq', (SELECT COALESCE(MAX(id),0) FROM tipologia_gare))`);
  logPhase(PHASE, `  Tipologia gare: ${count} rows migrated`);
  return count;
}

// ============================================================
// TIPOLOGIA_BANDI
// ============================================================
async function migrateTipologiaBandi(pool) {
  logPhase(PHASE, 'Migrating TIPOLOGIA_BANDI...');
  let count = 0;
  for await (const row of readCsv('tipologia_bandi')) {
    const id = cleanVal(row.id_tipologia_bando, 'int');
    const nome = cleanVal(row.Tipologia);
    if (!id || !nome) continue;

    try {
      await pool.query(
        `INSERT INTO tipologia_bandi (id, nome)
         VALUES ($1, $2)
         ON CONFLICT (id) DO UPDATE SET nome = EXCLUDED.nome`,
        [id, nome]
      );
      count++;
    } catch (err) {
      console.error(`  Tipologia bandi error: ${err.message}`);
    }
  }
  await pool.query(`SELECT setval('tipologia_bandi_id_seq', (SELECT COALESCE(MAX(id),0) FROM tipologia_bandi))`);
  logPhase(PHASE, `  Tipologia bandi: ${count} rows migrated`);
  return count;
}

// ============================================================
// PIATTAFORME
// ============================================================
async function migratePiattaforme(pool) {
  logPhase(PHASE, 'Migrating PIATTAFORME...');
  let count = 0;
  for await (const row of readCsv('piattaforme')) {
    const id = cleanVal(row.ID, 'int');
    const nome = cleanVal(row.Piattaforma);
    const url = cleanVal(row.Link);
    if (!id) continue;

    try {
      await pool.query(
        `INSERT INTO piattaforme (id, nome, url)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET nome = EXCLUDED.nome, url = EXCLUDED.url`,
        [id, nome || 'Sconosciuta', url]
      );
      count++;
    } catch (err) {
      console.error(`  Piattaforme error: ${err.message}`);
    }
  }
  await pool.query(`SELECT setval('piattaforme_id_seq', (SELECT COALESCE(MAX(id),0) FROM piattaforme))`);
  logPhase(PHASE, `  Piattaforme: ${count} rows migrated`);
  return count;
}

// ============================================================
// TIPO_DATI_GARA
// ============================================================
async function migrateTipoDatiGara(pool) {
  logPhase(PHASE, 'Migrating TIPO_DATI_GARA...');
  let count = 0;
  for await (const row of readCsv('tipo_dati_gara')) {
    const id = cleanVal(row.id_tipo, 'int');
    const nome = cleanVal(row.Tipo);
    if (!id) continue;

    try {
      // Ensure both 'tipo' and 'nome' columns work (schema may vary)
      await pool.query(
        `INSERT INTO tipo_dati_gara (id, tipo)
         VALUES ($1, $2)
         ON CONFLICT (id) DO UPDATE SET tipo = EXCLUDED.tipo`,
        [id, nome || '']
      ).catch(async () => {
        // Fallback: if 'tipo' column doesn't exist, try 'nome'
        await pool.query(
          `INSERT INTO tipo_dati_gara (id, nome)
           VALUES ($1, $2)
           ON CONFLICT (id) DO UPDATE SET nome = EXCLUDED.nome`,
          [id, nome || '']
        );
      });
      count++;
    } catch (err) {
      console.error(`  Tipo dati gara error: ${err.message}`);
    }
  }
  await pool.query(`SELECT setval('tipo_dati_gara_id_seq', (SELECT COALESCE(MAX(id),0) FROM tipo_dati_gara))`);
  logPhase(PHASE, `  Tipo dati gara: ${count} rows migrated`);
  return count;
}

// ============================================================
// MAIN
// ============================================================
export async function runPhase1() {
  const pool = getPool();
  logPhase(PHASE, '=== REFERENCE DATA MIGRATION START ===');
  const start = Date.now();

  const results = {};
  results.regioni = await migrateRegioni(pool);
  results.province = await migrateProvince(pool);
  results.soa = await migrateSoa(pool);
  results.criteri = await migrateCriteri(pool);
  results.tipologiaGare = await migrateTipologiaGare(pool);
  results.tipologiaBandi = await migrateTipologiaBandi(pool);
  results.piattaforme = await migratePiattaforme(pool);
  results.tipoDatiGara = await migrateTipoDatiGara(pool);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  logPhase(PHASE, `=== REFERENCE DATA MIGRATION COMPLETE in ${elapsed}s ===`);
  logPhase(PHASE, `Results: ${JSON.stringify(results)}`);
  return results;
}

// Run standalone
if (process.argv[1]?.includes('phase1')) {
  runPhase1().then(() => closePool()).catch(err => {
    console.error('Phase 1 failed:', err);
    closePool();
    process.exit(1);
  });
}
