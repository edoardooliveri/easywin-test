-- 023_sopralluoghi_align_schema.sql
-- Allinea schema sopralluoghi con sibling tables (aperture/scritture/elaborati)
-- Aggiunge colonne mancanti usate dagli endpoint in bandi-servizi.js

ALTER TABLE sopralluoghi ADD COLUMN IF NOT EXISTS data DATE;
ALTER TABLE sopralluoghi ADD COLUMN IF NOT EXISTS ora VARCHAR(10);
ALTER TABLE sopralluoghi ADD COLUMN IF NOT EXISTS tipo VARCHAR(100);
ALTER TABLE sopralluoghi ADD COLUMN IF NOT EXISTS stato VARCHAR(50) DEFAULT 'in_sospeso';
ALTER TABLE sopralluoghi ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE sopralluoghi ADD COLUMN IF NOT EXISTS id_intermediario INTEGER;
ALTER TABLE sopralluoghi ADD COLUMN IF NOT EXISTS prezzo_azienda NUMERIC(12,2);
ALTER TABLE sopralluoghi ADD COLUMN IF NOT EXISTS prezzo_intermediario NUMERIC(12,2);
ALTER TABLE sopralluoghi ADD COLUMN IF NOT EXISTS prezzo_esecutore NUMERIC(12,2);
ALTER TABLE sopralluoghi ADD COLUMN IF NOT EXISTS pagato_intermediario BOOLEAN DEFAULT false;
ALTER TABLE sopralluoghi ADD COLUMN IF NOT EXISTS pagato_esecutore BOOLEAN DEFAULT false;
ALTER TABLE sopralluoghi ADD COLUMN IF NOT EXISTS utente_nome VARCHAR(200);
ALTER TABLE sopralluoghi ADD COLUMN IF NOT EXISTS azienda_nome VARCHAR(200);
ALTER TABLE sopralluoghi ADD COLUMN IF NOT EXISTS luogo TEXT;

-- Popola data da data_sopralluogo per righe esistenti (se data è NULL)
UPDATE sopralluoghi
   SET data = data_sopralluogo::date
 WHERE data IS NULL AND data_sopralluogo IS NOT NULL;

-- Ora dalla parte time di data_sopralluogo
UPDATE sopralluoghi
   SET ora = TO_CHAR(data_sopralluogo, 'HH24:MI')
 WHERE ora IS NULL AND data_sopralluogo IS NOT NULL;

-- Popola stato da eseguito/annullato
UPDATE sopralluoghi
   SET stato = CASE
       WHEN annullato THEN 'annullato'
       WHEN eseguito THEN 'eseguito'
       ELSE 'in_sospeso'
   END
 WHERE stato IS NULL;

-- Indice sulla nuova colonna data per ORDER BY
CREATE INDEX IF NOT EXISTS idx_sopralluoghi_data ON sopralluoghi(data DESC);
