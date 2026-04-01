import { query, transaction } from '../db/pool.js';
import bcrypt from 'bcryptjs';

export default async function clientiRoutes(fastify, opts) {

  // ============================================================
  // CLIENT HOME - Dashboard
  // ============================================================
  // GET /api/clienti/home
  // Returns latest 50 bandi + 50 esiti filtered by user's regions/provinces/SOA
  fastify.get('/home', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const username = request.user.username;

      // Get user's region/province/SOA assignments
      const userRegioni = await query(
        `SELECT DISTINCT id_regione FROM users_regioni WHERE username = $1`,
        [username]
      );

      const userSoa = await query(
        `SELECT DISTINCT id_soa FROM users_soa WHERE username = $1`,
        [username]
      );

      const regioniList = userRegioni.rows.map(r => r.id_regione);
      const soaList = userSoa.rows.map(s => s.id_soa);

      if (regioniList.length === 0 && soaList.length === 0) {
        return {
          bandi_recent: [],
          esiti_recent: [],
          total_bandi: 0,
          total_esiti: 0
        };
      }

      // Build filter condition - user sees bandi if they're subscribed to the region OR the SOA
      const filterCondition = regioniList.length > 0
        ? `(b.regione = ANY($1) OR b.id_soa = ANY($2))`
        : `b.id_soa = ANY($2)`;

      // Get recent 50 bandi
      const bandiResult = await query(
        `SELECT
          b.id AS id,
          b.titolo AS titolo,
          b.codice_cig AS codice_cig,
          b.codice_cup AS codice_cup,
          b.data_pubblicazione AS data_pubblicazione,
          b.data_offerta AS data_offerta,
          b.importo_so AS importo_so,
          b.regione AS regione,
          b.provincia AS provincia,
          b.id_soa AS id_soa,
          b.stazione_nome AS stazione,
          b.annullato AS annullato
         FROM bandi b
         WHERE ${filterCondition}
           AND b.annullato = false
         ORDER BY b.data_pubblicazione DESC
         LIMIT 50`,
        [regioniList.length > 0 ? regioniList : [], soaList.length > 0 ? soaList : []]
      );

      // Get recent 50 esiti
      const esitiResult = await query(
        `SELECT
          e.id_gara AS id,
          e.numero_gara AS numero_gara,
          e.data_pubblicazione AS data_pubblicazione,
          e.regione AS regione,
          e.provincia AS provincia,
          e.id_soa AS id_soa,
          e.stazione AS stazione
         FROM gare e
         WHERE ${filterCondition}
         ORDER BY e.data_pubblicazione DESC
         LIMIT 50`,
        [regioniList.length > 0 ? regioniList : [], soaList.length > 0 ? soaList : []]
      );

      return {
        bandi_recent: bandiResult.rows,
        esiti_recent: esitiResult.rows,
        total_bandi: bandiResult.rows.length,
        total_esiti: esitiResult.rows.length
      };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'GET /home error');
      return reply.status(500).send({ error: 'Errore nel caricamento della dashboard' });
    }
  });

  // ============================================================
  // CLIENT PROFILE
  // ============================================================
  // GET /api/clienti/profilo
  fastify.get('/profilo', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const result = await query(
        `SELECT username, email, nome, cognome, azienda,
                partita_iva, codice_fiscale, citta, provincia,
                telefono, approvato, expire, expire_bandi,
                expire_presidia, data_creazione
         FROM users
         WHERE username = $1`,
        [request.user.username]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ error: 'Utente non trovato' });
      }

      const u = result.rows[0];
      return {
        username: u.username,
        email: u.email,
        nome: u.nome,
        cognome: u.cognome,
        azienda: u.azienda,
        partita_iva: u.partita_iva,
        codice_fiscale: u.codice_fiscale,
        citta: u.citta,
        provincia: u.provincia,
        telefono: u.telefono,
        approvato: u.approvato,
        scadenza_esiti: u.expire,
        scadenza_bandi: u.expire_bandi,
        scadenza_presidia: u.expire_presidia,
        data_creazione: u.data_creazione
      };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'GET /profilo error');
      return reply.status(500).send({ error: 'Errore nel recupero profilo' });
    }
  });

  // PUT /api/clienti/profilo
  // Update profile (nome, cognome, telefono, citta, provincia, etc - NOT role/subscription)
  fastify.put('/profilo', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { nome, cognome, telefono, citta, provincia, codice_fiscale } = request.body || {};

      const updateFields = [];
      const params = [request.user.username];
      let paramIdx = 2;

      if (nome !== undefined) {
        updateFields.push(`nome = $${paramIdx++}`);
        params.push(nome);
      }
      if (cognome !== undefined) {
        updateFields.push(`cognome = $${paramIdx++}`);
        params.push(cognome);
      }
      if (telefono !== undefined) {
        updateFields.push(`telefono = $${paramIdx++}`);
        params.push(telefono);
      }
      if (citta !== undefined) {
        updateFields.push(`citta = $${paramIdx++}`);
        params.push(citta);
      }
      if (provincia !== undefined) {
        updateFields.push(`provincia = $${paramIdx++}`);
        params.push(provincia);
      }
      if (codice_fiscale !== undefined) {
        updateFields.push(`codice_fiscale = $${paramIdx++}`);
        params.push(codice_fiscale);
      }

      if (updateFields.length === 0) {
        return reply.status(400).send({ error: 'Nessun campo da aggiornare' });
      }

      const result = await query(
        `UPDATE users SET ${updateFields.join(', ')} WHERE username = $1 RETURNING *`,
        params
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ error: 'Utente non trovato' });
      }

      const u = result.rows[0];
      return {
        message: 'Profilo aggiornato con successo',
        user: {
          nome: u.nome,
          cognome: u.cognome,
          telefono: u.telefono,
          citta: u.citta,
          provincia: u.provincia,
          codice_fiscale: u.codice_fiscale
        }
      };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'PUT /profilo error');
      return reply.status(500).send({ error: 'Errore aggiornamento profilo' });
    }
  });

  // POST /api/clienti/cambio-password
  fastify.post('/cambio-password', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { password_attuale, password_nuova } = request.body || {};

      if (!password_attuale || !password_nuova) {
        return reply.status(400).send({ error: 'Password attuale e nuova password richieste' });
      }

      const userResult = await query(
        `SELECT username, password_hash FROM users WHERE username = $1 LIMIT 1`,
        [request.user.username]
      );

      if (userResult.rows.length === 0) {
        return reply.status(404).send({ error: 'Utente non trovato' });
      }

      const user = userResult.rows[0];

      if (user.password_hash) {
        const passwordMatch = await bcrypt.compare(password_attuale, user.password_hash);
        if (!passwordMatch) {
          return reply.status(401).send({ error: 'Password attuale non valida' });
        }
      }

      let hashedNewPassword;
      try {
        hashedNewPassword = await bcrypt.hash(password_nuova, 10);
      } catch (hashErr) {
        fastify.log.error({ err: hashErr.message }, 'Password hash error');
        return reply.status(500).send({ error: 'Errore nel salvataggio della password' });
      }

      await query(
        `UPDATE users SET password_hash = $1 WHERE username = $2`,
        [hashedNewPassword, user.username]
      );

      return { message: 'Password aggiornata con successo' };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'POST /cambio-password error');
      return reply.status(500).send({ error: 'Errore cambio password' });
    }
  });

  // ============================================================
  // CLIENT BANDI
  // ============================================================
  // GET /api/clienti/bandi
  // Browse bandi filtered by user's subscription (regions/SOA)
  fastify.get('/bandi', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const username = request.user.username;
      const { page = 1, limit = 20, search, regione, id_soa, sort = 'DataPubblicazione', order = 'DESC' } = request.query;

      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

      // Get user's subscription filters
      const userRegioni = await query(
        `SELECT DISTINCT id_regione FROM users_regioni WHERE username = $1`,
        [username]
      );

      const userSoa = await query(
        `SELECT DISTINCT id_soa FROM users_soa WHERE username = $1`,
        [username]
      );

      const regioniList = userRegioni.rows.map(r => r.id_regione);
      const soaList = userSoa.rows.map(s => s.id_soa);

      if (regioniList.length === 0 && soaList.length === 0) {
        return { bandi: [], total: 0, page: parseInt(page), limit: parseInt(limit) };
      }

      // Build WHERE conditions
      const conditions = [
        'b.annullato = false',
        `(b.regione = ANY($1) OR b.id_soa = ANY($2))`
      ];
      const params = [regioniList.length > 0 ? regioniList : [], soaList.length > 0 ? soaList : []];
      let paramIdx = 3;

      if (search) {
        conditions.push(`(b.titolo ILIKE $${paramIdx} OR b.codice_cig ILIKE $${paramIdx})`);
        params.push(`%${search}%`);
        paramIdx++;
      }
      if (regione) {
        conditions.push(`b.regione = $${paramIdx}`);
        params.push(regione);
        paramIdx++;
      }
      if (id_soa) {
        conditions.push(`b.id_soa = $${paramIdx}`);
        params.push(id_soa);
        paramIdx++;
      }

      const whereClause = `WHERE ${conditions.join(' AND ')}`;

      // Count total
      const countResult = await query(
        `SELECT COUNT(*) as total FROM bandi b ${whereClause}`,
        params
      );
      const total = parseInt(countResult.rows[0].total);

      // Get results
      const allowedSorts = ['data_pubblicazione', 'titolo', 'importo_so'];
      const sortCol = allowedSorts.includes(sort) ? `b.${sort}` : 'b.data_pubblicazione';
      const sortOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

      const result = await query(
        `SELECT
          b.id AS id,
          b.titolo AS titolo,
          b.codice_cig AS codice_cig,
          b.data_pubblicazione AS data_pubblicazione,
          b.data_offerta AS data_offerta,
          b.importo_so AS importo_so,
          b.regione AS regione,
          b.provincia AS provincia,
          b.stazione_nome AS stazione
         FROM bandi b
         ${whereClause}
         ORDER BY ${sortCol} ${sortOrder}
         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, limit, offset]
      );

      return {
        bandi: result.rows,
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'GET /bandi error');
      return reply.status(500).send({ error: 'Errore nel caricamento bandi' });
    }
  });

  // GET /api/clienti/bandi/:id
  // Bando detail (client view)
  fastify.get('/bandi/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const username = request.user.username;

      // Check user has access to this bando
      const userRegioni = await query(
        `SELECT DISTINCT id_regione FROM users_regioni WHERE username = $1`,
        [username]
      );

      const userSoa = await query(
        `SELECT DISTINCT id_soa FROM users_soa WHERE username = $1`,
        [username]
      );

      const regioniList = userRegioni.rows.map(r => r.id_regione);
      const soaList = userSoa.rows.map(s => s.id_soa);

      const result = await query(
        `SELECT
          b.id AS id,
          b.titolo AS titolo,
          b.codice_cig AS codice_cig,
          b.codice_cup AS codice_cup,
          b.data_pubblicazione AS data_pubblicazione,
          b.data_offerta AS data_offerta,
          b.data_apertura AS data_apertura,
          b.importo_so AS importo_so,
          b.regione AS regione,
          b.provincia AS provincia,
          b.id_soa AS id_soa,
          b.stazione_nome AS stazione,
          b.id_tipologia AS id_tipologia,
          b.id_criterio AS id_criterio,
          b.descrizione_breve AS descrizione,
          b.note AS note
         FROM bandi b
         WHERE b.id = $1
           AND (b.regione = ANY($2) OR b.id_soa = ANY($3))`,
        [id, regioniList.length > 0 ? regioniList : [], soaList.length > 0 ? soaList : []]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ error: 'Bando non trovato o accesso negato' });
      }

      return result.rows[0];
    } catch (err) {
      fastify.log.error({ err: err.message }, 'GET /bandi/:id error');
      return reply.status(500).send({ error: 'Errore nel caricamento bando' });
    }
  });

  // POST /api/clienti/bandi/:id/richiedi-apertura
  // Request tender opening service
  fastify.post('/bandi/:id/richiedi-apertura', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const username = request.user.username;
      const { note } = request.body || {};

      // Check user has access to this bando (already filtered above)
      const bandiResult = await query(
        `SELECT id FROM bandi WHERE id = $1 LIMIT 1`,
        [id]
      );

      if (bandiResult.rows.length === 0) {
        return reply.status(404).send({ error: 'Bando non trovato' });
      }

      // Create service request
      const result = await query(
        `INSERT INTO richieste_servizi (
          id_bando, username, tipo_servizio, data_richiesta, note, stato
         ) VALUES ($1, $2, $3, NOW(), $4, $5)
         RETURNING *`,
        [id, username, 'APERTURA', note || null, 'PENDING']
      );

      return {
        message: 'Richiesta creata con successo',
        richiesta: result.rows[0]
      };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'POST /bandi/:id/richiedi-apertura error');
      return reply.status(500).send({ error: 'Errore nella creazione della richiesta' });
    }
  });

  // POST /api/clienti/bandi/:id/richiedi-servizi
  // Request other services
  fastify.post('/bandi/:id/richiedi-servizi', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const username = request.user.username;
      const { tipo_servizio, note } = request.body || {};

      if (!tipo_servizio) {
        return reply.status(400).send({ error: 'Tipo di servizio richiesto' });
      }

      const bandiResult = await query(
        `SELECT id FROM bandi WHERE id = $1 LIMIT 1`,
        [id]
      );

      if (bandiResult.rows.length === 0) {
        return reply.status(404).send({ error: 'Bando non trovato' });
      }

      const result = await query(
        `INSERT INTO richieste_servizi (
          id_bando, username, tipo_servizio, data_richiesta, note, stato
         ) VALUES ($1, $2, $3, NOW(), $4, $5)
         RETURNING *`,
        [id, username, tipo_servizio, note || null, 'PENDING']
      );

      return {
        message: 'Richiesta di servizio creata con successo',
        richiesta: result.rows[0]
      };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'POST /bandi/:id/richiedi-servizi error');
      return reply.status(500).send({ error: 'Errore nella creazione della richiesta' });
    }
  });

  // GET /api/clienti/bandi/registro
  // User's tender registry (saved bandi with notes)
  fastify.get('/bandi/registro', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const username = request.user.username;
      const { page = 1, limit = 20 } = request.query;

      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

      const countResult = await query(
        `SELECT COUNT(*) as total FROM registro_gare_clienti WHERE username = $1`,
        [username]
      );
      const total = parseInt(countResult.rows[0].total);

      const result = await query(
        `SELECT
          r.id AS id,
          r.id_bando AS id_bando,
          r.username AS username,
          r.note AS note,
          r.data_inserimento AS data_inserimento,
          b.titolo AS titolo_bando,
          b.codice_cig AS codice_cig,
          b.data_pubblicazione AS data_pubblicazione
         FROM registro_gare_clienti r
         JOIN bandi b ON r.id_bando = b.id
         WHERE r.username = $1
         ORDER BY r.data_inserimento DESC
         LIMIT $2 OFFSET $3`,
        [username, limit, offset]
      );

      return {
        registro: result.rows,
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'GET /bandi/registro error');
      return reply.status(500).send({ error: 'Errore nel caricamento registro' });
    }
  });

  // POST /api/clienti/bandi/:id/registro
  // Add bando to registry with notes
  fastify.post('/bandi/:id/registro', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const username = request.user.username;
      const { note } = request.body || {};

      // Check if already in registry
      const existing = await query(
        `SELECT id FROM registro_gare_clienti WHERE id_bando = $1 AND username = $2 LIMIT 1`,
        [id, username]
      );

      if (existing.rows.length > 0) {
        return reply.status(409).send({ error: 'Bando già nel registro' });
      }

      const result = await query(
        `INSERT INTO registro_gare_clienti (id_bando, username, note, data_inserimento)
         VALUES ($1, $2, $3, NOW())
         RETURNING *`,
        [id, username, note || null]
      );

      return {
        message: 'Bando aggiunto al registro',
        registro: result.rows[0]
      };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'POST /bandi/:id/registro error');
      return reply.status(500).send({ error: 'Errore aggiunta al registro' });
    }
  });

  // PUT /api/clienti/bandi/registro/:id
  // Update registry notes
  fastify.put('/bandi/registro/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const username = request.user.username;
      const { note } = request.body || {};

      const result = await query(
        `UPDATE registro_gare_clienti SET note = $1 WHERE id = $2 AND username = $3
         RETURNING *`,
        [note || null, id, username]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ error: 'Elemento registro non trovato' });
      }

      return {
        message: 'Note aggiornate',
        registro: result.rows[0]
      };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'PUT /bandi/registro/:id error');
      return reply.status(500).send({ error: 'Errore aggiornamento note' });
    }
  });

  // DELETE /api/clienti/bandi/registro/:id
  // Remove from registry
  fastify.delete('/bandi/registro/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const username = request.user.username;

      const result = await query(
        `DELETE FROM registro_gare_clienti WHERE id = $1 AND username = $2`,
        [id, username]
      );

      if (result.rowCount === 0) {
        return reply.status(404).send({ error: 'Elemento registro non trovato' });
      }

      return { message: 'Elemento rimosso dal registro' };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'DELETE /bandi/registro/:id error');
      return reply.status(500).send({ error: 'Errore rimozione dal registro' });
    }
  });

  // GET /api/clienti/bandi/registro/esporta
  // Export registry (returns JSON for frontend to handle)
  fastify.get('/bandi/registro/esporta', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const username = request.user.username;

      const result = await query(
        `SELECT
          r.id AS id,
          r.id_bando AS id_bando,
          r.note AS note,
          r.data_inserimento AS data_inserimento,
          b.titolo AS titolo_bando,
          b.codice_cig AS codice_cig,
          b.data_pubblicazione AS data_pubblicazione,
          b.regione AS regione,
          b.provincia AS provincia,
          b.importo_so AS importo_so
         FROM registro_gare_clienti r
         JOIN bandi b ON r.id_bando = b.id
         WHERE r.username = $1
         ORDER BY r.data_inserimento DESC`,
        [username]
      );

      return {
        data: result.rows,
        exported_at: new Date().toISOString(),
        count: result.rows.length
      };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'GET /bandi/registro/esporta error');
      return reply.status(500).send({ error: 'Errore esportazione registro' });
    }
  });

  // PUT /api/clienti/bandi/scritture/:id/stato
  // Update writing status (AssegnaStato)
  fastify.put('/bandi/scritture/:id/stato', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const { stato } = request.body || {};

      if (!stato) {
        return reply.status(400).send({ error: 'Stato richiesto' });
      }

      const result = await query(
        `UPDATE dettaglio_gara SET assegna_stato = $1 WHERE id = $2
         RETURNING *`,
        [stato, id]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ error: 'Scrittura non trovata' });
      }

      return {
        message: 'Stato aggiornato',
        scrittura: result.rows[0]
      };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'PUT /bandi/scritture/:id/stato error');
      return reply.status(500).send({ error: 'Errore aggiornamento stato' });
    }
  });

  // PUT /api/clienti/bandi/scritture/:id/eseguito
  // Mark as executed
  fastify.put('/bandi/scritture/:id/eseguito', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;

      const result = await query(
        `UPDATE dettaglio_gara SET eseguito = true, data_esecuzione = NOW() WHERE id = $1
         RETURNING *`,
        [id]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ error: 'Scrittura non trovata' });
      }

      return {
        message: 'Scrittura marcata come eseguita',
        scrittura: result.rows[0]
      };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'PUT /bandi/scritture/:id/eseguito error');
      return reply.status(500).send({ error: 'Errore aggiornamento' });
    }
  });

  // POST /api/clienti/bandi/crea
  // Create bando (client submission - different from admin)
  fastify.post('/bandi/crea', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const username = request.user.username;
      const {
        titolo,
        codice_cig,
        codice_cup,
        importo_so,
        regione,
        provincia,
        id_soa,
        descrizione,
        data_offerta,
        data_apertura
      } = request.body || {};

      if (!titolo || !regione) {
        return reply.status(400).send({ error: 'Titolo e regione richiesti' });
      }

      const result = await query(
        `INSERT INTO bandi (
          titolo, codice_cig, codice_cup, importo_so, regione,
          provincia, id_soa, descrizione_breve, data_offerta,
          data_apertura, data_pubblicazione, annullato, created_by,
          created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), false, $11, NOW())
         RETURNING *`,
        [
          titolo, codice_cig || null, codice_cup || null, importo_so || null,
          regione, provincia || null, id_soa || null, descrizione || null,
          data_offerta || null, data_apertura || null, username
        ]
      );

      return {
        message: 'Bando creato con successo',
        bando: result.rows[0]
      };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'POST /bandi/crea error');
      return reply.status(500).send({ error: 'Errore creazione bando' });
    }
  });

  // PUT /api/clienti/bandi/:id/modifica
  // Modify own bando
  fastify.put('/bandi/:id/modifica', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const username = request.user.username;
      const { titolo, importo_so, descrizione, data_offerta, data_apertura } = request.body || {};

      // Verify user created this bando
      const checkResult = await query(
        `SELECT id FROM bandi WHERE id = $1 AND created_by = $2 LIMIT 1`,
        [id, username]
      );

      if (checkResult.rows.length === 0) {
        return reply.status(403).send({ error: 'Non autorizzato a modificare questo bando' });
      }

      const updateFields = [];
      const params = [id];
      let paramIdx = 2;

      if (titolo !== undefined) {
        updateFields.push(`titolo = $${paramIdx++}`);
        params.push(titolo);
      }
      if (importo_so !== undefined) {
        updateFields.push(`importo_so = $${paramIdx++}`);
        params.push(importo_so);
      }
      if (descrizione !== undefined) {
        updateFields.push(`descrizione_breve = $${paramIdx++}`);
        params.push(descrizione);
      }
      if (data_offerta !== undefined) {
        updateFields.push(`data_offerta = $${paramIdx++}`);
        params.push(data_offerta);
      }
      if (data_apertura !== undefined) {
        updateFields.push(`data_apertura = $${paramIdx++}`);
        params.push(data_apertura);
      }

      if (updateFields.length === 0) {
        return reply.status(400).send({ error: 'Nessun campo da aggiornare' });
      }

      const result = await query(
        `UPDATE bandi SET ${updateFields.join(', ')} WHERE id = $1
         RETURNING *`,
        params
      );

      return {
        message: 'Bando aggiornato con successo',
        bando: result.rows[0]
      };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'PUT /bandi/:id/modifica error');
      return reply.status(500).send({ error: 'Errore aggiornamento bando' });
    }
  });

  // ============================================================
  // CLIENT ESITI
  // ============================================================
  // GET /api/clienti/esiti
  // Browse esiti filtered by subscription
  fastify.get('/esiti', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const username = request.user.username;
      const { page = 1, limit = 20, search, regione, id_soa, sort = 'DataPubblicazione', order = 'DESC' } = request.query;

      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

      // Get user's subscription filters
      const userRegioni = await query(
        `SELECT DISTINCT id_regione FROM users_regioni WHERE username = $1`,
        [username]
      );

      const userSoa = await query(
        `SELECT DISTINCT id_soa FROM users_soa WHERE username = $1`,
        [username]
      );

      const regioniList = userRegioni.rows.map(r => r.id_regione);
      const soaList = userSoa.rows.map(s => s.id_soa);

      if (regioniList.length === 0 && soaList.length === 0) {
        return { esiti: [], total: 0, page: parseInt(page), limit: parseInt(limit) };
      }

      // Build WHERE conditions
      const conditions = [
        `(g.regione = ANY($1) OR g.id_soa = ANY($2))`
      ];
      const params = [regioniList.length > 0 ? regioniList : [], soaList.length > 0 ? soaList : []];
      let paramIdx = 3;

      if (search) {
        conditions.push(`(g.numero_gara ILIKE $${paramIdx} OR g.stazione ILIKE $${paramIdx})`);
        params.push(`%${search}%`);
        paramIdx++;
      }
      if (regione) {
        conditions.push(`g.regione = $${paramIdx}`);
        params.push(regione);
        paramIdx++;
      }
      if (id_soa) {
        conditions.push(`g.id_soa = $${paramIdx}`);
        params.push(id_soa);
        paramIdx++;
      }

      const whereClause = `WHERE ${conditions.join(' AND ')}`;

      // Count total
      const countResult = await query(
        `SELECT COUNT(*) as total FROM gare g ${whereClause}`,
        params
      );
      const total = parseInt(countResult.rows[0].total);

      // Get results
      const allowedSorts = ['data_pubblicazione', 'numero_gara'];
      const sortCol = allowedSorts.includes(sort) ? `g.${sort}` : 'g.data_pubblicazione';
      const sortOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

      const result = await query(
        `SELECT
          g.id_gara AS id,
          g.numero_gara AS numero_gara,
          g.data_pubblicazione AS data_pubblicazione,
          g.regione AS regione,
          g.provincia AS provincia,
          g.stazione AS stazione,
          g.id_soa AS id_soa
         FROM gare g
         ${whereClause}
         ORDER BY ${sortCol} ${sortOrder}
         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, limit, offset]
      );

      return {
        esiti: result.rows,
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'GET /esiti error');
      return reply.status(500).send({ error: 'Errore nel caricamento esiti' });
    }
  });

  // GET /api/clienti/esiti/:id
  // Esito detail (with variante support)
  fastify.get('/esiti/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const username = request.user.username;

      // Check user has access to this esito
      const userRegioni = await query(
        `SELECT DISTINCT id_regione FROM users_regioni WHERE username = $1`,
        [username]
      );

      const userSoa = await query(
        `SELECT DISTINCT id_soa FROM users_soa WHERE username = $1`,
        [username]
      );

      const regioniList = userRegioni.rows.map(r => r.id_regione);
      const soaList = userSoa.rows.map(s => s.id_soa);

      const result = await query(
        `SELECT
          g.id_gara AS id,
          g.numero_gara AS numero_gara,
          g.data_pubblicazione AS data_pubblicazione,
          g.regione AS regione,
          g.provincia AS provincia,
          g.stazione AS stazione,
          g.id_soa AS id_soa,
          g.note AS note
         FROM gare g
         WHERE g.id_gara = $1
           AND (g.regione = ANY($2) OR g.id_soa = ANY($3))`,
        [id, regioniList.length > 0 ? regioniList : [], soaList.length > 0 ? soaList : []]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ error: 'Esito non trovato o accesso negato' });
      }

      return result.rows[0];
    } catch (err) {
      fastify.log.error({ err: err.message }, 'GET /esiti/:id error');
      return reply.status(500).send({ error: 'Errore nel caricamento esito' });
    }
  });

  // GET /api/clienti/esiti/preferiti
  // List favorite esiti
  fastify.get('/esiti/preferiti', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const username = request.user.username;

      const result = await query(
        `SELECT
          p.id AS id,
          p.id_gara AS id_gara,
          g.numero_gara AS numero_gara,
          g.data_pubblicazione AS data_pubblicazione,
          g.regione AS regione,
          p.data_aggiunta AS data_aggiunta
         FROM preferiti_esiti p
         JOIN gare g ON p.id_gara = g.id_gara
         WHERE p.username = $1
         ORDER BY p.data_aggiunta DESC`,
        [username]
      );

      return {
        preferiti: result.rows,
        total: result.rows.length
      };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'GET /esiti/preferiti error');
      return reply.status(500).send({ error: 'Errore caricamento preferiti' });
    }
  });

  // POST /api/clienti/esiti/:id/preferiti
  // Add to favorites
  fastify.post('/esiti/:id/preferiti', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const username = request.user.username;

      // Check if already favorited
      const existing = await query(
        `SELECT id FROM preferiti_esiti WHERE id_gara = $1 AND username = $2 LIMIT 1`,
        [id, username]
      );

      if (existing.rows.length > 0) {
        return reply.status(409).send({ error: 'Esito già nei preferiti' });
      }

      const result = await query(
        `INSERT INTO preferiti_esiti (id_gara, username, data_aggiunta)
         VALUES ($1, $2, NOW())
         RETURNING *`,
        [id, username]
      );

      return {
        message: 'Esito aggiunto ai preferiti',
        preferito: result.rows[0]
      };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'POST /esiti/:id/preferiti error');
      return reply.status(500).send({ error: 'Errore aggiunta preferiti' });
    }
  });

  // DELETE /api/clienti/esiti/:id/preferiti
  // Remove from favorites
  fastify.delete('/esiti/:id/preferiti', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const username = request.user.username;

      const result = await query(
        `DELETE FROM preferiti_esiti WHERE id_gara = $1 AND username = $2`,
        [id, username]
      );

      if (result.rowCount === 0) {
        return reply.status(404).send({ error: 'Esito non trovato nei preferiti' });
      }

      return { message: 'Esito rimosso dai preferiti' };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'DELETE /esiti/:id/preferiti error');
      return reply.status(500).send({ error: 'Errore rimozione preferiti' });
    }
  });

  // POST /api/clienti/esiti/:id/invia-mail
  // Send esito email (to specific company)
  fastify.post('/esiti/:id/invia-mail', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const { destinatario_email } = request.body || {};

      if (!destinatario_email) {
        return reply.status(400).send({ error: 'Email destinatario richiesta' });
      }

      // Check esito exists
      const esitoResult = await query(
        `SELECT id_gara, numero_gara FROM gare WHERE id_gara = $1 LIMIT 1`,
        [id]
      );

      if (esitoResult.rows.length === 0) {
        return reply.status(404).send({ error: 'Esito non trovato' });
      }

      // Log email send request (actual email would be sent by service layer)
      const logResult = await query(
        `INSERT INTO richieste_servizi (
          id_gara, username, tipo_servizio, data_richiesta, note, stato
         ) VALUES ($1, $2, $3, NOW(), $4, $5)
         RETURNING *`,
        [id, request.user.username, 'INVIA_EMAIL', `Destinatario: ${destinatario_email}`, 'PENDING']
      );

      return {
        message: 'Email in coda di invio',
        richiesta: logResult.rows[0]
      };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'POST /esiti/:id/invia-mail error');
      return reply.status(500).send({ error: 'Errore invio email' });
    }
  });

  // GET /api/clienti/esiti/:id/mappa
  // Get map data for esito (lat/lon)
  fastify.get('/esiti/:id/mappa', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;

      const result = await query(
        `SELECT
          id_gara AS id,
          numero_gara AS numero_gara,
          provincia AS provincia,
          regione AS regione,
          latitudine AS latitudine,
          longitudine AS longitudine
         FROM gare
         WHERE id_gara = $1 LIMIT 1`,
        [id]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ error: 'Esito non trovato' });
      }

      return result.rows[0];
    } catch (err) {
      fastify.log.error({ err: err.message }, 'GET /esiti/:id/mappa error');
      return reply.status(500).send({ error: 'Errore caricamento mappa' });
    }
  });

  // ============================================================
  // CLIENT SIMULAZIONI
  // ============================================================
  // GET /api/clienti/simulazioni
  // List user's simulations
  fastify.get('/simulazioni', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const username = request.user.username;
      const { page = 1, limit = 20 } = request.query;

      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

      const countResult = await query(
        `SELECT COUNT(*) as total FROM simulazioni WHERE created_by = $1`,
        [username]
      );
      const total = parseInt(countResult.rows[0].total);

      const result = await query(
        `SELECT
          id_simulazione AS id,
          nome_simulazione AS nome,
          id_gara AS id_gara,
          numero_partecipanti AS numero_partecipanti,
          data_creazione AS data_creazione,
          created_by AS creato_da
         FROM simulazioni
         WHERE created_by = $1
         ORDER BY data_creazione DESC
         LIMIT $2 OFFSET $3`,
        [username, limit, offset]
      );

      return {
        simulazioni: result.rows,
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'GET /simulazioni error');
      return reply.status(500).send({ error: 'Errore caricamento simulazioni' });
    }
  });

  // GET /api/clienti/simulazioni/:id
  // Simulation detail with all participants
  fastify.get('/simulazioni/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const username = request.user.username;

      // Check user created this simulation
      const simResult = await query(
        `SELECT
          id_simulazione AS id,
          nome_simulazione AS nome,
          id_gara AS id_gara,
          numero_partecipanti AS numero_partecipanti,
          data_creazione AS data_creazione,
          created_by AS creato_da
         FROM simulazioni
         WHERE id_simulazione = $1 AND created_by = $2 LIMIT 1`,
        [id, username]
      );

      if (simResult.rows.length === 0) {
        return reply.status(404).send({ error: 'Simulazione non trovata o accesso negato' });
      }

      const sim = simResult.rows[0];

      // Get participants - commented out as table doesn't exist, should be replaced with valid query
      // const partecipantiResult = await query(
      //   `SELECT *
      //    FROM simulazioni_partecipanti
      //    WHERE id_simulazione = $1
      //    ORDER BY posizione ASC`,
      //   [id]
      // );

      // Note: partecipantiResult was from non-existent table, returning empty
      return {
        simulazione: sim,
        partecipanti: []
      };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'GET /simulazioni/:id error');
      return reply.status(500).send({ error: 'Errore caricamento simulazione' });
    }
  });

  // DELETE /api/clienti/simulazioni/:id
  // Delete own simulation
  fastify.delete('/simulazioni/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const username = request.user.username;

      const result = await query(
        `DELETE FROM simulazioni WHERE id_simulazione = $1 AND created_by = $2`,
        [id, username]
      );

      if (result.rowCount === 0) {
        return reply.status(404).send({ error: 'Simulazione non trovata o accesso negato' });
      }

      return { message: 'Simulazione eliminata' };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'DELETE /simulazioni/:id error');
      return reply.status(500).send({ error: 'Errore eliminazione simulazione' });
    }
  });

  // ============================================================
  // ATI / AVVALIMENTI
  // ============================================================
  // GET /api/clienti/ati/:idGara/:idMandataria
  // ATI detail for a specific gara
  fastify.get('/ati/:idGara/:idMandataria', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { idGara, idMandataria } = request.params;

      const result = await query(
        `SELECT
          a.id_gara AS id_gara,
          a.id_mandataria AS id_mandataria,
          a.id_mandante AS id_mandante,
          a.percentuale_mandante AS percentuale_mandante,
          a.data_costituzione AS data_costituzione
         FROM ati_gare a
         WHERE a.id_gara = $1 AND a.id_mandataria = $2`,
        [idGara, idMandataria]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ error: 'ATI non trovato' });
      }

      return result.rows[0];
    } catch (err) {
      fastify.log.error({ err: err.message }, 'GET /ati/:idGara/:idMandataria error');
      return reply.status(500).send({ error: 'Errore caricamento ATI' });
    }
  });

  // GET /api/clienti/ati/esiti
  // ATI esiti between two companies
  fastify.get('/ati/esiti', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id_mandataria, id_mandante } = request.query;

      if (!id_mandataria || !id_mandante) {
        return reply.status(400).send({ error: 'id_mandataria e id_mandante richiesti' });
      }

      const result = await query(
        `SELECT DISTINCT
          g.id_gara AS id_gara,
          g.numero_gara AS numero_gara,
          g.data_pubblicazione AS data_pubblicazione,
          a.id_mandataria AS id_mandataria,
          a.id_mandante AS id_mandante
         FROM ati_gare a
         JOIN gare g ON a.id_gara = g.id_gara
         WHERE (a.id_mandataria = $1 AND a.id_mandante = $2)
            OR (a.id_mandataria = $2 AND a.id_mandante = $1)
         ORDER BY g.data_pubblicazione DESC`,
        [id_mandataria, id_mandante]
      );

      return {
        esiti: result.rows,
        total: result.rows.length
      };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'GET /ati/esiti error');
      return reply.status(500).send({ error: 'Errore caricamento esiti ATI' });
    }
  });

  // GET /api/clienti/avvalimenti/:idGara/:idAzienda
  // Avvalimento detail
  fastify.get('/avvalimenti/:idGara/:idAzienda', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { idGara, idAzienda } = request.params;

      const result = await query(
        `SELECT *
         FROM dettaglio_gara
         WHERE id_gara = $1 AND id_azienda = $2
         LIMIT 1`,
        [idGara, idAzienda]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ error: 'Avvalimento non trovato' });
      }

      return result.rows[0];
    } catch (err) {
      fastify.log.error({ err: err.message }, 'GET /avvalimenti/:idGara/:idAzienda error');
      return reply.status(500).send({ error: 'Errore caricamento avvalimento' });
    }
  });

  // GET /api/clienti/avvalimenti/esiti
  // Avvalimento esiti between companies
  fastify.get('/avvalimenti/esiti', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id_azienda_principale, id_azienda_avvalimento } = request.query;

      if (!id_azienda_principale || !id_azienda_avvalimento) {
        return reply.status(400).send({ error: 'Entrambi gli ID azienda richiesti' });
      }

      const result = await query(
        `SELECT DISTINCT
          g.id_gara AS id_gara,
          g.numero_gara AS numero_gara,
          g.data_pubblicazione AS data_pubblicazione,
          dg.id_azienda AS id_azienda
         FROM dettaglio_gara dg
         JOIN gare g ON dg.id_gara = g.id_gara
         WHERE dg.id_gara IN (
           SELECT DISTINCT id_gara FROM dettaglio_gara
           WHERE id_azienda = $1 OR id_azienda = $2
         )
         ORDER BY g.data_pubblicazione DESC`,
        [id_azienda_principale, id_azienda_avvalimento]
      );

      return {
        esiti: result.rows,
        total: result.rows.length
      };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'GET /avvalimenti/esiti error');
      return reply.status(500).send({ error: 'Errore caricamento esiti avvalimenti' });
    }
  });

  // ============================================================
  // COMPANY ANALYTICS
  // ============================================================
  // GET /api/clienti/aziende/:id
  // Company card with statistics
  fastify.get('/aziende/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;

      const result = await query(
        `SELECT
          id_azienda AS id,
          ragione_sociale AS ragione_sociale,
          partita_iva AS partita_iva,
          codice_fiscale AS codice_fiscale,
          provincia AS provincia,
          regione AS regione,
          telefono_ufficio AS telefono,
          email_ufficio AS email
         FROM aziende
         WHERE id_azienda = $1 LIMIT 1`,
        [id]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ error: 'Azienda non trovata' });
      }

      return result.rows[0];
    } catch (err) {
      fastify.log.error({ err: err.message }, 'GET /aziende/:id error');
      return reply.status(500).send({ error: 'Errore caricamento azienda' });
    }
  });

  // GET /api/clienti/aziende/:id/ribassi
  // Discount chart data (last 40, with regression)
  fastify.get('/aziende/:id/ribassi', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;

      const result = await query(
        `SELECT
          dg.id_gara AS id_gara,
          dg.ribasso AS ribasso,
          g.data_pubblicazione AS data_pubblicazione,
          dg.posizione AS posizione
         FROM dettaglio_gara dg
         JOIN gare g ON dg.id_gara = g.id_gara
         WHERE dg.id_azienda = $1 AND dg.ribasso IS NOT NULL
         ORDER BY g.data_pubblicazione DESC
         LIMIT 40`,
        [id]
      );

      // Simple regression calculation (frontend can enhance this)
      const ribassi = result.rows.map(r => parseFloat(r.ribasso) || 0);
      const avg = ribassi.length > 0 ? ribassi.reduce((a, b) => a + b) / ribassi.length : 0;

      return {
        data: result.rows,
        statistiche: {
          totale_record: result.rows.length,
          media_ribasso: avg.toFixed(2),
          min_ribasso: ribassi.length > 0 ? Math.min(...ribassi).toFixed(2) : 0,
          max_ribasso: ribassi.length > 0 ? Math.max(...ribassi).toFixed(2) : 0
        }
      };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'GET /aziende/:id/ribassi error');
      return reply.status(500).send({ error: 'Errore caricamento dati ribassi' });
    }
  });

  // GET /api/clienti/aziende/:id/risultati
  // Results breakdown chart
  fastify.get('/aziende/:id/risultati', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;

      const result = await query(
        `SELECT
          dg.posizione AS posizione,
          COUNT(*) as total
         FROM dettaglio_gara dg
         WHERE dg.id_azienda = $1
         GROUP BY dg.posizione
         ORDER BY dg.posizione ASC`,
        [id]
      );

      const breakdown = {};
      result.rows.forEach(row => {
        breakdown[`posizione_${row.posizione}`] = row.total;
      });

      return {
        posizioni: result.rows,
        breakdown
      };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'GET /aziende/:id/risultati error');
      return reply.status(500).send({ error: 'Errore caricamento risultati' });
    }
  });

  // ============================================================
  // NEWSLETTER
  // ============================================================
  // GET /api/clienti/newsletter/bandi
  // Bandi newsletter history
  fastify.get('/newsletter/bandi', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const username = request.user.username;
      const { page = 1, limit = 20 } = request.query;

      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

      const countResult = await query(
        `SELECT COUNT(*) as total FROM newsletter_invii
         WHERE username = $1 AND tipo = $2`,
        [username, 'BANDI']
      );
      const total = parseInt(countResult.rows[0].total);

      const result = await query(
        `SELECT
          id AS id,
          data_invio AS data_invio,
          numero_bandi AS numero_bandi,
          soggetto AS soggetto,
          stato_invio AS stato_invio
         FROM newsletter_invii
         WHERE username = $1 AND tipo = $2
         ORDER BY data_invio DESC
         LIMIT $3 OFFSET $4`,
        [username, 'BANDI', limit, offset]
      );

      return {
        newsletter: result.rows,
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'GET /newsletter/bandi error');
      return reply.status(500).send({ error: 'Errore caricamento newsletter bandi' });
    }
  });

  // GET /api/clienti/newsletter/esiti
  // Esiti newsletter history
  fastify.get('/newsletter/esiti', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const username = request.user.username;
      const { page = 1, limit = 20 } = request.query;

      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

      const countResult = await query(
        `SELECT COUNT(*) as total FROM newsletter_invii
         WHERE username = $1 AND tipo = $2`,
        [username, 'ESITI']
      );
      const total = parseInt(countResult.rows[0].total);

      const result = await query(
        `SELECT
          id AS id,
          data_invio AS data_invio,
          numero_esiti AS numero_esiti,
          soggetto AS soggetto,
          stato_invio AS stato_invio
         FROM newsletter_invii
         WHERE username = $1 AND tipo = $2
         ORDER BY data_invio DESC
         LIMIT $3 OFFSET $4`,
        [username, 'ESITI', limit, offset]
      );

      return {
        newsletter: result.rows,
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'GET /newsletter/esiti error');
      return reply.status(500).send({ error: 'Errore caricamento newsletter esiti' });
    }
  });

  // ============================================================
  // GEOLOCATION
  // ============================================================
  // GET /api/clienti/ultimi-bandi?lat=&lon=
  // Recent bandi near location
  fastify.get('/ultimi-bandi', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { lat, lon, raggio = 50 } = request.query;

      if (!lat || !lon) {
        return reply.status(400).send({ error: 'Latitudine e longitudine richieste' });
      }

      // Simple distance-based query (5 degree = ~555 km)
      const result = await query(
        `SELECT
          b.id AS id,
          b.titolo AS titolo,
          b.data_pubblicazione AS data_pubblicazione,
          b.latitudine AS latitudine,
          b.longitudine AS longitudine,
          b.provincia AS provincia,
          b.regione AS regione
         FROM bandi b
         WHERE b.latitudine IS NOT NULL
           AND b.longitudine IS NOT NULL
           AND ABS(b.latitudine - $1) < ($3 / 111.0)
           AND ABS(b.longitudine - $2) < ($3 / 111.0)
           AND b.annullato = false
         ORDER BY b.data_pubblicazione DESC
         LIMIT 50`,
        [parseFloat(lat), parseFloat(lon), parseFloat(raggio)]
      );

      return {
        bandi: result.rows,
        total: result.rows.length
      };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'GET /ultimi-bandi error');
      return reply.status(500).send({ error: 'Errore ricerca per geolocalizzazione' });
    }
  });

  // GET /api/clienti/ultimi-esiti?lat=&lon=
  // Recent esiti near location
  fastify.get('/ultimi-esiti', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { lat, lon, raggio = 50 } = request.query;

      if (!lat || !lon) {
        return reply.status(400).send({ error: 'Latitudine e longitudine richieste' });
      }

      const result = await query(
        `SELECT
          g.id_gara AS id,
          g.numero_gara AS numero_gara,
          g.data_pubblicazione AS data_pubblicazione,
          g.latitudine AS latitudine,
          g.longitudine AS longitudine,
          g.provincia AS provincia,
          g.regione AS regione
         FROM gare g
         WHERE g.latitudine IS NOT NULL
           AND g.longitudine IS NOT NULL
           AND ABS(g.latitudine - $1) < ($3 / 111.0)
           AND ABS(g.longitudine - $2) < ($3 / 111.0)
         ORDER BY g.data_pubblicazione DESC
         LIMIT 50`,
        [parseFloat(lat), parseFloat(lon), parseFloat(raggio)]
      );

      return {
        esiti: result.rows,
        total: result.rows.length
      };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'GET /ultimi-esiti error');
      return reply.status(500).send({ error: 'Errore ricerca esiti per geolocalizzazione' });
    }
  });

}
