#!/usr/bin/env node
/**
 * Fix schema issues before re-running migration
 * Run: node migration/fix-schema.js
 */
import pg from 'pg';

const DATABASE_URL = 'postgresql://neondb_owner:npg_yI4wt1vXhCGf@ep-young-shadow-ag24ppum-pooler.c-2.eu-central-1.aws.neon.tech/neondb?sslmode=require';

const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

const fixes = [
  {
    name: 'tipo_dati_gara: aggiungere colonna nome',
    sql: `ALTER TABLE tipo_dati_gara ADD COLUMN IF NOT EXISTS nome VARCHAR(200)`
  },
  {
    name: 'tipo_dati_gara: popolare nome da tipo',
    sql: `UPDATE tipo_dati_gara SET nome = tipo WHERE nome IS NULL`
  },
  {
    name: 'aziende: espandere partita_iva a VARCHAR(50)',
    sql: `ALTER TABLE aziende ALTER COLUMN partita_iva TYPE VARCHAR(50)`
  },
  {
    name: 'aziende: espandere codice_fiscale a VARCHAR(50)',
    sql: `ALTER TABLE aziende ALTER COLUMN codice_fiscale TYPE VARCHAR(50)`
  },
  {
    name: 'stazioni: espandere codice_fiscale a VARCHAR(50)',
    sql: `ALTER TABLE stazioni ALTER COLUMN codice_fiscale TYPE VARCHAR(50)`
  },
  {
    name: 'stazioni: espandere partita_iva a VARCHAR(50)',
    sql: `ALTER TABLE stazioni ALTER COLUMN partita_iva TYPE VARCHAR(50)`
  }
];

async function main() {
  const client = await pool.connect();
  console.log('Connected to Neon database\n');

  let ok = 0, fail = 0;
  for (const fix of fixes) {
    try {
      await client.query(fix.sql);
      console.log(`  ✓ ${fix.name}`);
      ok++;
    } catch (err) {
      console.error(`  ✗ ${fix.name}: ${err.message}`);
      fail++;
    }
  }

  console.log(`\nDone: ${ok} applied, ${fail} failed`);
  client.release();
  await pool.end();
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
