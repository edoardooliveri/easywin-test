/**
 * Ripristino documenti degli albi fornitori del file "campione".
 *
 * Motivo: lo script import-albi-da-scan.js (versione precedente) faceva un
 * UPDATE unconditional di documenti_richiesti, sovrascrivendo con [] i dati
 * ricchi seminati in precedenza da popola-albi-fornitori.js per le 16
 * stazioni campione (Aeroporto Firenze, AIPO, ALER Pavia-Lodi, ecc.).
 *
 * Questo script legge backend/data/albi-fornitori-campione.json e fa un
 * UPDATE SICURO (COALESCE) sulle righe di albi_fornitori matchate per
 * id_stazione = campione.id_stazione_csv. Rimette i campi vuoti/wipe-ati.
 *
 * Uso:
 *   node scripts/restore-albi-campione-docs.js            # esegue
 *   node scripts/restore-albi-campione-docs.js --dry-run  # simula
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const CAMP_FILE = join(__dirname, '..', 'data', 'albi-fornitori-campione.json');
const REPORT_FILE = join(__dirname, '..', 'data', 'restore-albi-campione-report.json');

const DRY_RUN = process.argv.includes('--dry-run');

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  RESTORE DOCUMENTI ALBI FORNITORI (campione)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  File:  ${CAMP_FILE}`);
  console.log(`  Mode:  ${DRY_RUN ? '🟡 DRY-RUN (nessuna scrittura)' : '🟢 REALE'}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const camp = JSON.parse(readFileSync(CAMP_FILE, 'utf8'));
  const withAlbo = camp.filter((e) => e.ha_albo === true);

  console.log(`Entry totali nel campione: ${camp.length}`);
  console.log(`Entry con albo: ${withAlbo.length}\n`);

  const report = {
    started_at: new Date().toISOString(),
    dry_run: DRY_RUN,
    updated: [],
    inserted: [],
    not_found_stazione: [],
    skipped_no_change: [],
    errors: []
  };

  for (const entry of withAlbo) {
    const idStazione = entry.id_stazione_csv;

    try {
      // Verifica che la stazione esista
      const staRes = await pool.query('SELECT id, nome FROM stazioni WHERE id = $1', [idStazione]);
      if (staRes.rows.length === 0) {
        report.not_found_stazione.push({ id: idStazione, denominazione: entry.denominazione });
        continue;
      }

      // Cerca albo esistente
      const existing = await pool.query(
        'SELECT id, documenti_richiesti, procedura_iscrizione, nome_albo FROM albi_fornitori WHERE id_stazione = $1 AND attivo = true ORDER BY id DESC LIMIT 1',
        [idStazione]
      );

      const documentiJson = JSON.stringify(entry.documenti_richiesti || []);
      const categorieSoa = Array.isArray(entry.categorie_soa) && entry.categorie_soa.length > 0 ? entry.categorie_soa : null;
      const categorieMerc = Array.isArray(entry.categorie_merceologiche) && entry.categorie_merceologiche.length > 0 ? entry.categorie_merceologiche : null;

      if (existing.rows.length > 0) {
        // UPDATE SICURO: ripristina i campi vuoti/svuotati, non tocca valori già popolati
        if (DRY_RUN) {
          report.updated.push({ id_stazione: idStazione, albo_id: existing.rows[0].id, denominazione: entry.denominazione, action: 'would_restore' });
          continue;
        }

        await pool.query(
          `UPDATE albi_fornitori SET
             nome_albo = COALESCE(NULLIF(nome_albo,''), $2),
             url_albo = COALESCE(NULLIF(url_albo,''), $3),
             piattaforma = COALESCE(NULLIF(piattaforma,''), $4),
             documenti_richiesti = CASE
               WHEN documenti_richiesti IS NULL
                    OR jsonb_typeof(documenti_richiesti) <> 'array'
                    OR jsonb_array_length(documenti_richiesti) = 0
               THEN $5::jsonb
               ELSE documenti_richiesti
             END,
             procedura_iscrizione = COALESCE(NULLIF(procedura_iscrizione,''), $6),
             categorie_soa = COALESCE(categorie_soa, $7),
             categorie_merceologiche = COALESCE(categorie_merceologiche, $8),
             note = COALESCE(NULLIF(note,''), $9),
             verificato = true,
             verificato_da = 'restore_campione',
             verificato_il = NOW(),
             ultimo_aggiornamento = NOW(),
             updated_at = NOW()
           WHERE id = $1`,
          [
            existing.rows[0].id,
            entry.nome_albo || '',
            entry.url_albo || '',
            entry.piattaforma || '',
            documentiJson,
            entry.procedura_iscrizione || '',
            categorieSoa,
            categorieMerc,
            entry.note || ''
          ]
        );
        report.updated.push({ id_stazione: idStazione, albo_id: existing.rows[0].id, denominazione: entry.denominazione, docs_count: (entry.documenti_richiesti || []).length });
        console.log(`  ✓ [${idStazione}] ${entry.denominazione} — ripristinato (${(entry.documenti_richiesti || []).length} docs)`);
      } else {
        // Non esiste: inseriamo
        if (DRY_RUN) {
          report.inserted.push({ id_stazione: idStazione, denominazione: entry.denominazione, action: 'would_insert' });
          continue;
        }

        const ins = await pool.query(
          `INSERT INTO albi_fornitori (
             id_stazione, nome_albo, url_albo, piattaforma,
             documenti_richiesti, procedura_iscrizione,
             categorie_soa, categorie_merceologiche, note,
             attivo, verificato, verificato_da, verificato_il,
             ultimo_aggiornamento, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,true,'restore_campione',NOW(),NOW(),NOW(),NOW())
           RETURNING id`,
          [
            idStazione,
            entry.nome_albo || `Albo Fornitori - ${entry.denominazione}`,
            entry.url_albo || null,
            entry.piattaforma || null,
            documentiJson,
            entry.procedura_iscrizione || null,
            categorieSoa,
            categorieMerc,
            entry.note || null
          ]
        );
        report.inserted.push({ id_stazione: idStazione, albo_id: ins.rows[0].id, denominazione: entry.denominazione });
        console.log(`  + [${idStazione}] ${entry.denominazione} — inserito`);
      }
    } catch (err) {
      report.errors.push({ id_stazione: idStazione, denominazione: entry.denominazione, error: err.message });
      console.error(`  ✗ [${idStazione}] ${entry.denominazione} — ${err.message}`);
    }
  }

  report.finished_at = new Date().toISOString();

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  RIEPILOGO');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Ripristinati (update) : ${report.updated.length}`);
  console.log(`  Inseriti (nuovi)      : ${report.inserted.length}`);
  console.log(`  Stazione non trovata  : ${report.not_found_stazione.length}`);
  console.log(`  Errori                : ${report.errors.length}`);
  console.log(`\n  Report: ${REPORT_FILE}`);

  writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
  await pool.end();
}

main().catch((err) => {
  console.error('ERRORE FATALE:', err);
  process.exit(1);
});
