import { query } from '../db/pool.js';

export default async function tasksManagerRoutes(fastify, opts) {

  // ============================================================
  // TASK MANAGEMENT
  // ============================================================

  /**
   * GET /api/admin/tasks
   * List all scheduled tasks with status, last run, next run
   */
  fastify.get('/tasks', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { page = 1, limit = 50, tipo, attivo } = request.query;
      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

      let whereClause = 'WHERE 1=1';
      const params = [];

      if (tipo) {
        params.push(tipo);
        whereClause += ` AND tipo = $${params.length}`;
      }

      if (attivo !== undefined) {
        params.push(attivo === 'true' || attivo === '1');
        whereClause += ` AND attivo = $${params.length}`;
      }

      // Count total
      const countResult = await query(
        `SELECT COUNT(*) as total FROM tasks ${whereClause}`,
        params
      );
      const total = parseInt(countResult.rows[0].total);

      // Get paginated results
      const result = await query(
        `SELECT
          "id",
          "nome",
          "descrizione",
          "tipo",
          "cron_expression",
          "attivo",
          "data_creazione",
          "data_modifica",
          "data_ultima_esecuzione",
          "prossima_esecuzione",
          "stato_ultima_esecuzione"
        FROM tasks
        ${whereClause}
        ORDER BY data_ultima_esecuzione DESC NULLS LAST
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      );

      return reply.send({
        success: true,
        data: result.rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/admin/tasks/:id
   * Get task detail with configuration and history
   */
  fastify.get('/tasks/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;

      const result = await query(
        `SELECT
          "id",
          "nome",
          "descrizione",
          "tipo",
          "cron_expression",
          "attivo",
          "parametri",
          "data_creazione",
          "data_modifica",
          "data_ultima_esecuzione",
          "prossima_esecuzione",
          "stato_ultima_esecuzione",
          "messaggio_ultima_esecuzione"
        FROM tasks
        WHERE id = $1`,
        [id]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ success: false, error: 'Task not found' });
      }

      return reply.send({ success: true, data: result.rows[0] });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/admin/tasks
   * Create new scheduled task
   */
  fastify.post('/tasks', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { nome, descrizione, tipo, cron_expression, attivo, parametri } = request.body;

      const validTipi = [
        'newsletter_bandi',
        'newsletter_esiti',
        'controlla_fonti',
        'pulizia_temp',
        'backup_db',
        'sincronizza_presidia',
        'check_scadenze',
        'daily_check'
      ];

      if (!validTipi.includes(tipo)) {
        return reply.status(400).send({ success: false, error: 'Invalid task type' });
      }

      const result = await query(
        `INSERT INTO tasks (nome, descrizione, tipo, cron_expression, attivo, parametri, data_creazione)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        RETURNING id, nome, tipo, attivo, data_creazione`,
        [nome, descrizione, tipo, cron_expression, attivo !== false, JSON.stringify(parametri || {})]
      );

      return reply.status(201).send({ success: true, data: result.rows[0] });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * PUT /api/admin/tasks/:id
   * Update task configuration
   */
  fastify.put('/tasks/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const { nome, descrizione, cron_expression, attivo, parametri } = request.body;

      const result = await query(
        `UPDATE tasks
        SET
          nome = COALESCE($1, nome),
          descrizione = COALESCE($2, descrizione),
          cron_expression = COALESCE($3, cron_expression),
          attivo = COALESCE($4, attivo),
          parametri = COALESCE($5, parametri),
          data_modifica = NOW()
        WHERE id = $6
        RETURNING id, nome, tipo, attivo, data_modifica`,
        [nome, descrizione, cron_expression, attivo !== undefined ? attivo : null, parametri ? JSON.stringify(parametri) : null, id]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ success: false, error: 'Task not found' });
      }

      return reply.send({ success: true, data: result.rows[0] });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * DELETE /api/admin/tasks/:id
   * Delete task
   */
  fastify.delete('/tasks/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;

      const result = await query(
        `DELETE FROM tasks WHERE id = $1 RETURNING id`,
        [id]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ success: false, error: 'Task not found' });
      }

      return reply.send({ success: true, message: 'Task deleted' });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/admin/tasks/:id/esegui
   * Manually trigger task execution
   */
  fastify.post('/tasks/:id/esegui', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;

      const taskResult = await query(
        `SELECT id, tipo FROM tasks WHERE id = $1`,
        [id]
      );

      if (taskResult.rows.length === 0) {
        return reply.status(404).send({ success: false, error: 'Task not found' });
      }

      const execResult = await query(
        `INSERT INTO tasks_executions (id_task, stato, data_inizio)
        VALUES ($1, 'esecuzione', NOW())
        RETURNING id, data_inizio`,
        [id]
      );

      return reply.status(202).send({
        success: true,
        message: 'Task execution started',
        data: execResult.rows[0]
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/admin/tasks/:id/pausa
   * Pause task
   */
  fastify.post('/tasks/:id/pausa', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;

      const result = await query(
        `UPDATE tasks
        SET attivo = false, data_modifica = NOW()
        WHERE id = $1
        RETURNING id, attivo`,
        [id]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ success: false, error: 'Task not found' });
      }

      return reply.send({ success: true, data: result.rows[0] });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/admin/tasks/:id/riprendi
   * Resume task
   */
  fastify.post('/tasks/:id/riprendi', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;

      const result = await query(
        `UPDATE tasks
        SET attivo = true, data_modifica = NOW()
        WHERE id = $1
        RETURNING id, attivo`,
        [id]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ success: false, error: 'Task not found' });
      }

      return reply.send({ success: true, data: result.rows[0] });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ============================================================
  // TRIGGER MANAGEMENT
  // ============================================================

  /**
   * GET /api/admin/tasks/:id/triggers
   * List triggers for a task
   */
  fastify.get('/tasks/:id/triggers', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;

      const result = await query(
        `SELECT
          "id",
          "id_task",
          "tipo",
          "cron_expression",
          "intervallo_minuti",
          "data_esecuzione",
          "attivo",
          "data_creazione"
        FROM tasks_triggers
        WHERE id_task = $1
        ORDER BY data_creazione DESC`,
        [id]
      );

      return reply.send({ success: true, data: result.rows });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/admin/tasks/:id/triggers
   * Create trigger for task
   */
  fastify.post('/tasks/:id/triggers', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const { tipo, cron_expression, intervallo_minuti, data_esecuzione, attivo } = request.body;

      const validTipi = ['cron', 'intervallo', 'data_fissa'];
      if (!validTipi.includes(tipo)) {
        return reply.status(400).send({ success: false, error: 'Invalid trigger type' });
      }

      const result = await query(
        `INSERT INTO tasks_triggers (id_task, tipo, cron_expression, intervallo_minuti, data_esecuzione, attivo, data_creazione)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        RETURNING id, tipo, attivo, data_creazione`,
        [id, tipo, cron_expression, intervallo_minuti, data_esecuzione, attivo !== false]
      );

      return reply.status(201).send({ success: true, data: result.rows[0] });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * PUT /api/admin/tasks/triggers/:id
   * Update trigger
   */
  fastify.put('/tasks/triggers/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const { tipo, cron_expression, intervallo_minuti, data_esecuzione, attivo } = request.body;

      const result = await query(
        `UPDATE tasks_triggers
        SET
          tipo = COALESCE($1, tipo),
          cron_expression = COALESCE($2, cron_expression),
          intervallo_minuti = COALESCE($3, intervallo_minuti),
          data_esecuzione = COALESCE($4, data_esecuzione),
          attivo = COALESCE($5, attivo)
        WHERE id = $6
        RETURNING id, tipo, attivo`,
        [tipo, cron_expression, intervallo_minuti, data_esecuzione, attivo !== undefined ? attivo : null, id]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ success: false, error: 'Trigger not found' });
      }

      return reply.send({ success: true, data: result.rows[0] });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * DELETE /api/admin/tasks/triggers/:id
   * Delete trigger
   */
  fastify.delete('/tasks/triggers/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;

      const result = await query(
        `DELETE FROM tasks_triggers WHERE id = $1 RETURNING id`,
        [id]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ success: false, error: 'Trigger not found' });
      }

      return reply.send({ success: true, message: 'Trigger deleted' });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ============================================================
  // EXECUTION HISTORY
  // ============================================================

  /**
   * GET /api/admin/tasks/:id/esecuzioni
   * List execution history for a task
   */
  fastify.get('/tasks/:id/esecuzioni', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const { page = 1, limit = 50 } = request.query;
      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

      const countResult = await query(
        `SELECT COUNT(*) as total FROM tasks_executions WHERE id_task = $1`,
        [id]
      );
      const total = parseInt(countResult.rows[0].total);

      const result = await query(
        `SELECT
          "id",
          "id_task",
          "stato",
          "data_inizio",
          "data_fine",
          "durata_secondi",
          "messaggio"
        FROM tasks_executions
        WHERE id_task = $1
        ORDER BY data_inizio DESC
        LIMIT $2 OFFSET $3`,
        [id, limit, offset]
      );

      return reply.send({
        success: true,
        data: result.rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/admin/tasks/esecuzioni/:id
   * Get execution detail with full log
   */
  fastify.get('/tasks/esecuzioni/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;

      const result = await query(
        `SELECT
          "id",
          "id_task",
          "stato",
          "data_inizio",
          "data_fine",
          "durata_secondi",
          "messaggio",
          "log_completo"
        FROM tasks_executions
        WHERE id = $1`,
        [id]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ success: false, error: 'Execution not found' });
      }

      return reply.send({ success: true, data: result.rows[0] });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/admin/tasks/esecuzioni/recenti
   * Get last 50 executions across all tasks
   */
  fastify.get('/tasks/esecuzioni/recenti', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const result = await query(
        `SELECT
          e."id",
          e."id_task",
          t."nome" as task_nome,
          e."stato",
          e."data_inizio",
          e."data_fine",
          e."durata_secondi",
          e."messaggio"
        FROM tasks_executions e
        JOIN tasks t ON e.id_task = t.id
        ORDER BY e.data_inizio DESC
        LIMIT 50`,
        []
      );

      return reply.send({ success: true, data: result.rows });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * DELETE /api/admin/tasks/:id/esecuzioni
   * Clear execution history for task
   */
  fastify.delete('/tasks/:id/esecuzioni', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;

      await query(
        `DELETE FROM tasks_executions WHERE id_task = $1`,
        [id]
      );

      return reply.send({ success: true, message: 'Execution history cleared' });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ============================================================
  // DASHBOARD
  // ============================================================

  /**
   * GET /api/admin/tasks/dashboard
   * Task dashboard overview
   */
  fastify.get('/tasks/dashboard', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const tasksResult = await query(
        `SELECT
          COUNT(*) as total,
          SUM(CASE WHEN attivo = true THEN 1 ELSE 0 END) as attive,
          SUM(CASE WHEN attivo = false THEN 1 ELSE 0 END) as pausate
        FROM tasks`,
        []
      );

      const failedResult = await query(
        `SELECT COUNT(*) as failed FROM tasks_executions
        WHERE stato = 'errore'
        AND data_inizio > NOW() - INTERVAL '24 hours'`,
        []
      );

      const nextResult = await query(
        `SELECT
          id,
          nome,
          prossima_esecuzione
        FROM tasks
        WHERE attivo = true
        ORDER BY prossima_esecuzione ASC
        LIMIT 5`,
        []
      );

      return reply.send({
        success: true,
        data: {
          totali: parseInt(tasksResult.rows[0].total),
          attive: parseInt(tasksResult.rows[0].attive || 0),
          pausate: parseInt(tasksResult.rows[0].pausate || 0),
          errori_ultime_24h: parseInt(failedResult.rows[0].failed || 0),
          prossime_esecuzioni: nextResult.rows
        }
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

}
