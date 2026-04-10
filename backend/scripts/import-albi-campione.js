#!/usr/bin/env node
/**
 * Script per importare i dati degli albi fornitori dal file campione JSON
 * nel database PostgreSQL (tabella albi_fornitori).
 *
 * Uso: node scripts/import-albi-campione.js
 *
 * Prerequisiti: il server deve poter raggiungere il DB Neon
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const dataFile = path.join(__dirname, '..', 'data', 'albi-fornitori-campione.json');
  const albi = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));

  console.log(`\n📋 Importazione ${albi.length} albi fornitori...\n`);

  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (const albo of albi) {
    try {
      // Trova id_stazione dalla denominazione
      const stRes = await pool.query(
        `SELECT id FROM stazioni_appaltanti
         WHERE UPPER(denominazione) LIKE $1 OR UPPER("RagioneSociale") LIKE $1
         LIMIT 1`,
        ['%' + albo.denominazione.substring(0, 30).toUpperCase() + '%']
      );

      if (stRes.rows.length === 0) {
        console.log(`⚠️  Stazione non trovata: ${albo.denominazione}`);
        skipped++;
        continue;
      }

      const idStazione = stRes.rows[0].id;

      if (!albo.ha_albo) {
        console.log(`⏭️  ${albo.denominazione} — nessun albo (skip)`);
        skipped++;
        continue;
      }

      // Verifica se esiste già
      const existing = await pool.query(
        'SELECT id FROM albi_fornitori WHERE id_stazione = $1',
        [idStazione]
      );

      const values = [
        idStazione,
        albo.nome_albo,
        albo.url_albo,
        albo.piattaforma,
        JSON.stringify(albo.documenti_richiesti),
        albo.procedura_iscrizione,
        albo.categorie_soa || [],
        albo.categorie_merceologiche || [],
        albo.verificato || false,
        albo.note
      ];

      if (existing.rows.length > 0) {
        // UPDATE
        await pool.query(`
          UPDATE albi_fornitori SET
            nome_albo = $2,
            url_albo = $3,
            piattaforma = $4,
            documenti_richiesti = $5,
            procedura_iscrizione = $6,
            categorie_soa = $7,
            categorie_merceologiche = $8,
            verificato = $9,
            note = $10,
            updated_at = NOW()
          WHERE id_stazione = $1
        `, values);
        console.log(`🔄 Aggiornato: ${albo.denominazione}`);
      } else {
        // INSERT
        await pool.query(`
          INSERT INTO albi_fornitori
            (id_stazione, nome_albo, url_albo, piattaforma, documenti_richiesti,
             procedura_iscrizione, categorie_soa, categorie_merceologiche, verificato, note)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, values);
        console.log(`✅ Inserito: ${albo.denominazione}`);
      }
      imported++;

    } catch (err) {
      console.error(`❌ Errore per ${albo.denominazione}: ${err.message}`);
      errors++;
    }
  }

  console.log(`\n📊 Risultato: ${imported} importati, ${skipped} saltati, ${errors} errori\n`);
  await pool.end();
}

main().catch(err => {
  console.error('Errore fatale:', err);
  process.exit(1);
});
