import { query } from '../db/pool.js';

export default async function adminAziendeRoutes(fastify, opts) {
  // Middleware: require authentication (JWT)
  fastify.addHook('preHandler', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      return reply.status(401).send({ error: 'Non autorizzato' });
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
        page = 1, limit = 50, sort = 'ragione_sociale', order = 'ASC',
        search, provincia, soa, tipo_attestazione, active = null, deleted = false,
        citta, cap, indirizzo, agente, responsabile, stato_contatto, inserita_da,
        senza_attestazioni, fornitrice, invio_test, mail_test,
        soa_classifica, soa_legame,
        con_utente, senza_utente, temporanei, cessata,
        agg_da, agg_a, att_orig_da, att_orig_a, att_corso_da, att_corso_a,
        val_tri_da, val_tri_a, ver_tri_da, ver_tri_a,
        val_quin_da, val_quin_a, scad_iso_da, scad_iso_a,
        approvazione, logica
      } = request.query;

      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
      const conditions = [];
      const params = [];
      let paramIdx = 1;

      // Base condition: exclude or include deleted based on deleted param
      if (deleted === 'true' || deleted === true) {
        conditions.push('a.attivo = false');
      } else {
        conditions.push('a.attivo = true');
      }

      // Search by name, P.IVA, CF, email
      if (search) {
        conditions.push(
          `(a.ragione_sociale ILIKE $${paramIdx} OR a.partita_iva ILIKE $${paramIdx} OR a.codice_fiscale ILIKE $${paramIdx} OR a.email ILIKE $${paramIdx})`
        );
        params.push(`%${search}%`);
        paramIdx++;
      }

      // Filter by province
      if (provincia) {
        conditions.push(`p.nome ILIKE $${paramIdx}`);
        params.push(`%${provincia}%`);
        paramIdx++;
      }

      // Filter by city
      if (citta) {
        conditions.push(`a.citta ILIKE $${paramIdx}`);
        params.push(`%${citta}%`);
        paramIdx++;
      }

      // Filter by CAP
      if (cap) {
        conditions.push(`a.cap ILIKE $${paramIdx}`);
        params.push(`%${cap}%`);
        paramIdx++;
      }

      // Filter by indirizzo
      if (indirizzo) {
        conditions.push(`a.indirizzo ILIKE $${paramIdx}`);
        params.push(`%${indirizzo}%`);
        paramIdx++;
      }

      // Filter by SOA type
      if (soa) {
        conditions.push(`EXISTS (SELECT 1 FROM attestazioni att2 JOIN soa s2 ON att2.id_soa = s2.id WHERE att2.id_azienda = a.id AND s2.codice ILIKE $${paramIdx})`);
        params.push(`%${soa}%`);
        paramIdx++;
      }

      // Filter by SOA classifica
      if (soa_classifica) {
        conditions.push(`EXISTS (SELECT 1 FROM attestazioni att3 WHERE att3.id_azienda = a.id AND att3.classifica = $${paramIdx})`);
        params.push(soa_classifica);
        paramIdx++;
      }

      // Filter by cessata (eliminata in DB)
      if (cessata === 'true') {
        conditions.push('a.eliminata = true');
      }

      // Filter by regione
      if (request.query.regione) {
        conditions.push(`r.nome ILIKE $${paramIdx}`);
        params.push(`%${request.query.regione}%`);
        paramIdx++;
      }

      // Filter by inserita_da
      if (inserita_da) {
        conditions.push(`a.inserito_da ILIKE $${paramIdx}`);
        params.push(`%${inserita_da}%`);
        paramIdx++;
      }

      // Filter by active status
      if (active === 'true') {
        conditions.push('a.attivo = true');
      } else if (active === 'false') {
        conditions.push('a.attivo = false');
      }

      // Filter by con/senza utente (users linked via id_azienda)
      if (con_utente === 'true') {
        conditions.push("EXISTS (SELECT 1 FROM users u WHERE u.id_azienda = a.id)");
      }
      if (senza_utente === 'true') {
        conditions.push("NOT EXISTS (SELECT 1 FROM users u WHERE u.id_azienda = a.id)");
      }

      // Senza attestazioni checkbox
      if (senza_attestazioni === 'true') {
        conditions.push('NOT EXISTS (SELECT 1 FROM attestazioni att4 WHERE att4.id_azienda = a.id)');
      }

      // Date range filters (created_at / updated_at)
      if (agg_da) { conditions.push(`a.updated_at >= $${paramIdx}`); params.push(agg_da); paramIdx++; }
      if (agg_a) { conditions.push(`a.updated_at <= $${paramIdx}`); params.push(agg_a); paramIdx++; }

      // Join conditions with AND or OR based on logica parameter
      const joiner = logica === 'or' ? ' OR ' : ' AND ';
      // First condition (eliminata) is always AND, rest can be OR
      let whereClause = '';
      if (conditions.length > 1) {
        const baseCondition = conditions[0]; // eliminata filter
        const filterConditions = conditions.slice(1);
        whereClause = 'WHERE ' + baseCondition + (filterConditions.length ? ' AND (' + filterConditions.join(joiner) + ')' : '');
      } else if (conditions.length === 1) {
        whereClause = 'WHERE ' + conditions[0];
      }

      // Count total
      const countRes = await query(
        `SELECT COUNT(*) as total FROM aziende a LEFT JOIN province p ON a.id_provincia = p.id ${whereClause}`,
        params
      );

      const total = parseInt(countRes.rows[0].total);

      // Allowed sort columns
      const allowedSort = ['ragione_sociale', 'data_creazione', 'partita_iva', 'citta'];
      const sortMap = {
        'ragione_sociale': 'a.ragione_sociale',
        'data_creazione': 'a.created_at',
        'partita_iva': 'a.partita_iva',
        'citta': 'a.citta'
      };
      const sortCol = sortMap[sort] || 'a.ragione_sociale';
      const sortDir = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

      params.push(limit, offset);
      const dataRes = await query(`
        SELECT a.id, a.ragione_sociale,
               a.indirizzo, a.cap, a.citta,
               a.partita_iva, a.codice_fiscale,
               a.email, a.telefono, a.note,
               a.attivo, a.pec,
               a.legale_rappresentante,
               a.created_at, a.updated_at,
               COALESCE(a.eliminata, false) AS cessata,
               a.inserito_da AS username_responsabile,
               p.nome AS provincia_nome, p.id AS id_provincia, p.sigla AS provincia_sigla,
               r.nome AS regione_nome,
               (SELECT COUNT(*) FROM attestazioni att WHERE att.id_azienda = a.id) AS num_attestazioni,
               (SELECT u2.username FROM users u2 WHERE u2.id_azienda = a.id LIMIT 1) AS username_azienda,
               (SELECT u3.data_scadenza FROM users u3 WHERE u3.id_azienda = a.id AND u3.esiti_enabled = true LIMIT 1) AS scadenza_esiti,
               (SELECT u4.data_scadenza FROM users u4 WHERE u4.id_azienda = a.id AND u4.bandi_enabled = true LIMIT 1) AS scadenza_bandi
        FROM aziende a
        LEFT JOIN province p ON a.id_provincia = p.id
        LEFT JOIN regioni r ON p.id_regione = r.id
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
        SELECT a.*, p.nome AS provincia_nome, p.sigla AS provincia_sigla, r.nome AS regione_nome
        FROM aziende a
        LEFT JOIN province p ON a.id_provincia = p.id
        LEFT JOIN regioni r ON p.id_regione = r.id
        WHERE a.id = $1
      `, [id]);

      if (azRes.rows.length === 0) {
        return reply.status(404).send({ error: 'Azienda non trovata' });
      }

      const azienda = azRes.rows[0];

      // Attestazioni/SOA
      const attestazioniRes = await query(`
        SELECT att.id, att.id_soa, att.id_azienda,
               att.classifica, att.data_rilascio, att.data_scadenza,
               s.codice AS codice_soa, s.descrizione AS descrizione_soa,
               att.organismo, att.attivo, att.created_at
        FROM attestazioni att
        LEFT JOIN soa s ON att.id_soa = s.id
        WHERE att.id_azienda = $1
        ORDER BY att.data_rilascio DESC
      `, [id]);

      // Personnel (soggetti art. 94)
      const personaleRes = await query(`
        SELECT id, id_azienda, nome, cognome, ruolo, email, telefono,
               created_at
        FROM azienda_personale
        WHERE id_azienda = $1
        ORDER BY created_at DESC
      `, [id]);

      // Notes
      const noteRes = await query(`
        SELECT id, id_azienda, testo, username, data_inserimento
        FROM note_aziende
        WHERE id_azienda = $1
        ORDER BY data_inserimento DESC
        LIMIT 50
      `, [id]);

      // Events
      const eventiRes = await query(`
        SELECT id, id_azienda, tipo, descrizione, data, username,
               data_inserimento
        FROM eventi_aziende
        WHERE id_azienda = $1
        ORDER BY data DESC
        LIMIT 50
      `, [id]);

      // Recent esiti/gare
      const gareRes = await query(`
        SELECT g.id, g.data, g.titolo, g.importo,
               dg.ribasso, dg.posizione,
               dg.vincitrice, dg.anomala,
               s.nome AS stazione
        FROM dettaglio_gara dg
        JOIN gare g ON dg.id_gara = g.id
        LEFT JOIN stazioni s ON g.id_stazione = s.id
        WHERE dg.id_azienda = $1
        ORDER BY g.data DESC
        LIMIT 40
      `, [id]);

      // Consorzi (aziende consorziate)
      let consorziRes = { rows: [] };
      try {
        consorziRes = await query(`
          SELECT c.id, c.id_azienda_consorzio, c.id_azienda_membro,
                 c.data_inizio, c.data_fine, c.attivo,
                 am.ragione_sociale AS ragione_sociale_membro,
                 am.partita_iva AS partita_iva_membro,
                 am.indirizzo AS indirizzo_membro,
                 am.cap AS cap_membro,
                 am.citta AS citta_membro,
                 pm.nome AS provincia_membro
          FROM consorzi c
          LEFT JOIN aziende am ON c.id_azienda_membro = am.id
          LEFT JOIN province pm ON am.id_provincia = pm.id
          WHERE c.id_azienda_consorzio = $1
          ORDER BY c.data_inizio DESC
        `, [id]);
      } catch(e) { /* consorzi table may not exist yet */ }

      return {
        azienda,
        attestazioni: attestazioniRes.rows,
        personale: personaleRes.rows,
        note: noteRes.rows,
        eventi: eventiRes.rows,
        gare_recenti: gareRes.rows,
        consorzi: consorziRes.rows
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
      const b = { ...request.body };

      // Normalize field name aliases from the frontend
      if (b.provincia_id && !b.id_provincia) b.id_provincia = b.provincia_id;
      if (b.pec && !b.indirizzo_pec) b.indirizzo_pec = b.pec;
      if (b.telefono && !b.tel) b.tel = b.telefono;
      delete b.provincia_id; delete b.pec; delete b.telefono;

      if (!b.ragione_sociale || !b.partita_iva) {
        return reply.status(400).send({ error: 'ragione_sociale and partita_iva required' });
      }

      // Allowed insert fields (same as update allowedFields + codice_sdi)
      const allowedFields = [
        'ragione_sociale', 'nome', 'indirizzo', 'cap', 'citta', 'id_provincia',
        'partita_iva', 'codice_fiscale', 'email', 'tel',
        'indirizzo_pec', 'codice_sdi', 'sito_web',
        'tipologia_attestazione', 'soc_attestatrice_soa', 'numero_soa',
        'data_rilascio_attestazione_originaria', 'data_rilascio_attestazione_in_corso',
        'validita_triennale', 'data_verifica_triennale', 'validita_quinquennale',
        'ccia', 'data_iscrizione_ccia', 'iso_rilasciato_da', 'iso_scadenza',
        'referente', 'telefono_referente', 'username_responsabile',
        'send_email', 'prezzo_bandi', 'prezzo_esiti', 'prezzo_bundle',
        'scadenza_bandi', 'scadenza_esiti', 'scadenza_bundle',
        'cessata', 'consorzio', 'note', 'nascondi_stato'
      ];

      const cols = [];
      const placeholders = [];
      const params = [];
      let idx = 1;
      for (const f of allowedFields) {
        if (f in b && b[f] !== '' && b[f] !== undefined) {
          cols.push(f);
          placeholders.push(`$${idx++}`);
          let val = b[f];
          if (typeof val === 'boolean') val = val ? 1 : 0;
          params.push(val);
        }
      }
      // Default fields
      cols.push('data_creazione', 'data_modifica', 'eliminata');
      placeholders.push('NOW()', 'NOW()', '0');

      const res = await query(
        `INSERT INTO aziende (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id`,
        params
      );

      const newId = res.rows[0].id;

      // Log in audit trail
      await query(`
        INSERT INTO modifiche_azienda (id_azienda, campo, valore_nuovo, username)
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
        'ragione_sociale', 'nome', 'indirizzo', 'cap', 'citta', 'id_provincia',
        'partita_iva', 'codice_fiscale', 'email', 'tel',
        'indirizzo_pec', 'codice_sdi', 'sito_web',
        'tipologia_attestazione', 'soc_attestatrice_soa', 'numero_soa',
        'data_rilascio_attestazione_originaria', 'data_rilascio_attestazione_in_corso',
        'validita_triennale', 'data_verifica_triennale', 'validita_quinquennale',
        'ccia', 'data_iscrizione_ccia', 'iso_rilasciato_da', 'iso_scadenza',
        'referente', 'telefono_referente', 'username_responsabile',
        'send_email', 'prezzo_bandi', 'prezzo_esiti', 'prezzo_bundle',
        'scadenza_bandi', 'scadenza_esiti', 'scadenza_bundle',
        'abbonato_sopralluoghi', 'abbonato_aperture',
        'cessata', 'consorzio', 'note',
        'stato_non_interessato', 'data_non_interessato', 'username_non_interessato', 'note_non_interessato'
      ];

      const setClauses = [];
      const params = [];
      let paramIdx = 1;

      for (const field of allowedFields) {
        if (field in updates) {
          setClauses.push(`${field} = $${paramIdx}`);
          params.push(updates[field]);
          paramIdx++;
        }
      }

      if (setClauses.length === 0) {
        return reply.status(400).send({ error: 'No fields to update' });
      }

      setClauses.push(`data_modifica = NOW()`);
      params.push(id);

      await query(`
        UPDATE aziende SET ${setClauses.join(', ')}
        WHERE id = $${paramIdx}
      `, params);

      // Log in audit trail
      await query(`
        INSERT INTO modifiche_azienda (id_azienda, campo, valore_nuovo, username)
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
        UPDATE aziende SET eliminata = 1, data_modifica = NOW()
        WHERE id = $1
      `, [id]);

      await query(`
        INSERT INTO modifiche_azienda (id_azienda, campo, valore_nuovo, username)
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
      const conditions = ['a.eliminata = 1'];
      const params = [];
      let paramIdx = 1;

      if (search) {
        conditions.push(`(a.ragione_sociale ILIKE $${paramIdx} OR a.partita_iva ILIKE $${paramIdx} OR a.citta ILIKE $${paramIdx})`);
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
        SELECT a.id, a.ragione_sociale, a.partita_iva, a.cap, a.citta,
               p.nome AS provincia_nome, p.sigla AS provincia_sigla,
               a.username_responsabile, a.data_inserimento,
               a.data_modifica AS deleted_at,
               (SELECT COUNT(*) FROM attestazioni_aziende aa WHERE aa.id_azienda = a.id) AS n_attestazioni
        FROM aziende a
        LEFT JOIN province p ON a.id_provincia = p.id
        ${whereClause}
        ORDER BY a.data_modifica DESC
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
        UPDATE aziende SET eliminata = 0, data_modifica = NOW()
        WHERE id = $1
      `, [id]);

      await query(`
        INSERT INTO modifiche_azienda (id_azienda, campo, valore_nuovo, username)
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
        query('DELETE FROM note_aziende WHERE id_azienda = $1', [id]),
        query('DELETE FROM eventi_aziende WHERE id_azienda = $1', [id]),
        query('DELETE FROM azienda_personale WHERE id_azienda = $1', [id]),
        query('DELETE FROM attestazioni WHERE id_azienda = $1', [id])
      ]);

      // Delete company
      await query('DELETE FROM aziende WHERE id = $1', [id]);

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
        SELECT att.id, att.id_soa, att.id_azienda,
               att.classifica, att.data_rilascio, att.data_scadenza,
               s.codice AS codice_soa, s.descrizione AS descrizione_soa,
               att.organismo, att.attivo, att.created_at
        FROM attestazioni att
        LEFT JOIN soa s ON att.id_soa = s.id
        WHERE att.id_azienda = $1
        ORDER BY att.data_rilascio DESC
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
      const { id_soa, classifica, data_rilascio, data_scadenza, organismo, attivo } = request.body;

      if (!id_soa || !classifica) {
        return reply.status(400).send({ error: 'id_soa and classifica required' });
      }

      const res = await query(`
        INSERT INTO attestazioni (
          id_azienda, id_soa, classifica, data_rilascio, data_scadenza,
          organismo, attivo, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        RETURNING id
      `, [id, id_soa, classifica, data_rilascio, data_scadenza, organismo, attivo !== false]);

      await query(`
        INSERT INTO modifiche_azienda (id_azienda, campo, valore_nuovo, username)
        VALUES ($1, $2, $3, $4)
      `, [id, 'ADD_ATTESTAZIONE', `Aggiunta attestazione per SOA ${id_soa}`, request.session.user.username]);

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
      const { id_soa, classifica, data_rilascio, data_scadenza, organismo, attivo } = request.body;

      // Get azienda_id for audit log
      const aziendaRes = await query('SELECT id_azienda FROM attestazioni WHERE id = $1', [id]);
      if (aziendaRes.rows.length === 0) {
        return reply.status(404).send({ error: 'Attestazione not found' });
      }

      const aziendaId = aziendaRes.rows[0].id_azienda;

      await query(`
        UPDATE attestazioni
        SET id_soa = COALESCE($2, id_soa),
            classifica = COALESCE($3, classifica),
            data_rilascio = COALESCE($4, data_rilascio),
            data_scadenza = COALESCE($5, data_scadenza),
            organismo = COALESCE($6, organismo),
            attivo = COALESCE($7, attivo)
        WHERE id = $1
      `, [id, id_soa, classifica, data_rilascio, data_scadenza, organismo, attivo]);

      await query(`
        INSERT INTO modifiche_azienda (id_azienda, campo, valore_nuovo, username)
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

      const aziendaRes = await query('SELECT id_azienda FROM attestazioni WHERE id = $1', [id]);
      if (aziendaRes.rows.length === 0) {
        return reply.status(404).send({ error: 'Attestazione not found' });
      }

      const aziendaId = aziendaRes.rows[0].id_azienda;

      await query('DELETE FROM attestazioni WHERE id = $1', [id]);

      await query(`
        INSERT INTO modifiche_azienda (id_azienda, campo, valore_nuovo, username)
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
        SELECT id, id_azienda, nome, cognome, ruolo, email, telefono,
               created_at
        FROM azienda_personale
        WHERE id_azienda = $1
        ORDER BY created_at DESC
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
      const { nome, cognome, ruolo, email, telefono, note } = request.body;

      if (!nome) {
        return reply.status(400).send({ error: 'Nome required' });
      }

      const res = await query(`
        INSERT INTO azienda_personale (
          id_azienda, nome, cognome, ruolo, email, telefono, note, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
        RETURNING id
      `, [id, nome, cognome, ruolo, email, telefono, note]);

      await query(`
        INSERT INTO modifiche_azienda (id_azienda, campo, valore_nuovo, username)
        VALUES ($1, $2, $3, $4)
      `, [id, 'ADD_PERSONALE', `Aggiunto personale: ${nome} ${cognome || ''}`, request.session.user.username]);

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
      const { nome, cognome, ruolo, email, telefono, note } = request.body;

      const aziendaRes = await query('SELECT id_azienda FROM azienda_personale WHERE id = $1', [id]);
      if (aziendaRes.rows.length === 0) {
        return reply.status(404).send({ error: 'Personale not found' });
      }

      const aziendaId = aziendaRes.rows[0].id_azienda;

      await query(`
        UPDATE azienda_personale
        SET nome = COALESCE($2, nome),
            cognome = COALESCE($3, cognome),
            ruolo = COALESCE($4, ruolo),
            email = COALESCE($5, email),
            telefono = COALESCE($6, telefono),
            note = COALESCE($7, note),
            updated_at = NOW()
        WHERE id = $1
      `, [id, nome, cognome, ruolo, email, telefono, note]);

      await query(`
        INSERT INTO modifiche_azienda (id_azienda, campo, valore_nuovo, username)
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

      const aziendaRes = await query('SELECT id_azienda FROM azienda_personale WHERE id = $1', [id]);
      if (aziendaRes.rows.length === 0) {
        return reply.status(404).send({ error: 'Personale not found' });
      }

      const aziendaId = aziendaRes.rows[0].id_azienda;

      await query('DELETE FROM azienda_personale WHERE id = $1', [id]);

      await query(`
        INSERT INTO modifiche_azienda (id_azienda, campo, valore_nuovo, username)
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
        SELECT id, id_azienda, testo, username, data_inserimento
        FROM note_aziende
        WHERE id_azienda = $1
        ORDER BY data_inserimento DESC
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
      const { testo } = request.body;

      if (!testo) {
        return reply.status(400).send({ error: 'Testo required' });
      }

      const res = await query(`
        INSERT INTO note_aziende (
          id_azienda, testo, username, data_inserimento
        ) VALUES ($1, $2, $3, NOW())
        RETURNING id
      `, [id, testo, request.session.user.username]);

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

      await query('DELETE FROM note_aziende WHERE id = $1', [id]);

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
        SELECT id, id_azienda, tipo, descrizione, data, username,
               data_inserimento
        FROM eventi_aziende
        WHERE id_azienda = $1
        ORDER BY data DESC
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
      const { tipo, descrizione, data } = request.body;

      if (!tipo) {
        return reply.status(400).send({ error: 'Tipo required' });
      }

      const res = await query(`
        INSERT INTO eventi_aziende (
          id_azienda, tipo, descrizione, data, username, data_inserimento
        ) VALUES ($1, $2, $3, $4, $5, NOW())
        RETURNING id
      `, [id, tipo, descrizione, data || new Date(), request.session.user.username]);

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

      await query('DELETE FROM eventi_aziende WHERE id = $1', [id]);

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
        SELECT ag.id, ag.id_gara, ag.id_azienda_mandataria, ag.id_azienda_mandante,
               ag.tipo_partecipazione, g.titolo AS titolo_gara, g.data AS data_gara,
               am.ragione_sociale AS ragione_sociale_mandataria,
               an.ragione_sociale AS ragione_sociale_mandante
        FROM ati_gare ag
        JOIN gare g ON ag.id_gara = g.id
        LEFT JOIN aziende am ON ag.id_azienda_mandataria = am.id
        LEFT JOIN aziende an ON ag.id_azienda_mandante = an.id
        WHERE ag.id_azienda_mandataria = $1 OR ag.id_azienda_mandante = $1
        ORDER BY g.data DESC
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
        SELECT DISTINCT g.id, g.data, g.titolo, g.importo,
               dg.ribasso, dg.posizione, dg.vincitrice,
               a.ragione_sociale AS ragione_sociale_lead,
               string_agg(DISTINCT a2.ragione_sociale, ', ') AS mandanti
        FROM gare g
        JOIN dettaglio_gara dg ON dg.id_gara = g.id
        JOIN aziende a ON dg.id_azienda = a.id
        LEFT JOIN ati_gare ag ON g.id = ag.id_gara AND (ag.id_azienda_mandataria = dg.id_azienda OR ag.id_azienda_mandante = dg.id_azienda)
        LEFT JOIN aziende a2 ON (ag.id_azienda_mandante = a2.id AND ag.id_azienda_mandataria = dg.id_azienda)
                             OR (ag.id_azienda_mandataria = a2.id AND ag.id_azienda_mandante = dg.id_azienda)
        WHERE dg.id_azienda = $1 OR ag.id_azienda_mandante = $1 OR ag.id_azienda_mandataria = $1
        GROUP BY g.id, dg.ribasso, dg.posizione, dg.vincitrice, a.ragione_sociale
        ORDER BY g.data DESC
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
        SELECT id, ragione_sociale, partita_iva
        FROM aziende
        WHERE eliminata = false AND ragione_sociale ILIKE $1
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
        SELECT id, ragione_sociale, partita_iva
        FROM aziende
        WHERE eliminata = false AND partita_iva ILIKE $1
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
        SELECT DISTINCT a.id, a.ragione_sociale,
               COUNT(dg.id) AS n_partecipazioni
        FROM aziende a
        JOIN dettaglio_gara dg ON a.id = dg.id_azienda
        WHERE a.eliminata = 0 AND a.ragione_sociale ILIKE $1
        GROUP BY a.id, a.ragione_sociale
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
        SELECT COUNT(*) as total, COUNT(CASE WHEN vincitrice = true THEN 1 END) as vinti
        FROM dettaglio_gara
        WHERE id_azienda = $1
      `, [id]);

      // Average discount
      const avgRes = await query(`
        SELECT AVG(ribasso) as media_ribasso,
               MIN(ribasso) as min_ribasso,
               MAX(ribasso) as max_ribasso,
               STDDEV(ribasso) as stddev_ribasso
        FROM dettaglio_gara
        WHERE id_azienda = $1 AND ribasso IS NOT NULL
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
        SELECT dg.id, g.data, g.titolo,
               dg.ribasso, dg.posizione,
               dg.vincitrice
        FROM dettaglio_gara dg
        JOIN gare g ON dg.id_gara = g.id
        WHERE dg.id_azienda = $1 AND dg.ribasso IS NOT NULL
        ORDER BY g.data DESC
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
        SELECT dg.id, g.data, g.titolo,
               dg.ribasso,
               g.importo, g.media_ar
        FROM dettaglio_gara dg
        JOIN gare g ON dg.id_gara = g.id
        WHERE dg.id_azienda = $1 AND dg.vincitrice = true AND dg.ribasso IS NOT NULL
        ORDER BY g.data DESC
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
          dg.vincitrice,
          dg.anomala,
          dg.esclusa,
          COUNT(*) as count
        FROM dettaglio_gara dg
        WHERE dg.id_azienda = $1
        GROUP BY dg.vincitrice, dg.anomala, dg.esclusa
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
        } else if (row.anomala === true) {
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
          COUNT(*) FILTER (WHERE ag.id IS NULL) as singolo,
          COUNT(*) FILTER (WHERE ag.id_azienda_mandataria = $1) as mandataria,
          COUNT(*) FILTER (WHERE ag.id_azienda_mandante = $1) as mandante,
          COUNT(*) FILTER (WHERE dg.id_azienda = $1 AND EXISTS (
            SELECT 1 FROM ati_gare ag2 WHERE ag2.id_gara = dg.id_gara
          )) as con_ati
        FROM dettaglio_gara dg
        LEFT JOIN ati_gare ag ON dg.id_gara = ag.id_gara AND (
          ag.id_azienda_mandataria = dg.id_azienda OR ag.id_azienda_mandante = dg.id_azienda
        )
        WHERE dg.id_azienda = $1
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
        SELECT id, id_azienda, campo, valore_precedente, valore_nuovo, username, data
        FROM modifiche_azienda
        WHERE id_azienda = $1
        ORDER BY data DESC
        LIMIT 100
      `, [id]);

      return { storia: res.rows };
    } catch (err) {
      fastify.log.error(err, 'Storia error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ============================================================
  // AZIENDA SOSTITUZIONE (Valida / Errata)
  // ============================================================

  /**
   * POST /api/admin/aziende/sostituisci
   * Replace an erroneous company with the correct one.
   * Moves all gare, attestazioni, personale, note, eventi to the valid company
   * and soft-deletes the erroneous one.
   */
  fastify.post('/sostituisci', async (request, reply) => {
    try {
      const { id_valida, id_errata } = request.body;
      if (!id_valida || !id_errata || id_valida === id_errata) {
        return reply.status(400).send({ error: 'ID valida e ID errata devono essere diversi' });
      }

      // Check both exist
      const checkV = await query('SELECT id FROM aziende WHERE id = $1', [id_valida]);
      const checkE = await query('SELECT id FROM aziende WHERE id = $1', [id_errata]);
      if (!checkV.rows.length) return reply.status(404).send({ error: `Azienda valida (${id_valida}) non trovata` });
      if (!checkE.rows.length) return reply.status(404).send({ error: `Azienda errata (${id_errata}) non trovata` });

      // Move references
      const updates = [];
      try { updates.push(await query('UPDATE dettaglio_gara SET id_azienda = $1 WHERE id_azienda = $2', [id_valida, id_errata])); } catch(e) {}
      try { updates.push(await query('UPDATE attestazioni SET id_azienda = $1 WHERE id_azienda = $2', [id_valida, id_errata])); } catch(e) {}
      try { updates.push(await query('UPDATE azienda_personale SET id_azienda = $1 WHERE id_azienda = $2', [id_valida, id_errata])); } catch(e) {}
      try { updates.push(await query('UPDATE note_aziende SET id_azienda = $1 WHERE id_azienda = $2', [id_valida, id_errata])); } catch(e) {}
      try { updates.push(await query('UPDATE eventi_aziende SET id_azienda = $1 WHERE id_azienda = $2', [id_valida, id_errata])); } catch(e) {}
      try { updates.push(await query('UPDATE consorzi SET id_azienda_consorzio = $1 WHERE id_azienda_consorzio = $2', [id_valida, id_errata])); } catch(e) {}
      try { updates.push(await query('UPDATE consorzi SET id_azienda_membro = $1 WHERE id_azienda_membro = $2', [id_valida, id_errata])); } catch(e) {}

      // Soft-delete errata
      await query('UPDATE aziende SET eliminata = 1, data_modifica = NOW() WHERE id = $1', [id_errata]);

      // Log the operation
      try {
        await query(`INSERT INTO modifiche_azienda (id_azienda, campo, valore_precedente, valore_nuovo, username, data) VALUES ($1, 'sostituzione', $2, $3, $4, NOW())`,
          [id_valida, `Azienda errata ID ${id_errata}`, `Assorbita in ID ${id_valida}`, request.session?.user?.username || 'admin']);
      } catch(e) {}

      return { message: `Azienda ${id_errata} sostituita con ${id_valida}. L'azienda errata è stata eliminata.` };
    } catch (err) {
      fastify.log.error(err, 'Sostituzione error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ============================================================
  // CONSORZI MANAGEMENT
  // ============================================================

  /**
   * POST /api/admin/aziende/:id/consorzi
   * Add a member company to a consortium
   */
  fastify.post('/:id/consorzi', async (request, reply) => {
    try {
      const consorzioId = request.params.id;
      let { id_azienda_membro, partita_iva_membro } = request.body;

      // If only P.IVA provided, look up the company id
      if (!id_azienda_membro && partita_iva_membro) {
        const pivaRes = await query('SELECT id FROM aziende WHERE partita_iva = $1 LIMIT 1', [partita_iva_membro.trim()]);
        if (!pivaRes.rows.length) return reply.status(404).send({ error: `Azienda con P.IVA ${partita_iva_membro} non trovata` });
        id_azienda_membro = pivaRes.rows[0].id;
      }

      if (!id_azienda_membro) return reply.status(400).send({ error: 'id_azienda_membro o partita_iva_membro richiesto' });

      const res = await query(`
        INSERT INTO consorzi (id_azienda_consorzio, id_azienda_membro, data_inizio, attivo)
        VALUES ($1, $2, NOW(), 1)
        RETURNING id
      `, [consorzioId, id_azienda_membro]);

      return { id: res.rows[0].id, message: 'Membro aggiunto al consorzio' };
    } catch (err) {
      fastify.log.error(err, 'Add consorzio member error');
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * DELETE /api/admin/aziende/consorzi/:relId
   * Remove a consortium relationship
   */
  fastify.delete('/consorzi/:relId', async (request, reply) => {
    try {
      const { relId } = request.params;
      await query('UPDATE consorzi SET attivo = 0, data_fine = NOW() WHERE id = $1', [relId]);
      return { message: 'Membro rimosso dal consorzio' };
    } catch (err) {
      fastify.log.error(err, 'Remove consorzio member error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ============================================================
  // PASSWORD DI PROVA
  // ============================================================

  /**
   * POST /api/admin/aziende/:id/password-prova
   * Generate a trial password for a company
   */
  fastify.post('/:id/password-prova', async (request, reply) => {
    try {
      const { id } = request.params;
      const { giorni = 7, servizio = 'esiti' } = request.body;

      // Get company info
      const azRes = await query('SELECT id, ragione_sociale, email, username FROM aziende WHERE id = $1', [id]);
      if (!azRes.rows.length) return reply.status(404).send({ error: 'Azienda non trovata' });

      const az = azRes.rows[0];
      const scadenza = new Date();
      scadenza.setDate(scadenza.getDate() + parseInt(giorni));
      const scadenzaStr = scadenza.toISOString().substring(0, 10);

      // Update the appropriate subscription date
      const colMap = { esiti: 'scadenza_esiti', bandi: 'scadenza_bandi', bundle: 'scadenza_bundle' };
      const col = colMap[servizio] || 'scadenza_esiti';
      await query(`UPDATE aziende SET ${col} = $1, data_modifica = NOW() WHERE id = $2`, [scadenzaStr, id]);

      // Log event
      try {
        await query(`INSERT INTO eventi_aziende (id_azienda, tipo, descrizione, data, username, data_inserimento) VALUES ($1, 'password_prova', $2, NOW(), $3, NOW())`,
          [id, `Password di prova ${servizio} per ${giorni} giorni (scadenza: ${scadenzaStr})`, request.session?.user?.username || 'admin']);
      } catch(e) {}

      return { message: `Password di prova attivata fino al ${scadenzaStr} per ${servizio}`, scadenza: scadenzaStr };
    } catch (err) {
      fastify.log.error(err, 'Password prova error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ============================================================
  // DOCUMENTI ALLEGATI
  // ============================================================

  /**
   * POST /api/admin/aziende/:id/documenti
   * Upload a document for a company (placeholder - stores metadata)
   */
  fastify.post('/:id/documenti', async (request, reply) => {
    try {
      const { id } = request.params;
      // For now, just update the document flags in the aziende table
      // Full file upload would require multipart handling
      const parts = request.body;
      const tipo = parts?.tipo || 'delega';
      const scadenza = parts?.scadenza || null;

      const colMap = {
        'delega': { presente: 'presente_documento_delega', scadenza: 'data_scadenza_delega', doc: 'documento_delega' },
        'identita': { presente: 'presente_documento_identita', scadenza: 'data_scadenza_identita', doc: 'documento_identita' },
        'soa_doc': { presente: 'presente_documento_soa', scadenza: 'data_scadenza_soa', doc: 'documento_soa' },
        'cciaa_doc': { presente: 'presente_documento_cciaa', scadenza: 'data_scadenza_cciaa', doc: 'documento_cciaa' }
      };
      const cols = colMap[tipo];
      if (!cols) return reply.status(400).send({ error: 'Tipo documento non valido' });

      let updateQuery = `UPDATE aziende SET ${cols.presente} = 1, data_modifica = NOW()`;
      const params = [id];
      let paramIdx = 2;
      if (scadenza) {
        updateQuery += `, ${cols.scadenza} = $${paramIdx}`;
        params.push(scadenza);
        paramIdx++;
      }
      updateQuery += ` WHERE id = $1`;
      await query(updateQuery, params);

      return { message: 'Documento registrato (upload file non ancora implementato)' };
    } catch (err) {
      fastify.log.error(err, 'Upload documento error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ============================================================
  // IMPRESE QUALIFICATE — Aziende con attestazione SOA
  // ============================================================
  fastify.get('/imprese', async (request) => {
    const { search, piva, soa_prefix, classifica_min, regione, page = 1, limit = 50 } = request.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let conditions = ['a."attivo" = true'];
    const params = [];
    let idx = 0;

    // Must have SOA attestation
    conditions.push('EXISTS (SELECT 1 FROM attestazioni_aziende aa WHERE aa."id_azienda" = a.id)');

    if (search) { idx++; conditions.push(`a."ragione_sociale" ILIKE $${idx}`); params.push('%' + search + '%'); }
    if (piva) { idx++; conditions.push(`a."partita_iva" ILIKE $${idx}`); params.push('%' + piva + '%'); }
    if (soa_prefix) {
      idx++; conditions.push(`EXISTS (SELECT 1 FROM attestazioni_aziende aa2 JOIN soa s2 ON aa2."id_soa" = s2.id WHERE aa2."id_azienda" = a.id AND s2."codice" LIKE $${idx})`);
      params.push(soa_prefix + '%');
    }
    if (regione) {
      idx++; conditions.push(`r."nome" = $${idx}`); params.push(regione);
    }

    const where = conditions.join(' AND ');

    // Count
    const countRes = await query(`
      SELECT COUNT(DISTINCT a.id) AS total
      FROM aziende a LEFT JOIN province p ON a."id_provincia" = p.id LEFT JOIN regioni r ON p."id_regione" = r.id
      WHERE ${where}
    `, params);
    const total = parseInt(countRes.rows[0].total);

    // Data
    idx++; params.push(parseInt(limit));
    idx++; params.push(offset);
    const result = await query(`
      SELECT DISTINCT a.id, a."ragione_sociale", a."partita_iva", a."codice_fiscale",
             a."citta", a."email", a."telefono",
             p."nome" AS provincia, r."nome" AS regione,
             (SELECT COUNT(*) FROM attestazioni_aziende aa WHERE aa."id_azienda" = a.id) AS n_soa,
             (SELECT string_agg(s3."codice", ', ' ORDER BY s3."codice")
              FROM attestazioni_aziende aa3 JOIN soa s3 ON aa3."id_soa" = s3.id
              WHERE aa3."id_azienda" = a.id LIMIT 1) AS soa_list
      FROM aziende a
      LEFT JOIN province p ON a."id_provincia" = p.id
      LEFT JOIN regioni r ON p."id_regione" = r.id
      WHERE ${where}
      ORDER BY a."ragione_sociale"
      LIMIT $${idx - 1} OFFSET $${idx}
    `, params);

    // Stats
    const statsRes = await query(`
      SELECT COUNT(DISTINCT a.id) AS totale_imprese,
             COUNT(DISTINCT CASE WHEN r."nome" IS NOT NULL THEN r."nome" END) AS regioni_coperte
      FROM aziende a
      LEFT JOIN province p ON a."id_provincia" = p.id
      LEFT JOIN regioni r ON p."id_regione" = r.id
      WHERE a."attivo" = true AND EXISTS (SELECT 1 FROM attestazioni_aziende aa WHERE aa."id_azienda" = a.id)
    `);

    return {
      data: result.rows,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      pages: Math.ceil(total / parseInt(limit)),
      stats: statsRes.rows[0]
    };
  });

  // ============================================================
  // CASELLARIO — Aziende con note/annotazioni
  // ============================================================
  fastify.get('/casellario', async (request) => {
    const { search, tipo } = request.query;

    let conditions = ['a."attivo" = true', "(a.\"note\" IS NOT NULL AND a.\"note\" != '')"];
    const params = [];
    let idx = 0;

    if (search) { idx++; conditions.push(`(a."ragione_sociale" ILIKE $${idx} OR a."partita_iva" ILIKE $${idx})`); params.push('%' + search + '%'); }
    if (tipo) {
      idx++; conditions.push(`LOWER(a."note") LIKE $${idx}`);
      params.push('%' + tipo.toLowerCase() + '%');
    }

    const where = conditions.join(' AND ');

    const result = await query(`
      SELECT a.id, a."ragione_sociale", a."partita_iva", a."citta",
             p."nome" AS provincia, a."note",
             a."email", a."telefono",
             (SELECT COUNT(*) FROM note_aziende na WHERE na.id_azienda = a.id) AS n_note_interne
      FROM aziende a
      LEFT JOIN province p ON a."id_provincia" = p.id
      WHERE ${where}
      ORDER BY a."ragione_sociale"
      LIMIT 200
    `, params);

    // Stats
    const statsRes = await query(`
      SELECT COUNT(*) AS totale,
             COUNT(CASE WHEN LOWER(a."note") LIKE '%esclus%' THEN 1 END) AS esclusioni,
             COUNT(CASE WHEN LOWER(a."note") LIKE '%sanzi%' OR LOWER(a."note") LIKE '%penal%' THEN 1 END) AS sanzioni
      FROM aziende a
      WHERE a."attivo" = true AND a."note" IS NOT NULL AND a."note" != ''
    `);

    return { data: result.rows, stats: statsRes.rows[0] };
  });

  // ============================================================
  // CCIAA — Stato visure camerali
  // ============================================================
  fastify.get('/cciaa', async (request) => {
    const { search, stato_visura } = request.query;

    let conditions = ['a."attivo" = true'];
    const params = [];
    let idx = 0;

    if (search) { idx++; conditions.push(`(a."ragione_sociale" ILIKE $${idx} OR a."partita_iva" ILIKE $${idx})`); params.push('%' + search + '%'); }

    // stato_visura filter: valida, scaduta, mancante
    if (stato_visura === 'valida') {
      conditions.push("a.\"presente_documento_cciaa\" = 1 AND (a.\"data_scadenza_cciaa\" IS NULL OR a.\"data_scadenza_cciaa\" >= CURRENT_DATE)");
    } else if (stato_visura === 'scaduta') {
      conditions.push("a.\"presente_documento_cciaa\" = 1 AND a.\"data_scadenza_cciaa\" < CURRENT_DATE");
    } else if (stato_visura === 'mancante') {
      conditions.push("(a.\"presente_documento_cciaa\" IS NULL OR a.\"presente_documento_cciaa\" != 1)");
    }

    const where = conditions.join(' AND ');

    const result = await query(`
      SELECT a.id, a."ragione_sociale", a."partita_iva", a."codice_fiscale", a."citta",
             p."nome" AS provincia, a."email",
             a."presente_documento_cciaa",
             a."data_scadenza_cciaa",
             CASE
               WHEN a."presente_documento_cciaa" = 1 AND (a."data_scadenza_cciaa" IS NULL OR a."data_scadenza_cciaa" >= CURRENT_DATE) THEN 'valida'
               WHEN a."presente_documento_cciaa" = 1 AND a."data_scadenza_cciaa" < CURRENT_DATE THEN 'scaduta'
               ELSE 'mancante'
             END AS stato_visura
      FROM aziende a
      LEFT JOIN province p ON a."id_provincia" = p.id
      WHERE ${where}
      ORDER BY a."ragione_sociale"
      LIMIT 200
    `, params);

    // Stats
    const statsRes = await query(`
      SELECT COUNT(*) AS totale,
             COUNT(CASE WHEN a."presente_documento_cciaa" = 1 AND (a."data_scadenza_cciaa" IS NULL OR a."data_scadenza_cciaa" >= CURRENT_DATE) THEN 1 END) AS valide,
             COUNT(CASE WHEN a."presente_documento_cciaa" = 1 AND a."data_scadenza_cciaa" < CURRENT_DATE THEN 1 END) AS scadute,
             COUNT(CASE WHEN a."presente_documento_cciaa" IS NULL OR a."presente_documento_cciaa" != 1 THEN 1 END) AS mancanti
      FROM aziende a WHERE a."attivo" = true
    `);

    return { data: result.rows, stats: statsRes.rows[0] };
  });

  // ============================================================
  // POST /api/admin/aziende/invia-mail - Invio email massivo
  // ============================================================
  fastify.post('/invia-mail', async (request, reply) => {
    const { destinatari_ids, oggetto, corpo, tipo_filtro } = request.body;

    if (!oggetto || !corpo) return reply.status(400).send({ error: 'Oggetto e corpo email obbligatori' });

    let emails = [];

    if (destinatari_ids && destinatari_ids.length > 0) {
      // Specific recipients
      const placeholders = destinatari_ids.map((_, i) => `$${i + 1}`).join(',');
      const res = await query(`SELECT id, "ragione_sociale", "email" FROM aziende WHERE id IN (${placeholders}) AND "email" IS NOT NULL AND "email" != ''`, destinatari_ids);
      emails = res.rows;
    } else if (tipo_filtro) {
      // Filter-based: tutti_clienti, con_soa, senza_soa, scadenza_prossima
      let filterCondition = 'a."attivo" = true AND a."email" IS NOT NULL AND a."email" != \'\'';
      if (tipo_filtro === 'con_soa') filterCondition += ' AND EXISTS (SELECT 1 FROM attestazioni_aziende aa WHERE aa."id_azienda" = a.id)';
      else if (tipo_filtro === 'senza_soa') filterCondition += ' AND NOT EXISTS (SELECT 1 FROM attestazioni_aziende aa WHERE aa."id_azienda" = a.id)';
      const res = await query(`SELECT a.id, a."ragione_sociale", a."email" FROM aziende a WHERE ${filterCondition} ORDER BY a."ragione_sociale" LIMIT 500`);
      emails = res.rows;
    }

    if (emails.length === 0) return { success: false, error: 'Nessun destinatario con email valida trovato' };

    let sendEmail;
    try {
      const mod = await import('../services/email-service.js');
      sendEmail = mod.sendEmail;
    } catch {
      return { success: false, error: 'Servizio email non configurato. Configura il servizio SMTP nelle impostazioni.', destinatari_trovati: emails.length };
    }

    let sent = 0, failed = 0;
    for (const az of emails) {
      try {
        const personalBody = corpo.replace(/\{ragione_sociale\}/g, az.ragione_sociale || 'Gentile Cliente');
        const result = await sendEmail(az.email, oggetto, personalBody);
        if (result.status === 'sent') sent++;
        else failed++;
      } catch { failed++; }
    }

    return { success: true, inviate: sent, fallite: failed, totale: emails.length };
  });
}
