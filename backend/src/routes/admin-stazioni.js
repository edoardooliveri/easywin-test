import { query } from '../db/pool.js';

export default async function adminStazioniRoutes(fastify, opts) {
  // Middleware: Authentication check
  fastify.addHook('preHandler', async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  // ============================================
  // STATION CRUD
  // ============================================

  // GET /api/admin/stazioni — List with advanced filters
  fastify.get('/stazioni', async (request, reply) => {
    try {
      const {
        page = 1,
        limit = 50,
        search,
        provincia,
        type,
        active_only,
        show_deleted,
        sort_by = 'ragione_sociale',
        sort_order = 'ASC'
      } = request.query;

      const offset = (parseInt(page) - 1) * parseInt(limit);
      const params = [];
      const conditions = [];

      // Search by name or VAT
      if (search) {
        params.push(`%${search}%`);
        const paramIdx = params.length;
        conditions.push(
          `(s."RagioneSociale" ILIKE $${paramIdx} OR s."Nome" ILIKE $${paramIdx} OR s."PartitaIva" ILIKE $${paramIdx})`
        );
      }

      // Filter by province
      if (provincia) {
        params.push(provincia);
        conditions.push(`p."Provincia" ILIKE $${params.length}`);
      }

      // Filter by type
      if (type) {
        params.push(type);
        conditions.push(`s."Tipo" = $${params.length}`);
      }

      // Active/Deleted filter
      if (active_only === 'true') {
        conditions.push(`s."eliminata" = false`);
      } else if (show_deleted !== 'true') {
        conditions.push(`s."eliminata" = false`);
      }

      const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

      // Count total
      const countRes = await query(
        `SELECT COUNT(*) FROM stazioni s LEFT JOIN province p ON s."id_provincia" = p."id_provincia" ${where}`,
        params
      );
      const total = parseInt(countRes.rows[0].count);

      // Data query
      params.push(parseInt(limit), offset);
      const dataRes = await query(`
        SELECT s."id", s."RagioneSociale" AS ragione_sociale, s."Nome" AS nome,
               s."Indirizzo" AS indirizzo, s."Cap" AS cap, s."Città" AS citta,
               s."Tel" AS telefono, s."PartitaIva" AS partita_iva,
               s."Email" AS email, s."Note" AS note,
               s."eliminata", s."Obsoleta" AS obsoleta, s."Tipo" AS tipo,
               s."Lat" AS lat, s."Lon" AS lon,
               s."IDPiattaformaDigitale" AS id_piattaforma,
               s."DataInserimento" AS data_inserimento, s."DataModifica" AS data_modifica,
               p."Provincia" AS provincia_nome, p."siglaprovincia" AS sigla_provincia,
               r."Regione" AS regione_nome,
               (SELECT COUNT(*) FROM bandi b WHERE b."id_stazione" = s."id") AS n_bandi,
               (SELECT COUNT(*) FROM gare g WHERE g."id_stazione" = s."id") AS n_esiti,
               (SELECT COUNT(*) FROM personale_stazione ps WHERE ps."id_stazione" = s."id") AS n_personale
        FROM stazioni s
        LEFT JOIN province p ON s."id_provincia" = p."id_provincia"
        LEFT JOIN regioni r ON p."id_regione" = r."id_regione"
        ${where}
        ORDER BY ${sanitizeSortColumn(sort_by)} ${sanitizeSortOrder(sort_order)}
        LIMIT $${params.length - 1} OFFSET $${params.length}
      `, params);

      return {
        dati: dataRes.rows,
        totale: total,
        pagina: parseInt(page),
        pagine: Math.ceil(total / parseInt(limit)),
        limit: parseInt(limit)
      };
    } catch (err) {
      fastify.log.error(err, 'Admin stazioni list error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/admin/stazioni/:id — Full detail with related data
  fastify.get('/stazioni/:id', async (request, reply) => {
    try {
      const { id } = request.params;

      // Station detail
      const staRes = await query(`
        SELECT s.*, p."Provincia" AS provincia_nome, p."id_provincia" AS id_provincia,
               r."Regione" AS regione_nome, r."id_regione" AS id_regione,
               pi."Piattaforma" AS piattaforma_nome, pi."Link" AS piattaforma_link
        FROM stazioni s
        LEFT JOIN province p ON s."id_provincia" = p."id_provincia"
        LEFT JOIN regioni r ON p."id_regione" = r."id_regione"
        LEFT JOIN piattaforme pi ON s."IDPiattaformaDigitale" = pi."ID"
        WHERE s."id" = $1
      `, [id]);

      if (staRes.rows.length === 0) {
        return reply.status(404).send({ error: 'Stazione non trovata' });
      }

      const station = staRes.rows[0];

      // Personnel
      const personnelRes = await query(`
        SELECT "id", "Nome" AS nome, "Cognome" AS cognome, "Ruolo" AS ruolo,
               "Email" AS email, "Tel" AS telefono, "Attivo" AS attivo
        FROM personale_stazione
        WHERE "id_stazione" = $1
        ORDER BY "DataInserimento" DESC
      `, [id]);

      // Registrations (Iscrizioni)
      const iscrizioniRes = await query(`
        SELECT "id", "id_stazione", "Piattaforma" AS piattaforma, "DataIscrizione" AS data_iscrizione,
               "DataScadenza" AS data_scadenza, "Tipo" AS tipo, "Istruzioni" AS istruzioni,
               "Durata" AS durata, "Attiva" AS attiva
        FROM iscrizione_stazioni
        WHERE "id_stazione" = $1
        ORDER BY "DataIscrizione" DESC
      `, [id]);

      // Recent Bandi
      const bandiRes = await query(`
        SELECT "id_bando" AS id, "Titolo" AS titolo, "DataPubblicazione" AS data_pubblicazione,
               "DataOfferta" AS data_offerta,
               COALESCE("ImportoSO",0) + COALESCE("ImportoCO",0) + COALESCE("ImportoEco",0) AS importo_totale,
               "CodiceCIG" AS cig
        FROM bandi
        WHERE "id_stazione" = $1
        ORDER BY "DataPubblicazione" DESC NULLS LAST
        LIMIT 10
      `, [id]);

      // Recent Esiti
      const esitiRes = await query(`
        SELECT "id", "Data" AS data, "Titolo" AS titolo, "Importo" AS importo,
               "NPartecipanti" AS n_partecipanti, "Ribasso" AS ribasso,
               "CodiceCIG" AS cig
        FROM gare
        WHERE "id_stazione" = $1
        ORDER BY "Data" DESC NULLS LAST
        LIMIT 10
      `, [id]);

      // Fonti Web count
      const fontiRes = await query(`
        SELECT COUNT(*) FROM fonti_web
        WHERE "id_stazione" = $1 AND "eliminata" = false
      `, [id]);

      return {
        stazione: station,
        personale: personnelRes.rows,
        iscrizioni: iscrizioniRes.rows,
        bandi_recenti: bandiRes.rows,
        esiti_recenti: esitiRes.rows,
        n_fonti_web: parseInt(fontiRes.rows[0].count)
      };
    } catch (err) {
      fastify.log.error(err, 'Admin stazione detail error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/stazioni — Create station
  fastify.post('/stazioni', async (request, reply) => {
    try {
      const {
        ragione_sociale,
        nome,
        indirizzo,
        cap,
        citta,
        id_provincia,
        telefono,
        email,
        partita_iva,
        lat,
        lon,
        id_piattaforma,
        tipo,
        note
      } = request.body;

      const result = await query(`
        INSERT INTO stazioni (
          "RagioneSociale", "Nome", "Indirizzo", "Cap", "Città",
          "id_provincia", "Tel", "Email", "PartitaIva",
          "Lat", "Lon", "IDPiattaformaDigitale", "Tipo", "Note",
          "eliminata", "DataInserimento", "DataModifica"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, false, NOW(), NOW())
        RETURNING "id"
      `, [
        ragione_sociale, nome, indirizzo, cap, citta,
        id_provincia, telefono, email, partita_iva,
        lat, lon, id_piattaforma, tipo, note
      ]);

      const stationId = result.rows[0].id;

      // Log modification
      await logModification(stationId, 'CREATE', 'Stazione creata', request.user.id);

      return reply.status(201).send({ id: stationId, message: 'Stazione creata' });
    } catch (err) {
      fastify.log.error(err, 'Create station error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // PUT /api/admin/stazioni/:id — Update station
  fastify.put('/stazioni/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const {
        ragione_sociale,
        nome,
        indirizzo,
        cap,
        citta,
        id_provincia,
        telefono,
        email,
        partita_iva,
        lat,
        lon,
        id_piattaforma,
        tipo,
        note,
        obsoleta
      } = request.body;

      await query(`
        UPDATE stazioni SET
          "RagioneSociale" = COALESCE($1, "RagioneSociale"),
          "Nome" = COALESCE($2, "Nome"),
          "Indirizzo" = COALESCE($3, "Indirizzo"),
          "Cap" = COALESCE($4, "Cap"),
          "Città" = COALESCE($5, "Città"),
          "id_provincia" = COALESCE($6, "id_provincia"),
          "Tel" = COALESCE($7, "Tel"),
          "Email" = COALESCE($8, "Email"),
          "PartitaIva" = COALESCE($9, "PartitaIva"),
          "Lat" = COALESCE($10, "Lat"),
          "Lon" = COALESCE($11, "Lon"),
          "IDPiattaformaDigitale" = COALESCE($12, "IDPiattaformaDigitale"),
          "Tipo" = COALESCE($13, "Tipo"),
          "Note" = COALESCE($14, "Note"),
          "Obsoleta" = COALESCE($15, "Obsoleta"),
          "DataModifica" = NOW()
        WHERE "id" = $16
      `, [
        ragione_sociale, nome, indirizzo, cap, citta,
        id_provincia, telefono, email, partita_iva,
        lat, lon, id_piattaforma, tipo, note,
        obsoleta, id
      ]);

      await logModification(id, 'UPDATE', 'Stazione aggiornata', request.user.id);

      return { message: 'Stazione aggiornata' };
    } catch (err) {
      fastify.log.error(err, 'Update station error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // DELETE /api/admin/stazioni/:id — Soft delete
  fastify.delete('/stazioni/:id', async (request, reply) => {
    try {
      const { id } = request.params;

      await query(`
        UPDATE stazioni SET "eliminata" = true, "DataModifica" = NOW() WHERE "id" = $1
      `, [id]);

      await logModification(id, 'SOFT_DELETE', 'Stazione eliminata (soft delete)', request.user.id);

      return { message: 'Stazione eliminata' };
    } catch (err) {
      fastify.log.error(err, 'Delete station error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ============================================
  // TRASH/RESTORE
  // ============================================

  // GET /api/admin/stazioni/cestino — List deleted stations
  fastify.get('/stazioni-trash', async (request, reply) => {
    try {
      const { page = 1, limit = 50 } = request.query;
      const offset = (parseInt(page) - 1) * parseInt(limit);

      const countRes = await query(`
        SELECT COUNT(*) FROM stazioni WHERE "eliminata" = true
      `);
      const total = parseInt(countRes.rows[0].count);

      const dataRes = await query(`
        SELECT "id", "RagioneSociale" AS ragione_sociale, "Nome" AS nome,
               "Email" AS email, "PartitaIva" AS partita_iva,
               "DataModifica" AS data_modifica
        FROM stazioni
        WHERE "eliminata" = true
        ORDER BY "DataModifica" DESC
        LIMIT $1 OFFSET $2
      `, [parseInt(limit), offset]);

      return {
        dati: dataRes.rows,
        totale: total,
        pagina: parseInt(page),
        pagine: Math.ceil(total / parseInt(limit))
      };
    } catch (err) {
      fastify.log.error(err, 'Trash list error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/stazioni/:id/ripristina — Restore deleted station
  fastify.post('/stazioni/:id/ripristina', async (request, reply) => {
    try {
      const { id } = request.params;

      await query(`
        UPDATE stazioni SET "eliminata" = false, "DataModifica" = NOW() WHERE "id" = $1
      `, [id]);

      await logModification(id, 'RESTORE', 'Stazione ripristinata', request.user.id);

      return { message: 'Stazione ripristinata' };
    } catch (err) {
      fastify.log.error(err, 'Restore station error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // DELETE /api/admin/stazioni/:id/definitivo — Permanent delete
  fastify.delete('/stazioni/:id/definitivo', async (request, reply) => {
    try {
      const { id } = request.params;

      // Delete related data first
      await query(`DELETE FROM personale_stazione WHERE "id_stazione" = $1`, [id]);
      await query(`DELETE FROM iscrizione_stazioni WHERE "id_stazione" = $1`, [id]);
      await query(`DELETE FROM fonti_web WHERE "id_stazione" = $1`, [id]);
      await query(`DELETE FROM stazioni_presidia WHERE "id_stazione" = $1`, [id]);

      // Delete station
      await query(`DELETE FROM stazioni WHERE "id" = $1`, [id]);

      await logModification(id, 'HARD_DELETE', 'Stazione eliminata (hard delete)', request.user.id);

      return { message: 'Stazione eliminata definitivamente' };
    } catch (err) {
      fastify.log.error(err, 'Permanent delete error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ============================================
  // PERSONNEL
  // ============================================

  // GET /api/admin/stazioni/:id/personale — List personnel
  fastify.get('/stazioni/:id/personale', async (request, reply) => {
    try {
      const { id } = request.params;

      const result = await query(`
        SELECT "id", "id_stazione", "Nome" AS nome, "Cognome" AS cognome, "Ruolo" AS ruolo,
               "Email" AS email, "Tel" AS telefono, "Attivo" AS attivo,
               "DataInserimento" AS data_inserimento
        FROM personale_stazione
        WHERE "id_stazione" = $1
        ORDER BY "DataInserimento" DESC
      `, [id]);

      return { personale: result.rows };
    } catch (err) {
      fastify.log.error(err, 'Personnel list error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/stazioni/:id/personale — Add personnel
  fastify.post('/stazioni/:id/personale', async (request, reply) => {
    try {
      const { id } = request.params;
      const { nome, cognome, ruolo, email, telefono } = request.body;

      const result = await query(`
        INSERT INTO personale_stazione ("id_stazione", "Nome", "Cognome", "Ruolo", "Email", "Tel", "Attivo", "DataInserimento")
        VALUES ($1, $2, $3, $4, $5, $6, true, NOW())
        RETURNING "id"
      `, [id, nome, cognome, ruolo, email, telefono]);

      const personId = result.rows[0].id;

      await logModification(id, 'ADD_PERSONNEL', `Personale aggiunto: ${nome} ${cognome}`, request.user.id);

      return reply.status(201).send({ id: personId, message: 'Personale aggiunto' });
    } catch (err) {
      fastify.log.error(err, 'Add personnel error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // PUT /api/admin/stazioni/personale/:id — Update personnel
  fastify.put('/stazioni/personale/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const { nome, cognome, ruolo, email, telefono, attivo } = request.body;

      const stRes = await query(`SELECT "id_stazione" FROM personale_stazione WHERE "id" = $1`, [id]);
      if (stRes.rows.length === 0) {
        return reply.status(404).send({ error: 'Personale non trovato' });
      }
      const stationId = stRes.rows[0].id_stazione;

      await query(`
        UPDATE personale_stazione SET
          "Nome" = COALESCE($1, "Nome"),
          "Cognome" = COALESCE($2, "Cognome"),
          "Ruolo" = COALESCE($3, "Ruolo"),
          "Email" = COALESCE($4, "Email"),
          "Tel" = COALESCE($5, "Tel"),
          "Attivo" = COALESCE($6, "Attivo")
        WHERE "id" = $7
      `, [nome, cognome, ruolo, email, telefono, attivo, id]);

      await logModification(stationId, 'UPDATE_PERSONNEL', 'Personale aggiornato', request.user.id);

      return { message: 'Personale aggiornato' };
    } catch (err) {
      fastify.log.error(err, 'Update personnel error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // DELETE /api/admin/stazioni/personale/:id — Delete personnel
  fastify.delete('/stazioni/personale/:id', async (request, reply) => {
    try {
      const { id } = request.params;

      const stRes = await query(`SELECT "id_stazione" FROM personale_stazione WHERE "id" = $1`, [id]);
      if (stRes.rows.length === 0) {
        return reply.status(404).send({ error: 'Personale non trovato' });
      }
      const stationId = stRes.rows[0].id_stazione;

      await query(`DELETE FROM personale_stazione WHERE "id" = $1`, [id]);

      await logModification(stationId, 'DELETE_PERSONNEL', 'Personale eliminato', request.user.id);

      return { message: 'Personale eliminato' };
    } catch (err) {
      fastify.log.error(err, 'Delete personnel error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ============================================
  // ISCRIZIONI (Registrations)
  // ============================================

  // GET /api/admin/stazioni/:id/iscrizioni — List registrations
  fastify.get('/stazioni/:id/iscrizioni', async (request, reply) => {
    try {
      const { id } = request.params;

      const result = await query(`
        SELECT "id", "id_stazione", "Piattaforma" AS piattaforma, "DataIscrizione" AS data_iscrizione,
               "DataScadenza" AS data_scadenza, "Tipo" AS tipo, "Istruzioni" AS istruzioni,
               "Durata" AS durata, "Attiva" AS attiva
        FROM iscrizione_stazioni
        WHERE "id_stazione" = $1
        ORDER BY "DataIscrizione" DESC
      `, [id]);

      return { iscrizioni: result.rows };
    } catch (err) {
      fastify.log.error(err, 'Iscrizioni list error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/stazioni/:id/iscrizioni — Add registration
  fastify.post('/stazioni/:id/iscrizioni', async (request, reply) => {
    try {
      const { id } = request.params;
      const { piattaforma, durata, data_scadenza, tipo, istruzioni } = request.body;

      const result = await query(`
        INSERT INTO iscrizione_stazioni (
          "id_stazione", "Piattaforma", "DataIscrizione", "DataScadenza",
          "Tipo", "Istruzioni", "Durata", "Attiva"
        ) VALUES ($1, $2, NOW(), $3, $4, $5, $6, true)
        RETURNING "id"
      `, [id, piattaforma, data_scadenza, tipo, istruzioni, durata]);

      const iscrId = result.rows[0].id;

      await logModification(id, 'ADD_ISCRIZIONE', `Iscrizione aggiunta: ${piattaforma}`, request.user.id);

      return reply.status(201).send({ id: iscrId, message: 'Iscrizione aggiunta' });
    } catch (err) {
      fastify.log.error(err, 'Add iscrizione error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // PUT /api/admin/stazioni/iscrizioni/:id — Update registration
  fastify.put('/stazioni/iscrizioni/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const { piattaforma, durata, data_scadenza, tipo, istruzioni, attiva } = request.body;

      const iscrRes = await query(`SELECT "id_stazione" FROM iscrizione_stazioni WHERE "id" = $1`, [id]);
      if (iscrRes.rows.length === 0) {
        return reply.status(404).send({ error: 'Iscrizione non trovata' });
      }
      const stationId = iscrRes.rows[0].id_stazione;

      await query(`
        UPDATE iscrizione_stazioni SET
          "Piattaforma" = COALESCE($1, "Piattaforma"),
          "DataScadenza" = COALESCE($2, "DataScadenza"),
          "Tipo" = COALESCE($3, "Tipo"),
          "Istruzioni" = COALESCE($4, "Istruzioni"),
          "Durata" = COALESCE($5, "Durata"),
          "Attiva" = COALESCE($6, "Attiva")
        WHERE "id" = $7
      `, [piattaforma, data_scadenza, tipo, istruzioni, durata, attiva, id]);

      await logModification(stationId, 'UPDATE_ISCRIZIONE', 'Iscrizione aggiornata', request.user.id);

      return { message: 'Iscrizione aggiornata' };
    } catch (err) {
      fastify.log.error(err, 'Update iscrizione error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // DELETE /api/admin/stazioni/iscrizioni/:id — Delete registration
  fastify.delete('/stazioni/iscrizioni/:id', async (request, reply) => {
    try {
      const { id } = request.params;

      const iscrRes = await query(`SELECT "id_stazione" FROM iscrizione_stazioni WHERE "id" = $1`, [id]);
      if (iscrRes.rows.length === 0) {
        return reply.status(404).send({ error: 'Iscrizione non trovata' });
      }
      const stationId = iscrRes.rows[0].id_stazione;

      await query(`DELETE FROM iscrizione_stazioni WHERE "id" = $1`, [id]);

      await logModification(stationId, 'DELETE_ISCRIZIONE', 'Iscrizione eliminata', request.user.id);

      return { message: 'Iscrizione eliminata' };
    } catch (err) {
      fastify.log.error(err, 'Delete iscrizione error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ============================================
  // FONTI WEB (Web Sources)
  // ============================================

  // GET /api/admin/stazioni/:id/fonti-web — List web sources
  fastify.get('/stazioni/:id/fonti-web', async (request, reply) => {
    try {
      const { id } = request.params;

      const result = await query(`
        SELECT "id", "id_stazione", "Categoria" AS categoria, "Tipo" AS tipo,
               "Link" AS link, "Auto" AS auto_flag, "AnalyzeType" AS analyze_type,
               "Tag" AS tags, "Verificata" AS verificata, "DataVerifica" AS data_verifica,
               "DataInserimento" AS data_inserimento, "eliminata"
        FROM fonti_web
        WHERE "id_stazione" = $1 AND "eliminata" = false
        ORDER BY "DataInserimento" DESC
      `, [id]);

      return { fonti_web: result.rows };
    } catch (err) {
      fastify.log.error(err, 'Fonti web list error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/stazioni/:id/fonti-web — Add web source
  fastify.post('/stazioni/:id/fonti-web', async (request, reply) => {
    try {
      const { id } = request.params;
      const { categoria, tipo, link, auto_flag, analyze_type, tags } = request.body;

      const result = await query(`
        INSERT INTO fonti_web (
          "id_stazione", "Categoria", "Tipo", "Link", "Auto",
          "AnalyzeType", "Tag", "DataInserimento", "eliminata"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), false)
        RETURNING "id"
      `, [id, categoria, tipo, link, auto_flag, analyze_type, tags]);

      const fonteId = result.rows[0].id;

      await logModification(id, 'ADD_FONTE_WEB', `Fonte web aggiunta: ${link}`, request.user.id);

      return reply.status(201).send({ id: fonteId, message: 'Fonte web aggiunta' });
    } catch (err) {
      fastify.log.error(err, 'Add fonte web error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // PUT /api/admin/stazioni/fonti-web/:id — Update web source
  fastify.put('/stazioni/fonti-web/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const { categoria, tipo, link, auto_flag, analyze_type, tags } = request.body;

      const fonteRes = await query(`SELECT "id_stazione" FROM fonti_web WHERE "id" = $1`, [id]);
      if (fonteRes.rows.length === 0) {
        return reply.status(404).send({ error: 'Fonte web non trovata' });
      }
      const stationId = fonteRes.rows[0].id_stazione;

      await query(`
        UPDATE fonti_web SET
          "Categoria" = COALESCE($1, "Categoria"),
          "Tipo" = COALESCE($2, "Tipo"),
          "Link" = COALESCE($3, "Link"),
          "Auto" = COALESCE($4, "Auto"),
          "AnalyzeType" = COALESCE($5, "AnalyzeType"),
          "Tag" = COALESCE($6, "Tag")
        WHERE "id" = $7
      `, [categoria, tipo, link, auto_flag, analyze_type, tags, id]);

      await logModification(stationId, 'UPDATE_FONTE_WEB', 'Fonte web aggiornata', request.user.id);

      return { message: 'Fonte web aggiornata' };
    } catch (err) {
      fastify.log.error(err, 'Update fonte web error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // DELETE /api/admin/stazioni/fonti-web/:id — Soft delete web source
  fastify.delete('/stazioni/fonti-web/:id', async (request, reply) => {
    try {
      const { id } = request.params;

      const fonteRes = await query(`SELECT "id_stazione" FROM fonti_web WHERE "id" = $1`, [id]);
      if (fonteRes.rows.length === 0) {
        return reply.status(404).send({ error: 'Fonte web non trovata' });
      }
      const stationId = fonteRes.rows[0].id_stazione;

      await query(`UPDATE fonti_web SET "eliminata" = true WHERE "id" = $1`, [id]);

      await logModification(stationId, 'DELETE_FONTE_WEB', 'Fonte web eliminata', request.user.id);

      return { message: 'Fonte web eliminata' };
    } catch (err) {
      fastify.log.error(err, 'Delete fonte web error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/stazioni/fonti-web/:id/verifica — Verify web source
  fastify.post('/stazioni/fonti-web/:id/verifica', async (request, reply) => {
    try {
      const { id } = request.params;

      const fonteRes = await query(`SELECT "id_stazione" FROM fonti_web WHERE "id" = $1`, [id]);
      if (fonteRes.rows.length === 0) {
        return reply.status(404).send({ error: 'Fonte web non trovata' });
      }
      const stationId = fonteRes.rows[0].id_stazione;

      // In production, verify URL is accessible
      await query(`
        UPDATE fonti_web SET "Verificata" = true, "DataVerifica" = NOW() WHERE "id" = $1
      `, [id]);

      await logModification(stationId, 'VERIFY_FONTE_WEB', 'Fonte web verificata', request.user.id);

      return { message: 'Fonte web verificata' };
    } catch (err) {
      fastify.log.error(err, 'Verify fonte web error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/admin/stazioni/fonti-web/:id/regole — List regex rules
  fastify.get('/stazioni/fonti-web/:id/regole', async (request, reply) => {
    try {
      const { id } = request.params;

      const result = await query(`
        SELECT "id", "id_fonte_web", "Regex" AS regex, "Descrizione" AS descrizione,
               "Attiva" AS attiva, "DataInserimento" AS data_inserimento
        FROM fonti_web_regulars
        WHERE "id_fonte_web" = $1
        ORDER BY "DataInserimento" DESC
      `, [id]);

      return { regole: result.rows };
    } catch (err) {
      fastify.log.error(err, 'Regole list error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/stazioni/fonti-web/:id/regole — Add regex rule
  fastify.post('/stazioni/fonti-web/:id/regole', async (request, reply) => {
    try {
      const { id } = request.params;
      const { regex, descrizione } = request.body;

      const result = await query(`
        INSERT INTO fonti_web_regulars ("id_fonte_web", "Regex", "Descrizione", "Attiva", "DataInserimento")
        VALUES ($1, $2, $3, true, NOW())
        RETURNING "id"
      `, [id, regex, descrizione]);

      const regoleId = result.rows[0].id;

      // Get station for logging
      const fonteRes = await query(`SELECT "id_stazione" FROM fonti_web WHERE "id" = $1`, [id]);
      const stationId = fonteRes.rows[0].id_stazione;

      await logModification(stationId, 'ADD_REGEX_RULE', 'Regola regex aggiunta', request.user.id);

      return reply.status(201).send({ id: regoleId, message: 'Regola aggiunta' });
    } catch (err) {
      fastify.log.error(err, 'Add regole error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // DELETE /api/admin/stazioni/fonti-web/regole/:id — Delete regex rule
  fastify.delete('/stazioni/fonti-web/regole/:id', async (request, reply) => {
    try {
      const { id } = request.params;

      const regRes = await query(`SELECT "id_fonte_web" FROM fonti_web_regulars WHERE "id" = $1`, [id]);
      if (regRes.rows.length === 0) {
        return reply.status(404).send({ error: 'Regola non trovata' });
      }

      const fonteId = regRes.rows[0].id_fonte_web;
      const fonteRes = await query(`SELECT "id_stazione" FROM fonti_web WHERE "id" = $1`, [fonteId]);
      const stationId = fonteRes.rows[0].id_stazione;

      await query(`DELETE FROM fonti_web_regulars WHERE "id" = $1`, [id]);

      await logModification(stationId, 'DELETE_REGEX_RULE', 'Regola regex eliminata', request.user.id);

      return { message: 'Regola eliminata' };
    } catch (err) {
      fastify.log.error(err, 'Delete regole error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ============================================
  // PRESIDIA MAPPING
  // ============================================

  // GET /api/admin/stazioni/:id/presidia — Get Presidia mapping
  fastify.get('/stazioni/:id/presidia', async (request, reply) => {
    try {
      const { id } = request.params;

      const result = await query(`
        SELECT "id_stazione", "id_presidia", "DataCollegamento" AS data_collegamento
        FROM stazioni_presidia
        WHERE "id_stazione" = $1
      `, [id]);

      return { presidia: result.rows };
    } catch (err) {
      fastify.log.error(err, 'Presidia mapping error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/stazioni/:id/presidia — Link to Presidia
  fastify.post('/stazioni/:id/presidia', async (request, reply) => {
    try {
      const { id } = request.params;
      const { id_presidia } = request.body;

      await query(`
        INSERT INTO stazioni_presidia ("id_stazione", "id_presidia", "DataCollegamento")
        VALUES ($1, $2, NOW())
        ON CONFLICT DO NOTHING
      `, [id, id_presidia]);

      await logModification(id, 'LINK_PRESIDIA', `Presidia collegato: ${id_presidia}`, request.user.id);

      return { message: 'Presidia collegato' };
    } catch (err) {
      fastify.log.error(err, 'Link presidia error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // DELETE /api/admin/stazioni/:id/presidia — Unlink Presidia
  fastify.delete('/stazioni/:id/presidia', async (request, reply) => {
    try {
      const { id } = request.params;
      const { id_presidia } = request.body;

      await query(`
        DELETE FROM stazioni_presidia WHERE "id_stazione" = $1 AND "id_presidia" = $2
      `, [id, id_presidia]);

      await logModification(id, 'UNLINK_PRESIDIA', `Presidia scollegato: ${id_presidia}`, request.user.id);

      return { message: 'Presidia scollegato' };
    } catch (err) {
      fastify.log.error(err, 'Unlink presidia error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ============================================
  // STATION OPERATIONS
  // ============================================

  // POST /api/admin/stazioni/:id/sostituisci — Replace obsolete station
  fastify.post('/stazioni/:id/sostituisci', async (request, reply) => {
    try {
      const { id } = request.params;
      const { id_new_station } = request.body;

      // Move bandi
      await query(`
        UPDATE bandi SET "id_stazione" = $1 WHERE "id_stazione" = $2
      `, [id_new_station, id]);

      // Move gare/esiti
      await query(`
        UPDATE gare SET "id_stazione" = $1 WHERE "id_stazione" = $2
      `, [id_new_station, id]);

      // Mark old as obsolete
      await query(`
        UPDATE stazioni SET "Obsoleta" = true WHERE "id" = $1
      `, [id]);

      await logModification(id, 'REPLACE_STATION', `Stazione sostituita con: ${id_new_station}`, request.user.id);

      return { message: 'Stazione sostituita' };
    } catch (err) {
      fastify.log.error(err, 'Replace station error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/stazioni/:id/propaga-piattaforma — Propagate platform to sources
  fastify.post('/stazioni/:id/propaga-piattaforma', async (request, reply) => {
    try {
      const { id } = request.params;
      const { id_piattaforma } = request.body;

      // Update all sources for this station
      await query(`
        UPDATE fonti_web SET "AnalyzeType" = $1
        WHERE "id_stazione" = $2
      `, [id_piattaforma, id]);

      await logModification(id, 'PROPAGATE_PLATFORM', `Piattaforma propagata: ${id_piattaforma}`, request.user.id);

      return { message: 'Piattaforma propagata a tutte le fonti' };
    } catch (err) {
      fastify.log.error(err, 'Propagate platform error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/admin/stazioni/:id/bandi — List bandi for station
  fastify.get('/stazioni/:id/bandi', async (request, reply) => {
    try {
      const { id } = request.params;
      const { page = 1, limit = 50 } = request.query;
      const offset = (parseInt(page) - 1) * parseInt(limit);

      const countRes = await query(`
        SELECT COUNT(*) FROM bandi WHERE "id_stazione" = $1
      `, [id]);
      const total = parseInt(countRes.rows[0].count);

      const dataRes = await query(`
        SELECT "id_bando" AS id, "Titolo" AS titolo, "DataPubblicazione" AS data_pubblicazione,
               "DataOfferta" AS data_offerta, "ImportoSO", "ImportoCO", "ImportoEco",
               "CodiceCIG" AS cig
        FROM bandi
        WHERE "id_stazione" = $1
        ORDER BY "DataPubblicazione" DESC NULLS LAST
        LIMIT $2 OFFSET $3
      `, [id, parseInt(limit), offset]);

      return {
        dati: dataRes.rows,
        totale: total,
        pagina: parseInt(page),
        pagine: Math.ceil(total / parseInt(limit))
      };
    } catch (err) {
      fastify.log.error(err, 'Station bandi list error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/admin/stazioni/:id/esiti — List esiti for station
  fastify.get('/stazioni/:id/esiti', async (request, reply) => {
    try {
      const { id } = request.params;
      const { page = 1, limit = 50 } = request.query;
      const offset = (parseInt(page) - 1) * parseInt(limit);

      const countRes = await query(`
        SELECT COUNT(*) FROM gare WHERE "id_stazione" = $1
      `, [id]);
      const total = parseInt(countRes.rows[0].count);

      const dataRes = await query(`
        SELECT "id", "Data" AS data, "Titolo" AS titolo, "Importo" AS importo,
               "NPartecipanti" AS n_partecipanti, "Ribasso" AS ribasso,
               "CodiceCIG" AS cig
        FROM gare
        WHERE "id_stazione" = $1
        ORDER BY "Data" DESC NULLS LAST
        LIMIT $2 OFFSET $3
      `, [id, parseInt(limit), offset]);

      return {
        dati: dataRes.rows,
        totale: total,
        pagina: parseInt(page),
        pagine: Math.ceil(total / parseInt(limit))
      };
    } catch (err) {
      fastify.log.error(err, 'Station esiti list error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ============================================
  // SEARCH/AUTOCOMPLETE
  // ============================================

  // GET /api/admin/stazioni/search?term= — Autocomplete station names
  fastify.get('/search', async (request, reply) => {
    try {
      const { term = '' } = request.query;
      const searchTerm = `%${term}%`;

      const result = await query(`
        SELECT "id", "RagioneSociale" AS ragione_sociale, "Nome" AS nome, "PartitaIva" AS partita_iva
        FROM stazioni
        WHERE ("RagioneSociale" ILIKE $1 OR "Nome" ILIKE $1 OR "PartitaIva" ILIKE $1)
        AND "eliminata" = false
        LIMIT 20
      `, [searchTerm]);

      return { risultati: result.rows };
    } catch (err) {
      fastify.log.error(err, 'Search error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/admin/stazioni/search-province?term= — Search by province
  fastify.get('/search-province', async (request, reply) => {
    try {
      const { term = '' } = request.query;
      const searchTerm = `%${term}%`;

      const result = await query(`
        SELECT "id_provincia" AS id, "Provincia" AS provincia, "siglaprovincia" AS sigla
        FROM province
        WHERE "Provincia" ILIKE $1
        LIMIT 20
      `, [searchTerm]);

      return { risultati: result.rows };
    } catch (err) {
      fastify.log.error(err, 'Province search error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/admin/stazioni/search-piva?term= — Search by P.IVA
  fastify.get('/search-piva', async (request, reply) => {
    try {
      const { term = '' } = request.query;
      const searchTerm = `%${term}%`;

      const result = await query(`
        SELECT "id", "RagioneSociale" AS ragione_sociale, "PartitaIva" AS partita_iva
        FROM stazioni
        WHERE "PartitaIva" ILIKE $1 AND "eliminata" = false
        LIMIT 20
      `, [searchTerm]);

      return { risultati: result.rows };
    } catch (err) {
      fastify.log.error(err, 'P.IVA search error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ============================================
  // AUDIT
  // ============================================

  // GET /api/admin/stazioni/:id/storia — Modification history
  fastify.get('/stazioni/:id/storia', async (request, reply) => {
    try {
      const { id } = request.params;
      const { page = 1, limit = 50 } = request.query;
      const offset = (parseInt(page) - 1) * parseInt(limit);

      const countRes = await query(`
        SELECT COUNT(*) FROM modifiche_stazioni WHERE "id_stazione" = $1
      `, [id]);
      const total = parseInt(countRes.rows[0].count);

      const dataRes = await query(`
        SELECT "id", "id_stazione", "TipoModifica" AS tipo_modifica,
               "Descrizione" AS descrizione, "IdUtente" AS id_utente,
               "Data" AS data
        FROM modifiche_stazioni
        WHERE "id_stazione" = $1
        ORDER BY "Data" DESC
        LIMIT $2 OFFSET $3
      `, [id, parseInt(limit), offset]);

      return {
        dati: dataRes.rows,
        totale: total,
        pagina: parseInt(page),
        pagine: Math.ceil(total / parseInt(limit))
      };
    } catch (err) {
      fastify.log.error(err, 'History error');
      return reply.status(500).send({ error: err.message });
    }
  });
}

// ============================================
// HELPER FUNCTIONS
// ============================================

async function logModification(stationId, tipo, descrizione, userId) {
  try {
    await query(`
      INSERT INTO modifiche_stazioni ("id_stazione", "TipoModifica", "Descrizione", "IdUtente", "Data")
      VALUES ($1, $2, $3, $4, NOW())
    `, [stationId, tipo, descrizione, userId]);
  } catch (err) {
    console.error('Error logging modification:', err);
  }
}

function sanitizeSortColumn(col) {
  const allowed = [
    'ragione_sociale', 'nome', 'citta', 'provincia', 'obsoleta', 'data_inserimento'
  ];
  return allowed.includes(col) ? `s."${col}"` : 's."RagioneSociale"';
}

function sanitizeSortOrder(order) {
  return order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
}
