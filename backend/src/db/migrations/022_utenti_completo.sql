-- 022_utenti_completo.sql
-- Colonne mancanti users + tabelle periodi/pagamenti/selezioni/albo AI

-- === USERS: colonne mancanti ===
DO $$ BEGIN
  -- Rinnovo esiti/bandi (matrice abbonamento)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='rinnovo_esiti') THEN
    ALTER TABLE users ADD COLUMN rinnovo_esiti boolean DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='rinnovo_bandi') THEN
    ALTER TABLE users ADD COLUMN rinnovo_bandi boolean DEFAULT false;
  END IF;
  -- Scadenza esiti (nel vecchio era data_scadenza, aggiungiamo alias esplicito)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='scadenza_esiti') THEN
    ALTER TABLE users ADD COLUMN scadenza_esiti date;
  END IF;
  -- Albo Fornitori AI
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='abbonato_albo_ai') THEN
    ALTER TABLE users ADD COLUMN abbonato_albo_ai boolean DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='prezzo_albo_ai') THEN
    ALTER TABLE users ADD COLUMN prezzo_albo_ai numeric DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='provv_albo_ai') THEN
    ALTER TABLE users ADD COLUMN provv_albo_ai numeric DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='inizio_albo_ai') THEN
    ALTER TABLE users ADD COLUMN inizio_albo_ai date;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='scadenza_albo_ai') THEN
    ALTER TABLE users ADD COLUMN scadenza_albo_ai date;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='rinnovo_albo_ai') THEN
    ALTER TABLE users ADD COLUMN rinnovo_albo_ai boolean DEFAULT false;
  END IF;
END $$;

-- === PERIODI ===
CREATE TABLE IF NOT EXISTS periodi (
  id SERIAL PRIMARY KEY,
  username VARCHAR(200) NOT NULL,
  data_inizio DATE,
  data_fine DATE,
  tipo VARCHAR(50) DEFAULT 'standard',
  note TEXT,
  -- Prezzi per servizio
  prezzo_esiti NUMERIC DEFAULT 0,
  prezzo_bandi NUMERIC DEFAULT 0,
  prezzo_esiti_light NUMERIC DEFAULT 0,
  prezzo_newsletter_esiti NUMERIC DEFAULT 0,
  prezzo_newsletter_bandi NUMERIC DEFAULT 0,
  prezzo_albo_ai NUMERIC DEFAULT 0,
  prezzo_aperture NUMERIC DEFAULT 0,
  prezzo_elaborati NUMERIC DEFAULT 0,
  prezzo_sopralluoghi NUMERIC DEFAULT 0,
  prezzo_scritture NUMERIC DEFAULT 0,
  -- Provvigioni
  provv_esiti NUMERIC DEFAULT 0,
  provv_bandi NUMERIC DEFAULT 0,
  provv_esiti_light NUMERIC DEFAULT 0,
  provv_newsletter_esiti NUMERIC DEFAULT 0,
  provv_newsletter_bandi NUMERIC DEFAULT 0,
  provv_albo_ai NUMERIC DEFAULT 0,
  -- Date inizio/scadenza per servizio
  inizio_esiti DATE,
  inizio_bandi DATE,
  inizio_esiti_light DATE,
  inizio_newsletter_esiti DATE,
  inizio_newsletter_bandi DATE,
  inizio_albo_ai DATE,
  scadenza_esiti DATE,
  scadenza_bandi DATE,
  scadenza_esiti_light DATE,
  scadenza_newsletter_esiti DATE,
  scadenza_newsletter_bandi DATE,
  scadenza_albo_ai DATE,
  -- Rinnovo
  rinnovo_esiti BOOLEAN DEFAULT false,
  rinnovo_bandi BOOLEAN DEFAULT false,
  rinnovo_esiti_light BOOLEAN DEFAULT false,
  rinnovo_newsletter_esiti BOOLEAN DEFAULT false,
  rinnovo_newsletter_bandi BOOLEAN DEFAULT false,
  rinnovo_albo_ai BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_periodi_username ON periodi(username);

-- === FATTURE PROFORMA ===
CREATE TABLE IF NOT EXISTS fatture_proforma (
  id SERIAL PRIMARY KEY,
  username VARCHAR(200) NOT NULL,
  id_periodo INTEGER REFERENCES periodi(id) ON DELETE SET NULL,
  numero VARCHAR(50),
  anno INTEGER,
  data DATE,
  descrizione TEXT,
  imponibile NUMERIC DEFAULT 0,
  iva NUMERIC DEFAULT 0,
  totale NUMERIC DEFAULT 0,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fatture_proforma_username ON fatture_proforma(username);

-- === PAGAMENTI ===
CREATE TABLE IF NOT EXISTS pagamenti (
  id SERIAL PRIMARY KEY,
  id_fattura INTEGER REFERENCES fatture(id) ON DELETE CASCADE,
  importo NUMERIC DEFAULT 0,
  data DATE,
  tipo VARCHAR(50),
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pagamenti_fattura ON pagamenti(id_fattura);

-- === USERS SELEZIONI (JSON-based) ===
CREATE TABLE IF NOT EXISTS users_selezioni (
  id SERIAL PRIMARY KEY,
  username VARCHAR(200) NOT NULL,
  scope VARCHAR(50) NOT NULL,
  regioni JSONB DEFAULT '[]',
  province JSONB DEFAULT '[]',
  soa_lavori JSONB DEFAULT '[]',
  soa_servizi JSONB DEFAULT '[]',
  cpv JSONB DEFAULT '[]',
  opzioni JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(username, scope)
);

-- === ALBO FORNITORI AI ===
CREATE TABLE IF NOT EXISTS utenti_albo_ai_preferenze (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  soa_codici TEXT[] DEFAULT '{}',
  province TEXT[] DEFAULT '{}',
  cpv_codici TEXT[] DEFAULT '{}',
  soglia_min_negoziate INTEGER DEFAULT 0,
  notifiche_nuovi_albi BOOLEAN DEFAULT true,
  note TEXT,
  auto_popolato_soa BOOLEAN DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS utenti_albo_ai_raccomandazioni (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  id_stazione INTEGER NOT NULL,
  score NUMERIC NOT NULL DEFAULT 0,
  n_negoziate_anno INTEGER DEFAULT 0,
  soa_match TEXT[] DEFAULT '{}',
  cpv_match TEXT[] DEFAULT '{}',
  motivazione TEXT,
  calcolato_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_albo_ai_racc_user ON utenti_albo_ai_raccomandazioni(username, score DESC);
CREATE INDEX IF NOT EXISTS idx_albo_ai_racc_staz ON utenti_albo_ai_raccomandazioni(id_stazione);
