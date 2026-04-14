-- 020_tasks_newsletter.sql
-- Tabella tasks per scheduler newsletter + log invii dettagliato

-- Tabella tasks (usata dal newsletter-scheduler.js)
CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY,
    tipo VARCHAR(100) NOT NULL UNIQUE,
    nome VARCHAR(200),
    attivo BOOLEAN DEFAULT true,
    ora_invio VARCHAR(5) DEFAULT '04:00',
    data_ultima_esecuzione TIMESTAMPTZ,
    stato_ultima_esecuzione VARCHAR(50),
    messaggio_ultima_esecuzione TEXT,
    prossima_esecuzione TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Inserisci task newsletter_auto se non esiste
INSERT INTO tasks (tipo, nome, attivo, ora_invio)
VALUES ('newsletter_auto', 'Newsletter automatica giornaliera', false, '04:00')
ON CONFLICT (tipo) DO NOTHING;

-- Crea newsletter_invii se non esiste (potrebbe mancare se migration 006 non applicata)
CREATE TABLE IF NOT EXISTS newsletter_invii (
    id SERIAL PRIMARY KEY,
    tipo VARCHAR(20) NOT NULL,
    oggetto VARCHAR(500),
    testo TEXT,
    data_invio TIMESTAMPTZ DEFAULT NOW(),
    destinatari INT DEFAULT 0,
    inviati INT DEFAULT 0,
    falliti INT DEFAULT 0,
    username_invio VARCHAR(200),
    data_da DATE,
    data_a DATE,
    note TEXT
);
CREATE INDEX IF NOT EXISTS idx_newsletter_invii_data ON newsletter_invii(data_invio DESC);

-- Tabella log dettagliato per singolo invio a singolo utente
CREATE TABLE IF NOT EXISTS newsletter_invii_log (
    id SERIAL PRIMARY KEY,
    id_invio INTEGER REFERENCES newsletter_invii(id) ON DELETE CASCADE,
    username VARCHAR(200),
    email VARCHAR(300),
    tipo VARCHAR(20),
    n_items INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'ok',
    errore TEXT,
    data_invio TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_newsletter_invii_log_invio ON newsletter_invii_log(id_invio);
CREATE INDEX IF NOT EXISTS idx_newsletter_invii_log_username ON newsletter_invii_log(username);
