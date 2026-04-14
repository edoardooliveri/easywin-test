-- 021_bandi_links.sql
-- Tabella links associati ai bandi (usata da bandi-import.js)

CREATE TABLE IF NOT EXISTS bandi_links (
    id SERIAL PRIMARY KEY,
    id_bando UUID REFERENCES bandi(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    tipo VARCHAR(50) DEFAULT 'generic',
    descrizione TEXT,
    data_creazione TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bandi_links_bando ON bandi_links(id_bando);
CREATE INDEX IF NOT EXISTS idx_bandi_links_tipo ON bandi_links(tipo);

-- Tabella bandimodifiche per audit log (usata da clona, elimina, posticipa, converti-esito)
CREATE TABLE IF NOT EXISTS bandimodifiche (
    id SERIAL PRIMARY KEY,
    id_bando TEXT,
    user_name VARCHAR(200),
    modifiche TEXT,
    data TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bandimodifiche_bando ON bandimodifiche(id_bando);

-- Tabelle servizi bandi (aperture, scritture, elaborati) usate da bandi-servizi.js
CREATE TABLE IF NOT EXISTS aperture (
    id SERIAL PRIMARY KEY,
    id_bando UUID REFERENCES bandi(id) ON DELETE CASCADE,
    data DATE,
    ora VARCHAR(10),
    id_azienda INTEGER,
    id_intermediario INTEGER,
    id_esecutore_esterno INTEGER,
    prezzo_utente NUMERIC(12,2),
    prezzo_azienda NUMERIC(12,2),
    prezzo_intermediario NUMERIC(12,2),
    pagato_utente BOOLEAN DEFAULT false,
    pagato_azienda BOOLEAN DEFAULT false,
    pagato_intermediario BOOLEAN DEFAULT false,
    username VARCHAR(200),
    tipo VARCHAR(100),
    stato VARCHAR(50) DEFAULT 'in_sospeso',
    note TEXT,
    eseguito BOOLEAN DEFAULT false,
    luogo TEXT,
    utente_nome VARCHAR(200),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_aperture_bando ON aperture(id_bando);

CREATE TABLE IF NOT EXISTS scritture (
    id SERIAL PRIMARY KEY,
    id_bando UUID REFERENCES bandi(id) ON DELETE CASCADE,
    data DATE,
    ora VARCHAR(10),
    id_azienda INTEGER,
    id_intermediario INTEGER,
    id_esecutore_esterno INTEGER,
    prezzo_utente NUMERIC(12,2),
    prezzo_azienda NUMERIC(12,2),
    prezzo_intermediario NUMERIC(12,2),
    pagato_utente BOOLEAN DEFAULT false,
    pagato_azienda BOOLEAN DEFAULT false,
    pagato_intermediario BOOLEAN DEFAULT false,
    username VARCHAR(200),
    tipo VARCHAR(100),
    tipologia VARCHAR(100),
    stato VARCHAR(50) DEFAULT 'in_sospeso',
    note TEXT,
    eseguito BOOLEAN DEFAULT false,
    utente_nome VARCHAR(200),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_scritture_bando ON scritture(id_bando);

CREATE TABLE IF NOT EXISTS elaborati (
    id SERIAL PRIMARY KEY,
    id_bando UUID REFERENCES bandi(id) ON DELETE CASCADE,
    data DATE,
    ora VARCHAR(10),
    id_azienda INTEGER,
    id_intermediario INTEGER,
    id_esecutore_esterno INTEGER,
    prezzo_utente NUMERIC(12,2),
    prezzo_azienda NUMERIC(12,2),
    prezzo_intermediario NUMERIC(12,2),
    pagato_utente BOOLEAN DEFAULT false,
    pagato_azienda BOOLEAN DEFAULT false,
    pagato_intermediario BOOLEAN DEFAULT false,
    username VARCHAR(200),
    tipo VARCHAR(100),
    titolo VARCHAR(500),
    stato VARCHAR(50) DEFAULT 'in_sospeso',
    note TEXT,
    eseguito BOOLEAN DEFAULT false,
    utente_nome VARCHAR(200),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_elaborati_bando ON elaborati(id_bando);
