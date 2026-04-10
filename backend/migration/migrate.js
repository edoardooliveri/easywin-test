#!/usr/bin/env node
/**
 * EASYWIN DATABASE MIGRATION RUNNER
 * ===================================
 * Migrates data from old SQL Server CSV exports to new PostgreSQL (Neon) database.
 *
 * Usage:
 *   node migration/migrate.js                    # Run all phases
 *   node migration/migrate.js --phase 1          # Run only phase 1
 *   node migration/migrate.js --phase 2          # Run only phase 2
 *   node migration/migrate.js --phase 3          # Run only phase 3
 *   node migration/migrate.js --validate         # Run validation only
 *   node migration/migrate.js --dry-run          # Preview what would be migrated
 *
 * Phases:
 *   1. Reference data (regioni, province, SOA, criteri, tipologie, piattaforme)
 *   2. Core tables (stazioni, aziende + attestazioni, users + users_periodi)
 *   3. Main data (bandi with UUID, gare with variants, dettaglio_gara, junction tables, simulazioni)
 */
import { getPool, closePool, log, logPhase } from './utils.js';
import { runPhase1 } from './phase1-reference.js';
import { runPhase2 } from './phase2-core.js';
import { runPhase3 } from './phase3-main.js';

// ============================================================
// VALIDATION
// ============================================================
async function validate(pool) {
  log('=== RUNNING VALIDATION ===');

  const tables = [
    'regioni', 'province', 'soa', 'criteri', 'tipologia_gare', 'tipologia_bandi',
    'piattaforme', 'tipo_dati_gara', 'stazioni', 'aziende', 'attestazioni',
    'users', 'users_periodi', 'bandi', 'gare', 'dettaglio_gara',
    'bandi_soa_sec', 'bandi_soa_alt', 'bandi_soa_app', 'bandi_province',
    'bandi_modifiche', 'gare_province', 'simulazioni', 'simulazioni_dettagli',
    'registro_gare', 'richieste_servizi', 'bandi_probabilita'
  ];

  const counts = {};
  let totalRows = 0;

  for (const table of tables) {
    try {
      const result = await pool.query(`SELECT COUNT(*) as cnt FROM ${table}`);
      const cnt = parseInt(result.rows[0].cnt);
      counts[table] = cnt;
      totalRows += cnt;
    } catch (err) {
      counts[table] = `ERROR: ${err.message}`;
    }
  }

  log('');
  log('=== MIGRATION VALIDATION RESULTS ===');
  log('');
  log('Table                       | Rows');
  log('----------------------------|----------');

  for (const [table, cnt] of Object.entries(counts)) {
    const padded = table.padEnd(28);
    log(`${padded}| ${cnt}`);
  }

  log('----------------------------|----------');
  log(`TOTAL                       | ${totalRows}`);
  log('');

  // FK integrity checks
  log('=== FOREIGN KEY INTEGRITY ===');

  const fkChecks = [
    ['bandi → stazioni', 'SELECT COUNT(*) as cnt FROM bandi b WHERE b.id_stazione IS NOT NULL AND NOT EXISTS (SELECT 1 FROM stazioni s WHERE s.id = b.id_stazione)'],
    ['gare → stazioni', 'SELECT COUNT(*) as cnt FROM gare g WHERE g.id_stazione IS NOT NULL AND NOT EXISTS (SELECT 1 FROM stazioni s WHERE s.id = g.id_stazione)'],
    ['gare → bandi', 'SELECT COUNT(*) as cnt FROM gare g WHERE g.id_bando IS NOT NULL AND NOT EXISTS (SELECT 1 FROM bandi b WHERE b.id = g.id_bando)'],
    ['gare → aziende (vincitore)', 'SELECT COUNT(*) as cnt FROM gare g WHERE g.id_vincitore IS NOT NULL AND NOT EXISTS (SELECT 1 FROM aziende a WHERE a.id = g.id_vincitore)'],
    ['attestazioni → aziende', 'SELECT COUNT(*) as cnt FROM attestazioni att WHERE NOT EXISTS (SELECT 1 FROM aziende a WHERE a.id = att.id_azienda)'],
    ['attestazioni → soa', 'SELECT COUNT(*) as cnt FROM attestazioni att WHERE NOT EXISTS (SELECT 1 FROM soa s WHERE s.id = att.id_soa)'],
  ];

  for (const [label, sql] of fkChecks) {
    try {
      const result = await pool.query(sql);
      const orphans = parseInt(result.rows[0].cnt);
      const status = orphans === 0 ? 'OK' : `WARNING: ${orphans} orphaned`;
      log(`  ${label}: ${status}`);
    } catch (err) {
      log(`  ${label}: ERROR - ${err.message}`);
    }
  }

  log('');
  log('=== VALIDATION COMPLETE ===');
  return counts;
}

// ============================================================
// DRY RUN
// ============================================================
async function dryRun() {
  log('=== DRY RUN - Preview ===');
  log('');

  const fs = await import('fs');
  const path = await import('path');
  const csvDir = '/sessions/adoring-clever-mayer/mnt/easywin_export';

  const files = fs.readdirSync(csvDir)
    .filter(f => f.endsWith('.csv'))
    .sort();

  log('CSV files to be migrated:');
  log('');

  let totalSize = 0;
  for (const file of files) {
    const stat = fs.statSync(path.join(csvDir, file));
    const sizeMB = (stat.size / 1024 / 1024).toFixed(1);
    totalSize += stat.size;
    log(`  ${file.padEnd(35)} ${sizeMB} MB`);
  }

  log('');
  log(`Total: ${files.length} files, ${(totalSize / 1024 / 1024).toFixed(0)} MB`);
  log('');
  log('Migration phases:');
  log('  Phase 1: Reference data (regioni, province, SOA, criteri, tipologie, piattaforme)');
  log('  Phase 2: Core tables (stazioni, aziende + attestazioni, users + users_periodi)');
  log('  Phase 3: Main data (bandi, gare, dettaglio_gara, junction tables, simulazioni)');
  log('');
  log('Estimated time: 30-90 minutes depending on connection speed to Neon');
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  const args = process.argv.slice(2);
  const phaseArg = args.includes('--phase') ? args[args.indexOf('--phase') + 1] : null;
  const validateOnly = args.includes('--validate');
  const dryRunOnly = args.includes('--dry-run');

  if (dryRunOnly) {
    await dryRun();
    return;
  }

  const pool = getPool();

  // Test connection
  try {
    const result = await pool.query('SELECT NOW() as now, current_database() as db');
    log(`Connected to: ${result.rows[0].db} at ${result.rows[0].now}`);
  } catch (err) {
    console.error('Failed to connect to database:', err.message);
    process.exit(1);
  }

  if (validateOnly) {
    await validate(pool);
    await closePool();
    return;
  }

  const startTime = Date.now();
  log('');
  log('╔══════════════════════════════════════════════════╗');
  log('║   EASYWIN DATABASE MIGRATION                    ║');
  log('║   SQL Server CSV → PostgreSQL (Neon)            ║');
  log('╚══════════════════════════════════════════════════╝');
  log('');

  try {
    if (!phaseArg || phaseArg === '1') {
      await runPhase1();
      log('');
    }

    if (!phaseArg || phaseArg === '2') {
      await runPhase2();
      log('');
    }

    if (!phaseArg || phaseArg === '3') {
      await runPhase3();
      log('');
    }

    // Always validate at the end
    await validate(pool);

  } catch (err) {
    console.error('Migration failed:', err);
    console.error(err.stack);
  }

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  log('');
  log(`═══ MIGRATION COMPLETE in ${elapsed} minutes ═══`);
  log('');
  log('IMPORTANT POST-MIGRATION STEPS:');
  log('  1. All user passwords have been reset - users must use "Password dimenticata"');
  log('  2. Review variant data in gare.note (search for [VARIANT_ALT])');
  log('  3. Verify attestazioni data extracted from aziende SOA fields');
  log('  4. Check orphaned FK references in validation results');
  log('  5. Run the application and test key features');
  log('');

  await closePool();
}

main().catch(err => {
  console.error('Fatal error:', err);
  closePool();
  process.exit(1);
});
