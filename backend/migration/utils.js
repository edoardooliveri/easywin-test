// Migration utility functions
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import pg from 'pg';
import { config } from './config.js';

const { Pool } = pg;

// Database pool
let pool = null;

export function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: config.databaseUrl,
      ssl: { rejectUnauthorized: false },
      max: 10
    });
  }
  return pool;
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

// Parse a pipe-delimited CSV file line by line (memory efficient)
// Reads headers from _header.tmp if available, otherwise from the first line of the CSV itself
export async function* readCsv(tableName) {
  const csvDir = config.csvDir;
  const headerFile = path.join(csvDir, `${tableName}_header.tmp`);
  const dataFile = path.join(csvDir, `${tableName}.csv`);

  if (!fs.existsSync(dataFile)) {
    throw new Error(`Data file not found: ${dataFile}`);
  }

  let columns;
  let skipFirstLine = false;

  if (fs.existsSync(headerFile)) {
    // Read column names from separate header file
    const headerLine = fs.readFileSync(headerFile, 'utf8').split('\n')[0].trim();
    columns = headerLine.split('|').map(c => c.trim());
    skipFirstLine = true; // CSV still has header as first line, skip it
  }
  // else: we'll read columns from the first line of the CSV

  // Stream data file
  const fileStream = fs.createReadStream(dataFile, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let lineNum = 0;

  for await (const line of rl) {
    lineNum++;

    // First line: header row
    if (lineNum === 1) {
      if (!columns) {
        // Extract columns from first line of CSV
        columns = line.trim().split('|').map(c => c.trim());
      }
      continue; // skip header line in all cases
    }

    // Second line: skip separator row (dashes like --|--|--)
    if (lineNum === 2 && line.includes('---')) continue;

    const trimmed = line.trim();
    if (!trimmed) continue;

    const values = trimmed.split('|');
    const row = {};
    for (let i = 0; i < columns.length; i++) {
      let val = (values[i] || '').trim();
      // Normalize NULL values
      if (val === 'NULL' || val === 'null' || val === '') {
        val = null;
      }
      row[columns[i]] = val;
    }
    yield row;
  }
}

// Count lines in a CSV file (for progress)
export function countCsvLines(tableName) {
  const dataFile = path.join(config.csvDir, `${tableName}.csv`);
  if (!fs.existsSync(dataFile)) return 0;
  let count = 0;
  const buf = fs.readFileSync(dataFile, 'utf8');
  for (const ch of buf) {
    if (ch === '\n') count++;
  }
  return Math.max(0, count - 2); // subtract header + separator
}

// Multi-row batch INSERT. Builds a single query with multiple VALUES rows.
// Example: INSERT INTO table (col1, col2) VALUES ($1,$2), ($3,$4), ($5,$6) ON CONFLICT DO NOTHING
/**
 * @param {Pool} pool - pg Pool
 * @param {string} tableName - target table
 * @param {string[]} columns - column names
 * @param {Array<Array>} rows - array of value arrays, each matching columns length
 * @param {string} onConflict - conflict clause, default 'DO NOTHING'
 * @returns {number} inserted count (approximate, can't know exact with DO NOTHING)
 */
export async function batchInsertMulti(pool, tableName, columns, rows, onConflict = 'DO NOTHING', conflictTarget = null) {
  if (rows.length === 0) return 0;

  const numCols = columns.length;
  const colStr = columns.join(', ');

  // Build the ON CONFLICT clause properly
  let conflictClause = 'ON CONFLICT ';
  if (conflictTarget && onConflict !== 'DO NOTHING') {
    conflictClause += `(${conflictTarget}) ${onConflict}`;
  } else if (conflictTarget) {
    conflictClause += `(${conflictTarget}) DO NOTHING`;
  } else {
    conflictClause += onConflict;
  }

  // Build parameterized multi-row values: ($1,$2,$3), ($4,$5,$6), ...
  const allParams = [];
  const valueRows = [];

  for (let i = 0; i < rows.length; i++) {
    const placeholders = [];
    for (let j = 0; j < numCols; j++) {
      allParams.push(rows[i][j] !== undefined ? rows[i][j] : null);
      placeholders.push(`$${i * numCols + j + 1}`);
    }
    valueRows.push(`(${placeholders.join(',')})`);
  }

  const sql = `INSERT INTO ${tableName} (${colStr}) VALUES ${valueRows.join(',')} ${conflictClause}`;

  try {
    const result = await pool.query(sql, allParams);
    return result.rowCount || rows.length;
  } catch (err) {
    // Log the batch error immediately so we know what's wrong
    console.error(`  ⚠️ BATCH INSERT FAILED for ${tableName} (${rows.length} rows): ${err.message}`);
    console.error(`  SQL preview: ${sql.substring(0, 200)}...`);
    // Do NOT fall back to individual inserts — too slow over network.
    // Instead, throw so the caller can handle it.
    throw err;
  }
}

/**
 * Collects rows into batches and flushes when full.
 * Usage:
 *   const collector = createBatchCollector(pool, 'table', ['col1','col2'], 500, 'DO NOTHING', 'id');
 *   for (const row of data) {
 *     await collector.add([val1, val2]);
 *   }
 *   await collector.flush(); // flush remaining
 *   console.log(collector.total); // total inserted
 *
 * @param {string} conflictTarget - Column(s) for ON CONFLICT, e.g. 'id' or 'col1, col2'. Required for DO UPDATE.
 */
export function createBatchCollector(pool, tableName, columns, batchSize = 500, onConflict = 'DO NOTHING', conflictTarget = null) {
  const buffer = [];
  let total = 0;
  let processed = 0;
  let errors = 0;

  return {
    async add(row) {
      buffer.push(row);
      processed++;
      if (buffer.length >= batchSize) {
        await this.flush();
      }
    },
    async flush() {
      if (buffer.length === 0) return;
      try {
        const inserted = await batchInsertMulti(pool, tableName, columns, buffer, onConflict, conflictTarget);
        total += inserted;
      } catch (err) {
        errors++;
        console.error(`  Batch error in ${tableName} (${buffer.length} rows): ${err.message}`);
        // Log first row for debugging
        if (buffer.length > 0) {
          console.error(`  First row sample: ${JSON.stringify(buffer[0]).substring(0, 200)}`);
        }
      }
      buffer.length = 0;
    },
    get total() { return total; },
    get processed() { return processed; },
    get errors() { return errors; },
    get buffered() { return buffer.length; }
  };
}

// Clean a value for SQL insertion
export function cleanVal(val, type = 'text') {
  if (val === null || val === undefined || val === 'NULL' || val === '') return null;

  switch (type) {
    case 'int':
      const n = parseInt(val, 10);
      if (isNaN(n)) return null;
      // Guard against integer overflow (PostgreSQL INTEGER is 32-bit signed: -2147483648 to 2147483647)
      if (n > 2147483647 || n < -2147483648) return null;
      return n;

    case 'bigint':
      const bigStr = String(val).trim();
      if (/^-?\d+$/.test(bigStr)) return bigStr;
      return null;

    case 'decimal':
    case 'float':
      // Handle Italian decimals (comma) and remove thousands separators
      let cleaned = String(val).replace(/\s/g, '');
      if (cleaned.includes(',') && !cleaned.includes('.')) {
        cleaned = cleaned.replace(',', '.');
      }
      const f = parseFloat(cleaned);
      return isNaN(f) ? null : f;

    case 'bool':
      if (val === true || val === 'true' || val === '1' || val === 'True') return true;
      if (val === false || val === 'false' || val === '0' || val === 'False') return false;
      return false;

    case 'date':
      if (!val) return null;
      // Handle various date formats
      const d = new Date(val);
      if (isNaN(d.getTime())) return null;
      // Reject unreasonable years (before 1900 or after 2100)
      if (d.getFullYear() < 1900 || d.getFullYear() > 2100) return null;
      return d.toISOString().split('T')[0];

    case 'timestamp':
      if (!val) return null;
      const ts = new Date(val);
      if (isNaN(ts.getTime())) return null;
      if (ts.getFullYear() < 1900 || ts.getFullYear() > 2100) return null;
      return ts.toISOString();

    default:
      return String(val).trim();
  }
}

// Logging with timestamp
export function log(msg) {
  const ts = new Date().toISOString().substring(11, 19);
  console.log(`[${ts}] ${msg}`);
}

export function logPhase(phase, msg) {
  const ts = new Date().toISOString().substring(11, 19);
  console.log(`[${ts}] [PHASE ${phase}] ${msg}`);
}

// Progress tracker
export class ProgressTracker {
  constructor(label, total) {
    this.label = label;
    this.total = total;
    this.current = 0;
    this.errors = 0;
    this.skipped = 0;
    this.startTime = Date.now();
    this.lastReport = 0;
  }

  increment(count = 1) {
    this.current += count;
    const now = Date.now();
    if (now - this.lastReport > 5000 || this.current === this.total) {
      this.report();
      this.lastReport = now;
    }
  }

  error() { this.errors++; }
  skip() { this.skipped++; }

  report() {
    const pct = this.total > 0 ? ((this.current / this.total) * 100).toFixed(1) : '?';
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(0);
    const rate = this.current > 0 ? (this.current / (elapsed || 1)).toFixed(0) : 0;
    log(`  ${this.label}: ${this.current}/${this.total} (${pct}%) - ${rate} rows/sec - errors: ${this.errors} - elapsed: ${elapsed}s`);
  }

  summary() {
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    log(`  ${this.label} DONE: ${this.current} rows, ${this.errors} errors, ${this.skipped} skipped in ${elapsed}s`);
  }
}
