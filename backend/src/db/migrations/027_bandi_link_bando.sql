-- 027_bandi_link_bando.sql
-- Aggiunge colonna link_bando alla tabella bandi
ALTER TABLE bandi ADD COLUMN IF NOT EXISTS link_bando TEXT;
COMMENT ON COLUMN bandi.link_bando IS 'URL diretto al bando sulla piattaforma di pubblicazione';
