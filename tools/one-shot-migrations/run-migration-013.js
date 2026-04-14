#!/usr/bin/env node
/**
 * Run Migration 013: Criteri — descrizione_calcolo + metodo_calcolo
 *
 * Aggiunge le due colonne e pre-compila i 23 criteri storici con
 * descrizione normativa e codice del metodo di calcolo automatico.
 *
 * Usage:
 *   cd backend && node run-migration-013.js
 *
 * Idempotente: usa ALTER TABLE ... ADD COLUMN IF NOT EXISTS e
 * UPDATE (nessun INSERT), quindi è sicuro eseguirla più volte.
 */
import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '.env') });

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL non impostata. Controlla backend/.env');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  console.log('📡 Connessione al database...');
  const client = await pool.connect();
  try {
    const sqlPath = join(__dirname, 'src/db/migrations/013_criteri_formule.sql');
    const sql = readFileSync(sqlPath, 'utf8');
    console.log(`📄 Letto file: ${sqlPath}`);
    console.log('🔒 Eseguo in transazione...\n');

    await client.query('BEGIN');
    // Eseguiamo l'intero file come un singolo statement: pg supporta
    // query multi-statement (senza parametri). Così evitiamo lo split
    // manuale su ';' che romperebbe i testi con punti e virgola interni.
    await client.query(sql);
    await client.query('COMMIT');

    // Verifica post-migrazione
    const { rows: cols } = await client.query(`
      SELECT column_name
        FROM information_schema.columns
       WHERE table_name = 'criteri'
         AND column_name IN ('descrizione_calcolo','metodo_calcolo')
       ORDER BY column_name
    `);
    console.log('✓ Colonne presenti:', cols.map(r => r.column_name).join(', '));

    const { rows: stats } = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE metodo_calcolo IS NOT NULL)  AS con_metodo,
        COUNT(*) FILTER (WHERE descrizione_calcolo IS NOT NULL) AS con_descrizione,
        COUNT(*) AS totale
      FROM criteri
    `);
    const s = stats[0];
    console.log(`✓ Criteri totali:           ${s.totale}`);
    console.log(`✓ Con metodo_calcolo:       ${s.con_metodo}`);
    console.log(`✓ Con descrizione_calcolo:  ${s.con_descrizione}`);

    console.log('\n✅ Migration 013 completata con successo!');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\n❌ Errore migrazione:', err.message);
    if (err.detail) console.error('   Dettaglio:', err.detail);
    if (err.hint)   console.error('   Hint:', err.hint);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
