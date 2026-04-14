/**
 * EasyWin RSS Feed Routes
 *
 * Public RSS feeds (no authentication required) for:
 * - /rss/bandi — Last 50 public bandi di gara
 * - /rss/esiti — Last 50 public esiti di gara
 *
 * Standard RSS 2.0 format with atom:link
 */

import { query } from '../db/pool.js';

const SITE_URL = process.env.FRONTEND_URL || 'https://easywin.it';

/**
 * Escape XML special characters
 */
function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Format date to RFC 822 (required for RSS)
 */
function toRfc822(date) {
  if (!date) return new Date().toUTCString();
  const d = new Date(date);
  return d.toUTCString();
}

/**
 * Format importo as currency
 */
function formatImporto(val) {
  if (!val) return '-';
  const num = parseFloat(val);
  if (isNaN(num)) return '-';
  return num.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
}

/**
 * Build RSS description for bando
 */
function buildBandoDescription(bando) {
  const stazione = escapeXml(bando.stazione_nome || 'N/D');
  const cig = escapeXml(bando.codice_cig || 'N/D');
  const importo = formatImporto(bando.importo_so || bando.importo_co);
  const soa = escapeXml(bando.soa_codice || 'N/D');
  const scadenza = bando.data_offerta
    ? new Date(bando.data_offerta).toLocaleDateString('it-IT')
    : 'N/D';

  return `
    <![CDATA[
      <p><strong>Stazione:</strong> ${stazione}</p>
      <p><strong>CIG:</strong> ${cig}</p>
      <p><strong>Importo:</strong> ${importo}</p>
      <p><strong>SOA:</strong> ${soa}</p>
      <p><strong>Scadenza offerta:</strong> ${scadenza}</p>
      <p><a href="${SITE_URL}/bandi/${bando.id}">Visualizza completo</a></p>
    ]]>
  `;
}

/**
 * Build RSS description for esito
 */
function buildEsitoDescription(esito) {
  const stazione = escapeXml(esito.stazione_nome || 'N/D');
  const cig = escapeXml(esito.codice_cig || 'N/D');
  const importo = formatImporto(esito.importo);
  const vincitore = escapeXml(esito.vincitrice_nome || 'N/D');
  const ribasso = esito.ribasso ? Number(esito.ribasso).toFixed(3) + '%' : 'N/D';

  return `
    <![CDATA[
      <p><strong>Stazione:</strong> ${stazione}</p>
      <p><strong>CIG:</strong> ${cig}</p>
      <p><strong>Importo:</strong> ${importo}</p>
      <p><strong>Vincitore:</strong> ${vincitore}</p>
      <p><strong>Ribasso:</strong> ${ribasso}</p>
      <p><a href="${SITE_URL}/esiti/${esito.id}">Visualizza completo</a></p>
    ]]>
  `;
}

export default async function rssRoutes(fastify, opts) {

  /**
   * GET /rss/bandi
   * RSS feed for last 50 public bandi
   */
  fastify.get('/bandi', async (request, reply) => {
    try {
      const bandRes = await query(`
        SELECT b.id, b.titolo, b.codice_cig, b.importo_so, b.importo_co,
               b.data_pubblicazione, b.data_offerta, b.stazione_nome,
               s.codice as soa_codice, b.created_at
        FROM bandi b
        LEFT JOIN soa s ON b.id_soa = s.id
        WHERE COALESCE(b.privato, 0) = 0
          AND COALESCE(b.annullato, false) = false
        ORDER BY b.created_at DESC
        LIMIT 50
      `);

      const bandi = bandRes.rows;
      const lastBuildDate = bandi.length > 0
        ? toRfc822(bandi[0].created_at)
        : toRfc822(new Date());

      let rssItems = '';
      for (const bando of bandi) {
        const title = escapeXml(bando.titolo || `Bando ${bando.id}`);
        const link = `${SITE_URL}/bandi/${bando.id}`;
        const pubDate = toRfc822(bando.data_pubblicazione || bando.created_at);
        const guid = `${SITE_URL}/bandi/${bando.id}`;
        const description = buildBandoDescription(bando);

        rssItems += `
    <item>
      <title>${title}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${guid}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${description}</description>
      <category>Bandi di Gara</category>
    </item>`;
      }

      const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>EasyWin - Bandi di Gara</title>
    <link>${SITE_URL}</link>
    <description>Ultimi bandi di gara pubblicati su EasyWin</description>
    <language>it-it</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <atom:link href="${SITE_URL}/rss/bandi" rel="self" type="application/rss+xml" />
${rssItems}
  </channel>
</rss>`;

      reply.type('application/rss+xml; charset=utf-8');
      return rss;
    } catch (err) {
      fastify.log.error({ err: err.message }, 'Error generating bandi RSS');
      reply.status(500).send({ error: 'Errore nella generazione del feed RSS' });
    }
  });

  /**
   * GET /rss/esiti
   * RSS feed for last 50 public esiti
   */
  fastify.get('/esiti', async (request, reply) => {
    try {
      const esitiRes = await query(`
        SELECT g.id, g.titolo, g.codice_cig, g.importo,
               g.stazione AS stazione_nome,
               a.ragione_sociale AS vincitrice_nome,
               g.ribasso,
               g.created_at
        FROM gare g
        LEFT JOIN aziende a ON g.id_vincitore = a.id
        WHERE g.enabled = true
        ORDER BY g.created_at DESC
        LIMIT 50
      `);

      const esiti = esitiRes.rows;
      const lastBuildDate = esiti.length > 0
        ? toRfc822(esiti[0].created_at)
        : toRfc822(new Date());

      let rssItems = '';
      for (const esito of esiti) {
        const title = escapeXml(esito.titolo || `Esito ${esito.id}`);
        const link = `${SITE_URL}/esiti/${esito.id}`;
        const pubDate = toRfc822(esito.created_at);
        const guid = `${SITE_URL}/esiti/${esito.id}`;
        const description = buildEsitoDescription(esito);

        rssItems += `
    <item>
      <title>${title}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${guid}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${description}</description>
      <category>Esiti di Gara</category>
    </item>`;
      }

      const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>EasyWin - Esiti di Gara</title>
    <link>${SITE_URL}</link>
    <description>Ultimi esiti di gara pubblicati su EasyWin</description>
    <language>it-it</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <atom:link href="${SITE_URL}/rss/esiti" rel="self" type="application/rss+xml" />
${rssItems}
  </channel>
</rss>`;

      reply.type('application/rss+xml; charset=utf-8');
      return rss;
    } catch (err) {
      fastify.log.error({ err: err.message }, 'Error generating esiti RSS');
      reply.status(500).send({ error: 'Errore nella generazione del feed RSS' });
    }
  });
}
