-- Migrazione 015 — Selezioni utenti per le 4 sezioni del vecchio sito
-- (SelezioneBandi, SelezioneEsiti, NewsletterBandi, NewsletterEsiti)
--
-- Una riga per (username, scope). Il payload è completamente in JSONB:
--   regioni      [id, id, ...]              regioni selezionate a livello master
--   province     [id, id, ...]              province a livello master
--   soa_lavori   [{id,selezionato,regioni,province}]
--   soa_servizi  [{id,selezionato,regioni,province}]
--   cpv          [{codice,selezionato,regioni,province}]
--   opzioni      { associa_servizi: bool, collassa_non_selezionate: bool, ... }

CREATE TABLE IF NOT EXISTS users_selezioni (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  scope TEXT NOT NULL,
  regioni JSONB NOT NULL DEFAULT '[]'::jsonb,
  province JSONB NOT NULL DEFAULT '[]'::jsonb,
  soa_lavori JSONB NOT NULL DEFAULT '[]'::jsonb,
  soa_servizi JSONB NOT NULL DEFAULT '[]'::jsonb,
  cpv JSONB NOT NULL DEFAULT '[]'::jsonb,
  opzioni JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT users_selezioni_scope_valid
    CHECK (scope IN ('bandi','esiti','newsletter_bandi','newsletter_esiti'))
);

-- Indice unico (username, scope)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'users_selezioni' AND indexname = 'users_selezioni_user_scope_key'
  ) THEN
    CREATE UNIQUE INDEX users_selezioni_user_scope_key
      ON users_selezioni(username, scope);
  END IF;
END $$;

-- Lookup veloce per admin
CREATE INDEX IF NOT EXISTS users_selezioni_username_idx ON users_selezioni(username);
