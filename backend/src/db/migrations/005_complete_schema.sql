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
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='users' AND column_name='albo_fornitori_enabled') THEN
        ALTER TABLE users ADD COLUMN albo_fornitori_enabled BOOLEAN DEFAULT false;
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
