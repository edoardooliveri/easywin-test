#!/usr/bin/env node
/**
 * Run the BIGINT migration fix before running the main migration.
 * This converts aziende.id and all FK columns from INTEGER to BIGINT.
 *
 * Standalone script — does NOT depend on utils.js/config.js (no CSV needed).
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

  try {
    const result = await pool.query('SELECT NOW() as now, current_database() as db');
    log(`Connected to: ${result.rows[0].db}`);
  } catch (err) {
    console.error('Failed to connect:', err.message);
    process.exit(1);
  }

  log('=== Converting aziende.id and FK columns to BIGINT ===');
  log('This may take a moment if tables have data...');

  const sql = readFileSync(join(__dirname, 'pre-migrate-bigint.sql'), 'utf8');

  // Split by semicolons but handle DO $$ blocks
  const statements = [];
  let current = '';
  let inDollarBlock = false;

  for (const line of sql.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('--') || trimmed === '') {
      continue;
    }
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

  let success = 0;
  let errors = 0;

  for (const stmt of statements) {
    if (!stmt) continue;
    try {
      await pool.query(stmt);
      const match = stmt.match(/ALTER TABLE (\w+) ALTER COLUMN (\w+)/);
      if (match) {
        log(`  ✓ ${match[1]}.${match[2]} → BIGINT`);
      } else if (stmt.includes('ALTER SEQUENCE')) {
        log(`  ✓ aziende_id_seq → BIGINT`);
      } else if (stmt.includes('SELECT')) {
        log(`  ✓ Done!`);
      }
      success++;
    } catch (err) {
      if (err.message.includes('does not exist')) {
        log(`  - Skipped (not found): ${err.message.split('"')[1] || 'unknown'}`);
      } else {
        log(`  ✗ Error: ${err.message}`);
        errors++;
      }
    }
  }

  log('');
  log(`=== BIGINT fix complete: ${success} OK, ${errors} errors ===`);

  await pool.end();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
