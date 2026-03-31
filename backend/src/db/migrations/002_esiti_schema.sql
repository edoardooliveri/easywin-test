-- ============================================================
-- EASYWIN - PostgreSQL Schema Migration 002
-- Module: Esiti / Gare (Outcomes / Results)
-- Migrated from: SQL Server / Entity Framework (ASP.NET MVC)
-- Date: March 2026
-- ============================================================

-- ============================================================
-- LOOKUP TABLES (Esiti-specific)
-- ============================================================

CREATE TABLE IF NOT EXISTS tipo_dati_gara (
    id SERIAL PRIMARY KEY,
    tipo VARCHAR(200) NOT NULL,
    priority INTEGER DEFAULT 0,
    attivo BOOLEAN DEFAULT true
);

INSERT INTO tipo_dati_gara (tipo, priority) VALUES
    ('Completi', 1),
    ('Parziali', 2),
    ('Solo Vincitore', 3),
    ('Importi Non Disponibili', 4)
ON CONFLICT DO NOTHING;

-- ============================================================
-- MAIN TABLE: GARE (Esiti / Outcomes)
-- ============================================================

CREATE TABLE gare (
    id SERIAL PRIMARY KEY,
    id_bando UUID REFERENCES bandi(id) ON DELETE SET NULL,

    -- General info
    data DATE,                                  -- Data esito
    titolo VARCHAR(1000),
    codice_cig VARCHAR(20),
    codice_cup VARCHAR(30),

    -- Location
    cap VARCHAR(10),
    citta VARCHAR(200),
    indirizzo VARCHAR(500),
    id_provincia INTEGER REFERENCES province(id),
    regione VARCHAR(100),
    lat DOUBLE PRECISION,                       -- Latitude
    lon DOUBLE PRECISION,                       -- Longitude

    -- Stazione appaltante
    id_stazione INTEGER REFERENCES stazioni(id),
    stazione VARCHAR(500),                      -- Denormalized name

    -- Classification
    id_soa INTEGER REFERENCES soa(id),          -- Main SOA category
    soa_val INTEGER,                            -- SOA classification level
    id_tipologia INTEGER REFERENCES tipologia_gare(id),
    id_tipo_dati INTEGER REFERENCES tipo_dati_gara(id),
    id_criterio INTEGER REFERENCES criteri(id),
    id_piattaforma INTEGER REFERENCES piattaforme(id) DEFAULT 1,

    -- Amounts
    importo DECIMAL(18,2),                      -- Total tender amount
    importo_so DECIMAL(18,2),                   -- Safety amount
    importo_co DECIMAL(18,2),                   -- Compliance amount
    importo_eco DECIMAL(18,2),                  -- Economic amount
    oneri_progettazione DECIMAL(18,2),
    importo_soa_prevalente DECIMAL(18,2),
    importo_soa_sostitutiva DECIMAL(18,2),
    importo_manodopera DECIMAL(18,2),

    -- Participants and results
    n_partecipanti INTEGER DEFAULT 0,
    n_ammessi INTEGER DEFAULT 0,
    n_esclusi INTEGER DEFAULT 0,
    n_sorteggio INTEGER DEFAULT 0,
    n_decimali SMALLINT DEFAULT 3,

    -- Winning bid
    id_vincitore INTEGER REFERENCES aziende(id),
    ribasso DECIMAL(10,6),                      -- Winning discount %
    ribasso_vincitore DECIMAL(10,6),
    importo_vincitore DECIMAL(18,2),

    -- Statistical values
    media_ar DECIMAL(15,6),                     -- Arithmetic mean
    soglia_an DECIMAL(15,6),                    -- Anomaly threshold
    media_sc DECIMAL(15,6),                     -- Scarto mean
    soglia_riferimento DOUBLE PRECISION,        -- Reference threshold

    -- Ali (wing cut)
    accorpa_ali BOOLEAN DEFAULT false,
    tipo_accorpa_ali INTEGER,
    limit_min_media SMALLINT,

    -- Flags and status
    annullato BOOLEAN DEFAULT false,
    privato INTEGER DEFAULT 0,
    provenienza VARCHAR(50),                    -- 'Manuale', 'Presidia', 'AI'
    external_code VARCHAR(100),
    fonte_dati VARCHAR(100),

    -- AI Processing
    ai_processed BOOLEAN DEFAULT false,
    ai_confidence DECIMAL(5,2),
    ai_extracted_data JSONB,
    ai_processed_at TIMESTAMPTZ,
    ai_confirmed BOOLEAN DEFAULT false,
    ai_confirmed_by VARCHAR(100),
    ai_confirmed_at TIMESTAMPTZ,

    -- Notes
    note TEXT,
    note_01 TEXT,
    note_02 TEXT,
    note_03 TEXT,

    -- Variante (scenario/version)
    variante VARCHAR(10) DEFAULT 'BASE',
    varianti_disponibili TEXT[],                -- Array of variant codes

    -- Workflow status
    temp BOOLEAN DEFAULT true,                    -- true = draft, false = confirmed (CONFERMA)
    enabled BOOLEAN DEFAULT false,                -- true = visible to clients (ABILITA)
    bloccato BOOLEAN DEFAULT false,               -- true = locked for editing
    eliminata BOOLEAN DEFAULT false,              -- soft delete
    data_abilitazione TIMESTAMPTZ,                -- when ABILITA was pressed
    enable_to_all BOOLEAN DEFAULT false,          -- enable for all subscribers

    -- Audit
    username VARCHAR(100),                        -- inserted by
    username_modifica VARCHAR(100),               -- last modified by
    data_inserimento TIMESTAMPTZ DEFAULT NOW(),
    inserito_da VARCHAR(100),
    data_modifica TIMESTAMPTZ,
    modificato_da VARCHAR(100),

    -- Indexes hints
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Performance indexes
CREATE INDEX idx_gare_id_bando ON gare(id_bando);
CREATE INDEX idx_gare_codice_cig ON gare(codice_cig);
CREATE INDEX idx_gare_id_stazione ON gare(id_stazione);
CREATE INDEX idx_gare_id_soa ON gare(id_soa);
CREATE INDEX idx_gare_id_criterio ON gare(id_criterio);
CREATE INDEX idx_gare_id_tipologia ON gare(id_tipologia);
CREATE INDEX idx_gare_id_vincitore ON gare(id_vincitore);
CREATE INDEX idx_gare_data ON gare(data DESC);
CREATE INDEX idx_gare_provenienza ON gare(provenienza);
CREATE INDEX idx_gare_ai_processed ON gare(ai_processed);
CREATE INDEX idx_gare_annullato ON gare(annullato);
CREATE INDEX idx_gare_titolo_trgm ON gare USING gin(titolo gin_trgm_ops);
CREATE INDEX idx_gare_ai_extracted ON gare USING gin(ai_extracted_data);
CREATE INDEX idx_gare_variante ON gare(variante);

-- ============================================================
-- DETTAGLIO GARA (Bid Details / Graduatoria)
-- ============================================================

CREATE TABLE dettaglio_gara (
    id SERIAL PRIMARY KEY,
    id_gara INTEGER NOT NULL REFERENCES gare(id) ON DELETE CASCADE,
    variante VARCHAR(10) DEFAULT 'BASE',
    id_azienda INTEGER REFERENCES aziende(id),

    -- Position and bid
    posizione INTEGER,                          -- Ranking position
    ribasso DECIMAL(10,6),                      -- Discount offered %
    importo_offerta DECIMAL(18,2),              -- Amount offered

    -- Statistical
    taglio_ali BOOLEAN DEFAULT false,           -- Wing cut flag
    m_media_arit DECIMAL(15,6),                 -- Arithmetic mean at this point
    anomala BOOLEAN DEFAULT false,              -- Anomalous offer flag

    -- Status
    vincitrice BOOLEAN DEFAULT false,
    ammessa BOOLEAN DEFAULT true,               -- Admitted
    ammessa_riserva BOOLEAN DEFAULT false,      -- Admitted with reservation
    esclusa BOOLEAN DEFAULT false,              -- Excluded

    -- Flags
    da_verificare BOOLEAN DEFAULT false,        -- Needs verification
    sconosciuto BOOLEAN DEFAULT false,          -- Unknown company
    pari_merito BOOLEAN DEFAULT false,          -- Tie

    -- Company info (denormalized for unknown companies)
    ragione_sociale VARCHAR(500),               -- Company name (when not in DB)
    partita_iva VARCHAR(20),                    -- P.IVA (when not in DB)
    codice_fiscale VARCHAR(20),

    -- Scores (OEPV criteria)
    punteggio_tecnico DECIMAL(10,4),
    punteggio_economico DECIMAL(10,4),
    punteggio_totale DECIMAL(10,4),

    -- Executing companies (for ATI)
    id_azienda_esecutrice_1 INTEGER REFERENCES aziende(id),
    id_azienda_esecutrice_2 INTEGER REFERENCES aziende(id),
    id_azienda_esecutrice_3 INTEGER REFERENCES aziende(id),
    id_azienda_esecutrice_4 INTEGER REFERENCES aziende(id),
    id_azienda_esecutrice_5 INTEGER REFERENCES aziende(id),

    inserimento INTEGER DEFAULT 0,              -- 0=manual, 1=import, 2=AI
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(id_gara, variante, id_azienda)
);

CREATE INDEX idx_dettaglio_gara ON dettaglio_gara(id_gara);
CREATE INDEX idx_dettaglio_azienda ON dettaglio_gara(id_azienda);
CREATE INDEX idx_dettaglio_vincitrice ON dettaglio_gara(vincitrice) WHERE vincitrice = true;
CREATE INDEX idx_dettaglio_posizione ON dettaglio_gara(id_gara, posizione);

-- ============================================================
-- ATI GARE (Temporary Associations - 3 variants)
-- ============================================================

CREATE TABLE ati_gare (
    id SERIAL PRIMARY KEY,
    id_gara INTEGER NOT NULL REFERENCES gare(id) ON DELETE CASCADE,
    variante VARCHAR(10) DEFAULT 'BASE',
    tipo_ati INTEGER DEFAULT 1,                 -- 1, 2, 3 (ex AtiGare01/02/03)
    id_mandataria INTEGER REFERENCES aziende(id),
    id_mandante INTEGER REFERENCES aziende(id),
    avvalimento BOOLEAN DEFAULT false,
    ati BOOLEAN DEFAULT true,
    da_verificare BOOLEAN DEFAULT false,
    inserimento INTEGER DEFAULT 0,

    -- Executing companies (only for tipo_ati=1)
    id_azienda_esecutrice_1 INTEGER REFERENCES aziende(id),
    id_azienda_esecutrice_2 INTEGER REFERENCES aziende(id),
    id_azienda_esecutrice_3 INTEGER REFERENCES aziende(id),
    id_azienda_esecutrice_4 INTEGER REFERENCES aziende(id),
    id_azienda_esecutrice_5 INTEGER REFERENCES aziende(id),

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ati_gare ON ati_gare(id_gara);
CREATE INDEX idx_ati_mandataria ON ati_gare(id_mandataria);
CREATE INDEX idx_ati_mandante ON ati_gare(id_mandante);

-- ============================================================
-- PUNTEGGI (Scores for OEPV criteria)
-- ============================================================

CREATE TABLE punteggi (
    id_punteggio UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    id_gara INTEGER NOT NULL REFERENCES gare(id) ON DELETE CASCADE,
    id_azienda INTEGER REFERENCES aziende(id),
    variante VARCHAR(10) DEFAULT 'BASE',
    descrizione VARCHAR(500),
    punteggio DECIMAL(10,4),
    punteggio_max DECIMAL(10,4),
    priority INTEGER DEFAULT 0,
    insert_date TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_punteggi_gara ON punteggi(id_gara);
CREATE INDEX idx_punteggi_azienda ON punteggi(id_azienda);

-- ============================================================
-- SOA CATEGORIES FOR GARE (4 types, unified table)
-- ============================================================

CREATE TABLE gare_soa (
    id SERIAL PRIMARY KEY,
    id_gara INTEGER NOT NULL REFERENCES gare(id) ON DELETE CASCADE,
    id_soa INTEGER NOT NULL REFERENCES soa(id),
    tipo VARCHAR(4) NOT NULL CHECK (tipo IN ('sec', 'alt', 'app', 'sost')),
    variante VARCHAR(10) DEFAULT 'BASE',
    soa_val INTEGER,
    importo DECIMAL(18,2),
    id_attestazione INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(id_gara, id_soa, tipo, variante)
);

CREATE INDEX idx_gare_soa_gara ON gare_soa(id_gara);
CREATE INDEX idx_gare_soa_tipo ON gare_soa(tipo);

-- ============================================================
-- GARE PROVINCE
-- ============================================================

CREATE TABLE gare_province (
    id SERIAL PRIMARY KEY,
    id_gara INTEGER NOT NULL REFERENCES gare(id) ON DELETE CASCADE,
    id_provincia INTEGER NOT NULL REFERENCES province(id),
    variante VARCHAR(10) DEFAULT 'BASE',
    data_inserimento TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(id_gara, id_provincia, variante)
);

-- ============================================================
-- GARE RICORSI (Legal Appeals)
-- ============================================================

CREATE TABLE gare_ricorsi (
    id SERIAL PRIMARY KEY,
    codice_cig VARCHAR(20) NOT NULL,
    id_azienda INTEGER REFERENCES aziende(id),

    -- Amounts
    importo_netto DECIMAL(18,2),
    ribasso DECIMAL(10,6),
    importo_oneri DECIMAL(18,2),
    percentuale DECIMAL(10,4),
    importo_risultante DECIMAL(18,2),
    importo_concordato DECIMAL(18,2),

    -- Workflow flags
    flag_azienda_contattata BOOLEAN DEFAULT false,
    flag_lettera_incarico_inviata BOOLEAN DEFAULT false,
    flag_lettera_ricorso_inviata BOOLEAN DEFAULT false,
    flag_risposta_stazione BOOLEAN DEFAULT false,
    flag_esito_ricorso BOOLEAN DEFAULT false,

    -- Dates
    data_contatto TIMESTAMPTZ,
    data_lettera_incarico TIMESTAMPTZ,
    data_lettera_ricorso TIMESTAMPTZ,
    data_risposta TIMESTAMPTZ,
    data_esito TIMESTAMPTZ,

    -- Payment
    acconto DECIMAL(18,2),
    saldo DECIMAL(18,2),
    stato_pagamento INTEGER DEFAULT 0,
    data_acconto TIMESTAMPTZ,
    data_saldo TIMESTAMPTZ,

    -- Notes
    note TEXT,
    note_contatto TEXT,
    note_incarico TEXT,
    note_ricorso TEXT,
    note_risposta TEXT,
    note_esito TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ricorsi_cig ON gare_ricorsi(codice_cig);
CREATE INDEX idx_ricorsi_azienda ON gare_ricorsi(id_azienda);

-- ============================================================
-- GARE INVII (Transmission log)
-- ============================================================

CREATE TABLE gare_invii (
    id SERIAL PRIMARY KEY,
    id_gara INTEGER NOT NULL REFERENCES gare(id) ON DELETE CASCADE,
    variante VARCHAR(10) DEFAULT 'BASE',
    data TIMESTAMPTZ DEFAULT NOW(),
    username VARCHAR(100)
);

CREATE INDEX idx_gare_invii_gara ON gare_invii(id_gara);

-- ============================================================
-- ASSISTENTI GARA (Assistants/Inspectors)
-- ============================================================

CREATE TABLE assistenti_gara (
    id SERIAL PRIMARY KEY,
    id_gara INTEGER NOT NULL REFERENCES gare(id) ON DELETE CASCADE,
    id_concorrente INTEGER,
    id_azienda INTEGER REFERENCES aziende(id),
    variante VARCHAR(10) DEFAULT 'BASE',
    tipo VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_assistenti_gara ON assistenti_gara(id_gara);

-- ============================================================
-- SIMULAZIONI GARE (Links between simulations and real gare)
-- ============================================================

CREATE TABLE simulazioni_gare (
    id SERIAL PRIMARY KEY,
    id_simulazione UUID NOT NULL,               -- Will reference simulazioni table (module 3)
    id_gara INTEGER NOT NULL REFERENCES gare(id) ON DELETE CASCADE,
    variante VARCHAR(10) DEFAULT 'BASE',
    soglia_anomalia DECIMAL(15,6),
    s_soglia_anomalia DECIMAL(15,6),
    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(id_simulazione, id_gara)
);

-- ============================================================
-- CONCORRENTI (Competitor contacts - for external leads)
-- ============================================================

CREATE TABLE concorrenti (
    id SERIAL PRIMARY KEY,
    ragione_sociale VARCHAR(500),
    nome VARCHAR(200),
    indirizzo VARCHAR(500),
    cap VARCHAR(10),
    citta VARCHAR(200),
    id_provincia INTEGER REFERENCES province(id),
    telefono VARCHAR(50),
    email VARCHAR(200),
    partita_iva VARCHAR(20),
    codice_fiscale VARCHAR(20),
    note TEXT,
    persona_riferimento VARCHAR(200),

    -- Pricing
    prezzo_bandi DECIMAL(10,2),
    prezzo_esiti DECIMAL(10,2),
    prezzo_bundle DECIMAL(10,2),

    -- Link to main aziende if converted
    id_azienda INTEGER REFERENCES aziende(id),

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_concorrenti_piva ON concorrenti(partita_iva);
CREATE INDEX idx_concorrenti_nome_trgm ON concorrenti USING gin(ragione_sociale gin_trgm_ops);

-- ============================================================
-- GARE MODIFICHE (Audit trail for gare changes)
-- ============================================================

CREATE TABLE gare_modifiche (
    id SERIAL PRIMARY KEY,
    id_gara INTEGER NOT NULL REFERENCES gare(id) ON DELETE CASCADE,
    campo VARCHAR(100),
    valore_precedente TEXT,
    valore_nuovo TEXT,
    username VARCHAR(100),
    data_modifica TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_gare_modifiche_gara ON gare_modifiche(id_gara);

-- ============================================================
-- VIEW: Active Esiti with related data
-- ============================================================

CREATE OR REPLACE VIEW v_esiti_completi AS
SELECT
    g.id,
    g.id_bando,
    g.data,
    g.titolo,
    g.codice_cig,
    g.codice_cup,
    g.importo,
    g.n_partecipanti,
    g.ribasso AS ribasso_vincitore,
    g.media_ar,
    g.soglia_an,
    g.variante,
    g.ai_processed,
    g.ai_confidence,
    g.provenienza,
    s.nome AS stazione_nome,
    soa.codice AS soa_categoria,
    soa.descrizione AS soa_descrizione,
    tg.nome AS tipologia,
    c.nome AS criterio,
    p.nome AS provincia_nome,
    r.nome AS regione_nome,
    az.ragione_sociale AS vincitore_nome,
    az.partita_iva AS vincitore_piva,
    (SELECT COUNT(*) FROM dettaglio_gara dg WHERE dg.id_gara = g.id) AS n_dettagli
FROM gare g
LEFT JOIN stazioni s ON g.id_stazione = s.id
LEFT JOIN soa ON g.id_soa = soa.id
LEFT JOIN tipologia_gare tg ON g.id_tipologia = tg.id
LEFT JOIN criteri c ON g.id_criterio = c.id
LEFT JOIN province p ON g.id_provincia = p.id
LEFT JOIN regioni r ON p.id_regione = r.id
LEFT JOIN aziende az ON g.id_vincitore = az.id
WHERE g.annullato = false;

-- ============================================================
-- VIEW: Statistics for Range Statistico
-- ============================================================

CREATE OR REPLACE VIEW v_esiti_stats AS
SELECT
    g.id,
    g.data,
    g.importo,
    g.n_partecipanti,
    g.ribasso,
    g.media_ar,
    g.soglia_an,
    g.id_soa,
    soa.codice AS soa_categoria,
    g.id_criterio,
    c.nome AS criterio,
    g.id_stazione,
    s.nome AS stazione_nome,
    p.id_regione,
    r.nome AS regione_nome,
    g.id_tipologia,
    tg.nome AS tipologia
FROM gare g
LEFT JOIN soa ON g.id_soa = soa.id
LEFT JOIN criteri c ON g.id_criterio = c.id
LEFT JOIN stazioni s ON g.id_stazione = s.id
LEFT JOIN province p ON g.id_provincia = p.id
LEFT JOIN regioni r ON p.id_regione = r.id
LEFT JOIN tipologia_gare tg ON g.id_tipologia = tg.id
WHERE g.annullato = false
  AND g.ribasso IS NOT NULL
  AND g.n_partecipanti > 0;
