-- ============================================================
-- EASYWIN - PostgreSQL Schema Migration 003
-- Module: Simulazioni AI (Tender Simulations)
-- Date: March 2026
-- ============================================================

-- ============================================================
-- MAIN TABLE: SIMULAZIONI
-- ============================================================

CREATE TABLE simulazioni (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    username VARCHAR(100),
    titolo VARCHAR(500),
    stazione VARCHAR(500),
    oggetto TEXT,

    -- Filter criteria
    id_soa INTEGER REFERENCES soa(id),
    id_regione INTEGER REFERENCES regioni(id),
    id_provincia INTEGER REFERENCES province(id),
    id_tipologia INTEGER REFERENCES tipologia_gare(id),
    id_tipo_sim INTEGER,                        -- Simulation type
    data_min DATE,
    data_max DATE,
    importo_min DECIMAL(18,2),
    importo_max DECIMAL(18,2),

    -- Calculation results
    media_ar DECIMAL(15,6),                     -- Arithmetic mean
    soglia_an DECIMAL(15,6),                    -- Anomaly threshold
    s_soglia_an DECIMAL(15,6),                  -- Second anomaly threshold
    media_sc DECIMAL(15,6),                     -- Mean of deviations
    ribasso DECIMAL(10,6),                      -- Simulated discount
    n_gare INTEGER DEFAULT 0,                   -- Number of gare used
    n_partecipanti INTEGER DEFAULT 0,
    n_sorteggio INTEGER DEFAULT 0,
    n_decimali SMALLINT DEFAULT 3,

    -- Winner
    id_vincitore INTEGER REFERENCES aziende(id),
    vincitore VARCHAR(500),
    esito TEXT,
    codice_cig VARCHAR(20),
    data DATE,
    importo DECIMAL(18,2),
    id_attestazione INTEGER,

    -- Configuration
    accorpa_ali BOOLEAN DEFAULT false,
    tipo_accorpa_ali INTEGER,
    mode_offset INTEGER DEFAULT 0,
    variante VARCHAR(10) DEFAULT 'BASE',
    ali_in_somma_ribassi BOOLEAN DEFAULT false,
    soglia_riferimento DOUBLE PRECISION,

    -- Scarto calculation
    sc_offerte_ammesse INTEGER,
    sc_rapporto_scarto_media DECIMAL(15,6),
    sc_seconda_soglia DECIMAL(15,6),
    sc_primo_dec DECIMAL(15,6),
    sc_secondo_dec DECIMAL(15,6),
    sc_tipo_calcolo INTEGER,

    -- Rounding and calculation type
    tipo_arrotondamento INTEGER DEFAULT 0,
    tipo_calcolo INTEGER DEFAULT 0,

    -- AI enhancement
    ai_powered BOOLEAN DEFAULT false,
    ai_explanation TEXT,                         -- AI explanation of results
    ai_suggestions JSONB,                       -- AI strategic suggestions
    ai_confidence DECIMAL(5,2),

    -- Audit
    data_inserimento TIMESTAMPTZ DEFAULT NOW(),
    data_modifica TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_simulazioni_username ON simulazioni(username);
CREATE INDEX idx_simulazioni_soa ON simulazioni(id_soa);
CREATE INDEX idx_simulazioni_regione ON simulazioni(id_regione);
CREATE INDEX idx_simulazioni_data ON simulazioni(data_inserimento DESC);

-- ============================================================
-- SIMULAZIONI DETTAGLI (Per-company breakdown)
-- ============================================================

CREATE TABLE simulazioni_dettagli (
    id SERIAL PRIMARY KEY,
    id_simulazione UUID NOT NULL REFERENCES simulazioni(id) ON DELETE CASCADE,
    variante VARCHAR(10) DEFAULT 'BASE',
    id_azienda INTEGER REFERENCES aziende(id),
    ragione_sociale VARCHAR(500),

    -- Bid data
    ribasso DECIMAL(10,6),
    posizione INTEGER,
    taglio_ali BOOLEAN DEFAULT false,
    m_media_arit DECIMAL(15,6),
    anomala BOOLEAN DEFAULT false,
    vincitrice BOOLEAN DEFAULT false,

    -- Stats
    n_partecipate INTEGER DEFAULT 0,
    esclusione TEXT,
    note TEXT,
    id_provincia INTEGER REFERENCES province(id),

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sim_dettagli_simulazione ON simulazioni_dettagli(id_simulazione);
CREATE INDEX idx_sim_dettagli_azienda ON simulazioni_dettagli(id_azienda);

-- ============================================================
-- SIMULAZIONE PESI (Weighting factors)
-- ============================================================

CREATE TABLE simulazione_pesi (
    id SERIAL PRIMARY KEY,
    id_simulazione UUID NOT NULL REFERENCES simulazioni(id) ON DELETE CASCADE,
    variante VARCHAR(10) DEFAULT 'BASE',
    classificata DECIMAL(8,4),
    taglio_ali DECIMAL(8,4),
    m_m_aritmetica DECIMAL(8,4),
    anomala DECIMAL(8,4),
    vincitrice DECIMAL(8,4),

    UNIQUE(id_simulazione, variante)
);

-- ============================================================
-- SIMULAZIONI TIPOLOGIE (Typology filter)
-- ============================================================

CREATE TABLE simulazioni_tipologie (
    id SERIAL PRIMARY KEY,
    id_simulazione UUID NOT NULL REFERENCES simulazioni(id) ON DELETE CASCADE,
    variante VARCHAR(10) DEFAULT 'BASE',
    id_tipologia INTEGER REFERENCES tipologia_gare(id),

    UNIQUE(id_simulazione, variante, id_tipologia)
);

-- ============================================================
-- SIMULAZIONI PROVINCE (Province filter)
-- ============================================================

CREATE TABLE simulazioni_province (
    id SERIAL PRIMARY KEY,
    id_simulazione UUID NOT NULL REFERENCES simulazioni(id) ON DELETE CASCADE,
    variante VARCHAR(10) DEFAULT 'BASE',
    id_provincia INTEGER REFERENCES province(id),
    data_inserimento TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(id_simulazione, variante, id_provincia)
);

-- ============================================================
-- SIMULAZIONI SOA SEC (Secondary SOA filter)
-- ============================================================

CREATE TABLE simulazioni_soa_sec (
    id SERIAL PRIMARY KEY,
    id_simulazione UUID NOT NULL REFERENCES simulazioni(id) ON DELETE CASCADE,
    variante VARCHAR(10) DEFAULT 'BASE',
    id_soa INTEGER REFERENCES soa(id),
    id_attestazione INTEGER,

    UNIQUE(id_simulazione, variante, id_soa)
);

-- Update simulazioni_gare FK now that simulazioni exists
ALTER TABLE simulazioni_gare DROP CONSTRAINT IF EXISTS simulazioni_gare_id_simulazione_fkey;
-- The FK reference is added retroactively
