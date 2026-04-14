// ============================================================
// In-memory cache + fuzzy matching per la ricerca aziende.
// Motivazione: con Neon cloud il floor di latenza è ~150ms per
// roundtrip, quindi qualsiasi query al DB non può scendere sotto
// i 100ms richiesti. Le aziende sono ~7.3k righe (~1–2 MB in RAM)
// quindi caricare tutto in memoria e fare il matching in JS è
// banale e ci porta a ~5–20ms per query.
// ============================================================
import { query } from '../db/pool.js';

let CACHE = null;            // array di righe aziende
let CACHE_AT = 0;            // timestamp ultimo load
let CACHE_LOADING = null;    // promise in corso (per evitare doppi load)
const TTL_MS = 5 * 60 * 1000; // 5 minuti

// Trigrammi stile pg_trgm: padding con 2 spazi iniziali e 1 finale,
// set di 3-grammi. Per "crsta" vs "cresta" dà ~0.44 come pg_trgm.
function trigrams(s) {
  if (!s) return new Set();
  const norm = '  ' + s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
  const out = new Set();
  for (let i = 0; i <= norm.length - 3; i++) out.add(norm.slice(i, i + 3));
  return out;
}

function trigramSim(a, b) {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const x of ta) if (tb.has(x)) inter++;
  return inter / (ta.size + tb.size - inter);
}

// Tokenizza una stringa in parole >= 2 char
function tokenize(s) {
  if (!s) return [];
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(w => w.length >= 2);
}

// Score token-per-token: per ogni parola della query prende il
// miglior match tra le parole della ragione_sociale, poi media.
// Rispecchia la logica del CTE SQL originale.
function scoreRow(qTokens, rs) {
  if (!qTokens.length) return 0;
  const words = tokenize(rs);
  if (!words.length) return 0;
  let sum = 0;
  for (const qt of qTokens) {
    let best = 0;
    for (const w of words) {
      let s;
      if (w === qt) s = 1.0;
      else if (w.startsWith(qt)) s = 0.95;
      else if (w.length >= 3 && qt.startsWith(w)) s = 0.9;
      else if (qt.length >= 3 && w.length >= 3) s = trigramSim(w, qt);
      else s = 0;
      if (s > best) {
        best = s;
        if (best === 1.0) break;
      }
    }
    sum += best;
  }
  return sum / qTokens.length;
}

async function loadCache() {
  const result = await query(`
    SELECT a."id", a."ragione_sociale", a."partita_iva", a."codice_fiscale",
           a."citta", a."id_provincia", p."sigla" AS provincia_sigla
      FROM aziende a
      LEFT JOIN province p ON a."id_provincia" = p."id"
  `);
  const rows = result.rows.map(r => ({
    id: r.id,
    ragione_sociale: r.ragione_sociale || '',
    partita_iva: r.partita_iva || '',
    codice_fiscale: r.codice_fiscale || '',
    citta: r.citta || '',
    id_provincia: r.id_provincia,
    provincia_sigla: r.provincia_sigla || null,
    // Precompute per velocità: tokens già splittati in lowercase
    _rsLower: (r.ragione_sociale || '').toLowerCase(),
    _pivaDigits: (r.partita_iva || '').replace(/\D/g, ''),
    _cfDigits: (r.codice_fiscale || '').replace(/\D/g, ''),
  }));
  CACHE = rows;
  CACHE_AT = Date.now();
  return CACHE;
}

export async function getAziendeCache() {
  if (CACHE && (Date.now() - CACHE_AT) < TTL_MS) return CACHE;
  if (CACHE_LOADING) return CACHE_LOADING;
  CACHE_LOADING = loadCache().finally(() => { CACHE_LOADING = null; });
  return CACHE_LOADING;
}

export function invalidateAziendeCache() {
  CACHE = null;
  CACHE_AT = 0;
}

export function getAziendeCacheStats() {
  return {
    loaded: !!CACHE,
    size: CACHE ? CACHE.length : 0,
    age_ms: CACHE ? (Date.now() - CACHE_AT) : null,
    ttl_ms: TTL_MS,
  };
}

// Ricerca principale: ritorna righe in formato compatibile con
// l'endpoint /aziende-search.
export async function searchAziende(q, limit = 20) {
  const cache = await getAziendeCache();
  const qTrim = (q || '').trim();
  if (qTrim.length < 2) return [];

  // P.IVA / codice fiscale: se è quasi tutto numerico prova match diretto
  const digits = qTrim.replace(/\D/g, '');
  if (digits.length >= 6) {
    const byPiva = [];
    for (const r of cache) {
      if ((r._pivaDigits && r._pivaDigits.includes(digits)) ||
          (r._cfDigits && r._cfDigits.includes(digits))) {
        byPiva.push({
          id: r.id, ragione_sociale: r.ragione_sociale, partita_iva: r.partita_iva,
          codice_fiscale: r.codice_fiscale, citta: r.citta, provincia_sigla: r.provincia_sigla,
          score: 1.0, via: 'piva'
        });
        if (byPiva.length >= limit) break;
      }
    }
    if (byPiva.length) return byPiva;
  }

  const qLower = qTrim.toLowerCase();
  const qTokens = tokenize(qTrim);
  if (!qTokens.length) return [];

  // Scoring su tutti i ~7.3k record. Per velocizzare: pre-filtro veloce
  // — lo skip è basato sul fatto che almeno uno dei token della query
  // compare (come sottostringa grezza) nella ragione sociale in forma
  // lowercased, OPPURE il trigram similarity della ragione sociale
  // intera supera una soglia minima.
  // Ma per semplicità e sicurezza di recall, scoriamo tutti (7.3k → ~15ms)
  const results = [];
  for (const r of cache) {
    const score = scoreRow(qTokens, r._rsLower);
    if (score >= 0.35) {
      results.push({
        id: r.id,
        ragione_sociale: r.ragione_sociale,
        partita_iva: r.partita_iva,
        codice_fiscale: r.codice_fiscale,
        citta: r.citta,
        provincia_sigla: r.provincia_sigla,
        score,
        via: r._rsLower.includes(qLower) ? 'ilike' : 'fuzzy',
      });
    }
  }
  results.sort((a, b) => b.score - a.score || a.ragione_sociale.localeCompare(b.ragione_sociale));
  return results.slice(0, limit);
}
