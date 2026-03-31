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
        search,
        role,
        active,
        expired,
        agent,
        sort_by = 'LastLogin',
        sort_dir = 'DESC'
      } = request.query;

      const offset = (parseInt(page) - 1) * parseInt(limit);
      const params = [];
      const conditions = [];

      // Search filter
      if (search) {
        params.push(`%${search}%`);
        const searchParam = `$${params.length}`;
        conditions.push(`(
          "UserName" ILIKE ${searchParam} OR
          "Email" ILIKE ${searchParam} OR
          "FirstName" ILIKE ${searchParam} OR
          "LastName" ILIKE ${searchParam} OR
          "Company" ILIKE ${searchParam}
        )`);
      }

      // Active filter
      if (active !== undefined) {
        const isActive = active === 'true';
        params.push(isActive);
        conditions.push(`"IsApproved" = $${params.length}`);
      }

      // Expired filter
      if (expired === 'true') {
        conditions.push(`"Expire" < NOW()`);
      } else if (expired === 'false') {
        conditions.push(`("Expire" IS NULL OR "Expire" >= NOW())`);
      }

      // Agent filter
      if (agent) {
        params.push(agent);
        conditions.push(`"Agente" = $${params.length}`);
      }

      const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

      // Count total
      const countRes = await query(`SELECT COUNT(*) FROM users ${where}`, params);
      const total = parseInt(countRes.rows[0].count);

      // Validate sort parameters
      const allowedSortFields = ['LastLogin', 'CreateDate', 'UserName', 'Email', 'Company', 'Expire', 'ExpireBandi'];
      const sortField = allowedSortFields.includes(sort_by) ? sort_by : 'LastLogin';
      const sortDirection = sort_dir.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

      // Fetch paginated data
      params.push(parseInt(limit), offset);
      const dataRes = await query(`
        SELECT
          "UserName" AS username, "Email" AS email,
          "FirstName" AS nome, "LastName" AS cognome,
          "Company" AS azienda, "PartitaIva" AS partita_iva,
          "Citta" AS citta, "Provincia" AS provincia,
          "Telefono" AS telefono, "IsApproved" AS approvato,
          "CreateDate" AS created_at, "LastLogin" AS ultimo_accesso,
          "Expire" AS scadenza_esiti, "ExpireBandi" AS scadenza_bandi,
          "ExpirePresidia" AS scadenza_presidia,
          "Agente" AS agente,
          "RenewEsiti" AS rinnovo_esiti, "RenewBandi" AS rinnovo_bandi,
          "PrezzoEsiti" AS prezzo_esiti, "PrezzoBandi" AS prezzo_bandi,
          "Prezzo" AS prezzo_totale
        FROM users ${where}
        ORDER BY "${sortField}" ${sortDirection} NULLS LAST
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

  // GET /api/admin/utenti/:username — Full user detail
  fastify.get('/utenti/:username', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;

      // User info
      const userRes = await query(
        `SELECT * FROM users WHERE "UserName" = $1`,
        [username]
      );
      if (userRes.rows.length === 0) {
        return reply.status(404).send({ error: 'Utente non trovato' });
      }
      const user = userRes.rows[0];

      // Subscription info
      const abbonamentoRes = await query(`
        SELECT
          "RenewEsiti" AS rinnovo_esiti, "RenewBandi" AS rinnovo_bandi,
          "PrezzoEsiti" AS prezzo_esiti, "PrezzoBandi" AS prezzo_bandi,
          "Prezzo" AS prezzo, "IVA" AS iva, "Totale" AS totale,
          "Expire" AS scadenza_esiti, "ExpireBandi" AS scadenza_bandi,
          "ExpirePresidia" AS scadenza_presidia
        FROM users WHERE "UserName" = $1
      `, [username]);

      // Subscription periods
      const periodiRes = await query(`
        SELECT
          id, "InizioPeriodo" AS inizio, "FinePeriodo" AS fine,
          "RenewEsiti" AS rinnovo_esiti, "RenewBandi" AS rinnovo_bandi,
          "PrezzoEsiti" AS prezzo_esiti, "PrezzoBandi" AS prezzo_bandi,
          "Prezzo" AS prezzo, "IVA" AS iva, "Totale" AS totale,
          "Temporaneo" AS temporaneo, "DataInserimento" AS data_inserimento
        FROM users_periodi
        WHERE "UserName" = $1
        ORDER BY "InizioPeriodo" DESC
      `, [username]);

      // Invoices
      const fattureRes = await query(`
        SELECT
          id, numero, data, "DataScadenza" AS data_scadenza,
          importo, iva, totale, pagato, "DataPagamento" AS data_pagamento,
          note, "DataInserimento" AS data_inserimento
        FROM fatture
        WHERE "UserName" = $1
        ORDER BY data DESC
      `, [username]);

      // Pro-forma invoices
      const fatturePfRes = await query(`
        SELECT
          id, numero, data, importo, iva, totale,
          note, "DataInserimento" AS data_inserimento
        FROM fatture_pro_forma
        WHERE "UserName" = $1
        ORDER BY data DESC
      `, [username]);

      // Assigned regions
      const regioniRes = await query(`
        SELECT id, regione FROM users_regioni WHERE "UserName" = $1
      `, [username]);

      // SOA info
      const soaRes = await query(`
        SELECT id, descrizione FROM users_soa WHERE "UserName" = $1
      `, [username]);

      // Provinces
      const provinceRes = await query(`
        SELECT id, provincia FROM users_soa_province WHERE "UserName" = $1
      `, [username]);

      return {
        utente: user,
        abbonamento: abbonamentoRes.rows[0] || null,
        periodi: periodiRes.rows,
        fatture: fattureRes.rows,
        fatture_pro_forma: fatturePfRes.rows,
        regioni: regioniRes.rows,
        soa: soaRes.rows,
        province: provinceRes.rows
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
        prezzo_esiti, prezzo_bandi, prezzo, iva, totale,
        renew_esiti, renew_bandi
      } = request.body || {};

      if (!username || !email || !password) {
        return reply.status(400).send({ error: 'Username, email e password richiesti' });
      }

      // Check duplicate
      const existing = await query(
        `SELECT "UserName" FROM users WHERE "UserName" = $1 OR "Email" = $2`,
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
          "UserName", "Email", "FirstName", "LastName", "Company",
          "PartitaIva", "CodiceFiscale", "Citta", "Provincia",
          "Telefono", "IsApproved", "PasswordHash", "CreateDate",
          "PrezzoEsiti", "PrezzoBandi", "Prezzo", "IVA", "Totale",
          "RenewEsiti", "RenewBandi"
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(),
          $13, $14, $15, $16, $17, $18, $19
        )
        RETURNING "UserName", "Email", "FirstName", "LastName", "Company"
      `, [
        username, email, first_name || null, last_name || null, company || null,
        partita_iva || null, codice_fiscale || null, citta || null, provincia || null,
        telefono || null, approved, hashedPassword,
        prezzo_esiti || null, prezzo_bandi || null, prezzo || null,
        iva || null, totale || null, renew_esiti || null, renew_bandi || null
      ]);

      const newUser = insertRes.rows[0];
      return reply.status(201).send({
        message: 'Utente creato con successo',
        user: {
          username: newUser.UserName,
          email: newUser.Email,
          nome: newUser.FirstName,
          cognome: newUser.LastName,
          azienda: newUser.Company
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
        agente, prezzo_esiti, prezzo_bandi, prezzo, iva, totale,
        renew_esiti, renew_bandi, expire, expire_bandi, expire_presidia
      } = request.body || {};

      // Check user exists
      const existing = await query(`SELECT "UserName" FROM users WHERE "UserName" = $1`, [username]);
      if (existing.rows.length === 0) {
        return reply.status(404).send({ error: 'Utente non trovato' });
      }

      // Build dynamic update
      const updates = [];
      const params = [];

      if (email !== undefined) {
        params.push(email);
        updates.push(`"Email" = $${params.length}`);
      }
      if (first_name !== undefined) {
        params.push(first_name);
        updates.push(`"FirstName" = $${params.length}`);
      }
      if (last_name !== undefined) {
        params.push(last_name);
        updates.push(`"LastName" = $${params.length}`);
      }
      if (company !== undefined) {
        params.push(company);
        updates.push(`"Company" = $${params.length}`);
      }
      if (partita_iva !== undefined) {
        params.push(partita_iva);
        updates.push(`"PartitaIva" = $${params.length}`);
      }
      if (codice_fiscale !== undefined) {
        params.push(codice_fiscale);
        updates.push(`"CodiceFiscale" = $${params.length}`);
      }
      if (citta !== undefined) {
        params.push(citta);
        updates.push(`"Citta" = $${params.length}`);
      }
      if (provincia !== undefined) {
        params.push(provincia);
        updates.push(`"Provincia" = $${params.length}`);
      }
      if (telefono !== undefined) {
        params.push(telefono);
        updates.push(`"Telefono" = $${params.length}`);
      }
      if (approved !== undefined) {
        params.push(approved);
        updates.push(`"IsApproved" = $${params.length}`);
      }
      if (agente !== undefined) {
        params.push(agente);
        updates.push(`"Agente" = $${params.length}`);
      }
      if (prezzo_esiti !== undefined) {
        params.push(prezzo_esiti);
        updates.push(`"PrezzoEsiti" = $${params.length}`);
      }
      if (prezzo_bandi !== undefined) {
        params.push(prezzo_bandi);
        updates.push(`"PrezzoBandi" = $${params.length}`);
      }
      if (prezzo !== undefined) {
        params.push(prezzo);
        updates.push(`"Prezzo" = $${params.length}`);
      }
      if (iva !== undefined) {
        params.push(iva);
        updates.push(`"IVA" = $${params.length}`);
      }
      if (totale !== undefined) {
        params.push(totale);
        updates.push(`"Totale" = $${params.length}`);
      }
      if (renew_esiti !== undefined) {
        params.push(renew_esiti);
        updates.push(`"RenewEsiti" = $${params.length}`);
      }
      if (renew_bandi !== undefined) {
        params.push(renew_bandi);
        updates.push(`"RenewBandi" = $${params.length}`);
      }
      if (expire !== undefined) {
        params.push(expire);
        updates.push(`"Expire" = $${params.length}`);
      }
      if (expire_bandi !== undefined) {
        params.push(expire_bandi);
        updates.push(`"ExpireBandi" = $${params.length}`);
      }
      if (expire_presidia !== undefined) {
        params.push(expire_presidia);
        updates.push(`"ExpirePresidia" = $${params.length}`);
      }

      if (updates.length === 0) {
        return reply.status(400).send({ error: 'Nessun campo da aggiornare' });
      }

      params.push(username);
      await query(
        `UPDATE users SET ${updates.join(', ')} WHERE "UserName" = $${params.length}`,
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

      const existing = await query(`SELECT "UserName" FROM users WHERE "UserName" = $1`, [username]);
      if (existing.rows.length === 0) {
        return reply.status(404).send({ error: 'Utente non trovato' });
      }

      await query(`UPDATE users SET "IsApproved" = false WHERE "UserName" = $1`, [username]);

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
          "RenewEsiti" AS rinnovo_esiti, "RenewBandi" AS rinnovo_bandi,
          "PrezzoEsiti" AS prezzo_esiti, "PrezzoBandi" AS prezzo_bandi,
          "Prezzo" AS prezzo, "IVA" AS iva, "Totale" AS totale,
          "Expire" AS scadenza_esiti, "ExpireBandi" AS scadenza_bandi,
          "ExpirePresidia" AS scadenza_presidia
        FROM users WHERE "UserName" = $1
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
      const { prezzo_esiti, prezzo_bandi, prezzo, iva, totale, renew_esiti, renew_bandi } = request.body || {};

      const existing = await query(`SELECT "UserName" FROM users WHERE "UserName" = $1`, [username]);
      if (existing.rows.length === 0) {
        return reply.status(404).send({ error: 'Utente non trovato' });
      }

      const updates = [];
      const params = [];

      if (prezzo_esiti !== undefined) {
        params.push(prezzo_esiti);
        updates.push(`"PrezzoEsiti" = $${params.length}`);
      }
      if (prezzo_bandi !== undefined) {
        params.push(prezzo_bandi);
        updates.push(`"PrezzoBandi" = $${params.length}`);
      }
      if (prezzo !== undefined) {
        params.push(prezzo);
        updates.push(`"Prezzo" = $${params.length}`);
      }
      if (iva !== undefined) {
        params.push(iva);
        updates.push(`"IVA" = $${params.length}`);
      }
      if (totale !== undefined) {
        params.push(totale);
        updates.push(`"Totale" = $${params.length}`);
      }
      if (renew_esiti !== undefined) {
        params.push(renew_esiti);
        updates.push(`"RenewEsiti" = $${params.length}`);
      }
      if (renew_bandi !== undefined) {
        params.push(renew_bandi);
        updates.push(`"RenewBandi" = $${params.length}`);
      }

      if (updates.length === 0) {
        return reply.status(400).send({ error: 'Nessun campo da aggiornare' });
      }

      params.push(username);
      await query(
        `UPDATE users SET ${updates.join(', ')} WHERE "UserName" = $${params.length}`,
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

      const res = await query(`
        SELECT
          id, "InizioPeriodo" AS inizio, "FinePeriodo" AS fine,
          "RenewEsiti" AS rinnovo_esiti, "RenewBandi" AS rinnovo_bandi,
          "PrezzoEsiti" AS prezzo_esiti, "PrezzoBandi" AS prezzo_bandi,
          "Prezzo" AS prezzo, "IVA" AS iva, "Totale" AS totale,
          "Temporaneo" AS temporaneo, "DataInserimento" AS data_inserimento
        FROM users_periodi
        WHERE "UserName" = $1
        ORDER BY "InizioPeriodo" DESC
      `, [username]);

      return res.rows;
    } catch (err) {
      fastify.log.error(err, 'Get periodi error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/utenti/:username/periodi — Add subscription period
  fastify.post('/utenti/:username/periodi', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;
      const {
        inizio, fine, prezzo_esiti, prezzo_bandi, prezzo,
        iva, totale, renew_esiti, renew_bandi, temporaneo = false
      } = request.body || {};

      if (!inizio || !fine) {
        return reply.status(400).send({ error: 'Data inizio e fine richieste' });
      }

      const res = await query(`
        INSERT INTO users_periodi (
          "UserName", "InizioPeriodo", "FinePeriodo",
          "PrezzoEsiti", "PrezzoBandi", "Prezzo", "IVA", "Totale",
          "RenewEsiti", "RenewBandi", "Temporaneo", "DataInserimento"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
        RETURNING id
      `, [
        username, inizio, fine, prezzo_esiti || null, prezzo_bandi || null,
        prezzo || null, iva || null, totale || null,
        renew_esiti || null, renew_bandi || null, temporaneo
      ]);

      return reply.status(201).send({
        message: 'Periodo aggiunto con successo',
        id: res.rows[0].id
      });
    } catch (err) {
      fastify.log.error(err, 'Create periodo error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // PUT /api/admin/utenti/periodi/:id — Update period
  fastify.put('/utenti/periodi/:id', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const { inizio, fine, prezzo_esiti, prezzo_bandi, prezzo, iva, totale, renew_esiti, renew_bandi, temporaneo } = request.body || {};

      const updates = [];
      const params = [];

      if (inizio !== undefined) {
        params.push(inizio);
        updates.push(`"InizioPeriodo" = $${params.length}`);
      }
      if (fine !== undefined) {
        params.push(fine);
        updates.push(`"FinePeriodo" = $${params.length}`);
      }
      if (prezzo_esiti !== undefined) {
        params.push(prezzo_esiti);
        updates.push(`"PrezzoEsiti" = $${params.length}`);
      }
      if (prezzo_bandi !== undefined) {
        params.push(prezzo_bandi);
        updates.push(`"PrezzoBandi" = $${params.length}`);
      }
      if (prezzo !== undefined) {
        params.push(prezzo);
        updates.push(`"Prezzo" = $${params.length}`);
      }
      if (iva !== undefined) {
        params.push(iva);
        updates.push(`"IVA" = $${params.length}`);
      }
      if (totale !== undefined) {
        params.push(totale);
        updates.push(`"Totale" = $${params.length}`);
      }
      if (renew_esiti !== undefined) {
        params.push(renew_esiti);
        updates.push(`"RenewEsiti" = $${params.length}`);
      }
      if (renew_bandi !== undefined) {
        params.push(renew_bandi);
        updates.push(`"RenewBandi" = $${params.length}`);
      }
      if (temporaneo !== undefined) {
        params.push(temporaneo);
        updates.push(`"Temporaneo" = $${params.length}`);
      }

      if (updates.length === 0) {
        return reply.status(400).send({ error: 'Nessun campo da aggiornare' });
      }

      params.push(id);
      await query(
        `UPDATE users_periodi SET ${updates.join(', ')} WHERE id = $${params.length}`,
        params
      );

      return { message: 'Periodo aggiornato con successo' };
    } catch (err) {
      fastify.log.error(err, 'Update periodo error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // DELETE /api/admin/utenti/periodi/:id — Delete period
  fastify.delete('/utenti/periodi/:id', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { id } = request.params;
      await query(`DELETE FROM users_periodi WHERE id = $1`, [id]);
      return { message: 'Periodo eliminato con successo' };
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

      const res = await query(`
        SELECT
          id, numero, data, "DataScadenza" AS data_scadenza,
          importo, iva, totale, pagato, "DataPagamento" AS data_pagamento,
          note, "DataInserimento" AS data_inserimento
        FROM fatture
        WHERE "UserName" = $1
        ORDER BY data DESC
      `, [username]);

      return res.rows;
    } catch (err) {
      fastify.log.error(err, 'Get fatture error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/utenti/:username/fatture — Create invoice
  fastify.post('/utenti/:username/fatture', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;
      const { numero, data, data_scadenza, importo, iva, totale, note } = request.body || {};

      if (!numero || !data || !importo) {
        return reply.status(400).send({ error: 'Numero, data e importo richiesti' });
      }

      const res = await query(`
        INSERT INTO fatture (
          "UserName", numero, data, "DataScadenza", importo, iva, totale,
          note, pagato, "DataInserimento"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, NOW())
        RETURNING id
      `, [username, numero, data, data_scadenza || null, importo, iva || null, totale || null, note || null]);

      return reply.status(201).send({
        message: 'Fattura creata con successo',
        id: res.rows[0].id
      });
    } catch (err) {
      fastify.log.error(err, 'Create fattura error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // PUT /api/admin/utenti/fatture/:id — Update invoice
  fastify.put('/utenti/fatture/:id', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const { numero, data, data_scadenza, importo, iva, totale, note } = request.body || {};

      const updates = [];
      const params = [];

      if (numero !== undefined) {
        params.push(numero);
        updates.push(`numero = $${params.length}`);
      }
      if (data !== undefined) {
        params.push(data);
        updates.push(`data = $${params.length}`);
      }
      if (data_scadenza !== undefined) {
        params.push(data_scadenza);
        updates.push(`"DataScadenza" = $${params.length}`);
      }
      if (importo !== undefined) {
        params.push(importo);
        updates.push(`importo = $${params.length}`);
      }
      if (iva !== undefined) {
        params.push(iva);
        updates.push(`iva = $${params.length}`);
      }
      if (totale !== undefined) {
        params.push(totale);
        updates.push(`totale = $${params.length}`);
      }
      if (note !== undefined) {
        params.push(note);
        updates.push(`note = $${params.length}`);
      }

      if (updates.length === 0) {
        return reply.status(400).send({ error: 'Nessun campo da aggiornare' });
      }

      params.push(id);
      await query(
        `UPDATE fatture SET ${updates.join(', ')} WHERE id = $${params.length}`,
        params
      );

      return { message: 'Fattura aggiornata con successo' };
    } catch (err) {
      fastify.log.error(err, 'Update fattura error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // DELETE /api/admin/utenti/fatture/:id — Delete invoice
  fastify.delete('/utenti/fatture/:id', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { id } = request.params;
      await query(`DELETE FROM fatture WHERE id = $1`, [id]);
      return { message: 'Fattura eliminata con successo' };
    } catch (err) {
      fastify.log.error(err, 'Delete fattura error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/admin/utenti/:username/fatture-proforma — List pro-forma invoices
  fastify.get('/utenti/:username/fatture-proforma', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;

      const res = await query(`
        SELECT
          id, numero, data, importo, iva, totale,
          note, "DataInserimento" AS data_inserimento
        FROM fatture_pro_forma
        WHERE "UserName" = $1
        ORDER BY data DESC
      `, [username]);

      return res.rows;
    } catch (err) {
      fastify.log.error(err, 'Get fatture proforma error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/utenti/:username/fatture-proforma — Create pro-forma
  fastify.post('/utenti/:username/fatture-proforma', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;
      const { numero, data, importo, iva, totale, note } = request.body || {};

      if (!numero || !data || !importo) {
        return reply.status(400).send({ error: 'Numero, data e importo richiesti' });
      }

      const res = await query(`
        INSERT INTO fatture_pro_forma (
          "UserName", numero, data, importo, iva, totale, note, "DataInserimento"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        RETURNING id
      `, [username, numero, data, importo, iva || null, totale || null, note || null]);

      return reply.status(201).send({
        message: 'Fattura proforma creata con successo',
        id: res.rows[0].id
      });
    } catch (err) {
      fastify.log.error(err, 'Create fattura proforma error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // PUT /api/admin/utenti/fatture-proforma/:id — Update pro-forma
  fastify.put('/utenti/fatture-proforma/:id', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const { numero, data, importo, iva, totale, note } = request.body || {};

      const updates = [];
      const params = [];

      if (numero !== undefined) {
        params.push(numero);
        updates.push(`numero = $${params.length}`);
      }
      if (data !== undefined) {
        params.push(data);
        updates.push(`data = $${params.length}`);
      }
      if (importo !== undefined) {
        params.push(importo);
        updates.push(`importo = $${params.length}`);
      }
      if (iva !== undefined) {
        params.push(iva);
        updates.push(`iva = $${params.length}`);
      }
      if (totale !== undefined) {
        params.push(totale);
        updates.push(`totale = $${params.length}`);
      }
      if (note !== undefined) {
        params.push(note);
        updates.push(`note = $${params.length}`);
      }

      if (updates.length === 0) {
        return reply.status(400).send({ error: 'Nessun campo da aggiornare' });
      }

      params.push(id);
      await query(
        `UPDATE fatture_pro_forma SET ${updates.join(', ')} WHERE id = $${params.length}`,
        params
      );

      return { message: 'Fattura proforma aggiornata con successo' };
    } catch (err) {
      fastify.log.error(err, 'Update fattura proforma error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // DELETE /api/admin/utenti/fatture-proforma/:id — Delete pro-forma
  fastify.delete('/utenti/fatture-proforma/:id', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { id } = request.params;
      await query(`DELETE FROM fatture_pro_forma WHERE id = $1`, [id]);
      return { message: 'Fattura proforma eliminata con successo' };
    } catch (err) {
      fastify.log.error(err, 'Delete fattura proforma error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/admin/utenti/fatture/:id/pagamenti — List payments
  fastify.get('/utenti/fatture/:id/pagamenti', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { id } = request.params;

      const res = await query(`
        SELECT
          id, "id_fattura" AS id_fattura, importo, data,
          metodo, note, "DataInserimento" AS data_inserimento
        FROM dettaglio_fattura
        WHERE "id_fattura" = $1
        ORDER BY data DESC
      `, [id]);

      return res.rows;
    } catch (err) {
      fastify.log.error(err, 'Get pagamenti error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/utenti/fatture/:id/pagamenti — Add payment
  fastify.post('/utenti/fatture/:id/pagamenti', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const { importo, data, metodo, note } = request.body || {};

      if (!importo || !data) {
        return reply.status(400).send({ error: 'Importo e data richiesti' });
      }

      const res = await query(`
        INSERT INTO dettaglio_fattura (
          "id_fattura", importo, data, metodo, note, "DataInserimento"
        ) VALUES ($1, $2, $3, $4, $5, NOW())
        RETURNING id
      `, [id, importo, data, metodo || null, note || null]);

      return reply.status(201).send({
        message: 'Pagamento aggiunto con successo',
        id: res.rows[0].id
      });
    } catch (err) {
      fastify.log.error(err, 'Create pagamento error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // PUT /api/admin/utenti/pagamenti/:id — Update payment
  fastify.put('/utenti/pagamenti/:id', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const { importo, data, metodo, note } = request.body || {};

      const updates = [];
      const params = [];

      if (importo !== undefined) {
        params.push(importo);
        updates.push(`importo = $${params.length}`);
      }
      if (data !== undefined) {
        params.push(data);
        updates.push(`data = $${params.length}`);
      }
      if (metodo !== undefined) {
        params.push(metodo);
        updates.push(`metodo = $${params.length}`);
      }
      if (note !== undefined) {
        params.push(note);
        updates.push(`note = $${params.length}`);
      }

      if (updates.length === 0) {
        return reply.status(400).send({ error: 'Nessun campo da aggiornare' });
      }

      params.push(id);
      await query(
        `UPDATE dettaglio_fattura SET ${updates.join(', ')} WHERE id = $${params.length}`,
        params
      );

      return { message: 'Pagamento aggiornato con successo' };
    } catch (err) {
      fastify.log.error(err, 'Update pagamento error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // DELETE /api/admin/utenti/pagamenti/:id — Delete payment
  fastify.delete('/utenti/pagamenti/:id', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { id } = request.params;
      await query(`DELETE FROM dettaglio_fattura WHERE id = $1`, [id]);
      return { message: 'Pagamento eliminato con successo' };
    } catch (err) {
      fastify.log.error(err, 'Delete pagamento error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // PUT /api/admin/utenti/pagamenti/:id/pagato — Mark as paid
  fastify.put('/utenti/pagamenti/:id/pagato', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const { pagato = true } = request.body || {};

      await query(
        `UPDATE fatture SET pagato = $1, "DataPagamento" = $2 WHERE id = $3`,
        [pagato, pagato ? new Date().toISOString() : null, id]
      );

      return { message: 'Stato pagamento aggiornato con successo' };
    } catch (err) {
      fastify.log.error(err, 'Mark pagato error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ============================================
  // NEWSLETTER & SELECTION
  // ============================================

  // GET /api/admin/utenti/:username/selezione-bandi — Get bandi selection
  fastify.get('/utenti/:username/selezione-bandi', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;

      const res = await query(`
        SELECT id, bando_id, "DataInserimento" AS data_inserimento
        FROM users_soa_bandi
        WHERE "UserName" = $1
        ORDER BY "DataInserimento" DESC
      `, [username]);

      return res.rows;
    } catch (err) {
      fastify.log.error(err, 'Get selezione bandi error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // PUT /api/admin/utenti/:username/selezione-bandi — Update bandi selection
  fastify.put('/utenti/:username/selezione-bandi', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;
      const { bandi_ids = [] } = request.body || {};

      // Delete existing
      await query(`DELETE FROM users_soa_bandi WHERE "UserName" = $1`, [username]);

      // Insert new
      for (const bando_id of bandi_ids) {
        await query(`
          INSERT INTO users_soa_bandi ("UserName", bando_id, "DataInserimento")
          VALUES ($1, $2, NOW())
        `, [username, bando_id]);
      }

      return { message: 'Selezione bandi aggiornata con successo' };
    } catch (err) {
      fastify.log.error(err, 'Update selezione bandi error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/admin/utenti/:username/selezione-esiti — Get esiti selection
  fastify.get('/utenti/:username/selezione-esiti', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;

      const res = await query(`
        SELECT id, provincia FROM users_soa_esiti_province
        WHERE "UserName" = $1
        ORDER BY provincia ASC
      `, [username]);

      return res.rows;
    } catch (err) {
      fastify.log.error(err, 'Get selezione esiti error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // PUT /api/admin/utenti/:username/selezione-esiti — Update esiti selection
  fastify.put('/utenti/:username/selezione-esiti', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;
      const { province = [] } = request.body || {};

      // Delete existing
      await query(`DELETE FROM users_soa_esiti_province WHERE "UserName" = $1`, [username]);

      // Insert new
      for (const provincia of province) {
        await query(`
          INSERT INTO users_soa_esiti_province ("UserName", provincia)
          VALUES ($1, $2)
        `, [username, provincia]);
      }

      return { message: 'Selezione esiti aggiornata con successo' };
    } catch (err) {
      fastify.log.error(err, 'Update selezione esiti error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/admin/utenti/:username/newsletter-bandi — Get newsletter bandi config
  fastify.get('/utenti/:username/newsletter-bandi', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;

      const res = await query(`
        SELECT id, bando_id, attivo FROM users_soa_bandi
        WHERE "UserName" = $1 AND attivo = true
      `, [username]);

      return res.rows;
    } catch (err) {
      fastify.log.error(err, 'Get newsletter bandi error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // PUT /api/admin/utenti/:username/newsletter-bandi — Update newsletter bandi
  fastify.put('/utenti/:username/newsletter-bandi', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;
      const { attivo = true } = request.body || {};

      await query(
        `UPDATE users_soa_bandi SET attivo = $1 WHERE "UserName" = $2`,
        [attivo, username]
      );

      return { message: 'Newsletter bandi aggiornata con successo' };
    } catch (err) {
      fastify.log.error(err, 'Update newsletter bandi error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/admin/utenti/:username/newsletter-esiti — Get newsletter esiti config
  fastify.get('/utenti/:username/newsletter-esiti', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;

      const res = await query(`
        SELECT id, provincia, attivo FROM users_soa_esiti_province
        WHERE "UserName" = $1 AND attivo = true
      `, [username]);

      return res.rows;
    } catch (err) {
      fastify.log.error(err, 'Get newsletter esiti error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // PUT /api/admin/utenti/:username/newsletter-esiti — Update newsletter esiti
  fastify.put('/utenti/:username/newsletter-esiti', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;
      const { attivo = true } = request.body || {};

      await query(
        `UPDATE users_soa_esiti_province SET attivo = $1 WHERE "UserName" = $2`,
        [attivo, username]
      );

      return { message: 'Newsletter esiti aggiornata con successo' };
    } catch (err) {
      fastify.log.error(err, 'Update newsletter esiti error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // ============================================
  // ASSIGNMENTS
  // ============================================

  // GET /api/admin/utenti/:username/province — Get assigned provinces
  fastify.get('/utenti/:username/province', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;

      const res = await query(`
        SELECT id, provincia FROM incaricati_province
        WHERE "UserName" = $1
        ORDER BY provincia ASC
      `, [username]);

      return res.rows;
    } catch (err) {
      fastify.log.error(err, 'Get province error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // PUT /api/admin/utenti/:username/province — Update provinces
  fastify.put('/utenti/:username/province', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;
      const { province = [] } = request.body || {};

      // Delete existing
      await query(`DELETE FROM incaricati_province WHERE "UserName" = $1`, [username]);

      // Insert new
      for (const provincia of province) {
        await query(`
          INSERT INTO incaricati_province ("UserName", provincia)
          VALUES ($1, $2)
        `, [username, provincia]);
      }

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
        SELECT id, email, "DataInserimento" AS data_inserimento
        FROM user_emails
        WHERE "UserName" = $1
        ORDER BY "DataInserimento" DESC
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
        INSERT INTO user_emails ("UserName", email, "DataInserimento")
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
        `UPDATE users SET "PasswordHash" = $1 WHERE "UserName" = $2`,
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
          "UserName" AS username, "Email" AS email,
          "Company" AS azienda,
          "Expire" AS scadenza_esiti, "ExpireBandi" AS scadenza_bandi,
          "ExpirePresidia" AS scadenza_presidia
        FROM users
        WHERE
          ("Expire" IS NOT NULL AND "Expire" <= NOW() + INTERVAL '${parseInt(days)} days' AND "Expire" > NOW())
          OR ("ExpireBandi" IS NOT NULL AND "ExpireBandi" <= NOW() + INTERVAL '${parseInt(days)} days' AND "ExpireBandi" > NOW())
          OR ("ExpirePresidia" IS NOT NULL AND "ExpirePresidia" <= NOW() + INTERVAL '${parseInt(days)} days' AND "ExpirePresidia" > NOW())
        ORDER BY LEAST("Expire", "ExpireBandi", "ExpirePresidia") ASC
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
          "UserName" AS username, "Email" AS email,
          "Company" AS azienda, "FirstName" AS nome, "LastName" AS cognome,
          "CreateDate" AS data_creazione
        FROM users
        WHERE "CreateDate" >= NOW() - INTERVAL '${parseInt(days)} days'
        ORDER BY "CreateDate" DESC
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
          "UserName" AS username, "Email" AS email,
          "FirstName" AS nome, "LastName" AS cognome,
          "Company" AS azienda, "CreateDate" AS data_creazione,
          "LastLogin" AS ultimo_accesso, "IsApproved" AS approvato
        FROM users WHERE "UserName" = $1
      `, [username]);

      return res.rows[0] || reply.status(404).send({ error: 'Utente non trovato' });
    } catch (err) {
      fastify.log.error(err, 'Get storico error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/admin/utenti/:username/accessi — Access log
  fastify.get('/utenti/:username/accessi', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;

      const res = await query(`
        SELECT
          id, "UserName" AS username, "LastLogin" AS ultimo_accesso,
          ip_address, browser_agent
        FROM doppie_login
        WHERE "UserName" = $1
        ORDER BY "LastLogin" DESC
        LIMIT 50
      `, [username]);

      return res.rows;
    } catch (err) {
      fastify.log.error(err, 'Get accessi error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // GET /api/admin/utenti/incaricati — List all agent assignments
  fastify.get('/utenti/incaricati', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const res = await query(`
        SELECT
          id, agente, "UserName" AS username, provincia,
          "DataInserimento" AS data_inserimento
        FROM agenti_incaricati
        ORDER BY agente, provincia ASC
      `);

      return res.rows;
    } catch (err) {
      fastify.log.error(err, 'Get incaricati error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // PUT /api/admin/utenti/:username/incaricati — Update agent assignments
  fastify.put('/utenti/:username/incaricati', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;
      const { agente, province = [] } = request.body || {};

      if (!agente) {
        return reply.status(400).send({ error: 'Agente richiesto' });
      }

      // Delete existing agent assignments for this user
      await query(`DELETE FROM agenti_incaricati WHERE "UserName" = $1`, [username]);

      // Insert new assignments
      for (const provincia of province) {
        await query(`
          INSERT INTO agenti_incaricati (agente, "UserName", provincia, "DataInserimento")
          VALUES ($1, $2, $3, NOW())
        `, [agente, username, provincia]);
      }

      return { message: 'Assegnazioni agente aggiornate con successo' };
    } catch (err) {
      fastify.log.error(err, 'Update incaricati error');
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/admin/utenti/:username/copia-importi — Copy pricing from period
  fastify.post('/utenti/:username/copia-importi', { preHandler: [fastify.authenticate, adminOnly] }, async (request, reply) => {
    try {
      const { username } = request.params;
      const { from_periodo_id } = request.body || {};

      if (!from_periodo_id) {
        return reply.status(400).send({ error: 'ID periodo sorgente richiesto' });
      }

      // Get source period pricing
      const sourceRes = await query(`
        SELECT "PrezzoEsiti", "PrezzoBandi", "Prezzo", "IVA", "Totale", "RenewEsiti", "RenewBandi"
        FROM users_periodi
        WHERE id = $1 AND "UserName" = $2
      `, [from_periodo_id, username]);

      if (sourceRes.rows.length === 0) {
        return reply.status(404).send({ error: 'Periodo non trovato' });
      }

      const pricing = sourceRes.rows[0];

      // Update user record with pricing from period
      await query(`
        UPDATE users
        SET
          "PrezzoEsiti" = $1,
          "PrezzoBandi" = $2,
          "Prezzo" = $3,
          "IVA" = $4,
          "Totale" = $5,
          "RenewEsiti" = $6,
          "RenewBandi" = $7
        WHERE "UserName" = $8
      `, [
        pricing.PrezzoEsiti,
        pricing.PrezzoBandi,
        pricing.Prezzo,
        pricing.IVA,
        pricing.Totale,
        pricing.RenewEsiti,
        pricing.RenewBandi,
        username
      ]);

      return { message: 'Importi copiati con successo' };
    } catch (err) {
      fastify.log.error(err, 'Copy importi error');
      return reply.status(500).send({ error: err.message });
    }
  });
}
