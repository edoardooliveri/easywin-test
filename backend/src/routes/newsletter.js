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
}
