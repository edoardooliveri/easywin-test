/**
 * EasyWin - Albo Fornitori Scanner
 *
 * Questo script legge le stazioni dal CSV e prepara i batch
 * per la ricerca albo fornitori. I risultati vengono salvati
 * progressivamente in un file JSON.
 *
 * Uso: node albo_fornitori_scanner.js [start_id] [batch_size]
 */

const fs = require('fs');
const path = require('path');

const CSV_PATH = path.join(__dirname, '../../easywin_export/stazioni.csv');
const RESULTS_PATH = path.join(__dirname, '../data/albi_fornitori_results.json');

// Parse stazioni CSV
function parseStazioni() {
  const raw = fs.readFileSync(CSV_PATH, 'utf-8');
  const lines = raw.split('\n').filter(l => l.trim() && !l.startsWith('--'));
  const header = lines[0].split('|');

  const stazioni = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('|');
    if (cols.length < 6) continue;
    stazioni.push({
      id: parseInt(cols[0]),
      ragione_sociale: cols[1]?.trim(),
      nome: cols[2]?.trim(),
      citta: cols[5]?.trim(),
      provincia_id: parseInt(cols[6]) || null,
      email: cols[18] !== 'NULL' ? cols[18]?.trim() : null,
      note: cols[19] !== 'NULL' ? cols[19]?.trim() : null,
      piattaforma_id: parseInt(cols[24]) || null,
    });
  }
  return stazioni;
}

// Load existing results
function loadResults() {
  try {
    return JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf-8'));
  } catch {
    return { scanned: {}, stats: { total: 0, con_albo: 0, senza_albo: 0, errori: 0 } };
  }
}

// Save results
function saveResults(results) {
  const dir = path.dirname(RESULTS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2));
}

// Build search query for a stazione
function buildSearchQuery(s) {
  // Clean the name for better search results
  let name = s.ragione_sociale;
  // Remove parenthetical "EX ..." parts
  name = name.replace(/\(EX [^)]+\)/gi, '').trim();
  // Limit length
  if (name.length > 80) name = name.substring(0, 80);
  return `"${name}" albo fornitori iscrizione`;
}

// Main
const stazioni = parseStazioni();
console.log(`Totale stazioni caricate: ${stazioni.length}`);

const results = loadResults();
const alreadyScanned = Object.keys(results.scanned).length;
console.log(`Già scannerizzate: ${alreadyScanned}`);
console.log(`Da scannerizzare: ${stazioni.length - alreadyScanned}`);

// Output first batch of search queries
const startId = parseInt(process.argv[2]) || 0;
const batchSize = parseInt(process.argv[3]) || 20;

const batch = stazioni
  .filter(s => !results.scanned[s.id])
  .slice(startId, startId + batchSize);

console.log(`\nBatch corrente (${batch.length} stazioni):\n`);
batch.forEach((s, i) => {
  console.log(`${i + 1}. [ID ${s.id}] ${s.ragione_sociale} (${s.citta})`);
  console.log(`   Query: ${buildSearchQuery(s)}`);
});

// Export for use
module.exports = { parseStazioni, loadResults, saveResults, buildSearchQuery };
