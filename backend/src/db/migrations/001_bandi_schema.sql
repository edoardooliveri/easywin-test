-- ============================================================
-- EASYWIN - PostgreSQL Schema Migration 001
-- Module: Bandi (Tenders / Gare d'Appalto)
-- Migrated from: SQL Server / Entity Framework (ASP.NET MVC)
-- Date: March 2026
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- For fuzzy text search

-- ============================================================
-- LOOKUP TABLES
-- ============================================================

CREATE TABLE regioni (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(100) NOT NULL UNIQUE,
    codice_istat VARCHAR(3),
    attivo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE province (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    sigla VARCHAR(5) NOT NULL UNIQUE,
    id_regione INTEGER REFERENCES regioni(id),
    codice_istat VARCHAR(6),
    attivo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_province_regione ON province(id_regione);

CREATE TABLE stazioni (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(500) NOT NULL,
    indirizzo VARCHAR(300),
    cap VARCHAR(10),
    citta VARCHAR(100),
    id_provincia INTEGER REFERENCES province(id),
    telefono VARCHAR(50),
    fax VARCHAR(50),
    email VARCHAR(200),
    pec VARCHAR(200),
    sito_web VARCHAR(300),
    codice_fiscale VARCHAR(20),
    partita_iva VARCHAR(20),
    id_presidia INTEGER,                  -- External ID from Presidia system
    codice_ausa VARCHAR(20),              -- AUSA code (Italian procurement authority ID)
    attivo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_stazioni_provincia ON stazioni(id_provincia);
CREATE INDEX idx_stazioni_presidia ON stazioni(id_presidia);
CREATE INDEX idx_stazioni_nome_trgm ON stazioni USING gin(nome gin_trgm_ops);

CREATE TABLE soa (
    id SERIAL PRIMARY KEY,
    codice VARCHAR(10) NOT NULL UNIQUE,   -- e.g., OG1, OG3, OS21
    descrizione VARCHAR(500) NOT NULL,
    tipo VARCHAR(5) NOT NULL,             -- 'OG' or 'OS'
    attivo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE tipologia_gare (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(200) NOT NULL,
    descrizione TEXT,
    attivo BOOLEAN DEFAULT true
);

CREATE TABLE tipologia_bandi (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(200) NOT NULL,
    descrizione TEXT,
    attivo BOOLEAN DEFAULT true
);

CREATE TABLE criteri (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(200) NOT NULL,           -- e.g., "Prezzo più basso", "OEPV"
    codice VARCHAR(20),
    descrizione TEXT,
    attivo BOOLEAN DEFAULT true
);

CREATE TABLE piattaforme (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(200) NOT NULL,
    url VARCHAR(500),
    attivo BOOLEAN DEFAULT true
);

CREATE TABLE tipo_esecutore (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(200) NOT NULL,
    attivo BOOLEAN DEFAULT true
);

CREATE TABLE esecutori_esterni (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(200) NOT NULL,
    telefono VARCHAR(50),
    email VARCHAR(200),
    attivo BOOLEAN DEFAULT true
);

-- ============================================================
-- AZIENDE (Companies) - Core entity referenced by many tables
-- ============================================================

CREATE TABLE aziende (
    id SERIAL PRIMARY KEY,
    ragione_sociale VARCHAR(500) NOT NULL,
    partita_iva VARCHAR(20),
    codice_fiscale VARCHAR(20),
    indirizzo VARCHAR(300),
    cap VARCHAR(10),
    citta VARCHAR(100),
    id_provincia INTEGER REFERENCES province(id),
    telefono VARCHAR(50),
    fax VARCHAR(50),
    email VARCHAR(200),
    pec VARCHAR(200),
    sito_web VARCHAR(300),
    legale_rappresentante VARCHAR(200),
    note TEXT,
    attivo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_aziende_partita_iva ON aziende(partita_iva);
CREATE INDEX idx_aziende_codice_fiscale ON aziende(codice_fiscale);
CREATE INDEX idx_aziende_ragione_sociale_trgm ON aziende USING gin(ragione_sociale gin_trgm_ops);

-- Attestazioni SOA per azienda
CREATE TABLE attestazioni (
    id SERIAL PRIMARY KEY,
    id_azienda INTEGER NOT NULL REFERENCES aziende(id) ON DELETE CASCADE,
    id_soa INTEGER NOT NULL REFERENCES soa(id),
    classifica INTEGER,                   -- SOA classification (I, II, III, etc.)
    data_rilascio DATE,
    data_scadenza DATE,
    organismo VARCHAR(200),               -- Certification body
    attivo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_attestazioni_azienda ON attestazioni(id_azienda);

-- ============================================================
-- USERS
-- ============================================================

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    email VARCHAR(200) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    nome VARCHAR(100),
    cognome VARCHAR(100),
    id_azienda INTEGER REFERENCES aziende(id),
    ruolo VARCHAR(50) DEFAULT 'utente',   -- admin, operatore, utente
    attivo BOOLEAN DEFAULT true,
    ultimo_accesso TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_users_azienda ON users(id_azienda);

-- ============================================================
-- BANDI (Main Tenders Table) - 118+ fields from old system
-- ============================================================

CREATE TABLE bandi (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Stazione Appaltante
    id_stazione INTEGER REFERENCES stazioni(id),
    stazione_nome VARCHAR(500),           -- Denormalized for historical consistency

    -- Dati principali
    titolo TEXT NOT NULL,
    data_pubblicazione DATE NOT NULL,
    codice_cig VARCHAR(20),               -- CIG (Codice Identificativo Gara)
    codice_cup VARCHAR(20),               -- CUP (Codice Unico Progetto)

    -- Classificazione SOA
    id_soa INTEGER REFERENCES soa(id),            -- SOA principale
    soa_val INTEGER,                               -- SOA value
    categoria_presunta BOOLEAN DEFAULT false,
    categoria_sostitutiva INTEGER,
    importo_soa_prevalente DECIMAL(18,2),
    importo_soa_sostitutiva DECIMAL(18,2),

    -- Importi
    importo_so DECIMAL(18,2),             -- Importo soggetto ad offerta
    importo_co DECIMAL(18,2),             -- Importo costi conformità
    importo_eco DECIMAL(18,2),            -- Importo economico
    oneri_progettazione DECIMAL(18,2),    -- Oneri di progettazione
    importo_manodopera DECIMAL(18,2),     -- Importo manodopera
    soglia_riferimento DOUBLE PRECISION,  -- Soglia di riferimento anomalia

    -- Date
    data_offerta TIMESTAMPTZ,             -- Scadenza offerta
    data_apertura TIMESTAMPTZ,            -- Data apertura buste
    data_apertura_posticipata TIMESTAMPTZ,
    data_apertura_da_destinarsi BOOLEAN DEFAULT false,
    data_sop_start TIMESTAMPTZ,           -- Inizio sopralluoghi
    data_sop_end TIMESTAMPTZ,             -- Fine sopralluoghi
    data_max_per_sopralluogo TIMESTAMPTZ,
    data_max_per_prenotazione TIMESTAMPTZ,
    data_avviso TIMESTAMPTZ,
    ora_avviso TIMESTAMPTZ,
    data_controllo TIMESTAMPTZ,

    -- Localizzazione
    indirizzo VARCHAR(300),
    cap VARCHAR(10),
    citta VARCHAR(100),
    regione VARCHAR(100),

    -- Tipologia e Criteri
    id_tipologia INTEGER REFERENCES tipologia_gare(id),
    id_tipologia_bando INTEGER REFERENCES tipologia_bandi(id),
    id_criterio INTEGER REFERENCES criteri(id),
    id_piattaforma INTEGER REFERENCES piattaforme(id) DEFAULT 0,
    n_decimali SMALLINT DEFAULT 3,
    limit_min_media SMALLINT,
    accorpa_ali BOOLEAN DEFAULT false,
    tipo_accorpa_ali INTEGER,
    tipo_dati_esito INTEGER,

    -- Sopralluoghi config
    id_tipo_sopralluogo INTEGER DEFAULT 0,
    note_per_sopralluogo TEXT,

    -- Spedizione
    id_tipo_spedizione INTEGER DEFAULT 0,
    sped_pec BOOLEAN DEFAULT false,
    sped_posta BOOLEAN DEFAULT false,
    sped_corriere BOOLEAN DEFAULT false,
    sped_mano BOOLEAN DEFAULT false,
    sped_telematica BOOLEAN DEFAULT false,
    indirizzo_pec VARCHAR(200),
    indirizzo_elaborati VARCHAR(300),
    max_invitati_negoziate INTEGER DEFAULT 0,

    -- Comunicazione
    comunicazione_diretta_data BOOLEAN DEFAULT false,

    -- Import esterno (Presidia)
    provenienza VARCHAR(50),              -- 'Presidia', 'Manuale', 'AI'
    external_code VARCHAR(100),           -- Codice esterno da Presidia
    fonte_dati VARCHAR(100),

    -- Stato
    annullato BOOLEAN DEFAULT false,
    privato INTEGER DEFAULT 0,            -- 0=pubblico, 1=privato

    -- Note
    note TEXT,
    note_01 TEXT,
    note_02 TEXT,
    note_03 TEXT,
    note_04 TEXT,
    note_05 TEXT,

    -- Controllo
    username_controllo VARCHAR(100),
    note_controllo TEXT,
    creatore_avviso VARCHAR(100),
    username_avviso VARCHAR(100),
    note_avviso TEXT,

    -- AI metadata (NEW - non present in old system)
    ai_processed BOOLEAN DEFAULT false,
    ai_confidence DOUBLE PRECISION,       -- 0.0-1.0 confidence score
    ai_extracted_data JSONB,              -- Raw AI extraction result
    ai_processed_at TIMESTAMPTZ,

    -- Audit
    inserito_da VARCHAR(100),
    data_inserimento TIMESTAMPTZ DEFAULT NOW(),
    modificato_da VARCHAR(100),
    data_modifica TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for Bandi
CREATE INDEX idx_bandi_stazione ON bandi(id_stazione);
CREATE INDEX idx_bandi_cig ON bandi(codice_cig);
CREATE INDEX idx_bandi_cup ON bandi(codice_cup);
CREATE INDEX idx_bandi_soa ON bandi(id_soa);
CREATE INDEX idx_bandi_tipologia ON bandi(id_tipologia);
CREATE INDEX idx_bandi_criterio ON bandi(id_criterio);
CREATE INDEX idx_bandi_data_pub ON bandi(data_pubblicazione DESC);
CREATE INDEX idx_bandi_data_offerta ON bandi(data_offerta);
CREATE INDEX idx_bandi_provenienza ON bandi(provenienza);
CREATE INDEX idx_bandi_external_code ON bandi(external_code);
CREATE INDEX idx_bandi_titolo_trgm ON bandi USING gin(titolo gin_trgm_ops);
CREATE INDEX idx_bandi_ai_data ON bandi USING gin(ai_extracted_data);

-- ============================================================
-- BANDI CHILD TABLES
-- ============================================================

-- Allegati Bando (Attachments)
CREATE TABLE allegati_bando (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    id_bando UUID NOT NULL REFERENCES bandi(id) ON DELETE CASCADE,
    nome_file VARCHAR(500),
    documento BYTEA,                      -- File binary content
    path VARCHAR(1000),                   -- File path on disk
    last_update TIMESTAMPTZ,
    username VARCHAR(100),
    user_type VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_allegati_bando ON allegati_bando(id_bando);

-- Apertura Bandi (Opening Registrations)
CREATE TABLE apertura_bandi (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    id_bando UUID NOT NULL REFERENCES bandi(id) ON DELETE CASCADE,
    id_azienda INTEGER REFERENCES aziende(id),
    data TIMESTAMPTZ NOT NULL,
    username VARCHAR(100),
    indirizzo VARCHAR(300),
    cap VARCHAR(10),
    id_provincia INTEGER REFERENCES province(id),
    citta VARCHAR(100),
    prezzo DECIMAL(18,2),
    iva DOUBLE PRECISION,
    prezzo_utente DECIMAL(18,2),
    iva_utente DOUBLE PRECISION,
    pagato_utente BOOLEAN DEFAULT false,
    pagato_azienda BOOLEAN DEFAULT false,
    eseguito BOOLEAN DEFAULT false,
    note TEXT,
    inserito_da VARCHAR(100),
    data_inserimento TIMESTAMPTZ DEFAULT NOW(),
    modificato_da VARCHAR(100),
    data_modifica TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_apertura_bando ON apertura_bandi(id_bando);
CREATE INDEX idx_apertura_azienda ON apertura_bandi(id_azienda);

-- Apertura Bandi Template
CREATE TABLE apertura_bandi_tpl (
    id SERIAL PRIMARY KEY,
    id_bando UUID NOT NULL REFERENCES bandi(id) ON DELETE CASCADE,
    data TIMESTAMPTZ NOT NULL,
    indirizzo VARCHAR(300),
    cap VARCHAR(10),
    id_provincia INTEGER REFERENCES province(id),
    citta VARCHAR(100),
    inserito_da VARCHAR(100),
    data_inserimento TIMESTAMPTZ DEFAULT NOW(),
    modificato_da VARCHAR(100),
    data_modifica TIMESTAMPTZ
);
CREATE INDEX idx_apertura_tpl_bando ON apertura_bandi_tpl(id_bando);

-- SOA Categories per Bando (4 types)
CREATE TABLE bandi_soa_sec (
    id SERIAL PRIMARY KEY,
    id_bando UUID NOT NULL REFERENCES bandi(id) ON DELETE CASCADE,
    id_soa INTEGER NOT NULL REFERENCES soa(id),
    importo DECIMAL(18,2),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_bandi_soa_sec_bando ON bandi_soa_sec(id_bando);

CREATE TABLE bandi_soa_alt (
    id SERIAL PRIMARY KEY,
    id_bando UUID NOT NULL REFERENCES bandi(id) ON DELETE CASCADE,
    id_soa INTEGER NOT NULL REFERENCES soa(id),
    importo DECIMAL(18,2),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_bandi_soa_alt_bando ON bandi_soa_alt(id_bando);

CREATE TABLE bandi_soa_app (
    id SERIAL PRIMARY KEY,
    id_bando UUID NOT NULL REFERENCES bandi(id) ON DELETE CASCADE,
    id_soa INTEGER NOT NULL REFERENCES soa(id),
    importo DECIMAL(18,2),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_bandi_soa_app_bando ON bandi_soa_app(id_bando);

CREATE TABLE bandi_soa_sost (
    id SERIAL PRIMARY KEY,
    id_bando UUID NOT NULL REFERENCES bandi(id) ON DELETE CASCADE,
    id_soa INTEGER NOT NULL REFERENCES soa(id),
    importo DECIMAL(18,2),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_bandi_soa_sost_bando ON bandi_soa_sost(id_bando);

-- Scrittura Bandi (Document Examination Registrations)
CREATE TABLE scrittura_bandi (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    id_bando UUID NOT NULL REFERENCES bandi(id) ON DELETE CASCADE,
    id_azienda INTEGER NOT NULL REFERENCES aziende(id),
    username VARCHAR(100),
    prezzo DECIMAL(18,2),
    iva DOUBLE PRECISION,
    tipologia_spedizione VARCHAR(50),
    bollettino DECIMAL(18,2),
    cig_bollettino VARCHAR(20),
    bollettino_pagato BOOLEAN,
    cauzione DECIMAL(18,2),
    cauzione_versata BOOLEAN,
    file_cauzione BYTEA,
    prezzo_utente DECIMAL(18,2),
    iva_utente DOUBLE PRECISION,
    pagato_utente BOOLEAN DEFAULT false,
    pagato_azienda BOOLEAN DEFAULT false,
    eseguito BOOLEAN DEFAULT false,
    stato_sopralluogo INTEGER DEFAULT 0,
    stato_passoe INTEGER DEFAULT 0,
    stato_avcp INTEGER DEFAULT 0,
    stato_dare_cauzione INTEGER DEFAULT 0,
    stato_m INTEGER DEFAULT 0,
    stato_p INTEGER DEFAULT 0,
    rimosso_da_registro BOOLEAN DEFAULT false,
    note TEXT,
    inserito_da VARCHAR(100),
    data_inserimento TIMESTAMPTZ DEFAULT NOW(),
    modificato_da VARCHAR(100),
    data_modifica TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_scrittura_bando ON scrittura_bandi(id_bando);
CREATE INDEX idx_scrittura_azienda ON scrittura_bandi(id_azienda);

-- Elaborati Progettuali (Design Documents)
CREATE TABLE elaborati_progettuali (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    id_bando UUID NOT NULL REFERENCES bandi(id) ON DELETE CASCADE,
    id_azienda INTEGER NOT NULL REFERENCES aziende(id),
    data_prenotazione TIMESTAMPTZ NOT NULL,
    luogo VARCHAR(200),
    id_provincia INTEGER REFERENCES province(id),
    cap VARCHAR(10),
    citta VARCHAR(100),
    indirizzo VARCHAR(300),
    prezzo DECIMAL(18,2),
    iva DOUBLE PRECISION,
    prezzo_utente DECIMAL(18,2),
    iva_utente DOUBLE PRECISION,
    pagato_utente BOOLEAN DEFAULT false,
    pagato_azienda BOOLEAN DEFAULT false,
    pagamento VARCHAR(100),
    iban VARCHAR(50),
    cc_postale VARCHAR(30),
    supporto VARCHAR(100),
    eseguito BOOLEAN DEFAULT false,
    username VARCHAR(100),
    note TEXT,
    inserito_da VARCHAR(100),
    data_inserimento TIMESTAMPTZ DEFAULT NOW(),
    modificato_da VARCHAR(100),
    data_modifica TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_elaborati_bando ON elaborati_progettuali(id_bando);

-- Sopralluoghi (Site Visits)
CREATE TABLE sopralluoghi (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    id_bando UUID NOT NULL REFERENCES bandi(id) ON DELETE CASCADE,
    id_azienda INTEGER NOT NULL REFERENCES aziende(id),
    data_sopralluogo TIMESTAMPTZ,
    prenotato BOOLEAN DEFAULT false,
    tipo_prenotazione VARCHAR(50),
    fax VARCHAR(50),
    telefono VARCHAR(50),
    email VARCHAR(200),
    username VARCHAR(100),
    indirizzo VARCHAR(300),
    cap VARCHAR(10),
    id_provincia INTEGER REFERENCES province(id),
    citta VARCHAR(100),
    presa_visione BOOLEAN DEFAULT false,
    data_richiesta TIMESTAMPTZ,

    -- Riferimenti
    riferimento_azienda_richiedente VARCHAR(200),
    riferimento_intermediario_richiedente VARCHAR(200),
    riferimento_intermediario_esecutore VARCHAR(200),
    gestore_richiesta VARCHAR(100),
    id_intermediario_richiedente INTEGER,
    id_intermediario_esecutore INTEGER,
    id_tipo_esecutore INTEGER REFERENCES tipo_esecutore(id),
    id_esecutore_esterno INTEGER REFERENCES esecutori_esterni(id),

    -- Stato
    richiesta INTEGER DEFAULT 0,
    esecuzione INTEGER DEFAULT 0,
    eseguito BOOLEAN DEFAULT false,
    annullato BOOLEAN DEFAULT false,

    -- Pagamenti multipli (user, azienda, intermediari, esecutori)
    prezzo DECIMAL(18,2),
    iva DOUBLE PRECISION,
    prezzo_utente DECIMAL(18,2),
    iva_utente DOUBLE PRECISION,
    pagato_utente BOOLEAN DEFAULT false,
    pagato_azienda BOOLEAN DEFAULT false,
    data_prenotazione TIMESTAMPTZ,
    proforma_inviato BOOLEAN DEFAULT false,
    fattura_elettronica_generata BOOLEAN DEFAULT false,
    num_ati INTEGER DEFAULT 0,
    azienda_abbonata_sopralluoghi BOOLEAN DEFAULT false,

    note TEXT,
    inserito_da VARCHAR(100),
    data_inserimento TIMESTAMPTZ DEFAULT NOW(),
    modificato_da VARCHAR(100),
    data_modifica TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_sopralluoghi_bando ON sopralluoghi(id_bando);
CREATE INDEX idx_sopralluoghi_azienda ON sopralluoghi(id_azienda);

-- Date Sopralluoghi (Site Visit Date Ranges)
CREATE TABLE date_sopralluoghi (
    id SERIAL PRIMARY KEY,
    id_bando UUID NOT NULL REFERENCES bandi(id) ON DELETE CASCADE,
    data_inizio TIMESTAMPTZ,
    data_fine TIMESTAMPTZ,
    ora_inizio TIME,
    ora_fine TIME,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_date_sopralluoghi_bando ON date_sopralluoghi(id_bando);

-- Sopralluoghi Date (Specific Dates)
CREATE TABLE sopralluoghi_date (
    id SERIAL PRIMARY KEY,
    id_bando UUID NOT NULL REFERENCES bandi(id) ON DELETE CASCADE,
    data_sopralluogo TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_sopralluoghi_date_bando ON sopralluoghi_date(id_bando);

-- Sopralluoghi Richieste (Visit Requests)
CREATE TABLE sopralluoghi_richieste (
    id SERIAL PRIMARY KEY,
    id_bando UUID NOT NULL REFERENCES bandi(id) ON DELETE CASCADE,
    id_sopralluogo UUID NOT NULL REFERENCES sopralluoghi(id) ON DELETE CASCADE,
    username VARCHAR(100),
    esecuzione INTEGER DEFAULT 0,
    username_esecutore VARCHAR(100),
    id_intermediario INTEGER,
    id_esecutore_esterno INTEGER REFERENCES esecutori_esterni(id),
    stato INTEGER DEFAULT 0,
    cnt INTEGER DEFAULT 0,
    data_inserimento TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_sop_richieste_bando ON sopralluoghi_richieste(id_bando);

-- Presa Visione Date
CREATE TABLE presa_visione_date (
    id SERIAL PRIMARY KEY,
    id_bando UUID NOT NULL REFERENCES bandi(id) ON DELETE CASCADE,
    data_sopralluogo TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_presa_visione_bando ON presa_visione_date(id_bando);

-- Presa Visione Template
CREATE TABLE presa_visione_tpl (
    id SERIAL PRIMARY KEY,
    id_bando UUID NOT NULL REFERENCES bandi(id) ON DELETE CASCADE,
    tipo_prenotazione VARCHAR(50),
    indirizzo VARCHAR(300),
    cap VARCHAR(10),
    id_provincia INTEGER REFERENCES province(id),
    citta VARCHAR(100),
    fax VARCHAR(50),
    telefono VARCHAR(50),
    email VARCHAR(200),
    inserito_da VARCHAR(100),
    data_inserimento TIMESTAMPTZ,
    modificato_da VARCHAR(100),
    data_modifica TIMESTAMPTZ
);
CREATE INDEX idx_presa_visione_tpl_bando ON presa_visione_tpl(id_bando);

-- Richieste Servizi (Service Requests)
CREATE TABLE richieste_servizi (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    id_bando UUID NOT NULL REFERENCES bandi(id) ON DELETE CASCADE,
    username VARCHAR(100),
    richiesta TEXT,
    note TEXT,
    gestito BOOLEAN DEFAULT false,
    data_inserimento TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_richieste_bando ON richieste_servizi(id_bando);

-- Registro Gare (Tender Register/Log)
CREATE TABLE registro_gare (
    id SERIAL PRIMARY KEY,
    id_bando UUID NOT NULL REFERENCES bandi(id) ON DELETE CASCADE,
    username VARCHAR(100),
    note TEXT,
    data_inserimento TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_registro_bando ON registro_gare(id_bando);

-- Bandi Modifiche (Audit Trail)
CREATE TABLE bandi_modifiche (
    id SERIAL PRIMARY KEY,
    id_bando UUID NOT NULL REFERENCES bandi(id) ON DELETE CASCADE,
    username VARCHAR(100),
    data TIMESTAMPTZ DEFAULT NOW(),
    modifiche TEXT
);
CREATE INDEX idx_bandi_modifiche_bando ON bandi_modifiche(id_bando);

-- Bandi Province (Junction Table)
CREATE TABLE bandi_province (
    id SERIAL PRIMARY KEY,
    id_bando UUID NOT NULL REFERENCES bandi(id) ON DELETE CASCADE,
    id_provincia INTEGER NOT NULL REFERENCES province(id),
    data_inserimento TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(id_bando, id_provincia)
);
CREATE INDEX idx_bandi_province_bando ON bandi_province(id_bando);
CREATE INDEX idx_bandi_province_provincia ON bandi_province(id_provincia);

-- Bandi Probabilita (Win Probability)
CREATE TABLE bandi_probabilita (
    id SERIAL PRIMARY KEY,
    id_bando UUID NOT NULL REFERENCES bandi(id) ON DELETE CASCADE,
    id_azienda INTEGER REFERENCES aziende(id),
    username VARCHAR(100),
    percentuale DOUBLE PRECISION,
    note TEXT,
    data_inserimento TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_bandi_prob_bando ON bandi_probabilita(id_bando);

-- ============================================================
-- VIEWS for common queries
-- ============================================================

-- View: Bandi attivi con dettagli stazione
CREATE VIEW v_bandi_attivi AS
SELECT
    b.id,
    b.titolo,
    b.codice_cig,
    b.codice_cup,
    b.data_pubblicazione,
    b.data_offerta,
    b.data_apertura,
    b.importo_so,
    b.importo_co,
    b.importo_eco,
    COALESCE(b.importo_so, 0) + COALESCE(b.importo_co, 0) + COALESCE(b.importo_eco, 0) AS importo_totale,
    b.regione,
    b.citta,
    b.provenienza,
    b.ai_processed,
    b.ai_confidence,
    s.nome AS stazione_nome_rel,
    COALESCE(b.stazione_nome, s.nome) AS stazione_display,
    soa.codice AS soa_codice,
    soa.descrizione AS soa_descrizione,
    tg.nome AS tipologia_nome,
    c.nome AS criterio_nome,
    p.nome AS piattaforma_nome
FROM bandi b
LEFT JOIN stazioni s ON b.id_stazione = s.id
LEFT JOIN soa ON b.id_soa = soa.id
LEFT JOIN tipologia_gare tg ON b.id_tipologia = tg.id
LEFT JOIN criteri c ON b.id_criterio = c.id
LEFT JOIN piattaforme p ON b.id_piattaforma = p.id
WHERE b.annullato = false;

-- ============================================================
-- SEED DATA (Lookup tables)
-- ============================================================

-- Regioni italiane
INSERT INTO regioni (nome) VALUES
('Abruzzo'), ('Basilicata'), ('Calabria'), ('Campania'), ('Emilia-Romagna'),
('Friuli-Venezia Giulia'), ('Lazio'), ('Liguria'), ('Lombardia'), ('Marche'),
('Molise'), ('Piemonte'), ('Puglia'), ('Sardegna'), ('Sicilia'),
('Toscana'), ('Trentino-Alto Adige'), ('Umbria'), ('Valle d''Aosta'), ('Veneto');

-- Province principali (sample)
INSERT INTO province (nome, sigla, id_regione) VALUES
('Roma', 'RM', 7), ('Milano', 'MI', 9), ('Napoli', 'NA', 4),
('Torino', 'TO', 12), ('Genova', 'GE', 8), ('Bologna', 'BO', 5),
('Firenze', 'FI', 16), ('Bari', 'BA', 13), ('Palermo', 'PA', 15),
('Catania', 'CT', 15), ('Venezia', 'VE', 20), ('Verona', 'VR', 20),
('Cagliari', 'CA', 14), ('Perugia', 'PG', 18), ('Ancona', 'AN', 10);

-- Categorie SOA
INSERT INTO soa (codice, descrizione, tipo) VALUES
('OG1', 'Edifici civili e industriali', 'OG'),
('OG2', 'Restauro e manutenzione beni immobili', 'OG'),
('OG3', 'Strade, autostrade, ponti, viadotti, ferrovie', 'OG'),
('OG4', 'Opere d''arte nel sottosuolo', 'OG'),
('OG5', 'Dighe', 'OG'),
('OG6', 'Acquedotti, gasdotti, oleodotti, fognature', 'OG'),
('OG7', 'Opere marittime e lavori di dragaggio', 'OG'),
('OG8', 'Opere fluviali, di difesa, di sistemazione idraulica', 'OG'),
('OG9', 'Impianti per la produzione di energia elettrica', 'OG'),
('OG10', 'Impianti per la trasformazione alta/media tensione', 'OG'),
('OG11', 'Impianti tecnologici', 'OG'),
('OG12', 'Opere ed impianti di bonifica e protezione ambientale', 'OG'),
('OG13', 'Opere di ingegneria naturalistica', 'OG'),
('OS1', 'Lavori in terra', 'OS'),
('OS2-A', 'Superfici decorate di pregio', 'OS'),
('OS2-B', 'Beni culturali mobili', 'OS'),
('OS3', 'Impianti idrico-sanitario, cucine, lavanderie', 'OS'),
('OS4', 'Impianti elettromeccanici trasportatori', 'OS'),
('OS5', 'Impianti pneumatici e antintrusione', 'OS'),
('OS6', 'Finiture di opere generali in materiali lignei, plastici, metallici e vetrosi', 'OS'),
('OS7', 'Finiture di opere generali di natura edile e target', 'OS'),
('OS8', 'Opere di impermeabilizzazione', 'OS'),
('OS9', 'Impianti per la segnaletica luminosa', 'OS'),
('OS10', 'Segnaletica stradale non luminosa', 'OS'),
('OS11', 'Apparecchiature strutturali speciali', 'OS'),
('OS12-A', 'Barriere stradali di sicurezza', 'OS'),
('OS12-B', 'Barriere paramassi, fermaneve e simili', 'OS'),
('OS13', 'Strutture prefabbricate in cemento armato', 'OS'),
('OS14', 'Impianti di smaltimento e recupero rifiuti', 'OS'),
('OS18-A', 'Componenti strutturali in acciaio', 'OS'),
('OS18-B', 'Componenti per facciate continue', 'OS'),
('OS19', 'Impianti di reti di telecomunicazione', 'OS'),
('OS20-A', 'Rilevamenti topografici', 'OS'),
('OS20-B', 'Indagini geognostiche', 'OS'),
('OS21', 'Opere strutturali speciali', 'OS'),
('OS22', 'Impianti di potabilizzazione e depurazione', 'OS'),
('OS23', 'Demolizione di opere', 'OS'),
('OS24', 'Verde e arredo urbano', 'OS'),
('OS25', 'Scavi archeologici', 'OS'),
('OS26', 'Pavimentazioni e sovrastrutture speciali', 'OS'),
('OS27', 'Impianti per la trazione elettrica', 'OS'),
('OS28', 'Impianti termici e di condizionamento', 'OS'),
('OS29', 'Armamento ferroviario', 'OS'),
('OS30', 'Impianti interni elettrici, telefonici, radiotelefonici', 'OS'),
('OS31', 'Impianti per la mobilità sospesa', 'OS'),
('OS32', 'Strutture in legno', 'OS'),
('OS33', 'Coperture speciali', 'OS'),
('OS34', 'Sistemi antirumore per infrastrutture', 'OS'),
('OS35', 'Interventi a basso impatto ambientale', 'OS');

-- Tipologia Gare
INSERT INTO tipologia_gare (nome) VALUES
('Lavori Pubblici'), ('Servizi'), ('Forniture'), ('Mista'), ('Concessione');

-- Tipologia Bandi
INSERT INTO tipologia_bandi (nome) VALUES
('Procedura Aperta'), ('Procedura Ristretta'), ('Procedura Negoziata'),
('Dialogo Competitivo'), ('Accordo Quadro'), ('Sistema Dinamico di Acquisizione');

-- Criteri di aggiudicazione
INSERT INTO criteri (nome, codice) VALUES
('Prezzo più basso', 'PPB'),
('Offerta economicamente più vantaggiosa', 'OEPV'),
('Costo fisso', 'CF'),
('Criterio misto', 'MIX');

-- Piattaforme
INSERT INTO piattaforme (nome) VALUES
('Nessuna'), ('MePA'), ('SINTEL'), ('START'), ('EmPULIA'), ('Sardegna CAT'), ('TuttoGare');

COMMENT ON TABLE bandi IS 'Main tenders table - migrated from SQL Server EasyWin (118+ fields)';
COMMENT ON COLUMN bandi.ai_extracted_data IS 'JSON result from Claude AI PDF analysis';
COMMENT ON COLUMN bandi.external_code IS 'External ID from Presidia import system';
