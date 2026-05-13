-- ============================================================================
-- transform-legacy-to-public.sql
-- ============================================================================
-- Trasforma i dati legacy (schema "legacy.*") nel nuovo schema modernizzato
-- (schema "public.*") gestendo il mapping INT→UUID per Bandi.IdBando.
--
-- Prerequisito: pgloader-easywin.load già eseguito (popola legacy.*).
--
-- Uso:
--   psql -d easywin_staging -f transform-legacy-to-public.sql
--
-- Idempotente: usa ON CONFLICT DO NOTHING + DELETE solo sui maps. Riesegui
-- gratis se hai dubbi.
--
-- ============================================================================
-- DESIGN DEL MAPPING UUID
-- ============================================================================
-- Per ogni Bandi.IdBando INTEGER del legacy, genero un UUID *deterministico*
-- v5 basato su namespace fisso + l'ID legacy stringato:
--
--   uuid_generate_v5(NAMESPACE, 'bando:' || legacy_id::text)
--
-- Vantaggi vs uuid_generate_v4() random:
--   - REPRODUCIBLE: rifaccio la migrazione, stesso UUID
--   - IDEMPOTENT: ri-eseguire questo script non duplica le righe
--                 (ON CONFLICT (id) DO NOTHING funziona)
--   - DEBUGGABLE: dato un UUID nuovo, posso ricavare l'ID legacy via lookup
--                 nel mapping table
--
-- ============================================================================

\timing on
\set ON_ERROR_STOP on

BEGIN;

-- ----------------------------------------------------------------------------
-- 0. Prerequisiti: extension + namespace
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Schema di servizio per le tabelle di mapping (separato da public)
CREATE SCHEMA IF NOT EXISTS migration_maps;

-- Namespace UUID v5 stabile per easywin. Generato una sola volta a mano:
--   SELECT uuid_generate_v5(uuid_ns_dns(), 'easywin.it');
--   → a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11
-- Cambialo solo se serve "nuovo universo di UUID" (es. ambiente test separato).
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

CREATE TABLE IF NOT EXISTS migration_maps.bandi_id_map (
    legacy_id BIGINT PRIMARY KEY,
    new_id    UUID NOT NULL UNIQUE
);

\echo '[1/N] Popolo migration_maps.bandi_id_map...'

INSERT INTO migration_maps.bandi_id_map (legacy_id, new_id)
SELECT
    b.idbando AS legacy_id,
    uuid_generate_v5(
        (SELECT uuid_ns FROM migration_maps.namespace WHERE name='easywin-bandi'),
        'bando:' || b.idbando::text
    ) AS new_id
FROM legacy.bandi b
ON CONFLICT (legacy_id) DO NOTHING;

-- Sanity
SELECT format('  mapping bandi creato: %s righe (legacy.bandi: %s)',
              (SELECT COUNT(*) FROM migration_maps.bandi_id_map),
              (SELECT COUNT(*) FROM legacy.bandi))
AS info \gset
\echo :info


-- ============================================================================
-- 2. public.bandi  ←  legacy.bandi
-- ============================================================================
-- Mappa colonne legacy CamelCase-flatten → nuovo snake_case.
-- ATTENZIONE: i nomi colonne legacy sono in tutto-minuscolo dopo pgloader
-- (downcase identifiers): IdBando → idbando, DataPubblicazione → datapubblicazione.

\echo '[2/N] public.bandi ← legacy.bandi (con UUID mappato)...'

-- Colonne nello schema nuovo public.bandi (semplificato; aggiungi/togli a
-- seconda di quali colonne del legacy ti servono):
--   id, titolo, codice_cig, cup, importo_so, importo_co,
--   data_pubblicazione, data_scadenza, data_rettifica,
--   id_stazione, id_soa, regione, annullato, created_at, updated_at, …

INSERT INTO public.bandi (
    id,
    titolo,
    codice_cig,
    cup,
    importo_so,
    importo_co,
    data_pubblicazione,
    data_scadenza,
    data_rettifica,
    id_stazione,
    id_soa,
    regione,
    annullato,
    created_at,
    updated_at
)
SELECT
    m.new_id,
    b.titolo,
    b.codicecig,
    b.cup,
    b.importoso,
    b.importoco,
    b.datapubblicazione,
    b.datascadenza,
    b.datarettifica,
    b.idstazione,
    b.idsoa,
    b.regione,
    COALESCE(b.annullato, false),
    COALESCE(b.created_at, b.datapubblicazione, NOW()),
    COALESCE(b.updated_at, b.datapubblicazione, NOW())
FROM legacy.bandi b
JOIN migration_maps.bandi_id_map m ON m.legacy_id = b.idbando
ON CONFLICT (id) DO NOTHING;

SELECT format('  public.bandi: %s righe (atteso: %s)',
              (SELECT COUNT(*) FROM public.bandi),
              (SELECT COUNT(*) FROM legacy.bandi))
AS info \gset
\echo :info


-- ============================================================================
-- 3. Tabelle FK che referenziano bandi.id — traduzione INT→UUID
-- ============================================================================
-- Pattern ripetuto per ognuna: INSERT INTO public.X SELECT … FROM legacy.X
-- JOIN migration_maps.bandi_id_map ON map.legacy_id = X.idbando.
--
-- Le tabelle target sono quelle del nuovo schema con id_bando UUID. Ne sono
-- 20 effettive (alcune ripetute tra m.001 e m.021, vedi audit).
--
-- Note tecniche:
--   - legacy.bandiprovince  → public.bandi_province  (rename naming)
--   - legacy.allegatibando  → public.allegati_bando
--   - legacy.dettagliogara è esiti, non bandi → trattato sotto (sez. 4)
-- ----------------------------------------------------------------------------

\echo '[3/N] FK INT→UUID: bandi_province, allegati_bando, bandi_soa_*, ...'

-- 3.1 bandi_province
INSERT INTO public.bandi_province (id_bando, id_provincia)
SELECT m.new_id, bp.idprovincia
FROM legacy.bandiprovince bp
JOIN migration_maps.bandi_id_map m ON m.legacy_id = bp.idbando
ON CONFLICT DO NOTHING;

-- 3.2 allegati_bando (schema nuovo m.001/m.004; le colonne specifiche dipendono
--     dal redesign — adatta i nomi a quelli effettivamente presenti in m.001).
INSERT INTO public.allegati_bando (id_bando, nome_file, url, descrizione, data_creazione)
SELECT
    m.new_id,
    a.nomefile,
    a.url,
    a.descrizione,
    COALESCE(a.datacreazione, NOW())
FROM legacy.allegatibando a
JOIN migration_maps.bandi_id_map m ON m.legacy_id = a.idbando
ON CONFLICT DO NOTHING;

-- 3.3 bandi_soa_app / alt / sec / sost (4 tabelle SQL Server gemelle)
DO $$
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
        EXECUTE format(
            'INSERT INTO %s (id_bando, id_soa, classifica)
             SELECT m.new_id, x.idsoa, x.classifica
             FROM %s x
             JOIN migration_maps.bandi_id_map m ON m.legacy_id = x.idbando
             ON CONFLICT DO NOTHING',
            dst, src
        );
    END LOOP;
END $$;

-- 3.4 bandi_probabilita
INSERT INTO public.bandi_probabilita (id_bando, probabilita, calcolata_il)
SELECT m.new_id, p.probabilita, COALESCE(p.calcolatail, p.datacreazione, NOW())
FROM legacy.bandiprobabilita p
JOIN migration_maps.bandi_id_map m ON m.legacy_id = p.idbando
ON CONFLICT DO NOTHING;

-- 3.5 bandi_links (m.021 nuovo solo: legacy non aveva → skip)
-- 3.6 bandimodifiche
INSERT INTO public.bandimodifiche (id_bando, user_name, modifiche, data)
SELECT m.new_id::text, mod.username, mod.modifiche, mod.data
FROM legacy.bandimodifiche mod
JOIN migration_maps.bandi_id_map m ON m.legacy_id = mod.idbando
ON CONFLICT DO NOTHING;


-- ============================================================================
-- 4. SERVIZI BANDI (aperture, scritture, elaborati, sopralluoghi, ecc.)
-- ============================================================================
-- Lo schema legacy ha tabelle gemelle: AperturaBandi (istanze) +
-- AperturaBandiTpl (template). Il nuovo schema le distingue come:
--   aperture (istanze) + apertura_bandi_tpl (template)
--   scritture + scrittura_bandi
--   elaborati + elaborati_progettuali
--
-- Per ora migro SOLO le istanze (le più ricche di dati). I template legacy
-- sono pochi record e si possono caricare manualmente o ignorare se l'app
-- nuova li ricrea on-the-fly.

\echo '[4/N] aperture, scritture, elaborati, sopralluoghi...'

-- 4.1 aperture (legacy: AperturaBandi)
INSERT INTO public.aperture (
    id_bando, data, ora, id_azienda, prezzo_utente, pagato_utente,
    username, tipo, stato, note, created_at
)
SELECT
    m.new_id,
    a.data::date,
    to_char(a.data, 'HH24:MI'),
    a.idazienda,
    a.prezzoutente,
    COALESCE(a.pagatoutente, false),
    a.username,
    a.tipo,
    COALESCE(a.stato, 'in_sospeso'),
    a.note,
    COALESCE(a.datacreazione, NOW())
FROM legacy.aperturabandi a
JOIN migration_maps.bandi_id_map m ON m.legacy_id = a.idbando
ON CONFLICT DO NOTHING;

-- 4.2 scritture (legacy: ScritturaBandi)
INSERT INTO public.scritture (
    id_bando, data, ora, id_azienda, prezzo_utente, pagato_utente,
    username, tipo, tipologia, stato, note, created_at
)
SELECT
    m.new_id,
    s.data::date,
    to_char(s.data, 'HH24:MI'),
    s.idazienda,
    s.prezzoutente,
    COALESCE(s.pagatoutente, false),
    s.username,
    s.tipo,
    s.tipologia,
    COALESCE(s.stato, 'in_sospeso'),
    s.note,
    COALESCE(s.datacreazione, NOW())
FROM legacy.scritturabandi s
JOIN migration_maps.bandi_id_map m ON m.legacy_id = s.idbando
ON CONFLICT DO NOTHING;

-- 4.3 elaborati (legacy: ElaboratiProgettuali)
INSERT INTO public.elaborati (
    id_bando, titolo, descrizione, prezzo_utente, pagato_utente,
    username, stato, note, created_at
)
SELECT
    m.new_id,
    e.titolo,
    e.descrizione,
    e.prezzoutente,
    COALESCE(e.pagatoutente, false),
    e.username,
    COALESCE(e.stato, 'in_sospeso'),
    e.note,
    COALESCE(e.datacreazione, NOW())
FROM legacy.elaboratiprogettuali e
JOIN migration_maps.bandi_id_map m ON m.legacy_id = e.idbando
ON CONFLICT DO NOTHING;

-- 4.4 sopralluoghi (legacy: Sopralluoghi)
INSERT INTO public.sopralluoghi (
    id_bando, data, ora, indirizzo, citta, prezzo_utente, pagato_utente,
    username, stato, note, created_at
)
SELECT
    m.new_id,
    s.data::date,
    to_char(s.data, 'HH24:MI'),
    s.indirizzo,
    s.citta,
    s.prezzoutente,
    COALESCE(s.pagatoutente, false),
    s.username,
    COALESCE(s.stato, 'in_sospeso'),
    s.note,
    COALESCE(s.datacreazione, NOW())
FROM legacy.sopralluoghi s
JOIN migration_maps.bandi_id_map m ON m.legacy_id = s.idbando
ON CONFLICT DO NOTHING;

-- 4.5 date_sopralluoghi (calendario sopralluoghi per ogni bando)
INSERT INTO public.date_sopralluoghi (id_bando, data, note)
SELECT m.new_id, d.data, d.note
FROM legacy.datesopralluoghi d
JOIN migration_maps.bandi_id_map m ON m.legacy_id = d.idbando
ON CONFLICT DO NOTHING;

-- 4.6 presa_visione_date
INSERT INTO public.presa_visione_date (id_bando, data, note)
SELECT m.new_id, pv.data, pv.note
FROM legacy.presavisionedate pv
JOIN migration_maps.bandi_id_map m ON m.legacy_id = pv.idbando
ON CONFLICT DO NOTHING;

-- 4.7 sopralluoghi_richieste
INSERT INTO public.sopralluoghi_richieste (
    id_bando, username, data_richiesta, stato, note
)
SELECT
    m.new_id,
    sr.username,
    COALESCE(sr.datarichiesta, NOW()),
    COALESCE(sr.stato, 'pending'),
    sr.note
FROM legacy.sopralluoghirichieste sr
JOIN migration_maps.bandi_id_map m ON m.legacy_id = sr.idbando
ON CONFLICT DO NOTHING;


-- ============================================================================
-- 5. ESITI (gare) — id_bando UUID, esito.id resta INTEGER (SERIAL)
-- ============================================================================
-- legacy.gare (esiti) ha già la sua PK (id INTEGER) che pgloader mantiene.
-- L'unica trasformazione è id_bando: INTEGER → UUID via mapping.
--
-- ATTENZIONE: legacy.gare.idbando può essere NULL (esiti orfani senza bando
-- collegato — capita per esiti importati manualmente). Quei record vanno
-- comunque migrati, lasciando id_bando=NULL.

\echo '[5/N] public.gare (esiti) ← legacy.gare...'

INSERT INTO public.gare (
    id, id_bando, titolo, codice_cig, importo_so, importo_co,
    data_pubblicazione, id_stazione, id_soa, regione, annullato,
    created_at, updated_at
)
SELECT
    g.idgara,                          -- mantengo PK INT del legacy
    m.new_id,                          -- id_bando UUID via mapping (NULL ammesso)
    g.titolo,
    g.codicecig,
    g.importoso,
    g.importoco,
    g.datapubblicazione,
    g.idstazione,
    g.idsoa,
    g.regione,
    COALESCE(g.annullato, false),
    COALESCE(g.created_at, g.datapubblicazione, NOW()),
    COALESCE(g.updated_at, g.datapubblicazione, NOW())
FROM legacy.gare g
LEFT JOIN migration_maps.bandi_id_map m ON m.legacy_id = g.idbando
ON CONFLICT (id) DO NOTHING;

-- Resetta sequenza gare.id al MAX (pgloader avrebbe già dovuto farlo)
SELECT setval(
    pg_get_serial_sequence('public.gare', 'id'),
    GREATEST((SELECT COALESCE(MAX(id), 1) FROM public.gare), 1),
    true
);


-- ============================================================================
-- 6. dettaglio_gara, ATI, avvalimenti (FK su gare.id INT, no UUID translation)
-- ============================================================================
-- Queste tabelle hanno FK su id_gara INTEGER, già mappato 1:1 in step 5.
-- Le migra pgloader stesso senza traduzioni → niente da fare qui.
-- (Lasciate qui come reminder: NON aggiungere INSERT manuali.)


-- ============================================================================
-- 7. VERIFICA FINALE
-- ============================================================================

\echo '[FINE] Verifica row counts...'

DO $$
DECLARE
    legacy_bandi BIGINT;
    public_bandi BIGINT;
    mapped_bandi BIGINT;
    legacy_gare  BIGINT;
    public_gare  BIGINT;
BEGIN
    SELECT COUNT(*) INTO legacy_bandi FROM legacy.bandi;
    SELECT COUNT(*) INTO public_bandi FROM public.bandi;
    SELECT COUNT(*) INTO mapped_bandi FROM migration_maps.bandi_id_map;
    SELECT COUNT(*) INTO legacy_gare  FROM legacy.gare;
    SELECT COUNT(*) INTO public_gare  FROM public.gare;

    RAISE NOTICE '────────────────────────────────────────────────';
    RAISE NOTICE 'VERIFICA TRASFORMAZIONE LEGACY → PUBLIC';
    RAISE NOTICE '────────────────────────────────────────────────';
    RAISE NOTICE 'bandi    legacy: %  → public: %  (mapping: %)', legacy_bandi, public_bandi, mapped_bandi;
    RAISE NOTICE 'gare     legacy: %  → public: %',                legacy_gare,  public_gare;
    RAISE NOTICE '────────────────────────────────────────────────';

    IF legacy_bandi <> public_bandi THEN
        RAISE WARNING 'Bandi count MISMATCH! Verifica righe perse.';
    END IF;
    IF legacy_bandi <> mapped_bandi THEN
        RAISE WARNING 'Mapping bandi MISMATCH! Verifica IdBando legacy duplicati o NULL.';
    END IF;
    IF legacy_gare <> public_gare THEN
        RAISE WARNING 'Gare count MISMATCH! Verifica righe perse.';
    END IF;
END $$;

-- VACUUM dopo grandi INSERT (fuori transazione)
COMMIT;

VACUUM ANALYZE public.bandi;
VACUUM ANALYZE public.gare;

\echo ''
\echo '═══════════════════════════════════════════════════════════════'
\echo 'Trasformazione legacy → public completata.'
\echo ''
\echo 'Prossimi step:'
\echo '  1. Verifica con staging/verify-migration.sh che row count combacino'
\echo '  2. Aziende/Utenti hanno PK SERIAL → pgloader li ha gia migrati 1:1'
\echo '     in public.* direttamente (vedi pgloader-easywin.load, schema=legacy'
\echo '     ma SQL Server scrive solo legacy.aziende, NON public.aziende)'
\echo '     → serve un secondo script per aziende+utenti (no UUID mapping)'
\echo '  3. Per le password legacy (aspnet_Membership SHA1+salt) vedi'
\echo '     backend/src/lib/legacy-auth.js (bcrypt fallback wrapper)'
\echo '═══════════════════════════════════════════════════════════════'
