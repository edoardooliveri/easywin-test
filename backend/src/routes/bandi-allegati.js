import { query } from '../db/pool.js';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'bandi');

// Ensure upload directory exists
function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

export default async function bandiAllegatiRoutes(fastify, opts) {

  // ============================================================
  // GET /api/bandi/:id/allegati — Lista allegati di un bando
  // ============================================================
  fastify.get('/:id/allegati', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    try {
      const res = await query(
        `SELECT
          id, id_bando, nome_file, categoria, tipo_mime, dimensione,
          path, username, user_type, last_update, created_at
        FROM allegati_bando
        WHERE id_bando = $1
        ORDER BY
          CASE categoria
            WHEN 'bando' THEN 1
            WHEN 'disciplinare' THEN 2
            WHEN 'allegati' THEN 3
            WHEN 'elaborati' THEN 4
            WHEN 'rettifica_1' THEN 5
            WHEN 'rettifica_2' THEN 6
            WHEN 'rettifica_3' THEN 7
            WHEN 'rettifica_4' THEN 8
            WHEN 'rettifica_5' THEN 9
            WHEN 'chiarimenti' THEN 10
            WHEN 'esito' THEN 11
            ELSE 99
          END,
          created_at ASC`,
        [id]
      );
      return res.rows;
    } catch (err) {
      fastify.log.error(err, 'Get allegati bando error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ============================================================
  // POST /api/bandi/:id/allegati — Upload allegato (multipart)
  // ============================================================
  fastify.post('/:id/allegati', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const user = request.user;

    try {
      // Verify bando exists
      const bandoCheck = await query('SELECT id FROM bandi WHERE id = $1', [id]);
      if (bandoCheck.rows.length === 0) {
        return reply.status(404).send({ error: 'Bando non trovato' });
      }

      ensureUploadDir();

      const data = await request.file();
      if (!data) {
        return reply.status(400).send({ error: 'Nessun file ricevuto' });
      }

      const originalName = data.filename;
      const mimeType = data.mimetype;
      const ext = path.extname(originalName);
      const uniqueName = `${id}_${randomUUID()}${ext}`;
      const filePath = path.join(UPLOAD_DIR, uniqueName);

      // Read the file buffer
      const chunks = [];
      for await (const chunk of data.file) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);
      const fileSize = buffer.length;

      // Save to disk
      fs.writeFileSync(filePath, buffer);

      // Get categoria from multipart fields
      const categoria = data.fields?.categoria?.value || null;

      // Insert into DB
      const res = await query(
        `INSERT INTO allegati_bando
          (id_bando, nome_file, path, categoria, tipo_mime, dimensione, username, user_type, last_update, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
        RETURNING id, nome_file, categoria, tipo_mime, dimensione, created_at`,
        [id, originalName, filePath, categoria, mimeType, fileSize, user.username, user.ruolo || 'admin']
      );

      // Log the action
      try {
        await query(
          `INSERT INTO bandimodifiche (id_bando, user_name, modifiche, data)
           VALUES ($1, $2, $3, NOW())`,
          [id, user.username, `Allegato caricato: ${originalName}${categoria ? ' (categoria: ' + categoria + ')' : ''}`]
        );
      } catch { /* table may not exist */ }

      return res.rows[0];
    } catch (err) {
      fastify.log.error(err, 'Upload allegato bando error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ============================================================
  // DELETE /api/bandi/:id/allegati/:allegatoId — Elimina allegato
  // ============================================================
  fastify.delete('/:id/allegati/:allegatoId', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id, allegatoId } = request.params;
    const user = request.user;

    try {
      // Get file info before deleting
      const fileInfo = await query(
        'SELECT nome_file, path FROM allegati_bando WHERE id = $1 AND id_bando = $2',
        [allegatoId, id]
      );

      if (fileInfo.rows.length === 0) {
        return reply.status(404).send({ error: 'Allegato non trovato' });
      }

      const { nome_file, path: filePath } = fileInfo.rows[0];

      // Delete from DB
      await query('DELETE FROM allegati_bando WHERE id = $1 AND id_bando = $2', [allegatoId, id]);

      // Delete file from disk
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      // Log the action
      try {
        await query(
          `INSERT INTO bandimodifiche (id_bando, user_name, modifiche, data)
           VALUES ($1, $2, $3, NOW())`,
          [id, user.username, `Allegato eliminato: ${nome_file}`]
        );
      } catch { /* table may not exist */ }

      return { success: true, message: 'Allegato eliminato' };
    } catch (err) {
      fastify.log.error(err, 'Delete allegato bando error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ============================================================
  // GET /api/bandi/:id/allegati/:allegatoId/download — Download
  // ============================================================
  fastify.get('/:id/allegati/:allegatoId/download', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id, allegatoId } = request.params;

    try {
      const res = await query(
        `SELECT nome_file, path, tipo_mime, documento
         FROM allegati_bando
         WHERE id = $1 AND id_bando = $2`,
        [allegatoId, id]
      );

      if (res.rows.length === 0) {
        return reply.status(404).send({ error: 'Allegato non trovato' });
      }

      const allegato = res.rows[0];

      // Log download
      try {
        await query(
          `INSERT INTO download_logs (tipo, id_riferimento, id_utente, user_agent, ip_address, data_download)
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          ['allegato_bando', allegatoId, request.user?.id || null, request.headers['user-agent'], request.ip]
        );
      } catch { /* table may not exist */ }

      // Try file on disk first
      if (allegato.path && fs.existsSync(allegato.path)) {
        const stream = fs.createReadStream(allegato.path);
        return reply
          .header('Content-Type', allegato.tipo_mime || 'application/octet-stream')
          .header('Content-Disposition', `attachment; filename="${encodeURIComponent(allegato.nome_file)}"`)
          .send(stream);
      }

      // Fallback to BYTEA content
      if (allegato.documento) {
        return reply
          .header('Content-Type', allegato.tipo_mime || 'application/octet-stream')
          .header('Content-Disposition', `attachment; filename="${encodeURIComponent(allegato.nome_file)}"`)
          .send(allegato.documento);
      }

      return reply.status(404).send({ error: 'File non trovato su disco' });
    } catch (err) {
      fastify.log.error(err, 'Download allegato bando error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ============================================================
  // PUT /api/bandi/:id/allegati/:allegatoId — Aggiorna categoria
  // ============================================================
  fastify.put('/:id/allegati/:allegatoId', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id, allegatoId } = request.params;
    const { categoria } = request.body;

    try {
      const res = await query(
        `UPDATE allegati_bando
         SET categoria = $1, last_update = NOW()
         WHERE id = $2 AND id_bando = $3
         RETURNING id, nome_file, categoria`,
        [categoria, allegatoId, id]
      );

      if (res.rows.length === 0) {
        return reply.status(404).send({ error: 'Allegato non trovato' });
      }

      return res.rows[0];
    } catch (err) {
      fastify.log.error(err, 'Update allegato bando error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ============================================================
  // GET /api/bandi/:id/allegati/count — Conteggio allegati
  // ============================================================
  fastify.get('/:id/allegati/count', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    try {
      const res = await query(
        `SELECT
          COUNT(*) as totale,
          COUNT(*) FILTER (WHERE nome_file ILIKE '%.pdf') as n_pdf,
          COUNT(*) FILTER (WHERE categoria IS NOT NULL) as con_categoria,
          COUNT(*) FILTER (WHERE categoria IS NULL) as senza_categoria
        FROM allegati_bando
        WHERE id_bando = $1`,
        [id]
      );
      return res.rows[0];
    } catch (err) {
      fastify.log.error(err, 'Count allegati bando error');
      return reply.status(500).send({ error: err.message });
    }
  });
}
