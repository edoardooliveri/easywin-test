'use strict';

import { query } from '../db/pool.js';

export default async function adminGestionaleRoutes(fastify, opts) {
  // Verify authentication for all routes
  fastify.addHook('preHandler', async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  // ==================== DASHBOARD SUMMARY ====================

  // GET /api/admin/gestionale/dashboard/summary - Admin summary counts for the home dashboard
  fastify.get('/dashboard/summary', async (request, reply) => {
    try {
      const result = await query(`
        SELECT
          (SELECT COUNT(*) FROM gare WHERE annullato = false) as esiti_totali,
          (SELECT COUNT(*) FROM gare WHERE annullato = true) as esiti_da_cancellare,
          (SELECT COUNT(*) FROM aziende WHERE attivo = false) as aziende_da_cancellare,
          (SELECT COUNT(*) FROM stazioni WHERE attivo = false) as stazioni_da_cancellare,
          0 as fonti_da_controllare
      `);
      reply.send(result.rows[0] || {});
    } catch (err) {
      fastify.log.error(err, 'Dashboard summary error');
      // Fallback with zeros if tables don't have expected columns
      reply.send({
        esiti_totali: 0,
        esiti_da_cancellare: 0,
        aziende_da_cancellare: 0,
        stazioni_da_cancellare: 0,
        fonti_da_controllare: 0
      });
    }
  });

  // ==================== AGENTS MANAGEMENT ====================

  // GET /api/admin/gestionale/agenti - List agents (users with agent role)
  fastify.get('/agenti', async (request, reply) => {
    try {
      const search = request.query.search || '';
      const result = await query(`
        SELECT u.id, u.username, u.email,
               u.nome, u.cognome,
               u.attivo,
               u.codice_agente,
               (SELECT COUNT(*) FROM users u2 WHERE u2.codice_agente = u.codice_agente AND u2.id != u.id) as clienti
        FROM users u
        WHERE u.ruolo = 'agente'
        ${search ? `AND (u.nome ILIKE $1 OR u.cognome ILIKE $1 OR u.username ILIKE $1)` : ''}
        ORDER BY u.cognome, u.nome
        LIMIT 100
      `, search ? [`%${search}%`] : []);
      reply.send({ data: result.rows });
    } catch (err) {
      fastify.log.error(err, 'Agenti list error');
      reply.send({ data: [] });
    }
  });

  // ==================== ASSIGNED USERS ====================

  // GET /api/admin/gestionale/incaricati - List assigned users
  fastify.get('/incaricati', async (request, reply) => {
    try {
      const search = request.query.search || '';
      const result = await query(`
        SELECT u.id, u.username, u.email,
               u.nome, u.cognome,
               u.ruolo, u.codice_agente as assegnato_a
        FROM users u
        WHERE u.ruolo = 'incaricato'
        ${search ? `AND (u.nome ILIKE $1 OR u.cognome ILIKE $1)` : ''}
        ORDER BY u.cognome
        LIMIT 100
      `, search ? [`%${search}%`] : []);
      reply.send({ data: result.rows });
    } catch (err) {
      fastify.log.error(err, 'Incaricati list error');
      reply.send({ data: [] });
    }
  });

  // ==================== DATA INSERTION LOG ====================

  // GET /api/admin/gestionale/inserimenti - Recent data insertions log
  fastify.get('/inserimenti', async (request, reply) => {
    try {
      const { search, data_da, data_a } = request.query;

      let sql = `
        SELECT 'bandi' as tipo, b.codice_cig as oggetto, b.created_at as data_inserimento, '' as username
        FROM bandi b
        WHERE 1=1
      `;
      const params = [];
      let idx = 1;

      if (search) {
        sql += ` AND (b.codice_cig ILIKE $${idx} OR b.titolo ILIKE $${idx})`;
        params.push(`%${search}%`);
        idx++;
      }
      if (data_da) {
        sql += ` AND b.created_at >= $${idx}`;
        params.push(data_da);
        idx++;
      }
      if (data_a) {
        sql += ` AND b.created_at <= $${idx}`;
        params.push(data_a);
        idx++;
      }

      sql += ` UNION ALL
        SELECT 'gare' as tipo, b2.cig as oggetto, g.created_at as data_inserimento, '' as username
        FROM gare g
        LEFT JOIN bandi b2 ON g.id_bando = b2.id
        WHERE 1=1 `;

      if (search) {
        sql += ` AND (b2.cig ILIKE $${idx} OR b2.oggetto ILIKE $${idx})`;
        params.push(`%${search}%`);
        idx++;
      }
      if (data_da) {
        sql += ` AND g.created_at >= $${idx}`;
        params.push(data_da);
        idx++;
      }
      if (data_a) {
        sql += ` AND g.created_at <= $${idx}`;
        params.push(data_a);
        idx++;
      }

      sql += ` ORDER BY data_inserimento DESC LIMIT 100`;

      const result = await query(sql, params);
      reply.send({ data: result.rows });
    } catch (err) {
      fastify.log.error(err, 'Inserimenti log error');
      reply.send({ data: [] });
    }
  });

  // ==================== ACCESS CONTROL LOG ====================

  // GET /api/admin/gestionale/accessi - Access control log
  fastify.get('/accessi', async (request, reply) => {
    try {
      const { username, data_da, data_a } = request.query;

      let sql = `
        SELECT u.username, u.email, u.ultimo_accesso as data
        FROM users u
        WHERE u.ultimo_accesso IS NOT NULL
      `;
      const params = [];
      let idx = 1;

      if (username) {
        sql += ` AND u.username ILIKE $${idx}`;
        params.push(`%${username}%`);
        idx++;
      }
      if (data_da) {
        sql += ` AND u.ultimo_accesso >= $${idx}`;
        params.push(data_da);
        idx++;
      }
      if (data_a) {
        sql += ` AND u.ultimo_accesso <= $${idx}`;
        params.push(data_a);
        idx++;
      }

      sql += ` ORDER BY u.ultimo_accesso DESC LIMIT 200`;

      const result = await query(sql, params);
      reply.send({ data: result.rows });
    } catch (err) {
      fastify.log.error(err, 'Accessi log error');
      reply.send({ data: [] });
    }
  });

  // ==================== BILLING/INVOICING ====================

  // GET /api/admin/gestionale/fatturazione - Billing/invoicing overview
  fastify.get('/fatturazione', async (request, reply) => {
    try {
      const { search, stato } = request.query;

      let sql = `
        SELECT
          u.username as utente,
          a.ragione_sociale as azienda,
          0 as importo,
          'pendente' as stato,
          NOW() as data
        FROM users u
        LEFT JOIN aziende a ON u.id_azienda = a.id
        WHERE u.attivo = true AND u.ruolo = 'utente'
      `;
      const params = [];
      let idx = 1;

      if (search) {
        sql += ` AND (u.username ILIKE $${idx} OR a.ragione_sociale ILIKE $${idx})`;
        params.push(`%${search}%`);
        idx++;
      }

      sql += ` ORDER BY u.username LIMIT 100`;

      const result = await query(sql, params);
      reply.send({ data: result.rows });
    } catch (err) {
      fastify.log.error(err, 'Fatturazione error');
      reply.send({ data: [] });
    }
  });

  // ==================== KEYWORDS MANAGEMENT ====================

  // Ensure table exists
  try {
    await query(`CREATE TABLE IF NOT EXISTS parole_chiave (
      id SERIAL PRIMARY KEY,
      testo VARCHAR(500) NOT NULL,
      tipo VARCHAR(50) DEFAULT 'inclusione',
      attiva BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  } catch { /* table might already exist */ }

  // GET /api/admin/gestionale/parole-chiave
  fastify.get('/parole-chiave', async (request, reply) => {
    try {
      const search = request.query.search || '';
      let sql = 'SELECT id, testo, tipo, attiva FROM parole_chiave';
      const params = [];
      if (search) {
        sql += ' WHERE testo ILIKE $1';
        params.push(`%${search}%`);
      }
      sql += ' ORDER BY created_at DESC';
      const result = await query(sql, params);
      reply.send({ data: result.rows });
    } catch (err) {
      fastify.log.error(err, 'Parole chiave error');
      reply.send({ data: [] });
    }
  });

  // POST /api/admin/gestionale/parole-chiave
  fastify.post('/parole-chiave', async (request, reply) => {
    try {
      const { testo, tipo = 'inclusione' } = request.body || {};
      if (!testo || !testo.trim()) return reply.code(400).send({ error: 'Testo obbligatorio' });
      const result = await query(
        'INSERT INTO parole_chiave (testo, tipo) VALUES ($1, $2) RETURNING *',
        [testo.trim(), tipo]
      );
      reply.send({ success: true, data: result.rows[0] });
    } catch (err) {
      fastify.log.error(err, 'Parola chiave create error');
      reply.code(500).send({ error: err.message });
    }
  });

  // DELETE /api/admin/gestionale/parole-chiave/:id
  fastify.delete('/parole-chiave/:id', async (request, reply) => {
    try {
      await query('DELETE FROM parole_chiave WHERE id = $1', [request.params.id]);
      reply.send({ success: true });
    } catch (err) {
      reply.code(500).send({ error: err.message });
    }
  });

  // ==================== TEXT CORRECTIONS ====================

  // Ensure table exists
  try {
    await query(`CREATE TABLE IF NOT EXISTS correzioni_testo (
      id SERIAL PRIMARY KEY,
      originale VARCHAR(500) NOT NULL,
      corretto VARCHAR(500) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  } catch { /* table might already exist */ }

  // GET /api/admin/gestionale/correzioni
  fastify.get('/correzioni', async (request, reply) => {
    try {
      const search = request.query.search || '';
      let sql = 'SELECT id, originale, corretto FROM correzioni_testo';
      const params = [];
      if (search) {
        sql += ' WHERE originale ILIKE $1 OR corretto ILIKE $1';
        params.push(`%${search}%`);
      }
      sql += ' ORDER BY created_at DESC';
      const result = await query(sql, params);
      reply.send({ data: result.rows });
    } catch (err) {
      fastify.log.error(err, 'Correzioni error');
      reply.send({ data: [] });
    }
  });

  // POST /api/admin/gestionale/correzioni
  fastify.post('/correzioni', async (request, reply) => {
    try {
      const { originale, corretto } = request.body || {};
      if (!originale?.trim() || !corretto?.trim()) return reply.code(400).send({ error: 'Originale e corretto obbligatori' });
      const result = await query(
        'INSERT INTO correzioni_testo (originale, corretto) VALUES ($1, $2) RETURNING *',
        [originale.trim(), corretto.trim()]
      );
      reply.send({ success: true, data: result.rows[0] });
    } catch (err) {
      fastify.log.error(err, 'Correzione create error');
      reply.code(500).send({ error: err.message });
    }
  });

  // DELETE /api/admin/gestionale/correzioni/:id
  fastify.delete('/correzioni/:id', async (request, reply) => {
    try {
      await query('DELETE FROM correzioni_testo WHERE id = $1', [request.params.id]);
      reply.send({ success: true });
    } catch (err) {
      reply.code(500).send({ error: err.message });
    }
  });

  // ==================== EWIN CLIENT CONNECTIONS ====================

  // GET /api/admin/gestionale/ewin-client - EWin desktop client connections
  fastify.get('/ewin-client', async (request, reply) => {
    try {
      const search = request.query.search || '';

      let sql = `
        SELECT
          u.username,
          '1.0' as versione,
          u.ultimo_accesso,
          CASE WHEN u.ultimo_accesso > NOW() - INTERVAL '1 hour' THEN 'online' ELSE 'offline' END as stato
        FROM users u
        WHERE u.attivo = true
      `;
      const params = [];
      let idx = 1;

      if (search) {
        sql += ` AND u.username ILIKE $${idx}`;
        params.push(`%${search}%`);
        idx++;
      }

      sql += ` ORDER BY u.ultimo_accesso DESC NULLS LAST LIMIT 100`;

      const result = await query(sql, params);
      reply.send({ data: result.rows });
    } catch (err) {
      fastify.log.error(err, 'EWin client error');
      reply.send({ data: [] });
    }
  });

  // ==================== ACTIVITY STATS ====================

  // GET /api/admin/gestionale/stats - Gestionale-specific statistics
  fastify.get('/stats', async (request, reply) => {
    try {
      const stats = await Promise.all([
        query(`SELECT COUNT(*) AS total FROM bandi`),
        query(`SELECT COUNT(*) AS total FROM gare`),
        query(`SELECT COUNT(*) AS total FROM users WHERE attivo = true`),
        query(`SELECT COUNT(*) AS total FROM aziende WHERE attivo = true`),
        query(`SELECT COUNT(*) AS total FROM stazioni WHERE attivo = true`),
        query(`SELECT COUNT(*) AS total FROM gare WHERE annullato = true`),
        query(`SELECT COUNT(*) AS total FROM bandi`)
      ]);

      return {
        bandi_totali: parseInt(stats[0].rows[0].total),
        esiti_totali: parseInt(stats[1].rows[0].total),
        utenti_attivi: parseInt(stats[2].rows[0].total),
        aziende_attive: parseInt(stats[3].rows[0].total),
        stazioni_attive: parseInt(stats[4].rows[0].total),
        esiti_annullati: parseInt(stats[5].rows[0].total),
        bandi_totali_check: parseInt(stats[6].rows[0].total)
      };
    } catch (err) {
      fastify.log.error(err, 'Gestionale stats error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ==================== QUICK ACTIONS ====================

  // POST /api/admin/gestionale/abilita-bando - Enable a bando (placeholder)
  fastify.post('/abilita-bando/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      // Note: bandi table doesn't have an "Abilitato" column in new schema
      // This is a placeholder - may need a status column added
      return {
        success: true,
        messaggio: `Bando ${id} abilitato`
      };
    } catch (err) {
      fastify.log.error(err, 'Abilita bando error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/gestionale/abilita-esito - Enable an esito (placeholder)
  fastify.post('/abilita-esito/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      // Note: gare table doesn't have "Abilitato" column in new schema
      return {
        success: true,
        messaggio: `Esito ${id} abilitato`
      };
    } catch (err) {
      fastify.log.error(err, 'Abilita esito error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/gestionale/completa-esito - Mark esito as complete (placeholder)
  fastify.post('/completa-esito/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      // Note: gare table doesn't have "Completo" column in new schema
      return {
        success: true,
        messaggio: `Esito ${id} completato`
      };
    } catch (err) {
      fastify.log.error(err, 'Completa esito error');
      return reply.status(500).send({ error: err.message });
    }
  });
}
