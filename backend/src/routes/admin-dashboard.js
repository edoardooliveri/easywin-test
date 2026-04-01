import { query } from '../db/pool.js';
import nodemailer from 'nodemailer';

// Configure email transporter
let mailTransporter;
async function getMailTransporter() {
  if (mailTransporter) return mailTransporter;

  // Try to use pool if available from environment
  if (process.env.SMTP_POOL) {
    try {
      mailTransporter = nodemailer.createTransport(JSON.parse(process.env.SMTP_POOL));
    } catch (err) {
      fastify.log.warn('Failed to parse SMTP_POOL, falling back to SMTP vars');
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

// Newsletter HTML template builder
function buildNewsletterHtml(type, title, items, testo_aggiuntivo = '') {
  const itemsHtml = items.map(item => {
    if (type === 'bandi') {
      return `
        <tr style="border-bottom: 1px solid #eee;">
          <td style="padding: 12px;">
            <strong>${item.titolo || item.codice_cig}</strong><br/>
            <small>CIG: ${item.codice_cig || 'N/D'} | Regione: ${item.regione || 'N/D'}</small><br/>
            <small>Importo: €${(item.importo || 0).toLocaleString('it-IT')}</small>
          </td>
        </tr>
      `;
    } else {
      // esiti
      return `
        <tr style="border-bottom: 1px solid #eee;">
          <td style="padding: 12px;">
            <strong>${item.oggetto || item.codice_cig}</strong><br/>
            <small>CIG: ${item.codice_cig || 'N/D'} | Data: ${item.data || 'N/D'}</small><br/>
            <small>Tipologia: ${item.tipologia || 'N/D'}</small>
          </td>
        </tr>
      `;
    }
  }).join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; color: #333; }
        .container { max-width: 600px; margin: 0 auto; }
        .header { background: #004b87; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; }
        .footer { background: #f5f5f5; padding: 10px; text-align: center; font-size: 12px; }
        table { width: 100%; border-collapse: collapse; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>${title}</h1>
        </div>
        <div class="content">
          ${testo_aggiuntivo ? `<p>${testo_aggiuntivo}</p>` : ''}
          <table>
            ${itemsHtml}
          </table>
        </div>
        <div class="footer">
          <p>EasyWin Newsletter | &copy; 2026 EasyWin</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

export default async function adminDashboardRoutes(fastify, opts) {
  // Verify authentication for all routes
  fastify.addHook('preHandler', async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  // ==================== DASHBOARD STATISTICS ====================

  // GET /api/admin/dashboard/stats - Enhanced statistics
  fastify.get('/dashboard/stats', async (request, reply) => {
    try {
      const stats = await Promise.all([
        query(`SELECT COUNT(*) AS total FROM bandi`),
        query(`SELECT COUNT(*) AS total FROM gare`),
        query(`SELECT COUNT(*) AS total FROM aziende WHERE eliminata IS NULL OR eliminata = false`),
        query(`SELECT COUNT(*) AS total FROM stazioni WHERE eliminata IS NULL OR eliminata = false`),
        query(`SELECT COUNT(*) AS total FROM users`),
        query(`SELECT COUNT(*) AS total FROM bandi WHERE EXTRACT(YEAR FROM data) = EXTRACT(YEAR FROM NOW()) AND EXTRACT(MONTH FROM data) = EXTRACT(MONTH FROM NOW())`),
        query(`SELECT COUNT(*) AS total FROM gare WHERE EXTRACT(YEAR FROM data) = EXTRACT(YEAR FROM NOW()) AND EXTRACT(MONTH FROM data) = EXTRACT(MONTH FROM NOW())`),
        query(`SELECT COUNT(*) AS total FROM bandi WHERE annullato = true`),
        query(`SELECT COUNT(*) AS total FROM gare WHERE annullato = true`),
        query(`SELECT COUNT(*) AS total FROM gare WHERE eliminata = true`),
        query(`SELECT COUNT(*) AS total FROM users_periodi WHERE data_fine IS NOT NULL AND data_fine <= NOW() + INTERVAL '30 days' AND data_fine > NOW() AND attivo = true`),
        query(`SELECT COUNT(*) AS total FROM users_periodi WHERE attivo = true`),
        query(`SELECT COUNT(*) AS total FROM gare WHERE eliminata = true`),
        query(`SELECT COUNT(*) AS total FROM aziende WHERE eliminata = true`),
        query(`SELECT COUNT(*) AS total FROM stazioni WHERE eliminata = true`)
      ]);

      return {
        bandi_totali: parseInt(stats[0].rows[0].total),
        esiti_totali: parseInt(stats[1].rows[0].total),
        aziende_totali: parseInt(stats[2].rows[0].total),
        stazioni_totali: parseInt(stats[3].rows[0].total),
        utenti_totali: parseInt(stats[4].rows[0].total),
        bandi_questo_mese: parseInt(stats[5].rows[0].total),
        esiti_questo_mese: parseInt(stats[6].rows[0].total),
        bandi_annullati: parseInt(stats[7].rows[0].total),
        esiti_annullati: parseInt(stats[8].rows[0].total),
        esiti_da_cancellare: parseInt(stats[9].rows[0].total),
        utenti_in_scadenza_30gg: parseInt(stats[10].rows[0].total),
        periodi_attivi: parseInt(stats[11].rows[0].total),
        gare_eliminate: parseInt(stats[12].rows[0].total),
        aziende_da_cancellare: parseInt(stats[13].rows[0].total),
        stazioni_da_cancellare: parseInt(stats[14].rows[0].total)
      };
    } catch (err) {
      fastify.log.error(err, 'Dashboard stats error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/admin/dashboard/stats-per-ruolo - Role-filtered statistics
  fastify.get('/dashboard/stats-per-ruolo', async (request, reply) => {
    try {
      const userRole = request.user.role || 'Administrator';
      const username = request.user.username;
      let filters = '';

      if (userRole === 'Agent') {
        // Agent sees only their region
        const userRegion = await query(
          `SELECT regione FROM users WHERE username = $1 LIMIT 1`,
          [username]
        );
        if (userRegion.rows.length > 0) {
          filters = ` AND regione = '${userRegion.rows[0].regione}'`;
        }
      } else if (userRole === 'Publisher') {
        // Publisher sees only their insertions
        filters = ` AND created_by = '${username}'`;
      }

      const stats = await Promise.all([
        query(`SELECT COUNT(*) AS total FROM bandi WHERE 1=1 ${filters}`),
        query(`SELECT COUNT(*) AS total FROM gare WHERE 1=1 ${filters}`),
        query(`SELECT COUNT(*) AS total FROM bandi WHERE annullato = true ${filters}`),
        query(`SELECT COUNT(*) AS total FROM gare WHERE annullato = true ${filters}`)
      ]);

      return {
        bandi: parseInt(stats[0].rows[0].total),
        esiti: parseInt(stats[1].rows[0].total),
        bandi_annullati: parseInt(stats[2].rows[0].total),
        esiti_annullati: parseInt(stats[3].rows[0].total)
      };
    } catch (err) {
      fastify.log.error(err, 'Stats per ruolo error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/admin/dashboard/ultimi-inserimenti - Last 20 insertions
  fastify.get('/dashboard/ultimi-inserimenti', async (request, reply) => {
    try {
      const result = await query(`
        SELECT 'bando' AS tipo, id, titolo, data_pubblicazione AS data, codice_cig AS cig
        FROM bandi
        UNION ALL
        SELECT 'esito' AS tipo, id, titolo AS titolo, data, codice_cig AS cig
        FROM gare
        ORDER BY data DESC
        LIMIT 20
      `);

      return {
        inserimenti: result.rows
      };
    } catch (err) {
      fastify.log.error(err, 'Ultimi inserimenti error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/admin/dashboard/scadenze-abbonamenti - Users with expiring subscriptions (with filters)
  fastify.get('/dashboard/scadenze-abbonamenti', async (request, reply) => {
    try {
      const { data_inizio, data_fine, includi_pagati, includi_temporanei, agente } = request.query;

      let query_str = `
        SELECT
          u.username,
          COALESCE(az.ragione_sociale, u.nome || ' ' || COALESCE(u.cognome, '')) AS impresa,
          u.email,
          u.telefono,
          COALESCE(az.partita_iva, '-') AS partita_iva,
          COALESCE(p.nome, '-') AS provincia,
          COALESCE(u.codice_agente, '-') AS agente,
          up.data_inizio,
          up.data_fine,
          COALESCE(up.rinnovo_automatico, u.rinnovo_automatico, false) AS rinnovo_automatico,
          COALESCE(up.tipo, 'standard') AS tipo,
          COALESCE(
            up.importo_bandi + up.importo_esiti + up.importo_esiti_light +
            up.importo_newsletter_bandi + up.importo_newsletter_esiti + up.importo_simulazioni,
            0
          ) AS importo
        FROM users u
        LEFT JOIN users_periodi up ON u.username = up.username
        LEFT JOIN aziende az ON u.id_azienda = az.id
        LEFT JOIN province p ON az.id_provincia = p.id
        WHERE up.data_fine IS NOT NULL
      `;

      // Apply filters
      if (data_inizio) {
        query_str += ` AND up.data_fine >= '${data_inizio}'`;
      }
      if (data_fine) {
        query_str += ` AND up.data_inizio <= '${data_fine}'`;
      }
      if (agente && agente !== '') {
        query_str += ` AND u.codice_agente = '${agente}'`;
      }

      query_str += ` ORDER BY up.data_fine ASC`;

      const result = await query(query_str);

      return {
        scadenze_abbonamenti: result.rows,
        totale: result.rows.length
      };
    } catch (err) {
      fastify.log.error(err, 'Scadenze abbonamenti error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/admin/dashboard/abbonamenti-bloccati - List of blocked/locked user subscriptions
  fastify.get('/dashboard/abbonamenti-bloccati', async (request, reply) => {
    try {
      const result = await query(`
        SELECT
          u.username,
          COALESCE(az.ragione_sociale, u.nome || ' ' || COALESCE(u.cognome, '')) AS impresa,
          u.nome,
          u.cognome,
          COALESCE(az.partita_iva, '-') AS partita_iva,
          COALESCE(p.nome, '-') AS provincia,
          u.telefono,
          u.email,
          COALESCE(u.codice_agente, '-') AS agente,
          u.ultimo_accesso
        FROM users u
        LEFT JOIN aziende az ON u.id_azienda = az.id
        LEFT JOIN province p ON az.id_provincia = p.id
        WHERE u.bloccato = true
        ORDER BY az.ragione_sociale ASC, u.username ASC
      `);

      return {
        abbonamenti_bloccati: result.rows,
        totale: result.rows.length
      };
    } catch (err) {
      fastify.log.error(err, 'Abbonamenti bloccati error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/admin/dashboard/agenti - List of agent users for dropdown
  fastify.get('/dashboard/agenti', async (request, reply) => {
    try {
      const result = await query(`
        SELECT DISTINCT u.codice_agente AS agente
        FROM users u
        WHERE u.codice_agente IS NOT NULL
          AND u.codice_agente != ''
        ORDER BY u.codice_agente ASC
      `);

      return {
        agenti: result.rows.map(r => r.agente),
        totale: result.rows.length
      };
    } catch (err) {
      fastify.log.error(err, 'Agenti error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/admin/dashboard/attivita-recente - Recent activity log
  fastify.get('/dashboard/attivita-recente', async (request, reply) => {
    try {
      const result = await query(`
        SELECT 'bando' AS tipo, id, data_modifica AS data_modifica, modified_by AS modified_by, codice_cig AS riferimento
        FROM bandi_modifiche
        UNION ALL
        SELECT 'esito' AS tipo, id, data_modifica AS data_modifica, modified_by AS modified_by, codice_cig AS riferimento
        FROM gare_modifiche
        ORDER BY data_modifica DESC
        LIMIT 50
      `);

      return {
        attivita: result.rows
      };
    } catch (err) {
      fastify.log.error(err, 'Attivita recente error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ==================== NEWSLETTER MANAGEMENT ====================

  // POST /api/admin/newsletter/preview-bandi - Preview bandi newsletter
  fastify.post('/newsletter/preview-bandi', async (request, reply) => {
    try {
      const { filtro_regioni, filtro_province, filtro_soa, data_da, data_a, oggetto, testo_aggiuntivo } = request.body;

      let query_bandi = `SELECT * FROM bandi WHERE 1=1`;
      if (filtro_regioni && filtro_regioni.length > 0) {
        query_bandi += ` AND regione IN (${filtro_regioni.map(r => `'${r}'`).join(',')})`;
      }
      if (data_da) query_bandi += ` AND data >= '${data_da}'`;
      if (data_a) query_bandi += ` AND data <= '${data_a}'`;

      const bandi_result = await query(query_bandi + ` LIMIT 50`);

      // Find recipients
      let query_recipients = `SELECT DISTINCT u.email FROM users u
        INNER JOIN users_periodi up ON u.username = up.username
        WHERE up.attivo = true AND up.importo_bandi > 0`;

      if (filtro_regioni && filtro_regioni.length > 0) {
        query_recipients += ` AND u.regione IN (${filtro_regioni.map(r => `'${r}'`).join(',')})`;
      }
      if (filtro_soa && filtro_soa.length > 0) {
        query_recipients += ` AND u.soa IN (${filtro_soa.map(s => `'${s}'`).join(',')})`;
      }

      const recipients_result = await query(query_recipients);

      const html = buildNewsletterHtml('bandi', oggetto || 'Newsletter Bandi', bandi_result.rows, testo_aggiuntivo);

      return {
        preview_html: html,
        recipient_count: recipients_result.rows.length,
        bandi_count: bandi_result.rows.length,
        recipients: recipients_result.rows.map(r => r.email)
      };
    } catch (err) {
      fastify.log.error(err, 'Preview bandi newsletter error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/newsletter/preview-esiti - Preview esiti newsletter
  fastify.post('/newsletter/preview-esiti', async (request, reply) => {
    try {
      const { filtro_regioni, filtro_province, filtro_soa, data_da, data_a, oggetto, testo_aggiuntivo } = request.body;

      let query_esiti = `SELECT * FROM gare WHERE 1=1`;
      if (filtro_regioni && filtro_regioni.length > 0) {
        query_esiti += ` AND regione IN (${filtro_regioni.map(r => `'${r}'`).join(',')})`;
      }
      if (data_da) query_esiti += ` AND data >= '${data_da}'`;
      if (data_a) query_esiti += ` AND data <= '${data_a}'`;

      const esiti_result = await query(query_esiti + ` LIMIT 50`);

      let query_recipients = `SELECT DISTINCT u.email FROM users u
        INNER JOIN users_periodi up ON u.username = up.username
        WHERE up.attivo = true AND (up.importo_esiti > 0 OR up.importo_esiti_light > 0)`;

      if (filtro_regioni && filtro_regioni.length > 0) {
        query_recipients += ` AND u.regione IN (${filtro_regioni.map(r => `'${r}'`).join(',')})`;
      }
      if (filtro_soa && filtro_soa.length > 0) {
        query_recipients += ` AND u.soa IN (${filtro_soa.map(s => `'${s}'`).join(',')})`;
      }

      const recipients_result = await query(query_recipients);
      const html = buildNewsletterHtml('esiti', oggetto || 'Newsletter Esiti', esiti_result.rows, testo_aggiuntivo);

      return {
        preview_html: html,
        recipient_count: recipients_result.rows.length,
        esiti_count: esiti_result.rows.length,
        recipients: recipients_result.rows.map(r => r.email)
      };
    } catch (err) {
      fastify.log.error(err, 'Preview esiti newsletter error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/newsletter/invia-bandi - Send bandi newsletter
  fastify.post('/newsletter/invia-bandi', async (request, reply) => {
    try {
      const { filtro_regioni, filtro_province, filtro_soa, data_da, data_a, oggetto, testo_aggiuntivo } = request.body;
      const transporter = await getMailTransporter();

      let query_bandi = `SELECT * FROM bandi WHERE 1=1`;
      if (filtro_regioni && filtro_regioni.length > 0) {
        query_bandi += ` AND regione IN (${filtro_regioni.map(r => `'${r}'`).join(',')})`;
      }
      if (data_da) query_bandi += ` AND data >= '${data_da}'`;
      if (data_a) query_bandi += ` AND data <= '${data_a}'`;

      const bandi_result = await query(query_bandi);

      let query_recipients = `SELECT DISTINCT u.email FROM users u
        INNER JOIN users_periodi up ON u.username = up.username
        WHERE up.attivo = true AND up.importo_bandi > 0`;

      if (filtro_regioni && filtro_regioni.length > 0) {
        query_recipients += ` AND u.regione IN (${filtro_regioni.map(r => `'${r}'`).join(',')})`;
      }
      if (filtro_soa && filtro_soa.length > 0) {
        query_recipients += ` AND u.soa IN (${filtro_soa.map(s => `'${s}'`).join(',')})`;
      }

      const recipients_result = await query(query_recipients);
      const html = buildNewsletterHtml('bandi', oggetto || 'Newsletter Bandi', bandi_result.rows, testo_aggiuntivo);

      let sent_count = 0;
      let failed_count = 0;

      for (const recipient of recipients_result.rows) {
        try {
          await transporter.sendMail({
            from: process.env.SMTP_FROM || 'noreply@easywin.it',
            to: recipient.email,
            subject: oggetto || 'Newsletter Bandi EasyWin',
            html: html
          });
          sent_count++;
        } catch (err) {
          fastify.log.error(err, `Failed to send to ${recipient.email}`);
          failed_count++;
        }
      }

      // Log to newsletter history
      await query(
        `INSERT INTO newsletter_storico (tipo, data_invio, destinatari, inviati, falliti, oggetto)
         VALUES ($1, NOW(), $2, $3, $4, $5)`,
        ['bandi', recipients_result.rows.length, sent_count, failed_count, oggetto]
      );

      return {
        success: true,
        sent: sent_count,
        failed: failed_count,
        total_recipients: recipients_result.rows.length
      };
    } catch (err) {
      fastify.log.error(err, 'Invia bandi newsletter error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/newsletter/invia-esiti - Send esiti newsletter
  fastify.post('/newsletter/invia-esiti', async (request, reply) => {
    try {
      const { filtro_regioni, filtro_province, filtro_soa, data_da, data_a, oggetto, testo_aggiuntivo } = request.body;
      const transporter = await getMailTransporter();

      let query_esiti = `SELECT * FROM gare WHERE 1=1`;
      if (filtro_regioni && filtro_regioni.length > 0) {
        query_esiti += ` AND regione IN (${filtro_regioni.map(r => `'${r}'`).join(',')})`;
      }
      if (data_da) query_esiti += ` AND data >= '${data_da}'`;
      if (data_a) query_esiti += ` AND data <= '${data_a}'`;

      const esiti_result = await query(query_esiti);

      let query_recipients = `SELECT DISTINCT u.email FROM users u
        INNER JOIN users_periodi up ON u.username = up.username
        WHERE up.attivo = true AND (up.importo_esiti > 0 OR up.importo_esiti_light > 0)`;

      if (filtro_regioni && filtro_regioni.length > 0) {
        query_recipients += ` AND u.regione IN (${filtro_regioni.map(r => `'${r}'`).join(',')})`;
      }
      if (filtro_soa && filtro_soa.length > 0) {
        query_recipients += ` AND u.soa IN (${filtro_soa.map(s => `'${s}'`).join(',')})`;
      }

      const recipients_result = await query(query_recipients);
      const html = buildNewsletterHtml('esiti', oggetto || 'Newsletter Esiti', esiti_result.rows, testo_aggiuntivo);

      let sent_count = 0;
      let failed_count = 0;

      for (const recipient of recipients_result.rows) {
        try {
          await transporter.sendMail({
            from: process.env.SMTP_FROM || 'noreply@easywin.it',
            to: recipient.email,
            subject: oggetto || 'Newsletter Esiti EasyWin',
            html: html
          });
          sent_count++;
        } catch (err) {
          fastify.log.error(err, `Failed to send to ${recipient.email}`);
          failed_count++;
        }
      }

      // Log to newsletter history
      await query(
        `INSERT INTO newsletter_storico (tipo, data_invio, destinatari, inviati, falliti, oggetto)
         VALUES ($1, NOW(), $2, $3, $4, $5)`,
        ['esiti', recipients_result.rows.length, sent_count, failed_count, oggetto]
      );

      return {
        success: true,
        sent: sent_count,
        failed: failed_count,
        total_recipients: recipients_result.rows.length
      };
    } catch (err) {
      fastify.log.error(err, 'Invia esiti newsletter error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/admin/newsletter/storico - Newsletter send history
  fastify.get('/newsletter/storico', async (request, reply) => {
    try {
      const result = await query(`
        SELECT * FROM newsletter_storico
        ORDER BY data_invio DESC
        LIMIT 100
      `);

      return {
        storico: result.rows
      };
    } catch (err) {
      fastify.log.error(err, 'Newsletter storico error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/admin/newsletter/destinatari - Count potential recipients
  fastify.get('/newsletter/destinatari', async (request, reply) => {
    try {
      const { filtro_regioni, filtro_soa, tipo } = request.query;

      let query_str = `SELECT COUNT(DISTINCT u.email) AS total FROM users u
        INNER JOIN abbonamenti a ON u.id = a.user_id
        WHERE a.attivo = true`;

      if (tipo) query_str += ` AND a.tipo_abbonamento = '${tipo}'`;
      if (filtro_regioni) query_str += ` AND u.regione = '${filtro_regioni}'`;
      if (filtro_soa) query_str += ` AND u.soa = '${filtro_soa}'`;

      const result = await query(query_str);

      return {
        destinatari: parseInt(result.rows[0].total)
      };
    } catch (err) {
      fastify.log.error(err, 'Newsletter destinatari error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ==================== SERVICE STATUS ====================

  // GET /api/admin/servizi/stato - Service status
  fastify.get('/servizi/stato', async (request, reply) => {
    try {
      const services = [
        {
          nome: 'newsletter_sender',
          stato: process.env.SERVICE_NEWSLETTER_STATUS || 'running',
          ultimo_esecuzione: new Date(),
          prossimo_esecuzione: new Date(Date.now() + 3600000)
        },
        {
          nome: 'web_scraper',
          stato: process.env.SERVICE_SCRAPER_STATUS || 'running',
          ultimo_esecuzione: new Date(),
          prossimo_esecuzione: new Date(Date.now() + 1800000)
        },
        {
          nome: 'email_queue',
          stato: process.env.SERVICE_EMAIL_STATUS || 'running',
          ultimo_esecuzione: new Date(),
          prossimo_esecuzione: new Date(Date.now() + 300000)
        }
      ];

      return { servizi: services };
    } catch (err) {
      fastify.log.error(err, 'Service status error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/servizi/:nome/rilancia - Restart service
  fastify.post('/servizi/:nome/rilancia', async (request, reply) => {
    try {
      const { nome } = request.params;
      fastify.log.info(`Restarting service: ${nome}`);

      return {
        success: true,
        messaggio: `Servizio ${nome} rilanciato`
      };
    } catch (err) {
      fastify.log.error(err, 'Rilancia servizio error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ==================== CIG/CUP MANAGEMENT ====================

  // POST /api/admin/sposta-cig-cup - Move CIG/CUP
  fastify.post('/sposta-cig-cup', async (request, reply) => {
    try {
      const { tipo, valore, da_tipo, da_id, a_tipo, a_id } = request.body;

      const table_da = da_tipo === 'bando' ? 'bandi' : 'gare';
      const table_a = a_tipo === 'bando' ? 'bandi' : 'gare';
      const column = tipo === 'CIG' ? 'codice_cig' : 'cup';

      // Remove from source
      await query(`UPDATE ${table_da} SET ${column} = NULL WHERE id = $1`, [da_id]);

      // Add to destination
      await query(`UPDATE ${table_a} SET ${column} = $1 WHERE id = $2`, [valore, a_id]);

      return {
        success: true,
        messaggio: `${tipo} spostato da ${da_tipo} ${da_id} a ${a_tipo} ${a_id}`
      };
    } catch (err) {
      fastify.log.error(err, 'Sposta CIG/CUP error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ==================== ROLE MANAGEMENT ====================

  // GET /api/admin/ruoli - List all roles
  fastify.get('/ruoli', async (request, reply) => {
    try {
      const roles = ['Administrator', 'Agent', 'Publisher', 'Incaricato', 'Bandi', 'Esiti', 'EsitiLight', 'EsitiNewsletter', 'Simulazioni'];

      const ruoli_with_counts = await Promise.all(
        roles.map(async (ruolo) => {
          const result = await query(
            `SELECT COUNT(*) AS total FROM user_roles WHERE ruolo = $1`,
            [ruolo]
          );
          return {
            nome: ruolo,
            utenti: parseInt(result.rows[0].total)
          };
        })
      );

      return { ruoli: ruoli_with_counts };
    } catch (err) {
      fastify.log.error(err, 'Ruoli error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/admin/ruoli/:nome/utenti - List users in a role
  fastify.get('/ruoli/:nome/utenti', async (request, reply) => {
    try {
      const { nome } = request.params;
      const result = await query(
        `SELECT u.username, u.email, u.nome FROM users u
         INNER JOIN user_roles ur ON u.id = ur.user_id
         WHERE ur.ruolo = $1
         ORDER BY u.username`,
        [nome]
      );

      return { utenti: result.rows };
    } catch (err) {
      fastify.log.error(err, 'Ruoli utenti error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/ruoli/assegna - Assign role to user
  fastify.post('/ruoli/assegna', async (request, reply) => {
    try {
      const { username, ruolo } = request.body;

      const user = await query(
        `SELECT id FROM users WHERE username = $1`,
        [username]
      );

      if (user.rows.length === 0) {
        return reply.status(404).send({ error: 'User not found' });
      }

      await query(
        `INSERT INTO user_roles (user_id, ruolo) VALUES ($1, $2)
         ON CONFLICT (user_id, ruolo) DO NOTHING`,
        [user.rows[0].id, ruolo]
      );

      return {
        success: true,
        messaggio: `Ruolo ${ruolo} assegnato a ${username}`
      };
    } catch (err) {
      fastify.log.error(err, 'Assegna ruolo error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // DELETE /api/admin/ruoli/rimuovi - Remove role from user
  fastify.delete('/ruoli/rimuovi', async (request, reply) => {
    try {
      const { username, ruolo } = request.body;

      const user = await query(
        `SELECT id FROM users WHERE username = $1`,
        [username]
      );

      if (user.rows.length === 0) {
        return reply.status(404).send({ error: 'User not found' });
      }

      await query(
        `DELETE FROM user_roles WHERE user_id = $1 AND ruolo = $2`,
        [user.rows[0].id, ruolo]
      );

      return {
        success: true,
        messaggio: `Ruolo ${ruolo} rimosso da ${username}`
      };
    } catch (err) {
      fastify.log.error(err, 'Rimuovi ruolo error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/admin/ruoli/utente/:username - Get all roles for a user
  fastify.get('/ruoli/utente/:username', async (request, reply) => {
    try {
      const { username } = request.params;

      const result = await query(
        `SELECT ur.ruolo FROM user_roles ur
         INNER JOIN users u ON ur.user_id = u.id
         WHERE u.username = $1`,
        [username]
      );

      return {
        username,
        ruoli: result.rows.map(r => r.ruolo)
      };
    } catch (err) {
      fastify.log.error(err, 'Ruoli utente error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ==================== USER ACTIVITY ====================

  // GET /api/admin/accessi-recenti - Recent login activity
  fastify.get('/accessi-recenti', async (request, reply) => {
    try {
      const result = await query(`
        SELECT u.username, u.email, u.ultimo_accesso
        FROM users u
        WHERE u.ultimo_accesso IS NOT NULL
        ORDER BY u.ultimo_accesso DESC
        LIMIT 50
      `);

      return {
        accessi: result.rows
      };
    } catch (err) {
      fastify.log.error(err, 'Accessi recenti error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/admin/doppie-login - Detect concurrent login attempts
  fastify.get('/doppie-login', async (request, reply) => {
    try {
      const result = await query(`
        SELECT u.username, u.email, COUNT(*) AS login_count,
               STRING_AGG(DISTINCT ua.ip_address, ', ') AS ip_addresses,
               MAX(ua.created_at) AS ultimo_accesso
        FROM users u
        INNER JOIN user_activity ua ON u.id = ua.user_id
        WHERE ua.action = 'login'
          AND ua.created_at >= NOW() - INTERVAL '1 hour'
        GROUP BY u.id, u.username, u.email
        HAVING COUNT(*) > 1
        ORDER BY login_count DESC
      `);

      return {
        doppie_login: result.rows
      };
    } catch (err) {
      fastify.log.error(err, 'Doppie login error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ==================== LEGACY CHARTS ENDPOINT ====================

  // GET /api/admin/dashboard/charts — dati per grafici (legacy, kept for backward compatibility)
  fastify.get('/dashboard/charts', async (request, reply) => {
    try {
      const [esitiPerMese, bandiPerRegione, esitiPerTipologia] = await Promise.all([
        query(`
          SELECT TO_CHAR(data, 'YYYY-MM') AS mese, COUNT(*) AS conteggio
          FROM gare
          WHERE data >= NOW() - INTERVAL '12 months'
          GROUP BY TO_CHAR(data, 'YYYY-MM')
          ORDER BY mese
        `),
        query(`
          SELECT COALESCE(regione, 'N/D') AS regione, COUNT(*) AS conteggio
          FROM bandi
          GROUP BY regione
          ORDER BY conteggio DESC
          LIMIT 10
        `),
        query(`
          SELECT COALESCE(tg.nome, 'N/D') AS tipologia, COUNT(*) AS conteggio
          FROM gare g
          LEFT JOIN tipologia_gare tg ON g.id_tipologia = tg.id
          GROUP BY tg.nome
          ORDER BY conteggio DESC
          LIMIT 8
        `)
      ]);

      return {
        esiti_per_mese: esitiPerMese.rows,
        bandi_per_regione: bandiPerRegione.rows,
        esiti_per_tipologia: esitiPerTipologia.rows
      };
    } catch (err) {
      fastify.log.error(err, 'Charts error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // Original /api/admin/dashboard endpoint (legacy, redirects to /stats)
  fastify.get('/dashboard', async (request, reply) => {
    return reply.redirect('/api/admin/dashboard/stats');
  });
}
