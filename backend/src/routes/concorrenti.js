import { query, transaction } from '../db/pool.js';

export default async function concorrentiRoutes(fastify) {

  // ============================================================
  // GET /api/concorrenti - List with filters + pagination
  // ============================================================
  fastify.get('/', async (request) => {
    const {
      page = 1, limit = 25, sort = 'ragione_sociale', order = 'ASC',
      search, id_provincia, id_azienda
    } = request.query;

    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (search) {
      conditions.push(
        `(ragione_sociale ILIKE $${paramIdx} OR nome ILIKE $${paramIdx} OR partita_iva ILIKE $${paramIdx} OR codice_fiscale ILIKE $${paramIdx} OR email ILIKE $${paramIdx} OR telefono ILIKE $${paramIdx} OR citta ILIKE $${paramIdx} OR cap ILIKE $${paramIdx} OR indirizzo ILIKE $${paramIdx} OR persona_riferimento ILIKE $${paramIdx})`
      );
      params.push(`%${search}%`);
      paramIdx++;
    }

    if (id_provincia) {
      conditions.push(`id_provincia = $${paramIdx}`);
      params.push(parseInt(id_provincia));
      paramIdx++;
    }

    if (id_azienda) {
      conditions.push(`id_azienda = $${paramIdx}`);
      params.push(parseInt(id_azienda));
      paramIdx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sortSafe = ['ragione_sociale', 'citta', 'email', 'partita_iva', 'created_at'].includes(sort) ? sort : 'ragione_sociale';
    const orderSafe = ['ASC', 'DESC'].includes(order.toUpperCase()) ? order.toUpperCase() : 'ASC';

    try {
      const countResult = await query(
        `SELECT COUNT(*) FROM concorrenti ${whereClause}`,
        params
      );
      const total = parseInt(countResult.rows[0].count);

      const result = await query(
        `SELECT * FROM concorrenti ${whereClause}
         ORDER BY ${sortSafe} ${orderSafe}
         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, parseInt(limit), offset]
      );

      return {
        data: result.rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      };
    } catch (err) {
      fastify.log.error(err, 'List concorrenti error');
      return { error: 'Errore lista concorrenti', details: err.message };
    }
  });

  // ============================================================
  // GET /api/concorrenti/:id - Detail
  // ============================================================
  fastify.get('/:id', async (request) => {
    const { id } = request.params;
    try {
      const result = await query(
        `SELECT * FROM concorrenti WHERE id = $1`,
        [parseInt(id)]
      );
      if (result.rows.length === 0) {
        return { error: 'Concorrente non trovato' };
      }
      return result.rows[0];
    } catch (err) {
      fastify.log.error(err, 'Get concorrente error');
      return { error: 'Errore lettura concorrente', details: err.message };
    }
  });

  // ============================================================
  // POST /api/concorrenti - Create
  // ============================================================
  // Allowed columns based on actual schema (002_esiti_schema.sql)
  const ALLOWED_COLS = [
    'ragione_sociale', 'nome', 'indirizzo', 'cap', 'citta', 'id_provincia',
    'telefono', 'email', 'partita_iva', 'codice_fiscale',
    'note', 'persona_riferimento',
    'prezzo_bandi', 'prezzo_esiti', 'prezzo_bundle', 'id_azienda'
  ];

  fastify.post('/', { onRequest: [fastify.authenticate] }, async (request) => {
    const b = request.body || {};
    if (!b.ragione_sociale) {
      return { error: 'ragione_sociale è obbligatorio' };
    }
    // Normalize: ignore unknown fields (fax, pec, etc) silently
    const cols = [];
    const vals = [];
    const placeholders = [];
    let idx = 1;
    for (const c of ALLOWED_COLS) {
      if (b[c] !== undefined && b[c] !== null && b[c] !== '') {
        cols.push(c);
        let v = b[c];
        if (c === 'id_provincia' || c === 'id_azienda') v = parseInt(v);
        else if (c.startsWith('prezzo_')) v = parseFloat(v) || 0;
        vals.push(v);
        placeholders.push('$' + idx++);
      }
    }
    try {
      const result = await query(
        `INSERT INTO concorrenti (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
        vals
      );
      return result.rows[0];
    } catch (err) {
      fastify.log.error(err, 'Create concorrente error');
      if (err.code === '23505') {
        return { error: 'Partita IVA o Codice Fiscale già esistente' };
      }
      return { error: 'Errore creazione concorrente', details: err.message };
    }
  });

  // ============================================================
  // PUT /api/concorrenti/:id - Update
  // ============================================================
  fastify.put('/:id', { onRequest: [fastify.authenticate] }, async (request) => {
    const { id } = request.params;
    const b = request.body || {};
    const updates = [];
    const params = [];
    let paramIdx = 1;
    for (const c of ALLOWED_COLS) {
      if (b[c] !== undefined) {
        let v = b[c];
        if (v === '') v = null;
        if (v !== null && (c === 'id_provincia' || c === 'id_azienda')) v = parseInt(v);
        else if (v !== null && c.startsWith('prezzo_')) v = parseFloat(v) || 0;
        updates.push(`${c} = $${paramIdx++}`);
        params.push(v);
      }
    }
    if (updates.length === 0) {
      return { error: 'Nessun campo da aggiornare' };
    }
    updates.push(`updated_at = NOW()`);
    params.push(parseInt(id));
    try {
      const result = await query(
        `UPDATE concorrenti SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
        params
      );

      if (result.rows.length === 0) {
        return { error: 'Concorrente non trovato' };
      }

      return result.rows[0];
    } catch (err) {
      fastify.log.error(err, 'Update concorrente error');
      if (err.code === '23505') {
        return { error: 'Partita IVA o Codice Fiscale già esistente' };
      }
      return { error: 'Errore aggiornamento concorrente', details: err.message };
    }
  });

  // ============================================================
  // DELETE /api/concorrenti/:id - Delete
  // ============================================================
  fastify.delete('/:id', { onRequest: [fastify.authenticate] }, async (request) => {
    const { id } = request.params;
    try {
      const result = await query(
        `DELETE FROM concorrenti WHERE id = $1 RETURNING id`,
        [parseInt(id)]
      );

      if (result.rows.length === 0) {
        return { error: 'Concorrente non trovato' };
      }

      return { success: true, id: result.rows[0].id };
    } catch (err) {
      fastify.log.error(err, 'Delete concorrente error');
      return { error: 'Errore eliminazione concorrente', details: err.message };
    }
  });

  // ============================================================
  // GET /api/concorrenti/search?term= - Autocomplete
  // ============================================================
  fastify.get('/search/term', async (request) => {
    const { term = '' } = request.query;
    try {
      const result = await query(
        `SELECT id, ragione_sociale, citta, email FROM concorrenti
         WHERE ragione_sociale ILIKE $1 OR email ILIKE $1
         ORDER BY ragione_sociale ASC LIMIT 20`,
        [`%${term}%`]
      );
      return result.rows;
    } catch (err) {
      fastify.log.error(err, 'Search concorrenti error');
      return { error: 'Errore ricerca concorrenti', details: err.message };
    }
  });

  // ============================================================
  // GET /api/concorrenti/check-piva?piva= - Check P.IVA uniqueness
  // ============================================================
  fastify.get('/check/piva', async (request) => {
    const { piva, exclude_id } = request.query;
    if (!piva) {
      return { error: 'piva è obbligatorio' };
    }

    try {
      let sql = `SELECT COUNT(*) FROM concorrenti WHERE partita_iva = $1`;
      const params = [piva];

      if (exclude_id) {
        sql += ` AND id != $2`;
        params.push(parseInt(exclude_id));
      }

      const result = await query(sql, params);
      const exists = parseInt(result.rows[0].count) > 0;

      return { available: !exists, piva, exists };
    } catch (err) {
      fastify.log.error(err, 'Check PIVA error');
      return { error: 'Errore verifica P.IVA', details: err.message };
    }
  });

}
