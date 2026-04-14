-- Migration 027: create users_email_secondarie table
-- Stores secondary email addresses for CC on newsletter/alert sends.
-- Referenced by mail-helpers.js getSecondaryEmails().

CREATE TABLE IF NOT EXISTS users_email_secondarie (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email       VARCHAR(300) NOT NULL,
    etichetta   VARCHAR(100),
    attiva      BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email_sec_user ON users_email_secondarie(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_sec_unique ON users_email_secondarie(user_id, email);

COMMENT ON TABLE users_email_secondarie IS 'Email secondarie per invio CC newsletter/alert. Una riga per email per utente.';
