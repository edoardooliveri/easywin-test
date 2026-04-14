/**
 * Script: Scansione Completa Albi Fornitori (Fase 1)
 *
 * Strategia ibrida:
 *   1. Costruisce URL candidati dal nome/tipo dell'ente (pattern italiani noti)
 *   2. Usa DuckDuckGo SOLO se i pattern non funzionano (con rate-limit)
 *   3. Analizza pagine con keyword matching (zero costi AI)
 *   4. Salva risultati in JSON incrementale + DB PostgreSQL
 *
 * Incrementale: salta stazioni già nel file risultati.
 * Interrompibile con Ctrl+C (salva prima di uscire).
 *
 * Uso:
 *   node scripts/scan-albi-completo.js                 # Tutte le rimanenti
 *   node scripts/scan-albi-completo.js --limit 500     # Max 500
 *   node scripts/scan-albi-completo.js --dry-run       # Solo report, no DB
 *   node scripts/scan-albi-completo.js --from-id 2472  # Parti da ID specifico
 *   node scripts/scan-albi-completo.js --batch 1000    # Batch size per query DB
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ══════════════════════════════════════════
// CONFIGURAZIONE
// ══════════════════════════════════════════
const CONFIG = {
  DELAY_MS: 1200,
  FETCH_TIMEOUT: 10000,
  DDG_DELAY_MS: 3000,        // Pausa più lunga tra ricerche DDG
  DDG_MAX_PER_SESSION: 50,   // Max ricerche DDG per sessione (evita blocchi)
  RESULTS_FILE: join(ROOT, 'data', 'albi_fornitori_results.json'),
  PROGRESS_FILE: join(__dirname, 'scan-albi-progress.json'),
  SAVE_EVERY: 20,
};

// ══════════════════════════════════════════
// KEYWORD LISTS
// ══════════════════════════════════════════
const KEYWORDS_ALBO = [
  'albo fornitori', 'albo dei fornitori', 'elenco fornitori',
  'elenco operatori economici', 'albo telematico',
  'qualificazione fornitori', 'vendor list', 'elenco aperto',
  'iscrizione albo', 'registrazione fornitori', 'abilitazione fornitori'
];

const KEYWORDS_DOCS = [
  'durc', 'visura camerale', 'firma digitale', 'pec', 'dgue',
  'certificazione', 'attestazione soa', 'autocertificazione',
  'documento di gara', 'dichiarazione sostitutiva', 'casellario giudiziale',
  'antimafia', 'regolarità contributiva', 'bilancio', 'fatturato',
  'polizza assicurativa', 'cauzione', 'bollo', 'marca da bollo',
  'documento identità', 'procura', 'mandato', 'iscrizione camera di commercio'
];

const ALBO_PATHS = [
  '/albo-fornitori', '/albo-dei-fornitori', '/elenco-fornitori',
  '/bandi-e-contratti/albo-fornitori',
  '/amministrazione-trasparente/bandi-di-gara-e-contratti',
  '/fornitori', '/operatori-economici', '/it/albo-fornitori',
  '/pagine/albo-fornitori', '/albo.php', '/elenco.php',
];

const PIATTAFORME = {
  'tuttogare': 'TuttoGare', 'net4market': 'Net4market',
  'sintel': 'Sintel', 'mepa': 'MePA', 'start.toscana': 'START',
  'intercent': 'Intercent-ER', 'empulia': 'Empulia',
  'sardegnacat': 'SardegnaCAT', 'bravosolution': 'BravoSolutions',
  'digitalpa': 'DigitalPA', 'maggioli': 'MAGGIOLI',
  'appaltiecontratti': 'MAGGIOLI', 'mercurio': 'MERCURIO',
  'traspare': 'TRASPARE', 'asmecomm': 'Asmecomm',
  'asmel': 'Asmepal', 'i-faber': 'FABER',
  'consip': 'CONSIP', 'acquistinretepa': 'MePA',
  'portaleappalti': 'PortaleAppalti', 'acquistitelematici': 'NetworkPA',
  'albofornitori': 'Portale Albo Fornitori', 'e-procurement': 'e-Procurement',
  'gare.asta': 'AstaLegale', 'stella': 'STELLA',
};

// ══════════════════════════════════════════
// MAPPA PROVINCE (id → sigla lowercase)
// ══════════════════════════════════════════

// Province sarde soppresse nel 2016: mappatura vecchio → nuovo codice
const OLD_SARDINIA_MAP = {
  'ci': 'su',  // Carbonia-Iglesias → Sud Sardegna
  'vs': 'su',  // Medio Campidano → Sud Sardegna
  'og': 'nu',  // Ogliastra → Nuoro
  'ot': 'ss',  // Olbia-Tempio → Sassari
};

let PROVINCE_MAP = {};

async function loadProvince() {
  const r = await pool.query('SELECT id, sigla FROM province');
  for (const row of r.rows) {
    const sigla = row.sigla.toLowerCase();
    // Se è una vecchia provincia sarda, usa il codice aggiornato
    PROVINCE_MAP[row.id] = OLD_SARDINIA_MAP[sigla] || sigla;
  }
}

// ══════════════════════════════════════════
// URL BUILDER — costruisce URL probabili dal nome ente
// ══════════════════════════════════════════
function cleanName(s) {
  return s
    .replace(/\(.*?\)/g, '').trim()
    .toLowerCase()
    .replace(/[àáâäã]/g, 'a').replace(/[èéêë]/g, 'e')
    .replace(/[ìíîï]/g, 'i').replace(/[òóôöõ]/g, 'o')
    .replace(/[ùúûü]/g, 'u')
    .replace(/[´`'']/g, "'")    // Normalizza apostrofi
    .replace(/[']/g, '-')       // Apostrofo → trattino per URL
    .replace(/[\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function buildUrlsFromName(nome, citta, idProvincia) {
  const urls = [];
  const nomeUpper = nome.toUpperCase().trim()
    .replace(/[´`'']/g, "'");   // Normalizza apostrofi
  const sigla = PROVINCE_MAP[idProvincia] || '';

  // === COMUNI ===
  const matchComune = nomeUpper.match(/^COMUNE\s+D[I']\s*(.+)/);
  if (matchComune) {
    const nomeComune = cleanName(matchComune[1]);
    if (sigla && nomeComune) {
      urls.push(`https://www.comune.${nomeComune}.${sigla}.it`);
      // Senza trattino (alcuni comuni lo omettono)
      if (nomeComune.includes('-')) {
        urls.push(`https://www.comune.${nomeComune.replace(/-/g, '')}.${sigla}.it`);
      }
    }
    // Senza sigla provincia
    if (nomeComune) {
      urls.push(`https://www.comune.${nomeComune}.it`);
    }
  }

  // === PROVINCE / CITTÀ METROPOLITANE ===
  const matchProvincia = nomeUpper.match(/^(?:PROVINCIA|CITT[AÀ]'?\s+METROPOLITANA)\s+D[I']\s*(.+)/);
  if (matchProvincia) {
    const nomeProv = cleanName(matchProvincia[1]);
    urls.push(`https://www.provincia.${nomeProv}.it`);
    urls.push(`https://www.cittametropolitana.${nomeProv}.it`);
    urls.push(`https://www.provincia.${nomeProv}.gov.it`);
  }

  // === REGIONI ===
  const matchRegione = nomeUpper.match(/^REGIONE\s+(?:AUTONOMA\s+(?:DELLA?\s+)?)?(.+)/);
  if (matchRegione) {
    const nomeReg = cleanName(matchRegione[1]);
    urls.push(`https://www.regione.${nomeReg}.it`);
  }

  // === ASL / AUSL / ATS / ASST / AZIENDA SANITARIA ===
  if (nomeUpper.match(/\b(ASL|AUSL|ATS|ASST|AZIENDA\s+(SANITARIA|USL|OSPEDALIERA|UNITA))\b/)) {
    if (citta) {
      const cittaClean = cleanName(citta);
      urls.push(`https://www.asl${cittaClean}.it`);
      urls.push(`https://www.ausl.${cittaClean}.it`);
    }
  }

  // === UNIVERSITA' ===
  if (nomeUpper.match(/\bUNIVERSIT[AÀ']\b/)) {
    if (citta) {
      const cittaClean = citta.toLowerCase()
        .replace(/[àáâ]/g, 'a').replace(/[èéê]/g, 'e')
        .replace(/['\s-]+/g, '').replace(/[^a-z0-9]/g, '');
      urls.push(`https://www.uni${cittaClean}.it`);
      urls.push(`https://www.univ${cittaClean}.it`);
    }
  }

  // === SPA / SRL — aziende partecipate ===
  if (nomeUpper.match(/\b(S\.?P\.?A\.?|S\.?R\.?L\.?)\b/) && urls.length === 0) {
    const nomeClean = nome
      .replace(/\(.*?\)/g, '').trim()
      .replace(/\bS\.?P\.?A\.?\b/gi, '').replace(/\bS\.?R\.?L\.?\b/gi, '')
      .trim().toLowerCase()
      .replace(/['\s]+/g, '').replace(/[^a-z0-9]/g, '');
    if (nomeClean.length > 2 && nomeClean.length < 30) {
      urls.push(`https://www.${nomeClean}.it`);
    }
  }

  return urls;
}

// ══════════════════════════════════════════
// HTTP UTILITIES
// ══════════════════════════════════════════
async function fetchPage(url, timeout = CONFIG.FETCH_TIMEOUT) {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeout);
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'it-IT,it;q=0.9,en;q=0.5'
      }
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text')) return null;
    return await res.text();
  } catch { return null; }
}

function extractText(html) {
  if (!html) return '';
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/&#\d+;/g, ' ').replace(/\s+/g, ' ')
    .toLowerCase().trim();
}

function extractLinks(html, baseUrl) {
  if (!html) return [];
  const links = [];
  const regex = /href=["']([^"']+)["']/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    let href = m[1];
    if (href.startsWith('/')) {
      try {
        const base = new URL(baseUrl);
        href = `${base.protocol}//${base.host}${href}`;
      } catch { continue; }
    }
    if (href.startsWith('http')) links.push(href);
  }
  return links;
}

// ══════════════════════════════════════════
// DDG SEARCH (con rate limit, solo come fallback)
// ══════════════════════════════════════════
let ddgCount = 0;

async function cercaDDG(nome, citta) {
  if (ddgCount >= CONFIG.DDG_MAX_PER_SESSION) return [];

  const nomeClean = nome
    .replace(/\(.*?\)/g, '').replace(/\bex\b.*/i, '')
    .replace(/\bs\.?p\.?a\.?\b/gi, '').replace(/\bs\.?r\.?l\.?\b/gi, '')
    .trim();

  const query = `"${nomeClean}" albo fornitori`;
  try {
    await delay(CONFIG.DDG_DELAY_MS);
    const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const html = await fetchPage(ddgUrl, 10000);
    ddgCount++;
    if (!html) return [];

    const urls = new Set();
    const uddg = html.match(/uddg=([^&"]+)/g) || [];
    for (const m of uddg) {
      try {
        const decoded = decodeURIComponent(m.replace('uddg=', ''));
        if (decoded.startsWith('http') &&
            !decoded.includes('duckduckgo') && !decoded.includes('google.') &&
            !decoded.includes('youtube') && !decoded.includes('wikipedia') &&
            !decoded.includes('facebook') && decoded.length < 300) {
          urls.add(decoded.replace(/\/+$/, ''));
        }
      } catch { /* bad encoding */ }
    }
    return [...urls].slice(0, 5);
  } catch { return []; }
}

// ══════════════════════════════════════════
// PLATFORM LINK DETECTION — cerca link a piattaforme e-procurement nella pagina
// ══════════════════════════════════════════
const PLATFORM_DOMAINS = [
  'traspare.com', 'tuttogare.net', 'net4market.com',
  'maggiolicloud.it', 'portaleappalti.it', 'acquistitelematici.it',
  'digitalpa.it', 'bfrm.it', 'asmecomm.it', 'albofornitori.',
  'sintel.regione.lombardia.it', 'start.toscana.it',
  'intercenter.regione.emilia-romagna.it', 'empulia.it',
  'sardegnacat.it', 'acquistinretepa.it', 'stella.regione.lazio.it',
  'e-procurement', 'gare.asta', 'appalti.maggioli',
  'bfrm.it', 'networkpa.it',
];

function detectPlatformLinks(html, baseUrl) {
  if (!html) return null;
  const links = [];
  const regex = /href=["'](https?:\/\/[^"']+)["']/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const href = m[1].toLowerCase();
    // Skip link interni (stesso dominio)
    try {
      const baseHost = new URL(baseUrl).hostname;
      const linkHost = new URL(m[1]).hostname;
      if (linkHost === baseHost) continue;
    } catch { continue; }

    for (const domain of PLATFORM_DOMAINS) {
      if (href.includes(domain)) {
        links.push({ url: m[1], platform: domain });
      }
    }
  }
  return links.length > 0 ? links[0] : null;
}

// ══════════════════════════════════════════
// ANALYSIS FUNCTIONS
// ══════════════════════════════════════════
function detectAlbo(text) {
  return KEYWORDS_ALBO.filter(kw => text.includes(kw)).length;
}

function extractDocuments(text) {
  return KEYWORDS_DOCS.filter(kw => text.includes(kw))
    .map(kw => kw.charAt(0).toUpperCase() + kw.slice(1));
}

function extractProcedura(text) {
  const patterns = [
    /(?:per iscriversi|per registrarsi|procedura di iscrizione|modalit[àa] di iscrizione)[^.]{10,300}\./gi,
    /(?:gli operatori economici|le imprese|i fornitori)[^.]*(?:devono|possono|dovranno)[^.]{10,200}\./gi,
    /(?:la domanda|l'istanza|la richiesta)[^.]*(?:deve essere|va presentata|va inoltrata)[^.]{10,200}\./gi,
  ];
  const frasi = [];
  for (const p of patterns) {
    const matches = text.match(p) || [];
    frasi.push(...matches.map(m => m.trim()).slice(0, 2));
  }
  return frasi.join(' ').substring(0, 500);
}

function detectPiattaforma(text, url) {
  const combined = (text + ' ' + url).toLowerCase();
  for (const [key, name] of Object.entries(PIATTAFORME)) {
    if (combined.includes(key)) return name;
  }
  return null;
}

// ══════════════════════════════════════════
// PROCESSA UNA STAZIONE
// ══════════════════════════════════════════
async function processaStazione(stazione) {
  const { id, nome, citta, sito_web, id_provincia } = stazione;
  const result = {
    id,
    ragione_sociale: nome,
    citta: citta || '',
    ha_albo: false,
    url_albo: null,
    piattaforma: null,
    documenti_richiesti: [],
    procedura_iscrizione: '',
    sito_web_trovato: null,
    note: ''
  };

  // Step 1: Costruisci URL candidati
  let urls = [];

  // Se ha già un sito web noto
  if (sito_web) {
    const base = sito_web.replace(/\/$/, '');
    urls.push(base);
    for (const path of ALBO_PATHS) {
      urls.push(base + path);
    }
  }

  // URL costruiti dal nome (pattern italiani)
  const patternUrls = buildUrlsFromName(nome, citta, id_provincia);
  for (const base of patternUrls) {
    urls.push(base);
    for (const path of ALBO_PATHS.slice(0, 4)) {
      urls.push(base + path);
    }
  }

  // Deduplica
  urls = [...new Set(urls)];

  // Step 2: Prova i pattern URL
  let bestScore = 0;
  let bestText = '';
  let bestUrl = '';
  let foundSite = false;

  for (const url of urls.slice(0, 12)) {
    const html = await fetchPage(url);
    if (!html) continue;

    foundSite = true;
    if (!result.sito_web_trovato) {
      try {
        const parsed = new URL(url);
        result.sito_web_trovato = `${parsed.protocol}//${parsed.host}`;
      } catch {}
    }

    const text = extractText(html);
    const score = detectAlbo(text);

    if (score > bestScore) {
      bestScore = score;
      bestText = text;
      bestUrl = url;
    }

    // CHECK: link a piattaforme e-procurement esterne nella pagina
    const platformLink = detectPlatformLinks(html, url);
    if (platformLink && bestScore < 2) {
      // Trovato link a piattaforma esterna — segnalalo come albo probabile
      bestScore = Math.max(bestScore, 2);
      bestUrl = platformLink.url;
      // Tenta di scaricare la piattaforma per info più dettagliate
      const platHtml = await fetchPage(platformLink.url);
      if (platHtml) {
        bestText = extractText(platHtml);
      }
    }

    // Se troviamo keyword, esplora link interni
    if (score >= 1) {
      const links = extractLinks(html, url);
      const alboLinks = links.filter(l => {
        const ll = l.toLowerCase();
        return ll.includes('albo') || ll.includes('fornitore') ||
               ll.includes('elenco') || ll.includes('iscrizione') ||
               ll.includes('operatori');
      });

      for (const link of alboLinks.slice(0, 3)) {
        const subHtml = await fetchPage(link);
        if (!subHtml) continue;
        const subText = extractText(subHtml);
        const subScore = detectAlbo(subText);
        if (subScore > bestScore) {
          bestScore = subScore;
          bestText = subText;
          bestUrl = link;
        }
      }
      break;
    }

    // Se homepage senza risultati, non provare tutti gli ALBO_PATHS — troppo lento
    // Prova solo il base URL e il primo path
    if (url === urls[0] && score === 0 && !platformLink) {
      // Salta direttamente ai path specifici per albo
      continue;
    }

    await delay(200);
  }

  // Step 3: Se nessun URL pattern funziona, prova DDG (solo per enti con bandi)
  if (!foundSite && stazione.n_bandi > 0) {
    const ddgUrls = await cercaDDG(nome, citta);
    for (const url of ddgUrls.slice(0, 4)) {
      const html = await fetchPage(url);
      if (!html) continue;

      foundSite = true;
      if (!result.sito_web_trovato) {
        try {
          const parsed = new URL(url);
          result.sito_web_trovato = `${parsed.protocol}//${parsed.host}`;
        } catch {}
      }

      const text = extractText(html);
      const score = detectAlbo(text);

      if (score > bestScore) {
        bestScore = score;
        bestText = text;
        bestUrl = url;
      }

      if (score >= 1) {
        const links = extractLinks(html, url);
        const alboLinks = links.filter(l => {
          const ll = l.toLowerCase();
          return ll.includes('albo') || ll.includes('fornitore') ||
                 ll.includes('elenco') || ll.includes('operatori');
        });
        for (const link of alboLinks.slice(0, 2)) {
          const subHtml = await fetchPage(link);
          if (!subHtml) continue;
          const subText = extractText(subHtml);
          const subScore = detectAlbo(subText);
          if (subScore > bestScore) {
            bestScore = subScore;
            bestText = subText;
            bestUrl = link;
          }
        }
        break;
      }
    }
  }

  // Step 4: Classifica risultato
  if (bestScore >= 2) {
    result.ha_albo = true;
    result.url_albo = bestUrl;
    result.documenti_richiesti = extractDocuments(bestText);
    result.procedura_iscrizione = extractProcedura(bestText);
    result.piattaforma = detectPiattaforma(bestText, bestUrl);
    result.note = `Confidenza: ${bestScore >= 4 ? 'alta' : 'media'} (score ${bestScore})`;
  } else if (bestScore === 1) {
    result.ha_albo = true;
    result.url_albo = bestUrl;
    result.documenti_richiesti = extractDocuments(bestText);
    result.piattaforma = detectPiattaforma(bestText, bestUrl);
    result.note = `Confidenza: bassa (score 1) — da verificare`;
  } else {
    result.note = foundSite
      ? 'Sito raggiungibile ma nessun albo trovato'
      : 'Sito non trovato (URL pattern + DDG)';
  }

  return result;
}

// ══════════════════════════════════════════
// DATABASE
// ══════════════════════════════════════════
async function salvaDB(result, dryRun) {
  if (dryRun) return;

  // Aggiorna sito_web sulla stazione se trovato
  if (result.sito_web_trovato) {
    try {
      await pool.query(
        "UPDATE stazioni SET sito_web = $2, updated_at = NOW() WHERE id = $1 AND (sito_web IS NULL OR sito_web = '')",
        [result.id, result.sito_web_trovato]
      );
    } catch { /* ignore */ }
  }

  if (!result.ha_albo) return;

  try {
    const existing = await pool.query(
      'SELECT id FROM albi_fornitori WHERE id_stazione = $1 AND attivo = true', [result.id]
    );
    const docsJson = JSON.stringify(
      result.documenti_richiesti.map(d =>
        typeof d === 'string' ? { nome: d, obbligatorio: true } : d
      )
    );

    if (existing.rows.length > 0) {
      await pool.query(`
        UPDATE albi_fornitori SET
          url_albo = COALESCE($2, url_albo),
          piattaforma = COALESCE($3, piattaforma),
          documenti_richiesti = CASE WHEN $4::jsonb != '[]'::jsonb THEN $4::jsonb ELSE documenti_richiesti END,
          procedura_iscrizione = CASE WHEN $5 != '' THEN $5 ELSE procedura_iscrizione END,
          note = COALESCE($6, note),
          ultimo_aggiornamento = NOW(), updated_at = NOW()
        WHERE id_stazione = $1 AND attivo = true
      `, [result.id, result.url_albo, result.piattaforma, docsJson,
          result.procedura_iscrizione, result.note]);
    } else {
      await pool.query(`
        INSERT INTO albi_fornitori (id_stazione, nome_albo, url_albo, piattaforma,
          documenti_richiesti, procedura_iscrizione, note, attivo, verificato, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, true, false, NOW())
      `, [result.id, 'Albo Fornitori', result.url_albo, result.piattaforma,
          docsJson, result.procedura_iscrizione, result.note]);
    }
  } catch (e) {
    console.error(`  ❌ DB error [${result.id}]: ${e.message}`);
  }
}

// ══════════════════════════════════════════
// PERSISTENCE
// ══════════════════════════════════════════
function loadResults() {
  if (existsSync(CONFIG.RESULTS_FILE)) {
    return JSON.parse(readFileSync(CONFIG.RESULTS_FILE, 'utf8'));
  }
  return { last_updated: new Date().toISOString().slice(0, 10), stats: {}, scanned: {} };
}

function saveResults(data) {
  let con = 0, senza = 0, verif = 0;
  for (const v of Object.values(data.scanned)) {
    if (v.ha_albo === true) con++;
    else if (v.ha_albo === false) senza++;
    else verif++;
  }
  data.stats = { total_scanned: Object.keys(data.scanned).length, con_albo: con, senza_albo: senza, da_verificare: verif };
  data.last_updated = new Date().toISOString().slice(0, 10);
  writeFileSync(CONFIG.RESULTS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ══════════════════════════════════════════
// SIGNAL HANDLER
// ══════════════════════════════════════════
let results = null;
let shuttingDown = false;

process.on('SIGINT', () => {
  if (shuttingDown) process.exit(1);
  shuttingDown = true;
  console.log('\n\n⚠️  Interruzione — salvataggio...');
  if (results) saveResults(results);
  console.log('💾 Salvato. Riprendi con lo stesso comando.\n');
  process.exit(0);
});

// ══════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limit = parseInt(args.find((_, i) => args[i - 1] === '--limit') || '99999');
  const fromId = parseInt(args.find((_, i) => args[i - 1] === '--from-id') || '0');
  const batchSize = parseInt(args.find((_, i) => args[i - 1] === '--batch') || '2000');

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  SCANSIONE ALBI FORNITORI — Pattern + DDG (no AI)        ║');
  console.log(`║  Modo: ${dryRun ? 'DRY RUN' : 'PRODUZIONE'}  Limit: ${limit}  From-ID: ${fromId}              ║`);
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  await loadProvince();
  results = loadResults();

  const alreadyScanned = new Set(Object.keys(results.scanned).map(Number));
  console.log(`📊 Già scansionate: ${alreadyScanned.size}`);
  console.log(`📊 Province caricate: ${Object.keys(PROVINCE_MAP).length}`);

  // Query stazioni ordinate per importanza (n_bandi DESC)
  const res = await pool.query(`
    SELECT s.id, s.nome, s.citta, s.sito_web, s.id_provincia,
           (SELECT COUNT(*) FROM bandi b WHERE b.id_stazione = s.id) AS n_bandi
    FROM stazioni s
    WHERE s.attivo = true AND s.id >= $1
    ORDER BY (SELECT COUNT(*) FROM bandi b WHERE b.id_stazione = s.id) DESC
    LIMIT $2
  `, [fromId, limit + alreadyScanned.size + 500]);

  const toProcess = res.rows.filter(s => !alreadyScanned.has(s.id)).slice(0, limit);
  console.log(`🎯 Da processare: ${toProcess.length}\n`);

  if (toProcess.length === 0) {
    console.log('✅ Tutte le stazioni sono già state scansionate!');
    await pool.end();
    return;
  }

  let n = 0, alboCount = 0, noAlboCount = 0, errCount = 0;
  const startTime = Date.now();

  for (const st of toProcess) {
    if (shuttingDown) break;

    n++;
    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    const rate = n > 5 ? ((Date.now() - startTime) / n / 1000).toFixed(1) : '?';
    const eta = n > 5 ? (((Date.now() - startTime) / n * (toProcess.length - n)) / 1000 / 60).toFixed(0) : '?';

    process.stdout.write(
      `  [${n}/${toProcess.length}] (${elapsed}m, ~${rate}s/st, ETA ~${eta}m) ` +
      `${st.nome.substring(0, 38).padEnd(38)} `
    );

    try {
      const r = await processaStazione(st);

      if (r.ha_albo) {
        console.log(`✅ ${r.piattaforma || 'ALBO'} [${r.documenti_richiesti.length} docs]`);
        alboCount++;
      } else {
        const tag = r.sito_web_trovato ? '🌐 no albo' : '❌ no sito';
        console.log(tag);
        noAlboCount++;
      }

      results.scanned[String(st.id)] = r;
      await salvaDB(r, dryRun);

    } catch (e) {
      console.log(`💥 ${e.message.substring(0, 50)}`);
      errCount++;
      results.scanned[String(st.id)] = {
        id: st.id, ragione_sociale: st.nome, citta: st.citta || '',
        ha_albo: false, note: `Errore: ${e.message.substring(0, 100)}`
      };
    }

    if (n % CONFIG.SAVE_EVERY === 0) {
      saveResults(results);
    }

    await delay(CONFIG.DELAY_MS);
  }

  saveResults(results);

  const stats = results.stats;
  console.log('\n' + '═'.repeat(58));
  console.log('📊 SESSIONE');
  console.log(`  Processate: ${n}  |  Albo: ${alboCount}  |  No: ${noAlboCount}  |  Errori: ${errCount}`);
  console.log(`  DDG usati: ${ddgCount}/${CONFIG.DDG_MAX_PER_SESSION}`);
  console.log('');
  console.log('📊 TOTALE CUMULATIVO');
  console.log(`  Scansionate: ${stats.total_scanned} / 16.729 (${(stats.total_scanned/16729*100).toFixed(1)}%)`);
  console.log(`  Con albo: ${stats.con_albo}  |  Senza: ${stats.senza_albo}  |  Da verificare: ${stats.da_verificare}`);
  console.log(`\n💾 ${CONFIG.RESULTS_FILE}`);

  await pool.end();
}

main().catch(e => { console.error('FATALE:', e); process.exit(1); });
