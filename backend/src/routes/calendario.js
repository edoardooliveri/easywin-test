import { query } from '../db/pool.js';

export default async function calendarioRoutes(fastify, opts) {

  // ============================================================
  // CALENDAR EVENTS
  // ============================================================

  /**
   * GET /api/calendario/eventi?mese=&anno=
   * Get all events for a month
   */
  fastify.get('/eventi', async (request, reply) => {
    try {
      const { mese, anno } = request.query;

      if (!mese || !anno) {
        return reply.status(400).send({ success: false, error: 'mese and anno required' });
      }

      const dataInizio = new Date(`${anno}-${String(mese).padStart(2, '0')}-01`);
      const dataFine = new Date(dataInizio.getFullYear(), dataInizio.getMonth() + 1, 0);

      const result = await query(
        `SELECT
          e."id",
          e."titolo",
          e."data_inizio",
          e."data_fine",
          e."tipo",
          e."descrizione",
          e."colore",
          e."promemoria_minuti",
          e."id_bando",
          e."id_utente_assegnato",
          e."data_creazione"
        FROM calendario_eventi e
        WHERE (e.data_inizio >= $1 AND e.data_inizio <= $2)
           OR (e.data_fine >= $1 AND e.data_fine <= $2)
           OR (e.data_inizio <= $1 AND e.data_fine >= $2)
        ORDER BY e.data_inizio ASC`,
        [dataInizio, dataFine]
      );

      return reply.send({ success: true, data: result.rows });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/calendario/eventi/:id
   * Get event detail
   */
  fastify.get('/eventi/:id', async (request, reply) => {
    try {
      const { id } = request.params;

      const result = await query(
        `SELECT
          "id",
          "titolo",
          "data_inizio",
          "data_fine",
          "tipo",
          "descrizione",
          "id_bando",
          "id_utente_assegnato",
          "colore",
          "promemoria_minuti",
          "data_creazione",
          "data_modifica"
        FROM calendario_eventi
        WHERE id = $1`,
        [id]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ success: false, error: 'Event not found' });
      }

      return reply.send({ success: true, data: result.rows[0] });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/calendario/eventi
   * Create custom event
   */
  fastify.post('/eventi', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { titolo, data_inizio, data_fine, tipo, descrizione, id_bando, id_utente_assegnato, colore, promemoria_minuti } = request.body;

      const validTipi = ['apertura', 'scrittura', 'sopralluogo', 'elaborato', 'scadenza', 'custom', 'newsletter'];
      if (!validTipi.includes(tipo)) {
        return reply.status(400).send({ success: false, error: 'Invalid event type' });
      }

      const result = await query(
        `INSERT INTO calendario_eventi (titolo, data_inizio, data_fine, tipo, descrizione, id_bando, id_utente_assegnato, colore, promemoria_minuti, data_creazione)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        RETURNING id, titolo, tipo, data_inizio, data_fine`,
        [titolo, data_inizio, data_fine, tipo, descrizione, id_bando || null, id_utente_assegnato || null, colore || '#3498db', promemoria_minuti || 0]
      );

      return reply.status(201).send({ success: true, data: result.rows[0] });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * PUT /api/calendario/eventi/:id
   * Update event
   */
  fastify.put('/eventi/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const { titolo, data_inizio, data_fine, tipo, descrizione, colore, promemoria_minuti } = request.body;

      const result = await query(
        `UPDATE calendario_eventi
        SET
          titolo = COALESCE($1, titolo),
          data_inizio = COALESCE($2, data_inizio),
          data_fine = COALESCE($3, data_fine),
          tipo = COALESCE($4, tipo),
          descrizione = COALESCE($5, descrizione),
          colore = COALESCE($6, colore),
          promemoria_minuti = COALESCE($7, promemoria_minuti),
          data_modifica = NOW()
        WHERE id = $8
        RETURNING id, titolo, tipo, data_inizio, data_fine`,
        [titolo, data_inizio, data_fine, tipo, descrizione, colore, promemoria_minuti, id]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ success: false, error: 'Event not found' });
      }

      return reply.send({ success: true, data: result.rows[0] });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * DELETE /api/calendario/eventi/:id
   * Delete event
   */
  fastify.delete('/eventi/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;

      const result = await query(
        `DELETE FROM calendario_eventi WHERE id = $1 RETURNING id`,
        [id]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ success: false, error: 'Event not found' });
      }

      return reply.send({ success: true, message: 'Event deleted' });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ============================================================
  // AGENDA VIEW
  // ============================================================

  /**
   * GET /api/calendario/agenda?data_da=&data_a=
   * Get flat list of events sorted by date
   */
  fastify.get('/agenda', async (request, reply) => {
    try {
      const { data_da, data_a, page = 1, limit = 50 } = request.query;
      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

      let whereClause = 'WHERE 1=1';
      const params = [];

      if (data_da) {
        params.push(new Date(data_da));
        whereClause += ` AND data_inizio >= $${params.length}`;
      }

      if (data_a) {
        params.push(new Date(data_a));
        whereClause += ` AND data_fine <= $${params.length}`;
      }

      const countResult = await query(
        `SELECT COUNT(*) as total FROM calendario_eventi ${whereClause}`,
        params
      );
      const total = parseInt(countResult.rows[0].total);

      const result = await query(
        `SELECT
          "id",
          "titolo",
          "data_inizio",
          "data_fine",
          "tipo",
          "descrizione",
          "colore",
          "id_bando"
        FROM calendario_eventi
        ${whereClause}
        ORDER BY data_inizio ASC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      );

      return reply.send({
        success: true,
        data: result.rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/calendario/oggi
   * Get today's events
   */
  fastify.get('/oggi', async (request, reply) => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const result = await query(
        `SELECT
          "id",
          "titolo",
          "data_inizio",
          "data_fine",
          "tipo",
          "descrizione",
          "colore"
        FROM calendario_eventi
        WHERE data_inizio >= $1 AND data_inizio < $2
        ORDER BY data_inizio ASC`,
        [today, tomorrow]
      );

      return reply.send({ success: true, data: result.rows });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/calendario/prossimi?giorni=7
   * Get upcoming events
   */
  fastify.get('/prossimi', async (request, reply) => {
    try {
      const { giorni = 7 } = request.query;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const futureDate = new Date(today);
      futureDate.setDate(futureDate.getDate() + parseInt(giorni));

      const result = await query(
        `SELECT
          "id",
          "titolo",
          "data_inizio",
          "data_fine",
          "tipo",
          "descrizione",
          "colore",
          "id_bando"
        FROM calendario_eventi
        WHERE data_inizio >= $1 AND data_inizio <= $2
        ORDER BY data_inizio ASC`,
        [today, futureDate]
      );

      return reply.send({ success: true, data: result.rows });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ============================================================
  // APPOINTMENTS BY TYPE
  // ============================================================

  /**
   * GET /api/calendario/appuntamenti/aperture?data_da=&data_a=
   * Get aperture appointments
   */
  fastify.get('/appuntamenti/aperture', async (request, reply) => {
    try {
      const { data_da, data_a } = request.query;
      const params = ['apertura'];

      let whereClause = 'WHERE e.tipo = $1';

      if (data_da) {
        params.push(new Date(data_da));
        whereClause += ` AND e.data_inizio >= $${params.length}`;
      }

      if (data_a) {
        params.push(new Date(data_a));
        whereClause += ` AND e.data_fine <= $${params.length}`;
      }

      const result = await query(
        `SELECT
          e."id",
          e."titolo",
          e."data_inizio",
          e."data_fine",
          e."id_bando",
          b."titolo_bando"
        FROM calendario_eventi e
        LEFT JOIN bandi b ON e.id_bando = b.id
        ${whereClause}
        ORDER BY e.data_inizio ASC`,
        params
      );

      return reply.send({ success: true, data: result.rows });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/calendario/appuntamenti/scritture?data_da=&data_a=
   * Get scritture appointments
   */
  fastify.get('/appuntamenti/scritture', async (request, reply) => {
    try {
      const { data_da, data_a } = request.query;
      const params = ['scrittura'];

      let whereClause = 'WHERE e.tipo = $1';

      if (data_da) {
        params.push(new Date(data_da));
        whereClause += ` AND e.data_inizio >= $${params.length}`;
      }

      if (data_a) {
        params.push(new Date(data_a));
        whereClause += ` AND e.data_fine <= $${params.length}`;
      }

      const result = await query(
        `SELECT
          e."id",
          e."titolo",
          e."data_inizio",
          e."data_fine",
          e."descrizione",
          e."id_utente_assegnato"
        FROM calendario_eventi e
        ${whereClause}
        ORDER BY e.data_inizio ASC`,
        params
      );

      return reply.send({ success: true, data: result.rows });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/calendario/appuntamenti/sopralluoghi?data_da=&data_a=
   * Get sopralluoghi appointments
   */
  fastify.get('/appuntamenti/sopralluoghi', async (request, reply) => {
    try {
      const { data_da, data_a } = request.query;
      const params = ['sopralluogo'];

      let whereClause = 'WHERE e.tipo = $1';

      if (data_da) {
        params.push(new Date(data_da));
        whereClause += ` AND e.data_inizio >= $${params.length}`;
      }

      if (data_a) {
        params.push(new Date(data_a));
        whereClause += ` AND e.data_fine <= $${params.length}`;
      }

      const result = await query(
        `SELECT
          e."id",
          e."titolo",
          e."data_inizio",
          e."data_fine",
          e."descrizione",
          e."id_utente_assegnato"
        FROM calendario_eventi e
        ${whereClause}
        ORDER BY e.data_inizio ASC`,
        params
      );

      return reply.send({ success: true, data: result.rows });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/calendario/appuntamenti/elaborati?data_da=&data_a=
   * Get elaborati appointments
   */
  fastify.get('/appuntamenti/elaborati', async (request, reply) => {
    try {
      const { data_da, data_a } = request.query;
      const params = ['elaborato'];

      let whereClause = 'WHERE e.tipo = $1';

      if (data_da) {
        params.push(new Date(data_da));
        whereClause += ` AND e.data_inizio >= $${params.length}`;
      }

      if (data_a) {
        params.push(new Date(data_a));
        whereClause += ` AND e.data_fine <= $${params.length}`;
      }

      const result = await query(
        `SELECT
          e."id",
          e."titolo",
          e."data_inizio",
          e."data_fine",
          e."descrizione",
          e."id_utente_assegnato"
        FROM calendario_eventi e
        ${whereClause}
        ORDER BY e.data_inizio ASC`,
        params
      );

      return reply.send({ success: true, data: result.rows });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ============================================================
  // SCADENZE (DEADLINES)
  // ============================================================

  /**
   * GET /api/calendario/scadenze-abbonamenti?giorni=30
   * Get upcoming subscription expirations
   */
  fastify.get('/scadenze-abbonamenti', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { giorni = 30 } = request.query;
      const today = new Date();
      const futureDate = new Date(today);
      futureDate.setDate(futureDate.getDate() + parseInt(giorni));

      const result = await query(
        `SELECT
          a."id",
          a."id_utente",
          u."email",
          u."nome",
          a."data_scadenza",
          a."tipo_abbonamento",
          EXTRACT(DAY FROM a.data_scadenza - NOW()) as giorni_rimanenti
        FROM abbonamenti a
        JOIN utenti u ON a.id_utente = u.id
        WHERE a.data_scadenza >= $1 AND a.data_scadenza <= $2
        ORDER BY a.data_scadenza ASC`,
        [today, futureDate]
      );

      return reply.send({ success: true, data: result.rows });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/calendario/scadenze-bandi?giorni=7
   * Get upcoming bandi deadlines (apertura date)
   */
  fastify.get('/scadenze-bandi', async (request, reply) => {
    try {
      const { giorni = 7 } = request.query;
      const today = new Date();
      const futureDate = new Date(today);
      futureDate.setDate(futureDate.getDate() + parseInt(giorni));

      const result = await query(
        `SELECT
          b."id",
          b."titolo_bando",
          b."data_apertura",
          b."data_chiusura",
          b."id_fonte",
          f."nome_fonte",
          EXTRACT(DAY FROM b.data_apertura - NOW()) as giorni_all_apertura,
          EXTRACT(DAY FROM b.data_chiusura - NOW()) as giorni_alla_chiusura
        FROM bandi b
        LEFT JOIN fonti_bandi f ON b.id_fonte = f.id
        WHERE b.data_apertura >= $1 AND b.data_apertura <= $2
        ORDER BY b.data_apertura ASC`,
        [today, futureDate]
      );

      return reply.send({ success: true, data: result.rows });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

}
