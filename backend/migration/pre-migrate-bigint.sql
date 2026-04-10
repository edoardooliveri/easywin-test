-- ============================================================
-- PRE-MIGRATION: Convert aziende.id and all FK columns to BIGINT
-- Run this BEFORE running the migration!
-- ============================================================

-- 1. Change aziende.id from SERIAL (INTEGER) to BIGINT
ALTER TABLE aziende ALTER COLUMN id SET DATA TYPE BIGINT;

-- 2. Change all FK columns that reference aziende(id)

-- attestazioni
ALTER TABLE attestazioni ALTER COLUMN id_azienda SET DATA TYPE BIGINT;

-- users
ALTER TABLE users ALTER COLUMN id_azienda SET DATA TYPE BIGINT;

-- gare
ALTER TABLE gare ALTER COLUMN id_vincitore SET DATA TYPE BIGINT;

-- dettaglio_gara
ALTER TABLE dettaglio_gara ALTER COLUMN id_azienda SET DATA TYPE BIGINT;

-- simulazioni_dettagli
ALTER TABLE simulazioni_dettagli ALTER COLUMN id_vincitore SET DATA TYPE BIGINT;
ALTER TABLE simulazioni_dettagli ALTER COLUMN id_azienda SET DATA TYPE BIGINT;

-- registro_gare
ALTER TABLE registro_gare ALTER COLUMN id_azienda SET DATA TYPE BIGINT;

-- richieste_servizi
ALTER TABLE richieste_servizi ALTER COLUMN id_azienda SET DATA TYPE BIGINT;

-- apertura_bandi
ALTER TABLE apertura_bandi ALTER COLUMN id_azienda SET DATA TYPE BIGINT;

-- scrittura_bandi
ALTER TABLE scrittura_bandi ALTER COLUMN id_azienda SET DATA TYPE BIGINT;

-- bandi_probabilita
ALTER TABLE bandi_probabilita ALTER COLUMN id_azienda SET DATA TYPE BIGINT;

-- partecipanti_gara (if exists)
DO $$ BEGIN
  ALTER TABLE partecipanti_gara ALTER COLUMN id_azienda SET DATA TYPE BIGINT;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ati_gara (if exists)
DO $$ BEGIN
  ALTER TABLE ati_gara ALTER COLUMN id_mandataria SET DATA TYPE BIGINT;
  ALTER TABLE ati_gara ALTER COLUMN id_mandante SET DATA TYPE BIGINT;
  ALTER TABLE ati_gara ALTER COLUMN id_azienda_esecutrice_1 SET DATA TYPE BIGINT;
  ALTER TABLE ati_gara ALTER COLUMN id_azienda_esecutrice_2 SET DATA TYPE BIGINT;
  ALTER TABLE ati_gara ALTER COLUMN id_azienda_esecutrice_3 SET DATA TYPE BIGINT;
  ALTER TABLE ati_gara ALTER COLUMN id_azienda_esecutrice_4 SET DATA TYPE BIGINT;
  ALTER TABLE ati_gara ALTER COLUMN id_azienda_esecutrice_5 SET DATA TYPE BIGINT;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- avvalimenti (if exists)
DO $$ BEGIN
  ALTER TABLE avvalimenti ALTER COLUMN id_azienda_principale SET DATA TYPE BIGINT;
  ALTER TABLE avvalimenti ALTER COLUMN id_azienda_ausiliaria SET DATA TYPE BIGINT;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- consorzi (if exists)
DO $$ BEGIN
  ALTER TABLE consorzi ALTER COLUMN id_azienda_consorzio SET DATA TYPE BIGINT;
  ALTER TABLE consorzi ALTER COLUMN id_azienda_membro SET DATA TYPE BIGINT;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- sopralluoghi
DO $$ BEGIN
  ALTER TABLE sopralluoghi ALTER COLUMN id_azienda SET DATA TYPE BIGINT;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- subappaltatori (if exists)
DO $$ BEGIN
  ALTER TABLE subappaltatori ALTER COLUMN id_azienda SET DATA TYPE BIGINT;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- attestazioni_aziende (if exists)
DO $$ BEGIN
  ALTER TABLE attestazioni_aziende ALTER COLUMN id_azienda SET DATA TYPE BIGINT;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- esecutrici_gara (if exists)
DO $$ BEGIN
  ALTER TABLE esecutrici_gara ALTER COLUMN id_azienda_esecutrice_1 SET DATA TYPE BIGINT;
  ALTER TABLE esecutrici_gara ALTER COLUMN id_azienda_esecutrice_2 SET DATA TYPE BIGINT;
  ALTER TABLE esecutrici_gara ALTER COLUMN id_azienda_esecutrice_3 SET DATA TYPE BIGINT;
  ALTER TABLE esecutrici_gara ALTER COLUMN id_azienda_esecutrice_4 SET DATA TYPE BIGINT;
  ALTER TABLE esecutrici_gara ALTER COLUMN id_azienda_esecutrice_5 SET DATA TYPE BIGINT;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- Change sequence to BIGINT too
ALTER SEQUENCE IF EXISTS aziende_id_seq AS BIGINT;

SELECT 'BIGINT migration complete!' AS status;
