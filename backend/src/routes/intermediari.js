import { query, transaction } from '../db/pool.js';

export default async function intermediariRoutes(fastify) {

  // ============================================================
  // GET /api/intermediari - List with filters + pagination
  // ============================================================
  fastify.get('/', async (request) => {
    const {
      page = 1, limit = 25, sort = 'ragione_sociale', order = 'ASC',
      search, id_provincia
    } = request.query;

    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (search) {
      conditions.push(
        `(ragione_sociale ILIKE $${paramIdx} OR indirizzo ILIKE $${paramIdx} OR email ILIKE $${paramIdx} OR sito_web ILIKE $${paramIdx})`
      );
      params.push(`%${search}%`);
      paramIdx++;
    }

    if (id_provincia) {
      conditions.push(`id_provincia = $${paramIdx}`);
      params.push(parseInt(id_provincia));
      paramIdx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sortSafe = ['ragione_sociale', 'citta', 'email', 'partita_iva', 'data_creazione'].includes(sort) ? sort : 'ragione_sociale';
    const orderSafe = ['ASC', 'DESC'].includes(order.toUpperCase()) ? order.toUpperCase() : 'ASC';

    try {
      const countResult = await query(
        `SELECT COUNT(*) FROM intermediari WHERE eliminato = false ${whereClause}`,
        params
      );
      const total = parseInt(countResult.rows[0].count);

      const result = await query(
        `SELECT * FROM intermediari WHERE eliminato = false ${whereClause}
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
      fastify.log.error(err, 'List intermediari error');
      return { error: 'Errore lista intermediari', details: err.message };
    }
  });

  // ============================================================
  // GET /api/intermediari/:id - Detail
  // ============================================================
  fastify.get('/:id', async (request) => {
    const { id } = request.params;
    try {
      const result = await query(
        `SELECT * FROM intermediari WHERE id = $1 AND eliminato = false`,
        [parseInt(id)]
      );
      if (result.rows.length === 0) {
        return { error: 'Intermediario non trovato' };
      }
      return result.rows[0];
    } catch (err) {
      fastify.log.error(err, 'Get intermediario error');
      return { error: 'Errore lettura intermediario', details: err.message };
    }
  });

  // ============================================================
  // POST /api/intermediari - Create
  // ============================================================
  fastify.post('/', { onRequest: [fastify.authenticate] }, async (request) => {
    const {
      ragione_sociale, indirizzo, cap, citta, id_provincia,
      telefono, fax, email, pec, sito_web, partita_iva, codice_fiscale,
      codice_sdi, referente, note
    } = request.body;

    if (!ragione_sociale) {
      return { error: 'ragione_sociale è obbligatorio' };
    }

    try {
      const result = await query(
        `INSERT INTO intermediari (
          ragione_sociale, indirizzo, cap, citta, id_provincia,
          telefono, fax, email, pec, sito_web, partita_iva, codice_fiscale,
          codice_sdi, referente, note, eliminato, data_creazione
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, false, NOW())
         RETURNING *`,
        [
          ragione_sociale, indirizzo, cap, citta, id_provincia ? parseInt(id_provincia) : null,
          telefono, fax, email, pec, sito_web, partita_iva, codice_fiscale,
          codice_sdi, referente, note
        ]
      );

      return result.rows[0];
    } catch (err) {
      fastify.log.error(err, 'Create intermediario error');
      if (err.code === '23505') {
        return { error: 'Partita IVA, Codice Fiscale o SDI già esistente' };
      }
      return { error: 'Errore creazione intermediario', details: err.message };
    }
  });

  // ============================================================
  // PUT /api/intermediari/:id - Update
  // ============================================================
  fastify.put('/:id', { onRequest: [fastify.authenticate] }, async (request) => {
    const { id } = request.params;
    const {
      ragione_sociale, indirizzo, cap, citta, id_provincia,
      telefono, fax, email, pec, sito_web, partita_iva, codice_fiscale,
      codice_sdi, referente, note
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
    if (sito_web !== undefined) {
      updates.push(`sito_web = $${paramIdx++}`);
      params.push(sito_web);
    }
    if (partita_iva !== undefined) {
      updates.push(`partita_iva = $${paramIdx++}`);
      params.push(partita_iva);
    }
    if (codice_fiscale !== undefined) {
      updates.push(`codice_fiscale = $${paramIdx++}`);
      params.push(codice_fiscale);
    }
    if (codice_sdi !== undefined) {
      updates.push(`codice_sdi = $${paramIdx++}`);
      params.push(codice_sdi);
    }
    if (referente !== undefined) {
      updates.push(`referente = $${paramIdx++}`);
      params.push(referente);
    }
    if (note !== undefined) {
      updates.push(`note = $${paramIdx++}`);
      params.push(note);
    }

    if (updates.length === 0) {
      return { error: 'Nessun campo da aggiornare' };
    }

    updates.push(`data_modifica = NOW()`);
    params.push(parseInt(id));

    try {
      const result = await query(
        `UPDATE intermediari SET ${updates.join(', ')} WHERE id = $${paramIdx + 1} AND eliminato = false RETURNING *`,
        params
      );

      if (result.rows.length === 0) {
        return { error: 'Intermediario non trovato' };
      }

      return result.rows[0];
    } catch (err) {
      fastify.log.error(err, 'Update intermediario error');
      if (err.code === '23505') {
        return { error: 'Partita IVA, Codice Fiscale o SDI già esistente' };
      }
      return { error: 'Errore aggiornamento intermediario', details: err.message };
    }
  });

  // ============================================================
  // DELETE /api/intermediari/:id - Soft delete
  // ============================================================
  fastify.delete('/:id', { onRequest: [fastify.authenticate] }, async (request) => {
    const { id } = request.params;
    try {
      const result = await query(
        `UPDATE intermediari SET eliminato = true, data_modifica = NOW() WHERE id = $1 AND eliminato = false RETURNING id`,
        [parseInt(id)]
      );

      if (result.rows.length === 0) {
        return { error: 'Intermediario non trovato' };
      }

      return { success: true, id: result.rows[0].id };
    } catch (err) {
      fastify.log.error(err, 'Delete intermediario error');
      return { error: 'Errore eliminazione intermediario', details: err.message };
    }
  });

  // ============================================================
  // GET /api/intermediari/search?term= - Autocomplete
  // ============================================================
  fastify.get('/search/term', async (request) => {
    const { term = '' } = request.query;
    try {
      const result = await query(
        `SELECT id, ragione_sociale, citta, email FROM intermediari
         WHERE (ragione_sociale ILIKE $1 OR email ILIKE $1) AND eliminato = false
         ORDER BY ragione_sociale ASC LIMIT 20`,
        [`%${term}%`]
      );
      return result.rows;
    } catch (err) {
      fastify.log.error(err, 'Search intermediari error');
      return { error: 'Errore ricerca intermediari', details: err.message };
    }
  });

  // ============================================================
  // GET /api/intermediari/check-univoco?tipo=&valore= - Check uniqueness
  // ============================================================
  fastify.get('/check/univoco', async (request) => {
    const { tipo, valore, exclude_id } = request.query;

    if (!tipo || !valore) {
      return { error: 'tipo e valore sono obbligatori' };
    }

    const tipiValidi = ['partita_iva', 'codice_fiscale', 'codice_sdi'];
    if (!tipiValidi.includes(tipo)) {
      return { error: 'tipo non valido: deve essere partita_iva, codice_fiscale o codice_sdi' };
    }

    try {
      let sql = `SELECT COUNT(*) FROM intermediari WHERE ${tipo} = $1 AND eliminato = false`;
      const params = [valore];

      if (exclude_id) {
        sql += ` AND id != $2`;
        params.push(parseInt(exclude_id));
      }

      const result = await query(sql, params);
      const exists = parseInt(result.rows[0].count) > 0;

      return { available: !exists, tipo, valore, exists };
    } catch (err) {
      fastify.log.error(err, 'Check univoco error');
      return { error: 'Errore verifica univocità', details: err.message };
    }
  });

}
