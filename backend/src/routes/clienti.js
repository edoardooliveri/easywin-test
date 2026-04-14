import { query } from '../db/pool.js';
import bcrypt from 'bcryptjs';

export default async function clientiRoutes(fastify, opts) {

  // ============================================================
  // CLIENT HOME - Dashboard
  // ============================================================
  // GET /api/clienti/home
  // Returns latest 50 bandi + 50 esiti filtered by user's rules or legacy regions/SOA
  fastify.get('/home', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const username = request.user.username;

      // Get user ID
      const userIdRes = await query('SELECT id FROM users WHERE username = $1', [username]);
      if (userIdRes.rows.length === 0) return reply.status(404).send({ error: 'Utente non trovato' });
      const userId = userIdRes.rows[0].id;

      // Check if user has NEW filtri rules (utenti_filtri_bandi)
      // Table may not exist if migration 016 was not executed (DB space constraints)
      let filtriRes = { rows: [] };
      try {
        filtriRes = await query(
          'SELECT id, id_soa, province_ids, importo_min, importo_max FROM utenti_filtri_bandi WHERE id_utente = $1 AND attivo = true',
          [userId]
        );
      } catch (filtriErr) {
        // Table doesn't exist — fall through to legacy filtering
        fastify.log.debug({ err: filtriErr.message }, 'utenti_filtri_bandi not available, using legacy filters');
      }
      const hasNewFilters = filtriRes.rows.length > 0;

      let bandiResult, esitiResult;

      if (hasNewFilters) {
        // ─── NEW FILTERING: utenti_filtri_bandi rules (OR between rules) ───
        // Build dynamic WHERE from rules
        const conditions = [];
        const params = [];
        let pIdx = 1;

        for (const f of filtriRes.rows) {
          const parts = [];
          if (f.id_soa) { parts.push(`b."id_soa" = $${pIdx}`); params.push(f.id_soa); pIdx++; }
          const provIds = f.province_ids || [];
          if (provIds.length > 0) { parts.push(`EXISTS (SELECT 1 FROM bandi_province bp WHERE bp.id_bando = b.id AND bp.id_provincia = ANY($${pIdx}))`); params.push(provIds); pIdx++; }
          const minI = parseFloat(f.importo_min) || 0;
          if (minI > 0) { parts.push(`COALESCE(b."importo_so", b."importo_co", 0) >= $${pIdx}`); params.push(minI); pIdx++; }
          const maxI = parseFloat(f.importo_max) || 0;
          if (maxI > 0) { parts.push(`COALESCE(b."importo_so", b."importo_co", 0) <= $${pIdx}`); params.push(maxI); pIdx++; }
          if (parts.length > 0) conditions.push('(' + parts.join(' AND ') + ')');
        }

        const filterWhere = conditions.length > 0 ? conditions.join(' OR ') : 'TRUE';

        bandiResult = await query(
          `SELECT b.id, b.titolo, b.codice_cig, b.codice_cup,
                  b.data_pubblicazione, b.data_offerta, b.importo_so,
                  b.regione, b.id_soa,
                  b.stazione_nome AS stazione, b.annullato
           FROM bandi b
           WHERE (${filterWhere})
             AND b.annullato IS NOT TRUE
             AND (COALESCE(b.privato, 0) = 0 OR b.privato_username = $${pIdx})
           ORDER BY b.data_pubblicazione DESC
           LIMIT 50`,
          [...params, username]
        );

        // For esiti, use SOA-based matching from the same rules
        const soaIds = filtriRes.rows.map(f => f.id_soa).filter(Boolean);
        if (soaIds.length > 0) {
          esitiResult = await query(
            `SELECT e.id, e.titolo, e.data,
                    e.regione, e.id_soa, e.stazione
             FROM gare e
             WHERE e.id_soa = ANY($1)
               AND e.annullato IS NOT TRUE
               AND (COALESCE(e.privato, 0) = 0 OR e.privato_username = $2)
             ORDER BY e.data DESC
             LIMIT 50`,
            [soaIds, username]
          );
        } else {
          esitiResult = { rows: [] };
        }

      } else {
        // ─── LEGACY FILTERING: users_regioni / users_soa junction tables ───
        let regioniList = [], soaList = [];
        try {
          const userRegioni = await query('SELECT DISTINCT id_regione FROM users_regioni WHERE username = $1', [username]);
          regioniList = userRegioni.rows.map(r => r.id_regione);
        } catch (e) { /* table may not exist */ }
        try {
          const userSoa = await query('SELECT DISTINCT id_soa FROM users_soa WHERE username = $1', [username]);
          soaList = userSoa.rows.map(s => s.id_soa);
        } catch (e) { /* table may not exist */ }

        if (regioniList.length === 0 && soaList.length === 0) {
          // No filters at all — return latest bandi/esiti unfiltered
          bandiResult = await query(
            `SELECT b.id, b.titolo, b.codice_cig, b.codice_cup,
                    b.data_pubblicazione, b.data_offerta, b.importo_so,
                    b.regione, b.id_soa,
                    b.stazione_nome AS stazione, b.annullato
             FROM bandi b
             WHERE b.annullato IS NOT TRUE
             ORDER BY b.data_pubblicazione DESC
             LIMIT 50`
          );
          esitiResult = await query(
            `SELECT e.id, e.titolo, e.data,
                    e.regione, e.id_soa, e.stazione
             FROM gare e
             WHERE e.annullato IS NOT TRUE
             ORDER BY e.data DESC
             LIMIT 50`
          );
        } else {
          const filterCondition = regioniList.length > 0
            ? `(b.regione = ANY($1) OR b.id_soa = ANY($2))`
            : `b.id_soa = ANY($2)`;

          bandiResult = await query(
            `SELECT b.id, b.titolo, b.codice_cig, b.codice_cup,
                    b.data_pubblicazione, b.data_offerta, b.importo_so,
                    b.regione, b.id_soa,
                    b.stazione_nome AS stazione, b.annullato
             FROM bandi b
             WHERE ${filterCondition}
               AND b.annullato IS NOT TRUE
               AND (COALESCE(b.privato, 0) = 0 OR b.privato_username = $3)
             ORDER BY b.data_pubblicazione DESC
             LIMIT 50`,
            [regioniList.length > 0 ? regioniList : [], soaList.length > 0 ? soaList : [], username]
          );

          esitiResult = await query(
            `SELECT e.id, e.titolo, e.data,
                    e.regione, e.id_soa, e.stazione
             FROM gare e
             WHERE ${filterCondition}
               AND e.annullato IS NOT TRUE
               AND (COALESCE(e.privato, 0) = 0 OR e.privato_username = $3)
             ORDER BY e.data DESC
             LIMIT 50`,
            [regioniList.length > 0 ? regioniList : [], soaList.length > 0 ? soaList : [], username]
          );
        }
      }

      return {
        bandi_recent: bandiResult.rows,
        esiti_recent: esitiResult.rows,
        total_bandi: bandiResult.rows.length,
        total_esiti: esitiResult.rows.length,
        filter_type: hasNewFilters ? 'filtri_personalizzati' : 'legacy_regioni_soa'
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
  // Request other services — also fans out into sopralluoghi/apertura_bandi/scrittura_bandi
  // so that the requested appointments show up in Admin → Agenda Mensile.
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

      // Log generico della richiesta: schema reale del DB usa
      // (id UUID, id_bando UUID, username, richiesta TEXT, note, gestito, data_inserimento)
      let result = { rows: [{ id: null, note: 'log not persisted' }] };
      try {
        result = await query(
          `INSERT INTO richieste_servizi (id_bando, username, richiesta, note, gestito, data_inserimento)
           VALUES ($1, $2, $3, $4, false, NOW()) RETURNING *`,
          [id, username, tipo_servizio, note || null]
        );
      } catch (e) {
        fastify.log.warn({ err: e.message }, 'richieste_servizi insert failed (non-bloccante)');
      }

      // Recupera id_azienda dell'utente (necessario per inserire nelle tabelle di dominio)
      // La colonna può chiamarsi id_azienda o IDAzienda a seconda dello schema.
      let idAzienda = null;
      try {
        const uRes = await query(
          `SELECT * FROM users WHERE username = $1 LIMIT 1`,
          [username]
        );
        const u = uRes.rows[0] || {};
        idAzienda = u.id_azienda ?? u.IDAzienda ?? u.idazienda ?? null;
      } catch (_) {}

      // Se non abbiamo un id_azienda, prendiamo il primo disponibile dalle aziende
      // (scenario: utente demo o account sysadmin che richiede servizi per test)
      if (!idAzienda) {
        try {
          const az = await query(
            `SELECT id FROM aziende ORDER BY id LIMIT 1`
          );
          idAzienda = az.rows[0]?.id || null;
        } catch (e) {
          try {
            const az = await query(
              `SELECT id_azienda AS id FROM aziende ORDER BY id_azienda LIMIT 1`
            );
            idAzienda = az.rows[0]?.id || null;
          } catch (_) {}
        }
      }

      // Helper: fetch actual column names of a table from information_schema.
      // Returns a Set of lowercase names (without quotes).
      const getCols = async (tbl) => {
        try {
          const r = await query(
            `SELECT column_name FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = $1`,
            [tbl]
          );
          return new Set(r.rows.map(x => String(x.column_name).toLowerCase()));
        } catch (_) { return new Set(); }
      };

      // Helper: pick first column name that exists (case-insensitive).
      // Returns the EXACT name as found in information_schema, quoted for SQL.
      const pickCol = async (tbl, candidates) => {
        try {
          const r = await query(
            `SELECT column_name FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = $1`,
            [tbl]
          );
          const exact = new Map(r.rows.map(x => [String(x.column_name).toLowerCase(), x.column_name]));
          for (const c of candidates) {
            const lc = c.toLowerCase();
            if (exact.has(lc)) return '"' + exact.get(lc) + '"';
          }
        } catch (_) {}
        return null;
      };

      // Build a schema-agnostic INSERT for a given table using a field map
      // { logicalName: { candidates: [...], value: X, required: bool } }
      const smartInsert = async (tbl, fields) => {
        const cols = [];
        const placeholders = [];
        const args = [];
        for (const key of Object.keys(fields)) {
          const f = fields[key];
          const col = await pickCol(tbl, f.candidates);
          if (col) {
            args.push(f.value);
            cols.push(col);
            placeholders.push('$' + args.length);
          } else if (f.required) {
            throw new Error(`Nessuna colonna trovata in ${tbl} per ${key} (candidati: ${f.candidates.join(', ')})`);
          }
        }
        const sql = `INSERT INTO ${tbl} (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`;
        await query(sql, args);
      };

      // Fan-out nelle tabelle di dominio in base ai servizi selezionati
      // Il frontend manda `tipo_servizio` come lista separata da virgole con i label visibili.
      const tipo = String(tipo_servizio).toLowerCase();
      const created = { sopralluogo: null, scrittura: null, apertura: null };
      const fanoutErrors = {};

      // Fan-out eseguito comunque: se idAzienda è null proviamo un INSERT con
      // id_azienda=NULL e lasciamo che sia il DB a rifiutare. In questo modo
      // errori reali (FK, NOT NULL, colonna mancante) finiscono dentro
      // `fanout_errors` invece di essere silenziosamente saltati.
      if (true) {
        // SOPRALLUOGO
        if (/sopralluogo/.test(tipo)) {
          try {
            await smartInsert('sopralluoghi', {
              id_bando:       { candidates: ['id_bando'],                 value: id,          required: true },
              id_azienda:     { candidates: ['id_azienda', 'IDAzienda'],  value: idAzienda,   required: true },
              username:       { candidates: ['username', 'Username'],     value: username,    required: false },
              data_richiesta: { candidates: ['data_richiesta', 'DataRichiesta'], value: new Date(), required: false },
              note:           { candidates: ['note', 'Note'],             value: note || null, required: false },
              inserito_da:    { candidates: ['inserito_da', 'InseritoDa'], value: username,    required: false }
            });
            created.sopralluogo = true;
          } catch (e) {
            fanoutErrors.sopralluogo = e.message;
            fastify.log.error({ err: e.message }, 'fan-out sopralluoghi failed');
          }
        }

        // SCRITTURA GARA
        if (/scrittura\s*gara/.test(tipo)) {
          try {
            await smartInsert('scrittura_bandi', {
              id_bando:    { candidates: ['id_bando'],                 value: id,          required: true },
              id_azienda:  { candidates: ['id_azienda', 'IDAzienda'],  value: idAzienda,   required: true },
              username:    { candidates: ['username', 'Username'],     value: username,    required: false },
              note:        { candidates: ['note', 'Note'],             value: note || null, required: false },
              inserito_da: { candidates: ['inserito_da', 'InseritoDa'], value: username,    required: false }
            });
            created.scrittura = true;
          } catch (e) {
            fanoutErrors.scrittura = e.message;
            fastify.log.error({ err: e.message }, 'fan-out scrittura_bandi failed');
          }
        }

        // APERTURA — usa data_offerta del bando come data iniziale
        if (/apertura/.test(tipo)) {
          try {
            const b = await query(`SELECT data_offerta FROM bandi WHERE id = $1`, [id]);
            const dataApertura = b.rows[0]?.data_offerta || new Date();
            await smartInsert('apertura_bandi', {
              id_bando:    { candidates: ['id_bando'],                 value: id,          required: true },
              id_azienda:  { candidates: ['id_azienda', 'IDAzienda'],  value: idAzienda,   required: false },
              data:        { candidates: ['data', 'Data'],             value: dataApertura, required: true },
              username:    { candidates: ['username', 'Username'],     value: username,    required: false },
              note:        { candidates: ['note', 'Note'],             value: note || null, required: false },
              inserito_da: { candidates: ['inserito_da', 'InseritoDa'], value: username,    required: false }
            });
            created.apertura = true;
          } catch (e) {
            fanoutErrors.apertura = e.message;
            fastify.log.error({ err: e.message }, 'fan-out apertura_bandi failed');
          }
        }
      }
      if (!idAzienda) {
        fanoutErrors.global = 'Nessun id_azienda disponibile: fan-out tentato comunque con NULL';
      }

      // ------------------------------------------------------------
      // PORTAL ↔ GESTIONALE — BRIDGE 1
      // Aggiungiamo/aggiorniamo il registro bandi del cliente con una
      // nota descrittiva del servizio richiesto (richiesto dall'utente).
      // ------------------------------------------------------------
      try {
        const labels = [];
        if (created.sopralluogo) labels.push('SOPRALLUOGO');
        if (created.scrittura)   labels.push('SCRITTURA');
        if (created.apertura)    labels.push('APERTURA');
        const servizioLabel = labels.length ? labels.join(' + ') : String(tipo_servizio || '').toUpperCase();

        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const dataStr = `${pad(now.getDate())}/${pad(now.getMonth()+1)}/${now.getFullYear()}`;
        const oraStr  = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
        const regLine = `Hai richiesto ${servizioLabel} ad EasyWin il ${dataStr} alle ${oraStr}`;

        const rg = await query(
          `SELECT id, note_registro FROM registro_gare_clienti WHERE id_bando = $1 AND username = $2 LIMIT 1`,
          [id, username]
        );
        if (rg.rows.length === 0) {
          await query(
            `INSERT INTO registro_gare_clienti (id_bando, username, note_registro, data_inserimento)
             VALUES ($1, $2, $3, NOW())`,
            [id, username, regLine]
          );
        } else {
          const prev = rg.rows[0].note_registro ? String(rg.rows[0].note_registro) + '\n' : '';
          await query(
            `UPDATE registro_gare_clienti SET note_registro = $1 WHERE id = $2`,
            [prev + regLine, rg.rows[0].id]
          );
        }
      } catch (e) {
        fastify.log.warn({ err: e.message }, 'registro_gare_clienti upsert (richiedi-servizi) failed');
      }

      return {
        message: 'Richiesta di servizio creata con successo',
        richiesta: result.rows[0],
        creati: created,
        id_azienda_utente: idAzienda,
        fanout_errors: Object.keys(fanoutErrors).length ? fanoutErrors : undefined
      };
    } catch (err) {
      fastify.log.error({ err: err.message, stack: err.stack }, 'POST /bandi/:id/richiedi-servizi error');
      return reply.status(500).send({
        error: 'Errore nella creazione della richiesta',
        detail: err.message,
        code: err.code || null
      });
    }
  });

  // POST /api/clienti/bandi/:id/annulla-richiesta
  // Client cancels a previously requested service.
  // - Marks richieste_servizi row(s) as gestito/annullato
  // - Removes pending fan-out rows in sopralluoghi/apertura_bandi/scrittura_bandi
  //   for that bando + username (solo se non ancora eseguiti)
  // - Appends a note to bandi.note so l'admin lo vede nel gestionale
  fastify.post('/bandi/:id/annulla-richiesta', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const username = request.user.username;
      const { tipo } = request.body || {}; // optional: 'sopralluogo'|'scrittura'|'apertura'|undefined=tutti

      // Sanity check: bando esiste
      const b = await query(`SELECT id, note FROM bandi WHERE id = $1 LIMIT 1`, [id]);
      if (b.rows.length === 0) return reply.status(404).send({ error: 'Bando non trovato' });

      const removed = { sopralluogo: 0, scrittura: 0, apertura: 0 };
      const errs = {};

      // --- SOPRALLUOGHI (solo non eseguiti) ---
      if (!tipo || /sopralluogo/i.test(tipo)) {
        try {
          const r = await query(
            `DELETE FROM sopralluoghi
             WHERE id_bando = $1 AND username = $2
               AND COALESCE(eseguito,false) = false
               AND COALESCE(annullato,false) = false`,
            [id, username]
          );
          removed.sopralluogo = r.rowCount || 0;
        } catch (e) { errs.sopralluogo = e.message; }
      }

      // --- SCRITTURA_BANDI (solo non eseguite) ---
      if (!tipo || /scrittura/i.test(tipo)) {
        try {
          const r = await query(
            `DELETE FROM scrittura_bandi
             WHERE id_bando = $1 AND username = $2
               AND COALESCE(eseguito,false) = false`,
            [id, username]
          );
          removed.scrittura = r.rowCount || 0;
        } catch (e) { errs.scrittura = e.message; }
      }

      // --- APERTURA_BANDI (solo non eseguite) ---
      if (!tipo || /apertura/i.test(tipo)) {
        try {
          const r = await query(
            `DELETE FROM apertura_bandi
             WHERE id_bando = $1 AND username = $2
               AND COALESCE(eseguito,false) = false`,
            [id, username]
          );
          removed.apertura = r.rowCount || 0;
        } catch (e) { errs.apertura = e.message; }
      }

      // --- Marca la richiesta di servizio come gestita/annullata ---
      try {
        await query(
          `UPDATE richieste_servizi
             SET gestito = true,
                 note = COALESCE(note,'') || ' [ANNULLATA DAL CLIENTE]'
           WHERE id_bando = $1 AND username = $2 AND COALESCE(gestito,false) = false`,
          [id, username]
        );
      } catch (e) {
        fastify.log.warn({ err: e.message }, 'update richieste_servizi (annullamento) failed');
      }

      // --- Scrivi nota sul bando per l'admin del gestionale ---
      try {
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const dataStr = `${pad(now.getDate())}/${pad(now.getMonth()+1)}/${now.getFullYear()}`;
        const oraStr  = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
        const line = `Compilazione annullata da cliente (${username}) il ${dataStr} alle ${oraStr}`;
        const prev = b.rows[0].note ? String(b.rows[0].note) + '\n' : '';
        await query(`UPDATE bandi SET note = $1 WHERE id = $2`, [prev + line, id]);
      } catch (e) {
        fastify.log.warn({ err: e.message }, 'update bandi.note (annullamento) failed');
      }

      // --- Aggiorna anche il registro del cliente ---
      try {
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const dataStr = `${pad(now.getDate())}/${pad(now.getMonth()+1)}/${now.getFullYear()}`;
        const oraStr  = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
        const regLine = `Hai annullato la richiesta di servizio il ${dataStr} alle ${oraStr}`;
        const rg = await query(
          `SELECT id, note_registro FROM registro_gare_clienti WHERE id_bando = $1 AND username = $2 LIMIT 1`,
          [id, username]
        );
        if (rg.rows.length > 0) {
          const prev = rg.rows[0].note_registro ? String(rg.rows[0].note_registro) + '\n' : '';
          await query(`UPDATE registro_gare_clienti SET note_registro = $1 WHERE id = $2`,
            [prev + regLine, rg.rows[0].id]);
        }
      } catch (e) {
        fastify.log.warn({ err: e.message }, 'update registro_gare_clienti (annullamento) failed');
      }

      return {
        success: true,
        message: 'Richiesta annullata',
        removed,
        errors: Object.keys(errs).length ? errs : undefined
      };
    } catch (err) {
      fastify.log.error({ err: err.message, stack: err.stack }, 'POST /bandi/:id/annulla-richiesta error');
      return reply.status(500).send({ error: 'Errore annullamento richiesta', detail: err.message });
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

      // Stesso JOIN usato da /api/bandi, così la card del Registro Bandi
      // è identica a quella di "Bandi di Gara". Con fallback al JOIN
      // minimale se lo schema non ha alcune tabelle/colonne.
      let result;
      try {
        result = await query(
          `SELECT
            r.id,
            r.id_bando,
            r.username,
            r.note_registro AS note,
            r.data_inserimento,
            b.titolo AS titolo_bando,
            b.codice_cig AS codice_cig,
            b.data_offerta AS data_offerta,
            b.data_pubblicazione AS data_pubblicazione,
            b.importo_so AS importo_so,
            b.importo_co AS importo_co,
            b.importo_eco AS importo_eco,
            s.nome AS stazione,
            s.nome AS stazione_nome,
            s.citta AS stazione_citta,
            s.sito_web AS stazione_sito_web,
            pi.nome AS piattaforma_nome,
            p.nome AS provincia_nome,
            COALESCE(soa.codice, '')      AS soa_categoria,
            COALESCE(soa_sost.codice, '') AS soa_sostitutiva,
            COALESCE(tg.nome, '')         AS tipologia,
            COALESCE(c.nome, '')          AS criterio
           FROM registro_gare_clienti r
           LEFT JOIN bandi b          ON r.id_bando = b.id
           LEFT JOIN stazioni s       ON b.id_stazione = s.id
           LEFT JOIN piattaforme pi   ON b.id_piattaforma = pi.id
           LEFT JOIN soa              ON b.id_soa = soa.id
           LEFT JOIN soa soa_sost     ON b.categoria_sostitutiva = soa_sost.id
           LEFT JOIN tipologia_gare tg ON b.id_tipologia = tg.id
           LEFT JOIN criteri c        ON b.id_criterio = c.id
           LEFT JOIN province p       ON s.id_provincia = p.id
           WHERE r.username = $1
           ORDER BY r.data_inserimento DESC NULLS LAST
           LIMIT $2 OFFSET $3`,
          [username, limit, offset]
        );
      } catch (eJoin) {
        fastify.log.warn({ err: eJoin.message }, 'registro join esteso fallito, fallback al minimale');
        result = await query(
          `SELECT
            r.id,
            r.id_bando,
            r.username,
            r.note_registro AS note,
            r.data_inserimento,
            b.titolo AS titolo_bando,
            b.codice_cig,
            b.data_offerta,
            b.data_pubblicazione,
            b.importo_so,
            b.importo_co,
            b.importo_eco
           FROM registro_gare_clienti r
           LEFT JOIN bandi b ON r.id_bando = b.id
           WHERE r.username = $1
           ORDER BY r.data_inserimento DESC NULLS LAST
           LIMIT $2 OFFSET $3`,
          [username, limit, offset]
        );
      }

      return {
        registro: result.rows,
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      };
    } catch (err) {
      fastify.log.error({ err: err.message, stack: err.stack }, 'GET /bandi/registro error');
      return reply.status(500).send({ error: 'Errore nel caricamento registro', detail: err.message });
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
        `INSERT INTO registro_gare_clienti (id_bando, username, note_registro, data_inserimento)
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
        `UPDATE registro_gare_clienti SET note_registro = $1 WHERE id = $2 AND username = $3
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
          r.note_registro AS note,
          r.data_inserimento AS data_inserimento,
          b.titolo AS titolo_bando,
          b.codice_cig AS codice_cig,
          b.data_offerta AS data_offerta,
          b.citta AS citta,
          b.importo_so AS importo_so
         FROM registro_gare_clienti r
         LEFT JOIN bandi b ON r.id_bando = b.id
         WHERE r.username = $1
         ORDER BY r.data_inserimento DESC NULLS LAST`,
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

  // GET /api/clienti/ati/cerca?search=
  // Search companies involved in ATI relationships
  fastify.get('/ati/cerca', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { search } = request.query;
      if (!search || search.length < 3) {
        return reply.status(400).send({ error: 'Ricerca minimo 3 caratteri' });
      }

      const result = await query(
        `SELECT DISTINCT
          az.id_azienda AS id,
          az.ragione_sociale AS nome,
          az.piva AS piva,
          COUNT(DISTINCT a.id_gara) AS num_ati
         FROM aziende az
         JOIN ati_gare a ON az.id_azienda = a.id_mandataria OR az.id_azienda = a.id_mandante
         WHERE UPPER(az.ragione_sociale) LIKE UPPER($1)
         GROUP BY az.id_azienda, az.ragione_sociale, az.piva
         ORDER BY num_ati DESC
         LIMIT 20`,
        ['%' + search + '%']
      );

      return { aziende: result.rows };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'GET /ati/cerca error');
      return reply.status(500).send({ error: 'Errore ricerca ATI' });
    }
  });

  // GET /api/clienti/ati/dettaglio/:idAzienda
  // Full ATI detail for a company: composition, esiti, avvalimenti
  fastify.get('/ati/dettaglio/:idAzienda', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { idAzienda } = request.params;

      // Get ATI partners (as mandataria and as mandante)
      const composizione = await query(
        `SELECT DISTINCT
          CASE WHEN a.id_mandataria = $1 THEN 'Mandataria' ELSE 'Mandante' END AS ruolo,
          CASE WHEN a.id_mandataria = $1 THEN az2.ragione_sociale ELSE az1.ragione_sociale END AS partner_nome,
          CASE WHEN a.id_mandataria = $1 THEN az2.piva ELSE az1.piva END AS partner_piva,
          CASE WHEN a.id_mandataria = $1 THEN a.id_mandante ELSE a.id_mandataria END AS partner_id,
          a.percentuale_mandante AS percentuale,
          COUNT(DISTINCT a.id_gara) AS num_gare
         FROM ati_gare a
         JOIN aziende az1 ON a.id_mandataria = az1.id_azienda
         JOIN aziende az2 ON a.id_mandante = az2.id_azienda
         WHERE a.id_mandataria = $1 OR a.id_mandante = $1
         GROUP BY ruolo, partner_nome, partner_piva, partner_id, a.percentuale_mandante
         ORDER BY num_gare DESC
         LIMIT 50`,
        [idAzienda]
      );

      // Get esiti for this company in ATI
      const esiti = await query(
        `SELECT DISTINCT
          g.id_gara AS id_gara,
          g.data AS data,
          g.stazione AS stazione,
          g.titolo AS titolo,
          g.importo_so AS importo,
          dg.risultato AS risultato,
          dg.ribasso AS ribasso
         FROM ati_gare a
         JOIN gare g ON a.id_gara = g.id_gara
         LEFT JOIN dettaglio_gara dg ON g.id_gara = dg.id_gara AND (dg.id_azienda = $1)
         WHERE a.id_mandataria = $1 OR a.id_mandante = $1
         ORDER BY g.data DESC
         LIMIT 50`,
        [idAzienda]
      );

      // Get avvalimenti for this company
      const avvalimenti = await query(
        `SELECT DISTINCT
          az1.ragione_sociale AS azienda,
          az2.ragione_sociale AS avvalente,
          dg.specializzazione AS specializzazione,
          COUNT(DISTINCT dg.id_gara) AS num_esiti
         FROM dettaglio_gara dg
         JOIN aziende az1 ON dg.id_azienda = az1.id_azienda
         LEFT JOIN aziende az2 ON dg.id_azienda_avvalimento = az2.id_azienda
         WHERE (dg.id_azienda = $1 OR dg.id_azienda_avvalimento = $1)
           AND dg.id_azienda_avvalimento IS NOT NULL
         GROUP BY az1.ragione_sociale, az2.ragione_sociale, dg.specializzazione
         ORDER BY num_esiti DESC
         LIMIT 50`,
        [idAzienda]
      );

      // Get company info
      const azienda = await query(
        `SELECT ragione_sociale, piva FROM aziende WHERE id_azienda = $1`,
        [idAzienda]
      );

      return {
        azienda: azienda.rows[0] || {},
        composizione: composizione.rows,
        esiti: esiti.rows,
        avvalimenti: avvalimenti.rows
      };
    } catch (err) {
      fastify.log.error({ err: err.message }, 'GET /ati/dettaglio/:idAzienda error');
      return reply.status(500).send({ error: 'Errore caricamento dettaglio ATI' });
    }
  });

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
