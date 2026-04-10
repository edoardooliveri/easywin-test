-- ============================================================
-- MIGRATION 004: Upgrade allegati_bando table
-- Adds missing columns for categorized upload system (11 slots)
-- ============================================================

-- Add categoria column (matches old gestionale 11 slot types)
-- Values: bando, disciplinare, allegati, elaborati, rettifica_1..5, chiarimenti, esito
ALTER TABLE allegati_bando ADD COLUMN IF NOT EXISTS categoria VARCHAR(50);

-- Add MIME type column
ALTER TABLE allegati_bando ADD COLUMN IF NOT EXISTS tipo_mime VARCHAR(200);

-- Add file size in bytes
ALTER TABLE allegati_bando ADD COLUMN IF NOT EXISTS dimensione BIGINT;

-- Index on categoria for filtered queries
CREATE INDEX IF NOT EXISTS idx_allegati_bando_categoria ON allegati_bando(id_bando, categoria);

-- ============================================================
-- Also create a VIEW that matches both naming conventions
-- (allegati_bando = migration, allegati_bandi = province-gestione.js)
-- ============================================================
CREATE OR REPLACE VIEW allegati_bandi AS
SELECT
  id,
  id_bando,
  nome_file,
  path AS path_file,
  tipo_mime,
  dimensione,
  categoria,
  username,
  user_type,
  last_update AS data_upload,
  created_at
FROM allegati_bando;

-- ============================================================
-- ALLEGATI ESITI (if not exists)
-- Same structure for esiti attachments
-- ============================================================
CREATE TABLE IF NOT EXISTS allegati_esiti (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    id_esito UUID NOT NULL,
    nome_file VARCHAR(500),
    path_file VARCHAR(1000),
    tipo_mime VARCHAR(200),
    dimensione BIGINT,
    categoria VARCHAR(50),
    username VARCHAR(100),
    user_type VARCHAR(50),
    data_upload TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_allegati_esiti ON allegati_esiti(id_esito);
