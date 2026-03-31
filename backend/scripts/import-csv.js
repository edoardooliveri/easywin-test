#!/usr/bin/env node
/**
 * EasyWin CSV → PostgreSQL Import Script
 *
 * Importa i dati dal vecchio database EasyWin (export CSV) nel nuovo PostgreSQL (Neon).
 *
 * Uso:
 *   node scripts/import-csv.js [--csv-dir path] [--table tablename] [--limit N]
 *
 * Opzioni:
 *   --csv-dir  Directory con i file CSV (default: ../easywin_export)
 *   --table    Importa solo questa tabella (es: --table regioni)
 *   --limit    Limita righe per tabella (es: --limit 1000)
 *   --dry-run  Mostra le query senza eseguirle
 *
 * Prerequisiti:
 *   npm install (il progetto usa già 'pg')
 *   .env configurato con DATABASE_URL
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// ============================================================
// CONFIG
// ============================================================

const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(name);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
};

// Cerca easywin_export: prima come fratello di sito easywin, poi dentro il progetto
const defaultCsvPaths = [
  path.join(__dirname, '..', '..', '..', 'easywin_export'),  // ../../../easywin_export (fratello di "sito easywin")
  path.join(__dirname, '..', '..', 'easywin_export'),         // ../../easywin_export (dentro "sito easywin")
  path.join(__dirname, '..', 'easywin_export'),               // ../easywin_export
];
const CSV_DIR = getArg('--csv-dir') || defaultCsvPaths.find(p => fs.existsSync(p)) || defaultCsvPaths[0];
const ONLY_TABLE = getArg('--table');
const LIMIT = getArg('--limit') ? parseInt(getArg('--limit')) : null;
const DRY_RUN = args.includes('--dry-run');
const BATCH_SIZE = 500;

// ============================================================
// CSV READER (streaming, memory efficient)
// ============================================================

async function* readCsvRows(filename) {
  const filepath = path.join(CSV_DIR, filename);
  if (!fs.existsSync(filepath)) {
    console.warn(`  ⚠ File non trovato: ${filename}`);
    return;
  }

  const rl = readline.createInterface({
    input: fs.createReadStream(filepath, { encoding: 'utf-8' }),
    crlfDelay: Infinity
  });

  let lineNum = 0;
  let headers = null;

  for await (const line of rl) {
    lineNum++;
    if (lineNum === 1) {
      headers = line.split('|').map(h => h.trim());
      continue;
    }
    if (lineNum === 2) continue; // Skip separator row (dashes)

    const values = line.split('|').map(v => v ? v.trim() : '');
    if (values.length < 2) continue;

    // Create object from headers + values
    const obj = {};
    for (let i = 0; i < headers.length; i++) {
      obj[headers[i]] = i < values.length ? values[i] : '';
    }
    yield obj;
  }
}

// ============================================================
// HELPERS
// ============================================================

function clean(val) {
  if (val === undefined || val === null || val === '' || val.toUpperCase() === 'NULL') return null;
  return val.trim();
}

function toInt(val) {
  const v = clean(val);
  if (v === null) return null;
  const n = parseInt(v);
  return isNaN(n) ? null : n;
}

function toFloat(val) {
  const v = clean(val);
  if (v === null) return null;
  // Handle Italian decimal separator
  const normalized = v.replace(',', '.');
  const n = parseFloat(normalized);
  return isNaN(n) ? null : n;
}

function toBool(val) {
  const v = clean(val);
  if (v === null) return null;
  return ['1', 'true', 'yes', 'si', 'vero'].includes(v.toLowerCase());
}

function toDate(val) {
  const v = clean(val);
  if (v === null || v.length < 8) return null;
  // Remove .NET milliseconds
  const cleaned = v.split('.')[0];
  // Validate it's a parseable date
  const d = new Date(cleaned);
  if (isNaN(d.getTime())) return null;
  return cleaned;
}

function truncate(val, maxLen = 2000) {
  if (!val) return val;
  return val.length > maxLen ? val.substring(0, maxLen) : val;
}

// ============================================================
// BATCH INSERT
// ============================================================

async function batchInsert(pool, table, columns, rows) {
  if (rows.length === 0) return 0;

  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    // Build parameterized multi-row INSERT
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

    if (DRY_RUN) {
      console.log(`  [DRY RUN] ${table}: ${batch.length} rows`);
    } else {
      try {
        await pool.query(sql, values);
      } catch (err) {
        console.error(`  ✗ Error inserting into ${table} (batch ${Math.floor(i/BATCH_SIZE) + 1}):`, err.message);
        // Try row-by-row for this batch
        for (const row of batch) {
          const singlePlaceholders = row.map((_, idx) => `$${idx + 1}`).join(', ');
          const singleSql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${singlePlaceholders}) ON CONFLICT DO NOTHING`;
          try {
            await pool.query(singleSql, row);
          } catch (rowErr) {
            // Skip problematic rows silently
          }
        }
      }
    }

    inserted += batch.length;
  }

  return inserted;
}

async function resetSequence(pool, table) {
  try {
    await pool.query(`SELECT setval('${table}_id_seq', (SELECT COALESCE(MAX(id), 0) FROM ${table}), true)`);
  } catch (e) {
    // Sequence might not exist, that's OK
  }
}

// ============================================================
// TABLE IMPORTERS
// ============================================================

const importers = {};

importers.regioni = async (pool) => {
  const rows = [];
  for await (const r of readCsvRows('regioni.csv')) {
    rows.push([toInt(r.id_regione), clean(r.Regione), true]);
  }
  await pool.query('TRUNCATE regioni CASCADE');
  const n = await batchInsert(pool, 'regioni', ['id', 'nome', 'attivo'], rows);
  await resetSequence(pool, 'regioni');
  return n;
};

importers.province = async (pool) => {
  const rows = [];
  for await (const r of readCsvRows('province.csv')) {
    rows.push([toInt(r.id_provincia), clean(r.Provincia), clean(r.siglaprovincia), toInt(r.id_regione), toInt(r.id_istat), true]);
  }
  await pool.query('TRUNCATE province CASCADE');
  const n = await batchInsert(pool, 'province', ['id', 'nome', 'sigla', 'id_regione', 'codice_istat', 'attivo'], rows);
  await resetSequence(pool, 'province');
  return n;
};

importers.soa = async (pool) => {
  const rows = [];
  for await (const r of readCsvRows('soa.csv')) {
    const desc = clean(r.Descrizione) || clean(r.cod) || 'N/A';
    rows.push([toInt(r.id), clean(r.cod), truncate(desc, 500), truncate(clean(r.Tipologia), 5), true]);
  }
  await pool.query('TRUNCATE soa CASCADE');
  const n = await batchInsert(pool, 'soa', ['id', 'codice', 'descrizione', 'tipo', 'attivo'], rows);
  await resetSequence(pool, 'soa');
  return n;
};

importers.criteri = async (pool) => {
  const rows = [];
  for await (const r of readCsvRows('criteri.csv')) {
    rows.push([toInt(r.id_criterio), clean(r.Criterio), toBool(r.VisibleToUser)]);
  }
  await pool.query('TRUNCATE criteri CASCADE');
  const n = await batchInsert(pool, 'criteri', ['id', 'nome', 'attivo'], rows);
  await resetSequence(pool, 'criteri');
  return n;
};

importers.tipologia_bandi = async (pool) => {
  const rows = [];
  for await (const r of readCsvRows('tipologia_bandi.csv')) {
    rows.push([toInt(r.id_tipologia_bando), clean(r.Tipologia), toBool(r.VisibleToUser)]);
  }
  await pool.query('TRUNCATE tipologia_bandi CASCADE');
  const n = await batchInsert(pool, 'tipologia_bandi', ['id', 'nome', 'attivo'], rows);
  await resetSequence(pool, 'tipologia_bandi');
  return n;
};

importers.tipologia_gare = async (pool) => {
  const rows = [];
  for await (const r of readCsvRows('tipologia_gare.csv')) {
    rows.push([toInt(r.id_tipologia), clean(r.Tipologia), toBool(r.VisibleToUser)]);
  }
  await pool.query('TRUNCATE tipologia_gare CASCADE');
  const n = await batchInsert(pool, 'tipologia_gare', ['id', 'nome', 'attivo'], rows);
  await resetSequence(pool, 'tipologia_gare');
  return n;
};

importers.tipo_dati_gara = async (pool) => {
  const rows = [];
  for await (const r of readCsvRows('tipo_dati_gara.csv')) {
    rows.push([toInt(r.id_tipo), clean(r.Tipo), toInt(r.priority), true]);
  }
  await pool.query('TRUNCATE tipo_dati_gara CASCADE');
  const n = await batchInsert(pool, 'tipo_dati_gara', ['id', 'tipo', 'priority', 'attivo'], rows);
  await resetSequence(pool, 'tipo_dati_gara');
  return n;
};

importers.piattaforme = async (pool) => {
  const rows = [];
  for await (const r of readCsvRows('piattaforme.csv')) {
    rows.push([toInt(r.ID), clean(r.Piattaforma), clean(r.Link), true]);
  }
  await pool.query('TRUNCATE piattaforme CASCADE');
  const n = await batchInsert(pool, 'piattaforme', ['id', 'nome', 'url', 'attivo'], rows);
  await resetSequence(pool, 'piattaforme');
  return n;
};

importers.stazioni = async (pool) => {
  const rows = [];
  for await (const r of readCsvRows('stazioni.csv')) {
    const id = toInt(r.id);
    if (!id) continue;
    const nome = clean(r.RagioneSociale) || clean(r.Nome);
    const eliminata = toBool(r.eliminata);
    rows.push([
      id, truncate(nome, 500), truncate(clean(r.Indirizzo), 300), truncate(clean(r.Cap), 10),
      clean(r['Città'] || r.Citta), toInt(r.id_provincia), clean(r.Tel),
      clean(r.Email), truncate(clean(r.PartitaIva), 20), !eliminata
    ]);
  }
  await pool.query('TRUNCATE stazioni CASCADE');
  const n = await batchInsert(pool, 'stazioni', [
    'id', 'nome', 'indirizzo', 'cap', 'citta', 'id_provincia',
    'telefono', 'email', 'partita_iva', 'attivo'
  ], rows);
  await resetSequence(pool, 'stazioni');
  return n;
};

importers.users = async (pool) => {
  const rows = [];
  let idx = 0;
  for await (const r of readCsvRows('users.csv')) {
    idx++;
    const isApproved = toBool(r.IsApproved);
    const agente = clean(r.Agente);
    const ruolo = agente && !['', 'null', 'false', '0'].includes(agente.toLowerCase()) ? 'agente' : 'utente';
    rows.push([
      idx, clean(r.UserName), clean(r.Email), '$2b$10$placeholder',
      clean(r.FirstName), clean(r.LastName), ruolo, isApproved !== false,
      toDate(r.CreateDate)
    ]);
  }
  await pool.query('TRUNCATE users CASCADE');
  const n = await batchInsert(pool, 'users', [
    'id', 'username', 'email', 'password_hash', 'nome', 'cognome',
    'ruolo', 'attivo', 'created_at'
  ], rows);
  await resetSequence(pool, 'users');
  return n;
};

importers.concorrenti = async (pool) => {
  const rows = [];
  for await (const r of readCsvRows('concorrenti.csv')) {
    const id = toInt(r.ID);
    if (!id) continue;
    rows.push([
      id, clean(r.RagioneSociale), clean(r.Nome), clean(r.Indirizzo),
      truncate(clean(r.Cap), 10), clean(r['Città'] || r.Citta), toInt(r.ID_Provincia),
      clean(r.Tel), clean(r.Email), truncate(clean(r.PartitaIva), 20), truncate(clean(r.CodiceFiscale), 20),
      truncate(clean(r.Note), 500)
    ]);
  }
  await pool.query('TRUNCATE concorrenti CASCADE');
  const n = await batchInsert(pool, 'concorrenti', [
    'id', 'ragione_sociale', 'nome', 'indirizzo', 'cap', 'citta', 'id_provincia',
    'telefono', 'email', 'partita_iva', 'codice_fiscale', 'note'
  ], rows);
  await resetSequence(pool, 'concorrenti');
  return n;
};

importers.aziende = async (pool) => {
  const rows = [];
  for await (const r of readCsvRows('aziende.csv')) {
    const idStr = clean(r.id);
    if (!idStr || !/^\d+$/.test(idStr)) continue;
    const id = parseInt(idStr, 10);
    const eliminata = toBool(r.eliminata);
    rows.push([
      id, truncate(clean(r.RagioneSociale), 500), truncate(clean(r.PartitaIva), 20),
      truncate(clean(r.CodiceFiscale), 20), truncate(clean(r.Indirizzo), 300), truncate(clean(r.Cap), 10),
      clean(r['Città'] || r.Citta), toInt(r.id_provincia), clean(r.Tel),
      clean(r.Email), clean(r.IndirizzoPEC),
      truncate(clean(r.Note), 500), !eliminata
    ]);
  }
  await pool.query('TRUNCATE aziende CASCADE');
  const n = await batchInsert(pool, 'aziende', [
    'id', 'ragione_sociale', 'partita_iva', 'codice_fiscale', 'indirizzo', 'cap',
    'citta', 'id_provincia', 'telefono', 'email', 'pec', 'note', 'attivo'
  ], rows);
  await resetSequence(pool, 'aziende');
  return n;
};

importers.bandi = async (pool) => {
  const rows = [];
  for await (const r of readCsvRows('bandi.csv')) {
    const id = clean(r.id_bando);
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!id || !uuidRegex.test(id)) continue; 
    rows.push([
      id, toInt(r.id_stazione), truncate(clean(r.Stazione), 300),
      truncate(clean(r.Titolo), 1000), toDate(r.DataPubblicazione),
      truncate(clean(r.CodiceCIG), 20), truncate(clean(r.CodiceCUP), 20),
      toInt(r.id_soa), toInt(r.SoaVal),
      toBool(r.CategoriaPresunta), toInt(r.CategoriaSostitutiva),
      toFloat(r.ImportoSoaPrevalente), toFloat(r.ImportoSoaSostitutiva),
      toFloat(r.ImportoSO), toFloat(r.ImportoCO), toFloat(r.ImportoEco),
      toFloat(r.OneriProgettazione), toFloat(r.ImportoManodopera),
      toFloat(r.SogliaRiferimento),
      toDate(r.DataOfferta), toDate(r.DataApertura),
      toDate(r.DataSopStart), toDate(r.DataSopEnd),
      truncate(clean(r.Cap), 10), clean(r.Citta), clean(r.Regione),
      toInt(r.id_tipologia), toInt(r.id_tipologia_bando), toInt(r.id_criterio),
      toInt(r.IDPiattaformaDigitale),
      toInt(r.NDecimali), toBool(r.LimitMinMedia) ? 1 : 0,
      toBool(r.AccorpaAli), clean(r.TipoAccorpaALI),
      toBool(r.Annullato), toBool(r.Privato) ? 1 : 0,
      truncate(clean(r.Note), 500),
      clean(r.Provenienza), clean(r.ExternalCode), clean(r.FonteDati),
      clean(r.InseritoDa), toDate(r.DataInserimento),
      clean(r.ModificatoDa), toDate(r.DataModifica)
    ]);

    if (LIMIT && rows.length >= LIMIT) break;

    // Progress logging for large imports
    if (rows.length % 50000 === 0) {
      console.log(`    ... ${rows.length} bandi letti`);
    }
  }

  await pool.query('TRUNCATE bandi CASCADE');
  const n = await batchInsert(pool, 'bandi', [
    'id', 'id_stazione', 'stazione_nome', 'titolo', 'data_pubblicazione',
    'codice_cig', 'codice_cup', 'id_soa', 'soa_val',
    'categoria_presunta', 'categoria_sostitutiva',
    'importo_soa_prevalente', 'importo_soa_sostitutiva',
    'importo_so', 'importo_co', 'importo_eco',
    'oneri_progettazione', 'importo_manodopera', 'soglia_riferimento',
    'data_offerta', 'data_apertura', 'data_sop_start', 'data_sop_end',
    'cap', 'citta', 'regione',
    'id_tipologia', 'id_tipologia_bando', 'id_criterio', 'id_piattaforma',
    'n_decimali', 'limit_min_media',
    'accorpa_ali', 'tipo_accorpa_ali',
    'annullato', 'privato', 'note',
    'provenienza', 'external_code', 'fonte_dati',
    'inserito_da', 'data_inserimento', 'modificato_da', 'data_modifica'
  ], rows);
  await resetSequence(pool, 'bandi');
  return n;
};

importers.gare = async (pool) => {
  const rows = [];
  for await (const r of readCsvRows('gare.csv')) {
    const id = toInt(r.id);
    if (!id) continue;
    rows.push([
      id, clean(r.id_bando), toDate(r.Data),
      truncate(clean(r.Titolo), 1000), truncate(clean(r.CodiceCIG), 20),
      truncate(clean(r.Cap), 10), clean(r.Citta), clean(r.Indirizzo),
      toInt(r.id_stazione), toInt(r.id_soa), toInt(r.SoaVal),
      toInt(r.id_tipologia), toInt(r.id_tipoDatiGara),
      toFloat(r.Importo), toInt(r.NPartecipanti), toInt(r.NSorteggio),
      toInt(r.NDecimali), toInt(r.id_vincitore),
      toFloat(r.Ribasso), toFloat(r.MediaAr), toFloat(r.SogliaAn),
      toFloat(r.MediaSc), toFloat(r.SSogliaAn),
      toBool(r.AccorpaAli), clean(r.TipoAccorpaALI),
      toBool(r.LimitMinMedia) ? 1 : 0,
      toBool(r.Annullato), toBool(r.enabled), toBool(r.eliminata),
      toInt(r.Variante), truncate(clean(r.Note), 500),
      clean(r.username), toDate(r.DataInserimento),
      clean(r.usernameModifica), toDate(r.DataModifica)
    ]);

    if (LIMIT && rows.length >= LIMIT) break;
    if (rows.length % 50000 === 0) {
      console.log(`    ... ${rows.length} gare lette`);
    }
  }

  await pool.query('TRUNCATE gare CASCADE');
  const n = await batchInsert(pool, 'gare', [
    'id', 'id_bando', 'data', 'titolo', 'codice_cig',
    'cap', 'citta', 'indirizzo',
    'id_stazione', 'id_soa', 'soa_val',
    'id_tipologia', 'id_tipo_dati',
    'importo', 'n_partecipanti', 'n_sorteggio', 'n_decimali',
    'id_vincitore', 'ribasso', 'media_ar', 'soglia_an',
    'media_sc', 'soglia_riferimento',
    'accorpa_ali', 'tipo_accorpa_ali', 'limit_min_media',
    'annullato', 'enabled', 'eliminata',
    'variante', 'note',
    'username', 'data_inserimento',
    'username_modifica', 'data_modifica'
  ], rows);
  await resetSequence(pool, 'gare');
  return n;
};

importers.dettaglio_gara = async (pool) => {
  let rows = [];
  let totalInserted = 0;
  let count = 0;

  await pool.query('TRUNCATE dettaglio_gara CASCADE');

  for await (const r of readCsvRows('dettaglio_gara.csv')) {
    const idGara = toInt(r.id_gara);
    if (!idGara) continue;

    rows.push([
      idGara, toInt(r.Variante), toInt(r.id_azienda),
      toInt(r.Posizione), toFloat(r.Ribasso), toFloat(r.ImportoOfferta),
      toBool(r.TaglioAli), toFloat(r.MMediaArit),
      toBool(r.Anomala), toBool(r.Vincitrice), toBool(r.Ammessa), toBool(r.AmmessaRiserva), toBool(r.Esclusa),
      toBool(r.DaVerificare), toBool(r.Sconosciuto), toBool(r.PariMerito),
      truncate(clean(r.RagioneSociale), 500), truncate(clean(r.PartitaIva), 20),
      truncate(clean(r.CodiceFiscale), 20),
      toFloat(r.PunteggioTecnico), toFloat(r.PunteggioEconomico), toFloat(r.PunteggioTotale),
      toInt(r.id_azienda_esecutrice_1), toInt(r.id_azienda_esecutrice_2),
      toInt(r.id_azienda_esecutrice_3), toInt(r.id_azienda_esecutrice_4),
      toInt(r.id_azienda_esecutrice_5),
      toInt(r.Inserimento), truncate(clean(r.Note), 500)
    ]);
    count++;

    // Flush in batches to avoid memory issues
    if (rows.length >= BATCH_SIZE * 10) {
      totalInserted += await batchInsert(pool, 'dettaglio_gara', [
        'id_gara', 'variante', 'id_azienda', 'posizione', 'ribasso', 'importo_offerta',
        'taglio_ali', 'm_media_arit', 'anomala', 'vincitrice',
        'ammessa', 'ammessa_riserva', 'esclusa',
        'da_verificare', 'sconosciuto', 'pari_merito',
        'ragione_sociale', 'partita_iva', 'codice_fiscale',
        'punteggio_tecnico', 'punteggio_economico', 'punteggio_totale',
        'id_azienda_esecutrice_1', 'id_azienda_esecutrice_2',
        'id_azienda_esecutrice_3', 'id_azienda_esecutrice_4',
        'id_azienda_esecutrice_5',
        'inserimento', 'note'
      ], rows);
      rows = [];
      if (count % 500000 === 0) {
        console.log(`    ... ${count} dettagli letti, ${totalInserted} inseriti`);
      }
    }

    if (LIMIT && count >= LIMIT) break;
  }

  // Flush remaining
  if (rows.length > 0) {
    totalInserted += await batchInsert(pool, 'dettaglio_gara', [
        'id_gara', 'variante', 'id_azienda', 'posizione', 'ribasso', 'importo_offerta',
        'taglio_ali', 'm_media_arit', 'anomala', 'vincitrice',
        'ammessa', 'ammessa_riserva', 'esclusa',
        'da_verificare', 'sconosciuto', 'pari_merito',
        'ragione_sociale', 'partita_iva', 'codice_fiscale',
        'punteggio_tecnico', 'punteggio_economico', 'punteggio_totale',
        'id_azienda_esecutrice_1', 'id_azienda_esecutrice_2',
        'id_azienda_esecutrice_3', 'id_azienda_esecutrice_4',
        'id_azienda_esecutrice_5',
        'inserimento', 'note'
    ], rows);
  }

  return totalInserted;
};

importers.bandi_province = async (pool) => {
  let rows = [];
  let total = 0;
  await pool.query('TRUNCATE bandi_province CASCADE');

  for await (const r of readCsvRows('bandi_province.csv')) {
    rows.push([clean(r.id_bando), toInt(r.id_provincia), toDate(r.DataInserimento)]);
    if (rows.length >= BATCH_SIZE * 10) {
      total += await batchInsert(pool, 'bandi_province', ['id_bando', 'id_provincia', 'data_inserimento'], rows);
      rows = [];
      if (total % 500000 === 0) console.log(`    ... ${total} bandi_province inseriti`);
    }
    if (LIMIT && total >= LIMIT) break;
  }
  if (rows.length > 0) total += await batchInsert(pool, 'bandi_province', ['id_bando', 'id_provincia', 'data_inserimento'], rows);
  return total;
};

importers.bandi_soa_sec = async (pool) => {
  const rows = [];
  for await (const r of readCsvRows('bandi_soa_sec.csv')) {
    rows.push([clean(r.id_bando), toInt(r.id_soa), toFloat(r.Importo)]);
    if (LIMIT && rows.length >= LIMIT) break;
  }
  await pool.query('TRUNCATE bandi_soa_sec CASCADE');
  return await batchInsert(pool, 'bandi_soa_sec', ['id_bando', 'id_soa', 'importo'], rows);
};

importers.bandi_soa_alt = async (pool) => {
  const rows = [];
  for await (const r of readCsvRows('bandi_soa_alt.csv')) {
    rows.push([clean(r.id_bando), toInt(r.id_soa), toFloat(r.Importo)]);
    if (LIMIT && rows.length >= LIMIT) break;
  }
  await pool.query('TRUNCATE bandi_soa_alt CASCADE');
  return await batchInsert(pool, 'bandi_soa_alt', ['id_bando', 'id_soa', 'importo'], rows);
};

importers.gare_province = async (pool) => {
  const rows = [];
  for await (const r of readCsvRows('gare_province.csv')) {
    rows.push([toInt(r.id_gara), toInt(r.id_provincia), toInt(r.Variante), toDate(r.DataInserimento)]);
    if (LIMIT && rows.length >= LIMIT) break;
  }
  await pool.query('TRUNCATE gare_province CASCADE');
  return await batchInsert(pool, 'gare_province', ['id_gara', 'id_provincia', 'variante', 'data_inserimento'], rows);
};

importers.gare_soa = async (pool) => {
  // Merge gare_soa_sec, gare_soa_alt, gare_soa_app into gare_soa with tipo
  const rows = [];

  for await (const r of readCsvRows('gare_soa_sec.csv')) {
    rows.push([toInt(r.id_gara), toInt(r.id_soa), 'sec', toInt(r.Variante), toInt(r.SoaVal), toFloat(r.Importo)]);
  }
  for await (const r of readCsvRows('gare_soa_alt.csv')) {
    rows.push([toInt(r.id_gara), toInt(r.id_soa), 'alt', toInt(r.Variante), toInt(r.SoaVal), toFloat(r.Importo)]);
  }
  for await (const r of readCsvRows('gare_soa_app.csv')) {
    rows.push([toInt(r.id_gara), toInt(r.id_soa), 'app', toInt(r.Variante), toInt(r.SoaVal), toFloat(r.Importo)]);
  }

  if (LIMIT) rows.splice(LIMIT);

  await pool.query('TRUNCATE gare_soa CASCADE');
  return await batchInsert(pool, 'gare_soa', ['id_gara', 'id_soa', 'tipo', 'variante', 'soa_val', 'importo'], rows);
};

importers.simulazioni = async (pool) => {
  const rows = [];
  for await (const r of readCsvRows('simulazioni.csv')) {
    const id = toInt(r.id);
    if (!id) continue;
    rows.push([
      id, clean(r.Username), truncate(clean(r.Titolo), 500),
      clean(r.Stazione), truncate(clean(r.Oggetto), 500),
      toInt(r.id_soa), toInt(r.id_regione), toInt(r.id_provincia),
      toInt(r.id_tipologia), toInt(r.id_tipoSim),
      toDate(r.DataMin), toDate(r.DataMax),
      toFloat(r.ImportoMin), toFloat(r.ImportoMax),
      toFloat(r.MediaAr), toFloat(r.SogliaAn), toFloat(r.MediaSc),
      toFloat(r.Ribasso), toInt(r.Ngare), toInt(r.Npartecipanti),
      toInt(r.Nsorteggio), toInt(r.NDecimali),
      toInt(r.id_vincitore), clean(r.Vincitore),
      toDate(r.DataInserimento)
    ]);
    if (LIMIT && rows.length >= LIMIT) break;
  }
  await pool.query('TRUNCATE simulazioni CASCADE');
  const n = await batchInsert(pool, 'simulazioni', [
    'id', 'username', 'titolo', 'stazione', 'oggetto',
    'id_soa', 'id_regione', 'id_provincia', 'id_tipologia', 'id_tipo_sim',
    'data_min', 'data_max', 'importo_min', 'importo_max',
    'media_ar', 'soglia_an', 'media_sc', 'ribasso',
    'n_gare', 'n_partecipanti', 'n_sorteggio', 'n_decimali',
    'id_vincitore', 'vincitore', 'data_inserimento'
  ], rows);
  await resetSequence(pool, 'simulazioni');
  return n;
};

// ============================================================
// MAIN
// ============================================================

const IMPORT_ORDER = [
  // 1. Reference/lookup tables (no foreign keys)
  'regioni', 'province', 'soa', 'criteri', 'tipologia_bandi',
  'tipologia_gare', 'tipo_dati_gara', 'piattaforme',
  // 2. Core entity tables
  'stazioni', 'users', 'concorrenti', 'aziende',
  // 3. Main data tables
  'bandi', 'gare',
  // 4. Child/junction tables
  'dettaglio_gara', 'bandi_province', 'bandi_soa_sec', 'bandi_soa_alt',
  'gare_province', 'gare_soa',
  // 5. Feature tables
  'simulazioni'
];

async function main() {
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║   EasyWin CSV → PostgreSQL Import         ║');
  console.log('╚═══════════════════════════════════════════╝\n');

  console.log(`CSV Directory: ${CSV_DIR}`);
  console.log(`Database: ${process.env.DATABASE_URL ? 'Neon (DATABASE_URL)' : 'Locale'}`);
  if (ONLY_TABLE) console.log(`Solo tabella: ${ONLY_TABLE}`);
  if (LIMIT) console.log(`Limite righe: ${LIMIT}`);
  if (DRY_RUN) console.log(`⚠ DRY RUN - nessuna query verrà eseguita`);
  console.log('');

  if (!fs.existsSync(CSV_DIR)) {
    console.error(`✗ Directory CSV non trovata: ${CSV_DIR}`);
    process.exit(1);
  }

  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000
  });

  try {
    // Test connection
    const res = await pool.query('SELECT NOW() as now, current_database() as db');
    console.log(`✓ Connesso a: ${res.rows[0].db} (${res.rows[0].now})\n`);

    const tables = ONLY_TABLE ? [ONLY_TABLE] : IMPORT_ORDER;
    const results = {};
    const start = Date.now();

    for (const table of tables) {
      if (!importers[table]) {
        console.log(`⚠ Nessun importer per: ${table} (skip)`);
        continue;
      }

      const tStart = Date.now();
      process.stdout.write(`  Importando ${table}...`);

      try {
        const count = await importers[table](pool);
        const elapsed = ((Date.now() - tStart) / 1000).toFixed(1);
        console.log(` ✓ ${count.toLocaleString()} righe (${elapsed}s)`);
        results[table] = count;
      } catch (err) {
        console.log(` ✗ ERRORE: ${err.message}`);
        results[table] = 'ERRORE';
      }
    }

    const totalElapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`\n${'═'.repeat(50)}`);
    console.log('Riepilogo Import:');
    for (const [table, count] of Object.entries(results)) {
      console.log(`  ${table}: ${typeof count === 'number' ? count.toLocaleString() + ' righe' : count}`);
    }
    console.log(`\nTempo totale: ${totalElapsed}s`);

  } catch (err) {
    console.error('✗ Errore di connessione:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
