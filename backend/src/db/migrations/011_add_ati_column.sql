-- Add ATI (Associazione Temporanea di Imprese) / Avvalimento column to dettaglio_gara
ALTER TABLE dettaglio_gara ADD COLUMN IF NOT EXISTS ati BOOLEAN DEFAULT false;

-- Add comment for clarity
COMMENT ON COLUMN dettaglio_gara.ati IS 'True if this participant is part of ATI/Avvalimento';
