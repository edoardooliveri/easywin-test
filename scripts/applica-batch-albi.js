#!/usr/bin/env node
/**
 * Applica una risposta JSON di un batch Cowork al file cumulativo
 * data/albi_fornitori_results.json.
 *
 * Input atteso (--in <path>): un file JSON con la stessa shape che
 * Claude/Cowork produce dopo aver elaborato il prompt
 * prompts/COWORK_ALBI_DISCOVERY.md, ovvero:
 *
 *   {
 *     "scanned": {
 *       "1234": { ... },
 *       "5678": { ... }
 *     }
 *   }
 *
 * Merge non distruttivo: per ogni id, la riga in input sostituisce la
 * vecchia (l'ultima risposta vince) ma le entry pre-esistenti che non
 * sono nell'input restano intatte.
 *
 * Uso:
 *   node scripts/applica-batch-albi.js --in data/cowork-batches/batch-001-out.json
 *   node scripts/applica-batch-albi.js --in /tmp/risposta.json --dry-run
 *
 * Dopo aver applicato N batch, importa tutto nel DB con lo script
 * gia pronto:
 *   node tools/albi/import-albi-da-scan.js \
 *     --file=data/albi_fornitori_results.json --verbose
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const args = process.argv.slice(2);
const inFile = (() => {
  const i = args.indexOf('--in');
  return i === -1 ? null : args[i + 1];
})();
const DRY = args.includes('--dry-run');

if (!inFile) {
  console.error('Uso: --in <path/al/json> [--dry-run]');
  process.exit(1);
}

const inPath = inFile.startsWith('/') ? inFile : join(ROOT, inFile);
if (!existsSync(inPath)) {
  console.error('File input non trovato:', inPath);
  process.exit(2);
}

const dataDir = join(ROOT, 'data');
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
const CUMUL = join(dataDir, 'albi_fornitori_results.json');

// ── parse input ─────────────────────────────────────────────────────
let input;
try {
  const raw = readFileSync(inPath, 'utf8').trim();
  // Permetti sia "{\"scanned\": {...}}" sia direttamente il dizionario.
  // Inoltre tollera blocchi markdown ```json ... ```
  const cleaned = raw.replace(/^```(?:json)?\s*/, '').replace(/\s*```\s*$/, '');
  input = JSON.parse(cleaned);
} catch (err) {
  console.error('Errore parsing JSON input:', err.message);
  process.exit(3);
}

const inScanned = input.scanned || input;
if (typeof inScanned !== 'object' || Array.isArray(inScanned)) {
  console.error('Formato non valido: atteso {"scanned": { "<id>": {...} }}');
  process.exit(4);
}

// ── carica cumulativo esistente ─────────────────────────────────────
let cumul = { last_updated: null, stats: {}, scanned: {} };
if (existsSync(CUMUL)) {
  try {
    cumul = JSON.parse(readFileSync(CUMUL, 'utf8'));
    if (!cumul.scanned) cumul.scanned = {};
  } catch (e) {
    console.error('[warn] file cumulativo corrotto, ricreo:', e.message);
  }
}

// ── merge ───────────────────────────────────────────────────────────
let added = 0, updated = 0, conNuoviAlbi = 0;
for (const [id, row] of Object.entries(inScanned)) {
  const idNum = Number(id);
  if (!Number.isFinite(idNum)) continue;
  if (!row || typeof row !== 'object') continue;
  row.id = idNum; // forza id coerente
  // se prima non c'era, è add
  if (!cumul.scanned[idNum]) added++; else updated++;
  if (row.ha_albo === true && cumul.scanned[idNum]?.ha_albo !== true) conNuoviAlbi++;
  cumul.scanned[idNum] = row;
}

// aggiorna stats
const all = Object.values(cumul.scanned);
cumul.last_updated = new Date().toISOString();
cumul.stats = {
  totale_processate: all.length,
  con_albo:          all.filter(r => r.ha_albo === true).length,
  senza_albo:        all.filter(r => r.ha_albo === false).length,
  da_verificare:     all.filter(r => r.ha_albo == null).length,
  ultimo_batch:      inFile,
  ultimo_batch_added:   added,
  ultimo_batch_updated: updated
};

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  APPLICA BATCH ALBI: ${inFile}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  Input:        ${Object.keys(inScanned).length} stazioni`);
console.log(`  Nuove:        ${added}`);
console.log(`  Aggiornate:   ${updated}`);
console.log(`  Albi nuovi:   ${conNuoviAlbi}`);
console.log('  ─────────────────────────────────────────');
console.log(`  Cumulativo:   ${cumul.stats.totale_processate} stazioni totali`);
console.log(`                ${cumul.stats.con_albo} con albo`);
console.log(`                ${cumul.stats.senza_albo} senza albo`);
console.log(`                ${cumul.stats.da_verificare} da verificare`);
console.log(`  Mode:         ${DRY ? '🟡 DRY-RUN (non scrive)' : '🟢 REALE'}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

if (!DRY) {
  writeFileSync(CUMUL, JSON.stringify(cumul, null, 2));
  console.log(`✅ Salvato in ${CUMUL}`);
}
console.log('');
console.log('Prossimo step (quando hai accumulato batch a sufficienza):');
console.log('   node tools/albi/import-albi-da-scan.js \\');
console.log(`     --file=data/albi_fornitori_results.json --verbose`);
