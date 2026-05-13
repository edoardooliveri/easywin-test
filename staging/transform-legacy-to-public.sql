-- ============================================================================
-- transform-legacy-to-public.sql  (v2 — defensive)
-- ============================================================================
-- Trasforma i dati legacy.* nel nuovo schema public.* gestendo:
--   1. Mapping INT→UUID per bandi.id (deterministico v5)
--   2. Naming CamelCase-flatten (idbando) → snake_case (id_bando)
--   3. Mapping campi solo per colonne CERTAMENTE presenti in entrambi
--
-- Strategia defensive: ogni step in un DO block con EXCEPTION → se una
-- tabella legacy ha schema diverso dal previsto (colonna mancante, tipo
-- incompatibile), quel singolo step skippa con NOTICE e gli altri continuano.
--
-- Prerequisiti:
--   1. pgloader-easywin.load eseguito (popola legacy.*)
--   2. Migrations 001-037 applicate (public.* esistente)
--
-- Uso:
--   psql -d easywin_staging -f transform-legacy-to-public.sql
-- ============================================================================

\timing on
-- NB: NO \set ON_ERROR_STOP — vogliamo continuare anche se uno step fallisce

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE SCHEMA IF NOT EXISTS migration_maps;

-- Namespace UUID v5 stabile per easywin
CREATE TABLE IF NOT EXISTS migration_maps.namespace (
    name TEXT PRIMARY KEY,
    uuid_ns UUID NOT NULL
);
INSERT INTO migration_maps.namespace VALUES
    ('easywin-bandi', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::uuid)
ON CONFLICT (name) DO NOTHING;


-- ============================================================================
-- 1. MAPPING bandi.id  legacy INT → nuovo UUID
-- ============================================================================
-- NB: legacy_id è TEXT, non BIGINT — pgloader ha creato legacy.bandi.id_bando
-- come TEXT (con default uuid_generate_v4(), conversione automatica di
-- uniqueidentifier o int identity). Manteniamo TEXT per compatibilità.
DROP TABLE IF EXISTS migration_maps.bandi_id_map CASCADE;
CREATE TABLE migration_maps.bandi_id_map (
    legacy_id TEXT PRIMARY KEY,
    new_id    UUID NOT NULL UNIQUE
);

\echo '[1/8] migration_maps.bandi_id_map ← legacy.bandi'

DO $bandi_map$
BEGIN
    INSERT INTO migration_maps.bandi_id_map (legacy_id, new_id)
    SELECT
        b.id_bando::text,
        uuid_generate_v5(
            (SELECT uuid_ns FROM migration_maps.namespace WHERE name='easywin-bandi'),
            'bando:' || b.id_bando::text
        )
    FROM legacy.bandi b
    WHERE b.id_bando IS NOT NULL
    ON CONFLICT (legacy_id) DO NOTHING;

    RAISE NOTICE '  mapping bandi: % righe', (SELECT COUNT(*) FROM migration_maps.bandi_id_map);
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'STEP 1 (bandi map) failed: % — %', SQLSTATE, SQLERRM;
END $bandi_map$;


-- ============================================================================
-- 2. public.bandi  ←  legacy.bandi
-- ============================================================================
-- Colonne reali public.bandi: id, id_stazione, titolo, codice_cig, codice_cup,
-- importo_so, importo_co, data_pubblicazione, id_soa, regione, annullato,
-- created_at, updated_at (con defaults)
\echo '[2/8] public.bandi ← legacy.bandi'

DO $bandi_insert$
BEGIN
    INSERT INTO public.bandi (
        id,
        titolo,
        codice_cig,
        codice_cup,
        importo_so,
        importo_co,
        data_pubblicazione,
        id_stazione,
        id_soa,
        annullato
    )
    SELECT
        m.new_id,
        b.titolo,
        b.codicecig,
        b.codicecup,
        b.importoso,
        b.importoco,
        b.datapubblicazione,
        b.id_stazione,
        b.id_soa,
        COALESCE(b.annullato, false)
    FROM legacy.bandi b
    JOIN migration_maps.bandi_id_map m ON m.legacy_id = b.id_bando::text
    ON CONFLICT (id) DO NOTHING;

    RAISE NOTICE '  public.bandi: % righe (legacy.bandi: %)',
        (SELECT COUNT(*) FROM public.bandi),
        (SELECT COUNT(*) FROM legacy.bandi);
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'STEP 2 (bandi insert) failed: % — %', SQLSTATE, SQLERRM;
END $bandi_insert$;


-- ============================================================================
-- 3. bandi_province (FK INT→UUID semplice)
-- ============================================================================
\echo '[3/8] public.bandi_province ← legacy.bandiprovince'

DO $bp$
BEGIN
    INSERT INTO public.bandi_province (id_bando, id_provincia)
    SELECT m.new_id, bp.id_provincia
    FROM legacy.bandiprovince bp
    JOIN migration_maps.bandi_id_map m ON m.legacy_id = bp.id_bando::text
    ON CONFLICT DO NOTHING;
    RAISE NOTICE '  public.bandi_province: % righe', (SELECT COUNT(*) FROM public.bandi_province);
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'STEP 3 (bandi_province) failed: % — %', SQLSTATE, SQLERRM;
END $bp$;


-- ============================================================================
-- 4. bandi_soa_app/alt/sec/sost (4 tabelle gemelle FK INT→UUID)
-- ============================================================================
\echo '[4/8] public.bandi_soa_{app,alt,sec,sost} ← legacy'

DO $bsoa$
DECLARE
    src text; dst text;
BEGIN
    FOR src, dst IN
        SELECT * FROM (VALUES
            ('legacy.bandisoaapp',  'public.bandi_soa_app'),
            ('legacy.bandisoaalt',  'public.bandi_soa_alt'),
            ('legacy.bandisoasec',  'public.bandi_soa_sec'),
            ('legacy.bandisoasost', 'public.bandi_soa_sost')
        ) AS t(s,d)
    LOOP
        BEGIN
            EXECUTE format(
                'INSERT INTO %s (id_bando, id_soa, classifica)
                 SELECT m.new_id, x.id_soa, x.classifica
                 FROM %s x
                 JOIN migration_maps.bandi_id_map m ON m.legacy_id = x.id_bando::text
                 ON CONFLICT DO NOTHING',
                dst, src
            );
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING '    skip % → %: %', src, dst, SQLERRM;
        END;
    END LOOP;
END $bsoa$;


-- ============================================================================
-- 5. ESITI (gare): id_bando INT→UUID, gare.id resta INTEGER
-- ============================================================================
\echo '[5/8] public.gare ← legacy.gare (esiti)'

DO $gare$
BEGIN
    INSERT INTO public.gare (
        id, id_bando, titolo, codice_cig, importo_so, importo_co,
        id_stazione, id_soa, regione, annullato
    )
    SELECT
        g.id,
        m.new_id,                          -- NULL ammesso se gara senza bando
        g.titolo,
        g.codicecig,
        g.importoso,
        g.importoco,
        g.id_stazione,
        g.id_soa,
        g.regione,
        COALESCE(g.annullato, false)
    FROM legacy.gare g
    LEFT JOIN migration_maps.bandi_id_map m ON m.legacy_id = g.id_bando::text
    ON CONFLICT (id) DO NOTHING;

    PERFORM setval(
        pg_get_serial_sequence('public.gare', 'id'),
        GREATEST((SELECT COALESCE(MAX(id), 1) FROM public.gare), 1),
        true
    );
    RAISE NOTICE '  public.gare: % righe', (SELECT COUNT(*) FROM public.gare);
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'STEP 5 (gare) failed: % — %', SQLSTATE, SQLERRM;
END $gare$;


-- ============================================================================
-- 6. Servizi bandi (aperture, scritture, elaborati, sopralluoghi, date)
-- ============================================================================
-- ATTENZIONE: schema public.aperture/scritture/elaborati ha colonne
-- specifiche (vedi m.021). Se il legacy ha colonne diverse, lo step skippa.
\echo '[6/8] aperture, scritture, elaborati, sopralluoghi'

DO $serv$
BEGIN
    -- aperture (legacy.aperturabandi)
    BEGIN
        INSERT INTO public.aperture (id_bando, data, username, stato)
        SELECT m.new_id, a.data::date, a.username, COALESCE(a.stato, 'in_sospeso')
        FROM legacy.aperturabandi a
        JOIN migration_maps.bandi_id_map m ON m.legacy_id = a.id_bando::text
        ON CONFLICT DO NOTHING;
    EXCEPTION WHEN OTHERS THEN RAISE WARNING '    aperture skip: %', SQLERRM; END;

    -- scritture (legacy.scritturabandi)
    BEGIN
        INSERT INTO public.scritture (id_bando, data, username, stato)
        SELECT m.new_id, s.data::date, s.username, COALESCE(s.stato, 'in_sospeso')
        FROM legacy.scritturabandi s
        JOIN migration_maps.bandi_id_map m ON m.legacy_id = s.id_bando::text
        ON CONFLICT DO NOTHING;
    EXCEPTION WHEN OTHERS THEN RAISE WARNING '    scritture skip: %', SQLERRM; END;

    -- elaborati (legacy.elaboratiprogettuali)
    BEGIN
        INSERT INTO public.elaborati (id_bando, username, stato)
        SELECT m.new_id, e.username, COALESCE(e.stato, 'in_sospeso')
        FROM legacy.elaboratiprogettuali e
        JOIN migration_maps.bandi_id_map m ON m.legacy_id = e.id_bando::text
        ON CONFLICT DO NOTHING;
    EXCEPTION WHEN OTHERS THEN RAISE WARNING '    elaborati skip: %', SQLERRM; END;

    -- sopralluoghi
    BEGIN
        INSERT INTO public.sopralluoghi (id_bando, data, username, stato)
        SELECT m.new_id, s.data::date, s.username, COALESCE(s.stato, 'in_sospeso')
        FROM legacy.sopralluoghi s
        JOIN migration_maps.bandi_id_map m ON m.legacy_id = s.id_bando::text
        ON CONFLICT DO NOTHING;
    EXCEPTION WHEN OTHERS THEN RAISE WARNING '    sopralluoghi skip: %', SQLERRM; END;
END $serv$;


-- ============================================================================
-- 7. Sequence reset (public.bandi non ne ha bisogno: id è UUID;
--    le altre tabelle SERIAL sì)
-- ============================================================================
\echo '[7/8] Reset sequenze SERIAL'

DO $seq$
DECLARE
    tbl text;
BEGIN
    FOR tbl IN VALUES ('gare') LOOP
        EXECUTE format(
            'SELECT setval(pg_get_serial_sequence(''public.%s'', ''id''),
                           GREATEST((SELECT COALESCE(MAX(id), 1) FROM public.%s), 1),
                           true)',
            tbl, tbl
        );
    END LOOP;
END $seq$;


-- ============================================================================
-- 8. VERIFICA FINALE
-- ============================================================================
\echo '[8/8] Verifica row counts'

DO $verify$
DECLARE
    legacy_bandi BIGINT; public_bandi BIGINT;
    mapped_bandi BIGINT; legacy_gare BIGINT; public_gare BIGINT;
BEGIN
    SELECT COUNT(*) INTO legacy_bandi FROM legacy.bandi;
    SELECT COUNT(*) INTO public_bandi FROM public.bandi;
    SELECT COUNT(*) INTO mapped_bandi FROM migration_maps.bandi_id_map;
    BEGIN SELECT COUNT(*) INTO legacy_gare FROM legacy.gare; EXCEPTION WHEN OTHERS THEN legacy_gare := 0; END;
    BEGIN SELECT COUNT(*) INTO public_gare FROM public.gare; EXCEPTION WHEN OTHERS THEN public_gare := 0; END;

    RAISE NOTICE '────────────────────────────────────────';
    RAISE NOTICE 'TRANSFORM LEGACY → PUBLIC: REPORT';
    RAISE NOTICE '────────────────────────────────────────';
    RAISE NOTICE '  bandi    legacy: %  public: %  mapped: %', legacy_bandi, public_bandi, mapped_bandi;
    RAISE NOTICE '  gare     legacy: %  public: %',            legacy_gare, public_gare;
    RAISE NOTICE '────────────────────────────────────────';
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Verifica fallita: %', SQLERRM;
END $verify$;

VACUUM ANALYZE public.bandi;
BEGIN; END;  -- no-op per chiudere transazione implicita
VACUUM ANALYZE public.gare;

\echo ''
\echo '═══════════════════════════════════════════════════════════════'
\echo 'Transform legacy → public completato.'
\echo 'Errori per singole tabelle → vedi WARNING sopra (non bloccanti).'
\echo 'Prossimo: transform-legacy-anagrafica.sql'
\echo '═══════════════════════════════════════════════════════════════'
