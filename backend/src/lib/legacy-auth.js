/**
 * legacy-auth.js
 *
 * Wrapper di verifica password per utenti migrati dal sistema legacy
 * easywin.it (ASP.NET 4 Membership Provider, schema aspnet_Membership).
 *
 * Quando un utente prova a loggarsi e users.password_hash è NULL ma
 * users.legacy_password è popolata, questa funzione verifica la password
 * contro l'hash legacy SHA1+salt. Se OK, il chiamante deve:
 *   1. Generare un nuovo bcrypt
 *   2. UPDATE users SET password_hash = $bcrypt, legacy_password = NULL,
 *        legacy_salt = NULL, legacy_format = NULL,
 *        legacy_password_migrated_at = NOW()
 *
 * Così la migrazione del singolo utente è trasparente: prima login con
 * password legacy → automatica bcrypt-ificazione.
 *
 * ────────────────────────────────────────────────────────────────────
 * Formato hash aspnet_Membership (ASP.NET 4, PasswordFormat default = 1):
 *
 *   stored_password = Base64( SHA1( salt_bytes || password_bytes ) )
 *   stored_salt     = Base64( salt_bytes )
 *
 *   - salt_bytes:    16 bytes random (di solito) dal DB, decodificati da Base64
 *   - password_bytes: la password utente codificata in UTF-16 Little Endian
 *                     (perché .NET internamente usa UTF-16)
 *   - concatenazione: salt || password (in quest'ordine)
 *   - hash: SHA-1 (default ASP.NET 4)
 *   - encoding finale: Base64
 *
 * NB su PasswordFormat:
 *   0 = Clear     (cleartext nel DB — raro, deprecated dal 2004)
 *   1 = Hashed    (default — implementazione qui)
 *   2 = Encrypted (richiede machineKey → non supportato, ritorna false)
 *
 * Riferimenti:
 *   - Microsoft Reference Source: System.Web.Security.SqlMembershipProvider
 *   - https://referencesource.microsoft.com/#System.Web/Security/SqlMembershipProvider.cs
 * ────────────────────────────────────────────────────────────────────
 */

import crypto from 'node:crypto';

/**
 * Costanti del provider legacy.
 */
const PASSWORD_FORMAT = {
  CLEAR: 0,
  HASHED: 1,
  ENCRYPTED: 2
};

/**
 * Costante-time string comparison per evitare timing attack.
 * crypto.timingSafeEqual richiede buffer di stessa lunghezza, quindi
 * paddiamo se necessario (per stringhe Base64 di hash SHA1 lunghezza
 * fissa = 28 char, ma comunque safety net).
 */
function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/**
 * Verifica una password legacy aspnet_Membership.
 *
 * @param {string} clearPassword   Password in chiaro inviata dall'utente
 * @param {string} storedPassword  Hash legacy (Base64) da users.legacy_password
 * @param {string|null} storedSalt Salt legacy (Base64) da users.legacy_salt
 *                                 (NULL solo se format=0 Clear)
 * @param {number} format          users.legacy_format (0/1/2)
 * @returns {{ valid: boolean, reason?: string }}
 */
export function verifyLegacyPassword(clearPassword, storedPassword, storedSalt, format) {
  // Defensive: tutti i parametri devono essere presenti
  if (clearPassword == null || storedPassword == null) {
    return { valid: false, reason: 'missing input' };
  }
  if (typeof clearPassword !== 'string') {
    return { valid: false, reason: 'invalid password type' };
  }

  // Normalizza format: SQL Server può ritornare numeric, smallint, o
  // anche stringa via pgloader.
  const fmt = Number(format);

  // ──────────────────────────────────────────────────────────────────
  // Format 0: Clear (cleartext)
  // ──────────────────────────────────────────────────────────────────
  if (fmt === PASSWORD_FORMAT.CLEAR) {
    return {
      valid: safeCompare(clearPassword, storedPassword),
      reason: 'clear'
    };
  }

  // ──────────────────────────────────────────────────────────────────
  // Format 1: Hashed (SHA1 + salt, UTF-16 LE) — il caso usuale
  // ──────────────────────────────────────────────────────────────────
  if (fmt === PASSWORD_FORMAT.HASHED) {
    if (!storedSalt) {
      return { valid: false, reason: 'missing salt for hashed format' };
    }

    let saltBytes;
    try {
      saltBytes = Buffer.from(storedSalt, 'base64');
    } catch {
      return { valid: false, reason: 'invalid base64 salt' };
    }

    // ASP.NET .NET 4 usa UTF-16 Little Endian per la password durante
    // l'hash (perché string è internamente UTF-16). In Node.js l'encoding
    // 'utf16le' fa esattamente questo.
    const passwordBytes = Buffer.from(clearPassword, 'utf16le');

    // Concatenazione: salt || password (questo ordine, non inverso)
    const combined = Buffer.concat([saltBytes, passwordBytes]);

    // SHA-1 e Base64 finale
    const computedHash = crypto.createHash('sha1').update(combined).digest('base64');

    return {
      valid: safeCompare(computedHash, storedPassword),
      reason: 'hashed_sha1'
    };
  }

  // ──────────────────────────────────────────────────────────────────
  // Format 2: Encrypted (richiede machineKey AES) — non supportato
  // ──────────────────────────────────────────────────────────────────
  if (fmt === PASSWORD_FORMAT.ENCRYPTED) {
    return {
      valid: false,
      reason: 'encrypted_format_not_supported'
    };
  }

  // Format sconosciuto
  return { valid: false, reason: `unknown_format_${fmt}` };
}

/**
 * Helper "high-level": fa SELECT da users, verifica legacy, e se OK
 * aggiorna users con bcrypt. Pensato per essere chiamato da auth.js.
 *
 * @param {Function} query           Funzione query(sql, params) → Promise<{rows}>
 * @param {Function} bcrypt          Modulo bcrypt(js) con .hash(pw, rounds)
 * @param {Object}   user            Riga di users con almeno {id, username,
 *                                   legacy_password, legacy_salt, legacy_format}
 * @param {string}   clearPassword   Password in chiaro
 * @returns {{ migrated: boolean, error?: string }}
 *   - migrated:true  → password legacy era corretta, utente bcrypt-ificato
 *   - migrated:false → password legacy NON corretta (oppure no colonne legacy)
 */
export async function tryMigrateLegacyPassword(query, bcrypt, user, clearPassword) {
  if (!user.legacy_password) {
    return { migrated: false, error: 'no_legacy_password' };
  }

  const result = verifyLegacyPassword(
    clearPassword,
    user.legacy_password,
    user.legacy_salt,
    user.legacy_format
  );

  if (!result.valid) {
    return { migrated: false, error: result.reason || 'invalid_legacy_password' };
  }

  // Password legacy corretta → bcrypt-ifico e azzero legacy_*
  const bcryptHash = await bcrypt.hash(clearPassword, 10);
  await query(
    `UPDATE users
        SET password_hash = $1,
            legacy_password = NULL,
            legacy_salt = NULL,
            legacy_format = NULL,
            legacy_password_migrated_at = NOW()
      WHERE id = $2`,
    [bcryptHash, user.id]
  );

  return { migrated: true };
}
