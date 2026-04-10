import { query } from '../db/pool.js';

export default async function esitiToggleRoutes(fastify, opts) {

  // POST /api/esiti/:id/toggle-abilita
  fastify.post('/:id/toggle-abilita', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const { enabled } = request.body || {};
    try {
      const val = enabled === true || enabled === 'true';
      const upd = await query(
        `UPDATE gare SET "enabled" = $2, "updated_at" = NOW() WHERE "id" = $1 RETURNING "id", "enabled"`,
        [id, val]
      );
      if (upd.rowCount === 0) return reply.status(404).send({ error: 'Esito non trovato' });
      fastify.log.info({ id, enabled: upd.rows[0].enabled }, 'Toggle abilita result');
      return { success: true, enabled: upd.rows[0].enabled, id };
    } catch (err) {
      fastify.log.error(err, 'Toggle abilita error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/esiti/:id/toggle-conferma
  fastify.post('/:id/toggle-conferma', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const { confermato } = request.body || {};
    try {
      const temp = !(confermato === true || confermato === 'true');
      const upd = await query(
        `UPDATE gare SET "temp" = $2, "updated_at" = NOW() WHERE "id" = $1 RETURNING "id", "temp"`,
        [id, temp]
      );
      if (upd.rowCount === 0) return reply.status(404).send({ error: 'Esito non trovato' });
      fastify.log.info({ id, temp: upd.rows[0].temp }, 'Toggle conferma result');
      return { success: true, temp: upd.rows[0].temp, id };
    } catch (err) {
      fastify.log.error(err, 'Toggle conferma error');
      return reply.status(500).send({ error: err.message });
    }
  });
}
