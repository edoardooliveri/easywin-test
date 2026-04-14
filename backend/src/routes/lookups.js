import { query } from '../db/pool.js';
import { computeGraduatoria, METODI_DISPONIBILI } from '../services/criteri-calcolo.js';

export default async function lookupRoutes(fastify, opts) {

  // GET /api/lookups/criteri/metodi-disponibili  (for admin form select)
  fastify.get('/criteri/metodi-disponibili', async () => {
    return METODI_DISPONIBILI;
  });

  // GET /api/lookups/regioni
  fastify.get('/regioni', async () => {
    const result = await query(
      'SELECT id, nome, codice_istat AS posizione FROM regioni ORDER BY nome'
    );
    return result.rows;
  });

  // GET /api/lookups/province?regione=id
  fastify.get('/province', async (request) => {
    const { regione } = request.query;
    let sql = `SELECT p.id AS id, p.nome AS nome, p.sigla AS sigla,
               r.nome AS regione
               FROM province p LEFT JOIN regioni r ON p.id_regione = r.id`;
    const params = [];
    if (regione) {
      sql += ' WHERE p.id_regione = $1';
      params.push(parseInt(regione));
    }
    sql += ' ORDER BY p.nome';
    const result = await query(sql, params);
    return result.rows;
  });

  // GET /api/lookups/stazioni?search=term
  fastify.get('/stazioni', async (request) => {
    const { search, limit = 20 } = request.query;
    if (search && search.length >= 2) {
      const result = await query(
        `SELECT id, nome AS nome, citta
         FROM stazioni WHERE attivo = true AND nome ILIKE $1
         ORDER BY nome LIMIT $2`,
        [`%${search}%`, parseInt(limit)]
      );
      return result.rows;
    }
    const result = await query(
      `SELECT id, nome AS nome, citta
       FROM stazioni WHERE attivo = true ORDER BY nome LIMIT $1`,
      [parseInt(limit)]
    );
    return result.rows;
  });

  // GET /api/lookups/soa
  fastify.get('/soa', async () => {
    const result = await query(
      'SELECT id, codice, descrizione, tipo FROM soa ORDER BY codice'
    );
    return result.rows;
  });

  // GET /api/lookups/tipologie-gare
  fastify.get('/tipologie-gare', async () => {
    try {
      const result = await query(
        `SELECT "id" AS id, "nome" AS nome, "visibile" AS visibile,
                "simulabile" AS simulabile, "priority" AS priority
         FROM tipologia_gare
         ORDER BY "priority" NULLS LAST, "nome"`
      );
      return result.rows;
    } catch (e) {
      const result = await query(
        `SELECT "id" AS id, "nome" AS nome
         FROM tipologia_gare WHERE "attivo" = true ORDER BY "nome"`
      );
      return result.rows;
    }
  });

  // GET /api/lookups/tipi-dati-gara - tipologia dati esito (Completa / Elenco / N part / Nessuno / Non conclusa)
  fastify.get('/tipi-dati-gara', async () => {
    try {
      const result = await query(
        `SELECT "id" AS id, "tipo" AS nome, "priority" AS priority
         FROM tipo_dati_gara ORDER BY "priority" NULLS LAST, "id"`
      );
      return result.rows;
    } catch (e) {
      // Fallback to the canonical 5-value list if the table layout differs
      return [
        { id: 1, nome: 'Completa', priority: 1 },
        { id: 2, nome: 'Elenco aziende Partecipanti e Ribasso solo del Vincitore', priority: 2 },
        { id: 3, nome: 'N° Partecipanti e Ribasso del Vincitore', priority: 3 },
        { id: 4, nome: 'Nessun partecipante', priority: 4 },
        { id: 5, nome: 'Gara non conclusa', priority: 5 }
      ];
    }
  });

  // GET /api/lookups/tipologie-bandi
  fastify.get('/tipologie-bandi', async () => {
    const result = await query(
      `SELECT id, nome
       FROM tipologia_bandi WHERE attivo = true ORDER BY nome`
    );
    return result.rows;
  });

  // GET /api/lookups/criteri
  fastify.get('/criteri', async () => {
    const result = await query(
      `SELECT id, nome
       FROM criteri WHERE attivo = true ORDER BY nome`
    );
    return result.rows;
  });

  // ══════════════════════════════════════════════════════════════════
  //  ADMIN CRUD for TIPOLOGIE BANDI
  // ══════════════════════════════════════════════════════════════════

  // GET all (including inactive) — admin list view
  fastify.get('/tipologie-bandi/all', async () => {
    const result = await query(
      `SELECT id, nome, descrizione, attivo
       FROM tipologia_bandi ORDER BY id`
    );
    return result.rows;
  });

  // POST create
  fastify.post('/tipologie-bandi', async (request, reply) => {
    const { nome, descrizione, attivo } = request.body || {};
    if (!nome || !String(nome).trim()) {
      return reply.code(400).send({ error: 'Nome obbligatorio' });
    }
    const result = await query(
      `INSERT INTO tipologia_bandi (nome, descrizione, attivo)
       VALUES ($1, $2, COALESCE($3, true))
       RETURNING id, nome, descrizione, attivo`,
      [String(nome).trim(), descrizione || null, attivo]
    );
    return result.rows[0];
  });

  // PUT update
  fastify.put('/tipologie-bandi/:id', async (request, reply) => {
    const id = parseInt(request.params.id);
    if (!id) return reply.code(400).send({ error: 'ID non valido' });
    const { nome, descrizione, attivo } = request.body || {};
    const result = await query(
      `UPDATE tipologia_bandi
          SET nome = COALESCE($2, nome),
              descrizione = $3,
              attivo = COALESCE($4, attivo)
        WHERE id = $1
       RETURNING id, nome, descrizione, attivo`,
      [id, nome != null ? String(nome).trim() : null, descrizione != null ? descrizione : null, attivo]
    );
    if (!result.rows.length) return reply.code(404).send({ error: 'Non trovato' });
    return result.rows[0];
  });

  // ══════════════════════════════════════════════════════════════════
  //  ADMIN CRUD for CRITERI DI AGGIUDICAZIONE
  // ══════════════════════════════════════════════════════════════════

  // GET all (including inactive) — admin list view
  fastify.get('/criteri/all', async () => {
    const result = await query(
      `SELECT id, nome, codice, descrizione, descrizione_calcolo, metodo_calcolo, attivo
       FROM criteri ORDER BY id`
    );
    return result.rows;
  });

  // GET single criterio (with formula info)
  fastify.get('/criteri/:id', async (request, reply) => {
    const id = parseInt(request.params.id);
    if (!id) return reply.code(400).send({ error: 'ID non valido' });
    const result = await query(
      `SELECT id, nome, codice, descrizione, descrizione_calcolo, metodo_calcolo, attivo
       FROM criteri WHERE id = $1`,
      [id]
    );
    if (!result.rows.length) return reply.code(404).send({ error: 'Non trovato' });
    return result.rows[0];
  });

  // POST create
  fastify.post('/criteri', async (request, reply) => {
    const { nome, codice, descrizione, descrizione_calcolo, metodo_calcolo, attivo } = request.body || {};
    if (!nome || !String(nome).trim()) {
      return reply.code(400).send({ error: 'Nome obbligatorio' });
    }
    const result = await query(
      `INSERT INTO criteri (nome, codice, descrizione, descrizione_calcolo, metodo_calcolo, attivo)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, true))
       RETURNING id, nome, codice, descrizione, descrizione_calcolo, metodo_calcolo, attivo`,
      [
        String(nome).trim(),
        codice || null,
        descrizione || null,
        descrizione_calcolo || null,
        metodo_calcolo || null,
        attivo
      ]
    );
    return result.rows[0];
  });

  // PUT update
  fastify.put('/criteri/:id', async (request, reply) => {
    const id = parseInt(request.params.id);
    if (!id) return reply.code(400).send({ error: 'ID non valido' });
    const { nome, codice, descrizione, descrizione_calcolo, metodo_calcolo, attivo } = request.body || {};
    const result = await query(
      `UPDATE criteri
          SET nome = COALESCE($2, nome),
              codice = $3,
              descrizione = $4,
              descrizione_calcolo = $5,
              metodo_calcolo = $6,
              attivo = COALESCE($7, attivo)
        WHERE id = $1
       RETURNING id, nome, codice, descrizione, descrizione_calcolo, metodo_calcolo, attivo`,
      [
        id,
        nome != null ? String(nome).trim() : null,
        codice != null ? codice : null,
        descrizione != null ? descrizione : null,
        descrizione_calcolo != null ? descrizione_calcolo : null,
        metodo_calcolo != null ? metodo_calcolo : null,
        attivo
      ]
    );
    if (!result.rows.length) return reply.code(404).send({ error: 'Non trovato' });
    return result.rows[0];
  });

  // ══════════════════════════════════════════════════════════════════
  //  COMPUTE GRADUATORIA — calcolo automatico dal motore
  //  POST /api/lookups/criteri/:id/compute
  //  body: { offerte: [...], opts?: {...} }
  //  Il metodo viene letto dalla colonna `metodo_calcolo` del criterio.
  //  È possibile anche passare metodo esplicito nel body per override.
  // ══════════════════════════════════════════════════════════════════
  fastify.post('/criteri/:id/compute', async (request, reply) => {
    const id = parseInt(request.params.id);
    if (!id) return reply.code(400).send({ error: 'ID non valido' });
    const { offerte, opts, metodo: metodoOverride } = request.body || {};
    if (!Array.isArray(offerte)) {
      return reply.code(400).send({ error: 'Offerte obbligatorie (array)' });
    }
    const row = await query(
      'SELECT id, nome, metodo_calcolo, descrizione_calcolo FROM criteri WHERE id = $1',
      [id]
    );
    if (!row.rows.length) return reply.code(404).send({ error: 'Criterio non trovato' });
    const criterio = row.rows[0];
    const metodo = metodoOverride || criterio.metodo_calcolo;
    if (!metodo) {
      return reply.code(400).send({
        error: 'Criterio privo di metodo_calcolo. Impossibile calcolare automaticamente.',
        criterio
      });
    }
    try {
      const result = computeGraduatoria(metodo, offerte, opts || {});
      return {
        criterio: {
          id: criterio.id,
          nome: criterio.nome,
          metodo_calcolo: metodo,
          descrizione_calcolo: criterio.descrizione_calcolo
        },
        ...result
      };
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ error: 'Errore calcolo graduatoria', message: err.message });
    }
  });

  // GET /api/lookups/piattaforme
  fastify.get('/piattaforme', async () => {
    const result = await query(
      'SELECT id, nome, url FROM piattaforme ORDER BY nome'
    );
    return result.rows;
  });

  // GET /api/lookups/stats - Statistiche generali
  fastify.get('/stats', async () => {
    const result = await query(`
      SELECT
        (SELECT COUNT(*) FROM bandi) AS totale_bandi,
        (SELECT COUNT(*) FROM gare WHERE annullato = false) AS totale_gare,
        (SELECT COUNT(*) FROM aziende WHERE attivo = true) AS totale_aziende,
        (SELECT COUNT(*) FROM stazioni WHERE attivo = true) AS totale_stazioni,
        (SELECT COUNT(*) FROM simulazioni) AS totale_simulazioni,
        (SELECT COUNT(*) FROM users) AS totale_utenti
    `);
    return result.rows[0];
  });
}
