import { query } from '../db/pool.js';
import fs from 'fs';

export default async function provinceGestioneRoutes(fastify, opts) {

  // ============================================================
  // PROVINCE CRUD
  // ============================================================

  /**
   * GET /api/province
   * List all provinces with region
   */
  fastify.get('/province', async (request, reply) => {
    try {
      const { page = 1, limit = 50, id_regione } = request.query;
      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

      let whereClause = 'WHERE 1=1';
      const params = [];

      if (id_regione) {
        params.push(id_regione);
        whereClause += ` AND p.id_regione = $${params.length}`;
      }

      const countResult = await query(
        `SELECT COUNT(*) as total FROM province p ${whereClause}`,
        params
      );
      const total = parseInt(countResult.rows[0].total);

      const result = await query(
        `SELECT
          p."id",
          p."nome",
          p."codice",
          p."id_regione",
          r."nome" as regione_nome,
          p."latitudine",
          p."longitudine",
          p."data_creazione"
        FROM province p
        LEFT JOIN regioni r ON p.id_regione = r.id
        ${whereClause}
        ORDER BY p.nome ASC
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
   * GET /api/province/:id
   * Get province detail with coordinates
   */
  fastify.get('/province/:id', async (request, reply) => {
    try {
      const { id } = request.params;

      const result = await query(
        `SELECT
          p."id",
          p."nome",
          p."codice",
          p."id_regione",
          r."nome" as regione_nome,
          p."latitudine",
          p."longitudine",
          p."data_creazione",
          p."data_modifica"
        FROM province p
        LEFT JOIN regioni r ON p.id_regione = r.id
        WHERE p.id = $1`,
        [id]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ success: false, error: 'Province not found' });
      }

      return reply.send({ success: true, data: result.rows[0] });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/province
   * Create province
   */
  fastify.post('/province', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { nome, codice, id_regione, latitudine, longitudine } = request.body;

      if (!nome || !codice) {
        return reply.status(400).send({ success: false, error: 'nome and codice required' });
      }

      const result = await query(
        `INSERT INTO province (nome, codice, id_regione, latitudine, longitudine, data_creazione)
        VALUES ($1, $2, $3, $4, $5, NOW())
        RETURNING id, nome, codice, id_regione`,
        [nome, codice, id_regione || null, latitudine || null, longitudine || null]
      );

      return reply.status(201).send({ success: true, data: result.rows[0] });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * PUT /api/province/:id
   * Update province
   */
  fastify.put('/province/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const { nome, codice, id_regione, latitudine, longitudine } = request.body;

      const result = await query(
        `UPDATE province
        SET
          nome = COALESCE($1, nome),
          codice = COALESCE($2, codice),
          id_regione = COALESCE($3, id_regione),
          latitudine = COALESCE($4, latitudine),
          longitudine = COALESCE($5, longitudine),
          data_modifica = NOW()
        WHERE id = $6
        RETURNING id, nome, codice`,
        [nome, codice, id_regione, latitudine, longitudine, id]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ success: false, error: 'Province not found' });
      }

      return reply.send({ success: true, data: result.rows[0] });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * DELETE /api/province/:id
   * Delete province (only if no references)
   */
  fastify.delete('/province/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;

      const refResult = await query(
        `SELECT COUNT(*) as count FROM comuni WHERE id_provincia = $1`,
        [id]
      );

      if (parseInt(refResult.rows[0].count) > 0) {
        return reply.status(409).send({ success: false, error: 'Cannot delete province with comuni references' });
      }

      const result = await query(
        `DELETE FROM province WHERE id = $1 RETURNING id`,
        [id]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ success: false, error: 'Province not found' });
      }

      return reply.send({ success: true, message: 'Province deleted' });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/province/search?term=
   * Autocomplete provinces
   */
  fastify.get('/province/search', async (request, reply) => {
    try {
      const { term } = request.query;

      if (!term || term.length < 2) {
        return reply.send({ success: true, data: [] });
      }

      const result = await query(
        `SELECT
          p."id",
          p."nome",
          p."codice",
          r."nome" as regione_nome
        FROM province p
        LEFT JOIN regioni r ON p.id_regione = r.id
        WHERE p.nome ILIKE $1
        ORDER BY p.nome ASC
        LIMIT 20`,
        [`%${term}%`]
      );

      return reply.send({ success: true, data: result.rows });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/province/per-regione/:id_regione
   * Get provinces in region
   */
  fastify.get('/province/per-regione/:id_regione', async (request, reply) => {
    try {
      const { id_regione } = request.params;

      const result = await query(
        `SELECT
          "id",
          "nome",
          "codice",
          "latitudine",
          "longitudine"
        FROM province
        WHERE id_regione = $1
        ORDER BY nome ASC`,
        [id_regione]
      );

      return reply.send({ success: true, data: result.rows });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ============================================================
  // REGIONI CRUD
  // ============================================================

  /**
   * GET /api/regioni
   * List all regions
   */
  fastify.get('/regioni', async (request, reply) => {
    try {
      const result = await query(
        `SELECT
          "id",
          "nome",
          "codice",
          "data_creazione"
        FROM regioni
        ORDER BY nome ASC`,
        []
      );

      return reply.send({ success: true, data: result.rows });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/regioni/:id
   * Get region detail with provinces
   */
  fastify.get('/regioni/:id', async (request, reply) => {
    try {
      const { id } = request.params;

      const regionResult = await query(
        `SELECT
          "id",
          "nome",
          "codice",
          "data_creazione"
        FROM regioni
        WHERE id = $1`,
        [id]
      );

      if (regionResult.rows.length === 0) {
        return reply.status(404).send({ success: false, error: 'Region not found' });
      }

      const provincesResult = await query(
        `SELECT
          "id",
          "nome",
          "codice",
          "latitudine",
          "longitudine"
        FROM province
        WHERE id_regione = $1
        ORDER BY nome ASC`,
        [id]
      );

      return reply.send({
        success: true,
        data: {
          ...regionResult.rows[0],
          province: provincesResult.rows
        }
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/regioni
   * Create region
   */
  fastify.post('/regioni', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { nome, codice } = request.body;

      if (!nome || !codice) {
        return reply.status(400).send({ success: false, error: 'nome and codice required' });
      }

      const result = await query(
        `INSERT INTO regioni (nome, codice, data_creazione)
        VALUES ($1, $2, NOW())
        RETURNING id, nome, codice`,
        [nome, codice]
      );

      return reply.status(201).send({ success: true, data: result.rows[0] });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * PUT /api/regioni/:id
   * Update region
   */
  fastify.put('/regioni/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const { nome, codice } = request.body;

      const result = await query(
        `UPDATE regioni
        SET
          nome = COALESCE($1, nome),
          codice = COALESCE($2, codice)
        WHERE id = $3
        RETURNING id, nome, codice`,
        [nome, codice, id]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ success: false, error: 'Region not found' });
      }

      return reply.send({ success: true, data: result.rows[0] });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ============================================================
  // COMUNI
  // ============================================================

  /**
   * GET /api/comuni/search?term=
   * Autocomplete comuni
   */
  fastify.get('/comuni/search', async (request, reply) => {
    try {
      const { term } = request.query;

      if (!term || term.length < 2) {
        return reply.send({ success: true, data: [] });
      }

      const result = await query(
        `SELECT
          c."id",
          c."nome",
          c."cap",
          p."nome" as provincia_nome,
          r."nome" as regione_nome
        FROM comuni c
        LEFT JOIN province p ON c.id_provincia = p.id
        LEFT JOIN regioni r ON p.id_regione = r.id
        WHERE c.nome ILIKE $1
        ORDER BY c.nome ASC
        LIMIT 20`,
        [`%${term}%`]
      );

      return reply.send({ success: true, data: result.rows });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/comuni/per-provincia/:id_provincia
   * Get comuni in province
   */
  fastify.get('/comuni/per-provincia/:id_provincia', async (request, reply) => {
    try {
      const { id_provincia } = request.params;

      const result = await query(
        `SELECT
          "id",
          "nome",
          "cap",
          "latitudine",
          "longitudine"
        FROM comuni
        WHERE id_provincia = $1
        ORDER BY nome ASC`,
        [id_provincia]
      );

      return reply.send({ success: true, data: result.rows });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ============================================================
  // FILE DOWNLOADS
  // ============================================================

  /**
   * GET /api/downloads/allegato-bando/:id
   * Download bando attachment file
   */
  fastify.get('/downloads/allegato-bando/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const { token } = request.headers;

      const result = await query(
        `SELECT
          "id",
          "id_bando",
          "nome_file",
          "path_file",
          "tipo_mime",
          "data_upload"
        FROM allegati_bandi
        WHERE id = $1`,
        [id]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ success: false, error: 'Attachment not found' });
      }

      const allegato = result.rows[0];
      const filePath = allegato.path_file;

      if (!fs.existsSync(filePath)) {
        return reply.status(404).send({ success: false, error: 'File not found on disk' });
      }

      await query(
        `INSERT INTO download_logs (tipo, id_riferimento, id_utente, user_agent, ip_address, data_download)
        VALUES ($1, $2, $3, $4, $5, NOW())`,
        ['allegato_bando', id, request.user?.id || null, request.headers['user-agent'], request.ip]
      );

      return reply.download(filePath, allegato.nome_file);
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/downloads/allegato-esito/:id
   * Download esito attachment file
   */
  fastify.get('/downloads/allegato-esito/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;

      const result = await query(
        `SELECT
          "id",
          "id_esito",
          "nome_file",
          "path_file",
          "tipo_mime",
          "data_upload"
        FROM allegati_esiti
        WHERE id = $1`,
        [id]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ success: false, error: 'Attachment not found' });
      }

      const allegato = result.rows[0];
      const filePath = allegato.path_file;

      if (!fs.existsSync(filePath)) {
        return reply.status(404).send({ success: false, error: 'File not found on disk' });
      }

      await query(
        `INSERT INTO download_logs (tipo, id_riferimento, id_utente, user_agent, ip_address, data_download)
        VALUES ($1, $2, $3, $4, $5, NOW())`,
        ['allegato_esito', id, request.user?.id || null, request.headers['user-agent'], request.ip]
      );

      return reply.download(filePath, allegato.nome_file);
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/downloads/newsletter/:id
   * Download newsletter archive
   */
  fastify.get('/downloads/newsletter/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;

      const result = await query(
        `SELECT
          "id",
          "titolo",
          "nome_file",
          "path_file",
          "tipo_newsletter",
          "data_invio"
        FROM newsletter_archivio
        WHERE id = $1`,
        [id]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ success: false, error: 'Newsletter not found' });
      }

      const newsletter = result.rows[0];
      const filePath = newsletter.path_file;

      if (!fs.existsSync(filePath)) {
        return reply.status(404).send({ success: false, error: 'File not found on disk' });
      }

      await query(
        `INSERT INTO download_logs (tipo, id_riferimento, id_utente, user_agent, ip_address, data_download)
        VALUES ($1, $2, $3, $4, $5, NOW())`,
        ['newsletter', id, request.user?.id || null, request.headers['user-agent'], request.ip]
      );

      return reply.download(filePath, newsletter.nome_file);
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/downloads/log
   * Log a download event
   */
  fastify.post('/downloads/log', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { tipo, id_riferimento, id_utente } = request.body;

      const validTipi = ['allegato_bando', 'allegato_esito', 'newsletter', 'report'];

      if (!validTipi.includes(tipo)) {
        return reply.status(400).send({ success: false, error: 'Invalid download type' });
      }

      const result = await query(
        `INSERT INTO download_logs (tipo, id_riferimento, id_utente, user_agent, ip_address, data_download)
        VALUES ($1, $2, $3, $4, $5, NOW())
        RETURNING id, data_download`,
        [tipo, id_riferimento, id_utente || request.user?.id || null, request.headers['user-agent'], request.ip]
      );

      return reply.status(201).send({ success: true, data: result.rows[0] });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/downloads/storico
   * Get download history for admin
   */
  fastify.get('/downloads/storico', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { page = 1, limit = 50, tipo, data_da, data_a } = request.query;
      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

      let whereClause = 'WHERE 1=1';
      const params = [];

      if (tipo) {
        params.push(tipo);
        whereClause += ` AND tipo = $${params.length}`;
      }

      if (data_da) {
        params.push(new Date(data_da));
        whereClause += ` AND data_download >= $${params.length}`;
      }

      if (data_a) {
        params.push(new Date(data_a));
        whereClause += ` AND data_download <= $${params.length}`;
      }

      const countResult = await query(
        `SELECT COUNT(*) as total FROM download_logs ${whereClause}`,
        params
      );
      const total = parseInt(countResult.rows[0].total);

      const result = await query(
        `SELECT
          "id",
          "tipo",
          "id_riferimento",
          "id_utente",
          "user_agent",
          "ip_address",
          "data_download"
        FROM download_logs
        ${whereClause}
        ORDER BY data_download DESC
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

}
