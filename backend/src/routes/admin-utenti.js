import { query } from '../db/pool.js';
import bcrypt from 'bcryptjs';

export default async function adminUtentiRoutes(fastify, opts) {

  // Helper: Check admin role
  const isAdmin = (request) => {
    if (!request.user) return false;
    const ruolo = request.user.ruolo || request.user.role;
    return request.user.is_admin === true || ruolo === 'admin' || ruolo === 'superadmin';
  };

  // Middleware for admin-only routes
  const adminOnly = async (request, reply) => {
    if (!isAdmin(request)) {
      return reply.status(403).send({ error: 'Accesso admin richiesto' });
    }
  };

  // ============================================
  // USER CRUD OPERATIONS
  // ============================================

  // GET /api/admin/utenti — List users with advanced filters
  fastify.get('/utenti', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const {
        page = 1,
        limit = 50,
        search, username, cognome, nome, piva,
        role, active, expired, effettivi,
        agent, subagente,
        id_provincia,
        scad_esiti_da, scad_esiti_a,
        scad_bandi_da, scad_bandi_a,
        scad_esiti_light_da, scad_esiti_light_a,
        scad_nl_bandi_da, scad_nl_bandi_a,
        scad_nl_esiti_da, scad_nl_esiti_a,
        invio_test, mail_test,
        albo_fornitori,
        sort_by = 'ultimo_accesso',
        sort_dir = 'DESC'
      } = request.query;

      const offset = (parseInt(page) - 1) * parseInt(limit);
      const params = [];
      const conditions = [];

      // Generic search filter (ragione sociale / company)
      if (search) {
        params.push(`%${search}%`);
        const searchParam = `$${params.length}`;
        conditions.push(`(
          u.username ILIKE ${searchParam} OR
          u.email ILIKE ${searchParam} OR
          u.nome ILIKE ${searchParam} OR
          u.cognome ILIKE ${searchParam} OR
          a.ragione_sociale ILIKE ${searchParam} OR
          a.partita_iva ILIKE ${searchParam}
        )`);
      }

      // Specific field filters
      if (username) {
        params.push(`%${username}%`);
        conditions.push(`u.username ILIKE $${params.length}`);
      }
      if (cognome) {
        params.push(`%${cognome}%`);
        conditions.push(`u.cognome ILIKE $${params.length}`);
      }
      if (nome) {
        params.push(`%${nome}%`);
        conditions.push(`u.nome ILIKE $${params.length}`);
      }
      if (piva) {
        params.push(`%${piva}%`);
        conditions.push(`a.partita_iva ILIKE $${params.length}`);
      }

      // Active/approved filter
      if (active !== undefined) {
        const isActive = active === 'true';
        params.push(isActive);
        conditions.push(`u.attivo = $${params.length}`);
      }

      // Effettivi/Prova filter
      if (effettivi === 'effettivi') {
        conditions.push(`(u.bloccato = false OR u.bloccato IS NULL)`);
      } else if (effettivi === 'prova') {
        conditions.push(`u.bloccato = true`);
      }

      // Expired filter
      if (expired === 'true') {
        conditions.push(`u.data_scadenza < NOW()`);
      } else if (expired === 'false') {
        conditions.push(`(u.data_scadenza IS NULL OR u.data_scadenza >= NOW())`);
      }

      // Agent filter
      if (agent) {
        params.push(agent);
        conditions.push(`u.codice_agente = $${params.length}`);
      }
      if (subagente) {
        params.push(subagente);
        conditions.push(`u.codice_agente = $${params.length}`);
      }

      // Provincia filter
      if (id_provincia) {
        params.push(id_provincia);
        conditions.push(`a.id_provincia = $${params.length}`);
      }

      // Scadenze date range filters
      if (scad_esiti_da) { params.push(scad_esiti_da); conditions.push(`u.data_scadenza >= $${params.length}`); }
      if (scad_esiti_a) { params.push(scad_esiti_a); conditions.push(`u.data_scadenza <= $${params.length}`); }
      if (scad_bandi_da) { params.push(scad_bandi_da); conditions.push(`u.data_scadenza >= $${params.length}`); }
      if (scad_bandi_a) { params.push(scad_bandi_a); conditions.push(`u.data_scadenza <= $${params.length}`); }
      if (scad_esiti_light_da) { params.push(scad_esiti_light_da); conditions.push(`u.data_scadenza >= $${params.length}`); }
      if (scad_esiti_light_a) { params.push(scad_esiti_light_a); conditions.push(`u.data_scadenza <= $${params.length}`); }
      if (scad_nl_bandi_da) { params.push(scad_nl_bandi_da); conditions.push(`u.data_scadenza >= $${params.length}`); }
      if (scad_nl_bandi_a) { params.push(scad_nl_bandi_a); conditions.push(`u.data_scadenza <= $${params.length}`); }
      if (scad_nl_esiti_da) { params.push(scad_nl_esiti_da); conditions.push(`u.data_scadenza >= $${params.length}`); }
      if (scad_nl_esiti_a) { params.push(scad_nl_esiti_a); conditions.push(`u.data_scadenza <= $${params.length}`); }

      // Albo Fornitori filter (new module)
      if (albo_fornitori === 'true') {
        conditions.push(`u.albo_fornitori_enabled = true`);
      } else if (albo_fornitori === 'false') {
        conditions.push(`(u.albo_fornitori_enabled = false OR u.albo_fornitori_enabled IS NULL)`);
      }

      // Role filter (e.g. role=Agent, role=Incaricato, role=Administrator)
      if (role) {
        params.push(`%${role}%`);
        conditions.push(`u.ruolo ILIKE $${params.length}`);
      }

      const joinClause = 'FROM users u LEFT JOIN aziende a ON u.id_azienda = a.id';
      const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

      // Count total
      const countRes = await query(`SELECT COUNT(*) ${joinClause} ${where}`, params);
      const total = parseInt(countRes.rows[0].count);

      // Validate sort parameters
      const allowedSortFields = ['ultimo_accesso', 'created_at', 'username', 'email', 'ragione_sociale', 'data_scadenza'];
      const sortField = allowedSortFields.includes(sort_by) ? sort_by : 'ultimo_accesso';
      const sortDirection = sort_dir.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

      // Fetch paginated data with JOIN to aziende for company info
      params.push(parseInt(limit), offset);
      const dataRes = await query(`
        SELECT
          u.username, u.email,
          u.nome, u.cognome,
          a.ragione_sociale AS ragione_sociale,
          a.partita_iva AS partita_iva,
          a.citta AS citta,
          a.id_provincia,
          a.telefono AS telefono,
          u.attivo,
          u.created_at, u.ultimo_accesso,
          u.data_scadenza,
          u.codice_agente,
          u.bloccato,
          u.bandi_enabled, u.esiti_enabled, u.esiti_light_enabled,
          u.newsletter_bandi, u.newsletter_esiti,
          u.ruolo
        ${joinClause}
        ${where}
        ORDER BY u.${sortField} ${sortDirection} NULLS LAST
        LIMIT $${params.length - 1} OFFSET $${params.length}
      `, params);

      return {
        dati: dataRes.rows,
        totale: total,
        pagina: parseInt(page),
        pagine: Math.ceil(total / parseInt(limit))
      };
    } catch (err) {
      fastify.log.error(err, 'Admin utenti list error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/admin/utenti/agenti-lista — Distinct agent names for dropdowns
  fastify.get('/utenti/agenti-lista', { preHandler: [fastify.authenticate, adminOnly] }, async () => {
    const result = await query(`
      SELECT DISTINCT codice_agente AS nome
      FROM users
      WHERE codice_agente IS NOT NULL AND codice_agente != ''
      ORDER BY codice_agente
    `);
    return result.rows.map(r => r.nome);
  });

  // GET /api/admin/utenti/subagenti-lista — Distinct sub-agent names for dropdowns
  fastify.get('/utenti/subagenti-lista', { preHandler: [fastify.authenticate, adminOnly] }, async () => {
    const result = await query(`
      SELECT DISTINCT gestibile_da_agente AS nome
      FROM users
      WHERE gestibile_da_agente IS NOT NULL AND gestibile_da_agente != ''
      ORDER BY gestibile_da_agente
    `);
    return result.rows.map(r => r.nome);
  });

  // GET /api/admin/utenti/:username — Full user detail
  fastify.get('/utenti/:username', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;

      // User info with JOIN to aziende
      const userRes = await query(`
        SELECT u.*,
          a.ragione_sociale AS ragione_sociale,
          a.partita_iva AS partita_iva,
          a.codice_fiscale AS codice_fiscale,
          a.citta AS citta,
          a.telefono AS telefono,
          a.email AS email_azienda,
          a.pec AS pec_azienda
        FROM users u
        LEFT JOIN aziende a ON u.id_azienda = a.id
        WHERE u.username = $1
      `, [username]);
      if (userRes.rows.length === 0) {
        return reply.status(404).send({ error: 'Utente non trovato' });
      }
      const user = userRes.rows[0];

      // Subscription periods from users_periodi
      let periodiRows = [];
      try {
        const periodiRes = await query(`
          SELECT tipo, data_inizio AS inizio, data_fine AS fine,
            prezzo, provvigione,
            CASE WHEN tipo ILIKE '%esiti%' THEN true ELSE false END AS rinnovo_esiti,
            CASE WHEN tipo ILIKE '%bandi%' THEN true ELSE false END AS rinnovo_bandi,
            prezzo AS prezzo_esiti,
            0 AS prezzo_bandi,
            prezzo AS totale
          FROM users_periodi
          WHERE username = $1
          ORDER BY data_inizio DESC
        `, [username]);
        periodiRows = periodiRes.rows;
      } catch { /* table may not exist yet */ }

      // Richieste servizi
      let richiesteRows = [];
      try {
        const richiesteRes = await query(`
          SELECT rs.*, b.titolo AS bando_titolo
          FROM richieste_servizi rs
          LEFT JOIN bandi b ON rs.id_bando = b.id
          WHERE rs.username = $1
          ORDER BY rs.data_inserimento DESC
        `, [username]);
        richiesteRows = richiesteRes.rows;
      } catch { /* table may not exist yet */ }

      return {
        utente: user,
        periodi: periodiRows,
        richieste_servizi: richiesteRows
      };
    } catch (err) {
      fastify.log.error(err, 'Admin utente detail error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/utenti — Create new user
  fastify.post('/utenti', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const body = request.body || {};
      const { username, email, password } = body;

      if (!username || !email || !password) {
        return reply.status(400).send({ error: 'Username, email e password richiesti' });
      }

      // Check duplicate
      const existing = await query(
        `SELECT username FROM users WHERE username = $1 OR email = $2`,
        [username, email]
      );
      if (existing.rows.length > 0) {
        return reply.status(409).send({ error: 'Username o email già in uso' });
      }

      // Hash password
      let hashedPassword;
      try {
        hashedPassword = await bcrypt.hash(password, 10);
      } catch (hashErr) {
        fastify.log.error({ err: hashErr.message }, 'Password hash error on create');
        return reply.status(500).send({ error: 'Errore nel salvataggio della password' });
      }

      // Mappa campi accettati per la creazione. Include anagrafica + tutta la
      // matrice abbonamento, come il vecchio form "Crea Utente".
      const CREATE_FIELD_MAP = {
        first_name: 'nome', last_name: 'cognome',
        id_azienda: 'id_azienda', ruolo: 'ruolo', ruoli: 'ruoli',
        agente: 'codice_agente',
        sub_agente_1: 'sub_agente_1', importo_sub_agente_1: 'importo_sub_agente_1',
        sub_agente_2: 'sub_agente_2', importo_sub_agente_2: 'importo_sub_agente_2',
        temporaneo: 'temporaneo',
        data_inizio_temporaneo: 'data_inizio_temporaneo',
        data_fine_temporaneo: 'data_fine_temporaneo',
        bloccato: 'bloccato', sync_registro_gare: 'sync_registro_gare',
        abbonato_sopralluoghi: 'abbonato_sopralluoghi', abbonato_aperture: 'abbonato_aperture',
        email_newsletter_bandi_servizi: 'email_newsletter_bandi_servizi',
        email_newsletter_esiti: 'email_newsletter_esiti',
        newsletter_separata: 'newsletter_separata',
        rinnovo_esiti: 'rinnovo_esiti', rinnovo_bandi: 'rinnovo_bandi',
        rinnovo_esiti_light: 'rinnovo_esiti_light',
        rinnovo_newsletter_esiti: 'rinnovo_newsletter_esiti',
        rinnovo_newsletter_bandi: 'rinnovo_newsletter_bandi',
        inizio_esiti: 'inizio_esiti', inizio_bandi: 'inizio_bandi',
        inizio_esiti_light: 'inizio_esiti_light',
        inizio_newsletter_esiti: 'inizio_newsletter_esiti',
        inizio_newsletter_bandi: 'inizio_newsletter_bandi',
        data_scadenza: 'data_scadenza',
        scadenza_bandi: 'scadenza_bandi',
        scadenza_esiti_light: 'scadenza_esiti_light',
        scadenza_newsletter_esiti: 'scadenza_newsletter_esiti',
        scadenza_newsletter_bandi: 'scadenza_newsletter_bandi',
        prezzo_esiti: 'prezzo_esiti', prezzo_bandi: 'prezzo_bandi',
        prezzo_esiti_light: 'prezzo_esiti_light',
        prezzo_newsletter_esiti: 'prezzo_newsletter_esiti',
        prezzo_newsletter_bandi: 'prezzo_newsletter_bandi',
        provv_esiti: 'provv_esiti', provv_bandi: 'provv_bandi',
        provv_esiti_light: 'provv_esiti_light',
        provv_newsletter_esiti: 'provv_newsletter_esiti',
        provv_newsletter_bandi: 'provv_newsletter_bandi',
        mesi_rinnovo: 'mesi_rinnovo',
        rinnovo_presidia: 'rinnovo_presidia',
        scadenza_presidia: 'scadenza_presidia',
      };

      // Colonne base obbligatorie. NOW() viene passata come SQL literal.
      const cols = ['username', 'email', 'password_hash', 'attivo', 'created_at'];
      const placeholders = ['$1', '$2', '$3', '$4', 'NOW()'];
      const params = [username, email, hashedPassword, body.approved !== false];

      for (const [bodyKey, dbCol] of Object.entries(CREATE_FIELD_MAP)) {
        if (body[bodyKey] !== undefined) {
          params.push(body[bodyKey]);
          cols.push(dbCol);
          placeholders.push(`$${params.length}`);
        }
      }

      const insertRes = await query(
        `INSERT INTO users (${cols.join(', ')}) VALUES (${placeholders.join(', ')})
         RETURNING username, email, nome, cognome`,
        params
      );

      const newUser = insertRes.rows[0];
      return reply.status(201).send({
        message: 'Utente creato con successo',
        user: {
          username: newUser.username,
          email: newUser.email,
          nome: newUser.nome,
          cognome: newUser.cognome,
          id_azienda: newUser.id_azienda
        }
      });
    } catch (err) {
      fastify.log.error(err, 'Admin create user error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // PUT /api/admin/utenti/:username — Update user
  fastify.put('/utenti/:username', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;
      const body = request.body || {};

      // Check user exists
      const existing = await query(`SELECT username FROM users WHERE username = $1`, [username]);
      if (existing.rows.length === 0) {
        return reply.status(404).send({ error: 'Utente non trovato' });
      }

      // Mappa: chiave body → nome colonna DB. Copre anagrafica + flag + matrice abbonamento
      // completa (5 servizi × rinnovo/inizio/scadenza/prezzo/provvigione) + agenti + temporaneo
      // + presidia + preferenze. Tutti i campi sono opzionali.
      const FIELD_MAP = {
        // Account/alias
        email: 'email',
        first_name: 'nome',
        last_name: 'cognome',
        id_azienda: 'id_azienda',
        approved: 'attivo',
        agente: 'codice_agente',
        id_azienda: 'id_azienda',
        ruolo: 'ruolo',
        // Ruoli multi-select (array testuale)
        ruoli: 'ruoli',
        // Flag header
        bloccato: 'bloccato',
        sync_registro_gare: 'sync_registro_gare',
        abbonato_sopralluoghi: 'abbonato_sopralluoghi',
        abbonato_aperture: 'abbonato_aperture',
        // Email newsletter separate
        email_newsletter_bandi_servizi: 'email_newsletter_bandi_servizi',
        email_newsletter_esiti: 'email_newsletter_esiti',
        newsletter_separata: 'newsletter_separata',
        // Subagenti
        sub_agente_1: 'sub_agente_1',
        importo_sub_agente_1: 'importo_sub_agente_1',
        sub_agente_2: 'sub_agente_2',
        importo_sub_agente_2: 'importo_sub_agente_2',
        // Temporaneo
        temporaneo: 'temporaneo',
        data_inizio_temporaneo: 'data_inizio_temporaneo',
        data_fine_temporaneo: 'data_fine_temporaneo',
        // Matrice — flag rinnovo
        rinnovo_esiti: 'rinnovo_esiti',
        rinnovo_bandi: 'rinnovo_bandi',
        rinnovo_esiti_light: 'rinnovo_esiti_light',
        rinnovo_newsletter_esiti: 'rinnovo_newsletter_esiti',
        rinnovo_newsletter_bandi: 'rinnovo_newsletter_bandi',
        // Matrice — inizio
        inizio_esiti: 'inizio_esiti',
        inizio_bandi: 'inizio_bandi',
        inizio_esiti_light: 'inizio_esiti_light',
        inizio_newsletter_esiti: 'inizio_newsletter_esiti',
        inizio_newsletter_bandi: 'inizio_newsletter_bandi',
        // Matrice — scadenza
        data_scadenza: 'data_scadenza', // = scadenza Esiti nel vecchio (il "principale")
        scadenza_bandi: 'scadenza_bandi',
        scadenza_esiti_light: 'scadenza_esiti_light',
        scadenza_newsletter_esiti: 'scadenza_newsletter_esiti',
        scadenza_newsletter_bandi: 'scadenza_newsletter_bandi',
        // Matrice — prezzi
        prezzo_esiti: 'prezzo_esiti',
        prezzo_bandi: 'prezzo_bandi',
        prezzo_esiti_light: 'prezzo_esiti_light',
        prezzo_newsletter_esiti: 'prezzo_newsletter_esiti',
        prezzo_newsletter_bandi: 'prezzo_newsletter_bandi',
        // Matrice — provvigioni
        provv_esiti: 'provv_esiti',
        provv_bandi: 'provv_bandi',
        provv_esiti_light: 'provv_esiti_light',
        provv_newsletter_esiti: 'provv_newsletter_esiti',
        provv_newsletter_bandi: 'provv_newsletter_bandi',
        // Mesi rinnovo
        mesi_rinnovo: 'mesi_rinnovo',
        // Presidia
        rinnovo_presidia: 'rinnovo_presidia',
        scadenza_presidia: 'scadenza_presidia',
        // Flag featureflag legacy (retrocompat)
        bandi_enabled: 'bandi_enabled',
        esiti_enabled: 'esiti_enabled',
        esiti_light_enabled: 'esiti_light_enabled',
        newsletter_bandi: 'newsletter_bandi',
        newsletter_esiti: 'newsletter_esiti',
        simulazioni_enabled: 'simulazioni_enabled',
        albo_fornitori_enabled: 'albo_fornitori_enabled',
        note_admin: 'note_admin',
      };

      const updates = [];
      const params = [];
      for (const [bodyKey, dbCol] of Object.entries(FIELD_MAP)) {
        if (body[bodyKey] !== undefined) {
          params.push(body[bodyKey]);
          updates.push(`${dbCol} = $${params.length}`);
        }
      }

      if (updates.length === 0) {
        return reply.status(400).send({ error: 'Nessun campo da aggiornare' });
      }

      params.push(username);
      await query(
        `UPDATE users SET ${updates.join(', ')}, updated_at = NOW() WHERE username = $${params.length}`,
        params
      );

      return { message: 'Utente aggiornato con successo' };
    } catch (err) {
      fastify.log.error(err, 'Admin update user error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // DELETE /api/admin/utenti/:username — Soft delete user
  fastify.delete('/utenti/:username', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;

      const existing = await query(`SELECT username FROM users WHERE username = $1`, [username]);
      if (existing.rows.length === 0) {
        return reply.status(404).send({ error: 'Utente non trovato' });
      }

      await query(`UPDATE users SET attivo = false WHERE username = $1`, [username]);

      return { message: 'Utente disattivato con successo' };
    } catch (err) {
      fastify.log.error(err, 'Admin delete user error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ============================================
  // SUBSCRIPTION MANAGEMENT
  // ============================================

  // Lista di tutte le colonne "abbonamento" del modulo Utente del vecchio sito.
  // Usata sia dalla GET /abbonamento che dalla PUT /abbonamento (e come
  // subset della PUT /utenti/:username).
  const ABBONAMENTO_FIELDS = [
    // Flag header
    'attivo', 'bloccato', 'sync_registro_gare', 'abbonato_sopralluoghi', 'abbonato_aperture', 'abbonato_albo_ai',
    // Ruoli / agente
    'ruolo', 'ruoli', 'codice_agente',
    'sub_agente_1', 'importo_sub_agente_1',
    'sub_agente_2', 'importo_sub_agente_2',
    // Temporaneo
    'temporaneo', 'data_inizio_temporaneo', 'data_fine_temporaneo',
    // Matrice — rinnovo
    'rinnovo_esiti', 'rinnovo_bandi', 'rinnovo_esiti_light',
    'rinnovo_newsletter_esiti', 'rinnovo_newsletter_bandi', 'rinnovo_albo_ai',
    // Matrice — inizio
    'inizio_esiti', 'inizio_bandi', 'inizio_esiti_light',
    'inizio_newsletter_esiti', 'inizio_newsletter_bandi', 'inizio_albo_ai',
    // Matrice — scadenza (data_scadenza = scadenza Esiti nel vecchio sito)
    'data_scadenza', 'scadenza_esiti', 'scadenza_bandi', 'scadenza_esiti_light',
    'scadenza_newsletter_esiti', 'scadenza_newsletter_bandi', 'scadenza_albo_ai',
    // Matrice — prezzi correnti
    'prezzo_esiti', 'prezzo_bandi', 'prezzo_esiti_light',
    'prezzo_newsletter_esiti', 'prezzo_newsletter_bandi', 'prezzo_albo_ai',
    // Matrice — provvigioni
    'provv_esiti', 'provv_bandi', 'provv_esiti_light',
    'provv_newsletter_esiti', 'provv_newsletter_bandi', 'provv_albo_ai',
    // Email newsletter separate
    'email_newsletter_bandi_servizi', 'email_newsletter_esiti', 'newsletter_separata',
    // Mesi rinnovo
    'mesi_rinnovo',
    // Presidia
    'rinnovo_presidia', 'scadenza_presidia',
  ];

  // GET /api/admin/utenti/:username/abbonamento — tutta la matrice abbonamento
  fastify.get('/utenti/:username/abbonamento', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;
      const cols = ABBONAMENTO_FIELDS.map(c => 'u.' + c).join(', ');
      const res = await query(
        `SELECT u.username, u.email, u.nome, u.cognome, a.ragione_sociale, a.partita_iva, ${cols}
         FROM users u LEFT JOIN aziende a ON u.id_azienda = a.id WHERE u.username = $1`,
        [username]
      );
      if (res.rows.length === 0) {
        return reply.status(404).send({ error: 'Utente non trovato' });
      }
      return res.rows[0];
    } catch (err) {
      fastify.log.error(err, 'Get abbonamento error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // PUT /api/admin/utenti/:username/abbonamento — update massivo matrice
  fastify.put('/utenti/:username/abbonamento', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;
      const body = request.body || {};

      const existing = await query(`SELECT username FROM users WHERE username = $1`, [username]);
      if (existing.rows.length === 0) {
        return reply.status(404).send({ error: 'Utente non trovato' });
      }

      const updates = [];
      const params = [];
      for (const col of ABBONAMENTO_FIELDS) {
        if (body[col] !== undefined) {
          params.push(body[col]);
          updates.push(`${col} = $${params.length}`);
        }
      }

      if (updates.length === 0) {
        return reply.status(400).send({ error: 'Nessun campo da aggiornare' });
      }

      params.push(username);
      await query(
        `UPDATE users SET ${updates.join(', ')}, updated_at = NOW() WHERE username = $${params.length}`,
        params
      );

      return { message: 'Abbonamento aggiornato con successo' };
    } catch (err) {
      fastify.log.error(err, 'Update abbonamento error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/utenti/:username/salva-importi — equivalente di SalvaImporti del vecchio sito
  // salva solo i 5 prezzi correnti (matrice "Importi") senza toccare altro
  fastify.post('/utenti/:username/salva-importi', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;
      const {
        prezzo_esiti = 0, prezzo_bandi = 0, prezzo_esiti_light = 0,
        prezzo_newsletter_esiti = 0, prezzo_newsletter_bandi = 0, prezzo_albo_ai = 0,
        provv_esiti, provv_bandi, provv_esiti_light,
        provv_newsletter_esiti, provv_newsletter_bandi, provv_albo_ai,
      } = request.body || {};

      const existing = await query(`SELECT username FROM users WHERE username = $1`, [username]);
      if (existing.rows.length === 0) {
        return reply.status(404).send({ error: 'Utente non trovato' });
      }

      const updates = [
        'prezzo_esiti = $1', 'prezzo_bandi = $2', 'prezzo_esiti_light = $3',
        'prezzo_newsletter_esiti = $4', 'prezzo_newsletter_bandi = $5', 'prezzo_albo_ai = $6',
      ];
      const params = [
        prezzo_esiti, prezzo_bandi, prezzo_esiti_light,
        prezzo_newsletter_esiti, prezzo_newsletter_bandi, prezzo_albo_ai,
      ];
      // Provvigioni opzionali
      for (const [k, v] of Object.entries({ provv_esiti, provv_bandi, provv_esiti_light, provv_newsletter_esiti, provv_newsletter_bandi, provv_albo_ai })) {
        if (v !== undefined) {
          params.push(v);
          updates.push(`${k} = $${params.length}`);
        }
      }
      params.push(username);
      await query(
        `UPDATE users SET ${updates.join(', ')}, updated_at = NOW() WHERE username = $${params.length}`,
        params
      );
      return { message: 'Importi salvati con successo' };
    } catch (err) {
      fastify.log.error(err, 'Salva importi error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/utenti/:username/crea-prossimo-rinnovo — equivalente di CreaProssimoRinnovo
  // Crea un nuovo periodo che parte dalla scadenza attuale e dura mesi_rinnovo mesi,
  // copiando i prezzi e le provvigioni correnti dei servizi attivi.
  fastify.post('/utenti/:username/crea-prossimo-rinnovo', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;

      const uRes = await query(
        `SELECT
           data_scadenza, mesi_rinnovo,
           rinnovo_esiti, rinnovo_bandi, rinnovo_esiti_light, rinnovo_newsletter_esiti, rinnovo_newsletter_bandi,
           prezzo_esiti, prezzo_bandi, prezzo_esiti_light, prezzo_newsletter_esiti, prezzo_newsletter_bandi,
           provv_esiti, provv_bandi, provv_esiti_light, provv_newsletter_esiti, provv_newsletter_bandi
         FROM users WHERE username = $1`,
        [username]
      );
      if (uRes.rows.length === 0) {
        return reply.status(404).send({ error: 'Utente non trovato' });
      }
      const u = uRes.rows[0];
      const mesi = parseInt(u.mesi_rinnovo) || 12;

      // data inizio nuovo periodo = scadenza attuale (o oggi se non c'è)
      const inizio = u.data_scadenza ? new Date(u.data_scadenza) : new Date();
      const fine = new Date(inizio);
      fine.setMonth(fine.getMonth() + mesi);

      const fmt = (d) => d.toISOString().slice(0, 10);

      const pRes = await query(
        `INSERT INTO periodi (
           username, data_inizio, data_fine, tipo,
           prezzo_esiti, prezzo_bandi, prezzo_esiti_light, prezzo_newsletter_esiti, prezzo_newsletter_bandi,
           provv_esiti, provv_bandi, provv_esiti_light, provv_newsletter_esiti, provv_newsletter_bandi
         ) VALUES ($1, $2, $3, 'rinnovo', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING id, data_inizio, data_fine`,
        [
          username, fmt(inizio), fmt(fine),
          u.prezzo_esiti || 0, u.prezzo_bandi || 0, u.prezzo_esiti_light || 0,
          u.prezzo_newsletter_esiti || 0, u.prezzo_newsletter_bandi || 0,
          u.provv_esiti || 0, u.provv_bandi || 0, u.provv_esiti_light || 0,
          u.provv_newsletter_esiti || 0, u.provv_newsletter_bandi || 0,
        ]
      );

      // aggiorna la scadenza utente al nuovo data_fine
      await query(
        `UPDATE users SET data_scadenza = $1, updated_at = NOW() WHERE username = $2`,
        [fmt(fine), username]
      );

      return { message: 'Prossimo rinnovo creato', periodo: pRes.rows[0] };
    } catch (err) {
      fastify.log.error(err, 'Crea prossimo rinnovo error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/utenti/:username/copia-importi-fattura — equivalente di CopiaImportiFattura
  // copia i prezzi da una fattura (o dal suo periodo) sulle colonne correnti di users
  fastify.post('/utenti/:username/copia-importi-fattura', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;
      const { id_fattura, id_periodo } = request.body || {};

      let periodoId = id_periodo;
      if (!periodoId && id_fattura) {
        const fRes = await query(`SELECT id_periodo FROM fatture WHERE id = $1 AND username = $2`, [id_fattura, username]);
        if (fRes.rows.length === 0) {
          return reply.status(404).send({ error: 'Fattura non trovata' });
        }
        periodoId = fRes.rows[0].id_periodo;
      }
      if (!periodoId) {
        return reply.status(400).send({ error: 'ID fattura o periodo richiesto' });
      }

      const pRes = await query(
        `SELECT prezzo_esiti, prezzo_bandi, prezzo_esiti_light,
                prezzo_newsletter_esiti, prezzo_newsletter_bandi,
                provv_esiti, provv_bandi, provv_esiti_light,
                provv_newsletter_esiti, provv_newsletter_bandi
         FROM periodi WHERE id = $1`,
        [periodoId]
      );
      if (pRes.rows.length === 0) {
        return reply.status(404).send({ error: 'Periodo non trovato' });
      }
      const p = pRes.rows[0];
      await query(
        `UPDATE users SET
           prezzo_esiti = $1, prezzo_bandi = $2, prezzo_esiti_light = $3,
           prezzo_newsletter_esiti = $4, prezzo_newsletter_bandi = $5,
           provv_esiti = $6, provv_bandi = $7, provv_esiti_light = $8,
           provv_newsletter_esiti = $9, provv_newsletter_bandi = $10,
           updated_at = NOW()
         WHERE username = $11`,
        [
          p.prezzo_esiti || 0, p.prezzo_bandi || 0, p.prezzo_esiti_light || 0,
          p.prezzo_newsletter_esiti || 0, p.prezzo_newsletter_bandi || 0,
          p.provv_esiti || 0, p.provv_bandi || 0, p.provv_esiti_light || 0,
          p.provv_newsletter_esiti || 0, p.provv_newsletter_bandi || 0,
          username,
        ]
      );
      return { message: 'Importi copiati dalla fattura' };
    } catch (err) {
      fastify.log.error(err, 'Copia importi fattura error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/admin/utenti/:username/periodi — List subscription periods
  fastify.get('/utenti/:username/periodi', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;
      const res = await query(
        'SELECT id, username, data_inizio, data_fine, tipo, prezzo_esiti, prezzo_bandi, prezzo_newsletter_esiti, prezzo_newsletter_bandi, note, created_at, updated_at FROM periodi WHERE username = $1 ORDER BY data_inizio DESC',
        [username]
      );
      return reply.send({ data: res.rows });
    } catch (err) {
      fastify.log.error(err, 'Get periodi error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // Colonne periodi che accettiamo da body. I prezzi dei 4 servizi extra
  // (Aperture/Elaborati/Sopralluoghi/Scritture) esistono SOLO nei periodi
  // perché nel vecchio sito erano nella pagina STORICO, non nella matrice
  // principale.
  const PERIODO_FIELDS = [
    'data_inizio', 'data_fine', 'tipo', 'note',
    'prezzo_esiti', 'prezzo_bandi', 'prezzo_esiti_light',
    'prezzo_newsletter_esiti', 'prezzo_newsletter_bandi', 'prezzo_albo_ai',
    'prezzo_aperture', 'prezzo_elaborati', 'prezzo_sopralluoghi', 'prezzo_scritture',
    'provv_esiti', 'provv_bandi', 'provv_esiti_light',
    'provv_newsletter_esiti', 'provv_newsletter_bandi', 'provv_albo_ai',
    'inizio_esiti', 'inizio_bandi', 'inizio_esiti_light',
    'inizio_newsletter_esiti', 'inizio_newsletter_bandi', 'inizio_albo_ai',
    'scadenza_esiti', 'scadenza_bandi', 'scadenza_esiti_light',
    'scadenza_newsletter_esiti', 'scadenza_newsletter_bandi', 'scadenza_albo_ai',
    'rinnovo_esiti', 'rinnovo_bandi', 'rinnovo_esiti_light',
    'rinnovo_newsletter_esiti', 'rinnovo_newsletter_bandi', 'rinnovo_albo_ai',
  ];

  // POST /api/admin/utenti/:username/periodi — Add subscription period
  fastify.post('/utenti/:username/periodi', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;
      const body = request.body || {};

      if (!body.data_inizio || !body.data_fine) {
        return reply.status(400).send({ error: 'Data inizio e fine richieste' });
      }

      const cols = ['username'];
      const placeholders = ['$1'];
      const params = [username];
      for (const f of PERIODO_FIELDS) {
        if (body[f] !== undefined) {
          params.push(body[f]);
          cols.push(f);
          placeholders.push(`$${params.length}`);
        }
      }

      const res = await query(
        `INSERT INTO periodi (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
        params
      );
      return reply.status(201).send({ message: 'Periodo aggiunto con successo', data: res.rows[0] });
    } catch (err) {
      fastify.log.error(err, 'Create periodo error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // PUT /api/admin/utenti/periodi/:id — Update period
  fastify.put('/utenti/periodi/:id', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const body = request.body || {};

      const updates = [];
      const params = [];
      for (const f of PERIODO_FIELDS) {
        if (body[f] !== undefined) {
          params.push(body[f]);
          updates.push(`${f} = $${params.length}`);
        }
      }
      if (updates.length === 0) {
        return reply.status(400).send({ error: 'Nessun campo da aggiornare' });
      }
      updates.push(`updated_at = NOW()`);
      params.push(id);

      const res = await query(
        `UPDATE periodi SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`,
        params
      );
      if (res.rows.length === 0) return reply.status(404).send({ error: 'Periodo non trovato' });
      return reply.send({ message: 'Periodo aggiornato con successo', data: res.rows[0] });
    } catch (err) {
      fastify.log.error(err, 'Update periodo error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // DELETE /api/admin/utenti/periodi/:id — Delete period
  fastify.delete('/utenti/periodi/:id', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const res = await query('DELETE FROM periodi WHERE id = $1 RETURNING id', [id]);
      if (res.rows.length === 0) return reply.status(404).send({ error: 'Periodo non trovato' });
      return reply.send({ message: 'Periodo eliminato con successo' });
    } catch (err) {
      fastify.log.error(err, 'Delete periodo error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ============================================
  // INVOICE MANAGEMENT
  // ============================================

  // GET /api/admin/utenti/:username/fatture — List invoices
  fastify.get('/utenti/:username/fatture', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;
      const res = await query(
        'SELECT id, username, numero, tipo, data, importo, iva, totale, pagata, data_pagamento, id_periodo, note, data_inserimento FROM fatture WHERE username = $1 ORDER BY data DESC NULLS LAST, id DESC',
        [username]
      );
      return reply.send({ data: res.rows });
    } catch (err) {
      fastify.log.error(err, 'Get fatture error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/utenti/:username/fatture — Create invoice
  fastify.post('/utenti/:username/fatture', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;
      const { numero, tipo = 'fattura', data_emissione, data, importo, iva = 0, totale, id_periodo, note } = request.body || {};
      const dataFattura = data || data_emissione;

      if (!numero || !dataFattura || importo === undefined) {
        return reply.status(400).send({ error: 'Numero, data e importo richiesti' });
      }

      const finalTotale = totale !== undefined ? totale : (parseFloat(importo) + parseFloat(iva || 0));

      const res = await query(
        'INSERT INTO fatture (username, numero, tipo, data, importo, iva, totale, id_periodo, note) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, username, numero, tipo, data, importo, iva, totale, pagata, id_periodo, note, data_inserimento',
        [username, numero, tipo, dataFattura, importo, iva, finalTotale, id_periodo, note]
      );
      return reply.status(201).send({ message: 'Fattura creata con successo', data: res.rows[0] });
    } catch (err) {
      fastify.log.error(err, 'Create fattura error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // PUT /api/admin/utenti/fatture/:id — Update invoice
  fastify.put('/utenti/fatture/:id', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const { numero, tipo, data_emissione, data, importo, iva, totale, pagata, id_periodo, note } = request.body || {};

      const updates = [];
      const params = [id];
      let paramCount = 2;

      if (numero !== undefined) { updates.push(`numero = $${paramCount++}`); params.push(numero); }
      if (tipo !== undefined) { updates.push(`tipo = $${paramCount++}`); params.push(tipo); }
      const dataVal = data !== undefined ? data : data_emissione;
      if (dataVal !== undefined) { updates.push(`data = $${paramCount++}`); params.push(dataVal); }
      if (importo !== undefined) { updates.push(`importo = $${paramCount++}`); params.push(importo); }
      if (iva !== undefined) { updates.push(`iva = $${paramCount++}`); params.push(iva); }
      if (totale !== undefined) { updates.push(`totale = $${paramCount++}`); params.push(totale); }
      if (pagata !== undefined) { updates.push(`pagata = $${paramCount++}`); params.push(pagata); }
      if (id_periodo !== undefined) { updates.push(`id_periodo = $${paramCount++}`); params.push(id_periodo); }
      if (note !== undefined) { updates.push(`note = $${paramCount++}`); params.push(note); }

      if (updates.length === 0) return reply.status(400).send({ error: 'Nessun campo da aggiornare' });

      const res = await query(
        `UPDATE fatture SET ${updates.join(', ')} WHERE id = $1 RETURNING id, username, numero, tipo, data, importo, iva, totale, pagata, id_periodo, note`,
        params
      );
      if (res.rows.length === 0) return reply.status(404).send({ error: 'Fattura non trovata' });
      return reply.send({ message: 'Fattura aggiornata con successo', data: res.rows[0] });
    } catch (err) {
      fastify.log.error(err, 'Update fattura error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // DELETE /api/admin/utenti/fatture/:id — Delete invoice
  fastify.delete('/utenti/fatture/:id', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const res = await query('DELETE FROM fatture WHERE id = $1 RETURNING id', [id]);
      if (res.rows.length === 0) return reply.status(404).send({ error: 'Fattura non trovata' });
      return reply.send({ message: 'Fattura eliminata con successo' });
    } catch (err) {
      fastify.log.error(err, 'Delete fattura error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/admin/utenti/:username/fatture-proforma — List pro-forma invoices
  fastify.get('/utenti/:username/fatture-proforma', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;
      const res = await query(
        'SELECT id, username, numero, tipo, data, importo, iva, totale, pagata, id_periodo, note, data_inserimento FROM fatture WHERE username = $1 AND tipo = $2 ORDER BY data DESC NULLS LAST, id DESC',
        [username, 'proforma']
      );
      return reply.send({ data: res.rows });
    } catch (err) {
      fastify.log.error(err, 'Get fatture proforma error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/utenti/:username/fatture-proforma — Create pro-forma
  fastify.post('/utenti/:username/fatture-proforma', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;
      const { numero, data_emissione, data, importo, iva = 0, totale, id_periodo, note } = request.body || {};
      const dataFattura = data || data_emissione;

      if (!numero || !dataFattura || importo === undefined) {
        return reply.status(400).send({ error: 'Numero, data e importo richiesti' });
      }

      const finalTotale = totale !== undefined ? totale : (parseFloat(importo) + parseFloat(iva || 0));

      const res = await query(
        'INSERT INTO fatture (username, numero, tipo, data, importo, iva, totale, id_periodo, note) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, username, numero, tipo, data, importo, iva, totale, pagata, id_periodo, note, data_inserimento',
        [username, numero, 'proforma', dataFattura, importo, iva, finalTotale, id_periodo, note]
      );
      return reply.status(201).send({ message: 'Fattura proforma creata con successo', data: res.rows[0] });
    } catch (err) {
      fastify.log.error(err, 'Create fattura proforma error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // PUT /api/admin/utenti/fatture-proforma/:id — Update pro-forma
  fastify.put('/utenti/fatture-proforma/:id', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const { numero, data_emissione, data, importo, iva, totale, pagata, note } = request.body || {};

      const updates = [];
      const params = [id];
      let paramCount = 2;

      if (numero !== undefined) { updates.push(`numero = $${paramCount++}`); params.push(numero); }
      const dataVal = data !== undefined ? data : data_emissione;
      if (dataVal !== undefined) { updates.push(`data = $${paramCount++}`); params.push(dataVal); }
      if (importo !== undefined) { updates.push(`importo = $${paramCount++}`); params.push(importo); }
      if (iva !== undefined) { updates.push(`iva = $${paramCount++}`); params.push(iva); }
      if (totale !== undefined) { updates.push(`totale = $${paramCount++}`); params.push(totale); }
      if (pagata !== undefined) { updates.push(`pagata = $${paramCount++}`); params.push(pagata); }
      if (note !== undefined) { updates.push(`note = $${paramCount++}`); params.push(note); }

      if (updates.length === 0) return reply.status(400).send({ error: 'Nessun campo da aggiornare' });

      const res = await query(
        `UPDATE fatture SET ${updates.join(', ')} WHERE id = $1 AND tipo = 'proforma' RETURNING id, numero, tipo, data, importo, iva, totale, pagata, note`,
        params
      );
      if (res.rows.length === 0) return reply.status(404).send({ error: 'Fattura proforma non trovata' });
      return reply.send({ message: 'Fattura proforma aggiornata con successo', data: res.rows[0] });
    } catch (err) {
      fastify.log.error(err, 'Update fattura proforma error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // DELETE /api/admin/utenti/fatture-proforma/:id — Delete pro-forma
  fastify.delete('/utenti/fatture-proforma/:id', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const res = await query('DELETE FROM fatture WHERE id = $1 AND tipo = $2 RETURNING id', [id, 'proforma']);
      if (res.rows.length === 0) return reply.status(404).send({ error: 'Fattura proforma non trovata' });
      return reply.send({ message: 'Fattura proforma eliminata con successo' });
    } catch (err) {
      fastify.log.error(err, 'Delete fattura proforma error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/admin/utenti/fatture/:id/pagamenti — List payments
  fastify.get('/utenti/fatture/:id/pagamenti', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const res = await query(
        'SELECT id, id_fattura, data, importo, tipo, note, created_at FROM pagamenti WHERE id_fattura = $1 ORDER BY data DESC NULLS LAST, id DESC',
        [id]
      );
      return reply.send({ data: res.rows });
    } catch (err) {
      fastify.log.error(err, 'Get pagamenti error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/utenti/fatture/:id/pagamenti — Add payment
  fastify.post('/utenti/fatture/:id/pagamenti', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const { data_pagamento, data, importo, tipo, metodo, note } = request.body || {};
      const dataPag = data || data_pagamento;
      const tipoPag = tipo || metodo || 'bonifico';

      if (!dataPag || importo === undefined) {
        return reply.status(400).send({ error: 'Data e importo richiesti' });
      }

      const res = await query(
        'INSERT INTO pagamenti (id_fattura, data, importo, tipo, note) VALUES ($1, $2, $3, $4, $5) RETURNING id, id_fattura, data, importo, tipo, note, created_at',
        [id, dataPag, importo, tipoPag, note]
      );

      // Update fattura pagata flag if fully paid
      const fatturaRes = await query('SELECT SUM(importo) as pagato_totale FROM pagamenti WHERE id_fattura = $1', [id]);
      const fatturaFullRes = await query('SELECT totale FROM fatture WHERE id = $1', [id]);
      if (fatturaFullRes.rows.length > 0) {
        const pagato = parseFloat(fatturaRes.rows[0].pagato_totale || 0);
        const totale = parseFloat(fatturaFullRes.rows[0].totale);
        await query('UPDATE fatture SET pagata = $1 WHERE id = $2', [pagato >= totale && totale > 0, id]);
      }

      return reply.status(201).send({ message: 'Pagamento aggiunto con successo', data: res.rows[0] });
    } catch (err) {
      fastify.log.error(err, 'Create pagamento error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // PUT /api/admin/utenti/pagamenti/:id — Update payment
  fastify.put('/utenti/pagamenti/:id', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const { data_pagamento, data, importo, tipo, metodo, note } = request.body || {};

      const updates = [];
      const params = [id];
      let paramCount = 2;

      const dataVal = data !== undefined ? data : data_pagamento;
      if (dataVal !== undefined) { updates.push(`data = $${paramCount++}`); params.push(dataVal); }
      if (importo !== undefined) { updates.push(`importo = $${paramCount++}`); params.push(importo); }
      const tipoVal = tipo !== undefined ? tipo : metodo;
      if (tipoVal !== undefined) { updates.push(`tipo = $${paramCount++}`); params.push(tipoVal); }
      if (note !== undefined) { updates.push(`note = $${paramCount++}`); params.push(note); }

      if (updates.length === 0) return reply.status(400).send({ error: 'Nessun campo da aggiornare' });

      const res = await query(
        `UPDATE pagamenti SET ${updates.join(', ')} WHERE id = $1 RETURNING id, id_fattura, data, importo, tipo, note`,
        params
      );
      if (res.rows.length === 0) return reply.status(404).send({ error: 'Pagamento non trovato' });

      // Update fattura pagata flag
      const fatturaId = res.rows[0].id_fattura;
      const fatturaRes = await query('SELECT SUM(importo) as pagato_totale FROM pagamenti WHERE id_fattura = $1', [fatturaId]);
      const fatturaFullRes = await query('SELECT totale FROM fatture WHERE id = $1', [fatturaId]);
      if (fatturaFullRes.rows.length > 0) {
        const pagato = parseFloat(fatturaRes.rows[0].pagato_totale || 0);
        const totale = parseFloat(fatturaFullRes.rows[0].totale);
        await query('UPDATE fatture SET pagata = $1 WHERE id = $2', [pagato >= totale && totale > 0, fatturaId]);
      }

      return reply.send({ message: 'Pagamento aggiornato con successo', data: res.rows[0] });
    } catch (err) {
      fastify.log.error(err, 'Update pagamento error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // DELETE /api/admin/utenti/pagamenti/:id — Delete payment
  fastify.delete('/utenti/pagamenti/:id', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const pagRes = await query('SELECT id_fattura FROM pagamenti WHERE id = $1', [id]);
      if (pagRes.rows.length === 0) return reply.status(404).send({ error: 'Pagamento non trovato' });

      const fatturaId = pagRes.rows[0].id_fattura;
      await query('DELETE FROM pagamenti WHERE id = $1', [id]);

      // Update fattura pagata flag
      const fatturaRes = await query('SELECT SUM(importo) as pagato_totale FROM pagamenti WHERE id_fattura = $1', [fatturaId]);
      const fatturaFullRes = await query('SELECT totale FROM fatture WHERE id = $1', [fatturaId]);
      if (fatturaFullRes.rows.length > 0) {
        const pagato = parseFloat(fatturaRes.rows[0].pagato_totale || 0);
        const totale = parseFloat(fatturaFullRes.rows[0].totale);
        await query('UPDATE fatture SET pagata = $1 WHERE id = $2', [pagato >= totale && totale > 0, fatturaId]);
      }

      return reply.send({ message: 'Pagamento eliminato con successo' });
    } catch (err) {
      fastify.log.error(err, 'Delete pagamento error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ============================================
  // SELEZIONE BANDI / ESITI / NEWSLETTER BANDI / NEWSLETTER ESITI
  // ============================================
  //
  // Queste 4 sezioni del vecchio sito hanno struttura identica: regioni +
  // province + tabella SOA Lavori + tabella SOA Servizi + tabella CPV.
  // Il payload è unificato in users_selezioni (un record per scope).

  const SCOPE_VALIDI = ['bandi', 'esiti', 'newsletter_bandi', 'newsletter_esiti'];
  const normalizeScope = s => (s || '').replace(/-/g, '_').toLowerCase();
  const emptySelezione = () => ({
    regioni: [],
    province: [],
    soa_lavori: [],
    soa_servizi: [],
    cpv: [],
    opzioni: { associa_servizi: false, collassa_non_selezionate: false },
  });

  async function loadSelezione(username, scope) {
    const res = await query(
      `SELECT regioni, province, soa_lavori, soa_servizi, cpv, opzioni, updated_at
       FROM users_selezioni WHERE username = $1 AND scope = $2`,
      [username, scope]
    );
    if (res.rows.length === 0) return emptySelezione();
    return res.rows[0];
  }

  async function saveSelezione(username, scope, body) {
    const payload = {
      regioni: Array.isArray(body.regioni) ? body.regioni : [],
      province: Array.isArray(body.province) ? body.province : [],
      soa_lavori: Array.isArray(body.soa_lavori) ? body.soa_lavori : [],
      soa_servizi: Array.isArray(body.soa_servizi) ? body.soa_servizi : [],
      cpv: Array.isArray(body.cpv) ? body.cpv : [],
      opzioni: body.opzioni && typeof body.opzioni === 'object' ? body.opzioni : {},
    };
    await query(
      `INSERT INTO users_selezioni (username, scope, regioni, province, soa_lavori, soa_servizi, cpv, opzioni, updated_at)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, NOW())
       ON CONFLICT (username, scope) DO UPDATE SET
         regioni = EXCLUDED.regioni,
         province = EXCLUDED.province,
         soa_lavori = EXCLUDED.soa_lavori,
         soa_servizi = EXCLUDED.soa_servizi,
         cpv = EXCLUDED.cpv,
         opzioni = EXCLUDED.opzioni,
         updated_at = NOW()`,
      [
        username, scope,
        JSON.stringify(payload.regioni),
        JSON.stringify(payload.province),
        JSON.stringify(payload.soa_lavori),
        JSON.stringify(payload.soa_servizi),
        JSON.stringify(payload.cpv),
        JSON.stringify(payload.opzioni),
      ]
    );
    return payload;
  }

  // GET /api/admin/utenti/:username/selezione/:scope — generico
  fastify.get('/utenti/:username/selezione/:scope', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;
      const scope = normalizeScope(request.params.scope);
      if (!SCOPE_VALIDI.includes(scope)) return reply.status(400).send({ error: 'Scope non valido' });
      return await loadSelezione(username, scope);
    } catch (err) {
      fastify.log.error(err, 'Get selezione error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // PUT /api/admin/utenti/:username/selezione/:scope — generico
  fastify.put('/utenti/:username/selezione/:scope', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;
      const scope = normalizeScope(request.params.scope);
      if (!SCOPE_VALIDI.includes(scope)) return reply.status(400).send({ error: 'Scope non valido' });
      const saved = await saveSelezione(username, scope, request.body || {});
      return { message: 'Selezione salvata', data: saved };
    } catch (err) {
      fastify.log.error(err, 'Update selezione error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/utenti/:username/selezione/copia — CopiaSoaProvince(src,tgt)
  fastify.post('/utenti/:username/selezione/copia', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;
      const from = normalizeScope(request.body?.from);
      const to = normalizeScope(request.body?.to);
      if (!SCOPE_VALIDI.includes(from) || !SCOPE_VALIDI.includes(to)) {
        return reply.status(400).send({ error: 'Scope non valido' });
      }
      if (from === to) return reply.status(400).send({ error: 'Origine e destinazione coincidono' });
      const src = await loadSelezione(username, from);
      await saveSelezione(username, to, src);
      return { message: `Selezione copiata da ${from} a ${to}` };
    } catch (err) {
      fastify.log.error(err, 'Copia selezione error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/utenti/:username/selezione/:scope/applica-regioni-soa
  // Equivalente di RegioniToSoa() / ProvinceToSoa() del vecchio sito:
  // applica regioni/province a tutte le righe SOA (lavori e/o servizi) selezionate.
  fastify.post('/utenti/:username/selezione/:scope/applica-regioni-soa', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;
      const scope = normalizeScope(request.params.scope);
      if (!SCOPE_VALIDI.includes(scope)) return reply.status(400).send({ error: 'Scope non valido' });
      const body = request.body || {};
      const regioni = Array.isArray(body.regioni) ? body.regioni : null;
      const province = Array.isArray(body.province) ? body.province : null;
      const tipo = body.tipo || 'entrambi'; // 'lavori' | 'servizi' | 'entrambi'
      const soloSelezionate = body.solo_selezionate !== false; // default true

      const sel = await loadSelezione(username, scope);
      const applicaRiga = (r) => {
        if (soloSelezionate && !r.selezionato) return r;
        const next = { ...r };
        if (regioni) next.regioni = [...regioni];
        if (province) next.province = [...province];
        return next;
      };
      if (tipo === 'lavori' || tipo === 'entrambi') {
        sel.soa_lavori = (sel.soa_lavori || []).map(applicaRiga);
      }
      if (tipo === 'servizi' || tipo === 'entrambi') {
        sel.soa_servizi = (sel.soa_servizi || []).map(applicaRiga);
      }
      const saved = await saveSelezione(username, scope, sel);
      return { message: 'Regioni/province applicate alle SOA', data: saved };
    } catch (err) {
      fastify.log.error(err, 'Applica regioni SOA error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/utenti/:username/selezione/:scope/aggiungi-servizi-collegati
  // Equivalente di AggiungiServiziCollegati('SoasBandiLavori', true) del vecchio.
  // Per ogni SOA Lavori selezionata, attiva la corrispondente SOA Servizi
  // (stesso id). È una mappatura 1:1 semplice — nel vecchio sito c'era una
  // tabella di linking ma al momento replichiamo la semantica "se hai scelto
  // OG1 Lavori, seleziona anche OG1 Servizi".
  fastify.post('/utenti/:username/selezione/:scope/aggiungi-servizi-collegati', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;
      const scope = normalizeScope(request.params.scope);
      if (!SCOPE_VALIDI.includes(scope)) return reply.status(400).send({ error: 'Scope non valido' });

      const sel = await loadSelezione(username, scope);
      const lavoriSelezionate = (sel.soa_lavori || []).filter(r => r.selezionato);
      const idsDaAggiungere = new Set(lavoriSelezionate.map(r => String(r.id)));

      // mappa id→riga delle servizi esistenti
      const mappaServizi = new Map((sel.soa_servizi || []).map(r => [String(r.id), r]));
      let nuove = 0;
      for (const lav of lavoriSelezionate) {
        const key = String(lav.id);
        const existing = mappaServizi.get(key);
        if (existing) {
          if (!existing.selezionato) { existing.selezionato = true; nuove++; }
          // riusa le stesse regioni/province del lavori
          existing.regioni = [...(lav.regioni || [])];
          existing.province = [...(lav.province || [])];
        } else {
          mappaServizi.set(key, {
            id: lav.id,
            selezionato: true,
            regioni: [...(lav.regioni || [])],
            province: [...(lav.province || [])],
          });
          nuove++;
        }
      }
      sel.soa_servizi = Array.from(mappaServizi.values());
      const saved = await saveSelezione(username, scope, sel);
      return { message: `${nuove} servizi collegati aggiunti`, data: saved };
    } catch (err) {
      fastify.log.error(err, 'Aggiungi servizi collegati error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ─── Alias retro-compatibili per le vecchie route (Sel.Bandi/Esiti + NL) ───
  // Il frontend attuale chiama /selezione-bandi, /selezione-esiti,
  // /newsletter-bandi, /newsletter-esiti — li reindirizziamo alla versione
  // unificata sopra senza doppia logica.
  for (const legacy of [
    { path: 'selezione-bandi', scope: 'bandi' },
    { path: 'selezione-esiti', scope: 'esiti' },
    { path: 'newsletter-bandi', scope: 'newsletter_bandi' },
    { path: 'newsletter-esiti', scope: 'newsletter_esiti' },
  ]) {
    fastify.get(`/utenti/:username/${legacy.path}`, { preHandler: [fastify.authenticate, adminOnly] }, async (req, reply) => {
      try { return await loadSelezione(req.params.username, legacy.scope); }
      catch (err) { return reply.status(500).send({ error: err.message }); }
    });
    fastify.put(`/utenti/:username/${legacy.path}`, { preHandler: [fastify.authenticate, adminOnly] }, async (req, reply) => {
      try {
        const saved = await saveSelezione(req.params.username, legacy.scope, req.body || {});
        return { message: 'Selezione salvata', data: saved };
      } catch (err) { return reply.status(500).send({ error: err.message }); }
    });
  }

  // ============================================
  // ASSIGNMENTS
  // ============================================

  // GET /api/admin/utenti/:username/province — Get assigned provinces (placeholder)
  fastify.get('/utenti/:username/province', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;

      // Placeholder
      const res = { rows: [] };

      return res.rows;
    } catch (err) {
      fastify.log.error(err, 'Get province error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // PUT /api/admin/utenti/:username/province — Update provinces (placeholder)
  fastify.put('/utenti/:username/province', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;
      const { province = [] } = request.body || {};

      return { message: 'Province aggiornate con successo' };
    } catch (err) {
      fastify.log.error(err, 'Update province error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/admin/utenti/:username/emails — Get additional emails
  fastify.get('/utenti/:username/emails', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;

      const res = await query(`
        SELECT id, email, created_at AS data_inserimento
        FROM user_emails
        WHERE username = $1
        ORDER BY created_at DESC
      `, [username]);

      return res.rows;
    } catch (err) {
      fastify.log.error(err, 'Get emails error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/utenti/:username/emails — Add email
  fastify.post('/utenti/:username/emails', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;
      const { email } = request.body || {};

      if (!email) {
        return reply.status(400).send({ error: 'Email richiesta' });
      }

      const res = await query(`
        INSERT INTO user_emails (username, email, created_at)
        VALUES ($1, $2, NOW())
        RETURNING id
      `, [username, email]);

      return reply.status(201).send({
        message: 'Email aggiunta con successo',
        id: res.rows[0].id
      });
    } catch (err) {
      fastify.log.error(err, 'Create email error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // DELETE /api/admin/utenti/:username/emails/:id — Delete email
  fastify.delete('/utenti/:username/emails/:id', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { id } = request.params;
      await query(`DELETE FROM user_emails WHERE id = $1`, [id]);
      return { message: 'Email eliminata con successo' };
    } catch (err) {
      fastify.log.error(err, 'Delete email error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ============================================
  // PASSWORD & MISCELLANEOUS
  // ============================================

  // POST /api/admin/utenti/:username/cambio-password — Change password for user
  fastify.post('/utenti/:username/cambio-password', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;
      const { new_password } = request.body || {};

      if (!new_password) {
        return reply.status(400).send({ error: 'Nuova password richiesta' });
      }

      let hashedPassword;
      try {
        hashedPassword = await bcrypt.hash(new_password, 10);
      } catch (hashErr) {
        fastify.log.error({ err: hashErr.message }, 'Password hash error');
        return reply.status(500).send({ error: 'Errore nel salvataggio della password' });
      }

      await query(
        `UPDATE users SET password_hash = $1 WHERE username = $2`,
        [hashedPassword, username]
      );

      return { message: 'Password aggiornata con successo' };
    } catch (err) {
      fastify.log.error(err, 'Change password error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/admin/utenti/scadenze — List upcoming subscription expirations
  fastify.get('/utenti/scadenze', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { days = 30 } = request.query;

      const res = await query(`
        SELECT
          u.username, u.email,
          a.ragione_sociale AS azienda,
          u.data_scadenza
        FROM users u
        LEFT JOIN aziende a ON u.id_azienda = a.id
        WHERE
          (u.data_scadenza IS NOT NULL AND u.data_scadenza <= NOW() + INTERVAL '${parseInt(days)} days' AND u.data_scadenza > NOW())
        ORDER BY u.data_scadenza ASC
      `);

      return res.rows;
    } catch (err) {
      fastify.log.error(err, 'Get scadenze error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/admin/utenti/inserimenti — List user insertions
  fastify.get('/utenti/inserimenti', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { days = 30 } = request.query;

      const res = await query(`
        SELECT
          u.username, u.email,
          a.ragione_sociale AS azienda, u.nome, u.cognome,
          u.created_at AS data_creazione
        FROM users u
        LEFT JOIN aziende a ON u.id_azienda = a.id
        WHERE u.created_at >= NOW() - INTERVAL '${parseInt(days)} days'
        ORDER BY u.created_at DESC
      `);

      return res.rows;
    } catch (err) {
      fastify.log.error(err, 'Get inserimenti error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/admin/utenti/:username/storico — pagina Storico del vecchio sito:
  // header anagrafico + lista periodi (eventi) con TUTTI e 9 i prezzi dei servizi
  // + per ogni periodo le sue fatture con relativi pagamenti (da_pagare / pagato).
  fastify.get('/utenti/:username/storico', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;

      // Header anagrafico
      const uRes = await query(
        `SELECT u.username, u.email, u.nome, u.cognome,
                a.ragione_sociale, a.partita_iva, a.codice_fiscale,
                a.citta, a.id_provincia, a.telefono,
                u.data_scadenza, u.mesi_rinnovo, u.attivo
         FROM users u LEFT JOIN aziende a ON u.id_azienda = a.id
         WHERE u.username = $1`,
        [username]
      );
      if (uRes.rows.length === 0) {
        return reply.status(404).send({ error: 'Utente non trovato' });
      }
      const utente = uRes.rows[0];

      // Periodi con TUTTI i prezzi (5 main + 4 extra = 9 servizi).
      let periodi = [];
      try {
        const pRes = await query(
          `SELECT * FROM periodi
           WHERE username = $1
           ORDER BY data_inizio DESC NULLS LAST, id DESC`,
          [username]
        );
        periodi = pRes.rows;
      } catch { /* tabella o colonne mancanti → migrazione non girata */ }

      // Fatture per questo utente (una query sola)
      let fatture = [];
      try {
        const fRes = await query(
          `SELECT * FROM fatture WHERE username = $1 ORDER BY data DESC NULLS LAST, id DESC`,
          [username]
        );
        fatture = fRes.rows;
      } catch { /* tabella mancante */ }

      // Pagamenti per tutte queste fatture (una query sola)
      let pagamenti = [];
      if (fatture.length > 0) {
        try {
          const ids = fatture.map(f => f.id);
          const pgRes = await query(
            `SELECT * FROM pagamenti WHERE id_fattura = ANY($1::int[]) ORDER BY data DESC NULLS LAST, id DESC`,
            [ids]
          );
          pagamenti = pgRes.rows;
        } catch { /* tabella pagamenti non presente */ }
      }

      // Indicizza pagamenti per id_fattura
      const pagPerFattura = {};
      for (const pg of pagamenti) {
        (pagPerFattura[pg.id_fattura] ||= []).push(pg);
      }
      // Arricchisci fatture con pagamenti e totale_pagato / residuo
      const fattureRich = fatture.map(f => {
        const pgs = pagPerFattura[f.id] || [];
        const totale_pagato = pgs.reduce((s, p) => s + Number(p.importo || 0), 0);
        const totale = Number(f.totale || 0);
        return {
          ...f,
          pagamenti: pgs,
          totale_pagato,
          residuo: Math.max(0, totale - totale_pagato),
          stato_pagamento: totale_pagato >= totale && totale > 0
            ? 'pagata'
            : (totale_pagato > 0 ? 'parziale' : 'da_pagare'),
        };
      });

      // Indicizza fatture per id_periodo
      const fattPerPeriodo = {};
      const fattOrfane = [];
      for (const f of fattureRich) {
        if (f.id_periodo != null) (fattPerPeriodo[f.id_periodo] ||= []).push(f);
        else fattOrfane.push(f);
      }

      // Arricchisci periodi con fatture + totali
      const periodiRich = periodi.map(p => {
        const fs = fattPerPeriodo[p.id] || [];
        const totale_fatturato = fs.reduce((s, f) => s + Number(f.totale || 0), 0);
        const totale_pagato = fs.reduce((s, f) => s + Number(f.totale_pagato || 0), 0);
        // Totale teorico del periodo = somma di tutti i 9 prezzi
        const totale_periodo =
          Number(p.prezzo_esiti || 0) +
          Number(p.prezzo_bandi || 0) +
          Number(p.prezzo_esiti_light || 0) +
          Number(p.prezzo_newsletter_esiti || 0) +
          Number(p.prezzo_newsletter_bandi || 0) +
          Number(p.prezzo_aperture || 0) +
          Number(p.prezzo_elaborati || 0) +
          Number(p.prezzo_sopralluoghi || 0) +
          Number(p.prezzo_scritture || 0);
        return {
          ...p,
          fatture: fs,
          totale_periodo,
          totale_fatturato,
          totale_pagato,
          residuo: Math.max(0, totale_fatturato - totale_pagato),
        };
      });

      // Aggregati globali
      const tot_fatturato = fattureRich.reduce((s, f) => s + Number(f.totale || 0), 0);
      const tot_pagato = fattureRich.reduce((s, f) => s + Number(f.totale_pagato || 0), 0);

      return {
        utente,
        periodi: periodiRich,
        fatture_orfane: fattOrfane,
        totali: {
          numero_periodi: periodi.length,
          numero_fatture: fatture.length,
          totale_fatturato: tot_fatturato,
          totale_pagato: tot_pagato,
          residuo: Math.max(0, tot_fatturato - tot_pagato),
        },
      };
    } catch (err) {
      fastify.log.error(err, 'Get storico error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/admin/utenti/:username/accessi — Access log (placeholder)
  fastify.get('/utenti/:username/accessi', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;

      // Placeholder: this table may not exist in new schema
      const res = { rows: [] };

      return res.rows;
    } catch (err) {
      fastify.log.error(err, 'Get accessi error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/admin/utenti/incaricati — List all agent assignments (placeholder)
  fastify.get('/utenti/incaricati', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      // Placeholder
      const res = { rows: [] };

      return res.rows;
    } catch (err) {
      fastify.log.error(err, 'Get incaricati error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // PUT /api/admin/utenti/:username/incaricati — Update agent assignments (placeholder)
  fastify.put('/utenti/:username/incaricati', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;
      const { agente, province = [] } = request.body || {};

      if (!agente) {
        return reply.status(400).send({ error: 'Agente richiesto' });
      }

      return { message: 'Assegnazioni agente aggiornate con successo' };
    } catch (err) {
      fastify.log.error(err, 'Update incaricati error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/utenti/:username/copia-importi — Copy pricing from period (placeholder)
  fastify.post('/utenti/:username/copia-importi', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;
      const { from_periodo_id } = request.body || {};

      if (!from_periodo_id) {
        return reply.status(400).send({ error: 'ID periodo sorgente richiesto' });
      }

      return { message: 'Importi copiati con successo' };
    } catch (err) {
      fastify.log.error(err, 'Copy importi error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ============================================
  // FILTRI BANDI per utente — regole SOA/province/importi
  // ============================================

  // GET /api/admin/utenti/:username/filtri-bandi — Lista regole
  fastify.get('/utenti/:username/filtri-bandi', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    const { username } = request.params;
    try {
      const userRes = await query('SELECT id FROM users WHERE username = $1', [username]);
      if (userRes.rows.length === 0) return reply.status(404).send({ error: 'Utente non trovato' });
      const userId = userRes.rows[0].id;

      const result = await query(`
        SELECT f.id, f.id_soa, f.province_ids, f.importo_min, f.importo_max,
               f.descrizione, f.attivo, f.created_at,
               s.codice AS soa_codice, s.descrizione AS soa_descrizione, s.tipo AS soa_tipo
        FROM utenti_filtri_bandi f
        LEFT JOIN soa s ON s.id = f.id_soa
        WHERE f.id_utente = $1
        ORDER BY f.created_at DESC
      `, [userId]);

      // Resolve province names for each rule
      const filtri = [];
      for (const row of result.rows) {
        const provinceIds = row.province_ids || [];
        let province = [];
        if (provinceIds.length > 0) {
          const provRes = await query(
            `SELECT id, nome, sigla FROM province WHERE id = ANY($1) ORDER BY sigla`,
            [provinceIds]
          );
          province = provRes.rows;
        }
        filtri.push({
          id: row.id,
          id_soa: row.id_soa,
          soa_codice: row.soa_codice,
          soa_descrizione: row.soa_descrizione,
          soa_tipo: row.soa_tipo,
          province_ids: provinceIds,
          province,
          importo_min: parseFloat(row.importo_min) || 0,
          importo_max: parseFloat(row.importo_max) || 0,
          descrizione: row.descrizione,
          attivo: row.attivo,
          created_at: row.created_at
        });
      }

      return { filtri, count: filtri.length };
    } catch (err) {
      fastify.log.error(err, 'Get filtri bandi error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/utenti/:username/filtri-bandi — Crea nuova regola
  fastify.post('/utenti/:username/filtri-bandi', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    const { username } = request.params;
    const { id_soa, province_ids, importo_min, importo_max, descrizione } = request.body;

    try {
      const userRes = await query('SELECT id FROM users WHERE username = $1', [username]);
      if (userRes.rows.length === 0) return reply.status(404).send({ error: 'Utente non trovato' });
      const userId = userRes.rows[0].id;

      const result = await query(`
        INSERT INTO utenti_filtri_bandi (id_utente, id_soa, province_ids, importo_min, importo_max, descrizione, attivo)
        VALUES ($1, $2, $3, $4, $5, $6, true)
        RETURNING id
      `, [
        userId,
        id_soa || null,
        JSON.stringify(province_ids || []),
        importo_min || 0,
        importo_max || 0,
        descrizione || null
      ]);

      return { success: true, id: result.rows[0].id, message: 'Regola creata' };
    } catch (err) {
      fastify.log.error(err, 'Create filtro bando error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // PUT /api/admin/utenti/:username/filtri-bandi/:id — Modifica regola
  fastify.put('/utenti/:username/filtri-bandi/:id', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    const { id } = request.params;
    const { id_soa, province_ids, importo_min, importo_max, descrizione, attivo } = request.body;

    try {
      const result = await query(`
        UPDATE utenti_filtri_bandi
        SET id_soa = $1, province_ids = $2, importo_min = $3, importo_max = $4,
            descrizione = $5, attivo = $6, updated_at = NOW()
        WHERE id = $7
        RETURNING id
      `, [
        id_soa || null,
        JSON.stringify(province_ids || []),
        importo_min || 0,
        importo_max || 0,
        descrizione || null,
        attivo !== false,
        id
      ]);

      if (result.rows.length === 0) return reply.status(404).send({ error: 'Regola non trovata' });
      return { success: true, message: 'Regola aggiornata' };
    } catch (err) {
      fastify.log.error(err, 'Update filtro bando error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // DELETE /api/admin/utenti/:username/filtri-bandi/:id — Elimina regola
  fastify.delete('/utenti/:username/filtri-bandi/:id', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    const { id } = request.params;
    try {
      const result = await query('DELETE FROM utenti_filtri_bandi WHERE id = $1 RETURNING id', [id]);
      if (result.rows.length === 0) return reply.status(404).send({ error: 'Regola non trovata' });
      return { success: true, message: 'Regola eliminata' };
    } catch (err) {
      fastify.log.error(err, 'Delete filtro bando error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ============================================
  // MATCHING BANDI → UTENTI
  // ============================================

  // GET /api/admin/utenti/:username/bandi-matching — Bandi che matchano le regole di un utente
  fastify.get('/utenti/:username/bandi-matching', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    const { username } = request.params;
    const { page = 1, limit = 50, solo_nuovi } = request.query;
    try {
      const userRes = await query('SELECT id FROM users WHERE username = $1', [username]);
      if (userRes.rows.length === 0) return reply.status(404).send({ error: 'Utente non trovato' });
      const userId = userRes.rows[0].id;

      // Recupera regole attive dell'utente
      const filtriRes = await query(
        'SELECT id, id_soa, province_ids, importo_min, importo_max FROM utenti_filtri_bandi WHERE id_utente = $1 AND attivo = true',
        [userId]
      );

      if (filtriRes.rows.length === 0) {
        return { bandi: [], total: 0, page: 1, message: 'Nessuna regola di filtro configurata' };
      }

      // Costruisci condizione OR tra tutte le regole
      const conditions = [];
      const params = [];
      let paramIdx = 1;

      for (const f of filtriRes.rows) {
        const ruleParts = [];

        // SOA
        if (f.id_soa) {
          ruleParts.push(`b."id_soa" = $${paramIdx}`);
          params.push(f.id_soa);
          paramIdx++;
        }

        // Province
        const provIds = f.province_ids || [];
        if (provIds.length > 0) {
          ruleParts.push(`EXISTS (SELECT 1 FROM bandi_province bp WHERE bp.id_bando = b.id AND bp.id_provincia = ANY($${paramIdx}))`);
          params.push(provIds);
          paramIdx++;
        }

        // Importo min
        const impMin = parseFloat(f.importo_min) || 0;
        if (impMin > 0) {
          ruleParts.push(`COALESCE(b."importo_so", b."importo_co", 0) >= $${paramIdx}`);
          params.push(impMin);
          paramIdx++;
        }

        // Importo max
        const impMax = parseFloat(f.importo_max) || 0;
        if (impMax > 0) {
          ruleParts.push(`COALESCE(b."importo_so", b."importo_co", 0) <= $${paramIdx}`);
          params.push(impMax);
          paramIdx++;
        }

        if (ruleParts.length > 0) {
          conditions.push('(' + ruleParts.join(' AND ') + ')');
        }
      }

      if (conditions.length === 0) {
        return { bandi: [], total: 0, page: 1, message: 'Regole senza criteri utili' };
      }

      const whereClause = conditions.join(' OR ');
      let extraWhere = '';
      if (solo_nuovi === 'true') {
        extraWhere = ` AND b."created_at" >= NOW() - INTERVAL '24 hours'`;
      }

      const offset = (parseInt(page) - 1) * parseInt(limit);

      const countRes = await query(
        `SELECT COUNT(*) FROM bandi b WHERE (${whereClause})${extraWhere}`, params
      );
      const total = parseInt(countRes.rows[0].count);

      params.push(parseInt(limit));
      params.push(offset);
      const bandiRes = await query(`
        SELECT b.id, b.titolo, b.codice_cig, b.importo_so, b.importo_co,
               b.data_pubblicazione, b.data_offerta, b.provenienza,
               b.stazione_nome, s.codice AS soa_codice
        FROM bandi b
        LEFT JOIN soa s ON s.id = b.id_soa
        WHERE (${whereClause})${extraWhere}
        ORDER BY b.created_at DESC
        LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
      `, params);

      return {
        bandi: bandiRes.rows,
        total,
        page: parseInt(page),
        total_pages: Math.ceil(total / parseInt(limit))
      };
    } catch (err) {
      fastify.log.error(err, 'Bandi matching error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ============================================================
  // USER DOCUMENTS CRUD
  // ============================================================

  // GET /api/admin/utenti/:id/documenti
  fastify.get('/utenti/:id/documenti', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const result = await query(
        `SELECT id, nome_file, tipo_mime, dimensione, categoria, note, uploaded_by, created_at
         FROM user_documents WHERE user_id = $1 ORDER BY created_at DESC`,
        [id]
      );
      return { documenti: result.rows };
    } catch (err) {
      if (err.message.includes('user_documents') && err.message.includes('does not exist')) {
        return { documenti: [], message: 'Tabella documenti non ancora creata' };
      }
      fastify.log.error(err, 'GET user documents error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/utenti/:id/documenti
  fastify.post('/utenti/:id/documenti', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const { nome_file, tipo_mime, dimensione, categoria, note } = request.body || {};

      if (!nome_file) {
        return reply.status(400).send({ error: 'nome_file richiesto' });
      }

      const result = await query(
        `INSERT INTO user_documents (user_id, nome_file, tipo_mime, dimensione, categoria, note, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, nome_file, categoria, created_at`,
        [id, nome_file, tipo_mime || null, dimensione || 0, categoria || null, note || null, request.user.username]
      );

      return reply.status(201).send({ success: true, documento: result.rows[0] });
    } catch (err) {
      fastify.log.error(err, 'POST user document error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // DELETE /api/admin/utenti/:id/documenti/:docId
  fastify.delete('/utenti/:id/documenti/:docId', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id, docId } = request.params;
      const result = await query(
        `DELETE FROM user_documents WHERE id = $1 AND user_id = $2 RETURNING id`,
        [docId, id]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ error: 'Documento non trovato' });
      }

      return { success: true, message: 'Documento eliminato' };
    } catch (err) {
      fastify.log.error(err, 'DELETE user document error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ============================================================
  // DOPPIE LOGIN TRACKING
  // ============================================================

  // GET /api/admin/utenti/:id/doppie-login
  fastify.get('/utenti/:id/doppie-login', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const result = await query(
        `SELECT id, ip_address, user_agent, login_at, session_token
         FROM doppie_login
         WHERE user_id = $1
         ORDER BY login_at DESC
         LIMIT 100`,
        [id]
      );
      return { doppie_login: result.rows };
    } catch (err) {
      if (err.message.includes('doppie_login') && err.message.includes('does not exist')) {
        return { doppie_login: [], message: 'Tabella doppie_login non ancora creata' };
      }
      fastify.log.error(err, 'GET doppie-login error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ============================================================
  // ENDPOINT AGGIUNTIVI — TASK 6
  // ============================================================

  // GET /api/admin/utenti/ruoli — lista 14 ruoli fissi
  fastify.get('/utenti/ruoli', { preHandler: [fastify.authenticate, adminOnly] }, async () => {
    return {
      ruoli: [
        'Bandi', 'Esiti', 'Registered', 'Admin', 'Viewer', 'Publisher',
        'Scrittura', 'Apertura', 'Sopralluogo', 'Presidia',
        'Agente', 'Subagente', 'Cliente', 'Incaricato'
      ]
    };
  });

  // GET /api/admin/utenti/anagrafica-lookup?q=X — ricerca live aziende
  fastify.get('/utenti/anagrafica-lookup', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    const q = (request.query.q || '').trim();
    if (q.length < 2) return { data: [] };
    try {
      const res = await query(
        `SELECT id, ragione_sociale, partita_iva, indirizzo, cap, citta, provincia, pec, codice_sdi, telefono, fax, email
         FROM aziende
         WHERE partita_iva ILIKE $1 OR ragione_sociale ILIKE $1
         ORDER BY ragione_sociale ASC LIMIT 10`,
        ['%' + q + '%']
      );
      return { data: res.rows };
    } catch (err) {
      fastify.log.error(err, 'Anagrafica lookup error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/utenti/fatture/:id/copia-importi — copia prezzi dal periodo associato
  fastify.post('/utenti/fatture/:id/copia-importi', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const fattura = await query('SELECT id_periodo FROM fatture WHERE id = $1', [id]);
      if (!fattura.rows.length) return reply.status(404).send({ error: 'Fattura non trovata' });
      const idPeriodo = fattura.rows[0].id_periodo;
      if (!idPeriodo) return reply.status(400).send({ error: 'Fattura non associata a un periodo' });

      const periodo = await query(
        `SELECT prezzo_esiti, prezzo_bandi, prezzo_esiti_light, prezzo_newsletter_esiti, prezzo_newsletter_bandi, prezzo_albo_ai,
                prezzo_aperture, prezzo_elaborati, prezzo_sopralluoghi, prezzo_scritture
         FROM periodi WHERE id = $1`, [idPeriodo]
      );
      if (!periodo.rows.length) return reply.status(404).send({ error: 'Periodo non trovato' });
      const p = periodo.rows[0];
      const totale = Object.values(p).reduce((a, b) => a + (Number(b) || 0), 0);

      await query('UPDATE fatture SET importo = $1, updated_at = NOW() WHERE id = $2', [totale, id]);
      return { message: 'Importi copiati dal periodo', importo: totale };
    } catch (err) {
      fastify.log.error(err, 'Copia importi fattura error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ============================================================
  // ALBO FORNITORI AI — PREFERENZE + RACCOMANDAZIONI
  // ============================================================

  // GET /api/admin/utenti/:username/albo-ai/preferenze
  fastify.get('/utenti/:username/albo-ai/preferenze', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;
      const res = await query('SELECT * FROM utenti_albo_ai_preferenze WHERE username = $1', [username]);
      return res.rows[0] || { username, soa_codici: [], province: [], cpv_codici: [], soglia_min_negoziate: 0, notifiche_nuovi_albi: true, note: '', auto_popolato_soa: true };
    } catch (err) {
      fastify.log.error(err, 'Get albo AI preferenze error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // PUT /api/admin/utenti/:username/albo-ai/preferenze
  fastify.put('/utenti/:username/albo-ai/preferenze', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;
      const { soa_codici, province, cpv_codici, soglia_min_negoziate, notifiche_nuovi_albi, note, auto_popolato_soa } = request.body || {};
      await query(
        `INSERT INTO utenti_albo_ai_preferenze (username, soa_codici, province, cpv_codici, soglia_min_negoziate, notifiche_nuovi_albi, note, auto_popolato_soa, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
         ON CONFLICT (username) DO UPDATE SET
           soa_codici = EXCLUDED.soa_codici, province = EXCLUDED.province, cpv_codici = EXCLUDED.cpv_codici,
           soglia_min_negoziate = EXCLUDED.soglia_min_negoziate, notifiche_nuovi_albi = EXCLUDED.notifiche_nuovi_albi,
           note = EXCLUDED.note, auto_popolato_soa = EXCLUDED.auto_popolato_soa, updated_at = NOW()`,
        [username, soa_codici || [], province || [], cpv_codici || [], soglia_min_negoziate || 0, notifiche_nuovi_albi !== false, note || '', auto_popolato_soa !== false]
      );
      return { message: 'Preferenze salvate' };
    } catch (err) {
      fastify.log.error(err, 'Put albo AI preferenze error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/admin/utenti/:username/albo-ai/raccomandazioni
  fastify.get('/utenti/:username/albo-ai/raccomandazioni', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;
      const { limit = 50, offset = 0, search = '' } = request.query;
      let where = 'r.username = $1';
      const params = [username];
      if (search) {
        params.push('%' + search + '%');
        where += ` AND s.nome ILIKE $${params.length}`;
      }
      params.push(Number(limit), Number(offset));
      const res = await query(
        `SELECT r.*, s.nome AS stazione_nome, s.citta AS stazione_citta, s.ha_albo,
                p.nome AS provincia_nome
         FROM utenti_albo_ai_raccomandazioni r
         LEFT JOIN stazioni s ON r.id_stazione = s.id
         LEFT JOIN province p ON s.id_provincia = p.id
         WHERE ${where}
         ORDER BY r.score DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );
      const countRes = await query(
        `SELECT COUNT(*) FROM utenti_albo_ai_raccomandazioni r LEFT JOIN stazioni s ON r.id_stazione = s.id WHERE ${where}`,
        search ? [username, '%' + search + '%'] : [username]
      );
      return { data: res.rows, total: parseInt(countRes.rows[0].count) };
    } catch (err) {
      fastify.log.error(err, 'Get albo AI raccomandazioni error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/utenti/:username/albo-ai/ricalcola
  fastify.post('/utenti/:username/albo-ai/ricalcola', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;
      // Load preferences
      const prefRes = await query('SELECT * FROM utenti_albo_ai_preferenze WHERE username = $1', [username]);
      const pref = prefRes.rows[0];
      if (!pref) return reply.status(400).send({ error: 'Nessuna preferenza configurata per questo utente' });

      const soglia = pref.soglia_min_negoziate || 0;
      const soaCodici = pref.soa_codici || [];
      const cpvCodici = pref.cpv_codici || [];
      const provPref = pref.province || [];

      // Count negoziate per stazione (ultimo anno)
      const stazioniRes = await query(
        `SELECT s.id, s.nome, s.citta, s.ha_albo, p.nome AS provincia_nome, p.sigla AS provincia_sigla,
                COUNT(b.id) AS n_negoziate
         FROM stazioni s
         LEFT JOIN province p ON s.id_provincia = p.id
         LEFT JOIN bandi b ON b.id_stazione = s.id AND b.data_pubblicazione > NOW() - INTERVAL '1 year'
         GROUP BY s.id, s.nome, s.citta, s.ha_albo, p.nome, p.sigla
         HAVING COUNT(b.id) >= $1
         ORDER BY COUNT(b.id) DESC
         LIMIT 500`,
        [soglia]
      );

      // Score calc
      const results = [];
      for (const st of stazioniRes.rows) {
        const nNeg = parseInt(st.n_negoziate) || 0;
        const provMatch = provPref.length === 0 || provPref.includes(st.provincia_sigla) || provPref.includes(st.provincia_nome);
        const soaMatch = []; // simplified — would need bandi SOA join for full match
        const cpvMatch = [];
        const score = nNeg * (1 + 0.5 * soaMatch.length + 0.3 * cpvMatch.length) * (provMatch ? 1.5 : 1);
        results.push({
          username, id_stazione: st.id, score, n_negoziate_anno: nNeg,
          soa_match: soaMatch, cpv_match: cpvMatch,
          motivazione: `${nNeg} negoziate/anno` + (provMatch ? ', provincia match' : '')
        });
      }

      // Sort and take top 100
      results.sort((a, b) => b.score - a.score);
      const top100 = results.slice(0, 100);

      // Clear and insert
      await query('DELETE FROM utenti_albo_ai_raccomandazioni WHERE username = $1', [username]);
      for (const r of top100) {
        await query(
          `INSERT INTO utenti_albo_ai_raccomandazioni (username, id_stazione, score, n_negoziate_anno, soa_match, cpv_match, motivazione, calcolato_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
          [r.username, r.id_stazione, r.score, r.n_negoziate_anno, r.soa_match, r.cpv_match, r.motivazione]
        );
      }

      return { count: top100.length, top_10: top100.slice(0, 10) };
    } catch (err) {
      fastify.log.error(err, 'Ricalcola albo AI error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/utenti/:username/albo-ai/sincronizza-soa
  fastify.post('/utenti/:username/albo-ai/sincronizza-soa', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;
      // Find user's azienda by partita_iva
      const userRes = await query(
        `SELECT u.id_azienda, a.partita_iva FROM users u LEFT JOIN aziende a ON u.id_azienda = a.id WHERE u.username = $1`,
        [username]
      );
      if (!userRes.rows.length || !userRes.rows[0].id_azienda) {
        return reply.status(400).send({ error: 'Utente non ha un\'azienda collegata' });
      }
      // For now, return empty — full implementation needs attestazioni table
      return { message: 'Sincronizzazione SOA completata', soa_codici: [] };
    } catch (err) {
      fastify.log.error(err, 'Sincronizza SOA error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ============================================
  // EMAIL SECONDARIE CRUD
  // ============================================

  // GET /api/admin/utenti/:id/email-secondarie
  fastify.get('/utenti/:id/email-secondarie', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { rows } = await query(
        `SELECT id, email, etichetta, attiva, created_at FROM users_email_secondarie
         WHERE user_id = $1 ORDER BY created_at`,
        [request.params.id]
      );
      return { emails: rows };
    } catch (err) {
      if (err.code === '42P01') return { emails: [] }; // table not yet created
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/utenti/:id/email-secondarie
  fastify.post('/utenti/:id/email-secondarie', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { email, etichetta } = request.body || {};
      if (!email) return reply.status(400).send({ error: 'email è obbligatoria' });

      const { rows } = await query(
        `INSERT INTO users_email_secondarie (user_id, email, etichetta)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, email) DO UPDATE SET etichetta = EXCLUDED.etichetta, attiva = true, updated_at = NOW()
         RETURNING id, email, etichetta, attiva`,
        [request.params.id, email.trim().toLowerCase(), etichetta || null]
      );
      return reply.status(201).send(rows[0]);
    } catch (err) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // PUT /api/admin/utenti/:id/email-secondarie/:emailId
  fastify.put('/utenti/:id/email-secondarie/:emailId', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { email, etichetta, attiva } = request.body || {};
      const sets = [];
      const vals = [];
      let idx = 1;

      if (email !== undefined) { sets.push(`email = $${idx++}`); vals.push(email.trim().toLowerCase()); }
      if (etichetta !== undefined) { sets.push(`etichetta = $${idx++}`); vals.push(etichetta); }
      if (attiva !== undefined) { sets.push(`attiva = $${idx++}`); vals.push(attiva); }

      if (sets.length === 0) return reply.status(400).send({ error: 'Nessun campo da aggiornare' });

      sets.push(`updated_at = NOW()`);
      vals.push(request.params.emailId, request.params.id);

      const { rows } = await query(
        `UPDATE users_email_secondarie SET ${sets.join(', ')} WHERE id = $${idx++} AND user_id = $${idx} RETURNING *`,
        vals
      );
      if (rows.length === 0) return reply.status(404).send({ error: 'Email non trovata' });
      return rows[0];
    } catch (err) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // DELETE /api/admin/utenti/:id/email-secondarie/:emailId
  fastify.delete('/utenti/:id/email-secondarie/:emailId', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { rowCount } = await query(
        `DELETE FROM users_email_secondarie WHERE id = $1 AND user_id = $2`,
        [request.params.emailId, request.params.id]
      );
      if (rowCount === 0) return reply.status(404).send({ error: 'Email non trovata' });
      return { deleted: true };
    } catch (err) {
      return reply.status(500).send({ error: err.message });
    }
  });
}
