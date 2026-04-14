-- 028_bandi_id_azienda_dedicata.sql
-- Aggiunge colonna id_azienda_dedicata alla tabella bandi
ALTER TABLE bandi ADD COLUMN IF NOT EXISTS id_azienda_dedicata BIGINT REFERENCES aziende(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_bandi_azienda_dedicata ON bandi(id_azienda_dedicata) WHERE id_azienda_dedicata IS NOT NULL;
COMMENT ON COLUMN bandi.id_azienda_dedicata IS 'Cliente/azienda a cui il bando è dedicato (bandi privati/civetta)';
