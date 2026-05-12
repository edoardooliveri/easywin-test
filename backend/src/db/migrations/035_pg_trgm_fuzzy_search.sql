-- Migration 035: abilita pg_trgm + indici GIN per fuzzy search.
--
-- pg_trgm e un'estensione standard di PostgreSQL che permette:
--   - operator %  (similarity > soglia) per match approssimativi
--     ("crsta" % "Cresta" → true)
--   - funzione similarity(a, b) → float 0..1
-- Senza indici GIN, ogni query e' un seq scan lento sulla tabella;
-- l'indice gin_trgm_ops la rende veloce anche su 100k+ righe.
--
-- Tabelle dove serve la fuzzy:
--   aziende.ragione_sociale            (es. "crsta" → "Geom. Stefano Cresta")
--   stazioni.nome                       (es. "comne ro" → "Comune di Roma")
--   dettaglio_gara.ragione_sociale     (graduatoria: imprese sconosciute)
--   bandi.titolo                        (ricerca per oggetto)
--   gare.titolo                         (ricerca per oggetto esiti)
--
-- Idempotente: CREATE EXTENSION + CREATE INDEX IF NOT EXISTS.

-- ============================================================
-- 1. Abilita estensione pg_trgm (richiede privilegi SUPERUSER su alcuni
--    hosting; su Neon/Supabase di solito e' gia disponibile o si attiva
--    senza problemi tramite il default user).
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- 2. Soglia di similarity (1 = identico, 0 = totalmente diverso).
--    0.20 e' un compromesso ragionevole: "crsta" vs "Cresta" ~0.45,
--    "geom stfano" vs "Geom. Stefano" ~0.60, ma "abc" vs "xyz" ~0.05.
-- ============================================================
SET pg_trgm.similarity_threshold = 0.20;

-- ============================================================
-- 3. Indici GIN trgm per ricerca veloce.
--    NB: idx_aziende_ragione_sociale_trgm e' gia stato creato dalla
--    migration 001_bandi_schema.sql, lo aggiungo qui only IF NOT EXISTS
--    per essere safe.
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_aziende_ragione_sociale_trgm
  ON aziende USING gin (ragione_sociale gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_stazioni_nome_trgm
  ON stazioni USING gin (nome gin_trgm_ops);

-- dettaglio_gara.ragione_sociale (denormalizzato per imprese sconosciute,
-- definito in migration 002 esiti_schema). Solo se la colonna esiste.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dettaglio_gara' AND column_name = 'ragione_sociale'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_dettaglio_gara_ragione_sociale_trgm
      ON dettaglio_gara USING gin (ragione_sociale gin_trgm_ops);
  END IF;
END $$;

-- bandi.titolo e gare.titolo: text potenzialmente lungo, ma trgm va bene
-- anche su text (e' progettato per testi medi). Indici useful per la
-- ricerca per oggetto su tabelle grandi (1M+ bandi).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bandi' AND column_name='titolo') THEN
    CREATE INDEX IF NOT EXISTS idx_bandi_titolo_trgm
      ON bandi USING gin (titolo gin_trgm_ops);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gare' AND column_name='titolo') THEN
    CREATE INDEX IF NOT EXISTS idx_gare_titolo_trgm
      ON gare USING gin (titolo gin_trgm_ops);
  END IF;
END $$;
