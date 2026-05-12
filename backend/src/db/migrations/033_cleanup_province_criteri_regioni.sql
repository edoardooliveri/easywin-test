-- Migration 033: pulizia dati su province, criteri e regione denormalizzata
-- di bandi/gare.
--
-- Bug DB identificati nell'audit:
--   1. province.sigla contiene trailing space ("AO ", "NU ", "AR ", ...)
--      → rompe filtri esatti e join lato client.
--   2. criteri ha record duplicati (es. due righe "Esclusione Automatica
--      Delle Offerte Anomale (All. II.2 e art. 54 del D.Lgs 36/2023)" con
--      id 17 e 19) → dropdown UI mostra valori doppi e bandi referenziano
--      indistintamente uno dei due.
--   3. bandi.regione e gare.regione sono colonne VARCHAR denormalizzate
--      che, per import storici malformati, risultano disallineate rispetto
--      a stazioni.id_provincia → province.id_regione → regioni.nome
--      (es. Bando NUORO con regione "Marche", Esito di Comune di Longi
--      (Messina) con regione "Molise"). Sincronizziamo i due campi dalla
--      catena canonica.
--
-- Migration idempotente: tutti gli UPDATE sono safe se rieseguiti.

BEGIN;

-- ============================================================
-- 1. Trim trailing space su province.sigla
-- ============================================================
UPDATE province
SET sigla = TRIM(sigla)
WHERE sigla <> TRIM(sigla);

-- ============================================================
-- 2. Deduplica criteri:
--    - mantieni il criterio con id MIN per ogni 'nome'
--    - re-punta i FK in bandi.id_criterio / gare.id_criterio
--    - disattiva (attivo=false) i duplicati invece di eliminare
-- ============================================================
DO $$
DECLARE
  r RECORD;
BEGIN
  -- Per ogni nome con piu di una riga, mappa duplicati -> canonico
  FOR r IN
    SELECT MIN(id) AS canonical_id, ARRAY_AGG(id ORDER BY id) AS all_ids, nome
    FROM criteri
    GROUP BY nome
    HAVING COUNT(*) > 1
  LOOP
    -- bandi: aggiorna i FK ai duplicati verso il canonico
    UPDATE bandi
    SET id_criterio = r.canonical_id
    WHERE id_criterio = ANY(r.all_ids)
      AND id_criterio <> r.canonical_id;

    -- gare: idem (esiti)
    UPDATE gare
    SET id_criterio = r.canonical_id
    WHERE id_criterio = ANY(r.all_ids)
      AND id_criterio <> r.canonical_id;

    -- disattiva i duplicati (non-canonical)
    UPDATE criteri
    SET attivo = false
    WHERE id = ANY(r.all_ids)
      AND id <> r.canonical_id
      AND attivo IS DISTINCT FROM false;

    RAISE NOTICE 'criteri: deduplicato nome=% canonico=% duplicati=%',
      r.nome, r.canonical_id, r.all_ids;
  END LOOP;
END $$;

-- ============================================================
-- 3. Resync bandi.regione dalla catena stazioni -> province -> regioni
-- ============================================================
UPDATE bandi b
SET regione = r.nome
FROM stazioni s
JOIN province p ON s.id_provincia = p.id
JOIN regioni r ON p.id_regione = r.id
WHERE b.id_stazione = s.id
  AND (b.regione IS NULL OR b.regione IS DISTINCT FROM r.nome);

-- ============================================================
-- 4. Resync gare.regione dalla catena bando -> stazioni -> province -> regioni
--    Le gare puntano al bando (g.id_bando) che a sua volta ha id_stazione.
-- ============================================================
UPDATE gare g
SET regione = r.nome
FROM bandi b
JOIN stazioni s ON b.id_stazione = s.id
JOIN province p ON s.id_provincia = p.id
JOIN regioni r ON p.id_regione = r.id
WHERE g.id_bando = b.id
  AND (g.regione IS NULL OR g.regione IS DISTINCT FROM r.nome);

COMMIT;
