// Migration configuration
import dotenv from 'dotenv';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Auto-detect CSV directory
function findCsvDir() {
  // 1. Check CLI argument: --csv-dir /path/to/csvs
  const cliIdx = process.argv.indexOf('--csv-dir');
  if (cliIdx !== -1 && process.argv[cliIdx + 1]) {
    return process.argv[cliIdx + 1];
  }

  // 2. Check environment variable
  if (process.env.CSV_DIR) {
    return process.env.CSV_DIR;
  }

  // 3. Check common relative paths from the backend directory
  const candidates = [
    path.join(__dirname, '..', '..', '..', 'easywin_export'),           // ../../../easywin_export (sibling on Desktop)
    path.join(__dirname, '..', '..', 'easywin_export'),                 // ../../easywin_export
    path.join(__dirname, '..', 'easywin_export'),                       // ../easywin_export
    path.resolve(process.env.HOME || '', 'Desktop', 'easywin_export'),  // ~/Desktop/easywin_export
    path.resolve(process.env.HOME || '', 'easywin_export'),             // ~/easywin_export
    '/sessions/adoring-clever-mayer/mnt/easywin_export',                // Cowork VM path
  ];

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'regioni_header.tmp'))) {
      console.log(`[config] Auto-detected CSV directory: ${dir}`);
      return dir;
    }
  }

  // Fallback - user must specify
  console.error('ERROR: Cannot find CSV export directory.');
  console.error('Please specify with: --csv-dir /path/to/easywin_export');
  console.error('Or set CSV_DIR environment variable.');
  process.exit(1);
}

export const config = {
  // Database
  databaseUrl: process.env.DATABASE_URL,

  // CSV source directory (auto-detected)
  csvDir: findCsvDir(),

  // CSV parsing
  delimiter: '|',

  // Batch size for inserts
  batchSize: 500,

  // Large table batch size (bandi, dettaglio_gara)
  largeBatchSize: 200,

  // Log level
  verbose: true
};
