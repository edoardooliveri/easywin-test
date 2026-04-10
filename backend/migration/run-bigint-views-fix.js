#!/usr/bin/env node
/**
 * Fix the 2 BIGINT columns that failed because of views.
 * Drops views → alters aziende.id + gare.id_vincitore → recreates views.
 */
import pg from 'pg';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

const log = (msg) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);

async function main() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 3
  });

  const result = await pool.query('SELECT current_database() as db');
  log(`Connected to: ${result.rows[0].db}`);
  log('=== Fixing BIGINT for aziende.id and gare.id_vincitore ===');

  const sql = readFileSync(join(__dirname, 'fix-bigint-views.sql'), 'utf8');

  // Split statements, handling DO $$ blocks
  const statements = [];
  let current = '';
  let inDollarBlock = false;

  for (const line of sql.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('--') || trimmed === '') continue;
    current += line + '\n';
    if (trimmed.includes('DO $$')) inDollarBlock = true;
    if (trimmed.includes('END $$;')) {
      inDollarBlock = false;
      statements.push(current.trim());
      current = '';
      continue;
    }
    if (!inDollarBlock && trimmed.endsWith(';')) {
      statements.push(current.trim());
      current = '';
    }
  }

  let ok = 0, err = 0;
  for (const stmt of statements) {
    if (!stmt) continue;
    try {
      await pool.query(stmt);
      if (stmt.startsWith('DROP')) log(`  ✓ Dropped view`);
      else if (stmt.includes('ALTER TABLE')) {
        const m = stmt.match(/ALTER TABLE (\w+) ALTER COLUMN (\w+)/);
        log(`  ✓ ${m[1]}.${m[2]} → BIGINT`);
      }
      else if (stmt.includes('CREATE')) {
        const m = stmt.match(/VIEW (\w+)/);
        log(`  ✓ Recreated ${m ? m[1] : 'view'}`);
      }
      else if (stmt.includes('SELECT')) log(`  ✓ Done!`);
      ok++;
    } catch (e) {
      log(`  ✗ ${e.message}`);
      err++;
    }
  }

  log(`\n=== Complete: ${ok} OK, ${err} errors ===`);
  await pool.end();
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
