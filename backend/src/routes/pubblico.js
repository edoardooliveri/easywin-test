import { query } from '../db/pool.js';
import { sendEmail } from '../services/email-service.js';
import crypto from 'crypto';

// Simple RSS XML builder (no external dependency)
function escapeXml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function buildRss(channelTitle, channelLink, channelDesc, items) {
  const itemsXml = items.map(item =>
    `    <item>
      <title>${escapeXml(item.title)}</title>
      <description>${escapeXml(item.description)}</description>
      <pubDate>${item.pubDate}</pubDate>
      <link>${escapeXml(item.link)}</link>
      <guid>${escapeXml(item.guid)}</guid>
    </item>`
  ).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(channelTitle)}</title>
    <link>${escapeXml(channelLink)}</link>
    <description>${escapeXml(channelDesc)}</description>
    <language>it-it</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${itemsXml}
  </channel>
</rss>`;
}

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
          b.id AS id,
          b.titolo AS titolo,
          b.data_pubblicazione AS data_pubblicazione,
          COALESCE(s.nome, '') AS stazione,
          p.nome AS provincia,
          b.importo_so AS importo,
          b.codice_cig AS codice_cig
         FROM bandi b
         LEFT JOIN stazioni s ON b.id_stazione = s.id
         LEFT JOIN province p ON s.id_provincia = p.id
         WHERE b.annullato IS NOT TRUE
         ORDER BY b.data_pubblicazione DESC
         LIMIT 50`,
        []
      );

      const frontUrl = process.env.FRONTEND_URL || 'https://easywin.it';
      const items = result.rows.map(r => ({
        title: r.titolo,
        description: `Stazione: ${r.stazione}, Importo: ${r.importo ? Number(r.importo).toLocaleString('it-IT') + ' €' : 'N/A'}, CIG: ${r.codice_cig || 'N/A'}`,
        pubDate: new Date(r.data_pubblicazione).toUTCString(),
        link: `${frontUrl}/bandi/${r.id}`,
        guid: `bando-${r.id}`
      }));

      const rssContent = buildRss('EasyWin - Bandi', frontUrl, 'Ultimi bandi pubblicati sulla piattaforma EasyWin', items);
      reply.type('application/rss+xml; charset=utf-8');
      return rssContent;
    } catch (err) {
      fastify.log.error({ err: err.message, stack: err.stack }, 'RSS bandi error');
      return reply.status(500).send({ error: 'Errore generazione RSS', detail: err.message });
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
          g.id AS id,
          g.titolo AS titolo,
          g.data AS data,
          COALESCE(s.nome, '') AS stazione,
          p.nome AS provincia,
          g.importo AS importo,
          (SELECT a.ragione_sociale FROM dettaglio_gara dg JOIN aziende a ON dg.id_azienda = a.id WHERE dg.id_gara = g.id AND dg.vincitrice = true LIMIT 1) AS vincitore
         FROM gare g
         LEFT JOIN stazioni s ON g.id_stazione = s.id
         LEFT JOIN province p ON s.id_provincia = p.id
         WHERE g.annullato IS NOT TRUE
         ORDER BY g.data DESC
         LIMIT 50`,
        []
      );

      const frontUrl = process.env.FRONTEND_URL || 'https://easywin.it';
      const items = result.rows.map(r => ({
        title: r.titolo,
        description: `Stazione: ${r.stazione}, Importo: ${r.importo ? Number(r.importo).toLocaleString('it-IT') + ' €' : 'N/A'}, Vincitore: ${r.vincitore || 'Da definire'}`,
        pubDate: new Date(r.data).toUTCString(),
        link: `${frontUrl}/esiti/${r.id}`,
        guid: `esito-${r.id}`
      }));

      const rssContent = buildRss('EasyWin - Esiti', frontUrl, 'Ultimi esiti pubblicati sulla piattaforma EasyWin', items);
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
          b.id AS id,
          b.titolo AS titolo,
          b.data_pubblicazione AS data_pubblicazione,
          COALESCE(s.nome, '') AS stazione,
          p.nome AS provincia,
          b.importo_so AS importo,
          b.codice_cig AS codice_cig
         FROM bandi b
         LEFT JOIN stazioni s ON b.id_stazione = s.id
         LEFT JOIN province p ON s.id_provincia = p.id
         WHERE b.annullato IS NOT TRUE
           AND p.sigla = $1
         ORDER BY b.data_pubblicazione DESC
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
          g.id AS id,
          g.titolo AS titolo,
          g.data AS data,
          COALESCE(s.nome, '') AS stazione,
          p.nome AS provincia,
          g.importo AS importo
         FROM gare g
         LEFT JOIN stazioni s ON g.id_stazione = s.id
         LEFT JOIN province p ON s.id_provincia = p.id
         WHERE g.annullato IS NOT TRUE
           AND p.sigla = $1
         ORDER BY g.data DESC
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
        `SELECT username, email, first_name FROM users WHERE email = $1 LIMIT 1`,
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
        `INSERT INTO password_reset_tokens (token, username, expires_at, created_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (token) DO UPDATE SET expires_at = $3, created_at = NOW()`,
        [resetToken, user.username, expiresAt]
      );

      // Send email
      const resetLink = `${process.env.FRONTEND_URL || 'https://easywin.it'}/reset-password?token=${resetToken}`;
      const htmlBody = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #333; padding: 20px; text-align: center;">
            <h1 style="color: #F5C518; font-family: 'Brush Script MT', cursive; margin: 0;">EasyWin</h1>
          </div>
          <div style="padding: 24px; background: #fff;">
            <p>Caro ${user.first_name || 'Utente'},</p>
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
        `SELECT username, expires_at FROM password_reset_tokens
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
        `SELECT username, expires_at FROM password_reset_tokens
         WHERE token = $1 AND expires_at > NOW()
         LIMIT 1`,
        [token]
      );

      if (tokenResult.rows.length === 0) {
        return reply.status(400).send({ error: 'Token non valido o scaduto' });
      }

      const username = tokenResult.rows[0].username;

      // Hash new password
      const bcrypt = (await import('bcryptjs')).default;
      const hashedPassword = await bcrypt.hash(nuova_password, 10);

      // Update user password
      await query(
        `UPDATE users SET password_hash = $1 WHERE username = $2`,
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
        `UPDATE users SET newsletter_enabled = false WHERE email = $1`,
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
        `UPDATE users SET newsletter_enabled = true WHERE email = $1
         RETURNING email`,
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
          b.id AS id,
          b.titolo AS titolo,
          b.data_pubblicazione AS data_pubblicazione,
          COALESCE(s.nome, '') AS stazione,
          p.nome AS provincia,
          b.importo_so AS importo,
          b.codice_cig AS codice_cig,
          COALESCE(p.lat, 0) AS lat,
          COALESCE(p.lng, 0) AS lon,
          (6371 * acos(cos(radians($1)) * cos(radians(COALESCE(p.lat, 0))) *
           cos(radians(COALESCE(p.lng, 0)) - radians($2)) +
           sin(radians($1)) * sin(radians(COALESCE(p.lat, 0))))) AS distanza_km
         FROM bandi b
         LEFT JOIN stazioni s ON b.id_stazione = s.id
         LEFT JOIN province p ON s.id_provincia = p.id
         WHERE b.annullato IS NOT TRUE
           AND (6371 * acos(cos(radians($1)) * cos(radians(COALESCE(p.lat, 0))) *
           cos(radians(COALESCE(p.lng, 0)) - radians($2)) +
           sin(radians($1)) * sin(radians(COALESCE(p.lat, 0))))) <= $3
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
          g.id AS id,
          g.titolo AS titolo,
          g.data AS data,
          COALESCE(s.nome, '') AS stazione,
          p.nome AS provincia,
          g.importo AS importo,
          COALESCE(p.lat, 0) AS lat,
          COALESCE(p.lng, 0) AS lon,
          (6371 * acos(cos(radians($1)) * cos(radians(COALESCE(p.lat, 0))) *
           cos(radians(COALESCE(p.lng, 0)) - radians($2)) +
           sin(radians($1)) * sin(radians(COALESCE(p.lat, 0))))) AS distanza_km
         FROM gare g
         LEFT JOIN stazioni s ON g.id_stazione = s.id
         LEFT JOIN province p ON s.id_provincia = p.id
         WHERE g.annullato IS NOT TRUE
           AND (6371 * acos(cos(radians($1)) * cos(radians(COALESCE(p.lat, 0))) *
           cos(radians(COALESCE(p.lng, 0)) - radians($2)) +
           sin(radians($1)) * sin(radians(COALESCE(p.lat, 0))))) <= $3
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

      // Send notification email to info + paolo
      const contactRecipients = (process.env.CONTACT_EMAILS || 'info@easywin.it,paolo@easywin.it').split(',').map(e => e.trim());
      const siteUrl = process.env.SITE_URL || 'https://easywin.it';
      const now = new Date();
      const dataOra = now.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }) + ', ore ' + now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

      const htmlBody = `
        <div style="font-family: 'Comfortaa', Arial, sans-serif; max-width: 620px; margin: 0 auto; background: #fff; border-radius: 28px; overflow: hidden; box-shadow: 0 8px 40px rgba(0,0,0,0.12);">

          <!-- HEADER con immagine sfondo -->
          <div style="background: url('${siteUrl}/email-header-bg.png') center/cover no-repeat; border-radius: 28px 28px 0 0; overflow: hidden;">
            <div style="background: linear-gradient(135deg, rgba(30,45,61,0.80), rgba(30,45,61,0.55)); padding: 32px; display: flex; align-items: center; justify-content: space-between;">
              <img src="${siteUrl}/logo.png" alt="easyWin" style="height: 56px; flex-shrink: 0;" />
              <span style="background: linear-gradient(135deg, #F5C518, #FF8C00); color: #1E2D3D; font-size: 11px; font-weight: 700; padding: 8px 20px; border-radius: 50px; text-transform: uppercase; letter-spacing: 0.5px; font-family: 'Comfortaa', Arial, sans-serif;">Nuovo Contatto</span>
            </div>
          </div>

          <!-- BODY -->
          <div style="padding: 32px;">
            <h1 style="font-family: 'Comfortaa', Arial, sans-serif; font-size: 22px; font-weight: 700; color: #1E2D3D; margin: 0 0 6px;">Hai ricevuto un nuovo messaggio</h1>
            <p style="font-family: 'Comfortaa', Arial, sans-serif; font-size: 13px; color: #999; margin: 0 0 28px;">Dal form di contatto su easywin.it — ${dataOra}</p>

            <!-- Tabella dati arrotondata -->
            <div style="background: #F5F7FA; border-radius: 20px; overflow: hidden; margin-bottom: 28px;">
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 16px 20px; border-bottom: 1px solid #e8ecf0; width: 110px; font-size: 11px; font-weight: 700; color: #999; text-transform: uppercase; letter-spacing: 0.6px; font-family: 'Comfortaa', Arial, sans-serif; vertical-align: middle;">Nome</td>
                  <td style="padding: 16px 20px; border-bottom: 1px solid #e8ecf0; font-size: 15px; color: #333; font-family: 'Comfortaa', Arial, sans-serif;">${nome}</td>
                </tr>
                <tr>
                  <td style="padding: 16px 20px; border-bottom: 1px solid #e8ecf0; font-size: 11px; font-weight: 700; color: #999; text-transform: uppercase; letter-spacing: 0.6px; font-family: 'Comfortaa', Arial, sans-serif; vertical-align: middle;">Email</td>
                  <td style="padding: 16px 20px; border-bottom: 1px solid #e8ecf0; font-size: 15px; font-family: 'Comfortaa', Arial, sans-serif;"><a href="mailto:${email}" style="color: #FF8C00; text-decoration: none; font-weight: 600;">${email}</a></td>
                </tr>
                <tr>
                  <td style="padding: 16px 20px; border-bottom: 1px solid #e8ecf0; font-size: 11px; font-weight: 700; color: #999; text-transform: uppercase; letter-spacing: 0.6px; font-family: 'Comfortaa', Arial, sans-serif; vertical-align: middle;">Telefono</td>
                  <td style="padding: 16px 20px; border-bottom: 1px solid #e8ecf0; font-size: 15px; color: #333; font-family: 'Comfortaa', Arial, sans-serif;">${telefono || '-'}</td>
                </tr>
                <tr>
                  <td style="padding: 16px 20px; font-size: 11px; font-weight: 700; color: #999; text-transform: uppercase; letter-spacing: 0.6px; font-family: 'Comfortaa', Arial, sans-serif; vertical-align: middle;">Newsletter</td>
                  <td style="padding: 16px 20px; font-size: 15px; color: #333; font-family: 'Comfortaa', Arial, sans-serif;">${newsletter ? '✅ Sì' : 'No'}</td>
                </tr>
              </table>
            </div>

            <!-- Messaggio -->
            <div style="font-family: 'Comfortaa', Arial, sans-serif; font-size: 11px; font-weight: 700; color: #999; text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 12px;">Messaggio</div>
            <div style="background: #F5F7FA; border-left: 4px solid #FF8C00; border-radius: 0 20px 20px 0; padding: 22px 24px; font-size: 14px; color: #444; line-height: 1.8; font-family: 'Comfortaa', Arial, sans-serif;">${messaggio.replace(/\n/g, '<br>')}</div>

            <!-- Bottone Rispondi -->
            <div style="text-align: center; margin-top: 28px;">
              <a href="mailto:${email}" style="display: inline-block; background: linear-gradient(135deg, #F5C518, #FF8C00); color: #1E2D3D; font-size: 14px; font-weight: 700; padding: 14px 36px; border-radius: 50px; text-decoration: none; font-family: 'Comfortaa', Arial, sans-serif; box-shadow: 0 4px 16px rgba(255,140,0,0.3);">↩ Rispondi a ${nome.split(' ')[0].split('(')[0].trim()}</a>
            </div>
          </div>

          <!-- FOOTER -->
          <div style="background: #1E2D3D; padding: 24px 32px; border-radius: 0 0 28px 28px;">
            <table style="width: 100%;">
              <tr>
                <td style="font-family: 'Comfortaa', Arial, sans-serif; font-size: 12px; color: rgba(255,255,255,0.6); line-height: 1.6;">
                  <strong style="color: rgba(255,255,255,0.85);">Edra Servizi s.r.l.</strong><br>
                  Via Malta 5/9, 16121 Genova<br>
                  Tel. 010.0982610
                </td>
                <td style="text-align: right; vertical-align: middle;">
                  <a href="https://www.facebook.com/EasyWinAppalti" style="display: inline-block; width: 32px; height: 32px; background: rgba(255,255,255,0.1); border-radius: 50%; text-align: center; line-height: 32px; color: #F5C518; text-decoration: none; font-size: 14px; margin-left: 6px;">f</a>
                  <a href="https://www.linkedin.com/company/easywin-appalti" style="display: inline-block; width: 32px; height: 32px; background: rgba(255,255,255,0.1); border-radius: 50%; text-align: center; line-height: 32px; color: #F5C518; text-decoration: none; font-size: 14px; margin-left: 6px;">in</a>
                </td>
              </tr>
            </table>
          </div>

        </div>
      `;

      // Send to all configured recipients
      for (const recipient of contactRecipients) {
        const result = await sendEmail(recipient, `EasyWin - Contatto da ${nome}: ${oggetto}`, htmlBody, { replyTo: email });
        fastify.log.info({ recipient, emailStatus: result.status, reason: result.reason || null }, 'Contact form email result');
      }

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
        `SELECT COUNT(*) as count FROM bandi WHERE annullato IS NOT TRUE`,
        []
      );

      const esitiResult = await query(
        `SELECT COUNT(*) as count FROM gare WHERE annullato = false`,
        []
      );

      const stazioniResult = await query(
        `SELECT COUNT(*) as count FROM stazioni WHERE attivo = true`,
        []
      );

      const aziendResult = await query(
        `SELECT COUNT(*) as count FROM aziende WHERE attivo = true`,
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
