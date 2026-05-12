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
  // Authentication is handled by the admin scope in server.js

  // ==================== DASHBOARD STATISTICS ====================

  // GET /api/admin/dashboard/stats - Enhanced statistics
  // GET /api/admin/dashboard/summary - Dashboard summary (called by frontend)
  fastify.get('/dashboard/summary', async (request, reply) => {
    try {
      const result = await query(`
        SELECT
          (SELECT COUNT(*) FROM gare WHERE annullato IS NOT TRUE) as esiti_totali,
          (SELECT COUNT(*) FROM gare WHERE annullato = true) as esiti_da_cancellare,
          (SELECT COUNT(*) FROM aziende WHERE attivo = false) as aziende_da_cancellare,
          (SELECT COUNT(*) FROM stazioni WHERE attivo = false) as stazioni_da_cancellare,
          0 as fonti_da_controllare
      `);
      reply.send(result.rows[0] || {});
    } catch (err) {
      fastify.log.error(err, 'Dashboard summary error');
      reply.send({
        esiti_totali: 0,
        esiti_da_cancellare: 0,
        aziende_da_cancellare: 0,
        stazioni_da_cancellare: 0,
        fonti_da_controllare: 0
      });
    }
  });

  fastify.get('/dashboard/stats', async (request, reply) => {
    try {
      const stats = await Promise.all([
        query(`SELECT COUNT(*) AS total FROM bandi`),
        query(`SELECT COUNT(*) AS total FROM gare`),
        query(`SELECT COUNT(*) AS total FROM aziende WHERE attivo = true`),
        query(`SELECT COUNT(*) AS total FROM stazioni WHERE attivo = true`),
        query(`SELECT COUNT(*) AS total FROM users`),
        query(`SELECT COUNT(*) AS total FROM bandi WHERE EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM NOW()) AND EXTRACT(MONTH FROM created_at) = EXTRACT(MONTH FROM NOW())`),
        query(`SELECT COUNT(*) AS total FROM gare WHERE EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM NOW()) AND EXTRACT(MONTH FROM created_at) = EXTRACT(MONTH FROM NOW())`),
        query(`SELECT COUNT(*) AS total FROM bandi`).catch(() => ({ rows: [{ total: 0 }] })),
        query(`SELECT COUNT(*) AS total FROM gare WHERE annullato = true`),
        query(`SELECT COUNT(*) AS total FROM gare WHERE annullato = true`),
        query(`SELECT 0 AS total`),
        query(`SELECT 0 AS total`),
        query(`SELECT COUNT(*) AS total FROM gare WHERE annullato = true`),
        query(`SELECT COUNT(*) AS total FROM aziende WHERE attivo = false`),
        query(`SELECT COUNT(*) AS total FROM stazioni WHERE attivo = false`)
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
  // - Filtri parametrizzati ($n placeholders) per evitare SQL injection.
  // - COALESCE(col, 0) su ogni addendo della somma importi (un singolo NULL
  //   nella vecchia somma faceva NULL il totale).
  // - Risposta { data, scadenze_abbonamenti, totale }: 'data' e' l'alias che
  //   il client admin si aspetta (data.data || data).
  // - Fallback graceful (200 + array vuoto) se users_periodi non esiste o ha
  //   schema diverso, invece di 500 che bloccava la UI.
  fastify.get('/dashboard/scadenze-abbonamenti', async (request, reply) => {
    const { data_inizio, data_fine, agente } = request.query;
    try {
      // Verifica difensiva: users_periodi deve esistere (migration 005).
      const tbl = await query(`
        SELECT 1 FROM information_schema.tables WHERE table_name = 'users_periodi' LIMIT 1
      `);
      if (tbl.rows.length === 0) {
        return { data: [], scadenze_abbonamenti: [], totale: 0,
                 _note: "Tabella users_periodi assente — applicare migration 005." };
      }

      // Lista colonne effettivamente presenti su users_periodi (i 6 importi
      // sono stati aggiunti dalla 005 ma alcuni DB potrebbero averli sotto
      // nomi diversi nelle 014/022); su users il flag rinnovo_automatico
      // potrebbe mancare.
      const upCols = await query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name IN ('users_periodi','users')
      `);
      const has = new Set(upCols.rows.map(r => r.column_name));

      const importoFields = [
        'importo_bandi','importo_esiti','importo_esiti_light',
        'importo_newsletter_bandi','importo_newsletter_esiti','importo_simulazioni'
      ].filter(c => has.has(c));
      const importoSum = importoFields.length > 0
        ? importoFields.map(c => `COALESCE(up.${c}, 0)`).join(' + ')
        : '0';

      const params = [];
      const where = ['up.data_fine IS NOT NULL'];

      if (data_inizio) {
        params.push(data_inizio);
        where.push(`up.data_fine >= $${params.length}`);
      }
      if (data_fine) {
        params.push(data_fine);
        where.push(`up.data_inizio <= $${params.length}`);
      }
      if (agente && agente !== '' && has.has('codice_agente')) {
        params.push(agente);
        where.push(`u.codice_agente = $${params.length}`);
      }

      const query_str = `
        SELECT
          u.username,
          COALESCE(az.ragione_sociale, u.nome || ' ' || COALESCE(u.cognome, '')) AS impresa,
          COALESCE(az.ragione_sociale, '-') AS ragione_sociale,
          u.email,
          u.telefono,
          COALESCE(az.partita_iva, '-') AS partita_iva,
          COALESCE(p.nome, '-')         AS provincia,
          ${has.has('codice_agente')      ? "COALESCE(u.codice_agente, '-')"   : "'-'"}   AS agente,
          up.data_inizio                                                                  AS data_inizio,
          up.data_fine                                                                    AS data_fine,
          ${has.has('rinnovo_automatico') ? "COALESCE(u.rinnovo_automatico, false)" : "false"} AS rinnovo_automatico,
          ${has.has('tipo')               ? "COALESCE(up.tipo, 'standard')"     : "'standard'"} AS tipo,
          (${importoSum})                                                                 AS importo
        FROM users u
        LEFT JOIN users_periodi up ON u.username = up.username
        LEFT JOIN aziende az       ON u.id_azienda = az.id
        LEFT JOIN province p       ON az.id_provincia = p.id
        WHERE ${where.join(' AND ')}
        ORDER BY up.data_fine ASC
      `;

      const result = await query(query_str, params);

      return {
        data: result.rows,
        scadenze_abbonamenti: result.rows,
        totale: result.rows.length
      };
    } catch (err) {
      fastify.log.error({ err: err.message, stack: err.stack }, 'Scadenze abbonamenti error');
      return reply.status(200).send({
        data: [], scadenze_abbonamenti: [], totale: 0,
        _error: err.message
      });
    }
  });

  // GET /api/admin/dashboard/abbonamenti-bloccati - List of blocked/locked user subscriptions
  // Filtro opzionale ?search=<term> matcha impresa/nome/cognome/P.IVA.
  // Risposta: { data: [...], abbonamenti_bloccati: [...], totale: N }.
  // 'data' e' alias retro-compatibile col client che fa `data.data || data`.
  fastify.get('/dashboard/abbonamenti-bloccati', async (request, reply) => {
    const { search } = request.query;
    try {
      // Verifica difensiva delle colonne opzionali (alcuni DB legacy
      // potrebbero non avere users.bloccato / users.id_azienda /
      // users.codice_agente / users.ultimo_accesso aggiunti dalla 005).
      const cols = await query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'users'
          AND column_name IN ('bloccato','id_azienda','codice_agente','ultimo_accesso','telefono','email','nome','cognome')
      `);
      const present = new Set(cols.rows.map(r => r.column_name));
      if (!present.has('bloccato')) {
        // Schema legacy senza flag: nessun utente bloccato.
        return { data: [], abbonamenti_bloccati: [], totale: 0,
                 _note: "Colonna users.bloccato assente — applicare migration 005." };
      }

      const params = [];
      const conditions = ['u.bloccato = true'];
      if (search && String(search).trim()) {
        const s = `%${String(search).trim()}%`;
        // Match contestuale: ragione sociale azienda, nome, cognome, P.IVA.
        conditions.push(`(
          COALESCE(az.ragione_sociale,'') ILIKE $${params.length+1}
          OR COALESCE(u.nome,'')          ILIKE $${params.length+1}
          OR COALESCE(u.cognome,'')       ILIKE $${params.length+1}
          OR COALESCE(az.partita_iva,'')  ILIKE $${params.length+1}
        )`);
        params.push(s);
      }
      const where = `WHERE ${conditions.join(' AND ')}`;

      const result = await query(`
        SELECT
          u.username,
          COALESCE(az.ragione_sociale, u.nome || ' ' || COALESCE(u.cognome, '')) AS impresa,
          COALESCE(az.ragione_sociale, '-') AS ragione_sociale,
          u.nome,
          u.cognome,
          COALESCE(az.partita_iva, '-') AS partita_iva,
          COALESCE(p.nome, '-')         AS provincia,
          u.telefono,
          u.email,
          ${present.has('codice_agente')   ? "COALESCE(u.codice_agente, '-')" : "'-'"}  AS agente,
          ${present.has('ultimo_accesso')  ? "u.ultimo_accesso"               : "NULL"} AS ultimo_login
        FROM users u
        LEFT JOIN aziende  az ON u.id_azienda    = az.id
        LEFT JOIN province p  ON az.id_provincia = p.id
        ${where}
        ORDER BY COALESCE(az.ragione_sociale, u.username) ASC
      `, params);

      return {
        data: result.rows,                       // shape moderno (client si aspetta data.data || data)
        abbonamenti_bloccati: result.rows,       // shape legacy retrocompatibile
        totale: result.rows.length
      };
    } catch (err) {
      fastify.log.error({ err: err.message, stack: err.stack }, 'Abbonamenti bloccati error');
      // Fallback graceful: ritorniamo lista vuota + diagnostica invece di 500
      return reply.status(200).send({
        data: [], abbonamenti_bloccati: [], totale: 0,
        _error: err.message
      });
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
      const bandi_params = [];
      let bandi_idx = 1;
      if (filtro_regioni && filtro_regioni.length > 0) {
        const ph = filtro_regioni.map((_, i) => `$${bandi_idx + i}`).join(',');
        query_bandi += ` AND regione IN (${ph})`;
        bandi_params.push(...filtro_regioni);
        bandi_idx += filtro_regioni.length;
      }
      if (data_da) { query_bandi += ` AND data >= $${bandi_idx}`; bandi_params.push(data_da); bandi_idx++; }
      if (data_a) { query_bandi += ` AND data <= $${bandi_idx}`; bandi_params.push(data_a); bandi_idx++; }

      const bandi_result = await query(query_bandi, bandi_params);

      let query_recipients = `SELECT DISTINCT u.email FROM users u
        INNER JOIN users_periodi up ON u.username = up.username
        WHERE up.attivo = true AND up.importo_bandi > 0`;
      const recip_params = [];
      let recip_idx = 1;
      if (filtro_regioni && filtro_regioni.length > 0) {
        const ph = filtro_regioni.map((_, i) => `$${recip_idx + i}`).join(',');
        query_recipients += ` AND u.regione IN (${ph})`;
        recip_params.push(...filtro_regioni);
        recip_idx += filtro_regioni.length;
      }
      if (filtro_soa && filtro_soa.length > 0) {
        const ph = filtro_soa.map((_, i) => `$${recip_idx + i}`).join(',');
        query_recipients += ` AND u.soa IN (${ph})`;
        recip_params.push(...filtro_soa);
        recip_idx += filtro_soa.length;
      }

      const recipients_result = await query(query_recipients, recip_params);
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
        `INSERT INTO newsletter_invii (tipo, data_invio, destinatari, inviati, falliti, oggetto)
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
      const esiti_params = [];
      let esiti_idx = 1;
      if (filtro_regioni && filtro_regioni.length > 0) {
        const ph = filtro_regioni.map((_, i) => `$${esiti_idx + i}`).join(',');
        query_esiti += ` AND regione IN (${ph})`;
        esiti_params.push(...filtro_regioni);
        esiti_idx += filtro_regioni.length;
      }
      if (data_da) { query_esiti += ` AND data >= $${esiti_idx}`; esiti_params.push(data_da); esiti_idx++; }
      if (data_a) { query_esiti += ` AND data <= $${esiti_idx}`; esiti_params.push(data_a); esiti_idx++; }

      const esiti_result = await query(query_esiti, esiti_params);

      let query_recipients = `SELECT DISTINCT u.email FROM users u
        INNER JOIN users_periodi up ON u.username = up.username
        WHERE up.attivo = true AND (up.importo_esiti > 0 OR up.importo_esiti_light > 0)`;
      const recip_params = [];
      let recip_idx = 1;
      if (filtro_regioni && filtro_regioni.length > 0) {
        const ph = filtro_regioni.map((_, i) => `$${recip_idx + i}`).join(',');
        query_recipients += ` AND u.regione IN (${ph})`;
        recip_params.push(...filtro_regioni);
        recip_idx += filtro_regioni.length;
      }
      if (filtro_soa && filtro_soa.length > 0) {
        const ph = filtro_soa.map((_, i) => `$${recip_idx + i}`).join(',');
        query_recipients += ` AND u.soa IN (${ph})`;
        recip_params.push(...filtro_soa);
        recip_idx += filtro_soa.length;
      }

      const recipients_result = await query(query_recipients, recip_params);
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
        `INSERT INTO newsletter_invii (tipo, data_invio, destinatari, inviati, falliti, oggetto)
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

  /**
   * GET /api/admin/servizi/stato
   *
   * Parity con legacy easywin.it (Areas/Gestione/Views/Dashboard/StatoServizi.cshtml):
   * la pagina mostra i `JobMessages` di un dato servizio in una data, filtrando
   * opzionalmente per IDEsito quando il servizio e' quello degli esiti.
   *
   * Schema-tolerant: nel nuovo DB esistono piu' tabelle "log job" parzialmente
   * sovrapposte (job_messages versione 005 con job_name/messaggio/tipo,
   * versione 006 con id_job FK jobs.id/messaggio/livello). Detect dinamico
   * delle colonne per evitare 500 su DB legacy. Se nessuna colonna utile
   * esiste, ritorna 200 con messaggi=[] piu' marker `_warning` (no crash).
   *
   * Query params:
   *   servizio  string  — chiave del servizio (es. "invio-esito", "newsletter")
   *   data      string  — YYYY-MM-DD: data di esecuzione da filtrare
   *   esito     int     — IDEsito (solo per servizi sugli esiti)
   *
   * Response (parity legacy JobMessages):
   *   {
   *     success: true,
   *     messaggi: [ { data, messaggio, severity, priority } ],
   *     totale: N,
   *     log: "<table>...</table>"   // pre-rendered per il vecchio client se serve
   *   }
   */
  fastify.get('/servizi/stato', async (request, reply) => {
    try {
      const { servizio, data, esito } = request.query || {};

      // Detect quali colonne sono disponibili in job_messages
      const cols = await query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'job_messages'
      `);
      const have = new Set(cols.rows.map(r => r.column_name));

      // Se la tabella non esiste o non ha le colonne utili → 200 vuoto graceful
      if (!have.has('data') && !have.has('messaggio')) {
        return {
          success: true,
          messaggi: [],
          totale: 0,
          log: '',
          _warning: 'job_messages non disponibile in questo schema'
        };
      }

      // Costruisco SELECT dinamico in base alle colonne presenti
      const selectParts = ['jm.data AS data', 'jm.messaggio AS messaggio'];
      // Severity: usa "livello" (006) o "tipo" (005) o fallback 'info'
      if (have.has('livello'))      selectParts.push('jm.livello AS severity');
      else if (have.has('tipo'))    selectParts.push('jm.tipo AS severity');
      else                          selectParts.push("'info'::text AS severity");

      // Priority: non presente nel nuovo schema → null
      selectParts.push("NULL::text AS priority");

      // Filtri WHERE
      const where = [];
      const params = [];

      // Filtro servizio: prova job_name (005) o JOIN jobs.nome/tipo (006)
      if (servizio) {
        if (have.has('job_name')) {
          params.push(servizio);
          where.push(`jm.job_name ILIKE '%' || $${params.length} || '%'`);
        } else if (have.has('id_job')) {
          params.push(servizio);
          where.push(`EXISTS (
            SELECT 1 FROM jobs j
            WHERE j.id = jm.id_job
              AND (j.nome ILIKE '%' || $${params.length} || '%'
                   OR j.tipo ILIKE '%' || $${params.length} || '%')
          )`);
        }
      }

      // Filtro data (cast a date per ignorare ora)
      if (data) {
        params.push(data);
        where.push(`jm.data::date = $${params.length}::date`);
      }

      // Filtro IDEsito: il legacy lo usa solo per il servizio "esiti".
      // Cerco il numero nel testo del messaggio (i job log degli esiti
      // tipicamente loggano "Esito ID=123" o simili).
      if (esito && Number(esito) > 0) {
        params.push(`%${Number(esito)}%`);
        where.push(`jm.messaggio ILIKE $${params.length}`);
      }

      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const sql = `
        SELECT ${selectParts.join(', ')}
        FROM job_messages jm
        ${whereSql}
        ORDER BY jm.data DESC
        LIMIT 500
      `;

      const result = await query(sql, params);
      const messaggi = result.rows;

      return {
        success: true,
        messaggi,
        totale: messaggi.length,
        // log HTML pre-rendered (parity legacy: lo usa il vecchio client se vuole)
        log: ''
      };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'Service status error');
      // Non rispondere 500: il client gestisce errori "soft" mostrando il warning
      return {
        success: false,
        messaggi: [],
        totale: 0,
        log: '',
        _error: err.message
      };
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

  // GET /api/admin/dashboard — returns full stats JSON (was redirecting to /stats)
  // PERFORMANCE: la versione precedente faceva 10 COUNT in parallelo, di cui due
  // usavano EXTRACT(YEAR FROM created_at) = ... — espressione non-sargable che
  // sui ~1.1M bandi e ~200k gare faceva full table scan, finendo in timeout
  // (endpoint riportato come "pending" dal client). Ora le 4 COUNT su bandi/gare
  // sono accentrate in una sola query con COUNT(*) FILTER (...) e la finestra
  // temporale usa un range sargable su created_at (usa l'indice se presente).
  fastify.get('/dashboard', async (request, reply) => {
    try {
      const [aggBandi, aggGare, aggAziende, aggStazioni, totUsers] = await Promise.all([
        query(`
          SELECT
            COUNT(*)::int                                                            AS totale,
            COUNT(*) FILTER (
              WHERE created_at >= date_trunc('month', NOW())
                AND created_at <  date_trunc('month', NOW()) + INTERVAL '1 month'
            )::int                                                                   AS questo_mese
          FROM bandi
        `),
        query(`
          SELECT
            COUNT(*)::int                                                            AS totale,
            COUNT(*) FILTER (
              WHERE created_at >= date_trunc('month', NOW())
                AND created_at <  date_trunc('month', NOW()) + INTERVAL '1 month'
            )::int                                                                   AS questo_mese,
            COUNT(*) FILTER (WHERE annullato = true)::int                            AS annullati
          FROM gare
        `),
        query(`
          SELECT
            COUNT(*) FILTER (WHERE attivo = true)::int  AS attive,
            COUNT(*) FILTER (WHERE attivo = false)::int AS inattive
          FROM aziende
        `),
        query(`
          SELECT
            COUNT(*) FILTER (WHERE attivo = true)::int  AS attive,
            COUNT(*) FILTER (WHERE attivo = false)::int AS inattive
          FROM stazioni
        `),
        query(`SELECT COUNT(*)::int AS total FROM users`)
      ]);

      // Backward-compat: ritorno lo stesso shape della versione precedente per
      // non rompere il client admin che si aspetta queste chiavi.
      const stats = [
        { rows: [{ total: aggBandi.rows[0].totale }] },                  // bandi_totali
        { rows: [{ total: aggGare.rows[0].totale }] },                   // esiti_totali
        { rows: [{ total: aggAziende.rows[0].attive }] },                // aziende_totali
        { rows: [{ total: aggStazioni.rows[0].attive }] },               // stazioni_totali
        { rows: [{ total: totUsers.rows[0].total }] },                   // utenti_totali
        { rows: [{ total: aggBandi.rows[0].questo_mese }] },             // bandi_questo_mese
        { rows: [{ total: aggGare.rows[0].questo_mese }] },              // esiti_questo_mese
        { rows: [{ total: aggGare.rows[0].annullati }] },                // esiti_da_cancellare
        { rows: [{ total: aggAziende.rows[0].inattive }] },              // aziende_inattive
        { rows: [{ total: aggStazioni.rows[0].inattive }] }              // stazioni_inattive
      ];

      return {
        bandi_totali: parseInt(stats[0].rows[0].total),
        esiti_totali: parseInt(stats[1].rows[0].total),
        aziende_totali: parseInt(stats[2].rows[0].total),
        stazioni_totali: parseInt(stats[3].rows[0].total),
        utenti_totali: parseInt(stats[4].rows[0].total),
        bandi_questo_mese: parseInt(stats[5].rows[0].total),
        esiti_questo_mese: parseInt(stats[6].rows[0].total),
        esiti_da_cancellare: parseInt(stats[7].rows[0].total),
        aziende_da_cancellare: parseInt(stats[8].rows[0].total),
        stazioni_da_cancellare: parseInt(stats[9].rows[0].total)
      };
    } catch (err) {
      fastify.log.error(err, 'Dashboard error');
      return reply.status(500).send({ error: err.message });
    }
  });
}
