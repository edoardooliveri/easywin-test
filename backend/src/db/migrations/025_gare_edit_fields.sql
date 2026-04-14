-- Migration: aggiunge le colonne del form Modifica Esito del vecchio sito
-- che non erano state portate nel nuovo schema Neon.
-- Esecuzione idempotente (IF NOT EXISTS su ogni colonna).

ALTER TABLE gare ADD COLUMN IF NOT EXISTS max_invitati          INTEGER;
ALTER TABLE gare ADD COLUMN IF NOT EXISTS tipo_calcolo          SMALLINT;
ALTER TABLE gare ADD COLUMN IF NOT EXISTS tipo_arrotondamento   SMALLINT;
ALTER TABLE gare ADD COLUMN IF NOT EXISTS pubblicazione         SMALLINT;
ALTER TABLE gare ADD COLUMN IF NOT EXISTS ali_in_somma_ribassi  BOOLEAN DEFAULT false;
ALTER TABLE gare ADD COLUMN IF NOT EXISTS rapporto_scarto_media NUMERIC(18,6);
ALTER TABLE gare ADD COLUMN IF NOT EXISTS seconda_soglia        NUMERIC(18,6);
ALTER TABLE gare ADD COLUMN IF NOT EXISTS seconda_soglia_2      NUMERIC(18,6);
ALTER TABLE gare ADD COLUMN IF NOT EXISTS offerte_ammesse       INTEGER;
ALTER TABLE gare ADD COLUMN IF NOT EXISTS tipo_calcolo_seconda_soglia SMALLINT;

-- Reperimento
ALTER TABLE gare ADD COLUMN IF NOT EXISTS data_reperimento              TIMESTAMP;
ALTER TABLE gare ADD COLUMN IF NOT EXISTS fonte_reperimento             TEXT;
ALTER TABLE gare ADD COLUMN IF NOT EXISTS username_reperimento          TEXT;
ALTER TABLE gare ADD COLUMN IF NOT EXISTS azienda_reperimento           TEXT;
ALTER TABLE gare ADD COLUMN IF NOT EXISTS data_aggiudicazione_definitiva DATE;
ALTER TABLE gare ADD COLUMN IF NOT EXISTS data_firma_contratto          DATE;

-- SOA dettagli (testo libero - id_soa rimane la referenza principale)
ALTER TABLE gare ADD COLUMN IF NOT EXISTS soa_sigla      VARCHAR(16);
ALTER TABLE gare ADD COLUMN IF NOT EXISTS soa_classifica VARCHAR(8);
ALTER TABLE gare ADD COLUMN IF NOT EXISTS soa_importo    NUMERIC(18,2);

-- Note interne (separate dalle note pubbliche)
ALTER TABLE gare ADD COLUMN IF NOT EXISTS note_interne   TEXT;
