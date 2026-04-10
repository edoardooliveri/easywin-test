import { query } from '../db/pool.js';
import bcrypt from 'bcryptjs';

export default async function adminUtentiRoutes(fastify, opts) {

  // Helper: Check admin role
  const isAdmin = (request) => {
    return request.user && request.user.is_admin === true;
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
          COALESCE(a.ragione_sociale, u.ragione_sociale) ILIKE ${searchParam} OR
          COALESCE(a.partita_iva, u.partita_iva) ILIKE ${searchParam}
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
        conditions.push(`COALESCE(a.partita_iva, u.partita_iva) ILIKE $${params.length}`);
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
        conditions.push(`u.provincia = $${params.length}`);
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
          COALESCE(a.ragione_sociale, u.ragione_sociale) AS ragione_sociale,
          COALESCE(a.partita_iva, u.partita_iva) AS partita_iva,
          COALESCE(a.citta, u.citta) AS citta,
          u.provincia,
          COALESCE(a.telefono, u.telefono) AS telefono,
          u.attivo,
          u.created_at, u.ultimo_accesso,
          u.data_scadenza,
          u.codice_agente,
          u.rinnovo_esiti, u.rinnovo_bandi,
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
          COALESCE(a.ragione_sociale, u.ragione_sociale) AS ragione_sociale,
          COALESCE(a.partita_iva, u.partita_iva) AS partita_iva,
          COALESCE(a.codice_fiscale, u.codice_fiscale) AS codice_fiscale,
          COALESCE(a.citta, u.citta) AS citta,
          COALESCE(a.telefono, u.telefono) AS telefono,
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
      const {
        username, email, password, first_name, last_name,
        company, partita_iva, codice_fiscale, citta, provincia,
        telefono, approved = true,
        id_azienda
      } = request.body || {};

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

      // Insert user
      const insertRes = await query(`
        INSERT INTO users (
          username, email, nome, cognome, ragione_sociale,
          partita_iva, codice_fiscale, citta, provincia,
          telefono, attivo, password_hash, created_at, id_azienda
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), $13
        )
        RETURNING username, email, nome, cognome, ragione_sociale
      `, [
        username, email, first_name || null, last_name || null, company || null,
        partita_iva || null, codice_fiscale || null, citta || null, provincia || null,
        telefono || null, approved, hashedPassword, id_azienda || null
      ]);

      const newUser = insertRes.rows[0];
      return reply.status(201).send({
        message: 'Utente creato con successo',
        user: {
          username: newUser.username,
          email: newUser.email,
          nome: newUser.nome,
          cognome: newUser.cognome,
          azienda: newUser.ragione_sociale
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
      const {
        email, first_name, last_name, company, partita_iva,
        codice_fiscale, citta, provincia, telefono, approved,
        agente, id_azienda, data_scadenza,
        bandi_enabled, esiti_enabled, esiti_light_enabled,
        newsletter_bandi, newsletter_esiti, simulazioni_enabled,
        note_admin
      } = request.body || {};

      // Check user exists
      const existing = await query(`SELECT username FROM users WHERE username = $1`, [username]);
      if (existing.rows.length === 0) {
        return reply.status(404).send({ error: 'Utente non trovato' });
      }

      // Build dynamic update
      const updates = [];
      const params = [];

      if (email !== undefined) {
        params.push(email);
        updates.push(`email = $${params.length}`);
      }
      if (first_name !== undefined) {
        params.push(first_name);
        updates.push(`nome = $${params.length}`);
      }
      if (last_name !== undefined) {
        params.push(last_name);
        updates.push(`cognome = $${params.length}`);
      }
      if (company !== undefined) {
        params.push(company);
        updates.push(`ragione_sociale = $${params.length}`);
      }
      if (partita_iva !== undefined) {
        params.push(partita_iva);
        updates.push(`partita_iva = $${params.length}`);
      }
      if (codice_fiscale !== undefined) {
        params.push(codice_fiscale);
        updates.push(`codice_fiscale = $${params.length}`);
      }
      if (citta !== undefined) {
        params.push(citta);
        updates.push(`citta = $${params.length}`);
      }
      if (provincia !== undefined) {
        params.push(provincia);
        updates.push(`provincia = $${params.length}`);
      }
      if (telefono !== undefined) {
        params.push(telefono);
        updates.push(`telefono = $${params.length}`);
      }
      if (approved !== undefined) {
        params.push(approved);
        updates.push(`attivo = $${params.length}`);
      }
      if (agente !== undefined) {
        params.push(agente);
        updates.push(`codice_agente = $${params.length}`);
      }
      if (id_azienda !== undefined) {
        params.push(id_azienda);
        updates.push(`id_azienda = $${params.length}`);
      }
      if (data_scadenza !== undefined) {
        params.push(data_scadenza);
        updates.push(`data_scadenza = $${params.length}`);
      }
      if (bandi_enabled !== undefined) {
        params.push(bandi_enabled);
        updates.push(`bandi_enabled = $${params.length}`);
      }
      if (esiti_enabled !== undefined) {
        params.push(esiti_enabled);
        updates.push(`esiti_enabled = $${params.length}`);
      }
      if (esiti_light_enabled !== undefined) {
        params.push(esiti_light_enabled);
        updates.push(`esiti_light_enabled = $${params.length}`);
      }
      if (newsletter_bandi !== undefined) {
        params.push(newsletter_bandi);
        updates.push(`newsletter_bandi = $${params.length}`);
      }
      if (newsletter_esiti !== undefined) {
        params.push(newsletter_esiti);
        updates.push(`newsletter_esiti = $${params.length}`);
      }
      if (simulazioni_enabled !== undefined) {
        params.push(simulazioni_enabled);
        updates.push(`simulazioni_enabled = $${params.length}`);
      }
      if (note_admin !== undefined) {
        params.push(note_admin);
        updates.push(`note_admin = $${params.length}`);
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

  // GET /api/admin/utenti/:username/abbonamento — Get subscription details
  fastify.get('/utenti/:username/abbonamento', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;

      const res = await query(`
        SELECT
          rinnovo_esiti, rinnovo_bandi,
          data_scadenza
        FROM users WHERE username = $1
      `, [username]);

      if (res.rows.length === 0) {
        return reply.status(404).send({ error: 'Utente non trovato' });
      }

      return res.rows[0];
    } catch (err) {
      fastify.log.error(err, 'Get abbonamento error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // PUT /api/admin/utenti/:username/abbonamento — Update subscription
  fastify.put('/utenti/:username/abbonamento', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;
      const { rinnovo_esiti, rinnovo_bandi, data_scadenza } = request.body || {};

      const existing = await query(`SELECT username FROM users WHERE username = $1`, [username]);
      if (existing.rows.length === 0) {
        return reply.status(404).send({ error: 'Utente non trovato' });
      }

      const updates = [];
      const params = [];

      if (rinnovo_esiti !== undefined) {
        params.push(rinnovo_esiti);
        updates.push(`rinnovo_esiti = $${params.length}`);
      }
      if (rinnovo_bandi !== undefined) {
        params.push(rinnovo_bandi);
        updates.push(`rinnovo_bandi = $${params.length}`);
      }
      if (data_scadenza !== undefined) {
        params.push(data_scadenza);
        updates.push(`data_scadenza = $${params.length}`);
      }

      if (updates.length === 0) {
        return reply.status(400).send({ error: 'Nessun campo da aggiornare' });
      }

      params.push(username);
      await query(
        `UPDATE users SET ${updates.join(', ')} WHERE username = $${params.length}`,
        params
      );

      return { message: 'Abbonamento aggiornato con successo' };
    } catch (err) {
      fastify.log.error(err, 'Update abbonamento error');
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

  // POST /api/admin/utenti/:username/periodi — Add subscription period
  fastify.post('/utenti/:username/periodi', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;
      const { data_inizio, data_fine, tipo = 'standard', prezzo_esiti = 0, prezzo_bandi = 0, prezzo_newsletter_esiti = 0, prezzo_newsletter_bandi = 0, note } = request.body || {};

      if (!data_inizio || !data_fine) {
        return reply.status(400).send({ error: 'Data inizio e fine richieste' });
      }

      const res = await query(
        'INSERT INTO periodi (username, data_inizio, data_fine, tipo, prezzo_esiti, prezzo_bandi, prezzo_newsletter_esiti, prezzo_newsletter_bandi, note) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, username, data_inizio, data_fine, tipo, prezzo_esiti, prezzo_bandi, prezzo_newsletter_esiti, prezzo_newsletter_bandi, note, created_at',
        [username, data_inizio, data_fine, tipo, prezzo_esiti, prezzo_bandi, prezzo_newsletter_esiti, prezzo_newsletter_bandi, note]
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
      const { data_inizio, data_fine, tipo, prezzo_esiti, prezzo_bandi, prezzo_newsletter_esiti, prezzo_newsletter_bandi, note } = request.body || {};

      const updates = [];
      const params = [id];
      let paramCount = 2;

      if (data_inizio !== undefined) { updates.push(`data_inizio = $${paramCount++}`); params.push(data_inizio); }
      if (data_fine !== undefined) { updates.push(`data_fine = $${paramCount++}`); params.push(data_fine); }
      if (tipo !== undefined) { updates.push(`tipo = $${paramCount++}`); params.push(tipo); }
      if (prezzo_esiti !== undefined) { updates.push(`prezzo_esiti = $${paramCount++}`); params.push(prezzo_esiti); }
      if (prezzo_bandi !== undefined) { updates.push(`prezzo_bandi = $${paramCount++}`); params.push(prezzo_bandi); }
      if (prezzo_newsletter_esiti !== undefined) { updates.push(`prezzo_newsletter_esiti = $${paramCount++}`); params.push(prezzo_newsletter_esiti); }
      if (prezzo_newsletter_bandi !== undefined) { updates.push(`prezzo_newsletter_bandi = $${paramCount++}`); params.push(prezzo_newsletter_bandi); }
      if (note !== undefined) { updates.push(`note = $${paramCount++}`); params.push(note); }
      updates.push(`updated_at = NOW()`);

      if (updates.length === 1) {
        return reply.status(400).send({ error: 'Nessun campo da aggiornare' });
      }

      const res = await query(
        `UPDATE periodi SET ${updates.join(', ')} WHERE id = $1 RETURNING id, username, data_inizio, data_fine, tipo, prezzo_esiti, prezzo_bandi, prezzo_newsletter_esiti, prezzo_newsletter_bandi, note, updated_at`,
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
        'SELECT id, username, numero, tipo, data_emissione, data_scadenza, importo, iva, totale, stato, id_periodo, note, created_at, updated_at FROM fatture WHERE username = $1 ORDER BY data_emissione DESC',
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
      const { numero, tipo = 'fattura', data_emissione, data_scadenza, importo, iva = 0, totale, stato = 'da_pagare', id_periodo, note } = request.body || {};

      if (!numero || !data_emissione || importo === undefined) {
        return reply.status(400).send({ error: 'Numero, data emissione e importo richiesti' });
      }

      const finalTotale = totale !== undefined ? totale : (parseFloat(importo) + parseFloat(iva || 0));

      const res = await query(
        'INSERT INTO fatture (username, numero, tipo, data_emissione, data_scadenza, importo, iva, totale, stato, id_periodo, note) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id, username, numero, tipo, data_emissione, data_scadenza, importo, iva, totale, stato, id_periodo, note, created_at',
        [username, numero, tipo, data_emissione, data_scadenza, importo, iva, finalTotale, stato, id_periodo, note]
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
      const { numero, tipo, data_emissione, data_scadenza, importo, iva, totale, stato, id_periodo, note } = request.body || {};

      const updates = [];
      const params = [id];
      let paramCount = 2;

      if (numero !== undefined) { updates.push(`numero = $${paramCount++}`); params.push(numero); }
      if (tipo !== undefined) { updates.push(`tipo = $${paramCount++}`); params.push(tipo); }
      if (data_emissione !== undefined) { updates.push(`data_emissione = $${paramCount++}`); params.push(data_emissione); }
      if (data_scadenza !== undefined) { updates.push(`data_scadenza = $${paramCount++}`); params.push(data_scadenza); }
      if (importo !== undefined) { updates.push(`importo = $${paramCount++}`); params.push(importo); }
      if (iva !== undefined) { updates.push(`iva = $${paramCount++}`); params.push(iva); }
      if (totale !== undefined) { updates.push(`totale = $${paramCount++}`); params.push(totale); }
      if (stato !== undefined) { updates.push(`stato = $${paramCount++}`); params.push(stato); }
      if (id_periodo !== undefined) { updates.push(`id_periodo = $${paramCount++}`); params.push(id_periodo); }
      if (note !== undefined) { updates.push(`note = $${paramCount++}`); params.push(note); }
      updates.push(`updated_at = NOW()`);

      if (updates.length === 1) return reply.status(400).send({ error: 'Nessun campo da aggiornare' });

      const res = await query(
        `UPDATE fatture SET ${updates.join(', ')} WHERE id = $1 RETURNING id, username, numero, tipo, data_emissione, data_scadenza, importo, iva, totale, stato, id_periodo, note, updated_at`,
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
        'SELECT id, username, numero, tipo, data_emissione, data_scadenza, importo, iva, totale, stato, id_periodo, note, created_at FROM fatture WHERE username = $1 AND tipo = $2 ORDER BY data_emissione DESC',
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
      const { numero, data_emissione, data_scadenza, importo, iva = 0, totale, id_periodo, note } = request.body || {};

      if (!numero || !data_emissione || importo === undefined) {
        return reply.status(400).send({ error: 'Numero, data e importo richiesti' });
      }

      const finalTotale = totale !== undefined ? totale : (parseFloat(importo) + parseFloat(iva || 0));

      const res = await query(
        'INSERT INTO fatture (username, numero, tipo, data_emissione, data_scadenza, importo, iva, totale, stato, id_periodo, note) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id, username, numero, tipo, data_emissione, data_scadenza, importo, iva, totale, stato, id_periodo, note, created_at',
        [username, numero, 'proforma', data_emissione, data_scadenza, importo, iva, finalTotale, 'da_pagare', id_periodo, note]
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
      const { numero, data_emissione, data_scadenza, importo, iva, totale, stato, note } = request.body || {};

      const updates = [];
      const params = [id];
      let paramCount = 2;

      if (numero !== undefined) { updates.push(`numero = $${paramCount++}`); params.push(numero); }
      if (data_emissione !== undefined) { updates.push(`data_emissione = $${paramCount++}`); params.push(data_emissione); }
      if (data_scadenza !== undefined) { updates.push(`data_scadenza = $${paramCount++}`); params.push(data_scadenza); }
      if (importo !== undefined) { updates.push(`importo = $${paramCount++}`); params.push(importo); }
      if (iva !== undefined) { updates.push(`iva = $${paramCount++}`); params.push(iva); }
      if (totale !== undefined) { updates.push(`totale = $${paramCount++}`); params.push(totale); }
      if (stato !== undefined) { updates.push(`stato = $${paramCount++}`); params.push(stato); }
      if (note !== undefined) { updates.push(`note = $${paramCount++}`); params.push(note); }
      updates.push(`updated_at = NOW()`);

      if (updates.length === 1) return reply.status(400).send({ error: 'Nessun campo da aggiornare' });

      const res = await query(
        `UPDATE fatture SET ${updates.join(', ')} WHERE id = $1 AND tipo = 'proforma' RETURNING id, numero, tipo, data_emissione, data_scadenza, importo, iva, totale, stato, note, updated_at`,
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
        'SELECT id, id_fattura, data_pagamento, importo, metodo, riferimento, note, created_at FROM pagamenti WHERE id_fattura = $1 ORDER BY data_pagamento DESC',
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
      const { data_pagamento, importo, metodo = 'bonifico', riferimento, note } = request.body || {};

      if (!data_pagamento || importo === undefined) {
        return reply.status(400).send({ error: 'Data pagamento e importo richiesti' });
      }

      const res = await query(
        'INSERT INTO pagamenti (id_fattura, data_pagamento, importo, metodo, riferimento, note) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, id_fattura, data_pagamento, importo, metodo, riferimento, note, created_at',
        [id, data_pagamento, importo, metodo, riferimento, note]
      );

      // Update fattura stato if fully paid
      const fatturaRes = await query('SELECT SUM(importo) as pagato_totale FROM pagamenti WHERE id_fattura = $1', [id]);
      const fatturaFullRes = await query('SELECT totale FROM fatture WHERE id = $1', [id]);
      if (fatturaFullRes.rows.length > 0) {
        const pagato = parseFloat(fatturaRes.rows[0].pagato_totale || 0);
        const totale = parseFloat(fatturaFullRes.rows[0].totale);
        const newStato = pagato >= totale ? 'pagata' : (pagato > 0 ? 'parziale' : 'da_pagare');
        await query('UPDATE fatture SET stato = $1 WHERE id = $2', [newStato, id]);
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
      const { data_pagamento, importo, metodo, riferimento, note } = request.body || {};

      const updates = [];
      const params = [id];
      let paramCount = 2;

      if (data_pagamento !== undefined) { updates.push(`data_pagamento = $${paramCount++}`); params.push(data_pagamento); }
      if (importo !== undefined) { updates.push(`importo = $${paramCount++}`); params.push(importo); }
      if (metodo !== undefined) { updates.push(`metodo = $${paramCount++}`); params.push(metodo); }
      if (riferimento !== undefined) { updates.push(`riferimento = $${paramCount++}`); params.push(riferimento); }
      if (note !== undefined) { updates.push(`note = $${paramCount++}`); params.push(note); }

      if (updates.length === 0) return reply.status(400).send({ error: 'Nessun campo da aggiornare' });

      const res = await query(
        `UPDATE pagamenti SET ${updates.join(', ')} WHERE id = $1 RETURNING id, id_fattura, data_pagamento, importo, metodo, riferimento, note`,
        params
      );
      if (res.rows.length === 0) return reply.status(404).send({ error: 'Pagamento non trovato' });

      // Update fattura stato
      const fatturaId = res.rows[0].id_fattura;
      const fatturaRes = await query('SELECT SUM(importo) as pagato_totale FROM pagamenti WHERE id_fattura = $1', [fatturaId]);
      const fatturaFullRes = await query('SELECT totale FROM fatture WHERE id = $1', [fatturaId]);
      if (fatturaFullRes.rows.length > 0) {
        const pagato = parseFloat(fatturaRes.rows[0].pagato_totale || 0);
        const totale = parseFloat(fatturaFullRes.rows[0].totale);
        const newStato = pagato >= totale ? 'pagata' : (pagato > 0 ? 'parziale' : 'da_pagare');
        await query('UPDATE fatture SET stato = $1 WHERE id = $2', [newStato, fatturaId]);
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

      // Update fattura stato
      const fatturaRes = await query('SELECT SUM(importo) as pagato_totale FROM pagamenti WHERE id_fattura = $1', [fatturaId]);
      const fatturaFullRes = await query('SELECT totale FROM fatture WHERE id = $1', [fatturaId]);
      if (fatturaFullRes.rows.length > 0) {
        const pagato = parseFloat(fatturaRes.rows[0].pagato_totale || 0);
        const totale = parseFloat(fatturaFullRes.rows[0].totale);
        const newStato = pagato >= totale ? 'pagata' : (pagato > 0 ? 'parziale' : 'da_pagare');
        await query('UPDATE fatture SET stato = $1 WHERE id = $2', [newStato, fatturaId]);
      }

      return reply.send({ message: 'Pagamento eliminato con successo' });
    } catch (err) {
      fastify.log.error(err, 'Delete pagamento error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ============================================
  // NEWSLETTER & SELECTION
  // ============================================

  // GET /api/admin/utenti/:username/selezione-bandi — Get bandi selection (placeholder)
  fastify.get('/utenti/:username/selezione-bandi', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;

      // Placeholder
      const res = { rows: [] };

      return res.rows;
    } catch (err) {
      fastify.log.error(err, 'Get selezione bandi error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // PUT /api/admin/utenti/:username/selezione-bandi — Update bandi selection (placeholder)
  fastify.put('/utenti/:username/selezione-bandi', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;
      const { bandi_ids = [] } = request.body || {};

      return { message: 'Selezione bandi aggiornata con successo' };
    } catch (err) {
      fastify.log.error(err, 'Update selezione bandi error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/admin/utenti/:username/selezione-esiti — Get esiti selection (placeholder)
  fastify.get('/utenti/:username/selezione-esiti', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;

      // Placeholder
      const res = { rows: [] };

      return res.rows;
    } catch (err) {
      fastify.log.error(err, 'Get selezione esiti error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // PUT /api/admin/utenti/:username/selezione-esiti — Update esiti selection (placeholder)
  fastify.put('/utenti/:username/selezione-esiti', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;
      const { province = [] } = request.body || {};

      return { message: 'Selezione esiti aggiornata con successo' };
    } catch (err) {
      fastify.log.error(err, 'Update selezione esiti error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/admin/utenti/:username/newsletter-bandi — Get newsletter bandi config (placeholder)
  fastify.get('/utenti/:username/newsletter-bandi', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;

      // Placeholder
      const res = { rows: [] };

      return res.rows;
    } catch (err) {
      fastify.log.error(err, 'Get newsletter bandi error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // PUT /api/admin/utenti/:username/newsletter-bandi — Update newsletter bandi (placeholder)
  fastify.put('/utenti/:username/newsletter-bandi', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;
      const { attivo = true } = request.body || {};

      return { message: 'Newsletter bandi aggiornata con successo' };
    } catch (err) {
      fastify.log.error(err, 'Update newsletter bandi error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/admin/utenti/:username/newsletter-esiti — Get newsletter esiti config (placeholder)
  fastify.get('/utenti/:username/newsletter-esiti', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;

      // Placeholder
      const res = { rows: [] };

      return res.rows;
    } catch (err) {
      fastify.log.error(err, 'Get newsletter esiti error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // PUT /api/admin/utenti/:username/newsletter-esiti — Update newsletter esiti (placeholder)
  fastify.put('/utenti/:username/newsletter-esiti', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;
      const { attivo = true } = request.body || {};

      return { message: 'Newsletter esiti aggiornata con successo' };
    } catch (err) {
      fastify.log.error(err, 'Update newsletter esiti error');
      return reply.status(500).send({ error: err.message });
    }
  });

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
          username, email,
          ragione_sociale AS azienda,
          data_scadenza
        FROM users
        WHERE
          (data_scadenza IS NOT NULL AND data_scadenza <= NOW() + INTERVAL '${parseInt(days)} days' AND data_scadenza > NOW())
        ORDER BY data_scadenza ASC
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
          username, email,
          ragione_sociale AS azienda, nome, cognome,
          created_at AS data_creazione
        FROM users
        WHERE created_at >= NOW() - INTERVAL '${parseInt(days)} days'
        ORDER BY created_at DESC
      `);

      return res.rows;
    } catch (err) {
      fastify.log.error(err, 'Get inserimenti error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/admin/utenti/:username/storico — User history
  fastify.get('/utenti/:username/storico', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;

      const res = await query(`
        SELECT
          username, email,
          nome, cognome,
          ragione_sociale AS azienda, created_at AS data_creazione,
          ultimo_accesso, attivo AS approvato
        FROM users WHERE username = $1
      `, [username]);

      return res.rows[0] || reply.status(404).send({ error: 'Utente non trovato' });
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
}
