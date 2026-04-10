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
      conditions.push(`p."nome" ILIKE $${paramIdx}`);
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
        p."nome" AS nome,
        p."url" AS url,
        COUNT(b."id") AS numero_bandi
       FROM piattaforme p
       LEFT JOIN bandi b ON p."id" = b."id_piattaforma"
       ${whereClause}
       GROUP BY p."id", p."nome", p."url"
       ORDER BY p."nome" ASC
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
        p."nome" AS nome,
        p."url" AS url,
        COUNT(b."id") AS numero_bandi
       FROM piattaforme p
       LEFT JOIN bandi b ON p."id" = b."id_piattaforma"
       WHERE p."id" = $1
       GROUP BY p."id", p."nome", p."url"`,
      [id]
    );

    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'Piattaforma non trovata' });
    }

    // Fetch regex patterns for this platform
    let regexRows = [];
    try {
      const regexResult = await query(
        `SELECT "id" AS id, "pattern" AS pattern, "tipo" AS tipo, "descrizione" AS descrizione
         FROM piattaforme_regex
         WHERE "id_piattaforma" = $1
         ORDER BY "tipo", "descrizione"`,
        [id]
      );
      regexRows = regexResult.rows;
    } catch(e) {
      // piattaforme_regex table may not exist
    }

    return {
      ...result.rows[0],
      regex_patterns: regexRows
    };
  });

  // ============================================================
  // POST /api/piattaforme - Crea nuova piattaforma
  // ============================================================
  fastify.post('/', async (request, reply) => {
    const { nome, url, note } = request.body;

    const result = await query(
      `INSERT INTO piattaforme ("nome", "url", "descrizione")
       VALUES ($1, $2, $3) RETURNING "id" AS id`,
      [nome, url, note || null]
    );

    return reply.status(201).send({ id: result.rows[0].id, message: 'Piattaforma creata con successo' });
  });

  // ============================================================
  // PUT /api/piattaforme/:id - Aggiorna piattaforma
  // ============================================================
  fastify.put('/:id', async (request, reply) => {
    const { id } = request.params;
    const { nome, url, note } = request.body;

    const fields = [];
    const values = [];
    let idx = 1;

    if (nome !== undefined) { fields.push(`"nome" = $${idx}`); values.push(nome); idx++; }
    if (url !== undefined) { fields.push(`"url" = $${idx}`); values.push(url); idx++; }
    if (note !== undefined) { fields.push(`"descrizione" = $${idx}`); values.push(note); idx++; }

    if (fields.length === 0) {
      return reply.status(400).send({ error: 'Nessun campo da aggiornare' });
    }

    values.push(id);
    await query(
      `UPDATE piattaforme SET ${fields.join(', ')} WHERE "id" = $${idx}`,
      values
    );

    return { message: 'Piattaforma aggiornata con successo' };
  });

  // ============================================================
  // DELETE /api/piattaforme/:id - Elimina piattaforma
  // ============================================================
  fastify.delete('/:id', async (request, reply) => {
    const { id } = request.params;

    // Check if platform is referenced by bandi
    const bandoCheck = await query(
      'SELECT COUNT(*) as cnt FROM bandi WHERE "id_piattaforma" = $1',
      [id]
    );

    if (parseInt(bandoCheck.rows[0].cnt) > 0) {
      return reply.status(400).send({ error: 'Piattaforma è referenziata da bandi, impossibile eliminare' });
    }

    // Delete related regex patterns
    try {
      await query('DELETE FROM piattaforme_regex WHERE "id_piattaforma" = $1', [id]);
    } catch(e) { /* table may not exist */ }

    // Delete platform
    await query('DELETE FROM piattaforme WHERE "id" = $1', [id]);

    return { message: 'Piattaforma eliminata con successo' };
  });

  // ============================================================
  // GET /api/piattaforme/search/autocomplete - Autocomplete nomi piattaforme
  // ============================================================
  fastify.get('/search/autocomplete', async (request, reply) => {
    const { term = '' } = request.query;

    const result = await query(
      `SELECT "id" AS id, "nome" AS nome
       FROM piattaforme
       WHERE "nome" ILIKE $1
       ORDER BY "nome" ASC
       LIMIT 20`,
      [`%${term}%`]
    );

    return { data: result.rows };
  });

}
