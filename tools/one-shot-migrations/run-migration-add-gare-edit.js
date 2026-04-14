// Runner per add-gare-edit-fields.sql
// Uso: node run-migration-add-gare-edit.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query } from './src/db/pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function run() {
  const sqlPath = path.join(__dirname, 'migration', 'add-gare-edit-fields.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  console.log('[migration] add-gare-edit-fields: inizio…');
  // Esegui statement per statement per vedere quali falliscono
  const statements = sql.split(/;\s*$/m).map(s => s.trim()).filter(Boolean);
  let ok = 0, skip = 0;
  for (const stmt of statements) {
    if (!stmt) continue;
    try {
      await query(stmt);
      ok++;
      const m = stmt.match(/ADD COLUMN IF NOT EXISTS\s+(\w+)/i);
      console.log('  ✓', m ? m[1] : stmt.slice(0, 60));
    } catch (e) {
      skip++;
      console.warn('  ⚠', e.message);
    }
  }
  console.log(`[migration] terminata. OK=${ok} warn=${skip}`);
  process.exit(0);
}

run().catch(e => {
  console.error('[migration] errore fatale:', e);
  process.exit(1);
});
