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
        `(ragione_sociale ILIKE $${paramIdx} OR indirizzo ILIKE $${paramIdx} OR email ILIKE $${paramIdx})`
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
    const sortSafe = ['ragione_sociale', 'citta', 'email', 'partita_iva', 'data_creazione'].includes(sort) ? sort : 'ragione_sociale';
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
  fastify.post('/', { onRequest: [fastify.authenticate] }, async (request) => {
    const {
      ragione_sociale, indirizzo, cap, citta, id_provincia,
      telefono, fax, email, pec, partita_iva, codice_fiscale,
      note, prezzo_bandi, prezzo_esiti, prezzo_bundle, id_azienda
    } = request.body;

    if (!ragione_sociale) {
      return { error: 'ragione_sociale è obbligatorio' };
    }

    try {
      const result = await query(
        `INSERT INTO concorrenti (
          ragione_sociale, indirizzo, cap, citta, id_provincia,
          telefono, fax, email, pec, partita_iva, codice_fiscale,
          note, prezzo_bandi, prezzo_esiti, prezzo_bundle, id_azienda, data_creazione
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
         RETURNING *`,
        [
          ragione_sociale, indirizzo, cap, citta, id_provincia ? parseInt(id_provincia) : null,
          telefono, fax, email, pec, partita_iva, codice_fiscale,
          note, prezzo_bandi || 0, prezzo_esiti || 0, prezzo_bundle || 0,
          id_azienda ? parseInt(id_azienda) : null
        ]
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
    const {
      ragione_sociale, indirizzo, cap, citta, id_provincia,
      telefono, fax, email, pec, partita_iva, codice_fiscale,
      note, prezzo_bandi, prezzo_esiti, prezzo_bundle, id_azienda
    } = request.body;

    const updates = [];
    const params = [];
    let paramIdx = 1;

    if (ragione_sociale !== undefined) {
      updates.push(`ragione_sociale = $${paramIdx++}`);
      params.push(ragione_sociale);
    }
    if (indirizzo !== undefined) {
      updates.push(`indirizzo = $${paramIdx++}`);
      params.push(indirizzo);
    }
    if (cap !== undefined) {
      updates.push(`cap = $${paramIdx++}`);
      params.push(cap);
    }
    if (citta !== undefined) {
      updates.push(`citta = $${paramIdx++}`);
      params.push(citta);
    }
    if (id_provincia !== undefined) {
      updates.push(`id_provincia = $${paramIdx++}`);
      params.push(id_provincia ? parseInt(id_provincia) : null);
    }
    if (telefono !== undefined) {
      updates.push(`telefono = $${paramIdx++}`);
      params.push(telefono);
    }
    if (fax !== undefined) {
      updates.push(`fax = $${paramIdx++}`);
      params.push(fax);
    }
    if (email !== undefined) {
      updates.push(`email = $${paramIdx++}`);
      params.push(email);
    }
    if (pec !== undefined) {
      updates.push(`pec = $${paramIdx++}`);
      params.push(pec);
    }
    if (partita_iva !== undefined) {
      updates.push(`partita_iva = $${paramIdx++}`);
      params.push(partita_iva);
    }
    if (codice_fiscale !== undefined) {
      updates.push(`codice_fiscale = $${paramIdx++}`);
      params.push(codice_fiscale);
    }
    if (note !== undefined) {
      updates.push(`note = $${paramIdx++}`);
      params.push(note);
    }
    if (prezzo_bandi !== undefined) {
      updates.push(`prezzo_bandi = $${paramIdx++}`);
      params.push(prezzo_bandi);
    }
    if (prezzo_esiti !== undefined) {
      updates.push(`prezzo_esiti = $${paramIdx++}`);
      params.push(prezzo_esiti);
    }
    if (prezzo_bundle !== undefined) {
      updates.push(`prezzo_bundle = $${paramIdx++}`);
      params.push(prezzo_bundle);
    }
    if (id_azienda !== undefined) {
      updates.push(`id_azienda = $${paramIdx++}`);
      params.push(id_azienda ? parseInt(id_azienda) : null);
    }

    if (updates.length === 0) {
      return { error: 'Nessun campo da aggiornare' };
    }

    updates.push(`data_modifica = NOW()`);
    params.push(parseInt(id));

    try {
      const result = await query(
        `UPDATE concorrenti SET ${updates.join(', ')} WHERE id = $${paramIdx + 1} RETURNING *`,
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
