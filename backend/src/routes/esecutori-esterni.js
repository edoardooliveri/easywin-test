import { query } from '../db/pool.js';

const ALLOWED_COLS = [
  'ragione_sociale', 'nome', 'cognome',
  'indirizzo', 'cap', 'citta', 'id_provincia',
  'telefono', 'cellulare', 'email', 'pec',
  'partita_iva', 'codice_fiscale', 'codice_sdi',
  'id_intermediario', 'id_tipo_esecutore',
  'prezzo_propria_zona', 'prezzo_altre_zone',
  'note'
];

const INT_COLS = new Set(['id_provincia', 'id_intermediario', 'id_tipo_esecutore']);
const NUM_COLS = new Set(['prezzo_propria_zona', 'prezzo_altre_zone']);

function coerce(c, v) {
  if (v === undefined || v === null || v === '') return null;
  if (INT_COLS.has(c)) return parseInt(v) || null;
  if (NUM_COLS.has(c)) return parseFloat(v) || 0;
  return v;
}

export default async function esecutoriEsterniRoutes(fastify) {

  // ============================================================
  // GET /api/esecutori-esterni - List with filters + pagination
  // ============================================================
  fastify.get('/', async (request) => {
    const {
      page = 1, limit = 25, sort = 'ragione_sociale', order = 'ASC',
      search, id_provincia, id_intermediario
    } = request.query;

    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
    const conditions = ['e.eliminato = false'];
    const params = [];
    let paramIdx = 1;

    if (search) {
      conditions.push(
        `(e.ragione_sociale ILIKE $${paramIdx} OR e.nome ILIKE $${paramIdx} OR e.cognome ILIKE $${paramIdx} OR e.partita_iva ILIKE $${paramIdx} OR e.codice_fiscale ILIKE $${paramIdx} OR e.email ILIKE $${paramIdx} OR e.pec ILIKE $${paramIdx} OR e.citta ILIKE $${paramIdx} OR e.cap ILIKE $${paramIdx} OR e.telefono ILIKE $${paramIdx} OR e.indirizzo ILIKE $${paramIdx})`
      );
      params.push(`%${search}%`);
      paramIdx++;
    }

    if (id_provincia) {
      conditions.push(`e.id_provincia = $${paramIdx}`);
      params.push(parseInt(id_provincia));
      paramIdx++;
    }

    if (id_intermediario) {
      conditions.push(`e.id_intermediario = $${paramIdx}`);
      params.push(parseInt(id_intermediario));
      paramIdx++;
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;
    const sortSafe = ['ragione_sociale', 'cognome', 'citta', 'email', 'partita_iva', 'data_inserimento'].includes(sort) ? sort : 'ragione_sociale';
    const orderSafe = ['ASC', 'DESC'].includes((order || '').toUpperCase()) ? order.toUpperCase() : 'ASC';

    try {
      const countResult = await query(
        `SELECT COUNT(*) FROM esecutori_esterni e ${whereClause}`,
        params
      );
      const total = parseInt(countResult.rows[0].count);

      const result = await query(
        `SELECT e.*, p.sigla AS provincia_sigla, p.nome AS provincia_nome,
                i.ragione_sociale AS intermediario_ragione_sociale
         FROM esecutori_esterni e
         LEFT JOIN province p ON p.id = e.id_provincia
         LEFT JOIN intermediari i ON i.id = e.id_intermediario
         ${whereClause}
         ORDER BY e.${sortSafe} ${orderSafe}
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
        `SELECT e.*, p.sigla AS provincia_sigla, p.nome AS provincia_nome,
                i.ragione_sociale AS intermediario_ragione_sociale
         FROM esecutori_esterni e
         LEFT JOIN province p ON p.id = e.id_provincia
         LEFT JOIN intermediari i ON i.id = e.id_intermediario
         WHERE e.id = $1 AND e.eliminato = false`,
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
    const b = request.body || {};
    if (!b.ragione_sociale && !(b.nome && b.cognome)) {
      return { error: 'ragione_sociale oppure (nome e cognome) sono obbligatori' };
    }
    const cols = []; const vals = []; const placeholders = [];
    let idx = 1;
    for (const c of ALLOWED_COLS) {
      if (b[c] !== undefined && b[c] !== null && b[c] !== '') {
        cols.push(c);
        vals.push(coerce(c, b[c]));
        placeholders.push('$' + idx++);
      }
    }
    try {
      const result = await query(
        `INSERT INTO esecutori_esterni (${cols.join(', ')}, eliminato, data_inserimento)
         VALUES (${placeholders.join(', ')}, false, NOW())
         RETURNING *`,
        vals
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
    const b = request.body || {};
    const sets = []; const vals = [];
    let idx = 1;
    for (const c of ALLOWED_COLS) {
      if (b[c] !== undefined) {
        sets.push(`${c} = $${idx++}`);
        vals.push(coerce(c, b[c]));
      }
    }
    if (sets.length === 0) return { error: 'Nessun campo da aggiornare' };
    sets.push(`data_modifica = NOW()`);
    vals.push(parseInt(id));
    try {
      const result = await query(
        `UPDATE esecutori_esterni SET ${sets.join(', ')}
         WHERE id = $${idx} AND eliminato = false
         RETURNING *`,
        vals
      );
      if (result.rows.length === 0) return { error: 'Esecutore esterno non trovato' };
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
      if (result.rows.length === 0) return { error: 'Esecutore esterno non trovato' };
      return { success: true, id: result.rows[0].id };
    } catch (err) {
      fastify.log.error(err, 'Delete esecutore esterno error');
      return { error: 'Errore eliminazione esecutore esterno', details: err.message };
    }
  });

  // ============================================================
  // GET /api/esecutori-esterni/search/term?term= - Autocomplete
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
  // GET /api/esecutori-esterni/check/univoco
  // ============================================================
  fastify.get('/check/univoco', async (request) => {
    const { tipo, valore, exclude_id } = request.query;
    if (!tipo || !valore) return { error: 'tipo e valore sono obbligatori' };
    const tipiValidi = ['partita_iva', 'codice_fiscale', 'codice_sdi'];
    if (!tipiValidi.includes(tipo)) {
      return { error: 'tipo non valido' };
    }
    try {
      let sql = `SELECT COUNT(*) FROM esecutori_esterni WHERE ${tipo} = $1 AND eliminato = false`;
      const params = [valore];
      if (exclude_id) { sql += ` AND id != $2`; params.push(parseInt(exclude_id)); }
      const result = await query(sql, params);
      const exists = parseInt(result.rows[0].count) > 0;
      return { available: !exists, tipo, valore, exists };
    } catch (err) {
      fastify.log.error(err, 'Check univoco error');
      return { error: 'Errore verifica univocità', details: err.message };
    }
  });

}
