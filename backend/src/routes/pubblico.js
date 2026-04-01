import { query } from '../db/pool.js';
import { sendEmail } from '../services/email-service.js';
import crypto from 'crypto';
import xml from 'xml';

export default async function pubblicoRoutes(fastify, opts) {

  // ============================================================
  // RSS FEEDS
  // ============================================================

  /**
   * GET /api/pubblico/rss/bandi
   * RSS 2.0 feed of latest enabled bandi (last 50)
   */
  fastify.get('/rss/bandi', async (request, reply) => {
    try {
      const result = await query(
        `SELECT
          b."id_bando" AS id,
          b."Titolo" AS titolo,
          b."DataPubblicazione" AS data_pubblicazione,
          COALESCE(s."Nome", b."Stazione") AS stazione,
          b."Regione" AS provincia,
          b."ImportoSO" AS importo,
          b."CodiceCIG" AS codice_cig
         FROM bandi b
         LEFT JOIN stazioni s ON b."id_stazione" = s."id"
         WHERE b."Abilitato" = true AND b."Annullato" = false
         ORDER BY b."DataPubblicazione" DESC
         LIMIT 50`,
        []
      );

      const items = result.rows.map(r => ({
        item: [
          { title: r.titolo },
          { description: `Stazione: ${r.stazione}, Importo: ${r.importo ? Number(r.importo).toLocaleString('it-IT') + ' €' : 'N/A'}, CIG: ${r.codice_cig || 'N/A'}` },
          { pubDate: new Date(r.data_pubblicazione).toUTCString() },
          { link: `${process.env.FRONTEND_URL || 'https://easywin.it'}/bandi/${r.id}` },
          { guid: `bando-${r.id}` }
        ]
      }));

      const rssContent = xml({
        rss: [
          {
            _attr: { version: '2.0', 'xmlns:content': 'http://purl.org/rss/1.0/modules/content/' }
          },
          {
            channel: [
              { title: 'EasyWin - Bandi' },
              { link: process.env.FRONTEND_URL || 'https://easywin.it' },
              { description: 'Ultimi bandi pubblicati sulla piattaforma EasyWin' },
              { language: 'it-it' },
              { lastBuildDate: new Date().toUTCString() },
              ...items
            ]
          }
        ]
      });

      reply.type('application/rss+xml; charset=utf-8');
      return rssContent;
    } catch (err) {
      fastify.log.error({ err: err.message }, 'RSS bandi error');
      return reply.status(500).send({ error: 'Errore generazione RSS' });
    }
  });

  /**
   * GET /api/pubblico/rss/esiti
   * RSS 2.0 feed of latest enabled esiti (last 50)
   */
  fastify.get('/rss/esiti', async (request, reply) => {
    try {
      const result = await query(
        `SELECT
          g."id" AS id,
          g."Titolo" AS titolo,
          g."Data" AS data,
          COALESCE(s."nome", g."Stazione") AS stazione,
          g."regione" AS provincia,
          g."importo" AS importo,
          (SELECT a."ragione_sociale" FROM dettaglio_gara dg JOIN aziende a ON dg.id_azienda = a.id WHERE dg.id_gara = g."id" AND dg.vincitrice = true LIMIT 1) AS vincitore
         FROM gare g
         LEFT JOIN stazioni s ON g."id_stazione" = s."id"
         WHERE g."Abilitato" = true AND g."Annullato" = false
         ORDER BY g."Data" DESC
         LIMIT 50`,
        []
      );

      const items = result.rows.map(r => ({
        item: [
          { title: r.titolo },
          { description: `Stazione: ${r.stazione}, Importo: ${r.importo ? Number(r.importo).toLocaleString('it-IT') + ' €' : 'N/A'}, Vincitore: ${r.vincitore || 'Da definire'}` },
          { pubDate: new Date(r.data).toUTCString() },
          { link: `${process.env.FRONTEND_URL || 'https://easywin.it'}/esiti/${r.id}` },
          { guid: `esito-${r.id}` }
        ]
      }));

      const rssContent = xml({
        rss: [
          {
            _attr: { version: '2.0', 'xmlns:content': 'http://purl.org/rss/1.0/modules/content/' }
          },
          {
            channel: [
              { title: 'EasyWin - Esiti' },
              { link: process.env.FRONTEND_URL || 'https://easywin.it' },
              { description: 'Ultimi esiti pubblicati sulla piattaforma EasyWin' },
              { language: 'it-it' },
              { lastBuildDate: new Date().toUTCString() },
              ...items
            ]
          }
        ]
      });

      reply.type('application/rss+xml; charset=utf-8');
      return rssContent;
    } catch (err) {
      fastify.log.error({ err: err.message }, 'RSS esiti error');
      return reply.status(500).send({ error: 'Errore generazione RSS' });
    }
  });

  /**
   * GET /api/pubblico/rss/bandi/:codice_provincia
   * RSS feed filtered by province
   */
  fastify.get('/rss/bandi/:codice_provincia', async (request, reply) => {
    try {
      const { codice_provincia } = request.params;

      const result = await query(
        `SELECT
          b."id_bando" AS id,
          b."Titolo" AS titolo,
          b."DataPubblicazione" AS data_pubblicazione,
          COALESCE(s."Nome", b."Stazione") AS stazione,
          b."Regione" AS provincia,
          b."ImportoSO" AS importo,
          b."CodiceCIG" AS codice_cig
         FROM bandi b
         LEFT JOIN stazioni s ON b."id_stazione" = s."id"
         WHERE b."Abilitato" = true AND b."Annullato" = false
           AND b."Regione" = $1
         ORDER BY b."DataPubblicazione" DESC
         LIMIT 50`,
        [codice_provincia]
      );

      const items = result.rows.map(r => ({
        item: [
          { title: r.titolo },
          { description: `Stazione: ${r.stazione}, Importo: ${r.importo ? Number(r.importo).toLocaleString('it-IT') + ' €' : 'N/A'}` },
          { pubDate: new Date(r.data_pubblicazione).toUTCString() },
          { link: `${process.env.FRONTEND_URL || 'https://easywin.it'}/bandi/${r.id}` },
          { guid: `bando-${r.id}` }
        ]
      }));

      const rssContent = xml({
        rss: [
          {
            _attr: { version: '2.0' }
          },
          {
            channel: [
              { title: `EasyWin - Bandi (${codice_provincia})` },
              { link: process.env.FRONTEND_URL || 'https://easywin.it' },
              { description: `Ultimi bandi in ${codice_provincia}` },
              { language: 'it-it' },
              { lastBuildDate: new Date().toUTCString() },
              ...items
            ]
          }
        ]
      });

      reply.type('application/rss+xml; charset=utf-8');
      return rssContent;
    } catch (err) {
      fastify.log.error({ err: err.message }, 'RSS bandi provincia error');
      return reply.status(500).send({ error: 'Errore generazione RSS' });
    }
  });

  /**
   * GET /api/pubblico/rss/esiti/:codice_provincia
   * RSS feed filtered by province
   */
  fastify.get('/rss/esiti/:codice_provincia', async (request, reply) => {
    try {
      const { codice_provincia } = request.params;

      const result = await query(
        `SELECT
          g."id" AS id,
          g."Titolo" AS titolo,
          g."Data" AS data,
          COALESCE(s."Nome", g."Stazione") AS stazione,
          g."Regione" AS provincia,
          g."Importo" AS importo
         FROM gare g
         LEFT JOIN stazioni s ON g."id_stazione" = s."id"
         WHERE g."Abilitato" = true AND g."Annullato" = false
           AND g."Regione" = $1
         ORDER BY g."Data" DESC
         LIMIT 50`,
        [codice_provincia]
      );

      const items = result.rows.map(r => ({
        item: [
          { title: r.titolo },
          { description: `Stazione: ${r.stazione}, Importo: ${r.importo ? Number(r.importo).toLocaleString('it-IT') + ' €' : 'N/A'}` },
          { pubDate: new Date(r.data).toUTCString() },
          { link: `${process.env.FRONTEND_URL || 'https://easywin.it'}/esiti/${r.id}` },
          { guid: `esito-${r.id}` }
        ]
      }));

      const rssContent = xml({
        rss: [
          {
            _attr: { version: '2.0' }
          },
          {
            channel: [
              { title: `EasyWin - Esiti (${codice_provincia})` },
              { link: process.env.FRONTEND_URL || 'https://easywin.it' },
              { description: `Ultimi esiti in ${codice_provincia}` },
              { language: 'it-it' },
              { lastBuildDate: new Date().toUTCString() },
              ...items
            ]
          }
        ]
      });

      reply.type('application/rss+xml; charset=utf-8');
      return rssContent;
    } catch (err) {
      fastify.log.error({ err: err.message }, 'RSS esiti provincia error');
      return reply.status(500).send({ error: 'Errore generazione RSS' });
    }
  });

  // ============================================================
  // PASSWORD RECOVERY
  // ============================================================

  /**
   * POST /api/pubblico/recupera-password
   * Send password recovery email
   */
  fastify.post('/recupera-password', async (request, reply) => {
    try {
      const { email } = request.body || {};

      if (!email) {
        return reply.status(400).send({ error: 'Email richiesta' });
      }

      // Find user by email
      const userResult = await query(
        `SELECT "UserName", "Email", "FirstName" FROM users WHERE "Email" = $1 LIMIT 1`,
        [email]
      );

      if (userResult.rows.length === 0) {
        // Don't reveal if email exists
        return { message: 'Se l\'email è registrata, riceverai un link per il reset della password' };
      }

      const user = userResult.rows[0];

      // Generate reset token (valid for 24 hours)
      const resetToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      // Store token in database
      await query(
        `INSERT INTO password_reset_tokens (token, "UserName", expires_at, created_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (token) DO UPDATE SET expires_at = $3, created_at = NOW()`,
        [resetToken, user.UserName, expiresAt]
      );

      // Send email
      const resetLink = `${process.env.FRONTEND_URL || 'https://easywin.it'}/reset-password?token=${resetToken}`;
      const htmlBody = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #333; padding: 20px; text-align: center;">
            <h1 style="color: #F5C518; font-family: 'Brush Script MT', cursive; margin: 0;">EasyWin</h1>
          </div>
          <div style="padding: 24px; background: #fff;">
            <p>Caro ${user.FirstName || 'Utente'},</p>
            <p>Hai richiesto il reset della password. Clicca il link sottostante per procedere:</p>
            <p><a href="${resetLink}" style="background: #F5C518; color: #333; padding: 12px 24px; border-radius: 4px; text-decoration: none; display: inline-block; font-weight: bold;">Reset Password</a></p>
            <p style="color: #666; font-size: 12px;">Questo link è valido per 24 ore. Se non hai richiesto il reset, ignora questo messaggio.</p>
          </div>
          <div style="background: #f5f5f5; padding: 12px; text-align: center; font-size: 11px; color: #999;">
            Edra Servizi s.r.l. - Genova | EasyWin Platform
          </div>
        </div>
      `;

      await sendEmail(email, 'EasyWin - Reset Password', htmlBody);

      return { message: 'Se l\'email è registrata, riceverai un link per il reset della password' };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'Password recovery error');
      return reply.status(500).send({ error: 'Errore nel processo di recovery' });
    }
  });

  /**
   * GET /api/pubblico/verifica-token/:token
   * Check if reset token is still valid
   */
  fastify.get('/verifica-token/:token', async (request, reply) => {
    try {
      const { token } = request.params;

      const result = await query(
        `SELECT "UserName", expires_at FROM password_reset_tokens
         WHERE token = $1 AND expires_at > NOW()
         LIMIT 1`,
        [token]
      );

      if (result.rows.length === 0) {
        return reply.status(400).send({ error: 'Token non valido o scaduto' });
      }

      return { valid: true, message: 'Token valido' };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'Token verification error');
      return reply.status(500).send({ error: 'Errore nella verifica del token' });
    }
  });

  /**
   * POST /api/pubblico/reset-password
   * Reset password using token
   */
  fastify.post('/reset-password', async (request, reply) => {
    try {
      const { token, nuova_password } = request.body || {};

      if (!token || !nuova_password) {
        return reply.status(400).send({ error: 'Token e password richiesti' });
      }

      // Validate token
      const tokenResult = await query(
        `SELECT "UserName", expires_at FROM password_reset_tokens
         WHERE token = $1 AND expires_at > NOW()
         LIMIT 1`,
        [token]
      );

      if (tokenResult.rows.length === 0) {
        return reply.status(400).send({ error: 'Token non valido o scaduto' });
      }

      const username = tokenResult.rows[0].UserName;

      // Hash new password
      const bcrypt = (await import('bcryptjs')).default;
      const hashedPassword = await bcrypt.hash(nuova_password, 10);

      // Update user password
      await query(
        `UPDATE users SET "PasswordHash" = $1 WHERE "UserName" = $2`,
        [hashedPassword, username]
      );

      // Delete used token
      await query(
        `DELETE FROM password_reset_tokens WHERE token = $1`,
        [token]
      );

      return { message: 'Password aggiornata con successo' };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'Password reset error');
      return reply.status(500).send({ error: 'Errore nel reset della password' });
    }
  });

  // ============================================================
  // NEWSLETTER UNSUBSCRIBE
  // ============================================================

  /**
   * GET /api/pubblico/disabilita-newsletter
   * Unsubscribe from newsletter using email and token
   */
  fastify.get('/disabilita-newsletter', async (request, reply) => {
    try {
      const { email, token } = request.query;

      if (!email || !token) {
        return reply.status(400).send({ error: 'Email e token richiesti' });
      }

      // Validate token (hash of email + secret)
      const secret = process.env.NEWSLETTER_SECRET || 'easywin-secret';
      const expectedToken = crypto.createHash('sha256').update(email + secret).digest('hex');

      if (token !== expectedToken) {
        return reply.status(400).send({ error: 'Token non valido' });
      }

      // Update user
      await query(
        `UPDATE users SET "NewsletterEnabled" = false WHERE "Email" = $1`,
        [email]
      );

      return { message: 'Iscrizione alla newsletter disabilitata' };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'Unsubscribe error');
      return reply.status(500).send({ error: 'Errore nella disabilitazione' });
    }
  });

  /**
   * POST /api/pubblico/riabilita-newsletter
   * Re-enable newsletter subscription
   */
  fastify.post('/riabilita-newsletter', async (request, reply) => {
    try {
      const { email } = request.body || {};

      if (!email) {
        return reply.status(400).send({ error: 'Email richiesta' });
      }

      const result = await query(
        `UPDATE users SET "NewsletterEnabled" = true WHERE "Email" = $1
         RETURNING "Email"`,
        [email]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ error: 'Email non trovata' });
      }

      return { message: 'Iscrizione alla newsletter riabilitata' };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'Re-enable newsletter error');
      return reply.status(500).send({ error: 'Errore nella riabilitazione' });
    }
  });

  // ============================================================
  // GEOLOCATION
  // ============================================================

  /**
   * GET /api/pubblico/ultimi-bandi
   * Latest bandi near coordinates (using Haversine formula)
   */
  fastify.get('/ultimi-bandi', async (request, reply) => {
    try {
      const { lat, lon, raggio_km = 50, limit = 20 } = request.query;

      if (!lat || !lon) {
        return reply.status(400).send({ error: 'Lat e lon richiesti' });
      }

      const latitude = parseFloat(lat);
      const longitude = parseFloat(lon);
      const radius = parseFloat(raggio_km);

      // Haversine formula for distance calculation
      const result = await query(
        `SELECT
          b."id_bando" AS id,
          b."Titolo" AS titolo,
          b."DataPubblicazione" AS data_pubblicazione,
          COALESCE(s."Nome", b."Stazione") AS stazione,
          b."Regione" AS provincia,
          b."ImportoSO" AS importo,
          b."CodiceCIG" AS codice_cig,
          COALESCE(s."Latitudine", 0) AS lat,
          COALESCE(s."Longitudine", 0) AS lon,
          (6371 * acos(cos(radians($1)) * cos(radians(COALESCE(s."Latitudine", 0))) *
           cos(radians(COALESCE(s."Longitudine", 0)) - radians($2)) +
           sin(radians($1)) * sin(radians(COALESCE(s."Latitudine", 0))))) AS distanza_km
         FROM bandi b
         LEFT JOIN stazioni s ON b."id_stazione" = s."id"
         WHERE b."Abilitato" = true AND b."Annullato" = false
           AND (6371 * acos(cos(radians($1)) * cos(radians(COALESCE(s."Latitudine", 0))) *
           cos(radians(COALESCE(s."Longitudine", 0)) - radians($2)) +
           sin(radians($1)) * sin(radians(COALESCE(s."Latitudine", 0))))) <= $3
         ORDER BY distanza_km ASC
         LIMIT $4`,
        [latitude, longitude, radius, limit]
      );

      return {
        count: result.rows.length,
        bandi: result.rows.map(r => ({
          id: r.id,
          titolo: r.titolo,
          data_pubblicazione: r.data_pubblicazione,
          stazione: r.stazione,
          provincia: r.provincia,
          importo: r.importo,
          distanza_km: parseFloat(r.distanza_km).toFixed(2)
        }))
      };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'Geolocation bandi error');
      return reply.status(500).send({ error: 'Errore nella ricerca geolocalizzata' });
    }
  });

  /**
   * GET /api/pubblico/ultimi-esiti
   * Latest esiti near coordinates (using Haversine formula)
   */
  fastify.get('/ultimi-esiti', async (request, reply) => {
    try {
      const { lat, lon, raggio_km = 50, limit = 20 } = request.query;

      if (!lat || !lon) {
        return reply.status(400).send({ error: 'Lat e lon richiesti' });
      }

      const latitude = parseFloat(lat);
      const longitude = parseFloat(lon);
      const radius = parseFloat(raggio_km);

      const result = await query(
        `SELECT
          g."id" AS id,
          g."Titolo" AS titolo,
          g."Data" AS data,
          COALESCE(s."Nome", g."Stazione") AS stazione,
          g."Regione" AS provincia,
          g."Importo" AS importo,
          COALESCE(s."Latitudine", 0) AS lat,
          COALESCE(s."Longitudine", 0) AS lon,
          (6371 * acos(cos(radians($1)) * cos(radians(COALESCE(s."Latitudine", 0))) *
           cos(radians(COALESCE(s."Longitudine", 0)) - radians($2)) +
           sin(radians($1)) * sin(radians(COALESCE(s."Latitudine", 0))))) AS distanza_km
         FROM gare g
         LEFT JOIN stazioni s ON g."id_stazione" = s."id"
         WHERE g."Abilitato" = true AND g."Annullato" = false
           AND (6371 * acos(cos(radians($1)) * cos(radians(COALESCE(s."Latitudine", 0))) *
           cos(radians(COALESCE(s."Longitudine", 0)) - radians($2)) +
           sin(radians($1)) * sin(radians(COALESCE(s."Latitudine", 0))))) <= $3
         ORDER BY distanza_km ASC
         LIMIT $4`,
        [latitude, longitude, radius, limit]
      );

      return {
        count: result.rows.length,
        esiti: result.rows.map(r => ({
          id: r.id,
          titolo: r.titolo,
          data: r.data,
          stazione: r.stazione,
          provincia: r.provincia,
          importo: r.importo,
          distanza_km: parseFloat(r.distanza_km).toFixed(2)
        }))
      };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'Geolocation esiti error');
      return reply.status(500).send({ error: 'Errore nella ricerca geolocalizzata' });
    }
  });

  // ============================================================
  // SERVICE PAGES (CONTENT)
  // ============================================================

  /**
   * GET /api/pubblico/pagine/:slug
   * Get content page by slug
   */
  fastify.get('/pagine/:slug', async (request, reply) => {
    try {
      const { slug } = request.params;

      // Validate slug to prevent SQL injection
      const validSlugs = ['apertura-buste', 'on-demand', 'formazione', 'consulenza', 'software', 'assistenza'];
      if (!validSlugs.includes(slug)) {
        return reply.status(404).send({ error: 'Pagina non trovata' });
      }

      const result = await query(
        `SELECT titolo, contenuto_html, meta_description FROM pagine_pubbliche
         WHERE slug = $1 LIMIT 1`,
        [slug]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ error: 'Pagina non trovata' });
      }

      const page = result.rows[0];
      return {
        slug,
        titolo: page.titolo,
        contenuto_html: page.contenuto_html,
        meta_description: page.meta_description
      };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'Service page error');
      return reply.status(500).send({ error: 'Errore nel caricamento della pagina' });
    }
  });

  // ============================================================
  // CONTACT FORM
  // ============================================================

  /**
   * POST /api/pubblico/contatti
   * Submit contact form
   */
  fastify.post('/contatti', async (request, reply) => {
    try {
      const { nome, email, telefono, oggetto, messaggio, newsletter } = request.body || {};

      if (!nome || !email || !oggetto || !messaggio) {
        return reply.status(400).send({ error: 'Nome, email, oggetto e messaggio richiesti' });
      }

      // Store contact message
      await query(
        `INSERT INTO contatti (nome, email, telefono, oggetto, messaggio, data_invio)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [nome, email, telefono || null, oggetto, messaggio]
      );

      // If newsletter requested, add to newsletter
      if (newsletter === true) {
        await query(
          `INSERT INTO newsletter (email, data_iscrizione)
           VALUES ($1, NOW())
           ON CONFLICT (email) DO UPDATE SET data_iscrizione = NOW()`,
          [email]
        );
      }

      // Send notification email to admin
      const adminEmail = process.env.ADMIN_EMAIL || 'admin@easywin.it';
      const htmlBody = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #333; padding: 20px; text-align: center;">
            <h1 style="color: #F5C518; font-family: 'Brush Script MT', cursive; margin: 0;">EasyWin</h1>
          </div>
          <div style="padding: 24px; background: #fff;">
            <p><strong>Nuovo messaggio di contatto:</strong></p>
            <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
              <tr><td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold; width: 100px;">Nome</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${nome}</td></tr>
              <tr><td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">Email</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${email}</td></tr>
              <tr><td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">Telefono</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${telefono || '-'}</td></tr>
              <tr><td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">Oggetto</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${oggetto}</td></tr>
              <tr><td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">Newsletter</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${newsletter ? 'Sì' : 'No'}</td></tr>
            </table>
            <p><strong>Messaggio:</strong></p>
            <p style="background: #f5f5f5; padding: 12px; border-radius: 4px;">${messaggio.replace(/\n/g, '<br>')}</p>
          </div>
        </div>
      `;

      await sendEmail(adminEmail, `EasyWin - Contatto da ${nome}`, htmlBody);

      return { message: 'Messaggio inviato con successo. Ti contatteremo a breve.' };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'Contact form error');
      return reply.status(500).send({ error: 'Errore nell\'invio del messaggio' });
    }
  });

  // ============================================================
  // PUBLIC STATISTICS
  // ============================================================

  /**
   * GET /api/pubblico/statistiche
   * Public statistics (enabled/non-deleted items only)
   */
  fastify.get('/statistiche', async (request, reply) => {
    try {
      const bandiResult = await query(
        `SELECT COUNT(*) as count FROM bandi WHERE "Abilitato" = true AND "Annullato" = false`,
        []
      );

      const esitiResult = await query(
        `SELECT COUNT(*) as count FROM gare WHERE "Abilitato" = true AND "Annullato" = false`,
        []
      );

      const stazioniResult = await query(
        `SELECT COUNT(*) as count FROM stazioni WHERE "Abilitato" = true AND "Annullato" = false`,
        []
      );

      const aziendResult = await query(
        `SELECT COUNT(*) as count FROM aziende WHERE "Abilitato" = true AND "Annullato" = false`,
        []
      );

      return {
        total_bandi: parseInt(bandiResult.rows[0].count),
        total_esiti: parseInt(esitiResult.rows[0].count),
        total_stazioni: parseInt(stazioniResult.rows[0].count),
        total_aziende: parseInt(aziendResult.rows[0].count),
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'Statistics error');
      return reply.status(500).send({ error: 'Errore nel caricamento delle statistiche' });
    }
  });
}
