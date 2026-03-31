import { query, transaction } from '../db/pool.js';

export default async function piattaformeRoutes(fastify, opts) {

  // ============================================================
  // GET /api/piattaforme - Lista piattaforme con conteggio utilizzo
  // ============================================================
  fastify.get('/', async (request, reply) => {
    const { page = 1, limit = 20, search } = request.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (search) {
      conditions.push(`p."Piattaforma" ILIKE $${paramIdx}`);
      params.push(`%${search}%`);
      paramIdx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await query(
      `SELECT COUNT(*) as total FROM piattaforme p ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].total);

    const result = await query(
      `SELECT
        p."id" AS id,
        p."Piattaforma" AS nome,
        p."URL" AS url,
        p."Note" AS note,
        p."Attiva" AS attiva,
        COUNT(b."id_bando") AS numero_bandi
       FROM piattaforme p
       LEFT JOIN bandi b ON p."id" = b."id_piattaforma"
       ${whereClause}
       GROUP BY p."id", p."Piattaforma", p."URL", p."Note", p."Attiva"
       ORDER BY p."Piattaforma" ASC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, parseInt(limit), offset]
    );

    return {
      data: result.rows,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit))
      }
    };
  });

  // ============================================================
  // GET /api/piattaforme/:id - Dettaglio piattaforma
  // ============================================================
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params;

    const result = await query(
      `SELECT
        p."id" AS id,
        p."Piattaforma" AS nome,
        p."URL" AS url,
        p."Note" AS note,
        p."Attiva" AS attiva,
        COUNT(b."id_bando") AS numero_bandi
       FROM piattaforme p
       LEFT JOIN bandi b ON p."id" = b."id_piattaforma"
       WHERE p."id" = $1
       GROUP BY p."id", p."Piattaforma", p."URL", p."Note", p."Attiva"`,
      [id]
    );

    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'Piattaforma non trovata' });
    }

    // Fetch regex patterns for this platform
    const regexResult = await query(
      `SELECT "id" AS id, "pattern" AS pattern, "tipo" AS tipo, "descrizione" AS descrizione
       FROM piattaforme_regex
       WHERE "id_piattaforma" = $1
       ORDER BY "tipo", "descrizione"`,
      [id]
    );

    return {
      ...result.rows[0],
      regex_patterns: regexResult.rows
    };
  });

  // ============================================================
  // POST /api/piattaforme - Crea nuova piattaforma
  // ============================================================
  fastify.post('/', { preHandler: [fastify.authenticate, fastify.requireAdmin] }, async (request, reply) => {
    const { nome, url, note, attiva } = request.body;
    const user = request.user;

    const result = await transaction(async (client) => {
      const insertResult = await client.query(
        `INSERT INTO piattaforme ("Piattaforma", "URL", "Note", "Attiva")
         VALUES ($1, $2, $3, $4) RETURNING "id"`,
        [nome, url, note || null, attiva !== false]
      );

      const piattaformaId = insertResult.rows[0].id;

      // Audit log
      await client.query(
        'INSERT INTO audit_log ("tabella", "id_record", "azione", "utente") VALUES ($1, $2, $3, $4)',
        ['piattaforme', piattaformaId, 'CREATE', user.username]
      );

      return piattaformaId;
    });

    return reply.status(201).send({ id: result, message: 'Piattaforma creata con successo' });
  });

  // ============================================================
  // PUT /api/piattaforme/:id - Aggiorna piattaforma
  // ============================================================
  fastify.put('/:id', { preHandler: [fastify.authenticate, fastify.requireAdmin] }, async (request, reply) => {
    const { id } = request.params;
    const { nome, url, note, attiva } = request.body;
    const user = request.user;

    const fields = [];
    const values = [];
    let idx = 1;

    const updatableFields = {
      'nome': 'Piattaforma',
      'url': 'URL',
      'note': 'Note',
      'attiva': 'Attiva'
    };

    for (const [key, dbCol] of Object.entries(updatableFields)) {
      if (request.body[key] !== undefined) {
        fields.push(`"${dbCol}" = $${idx}`);
        values.push(request.body[key]);
        idx++;
      }
    }

    if (fields.length === 0) {
      return reply.status(400).send({ error: 'Nessun campo da aggiornare' });
    }

    values.push(id);
    idx++;

    await transaction(async (client) => {
      await client.query(
        `UPDATE piattaforme SET ${fields.join(', ')} WHERE "id" = $${idx}`,
        values
      );

      await client.query(
        'INSERT INTO audit_log ("tabella", "id_record", "azione", "utente") VALUES ($1, $2, $3, $4)',
        ['piattaforme', id, 'UPDATE', user.username]
      );
    });

    return { message: 'Piattaforma aggiornata con successo' };
  });

  // ============================================================
  // DELETE /api/piattaforme/:id - Elimina piattaforma
  // ============================================================
  fastify.delete('/:id', { preHandler: [fastify.authenticate, fastify.requireAdmin] }, async (request, reply) => {
    const { id } = request.params;
    const user = request.user;

    await transaction(async (client) => {
      // Check if platform is referenced by bandi
      const bandoCheck = await client.query(
        'SELECT COUNT(*) as cnt FROM bandi WHERE "id_piattaforma" = $1',
        [id]
      );

      if (parseInt(bandoCheck.rows[0].cnt) > 0) {
        throw new Error('Piattaforma è referenziata da bandi, impossibile eliminare');
      }

      // Delete related regex patterns
      await client.query('DELETE FROM piattaforme_regex WHERE "id_piattaforma" = $1', [id]);

      // Delete platform
      await client.query('DELETE FROM piattaforme WHERE "id" = $1', [id]);

      await client.query(
        'INSERT INTO audit_log ("tabella", "id_record", "azione", "utente") VALUES ($1, $2, $3, $4)',
        ['piattaforme', id, 'DELETE', user.username]
      );
    });

    return { message: 'Piattaforma eliminata con successo' };
  });

  // ============================================================
  // GET /api/piattaforme/:id/regulars - Lista regex per piattaforma
  // ============================================================
  fastify.get('/:id/regulars', { preHandler: [fastify.authenticate, fastify.requireAdmin] }, async (request, reply) => {
    const { id } = request.params;

    const result = await query(
      `SELECT "id" AS id, "pattern" AS pattern, "tipo" AS tipo, "descrizione" AS descrizione
       FROM piattaforme_regex
       WHERE "id_piattaforma" = $1
       ORDER BY "tipo", "descrizione"`,
      [id]
    );

    return { data: result.rows };
  });

  // ============================================================
  // POST /api/piattaforme/:id/regulars - Aggiungi regex per piattaforma
  // ============================================================
  fastify.post('/:id/regulars', { preHandler: [fastify.authenticate, fastify.requireAdmin] }, async (request, reply) => {
    const { id } = request.params;
    const { pattern, tipo, descrizione } = request.body;
    const user = request.user;

    const result = await transaction(async (client) => {
      const insertResult = await client.query(
        `INSERT INTO piattaforme_regex ("id_piattaforma", "pattern", "tipo", "descrizione")
         VALUES ($1, $2, $3, $4) RETURNING "id"`,
        [id, pattern, tipo, descrizione]
      );

      const regexId = insertResult.rows[0].id;

      await client.query(
        'INSERT INTO audit_log ("tabella", "id_record", "azione", "utente") VALUES ($1, $2, $3, $4)',
        ['piattaforme_regex', regexId, 'CREATE', user.username]
      );

      return regexId;
    });

    return reply.status(201).send({ id: result, message: 'Regex pattern creato con successo' });
  });

  // ============================================================
  // PUT /api/piattaforme/regulars/:id - Aggiorna regex
  // ============================================================
  fastify.put('/regulars/:id', { preHandler: [fastify.authenticate, fastify.requireAdmin] }, async (request, reply) => {
    const { id } = request.params;
    const { pattern, tipo, descrizione } = request.body;
    const user = request.user;

    await transaction(async (client) => {
      await client.query(
        `UPDATE piattaforme_regex SET "pattern" = $1, "tipo" = $2, "descrizione" = $3 WHERE "id" = $4`,
        [pattern, tipo, descrizione, id]
      );

      await client.query(
        'INSERT INTO audit_log ("tabella", "id_record", "azione", "utente") VALUES ($1, $2, $3, $4)',
        ['piattaforme_regex', id, 'UPDATE', user.username]
      );
    });

    return { message: 'Regex pattern aggiornato con successo' };
  });

  // ============================================================
  // DELETE /api/piattaforme/regulars/:id - Elimina regex
  // ============================================================
  fastify.delete('/regulars/:id', { preHandler: [fastify.authenticate, fastify.requireAdmin] }, async (request, reply) => {
    const { id } = request.params;
    const user = request.user;

    await transaction(async (client) => {
      await client.query('DELETE FROM piattaforme_regex WHERE "id" = $1', [id]);

      await client.query(
        'INSERT INTO audit_log ("tabella", "id_record", "azione", "utente") VALUES ($1, $2, $3, $4)',
        ['piattaforme_regex', id, 'DELETE', user.username]
      );
    });

    return { message: 'Regex pattern eliminato con successo' };
  });

  // ============================================================
  // GET /api/piattaforme/search - Autocomplete nomi piattaforme
  // ============================================================
  fastify.get('/search/autocomplete', async (request, reply) => {
    const { term = '' } = request.query;

    const result = await query(
      `SELECT "id" AS id, "Piattaforma" AS nome
       FROM piattaforme
       WHERE "Piattaforma" ILIKE $1
       ORDER BY "Piattaforma" ASC
       LIMIT 20`,
      [`%${term}%`]
    );

    return { data: result.rows };
  });

  // ============================================================
  // POST /api/piattaforme/:id/propaga - Propaga regex a tutte le stazioni
  // ============================================================
  fastify.post('/:id/propaga', { preHandler: [fastify.authenticate, fastify.requireAdmin] }, async (request, reply) => {
    const { id } = request.params;
    const user = request.user;

    await transaction(async (client) => {
      // Get all regex patterns for this platform
      const regexPatterns = await client.query(
        `SELECT "id" AS id, "pattern" AS pattern, "tipo" AS tipo, "descrizione" AS descrizione
         FROM piattaforme_regex
         WHERE "id_piattaforma" = $1`,
        [id]
      );

      if (regexPatterns.rows.length === 0) {
        throw new Error('Nessun regex pattern definito per questa piattaforma');
      }

      // Get all stazioni using this platform
      const stazioni = await client.query(
        `SELECT DISTINCT s."id" FROM stazioni s
         JOIN bandi b ON s."id" = b."id_stazione"
         WHERE b."id_piattaforma" = $1`,
        [id]
      );

      let propagatedCount = 0;

      // For each stazione, ensure these regex patterns are available
      for (const stazione of stazioni.rows) {
        for (const regex of regexPatterns.rows) {
          // Check if pattern already exists for this stazione
          const exists = await client.query(
            `SELECT "id" FROM stazioni_regex
             WHERE "id_stazione" = $1 AND "pattern" = $2`,
            [stazione.id, regex.pattern]
          );

          if (exists.rows.length === 0) {
            await client.query(
              `INSERT INTO stazioni_regex ("id_stazione", "pattern", "tipo", "descrizione")
               VALUES ($1, $2, $3, $4)`,
              [stazione.id, regex.pattern, regex.tipo, regex.descrizione]
            );
            propagatedCount++;
          }
        }
      }

      await client.query(
        'INSERT INTO audit_log ("tabella", "id_record", "azione", "utente") VALUES ($1, $2, $3, $4)',
        ['piattaforme', id, 'PROPAGATE', user.username]
      );
    });

    return { message: 'Regex propagati a tutte le stazioni', numero_stazioni: (await query(
      `SELECT COUNT(DISTINCT s."id") as cnt FROM stazioni s
       JOIN bandi b ON s."id" = b."id_stazione"
       WHERE b."id_piattaforma" = $1`,
      [id]
    )).rows[0].cnt };
  });

}
