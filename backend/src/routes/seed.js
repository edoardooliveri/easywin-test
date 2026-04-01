import { query } from '../db/pool.js';

export default async function seedRoutes(fastify, opts) {

  // POST /api/admin/seed/execute - Execute SQL for data import
  // Protected: requires admin auth + secret key
  fastify.post('/execute', {
    preHandler: [fastify.authenticate, fastify.requireAdmin]
  }, async (request, reply) => {
    const { sql, key } = request.body;

    // Extra safety: require seed key
    if (key !== 'easywin-seed-2026') {
      return reply.status(403).send({ error: 'Invalid seed key' });
    }

    if (!sql || typeof sql !== 'string') {
      return reply.status(400).send({ error: 'SQL required' });
    }

    // Only allow INSERT, SELECT, SET, and sequence operations
    const upper = sql.trim().toUpperCase();
    const allowed = ['INSERT', 'SELECT', 'SET', 'WITH'];
    const firstWord = upper.split(/\s+/)[0];
    if (!allowed.includes(firstWord) && !upper.startsWith('--')) {
      return reply.status(400).send({ error: 'Only INSERT/SELECT/SET statements allowed' });
    }

    try {
      const result = await query(sql);
      return {
        success: true,
        rowCount: result.rowCount,
        rows: result.rows ? result.rows.slice(0, 10) : []
      };
    } catch (err) {
      return reply.status(500).send({
        error: err.message,
        detail: err.detail || null
      });
    }
  });

  // GET /api/admin/seed/status - Check counts
  fastify.get('/status', {
    preHandler: [fastify.authenticate, fastify.requireAdmin]
  }, async () => {
    const result = await query(`
      SELECT 'stazioni' as t, count(*) as n FROM stazioni
      UNION ALL SELECT 'aziende', count(*) FROM aziende
      UNION ALL SELECT 'bandi', count(*) FROM bandi
      UNION ALL SELECT 'gare', count(*) FROM gare
      UNION ALL SELECT 'dettaglio_gara', count(*) FROM dettaglio_gara
    `);
    return { counts: result.rows };
  });
}
