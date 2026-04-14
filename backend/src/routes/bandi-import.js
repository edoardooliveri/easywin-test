import { query } from '../db/pool.js';
import axios from 'axios';
import { parse } from 'csv-parse/sync';
import crypto from 'crypto';

// Helper: Compute hash for duplicate detection
function hashBando(bando) {
  const key = `${bando.cig || ''}-${bando.titolo || ''}-${bando.id_stazione || ''}`;
  return crypto.createHash('sha256').update(key).digest('hex');
}

// Helper: Calculate field similarity (Levenshtein distance based)
function stringSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;

  if (longer.length === 0) return 1.0;
  const editDistance = getEditDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

function getEditDistance(s1, s2) {
  const costs = [];
  for (let i = 0; i <= s1.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= s2.length; j++) {
      if (i === 0) {
        costs[j] = j;
      } else if (j > 0) {
        let newValue = costs[j - 1];
        if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        }
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[s2.length] = lastValue;
  }
  return costs[s2.length];
}

export default async function bandiImportRoutes(fastify, opts) {
  // Verify authentication for all routes
  fastify.addHook('preHandler', async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  // ==================== MANUAL IMPORT ====================

  // POST /api/admin/bandi-import/manuale
  fastify.post('/manuale', async (request, reply) => {
    try {
      const {
        titolo, cig, importo, data, id_stazione, id_regione, id_provincia,
        id_soa, criterii, tipologia, note, data_offerta, data_apertura,
        importo_base_asta, importo_co, oneri_progettazione, importo_eco, importo_manodopera
      } = request.body;

      if (!titolo || !id_stazione) {
        return reply.status(400).send({ error: 'titolo and id_stazione are required' });
      }

      const result = await query(
        `INSERT INTO bandi (
          "oggetto", "cig", "importo_aggiudicazione", "data_gara", "id_stazione", "id_regione", "id_provincia",
          "id_soa", "id_criterio", "id_tipologia_bandi", "note", "data_scadenza", "data_apertura",
          "importo_so", "importo_co", "oneri_progettazione", "importo_eco", "importo_manodopera",
          "temp", "attivo", "fonte", "created_at", "created_by"
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
          $14, $15, $16, $17, $18, true, false, 'manuale', NOW(), $19
        )
        RETURNING id, "oggetto", "cig", "data_gara"`,
        [
          titolo, cig, importo, data, id_stazione, id_regione, id_provincia,
          id_soa, criterii, tipologia, note, data_offerta, data_apertura,
          importo_base_asta, importo_co, oneri_progettazione, importo_eco, importo_manodopera,
          request.user.username
        ]
      );

      return {
        success: true,
        bando: result.rows[0]
      };
    } catch (err) {
      fastify.log.error(err, 'Manual bandi import error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/bandi-import/bulk
  fastify.post('/bulk', async (request, reply) => {
    try {
      const { bandi } = request.body;

      if (!Array.isArray(bandi) || bandi.length === 0) {
        return reply.status(400).send({ error: 'bandi array is required and must not be empty' });
      }

      let importati = 0;
      let duplicati = 0;
      let errori = 0;
      const errors = [];

      for (const bando of bandi) {
        try {
          // Check for duplicates by CIG
          if (bando.cig) {
            const existing = await query(
              `SELECT id FROM bandi WHERE "cig" = $1 LIMIT 1`,
              [bando.cig]
            );
            if (existing.rows.length > 0) {
              duplicati++;
              continue;
            }
          }

          // Insert bando
          await query(
            `INSERT INTO bandi (
              "oggetto", "cig", "importo_aggiudicazione", "data_gara", "id_stazione", "id_regione", "id_provincia",
              "id_soa", "note", "temp", "attivo", "fonte", "created_at", "created_by"
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, false, 'bulk-import', NOW(), $10)`,
            [
              bando.titolo, bando.cig, bando.importo, bando.data,
              bando.id_stazione, bando.id_regione, bando.id_provincia,
              bando.id_soa, bando.note, request.user.username
            ]
          );
          importati++;
        } catch (err) {
          errori++;
          errors.push({ bando: bando.titolo || bando.cig, error: err.message });
        }
      }

      return {
        success: true,
        importati,
        duplicati,
        errori,
        errors: errori > 0 ? errors : []
      };
    } catch (err) {
      fastify.log.error(err, 'Bulk bandi import error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ==================== EXTERNAL SOURCE IMPORT ====================

  // POST /api/admin/bandi-import/presidia
  fastify.post('/presidia', async (request, reply) => {
    try {
      const { id_presidia, data_da, data_a } = request.body;

      if (!id_presidia) {
        return reply.status(400).send({ error: 'id_presidia is required' });
      }

      // Fetch presidia API configuration
      const presidiaConfig = await query(
        `SELECT url, api_key FROM fonti_web WHERE id = $1 AND tipo = 'presidia'`,
        [id_presidia]
      );

      if (presidiaConfig.rows.length === 0) {
        return reply.status(404).send({ error: 'Presidia source not found' });
      }

      const { url, api_key } = presidiaConfig.rows[0];

      // Call Presidia API
      const presidiaBandi = await axios.get(`${url}/api/bandi`, {
        headers: { 'Authorization': `Bearer ${api_key}` },
        params: { data_da, data_a }
      });

      let importati = 0;
      let duplicati = 0;
      let errori = 0;
      const errors = [];

      for (const presidiaBando of presidiaBandi.data.bandi || []) {
        try {
          // Check for duplicates by CIG
          if (presidiaBando.cig) {
            const existing = await query(
              `SELECT id FROM bandi WHERE "cig" = $1`,
              [presidiaBando.cig]
            );
            if (existing.rows.length > 0) {
              duplicati++;
              continue;
            }
          }

          // Insert bando from Presidia
          await query(
            `INSERT INTO bandi (
              "oggetto", "cig", "importo_aggiudicazione", "data_gara", "id_stazione", "id_regione",
              "temp", "attivo", "fonte", "created_at", "created_by"
            ) VALUES ($1, $2, $3, $4, $5, $6, true, false, 'presidia', NOW(), $7)`,
            [
              presidiaBando.oggetto || presidiaBando.titolo,
              presidiaBando.cig,
              presidiaBando.importo,
              presidiaBando.data_pubblicazione || presidiaBando.data,
              null, null,
              request.user.username
            ]
          );
          importati++;
        } catch (err) {
          errori++;
          errors.push({ bando: presidiaBando.titolo || presidiaBando.cig, error: err.message });
        }
      }

      return {
        success: true,
        importati,
        duplicati,
        errori,
        errors: errori > 0 ? errors : []
      };
    } catch (err) {
      fastify.log.error(err, 'Presidia import error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/bandi-import/maggioli
  fastify.post('/maggioli', async (request, reply) => {
    try {
      const { url, filtri } = request.body;

      if (!url) {
        return reply.status(400).send({ error: 'url is required' });
      }

      // Parse Maggioli page/API
      const response = await axios.get(url);
      const html = response.data;

      // Simple regex-based parsing for Maggioli format
      const bandoRegex = /<bando>[\s\S]*?<\/bando>/g;
      const matches = html.match(bandoRegex) || [];

      let importati = 0;
      let duplicati = 0;
      let errori = 0;

      for (const match of matches) {
        try {
          const titleMatch = match.match(/<titolo>(.*?)<\/titolo>/);
          const cigMatch = match.match(/<cig>(.*?)<\/cig>/);
          const importoMatch = match.match(/<importo>(.*?)<\/importo>/);
          const dataMatch = match.match(/<data>(.*?)<\/data>/);

          const titolo = titleMatch ? titleMatch[1].trim() : '';
          const cig = cigMatch ? cigMatch[1].trim() : '';
          const importo = importoMatch ? parseFloat(importoMatch[1]) : null;
          const data = dataMatch ? dataMatch[1].trim() : new Date().toISOString();

          if (!titolo) continue;

          // Check for duplicates
          if (cig) {
            const existing = await query(
              `SELECT id FROM bandi WHERE "cig" = $1`,
              [cig]
            );
            if (existing.rows.length > 0) {
              duplicati++;
              continue;
            }
          }

          // Insert bando
          await query(
            `INSERT INTO bandi (
              "oggetto", "cig", "importo_aggiudicazione", "data_gara", "temp", "attivo", "fonte", "created_at", "created_by"
            ) VALUES ($1, $2, $3, $4, true, false, 'maggioli', NOW(), $5)`,
            [titolo, cig, importo, data, request.user.username]
          );
          importati++;
        } catch (err) {
          errori++;
          fastify.log.warn(`Failed to import Maggioli bando: ${err.message}`);
        }
      }

      return {
        success: true,
        importati,
        duplicati,
        errori
      };
    } catch (err) {
      fastify.log.error(err, 'Maggioli import error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/bandi-import/csv
  fastify.post('/csv', async (request, reply) => {
    try {
      const { file, mapping } = request.body;

      if (!file || !mapping) {
        return reply.status(400).send({ error: 'file and mapping are required' });
      }

      // Decode base64 CSV if needed
      const csvData = typeof file === 'string' ? Buffer.from(file, 'base64').toString() : file;

      // Parse CSV
      const records = parse(csvData, {
        columns: true,
        skip_empty_lines: true,
        delimiter: ','
      });

      let importati = 0;
      let duplicati = 0;
      let errori = 0;
      const errors = [];

      for (const record of records) {
        try {
          // Map CSV columns to bando fields using provided mapping
          const titolo = record[mapping.titolo] || '';
          const cig = record[mapping.cig] || '';
          const importo = record[mapping.importo] ? parseFloat(record[mapping.importo]) : null;
          const data = record[mapping.data] || new Date().toISOString().split('T')[0];

          if (!titolo) continue;

          // Check for duplicates
          if (cig) {
            const existing = await query(
              `SELECT id FROM bandi WHERE "cig" = $1`,
              [cig]
            );
            if (existing.rows.length > 0) {
              duplicati++;
              continue;
            }
          }

          // Insert bando
          await query(
            `INSERT INTO bandi (
              "oggetto", "cig", "importo_aggiudicazione", "data_gara", "temp", "attivo", "fonte", "created_at", "created_by"
            ) VALUES ($1, $2, $3, $4, true, false, 'csv-import', NOW(), $5)`,
            [titolo, cig, importo, data, request.user.username]
          );
          importati++;
        } catch (err) {
          errori++;
          errors.push({ titolo: record[mapping.titolo], error: err.message });
        }
      }

      return {
        success: true,
        importati,
        duplicati,
        errori,
        errors: errori > 0 ? errors : []
      };
    } catch (err) {
      fastify.log.error(err, 'CSV import error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ==================== DUPLICATE DETECTION ====================

  // GET /api/admin/bandi-import/duplicati
  fastify.get('/duplicati', async (request, reply) => {
    try {
      // Find duplicates by CIG
      const cigDuplicates = await query(`
        SELECT array_agg(id) AS ids, "cig", COUNT(*) AS count
        FROM bandi
        WHERE "cig" IS NOT NULL AND "cig" != ''
        GROUP BY "cig"
        HAVING COUNT(*) > 1
        ORDER BY count DESC
      `);

      // Find near-duplicates by title similarity
      const allBandi = await query(`
        SELECT id, "oggetto", "cig", "id_stazione", "data_gara"
        FROM bandi
        WHERE "temp" = false OR "temp" IS NULL
        ORDER BY id
      `);

      const similars = [];
      const bandi = allBandi.rows;

      for (let i = 0; i < bandi.length; i++) {
        for (let j = i + 1; j < bandi.length; j++) {
          const similarity = stringSimilarity(bandi[i].oggetto, bandi[j].oggetto);
          if (similarity > 0.85) {
            similars.push({
              id1: bandi[i].id,
              id2: bandi[j].id,
              titolo1: bandi[i].oggetto,
              titolo2: bandi[j].oggetto,
              cig1: bandi[i].cig,
              cig2: bandi[j].cig,
              similarity: Math.round(similarity * 100)
            });
          }
        }
      }

      return {
        cig_duplicates: cigDuplicates.rows,
        similar_bandi: similars.slice(0, 100)
      };
    } catch (err) {
      fastify.log.error(err, 'Duplicates detection error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/bandi-import/risolvi-duplicato
  fastify.post('/risolvi-duplicato', async (request, reply) => {
    try {
      const { id_originale, id_duplicato, azione } = request.body;

      if (!id_originale || !id_duplicato || !azione) {
        return reply.status(400).send({ error: 'id_originale, id_duplicato, and azione are required' });
      }

      if (!['mantieni', 'unisci', 'elimina'].includes(azione)) {
        return reply.status(400).send({ error: 'azione must be mantieni, unisci, or elimina' });
      }

      if (azione === 'mantieni') {
        // Delete the duplicate, keep original
        await query(`DELETE FROM bandi WHERE id = $1`, [id_duplicato]);
      } else if (azione === 'unisci') {
        // Merge: Update duplicate record links to point to original, then delete duplicate
        await query(
          `UPDATE bandi_links SET id_bando = $1 WHERE id_bando = $2`,
          [id_originale, id_duplicato]
        );
        await query(`DELETE FROM bandi WHERE id = $1`, [id_duplicato]);
      } else if (azione === 'elimina') {
        // Delete the original instead
        await query(`DELETE FROM bandi WHERE id = $1`, [id_originale]);
      }

      return {
        success: true,
        azione_eseguita: azione,
        message: `Duplicate resolution completed: ${azione}`
      };
    } catch (err) {
      fastify.log.error(err, 'Resolve duplicate error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ==================== IMPORT HISTORY ====================

  // GET /api/admin/bandi-import/storico
  fastify.get('/storico', async (request, reply) => {
    try {
      const result = await query(`
        SELECT id, fonte, data_import, bandi_importati, bandi_duplicati, errori, note
        FROM bandi_import_log
        ORDER BY data_import DESC
        LIMIT 100
      `);

      return {
        imports: result.rows
      };
    } catch (err) {
      fastify.log.error(err, 'Import history error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/admin/bandi-import/storico/:id
  fastify.get('/storico/:id', async (request, reply) => {
    try {
      const { id } = request.params;

      const importRecord = await query(
        `SELECT id, fonte, data_import, bandi_importati, bandi_duplicati, errori, note
         FROM bandi_import_log WHERE id = $1`,
        [id]
      );

      if (importRecord.rows.length === 0) {
        return reply.status(404).send({ error: 'Import record not found' });
      }

      const details = await query(
        `SELECT id, "oggetto", "cig", "data_gara", "fonte", "created_at"
         FROM bandi WHERE "created_at" >= (SELECT data_import FROM bandi_import_log WHERE id = $1) - INTERVAL '1 hour'
         AND "created_at" <= (SELECT data_import FROM bandi_import_log WHERE id = $1) + INTERVAL '1 hour'
         AND "fonte" = (SELECT fonte FROM bandi_import_log WHERE id = $1)
         LIMIT 100`,
        [id]
      );

      return {
        import: importRecord.rows[0],
        bandi_importati: details.rows
      };
    } catch (err) {
      fastify.log.error(err, 'Import history detail error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ==================== LINK MANAGEMENT ====================

  // POST /api/bandi/:id/link
  fastify.post('/bandi/:id/link', async (request, reply) => {
    try {
      const { id } = request.params;
      const { url, tipo, descrizione } = request.body;

      if (!url || !tipo) {
        return reply.status(400).send({ error: 'url and tipo are required' });
      }

      const result = await query(
        `INSERT INTO bandi_links (id_bando, url, tipo, descrizione, data_creazione)
         VALUES ($1, $2, $3, $4, NOW())
         RETURNING id, url, tipo, descrizione`,
        [id, url, tipo, descrizione]
      );

      return {
        success: true,
        link: result.rows[0]
      };
    } catch (err) {
      fastify.log.error(err, 'Add bandi link error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/bandi/:id/links
  fastify.get('/bandi/:id/links', async (request, reply) => {
    try {
      const { id } = request.params;

      const result = await query(
        `SELECT id, url, tipo, descrizione, data_creazione
         FROM bandi_links WHERE id_bando = $1
         ORDER BY data_creazione DESC`,
        [id]
      );

      return {
        links: result.rows
      };
    } catch (err) {
      fastify.log.error(err, 'Get bandi links error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // DELETE /api/bandi/links/:id
  fastify.delete('/bandi/links/:id', async (request, reply) => {
    try {
      const { id } = request.params;

      const result = await query(
        `DELETE FROM bandi_links WHERE id = $1 RETURNING id`,
        [id]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ error: 'Link not found' });
      }

      return {
        success: true,
        message: 'Link deleted'
      };
    } catch (err) {
      fastify.log.error(err, 'Delete bandi link error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/bandi/:id/link-esteso
  fastify.post('/bandi/:id/link-esteso', async (request, reply) => {
    try {
      const { id } = request.params;
      const { url, descrizione } = request.body;

      if (!url) {
        return reply.status(400).send({ error: 'url is required' });
      }

      // Auto-detect platform type from URL
      let tipo = 'generic';
      if (url.includes('maggioli')) tipo = 'maggioli';
      else if (url.includes('presidia')) tipo = 'presidia';
      else if (url.includes('anac.it')) tipo = 'anac';
      else if (url.includes('guri.it')) tipo = 'guri';
      else if (url.includes('eprocurement')) tipo = 'eprocurement';

      const result = await query(
        `INSERT INTO bandi_links (id_bando, url, tipo, descrizione, data_creazione)
         VALUES ($1, $2, $3, $4, NOW())
         RETURNING id, url, tipo, descrizione`,
        [id, url, tipo, descrizione]
      );

      return {
        success: true,
        link: result.rows[0],
        tipo_rilevato: tipo
      };
    } catch (err) {
      fastify.log.error(err, 'Add extended bandi link error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/bandi/links/per-tipologia/:tipo
  fastify.get('/bandi/links/per-tipologia/:tipo', async (request, reply) => {
    try {
      const { tipo } = request.params;

      const result = await query(
        `SELECT bl.id, bl.id_bando, bl.url, bl.descrizione, b."oggetto" AS bando_titolo, b."cig"
         FROM bandi_links bl
         JOIN bandi b ON bl.id_bando = b.id
         WHERE bl.tipo = $1
         ORDER BY bl.data_creazione DESC
         LIMIT 100`,
        [tipo]
      );

      return {
        tipo,
        links: result.rows
      };
    } catch (err) {
      fastify.log.error(err, 'Get links per tipologia error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/bandi/links/per-piattaforma/:id
  fastify.get('/bandi/links/per-piattaforma/:id', async (request, reply) => {
    try {
      const { id } = request.params;

      const result = await query(
        `SELECT bl.id, bl.id_bando, bl.url, bl.tipo, bl.descrizione, b."oggetto" AS bando_titolo
         FROM bandi_links bl
         JOIN bandi b ON bl.id_bando = b.id
         WHERE bl.id_piattaforma = $1
         ORDER BY bl.data_creazione DESC
         LIMIT 50`,
        [id]
      );

      return {
        id_piattaforma: id,
        links: result.rows
      };
    } catch (err) {
      fastify.log.error(err, 'Get links per piattaforma error');
      return reply.status(500).send({ error: err.message });
    }
  });
}
