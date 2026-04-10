#!/usr/bin/env node
/**
 * EasyWin CSV Import Script
 * Legge i CSV exportati dal vecchio SQL Server e li importa in Neon PostgreSQL.
 *
 * USO: node import_from_csv.js [percorso_cartella_csv]
 * Esempio: node import_from_csv.js ../easywin_export
 *
 * Richiede: DATABASE_URL nel file backend/.env
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from backend
dotenv.config({ path: path.join(__dirname, 'backend', '.env') });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL not found in backend/.env');
  process.exit(1);
}

// CSV directory from args or default
const CSV_DIR = process.argv[2] || path.join(__dirname, '..', 'easywin_export');
if (!fs.existsSync(CSV_DIR)) {
  console.error(`ERROR: CSV directory not found: ${CSV_DIR}`);
  console.error('Usage: node import_from_csv.js [path_to_csv_folder]');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
});

// ===== CSV READER =====
function readCSV(filename, limit = 0) {
  const filepath = path.join(CSV_DIR, `${filename}.csv`);
  if (!fs.existsSync(filepath)) {
    console.warn(`  SKIP: ${filepath} not found`);
    return [];
  }

  const content = fs.readFileSync(filepath, 'utf-8');
  const lines = content.split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split('|').map(h => h.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('-')) continue;

    const values = line.split('|');
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] !== undefined ? values[idx].trim() : '';
    });
    rows.push(row);

    if (limit > 0 && rows.length >= limit) break;
  }

  return rows;
}

// ===== VALUE CONVERTERS =====
function clean(val) {
  if (!val || val === 'NULL' || val === 'null') return null;
  return val.trim() || null;
}
function num(val) {
  if (!val || val === 'NULL' || val === '.0000') return null;
  const f = parseFloat(val);
  return isNaN(f) ? null : f;
}
function int(val) {
  if (!val || val === 'NULL') return null;
  const i = parseInt(val);
  return isNaN(i) ? null : i;
}
function bool(val) {
  if (!val || val === 'NULL') return false;
  return val.trim() === '1' || val.trim().toLowerCase() === 'true';
}
function date(val) {
  if (!val || val === 'NULL') return null;
  return val.replace('.000', '').trim() || null;
}

// ===== BATCH INSERT =====
async function batchInsert(table, columns, rows, batchSize = 100) {
  if (rows.length === 0) return 0;
  let inserted = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const placeholders = [];
    const values = [];
    let paramIdx = 1;

    for (const row of batch) {
      const rowPlaceholders = [];
      for (const val of row) {
        rowPlaceholders.push(`$${paramIdx++}`);
        values.push(val);
      }
      placeholders.push(`(${rowPlaceholders.join(', ')})`);
    }

    const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${placeholders.join(', ')} ON CONFLICT DO NOTHING`;

    try {
      await pool.query(sql, values);
      inserted += batch.length;
    } catch (err) {
      console.error(`  Error inserting into ${table} (batch ${Math.floor(i/batchSize)+1}): ${err.message}`);
      // Try one by one
      for (const row of batch) {
        const singlePlaceholders = row.map((_, idx) => `$${idx + 1}`).join(', ');
        try {
          await pool.query(
            `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${singlePlaceholders}) ON CONFLICT DO NOTHING`,
            row
          );
          inserted++;
        } catch (e) {
          // Skip this row
        }
      }
    }

    if ((i + batchSize) % 500 === 0 || i + batchSize >= rows.length) {
      process.stdout.write(`\r  ${table}: ${Math.min(i + batchSize, rows.length)}/${rows.length}`);
    }
  }
  console.log(`\r  ${table}: ${inserted} inserted`);
  return inserted;
}

// ===== IMPORT FUNCTIONS =====
async function importStazioni() {
  console.log('\n📍 Importing stazioni...');
  const data = readCSV('stazioni', 5000);
  const cols = ['id', 'nome', 'indirizzo', 'cap', 'citta', 'id_provincia', 'telefono', 'partita_iva', 'email', 'attivo'];
  const rows = data.map(r => [
    int(r.id), clean(r.RagioneSociale), clean(r.Indirizzo), clean(r.Cap),
    clean(r['Città']), int(r.id_provincia), clean(r.Tel), clean(r.PartitaIva),
    clean(r.Email), !bool(r.eliminata)
  ]);
  await batchInsert('stazioni', cols, rows);
  await pool.query("SELECT setval('stazioni_id_seq', (SELECT COALESCE(MAX(id),0) FROM stazioni))");
}

async function importAziende() {
  console.log('\n🏢 Importing aziende...');
  const data = readCSV('aziende', 3000);
  const cols = ['id', 'ragione_sociale', 'indirizzo', 'cap', 'citta', 'id_provincia', 'telefono', 'partita_iva', 'email', 'codice_fiscale', 'attivo'];
  const rows = data.map(r => [
    int(r.id), clean(r.RagioneSociale), clean(r.Indirizzo), clean(r.Cap),
    clean(r['Città']), int(r.id_provincia), clean(r.Tel), clean(r.PartitaIva),
    clean(r.Email), clean(r.CodiceFiscale), !bool(r.eliminata)
  ]);
  await batchInsert('aziende', cols, rows);
  await pool.query("SELECT setval('aziende_id_seq', (SELECT COALESCE(MAX(id),0) FROM aziende))");
}

async function importBandi() {
  console.log('\n📋 Importing bandi...');
  const data = readCSV('bandi', 2000);
  const cols = ['id', 'id_stazione', 'stazione_nome', 'data_pubblicazione', 'titolo',
    'id_soa', 'soa_val', 'cap', 'citta', 'indirizzo', 'data_offerta', 'data_apertura',
    'importo_so', 'importo_co', 'importo_eco',
    'id_tipologia', 'id_criterio', 'id_tipologia_bando',
    'inserito_da', 'provenienza', 'codice_cig', 'codice_cup',
    'annullato', 'regione', 'note'];
  const rows = data.map(r => [
    clean(r.id_bando), int(r.id_stazione), clean(r.Stazione),
    date(r.DataPubblicazione), clean(r.Titolo),
    int(r.id_soa), int(r.SoaVal), clean(r.Cap), clean(r.Citta), clean(r.Indirizzo),
    date(r.DataOfferta), date(r.DataApertura),
    num(r.ImportoSO), num(r.ImportoCO), num(r.ImportoEco),
    int(r.id_tipologia), int(r.id_criterio), int(r.id_tipologia_bando),
    clean(r.InseritoDa), clean(r.Provenienza), clean(r.CodiceCIG), clean(r.CodiceCUP),
    bool(r.Annullato), clean(r.Regione), clean(r.Note)
  ]);
  await batchInsert('bandi', cols, rows, 50);
}

async function importGare() {
  console.log('\n📊 Importing gare (esiti)...');
  const data = readCSV('gare', 2000);
  const cols = ['id', 'data', 'cap', 'citta', 'id_stazione', 'titolo',
    'n_partecipanti', 'importo', 'id_soa', 'soa_val', 'id_vincitore',
    'media_ar', 'soglia_an', 'media_sc', 'ribasso',
    'id_tipologia', 'id_tipo_dati', 'username', 'enabled', 'eliminata', 'temp',
    'id_bando', 'variante', 'codice_cig', 'annullato', 'n_sorteggio'];
  const rows = data.map(r => [
    int(r.id), date(r.Data), clean(r.Cap), clean(r.Citta), int(r.id_stazione),
    clean(r.Titolo), int(r.NPartecipanti), num(r.Importo),
    int(r.id_soa), int(r.SoaVal), int(r.id_vincitore),
    num(r.MediaAr), num(r.SogliaAn), num(r.MediaSc), num(r.Ribasso),
    int(r.id_tipologia), int(r.id_tipoDatiGara), clean(r.username),
    bool(r.enabled), bool(r.eliminata), bool(r.temp),
    clean(r.id_bando) || null, clean(r.Variante) || 'BASE',
    clean(r.CodiceCIG), bool(r.Annullato), int(r.NSorteggio)
  ]);
  await batchInsert('gare', cols, rows, 50);
  await pool.query("SELECT setval('gare_id_seq', (SELECT COALESCE(MAX(id),0) FROM gare))");
}

async function importDettaglio() {
  console.log('\n📝 Importing dettaglio_gara...');
  // Get IDs of gare we imported
  const gareResult = await pool.query('SELECT id FROM gare LIMIT 2000');
  const gareIds = new Set(gareResult.rows.map(r => String(r.id)));
  console.log(`  Filtering for ${gareIds.size} gare...`);

  const data = readCSV('dettaglio_gara', 0); // Read all
  const filtered = data.filter(r => gareIds.has(r.id_gara?.trim())).slice(0, 20000);
  console.log(`  Found ${filtered.length} matching dettaglio records`);

  const cols = ['id_gara', 'variante', 'id_azienda', 'posizione', 'ribasso',
    'taglio_ali', 'anomala', 'vincitrice', 'ammessa', 'esclusa'];
  const rows = filtered.map(r => [
    int(r.id_gara), clean(r.Variante) || 'BASE', int(r.id_azienda),
    int(r.Posizione), num(r.Ribasso),
    bool(r.TaglioAli), bool(r.Anomala), bool(r.Vincitrice),
    bool(r.Ammessa), bool(r.Esclusa)
  ]);
  await batchInsert('dettaglio_gara', cols, rows, 200);
}

// ===== MAIN =====
async function main() {
  console.log('='.repeat(50));
  console.log('EasyWin CSV → PostgreSQL Import');
  console.log('='.repeat(50));
  console.log(`CSV directory: ${CSV_DIR}`);
  console.log(`Database: ${DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`);

  try {
    // Test connection
    const res = await pool.query('SELECT NOW()');
    console.log(`Connected! Server time: ${res.rows[0].now}`);

    await importStazioni();
    await importAziende();
    await importBandi();
    await importGare();
    await importDettaglio();

    // Final verification
    console.log('\n✅ VERIFICA FINALE:');
    const verify = await pool.query(`
      SELECT 'Stazioni' as tabella, count(*) as totale FROM stazioni
      UNION ALL SELECT 'Aziende', count(*) FROM aziende
      UNION ALL SELECT 'Bandi', count(*) FROM bandi
      UNION ALL SELECT 'Gare', count(*) FROM gare
      UNION ALL SELECT 'Dettaglio', count(*) FROM dettaglio_gara
    `);
    verify.rows.forEach(r => console.log(`  ${r.tabella}: ${r.totale}`));

    console.log('\nDone! 🎉');
  } catch (err) {
    console.error('Fatal error:', err.message);
  } finally {
    await pool.end();
  }
}

main();
