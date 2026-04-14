/**
 * Import Albi Fornitori dal file JSON di scansione.
 *
 * Legge data/albi_fornitori_results.json (risultato della ricerca manuale/AI
 * sulle stazioni appaltanti) e popola la tabella `albi_fornitori`.
 *
 * Matching stazione:
 *   1. Prova per ID diretto (solo se id_mapping_pending NON è true)
 *   2. Fallback: match fuzzy su stazioni.nome normalizzato (minuscolo, no spazi multipli)
 *   3. Se città è presente, disambigua con s.citta ILIKE
 *
 * Comportamento:
 *   - Inserisce solo le entry con ha_albo = true
 *   - Converte documenti_richiesti da string[] a [{nome, obbligatorio: true}]
 *   - Usa ON CONFLICT / check per non duplicare albi attivi
 *   - Dry-run disponibile con --dry-run
 *   - Report finale con contatori e lista stazioni non trovate
 *
 * Uso:
 *   node scripts/import-albi-da-scan.js            # esegue import reale
 *   node scripts/import-albi-da-scan.js --dry-run  # simula senza scrivere
 *   node scripts/import-albi-da-scan.js --verbose  # log dettagliato
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

// Support --file=<path> override (relative to repo root or absolute)
const fileArg = process.argv.find((a) => a.startsWith('--file='));
const SCAN_FILE = fileArg
  ? (fileArg.slice(7).startsWith('/') ? fileArg.slice(7) : join(ROOT, fileArg.slice(7)))
  : join(ROOT, 'data', 'albi_fornitori_results.json');
const REPORT_FILE = join(ROOT, 'data', 'import-albi-report.json');

const DRY_RUN = process.argv.includes('--dry-run');
const VERBOSE = process.argv.includes('--verbose');

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function normalizeNome(s) {
  if (!s) return '';
  return s
    .toLowerCase()
    .replace(/[àáâä]/g, 'a')
    .replace(/[èéêë]/g, 'e')
    .replace(/[ìíîï]/g, 'i')
    .replace(/[òóôö]/g, 'o')
    .replace(/[ùúûü]/g, 'u')
    .replace(/s\.?p\.?a\.?/g, 'spa')
    .replace(/s\.?r\.?l\.?/g, 'srl')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function convertDocumenti(docs) {
  if (!Array.isArray(docs)) return [];
  return docs.map((d) => {
    if (typeof d === 'string') return { nome: d, obbligatorio: true };
    if (d && typeof d === 'object' && d.nome) {
      return { nome: d.nome, obbligatorio: d.obbligatorio !== false };
    }
    return null;
  }).filter(Boolean);
}

async function findStazioneId(entry) {
  // 1) Match diretto per ID (solo se NON è sintetico)
  if (!entry.id_mapping_pending && Number.isInteger(entry.id)) {
    const r = await pool.query('SELECT id, nome FROM stazioni WHERE id = $1', [entry.id]);
    if (r.rows.length > 0) return { id: r.rows[0].id, matchMethod: 'direct_id' };
  }

  // 2) Match per nome normalizzato (full ILIKE)
  const normName = normalizeNome(entry.ragione_sociale);
  if (!normName) return null;

  // Strategie progressive: exact normalized → starts with → contains → città disambiguation
  const cittaClause = entry.citta ? 'AND citta ILIKE $2' : '';
  const params = entry.citta ? [`%${entry.ragione_sociale}%`, `%${entry.citta}%`] : [`%${entry.ragione_sociale}%`];

  const r = await pool.query(
    `SELECT id, nome, citta FROM stazioni
     WHERE nome ILIKE $1 ${cittaClause}
     ORDER BY LENGTH(nome) ASC
     LIMIT 5`,
    params
  );

  if (r.rows.length === 0) return null;
  if (r.rows.length === 1) return { id: r.rows[0].id, matchMethod: 'fuzzy_name_city', matchedNome: r.rows[0].nome };

  // Molti risultati: prendi quello con nome normalizzato più simile
  const best = r.rows
    .map((row) => ({ row, score: normalizeNome(row.nome) === normName ? 100 : (normalizeNome(row.nome).includes(normName) ? 50 : 10) }))
    .sort((a, b) => b.score - a.score)[0];

  return { id: best.row.id, matchMethod: 'fuzzy_multi', matchedNome: best.row.nome, candidates: r.rows.length };
}

async function upsertAlbo(idStazione, entry) {
  const documenti = convertDocumenti(entry.documenti_richiesti);
  const nomeAlbo = `Albo Fornitori - ${entry.ragione_sociale}`;
  const note = entry.note || null;

  // Check esistenza
  const existing = await pool.query(
    'SELECT id FROM albi_fornitori WHERE id_stazione = $1 AND attivo = true LIMIT 1',
    [idStazione]
  );

  if (existing.rows.length > 0) {
    if (DRY_RUN) return { action: 'would_update', albo_id: existing.rows[0].id };
    // PROTEZIONE DATI: non sovrascriviamo i campi esistenti con valori vuoti
    //  - nome_albo / url_albo / piattaforma / note: solo se lo scan ha un valore non vuoto
    //  - documenti_richiesti: solo se lo scan ha almeno un documento
    const hasDocs = Array.isArray(documenti) && documenti.length > 0;
    await pool.query(
      `UPDATE albi_fornitori SET
         nome_albo   = COALESCE(NULLIF($2,''), nome_albo),
         url_albo    = COALESCE(NULLIF($3,''), url_albo),
         piattaforma = COALESCE(NULLIF($4,''), piattaforma),
         documenti_richiesti = CASE WHEN $5::boolean THEN $6::jsonb ELSE documenti_richiesti END,
         note = COALESCE(NULLIF($7,''), note),
         verificato = true,
         verificato_da = 'import_scan',
         verificato_il = NOW(),
         ultimo_aggiornamento = NOW(),
         updated_at = NOW()
       WHERE id = $1`,
      [
        existing.rows[0].id,
        nomeAlbo,
        entry.url_albo || '',
        entry.piattaforma || '',
        hasDocs,
        JSON.stringify(documenti),
        note || ''
      ]
    );
    return { action: 'updated', albo_id: existing.rows[0].id };
  }

  if (DRY_RUN) return { action: 'would_insert' };

  const ins = await pool.query(
    `INSERT INTO albi_fornitori (
       id_stazione, nome_albo, url_albo, piattaforma,
       documenti_richiesti, note,
       attivo, verificato, verificato_da, verificato_il, ultimo_aggiornamento, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, true, true, 'import_scan', NOW(), NOW(), NOW(), NOW())
     RETURNING id`,
    [idStazione, nomeAlbo, entry.url_albo || null, entry.piattaforma || null, JSON.stringify(documenti), note]
  );
  return { action: 'inserted', albo_id: ins.rows[0].id };
}

// ─────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────
async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  IMPORT ALBI FORNITORI dal file di scansione');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  File:    ${SCAN_FILE}`);
  console.log(`  DB:      ${process.env.DATABASE_URL?.split('@')[1]?.split('/')[0] || '(n/d)'}`);
  console.log(`  Mode:    ${DRY_RUN ? '🟡 DRY-RUN (nessuna scrittura)' : '🟢 REALE'}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const raw = JSON.parse(readFileSync(SCAN_FILE, 'utf8'));
  const entries = Object.values(raw.scanned || {});
  const withAlbo = entries.filter((e) => e.ha_albo === true);

  console.log(`Totale entry scansionate: ${entries.length}`);
  console.log(`Entry con albo (ha_albo=true): ${withAlbo.length}`);
  console.log(`Entry senza albo: ${entries.filter((e) => e.ha_albo === false).length}`);
  console.log(`Entry da verificare: ${entries.filter((e) => e.ha_albo === null).length}\n`);

  const stats = {
    totale: withAlbo.length,
    inseriti: 0,
    aggiornati: 0,
    non_trovati: 0,
    errori: 0,
  };
  const nonTrovati = [];
  const ambigui = [];
  const errori = [];

  for (const entry of withAlbo) {
    try {
      const match = await findStazioneId(entry);
      if (!match) {
        stats.non_trovati++;
        nonTrovati.push({ id: entry.id, ragione_sociale: entry.ragione_sociale, citta: entry.citta });
        if (VERBOSE) console.log(`  ✗ NOT FOUND: [${entry.id}] ${entry.ragione_sociale} (${entry.citta || '-'})`);
        continue;
      }

      if (match.matchMethod === 'fuzzy_multi') {
        ambigui.push({ id: entry.id, ragione_sociale: entry.ragione_sociale, matched: match.matchedNome });
      }

      const res = await upsertAlbo(match.id, entry);
      if (res.action === 'inserted' || res.action === 'would_insert') stats.inseriti++;
      else if (res.action === 'updated' || res.action === 'would_update') stats.aggiornati++;

      if (VERBOSE) {
        console.log(`  ${res.action === 'inserted' || res.action === 'would_insert' ? '+' : '~'} [${entry.id}→${match.id}] ${entry.ragione_sociale.substring(0, 50)}`);
      }
    } catch (err) {
      stats.errori++;
      errori.push({ id: entry.id, ragione_sociale: entry.ragione_sociale, error: err.message });
      console.error(`  ⚠ ERR [${entry.id}] ${entry.ragione_sociale}: ${err.message}`);
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  REPORT FINALE');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Totale processate:  ${stats.totale}`);
  console.log(`  ${DRY_RUN ? 'Sarebbero inserite' : 'Inserite'}:     ${stats.inseriti}`);
  console.log(`  ${DRY_RUN ? 'Sarebbero aggiornate' : 'Aggiornate'}:  ${stats.aggiornati}`);
  console.log(`  Non trovate:        ${stats.non_trovati}`);
  console.log(`  Match ambigui:      ${ambigui.length}`);
  console.log(`  Errori:             ${stats.errori}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Salva report
  const report = {
    timestamp: new Date().toISOString(),
    dry_run: DRY_RUN,
    stats,
    non_trovati: nonTrovati,
    ambigui,
    errori,
  };
  writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
  console.log(`📄 Report salvato: ${REPORT_FILE}`);

  if (nonTrovati.length > 0) {
    console.log(`\n⚠  ${nonTrovati.length} stazioni non trovate nel DB — vedi report per la lista completa.`);
    console.log('   Prime 5:');
    nonTrovati.slice(0, 5).forEach((e) => console.log(`     - [${e.id}] ${e.ragione_sociale} (${e.citta || '-'})`));
  }

  await pool.end();
  console.log('\n✅ Fine.');
}

main().catch((err) => {
  console.error('❌ Errore fatale:', err);
  process.exit(1);
});
