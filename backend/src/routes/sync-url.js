/**
 * Sync URL — porting del vecchio SyncUrlJob.
 *
 * Il vecchio job scaricava HTML dalle "fonti web", lo convertiva in testo
 * (via HtmlAgilityPack + HtmlToText.cs) e filtrava per ParoleChiave/FrasiChiave
 * per individuare bandi nuovi.
 *
 * Nel nuovo sito la sync periodica è già gestita da services/fonti-web-scheduler.js.
 * Questo route espone le API admin che il vecchio job non aveva:
 *   - POST /api/sync-url/run               → trigger sync di tutte le fonti
 *   - POST /api/sync-url/run/:id           → sync di una singola fonte
 *   - POST /api/sync-url/html-to-text      → utility: converte HTML ricevuto in testo
 *   - GET  /api/sync-url/fetch?url=...     → scarica un URL e restituisce HTML + testo
 *   - GET  /api/sync-url/status            → stato scheduler + ultima esecuzione
 *   - GET  /api/sync-url/log               → log ultime sync
 */

import { query } from '../db/pool.js';
import { syncFontiWeb } from '../services/fonti-web-scheduler.js';

/**
 * Conversione HTML→testo fedele al vecchio HtmlToText.cs:
 *   - rimuove <script> <style>
 *   - converte <br> <p> </tr> </li> </div> in newline
 *   - strip di tutti i tag rimanenti
 *   - decode entities base (&amp; &nbsp; &lt; &gt; &quot; &#39;)
 *   - collassa whitespace
 */
function htmlToText(html) {
  if (!html) return '';
  let t = String(html);
  t = t.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  t = t.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  t = t.replace(/<!--[\s\S]*?-->/g, ' ');
  t = t.replace(/<\s*br\s*\/?\s*>/gi, '\n');
  t = t.replace(/<\/(p|div|tr|li|h[1-6])\s*>/gi, '\n');
  t = t.replace(/<[^>]+>/g, ' ');
  t = t.replace(/&nbsp;/g, ' ')
       .replace(/&amp;/g, '&')
       .replace(/&lt;/g, '<')
       .replace(/&gt;/g, '>')
       .replace(/&quot;/g, '"')
       .replace(/&#39;/g, "'")
       .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
  t = t.replace(/[ \t]+/g, ' ');
  t = t.replace(/\n\s*\n/g, '\n').trim();
  return t;
}

/**
 * Matching parole/frasi chiave (logica vecchio job):
 *   - tutte le FrasiChiave devono essere presenti (AND)
 *   - almeno una ParolaChiave deve essere presente (OR) — se la lista non è vuota
 */
function matchesKeywords(text, { paroleChiave = [], frasiChiave = [] } = {}) {
  const low = (text || '').toLowerCase();
  if (frasiChiave && frasiChiave.length > 0) {
    for (const f of frasiChiave) {
      if (f && !low.includes(String(f).toLowerCase())) return false;
    }
  }
  if (paroleChiave && paroleChiave.length > 0) {
    const found = paroleChiave.some(p => p && low.includes(String(p).toLowerCase()));
    if (!found) return false;
  }
  return true;
}

export default async function syncUrlRoutes(fastify) {
  /** POST /api/sync-url/run — trigger sync completa */
  fastify.post('/run', { preHandler: [fastify.authenticate] }, async (_, reply) => {
    try {
      const res = await syncFontiWeb();
      return { success: true, ...res };
    } catch (err) {
      fastify.log.error(err, 'Sync URL run failed');
      return reply.status(500).send({ error: 'Errore sync', details: err.message });
    }
  });

  /** POST /api/sync-url/run/:id — sync forzata di una singola fonte (reset ultimo_controllo) */
  fastify.post('/run/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    try {
      const exists = await query('SELECT id FROM fonti_web WHERE id = $1', [id]);
      if (exists.rows.length === 0) return reply.status(404).send({ error: 'Fonte non trovata' });
      // Forza re-check: setta ultimo_controllo a NULL, poi fa la sync
      await query('UPDATE fonti_web SET ultimo_controllo = NULL WHERE id = $1', [id]);
      const res = await syncFontiWeb();
      return { success: true, forced_id: parseInt(id, 10), ...res };
    } catch (err) {
      fastify.log.error(err, 'Sync URL single error');
      return reply.status(500).send({ error: 'Errore sync singola', details: err.message });
    }
  });

  /** POST /api/sync-url/html-to-text — body { html, parole_chiave?, frasi_chiave? } */
  fastify.post('/html-to-text', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { html, parole_chiave, frasi_chiave } = request.body || {};
    if (!html) return reply.status(400).send({ error: 'html obbligatorio' });

    const text = htmlToText(html);
    const keywords = (parole_chiave || frasi_chiave)
      ? { paroleChiave: parole_chiave || [], frasiChiave: frasi_chiave || [] }
      : null;

    return {
      text,
      length: text.length,
      matches_keywords: keywords ? matchesKeywords(text, keywords) : null,
    };
  });

  /** GET /api/sync-url/fetch?url=... — scarica un URL e restituisce HTML + testo convertito */
  fastify.get('/fetch', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { url } = request.query;
    if (!url) return reply.status(400).send({ error: 'url obbligatorio' });

    try {
      const urlObj = new URL(url);
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        return reply.status(400).send({ error: 'Solo URL http(s) consentiti' });
      }
    } catch {
      return reply.status(400).send({ error: 'URL non valido' });
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'EasyWin-SyncUrl/1.0' },
      });
      clearTimeout(timeoutId);

      const html = await res.text();
      const text = htmlToText(html);
      return {
        url,
        status: res.status,
        content_type: res.headers.get('content-type'),
        html_length: html.length,
        text_length: text.length,
        text_preview: text.slice(0, 2000),
        text,
      };
    } catch (err) {
      if (err.name === 'AbortError') return reply.status(504).send({ error: 'Timeout (30s)' });
      return reply.status(500).send({ error: 'Errore fetch URL', details: err.message });
    }
  });

  /** GET /api/sync-url/status — stato scheduler */
  fastify.get('/status', { preHandler: [fastify.authenticate] }, async () => {
    let tasksRow = null;
    try {
      const r = await query(
        `SELECT tipo, attivo, data_ultima_esecuzione, stato_ultima_esecuzione,
                messaggio_ultima_esecuzione, prossima_esecuzione
           FROM tasks
          WHERE tipo = 'fonti_web_scheduler' OR tipo = 'sync_url'
          ORDER BY data_ultima_esecuzione DESC NULLS LAST LIMIT 1`
      );
      tasksRow = r.rows[0] || null;
    } catch { /* tasks può non esistere */ }

    let counts = { totali: 0, attive: 0, in_errore: 0 };
    try {
      const r = await query(
        `SELECT
           COUNT(*)::int AS totali,
           COUNT(*) FILTER (WHERE attiva = true)::int AS attive,
           COUNT(*) FILTER (WHERE ultimo_errore IS NOT NULL AND ultimo_errore <> '')::int AS in_errore
         FROM fonti_web`
      );
      counts = r.rows[0];
    } catch {}

    return {
      scheduler: tasksRow,
      fonti: counts,
      intervallo_minuti: 10,
    };
  });

  /** GET /api/sync-url/log?limit=50 — ultimo log sync per fonte */
  fastify.get('/log', { preHandler: [fastify.authenticate] }, async (request) => {
    const limit = Math.min(500, parseInt(request.query.limit || '50', 10));
    try {
      const r = await query(
        `SELECT id, nome, url, ultimo_controllo, ultimo_errore, attiva, intervallo_minuti
           FROM fonti_web
          ORDER BY ultimo_controllo DESC NULLS LAST
          LIMIT $1`,
        [limit]
      );
      return { total: r.rows.length, log: r.rows };
    } catch (err) {
      return { total: 0, log: [], note: err.message };
    }
  });
}
