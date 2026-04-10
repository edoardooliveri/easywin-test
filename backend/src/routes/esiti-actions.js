import { query } from '../db/pool.js';

export default async function esitiActionsRoutes(fastify, opts) {
  // POST /api/esiti-actions/:id/conferma - set temp=false
  fastify.post('/:id/conferma', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    try {
      const upd = await query(
        `UPDATE gare SET "temp" = false, "updated_at" = NOW() WHERE "id" = $1 RETURNING "id", "temp"`,
        [id]
      );
      if (upd.rowCount === 0) return reply.status(404).send({ error: 'Esito non trovato' });
      return { success: true, message: 'Esito confermato', id, temp: upd.rows[0].temp };
    } catch (err) {
      fastify.log.error(err, 'Conferma error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/esiti-actions/:id/set-temp - set temp=true
  fastify.post('/:id/set-temp', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    try {
      const upd = await query(
        `UPDATE gare SET "temp" = true, "updated_at" = NOW() WHERE "id" = $1 RETURNING "id", "temp"`,
        [id]
      );
      if (upd.rowCount === 0) return reply.status(404).send({ error: 'Esito non trovato' });
      return { success: true, message: 'Esito impostato come bozza', id, temp: upd.rows[0].temp };
    } catch (err) {
      fastify.log.error(err, 'Set-temp error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/esiti-actions/:id/abilita - set enabled=true
  fastify.post('/:id/abilita', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    try {
      const upd = await query(
        `UPDATE gare SET "enabled" = true, "updated_at" = NOW() WHERE "id" = $1 RETURNING "id", "enabled"`,
        [id]
      );
      if (upd.rowCount === 0) return reply.status(404).send({ error: 'Esito non trovato' });
      return { success: true, message: 'Esito abilitato', id, enabled: upd.rows[0].enabled };
    } catch (err) {
      fastify.log.error(err, 'Abilita error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/esiti-actions/:id/disabilita - set enabled=false
  fastify.post('/:id/disabilita', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    try {
      const upd = await query(
        `UPDATE gare SET "enabled" = false, "updated_at" = NOW() WHERE "id" = $1 RETURNING "id", "enabled"`,
        [id]
      );
      if (upd.rowCount === 0) return reply.status(404).send({ error: 'Esito non trovato' });
      return { success: true, message: 'Esito disabilitato', id, enabled: upd.rows[0].enabled };
    } catch (err) {
      fastify.log.error(err, 'Disabilita error');
      return reply.status(500).send({ error: err.message });
    }
  });
}
