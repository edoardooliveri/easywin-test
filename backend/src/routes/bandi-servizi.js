import { query } from '../db/pool.js';

// ============================================================
// BRIDGE GESTIONALE → PORTALE CLIENTI
// Quando l'admin crea un servizio (sopralluogo/scrittura/apertura)
// per un'azienda specifica, il bando deve apparire nel registro
// bandi dei clienti di quell'azienda nel portale.
// ============================================================
async function bridgeServizioToPortale({ fastify, idBando, idAzienda, tipoLabel }) {
  if (!idBando || !idAzienda) return;
  try {
    // Recupera tutti gli utenti dell'azienda (colonna id_azienda o IDAzienda)
    let users = [];
    try {
      const u = await query(
        `SELECT username FROM users WHERE id_azienda = $1`,
        [idAzienda]
      );
      users = u.rows.map(r => r.username).filter(Boolean);
    } catch (_) {
      try {
        const u = await query(
          `SELECT username FROM users WHERE "IDAzienda" = $1`,
          [idAzienda]
        );
        users = u.rows.map(r => r.username).filter(Boolean);
      } catch (_) {}
    }
    if (!users.length) return;

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const dataStr = `${pad(now.getDate())}/${pad(now.getMonth()+1)}/${now.getFullYear()}`;
    const oraStr  = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const line = `EasyWin ha registrato ${tipoLabel} per la tua azienda il ${dataStr} alle ${oraStr}`;

    for (const username of users) {
      const rg = await query(
        `SELECT id, note_registro FROM registro_gare_clienti WHERE id_bando = $1 AND username = $2 LIMIT 1`,
        [idBando, username]
      );
      if (rg.rows.length === 0) {
        await query(
          `INSERT INTO registro_gare_clienti (id_bando, username, note_registro, data_inserimento)
           VALUES ($1, $2, $3, NOW())`,
          [idBando, username, line]
        );
      } else {
        const prev = rg.rows[0].note_registro ? String(rg.rows[0].note_registro) + '\n' : '';
        await query(
          `UPDATE registro_gare_clienti SET note_registro = $1 WHERE id = $2`,
          [prev + line, rg.rows[0].id]
        );
      }
    }
  } catch (e) {
    fastify.log.warn({ err: e.message }, 'bridgeServizioToPortale failed (non-bloccante)');
  }
}

export default async function bandiServiziRoutes(fastify, opts) {

  // Decode JWT if present (routes check request.user individually)
  fastify.addHook('onRequest', async (request, reply) => {
    try { await request.jwtVerify(); } catch { /* optional auth */ }
  });

  // ============================================================
  // APERTURE (TENDER OPENINGS)
  // ============================================================

  // GET /api/bandi/:id/aperture - List all aperture for a bando
  fastify.get('/:id/aperture', async (request, reply) => {
    const { id } = request.params;
    const { page = 1, limit = 20 } = request.query;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

    try {
      const result = await query(
        `SELECT * FROM aperture
         WHERE id_bando = $1
         ORDER BY data DESC, ora DESC
         LIMIT $2 OFFSET $3`,
        [id, limit, offset]
      );

      const totalResult = await query(
        'SELECT COUNT(*) as count FROM aperture WHERE id_bando = $1',
        [id]
      );

      return reply.send({
        data: result.rows,
        total: parseInt(totalResult.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit)
      });
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // GET /api/bandi/aperture/:id - Get single apertura detail
  fastify.get('/aperture/:id', async (request, reply) => {
    const { id } = request.params;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    try {
      const result = await query(
        'SELECT * FROM aperture WHERE id = $1',
        [id]
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Apertura not found' });
      }

      return reply.send(result.rows[0]);
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // POST /api/bandi/:id/aperture - Create apertura
  fastify.post('/:id/aperture', async (request, reply) => {
    const { id } = request.params;
    const {
      data, ora, id_azienda, id_intermediario, id_esecutore_esterno,
      prezzo_utente, prezzo_azienda, prezzo_intermediario,
      pagato_utente, pagato_azienda, pagato_intermediario,
      username, tipo, stato, note
    } = request.body;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    try {
      const result = await query(
        `INSERT INTO aperture (
          id_bando, data, ora, id_azienda, id_intermediario, id_esecutore_esterno,
          prezzo_utente, prezzo_azienda, prezzo_intermediario,
          pagato_utente, pagato_azienda, pagato_intermediario,
          username, tipo, stato, note, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
        RETURNING *`,
        [id, data, ora, id_azienda, id_intermediario, id_esecutore_esterno,
         prezzo_utente, prezzo_azienda, prezzo_intermediario,
         pagato_utente || false, pagato_azienda || false, pagato_intermediario || false,
         username, tipo, stato || 'in_sospeso', note]
      );

      await bridgeServizioToPortale({ fastify, idBando: id, idAzienda: id_azienda, tipoLabel: "un'APERTURA" });
      return reply.code(201).send(result.rows[0]);
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // PUT /api/bandi/aperture/:id - Update apertura
  fastify.put('/aperture/:id', async (request, reply) => {
    const { id } = request.params;
    const {
      data, ora, id_azienda, id_intermediario, id_esecutore_esterno,
      prezzo_utente, prezzo_azienda, prezzo_intermediario,
      pagato_utente, pagato_azienda, pagato_intermediario,
      username, tipo, stato, note
    } = request.body;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    try {
      const result = await query(
        `UPDATE aperture SET
          data = COALESCE($1, data),
          ora = COALESCE($2, ora),
          id_azienda = COALESCE($3, id_azienda),
          id_intermediario = COALESCE($4, id_intermediario),
          id_esecutore_esterno = COALESCE($5, id_esecutore_esterno),
          prezzo_utente = COALESCE($6, prezzo_utente),
          prezzo_azienda = COALESCE($7, prezzo_azienda),
          prezzo_intermediario = COALESCE($8, prezzo_intermediario),
          pagato_utente = COALESCE($9, pagato_utente),
          pagato_azienda = COALESCE($10, pagato_azienda),
          pagato_intermediario = COALESCE($11, pagato_intermediario),
          username = COALESCE($12, username),
          tipo = COALESCE($13, tipo),
          stato = COALESCE($14, stato),
          note = COALESCE($15, note),
          updated_at = NOW()
         WHERE id = $16
         RETURNING *`,
        [data, ora, id_azienda, id_intermediario, id_esecutore_esterno,
         prezzo_utente, prezzo_azienda, prezzo_intermediario,
         pagato_utente, pagato_azienda, pagato_intermediario,
         username, tipo, stato, note, id]
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Apertura not found' });
      }

      return reply.send(result.rows[0]);
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // DELETE /api/bandi/aperture/:id - Delete apertura
  fastify.delete('/aperture/:id', async (request, reply) => {
    const { id } = request.params;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    try {
      const result = await query(
        'DELETE FROM aperture WHERE id = $1 RETURNING id',
        [id]
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Apertura not found' });
      }

      return reply.code(204).send();
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // POST /api/bandi/aperture/:id/assegna - Assign apertura to user/agent
  fastify.post('/aperture/:id/assegna', async (request, reply) => {
    const { id } = request.params;
    const { username, id_intermediario } = request.body;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    try {
      const result = await query(
        `UPDATE aperture SET
          username = $1,
          id_intermediario = COALESCE($2, id_intermediario),
          updated_at = NOW()
         WHERE id = $3
         RETURNING *`,
        [username, id_intermediario, id]
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Apertura not found' });
      }

      return reply.send(result.rows[0]);
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // GET /api/bandi/:id/aperture-template - Get apertura template
  fastify.get('/:id/aperture-template', async (request, reply) => {
    const { id } = request.params;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    try {
      const result = await query(
        'SELECT * FROM aperture_templates WHERE id_bando = $1',
        [id]
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Template not found' });
      }

      return reply.send(result.rows[0]);
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // POST /api/bandi/:id/aperture-template - Save/update template
  fastify.post('/:id/aperture-template', async (request, reply) => {
    const { id } = request.params;
    const {
      data, ora, id_azienda, id_intermediario, id_esecutore_esterno,
      prezzo_utente, prezzo_azienda, prezzo_intermediario,
      pagato_utente, pagato_azienda, pagato_intermediario,
      username, tipo, stato, note
    } = request.body;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    try {
      // Check if template exists
      const existing = await query(
        'SELECT id FROM aperture_templates WHERE id_bando = $1',
        [id]
      );

      let result;
      if (existing.rows.length > 0) {
        result = await query(
          `UPDATE aperture_templates SET
            data = $1, ora = $2, id_azienda = $3, id_intermediario = $4,
            id_esecutore_esterno = $5, prezzo_utente = $6, prezzo_azienda = $7,
            prezzo_intermediario = $8, pagato_utente = $9, pagato_azienda = $10,
            pagato_intermediario = $11, username = $12, tipo = $13, stato = $14,
            note = $15, updated_at = NOW()
           WHERE id_bando = $16
           RETURNING *`,
          [data, ora, id_azienda, id_intermediario, id_esecutore_esterno,
           prezzo_utente, prezzo_azienda, prezzo_intermediario,
           pagato_utente || false, pagato_azienda || false, pagato_intermediario || false,
           username, tipo, stato, note, id]
        );
      } else {
        result = await query(
          `INSERT INTO aperture_templates (
            id_bando, data, ora, id_azienda, id_intermediario, id_esecutore_esterno,
            prezzo_utente, prezzo_azienda, prezzo_intermediario,
            pagato_utente, pagato_azienda, pagato_intermediario,
            username, tipo, stato, note, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
           RETURNING *`,
          [id, data, ora, id_azienda, id_intermediario, id_esecutore_esterno,
           prezzo_utente, prezzo_azienda, prezzo_intermediario,
           pagato_utente || false, pagato_azienda || false, pagato_intermediario || false,
           username, tipo, stato, note]
        );
      }

      return reply.code(result.rowCount > 0 ? 200 : 201).send(result.rows[0]);
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // POST posticipa-apertura is defined in bandi.js (same prefix) — no duplicate here

  // ============================================================
  // SCRITTURE (DOCUMENT WRITINGS)
  // ============================================================

  // GET /api/bandi/:id/scritture - List all scritture
  fastify.get('/:id/scritture', async (request, reply) => {
    const { id } = request.params;
    const { page = 1, limit = 20 } = request.query;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

    try {
      const result = await query(
        `SELECT * FROM scritture
         WHERE id_bando = $1
         ORDER BY data DESC, ora DESC
         LIMIT $2 OFFSET $3`,
        [id, limit, offset]
      );

      const totalResult = await query(
        'SELECT COUNT(*) as count FROM scritture WHERE id_bando = $1',
        [id]
      );

      return reply.send({
        data: result.rows,
        total: parseInt(totalResult.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit)
      });
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // GET /api/bandi/scritture/:id - Get single scrittura
  fastify.get('/scritture/:id', async (request, reply) => {
    const { id } = request.params;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    try {
      const result = await query(
        'SELECT * FROM scritture WHERE id = $1',
        [id]
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Scrittura not found' });
      }

      return reply.send(result.rows[0]);
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // POST /api/bandi/:id/scritture - Create scrittura
  fastify.post('/:id/scritture', async (request, reply) => {
    const { id } = request.params;
    const {
      data, ora, id_azienda, id_intermediario, id_esecutore_esterno,
      prezzo_utente, prezzo_azienda, prezzo_intermediario,
      pagato_utente, pagato_azienda, pagato_intermediario,
      username, tipo, stato, note
    } = request.body;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    try {
      const result = await query(
        `INSERT INTO scritture (
          id_bando, data, ora, id_azienda, id_intermediario, id_esecutore_esterno,
          prezzo_utente, prezzo_azienda, prezzo_intermediario,
          pagato_utente, pagato_azienda, pagato_intermediario,
          username, tipo, stato, note, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
        RETURNING *`,
        [id, data, ora, id_azienda, id_intermediario, id_esecutore_esterno,
         prezzo_utente, prezzo_azienda, prezzo_intermediario,
         pagato_utente || false, pagato_azienda || false, pagato_intermediario || false,
         username, tipo, stato || 'in_sospeso', note]
      );

      await bridgeServizioToPortale({ fastify, idBando: id, idAzienda: id_azienda, tipoLabel: 'una SCRITTURA' });
      return reply.code(201).send(result.rows[0]);
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // PUT /api/bandi/scritture/:id - Update scrittura
  fastify.put('/scritture/:id', async (request, reply) => {
    const { id } = request.params;
    const {
      data, ora, id_azienda, id_intermediario, id_esecutore_esterno,
      prezzo_utente, prezzo_azienda, prezzo_intermediario,
      pagato_utente, pagato_azienda, pagato_intermediario,
      username, tipo, stato, note
    } = request.body;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    try {
      const result = await query(
        `UPDATE scritture SET
          data = COALESCE($1, data),
          ora = COALESCE($2, ora),
          id_azienda = COALESCE($3, id_azienda),
          id_intermediario = COALESCE($4, id_intermediario),
          id_esecutore_esterno = COALESCE($5, id_esecutore_esterno),
          prezzo_utente = COALESCE($6, prezzo_utente),
          prezzo_azienda = COALESCE($7, prezzo_azienda),
          prezzo_intermediario = COALESCE($8, prezzo_intermediario),
          pagato_utente = COALESCE($9, pagato_utente),
          pagato_azienda = COALESCE($10, pagato_azienda),
          pagato_intermediario = COALESCE($11, pagato_intermediario),
          username = COALESCE($12, username),
          tipo = COALESCE($13, tipo),
          stato = COALESCE($14, stato),
          note = COALESCE($15, note),
          updated_at = NOW()
         WHERE id = $16
         RETURNING *`,
        [data, ora, id_azienda, id_intermediario, id_esecutore_esterno,
         prezzo_utente, prezzo_azienda, prezzo_intermediario,
         pagato_utente, pagato_azienda, pagato_intermediario,
         username, tipo, stato, note, id]
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Scrittura not found' });
      }

      return reply.send(result.rows[0]);
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // DELETE /api/bandi/scritture/:id - Delete scrittura
  fastify.delete('/scritture/:id', async (request, reply) => {
    const { id } = request.params;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    try {
      const result = await query(
        'DELETE FROM scritture WHERE id = $1 RETURNING id',
        [id]
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Scrittura not found' });
      }

      return reply.code(204).send();
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // PUT /api/bandi/scritture/:id/stato - Update status (AssegnaStato)
  fastify.put('/scritture/:id/stato', async (request, reply) => {
    const { id } = request.params;
    const { stato } = request.body;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    try {
      const result = await query(
        `UPDATE scritture SET
          stato = $1,
          updated_at = NOW()
         WHERE id = $2
         RETURNING *`,
        [stato, id]
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Scrittura not found' });
      }

      return reply.send(result.rows[0]);
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // PUT /api/bandi/scritture/:id/eseguito - Mark as executed
  fastify.put('/scritture/:id/eseguito', async (request, reply) => {
    const { id } = request.params;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    try {
      const result = await query(
        `UPDATE scritture SET
          stato = 'eseguito',
          updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [id]
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Scrittura not found' });
      }

      return reply.send(result.rows[0]);
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // PUT /api/bandi/scritture/:id/assegna-utente - Assign user
  fastify.put('/scritture/:id/assegna-utente', async (request, reply) => {
    const { id } = request.params;
    const { username, id_intermediario } = request.body;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    try {
      const result = await query(
        `UPDATE scritture SET
          username = $1,
          id_intermediario = COALESCE($2, id_intermediario),
          updated_at = NOW()
         WHERE id = $3
         RETURNING *`,
        [username, id_intermediario, id]
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Scrittura not found' });
      }

      return reply.send(result.rows[0]);
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // GET /api/bandi/:id/scritture-template - Get template
  fastify.get('/:id/scritture-template', async (request, reply) => {
    const { id } = request.params;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    try {
      const result = await query(
        'SELECT * FROM scritture_templates WHERE id_bando = $1',
        [id]
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Template not found' });
      }

      return reply.send(result.rows[0]);
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // POST /api/bandi/:id/scritture-template - Save template
  fastify.post('/:id/scritture-template', async (request, reply) => {
    const { id } = request.params;
    const {
      data, ora, id_azienda, id_intermediario, id_esecutore_esterno,
      prezzo_utente, prezzo_azienda, prezzo_intermediario,
      pagato_utente, pagato_azienda, pagato_intermediario,
      username, tipo, stato, note
    } = request.body;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    try {
      const existing = await query(
        'SELECT id FROM scritture_templates WHERE id_bando = $1',
        [id]
      );

      let result;
      if (existing.rows.length > 0) {
        result = await query(
          `UPDATE scritture_templates SET
            data = $1, ora = $2, id_azienda = $3, id_intermediario = $4,
            id_esecutore_esterno = $5, prezzo_utente = $6, prezzo_azienda = $7,
            prezzo_intermediario = $8, pagato_utente = $9, pagato_azienda = $10,
            pagato_intermediario = $11, username = $12, tipo = $13, stato = $14,
            note = $15, updated_at = NOW()
           WHERE id_bando = $16
           RETURNING *`,
          [data, ora, id_azienda, id_intermediario, id_esecutore_esterno,
           prezzo_utente, prezzo_azienda, prezzo_intermediario,
           pagato_utente || false, pagato_azienda || false, pagato_intermediario || false,
           username, tipo, stato, note, id]
        );
      } else {
        result = await query(
          `INSERT INTO scritture_templates (
            id_bando, data, ora, id_azienda, id_intermediario, id_esecutore_esterno,
            prezzo_utente, prezzo_azienda, prezzo_intermediario,
            pagato_utente, pagato_azienda, pagato_intermediario,
            username, tipo, stato, note, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
           RETURNING *`,
          [id, data, ora, id_azienda, id_intermediario, id_esecutore_esterno,
           prezzo_utente, prezzo_azienda, prezzo_intermediario,
           pagato_utente || false, pagato_azienda || false, pagato_intermediario || false,
           username, tipo, stato, note]
        );
      }

      return reply.code(existing.rows.length > 0 ? 200 : 201).send(result.rows[0]);
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // ============================================================
  // SOPRALLUOGHI (SITE VISITS)
  // ============================================================

  // GET /api/bandi/:id/sopralluoghi - List all sopralluoghi
  fastify.get('/:id/sopralluoghi', async (request, reply) => {
    const { id } = request.params;
    const { page = 1, limit = 20 } = request.query;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

    try {
      const result = await query(
        `SELECT * FROM sopralluoghi
         WHERE id_bando = $1
         ORDER BY data DESC, ora DESC
         LIMIT $2 OFFSET $3`,
        [id, limit, offset]
      );

      const totalResult = await query(
        'SELECT COUNT(*) as count FROM sopralluoghi WHERE id_bando = $1',
        [id]
      );

      return reply.send({
        data: result.rows,
        total: parseInt(totalResult.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit)
      });
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // GET /api/bandi/sopralluoghi/:id - Get single sopralluogo
  fastify.get('/sopralluoghi/:id', async (request, reply) => {
    const { id } = request.params;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    try {
      const result = await query(
        'SELECT * FROM sopralluoghi WHERE id = $1',
        [id]
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Sopralluogo not found' });
      }

      return reply.send(result.rows[0]);
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // POST /api/bandi/:id/sopralluoghi - Create sopralluogo
  fastify.post('/:id/sopralluoghi', async (request, reply) => {
    const { id } = request.params;
    const {
      data, ora, id_azienda, id_intermediario, id_esecutore_esterno,
      prezzo_utente, prezzo_azienda, prezzo_intermediario, prezzo_esecutore,
      pagato_utente, pagato_azienda, pagato_intermediario, pagato_esecutore,
      username, tipo, stato, note
    } = request.body;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    try {
      const result = await query(
        `INSERT INTO sopralluoghi (
          id_bando, data, ora, id_azienda, id_intermediario, id_esecutore_esterno,
          prezzo_utente, prezzo_azienda, prezzo_intermediario, prezzo_esecutore,
          pagato_utente, pagato_azienda, pagato_intermediario, pagato_esecutore,
          username, tipo, stato, note, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW())
        RETURNING *`,
        [id, data, ora, id_azienda, id_intermediario, id_esecutore_esterno,
         prezzo_utente, prezzo_azienda, prezzo_intermediario, prezzo_esecutore,
         pagato_utente || false, pagato_azienda || false, pagato_intermediario || false, pagato_esecutore || false,
         username, tipo, stato || 'in_sospeso', note]
      );

      await bridgeServizioToPortale({ fastify, idBando: id, idAzienda: id_azienda, tipoLabel: 'un SOPRALLUOGO' });
      return reply.code(201).send(result.rows[0]);
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // PUT /api/bandi/sopralluoghi/:id - Update sopralluogo
  fastify.put('/sopralluoghi/:id', async (request, reply) => {
    const { id } = request.params;
    const {
      data, ora, id_azienda, id_intermediario, id_esecutore_esterno,
      prezzo_utente, prezzo_azienda, prezzo_intermediario, prezzo_esecutore,
      pagato_utente, pagato_azienda, pagato_intermediario, pagato_esecutore,
      username, tipo, stato, note
    } = request.body;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    try {
      const result = await query(
        `UPDATE sopralluoghi SET
          data = COALESCE($1, data),
          ora = COALESCE($2, ora),
          id_azienda = COALESCE($3, id_azienda),
          id_intermediario = COALESCE($4, id_intermediario),
          id_esecutore_esterno = COALESCE($5, id_esecutore_esterno),
          prezzo_utente = COALESCE($6, prezzo_utente),
          prezzo_azienda = COALESCE($7, prezzo_azienda),
          prezzo_intermediario = COALESCE($8, prezzo_intermediario),
          prezzo_esecutore = COALESCE($9, prezzo_esecutore),
          pagato_utente = COALESCE($10, pagato_utente),
          pagato_azienda = COALESCE($11, pagato_azienda),
          pagato_intermediario = COALESCE($12, pagato_intermediario),
          pagato_esecutore = COALESCE($13, pagato_esecutore),
          username = COALESCE($14, username),
          tipo = COALESCE($15, tipo),
          stato = COALESCE($16, stato),
          note = COALESCE($17, note),
          updated_at = NOW()
         WHERE id = $18
         RETURNING *`,
        [data, ora, id_azienda, id_intermediario, id_esecutore_esterno,
         prezzo_utente, prezzo_azienda, prezzo_intermediario, prezzo_esecutore,
         pagato_utente, pagato_azienda, pagato_intermediario, pagato_esecutore,
         username, tipo, stato, note, id]
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Sopralluogo not found' });
      }

      return reply.send(result.rows[0]);
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // DELETE /api/bandi/sopralluoghi/:id - Delete sopralluogo
  fastify.delete('/sopralluoghi/:id', async (request, reply) => {
    const { id } = request.params;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    try {
      const result = await query(
        'DELETE FROM sopralluoghi WHERE id = $1 RETURNING id',
        [id]
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Sopralluogo not found' });
      }

      return reply.code(204).send();
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // POST /api/bandi/sopralluoghi/:id/richiesta-disponibilita - Request availability
  fastify.post('/sopralluoghi/:id/richiesta-disponibilita', async (request, reply) => {
    const { id } = request.params;
    const { id_esecutore } = request.body;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    try {
      const result = await query(
        `UPDATE sopralluoghi SET
          id_esecutore_esterno = $1,
          stato = 'richiesta_disponibilita',
          updated_at = NOW()
         WHERE id = $2
         RETURNING *`,
        [id_esecutore, id]
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Sopralluogo not found' });
      }

      return reply.send(result.rows[0]);
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // POST /api/bandi/sopralluoghi/:id/assegna - Assign sopralluogo
  fastify.post('/sopralluoghi/:id/assegna', async (request, reply) => {
    const { id } = request.params;
    const { username, id_intermediario } = request.body;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    try {
      const result = await query(
        `UPDATE sopralluoghi SET
          username = $1,
          id_intermediario = COALESCE($2, id_intermediario),
          updated_at = NOW()
         WHERE id = $3
         RETURNING *`,
        [username, id_intermediario, id]
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Sopralluogo not found' });
      }

      return reply.send(result.rows[0]);
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // POST /api/bandi/sopralluoghi/:id/azzera-disponibilita - Clear availability
  fastify.post('/sopralluoghi/:id/azzera-disponibilita', async (request, reply) => {
    const { id } = request.params;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    try {
      const result = await query(
        `UPDATE sopralluoghi SET
          id_esecutore_esterno = NULL,
          stato = 'in_sospeso',
          updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [id]
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Sopralluogo not found' });
      }

      return reply.send(result.rows[0]);
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // GET /api/bandi/:id/sopralluoghi-template - Get template
  fastify.get('/:id/sopralluoghi-template', async (request, reply) => {
    const { id } = request.params;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    try {
      const result = await query(
        'SELECT * FROM sopralluoghi_templates WHERE id_bando = $1',
        [id]
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Template not found' });
      }

      return reply.send(result.rows[0]);
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // POST /api/bandi/:id/sopralluoghi-template - Save template
  fastify.post('/:id/sopralluoghi-template', async (request, reply) => {
    const { id } = request.params;
    const {
      data, ora, id_azienda, id_intermediario, id_esecutore_esterno,
      prezzo_utente, prezzo_azienda, prezzo_intermediario, prezzo_esecutore,
      pagato_utente, pagato_azienda, pagato_intermediario, pagato_esecutore,
      username, tipo, stato, note
    } = request.body;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    try {
      const existing = await query(
        'SELECT id FROM sopralluoghi_templates WHERE id_bando = $1',
        [id]
      );

      let result;
      if (existing.rows.length > 0) {
        result = await query(
          `UPDATE sopralluoghi_templates SET
            data = $1, ora = $2, id_azienda = $3, id_intermediario = $4,
            id_esecutore_esterno = $5, prezzo_utente = $6, prezzo_azienda = $7,
            prezzo_intermediario = $8, prezzo_esecutore = $9, pagato_utente = $10,
            pagato_azienda = $11, pagato_intermediario = $12, pagato_esecutore = $13,
            username = $14, tipo = $15, stato = $16, note = $17, updated_at = NOW()
           WHERE id_bando = $18
           RETURNING *`,
          [data, ora, id_azienda, id_intermediario, id_esecutore_esterno,
           prezzo_utente, prezzo_azienda, prezzo_intermediario, prezzo_esecutore,
           pagato_utente || false, pagato_azienda || false, pagato_intermediario || false, pagato_esecutore || false,
           username, tipo, stato, note, id]
        );
      } else {
        result = await query(
          `INSERT INTO sopralluoghi_templates (
            id_bando, data, ora, id_azienda, id_intermediario, id_esecutore_esterno,
            prezzo_utente, prezzo_azienda, prezzo_intermediario, prezzo_esecutore,
            pagato_utente, pagato_azienda, pagato_intermediario, pagato_esecutore,
            username, tipo, stato, note, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW())
           RETURNING *`,
          [id, data, ora, id_azienda, id_intermediario, id_esecutore_esterno,
           prezzo_utente, prezzo_azienda, prezzo_intermediario, prezzo_esecutore,
           pagato_utente || false, pagato_azienda || false, pagato_intermediario || false, pagato_esecutore || false,
           username, tipo, stato, note]
        );
      }

      return reply.code(existing.rows.length > 0 ? 200 : 201).send(result.rows[0]);
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // GET /api/bandi/:id/date-sopralluoghi - List sopralluogo dates
  fastify.get('/:id/date-sopralluoghi', async (request, reply) => {
    const { id } = request.params;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    try {
      const result = await query(
        `SELECT * FROM date_sopralluoghi
         WHERE id_bando = $1
         ORDER BY data_inizio ASC`,
        [id]
      );

      return reply.send(result.rows);
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // POST /api/bandi/:id/date-sopralluoghi - Add date range
  fastify.post('/:id/date-sopralluoghi', async (request, reply) => {
    const { id } = request.params;
    const { data_inizio, data_fine, ora_inizio, ora_fine, note } = request.body;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    try {
      const result = await query(
        `INSERT INTO date_sopralluoghi (
          id_bando, data_inizio, data_fine, ora_inizio, ora_fine, note, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
        RETURNING *`,
        [id, data_inizio, data_fine, ora_inizio, ora_fine, note]
      );

      return reply.code(201).send(result.rows[0]);
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // DELETE /api/bandi/date-sopralluoghi/:id - Delete date
  fastify.delete('/date-sopralluoghi/:id', async (request, reply) => {
    const { id } = request.params;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    try {
      const result = await query(
        'DELETE FROM date_sopralluoghi WHERE id = $1 RETURNING id',
        [id]
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Date not found' });
      }

      return reply.code(204).send();
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // ============================================================
  // ELABORATI PROGETTUALI (PROJECT ELABORATIONS)
  // ============================================================

  // GET /api/bandi/:id/elaborati - List elaborati
  fastify.get('/:id/elaborati', async (request, reply) => {
    const { id } = request.params;
    const { page = 1, limit = 20 } = request.query;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

    try {
      const result = await query(
        `SELECT * FROM elaborati
         WHERE id_bando = $1
         ORDER BY data DESC, ora DESC
         LIMIT $2 OFFSET $3`,
        [id, limit, offset]
      );

      const totalResult = await query(
        'SELECT COUNT(*) as count FROM elaborati WHERE id_bando = $1',
        [id]
      );

      return reply.send({
        data: result.rows,
        total: parseInt(totalResult.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit)
      });
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // GET /api/bandi/elaborati/:id - Get single elaborato
  fastify.get('/elaborati/:id', async (request, reply) => {
    const { id } = request.params;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    try {
      const result = await query(
        'SELECT * FROM elaborati WHERE id = $1',
        [id]
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Elaborato not found' });
      }

      return reply.send(result.rows[0]);
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // POST /api/bandi/:id/elaborati - Create elaborato
  fastify.post('/:id/elaborati', async (request, reply) => {
    const { id } = request.params;
    const {
      data, ora, id_azienda, id_intermediario, id_esecutore_esterno,
      prezzo_utente, prezzo_azienda, prezzo_intermediario,
      pagato_utente, pagato_azienda, pagato_intermediario,
      username, tipo, stato, note
    } = request.body;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    try {
      const result = await query(
        `INSERT INTO elaborati (
          id_bando, data, ora, id_azienda, id_intermediario, id_esecutore_esterno,
          prezzo_utente, prezzo_azienda, prezzo_intermediario,
          pagato_utente, pagato_azienda, pagato_intermediario,
          username, tipo, stato, note, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
        RETURNING *`,
        [id, data, ora, id_azienda, id_intermediario, id_esecutore_esterno,
         prezzo_utente, prezzo_azienda, prezzo_intermediario,
         pagato_utente || false, pagato_azienda || false, pagato_intermediario || false,
         username, tipo, stato || 'in_sospeso', note]
      );

      return reply.code(201).send(result.rows[0]);
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // PUT /api/bandi/elaborati/:id - Update elaborato
  fastify.put('/elaborati/:id', async (request, reply) => {
    const { id } = request.params;
    const {
      data, ora, id_azienda, id_intermediario, id_esecutore_esterno,
      prezzo_utente, prezzo_azienda, prezzo_intermediario,
      pagato_utente, pagato_azienda, pagato_intermediario,
      username, tipo, stato, note
    } = request.body;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    try {
      const result = await query(
        `UPDATE elaborati SET
          data = COALESCE($1, data),
          ora = COALESCE($2, ora),
          id_azienda = COALESCE($3, id_azienda),
          id_intermediario = COALESCE($4, id_intermediario),
          id_esecutore_esterno = COALESCE($5, id_esecutore_esterno),
          prezzo_utente = COALESCE($6, prezzo_utente),
          prezzo_azienda = COALESCE($7, prezzo_azienda),
          prezzo_intermediario = COALESCE($8, prezzo_intermediario),
          pagato_utente = COALESCE($9, pagato_utente),
          pagato_azienda = COALESCE($10, pagato_azienda),
          pagato_intermediario = COALESCE($11, pagato_intermediario),
          username = COALESCE($12, username),
          tipo = COALESCE($13, tipo),
          stato = COALESCE($14, stato),
          note = COALESCE($15, note),
          updated_at = NOW()
         WHERE id = $16
         RETURNING *`,
        [data, ora, id_azienda, id_intermediario, id_esecutore_esterno,
         prezzo_utente, prezzo_azienda, prezzo_intermediario,
         pagato_utente, pagato_azienda, pagato_intermediario,
         username, tipo, stato, note, id]
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Elaborato not found' });
      }

      return reply.send(result.rows[0]);
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // DELETE /api/bandi/elaborati/:id - Delete elaborato
  fastify.delete('/elaborati/:id', async (request, reply) => {
    const { id } = request.params;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    try {
      const result = await query(
        'DELETE FROM elaborati WHERE id = $1 RETURNING id',
        [id]
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Elaborato not found' });
      }

      return reply.code(204).send();
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // GET /api/bandi/:id/elaborati-template - Get template
  fastify.get('/:id/elaborati-template', async (request, reply) => {
    const { id } = request.params;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    try {
      const result = await query(
        'SELECT * FROM elaborati_templates WHERE id_bando = $1',
        [id]
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Template not found' });
      }

      return reply.send(result.rows[0]);
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // POST /api/bandi/:id/elaborati-template - Save template
  fastify.post('/:id/elaborati-template', async (request, reply) => {
    const { id } = request.params;
    const {
      data, ora, id_azienda, id_intermediario, id_esecutore_esterno,
      prezzo_utente, prezzo_azienda, prezzo_intermediario,
      pagato_utente, pagato_azienda, pagato_intermediario,
      username, tipo, stato, note
    } = request.body;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    try {
      const existing = await query(
        'SELECT id FROM elaborati_templates WHERE id_bando = $1',
        [id]
      );

      let result;
      if (existing.rows.length > 0) {
        result = await query(
          `UPDATE elaborati_templates SET
            data = $1, ora = $2, id_azienda = $3, id_intermediario = $4,
            id_esecutore_esterno = $5, prezzo_utente = $6, prezzo_azienda = $7,
            prezzo_intermediario = $8, pagato_utente = $9, pagato_azienda = $10,
            pagato_intermediario = $11, username = $12, tipo = $13, stato = $14,
            note = $15, updated_at = NOW()
           WHERE id_bando = $16
           RETURNING *`,
          [data, ora, id_azienda, id_intermediario, id_esecutore_esterno,
           prezzo_utente, prezzo_azienda, prezzo_intermediario,
           pagato_utente || false, pagato_azienda || false, pagato_intermediario || false,
           username, tipo, stato, note, id]
        );
      } else {
        result = await query(
          `INSERT INTO elaborati_templates (
            id_bando, data, ora, id_azienda, id_intermediario, id_esecutore_esterno,
            prezzo_utente, prezzo_azienda, prezzo_intermediario,
            pagato_utente, pagato_azienda, pagato_intermediario,
            username, tipo, stato, note, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
           RETURNING *`,
          [id, data, ora, id_azienda, id_intermediario, id_esecutore_esterno,
           prezzo_utente, prezzo_azienda, prezzo_intermediario,
           pagato_utente || false, pagato_azienda || false, pagato_intermediario || false,
           username, tipo, stato, note]
        );
      }

      return reply.code(existing.rows.length > 0 ? 200 : 201).send(result.rows[0]);
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // ============================================================
  // PRESA VISIONE (DOCUMENT REVIEW)
  // ============================================================

  // GET /api/bandi/:id/presa-visione-template - Get template
  fastify.get('/:id/presa-visione-template', async (request, reply) => {
    const { id } = request.params;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    try {
      const result = await query(
        'SELECT * FROM presa_visione_templates WHERE id_bando = $1',
        [id]
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Template not found' });
      }

      return reply.send(result.rows[0]);
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // POST /api/bandi/:id/presa-visione-template - Save template
  fastify.post('/:id/presa-visione-template', async (request, reply) => {
    const { id } = request.params;
    const { contenuto, note } = request.body;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    try {
      const existing = await query(
        'SELECT id FROM presa_visione_templates WHERE id_bando = $1',
        [id]
      );

      let result;
      if (existing.rows.length > 0) {
        result = await query(
          `UPDATE presa_visione_templates SET
            contenuto = $1, note = $2, updated_at = NOW()
           WHERE id_bando = $3
           RETURNING *`,
          [contenuto, note, id]
        );
      } else {
        result = await query(
          `INSERT INTO presa_visione_templates (
            id_bando, contenuto, note, created_at
           ) VALUES ($1, $2, $3, NOW())
           RETURNING *`,
          [id, contenuto, note]
        );
      }

      return reply.code(existing.rows.length > 0 ? 200 : 201).send(result.rows[0]);
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // GET /api/bandi/:id/date-presa-visione - List dates
  fastify.get('/:id/date-presa-visione', async (request, reply) => {
    const { id } = request.params;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    try {
      const result = await query(
        `SELECT * FROM date_presa_visione
         WHERE id_bando = $1
         ORDER BY data_inizio ASC`,
        [id]
      );

      return reply.send(result.rows);
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // POST /api/bandi/:id/date-presa-visione - Add date
  fastify.post('/:id/date-presa-visione', async (request, reply) => {
    const { id } = request.params;
    const { data_inizio, data_fine, ora_inizio, ora_fine, note } = request.body;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    try {
      const result = await query(
        `INSERT INTO date_presa_visione (
          id_bando, data_inizio, data_fine, ora_inizio, ora_fine, note, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
        RETURNING *`,
        [id, data_inizio, data_fine, ora_inizio, ora_fine, note]
      );

      return reply.code(201).send(result.rows[0]);
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // DELETE /api/bandi/date-presa-visione/:id - Delete date
  fastify.delete('/date-presa-visione/:id', async (request, reply) => {
    const { id } = request.params;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    try {
      const result = await query(
        'DELETE FROM date_presa_visione WHERE id = $1 RETURNING id',
        [id]
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Date not found' });
      }

      return reply.code(204).send();
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // ============================================================
  // CALENDAR / AGENDA
  // ============================================================

  // GET /api/bandi/calendario - Get calendar events
  fastify.get('/calendario', async (request, reply) => {
    const { start, end } = request.query;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    if (!start || !end) {
      return reply.code(400).send({ error: 'start and end date parameters required' });
    }

    try {
      const result = await query(
        `SELECT
          a.id::text, a.id_bando, a.data, a.ora, a.tipo, a.stato, 'apertura' as servizio
         FROM aperture a
         WHERE a.data BETWEEN $1 AND $2
         UNION ALL
         SELECT
          s.id::text, s.id_bando, s.data, s.ora, s.tipo, s.stato, 'scrittura' as servizio
         FROM scritture s
         WHERE s.data BETWEEN $1 AND $2
         UNION ALL
         SELECT
          sp.id::text, sp.id_bando, sp.data, sp.ora, sp.tipo, sp.stato, 'sopralluogo' as servizio
         FROM sopralluoghi sp
         WHERE sp.data BETWEEN $1 AND $2
         UNION ALL
         SELECT
          e.id::text, e.id_bando, e.data, e.ora, e.tipo, e.stato, 'elaborato' as servizio
         FROM elaborati e
         WHERE e.data BETWEEN $1 AND $2
         ORDER BY data ASC, ora ASC`,
        [start, end]
      );

      return reply.send(result.rows);
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // GET /api/bandi/agenda - Get agenda items with filters
  fastify.get('/agenda', async (request, reply) => {
    const { username, tipo_servizio, page = 1, limit = 20 } = request.query;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (username) {
      conditions.push(`username = $${paramIdx}`);
      params.push(username);
      paramIdx++;
    }

    try {
      let result = { rows: [] };

      if (tipo_servizio === 'apertura' || !tipo_servizio) {
        const condStr = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
        const res = await query(
          `SELECT id, id_bando, data, ora, 'apertura' as servizio, stato FROM aperture
           ${condStr} ORDER BY data DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
          [...params, limit, offset]
        );
        result.rows = result.rows.concat(res.rows);
      }

      if (tipo_servizio === 'scrittura' || !tipo_servizio) {
        const condStr = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
        const res = await query(
          `SELECT id, id_bando, data, ora, 'scrittura' as servizio, stato FROM scritture
           ${condStr} ORDER BY data DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
          [...params, limit, offset]
        );
        result.rows = result.rows.concat(res.rows);
      }

      return reply.send({
        data: result.rows,
        page: parseInt(page),
        limit: parseInt(limit)
      });
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // GET /api/bandi/:id/eventi - Get events for specific bando
  fastify.get('/:id/eventi', async (request, reply) => {
    const { id } = request.params;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    try {
      const result = await query(
        `SELECT
          a.id::text, a.id_bando, a.data, a.ora, a.tipo, a.stato, 'apertura' as servizio
         FROM aperture a
         WHERE a.id_bando = $1
         UNION ALL
         SELECT
          s.id::text, s.id_bando, s.data, s.ora, s.tipo, s.stato, 'scrittura' as servizio
         FROM scritture s
         WHERE s.id_bando = $1
         UNION ALL
         SELECT
          sp.id::text, sp.id_bando, sp.data, sp.ora, sp.tipo, sp.stato, 'sopralluogo' as servizio
         FROM sopralluoghi sp
         WHERE sp.id_bando = $1
         UNION ALL
         SELECT
          e.id::text, e.id_bando, e.data, e.ora, e.tipo, e.stato, 'elaborato' as servizio
         FROM elaborati e
         WHERE e.id_bando = $1
         ORDER BY data ASC, ora ASC`,
        [id]
      );

      return reply.send(result.rows);
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // POST /api/bandi/:id/eventi - Add event
  fastify.post('/:id/eventi', async (request, reply) => {
    const { id } = request.params;
    const { data, ora, tipo, servizio, note } = request.body;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    try {
      let result;

      if (servizio === 'apertura') {
        result = await query(
          `INSERT INTO aperture (id_bando, data, ora, tipo, stato, note, created_at)
           VALUES ($1, $2, $3, $4, 'in_sospeso', $5, NOW())
           RETURNING *`,
          [id, data, ora, tipo, note]
        );
      } else if (servizio === 'scrittura') {
        result = await query(
          `INSERT INTO scritture (id_bando, data, ora, tipo, stato, note, created_at)
           VALUES ($1, $2, $3, $4, 'in_sospeso', $5, NOW())
           RETURNING *`,
          [id, data, ora, tipo, note]
        );
      } else if (servizio === 'sopralluogo') {
        result = await query(
          `INSERT INTO sopralluoghi (id_bando, data, ora, tipo, stato, note, created_at)
           VALUES ($1, $2, $3, $4, 'in_sospeso', $5, NOW())
           RETURNING *`,
          [id, data, ora, tipo, note]
        );
      } else if (servizio === 'elaborato') {
        result = await query(
          `INSERT INTO elaborati (id_bando, data, ora, tipo, stato, note, created_at)
           VALUES ($1, $2, $3, $4, 'in_sospeso', $5, NOW())
           RETURNING *`,
          [id, data, ora, tipo, note]
        );
      } else {
        return reply.code(400).send({ error: 'Invalid servizio type' });
      }

      return reply.code(201).send(result.rows[0]);
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // ============================================================
  // APPUNTAMENTI (APPOINTMENTS)
  // ============================================================

  // GET /api/bandi/appuntamenti/scritture - List writing appointments
  fastify.get('/appuntamenti/scritture', async (request, reply) => {
    const { username, stato, page = 1, limit = 20 } = request.query;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (username) {
      conditions.push(`username = $${paramIdx}`);
      params.push(username);
      paramIdx++;
    }

    if (stato) {
      conditions.push(`stato = $${paramIdx}`);
      params.push(stato);
      paramIdx++;
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    try {
      const result = await query(
        `SELECT * FROM scritture
         ${whereClause}
         ORDER BY data ASC, ora ASC
         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, limit, offset]
      );

      const totalResult = await query(
        `SELECT COUNT(*) as count FROM scritture ${whereClause}`,
        params
      );

      return reply.send({
        data: result.rows,
        total: parseInt(totalResult.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit)
      });
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // GET /api/bandi/appuntamenti/aperture - List opening appointments
  fastify.get('/appuntamenti/aperture', async (request, reply) => {
    const { username, stato, page = 1, limit = 20 } = request.query;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (username) {
      conditions.push(`username = $${paramIdx}`);
      params.push(username);
      paramIdx++;
    }

    if (stato) {
      conditions.push(`stato = $${paramIdx}`);
      params.push(stato);
      paramIdx++;
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    try {
      const result = await query(
        `SELECT * FROM aperture
         ${whereClause}
         ORDER BY data ASC, ora ASC
         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, limit, offset]
      );

      const totalResult = await query(
        `SELECT COUNT(*) as count FROM aperture ${whereClause}`,
        params
      );

      return reply.send({
        data: result.rows,
        total: parseInt(totalResult.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit)
      });
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // GET /api/bandi/appuntamenti/elaborati - List elaboration appointments
  fastify.get('/appuntamenti/elaborati', async (request, reply) => {
    const { username, stato, page = 1, limit = 20 } = request.query;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (username) {
      conditions.push(`username = $${paramIdx}`);
      params.push(username);
      paramIdx++;
    }

    if (stato) {
      conditions.push(`stato = $${paramIdx}`);
      params.push(stato);
      paramIdx++;
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    try {
      const result = await query(
        `SELECT * FROM elaborati
         ${whereClause}
         ORDER BY data ASC, ora ASC
         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, limit, offset]
      );

      const totalResult = await query(
        `SELECT COUNT(*) as count FROM elaborati ${whereClause}`,
        params
      );

      return reply.send({
        data: result.rows,
        total: parseInt(totalResult.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit)
      });
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });

  // GET /api/bandi/appuntamenti/sopralluoghi - List site visit appointments
  fastify.get('/appuntamenti/sopralluoghi', async (request, reply) => {
    const { username, stato, page = 1, limit = 20 } = request.query;

    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (username) {
      conditions.push(`username = $${paramIdx}`);
      params.push(username);
      paramIdx++;
    }

    if (stato) {
      conditions.push(`stato = $${paramIdx}`);
      params.push(stato);
      paramIdx++;
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    try {
      const result = await query(
        `SELECT * FROM sopralluoghi
         ${whereClause}
         ORDER BY data ASC, ora ASC
         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, limit, offset]
      );

      const totalResult = await query(
        `SELECT COUNT(*) as count FROM sopralluoghi ${whereClause}`,
        params
      );

      return reply.send({
        data: result.rows,
        total: parseInt(totalResult.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit)
      });
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Database error' });
    }
  });
}
