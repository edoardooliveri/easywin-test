-- =================================================================
-- Migration 024 — Tabella log import Presidia + flag rettificato
-- =================================================================

-- Flag rettificato su bandi (letto dal frontend come is_rettifica || rettifica)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bandi' AND column_name='rettificato') THEN
    ALTER TABLE bandi ADD COLUMN rettificato BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bandi' AND column_name='data_rettifica') THEN
    ALTER TABLE bandi ADD COLUMN data_rettifica TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bandi' AND column_name='numero_rettifiche') THEN
    ALTER TABLE bandi ADD COLUMN numero_rettifiche INTEGER DEFAULT 0;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_bandi_rettificato ON bandi(rettificato) WHERE rettificato = true;
CREATE INDEX IF NOT EXISTS idx_bandi_data_rettifica ON bandi(data_rettifica DESC);

-- Tabella log run import Presidia
CREATE TABLE IF NOT EXISTS presidia_import_runs (
  id SERIAL PRIMARY KEY,
  run_at TIMESTAMPTZ DEFAULT NOW(),
  slot_key VARCHAR(60),
  tipo VARCHAR(30) NOT NULL,
  data_dal DATE,
  data_al DATE,
  total_presidia INTEGER DEFAULT 0,
  imported INTEGER DEFAULT 0,
  updated INTEGER DEFAULT 0,
  skipped INTEGER DEFAULT 0,
  errors INTEGER DEFAULT 0,
  duration_ms INTEGER,
  success BOOLEAN DEFAULT false,
  retry_count INTEGER DEFAULT 0,
  error_detail JSONB,
  created_by VARCHAR(200),
  UNIQUE(slot_key)
);

CREATE INDEX IF NOT EXISTS idx_presidia_runs_run_at ON presidia_import_runs(run_at DESC);
CREATE INDEX IF NOT EXISTS idx_presidia_runs_tipo ON presidia_import_runs(tipo);
CREATE INDEX IF NOT EXISTS idx_presidia_runs_success ON presidia_import_runs(success);

-- Vista comoda per dashboard
CREATE OR REPLACE VIEW v_presidia_runs_oggi AS
SELECT
  id, run_at, slot_key, tipo,
  total_presidia, imported, updated, skipped, errors,
  duration_ms, success, retry_count,
  error_detail->>'message' AS error_message
FROM presidia_import_runs
WHERE run_at::date = CURRENT_DATE
ORDER BY run_at DESC;
