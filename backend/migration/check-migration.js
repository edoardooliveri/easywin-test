/**
 * EasyWin Migration Status Check
 *
 * Confronta le righe nel database PostgreSQL con i CSV sorgente
 * per verificare lo stato della migrazione.
 *
 * Uso: CSV_DIR=~/Downloads/easywin_export node migration/check-migration.js
 */

import pg from 'pg';
import { config } from './config.js';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import path from 'path';
import fs from 'fs';

const { Pool } = pg;

const CSV_DIR = config.csvDir || process.env.CSV_DIR || path.join(process.env.HOME, 'Downloads', 'easywin_export');

// Tutte le tabelle da migrare, raggruppate per fase
const MIGRATION_PHASES = {
  'FASE 1 - Tabelle di Riferimento': {
    regioni:          { csv: 'regioni' },
    province:         { csv: 'province' },
    soa:              { csv: 'soa' },
    criteri:          { csv: 'criteri' },
    tipologia_gare:   { csv: 'tipologia_gare' },
    tipologia_bandi:  { csv: 'tipologia_bandi' },
    piattaforme:      { csv: 'piattaforme' },
    tipo_dati_gara:   { csv: 'tipo_dati_gara' },
    tipo_esecutore:   { csv: null, note: 'seed data, no CSV' },
    esecutori_esterni: { csv: null, note: 'seed data, no CSV' },
  },
  'FASE 2 - Tabelle Core': {
    stazioni:         { csv: 'stazioni' },
    aziende:          { csv: 'aziende' },
    attestazioni:     { csv: 'attestazioni_aziende', note: '+ extract da SOA aziende' },
    users:            { csv: 'users' },
    users_periodi:    { csv: 'users_periodi' },
  },
  'FASE 3 - Bandi & Figli': {
    bandi:            { csv: 'bandi' },
    allegati_bando:   { csv: 'allegati_bando' },
    bandi_soa_sec:    { csv: 'bandi_soa_sec' },
    bandi_soa_alt:    { csv: 'bandi_soa_alt' },
    bandi_soa_app:    { csv: 'bandi_soa_app' },
    bandi_province:   { csv: 'bandi_province' },
    bandi_modifiche:  { csv: 'bandi_modifiche' },
    bandi_probabilita:{ csv: 'bandi_probabilita' },
    registro_gare:    { csv: 'registro_gare' },
    richieste_servizi:{ csv: 'richieste_servizi' },
    sopralluoghi:     { csv: 'sopralluoghi' },
    sopralluoghi_date:{ csv: 'sopralluoghi_date' },
    sopralluoghi_richieste: { csv: 'sopralluoghi_richieste' },
    date_sopralluoghi:{ csv: 'date_sopralluoghi' },
  },
  'FASE 3 - Gare & Esiti': {
    gare:             { csv: 'gare' },
    dettaglio_gara:   { csv: 'dettaglio_gara' },
    ati_gare:         { csv: 'ati_gare_01', note: 'CSV: ati_gare_01' },
    punteggi:         { csv: 'punteggi' },
    gare_soa:         { csv: null, note: 'unificata da gare_soa_sec/alt/app/sost' },
    gare_province:    { csv: 'gare_province' },
    gare_ricorsi:     { csv: 'gare_ricorsi' },
    gare_invii:       { csv: 'gare_invii' },
    assistenti_gara:  { csv: 'assistenti_gara' },
    concorrenti:      { csv: 'concorrenti' },
  },
  'FASE 3 - Simulazioni': {
    simulazioni:      { csv: 'simulazioni' },
    simulazioni_dettagli: { csv: 'simulazioni_dettagli' },
    simulazione_pesi: { csv: 'simulazione_pesi' },
    simulazioni_tipologie: { csv: 'simulazioni_tipologie' },
    simulazioni_province: { csv: 'simulazioni_province' },
    simulazioni_soa_sec: { csv: 'simulazioni_soa_sec' },
    simulazioni_gare: { csv: 'simulazioni_gare' },
  },
  'FASE 3 - Aziende Extra': {
    azienda_personale:{ csv: 'azienda_personale' },
    modifiche_azienda:{ csv: 'modifiche_azienda' },
    note_aziende:     { csv: 'note_aziende' },
    consorzi:         { csv: 'consorzi' },
    attestazioni_raw: { csv: 'attestazioni', note: 'CSV attestazioni diretto' },
  },
  'FASE 3 - Extra': {
    partecipazioni:   { csv: 'partecipazioni', note: 'potrebbe non avere tabella dedicata' },
  },
};

// Count CSV rows (fast line count minus header)
async function countCsvRows(csvName) {
  const filePath = path.join(CSV_DIR, `${csvName}.csv`);
  if (!fs.existsSync(filePath)) return null;

  return new Promise((resolve) => {
    let count = -1; // -1 per sottrarre l'header
    const rl = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity });
    rl.on('line', () => count++);
    rl.on('close', () => resolve(count));
    rl.on('error', () => resolve(null));
  });
}

// Count DB table rows
async function countDbRows(pool, tableName) {
  try {
    const result = await pool.query(`SELECT COUNT(*) as count FROM "${tableName}"`);
    return parseInt(result.rows[0].count);
  } catch (err) {
    if (err.message.includes('does not exist')) return -1; // tabella non esiste
    return -2; // altro errore
  }
}

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    EASYWIN - STATO MIGRAZIONE DATABASE                      ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  CSV Directory: ${CSV_DIR}`);
  console.log(`  Database: ${config.databaseUrl ? config.databaseUrl.replace(/:[^:@]*@/, ':***@') : 'N/A'}`);
  console.log('');

  const pool = new Pool({ connectionString: config.databaseUrl });

  let totalCsv = 0;
  let totalDb = 0;
  let totalTables = 0;
  let migratedTables = 0;
  let emptyTables = 0;
  let missingTables = 0;

  for (const [phaseName, tables] of Object.entries(MIGRATION_PHASES)) {
    console.log(`  ┌─── ${phaseName} ${'─'.repeat(Math.max(0, 60 - phaseName.length))}┐`);

    for (const [tableName, info] of Object.entries(tables)) {
      totalTables++;

      const dbCount = await countDbRows(pool, tableName);
      const csvCount = info.csv ? await countCsvRows(info.csv) : null;

      // Status icon
      let icon, status;
      if (dbCount === -1) {
        icon = '❌'; status = 'TABELLA NON ESISTE';
        missingTables++;
      } else if (dbCount === -2) {
        icon = '⚠️ '; status = 'ERRORE QUERY';
      } else if (dbCount === 0) {
        icon = '⬜'; status = 'VUOTA';
        emptyTables++;
      } else if (csvCount !== null && dbCount >= csvCount * 0.95) {
        icon = '✅'; status = 'OK';
        migratedTables++;
      } else if (csvCount !== null && dbCount > 0 && dbCount < csvCount) {
        icon = '🔶'; status = 'PARZIALE';
        migratedTables++;
      } else {
        icon = '✅'; status = 'OK';
        migratedTables++;
      }

      // Format numbers
      const dbStr = dbCount >= 0 ? dbCount.toLocaleString('it-IT').padStart(10) : '---'.padStart(10);
      const csvStr = csvCount !== null ? csvCount.toLocaleString('it-IT').padStart(10) : '---'.padStart(10);

      // Percentage
      let pctStr = '';
      if (csvCount > 0 && dbCount > 0) {
        const pct = Math.round((dbCount / csvCount) * 100);
        pctStr = `${pct}%`.padStart(5);
        totalCsv += csvCount;
        totalDb += dbCount;
      } else {
        pctStr = ''.padStart(5);
        if (dbCount > 0) totalDb += dbCount;
        if (csvCount > 0) totalCsv += csvCount;
      }

      const noteStr = info.note ? ` (${info.note})` : '';
      console.log(`  │ ${icon} ${tableName.padEnd(24)} DB: ${dbStr}  CSV: ${csvStr}  ${pctStr}  ${status}${noteStr}`);
    }

    console.log(`  └${'─'.repeat(74)}┘`);
    console.log('');
  }

  // Summary
  console.log('  ╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('  ║                              RIEPILOGO                                  ║');
  console.log('  ╠══════════════════════════════════════════════════════════════════════════╣');
  console.log(`  ║  Tabelle totali:    ${String(totalTables).padStart(4)}                                              ║`);
  console.log(`  ║  Migrate (con dati):${String(migratedTables).padStart(4)}                                              ║`);
  console.log(`  ║  Vuote:             ${String(emptyTables).padStart(4)}                                              ║`);
  console.log(`  ║  Non esistono:      ${String(missingTables).padStart(4)}                                              ║`);
  console.log(`  ║                                                                        ║`);
  console.log(`  ║  Righe DB totali:   ${totalDb.toLocaleString('it-IT').padStart(12)}                                    ║`);
  console.log(`  ║  Righe CSV totali:  ${totalCsv.toLocaleString('it-IT').padStart(12)}                                    ║`);
  if (totalCsv > 0) {
    console.log(`  ║  Completamento:     ${(Math.round((totalDb / totalCsv) * 100) + '%').padStart(12)}                                    ║`);
  }
  console.log('  ╚══════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  await pool.end();
}

main().catch(err => {
  console.error('Errore:', err.message);
  process.exit(1);
});
