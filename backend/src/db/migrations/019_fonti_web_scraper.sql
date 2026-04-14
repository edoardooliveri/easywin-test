-- =====================================================
-- 019: Fonti Web Scraper — colonne e tabelle mancanti
-- Idempotente: usa IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
-- =====================================================

-- 1. Colonna id_fonte_web su bandi (per tracciare origine)
ALTER TABLE bandi ADD COLUMN IF NOT EXISTS id_fonte_web INTEGER REFERENCES fonti_web(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_bandi_fonte_web ON bandi(id_fonte_web);

-- 2. Tabella fonti_web_differenze (traccia bandi trovati/aggiornati)
CREATE TABLE IF NOT EXISTS fonti_web_differenze (
  id              SERIAL PRIMARY KEY,
  id_fonte        INTEGER NOT NULL REFERENCES fonti_web(id) ON DELETE CASCADE,
  titolo          TEXT,
  url             TEXT,
  tipo_differenza VARCHAR(30) DEFAULT 'nuovo',   -- 'nuovo', 'aggiornato', 'rimosso'
  dati_estratti   JSONB,                          -- dati grezzi estratti dal parsing
  id_bando        UUID REFERENCES bandi(id) ON DELETE SET NULL,
  data_rilevamento TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fwd_fonte ON fonti_web_differenze(id_fonte);
CREATE INDEX IF NOT EXISTS idx_fwd_data ON fonti_web_differenze(data_rilevamento DESC);

-- 3. Colonne mancanti su fonti_web_sync_check (allineamento con le route)
ALTER TABLE fonti_web_sync_check ADD COLUMN IF NOT EXISTS timestamp TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE fonti_web_sync_check ADD COLUMN IF NOT EXISTS nuovi_bandi INTEGER DEFAULT 0;
ALTER TABLE fonti_web_sync_check ADD COLUMN IF NOT EXISTS aggiornati INTEGER DEFAULT 0;
ALTER TABLE fonti_web_sync_check ADD COLUMN IF NOT EXISTS errore TEXT;

-- 4. Tabella fonti_web_testi_chiave se non esiste (le route la usano)
CREATE TABLE IF NOT EXISTS fonti_web_testi_chiave (
  id       SERIAL PRIMARY KEY,
  id_fonte INTEGER NOT NULL REFERENCES fonti_web(id) ON DELETE CASCADE,
  testo    VARCHAR(500) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fwtc_fonte ON fonti_web_testi_chiave(id_fonte);

-- 5. Colonne mancanti su fonti_web (allineamento route → schema legacy)
-- Il vecchio schema ha: link, attivo, ultima_verifica, errore
-- Le route usano: nome, url, attiva, ultimo_controllo, ultimo_errore, intervallo_minuti
ALTER TABLE fonti_web ADD COLUMN IF NOT EXISTS nome VARCHAR(300);
ALTER TABLE fonti_web ADD COLUMN IF NOT EXISTS url TEXT;
ALTER TABLE fonti_web ADD COLUMN IF NOT EXISTS attiva BOOLEAN DEFAULT true;
ALTER TABLE fonti_web ADD COLUMN IF NOT EXISTS intervallo_minuti INTEGER DEFAULT 360;
ALTER TABLE fonti_web ADD COLUMN IF NOT EXISTS ultimo_controllo TIMESTAMPTZ;
ALTER TABLE fonti_web ADD COLUMN IF NOT EXISTS ultimo_errore TEXT;
ALTER TABLE fonti_web ADD COLUMN IF NOT EXISTS regex_titolo TEXT;
ALTER TABLE fonti_web ADD COLUMN IF NOT EXISTS regex_data TEXT;
ALTER TABLE fonti_web ADD COLUMN IF NOT EXISTS regex_importo TEXT;
ALTER TABLE fonti_web ADD COLUMN IF NOT EXISTS regex_cig TEXT;

-- Sync dati legacy → nuove colonne (copia link→url, attivo→attiva, ecc.)
UPDATE fonti_web SET url = link WHERE url IS NULL AND link IS NOT NULL;
UPDATE fonti_web SET attiva = attivo WHERE attiva IS NULL AND attivo IS NOT NULL;
UPDATE fonti_web SET ultimo_controllo = ultima_verifica WHERE ultimo_controllo IS NULL AND ultima_verifica IS NOT NULL;
UPDATE fonti_web SET ultimo_errore = errore WHERE ultimo_errore IS NULL AND errore IS NOT NULL;

-- 6. Tabella fonti_web_regex (pattern library)
CREATE TABLE IF NOT EXISTS fonti_web_regex (
  id          SERIAL PRIMARY KEY,
  pattern     TEXT NOT NULL,
  tipo        VARCHAR(50),
  descrizione TEXT
);

-- 7. Tabelle di categorizzazione (se non esistono)
CREATE TABLE IF NOT EXISTS fonti_categorie (
  id   SERIAL PRIMARY KEY,
  nome VARCHAR(200) NOT NULL
);
CREATE TABLE IF NOT EXISTS fonti_tipologie (
  id   SERIAL PRIMARY KEY,
  nome VARCHAR(200) NOT NULL
);
