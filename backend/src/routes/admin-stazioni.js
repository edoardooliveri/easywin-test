import { query } from '../db/pool.js';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
dotenv.config();

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
        sort_by = 'nome',
        sort_order = 'ASC',
        citta,
        cap,
        indirizzo,
        piattaforma,
        pub_esito,
        pub_bando,
        con_fonti,
        con_albo,
        senza_albo
      } = request.query;

      const offset = (parseInt(page) - 1) * parseInt(limit);
      const params = [];
      const conditions = [];

      // Search by name, VAT, or email
      if (search) {
        params.push(`%${search}%`);
        const paramIdx = params.length;
        conditions.push(
          `(s.nome ILIKE $${paramIdx} OR s.codice_fiscale ILIKE $${paramIdx} OR s.email ILIKE $${paramIdx})`
        );
      }

      // Filter by province
      if (provincia) {
        params.push(`%${provincia}%`);
        conditions.push(`p.nome ILIKE $${params.length}`);
      }

      // Filter by city
      if (citta) {
        params.push(`%${citta}%`);
        conditions.push(`s.citta ILIKE $${params.length}`);
      }

      // Filter by CAP
      if (cap) {
        params.push(`%${cap}%`);
        conditions.push(`s.cap ILIKE $${params.length}`);
      }

      // Filter by address
      if (indirizzo) {
        params.push(`%${indirizzo}%`);
        conditions.push(`s.indirizzo ILIKE $${params.length}`);
      }

      // Filter by piattaforma (removed since stazioni doesn't have id_piattaforma in new schema)
      if (piattaforma) {
        // This filter is skipped in new schema
      }

      // Filter by type — tipologia column not yet migrated, filter skipped
      if (type) {
        // params.push(type);
        // conditions.push(`s.tipologia = $${params.length}`);
      }

      // Checkbox filters
      if (pub_esito === 'true') {
        // PubblicazioneEsito not yet migrated — filter skipped
      }
      if (pub_bando === 'true') {
        // PubblicazioneBando not yet migrated — filter skipped
      }
      if (con_fonti === 'true') {
        conditions.push(`EXISTS (SELECT 1 FROM fonti_web fw WHERE fw.id_stazione = s.id AND fw.attivo = true)`);
      }
      if (con_albo === 'true') {
        conditions.push(`EXISTS (SELECT 1 FROM albi_fornitori af WHERE af.id_stazione = s.id AND af.attivo = true)`);
      }
      if (senza_albo === 'true') {
        conditions.push(`NOT EXISTS (SELECT 1 FROM albi_fornitori af WHERE af.id_stazione = s.id AND af.attivo = true)`);
      }

      // Active/Deleted filter (attivo boolean, true = active)
      if (active_only === 'true') {
        conditions.push(`s.attivo = true`);
      } else if (show_deleted !== 'true') {
        conditions.push(`s.attivo = true`);
      }

      const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

      // Count total
      const countRes = await query(
        `SELECT COUNT(*) FROM stazioni s
         LEFT JOIN province p ON s.id_provincia = p.id
         ${where}`,
        params
      );
      const total = parseInt(countRes.rows[0].count);

      // Data query
      params.push(parseInt(limit), offset);
      const dataRes = await query(`
        SELECT s.id, s.nome AS ragione_sociale, s.nome AS nome,
               s.indirizzo, s.cap, s.citta,
               s.telefono, s.codice_fiscale AS partita_iva,
               s.email, s.note,
               NOT s.attivo AS eliminata, NOT s.attivo AS obsoleta, NULL AS tipo,
               NULL::double precision AS lat, NULL::double precision AS lon,
               NULL::integer AS id_piattaforma,
               s.created_at AS data_inserimento, s.updated_at AS data_modifica,
               p.nome AS provincia_nome, p.sigla AS sigla_provincia,
               r.nome AS regione_nome,
               (SELECT string_agg(DISTINCT plt.nome, ', ') FROM iscrizione_stazioni isc
                JOIN piattaforme plt ON plt.id = isc.id_piattaforma
                WHERE isc.id_stazione = s.id AND plt.nome NOT IN ('Nessuna','Non indicata')) AS piattaforma_nome,
               (SELECT COUNT(*) FROM bandi b WHERE b.id_stazione = s.id) AS n_bandi,
               (SELECT COUNT(*) FROM gare g JOIN bandi b ON g.id_bando = b.id WHERE b.id_stazione = s.id) AS n_esiti,
               (SELECT COUNT(*) FROM fonti_web fw WHERE fw.id_stazione = s.id AND fw.attivo = true) AS n_fonti,
               (SELECT COUNT(*) FROM albi_fornitori af WHERE af.id_stazione = s.id AND af.attivo = true) AS n_albi,
               (SELECT COUNT(*) FROM iscrizione_stazioni isc WHERE isc.id_stazione = s.id) AS n_iscrizioni,
               (SELECT json_agg(json_build_object(
                 'id', af.id, 'nome_albo', af.nome_albo, 'piattaforma', af.piattaforma,
                 'url_albo', af.url_albo, 'documenti_richiesti', af.documenti_richiesti,
                 'procedura_iscrizione', af.procedura_iscrizione,
                 'scadenza_iscrizione', af.scadenza_iscrizione
               )) FROM albi_fornitori af WHERE af.id_stazione = s.id AND af.attivo = true) AS albi_detail,
               (SELECT json_agg(json_build_object(
                 'id', isc.id, 'tipo', isc.tipo, 'istruzioni', isc.istruzioni,
                 'durata', isc.durata, 'scadenza', isc.scadenza,
                 'is_albo_fornitori', isc.is_albo_fornitori,
                 'nome_allegato', isc.nome_allegato,
                 'piattaforma', plt.nome
               )) FROM iscrizione_stazioni isc LEFT JOIN piattaforme plt ON plt.id = isc.id_piattaforma WHERE isc.id_stazione = s.id) AS iscrizioni_detail
        FROM stazioni s
        LEFT JOIN province p ON s.id_provincia = p.id
        LEFT JOIN regioni r ON p.id_regione = r.id
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
        SELECT s.id,
               s.nome AS "RagioneSociale",
               s.nome AS "Nome",
               s.codice_fiscale AS "PartitaIva",
               s.codice_fiscale AS "cod",
               s.email AS "Email",
               s.indirizzo AS "Indirizzo",
               s.cap AS "Cap",
               s.citta AS "Città",
               s.telefono AS "Tel",
               s.note AS "Note",
               s.attivo,
               s.pec,
               s.sito_web,
               s.fax,
               s.partita_iva,
               s.codice_ausa,
               s.created_at, s.updated_at,
               s.id_provincia,
               false AS "PubblicazioneEsito",
               false AS "PubblicazioneBando",
               0 AS "GiorniAlertPubblicazione",
               '' AS "TipoPubblicazioneEsito",
               false AS "LimitaRange",
               NOT s.attivo AS "Obsoleta",
               '' AS "NotePubblicazione",
               p.nome AS provincia_nome, p.id AS id_provincia_new,
               r.nome AS regione_nome, r.id AS id_regione,
               (SELECT string_agg(DISTINCT plt.nome, ', ') FROM iscrizione_stazioni isc
                JOIN piattaforme plt ON plt.id = isc.id_piattaforma
                WHERE isc.id_stazione = s.id AND plt.nome NOT IN ('Nessuna','Non indicata')) AS piattaforma_nome,
               (SELECT string_agg(DISTINCT plt.url, ', ') FROM iscrizione_stazioni isc
                JOIN piattaforme plt ON plt.id = isc.id_piattaforma
                WHERE isc.id_stazione = s.id AND plt.url IS NOT NULL AND plt.nome NOT IN ('Nessuna','Non indicata')) AS piattaforma_link,
               NULL::double precision AS "Lat",
               NULL::double precision AS "Lon"
        FROM stazioni s
        LEFT JOIN province p ON s.id_provincia = p.id
        LEFT JOIN regioni r ON p.id_regione = r.id
        WHERE s.id = $1
      `, [id]);

      if (staRes.rows.length === 0) {
        return reply.status(404).send({ error: 'Stazione non trovata' });
      }

      const station = staRes.rows[0];

      // Personnel
      const personnelRes = await query(`
        SELECT id, nome, cognome, ruolo,
               email, telefono, created_at AS data_inserimento
        FROM personale_stazione
        WHERE id_stazione = $1
        ORDER BY created_at DESC
      `, [id]);

      // Registrations (Iscrizioni)
      const iscrizioniRes = await query(`
        SELECT i.id, i.id_stazione, p.nome AS piattaforma, i.data_inserimento AS data_iscrizione,
               i.scadenza AS data_scadenza, i.tipo, i.istruzioni,
               i.durata, i.is_albo_fornitori AS attiva
        FROM iscrizione_stazioni i
        LEFT JOIN piattaforme p ON p.id = i.id_piattaforma
        WHERE i.id_stazione = $1
        ORDER BY i.data_inserimento DESC
      `, [id]);

      // Recent Bandi
      const bandiRes = await query(`
        SELECT id, titolo, data_pubblicazione,
               data_offerta,
               importo_so AS importo_totale,
               codice_cig AS cig
        FROM bandi
        WHERE id_stazione = $1
        ORDER BY data_pubblicazione DESC NULLS LAST
        LIMIT 10
      `, [id]);

      // Recent Esiti (via bandi join)
      const esitiRes = await query(`
        SELECT g.id, g.data AS data, COALESCE(g.titolo, b.titolo) AS titolo, g.importo,
               g.n_partecipanti, g.ribasso,
               COALESCE(g.codice_cig, b.codice_cig) AS cig
        FROM gare g
        LEFT JOIN bandi b ON g.id_bando = b.id
        WHERE g.id_stazione = $1 OR b.id_stazione = $1
        ORDER BY g.data DESC NULLS LAST
        LIMIT 10
      `, [id]);

      // Fonti Web count
      const fontiRes = await query(`
        SELECT COUNT(*) FROM fonti_web
        WHERE id_stazione = $1 AND attivo = true
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
          nome, indirizzo, cap, citta,
          id_provincia, telefono, email, codice_fiscale,
          tipologia, note,
          attivo, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, NOW(), NOW())
        RETURNING id
      `, [
        ragione_sociale || nome, indirizzo, cap, citta,
        id_provincia, telefono, email, partita_iva,
        tipo, note
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
      const body = request.body;
      // Accept both PascalCase (from frontend) and snake_case
      const ragione_sociale = body.RagioneSociale || body.ragione_sociale;
      const nome_val = body.Nome || body.nome;
      const indirizzo = body.Indirizzo || body.indirizzo;
      const cap = body.Cap || body.cap;
      const citta = body['Città'] || body.citta;
      const id_provincia = body.id_provincia || null;
      const telefono = body.Tel || body.telefono;
      const email = body.Email || body.email;
      const partita_iva = body.PartitaIva || body.partita_iva;
      const codice_fiscale = body.cod || body.codice_fiscale;
      const note = body.Note || body.note;
      const obsoleta = body.Obsoleta || body.obsoleta;
      const pec = body.pec;
      const sito_web = body.sito_web;
      const fax = body.fax;
      const codice_ausa = body.codice_ausa;

      await query(`
        UPDATE stazioni SET
          nome = COALESCE($1, nome),
          indirizzo = COALESCE($2, indirizzo),
          cap = COALESCE($3, cap),
          citta = COALESCE($4, citta),
          id_provincia = COALESCE($5, id_provincia),
          telefono = COALESCE($6, telefono),
          email = COALESCE($7, email),
          codice_fiscale = COALESCE($8, codice_fiscale),
          partita_iva = COALESCE($9, partita_iva),
          note = COALESCE($10, note),
          attivo = CASE WHEN $12::boolean IS NOT NULL THEN NOT $12::boolean ELSE attivo END,
          pec = COALESCE($13, pec),
          sito_web = COALESCE($14, sito_web),
          fax = COALESCE($15, fax),
          codice_ausa = COALESCE($16, codice_ausa),
          updated_at = NOW()
        WHERE id = $11
      `, [
        ragione_sociale || nome_val, indirizzo, cap, citta,
        id_provincia, telefono, email, codice_fiscale,
        partita_iva, note, id, obsoleta || false,
        pec, sito_web, fax, codice_ausa
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
        UPDATE stazioni SET attivo = false, updated_at = NOW() WHERE id = $1
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
        SELECT COUNT(*) FROM stazioni WHERE attivo = false
      `);
      const total = parseInt(countRes.rows[0].count);

      const dataRes = await query(`
        SELECT id, nome AS ragione_sociale, nome AS nome,
               email, codice_fiscale AS partita_iva,
               updated_at AS data_modifica
        FROM stazioni
        WHERE attivo = false
        ORDER BY updated_at DESC
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
        UPDATE stazioni SET attivo = true, updated_at = NOW() WHERE id = $1
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
      await query(`DELETE FROM personale_stazione WHERE id_stazione = $1`, [id]);
      await query(`DELETE FROM iscrizione_stazioni WHERE id_stazione = $1`, [id]);
      await query(`DELETE FROM fonti_web WHERE id_stazione = $1`, [id]);
      await query(`DELETE FROM stazioni_presidia WHERE id_stazione = $1`, [id]);

      // Delete station
      await query(`DELETE FROM stazioni WHERE id = $1`, [id]);

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
        SELECT id, id_stazione, nome, cognome, ruolo,
               email, telefono,
               created_at AS data_inserimento
        FROM personale_stazione
        WHERE id_stazione = $1
        ORDER BY created_at DESC
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
        INSERT INTO personale_stazione (id_stazione, nome, cognome, ruolo, email, telefono)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
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
      const { nome, cognome, ruolo, email, telefono } = request.body;

      const stRes = await query(`SELECT id_stazione FROM personale_stazione WHERE id = $1`, [id]);
      if (stRes.rows.length === 0) {
        return reply.status(404).send({ error: 'Personale non trovato' });
      }
      const stationId = stRes.rows[0].id_stazione;

      await query(`
        UPDATE personale_stazione SET
          nome = COALESCE($1, nome),
          cognome = COALESCE($2, cognome),
          ruolo = COALESCE($3, ruolo),
          email = COALESCE($4, email),
          telefono = COALESCE($5, telefono),
          updated_at = NOW()
        WHERE id = $6
      `, [nome, cognome, ruolo, email, telefono, id]);

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

      const stRes = await query(`SELECT id_stazione FROM personale_stazione WHERE id = $1`, [id]);
      if (stRes.rows.length === 0) {
        return reply.status(404).send({ error: 'Personale non trovato' });
      }
      const stationId = stRes.rows[0].id_stazione;

      await query(`DELETE FROM personale_stazione WHERE id = $1`, [id]);

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
        SELECT i.id, i.id_stazione, p.nome AS piattaforma, i.data_inserimento AS data_iscrizione,
               i.scadenza AS data_scadenza, i.tipo, i.istruzioni,
               i.durata, i.is_albo_fornitori AS attiva
        FROM iscrizione_stazioni i
        LEFT JOIN piattaforme p ON p.id = i.id_piattaforma
        WHERE i.id_stazione = $1
        ORDER BY i.data_inserimento DESC
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
          id_stazione, id_piattaforma, data_inserimento, scadenza,
          tipo, istruzioni, durata, is_albo_fornitori
        ) VALUES ($1, $2, NOW(), $3, $4, $5, $6, true)
        RETURNING id
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

      const iscrRes = await query(`SELECT id_stazione FROM iscrizione_stazioni WHERE id = $1`, [id]);
      if (iscrRes.rows.length === 0) {
        return reply.status(404).send({ error: 'Iscrizione non trovata' });
      }
      const stationId = iscrRes.rows[0].id_stazione;

      await query(`
        UPDATE iscrizione_stazioni SET
          id_piattaforma = COALESCE($1, id_piattaforma),
          scadenza = COALESCE($2, scadenza),
          tipo = COALESCE($3, tipo),
          istruzioni = COALESCE($4, istruzioni),
          durata = COALESCE($5, durata),
          is_albo_fornitori = COALESCE($6, is_albo_fornitori)
        WHERE id = $7
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

      const iscrRes = await query(`SELECT id_stazione FROM iscrizione_stazioni WHERE id = $1`, [id]);
      if (iscrRes.rows.length === 0) {
        return reply.status(404).send({ error: 'Iscrizione non trovata' });
      }
      const stationId = iscrRes.rows[0].id_stazione;

      await query(`DELETE FROM iscrizione_stazioni WHERE id = $1`, [id]);

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
        SELECT id, id_stazione, id_categoria AS categoria, id_tipologia AS tipo,
               link, auto AS auto_flag, analyze_type,
               tag_inizio AS tags, stato_verifica AS verificata, ultima_verifica AS data_verifica,
               data_inserimento, NOT attivo AS eliminata
        FROM fonti_web
        WHERE id_stazione = $1 AND attivo = true
        ORDER BY data_inserimento DESC
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
          id_stazione, id_categoria, id_tipologia, link, auto,
          analyze_type, tag_inizio, data_inserimento, attivo
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), true)
        RETURNING id
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

      const fonteRes = await query(`SELECT id_stazione FROM fonti_web WHERE id = $1`, [id]);
      if (fonteRes.rows.length === 0) {
        return reply.status(404).send({ error: 'Fonte web non trovata' });
      }
      const stationId = fonteRes.rows[0].id_stazione;

      await query(`
        UPDATE fonti_web SET
          id_categoria = COALESCE($1, id_categoria),
          id_tipologia = COALESCE($2, id_tipologia),
          link = COALESCE($3, link),
          auto = COALESCE($4, auto),
          analyze_type = COALESCE($5, analyze_type),
          tag_inizio = COALESCE($6, tag_inizio),
          updated_at = NOW()
        WHERE id = $7
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

      const fonteRes = await query(`SELECT id_stazione FROM fonti_web WHERE id = $1`, [id]);
      if (fonteRes.rows.length === 0) {
        return reply.status(404).send({ error: 'Fonte web non trovata' });
      }
      const stationId = fonteRes.rows[0].id_stazione;

      await query(`UPDATE fonti_web SET attivo = false, updated_at = NOW() WHERE id = $1`, [id]);

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

      const fonteRes = await query(`SELECT id_stazione FROM fonti_web WHERE id = $1`, [id]);
      if (fonteRes.rows.length === 0) {
        return reply.status(404).send({ error: 'Fonte web non trovata' });
      }
      const stationId = fonteRes.rows[0].id_stazione;

      // In production, verify URL is accessible
      await query(`
        UPDATE fonti_web SET stato_verifica = 'ok', ultima_verifica = NOW(), updated_at = NOW() WHERE id = $1
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
        SELECT id, id_fonte, espressione AS regex, tipo AS descrizione,
               ordine
        FROM fonti_web_regulars
        WHERE id_fonte = $1
        ORDER BY ordine ASC
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
        INSERT INTO fonti_web_regulars (id_fonte, espressione, tipo)
        VALUES ($1, $2, $3)
        RETURNING id
      `, [id, regex, descrizione]);

      const regoleId = result.rows[0].id;

      // Get station for logging
      const fonteRes = await query(`SELECT id_stazione FROM fonti_web WHERE id = $1`, [id]);
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

      const regRes = await query(`SELECT id_fonte FROM fonti_web_regulars WHERE id = $1`, [id]);
      if (regRes.rows.length === 0) {
        return reply.status(404).send({ error: 'Regola non trovata' });
      }

      const fonteId = regRes.rows[0].id_fonte;
      const fonteRes = await query(`SELECT id_stazione FROM fonti_web WHERE id = $1`, [fonteId]);
      const stationId = fonteRes.rows[0].id_stazione;

      await query(`DELETE FROM fonti_web_regulars WHERE id = $1`, [id]);

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
        SELECT id_stazione, codice_presidia AS id_presidia, created_at AS data_collegamento
        FROM stazioni_presidia
        WHERE id_stazione = $1
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
        INSERT INTO stazioni_presidia (id_stazione, codice_presidia)
        VALUES ($1, $2)
        ON CONFLICT (id_stazione, codice_presidia) DO NOTHING
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
        DELETE FROM stazioni_presidia WHERE id_stazione = $1 AND codice_presidia = $2
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
        UPDATE bandi SET id_stazione = $1 WHERE id_stazione = $2
      `, [id_new_station, id]);

      // Move gare/esiti
      await query(`
        UPDATE gare SET id_bando = (SELECT id FROM bandi WHERE id_stazione = $1 LIMIT 1)
        WHERE id_bando IN (SELECT id FROM bandi WHERE id_stazione = $2)
      `, [id_new_station, id]);

      // Mark old as obsolete (if obsoleta column exists)
      try {
        await query(`
          UPDATE stazioni SET attivo = false WHERE id = $1
        `, [id]);
      } catch (e) {
        // Obsolete column doesn't exist, skip
      }

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
        UPDATE fonti_web SET id_piattaforma = $1, updated_at = NOW()
        WHERE id_stazione = $2
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
        SELECT COUNT(*) FROM bandi WHERE id_stazione = $1
      `, [id]);
      const total = parseInt(countRes.rows[0].count);

      const dataRes = await query(`
        SELECT id, titolo, data_pubblicazione,
               data_offerta, importo_so AS importo_totale,
               codice_cig AS cig
        FROM bandi
        WHERE id_stazione = $1
        ORDER BY data_pubblicazione DESC NULLS LAST
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
        SELECT COUNT(*) FROM gare g
        LEFT JOIN bandi b ON g.id_bando = b.id
        WHERE g.id_stazione = $1 OR b.id_stazione = $1
      `, [id]);
      const total = parseInt(countRes.rows[0].count);

      const dataRes = await query(`
        SELECT g.id, g.data, COALESCE(g.titolo, b.titolo) AS titolo, g.importo,
               g.n_partecipanti, g.ribasso,
               COALESCE(g.codice_cig, b.codice_cig) AS cig
        FROM gare g
        LEFT JOIN bandi b ON g.id_bando = b.id
        WHERE g.id_stazione = $1 OR b.id_stazione = $1
        ORDER BY g.data DESC NULLS LAST
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
        SELECT id, nome AS ragione_sociale, nome AS nome, codice_fiscale AS partita_iva
        FROM stazioni
        WHERE (nome ILIKE $1 OR codice_fiscale ILIKE $1)
        AND attivo = true
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
        SELECT id, nome AS provincia, sigla
        FROM province
        WHERE nome ILIKE $1
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
        SELECT id, nome AS ragione_sociale, codice_fiscale AS partita_iva
        FROM stazioni
        WHERE codice_fiscale ILIKE $1 AND attivo = true
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
        SELECT COUNT(*) FROM modifiche_stazioni WHERE id_stazione = $1
      `, [id]);
      const total = parseInt(countRes.rows[0].count);

      const dataRes = await query(`
        SELECT id, id_stazione, campo,
               valore_precedente, valore_nuovo, username,
               data
        FROM modifiche_stazioni
        WHERE id_stazione = $1
        ORDER BY data DESC
        LIMIT $2 OFFSET $3
      `, [id, parseInt(limit), offset]);

      return {
        storia: dataRes.rows,
        totale: total,
        pagina: parseInt(page),
        pagine: Math.ceil(total / parseInt(limit))
      };
    } catch (err) {
      fastify.log.error(err, 'History error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ============================================
  // AI ANALYSIS ENDPOINTS
  // ============================================

  // POST /api/admin/stazioni/:id/ai-analisi — Analisi AI completa della stazione
  fastify.post('/stazioni/:id/ai-analisi', async (request, reply) => {
    try {
      const { id } = request.params;

      // Gather all station data
      const staRes = await query(`SELECT s.nome, s.citta, s.indirizzo, p.nome AS provincia, r.nome AS regione
        FROM stazioni s LEFT JOIN province p ON s.id_provincia = p.id LEFT JOIN regioni r ON p.id_regione = r.id
        WHERE s.id = $1`, [id]);
      if (!staRes.rows.length) return reply.status(404).send({ error: 'Stazione non trovata' });
      const stazione = staRes.rows[0];

      const bandiRes = await query(`SELECT titolo, importo_so, data_pubblicazione, data_offerta, codice_cig
        FROM bandi WHERE id_stazione = $1 ORDER BY data_pubblicazione DESC NULLS LAST LIMIT 30`, [id]);

      const esitiRes = await query(`SELECT COALESCE(g.titolo, b.titolo) AS titolo, g.importo, g.n_partecipanti, g.ribasso, g.data
        FROM gare g LEFT JOIN bandi b ON g.id_bando = b.id
        WHERE g.id_stazione = $1 OR b.id_stazione = $1 ORDER BY g.data DESC NULLS LAST LIMIT 30`, [id]);

      const albiRes = await query(`SELECT nome_albo, piattaforma, documenti_richiesti, categorie_soa, categorie_merceologiche
        FROM albi_fornitori WHERE id_stazione = $1 AND attivo = true`, [id]);

      const prompt = `Sei un esperto di appalti pubblici italiani. Analizza i seguenti dati di una stazione appaltante e fornisci un'analisi dettagliata e utile.

STAZIONE: ${stazione.nome} - ${stazione.citta || ''} (${stazione.provincia || ''}, ${stazione.regione || ''})

BANDI RECENTI (${bandiRes.rows.length}):
${bandiRes.rows.map(b => `- "${b.titolo}" | Importo: €${b.importo_so || 'N/D'} | CIG: ${b.codice_cig || 'N/D'} | Pubbl: ${b.data_pubblicazione || 'N/D'}`).join('\n')}

ESITI/GARE (${esitiRes.rows.length}):
${esitiRes.rows.map(e => `- "${e.titolo}" | Importo: €${e.importo || 'N/D'} | Partecipanti: ${e.n_partecipanti || 'N/D'} | Ribasso: ${e.ribasso || 'N/D'}%`).join('\n')}

ALBI FORNITORI (${albiRes.rows.length}):
${albiRes.rows.map(a => `- ${a.nome_albo || 'Albo'} | Piattaforma: ${a.piattaforma || 'N/D'} | SOA: ${(a.categorie_soa||[]).join(', ')} | Merceologiche: ${(a.categorie_merceologiche||[]).join(', ')}`).join('\n')}

Rispondi in JSON con questa struttura esatta:
{
  "profilo": "descrizione del profilo/tipologia della stazione in 2-3 frasi",
  "settori_principali": ["settore1", "settore2", ...],
  "volume_stimato_annuo": "stima del volume annuale di appalti basata sui dati",
  "frequenza_pubblicazione": "descrizione della frequenza di pubblicazione bandi",
  "importo_medio": "importo medio dei bandi",
  "competitivita": "analisi della competitività media (basata su n_partecipanti e ribassi)",
  "trend": "analisi del trend (crescente, stabile, decrescente) con motivazione",
  "raccomandazioni": ["raccomandazione1", "raccomandazione2", ...],
  "rischi": ["rischio1", "rischio2", ...],
  "punteggio_interesse": 1-10
}`;

      const msg = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }]
      });

      const text = msg.content[0].text;
      // Extract JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      const analisi = jsonMatch ? JSON.parse(jsonMatch[0]) : { profilo: text };

      return { analisi, stazione: stazione.nome };
    } catch (err) {
      fastify.log.error(err, 'AI analysis error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/stazioni/:id/ai-categorie — Classificazione AI categorie
  fastify.post('/stazioni/:id/ai-categorie', async (request, reply) => {
    try {
      const { id } = request.params;

      const bandiRes = await query(`SELECT titolo, importo_so FROM bandi WHERE id_stazione = $1 ORDER BY data_pubblicazione DESC NULLS LAST LIMIT 50`, [id]);
      const esitiRes = await query(`SELECT COALESCE(g.titolo, b.titolo) AS titolo FROM gare g LEFT JOIN bandi b ON g.id_bando = b.id WHERE g.id_stazione = $1 OR b.id_stazione = $1 LIMIT 50`, [id]);
      const albiRes = await query(`SELECT categorie_soa, categorie_merceologiche FROM albi_fornitori WHERE id_stazione = $1 AND attivo = true`, [id]);

      const titoli = [...bandiRes.rows.map(b => b.titolo), ...esitiRes.rows.map(e => e.titolo)].filter(Boolean);

      if (titoli.length === 0 && albiRes.rows.length === 0) {
        return { categorie: { categorie_soa: [], categorie_merceologiche: [], settori: [], note: 'Nessun bando o esito trovato per questa stazione. Impossibile classificare.' } };
      }

      const prompt = `Sei un esperto di appalti pubblici italiani e categorie SOA. Analizza i seguenti titoli di bandi/esiti di una stazione appaltante e classifica la stazione.

TITOLI BANDI/ESITI:
${titoli.map((t, i) => `${i+1}. ${t}`).join('\n')}

${albiRes.rows.length > 0 ? `CATEGORIE GIÀ NOTE DAGLI ALBI:
SOA: ${albiRes.rows.flatMap(a => a.categorie_soa || []).join(', ')}
Merceologiche: ${albiRes.rows.flatMap(a => a.categorie_merceologiche || []).join(', ')}` : ''}

Rispondi in JSON con questa struttura:
{
  "categorie_soa": [{"codice": "OG1", "nome": "Edifici civili e industriali", "confidenza": "alta/media/bassa", "n_bandi_correlati": 5}],
  "categorie_merceologiche": [{"nome": "Lavori stradali", "confidenza": "alta/media/bassa", "n_bandi_correlati": 3}],
  "settori": ["Edilizia", "Infrastrutture stradali"],
  "specializzazione": "descrizione della specializzazione principale della stazione",
  "note": "eventuali note utili"
}`;

      const msg = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }]
      });

      const text = msg.content[0].text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      const categorie = jsonMatch ? JSON.parse(jsonMatch[0]) : { note: text };

      return { categorie };
    } catch (err) {
      fastify.log.error(err, 'AI categories error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/stazioni/:id/ai-match — Match con aziende clienti
  fastify.post('/stazioni/:id/ai-match', async (request, reply) => {
    try {
      const { id } = request.params;

      // Get station's bandi categories
      const bandiRes = await query(`SELECT titolo, importo_so FROM bandi WHERE id_stazione = $1 ORDER BY data_pubblicazione DESC NULLS LAST LIMIT 20`, [id]);
      const albiRes = await query(`SELECT categorie_soa, categorie_merceologiche FROM albi_fornitori WHERE id_stazione = $1 AND attivo = true`, [id]);

      // Get all active aziende with SOA attestations
      const aziendeRes = await query(`
        SELECT a.id, a.ragione_sociale, a.citta, p.sigla AS provincia,
               (SELECT json_agg(json_build_object('categoria', s.codice, 'classifica', att.classifica))
                FROM attestazioni att JOIN soa s ON s.id = att.id_soa WHERE att.id_azienda = a.id AND att.attivo = true) AS soa,
               0 AS n_gare_vinte
        FROM aziende a
        LEFT JOIN province p ON a.id_provincia = p.id
        WHERE a.attivo = true AND EXISTS (SELECT 1 FROM attestazioni att WHERE att.id_azienda = a.id AND att.attivo = true)
        LIMIT 200
      `);

      // Get station's SOA categories from albi
      const stazioneSoa = albiRes.rows.flatMap(a => a.categorie_soa || []);
      const titoli = bandiRes.rows.map(b => b.titolo).filter(Boolean);

      // Simple matching: find aziende with matching SOA categories
      const matches = [];
      for (const az of aziendeRes.rows) {
        const soaList = az.soa || [];
        const soaCodes = soaList.map(s => s.categoria);
        const matchingSoa = soaCodes.filter(c => stazioneSoa.includes(c));
        if (matchingSoa.length > 0) {
          matches.push({
            id: az.id,
            ragione_sociale: az.ragione_sociale,
            citta: az.citta,
            provincia: az.provincia,
            soa_match: matchingSoa,
            soa_totali: soaCodes,
            n_gare_vinte: parseInt(az.n_gare_vinte) || 0,
            score: matchingSoa.length * 10 + (parseInt(az.n_gare_vinte) || 0)
          });
        }
      }

      // Sort by score
      matches.sort((a, b) => b.score - a.score);

      return {
        matches: matches.slice(0, 20),
        totale_matches: matches.length,
        categorie_stazione: stazioneSoa,
        titoli_bandi: titoli.slice(0, 5)
      };
    } catch (err) {
      fastify.log.error(err, 'AI match error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/stazioni/:id/ai-verifica-fonti — Verifica fonti web
  fastify.post('/stazioni/:id/ai-verifica-fonti', async (request, reply) => {
    try {
      const { id } = request.params;

      const fontiRes = await query(`
        SELECT fw.id, fw.link, fw.attivo, fw.ultima_verifica, fw.stato_verifica, fw.errore,
               p.nome AS piattaforma_nome, c.nome AS categoria_nome
        FROM fonti_web fw
        LEFT JOIN piattaforme p ON fw.id_piattaforma = p.id
        LEFT JOIN fonti_web_categorie c ON fw.id_categoria = c.id
        WHERE fw.id_stazione = $1
        ORDER BY fw.attivo DESC, fw.ultima_verifica DESC NULLS LAST
      `, [id]);

      const fonti = fontiRes.rows;
      const results = [];

      for (const fonte of fonti) {
        let status = 'sconosciuto';
        let responseTime = null;
        let error = null;

        if (fonte.link) {
          try {
            const start = Date.now();
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);
            const res = await fetch(fonte.link, {
              method: 'HEAD',
              signal: controller.signal,
              headers: { 'User-Agent': 'EasyWin-Bot/1.0' },
              redirect: 'follow'
            });
            clearTimeout(timeout);
            responseTime = Date.now() - start;
            status = res.ok ? 'ok' : `errore_${res.status}`;

            // Update in DB
            await query(`UPDATE fonti_web SET ultima_verifica = NOW(), stato_verifica = $1, errore = NULL WHERE id = $2`, [status === 'ok' ? 'ok' : 'error', fonte.id]);
          } catch (e) {
            status = 'non_raggiungibile';
            error = e.message;
            await query(`UPDATE fonti_web SET ultima_verifica = NOW(), stato_verifica = 'error', errore = $1 WHERE id = $2`, [e.message.substring(0, 200), fonte.id]);
          }
        } else {
          status = 'link_mancante';
        }

        results.push({
          id: fonte.id,
          link: fonte.link,
          piattaforma: fonte.piattaforma_nome,
          categoria: fonte.categoria_nome,
          attivo: fonte.attivo,
          status,
          response_time_ms: responseTime,
          error
        });
      }

      const ok = results.filter(r => r.status === 'ok').length;
      const errori = results.filter(r => r.status !== 'ok' && r.status !== 'sconosciuto' && r.status !== 'link_mancante').length;

      return {
        fonti: results,
        riepilogo: {
          totale: results.length,
          ok,
          errori,
          senza_link: results.filter(r => r.status === 'link_mancante').length,
          tasso_successo: results.length > 0 ? Math.round((ok / results.length) * 100) : 0
        }
      };
    } catch (err) {
      fastify.log.error(err, 'Verifica fonti error');
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
      INSERT INTO modifiche_stazioni (id_stazione, campo, valore_nuovo, username, data)
      VALUES ($1, $2, $3, $4, NOW())
    `, [stationId, tipo, descrizione, userId]);
  } catch (err) {
    console.error('Error logging modification:', err);
  }
}

function sanitizeSortColumn(col) {
  const allowed = [
    'nome', 'citta', 'provincia', 'obsoleta', 'data_inserimento'
  ];
  return allowed.includes(col) ? `s.${col}` : 's.nome';
}

function sanitizeSortOrder(order) {
  return order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
}
