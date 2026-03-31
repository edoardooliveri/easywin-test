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
