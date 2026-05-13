-- ============================================================================
-- Migration 037: colonne per legacy password aspnet_Membership
-- ============================================================================
-- Audit auth.js (2026-05-13) ha rilevato un SECURITY BUG nella login:
--
--   if (user.password_hash) {
--     // bcrypt.compare normale
--   } else {
--     // ⚠️ ACCETTA QUALSIASI PASSWORD e la salva come hash!
--     hashedPassword = await bcrypt.hash(password, 10);
--     UPDATE users SET password_hash = ... WHERE username = ...;
--   }
--
-- Questo permette login con QUALSIASI password al primo accesso per utenti
-- migrati dal legacy senza password_hash. CHIUNQUE conoscendo uno username
-- valido può prendere possesso dell'account.
--
-- Fix in 2 step:
--   1. (qui) Aggiungere colonne legacy_password/legacy_salt/legacy_format
--      così la migrazione dati può portare via i hash SHA1 di aspnet_Membership
--   2. backend/src/lib/legacy-auth.js + auth.js aggiornato:
--      - verifica SHA1(salt + UTF16-LE(password)) prima di accettare login
--      - se match: bcrypt-ifica e azzera le colonne legacy_*
--      - se NO match: 401 (no più "accetta tutto")
-- ============================================================================

-- NB: rimossi \timing on e \set ON_ERROR_STOP on perché sono meta-comandi
-- psql client-side. Quando server.js auto-migra via pool.query() li interpreta
-- come SQL pure, generando syntax error. Li lasciamo come commento per chi
-- esegue manualmente: psql -f 037_legacy_auth_columns.sql --set ON_ERROR_STOP=on

BEGIN;

-- ----------------------------------------------------------------------------
-- Schema legacy aspnet_Membership su SQL Server:
--   Password         NVARCHAR(128)  — Base64 dell'hash o cleartext (raro)
--   PasswordSalt     NVARCHAR(128)  — Base64 del salt (per Hashed) o NULL
--   PasswordFormat   INT            — 0=Clear, 1=Hashed (SHA1, default), 2=Encrypted
-- ----------------------------------------------------------------------------

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS legacy_password TEXT,
    ADD COLUMN IF NOT EXISTS legacy_salt     TEXT,
    ADD COLUMN IF NOT EXISTS legacy_format   SMALLINT,
    -- Quando l'utente fa il primo login con password legacy corretta, qui
    -- viene scritta la data di migrazione (poi le 3 colonne legacy_* sono
    -- azzerate). Utile per audit.
    ADD COLUMN IF NOT EXISTS legacy_password_migrated_at TIMESTAMPTZ;

-- Rendi password_hash NULLABLE: gli utenti migrati da legacy aspnet_Membership
-- hanno solo legacy_password (SHA1+salt) finché non fanno il primo login.
-- Senza questo, l'INSERT della migrazione anagrafica esplode con NOT NULL violation.
DO $$
BEGIN
    -- Solo se la colonna è ancora NOT NULL
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users'
          AND column_name = 'password_hash'
          AND is_nullable = 'NO'
    ) THEN
        ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
        RAISE NOTICE 'Migration 037: users.password_hash ora NULLABLE (per utenti legacy)';
    END IF;
END $$;

COMMENT ON COLUMN users.legacy_password IS
    'Hash legacy aspnet_Membership.Password (Base64 SHA1 o cleartext). NULL dopo primo login con password corretta.';
COMMENT ON COLUMN users.legacy_salt IS
    'Salt legacy aspnet_Membership.PasswordSalt (Base64). NULL se PasswordFormat=0 (Clear).';
COMMENT ON COLUMN users.legacy_format IS
    'Legacy aspnet_Membership.PasswordFormat: 0=Clear, 1=Hashed (SHA1, default), 2=Encrypted (non supportato).';
COMMENT ON COLUMN users.legacy_password_migrated_at IS
    'Timestamp del primo login con password legacy corretta (= momento bcrypt-ificazione).';

-- Indice parziale per trovare velocemente gli utenti ancora non migrati
CREATE INDEX IF NOT EXISTS idx_users_legacy_pending
    ON users (id)
    WHERE legacy_password IS NOT NULL;

-- ----------------------------------------------------------------------------
-- Verifica
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    has_legacy_pwd boolean;
    has_legacy_salt boolean;
    has_legacy_fmt boolean;
BEGIN
    SELECT EXISTS(SELECT 1 FROM information_schema.columns
                  WHERE table_name='users' AND column_name='legacy_password')
        INTO has_legacy_pwd;
    SELECT EXISTS(SELECT 1 FROM information_schema.columns
                  WHERE table_name='users' AND column_name='legacy_salt')
        INTO has_legacy_salt;
    SELECT EXISTS(SELECT 1 FROM information_schema.columns
                  WHERE table_name='users' AND column_name='legacy_format')
        INTO has_legacy_fmt;

    RAISE NOTICE 'Migration 037 — colonne legacy auth aggiunte:';
    RAISE NOTICE '  users.legacy_password:               %', has_legacy_pwd;
    RAISE NOTICE '  users.legacy_salt:                   %', has_legacy_salt;
    RAISE NOTICE '  users.legacy_format:                 %', has_legacy_fmt;
    RAISE NOTICE '  users.legacy_password_migrated_at:   ok';

    IF NOT (has_legacy_pwd AND has_legacy_salt AND has_legacy_fmt) THEN
        RAISE WARNING 'Migration 037: una o piu colonne NON create!';
    ELSE
        RAISE NOTICE 'Migration 037: OK';
    END IF;
END $$;

COMMIT;
