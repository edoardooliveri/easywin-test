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
          (SELECT COUNT(*) FROM gare WHERE "Completo" = false OR "Completo" IS NULL) as esiti_da_completare,
          (SELECT COUNT(*) FROM gare WHERE "Abilitato" = false OR "Abilitato" IS NULL) as esiti_da_abilitare,
          (SELECT COUNT(*) FROM gare WHERE "Eliminata" = true) as esiti_da_cancellare,
          (SELECT COUNT(*) FROM aziende WHERE "eliminata" = true) as aziende_da_cancellare,
          (SELECT COUNT(*) FROM stazioni WHERE "eliminata" = true) as stazioni_da_cancellare,
          (SELECT COUNT(*) FROM fonti_web WHERE "da_controllare" = true) as fonti_da_controllare
      `);
      reply.send(result.rows[0] || {});
    } catch (err) {
      fastify.log.error(err, 'Dashboard summary error');
      // Fallback with zeros if tables don't have expected columns
      reply.send({
        esiti_da_completare: 0,
        esiti_da_abilitare: 0,
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
        SELECT u."Username" as username, u."Email" as email,
               u."Nome" as nome, u."Cognome" as cognome,
               u."IsApproved" as attivo,
               (SELECT COUNT(*) FROM users u2 WHERE u2."Agente" = u."Username") as clienti
        FROM users u
        WHERE u."Ruolo" = 'Agente' OR u."Ruolo" = 'Agent'
        ${search ? `AND (u."Nome" ILIKE $1 OR u."Cognome" ILIKE $1 OR u."Username" ILIKE $1)` : ''}
        ORDER BY u."Cognome", u."Nome"
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
        SELECT u."Username" as username, u."Email" as email,
               u."Nome" as nome, u."Cognome" as cognome,
               u."Ruolo" as tipo, u."Agente" as assegnato_a
        FROM users u
        WHERE u."Ruolo" = 'Incaricato' OR u."IsApproved" = true
        ${search ? `AND (u."Nome" ILIKE $1 OR u."Cognome" ILIKE $1)` : ''}
        ORDER BY u."Cognome"
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

      // Try to get activity log - fallback if table doesn't exist
      let sql = `
        SELECT 'bandi' as tipo, "CIG" as oggetto, NOW() as data_inserimento, "CreatoDA" as username
        FROM bandi
        WHERE 1=1
      `;
      const params = [];
      let idx = 1;

      if (search) {
        sql += ` AND ("CIG" ILIKE $${idx} OR "Titolo" ILIKE $${idx})`;
        params.push(`%${search}%`);
        idx++;
      }
      if (data_da) {
        sql += ` AND "Data" >= $${idx}`;
        params.push(data_da);
        idx++;
      }
      if (data_a) {
        sql += ` AND "Data" <= $${idx}`;
        params.push(data_a);
        idx++;
      }

      sql += ` UNION ALL
        SELECT 'gare' as tipo, "CIG" as oggetto, NOW() as data_inserimento, "CreatoDA" as username
        FROM gare
        WHERE 1=1 `;

      if (search) {
        sql += ` AND ("CIG" ILIKE $${idx} OR "Oggetto" ILIKE $${idx})`;
        params.push(`%${search}%`);
        idx++;
      }
      if (data_da) {
        sql += ` AND "Data" >= $${idx}`;
        params.push(data_da);
        idx++;
      }
      if (data_a) {
        sql += ` AND "Data" <= $${idx}`;
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
        SELECT u."Username" as username, u."Email" as email, u."UltimoAccesso" as data
        FROM users u
        WHERE u."UltimoAccesso" IS NOT NULL
      `;
      const params = [];
      let idx = 1;

      if (username) {
        sql += ` AND u."Username" ILIKE $${idx}`;
        params.push(`%${username}%`);
        idx++;
      }
      if (data_da) {
        sql += ` AND u."UltimoAccesso" >= $${idx}`;
        params.push(data_da);
        idx++;
      }
      if (data_a) {
        sql += ` AND u."UltimoAccesso" <= $${idx}`;
        params.push(data_a);
        idx++;
      }

      sql += ` ORDER BY u."UltimoAccesso" DESC LIMIT 200`;

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

      // Placeholder query - table may not exist yet
      let sql = `
        SELECT
          u."Username" as utente,
          u."Company" as azienda,
          0 as importo,
          'pendente' as stato,
          NOW() as data
        FROM users u
        WHERE u."IsApproved" = true
      `;
      const params = [];
      let idx = 1;

      if (search) {
        sql += ` AND (u."Username" ILIKE $${idx} OR u."Company" ILIKE $${idx})`;
        params.push(`%${search}%`);
        idx++;
      }
      if (stato) {
        sql += ` AND $${idx} = '${stato}'`;
        idx++;
      }

      sql += ` ORDER BY u."Username" LIMIT 100`;

      const result = await query(sql, params);
      reply.send({ data: result.rows });
    } catch (err) {
      fastify.log.error(err, 'Fatturazione error');
      reply.send({ data: [] });
    }
  });

  // ==================== KEYWORDS MANAGEMENT ====================

  // GET /api/admin/gestionale/parole-chiave - Keywords management
  fastify.get('/parole-chiave', async (request, reply) => {
    try {
      const search = request.query.search || '';

      // Placeholder - keywords table may not exist
      const result = await query(`
        SELECT
          ROW_NUMBER() OVER (ORDER BY '') as id,
          '' as testo,
          'generico' as tipo,
          true as attiva
        LIMIT 0
      `);

      reply.send({ data: result.rows });
    } catch (err) {
      fastify.log.error(err, 'Parole chiave error');
      reply.send({ data: [] });
    }
  });

  // ==================== TEXT CORRECTIONS ====================

  // GET /api/admin/gestionale/correzioni - Text corrections
  fastify.get('/correzioni', async (request, reply) => {
    try {
      const search = request.query.search || '';

      // Placeholder - corrections table may not exist
      const result = await query(`
        SELECT
          ROW_NUMBER() OVER (ORDER BY '') as id,
          '' as originale,
          '' as corretto
        LIMIT 0
      `);

      reply.send({ data: result.rows });
    } catch (err) {
      fastify.log.error(err, 'Correzioni error');
      reply.send({ data: [] });
    }
  });

  // ==================== EWIN CLIENT CONNECTIONS ====================

  // GET /api/admin/gestionale/ewin-client - EWin desktop client connections
  fastify.get('/ewin-client', async (request, reply) => {
    try {
      const search = request.query.search || '';

      // Placeholder - ewin_clients table may not exist yet
      let sql = `
        SELECT
          u."Username" as username,
          '1.0' as versione,
          u."UltimoAccesso" as ultimo_accesso,
          CASE WHEN u."UltimoAccesso" > NOW() - INTERVAL '1 hour' THEN 'online' ELSE 'offline' END as stato
        FROM users u
        WHERE u."IsApproved" = true
      `;
      const params = [];
      let idx = 1;

      if (search) {
        sql += ` AND u."Username" ILIKE $${idx}`;
        params.push(`%${search}%`);
        idx++;
      }

      sql += ` ORDER BY u."UltimoAccesso" DESC LIMIT 100`;

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
        query(`SELECT COUNT(*) AS total FROM users WHERE "IsApproved" = true`),
        query(`SELECT COUNT(*) AS total FROM aziende WHERE "eliminata" IS NULL OR "eliminata" = false`),
        query(`SELECT COUNT(*) AS total FROM stazioni WHERE "eliminata" IS NULL OR "eliminata" = false`),
        query(`SELECT COUNT(*) AS total FROM gare WHERE "Completo" = false OR "Completo" IS NULL`),
        query(`SELECT COUNT(*) AS total FROM bandi WHERE "Abilitato" = false OR "Abilitato" IS NULL`)
      ]);

      return {
        bandi_totali: parseInt(stats[0].rows[0].total),
        esiti_totali: parseInt(stats[1].rows[0].total),
        utenti_attivi: parseInt(stats[2].rows[0].total),
        aziende_attive: parseInt(stats[3].rows[0].total),
        stazioni_attive: parseInt(stats[4].rows[0].total),
        esiti_incompleti: parseInt(stats[5].rows[0].total),
        bandi_da_abilitare: parseInt(stats[6].rows[0].total)
      };
    } catch (err) {
      fastify.log.error(err, 'Gestionale stats error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ==================== QUICK ACTIONS ====================

  // POST /api/admin/gestionale/abilita-bando - Enable a bando
  fastify.post('/abilita-bando/:id', async (request, reply) => {
    try {
      const { id } = request.params;

      await query(`
        UPDATE bandi
        SET "Abilitato" = true, "ModificatoDA" = $1
        WHERE "id" = $2
      `, [request.user.username, id]);

      return {
        success: true,
        messaggio: `Bando ${id} abilitato`
      };
    } catch (err) {
      fastify.log.error(err, 'Abilita bando error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/gestionale/abilita-esito - Enable an esito
  fastify.post('/abilita-esito/:id', async (request, reply) => {
    try {
      const { id } = request.params;

      await query(`
        UPDATE gare
        SET "Abilitato" = true, "ModificatoDA" = $1
        WHERE "id" = $2
      `, [request.user.username, id]);

      return {
        success: true,
        messaggio: `Esito ${id} abilitato`
      };
    } catch (err) {
      fastify.log.error(err, 'Abilita esito error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/gestionale/completa-esito - Mark esito as complete
  fastify.post('/completa-esito/:id', async (request, reply) => {
    try {
      const { id } = request.params;

      await query(`
        UPDATE gare
        SET "Completo" = true, "ModificatoDA" = $1
        WHERE "id" = $2
      `, [request.user.username, id]);

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
