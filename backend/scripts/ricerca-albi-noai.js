/**
 * Script: Ricerca Albi Fornitori SENZA AI (zero costi API)
 *
 * Per ogni stazione:
 * 1. Prova il sito web noto + URL comuni per albo
 * 2. Cerca parole chiave nella pagina (albo fornitori, iscrizione, documenti)
 * 3. Estrae info con parsing HTML semplice
 * 4. Salva nel database
 *
 * Incrementale: salva progresso, può essere interrotto e ripreso.
 *
 * Uso:
 *   node scripts/ricerca-albi-noai.js                # Tutte
 *   node scripts/ricerca-albi-noai.js --limit 500    # Prime 500
 *   node scripts/ricerca-albi-noai.js --dry-run       # Solo report
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { writeFileSync, readFileSync, existsSync } from 'fs';

dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const CONFIG = {
  DELAY_MS: 1500,
  FETCH_TIMEOUT: 12000,
  PROGRESS_FILE: 'scripts/albi-progress.json',
  REPORT_FILE: 'scripts/albi-risultati.csv',
};

// Parole chiave che indicano un albo fornitori
const KEYWORDS_ALBO = [
  'albo fornitori', 'albo dei fornitori', 'elenco fornitori', 'elenco operatori economici',
  'albo telematico', 'qualificazione fornitori', 'vendor list', 'elenco aperto',
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

// URL patterns comuni per albi fornitori
const ALBO_PATHS = [
  '/albo-fornitori',
  '/albo-dei-fornitori',
  '/elenco-fornitori',
  '/bandi-e-contratti/albo-fornitori',
  '/amministrazione-trasparente/bandi-di-gara-e-contratti',
  '/fornitori',
  '/operatori-economici',
  '/it/albo-fornitori',
  '/pagine/albo-fornitori',
  '/archivio_gare/albo.php',
  '/albo.php',
  '/albi.php',
  '/elenco.php',
];

// ══════════════════════════════════
// FUNZIONI
// ══════════════════════════════════

async function fetchPage(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONFIG.FETCH_TIMEOUT);
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'it-IT,it;q=0.9,en;q=0.5'
      }
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text')) return null;
    const html = await res.text();
    return html;
  } catch { return null; }
}

function extractText(html) {
  if (!html) return '';
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ');
  return text.toLowerCase().trim();
}

function extractLinks(html, baseUrl) {
  if (!html) return [];
  const links = [];
  const regex = /href=["']([^"']+)["']/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    let href = match[1];
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

function detectAlbo(text) {
  const found = KEYWORDS_ALBO.filter(kw => text.includes(kw));
  return found.length;
}

function extractDocuments(text) {
  const docs = [];
  for (const kw of KEYWORDS_DOCS) {
    if (text.includes(kw)) {
      docs.push(kw.charAt(0).toUpperCase() + kw.slice(1));
    }
  }
  return docs;
}

function extractProcedura(text) {
  // Cerca frasi che descrivono la procedura
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
  const piattaforme = {
    'tuttogare': 'TuttoGare',
    'net4market': 'Net4market',
    'sintel': 'Sintel',
    'mepa': 'MePA',
    'start.toscana': 'START',
    'intercent': 'Intercent-ER',
    'empulia': 'Empulia',
    'sardegnacat': 'SardegnaCAT',
    'bravosolution': 'BravoSolutions',
    'digitalpa': 'DigitalPA',
    'maggioli': 'MAGGIOLI',
    'appaltiecontratti': 'MAGGIOLI',
    'mercurio': 'MERCURIO',
    'traspare': 'TRASPARE',
    'asmecomm': 'Asmecomm',
    'asmel': 'Asmepal',
    'i-faber': 'FABER',
    'consip': 'CONSIP',
    'acquistinretepa': 'MePA',
  };
  const combined = (text + ' ' + url).toLowerCase();
  for (const [key, name] of Object.entries(piattaforme)) {
    if (combined.includes(key)) return name;
  }
  return null;
}

async function processaStazione(stazione) {
  const { id, nome, citta, sito_web } = stazione;
  const result = {
    id,
    nome,
    citta,
    ha_albo: false,
    confidenza: 'bassa',
    url_albo: null,
    piattaforma: null,
    documenti: [],
    procedura: '',
    note: ''
  };

  // Build candidate URLs
  const urls = [];
  if (sito_web) {
    const base = sito_web.replace(/\/$/, '');
    urls.push(base);
    for (const path of ALBO_PATHS) {
      urls.push(base + path);
    }
  }

  let bestScore = 0;
  let bestText = '';
  let bestUrl = '';

  for (const url of urls.slice(0, 10)) {
    const html = await fetchPage(url);
    if (!html) continue;

    const text = extractText(html);
    const score = detectAlbo(text);

    if (score > bestScore) {
      bestScore = score;
      bestText = text;
      bestUrl = url;
    }

    // Se troviamo un punteggio alto, esplora anche i link interni
    if (score >= 1) {
      const links = extractLinks(html, url);
      const alboLinks = links.filter(l =>
        l.toLowerCase().includes('albo') ||
        l.toLowerCase().includes('fornitore') ||
        l.toLowerCase().includes('elenco') ||
        l.toLowerCase().includes('iscrizione')
      );

      for (const link of alboLinks.slice(0, 3)) {
        if (urls.includes(link)) continue;
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
      break; // Abbiamo trovato almeno una pagina rilevante
    }

    await delay(300);
  }

  if (bestScore >= 2) {
    result.ha_albo = true;
    result.confidenza = bestScore >= 4 ? 'alta' : bestScore >= 2 ? 'media' : 'bassa';
    result.url_albo = bestUrl;
    result.documenti = extractDocuments(bestText);
    result.procedura = extractProcedura(bestText);
    result.piattaforma = detectPiattaforma(bestText, bestUrl);
  } else if (bestScore === 1) {
    result.ha_albo = true;
    result.confidenza = 'bassa';
    result.url_albo = bestUrl;
    result.documenti = extractDocuments(bestText);
    result.piattaforma = detectPiattaforma(bestText, bestUrl);
    result.note = 'Trovata menzione generica, da verificare manualmente';
  }

  return result;
}

async function salvaDB(result, dryRun) {
  if (!result.ha_albo || dryRun) return;

  try {
    const existing = await pool.query(
      'SELECT id FROM albi_fornitori WHERE id_stazione = $1 AND attivo = true', [result.id]
    );

    const docsJson = JSON.stringify(result.documenti.map(d => ({ nome: d, obbligatorio: true })));

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
      `, [result.id, result.url_albo, result.piattaforma, docsJson, result.procedura,
          `Auto-scan web. Confidenza: ${result.confidenza}`]);
    } else {
      await pool.query(`
        INSERT INTO albi_fornitori (id_stazione, nome_albo, url_albo, piattaforma,
          documenti_richiesti, procedura_iscrizione, note, attivo, verificato, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, true, false, NOW())
      `, [result.id, 'Albo Fornitori', result.url_albo, result.piattaforma,
          docsJson, result.procedura,
          `Auto-scan web. Confidenza: ${result.confidenza}`]);
    }
  } catch (e) {
    console.error(`  ❌ DB error [${result.id}]: ${e.message}`);
  }
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function loadProgress() {
  if (existsSync(CONFIG.PROGRESS_FILE))
    return JSON.parse(readFileSync(CONFIG.PROGRESS_FILE, 'utf8'));
  return { done: new Set(), stats: { tot: 0, albo: 0, no: 0, err: 0 } };
}

function saveProgress(p) {
  const obj = { ...p, done: [...p.done] };
  writeFileSync(CONFIG.PROGRESS_FILE, JSON.stringify(obj), 'utf8');
}

// ══════════════════════════════════
// MAIN
// ══════════════════════════════════
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limit = parseInt(args.find((_, i) => args[i - 1] === '--limit') || '99999');
  const offset = parseInt(args.find((_, i) => args[i - 1] === '--offset') || '0');

  console.log('╔═══════════════════════════════════════════════╗');
  console.log('║  RICERCA ALBI FORNITORI (no AI, zero costi)   ║');
  console.log(`║  Modo: ${dryRun ? 'DRY RUN' : 'PRODUZIONE'}  Limit: ${limit}  Offset: ${offset}  ║`);
  console.log('╚═══════════════════════════════════════════════╝\n');

  const rawProgress = loadProgress();
  const progress = {
    done: new Set(Array.isArray(rawProgress.done) ? rawProgress.done : []),
    stats: rawProgress.stats || { tot: 0, albo: 0, no: 0, err: 0 }
  };

  // Prendi stazioni con sito_web, ordinate per n_bandi DESC
  const res = await pool.query(`
    SELECT s.id, s.nome, s.citta, s.sito_web,
           (SELECT COUNT(*) FROM bandi b WHERE b.id_stazione = s.id) AS n_bandi
    FROM stazioni s
    WHERE s.attivo = true
      AND s.sito_web IS NOT NULL AND s.sito_web != ''
      AND NOT EXISTS (
        SELECT 1 FROM albi_fornitori af
        WHERE af.id_stazione = s.id AND af.attivo = true AND af.verificato = true
      )
    ORDER BY (SELECT COUNT(*) FROM bandi b WHERE b.id_stazione = s.id) DESC
    OFFSET $1 LIMIT $2
  `, [offset, limit]);

  const stazioni = res.rows;
  console.log(`📊 Stazioni da processare: ${stazioni.length}\n`);

  const csvRows = ['ID;Nome;Citta;Sito_Web;Ha_Albo;Confidenza;URL_Albo;Piattaforma;N_Documenti;Documenti;Procedura'];
  let n = 0;

  for (const st of stazioni) {
    if (progress.done.has(st.id)) {
      continue;
    }

    n++;
    process.stdout.write(`  [${n}/${stazioni.length}] ${st.nome.substring(0, 45).padEnd(45)} `);

    try {
      const r = await processaStazione(st);

      if (r.ha_albo) {
        console.log(`✅ ALBO (${r.confidenza}) ${r.documenti.length} docs`);
        progress.stats.albo++;
      } else {
        console.log(`❌ no albo`);
        progress.stats.no++;
      }

      await salvaDB(r, dryRun);

      csvRows.push(`${r.id};"${r.nome.replace(/"/g, '""')}";"${r.citta || ''}";"${st.sito_web || ''}"` +
        `;${r.ha_albo};${r.confidenza};"${r.url_albo || ''}";"${r.piattaforma || ''}"` +
        `;${r.documenti.length};"${r.documenti.join(', ')}";"${r.procedura.substring(0, 200).replace(/"/g, '""')}"`);

    } catch (e) {
      console.log(`💥 ERRORE: ${e.message.substring(0, 60)}`);
      progress.stats.err++;
    }

    progress.done.add(st.id);
    progress.stats.tot++;

    // Salva progresso ogni 10 stazioni
    if (n % 10 === 0) {
      saveProgress(progress);
      writeFileSync(CONFIG.REPORT_FILE, csvRows.join('\n'), 'utf8');
    }

    await delay(CONFIG.DELAY_MS);
  }

  // Salva finale
  saveProgress(progress);
  writeFileSync(CONFIG.REPORT_FILE, csvRows.join('\n'), 'utf8');

  console.log('\n' + '═'.repeat(50));
  console.log(`✅ Processate: ${progress.stats.tot}`);
  console.log(`📋 Con albo:   ${progress.stats.albo}`);
  console.log(`❌ Senza albo: ${progress.stats.no}`);
  console.log(`💥 Errori:     ${progress.stats.err}`);
  console.log(`📄 Report:     ${CONFIG.REPORT_FILE}`);

  await pool.end();
}

main().catch(e => { console.error('FATALE:', e); process.exit(1); });
