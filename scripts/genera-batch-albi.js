#!/usr/bin/env node
/**
 * Genera un batch di stazioni appaltanti da incollare nel prompt
 * Cowork (prompts/COWORK_ALBI_DISCOVERY.md).
 *
 * Sorgenti, in ordine di precedenza:
 *   1. DB PostgreSQL (se DATABASE_URL definito nel .env)
 *      → query: stazioni attivo=true, esclude quelle già con albo verificato,
 *        ordina per numero di bandi pubblicati desc (priorità alle stazioni
 *        più attive).
 *   2. data/stazioni_da_cercare.json (snapshot offline) → fallback.
 *
 * Output:
 *   - file:   data/cowork-batches/batch-<NNN>.json  (NN cifre, zero-padded)
 *   - stdout: il contenuto del batch (così puoi fare pipe in pbcopy)
 *
 * Idempotenza:
 *   data/cowork-batches/_processed.json elenca gli id già spediti in batch
 *   precedenti (per non rifare due volte la stessa stazione).
 *
 * Uso:
 *   node scripts/genera-batch-albi.js --batch 1 --size 50
 *   node scripts/genera-batch-albi.js --batch 7 --size 30 --offset 0
 *   node scripts/genera-batch-albi.js --batch 1 --size 50 | pbcopy
 *
 * Esempi pratici:
 *   node scripts/genera-batch-albi.js --batch 1 --size 50 > /tmp/b1.txt
 *   cat /tmp/b1.txt | pbcopy   # macOS: lo metti nella clipboard
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

dotenv.config({ path: join(ROOT, 'backend', '.env') });

// ── args ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (k, def = null) => {
  const i = args.indexOf('--' + k);
  if (i === -1) return def;
  return args[i + 1];
};
const batchNum = parseInt(getArg('batch', '1'), 10);
const batchSize = parseInt(getArg('size', '50'), 10);
const startOffset = parseInt(getArg('offset', '0'), 10);

if (!Number.isFinite(batchNum) || !Number.isFinite(batchSize) || batchSize < 1 || batchSize > 200) {
  console.error('Uso: --batch <N> --size <1..200> [--offset <N>]');
  process.exit(1);
}

const OUT_DIR = join(ROOT, 'data', 'cowork-batches');
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const PROCESSED_FILE = join(OUT_DIR, '_processed.json');
const processed = existsSync(PROCESSED_FILE)
  ? new Set((JSON.parse(readFileSync(PROCESSED_FILE, 'utf8')).ids || []))
  : new Set();

// ── 1) prova DB ─────────────────────────────────────────────────────
async function tryDB() {
  if (!process.env.DATABASE_URL) return null;
  let pg;
  try { pg = (await import('pg')).default; }
  catch { return null; }
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    const r = await pool.query(`
      SELECT
        s.id,
        s.nome             AS ragione_sociale,
        s.citta            AS citta,
        p.sigla            AS provincia,
        s.sito_web         AS sito_web,
        COALESCE(b.n_bandi, 0)::int AS n_bandi
      FROM stazioni s
      LEFT JOIN province p ON s.id_provincia = p.id
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS n_bandi FROM bandi WHERE id_stazione = s.id
      ) b ON true
      WHERE s.attivo = true
        AND NOT EXISTS (
          SELECT 1 FROM albi_fornitori af
          WHERE af.id_stazione = s.id
            AND af.attivo = true
            AND af.verificato = true
        )
      ORDER BY n_bandi DESC, s.nome
      LIMIT 2000
    `);
    return r.rows;
  } catch (err) {
    console.error('[warn] DB non utilizzabile (', err.message, '), uso fallback JSON');
    return null;
  } finally {
    pool.end();
  }
}

// ── 2) fallback JSON snapshot ───────────────────────────────────────
function tryJSON() {
  const candidates = [
    join(ROOT, 'data', 'stazioni_da_cercare.json'),
    join(ROOT, 'data', 'search_batches.json')
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const j = JSON.parse(readFileSync(p, 'utf8'));
      if (Array.isArray(j)) {
        // search_batches.json è array di batch [{...stazioni}]
        if (Array.isArray(j[0])) return j.flat();
        return j;
      }
      if (j.stazioni && Array.isArray(j.stazioni)) return j.stazioni;
      if (j.scanned && typeof j.scanned === 'object') {
        return Object.values(j.scanned);
      }
    } catch (e) { /* skip */ }
  }
  return null;
}

// ── main ────────────────────────────────────────────────────────────
const stazioni = (await tryDB()) || tryJSON();
if (!stazioni || stazioni.length === 0) {
  console.error('Errore: nessuna sorgente stazioni disponibile (né DB né JSON).');
  process.exit(2);
}

// filtra già processate, ordina, taglia
const pool = stazioni.filter(s => s && s.id && !processed.has(Number(s.id)));
const start = startOffset;
const slice = pool.slice(start, start + batchSize);

if (slice.length === 0) {
  console.error('Nessuna stazione da processare con offset=' + startOffset + '. Pool restante: ' + pool.length);
  process.exit(0);
}

// formato minimale per il prompt
const formatted = slice.map(s => ({
  id:              Number(s.id),
  ragione_sociale: String(s.ragione_sociale || s.nome || '').trim(),
  citta:           s.citta || s.city || null,
  provincia:       s.provincia || s.sigla || null,
  sito_web:        s.sito_web || s.url || null
}));

const json = JSON.stringify(formatted, null, 2);

// scrivi file
const padded = String(batchNum).padStart(3, '0');
const outFile = join(OUT_DIR, `batch-${padded}.json`);
writeFileSync(outFile, json);

// aggiorna processed
formatted.forEach(s => processed.add(s.id));
writeFileSync(PROCESSED_FILE, JSON.stringify({
  updated_at: new Date().toISOString(),
  ids: Array.from(processed).sort((a, b) => a - b)
}, null, 2));

// stampa su stdout (per pipe a pbcopy)
console.log(json);

// e un riepilogo su stderr (non finisce in pbcopy)
console.error('');
console.error(`✅ Batch #${batchNum} → ${slice.length} stazioni`);
console.error(`   File salvato: ${outFile}`);
console.error(`   Già processate cumulativo: ${processed.size}`);
console.error(`   Pool residuo: ${pool.length - slice.length}`);
console.error('');
console.error('Per copiare nella clipboard (macOS):');
console.error(`   node scripts/genera-batch-albi.js --batch ${batchNum + 1} --size ${batchSize} | pbcopy`);
console.error('');
