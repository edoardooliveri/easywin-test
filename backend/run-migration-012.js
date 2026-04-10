#!/usr/bin/env node
/**
 * Run Migration 012: Add avviso fields to bandi table
 *
 * Usage: cd backend && node run-migration-012.js
 */
import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '.env') });

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  console.log('Connecting to database...');
  const client = await pool.connect();
  try {
    const sql = readFileSync(join(__dirname, 'src/db/migrations/012_avviso_fields.sql'), 'utf8');
    // Split by semicolons and run each statement
    const statements = sql.split(';').map(s => s.trim()).filter(s => s && !s.startsWith('--'));

    for (const stmt of statements) {
      console.log('Running:', stmt.substring(0, 80) + '...');
      await client.query(stmt);
      console.log('  ✓ OK');
    }
    console.log('\n✅ Migration 012 completed successfully!');
  } catch (err) {
    console.error('❌ Migration error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
