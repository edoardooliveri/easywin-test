-- =====================================================
-- 016: Regole di filtro bandi per utente
-- Ogni utente può avere N regole (SOA + province + importi).
-- Il matching "bando → cliente" usa OR tra le regole:
-- basta che il bando soddisfi almeno UNA regola.
-- =====================================================

CREATE TABLE IF NOT EXISTS utenti_filtri_bandi (
  id              SERIAL PRIMARY KEY,
  id_utente       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Categoria SOA (nullable = qualsiasi)
  id_soa          INTEGER REFERENCES soa(id),

  -- Province: array di ID oppure riga nella tabella ponte
  -- Usiamo un campo JSON per flessibilità: [1, 4, 12]
  province_ids    JSONB DEFAULT '[]',

  -- Range importo (nullable = qualsiasi)
  importo_min     NUMERIC(15,2) DEFAULT 0,
  importo_max     NUMERIC(15,2) DEFAULT 0,

  -- Descrizione leggibile (auto-generata dall'UI)
  descrizione     TEXT,

  -- Flag attivo
  attivo          BOOLEAN DEFAULT true,

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Indici per il matching veloce
CREATE INDEX IF NOT EXISTS idx_ufb_utente ON utenti_filtri_bandi(id_utente);
CREATE INDEX IF NOT EXISTS idx_ufb_soa ON utenti_filtri_bandi(id_soa);
CREATE INDEX IF NOT EXISTS idx_ufb_attivo ON utenti_filtri_bandi(attivo);

COMMENT ON TABLE utenti_filtri_bandi IS 'Regole di filtro bandi per ogni utente. Ogni riga è una regola indipendente (OR tra regole dello stesso utente).';
