import { query, transaction } from '../db/pool.js';
import { syncSingleFonte } from '../services/fonti-web-scheduler.js';

export default async function fontiWebRoutes(fastify, opts) {

  // ============================================================
  // GET /api/admin/fonti-web - Lista fonti web con filtri
  // ============================================================
  fastify.get('/', { preHandler: [fastify.authenticate, fastify.requireAdmin] }, async (request, reply) => {
    const { page = 1, limit = 20, search, id_categoria, id_tipologia } = request.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (search) {
      conditions.push(`(fw."nome" ILIKE $${paramIdx} OR fw."url" ILIKE $${paramIdx})`);
      params.push(`%${search}%`);
      paramIdx++;
    }
    if (id_categoria) {
      conditions.push(`fw."id_categoria" = $${paramIdx}`);
      params.push(id_categoria);
      paramIdx++;
    }
    if (id_tipologia) {
      conditions.push(`fw."id_tipologia" = $${paramIdx}`);
      params.push(id_tipologia);
      paramIdx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await query(
      `SELECT COUNT(*) as total FROM fonti_web fw ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].total);

    const result = await query(
      `SELECT
        fw."id" AS id,
        fw."nome" AS nome,
        fw."url" AS url,
        fw."id_categoria" AS id_categoria,
        fc."nome" AS categoria_nome,
        fw."id_tipologia" AS id_tipologia,
        ft."nome" AS tipologia_nome,
        fw."attiva" AS attiva,
        fw."intervallo_minuti" AS intervallo_minuti,
        fw."ultimo_controllo" AS ultimo_controllo,
        fw."ultimo_errore" AS ultimo_errore,
        fw."note" AS note
       FROM fonti_web fw
       LEFT JOIN fonti_categorie fc ON fw."id_categoria" = fc."id"
       LEFT JOIN fonti_tipologie ft ON fw."id_tipologia" = ft."id"
       ${whereClause}
       ORDER BY fw."nome" ASC
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
  // GET /api/admin/fonti-web/:id - Dettaglio fonte web
  // ============================================================
  fastify.get('/:id', { preHandler: [fastify.authenticate, fastify.requireAdmin] }, async (request, reply) => {
    const { id } = request.params;

    const result = await query(
      `SELECT
        fw."id" AS id,
        fw."nome" AS nome,
        fw."url" AS url,
        fw."id_categoria" AS id_categoria,
        fc."nome" AS categoria_nome,
        fw."id_tipologia" AS id_tipologia,
        ft."nome" AS tipologia_nome,
        fw."attiva" AS attiva,
        fw."intervallo_minuti" AS intervallo_minuti,
        fw."ultimo_controllo" AS ultimo_controllo,
        fw."ultimo_errore" AS ultimo_errore,
        fw."note" AS note,
        fw."regex_titolo" AS regex_titolo,
        fw."regex_data" AS regex_data,
        fw."regex_importo" AS regex_importo,
        fw."regex_cig" AS regex_cig
       FROM fonti_web fw
       LEFT JOIN fonti_categorie fc ON fw."id_categoria" = fc."id"
       LEFT JOIN fonti_tipologie ft ON fw."id_tipologia" = ft."id"
       WHERE fw."id" = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'Fonte web non trovata' });
    }

    // Fetch related testi_chiave and sync_check history
    const [testiChiave, syncHistory] = await Promise.all([
      query(`SELECT "id" AS id, "testo" AS testo FROM fonti_web_testi_chiave WHERE "id_fonte" = $1 ORDER BY "testo"`, [id]),
      query(`SELECT "id" AS id, "timestamp" AS timestamp, "nuovi_bandi" AS nuovi_bandi, "aggiornati" AS aggiornati, "errore" AS errore FROM fonti_web_sync_check WHERE "id_fonte" = $1 ORDER BY "timestamp" DESC LIMIT 10`, [id])
    ]);

    return {
      ...result.rows[0],
      testi_chiave: testiChiave.rows,
      sync_history: syncHistory.rows
    };
  });

  // ============================================================
  // POST /api/admin/fonti-web - Crea nuova fonte web
  // ============================================================
  fastify.post('/', { preHandler: [fastify.authenticate, fastify.requireAdmin] }, async (request, reply) => {
    const data = request.body;
    const user = request.user;

    const result = await transaction(async (client) => {
      const insertResult = await client.query(
        `INSERT INTO fonti_web (
          "nome", "url", "link", "id_categoria", "id_tipologia", "attiva", "attivo", "intervallo_minuti",
          "regex_titolo", "regex_data", "regex_importo", "regex_cig", "note"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING "id"`,
        [
          data.nome, data.url, data.url, // link = url (legacy compat)
          data.id_categoria || null, data.id_tipologia || null,
          data.attiva !== false, data.attiva !== false, // attivo = attiva (legacy compat)
          data.intervallo_minuti || 360,
          data.regex_titolo || null, data.regex_data || null, data.regex_importo || null,
          data.regex_cig || null, data.note || null
        ]
      );

      const fonteId = insertResult.rows[0].id;

      // Audit log
      await client.query(
        'INSERT INTO audit_log ("tabella", "id_record", "azione", "utente") VALUES ($1, $2, $3, $4)',
        ['fonti_web', fonteId, 'CREATE', user.username]
      );

      return fonteId;
    });

    return reply.status(201).send({ id: result, message: 'Fonte web creata con successo' });
  });

  // ============================================================
  // PUT /api/admin/fonti-web/:id - Aggiorna fonte web
  // ============================================================
  fastify.put('/:id', { preHandler: [fastify.authenticate, fastify.requireAdmin] }, async (request, reply) => {
    const { id } = request.params;
    const data = request.body;
    const user = request.user;

    const fields = [];
    const values = [];
    let idx = 1;

    const updatableFields = {
      'nome': 'nome',
      'url': 'url',
      'id_categoria': 'id_categoria',
      'id_tipologia': 'id_tipologia',
      'attiva': 'attiva',
      'intervallo_minuti': 'intervallo_minuti',
      'regex_titolo': 'regex_titolo',
      'regex_data': 'regex_data',
      'regex_importo': 'regex_importo',
      'regex_cig': 'regex_cig',
      'note': 'note'
    };

    for (const [key, dbCol] of Object.entries(updatableFields)) {
      if (data[key] !== undefined) {
        fields.push(`"${dbCol}" = $${idx}`);
        values.push(data[key]);
        idx++;
        // Sync legacy columns
        if (key === 'url') {
          fields.push(`"link" = $${idx}`);
          values.push(data[key]);
          idx++;
        }
        if (key === 'attiva') {
          fields.push(`"attivo" = $${idx}`);
          values.push(data[key]);
          idx++;
        }
      }
    }

    if (fields.length === 0) {
      return reply.status(400).send({ error: 'Nessun campo da aggiornare' });
    }

    values.push(id);
    const idIdx = idx;

    await transaction(async (client) => {
      await client.query(
        `UPDATE fonti_web SET ${fields.join(', ')} WHERE "id" = $${idIdx}`,
        values
      );

      await client.query(
        'INSERT INTO audit_log ("tabella", "id_record", "azione", "utente") VALUES ($1, $2, $3, $4)',
        ['fonti_web', id, 'UPDATE', user.username]
      );
    });

    return { message: 'Fonte web aggiornata con successo' };
  });

  // ============================================================
  // DELETE /api/admin/fonti-web/:id - Elimina fonte web
  // ============================================================
  fastify.delete('/:id', { preHandler: [fastify.authenticate, fastify.requireAdmin] }, async (request, reply) => {
    const { id } = request.params;
    const user = request.user;

    await transaction(async (client) => {
      // Check if source is used
      const usedCheck = await client.query(
        'SELECT COUNT(*) as cnt FROM bandi WHERE "id_fonte_web" = $1',
        [id]
      );

      if (parseInt(usedCheck.rows[0].cnt) > 0) {
        throw new Error('Fonte web è referenziata da bandi, impossibile eliminare');
      }

      // Delete related records
      await client.query('DELETE FROM fonti_web_testi_chiave WHERE "id_fonte" = $1', [id]);
      await client.query('DELETE FROM fonti_web_sync_check WHERE "id_fonte" = $1', [id]);

      // Delete source
      await client.query('DELETE FROM fonti_web WHERE "id" = $1', [id]);

      await client.query(
        'INSERT INTO audit_log ("tabella", "id_record", "azione", "utente") VALUES ($1, $2, $3, $4)',
        ['fonti_web', id, 'DELETE', user.username]
      );
    });

    return { message: 'Fonte web eliminata con successo' };
  });

  // ============================================================
  // POST /api/admin/fonti-web/:id/controlla - Esegui controllo
  // ============================================================
  fastify.post('/:id/controlla', { preHandler: [fastify.authenticate, fastify.requireAdmin] }, async (request, reply) => {
    const { id } = request.params;

    // Get full source info including regex
    const fonteResult = await query(
      `SELECT "id", "nome", "url", "intervallo_minuti",
              "ultimo_controllo", "ultimo_errore",
              "regex_titolo", "regex_data", "regex_importo", "regex_cig"
       FROM fonti_web WHERE "id" = $1`,
      [id]
    );

    if (fonteResult.rows.length === 0) {
      return reply.status(404).send({ error: 'Fonte web non trovata' });
    }

    const fonte = fonteResult.rows[0];

    try {
      const result = await syncSingleFonte(fonte);

      return {
        nuovi_bandi: result.nuoviBandi,
        aggiornati: result.aggiornati,
        status: result.status,
        duration_ms: result.durationMs,
        error: result.errorMessage || null,
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      return reply.status(500).send({
        error: `Errore durante il controllo: ${err.message}`,
        nuovi_bandi: 0,
        aggiornati: 0
      });
    }
  });

  // ============================================================
  // GET /api/admin/fonti-web/:id/differenze - Differenze dall'ultimo sync
  // ============================================================
  fastify.get('/:id/differenze', { preHandler: [fastify.authenticate, fastify.requireAdmin] }, async (request, reply) => {
    const { id } = request.params;

    const result = await query(
      `SELECT "id" AS id, "titolo" AS titolo, "url" AS url, "tipo_differenza" AS tipo, "data_rilevamento" AS data
       FROM fonti_web_differenze
       WHERE "id_fonte" = $1
       ORDER BY "data_rilevamento" DESC
       LIMIT 100`,
      [id]
    );

    return { data: result.rows };
  });

  // ============================================================
  // GET /api/admin/fonti-web/categorie - Lista categorie
  // ============================================================
  fastify.get('/categorie/lista', { preHandler: [fastify.authenticate, fastify.requireAdmin] }, async (request, reply) => {
    const result = await query(
      `SELECT "id" AS id, "nome" AS nome FROM fonti_categorie ORDER BY "nome" ASC`
    );

    return { data: result.rows };
  });

  // ============================================================
  // POST /api/admin/fonti-web/categorie - Crea categoria
  // ============================================================
  fastify.post('/categorie/create', { preHandler: [fastify.authenticate, fastify.requireAdmin] }, async (request, reply) => {
    const { nome } = request.body;
    const user = request.user;

    const result = await transaction(async (client) => {
      const insertResult = await client.query(
        `INSERT INTO fonti_categorie ("nome") VALUES ($1) RETURNING "id"`,
        [nome]
      );

      const catId = insertResult.rows[0].id;

      await client.query(
        'INSERT INTO audit_log ("tabella", "id_record", "azione", "utente") VALUES ($1, $2, $3, $4)',
        ['fonti_categorie', catId, 'CREATE', user.username]
      );

      return catId;
    });

    return reply.status(201).send({ id: result, message: 'Categoria creata con successo' });
  });

  // ============================================================
  // GET /api/admin/fonti-web/tipologie - Lista tipologie
  // ============================================================
  fastify.get('/tipologie/lista', { preHandler: [fastify.authenticate, fastify.requireAdmin] }, async (request, reply) => {
    const result = await query(
      `SELECT "id" AS id, "nome" AS nome FROM fonti_tipologie ORDER BY "nome" ASC`
    );

    return { data: result.rows };
  });

  // ============================================================
  // GET /api/admin/fonti-web/:id/testi-chiave - Lista testi chiave
  // ============================================================
  fastify.get('/:id/testi-chiave', { preHandler: [fastify.authenticate, fastify.requireAdmin] }, async (request, reply) => {
    const { id } = request.params;

    const result = await query(
      `SELECT "id" AS id, "testo" AS testo FROM fonti_web_testi_chiave WHERE "id_fonte" = $1 ORDER BY "testo" ASC`,
      [id]
    );

    return { data: result.rows };
  });

  // ============================================================
  // POST /api/admin/fonti-web/:id/testi-chiave - Aggiungi testo chiave
  // ============================================================
  fastify.post('/:id/testi-chiave', { preHandler: [fastify.authenticate, fastify.requireAdmin] }, async (request, reply) => {
    const { id } = request.params;
    const { testo } = request.body;
    const user = request.user;

    const result = await transaction(async (client) => {
      const insertResult = await client.query(
        `INSERT INTO fonti_web_testi_chiave ("id_fonte", "testo") VALUES ($1, $2) RETURNING "id"`,
        [id, testo]
      );

      const testoId = insertResult.rows[0].id;

      await client.query(
        'INSERT INTO audit_log ("tabella", "id_record", "azione", "utente") VALUES ($1, $2, $3, $4)',
        ['fonti_web_testi_chiave', testoId, 'CREATE', user.username]
      );

      return testoId;
    });

    return reply.status(201).send({ id: result, message: 'Testo chiave aggiunto con successo' });
  });

  // ============================================================
  // DELETE /api/admin/fonti-web/testi-chiave/:id - Elimina testo chiave
  // ============================================================
  fastify.delete('/testi-chiave/:id', { preHandler: [fastify.authenticate, fastify.requireAdmin] }, async (request, reply) => {
    const { id } = request.params;
    const user = request.user;

    await transaction(async (client) => {
      await client.query('DELETE FROM fonti_web_testi_chiave WHERE "id" = $1', [id]);

      await client.query(
        'INSERT INTO audit_log ("tabella", "id_record", "azione", "utente") VALUES ($1, $2, $3, $4)',
        ['fonti_web_testi_chiave', id, 'DELETE', user.username]
      );
    });

    return { message: 'Testo chiave eliminato con successo' };
  });

  // ============================================================
  // GET /api/admin/fonti-web/:id/sync-check - Cronologia sync
  // ============================================================
  fastify.get('/:id/sync-check', { preHandler: [fastify.authenticate, fastify.requireAdmin] }, async (request, reply) => {
    const { id } = request.params;
    const { limit = 50 } = request.query;

    const result = await query(
      `SELECT "id" AS id, "timestamp" AS timestamp, "nuovi_bandi" AS nuovi_bandi, "aggiornati" AS aggiornati, "errore" AS errore
       FROM fonti_web_sync_check
       WHERE "id_fonte" = $1
       ORDER BY "timestamp" DESC
       LIMIT $2`,
      [id, parseInt(limit)]
    );

    return { data: result.rows };
  });

  // ============================================================
  // GET /api/admin/fonti-web/regulars - Lista regex pattern
  // ============================================================
  fastify.get('/regulars/lista', { preHandler: [fastify.authenticate, fastify.requireAdmin] }, async (request, reply) => {
    const result = await query(
      `SELECT "id" AS id, "pattern" AS pattern, "tipo" AS tipo, "descrizione" AS descrizione
       FROM fonti_web_regex
       ORDER BY "tipo", "descrizione" ASC`
    );

    return { data: result.rows };
  });

  // ============================================================
  // POST /api/admin/fonti-web/regulars - Aggiungi regex pattern
  // ============================================================
  fastify.post('/regulars/create', { preHandler: [fastify.authenticate, fastify.requireAdmin] }, async (request, reply) => {
    const { pattern, tipo, descrizione } = request.body;
    const user = request.user;

    const result = await transaction(async (client) => {
      const insertResult = await client.query(
        `INSERT INTO fonti_web_regex ("pattern", "tipo", "descrizione") VALUES ($1, $2, $3) RETURNING "id"`,
        [pattern, tipo, descrizione]
      );

      const regexId = insertResult.rows[0].id;

      await client.query(
        'INSERT INTO audit_log ("tabella", "id_record", "azione", "utente") VALUES ($1, $2, $3, $4)',
        ['fonti_web_regex', regexId, 'CREATE', user.username]
      );

      return regexId;
    });

    return reply.status(201).send({ id: result, message: 'Regex pattern creato con successo' });
  });

  // ============================================================
  // PUT /api/admin/fonti-web/regulars/:id - Aggiorna regex
  // ============================================================
  fastify.put('/regulars/:id', { preHandler: [fastify.authenticate, fastify.requireAdmin] }, async (request, reply) => {
    const { id } = request.params;
    const { pattern, tipo, descrizione } = request.body;
    const user = request.user;

    await transaction(async (client) => {
      await client.query(
        `UPDATE fonti_web_regex SET "pattern" = $1, "tipo" = $2, "descrizione" = $3 WHERE "id" = $4`,
        [pattern, tipo, descrizione, id]
      );

      await client.query(
        'INSERT INTO audit_log ("tabella", "id_record", "azione", "utente") VALUES ($1, $2, $3, $4)',
        ['fonti_web_regex', id, 'UPDATE', user.username]
      );
    });

    return { message: 'Regex pattern aggiornato con successo' };
  });

  // ============================================================
  // DELETE /api/admin/fonti-web/regulars/:id - Elimina regex
  // ============================================================
  fastify.delete('/regulars/:id', { preHandler: [fastify.authenticate, fastify.requireAdmin] }, async (request, reply) => {
    const { id } = request.params;
    const user = request.user;

    await transaction(async (client) => {
      await client.query('DELETE FROM fonti_web_regex WHERE "id" = $1', [id]);

      await client.query(
        'INSERT INTO audit_log ("tabella", "id_record", "azione", "utente") VALUES ($1, $2, $3, $4)',
        ['fonti_web_regex', id, 'DELETE', user.username]
      );
    });

    return { message: 'Regex pattern eliminato con successo' };
  });

  // ============================================================
  // GET /api/admin/sinc-siti - Lista siti di sincronizzazione
  // ============================================================
  fastify.get('/sinc-siti/lista', { preHandler: [fastify.authenticate, fastify.requireAdmin] }, async (request, reply) => {
    const { page = 1, limit = 20 } = request.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

    const countResult = await query('SELECT COUNT(*) as total FROM sinc_siti');
    const total = parseInt(countResult.rows[0].total);

    const result = await query(
      `SELECT "id" AS id, "nome" AS nome, "url" AS url, "attiva" AS attiva
       FROM sinc_siti
       ORDER BY "nome" ASC
       LIMIT $1 OFFSET $2`,
      [parseInt(limit), offset]
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
  // POST /api/admin/sinc-siti - Crea sito di sincronizzazione
  // ============================================================
  fastify.post('/sinc-siti/create', { preHandler: [fastify.authenticate, fastify.requireAdmin] }, async (request, reply) => {
    const { nome, url, attiva } = request.body;
    const user = request.user;

    const result = await transaction(async (client) => {
      const insertResult = await client.query(
        `INSERT INTO sinc_siti ("nome", "url", "attiva") VALUES ($1, $2, $3) RETURNING "id"`,
        [nome, url, attiva !== false]
      );

      const sitId = insertResult.rows[0].id;

      await client.query(
        'INSERT INTO audit_log ("tabella", "id_record", "azione", "utente") VALUES ($1, $2, $3, $4)',
        ['sinc_siti', sitId, 'CREATE', user.username]
      );

      return sitId;
    });

    return reply.status(201).send({ id: result, message: 'Sito di sincronizzazione creato con successo' });
  });

  // ============================================================
  // PUT /api/admin/sinc-siti/:id - Aggiorna sito sincronizzazione
  // ============================================================
  fastify.put('/sinc-siti/:id', { preHandler: [fastify.authenticate, fastify.requireAdmin] }, async (request, reply) => {
    const { id } = request.params;
    const { nome, url, attiva } = request.body;
    const user = request.user;

    await transaction(async (client) => {
      await client.query(
        `UPDATE sinc_siti SET "nome" = $1, "url" = $2, "attiva" = $3 WHERE "id" = $4`,
        [nome, url, attiva, id]
      );

      await client.query(
        'INSERT INTO audit_log ("tabella", "id_record", "azione", "utente") VALUES ($1, $2, $3, $4)',
        ['sinc_siti', id, 'UPDATE', user.username]
      );
    });

    return { message: 'Sito di sincronizzazione aggiornato con successo' };
  });

  // ============================================================
  // DELETE /api/admin/sinc-siti/:id - Elimina sito sincronizzazione
  // ============================================================
  fastify.delete('/sinc-siti/:id', { preHandler: [fastify.authenticate, fastify.requireAdmin] }, async (request, reply) => {
    const { id } = request.params;
    const user = request.user;

    await transaction(async (client) => {
      await client.query('DELETE FROM sinc_siti WHERE "id" = $1', [id]);

      await client.query(
        'INSERT INTO audit_log ("tabella", "id_record", "azione", "utente") VALUES ($1, $2, $3, $4)',
        ['sinc_siti', id, 'DELETE', user.username]
      );
    });

    return { message: 'Sito di sincronizzazione eliminato con successo' };
  });

  // ============================================================
  // GET /api/admin/sinc-siti/categorie - Categorie sincronizzazione
  // ============================================================
  fastify.get('/sinc-siti/categorie/lista', { preHandler: [fastify.authenticate, fastify.requireAdmin] }, async (request, reply) => {
    const result = await query(
      `SELECT "id" AS id, "nome" AS nome FROM sinc_categorie ORDER BY "nome" ASC`
    );

    return { data: result.rows };
  });

  // ============================================================
  // GET /api/admin/sinc-siti/espressioni - Espressioni sincronizzazione
  // ============================================================
  fastify.get('/sinc-siti/espressioni/lista', { preHandler: [fastify.authenticate, fastify.requireAdmin] }, async (request, reply) => {
    const result = await query(
      `SELECT "id" AS id, "espressione" AS espressione, "id_categoria" AS id_categoria
       FROM sinc_espressioni ORDER BY "espressione" ASC`
    );

    return { data: result.rows };
  });

}
