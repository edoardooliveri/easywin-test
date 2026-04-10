-- ========== 001_bandi_schema.sql ==========
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

-- ========== 002_esiti_schema.sql ==========
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

-- ========== 003_simulazioni_schema.sql ==========
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
    id_tipologia INTEGER REFERENCES tipologia_gare(id_tipologia),
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
    id_tipologia INTEGER REFERENCES tipologia_gare(id_tipologia),
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

-- ========== 004_sopralluoghi_albi_schema.sql ==========
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

-- ========== 005_complete_schema.sql ==========
-- ============================================================
-- EASYWIN - PostgreSQL Schema Migration 005
-- Complete Schema: User/Access Management, Billing, Extensions
-- Migrated from: SQL Server / Entity Framework (ASP.NET MVC)
-- Date: March 2026
-- ============================================================
-- This migration adds ALL remaining tables needed to match the
-- original EasyWin ASP.NET system. Previous migrations (001-004)
-- define: regioni, province, stazioni, soa, tipologia_gare,
-- tipologia_bandi, criteri, piattaforme, tipo_esecutore,
-- esecutori_esterni, aziende, attestazioni, users, bandi (and
-- child tables), gare (and child tables), simulazioni (and child
-- tables), albi_fornitori, iscrizioni_albo, richieste_servizio_albi
-- ============================================================
-- ============================================================
-- 1. USER/ACCESS MANAGEMENT TABLES
-- ============================================================
-- User subscription periods with feature-level pricing
CREATE TABLE IF NOT EXISTS users_periodi (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    data_inizio DATE NOT NULL,
    data_fine DATE,
    tipo VARCHAR(50),                       -- subscription type
    importo_bandi DECIMAL(10,2),
    importo_esiti DECIMAL(10,2),
    importo_esiti_light DECIMAL(10,2),
    importo_newsletter_bandi DECIMAL(10,2),
    importo_newsletter_esiti DECIMAL(10,2),
    importo_simulazioni DECIMAL(10,2),
    note TEXT,
    attivo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);
CREATE INDEX idx_users_periodi_username ON users_periodi(username);
CREATE INDEX idx_users_periodi_date ON users_periodi(data_inizio, data_fine);
-- Additional email addresses per user
CREATE TABLE IF NOT EXISTS user_emails (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    email VARCHAR(200) NOT NULL UNIQUE,
    attivo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);
CREATE INDEX idx_user_emails_username ON user_emails(username);
-- User-Region assignments (for filtering bandi)
CREATE TABLE IF NOT EXISTS users_regioni (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    id_regione INTEGER NOT NULL REFERENCES regioni(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(username, id_regione),
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);
CREATE INDEX idx_users_regioni_username ON users_regioni(username);
CREATE INDEX idx_users_regioni_regione ON users_regioni(id_regione);
-- User-Region assignments for Bandi feature
CREATE TABLE IF NOT EXISTS users_regioni_bandi (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    id_regione INTEGER NOT NULL REFERENCES regioni(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(username, id_regione),
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);
CREATE INDEX idx_users_regioni_bandi_username ON users_regioni_bandi(username);
-- User-SOA assignments
CREATE TABLE IF NOT EXISTS users_soa (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    id_soa INTEGER NOT NULL REFERENCES soa(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(username, id_soa),
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);
CREATE INDEX idx_users_soa_username ON users_soa(username);
-- User-SOA assignments for Bandi
CREATE TABLE IF NOT EXISTS users_soa_bandi (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    id_soa INTEGER NOT NULL REFERENCES soa(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(username, id_soa),
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);
CREATE INDEX idx_users_soa_bandi_username ON users_soa_bandi(username);
-- User-SOA-Province assignments for Bandi
CREATE TABLE IF NOT EXISTS users_soa_bandi_province (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    id_soa INTEGER NOT NULL REFERENCES soa(id),
    id_provincia INTEGER NOT NULL REFERENCES province(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(username, id_soa, id_provincia),
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);
CREATE INDEX idx_users_soa_bandi_prov_username ON users_soa_bandi_province(username);
CREATE INDEX idx_users_soa_bandi_prov_soa ON users_soa_bandi_province(id_soa);
CREATE INDEX idx_users_soa_bandi_prov_provincia ON users_soa_bandi_province(id_provincia);
-- User-SOA-Province assignments for Esiti
CREATE TABLE IF NOT EXISTS users_soa_esiti_province (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    id_soa INTEGER NOT NULL REFERENCES soa(id),
    id_provincia INTEGER NOT NULL REFERENCES province(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(username, id_soa, id_provincia),
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);
CREATE INDEX idx_users_soa_esiti_prov_username ON users_soa_esiti_province(username);
CREATE INDEX idx_users_soa_esiti_prov_soa ON users_soa_esiti_province(id_soa);
-- Agent assignments (delegated operators)
CREATE TABLE IF NOT EXISTS agenti_incaricati (
    id SERIAL PRIMARY KEY,
    username_agente VARCHAR(100) NOT NULL,
    username_incaricato VARCHAR(100) NOT NULL,
    attivo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(username_agente, username_incaricato),
    FOREIGN KEY (username_agente) REFERENCES users(username) ON DELETE CASCADE,
    FOREIGN KEY (username_incaricato) REFERENCES users(username) ON DELETE CASCADE
);
CREATE INDEX idx_agenti_incaricati_agente ON agenti_incaricati(username_agente);
CREATE INDEX idx_agenti_incaricati_incaricato ON agenti_incaricati(username_incaricato);
-- Agent-Region assignments
CREATE TABLE IF NOT EXISTS agenti_regioni (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    id_regione INTEGER NOT NULL REFERENCES regioni(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(username, id_regione),
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);
CREATE INDEX idx_agenti_regioni_username ON agenti_regioni(username);
-- Operator-Province assignments
CREATE TABLE IF NOT EXISTS incaricati_province (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    id_provincia INTEGER NOT NULL REFERENCES province(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(username, id_provincia),
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);
CREATE INDEX idx_incaricati_province_username ON incaricati_province(username);
-- Duplicate/concurrent login tracking
CREATE TABLE IF NOT EXISTS doppie_login (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    data TIMESTAMPTZ DEFAULT NOW(),
    ip VARCHAR(50),
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);
CREATE INDEX idx_doppie_login_username ON doppie_login(username);
CREATE INDEX idx_doppie_login_data ON doppie_login(data DESC);
-- ============================================================
-- 2. BILLING AND INVOICING TABLES
-- ============================================================
-- Invoices (Fatture)
CREATE TABLE IF NOT EXISTS fatture (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    id_periodo INTEGER,
    numero VARCHAR(50),
    data DATE NOT NULL,
    importo DECIMAL(10,2) NOT NULL,
    iva DECIMAL(5,2) DEFAULT 22.00,
    totale DECIMAL(10,2),
    pagata BOOLEAN DEFAULT false,
    data_pagamento DATE,
    tipo VARCHAR(20),                       -- 'invoice', 'credit_note', etc.
    note TEXT,
    allegato BYTEA,                         -- attachment
    nome_allegato VARCHAR(255),
    data_inserimento TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);
CREATE INDEX idx_fatture_username ON fatture(username);
CREATE INDEX idx_fatture_numero ON fatture(numero);
CREATE INDEX idx_fatture_data ON fatture(data DESC);
CREATE INDEX idx_fatture_pagata ON fatture(pagata);
-- Pro-forma invoices
CREATE TABLE IF NOT EXISTS fatture_pro_forma (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    id_periodo INTEGER,
    numero VARCHAR(50),
    data DATE NOT NULL,
    importo DECIMAL(10,2) NOT NULL,
    iva DECIMAL(5,2) DEFAULT 22.00,
    totale DECIMAL(10,2),
    stato VARCHAR(20),                      -- 'draft', 'sent', 'converted'
    pagata BOOLEAN DEFAULT false,
    data_pagamento DATE,
    tipo VARCHAR(20),
    note TEXT,
    allegato BYTEA,
    nome_allegato VARCHAR(255),
    data_inserimento TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);
CREATE INDEX idx_fatture_pf_username ON fatture_pro_forma(username);
CREATE INDEX idx_fatture_pf_stato ON fatture_pro_forma(stato);
-- Invoice line items / payment tracking
CREATE TABLE IF NOT EXISTS dettaglio_fattura (
    id SERIAL PRIMARY KEY,
    id_fattura INTEGER NOT NULL REFERENCES fatture(id) ON DELETE CASCADE,
    descrizione VARCHAR(500),
    importo DECIMAL(10,2),
    data DATE,
    pagato BOOLEAN DEFAULT false,
    data_pagamento DATE,
    tipo_pagamento VARCHAR(50),             -- 'bonifico', 'assegno', etc.
    allegato BYTEA,
    nome_allegato VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_dettaglio_fattura_fattura ON dettaglio_fattura(id_fattura);
-- ============================================================
-- 3. COMPANY EXTENSIONS
-- ============================================================
-- Company personnel (contacts)
CREATE TABLE IF NOT EXISTS azienda_personale (
    id SERIAL PRIMARY KEY,
    id_azienda INTEGER NOT NULL REFERENCES aziende(id) ON DELETE CASCADE,
    nome VARCHAR(100),
    cognome VARCHAR(100),
    ruolo VARCHAR(100),
    telefono VARCHAR(50),
    email VARCHAR(200),
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_azienda_personale_azienda ON azienda_personale(id_azienda);
-- Company audit trail (modifications)
CREATE TABLE IF NOT EXISTS modifiche_azienda (
    id SERIAL PRIMARY KEY,
    id_azienda INTEGER NOT NULL REFERENCES aziende(id) ON DELETE CASCADE,
    campo VARCHAR(100),
    valore_precedente TEXT,
    valore_nuovo TEXT,
    username VARCHAR(100),
    data TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE SET NULL
);
CREATE INDEX idx_modifiche_azienda_azienda ON modifiche_azienda(id_azienda);
CREATE INDEX idx_modifiche_azienda_username ON modifiche_azienda(username);
-- Company events log
CREATE TABLE IF NOT EXISTS eventi_aziende (
    id SERIAL PRIMARY KEY,
    id_azienda INTEGER NOT NULL REFERENCES aziende(id) ON DELETE CASCADE,
    tipo VARCHAR(50),                       -- 'contact', 'payment', 'status_change'
    descrizione TEXT,
    data DATE,
    username VARCHAR(100),
    data_inserimento TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE SET NULL
);
CREATE INDEX idx_eventi_aziende_azienda ON eventi_aziende(id_azienda);
CREATE INDEX idx_eventi_aziende_tipo ON eventi_aziende(tipo);
-- Company notes
CREATE TABLE IF NOT EXISTS note_aziende (
    id SERIAL PRIMARY KEY,
    id_azienda INTEGER NOT NULL REFERENCES aziende(id) ON DELETE CASCADE,
    testo TEXT,
    username VARCHAR(100),
    data_inserimento TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE SET NULL
);
CREATE INDEX idx_note_aziende_azienda ON note_aziende(id_azienda);
-- Consortiums (ATI permanent associations)
CREATE TABLE IF NOT EXISTS consorzi (
    id SERIAL PRIMARY KEY,
    id_azienda_consorzio INTEGER NOT NULL REFERENCES aziende(id) ON DELETE CASCADE,
    id_azienda_membro INTEGER NOT NULL REFERENCES aziende(id) ON DELETE CASCADE,
    data_inizio DATE,
    data_fine DATE,
    attivo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(id_azienda_consorzio, id_azienda_membro)
);
CREATE INDEX idx_consorzi_consorzio ON consorzi(id_azienda_consorzio);
CREATE INDEX idx_consorzi_membro ON consorzi(id_azienda_membro);
-- ============================================================
-- 4. STATION EXTENSIONS
-- ============================================================
-- Station personnel (contacts)
CREATE TABLE IF NOT EXISTS personale_stazione (
    id SERIAL PRIMARY KEY,
    id_stazione INTEGER NOT NULL REFERENCES stazioni(id) ON DELETE CASCADE,
    nome VARCHAR(100),
    cognome VARCHAR(100),
    ruolo VARCHAR(100),
    telefono VARCHAR(50),
    email VARCHAR(200),
    pec VARCHAR(200),
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_personale_stazione_stazione ON personale_stazione(id_stazione);
-- Station audit trail
CREATE TABLE IF NOT EXISTS modifiche_stazioni (
    id SERIAL PRIMARY KEY,
    id_stazione INTEGER NOT NULL REFERENCES stazioni(id) ON DELETE CASCADE,
    campo VARCHAR(100),
    valore_precedente TEXT,
    valore_nuovo TEXT,
    username VARCHAR(100),
    data TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE SET NULL
);
CREATE INDEX idx_modifiche_stazioni_stazione ON modifiche_stazioni(id_stazione);
-- Station presidia mapping (external system references)
CREATE TABLE IF NOT EXISTS stazioni_presidia (
    id SERIAL PRIMARY KEY,
    id_stazione INTEGER NOT NULL REFERENCES stazioni(id) ON DELETE CASCADE,
    codice_presidia VARCHAR(50),
    attivo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(id_stazione, codice_presidia)
);
CREATE INDEX idx_stazioni_presidia_stazione ON stazioni_presidia(id_stazione);
-- Station registrations (on platforms/systems)
CREATE TABLE IF NOT EXISTS iscrizione_stazioni (
    id SERIAL PRIMARY KEY,
    id_stazione INTEGER NOT NULL REFERENCES stazioni(id) ON DELETE CASCADE,
    tipo INTEGER,
    indirizzo TEXT,
    istruzioni TEXT,
    durata INTEGER,                         -- days
    scadenza DATE,
    id_piattaforma INTEGER REFERENCES piattaforme(id),
    is_albo_fornitori BOOLEAN DEFAULT false,
    allegato BYTEA,
    nome_allegato VARCHAR(255),
    data_inserimento TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_iscrizione_stazioni_stazione ON iscrizione_stazioni(id_stazione);
-- ============================================================
-- 5. INTERMEDIARIES (Intermediari)
-- ============================================================
CREATE TABLE IF NOT EXISTS intermediari (
    id SERIAL PRIMARY KEY,
    ragione_sociale VARCHAR(500) NOT NULL,
    indirizzo VARCHAR(300),
    cap VARCHAR(10),
    citta VARCHAR(100),
    id_provincia INTEGER REFERENCES province(id),
    telefono VARCHAR(50),
    fax VARCHAR(50),
    email VARCHAR(200),
    pec VARCHAR(200),
    sito_web VARCHAR(300),
    partita_iva VARCHAR(20) UNIQUE,
    codice_fiscale VARCHAR(20) UNIQUE,
    codice_sdi VARCHAR(10),                 -- SDI code for e-invoicing
    referente VARCHAR(200),
    note TEXT,
    attivo BOOLEAN DEFAULT true,
    eliminato BOOLEAN DEFAULT false,
    data_inserimento TIMESTAMPTZ DEFAULT NOW(),
    data_modifica TIMESTAMPTZ
);
CREATE INDEX idx_intermediari_piva ON intermediari(partita_iva);
CREATE INDEX idx_intermediari_cf ON intermediari(codice_fiscale);
CREATE INDEX idx_intermediari_ragione_trgm ON intermediari USING gin(ragione_sociale gin_trgm_ops);
-- ============================================================
-- 6. WEB SOURCES (Fonti Web) - for automatic scraping
-- ============================================================
-- Web source categories
CREATE TABLE IF NOT EXISTS fonti_web_categorie (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(200) NOT NULL UNIQUE,
    ordine INTEGER DEFAULT 0
);
-- Web source types
CREATE TABLE IF NOT EXISTS fonti_web_tipologie (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(200) NOT NULL,
    id_categoria INTEGER REFERENCES fonti_web_categorie(id),
    ordine INTEGER DEFAULT 0
);
-- Main web sources table
CREATE TABLE IF NOT EXISTS fonti_web (
    id SERIAL PRIMARY KEY,
    id_stazione INTEGER REFERENCES stazioni(id),
    id_categoria INTEGER REFERENCES fonti_web_categorie(id),
    id_tipologia INTEGER REFERENCES fonti_web_tipologie(id),
    link TEXT NOT NULL,
    note TEXT,
    auto BOOLEAN DEFAULT false,             -- auto-scrape enabled
    analyze_type VARCHAR(20),               -- 'html', 'pdf', 'xml'
    tag_inizio TEXT,                        -- start tag for scraping
    tag_fine TEXT,                          -- end tag for scraping
    id_piattaforma INTEGER REFERENCES piattaforme(id),
    attivo BOOLEAN DEFAULT true,
    ultima_verifica TIMESTAMPTZ,
    stato_verifica VARCHAR(20),             -- 'ok', 'error', 'missing'
    errore TEXT,
    data_inserimento TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_fonti_web_stazione ON fonti_web(id_stazione);
CREATE INDEX idx_fonti_web_categoria ON fonti_web(id_categoria);
CREATE INDEX idx_fonti_web_attivo ON fonti_web(attivo);
CREATE INDEX idx_fonti_web_ultima_verifica ON fonti_web(ultima_verifica DESC);
-- Regex rules for web scraping
CREATE TABLE IF NOT EXISTS fonti_web_regulars (
    id SERIAL PRIMARY KEY,
    id_fonte INTEGER NOT NULL REFERENCES fonti_web(id) ON DELETE CASCADE,
    espressione TEXT NOT NULL,              -- regex pattern
    tipo VARCHAR(20),                       -- 'extract', 'filter', 'exclude'
    ordine INTEGER DEFAULT 0
);
CREATE INDEX idx_fonti_web_regulars_fonte ON fonti_web_regulars(id_fonte);
-- Sync/check status for web sources
CREATE TABLE IF NOT EXISTS fonti_web_sync_check (
    id SERIAL PRIMARY KEY,
    id_fonte INTEGER NOT NULL REFERENCES fonti_web(id) ON DELETE CASCADE,
    data_check TIMESTAMPTZ DEFAULT NOW(),
    stato VARCHAR(20),                      -- 'success', 'failed', 'no_change'
    differenze TEXT,                        -- what changed
    hash_contenuto VARCHAR(64)               -- SHA256 of content
);
CREATE INDEX idx_fonti_web_sync_check_fonte ON fonti_web_sync_check(id_fonte);
CREATE INDEX idx_fonti_web_sync_check_data ON fonti_web_sync_check(data_check DESC);
-- Key text patterns for source analysis
CREATE TABLE IF NOT EXISTS fonti_testi_chiave (
    id SERIAL PRIMARY KEY,
    testo VARCHAR(500) NOT NULL UNIQUE,
    tipo INTEGER                            -- pattern type/category
);
-- ============================================================
-- 7. SITE SYNCHRONIZATION
-- ============================================================
-- Sync site categories
CREATE TABLE IF NOT EXISTS sinc_siti_categorie (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(200) NOT NULL UNIQUE
);
-- Sync sites
CREATE TABLE IF NOT EXISTS sinc_siti_siti (
    id VARCHAR(100) PRIMARY KEY,
    id_categoria INTEGER REFERENCES sinc_siti_categorie(id),
    nome VARCHAR(300),
    url TEXT,
    attivo BOOLEAN DEFAULT true,
    ultima_verifica TIMESTAMPTZ
);
CREATE INDEX idx_sinc_siti_categoria ON sinc_siti_siti(id_categoria);
-- Sync expressions (patterns to extract from sites)
CREATE TABLE IF NOT EXISTS sinc_siti_espressioni (
    id SERIAL PRIMARY KEY,
    id_sito VARCHAR(100) NOT NULL REFERENCES sinc_siti_siti(id) ON DELETE CASCADE,
    espressione TEXT,
    tipo VARCHAR(20)                        -- 'xpath', 'regex', 'css'
);
CREATE INDEX idx_sinc_siti_espressioni_sito ON sinc_siti_espressioni(id_sito);
-- ============================================================
-- 8. SYSTEM TABLES
-- ============================================================
-- API keys for external access
CREATE TABLE IF NOT EXISTS api_keys (
    id SERIAL PRIMARY KEY,
    chiave VARCHAR(64) NOT NULL UNIQUE,
    nome VARCHAR(200),
    username VARCHAR(100),
    attivo BOOLEAN DEFAULT true,
    data_creazione TIMESTAMPTZ DEFAULT NOW(),
    ultimo_utilizzo TIMESTAMPTZ,
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE SET NULL
);
CREATE INDEX idx_api_keys_chiave ON api_keys(chiave);
CREATE INDEX idx_api_keys_username ON api_keys(username);
-- Download activity log
CREATE TABLE IF NOT EXISTS downloads_log (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100),
    tipo VARCHAR(100),                      -- 'bandi', 'esiti', 'report'
    id_riferimento VARCHAR(100),            -- ID of downloaded item
    data TIMESTAMPTZ DEFAULT NOW(),
    ip VARCHAR(50),
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE SET NULL
);
CREATE INDEX idx_downloads_log_username ON downloads_log(username);
CREATE INDEX idx_downloads_log_data ON downloads_log(data DESC);
-- Background job messages
CREATE TABLE IF NOT EXISTS job_messages (
    id SERIAL PRIMARY KEY,
    job_name VARCHAR(200),
    messaggio TEXT,
    tipo VARCHAR(20),                       -- 'info', 'warning', 'error'
    data TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_job_messages_job_name ON job_messages(job_name);
CREATE INDEX idx_job_messages_tipo ON job_messages(tipo);
-- Job results and output
CREATE TABLE IF NOT EXISTS job_results (
    id SERIAL PRIMARY KEY,
    job_name VARCHAR(200),
    gruppo VARCHAR(100),
    data_inizio TIMESTAMPTZ,
    data_fine TIMESTAMPTZ,
    stato VARCHAR(20),                      -- 'running', 'success', 'failed'
    risultato TEXT,
    file_risultato BYTEA,
    nome_file VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_job_results_job_name ON job_results(job_name);
CREATE INDEX idx_job_results_data_inizio ON job_results(data_inizio DESC);
-- Client tender registry (user's personal bandi list)
CREATE TABLE IF NOT EXISTS registro_gare_clienti (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    id_bando UUID NOT NULL REFERENCES bandi(id) ON DELETE CASCADE,
    note_registro TEXT,
    data_inserimento TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(username, id_bando),
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);
CREATE INDEX idx_registro_gare_clienti_username ON registro_gare_clienti(username);
CREATE INDEX idx_registro_gare_clienti_bando ON registro_gare_clienti(id_bando);
-- Favorite results/esiti
CREATE TABLE IF NOT EXISTS preferiti_esiti (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    id_gara INTEGER NOT NULL REFERENCES gare(id) ON DELETE CASCADE,
    data_inserimento TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(username, id_gara),
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);
CREATE INDEX idx_preferiti_esiti_username ON preferiti_esiti(username);
CREATE INDEX idx_preferiti_esiti_gara ON preferiti_esiti(id_gara);
-- ============================================================
-- ALTER EXISTING TABLES - Add missing columns
-- ============================================================
-- Add missing columns to users table
DO $$
BEGIN
    -- Add user feature flags
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='users' AND column_name='ruolo_dettagliato') THEN
        ALTER TABLE users ADD COLUMN ruolo_dettagliato VARCHAR(50);
    END IF;
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='users' AND column_name='bandi_enabled') THEN
        ALTER TABLE users ADD COLUMN bandi_enabled BOOLEAN DEFAULT false;
    END IF;
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='users' AND column_name='esiti_enabled') THEN
        ALTER TABLE users ADD COLUMN esiti_enabled BOOLEAN DEFAULT false;
    END IF;
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='users' AND column_name='esiti_light_enabled') THEN
        ALTER TABLE users ADD COLUMN esiti_light_enabled BOOLEAN DEFAULT false;
    END IF;
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='users' AND column_name='newsletter_bandi') THEN
        ALTER TABLE users ADD COLUMN newsletter_bandi BOOLEAN DEFAULT false;
    END IF;
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='users' AND column_name='newsletter_esiti') THEN
        ALTER TABLE users ADD COLUMN newsletter_esiti BOOLEAN DEFAULT false;
    END IF;
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='users' AND column_name='simulazioni_enabled') THEN
        ALTER TABLE users ADD COLUMN simulazioni_enabled BOOLEAN DEFAULT false;
    END IF;
    -- Add subscription dates
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='users' AND column_name='data_scadenza') THEN
        ALTER TABLE users ADD COLUMN data_scadenza DATE;
    END IF;
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='users' AND column_name='data_rinnovo') THEN
        ALTER TABLE users ADD COLUMN data_rinnovo DATE;
    END IF;
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='users' AND column_name='rinnovo_automatico') THEN
        ALTER TABLE users ADD COLUMN rinnovo_automatico BOOLEAN DEFAULT false;
    END IF;
    -- Add blocking
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='users' AND column_name='bloccato') THEN
        ALTER TABLE users ADD COLUMN bloccato BOOLEAN DEFAULT false;
    END IF;
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='users' AND column_name='motivo_blocco') THEN
        ALTER TABLE users ADD COLUMN motivo_blocco TEXT;
    END IF;
    -- Add agent management
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='users' AND column_name='codice_agente') THEN
        ALTER TABLE users ADD COLUMN codice_agente VARCHAR(50);
    END IF;
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='users' AND column_name='gestibile_da_agente') THEN
        ALTER TABLE users ADD COLUMN gestibile_da_agente BOOLEAN DEFAULT false;
    END IF;
    -- Add platform assignment
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='users' AND column_name='id_piattaforma') THEN
        ALTER TABLE users ADD COLUMN id_piattaforma INTEGER REFERENCES piattaforme(id);
    END IF;
    -- Add admin notes
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='users' AND column_name='note_admin') THEN
        ALTER TABLE users ADD COLUMN note_admin TEXT;
    END IF;
END $$;
-- Add missing columns to aziende table
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='aziende' AND column_name='eliminata') THEN
        ALTER TABLE aziende ADD COLUMN eliminata BOOLEAN DEFAULT false;
    END IF;
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='aziende' AND column_name='legale_rappresentante_cognome') THEN
        ALTER TABLE aziende ADD COLUMN legale_rappresentante_cognome VARCHAR(100);
    END IF;
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='aziende' AND column_name='legale_rappresentante_nome') THEN
        ALTER TABLE aziende ADD COLUMN legale_rappresentante_nome VARCHAR(100);
    END IF;
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='aziende' AND column_name='sede_legale_indirizzo') THEN
        ALTER TABLE aziende ADD COLUMN sede_legale_indirizzo VARCHAR(300);
    END IF;
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='aziende' AND column_name='sede_legale_cap') THEN
        ALTER TABLE aziende ADD COLUMN sede_legale_cap VARCHAR(10);
    END IF;
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='aziende' AND column_name='sede_legale_citta') THEN
        ALTER TABLE aziende ADD COLUMN sede_legale_citta VARCHAR(100);
    END IF;
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='aziende' AND column_name='sede_legale_provincia') THEN
        ALTER TABLE aziende ADD COLUMN sede_legale_provincia INTEGER REFERENCES province(id);
    END IF;
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='aziende' AND column_name='data_inserimento') THEN
        ALTER TABLE aziende ADD COLUMN data_inserimento TIMESTAMPTZ DEFAULT NOW();
    END IF;
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='aziende' AND column_name='data_modifica') THEN
        ALTER TABLE aziende ADD COLUMN data_modifica TIMESTAMPTZ;
    END IF;
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='aziende' AND column_name='inserito_da') THEN
        ALTER TABLE aziende ADD COLUMN inserito_da VARCHAR(100);
    END IF;
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='aziende' AND column_name='modificato_da') THEN
        ALTER TABLE aziende ADD COLUMN modificato_da VARCHAR(100);
    END IF;
END $$;
-- Add missing columns to stazioni table
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='stazioni' AND column_name='eliminata') THEN
        ALTER TABLE stazioni ADD COLUMN eliminata BOOLEAN DEFAULT false;
    END IF;
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='stazioni' AND column_name='responsabile') THEN
        ALTER TABLE stazioni ADD COLUMN responsabile VARCHAR(200);
    END IF;
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='stazioni' AND column_name='telefono_responsabile') THEN
        ALTER TABLE stazioni ADD COLUMN telefono_responsabile VARCHAR(50);
    END IF;
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='stazioni' AND column_name='email_responsabile') THEN
        ALTER TABLE stazioni ADD COLUMN email_responsabile VARCHAR(200);
    END IF;
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='stazioni' AND column_name='note') THEN
        ALTER TABLE stazioni ADD COLUMN note TEXT;
    END IF;
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='stazioni' AND column_name='data_inserimento') THEN
        ALTER TABLE stazioni ADD COLUMN data_inserimento TIMESTAMPTZ DEFAULT NOW();
    END IF;
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='stazioni' AND column_name='data_modifica') THEN
        ALTER TABLE stazioni ADD COLUMN data_modifica TIMESTAMPTZ;
    END IF;
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='stazioni' AND column_name='inserito_da') THEN
        ALTER TABLE stazioni ADD COLUMN inserito_da VARCHAR(100);
    END IF;
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='stazioni' AND column_name='modificato_da') THEN
        ALTER TABLE stazioni ADD COLUMN modificato_da VARCHAR(100);
    END IF;
END $$;
-- ============================================================
-- COMPREHENSIVE INDEXES for common query patterns
-- ============================================================
-- User/Access indexes
CREATE INDEX IF NOT EXISTS idx_users_bloccato ON users(bloccato) WHERE bloccato = true;
CREATE INDEX IF NOT EXISTS idx_users_bandi ON users(bandi_enabled) WHERE bandi_enabled = true;
CREATE INDEX IF NOT EXISTS idx_users_esiti ON users(esiti_enabled) WHERE esiti_enabled = true;
CREATE INDEX IF NOT EXISTS idx_users_codice_agente ON users(codice_agente);
CREATE INDEX IF NOT EXISTS idx_users_scadenza ON users(data_scadenza) WHERE data_scadenza > NOW();
-- Billing indexes
CREATE INDEX IF NOT EXISTS idx_fatture_periodo ON fatture(id_periodo);
CREATE INDEX IF NOT EXISTS idx_fatture_unpaid ON fatture(username, pagata) WHERE pagata = false;
-- Company indexes
CREATE INDEX IF NOT EXISTS idx_aziende_eliminata ON aziende(eliminata) WHERE eliminata = false;
CREATE INDEX IF NOT EXISTS idx_aziende_sede_legale_provincia ON aziende(sede_legale_provincia);
-- Station indexes
CREATE INDEX IF NOT EXISTS idx_stazioni_eliminata ON stazioni(eliminata) WHERE eliminata = false;
-- Web sources performance
CREATE INDEX IF NOT EXISTS idx_fonti_web_auto ON fonti_web(attivo, auto) WHERE attivo = true AND auto = true;
-- Intermediaries
CREATE INDEX IF NOT EXISTS idx_intermediari_attivo ON intermediari(attivo) WHERE attivo = true;
-- ============================================================
-- COMMENTS
-- ============================================================
COMMENT ON TABLE users_periodi IS 'Subscription periods with feature-level pricing for each user';
COMMENT ON TABLE user_emails IS 'Additional contact emails per user (in addition to primary email in users table)';
COMMENT ON TABLE agenti_incaricati IS 'Delegated operator assignments - agent can manage incaricato user';
COMMENT ON TABLE fatture IS 'Invoices with IVA calculation and payment tracking';
COMMENT ON TABLE dettaglio_fattura IS 'Invoice line items, allowing itemized payment tracking';
COMMENT ON TABLE consorzi IS 'Permanent ATI consortium associations between companies';
COMMENT ON TABLE fonti_web IS 'Web sources for automatic scraping/monitoring of tender sites';
COMMENT ON TABLE fonti_web_regulars IS 'Regex patterns used to extract data from web sources';
COMMENT ON TABLE intermediari IS 'External intermediary/service provider registry';
COMMENT ON TABLE registro_gare_clienti IS 'User''s personal tender registry/watchlist';
COMMENT ON COLUMN stazioni.id_presidia IS 'Legacy reference to Presidia external system ID';
COMMENT ON COLUMN users.bandi_enabled IS 'User has active Bandi feature subscription';
COMMENT ON COLUMN users.esiti_enabled IS 'User has active Esiti feature subscription';
COMMENT ON COLUMN users.simulazioni_enabled IS 'User has active Simulazioni feature subscription';
COMMENT ON COLUMN fatture.iva IS 'IVA rate percentage (default 22%)';
COMMENT ON COLUMN fonti_web.auto IS 'Enable automatic scraping/monitoring of this source';
COMMENT ON COLUMN consorzi.id_azienda_consorzio IS 'The consortium/ATI company';
COMMENT ON COLUMN consorzi.id_azienda_membro IS 'Member company of the consortium';
-- End of migration 005_complete_schema.sql

-- ========== 006_additional_features.sql ==========
-- ============================================================
-- EASYWIN - PostgreSQL Schema Migration 006
-- Module: Additional Features & Support Infrastructure
-- Date: March 2026
-- ============================================================
-- This migration adds:
-- - Intermediari (Intermediaries)
-- - Esecutori Esterni (External Executors - enhanced from migration 001)
-- - Tipo Esecutore lookup (already exists in migration 001, but enhanced here)
-- - Fonti Web (Web Source Crawling)
-- - Sinc Siti (Site Synchronization)
-- - Piattaforme (enhanced from migration 001)
-- - Punteggi (Score tracking for tenders)
-- - Avvalimenti (Availing - subcontracting relationships)
-- - Newsletter management
-- - API keys management
-- - Error logging & monitoring
-- - Downloads tracking
-- - Background jobs system
-- - CMS Pages
-- - Password reset tokens
-- - Additional bandi & gare columns
-- ============================================================
-- ============================================================
-- INTERMEDIARI TABLE (Intermediaries/Brokers)
-- ============================================================
CREATE TABLE IF NOT EXISTS intermediari (
    id SERIAL PRIMARY KEY,
    ragione_sociale VARCHAR(500) NOT NULL,
    indirizzo VARCHAR(500),
    cap VARCHAR(10),
    citta VARCHAR(200),
    id_provincia INTEGER REFERENCES province(id),
    telefono VARCHAR(50),
    fax VARCHAR(50),
    email VARCHAR(200),
    pec VARCHAR(200),
    sito_web VARCHAR(500),
    partita_iva VARCHAR(20),
    codice_fiscale VARCHAR(20),
    codice_sdi VARCHAR(10),
    referente VARCHAR(200),
    note TEXT,
    eliminato BOOLEAN DEFAULT false,
    data_inserimento TIMESTAMPTZ DEFAULT NOW(),
    data_modifica TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_intermediari_provincia ON intermediari(id_provincia);
CREATE INDEX IF NOT EXISTS idx_intermediari_partita_iva ON intermediari(partita_iva);
CREATE INDEX IF NOT EXISTS idx_intermediari_ragione_sociale_trgm ON intermediari USING gin(ragione_sociale gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_intermediari_attivo ON intermediari(eliminato);
-- ============================================================
-- ENHANCED ESECUTORI ESTERNI (External Executors)
-- ============================================================
-- Note: Basic table already exists in migration 001, we enhance it here
ALTER TABLE esecutori_esterni ADD COLUMN IF NOT EXISTS ragione_sociale VARCHAR(500);
ALTER TABLE esecutori_esterni ADD COLUMN IF NOT EXISTS cognome VARCHAR(200);
ALTER TABLE esecutori_esterni ADD COLUMN IF NOT EXISTS indirizzo VARCHAR(500);
ALTER TABLE esecutori_esterni ADD COLUMN IF NOT EXISTS cap VARCHAR(10);
ALTER TABLE esecutori_esterni ADD COLUMN IF NOT EXISTS citta VARCHAR(200);
ALTER TABLE esecutori_esterni ADD COLUMN IF NOT EXISTS id_provincia INTEGER REFERENCES province(id);
ALTER TABLE esecutori_esterni ADD COLUMN IF NOT EXISTS cellulare VARCHAR(50);
ALTER TABLE esecutori_esterni ADD COLUMN IF NOT EXISTS pec VARCHAR(200);
ALTER TABLE esecutori_esterni ADD COLUMN IF NOT EXISTS partita_iva VARCHAR(20);
ALTER TABLE esecutori_esterni ADD COLUMN IF NOT EXISTS codice_fiscale VARCHAR(20);
ALTER TABLE esecutori_esterni ADD COLUMN IF NOT EXISTS codice_sdi VARCHAR(10);
ALTER TABLE esecutori_esterni ADD COLUMN IF NOT EXISTS id_tipo_esecutore INTEGER REFERENCES tipo_esecutore(id);
ALTER TABLE esecutori_esterni ADD COLUMN IF NOT EXISTS zone_operative TEXT[];
ALTER TABLE esecutori_esterni ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE esecutori_esterni ADD COLUMN IF NOT EXISTS eliminato BOOLEAN DEFAULT false;
ALTER TABLE esecutori_esterni ADD COLUMN IF NOT EXISTS data_inserimento TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE esecutori_esterni ADD COLUMN IF NOT EXISTS data_modifica TIMESTAMPTZ DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_esecutori_provincia ON esecutori_esterni(id_provincia);
CREATE INDEX IF NOT EXISTS idx_esecutori_tipo ON esecutori_esterni(id_tipo_esecutore);
CREATE INDEX IF NOT EXISTS idx_esecutori_partita_iva ON esecutori_esterni(partita_iva);
-- ============================================================
-- ENHANCE TIPO ESECUTORE (already in migration 001, add data)
-- ============================================================
INSERT INTO tipo_esecutore (nome, attivo) VALUES
('Geometra', true),
('Ingegnere', true),
('Architetto', true),
('Perito', true),
('Tecnico', true),
('Altro', true)
ON CONFLICT DO NOTHING;
-- ============================================================
-- FONTI WEB (Web Source Crawling for Bandi/Esiti extraction)
-- ============================================================
CREATE TABLE IF NOT EXISTS fonti_web (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(500) NOT NULL,
    url VARCHAR(1000) NOT NULL,
    id_categoria INTEGER,
    id_tipologia INTEGER,
    attiva BOOLEAN DEFAULT true,
    intervallo_minuti INTEGER DEFAULT 60,
    regex_titolo TEXT,
    regex_data TEXT,
    regex_importo TEXT,
    regex_cig TEXT,
    note TEXT,
    ultimo_controllo TIMESTAMPTZ,
    data_inserimento TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fonti_web_categoria ON fonti_web(id_categoria);
CREATE INDEX IF NOT EXISTS idx_fonti_web_tipologia ON fonti_web(id_tipologia);
CREATE INDEX IF NOT EXISTS idx_fonti_web_attiva ON fonti_web(attiva);
CREATE INDEX IF NOT EXISTS idx_fonti_web_url ON fonti_web(url);
-- ============================================================
-- FONTI WEB CATEGORIE
-- ============================================================
CREATE TABLE IF NOT EXISTS fonti_web_categorie (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(200) NOT NULL UNIQUE
);
-- ============================================================
-- FONTI WEB TIPOLOGIE
-- ============================================================
CREATE TABLE IF NOT EXISTS fonti_web_tipologie (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(200) NOT NULL UNIQUE
);
-- ============================================================
-- FONTI WEB REGEX PATTERNS
-- ============================================================
CREATE TABLE IF NOT EXISTS fonti_web_regulars (
    id SERIAL PRIMARY KEY,
    id_fonte INT NOT NULL REFERENCES fonti_web(id) ON DELETE CASCADE,
    pattern TEXT NOT NULL,
    tipo VARCHAR(50),
    descrizione VARCHAR(500)
);
CREATE INDEX IF NOT EXISTS idx_fonti_web_regulars_fonte ON fonti_web_regulars(id_fonte);
-- ============================================================
-- FONTI WEB SYNC CHECK (Sync history)
-- ============================================================
CREATE TABLE IF NOT EXISTS fonti_web_sync_check (
    id SERIAL PRIMARY KEY,
    id_fonte INT NOT NULL REFERENCES fonti_web(id) ON DELETE CASCADE,
    data_controllo TIMESTAMPTZ DEFAULT NOW(),
    esito VARCHAR(50),
    nuovi INT DEFAULT 0,
    aggiornati INT DEFAULT 0,
    errori INT DEFAULT 0,
    dettaglio TEXT
);
CREATE INDEX IF NOT EXISTS idx_fonti_web_sync_fonte ON fonti_web_sync_check(id_fonte);
CREATE INDEX IF NOT EXISTS idx_fonti_web_sync_data ON fonti_web_sync_check(data_controllo DESC);
-- ============================================================
-- FONTI TESTI CHIAVE (Key text patterns to match)
-- ============================================================
CREATE TABLE IF NOT EXISTS fonti_testi_chiave (
    id SERIAL PRIMARY KEY,
    id_fonte INT NOT NULL REFERENCES fonti_web(id) ON DELETE CASCADE,
    testo VARCHAR(500) NOT NULL,
    attivo BOOLEAN DEFAULT true
);
CREATE INDEX IF NOT EXISTS idx_fonti_testi_chiave_fonte ON fonti_testi_chiave(id_fonte);
-- ============================================================
-- SINC SITI (Site Synchronization)
-- ============================================================
CREATE TABLE IF NOT EXISTS sinc_siti (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(500) NOT NULL,
    url VARCHAR(1000) NOT NULL,
    attivo BOOLEAN DEFAULT true,
    note TEXT,
    data_inserimento TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sinc_siti_attivo ON sinc_siti(attivo);
CREATE INDEX IF NOT EXISTS idx_sinc_siti_url ON sinc_siti(url);
-- ============================================================
-- SINC SITI CATEGORIE
-- ============================================================
CREATE TABLE IF NOT EXISTS sinc_siti_categorie (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(200) NOT NULL UNIQUE
);
-- ============================================================
-- SINC SITI ESPRESSIONI (XPath/CSS expressions for extraction)
-- ============================================================
CREATE TABLE IF NOT EXISTS sinc_siti_espressioni (
    id SERIAL PRIMARY KEY,
    id_sito INT NOT NULL REFERENCES sinc_siti(id) ON DELETE CASCADE,
    espressione TEXT NOT NULL,
    tipo VARCHAR(50),
    descrizione VARCHAR(500)
);
CREATE INDEX IF NOT EXISTS idx_sinc_siti_espressioni_sito ON sinc_siti_espressioni(id_sito);
-- ============================================================
-- ENHANCE PIATTAFORME (already exists in migration 001)
-- ============================================================
ALTER TABLE piattaforme ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE piattaforme ADD COLUMN IF NOT EXISTS attiva BOOLEAN DEFAULT true;
ALTER TABLE piattaforme ADD COLUMN IF NOT EXISTS data_inserimento TIMESTAMPTZ DEFAULT NOW();
-- ============================================================
-- PIATTAFORME REGULARS (Regex patterns for platform scraping)
-- ============================================================
CREATE TABLE IF NOT EXISTS piattaforme_regulars (
    id SERIAL PRIMARY KEY,
    id_piattaforma INT NOT NULL REFERENCES piattaforme(id) ON DELETE CASCADE,
    pattern TEXT NOT NULL,
    tipo VARCHAR(50),
    descrizione VARCHAR(500)
);
CREATE INDEX IF NOT EXISTS idx_piattaforme_regulars_piattaforma ON piattaforme_regulars(id_piattaforma);
-- ============================================================
-- PUNTEGGI (Score tracking for tenders - enhanced from migration 002)
-- ============================================================
-- Note: Basic punteggi table already exists in migration 002
-- This adds additional score tracking if needed
CREATE TABLE IF NOT EXISTS punteggi_storico (
    id SERIAL PRIMARY KEY,
    id_punteggio UUID REFERENCES punteggi(id_punteggio) ON DELETE CASCADE,
    id_gara INTEGER REFERENCES gare(id) ON DELETE CASCADE,
    id_azienda INTEGER REFERENCES aziende(id),
    punteggio_tecnico DECIMAL(10,4),
    punteggio_economico DECIMAL(10,4),
    punteggio_totale DECIMAL(10,4),
    note TEXT,
    data_inserimento TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_punteggi_storico_gara ON punteggi_storico(id_gara);
CREATE INDEX IF NOT EXISTS idx_punteggi_storico_azienda ON punteggi_storico(id_azienda);
-- ============================================================
-- AVVALIMENTI GARE (Subcontracting relationships)
-- ============================================================
CREATE TABLE IF NOT EXISTS avvalimenti_gare (
    id SERIAL PRIMARY KEY,
    id_gara INTEGER REFERENCES gare(id) ON DELETE CASCADE,
    id_azienda_principale INTEGER REFERENCES aziende(id),
    id_azienda_ausiliaria INTEGER REFERENCES aziende(id),
    tipo VARCHAR(100),
    data_inserimento TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_avvalimenti_gara ON avvalimenti_gare(id_gara);
CREATE INDEX IF NOT EXISTS idx_avvalimenti_principale ON avvalimenti_gare(id_azienda_principale);
CREATE INDEX IF NOT EXISTS idx_avvalimenti_ausiliaria ON avvalimenti_gare(id_azienda_ausiliaria);
-- ============================================================
-- NEWSLETTER INVII (Newsletter sending logs)
-- ============================================================
CREATE TABLE IF NOT EXISTS newsletter_invii (
    id SERIAL PRIMARY KEY,
    tipo VARCHAR(20) NOT NULL,
    oggetto VARCHAR(500),
    testo TEXT,
    data_invio TIMESTAMPTZ DEFAULT NOW(),
    destinatari INT DEFAULT 0,
    inviati INT DEFAULT 0,
    falliti INT DEFAULT 0,
    username_invio VARCHAR(200)
);
CREATE INDEX IF NOT EXISTS idx_newsletter_invii_data ON newsletter_invii(data_invio DESC);
CREATE INDEX IF NOT EXISTS idx_newsletter_invii_tipo ON newsletter_invii(tipo);
-- ============================================================
-- API KEYS MANAGEMENT
-- ============================================================
CREATE TABLE IF NOT EXISTS api (
    id SERIAL PRIMARY KEY,
    chiave VARCHAR(100) NOT NULL UNIQUE,
    attiva BOOLEAN DEFAULT true,
    id_utente INT REFERENCES users(id) ON DELETE SET NULL,
    data_creazione TIMESTAMPTZ DEFAULT NOW(),
    data_scadenza DATE,
    limiti_giornalieri INT DEFAULT 1000,
    utilizzi_oggi INT DEFAULT 0,
    ultimo_utilizzo TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_api_chiave ON api(chiave);
CREATE INDEX IF NOT EXISTS idx_api_utente ON api(id_utente);
CREATE INDEX IF NOT EXISTS idx_api_attiva ON api(attiva);
CREATE INDEX IF NOT EXISTS idx_api_scadenza ON api(data_scadenza);
-- ============================================================
-- ERROR LOGGING & MONITORING
-- ============================================================
CREATE TABLE IF NOT EXISTS errori (
    id SERIAL PRIMARY KEY,
    tipo VARCHAR(100),
    messaggio TEXT,
    stack_trace TEXT,
    url VARCHAR(1000),
    metodo VARCHAR(10),
    utente VARCHAR(200),
    ip VARCHAR(50),
    data TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_errori_tipo ON errori(tipo);
CREATE INDEX IF NOT EXISTS idx_errori_data ON errori(data DESC);
CREATE INDEX IF NOT EXISTS idx_errori_utente ON errori(utente);
-- ============================================================
-- DOWNLOADS LOG
-- ============================================================
CREATE TABLE IF NOT EXISTS downloads (
    id SERIAL PRIMARY KEY,
    tipo VARCHAR(50),
    id_entita INT,
    utente VARCHAR(200),
    ip VARCHAR(50),
    data TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_downloads_tipo ON downloads(tipo);
CREATE INDEX IF NOT EXISTS idx_downloads_data ON downloads(data DESC);
CREATE INDEX IF NOT EXISTS idx_downloads_utente ON downloads(utente);
-- ============================================================
-- BACKGROUND JOBS SYSTEM
-- ============================================================
CREATE TABLE IF NOT EXISTS jobs (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(200),
    tipo VARCHAR(100),
    stato VARCHAR(50) DEFAULT 'pending',
    data_inizio TIMESTAMPTZ,
    data_fine TIMESTAMPTZ,
    progresso INT DEFAULT 0,
    risultato TEXT,
    errore TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_stato ON jobs(stato);
CREATE INDEX IF NOT EXISTS idx_jobs_tipo ON jobs(tipo);
CREATE INDEX IF NOT EXISTS idx_jobs_data_inizio ON jobs(data_inizio DESC);
-- ============================================================
-- JOB MESSAGES (Job execution log messages)
-- ============================================================
CREATE TABLE IF NOT EXISTS job_messages (
    id SERIAL PRIMARY KEY,
    id_job INT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    messaggio TEXT,
    livello VARCHAR(20) DEFAULT 'info',
    data TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_job_messages_job ON job_messages(id_job);
CREATE INDEX IF NOT EXISTS idx_job_messages_livello ON job_messages(livello);
-- ============================================================
-- PAGINE (CMS Pages)
-- ============================================================
CREATE TABLE IF NOT EXISTS pagine (
    id SERIAL PRIMARY KEY,
    slug VARCHAR(100) NOT NULL UNIQUE,
    titolo VARCHAR(500),
    contenuto_html TEXT,
    meta_description VARCHAR(500),
    attiva BOOLEAN DEFAULT true,
    data_modifica TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pagine_slug ON pagine(slug);
CREATE INDEX IF NOT EXISTS idx_pagine_attiva ON pagine(attiva);
-- Insert default CMS pages
INSERT INTO pagine (slug, titolo, contenuto_html) VALUES
('apertura-buste', 'Servizio Apertura Buste', '<p>Servizio professionale di apertura buste per gare d''appalto...</p>'),
('on-demand', 'Servizio On Demand', '<p>Servizi personalizzati su richiesta...</p>'),
('formazione', 'Formazione', '<p>Corsi di formazione specializzati...</p>'),
('consulenza', 'Consulenza', '<p>Consulenza specializzata in appalti pubblici...</p>'),
('software', 'Software', '<p>Soluzioni software per la gestione degli appalti...</p>'),
('assistenza', 'Assistenza', '<p>Supporto tecnico e assistenza clienti...</p>')
ON CONFLICT (slug) DO NOTHING;
-- ============================================================
-- PASSWORD RESET TOKENS (Added to users table)
-- ============================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token VARCHAR(200);
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expiry TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_users_reset_token ON users(reset_token);
-- ============================================================
-- NEWSLETTER FLAG ON USERS
-- ============================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS newsletter_attiva BOOLEAN DEFAULT true;
-- ============================================================
-- ADDITIONAL BANDI COLUMNS
-- ============================================================
ALTER TABLE bandi ADD COLUMN IF NOT EXISTS "Avviso" BOOLEAN DEFAULT false;
ALTER TABLE bandi ADD COLUMN IF NOT EXISTS "NoteAvviso" TEXT;
ALTER TABLE bandi ADD COLUMN IF NOT EXISTS "Controllo" BOOLEAN DEFAULT false;
ALTER TABLE bandi ADD COLUMN IF NOT EXISTS "NoteControllo" TEXT;
ALTER TABLE bandi ADD COLUMN IF NOT EXISTS "LinkWeb" TEXT;
ALTER TABLE bandi ADD COLUMN IF NOT EXISTS "LinkWebDescrizione" VARCHAR(500);
ALTER TABLE bandi ADD COLUMN IF NOT EXISTS "TipoCauzione" VARCHAR(100);
ALTER TABLE bandi ADD COLUMN IF NOT EXISTS "ImportoCauzione" DECIMAL(18,2);
ALTER TABLE bandi ADD COLUMN IF NOT EXISTS "PercentualeCauzione" DECIMAL(5,2);
ALTER TABLE bandi ADD COLUMN IF NOT EXISTS "id_tipologia_esito" INT;
CREATE INDEX IF NOT EXISTS idx_bandi_avviso ON bandi("Avviso");
CREATE INDEX IF NOT EXISTS idx_bandi_controllo ON bandi("Controllo");
-- ============================================================
-- ADDITIONAL PRESA VISIONE DATES (if missing)
-- ============================================================
-- Note: Table already exists in migration 001, but ensuring it's here
-- ============================================================
-- BANDI LINKS (Additional bandi links/documents)
-- ============================================================
CREATE TABLE IF NOT EXISTS bandi_links (
    id SERIAL PRIMARY KEY,
    id_bando UUID NOT NULL REFERENCES bandi(id) ON DELETE CASCADE,
    url VARCHAR(1000),
    descrizione VARCHAR(500),
    tipo VARCHAR(20) DEFAULT 'semplice',
    data_inserimento TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bandi_links_bando ON bandi_links(id_bando);
-- ============================================================
-- VIEWS FOR ANALYTICS & REPORTING
-- ============================================================
-- View for api usage analytics
CREATE OR REPLACE VIEW v_api_utilizzo AS
SELECT
    a.id,
    a.chiave,
    u.username,
    a.attiva,
    a.data_creazione,
    a.data_scadenza,
    a.limiti_giornalieri,
    a.utilizzi_oggi,
    a.ultimo_utilizzo,
    CASE
        WHEN a.data_scadenza < NOW() THEN 'scaduto'
        WHEN a.attiva = false THEN 'disabilitato'
        ELSE 'attivo'
    END AS stato
FROM api a
LEFT JOIN users u ON a.id_utente = u.id;
-- View for job monitoring
CREATE OR REPLACE VIEW v_jobs_active AS
SELECT
    j.id,
    j.nome,
    j.tipo,
    j.stato,
    j.data_inizio,
    j.data_fine,
    j.progresso,
    EXTRACT(EPOCH FROM (NOW() - j.data_inizio)) / 60 AS minuti_elapsed,
    COUNT(jm.id) AS n_messaggi
FROM jobs j
LEFT JOIN job_messages jm ON j.id = jm.id_job
WHERE j.stato IN ('pending', 'running')
GROUP BY j.id;
-- ============================================================
-- FINAL INTEGRITY CHECKS & COMMENTS
-- ============================================================
COMMENT ON TABLE intermediari IS 'Intermediaries/brokers managing contracts and services';
COMMENT ON TABLE esecutori_esterni IS 'External executors (surveyors, engineers, etc)';
COMMENT ON TABLE fonti_web IS 'Web sources for automated bandi/esiti extraction';
COMMENT ON TABLE sinc_siti IS 'Website synchronization targets';
COMMENT ON TABLE newsletter_invii IS 'Newsletter distribution logs';
COMMENT ON TABLE api IS 'API keys for external integrations';
COMMENT ON TABLE errori IS 'Application error logging and monitoring';
COMMENT ON TABLE jobs IS 'Background job queue and status tracking';
COMMENT ON TABLE pagine IS 'CMS content pages';
COMMENT ON TABLE avvalimenti_gare IS 'Subcontracting/availing relationships in tenders';
-- ============================================================
-- END OF MIGRATION 006
-- ============================================================

-- ========== 007_sopralluoghi_full.sql ==========
-- ============================================================
-- EASYWIN - PostgreSQL Schema Migration 007
-- Module: Full Sopralluoghi Management System
-- Date: March 2026
-- ============================================================
-- ============================================================
-- SOPRALLUOGHI (Site Inspections) - Full management table
-- Mirrors original SQL Server Sopralluoghi table + export columns
-- ============================================================
CREATE TABLE IF NOT EXISTS sopralluoghi (
    id_visione UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    id_bando UUID NOT NULL REFERENCES bandi(id) ON DELETE CASCADE,
    -- Scheduling
    "DataSopralluogo" TIMESTAMPTZ NOT NULL,
    "DataPrenotazione" TIMESTAMPTZ,
    "DataRichiesta" TIMESTAMPTZ,
    -- Status flags
    "Prenotato" BOOLEAN DEFAULT false,
    "Eseguito" BOOLEAN DEFAULT false,
    "Annullato" BOOLEAN DEFAULT false,
    "PresaVisione" BOOLEAN DEFAULT false,  -- true = document review, false = physical inspection
    -- Type
    "TipoPrenotazione" VARCHAR(200),  -- Diretta, Intermediata
    -- Contact info (for the sopralluogo location)
    "Fax" VARCHAR(200),
    "Telefono" VARCHAR(200),
    "Email" VARCHAR(200),
    "Indirizzo" TEXT,
    "Cap" VARCHAR(6),
    "Citta" VARCHAR(100),
    id_provincia INTEGER REFERENCES province(id),
    -- Requesting company
    id_azienda INTEGER NOT NULL REFERENCES aziende(id),
    "Username" VARCHAR(256),
    "RiferimentoAziendaRichiedente" VARCHAR(500),
    -- Request / Execution status (enum-like)
    -- Richiesta: 0=pendente, 1=confermata, 2=rifiutata
    -- Esecuzione: 0=interna_sede, 1=interna_fuori, 2=esterna
    "Richiesta" INTEGER DEFAULT 0,
    "Esecuzione" INTEGER DEFAULT 0,
    -- Intermediary (who requested on behalf)
    "IDIntermediarioRichiedente" UUID,
    "RiferimentoIntermediarioRichiedente" VARCHAR(500),
    -- Executor (intermediary or external who does the inspection)
    "IDIntermediarioEsecutore" UUID,
    "RiferimentoIntermediarioEsecutore" VARCHAR(500),
    "IDTipoEsecutore" INTEGER DEFAULT 0,  -- 0=interno, 1=intermediario, 2=esterno
    "IDEsecutoreEsterno" INTEGER REFERENCES esecutori_esterni(id),
    -- Call manager
    "GestoreRichiesta" VARCHAR(256),
    -- === PAYMENT FLOWS (5 separate flows) ===
    -- 1) Company → Edra
    "PagatoDaAziendaAEdra" BOOLEAN DEFAULT false,
    "ImponibileDaAziendaAEdra" NUMERIC(12,2) DEFAULT 0,
    "IvaDaAziendaAEdra" NUMERIC(12,2) DEFAULT 0,
    "TotaleDaAziendaAEdra" NUMERIC(12,2) DEFAULT 0,
    "DataPagamentoDaAziendaAEdra" TIMESTAMPTZ,
    -- 2) Edra → Gestore Chiamata
    "PagatoDaEdraAlGestoreChiamata" BOOLEAN DEFAULT false,
    "ImponibileDaEdraAGestoreChiamata" NUMERIC(12,2) DEFAULT 0,
    "IvaDaEdraAGestoreChiamata" NUMERIC(12,2) DEFAULT 0,
    "TotaleDaEdraAGestoreChiamata" NUMERIC(12,2) DEFAULT 0,
    "DataPagamentoDaEdraAGestoreChiamata" TIMESTAMPTZ,
    -- 3) Edra → Collaboratore
    "PagatoDaEdraACollaboratore" BOOLEAN DEFAULT false,
    "ImponibileDaEdraACollaboratore" NUMERIC(12,2) DEFAULT 0,
    "IvaDaEdraACollaboratore" NUMERIC(12,2) DEFAULT 0,
    "TotaleDaEdraACollaboratore" NUMERIC(12,2) DEFAULT 0,
    "DataPagamentoDaEdraACollaboratore" TIMESTAMPTZ,
    -- 4) Edra → Intermediari
    "PagatoDaEdraAIntermediari" BOOLEAN DEFAULT false,
    "ImponibileDaEdraAIntermediari" NUMERIC(12,2) DEFAULT 0,
    "IvaDaEdraAIntermediari" NUMERIC(12,2) DEFAULT 0,
    "TotaleDaEdraAIntermediari" NUMERIC(12,2) DEFAULT 0,
    "DataPagamentoDaEdraAIntermediari" TIMESTAMPTZ,
    -- 5) Intermediari → Edra
    "PagatoDaIntermediariAEdra" BOOLEAN DEFAULT false,
    "ImponibileDaIntermediariAEdra" NUMERIC(12,2) DEFAULT 0,
    "IvaDaIntermediariAEdra" NUMERIC(12,2) DEFAULT 0,
    "TotaleDaIntermediariAEdra" NUMERIC(12,2) DEFAULT 0,
    "DataPagamentoDaIntermediariAEdra" TIMESTAMPTZ,
    -- Billing
    "ProformaInviato" BOOLEAN DEFAULT false,
    "FatturaElettronicaGenerata" BOOLEAN DEFAULT false,
    -- ATI (Consortium) support
    "NumATI" INTEGER DEFAULT 0,
    "IDAziendaATI01" INTEGER REFERENCES aziende(id),
    "IDAziendaATI02" INTEGER REFERENCES aziende(id),
    "IDAziendaATI03" INTEGER REFERENCES aziende(id),
    "IDAziendaATI04" INTEGER REFERENCES aziende(id),
    "AziendaAbbonataSopralluoghi" BOOLEAN DEFAULT false,
    -- Notes
    "Note" TEXT,
    -- Audit
    "DataInserimento" TIMESTAMPTZ DEFAULT NOW(),
    "InseritoDa" VARCHAR(256),
    "DataModifica" TIMESTAMPTZ,
    "ModificatoDa" VARCHAR(256)
);
-- Indexes
CREATE INDEX idx_sopr_bando ON sopralluoghi(id_bando);
CREATE INDEX idx_sopr_azienda ON sopralluoghi(id_azienda);
CREATE INDEX idx_sopr_data ON sopralluoghi("DataSopralluogo");
CREATE INDEX idx_sopr_username ON sopralluoghi("Username");
CREATE INDEX idx_sopr_eseguito ON sopralluoghi("Eseguito");
CREATE INDEX idx_sopr_annullato ON sopralluoghi("Annullato");
CREATE INDEX idx_sopr_provincia ON sopralluoghi(id_provincia);
CREATE INDEX idx_sopr_prenotato ON sopralluoghi("Prenotato");
-- ============================================================
-- SOPRALLUOGHI_DATE (Available dates for sopralluoghi per bando)
-- ============================================================
CREATE TABLE IF NOT EXISTS sopralluoghi_date (
    id SERIAL PRIMARY KEY,
    id_bando UUID NOT NULL REFERENCES bandi(id) ON DELETE CASCADE,
    "DataSopralluogo" TIMESTAMPTZ NOT NULL,
    "OraSopralluogo" TIME,
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(id_bando, "DataSopralluogo")
);
CREATE INDEX idx_sopr_date_bando ON sopralluoghi_date(id_bando);
-- ============================================================
-- SOPRALLUOGHI_TPL (Templates for sopralluoghi)
-- ============================================================
CREATE TABLE IF NOT EXISTS sopralluoghi_tpl (
    id SERIAL PRIMARY KEY,
    id_bando UUID REFERENCES bandi(id) ON DELETE CASCADE,
    "TipoPrenotazione" VARCHAR(200),
    "Telefono" VARCHAR(200),
    "Email" VARCHAR(200),
    "Fax" VARCHAR(200),
    "Indirizzo" TEXT,
    "Cap" VARCHAR(6),
    "Citta" VARCHAR(100),
    id_provincia INTEGER REFERENCES province(id),
    "Note" TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
-- ============================================================
-- SOPRALLUOGHI_RICHIESTE (Availability/quote requests)
-- ============================================================
CREATE TABLE IF NOT EXISTS sopralluoghi_richieste (
    id SERIAL PRIMARY KEY,
    id_bando UUID NOT NULL REFERENCES bandi(id),
    id_sopralluogo UUID REFERENCES sopralluoghi(id_visione),
    id_azienda INTEGER REFERENCES aziende(id),
    "Username" VARCHAR(256),
    -- Request details
    data_richiesta TIMESTAMPTZ DEFAULT NOW(),
    data_preferita DATE,
    note TEXT,
    stato VARCHAR(50) DEFAULT 'pendente',  -- pendente, confermata, rifiutata, completata
    -- Response
    risposta TEXT,
    data_risposta TIMESTAMPTZ,
    risposta_da VARCHAR(256),
    -- Pricing (quote)
    importo_preventivo NUMERIC(12,2),
    iva_preventivo NUMERIC(12,2),
    preventivo_accettato BOOLEAN,
    data_accettazione TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_sopr_rich_bando ON sopralluoghi_richieste(id_bando);
CREATE INDEX idx_sopr_rich_azienda ON sopralluoghi_richieste(id_azienda);
CREATE INDEX idx_sopr_rich_stato ON sopralluoghi_richieste(stato);
-- ============================================================
-- GEOCODING CACHE (Cache geocoded addresses for map performance)
-- ============================================================
CREATE TABLE IF NOT EXISTS geocoding_cache (
    id SERIAL PRIMARY KEY,
    indirizzo_normalizzato VARCHAR(500) UNIQUE NOT NULL,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    provider VARCHAR(50) DEFAULT 'nominatim',
    data_geocoding TIMESTAMPTZ DEFAULT NOW(),
    successo BOOLEAN DEFAULT true
);
CREATE INDEX idx_geocoding_indirizzo ON geocoding_cache(indirizzo_normalizzato);
-- ============================================================
-- Add geocoding columns to province table if not exists
-- ============================================================
DO $$ BEGIN
    ALTER TABLE province ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
    ALTER TABLE province ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
-- ============================================================
-- Insert Italian province coordinates for map display
-- ============================================================
DO $$ BEGIN
    -- Update provinces with coordinates (capoluoghi di provincia)
    UPDATE province SET lat = 45.4642, lng = 9.1900 WHERE LOWER("Provincia") = 'milano' OR LOWER("siglaprovincia") = 'mi';
    UPDATE province SET lat = 41.9028, lng = 12.4964 WHERE LOWER("Provincia") = 'roma' OR LOWER("siglaprovincia") = 'rm';
    UPDATE province SET lat = 40.8518, lng = 14.2681 WHERE LOWER("Provincia") = 'napoli' OR LOWER("siglaprovincia") = 'na';
    UPDATE province SET lat = 45.0703, lng = 7.6869 WHERE LOWER("Provincia") = 'torino' OR LOWER("siglaprovincia") = 'to';
    UPDATE province SET lat = 38.1157, lng = 13.3615 WHERE LOWER("Provincia") = 'palermo' OR LOWER("siglaprovincia") = 'pa';
    UPDATE province SET lat = 44.4056, lng = 8.9463 WHERE LOWER("Provincia") = 'genova' OR LOWER("siglaprovincia") = 'ge';
    UPDATE province SET lat = 44.4949, lng = 11.3426 WHERE LOWER("Provincia") = 'bologna' OR LOWER("siglaprovincia") = 'bo';
    UPDATE province SET lat = 43.7696, lng = 11.2558 WHERE LOWER("Provincia") = 'firenze' OR LOWER("siglaprovincia") = 'fi';
    UPDATE province SET lat = 41.1171, lng = 16.8719 WHERE LOWER("Provincia") = 'bari' OR LOWER("siglaprovincia") = 'ba';
    UPDATE province SET lat = 37.5079, lng = 15.0830 WHERE LOWER("Provincia") = 'catania' OR LOWER("siglaprovincia") = 'ct';
    UPDATE province SET lat = 45.4408, lng = 12.3155 WHERE LOWER("Provincia") = 'venezia' OR LOWER("siglaprovincia") = 've';
    UPDATE province SET lat = 45.4384, lng = 10.9916 WHERE LOWER("Provincia") = 'verona' OR LOWER("siglaprovincia") = 'vr';
    UPDATE province SET lat = 38.1938, lng = 15.5540 WHERE LOWER("Provincia") = 'messina' OR LOWER("siglaprovincia") = 'me';
    UPDATE province SET lat = 45.4064, lng = 11.8768 WHERE LOWER("Provincia") = 'padova' OR LOWER("siglaprovincia") = 'pd';
    UPDATE province SET lat = 45.6495, lng = 13.7768 WHERE LOWER("Provincia") = 'trieste' OR LOWER("siglaprovincia") = 'ts';
    UPDATE province SET lat = 45.5416, lng = 10.2118 WHERE LOWER("Provincia") = 'brescia' OR LOWER("siglaprovincia") = 'bs';
    UPDATE province SET lat = 44.8015, lng = 10.3279 WHERE LOWER("Provincia") = 'parma' OR LOWER("siglaprovincia") = 'pr';
    UPDATE province SET lat = 44.6471, lng = 10.9252 WHERE LOWER("Provincia") = 'modena' OR LOWER("siglaprovincia") = 'mo';
    UPDATE province SET lat = 38.1113, lng = 15.6474 WHERE LOWER("Provincia") = 'reggio calabria' OR LOWER("siglaprovincia") = 'rc';
    UPDATE province SET lat = 43.1107, lng = 12.3908 WHERE LOWER("Provincia") = 'perugia' OR LOWER("siglaprovincia") = 'pg';
    UPDATE province SET lat = 39.2238, lng = 9.1217 WHERE LOWER("Provincia") = 'cagliari' OR LOWER("siglaprovincia") = 'ca';
    UPDATE province SET lat = 43.5485, lng = 10.3106 WHERE LOWER("Provincia") = 'livorno' OR LOWER("siglaprovincia") = 'li';
    UPDATE province SET lat = 44.4184, lng = 12.2035 WHERE LOWER("Provincia") = 'ravenna' OR LOWER("siglaprovincia") = 'ra';
    UPDATE province SET lat = 44.0594, lng = 12.5683 WHERE LOWER("Provincia") = 'rimini' OR LOWER("siglaprovincia") = 'rn';
    UPDATE province SET lat = 40.6824, lng = 14.7681 WHERE LOWER("Provincia") = 'salerno' OR LOWER("siglaprovincia") = 'sa';
    UPDATE province SET lat = 44.8378, lng = 11.6199 WHERE LOWER("Provincia") = 'ferrara' OR LOWER("siglaprovincia") = 'fe';
    UPDATE province SET lat = 40.7259, lng = 8.5590 WHERE LOWER("Provincia") = 'sassari' OR LOWER("siglaprovincia") = 'ss';
    UPDATE province SET lat = 41.4676, lng = 12.9036 WHERE LOWER("Provincia") = 'latina' OR LOWER("siglaprovincia") = 'lt';
    UPDATE province SET lat = 45.6983, lng = 9.6773 WHERE LOWER("Provincia") = 'bergamo' OR LOWER("siglaprovincia") = 'bg';
    UPDATE province SET lat = 43.6158, lng = 13.5189 WHERE LOWER("Provincia") = 'ancona' OR LOWER("siglaprovincia") = 'an';
    UPDATE province SET lat = 42.3498, lng = 13.3995 WHERE LOWER("Provincia") = 'l''aquila' OR LOWER("siglaprovincia") = 'aq';
    UPDATE province SET lat = 40.6404, lng = 15.8056 WHERE LOWER("Provincia") = 'potenza' OR LOWER("siglaprovincia") = 'pz';
    UPDATE province SET lat = 38.9104, lng = 16.5872 WHERE LOWER("Provincia") = 'catanzaro' OR LOWER("siglaprovincia") = 'cz';
    UPDATE province SET lat = 41.5600, lng = 14.6684 WHERE LOWER("Provincia") = 'campobasso' OR LOWER("siglaprovincia") = 'cb';
    UPDATE province SET lat = 45.7372, lng = 7.3209 WHERE LOWER("Provincia") = 'aosta' OR LOWER("siglaprovincia") = 'ao';
    UPDATE province SET lat = 46.0748, lng = 11.1217 WHERE LOWER("Provincia") = 'trento' OR LOWER("siglaprovincia") = 'tn';
    UPDATE province SET lat = 46.4993, lng = 11.3548 WHERE LOWER("Provincia") = 'bolzano' OR LOWER("siglaprovincia") = 'bz';
    UPDATE province SET lat = 46.0711, lng = 13.2346 WHERE LOWER("Provincia") = 'udine' OR LOWER("siglaprovincia") = 'ud';
    UPDATE province SET lat = 45.8066, lng = 13.2343 WHERE LOWER("Provincia") = 'gorizia' OR LOWER("siglaprovincia") = 'go';
    UPDATE province SET lat = 46.1598, lng = 12.2015 WHERE LOWER("Provincia") = 'pordenone' OR LOWER("siglaprovincia") = 'pn';
    UPDATE province SET lat = 45.1873, lng = 9.1562 WHERE LOWER("Provincia") = 'pavia' OR LOWER("siglaprovincia") = 'pv';
    UPDATE province SET lat = 45.1868, lng = 8.6210 WHERE LOWER("Provincia") = 'alessandria' OR LOWER("siglaprovincia") = 'al';
    UPDATE province SET lat = 44.3945, lng = 8.9453 WHERE LOWER("Provincia") = 'savona' OR LOWER("siglaprovincia") = 'sv';
    UPDATE province SET lat = 43.8777, lng = 8.0578 WHERE LOWER("Provincia") = 'imperia' OR LOWER("siglaprovincia") = 'im';
    UPDATE province SET lat = 44.1039, lng = 9.8244 WHERE LOWER("Provincia") = 'la spezia' OR LOWER("siglaprovincia") = 'sp';
    UPDATE province SET lat = 45.1667, lng = 10.7914 WHERE LOWER("Provincia") = 'mantova' OR LOWER("siglaprovincia") = 'mn';
    UPDATE province SET lat = 45.1329, lng = 10.0227 WHERE LOWER("Provincia") = 'cremona' OR LOWER("siglaprovincia") = 'cr';
    UPDATE province SET lat = 45.3517, lng = 9.0847 WHERE LOWER("Provincia") = 'lodi' OR LOWER("siglaprovincia") = 'lo';
    UPDATE province SET lat = 45.4643, lng = 9.8759 WHERE LOWER("Provincia") = 'monza e brianza' OR LOWER("siglaprovincia") = 'mb';
    UPDATE province SET lat = 45.8986, lng = 9.0094 WHERE LOWER("Provincia") = 'como' OR LOWER("siglaprovincia") = 'co';
    UPDATE province SET lat = 45.8342, lng = 9.3907 WHERE LOWER("Provincia") = 'lecco' OR LOWER("siglaprovincia") = 'lc';
    UPDATE province SET lat = 46.1699, lng = 10.1777 WHERE LOWER("Provincia") = 'sondrio' OR LOWER("siglaprovincia") = 'so';
    UPDATE province SET lat = 45.8139, lng = 8.8271 WHERE LOWER("Provincia") = 'varese' OR LOWER("siglaprovincia") = 'va';
    UPDATE province SET lat = 45.4646, lng = 8.6213 WHERE LOWER("Provincia") = 'novara' OR LOWER("siglaprovincia") = 'no';
    UPDATE province SET lat = 45.9226, lng = 8.5519 WHERE LOWER("Provincia") = 'verbano-cusio-ossola' OR LOWER("siglaprovincia") = 'vb';
    UPDATE province SET lat = 45.3766, lng = 8.4246 WHERE LOWER("Provincia") = 'vercelli' OR LOWER("siglaprovincia") = 'vc';
    UPDATE province SET lat = 45.5781, lng = 8.0478 WHERE LOWER("Provincia") = 'biella' OR LOWER("siglaprovincia") = 'bi';
    UPDATE province SET lat = 44.7000, lng = 8.6145 WHERE LOWER("Provincia") = 'asti' OR LOWER("siglaprovincia") = 'at';
    UPDATE province SET lat = 44.5476, lng = 7.7336 WHERE LOWER("Provincia") = 'cuneo' OR LOWER("siglaprovincia") = 'cn';
    UPDATE province SET lat = 45.4535, lng = 11.0001 WHERE LOWER("Provincia") = 'vicenza' OR LOWER("siglaprovincia") = 'vi';
    UPDATE province SET lat = 45.6495, lng = 12.2453 WHERE LOWER("Provincia") = 'treviso' OR LOWER("siglaprovincia") = 'tv';
    UPDATE province SET lat = 46.1381, lng = 12.1700 WHERE LOWER("Provincia") = 'belluno' OR LOWER("siglaprovincia") = 'bl';
    UPDATE province SET lat = 45.0690, lng = 11.7903 WHERE LOWER("Provincia") = 'rovigo' OR LOWER("siglaprovincia") = 'ro';
    UPDATE province SET lat = 44.2943, lng = 11.8798 WHERE LOWER("Provincia") = 'forli''-cesena' OR LOWER("siglaprovincia") = 'fc';
    UPDATE province SET lat = 44.1391, lng = 12.2430 WHERE LOWER("Provincia") = 'cesena' OR LOWER("siglaprovincia") = 'fc';
    UPDATE province SET lat = 44.2225, lng = 12.0408 WHERE LOWER("Provincia") = 'forli' OR LOWER("siglaprovincia") = 'fc';
    UPDATE province SET lat = 44.7139, lng = 11.2954 WHERE LOWER("Provincia") = 'reggio emilia' OR LOWER("siglaprovincia") = 're';
    UPDATE province SET lat = 44.9249, lng = 11.1081 WHERE LOWER("Provincia") = 'reggio nell''emilia' OR LOWER("siglaprovincia") = 're';
    UPDATE province SET lat = 44.6989, lng = 10.6312 WHERE LOWER("Provincia") = 'parma' OR LOWER("siglaprovincia") = 'pr';
    UPDATE province SET lat = 45.0534, lng = 9.6929 WHERE LOWER("Provincia") = 'piacenza' OR LOWER("siglaprovincia") = 'pc';
    UPDATE province SET lat = 43.8430, lng = 10.5027 WHERE LOWER("Provincia") = 'lucca' OR LOWER("siglaprovincia") = 'lu';
    UPDATE province SET lat = 43.8800, lng = 10.2500 WHERE LOWER("Provincia") = 'pistoia' OR LOWER("siglaprovincia") = 'pt';
    UPDATE province SET lat = 43.7230, lng = 10.4017 WHERE LOWER("Provincia") = 'pisa' OR LOWER("siglaprovincia") = 'pi';
    UPDATE province SET lat = 43.3188, lng = 11.3308 WHERE LOWER("Provincia") = 'siena' OR LOWER("siglaprovincia") = 'si';
    UPDATE province SET lat = 42.5638, lng = 11.7840 WHERE LOWER("Provincia") = 'grosseto' OR LOWER("siglaprovincia") = 'gr';
    UPDATE province SET lat = 43.4623, lng = 11.8802 WHERE LOWER("Provincia") = 'arezzo' OR LOWER("siglaprovincia") = 'ar';
    UPDATE province SET lat = 43.0953, lng = 12.3858 WHERE LOWER("Provincia") = 'terni' OR LOWER("siglaprovincia") = 'tr';
    UPDATE province SET lat = 43.2098, lng = 13.7153 WHERE LOWER("Provincia") = 'macerata' OR LOWER("siglaprovincia") = 'mc';
    UPDATE province SET lat = 42.8529, lng = 13.5740 WHERE LOWER("Provincia") = 'ascoli piceno' OR LOWER("siglaprovincia") = 'ap';
    UPDATE province SET lat = 42.9351, lng = 13.8826 WHERE LOWER("Provincia") = 'fermo' OR LOWER("siglaprovincia") = 'fm';
    UPDATE province SET lat = 43.7216, lng = 13.2137 WHERE LOWER("Provincia") = 'pesaro e urbino' OR LOWER("siglaprovincia") = 'pu';
    UPDATE province SET lat = 42.4618, lng = 14.2139 WHERE LOWER("Provincia") = 'pescara' OR LOWER("siglaprovincia") = 'pe';
    UPDATE province SET lat = 42.3515, lng = 13.3979 WHERE LOWER("Provincia") = 'l''aquila' OR LOWER("siglaprovincia") = 'aq';
    UPDATE province SET lat = 42.4644, lng = 14.2139 WHERE LOWER("Provincia") = 'chieti' OR LOWER("siglaprovincia") = 'ch';
    UPDATE province SET lat = 42.1920, lng = 13.7213 WHERE LOWER("Provincia") = 'teramo' OR LOWER("siglaprovincia") = 'te';
    UPDATE province SET lat = 41.1307, lng = 14.7828 WHERE LOWER("Provincia") = 'benevento' OR LOWER("siglaprovincia") = 'bn';
    UPDATE province SET lat = 41.0746, lng = 14.3329 WHERE LOWER("Provincia") = 'caserta' OR LOWER("siglaprovincia") = 'ce';
    UPDATE province SET lat = 40.9180, lng = 14.7906 WHERE LOWER("Provincia") = 'avellino' OR LOWER("siglaprovincia") = 'av';
    UPDATE province SET lat = 41.4602, lng = 15.5446 WHERE LOWER("Provincia") = 'foggia' OR LOWER("siglaprovincia") = 'fg';
    UPDATE province SET lat = 40.3515, lng = 18.1718 WHERE LOWER("Provincia") = 'lecce' OR LOWER("siglaprovincia") = 'le';
    UPDATE province SET lat = 40.6318, lng = 17.9417 WHERE LOWER("Provincia") = 'brindisi' OR LOWER("siglaprovincia") = 'br';
    UPDATE province SET lat = 40.4827, lng = 17.2297 WHERE LOWER("Provincia") = 'taranto' OR LOWER("siglaprovincia") = 'ta';
    UPDATE province SET lat = 41.1253, lng = 16.8661 WHERE LOWER("Provincia") = 'barletta-andria-trani' OR LOWER("siglaprovincia") = 'bt';
    UPDATE province SET lat = 40.6325, lng = 15.8058 WHERE LOWER("Provincia") = 'potenza' OR LOWER("siglaprovincia") = 'pz';
    UPDATE province SET lat = 40.6654, lng = 16.6044 WHERE LOWER("Provincia") = 'matera' OR LOWER("siglaprovincia") = 'mt';
    UPDATE province SET lat = 39.0819, lng = 16.5145 WHERE LOWER("Provincia") = 'cosenza' OR LOWER("siglaprovincia") = 'cs';
    UPDATE province SET lat = 38.6780, lng = 16.0788 WHERE LOWER("Provincia") = 'vibo valentia' OR LOWER("siglaprovincia") = 'vv';
    UPDATE province SET lat = 39.1522, lng = 16.5175 WHERE LOWER("Provincia") = 'crotone' OR LOWER("siglaprovincia") = 'kr';
    UPDATE province SET lat = 37.0755, lng = 15.2866 WHERE LOWER("Provincia") = 'siracusa' OR LOWER("siglaprovincia") = 'sr';
    UPDATE province SET lat = 37.3277, lng = 13.5839 WHERE LOWER("Provincia") = 'agrigento' OR LOWER("siglaprovincia") = 'ag';
    UPDATE province SET lat = 37.0990, lng = 14.0934 WHERE LOWER("Provincia") = 'caltanissetta' OR LOWER("siglaprovincia") = 'cl';
    UPDATE province SET lat = 37.5615, lng = 14.2748 WHERE LOWER("Provincia") = 'enna' OR LOWER("siglaprovincia") = 'en';
    UPDATE province SET lat = 36.9257, lng = 14.7306 WHERE LOWER("Provincia") = 'ragusa' OR LOWER("siglaprovincia") = 'rg';
    UPDATE province SET lat = 37.8160, lng = 12.4362 WHERE LOWER("Provincia") = 'trapani' OR LOWER("siglaprovincia") = 'tp';
    UPDATE province SET lat = 40.8400, lng = 9.4520 WHERE LOWER("Provincia") = 'nuoro' OR LOWER("siglaprovincia") = 'nu';
    UPDATE province SET lat = 39.8628, lng = 8.5374 WHERE LOWER("Provincia") = 'oristano' OR LOWER("siglaprovincia") = 'or';
    UPDATE province SET lat = 39.1563, lng = 9.0610 WHERE LOWER("Provincia") = 'carbonia-iglesias' OR LOWER("siglaprovincia") = 'ci';
    UPDATE province SET lat = 38.9121, lng = 8.8620 WHERE LOWER("Provincia") = 'medio campidano' OR LOWER("siglaprovincia") = 'vs';
    UPDATE province SET lat = 40.6140, lng = 9.4526 WHERE LOWER("Provincia") = 'ogliastra' OR LOWER("siglaprovincia") = 'og';
    UPDATE province SET lat = 40.9267, lng = 9.5008 WHERE LOWER("Provincia") = 'olbia-tempio' OR LOWER("siglaprovincia") = 'ot';
    UPDATE province SET lat = 41.5588, lng = 14.2270 WHERE LOWER("Provincia") = 'isernia' OR LOWER("siglaprovincia") = 'is';
    UPDATE province SET lat = 41.6394, lng = 12.8964 WHERE LOWER("Provincia") = 'frosinone' OR LOWER("siglaprovincia") = 'fr';
    UPDATE province SET lat = 42.0667, lng = 12.5895 WHERE LOWER("Provincia") = 'rieti' OR LOWER("siglaprovincia") = 'ri';
    UPDATE province SET lat = 42.4174, lng = 12.1057 WHERE LOWER("Provincia") = 'viterbo' OR LOWER("siglaprovincia") = 'vt';
    UPDATE province SET lat = 43.8813, lng = 11.0973 WHERE LOWER("Provincia") = 'prato' OR LOWER("siglaprovincia") = 'po';
    UPDATE province SET lat = 43.3506, lng = 10.5093 WHERE LOWER("Provincia") = 'massa-carrara' OR LOWER("siglaprovincia") = 'ms';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ========== 008_add_password_hash.sql ==========
-- ============================================================
-- 008: Add PasswordHash column to users table
-- ============================================================
-- The legacy ASP.NET Membership system stored passwords in a
-- separate table (aspnet_Membership). Now that we use bcrypt,
-- we need a PasswordHash column directly on the users table.
-- On first login, users without a hash will have their password
-- hashed and stored here.
-- ============================================================
-- Add PasswordHash column if it doesn't exist (PascalCase to match ASP.NET imported schema)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'PasswordHash'
    ) THEN
        ALTER TABLE users ADD COLUMN "PasswordHash" VARCHAR(255);
    END IF;
END $$;
-- Also handle case where column might exist as snake_case from migration 001
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'password_hash'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'PasswordHash'
    ) THEN
        ALTER TABLE users RENAME COLUMN password_hash TO "PasswordHash";
    END IF;
END $$;

-- ========== 009_registro_preferiti_tables.sql ==========
-- Migration 006: Create registro_gare_clienti and preferiti_esiti tables
-- These tables support the client area's personal registry and favorites features
-- Personal bandi registry (watchlist)
CREATE TABLE IF NOT EXISTS registro_gare_clienti (
    "id" SERIAL PRIMARY KEY,
    "id_bando" INTEGER NOT NULL,
    "UserName" VARCHAR(100) NOT NULL,
    "note" TEXT,
    "data_inserimento" TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE("id_bando", "UserName")
);
CREATE INDEX IF NOT EXISTS idx_registro_gare_clienti_username ON registro_gare_clienti("UserName");
CREATE INDEX IF NOT EXISTS idx_registro_gare_clienti_bando ON registro_gare_clienti("id_bando");
-- Favorite esiti
CREATE TABLE IF NOT EXISTS preferiti_esiti (
    "id" SERIAL PRIMARY KEY,
    "id_gara" INTEGER NOT NULL,
    "UserName" VARCHAR(100) NOT NULL,
    "data_aggiunta" TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE("id_gara", "UserName")
);
CREATE INDEX IF NOT EXISTS idx_preferiti_esiti_username ON preferiti_esiti("UserName");
CREATE INDEX IF NOT EXISTS idx_preferiti_esiti_gara ON preferiti_esiti("id_gara");
-- Service requests (for bandi apertura, servizi, etc.)
CREATE TABLE IF NOT EXISTS richieste_servizi (
    "id" SERIAL PRIMARY KEY,
    "id_bando" INTEGER,
    "UserName" VARCHAR(100) NOT NULL,
    "tipo_servizio" VARCHAR(50) NOT NULL,
    "data_richiesta" TIMESTAMPTZ DEFAULT NOW(),
    "note" TEXT,
    "stato" VARCHAR(20) DEFAULT 'PENDING'
);
CREATE INDEX IF NOT EXISTS idx_richieste_servizi_username ON richieste_servizi("UserName");
CREATE INDEX IF NOT EXISTS idx_richieste_servizi_stato ON richieste_servizi("stato");
-- Comments
COMMENT ON TABLE registro_gare_clienti IS 'User personal tender registry/watchlist - stores bandi the user is tracking';
COMMENT ON TABLE preferiti_esiti IS 'User favorite esiti - stores esiti the user has bookmarked';
COMMENT ON TABLE richieste_servizi IS 'Service requests from clients - apertura, servizi, etc.';
