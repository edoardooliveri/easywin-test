-- =====================================================
-- 017: Flag Privato bandi/esiti a 3 livelli + indici
-- 0 = pubblico, 1 = privato organizzazione, 2 = privato utente
-- =====================================================

-- Bandi
ALTER TABLE bandi ADD COLUMN IF NOT EXISTS privato INTEGER DEFAULT 0;
ALTER TABLE bandi ADD COLUMN IF NOT EXISTS privato_username VARCHAR(200);
CREATE INDEX IF NOT EXISTS idx_bandi_privato ON bandi(privato);

-- Gare/Esiti
ALTER TABLE gare ADD COLUMN IF NOT EXISTS privato INTEGER DEFAULT 0;
ALTER TABLE gare ADD COLUMN IF NOT EXISTS privato_username VARCHAR(200);
CREATE INDEX IF NOT EXISTS idx_gare_privato ON gare(privato);

COMMENT ON COLUMN bandi.privato IS '0=pubblico, 1=privato organizzazione, 2=privato utente specifico (vedi privato_username)';
COMMENT ON COLUMN gare.privato IS '0=pubblico, 1=privato organizzazione, 2=privato utente specifico (vedi privato_username)';
