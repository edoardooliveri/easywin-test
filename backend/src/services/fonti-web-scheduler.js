/**
 * Fonti Web Scheduler — Real HTML Scraper
 *
 * Sincronizza periodicamente le fonti web attive:
 * 1. Fetch HTML della pagina
 * 2. Parse con cheerio + regex configurate per la fonte
 * 3. Filtra per testi_chiave (se presenti)
 * 4. INSERT/UPDATE bandi nel DB (dedup per CIG o titolo+stazione)
 * 5. Registra differenze e sync_check
 *
 * Concorrenza: batch di 5 fonti in parallelo.
 */

import { query } from '../db/pool.js';
import crypto from 'crypto';
import * as cheerio from 'cheerio';

let _schedulerInterval = null;
const CONCURRENCY = 5;

// ── Public API ──────────────────────────────────────────────

export function startFontiWebScheduler(fastify) {
  if (process.env.FONTI_WEB_AUTO !== 'true') {
    console.log('🌐 Fonti Web scheduler disabilitato (set FONTI_WEB_AUTO=true per attivare)');
    return;
  }

  const CHECK_INTERVAL = 10 * 60 * 1000; // 10 minuti

  console.log('🌐 Fonti Web scheduler avviato — controllo ogni 10 minuti');

  ensureTables().catch(err => {
    console.error('🌐 Fonti Web: impossibile creare tabelle ausiliarie:', err.message);
  });

  _schedulerInterval = setInterval(async () => {
    try {
      await syncFontiWeb();
    } catch (err) {
      console.error('🌐 Fonti Web sync error:', err.message);
    }
  }, CHECK_INTERVAL);

  return _schedulerInterval;
}

export function stopFontiWebScheduler() {
  if (_schedulerInterval) {
    clearInterval(_schedulerInterval);
    _schedulerInterval = null;
    console.log('🌐 Fonti Web scheduler fermato');
  }
}

/**
 * Esegue la sincronizzazione di tutte le fonti attive scadute.
 * Chiamabile anche manualmente (dal POST /:id/controlla).
 */
export async function syncFontiWeb() {
  let fontiResult;
  try {
    fontiResult = await query(`
      SELECT fw.id, fw.nome, fw.url, fw.intervallo_minuti,
             fw.ultimo_controllo, fw.ultimo_errore,
             fw.regex_titolo, fw.regex_data, fw.regex_importo, fw.regex_cig
      FROM fonti_web fw
      WHERE fw.attiva = true
        AND (
          fw.ultimo_controllo IS NULL
          OR fw.ultimo_controllo + (COALESCE(fw.intervallo_minuti, 360) || ' minutes')::INTERVAL <= NOW()
        )
      ORDER BY fw.ultimo_controllo ASC NULLS FIRST
      LIMIT 50
    `);
  } catch (err) {
    console.error('🌐 Fonti Web: query fonti_web fallita:', err.message);
    return { synced: 0, errors: 0 };
  }

  if (fontiResult.rows.length === 0) return { synced: 0, errors: 0 };

  console.log(`🌐 Fonti Web: ${fontiResult.rows.length} fonti da sincronizzare`);

  const results = await runBatchSync(fontiResult.rows, CONCURRENCY);

  const synced = results.filter(r => r.status === 'ok').length;
  const errors = results.filter(r => r.status === 'error').length;

  // Update task status
  try {
    await query(
      `UPDATE tasks SET data_ultima_esecuzione = NOW(), stato_ultima_esecuzione = $1,
       messaggio_ultima_esecuzione = $2
       WHERE tipo = 'fonti_web_sync' AND attivo = true`,
      [
        errors === 0 ? 'successo' : 'parziale',
        `Sincronizzate: ${synced}, errori: ${errors}`
      ]
    );
  } catch (e) { /* tasks table may not exist */ }

  // Cleanup old sync_log (> 30 days)
  try {
    await query(`DELETE FROM fonti_web_sync_log WHERE timestamp < NOW() - INTERVAL '30 days'`);
  } catch (e) { /* ignore */ }

  console.log(`🌐 Fonti Web sync completata: ${synced} ok, ${errors} errori`);
  return { synced, errors, details: results };
}

/**
 * Sincronizza una singola fonte — esportata per uso da POST /:id/controlla
 */
export async function syncSingleFonte(fonte) {
  const startTime = Date.now();
  let responseCode = null;
  let contentHash = null;
  let errorMessage = null;
  let status = 'ok';
  let nuoviBandi = 0;
  let aggiornati = 0;

  try {
    // 1. Fetch testi_chiave per questa fonte
    const testiResult = await query(
      `SELECT testo FROM fonti_web_testi_chiave WHERE id_fonte = $1`,
      [fonte.id]
    );
    const testiChiave = testiResult.rows.map(r => r.testo.toLowerCase());

    // 2. Fetch HTML
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(fonte.url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; EasyWin-Bot/2.0)',
        'Accept': 'text/html, application/xhtml+xml, */*',
        'Accept-Language': 'it-IT,it;q=0.9,en;q=0.5'
      }
    });

    clearTimeout(timeout);
    responseCode = response.status;

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    contentHash = crypto.createHash('sha256').update(html).digest('hex');

    // 3. Parse HTML con cheerio e regex
    const bandiEstratti = fetchAndParseFonte(html, fonte, testiChiave);

    // 4. INSERT/UPDATE bandi nel DB
    const result = await upsertBandi(bandiEstratti, fonte);
    nuoviBandi = result.nuovi;
    aggiornati = result.aggiornati;

    // 5. Registra differenze
    for (const bando of result.differenze) {
      try {
        await query(
          `INSERT INTO fonti_web_differenze (id_fonte, titolo, url, tipo_differenza, dati_estratti, id_bando)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [fonte.id, bando.titolo, bando.url || null, bando.tipo, JSON.stringify(bando.dati), bando.id_bando || null]
        );
      } catch (e) { /* ignore single diff insert failure */ }
    }

    // 6. Update fonte record
    await query(
      `UPDATE fonti_web SET ultimo_controllo = NOW(), ultimo_errore = NULL WHERE id = $1`,
      [fonte.id]
    );

  } catch (err) {
    status = 'error';
    errorMessage = err.message;

    await query(
      `UPDATE fonti_web SET ultimo_controllo = NOW(), ultimo_errore = $1 WHERE id = $2`,
      [err.message, fonte.id]
    ).catch(() => {});
  }

  const durationMs = Date.now() - startTime;

  // Log to sync_check
  try {
    await query(
      `INSERT INTO fonti_web_sync_check (id_fonte, timestamp, nuovi_bandi, aggiornati, errore)
       VALUES ($1, NOW(), $2, $3, $4)`,
      [fonte.id, nuoviBandi, aggiornati, errorMessage]
    );
  } catch (e) { /* ignore */ }

  // Log to sync_log (detailed)
  try {
    await query(
      `INSERT INTO fonti_web_sync_log (id_fonte, status, content_hash, content_changed, response_code, error_message, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [fonte.id, status, contentHash, nuoviBandi + aggiornati > 0, responseCode, errorMessage, durationMs]
    );
  } catch (e) { /* ignore */ }

  return { fonteId: fonte.id, nome: fonte.nome, status, nuoviBandi, aggiornati, errorMessage, durationMs };
}

// ── HTML Parsing ────────────────────────────────────────────

/**
 * Estrae bandi dal HTML usando cheerio + regex configurate.
 * @returns {Array<{titolo, data, importo, cig, url, html_snippet}>}
 */
export function fetchAndParseFonte(html, fonte, testiChiave = []) {
  const $ = cheerio.load(html);

  // Remove scripts, styles, nav, footer
  $('script, style, nav, footer, header, .cookie-banner, .breadcrumb').remove();

  // Strategy 1: Try regex-based extraction if regex patterns configured
  if (fonte.regex_titolo) {
    const regexResults = extractWithRegex(html, fonte);
    if (regexResults.length > 0) {
      return filterByTestiChiave(regexResults, testiChiave);
    }
  }

  // Strategy 2: Table-based extraction (common on PA sites)
  const tableResults = extractFromTables($, fonte);
  if (tableResults.length > 0) {
    return filterByTestiChiave(tableResults, testiChiave);
  }

  // Strategy 3: Link-based extraction (look for links with keywords)
  const linkResults = extractFromLinks($, fonte);
  return filterByTestiChiave(linkResults, testiChiave);
}

/**
 * Estrai bandi usando regex configurate sulla fonte
 */
function extractWithRegex(html, fonte) {
  const results = [];

  // Clean HTML to plain text for regex matching
  const $ = cheerio.load(html);
  const text = $.text();

  try {
    const reTitle = new RegExp(fonte.regex_titolo, 'gi');
    const titles = [];
    let match;

    while ((match = reTitle.exec(text)) !== null) {
      titles.push({
        titolo: (match[1] || match[0]).trim(),
        index: match.index
      });
      if (titles.length >= 200) break; // safety limit
    }

    // For each title, try to extract nearby data, importo, cig
    for (const t of titles) {
      // Use text AFTER the title for metadata (avoid bleeding from previous entries)
      const contextWindow = text.substring(
        t.index,
        Math.min(text.length, t.index + t.titolo.length + 500)
      );

      const bando = {
        titolo: t.titolo,
        data: null,
        importo: null,
        cig: null,
        url: null
      };

      // Extract date
      if (fonte.regex_data) {
        try {
          const reDate = new RegExp(fonte.regex_data, 'i');
          const dateMatch = contextWindow.match(reDate);
          if (dateMatch) bando.data = normalizeDate(dateMatch[1] || dateMatch[0]);
        } catch (e) { /* invalid regex */ }
      }

      // Extract importo
      if (fonte.regex_importo) {
        try {
          const reImporto = new RegExp(fonte.regex_importo, 'i');
          const impMatch = contextWindow.match(reImporto);
          if (impMatch) bando.importo = normalizeImporto(impMatch[1] || impMatch[0]);
        } catch (e) { /* invalid regex */ }
      }

      // Extract CIG
      if (fonte.regex_cig) {
        try {
          const reCig = new RegExp(fonte.regex_cig, 'i');
          const cigMatch = contextWindow.match(reCig);
          if (cigMatch) bando.cig = (cigMatch[1] || cigMatch[0]).trim();
        } catch (e) { /* invalid regex */ }
      }

      // Fallback CIG: standard pattern (10 alphanumeric chars)
      if (!bando.cig) {
        const cigFallback = contextWindow.match(/\b([A-Z0-9]{10})\b/);
        if (cigFallback) {
          const candidate = cigFallback[1];
          // CIG starts with a digit usually
          if (/^\d/.test(candidate)) bando.cig = candidate;
        }
      }

      results.push(bando);
    }
  } catch (err) {
    console.error(`🌐 Regex extraction failed for fonte ${fonte.id}:`, err.message);
  }

  return results;
}

/**
 * Estrai bandi da tabelle HTML (tipico dei siti PA)
 */
function extractFromTables($, fonte) {
  const results = [];
  const bandiKeywords = /bando|gara|appalto|procedura|avviso|determina|affidamento|lavori|servizi|forniture/i;

  $('table').each((_, table) => {
    const $table = $(table);
    const headers = [];

    // Read header row
    $table.find('thead tr th, thead tr td, tr:first-child th, tr:first-child td').each((i, cell) => {
      headers.push($(cell).text().trim().toLowerCase());
    });

    // Need at least a "titolo/oggetto" column to proceed
    const titleIdx = headers.findIndex(h => /titolo|oggetto|descrizione|denominazione/i.test(h));
    if (titleIdx === -1) return; // skip this table

    const dateIdx = headers.findIndex(h => /data.*pubbl|data.*scad|data|termine/i.test(h));
    const importoIdx = headers.findIndex(h => /importo|valore|base.*asta/i.test(h));
    const cigIdx = headers.findIndex(h => /cig|codice/i.test(h));
    const linkIdx = headers.findIndex(h => /link|dettaglio|url/i.test(h));

    // Parse data rows
    $table.find('tbody tr, tr').each((rowIdx, row) => {
      if (rowIdx === 0 && headers.length > 0) return; // skip header row

      const cells = [];
      $(row).find('td').each((_, cell) => {
        cells.push($(cell).text().trim());
      });

      if (cells.length <= titleIdx) return;

      const titolo = cells[titleIdx];
      if (!titolo || titolo.length < 5) return;
      if (!bandiKeywords.test(titolo) && !bandiKeywords.test(headers.join(' '))) return;

      const bando = {
        titolo,
        data: dateIdx >= 0 && cells[dateIdx] ? normalizeDate(cells[dateIdx]) : null,
        importo: importoIdx >= 0 && cells[importoIdx] ? normalizeImporto(cells[importoIdx]) : null,
        cig: cigIdx >= 0 && cells[cigIdx] ? cells[cigIdx].trim() : null,
        url: null
      };

      // Try to extract link from row
      const $link = $(row).find('a[href]').first();
      if ($link.length) {
        bando.url = resolveUrl($link.attr('href'), fonte.url);
      }

      results.push(bando);
    });
  });

  return results;
}

/**
 * Estrai bandi da link nella pagina
 */
function extractFromLinks($, fonte) {
  const results = [];
  const bandiKeywords = /bando|gara|appalto|procedura|avviso|determina|affidamento|lavori|servizi|forniture/i;

  $('a[href]').each((_, el) => {
    const $el = $(el);
    const text = $el.text().trim();
    const href = $el.attr('href') || '';

    if (text.length < 10 || text.length > 500) return;
    if (!bandiKeywords.test(text)) return;

    // Skip nav/menu links
    if ($el.closest('nav, .menu, .sidebar, header, footer').length) return;

    const bando = {
      titolo: text,
      data: null,
      importo: null,
      cig: null,
      url: resolveUrl(href, fonte.url)
    };

    // Use the link text + immediate context for metadata extraction
    const context = text + ' ' + ($el.next().text() || '');

    // Try extracting CIG from link text
    const cigMatch = context.match(/CIG[:\s]*([A-Z0-9]{10})/i);
    if (cigMatch) bando.cig = cigMatch[1];

    // Try extracting date from link text
    const dateMatch = context.match(/(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/);
    if (dateMatch) bando.data = normalizeDate(dateMatch[1]);

    // Try extracting importo from link text
    const impMatch = context.match(/€\s*([\d.,]+)|importo[:\s]*([\d.,]+)/i);
    if (impMatch) bando.importo = normalizeImporto(impMatch[1] || impMatch[2]);

    results.push(bando);
  });

  return results;
}

// ── Filtering ───────────────────────────────────────────────

/**
 * Filtra bandi per testi_chiave. Se nessun testo configurato, passa tutto.
 */
function filterByTestiChiave(bandi, testiChiave) {
  if (!testiChiave || testiChiave.length === 0) return bandi;

  return bandi.filter(b => {
    const haystack = (b.titolo || '').toLowerCase();
    return testiChiave.some(tc => haystack.includes(tc));
  });
}

// ── DB Upsert ───────────────────────────────────────────────

/**
 * Inserisce o aggiorna bandi estratti nel DB.
 * Dedup by CIG (se presente) o titolo + fonte.
 */
async function upsertBandi(bandiEstratti, fonte) {
  let nuovi = 0;
  let aggiornatiCount = 0;
  const differenze = [];

  for (const bando of bandiEstratti) {
    try {
      if (!bando.titolo || bando.titolo.length < 5) continue;

      let existing = null;

      // Try dedup by CIG first (most reliable)
      if (bando.cig && bando.cig.length >= 10) {
        const cigResult = await query(
          `SELECT id, titolo, data_pubblicazione, importo_so FROM bandi WHERE codice_cig = $1 LIMIT 1`,
          [bando.cig]
        );
        if (cigResult.rows.length > 0) existing = cigResult.rows[0];
      }

      // Fallback: dedup by titolo + fonte
      if (!existing) {
        const titleResult = await query(
          `SELECT id, titolo, data_pubblicazione, importo_so FROM bandi
           WHERE id_fonte_web = $1 AND titolo = $2 LIMIT 1`,
          [fonte.id, bando.titolo]
        );
        if (titleResult.rows.length > 0) existing = titleResult.rows[0];
      }

      if (existing) {
        // Check if anything changed worth updating
        const needsUpdate =
          (bando.importo && !existing.importo_so) ||
          (bando.data && !existing.data_pubblicazione);

        if (needsUpdate) {
          const updates = [];
          const values = [];
          let idx = 1;

          if (bando.importo && !existing.importo_so) {
            updates.push(`importo_so = $${idx}`);
            values.push(bando.importo);
            idx++;
          }
          if (bando.data && !existing.data_pubblicazione) {
            updates.push(`data_pubblicazione = $${idx}`);
            values.push(bando.data);
            idx++;
          }
          updates.push(`data_modifica = NOW()`);

          values.push(existing.id);
          await query(
            `UPDATE bandi SET ${updates.join(', ')} WHERE id = $${idx}`,
            values
          );

          aggiornatiCount++;
          differenze.push({
            titolo: bando.titolo,
            url: bando.url,
            tipo: 'aggiornato',
            dati: bando,
            id_bando: existing.id
          });
        }
      } else {
        // INSERT new bando
        const dataPub = bando.data || new Date().toISOString().slice(0, 10);

        const insertResult = await query(
          `INSERT INTO bandi (
            titolo, data_pubblicazione, codice_cig, importo_so,
            id_fonte_web, fonte_dati, provenienza,
            inserito_da, data_inserimento, privato
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9)
          RETURNING id`,
          [
            bando.titolo,
            dataPub,
            bando.cig || null,
            bando.importo || null,
            fonte.id,
            fonte.nome,
            'FonteWeb',
            'fonti-web-scheduler',
            0 // pubblico
          ]
        );

        nuovi++;
        differenze.push({
          titolo: bando.titolo,
          url: bando.url,
          tipo: 'nuovo',
          dati: bando,
          id_bando: insertResult.rows[0]?.id || null
        });
      }
    } catch (err) {
      console.error(`🌐 Upsert bando "${bando.titolo?.substring(0, 50)}" fallito:`, err.message);
    }
  }

  return { nuovi, aggiornati: aggiornatiCount, differenze };
}

// ── Batch Runner ────────────────────────────────────────────

/**
 * Esegue syncSingleFonte su un array di fonti con concorrenza limitata.
 */
async function runBatchSync(fonti, concurrency = CONCURRENCY) {
  const results = [];
  const queue = [...fonti];

  async function worker() {
    while (queue.length > 0) {
      const fonte = queue.shift();
      if (!fonte) break;
      try {
        const result = await syncSingleFonte(fonte);
        results.push(result);
      } catch (err) {
        results.push({
          fonteId: fonte.id,
          nome: fonte.nome,
          status: 'error',
          nuoviBandi: 0,
          aggiornati: 0,
          errorMessage: err.message,
          durationMs: 0
        });
      }
    }
  }

  // Launch N workers
  const workers = Array.from({ length: Math.min(concurrency, fonti.length) }, () => worker());
  await Promise.all(workers);

  return results;
}

// ── Helpers ─────────────────────────────────────────────────

function normalizeDate(raw) {
  if (!raw) return null;
  const cleaned = raw.trim();

  // dd/mm/yyyy or dd-mm-yyyy or dd.mm.yyyy
  const dmy = cleaned.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
  if (dmy) {
    let year = parseInt(dmy[3]);
    if (year < 100) year += 2000;
    const month = dmy[2].padStart(2, '0');
    const day = dmy[1].padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // yyyy-mm-dd (ISO)
  const iso = cleaned.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // Italian month names
  const itMonths = {
    'gennaio': '01', 'febbraio': '02', 'marzo': '03', 'aprile': '04',
    'maggio': '05', 'giugno': '06', 'luglio': '07', 'agosto': '08',
    'settembre': '09', 'ottobre': '10', 'novembre': '11', 'dicembre': '12'
  };
  const itMatch = cleaned.match(/(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+(\d{4})/i);
  if (itMatch) {
    return `${itMatch[3]}-${itMonths[itMatch[2].toLowerCase()]}-${itMatch[1].padStart(2, '0')}`;
  }

  return null;
}

function normalizeImporto(raw) {
  if (!raw) return null;
  // Remove currency symbols, spaces, then handle Italian number format
  let cleaned = raw.replace(/[€\s]/g, '').trim();

  // Italian: 1.234.567,89 → 1234567.89
  if (cleaned.includes(',') && cleaned.includes('.')) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (cleaned.includes(',')) {
    cleaned = cleaned.replace(',', '.');
  }

  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function resolveUrl(href, baseUrl) {
  if (!href) return null;
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return href;
  }
}

// ── Table setup ─────────────────────────────────────────────

async function ensureTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS fonti_web_sync_log (
      id SERIAL PRIMARY KEY,
      id_fonte INTEGER REFERENCES fonti_web(id) ON DELETE CASCADE,
      timestamp TIMESTAMPTZ DEFAULT NOW(),
      status VARCHAR(20) DEFAULT 'ok',
      content_hash VARCHAR(64),
      content_changed BOOLEAN DEFAULT false,
      response_code INTEGER,
      error_message TEXT,
      duration_ms INTEGER
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_fwsl_fonte ON fonti_web_sync_log(id_fonte)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_fwsl_timestamp ON fonti_web_sync_log(timestamp)`);
}
