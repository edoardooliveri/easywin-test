import { query, transaction } from '../db/pool.js';

export default async function bandiScorporabiliRoutes(fastify, opts) {

  // ============================================================
  // GET /api/bandi/:id/scorporabili — Lista scorporabili del bando
  // ============================================================
  fastify.get('/:id/scorporabili', async (request, reply) => {
    const { id } = request.params;

    const result = await query(
      `SELECT bs.id, bs.id_bando, bs.id_soa, bs.soa_val, bs.importo,
              bs.subappaltabile, bs.percentuale_subappalto, bs.note, bs.ordine,
              bs.created_at,
              s.codice AS soa_codice, s.descrizione AS soa_descrizione, s.tipo AS soa_tipo
       FROM bandi_soa_sec bs
       JOIN soa s ON bs.id_soa = s.id
       WHERE bs.id_bando = $1
       ORDER BY bs.ordine ASC, bs.id ASC`,
      [id]
    );

    return result.rows;
  });

  // ============================================================
  // POST /api/bandi/:id/scorporabili — Crea scorporabile
  // ============================================================
  fastify.post('/:id/scorporabili', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const data = request.body || {};
    const user = request.user;

    // Validate id_soa
    if (!data.id_soa) {
      return reply.status(400).send({ error: 'id_soa obbligatorio' });
    }
    const soaCheck = await query('SELECT id FROM soa WHERE id = $1', [data.id_soa]);
    if (soaCheck.rows.length === 0) {
      return reply.status(400).send({ error: `SOA con id ${data.id_soa} non trovata` });
    }

    // Validate soa_val (classifica 1-8)
    if (data.soa_val !== undefined && data.soa_val !== null) {
      const v = Number(data.soa_val);
      if (!Number.isInteger(v) || v < 1 || v > 8) {
        return reply.status(400).send({ error: 'soa_val deve essere un intero tra 1 e 8' });
      }
    }

    // Validate percentuale_subappalto
    if (data.percentuale_subappalto !== undefined && data.percentuale_subappalto !== null) {
      const p = Number(data.percentuale_subappalto);
      if (!Number.isInteger(p) || p < 0 || p > 100) {
        return reply.status(400).send({ error: 'percentuale_subappalto deve essere tra 0 e 100' });
      }
    }

    // Validate importo
    if (data.importo !== undefined && data.importo !== null) {
      const imp = Number(data.importo);
      if (isNaN(imp) || imp < 0) {
        return reply.status(400).send({ error: 'importo deve essere >= 0' });
      }
    }

    // Next ordine
    const maxOrd = await query(
      'SELECT COALESCE(MAX(ordine), -1) + 1 AS next_ord FROM bandi_soa_sec WHERE id_bando = $1',
      [id]
    );
    const ordine = data.ordine !== undefined ? Number(data.ordine) : maxOrd.rows[0].next_ord;

    const result = await query(
      `INSERT INTO bandi_soa_sec (id_bando, id_soa, soa_val, importo, subappaltabile, percentuale_subappalto, note, ordine)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        id,
        data.id_soa,
        data.soa_val ?? null,
        data.importo ?? null,
        data.subappaltabile === true || data.subappaltabile === 'true',
        data.percentuale_subappalto ?? null,
        data.note ?? null,
        ordine,
      ]
    );

    // Audit log
    try {
      await query(
        'INSERT INTO bandimodifiche (id_bando, user_name, modifiche, data) VALUES ($1, $2, $3, NOW())',
        [id, user.username, `Aggiunto scorporabile SOA id=${data.id_soa}`]
      );
    } catch (e) { /* audit log best-effort */ }

    return reply.status(201).send({ id: result.rows[0].id, message: 'Scorporabile aggiunto' });
  });

  // ============================================================
  // PUT /api/bandi/:id/scorporabili/:sid — Aggiorna scorporabile
  // ============================================================
  fastify.put('/:id/scorporabili/:sid', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id, sid } = request.params;
    const data = request.body || {};
    const user = request.user;

    // Verify ownership
    const existing = await query(
      'SELECT id FROM bandi_soa_sec WHERE id = $1 AND id_bando = $2',
      [sid, id]
    );
    if (existing.rows.length === 0) {
      return reply.status(404).send({ error: 'Scorporabile non trovato per questo bando' });
    }

    // Validate id_soa if changing
    if (data.id_soa !== undefined) {
      const soaCheck = await query('SELECT id FROM soa WHERE id = $1', [data.id_soa]);
      if (soaCheck.rows.length === 0) {
        return reply.status(400).send({ error: `SOA con id ${data.id_soa} non trovata` });
      }
    }

    // Validate soa_val
    if (data.soa_val !== undefined && data.soa_val !== null) {
      const v = Number(data.soa_val);
      if (!Number.isInteger(v) || v < 1 || v > 8) {
        return reply.status(400).send({ error: 'soa_val deve essere un intero tra 1 e 8' });
      }
    }

    // Validate percentuale_subappalto
    if (data.percentuale_subappalto !== undefined && data.percentuale_subappalto !== null) {
      const p = Number(data.percentuale_subappalto);
      if (!Number.isInteger(p) || p < 0 || p > 100) {
        return reply.status(400).send({ error: 'percentuale_subappalto deve essere tra 0 e 100' });
      }
    }

    // Validate importo
    if (data.importo !== undefined && data.importo !== null) {
      const imp = Number(data.importo);
      if (isNaN(imp) || imp < 0) {
        return reply.status(400).send({ error: 'importo deve essere >= 0' });
      }
    }

    // Build dynamic update
    const fields = [];
    const values = [];
    let idx = 1;

    const updatable = ['id_soa', 'soa_val', 'importo', 'subappaltabile', 'percentuale_subappalto', 'note', 'ordine'];
    for (const col of updatable) {
      if (data[col] !== undefined) {
        let val = data[col];
        if (col === 'subappaltabile') val = val === true || val === 'true';
        fields.push(`${col} = $${idx}`);
        values.push(val);
        idx++;
      }
    }

    if (fields.length === 0) {
      return reply.status(400).send({ error: 'Nessun campo da aggiornare' });
    }

    values.push(sid);
    await query(
      `UPDATE bandi_soa_sec SET ${fields.join(', ')} WHERE id = $${idx}`,
      values
    );

    // Audit log
    try {
      await query(
        'INSERT INTO bandimodifiche (id_bando, user_name, modifiche, data) VALUES ($1, $2, $3, NOW())',
        [id, user.username, `Modificato scorporabile id=${sid}: ${Object.keys(data).join(', ')}`]
      );
    } catch (e) { /* best-effort */ }

    return { message: 'Scorporabile aggiornato' };
  });

  // ============================================================
  // DELETE /api/bandi/:id/scorporabili/:sid — Elimina scorporabile
  // ============================================================
  fastify.delete('/:id/scorporabili/:sid', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id, sid } = request.params;
    const user = request.user;

    const existing = await query(
      'SELECT id, id_soa FROM bandi_soa_sec WHERE id = $1 AND id_bando = $2',
      [sid, id]
    );
    if (existing.rows.length === 0) {
      return reply.status(404).send({ error: 'Scorporabile non trovato per questo bando' });
    }

    await query('DELETE FROM bandi_soa_sec WHERE id = $1', [sid]);

    // Audit log
    try {
      await query(
        'INSERT INTO bandimodifiche (id_bando, user_name, modifiche, data) VALUES ($1, $2, $3, NOW())',
        [id, user.username, `Eliminato scorporabile id=${sid} (SOA id=${existing.rows[0].id_soa})`]
      );
    } catch (e) { /* best-effort */ }

    return reply.status(204).send();
  });

  // ============================================================
  // PATCH /api/bandi/:id/scorporabili/reorder — Riordina
  // ============================================================
  fastify.patch('/:id/scorporabili/reorder', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const { order } = request.body || {};
    const user = request.user;

    if (!Array.isArray(order) || order.length === 0) {
      return reply.status(400).send({ error: 'order deve essere un array di id' });
    }

    await transaction(async (client) => {
      for (let i = 0; i < order.length; i++) {
        await client.query(
          'UPDATE bandi_soa_sec SET ordine = $1 WHERE id = $2 AND id_bando = $3',
          [i, order[i], id]
        );
      }
    });

    // Audit log
    try {
      await query(
        'INSERT INTO bandimodifiche (id_bando, user_name, modifiche, data) VALUES ($1, $2, $3, NOW())',
        [id, user.username, `Riordinati scorporabili: [${order.join(',')}]`]
      );
    } catch (e) { /* best-effort */ }

    return { message: 'Ordine aggiornato' };
  });
}
