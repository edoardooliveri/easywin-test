import { query } from '../db/pool.js';
import json2csv from 'json2csv';
import ExcelJS from 'exceljs';

export default async function sistemaRoutes(fastify, opts) {

  // ============================================================
  // ERROR LOGGING (ELMAH-like)
  // ============================================================

  /**
   * GET /api/admin/errori
   * List recent errors (requires auth)
   */
  fastify.get('/errori', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { page = 1, limit = 50 } = request.query;
      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

      // Count total
      const countResult = await query(
        `SELECT COUNT(*) as total FROM errors`,
        []
      );
      const total = parseInt(countResult.rows[0].total);

      // Get paginated results
      const result = await query(
        `SELECT
          "id",
          "tipo" AS type,
          "messaggio" AS message,
          "stack_trace" AS stack_trace,
          "url" AS url,
          "utente" AS user,
          "browser" AS browser,
          "timestamp" AS timestamp
         FROM errors
         ORDER BY timestamp DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      );

      return {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        total_pages: Math.ceil(total / limit),
        errors: result.rows
      };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'Errors list error');
      return reply.status(500).send({ error: 'Errore nel caricamento degli errori' });
    }
  });

  /**
   * GET /api/admin/errori/:id
   * Error detail with full stack trace (requires auth)
   */
  fastify.get('/errori/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;

      const result = await query(
        `SELECT
          "id",
          "tipo" AS type,
          "messaggio" AS message,
          "stack_trace" AS stack_trace,
          "url" AS url,
          "utente" AS user,
          "browser" AS browser,
          "ip" AS ip_address,
          "timestamp" AS timestamp
         FROM errors
         WHERE id = $1
         LIMIT 1`,
        [id]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ error: 'Errore non trovato' });
      }

      return result.rows[0];
    } catch (err) {
      fastify.log.error({ err: err.message }, 'Error detail error');
      return reply.status(500).send({ error: 'Errore nel caricamento del dettaglio' });
    }
  });

  /**
   * DELETE /api/admin/errori/:id
   * Delete single error (requires auth)
   */
  fastify.delete('/errori/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;

      const result = await query(
        `DELETE FROM errors WHERE id = $1 RETURNING id`,
        [id]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ error: 'Errore non trovato' });
      }

      fastify.log.info({ error_id: id }, 'Error deleted');
      return { message: 'Errore eliminato', id };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'Error delete error');
      return reply.status(500).send({ error: 'Errore nell\'eliminazione' });
    }
  });

  /**
   * DELETE /api/admin/errori
   * Clear all errors (requires auth)
   */
  fastify.delete('/errori', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const result = await query(
        `DELETE FROM errors RETURNING id`,
        []
      );

      fastify.log.warn({ count: result.rows.length }, 'All errors cleared');
      return { message: 'Tutti gli errori eliminati', count: result.rows.length };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'Error clear all error');
      return reply.status(500).send({ error: 'Errore nell\'eliminazione' });
    }
  });

  // ============================================================
  // EXPORT TO EXCEL/CSV
  // ============================================================

  /**
   * POST /api/admin/esporta-excel
   * Generic export to Excel/CSV (requires auth)
   */
  fastify.post('/esporta-excel', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { tipo, filtri = {}, formato = 'csv' } = request.body || {};

      if (!tipo || !['bandi', 'esiti', 'aziende', 'stazioni', 'utenti'].includes(tipo)) {
        return reply.status(400).send({ error: 'Tipo non valido. Usare: bandi, esiti, aziende, stazioni, utenti' });
      }

      let data = [];
      let columns = [];

      // Build query based on tipo
      if (tipo === 'bandi') {
        const result = await query(
          `SELECT
            b."id_bando" AS id,
            b."oggetto" AS titolo,
            b."cig" AS codice_cig,
            b."data_pubblicazione" AS data_pubblicazione,
            b."importo_so" AS importo,
            b."regione" AS provincia,
            COALESCE(s."denominazione", b."stazione") AS stazione
           FROM bandi b
           LEFT JOIN stazioni s ON b."id_stazione" = s."id"
           WHERE b."attivo" = true AND b."annullato" = false
           ORDER BY b."data_pubblicazione" DESC`,
          []
        );
        data = result.rows;
        columns = ['id', 'titolo', 'codice_cig', 'data_pubblicazione', 'importo', 'provincia', 'stazione'];
      } else if (tipo === 'esiti') {
        const result = await query(
          `SELECT
            g."id" AS id,
            g."oggetto" AS titolo,
            g."data_gara" AS data,
            g."importo_aggiudicazione" AS importo,
            g."regione" AS provincia,
            COALESCE(s."denominazione", g."stazione") AS stazione,
            (SELECT COUNT(*) FROM dettaglio_gara WHERE "id_gara" = g."id") AS n_partecipanti
           FROM gare g
           LEFT JOIN stazioni s ON g."id_stazione" = s."id"
           WHERE g."attivo" = true AND g."annullato" = false
           ORDER BY g."data_gara" DESC`,
          []
        );
        data = result.rows;
        columns = ['id', 'titolo', 'data', 'importo', 'provincia', 'stazione', 'n_partecipanti'];
      } else if (tipo === 'aziende') {
        const result = await query(
          `SELECT
            a."id" AS id,
            a."ragione_sociale" AS ragione_sociale,
            a."partita_iva" AS partita_iva,
            a."citta" AS citta,
            a."provincia" AS provincia,
            a."email" AS email,
            a."telefono" AS telefono
           FROM aziende a
           WHERE a."eliminata" != true AND a."annullato" != true
           ORDER BY a."ragione_sociale" ASC`,
          []
        );
        data = result.rows;
        columns = ['id', 'ragione_sociale', 'partita_iva', 'citta', 'provincia', 'email', 'telefono'];
      } else if (tipo === 'stazioni') {
        const result = await query(
          `SELECT
            s."id" AS id,
            s."nome" AS nome,
            s."codice_ente" AS codice_ente,
            s."citta" AS citta,
            s."provincia" AS provincia,
            s."regione" AS regione,
            s."email" AS email
           FROM stazioni s
           WHERE s."eliminata" != true AND s."annullato" != true
           ORDER BY s."nome" ASC`,
          []
        );
        data = result.rows;
        columns = ['id', 'nome', 'codice_ente', 'citta', 'provincia', 'regione', 'email'];
      } else if (tipo === 'utenti') {
        const result = await query(
          `SELECT
            u."username" AS username,
            u."email" AS email,
            u."nome" AS nome,
            u."cognome" AS cognome,
            u."id_azienda" AS azienda,
            u."codice_fiscale" AS partita_iva,
            u."attivo" AS approvato,
            u."created_at" AS data_creazione
           FROM users u
           ORDER BY u."username" ASC`,
          []
        );
        data = result.rows;
        columns = ['username', 'email', 'nome', 'cognome', 'azienda', 'partita_iva', 'approvato', 'data_creazione'];
      }

      if (formato === 'csv') {
        // Export to CSV
        try {
          const csv = json2csv.parse(data, { fields: columns });
          reply.type('text/csv; charset=utf-8');
          reply.header('Content-Disposition', `attachment; filename="${tipo}_${new Date().toISOString().split('T')[0]}.csv"`);
          return csv;
        } catch (csvErr) {
          fastify.log.error({ err: csvErr.message }, 'CSV generation error');
          return reply.status(500).send({ error: 'Errore nella generazione del CSV' });
        }
      } else if (formato === 'json') {
        // Export to JSON
        reply.header('Content-Disposition', `attachment; filename="${tipo}_${new Date().toISOString().split('T')[0]}.json"`);
        return {
          tipo,
          data,
          count: data.length,
          exported_at: new Date().toISOString()
        };
      } else if (formato === 'xlsx') {
        // Export to Excel
        try {
          const workbook = new ExcelJS.Workbook();
          const worksheet = workbook.addWorksheet(tipo);

          // Add header row
          worksheet.columns = columns.map(col => ({
            header: col,
            key: col,
            width: 15
          }));

          // Add data rows
          worksheet.addRows(data);

          // Style header row
          worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
          worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF333333' }
          };

          // Generate buffer
          const buffer = await workbook.xlsx.writeBuffer();
          reply.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          reply.header('Content-Disposition', `attachment; filename="${tipo}_${new Date().toISOString().split('T')[0]}.xlsx"`);
          return buffer;
        } catch (xlsxErr) {
          fastify.log.error({ err: xlsxErr.message }, 'Excel generation error');
          return reply.status(500).send({ error: 'Errore nella generazione dell\'Excel' });
        }
      }

      return reply.status(400).send({ error: 'Formato non supportato. Usare: csv, json, xlsx' });
    } catch (err) {
      fastify.log.error({ err: err.message }, 'Export error');
      return reply.status(500).send({ error: 'Errore nell\'esportazione' });
    }
  });

  // ============================================================
  // JOB/TASK STATUS
  // ============================================================

  /**
   * GET /api/admin/jobs
   * List background jobs with status (requires auth)
   */
  fastify.get('/jobs', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { page = 1, limit = 20, status } = request.query;
      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

      let whereClause = '';
      let params = [];

      if (status) {
        whereClause = 'WHERE status = $1';
        params = [status];
      }

      // Count total
      const countResult = await query(
        `SELECT COUNT(*) as total FROM background_jobs ${whereClause}`,
        params
      );
      const total = parseInt(countResult.rows[0].total);

      // Get results
      const result = await query(
        `SELECT
          "id",
          "tipo" AS type,
          "status",
          "progress" AS progress_percent,
          "created_at" AS created_at,
          "started_at" AS started_at,
          "completed_at" AS completed_at,
          "messaggio" AS message
         FROM background_jobs
         ${whereClause}
         ORDER BY created_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      );

      return {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        total_pages: Math.ceil(total / limit),
        jobs: result.rows
      };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'Jobs list error');
      return reply.status(500).send({ error: 'Errore nel caricamento dei job' });
    }
  });

  /**
   * GET /api/admin/jobs/:id
   * Job detail with messages (requires auth)
   */
  fastify.get('/jobs/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;

      const jobResult = await query(
        `SELECT
          "id",
          "tipo" AS type,
          "status",
          "progress" AS progress_percent,
          "created_at" AS created_at,
          "started_at" AS started_at,
          "completed_at" AS completed_at,
          "messaggio" AS message
         FROM background_jobs
         WHERE id = $1
         LIMIT 1`,
        [id]
      );

      if (jobResult.rows.length === 0) {
        return reply.status(404).send({ error: 'Job non trovato' });
      }

      // Get job messages/logs
      const messagesResult = await query(
        `SELECT
          "id",
          "livello" AS level,
          "testo" AS text,
          "timestamp" AS timestamp
         FROM job_logs
         WHERE job_id = $1
         ORDER BY timestamp ASC`,
        [id]
      );

      return {
        ...jobResult.rows[0],
        logs: messagesResult.rows
      };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'Job detail error');
      return reply.status(500).send({ error: 'Errore nel caricamento del job' });
    }
  });

  /**
   * POST /api/admin/jobs/:id/annulla
   * Cancel a running job (requires auth)
   */
  fastify.post('/jobs/:id/annulla', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;

      // Check if job exists and is running
      const jobResult = await query(
        `SELECT "id", "status" FROM background_jobs WHERE id = $1 LIMIT 1`,
        [id]
      );

      if (jobResult.rows.length === 0) {
        return reply.status(404).send({ error: 'Job non trovato' });
      }

      const job = jobResult.rows[0];

      if (job.status !== 'running') {
        return reply.status(400).send({ error: `Job non è in esecuzione (status: ${job.status})` });
      }

      // Update job status
      await query(
        `UPDATE background_jobs SET status = 'cancelled', completed_at = NOW()
         WHERE id = $1`,
        [id]
      );

      fastify.log.info({ job_id: id }, 'Job cancelled');
      return { message: 'Job annullato', id };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'Job cancel error');
      return reply.status(500).send({ error: 'Errore nell\'annullamento del job' });
    }
  });

  // ============================================================
  // DOWNLOADS LOG
  // ============================================================

  /**
   * GET /api/admin/downloads
   * List download events (requires auth)
   */
  fastify.get('/downloads', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { page = 1, limit = 50, tipo, data_da, data_a } = request.query;
      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

      const conditions = [];
      const params = [];
      let paramIdx = 1;

      if (tipo) {
        conditions.push(`tipo = $${paramIdx}`);
        params.push(tipo);
        paramIdx++;
      }

      if (data_da) {
        conditions.push(`timestamp >= $${paramIdx}`);
        params.push(data_da);
        paramIdx++;
      }

      if (data_a) {
        conditions.push(`timestamp <= $${paramIdx}`);
        params.push(data_a);
        paramIdx++;
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // Count total
      const countResult = await query(
        `SELECT COUNT(*) as total FROM download_logs ${whereClause}`,
        params
      );
      const total = parseInt(countResult.rows[0].total);

      // Get results
      const result = await query(
        `SELECT
          "id",
          "tipo" AS type,
          "entita_id" AS entity_id,
          "entita_nome" AS entity_name,
          "utente" AS user,
          "ip" AS ip_address,
          "timestamp" AS timestamp
         FROM download_logs
         ${whereClause}
         ORDER BY timestamp DESC
         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, limit, offset]
      );

      return {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        total_pages: Math.ceil(total / limit),
        downloads: result.rows
      };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'Downloads list error');
      return reply.status(500).send({ error: 'Errore nel caricamento dei download' });
    }
  });

  /**
   * POST /api/admin/downloads
   * Log a download event (requires auth)
   */
  fastify.post('/downloads', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { tipo, entita_id, entita_nome } = request.body || {};

      if (!tipo || !entita_id) {
        return reply.status(400).send({ error: 'Tipo e entita_id richiesti' });
      }

      const result = await query(
        `INSERT INTO download_logs (tipo, entita_id, entita_nome, utente, ip, timestamp)
         VALUES ($1, $2, $3, $4, $5, NOW())
         RETURNING id`,
        [tipo, entita_id, entita_nome || null, request.user.username, request.ip]
      );

      return { message: 'Download registrato', id: result.rows[0].id };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'Download log error');
      return reply.status(500).send({ error: 'Errore nel registrazione del download' });
    }
  });

  // ============================================================
  // SYSTEM INFO
  // ============================================================

  /**
   * GET /api/admin/sistema/info
   * System information (requires auth)
   */
  fastify.get('/sistema/info', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      // Get database size (PostgreSQL specific)
      const sizeResult = await query(
        `SELECT pg_size_pretty(pg_database_size(current_database())) AS size`,
        []
      );

      // Get table counts
      const tablesResult = await query(
        `SELECT
          (SELECT COUNT(*) FROM bandi) AS bandi_count,
          (SELECT COUNT(*) FROM gare) AS gare_count,
          (SELECT COUNT(*) FROM aziende) AS aziende_count,
          (SELECT COUNT(*) FROM stazioni) AS stazioni_count,
          (SELECT COUNT(*) FROM users) AS users_count,
          (SELECT COUNT(*) FROM errors) AS errors_count`,
        []
      );

      const tables = tablesResult.rows[0];

      return {
        version: process.env.APP_VERSION || '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        uptime_seconds: process.uptime(),
        database: {
          type: 'PostgreSQL',
          size: sizeResult.rows[0].size,
          tables: {
            bandi: parseInt(tables.bandi_count),
            gare: parseInt(tables.gare_count),
            aziende: parseInt(tables.aziende_count),
            stazioni: parseInt(tables.stazioni_count),
            users: parseInt(tables.users_count),
            errors: parseInt(tables.errors_count)
          }
        },
        server: {
          node_version: process.version,
          platform: process.platform,
          memory: {
            rss_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
            heap_used_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            heap_total_mb: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
          }
        },
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'System info error');
      return reply.status(500).send({ error: 'Errore nel caricamento delle informazioni di sistema' });
    }
  });

}
