import { query } from '../db/pool.js';
import bcrypt from 'bcryptjs';

export default async function authRoutes(fastify, opts) {

  // Ensure PasswordHash column exists (migrated from ASP.NET Membership)
  try {
    await query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'users' AND column_name = 'PasswordHash'
        ) THEN
          ALTER TABLE users ADD COLUMN "PasswordHash" VARCHAR(255);
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
        `SELECT "UserName", "Email", "FirstName", "LastName", "Company",
                "PartitaIva", "IsApproved", "Expire", "ExpireBandi", "PasswordHash"
         FROM users
         WHERE "UserName" = $1 OR "Email" = $1
         LIMIT 1`,
        [username]
      );

      if (result.rows.length === 0) {
        return reply.status(401).send({ error: 'Credenziali non valide' });
      }

      const user = result.rows[0];

      // Check if user is approved
      if (user.IsApproved === false) {
        return reply.status(403).send({ error: 'Account non ancora approvato' });
      }

      // Password validation: handle legacy migration from ASP.NET Membership
      if (user.PasswordHash) {
        // User already has a password hash (migrated or first-login from new register endpoint)
        const passwordMatch = await bcrypt.compare(password, user.PasswordHash);
        if (!passwordMatch) {
          return reply.status(401).send({ error: 'Credenziali non valide' });
        }
      } else {
        // First login for user without password hash: hash the provided password and store it
        // This handles users migrated from legacy ASP.NET Membership system
        try {
          const hashedPassword = await bcrypt.hash(password, 10);
          await query(
            `UPDATE users SET "PasswordHash" = $1 WHERE "UserName" = $2`,
            [hashedPassword, user.UserName]
          );
        } catch (hashErr) {
          fastify.log.error({ err: hashErr.message }, 'Password hash error on first login');
          return reply.status(500).send({ error: 'Errore nel salvataggio della password' });
        }
      }

      const token = fastify.jwt.sign({
        username: user.UserName,
        email: user.Email,
        company: user.Company
      }, { expiresIn: '24h' });

      return {
        token,
        user: {
          username: user.UserName,
          email: user.Email,
          nome: user.FirstName,
          cognome: user.LastName,
          azienda: user.Company,
          partita_iva: user.PartitaIva
        }
      };
    } catch (err) {
      fastify.log.error({ err: err.message, stack: err.stack, code: err.code }, 'Login error');
      return reply.status(500).send({ error: `Errore login: ${err.message}` });
    }
  });

  // GET /api/auth/me
  fastify.get('/me', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const result = await query(
        `SELECT "UserName", "Email", "FirstName", "LastName", "Company",
                "PartitaIva", "CodiceFiscale", "Citta", "Provincia",
                "Telefono", "IsApproved", "Expire", "ExpireBandi",
                "ExpirePresidia"
         FROM users
         WHERE "UserName" = $1`,
        [request.user.username]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ error: 'Utente non trovato' });
      }

      const u = result.rows[0];
      return {
        username: u.UserName,
        email: u.Email,
        nome: u.FirstName,
        cognome: u.LastName,
        azienda: u.Company,
        partita_iva: u.PartitaIva,
        codice_fiscale: u.CodiceFiscale,
        citta: u.Citta,
        provincia: u.Provincia,
        telefono: u.Telefono,
        approvato: u.IsApproved,
        scadenza_esiti: u.Expire,
        scadenza_bandi: u.ExpireBandi,
        scadenza_presidia: u.ExpirePresidia
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
        `SELECT "UserName" FROM users WHERE "UserName" = $1 OR "Email" = $2 LIMIT 1`,
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
          "UserName", "Email", "FirstName", "LastName", "Company",
          "PartitaIva", "PasswordHash", "IsApproved", "CreatedDate"
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
         RETURNING "UserName", "Email", "FirstName", "LastName", "Company", "PartitaIva"`,
        [username, email, first_name || null, last_name || null, company || null, partita_iva || null, hashedPassword, true]
      );

      const newUser = insertResult.rows[0];
      return reply.status(201).send({
        message: 'Utente creato con successo',
        user: {
          username: newUser.UserName,
          email: newUser.Email,
          nome: newUser.FirstName,
          cognome: newUser.LastName,
          azienda: newUser.Company,
          partita_iva: newUser.PartitaIva
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
        `SELECT "UserName", "PasswordHash" FROM users WHERE "UserName" = $1 LIMIT 1`,
        [request.user.username]
      );

      if (userResult.rows.length === 0) {
        return reply.status(404).send({ error: 'Utente non trovato' });
      }

      const user = userResult.rows[0];

      // If user has no password hash yet, current_password can be anything (first migration case)
      if (user.PasswordHash) {
        const passwordMatch = await bcrypt.compare(current_password, user.PasswordHash);
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
        `UPDATE users SET "PasswordHash" = $1 WHERE "UserName" = $2`,
        [hashedNewPassword, user.UserName]
      );

      return { message: 'Password aggiornata con successo' };
    } catch (err) {
      fastify.log.error({ err: err.message, stack: err.stack }, 'Change password error');
      return reply.status(500).send({ error: `Errore cambio password: ${err.message}` });
    }
  });
}
