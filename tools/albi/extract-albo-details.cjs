#!/usr/bin/env node
/**
 * extract-albo-details.js
 *
 * Takes Chrome SEARCH results as JSON stdin, fetches platform pages for entries
 * with ha_albo=true, extracts documenti_richiesti and procedura_iscrizione.
 * Merges results into albi_fornitori_results.json.
 *
 * Usage: echo '[{...results...}]' | node extract-albo-details.js
 */

const fs = require('fs');
const https = require('https');
const http = require('http');
const path = require('path');

const RESULTS_FILE = path.join(__dirname, '../../data/albi_fornitori_results.json');

// Platform-specific patterns for extracting albo details
const PLATFORM_EXTRACTORS = {
  'Traspare': {
    // Traspare albi are usually at /albo-fornitori or /elenco-operatori
    docKeywords: ['documentazione', 'documenti richiesti', 'allegati', 'requisiti', 'certificat'],
    procKeywords: ['modalità di iscrizione', 'procedura', 'come iscriversi', 'registrazione', 'accreditamento'],
  },
  'TuttoGare': {
    docKeywords: ['documentazione', 'documenti', 'allegati', 'requisiti'],
    procKeywords: ['iscrizione', 'registrazione', 'procedura', 'accreditamento'],
  },
  'Net4market': {
    docKeywords: ['documentazione', 'documenti', 'requisiti'],
    procKeywords: ['iscrizione', 'registrazione', 'modalità'],
  },
  'Maggioli': {
    docKeywords: ['documentazione', 'documenti', 'requisiti', 'allegati'],
    procKeywords: ['iscrizione', 'registrazione', 'procedura'],
  },
  'PortaleAppalti': {
    docKeywords: ['documentazione', 'documenti', 'requisiti'],
    procKeywords: ['iscrizione', 'registrazione', 'procedura'],
  },
  'NetworkPA': {
    docKeywords: ['documentazione', 'documenti', 'requisiti'],
    procKeywords: ['iscrizione', 'registrazione', 'procedura'],
  },
};

// Generic keywords for any platform
const GENERIC_DOC_KEYWORDS = [
  'documento', 'documenti richiesti', 'documentazione necessaria', 'allegati',
  'requisiti', 'certificazione', 'dichiarazione', 'DURC', 'DUVRI', 'SOA',
  'casellario giudiziario', 'visura camerale', 'iscrizione CCIAA',
  'certificato antimafia', 'regolarità contributiva', 'bilancio',
  'polizza assicurativa', 'fatturato', 'referenze', 'capacità tecnica',
  'capacità economica', 'garanzia provvisoria',
];

const GENERIC_PROC_KEYWORDS = [
  'modalità di iscrizione', 'come iscriversi', 'procedura di iscrizione',
  'registrazione', 'accreditamento', 'domanda di iscrizione',
  'compilare il modulo', 'presentare domanda', 'inviare richiesta',
  'piattaforma telematica', 'portale', 'PEC', 'firma digitale',
  'SPID', 'CNS', 'CIE', 'identità digitale',
];

function fetchUrl(url, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const req = proto.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
      },
      timeout: timeout,
    }, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let redirectUrl = res.headers.location;
        if (redirectUrl.startsWith('/')) {
          const u = new URL(url);
          redirectUrl = u.origin + redirectUrl;
        }
        fetchUrl(redirectUrl, timeout).then(resolve).catch(reject);
        return;
      }

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function extractTextFromHtml(html) {
  // Remove scripts, styles, comments
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text;
}

function findDocuments(text, html) {
  const docs = new Set();
  const textLower = text.toLowerCase();

  // Check for specific document types
  const docPatterns = [
    { pattern: /durc/i, doc: 'DURC (Documento Unico di Regolarità Contributiva)' },
    { pattern: /visura camerale/i, doc: 'Visura camerale CCIAA' },
    { pattern: /casellario giudizi/i, doc: 'Certificato casellario giudiziario' },
    { pattern: /antimafia/i, doc: 'Certificato antimafia' },
    { pattern: /iscrizione.*cciaa|camera.*commercio/i, doc: 'Iscrizione CCIAA' },
    { pattern: /soa/i, doc: 'Attestazione SOA' },
    { pattern: /firma digitale/i, doc: 'Firma digitale' },
    { pattern: /pec/i, doc: 'PEC (Posta Elettronica Certificata)' },
    { pattern: /bilancio|bilanci/i, doc: 'Bilancio/i' },
    { pattern: /polizza assicurativ/i, doc: 'Polizza assicurativa' },
    { pattern: /dichiarazione sostitutiva/i, doc: 'Dichiarazione sostitutiva' },
    { pattern: /certificat.*regolarit.*contributiv/i, doc: 'Certificato regolarità contributiva' },
    { pattern: /fatturato/i, doc: 'Documentazione fatturato' },
    { pattern: /spid/i, doc: 'SPID' },
    { pattern: /cns|carta nazionale.*servizi/i, doc: 'CNS (Carta Nazionale dei Servizi)' },
    { pattern: /cie|carta.*identit.*elettronica/i, doc: 'CIE (Carta Identità Elettronica)' },
  ];

  for (const { pattern, doc } of docPatterns) {
    if (pattern.test(text)) {
      docs.add(doc);
    }
  }

  return [...docs];
}

function findProcedure(text) {
  const textLower = text.toLowerCase();
  const procedures = [];

  // Check for registration method
  if (/piattaforma telematica|portale telematico|sistema telematico/i.test(text)) {
    procedures.push('Iscrizione tramite piattaforma telematica');
  }
  if (/spid.*accesso|accesso.*spid/i.test(text)) {
    procedures.push('Accesso con SPID');
  }
  if (/cns.*accesso|accesso.*cns/i.test(text)) {
    procedures.push('Accesso con CNS');
  }
  if (/cie.*accesso|accesso.*cie/i.test(text)) {
    procedures.push('Accesso con CIE');
  }
  if (/pec.*invi|invi.*pec|trasmett.*pec/i.test(text)) {
    procedures.push('Invio documentazione via PEC');
  }
  if (/categori.*merceologic|categori.*soa/i.test(text)) {
    procedures.push('Selezione categorie merceologiche');
  }
  if (/domanda.*iscrizione|modulo.*iscrizione|istanza.*iscrizione/i.test(text)) {
    procedures.push('Compilazione domanda di iscrizione');
  }
  if (/firma digitale.*obbligator|necessari.*firma digitale/i.test(text)) {
    procedures.push('Firma digitale obbligatoria');
  }
  if (/rinnov.*annual|validit.*annual|aggiornamento.*annual/i.test(text)) {
    procedures.push('Rinnovo/aggiornamento annuale');
  }
  if (/iscrizione.*gratuit/i.test(text)) {
    procedures.push('Iscrizione gratuita');
  }
  if (/elenco.*aperto|sempre.*aperto|iscrizione.*aperta/i.test(text)) {
    procedures.push('Elenco aperto (iscrizione sempre possibile)');
  }

  return procedures.join('; ');
}

async function extractAlboDetails(entry) {
  if (!entry.ha_albo || !entry.url_albo) {
    return entry;
  }

  try {
    const html = await fetchUrl(entry.url_albo);
    const text = extractTextFromHtml(html);

    // Limit text to first 5000 chars for analysis
    const analysisText = text.substring(0, 5000);

    entry.documenti_richiesti = findDocuments(analysisText, html);
    entry.procedura_iscrizione = findProcedure(analysisText);

    if (entry.documenti_richiesti.length === 0) {
      entry.note = (entry.note || '') + ' | Documenti non estratti dalla pagina';
    }
    if (!entry.procedura_iscrizione) {
      entry.note = (entry.note || '') + ' | Procedura non estratta dalla pagina';
    }
  } catch (err) {
    entry.note = (entry.note || '') + ` | Errore fetch dettagli: ${err.message}`;
  }

  return entry;
}

async function main() {
  // Read search results from stdin
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  const rawResults = JSON.parse(input);

  // Normalize short keys (from window.S) to long keys
  const searchResults = rawResults.map(r => ({
    id: r.id,
    nome: r.nome || r.n,
    citta: r.citta || r.c,
    ha_albo: r.ha_albo !== undefined ? r.ha_albo : r.a,
    url_albo: r.url_albo || r.u,
    piattaforma: r.piattaforma || r.p,
    sito_web: r.sito_web || r.sw,
    documenti_richiesti: r.documenti_richiesti,
    procedura_iscrizione: r.procedura_iscrizione,
    note: r.note || (r.x && r.x !== '-' && !r.x.startsWith('CAPTCHA') && !r.x.startsWith('ERR') ? '' : (r.x === 'CAPTCHA' ? 'CAPTCHA hit' : '')),
  }));

  // Load existing results
  let results;
  try {
    results = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
  } catch {
    results = { scanned: {} };
  }

  let newAlbi = 0;
  let newScanned = 0;
  let detailsExtracted = 0;

  for (const entry of searchResults) {
    // Skip already scanned
    if (results.scanned[entry.id]) continue;

    // If has albo, try to extract details
    if (entry.ha_albo && entry.url_albo) {
      try {
        await extractAlboDetails(entry);
        detailsExtracted++;
      } catch (e) {
        entry.note = (entry.note || '') + ` | Detail extraction failed: ${e.message}`;
      }
    }

    // Save to results
    results.scanned[entry.id] = {
      id: entry.id,
      ragione_sociale: entry.nome || entry.ragione_sociale,
      citta: entry.citta || '',
      ha_albo: entry.ha_albo || false,
      url_albo: entry.url_albo || null,
      piattaforma: entry.piattaforma || null,
      documenti_richiesti: entry.documenti_richiesti || [],
      procedura_iscrizione: entry.procedura_iscrizione || '',
      sito_web_trovato: entry.sito_web || null,
      note: entry.note || '',
    };

    newScanned++;
    if (entry.ha_albo) newAlbi++;
  }

  // Update counts
  const allEntries = Object.values(results.scanned);
  results.total_scanned = allEntries.length;
  results.con_albo = allEntries.filter(e => e.ha_albo).length;
  results.senza_albo = allEntries.filter(e => !e.ha_albo).length;
  results.da_verificare = allEntries.filter(e => e.note && e.note.includes('verificare')).length;

  // Save
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));

  console.log(JSON.stringify({
    new_scanned: newScanned,
    new_albi: newAlbi,
    details_extracted: detailsExtracted,
    total_scanned: results.total_scanned,
    total_con_albo: results.con_albo,
    remaining: 16729 - results.total_scanned,
  }));
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
