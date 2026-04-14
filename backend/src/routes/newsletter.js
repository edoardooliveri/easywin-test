import { query } from '../db/pool.js';
import nodemailer from 'nodemailer';
import crypto from 'crypto';

// Configure email transporter
let mailTransporter;
async function getMailTransporter() {
  if (mailTransporter) return mailTransporter;

  // Try to use pool if available from environment
  if (process.env.SMTP_POOL) {
    try {
      mailTransporter = nodemailer.createTransport(JSON.parse(process.env.SMTP_POOL));
    } catch (err) {
      console.warn('Failed to parse SMTP_POOL, falling back to SMTP vars');
    }
  }

  // Fall back to individual SMTP environment variables
  if (!mailTransporter) {
    mailTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'localhost',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }

  return mailTransporter;
}

// Build email-safe HTML template
function buildNewsletterHtml(type, items, dateRange, noteAggiuntive = '') {
  const isEsiti = type === 'esiti';
  const headerTitle = isEsiti ? 'Newsletter Esiti' : 'Newsletter Bandi';

  // Group items by regione
  const itemsByRegione = {};
  items.forEach(item => {
    const regione = item.regione || 'Non specificata';
    if (!itemsByRegione[regione]) {
      itemsByRegione[regione] = [];
    }
    itemsByRegione[regione].push(item);
  });

  // Build items HTML
  const regioni = Object.keys(itemsByRegione).sort();
  let itemsHtml = '';

  regioni.forEach((regione, regioneIndex) => {
    // Add region header
    if (regioneIndex === 0) {
      itemsHtml += `
        <tr>
          <td style="padding: 12px 0; background-color: #004b87; color: white;">
            <strong style="font-size: 14px;">${regione}</strong>
          </td>
        </tr>`;
    } else {
      itemsHtml += `
        <tr>
          <td style="padding: 20px 0 12px 0; background-color: #004b87; color: white;">
            <strong style="font-size: 14px;">${regione}</strong>
          </td>
        </tr>`;
    }

    // Add items for this region
    itemsByRegione[regione].forEach(item => {
      if (isEsiti) {
        itemsHtml += `
          <tr style="border-bottom: 1px solid #ddd;">
            <td style="padding: 12px;">
              <strong style="color: #004b87; font-size: 13px;">${item.titolo || 'N/D'}</strong><br/>
              <span style="font-size: 11px; color: #666;">
                Stazione: ${item.stazione || 'N/D'}<br/>
                Provincia: ${item.provincia || 'N/D'}<br/>
                Data: ${item.data || 'N/D'} | Importo: €${parseFloat(item.importo || 0).toLocaleString('it-IT', { minimumFractionDigits: 2 })}<br/>
                CIG: ${item.cig || 'N/D'} | SOA: ${item.soa || 'N/D'}<br/>
                Vincitore: ${item.vincitore || 'N/D'} | Ribasso: ${item.ribasso || '0'}%
              </span>
            </td>
          </tr>`;
      } else {
        itemsHtml += `
          <tr style="border-bottom: 1px solid #ddd;">
            <td style="padding: 12px;">
              <strong style="color: #004b87; font-size: 13px;">${item.titolo || 'N/D'}</strong><br/>
              <span style="font-size: 11px; color: #666;">
                Stazione: ${item.stazione || 'N/D'}<br/>
                Provincia: ${item.provincia || 'N/D'}<br/>
                Data Pubblicazione: ${item.data || 'N/D'} | Importo: €${parseFloat(item.importo || 0).toLocaleString('it-IT', { minimumFractionDigits: 2 })}<br/>
                CIG: ${item.cig || 'N/D'} | SOA: ${item.soa || 'N/D'}
              </span>
            </td>
          </tr>`;
      }
    });
  });

  // Generate unsubscribe token
  const unsubscribeToken = crypto.randomBytes(32).toString('hex');

  return {
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style type="text/css">
            body {
              font-family: Arial, Helvetica, sans-serif;
              color: #333;
              line-height: 1.6;
              background-color: #f9f9f9;
            }
            .container {
              max-width: 600px;
              margin: 0 auto;
              background-color: white;
              border: 1px solid #ddd;
            }
            .header {
              background-color: #004b87;
              color: white;
              padding: 20px;
              text-align: center;
            }
            .header h1 {
              margin: 0;
              font-size: 24px;
            }
            .header p {
              margin: 8px 0 0 0;
              font-size: 12px;
            }
            .content {
              padding: 20px;
            }
            .content h2 {
              font-size: 14px;
              color: #004b87;
              margin: 20px 0 10px 0;
            }
            .content p {
              margin: 0 0 15px 0;
              font-size: 13px;
            }
            .date-range {
              background-color: #f0f0f0;
              padding: 10px;
              margin-bottom: 20px;
              font-size: 12px;
              border-left: 3px solid #004b87;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin: 10px 0;
            }
            table tr td {
              font-size: 12px;
            }
            .footer {
              background-color: #f5f5f5;
              padding: 15px;
              text-align: center;
              font-size: 11px;
              color: #666;
              border-top: 1px solid #ddd;
            }
            .footer a {
              color: #004b87;
              text-decoration: none;
            }
            .unsubscribe {
              margin-top: 10px;
              padding-top: 10px;
              border-top: 1px solid #ddd;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>${headerTitle}</h1>
              <p>EasyWin - Piattaforma e-procurement</p>
            </div>
            <div class="content">
              <div class="date-range">
                <strong>Periodo:</strong> ${dateRange.da} - ${dateRange.a}
              </div>

              ${noteAggiuntive ? `<p><strong>Note:</strong> ${noteAggiuntive}</p>` : ''}

              <h2>Dettagli ${isEsiti ? 'Esiti' : 'Bandi'}:</h2>
              <table>
                ${itemsHtml}
              </table>
            </div>

            <div class="footer">
              <p style="margin: 0 0 10px 0;">EasyWin Newsletter | &copy; 2026 EasyWin Srl</p>
              <p style="margin: 0;">Per informazioni e supporto, visita <a href="https://www.easywin.it">www.easywin.it</a></p>
              <div class="unsubscribe">
                <p style="margin: 0;">
                  <a href="https://www.easywin.it/newsletter/unsubscribe?token=${unsubscribeToken}">Disiscriviti dalla newsletter</a>
                </p>
              </div>
            </div>
          </div>
        </body>
      </html>
    `,
    unsubscribeToken
  };
}

export default async function newsletterRoutes(fastify, opts) {
  // Verify authentication for all routes
  fastify.addHook('preHandler', async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  // ==================== NEWSLETTER GENERATION ====================

  // POST /api/admin/newsletter/bandi/genera
  fastify.post('/bandi/genera', async (request, reply) => {
    try {
      const { data_da, data_a } = request.body;

      if (!data_da || !data_a) {
        return reply.status(400).send({ error: 'data_da and data_a are required' });
      }

      // Fetch all enabled bandi in date range
      const result = await query(
        `SELECT
          b.id,
          b."titolo" AS titolo,
          b."codice_cig" AS cig,
          b."importo_so" AS importo,
          b."data_pubblicazione" AS data,
          r."regione" AS regione,
          p."provincia" AS provincia,
          s."nome" AS stazione,
          soa."codice" AS soa
        FROM bandi b
        LEFT JOIN regioni r ON b."id_regione" = r.id
        LEFT JOIN stazioni s2 ON b.id_stazione = s2.id
        LEFT JOIN province p ON s2.id_provincia = p.id
        LEFT JOIN stazioni s ON b."id_stazione" = s.id
        LEFT JOIN soa ON b."id_soa" = soa.id
        WHERE b."data_pubblicazione" >= $1 AND b."data_pubblicazione" <= $2
        AND b.annullato IS NOT TRUE
        ORDER BY r."regione", p."provincia", b."titolo"`,
        [data_da, data_a]
      );

      const items = result.rows.map(row => ({
        id: row.id,
        titolo: row.titolo,
        cig: row.cig,
        importo: row.importo || 0,
        data: row.data ? new Date(row.data).toLocaleDateString('it-IT') : '',
        regione: row.regione,
        provincia: row.provincia,
        stazione: row.stazione,
        soa: row.soa
      }));

      const dateRange = {
        da: new Date(data_da).toLocaleDateString('it-IT'),
        a: new Date(data_a).toLocaleDateString('it-IT')
      };

      const { html, unsubscribeToken } = buildNewsletterHtml('bandi', items, dateRange);

      // Count unique recipients (users with newsletter enabled for bandi)
      const recipients = await query(
        `SELECT COUNT(DISTINCT u.id) AS count FROM users u
        WHERE u."newsletter_bandi" = true AND u."attivo" = true`
      );

      return {
        html,
        unsubscribeToken,
        destinatari_count: parseInt(recipients.rows[0].count),
        bandi_count: items.length
      };
    } catch (err) {
      fastify.log.error(err, 'Newsletter bandi genera error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/newsletter/esiti/genera
  fastify.post('/esiti/genera', async (request, reply) => {
    try {
      const { data_da, data_a } = request.body;

      if (!data_da || !data_a) {
        return reply.status(400).send({ error: 'data_da and data_a are required' });
      }

      // Fetch all enabled esiti in date range
      const result = await query(
        `SELECT
          g.id,
          b."oggetto" AS titolo,
          b."cig" AS cig,
          g."importo_aggiudicazione" AS importo,
          g."data_gara" AS data,
          r."regione" AS regione,
          p."provincia" AS provincia,
          s."nome" AS stazione,
          soa."codice" AS soa,
          g."ribasso" AS ribasso,
          a."ragione_sociale" AS vincitore
        FROM gare g
        LEFT JOIN regioni r ON g."id_regione" = r.id
        LEFT JOIN province p ON g."id_provincia" = p.id
        LEFT JOIN stazioni s ON g."id_stazione" = s.id
        LEFT JOIN soa ON g."id_soa" = soa.id
        LEFT JOIN dettaglio_gara dg ON g.id = dg.id_gara AND dg.vincitrice = true
        LEFT JOIN aziende a ON dg.id_azienda = a.id
        WHERE g."data_gara" >= $1 AND g."data_gara" <= $2
        AND g.annullato IS NOT TRUE
        ORDER BY r."regione", p."provincia", b."oggetto"`,
        [data_da, data_a]
      );

      const items = result.rows.map(row => ({
        id: row.id,
        titolo: row.titolo,
        cig: row.cig,
        importo: row.importo || 0,
        data: row.data ? new Date(row.data).toLocaleDateString('it-IT') : '',
        regione: row.regione,
        provincia: row.provincia,
        stazione: row.stazione,
        soa: row.soa,
        ribasso: row.ribasso || 0,
        vincitore: row.vincitore
      }));

      const dateRange = {
        da: new Date(data_da).toLocaleDateString('it-IT'),
        a: new Date(data_a).toLocaleDateString('it-IT')
      };

      const { html, unsubscribeToken } = buildNewsletterHtml('esiti', items, dateRange);

      // Count unique recipients
      const recipients = await query(
        `SELECT COUNT(DISTINCT u.id) AS count FROM users u
        WHERE u."newsletter_esiti" = true AND u."attivo" = true`
      );

      return {
        html,
        unsubscribeToken,
        destinatari_count: parseInt(recipients.rows[0].count),
        esiti_count: items.length
      };
    } catch (err) {
      fastify.log.error(err, 'Newsletter esiti genera error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/admin/newsletter/bandi/anteprima
  fastify.get('/bandi/anteprima', async (request, reply) => {
    try {
      const { data_da, data_a } = request.query;

      if (!data_da || !data_a) {
        return reply.status(400).send({ error: 'data_da and data_a are required' });
      }

      const result = await query(
        `SELECT
          b.id, b."titolo" AS titolo, b."codice_cig" AS cig, b."importo_so" AS importo, b."data_pubblicazione" AS data,
          r."regione" AS regione, p."provincia" AS provincia, s."nome" AS stazione,
          soa."codice" AS soa
        FROM bandi b
        LEFT JOIN regioni r ON b."id_regione" = r.id
        LEFT JOIN stazioni s2 ON b.id_stazione = s2.id
        LEFT JOIN province p ON s2.id_provincia = p.id
        LEFT JOIN stazioni s ON b."id_stazione" = s.id
        LEFT JOIN soa ON b."id_soa" = soa.id
        WHERE b."data_pubblicazione" >= $1 AND b."data_pubblicazione" <= $2
        AND b.annullato IS NOT TRUE
        ORDER BY r."regione", p."provincia"`,
        [data_da, data_a]
      );

      const items = result.rows.map(row => ({
        titolo: row.titolo,
        cig: row.cig,
        importo: row.importo || 0,
        data: row.data ? new Date(row.data).toLocaleDateString('it-IT') : '',
        regione: row.regione,
        provincia: row.provincia,
        stazione: row.stazione,
        soa: row.soa
      }));

      const dateRange = {
        da: new Date(data_da).toLocaleDateString('it-IT'),
        a: new Date(data_a).toLocaleDateString('it-IT')
      };

      const { html } = buildNewsletterHtml('bandi', items, dateRange);
      return { html, bandi_count: items.length };
    } catch (err) {
      fastify.log.error(err, 'Newsletter bandi anteprima error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/admin/newsletter/esiti/anteprima
  fastify.get('/esiti/anteprima', async (request, reply) => {
    try {
      const { data_da, data_a } = request.query;

      if (!data_da || !data_a) {
        return reply.status(400).send({ error: 'data_da and data_a are required' });
      }

      const result = await query(
        `SELECT
          g.id, b."oggetto" AS titolo, b."cig" AS cig, g."importo_aggiudicazione" AS importo, g."data_gara" AS data,
          r."regione" AS regione, p."provincia" AS provincia, s."nome" AS stazione,
          soa."codice" AS soa, g."ribasso" AS ribasso
        FROM gare g
        LEFT JOIN regioni r ON g."id_regione" = r.id
        LEFT JOIN province p ON g."id_provincia" = p.id
        LEFT JOIN stazioni s ON g."id_stazione" = s.id
        LEFT JOIN soa ON g."id_soa" = soa.id
        WHERE g."data_gara" >= $1 AND g."data_gara" <= $2
        AND g.annullato IS NOT TRUE
        ORDER BY r."regione", p."provincia"`,
        [data_da, data_a]
      );

      const items = result.rows.map(row => ({
        titolo: row.titolo,
        cig: row.cig,
        importo: row.importo || 0,
        data: row.data ? new Date(row.data).toLocaleDateString('it-IT') : '',
        regione: row.regione,
        provincia: row.provincia,
        stazione: row.stazione,
        soa: row.soa,
        ribasso: row.ribasso || 0
      }));

      const dateRange = {
        da: new Date(data_da).toLocaleDateString('it-IT'),
        a: new Date(data_a).toLocaleDateString('it-IT')
      };

      const { html } = buildNewsletterHtml('esiti', items, dateRange);
      return { html, esiti_count: items.length };
    } catch (err) {
      fastify.log.error(err, 'Newsletter esiti anteprima error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ==================== NEWSLETTER SENDING ====================

  // POST /api/admin/newsletter/bandi/invia
  fastify.post('/bandi/invia', async (request, reply) => {
    try {
      const { data_da, data_a, oggetto, note_aggiuntive } = request.body;

      if (!data_da || !data_a || !oggetto) {
        return reply.status(400).send({ error: 'data_da, data_a, and oggetto are required' });
      }

      // Fetch bandi
      const bandi = await query(
        `SELECT b.id, b."titolo" AS titolo, b."codice_cig" AS cig, b."importo_so" AS importo, b."data_pubblicazione" AS data,
                r."regione" AS regione, p."provincia" AS provincia, s."nome" AS stazione, soa."codice" AS soa
         FROM bandi b
         LEFT JOIN regioni r ON b."id_regione" = r.id
         LEFT JOIN stazioni s2 ON b.id_stazione = s2.id
        LEFT JOIN province p ON s2.id_provincia = p.id
         LEFT JOIN stazioni s ON b."id_stazione" = s.id
         LEFT JOIN soa ON b."id_soa" = soa.id
         WHERE b."data_pubblicazione" >= $1 AND b."data_pubblicazione" <= $2 AND b.annullato IS NOT TRUE
         ORDER BY r."regione"`,
        [data_da, data_a]
      );

      // Fetch all newsletter subscribers
      const users = await query(
        `SELECT id, email, "username" FROM users WHERE "newsletter_bandi" = true AND "attivo" = true`
      );

      const items = bandi.rows.map(row => ({
        titolo: row.titolo,
        cig: row.cig,
        importo: row.importo || 0,
        data: row.data ? new Date(row.data).toLocaleDateString('it-IT') : '',
        regione: row.regione,
        provincia: row.provincia,
        stazione: row.stazione,
        soa: row.soa
      }));

      const dateRange = {
        da: new Date(data_da).toLocaleDateString('it-IT'),
        a: new Date(data_a).toLocaleDateString('it-IT')
      };

      const { html } = buildNewsletterHtml('bandi', items, dateRange, note_aggiuntive);
      const transporter = await getMailTransporter();

      let sentCount = 0;
      let failedCount = 0;
      const errors = [];

      for (const user of users.rows) {
        try {
          await transporter.sendMail({
            from: process.env.SMTP_FROM || 'newsletter@easywin.it',
            to: user.email,
            subject: oggetto,
            html,
            text: `Newsletter Bandi - ${dateRange.da} al ${dateRange.a}`
          });
          sentCount++;
        } catch (err) {
          failedCount++;
          errors.push({ email: user.email, error: err.message });
        }
      }

      // Log newsletter sending
      const invioResult = await query(
        `INSERT INTO newsletter_invii (tipo, data_da, data_a, destinatari, inviati, falliti, oggetto, note, data_invio)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
         RETURNING id`,
        ['bandi', data_da, data_a, users.rows.length, sentCount, failedCount, oggetto, note_aggiuntive]
      );

      return {
        success: true,
        invio_id: invioResult.rows[0].id,
        destinatari_totali: users.rows.length,
        inviati: sentCount,
        falliti: failedCount,
        errors: failedCount > 0 ? errors : []
      };
    } catch (err) {
      fastify.log.error(err, 'Newsletter bandi invia error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/newsletter/esiti/invia
  fastify.post('/esiti/invia', async (request, reply) => {
    try {
      const { data_da, data_a, oggetto, note_aggiuntive } = request.body;

      if (!data_da || !data_a || !oggetto) {
        return reply.status(400).send({ error: 'data_da, data_a, and oggetto are required' });
      }

      // Fetch esiti
      const esiti = await query(
        `SELECT g.id, b."oggetto" AS titolo, b."cig" AS cig, g."importo_aggiudicazione" AS importo, g."data_gara" AS data,
                r."regione" AS regione, p."provincia" AS provincia, s."nome" AS stazione, soa."codice" AS soa, g."ribasso" AS ribasso
         FROM gare g
         LEFT JOIN regioni r ON g."id_regione" = r.id
         LEFT JOIN province p ON g."id_provincia" = p.id
         LEFT JOIN stazioni s ON g."id_stazione" = s.id
         LEFT JOIN soa ON g."id_soa" = soa.id
         WHERE g."data_gara" >= $1 AND g."data_gara" <= $2 AND g.annullato IS NOT TRUE
         ORDER BY r."regione"`,
        [data_da, data_a]
      );

      // Fetch all newsletter subscribers
      const users = await query(
        `SELECT id, email, "username" FROM users WHERE "newsletter_esiti" = true AND "attivo" = true`
      );

      const items = esiti.rows.map(row => ({
        titolo: row.titolo,
        cig: row.cig,
        importo: row.importo || 0,
        data: row.data ? new Date(row.data).toLocaleDateString('it-IT') : '',
        regione: row.regione,
        provincia: row.provincia,
        stazione: row.stazione,
        soa: row.soa,
        ribasso: row.ribasso || 0
      }));

      const dateRange = {
        da: new Date(data_da).toLocaleDateString('it-IT'),
        a: new Date(data_a).toLocaleDateString('it-IT')
      };

      const { html } = buildNewsletterHtml('esiti', items, dateRange, note_aggiuntive);
      const transporter = await getMailTransporter();

      let sentCount = 0;
      let failedCount = 0;
      const errors = [];

      for (const user of users.rows) {
        try {
          await transporter.sendMail({
            from: process.env.SMTP_FROM || 'newsletter@easywin.it',
            to: user.email,
            subject: oggetto,
            html,
            text: `Newsletter Esiti - ${dateRange.da} al ${dateRange.a}`
          });
          sentCount++;
        } catch (err) {
          failedCount++;
          errors.push({ email: user.email, error: err.message });
        }
      }

      // Log newsletter sending
      const invioResult = await query(
        `INSERT INTO newsletter_invii (tipo, data_da, data_a, destinatari, inviati, falliti, oggetto, note, data_invio)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
         RETURNING id`,
        ['esiti', data_da, data_a, users.rows.length, sentCount, failedCount, oggetto, note_aggiuntive]
      );

      return {
        success: true,
        invio_id: invioResult.rows[0].id,
        destinatari_totali: users.rows.length,
        inviati: sentCount,
        falliti: failedCount,
        errors: failedCount > 0 ? errors : []
      };
    } catch (err) {
      fastify.log.error(err, 'Newsletter esiti invia error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/newsletter/bandi/invia-test
  fastify.post('/bandi/invia-test', async (request, reply) => {
    try {
      const { email, data_da, data_a } = request.body;

      if (!email || !data_da || !data_a) {
        return reply.status(400).send({ error: 'email, data_da, and data_a are required' });
      }

      const bandi = await query(
        `SELECT b.id, b."titolo" AS titolo, b."codice_cig" AS cig, b."importo_so" AS importo, b."data_pubblicazione" AS data,
                r."regione" AS regione, p."provincia" AS provincia, s."nome" AS stazione, soa."codice" AS soa
         FROM bandi b
         LEFT JOIN regioni r ON b."id_regione" = r.id
         LEFT JOIN stazioni s2 ON b.id_stazione = s2.id
        LEFT JOIN province p ON s2.id_provincia = p.id
         LEFT JOIN stazioni s ON b."id_stazione" = s.id
         LEFT JOIN soa ON b."id_soa" = soa.id
         WHERE b."data_pubblicazione" >= $1 AND b."data_pubblicazione" <= $2 LIMIT 50`,
        [data_da, data_a]
      );

      const items = bandi.rows.map(row => ({
        titolo: row.titolo,
        cig: row.cig,
        importo: row.importo || 0,
        data: row.data ? new Date(row.data).toLocaleDateString('it-IT') : '',
        regione: row.regione,
        provincia: row.provincia,
        stazione: row.stazione,
        soa: row.soa
      }));

      const dateRange = {
        da: new Date(data_da).toLocaleDateString('it-IT'),
        a: new Date(data_a).toLocaleDateString('it-IT')
      };

      const { html } = buildNewsletterHtml('bandi', items, dateRange);
      const transporter = await getMailTransporter();

      await transporter.sendMail({
        from: process.env.SMTP_FROM || 'newsletter@easywin.it',
        to: email,
        subject: '[TEST] Newsletter Bandi EasyWin',
        html,
        text: `Test Newsletter Bandi - ${dateRange.da} al ${dateRange.a}`
      });

      return { success: true, message: `Test email sent to ${email}` };
    } catch (err) {
      fastify.log.error(err, 'Newsletter bandi test error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/newsletter/esiti/invia-test
  fastify.post('/esiti/invia-test', async (request, reply) => {
    try {
      const { email, data_da, data_a } = request.body;

      if (!email || !data_da || !data_a) {
        return reply.status(400).send({ error: 'email, data_da, and data_a are required' });
      }

      const esiti = await query(
        `SELECT g.id, b."oggetto" AS titolo, b."cig" AS cig, g."importo_aggiudicazione" AS importo, g."data_gara" AS data,
                r."regione" AS regione, p."provincia" AS provincia, s."nome" AS stazione, soa."codice" AS soa, g."ribasso" AS ribasso
         FROM gare g
         LEFT JOIN regioni r ON g."id_regione" = r.id
         LEFT JOIN province p ON g."id_provincia" = p.id
         LEFT JOIN stazioni s ON g."id_stazione" = s.id
         LEFT JOIN soa ON g."id_soa" = soa.id
         WHERE g."data_gara" >= $1 AND g."data_gara" <= $2 LIMIT 50`,
        [data_da, data_a]
      );

      const items = esiti.rows.map(row => ({
        titolo: row.titolo,
        cig: row.cig,
        importo: row.importo || 0,
        data: row.data ? new Date(row.data).toLocaleDateString('it-IT') : '',
        regione: row.regione,
        provincia: row.provincia,
        stazione: row.stazione,
        soa: row.soa,
        ribasso: row.ribasso || 0
      }));

      const dateRange = {
        da: new Date(data_da).toLocaleDateString('it-IT'),
        a: new Date(data_a).toLocaleDateString('it-IT')
      };

      const { html } = buildNewsletterHtml('esiti', items, dateRange);
      const transporter = await getMailTransporter();

      await transporter.sendMail({
        from: process.env.SMTP_FROM || 'newsletter@easywin.it',
        to: email,
        subject: '[TEST] Newsletter Esiti EasyWin',
        html,
        text: `Test Newsletter Esiti - ${dateRange.da} al ${dateRange.a}`
      });

      return { success: true, message: `Test email sent to ${email}` };
    } catch (err) {
      fastify.log.error(err, 'Newsletter esiti test error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ==================== NEWSLETTER HISTORY ====================

  // GET /api/admin/newsletter/storico
  fastify.get('/storico', async (request, reply) => {
    try {
      const result = await query(
        `SELECT id, tipo, data_da, data_a, destinatari, inviati, falliti, oggetto, data_invio
         FROM newsletter_invii
         ORDER BY data_invio DESC
         LIMIT 100`
      );

      return {
        invii: result.rows.map(row => ({
          id: row.id,
          tipo: row.tipo,
          periodo: `${row.data_da} - ${row.data_a}`,
          destinatari: row.destinatari,
          inviati: row.inviati,
          falliti: row.falliti,
          oggetto: row.oggetto,
          data_invio: row.data_invio
        }))
      };
    } catch (err) {
      fastify.log.error(err, 'Newsletter storico error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/admin/newsletter/storico/:id
  fastify.get('/storico/:id', async (request, reply) => {
    try {
      const { id } = request.params;

      const invio = await query(
        `SELECT id, tipo, data_da, data_a, destinatari, inviati, falliti, oggetto, note, data_invio
         FROM newsletter_invii WHERE id = $1`,
        [id]
      );

      if (invio.rows.length === 0) {
        return reply.status(404).send({ error: 'Newsletter invio not found' });
      }

      const recipients = await query(
        `SELECT email, status, data_invio FROM newsletter_invii_log
         WHERE id_invio = $1 ORDER BY data_invio DESC LIMIT 500`,
        [id]
      );

      return {
        invio: invio.rows[0],
        recipients: recipients.rows
      };
    } catch (err) {
      fastify.log.error(err, 'Newsletter storico detail error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ==================== USER NEWSLETTER CONFIG ====================

  // GET /api/admin/newsletter/utenti
  fastify.get('/utenti', async (request, reply) => {
    try {
      const result = await query(
        `SELECT id, "username", email, "newsletter_bandi", "newsletter_esiti", "created_at"
         FROM users WHERE "attivo" = true
         ORDER BY "username"`
      );

      return {
        utenti: result.rows.map(row => ({
          id: row.id,
          username: row.Username,
          email: row.email,
          newsletter_bandi: row.NewsletterBandi,
          newsletter_esiti: row.NewsletterEsiti,
          data_iscrizione: row.DataIscrizione
        }))
      };
    } catch (err) {
      fastify.log.error(err, 'Newsletter utenti error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // PUT /api/admin/newsletter/utenti/:id
  fastify.put('/utenti/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const { newsletter_bandi, newsletter_esiti } = request.body;

      const result = await query(
        `UPDATE users
         SET "newsletter_bandi" = COALESCE($1, "newsletter_bandi"),
             "newsletter_esiti" = COALESCE($2, "newsletter_esiti")
         WHERE id = $3
         RETURNING id, "username", email, "newsletter_bandi", "newsletter_esiti"`,
        [newsletter_bandi !== undefined ? newsletter_bandi : null, newsletter_esiti !== undefined ? newsletter_esiti : null, id]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ error: 'User not found' });
      }

      return {
        success: true,
        user: result.rows[0]
      };
    } catch (err) {
      fastify.log.error(err, 'Newsletter utenti update error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ==================== NEWSLETTER AUTOMATICA PERSONALIZZATA ====================
  // Questo endpoint viene chiamato dal cron job alle 4:00 di mattina.
  // Per ogni utente con newsletter attiva + filtri configurati:
  //   1. Recupera le sue regole da utenti_filtri_bandi
  //   2. Filtra i bandi/esiti del giorno precedente che matchano almeno una regola
  //   3. Genera una newsletter personalizzata e la invia
  // Utenti SENZA filtri ricevono TUTTI i bandi/esiti (comportamento legacy).

  // POST /api/admin/newsletter/auto — Invio automatico giornaliero
  fastify.post('/auto', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tipo = 'both', data_riferimento } = request.body || {};

    // Data di riferimento = ieri (i bandi importati ieri vengono inviati oggi alle 4)
    const ieri = data_riferimento
      ? new Date(data_riferimento)
      : new Date(new Date().setDate(new Date().getDate() - 1));
    const ieriStr = ieri.toISOString().split('T')[0];
    const oggiStr = new Date().toISOString().split('T')[0];
    const dateRange = {
      da: new Date(ieriStr).toLocaleDateString('it-IT'),
      a: new Date(ieriStr).toLocaleDateString('it-IT')
    };

    const log = { bandi: { sent: 0, failed: 0, skipped: 0, errors: [] }, esiti: { sent: 0, failed: 0, skipped: 0, errors: [] } };

    try {
      const transporter = await getMailTransporter();

      // ─── NEWSLETTER BANDI ───
      if (tipo === 'both' || tipo === 'bandi') {
        // 1. Tutti i bandi del giorno precedente
        const allBandi = await query(
          `SELECT b.id, b."titolo", b."codice_cig" AS cig, b."importo_so", b."importo_co",
                  b."data_pubblicazione" AS data, b."id_soa",
                  COALESCE(b.regione, '') AS regione,
                  COALESCE(s.nome, b.stazione_nome) AS stazione,
                  soa.codice AS soa_codice
           FROM bandi b
           LEFT JOIN stazioni s ON b.id_stazione = s.id
           LEFT JOIN soa ON b.id_soa = soa.id
           WHERE (b."created_at"::date = $1 OR b."data_rettifica"::date = $1)
             AND b.annullato IS NOT TRUE
           ORDER BY b.regione, b.titolo`,
          [ieriStr]
        );

        // Province per ogni bando
        const bandoProvince = {};
        if (allBandi.rows.length > 0) {
          const bandoIds = allBandi.rows.map(b => b.id);
          const provRes = await query(
            `SELECT bp.id_bando, bp.id_provincia FROM bandi_province bp WHERE bp.id_bando = ANY($1)`,
            [bandoIds]
          );
          provRes.rows.forEach(r => {
            if (!bandoProvince[r.id_bando]) bandoProvince[r.id_bando] = [];
            bandoProvince[r.id_bando].push(r.id_provincia);
          });
        }

        // 2. Utenti iscritti alla newsletter bandi (with optional email_newsletter_bandi_servizi)
        let usersBandi;
        try {
          usersBandi = await query(
            `SELECT u.id, u.username,
                    COALESCE(NULLIF(u.email_newsletter_bandi_servizi, ''), u.email) AS email
             FROM users u
             WHERE u.newsletter_bandi = true AND u.attivo = true AND u.email IS NOT NULL AND u.email != ''`
          );
        } catch (e) {
          // email_newsletter_bandi_servizi column may not exist (migration 014 not applied)
          usersBandi = await query(
            `SELECT u.id, u.username, u.email
             FROM users u
             WHERE u.newsletter_bandi = true AND u.attivo = true AND u.email IS NOT NULL AND u.email != ''`
          );
        }

        // 3. Per ogni utente, filtra bandi secondo le sue regole
        for (const user of usersBandi.rows) {
          try {
            let filtri = [];
            try {
              const filtriRes = await query(
                'SELECT id, id_soa, province_ids, importo_min, importo_max FROM utenti_filtri_bandi WHERE id_utente = $1 AND attivo = true',
                [user.id]
              );
              filtri = filtriRes.rows;
            } catch (filtriErr) {
              // Table may not exist if migration 016 not applied — user gets all bandi
            }

            let userBandi;
            if (filtri.length === 0) {
              // Nessun filtro → riceve tutti i bandi
              userBandi = allBandi.rows;
            } else {
              // Filtra in base alle regole (OR tra regole)
              userBandi = allBandi.rows.filter(bando => {
                const importo = parseFloat(bando.importo_so) || parseFloat(bando.importo_co) || 0;
                const bandoProv = bandoProvince[bando.id] || [];

                return filtri.some(f => {
                  // SOA match
                  if (f.id_soa && bando.id_soa !== f.id_soa) return false;
                  // Province match
                  const fProv = f.province_ids || [];
                  if (fProv.length > 0 && !fProv.some(pid => bandoProv.includes(pid))) return false;
                  // Importo min
                  const minI = parseFloat(f.importo_min) || 0;
                  if (minI > 0 && importo < minI) return false;
                  // Importo max
                  const maxI = parseFloat(f.importo_max) || 0;
                  if (maxI > 0 && importo > maxI) return false;
                  return true;
                });
              });
            }

            if (userBandi.length === 0) {
              log.bandi.skipped++;
              continue;
            }

            // Genera e invia
            const items = userBandi.map(b => ({
              titolo: b.titolo,
              cig: b.cig,
              importo: parseFloat(b.importo_so) || parseFloat(b.importo_co) || 0,
              data: b.data ? new Date(b.data).toLocaleDateString('it-IT') : '',
              regione: b.regione,
              stazione: b.stazione,
              soa: b.soa_codice
            }));

            const { html } = buildNewsletterHtml('bandi', items, dateRange,
              filtri.length > 0 ? `Bandi selezionati in base ai tuoi ${filtri.length} filtri personalizzati.` : ''
            );

            await transporter.sendMail({
              from: process.env.SMTP_FROM || 'newsletter@easywin.it',
              to: user.email,
              subject: `Newsletter Bandi EasyWin — ${dateRange.da} (${items.length} bandi)`,
              html,
              text: `Newsletter Bandi ${dateRange.da} — ${items.length} bandi per te`
            });
            log.bandi.sent++;
          } catch (err) {
            log.bandi.failed++;
            log.bandi.errors.push({ user: user.username, email: user.email, error: err.message });
          }
        }

        // Log invio
        if (log.bandi.sent > 0 || log.bandi.failed > 0) {
          await query(
            `INSERT INTO newsletter_invii (tipo, data_da, data_a, destinatari, inviati, falliti, oggetto, note, data_invio)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
            ['bandi_auto', ieriStr, ieriStr,
             usersBandi.rows.length, log.bandi.sent, log.bandi.failed,
             `[AUTO] Newsletter Bandi ${dateRange.da}`,
             `Invio automatico personalizzato. Totale bandi giorno: ${allBandi.rows.length}. Skipped (0 match): ${log.bandi.skipped}`]
          );
        }
      }

      // ─── NEWSLETTER ESITI ───
      if (tipo === 'both' || tipo === 'esiti') {
        const allEsiti = await query(
          `SELECT g.id, g.oggetto AS titolo, g.cig, g.importo_aggiudicazione AS importo,
                  g.data_gara AS data, g.id_soa, g.ribasso,
                  r.nome AS regione, p.nome AS provincia,
                  s.nome AS stazione, soa.codice AS soa_codice,
                  a.ragione_sociale AS vincitore
           FROM gare g
           LEFT JOIN regioni r ON g.id_regione = r.id
           LEFT JOIN province p ON g.id_provincia = p.id
           LEFT JOIN stazioni s ON g.id_stazione = s.id
           LEFT JOIN soa ON g.id_soa = soa.id
           LEFT JOIN dettaglio_gara dg ON g.id = dg.id_gara AND dg.vincitrice = true
           LEFT JOIN aziende a ON dg.id_azienda = a.id
           WHERE g."created_at"::date = $1
             AND g.annullato IS NOT TRUE
           ORDER BY r.nome, g.oggetto`,
          [ieriStr]
        );

        // Province per esiti (dalla tabella gare hanno id_provincia diretto)
        let usersEsiti;
        try {
          usersEsiti = await query(
            `SELECT u.id, u.username,
                    COALESCE(NULLIF(u.email_newsletter_esiti, ''), u.email) AS email
             FROM users u
             WHERE u.newsletter_esiti = true AND u.attivo = true AND u.email IS NOT NULL AND u.email != ''`
          );
        } catch (e) {
          // email_newsletter_esiti column may not exist (migration 014 not applied)
          usersEsiti = await query(
            `SELECT u.id, u.username, u.email
             FROM users u
             WHERE u.newsletter_esiti = true AND u.attivo = true AND u.email IS NOT NULL AND u.email != ''`
          );
        }

        for (const user of usersEsiti.rows) {
          try {
            let filtri = [];
            try {
              const filtriRes = await query(
                'SELECT id, id_soa, province_ids, importo_min, importo_max FROM utenti_filtri_bandi WHERE id_utente = $1 AND attivo = true',
                [user.id]
              );
              filtri = filtriRes.rows;
            } catch (filtriErr) {
              // Table may not exist if migration 016 not applied — user gets all esiti
            }

            let userEsiti;
            if (filtri.length === 0) {
              userEsiti = allEsiti.rows;
            } else {
              userEsiti = allEsiti.rows.filter(esito => {
                const importo = parseFloat(esito.importo) || 0;
                return filtri.some(f => {
                  if (f.id_soa && esito.id_soa !== f.id_soa) return false;
                  const fProv = f.province_ids || [];
                  // Per esiti, il match provincia è diretto (id_provincia sulla gara)
                  if (fProv.length > 0) {
                    // Cerchiamo nella tabella province la provincia dell'esito
                    // Qui usiamo il nome, ma sarebbe meglio l'id — per ora accettiamo il match
                    // perché l'esito ha id_provincia diretto
                    // In realtà dobbiamo fare match sull'id_provincia dell'esito
                    // TODO: migliorare quando disponibile id_provincia su gare
                  }
                  const minI = parseFloat(f.importo_min) || 0;
                  if (minI > 0 && importo < minI) return false;
                  const maxI = parseFloat(f.importo_max) || 0;
                  if (maxI > 0 && importo > maxI) return false;
                  return true;
                });
              });
            }

            if (userEsiti.length === 0) {
              log.esiti.skipped++;
              continue;
            }

            const items = userEsiti.map(e => ({
              titolo: e.titolo,
              cig: e.cig,
              importo: parseFloat(e.importo) || 0,
              data: e.data ? new Date(e.data).toLocaleDateString('it-IT') : '',
              regione: e.regione,
              provincia: e.provincia,
              stazione: e.stazione,
              soa: e.soa_codice,
              ribasso: e.ribasso || 0,
              vincitore: e.vincitore
            }));

            const { html } = buildNewsletterHtml('esiti', items, dateRange,
              filtri.length > 0 ? `Esiti selezionati in base ai tuoi ${filtri.length} filtri personalizzati.` : ''
            );

            await transporter.sendMail({
              from: process.env.SMTP_FROM || 'newsletter@easywin.it',
              to: user.email,
              subject: `Newsletter Esiti EasyWin — ${dateRange.da} (${items.length} esiti)`,
              html,
              text: `Newsletter Esiti ${dateRange.da} — ${items.length} esiti per te`
            });
            log.esiti.sent++;
          } catch (err) {
            log.esiti.failed++;
            log.esiti.errors.push({ user: user.username, email: user.email, error: err.message });
          }
        }

        if (log.esiti.sent > 0 || log.esiti.failed > 0) {
          await query(
            `INSERT INTO newsletter_invii (tipo, data_da, data_a, destinatari, inviati, falliti, oggetto, note, data_invio)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
            ['esiti_auto', ieriStr, ieriStr,
             usersEsiti.rows.length, log.esiti.sent, log.esiti.failed,
             `[AUTO] Newsletter Esiti ${dateRange.da}`,
             `Invio automatico personalizzato. Totale esiti giorno: ${allEsiti.rows.length}. Skipped (0 match): ${log.esiti.skipped}`]
          );
        }
      }

      return {
        success: true,
        data_riferimento: ieriStr,
        bandi: log.bandi,
        esiti: log.esiti,
        message: `Newsletter auto completata. Bandi: ${log.bandi.sent} inviati, ${log.bandi.skipped} skip. Esiti: ${log.esiti.sent} inviati, ${log.esiti.skipped} skip.`
      };
    } catch (err) {
      fastify.log.error(err, 'Newsletter auto error');
      return reply.status(500).send({ error: 'Errore invio automatico newsletter', details: err.message });
    }
  });

  // POST /api/admin/newsletter/auto/anteprima — Preview per un utente specifico
  fastify.post('/auto/anteprima', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { username, tipo = 'bandi', data_riferimento } = request.body;
    if (!username) return reply.status(400).send({ error: 'username richiesto' });

    const ieri = data_riferimento ? data_riferimento : new Date(new Date().setDate(new Date().getDate() - 1)).toISOString().split('T')[0];
    const dateRange = {
      da: new Date(ieri).toLocaleDateString('it-IT'),
      a: new Date(ieri).toLocaleDateString('it-IT')
    };

    try {
      const userRes = await query('SELECT id, email FROM users WHERE username = $1', [username]);
      if (userRes.rows.length === 0) return reply.status(404).send({ error: 'Utente non trovato' });
      const userId = userRes.rows[0].id;

      const filtriRes = await query(
        'SELECT id, id_soa, province_ids, importo_min, importo_max FROM utenti_filtri_bandi WHERE id_utente = $1 AND attivo = true',
        [userId]
      );
      const filtri = filtriRes.rows;

      let items = [];
      if (tipo === 'bandi') {
        const allBandi = await query(
          `SELECT b.id, b.titolo, b.codice_cig AS cig, b.importo_so, b.importo_co,
                  b.data_pubblicazione AS data, b.id_soa,
                  COALESCE(b.regione, '') AS regione,
                  COALESCE(s.nome, b.stazione_nome) AS stazione,
                  soa.codice AS soa_codice
           FROM bandi b
           LEFT JOIN stazioni s ON b.id_stazione = s.id
           LEFT JOIN soa ON b.id_soa = soa.id
           WHERE (b."created_at"::date = $1 OR b."data_rettifica"::date = $1) AND b.annullato IS NOT TRUE
           ORDER BY b.regione, b.titolo`, [ieri]
        );

        const bandoProvince = {};
        if (allBandi.rows.length > 0) {
          const bIds = allBandi.rows.map(b => b.id);
          const provRes = await query('SELECT bp.id_bando, bp.id_provincia FROM bandi_province bp WHERE bp.id_bando = ANY($1)', [bIds]);
          provRes.rows.forEach(r => { if (!bandoProvince[r.id_bando]) bandoProvince[r.id_bando] = []; bandoProvince[r.id_bando].push(r.id_provincia); });
        }

        const filtered = filtri.length === 0 ? allBandi.rows : allBandi.rows.filter(b => {
          const importo = parseFloat(b.importo_so) || parseFloat(b.importo_co) || 0;
          const bProv = bandoProvince[b.id] || [];
          return filtri.some(f => {
            if (f.id_soa && b.id_soa !== f.id_soa) return false;
            const fP = f.province_ids || []; if (fP.length > 0 && !fP.some(pid => bProv.includes(pid))) return false;
            const mn = parseFloat(f.importo_min) || 0; if (mn > 0 && importo < mn) return false;
            const mx = parseFloat(f.importo_max) || 0; if (mx > 0 && importo > mx) return false;
            return true;
          });
        });

        items = filtered.map(b => ({
          titolo: b.titolo, cig: b.cig, importo: parseFloat(b.importo_so) || parseFloat(b.importo_co) || 0,
          data: b.data ? new Date(b.data).toLocaleDateString('it-IT') : '', regione: b.regione, stazione: b.stazione, soa: b.soa_codice
        }));
      }
      // (esiti simile, omesso per brevità nell'anteprima)

      const { html } = buildNewsletterHtml(tipo, items, dateRange,
        filtri.length > 0 ? `Anteprima per ${username}: ${filtri.length} filtri attivi, ${items.length} risultati.` : `Anteprima per ${username}: nessun filtro (riceve tutto).`
      );

      // Se override_email presente, invia l'anteprima a quell'indirizzo
      if (request.body.override_email) {
        try {
          const transporter = await getMailTransporter();
          await transporter.sendMail({
            from: process.env.SMTP_FROM || 'newsletter@easywin.it',
            to: request.body.override_email,
            subject: `[ANTEPRIMA] Newsletter ${tipo} per ${username} — ${dateRange.da}`,
            html,
            text: `Anteprima newsletter ${tipo} per ${username} — ${items.length} risultati`
          });
          return { html, items_count: items.length, filtri_count: filtri.length, data: ieri, email_sent_to: request.body.override_email };
        } catch (mailErr) {
          return reply.status(500).send({ error: 'Errore invio email: ' + mailErr.message, html, items_count: items.length });
        }
      }

      return { html, items_count: items.length, filtri_count: filtri.length, data: ieri };
    } catch (err) {
      fastify.log.error(err, 'Newsletter auto anteprima error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ==================== NEWSLETTER LOG DETTAGLIATO ====================

  // GET /api/admin/newsletter/log — Log invii con filtri e paginazione
  fastify.get('/log', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { limit = 50, offset = 0, tipo, username, esito } = request.query;
    try {
      let where = [];
      let params = [];
      let idx = 1;

      if (tipo) { where.push(`ni.tipo = $${idx++}`); params.push(tipo); }
      if (username) { where.push(`ni.username_invio ILIKE $${idx++}`); params.push(`%${username}%`); }
      if (esito === 'ok') { where.push(`ni.falliti = 0`); }
      else if (esito === 'err') { where.push(`ni.falliti > 0`); }

      const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

      const countRes = await query(`SELECT COUNT(*) AS total FROM newsletter_invii ni ${whereClause}`, params);
      const total = parseInt(countRes.rows[0].total);

      params.push(parseInt(limit));
      params.push(parseInt(offset));
      const result = await query(`
        SELECT ni.id, ni.tipo, ni.oggetto, ni.data_invio, ni.destinatari, ni.inviati, ni.falliti,
               ni.data_da, ni.data_a, ni.note, ni.username_invio
        FROM newsletter_invii ni
        ${whereClause}
        ORDER BY ni.data_invio DESC
        LIMIT $${idx++} OFFSET $${idx++}
      `, params);

      return { log: result.rows, total, limit: parseInt(limit), offset: parseInt(offset) };
    } catch (err) {
      fastify.log.error(err, 'Newsletter log error');
      return reply.status(500).send({ error: err.message });
    }
  });
}
