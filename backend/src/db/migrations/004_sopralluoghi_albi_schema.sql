-- ============================================================
-- EASYWIN - PostgreSQL Schema Migration 004
-- Module: Sopralluoghi Map + Albi Fornitori
-- Date: March 2026
-- ============================================================

-- ============================================================
-- ALBI FORNITORI (Supplier Registries)
-- ============================================================

CREATE TABLE albi_fornitori (
    id SERIAL PRIMARY KEY,
    id_stazione INTEGER NOT NULL REFERENCES stazioni(id),

    -- Registry info
    nome_albo VARCHAR(500),                     -- Name of the registry
    url_albo VARCHAR(500),                      -- URL to the registry
    piattaforma VARCHAR(200),                   -- Platform used
    scadenza_iscrizione DATE,                   -- Registration deadline
    rinnovo_automatico BOOLEAN DEFAULT false,
    frequenza_rinnovo VARCHAR(100),             -- e.g. "annuale", "biennale"

    -- Documentation
    documenti_richiesti JSONB,                  -- Array of required docs
    procedura_iscrizione TEXT,                  -- Step-by-step instructions
    note TEXT,
    categorie_merceologiche TEXT[],             -- Product categories
    categorie_soa TEXT[],                       -- SOA categories accepted

    -- Status
    attivo BOOLEAN DEFAULT true,
    ultimo_aggiornamento TIMESTAMPTZ,
    verificato BOOLEAN DEFAULT false,
    verificato_da VARCHAR(100),
    verificato_il TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_albi_stazione ON albi_fornitori(id_stazione);
CREATE INDEX idx_albi_attivo ON albi_fornitori(attivo);

-- ============================================================
-- ISCRIZIONI ALBO (Company registrations to registries)
-- ============================================================

CREATE TABLE iscrizioni_albo (
    id SERIAL PRIMARY KEY,
    id_albo INTEGER NOT NULL REFERENCES albi_fornitori(id) ON DELETE CASCADE,
    id_azienda INTEGER NOT NULL REFERENCES aziende(id),

    -- Status
    iscritto BOOLEAN DEFAULT false,
    data_iscrizione DATE,
    data_scadenza DATE,
    stato VARCHAR(50) DEFAULT 'da_verificare',  -- iscritto, non_iscritto, scaduto, da_verificare
    numero_iscrizione VARCHAR(100),

    -- Documentation tracking
    documenti_caricati JSONB,
    documenti_mancanti TEXT[],

    note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(id_albo, id_azienda)
);

CREATE INDEX idx_iscrizioni_azienda ON iscrizioni_albo(id_azienda);
CREATE INDEX idx_iscrizioni_albo ON iscrizioni_albo(id_albo);

-- ============================================================
-- RICHIESTE SERVIZIO ALBI (Service requests from EasyWin)
-- ============================================================

CREATE TABLE richieste_servizio_albi (
    id SERIAL PRIMARY KEY,
    id_albo INTEGER NOT NULL REFERENCES albi_fornitori(id),
    id_azienda INTEGER NOT NULL REFERENCES aziende(id),
    username VARCHAR(100),

    tipo_richiesta VARCHAR(50) NOT NULL,         -- 'iscrizione', 'rinnovo', 'verifica'
    stato VARCHAR(50) DEFAULT 'ricevuta',        -- ricevuta, in_lavorazione, completata, annullata
    note TEXT,
    note_easywin TEXT,                           -- Internal EasyWin notes

    -- Pricing
    preventivo DECIMAL(10,2),
    accettato BOOLEAN,
    pagato BOOLEAN DEFAULT false,

    data_richiesta TIMESTAMPTZ DEFAULT NOW(),
    data_completamento TIMESTAMPTZ,
    completato_da VARCHAR(100),

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_richieste_albi_azienda ON richieste_servizio_albi(id_azienda);
CREATE INDEX idx_richieste_albi_stato ON richieste_servizio_albi(stato);
