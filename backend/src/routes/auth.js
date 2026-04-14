import { query } from '../db/pool.js';
import bcrypt from 'bcryptjs';

export default async function authRoutes(fastify, opts) {

  // Ensure PasswordHash column exists (migrated from ASP.NET Membership)
  try {
    await query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'users' AND column_name = 'password_hash'
        ) THEN
          ALTER TABLE users ADD COLUMN "password_hash" VARCHAR(255);
        END IF;
      END $$;
    `);
    fastify.log.info('PasswordHash column check completed');
  } catch (err) {
    fastify.log.warn({ err: err.message }, 'Could not verify PasswordHash column - will retry on login');
  }

  // POST /api/auth/login
  // Colonne reali tabella users: UserName, Email, FirstName, LastName, Company,
  // PartitaIva, CodiceFiscale, Citta, Provincia, IsApproved, Expire, etc.
  fastify.post('/login', async (request, reply) => {
    try {
      const { username, password } = request.body || {};

      if (!username || !password) {
        return reply.status(400).send({ error: 'Username e password richiesti' });
      }

      const result = await query(
        `SELECT u."id" AS user_id, u."username", u."email", u."nome", u."cognome",
                u."attivo", u."password_hash", u."ruolo",
                u."ruolo_dettagliato", u."bandi_enabled", u."esiti_enabled",
                u."esiti_light_enabled", u."simulazioni_enabled",
                u."newsletter_bandi", u."newsletter_esiti",
                u."data_scadenza", u."bloccato", u."motivo_blocco",
                u."codice_agente", u."id_azienda"
         FROM users u
         WHERE u."username" = $1 OR u."email" = $1
         LIMIT 1`,
        [username]
      );

      if (result.rows.length === 0) {
        return reply.status(401).send({ error: 'Credenziali non valide' });
      }

      const user = result.rows[0];

      // Check if user is approved/active
      if (user.attivo === false) {
        return reply.status(403).send({ error: 'Account non attivo. Contattare l\'assistenza.' });
      }

      // Check if user is blocked
      if (user.bloccato === true) {
        const motivo = user.motivo_blocco ? ` Motivo: ${user.motivo_blocco}` : '';
        return reply.status(403).send({ error: `Account bloccato.${motivo} Contattare l'assistenza.` });
      }

      // Check subscription expiry
      const isExpired = user.data_scadenza && new Date(user.data_scadenza) < new Date();
      if (isExpired && user.ruolo !== 'admin' && user.ruolo !== 'superadmin') {
        // Allow login but flag as expired — frontend will show limited access
        user._isExpired = true;
      }

      // Password validation: handle legacy migration from ASP.NET Membership
      if (user.password_hash) {
        // User already has a password hash (migrated or first-login from new register endpoint)
        const passwordMatch = await bcrypt.compare(password, user.password_hash);
        if (!passwordMatch) {
          return reply.status(401).send({ error: 'Credenziali non valide' });
        }
      } else {
        // First login for user without password hash: hash the provided password and store it
        // This handles users migrated from legacy ASP.NET Membership system
        try {
          const hashedPassword = await bcrypt.hash(password, 10);
          await query(
            `UPDATE users SET "password_hash" = $1 WHERE "username" = $2`,
            [hashedPassword, user.username]
          );
        } catch (hashErr) {
          fastify.log.error({ err: hashErr.message }, 'Password hash error on first login');
          return reply.status(500).send({ error: 'Errore nel salvataggio della password' });
        }
      }

      // Build permissions object
      const permissions = {
        bandi: user.bandi_enabled !== false,
        esiti: user.esiti_enabled !== false,
        esiti_light: user.esiti_light_enabled === true,
        simulazioni: user.simulazioni_enabled !== false,
        newsletter_bandi: user.newsletter_bandi === true,
        newsletter_esiti: user.newsletter_esiti === true
      };

      // Admin/superadmin get everything
      const isAdmin = user.ruolo === 'admin' || user.ruolo === 'superadmin';
      if (isAdmin) {
        permissions.bandi = true;
        permissions.esiti = true;
        permissions.esiti_light = false; // admin sees full esiti, not light
        permissions.simulazioni = true;
        permissions.newsletter_bandi = true;
        permissions.newsletter_esiti = true;
        permissions.admin = true;
        permissions.gestionale = true;
      }

      // Agente gets gestionale access
      if (user.ruolo === 'agente') {
        permissions.gestionale = true;
        permissions.agente = true;
      }

      // Incaricato gets limited gestionale
      if (user.ruolo === 'incaricato') {
        permissions.gestionale = true;
        permissions.incaricato = true;
      }

      // Operatore gets publishing access
      if (user.ruolo === 'operatore') {
        permissions.gestionale = true;
        permissions.operatore = true;
      }

      // Publisher gets bandi CRUD access (no admin panels)
      if (user.ruolo === 'publisher') {
        permissions.bandi = true;
        permissions.publisher = true;
      }

      const token = fastify.jwt.sign({
        userId: user.user_id,
        username: user.username,
        email: user.email,
        nome: user.nome,
        cognome: user.cognome,
        ruolo: user.ruolo || 'utente',
        ruolo_dettagliato: user.ruolo_dettagliato || null,
        id_azienda: user.id_azienda || null,
        permissions,
        isExpired: user._isExpired || false,
        data_scadenza: user.data_scadenza || null
      }, { expiresIn: '24h' });

      // Doppie-login tracking: detect concurrent sessions from different IPs
      try {
        const clientIp = request.ip || request.headers['x-forwarded-for'] || 'unknown';
        const userAgent = request.headers['user-agent'] || '';

        // Insert login record
        await query(
          `INSERT INTO doppie_login (user_id, ip_address, user_agent, login_at, session_token)
           VALUES ($1, $2, $3, NOW(), $4)`,
          [user.user_id, clientIp, userAgent, token.substring(token.length - 20)]
        );

        // Cleanup old records (keep last 30 days)
        await query(
          `DELETE FROM doppie_login WHERE login_at < NOW() - INTERVAL '30 days'`
        );
      } catch (dlErr) {
        // doppie_login table may not exist yet — non-blocking
        fastify.log.debug({ err: dlErr.message }, 'doppie_login tracking skipped');
      }

      // Update ultimo_accesso
      try {
        await query(`UPDATE users SET ultimo_accesso = NOW() WHERE id = $1`, [user.user_id]);
      } catch (e) { /* non-blocking */ }

      return {
        token,
        user: {
          id: user.user_id,
          username: user.username,
          email: user.email,
          nome: user.nome,
          cognome: user.cognome,
          ruolo: user.ruolo || 'utente',
          ruolo_dettagliato: user.ruolo_dettagliato || null,
          id_azienda: user.id_azienda || null,
          permissions,
          isExpired: user._isExpired || false,
          data_scadenza: user.data_scadenza || null
        }
      };
    } catch (err) {
      fastify.log.error({ err: err.message, stack: err.stack, code: err.code }, 'Login error');
      return reply.status(500).send({ error: `Errore login: ${err.message}` });
    }
  });

  // POST /api/auth/dev-login — Dev-only login bypass (only in development)
  if (process.env.NODE_ENV !== 'production') {
    fastify.post('/dev-login', async (request, reply) => {
      // Assicura che l'utente admin-dev esista davvero in `users` in modo che
      // tutte le FK (es. registro_gare_clienti_username_fkey) siano soddisfatte.
      try {
        // password_hash è NOT NULL — usiamo un bcrypt di "dev" (placeholder, dev-login non valida comunque password)
        await query(
          `INSERT INTO users (username, email, nome, cognome, ruolo, attivo, password_hash)
           VALUES ('admin-dev', 'admin@easywin.it', 'Admin', 'Dev', 'superadmin', true, '$2a$10$DEVPLACEHOLDERHASHNOTUSEDFORLOGINXXXXXXXXXXXXXXXXXXXXXX')
           ON CONFLICT (username) DO UPDATE SET attivo = true, ruolo = 'superadmin'`
        );
        // Se admin-dev non ha id_azienda assegniamo la prima azienda disponibile,
        // così i fan-out verso sopralluoghi/apertura/scrittura (Agenda Mensile)
        // hanno un id_azienda valido e non vengono silenziosamente saltati.
        try {
          const adminRow = await query(`SELECT id_azienda FROM users WHERE username = 'admin-dev' LIMIT 1`);
          const hasAzienda = adminRow.rows[0]?.id_azienda != null;
          if (!hasAzienda) {
            let az = null;
            try {
              const r = await query(`SELECT id FROM aziende ORDER BY id LIMIT 1`);
              az = r.rows[0]?.id ?? null;
            } catch (_) {
              try {
                const r = await query(`SELECT id_azienda AS id FROM aziende ORDER BY id_azienda LIMIT 1`);
                az = r.rows[0]?.id ?? null;
              } catch (_) {}
            }
            if (az != null) {
              await query(`UPDATE users SET id_azienda = $1 WHERE username = 'admin-dev'`, [az]);
              fastify.log.info({ az }, 'dev-login: admin-dev id_azienda assegnato');
            }
          }
        } catch (e) {
          fastify.log.warn({ err: e.message }, 'dev-login: assegnazione id_azienda fallita (non-bloccante)');
        }
      } catch (e) {
        fastify.log.warn({ err: e.message }, 'dev-login upsert users fallita (non-bloccante)');
      }
      const token = fastify.jwt.sign({
        userId: 'dev-admin-001',
        username: 'admin-dev',
        email: 'admin@easywin.it',
        nome: 'Admin',
        cognome: 'Dev',
        ruolo: 'superadmin',
        permissions: { gestionale: true, bandi: true, esiti: true, simulazioni: true, admin: true }
      }, { expiresIn: '24h' });
      return { token, user: { username: 'admin-dev', ruolo: 'superadmin', nome: 'Admin', cognome: 'Dev', permissions: { gestionale: true, bandi: true, esiti: true, simulazioni: true, admin: true } } };
    });
  }

  // GET /api/auth/me
  fastify.get('/me', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const result = await query(
        `SELECT u."id" AS user_id, u."username", u."email", u."nome", u."cognome",
                u."ruolo", u."attivo", u."ruolo_dettagliato",
                u."bandi_enabled", u."esiti_enabled", u."esiti_light_enabled",
                u."simulazioni_enabled", u."newsletter_bandi", u."newsletter_esiti",
                u."data_scadenza", u."bloccato", u."id_azienda",
                a."ragione_sociale" AS azienda_nome
         FROM users u
         LEFT JOIN aziende a ON u."id_azienda" = a."id"
         WHERE u."username" = $1`,
        [request.user.username]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ error: 'Utente non trovato' });
      }

      const u = result.rows[0];
      const isAdmin = u.ruolo === 'admin' || u.ruolo === 'superadmin';
      const isExpired = u.data_scadenza && new Date(u.data_scadenza) < new Date();

      const permissions = {
        bandi: isAdmin || u.bandi_enabled !== false,
        esiti: isAdmin || u.esiti_enabled !== false,
        esiti_light: !isAdmin && u.esiti_light_enabled === true,
        simulazioni: isAdmin || u.simulazioni_enabled !== false,
        newsletter_bandi: isAdmin || u.newsletter_bandi === true,
        newsletter_esiti: isAdmin || u.newsletter_esiti === true,
        admin: isAdmin,
        gestionale: isAdmin || u.ruolo === 'agente' || u.ruolo === 'incaricato' || u.ruolo === 'operatore',
        agente: u.ruolo === 'agente',
        incaricato: u.ruolo === 'incaricato',
        operatore: u.ruolo === 'operatore',
        publisher: u.ruolo === 'publisher'
      };

      return {
        id: u.user_id,
        username: u.username,
        email: u.email,
        nome: u.nome,
        cognome: u.cognome,
        ruolo: u.ruolo || 'utente',
        ruolo_dettagliato: u.ruolo_dettagliato,
        attivo: u.attivo,
        id_azienda: u.id_azienda,
        azienda_nome: u.azienda_nome,
        permissions,
        isExpired: isExpired && !isAdmin,
        data_scadenza: u.data_scadenza
      };
    } catch (err) {
      fastify.log.error({ err: err.message }, '/me error');
      return reply.status(500).send({ error: 'Errore nel recupero profilo' });
    }
  });

  // POST /api/auth/register (admin only)
  fastify.post('/register', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { username, email, password, first_name, last_name, company, partita_iva } = request.body || {};

      // Validate required fields
      if (!username || !email || !password) {
        return reply.status(400).send({ error: 'Username, email e password richiesti' });
      }

      // Check if user already exists
      const existingUser = await query(
        `SELECT "username" FROM users WHERE "username" = $1 OR "email" = $2 LIMIT 1`,
        [username, email]
      );

      if (existingUser.rows.length > 0) {
        return reply.status(409).send({ error: 'Username o email già in uso' });
      }

      // Hash the password
      let hashedPassword;
      try {
        hashedPassword = await bcrypt.hash(password, 10);
      } catch (hashErr) {
        fastify.log.error({ err: hashErr.message }, 'Password hash error on register');
        return reply.status(500).send({ error: 'Errore nel salvataggio della password' });
      }

      // Insert new user
      const insertResult = await query(
        `INSERT INTO users (
          "username", "email", "nome", "cognome", "password_hash", "attivo", "created_at"
         ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
         RETURNING "id" AS user_id, "username", "email", "nome", "cognome"`,
        [username, email, first_name || null, last_name || null, hashedPassword, true]
      );

      const newUser = insertResult.rows[0];
      return reply.status(201).send({
        message: 'Utente creato con successo',
        user: {
          id: newUser.user_id,
          username: newUser.username,
          email: newUser.email,
          nome: newUser.nome,
          cognome: newUser.cognome
        }
      });
    } catch (err) {
      fastify.log.error({ err: err.message, stack: err.stack, code: err.code }, 'Register error');
      return reply.status(500).send({ error: `Errore registrazione: ${err.message}` });
    }
  });

  // POST /api/auth/change-password (requires auth)
  fastify.post('/change-password', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { current_password, new_password } = request.body || {};

      if (!current_password || !new_password) {
        return reply.status(400).send({ error: 'Password corrente e nuova password richieste' });
      }

      // Fetch current user with password hash
      const userResult = await query(
        `SELECT "username", "password_hash" FROM users WHERE "username" = $1 LIMIT 1`,
        [request.user.username]
      );

      if (userResult.rows.length === 0) {
        return reply.status(404).send({ error: 'Utente non trovato' });
      }

      const user = userResult.rows[0];

      // If user has no password hash yet, current_password can be anything (first migration case)
      if (user.password_hash) {
        const passwordMatch = await bcrypt.compare(current_password, user.password_hash);
        if (!passwordMatch) {
          return reply.status(401).send({ error: 'Password corrente non valida' });
        }
      }

      // Hash new password
      let hashedNewPassword;
      try {
        hashedNewPassword = await bcrypt.hash(new_password, 10);
      } catch (hashErr) {
        fastify.log.error({ err: hashErr.message }, 'Password hash error on change');
        return reply.status(500).send({ error: 'Errore nel salvataggio della password' });
      }

      // Update password
      await query(
        `UPDATE users SET "password_hash" = $1 WHERE "username" = $2`,
        [hashedNewPassword, user.username]
      );

      return { message: 'Password aggiornata con successo' };
    } catch (err) {
      fastify.log.error({ err: err.message, stack: err.stack }, 'Change password error');
      return reply.status(500).send({ error: `Errore cambio password: ${err.message}` });
    }
  });
}
