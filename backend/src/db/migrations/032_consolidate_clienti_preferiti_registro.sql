-- Migration 032: consolida lo schema di preferiti_esiti, registro_gare_clienti
-- e richieste_servizi. Risolve il conflitto tra migration 005 (canonical) e 009
-- (legacy) che creava una variante con colonne in PascalCase virgolettato e
-- nomi diversi (data_aggiunta vs data_inserimento, note vs note_registro).
--
-- Il codice del backend usa lo schema 005: username (lowercase),
-- data_inserimento, note_registro. Questa migration normalizza il DB esistente
-- in modo idempotente:
--   - se le tabelle non esistono, le crea con lo schema canonico
--   - se esistono con colonne legacy ("UserName", data_aggiunta, note),
--     le rinomina ai nomi canonici
--   - aggiunge indici/constraint mancanti
--
-- Sicura da eseguire ripetutamente.

-- ============================================================
-- preferiti_esiti
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'preferiti_esiti') THEN
    CREATE TABLE preferiti_esiti (
      id SERIAL PRIMARY KEY,
      username VARCHAR(100) NOT NULL,
      id_gara INTEGER NOT NULL,
      data_inserimento TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (username, id_gara)
    );
  ELSE
    -- rename "UserName" -> username (case-preserved quoted variant)
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'preferiti_esiti' AND column_name = 'UserName'
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'preferiti_esiti' AND column_name = 'username'
    ) THEN
      EXECUTE 'ALTER TABLE preferiti_esiti RENAME COLUMN "UserName" TO username';
    END IF;

    -- rename data_aggiunta -> data_inserimento
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'preferiti_esiti' AND column_name = 'data_aggiunta'
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'preferiti_esiti' AND column_name = 'data_inserimento'
    ) THEN
      ALTER TABLE preferiti_esiti RENAME COLUMN data_aggiunta TO data_inserimento;
    END IF;

    -- garantisci che le colonne username + data_inserimento esistano
    -- (potrebbe esserci uno schema ibrido)
    ALTER TABLE preferiti_esiti ADD COLUMN IF NOT EXISTS username         VARCHAR(100);
    ALTER TABLE preferiti_esiti ADD COLUMN IF NOT EXISTS data_inserimento TIMESTAMPTZ DEFAULT NOW();
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_preferiti_esiti_username   ON preferiti_esiti (username);
CREATE INDEX IF NOT EXISTS idx_preferiti_esiti_gara       ON preferiti_esiti (id_gara);

-- ============================================================
-- registro_gare_clienti
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'registro_gare_clienti') THEN
    CREATE TABLE registro_gare_clienti (
      id SERIAL PRIMARY KEY,
      username VARCHAR(100) NOT NULL,
      id_bando UUID NOT NULL,
      note_registro TEXT,
      data_inserimento TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (username, id_bando)
    );
  ELSE
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'registro_gare_clienti' AND column_name = 'UserName'
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'registro_gare_clienti' AND column_name = 'username'
    ) THEN
      EXECUTE 'ALTER TABLE registro_gare_clienti RENAME COLUMN "UserName" TO username';
    END IF;

    -- rename note -> note_registro (solo se il nuovo nome non esiste gia)
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'registro_gare_clienti' AND column_name = 'note'
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'registro_gare_clienti' AND column_name = 'note_registro'
    ) THEN
      ALTER TABLE registro_gare_clienti RENAME COLUMN note TO note_registro;
    END IF;

    -- garantisci colonne richieste dagli endpoint
    ALTER TABLE registro_gare_clienti ADD COLUMN IF NOT EXISTS username         VARCHAR(100);
    ALTER TABLE registro_gare_clienti ADD COLUMN IF NOT EXISTS note_registro    TEXT;
    ALTER TABLE registro_gare_clienti ADD COLUMN IF NOT EXISTS data_inserimento TIMESTAMPTZ DEFAULT NOW();
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_registro_gare_clienti_username ON registro_gare_clienti (username);
CREATE INDEX IF NOT EXISTS idx_registro_gare_clienti_bando    ON registro_gare_clienti (id_bando);

-- ============================================================
-- richieste_servizi: la migration 009 usa "UserName"; la 005 usa username.
-- Le due varianti hanno colonne diverse: 005 ha richiesta/gestito/
-- data_inserimento ma NON tipo_servizio/stato; 009 ha tipo_servizio/stato
-- ma NON richiesta/gestito/data_inserimento. Qui le riconciliamo tutte
-- aggiungendo le colonne mancanti su ENTRAMBI gli schemi (idempotente
-- via IF NOT EXISTS).
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'richieste_servizi') THEN
    CREATE TABLE richieste_servizi (
      id SERIAL PRIMARY KEY,
      id_bando UUID,
      username VARCHAR(100) NOT NULL,
      tipo_servizio VARCHAR(50),
      richiesta TEXT,
      note TEXT,
      gestito BOOLEAN DEFAULT FALSE,
      data_richiesta TIMESTAMPTZ DEFAULT NOW(),
      data_inserimento TIMESTAMPTZ DEFAULT NOW(),
      stato VARCHAR(20) DEFAULT 'PENDING'
    );
  ELSE
    -- Rename "UserName" -> username se necessario.
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'richieste_servizi' AND column_name = 'UserName'
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'richieste_servizi' AND column_name = 'username'
    ) THEN
      EXECUTE 'ALTER TABLE richieste_servizi RENAME COLUMN "UserName" TO username';
    END IF;

    -- Aggiungi tutte le colonne dello schema canonico se mancanti.
    -- L'INDEX su stato (creato sotto) fallisce se manca la colonna —
    -- questo era il bug 'column "stato" does not exist' al boot.
    ALTER TABLE richieste_servizi ADD COLUMN IF NOT EXISTS username         VARCHAR(100);
    ALTER TABLE richieste_servizi ADD COLUMN IF NOT EXISTS tipo_servizio    VARCHAR(50);
    ALTER TABLE richieste_servizi ADD COLUMN IF NOT EXISTS richiesta        TEXT;
    ALTER TABLE richieste_servizi ADD COLUMN IF NOT EXISTS note             TEXT;
    ALTER TABLE richieste_servizi ADD COLUMN IF NOT EXISTS gestito          BOOLEAN DEFAULT FALSE;
    ALTER TABLE richieste_servizi ADD COLUMN IF NOT EXISTS data_richiesta   TIMESTAMPTZ DEFAULT NOW();
    ALTER TABLE richieste_servizi ADD COLUMN IF NOT EXISTS data_inserimento TIMESTAMPTZ DEFAULT NOW();
    ALTER TABLE richieste_servizi ADD COLUMN IF NOT EXISTS stato            VARCHAR(20) DEFAULT 'PENDING';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_richieste_servizi_username ON richieste_servizi (username);
CREATE INDEX IF NOT EXISTS idx_richieste_servizi_stato    ON richieste_servizi (stato);
