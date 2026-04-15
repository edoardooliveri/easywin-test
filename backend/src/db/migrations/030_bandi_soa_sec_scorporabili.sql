-- Migration 030: Arricchisce bandi_soa_sec per gestione scorporabili
-- La tabella esiste gia con (id, id_bando, id_soa, importo, created_at).
-- Aggiungiamo campi per classifica, subappalto, note, ordinamento.

ALTER TABLE bandi_soa_sec
  ADD COLUMN IF NOT EXISTS soa_val SMALLINT CHECK (soa_val BETWEEN 1 AND 8),
  ADD COLUMN IF NOT EXISTS subappaltabile BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS percentuale_subappalto SMALLINT CHECK (percentuale_subappalto BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS note TEXT,
  ADD COLUMN IF NOT EXISTS ordine SMALLINT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_bandi_soa_sec_bando_ordine ON bandi_soa_sec(id_bando, ordine);
