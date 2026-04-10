import { query } from '../db/pool.js';

const ALLOWED_COLS = [
  'ragione_sociale', 'nome', 'cognome',
  'indirizzo', 'cap', 'citta', 'id_provincia',
  'telefono', 'fax', 'email', 'pec', 'sito_web',
  'partita_iva', 'codice_fiscale', 'codice_sdi',
  'referente', 'note',
  'prezzo_propria_zona', 'prezzo_altre_zone', 'visibile_a_tutti'
];

const INT_COLS = new Set(['id_provincia']);
const NUM_COLS = new Set(['prezzo_propria_zona', 'prezzo_altre_zone']);
const BOOL_COLS = new Set(['visibile_a_tutti']);

function coerce(c, v) {
  if (v === undefined || v === null || v === '') return null;
  if (INT_COLS.has(c)) return parseInt(v) || null;
  if (NUM_COLS.has(c)) return parseFloat(v) || 0;
  if (BOOL_COLS.has(c)) return v === true || v === 'true' || v === 1 || v === '1';
  return v;
}

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
    const conditions = ['i.eliminato = false'];
    const params = [];
    let paramIdx = 1;

    if (search) {
      conditions.push(
        `(i.ragione_sociale ILIKE $${paramIdx} OR i.nome ILIKE $${paramIdx} OR i.cognome ILIKE $${paramIdx} OR i.partita_iva ILIKE $${paramIdx} OR i.email ILIKE $${paramIdx})`
      );
      params.push(`%${search}%`);
      paramIdx++;
    }

    if (id_provincia) {
      conditions.push(`i.id_provincia = $${paramIdx}`);
      params.push(parseInt(id_provincia));
      paramIdx++;
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;
    const sortSafe = ['ragione_sociale', 'citta', 'email', 'partita_iva', 'data_inserimento', 'cognome'].includes(sort) ? sort : 'ragione_sociale';
    const orderSafe = ['ASC', 'DESC'].includes((order || '').toUpperCase()) ? order.toUpperCase() : 'ASC';

    try {
      const countResult = await query(
        `SELECT COUNT(*) FROM intermediari i ${whereClause}`,
        params
      );
      const total = parseInt(countResult.rows[0].count);

      const result = await query(
        `SELECT i.*, p.sigla AS provincia_sigla, p.nome AS provincia_nome
         FROM intermediari i
         LEFT JOIN province p ON p.id = i.id_provincia
         ${whereClause}
         ORDER BY i.${sortSafe} ${orderSafe}
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
        `SELECT i.*, p.sigla AS provincia_sigla, p.nome AS provincia_nome
         FROM intermediari i
         LEFT JOIN province p ON p.id = i.id_provincia
         WHERE i.id = $1 AND i.eliminato = false`,
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
    const b = request.body || {};
    if (!b.ragione_sociale) {
      return { error: 'ragione_sociale è obbligatorio' };
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
        `INSERT INTO intermediari (${cols.join(', ')}, eliminato, data_inserimento)
         VALUES (${placeholders.join(', ')}, false, NOW())
         RETURNING *`,
        vals
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
        `UPDATE intermediari SET ${sets.join(', ')}
         WHERE id = $${idx} AND eliminato = false
         RETURNING *`,
        vals
      );
      if (result.rows.length === 0) return { error: 'Intermediario non trovato' };
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
      if (result.rows.length === 0) return { error: 'Intermediario non trovato' };
      return { success: true, id: result.rows[0].id };
    } catch (err) {
      fastify.log.error(err, 'Delete intermediario error');
      return { error: 'Errore eliminazione intermediario', details: err.message };
    }
  });

  // ============================================================
  // GET /api/intermediari/search/term?term= - Autocomplete
  // ============================================================
  fastify.get('/search/term', async (request) => {
    const { term = '' } = request.query;
    try {
      const result = await query(
        `SELECT id, ragione_sociale, nome, cognome, citta, email FROM intermediari
         WHERE (ragione_sociale ILIKE $1 OR nome ILIKE $1 OR cognome ILIKE $1 OR email ILIKE $1) AND eliminato = false
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
  // GET /api/intermediari/check/univoco
  // ============================================================
  fastify.get('/check/univoco', async (request) => {
    const { tipo, valore, exclude_id } = request.query;
    if (!tipo || !valore) return { error: 'tipo e valore sono obbligatori' };
    const tipiValidi = ['partita_iva', 'codice_fiscale', 'codice_sdi'];
    if (!tipiValidi.includes(tipo)) {
      return { error: 'tipo non valido' };
    }
    try {
      let sql = `SELECT COUNT(*) FROM intermediari WHERE ${tipo} = $1 AND eliminato = false`;
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
