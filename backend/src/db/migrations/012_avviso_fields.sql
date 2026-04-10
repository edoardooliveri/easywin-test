-- Migration 012: Add tipo_apertura_avviso field for AVVISO modal
-- Matches old ASP.NET ImpostaAvviso modal: Data, Ora, Utente, Apertura (Nessuna/Amministrativa/Tecnica/Economica), Note

ALTER TABLE bandi ADD COLUMN IF NOT EXISTS tipo_apertura_avviso VARCHAR(20) DEFAULT 'Nessuna';
-- Values: 'Nessuna', 'Amministrativa', 'Tecnica', 'Economica'

-- Ensure all avviso columns exist (some may already be present from migration 001)
ALTER TABLE bandi ADD COLUMN IF NOT EXISTS data_avviso TIMESTAMPTZ;
ALTER TABLE bandi ADD COLUMN IF NOT EXISTS ora_avviso VARCHAR(10);
ALTER TABLE bandi ADD COLUMN IF NOT EXISTS username_avviso VARCHAR(100);
ALTER TABLE bandi ADD COLUMN IF NOT EXISTS note_avviso TEXT;

-- Also ensure posticipa/da-destinarsi columns exist
ALTER TABLE bandi ADD COLUMN IF NOT EXISTS data_apertura_posticipata TIMESTAMPTZ;
ALTER TABLE bandi ADD COLUMN IF NOT EXISTS data_apertura_da_destinarsi BOOLEAN DEFAULT false;

-- Flag for "in lavorazione" state (used by Azzera to reset)
ALTER TABLE bandi ADD COLUMN IF NOT EXISTS in_lavorazione BOOLEAN DEFAULT false;
