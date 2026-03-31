import { query, transaction } from '../db/pool.js';

export default async function adminAziendeRoutes(fastify, opts) {
  // Middleware: require authentication
  fastify.addHook('preHandler', async (request, reply) => {
    if (!request.session?.user?.id) {
      return reply.status(401).send({ error: 'Not authenticated' });
    }
  });

  // ============================================================
  // COMPANY CRUD
  // ============================================================

  /**
   * GET /api/admin/aziende
   * List companies with advanced filters, pagination, sorting
   */
  fastify.get('/', async (request, reply) => {
    try {
      const {
        page = 1, limit = 50, sort = 'RagioneSociale', order = 'ASC',
        search, provincia, soa, tipo_attestazione, active = null, deleted = false
      } = request.query;

      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
      const conditions = [];
      const params = [];
      let paramIdx = 1;

      // Base condition: exclude or include deleted based on deleted param
      if (deleted === 'true' || deleted === true) {
        conditions.push('a."eliminata" = true');
      } else {
        conditions.push('a."eliminata" = false');
      }

      // Search by name, P.IVA, CF, email
      if (search) {
        conditions.push(
          `(a."RagioneSociale" ILIKE $${paramIdx} OR a."PartitaIva" ILIKE $${paramIdx} OR a."CodiceFiscale" ILIKE $${paramIdx} OR a."Email" ILIKE $${paramIdx})`
        );
        params.push(`%${search}%`);
        paramIdx++;
      }

      // Filter by province
      if (provincia) {
        conditions.push(`p."Provincia" ILIKE $${paramIdx}`);
        params.push(`%${provincia}%`);
        paramIdx++;
      }

      // Filter by SOA type
      if (soa) {
        conditions.push(`a."TipologiaAttestazione" ILIKE $${paramIdx}`);
        params.push(`%${soa}%`);
        paramIdx++;
      }

      // Filter by certification type
      if (tipo_attestazione) {
        conditions.push(`a."TipologiaAttestazione" ILIKE $${paramIdx}`);
        params.push(`%${tipo_attestazione}%`);
        paramIdx++;
      }

      // Filter by active status (non-cessata)
      if (active === 'true') {
        conditions.push('a."Cessata" = false');
      } else if (active === 'false') {
        conditions.push('a."Cessata" = true');
      }

      const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

      // Count total
      const countRes = await query(
        `SELECT COUNT(*) as total FROM aziende a LEFT JOIN province p ON a."id_provincia" = p."id_provincia" ${whereClause}`,
        params
      );

      const total = parseInt(countRes.rows[0].total);

      // Allowed sort columns
      const allowedSort = ['RagioneSociale', 'DataCreazione', 'PartitaIva', 'Città'];
      const sortCol = allowedSort.includes(sort) ? `a."${sort}"` : 'a."RagioneSociale"';
      const sortDir = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

      params.push(limit, offset);
      const dataRes = await query(`
        SELECT a."id", a."RagioneSociale" AS ragione_sociale, a."Nome" AS nome,
               a."Indirizzo" AS indirizzo, a."Cap" AS cap, a."Città" AS citta,
               a."PartitaIva" AS partita_iva, a."CodiceFiscale" AS codice_fiscale,
               a."Email" AS email, a."Tel" AS telefono, a."Note" AS note,
               a."eliminata", a."Cessata" AS cessata,
               a."IndirizzoPEC" AS pec, a."CodiceSDI" AS codice_sdi,
               a."TipologiaAttestazione" AS tipo_attestazione,
               a."SocAttestatriceSoa" AS soc_attestatrice,
               a."DataRilascioAttestazioneInCorso" AS data_rilascio_soa,
               a."ValiditàQuinquennale" AS validita_quinquennale,
               a."ValiditàTriennale" AS validita_triennale,
               a."ScadenzaEsiti" AS scadenza_esiti, a."ScadenzaBandi" AS scadenza_bandi,
               a."Referente" AS referente, a."TelefonoReferente" AS tel_referente,
               a."UsernameResponsabile" AS username_responsabile,
               a."AbbonatoSopralluoghi" AS abbonato_sopralluoghi,
               a."AbbonatoAperture" AS abbonato_aperture,
               a."DataCreazione" AS created_at, a."DataModifica" AS updated_at,
               p."Provincia" AS provincia_nome, p."id_provincia" AS id_provincia,
               r."Regione" AS regione_nome
        FROM aziende a
        LEFT JOIN province p ON a."id_provincia" = p."id_provincia"
        LEFT JOIN regioni r ON p."id_regione" = r."id_regione"
        ${whereClause}
        ORDER BY ${sortCol} ${sortDir}
        LIMIT $${params.length - 1} OFFSET $${params.length}
      `, params);

      return {
        dati: dataRes.rows,
        totale: total,
        pagina: parseInt(page),
        pagine: Math.ceil(total / parseInt(limit))
      };
    } catch (err) {
      fastify.log.error(err, 'Admin aziende list error');
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * GET /api/admin/aziende/:id
   * Full company detail with attestazioni, personnel, events, notes, esiti stats
   */
  fastify.get('/:id', async (request, reply) => {
    try {
      const { id } = request.params;

      // Company details
      const azRes = await query(`
        SELECT a.*, p."Provincia" AS provincia_nome, r."Regione" AS regione_nome
        FROM aziende a
        LEFT JOIN province p ON a."id_provincia" = p."id_provincia"
        LEFT JOIN regioni r ON p."id_regione" = r."id_regione"
        WHERE a."id" = $1
      `, [id]);

      if (azRes.rows.length === 0) {
        return reply.status(404).send({ error: 'Azienda non trovata' });
      }

      const azienda = azRes.rows[0];

      // Attestazioni/SOA
      const attestazioniRes = await query(`
        SELECT aa."id", aa."IdSoa", aa."id_attestazione", aa."Anno",
               s."cod" AS codice_soa, s."Descrizione" AS descrizione_soa,
               att."Attestazione" AS classifica, att."Importo" AS importo_classifica,
               aa."DataInserimento" AS data_inserimento, aa."scadenza"
        FROM attestazioniaziende aa
        LEFT JOIN soa s ON aa."IdSoa" = s."id"
        LEFT JOIN attestazioni att ON aa."id_attestazione" = att."id_Attestazione"
        WHERE aa."IdAzienda" = $1
        ORDER BY aa."Anno" DESC
      `, [id]);

      // Personnel (soggetti art. 94)
      const personaleRes = await query(`
        SELECT "id", "Nome" AS nome, "Ruolo" AS ruolo, "CodiceFiscale" AS codice_fiscale,
               "DataInserimento" AS data_inserimento
        FROM aziendapersonale
        WHERE "IdAzienda" = $1
        ORDER BY "DataInserimento" DESC
      `, [id]);

      // Notes
      const noteRes = await query(`
        SELECT "id", "Data" AS data, "UserName" AS username, "Nota" AS nota, "DataAlert" AS data_alert
        FROM noteaziende
        WHERE "IDAzienda" = $1
        ORDER BY "Data" DESC
        LIMIT 50
      `, [id]);

      // Events
      const eventiRes = await query(`
        SELECT "id", "Data" AS data, "Tipo" AS tipo, "Descrizione" AS descrizione,
               "UserName" AS username
        FROM eventiaziende
        WHERE "IDAzienda" = $1
        ORDER BY "Data" DESC
        LIMIT 50
      `, [id]);

      // Recent esiti/gare
      const gareRes = await query(`
        SELECT g."id", g."Data" AS data, g."Titolo" AS titolo, g."Importo" AS importo,
               dg."Ribasso" AS ribasso, dg."Posizione" AS posizione,
               dg."Vincitrice" AS vincitrice, dg."Anomalia" AS anomalia,
               s."RagioneSociale" AS stazione
        FROM dettagliogara dg
        JOIN gare g ON dg."id_gara" = g."id"
        LEFT JOIN stazioni s ON g."id_stazione" = s."id"
        WHERE dg."id_azienda" = $1
        ORDER BY g."Data" DESC
        LIMIT 40
      `, [id]);

      return {
        azienda,
        attestazioni: attestazioniRes.rows,
        personale: personaleRes.rows,
        note: noteRes.rows,
        eventi: eventiRes.rows,
        gare_recenti: gareRes.rows
      };
    } catch (err) {
      fastify.log.error(err, 'Admin azienda detail error');
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * POST /api/admin/aziende
   * Create new company
   */
  fastify.post('/', async (request, reply) => {
    try {
      const {
        ragione_sociale, nome, indirizzo, cap, citta, provincia_id,
        partita_iva, codice_fiscale, email, telefono,
        pec, codice_sdi, tipo_attestazione, soc_attestatrice,
        referente, tel_referente, username_responsabile
      } = request.body;

      if (!ragione_sociale || !partita_iva) {
        return reply.status(400).send({ error: 'RagioneSociale and PartitaIva required' });
      }

      const res = await query(`
        INSERT INTO aziende (
          "RagioneSociale", "Nome", "Indirizzo", "Cap", "Città", "id_provincia",
          "PartitaIva", "CodiceFiscale", "Email", "Tel",
          "IndirizzoPEC", "CodiceSDI", "TipologiaAttestazione", "SocAttestatriceSoa",
          "Referente", "TelefonoReferente", "UsernameResponsabile",
          "DataCreazione", "DataModifica", "eliminata", "Cessata"
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10,
          $11, $12, $13, $14,
          $15, $16, $17,
          NOW(), NOW(), false, false
        )
        RETURNING "id"
      `, [
        ragione_sociale, nome, indirizzo, cap, citta, provincia_id,
        partita_iva, codice_fiscale, email, telefono,
        pec, codice_sdi, tipo_attestazione, soc_attestatrice,
        referente, tel_referente, username_responsabile
      ]);

      const newId = res.rows[0].id;

      // Log in audit trail
      await query(`
        INSERT INTO modifiche_azienda (id_azienda, tipo_modifica, descrizione, username)
        VALUES ($1, $2, $3, $4)
      `, [newId, 'CREATE', 'Azienda creata', request.session.user.username]);

      return reply.status(201).send({ id: newId, message: 'Azienda creata' });
    } catch (err) {
      fastify.log.error(err, 'Create azienda error');
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * PUT /api/admin/aziende/:id
   * Update company
   */
  fastify.put('/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const updates = request.body;

      // Build dynamic update query
      const allowedFields = [
        'RagioneSociale', 'Nome', 'Indirizzo', 'Cap', 'Città', 'id_provincia',
        'PartitaIva', 'CodiceFiscale', 'Email', 'Tel',
        'IndirizzoPEC', 'CodiceSDI', 'TipologiaAttestazione', 'SocAttestatriceSoa',
        'Referente', 'TelefonoReferente', 'UsernameResponsabile',
        'AbbonatoSopralluoghi', 'AbbonatoAperture', 'Cessata'
      ];

      const setClauses = [];
      const params = [];
      let paramIdx = 1;

      for (const field of allowedFields) {
        const snakeCase = field.replace(/([A-Z])/g, '_$1').toLowerCase();
        if (snakeCase in updates || field in updates) {
          setClauses.push(`"${field}" = $${paramIdx}`);
          params.push(updates[snakeCase] || updates[field]);
          paramIdx++;
        }
      }

      if (setClauses.length === 0) {
        return reply.status(400).send({ error: 'No fields to update' });
      }

      setClauses.push(`"DataModifica" = NOW()`);
      params.push(id);

      await query(`
        UPDATE aziende SET ${setClauses.join(', ')}
        WHERE "id" = $${paramIdx}
      `, params);

      // Log in audit trail
      await query(`
        INSERT INTO modifiche_azienda (id_azienda, tipo_modifica, descrizione, username)
        VALUES ($1, $2, $3, $4)
      `, [id, 'UPDATE', `Aggiornamento campi: ${Object.keys(updates).join(', ')}`, request.session.user.username]);

      return reply.send({ message: 'Azienda aggiornata' });
    } catch (err) {
      fastify.log.error(err, 'Update azienda error');
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * DELETE /api/admin/aziende/:id
   * Soft delete (set eliminata=true)
   */
  fastify.delete('/:id', async (request, reply) => {
    try {
      const { id } = request.params;

      await query(`
        UPDATE aziende SET "eliminata" = true, "DataModifica" = NOW()
        WHERE "id" = $1
      `, [id]);

      await query(`
        INSERT INTO modifiche_azienda (id_azienda, tipo_modifica, descrizione, username)
        VALUES ($1, $2, $3, $4)
      `, [id, 'SOFT_DELETE', 'Azienda spostata in cestino', request.session.user.username]);

      return reply.send({ message: 'Azienda spostata nel cestino' });
    } catch (err) {
      fastify.log.error(err, 'Delete azienda error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ============================================================
  // TRASH / RESTORE
  // ============================================================

  /**
   * GET /api/admin/aziende/cestino
   * List deleted companies
   */
  fastify.get('/cestino', async (request, reply) => {
    try {
      const { page = 1, limit = 50, search } = request.query;
      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
      const conditions = ['a."eliminata" = true'];
      const params = [];
      let paramIdx = 1;

      if (search) {
        conditions.push(`a."RagioneSociale" ILIKE $${paramIdx}`);
        params.push(`%${search}%`);
        paramIdx++;
      }

      const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

      const countRes = await query(
        `SELECT COUNT(*) as total FROM aziende a ${whereClause}`,
        params
      );

      const total = parseInt(countRes.rows[0].total);

      params.push(limit, offset);
      const dataRes = await query(`
        SELECT a."id", a."RagioneSociale" AS ragione_sociale, a."PartitaIva" AS partita_iva,
               a."DataModifica" AS deleted_at
        FROM aziende a
        ${whereClause}
        ORDER BY a."DataModifica" DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}
      `, params);

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

  /**
   * POST /api/admin/aziende/:id/ripristina
   * Restore from trash
   */
  fastify.post('/:id/ripristina', async (request, reply) => {
    try {
      const { id } = request.params;

      await query(`
        UPDATE aziende SET "eliminata" = false, "DataModifica" = NOW()
        WHERE "id" = $1
      `, [id]);

      await query(`
        INSERT INTO modifiche_azienda (id_azienda, tipo_modifica, descrizione, username)
        VALUES ($1, $2, $3, $4)
      `, [id, 'RESTORE', 'Azienda ripristinata dal cestino', request.session.user.username]);

      return reply.send({ message: 'Azienda ripristinata' });
    } catch (err) {
      fastify.log.error(err, 'Restore azienda error');
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * DELETE /api/admin/aziende/:id/definitivo
   * Permanent delete
   */
  fastify.delete('/:id/definitivo', async (request, reply) => {
    try {
      const { id } = request.params;

      // Delete related records first
      await Promise.all([
        query('DELETE FROM noteaziende WHERE "IDAzienda" = $1', [id]),
        query('DELETE FROM eventiaziende WHERE "IDAzienda" = $1', [id]),
        query('DELETE FROM aziendapersonale WHERE "IdAzienda" = $1', [id]),
        query('DELETE FROM attestazioniaziende WHERE "IdAzienda" = $1', [id])
      ]);

      // Delete company
      await query('DELETE FROM aziende WHERE "id" = $1', [id]);

      // No need to log since record is deleted
      return reply.send({ message: 'Azienda eliminata permanentemente' });
    } catch (err) {
      fastify.log.error(err, 'Permanent delete azienda error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ============================================================
  // ATTESTAZIONI (SOA Certifications)
  // ============================================================

  /**
   * GET /api/admin/aziende/:id/attestazioni
   * List company certifications
   */
  fastify.get('/:id/attestazioni', async (request, reply) => {
    try {
      const { id } = request.params;

      const res = await query(`
        SELECT aa."id", aa."IdSoa", aa."id_attestazione", aa."Anno",
               s."cod" AS codice_soa, s."Descrizione" AS descrizione_soa,
               att."Attestazione" AS classifica, att."Importo" AS importo_classifica,
               aa."DataInserimento" AS data_inserimento, aa."scadenza",
               aa."note"
        FROM attestazioniaziende aa
        LEFT JOIN soa s ON aa."IdSoa" = s."id"
        LEFT JOIN attestazioni att ON aa."id_attestazione" = att."id_Attestazione"
        WHERE aa."IdAzienda" = $1
        ORDER BY aa."Anno" DESC
      `, [id]);

      return { attestazioni: res.rows };
    } catch (err) {
      fastify.log.error(err, 'Get attestazioni error');
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * POST /api/admin/aziende/:id/attestazioni
   * Add certification
   */
  fastify.post('/:id/attestazioni', async (request, reply) => {
    try {
      const { id } = request.params;
      const { id_soa, id_attestazione, anno, scadenza, note } = request.body;

      if (!anno) {
        return reply.status(400).send({ error: 'Anno required' });
      }

      const res = await query(`
        INSERT INTO attestazioniaziende (
          "IdAzienda", "IdSoa", "id_attestazione", "Anno", "scadenza", "note",
          "DataInserimento"
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
        RETURNING "id"
      `, [id, id_soa, id_attestazione, anno, scadenza, note]);

      await query(`
        INSERT INTO modifiche_azienda (id_azienda, tipo_modifica, descrizione, username)
        VALUES ($1, $2, $3, $4)
      `, [id, 'ADD_ATTESTAZIONE', `Aggiunta attestazione ${anno}`, request.session.user.username]);

      return reply.status(201).send({ id: res.rows[0].id, message: 'Attestazione aggiunta' });
    } catch (err) {
      fastify.log.error(err, 'Add attestazione error');
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * PUT /api/admin/aziende/attestazioni/:id
   * Update certification
   */
  fastify.put('/attestazioni/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const { id_soa, id_attestazione, anno, scadenza, note } = request.body;

      // Get azienda_id for audit log
      const aziendaRes = await query('SELECT "IdAzienda" FROM attestazioniaziende WHERE "id" = $1', [id]);
      if (aziendaRes.rows.length === 0) {
        return reply.status(404).send({ error: 'Attestazione not found' });
      }

      const aziendaId = aziendaRes.rows[0].IdAzienda;

      await query(`
        UPDATE attestazioniaziende
        SET "IdSoa" = COALESCE($2, "IdSoa"),
            "id_attestazione" = COALESCE($3, "id_attestazione"),
            "Anno" = COALESCE($4, "Anno"),
            "scadenza" = COALESCE($5, "scadenza"),
            "note" = COALESCE($6, "note")
        WHERE "id" = $1
      `, [id, id_soa, id_attestazione, anno, scadenza, note]);

      await query(`
        INSERT INTO modifiche_azienda (id_azienda, tipo_modifica, descrizione, username)
        VALUES ($1, $2, $3, $4)
      `, [aziendaId, 'UPDATE_ATTESTAZIONE', 'Attestazione aggiornata', request.session.user.username]);

      return reply.send({ message: 'Attestazione aggiornata' });
    } catch (err) {
      fastify.log.error(err, 'Update attestazione error');
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * DELETE /api/admin/aziende/attestazioni/:id
   * Delete certification
   */
  fastify.delete('/attestazioni/:id', async (request, reply) => {
    try {
      const { id } = request.params;

      const aziendaRes = await query('SELECT "IdAzienda" FROM attestazioniaziende WHERE "id" = $1', [id]);
      if (aziendaRes.rows.length === 0) {
        return reply.status(404).send({ error: 'Attestazione not found' });
      }

      const aziendaId = aziendaRes.rows[0].IdAzienda;

      await query('DELETE FROM attestazioniaziende WHERE "id" = $1', [id]);

      await query(`
        INSERT INTO modifiche_azienda (id_azienda, tipo_modifica, descrizione, username)
        VALUES ($1, $2, $3, $4)
      `, [aziendaId, 'DELETE_ATTESTAZIONE', 'Attestazione eliminata', request.session.user.username]);

      return reply.send({ message: 'Attestazione eliminata' });
    } catch (err) {
      fastify.log.error(err, 'Delete attestazione error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ============================================================
  // PERSONNEL
  // ============================================================

  /**
   * GET /api/admin/aziende/:id/personale
   * List company personnel
   */
  fastify.get('/:id/personale', async (request, reply) => {
    try {
      const { id } = request.params;

      const res = await query(`
        SELECT "id", "Nome" AS nome, "Ruolo" AS ruolo, "CodiceFiscale" AS codice_fiscale,
               "DataInserimento" AS data_inserimento
        FROM aziendapersonale
        WHERE "IdAzienda" = $1
        ORDER BY "DataInserimento" DESC
      `, [id]);

      return { personale: res.rows };
    } catch (err) {
      fastify.log.error(err, 'Get personale error');
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * POST /api/admin/aziende/:id/personale
   * Add person to company
   */
  fastify.post('/:id/personale', async (request, reply) => {
    try {
      const { id } = request.params;
      const { nome, ruolo, codice_fiscale } = request.body;

      if (!nome) {
        return reply.status(400).send({ error: 'Nome required' });
      }

      const res = await query(`
        INSERT INTO aziendapersonale (
          "IdAzienda", "Nome", "Ruolo", "CodiceFiscale", "DataInserimento"
        ) VALUES ($1, $2, $3, $4, NOW())
        RETURNING "id"
      `, [id, nome, ruolo, codice_fiscale]);

      await query(`
        INSERT INTO modifiche_azienda (id_azienda, tipo_modifica, descrizione, username)
        VALUES ($1, $2, $3, $4)
      `, [id, 'ADD_PERSONALE', `Aggiunto personale: ${nome}`, request.session.user.username]);

      return reply.status(201).send({ id: res.rows[0].id, message: 'Personale aggiunto' });
    } catch (err) {
      fastify.log.error(err, 'Add personale error');
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * PUT /api/admin/aziende/personale/:id
   * Update person
   */
  fastify.put('/personale/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const { nome, ruolo, codice_fiscale } = request.body;

      const aziendaRes = await query('SELECT "IdAzienda" FROM aziendapersonale WHERE "id" = $1', [id]);
      if (aziendaRes.rows.length === 0) {
        return reply.status(404).send({ error: 'Personale not found' });
      }

      const aziendaId = aziendaRes.rows[0].IdAzienda;

      await query(`
        UPDATE aziendapersonale
        SET "Nome" = COALESCE($2, "Nome"),
            "Ruolo" = COALESCE($3, "Ruolo"),
            "CodiceFiscale" = COALESCE($4, "CodiceFiscale")
        WHERE "id" = $1
      `, [id, nome, ruolo, codice_fiscale]);

      await query(`
        INSERT INTO modifiche_azienda (id_azienda, tipo_modifica, descrizione, username)
        VALUES ($1, $2, $3, $4)
      `, [aziendaId, 'UPDATE_PERSONALE', 'Personale aggiornato', request.session.user.username]);

      return reply.send({ message: 'Personale aggiornato' });
    } catch (err) {
      fastify.log.error(err, 'Update personale error');
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * DELETE /api/admin/aziende/personale/:id
   * Delete person
   */
  fastify.delete('/personale/:id', async (request, reply) => {
    try {
      const { id } = request.params;

      const aziendaRes = await query('SELECT "IdAzienda" FROM aziendapersonale WHERE "id" = $1', [id]);
      if (aziendaRes.rows.length === 0) {
        return reply.status(404).send({ error: 'Personale not found' });
      }

      const aziendaId = aziendaRes.rows[0].IdAzienda;

      await query('DELETE FROM aziendapersonale WHERE "id" = $1', [id]);

      await query(`
        INSERT INTO modifiche_azienda (id_azienda, tipo_modifica, descrizione, username)
        VALUES ($1, $2, $3, $4)
      `, [aziendaId, 'DELETE_PERSONALE', 'Personale eliminato', request.session.user.username]);

      return reply.send({ message: 'Personale eliminato' });
    } catch (err) {
      fastify.log.error(err, 'Delete personale error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ============================================================
  // NOTES & EVENTS
  // ============================================================

  /**
   * GET /api/admin/aziende/:id/note
   * List company notes
   */
  fastify.get('/:id/note', async (request, reply) => {
    try {
      const { id } = request.params;

      const res = await query(`
        SELECT "id", "Data" AS data, "UserName" AS username, "Nota" AS nota, "DataAlert" AS data_alert
        FROM noteaziende
        WHERE "IDAzienda" = $1
        ORDER BY "Data" DESC
        LIMIT 100
      `, [id]);

      return { note: res.rows };
    } catch (err) {
      fastify.log.error(err, 'Get note error');
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * POST /api/admin/aziende/:id/note
   * Add note
   */
  fastify.post('/:id/note', async (request, reply) => {
    try {
      const { id } = request.params;
      const { nota, data_alert } = request.body;

      if (!nota) {
        return reply.status(400).send({ error: 'Nota required' });
      }

      const res = await query(`
        INSERT INTO noteaziende (
          "IDAzienda", "Data", "UserName", "Nota", "DataAlert"
        ) VALUES ($1, NOW(), $2, $3, $4)
        RETURNING "id"
      `, [id, request.session.user.username, nota, data_alert]);

      return reply.status(201).send({ id: res.rows[0].id, message: 'Nota aggiunta' });
    } catch (err) {
      fastify.log.error(err, 'Add note error');
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * DELETE /api/admin/aziende/note/:id
   * Delete note
   */
  fastify.delete('/note/:id', async (request, reply) => {
    try {
      const { id } = request.params;

      await query('DELETE FROM noteaziende WHERE "id" = $1', [id]);

      return reply.send({ message: 'Nota eliminata' });
    } catch (err) {
      fastify.log.error(err, 'Delete note error');
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * GET /api/admin/aziende/:id/eventi
   * List company events
   */
  fastify.get('/:id/eventi', async (request, reply) => {
    try {
      const { id } = request.params;

      const res = await query(`
        SELECT "id", "Data" AS data, "Tipo" AS tipo, "Descrizione" AS descrizione,
               "UserName" AS username
        FROM eventiaziende
        WHERE "IDAzienda" = $1
        ORDER BY "Data" DESC
        LIMIT 100
      `, [id]);

      return { eventi: res.rows };
    } catch (err) {
      fastify.log.error(err, 'Get eventi error');
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * POST /api/admin/aziende/:id/eventi
   * Add event
   */
  fastify.post('/:id/eventi', async (request, reply) => {
    try {
      const { id } = request.params;
      const { tipo, descrizione } = request.body;

      if (!tipo) {
        return reply.status(400).send({ error: 'Tipo required' });
      }

      const res = await query(`
        INSERT INTO eventiaziende (
          "IDAzienda", "Data", "Tipo", "Descrizione", "UserName"
        ) VALUES ($1, NOW(), $2, $3, $4)
        RETURNING "id"
      `, [id, tipo, descrizione, request.session.user.username]);

      return reply.status(201).send({ id: res.rows[0].id, message: 'Evento aggiunto' });
    } catch (err) {
      fastify.log.error(err, 'Add evento error');
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * DELETE /api/admin/aziende/eventi/:id
   * Delete event
   */
  fastify.delete('/eventi/:id', async (request, reply) => {
    try {
      const { id } = request.params;

      await query('DELETE FROM eventiaziende WHERE "id" = $1', [id]);

      return reply.send({ message: 'Evento eliminato' });
    } catch (err) {
      fastify.log.error(err, 'Delete evento error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ============================================================
  // ATI (Associations)
  // ============================================================

  /**
   * GET /api/admin/aziende/:id/ati
   * List ATI associations for company
   */
  fastify.get('/:id/ati', async (request, reply) => {
    try {
      const { id } = request.params;

      const res = await query(`
        SELECT ag."id", ag."id_gara", ag."id_azienda_mandataria", ag."id_azienda_mandante",
               ag."tipo_partecipazione", g."Titolo" AS titolo_gara, g."Data" AS data_gara,
               am."RagioneSociale" AS ragione_sociale_mandataria,
               an."RagioneSociale" AS ragione_sociale_mandante
        FROM ati_gare ag
        JOIN gare g ON ag."id_gara" = g."id"
        LEFT JOIN aziende am ON ag."id_azienda_mandataria" = am."id"
        LEFT JOIN aziende an ON ag."id_azienda_mandante" = an."id"
        WHERE ag."id_azienda_mandataria" = $1 OR ag."id_azienda_mandante" = $1
        ORDER BY g."Data" DESC
      `, [id]);

      return { ati: res.rows };
    } catch (err) {
      fastify.log.error(err, 'Get ati error');
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * GET /api/admin/aziende/:id/esiti-ati
   * List esiti where company participates as ATI
   */
  fastify.get('/:id/esiti-ati', async (request, reply) => {
    try {
      const { id } = request.params;

      const res = await query(`
        SELECT DISTINCT g."id", g."Data" AS data, g."Titolo" AS titolo, g."Importo" AS importo,
               dg."Ribasso" AS ribasso, dg."Posizione" AS posizione, dg."Vincitrice" AS vincitrice,
               a."RagioneSociale" AS ragione_sociale_lead,
               string_agg(DISTINCT a2."RagioneSociale", ', ') AS mandanti
        FROM gare g
        JOIN dettagliogara dg ON dg."id_gara" = g."id"
        JOIN aziende a ON dg."id_azienda" = a."id"
        LEFT JOIN ati_gare ag ON g."id" = ag."id_gara" AND (ag."id_azienda_mandataria" = dg."id_azienda" OR ag."id_azienda_mandante" = dg."id_azienda")
        LEFT JOIN aziende a2 ON (ag."id_azienda_mandante" = a2."id" AND ag."id_azienda_mandataria" = dg."id_azienda")
                             OR (ag."id_azienda_mandataria" = a2."id" AND ag."id_azienda_mandante" = dg."id_azienda")
        WHERE dg."id_azienda" = $1 OR ag."id_azienda_mandante" = $1 OR ag."id_azienda_mandataria" = $1
        GROUP BY g."id", dg."Ribasso", dg."Posizione", dg."Vincitrice", a."RagioneSociale"
        ORDER BY g."Data" DESC
        LIMIT 100
      `, [id]);

      return { esiti_ati: res.rows };
    } catch (err) {
      fastify.log.error(err, 'Get esiti-ati error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ============================================================
  // SEARCH / AUTOCOMPLETE
  // ============================================================

  /**
   * GET /api/admin/aziende/search?term=
   * Autocomplete company names
   */
  fastify.get('/search', async (request, reply) => {
    try {
      const { term = '' } = request.query;

      const res = await query(`
        SELECT "id", "RagioneSociale" AS ragione_sociale, "PartitaIva" AS partita_iva
        FROM aziende
        WHERE "eliminata" = false AND "RagioneSociale" ILIKE $1
        LIMIT 20
      `, [`%${term}%`]);

      return { risultati: res.rows };
    } catch (err) {
      fastify.log.error(err, 'Search error');
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * GET /api/admin/aziende/search-piva?term=
   * Autocomplete by P.IVA
   */
  fastify.get('/search-piva', async (request, reply) => {
    try {
      const { term = '' } = request.query;

      const res = await query(`
        SELECT "id", "RagioneSociale" AS ragione_sociale, "PartitaIva" AS partita_iva
        FROM aziende
        WHERE "eliminata" = false AND "PartitaIva" ILIKE $1
        LIMIT 20
      `, [`%${term}%`]);

      return { risultati: res.rows };
    } catch (err) {
      fastify.log.error(err, 'Search PIVA error');
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * GET /api/admin/aziende/cerca-per-esito?term=
   * Search companies by esito participation
   */
  fastify.get('/cerca-per-esito', async (request, reply) => {
    try {
      const { term = '' } = request.query;

      const res = await query(`
        SELECT DISTINCT a."id", a."RagioneSociale" AS ragione_sociale,
               COUNT(dg."id") AS n_partecipazioni
        FROM aziende a
        JOIN dettagliogara dg ON a."id" = dg."id_azienda"
        WHERE a."eliminata" = false AND a."RagioneSociale" ILIKE $1
        GROUP BY a."id", a."RagioneSociale"
        ORDER BY n_partecipazioni DESC
        LIMIT 20
      `, [`%${term}%`]);

      return { risultati: res.rows };
    } catch (err) {
      fastify.log.error(err, 'Search per esito error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ============================================================
  // STATISTICS
  // ============================================================

  /**
   * GET /api/admin/aziende/:id/statistiche
   * Company statistics
   */
  fastify.get('/:id/statistiche', async (request, reply) => {
    try {
      const { id } = request.params;

      // Total esiti participated
      const totalRes = await query(`
        SELECT COUNT(*) as total, COUNT(CASE WHEN "Vincitrice" = true THEN 1 END) as vinti
        FROM dettagliogara
        WHERE "id_azienda" = $1
      `, [id]);

      // Average discount
      const avgRes = await query(`
        SELECT AVG("Ribasso") as media_ribasso,
               MIN("Ribasso") as min_ribasso,
               MAX("Ribasso") as max_ribasso,
               STDDEV("Ribasso") as stddev_ribasso
        FROM dettagliogara
        WHERE "id_azienda" = $1 AND "Ribasso" IS NOT NULL
      `, [id]);

      // Winner percentage
      const stats = {
        totale_partecipazioni: parseInt(totalRes.rows[0].total) || 0,
        esiti_vinti: parseInt(totalRes.rows[0].vinti) || 0,
        percentuale_vittoria: totalRes.rows[0].total > 0
          ? Math.round((parseInt(totalRes.rows[0].vinti) / parseInt(totalRes.rows[0].total)) * 100)
          : 0,
        media_ribasso: avgRes.rows[0]?.media_ribasso ? parseFloat(avgRes.rows[0].media_ribasso).toFixed(2) : null,
        min_ribasso: avgRes.rows[0]?.min_ribasso ? parseFloat(avgRes.rows[0].min_ribasso).toFixed(2) : null,
        max_ribasso: avgRes.rows[0]?.max_ribasso ? parseFloat(avgRes.rows[0].max_ribasso).toFixed(2) : null,
        stddev_ribasso: avgRes.rows[0]?.stddev_ribasso ? parseFloat(avgRes.rows[0].stddev_ribasso).toFixed(2) : null
      };

      return stats;
    } catch (err) {
      fastify.log.error(err, 'Statistiche error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ============================================================
  // ANALYTICS - DISCOUNTS & RESULTS
  // ============================================================

  /**
   * GET /api/admin/aziende/:id/ribassi
   * Last 40 discounts with linear regression
   */
  fastify.get('/:id/ribassi', async (request, reply) => {
    try {
      const { id } = request.params;

      const res = await query(`
        SELECT dg."id", g."Data" AS data, g."Titolo" AS titolo,
               dg."Ribasso" AS ribasso, dg."Posizione" AS posizione,
               dg."Vincitrice" AS vincitrice
        FROM dettagliogara dg
        JOIN gare g ON dg."id_gara" = g."id"
        WHERE dg."id_azienda" = $1 AND dg."Ribasso" IS NOT NULL
        ORDER BY g."Data" DESC
        LIMIT 40
      `, [id]);

      const ribassi = res.rows.map(r => ({
        ...r,
        ribasso: parseFloat(r.ribasso)
      })).reverse(); // Oldest first for trend

      // Calculate linear regression (least squares)
      const n = ribassi.length;
      if (n < 2) {
        return { ribassi, trend: null, media_mobile: null };
      }

      let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
      ribassi.forEach((r, i) => {
        sumX += i;
        sumY += r.ribasso;
        sumXY += i * r.ribasso;
        sumX2 += i * i;
      });

      const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
      const intercept = (sumY - slope * sumX) / n;

      // Simple moving average (period 5)
      const mediaMobile = [];
      for (let i = 0; i < ribassi.length; i++) {
        const start = Math.max(0, i - 4);
        const window = ribassi.slice(start, i + 1);
        const avg = window.reduce((sum, r) => sum + r.ribasso, 0) / window.length;
        mediaMobile.push(avg);
      }

      return {
        ribassi,
        trend: {
          slope: parseFloat(slope.toFixed(4)),
          intercept: parseFloat(intercept.toFixed(2))
        },
        media_mobile_5: mediaMobile.map(m => parseFloat(m.toFixed(2)))
      };
    } catch (err) {
      fastify.log.error(err, 'Ribassi error');
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * GET /api/admin/aziende/:id/ribassi-winner
   * Winning discounts only
   */
  fastify.get('/:id/ribassi-winner', async (request, reply) => {
    try {
      const { id } = request.params;

      const res = await query(`
        SELECT dg."id", g."Data" AS data, g."Titolo" AS titolo,
               dg."Ribasso" AS ribasso,
               g."Importo" AS importo, g."MediaAr" AS media_ar
        FROM dettagliogara dg
        JOIN gare g ON dg."id_gara" = g."id"
        WHERE dg."id_azienda" = $1 AND dg."Vincitrice" = true AND dg."Ribasso" IS NOT NULL
        ORDER BY g."Data" DESC
        LIMIT 40
      `, [id]);

      const ribassi_winner = res.rows.map(r => ({
        ...r,
        ribasso: parseFloat(r.ribasso),
        importo: parseFloat(r.importo || 0),
        media_ar: parseFloat(r.media_ar || 0)
      }));

      const avgWinningDiscount = ribassi_winner.length > 0
        ? ribassi_winner.reduce((sum, r) => sum + r.ribasso, 0) / ribassi_winner.length
        : 0;

      return {
        ribassi_winner,
        media_ribassi_vittoriosi: parseFloat(avgWinningDiscount.toFixed(2)),
        totale_vittorie: ribassi_winner.length
      };
    } catch (err) {
      fastify.log.error(err, 'Ribassi winner error');
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * GET /api/admin/aziende/:id/risultati
   * Results breakdown (winners/anomalies/excluded/below-avg)
   */
  fastify.get('/:id/risultati', async (request, reply) => {
    try {
      const { id } = request.params;

      const res = await query(`
        SELECT
          dg."Vincitrice" as vincitrice,
          dg."Anomalia" as anomalia,
          dg."Esclusa" as esclusa,
          COUNT(*) as count
        FROM dettagliogara dg
        WHERE dg."id_azienda" = $1
        GROUP BY dg."Vincitrice", dg."Anomalia", dg."Esclusa"
      `, [id]);

      const results = {
        vittorie: 0,
        anomalie: 0,
        escluse: 0,
        normali: 0,
        sotto_media: 0
      };

      res.rows.forEach(row => {
        if (row.vincitrice === true) {
          results.vittorie = parseInt(row.count);
        } else if (row.anomalia === true) {
          results.anomalie = parseInt(row.count);
        } else if (row.esclusa === true) {
          results.escluse = parseInt(row.count);
        } else {
          results.normali = parseInt(row.count);
        }
      });

      const total = results.vittorie + results.anomalie + results.escluse + results.normali;

      return {
        ...results,
        totale: total,
        percentuali: {
          vittorie: total > 0 ? parseFloat((results.vittorie / total * 100).toFixed(1)) : 0,
          anomalie: total > 0 ? parseFloat((results.anomalie / total * 100).toFixed(1)) : 0,
          escluse: total > 0 ? parseFloat((results.escluse / total * 100).toFixed(1)) : 0,
          normali: total > 0 ? parseFloat((results.normali / total * 100).toFixed(1)) : 0
        }
      };
    } catch (err) {
      fastify.log.error(err, 'Risultati error');
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * GET /api/admin/aziende/:id/ati-breakdown
   * Participation type breakdown (single/mandataria/mandante/avvalimento)
   */
  fastify.get('/:id/ati-breakdown', async (request, reply) => {
    try {
      const { id } = request.params;

      const res = await query(`
        SELECT
          COUNT(*) FILTER (WHERE ag."id" IS NULL) as singolo,
          COUNT(*) FILTER (WHERE ag."id_azienda_mandataria" = $1) as mandataria,
          COUNT(*) FILTER (WHERE ag."id_azienda_mandante" = $1) as mandante,
          COUNT(*) FILTER (WHERE dg."id_azienda" = $1 AND EXISTS (
            SELECT 1 FROM ati_gare ag2 WHERE ag2."id_gara" = dg."id_gara"
          )) as con_ati
        FROM dettagliogara dg
        LEFT JOIN ati_gare ag ON dg."id_gara" = ag."id_gara" AND (
          ag."id_azienda_mandataria" = dg."id_azienda" OR ag."id_azienda_mandante" = dg."id_azienda"
        )
        WHERE dg."id_azienda" = $1
      `, [id, id, id, id, id]);

      const breakdown = res.rows[0] || {};
      const total = (parseInt(breakdown.singolo) || 0) + (parseInt(breakdown.con_ati) || 0);

      return {
        singolo: parseInt(breakdown.singolo) || 0,
        mandataria: parseInt(breakdown.mandataria) || 0,
        mandante: parseInt(breakdown.mandante) || 0,
        con_ati: parseInt(breakdown.con_ati) || 0,
        totale: total,
        percentuali: {
          singolo: total > 0 ? parseFloat(((parseInt(breakdown.singolo) || 0) / total * 100).toFixed(1)) : 0,
          con_ati: total > 0 ? parseFloat(((parseInt(breakdown.con_ati) || 0) / total * 100).toFixed(1)) : 0
        }
      };
    } catch (err) {
      fastify.log.error(err, 'ATI breakdown error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ============================================================
  // AUDIT TRAIL
  // ============================================================

  /**
   * GET /api/admin/aziende/:id/storia
   * Modification history
   */
  fastify.get('/:id/storia', async (request, reply) => {
    try {
      const { id } = request.params;

      const res = await query(`
        SELECT "id", "id_azienda", "tipo_modifica", "descrizione", "username", "data_modifica"
        FROM modifiche_azienda
        WHERE "id_azienda" = $1
        ORDER BY "data_modifica" DESC
        LIMIT 100
      `, [id]);

      return { storia: res.rows };
    } catch (err) {
      fastify.log.error(err, 'Storia error');
      return reply.status(500).send({ error: err.message });
    }
  });
}
