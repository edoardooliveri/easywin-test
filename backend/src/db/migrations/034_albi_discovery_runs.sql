-- Migration 034: tracking delle run di discovery albi fornitori.
--
-- La pipeline discovery (tools/albi/scan-albi-completo.js +
-- extract-albo-details.cjs + import-albi-da-scan.js, oppure
-- backend/scripts/ricerca-albi-web.js) e batch e incrementale: scansiona
-- N stazioni alla volta, salva risultati in JSON, importa in DB. Senza un
-- registro dei batch eseguiti non si capisce quali stazioni sono gia state
-- coperte e a che data — il riavvio chiede sempre allo script che ha sul
-- disco scrivere e leggere il file JSON di stato.
--
-- Questa tabella centralizza i metadati delle run cosi che l'UI admin
-- possa mostrare timeline, stato corrente, contatori, ed eventualmente
-- triggerare una nuova run senza ssh al server.
--
-- Sicura da eseguire ripetutamente.

CREATE TABLE IF NOT EXISTS albi_discovery_runs (
    id SERIAL PRIMARY KEY,

    -- Identificazione run
    tipo VARCHAR(50) NOT NULL,                  -- 'scan_completo', 'ricerca_web', 'popola_piattaforme', 'import_scan', 'recheck'
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    success BOOLEAN,                            -- NULL = running

    -- Filtro applicato (opzionale)
    range_from_id INTEGER,                      -- stazione id minimo processato
    range_to_id   INTEGER,
    limit_count   INTEGER,                      -- --limit della run

    -- Contatori
    stazioni_processate INTEGER DEFAULT 0,
    albi_trovati        INTEGER DEFAULT 0,
    albi_inseriti       INTEGER DEFAULT 0,
    albi_aggiornati     INTEGER DEFAULT 0,
    errori              INTEGER DEFAULT 0,

    -- Riferimenti file
    progress_file VARCHAR(500),                 -- path del file di progresso usato
    report_file   VARCHAR(500),                 -- path del report JSON/CSV
    log_excerpt   TEXT,                         -- prime/ultime righe del log (debug)

    -- Audit
    triggered_by VARCHAR(100),                  -- 'scheduler' | 'admin:<username>' | 'cli'
    error_detail JSONB                          -- stack trace + dettagli errore
);

CREATE INDEX IF NOT EXISTS idx_albi_discovery_runs_tipo  ON albi_discovery_runs (tipo);
CREATE INDEX IF NOT EXISTS idx_albi_discovery_runs_start ON albi_discovery_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_albi_discovery_runs_running ON albi_discovery_runs (success) WHERE success IS NULL;

COMMENT ON TABLE albi_discovery_runs IS 'Storico delle run di scoperta albi fornitori (scan, ricerca web, import, recheck). Ogni run produce un report e aggiorna i contatori globali.';

-- Helper view per dashboard admin: ultimo stato per tipo di run
CREATE OR REPLACE VIEW v_albi_discovery_summary AS
SELECT
    tipo,
    COUNT(*)::int                       AS run_totali,
    COUNT(*) FILTER (WHERE success IS TRUE)::int AS run_ok,
    COUNT(*) FILTER (WHERE success IS FALSE)::int AS run_ko,
    MAX(started_at)                     AS ultima_run,
    SUM(stazioni_processate)::int       AS totale_stazioni,
    SUM(albi_trovati)::int              AS totale_albi_trovati,
    SUM(albi_inseriti)::int             AS totale_albi_inseriti
FROM albi_discovery_runs
GROUP BY tipo;
