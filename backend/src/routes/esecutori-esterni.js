import { query, transaction } from '../db/pool.js';

export default async function esecutoriEsterniRoutes(fastify) {

  // ============================================================
  // GET /api/esecutori-esterni - List with filters + pagination
  // ============================================================
  fastify.get('/', async (request) => {
    const {
      page = 1, limit = 25, sort = 'ragione_sociale', order = 'ASC',
      search, id_provincia, id_tipo_esecutore
    } = request.query;

    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (search) {
      conditions.push(
        `(ragione_sociale ILIKE $${paramIdx} OR nome ILIKE $${paramIdx} OR cognome ILIKE $${paramIdx} OR email ILIKE $${paramIdx})`
      );
      params.push(`%${search}%`);
      paramIdx++;
    }

    if (id_provincia) {
      conditions.push(`id_provincia = $${paramIdx}`);
      params.push(parseInt(id_provincia));
      paramIdx++;
    }

    if (id_tipo_esecutore) {
      conditions.push(`id_tipo_esecutore = $${paramIdx}`);
      params.push(parseInt(id_tipo_esecutore));
      paramIdx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE eliminato = false AND ${conditions.join(' AND ')}` : 'WHERE eliminato = false';
    const sortSafe = ['ragione_sociale', 'cognome', 'citta', 'email', 'data_creazione'].includes(sort) ? sort : 'ragione_sociale';
    const orderSafe = ['ASC', 'DESC'].includes(order.toUpperCase()) ? order.toUpperCase() : 'ASC';

    try {
      const countResult = await query(
        `SELECT COUNT(*) FROM esecutori_esterni ${whereClause}`,
        params
      );
      const total = parseInt(countResult.rows[0].count);

      const result = await query(
        `SELECT * FROM esecutori_esterni ${whereClause}
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
      fastify.log.error(err, 'List esecutori esterni error');
      return { error: 'Errore lista esecutori esterni', details: err.message };
    }
  });

  // ============================================================
  // GET /api/esecutori-esterni/:id - Detail
  // ============================================================
  fastify.get('/:id', async (request) => {
    const { id } = request.params;
    try {
      const result = await query(
        `SELECT * FROM esecutori_esterni WHERE id = $1 AND eliminato = false`,
        [parseInt(id)]
      );
      if (result.rows.length === 0) {
        return { error: 'Esecutore esterno non trovato' };
      }
      return result.rows[0];
    } catch (err) {
      fastify.log.error(err, 'Get esecutore esterno error');
      return { error: 'Errore lettura esecutore esterno', details: err.message };
    }
  });

  // ============================================================
  // POST /api/esecutori-esterni - Create
  // ============================================================
  fastify.post('/', { onRequest: [fastify.authenticate] }, async (request) => {
    const {
      ragione_sociale, nome, cognome, indirizzo, cap, citta, id_provincia,
      telefono, cellulare, email, pec, partita_iva, codice_fiscale,
      codice_sdi, id_tipo_esecutore, note, zone_operative
    } = request.body;

    if (!ragione_sociale && !(nome && cognome)) {
      return { error: 'ragione_sociale oppure (nome e cognome) sono obbligatori' };
    }

    try {
      const result = await query(
        `INSERT INTO esecutori_esterni (
          ragione_sociale, nome, cognome, indirizzo, cap, citta, id_provincia,
          telefono, cellulare, email, pec, partita_iva, codice_fiscale,
          codice_sdi, id_tipo_esecutore, note, zone_operative, eliminato, data_creazione
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, false, NOW())
         RETURNING *`,
        [
          ragione_sociale || null, nome || null, cognome || null, indirizzo, cap, citta,
          id_provincia ? parseInt(id_provincia) : null,
          telefono, cellulare, email, pec, partita_iva, codice_fiscale,
          codice_sdi, id_tipo_esecutore ? parseInt(id_tipo_esecutore) : null, note,
          zone_operative && Array.isArray(zone_operative) ? zone_operative : null
        ]
      );

      return result.rows[0];
    } catch (err) {
      fastify.log.error(err, 'Create esecutore esterno error');
      if (err.code === '23505') {
        return { error: 'Partita IVA, Codice Fiscale o SDI già esistente' };
      }
      return { error: 'Errore creazione esecutore esterno', details: err.message };
    }
  });

  // ============================================================
  // PUT /api/esecutori-esterni/:id - Update
  // ============================================================
  fastify.put('/:id', { onRequest: [fastify.authenticate] }, async (request) => {
    const { id } = request.params;
    const {
      ragione_sociale, nome, cognome, indirizzo, cap, citta, id_provincia,
      telefono, cellulare, email, pec, partita_iva, codice_fiscale,
      codice_sdi, id_tipo_esecutore, note, zone_operative
    } = request.body;

    const updates = [];
    const params = [];
    let paramIdx = 1;

    if (ragione_sociale !== undefined) {
      updates.push(`ragione_sociale = $${paramIdx++}`);
      params.push(ragione_sociale);
    }
    if (nome !== undefined) {
      updates.push(`nome = $${paramIdx++}`);
      params.push(nome);
    }
    if (cognome !== undefined) {
      updates.push(`cognome = $${paramIdx++}`);
      params.push(cognome);
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
    if (cellulare !== undefined) {
      updates.push(`cellulare = $${paramIdx++}`);
      params.push(cellulare);
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
    if (codice_sdi !== undefined) {
      updates.push(`codice_sdi = $${paramIdx++}`);
      params.push(codice_sdi);
    }
    if (id_tipo_esecutore !== undefined) {
      updates.push(`id_tipo_esecutore = $${paramIdx++}`);
      params.push(id_tipo_esecutore ? parseInt(id_tipo_esecutore) : null);
    }
    if (note !== undefined) {
      updates.push(`note = $${paramIdx++}`);
      params.push(note);
    }
    if (zone_operative !== undefined) {
      updates.push(`zone_operative = $${paramIdx++}`);
      params.push(Array.isArray(zone_operative) ? zone_operative : null);
    }

    if (updates.length === 0) {
      return { error: 'Nessun campo da aggiornare' };
    }

    updates.push(`data_modifica = NOW()`);
    params.push(parseInt(id));

    try {
      const result = await query(
        `UPDATE esecutori_esterni SET ${updates.join(', ')} WHERE id = $${paramIdx + 1} AND eliminato = false RETURNING *`,
        params
      );

      if (result.rows.length === 0) {
        return { error: 'Esecutore esterno non trovato' };
      }

      return result.rows[0];
    } catch (err) {
      fastify.log.error(err, 'Update esecutore esterno error');
      if (err.code === '23505') {
        return { error: 'Partita IVA, Codice Fiscale o SDI già esistente' };
      }
      return { error: 'Errore aggiornamento esecutore esterno', details: err.message };
    }
  });

  // ============================================================
  // DELETE /api/esecutori-esterni/:id - Soft delete
  // ============================================================
  fastify.delete('/:id', { onRequest: [fastify.authenticate] }, async (request) => {
    const { id } = request.params;
    try {
      const result = await query(
        `UPDATE esecutori_esterni SET eliminato = true, data_modifica = NOW() WHERE id = $1 AND eliminato = false RETURNING id`,
        [parseInt(id)]
      );

      if (result.rows.length === 0) {
        return { error: 'Esecutore esterno non trovato' };
      }

      return { success: true, id: result.rows[0].id };
    } catch (err) {
      fastify.log.error(err, 'Delete esecutore esterno error');
      return { error: 'Errore eliminazione esecutore esterno', details: err.message };
    }
  });

  // ============================================================
  // GET /api/esecutori-esterni/search?term= - Autocomplete
  // ============================================================
  fastify.get('/search/term', async (request) => {
    const { term = '' } = request.query;
    try {
      const result = await query(
        `SELECT id, ragione_sociale, nome, cognome, citta, email FROM esecutori_esterni
         WHERE (ragione_sociale ILIKE $1 OR nome ILIKE $1 OR cognome ILIKE $1 OR email ILIKE $1) AND eliminato = false
         ORDER BY ragione_sociale ASC LIMIT 20`,
        [`%${term}%`]
      );
      return result.rows;
    } catch (err) {
      fastify.log.error(err, 'Search esecutori esterni error');
      return { error: 'Errore ricerca esecutori esterni', details: err.message };
    }
  });

  // ============================================================
  // GET /api/esecutori-esterni/check-univoco?tipo=&valore= - Check uniqueness
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
      let sql = `SELECT COUNT(*) FROM esecutori_esterni WHERE ${tipo} = $1 AND eliminato = false`;
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
