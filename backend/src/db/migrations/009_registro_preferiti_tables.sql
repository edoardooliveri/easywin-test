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
