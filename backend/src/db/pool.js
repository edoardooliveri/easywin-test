import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Supporta sia DATABASE_URL (Neon cloud) sia parametri singoli (locale)
const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'easywin',
      user: process.env.DB_USER || 'easywin',
      password: process.env.DB_PASSWORD || '',
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    };

const pool = new pg.Pool(poolConfig);

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

// Su ogni nuova connessione abbassa le soglie di pg_trgm così la
// ricerca fuzzy (typo-tolerant) non deve fare SET LOCAL ad ogni query.
// similarity_threshold: 0.25 (default 0.3) — cattura "crsta" vs "cresta"
// word_similarity_threshold: 0.3 (default 0.6) — idem per multi-token
pool.on('connect', (client) => {
  client.query("SET pg_trgm.similarity_threshold = 0.25; SET pg_trgm.word_similarity_threshold = 0.3").catch(() => {});
});

// Helper: run a query with params
export async function query(text, params) {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;
  if (duration > 1000) {
    console.warn(`Slow query (${duration}ms):`, text.substring(0, 100));
  }
  return result;
}

// Helper: get a client for transactions
export async function getClient() {
  const client = await pool.connect();
  const originalQuery = client.query.bind(client);
  const originalRelease = client.release.bind(client);

  // Override release to detect unreleased clients
  const timeout = setTimeout(() => {
    console.error('Client checked out for more than 10 seconds!');
  }, 10000);

  client.release = () => {
    clearTimeout(timeout);
    client.release = originalRelease;
    return originalRelease();
  };

  return client;
}

// Helper: run in transaction
export async function transaction(callback) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export default pool;
