-- Migration 014: Utenti / Abbonamento — campi mancanti rispetto al vecchio sito
-- Idempotente: usa IF NOT EXISTS ovunque. Sicura da rieseguire.
-- Reverse-engineered da appalti.easywin.it il 2026-04-11.

-- ============================================================
-- USERS — nuove colonne per sezione abbonamento completa
-- ============================================================

-- Anagrafica extra
ALTER TABLE users ADD COLUMN IF NOT EXISTS codice_sdi VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS indirizzo_pec VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_newsletter_bandi_servizi VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_newsletter_esiti VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS newsletter_separata BOOLEAN DEFAULT false;

-- Flag header utente
ALTER TABLE users ADD COLUMN IF NOT EXISTS sync_registro_gare BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS abbonato_sopralluoghi BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS abbonato_aperture BOOLEAN DEFAULT false;

-- Flag matrice (già esiste rinnovo_esiti/rinnovo_bandi). Aggiungiamo gli altri 3
ALTER TABLE users ADD COLUMN IF NOT EXISTS rinnovo_esiti_light BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS rinnovo_newsletter_esiti BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS rinnovo_newsletter_bandi BOOLEAN DEFAULT false;

-- Scadenze per-servizio (già esiste data_scadenza = Esiti). Aggiungiamo gli altri 4
ALTER TABLE users ADD COLUMN IF NOT EXISTS scadenza_bandi DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS scadenza_esiti_light DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS scadenza_newsletter_esiti DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS scadenza_newsletter_bandi DATE;

-- Inizio per-servizio
ALTER TABLE users ADD COLUMN IF NOT EXISTS inizio_esiti DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS inizio_bandi DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS inizio_esiti_light DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS inizio_newsletter_esiti DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS inizio_newsletter_bandi DATE;

-- Prezzi correnti per-servizio (la "matrice importi" del vecchio sito)
ALTER TABLE users ADD COLUMN IF NOT EXISTS prezzo_esiti NUMERIC(10,2) DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS prezzo_bandi NUMERIC(10,2) DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS prezzo_esiti_light NUMERIC(10,2) DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS prezzo_newsletter_esiti NUMERIC(10,2) DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS prezzo_newsletter_bandi NUMERIC(10,2) DEFAULT 0;

-- Provvigioni per-servizio
ALTER TABLE users ADD COLUMN IF NOT EXISTS provv_esiti NUMERIC(10,2) DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS provv_bandi NUMERIC(10,2) DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS provv_esiti_light NUMERIC(10,2) DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS provv_newsletter_esiti NUMERIC(10,2) DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS provv_newsletter_bandi NUMERIC(10,2) DEFAULT 0;

-- Agenti / subagenti
ALTER TABLE users ADD COLUMN IF NOT EXISTS sub_agente_1 VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS importo_sub_agente_1 NUMERIC(10,2) DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS sub_agente_2 VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS importo_sub_agente_2 NUMERIC(10,2) DEFAULT 0;

-- Temporaneo
ALTER TABLE users ADD COLUMN IF NOT EXISTS temporaneo BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS data_inizio_temporaneo DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS data_fine_temporaneo DATE;

-- Mesi rinnovo (default periodo in mesi)
ALTER TABLE users ADD COLUMN IF NOT EXISTS mesi_rinnovo INTEGER DEFAULT 12;

-- Presidia
ALTER TABLE users ADD COLUMN IF NOT EXISTS rinnovo_presidia BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS scadenza_presidia DATE;

-- Ruoli come array testuale (semplice ma fedele al vecchio multi-select)
ALTER TABLE users ADD COLUMN IF NOT EXISTS ruoli TEXT[];

-- ============================================================
-- PERIODI — aggiunta dei prezzi per i 4 servizi extra di storico
-- (Aperture, Elaborati, Sopralluoghi, Scritture)
-- + prezzo_esiti_light mancante
-- + provvigioni per-servizio
-- + inizio/fine per-servizio (opzionale; data_inizio/fine rimangono del periodo complessivo)
-- ============================================================

ALTER TABLE users_periodi ADD COLUMN IF NOT EXISTS prezzo_esiti_light NUMERIC(10,2) DEFAULT 0;
ALTER TABLE users_periodi ADD COLUMN IF NOT EXISTS prezzo_aperture NUMERIC(10,2) DEFAULT 0;
ALTER TABLE users_periodi ADD COLUMN IF NOT EXISTS prezzo_elaborati NUMERIC(10,2) DEFAULT 0;
ALTER TABLE users_periodi ADD COLUMN IF NOT EXISTS prezzo_sopralluoghi NUMERIC(10,2) DEFAULT 0;
ALTER TABLE users_periodi ADD COLUMN IF NOT EXISTS prezzo_scritture NUMERIC(10,2) DEFAULT 0;

ALTER TABLE users_periodi ADD COLUMN IF NOT EXISTS provv_esiti NUMERIC(10,2) DEFAULT 0;
ALTER TABLE users_periodi ADD COLUMN IF NOT EXISTS provv_bandi NUMERIC(10,2) DEFAULT 0;
ALTER TABLE users_periodi ADD COLUMN IF NOT EXISTS provv_esiti_light NUMERIC(10,2) DEFAULT 0;
ALTER TABLE users_periodi ADD COLUMN IF NOT EXISTS provv_newsletter_esiti NUMERIC(10,2) DEFAULT 0;
ALTER TABLE users_periodi ADD COLUMN IF NOT EXISTS provv_newsletter_bandi NUMERIC(10,2) DEFAULT 0;

ALTER TABLE users_periodi ADD COLUMN IF NOT EXISTS inizio_esiti DATE;
ALTER TABLE users_periodi ADD COLUMN IF NOT EXISTS inizio_bandi DATE;
ALTER TABLE users_periodi ADD COLUMN IF NOT EXISTS inizio_esiti_light DATE;
ALTER TABLE users_periodi ADD COLUMN IF NOT EXISTS inizio_newsletter_esiti DATE;
ALTER TABLE users_periodi ADD COLUMN IF NOT EXISTS inizio_newsletter_bandi DATE;

ALTER TABLE users_periodi ADD COLUMN IF NOT EXISTS scadenza_esiti DATE;
ALTER TABLE users_periodi ADD COLUMN IF NOT EXISTS scadenza_bandi DATE;
ALTER TABLE users_periodi ADD COLUMN IF NOT EXISTS scadenza_esiti_light DATE;
ALTER TABLE users_periodi ADD COLUMN IF NOT EXISTS scadenza_newsletter_esiti DATE;
ALTER TABLE users_periodi ADD COLUMN IF NOT EXISTS scadenza_newsletter_bandi DATE;
